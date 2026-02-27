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
define('RAW_CONF_DIR', '/data/Client_Data/nwow/raw-conf');

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
 * RAW_CONF_DIR liegt unter /data/Client_Data/nwow/tmp/ — dieses Verzeichnis
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
        if (count($parts) >= 2) {
            // Datei in Unterordner: erster Pfad-Teil als Service
            $svcKey = $parts[0] . '/' . $parts[1];
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

        if (count($parts) >= 2) {
            $svcKey = $parts[0] . '/' . $parts[1];
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
                'actions' => ['load', 'save', 'lock', 'unlock', 'lock-status', 'history', 'restore', 'save-groups', 'load-groups', 'save-profile', 'load-profile', 'list-profiles', 'load-lyrmgr', 'publish-lyrmgr', 'list-lyrmgr-profiles', 'ags-services', 'ags-export', 'ags-list-raw', 'ags-delete-raw', 'ags-read-raw'],
                'storage' => DATA_DIR
            ]
        ]);
}
