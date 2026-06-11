<?php
/**
 * treebuilder-api.php — Server-Side Persistence for Tree-Builder
 *
 * Endpoints:
 *   GET    ?action=load              → Load saved state (legacy)
 *   POST   ?action=save              → Save state (JSON body, legacy)
 *   GET    ?action=lock              → Acquire edit lock
 *   GET    ?action=unlock            → Release lock
 *   GET    ?action=lock-status       → Check lock status
 *   GET    ?action=history           → List backup versions
 *   GET    ?action=restore&file=X    → Restore from backup
 *   POST   ?action=save-groups       → Save groups as JSON5 text
 *   GET    ?action=load-groups       → Load groups JSON5
 *   POST   ?action=save-profile&name=X → Save profile as JSON5 text
 *   GET    ?action=load-profile&name=X → Load profile JSON5
 *   GET    ?action=list-profiles     → List saved profiles
 *
 * Storage: /data/base/layertree/
 *   groups.json5                     → group definitions
 *   profiles/<name>.json5            → per-profile tree config
 *
 * @version    2.0
 * @date       2026-02-23
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

header('Content-Type: application/json; charset=utf-8');

// Cookie-Auth erforderlich
require_once __DIR__ . '/../includes/AdminAuth.php';
AdminAuth::enforceEndpointPolicy('treebuilder-api', 'php');

require_once __DIR__ . '/../includes/CorsHelper.php';
CorsHelper::handlePreflight('GET, POST, OPTIONS', 'Content-Type, X-Editor-Name');
CorsHelper::setHeaders('GET, POST, OPTIONS', 'Content-Type, X-Editor-Name');

require_once __DIR__ . '/../includes/CorePaths.php';
require_once __DIR__ . '/../includes/TmpPaths.php';
require_once __DIR__ . '/../includes/Database.php';
require_once __DIR__ . '/../includes/StagingImportRepository.php';

// =====================================================================
// Config
// =====================================================================
$docRoot = rtrim($_SERVER['DOCUMENT_ROOT'] ?? '/var/www/html/nwow', '/');
$scriptName = $_SERVER['SCRIPT_NAME'] ?? '';
$appBasePath = rtrim(str_replace('\\', '/', dirname(dirname(dirname(dirname($scriptName))))), '/');
if ($appBasePath === '' || $appBasePath === '.') {
    $appBasePath = '/maps';
}
$clientDataRoot = '/data/Client_Data/nwow'; // Kein nwow-dev: Server hat nur ein nwow-Verzeichnis

define('APP_BASE_PATH', $appBasePath);
define('APP_WEB_ROOT', $docRoot . APP_BASE_PATH);
define('CLIENT_DATA_ROOT', $clientDataRoot);
define('TNET_TMP_ROOT', '/data/Client_Data/nwow/tmp/' . (APP_BASE_PATH === '/maps-dev' ? 'maps-dev' : 'maps'));
define('CORE_CONFIG_DIR', TnetCorePaths::getConfigPath());
define('CORE_NLS_DIR', TnetCorePaths::getNlsPath('de'));
define('APP_CORE_CONFIG_DIR', APP_WEB_ROOT . '/core/config');
// App-lokale NLS-Überladungen: /www/maps(-dev)/core/nls/de/ — enthält z.B. Kategorie-Labels (desc_grundlagen etc.)
define('APP_CORE_NLS_DIR', APP_WEB_ROOT . '/core/nls/de');
define('CONFIG_BASE', APP_WEB_ROOT . '/public/config');
define('DATA_DIR', TnetTmpPaths::editor('layertree'));
define('STATE_FILE', DATA_DIR . '/treebuilder-state.json');
define('GROUPS_FILE', DATA_DIR . '/groups.json5');
define('PROFILES_DIR', DATA_DIR . '/profiles');
define('LOCK_FILE', DATA_DIR . '/treebuilder.lock');
define('BACKUP_DIR', DATA_DIR . '/backups');
define('LOCK_TIMEOUT', 30 * 60); // 30 Minuten Lock-Timeout
define('MAX_BACKUPS', 50);       // Max. Anzahl Backups

// =====================================================================
// Helpers
// =====================================================================
function jsonResponse($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function jsonError($message, $code = 400) {
    jsonResponse(['success' => false, 'error' => $message], $code);
}

function requireAdminAction() {
    if (!AdminAuth::isAdmin()) {
        jsonError('Nur für Administratoren', 403);
    }
}

function toSftpPath($path) {
    $path = str_replace('/var/www/html/nwow', '/www', $path);
    $path = str_replace('/data/Client_Data/nwow/tmp', '/data/tmp', $path);
    return str_replace(CLIENT_DATA_ROOT, '/data', $path);
}

function runtimePathInfo($label, $path) {
    return [
        'label'    => $label,
        'phpPath'  => $path,
        'sftpPath' => toSftpPath($path),
        'exists'   => file_exists($path),
        'isDir'    => is_dir($path),
        'writable' => is_dir($path) ? is_writable($path) : (file_exists($path) ? is_writable($path) : is_writable(dirname($path))),
    ];
}

function toDisplayTmpPath($path) {
    $path = str_replace('\\', '/', (string)$path);
    $path = str_replace('/data/Client_Data/nwow/', '', $path);
    $path = str_replace('/data/', '', $path);
    return ltrim($path, '/');
}

function getEditorName() {
    // From header or query param
    return $_SERVER['HTTP_X_EDITOR_NAME'] ?? $_GET['editor'] ?? 'Unbekannt';
}

function useStagingImportDb() {
    $db = Database::isAvailable();
    return !empty($db['available']);
}

function ensureDirs() {
    if (!is_dir(DATA_DIR)) {
        // Verzeichnis automatisch erstellen
        if (!@mkdir(DATA_DIR, 0775, true)) {
            jsonError('Data directory konnte nicht erstellt werden: ' . DATA_DIR, 500);
        }
    }
    if (!is_writable(DATA_DIR)) {
        jsonError('Data directory not writable: ' . DATA_DIR, 500);
    }
    if (!is_dir(BACKUP_DIR)) {
        @mkdir(BACKUP_DIR, 0775, true);
    }
    if (!is_dir(PROFILES_DIR)) {
        @mkdir(PROFILES_DIR, 0775, true);
    }
}

// =====================================================================
// JSON5 Save / Load (Gruppen + Profile)
// =====================================================================
function saveGroupsFile($content, $editor) {
    ensureDirs();
    $lock = readLock();
    if ($lock && $lock['editor'] !== $editor) {
        jsonError('Gesperrt von ' . $lock['editor'] . ' — Speichern nicht möglich', 423);
    }

    // Backup der alten Datei
    if (file_exists(GROUPS_FILE)) {
        $ts = date('Ymd_His');
        @copy(GROUPS_FILE, BACKUP_DIR . '/groups_' . $ts . '.json5');
        cleanupBackups();
    }

    // Header-Kommentar ergänzen
    $header = "// Gruppen-Definitionen (Tree-Builder)\n"
            . "// Gespeichert: " . date('Y-m-d H:i:s') . "\n"
            . "// Editor: " . $editor . "\n";
    // Wenn der Content bereits einen Kommentar-Header hat, nicht doppelt hinzufügen
    if (strpos($content, '// Gruppen') !== 0) {
        $content = $header . $content;
    }

    $bytes = file_put_contents(GROUPS_FILE, $content);
    if ($bytes === false) {
        jsonError('Gruppen speichern fehlgeschlagen', 500);
    }

    if ($lock && $lock['editor'] === $editor) {
        acquireLock($editor);
    }

    return ['saved' => true, 'file' => 'groups.json5', 'bytes' => $bytes];
}

function loadGroupsFile() {
    if (!file_exists(GROUPS_FILE)) {
        return ['exists' => false, 'content' => null];
    }
    $content = file_get_contents(GROUPS_FILE);
    return ['exists' => true, 'content' => $content, 'size' => strlen($content)];
}

function saveProfileFile($name, $content, $editor) {
    ensureDirs();
    $lock = readLock();
    if ($lock && $lock['editor'] !== $editor) {
        jsonError('Gesperrt von ' . $lock['editor'] . ' — Speichern nicht möglich', 423);
    }

    // Nur sichere Dateinamen erlauben
    $safeName = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $name);
    if (!$safeName) {
        jsonError('Ungültiger Profilname', 400);
    }

    $filePath = PROFILES_DIR . '/' . $safeName . '.json5';

    // Backup
    if (file_exists($filePath)) {
        $ts = date('Ymd_His');
        @copy($filePath, BACKUP_DIR . '/profile_' . $safeName . '_' . $ts . '.json5');
        cleanupBackups();
    }

    // Header-Kommentar
    $header = "// Layertree-Profil: " . $name . "\n"
            . "// Gespeichert: " . date('Y-m-d H:i:s') . "\n"
            . "// Editor: " . $editor . "\n";
    if (strpos($content, '// Layertree') !== 0 && strpos($content, '// Layer-Tree') !== 0) {
        $content = $header . $content;
    }

    $bytes = file_put_contents($filePath, $content);
    if ($bytes === false) {
        jsonError('Profil speichern fehlgeschlagen', 500);
    }

    if ($lock && $lock['editor'] === $editor) {
        acquireLock($editor);
    }

    return ['saved' => true, 'file' => $safeName . '.json5', 'bytes' => $bytes];
}

function loadProfileFile($name) {
    $safeName = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $name);
    $filePath = PROFILES_DIR . '/' . $safeName . '.json5';
    if (!file_exists($filePath)) {
        return ['exists' => false, 'content' => null];
    }
    $content = file_get_contents($filePath);
    return ['exists' => true, 'name' => $name, 'content' => $content, 'size' => strlen($content)];
}

function listProfileFiles() {
    if (!is_dir(PROFILES_DIR)) return [];
    $files = glob(PROFILES_DIR . '/*.json5');
    $result = [];
    foreach ($files as $f) {
        $basename = basename($f, '.json5');
        $result[] = [
            'name'     => $basename,
            'file'     => basename($f),
            'size'     => filesize($f),
            'modified' => date('Y-m-d H:i:s', filemtime($f))
        ];
    }
    usort($result, function($a, $b) { return strcmp($a['name'], $b['name']); });
    return $result;
}

// =====================================================================
// Lyrmgr.conf Laden / Publizieren
// =====================================================================
function getConfigPath($profile) {
    $safe = preg_replace('/[^a-zA-Z0-9_\-]/', '', $profile);
    if ($safe === 'public') {
        return CONFIG_BASE . '/lyrmgr.conf';
    }
    return CONFIG_BASE . '/' . $safe . '/lyrmgr.conf';
}

/**
 * Pfad zur Draft-Datei im tmp/layertree Verzeichnis.
 * Format: DATA_DIR/[profile]-lyrmgr.conf
 */
function getDraftPath($profile) {
    $safe = preg_replace('/[^a-zA-Z0-9_\-]/', '', $profile);
    return DATA_DIR . '/' . $safe . '-lyrmgr.conf';
}

function getDraftDbProfile($profile) {
    $safe = preg_replace('/[^a-zA-Z0-9_\-]/', '', $profile);
    return $safe . '__draft';
}

/**
 * Draft-LyrMgr aus tmp/layertree speichern.
 * Speichert die gesamte lyrmgr.conf Struktur (alle Blöcke).
 */
function saveLyrmgrDraft($profile, $data, $editor) {
    require_once __DIR__ . '/../includes/ConfigSource.php';
    if (ConfigSource::useDb('catalog')) {
        require_once __DIR__ . '/../includes/CatalogRepository.php';
        try {
            $draftProfile = getDraftDbProfile($profile);
            $db = CatalogRepository::saveDraftProfile($draftProfile, $data, $editor);
            if (empty($db['success'])) {
                return ['saved' => false, 'error' => 'DB-Draft speichern fehlgeschlagen'];
            }
            return [
                'saved'     => true,
                'profile'   => $profile,
                'dbProfile' => $draftProfile,
                'source'    => 'draft-db',
                'revision'  => (int)($db['revision'] ?? 0),
                'updatedBy' => $db['updatedBy'] ?? $editor,
                'updatedAt' => $db['updatedAt'] ?? date('Y-m-d H:i:s'),
                'editor'    => $editor,
                'timestamp' => date('Y-m-d H:i:s')
            ];
        } catch (\Throwable $e) {
            if (!ConfigSource::fallbackEnabled()) {
                return ['saved' => false, 'error' => 'DB-Draft speichern fehlgeschlagen: ' . $e->getMessage()];
            }
            error_log('saveLyrmgrDraft: DB-Fallback auf Datei: ' . $e->getMessage());
            // Fallback auf Datei unten
        }
    }

    $path = getDraftPath($profile);
    ensureDirs();

    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) {
        return ['saved' => false, 'error' => 'JSON encode Fehler: ' . json_last_error_msg()];
    }
    $bytes = @file_put_contents($path, $json);
    if ($bytes === false) {
        $err = error_get_last();
        return ['saved' => false, 'error' => 'Schreiben fehlgeschlagen: ' . $path . ' — ' . ($err ? $err['message'] : 'unbekannt')];
    }
    return [
        'saved'     => true,
        'profile'   => $profile,
        'path'      => $path,
        'bytes'     => $bytes,
        'editor'    => $editor,
        'timestamp' => date('Y-m-d H:i:s')
    ];
}

/**
 * Draft-LyrMgr aus tmp/layertree laden.
 */
function loadLyrmgrDraft($profile) {
    require_once __DIR__ . '/../includes/ConfigSource.php';
    if (ConfigSource::useDb('catalog')) {
        require_once __DIR__ . '/../includes/CatalogRepository.php';
        try {
            $draftProfile = getDraftDbProfile($profile);
            $doc = CatalogRepository::loadDraftProfile($draftProfile);
            if ($doc['exists']) {
                $data = is_array($doc['data']) ? $doc['data'] : [];
                $lyrmgrKeys = array_keys($data);
                $meta = is_array($doc['lyrmgrMeta'] ?? null) ? $doc['lyrmgrMeta'] : [];
                return [
                    'exists'     => true,
                    'profile'    => $profile,
                    'dbProfile'  => $draftProfile,
                    'lyrmgrKeys' => $lyrmgrKeys,
                    'lyrmgrMeta' => $meta,
                    'data'       => $data,
                    'size'       => strlen(json_encode($data)),
                    'modified'   => $doc['updatedAt'] ?? null,
                    'revision'   => (int)($doc['revision'] ?? 0),
                    'source'     => 'draft-db'
                ];
            }
            if (!ConfigSource::fallbackEnabled()) {
                return ['exists' => false, 'profile' => $profile, 'source' => 'draft-db'];
            }
        } catch (\Throwable $e) {
            if (!ConfigSource::fallbackEnabled()) {
                return ['exists' => false, 'error' => 'Katalog-DB Draft nicht verfuegbar: ' . $e->getMessage(), 'profile' => $profile, 'source' => 'draft-db'];
            }
            error_log('loadLyrmgrDraft: DB-Fallback auf Datei: ' . $e->getMessage());
            // Fallback auf Datei unten
        }
    }

    $path = getDraftPath($profile);
    if (!file_exists($path)) {
        return ['exists' => false, 'path' => $path, 'profile' => $profile];
    }
    $content = file_get_contents($path);
    $data = json_decode($content, true);
    if ($data === null) {
        return ['exists' => true, 'error' => 'JSON parse error: ' . json_last_error_msg(), 'path' => $path];
    }

    // Auto-Migration: Draft-Bloecke von altem Object-Format in geordnetes Array-Format umwandeln.
    // Verhindert, dass der Draft die Kategorienreihenfolge durcheinanderbringt.
    $draftChanged = false;
    $refFilePath = getConfigPath($profile);
    $refData = file_exists($refFilePath) ? json_decode(file_get_contents($refFilePath), true) : [];
    if (!is_array($refData)) $refData = [];

    foreach ($data as $lmKey => &$block) {
        if (!isset($block['structure']) || !is_array($block['structure'])) continue;
        $structureObj = $block['structure'];
        if (empty($structureObj)) continue;
        $firstVal = array_values($structureObj)[0];
        // Pruefe ob bereits Array-Format mit _key
        if (array_key_exists(0, $structureObj) && isset($firstVal['_key'])) continue;
        // Altes Object-Format: in geordnetes Array konvertieren
        $fileKeys = [];
        if (isset($refData[$lmKey]['structure']) && is_array($refData[$lmKey]['structure'])) {
            $fileKeys = array_keys($refData[$lmKey]['structure']);
        }
        if (empty($fileKeys)) $fileKeys = array_keys($structureObj);
        $orderedArr = [];
        foreach ($fileKeys as $catKey) {
            if (isset($structureObj[$catKey])) {
                $entry = $structureObj[$catKey];
                $entry['_key'] = $catKey;
                $orderedArr[] = $entry;
            }
        }
        foreach ($structureObj as $catKey => $catData) {
            $already = false;
            foreach ($orderedArr as $e) {
                if (($e['_key'] ?? '') === $catKey) { $already = true; break; }
            }
            if (!$already) { $catData['_key'] = $catKey; $orderedArr[] = $catData; }
        }
        $block['structure'] = $orderedArr;
        $draftChanged = true;
    }
    unset($block);

    if ($draftChanged) {
        // Migrierten Draft direkt zurueckschreiben
        @file_put_contents($path, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    }

    $lyrmgrKeys = array_keys($data);
    return [
        'exists'     => true,
        'profile'    => $profile,
        'path'       => $path,
        'lyrmgrKeys' => $lyrmgrKeys,
        'lyrmgrMeta' => array_fill_keys($lyrmgrKeys, [
            'source' => 'draft-file',
            'revision' => null,
            'updatedBy' => null,
            'updatedAt' => date('Y-m-d H:i:s', filemtime($path)),
        ]),
        'data'       => $data,
        'size'       => strlen($content),
        'modified'   => date('Y-m-d H:i:s', filemtime($path)),
        'source'     => 'draft'
    ];
}

/**
 * Draft-Status für ein Profil laden (für Live-Indikator bei Mehrbenutzer-Bearbeitung).
 */
function getLyrmgrDraftStatus($profile) {
    require_once __DIR__ . '/../includes/ConfigSource.php';
    if (ConfigSource::useDb('catalog')) {
        require_once __DIR__ . '/../includes/CatalogRepository.php';
        try {
            $draftProfile = getDraftDbProfile($profile);
            $status = CatalogRepository::getDraftStatus($draftProfile);
            return [
                'exists'    => (bool)($status['exists'] ?? false),
                'profile'   => $profile,
                'dbProfile' => $draftProfile,
                'source'    => 'draft-db',
                'revision'  => (int)($status['revision'] ?? 0),
                'updatedBy' => $status['updatedBy'] ?? null,
                'updatedAt' => $status['updatedAt'] ?? null,
            ];
        } catch (\Throwable $e) {
            if (!ConfigSource::fallbackEnabled()) {
                return ['exists' => false, 'profile' => $profile, 'source' => 'draft-db', 'error' => $e->getMessage()];
            }
            error_log('getLyrmgrDraftStatus: DB-Fallback auf Datei: ' . $e->getMessage());
        }
    }

    $path = getDraftPath($profile);
    if (!file_exists($path)) {
        return ['exists' => false, 'profile' => $profile, 'source' => 'draft-file'];
    }
    return [
        'exists'    => true,
        'profile'   => $profile,
        'source'    => 'draft-file',
        'revision'  => null,
        'updatedBy' => null,
        'updatedAt' => date('Y-m-d H:i:s', filemtime($path)),
    ];
}

function loadLyrmgrConf($profile) {
    // ===== DB-FIRST (Themenkatalog DB-first) =====
    // Bei configSource=catalog=db zuerst aus der Staging-DB lesen.
    // Bei DB-Ausfall faellt der Code (sofern fallbackToFiles aktiv) auf die
    // bestehende Datei-Logik unten zurueck.
    require_once __DIR__ . '/../includes/ConfigSource.php';
    if (ConfigSource::useDb('catalog')) {
        require_once __DIR__ . '/../includes/CatalogRepository.php';
        try {
            $doc = CatalogRepository::loadProfile($profile);
            if ($doc['exists']) {
                $dbData = $doc['data'];

                // Auto-Migration: Falls structure-Bloecke noch als assoziatives Objekt
                // (alphabetisch sortiert durch JSONB) vorliegen, verwende die Datei
                // als Reihenfolge-Referenz und speichere im neuen Array-Format.
                $needsRepair = false;
                foreach ($dbData as $block) {
                    if (!isset($block['structure']) || !is_array($block['structure'])) continue;
                    $structArr = $block['structure'];
                    if (empty($structArr)) continue;
                    $firstVal = array_values($structArr)[0];
                    // Altes Format: assoziative Keys, Werte sind Objekte OHNE '_key'-Feld
                    if (!array_key_exists(0, $structArr) && !isset($firstVal['_key'])) {
                        $needsRepair = true;
                        break;
                    }
                }

                if ($needsRepair) {
                    $filePath = getConfigPath($profile);
                    $fileData = file_exists($filePath) ? json_decode(file_get_contents($filePath), true) : [];
                    if (!is_array($fileData)) $fileData = [];

                    foreach ($dbData as $lmKey => &$block) {
                        if (!isset($block['structure']) || !is_array($block['structure'])) continue;
                        $structureObj = $block['structure'];
                        if (empty($structureObj)) continue;
                        $firstVal = array_values($structureObj)[0];
                        if (array_key_exists(0, $structureObj) || isset($firstVal['_key'])) continue;

                        // Reihenfolge aus Datei; fehlende Keys ans Ende anhaengen
                        $fileKeys = [];
                        if (isset($fileData[$lmKey]['structure']) && is_array($fileData[$lmKey]['structure'])) {
                            $fileKeys = array_keys($fileData[$lmKey]['structure']);
                        }
                        if (empty($fileKeys)) $fileKeys = array_keys($structureObj);

                        $orderedArr = [];
                        foreach ($fileKeys as $catKey) {
                            if (isset($structureObj[$catKey])) {
                                $entry = $structureObj[$catKey];
                                $entry['_key'] = $catKey;
                                $orderedArr[] = $entry;
                            }
                        }
                        foreach ($structureObj as $catKey => $catData) {
                            $already = false;
                            foreach ($orderedArr as $e) {
                                if (($e['_key'] ?? '') === $catKey) { $already = true; break; }
                            }
                            if (!$already) { $catData['_key'] = $catKey; $orderedArr[] = $catData; }
                        }
                        $block['structure'] = $orderedArr;
                    }
                    unset($block);

                    // Repariertes Dokument zurueckspeichern
                    try {
                        CatalogRepository::saveProfile($profile, $dbData, null, 'system', 'migrate-order');
                    } catch (\Throwable $ignored) {}
                }

                return [
                    'exists'     => true,
                    'profile'    => $profile,
                    'path'       => getConfigPath($profile),
                    'lyrmgrKeys' => array_keys($dbData),
                    'lyrmgrMeta' => array_fill_keys(array_keys($dbData), [
                        'source' => 'db',
                        'revision' => (int)($doc['revision'] ?? 0),
                        'updatedBy' => $doc['updatedBy'] ?? null,
                        'updatedAt' => $doc['updatedAt'] ?? null,
                    ]),
                    'data'       => $dbData,
                    'size'       => strlen(json_encode($dbData)),
                    'revision'   => $doc['revision'],
                    'source'     => 'db'
                ];
            }
            // Profil (noch) nicht in DB: bei aktivem Fallback auf Datei, sonst leer.
            if (!ConfigSource::fallbackEnabled()) {
                return ['exists' => false, 'profile' => $profile, 'source' => 'db'];
            }
        } catch (\Throwable $e) {
            if (!ConfigSource::fallbackEnabled()) {
                return ['exists' => false, 'error' => 'Katalog-DB nicht verfuegbar: ' . $e->getMessage(), 'profile' => $profile];
            }
            error_log('loadLyrmgrConf: DB-Fallback auf Datei: ' . $e->getMessage());
            // weiter mit Datei-Logik unten
        }
    }

    $path = getConfigPath($profile);
    if (!file_exists($path)) {
        return ['exists' => false, 'path' => $path, 'profile' => $profile];
    }
    $content = file_get_contents($path);
    $data = json_decode($content, true);
    if ($data === null) {
        return ['exists' => true, 'error' => 'JSON parse error: ' . json_last_error_msg(), 'path' => $path];
    }
    // Meta-Schlüssel aus der Conf herausfiltern (keine echten LyrMgr-Blöcke)
    $skipKeys = ['_nlsAliases', '_nodeEditMeta', '_comment', '_backup', '_meta'];
    $lyrmgrKeys = array_values(array_filter(array_keys($data), function($k) use ($skipKeys) {
        return !in_array($k, $skipKeys, true) && substr($k, 0, 1) !== '_';
    }));
    return [
        'exists'     => true,
        'profile'    => $profile,
        'path'       => $path,
        'lyrmgrKeys' => $lyrmgrKeys,
        'lyrmgrMeta' => array_fill_keys($lyrmgrKeys, [
            'source' => 'file',
            'revision' => null,
            'updatedBy' => null,
            'updatedAt' => date('Y-m-d H:i:s', filemtime($path)),
        ]),
        'data'       => $data,
        'size'       => strlen($content),
        'source'     => 'file'
    ];
}

function publishLyrmgrBlock($profile, $lyrmgrKey, $blockData, $editor) {
    require_once __DIR__ . '/../includes/ConfigSource.php';

    $path = getConfigPath($profile);
    $dbMode = ConfigSource::useDb('catalog');
    $fileWriteError = null;

    // Verzeichnis anlegen falls nötig
    $dir = dirname($path);
    if (!is_dir($dir)) {
        if (!@mkdir($dir, 0775, true)) {
            if (!$dbMode) {
                return ['published' => false, 'error' => 'Verzeichnis konnte nicht erstellt werden: ' . $dir];
            }
            $fileWriteError = 'Verzeichnis konnte nicht erstellt werden: ' . $dir;
        }
    }

    // Bestehende Datei lesen
    $existing = [];
    if (file_exists($path)) {
        $content = file_get_contents($path);
        $existing = json_decode($content, true);
        if (!is_array($existing)) $existing = [];

        // Backup erstellen
        ensureDirs();
        $ts = date('Ymd_His');
        $safeName = preg_replace('/[^a-zA-Z0-9_\-]/', '', $profile);
        $backupPath = BACKUP_DIR . '/lyrmgr_' . $safeName . '_' . $ts . '.conf';
        @copy($path, $backupPath);
        cleanupBackups();
    }

    // Block ersetzen
    $existing[$lyrmgrKey] = $blockData;

    $json = json_encode($existing, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) {
        return ['published' => false, 'error' => 'JSON encode Fehler: ' . json_last_error_msg()];
    }
    $bytes = @file_put_contents($path, $json);

    if ($bytes === false) {
        $err = error_get_last();
        $fileWriteError = 'Schreiben fehlgeschlagen: ' . $path . ' — ' . ($err ? $err['message'] : 'unbekannt');
        if (!$dbMode) {
            return ['published' => false, 'error' => $fileWriteError];
        }
    }

    $result = [
        'published'  => true,
        'profile'    => $profile,
        'lyrmgrKey'  => $lyrmgrKey,
        'path'       => $path,
        'bytes'      => $bytes !== false ? $bytes : 0,
        'editor'     => $editor,
        'timestamp'  => date('Y-m-d H:i:s')
    ];

    // ===== DB-FIRST (Themenkatalog DB-first) =====
    // Bei configSource=catalog=db ist die DB die Quelle der Wahrheit; die Datei
    // oben bleibt als Legacy-Export/Fallback erhalten. Block wird ins
    // Profil-Dokument gemerged (inkl. Revision + History).
    if (ConfigSource::useDb('catalog')) {
        require_once __DIR__ . '/../includes/CatalogRepository.php';
        try {
            $db = CatalogRepository::publishBlock($profile, $lyrmgrKey, $blockData, null, $editor);
            $result['source']   = 'db';
            $result['revision'] = $db['revision'];
            if ($fileWriteError) {
                $result['warning'] = $fileWriteError;
            }
        } catch (\Throwable $e) {
            if (!ConfigSource::fallbackEnabled()) {
                return ['published' => false, 'error' => 'Katalog-DB-Schreiben fehlgeschlagen: ' . $e->getMessage()];
            }
            if ($fileWriteError) {
                return ['published' => false, 'error' => 'DB-Schreiben fehlgeschlagen: ' . $e->getMessage() . ' | Datei ebenfalls fehlgeschlagen: ' . $fileWriteError];
            }
            error_log('publishLyrmgrBlock: DB-Schreiben fehlgeschlagen, nur Datei: ' . $e->getMessage());
            $result['source'] = 'file';
        }
    } else {
        $result['source'] = 'file';
    }

    return $result;
}

function listLyrmgrProfiles() {
    $result = [];
    // Public profile
    $publicPath = CONFIG_BASE . '/lyrmgr.conf';
    if (file_exists($publicPath)) {
        $data = json_decode(file_get_contents($publicPath), true);
        $result[] = [
            'profile'    => 'public',
            'path'       => $publicPath,
            'lyrmgrKeys' => $data ? array_keys($data) : [],
            'size'       => filesize($publicPath),
            'modified'   => date('Y-m-d H:i:s', filemtime($publicPath)),
            'isStage'    => false
        ];
    }
    // Subdirectories
    $dirs = glob(CONFIG_BASE . '/*/lyrmgr.conf');
    foreach ($dirs as $f) {
        $dirName = basename(dirname($f));
        $data = json_decode(file_get_contents($f), true);
        $isStage = (bool)preg_match('/-stage$/', $dirName);
        $baseProfile = $isStage ? preg_replace('/-stage$/', '', $dirName) : null;
        $entry = [
            'profile'    => $dirName,
            'path'       => $f,
            'lyrmgrKeys' => $data ? array_keys($data) : [],
            'size'       => filesize($f),
            'modified'   => date('Y-m-d H:i:s', filemtime($f)),
            'isStage'    => $isStage
        ];
        if ($isStage) $entry['baseProfile'] = $baseProfile;
        $result[] = $entry;
    }
    return $result;
}

/**
 * Alle Layer-Definitionen aus 3 Quellen laden und zusammenführen.
 * 1. /www/core/config/layers_*.conf (Basis)
 * 2. /www/maps/core/config/layers_*.conf (Overrides)
 * 3. /www/maps/public/config/[profil]/layers.conf (Profil, optional)
 *
 * Zusätzlich: NLS-Labels aus lyrmgrResources_*.json
 */
function listAllLayers($profile = null) {
    global $docRoot;

    $definitions = [];
    $sources = [];
    $sourceMap = [];  // layerId → { tag, file }

    // Hilfsfunktion: Alle Layer-Conf-Dateien aus einem Verzeichnis lesen
    // Erfasst layers_*.conf, layers-*.conf und layers.conf (alle Varianten)
    $readLayerConfs = function($dir, $sourceTag) use (&$definitions, &$sourceMap, &$sources) {
        if (!$dir || !is_dir($dir)) return;
        // Alle Dateien die mit "layers" beginnen und auf .conf enden
        $allConf = glob($dir . '/layers*.conf');
        // Nur aktive Dateien (keine Backups wie .20260101_120000.bak)
        $files = array_filter($allConf, function($f) {
            return !preg_match('/\.\d{8}_\d{6}\./', basename($f));
        });
        foreach ($files as $f) {
            $fname = basename($f);
            $data = json_decode(file_get_contents($f), true);
            if (is_array($data)) {
                foreach ($data as $k => $v) {
                    $definitions[$k] = $v;
                    $sourceMap[$k] = ['tag' => $sourceTag, 'file' => $fname, 'dir' => $dir];
                }
            }
        }
        $sources[] = ['path' => $dir, 'type' => $sourceTag, 'files' => count($files)];
    };

    // Quelle der Layer: DB-only sobald die Konfig-Store DB verfuegbar ist.
    // Dateien (core/override/profile) dienen nur noch als Fallback, falls die DB
    // leer/nicht erreichbar ist — so wird der Tree-Builder nie versehentlich leer.
    $dbActive = useStagingImportDb();
    $dbHasLayers = false;

    if (!$dbActive) {
        // 1. Basis: /www/core/config/ — alle Layer-Typen (WMS, ArcGIS REST, WMTS, etc.)
        $coreBase = realpath(CORE_CONFIG_DIR);
        $readLayerConfs($coreBase, 'core');

        // 2. Override: /www/maps/core/config/
        $overridePath = realpath(APP_CORE_CONFIG_DIR);
        if ($overridePath !== $coreBase) {
            $readLayerConfs($overridePath, 'override');
        }

        // 3. Profil-spezifisch: /www/maps/public/config/[profil]/
        if ($profile) {
            $safe = preg_replace('/[^a-zA-Z0-9_\-]/', '', $profile);
            $profilePath = CONFIG_BASE . '/' . $safe;
            if ($safe === 'public') $profilePath = CONFIG_BASE;
            $readLayerConfs($profilePath, 'profile');
        }
    }

    // DB-Quelle (DB-first/DB-only): Konfig-Store-DB-Bundles liefern die Layer.
    //    Ueberladungsreihenfolge: core -> override/sitecore -> profile (DB gewinnt).
    if ($dbActive) {
        $scopeRank = ['core' => 1, 'override' => 2, 'sitecore' => 2, 'profile' => 3];
        $bundles = StagingImportRepository::loadAll();
        // Nach Scope sortieren, damit hoehere Stufen spaeter ueberschreiben.
        usort($bundles, function ($a, $b) use ($scopeRank) {
            $ra = $scopeRank[$a['scope'] ?? 'core'] ?? 1;
            $rb = $scopeRank[$b['scope'] ?? 'core'] ?? 1;
            if ($ra === $rb) return strcmp($a['kuerzel'], $b['kuerzel']);
            return $ra - $rb;
        });
        foreach ($bundles as $bundle) {
            $bScope = $bundle['scope'] ?? 'core';
            $bProfile = $bundle['profile'] ?? null;
            // Profil-Filter: Profil-Bundles nur fuer das aktuell gewaehlte Profil.
            //   core/sitecore/override -> immer sichtbar.
            //   profile -> nur wenn Profil gewaehlt ist UND exakt passt.
            if ($bScope === 'profile') {
                if (!$profile || $bProfile !== $profile) continue;
            }
            $bTags = (isset($bundle['tags']) && is_array($bundle['tags'])) ? array_values($bundle['tags']) : [$bundle['kuerzel']];
            foreach (($bundle['files'] ?? []) as $file) {
                $prefix = $file['prefix'] ?? '';
                $data = $file['data'] ?? null;
                if (!is_array($data) || empty($data)) continue;
                $isAssoc = array_keys($data) !== range(0, count($data) - 1);
                if (!$isAssoc) continue;
                if ($prefix === 'layers') {
                    $fileEdits = isset($file['_edits']) && is_array($file['_edits']) ? $file['_edits'] : [];
                    foreach ($data as $k => $v) {
                        $definitions[$k] = $v;
                        $dbHasLayers = true;
                        $sourceMap[$k] = [
                            'tag'     => 'db:' . $bScope,
                            'file'    => $bundle['kuerzel'] . '/' . ($file['name'] ?? ''),
                            'dir'     => 'db:config_bundle_store',
                            'tags'    => $bTags,
                            'kuerzel' => $bundle['kuerzel'],
                            'scope'   => $bScope,
                            'profile' => $bProfile,
                            // Letzte Änderung aus _edits (wer+wann hat diesen Layer-Key zuletzt bearbeitet)
                            'editBy'  => isset($fileEdits[$k]['by']) ? $fileEdits[$k]['by'] : null,
                            'editAt'  => isset($fileEdits[$k]['at']) ? $fileEdits[$k]['at'] : null,
                        ];
                    }
                }
            }
        }
        $sources[] = ['path' => 'db:config_bundle_store', 'type' => 'db', 'files' => count($bundles)];

        // Fallback: DB aktiv, aber (noch) keine Layer importiert -> Dateien lesen,
        // damit der Tree-Builder nicht leer bleibt, bis der Import erfolgt ist.
        if (!$dbHasLayers) {
            $coreBase = realpath(CORE_CONFIG_DIR);
            $readLayerConfs($coreBase, 'core');
            $overridePath = realpath(APP_CORE_CONFIG_DIR);
            if ($overridePath !== $coreBase) {
                $readLayerConfs($overridePath, 'override');
            }
            if ($profile) {
                $safe = preg_replace('/[^a-zA-Z0-9_\-]/', '', $profile);
                $profilePath = CONFIG_BASE . '/' . $safe;
                if ($safe === 'public') $profilePath = CONFIG_BASE;
                $readLayerConfs($profilePath, 'profile');
            }
        }
    }

    // NLS-Labels laden (Basis + Override)
    $aliases = [];
    $nlsDirs = [];
    $nlsBase = realpath(CORE_NLS_DIR);
    if ($nlsBase && is_dir($nlsBase)) $nlsDirs[] = $nlsBase;
    $nlsOverride = realpath(APP_CORE_NLS_DIR);
    if ($nlsOverride && is_dir($nlsOverride) && $nlsOverride !== $nlsBase) $nlsDirs[] = $nlsOverride;

    foreach ($nlsDirs as $nlsDir) {
        foreach (glob($nlsDir . '/lyrmgrResources*.json') as $f) {
            $data = json_decode(file_get_contents($f), true);
            if (is_array($data)) {
                $aliases = array_merge($aliases, $data);
            }
        }
    }

    // Profil-spezifische NLS laden (Profil-Aliases überschreiben Basis)
    $profileAliases = [];
    if ($profile) {
        $safeP = preg_replace('/[^a-zA-Z0-9_\-]/', '', $profile);
        $profileNlsFile = getProfileNlsPath($safeP);
        if (file_exists($profileNlsFile)) {
            $pData = json_decode(file_get_contents($profileNlsFile), true);
            if (is_array($pData)) {
                $profileAliases = $pData;
                $aliases = array_merge($aliases, $pData);
            }
        }
    }

    // DB-Overlay fuer Aliase (DB-first): lyrmgrResources aus der Konfig-Store DB
    // ueberschreiben die Datei-Labels in derselben Scope-Reihenfolge.
    if (useStagingImportDb()) {
        $scopeRankN = ['core' => 1, 'override' => 2, 'sitecore' => 2, 'profile' => 3];
        $nlsBundles = StagingImportRepository::loadAll();
        usort($nlsBundles, function ($a, $b) use ($scopeRankN) {
            $ra = $scopeRankN[$a['scope'] ?? 'core'] ?? 1;
            $rb = $scopeRankN[$b['scope'] ?? 'core'] ?? 1;
            if ($ra === $rb) return strcmp($a['kuerzel'], $b['kuerzel']);
            return $ra - $rb;
        });
        foreach ($nlsBundles as $bundle) {
            $bScope = $bundle['scope'] ?? 'core';
            $bProfile = $bundle['profile'] ?? null;
            if ($bScope === 'profile') {
                if (!$profile || $bProfile !== $profile) continue;
            }
            foreach (($bundle['files'] ?? []) as $file) {
                if (($file['prefix'] ?? '') !== 'lyrmgrResources') continue;
                $data = $file['data'] ?? null;
                if (is_array($data) && !empty($data)) {
                    $aliases = array_merge($aliases, $data);
                }
            }
        }
    }

    // Flache Layer-Liste aufbauen — alle Properties übernehmen
    $layers = [];
    // Interne/unwichtige Keys die nicht in die Ausgabe sollen
    $skipKeys = ['_comment' => 1, '_backup' => 1];
    foreach ($definitions as $id => $def) {
        $sm = $sourceMap[$id] ?? ['tag' => 'unknown', 'file' => '', 'dir' => ''];
        $layer = ['id' => $id, 'source' => $sm['tag'], 'sourceFile' => $sm['file'], 'sourceFilePath' => $sm['dir'] . '/' . $sm['file']];
        // Tags/Stufe/Kuerzel aus dem DB-Bundle (fuer Tag-Filter im Tree-Builder)
        $layer['tags'] = isset($sm['tags']) && is_array($sm['tags']) ? array_values($sm['tags']) : [];
        $layer['kuerzel'] = $sm['kuerzel'] ?? '';
        $layer['scope'] = $sm['scope'] ?? '';
        if (isset($sm['profile'])) $layer['profile'] = $sm['profile'];
        // Letzte Bearbeitung aus _edits-Tracking (wer+wann hat diesen Layer zuletzt geändert)
        if (!empty($sm['editBy'])) $layer['editBy'] = $sm['editBy'];
        if (!empty($sm['editAt'])) $layer['editAt'] = $sm['editAt'];
        // Alle Properties 1:1 übernehmen (Layer-Typ-agnostisch: WMS, ArcGIS, WMTS etc.)
        foreach ($def as $prop => $val) {
            if (!isset($skipKeys[$prop])) {
                $layer[$prop] = $val;
            }
        }
        // Alias/Label aus NLS
        // NLS-Alias: zuerst mit Original-Slashes, dann mit / → _
        $aliasKey1 = 'desc_' . $id;
        $aliasKey2 = 'desc_' . str_replace('/', '_', $id);
        if (isset($aliases[$aliasKey1])) {
            $layer['name'] = $aliases[$aliasKey1];
        } elseif (isset($aliases[$aliasKey2])) {
            $layer['name'] = $aliases[$aliasKey2];
        } elseif (!isset($layer['name'])) {
            // Fallback: letzter Teil der ID
            $parts = explode('/', $id);
            $layer['name'] = end($parts);
        }
        $layers[] = $layer;
    }

    return [
        'layers'         => $layers,
        'count'          => count($layers),
        'sources'        => $sources,
        'aliases'        => $aliases,
        'profileAliases' => $profileAliases
    ];
}

/**
 * Pfad zur Profil-spezifischen NLS-Datei.
 * Liegt unter core/nls/de/lyrmgrResources_Profile_<Name>.json
 */
function getProfileNlsPath($profile) {
    $safe = preg_replace('/[^a-zA-Z0-9_\-]/', '', $profile);
    return CORE_NLS_DIR . '/lyrmgrResources_Profile_' . $safe . '.json';
}

// ===== NLS-Ziel-Pfade: Site-Core / Group =====

/**
 * Pfad zur Site-Core NLS-Datei.
 * /www/maps/core/nls/de/lyrmgrResources.json — EINE Überladungsdatei.
 */
function getSiteCoreNlsPath() {
    return APP_CORE_NLS_DIR . '/lyrmgrResources.json';
}

/**
 * Pfad zur Group-NLS-Datei.
 * /www/maps/public/config/<group>/lyrmgrResources.json — EINE Überladungsdatei pro Gruppe.
 */
function getGroupNlsPath($group) {
    $safe = preg_replace('/[^a-zA-Z0-9_\-]/', '', $group);
    if ($safe === 'public') {
        return CONFIG_BASE . '/lyrmgrResources.json';
    }
    return CONFIG_BASE . '/' . $safe . '/lyrmgrResources.json';
}

/**
 * NLS-Datei lesen (site-core oder group).
 * Gibt den JSON-Inhalt als Array zurück.
 */
function loadNlsFile($target, $group = null) {
    if ($target === 'site-core') {
        $path = getSiteCoreNlsPath();
    } elseif ($target === 'group' && $group) {
        $path = getGroupNlsPath($group);
    } else {
        return ['success' => false, 'error' => 'Ungültiges Ziel: ' . $target];
    }
    $data = [];
    $exists = file_exists($path);
    if ($exists) {
        $data = json_decode(file_get_contents($path), true) ?: [];
    }
    return [
        'success' => true,
        'target'  => $target,
        'group'   => $group,
        'path'    => $path,
        'exists'  => $exists,
        'entries' => count($data),
        'aliases' => $data
    ];
}

/**
 * NLS-Einträge in Ziel-Datei speichern (merge).
 * Bestehende Einträge bleiben erhalten, neue werden ergänzt/überschrieben.
 * Leere Werte ('') entfernen den Eintrag.
 */
function saveNlsEntries($target, $aliases, $group = null) {
    if ($target === 'site-core') {
        $path = getSiteCoreNlsPath();
    } elseif ($target === 'group' && $group) {
        $path = getGroupNlsPath($group);
    } else {
        return ['saved' => false, 'error' => 'Ungültiges Ziel: ' . $target];
    }

    $dir = dirname($path);
    if (!is_dir($dir)) {
        return ['saved' => false, 'error' => 'Verzeichnis existiert nicht: ' . $dir];
    }

    // Bestehende Datei lesen
    $existing = [];
    if (file_exists($path)) {
        $existing = json_decode(file_get_contents($path), true) ?: [];
        // Backup erstellen
        ensureDirs();
        $ts = date('Ymd_His');
        $label = ($target === 'group') ? 'group_' . preg_replace('/[^a-zA-Z0-9_\-]/', '', $group) : 'site_core';
        $backupPath = BACKUP_DIR . '/lyrmgrResources_' . $label . '_' . $ts . '.json';
        @copy($path, $backupPath);
    }

    // Merge: neue Einträge ergänzen/überschreiben, leere entfernen
    $added = 0;
    $updated = 0;
    $removed = 0;
    foreach ($aliases as $key => $value) {
        if ($value === '' || $value === null) {
            if (isset($existing[$key])) {
                unset($existing[$key]);
                $removed++;
            }
        } elseif (isset($existing[$key])) {
            if ($existing[$key] !== $value) {
                $existing[$key] = $value;
                $updated++;
            }
        } else {
            $existing[$key] = $value;
            $added++;
        }
    }

    $json = json_encode($existing, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) {
        return ['saved' => false, 'error' => 'JSON encode Fehler: ' . json_last_error_msg()];
    }

    $bytes = @file_put_contents($path, $json);
    if ($bytes === false) {
        $err = error_get_last();
        return ['saved' => false, 'error' => 'Schreiben fehlgeschlagen: ' . ($err ? $err['message'] : 'unbekannt')];
    }

    return [
        'saved'     => true,
        'target'    => $target,
        'group'     => $group,
        'path'      => $path,
        'bytes'     => $bytes,
        'entries'   => count($existing),
        'added'     => $added,
        'updated'   => $updated,
        'removed'   => $removed,
        'timestamp' => date('Y-m-d H:i:s')
    ];
}

/**
 * Profil-NLS speichern.
 * Schreibt lyrmgrResources_Profile_<Name>.json in core/nls/de/
 */
function saveProfileNls($profile, $data) {
    $path = getProfileNlsPath($profile);
    $dir = dirname($path);
    if (!is_dir($dir)) {
        return ['saved' => false, 'error' => 'NLS-Verzeichnis existiert nicht: ' . $dir];
    }

    // Backup falls vorhanden
    if (file_exists($path)) {
        ensureDirs();
        $ts = date('Ymd_His');
        $safe = preg_replace('/[^a-zA-Z0-9_\-]/', '', $profile);
        $backupPath = BACKUP_DIR . '/lyrmgrResources_Profile_' . $safe . '_' . $ts . '.json';
        @copy($path, $backupPath);
    }

    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) {
        return ['saved' => false, 'error' => 'JSON encode Fehler: ' . json_last_error_msg()];
    }

    $bytes = @file_put_contents($path, $json);
    if ($bytes === false) {
        $err = error_get_last();
        return ['saved' => false, 'error' => 'Schreiben fehlgeschlagen: ' . ($err ? $err['message'] : 'unbekannt')];
    }

    return [
        'saved'     => true,
        'profile'   => $profile,
        'path'      => $path,
        'bytes'     => $bytes,
        'entries'   => count($data),
        'timestamp' => date('Y-m-d H:i:s')
    ];
}

// ===== PROFIL-LEGENDRESOURCES =====

/**
 * Pfad zur Profil-spezifischen legendResources-Datei.
 * Liegt unter core/nls/de/legendResources_Profile_<Name>.json
 */
function getProfileLegendPath($profile) {
    $safe = preg_replace('/[^a-zA-Z0-9_\-]/', '', $profile);
    return CORE_NLS_DIR . '/legendResources_Profile_' . $safe . '.json';
}

/**
 * Profil-legendResources speichern.
 * Schreibt legendResources_Profile_<Name>.json in core/nls/de/
 */
function saveProfileLegend($profile, $data) {
    $path = getProfileLegendPath($profile);
    $dir = dirname($path);
    if (!is_dir($dir)) {
        return ['saved' => false, 'error' => 'NLS-Verzeichnis existiert nicht: ' . $dir];
    }

    // Backup falls vorhanden
    if (file_exists($path)) {
        ensureDirs();
        $ts = date('Ymd_His');
        $safe = preg_replace('/[^a-zA-Z0-9_\-]/', '', $profile);
        $backupPath = BACKUP_DIR . '/legendResources_Profile_' . $safe . '_' . $ts . '.json';
        @copy($path, $backupPath);
    }

    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) {
        return ['saved' => false, 'error' => 'JSON encode Fehler: ' . json_last_error_msg()];
    }

    $bytes = @file_put_contents($path, $json);
    if ($bytes === false) {
        $err = error_get_last();
        return ['saved' => false, 'error' => 'Schreiben fehlgeschlagen: ' . ($err ? $err['message'] : 'unbekannt')];
    }

    return [
        'saved'     => true,
        'profile'   => $profile,
        'path'      => $path,
        'bytes'     => $bytes,
        'entries'   => count($data),
        'timestamp' => date('Y-m-d H:i:s')
    ];
}

/**
 * Deploy: Stage-Profil nach Produktiv-Profil kopieren.
 * Liest [profil]-stage/lyrmgr.conf und publiziert jeden Block
 * ins Ziel-Profil via publishLyrmgrBlock().
 */
function deployLyrmgr($stageProfile, $targetProfile, $editor) {
    // Validiere: stageProfile muss auf -stage enden
    if (!preg_match('/-stage$/', $stageProfile)) {
        return ['success' => false, 'error' => 'Stage-Profil muss auf "-stage" enden: ' . $stageProfile];
    }
    // Ableitung: marco-stage → marco
    $expected = preg_replace('/-stage$/', '', $stageProfile);
    if ($targetProfile !== $expected) {
        return ['success' => false, 'error' => 'Ziel-Profil "' . $targetProfile . '" stimmt nicht mit Stage "' . $stageProfile . '" überein (erwartet: "' . $expected . '")'];
    }

    // Stage-Datei laden
    $stageData = loadLyrmgrConf($stageProfile);
    if (!$stageData['exists']) {
        return ['success' => false, 'error' => 'Stage-Datei nicht gefunden: ' . $stageData['path']];
    }
    if (isset($stageData['error'])) {
        return ['success' => false, 'error' => 'Stage-Datei Parse-Fehler: ' . $stageData['error']];
    }

    // Validierung: JSON muss gültig und nicht leer sein
    $confData = $stageData['data'];
    if (empty($confData)) {
        return ['success' => false, 'error' => 'Stage-Datei ist leer'];
    }

    // Jeden Block einzeln publizieren (mit Backup)
    $published = [];
    $errors = [];
    foreach ($confData as $lyrmgrKey => $blockData) {
        $result = publishLyrmgrBlock($targetProfile, $lyrmgrKey, $blockData, $editor);
        if ($result['published']) {
            $published[] = $lyrmgrKey;
        } else {
            $errors[] = $lyrmgrKey . ': ' . $result['error'];
        }
    }

    if (!empty($errors)) {
        return [
            'success'   => false,
            'error'     => 'Deploy teilweise fehlgeschlagen: ' . implode('; ', $errors),
            'published' => $published,
            'errors'    => $errors
        ];
    }

    return [
        'success'       => true,
        'stageProfile'  => $stageProfile,
        'targetProfile' => $targetProfile,
        'published'     => $published,
        'blocksCount'   => count($published),
        'editor'        => $editor,
        'targetPath'    => getConfigPath($targetProfile),
        'timestamp'     => date('Y-m-d H:i:s')
    ];
}

// =====================================================================
// AGS → MapPlus Roh-Konfiguration (ags2mapplus API)
// =====================================================================
define('AGS_API_BASE', 'https://www.gis-daten.ch/gapi/ags2mapplus');
define('RAW_CONF_DIR', TnetTmpPaths::getRoot() . '/raw-conf');
define('IMPORT_TO_CORE_DIR', TnetTmpPaths::agsImport('ImportToCore'));
define('QMAP_DIR', CLIENT_DATA_ROOT . '/qmap');
define('QMAP_BASE_URL', '/qmap');

function getFastApiTarget() {
    return APP_BASE_PATH === '/maps-dev' ? 'dev' : 'prod';
}

function agsApiUrl($path, $query = []) {
    $query['target'] = getFastApiTarget();
    return AGS_API_BASE . $path . '?' . http_build_query($query);
}

// =====================================================================
// QGIS Server — Projektliste und WMS GetCapabilities
// =====================================================================

/**
 * QGIS-Projekte aus QMAP_DIR rekursiv auflisten (.qgs, .qgz)
 */
function listQgisProjects() {
    if (!is_dir(QMAP_DIR)) {
        return ['success' => false, 'error' => 'QMAP-Verzeichnis nicht gefunden: ' . QMAP_DIR];
    }

    $projects = [];
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator(QMAP_DIR, RecursiveDirectoryIterator::SKIP_DOTS),
        RecursiveIteratorIterator::LEAVES_ONLY
    );

    foreach ($iterator as $file) {
        $ext = strtolower($file->getExtension());
        if ($ext !== 'qgs' && $ext !== 'qgz') continue;

        $fullPath  = $file->getPathname();
        $relPath   = substr($fullPath, strlen(QMAP_DIR) + 1);
        // Pfad ohne Extension für die WMS-URL
        $nameNoExt = preg_replace('/\.(qgs|qgz)$/i', '', $relPath);
        $wmsUrl    = QMAP_BASE_URL . '/' . $nameNoExt;
        // Ordner-Teil als Kürzel (erstes Verzeichnis)
        $parts     = explode('/', $relPath);
        $folder    = count($parts) > 1 ? $parts[0] : '';

        $projects[] = [
            'name'     => $file->getBasename('.' . $ext),
            'file'     => $file->getFilename(),
            'relPath'  => $relPath,
            'folder'   => $folder,
            'format'   => $ext,
            'size'     => $file->getSize(),
            'modified' => date('Y-m-d H:i:s', $file->getMTime()),
            'wmsUrl'   => $wmsUrl,
        ];
    }

    usort($projects, function($a, $b) {
        return strcmp($a['folder'] . '/' . $a['name'], $b['folder'] . '/' . $b['name']);
    });

    return ['success' => true, 'projects' => $projects];
}

/**
 * WMS GetCapabilities eines QGIS-Projekts abrufen und Layer parsen
 */
function getQgisCapabilities($wmsUrl) {
    $capsUrl = 'https://' . $_SERVER['HTTP_HOST'] . $wmsUrl . '?SERVICE=WMS&REQUEST=GetCapabilities';

    $ch = curl_init($capsUrl);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ]);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlErr  = curl_error($ch);
    curl_close($ch);

    if ($curlErr) {
        return ['success' => false, 'error' => 'cURL-Fehler: ' . $curlErr];
    }
    if ($httpCode !== 200) {
        return ['success' => false, 'error' => 'HTTP ' . $httpCode . ' von QGIS Server'];
    }

    // XML parsen
    libxml_use_internal_errors(true);
    $xml = simplexml_load_string($response);
    if (!$xml) {
        $errors = libxml_get_errors();
        libxml_clear_errors();
        $msg = $errors ? $errors[0]->message : 'Ungültiges XML';
        return ['success' => false, 'error' => 'XML-Parse-Fehler: ' . trim($msg)];
    }

    // WMS Capabilities Namespace registrieren
    $ns = $xml->getNamespaces(true);

    // Service-Metadaten
    $service = [];
    if (isset($xml->Service)) {
        $svc = $xml->Service;
        $service = [
            'title'    => (string)$svc->Title,
            'abstract' => (string)$svc->Abstract,
        ];
    }

    // Layer rekursiv extrahieren
    $layers = [];
    if (isset($xml->Capability->Layer)) {
        extractWmsLayers($xml->Capability->Layer, $layers, 0);
    }

    return [
        'success' => true,
        'service' => $service,
        'layers'  => $layers,
        'url'     => $capsUrl,
    ];
}

/**
 * WMS-Layer aus GetCapabilities rekursiv extrahieren
 */
function extractWmsLayers($layerNode, &$layers, $depth) {
    $queryable = (string)$layerNode['queryable'] === '1';
    $name  = (string)$layerNode->Name;
    $title = (string)$layerNode->Title;

    if ($name !== '') {
        $layer = [
            'name'      => $name,
            'title'     => $title,
            'abstract'  => (string)$layerNode->Abstract,
            'queryable' => $queryable,
            'depth'     => $depth,
        ];
        // CRS/SRS sammeln
        $crsList = [];
        foreach ($layerNode->CRS as $crs) { $crsList[] = (string)$crs; }
        foreach ($layerNode->SRS as $srs) { $crsList[] = (string)$srs; }
        if ($crsList) $layer['crs'] = $crsList;

        // BoundingBox
        foreach ($layerNode->BoundingBox as $bb) {
            if ((string)$bb['CRS'] === 'EPSG:2056' || (string)$bb['SRS'] === 'EPSG:2056') {
                $layer['bbox'] = [
                    (float)$bb['minx'], (float)$bb['miny'],
                    (float)$bb['maxx'], (float)$bb['maxy']
                ];
                break;
            }
        }

        // Style / LegendURL
        if (isset($layerNode->Style)) {
            $style = $layerNode->Style;
            if (isset($style->LegendURL->OnlineResource)) {
                $attrs = $style->LegendURL->OnlineResource->attributes('http://www.w3.org/1999/xlink');
                $layer['legendUrl'] = (string)$attrs['href'];
            }
        }

        $layers[] = $layer;
    }

    // Sub-Layer rekursiv
    foreach ($layerNode->Layer as $child) {
        extractWmsLayers($child, $layers, $depth + 1);
    }
}

/**
 * QGIS-Projekte exportieren: FastAPI-Endpoint aufrufen, ZIP entpacken in raw-conf
 */
function exportQgisProjects($projekte) {
    set_time_limit(0);

    if (!is_array($projekte) || count($projekte) === 0) {
        return ['success' => false, 'error' => 'Keine Projekte angegeben'];
    }

    // Beschreibbares Verzeichnis ermitteln
    $rawConfDir = getWritableRawConfDir();
    if ($rawConfDir === false) {
        return ['success' => false, 'error' => 'Verzeichnis nicht beschreibbar: ' . RAW_CONF_DIR];
    }

    // FastAPI-Endpoint aufrufen
    $url = agsApiUrl('/qgis-conf-export');
    $payload = json_encode(['projekte' => $projekte]);

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json', 'Accept: application/zip'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 300,
        CURLOPT_CONNECTTIMEOUT => 30,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ]);
    $zipData = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlErr  = curl_error($ch);
    curl_close($ch);

    if ($zipData === false || $httpCode === 0) {
        return ['success' => false, 'error' => 'API nicht erreichbar: ' . ($curlErr ?: 'Verbindung fehlgeschlagen')];
    }
    if ($httpCode >= 400) {
        $errBody = @json_decode($zipData, true);
        $errMsg = $errBody ? json_encode($errBody, JSON_UNESCAPED_UNICODE) : 'HTTP ' . $httpCode;
        return ['success' => false, 'error' => 'API-Fehler (HTTP ' . $httpCode . '): ' . $errMsg];
    }

    // ZIP-Validierung
    if (strlen($zipData) < 4 || substr($zipData, 0, 2) !== 'PK') {
        $errData = json_decode($zipData, true);
        $errMsg = $errData ? json_encode($errData, JSON_UNESCAPED_UNICODE) : 'Kein gültiges ZIP erhalten (' . strlen($zipData) . ' Bytes)';
        return ['success' => false, 'error' => $errMsg];
    }

    // ZIP temporär speichern und entpacken
    $tmpZip = sys_get_temp_dir() . '/qgis_export_' . uniqid() . '.zip';
    file_put_contents($tmpZip, $zipData);

    $zip = new ZipArchive();
    $openResult = $zip->open($tmpZip);
    if ($openResult !== true) {
        @unlink($tmpZip);
        return ['success' => false, 'error' => 'ZIP konnte nicht geöffnet werden (Code: ' . $openResult . ')'];
    }

    $extractedFiles = [];
    $failedFiles = [];
    $ts = date('Ymd_His');

    for ($i = 0; $i < $zip->numFiles; $i++) {
        $entryName = $zip->getNameIndex($i);
        if (substr($entryName, -1) === '/') continue;

        $content = $zip->getFromIndex($i);
        if ($content === false) continue;

        $targetPath = $rawConfDir . '/qgis/' . $entryName;
        $targetDir = dirname($targetPath);
        if (!is_dir($targetDir)) {
            if (!@mkdir($targetDir, 0777, true)) {
                $failedFiles[] = ['file' => $entryName, 'error' => 'Verzeichnis konnte nicht erstellt werden'];
                continue;
            }
        }

        // Backup
        if (file_exists($targetPath)) {
            $backupPath = $targetPath . '.' . $ts . '.bak';
            @copy($targetPath, $backupPath);
        }

        $bytes = @file_put_contents($targetPath, $content);
        if ($bytes === false) {
            $err = error_get_last();
            $failedFiles[] = ['file' => $entryName, 'error' => $err ? $err['message'] : 'Schreibfehler'];
        } else {
            $extractedFiles[] = ['file' => $entryName, 'bytes' => $bytes, 'path' => $targetPath];
        }
    }

    $zip->close();
    @unlink($tmpZip);

    if (count($extractedFiles) === 0 && count($failedFiles) > 0) {
        return ['success' => false, 'error' => 'Keine Datei konnte gespeichert werden', 'failedFiles' => $failedFiles];
    }

    $result = [
        'success'   => true,
        'services'  => array_map(function($p) { return 'qgis_' . strtolower($p['folder']) . '_' . strtolower($p['file']); }, $projekte),
        'zipSize'   => strlen($zipData),
        'files'     => $extractedFiles,
        'directory' => toDisplayTmpPath($rawConfDir . '/qgis'),
        'timestamp' => date('Y-m-d H:i:s'),
    ];
    if (count($failedFiles) > 0) {
        $result['failedFiles'] = $failedFiles;
    }

    // Import-Metadaten in DB speichern (analog AGS)
    // Alte Einträge löschen + neu einfügen, damit imported_at aktualisiert wird
    try {
        $pdo = Database::getConnection();
        $delStmt = $pdo->prepare(
            "DELETE FROM mapplusconf.ags_import_history WHERE service_name = ?"
        );
        $insStmt = $pdo->prepare(
            "INSERT INTO mapplusconf.ags_import_history (service_name, hash, published_at, published_by)
             VALUES (?, ?, ?, ?)"
        );
        foreach ($projekte as $p) {
            $svcName = 'qgis_' . strtolower($p['folder']) . '_' . strtolower($p['file']);
            $delStmt->execute([$svcName]);
            $insStmt->execute([
                $svcName,
                null,
                null,
                null
            ]);
        }
    } catch (Exception $e) {
        $result['metaWarning'] = 'Import-Metadaten konnten nicht in DB gespeichert werden: ' . $e->getMessage();
    }

    return $result;
}

/**
 * Verfügbare AGS-Dienste von der externen API abrufen
 */
function getAgsServices() {
    $details = isset($_GET['details']) && $_GET['details'] === 'true';
    $url = agsApiUrl('/get-ags-services', $details ? ['details' => 'true'] : []);

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_HTTPHEADER     => ['Accept: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ]);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlErr  = curl_error($ch);
    curl_close($ch);

    if ($response === false || $httpCode === 0) {
        return ['success' => false, 'error' => 'API nicht erreichbar: ' . ($curlErr ?: 'Verbindung fehlgeschlagen')];
    }
    if ($httpCode >= 400) {
        return ['success' => false, 'error' => 'API-Fehler (HTTP ' . $httpCode . ')'];
    }
    $data = json_decode($response, true);
    if (!$data) {
        return ['success' => false, 'error' => 'Ungültige API-Antwort (kein JSON)'];
    }
    return ['success' => true, 'data' => $data];
}

/**
 * Raw-Conf Quell-Buckets unterhalb von RAW_CONF_DIR.
 */
function rawConfSourceBuckets() {
    return ['ags', 'qgis', 'mapplus'];
}

/**
 * Entfernt den optionalen Quell-Bucket-Präfix aus einem relativen Raw-Conf-Pfad.
 */
function stripRawConfSourcePrefix($relPath) {
    $relPath = str_replace('\\', '/', (string)$relPath);
    $parts = explode('/', $relPath);
    if (count($parts) >= 2 && in_array($parts[0], rawConfSourceBuckets(), true)) {
        return implode('/', array_slice($parts, 1));
    }
    return $relPath;
}

/**
 * Sucht das Service-Verzeichnis in flat- und bucket-Struktur.
 */
function resolveRawConfServiceDir($rawDir, $serviceKey) {
    $candidates = [$rawDir . '/' . $serviceKey];
    foreach (rawConfSourceBuckets() as $bucket) {
        $candidates[] = $rawDir . '/' . $bucket . '/' . $serviceKey;
    }
    foreach ($candidates as $path) {
        if (is_dir($path)) return $path;
    }
    return null;
}

/**
 * Sammelt alle Raw-Conf-Dateien zu einem Service-Key rekursiv.
 */
function collectRawConfFilesByService($rawDir, $serviceKey) {
    $files = [];
    if (!is_dir($rawDir)) return $files;
    $it = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($rawDir, RecursiveDirectoryIterator::SKIP_DOTS),
        RecursiveIteratorIterator::LEAVES_ONLY
    );
    foreach ($it as $entry) {
        if (!$entry->isFile()) continue;
        $fullPath = $entry->getPathname();
        $relPath = str_replace('\\', '/', str_replace($rawDir . '/', '', $fullPath));
        $normRel = stripRawConfSourcePrefix($relPath);
        $parts = explode('/', $normRel);
        $svcFromPath = null;
        if (count($parts) >= 3) {
            $svcFromPath = $parts[0] . '/' . $parts[1];
        } elseif (count($parts) === 2) {
            $svcFromPath = $parts[0];
        } elseif (count($parts) === 1) {
            $svcFromPath = extractServiceFromFilename($parts[0]);
        }
        if ($svcFromPath === $serviceKey) {
            $files[] = new SplFileInfo($fullPath);
        }
    }
    return $files;
}

/**
 * Ermittelt den tatsächlich nutzbaren Pfad für raw-conf.
 * RAW_CONF_DIR liegt unter TNET_TMP_ROOT/raw-conf — dieses Verzeichnis
 * gehört www-data (gid 33) und ist dauerhaft beschreibbar.
 * Cacht das Ergebnis für den aktuellen Request.
 */
function getWritableRawConfDir() {
    static $resolved = null;
    if ($resolved !== null) return $resolved;

    // Prüfe ob RAW_CONF_DIR existiert und beschreibbar ist
    if (is_dir(RAW_CONF_DIR) && is_writable(RAW_CONF_DIR)) {
        $resolved = RAW_CONF_DIR;
        return $resolved;
    }

    // Versuch zu erstellen (Parent /tmp/ muss beschreibbar sein)
    if (!is_dir(RAW_CONF_DIR)) {
        if (@mkdir(RAW_CONF_DIR, 0775, true)) {
            $resolved = RAW_CONF_DIR;
            return $resolved;
        }
    }
    // Versuch chmod falls Verzeichnis existiert aber nicht beschreibbar
    @chmod(RAW_CONF_DIR, 0777);
    clearstatcache(true, RAW_CONF_DIR);
    if (is_dir(RAW_CONF_DIR) && is_writable(RAW_CONF_DIR)) {
        $resolved = RAW_CONF_DIR;
        return $resolved;
    }

    // Kein Pfad beschreibbar
    $resolved = false;
    return false;
}

/**
 * AGS-Dienste exportieren (ZIP von externer API laden, entpacken, in raw-conf speichern)
 */
function exportAgsServices($dienstnamen, $serviceDetails = []) {
    // PHP-Zeitlimit aufheben — cURL-Timeout (15 Min) kontrolliert die max. Dauer
    set_time_limit(0);

    if (!is_array($dienstnamen) || count($dienstnamen) === 0) {
        return ['success' => false, 'error' => 'Keine Dienstnamen angegeben'];
    }

    // Beschreibbares Verzeichnis ermitteln
    $rawConfDir = getWritableRawConfDir();
    if ($rawConfDir === false) {
        return ['success' => false, 'error' => 'Verzeichnis nicht beschreibbar: ' . RAW_CONF_DIR];
    }

    // Externe API aufrufen → ZIP (cURL für bessere Fehler-Meldungen)
    $url = agsApiUrl('/mapplus-conf-export');
    $payload = json_encode(['dienstnamen' => $dienstnamen]);

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json', 'Accept: application/zip'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 900, // 15 Minuten
        CURLOPT_CONNECTTIMEOUT => 30,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ]);
    $zipData = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlErr  = curl_error($ch);
    curl_close($ch);

    if ($zipData === false || $httpCode === 0) {
        return ['success' => false, 'error' => 'API nicht erreichbar: ' . ($curlErr ?: 'Verbindung fehlgeschlagen')];
    }
    if ($httpCode >= 400) {
        // Versuch JSON-Fehlermeldung zu extrahieren
        $errBody = @json_decode($zipData, true);
        $errMsg = $errBody ? json_encode($errBody, JSON_UNESCAPED_UNICODE) : 'HTTP ' . $httpCode;
        return ['success' => false, 'error' => 'API-Fehler (HTTP ' . $httpCode . '): ' . $errMsg];
    }

    // Prüfen ob es tatsächlich ein ZIP ist (Magic Bytes: PK\x03\x04)
    if (strlen($zipData) < 4 || substr($zipData, 0, 2) !== 'PK') {
        // Evtl. JSON-Fehler zurückgegeben
        $errData = json_decode($zipData, true);
        $errMsg = $errData ? json_encode($errData, JSON_UNESCAPED_UNICODE) : 'Kein gültiges ZIP erhalten (' . strlen($zipData) . ' Bytes)';
        return ['success' => false, 'error' => $errMsg];
    }

    // ZIP temporär speichern
    $tmpZip = sys_get_temp_dir() . '/ags_export_' . uniqid() . '.zip';
    file_put_contents($tmpZip, $zipData);

    // ZIP entpacken
    $zip = new ZipArchive();
    $openResult = $zip->open($tmpZip);
    if ($openResult !== true) {
        @unlink($tmpZip);
        return ['success' => false, 'error' => 'ZIP konnte nicht geöffnet werden (Code: ' . $openResult . ')'];
    }

    $extractedFiles = [];
    $failedFiles = [];
    $ts = date('Ymd_His');

    for ($i = 0; $i < $zip->numFiles; $i++) {
        $entryName = $zip->getNameIndex($i);
        // Verzeichnis-Einträge überspringen
        if (substr($entryName, -1) === '/') continue;

        $content = $zip->getFromIndex($i);
        if ($content === false) continue;

        // Zielverzeichnis: raw-conf/ags/<Unterordner>
        $targetPath = $rawConfDir . '/ags/' . $entryName;
        $targetDir = dirname($targetPath);
        if (!is_dir($targetDir)) {
            if (!@mkdir($targetDir, 0777, true)) {
                $failedFiles[] = ['file' => $entryName, 'error' => 'Unterverzeichnis konnte nicht erstellt werden: ' . $targetDir];
                continue;
            }
        }

        // Bestehende Datei sichern (Backup mit Timestamp)
        if (file_exists($targetPath)) {
            $backupPath = $targetPath . '.' . $ts . '.bak';
            @copy($targetPath, $backupPath);
        }

        $bytes = @file_put_contents($targetPath, $content);
        if ($bytes === false) {
            $err = error_get_last();
            $failedFiles[] = ['file' => $entryName, 'error' => $err ? $err['message'] : 'file_put_contents fehlgeschlagen'];
        } else {
            $extractedFiles[] = [
                'file'  => $entryName,
                'bytes' => $bytes,
                'path'  => $targetPath
            ];
        }
    }

    $zip->close();
    @unlink($tmpZip);

    // Wenn ALLE fehlgeschlagen sind → Fehler
    if (count($extractedFiles) === 0 && count($failedFiles) > 0) {
        return ['success' => false, 'error' => 'Keine Datei konnte gespeichert werden', 'failedFiles' => $failedFiles];
    }

    $result = [
        'success'   => true,
        'services'  => $dienstnamen,
        'zipSize'   => strlen($zipData),
        'files'     => $extractedFiles,
        'directory' => toDisplayTmpPath($rawConfDir . '/ags'),
        'timestamp' => date('Y-m-d H:i:s')
    ];
    // Teilfehler melden falls vorhanden
    if (count($failedFiles) > 0) {
        $result['failedFiles'] = $failedFiles;
        $result['warning'] = count($failedFiles) . ' Datei(en) konnten nicht gespeichert werden';
    }

    // Import-Metadaten in DB speichern (Hash, Zeitstempel etc.)
    // Alte Einträge löschen + neu einfügen, damit imported_at aktualisiert wird
    try {
        $pdo = Database::getConnection();
        $delStmt = $pdo->prepare(
            "DELETE FROM mapplusconf.ags_import_history WHERE service_name = ?"
        );
        $insStmt = $pdo->prepare(
            "INSERT INTO mapplusconf.ags_import_history (service_name, hash, published_at, published_by)
             VALUES (?, ?, ?, ?)"
        );
        foreach ($dienstnamen as $svcName) {
            $sd = isset($serviceDetails[$svcName]) ? $serviceDetails[$svcName] : [];
            $delStmt->execute([$svcName]);
            $insStmt->execute([
                $svcName,
                isset($sd['hash'])         ? $sd['hash']         : null,
                isset($sd['published_at']) ? $sd['published_at'] : null,
                isset($sd['published_by']) ? $sd['published_by'] : null
            ]);
        }
    } catch (Exception $e) {
        // DB-Fehler nicht fatal — Import-Dateien sind bereits gespeichert
        $result['metaWarning'] = 'Import-Metadaten konnten nicht in DB gespeichert werden: ' . $e->getMessage();
    }

    return $result;
}

/**
 * Prüft ob Dateiname ein AGS-Backup ist.
 */
function isRawConfBackupFile($filename) {
    return preg_match('/\.\d{8}_\d{6}\.bak$/', $filename) === 1;
}

/**
 * Entfernt Backup-Suffix aus Dateinamen.
 */
function stripRawConfBackupSuffix($filename) {
    return preg_replace('/\.\d{8}_\d{6}\.bak$/', '', $filename);
}

/**
 * Inhalt von data/raw-conf auflisten (rekursiv, nach Service gruppiert)
 * Erkennt Service-Namen aus Dateinamen-Pattern:
 *   layers_TNET(QGIS)?_<SVC>.conf, lyrmgrResources_TNET(QGIS)?_<SVC>.json,
 *   maptipsResources_TNET(QGIS)?_<SVC>.json, maptips_TNET(QGIS)?_<SVC>.conf,
 *   <SVC>_Layerstruktur.xlsx, merged_Layerstruktur.xlsx → _merged
 */
function listRawConf($includeBackups = false, $backupOnly = false) {
    $rawConfDir = getWritableRawConfDir();
    // Auch nicht-beschreibbare Verzeichnisse listen (read-only OK)
    if ($rawConfDir === false) $rawConfDir = RAW_CONF_DIR;
    if (!is_dir($rawConfDir)) {
        return ['exists' => false, 'files' => [], 'services' => []];
    }

    $files = [];
    $services = [];
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($rawConfDir, RecursiveDirectoryIterator::SKIP_DOTS),
        RecursiveIteratorIterator::LEAVES_ONLY
    );
    foreach ($iterator as $file) {
        $fileName = $file->getFilename();
        $isBackup = isRawConfBackupFile($fileName);
        if ($backupOnly && !$isBackup) continue;
        if (!$includeBackups && $isBackup) continue;
        // Nur fachliche Konfigurationsdateien anzeigen (conf/json).
        // Bei Backups die Original-Endung vor .bak prüfen.
        $effectiveName = $isBackup ? stripRawConfBackupSuffix($fileName) : $fileName;
        $ext = strtolower(pathinfo($effectiveName, PATHINFO_EXTENSION));
        if (!in_array($ext, ['conf', 'json'], true)) continue;

        $relPath = str_replace($rawConfDir . '/', '', $file->getPathname());
        $relPath = str_replace('\\', '/', $relPath); // Windows-Pfade normalisieren
        $normRelPath = stripRawConfSourcePrefix($relPath);

        // Service-Key ermitteln
        $parts = explode('/', $normRelPath);
        if (count($parts) >= 3) {
            // 3-Ebenen-Struktur: group/service/datei → Key = group/service
            $svcKey = $parts[0] . '/' . $parts[1];
        } elseif (count($parts) == 2) {
            // 2-Ebenen-Struktur: service_dir/datei → Key = service_dir
            $svcKey = $parts[0];
        } else {
            // Flache Datei: Service aus Dateiname extrahieren
            $baseName = $isBackup ? stripRawConfBackupSuffix($parts[0]) : $parts[0];
            $svcKey = extractServiceFromFilename($baseName);
        }

        $fileInfo = [
            'file'     => $relPath,
            'normFile' => $normRelPath,
            'size'     => $file->getSize(),
            'modified' => date('Y-m-d H:i:s', $file->getMTime()),
            'isBackup' => $isBackup
        ];
        $files[] = $fileInfo;

        if (!isset($services[$svcKey])) {
            $services[$svcKey] = ['service' => $svcKey, 'files' => [], 'totalSize' => 0];
        }
        $services[$svcKey]['files'][] = $fileInfo;
        $services[$svcKey]['totalSize'] += $file->getSize();
    }

    // Nach Service-Key sortieren
    ksort($services);
    $servicesList = array_values($services);

    usort($files, function($a, $b) { return strcmp($a['file'], $b['file']); });

    return [
        'exists'    => true,
        'directory' => toDisplayTmpPath($rawConfDir),
        'includeBackups' => (bool)$includeBackups,
        'backupOnly' => (bool)$backupOnly,
        'files'     => $files,
        'services'  => $servicesList
    ];
}

/**
 * Service-Name aus einem flachen Dateinamen extrahieren
 * Pattern: layers_TNET(QGIS)?_<SVC>.conf, lyrmgrResources_TNET(QGIS)?_<SVC>.json, etc.
 */
function extractServiceFromFilename($filename) {
    // TNETQGIS: QGIS_ Präfix im Service-Key behalten (Unterscheidung zu AGS)
    if (preg_match('/^layers_TNETQGIS_(.+)\.conf$/i', $filename, $m)) return 'qgis_' . strtolower($m[1]);
    if (preg_match('/^lyrmgrResources_TNETQGIS_(.+)\.json$/i', $filename, $m)) return 'qgis_' . strtolower($m[1]);
    if (preg_match('/^maptipsResources_TNETQGIS_(.+)\.json$/i', $filename, $m)) return 'qgis_' . strtolower($m[1]);
    if (preg_match('/^legendResources_TNETQGIS_(.+)\.json$/i', $filename, $m)) return 'qgis_' . strtolower($m[1]);
    if (preg_match('/^maptips_TNETQGIS_(.+)\.conf$/i', $filename, $m)) return 'qgis_' . strtolower($m[1]);
    // TNET (AGS): Kein Präfix
    if (preg_match('/^layers_TNET_(.+)\.conf$/i', $filename, $m)) return $m[1];
    if (preg_match('/^lyrmgrResources_TNET_(.+)\.json$/i', $filename, $m)) return $m[1];
    if (preg_match('/^maptipsResources_TNET_(.+)\.json$/i', $filename, $m)) return $m[1];
    if (preg_match('/^legendResources_TNET_(.+)\.json$/i', $filename, $m)) return $m[1];
    if (preg_match('/^maptips_TNET_(.+)\.conf$/i', $filename, $m)) return $m[1];
    // <SVC>_Layerstruktur.xlsx (aber nicht merged_Layerstruktur.xlsx)
    if (preg_match('/^(.+)_Layerstruktur\.xlsx$/i', $filename, $m) && strtolower($m[1]) !== 'merged') return $m[1];
    // merged_Layerstruktur.xlsx → globale Datei
    if (preg_match('/^merged_/i', $filename)) return '_merged';
    // Unbekanntes Pattern: Dateiname selbst als Key
    return $filename;
}

/**
 * Alle Dateien eines Services in data/raw-conf löschen
 * Unterstützt sowohl Unterverzeichnis-basierte als auch flache Strukturen
 */
function deleteRawConfService($serviceKey) {
    // Sicherheit: Path-Traversal verhindern
    if (strpos($serviceKey, '..') !== false || strpos($serviceKey, '\\') !== false) {
        return ['success' => false, 'error' => 'Ungültiger Service-Key'];
    }

    $rawConfDir = getWritableRawConfDir();
    if ($rawConfDir === false) $rawConfDir = RAW_CONF_DIR;
    $servicePath = resolveRawConfServiceDir($rawConfDir, $serviceKey);
    $realBase = realpath($rawConfDir);
    if (!$realBase) {
        return ['success' => false, 'error' => 'raw-conf Verzeichnis existiert nicht'];
    }

    $deleted = [];

    // Fall 1: Service-Key ist ein Verzeichnis (Unterordner-Struktur)
    $realPath = $servicePath ? realpath($servicePath) : false;
    if ($realPath && is_dir($realPath) && strpos($realPath, $realBase) === 0) {
        $iterator = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($realPath, RecursiveDirectoryIterator::SKIP_DOTS),
            RecursiveIteratorIterator::CHILD_FIRST
        );
        foreach ($iterator as $item) {
            if ($item->isDir()) {
                @rmdir($item->getPathname());
            } else {
                $relFile = str_replace($rawConfDir . '/', '', $item->getPathname());
                $relFile = str_replace('\\', '/', $relFile);
                $deleted[] = $relFile;
                @unlink($item->getPathname());
            }
        }
        @rmdir($realPath);

        // Übergeordnetes Verzeichnis löschen falls leer
        $parentDir = dirname($realPath);
        if ($parentDir !== $realBase && is_dir($parentDir)) {
            $remaining = @scandir($parentDir);
            if ($remaining && count($remaining) <= 2) {
                @rmdir($parentDir);
            }
        }
    }
    // Fall 2: Flache Struktur — alle Dateien löschen die zu diesem Service gehören
    else {
        $svcFiles = collectRawConfFilesByService($rawConfDir, $serviceKey);
        foreach ($svcFiles as $sf) {
            $p = $sf->getPathname();
            $rel = str_replace($rawConfDir . '/', '', str_replace('\\', '/', $p));
            $deleted[] = $rel;
            @unlink($p);
            $parent = dirname($p);
            while ($parent && $parent !== $rawConfDir && is_dir($parent)) {
                $remaining = @scandir($parent);
                if ($remaining && count($remaining) <= 2) {
                    @rmdir($parent);
                    $parent = dirname($parent);
                    continue;
                }
                break;
            }
        }
    }

    if (count($deleted) === 0) {
        return ['success' => false, 'error' => 'Keine Dateien für Service gefunden: ' . $serviceKey];
    }

    return [
        'success' => true,
        'service' => $serviceKey,
        'deleted' => $deleted,
        'count'   => count($deleted)
    ];
}

/**
 * Nur Backup-Dateien eines Services löschen.
 */
function deleteRawConfBackups($serviceKey) {
    if (strpos($serviceKey, '..') !== false || strpos($serviceKey, '\\') !== false) {
        return ['success' => false, 'error' => 'Ungültiger Service-Key'];
    }

    $rawConfDir = getWritableRawConfDir();
    if ($rawConfDir === false) $rawConfDir = RAW_CONF_DIR;
    $realBase = realpath($rawConfDir);
    if (!$realBase) {
        return ['success' => false, 'error' => 'raw-conf Verzeichnis existiert nicht'];
    }

    $deleted = [];
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($realBase, RecursiveDirectoryIterator::SKIP_DOTS),
        RecursiveIteratorIterator::LEAVES_ONLY
    );

    foreach ($iterator as $item) {
        if (!$item->isFile()) continue;

        $fileName = $item->getFilename();
        if (!isRawConfBackupFile($fileName)) continue;

        $relPath = str_replace($realBase . '/', '', $item->getPathname());
        $relPath = str_replace('\\', '/', $relPath);
        $parts = explode('/', $relPath);

        if (count($parts) >= 3) {
            $svcKey = $parts[0] . '/' . $parts[1];
        } elseif (count($parts) == 2) {
            $svcKey = $parts[0];
        } else {
            $svcKey = extractServiceFromFilename(stripRawConfBackupSuffix($parts[0]));
        }

        if ($svcKey !== $serviceKey) continue;

        if (@unlink($item->getPathname())) {
            $deleted[] = $relPath;
        }
    }

    if (count($deleted) === 0) {
        return ['success' => false, 'error' => 'Keine Backup-Dateien für Service gefunden: ' . $serviceKey];
    }

    return [
        'success' => true,
        'service' => $serviceKey,
        'deleted' => $deleted,
        'count'   => count($deleted)
    ];
}

/**
 * Einzelne Rohdatei aus data/raw-conf lesen
 */
function readRawConfFile($filePath) {
    $rawConfDir = getWritableRawConfDir();
    if ($rawConfDir === false) $rawConfDir = RAW_CONF_DIR;
    // Sicherheit: nur innerhalb von raw-conf erlaubt
    $fullPath = $rawConfDir . '/' . $filePath;
    $realPath = realpath($fullPath);
    $realBase = realpath($rawConfDir);
    if (!$realPath || !$realBase || strpos($realPath, $realBase) !== 0) {
        return ['success' => false, 'error' => 'Ungültiger Pfad'];
    }
    if (!file_exists($realPath)) {
        return ['success' => false, 'error' => 'Datei nicht gefunden: ' . $filePath];
    }
    $content = file_get_contents($realPath);
    return [
        'success' => true,
        'file'    => $filePath,
        'content' => $content,
        'size'    => strlen($content)
    ];
}

/**
 * Einzelne Rohdatei in data/raw-conf schreiben (mit automatischem Backup)
 */
function writeRawConfFile($filePath, $content) {
    $rawConfDir = getWritableRawConfDir();
    if ($rawConfDir === false) $rawConfDir = RAW_CONF_DIR;
    // Sicherheit: nur innerhalb von raw-conf erlaubt
    $fullPath = $rawConfDir . '/' . $filePath;
    // realpath() funktioniert nur wenn Datei existiert → dirname absichern
    $realBase = realpath($rawConfDir);
    $dirPart   = realpath(dirname($fullPath));
    if (!$realBase || !$dirPart || strpos($dirPart, $realBase) !== 0) {
        return ['success' => false, 'error' => 'Ungültiger Pfad'];
    }
    if (!file_exists($fullPath)) {
        return ['success' => false, 'error' => 'Datei nicht gefunden: ' . $filePath];
    }
    // Backup anlegen (gleiche Logik wie AGS-Export)
    $timestamp  = date('Ymd_His');
    $backupPath = $fullPath . '.' . $timestamp . '.bak';
    @copy($fullPath, $backupPath);
    $backupCreated = file_exists($backupPath);
    // Inhalt schreiben
    $written = file_put_contents($fullPath, $content);
    if ($written === false) {
        return ['success' => false, 'error' => 'Datei konnte nicht geschrieben werden: ' . $filePath];
    }
    return [
        'success'       => true,
        'file'          => $filePath,
        'bytes'         => $written,
        'backupCreated' => $backupCreated,
        'backup'        => $backupCreated ? ($filePath . '.' . $timestamp . '.bak') : null
    ];
}

// =====================================================================
// Staging: raw-conf-Dienste nach Typ mergen → ImportToCore
// =====================================================================

/**
 * Gewählte raw-conf-Dienste nach Typ zusammenführen und in ImportToCore/<kuerzel>/ schreiben.
 *
 * Datei-Typ-Buckets (erste passende Regel):
 *   maptipsResources_* → maptipsResources_TNET_<kuerzel>.json
 *   maptips_*          → maptips_TNET_<kuerzel>.conf
 *   lyrmgrResources_*  → lyrmgrResources_TNET_<kuerzel>.json
 *   layers_*           → layers_TNET_<kuerzel>.conf
 *   Alle anderen       → unveränderter Dateiname (letzte Version gewinnt)
 */

/**
 * Prüft ob sich raw-conf-Quelldateien seit dem letzten Staging geändert haben.
 * Vergleicht Dateigrösse und Änderungsdatum aus dem Manifest mit dem aktuellen Stand.
 * Gibt zurück: {
 *   hasChanges: bool,
 *   status: 'needs-restage'|'up-to-date'|'not-verifiable',
 *   hasBaseline: bool,
 *   changed: [{service, files: [{file, reason, old*, new*}]}],
 *   missing: [service],
 *   unverifiable: [service],
 *   message: string
 * }
 */
function checkSourceChanges($manifest, $rawDir) {
    $result = [
        'hasChanges' => false,
        'status' => 'not-verifiable',
        'hasBaseline' => false,
        'changed' => [],
        'missing' => [],
        'unverifiable' => [],
        'message' => 'Keine Quellenbasis im Staging-Manifest vorhanden'
    ];
    if (!isset($manifest['sources']) || !is_array($manifest['sources']) || count($manifest['sources']) === 0) {
        return $result;
    }

    // Flache raw-conf-Dateien einmal indizieren (für Services ohne Unterverzeichnis)
    // Key: Service (aus extractServiceFromFilename) → Liste von ['file', 'size', 'modified', 'path']
    $flatFilesByService = null;
    $ensureFlatIndex = function() use (&$flatFilesByService, $rawDir) {
        if ($flatFilesByService !== null) return;
        $flatFilesByService = [];
        if (!is_dir($rawDir)) return;
        // Rekursiv alle Dateien in root und Bucket-Verzeichnissen scannen
        $it = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($rawDir, RecursiveDirectoryIterator::SKIP_DOTS),
            RecursiveIteratorIterator::LEAVES_ONLY
        );
        foreach ($it as $file) {
            if (!$file->isFile()) continue;
            $fname = $file->getFilename();
            if (preg_match('/\.\d{8}_\d{6}\.bak$/', $fname)) continue;
            $ext = strtolower(pathinfo($fname, PATHINFO_EXTENSION));
            if (!in_array($ext, ['conf', 'json'])) continue;
            $svc = extractServiceFromFilename($fname);
            if (!isset($flatFilesByService[$svc])) $flatFilesByService[$svc] = [];
            $flatFilesByService[$svc][] = [
                'file'     => $fname,
                'size'     => $file->getSize(),
                'modified' => date('Y-m-d H:i:s', $file->getMTime()),
                'path'     => $file->getPathname()
            ];
        }
    };

    foreach ($manifest['sources'] as $src) {
        $svcKey = $src['service'];
        $svcDir = resolveRawConfServiceDir($rawDir, $svcKey);
        $isDirBased = is_dir($svcDir);

        // Flat-Index für nicht-Verzeichnis-basierte Services
        $flatCurrent = [];
        if (!$isDirBased) {
            $ensureFlatIndex();
            $flatCurrent = $flatFilesByService[$svcKey] ?? [];
            // Service existiert weder als Verzeichnis noch als flache Dateien?
            if (empty($flatCurrent)) {
                $result['missing'][] = $svcKey;
                $result['hasChanges'] = true;
                continue;
            }
        }

        // Keine sourceFiles im Manifest → kann nicht vergleichen (altes Manifest-Format)
        if (!isset($src['sourceFiles']) || !is_array($src['sourceFiles']) || count($src['sourceFiles']) === 0) {
            $result['unverifiable'][] = $svcKey;
            continue;
        }

        $result['hasBaseline'] = true;

        $changedFiles = [];
        foreach ($src['sourceFiles'] as $sf) {
            if ($isDirBased) {
                // Datei im Service-Verzeichnis suchen (rekursiv, da Unterordner möglich)
                $found = findFileRecursive($svcDir, $sf['file']);
                if ($found === null) {
                    $changedFiles[] = ['file' => $sf['file'], 'reason' => 'deleted'];
                    continue;
                }
                $currentSize = filesize($found);
                $currentMod  = date('Y-m-d H:i:s', filemtime($found));
            } else {
                // Flache Struktur: Datei im Flat-Index suchen
                $found = null;
                foreach ($flatCurrent as $fc) {
                    if ($fc['file'] === $sf['file']) { $found = $fc; break; }
                }
                if ($found === null) {
                    $changedFiles[] = ['file' => $sf['file'], 'reason' => 'deleted'];
                    continue;
                }
                $currentSize = $found['size'];
                $currentMod  = $found['modified'];
            }
            if ($currentSize !== $sf['size'] || $currentMod !== $sf['modified']) {
                $changedFiles[] = [
                    'file'        => $sf['file'],
                    'reason'      => 'modified',
                    'oldSize'     => $sf['size'],
                    'newSize'     => $currentSize,
                    'oldModified' => $sf['modified'],
                    'newModified' => $currentMod
                ];
            }
        }

        // Neue Dateien prüfen (aktuell in raw-conf aber nicht im Manifest)
        $manifestFileNames = array_column($src['sourceFiles'], 'file');
        if ($isDirBased) {
            $currentFiles = listConfFilesRecursive($svcDir);
        } else {
            $currentFiles = array_column($flatCurrent, 'file');
        }
        foreach ($currentFiles as $cf) {
            if (!in_array($cf, $manifestFileNames)) {
                $changedFiles[] = ['file' => $cf, 'reason' => 'added'];
            }
        }

        if (!empty($changedFiles)) {
            $result['changed'][] = ['service' => $svcKey, 'files' => $changedFiles];
            $result['hasChanges'] = true;
        }
    }

    if ($result['hasChanges']) {
        $result['status'] = 'needs-restage';
        $result['message'] = 'Quellen haben sich seit dem letzten Staging geändert';
    } elseif ($result['hasBaseline'] && count($result['unverifiable']) === 0) {
        $result['status'] = 'up-to-date';
        $result['message'] = 'Quellenbasis vollständig und ohne Änderungen';
    } elseif ($result['hasBaseline'] && count($result['unverifiable']) > 0) {
        $result['status'] = 'not-verifiable';
        $result['message'] = 'Teilweise ohne Vergleichsbasis: ' . implode(', ', $result['unverifiable']);
    }

    return $result;
}

/**
 * Sucht eine Datei rekursiv in einem Verzeichnis (nach Dateiname).
 */
function findFileRecursive($dir, $filename) {
    $it = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($dir, RecursiveDirectoryIterator::SKIP_DOTS),
        RecursiveIteratorIterator::LEAVES_ONLY
    );
    foreach ($it as $file) {
        if ($file->getFilename() === $filename) return $file->getPathname();
    }
    return null;
}

/**
 * Listet alle .conf/.json Dateinamen rekursiv in einem Verzeichnis (ohne Backups/Excel).
 */
function listConfFilesRecursive($dir) {
    $files = [];
    $it = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($dir, RecursiveDirectoryIterator::SKIP_DOTS),
        RecursiveIteratorIterator::LEAVES_ONLY
    );
    foreach ($it as $file) {
        $fn = $file->getFilename();
        $ext = strtolower(pathinfo($fn, PATHINFO_EXTENSION));
        if (!in_array($ext, ['conf', 'json'])) continue;
        if (preg_match('/\.\d{8}_\d{6}\.bak$/', $fn)) continue;
        if (preg_match('/\.xlsx$/i', $fn)) continue;
        $files[] = $fn;
    }
    return $files;
}

// =====================================================================
// Core-Config Import (Produktiv → raw-conf)
// =====================================================================

/**
 * Core-Konfigurationen (Produktiv) auflisten.
 * Scannt core/config/ und core/nls/de/, gruppiert nach Suffix/Kürzel.
 * Markiert welche Kürzel bereits in raw-conf vorhanden sind.
 */
function listCoreSources() {
    global $docRoot;
    $coreConfigDir = CORE_CONFIG_DIR;
    $coreNlsDir    = CORE_NLS_DIR;
    if (!is_dir($coreConfigDir)) return ['success' => false, 'error' => 'core/config/ nicht gefunden'];
    if (!is_dir($coreNlsDir))    return ['success' => false, 'error' => 'core/nls/de/ nicht gefunden'];

    $prefixes = ['layers', 'maptips', 'lyrmgrResources', 'maptipsResources', 'legendResources'];
    $typeMap = [
        'layers' => 'layers', 'maptips' => 'maptips',
        'lyrmgrResources' => 'lyrmgr', 'maptipsResources' => 'maptipsRes', 'legendResources' => 'legendRes'
    ];

    // raw-conf-Kürzel sammeln (für «bereits importiert»-Markierung)
    // Scanne alle Buckets (ags, qgis, mapplus) für vollständige Abdeckung
    $rawConfDir = getWritableRawConfDir();
    if ($rawConfDir === false) $rawConfDir = RAW_CONF_DIR;
    $rawConfKuerzel = []; // kuerzel => bucket (z.B. 'awu' => 'ags')
    $buckets = rawConfSourceBuckets();
    foreach ($buckets as $bucket) {
        $bucketDir = $rawConfDir . '/' . $bucket;
        if (is_dir($bucketDir)) {
            foreach (@scandir($bucketDir) ?: [] as $d) {
                if ($d !== '.' && $d !== '..' && is_dir($bucketDir . '/' . $d)) {
                    $rawConfKuerzel[$d] = $bucket;
                }
            }
        }
    }
    // Fallback für alte Struktur (flach ohne Buckets)
    foreach (@scandir($rawConfDir) ?: [] as $d) {
        if ($d !== '.' && $d !== '..' && is_dir($rawConfDir . '/' . $d) && !in_array($d, $buckets)) {
            if (!isset($rawConfKuerzel[$d])) {
                $rawConfKuerzel[$d] = ''; // kein Bucket (Root-Level)
            }
        }
    }

    // Dateien sammeln: suffix → [files]
    $filesBySuffix = [];
    $dirsToScan = [
        $coreConfigDir => 'config',
        $coreNlsDir    => 'nls/de'
    ];

    foreach ($dirsToScan as $dir => $dirLabel) {
        foreach (@scandir($dir) ?: [] as $f) {
            if ($f === '.' || $f === '..') continue;
            if (preg_match('/\.bak$/', $f)) continue;
            $ext = strtolower(pathinfo($f, PATHINFO_EXTENSION));
            if (!in_array($ext, ['conf', 'json'])) continue;
            $basename = pathinfo($f, PATHINFO_FILENAME);
            $matchedPrefix = null;
            $suffix = null;
            foreach ($prefixes as $pfx) {
                if (strpos($basename, $pfx . '_') === 0) {
                    $matchedPrefix = $pfx; $suffix = substr($basename, strlen($pfx) + 1); break;
                }
                if (strpos($basename, $pfx . '-') === 0) {
                    $matchedPrefix = $pfx; $suffix = substr($basename, strlen($pfx) + 1); break;
                }
            }
            if (!$matchedPrefix || !$suffix) continue;

            $fp = $dir . '/' . $f;
            $content = @file_get_contents($fp);
            $decoded = ($content !== false) ? @json_decode($content, true) : null;
            $keys = is_array($decoded) ? count($decoded) : 0;
            $filesBySuffix[$suffix][] = [
                'name' => $f, 'type' => $typeMap[$matchedPrefix] ?? 'unknown',
                'prefix' => $matchedPrefix, 'suffix' => $suffix,
                'dir' => $dirLabel, 'keys' => $keys,
                'size' => filesize($fp), 'modified' => date('Y-m-d H:i:s', filemtime($fp)),
            ];
        }
    }

    // Suffixe zusammenführen (z.B. "GIS-oereb-wms" + "oereb-wms" → Gruppe "oereb-wms")
    $suffixes = array_keys($filesBySuffix);
    $merged = [];
    $groups = [];
    foreach ($suffixes as $s) {
        if (isset($merged[$s])) continue;
        $merged[$s] = $s;
        $groups[$s] = $filesBySuffix[$s];
        foreach ($suffixes as $other) {
            if ($other === $s || isset($merged[$other])) continue;
            $shorter = strlen($s) <= strlen($other) ? $s : $other;
            $longer  = strlen($s) >  strlen($other) ? $s : $other;
            if (substr($longer, -(strlen($shorter) + 1)) === '-' . $shorter) {
                $groupKey = $shorter;
                $existingFiles = isset($groups[$groupKey]) ? $groups[$groupKey] : [];
                $otherFiles = $filesBySuffix[$other];
                if ($merged[$s] !== $groupKey && isset($groups[$merged[$s]])) {
                    $existingFiles = $groups[$merged[$s]];
                    unset($groups[$merged[$s]]);
                }
                $groups[$groupKey] = array_merge($existingFiles, $otherFiles);
                $merged[$s] = $groupKey;
                $merged[$other] = $groupKey;
            }
        }
    }

    // Ergebnis bauen
    $result = [];
    foreach ($groups as $key => $files) {
        usort($files, function($a, $b) { return strcmp($a['name'], $b['name']); });
        $has = ['layers' => false, 'maptips' => false, 'lyrmgr' => false, 'maptipsRes' => false, 'legendRes' => false];
        foreach ($files as $fi) { if (isset($has[$fi['type']])) $has[$fi['type']] = true; }
        $missing = [];
        if ($has['layers'] && !$has['lyrmgr']) $missing[] = 'lyrmgrResources';
        if ($has['layers'] && !$has['maptipsRes']) $missing[] = 'maptipsResources';

        // Change-Detection: Vergleich aktuelle Core-Dateien mit letztem Import-Manifest
        $sourceChanges = null;
        if (isset($rawConfKuerzel[$key])) {
            $bucket = $rawConfKuerzel[$key];
            $kuerzelDir = $bucket ? ($rawConfDir . '/' . $bucket . '/' . $key) : ($rawConfDir . '/' . $key);
            $manifestPath = $kuerzelDir . '/.core-import-manifest.json';
            if (is_file($manifestPath)) {
                $raw = @file_get_contents($manifestPath);
                if ($raw !== false) {
                    $importManifest = @json_decode($raw, true);
                    if ($importManifest && isset($importManifest['sourceFiles'])) {
                        $sourceChanges = [
                            'hasChanges'   => false,
                            'changed'      => [],
                            'added'        => [],
                            'deleted'      => [],
                            'lastImported' => $importManifest['lastImported'] ?? null,
                        ];
                        $manifestByName = [];
                        foreach ($importManifest['sourceFiles'] as $mf) {
                            $manifestByName[$mf['file']] = $mf;
                        }
                        $currentNames = [];
                        foreach ($files as $fi) {
                            $currentNames[] = $fi['name'];
                            if (!isset($manifestByName[$fi['name']])) {
                                $sourceChanges['added'][] = $fi['name'];
                                $sourceChanges['hasChanges'] = true;
                            } else {
                                $mf = $manifestByName[$fi['name']];
                                if ($fi['size'] !== $mf['size'] || $fi['modified'] !== $mf['modified']) {
                                    $sourceChanges['changed'][] = [
                                        'file'        => $fi['name'],
                                        'oldModified' => $mf['modified'],
                                        'newModified' => $fi['modified'],
                                    ];
                                    $sourceChanges['hasChanges'] = true;
                                }
                            }
                        }
                        foreach (array_keys($manifestByName) as $mfn) {
                            if (!in_array($mfn, $currentNames)) {
                                $sourceChanges['deleted'][] = $mfn;
                                $sourceChanges['hasChanges'] = true;
                            }
                        }
                    }
                }
            }
        }

        $result[] = [
            'kuerzel' => $key, 'files' => $files,
            'size' => array_sum(array_column($files, 'size')),
            'source' => 'core', 'missingNls' => $missing,
            'inRawConf' => isset($rawConfKuerzel[$key]),
            'sourceChanges' => $sourceChanges,
        ];
    }
    usort($result, function($a, $b) { return strcmp($a['kuerzel'], $b['kuerzel']); });
    return ['success' => true, 'kuerzel' => $result];
}

/**
 * Core-Konfigurationsdateien in raw-conf importieren.
 * Kopiert Config-Dateien aus core/config/ und core/nls/de/ in raw-conf/<kuerzel>/.
 * Erstellt Backups bestehender Dateien.
 *
 * @param array $kuerzelList  Array von Kürzel-Strings
 * @return array  Ergebnis mit kopierten Dateien
 */
function importCoreToRawConf($kuerzelList) {
    global $docRoot;
    if (!is_array($kuerzelList) || count($kuerzelList) === 0) {
        return ['success' => false, 'error' => 'Keine Kürzel angegeben'];
    }

    $rawConfDir = getWritableRawConfDir();
    if ($rawConfDir === false) {
        return ['success' => false, 'error' => 'raw-conf Verzeichnis nicht beschreibbar'];
    }

    $coreConfigDir = CORE_CONFIG_DIR;
    $coreNlsDir    = CORE_NLS_DIR;

    $prefixes = ['layers', 'maptips', 'lyrmgrResources', 'maptipsResources', 'legendResources'];
    $ts = date('Ymd_His');
    $results = [];

    foreach ($kuerzelList as $kuerzel) {
        $kuerzel = basename($kuerzel); // Sicherheit: keine Pfad-Traversal
        $targetDir = $rawConfDir . '/mapplus/' . $kuerzel;
        $copiedFiles = [];
        $errors = [];

        // Zielverzeichnis erstellen
        if (!is_dir($targetDir)) {
            if (!@mkdir($targetDir, 0777, true)) {
                $results[] = ['kuerzel' => $kuerzel, 'success' => false, 'error' => 'Verzeichnis konnte nicht erstellt werden'];
                continue;
            }
        }

        // Beide Quellverzeichnisse durchsuchen
        $dirsToScan = [$coreConfigDir, $coreNlsDir];
        foreach ($dirsToScan as $srcDir) {
            if (!is_dir($srcDir)) continue;
            foreach (@scandir($srcDir) ?: [] as $f) {
                if ($f === '.' || $f === '..' || preg_match('/\.bak$/', $f)) continue;
                $ext = strtolower(pathinfo($f, PATHINFO_EXTENSION));
                if (!in_array($ext, ['conf', 'json'])) continue;
                $basename = pathinfo($f, PATHINFO_FILENAME);

                // Prüfen ob Datei zu diesem Kürzel gehört
                $belongs = false;
                foreach ($prefixes as $pfx) {
                    foreach (['_', '-'] as $sep) {
                        if (strpos($basename, $pfx . $sep) === 0) {
                            $suffix = substr($basename, strlen($pfx) + 1);
                            if ($suffix === $kuerzel || substr($suffix, -(strlen($kuerzel) + 1)) === '-' . $kuerzel) {
                                $belongs = true;
                            }
                            break 2;
                        }
                    }
                }
                if (!$belongs) continue;

                $srcPath = $srcDir . '/' . $f;
                $dstPath = $targetDir . '/' . $f;

                // Backup bestehender Datei
                if (file_exists($dstPath)) {
                    @copy($dstPath, $dstPath . '.' . $ts . '.bak');
                }

                $content = @file_get_contents($srcPath);
                if ($content === false) {
                    $errors[] = 'Lesen fehlgeschlagen: ' . $f;
                    continue;
                }

                $bytes = @file_put_contents($dstPath, $content);
                if ($bytes === false) {
                    $errors[] = 'Schreiben fehlgeschlagen: ' . $f;
                } else {
                    $copiedFiles[] = [
                        'file'        => $f,
                        'bytes'       => $bytes,
                        'srcSize'     => strlen($content),
                        'srcModified' => date('Y-m-d H:i:s', filemtime($srcPath)),
                    ];
                }
            }
        }

        // Import-Manifest schreiben (.core-import-manifest.json) für Change-Detection
        if (count($copiedFiles) > 0) {
            $manifestFiles = [];
            foreach ($copiedFiles as $cf) {
                $manifestFiles[] = [
                    'file'     => $cf['file'],
                    'size'     => $cf['srcSize'],
                    'modified' => $cf['srcModified'],
                ];
            }
            @file_put_contents(
                $targetDir . '/.core-import-manifest.json',
                json_encode([
                    'kuerzel'      => $kuerzel,
                    'lastImported' => date('Y-m-d\TH:i:s'),
                    'sourceFiles'  => $manifestFiles
                ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
            );
        }
        $results[] = [
            'kuerzel' => $kuerzel,
            'success' => count($copiedFiles) > 0,
            'files'   => array_map(function($cf) {
                return ['file' => $cf['file'], 'bytes' => $cf['bytes']];
            }, $copiedFiles),
            'errors' => $errors,
        ];
    }

    return [
        'success' => true,
        'results' => $results,
        'timestamp' => date('Y-m-d H:i:s'),
    ];
}

function migrateImportToCoreFilesToDb($onlyKuerzel = '') {
    $dir = IMPORT_TO_CORE_DIR;
    if (!is_dir($dir)) return 0;

    $entries = @scandir($dir);
    if (!$entries) return 0;

    $migrated = 0;
    foreach ($entries as $k) {
        if ($k === '.' || $k === '..') continue;
        if ($onlyKuerzel && $k !== $onlyKuerzel) continue;
        $kPath = $dir . '/' . $k;
        if (!is_dir($kPath)) continue;
        if (StagingImportRepository::loadBundle($k)) continue;

        $manifest = [];
        $manifestPath = $kPath . '/.staging-manifest.json';
        if (is_file($manifestPath)) {
            $raw = @file_get_contents($manifestPath);
            if ($raw !== false) $manifest = @json_decode($raw, true) ?: [];
        }

        $files = [];
        foreach (@scandir($kPath) ?: [] as $f) {
            if ($f === '.' || $f === '..' || $f[0] === '.') continue;
            $fp = $kPath . '/' . $f;
            if (!is_file($fp)) continue;
            $ext = strtolower(pathinfo($f, PATHINFO_EXTENSION));
            if (!in_array($ext, ['conf', 'json'], true)) continue;
            $raw = @file_get_contents($fp);
            if ($raw === false) continue;
            $decoded = @json_decode($raw, true);
            if (!is_array($decoded)) continue;

            $knownPrefixes = ['layers', 'maptips', 'lyrmgrResources', 'maptipsResources', 'legendResources'];
            $prefix = 'unknown';
            $basename = pathinfo($f, PATHINFO_FILENAME);
            foreach ($knownPrefixes as $pfx) {
                if (strpos($basename, $pfx . '_') === 0 || strpos($basename, $pfx . '-') === 0 || $basename === $pfx) {
                    $prefix = $pfx;
                    break;
                }
            }

            $type = 'unknown';
            if ($prefix === 'layers') $type = 'layers';
            elseif ($prefix === 'maptips') $type = 'maptips';
            elseif ($prefix === 'lyrmgrResources') $type = 'lyrmgr';
            elseif ($prefix === 'maptipsResources') $type = 'maptipsRes';
            elseif ($prefix === 'legendResources') $type = 'legendRes';

            $files[] = [
                'name' => $f,
                'type' => $type,
                'prefix' => $prefix,
                'keys' => count($decoded),
                'size' => filesize($fp),
                'modified' => date('Y-m-d H:i:s', filemtime($fp)),
                'data' => $decoded,
            ];
        }

        if (!empty($files)) {
            StagingImportRepository::saveBundle($k, $files, $manifest, [$k], 'migration');
            $migrated++;
        }
    }

    return $migrated;
}

function listImportToCoreDb() {
    $rawDir = getWritableRawConfDir();
    if ($rawDir === false) $rawDir = RAW_CONF_DIR;
    $bundles = StagingImportRepository::loadAll();
    if (count($bundles) === 0) {
        migrateImportToCoreFilesToDb();
        $bundles = StagingImportRepository::loadAll();
    }
    if (count($bundles) === 0) return ['exists' => false, 'kuerzel' => []];

    $keyIndex = [];
    $result = [];
    foreach ($bundles as $bundle) {
        $files = [];
        foreach ($bundle['files'] as $file) {
            $name = $file['name'] ?? '';
            if ($name === '') continue;
            $prefix = $file['prefix'] ?? pathinfo($name, PATHINFO_FILENAME);
            $data = $file['data'] ?? [];
            if (is_array($data) && !empty($data) && array_keys($data) !== range(0, count($data) - 1)) {
                foreach (array_keys($data) as $topKey) {
                    $keyIndex[$prefix][$topKey][] = $bundle['kuerzel'] . '/' . $name;
                }
            }
            $files[] = [
                'file' => $bundle['kuerzel'] . '/' . $name,
                'name' => $name,
                'size' => (int)($file['size'] ?? strlen(json_encode($data))),
                'modified' => $file['modified'] ?? ($bundle['updatedAt'] ?: date('Y-m-d H:i:s')),
                '_prefix' => $prefix,
            ];
        }

        $entry = [
            'kuerzel' => $bundle['kuerzel'],
            'tags' => $bundle['tags'],
            'scope' => $bundle['scope'] ?? 'core',
            'profile' => $bundle['profile'] ?? null,
            'files' => $files,
            'size' => array_sum(array_map(function ($f) { return (int)$f['size']; }, $files)),
            'manifest' => $bundle['manifest'],
            'lastImportedAt' => $bundle['lastImportedAt'],
            'lastImportedBy' => $bundle['lastImportedBy'],
        ];
        if (!empty($bundle['manifest'])) {
            $entry['sourceChanges'] = checkSourceChanges($bundle['manifest'], $rawDir);
        }
        $result[] = $entry;
    }

    foreach ($result as &$bundleEntry) {
        foreach ($bundleEntry['files'] as &$fileInfo) {
            $prefix = $fileInfo['_prefix'];
            $crossDups = [];
            if (isset($keyIndex[$prefix])) {
                $thisFile = $fileInfo['file'];
                foreach ($keyIndex[$prefix] as $topKey => $sources) {
                    if (in_array($thisFile, $sources, true) && count($sources) > 1) {
                        $otherFiles = array_values(array_filter($sources, function ($s) use ($thisFile) {
                            return $s !== $thisFile;
                        }));
                        if (!empty($otherFiles)) {
                            $crossDups[] = ['key' => $topKey, 'conflictsWith' => $otherFiles];
                        }
                    }
                }
            }
            if (!empty($crossDups)) {
                $fileInfo['crossDuplicateKeys'] = $crossDups;
            }
            unset($fileInfo['_prefix']);
        }
        unset($fileInfo);
    }
    unset($bundleEntry);

    return ['exists' => true, 'kuerzel' => $result];
}

function readImportToCoreFileDb($relPath) {
    if (strpos($relPath, '..') !== false || strpos($relPath, '\\') !== false) {
        return ['success' => false, 'error' => 'Ungültiger Pfad'];
    }
    $parts = explode('/', trim($relPath, '/'), 2);
    if (count($parts) !== 2) {
        return ['success' => false, 'error' => 'Ungültiger Datei-Pfad'];
    }
    $bundle = StagingImportRepository::loadBundle($parts[0]);
    if (!$bundle) return ['success' => false, 'error' => 'Kürzel nicht gefunden: ' . $parts[0]];
    foreach ($bundle['files'] as $file) {
        if (($file['name'] ?? '') === $parts[1]) {
            $content = json_encode($file['data'] ?? [], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            return ['success' => true, 'content' => $content, 'size' => strlen($content), 'file' => $relPath];
        }
    }
    return ['success' => false, 'error' => 'Datei nicht gefunden: ' . $relPath];
}

function writeImportToCoreFileDb($relPath, $content) {
    if (strpos($relPath, '..') !== false || strpos($relPath, '\\') !== false) {
        return ['success' => false, 'error' => 'Ungültiger Pfad'];
    }
    $parts = explode('/', trim($relPath, '/'), 2);
    if (count($parts) !== 2) {
        return ['success' => false, 'error' => 'Ungültiger Datei-Pfad'];
    }
    $decoded = @json_decode($content, true);
    if (!is_array($decoded)) {
        return ['success' => false, 'error' => 'Kein gültiges JSON'];
    }
    $res = StagingImportRepository::saveFileData($parts[0], $parts[1], $decoded, getEditorName());
    if (empty($res['success'])) return $res;
    return ['success' => true, 'bytes' => strlen($content)];
}

function deleteImportToCoreKuerzelDb(array $kuerzelList) {
    return StagingImportRepository::deleteBundles($kuerzelList);
}

/**
 * Re-Stage: ein Kuerzel anhand seiner Manifest-Quellen server-seitig neu stagen.
 */
function restageKuerzelDb($kuerzel) {
    $safe = preg_replace('/[^a-zA-Z0-9_\-]/', '_', trim((string)$kuerzel));
    if ($safe === '') return ['success' => false, 'error' => 'Kuerzel darf nicht leer sein'];
    if (!useStagingImportDb()) return ['success' => false, 'error' => 'Konfig-Store DB nicht verfuegbar'];
    $bundle = StagingImportRepository::loadBundle($safe);
    if (!$bundle) return ['success' => false, 'error' => 'Kuerzel nicht gefunden: ' . $safe];
    $manifest = $bundle['manifest'] ?? [];
    $sources = [];
    if (!empty($manifest['sources']) && is_array($manifest['sources'])) {
        foreach ($manifest['sources'] as $src) {
            if (!empty($src['service'])) $sources[] = $src['service'];
        }
    }
    if (empty($sources)) {
        return ['success' => false, 'error' => 'Keine Quellen im Manifest hinterlegt — bitte links manuell neu stagen.', 'code' => 'no-sources'];
    }
    return stageServicesToImportToCore($sources, $safe, 'replace');
}

function stageServicesToImportDb(array $serviceKeys, string $kuerzel, string $mode = 'replace', string $scope = 'core', ?string $profile = null) {
    $kuerzel = preg_replace('/[^a-zA-Z0-9_\-]/', '_', trim($kuerzel));
    if ($kuerzel === '') return ['success' => false, 'error' => 'Kürzel darf nicht leer sein'];
    if (!in_array($mode, ['merge', 'replace', 'preview'], true)) {
        return ['success' => false, 'error' => 'Ungültiger Modus: ' . $mode];
    }

    $rawDir = getWritableRawConfDir();
    if ($rawDir === false) $rawDir = RAW_CONF_DIR;
    $existingBundle = (($mode === 'merge' || $mode === 'preview') ? StagingImportRepository::loadBundle($kuerzel) : null);
    $existingManifest = $existingBundle['manifest'] ?? null;
    $existingFilesMap = [];
    if ($existingBundle && !empty($existingBundle['files'])) {
        foreach ($existingBundle['files'] as $existingFile) {
            if (!empty($existingFile['name'])) {
                $existingFilesMap[$existingFile['name']] = $existingFile;
            }
        }
    }

    $buckets = [];
    $errors = [];
    $skipped = [];
    foreach ($serviceKeys as $svcKey) {
        $svcDir = resolveRawConfServiceDir($rawDir, $svcKey);
        if ($svcDir && is_dir($svcDir)) {
            $it = new RecursiveIteratorIterator(
                new RecursiveDirectoryIterator($svcDir, RecursiveDirectoryIterator::SKIP_DOTS),
                RecursiveIteratorIterator::LEAVES_ONLY
            );
            $svcFiles = iterator_to_array($it, false);
        } else {
            $svcFiles = collectRawConfFilesByService($rawDir, $svcKey);
            if (empty($svcFiles)) { $errors[] = 'Dienst nicht gefunden: ' . $svcKey; continue; }
        }

        foreach (new ArrayIterator($svcFiles) as $file) {
            $fname = $file->getFilename();
            if (preg_match('/\.\d{8}_\d{6}\.bak$/', $fname)) { $skipped[] = $fname . ' (Backup)'; continue; }
            if (preg_match('/\.xlsx$/i', $fname)) { $skipped[] = $fname . ' (Excel)'; continue; }
            $ext = strtolower(pathinfo($fname, PATHINFO_EXTENSION));
            if (!in_array($ext, ['conf', 'json'], true)) { $skipped[] = $fname . ' (Typ .' . $ext . ' nicht verarbeitbar)'; continue; }

            $content = @file_get_contents($file->getPathname());
            if ($content === false) { $errors[] = 'Lesefehler: ' . $file->getPathname(); continue; }
            $decoded = @json_decode($content, true);
            if (!is_array($decoded)) { $errors[] = 'Kein gültiges JSON: ' . $fname; continue; }

            $knownPfx = ['layers', 'maptips', 'lyrmgrResources', 'maptipsResources', 'legendResources'];
            $prefix = pathinfo($fname, PATHINFO_FILENAME);
            foreach ($knownPfx as $pfx) {
                if (strpos($fname, $pfx . '_') === 0 || strpos($fname, $pfx . '-') === 0) {
                    $prefix = $pfx;
                    break;
                }
            }
            $usesDash = (strpos($fname, $prefix . '-') === 0);
            if (!isset($buckets[$prefix])) {
                $buckets[$prefix] = ['parts' => [], 'ext' => $ext, 'usesDash' => $usesDash];
            }
            $buckets[$prefix]['parts'][] = ['data' => $decoded, 'source' => $fname];
        }
    }

    $written = [];
    $mergeStats = [];
    $manifestSources = [];
    if (($mode === 'merge' || $mode === 'preview') && $existingManifest && isset($existingManifest['sources'])) {
        foreach ($existingManifest['sources'] as $src) {
            if (!in_array($src['service'], $serviceKeys, true)) {
                $manifestSources[$src['service']] = $src;
            }
        }
    }

    foreach ($buckets as $prefix => $bucket) {
        if (empty($bucket['parts'])) continue;
        $outName = (!empty($bucket['usesDash']) && count($bucket['parts']) === 1)
            ? $bucket['parts'][0]['source']
            : $prefix . '_' . $kuerzel . '.' . $bucket['ext'];

        $existingData = [];
        if (($mode === 'merge' || $mode === 'preview') && isset($existingFilesMap[$outName]['data']) && is_array($existingFilesMap[$outName]['data'])) {
            $existingData = $existingFilesMap[$outName]['data'];
        }

        $merged = (($mode === 'merge' || $mode === 'preview') ? $existingData : []);
        $isAssoc = (!empty($existingData) && array_keys($existingData) !== range(0, count($existingData) - 1));
        foreach ($bucket['parts'] as $part) {
            $arr = $part['data'];
            if (!empty($arr) && array_keys($arr) !== range(0, count($arr) - 1)) $isAssoc = true;
            if ($isAssoc) {
                foreach ($arr as $k => $v) { $merged[$k] = $v; }
            } else {
                foreach ($arr as $v) { $merged[] = $v; }
            }
        }

        $stats = ['added' => 0, 'updated' => 0, 'unchanged' => 0];
        if (($mode === 'merge' || $mode === 'preview') && $isAssoc && !empty($existingData)) {
            foreach ($merged as $k => $v) {
                if (!array_key_exists($k, $existingData)) $stats['added']++;
                elseif ($v !== $existingData[$k]) $stats['updated']++;
                else $stats['unchanged']++;
            }
        }
        $mergeStats[$prefix] = $stats;

        $payloadJson = json_encode($merged, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $written[] = [
            'file' => $kuerzel . '/' . $outName,
            'name' => $outName,
            'bytes' => ($mode === 'preview') ? 0 : strlen($payloadJson),
            'keys' => is_array($merged) ? count($merged) : 0,
            'mergeStats' => $stats,
            'preview' => ($mode === 'preview'),
            'duplicateKeys' => [],
            'type' => ($prefix === 'layers' ? 'layers' : ($prefix === 'maptips' ? 'maptips' : ($prefix === 'lyrmgrResources' ? 'lyrmgr' : ($prefix === 'maptipsResources' ? 'maptipsRes' : ($prefix === 'legendResources' ? 'legendRes' : 'unknown'))))),
            'prefix' => $prefix,
            'data' => $merged,
            'size' => strlen($payloadJson),
            'modified' => date('Y-m-d H:i:s'),
        ];
    }

    foreach ($serviceKeys as $svcKey) {
        $svcDir = resolveRawConfServiceDir($rawDir, $svcKey);
        $svcKeyCounts = [];
        foreach ($buckets as $prefix => $bucket) {
            $count = 0;
            foreach ($bucket['parts'] as $part) {
                if (is_array($part['data'])) $count += count($part['data']);
            }
            if ($count > 0) $svcKeyCounts[$prefix] = $count;
        }

        $srcFiles = [];
        if ($svcDir && is_dir($svcDir)) {
            $it = new RecursiveIteratorIterator(
                new RecursiveDirectoryIterator($svcDir, RecursiveDirectoryIterator::SKIP_DOTS),
                RecursiveIteratorIterator::LEAVES_ONLY
            );
            foreach ($it as $sf) {
                $sfn = $sf->getFilename();
                $sfExt = strtolower(pathinfo($sfn, PATHINFO_EXTENSION));
                if (!in_array($sfExt, ['conf', 'json'], true)) continue;
                if (preg_match('/\.\d{8}_\d{6}\.bak$/', $sfn)) continue;
                $srcFiles[] = ['file' => $sfn, 'size' => $sf->getSize(), 'modified' => date('Y-m-d H:i:s', $sf->getMTime())];
            }
        } else {
            foreach (collectRawConfFilesByService($rawDir, $svcKey) as $sf) {
                $sfn = $sf->getFilename();
                if (preg_match('/\.\d{8}_\d{6}\.bak$/', $sfn)) continue;
                $sfExt = strtolower(pathinfo($sfn, PATHINFO_EXTENSION));
                if (!in_array($sfExt, ['conf', 'json'], true)) continue;
                $srcFiles[] = ['file' => $sfn, 'size' => $sf->getSize(), 'modified' => date('Y-m-d H:i:s', $sf->getMTime())];
            }
        }
        if (empty($srcFiles)) continue;
        $manifestSources[$svcKey] = [
            'service' => $svcKey,
            'staged' => date('Y-m-d\TH:i:s'),
            'keys' => $svcKeyCounts,
            'sourceFiles' => $srcFiles,
        ];
    }

    $manifest = [
        'kuerzel' => $kuerzel,
        'lastStaged' => date('Y-m-d\TH:i:s'),
        'mode' => $mode,
        'sources' => array_values($manifestSources),
        'buckets' => [],
    ];
    foreach ($written as $wf) {
        $manifest['buckets'][$wf['prefix']] = ['file' => $wf['name'], 'totalKeys' => $wf['keys']];
    }

    // Bestehende Zusatz-Tags erhalten (auch bei mode=replace / Re-Stage)
    $preserveTags = [$kuerzel];
    $tagBundle = StagingImportRepository::loadBundle($kuerzel);
    if ($tagBundle && !empty($tagBundle['tags']) && is_array($tagBundle['tags'])) {
        $preserveTags = array_values(array_unique(array_merge($preserveTags, $tagBundle['tags'])));
    }
    // Scope/Profile: explizit gewaehlt, sonst bestehenden Wert beibehalten.
    if ($scope === '' || $scope === null) {
        $scope = $tagBundle['scope'] ?? 'core';
    }
    if ($profile === null && isset($tagBundle['profile'])) {
        $profile = $tagBundle['profile'];
    }

    if ($mode !== 'preview') {
        StagingImportRepository::saveBundle($kuerzel, $written, $manifest, $preserveTags, getEditorName(), $scope, $profile);
    }

    return [
        'success' => true,
        'kuerzel' => $kuerzel,
        'mode' => $mode,
        'targetDir' => 'db:config_bundle_store/' . $kuerzel,
        'files' => array_map(function ($wf) use ($kuerzel) {
            return [
                'file' => $kuerzel . '/' . $wf['name'],
                'bytes' => $wf['bytes'],
                'keys' => $wf['keys'],
                'mergeStats' => $wf['mergeStats'],
                'preview' => $wf['preview'],
                'duplicateKeys' => $wf['duplicateKeys'],
            ];
        }, $written),
        'mergeStats' => $mergeStats,
        'duplicates' => [],
        'errors' => $errors,
        'skipped' => $skipped,
        'timestamp' => date('Y-m-d H:i:s'),
    ];
}

function stagingLayersFlatDb($kuerzel = '') {
    $bundles = [];
    if ($kuerzel) {
        $safe = preg_replace('/[^a-zA-Z0-9_\-]/', '_', trim($kuerzel));
        $bundle = StagingImportRepository::loadBundle($safe);
        if ($bundle) $bundles[] = $bundle;
    } else {
        $bundles = StagingImportRepository::loadAll();
    }
    if (count($bundles) === 0) return ['success' => true, 'data' => [], 'meta' => ['count' => 0, 'source' => 'staging-db']];

    $nameMap = []; $allAliases = []; $maptipsByLayer = []; $allMaptips = []; $allMaptipTexts = []; $allLegends = []; $layerFiles = [];
    foreach ($bundles as $bundle) {
        foreach ($bundle['files'] as $file) {
            $decoded = $file['data'] ?? null;
            if (!is_array($decoded)) continue;
            $f = $file['name'] ?? '';
            if (strpos($f, 'lyrmgrResources_') === 0) {
                foreach ($decoded as $resKey => $resVal) {
                    $allAliases[$resKey] = $resVal;
                    if (strpos($resKey, 'desc_') === 0) $nameMap[strtolower(substr($resKey, 5))] = is_string($resVal) ? $resVal : (string)$resVal;
                }
            } elseif (strpos($f, 'maptips_') === 0) {
                foreach ($decoded as $mtKey => $mtDef) {
                    $allMaptips[$mtKey] = $mtDef;
                    $linked = $mtDef['linked_layer'] ?? '';
                    if ($linked) {
                        $maptipsByLayer[strtolower($linked)] = ['key' => $mtKey, 'nls' => $mtDef['nls'] ?? '', 'query_layers' => $mtDef['query_layers'] ?? ''];
                    }
                }
            } elseif (strpos($f, 'maptipsResources_') === 0) {
                foreach ($decoded as $trKey => $trVal) $allMaptipTexts[$trKey] = $trVal;
            } elseif (strpos($f, 'legendResources_') === 0) {
                foreach ($decoded as $lgKey => $lgVal) $allLegends[$lgKey] = $lgVal;
            } elseif (strpos($f, 'layers_') === 0 && preg_match('/\.conf$/i', $f)) {
                $layerFiles[] = ['kuerzel' => $bundle['kuerzel'], 'file' => $f, 'decoded' => $decoded];
            }
        }
    }

    $sublayerCount = [];
    foreach ($nameMap as $lk => $name) {
        $prefix = $lk . '/';
        foreach ($nameMap as $otherKey => $otherName) {
            if (strpos($otherKey, $prefix) === 0) $sublayerCount[$lk] = ($sublayerCount[$lk] ?? 0) + 1;
        }
    }

    $flatLayers = [];
    foreach ($layerFiles as $lf) {
        foreach ($lf['decoded'] as $layerKey => $layerDef) {
            $lkLower = strtolower($layerKey);
            $alias = $nameMap[$lkLower] ?? null;
            $legend = $layerDef['legend'] ?? null;
            $maptipCount = 0; $firstMaptipNls = null; $firstMaptipTitle = null; $lkPrefix = $lkLower . '/';
            foreach ($maptipsByLayer as $mlKey => $mlVal) {
                if ($mlKey === $lkLower || strpos($mlKey, $lkPrefix) === 0) {
                    $maptipCount++;
                    if (!$firstMaptipNls && $mlVal['nls']) {
                        $firstMaptipNls = $mlVal['nls'];
                        $firstMaptipTitle = $allMaptipTexts[$mlVal['nls'] . '_title'] ?? null;
                    }
                }
            }
            $legendCount = 0; $firstLegendTitle = null;
            foreach ($allLegends as $lgKey => $lgVal) {
                if (strpos(strtolower($lgKey), $lkLower) === 0 && substr($lgKey, -6) === '_title') {
                    $legendCount++;
                    if (!$firstLegendTitle) $firstLegendTitle = $lgVal;
                }
            }
            $flatLayers[] = [
                'id' => $layerKey,
                'name' => $alias ?: $layerKey,
                'alias' => $alias,
                'url' => $layerDef['url'] ?? '',
                'type' => $layerDef['type'] ?? 'unknown',
                'layerType' => $layerDef['type'] ?? 'unknown',
                'visible' => $layerDef['visible'] ?? 0,
                'icon' => $layerDef['icon'] ?? '',
                'params' => $layerDef['params'] ?? null,
                'options' => $layerDef['options'] ?? null,
                'hasMaptip' => $maptipCount > 0,
                'maptipCount' => $maptipCount,
                'maptipNls' => $firstMaptipNls,
                'maptipTitle' => $firstMaptipTitle,
                'hasLegend' => $legendCount > 0,
                'legendCount' => $legendCount,
                'legendKey' => $legend,
                'legendTitle' => $firstLegendTitle,
                'sublayers' => $sublayerCount[$lkLower] ?? 0,
                '_source' => $lf['kuerzel'],
                '_file' => $lf['file'],
            ];
        }
    }

    return [
        'success' => true,
        'data' => $flatLayers,
        'meta' => ['kuerzel' => $kuerzel ?: '(alle)', 'count' => count($flatLayers), 'format' => 'flat', 'source' => 'staging-db', 'aliases' => count($allAliases), 'maptips' => count($allMaptips), 'legends' => count($allLegends)],
        'supplements' => ['aliases' => $allAliases, 'maptips' => $allMaptips, 'maptipTexts' => $allMaptipTexts, 'legends' => $allLegends],
    ];
}

function configEditorLoadDb($kuerzel) {
    $safe = preg_replace('/[^a-zA-Z0-9_\-]/', '_', trim($kuerzel));
    if ($safe === '') return ['success' => false, 'error' => 'Kürzel darf nicht leer sein'];
    $bundle = StagingImportRepository::loadBundle($safe);
    if (!$bundle) {
        migrateImportToCoreFilesToDb($safe);
        $bundle = StagingImportRepository::loadBundle($safe);
    }
    if (!$bundle) return ['success' => false, 'error' => 'Kürzel nicht gefunden: ' . $safe];

    $result = ['kuerzel' => $safe, 'files' => [], 'tags' => $bundle['tags'], 'lastImportedAt' => $bundle['lastImportedAt'], 'lastImportedBy' => $bundle['lastImportedBy']];
    foreach ($bundle['files'] as $file) {
        $decoded = $file['data'] ?? null;
        if (!is_array($decoded)) continue;
        $prefix = $file['prefix'] ?? 'unknown';
        $type = 'unknown';
        if ($prefix === 'layers') $type = 'layers';
        elseif ($prefix === 'maptips') $type = 'maptips';
        elseif ($prefix === 'lyrmgrResources') $type = 'lyrmgr';
        elseif ($prefix === 'maptipsResources') $type = 'maptipsRes';
        elseif ($prefix === 'legendResources') $type = 'legendRes';
        $result['files'][] = ['name' => $file['name'] ?? '', 'type' => $type, 'prefix' => $prefix, 'keys' => count($decoded), 'size' => (int)($file['size'] ?? strlen(json_encode($decoded))), 'modified' => $file['modified'] ?? date('Y-m-d H:i:s'), 'data' => $decoded, '_edits' => $file['_edits'] ?? null];
    }
    if (!empty($bundle['manifest'])) $result['manifest'] = $bundle['manifest'];
    return ['success' => true, 'data' => $result];
}

function configEditorSaveDb($kuerzel, $fileName, $data, array $changedKeys = []) {
    $safe = preg_replace('/[^a-zA-Z0-9_\-]/', '_', trim($kuerzel));
    if ($safe === '') return ['success' => false, 'error' => 'Kürzel darf nicht leer sein'];
    if (strpos($fileName, '..') !== false || strpos($fileName, '/') !== false) return ['success' => false, 'error' => 'Ungültiger Dateiname'];
    $res = StagingImportRepository::saveFileData($safe, $fileName, $data, getEditorName(), $changedKeys);
    if (empty($res['success'])) return $res;
    return ['success' => true, 'file' => $fileName, 'keys' => count($data), 'timestamp' => date('Y-m-d H:i:s')];
}

function configExportToCoreDb($kuerzel) {
    global $docRoot;
    $safe = preg_replace('/[^a-zA-Z0-9_\-]/', '_', trim($kuerzel));
    if ($safe === '') return ['success' => false, 'error' => 'Kürzel darf nicht leer sein'];
    $bundle = StagingImportRepository::loadBundle($safe);
    if (!$bundle) return ['success' => false, 'error' => 'Quell-Bundle nicht gefunden'];

    // Scope-bewusste Zielpfade:
    //   core              -> core/config/ + core/nls/de/
    //   sitecore/override -> maps-dev/core/config/ + maps-dev/core/nls/de/
    //   profile           -> maps-dev/public/config/<profil>/ (conf + nls zusammen)
    $scope = $bundle['scope'] ?? 'core';
    $profile = $bundle['profile'] ?? null;

    if ($scope === 'profile') {
        $safeP = preg_replace('/[^a-zA-Z0-9_\-]/', '', (string)$profile);
        if ($safeP === '') return ['success' => false, 'error' => 'Profil-Bundle ohne Profilname — bitte beim Import ein Profil angeben'];
        $targetBase = ($safeP === 'public') ? CONFIG_BASE : CONFIG_BASE . '/' . $safeP;
        $configDir = $targetBase;
        $nlsDir    = $targetBase;
    } elseif ($scope === 'sitecore' || $scope === 'override') {
        $configDir = APP_CORE_CONFIG_DIR;
        $nlsDir    = APP_CORE_NLS_DIR;
    } else { // core
        $configDir = CORE_CONFIG_DIR;
        $nlsDir    = CORE_NLS_DIR;
    }

    // Zielverzeichnisse anlegen (Profil-Ordner existiert evtl. noch nicht)
    if (!is_dir($configDir) && !@mkdir($configDir, 0775, true)) {
        return ['success' => false, 'error' => 'Zielverzeichnis (config) nicht anlegbar: ' . $configDir];
    }
    if (!is_dir($nlsDir) && !@mkdir($nlsDir, 0775, true)) {
        return ['success' => false, 'error' => 'Zielverzeichnis (nls) nicht anlegbar: ' . $nlsDir];
    }

    $exported = []; $errors = []; $backups = []; $ts = date('Ymd_His');
    foreach ($bundle['files'] as $file) {
        $name = $file['name'] ?? '';
        if ($name === '') continue;
        $prefix = $file['prefix'] ?? '';
        $targetDir = in_array($prefix, ['layers', 'maptips'], true) ? $configDir : (in_array($prefix, ['lyrmgrResources', 'maptipsResources', 'legendResources'], true) ? $nlsDir : '');
        if ($targetDir === '') continue;
        $targetPath = $targetDir . '/' . $name;
        if (is_file($targetPath)) {
            $backupPath = $targetPath . '.' . $ts . '.bak';
            if (@copy($targetPath, $backupPath)) $backups[] = $name . ' → ' . basename($backupPath);
        }
        $json = json_encode($file['data'] ?? [], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $bytes = @file_put_contents($targetPath, $json);
        if ($bytes === false) $errors[] = 'Kopieren fehlgeschlagen: ' . $name . ' → ' . $targetPath;
        else $exported[] = ['file' => $name, 'target' => str_replace($docRoot, '', $targetPath), 'bytes' => $bytes];
    }
    return [
        'success' => count($errors) === 0,
        'kuerzel' => $safe,
        'scope' => $scope,
        'profile' => ($scope === 'profile') ? $profile : null,
        'configDir' => str_replace($docRoot, '', $configDir),
        'nlsDir' => str_replace($docRoot, '', $nlsDir),
        'exported' => $exported,
        'backups' => $backups,
        'errors' => $errors,
        'timestamp' => date('Y-m-d H:i:s'),
    ];
}

/**
 * ImportToCore-Verzeichnis auflisten (nach Kürzel gruppiert)
 * Erkennt auch kürzelübergreifende Duplikate (gleicher Key im selben Prefix-Typ)
 */
function listImportToCore() {
    if (useStagingImportDb()) {
        return listImportToCoreDb();
    }
    $dir = IMPORT_TO_CORE_DIR;
    if (!is_dir($dir)) return ['exists' => false, 'kuerzel' => []];
    $rawDir = getWritableRawConfDir();
    if ($rawDir === false) $rawDir = RAW_CONF_DIR;
    $kuerzelList = [];
    $entries = @scandir($dir);
    if (!$entries) return ['exists' => true, 'kuerzel' => []];

    // 1. Pass: Alle Kürzel + Dateien sammeln, JSON-Keys extrahieren für Cross-Check
    // $keyIndex[$prefix][$topLevelKey][] = "kuerzel/dateiname"
    $keyIndex = [];
    $rawKuerzel = [];

    foreach ($entries as $k) {
        if ($k === '.' || $k === '..') continue;
        $kPath = $dir . '/' . $k;
        if (!is_dir($kPath)) continue;
        // Staging-Manifest laden (Quell-Info)
        $manifest = null;
        $manifestPath = $kPath . '/.staging-manifest.json';
        if (is_file($manifestPath)) {
            $raw = @file_get_contents($manifestPath);
            if ($raw !== false) $manifest = @json_decode($raw, true);
        }
        $files = [];
        foreach (@scandir($kPath) ?: [] as $f) {
            if ($f === '.' || $f === '..' || $f[0] === '.') continue;
            $fp = $kPath . '/' . $f;
            if (!is_file($fp)) continue;
            $fInfo = ['file' => $k . '/' . $f, 'name' => $f, 'size' => filesize($fp), 'modified' => date('Y-m-d H:i:s', filemtime($fp))];
            // Prefix extrahieren (z.B. "layers" aus "layers_ewn.conf" oder "layers-GIS-oereb-wms_x.conf")
            $knownPfx = ['layers', 'maptips', 'lyrmgrResources', 'maptipsResources', 'legendResources'];
            $prefix = pathinfo($f, PATHINFO_FILENAME);
            foreach ($knownPfx as $pfx) {
                if (strpos($f, $pfx . '_') === 0 || strpos($f, $pfx . '-') === 0) {
                    $prefix = $pfx;
                    break;
                }
            }
            $fInfo['_prefix'] = $prefix;

            // JSON lesen und Top-Level-Keys indexieren
            $content = @file_get_contents($fp);
            if ($content !== false) {
                $decoded = @json_decode($content, true);
                if (is_array($decoded) && !empty($decoded)) {
                    // Nur assoziative Arrays (JSON-Objekte) indexieren
                    if (array_keys($decoded) !== range(0, count($decoded) - 1)) {
                        foreach (array_keys($decoded) as $topKey) {
                            $keyIndex[$prefix][$topKey][] = $k . '/' . $f;
                        }
                    }
                }
            }

            $files[] = $fInfo;
        }
        if (count($files)) {
            $entry = ['kuerzel' => $k, 'files' => $files, 'size' => array_sum(array_column($files, 'size'))];
            if ($manifest) {
                $entry['manifest'] = $manifest;
                // Change-Detection: Manifest-Quelldateien gegen aktuelle raw-conf vergleichen
                $entry['sourceChanges'] = checkSourceChanges($manifest, $rawDir);
            }
            $rawKuerzel[] = $entry;
        }
    }

    // 2. Pass: Cross-Kürzel-Duplikate erkennen (Key erscheint in >1 Datei desselben Prefix-Typs)
    // Nur wenn die Dateien aus VERSCHIEDENEN Kürzel-Ordnern stammen
    foreach ($rawKuerzel as &$kEntry) {
        foreach ($kEntry['files'] as &$fInfo) {
            $prefix = $fInfo['_prefix'];
            $crossDups = [];
            if (isset($keyIndex[$prefix])) {
                $thisFile = $fInfo['file']; // z.B. "ewn/layers_ewn.conf"
                foreach ($keyIndex[$prefix] as $topKey => $sources) {
                    // Nur wenn dieser Key in DIESER Datei vorkommt UND es andere Dateien gibt
                    if (in_array($thisFile, $sources) && count($sources) > 1) {
                        $otherFiles = array_values(array_filter($sources, function($s) use ($thisFile) {
                            return $s !== $thisFile;
                        }));
                        if (!empty($otherFiles)) {
                            $crossDups[] = ['key' => $topKey, 'conflictsWith' => $otherFiles];
                        }
                    }
                }
            }
            if (!empty($crossDups)) {
                $fInfo['crossDuplicateKeys'] = $crossDups;
            }
            unset($fInfo['_prefix']); // Hilfsfeld entfernen
        }
        unset($fInfo);
    }
    unset($kEntry);

    return ['exists' => true, 'kuerzel' => $rawKuerzel];
}

/**
 * Datei aus ImportToCore lesen
 */
function readImportToCoreFile($relPath) {
    if (useStagingImportDb()) {
        return readImportToCoreFileDb($relPath);
    }
    if (strpos($relPath, '..') !== false || strpos($relPath, '\\') !== false)
        return ['success' => false, 'error' => 'Ungültiger Pfad'];
    $fullPath = IMPORT_TO_CORE_DIR . '/' . $relPath;
    if (!is_file($fullPath)) return ['success' => false, 'error' => 'Datei nicht gefunden: ' . $relPath];
    $content = @file_get_contents($fullPath);
    if ($content === false) return ['success' => false, 'error' => 'Lesefehler'];
    return ['success' => true, 'content' => $content, 'size' => strlen($content), 'file' => $relPath];
}

/**
 * Datei in ImportToCore schreiben (ohne Backup)
 */
function writeImportToCoreFile($relPath, $content) {
    if (useStagingImportDb()) {
        return writeImportToCoreFileDb($relPath, $content);
    }
    if (strpos($relPath, '..') !== false || strpos($relPath, '\\') !== false)
        return ['success' => false, 'error' => 'Ungültiger Pfad'];
    $fullPath = IMPORT_TO_CORE_DIR . '/' . $relPath;
    if (!is_file($fullPath)) return ['success' => false, 'error' => 'Datei nicht gefunden (nur bestehende bearbeiten)'];
    $bytes = @file_put_contents($fullPath, $content);
    if ($bytes === false) return ['success' => false, 'error' => 'Schreibfehler'];
    return ['success' => true, 'bytes' => $bytes];
}

/**
 * Kürzel-Verzeichnisse aus ImportToCore löschen
 */
function deleteImportToCoreKuerzel(array $kuerzelList) {
    if (useStagingImportDb()) {
        return deleteImportToCoreKuerzelDb($kuerzelList);
    }
    $dir = IMPORT_TO_CORE_DIR;
    $deleted = []; $errors = [];
    foreach ($kuerzelList as $k) {
        if (strpos($k, '..') !== false || strpos($k, '/') !== false || strpos($k, '\\') !== false)
            { $errors[] = 'Ungültiger Name: ' . $k; continue; }
        $kPath = $dir . '/' . $k;
        if (!is_dir($kPath)) { $errors[] = 'Nicht gefunden: ' . $k; continue; }
        $ok = true;
        foreach (@scandir($kPath) ?: [] as $f) {
            if ($f === '.' || $f === '..') continue;
            if (!@unlink($kPath . '/' . $f)) { $ok = false; $errors[] = 'Konnte nicht löschen: ' . $k . '/' . $f; }
        }
        if ($ok && @rmdir($kPath)) $deleted[] = $k;
        else $errors[] = 'Verzeichnis-Löschen fehlgeschlagen: ' . $k;
    }
    return ['success' => true, 'deleted' => $deleted, 'errors' => $errors];
}

function stageServicesToImportToCore(array $serviceKeys, string $kuerzel, string $mode = 'replace', string $scope = 'core', ?string $profile = null) {
    if (useStagingImportDb()) {
        return stageServicesToImportDb($serviceKeys, $kuerzel, $mode, $scope, $profile);
    }
    $kuerzel = preg_replace('/[^a-zA-Z0-9_\-]/', '_', trim($kuerzel));
    if ($kuerzel === '') return ['success' => false, 'error' => 'Kürzel darf nicht leer sein'];
    if (!in_array($mode, ['merge', 'replace', 'preview'])) {
        return ['success' => false, 'error' => 'Ungültiger Modus: ' . $mode . ' (erlaubt: merge, replace, preview)'];
    }

    $rawDir = getWritableRawConfDir();
    if ($rawDir === false) $rawDir = RAW_CONF_DIR;

    // Zielordner erstellen
    $targetDir = IMPORT_TO_CORE_DIR . '/' . $kuerzel;
    if (!is_dir($targetDir)) {
        if ($mode === 'preview') {
            // Bei Preview ohne existierenden Ordner: leerer Merge
        } else {
            if (!@mkdir($targetDir, 0777, true)) {
                return ['success' => false, 'error' => 'Zielordner konnte nicht erstellt werden: ' . $targetDir];
            }
        }
    }

    // Bestehendes Manifest laden (für merge/preview)
    $manifestPath = $targetDir . '/.staging-manifest.json';
    $existingManifest = null;
    if (($mode === 'merge' || $mode === 'preview') && is_file($manifestPath)) {
        $raw = @file_get_contents($manifestPath);
        if ($raw !== false) $existingManifest = @json_decode($raw, true);
    }

    // Datei-Typ-Buckets (dynamisch, Key = Prefix vor erstem Unterstrich)
    $buckets    = [];
    $errors     = [];
    $skipped    = []; // Übersprungene Dateien mit Grund (für Debug-Ausgabe)

    foreach ($serviceKeys as $svcKey) {
        $svcDir = resolveRawConfServiceDir($rawDir, $svcKey);

        // Verzeichnis-basierte Struktur (group/service/ ODER service_dir/)
        if ($svcDir && is_dir($svcDir)) {
            $it = new RecursiveIteratorIterator(
                new RecursiveDirectoryIterator($svcDir, RecursiveDirectoryIterator::SKIP_DOTS),
                RecursiveIteratorIterator::LEAVES_ONLY
            );
            $svcFiles = iterator_to_array($it, false);
        } else {
            // Flache/verschachtelte Struktur: rekursiv anhand Service-Key sammeln
            $svcFiles = collectRawConfFilesByService($rawDir, $svcKey);
            if (empty($svcFiles)) { $errors[] = 'Dienst nicht gefunden: ' . $svcKey; continue; }
        }

        // Gefundene Dateien verarbeiten
        $it = new ArrayIterator($svcFiles);
        foreach ($it as $file) {
            $fname = $file->getFilename();
            if (preg_match('/\.\d{8}_\d{6}\.bak$/', $fname)) { $skipped[] = $fname . ' (Backup)'; continue; }
            if (preg_match('/\.xlsx$/i', $fname))             { $skipped[] = $fname . ' (Excel)';  continue; }

            $ext = strtolower(pathinfo($fname, PATHINFO_EXTENSION));
            if (!in_array($ext, ['conf', 'json'])) { $skipped[] = $fname . ' (Typ .' . $ext . ' nicht verarbeitbar)'; continue; }

            $content = @file_get_contents($file->getPathname());
            if ($content === false) { $errors[] = 'Lesefehler: ' . $file->getPathname(); continue; }

            $decoded = @json_decode($content, true);
            if ($decoded === null || !is_array($decoded)) {
                $errors[] = 'Kein gültiges JSON: ' . $fname;
                continue;
            }

            // Bucket-Key = Prefix (layers, maptips, lyrmgrResources, maptipsResources, legendResources)
            // Unterstützt sowohl _ als auch - als Trenner (Core-Dateien nutzen -)
            $knownPfx = ['layers', 'maptips', 'lyrmgrResources', 'maptipsResources', 'legendResources'];
            $prefix = pathinfo($fname, PATHINFO_FILENAME); // Fallback
            foreach ($knownPfx as $pfx) {
                if (strpos($fname, $pfx . '_') === 0 || strpos($fname, $pfx . '-') === 0) {
                    $prefix = $pfx;
                    break;
                }
            }

            // Prüfen ob Core-Datei (verwendet - statt _ als Separator)
            $usesDash = (strpos($fname, $prefix . '-') === 0);

            if (!isset($buckets[$prefix])) {
                $buckets[$prefix] = ['parts' => [], 'ext' => $ext, 'usesDash' => $usesDash];
            }
            $buckets[$prefix]['parts'][] = ['data' => $decoded, 'source' => $fname];
        }
    }

    // Ausgabe: pro Bucket eine Datei "<prefix>_<kuerzel>.<ext>"
    $written    = [];
    $duplicates = []; // Leer — Duplikat-Prüfung nur innerhalb ImportToCore, nicht raw-conf
    $dupMeta    = [];
    $mergeStats = []; // Pro Bucket: {added, updated, unchanged}
    $manifestSources = []; // Für .staging-manifest.json

    // Bestehende Manifest-Sources übernehmen (bei merge/preview)
    if (($mode === 'merge' || $mode === 'preview') && $existingManifest && isset($existingManifest['sources'])) {
        // Bestehende Sources übernehmen, aber aktuelle Services werden unten aktualisiert
        foreach ($existingManifest['sources'] as $src) {
            if (!in_array($src['service'], $serviceKeys)) {
                $manifestSources[$src['service']] = $src;
            }
        }
    }

    foreach ($buckets as $prefix => $bucket) {
        if (empty($bucket['parts'])) continue;

        // Output-Dateiname bestimmen:
        // Core-Dateien (mit -): Original-Name beibehalten (z.B. layers-GIS-oereb-wms.conf)
        // AGS-Dateien (mit _): Standard-Merge-Name (z.B. layers_ewn.conf)
        if (!empty($bucket['usesDash']) && count($bucket['parts']) === 1) {
            $outName = $bucket['parts'][0]['source']; // Original-Name beibehalten
        } else {
            $outName = $prefix . '_' . $kuerzel . '.' . $bucket['ext'];
        }
        $outPath  = $targetDir . '/' . $outName;
        $existingKeys = []; // Keys die schon in ImportToCore existieren
        if (($mode === 'merge' || $mode === 'preview') && is_file($outPath)) {
            $existContent = @file_get_contents($outPath);
            if ($existContent !== false) {
                $existDecoded = @json_decode($existContent, true);
                if (is_array($existDecoded)) {
                    $existingKeys = $existDecoded;
                }
            }
        }

        $merged   = ($mode === 'merge' || $mode === 'preview') ? $existingKeys : [];
        $isAssoc  = false;

        // Bestehende Keys prüfen für Merge-Statistik
        if (!empty($existingKeys) && array_keys($existingKeys) !== range(0, count($existingKeys) - 1)) {
            $isAssoc = true;
        }

        foreach ($bucket['parts'] as $part) {
            $arr    = $part['data'];
            // Prüfen ob assoziatives Array (JSON-Objekt) oder indexiertes Array
            if (!empty($arr) && array_keys($arr) !== range(0, count($arr) - 1)) {
                $isAssoc = true;
            }
            if ($isAssoc) {
                foreach ($arr as $k => $v) {
                    $merged[$k] = $v; // Letzter Wert gewinnt
                }
            } else {
                foreach ($arr as $v) { $merged[] = $v; }
            }
        }

        // Merge-Statistik berechnen (nur bei merge/preview + assoziative Arrays)
        $stats = ['added' => 0, 'updated' => 0, 'unchanged' => 0];
        if (($mode === 'merge' || $mode === 'preview') && $isAssoc && !empty($existingKeys)) {
            foreach ($merged as $k => $v) {
                if (!array_key_exists($k, $existingKeys)) {
                    $stats['added']++;
                } elseif ($v !== $existingKeys[$k]) {
                    $stats['updated']++;
                } else {
                    $stats['unchanged']++;
                }
            }
        }
        $mergeStats[$prefix] = $stats;

        // Bei Preview: nichts schreiben
        if ($mode === 'preview') {
            $written[] = ['file' => $kuerzel . '/' . $outName, 'bytes' => 0, 'keys' => count($merged),
                          'mergeStats' => $stats, 'preview' => true,
                          'duplicateKeys' => []];
            continue;
        }

        $json    = json_encode($merged, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $bytes   = @file_put_contents($outPath, $json);
        if ($bytes === false) {
            $errors[] = 'Schreibfehler: ' . $outName;
        } else {
            $written[] = ['file' => $kuerzel . '/' . $outName, 'bytes' => $bytes, 'keys' => count($merged),
                          'mergeStats' => $stats,
                          'duplicateKeys' => []];
        }
    }

    // Manifest-Sources für aktuelle Services ergänzen (inkl. Quell-Metadaten für Change-Detection)
    foreach ($serviceKeys as $svcKey) {
        // Services die nicht in raw-conf gefunden wurden NICHT ins Manifest schreiben,
        // damit sie bei der nächsten Change-Detection nicht als "missing" erscheinen.
        $svcDir = resolveRawConfServiceDir($rawDir, $svcKey);

        $svcKeyCounts = [];
        foreach ($buckets as $prefix => $bucket) {
            $count = 0;
            foreach ($bucket['parts'] as $part) {
                if (is_array($part['data'])) {
                    $count += count($part['data']);
                }
            }
            if ($count > 0) $svcKeyCounts[$prefix] = $count;
        }

        // Quelldatei-Metadaten erfassen (size + mtime für Change-Detection)
        // Unterstützt sowohl Verzeichnis-Struktur (group/service oder service_dir)
        // als auch flache raw-conf-Dateien.
        $srcFiles = [];
        if ($svcDir && is_dir($svcDir)) {
            $it = new RecursiveIteratorIterator(
                new RecursiveDirectoryIterator($svcDir, RecursiveDirectoryIterator::SKIP_DOTS),
                RecursiveIteratorIterator::LEAVES_ONLY
            );
            foreach ($it as $sf) {
                $sfn = $sf->getFilename();
                $sfExt = strtolower(pathinfo($sfn, PATHINFO_EXTENSION));
                if (!in_array($sfExt, ['conf', 'json'])) continue;
                if (preg_match('/\.\d{8}_\d{6}\.bak$/', $sfn)) continue;
                $srcFiles[] = ['file' => $sfn, 'size' => $sf->getSize(), 'modified' => date('Y-m-d H:i:s', $sf->getMTime())];
            }
        } else {
            foreach (collectRawConfFilesByService($rawDir, $svcKey) as $sf) {
                $sfn = $sf->getFilename();
                if (preg_match('/\.\d{8}_\d{6}\.bak$/', $sfn)) continue;
                $sfExt = strtolower(pathinfo($sfn, PATHINFO_EXTENSION));
                if (!in_array($sfExt, ['conf', 'json'])) continue;
                $srcFiles[] = [
                    'file' => $sfn,
                    'size' => $sf->getSize(),
                    'modified' => date('Y-m-d H:i:s', $sf->getMTime())
                ];
            }
        }

        if (empty($srcFiles)) continue;

        $manifestSources[$svcKey] = [
            'service'     => $svcKey,
            'staged'      => date('Y-m-d\TH:i:s'),
            'keys'        => $svcKeyCounts,
            'sourceFiles' => $srcFiles
        ];
    }

    // Metadaten für Duplikate speichern
    if ($mode !== 'preview') {
        $metaPath = $targetDir . '/.duplicates.json';
        if (!empty($dupMeta)) {
            @file_put_contents($metaPath, json_encode($dupMeta, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        } elseif (is_file($metaPath)) {
            @unlink($metaPath);
        }

        // Staging-Manifest schreiben
        $manifest = [
            'kuerzel'    => $kuerzel,
            'lastStaged' => date('Y-m-d\TH:i:s'),
            'mode'       => $mode,
            'sources'    => array_values($manifestSources),
            'buckets'    => []
        ];
        foreach ($written as $wf) {
            $parts = explode('/', $wf['file']);
            $fname = end($parts);
            $knownPfx2 = ['layers', 'maptips', 'lyrmgrResources', 'maptipsResources', 'legendResources'];
            $pfx = $fname;
            foreach ($knownPfx2 as $p) {
                if (strpos($fname, $p . '_') === 0 || strpos($fname, $p . '-') === 0) {
                    $pfx = $p;
                    break;
                }
            }
            $manifest['buckets'][$pfx] = ['file' => $fname, 'totalKeys' => $wf['keys']];
        }
        @file_put_contents($manifestPath, json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    }

    return [
        'success'    => true,
        'kuerzel'    => $kuerzel,
        'mode'       => $mode,
        'targetDir'  => $targetDir,
        'files'      => $written,
        'mergeStats' => $mergeStats,
        'duplicates' => $duplicates,
        'errors'     => $errors,
        'skipped'    => $skipped,
        'timestamp'  => date('Y-m-d H:i:s'),
    ];
}

// =====================================================================
// Staging → Flat Layer List (für Tree-Builder Embedding)
// =====================================================================

/**
 * Liest alle Konfigurationsdateien aus ImportToCore und liefert eine flache
 * Layer-Liste im gleichen Format wie layers.php?flat=true, angereichert mit
 * Alias-Namen, Maptip-Info und Legenden-Info.
 *
 * Gibt zusätzlich `supplements` zurück mit allen lyrmgr/maptip/legend-Daten,
 * damit der Tree-Builder die volle Konfiguration kennt.
 *
 * @param string $kuerzel  Optional: nur dieses Kürzel lesen. Leer = alle.
 * @return array  {success, data: [...], meta, supplements}
 */
function stagingLayersFlat($kuerzel = '') {
    if (useStagingImportDb()) {
        return stagingLayersFlatDb($kuerzel);
    }
    $dir = IMPORT_TO_CORE_DIR;
    if (!is_dir($dir)) return ['success' => false, 'error' => 'ImportToCore-Verzeichnis nicht gefunden'];

    // Bestimme welche Kürzel-Verzeichnisse gelesen werden
    if ($kuerzel) {
        $safe = preg_replace('/[^a-zA-Z0-9_\-]/', '_', trim($kuerzel));
        $kDirs = [$safe];
    } else {
        $kDirs = [];
        $entries = @scandir($dir);
        if (!$entries) return ['success' => true, 'data' => [], 'meta' => ['count' => 0]];
        foreach ($entries as $k) {
            if ($k === '.' || $k === '..') continue;
            if (is_dir($dir . '/' . $k)) $kDirs[] = $k;
        }
    }

    // ── Alle Config-Typen einlesen ──
    $nameMap = [];          // strtolower(layerKey) → Anzeige-Name
    $allAliases = [];       // alle lyrmgrResources Einträge (für Supplements)
    $maptipsByLayer = [];   // strtolower(linked_layer) → {key, nls, query_layers}
    $allMaptips = [];       // alle maptips_*.conf Einträge (key → {...})
    $allMaptipTexts = [];   // alle maptipsResources_*.json Einträge
    $allLegends = [];       // alle legendResources_*.json Einträge
    $layerFiles = [];       // [{kuerzel, file, decoded}]

    foreach ($kDirs as $k) {
        $kPath = $dir . '/' . $k;
        if (!is_dir($kPath)) continue;

        foreach (@scandir($kPath) ?: [] as $f) {
            if ($f === '.' || $f === '..' || $f[0] === '.') continue;
            $ext = strtolower(pathinfo($f, PATHINFO_EXTENSION));
            if (!in_array($ext, ['conf', 'json'])) continue;

            $raw = @file_get_contents($kPath . '/' . $f);
            if ($raw === false) continue;
            $decoded = @json_decode($raw, true);
            if (!is_array($decoded)) continue;

            // Dateityp erkennen
            if (strpos($f, 'lyrmgrResources_') === 0) {
                foreach ($decoded as $resKey => $resVal) {
                    $allAliases[$resKey] = $resVal;
                    if (strpos($resKey, 'desc_') === 0) {
                        // Case-insensitive Zuordnung: Keys können DEF vs def sein
                        $layerKey = strtolower(substr($resKey, 5));
                        $nameMap[$layerKey] = is_string($resVal) ? $resVal : (string)$resVal;
                    }
                }
            } elseif (strpos($f, 'maptips_') === 0) {
                foreach ($decoded as $mtKey => $mtDef) {
                    $allMaptips[$mtKey] = $mtDef;
                    $linked = $mtDef['linked_layer'] ?? '';
                    if ($linked) {
                        $maptipsByLayer[strtolower($linked)] = [
                            'key'          => $mtKey,
                            'nls'          => $mtDef['nls'] ?? '',
                            'query_layers' => $mtDef['query_layers'] ?? '',
                        ];
                    }
                }
            } elseif (strpos($f, 'maptipsResources_') === 0) {
                foreach ($decoded as $trKey => $trVal) {
                    $allMaptipTexts[$trKey] = $trVal;
                }
            } elseif (strpos($f, 'legendResources_') === 0) {
                foreach ($decoded as $lgKey => $lgVal) {
                    $allLegends[$lgKey] = $lgVal;
                }
            } elseif (strpos($f, 'layers_') === 0 && $ext === 'conf') {
                $layerFiles[] = ['kuerzel' => $k, 'file' => $f, 'decoded' => $decoded];
            }
        }
    }

    // ── Sublayer-Zählung: wie viele lyrmgr-Einträge je Service ──
    $sublayerCount = [];
    foreach ($nameMap as $lk => $name) {
        $prefix = $lk . '/';
        foreach ($nameMap as $otherKey => $otherName) {
            if (strpos($otherKey, $prefix) === 0) {
                $sublayerCount[$lk] = ($sublayerCount[$lk] ?? 0) + 1;
            }
        }
    }

    // ── Flache Layer-Liste aufbauen ──
    // Maptips und Legenden sind auf Sublayer-Ebene definiert, Layer auf Service-Ebene.
    // → Prefix-Match: Layer hat Maptips wenn irgendein Maptip-linked_layer mit dem Key beginnt.
    $flatLayers = [];
    foreach ($layerFiles as $lf) {
        foreach ($lf['decoded'] as $layerKey => $layerDef) {
            $lkLower = strtolower($layerKey);
            $alias   = $nameMap[$lkLower] ?? null;
            $legend  = $layerDef['legend'] ?? null;

            // Prefix-Match: Maptips für diesen Service sammeln
            $maptipCount = 0;
            $firstMaptipNls = null;
            $firstMaptipTitle = null;
            $lkPrefix = $lkLower . '/';
            foreach ($maptipsByLayer as $mlKey => $mlVal) {
                // Exakt-Match (Layer = Sublayer) oder Prefix (Layer ist Service)
                if ($mlKey === $lkLower || strpos($mlKey, $lkPrefix) === 0) {
                    $maptipCount++;
                    if (!$firstMaptipNls && $mlVal['nls']) {
                        $firstMaptipNls = $mlVal['nls'];
                        $titleKey = $mlVal['nls'] . '_title';
                        $firstMaptipTitle = $allMaptipTexts[$titleKey] ?? null;
                    }
                }
            }

            // Prefix-Match: Legenden für diesen Service zählen
            $legendCount = 0;
            $firstLegendTitle = null;
            foreach ($allLegends as $lgKey => $lgVal) {
                // legendResources-Keys: <layerKey>_title, <layerKey>_link
                if (strpos(strtolower($lgKey), $lkLower) === 0) {
                    if (substr($lgKey, -6) === '_title') {
                        $legendCount++;
                        if (!$firstLegendTitle) $firstLegendTitle = $lgVal;
                    }
                }
            }

            $flatLayers[] = [
                'id'          => $layerKey,
                'name'        => $alias ?: $layerKey,
                'alias'       => $alias,
                'url'         => $layerDef['url'] ?? '',
                'type'        => $layerDef['type'] ?? 'unknown',
                'layerType'   => $layerDef['type'] ?? 'unknown',
                'visible'     => $layerDef['visible'] ?? 0,
                'icon'        => $layerDef['icon'] ?? '',
                'params'      => $layerDef['params'] ?? null,
                'options'     => $layerDef['options'] ?? null,
                'hasMaptip'   => $maptipCount > 0,
                'maptipCount' => $maptipCount,
                'maptipNls'   => $firstMaptipNls,
                'maptipTitle' => $firstMaptipTitle,
                'hasLegend'   => $legendCount > 0,
                'legendCount' => $legendCount,
                'legendKey'   => $legend,
                'legendTitle' => $firstLegendTitle,
                'sublayers'   => $sublayerCount[$lkLower] ?? 0,
                '_source'     => $lf['kuerzel'],
                '_file'       => $lf['file'],
            ];
        }
    }

    return [
        'success' => true,
        'data'    => $flatLayers,
        'meta'    => [
            'kuerzel' => $kuerzel ?: '(alle)',
            'count'   => count($flatLayers),
            'format'  => 'flat',
            'source'  => 'staging-importtocore',
            'aliases' => count($allAliases),
            'maptips' => count($allMaptips),
            'legends' => count($allLegends),
        ],
        'supplements' => [
            'aliases'    => $allAliases,
            'maptips'    => $allMaptips,
            'maptipTexts'=> $allMaptipTexts,
            'legends'    => $allLegends,
        ]
    ];
}

// =====================================================================
// Config-Editor: Laden & Export nach Core
// =====================================================================

/**
 * Alle Dateien eines Kürzels aus ImportToCore laden.
 * Gibt pro Datei den Inhalt als JSON-Objekt zurück, sortiert nach Prefix-Typ.
 */
function configEditorLoad($kuerzel) {
    if (useStagingImportDb()) {
        return configEditorLoadDb($kuerzel);
    }
    $safe = preg_replace('/[^a-zA-Z0-9_\-]/', '_', trim($kuerzel));
    if ($safe === '') return ['success' => false, 'error' => 'Kürzel darf nicht leer sein'];

    $dir = IMPORT_TO_CORE_DIR . '/' . $safe;
    if (!is_dir($dir)) return ['success' => false, 'error' => 'Kürzel-Ordner nicht gefunden: ' . $safe];

    $result = ['kuerzel' => $safe, 'files' => []];
    $entries = @scandir($dir);
    if (!$entries) return ['success' => false, 'error' => 'Ordner konnte nicht gelesen werden'];

    foreach ($entries as $f) {
        if ($f === '.' || $f === '..' || $f[0] === '.') continue;
        $fp = $dir . '/' . $f;
        if (!is_file($fp)) continue;

        $ext = strtolower(pathinfo($f, PATHINFO_EXTENSION));
        if (!in_array($ext, ['conf', 'json'])) continue;

        $content = @file_get_contents($fp);
        if ($content === false) continue;
        $decoded = @json_decode($content, true);
        if ($decoded === null) continue;

        // Prefix extrahieren (layers, maptips, lyrmgrResources, maptipsResources, legendResources)
        // Unterstützt sowohl _ als auch - als Trenner (Core-Dateien nutzen -)
        $knownPrefixes = ['layers', 'maptips', 'lyrmgrResources', 'maptipsResources', 'legendResources'];
        $prefix = 'unknown';
        $basename = pathinfo($f, PATHINFO_FILENAME);
        foreach ($knownPrefixes as $pfx) {
            if (strpos($basename, $pfx . '_') === 0 || strpos($basename, $pfx . '-') === 0 || $basename === $pfx) {
                $prefix = $pfx;
                break;
            }
        }

        // Typ bestimmen
        $type = 'unknown';
        if ($prefix === 'layers')                $type = 'layers';
        elseif ($prefix === 'maptips')           $type = 'maptips';
        elseif ($prefix === 'lyrmgrResources')   $type = 'lyrmgr';
        elseif ($prefix === 'maptipsResources')  $type = 'maptipsRes';
        elseif ($prefix === 'legendResources')   $type = 'legendRes';

        $result['files'][] = [
            'name'     => $f,
            'type'     => $type,
            'prefix'   => $prefix,
            'keys'     => count($decoded),
            'size'     => filesize($fp),
            'modified' => date('Y-m-d H:i:s', filemtime($fp)),
            'data'     => $decoded
        ];
    }

    // Manifest laden if vorhanden
    $manifestPath = $dir . '/.staging-manifest.json';
    if (is_file($manifestPath)) {
        $raw = @file_get_contents($manifestPath);
        if ($raw !== false) $result['manifest'] = @json_decode($raw, true);
    }

    return ['success' => true, 'data' => $result];
}

/**
 * Geänderte Daten eines Dateityps zurück in ImportToCore schreiben.
 */
function configEditorSave($kuerzel, $fileName, $data, array $changedKeys = []) {
    if (useStagingImportDb()) {
        return configEditorSaveDb($kuerzel, $fileName, $data, $changedKeys);
    }
    $safe = preg_replace('/[^a-zA-Z0-9_\-]/', '_', trim($kuerzel));
    if ($safe === '') return ['success' => false, 'error' => 'Kürzel darf nicht leer sein'];
    if (strpos($fileName, '..') !== false || strpos($fileName, '/') !== false)
        return ['success' => false, 'error' => 'Ungültiger Dateiname'];

    $dir = IMPORT_TO_CORE_DIR . '/' . $safe;
    if (!is_dir($dir)) return ['success' => false, 'error' => 'Kürzel-Ordner nicht gefunden'];

    $path = $dir . '/' . $fileName;
    if (!is_file($path)) return ['success' => false, 'error' => 'Datei nicht gefunden: ' . $fileName];

    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) return ['success' => false, 'error' => 'JSON-Encode Fehler: ' . json_last_error_msg()];

    $bytes = @file_put_contents($path, $json);
    if ($bytes === false) return ['success' => false, 'error' => 'Schreiben fehlgeschlagen: ' . $path];

    return ['success' => true, 'file' => $fileName, 'bytes' => $bytes, 'keys' => count($data),
            'timestamp' => date('Y-m-d H:i:s')];
}

/**
 * Dateien aus ImportToCore/<kuerzel>/ in die Core-Verzeichnisse exportieren.
 * Erstellt Backups der bestehenden Core-Dateien.
 *
 * Ziel-Pfade:
 *   layers_*.conf / maptips_*.conf    → $docRoot/core/config/
 *   lyrmgrResources_*.json / maptipsResources_*.json → $docRoot/core/nls/de/
 */
function configExportToCore($kuerzel) {
    if (useStagingImportDb()) {
        return configExportToCoreDb($kuerzel);
    }
    global $docRoot;
    $safe = preg_replace('/[^a-zA-Z0-9_\-]/', '_', trim($kuerzel));
    if ($safe === '') return ['success' => false, 'error' => 'Kürzel darf nicht leer sein'];

    $srcDir = IMPORT_TO_CORE_DIR . '/' . $safe;
    if (!is_dir($srcDir)) return ['success' => false, 'error' => 'Quell-Ordner nicht gefunden'];

    $coreConfigDir = CORE_CONFIG_DIR;
    $coreNlsDir    = CORE_NLS_DIR;

    // Prüfen ob Zielverzeichnisse existieren
    if (!is_dir($coreConfigDir)) return ['success' => false, 'error' => 'core/config/ nicht gefunden auf Server'];
    if (!is_dir($coreNlsDir))    return ['success' => false, 'error' => 'core/nls/de/ nicht gefunden auf Server'];

    $exported = [];
    $errors   = [];
    $backups  = [];
    $ts       = date('Ymd_His');

    $entries = @scandir($srcDir);
    if (!$entries) return ['success' => false, 'error' => 'Quell-Ordner nicht lesbar'];

    foreach ($entries as $f) {
        if ($f === '.' || $f === '..' || $f[0] === '.') continue;
        $fp = $srcDir . '/' . $f;
        if (!is_file($fp)) continue;

        $ext = strtolower(pathinfo($f, PATHINFO_EXTENSION));
        if (!in_array($ext, ['conf', 'json'])) continue;

        // Prefix ermitteln → Zielverzeichnis
        // Unterstützt sowohl _ als auch - als Trenner (Core-Dateien nutzen -)
        $knownPrefixes = ['layers', 'maptips', 'lyrmgrResources', 'maptipsResources', 'legendResources'];
        $basename = pathinfo($f, PATHINFO_FILENAME);
        $prefix = '';
        foreach ($knownPrefixes as $pfx) {
            if (strpos($basename, $pfx . '_') === 0 || strpos($basename, $pfx . '-') === 0 || $basename === $pfx) {
                $prefix = $pfx;
                break;
            }
        }

        $targetDir = '';
        if (in_array($prefix, ['layers', 'maptips'])) {
            $targetDir = $coreConfigDir;
        } elseif (in_array($prefix, ['lyrmgrResources', 'maptipsResources', 'legendResources'])) {
            $targetDir = $coreNlsDir;
        } else {
            continue; // Unbekannter Prefix → überspringen
        }

        $targetPath = $targetDir . '/' . $f;

        // Backup falls Datei bereits existiert
        if (is_file($targetPath)) {
            $backupPath = $targetPath . '.' . $ts . '.bak';
            if (@copy($targetPath, $backupPath)) {
                $backups[] = $f . ' → ' . basename($backupPath);
            }
        }

        // Kopieren
        if (@copy($fp, $targetPath)) {
            $exported[] = ['file' => $f, 'target' => str_replace($docRoot, '', $targetPath), 'bytes' => filesize($fp)];
        } else {
            $errors[] = 'Kopieren fehlgeschlagen: ' . $f . ' → ' . $targetPath;
        }
    }

    return [
        'success'   => count($errors) === 0,
        'kuerzel'   => $safe,
        'exported'  => $exported,
        'backups'   => $backups,
        'errors'    => $errors,
        'timestamp' => date('Y-m-d H:i:s')
    ];
}

// =====================================================================
// DB-Export-Pipeline (export-catalog-artifacts / deploy-catalog-artifacts)
// =====================================================================

/**
 * Bestimmt den Deploy-Zielpfad (SFTP) für eine Conf-Datei anhand von Scope und Dateiname.
 * Gibt null zurück wenn der Dateiname keinem bekannten Bucket entspricht.
 *
 * @param string      $filename  Dateiname (z.B. 'layers_ewn.conf')
 * @param string      $scope     'core', 'sitecore'/'override', 'profile'
 * @param string|null $profile   Profilname (nur bei scope=profile)
 * @param bool        $isDev     true = maps-dev, false = maps
 */
function catalogArtifactDeployPath(string $filename, string $scope, ?string $profile, bool $isDev): ?string {
    $ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
    if (!in_array($ext, ['conf', 'json'], true)) {
        return null;
    }

    $base    = pathinfo($filename, PATHINFO_FILENAME);
    $isNls   = (strpos($base, 'Resources') !== false);
    $appSlug = $isDev ? 'maps-dev' : 'maps';

    if ($scope === 'core') {
        // core(-dev)/config/ oder core(-dev)/nls/de/
        $coreSlug = 'core'; // DEV und PROD nutzen gleiches /www/core/
        $dir      = $isNls ? "/www/{$coreSlug}/nls/de/" : "/www/{$coreSlug}/config/";
    } elseif (in_array($scope, ['sitecore', 'override'], true)) {
        // maps(-dev)/core/config/ oder maps(-dev)/core/nls/de/
        $dir = $isNls ? "/www/{$appSlug}/core/nls/de/" : "/www/{$appSlug}/core/config/";
    } elseif ($scope === 'profile') {
        $safeProf = preg_replace('/[^a-zA-Z0-9_\-]/', '', $profile ?: 'public');
        $dir      = ($safeProf === '' || $safeProf === 'public')
            ? "/www/{$appSlug}/public/config/"
            : "/www/{$appSlug}/public/config/{$safeProf}/";
    } else {
        return null;
    }

    return $dir . $filename;
}

/**
 * Alle DB-Bundle-Dateien in den Staging-Bereich schreiben und ein Deploy-Manifest anlegen.
 *
 * Input (JSON-Body):
 *   scopes    string[]   Zu exportierende Scopes ('core', 'sitecore', 'profile')
 *                        Fehlt das Feld → alle Scopes
 *   profile   string     Filter auf einen Profilnamen (optional; bei scope=profile)
 *   targetEnv string     'dev' oder 'prod' (default: aus APP_BASE_PATH)
 *   includeNls bool      NLS-Dateien mit exportieren (default: true)
 *
 * Output: {runId, createdAt, files[], manifestPath}
 */
function exportCatalogArtifacts(array $body): array {
    $isDev     = (APP_BASE_PATH === '/maps-dev');
    $targetEnv = isset($body['targetEnv']) ? strtolower(trim($body['targetEnv'])) : ($isDev ? 'dev' : 'prod');
    $isDeplDev = ($targetEnv === 'dev' || $targetEnv === 'maps-dev');
    $includeNls = !isset($body['includeNls']) || (bool)$body['includeNls'];
    $mergeName = preg_replace('/[^a-zA-Z0-9_\-]/', '_', trim((string)($body['mergeName'] ?? '')));
    $isMergeMode = ($mergeName !== '');
    $filterScopes = isset($body['scopes']) && is_array($body['scopes'])
        ? array_map('strtolower', $body['scopes'])
        : ['core', 'sitecore', 'override', 'profile'];
    $filterKuerzel = [];
    if (isset($body['kuerzel'])) {
        $raw = is_array($body['kuerzel']) ? $body['kuerzel'] : [$body['kuerzel']];
        foreach ($raw as $k) {
            $safe = preg_replace('/[^a-zA-Z0-9_\-]/', '', (string)$k);
            if ($safe !== '') {
                $filterKuerzel[] = strtolower($safe);
            }
        }
        $filterKuerzel = array_values(array_unique($filterKuerzel));
    }

    // Alle Bundles laden
    $bundles = StagingImportRepository::loadAllSafe();
    if (empty($bundles)) {
        return ['success' => false, 'error' => 'Keine Bundles in der Datenbank gefunden'];
    }

    $runId      = date('Ymd_His') . '_' . substr(md5(uniqid('', true)), 0, 6);
    $createdAt  = date('c');
    $manifestEntries = [];
    $written    = 0;
    $errors     = [];
    $mergedKuerzel = [];
    $mergeBuckets = [];

    foreach ($bundles as $bundle) {
        $scope      = $bundle['scope'] ?? 'core';
        $profile    = $bundle['profile'] ?? null;
        $bundleKuerzel = strtolower((string)($bundle['kuerzel'] ?? ''));

        // Scope-Filter
        if (!in_array($scope, $filterScopes, true)) {
            continue;
        }
        // Optionaler Kürzel-Filter
        if (!empty($filterKuerzel) && !in_array($bundleKuerzel, $filterKuerzel, true)) {
            continue;
        }
        if ($bundleKuerzel !== '') {
            $mergedKuerzel[$bundleKuerzel] = true;
        }

        $files = $bundle['files'] ?? [];
        foreach ($files as $fileObj) {
            $filename = $fileObj['name'] ?? '';
            $content  = $fileObj['data'] ?? null;
            if ($filename === '' || $content === null) {
                continue;
            }

            $ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
            if (!in_array($ext, ['conf', 'json'], true)) {
                continue;
            }

            // NLS-Filter
            if (!$includeNls && strpos(pathinfo($filename, PATHINFO_FILENAME), 'Resources') !== false) {
                continue;
            }

            // Nur finale Katalog-Dateitypen exportieren; Metadateien still überspringen.
            $known = ['layers', 'maptips', 'lyrmgrResources', 'maptipsResources', 'legendResources'];
            $prefix = null;
            foreach ($known as $pfx) {
                if (strpos($filename, $pfx . '_') === 0 || strpos($filename, $pfx . '-') === 0) {
                    $prefix = $pfx;
                    break;
                }
            }
            if ($prefix === null) {
                continue;
            }

            // Merge-Modus: Dateien typbasiert zu einem Zielnamen bündeln
            if ($isMergeMode) {
                $targetFilename = $prefix . '_' . $mergeName . '.' . $ext;
                $mergeKey = $scope . '|' . (string)$profile . '|' . $targetFilename;
                if (!isset($mergeBuckets[$mergeKey])) {
                    $mergeBuckets[$mergeKey] = [
                        'scope' => $scope,
                        'profile' => $profile,
                        'filename' => $targetFilename,
                        'parts' => [],
                    ];
                }
                $mergeBuckets[$mergeKey]['parts'][] = [
                    'kuerzel' => $bundle['kuerzel'] ?? '',
                    'content' => $content,
                ];
                continue;
            }

            // Deploy-Zielpfad ermitteln
            $deployPath = catalogArtifactDeployPath($filename, $scope, $profile, $isDeplDev);
            if ($deployPath === null) {
                $errors[] = "Kein Deploy-Pfad für {$filename} (scope={$scope})";
                continue;
            }

            // Staged-Pfad: finale Zielstruktur unter config-export spiegeln
            $deployRelPath = ltrim(preg_replace('#^/www/#', '', $deployPath), '/');
            $stagedLocalPath = TnetTmpPaths::configExport($deployRelPath);
            $stagedLocalDir = dirname($stagedLocalPath);
            if (!is_dir($stagedLocalDir)) {
                @mkdir($stagedLocalDir, 0775, true);
            }

            // Inhalt serialisieren
            if (is_array($content)) {
                $json = json_encode($content, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
                if ($json === false) {
                    $errors[] = "JSON-Encode fehlgeschlagen: {$filename}";
                    continue;
                }
                $rawContent = $json;
            } else {
                $rawContent = (string)$content;
            }

            $bytes = @file_put_contents($stagedLocalPath, $rawContent);
            if ($bytes === false) {
                $errors[] = "Schreiben fehlgeschlagen: {$stagedLocalPath}";
                continue;
            }

            $sha256 = hash('sha256', $rawContent);
            $manifestEntries[] = [
                'runId'      => $runId,
                'kuerzel'    => $bundle['kuerzel'] ?? '',
                'scope'      => $scope,
                'profile'    => $profile,
                'filename'   => $filename,
                'stagedPath' => toSftpPath($stagedLocalPath),
                'deployPath' => $deployPath,
                'sha256'     => $sha256,
                'bytes'      => $bytes,
                'revision'   => $bundle['lastImportedAt'] ?? null,
            ];
            $written++;
        }
    }

    // Merge-Buckets schreiben (wenn mergeName gesetzt)
    if ($isMergeMode) {
        foreach ($mergeBuckets as $bucket) {
            $scope = $bucket['scope'];
            $profile = $bucket['profile'];
            $filename = $bucket['filename'];
            $deployPath = catalogArtifactDeployPath($filename, $scope, $profile, $isDeplDev);
            if ($deployPath === null) {
                $errors[] = "Kein Deploy-Pfad für Merge-Datei {$filename}";
                continue;
            }

            $mergedAssoc = [];
            $mergedList = [];
            $mergedListSeen = [];
            $hasAssoc = false;
            $hasList = false;
            $hasValid = false;
            foreach ($bucket['parts'] as $part) {
                $data = $part['content'];
                if (!is_array($data)) {
                    $decoded = @json_decode((string)$data, true);
                    if (!is_array($decoded)) continue;
                    $data = $decoded;
                }
                $hasValid = true;
                $isAssoc = (!empty($data) && array_keys($data) !== range(0, count($data) - 1));
                if ($isAssoc) {
                    $hasAssoc = true;
                    foreach ($data as $k => $v) {
                        $mergedAssoc[$k] = $v; // Letzter Wert gewinnt, dadurch keine doppelten Keys.
                    }
                } else {
                    $hasList = true;
                    foreach ($data as $v) {
                        if (is_scalar($v) || $v === null) {
                            $sig = gettype($v) . ':' . (string)$v;
                        } else {
                            $sig = json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
                            if ($sig === false) {
                                $sig = serialize($v);
                            }
                        }
                        if (isset($mergedListSeen[$sig])) continue;
                        $mergedListSeen[$sig] = true;
                        $mergedList[] = $v;
                    }
                }
            }
            if (!$hasValid) {
                $errors[] = "Merge-Datei ohne gültige Daten: {$filename}";
                continue;
            }

            $merged = $hasAssoc ? $mergedAssoc : $mergedList;
            if ($hasAssoc && $hasList) {
                foreach ($mergedList as $v) {
                    $merged[] = $v;
                }
            }

            $rawContent = json_encode($merged, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            if ($rawContent === false) {
                $errors[] = "JSON-Encode fehlgeschlagen (Merge): {$filename}";
                continue;
            }

            $deployRelPath = ltrim(preg_replace('#^/www/#', '', $deployPath), '/');
            $stagedLocalPath = TnetTmpPaths::configExport('merge/' . $mergeName . '/' . $deployRelPath);
            $stagedLocalDir = dirname($stagedLocalPath);
            if (!is_dir($stagedLocalDir)) {
                @mkdir($stagedLocalDir, 0775, true);
            }
            $bytes = @file_put_contents($stagedLocalPath, $rawContent);
            if ($bytes === false) {
                $errors[] = "Schreiben fehlgeschlagen (Merge): {$stagedLocalPath}";
                continue;
            }

            $manifestEntries[] = [
                'runId'      => $runId,
                'kuerzel'    => $mergeName,
                'scope'      => $scope,
                'profile'    => $profile,
                'filename'   => $filename,
                'stagedPath' => toSftpPath($stagedLocalPath),
                'deployPath' => $deployPath,
                'sha256'     => hash('sha256', $rawContent),
                'bytes'      => $bytes,
                'revision'   => null,
            ];
            $written++;
        }
    }

    // Manifest schreiben
    $manifestDir   = TnetTmpPaths::configExport();
    if (!is_dir($manifestDir)) {
        @mkdir($manifestDir, 0775, true);
    }
    $manifestPath  = $manifestDir . '/deploy-manifest_' . $runId . '.json';
    $manifest = [
        'runId'      => $runId,
        'createdAt'  => $createdAt,
        'targetEnv'  => $targetEnv,
        'scopes'     => $filterScopes,
        'kuerzel'    => $filterKuerzel,
        'mergeName'  => $isMergeMode ? $mergeName : null,
        'mergedKuerzel' => array_values(array_keys($mergedKuerzel)),
        'includeNls' => $includeNls,
        'files'      => $manifestEntries,
        'errors'     => $errors,
    ];
    @file_put_contents(
        $manifestPath,
        json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
    );

    $readmePath = null;
    if ($isMergeMode) {
        $readmeLines = [];
        $readmeLines[] = 'MAP+ Temp-Merge Export';
        $readmeLines[] = 'RunId: ' . $runId;
        $readmeLines[] = 'Merge-Name: ' . $mergeName;
        $readmeLines[] = 'Target: ' . $targetEnv;
        $readmeLines[] = 'Zeit: ' . $createdAt;
        $readmeLines[] = '';
        $readmeLines[] = 'Gemergte Kuerzel:';
        foreach (array_values(array_keys($mergedKuerzel)) as $mk) {
            $readmeLines[] = '- ' . $mk;
        }
        $readmePath = TnetTmpPaths::configExport('merge/' . $mergeName . '/README.txt');
        $readmeDir = dirname($readmePath);
        if (!is_dir($readmeDir)) {
            @mkdir($readmeDir, 0775, true);
        }
        @file_put_contents($readmePath, implode("\n", $readmeLines) . "\n");
    }

    return [
        'success'        => count($errors) === 0,
        'runId'          => $runId,
        'createdAt'      => $createdAt,
        'written'        => $written,
        'errors'         => $errors,
        'mergeName'      => $isMergeMode ? $mergeName : null,
        'mergedKuerzel'  => array_values(array_keys($mergedKuerzel)),
        'readmePath'     => $readmePath ? toSftpPath($readmePath) : null,
        'manifestPath'   => toSftpPath($manifestPath),
        'manifestLocal'  => $manifestPath,
        'files'          => $manifestEntries,
    ];
}

/**
 * Staged Catalog-Artefakte via FastAPI /deploy-staged-conf ans definitive Ziel deployen.
 *
 * Input (JSON-Body):
 *   runId    string  Run-ID aus exportCatalogArtifacts (Manifest-Datei)
 *   dryRun   bool    Wenn true: nur Manifest auflisten, nicht deployen (default: false)
 *
 * Output: {success, runId, deployed[], failed[], dryRun}
 */
function deployCatalogArtifacts(array $body): array {
    $runId  = preg_replace('/[^a-zA-Z0-9_\-]/', '', $body['runId'] ?? '');
    $dryRun = !empty($body['dryRun']);

    if ($runId === '') {
        return ['success' => false, 'error' => 'Feld "runId" erforderlich'];
    }

    // Manifest suchen
    $manifestDir  = TnetTmpPaths::configExport();
    $manifestPath = $manifestDir . '/deploy-manifest_' . $runId . '.json';
    if (!file_exists($manifestPath)) {
        return ['success' => false, 'error' => 'Manifest nicht gefunden: deploy-manifest_' . $runId . '.json'];
    }
    $manifest = json_decode(file_get_contents($manifestPath), true);
    if (!$manifest || !isset($manifest['files'])) {
        return ['success' => false, 'error' => 'Manifest ungültig oder leer'];
    }

    if ($dryRun) {
        return [
            'success' => true,
            'runId'   => $runId,
            'dryRun'  => true,
            'files'   => $manifest['files'],
            'count'   => count($manifest['files']),
        ];
    }

    // FastAPI-Endpoint URL ermitteln
    $target    = $manifest['targetEnv'] ?? (APP_BASE_PATH === '/maps-dev' ? 'dev' : 'prod');
    $fastapiUrl = AGS_API_BASE . '/deploy-staged-conf?target=' . urlencode($target);

    $deployed = [];
    $failed   = [];

    foreach ($manifest['files'] as $fileEntry) {
        $stagedPath = $fileEntry['stagedPath'] ?? '';
        $deployPath = $fileEntry['deployPath'] ?? '';
        $filename   = $fileEntry['filename'] ?? '';

        if ($stagedPath === '' || $deployPath === '') {
            $failed[] = ['filename' => $filename, 'error' => 'stagedPath oder deployPath fehlt'];
            continue;
        }

        // FastAPI aufrufen
        $payload = json_encode(['stagedPath' => $stagedPath, 'deployPath' => $deployPath]);
        $ch = curl_init($fastapiUrl);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $payload,
            CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 30,
        ]);
        $response    = curl_exec($ch);
        $httpCode    = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError   = curl_error($ch);
        curl_close($ch);

        if ($curlError) {
            $failed[] = ['filename' => $filename, 'error' => 'cURL-Fehler: ' . $curlError];
            continue;
        }

        $result = @json_decode($response, true);
        if ($httpCode !== 200 || empty($result['success'])) {
            $failed[] = [
                'filename'   => $filename,
                'httpCode'   => $httpCode,
                'error'      => ($result['detail'] ?? $result['error'] ?? 'Unbekannter Fehler'),
                'stagedPath' => $stagedPath,
                'deployPath' => $deployPath,
            ];
            continue;
        }

        $deployed[] = [
            'filename'   => $filename,
            'deployPath' => $deployPath,
            'bytes'      => $result['data']['bytes'] ?? null,
            'backup'     => $result['data']['backup'] ?? null,
        ];
    }

    return [
        'success'       => count($failed) === 0,
        'runId'         => $runId,
        'dryRun'        => false,
        'deployed'      => $deployed,
        'failed'        => $failed,
        'deployedCount' => count($deployed),
        'failedCount'   => count($failed),
        'timestamp'     => date('c'),
    ];
}


function readLock() {
    if (!file_exists(LOCK_FILE)) return null;
    $data = json_decode(file_get_contents(LOCK_FILE), true);
    if (!$data) return null;

    // Abgelaufener Lock → automatisch freigeben
    if (isset($data['timestamp']) && (time() - $data['timestamp']) > LOCK_TIMEOUT) {
        @unlink(LOCK_FILE);
        return null;
    }
    return $data;
}

function acquireLock($editor) {
    $existing = readLock();

    // Bereits von diesem Editor gesperrt → Lock erneuern
    if ($existing && $existing['editor'] === $editor) {
        $lock = [
            'editor'    => $editor,
            'timestamp' => time(),
            'datetime'  => date('Y-m-d H:i:s'),
            'ip'        => $_SERVER['REMOTE_ADDR'] ?? 'unknown'
        ];
        file_put_contents(LOCK_FILE, json_encode($lock, JSON_PRETTY_PRINT));
        return ['acquired' => true, 'lock' => $lock];
    }

    // Von jemand anderem gesperrt
    if ($existing) {
        $age = time() - $existing['timestamp'];
        $remaining = LOCK_TIMEOUT - $age;
        return [
            'acquired'  => false,
            'lock'      => $existing,
            'age_min'   => round($age / 60, 1),
            'remaining_min' => round($remaining / 60, 1)
        ];
    }

    // Frei → Lock setzen
    $lock = [
        'editor'    => $editor,
        'timestamp' => time(),
        'datetime'  => date('Y-m-d H:i:s'),
        'ip'        => $_SERVER['REMOTE_ADDR'] ?? 'unknown'
    ];
    file_put_contents(LOCK_FILE, json_encode($lock, JSON_PRETTY_PRINT));
    return ['acquired' => true, 'lock' => $lock];
}

function releaseLock($editor) {
    $existing = readLock();
    if (!$existing) return ['released' => true, 'message' => 'Kein Lock vorhanden'];
    if ($existing['editor'] !== $editor) {
        return ['released' => false, 'message' => 'Lock gehört ' . $existing['editor']];
    }
    @unlink(LOCK_FILE);
    return ['released' => true];
}

// =====================================================================
// Save / Load
// =====================================================================
function saveState($data, $editor) {
    ensureDirs();

    // Lock prüfen
    $lock = readLock();
    if ($lock && $lock['editor'] !== $editor) {
        jsonError('Gesperrt von ' . $lock['editor'] . ' — Speichern nicht möglich', 423);
    }

    // Backup erstellen (wenn Datei existiert)
    if (file_exists(STATE_FILE)) {
        $ts = date('Ymd_His');
        $backupFile = BACKUP_DIR . '/state_' . $ts . '.json';
        @copy(STATE_FILE, $backupFile);
        cleanupBackups();
    }

    // Metadaten hinzufügen
    $data['_meta'] = [
        'savedBy'   => $editor,
        'savedAt'   => date('Y-m-d H:i:s'),
        'timestamp' => time(),
        'ip'        => $_SERVER['REMOTE_ADDR'] ?? 'unknown'
    ];

    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $bytes = file_put_contents(STATE_FILE, $json);

    if ($bytes === false) {
        jsonError('Speichern fehlgeschlagen', 500);
    }

    // Lock erneuern
    if ($lock && $lock['editor'] === $editor) {
        acquireLock($editor);
    }

    return [
        'saved'  => true,
        'bytes'  => $bytes,
        'backup' => isset($backupFile) ? basename($backupFile) : null
    ];
}

function loadState() {
    if (!file_exists(STATE_FILE)) {
        return ['exists' => false, 'data' => null];
    }
    $content = file_get_contents(STATE_FILE);
    $data = json_decode($content, true);
    if ($data === null) {
        jsonError('State-Datei ist korrupt', 500);
    }
    return ['exists' => true, 'data' => $data, 'size' => strlen($content)];
}

function cleanupBackups() {
    if (!is_dir(BACKUP_DIR)) return;
    $files = glob(BACKUP_DIR . '/state_*.json');
    if (count($files) <= MAX_BACKUPS) return;

    // Älteste löschen
    usort($files, function($a, $b) { return filemtime($a) - filemtime($b); });
    $toDelete = count($files) - MAX_BACKUPS;
    for ($i = 0; $i < $toDelete; $i++) {
        @unlink($files[$i]);
    }
}

function listHistory() {
    if (!is_dir(BACKUP_DIR)) return [];
    $files = glob(BACKUP_DIR . '/state_*.json');
    $result = [];
    foreach ($files as $f) {
        $result[] = [
            'file'     => basename($f),
            'size'     => filesize($f),
            'modified' => date('Y-m-d H:i:s', filemtime($f))
        ];
    }
    // Neuste zuerst
    usort($result, function($a, $b) { return strcmp($b['file'], $a['file']); });
    return $result;
}

/**
 * Alle Backups auflisten: BACKUP_DIR (state/lyrmgr/…) + RAW_CONF_DIR (.bak-Dateien)
 */
function listAllBackups() {
    $result    = [];
    $totalSize = 0;

    // ── BACKUP_DIR: state, lyrmgr, groups, profile, nls, legend ─────────────────
    if (is_dir(BACKUP_DIR)) {
        foreach (scandir(BACKUP_DIR) as $f) {
            if ($f === '.' || $f === '..') continue;
            $path = BACKUP_DIR . '/' . $f;
            if (!is_file($path)) continue;
            $size = filesize($path);
            $totalSize += $size;

            $type = 'unknown';
            if      (preg_match('/^state_/', $f))               $type = 'state';
            elseif  (preg_match('/^lyrmgr_/', $f))              $type = 'lyrmgr';
            elseif  (preg_match('/^groups_/', $f))              $type = 'groups';
            elseif  (preg_match('/^profile_/', $f))             $type = 'profile';
            elseif  (preg_match('/^lyrmgrResources_/', $f))     $type = 'nls';
            elseif  (preg_match('/^legendResources_/', $f))     $type = 'legend';

            $ts = '';
            if (preg_match('/(\d{8}_\d{6})/', $f, $m)) {
                $ts = substr($m[1],0,4).'-'.substr($m[1],4,2).'-'.substr($m[1],6,2)
                    . ' '.substr($m[1],9,2).':'.substr($m[1],11,2).':'.substr($m[1],13,2);
            }
            $result[] = ['file' => $f, 'type' => $type, 'size' => $size, 'timestamp' => $ts,
                         'modified' => date('Y-m-d H:i:s', filemtime($path))];
        }
    }

    // ── RAW_CONF_DIR: .bak-Dateien (Sicherungen überschriebener Conf-Dateien) ───
    $rawBase = (defined('RAW_CONF_DIR') && is_dir(RAW_CONF_DIR)) ? realpath(RAW_CONF_DIR) : null;
    if ($rawBase) {
        $iterator = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($rawBase, RecursiveDirectoryIterator::SKIP_DOTS),
            RecursiveIteratorIterator::LEAVES_ONLY
        );
        foreach ($iterator as $item) {
            if (!$item->isFile() || !isRawConfBackupFile($item->getFilename())) continue;
            $relPath = ltrim(str_replace('\\', '/', str_replace($rawBase, '', $item->getPathname())), '/');
            $size = $item->getSize();
            $totalSize += $size;
            $ts = '';
            if (preg_match('/\.(\d{8}_\d{6})\.bak$/', $item->getFilename(), $m)) {
                $d = $m[1];
                $ts = substr($d,0,4).'-'.substr($d,4,2).'-'.substr($d,6,2)
                    . ' '.substr($d,9,2).':'.substr($d,11,2).':'.substr($d,13,2);
            }
            $result[] = ['file' => $relPath, 'type' => 'rawconf', 'size' => $size,
                         'timestamp' => $ts, 'modified' => date('Y-m-d H:i:s', $item->getMTime())];
        }
    }

    // Neuste zuerst (Zeitstempel, fallback Modified)
    usort($result, function($a, $b) {
        $ta = $a['timestamp'] ?: $a['modified'];
        $tb = $b['timestamp'] ?: $b['modified'];
        return strcmp($tb, $ta);
    });
    return ['files' => $result, 'totalSize' => $totalSize, 'count' => count($result)];
}

/**
 * Einzelnes Backup löschen.
 * Unterstützt BACKUP_DIR-Dateien (flacher Name) und
 * RAW_CONF_DIR-.bak-Dateien (relativer Pfad mit '/').
 */
function deleteBackupFile($filename) {
    // rawconf-Backup: relativer Pfad (enthält '/') oder .bak-Endung ohne Slash
    if (strpos($filename, '/') !== false || isRawConfBackupFile(basename($filename))) {
        if (strpos($filename, '..') !== false || strpos($filename, '\\') !== false) {
            return ['deleted' => false, 'error' => 'Ungültiger Pfad'];
        }
        $safe = ltrim($filename, '/');
        if (!isRawConfBackupFile(basename($safe))) {
            return ['deleted' => false, 'error' => 'Nur .bak-Dateien können über diesen Pfad gelöscht werden'];
        }
        $rawDir = getWritableRawConfDir();
        if ($rawDir === false) $rawDir = RAW_CONF_DIR;
        $realBase = realpath($rawDir);
        $realPath = realpath($rawDir . '/' . $safe);
        if (!$realPath || !$realBase || strpos($realPath, $realBase) !== 0) {
            return ['deleted' => false, 'error' => 'Pfad ausserhalb raw-conf'];
        }
        if (!is_file($realPath)) {
            return ['deleted' => false, 'error' => 'Datei nicht gefunden'];
        }
        $size = filesize($realPath);
        @unlink($realPath);
        return ['deleted' => true, 'file' => $filename, 'freedBytes' => $size];
    }

    // Standard BACKUP_DIR (flacher Dateiname ohne '/')
    $safe = basename($filename);
    if ($safe !== $filename || strpos($safe, '..') !== false) {
        return ['deleted' => false, 'error' => 'Ungültiger Dateiname'];
    }
    $path = BACKUP_DIR . '/' . $safe;
    if (!file_exists($path)) {
        return ['deleted' => false, 'error' => 'Datei nicht gefunden'];
    }
    $size = filesize($path);
    @unlink($path);
    return ['deleted' => true, 'file' => $safe, 'freedBytes' => $size];
}

function restoreBackup($filename) {
    $path = BACKUP_DIR . '/' . basename($filename);
    if (!file_exists($path)) {
        jsonError('Backup nicht gefunden: ' . $filename, 404);
    }

    // Aktuellen State sichern
    if (file_exists(STATE_FILE)) {
        $ts = date('Ymd_His');
        @copy(STATE_FILE, BACKUP_DIR . '/state_' . $ts . '_pre_restore.json');
    }

    // Backup wiederherstellen
    $content = file_get_contents($path);
    file_put_contents(STATE_FILE, $content);
    $data = json_decode($content, true);

    return [
        'restored' => true,
        'from'     => $filename,
        'data'     => $data
    ];
}

/**
 * Raw-Conf-.bak-Datei wiederherstellen:
 * Kopiert <file>.TIMESTAMP.bak → <file> im raw-conf-Verzeichnis.
 * Die aktuell vorhandene Datei wird vorher neu gesichert.
 */
function restoreRawConfBackup($relPath) {
    if (strpos($relPath, '..') !== false || strpos($relPath, '\\') !== false) {
        jsonError('Ungültiger Pfad', 400);
    }
    $safe = ltrim($relPath, '/');
    if (!isRawConfBackupFile(basename($safe))) {
        jsonError('Nur .bak-Dateien können wiederhergestellt werden', 400);
    }

    $rawDir  = getWritableRawConfDir();
    if ($rawDir === false) $rawDir = RAW_CONF_DIR;
    $realBase = realpath($rawDir);
    $bakPath  = realpath($rawDir . '/' . $safe);

    if (!$bakPath || !$realBase || strpos($bakPath, $realBase) !== 0) {
        jsonError('Pfad ausserhalb raw-conf Verzeichnisses', 400);
    }
    if (!is_file($bakPath)) {
        jsonError('Backup-Datei nicht gefunden: ' . $safe, 404);
    }

    // Ziel-Dateiname: .TIMESTAMP.bak entfernen
    $origName = stripRawConfBackupSuffix(basename($bakPath));
    $origPath = dirname($bakPath) . '/' . $origName;

    // Aktuelle Datei vorher sichern
    if (is_file($origPath)) {
        $ts = date('Ymd_His');
        @copy($origPath, $origPath . '.' . $ts . '.bak');
    }

    if (!copy($bakPath, $origPath)) {
        jsonError('Wiederherstellen fehlgeschlagen (copy error)', 500);
    }

    $relOrig = ltrim(str_replace('\\', '/', str_replace($realBase, '', realpath($origPath))), '/');
    return [
        'restored' => true,
        'from'     => $safe,
        'to'       => $relOrig,
    ];
}

// =====================================================================
// Router
// =====================================================================
$action = $_GET['action'] ?? '';

switch ($action) {

    case 'load':
        $result = loadState();
        $lockInfo = readLock();
        $result['lock'] = $lockInfo;
        jsonResponse(['success' => true, 'data' => $result]);
        break;

    case 'save':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            jsonError('POST required', 405);
        }
        $body = json_decode(file_get_contents('php://input'), true);
        if (!$body) {
            jsonError('Ungültiger JSON-Body', 400);
        }
        $editor = getEditorName();
        $result = saveState($body, $editor);
        jsonResponse(['success' => true, 'data' => $result]);
        break;

    case 'lock':
        $editor = getEditorName();
        if (!$editor || $editor === 'Unbekannt') {
            jsonError('Editor-Name erforderlich (Header X-Editor-Name oder ?editor=Name)', 400);
        }
        $result = acquireLock($editor);
        jsonResponse(['success' => true, 'data' => $result]);
        break;

    case 'unlock':
        $editor = getEditorName();
        $result = releaseLock($editor);
        jsonResponse(['success' => true, 'data' => $result]);
        break;

    case 'lock-status':
        $lock = readLock();
        jsonResponse(['success' => true, 'data' => [
            'locked'  => $lock !== null,
            'lock'    => $lock,
            'age_min' => $lock ? round((time() - $lock['timestamp']) / 60, 1) : null
        ]]);
        break;

    case 'history':
        $history = listHistory();
        jsonResponse(['success' => true, 'data' => $history]);
        break;

    // ── Alle Backups auflisten ──
    case 'list-backups':
        $result = listAllBackups();
        jsonResponse(['success' => true, 'data' => $result]);
        break;

    // ── Manuelles Backup serverseitig erstellen (aus Frontend-State) ──
    case 'create-backup':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST erforderlich', 405);
        $body = json_decode(file_get_contents('php://input'), true);
        if (!$body || !isset($body['data'])) jsonError('Feld data erforderlich', 400);
        $editor = getEditorName();
        if (!is_dir(BACKUP_DIR)) @mkdir(BACKUP_DIR, 0775, true);
        $ts = date('Ymd_His');
        $safeEditor = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $editor);
        $filename = 'state_manual_' . $ts . '_' . $safeEditor . '.json';
        $path = BACKUP_DIR . '/' . $filename;
        $payload = $body['data'];
        $payload['_meta'] = [
            'savedBy'   => $editor,
            'savedAt'   => date('Y-m-d H:i:s'),
            'timestamp' => time(),
            'type'      => 'manual-backup',
        ];
        $bytes = file_put_contents($path, json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        if ($bytes === false) jsonError('Backup konnte nicht gespeichert werden', 500);
        cleanupBackups();
        jsonResponse(['success' => true, 'data' => ['file' => $filename, 'bytes' => $bytes]]);
        break;

    // ── Backup nur lesen (in Memory laden, ohne STATE_FILE zu überschreiben) ──
    case 'load-backup':
        $file = $_GET['file'] ?? '';
        if (!$file) jsonError('Parameter file= erforderlich', 400);
        $safeName = basename($file);
        if (strpos($safeName, '..') !== false) jsonError('Ungültiger Dateiname', 400);
        $path = BACKUP_DIR . '/' . $safeName;
        if (!file_exists($path)) jsonError('Backup nicht gefunden: ' . $safeName, 404);
        $content = file_get_contents($path);
        $data = json_decode($content, true);
        if (!$data) jsonError('Backup-Datei ungültig (kein gültiges JSON)', 400);
        jsonResponse(['success' => true, 'data' => ['file' => $safeName, 'state' => $data]]);
        break;

    // ── Backup(s) löschen ──
    case 'delete-backup':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST erforderlich', 405);
        $body = json_decode(file_get_contents('php://input'), true);
        $files = is_array($body['files'] ?? null) ? $body['files'] : [];
        if (empty($files)) jsonError('files-Array leer', 400);
        $results = [];
        $freedTotal = 0;
        foreach ($files as $f) {
            $r = deleteBackupFile($f);
            $results[] = $r;
            if ($r['deleted']) $freedTotal += ($r['freedBytes'] ?? 0);
        }
        $deleted = count(array_filter($results, function($r) { return $r['deleted']; }));
        jsonResponse(['success' => true, 'data' => [
            'results' => $results,
            'deleted' => $deleted,
            'freedBytes' => $freedTotal,
        ]]);
        break;

    case 'restore':
        $file = $_GET['file'] ?? '';
        if (!$file) jsonError('Parameter file= erforderlich', 400);
        $editor = getEditorName();
        $lock = readLock();
        if ($lock && $lock['editor'] !== $editor) {
            jsonError('Gesperrt von ' . $lock['editor'], 423);
        }
        $result = restoreBackup($file);
        jsonResponse(['success' => true, 'data' => $result]);
        break;

    case 'restore-rawconf':
        $file = $_GET['file'] ?? '';
        if (!$file) jsonError('Parameter file= erforderlich', 400);
        $result = restoreRawConfBackup($file);
        jsonResponse(['success' => true, 'data' => $result]);
        break;

    // ── JSON5 Gruppen ──
    case 'save-groups':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            jsonError('POST required', 405);
        }
        $content = file_get_contents('php://input');
        if (!$content) {
            jsonError('Leerer Body', 400);
        }
        $editor = getEditorName();
        $result = saveGroupsFile($content, $editor);
        jsonResponse(['success' => true, 'data' => $result]);
        break;

    case 'load-groups':
        $result = loadGroupsFile();
        jsonResponse(['success' => true, 'data' => $result]);
        break;

    // ── JSON5 Profile ──
    case 'save-profile':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            jsonError('POST required', 405);
        }
        $name = $_GET['name'] ?? '';
        if (!$name) jsonError('Parameter name= erforderlich', 400);
        $content = file_get_contents('php://input');
        if (!$content) {
            jsonError('Leerer Body', 400);
        }
        $editor = getEditorName();
        $result = saveProfileFile($name, $content, $editor);
        jsonResponse(['success' => true, 'data' => $result]);
        break;

    case 'load-profile':
        $name = $_GET['name'] ?? '';
        if (!$name) jsonError('Parameter name= erforderlich', 400);
        $result = loadProfileFile($name);
        jsonResponse(['success' => true, 'data' => $result]);
        break;

    case 'list-profiles':
        $profiles = listProfileFiles();
        jsonResponse(['success' => true, 'data' => $profiles]);
        break;

    // ── Lyrmgr.conf ──
    case 'load-lyrmgr':
        $profile = $_GET['profile'] ?? '';
        if (!$profile) jsonError('Parameter profile= erforderlich', 400);
        $source = $_GET['source'] ?? 'config';
        if ($source === 'draft') {
            $result = loadLyrmgrDraft($profile);
        } else {
            $result = loadLyrmgrConf($profile);
        }
        jsonResponse(['success' => true, 'data' => $result]);
        break;

    case 'save-lyrmgr-draft':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        $body = json_decode(file_get_contents('php://input'), true);
        if (!$body) jsonError('Ungültiger JSON-Body', 400);
        if (!isset($body['profile']) || !isset($body['data'])) {
            jsonError('Felder profile, data erforderlich', 400);
        }
        $editor = getEditorName();
        $result = saveLyrmgrDraft($body['profile'], $body['data'], $editor);
        if (!$result['saved']) {
            jsonError($result['error'], 500);
        }
        jsonResponse(['success' => true, 'data' => $result]);
        break;

    case 'lyrmgr-draft-status':
        $profile = $_GET['profile'] ?? '';
        if (!$profile) jsonError('Parameter profile= erforderlich', 400);
        $result = getLyrmgrDraftStatus($profile);
        jsonResponse(['success' => true, 'data' => $result]);
        break;

    case 'catalog-publish-status':
        // Liefert Revision + Bearbeiter aus dem publizierten catalog_document.
        // Wird vom Frontend für Live-Polling verwendet: wenn Revision steigt,
        // hat ein anderer Benutzer publiziert → automatisch neu laden.
        $profile = $_GET['profile'] ?? '';
        if (!$profile) jsonError('Parameter profile= erforderlich', 400);
        require_once __DIR__ . '/../includes/CatalogRepository.php';
        try {
            $doc = CatalogRepository::loadProfile($profile);
            jsonResponse(['success' => true, 'data' => [
                'exists'    => (bool)$doc['exists'],
                'revision'  => (int)$doc['revision'],
                'updatedBy' => $doc['updatedBy'] ?? null,
                'updatedAt' => $doc['updatedAt'] ?? null,
            ]]);
        } catch (\Throwable $e) {
            jsonResponse(['success' => false, 'error' => $e->getMessage()]);
        }
        break;

    case 'publish-lyrmgr':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        $body = json_decode(file_get_contents('php://input'), true);
        if (!$body) jsonError('Ungültiger JSON-Body', 400);
        if (!isset($body['profile']) || !isset($body['lyrmgrKey']) || !isset($body['data'])) {
            jsonError('Felder profile, lyrmgrKey, data erforderlich', 400);
        }
        $editor = getEditorName();
        $lock = readLock();
        if ($lock && $lock['editor'] !== $editor) {
            jsonError('Gesperrt von ' . $lock['editor'], 423);
        }
        $result = publishLyrmgrBlock($body['profile'], $body['lyrmgrKey'], $body['data'], $editor);
        if (!$result['published']) {
            jsonError($result['error'], 500);
        }
        jsonResponse(['success' => true, 'data' => $result]);
        break;

    case 'list-lyrmgr-profiles':
        $profiles = listLyrmgrProfiles();
        jsonResponse(['success' => true, 'data' => $profiles]);
        break;

    // ── Alle Layer aus 3 Quellen ──
    case 'list-all-layers':
        $profile = $_GET['profile'] ?? null;
        $result = listAllLayers($profile);
        jsonResponse(['success' => true, 'data' => $result]);
        break;

    // ── Legend-Keys gegen legendResources prüfen ──
    case 'check-legend-keys':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST erforderlich', 405);
        $body = json_decode(file_get_contents('php://input'), true);
        $checkKeys = is_array($body['keys'] ?? null) ? $body['keys'] : [];
        $checkProfile = isset($body['profile']) ? preg_replace('/[^a-zA-Z0-9_\-]/', '', (string)$body['profile']) : null;

        // legendResources aus core/nls/de und maps/core/nls/de laden
        $legendRes = [];
        $nlsDirs = [];
        $nlsBase = realpath(CORE_NLS_DIR);
        if ($nlsBase && is_dir($nlsBase)) $nlsDirs[] = $nlsBase;
        $nlsOver = realpath(APP_CORE_NLS_DIR);
        if ($nlsOver && is_dir($nlsOver) && $nlsOver !== $nlsBase) $nlsDirs[] = $nlsOver;
        foreach ($nlsDirs as $nlsD) {
            foreach (glob($nlsD . '/legendResources*.json') ?: [] as $lf) {
                $d = @json_decode(@file_get_contents($lf), true);
                if (is_array($d)) $legendRes = array_merge($legendRes, $d);
            }
        }
        // Profil-spezifische legendResources zusätzlich laden
        if ($checkProfile) {
            $profLegPath = getProfileLegendPath($checkProfile);
            if (file_exists($profLegPath)) {
                $d = @json_decode(@file_get_contents($profLegPath), true);
                if (is_array($d)) $legendRes = array_merge($legendRes, $d);
            }
        }

        $resolved = [];
        $unresolved = [];
        foreach ($checkKeys as $k) {
            $k = (string)$k;
            if (isset($legendRes[$k . '_link'])) {
                $resolved[] = [
                    'key'   => $k,
                    'link'  => $legendRes[$k . '_link'],
                    'title' => $legendRes[$k . '_title'] ?? '',
                ];
            } else {
                $unresolved[] = $k;
            }
        }
        jsonResponse(['success' => true, 'data' => ['resolved' => $resolved, 'unresolved' => $unresolved]]);
        break;

    // ── Config-Datei lesen (für Rechtsklick-Öffnen im Tree-Builder) ──
    case 'read-config-file':
        $file = $_GET['file'] ?? null;
        $sourceType = $_GET['source'] ?? null;
        if (!$file || !$sourceType) jsonError('Parameter file= und source= erforderlich', 400);
        // Nur erlaubte Dateinamen (layers_*.conf)
        $safeFile = basename($file);
        if (!preg_match('/^layers[_\-].*\.conf$/', $safeFile) && $safeFile !== 'layers.conf') {
            jsonError('Ungültiger Dateiname', 400);
        }
        // Verzeichnis anhand source-Typ bestimmen
        $configDir = null;
        if ($sourceType === 'core') {
            $configDir = realpath(CORE_CONFIG_DIR);
        } elseif ($sourceType === 'override') {
            $configDir = realpath(APP_CORE_CONFIG_DIR);
        } elseif ($sourceType === 'profile') {
            $prof = $_GET['profile'] ?? null;
            if ($prof) {
                $safeProf = preg_replace('/[^a-zA-Z0-9_\-]/', '', $prof);
                $configDir = CONFIG_BASE . '/' . $safeProf;
                if ($safeProf === 'public') $configDir = CONFIG_BASE;
            }
        }
        if (!$configDir || !is_dir($configDir)) jsonError('Quellverzeichnis nicht gefunden', 404);
        $fullPath = $configDir . '/' . $safeFile;
        if (!file_exists($fullPath)) jsonError('Datei nicht gefunden: ' . $safeFile, 404);
        $content = file_get_contents($fullPath);
        $parsed = json_decode($content, true);
        jsonResponse(['success' => true, 'data' => [
            'file'    => $safeFile,
            'source'  => $sourceType,
            'path'    => $fullPath,
            'entries' => is_array($parsed) ? count($parsed) : 0,
            'content' => $parsed
        ]]);
        break;

    // ── Layer-Conf staging: Original lesen, Edits mergen, nach tmp/stageConf schreiben ──
    case 'stage-layer-conf':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        $body = json_decode(file_get_contents('php://input'), true);
        if (!$body) jsonError('Ungültiger JSON-Body', 400);

        $sourceFile = $body['sourceFile'] ?? null;
        $source     = $body['source'] ?? 'core';
        $target     = $body['target'] ?? 'original';
        $profile    = $body['profile'] ?? null;
        $edits      = $body['edits'] ?? null;  // { layerId: { prop: val, ... }, ... }

        if (!$sourceFile) jsonError('sourceFile erforderlich', 400);
        if (!is_array($edits) || empty($edits)) jsonError('edits muss ein nicht-leeres Object sein', 400);

        $safeFile = basename($sourceFile);
        if (!preg_match('/^layers[_\-].*\.conf$/', $safeFile) && $safeFile !== 'layers.conf') {
            jsonError('Ungültiger Dateiname: ' . $safeFile, 400);
        }

        // Quell-Pfad bestimmen (zum Lesen des Originals)
        // Primär: nach source suchen. Fallback: alle bekannten Pfade durchsuchen.
        $readPath = null;
        $candidatePaths = [];
        if ($source === 'core') {
            $candidatePaths[] = CORE_CONFIG_DIR . '/' . $safeFile;
        } elseif ($source === 'override') {
            $candidatePaths[] = APP_CORE_CONFIG_DIR . '/' . $safeFile;
        } elseif ($source === 'profile') {
            $safeProf = preg_replace('/[^a-zA-Z0-9_\-]/', '', $profile ?: '');
            $profDir = ($safeProf === 'public' || !$safeProf) ? CONFIG_BASE : CONFIG_BASE . '/' . $safeProf;
            $candidatePaths[] = $profDir . '/' . $safeFile;
        }
        // Fallback-Pfade (alle Quellen durchsuchen)
        $candidatePaths[] = CORE_CONFIG_DIR . '/' . $safeFile;
        $candidatePaths[] = APP_CORE_CONFIG_DIR . '/' . $safeFile;
        if ($profile) {
            $safeProf2 = preg_replace('/[^a-zA-Z0-9_\-]/', '', $profile);
            $profDir2 = ($safeProf2 === 'public' || !$safeProf2) ? CONFIG_BASE : CONFIG_BASE . '/' . $safeProf2;
            $candidatePaths[] = $profDir2 . '/' . $safeFile;
        }
        $candidatePaths[] = CONFIG_BASE . '/' . $safeFile;
        // Ersten existierenden Pfad nehmen
        foreach (array_unique($candidatePaths) as $cp) {
            if (file_exists($cp)) {
                $readPath = $cp;
                break;
            }
        }

        // Original lesen
        if (!$readPath) {
            jsonError('Quelldatei nicht gefunden. Gesucht in: ' . implode(', ', array_unique($candidatePaths)), 404);
        }
        $raw = file_get_contents($readPath);
        $conf = json_decode($raw, true);
        if (!is_array($conf)) {
            jsonError('Quelldatei ist kein gültiges JSON: ' . $safeFile, 500);
        }

        // Erlaubte Properties
        $allowedProps = ['visible', 'opacity', 'legend', 'maxResolution', 'minResolution',
                         'rank', 'icon', 'icon_style', 'drawtype', 'singleTile'];

        // Edits mergen
        $changedLayers = [];
        foreach ($edits as $layerId => $props) {
            if (!is_string($layerId) || !is_array($props)) continue;
            if (!isset($conf[$layerId])) {
                // Layer nicht in Datei — überspringen mit Warnung
                $changedLayers[] = $layerId . ': NICHT GEFUNDEN';
                continue;
            }
            $layerChanges = [];
            foreach ($props as $k => $v) {
                if (!in_array($k, $allowedProps, true)) continue;
                // Numerische Werte konvertieren
                if (in_array($k, ['opacity', 'maxResolution', 'minResolution', 'rank'], true) && is_numeric($v)) {
                    $v = $v + 0;
                }
                if ($k === 'visible') {
                    $v = ($v === true || $v === 'true' || $v === 1 || $v === '1') ? 1 : 0;
                }
                if ($v === '' || $v === null) {
                    if (isset($conf[$layerId][$k])) {
                        unset($conf[$layerId][$k]);
                        $layerChanges[] = $k . ': entfernt';
                    }
                } else {
                    $conf[$layerId][$k] = $v;
                    $layerChanges[] = $k . '=' . json_encode($v);
                }
            }
            $changedLayers[] = $layerId . ': ' . implode(', ', $layerChanges);
        }

        // Staging-Verzeichnis: TNET_TMP_ROOT/stageConf/<target>/
        $stageBase = TNET_TMP_ROOT . '/stageConf';
        $stageDir = $stageBase . '/' . preg_replace('/[^a-zA-Z0-9_\-]/', '_', $target);
        if (!is_dir($stageDir)) {
            @mkdir($stageDir, 0775, true);
        }

        $json = json_encode($conf, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $stagePath = $stageDir . '/' . $safeFile;
        $written = @file_put_contents($stagePath, $json);
        if ($written === false) {
            $err = error_get_last();
            jsonError('Staging-Schreiben fehlgeschlagen: ' . ($err ? $err['message'] : $stagePath), 500);
        }

        // deployPath: readPath für target=original, sonst nach target/source bestimmen
        $deployPath = $readPath;
        if ($target === 'override') {
            $deployPath = APP_CORE_CONFIG_DIR . '/' . $safeFile;
        } elseif ($target === 'profile' && $profile) {
            $sp = preg_replace('/[^a-zA-Z0-9_\-]/', '', $profile);
            $deployPath = ($sp === 'public' || !$sp) ? CONFIG_BASE . '/' . $safeFile : CONFIG_BASE . '/' . $sp . '/' . $safeFile;
        }
        // PHP-Pfad → SFTP-Pfad: /var/www/html/nwow → /www
        $sftpDeployPath = toSftpPath($deployPath);
        $sftpStagedPath = toSftpPath($stagePath);

        jsonResponse(['success' => true, 'data' => [
            'sourceFile'    => $safeFile,
            'source'        => $source,
            'target'        => $target,
            'readPath'      => $readPath,
            'stagedPath'    => $sftpStagedPath,
            'deployPath'    => $sftpDeployPath,
            'bytes'         => $written,
            'layersChanged' => $changedLayers,
            'timestamp'     => date('Y-m-d H:i:s')
        ]]);
        break;

    // ── NLS-Conf stagen: Original lesen, Aliases mergen, nach tmp/stageConf schreiben ──
    // Scannt ALLE lyrmgrResources-Dateien im gleichen Verzeichnis nach betroffenen Keys
    case 'stage-nls-conf':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        $body = json_decode(file_get_contents('php://input'), true);
        if (!$body) jsonError('Ungültiger JSON-Body', 400);

        $sourceFile = $body['sourceFile'] ?? null;
        $source     = $body['source'] ?? 'core';
        $target     = $body['target'] ?? 'original';
        $profile    = $body['profile'] ?? null;
        $aliases    = $body['aliases'] ?? null;

        if (!$sourceFile) jsonError('sourceFile erforderlich', 400);
        if (!is_array($aliases) || empty($aliases)) jsonError('aliases muss ein nicht-leeres Object sein', 400);

        // === ALLE NLS-Verzeichnisse scannen (core + override + profil) ===
        // Reihenfolge: Core → Override → Profil (höchste Priorität zuletzt).
        // Wenn ein Key in mehreren Dateien vorkommt, wird die höchstpriorisierte
        // Datei aktualisiert (Override schlägt Core, Profil schlägt Override).
        $nlsScanDirs = [];  // [ ['tag'=>..., 'dir'=>...], ... ]
        $coreNlsDir = CORE_NLS_DIR;
        if (is_dir($coreNlsDir)) {
            $nlsScanDirs[] = ['tag' => 'core', 'dir' => $coreNlsDir];
        }
        $overNlsDir = APP_CORE_NLS_DIR;
        if (is_dir($overNlsDir) && realpath($overNlsDir) !== realpath($coreNlsDir)) {
            $nlsScanDirs[] = ['tag' => 'override', 'dir' => $overNlsDir];
        }
        // Profil-spezifische NLS-Datei (Einzeldatei, kein Verzeichnis-Scan)
        $profileNlsFile = null;
        if ($profile) {
            $safeProf = preg_replace('/[^a-zA-Z0-9_\-]/', '', $profile);
            if ($safeProf) {
                $profileNlsFile = getProfileNlsPath($safeProf);
            }
        }

        if (empty($nlsScanDirs)) {
            jsonError('Keine NLS-Verzeichnisse gefunden', 404);
        }

        // Alle NLS-Dateien sammeln (mit Priorität: core < override < profile)
        $allNlsFiles = [];  // [ ['path'=>..., 'tag'=>..., 'priority'=>int], ... ]
        $priority = 0;
        foreach ($nlsScanDirs as $sd) {
            $files = glob($sd['dir'] . '/lyrmgrResources*.json');
            // Backup-Dateien filtern
            $files = array_filter($files ?: [], function($f) {
                return !preg_match('/\.\d{8}_\d{6}\./', basename($f));
            });
            foreach ($files as $f) {
                $allNlsFiles[] = ['path' => $f, 'tag' => $sd['tag'], 'priority' => $priority];
            }
            $priority++;
        }
        // Profil-NLS-Datei separat hinzufügen (höchste Priorität)
        if ($profileNlsFile && file_exists($profileNlsFile)) {
            $allNlsFiles[] = ['path' => $profileNlsFile, 'tag' => 'profile', 'priority' => $priority];
        }

        if (empty($allNlsFiles)) {
            jsonError('Keine NLS-Dateien gefunden', 404);
        }

        $aliasKeys = array_keys($aliases);
        $stageBase = TNET_TMP_ROOT . '/stageConf';
        $stageDir = $stageBase . '/' . preg_replace('/[^a-zA-Z0-9_\-]/', '_', $target);
        if (!is_dir($stageDir)) @mkdir($stageDir, 0775, true);

        // Pro Alias-Key die höchstpriorisierte Datei finden die ihn enthält
        $keyBestFile = [];  // aliasKey → { path, tag, priority }
        foreach ($allNlsFiles as $nf) {
            $raw = @file_get_contents($nf['path']);
            $nls = $raw ? json_decode($raw, true) : null;
            if (!is_array($nls)) continue;
            foreach ($aliasKeys as $ak) {
                if (isset($nls[$ak])) {
                    if (!isset($keyBestFile[$ak]) || $nf['priority'] > $keyBestFile[$ak]['priority']) {
                        $keyBestFile[$ak] = $nf;
                    }
                }
            }
        }

        // Dateien gruppieren die aktualisiert werden müssen
        $filesToUpdate = [];  // path → { nls-data, tag, keysToUpdate[] }
        $unmatchedAliases = $aliases;
        foreach ($aliases as $ak => $av) {
            if (!is_string($ak)) continue;
            if (isset($keyBestFile[$ak])) {
                $fp = $keyBestFile[$ak]['path'];
                if (!isset($filesToUpdate[$fp])) {
                    $raw = file_get_contents($fp);
                    $nls = json_decode($raw, true);
                    $filesToUpdate[$fp] = ['nls' => is_array($nls) ? $nls : [], 'tag' => $keyBestFile[$ak]['tag']];
                }
                $filesToUpdate[$fp]['keys'][$ak] = $av;
                unset($unmatchedAliases[$ak]);
            }
        }

        // Dateien aktualisieren und stagen
        $stagedFiles = [];
        foreach ($filesToUpdate as $nlsFilePath => $info) {
            $nls = $info['nls'];
            $tag = $info['tag'];
            $changes = [];
            foreach ($info['keys'] as $key => $value) {
                if ($value === '' || $value === null) {
                    unset($nls[$key]);
                    $changes[] = $key . ': entfernt';
                } elseif (!isset($nls[$key]) || $nls[$key] !== $value) {
                    $nls[$key] = $value;
                    $changes[] = $key . ': ' . $value;
                }
            }
            if (empty($changes)) continue;

            $fn = basename($nlsFilePath);
            // Stage-Pfad: bei Override/Profil-Dateien Prefix hinzufügen um Namenskollisionen zu vermeiden
            $stagePrefix = ($tag !== 'core') ? $tag . '_' : '';
            $json = json_encode($nls, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            $stagePath = $stageDir . '/' . $stagePrefix . $fn;
            $written = @file_put_contents($stagePath, $json);
            if ($written === false) continue;

            // Deploy-Pfad = Lese-Pfad (Key wird dort aktualisiert wo er gefunden wurde)
            $deployPath = $nlsFilePath;
            $sftpDeploy = toSftpPath($deployPath);
            $sftpStaged = toSftpPath($stagePath);

            $stagedFiles[] = [
                'file'       => $fn,
                'source'     => $tag,
                'stagedPath' => $sftpStaged,
                'deployPath' => $sftpDeploy,
                'bytes'      => $written,
                'changes'    => $changes
            ];
        }

        // === Fallback: Neue Keys, die in keiner bestehenden Datei existieren ===
        $newAliases = [];
        foreach ($unmatchedAliases as $uKey => $uVal) {
            if (!is_string($uKey) || $uVal === '' || $uVal === null) continue;
            $newAliases[$uKey] = $uVal;
        }
        if (!empty($newAliases)) {
            // Ziel bestimmen: Override-Datei ist der sinnvollste Standard-Ort
            // (dort liegen auch die manuell gepflegten Kategorie-NLS-Keys)
            $fallbackFn = 'lyrmgrResources.json';
            if ($target === 'profile' && $profile) {
                // Profil-NLS in den gleichen Pfad wie getProfileNlsPath()
                $sp = preg_replace('/[^a-zA-Z0-9_\-]/', '', $profile);
                $fallbackFullPath = getProfileNlsPath($sp);
                $fallbackFn = basename($fallbackFullPath);
            } elseif ($target === 'override' || $target === 'original') {
                // Neue Keys: in Override schreiben (damit sie Core-Werte überschreiben)
                $fallbackFullPath = APP_CORE_NLS_DIR . '/' . $fallbackFn;
            } else {
                $fallbackFullPath = APP_CORE_NLS_DIR . '/' . $fallbackFn;
            }
            $sftpDeploy = toSftpPath($fallbackFullPath);

            // Bestehende Datei lesen (falls vorhanden) und neue Keys hinzufügen
            $existingNls = [];
            if (file_exists($fallbackFullPath)) {
                $raw = file_get_contents($fallbackFullPath);
                $decoded = json_decode($raw, true);
                if (is_array($decoded)) $existingNls = $decoded;
            }

            $changes = [];
            foreach ($newAliases as $nk => $nv) {
                $existingNls[$nk] = $nv;
                $changes[] = $nk . ': ' . $nv . ' (NEU)';
            }

            $json = json_encode($existingNls, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            $stagePath = $stageDir . '/' . $fallbackFn;
            $written = @file_put_contents($stagePath, $json);
            if ($written !== false) {
                $sftpStaged = toSftpPath($stagePath);
                $stagedFiles[] = [
                    'file'       => $fallbackFn,
                    'source'     => 'fallback',
                    'stagedPath' => $sftpStaged,
                    'deployPath' => $sftpDeploy,
                    'bytes'      => $written,
                    'changes'    => $changes
                ];
            }
        }

        if (empty($stagedFiles)) {
            jsonError('Keine NLS-Änderungen zu deployen', 404);
        }

        jsonResponse(['success' => true, 'data' => [
            'sourceFile'  => basename($sourceFile),
            'source'      => $source,
            'target'      => $target,
            'stagedFiles' => $stagedFiles,
            'timestamp'   => date('Y-m-d H:i:s')
        ]]);
        break;

    // ── (Legacy) Layer-Properties direkt speichern — wird durch stage-layer-conf + FastAPI ersetzt ──
    case 'save-layer-props':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        $body = json_decode(file_get_contents('php://input'), true);
        if (!$body) jsonError('Ungültiger JSON-Body', 400);

        $layerId = $body['layerId'] ?? null;
        $props   = $body['props'] ?? null;
        $target  = $body['target'] ?? 'original';  // original|override|profile
        $profile = $body['profile'] ?? null;

        if (!$layerId) jsonError('layerId erforderlich', 400);
        if (!is_array($props) || empty($props)) jsonError('props muss ein nicht-leeres Object sein', 400);

        // Erlaubte Properties (Sicherheit: nur bekannte Felder)
        $allowedProps = ['visible', 'opacity', 'legend', 'maxResolution', 'minResolution',
                         'rank', 'icon', 'icon_style', 'drawtype', 'singleTile'];
        $sanitized = [];
        foreach ($props as $k => $v) {
            if (!in_array($k, $allowedProps, true)) continue;
            // Numerische Werte konvertieren
            if (in_array($k, ['opacity', 'maxResolution', 'minResolution', 'rank'], true) && is_numeric($v)) {
                $v = $v + 0; // int oder float
            }
            // Boolean-Werte
            if ($k === 'visible') {
                $v = ($v === true || $v === 'true' || $v === 1 || $v === '1') ? 1 : 0;
            }
            $sanitized[$k] = $v;
        }
        if (empty($sanitized)) jsonError('Keine gültigen Properties', 400);

        // Ziel-Datei bestimmen
        if ($target === 'original') {
            // sourceFile und source des Layers ermitteln
            $sf = $body['sourceFile'] ?? null;
            $ss = $body['source'] ?? 'core';
            if (!$sf) jsonError('sourceFile erforderlich bei target=original', 400);
            $safeFile = basename($sf);
            if (!preg_match('/^layers[_\-].*\.conf$/', $safeFile) && $safeFile !== 'layers.conf') {
                jsonError('Ungültiger Dateiname: ' . $safeFile, 400);
            }
            if ($ss === 'core') {
                $configDir = CORE_CONFIG_DIR;
            } elseif ($ss === 'override') {
                $configDir = APP_CORE_CONFIG_DIR;
            } else {
                jsonError('source für original muss core oder override sein', 400);
            }
            $filePath = $configDir . '/' . $safeFile;
        } elseif ($target === 'override') {
            // Override-Verzeichnis: gleicher Dateiname wie Original
            $sf = $body['sourceFile'] ?? null;
            if (!$sf) jsonError('sourceFile erforderlich bei target=override', 400);
            $safeFile = basename($sf);
            if (!preg_match('/^layers[_\-].*\.conf$/', $safeFile) && $safeFile !== 'layers.conf') {
                jsonError('Ungültiger Dateiname: ' . $safeFile, 400);
            }
            $configDir = APP_CORE_CONFIG_DIR;
            $filePath = $configDir . '/' . $safeFile;
        } elseif ($target === 'profile') {
            if (!$profile) jsonError('profile erforderlich bei target=profile', 400);
            $safeProf = preg_replace('/[^a-zA-Z0-9_\-]/', '', $profile);
            $configDir = CONFIG_BASE . '/' . $safeProf;
            if ($safeProf === 'public') $configDir = CONFIG_BASE;
            $sf = $body['sourceFile'] ?? null;
            if (!$sf) jsonError('sourceFile erforderlich bei target=profile', 400);
            $safeFile = basename($sf);
            if (!preg_match('/^layers[_\-].*\.conf$/', $safeFile) && $safeFile !== 'layers.conf') {
                jsonError('Ungültiger Dateiname: ' . $safeFile, 400);
            }
            $filePath = $configDir . '/' . $safeFile;
        } else {
            jsonError('target muss original, override oder profile sein', 400);
        }

        // Bestehende Datei laden (oder leeres Object für neues Override/Profil)
        $existing = [];
        if (file_exists($filePath)) {
            $raw = file_get_contents($filePath);
            $existing = json_decode($raw, true) ?: [];
            // Backup erstellen
            ensureDirs();
            $ts = date('Ymd_His');
            $backupName = 'layers_props_' . pathinfo($safeFile, PATHINFO_FILENAME) . '_' . $ts . '.conf';
            @copy($filePath, BACKUP_DIR . '/' . $backupName);
        } else {
            // Verzeichnis sicherstellen (für profile/override)
            if (!is_dir(dirname($filePath))) {
                @mkdir(dirname($filePath), 0775, true);
            }
        }

        // Layer-Eintrag updaten oder anlegen
        if (!isset($existing[$layerId])) {
            $existing[$layerId] = [];
        }
        $changed = [];
        foreach ($sanitized as $k => $v) {
            $old = $existing[$layerId][$k] ?? null;
            if ($v === '' || $v === null) {
                // Leerer Wert: Property entfernen
                if (isset($existing[$layerId][$k])) {
                    unset($existing[$layerId][$k]);
                    $changed[] = $k . ': entfernt';
                }
            } else {
                $existing[$layerId][$k] = $v;
                if ($old !== $v) $changed[] = $k . ': ' . json_encode($old) . ' → ' . json_encode($v);
            }
        }

        // Schreiben
        $json = json_encode($existing, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $written = @file_put_contents($filePath, $json);
        if ($written === false) {
            jsonError('Schreibfehler: ' . $filePath, 500);
        }

        jsonResponse(['success' => true, 'data' => [
            'layerId' => $layerId,
            'target'  => $target,
            'file'    => $safeFile,
            'path'    => $filePath,
            'changed' => $changed,
            'bytes'   => $written
        ]]);
        break;

    // ── Profil-NLS laden ──
    case 'load-profile-nls':
        $profile = $_GET['profile'] ?? null;
        if (!$profile) jsonError('Profile erforderlich', 400);
        $safe = preg_replace('/[^a-zA-Z0-9_\-]/', '', $profile);
        $path = getProfileNlsPath($safe);
        $data = [];
        if (file_exists($path)) {
            $data = json_decode(file_get_contents($path), true) ?: [];
        }
        jsonResponse(['success' => true, 'data' => [
            'profile' => $safe,
            'path'    => $path,
            'exists'  => file_exists($path),
            'entries' => count($data),
            'aliases' => $data
        ]]);
        break;

    // ── NLS laden (site-core oder group) ──
    case 'load-nls':
        $target = $_GET['target'] ?? null;
        $group = $_GET['group'] ?? null;
        if (!$target) jsonError('Parameter target= erforderlich (site-core|group)', 400);
        if ($target === 'group' && !$group) jsonError('Parameter group= erforderlich bei target=group', 400);
        $result = loadNlsFile($target, $group);
        if (!$result['success']) jsonError($result['error'], 400);
        jsonResponse(['success' => true, 'data' => $result]);
        break;

    // ── NLS speichern (site-core oder group) ──
    case 'save-nls':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        $body = json_decode(file_get_contents('php://input'), true);
        if (!$body) jsonError('Ungültiger JSON-Body', 400);
        $target = $body['target'] ?? null;
        $group = $body['group'] ?? null;
        $aliases = $body['aliases'] ?? null;
        if (!$target) jsonError('Feld target erforderlich (site-core|group)', 400);
        if ($target === 'group' && !$group) jsonError('Feld group erforderlich bei target=group', 400);
        if (!is_array($aliases)) jsonError('Feld aliases muss ein Object sein', 400);
        $result = saveNlsEntries($target, $aliases, $group);
        if (!$result['saved']) jsonError($result['error'], 500);
        jsonResponse(['success' => true, 'data' => $result]);
        break;

    // ── Profil-NLS speichern ──
    case 'save-profile-nls':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        $body = json_decode(file_get_contents('php://input'), true);
        if (!$body) jsonError('Ungültiger JSON-Body', 400);
        if (!isset($body['profile']) || !isset($body['aliases'])) {
            jsonError('Felder profile und aliases erforderlich', 400);
        }
        if (!is_array($body['aliases'])) jsonError('aliases muss ein Object sein', 400);
        $result = saveProfileNls($body['profile'], $body['aliases']);
        if (!$result['saved']) {
            jsonError($result['error'], 500);
        }
        jsonResponse(['success' => true, 'data' => $result]);
        break;

    // ── Profil-legendResources laden ──
    case 'load-profile-legend':
        $profile = $_GET['profile'] ?? null;
        if (!$profile) jsonError('Profile erforderlich', 400);
        $safe = preg_replace('/[^a-zA-Z0-9_\-]/', '', $profile);
        $path = getProfileLegendPath($safe);
        $data = [];
        if (file_exists($path)) {
            $data = json_decode(file_get_contents($path), true) ?: [];
        }
        jsonResponse(['success' => true, 'data' => [
            'profile' => $safe,
            'path'    => $path,
            'exists'  => file_exists($path),
            'entries' => count($data),
            'legends' => $data
        ]]);
        break;

    // ── Profil-legendResources speichern ──
    case 'save-profile-legend':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        $body = json_decode(file_get_contents('php://input'), true);
        if (!$body) jsonError('Ungültiger JSON-Body', 400);
        if (!isset($body['profile']) || !isset($body['legends'])) {
            jsonError('Felder profile und legends erforderlich', 400);
        }
        if (!is_array($body['legends'])) jsonError('legends muss ein Object sein', 400);
        $result = saveProfileLegend($body['profile'], $body['legends']);
        if (!$result['saved']) {
            jsonError($result['error'], 500);
        }
        jsonResponse(['success' => true, 'data' => $result]);
        break;

    // ── Deploy: Stage → Produktiv ──
    case 'deploy-lyrmgr':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        $body = json_decode(file_get_contents('php://input'), true);
        if (!$body) jsonError('Ungültiger JSON-Body', 400);
        if (!isset($body['stageProfile']) || !isset($body['targetProfile'])) {
            jsonError('Felder stageProfile und targetProfile erforderlich', 400);
        }
        $editor = getEditorName();
        $lock = readLock();
        if ($lock && $lock['editor'] !== $editor) {
            jsonError('Gesperrt von ' . $lock['editor'], 423);
        }
        $result = deployLyrmgr($body['stageProfile'], $body['targetProfile'], $editor);
        if (!$result['success']) {
            jsonError($result['error'], 500);
        }
        jsonResponse(['success' => true, 'data' => $result]);
        break;

    // ── AGS → MapPlus Roh-Konfiguration ──
    case 'ags-services':
        $result = getAgsServices();
        if (!$result['success']) {
            jsonError($result['error'], 502);
        }
        jsonResponse(['success' => true, 'data' => $result['data']]);
        break;

    case 'ags-export':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        $body = json_decode(file_get_contents('php://input'), true);
        if (!$body || !isset($body['dienstnamen'])) {
            jsonError('JSON-Body mit Feld "dienstnamen" (Array) erforderlich', 400);
        }
        $serviceDetails = isset($body['serviceDetails']) && is_array($body['serviceDetails']) ? $body['serviceDetails'] : [];
        $result = exportAgsServices($body['dienstnamen'], $serviceDetails);
        if (!$result['success']) {
            jsonError($result['error'], 500);
        }
        jsonResponse(['success' => true, 'data' => $result]);
        break;

    // ── QGIS Server Projekte ──
    case 'qgis-list-projects':
        $result = listQgisProjects();
        if (!$result['success']) {
            jsonError($result['error'], 500);
        }
        jsonResponse(['success' => true, 'data' => $result]);
        break;

    case 'qgis-capabilities':
        $wmsUrl = $_GET['wmsUrl'] ?? '';
        if (!$wmsUrl) jsonError('Parameter "wmsUrl" erforderlich', 400);
        // Nur lokale /qmap/ URLs erlauben (Sicherheit)
        if (strpos($wmsUrl, QMAP_BASE_URL . '/') !== 0) {
            jsonError('Nur /qmap/ URLs erlaubt', 403);
        }
        $result = getQgisCapabilities($wmsUrl);
        if (!$result['success']) {
            jsonError($result['error'], 502);
        }
        jsonResponse(['success' => true, 'data' => $result]);
        break;

    case 'qgis-export':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        $body = json_decode(file_get_contents('php://input'), true);
        if (!$body || !isset($body['projekte'])) {
            jsonError('JSON-Body mit Feld "projekte" (Array) erforderlich', 400);
        }
        $result = exportQgisProjects($body['projekte']);
        if (!$result['success']) {
            jsonError($result['error'], 500);
        }
        jsonResponse(['success' => true, 'data' => $result]);
        break;

    case 'ags-import-meta':
        // Letzter Import pro Dienst aus DB lesen
        try {
            $pdo = Database::getConnection();
            $stmt = $pdo->query(
                "SELECT DISTINCT ON (service_name)
                        service_name, hash, published_at, published_by,
                        imported_at::text AS imported_at
                 FROM mapplusconf.ags_import_history
                 ORDER BY service_name, imported_at DESC"
            );
            $rows = $stmt->fetchAll();
            $meta = [];
            foreach ($rows as $row) {
                $meta[$row['service_name']] = [
                    'hash'         => $row['hash'],
                    'published_at' => $row['published_at'],
                    'published_by' => $row['published_by'],
                    'imported_at'  => $row['imported_at']
                ];
            }
            jsonResponse(['success' => true, 'data' => ['meta' => $meta]]);
        } catch (Exception $e) {
            jsonError('DB-Fehler: ' . $e->getMessage(), 500);
        }
        break;

    case 'ags-list-raw':
        $includeBackups = isset($_GET['includeBackups']) && $_GET['includeBackups'] === '1';
        $backupOnly = isset($_GET['backupOnly']) && $_GET['backupOnly'] === '1';
        if ($backupOnly) $includeBackups = true;
        $result = listRawConf($includeBackups, $backupOnly);
        jsonResponse(['success' => true, 'data' => $result]);
        break;

    case 'ags-delete-raw':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        $body = json_decode(file_get_contents('php://input'), true);
        if (!$body || !isset($body['service'])) {
            jsonError('JSON-Body mit Feld "service" erforderlich', 400);
        }
        $result = deleteRawConfService($body['service']);
        if (!$result['success']) {
            jsonError($result['error'], 400);
        }
        jsonResponse(['success' => true, 'data' => $result]);
        break;

    case 'ags-delete-backups':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        $body = json_decode(file_get_contents('php://input'), true);
        if (!$body || !isset($body['service'])) {
            jsonError('JSON-Body mit Feld "service" erforderlich', 400);
        }
        $result = deleteRawConfBackups($body['service']);
        if (!$result['success']) {
            jsonError($result['error'], 400);
        }
        jsonResponse(['success' => true, 'data' => $result]);
        break;

    case 'ags-read-raw':
        $file = $_GET['file'] ?? '';
        if (!$file) jsonError('Parameter file= erforderlich', 400);
        $result = readRawConfFile($file);
        if (!$result['success']) {
            jsonError($result['error'], 404);
        }
        jsonResponse(['success' => true, 'data' => $result]);
        break;

    case 'ags-write-raw':
        $body = json_decode(file_get_contents('php://input'), true);
        if (!isset($body['file']) || !isset($body['content'])) {
            jsonError('JSON-Body mit Feldern "file" und "content" erforderlich', 400);
        }
        $result = writeRawConfFile($body['file'], $body['content']);
        if (!$result['success']) {
            jsonError($result['error'], 400);
        }
        jsonResponse(['success' => true, 'data' => $result]);
        break;

    case 'staging-list-output':
        jsonResponse(['success' => true, 'data' => listImportToCore()]);
        break;

    case 'staging-read-output':
        $file = $_GET['file'] ?? '';
        if (!$file) jsonError('Parameter file= erforderlich', 400);
        $result = readImportToCoreFile($file);
        if (!$result['success']) jsonError($result['error'], 404);
        jsonResponse(['success' => true, 'data' => $result]);
        break;

    case 'staging-write-output':
        $body = json_decode(file_get_contents('php://input'), true);
        if (!isset($body['file']) || !isset($body['content'])) jsonError('Felder "file" und "content" erforderlich', 400);
        $result = writeImportToCoreFile($body['file'], $body['content']);
        if (!$result['success']) jsonError($result['error'], 400);
        jsonResponse(['success' => true, 'data' => $result]);
        break;

    case 'staging-delete-output':
        // DB-Aenderung: fuer eingeloggte Benutzer erlaubt (kein Admin noetig).
        // Massen-Import (admin.php) und Export (config-export-to-core) bleiben Admin.
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        $body = json_decode(file_get_contents('php://input'), true);
        if (!$body || !isset($body['kuerzel'])) jsonError('Feld "kuerzel" (Array) erforderlich', 400);
        jsonResponse(['success' => true, 'data' => deleteImportToCoreKuerzel($body['kuerzel'])]);
        break;

    case 'staging-restage':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        $body = json_decode(file_get_contents('php://input'), true);
        if (!$body || !isset($body['kuerzel'])) jsonError('Feld "kuerzel" erforderlich', 400);
        $result = restageKuerzelDb($body['kuerzel']);
        if (!$result['success']) jsonError($result['error'], 400);
        jsonResponse(['success' => true, 'data' => $result]);
        break;

    case 'staging-add-tag':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        $body = json_decode(file_get_contents('php://input'), true);
        if (!$body || !isset($body['kuerzel']) || !isset($body['tag'])) jsonError('Felder "kuerzel" und "tag" erforderlich', 400);
        $result = StagingImportRepository::addTag($body['kuerzel'], $body['tag']);
        if (!$result['success']) jsonError($result['error'], 400);
        jsonResponse(['success' => true, 'data' => $result]);
        break;

    case 'staging-delete-tag':
        // Einzelnen Tag loeschen: fuer eingeloggte Benutzer erlaubt (kein Admin noetig).
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        $body = json_decode(file_get_contents('php://input'), true);
        if (!$body || !isset($body['tag'])) jsonError('Feld "tag" erforderlich', 400);
        $result = StagingImportRepository::removeTagEverywhere($body['tag']);
        if (!$result['success']) jsonError($result['error'], 400);
        jsonResponse(['success' => true, 'data' => $result]);
        break;

    case 'ags-stage-merge':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        $body = json_decode(file_get_contents('php://input'), true);
        if (!$body || !isset($body['services']) || !isset($body['kuerzel'])) {
            jsonError('JSON-Body mit Feldern "services" (Array) und "kuerzel" (String) erforderlich', 400);
        }
        if (!is_array($body['services']) || count($body['services']) === 0) {
            jsonError('services muss ein nicht-leeres Array sein', 400);
        }
        $mode = isset($body['mode']) ? $body['mode'] : 'replace';
        $scope = isset($body['scope']) ? (string)$body['scope'] : 'core';
        $profile = isset($body['profile']) && $body['profile'] !== '' ? (string)$body['profile'] : null;
        $result = stageServicesToImportToCore($body['services'], $body['kuerzel'], $mode, $scope, $profile);
        if (!$result['success']) jsonError($result['error'], 400);
        jsonResponse(['success' => true, 'data' => $result]);
        break;

    // ── Config-Editor ──
    case 'staging-layers-flat':
        $kuerzel = $_GET['kuerzel'] ?? '';
        $result = stagingLayersFlat($kuerzel);
        if (!$result['success']) jsonError($result['error'], 404);
        jsonResponse($result);
        break;

    case 'config-editor-load':
        $kuerzel = $_GET['kuerzel'] ?? '';
        if (!$kuerzel) jsonError('Parameter kuerzel= erforderlich', 400);
        $result = configEditorLoad($kuerzel);
        if (!$result['success']) jsonError($result['error'], 404);
        jsonResponse($result);
        break;

    case 'config-editor-save':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        $body = json_decode(file_get_contents('php://input'), true);
        if (!$body || !isset($body['kuerzel']) || !isset($body['file']) || !isset($body['data'])) {
            jsonError('Felder "kuerzel", "file" und "data" erforderlich', 400);
        }
        $changedKeys = isset($body['changedKeys']) && is_array($body['changedKeys']) ? $body['changedKeys'] : [];
        $result = configEditorSave($body['kuerzel'], $body['file'], $body['data'], $changedKeys);
        if (!$result['success']) jsonError($result['error'], 400);
        jsonResponse(['success' => true, 'data' => $result]);
        break;

    case 'config-export-to-core':
        requireAdminAction();
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        $body = json_decode(file_get_contents('php://input'), true);
        if (!$body || !isset($body['kuerzel'])) {
            jsonError('Feld "kuerzel" erforderlich', 400);
        }
        $result = configExportToCore($body['kuerzel']);
        if (!$result['success']) jsonError($result['error'], 500);
        jsonResponse(['success' => true, 'data' => $result]);
        break;

    case 'export-catalog-artifacts':
        requireAdminAction();
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        $body = json_decode(file_get_contents('php://input'), true) ?: [];
        $result = exportCatalogArtifacts($body);
        jsonResponse(['success' => $result['success'] ?? false, 'data' => $result]);
        break;

    case 'deploy-catalog-artifacts':
        requireAdminAction();
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        $body = json_decode(file_get_contents('php://input'), true);
        if (!$body || !isset($body['runId'])) jsonError('Feld "runId" erforderlich', 400);
        $result = deployCatalogArtifacts($body);
        jsonResponse(['success' => $result['success'] ?? false, 'data' => $result]);
        break;

    // ── Core-Config Import (Produktiv → raw-conf) ──
    case 'core-list-sources':
        $result = listCoreSources();
        if (!$result['success']) jsonError($result['error'], 500);
        jsonResponse(['success' => true, 'data' => $result]);
        break;

    case 'core-import':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        $body = json_decode(file_get_contents('php://input'), true);
        if (!$body || !isset($body['kuerzel']) || !is_array($body['kuerzel'])) {
            jsonError('JSON-Body mit Feld "kuerzel" (Array) erforderlich', 400);
        }
        $result = importCoreToRawConf($body['kuerzel']);
        if (!$result['success']) jsonError($result['error'], 500);
        jsonResponse(['success' => true, 'data' => $result]);
        break;

    case 'debug-layer-source':
        // Diagnostiziert welche Quelle list-all-layers verwendet und warum
        $profile = $_GET['profile'] ?? 'public';
        $bundles = StagingImportRepository::loadAll();
        $bundleSummary = [];
        $dbHasLayersCheck = false;
        foreach ($bundles as $bundle) {
            $bScope = $bundle['scope'] ?? 'core';
            $layerFiles = [];
            foreach (($bundle['files'] ?? []) as $file) {
                $prefix = $file['prefix'] ?? '';
                $data = $file['data'] ?? null;
                $isAssoc = is_array($data) && !empty($data) && array_keys($data) !== range(0, count($data) - 1);
                if ($prefix === 'layers' && $isAssoc) {
                    $dbHasLayersCheck = true;
                    $layerFiles[] = ['name' => $file['name'] ?? '', 'keys' => count($data)];
                }
            }
            $bundleSummary[] = [
                'kuerzel' => $bundle['kuerzel'],
                'scope' => $bScope,
                'profile' => $bundle['profile'] ?? null,
                'fileCount' => count($bundle['files'] ?? []),
                'layerFiles' => $layerFiles,
            ];
        }
        jsonResponse(['success' => true, 'data' => [
            'bundleCount' => count($bundles),
            'dbHasLayers' => $dbHasLayersCheck,
            'useStagingImportDb' => useStagingImportDb(),
            'dbActive' => useStagingImportDb(),
            'fallbackTriggered' => !$dbHasLayersCheck,
            'bundles' => $bundleSummary,
        ]]);
        break;

    case 'debug-manifest':
        $kuerzel = $_GET['kuerzel'] ?? '';
        if (!$kuerzel) jsonError('Parameter kuerzel= erforderlich', 400);
        $safe = preg_replace('/[^a-zA-Z0-9_\-]/', '_', trim($kuerzel));
        $bundle = StagingImportRepository::loadBundle($safe);
        $rawDir = getWritableRawConfDir();
        if ($rawDir === false) $rawDir = RAW_CONF_DIR;
        $sourceChecks = [];
        if ($bundle && !empty($bundle['manifest']['sources'])) {
            foreach ($bundle['manifest']['sources'] as $src) {
                $svcKey = $src['service'];
                $candidates = [$rawDir . '/' . $svcKey];
                foreach (rawConfSourceBuckets() as $bucket) {
                    $candidates[] = $rawDir . '/' . $bucket . '/' . $svcKey;
                    $bucketDir = $rawDir . '/' . $bucket;
                    if (is_dir($bucketDir)) {
                        foreach (@scandir($bucketDir) ?: [] as $sub) {
                            if ($sub === '.' || $sub === '..') continue;
                            if (is_dir($bucketDir . '/' . $sub)) {
                                $candidates[] = $bucketDir . '/' . $sub . '/' . $svcKey;
                            }
                        }
                    }
                }
                $resolved = null;
                $checkedPaths = [];
                foreach ($candidates as $c) {
                    $checkedPaths[] = ['path' => $c, 'exists' => is_dir($c)];
                    if ($resolved === null && is_dir($c)) $resolved = $c;
                }
                $sourceChecks[] = [
                    'service' => $svcKey,
                    'resolved' => $resolved,
                    'sourceFiles' => $src['sourceFiles'] ?? [],
                    'checkedPaths' => $checkedPaths,
                ];
            }
        }
        jsonResponse(['success' => true, 'data' => [
            'kuerzel' => $safe,
            'rawDir' => $rawDir,
            'manifest' => $bundle['manifest'] ?? null,
            'sourceChecks' => $sourceChecks,
        ]]);
        break;

    case 'debug-rawconf':
        $info = [
            'RAW_CONF_DIR' => RAW_CONF_DIR,
            'exists' => is_dir(RAW_CONF_DIR),
            'writable' => is_writable(RAW_CONF_DIR),
            'realpath' => @realpath(RAW_CONF_DIR),
            'owner' => function_exists('posix_getpwuid') ? @posix_getpwuid(fileowner(RAW_CONF_DIR))['name'] : fileowner(RAW_CONF_DIR),
            'perms' => substr(sprintf('%o', fileperms(RAW_CONF_DIR)), -4),
            'php_user' => (function_exists('posix_getpwuid') && function_exists('posix_geteuid')) ? posix_getpwuid(posix_geteuid())['name'] : get_current_user(),
        ];
        // Schreibtest
        $testFile = RAW_CONF_DIR . '/_write_test_' . time() . '.tmp';
        $writeResult = @file_put_contents($testFile, 'test');
        $info['write_test'] = [
            'file' => $testFile,
            'result' => $writeResult,
            'error' => $writeResult === false ? error_get_last() : null,
        ];
        if ($writeResult !== false) @unlink($testFile);
        // Verzeichnisinhalt (rekursiv)
        if (is_dir(RAW_CONF_DIR)) {
            $allFiles = [];
            $it = new RecursiveIteratorIterator(
                new RecursiveDirectoryIterator(RAW_CONF_DIR, RecursiveDirectoryIterator::SKIP_DOTS),
                RecursiveIteratorIterator::SELF_FIRST
            );
            foreach ($it as $item) {
                $rel = str_replace(RAW_CONF_DIR . '/', '', $item->getPathname());
                $allFiles[] = ['path' => $rel, 'type' => $item->isDir() ? 'dir' : 'file', 'size' => $item->isDir() ? null : $item->getSize()];
            }
            $info['contents'] = $allFiles;
        }
        // Alternativer Pfad prüfen (alter docroot-basierter Pfad)
        $altPath = $_SERVER['DOCUMENT_ROOT'] . '/data/raw-conf';
        $info['alt_path'] = [
            'path' => $altPath,
            'exists' => is_dir($altPath),
            'contents' => is_dir($altPath) ? @scandir($altPath) : null,
        ];
        // open_basedir
        $info['open_basedir'] = ini_get('open_basedir');
        jsonResponse(['success' => true, 'data' => $info]);
        break;

    case 'debug-paths':
        $configPath = CONFIG_BASE . '/lyrmgr.conf';
        $info = [
            'CONFIG_BASE' => CONFIG_BASE,
            'config_path' => $configPath,
            'file_exists' => file_exists($configPath),
            'is_readable' => is_readable($configPath),
            'is_dir_config' => is_dir(CONFIG_BASE),
            'dir_contents' => is_dir(CONFIG_BASE) ? @scandir(CONFIG_BASE) : 'dir not found',
            'realpath_config' => @realpath(CONFIG_BASE),
            'cwd' => getcwd(),
            'document_root' => $_SERVER['DOCUMENT_ROOT'] ?? 'n/a',
            'script_filename' => $_SERVER['SCRIPT_FILENAME'] ?? 'n/a',
            'data_dir' => DATA_DIR,
            'data_dir_exists' => is_dir(DATA_DIR),
            'data_dir_writable' => is_writable(DATA_DIR),
            'sys_temp_dir' => sys_get_temp_dir(),
            'tmp_exists' => is_dir('/tmp'),
            'tmp_writable' => is_writable('/tmp'),
            'var_tmp_exists' => is_dir('/var/tmp'),
            'upload_tmp_dir' => ini_get('upload_tmp_dir'),
            'open_basedir' => ini_get('open_basedir'),
        ];
        // Check parent dirs
        $parts = explode('/', trim(CONFIG_BASE, '/'));
        $check = '';
        foreach ($parts as $p) {
            $check .= '/' . $p;
            $info['path_check'][$check] = [
                'exists' => file_exists($check),
                'is_dir' => is_dir($check),
            ];
        }
        jsonResponse(['success' => true, 'data' => $info]);
        break;

    // ── Runtime-Pfade: Sicherheitsanzeige fuer DEV/PROD-Trennung ──
    case 'runtime-paths':
        jsonResponse(['success' => true, 'data' => [
            'environment' => APP_BASE_PATH === '/maps-dev' ? 'dev' : 'prod',
            'appBasePath' => APP_BASE_PATH,
            'paths' => [
                runtimePathInfo('App Webroot', APP_WEB_ROOT),
                runtimePathInfo('Core Config', CORE_CONFIG_DIR),
                runtimePathInfo('Core NLS de', CORE_NLS_DIR),
                runtimePathInfo('Site-Core Config', APP_CORE_CONFIG_DIR),
                runtimePathInfo('Site-Core NLS de', APP_CORE_NLS_DIR),
                runtimePathInfo('Profil-Config', CONFIG_BASE),
                runtimePathInfo('Tmp Root', TNET_TMP_ROOT),
                runtimePathInfo('raw-conf', RAW_CONF_DIR),
                runtimePathInfo('ImportToCore', IMPORT_TO_CORE_DIR),
                runtimePathInfo('LayerTree', DATA_DIR),
                runtimePathInfo('StageConf', TNET_TMP_ROOT . '/stageConf'),
            ],
            'dbSchema' => class_exists('Database') ? Database::getSchema() : null,
        ]]);
        break;

    // ── Deployed-Conf: Einzelne Datei lesen (für Editor-Ansicht) ──
    case 'read-deployed-conf':
        $file    = $_GET['file'] ?? '';
        $source  = $_GET['source'] ?? '';
        $profile = $_GET['profile'] ?? 'public';
        if (!$file || !$source) jsonError('Parameter file= und source= erforderlich', 400);

        $safeFile = basename($file);
        $safeProf = preg_replace('/[^a-zA-Z0-9_\-]/', '', $profile ?: 'public');

        // Verzeichnis bestimmen (gleiche Logik wie list-deployed-conf)
        $targetDir = null;
        switch ($source) {
            case 'core':         $targetDir = realpath(CORE_CONFIG_DIR); break;
            case 'core_nls':     $targetDir = realpath(CORE_NLS_DIR); break;
            case 'override':     $targetDir = realpath(APP_CORE_CONFIG_DIR); break;
            case 'override_nls': $targetDir = realpath(APP_CORE_NLS_DIR); break;
            default:
                // profile_public, profile_xyz etc.
                if (strpos($source, 'profile_') === 0) {
                    $profName = substr($source, 8);
                    $safeProfName = preg_replace('/[^a-zA-Z0-9_\-]/', '', $profName);
                    $targetDir = ($safeProfName === 'public' || !$safeProfName) ? CONFIG_BASE : CONFIG_BASE . '/' . $safeProfName;
                } else {
                    jsonError('Unbekannte Quelle: ' . $source, 400);
                }
        }
        if (!$targetDir || !is_dir($targetDir)) jsonError('Verzeichnis nicht gefunden', 404);

        $fullPath = $targetDir . '/' . $safeFile;
        $realPath = realpath($fullPath);
        $realBase = realpath($targetDir);
        if (!$realPath || !$realBase || strpos($realPath, $realBase) !== 0) {
            jsonError('Ungültiger Pfad', 400);
        }
        if (!file_exists($realPath)) jsonError('Datei nicht gefunden: ' . $safeFile, 404);

        $content = file_get_contents($realPath);
        jsonResponse(['success' => true, 'data' => [
            'file'    => $safeFile,
            'source'  => $source,
            'content' => $content,
            'size'    => strlen($content)
        ]]);
        break;

    // ── Deployed-Conf: Alle .conf und .json Dateien aus core/override/profile auflisten ──
    case 'list-deployed-conf':
        $profile = $_GET['profile'] ?? 'public';
        $safeProf = preg_replace('/[^a-zA-Z0-9_\-]/', '', $profile ?: 'public');

        // Verzeichnisse definieren
        $dirs = [
            'core'     => realpath(CORE_CONFIG_DIR),
            'core_nls' => realpath(CORE_NLS_DIR),
            'override'     => realpath(APP_CORE_CONFIG_DIR),
            'override_nls' => realpath(APP_CORE_NLS_DIR),
        ];
        // Alle Profile scannen (public + Unterverzeichnisse)
        $profiles = ['public'];
        if (is_dir(CONFIG_BASE)) {
            $dirs['profile_public'] = CONFIG_BASE;
            // Unterverzeichnisse = weitere Profile
            foreach (glob(CONFIG_BASE . '/*', GLOB_ONLYDIR) as $subDir) {
                $profName = basename($subDir);
                $dirs['profile_' . $profName] = $subDir;
                $profiles[] = $profName;
            }
        }

        // Dateien sammeln
        $files = [];
        $backupPattern = '/\.\d{8}_\d{6}\./';  // Backups ausschliessen
        foreach ($dirs as $tag => $dir) {
            if (!$dir || !is_dir($dir)) continue;
            // .conf und .json Dateien
            $found = array_merge(
                glob($dir . '/*.conf') ?: [],
                glob($dir . '/*.json') ?: []
            );
            foreach ($found as $f) {
                $bn = basename($f);
                // Backups und versteckte Dateien ausschliessen
                if (preg_match($backupPattern, $bn)) continue;
                if ($bn[0] === '.') continue;
                $files[] = [
                    'name'     => $bn,
                    'source'   => $tag,
                    'dir'      => $dir,
                    'size'     => filesize($f),
                    'modified' => date('Y-m-d H:i:s', filemtime($f)),
                    'entries'  => null  // Wird nur bei Bedarf geladen
                ];
            }
        }

        // Override-Info: Welche Dateien in mehreren Quellen existieren
        $nameMap = [];
        foreach ($files as &$fi) {
            $nameMap[$fi['name']][] = $fi['source'];
        }
        unset($fi);
        foreach ($files as &$fi) {
            $fi['overrideSources'] = $nameMap[$fi['name']];
            $fi['hasOverride'] = count($nameMap[$fi['name']]) > 1;
        }
        unset($fi);

        // Nach Dateiname sortieren
        usort($files, function($a, $b) {
            $cmp = strcmp($a['name'], $b['name']);
            if ($cmp !== 0) return $cmp;
            // core vor override vor profile
            $order = ['core' => 0, 'core_nls' => 1, 'override' => 2, 'override_nls' => 3, 'profile' => 4];
            return ($order[$a['source']] ?? 9) - ($order[$b['source']] ?? 9);
        });

        jsonResponse(['success' => true, 'data' => [
            'profile'  => $safeProf,
            'profiles' => $profiles,
            'dirs'     => $dirs,
            'files'    => $files,
            'count'    => count($files)
        ]]);
        break;

    // ── Deployed: Fehlende NLS-Einträge (Layer-Alias + Maptip-Titel) prüfen ──
    case 'check-missing-nls':
        $profile = $_GET['profile'] ?? 'public';
        $safeProf = preg_replace('/[^a-zA-Z0-9_\-]/', '', $profile ?: 'public');

        // Verzeichnisse: config + nls
        $configDirs = [
            'core'     => realpath(CORE_CONFIG_DIR),
            'override' => realpath(APP_CORE_CONFIG_DIR),
        ];
        $nlsDirs = [
            'core'     => realpath(CORE_NLS_DIR),
            'override' => realpath(APP_CORE_NLS_DIR),
        ];
        // Profil-Verzeichnis
        if (defined('CONFIG_BASE') && is_dir(CONFIG_BASE)) {
            $configDirs['profile_' . $safeProf] = CONFIG_BASE;
            // Profil hat NLS im gleichen Verzeichnis
            $nlsDirs['profile_' . $safeProf] = CONFIG_BASE;
        }

        // Alle Keys aus JSON-Dateien sammeln (mit Glob-Pattern)
        $collectJsonKeys = function($dir, $pattern) {
            $keys = [];
            if (!$dir || !is_dir($dir)) return $keys;
            $files = glob($dir . '/' . $pattern) ?: [];
            foreach ($files as $f) {
                $data = @json_decode(file_get_contents($f), true);
                if (!is_array($data)) continue;
                foreach (array_keys($data) as $k) {
                    $keys[$k] = basename($f);
                }
            }
            return $keys;
        };

        // 1. Layer-Keys aus layers_*.conf sammeln
        $layerKeys = [];  // key => { file, source }
        foreach ($configDirs as $src => $dir) {
            if (!$dir || !is_dir($dir)) continue;
            $files = glob($dir . '/layers_*.conf') ?: [];
            // Auch layers.conf ohne Suffix
            if (file_exists($dir . '/layers.conf')) {
                $files[] = $dir . '/layers.conf';
            }
            foreach ($files as $f) {
                $data = @json_decode(file_get_contents($f), true);
                if (!is_array($data)) continue;
                $bn = basename($f);
                foreach (array_keys($data) as $k) {
                    // Nur echte Layer (haben type-Property)
                    if (isset($data[$k]['type'])) {
                        $layerKeys[$k] = ['file' => $bn, 'source' => $src];
                    }
                }
            }
        }

        // 2. Alle desc_-Einträge aus lyrmgrResources_*.json sammeln
        $descKeys = [];
        foreach ($nlsDirs as $src => $dir) {
            $found = $collectJsonKeys($dir, 'lyrmgrResources*.json');
            foreach ($found as $k => $fn) {
                $descKeys[$k] = true;
            }
        }

        // 3. Maptip-Keys aus maptips_*.conf sammeln
        $maptipKeys = [];  // key => { file, source, nls }
        foreach ($configDirs as $src => $dir) {
            if (!$dir || !is_dir($dir)) continue;
            $files = glob($dir . '/maptips_*.conf') ?: [];
            if (file_exists($dir . '/maptips.conf')) {
                $files[] = $dir . '/maptips.conf';
            }
            foreach ($files as $f) {
                $data = @json_decode(file_get_contents($f), true);
                if (!is_array($data)) continue;
                $bn = basename($f);
                foreach ($data as $k => $v) {
                    if (is_array($v) && isset($v['type'])) {
                        $maptipKeys[$k] = [
                            'file'   => $bn,
                            'source' => $src,
                            'nls'    => $v['nls'] ?? $k
                        ];
                    }
                }
            }
        }

        // 4. Alle *_title-Einträge aus maptipsResources_*.json sammeln
        $titleKeys = [];
        foreach ($nlsDirs as $src => $dir) {
            $found = $collectJsonKeys($dir, 'maptipsResources*.json');
            foreach ($found as $k => $fn) {
                $titleKeys[$k] = true;
            }
        }

        // 5. Fehlende Layer-Aliase finden
        $missingLayers = [];
        foreach ($layerKeys as $key => $info) {
            $aliasKey1 = 'desc_' . $key;
            $aliasKey2 = 'desc_' . str_replace('/', '_', $key);
            if (!isset($descKeys[$aliasKey1]) && !isset($descKeys[$aliasKey2])) {
                // Ziel-NLS-Datei: layers_<suffix>.conf → lyrmgrResources_<suffix>.json
                $suffix = preg_replace('/^layers/', '', pathinfo($info['file'], PATHINFO_FILENAME));
                $targetFile = 'lyrmgrResources' . $suffix . '.json';
                // Zielverzeichnis: config-source → nls-source
                $targetSource = ($info['source'] === 'core' || $info['source'] === 'override')
                    ? $info['source'] . '_nls' : $info['source'];
                $missingLayers[] = [
                    'key'      => $key,
                    'file'     => $info['file'],
                    'source'   => $info['source'],
                    'type'     => 'layer',
                    'expected' => $aliasKey1,
                    'targetFile'   => $targetFile,
                    'targetSource' => $targetSource,
                    'defaultValue' => end(explode('/', $key))
                ];
            }
        }

        // 6. Fehlende Maptip-Titel finden
        $missingMaptips = [];
        foreach ($maptipKeys as $key => $info) {
            $titleKey = $key . '_title';
            if (!isset($titleKeys[$titleKey])) {
                // Ziel-NLS-Datei: maptips_<suffix>.conf → maptipsResources_<suffix>.json
                $suffix = preg_replace('/^maptips/', '', pathinfo($info['file'], PATHINFO_FILENAME));
                $targetFile = 'maptipsResources' . $suffix . '.json';
                $targetSource = ($info['source'] === 'core' || $info['source'] === 'override')
                    ? $info['source'] . '_nls' : $info['source'];
                $missingMaptips[] = [
                    'key'      => $key,
                    'file'     => $info['file'],
                    'source'   => $info['source'],
                    'nls'      => $info['nls'],
                    'type'     => 'maptip',
                    'expected' => $titleKey,
                    'targetFile'   => $targetFile,
                    'targetSource' => $targetSource,
                    'defaultValue' => end(explode('/', $key))
                ];
            }
        }

        // Nach Key sortieren
        usort($missingLayers, function($a, $b) { return strcmp($a['key'], $b['key']); });
        usort($missingMaptips, function($a, $b) { return strcmp($a['key'], $b['key']); });

        jsonResponse(['success' => true, 'data' => [
            'missingLayers'  => $missingLayers,
            'missingMaptips' => $missingMaptips,
            'totalLayers'    => count($layerKeys),
            'totalMaptips'   => count($maptipKeys),
            'totalDescKeys'  => count($descKeys),
            'totalTitleKeys' => count($titleKeys)
        ]]);
        break;

    // ── Deployed: NLS-Eintrag in JSON-Datei einfügen ──
    case 'add-nls-entry':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        $body = json_decode(file_get_contents('php://input'), true);
        if (!$body) jsonError('Ungültiger JSON-Body', 400);

        $targetFile   = basename($body['targetFile'] ?? '');
        $targetSource = $body['targetSource'] ?? '';
        $nlsKey       = $body['nlsKey'] ?? '';
        $nlsValue     = $body['nlsValue'] ?? '';
        $profile      = $body['profile'] ?? 'public';

        if (!$targetFile || !$targetSource || !$nlsKey) {
            jsonError('targetFile, targetSource und nlsKey erforderlich', 400);
        }
        if (!preg_match('/^[a-zA-Z0-9][a-zA-Z0-9_\-\.]*\.json$/', $targetFile)) {
            jsonError('Ungültiger Dateiname: ' . $targetFile, 400);
        }

        // Verzeichnis bestimmen
        $safeProf = preg_replace('/[^a-zA-Z0-9_\-]/', '', $profile ?: 'public');
        $nlsTargetDir = null;
        switch ($targetSource) {
            case 'core_nls':     $nlsTargetDir = realpath(CORE_NLS_DIR); break;
            case 'override_nls': $nlsTargetDir = realpath(APP_CORE_NLS_DIR); break;
            case 'profile_' . $safeProf:
                $nlsTargetDir = defined('CONFIG_BASE') ? CONFIG_BASE : null;
                break;
            default:
                // Fallback: core_nls verwenden
                $nlsTargetDir = realpath(CORE_NLS_DIR);
        }

        if (!$nlsTargetDir || !is_dir($nlsTargetDir)) {
            jsonError('NLS-Verzeichnis nicht gefunden für: ' . $targetSource, 400);
        }

        $filePath = $nlsTargetDir . '/' . $targetFile;

        // Datei lesen oder leeres Objekt
        $data = [];
        if (file_exists($filePath)) {
            $raw = file_get_contents($filePath);
            $data = json_decode($raw, true);
            if (!is_array($data)) {
                jsonError('JSON-Parse-Fehler in ' . $targetFile, 500);
            }
        }

        // Key bereits vorhanden?
        if (isset($data[$nlsKey])) {
            jsonResponse(['success' => true, 'data' => [
                'action'  => 'exists',
                'message' => 'Key existiert bereits: ' . $nlsKey,
                'file'    => $targetFile
            ]]);
            break;
        }

        // Eintrag hinzufügen
        $data[$nlsKey] = $nlsValue;

        // Sortiert schreiben
        ksort($data, SORT_STRING);
        $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($json === false) {
            jsonError('JSON-Encoding-Fehler', 500);
        }

        // Backup erstellen
        $backupDir = (defined('DATA_DIR') ? DATA_DIR : sys_get_temp_dir()) . '/nls-backups';
        if (!is_dir($backupDir)) mkdir($backupDir, 0755, true);
        if (file_exists($filePath)) {
            copy($filePath, $backupDir . '/' . $targetFile . '.' . date('Ymd_His') . '.bak');
        }

        // Schreiben
        $written = file_put_contents($filePath, $json . "\n");
        if ($written === false) {
            jsonError('Schreibfehler: ' . $filePath, 500);
        }

        jsonResponse(['success' => true, 'data' => [
            'action'  => 'added',
            'message' => 'NLS-Eintrag hinzugefügt',
            'file'    => $targetFile,
            'key'     => $nlsKey,
            'value'   => $nlsValue,
            'bytes'   => $written
        ]]);
        break;

    // ── Deployed-Conf: Backup erstellen + SFTP-Pfad zurückgeben (Löschen via FastAPI) ──
    case 'prepare-delete-conf':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        $body = json_decode(file_get_contents('php://input'), true);
        if (!$body) jsonError('Ungültiger JSON-Body', 400);

        $fileName = $body['fileName'] ?? null;
        $source   = $body['source'] ?? null;
        $profile  = $body['profile'] ?? 'public';

        if (!$fileName || !$source) jsonError('fileName und source erforderlich', 400);

        // Dateiname sanitizen
        $safeFile = basename($fileName);
        if (!preg_match('/^[a-zA-Z0-9][a-zA-Z0-9_\-\.]*\.(conf|json)$/', $safeFile)) {
            jsonError('Ungültiger Dateiname: ' . $safeFile, 400);
        }

        // Verzeichnis bestimmen
        $safeProf = preg_replace('/[^a-zA-Z0-9_\-]/', '', $profile ?: 'public');
        $targetDir = null;
        switch ($source) {
            case 'core':
                $targetDir = realpath(CORE_CONFIG_DIR);
                break;
            case 'core_nls':
                $targetDir = realpath(CORE_NLS_DIR);
                break;
            case 'override':
                $targetDir = realpath(APP_CORE_CONFIG_DIR);
                break;
            case 'override_nls':
                $targetDir = realpath(APP_CORE_NLS_DIR);
                break;
            default:
                // profile_public, profile_xyz etc.
                if (strpos($source, 'profile_') === 0) {
                    $profName = substr($source, 8);
                    $safeProfName = preg_replace('/[^a-zA-Z0-9_\-]/', '', $profName);
                    $targetDir = ($safeProfName === 'public' || !$safeProfName) ? CONFIG_BASE : CONFIG_BASE . '/' . $safeProfName;
                } else {
                    jsonError('Unbekannte Quelle: ' . $source, 400);
                }
        }

        if (!$targetDir || !is_dir($targetDir)) {
            jsonError('Zielverzeichnis nicht gefunden', 404);
        }

        $fullPath = $targetDir . '/' . $safeFile;
        if (!file_exists($fullPath)) {
            jsonError('Datei nicht gefunden: ' . $safeFile . ' in ' . $source, 404);
        }

        // Backup erstellen in schreibbares Verzeichnis (bevor FastAPI löscht)
        $ts = date('Ymd_His');
        $backupFile = $source . '_' . preg_replace('/(\.(conf|json))$/', '.' . $ts . '.bak$1', $safeFile);
        $backupDir = DATA_DIR . '/deleted-backups';
        if (!is_dir($backupDir)) @mkdir($backupDir, 0775, true);
        $backupPath = $backupDir . '/' . $backupFile;
        if (!@copy($fullPath, $backupPath)) {
            // Zweiter Versuch: Direkt im selben Verzeichnis
            $backupPath2 = $targetDir . '/' . preg_replace('/(\.(conf|json))$/', '.' . $ts . '.bak$1', $safeFile);
            if (!@copy($fullPath, $backupPath2)) {
                jsonError('Backup konnte nicht erstellt werden (weder in ' . $backupDir . ' noch in ' . $targetDir . ')', 500);
            }
            $backupFile = basename($backupPath2);
            $backupPath = $backupPath2;
        }

        // PHP-Pfad → SFTP-Pfad
        $sftpDeletePath = toSftpPath($fullPath);

        jsonResponse(['success' => true, 'data' => [
            'fileName'    => $safeFile,
            'source'      => $source,
            'deletePath'  => $sftpDeletePath,
            'backupFile'  => basename($backupPath),
            'timestamp'   => date('Y-m-d H:i:s')
        ]]);
        break;

    // -- Deployed-Conf: Backup + Content in Temp-Datei → stagedPath/deployPath für deploy-staged-conf --
    case 'prepare-save-conf':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        $body = json_decode(file_get_contents('php://input'), true);
        if (!$body) jsonError('Ungültiger JSON-Body', 400);

        $fileName = $body['fileName'] ?? null;
        $source   = $body['source'] ?? null;
        $content  = $body['content'] ?? null;
        $profile  = $body['profile'] ?? 'public';

        if (!$fileName || !$source || $content === null) jsonError('fileName, source und content erforderlich', 400);

        $safeFile = basename($fileName);
        if (!preg_match('/^[a-zA-Z0-9][a-zA-Z0-9_\-\.]*\.(conf|json)$/', $safeFile)) {
            jsonError('Ungültiger Dateiname: ' . $safeFile, 400);
        }

        // Zielverzeichnis bestimmen (gleiche Logik wie prepare-delete-conf)
        $targetDir = null;
        switch ($source) {
            case 'core':         $targetDir = realpath(CORE_CONFIG_DIR); break;
            case 'core_nls':     $targetDir = realpath(CORE_NLS_DIR); break;
            case 'override':     $targetDir = realpath(APP_CORE_CONFIG_DIR); break;
            case 'override_nls': $targetDir = realpath(APP_CORE_NLS_DIR); break;
            default:
                if (strpos($source, 'profile_') === 0) {
                    $profName = substr($source, 8);
                    $safeProfName = preg_replace('/[^a-zA-Z0-9_\-]/', '', $profName);
                    $targetDir = ($safeProfName === 'public' || !$safeProfName) ? CONFIG_BASE : CONFIG_BASE . '/' . $safeProfName;
                } else {
                    jsonError('Unbekannte Quelle: ' . $source, 400);
                }
        }

        if (!$targetDir || !is_dir($targetDir)) jsonError('Zielverzeichnis nicht gefunden', 404);

        $fullPath = $targetDir . '/' . $safeFile;
        if (!file_exists($fullPath)) jsonError('Datei nicht gefunden: ' . $safeFile . ' in ' . $source, 404);

        // Backup erstellen in schreibbares Verzeichnis
        $ts = date('Ymd_His');
        $backupFile = $source . '_' . preg_replace('/(\.(conf|json))$/', '.' . $ts . '.bak$1', $safeFile);
        $backupDir = DATA_DIR . '/edit-backups';
        if (!is_dir($backupDir)) @mkdir($backupDir, 0775, true);
        $backupPath = $backupDir . '/' . $backupFile;
        if (!@copy($fullPath, $backupPath)) {
            $backupPath2 = $targetDir . '/' . preg_replace('/(\.(conf|json))$/', '.' . $ts . '.bak$1', $safeFile);
            if (!@copy($fullPath, $backupPath2)) {
                jsonError('Backup konnte nicht erstellt werden', 500);
            }
            $backupFile = basename($backupPath2);
        }

        // Content in Temp-Datei (staged) schreiben — gleicher Pfad wie stage-layer-conf
        $stagedDir = TNET_TMP_ROOT . '/stageConf/edit';
        if (!is_dir($stagedDir)) @mkdir($stagedDir, 0775, true);
        $stagedFile = $stagedDir . '/' . $safeFile;
        if (file_put_contents($stagedFile, $content) === false) {
            jsonError('Temp-Datei konnte nicht geschrieben werden', 500);
        }

        // Pfade für FastAPI deploy-staged-conf: /data/-Pfade
        $stagedSftp = toSftpPath($stagedFile);
        $deploySftp = toSftpPath($fullPath);

        jsonResponse(['success' => true, 'data' => [
            'fileName'   => $safeFile,
            'source'     => $source,
            'stagedPath' => $stagedSftp,
            'deployPath' => $deploySftp,
            'backupFile' => basename($backupPath ?: $backupPath2),
            'bytes'      => strlen($content),
            'timestamp'  => date('Y-m-d H:i:s')
        ]]);
        break;

    // =====================================================================
    // LEGENDTUNER — Konfiguration pro Service
    // =====================================================================

    case 'legend-tuner-load':
        // Lade Draft aus tmp/legend-conf, falls vorhanden; sonst deployed aus core/config
        $tunerDir     = TNET_TMP_ROOT . '/legend-conf';
        $draftFile    = $tunerDir . '/legend_tuner.json';
        $deployedFile = CORE_CONFIG_DIR . '/legend_tuner.json';
        $source = 'empty';
        $data   = new \stdClass();

        if (file_exists($draftFile)) {
            $raw = @file_get_contents($draftFile);
            if ($raw !== false) {
                $parsed = json_decode($raw, true);
                if ($parsed !== null || json_last_error() === JSON_ERROR_NONE) {
                    $data = $parsed ?: new \stdClass();
                    $source = 'draft';
                }
            }
        } elseif (file_exists($deployedFile)) {
            $raw = @file_get_contents($deployedFile);
            if ($raw !== false) {
                $parsed = json_decode($raw, true);
                if ($parsed !== null || json_last_error() === JSON_ERROR_NONE) {
                    $data = $parsed ?: new \stdClass();
                    $source = 'deployed';
                }
            }
        }

        // Prüfe ob deployed-Version existiert und identisch ist
        $deployedExists = file_exists($deployedFile);
        $deployedSync   = false;
        if ($deployedExists && $source === 'draft') {
            $depRaw = @file_get_contents($deployedFile);
            $deployedSync = ($depRaw !== false && md5($depRaw) === md5(json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)));
        }

        jsonResponse([
            'success'        => true,
            'data'           => $data,
            'source'         => $source,
            'draftPath'      => $draftFile,
            'deployedPath'   => $deployedFile,
            'deployedExists' => $deployedExists,
            'deployedSync'   => $deployedSync
        ]);
        break;

    case 'legend-tuner-save':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            jsonError('POST erwartet', 405);
        }
        $body = file_get_contents('php://input');
        if ($body === false || trim($body) === '') {
            jsonError('Leerer Request-Body', 400);
        }
        $data = json_decode($body, true);
        if ($data === null && json_last_error() !== JSON_ERROR_NONE) {
            jsonError('Ungültiges JSON: ' . json_last_error_msg(), 400);
        }

        // Speichere in tmp/legend-conf — PHP hat hier Schreibrecht
        $tunerDir  = TNET_TMP_ROOT . '/legend-conf';
        if (!is_dir($tunerDir)) { @mkdir($tunerDir, 0775, true); }
        $tunerFile = $tunerDir . '/legend_tuner.json';

        // Backup erstellen falls vorhanden
        if (file_exists($tunerFile)) {
            $backupFile = $tunerFile . '.' . date('Ymd_His') . '.bak';
            @copy($tunerFile, $backupFile);
        }

        $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $written = @file_put_contents($tunerFile, $json, LOCK_EX);
        if ($written === false) {
            jsonError('Konnte legend_tuner.json nicht schreiben: ' . $tunerFile, 500);
        }
        jsonResponse([
            'success' => true,
            'message' => 'Legendtuner-Entwurf gespeichert',
            'path'    => $tunerFile,
            'entries' => count($data),
            'bytes'   => $written
        ]);
        break;

    // =================================================================
    // BOOKMARKS — Laden & Speichern (Draft in tmp, Deployed im Webroot)
    // Daten werden via BookmarkNormalizer immer auf Schema v2 normalisiert.
    // =================================================================
    case 'bookmarks-load':
        require_once __DIR__ . '/../includes/BookmarkNormalizer.php';
        require_once __DIR__ . '/../includes/ConfigSource.php';

        // DB-first: bei configSource=db aus der Staging-DB lesen.
        // Bei DB-Ausfall faellt der Code (sofern fallbackToFiles aktiv) auf die
        // bestehende Datei-Logik unten zurueck.
        if (ConfigSource::useDb('bookmarks')) {
            require_once __DIR__ . '/../includes/BookmarkRepository.php';
            try {
                $bm   = BookmarkRepository::loadAll();
                $lock = BookmarkRepository::lockStatus();
                jsonResponse([
                    'success'       => true,
                    'data'          => $bm['data'],
                    'count'         => count($bm['data']),
                    'source'        => 'db',
                    'revision'      => $bm['revision'],
                    'lock'          => $lock,
                    'schemaVersion' => 2
                ]);
            } catch (\Throwable $e) {
                if (!ConfigSource::fallbackEnabled()) {
                    jsonError('Bookmarks-DB nicht verfuegbar: ' . $e->getMessage(), 500);
                }
                error_log('bookmarks-load: DB-Fallback auf Datei: ' . $e->getMessage());
                // weiter mit Datei-Logik unten
            }
        }

        $bmDraftDir    = TNET_TMP_ROOT . '/bookmarks';
        $bmDraftFile   = $bmDraftDir . '/map-bookmarks-all.json';
        $bmDeployedFile = APP_WEB_ROOT . '/tnet/data/map-bookmarks-all.json';
        $bmSource = 'empty';
        $bmData   = [];

        if (file_exists($bmDraftFile)) {
            $raw = @file_get_contents($bmDraftFile);
            if ($raw !== false) {
                $parsed = json_decode($raw, true);
                if ($parsed !== null || json_last_error() === JSON_ERROR_NONE) {
                    $bmData = $parsed ?: [];
                    $bmSource = 'draft';
                }
            }
        } elseif (file_exists($bmDeployedFile)) {
            $raw = @file_get_contents($bmDeployedFile);
            if ($raw !== false) {
                $parsed = json_decode($raw, true);
                if ($parsed !== null || json_last_error() === JSON_ERROR_NONE) {
                    $bmData = $parsed ?: [];
                    $bmSource = 'deployed';
                }
            }
        }

        // Auf Schema v2 normalisieren (Editor erwartet jetzt v2-Struktur).
        $bmData = BookmarkNormalizer::normalizeAll(is_array($bmData) ? $bmData : []);

        // Prüfe ob deployed-Version existiert und identisch ist (nach Normalisierung).
        $bmDeployedExists = file_exists($bmDeployedFile);
        $bmDeployedSync   = false;
        if ($bmDeployedExists && $bmSource === 'draft') {
            $depRaw = @file_get_contents($bmDeployedFile);
            if ($depRaw !== false) {
                $depParsed = json_decode($depRaw, true);
                if (is_array($depParsed)) {
                    $depNormalized = BookmarkNormalizer::normalizeAll($depParsed);
                    $bmDeployedSync = (json_encode($bmData) === json_encode($depNormalized));
                }
            }
        }

        jsonResponse([
            'success'        => true,
            'data'           => $bmData,
            'count'          => count($bmData),
            'source'         => $bmSource,
            'deployedExists' => $bmDeployedExists,
            'deployedSync'   => $bmDeployedSync,
            'schemaVersion'  => 2
        ]);
        break;

    case 'bookmarks-save':
        require_once __DIR__ . '/../includes/BookmarkNormalizer.php';
        require_once __DIR__ . '/../includes/ConfigSource.php';

        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            jsonError('POST erwartet', 405);
        }
        $body = file_get_contents('php://input');
        if ($body === false || trim($body) === '') {
            jsonError('Leerer Request-Body', 400);
        }
        $decoded = json_decode($body, true);
        if ($decoded === null && json_last_error() !== JSON_ERROR_NONE) {
            jsonError('Ungültiges JSON: ' . json_last_error_msg(), 400);
        }

        // Body kann ein reines Array (Legacy) oder ein Objekt mit Metadaten sein:
        //   { bookmarks: [...], revision: <int>, user: '<name>' }
        $bmRevision = null;
        $bmUser     = null;
        if (is_array($decoded) && isset($decoded['bookmarks']) && is_array($decoded['bookmarks'])) {
            $data       = $decoded['bookmarks'];
            $bmRevision = isset($decoded['revision']) ? (int)$decoded['revision'] : null;
            $bmUser     = isset($decoded['user']) ? (string)$decoded['user'] : null;
        } elseif (is_array($decoded)) {
            $data = $decoded;
        } else {
            jsonError('Array erwartet', 400);
        }
        if ($bmUser === null && isset($_GET['user'])) {
            $bmUser = (string)$_GET['user'];
        }

        // DB-first: bei configSource=db in die Staging-DB speichern (Optimistic Locking).
        if (ConfigSource::useDb('bookmarks')) {
            require_once __DIR__ . '/../includes/BookmarkRepository.php';
            try {
                $res = BookmarkRepository::saveAll($data, $bmRevision, $bmUser);
                if (!empty($res['conflict'])) {
                    jsonResponse([
                        'success'       => false,
                        'conflict'      => true,
                        'message'       => 'Versionskonflikt: Die Bookmarks wurden zwischenzeitlich geändert. Bitte Stand vergleichen.',
                        'revision'      => $res['revision'],
                        'serverData'    => $res['serverData'],
                        'count'         => $res['count'],
                        'schemaVersion' => 2
                    ], 409);
                }

                // Draft-Datei als Export aktualisieren, damit die bestehende
                // SFTP-Deploy-Pipeline (FastAPI /deploy-bookmarks) unveraendert
                // den korrekten Stand publiziert.
                $exportList = BookmarkNormalizer::normalizeAll($data);
                $bmDraftDir = TNET_TMP_ROOT . '/bookmarks';
                if (!is_dir($bmDraftDir)) { @mkdir($bmDraftDir, 0775, true); }
                @file_put_contents(
                    $bmDraftDir . '/map-bookmarks-all.json',
                    json_encode($exportList, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                    LOCK_EX
                );

                jsonResponse([
                    'success'       => true,
                    'message'       => 'Bookmarks gespeichert (DB)',
                    'count'         => $res['count'],
                    'revision'      => $res['revision'],
                    'source'        => 'db',
                    'schemaVersion' => 2
                ]);
            } catch (\Throwable $e) {
                if (!ConfigSource::fallbackEnabled()) {
                    jsonError('Bookmarks-DB Speichern fehlgeschlagen: ' . $e->getMessage(), 500);
                }
                error_log('bookmarks-save: DB-Fallback auf Datei: ' . $e->getMessage());
                // weiter mit Datei-Logik unten
            }
        }

        // Normalisiere alles auf v2 — Editor darf gemischtes oder unvollständiges Format senden.
        $data = BookmarkNormalizer::normalizeAll($data);

        // Speichere Draft in tmp — PHP hat hier Schreibrecht
        $bmDraftDir = TNET_TMP_ROOT . '/bookmarks';
        if (!is_dir($bmDraftDir)) { @mkdir($bmDraftDir, 0775, true); }
        $bmDraftFile = $bmDraftDir . '/map-bookmarks-all.json';

        // Backup erstellen falls vorhanden
        if (file_exists($bmDraftFile)) {
            $backupFile = $bmDraftFile . '.' . date('Ymd_His') . '.bak';
            @copy($bmDraftFile, $backupFile);
        }

        $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $written = @file_put_contents($bmDraftFile, $json, LOCK_EX);
        if ($written === false) {
            jsonError('Konnte Bookmarks-Draft nicht schreiben: ' . $bmDraftFile, 500);
        }
        jsonResponse([
            'success'       => true,
            'message'       => 'Bookmarks-Entwurf gespeichert',
            'count'         => count($data),
            'bytes'         => $written,
            'schemaVersion' => 2
        ]);
        break;

    // =================================================================
    // BOOKMARKS — Soft-Lock (UI-Hinweis fuer Mehrbenutzer-Editing)
    // =================================================================
    case 'bookmarks-lock-status':
        require_once __DIR__ . '/../includes/ConfigSource.php';
        if (!ConfigSource::useDb('bookmarks')) {
            jsonResponse(['success' => true, 'lock' => null, 'source' => 'files']);
        }
        require_once __DIR__ . '/../includes/BookmarkRepository.php';
        try {
            jsonResponse([
                'success' => true,
                'lock'    => BookmarkRepository::lockStatus(),
                'source'  => 'db'
            ]);
        } catch (\Throwable $e) {
            jsonError('Lock-Status nicht verfuegbar: ' . $e->getMessage(), 500);
        }
        break;

    case 'bookmarks-lock':
        require_once __DIR__ . '/../includes/ConfigSource.php';
        if (!ConfigSource::useDb('bookmarks')) {
            jsonResponse(['success' => true, 'locked' => true, 'mine' => true, 'source' => 'files']);
        }
        require_once __DIR__ . '/../includes/BookmarkRepository.php';
        $lockBody = json_decode(file_get_contents('php://input'), true);
        $lockUser = is_array($lockBody) && isset($lockBody['user'])
            ? (string)$lockBody['user']
            : (string)($_GET['user'] ?? 'unbekannt');
        try {
            $lock = BookmarkRepository::acquireLock($lockUser);
            jsonResponse(['success' => true] + $lock + ['source' => 'db']);
        } catch (\Throwable $e) {
            jsonError('Lock konnte nicht gesetzt werden: ' . $e->getMessage(), 500);
        }
        break;

    case 'bookmarks-unlock':
        require_once __DIR__ . '/../includes/ConfigSource.php';
        if (!ConfigSource::useDb('bookmarks')) {
            jsonResponse(['success' => true, 'released' => true, 'source' => 'files']);
        }
        require_once __DIR__ . '/../includes/BookmarkRepository.php';
        $unlockBody = json_decode(file_get_contents('php://input'), true);
        $unlockUser = is_array($unlockBody) && isset($unlockBody['user'])
            ? (string)$unlockBody['user']
            : (string)($_GET['user'] ?? 'unbekannt');
        try {
            $rel = BookmarkRepository::releaseLock($unlockUser);
            jsonResponse(['success' => true] + $rel + ['source' => 'db']);
        } catch (\Throwable $e) {
            jsonError('Lock konnte nicht freigegeben werden: ' . $e->getMessage(), 500);
        }
        break;

    // =================================================================
    // BOOKMARKS — Publish (DB -> deployte Laufzeit-Datei) /
    //             Checkout (deployte Datei -> DB-Stage)
    // Interim-Stand fuer den Pilot: Files bleiben Laufzeit-/Legacy-Export,
    // bis das schemabasierte Stage->Prod-Promote (Phase 3) steht.
    // =================================================================
    case 'bookmarks-publish':
        require_once __DIR__ . '/../includes/ConfigSource.php';
        require_once __DIR__ . '/../includes/BookmarkNormalizer.php';
        if (!ConfigSource::useDb('bookmarks')) {
            jsonError('Publish ist nur im DB-Modus verfuegbar (configSource.bookmarks=db).', 400);
        }
        require_once __DIR__ . '/../includes/BookmarkRepository.php';
        try {
            $bm   = BookmarkRepository::loadAll();
            $list = BookmarkNormalizer::normalizeAll($bm['data']);
            $bmDeployedFile = APP_WEB_ROOT . '/tnet/data/map-bookmarks-all.json';
            if (file_exists($bmDeployedFile)) {
                @copy($bmDeployedFile, $bmDeployedFile . '.' . date('Ymd_His') . '.bak');
            }
            $json = json_encode($list, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            $written = @file_put_contents($bmDeployedFile, $json, LOCK_EX);
            if ($written === false) {
                jsonError('Konnte Laufzeit-Datei nicht schreiben (ggf. via SFTP deployen): ' . $bmDeployedFile, 500);
            }
            jsonResponse([
                'success'  => true,
                'message'  => 'Bookmarks publiziert (DB -> Laufzeit-Datei)',
                'count'    => count($list),
                'bytes'    => $written,
                'revision' => $bm['revision']
            ]);
        } catch (\Throwable $e) {
            jsonError('Publish fehlgeschlagen: ' . $e->getMessage(), 500);
        }
        break;

    case 'bookmarks-checkout':
        require_once __DIR__ . '/../includes/ConfigSource.php';
        require_once __DIR__ . '/../includes/BookmarkNormalizer.php';
        if (!ConfigSource::useDb('bookmarks')) {
            jsonError('Checkout ist nur im DB-Modus verfuegbar (configSource.bookmarks=db).', 400);
        }
        require_once __DIR__ . '/../includes/BookmarkRepository.php';
        $coBody = json_decode(file_get_contents('php://input'), true);
        $coUser = is_array($coBody) && isset($coBody['user'])
            ? (string)$coBody['user']
            : (string)($_GET['user'] ?? 'checkout');
        $bmDeployedFile = APP_WEB_ROOT . '/tnet/data/map-bookmarks-all.json';
        if (!file_exists($bmDeployedFile)) {
            jsonError('Keine Laufzeit-Datei zum Checkout gefunden: ' . $bmDeployedFile, 404);
        }
        $coRaw = @file_get_contents($bmDeployedFile);
        $coData = json_decode($coRaw !== false ? $coRaw : '', true);
        if (!is_array($coData)) {
            jsonError('Laufzeit-Datei ist kein gueltiges JSON-Array', 422);
        }
        try {
            // Optimistic-Check bewusst uebersprungen (bewusster Reset aus Prod-Stand)
            $res = BookmarkRepository::saveAll($coData, null, $coUser);
            jsonResponse([
                'success'  => true,
                'message'  => 'Bookmarks aus Laufzeit-Datei in DB uebernommen (Checkout)',
                'count'    => $res['count'],
                'revision' => $res['revision']
            ]);
        } catch (\Throwable $e) {
            jsonError('Checkout fehlgeschlagen: ' . $e->getMessage(), 500);
        }
        break;

    // ── Dienst-Verfügbarkeit prüfen (Verify) ──
    case 'verify-services':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST erforderlich', 405);
        $body = json_decode(file_get_contents('php://input'), true);
        $urls = is_array($body['urls'] ?? null) ? $body['urls'] : [];
        if (empty($urls)) jsonError('urls-Array leer', 400);
        // Maximal 50 URLs pro Request
        if (count($urls) > 50) $urls = array_slice($urls, 0, 50);

        // Basis-URL für relative Pfade (eigener Server)
        $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
        $selfBase = $scheme . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost');

        $results = [];
        $mh = curl_multi_init();
        $handles = [];

        foreach ($urls as $idx => $urlEntry) {
            $url = is_string($urlEntry) ? $urlEntry : ($urlEntry['url'] ?? '');
            if (!$url) continue;
            $type = is_string($urlEntry) ? 'unknown' : ($urlEntry['type'] ?? 'unknown');
            $typeLC = strtolower($type);

            // Relative URLs → absolut machen
            $absUrl = $url;
            if (strpos($url, '//') === false && strpos($url, '/') === 0) {
                $absUrl = $selfBase . $url;
            }

            // Prüf-URL bauen je nach Dienst-Typ
            $checkUrl = $absUrl;
            if ($typeLC === 'arcgisrest' || strpos($url, 'agsproxy') !== false) {
                // ArcGIS REST via Proxy: path-Parameter beibehalten, &f=json anhängen
                if (strpos($absUrl, 'agsproxy') !== false) {
                    $sep = strpos($absUrl, '?') !== false ? '&' : '?';
                    $checkUrl = $absUrl . $sep . 'f=json';
                } else {
                    $checkUrl = rtrim(preg_replace('/\?.*/', '', $absUrl), '/') . '?f=json';
                }
            } elseif ($typeLC === 'wms' || $typeLC === 'tilewms') {
                // WMS: GetCapabilities
                $sep = strpos($absUrl, '?') !== false ? '&' : '?';
                $checkUrl = $absUrl . $sep . 'SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0';
            } elseif ($typeLC === 'wmts') {
                $sep = strpos($absUrl, '?') !== false ? '&' : '?';
                $checkUrl = $absUrl . $sep . 'SERVICE=WMTS&REQUEST=GetCapabilities';
            }

            $ch = curl_init($checkUrl);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT        => 15,
                CURLOPT_CONNECTTIMEOUT => 8,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_MAXREDIRS      => 3,
                CURLOPT_SSL_VERIFYPEER => false,
                CURLOPT_SSL_VERIFYHOST => 0,
                CURLOPT_NOBODY         => false,
                CURLOPT_USERAGENT      => 'MapPlus-ServiceVerify/1.0',
            ]);
            curl_multi_add_handle($mh, $ch);
            $handles[$idx] = ['ch' => $ch, 'url' => $url, 'checkUrl' => $checkUrl, 'type' => $type, 'typeLC' => $typeLC];
        }

        // Alle parallel ausführen
        $running = null;
        do {
            curl_multi_exec($mh, $running);
            curl_multi_select($mh, 0.5);
        } while ($running > 0);

        // Ergebnisse auswerten
        foreach ($handles as $idx => $h) {
            $ch = $h['ch'];
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $totalTime = round(curl_getinfo($ch, CURLINFO_TOTAL_TIME) * 1000);
            $error = curl_error($ch);
            // 200–399 = OK, 206 = Partial Content (wegen RANGE)
            $ok = ($httpCode >= 200 && $httpCode < 400);

            $responseBody = curl_multi_getcontent($ch);

            // Bei ArcGIS: Body prüfen ob JSON-Antwort gültig ist
            if ($h['typeLC'] === 'arcgisrest' && $ok) {
                $json = @json_decode($responseBody, true);
                if (!$json || isset($json['error'])) {
                    $ok = false;
                    $error = isset($json['error']['message']) ? $json['error']['message'] : 'Ungültige ArcGIS-Antwort';
                }
            }

            // Bei WMS: prüfen ob XML / Capabilities zurückkam
            if (($h['typeLC'] === 'wms' || $h['typeLC'] === 'tilewms') && $ok && $responseBody) {
                // OGC ServiceException erkennen (MapServer/GeoServer liefern HTTP 200 + Exception-XML)
                if (stripos($responseBody, 'ServiceException') !== false
                    || stripos($responseBody, 'msSetError') !== false
                    || stripos($responseBody, 'ExceptionReport') !== false
                    || stripos($responseBody, '<ows:Exception') !== false) {
                    $ok = false;
                    // Fehlermeldung aus dem XML extrahieren
                    if (preg_match('/<ServiceException[^>]*>(.*?)<\/ServiceException>/si', $responseBody, $exm)) {
                        $error = 'OGC: ' . trim(strip_tags($exm[1]));
                    } else {
                        $error = 'OGC ServiceException';
                    }
                }
                // Kein XML und kein Capabilities → verdächtig
                elseif (strpos($responseBody, '<?xml') === false && stripos($responseBody, '<wms') === false
                    && stripos($responseBody, 'WMS_Capabilities') === false && stripos($responseBody, 'WMT_MS_Capabilities') === false) {
                    if (stripos($responseBody, 'error') !== false || stripos($responseBody, '404') !== false) {
                        $ok = false;
                        $error = 'Antwort ist kein gültiges WMS-XML';
                    }
                }
                // Gültiges Capabilities → prüfen ob mindestens ein <Layer> vorhanden
                elseif (stripos($responseBody, '<Layer') === false) {
                    $ok = false;
                    $error = 'Capabilities ohne Layer-Definition';
                }
            }

            $results[] = [
                'url'      => $h['url'],
                'type'     => $h['type'],
                'ok'       => $ok,
                'httpCode' => $httpCode,
                'timeMs'   => $totalTime,
                'error'    => $error ?: null,
            ];
            curl_multi_remove_handle($mh, $ch);
            curl_close($ch);
        }
        curl_multi_close($mh);

        jsonResponse([
            'success' => true,
            'data'    => [
                'results'  => $results,
                'checked'  => count($results),
                'ok'       => count(array_filter($results, function($r) { return $r['ok']; })),
                'failed'   => count(array_filter($results, function($r) { return !$r['ok']; })),
            ]
        ]);
        break;

    default:
        jsonResponse([
            'success' => true,
            'data' => [
                'name'    => 'Tree-Builder Persistence API',
                'version' => '3.2',
                'actions' => ['load', 'save', 'lock', 'unlock', 'lock-status', 'history', 'restore', 'save-groups', 'load-groups', 'save-profile', 'load-profile', 'list-profiles', 'load-lyrmgr', 'save-lyrmgr-draft', 'publish-lyrmgr', 'list-lyrmgr-profiles', 'list-all-layers', 'deploy-lyrmgr', 'ags-services', 'ags-export', 'ags-list-raw', 'ags-delete-raw', 'ags-delete-backups', 'ags-read-raw', 'ags-write-raw', 'staging-layers-flat', 'config-editor-load', 'config-editor-save', 'config-export-to-core', 'export-catalog-artifacts', 'deploy-catalog-artifacts', 'core-list-sources', 'core-import', 'qgis-list-projects', 'qgis-capabilities', 'legend-tuner-load', 'legend-tuner-save', 'bookmarks-load', 'bookmarks-save'],
                'storage' => DATA_DIR
            ]
        ]);
}
