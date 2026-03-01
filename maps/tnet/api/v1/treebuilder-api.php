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
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Editor-Name');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// =====================================================================
// Config
// =====================================================================
$docRoot = rtrim($_SERVER['DOCUMENT_ROOT'] ?? '/var/www/html/nwow', '/');
define('DATA_DIR', $docRoot . '/data/layertree');
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

function getEditorName() {
    // From header or query param
    return $_SERVER['HTTP_X_EDITOR_NAME'] ?? $_GET['editor'] ?? 'Unbekannt';
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
define('CONFIG_BASE', $docRoot . '/maps/public/config');

function getConfigPath($profile) {
    $safe = preg_replace('/[^a-zA-Z0-9_\-]/', '', $profile);
    if ($safe === 'public') {
        return CONFIG_BASE . '/lyrmgr.conf';
    }
    return CONFIG_BASE . '/' . $safe . '/lyrmgr.conf';
}

function loadLyrmgrConf($profile) {
    $path = getConfigPath($profile);
    if (!file_exists($path)) {
        return ['exists' => false, 'path' => $path, 'profile' => $profile];
    }
    $content = file_get_contents($path);
    $data = json_decode($content, true);
    if ($data === null) {
        return ['exists' => true, 'error' => 'JSON parse error: ' . json_last_error_msg(), 'path' => $path];
    }
    $lyrmgrKeys = array_keys($data);
    return [
        'exists'     => true,
        'profile'    => $profile,
        'path'       => $path,
        'lyrmgrKeys' => $lyrmgrKeys,
        'data'       => $data,
        'size'       => strlen($content)
    ];
}

function publishLyrmgrBlock($profile, $lyrmgrKey, $blockData, $editor) {
    $path = getConfigPath($profile);

    // Verzeichnis anlegen falls nötig
    $dir = dirname($path);
    if (!is_dir($dir)) {
        if (!@mkdir($dir, 0775, true)) {
            return ['published' => false, 'error' => 'Verzeichnis konnte nicht erstellt werden: ' . $dir];
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
        return ['published' => false, 'error' => 'Schreiben fehlgeschlagen: ' . $path . ' — ' . ($err ? $err['message'] : 'unbekannt')];
    }

    return [
        'published'  => true,
        'profile'    => $profile,
        'lyrmgrKey'  => $lyrmgrKey,
        'path'       => $path,
        'bytes'      => $bytes,
        'editor'     => $editor,
        'timestamp'  => date('Y-m-d H:i:s')
    ];
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
            'modified'   => date('Y-m-d H:i:s', filemtime($publicPath))
        ];
    }
    // Subdirectories
    $dirs = glob(CONFIG_BASE . '/*/lyrmgr.conf');
    foreach ($dirs as $f) {
        $dirName = basename(dirname($f));
        $data = json_decode(file_get_contents($f), true);
        $result[] = [
            'profile'    => $dirName,
            'path'       => $f,
            'lyrmgrKeys' => $data ? array_keys($data) : [],
            'size'       => filesize($f),
            'modified'   => date('Y-m-d H:i:s', filemtime($f))
        ];
    }
    return $result;
}

// =====================================================================
// AGS → MapPlus Roh-Konfiguration (ags2mapplus API)
// =====================================================================
define('AGS_API_BASE', 'https://www.gis-daten.ch/gapi/ags2mapplus');
define('RAW_CONF_DIR', '/data/Client_Data/nwow/tmp/raw-conf');
define('IMPORT_TO_CORE_DIR', '/data/Client_Data/nwow/tmp/ImportToCore');

/**
 * Verfügbare AGS-Dienste von der externen API abrufen
 */
function getAgsServices() {
    $url = AGS_API_BASE . '/get-ags-services';

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
 * Ermittelt den tatsächlich nutzbaren Pfad für raw-conf.
 * RAW_CONF_DIR liegt unter /data/Client_Data/nwow/tmp/raw-conf — dieses Verzeichnis
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
function exportAgsServices($dienstnamen) {
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
    $url = AGS_API_BASE . '/mapplus-conf-export';
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

        // Zielverzeichnis: raw-conf/<Unterordner>
        $targetPath = $rawConfDir . '/' . $entryName;
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
        'directory' => $rawConfDir,
        'timestamp' => date('Y-m-d H:i:s')
    ];
    // Teilfehler melden falls vorhanden
    if (count($failedFiles) > 0) {
        $result['failedFiles'] = $failedFiles;
        $result['warning'] = count($failedFiles) . ' Datei(en) konnten nicht gespeichert werden';
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
 *   layers_TNET_<SVC>.conf, lyrmgrResources_TNET_<SVC>.json,
 *   maptipsResources_TNET_<SVC>.json, maptips_TNET_<SVC>.conf,
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
        $isBackup = isRawConfBackupFile($file->getFilename());
        if ($backupOnly && !$isBackup) continue;
        if (!$includeBackups && $isBackup) continue;

        $relPath = str_replace($rawConfDir . '/', '', $file->getPathname());
        $relPath = str_replace('\\', '/', $relPath); // Windows-Pfade normalisieren

        // Service-Key ermitteln
        $parts = explode('/', $relPath);
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
        'directory' => $rawConfDir,
        'includeBackups' => (bool)$includeBackups,
        'backupOnly' => (bool)$backupOnly,
        'files'     => $files,
        'services'  => $servicesList
    ];
}

/**
 * Service-Name aus einem flachen Dateinamen extrahieren
 * Pattern: layers_TNET_<SVC>.conf, lyrmgrResources_TNET_<SVC>.json, etc.
 */
function extractServiceFromFilename($filename) {
    // layers_TNET_<SVC>.conf
    if (preg_match('/^layers_TNET_(.+)\.conf$/i', $filename, $m)) return $m[1];
    // lyrmgrResources_TNET_<SVC>.json
    if (preg_match('/^lyrmgrResources_TNET_(.+)\.json$/i', $filename, $m)) return $m[1];
    // maptipsResources_TNET_<SVC>.json
    if (preg_match('/^maptipsResources_TNET_(.+)\.json$/i', $filename, $m)) return $m[1];
    // legendResources_TNET_<SVC>.json
    if (preg_match('/^legendResources_TNET_(.+)\.json$/i', $filename, $m)) return $m[1];
    // maptips_TNET_<SVC>.conf
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
    $servicePath = $rawConfDir . '/' . $serviceKey;
    $realBase = realpath($rawConfDir);
    if (!$realBase) {
        return ['success' => false, 'error' => 'raw-conf Verzeichnis existiert nicht'];
    }

    $deleted = [];

    // Fall 1: Service-Key ist ein Verzeichnis (Unterordner-Struktur)
    $realPath = realpath($servicePath);
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
        $allFiles = @scandir($rawConfDir);
        if ($allFiles) {
            foreach ($allFiles as $f) {
                if ($f === '.' || $f === '..') continue;
                $filePath = $rawConfDir . '/' . $f;
                if (!is_file($filePath)) continue;
                // Prüfen ob Datei zu diesem Service gehört
                $fileSvc = extractServiceFromFilename($f);
                if ($fileSvc === $serviceKey) {
                    $deleted[] = $f;
                    @unlink($filePath);
                }
                // Auch Backups löschen
                if (isRawConfBackupFile($f)) {
                    $baseName = stripRawConfBackupSuffix($f);
                    $baseSvc = extractServiceFromFilename($baseName);
                    if ($baseSvc === $serviceKey) {
                        $deleted[] = $f;
                        @unlink($filePath);
                    }
                }
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
 * Gibt zurück: {hasChanges: bool, changed: [{service, files: [{file, reason, old*, new*}]}], missing: [service]}
 */
function checkSourceChanges($manifest, $rawDir) {
    $result = ['hasChanges' => false, 'changed' => [], 'missing' => []];
    if (!isset($manifest['sources']) || !is_array($manifest['sources'])) return $result;

    foreach ($manifest['sources'] as $src) {
        $svcKey = $src['service'];
        $svcDir = $rawDir . '/' . $svcKey;

        // Service existiert nicht mehr in raw-conf?
        if (!is_dir($svcDir)) {
            $result['missing'][] = $svcKey;
            $result['hasChanges'] = true;
            continue;
        }

        // Keine sourceFiles im Manifest → kann nicht vergleichen (altes Manifest-Format)
        if (!isset($src['sourceFiles']) || !is_array($src['sourceFiles'])) continue;

        $changedFiles = [];
        foreach ($src['sourceFiles'] as $sf) {
            // Datei im Service-Verzeichnis suchen (rekursiv, da Unterordner möglich)
            $found = findFileRecursive($svcDir, $sf['file']);
            if ($found === null) {
                $changedFiles[] = ['file' => $sf['file'], 'reason' => 'deleted'];
                continue;
            }
            $currentSize = filesize($found);
            $currentMod  = date('Y-m-d H:i:s', filemtime($found));
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

        // Neue Dateien prüfen (im Service-Verzeichnis aber nicht im Manifest)
        $manifestFileNames = array_column($src['sourceFiles'], 'file');
        $currentFiles = listConfFilesRecursive($svcDir);
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

/**
 * ImportToCore-Verzeichnis auflisten (nach Kürzel gruppiert)
 * Erkennt auch kürzelübergreifende Duplikate (gleicher Key im selben Prefix-Typ)
 */
function listImportToCore() {
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
            // Prefix extrahieren (z.B. "layers" aus "layers_ewn.conf")
            $underPos = strpos($f, '_');
            $prefix = ($underPos !== false) ? substr($f, 0, $underPos) : pathinfo($f, PATHINFO_FILENAME);
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

function stageServicesToImportToCore(array $serviceKeys, string $kuerzel, string $mode = 'replace') {
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

    foreach ($serviceKeys as $svcKey) {
        $svcDir = $rawDir . '/' . $svcKey;

        // Verzeichnis-basierte Struktur (group/service/ ODER service_dir/)
        if (is_dir($svcDir)) {
            $it = new RecursiveIteratorIterator(
                new RecursiveDirectoryIterator($svcDir, RecursiveDirectoryIterator::SKIP_DOTS),
                RecursiveIteratorIterator::LEAVES_ONLY
            );
            $svcFiles = iterator_to_array($it, false);
        } else {
            // Flache Struktur: Dateien im Root-Verzeichnis suchen die zum Service passen
            $svcFiles = [];
            $allEntries = @scandir($rawDir);
            if ($allEntries) {
                foreach ($allEntries as $entry) {
                    if ($entry === '.' || $entry === '..') continue;
                    $fullPath = $rawDir . '/' . $entry;
                    if (!is_file($fullPath)) continue;
                    if (extractServiceFromFilename($entry) === $svcKey) {
                        $svcFiles[] = new SplFileInfo($fullPath);
                    }
                }
            }
            if (empty($svcFiles)) { $errors[] = 'Dienst nicht gefunden: ' . $svcKey; continue; }
        }

        // Gefundene Dateien verarbeiten
        $it = new ArrayIterator($svcFiles);
        foreach ($it as $file) {
            $fname = $file->getFilename();
            if (preg_match('/\.\d{8}_\d{6}\.bak$/', $fname)) continue; // Backups überspringen
            if (preg_match('/\.xlsx$/i', $fname))             continue; // Excel-Dateien überspringen

            $ext = strtolower(pathinfo($fname, PATHINFO_EXTENSION));
            if (!in_array($ext, ['conf', 'json'])) continue; // nur Konfig-Dateien

            $content = @file_get_contents($file->getPathname());
            if ($content === false) { $errors[] = 'Lesefehler: ' . $file->getPathname(); continue; }

            $decoded = @json_decode($content, true);
            if ($decoded === null || !is_array($decoded)) {
                $errors[] = 'Kein gültiges JSON: ' . $fname;
                continue;
            }

            // Bucket-Key = Prefix vor dem ersten Unterstrich (z.B. "layers", "maptips", "lyrmgrResources", "maptipsResources")
            $underPos = strpos($fname, '_');
            $prefix = ($underPos !== false) ? substr($fname, 0, $underPos) : pathinfo($fname, PATHINFO_FILENAME);

            if (!isset($buckets[$prefix])) {
                $buckets[$prefix] = ['parts' => [], 'ext' => $ext];
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

        // Bei mode=merge: bestehende Output-Datei als Basis laden
        $outName  = $prefix . '_' . $kuerzel . '.' . $bucket['ext'];
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
        $srcFiles = [];
        $svcDir = $rawDir . '/' . $svcKey;
        if (is_dir($svcDir)) {
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
        }
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
            $underPos = strpos($fname, '_');
            $pfx = ($underPos !== false) ? substr($fname, 0, $underPos) : $fname;
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

        // Prefix extrahieren (layers, maptips, lyrmgrResources, maptipsResources)
        $underPos = strpos($f, '_');
        $prefix = ($underPos !== false) ? substr($f, 0, $underPos) : pathinfo($f, PATHINFO_FILENAME);

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
function configEditorSave($kuerzel, $fileName, $data) {
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
 *   layers_*.conf / maptips_*.conf    → $docRoot/maps/core/config/
 *   lyrmgrResources_*.json / maptipsResources_*.json → $docRoot/maps/core/nls/de/
 */
function configExportToCore($kuerzel) {
    global $docRoot;
    $safe = preg_replace('/[^a-zA-Z0-9_\-]/', '_', trim($kuerzel));
    if ($safe === '') return ['success' => false, 'error' => 'Kürzel darf nicht leer sein'];

    $srcDir = IMPORT_TO_CORE_DIR . '/' . $safe;
    if (!is_dir($srcDir)) return ['success' => false, 'error' => 'Quell-Ordner nicht gefunden'];

    $coreConfigDir = $docRoot . '/maps/core/config';
    $coreNlsDir    = $docRoot . '/maps/core/nls/de';

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
        $underPos = strpos($f, '_');
        $prefix = ($underPos !== false) ? substr($f, 0, $underPos) : '';

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
// Lock-Mechanismus
// =====================================================================
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
        $result = loadLyrmgrConf($profile);
        jsonResponse(['success' => true, 'data' => $result]);
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
        $result = exportAgsServices($body['dienstnamen']);
        if (!$result['success']) {
            jsonError($result['error'], 500);
        }
        jsonResponse(['success' => true, 'data' => $result]);
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
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        $body = json_decode(file_get_contents('php://input'), true);
        if (!$body || !isset($body['kuerzel'])) jsonError('Feld "kuerzel" (Array) erforderlich', 400);
        jsonResponse(['success' => true, 'data' => deleteImportToCoreKuerzel($body['kuerzel'])]);
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
        $result = stageServicesToImportToCore($body['services'], $body['kuerzel'], $mode);
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
        $result = configEditorSave($body['kuerzel'], $body['file'], $body['data']);
        if (!$result['success']) jsonError($result['error'], 400);
        jsonResponse(['success' => true, 'data' => $result]);
        break;

    case 'config-export-to-core':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        $body = json_decode(file_get_contents('php://input'), true);
        if (!$body || !isset($body['kuerzel'])) {
            jsonError('Feld "kuerzel" erforderlich', 400);
        }
        $result = configExportToCore($body['kuerzel']);
        if (!$result['success']) jsonError($result['error'], 500);
        jsonResponse(['success' => true, 'data' => $result]);
        break;

    case 'debug-rawconf':
        $info = [
            'RAW_CONF_DIR' => RAW_CONF_DIR,
            'exists' => is_dir(RAW_CONF_DIR),
            'writable' => is_writable(RAW_CONF_DIR),
            'realpath' => @realpath(RAW_CONF_DIR),
            'owner' => function_exists('posix_getpwuid') ? @posix_getpwuid(fileowner(RAW_CONF_DIR))['name'] : fileowner(RAW_CONF_DIR),
            'perms' => substr(sprintf('%o', fileperms(RAW_CONF_DIR)), -4),
            'php_user' => function_exists('posix_getpwuid') ? posix_getpwuid(posix_geteuid())['name'] : get_current_user(),
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

    default:
        jsonResponse([
            'success' => true,
            'data' => [
                'name'    => 'Tree-Builder Persistence API',
                'version' => '3.1',
                'actions' => ['load', 'save', 'lock', 'unlock', 'lock-status', 'history', 'restore', 'save-groups', 'load-groups', 'save-profile', 'load-profile', 'list-profiles', 'load-lyrmgr', 'publish-lyrmgr', 'list-lyrmgr-profiles', 'ags-services', 'ags-export', 'ags-list-raw', 'ags-delete-raw', 'ags-delete-backups', 'ags-read-raw', 'ags-write-raw', 'staging-layers-flat', 'config-editor-load', 'config-editor-save', 'config-export-to-core'],
                'storage' => DATA_DIR
            ]
        ]);
}
