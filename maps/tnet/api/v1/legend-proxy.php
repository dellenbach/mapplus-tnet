<?php
/**
 * legend-proxy.php
 * Legenden-Proxy für ArcGIS Server — rendert formatierte HTML-Legenden
 * mit konfigurierbarer Symbolgrösse aus dem ArcGIS REST Legend-Endpunkt.
 *
 * Holt Legend-JSON via agsproxy.php (Token-Management inklusive),
 * rendert kompaktes, selbstständiges HTML mit eingebetteten Base64-Bildern.
 *
 * Parameter:
 *   service  — ArcGIS MapServer-Pfad (z.B. "ewn/EWN_NIS/MapServer")
 *   width    — Symbolbreite in px (default: 80)
 *   height   — Symbolhöhe in px (default: 50)
 *   dpi      — DPI für ArcGIS-Rendering (default: 192). Höherer DPI = dickere Linien/Punkte.
 *              Symbolgrössen sind in pt definiert, höherer DPI = mehr px pro pt = kräftigere Symbole.
 *              96 = ArcGIS-Standard (dünn), 192 = 2× dicker, 288 = 3× dicker
 *   zoom     — Zusätzliche CSS-Vergrösserung der Anzeige (default: 1.0, z.B. 1.5 oder 2.0)
 *   layers   — Komma-separierte Layer-IDs zum Filtern (optional)
 *   nocache  — Cache umgehen (1 = ja)
 *   format   — Ausgabeformat: "html" (default) oder "json"
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
 *
 * @version    1.0
 * @date       2026-02-28
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

// ===== KONFIGURATION =====

$CACHE_DIR    = '/data/Client_Data/nwow/tmp/legends';
$CACHE_TTL    = 86400;   // 24 Stunden in Sekunden
$LOG_FILE     = '/data/Client_Data/nwow/tmp/legend-proxy.log';
$DEFAULT_WIDTH  = 16;
$DEFAULT_HEIGHT = 10;
$DEFAULT_DPI    = 288;    // 3× DPI: kräftige Linien/Punkte
$DEFAULT_ZOOM   = 3;      // 3× CSS-Vergrösserung → Anzeige 48×30px

// ===== CORS & HEADERS =====

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
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

// ===== PARAMETER LESEN =====

$service = isset($_GET['service']) ? trim($_GET['service']) : '';
$width   = isset($_GET['width'])   ? max(8, min(512, intval($_GET['width'])))  : $DEFAULT_WIDTH;
$height  = isset($_GET['height'])  ? max(8, min(512, intval($_GET['height']))) : $DEFAULT_HEIGHT;
$dpi     = isset($_GET['dpi'])     ? max(72, min(600, intval($_GET['dpi'])))   : $DEFAULT_DPI;
$zoom    = isset($_GET['zoom'])    ? max(0.5, min(5, floatval($_GET['zoom']))) : $DEFAULT_ZOOM;
$layers  = isset($_GET['layers'])  ? trim($_GET['layers']) : '';
$noCache = isset($_GET['nocache']) && $_GET['nocache'] === '1';
$format  = (isset($_GET['format']) && $_GET['format'] === 'json') ? 'json' : 'html';

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

// ===== CACHE PRÜFEN =====

$cacheKey  = md5($service . '|' . $width . 'x' . $height . '|d' . $dpi . '|z' . $zoom . '|' . $layers);
$cacheExt  = ($format === 'json') ? '.json' : '.html';
$cacheFile = $CACHE_DIR . '/' . $cacheKey . $cacheExt;

if (!$noCache && file_exists($cacheFile) && (time() - filemtime($cacheFile)) < $CACHE_TTL) {
    // Cache-Hit
    if ($format === 'json') {
        header('Content-Type: application/json; charset=utf-8');
    } else {
        header('Content-Type: text/html; charset=utf-8');
    }
    header('X-Legend-Cache: HIT');
    readfile($cacheFile);
    exit;
}

// ===== LEGEND-JSON VON AGSPROXY HOLEN =====

// Cache-Verzeichnis erstellen
if (!is_dir($CACHE_DIR)) {
    @mkdir($CACHE_DIR, 0775, true);
}

// Proxy-URL aufbauen (Server-interner Aufruf an agsproxy.php)
$scheme   = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
$host     = $_SERVER['HTTP_HOST'] ?? 'www.gis-daten.ch';
$queryParams = [
    'path' => $service . '/legend',
    'f'    => 'pjson',
    'size' => $width . ',' . $height,
    'dpi'  => $dpi
];
$proxyUrl = $scheme . '://' . $host . '/maps/agsproxy.php?' . http_build_query($queryParams);

logMessage($LOG_FILE, 'INFO', "Fetch: $proxyUrl | Service: $service | Size: {$width}x{$height} | DPI: {$dpi} | Zoom: {$zoom}x | Display: {$displayWidth}x{$displayHeight}");

// cURL Request an den Proxy
$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL            => $proxyUrl,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 30,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_HTTPHEADER     => [
        'Accept: application/json',
        'User-Agent: LegendProxy/1.0'
    ]
]);

$response  = curl_exec($ch);
$httpCode  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
curl_close($ch);

if ($curlError) {
    logMessage($LOG_FILE, 'ERROR', "cURL Fehler: $curlError | URL: $proxyUrl");
    errorResponse('Verbindungsfehler zum ArcGIS-Proxy: ' . $curlError, 502, $format);
}

if ($httpCode !== 200) {
    logMessage($LOG_FILE, 'ERROR', "HTTP $httpCode von Proxy | URL: $proxyUrl");
    errorResponse("ArcGIS-Proxy liefert HTTP $httpCode", 502, $format);
}

// JSON parsen
$legendData = json_decode($response, true);
if (!$legendData || isset($legendData['error'])) {
    $errMsg = isset($legendData['error']['message']) ? $legendData['error']['message'] : 'Ungültiges JSON';
    logMessage($LOG_FILE, 'ERROR', "Legend-JSON Fehler: $errMsg | Service: $service");
    errorResponse('ArcGIS Legend-Fehler: ' . $errMsg, 502, $format);
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

// ===== FORMAT: JSON — Roh-Daten durchreichen =====

if ($format === 'json') {
    $output = [
        'success'     => true,
        'service'     => $service,
        'symbolSize'  => ['width' => $width, 'height' => $height],
        'layerCount'  => count($filteredLayers),
        'layers'      => $filteredLayers
    ];
    $json = json_encode($output, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    @file_put_contents($cacheFile, $json);
    header('X-Legend-Cache: MISS');
    jsonResponse($output);
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
$html .= '  <p class="legend-meta">' . count($filteredLayers) . ' Layer, ' . $totalSymbols . ' Symbole';
$zoomInfo = ($zoom != 1.0) ? ', Zoom ' . $zoom . '&times;' : '';
$html .= ' &mdash; ' . $displayWidth . '&times;' . $displayHeight . 'px, ' . $dpi . ' DPI' . $zoomInfo . '</p>' . "\n";
$html .= '</div>' . "\n";

// Layer rendern
foreach ($filteredLayers as $layer) {
    $html .= renderLayerLegend($layer, $displayWidth, $displayHeight);
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
$html .= '">JSON-Daten</a></p>' . "\n";
$html .= '</div>' . "\n";

$html .= '</body>' . "\n";
$html .= '</html>';

// Cache schreiben
@file_put_contents($cacheFile, $html);
header('X-Legend-Cache: MISS');
htmlResponse($html);


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
