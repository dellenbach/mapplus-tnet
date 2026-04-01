<?php
/**
 * legend-proxy.php
 * Legenden-Proxy für ArcGIS Server — rendert formatierte HTML-Legenden
 * mit konfigurierbarer Symbolgrösse aus dem ArcGIS REST Legend-Endpunkt.
 *
 * Holt Legend-JSON via agsproxy.php (Token-Management inklusive),
 * rendert kompaktes, selbstständiges HTML mit eingebetteten Base64-Bildern.
 * Unterstützt #-Label-Auflösung via Attribut-Queries (groupBy + Renderer)
 * sowie Gruppierung der Legende nach einem Attributfeld (z.B. Gemeinde).
 *
 * Parameter:
 *   service      (string, PFLICHT) ArcGIS MapServer-Pfad.
 *                Beispiel: "gis_oereb/nw_nutzungsplanung_DEF/MapServer"
 *                "/MapServer" wird automatisch angehängt falls fehlend.
 *
 *   width        (int, default: 16, min: 8, max: 512)
 *                Symbolbreite in px für die ArcGIS-Abfrage.
 *
 *   height       (int, default: 10, min: 8, max: 512)
 *                Symbolhöhe in px für die ArcGIS-Abfrage.
 *
 *   dpi          (int, default: 288, min: 72, max: 600)
 *                DPI für ArcGIS-Rendering. Höherer DPI = dickere Linien/Punkte.
 *                96 = ArcGIS-Standard (dünn), 192 = 2× dicker, 288 = 3× dicker.
 *
 *   zoom         (float, default: 3.0, min: 0.5, max: 5.0)
 *                Zusätzliche CSS-Vergrösserung der Anzeige.
 *                Endgrösse = width×zoom × height×zoom px.
 *
 *   resolve      (bool, default: true)
 *                #-Label-Auflösung via Attribut-Query.
 *                true = Labels mit "#" werden durch Bezeichnungen aus den
 *                Feldern codefield/labelfield ersetzt (2-Pass: groupBy + Renderer).
 *                Einträge ohne Lookup-Treffer werden entfernt.
 *                false = Labels bleiben unverändert (Roh-Darstellung).
 *
 *   labelfield   (string, default: "Typ_Bezeichnung")
 *                Feldname für die Legendenbezeichnung bei #-Label-Auflösung.
 *
 *   codefield    (string, default: "Typ_Darstellungscode")
 *                Feldname für den Darstellungscode bei #-Label-Auflösung.
 *                Die Query gruppiert nach codefield+labelfield und ersetzt
 *                das "#"-Label durch die aufgelöste Bezeichnung.
 *
 *   legendgroup  (string, default: "Gemeinde" wenn #-Labels vorhanden, sonst leer)
 *                Attributfeld für die Gruppierung der Legende.
 *                Wenn gesetzt, wird die Legende nach den Werten dieses Felds
 *                in zusammenklappbare Sektionen unterteilt.
 *                Pro Sektion nur die Symbole, die in dieser Gruppe vorkommen.
 *                "none" = Gruppierung explizit deaktivieren.
 *
 *   layers       (string, default: leer = alle Layer)
 *                Komma-separierte Layer-IDs zum Filtern.
 *                Beispiel: "0,1,2" zeigt nur Layer 0, 1 und 2.
 *
 *   nocache      (string, default: 0)
 *                Cache umgehen: "1" = frische Daten holen.
 *                Cache-TTL: 24 Stunden.
 *
 *   inject       (bool, default: true)
 *                Metadata-Injection via legend_wms_metadata.json (gleiche Datei wie WMS-Proxy).
 *                true  = Mapping laden + pro Layer anwenden (Felder: title, description, ...).
 *                false = keine Injection, leichterer Cache-Key.
 *
 *   format       (string, default: "html")
 *                Ausgabeformat: "html" (selbstständige HTML-Seite) oder
 *                "json" (strukturierte JSON-Daten).
 *
 * Test-URLs:
 *   ?service=ewn/EWN_NIS/MapServer
 *   ?service=awu/AWU_WERKPLAN/MapServer
 *   ?service=awu/AWU_WERKPLAN_cache/MapServer
 *   ?service=awu/AWU_EIGENTUM/MapServer
 *   ?service=ewn/EWN_NIS_gwr/MapServer
 *   ?service=gis_fach/nw_kbs/MapServer
 *   ?service=ewn/EWN_NIS/MapServer&width=32&height=32
 *   ?service=ewn/EWN_NIS/MapServer&layers=0,1,2
 *   ?service=ewn/EWN_NIS/MapServer&format=json
 *   ?service=ewn/EWN_NIS/MapServer&nocache=1
 *   ?service=gis_oereb/nw_nutzungsplanung_DEF/MapServer&nocache=1
 *   ?service=gis_oereb/nw_nutzungsplanung_DEF/MapServer&nocache=1&format=json
 *   ?service=gis_oereb/nw_nutzungsplanung_DEF/MapServer&legendgroup=none&nocache=1
 *   ?service=gis_oereb/nw_nutzungsplanung_DEF/MapServer&resolve=false&nocache=1
 *
 * @version    1.1
 * @date       2026-03-01
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

// ===== KONFIGURATION =====

$CACHE_DIR    = '/data/Client_Data/nwow/tmp/legends';
$CACHE_TTL    = 86400;   // 24 Stunden in Sekunden
$LOG_FILE     = '/data/Client_Data/nwow/tmp/legend-proxy.log';
$DEFAULT_WIDTH  = 16;
$DEFAULT_HEIGHT = 10;
$DEFAULT_DPI    = 192;    // 2× DPI: kräftige Linien/Punkte, kleinere Payload als 288
$DEFAULT_ZOOM   = 3;      // 3× CSS-Vergrösserung → Anzeige 48×30px

// ArcGIS Direkt-Anbindung (Token-Cache geteilt mit agsproxy.php, kein HTTP-Roundtrip)
$AGS_BASE        = getenv('GIS_REST_ROOT')  ?: 'https://www.gis-daten.ch/svc/rest/services/';
$AGS_TOKEN_URL   = getenv('GIS_TOKEN_URL')  ?: 'https://www.gis-daten.ch/svc/tokens/';
$AGS_TOKEN_USER  = getenv('GIS_TOKEN_USER') ?: 'mapplus-imp';
$AGS_TOKEN_PASS  = getenv('GIS_TOKEN_PASS') ?: 'mapplus-imp6370';
// Token-Cache 3 Ebenen nach oben: tnet/api/v1/ → maps/ (gleiche Datei wie agsproxy.php)
$AGS_TOKEN_CACHE = dirname(__DIR__, 3) . '/_token_cache/arcgis_token.json';
$AGS_TOKEN_SKEW  = 60;  // Safety-Skew in Sekunden

// Metadata-Injection-Mapping (gemeinsam mit legend-proxy-wms.php)
$METADATA_FILE = dirname(__DIR__, 4) . '/core/config/legend_wms_metadata.json';

// ===== CORS & HEADERS =====

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ===== CACHE-INDEX AKTUALISIEREN =====

/**
 * Trägt eine neue Cache-Datei in den Service-Index ein.
 * Index-Format: { "md5hash.ext": "service/pfad" }
 */
function updateCacheIndex($cacheDir, $basename, $service) {
    $indexFile = $cacheDir . '/_index.json';
    $index = [];
    if (file_exists($indexFile)) {
        $raw = file_get_contents($indexFile);
        if ($raw !== false) {
            $index = json_decode($raw, true) ?: [];
        }
    }
    $index[$basename] = $service;
    @file_put_contents($indexFile, json_encode($index, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), LOCK_EX);
}

// ===== ACTION-HANDLER (Cache-Verwaltung) =====

if (isset($_GET['action'])) {
    $action    = trim($_GET['action']);
    $svcFilter = isset($_GET['service']) ? trim($_GET['service']) : '';

    if ($action === 'clear-cache') {
        $indexFile = $CACHE_DIR . '/_index.json';
        $deleted   = 0;
        $errors    = 0;

        if (!is_dir($CACHE_DIR)) {
            jsonResponse(['success' => true, 'deleted' => 0, 'message' => 'Cache-Verzeichnis existiert nicht.']);
        }

        // Index laden
        $index = [];
        if (file_exists($indexFile)) {
            $raw = file_get_contents($indexFile);
            $index = $raw ? (json_decode($raw, true) ?: []) : [];
        }

        // Alle Cache-Dateien ermitteln
        $files = glob($CACHE_DIR . '/*.{html,json}', GLOB_BRACE) ?: [];

        foreach ($files as $file) {
            $basename = basename($file);
            // Service-Filter: nur passende Dateien löschen
            if ($svcFilter !== '') {
                $svc = $index[$basename] ?? null;
                if ($svc === null || strcasecmp($svc, $svcFilter) !== 0) {
                    continue;
                }
            }
            if (@unlink($file)) {
                unset($index[$basename]);
                $deleted++;
            } else {
                $errors++;
            }
        }

        // Index neu schreiben
        @file_put_contents($indexFile, json_encode($index, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), LOCK_EX);

        $msg = $svcFilter !== ''
            ? "Cache f\u00fcr Service '$svcFilter' geleert."
            : 'Gesamter Legenden-Cache geleert.';
        jsonResponse(['success' => true, 'deleted' => $deleted, 'errors' => $errors, 'message' => $msg]);
    }

    jsonResponse(['success' => false, 'error' => "Unbekannte Action: $action"], 400);
}

// ===== HILFSFUNKTIONEN =====

/**
 * Schreibt einen Log-Eintrag mit Zeitstempel.
 */
function logMessage($file, $level, $msg) {
    $ts = date('Y-m-d H:i:s');
    @file_put_contents($file, "[$ts] $level | $msg\n", FILE_APPEND | LOCK_EX);
}

/**
 * Sendet eine JSON-Antwort und beendet das Script.
 */
function jsonResponse($data, $code = 200) {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/**
 * Sendet eine HTML-Antwort und beendet das Script.
 */
function htmlResponse($html, $code = 200) {
    http_response_code($code);
    header('Content-Type: text/html; charset=utf-8');
    echo $html;
    exit;
}

/**
 * Sendet gecachten Inhalt mit gzip-Komprimierung, ETag und Browser-Cache-Headern.
 * Bei If-None-Match-Treffer: 304 Not Modified (kein Body).
 *
 * @param string $file    Absoluter Pfad zur Cache-Datei
 * @param string $ctype   Content-Type
 * @param int    $ttl     Cache-TTL in Sekunden
 * @param string $xCache  Wert für X-Legend-Cache Header
 */
function sendCachedFile($file, $ctype, $ttl, $xCache) {
    $content = file_get_contents($file);
    $etag    = '"' . md5($content) . '"';
    $mtime   = filemtime($file);

    // Browser-Cache-Header
    header('Cache-Control: public, max-age=' . $ttl);
    header('Last-Modified: ' . gmdate('D, d M Y H:i:s', $mtime) . ' GMT');
    header('ETag: ' . $etag);
    header('X-Legend-Cache: ' . $xCache);

    // 304 Not Modified wenn ETag übereinstimmt
    $ifNoneMatch = $_SERVER['HTTP_IF_NONE_MATCH'] ?? '';
    if ($ifNoneMatch === $etag) {
        http_response_code(304);
        exit;
    }

    header('Content-Type: ' . $ctype . '; charset=utf-8');

    // gzip-Komprimierung wenn Browser unterstützt
    $acceptEnc = $_SERVER['HTTP_ACCEPT_ENCODING'] ?? '';
    if (strpos($acceptEnc, 'gzip') !== false) {
        $gz = gzencode($content, 6);
        if ($gz !== false) {
            header('Content-Encoding: gzip');
            header('Content-Length: ' . strlen($gz));
            echo $gz;
            exit;
        }
    }

    header('Content-Length: ' . strlen($content));
    echo $content;
    exit;
}

/**
 * Sendet eine Fehler-Antwort im gewünschten Format.
 */
function errorResponse($msg, $code = 400, $format = 'html') {
    if ($format === 'json') {
        jsonResponse(['success' => false, 'error' => $msg], $code);
    }
    $html = '<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>Fehler</title></head>';
    $html .= '<body style="font-family:\'Segoe UI\',sans-serif;padding:20px;">';
    $html .= '<p style="color:#c00;font-size:14px;">&#9888; ' . htmlspecialchars($msg) . '</p></body></html>';
    htmlResponse($html, $code);
}

// ===== ArcGIS DIREKT-ZUGRIFF HILFSFUNKTIONEN =====

/**
 * Liest den gecachten ArcGIS-Token (aus agsproxy-Cache) oder holt einen neuen.
 * Schreibt neuen Token in dieselbe Cache-Datei wie agsproxy.php.
 */
function agsGetToken($tokenUrl, $user, $pass, $cacheFile, $skewSec) {
    if (file_exists($cacheFile)) {
        $raw = @file_get_contents($cacheFile);
        if ($raw !== false) {
            $data  = json_decode($raw, true);
            $nowMs = (int)(microtime(true) * 1000);
            if (!empty($data['token']) && isset($data['expires']) && ($data['expires'] - $skewSec * 1000) > $nowMs) {
                return $data['token'];
            }
        }
    }
    // Neuen Token vom ArcGIS Token-Service holen
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL            => $tokenUrl,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => http_build_query(['username' => $user, 'password' => $pass,
                                                    'client' => 'requestip', 'f' => 'json', 'expiration' => 60]),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    $resp = curl_exec($ch);
    curl_close($ch);
    if (!$resp) return '';
    $data = json_decode($resp, true);
    if (empty($data['token'])) return '';
    $nowMs   = (int)(microtime(true) * 1000);
    $expires = isset($data['expires']) ? (int)$data['expires'] : ($nowMs + 3600000);
    $dir = dirname($cacheFile);
    if (!is_dir($dir)) @mkdir($dir, 0700, true);
    @file_put_contents($cacheFile, json_encode(['token' => $data['token'], 'expires' => $expires],
                       JSON_UNESCAPED_SLASHES), LOCK_EX);
    return $data['token'];
}

/**
 * Prüft ob eine ArcGIS-REST-Antwort ein Token-Fehler ist.
 * ArcGIS-Codes: 498 = Token invalid/expired, 499 = Token required.
 *
 * @param mixed $data   json_decode()-Ergebnis der ArcGIS-Antwort
 * @return bool
 */
function agsIsTokenError($data) {
    if (!is_array($data) || !isset($data['error'])) return false;
    $code = (int)($data['error']['code'] ?? 0);
    $msg  = strtolower($data['error']['message'] ?? '');
    return $code === 498 || $code === 499
        || strpos($msg, 'invalid token')   !== false
        || strpos($msg, 'token expired')   !== false
        || strpos($msg, 'token required')  !== false;
}

/**
 * Erzwingt einen neuen ArcGIS-Token (Cache-Datei wird gelöscht).
 *
 * @param string $tokenUrl  Token-Service-URL
 * @param string $user      Benutzername
 * @param string $pass      Passwort
 * @param string $cacheFile Pfad zur Cache-Datei
 * @param int    $skewSec   Sicherheits-Puffer in Sekunden
 * @return string           Neuer Token oder ''
 */
function agsForceRefreshToken($tokenUrl, $user, $pass, $cacheFile, $skewSec) {
    @unlink($cacheFile);  // Abgelaufenen Cache löschen
    return agsGetToken($tokenUrl, $user, $pass, $cacheFile, $skewSec);
}

/**
 * Baut eine direkte ArcGIS REST URL auf (kein agsproxy-Roundtrip).
 * @param string $agsBase  Basis-URL inkl. trailing slash (z.B. 'https://.../services/')
 * @param string $path     Service-Pfad (z.B. 'ewn/EWN_NIS/MapServer/legend')
 * @param array  $params   Query-Parameter (ohne token)
 * @param string $token    ArcGIS-Token
 */
function agsBuildUrl($agsBase, $path, array $params, $token) {
    if ($token !== '') $params['token'] = $token;
    return rtrim($agsBase, '/') . '/' . ltrim($path, '/') . '?' . http_build_query($params);
}

// ===== PARAMETER LESEN =====

$service = isset($_GET['service']) ? trim($_GET['service']) : '';
$width   = isset($_GET['width'])   ? max(8, min(512, intval($_GET['width'])))  : $DEFAULT_WIDTH;
$height  = isset($_GET['height'])  ? max(8, min(512, intval($_GET['height']))) : $DEFAULT_HEIGHT;
$dpi     = isset($_GET['dpi'])     ? max(72, min(600, intval($_GET['dpi'])))   : $DEFAULT_DPI;
$zoom    = isset($_GET['zoom'])    ? max(0.5, min(5, floatval($_GET['zoom']))) : $DEFAULT_ZOOM;
$layers       = isset($_GET['layers'])     ? trim($_GET['layers']) : '';
$resolveLabels = !isset($_GET['resolve']) || strtolower(trim($_GET['resolve'])) !== 'false';
$labelField   = isset($_GET['labelfield']) ? trim($_GET['labelfield']) : 'Typ_Bezeichnung';
$codeField    = isset($_GET['codefield'])  ? trim($_GET['codefield'])  : 'Typ_Darstellungscode';
$legendGroup  = isset($_GET['legendgroup']) ? trim($_GET['legendgroup']) : '';
$noCache    = isset($_GET['nocache']) && $_GET['nocache'] === '1';
$format     = (isset($_GET['format']) && $_GET['format'] === 'json') ? 'json' : 'html';
$injectRaw  = isset($_GET['inject']) ? strtolower(trim((string)$_GET['inject'])) : '';
$inject     = ($injectRaw === '0' || $injectRaw === 'false') ? false : true; // default: true

// ArcGIS holt bei voller Grösse + DPI (scharf + dick)
// Zoom skaliert nur die CSS-Anzeige zusätzlich hoch
$displayWidth  = max(12, round($width * $zoom));
$displayHeight = max(12, round($height * $zoom));

// Service validieren
if ($service === '') {
    errorResponse('Parameter "service" fehlt. Beispiel: ?service=ewn/EWN_NIS/MapServer', 400, $format);
}

// Nur erlaubte Zeichen (Pfad-Segmente, Buchstaben, Zahlen, _, -)
if (!preg_match('#^[a-zA-Z0-9_/\-]+$#', $service)) {
    errorResponse('Ungültiger Service-Pfad: ' . $service, 400, $format);
}

// /MapServer automatisch anhängen falls fehlend
if (!preg_match('#/MapServer$#i', $service)) {
    $service .= '/MapServer';
}

// ===== CACHE PRÜFEN (Früh-Cache nur bei explizitem legendgroup) =====

// legendgroup=none → sofort auflösen
$legendGroupExplicit = isset($_GET['legendgroup']);
if ($legendGroup !== '' && strtolower($legendGroup) === 'none') {
    $legendGroup = '';
    $legendGroupExplicit = true; // "none" zählt als explizit gesetzt (= leer)
}

$cacheKey  = md5($service . '|' . $width . 'x' . $height . '|d' . $dpi . '|z' . $zoom . '|' . $layers . '|r' . ($resolveLabels ? '1' : '0') . '|' . $labelField . '|' . $codeField . '|g' . $legendGroup . '|i' . ($inject ? '1' : '0'));
$cacheExt  = ($format === 'json') ? '.json' : '.html';
$cacheFile = $CACHE_DIR . '/' . $cacheKey . $cacheExt;

// Auto-Default-Cache: separater Alias-Key für Aufrufe ohne legendgroup-Parameter.
// Wird am Ende befüllt und hier sofort geprüft → kein ArcGIS-Kontakt bei HIT.
$cacheKeyAuto  = md5($service . '|' . $width . 'x' . $height . '|d' . $dpi . '|z' . $zoom . '|' . $layers . '|r' . ($resolveLabels ? '1' : '0') . '|' . $labelField . '|' . $codeField . '|gAUTO|i' . ($inject ? '1' : '0'));
$cacheFileAuto = $CACHE_DIR . '/' . $cacheKeyAuto . $cacheExt;

// Früh-Cache: explizites legendgroup
if ($legendGroupExplicit && !$noCache && file_exists($cacheFile) && (time() - filemtime($cacheFile)) < $CACHE_TTL) {
    $ctype = ($format === 'json') ? 'application/json' : 'text/html';
    sendCachedFile($cacheFile, $ctype, $CACHE_TTL, 'HIT');
}

// Früh-Cache: kein legendgroup → AUTO-Alias (vorangehendes Request hat Ergebnis gecacht)
if (!$legendGroupExplicit && !$noCache && file_exists($cacheFileAuto) && (time() - filemtime($cacheFileAuto)) < $CACHE_TTL) {
    $ctype = ($format === 'json') ? 'application/json' : 'text/html';
    sendCachedFile($cacheFileAuto, $ctype, $CACHE_TTL, 'HIT-AUTO');
}

// ===== LEGEND-JSON DIREKT VON ARCGIS HOLEN =====

// Cache-Verzeichnis erstellen
if (!is_dir($CACHE_DIR)) {
    @mkdir($CACHE_DIR, 0775, true);
}

// ArcGIS-Token holen (gemeinsamer Cache mit agsproxy.php — kein HTTP-Roundtrip)
$agsToken  = agsGetToken($AGS_TOKEN_URL, $AGS_TOKEN_USER, $AGS_TOKEN_PASS, $AGS_TOKEN_CACHE, $AGS_TOKEN_SKEW);
$legendUrl = agsBuildUrl($AGS_BASE, $service . '/legend', ['f' => 'pjson', 'size' => $width . ',' . $height, 'dpi' => $dpi], $agsToken);

logMessage($LOG_FILE, 'INFO', "Fetch: $service | Size: {$width}x{$height} | DPI: {$dpi} | Zoom: {$zoom}x | Display: {$displayWidth}x{$displayHeight}");

// cURL-Request direkt an ArcGIS (kein Proxy-Zwischenhop)
$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL            => $legendUrl,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 30,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_HTTPHEADER     => ['Accept: application/json'],
]);

$response  = curl_exec($ch);
$httpCode  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
curl_close($ch);

if ($curlError) {
    logMessage($LOG_FILE, 'ERROR', "cURL Fehler: $curlError | Service: $service");
    errorResponse('Verbindungsfehler zu ArcGIS: ' . $curlError, 502, $format);
}

if ($httpCode !== 200) {
    logMessage($LOG_FILE, 'ERROR', "HTTP $httpCode von ArcGIS | Service: $service");
    errorResponse("ArcGIS liefert HTTP $httpCode", 502, $format);
}

// JSON parsen
$legendData = json_decode($response, true);
if (!$legendData || isset($legendData['error'])) {
    // Token-Fehler? → Cache löschen + einmal automatisch neu versuchen
    if ($legendData && agsIsTokenError($legendData)) {
        $errCode  = $legendData['error']['code'] ?? 0;
        logMessage($LOG_FILE, 'WARN', "Token-Fehler ($errCode) — Cache leeren, Token neu holen + Retry | Service: $service");
        $agsToken  = agsForceRefreshToken($AGS_TOKEN_URL, $AGS_TOKEN_USER, $AGS_TOKEN_PASS, $AGS_TOKEN_CACHE, $AGS_TOKEN_SKEW);
        $legendUrl = agsBuildUrl($AGS_BASE, $service . '/legend',
                        ['f' => 'pjson', 'size' => $width . ',' . $height, 'dpi' => $dpi], $agsToken);
        $chRetry = curl_init();
        curl_setopt_array($chRetry, [
            CURLOPT_URL            => $legendUrl,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 30,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_HTTPHEADER     => ['Accept: application/json'],
        ]);
        $response   = curl_exec($chRetry);
        curl_close($chRetry);
        $legendData = json_decode($response, true);
    }
    // Nach eventuellem Retry nochmals prüfen
    if (!$legendData || isset($legendData['error'])) {
        $errMsg = isset($legendData['error']['message']) ? $legendData['error']['message'] : 'Ungültiges JSON';
        logMessage($LOG_FILE, 'ERROR', "Legend-JSON Fehler: $errMsg | Service: $service");
        errorResponse('ArcGIS Legend-Fehler: ' . $errMsg, 502, $format);
    }
}

if (!isset($legendData['layers']) || !is_array($legendData['layers'])) {
    errorResponse('Keine Layer in Legend-Antwort gefunden', 404, $format);
}

// ===== LAYER-FILTER =====

// Gruppen-Layer entfernen — nur Leaf-Layer behalten
// Gruppen-Layer erkennt man an: subLayerIds ist gesetzt und nicht leer, ODER legend-Array ist leer
$filteredLayers = array_filter($legendData['layers'], function($layer) {
    // subLayerIds vorhanden und nicht leer → Gruppen-Layer → rausfiltern
    if (isset($layer['subLayerIds']) && is_array($layer['subLayerIds']) && count($layer['subLayerIds']) > 0) {
        return false;
    }
    // Kein legend-Array oder leer → kein sichtbarer Inhalt → rausfiltern
    if (empty($layer['legend'])) {
        return false;
    }
    return true;
});
$filteredLayers = array_values($filteredLayers);

// Optional: nur bestimmte Layer-IDs
if ($layers !== '') {
    $allowedIds = array_map('intval', explode(',', $layers));
    $filteredLayers = array_filter($filteredLayers, function($layer) use ($allowedIds) {
        return in_array($layer['layerId'], $allowedIds);
    });
    $filteredLayers = array_values($filteredLayers);
}

// ===== AUTO-DEFAULT: legendgroup=Gemeinde wenn Code-basierte Layer vorhanden =====
// Auswertung auf Rohdaten — kein API-Aufruf nötig, muss vor fetchLegendAuxData stehen.

if ($legendGroup === '' && !$legendGroupExplicit) {
    $hasCodeEntries = false;
    foreach ($filteredLayers as $layer) {
        foreach ($layer['legend'] ?? [] as $entry) {
            if (isset($entry['values']) && is_array($entry['values']) && count($entry['values']) > 0) {
                $hasCodeEntries = true;
                break 2;
            }
        }
    }
    if ($hasCodeEntries) {
        $legendGroup = 'Gemeinde';
        logMessage($LOG_FILE, 'INFO', "Auto-Default: legendgroup=Gemeinde (Code-basierte Layer erkannt)");

        // Cache-Key mit neuem legendGroup neu berechnen + prüfen
        $cacheKey  = md5($service . '|' . $width . 'x' . $height . '|d' . $dpi . '|z' . $zoom . '|' . $layers . '|r' . ($resolveLabels ? '1' : '0') . '|' . $labelField . '|' . $codeField . '|g' . $legendGroup . '|i' . ($inject ? '1' : '0'));
        $cacheFile = $CACHE_DIR . '/' . $cacheKey . $cacheExt;

        if (!$noCache && file_exists($cacheFile) && (time() - filemtime($cacheFile)) < $CACHE_TTL) {
            $ctype = ($format === 'json') ? 'application/json' : 'text/html';
            sendCachedFile($cacheFile, $ctype, $CACHE_TTL, 'HIT');
        }
    }
}

// ===== ALLE HILFSABFRAGEN IN EINEM CURL_MULTI-BATCH =====
// Labels (groupBy + Renderer) und Gruppen-Mapping parallel — spart 2 serielle Runden.

$auxData = fetchLegendAuxData(
    $filteredLayers, $service, $labelField, $codeField, $legendGroup,
    $resolveLabels, $AGS_BASE, $agsToken, $LOG_FILE,
    $AGS_TOKEN_URL, $AGS_TOKEN_USER, $AGS_TOKEN_PASS, $AGS_TOKEN_CACHE, $AGS_TOKEN_SKEW
);
// Evtl. erneuerter Token (nach Token-Retry in fetchLegendAuxData) übernehmen
$agsToken = $auxData['token'];

// Labels nach Lookup ersetzen (#-Labels → lesbare Bezeichnungen)
if ($resolveLabels && !empty($auxData['lookup'])) {
    $filteredLayers = applyLabelLookup($filteredLayers, $auxData['lookup'], $LOG_FILE);
}

// ===== METADATA-INJECTION =====

$metadataMap = $inject ? loadMetadataMap($METADATA_FILE) : [];
if (!empty($metadataMap)) {
    foreach ($filteredLayers as &$layer) {
        $meta = injectMetadata($metadataMap, $service, $layer['layerName'] ?? '');
        if ($meta !== null) {
            $layer['metadata'] = $meta;
        }
    }
    unset($layer);
}

// ===== GRUPPIERUNG NACH FELD (legendgroup) =====

$groupedData = null;
if ($legendGroup !== '') {
    $groupMapping = $auxData['groupMapping'];
    if (!empty($groupMapping['groups'])) {
        $groupedData = groupLayersByField($filteredLayers, $groupMapping);
    }
    if ($groupedData === null || empty($groupedData)) {
        logMessage($LOG_FILE, 'WARN', "Gruppierung nach '$legendGroup' ergab keine Ergebnisse — Fallback auf ungroupiert");
        $groupedData = null;
    }
}

// ===== FORMAT: JSON — Roh-Daten durchreichen =====

if ($format === 'json') {
    if ($groupedData !== null) {
        $output = [
            'success'    => true,
            'service'    => $service,
            'symbolSize' => ['width' => $width, 'height' => $height],
            'groupField' => $legendGroup,
            'groupCount' => count($groupedData),
            'groups'     => []
        ];
        foreach ($groupedData as $groupValue => $groupLayers) {
            $totalSym = 0;
            foreach ($groupLayers as $gl) $totalSym += count($gl['legend'] ?? []);
            $output['groups'][] = [
                'groupValue'  => $groupValue,
                'layerCount'  => count($groupLayers),
                'symbolCount' => $totalSym,
                'layers'      => $groupLayers
            ];
        }
    } else {
        $output = [
            'success'     => true,
            'service'     => $service,
            'symbolSize'  => ['width' => $width, 'height' => $height],
            'layerCount'  => count($filteredLayers),
            'layers'      => $filteredLayers
        ];
    }
    $json = json_encode($output, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    @file_put_contents($cacheFile, $json);
    updateCacheIndex($CACHE_DIR, basename($cacheFile), $service);
    // Auto-Default-Alias: bei Aufruf ohne legendgroup-Parameter sofort cacherbar
    if (!$legendGroupExplicit) {
        @file_put_contents($cacheFileAuto, $json);
        updateCacheIndex($CACHE_DIR, basename($cacheFileAuto), $service);
    }
    sendCachedFile($cacheFile, 'application/json', $CACHE_TTL, 'MISS');
}

// ===== FORMAT: HTML — Legende rendern =====

$serviceName = preg_replace('#/MapServer$#i', '', $service);
$serviceName = str_replace('/', ' &rsaquo; ', $serviceName);

// Statistik berechnen
$totalSymbols = 0;
foreach ($filteredLayers as $layer) {
    $totalSymbols += count($layer['legend'] ?? []);
}

// HTML aufbauen
$html  = '<!DOCTYPE html>' . "\n";
$html .= '<html lang="de">' . "\n";
$html .= '<head>' . "\n";
$html .= '<meta charset="utf-8">' . "\n";
$html .= '<meta name="viewport" content="width=device-width, initial-scale=1">' . "\n";
$html .= '<title>Legende &mdash; ' . htmlspecialchars(strip_tags($serviceName)) . '</title>' . "\n";
$html .= '<style>' . "\n";
$html .= buildLegendCSS($displayWidth, $displayHeight);
$html .= '</style>' . "\n";
$html .= '</head>' . "\n";
$html .= '<body>' . "\n";

// Header
$html .= '<div class="legend-header">' . "\n";
$html .= '  <h1>' . $serviceName . '</h1>' . "\n";
$html .= '  <p class="legend-meta">';
if ($groupedData !== null) {
    $html .= count($groupedData) . ' Gruppen (' . htmlspecialchars($legendGroup) . '), ';
}
$html .= count($filteredLayers) . ' Layer, ' . $totalSymbols . ' Symbole';
$zoomInfo = ($zoom != 1.0) ? ', Zoom ' . $zoom . '&times;' : '';
$html .= ' &mdash; ' . $displayWidth . '&times;' . $displayHeight . 'px, ' . $dpi . ' DPI' . $zoomInfo . '</p>' . "\n";
$html .= '</div>' . "\n";

// Layer rendern
if ($groupedData !== null) {
    foreach ($groupedData as $groupValue => $groupLayers) {
        $groupSymCount = 0;
        foreach ($groupLayers as $gl) $groupSymCount += count($gl['legend'] ?? []);

        $html .= '<details class="legend-group">' . "\n";
        $html .= '  <summary class="legend-group-header"><span class="legend-group-arrow">&blacktriangleright;</span> ' . htmlspecialchars($groupValue);
        $html .= ' <span class="legend-group-count">(' . $groupSymCount . ')</span>';
        $html .= '</summary>' . "\n";
        $html .= '  <div class="legend-group-content">' . "\n";

        foreach ($groupLayers as $layer) {
            $html .= renderLayerLegend($layer, $displayWidth, $displayHeight);
        }

        $html .= '  </div>' . "\n";
        $html .= '</details>' . "\n";
    }
} else {
    foreach ($filteredLayers as $layer) {
        $html .= renderLayerLegend($layer, $displayWidth, $displayHeight);
    }
}

// Footer
$html .= '<div class="legend-footer">' . "\n";
$html .= '  <p>Generiert: ' . date('d.m.Y H:i') . ' &bull; ';
$html .= '<a href="?service=' . urlencode(preg_replace('#/MapServer$#i', '', $service));
$html .= '&amp;format=json&amp;width=' . $width . '&amp;height=' . $height . '&amp;dpi=' . $dpi;
if ($zoom != 1.0) {
    $html .= '&amp;zoom=' . $zoom;
}
if ($layers !== '') {
    $html .= '&amp;layers=' . htmlspecialchars($layers);
}
if ($legendGroup !== '') {
    $html .= '&amp;legendgroup=' . urlencode($legendGroup);
}
$html .= '">JSON-Daten</a></p>' . "\n";
$html .= '</div>' . "\n";

$html .= '</body>' . "\n";
$html .= '</html>';

// Cache schreiben
@file_put_contents($cacheFile, $html);
updateCacheIndex($CACHE_DIR, basename($cacheFile), $service);
// Auto-Default-Alias: bei Aufruf ohne legendgroup-Parameter sofort cacherbar
if (!$legendGroupExplicit) {
    @file_put_contents($cacheFileAuto, $html);
    updateCacheIndex($CACHE_DIR, basename($cacheFileAuto), $service);
}
sendCachedFile($cacheFile, 'text/html', $CACHE_TTL, 'MISS');


// =========================================================================
// METADATA-INJECTION
// =========================================================================

/**
 * Liest das Metadata-Mapping aus einer JSON-Datei.
 * Gibt leeres Array zurück falls Datei fehlt oder ungültig.
 *
 * @param string $file  Absoluter Pfad zur JSON-Datei
 * @return array        Mapping-Array (key => ['title'=>..., 'description'=>..., ...])
 */
function loadMetadataMap($file) {
    if (!file_exists($file)) {
        return [];
    }
    $raw = @file_get_contents($file);
    if ($raw === false || trim($raw) === '') {
        return [];
    }
    $json = json_decode($raw, true);
    return is_array($json) ? $json : [];
}

/**
 * Sucht Metadata-Eintrag für einen ArcGIS-Layer.
 * Zwei-Stufen-Lookup: zuerst service+layer-spezifisch, dann layer-global.
 *
 * Key-Schema (identisch mit WMS-Proxy):
 *   service::<servicePfad>::<layerName>   (z.B. "service::ewn/EWN_NIS/MapServer::Schutzgebiet")
 *   layer::<layerName>                    (z.B. "layer::Schutzgebiet")
 *
 * @param array  $metadataMap  Geladenes Mapping-Array
 * @param string $service      ArcGIS MapServer-Pfad (z.B. "ewn/EWN_NIS/MapServer")
 * @param string $layerName    Layername aus der Legend-Response
 * @return array|null          Metadata-Array oder null wenn kein Treffer
 */
function injectMetadata($metadataMap, $service, $layerName) {
    $keyServiceLayer = 'service::' . trim($service) . '::' . $layerName;
    $keyLayer        = 'layer::' . $layerName;

    if (isset($metadataMap[$keyServiceLayer]) && is_array($metadataMap[$keyServiceLayer])) {
        return $metadataMap[$keyServiceLayer];
    }
    if (isset($metadataMap[$keyLayer]) && is_array($metadataMap[$keyLayer])) {
        return $metadataMap[$keyLayer];
    }
    return null;
}

// =========================================================================
// LABEL-AUFLÖSUNG (#-Labels → Attribut-Lookup)
// =========================================================================

/**
 * Prüft ob ein Layer #-Labels enthält (Legend-Einträge mit "#" als Label).
 *
 * @param array $layer  Layer-Objekt aus der ArcGIS Legend-Response
 * @return bool         true wenn mindestens ein Label "#" enthält
 */
function layerHasHashLabels($layer) {
    foreach ($layer['legend'] ?? [] as $entry) {
        $label = trim($entry['label'] ?? '');
        if ($label === '#' || strpos($label, '#') !== false) {
            return true;
        }
    }
    return false;
}

/**
 * Erstellt eine globale Mapping-Tabelle (Code → Bezeichnung) durch parallele Abfrage aller Layer.
 *
 * Strategie: Alle Layer mit #-Labels werden per curl_multi gleichzeitig abgefragt
 * (groupByFieldsForStatistics). Die Ergebnisse werden in eine einzige flache
 * Lookup-Map zusammengeführt. Bei mehreren Bezeichnungen pro Code wird die
 * längste (= spezifischste) gewählt statt alle zu verketten.
 *
 * Laufzeit: ≈ max(einzelne Query) statt sum(alle Queries), da alle parallel laufen.
 *
 * @param array  $layers      Gefilterte Layer-Liste
 * @param string $service     ArcGIS MapServer-Pfad (inkl. /MapServer)
 * @param string $labelField  Feldname für Bezeichnung (z.B. "Typ_Bezeichnung")
 * @param string $codeField   Feldname für Darstellungscode (z.B. "Typ_Darstellungscode")
 * @param string $agsBase    ArcGIS Basis-URL (z.B. 'https://.../services/')
 * @param string $agsToken   ArcGIS-Token
 * @param string $logFile     Log-Datei-Pfad
 * @return array              Flache Map: code => "Bezeichnung" (service-weit, spezifischste)
 */
function buildLabelLookup($layers, $service, $labelField, $codeField, $agsBase, $agsToken, $logFile) {
    // 1. Alle Layer-IDs mit #-Labels sammeln
    $layerIds = [];
    foreach ($layers as $layer) {
        if (!layerHasHashLabels($layer)) continue;
        $lid = $layer['layerId'] ?? null;
        if ($lid !== null && !in_array($lid, $layerIds)) $layerIds[] = $lid;
    }

    if (empty($layerIds)) return [];

    logMessage($logFile, 'INFO', "Label-Lookup: " . count($layerIds) . " Layer mit #-Labels → parallele Abfrage (curl_multi)");

    // 2. curl_multi — alle Queries gleichzeitig absenden
    $mh = curl_multi_init();
    $handles = [];

    $stats = json_encode([
        ['statisticType' => 'count', 'onStatisticField' => '*', 'outStatisticFieldName' => 'cnt']
    ]);

    foreach ($layerIds as $lid) {
        $url = agsBuildUrl($agsBase, $service . '/' . $lid . '/query', [
            'where'                      => '1=1',
            'groupByFieldsForStatistics' => $codeField . ',' . $labelField,
            'outStatistics'              => $stats,
            'returnGeometry'             => 'false',
            'f'                          => 'pjson',
        ], $agsToken);

        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL            => $url,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 20,
            CURLOPT_SSL_VERIFYPEER => true,
        ]);
        curl_multi_add_handle($mh, $ch);
        $handles[$lid] = $ch;
    }

    // 3. Parallele Ausführung — blockiert bis alle fertig
    $running = null;
    do {
        curl_multi_exec($mh, $running);
        curl_multi_select($mh);
    } while ($running > 0);

    // 4. Ergebnisse aller Layer zusammenführen → Code → {label → true, ...}
    $codeLabels = [];
    $successCount = 0;

    foreach ($handles as $lid => $ch) {
        $response = curl_multi_getcontent($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_multi_remove_handle($mh, $ch);
        curl_close($ch);

        if ($httpCode !== 200 || !$response) {
            logMessage($logFile, 'WARN', "Label-Lookup: HTTP $httpCode | Layer $lid");
            continue;
        }

        $data = json_decode($response, true);
        if (!$data || isset($data['error']) || !isset($data['features'])) {
            $errMsg = $data['error']['message'] ?? 'Kein features-Array';
            logMessage($logFile, 'WARN', "Label-Lookup JSON-Fehler: $errMsg | Layer $lid");
            continue;
        }

        foreach ($data['features'] as $feature) {
            $attrs = $feature['attributes'] ?? [];
            $code  = isset($attrs[$codeField])  ? (string)$attrs[$codeField]  : '';
            $label = isset($attrs[$labelField]) ? trim($attrs[$labelField])   : '';
            if ($code === '' || $label === '') continue;

            if (!isset($codeLabels[$code])) $codeLabels[$code] = [];
            $codeLabels[$code][$label] = true;
        }

        $successCount++;
        logMessage($logFile, 'INFO', "Label-Lookup OK: Layer $lid | " . count($data['features']) . " Gruppen");
    }

    curl_multi_close($mh);

    // 5. Pro Code: mehrere Bezeichnungen → kommasepariert zusammenfassen
    //    z.B. Code "W3a" → "Wohnzone 3-geschossig a, Wohnzonen"
    $lookup = [];
    foreach ($codeLabels as $code => $labels) {
        $names = array_keys($labels);
        if (count($names) === 1) {
            $lookup[$code] = $names[0];
        } else {
            // Längste zuerst (spezifischste), dann kommasepariert
            usort($names, function($a, $b) { return strlen($b) - strlen($a); });
            $lookup[$code] = implode(', ', $names);
        }
    }

    logMessage($logFile, 'INFO', "Label-Lookup (groupBy): $successCount/" . count($layerIds) . " Layer, " . count($lookup) . " Codes aufgelöst");

    // 6. ZWEITER PASS: Renderer-Definitionen (drawingInfo) parallel abrufen
    //    → Enthält ALLE Codes inkl. solcher ohne Features.
    //    Codes die bereits per groupBy gefunden wurden, werden NICHT überschrieben.
    $mh2 = curl_multi_init();
    $handles2 = [];

    foreach ($layerIds as $lid) {
        $url = agsBuildUrl($agsBase, $service . '/' . $lid, ['f' => 'pjson'], $agsToken);

        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL            => $url,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 20,
            CURLOPT_SSL_VERIFYPEER => true,
        ]);
        curl_multi_add_handle($mh2, $ch);
        $handles2[$lid] = $ch;
    }

    $running = null;
    do {
        curl_multi_exec($mh2, $running);
        curl_multi_select($mh2);
    } while ($running > 0);

    $rendererCount = 0;
    foreach ($handles2 as $lid => $ch) {
        $response = curl_multi_getcontent($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_multi_remove_handle($mh2, $ch);
        curl_close($ch);

        if ($httpCode !== 200 || !$response) continue;

        $layerDef = json_decode($response, true);
        if (!$layerDef || !isset($layerDef['drawingInfo']['renderer'])) continue;

        $renderer = $layerDef['drawingInfo']['renderer'];
        $uvis = $renderer['uniqueValueInfos'] ?? [];
        $added = 0;

        foreach ($uvis as $uvi) {
            $val   = (string)($uvi['value'] ?? '');
            $label = (string)($uvi['label'] ?? '');
            if ($val === '' || $label === '') continue;

            // Code bereits durch groupBy aufgelöst → nicht überschreiben
            if (isset($lookup[$val])) continue;

            // Label nach # extrahieren: "CODE#Beschreibung" → "Beschreibung"
            if (strpos($label, '#') !== false) {
                $parts = explode('#', $label, 2);
                $afterHash = trim($parts[1] ?? '');
                if ($afterHash !== '') {
                    $lookup[$val] = $afterHash;
                    $added++;
                }
            } elseif ($label !== $val) {
                // Label ohne # das nicht dem Code entspricht → direkt verwenden
                $lookup[$val] = $label;
                $added++;
            }
        }

        if ($added > 0) {
            $rendererCount += $added;
            logMessage($logFile, 'INFO', "Label-Lookup (Renderer): Layer $lid | $added zusätzliche Codes");
        }
    }

    curl_multi_close($mh2);

    $groupByCount = count($lookup) - $rendererCount;
    logMessage($logFile, 'INFO', "Label-Lookup abgeschlossen: " . count($lookup) . " Codes total (groupBy: $groupByCount + Renderer: $rendererCount)");
    return $lookup;
}

/**
 * Führt einen ArcGIS REST Query aus und gibt das JSON-Array zurück.
 * Gibt null zurück bei HTTP-Fehler oder ArcGIS-Error.
 *
 * @param string $url       Volle Query-URL
 * @param string $logFile   Log-Datei
 * @param int    $layerId   Layer-ID (für Log)
 * @return array|null       Decodiertes JSON oder null bei Fehler
 */
function _fetchQueryJson($url, $logFile, $layerId) {
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL            => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_SSL_VERIFYPEER => false,
    ]);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode !== 200 || !$response) {
        logMessage($logFile, 'WARN', "Label-Lookup fehlgeschlagen: HTTP $httpCode | Layer $layerId");
        return null;
    }

    $data = json_decode($response, true);
    if (!$data || isset($data['error']) || !isset($data['features'])) {
        $errMsg = $data['error']['message'] ?? 'Kein features-Array';
        logMessage($logFile, 'WARN', "Label-Lookup JSON-Fehler: $errMsg | Layer $layerId");
        return null;
    }

    return $data;
}

/**
 * Ersetzt #-Labels in den Legend-Einträgen durch lesbare Bezeichnungen.
 *
 * Nur Einträge mit einem Treffer in der Lookup-Tabelle (groupBy oder Renderer)
 * werden aufgelöst. Einträge ohne Lookup-Treffer werden aus der Legende entfernt,
 * da sie keine spezifische Bezeichnung haben und nur generische Kategorie-Labels
 * (z.B. "Wohnzonen") anzeigen würden.
 *
 * Die Legend-values[0] wird als Code interpretiert und gegen die Lookup-Map gematcht.
 *
 * @param array  $layers      Gefilterte Layer-Liste
 * @param string $service     ArcGIS MapServer-Pfad
 * @param string $labelField  Feldname für Bezeichnung
 * @param string $codeField   Feldname für Darstellungscode
 * @param string $agsBase    ArcGIS Basis-URL
 * @param string $agsToken   ArcGIS-Token
 * @param string $logFile     Log-Datei-Pfad
 * @return array              Layer-Liste mit aufgelösten Labels
 */
function resolveHashLabels($layers, $service, $labelField, $codeField, $agsBase, $agsToken, $logFile) {
    // Globale Mapping-Tabelle laden (groupBy + Renderer)
    $lookup = buildLabelLookup($layers, $service, $labelField, $codeField, $agsBase, $agsToken, $logFile);

    $removedCount = 0;

    foreach ($layers as &$layer) {
        if (!layerHasHashLabels($layer)) continue;

        $layerId = $layer['layerId'] ?? null;
        if ($layerId === null) continue;

        // Labels ersetzen oder Eintrag zum Entfernen markieren
        foreach ($layer['legend'] as $idx => &$entry) {
            $label = trim($entry['label'] ?? '');
            if ($label !== '#' && strpos($label, '#') === false) continue;

            // Code aus values-Array holen (ArcGIS Renderer-Wert)
            $code = '';
            if (isset($entry['values']) && is_array($entry['values']) && count($entry['values']) > 0) {
                $code = (string)$entry['values'][0];
            }

            // Lookup-Tabelle: Treffer → spezifische Bezeichnung verwenden
            if ($code !== '' && !empty($lookup) && isset($lookup[$code])) {
                $entry['label'] = $lookup[$code];
                $entry['_resolvedFrom'] = '#:lookup';
                continue;
            }

            // Kein Lookup-Treffer → Eintrag zum Entfernen markieren
            $entry['_remove'] = true;
            $removedCount++;
        }
        unset($entry);

        // Markierte Einträge entfernen und Array neu indizieren
        $layer['legend'] = array_values(array_filter($layer['legend'], function($e) {
            return empty($e['_remove']);
        }));
    }
    unset($layer);

    if ($removedCount > 0) {
        logMessage($logFile, 'INFO', "Label-Resolve: $removedCount Einträge ohne Lookup entfernt");
    }

    return $layers;
}

// =========================================================================
// GRUPPIERUNG (legendgroup — Einträge nach Feld gruppieren)
// =========================================================================

/**
 * Erstellt eine Mapping-Tabelle: Layer-ID → { Code → [Gruppen-Werte] }
 *
 * Für Layer mit #-Labels wird per groupByFieldsForStatistics(codeField, groupField)
 * ermittelt, welche Codes in welchen Gruppen (z.B. Gemeinden) vorkommen.
 * Für Layer ohne #-Labels wird nur groupField abgefragt (Layer-Level-Zuordnung).
 *
 * @param array  $layers      Gefilterte Layer-Liste
 * @param string $service     ArcGIS MapServer-Pfad
 * @param string $codeField   Feldname für Darstellungscode
 * @param string $groupField  Feldname für Gruppierung (z.B. "Gemeinde")
 * @param string $agsBase    ArcGIS Basis-URL
 * @param string $agsToken   ArcGIS-Token
 * @param string $logFile     Log-Datei-Pfad
 * @return array              ['mapping' => [layerId => [code => [groups]]], 'groups' => [sortierte Werte]]
 */
function buildGroupMapping($layers, $service, $codeField, $groupField, $agsBase, $agsToken, $logFile) {
    $mh = curl_multi_init();
    $handles = [];

    $stats = json_encode([
        ['statisticType' => 'count', 'onStatisticField' => '*', 'outStatisticFieldName' => 'cnt']
    ]);

    foreach ($layers as $layer) {
        $lid = $layer['layerId'] ?? null;
        if ($lid === null) continue;

        // Prüfen ob Layer Code-basierte Einträge hat (values-Array mit Inhalt).
        // NICHT layerHasHashLabels() verwenden — nach resolve=true sind # bereits weg.
        $hasCodes = false;
        foreach ($layer['legend'] ?? [] as $entry) {
            if (isset($entry['values']) && is_array($entry['values']) && count($entry['values']) > 0) {
                $hasCodes = true;
                break;
            }
        }
        $groupByFields = $hasCodes
            ? $codeField . ',' . $groupField
            : $groupField;

        $url = agsBuildUrl($agsBase, $service . '/' . $lid . '/query', [
            'where'                      => '1=1',
            'groupByFieldsForStatistics' => $groupByFields,
            'outStatistics'              => $stats,
            'returnGeometry'             => 'false',
            'f'                          => 'pjson',
        ], $agsToken);

        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL            => $url,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 20,
            CURLOPT_SSL_VERIFYPEER => true,
        ]);
        curl_multi_add_handle($mh, $ch);
        $handles[$lid] = ['ch' => $ch, 'hasCodes' => $hasCodes];
    }

    // Parallele Ausführung
    $running = null;
    do {
        curl_multi_exec($mh, $running);
        curl_multi_select($mh);
    } while ($running > 0);

    // Ergebnisse auswerten
    // mapping: layerId => { code => [group1, group2, ...] }
    // Für Layer ohne Codes: layerId => { '_all' => [group1, group2, ...] }
    $mapping   = [];
    $allGroups = [];

    foreach ($handles as $lid => $info) {
        $ch       = $info['ch'];
        $hasCodes = $info['hasCodes'];
        $response = curl_multi_getcontent($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_multi_remove_handle($mh, $ch);
        curl_close($ch);

        if ($httpCode !== 200 || !$response) {
            logMessage($logFile, 'WARN', "Group-Mapping: HTTP $httpCode | Layer $lid");
            continue;
        }

        $data = json_decode($response, true);
        if (!$data || isset($data['error']) || !isset($data['features'])) {
            $errMsg = $data['error']['message'] ?? 'Kein features-Array';
            logMessage($logFile, 'WARN', "Group-Mapping Fehler: $errMsg | Layer $lid");
            continue;
        }

        $mapping[$lid] = [];
        foreach ($data['features'] as $feature) {
            $attrs = $feature['attributes'] ?? [];
            $group = isset($attrs[$groupField]) ? trim((string)$attrs[$groupField]) : '';
            if ($group === '') continue;

            $allGroups[$group] = true;

            if ($hasCodes) {
                $code = isset($attrs[$codeField]) ? (string)$attrs[$codeField] : '';
                if ($code === '') continue;
                if (!isset($mapping[$lid][$code])) $mapping[$lid][$code] = [];
                if (!in_array($group, $mapping[$lid][$code])) {
                    $mapping[$lid][$code][] = $group;
                }
            } else {
                // Layer-Level-Zuordnung (kein Code)
                if (!isset($mapping[$lid]['_all'])) $mapping[$lid]['_all'] = [];
                if (!in_array($group, $mapping[$lid]['_all'])) {
                    $mapping[$lid]['_all'][] = $group;
                }
            }
        }

        logMessage($logFile, 'INFO', "Group-Mapping OK: Layer $lid | " . count($data['features']) . " Gruppen-Einträge");
    }

    curl_multi_close($mh);

    // Gruppen alphabetisch sortieren
    $sortedGroups = array_keys($allGroups);
    sort($sortedGroups);

    logMessage($logFile, 'INFO', "Group-Mapping: " . count($sortedGroups) . " Gruppen gefunden" . ($sortedGroups ? ': ' . implode(', ', $sortedGroups) : ''));

    return ['mapping' => $mapping, 'groups' => $sortedGroups];
}

/**
 * Führt alle benötigten ArcGIS-Hilfsabfragen in EINEM curl_multi-Batch aus.
 *
 * Kombiniert in einer einzigen parallelen Runde:
 *   1. groupBy(codeField, labelField)  — für Label-Lookup (#-Labels)
 *   2. Layer-Definition (Renderer)     — Codes ohne Features ergänzen
 *   3. groupBy(codeField, groupField)  — Gruppen-Mapping (z.B. Gemeinde)
 *
 * Statt 3 serieller curl_multi-Runden reicht eine → spart 2 Netzwerk-Round-Trips.
 *
 * @param array  $layers        Gefilterte Layer-Liste (Rohdaten, noch unresolved)
 * @param string $service       ArcGIS MapServer-Pfad
 * @param string $labelField    Feldname Bezeichnung
 * @param string $codeField     Feldname Darstellungscode
 * @param string $groupField    Feldname Gruppierung (leer = kein Gruppen-Mapping)
 * @param bool   $resolveLabels Ob #-Labels aufgelöst werden sollen
 * @param string $agsBase       ArcGIS Basis-URL
 * @param string $agsToken      ArcGIS-Token
 * @param string $logFile       Log-Datei
 * @return array                ['lookup' => [...], 'groupMapping' => ['mapping' => [...], 'groups' => [...]]]
 */
function fetchLegendAuxData($layers, $service, $labelField, $codeField, $groupField, $resolveLabels, $agsBase, $agsToken, $logFile,
                            $tokenUrl = '', $tokenUser = '', $tokenPass = '', $tokenCache = '', $tokenSkew = 60) {
    $mh        = curl_multi_init();
    $handles   = [];   // key: 'label_N', 'renderer_N', 'group_N'
    $layerMeta = [];   // lid => ['hasHash' => bool, 'hasCodes' => bool]

    $stats = json_encode([
        ['statisticType' => 'count', 'onStatisticField' => '*', 'outStatisticFieldName' => 'cnt']
    ]);

    foreach ($layers as $layer) {
        $lid = $layer['layerId'] ?? null;
        if ($lid === null) continue;

        $hasHash  = $resolveLabels && layerHasHashLabels($layer);
        $hasCodes = false;
        foreach ($layer['legend'] ?? [] as $entry) {
            if (isset($entry['values']) && is_array($entry['values']) && count($entry['values']) > 0) {
                $hasCodes = true;
                break;
            }
        }
        $layerMeta[$lid] = ['hasHash' => $hasHash, 'hasCodes' => $hasCodes];

        // Request 1: groupBy(codeField, labelField) — Label-Lookup
        if ($hasHash) {
            $url = agsBuildUrl($agsBase, $service . '/' . $lid . '/query', [
                'where'                      => '1=1',
                'groupByFieldsForStatistics' => $codeField . ',' . $labelField,
                'outStatistics'              => $stats,
                'returnGeometry'             => 'false',
                'f'                          => 'pjson',
            ], $agsToken);
            $ch = curl_init();
            curl_setopt_array($ch, [CURLOPT_URL => $url, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20, CURLOPT_SSL_VERIFYPEER => true]);
            curl_multi_add_handle($mh, $ch);
            $handles['label_' . $lid] = $ch;
        }

        // Request 2: Layer-Definition (Renderer) — Codes ohne aktive Features ergänzen
        if ($hasHash) {
            $url = agsBuildUrl($agsBase, $service . '/' . $lid, ['f' => 'pjson'], $agsToken);
            $ch = curl_init();
            curl_setopt_array($ch, [CURLOPT_URL => $url, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20, CURLOPT_SSL_VERIFYPEER => true]);
            curl_multi_add_handle($mh, $ch);
            $handles['renderer_' . $lid] = $ch;
        }

        // Request 3: groupBy(codeField/groupField) — Gruppen-Mapping
        if ($groupField !== '') {
            $groupByFields = $hasCodes
                ? $codeField . ',' . $groupField
                : $groupField;
            $url = agsBuildUrl($agsBase, $service . '/' . $lid . '/query', [
                'where'                      => '1=1',
                'groupByFieldsForStatistics' => $groupByFields,
                'outStatistics'              => $stats,
                'returnGeometry'             => 'false',
                'f'                          => 'pjson',
            ], $agsToken);
            $ch = curl_init();
            curl_setopt_array($ch, [CURLOPT_URL => $url, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20, CURLOPT_SSL_VERIFYPEER => true]);
            curl_multi_add_handle($mh, $ch);
            $handles['group_' . $lid] = $ch;
        }
    }

    // Alle Requests gleichzeitig ausführen
    $totalReq  = count($handles);
    if ($totalReq === 0) {
        curl_multi_close($mh);
        return ['lookup' => [], 'groupMapping' => ['mapping' => [], 'groups' => []], 'token' => $agsToken];
    }

    $hashCount  = count(array_filter($layerMeta, function($m) { return $m['hasHash'];  }));
    $grpCount   = $groupField !== '' ? count($layerMeta) : 0;
    logMessage($logFile, 'INFO', "Aux-Fetch: $totalReq parallele Requests ($hashCount×2 Label/Renderer + $grpCount Gruppen-Mapping)");

    $running = null;
    do {
        curl_multi_exec($mh, $running);
        curl_multi_select($mh);
    } while ($running > 0);

    // Alle Inhalte lesen bevor Handles geschlossen werden
    $contents  = [];
    $httpCodes = [];
    foreach ($handles as $key => $ch) {
        $contents[$key]  = curl_multi_getcontent($ch);
        $httpCodes[$key] = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_multi_remove_handle($mh, $ch);
        curl_close($ch);
    }
    curl_multi_close($mh);

    // Token-Fehler in einem der Responses? → Cache leeren + ganzen Batch einmal wiederholen
    $tokenRefreshed = false;
    if ($tokenUrl !== '' && $tokenCache !== '') {
        foreach ($contents as $key => $body) {
            if (empty($body)) continue;
            $decoded = json_decode($body, true);
            if ($decoded && agsIsTokenError($decoded)) {
                $errCode = $decoded['error']['code'] ?? 0;
                logMessage($logFile, 'WARN', "Aux-Fetch Token-Fehler ($errCode, $key) — Cache leeren + Retry");
                $agsToken = agsForceRefreshToken($tokenUrl, $tokenUser, $tokenPass, $tokenCache, $tokenSkew);
                $tokenRefreshed = true;
                break;
            }
        }
    }

    if ($tokenRefreshed) {
        // Sämtliche Handles neu aufbauen mit frischem Token
        $mh2     = curl_multi_init();
        $handles = [];
        foreach ($layerMeta as $lid => $meta) {
            if ($meta['hasHash']) {
                $url = agsBuildUrl($agsBase, $service . '/' . $lid . '/query', [
                    'where' => '1=1', 'groupByFieldsForStatistics' => $codeField . ',' . $labelField,
                    'outStatistics' => $stats, 'returnGeometry' => 'false', 'f' => 'pjson',
                ], $agsToken);
                $ch = curl_init();
                curl_setopt_array($ch, [CURLOPT_URL => $url, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20, CURLOPT_SSL_VERIFYPEER => true]);
                curl_multi_add_handle($mh2, $ch);
                $handles['label_' . $lid] = $ch;

                $url = agsBuildUrl($agsBase, $service . '/' . $lid, ['f' => 'pjson'], $agsToken);
                $ch = curl_init();
                curl_setopt_array($ch, [CURLOPT_URL => $url, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20, CURLOPT_SSL_VERIFYPEER => true]);
                curl_multi_add_handle($mh2, $ch);
                $handles['renderer_' . $lid] = $ch;
            }
            if ($groupField !== '') {
                $groupByFields = $meta['hasCodes'] ? $codeField . ',' . $groupField : $groupField;
                $url = agsBuildUrl($agsBase, $service . '/' . $lid . '/query', [
                    'where' => '1=1', 'groupByFieldsForStatistics' => $groupByFields,
                    'outStatistics' => $stats, 'returnGeometry' => 'false', 'f' => 'pjson',
                ], $agsToken);
                $ch = curl_init();
                curl_setopt_array($ch, [CURLOPT_URL => $url, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20, CURLOPT_SSL_VERIFYPEER => true]);
                curl_multi_add_handle($mh2, $ch);
                $handles['group_' . $lid] = $ch;
            }
        }
        $running = null;
        do { curl_multi_exec($mh2, $running); curl_multi_select($mh2); } while ($running > 0);
        $contents  = [];
        $httpCodes = [];
        foreach ($handles as $key => $ch) {
            $contents[$key]  = curl_multi_getcontent($ch);
            $httpCodes[$key] = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_multi_remove_handle($mh2, $ch);
            curl_close($ch);
        }
        curl_multi_close($mh2);
        logMessage($logFile, 'INFO', "Aux-Fetch Retry abgeschlossen (" . count($handles) . " Requests)");
    }


    $codeLabels = [];
    foreach ($layerMeta as $lid => $meta) {
        if (!$meta['hasHash']) continue;
        $key = 'label_' . $lid;
        if (($httpCodes[$key] ?? 0) !== 200 || empty($contents[$key])) continue;
        $data = json_decode($contents[$key], true);
        if (!$data || isset($data['error']) || !isset($data['features'])) continue;
        foreach ($data['features'] as $feature) {
            $attrs = $feature['attributes'] ?? [];
            $code  = isset($attrs[$codeField])  ? (string)$attrs[$codeField]  : '';
            $label = isset($attrs[$labelField]) ? trim($attrs[$labelField])   : '';
            if ($code === '' || $label === '') continue;
            if (!isset($codeLabels[$code])) $codeLabels[$code] = [];
            $codeLabels[$code][$label] = true;
        }
    }
    $lookup = [];
    foreach ($codeLabels as $code => $labels) {
        $names = array_keys($labels);
        usort($names, function($a, $b) { return strlen($b) - strlen($a); });
        $lookup[$code] = implode(', ', $names);
    }

    // ===== Label-Lookup ergänzen (Pass 2: Renderer) =====
    $rendererAdded = 0;
    foreach ($layerMeta as $lid => $meta) {
        if (!$meta['hasHash']) continue;
        $key = 'renderer_' . $lid;
        if (($httpCodes[$key] ?? 0) !== 200 || empty($contents[$key])) continue;
        $layerDef = json_decode($contents[$key], true);
        if (!$layerDef || !isset($layerDef['drawingInfo']['renderer'])) continue;
        $uvis = $layerDef['drawingInfo']['renderer']['uniqueValueInfos'] ?? [];
        foreach ($uvis as $uvi) {
            $val   = (string)($uvi['value'] ?? '');
            $label = (string)($uvi['label'] ?? '');
            if ($val === '' || $label === '' || isset($lookup[$val])) continue;
            if (strpos($label, '#') !== false) {
                $parts = explode('#', $label, 2);
                $afterHash = trim($parts[1] ?? '');
                if ($afterHash !== '') { $lookup[$val] = $afterHash; $rendererAdded++; }
            } elseif ($label !== $val) {
                $lookup[$val] = $label;
                $rendererAdded++;
            }
        }
    }
    logMessage($logFile, 'INFO', "Label-Lookup: " . count($lookup) . " Codes (" . (count($lookup) - $rendererAdded) . " groupBy + $rendererAdded Renderer)");

    // ===== Gruppen-Mapping aufbauen =====
    $mapping   = [];
    $allGroups = [];
    if ($groupField !== '') {
        foreach ($layerMeta as $lid => $meta) {
            $key = 'group_' . $lid;
            if (($httpCodes[$key] ?? 0) !== 200 || empty($contents[$key])) {
                logMessage($logFile, 'WARN', "Group-Mapping: HTTP " . ($httpCodes[$key] ?? 0) . " | Layer $lid");
                continue;
            }
            $data = json_decode($contents[$key], true);
            if (!$data || isset($data['error']) || !isset($data['features'])) {
                $errMsg = $data['error']['message'] ?? 'Kein features-Array';
                logMessage($logFile, 'WARN', "Group-Mapping Fehler: $errMsg | Layer $lid");
                continue;
            }
            $hasCodes    = $meta['hasCodes'];
            $mapping[$lid] = [];
            foreach ($data['features'] as $feature) {
                $attrs = $feature['attributes'] ?? [];
                $group = isset($attrs[$groupField]) ? trim((string)$attrs[$groupField]) : '';
                if ($group === '') continue;
                $allGroups[$group] = true;
                if ($hasCodes) {
                    $code = isset($attrs[$codeField]) ? (string)$attrs[$codeField] : '';
                    if ($code === '') continue;
                    if (!isset($mapping[$lid][$code])) $mapping[$lid][$code] = [];
                    if (!in_array($group, $mapping[$lid][$code])) $mapping[$lid][$code][] = $group;
                } else {
                    if (!isset($mapping[$lid]['_all'])) $mapping[$lid]['_all'] = [];
                    if (!in_array($group, $mapping[$lid]['_all'])) $mapping[$lid]['_all'][] = $group;
                }
            }
            logMessage($logFile, 'INFO', "Group-Mapping OK: Layer $lid | " . count($data['features']) . " Gruppen-Einträge");
        }
        $sortedGroups = array_keys($allGroups);
        sort($sortedGroups);
        logMessage($logFile, 'INFO', "Group-Mapping: " . count($sortedGroups) . " Gruppen" . ($sortedGroups ? ': ' . implode(', ', $sortedGroups) : ''));
    } else {
        $sortedGroups = [];
    }

    return [
        'lookup'       => $lookup,
        'groupMapping' => ['mapping' => $mapping, 'groups' => $sortedGroups],
        'token'        => $agsToken,  // evtl. erneuerter Token nach Retry
    ];
}

/**
 * Ersetzt #-Labels in den Legend-Einträgen anhand einer vorberechneten Lookup-Map.
 * Einträge ohne Lookup-Treffer werden entfernt.
 *
 * @param array  $layers  Gefilterte Layer-Liste
 * @param array  $lookup  Code → Bezeichnung
 * @param string $logFile Log-Datei
 * @return array          Layer-Liste mit aufgelösten Labels
 */
function applyLabelLookup($layers, $lookup, $logFile) {
    $removedCount = 0;
    foreach ($layers as &$layer) {
        if (!layerHasHashLabels($layer)) continue;
        foreach ($layer['legend'] as $idx => &$entry) {
            $label = trim($entry['label'] ?? '');
            if ($label !== '#' && strpos($label, '#') === false) continue;
            $code = '';
            if (isset($entry['values']) && is_array($entry['values']) && count($entry['values']) > 0) {
                $code = (string)$entry['values'][0];
            }
            if ($code !== '' && isset($lookup[$code])) {
                $entry['label']          = $lookup[$code];
                $entry['_resolvedFrom']  = '#:lookup';
            } else {
                $entry['_remove'] = true;
                $removedCount++;
            }
        }
        unset($entry);
        $layer['legend'] = array_values(array_filter($layer['legend'], function($e) {
            return empty($e['_remove']);
        }));
    }
    unset($layer);
    if ($removedCount > 0) {
        logMessage($logFile, 'INFO', "Label-Resolve: $removedCount Einträge ohne Lookup entfernt");
    }
    return $layers;
}

/**
 * Gruppiert die Layer-Daten nach Feld-Werten.
 *
 * Für jeden Gruppen-Wert (z.B. jede Gemeinde) wird eine gefilterte Kopie
 * der Layer erstellt, die nur die Legend-Einträge enthält, deren Codes
 * in dieser Gruppe vorkommen.
 *
 * @param array $layers       Gefilterte Layer-Liste (mit aufgelösten Labels)
 * @param array $groupMapping Ergebnis von buildGroupMapping()
 * @return array|null         Assoziatives Array: groupValue => [layers], oder null
 */
function groupLayersByField($layers, $groupMapping) {
    $mapping = $groupMapping['mapping'];
    $groups  = $groupMapping['groups'];

    if (empty($groups)) return null;

    $result = [];

    foreach ($groups as $group) {
        $groupLayers = [];

        foreach ($layers as $layer) {
            $lid = $layer['layerId'] ?? null;
            if ($lid === null) continue;

            if (!isset($mapping[$lid])) {
                // Layer nicht abgefragt oder Fehler → in alle Gruppen aufnehmen
                $groupLayers[] = $layer;
                continue;
            }

            $layerMap = $mapping[$lid];

            // Layer ohne Codes: _all Mapping prüfen
            if (isset($layerMap['_all'])) {
                if (in_array($group, $layerMap['_all'])) {
                    $groupLayers[] = $layer;
                }
                continue;
            }

            // Layer mit Codes: einzelne Legend-Einträge filtern
            $filteredEntries = [];
            foreach ($layer['legend'] as $entry) {
                $code = '';
                if (isset($entry['values']) && is_array($entry['values']) && count($entry['values']) > 0) {
                    $code = (string)$entry['values'][0];
                }

                if ($code !== '' && isset($layerMap[$code]) && in_array($group, $layerMap[$code])) {
                    $filteredEntries[] = $entry;
                } elseif ($code === '') {
                    // Eintrag ohne Code → aufnehmen wenn Layer überhaupt in Gruppe vorkommt
                    $filteredEntries[] = $entry;
                }
            }

            if (!empty($filteredEntries)) {
                $groupLayer = $layer;
                $groupLayer['legend'] = $filteredEntries;
                $groupLayers[] = $groupLayer;
            }
        }

        if (!empty($groupLayers)) {
            $result[$group] = $groupLayers;
        }
    }

    return empty($result) ? null : $result;
}

// =========================================================================
// RENDER-FUNKTIONEN
// =========================================================================

/**
 * Rendert die Legende eines einzelnen Layers als HTML-Block.
 *
 * Einzel-Symbol-Layer: kompakte Inline-Darstellung (Symbol + Layername).
 * Multi-Symbol-Layer: Layername als Überschrift, dann Symbol-Grid.
 *
 * @param array $layer  Layer-Objekt aus der ArcGIS Legend-Response
 * @param int   $width  Gewünschte Symbolbreite (px)
 * @param int   $height Gewünschte Symbolhöhe (px)
 * @return string       HTML-Fragment
 */
function renderLayerLegend($layer, $width, $height) {
    $layerName = htmlspecialchars($layer['layerName'] ?? ('Layer ' . ($layer['layerId'] ?? '?')));
    $layerId   = $layer['layerId'] ?? '?';
    $legends   = $layer['legend'] ?? [];

    if (empty($legends)) {
        return ''; // Keine Symbole → nichts rendern
    }

    $out = '<div class="legend-layer" data-layer-id="' . $layerId . '">' . "\n";

    $isSingleSymbol = (count($legends) === 1);

    if ($isSingleSymbol) {
        // Kompakt: Symbol + Layername in einer Zeile
        $entry  = $legends[0];
        $imgSrc = buildImageSrc($entry);
        $label  = trim($entry['label'] ?? '');

        $out .= '  <div class="legend-single">' . "\n";
        $out .= '    <img src="' . $imgSrc . '" alt="Symbol">' . "\n";
        $out .= '    <span class="legend-layer-name">' . $layerName;
        if ($label !== '' && $label !== strip_tags($layerName)) {
            $out .= ' <span class="legend-sub-label">(' . htmlspecialchars($label) . ')</span>';
        }
        $out .= '</span>' . "\n";
        $out .= '  </div>' . "\n";
    } else {
        // Multi-Symbol: Layername als Überschrift, dann Grid
        $out .= '  <div class="legend-layer-header">' . $layerName;
        $out .= ' <span class="legend-count">(' . count($legends) . ')</span>';
        $out .= '</div>' . "\n";
        $out .= '  <div class="legend-grid">' . "\n";

        foreach ($legends as $entry) {
            $imgSrc = buildImageSrc($entry);
            $label  = htmlspecialchars(trim($entry['label'] ?? ''));

            $out .= '    <div class="legend-entry">' . "\n";
            $out .= '      <img src="' . $imgSrc . '" alt="' . $label . '">' . "\n";
            if ($label !== '') {
                $out .= '      <span class="legend-label">' . $label . '</span>' . "\n";
            }
            $out .= '    </div>' . "\n";
        }

        $out .= '  </div>' . "\n";
    }

    // Metadata-Block (falls aus legend_wms_metadata.json injiziert)
    if (!empty($layer['metadata']) && is_array($layer['metadata'])) {
        $out .= '  <div class="legend-metadata">' . "\n";
        if (isset($layer['metadata']['title'])) {
            $out .= '    <span class="legend-meta-title">' . htmlspecialchars((string)$layer['metadata']['title']) . '</span>' . "\n";
        }
        if (isset($layer['metadata']['description'])) {
            $out .= '    <span class="legend-meta-desc">' . htmlspecialchars((string)$layer['metadata']['description']) . '</span>' . "\n";
        }
        $out .= '  </div>' . "\n";
    }

    $out .= '</div>' . "\n";
    return $out;
}

/**
 * Baut eine Base64 Data-URI aus dem Legend-Eintrag.
 *
 * @param array $entry  Einzelner Legend-Eintrag mit imageData + contentType
 * @return string       Data-URI (z.B. "data:image/png;base64,iVBOR...")
 */
function buildImageSrc($entry) {
    $imageData   = $entry['imageData'] ?? '';
    $contentType = $entry['contentType'] ?? 'image/png';

    if ($imageData !== '') {
        return 'data:' . $contentType . ';base64,' . $imageData;
    }
    // Fallback: Transparentes 1×1 PNG
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQIW2NgAAIAAAUAAR4f7BQAAAAASUVORK5CYII=';
}

/**
 * Generiert eingebettetes CSS für die Legenden-Darstellung.
 *
 * Responsives Layout: Einzel-Symbole inline, Multi-Symbole als flex-Grid.
 * Farben basieren auf --m-color-primary (#4B7B81).
 *
 * @param int $width  Symbolbreite (px)
 * @param int $height Symbolhöhe (px)
 * @return string     CSS-Text
 */
function buildLegendCSS($width, $height) {
    // Mindestbreite für Grid-Einträge (Symbol + Label nebeneinander)
    $css = <<<CSS
/* Legenden-Proxy — generiertes CSS */
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
    font-family: 'Segoe UI', 'Lucida Grande', Verdana, Helvetica, Arial, sans-serif;
    font-size: 12px;
    color: #333;
    background: #fff;
    padding: 10px;
    max-width: 960px;
    margin: 0 auto;
    line-height: 1.3;
}

/* ===== HEADER ===== */
.legend-header {
    border-bottom: 2px solid #4B7B81;
    padding-bottom: 6px;
    margin-bottom: 10px;
}
.legend-header h1 {
    font-size: 14px;
    font-weight: 600;
    color: #4B7B81;
    letter-spacing: -0.3px;
}
.legend-meta {
    font-size: 11px;
    color: #888;
    margin-top: 4px;
}

/* ===== LAYER-BLOCK ===== */
.legend-layer {
    margin-bottom: 5px;
    padding-bottom: 4px;
    border-bottom: 1px solid #eee;
}
.legend-layer:last-child {
    border-bottom: none;
}

/* Layer-Überschrift (Multi-Symbol) */
.legend-layer-header {
    font-size: 12px;
    font-weight: 600;
    color: #555;
    margin-bottom: 3px;
    padding-left: 2px;
}
.legend-count {
    font-weight: 400;
    color: #aaa;
    font-size: 11px;
}

/* ===== EINZEL-SYMBOL (kompakt) ===== */
.legend-single {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 1px 0;
}
.legend-single img {
    flex-shrink: 0;
    image-rendering: auto;
    width: {$width}px;
    height: {$height}px;
    object-fit: contain;
}
.legend-layer-name {
    font-weight: 500;
    font-size: 12px;
}
.legend-sub-label {
    font-weight: 400;
    color: #888;
    font-size: 12px;
}

/* ===== MULTI-SYMBOL GRID ===== */
.legend-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1px 12px;
    padding-left: 4px;
}
@media (min-width: 900px) {
    .legend-grid { grid-template-columns: 1fr 1fr 1fr; }
}
.legend-entry {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 1px 0;
}
.legend-entry img {
    flex-shrink: 0;
    image-rendering: auto;
    width: {$width}px;
    height: {$height}px;
    object-fit: contain;
}
.legend-label {
    font-size: 12px;
    color: #444;
    line-height: 1.3;
    word-break: break-word;
}

/* ===== GRUPPIERUNG ===== */
.legend-group {
    margin-bottom: 14px;
    border: 1px solid #c5cdce;
    border-radius: 5px;
    overflow: hidden;
    background: #fff;
}
.legend-group:last-child {
    margin-bottom: 0;
}

/* Summary-Zeile (Klick-Header) */
.legend-group-header {
    display: flex;
    align-items: center;
    font-size: 15px;
    font-weight: 800;
    color: #333;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    padding: 10px 14px;
    background: #e4eaeb;
    cursor: pointer;
    list-style: none;
    user-select: none;
    border-bottom: none;
    transition: background 0.15s ease;
}
.legend-group-header:hover {
    background: #d6dfe0;
}
.legend-group-header::-webkit-details-marker {
    display: none;
}
.legend-group-header::marker {
    content: '';
    display: none;
}

/* Pfeil-Indikator */
.legend-group-arrow {
    display: inline-block;
    margin-right: 8px;
    font-size: 12px;
    color: #4B7B81;
    transition: transform 0.2s ease;
    line-height: 1;
}
.legend-group[open] > .legend-group-header .legend-group-arrow {
    transform: rotate(90deg);
}

/* Offener Zustand: Trennlinie unter Header */
.legend-group[open] > .legend-group-header {
    border-bottom: 3px solid #4B7B81;
}

/* Inhalt-Container */
.legend-group-content {
    padding: 8px 12px 6px;
}

.legend-group-count {
    font-weight: 400;
    color: #888;
    font-size: 12px;
    text-transform: none;
    letter-spacing: 0;
    margin-left: auto;
}
.legend-group .legend-layer {
    margin-bottom: 3px;
    padding-bottom: 3px;
}
.legend-group .legend-layer:last-child {
    border-bottom: none;
    margin-bottom: 0;
    padding-bottom: 0;
}

/* ===== FOOTER ===== */
.legend-footer {
    margin-top: 20px;
    padding-top: 8px;
    border-top: 1px solid #ddd;
    font-size: 10px;
    color: #aaa;
}
.legend-footer a {
    color: #4B7B81;
    text-decoration: none;
}
.legend-footer a:hover {
    text-decoration: underline;
}

/* ===== METADATA-INJECTION ===== */
.legend-metadata {
    margin-top: 5px;
    padding: 4px 7px;
    background: #f0f5f5;
    border-left: 3px solid #4B7B81;
    border-radius: 0 4px 4px 0;
    font-size: 11px;
    color: #555;
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.legend-meta-title {
    font-weight: 600;
    color: #4B7B81;
}
.legend-meta-desc {
    color: #666;
}

/* ===== RESPONSIVE ===== */
@media (max-width: 600px) {
    body { padding: 6px; }
    .legend-grid { grid-template-columns: 1fr; gap: 1px; }
}

/* ===== PRINT ===== */
@media print {
    body { padding: 0; max-width: none; }
    .legend-header { border-color: #000; }
    .legend-header h1 { color: #000; }
    .legend-footer { display: none; }
}
CSS;
    return $css;
}
