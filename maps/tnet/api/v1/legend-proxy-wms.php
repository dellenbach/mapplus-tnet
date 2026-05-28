<?php
/**
 * legend-proxy-wms.php
 * Legenden-Proxy fuer QGIS/WMS (GetLegendGraphic) mit optionaler Metadata-Injection.
 *
 * - Holt Legendengrafiken fuer einen oder mehrere WMS-Layer
 * - Rendert HTML oder JSON
 * - Bettet Bilder als Base64 ein (stabile Anzeige ohne Folge-Requests)
 * - Nutzt 24h Cache mit ETag + gzip
 * - Erlaubt spaeteres Metadata-Injection pro Layer via Mapping-Datei
 *
 * Parameter:
 *   service      (string, PFLICHT)
 *                WMS-Basispfad (ohne Query), z.B. /qmap/test/kulturobjekte_nw_pg
 *                oder absolute URL (http/https).
 *
 *   layers       (string, optional)
 *                Komma-separierte Layernamen, z.B. Kulturobjekte Flaeche,Kulturobjekte Linien
 *
 *   layer        (string, optional)
 *                Einzelner Layername (Komfort-Alias).
 *
 *   width        (int, default: 32, min: 8, max: 512)
 *   height       (int, default: 24, min: 8, max: 512)
 *   symbolwidth  (float, default: 12) — QGIS-Vendor: Breite des Symbol-Icons in mm
 *   symbolheight (float, default: 3)  — QGIS-Vendor: Höhe des Symbol-Icons in mm
 *   style        (string, default: default)
 *   version      (string, default: 1.3.0)
 *   sld_version  (string, default: 1.1.0)
 *   format       (string, default: html) -> html|json
 *   inject       (bool, default: true)  -> 1/0, true/false
 *   debug        (bool, default: false) -> 1/0, true/false — zeigt Service-Info und GetLegendGraphic-URLs
 *   nocache      (string, default: 0)   -> 1 = Cache umgehen
 *
 * Metadata-Injection:
 *   Optionales Mapping aus /core/config/legend_wms_metadata.json
 *   Strukturbeispiele:
 *   {
 *     "service::/qmap/test/kulturobjekte_nw_pg::Kulturobjekte Flaeche": {"title": "..."},
 *     "layer::Kulturobjekte Flaeche": {"title": "..."}
 *   }
 *
 * @version    1.0
 * @date       2026-03-31
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

// ===== KONFIGURATION =====

require_once __DIR__ . '/../includes/CorePaths.php';

$CACHE_DIR = '/data/Client_Data/nwow/tmp/maps-dev/legends_wms';
$CACHE_TTL = 86400;
$DEFAULT_WIDTH = 32;
$DEFAULT_HEIGHT = 24;
$DEFAULT_SYMBOLWIDTH = 14;
$DEFAULT_SYMBOLHEIGHT = 2;
$DEFAULT_STYLE = 'default';
$DEFAULT_VERSION = '1.3.0';
$DEFAULT_SLD_VERSION = '1.1.0';
$DEFAULT_INJECT = true;
$MAX_LAYERS = 80;

// Optionales Metadata-Mapping (falls vorhanden)
$METADATA_FILE = TnetCorePaths::resolveConfigFile('legend_wms_metadata.json');

// ===== CORS & PRE-FLIGHT =====

require_once __DIR__ . '/../includes/CorsHelper.php';
CorsHelper::handlePreflight();
CorsHelper::setHeaders();

// ===== HILFSFUNKTIONEN =====

function jsonResponse($data, $code = 200) {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function htmlResponse($html, $code = 200) {
    http_response_code($code);
    header('Content-Type: text/html; charset=utf-8');
    echo $html;
    exit;
}

function errorResponse($msg, $code = 400, $format = 'html') {
    if ($format === 'json') {
        jsonResponse(['success' => false, 'error' => $msg], $code);
    }

    $html = '<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">';
    $html .= '<meta name="viewport" content="width=device-width, initial-scale=1">';
    $html .= '<title>WMS-Legende Fehler</title>';
    $html .= '<style>body{font-family:Segoe UI,Arial,sans-serif;margin:20px;color:#222;}';
    $html .= '.err{padding:12px 14px;border:1px solid #eab8b8;background:#fff2f2;border-radius:8px;}</style>';
    $html .= '</head><body><div class="err"><strong>Fehler:</strong> ' . htmlspecialchars($msg) . '</div></body></html>';
    htmlResponse($html, $code);
}

function sendCachedFile($file, $ctype, $ttl, $xCache) {
    $content = file_get_contents($file);
    $etag = '"' . md5($content) . '"';
    $mtime = filemtime($file);

    header('Cache-Control: public, max-age=' . $ttl);
    header('Last-Modified: ' . gmdate('D, d M Y H:i:s', $mtime) . ' GMT');
    header('ETag: ' . $etag);
    header('X-Legend-Cache: ' . $xCache);

    $ifNoneMatch = $_SERVER['HTTP_IF_NONE_MATCH'] ?? '';
    if ($ifNoneMatch === $etag) {
        http_response_code(304);
        exit;
    }

    header('Content-Type: ' . $ctype . '; charset=utf-8');

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

function parseBoolParam($value, $default = false) {
    if ($value === null || $value === '') {
        return $default;
    }
    $v = strtolower(trim((string) $value));
    if ($v === '1' || $v === 'true' || $v === 'yes' || $v === 'on') {
        return true;
    }
    if ($v === '0' || $v === 'false' || $v === 'no' || $v === 'off') {
        return false;
    }
    return $default;
}

function normalizeServiceUrl($serviceRaw) {
    $service = trim((string) $serviceRaw);
    if ($service === '') {
        return '';
    }

    // Absolute URL erlauben
    if (preg_match('#^https?://#i', $service)) {
        return $service;
    }

    // Relative Pfade auf gleicher Domain erlauben
    if ($service[0] !== '/') {
        $service = '/' . $service;
    }

    if (!preg_match('#^/qmap/[a-zA-Z0-9_\-/\.]+$#', $service)) {
        return '';
    }

    $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'www.gis-daten.ch';
    return $scheme . '://' . $host . $service;
}

function splitLayers($layersRaw, $layerRaw, $maxLayers) {
    $result = [];

    if (trim((string) $layersRaw) !== '') {
        $parts = explode(',', (string) $layersRaw);
        foreach ($parts as $part) {
            $name = trim($part);
            if ($name !== '') {
                $result[] = $name;
            }
        }
    }

    if (trim((string) $layerRaw) !== '') {
        $result[] = trim((string) $layerRaw);
    }

    // dedupe, Reihenfolge erhalten
    $uniq = [];
    $seen = [];
    foreach ($result as $name) {
        if (!isset($seen[$name])) {
            $uniq[] = $name;
            $seen[$name] = true;
        }
    }

    if (count($uniq) > $maxLayers) {
        $uniq = array_slice($uniq, 0, $maxLayers);
    }

    return $uniq;
}

function buildLegendUrl($serviceUrl, $layerName, $width, $height, $symbolWidth, $symbolHeight, $style, $version, $sldVersion) {
    $params = [
        'SERVICE' => 'WMS',
        'VERSION' => $version,
        'REQUEST' => 'GetLegendGraphic',
        'LAYER' => $layerName,
        'FORMAT' => 'image/png',
        'STYLE' => $style,
        'SLD_VERSION' => $sldVersion
    ];

    // WIDTH/HEIGHT nur senden wenn explizit per URL-Parameter gesetzt
    // QGIS Server verwendet sonst eigene Defaults pro Geometrietyp
    if (isset($_GET['width'])) {
        $params['WIDTH'] = $width;
    }
    if (isset($_GET['height'])) {
        $params['HEIGHT'] = $height;
    }

    // QGIS-Vendor-Parameter: Symbol-Icon-Grösse in mm
    // Nur senden wenn explizit gesetzt — beeinflusst alle Geometrietypen
    if (isset($_GET['symbolwidth'])) {
        $params['SYMBOLWIDTH'] = $symbolWidth;
    }
    if (isset($_GET['symbolheight'])) {
        $params['SYMBOLHEIGHT'] = $symbolHeight;
    }

    return rtrim($serviceUrl, '?') . '?' . http_build_query($params);
}

function loadMetadataMap($file) {
    if (!$file || !file_exists($file)) {
        return [];
    }

    $raw = file_get_contents($file);
    if ($raw === false || trim($raw) === '') {
        return [];
    }

    $json = json_decode($raw, true);
    return is_array($json) ? $json : [];
}

function injectMetadata($metadataMap, $serviceRaw, $layerName) {
    $serviceNorm = trim((string) $serviceRaw);
    $keyServiceLayer = 'service::' . $serviceNorm . '::' . $layerName;
    $keyLayer = 'layer::' . $layerName;

    if (isset($metadataMap[$keyServiceLayer]) && is_array($metadataMap[$keyServiceLayer])) {
        return $metadataMap[$keyServiceLayer];
    }

    if (isset($metadataMap[$keyLayer]) && is_array($metadataMap[$keyLayer])) {
        return $metadataMap[$keyLayer];
    }

    return null;
}

function fetchLegendImage($url) {
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_HTTPHEADER => ['Accept: image/png,image/*;q=0.8,*/*;q=0.5']
    ]);

    $body = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    $curlError = curl_error($ch);
    curl_close($ch);

    return [
        'ok' => ($curlError === '' && $httpCode === 200 && $body !== false),
        'error' => $curlError,
        'httpCode' => $httpCode,
        'contentType' => $contentType,
        'body' => $body
    ];
}

function buildCss() {
    return "
body { margin: 16px; font-family: Segoe UI, Arial, sans-serif; color: #1f2933; background: #f7fafc; }
h1 { margin: 0 0 8px; font-size: 20px; }
.meta { margin: 0 0 16px; color: #52606d; font-size: 13px; }
.legend-list { display: grid; gap: 10px; }
.legend-item { background: #fff; border: none; border-radius: 8px; padding: 10px; }
.legend-row { display: flex; align-items: center; gap: 10px; }
.legend-img { display: inline-flex; border: none; border-radius: 4px; background: #fff; padding: 0; min-height: 24px; }
.debug-info { margin: 0 0 12px; padding: 6px 10px; background: #fff44f; font-size: 12px; border-radius: 4px; }
.debug-info code { background: #fff44f; padding: 1px 4px; border-radius: 4px; word-break: break-all; }
.legend-img img { display: block; max-width: 100%; height: auto; }
.legend-title { font-weight: 600; }
.legend-sub { margin-top: 6px; font-size: 12px; color: #52606d; }
.legend-sub code { background: #f0f4f8; padding: 1px 4px; border-radius: 4px; }
.warn { color: #9f2d2d; }
";
}

// ===== PARAMETER LESEN =====

$serviceRaw = isset($_GET['service']) ? trim($_GET['service']) : '';
$layersRaw = isset($_GET['layers']) ? (string) $_GET['layers'] : '';
$layerRaw = isset($_GET['layer']) ? (string) $_GET['layer'] : '';
$width = isset($_GET['width']) ? max(8, min(512, intval($_GET['width']))) : $DEFAULT_WIDTH;
$height = isset($_GET['height']) ? max(8, min(512, intval($_GET['height']))) : $DEFAULT_HEIGHT;
$symbolWidth = isset($_GET['symbolwidth']) ? max(1, min(50, floatval($_GET['symbolwidth']))) : $DEFAULT_SYMBOLWIDTH;
$symbolHeight = isset($_GET['symbolheight']) ? max(1, min(50, floatval($_GET['symbolheight']))) : $DEFAULT_SYMBOLHEIGHT;
$style = isset($_GET['style']) ? trim((string) $_GET['style']) : $DEFAULT_STYLE;
$version = isset($_GET['version']) ? trim((string) $_GET['version']) : $DEFAULT_VERSION;
$sldVersion = isset($_GET['sld_version']) ? trim((string) $_GET['sld_version']) : $DEFAULT_SLD_VERSION;
$format = (isset($_GET['format']) && strtolower(trim((string) $_GET['format'])) === 'json') ? 'json' : 'html';
$inject = parseBoolParam($_GET['inject'] ?? null, $DEFAULT_INJECT);
$debug = parseBoolParam($_GET['debug'] ?? null, false);
$noCache = isset($_GET['nocache']) && (string) $_GET['nocache'] === '1';

if ($serviceRaw === '') {
    errorResponse('Parameter "service" fehlt. Beispiel: ?service=/qmap/test/kulturobjekte_nw_pg&layers=Kulturobjekte%20Flaeche', 400, $format);
}

$serviceUrl = normalizeServiceUrl($serviceRaw);
if ($serviceUrl === '') {
    errorResponse('Ungueltiger service-Pfad. Erlaubt: /qmap/... oder absolute http(s)-URL.', 400, $format);
}

$layers = splitLayers($layersRaw, $layerRaw, $MAX_LAYERS);
if (count($layers) === 0) {
    errorResponse('Kein Layer angegeben. Bitte "layers" oder "layer" setzen.', 400, $format);
}

if (!preg_match('#^[0-9]+(\.[0-9]+)*$#', $version)) {
    errorResponse('Ungueltige WMS-Version: ' . $version, 400, $format);
}

if (!preg_match('#^[0-9]+(\.[0-9]+)*$#', $sldVersion)) {
    errorResponse('Ungueltige SLD-Version: ' . $sldVersion, 400, $format);
}

if (!preg_match('#^[a-zA-Z0-9_\-]*$#', $style)) {
    errorResponse('Ungueltiger style-Parameter.', 400, $format);
}

// ===== CACHE =====

if (!is_dir($CACHE_DIR)) {
    @mkdir($CACHE_DIR, 0775, true);
}

$cacheKey = md5(json_encode([
    'service' => $serviceRaw,
    'layers' => $layers,
    'width' => $width,
    'height' => $height,
    'style' => $style,
    'version' => $version,
    'sld_version' => $sldVersion,
    'format' => $format,
    'inject' => $inject,
    'debug' => $debug
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

$cacheExt = ($format === 'json') ? '.json' : '.html';
$cacheFile = $CACHE_DIR . '/' . $cacheKey . $cacheExt;

if (!$noCache && file_exists($cacheFile) && (time() - filemtime($cacheFile)) < $CACHE_TTL) {
    $ctype = ($format === 'json') ? 'application/json' : 'text/html';
    sendCachedFile($cacheFile, $ctype, $CACHE_TTL, 'HIT');
}

// ===== LEGENDEN HOLEN =====

$metadataMap = $inject ? loadMetadataMap($METADATA_FILE) : [];
$entries = [];
$errors = [];

foreach ($layers as $layerName) {
    $legendUrl = buildLegendUrl($serviceUrl, $layerName, $width, $height, $symbolWidth, $symbolHeight, $style, $version, $sldVersion);
    $res = fetchLegendImage($legendUrl);

    if (!$res['ok']) {
        $errors[] = [
            'layer' => $layerName,
            'legendUrl' => $legendUrl,
            'httpCode' => $res['httpCode'],
            'error' => ($res['error'] !== '' ? $res['error'] : 'WMS antwortete nicht mit HTTP 200')
        ];
        continue;
    }

    $mime = 'image/png';
    if (is_string($res['contentType']) && stripos($res['contentType'], 'image/') === 0) {
        $mime = trim(explode(';', $res['contentType'])[0]);
    }

    $base64 = base64_encode($res['body']);
    $entry = [
        'layer' => $layerName,
        'legendUrl' => $legendUrl,
        'imageMime' => $mime,
        'imageBase64' => $base64,
        'imageDataUrl' => 'data:' . $mime . ';base64,' . $base64
    ];

    if ($inject) {
        $meta = injectMetadata($metadataMap, $serviceRaw, $layerName);
        if ($meta !== null) {
            $entry['metadata'] = $meta;
        }
    }

    $entries[] = $entry;
}

if (count($entries) === 0) {
    $msg = 'Keine WMS-Legende abrufbar. Layer pruefen oder GetLegendGraphic am Service testen.';
    if ($format === 'json') {
        jsonResponse([
            'success' => false,
            'message' => $msg,
            'service' => $serviceRaw,
            'errors' => $errors
        ], 502);
    }
    errorResponse($msg, 502, $format);
}

// ===== AUSGABE: JSON =====

if ($format === 'json') {
    $output = [
        'success' => true,
        'service' => $serviceRaw,
        'serviceUrl' => $serviceUrl,
        'legendRequest' => [
            'service' => 'WMS',
            'request' => 'GetLegendGraphic',
            'version' => $version,
            'sld_version' => $sldVersion,
            'style' => $style,
            'width' => $width,
            'height' => $height,
            'symbolwidth' => $symbolWidth,
            'symbolheight' => $symbolHeight
        ],
        'layerCount' => count($entries),
        'layers' => $entries,
        'errors' => $errors
    ];

    $json = json_encode($output, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    @file_put_contents($cacheFile, $json);
    sendCachedFile($cacheFile, 'application/json', $CACHE_TTL, 'MISS');
}

// ===== AUSGABE: HTML =====

$html = '<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">';
$html .= '<meta name="viewport" content="width=device-width, initial-scale=1">';
$html .= '<title>Legende</title>';
$html .= '<style>' . buildCss() . '</style>';
$html .= '</head><body>';
$html .= '<h1>Legende</h1>';
if ($debug) {
    $html .= '<p class="debug-info">Service: ' . htmlspecialchars($serviceRaw) . ' | Layer: ' . count($entries);
    if (count($errors) > 0) {
        $html .= ' | Warnungen: ' . count($errors);
    }
    $html .= '</p>';
}

$html .= '<div class="legend-list">';
foreach ($entries as $entry) {
    $html .= '<div class="legend-item">';
    $html .= '  <div class="legend-row">';
    $html .= '    <span class="legend-img"><img alt="' . htmlspecialchars($entry['layer']) . '" src="' . $entry['imageDataUrl'] . '"></span>';
    $html .= '    <span class="legend-title">' . htmlspecialchars($entry['layer']) . '</span>';
    $html .= '  </div>';
    if ($debug) {
        $html .= '  <div class="debug-info">GetLegendGraphic: <code>' . htmlspecialchars($entry['legendUrl']) . '</code></div>';
        if (isset($entry['metadata']) && is_array($entry['metadata'])) {
            $metaJson = json_encode($entry['metadata'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            $html .= '  <div class="debug-info">Metadata: <code>' . htmlspecialchars($metaJson) . '</code></div>';
        }
    }

    $html .= '</div>';
}
$html .= '</div>';

if (count($errors) > 0) {
    $html .= '<h2>Warnungen</h2>';
    foreach ($errors as $err) {
        $html .= '<div class="legend-sub warn">Layer ' . htmlspecialchars($err['layer']) . ': HTTP ' . intval($err['httpCode']) . ' - ' . htmlspecialchars($err['error']) . '</div>';
    }
}

$html .= '</body></html>';

@file_put_contents($cacheFile, $html);
sendCachedFile($cacheFile, 'text/html', $CACHE_TTL, 'MISS');
