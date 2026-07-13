<?php
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * agsproxy.php — ArcGIS REST Reverse-Proxy mit Token-Management
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * ÜBERSICHT
 * ---------
 * Reverse-Proxy für ArcGIS REST Services mit automatischem Token-Management,
 * Layer-Aggregation (Sliding Window), Zugriffskontrolle und Print-Session-Tracking.
 *
 * ARCHITEKTUR
 * -----------
 *   Browser ──► agsproxy.php ──► ArcGIS REST Services
 *                  │
 *                  ├── Token-Cache (Datei-basiert, TTL + Safety-Skew)
 *                  ├── Layer-Aggregation (Sliding Window, 80ms Standard)
 *                  ├── Zugriffskontrolle (Referer-Whitelist + Cookie-Token)
 *                  ├── Print-Session-Tracking (Session-basiert, async Timer)
 *                  └── JSON-Transformation (Datum, Feldfilter)
 *
 * HAUPTFUNKTIONEN
 * ---------------
 * 1. TOKEN-MANAGEMENT
 *    - Automatisches Caching (Datei-basiert) mit konfigurierbarer TTL
 *    - Safety-Skew (Standard 60s) verhindert Token-Ablauf während Request
 *    - Retry bei Invalid Token (HTTP 498)
 *    - Credentials via ENV-Variablen oder Fallback-Defaults
 *
 * 2. LAYER-AGGREGATION (Sliding Window)
 *    - Kombiniert gleichzeitige Requests mit identischen Parametern (ausser LAYERS)
 *    - Window: 80ms initial + 5ms Extension pro Request
 *    - Erster Request wird Executor, sammelt alle Layer-IDs
 *    - Folge-Requests erhalten transparentes 1×1 PNG (HTTP 200)
 *    - Druck-Requests (DPI ≥ 100) werden NICHT aggregiert (sequentielle Verarbeitung)
 *
 * 3. ZUGRIFFSKONTROLLE
 *    - Ein/Aus via $accessControlEnabled (Standard: false)
 *    - Stufe 1: Referer gegen Whitelist-Patterns prüfen
 *    - Stufe 2: Cookie 'mapplus_token' vorhanden + Token-Datei existiert
 *    - Stufe 3: Token nicht abgelaufen
 *    - Logging: info (Zusammenfassung), debug (vollständige Details)
 *
 * 4. PRINT-SESSION-TRACKING
 *    - Erkennt Druck-Requests anhand DPI-Schwellwert (≥ 100)
 *    - Aggregiert Metriken pro Druckvorgang (Requests, Zeit, Grösse, Layers)
 *    - Async Timer finalisiert Session nach Inaktivitäts-Timeout
 *    - Debug-Modus: Vergleichs-Request mit aggregierten Layers
 *
 * 5. DATENVERARBEITUNG
 *    - Datumsfeld-Konvertierung: Millisekunden → dd.mm.yyyy (hh:mm:ss)
 *    - Feld-Filter: Entfernt shape.starea, shape.stlength, etc.
 *    - Auto-Parameter: distance=1.0, units=esriSRUnit_Meter
 *
 * 6. ROUTING & WHITELIST
 *    - Erlaubte Pfade: /services/*, /directories/arcgisoutput/*
 *    - Auto-Prefix: Bare Pfade werden zu services/<path>
 *    - Embedded Query-Parameter werden extrahiert und zusammengeführt
 *
 * CLI-MODUS
 * ---------
 * Das Script kann auch als CLI-Prozess gestartet werden:
 *   php agsproxy.php --print-timer <sessionFile> <pathKey> <timeoutMs> <logFile> <logLevel>
 *
 * Dies wird intern von startPrintSessionTimer() verwendet, um Print-Sessions
 * asynchron nach Ablauf des Timeouts zu finalisieren.
 *
 * VORAUSSETZUNGEN
 * ---------------
 * - PHP 7.4+ mit cURL Extension
 * - Schreibrechte: /data/Client_Data/nwow/tmp/maps-dev/ (Logs, Aggregation, Print-Sessions)
 * - Optional: Schreibrechte für Token-Cache-Verzeichnis (_token_cache/)
 *
 * DATEISTRUKTUR
 * -------------
 * Abschnitt 1:  Globale Konfiguration (alle Parameter an einer Stelle)
 * Abschnitt 2:  Logging-Funktion (writeLog)
 * Abschnitt 3:  Zugriffskontrolle (Funktion + Ausführung)
 * Abschnitt 4:  CLI-Modus (Print-Timer, wird vor Web-Modus geprüft)
 * Abschnitt 5:  Hauptprogramm (Web-Request-Verarbeitung)
 * Abschnitt 6:  Hilfsfunktionen (Pfad, Response, JSON-Transformation)
 * Abschnitt 7:  Token-Management (Cache, Fetch, Retry)
 * Abschnitt 8:  Request-Bau & cURL-Weiterleitung
 * Abschnitt 9:  Aggregation (Sliding Window, Logging)
 * Abschnitt 10: Print-Modul (Session-Tracking, Timer, Finalisierung)
 */


// ═══════════════════════════════════════════════════════════════════════════════
// ABSCHNITT 1: GLOBALE KONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════
// Alle konfigurierbaren Parameter. ENV-Variablen haben Vorrang vor Defaults.
// ═══════════════════════════════════════════════════════════════════════════════

// --- 1.1 Zugriffskontrolle ------------------------------------------------
// Schaltet die 3-stufige Zugriffsprüfung ein/aus.
// Bei true: Referer-Whitelist → Token-Cookie → Token-Ablauf
$accessControlEnabled = false;

// Verzeichnis für Token-Dateien (mapplus_token_<hash>)
$accessControlTokenDir = '/data/Client_Data/nwow/tmp/maps-dev/token/';

// Erlaubte Referer-Muster (reguläre Ausdrücke, case-insensitive)
$accessControlAllowedPatterns = [
    '/^https:\/\/dev\.geohost\.ch\//i',
    '/^https:\/\/geohost\.ch\//i',
    '/^https:\/\/gis-daten\.ch\/maps/i',
    '/^https:\/\/www\.gis-daten\.ch\//i',
    '/^https:\/\/dev\.gis-daten\.ch\//i',
    '/nwow\.mapplus\.ch\//i',
    // weitere Patterns nach Bedarf
];

// --- 1.2 Logging -----------------------------------------------------------
// Log-Datei (absoluter Pfad auf dem Server)
$agsProxyLogFile = '/data/Client_Data/nwow/tmp/maps-dev/agsProxy.log';

// Access-Log: Protokolliert JEDEN Request (wie Apache access.log)
// Leer lassen ('') um Access-Log zu deaktivieren.
$agsProxyAccessLog = '/data/Client_Data/nwow/tmp/maps-dev/agsProxy_access.log';

// Access-Log-Level: 'info' | 'debug'
//   info:   Kompakt — IP, Method, Path, HTTP-Status, Zeit, Grösse
//   debug:  Vollständig — zusätzlich Referer, User-Agent, Query-Params, Content-Type, Cookies, Host
$agsProxyAccessLogLevel = 'error';

// Log-Level: 'error' | 'warning' | 'info' | 'debug'
//   error:   Nur schwerwiegende Fehler (Token, cURL failures)
//   warning: + Warnungen (unerwartete Responses)
//   info:    + Zugriffskontrolle (Blocked/Allowed), Print-Sessions, Aggregation
//   debug:   + Vollständige Request-Details, Timer-Schritte, Compare-PNGs
$agsProxyLogLevel = 'error';

// --- 1.3 Backend (ArcGIS Server) ------------------------------------------
// Alle Werte können via ENV-Variablen überschrieben werden.
// In Produktion: Credentials IMMER via ENV setzen!
$tokenUrl           = getenv('GIS_TOKEN_URL')   ?: "https://www.gis-daten.ch/svc/tokens/";
$baseRoot           = getenv('GIS_REST_ROOT')   ?: "https://www.gis-daten.ch/svc/rest/";
$username           = getenv('GIS_TOKEN_USER')  ?: "mapplus-imp";
$password           = getenv('GIS_TOKEN_PASS')  ?: "mapplus-imp6370";
$client             = getenv('GIS_CLIENT')      ?: "requestip";
$referer            = getenv('GIS_REFERER')     ?: "";
$expirationMin      = intval(getenv('GIS_TOKEN_MIN')  ?: 60);
$safetySkewSec      = intval(getenv('GIS_TOKEN_SKEW') ?: 120);
$sslVerifyPeer      = (getenv('GIS_SSL_VERIFY') === "0") ? false : true;
$retryOn498         = (getenv('GIS_RETRY_498')  === "0") ? false : true;
$autoPrefixServices = (getenv('GIS_AUTOPREFIX') === "0") ? false : true;

// --- 1.4 Token-Cache -------------------------------------------------------
// Verzeichnis und Datei für das dateibasierte Token-Caching.
//
// WICHTIG: Der Cache liegt bewusst an einem GEMEINSAMEN Pfad ausserhalb des
// Docroots, damit ALLE Proxy-Instanzen mit denselben Credentials (z.B. `maps`
// und `maps-dev`) EIN Token teilen. Der ArcGIS-Token-Service hält pro User nur
// ein aktives Token – ohne gemeinsamen Cache entwertet die Token-Erneuerung
// einer Instanz das Token der anderen (sporadische 498 Invalid Token).
// Der Dateiname enthält einen Hash aus User+Token-URL: gleiche Credentials
// teilen sich Cache+Lock, unterschiedliche Credentials werden getrennt.
$cacheDirEnv = getenv('GIS_PROXY_CACHE_DIR');
$cacheDir    = $cacheDirEnv ? rtrim($cacheDirEnv, DIRECTORY_SEPARATOR) : '/data/Client_Data/nwow/tmp/token_shared';
$cacheFile   = $cacheDir . DIRECTORY_SEPARATOR . 'arcgis_token_' . md5($username . '|' . $tokenUrl) . '.json';

// --- 1.5 Layer-Aggregation -------------------------------------------------
// Kombiniert gleichzeitige Requests zu einem einzigen Backend-Call.
// Nur für Nicht-Druck-Requests (DPI < aggregationPrintDpiThreshold).
$aggregationEnabled           = false;    // Aggregation aktivieren/deaktivieren
$aggregationWindowMs          = 80;      // Initiales Sliding Window in Millisekunden
$aggregationWindowExtensionMs = 5;       // Verlängerung pro eingehender Request (ms)
$aggregationTempDir           = '/data/Client_Data/nwow/tmp/maps-dev/';
$aggregationSavePng           = false;   // PNG-Responses in Datei speichern
$aggregationPngDir            = '/data/Client_Data/nwow/tmp/maps-dev/aggregation_png/';

// --- 1.6 Druck-Session -----------------------------------------------------
// Tracking aller Requests eines Druckvorgangs (erkennt anhand DPI).
// Timer-Prozess finalisiert Session nach Inaktivitäts-Timeout.
$aggregationPrintSessionFile      = '/data/Client_Data/nwow/tmp/maps-dev/print_session.json';
$aggregationPrintSessionTimeoutMs = 2000;  // Wartezeit nach letztem Request bevor DONE (ms)
$aggregationPrintSessionExpireMs  = 5000;  // Session-Ablauf ohne neuen Request (ms)
$aggregationPrintDpiThreshold     = 100;   // Ab dieser DPI gilt als Druck-Request

// --- 1.7 Abgeleitete Konstanten -------------------------------------------
// Transparentes 1×1 PNG (RGBA) — wird als Response für aggregierte Zwischen-Requests verwendet
$emptyPng = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQIW2NgAAIAAAUAAR4f7BQAAAAASUVORK5CYII=');

// --- 1.8 Tile-Response-Cache ----------------------------------------------
// Cacht Kachel-Responses (export?F=image) datei-basiert. Kacheln sind statisch:
// gleicher BBOX + SIZE + LAYERS + DPI ergibt immer dasselbe Bild. Damit werden
// wiederholte Anfragen (Pan/Zoom zurück, mehrere Nutzer) ohne Backend-Call
// bedient. Nur GET-Export-Bilder bis zur konfigurierten Kantenlänge werden
// gecacht; Druck-Requests (hohe DPI) sind ausgenommen.
// Cache-Verzeichnis liegt ausserhalb des Docroots (analog Token-Cache) und
// wird ueber ALLE Instanzen (maps, maps-dev, geohost, edit) geteilt.
$tileCacheEnabled  = (getenv('GIS_TILE_CACHE') === '0') ? false : true;
$tileCacheDir      = getenv('GIS_TILE_CACHE_DIR') ?: '/data/Client_Data/nwow/tmp/tile_cache';
$tileCacheTtlSec   = intval(getenv('GIS_TILE_CACHE_TTL')   ?: 3600);   // Cache-Lebensdauer
$tileCacheMaxPx    = intval(getenv('GIS_TILE_CACHE_MAXPX') ?: 512);    // max Kachel-Kantenlaenge
$tileCachePrintDpi = 100;   // Requests ab dieser DPI (Druck) werden nicht gecacht
// Leere/fast-transparente Kacheln (voll transparentes PNG) sind sehr klein und
// werden NICHT gecacht — sonst würden "Löcher" dauerhaft festgehalten.
$tileCacheMinBytes = intval(getenv('GIS_TILE_CACHE_MINBYTES') ?: 700);



// ═══════════════════════════════════════════════════════════════════════════════
// ABSCHNITT 2: LOGGING-FUNKTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Schreibt einen Log-Eintrag mit Zeitstempel und Level-Filter.
 *
 * Format: [2026-02-11 10:30:15.123] INFO    | Nachricht
 *
 * @param string $logFile         Absoluter Pfad zur Log-Datei
 * @param string $level           Level des Eintrags: error|warning|info|debug
 * @param string $message         Log-Nachricht (kann mehrzeilig sein)
 * @param string $configuredLevel Mindest-Level für Ausgabe (Default: error)
 */
function writeLog(string $logFile, string $level, string $message, string $configuredLevel = 'error'): void {
    $levels = ['error' => 0, 'warning' => 1, 'info' => 2, 'debug' => 3];
    $levelNum = $levels[strtolower($level)] ?? 3;
    $configNum = $levels[strtolower($configuredLevel)] ?? 0;
    
    if ($levelNum > $configNum) return;
    
    $timestamp = '[' . date('Y-m-d H:i:s.') . substr((string)microtime(), 2, 3) . '] ';
    $paddedLevel = str_pad(strtoupper($level), 7);
    $entry = $timestamp . $paddedLevel . ' | ' . $message . "\n";
    @file_put_contents($logFile, $entry, FILE_APPEND | LOCK_EX);
}


// ═══════════════════════════════════════════════════════════════════════════════
// ABSCHNITT 3: ZUGRIFFSKONTROLLE
// ═══════════════════════════════════════════════════════════════════════════════
// Prüft eingehende Web-Requests in 3 Stufen:
//   Stufe 1: Referer gegen Whitelist-Patterns
//   Stufe 2: Cookie 'mapplus_token' vorhanden + Token-Datei existiert
//   Stufe 3: Token-Datei nicht abgelaufen (Timestamp-Prüfung)
// Bei Blockierung: HTTP 403 + JSON-Error + Logging (info = Summary, debug = Details)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Führt die 3-stufige Zugriffskontrolle durch.
 * Beendet das Script mit HTTP 403 bei Zugriffsverweigerung.
 *
 * @param bool   $enabled         Zugriffskontrolle ein/aus
 * @param array  $allowedPatterns Erlaubte Referer-Patterns (Regex)
 * @param string $tokenDir        Verzeichnis für Token-Dateien
 * @param string $logFile         Log-Datei
 * @param string $logLevel        Konfiguriertes Log-Level
 */
function checkAccessControl(
    bool $enabled,
    array $allowedPatterns,
    string $tokenDir,
    string $logFile,
    string $logLevel
): void {
    if (!$enabled) {
        return; // Zugriffskontrolle deaktiviert
    }
    
    // Client-Infos sammeln
    $clientIp = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? '-';
    if (strpos($clientIp, ',') !== false) {
        $clientIp = trim(explode(',', $clientIp)[0]);
    }
    $requestReferer = $_SERVER['HTTP_REFERER'] ?? '';
    $requestUri = $_SERVER['REQUEST_URI'] ?? '-';
    $userAgent = $_SERVER['HTTP_USER_AGENT'] ?? '-';
    $host = $_SERVER['HTTP_HOST'] ?? '-';
    $method = $_SERVER['REQUEST_METHOD'] ?? '-';
    
    // Zusammenfassung für info-Level
    $accessSummary = 'IP: ' . $clientIp . ' | Method: ' . $method . ' | URI: ' . $requestUri . ' | Referer: ' . ($requestReferer ?: '(leer)');
    
    // Detail-Infos für debug-Level
    $accessDetails = $accessSummary 
        . ' | Host: ' . $host 
        . ' | UA: ' . substr($userAgent, 0, 150)
        . ' | Cookie: ' . (isset($_COOKIE['mapplus_token']) ? substr($_COOKIE['mapplus_token'], 0, 16) . '...' : '(kein)')
        . ' | Accept: ' . ($_SERVER['HTTP_ACCEPT'] ?? '-')
        . ' | Origin: ' . ($_SERVER['HTTP_ORIGIN'] ?? '-');
    
    // Stufe 1: Referer-Check
    $refererAllowed = false;
    if ($requestReferer !== '') {
        foreach ($allowedPatterns as $pattern) {
            if (preg_match($pattern, $requestReferer)) {
                $refererAllowed = true;
                break;
            }
        }
    }
    
    if (!$refererAllowed) {
        writeLog($logFile, 'info', 'ACCESS_DENIED | Referer nicht erlaubt | ' . $accessSummary, $logLevel);
        writeLog($logFile, 'debug', 'ACCESS_DENIED_DETAIL | ' . $accessDetails, $logLevel);
        http_response_code(403);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => 'Access forbidden.'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    
    // Stufe 2: Token-Cookie prüfen
    $cookieToken = $_COOKIE['mapplus_token'] ?? null;
    $tokenFile = rtrim($tokenDir, '/') . '/mapplus_token_' . $cookieToken;
    
    if (!$cookieToken || !file_exists($tokenFile)) {
        $reason = !$cookieToken ? 'Kein Token-Cookie' : 'Token-Datei nicht gefunden';
        writeLog($logFile, 'info', 'ACCESS_DENIED | ' . $reason . ' | ' . $accessSummary, $logLevel);
        writeLog($logFile, 'debug', 'ACCESS_DENIED_DETAIL | ' . $reason . ' | Token: ' . ($cookieToken ?: '(null)') . ' | File: ' . $tokenFile . ' | ' . $accessDetails, $logLevel);
        http_response_code(403);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => 'Access only allowed with valid token.'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    
    // Stufe 3: Token-Ablauf prüfen
    $expires = (int)@file_get_contents($tokenFile);
    if ($expires < time()) {
        @unlink($tokenFile);
        writeLog($logFile, 'info', 'ACCESS_DENIED | Token abgelaufen (expired: ' . date('Y-m-d H:i:s', $expires) . ') | ' . $accessSummary, $logLevel);
        writeLog($logFile, 'debug', 'ACCESS_DENIED_DETAIL | Token expired | ' . $accessDetails, $logLevel);
        http_response_code(403);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => 'Token expired.'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    
    // Zugriff erlaubt
    writeLog($logFile, 'debug', 'ACCESS_OK | ' . $accessDetails, $logLevel);
}

// --- Zugriffskontrolle ausführen (nur im Web-Modus, nicht bei CLI --print-timer) ---
if (php_sapi_name() !== 'cli') {
    checkAccessControl(
        $accessControlEnabled,
        $accessControlAllowedPatterns,
        $accessControlTokenDir,
        $agsProxyLogFile,
        $agsProxyLogLevel
    );
}


// ═══════════════════════════════════════════════════════════════════════════════
// ABSCHNITT 4: CLI-MODUS (Print-Timer)
// ═══════════════════════════════════════════════════════════════════════════════
// Wird von startPrintSessionTimer() als separater PHP-Prozess aufgerufen:
//   php agsproxy.php --print-timer <sessionFile> <pathKey> <timeoutMs> <logFile> <logLevel>
//
// Ablauf:
//   1. Wartet den Timeout ab (sleep)
//   2. Prüft ob Session inaktiv (letzter Request > Timeout her)
//   3. Wenn ja: PRINT_DONE loggen + optionaler Debug-Vergleichs-Request
//   4. Session-Datei löschen
//
// Verwendet globale Backend-Credentials ($baseRoot, $tokenUrl, etc.) aus Abschnitt 1.
// ═══════════════════════════════════════════════════════════════════════════════

if (isset($argv[1]) && $argv[1] === '--print-timer') {
    if ($argc < 7) exit(1);
    
    $sessionFile = $argv[2];
    $pathKey = $argv[3];
    $timeoutMs = (int)$argv[4];
    $logFile = $argv[5];
    $logLevel = $argv[6] ?? 'error';
    
    sleep(ceil($timeoutMs / 1000));
    
    writeLog($logFile, 'debug', 'TIMER | Aufgewacht nach ' . $timeoutMs . 'ms, prüfe Session: ' . basename($sessionFile), $logLevel);
    
    if (!file_exists($sessionFile)) {
        writeLog($logFile, 'debug', 'TIMER | Session-Datei bereits gelöscht: ' . basename($sessionFile), $logLevel);
        exit(0);
    }
    
    $fp = fopen($sessionFile, 'r+');
    if (!$fp) exit(1);
    if (!flock($fp, LOCK_EX)) { fclose($fp); exit(1); }
    
    $session = json_decode(fread($fp, filesize($sessionFile)), true);
    if (!$session) { flock($fp, LOCK_UN); fclose($fp); exit(1); }
    
    $nowMs = microtime(true) * 1000;
    $inactiveMs = $nowMs - $session['last_req_end_ms'];
    
    writeLog($logFile, 'debug', 'TIMER | Inaktiv für ' . round($inactiveMs) . 'ms (Schwellwert: ' . $timeoutMs . 'ms)', $logLevel);
    
    if ($inactiveMs >= $timeoutMs) {
        $path = $session['path'] ?? $pathKey;
        $sessionId = $session['session_id'] ?? 'unknown';
        $count = $session['count'] ?? 0;
        $totalTime = $session['total_time_ms'] ?? 0;
        $totalSize = $session['total_size'] ?? 0;
        $layers = isset($session['layers']) && is_array($session['layers']) ? implode(',', $session['layers']) : '-';
        
        if ($totalSize >= 1048576) { $sizeStr = sprintf('%.2f MB', $totalSize / 1048576); }
        elseif ($totalSize >= 1024) { $sizeStr = sprintf('%.2f KB', $totalSize / 1024); }
        else { $sizeStr = $totalSize . ' B'; }
        
        $gapMs = round($inactiveMs);
        
        $doneMsg = 'PRINT_DONE | SessionID: ' . $sessionId . 
                    ' | Path: ' . $path . ' | Layers: ' . $layers . 
                    ' | Requests: ' . $count . ' | TotalTime: ' . $totalTime . 'ms' . 
                    ' | TotalSize: ' . $sizeStr . ' | Gap: ' . $gapMs . 'ms';
        
        writeLog($logFile, 'info', $doneMsg, $logLevel);
        
        // Debug: Vergleichs-Request mit aggregierten Layers (nur bei debug-Level)
        if ($logLevel === 'debug' && $layers !== '-' && isset($session['layers']) && count($session['layers']) > 1) {
            writeLog($logFile, 'debug', 'DEBUG_CMP1 | Starte Vergleich für ' . count($session['layers']) . ' Layer', $logLevel);
            
            $layerIds = $session['layers'];
            sort($layerIds, SORT_NUMERIC);
            $aggregatedLayers = 'show:' . implode(',', $layerIds);
            
            writeLog($logFile, 'debug', 'DEBUG_PATH | Pfad: ' . $path, $logLevel);
            
            $questionPos = strpos($path, '?');
            if ($questionPos !== false) {
                $servicePath = substr($path, 0, $questionPos);
                $queryString = substr($path, $questionPos + 1);
                
                writeLog($logFile, 'debug', 'DEBUG_CMP2 | Service: ' . $servicePath, $logLevel);
                
                $queryParts = explode('&', $queryString);
                $params = [];
                foreach ($queryParts as $part) {
                    if (strpos($part, '=') !== false) {
                        list($key, $value) = explode('=', $part, 2);
                        $params[$key] = urldecode($value);
                    }
                }
                
                writeLog($logFile, 'debug', 'DEBUG_PARAMS | ' . json_encode($params), $logLevel);
                
                if (isset($params['LAYERS'])) {
                    $params['LAYERS'] = $aggregatedLayers;
                } else {
                    $params['layers'] = $aggregatedLayers;
                }
                
                $params['f'] = 'image';
                
                // Verwende globale Backend-Credentials aus Abschnitt 1
                writeLog($logFile, 'debug', 'DEBUG_CMP3 | Hole Token...', $logLevel);
                
                $tokenParams = http_build_query([
                    'username' => $username,
                    'password' => $password,
                    'client' => 'requestip',
                    'f' => 'json',
                    'expiration' => 60
                ]);
                
                $chToken = curl_init($tokenUrl);
                curl_setopt_array($chToken, [
                    CURLOPT_POST => true,
                    CURLOPT_POSTFIELDS => $tokenParams,
                    CURLOPT_RETURNTRANSFER => true,
                    CURLOPT_SSL_VERIFYPEER => false,
                    CURLOPT_TIMEOUT => 10
                ]);
                $tokenData = curl_exec($chToken);
                $tokenError = curl_error($chToken);
                curl_close($chToken);
                
                if ($tokenData === false) {
                    writeLog($logFile, 'error', 'DEBUG_CMP_ERR | Token fehlgeschlagen: ' . $tokenError, $logLevel);
                } else {
                    writeLog($logFile, 'debug', 'DEBUG_TOKEN | Antwort: ' . substr($tokenData, 0, 200), $logLevel);
                }
                
                if ($tokenData) {
                    $tokenJson = json_decode($tokenData, true);
                    if (isset($tokenJson['token'])) {
                        writeLog($logFile, 'debug', 'DEBUG_CMP4 | Token empfangen, sende Request...', $logLevel);
                        
                        $token = $tokenJson['token'];
                        
                        $targetUrl = rtrim($baseRoot, '/') . '/' . $servicePath;
                        $method = 'GET';
                        $rawInput = '';
                        $contentType = '';
                        
                        list($forwardUrl, $forwardBody, $forwardHeaders) =
                            buildForwardRequest($targetUrl, $params, $rawInput, $contentType, $token, $method);
                        
                        list($httpCode, $respHeaders, $response, $aggregatedTimeMs) = 
                            curlForward($forwardUrl, $method, $forwardBody, $forwardHeaders, false);
                        
                        if ($response !== false) {
                            $aggregatedSize = strlen($response);
                            if ($aggregatedSize >= 1048576) { $aggSizeStr = sprintf('%.2f MB', $aggregatedSize / 1048576); }
                            elseif ($aggregatedSize >= 1024) { $aggSizeStr = sprintf('%.2f KB', $aggregatedSize / 1024); }
                            else { $aggSizeStr = $aggregatedSize . ' B'; }
                            
                            $savings = $totalTime - $aggregatedTimeMs;
                            $savingsPercent = $totalTime > 0 ? round(($savings / $totalTime) * 100, 1) : 0;
                            
                            // PNG nur bei debug-Level speichern (vermeidet Datei-Ansammlung)
                            $pngInfo = '-';
                            if ($logLevel === 'debug') {
                                $pngPath = dirname($logFile) . '/print_aggregated_' . $sessionId . '.png';
                                @file_put_contents($pngPath, $response);
                                $pngInfo = basename($pngPath);
                            }
                            
                            $compareMsg = 'PRINT_CMP | SessionID: ' . $sessionId . 
                                          ' | AggregatedTime: ' . $aggregatedTimeMs . 'ms' . 
                                          ' | TotalTime: ' . $totalTime . 'ms' . 
                                          ' | Savings: ' . $savings . 'ms (' . $savingsPercent . '%)' . 
                                          ' | AggSize: ' . $aggSizeStr . 
                                          ' | HTTP: ' . $httpCode . 
                                          ' | PNG: ' . $pngInfo;
                            
                            writeLog($logFile, 'info', $compareMsg, $logLevel);
                        }
                    } else {
                        writeLog($logFile, 'error', 'DEBUG_CMP_ERR | No token in response', $logLevel);
                    }
                }
            } else {
                writeLog($logFile, 'error', 'DEBUG_CMP_ERR | Path regex failed: ' . $path, $logLevel);
            }
        }
        
        writeLog($logFile, 'debug', 'TIMER | Deleting session file: ' . basename($sessionFile), $logLevel);
        flock($fp, LOCK_UN); fclose($fp); @unlink($sessionFile);
    } else {
        writeLog($logFile, 'debug', 'TIMER | Session noch aktiv, finalisiere nicht', $logLevel);
        flock($fp, LOCK_UN); fclose($fp);
    }
    exit(0);
}


// ═══════════════════════════════════════════════════════════════════════════════
// ABSCHNITT 5: HAUPTPROGRAMM (Web-Request-Verarbeitung)
// ═══════════════════════════════════════════════════════════════════════════════
// Ablauf: Headers → Pfad → Whitelist → Aggregation → Token → Forward → Response
// ═══════════════════════════════════════════════════════════════════════════════

header("Access-Control-Allow-Origin: *");
header("X-Content-Type-Options: nosniff");

// --- Pfad & Parameter lesen ---
$servicePath = isset($_GET['path']) ? ltrim(trim($_GET['path']), '/') : '';

// PATH_INFO Support: ESRI JS API (MapImageLayer) hängt Subpfade wie /export, /identify,
// /layers, /legend etc. direkt an die PHP-URL statt an den path-Parameter.
// Beispiel: agsproxy.php/export?path=services/xxx/MapServer&f=image
// → PATH_INFO = "/export", path = "services/xxx/MapServer"
// → Ergebnis: servicePath = "services/xxx/MapServer/export"
$pathInfo = isset($_SERVER['PATH_INFO']) ? trim($_SERVER['PATH_INFO'], ' /') : '';
if ($pathInfo !== '') {
    if ($servicePath !== '') {
        // path-Parameter + PATH_INFO kombinieren
        $servicePath = rtrim($servicePath, '/') . '/' . $pathInfo;
    } else {
        // Nur PATH_INFO: enthält den gesamten Pfad (z.B. agsproxy.php/gis_oereb/service/MapServer)
        $servicePath = $pathInfo;
    }
}

if ($servicePath === '') {
    respondJson(400, ["error" => "Pfad fehlt (Parameter 'path')."]);
}

// Manche Clients senden path mit eingebetteten Query-Parametern (z.B. "export?F=image")
$embeddedParams = [];
if (strpos($servicePath, '?') !== false) {
    list($servicePath, $embeddedQuery) = explode('?', $servicePath, 2);
    parse_str($embeddedQuery, $embeddedParams);
}

// Bare-Pfade automatisch als services/* interpretieren
if ($autoPrefixServices && !preg_match('#^(services/|directories/arcgisoutput/)#i', $servicePath)) {
    $servicePath = 'services/' . $servicePath;
}
// Whitelist erzwingen
if (!isAllowedPath($servicePath)) {
    respondJson(403, ["error" => "Pfad nicht erlaubt.", "path" => $servicePath]);
}

// Query-Parameter (GET) ohne 'path' übernehmen, embedded params haben Vorrang
$queryParams = $_GET;
unset($queryParams['path']);
$queryParams = array_merge($embeddedParams, $queryParams);

// Auto-Parameter für Identify/Query — nur als Default setzen, NICHT überschreiben.
// queryconnector() sendet eigene distance (= viewResolution * tolerance), z.B. 200m.
// Wenn wir hier immer 1.0 erzwingen, werden fast keine Features gefunden.
if (!isset($queryParams['distance'])) {
    $queryParams['distance'] = 1.0;
}
if (!isset($queryParams['units'])) {
    $queryParams['units'] = 'esriSRUnit_Meter';
}

// POST-Body einlesen
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$rawInput = file_get_contents('php://input');
$contentType = strtolower($_SERVER['CONTENT_TYPE'] ?? '');

// --- Aggregation Logic (Sliding Window) ---
if ($aggregationEnabled) {
    // DPI bestimmen (für Print-Erkennung)
    $requestDpi = 0;
    if (isset($queryParams['DPI'])) {
        $requestDpi = (int)$queryParams['DPI'];
    } elseif (isset($queryParams['dpi'])) {
        $requestDpi = (int)$queryParams['dpi'];
    } elseif (isset($queryParams['MAP_RESOLUTION'])) {
        $requestDpi = (int)$queryParams['MAP_RESOLUTION'];
    }
    
    $isPrintRequest = ($requestDpi >= $aggregationPrintDpiThreshold);
    
    // Print-Requests: Keine Aggregation (App sendet sequentiell und wartet auf Antwort)
    if ($isPrintRequest) {
        $printLayers = $queryParams['LAYERS'] ?? $queryParams['layers'] ?? '-';
        if (preg_match('/^show:(.+)$/i', $printLayers, $matches)) {
            $printLayers = $matches[1];
        }
        $printRequestId = substr(uniqid('', true), -8);
        $printClientIp = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? '-';
        if (strpos($printClientIp, ',') !== false) {
            $printClientIp = explode(',', $printClientIp)[0];
        }
        $printDpi = $requestDpi;
        $printStartTime = microtime(true);
        
        $aggregationResult = ['action' => 'forward_single', 'params' => $queryParams, 'debug' => 'print-bypass', 'is_print' => true];
    } else {
        $effectiveWindowMs = $aggregationWindowMs;
        $effectiveExtensionMs = $aggregationWindowExtensionMs;
        
        $aggregationResult = handleAggregation(
            $servicePath, 
            $queryParams, 
            $effectiveWindowMs,
            $effectiveExtensionMs,
            $aggregationTempDir,
            $emptyPng,
            $agsProxyLogFile,
            $aggregationSavePng,
            $aggregationPngDir,
            false
        );
    }
    
    if ($aggregationResult['action'] === 'respond_204') {
        // Zwischen-Request: 200 + leeres PNG (204 unterstützt keinen Body)
        header('Content-Type: image/png');
        header('Content-Length: ' . strlen($emptyPng));
        header('X-Aggregation-Status: queued');
        header('X-Aggregation-Layers: ' . ($aggregationResult['debug'] ?? ''));
        http_response_code(200);
        echo $emptyPng;
        exit;
    } elseif ($aggregationResult['action'] === 'forward_aggregated') {
        $queryParams = $aggregationResult['params'];
        header('X-Aggregation-Status: forwarded');
        header('X-Aggregation-Layers: ' . ($aggregationResult['debug'] ?? ''));
    } else {
        header('X-Aggregation-Status: single');
    }
}

// --- Tile-Cache-Lookup (vor Token/Backend) ---
// Cachebare Kachel-Requests werden ohne Backend-Call bedient, wenn ein
// frischer Cache-Eintrag existiert. Spart Token-Handling und cURL komplett.
$tileCacheable = $tileCacheEnabled
    && isTileCacheable($method, $servicePath, $queryParams, $tileCacheMaxPx, $tileCachePrintDpi);
$tileCacheKey  = $tileCacheable ? tileCacheKey($servicePath, $queryParams) : '';
if ($tileCacheable) {
    $cachedTile = tileCacheGet($tileCacheDir, $tileCacheKey, $tileCacheTtlSec);
    if ($cachedTile !== null) {
        header('Content-Type: ' . $cachedTile['ct']);
        header('Content-Length: ' . strlen($cachedTile['body']));
        header('X-Tile-Cache: HIT');
        header('Cache-Control: public, max-age=' . $tileCacheTtlSec);
        http_response_code(200);
        echo $cachedTile['body'];
        exit;
    }
}

// --- Token aus Cache oder neu holen ---
$tok = getToken($tokenUrl, $username, $password, $client, $referer, $expirationMin, $safetySkewSec, $sslVerifyPeer, $cacheDir, $cacheFile);
if (!$tok || empty($tok['token'])) {
    respondJson(500, ["error" => "Token konnte nicht erstellt/geladen werden."]);
}
$token = $tok['token'];

// --- Ziel-URL zusammensetzen ---
$targetUrl = rtrim($baseRoot, '/') . '/' . $servicePath;

list($forwardUrl, $forwardBody, $forwardHeaders) =
    buildForwardRequest($targetUrl, $queryParams, $rawInput, $contentType, $token, $method);

// --- Anfrage ausführen ---
$printRequestStartMs = microtime(true) * 1000;
list($status, $respHeaders, $respBody, $backendResponseTimeMs) = curlForward($forwardUrl, $method, $forwardBody, $forwardHeaders, $sslVerifyPeer);
$printRequestEndMs = microtime(true) * 1000;
$backendResponseSize = strlen($respBody);

// Log Backend Response für aggregierte Requests
if ($aggregationEnabled && isset($aggregationResult['action']) && $aggregationResult['action'] === 'forward_aggregated' && $agsProxyLogFile) {
    $requestId = $aggregationResult['request_id'] ?? '';
    logAggregationResponse($agsProxyLogFile, $servicePath, $requestId, $status, $backendResponseTimeMs, $backendResponseSize);
}

// --- Print-Session-Tracking ---
$sessionFileForPath = null;
$sessionPathKey = null;
if ($aggregationEnabled && isset($aggregationResult['is_print']) && $aggregationResult['is_print'] && $agsProxyLogFile) {
    if ($backendResponseSize >= 1048576) {
        $sizeStr = sprintf('%.2f MB', $backendResponseSize / 1048576);
    } elseif ($backendResponseSize >= 1024) {
        $sizeStr = sprintf('%.1f KB', $backendResponseSize / 1024);
    } else {
        $sizeStr = $backendResponseSize . ' B';
    }
    
    $nowMs = $printRequestEndMs;
    $mySeq = 0;
    $isFirstRequest = false;
    $printSessionId = null;

    if ($aggregationPrintSessionFile) {
        $sessionParams = $queryParams;
        unset($sessionParams['LAYERS'], $sessionParams['layers']);
        ksort($sessionParams);
        $pathKey = $servicePath . '?' . http_build_query($sessionParams);
        $pathHash = md5($pathKey);
        $sessionFileForPath = dirname($aggregationPrintSessionFile) . '/print_session_' . $pathHash . '.json';
        $sessionPathKey = $pathKey;
        
        $fp = @fopen($sessionFileForPath, 'c+');
        if ($fp && flock($fp, LOCK_EX)) {
            $content = stream_get_contents($fp);
            $session = $content ? json_decode($content, true) : null;
            
            $sessionExpired = false;
            if ($session && isset($session['last_req_end_ms'])) {
                $ageMs = $printRequestStartMs - $session['last_req_end_ms'];
                $sessionExpired = ($ageMs > $aggregationPrintSessionExpireMs);
            }
            
            if (!$session || !isset($session['path']) || $session['path'] !== $pathKey || $sessionExpired) {
                $newSessionId = date('Ymd_His') . '_' . substr(uniqid('', true), -6);
                $session = createPrintSession($pathKey, $printDpi, $printClientIp, $newSessionId);
                $isFirstRequest = true;
            } else {
                if (!isset($session['session_id'])) {
                    $session['session_id'] = date('Ymd_His') . '_' . substr(uniqid('', true), -6);
                }
            }
            
            if ($session['count'] == 0) {
                $isFirstRequest = true;
            }
            
            // Summiere Request in die Session
            $session['count']++;
            $session['total_time_ms'] += $backendResponseTimeMs;
            $session['total_size'] += $backendResponseSize;
            $session['last_time_ms'] = $printRequestEndMs;
            $session['last_req_end_ms'] = $printRequestEndMs;
            $session['dpi'] = $printDpi;
            $session['client'] = $printClientIp;
            $printSessionId = $session['session_id'];
            
            if (!isset($session['layers'])) {
                $session['layers'] = [];
            }
            if ($printLayers !== '-' && !in_array($printLayers, $session['layers'])) {
                $session['layers'][] = $printLayers;
            }
            
            ftruncate($fp, 0);
            rewind($fp);
            fwrite($fp, json_encode($session));
            flock($fp, LOCK_UN);
            fclose($fp);
            
            $sessionFileForPath = dirname($aggregationPrintSessionFile) . '/print_session_' . $pathHash . '.json';
            $sessionPathKey = $pathKey;
        }
    }
    
    $logAction = $isFirstRequest ? 'PRINT_START' : 'PRINT_PASS';
    $logMessage = $logAction . ' | SessionID: ' . $printSessionId . ' | Path: ' . $servicePath . ' | Layers: ' . $printLayers . ' | DPI: ' . $printDpi . ' | HTTP: ' . $status . ' | Time: ' . $backendResponseTimeMs . 'ms | Size: ' . $sizeStr . ' | Client: ' . $printClientIp;
    writeLog($agsProxyLogFile, 'info', $logMessage, $agsProxyLogLevel);
}

// --- Optional: PNG speichern (wenn Aggregation aktiv war) ---
if ($aggregationEnabled && isset($aggregationResult['save_png']) && $aggregationResult['save_png']) {
    $isPng = isset($respHeaders['content-type']) && strpos($respHeaders['content-type'], 'image/png') !== false;
    $pngDir = $aggregationResult['png_dir'] ?? '';
    
    if ($isPng && $pngDir) {
        if (!is_dir($pngDir)) {
            @mkdir($pngDir, 0755, true);
        }
        if (is_dir($pngDir)) {
            $timestamp = date('Y-m-d_H-i-s');
            $requestId = $aggregationResult['request_id'] ?? uniqid();
            $filename = $pngDir . DIRECTORY_SEPARATOR . $timestamp . '_' . substr($requestId, -8) . '.png';
            $written = @file_put_contents($filename, $respBody);
            
            if ($agsProxyLogFile) {
                $status = $written !== false ? "saved to $filename" : "FAILED to save to $filename";
                writeLog($agsProxyLogFile, 'info', 'PNG_SAVE   | ' . $status, $agsProxyLogLevel);
            }
        }
    }
}

// --- Retry bei 498 (Invalid Token) ---
// Prüft, ob eine Antwort ein Invalid-Token-Fehler ist (HTTP 498 oder
// HTTP 200 mit ArcGIS-Fehlercode 498 im JSON-Body).
$is498 = function ($status, $respBody) {
    if (intval($status) === 498) return true;
    if (intval($status) === 200) {
        $maybe = json_decode($respBody, true);
        if (is_array($maybe) && isset($maybe['error']['code']) && intval($maybe['error']['code']) === 498) {
            return true;
        }
    }
    return false;
};

if ($retryOn498 && $is498($status, $respBody)) {
    // Genau EINE koordinierte Token-Erneuerung (Compare-and-Set). Danach
    // geduldige Retries: ein frisch generiertes Token kann auf einzelnen
    // Backend-Knoten kurz noch nicht gültig sein (Propagation). Wir generieren
    // NICHT wiederholt (das erzeugte Token-Churn), sondern warten mit Backoff
    // und übernehmen ein evtl. von anderer Seite rotiertes Token aus dem Cache.
    $badToken = $token;
    $tok = refreshTokenSingleFlight($badToken, $tokenUrl, $username, $password, $client, $referer, $expirationMin, $safetySkewSec, $sslVerifyPeer, $cacheDir, $cacheFile);
    $refreshed = false;
    if ($tok && !empty($tok['token'])) {
        $refreshed = ($tok['token'] !== $badToken);
        $token = $tok['token'];
    }
    $maxRetries = 6;
    for ($attempt = 1; $attempt <= $maxRetries; $attempt++) {
        // Ein FRISCH generiertes Token ist auf einzelnen Backend-Knoten kurz
        // noch nicht aktiv (Propagation). Vor dem ersten Retry kurz warten.
        if ($attempt === 1 && $refreshed) {
            usleep(150000); // 150ms Propagations-Fenster
        }
        list($forwardUrl, $forwardBody, $forwardHeaders) =
            buildForwardRequest($targetUrl, $queryParams, $rawInput, $contentType, $token, $method);
        list($status, $respHeaders, $respBody, $backendResponseTimeMs) =
            curlForward($forwardUrl, $method, $forwardBody, $forwardHeaders, $sslVerifyPeer);
        if (!$is498($status, $respBody)) {
            break;
        }
        // Backoff (gedeckelt), dann evtl. neueres Token aus dem Cache übernehmen
        // (falls ein anderer Worker/eine andere Instanz rotiert hat) – aber
        // selbst KEIN neues Token generieren.
        usleep(min(250000 * $attempt, 1000000)); // 250ms..1000ms
        $cur = fileCacheReadRaw($cacheFile);
        if ($cur && !empty($cur['token']) && $cur['token'] !== $token) {
            $token = $cur['token'];
        }
    }
}

// --- JSON-Transformation (Datumsfelder, Feldfilter) ---
if (isset($respHeaders['content-type']) && strpos($respHeaders['content-type'], 'application/json') !== false) {
    $json = json_decode($respBody, true);
    if (is_array($json)) {
        $json = filterFields($json);
        $json = convertDateFields($json);
       //$json = injectHtmlFormatting($json);
       // $json = smartBeautifyFieldNames($json);
        $respBody = json_encode($json, JSON_UNESCAPED_UNICODE);
        $respHeaders['content-length'] = strlen($respBody);
    }
}

// --- Tile-Cache-Write (nach 498-Retry, auf finaler Response) ---
// Erst hier steht die endgültige Backend-Antwort fest (der 498-Retry ersetzt
// eine anfängliche Invalid-Token-Antwort durch das echte Bild). Nur
// erfolgreiche Bild-Responses werden gecacht; leere/fast-transparente Kacheln
// (unter Mindestgrösse) werden übersprungen, damit keine Lücken entstehen.
if ($tileCacheable && intval($status) === 200) {
    $respCt = strtolower($respHeaders['content-type'] ?? '');
    $finalSize = strlen($respBody);
    if (strpos($respCt, 'image/') === 0 && $finalSize >= $tileCacheMinBytes) {
        tileCachePut($tileCacheDir, $tileCacheKey, $respHeaders['content-type'], $respBody);
        header('X-Tile-Cache: MISS');
        tileCacheGc($tileCacheDir, $tileCacheTtlSec);
    } else {
        header('X-Tile-Cache: SKIP');
    }
}

// --- Response an Client weiterreichen ---
forwardResponse($status, $respHeaders, $respBody);

// --- Access-Log schreiben (Level konfigurierbar via $agsProxyAccessLogLevel) ---
if (!empty($agsProxyAccessLog)) {
    $accessIp = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? '-';
    if (strpos($accessIp, ',') !== false) {
        $accessIp = trim(explode(',', $accessIp)[0]);
    }
    $accessMethod = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $accessSize = strlen($respBody);
    if ($accessSize >= 1048576) { $accessSizeStr = sprintf('%.2f MB', $accessSize / 1048576); }
    elseif ($accessSize >= 1024) { $accessSizeStr = sprintf('%.1f KB', $accessSize / 1024); }
    else { $accessSizeStr = $accessSize . ' B'; }
    
    // info: Kompakter Eintrag — nur Request-Essenz
    $accessEntry = '[' . date('Y-m-d H:i:s') . '] '
        . str_pad($accessIp, 15) . ' | '
        . str_pad($accessMethod, 4) . ' | '
        . $servicePath . ' | '
        . 'HTTP ' . $status . ' | '
        . $backendResponseTimeMs . 'ms | '
        . $accessSizeStr;
    
    // debug: Erweitert um Referer, UA, Query-Params, Content-Type, Cookies, Host
    if ($agsProxyAccessLogLevel === 'debug') {
        $accessReferer = $_SERVER['HTTP_REFERER'] ?? '-';
        $accessUA = $_SERVER['HTTP_USER_AGENT'] ?? '-';
        $accessHost = $_SERVER['HTTP_HOST'] ?? '-';
        $accessContentType = $respHeaders['content-type'] ?? '-';
        $accessQueryStr = $_SERVER['QUERY_STRING'] ?? '-';
        $accessCookies = $_SERVER['HTTP_COOKIE'] ?? '-';
        $accessOrigin = $_SERVER['HTTP_ORIGIN'] ?? '-';
        
        $accessEntry .= ' | Ref: ' . $accessReferer
            . ' | UA: ' . substr($accessUA, 0, 120)
            . ' | Host: ' . $accessHost
            . ' | CT: ' . $accessContentType
            . ' | Query: ' . substr($accessQueryStr, 0, 200)
            . ' | Cookie: ' . substr($accessCookies, 0, 80)
            . ' | Origin: ' . $accessOrigin;
    }
    
    $accessEntry .= "\n";
    @file_put_contents($agsProxyAccessLog, $accessEntry, FILE_APPEND | LOCK_EX);
}

// --- Async Timer für Print-Session-Finalisierung starten ---
if ($aggregationEnabled && isset($aggregationResult['is_print']) && $aggregationResult['is_print'] && isset($sessionFileForPath) && isset($sessionPathKey)) {
    writeLog($agsProxyLogFile, 'debug', 'TIMER_START | Starting timer for session: ' . basename($sessionFileForPath) . ' (timeout: ' . $aggregationPrintSessionTimeoutMs . 'ms)', $agsProxyLogLevel);
    
    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
    }
    
    startPrintSessionTimer(
        $sessionFileForPath,
        $sessionPathKey,
        $aggregationPrintSessionTimeoutMs,
        $agsProxyLogFile,
        __FILE__,
        $agsProxyLogLevel
    );
}

exit;


// ═══════════════════════════════════════════════════════════════════════════════
// ABSCHNITT 6: HILFSFUNKTIONEN
// ═══════════════════════════════════════════════════════════════════════════════
// Pfad-Prüfung, JSON-Response, Feld-Transformation
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Prüft ob ein Service-Pfad in der Whitelist ist.
 * Erlaubt: services/* und directories/arcgisoutput/*
 */
function isAllowedPath(string $path): bool {
    if (stripos($path, 'services/') === 0) return true;
    if (stripos($path, 'directories/arcgisoutput/') === 0) return true;
    return false;
}

/**
 * Sendet eine JSON-Fehlerantwort und beendet das Script.
 */
function respondJson(int $code, array $payload): void {
    http_response_code($code);
    header("Content-Type: application/json; charset=utf-8");
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * Filtert technische/unerwünschte Felder aus JSON-Responses.
 * Entfernt: shape.starea*, shape.stlength*, *ident*, *objxxect*
 */
function filterFields($arr) {
    $removePatterns = [
        'shape.starea*',
        'shape.stlength*',
        '*ident*',
        '*objxxect*'
    ];
    foreach ($arr as $key => $value) {
        $matched = false;
        foreach ($removePatterns as $pattern) {
            if (fnmatch($pattern, strtolower($key), FNM_CASEFOLD)) {
                $matched = true;
                break;
            }
        }
        if ($matched) {
            unset($arr[$key]);
        } elseif (is_array($value)) {
            $arr[$key] = filterFields($value);
        }
    }
    return $arr;
}

/**
 * Konvertiert Millisekunden-Timestamps in lesbare Datumsformate.
 * Erkennung: numerischer Wert > 1'000'000'000'000 (≈ 2001)
 * Format: dd.mm.yyyy oder dd.mm.yyyy HH:mm:ss (wenn Zeit ≠ 00:00:00)
 */
function convertDateFields($arr) {
    foreach ($arr as $key => $value) {
        if (
            is_numeric($value) &&
            $value > 1000000000000
        ) {
            $timestamp = $value / 1000;
            $year = (int)date('Y', $timestamp);
            if ($year >= 1800 && $year <= 2100) {
                $time = date('H:i:s', $timestamp);
                if ($time === '00:00:00') {
                    $arr[$key] = date('d.m.Y', $timestamp);
                } else {
                    $arr[$key] = date('d.m.Y H:i:s', $timestamp);
                }
            }
        } elseif (is_array($value)) {
            $arr[$key] = convertDateFields($value);
        }
    }
    return $arr;
}

/**
 * Injiziert HTML-Formatierung basierend auf Feldnamen (experimentell, deaktiviert).
 */
function injectHtmlFormatting($arr) {
    $formatRules = [
        'Nummer' => function($value) { return '<strong>' . htmlspecialchars($value) . '</strong>'; },
        'OBJECTID' => function($value) { 
            return '<span style="background-color: lightblue; color: red; font-weight: bold; font-size: 1.2em; display: inline-block; padding: 5px 10px; width: 100%; box-sizing: border-box;">' . 
                   htmlspecialchars($value) . 
                   '<br><iframe src="https://www.gis-daten.ch" style="width: 100%; height: 300px; border: 1px solid #ccc; margin-top: 5px;"></iframe></span>'; 
        },
        'objectid' => function($value) { 
            return '<span style="background-color: lightblue; color: red; font-weight: bold; font-size: 1.2em; display: inline-block; padding: 5px 10px; width: 100%; box-sizing: border-box;">' . 
                   htmlspecialchars($value) . 
                   '<br><iframe src="https://www.gis-daten.ch" style="width: 100%; height: 300px; border: 1px solid #ccc; margin-top: 5px;"></iframe></span>'; 
        },
    ];
    
    foreach ($arr as $key => $value) {
        if (is_array($value)) {
            $arr[$key] = injectHtmlFormatting($value);
        } else {
            foreach ($formatRules as $fieldPattern => $formatter) {
                if (stripos($key, $fieldPattern) !== false) {
                    $arr[$key] = $formatter($value);
                    break;
                }
            }
        }
    }
    return $arr;
}

/**
 * Verschönert einen einzelnen Feldnamen (experimentell, deaktiviert).
 */
function smartBeautifyFieldName($key) {
    $key = preg_replace('/^()/i', '', $key);

    $replace = [
        'OBJECTID' => '<span style="background-color: blue; color: red; font-weight: bold; display: inline-block; padding: 5px 10px; width: 100%; box-sizing: border-box;">OBJECTID</span>',
        'Abkuerzung' => 'Abkürzung',
        'Bemerkungen' => 'Bemerkungen',
        'Nr' => 'Nummer',
        'Kt' => 'Kanton',
        'Gde' => 'Gemeinde',
        'RRB' => 'Regierungsratsbeschluss',
        'KRB' => 'Kantonsratsbeschluss',
        'BFSNr' => 'BFS-Nummer',
        'SDE' => 'SDE',
        'PubliziertAb' => 'Publiziert ab',
        'Rechtsstatus' => 'Rechtsstatus',
        'Auftragsnummer' => 'Auftragsnummer',
        'Auftragsbeschreibung' => 'Auftragsbeschreibung',
        'Auftragsdatum' => 'Auftragsdatum',
        'Zustaendigkeit' => 'Zuständigkeit',
        'Darstellungscode' => 'Darstellungscode',
        'Schlusskontr' => 'Schlusskontrolle',
        'Bem_Allgemein' => 'Allgemeine Bemerkungen',
        'TextImWeb' => 'Text im Web',
        'OffiziellerTitel' => 'Offizieller Titel',
        'OffizielleNr' => 'Offizielle Nummer',
        'Upload' => 'Upload',
        'Checksum' => 'Prüfsumme',
    ];
    foreach ($replace as $search => $replaceWith) {
        $key = str_ireplace($search, $replaceWith, $key);
    }

    $key = str_replace(['_', '.'], ' ', $key);
    $key = preg_replace('/\s+/', ' ', $key);
    $key = ucwords(strtolower($key));
    $key = trim($key);

    return $key;
}

/**
 * Verschönert alle Feldnamen rekursiv (experimentell, deaktiviert).
 */
function smartBeautifyFieldNames($arr) {
    $result = [];
    foreach ($arr as $key => $value) {
        $newKey = smartBeautifyFieldName($key);
        if (is_array($value)) {
            $result[$newKey] = smartBeautifyFieldNames($value);
        } else {
            $result[$newKey] = $value;
        }
    }
    return $result;
}


// ═══════════════════════════════════════════════════════════════════════════════
// ABSCHNITT 7: TOKEN-MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════
// Datei-basierter Token-Cache mit TTL und Safety-Skew.
// Token wird bei Bedarf automatisch erneuert.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Token aus Datei-Cache lesen oder neu holen.
 *
 * Single-Flight: Bei parallelen Requests (z.B. viele Kacheln beim Nachladen)
 * erneuert nur EIN Worker das Token. Alle anderen warten kurz auf den
 * exklusiven Lock und lesen danach das frische Token aus dem Cache. So wird
 * der "Thundering Herd" verhindert, der sonst viele Tokens gleichzeitig
 * generiert und dadurch sporadische 498-Fehler (Invalid Token) auslöst.
 *
 * @return array|null  ['token' => string, 'expires' => int] oder null bei Fehler
 */
function getToken($tokenUrl, $user, $pass, $client, $referer, $expirationMin, $skewSec, $sslVerifyPeer, $cacheDir, $cacheFile) {
    // 1. Schneller Pfad: gültiges Token direkt aus dem Cache.
    $fileTok = fileCacheRead($cacheFile, $skewSec);
    if ($fileTok) {
        return $fileTok;
    }

    // 2. Single-Flight: Refresh über exklusiven Lock serialisieren.
    ensureCacheDir($cacheDir);
    $lockFile = $cacheFile . '.lock';
    $lockFp = @fopen($lockFile, 'c');
    if ($lockFp === false) {
        // Kein Lock möglich → Fallback ohne Serialisierung.
        return fetchAndCacheToken($tokenUrl, $user, $pass, $client, $referer, $expirationMin, $skewSec, $sslVerifyPeer, $cacheDir, $cacheFile);
    }

    if (flock($lockFp, LOCK_EX)) {
        // Lock erhalten: nochmals prüfen – evtl. hat ein anderer Worker das
        // Token in der Zwischenzeit bereits erneuert (Double-Checked Locking).
        $fileTok = fileCacheRead($cacheFile, $skewSec);
        if ($fileTok) {
            flock($lockFp, LOCK_UN);
            fclose($lockFp);
            return $fileTok;
        }
        $tok = fetchAndCacheToken($tokenUrl, $user, $pass, $client, $referer, $expirationMin, $skewSec, $sslVerifyPeer, $cacheDir, $cacheFile);
        flock($lockFp, LOCK_UN);
        fclose($lockFp);
        return $tok;
    }

    // Konnte den Lock nicht erhalten → kurz warten und Cache erneut lesen.
    fclose($lockFp);
    $fileTok = fileCacheRead($cacheFile, $skewSec);
    if ($fileTok) {
        return $fileTok;
    }
    return fetchAndCacheToken($tokenUrl, $user, $pass, $client, $referer, $expirationMin, $skewSec, $sslVerifyPeer, $cacheDir, $cacheFile);
}

/**
 * Token nach einem 498 (Invalid Token) erneuern – Single-Flight mit
 * Compare-and-Set. Verhindert den Token-Herd im Retry: Wenn ein anderer
 * Worker in der Zwischenzeit bereits ein NEUES Token (≠ dem soeben
 * fehlgeschlagenen) in den Cache geschrieben hat, wird dieses ohne erneute
 * Generierung übernommen. Nur wenn im Cache weiterhin das schlechte Token
 * (oder keines) liegt, wird genau EIN neues Token generiert.
 *
 * @param string $badToken  Das Token, das gerade den 498 verursacht hat.
 * @return array|null  ['token' => string, 'expires' => int] oder null.
 */
function refreshTokenSingleFlight($badToken, $tokenUrl, $user, $pass, $client, $referer, $expirationMin, $skewSec, $sslVerifyPeer, $cacheDir, $cacheFile) {
    ensureCacheDir($cacheDir);
    $lockFile = $cacheFile . '.lock';
    $lockFp = @fopen($lockFile, 'c');
    if ($lockFp === false) {
        return fetchAndCacheToken($tokenUrl, $user, $pass, $client, $referer, $expirationMin, $skewSec, $sslVerifyPeer, $cacheDir, $cacheFile);
    }

    if (!flock($lockFp, LOCK_EX)) {
        fclose($lockFp);
        // Kein Lock → kurz warten, dann evtl. frisches Token aus dem Cache.
        usleep(50000);
        $cur = fileCacheReadRaw($cacheFile);
        if ($cur && !empty($cur['token']) && $cur['token'] !== $badToken) {
            return $cur;
        }
        return fetchAndCacheToken($tokenUrl, $user, $pass, $client, $referer, $expirationMin, $skewSec, $sslVerifyPeer, $cacheDir, $cacheFile);
    }

    // Unter Lock: Hat bereits jemand auf ein anderes Token gewechselt?
    $cur = fileCacheReadRaw($cacheFile);
    if ($cur && !empty($cur['token']) && $cur['token'] !== $badToken) {
        flock($lockFp, LOCK_UN);
        fclose($lockFp);
        return $cur;
    }

    // Weiterhin das schlechte (oder kein) Token → genau EINMAL neu generieren.
    $tok = fetchAndCacheToken($tokenUrl, $user, $pass, $client, $referer, $expirationMin, $skewSec, $sslVerifyPeer, $cacheDir, $cacheFile);
    flock($lockFp, LOCK_UN);
    fclose($lockFp);
    return $tok;
}

/**
 * Token via cURL POST vom ArcGIS Token-Service holen und in Datei-Cache schreiben.
 */
function fetchAndCacheToken($tokenUrl, $user, $pass, $client, $referer, $expirationMin, $skewSec, $sslVerifyPeer, $cacheDir, $cacheFile) {
    $post = [
        'username' => $user,
        'password' => $pass,
        'client' => $client,
        'f' => 'json',
        'expiration' => $expirationMin
    ];
    if ($client === 'referer' && $referer !== '') {
        $post['referer'] = $referer;
    }
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $tokenUrl,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => http_build_query($post),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => $sslVerifyPeer,
        CURLOPT_SSL_VERIFYHOST => $sslVerifyPeer ? 2 : 0,
        CURLOPT_HTTPHEADER => ['Accept: application/json']
    ]);
    $resp = curl_exec($ch);
    $err = curl_error($ch);
    curl_close($ch);
    if ($resp === false) {
        error_log("Token-Request fehlgeschlagen: $err");
        return null;
    }
    $data = @json_decode($resp, true);
    if (!is_array($data) || empty($data['token'])) {
        error_log("Token-Response unerwartet: " . $resp);
        return null;
    }
    $nowMs = (int) floor(microtime(true) * 1000);
    $expires = isset($data['expires']) ? (int)$data['expires'] : ($nowMs + $expirationMin * 60 * 1000);
    ensureCacheDir($cacheDir);
    fileCacheWrite($cacheFile, $data['token'], $expires);
    return ['token' => $data['token'], 'expires' => $expires];
}

/** Cache-Verzeichnis anlegen (mit .htaccess-Schutz) */
function ensureCacheDir(string $dir): void {
    if (!is_dir($dir)) {
        @mkdir($dir, 0700, true);
        $ht = $dir . DIRECTORY_SEPARATOR . ".htaccess";
        if (!file_exists($ht)) {
            @file_put_contents($ht, "Require all denied\nDeny from all\n");
        }
    }
}

/** Token aus Datei-Cache lesen (mit Safety-Skew-Prüfung) */
function fileCacheRead(string $file, int $skewSec) {
    if (!is_file($file)) return null;
    $fp = @fopen($file, 'r');
    if (!$fp) return null;
    $out = null;
    if (flock($fp, LOCK_SH)) {
        $json = stream_get_contents($fp);
        flock($fp, LOCK_UN);
        $data = @json_decode($json, true);
        if (is_array($data) && isset($data['token'], $data['expires'])) {
            $nowMs = (int) floor(microtime(true) * 1000);
            $skewMs = $skewSec * 1000;
            if (($data['expires'] - $skewMs) > $nowMs) {
                $out = ['token' => $data['token'], 'expires' => (int)$data['expires']];
            }
        }
    }
    fclose($fp);
    return $out;
}

/**
 * Token aus Datei-Cache lesen OHNE Ablauf-/Skew-Prüfung.
 * Nur für Compare-and-Set im Retry: liefert das aktuell gespeicherte Token,
 * damit erkannt werden kann, ob ein anderer Worker bereits rotiert hat.
 */
function fileCacheReadRaw(string $file) {
    if (!is_file($file)) return null;
    $fp = @fopen($file, 'r');
    if (!$fp) return null;
    $out = null;
    if (flock($fp, LOCK_SH)) {
        $json = stream_get_contents($fp);
        flock($fp, LOCK_UN);
        $data = @json_decode($json, true);
        if (is_array($data) && isset($data['token'], $data['expires'])) {
            $out = ['token' => $data['token'], 'expires' => (int)$data['expires']];
        }
    }
    fclose($fp);
    return $out;
}

/** Token in Datei-Cache schreiben (mit exklusivem Lock) */
function fileCacheWrite(string $file, string $token, int $expires): void {
    $payload = json_encode(['token' => $token, 'expires' => $expires], JSON_UNESCAPED_SLASHES);
    $fp = @fopen($file, 'c+');
    if ($fp && flock($fp, LOCK_EX)) {
        ftruncate($fp, 0);
        fwrite($fp, $payload);
        fflush($fp);
        flock($fp, LOCK_UN);
        fclose($fp);
        @chmod($file, 0600);
    } else {
        if ($fp) fclose($fp);
    }
}

/** Token-Cache-Datei löschen */
function fileCacheDelete(string $file): void {
    if (is_file($file)) @unlink($file);
}


// ═══════════════════════════════════════════════════════════════════════════════
// ABSCHNITT 7b: TILE-RESPONSE-CACHE
// ═══════════════════════════════════════════════════════════════════════════════
// Datei-basierter Cache für Kachel-Bilder (export?F=image). Kacheln sind statisch:
// gleiche Parameter → gleiches Bild. Cache-Key = Hash über servicePath + relevante
// Query-Parameter (BBOX, SIZE, LAYERS, DPI, FORMAT, ...). Token/Zeitstempel werden
// bewusst NICHT in den Key aufgenommen.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Prüft ob ein Request kachelbar/cachebar ist:
 *  - GET-Methode
 *  - export-Endpunkt mit Bild-Ausgabe (F/f = image)
 *  - BBOX und SIZE vorhanden, Kantenlänge ≤ Maximum
 *  - kein Druck-Request (DPI < Schwelle)
 */
function isTileCacheable(string $method, string $servicePath, array $params, int $maxPx, int $printDpi): bool {
    if (strtoupper($method) !== 'GET') return false;
    if (!preg_match('#/export$#i', $servicePath)) return false;

    // Format: F oder f muss 'image' sein (Bild-Ausgabe)
    $fmt = strtolower((string)($params['F'] ?? $params['f'] ?? ''));
    if ($fmt !== 'image') return false;

    // BBOX erforderlich
    $bbox = $params['BBOX'] ?? $params['bbox'] ?? '';
    if ($bbox === '') return false;

    // SIZE erforderlich + Kantenlänge begrenzen
    $size = $params['SIZE'] ?? $params['size'] ?? '';
    if ($size === '' || strpos($size, ',') === false) return false;
    list($w, $h) = array_map('intval', explode(',', $size, 2));
    if ($w <= 0 || $h <= 0 || $w > $maxPx || $h > $maxPx) return false;

    // Druck-Requests (hohe DPI) nicht cachen
    $dpi = (int)($params['DPI'] ?? $params['dpi'] ?? $params['MAP_RESOLUTION'] ?? 0);
    if ($dpi >= $printDpi) return false;

    return true;
}

/** Cache-Key aus servicePath + cache-relevanten Parametern bilden. */
function tileCacheKey(string $servicePath, array $params): string {
    // Nur render-relevante Parameter berücksichtigen (Token/Callback ignorieren).
    $relevant = [
        'BBOX', 'bbox', 'SIZE', 'size', 'LAYERS', 'layers', 'DPI', 'dpi',
        'FORMAT', 'format', 'TRANSPARENT', 'transparent', 'BBOXSR', 'bboxSR',
        'IMAGESR', 'imageSR', 'DYNAMICLAYERS', 'dynamicLayers', 'LAYERDEFS',
        'layerDefs', 'TIME', 'time', 'MAP_RESOLUTION',
    ];
    $keyParts = ['path=' . $servicePath];
    foreach ($relevant as $k) {
        if (isset($params[$k]) && $params[$k] !== '') {
            $keyParts[] = strtolower($k) . '=' . (string)$params[$k];
        }
    }
    return hash('sha256', implode('|', $keyParts));
}

/**
 * Liest eine gecachte Kachel. Gibt ['ct' => contentType, 'body' => bytes] oder null.
 * TTL-Prüfung anhand Datei-mtime. Content-Type wird aus den Magic-Bytes des
 * Bildes abgeleitet (kein separates Meta-File nötig → weniger I/O).
 */
function tileCacheGet(string $dir, string $key, int $ttlSec): ?array {
    $dataFile = $dir . DIRECTORY_SEPARATOR . $key . '.bin';
    if (!is_file($dataFile)) return null;

    $mtime = @filemtime($dataFile);
    if ($mtime === false || (time() - $mtime) > $ttlSec) return null;

    $body = @file_get_contents($dataFile);
    if ($body === false || $body === '') return null;

    // Content-Type aus Magic-Bytes (PNG/JPEG/GIF), Default PNG
    $ct = 'image/png';
    if (strncmp($body, "\xFF\xD8\xFF", 3) === 0)      $ct = 'image/jpeg';
    elseif (strncmp($body, "GIF8", 4) === 0)          $ct = 'image/gif';
    return ['ct' => $ct, 'body' => $body];
}

/** Schreibt eine Kachel atomar in den Cache (nur .bin, kein Meta-File). */
function tileCachePut(string $dir, string $key, string $contentType, string $body): void {
    if (!is_dir($dir)) {
        if (!@mkdir($dir, 0775, true) && !is_dir($dir)) return;
    }
    if (!is_writable($dir)) return;

    $dataFile = $dir . DIRECTORY_SEPARATOR . $key . '.bin';
    $tmpData  = $dataFile . '.' . getmypid() . '.tmp';
    if (@file_put_contents($tmpData, $body, LOCK_EX) !== false) {
        @rename($tmpData, $dataFile);
        @chmod($dataFile, 0644);
    }
}

/**
 * Probabilistische Garbage-Collection: löscht abgelaufene Kachel-Dateien.
 * Läuft inline mit geringer Wahrscheinlichkeit (kein Cron nötig) und ist pro
 * Lauf gedeckelt, damit kein Request spürbar blockiert. Räumt auch veraltete
 * .json-Meta-Files aus früheren Versionen ab.
 */
function tileCacheGc(string $dir, int $ttlSec, int $probabilityPercent = 2): void {
    if ($probabilityPercent <= 0) return;
    if (mt_rand(1, 100) > $probabilityPercent) return;
    if (!is_dir($dir)) return;

    $now = time();
    $maxDelete = 500;   // Obergrenze pro Lauf → keine langen Blockaden
    $deleted = 0;
    $handle = @opendir($dir);
    if ($handle === false) return;
    while (($entry = readdir($handle)) !== false) {
        $ext = substr($entry, -4);
        if ($ext !== '.bin' && $ext !== 'json') continue;
        $file = $dir . DIRECTORY_SEPARATOR . $entry;
        // Legacy-.json immer entfernen; .bin nur wenn abgelaufen
        if ($ext === 'json') {
            @unlink($file);
            if (++$deleted >= $maxDelete) break;
            continue;
        }
        $mtime = @filemtime($file);
        if ($mtime !== false && ($now - $mtime) > $ttlSec) {
            @unlink($file);
            if (++$deleted >= $maxDelete) break;
        }
    }
    closedir($handle);
}


// ═══════════════════════════════════════════════════════════════════════════════
// ABSCHNITT 8: REQUEST-BAU & cURL-WEITERLEITUNG
// ═══════════════════════════════════════════════════════════════════════════════
// Baut den Forward-Request auf (Token einfügen) und führt ihn via cURL aus.
// Unterstützt GET, POST (JSON + form-urlencoded) und Binärdaten (PNG/PDF).
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Baut Forward-Request auf: Token in Query oder Body einfügen.
 *
 * @return array [$url, $body, $headers]
 */
function buildForwardRequest(
    string $targetUrl, array $queryParams, string $rawInput, string $contentType, string $token, string $method
): array {
    $headers = ['Accept: */*'];
    $bodyOut = null;
    $hasTokenInQuery = false;
    foreach ($queryParams as $k => $v) {
        if (strcasecmp($k, 'token') === 0 && $v !== '') { $hasTokenInQuery = true; break; }
    }
    if (strtoupper($method) === 'POST') {
        if (strpos($contentType, 'application/json') !== false) {
            $payload = json_decode($rawInput ?: '{}', true);
            if (!is_array($payload)) $payload = [];
            if (!$hasTokenInQuery && !isset($payload['token'])) { $payload['token'] = $token; }
            $bodyOut = json_encode($payload, JSON_UNESCAPED_UNICODE);
            $headers[] = "Content-Type: application/json; charset=utf-8";
        } elseif (strpos($contentType, 'application/x-www-form-urlencoded') !== false) {
            parse_str($rawInput ?? '', $form);
            if (!is_array($form)) $form = [];
            if (!$hasTokenInQuery && !isset($form['token'])) { $form['token'] = $token; }
            $bodyOut = http_build_query($form);
            $headers[] = "Content-Type: application/x-www-form-urlencoded; charset=utf-8";
        } else {
            if (!$hasTokenInQuery) $queryParams['token'] = $token;
        }
    } else {
        if (!$hasTokenInQuery) $queryParams['token'] = $token;
    }
    $qs = http_build_query($queryParams);
    $urlOut = $targetUrl . (strpos($targetUrl, '?') === false ? '?' : '&') . $qs;
    return [$urlOut, $bodyOut, $headers];
}

/**
 * Führt cURL-Request aus und gibt Status, Headers, Body und Response-Zeit zurück.
 *
 * @return array [$httpStatus, $headersArray, $body, $responseTimeMs]
 */
function curlForward(string $url, string $method, ?string $body, array $headers, bool $sslVerifyPeer): array {
    $ch = curl_init();
    $opts = [
        CURLOPT_URL => $url,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER => true,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_SSL_VERIFYPEER => $sslVerifyPeer,
        CURLOPT_SSL_VERIFYHOST => $sslVerifyPeer ? 2 : 0,
        CURLOPT_HTTPHEADER => $headers,
    ];
    if (strtoupper($method) === 'POST') {
        $opts[CURLOPT_POST] = true;
        if ($body !== null) $opts[CURLOPT_POSTFIELDS] = $body;
    }
    curl_setopt_array($ch, $opts);
    $startTime = microtime(true);
    $response = curl_exec($ch);
    $responseTimeMs = (int)((microtime(true) - $startTime) * 1000);
    if ($response === false) {
        $err = curl_error($ch);
        $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE) ?: 502;
        curl_close($ch);
        return [$status, ['content-type' => 'application/json; charset=utf-8'], json_encode(["error" => "Upstream-Request fehlgeschlagen", "detail" => $err]), $responseTimeMs];
    }
    $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $hSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    curl_close($ch);
    $rawHeader = substr($response, 0, $hSize);
    $bodyOut = substr($response, $hSize);
    $headersOut = [];
    foreach (explode("\r\n", trim($rawHeader)) as $line) {
        $parts = explode(':', $line, 2);
        if (count($parts) === 2) {
            $h = strtolower(trim($parts[0]));
            $v = trim($parts[1]);
            if (in_array($h, ['content-type','content-length','cache-control','content-disposition','last-modified','etag','expires'])) {
                $headersOut[$h] = $v;
            }
        }
    }
    return [$status, $headersOut, $bodyOut, $responseTimeMs];
}

/**
 * Leitet Response-Headers und Body an den Client weiter.
 */
function forwardResponse(int $status, array $headers, string $body): void {
    if (isset($headers['content-type'])) header("Content-Type: " . $headers['content-type']);
    else header("Content-Type: application/octet-stream");
    if (isset($headers['content-length'])) header("Content-Length: " . $headers['content-length']);
    if (isset($headers['cache-control'])) header("Cache-Control: " . $headers['cache-control']);
    if (isset($headers['content-disposition'])) header("Content-Disposition: " . $headers['content-disposition']);
    if (isset($headers['last-modified'])) header("Last-Modified: " . $headers['last-modified']);
    if (isset($headers['etag'])) header("ETag: " . $headers['etag']);
    if (isset($headers['expires'])) header("Expires: " . $headers['expires']);
    http_response_code($status);
    echo $body;
}


// ═══════════════════════════════════════════════════════════════════════════════
// ABSCHNITT 9: AGGREGATION (Sliding Window)
// ═══════════════════════════════════════════════════════════════════════════════
// Kombiniert mehrere gleichzeitige Requests (identische Parameter, nur LAYERS
// unterschiedlich) zu einem einzigen Backend-Call. Der erste Request wird
// "Executor" und wartet das Sliding Window ab, sammelt alle Layer-IDs.
// Folge-Requests erhalten sofort ein transparentes 1×1 PNG (HTTP 200).
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Extrahiert Layer-IDs aus dem LAYERS-Parameter.
 * Format: show:1,2,3 → ['1', '2', '3']
 *
 * @return array|null  Array von Layer-IDs oder null wenn kein LAYERS-Parameter
 */
function extractLayerIds(array $params): ?array {
    if (!isset($params['LAYERS']) && !isset($params['layers'])) {
        return null;
    }
    $layers = $params['LAYERS'] ?? $params['layers'] ?? '';
    if (preg_match('/^show:(.+)$/i', $layers, $matches)) {
        $ids = explode(',', $matches[1]);
        return array_map('trim', $ids);
    }
    return null;
}

/**
 * Erstellt einen Aggregationsschlüssel (MD5) aus Pfad + Parametern (ohne LAYERS).
 */
function buildAggregationKey(string $servicePath, array $params): string {
    $keyParams = $params;
    unset($keyParams['LAYERS'], $keyParams['layers']);
    ksort($keyParams);
    return md5($servicePath . '::' . http_build_query($keyParams));
}

/**
 * Hauptfunktion der Aggregation: Sliding-Window-Logik.
 *
 * @return array ['action' => 'respond_204'|'forward_aggregated'|'forward_single', 'params' => array, ...]
 */
function handleAggregation(
    string $servicePath,
    array $queryParams,
    int $windowMs,
    int $windowExtensionMs,
    string $tempDir,
    string $emptyPng,
    string $logFile = '',
    bool $savePng = false,
    string $pngDir = '',
    bool $isPrintRequest = false
): array {
    $currentLayerIds = extractLayerIds($queryParams);
    
    if ($currentLayerIds === null || empty($currentLayerIds)) {
        return ['action' => 'forward_single', 'params' => $queryParams, 'debug' => 'no-layers'];
    }
    
    $aggKey = 'agg_' . buildAggregationKey($servicePath, $queryParams);
    $aggFile = rtrim($tempDir, '/') . '/' . $aggKey . '.json';
    $lockFile = rtrim($tempDir, '/') . '/' . $aggKey . '.lock';
    
    $nowMs = (int)(microtime(true) * 1000);
    $myRequestId = substr(uniqid('', true), -8);
    
    $lockHandle = @fopen($lockFile, 'c');
    if ($lockHandle === false) {
        return ['action' => 'forward_single', 'params' => $queryParams, 'debug' => 'lock-failed'];
    }
    flock($lockHandle, LOCK_EX);
    
    $aggData = null;
    if (file_exists($aggFile)) {
        $json = @file_get_contents($aggFile);
        if ($json !== false) {
            $aggData = json_decode($json, true);
        }
    }
    
    $isFirstRequest = false;
    
    if ($aggData === null || $nowMs >= ($aggData['window_end_ms'] ?? 0)) {
        $aggData = [
            'start_time_ms' => $nowMs,
            'executor_id' => $myRequestId,
            'window_end_ms' => $nowMs + $windowMs,
            'params' => $queryParams,
            'all_layer_ids' => $currentLayerIds
        ];
        @file_put_contents($aggFile, json_encode($aggData), LOCK_EX);
        $isFirstRequest = true;
        $startTimeMs = $nowMs;
    } else {
        $startTimeMs = $aggData['start_time_ms'] ?? $nowMs;
        
        if (!isset($aggData['all_layer_ids'])) {
            $aggData['all_layer_ids'] = [];
        }
        $aggData['all_layer_ids'] = array_values(array_unique(
            array_merge($aggData['all_layer_ids'], $currentLayerIds)
        ));
        
        $aggData['window_end_ms'] = max($aggData['window_end_ms'], $nowMs) + $windowExtensionMs;
        
        @file_put_contents($aggFile, json_encode($aggData), LOCK_EX);
    }
    
    flock($lockHandle, LOCK_UN);
    @fclose($lockHandle);
    
    if ($isFirstRequest) {
        if ($logFile) {
            $modeInfo = $isPrintRequest ? ' [PRINT:' . $windowMs . 'ms]' : '';
            logAggregation($logFile, "EXECUTOR" . $modeInfo, $servicePath, implode(',', $currentLayerIds), $myRequestId, 0, '', 0, $myRequestId);
        }
        
        // Warte auf Aggregationsfenster
        while (true) {
            usleep(5000); // 5ms
            $currentMs = (int)(microtime(true) * 1000);
            
            $checkData = null;
            if (file_exists($aggFile)) {
                $json = @file_get_contents($aggFile);
                if ($json !== false) {
                    $checkData = json_decode($json, true);
                }
            }
            $windowEndMs = $checkData['window_end_ms'] ?? ($startTimeMs + $windowMs);
            
            if ($currentMs >= $windowEndMs) {
                break;
            }
        }
        
        // Finale Daten lesen und aufräumen
        $lockHandle = @fopen($lockFile, 'c');
        if ($lockHandle !== false) {
            flock($lockHandle, LOCK_EX);
        }
        
        $aggDataFinal = null;
        if (file_exists($aggFile)) {
            $json = @file_get_contents($aggFile);
            if ($json !== false) {
                $aggDataFinal = json_decode($json, true);
            }
        }
        
        $allLayerIds = $aggDataFinal['all_layer_ids'] ?? $currentLayerIds;
        $allLayerIds = array_unique($allLayerIds);
        sort($allLayerIds, SORT_NUMERIC);
        
        $aggregatedParams = $queryParams;
        $layersStr = 'show:' . implode(',', $allLayerIds);
        
        if (isset($aggregatedParams['LAYERS'])) {
            $aggregatedParams['LAYERS'] = $layersStr;
        } else {
            $aggregatedParams['layers'] = $layersStr;
        }
        
        $finalElapsedMs = (int)(microtime(true) * 1000) - $startTimeMs;
        
        if ($logFile) {
            $logParams = $aggregatedParams;
            unset($logParams['token']);
            $aggregatedUrl = $servicePath . '?' . http_build_query($logParams);
            $modeInfo = $isPrintRequest ? ' [PRINT]' : '';
            logAggregation($logFile, "AGGREGATED" . $modeInfo, $servicePath, implode(',', $allLayerIds), $myRequestId, count($allLayerIds), $aggregatedUrl, $finalElapsedMs, $myRequestId);
        }
        
        @unlink($aggFile);
        @unlink($lockFile);
        
        if ($lockHandle !== false) {
            flock($lockHandle, LOCK_UN);
            @fclose($lockHandle);
        }
        
        return [
            'action' => 'forward_aggregated', 
            'params' => $aggregatedParams, 
            'debug' => implode(',', $allLayerIds),
            'save_png' => $savePng,
            'png_dir' => $pngDir,
            'request_id' => $myRequestId
        ];
    } else {
        if ($logFile) {
            logAggregation($logFile, "QUEUED", $servicePath, implode(',', $currentLayerIds), $myRequestId, 0, '', 0, $aggData['executor_id'] ?? '');
        }
        return ['action' => 'respond_204', 'params' => $queryParams, 'debug' => 'queued'];
    }
}

/**
 * Loggt Aggregationsaktivität (EXECUTOR, QUEUED, AGGREGATED).
 */
function logAggregation(string $logFile, string $action, string $path, string $layers, string $requestId, int $totalLayers = 0, string $url = '', int $elapsedMs = 0, string $executorId = '', bool $success = true): void {
    global $agsProxyLogLevel;
    
    $clientIp = $_SERVER['REMOTE_ADDR'] ?? '-';
    $xForwardedFor = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';
    $host = $_SERVER['HTTP_HOST'] ?? '-';
    $userAgent = $_SERVER['HTTP_USER_AGENT'] ?? '-';
    $referer = $_SERVER['HTTP_REFERER'] ?? '-';
    
    if ($xForwardedFor !== '') {
        $clientIp = explode(',', $xForwardedFor)[0];
    }
    
    $logEntry = sprintf(
        "%s | Path: %s | Layers: %s | RequestID: %s",
        str_pad($action, 11),
        $path,
        $layers,
        substr($requestId, -8)
    );
    
    if ($action === 'QUEUED' && $executorId !== '') {
        $logEntry .= " | Executor: " . substr($executorId, -8);
    }
    
    if ($totalLayers > 0) {
        $logEntry .= " | Total: $totalLayers";
    }
    
    if ($elapsedMs > 0) {
        if ($executorId !== '' && $action !== 'QUEUED') {
            $logEntry .= " | Elapsed since request (executor) " . substr($executorId, -8) . ": {$elapsedMs}ms";
        } else {
            $logEntry .= " | Elapsed: {$elapsedMs}ms";
        }
    }
    
    if (!$success) {
        $logEntry .= " | WARNING: Layer add failed after retries";
    }
    
    if ($action === 'EXECUTOR') {
        $logEntry .= "\n    Client: " . $clientIp . " | Host: " . $host;
        if ($referer !== '-') {
            $logEntry .= " | Referer: " . $referer;
        }
    }
    
    if ($url !== '') {
        $logEntry .= "\n    URL: " . $url;
    }
    
    writeLog($logFile, 'info', $logEntry, $agsProxyLogLevel ?? 'error');
}

/**
 * Loggt Backend-Response-Details für aggregierte Requests.
 */
function logAggregationResponse(string $logFile, string $path, string $requestId, int $httpStatus, int $responseTimeMs, int $responseSize): void {
    global $agsProxyLogLevel;
    
    if ($responseSize >= 1048576) {
        $sizeStr = sprintf('%.2f MB', $responseSize / 1048576);
    } elseif ($responseSize >= 1024) {
        $sizeStr = sprintf('%.1f KB', $responseSize / 1024);
    } else {
        $sizeStr = $responseSize . ' B';
    }
    
    $logEntry = sprintf(
        "%s | Path: %s | RequestID: %s | HTTP: %d | Time: %dms | Size: %s",
        str_pad('RESPONSE', 11),
        $path,
        substr($requestId, -8),
        $httpStatus,
        $responseTimeMs,
        $sizeStr
    );
    
    writeLog($logFile, 'info', $logEntry, $agsProxyLogLevel ?? 'error');
}


// ═══════════════════════════════════════════════════════════════════════════════
// ABSCHNITT 10: PRINT-MODUL
// ═══════════════════════════════════════════════════════════════════════════════
// Session-Tracking für Druckvorgänge. Jeder Druck besteht aus mehreren
// sequentiellen Requests (ein Request pro Layer). Diese werden in einer
// Session-Datei (JSON) aggregiert und nach Inaktivitäts-Timeout finalisiert.
//
// Funktionen:
//   createPrintSession()       — Erstellt neue Session-Struktur
//   logPrintDoneEntry()        — Loggt PRINT_DONE mit aggregierten Metriken
//   startPrintSessionTimer()   — Startet CLI-Hintergrundprozess als Timer
//   finalizePrintSession()     — Prüft Session und schreibt DONE (Legacy)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Erstellt eine neue Print-Session-Datenstruktur.
 *
 * @param string      $path      Request-Pfad + Parameter (ohne LAYERS)
 * @param int         $dpi       Druck-DPI
 * @param string      $clientIp  Client-IP
 * @param string|null $sessionId Optionale vordefinierte Session-ID
 * @return array                 Session-Datenstruktur
 */
function createPrintSession(string $path, int $dpi, string $clientIp, ?string $sessionId = null): array {
    if ($sessionId === null) {
        $sessionId = date('Ymd_His') . '_' . substr(uniqid('', true), -6);
    }
    return [
        'session_id' => $sessionId,
        'path' => $path,
        'count' => 0,
        'total_time_ms' => 0,
        'total_size' => 0,
        'layers' => [],
        'dpi' => $dpi,
        'client' => $clientIp,
        'created_ms' => microtime(true) * 1000,
        'last_time_ms' => 0,
        'last_req_end_ms' => 0,
        'seq' => 0,
        'done_written' => false
    ];
}

/**
 * Loggt PRINT_DONE mit aggregierten Metriken einer abgeschlossenen Session.
 */
function logPrintDoneEntry(array $session, string $path, string $logFile): void {
    $totalSizeStr = $session['total_size'] >= 1048576 
        ? sprintf('%.2f MB', $session['total_size'] / 1048576)
        : ($session['total_size'] >= 1024 
            ? sprintf('%.1f KB', $session['total_size'] / 1024) 
            : $session['total_size'] . ' B');
    
    $sessionId = $session['session_id'] ?? 'unknown';
    $layers = isset($session['layers']) && is_array($session['layers']) ? implode(', ', $session['layers']) : '-';
    
    @file_put_contents($logFile, 
        '[' . date('Y-m-d H:i:s.') . substr((string)microtime(), 2, 3) . '] PRINT_DONE | SessionID: ' . $sessionId . ' | Path: ' . $path . ' | Layers: ' . $layers . ' | Requests: ' . $session['count'] . ' | Total Time: ' . $session['total_time_ms'] . 'ms | Total Size: ' . $totalSizeStr . ' | DPI: ' . $session['dpi'] . ' | Client: ' . $session['client'] . "\n", 
        FILE_APPEND | LOCK_EX
    );
}

/**
 * Startet asynchronen Timer-Prozess für Print-Session-Finalisierung.
 * Ruft agsproxy.php im CLI-Modus (--print-timer) als Hintergrundprozess auf.
 *
 * @param string $sessionFile Session-Datei (JSON)
 * @param string $pathKey     Session-Key (Pfad + Parameter)
 * @param int    $timeoutMs   Inaktivitäts-Timeout in ms
 * @param string $logFile     Log-Datei
 * @param string $scriptFile  Pfad zu agsproxy.php (__FILE__)
 * @param string $logLevel    Log-Level
 */
function startPrintSessionTimer(string $sessionFile, string $pathKey, int $timeoutMs, string $logFile, string $scriptFile, string $logLevel = 'error'): void {
    if (empty($sessionFile) || empty($pathKey)) {
        return;
    }
    
    if (!file_exists($sessionFile)) {
        return;
    }
    
    $phpBin = (defined('PHP_BINARY') && PHP_BINARY) ? PHP_BINARY : '/usr/bin/php';
    $cmd = sprintf(
        '%s %s --print-timer %s %s %d %s %s',
        escapeshellarg($phpBin),
        escapeshellarg($scriptFile),
        escapeshellarg($sessionFile),
        escapeshellarg($pathKey),
        $timeoutMs,
        escapeshellarg($logFile),
        escapeshellarg($logLevel)
    );
    
    // Hintergrundprozess starten (Windows & Linux kompatibel)
    if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
        pclose(popen('start /B ' . $cmd . ' > NUL 2>&1', 'r'));
    } else {
        $errorLog = dirname($logFile) . '/timer_errors.log';
        exec($cmd . ' >> ' . escapeshellarg($errorLog) . ' 2>&1 &');
    }
}

/**
 * Finalisiert eine Print-Session (wird von Timer-Prozess aufgerufen, Legacy-Funktion).
 * Die eigentliche Finalisierung erfolgt im CLI-Modus (Abschnitt 4).
 */
function finalizePrintSession(string $sessionFile, string $pathKey, int $timeoutMs, string $logFile): void {
    if (!file_exists($sessionFile)) {
        return;
    }
    
    $fp = @fopen($sessionFile, 'c+');
    if (!$fp || !flock($fp, LOCK_EX)) {
        if ($fp) fclose($fp);
        return;
    }
    
    $content = stream_get_contents($fp);
    $session = $content ? json_decode($content, true) : null;
    
    if (!is_array($session) || !isset($session['last_req_end_ms'])) {
        flock($fp, LOCK_UN);
        fclose($fp);
        return;
    }
    
    $nowMs = microtime(true) * 1000;
    $inactiveMs = $nowMs - $session['last_req_end_ms'];
    
    if ($inactiveMs >= $timeoutMs) {
        $path = $session['path'] ?? $pathKey;
        logPrintDoneEntry($session, $path, $logFile);
        
        flock($fp, LOCK_UN);
        fclose($fp);
        @unlink($sessionFile);
    } else {
        flock($fp, LOCK_UN);
        fclose($fp);
    }
}
