<?php
/**
 * active-maps-proxy.php
 * Proxy für die gis-daten.ch Kartenseite mit CSS/JS Injection
 * 
 * Lädt die Frontpage von www.gis-daten.ch/?active-map={nw|ow} und:
 * - Entfernt Header und Sidebar serverseitig
 * - Injiziert CSS/JS für Button-Interaktion und Layout
 * 
 * Hinweis: Läuft auf demselben Server (gis-daten.ch), daher ist
 * der Fetch ein Loopback-Request. cURL wird verwendet um
 * Timeout/Redirect-Probleme zu vermeiden.
 * 
 * @version    3.0
 * @date       2026-02-13
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

// CORS Header
header('Access-Control-Allow-Origin: *');
header('Content-Type: text/html; charset=utf-8');

// Get parameters
$group = isset($_GET['group']) ? sanitize($_GET['group']) : 'nw';
$activeMap = ($group === 'ow' || strpos($group, 'ow') === 0) ? 'ow' : 'nw';

// Korrekte URL: /?active-map={nw|ow} (nicht /nw/pub/)
$externalUrl = 'https://www.gis-daten.ch/?active-map=' . $activeMap;
if ($group !== 'nw' && $group !== 'ow' && $group !== 'none') {
    $externalUrl .= '&group=' . urlencode($group);
}

// Eigene Basis-URL für absolute Pfade der injizierten Assets
$scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
$selfBase = $scheme . '://' . $_SERVER['HTTP_HOST'];

error_log('Proxy v3: Lade ' . $externalUrl);

// =========================================================
// Content laden via cURL (robuster als file_get_contents für Loopback)
// =========================================================
$content = fetchContent($externalUrl);

if ($content === false) {
    http_response_code(502);
    echo '<!DOCTYPE html><html><body>';
    echo '<h1>Fehler beim Laden der Kartenseite</h1>';
    echo '<p>URL: ' . htmlspecialchars($externalUrl) . '</p>';
    echo '<p>Bitte prüfen Sie die Server-Logs für Details.</p>';
    echo '</body></html>';
    error_log('Proxy Error: Konnte nicht laden: ' . $externalUrl);
    exit;
}

error_log('Proxy v3: Content geladen, Länge: ' . strlen($content));

// =========================================================
// 1. Server-seitige Entfernung: <header class="site-header">
//    Zuverlässiger als CSS-Override gegen WordPress-Spezifität
// =========================================================
$content = preg_replace(
    '/<header[^>]*class="[^"]*site-header[^"]*"[^>]*>.*?<\/header>/si',
    '<!-- header removed by proxy -->',
    $content
);

// =========================================================
// 2. Server-seitige Entfernung: Sidebar
//    Entfernt das überlagernde Sidebar-Element komplett
//    Greedy match für verschachtelte divs
// =========================================================
$content = preg_replace(
    '/<div[^>]*class="[^"]*cdt-frontpage-maps-sidebar[^"]*"[^>]*>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/si',
    '<!-- sidebar removed by proxy -->',
    $content
);

// =========================================================
// 3. CSS/JS Injection
//    Pfade sind absolut (gleicher Server, aber sicherheitshalber)
// =========================================================

// Inline-Style als sofortiger Fallback
$inlineStyle = '<style id="proxy-inline-overrides">
  header.site-header, .cdt-frontpage-maps-sidebar { display:none!important; height:0!important; overflow:hidden!important; }
  .cdt-frontpage-maps-header { z-index:999999!important; position:relative!important; }
  .cdt-frontpage-maps-header-buttons { z-index:999999!important; position:relative!important; pointer-events:auto!important; }
  .cdt-frontpage-maps-header-buttons button { z-index:999999!important; position:relative!important; pointer-events:auto!important; cursor:pointer!important; }
  body, main { padding-top:0!important; margin-top:0!important; }
</style>';

// Externes CSS + JS
$cssInjection = '<link rel="stylesheet" href="/maps/tnet/css/proxy-overrides.css?v=' . time() . '">';
$jsInjection = '<script src="/maps/tnet/js/proxy-button-handler.js?v=' . time() . '"></script>';

// Injiziere vor </head>
$injection = "\n" . $inlineStyle . "\n" . $cssInjection . "\n" . $jsInjection . "\n";

if (strpos($content, '</head>') !== false) {
    $content = str_replace('</head>', $injection . '</head>', $content);
} else {
    $pattern = '/(<body[^>]*>)/i';
    $content = preg_replace($pattern, '$1' . $injection, $content);
}

// =========================================================
// Output
// =========================================================
echo $content;

// =========================================================
// Hilfsfunktionen
// =========================================================
function sanitize($str) {
    return preg_replace('/[^a-z0-9_-]/i', '', $str);
}

function fetchContent($url) {
    // Bevorzuge cURL (robuster für Loopback-Requests)
    if (function_exists('curl_init')) {
        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL => $url,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 5,
            CURLOPT_TIMEOUT => 15,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_USERAGENT => 'Mozilla/5.0 (compatible; MapProxy/3.0)',
            CURLOPT_SSL_VERIFYPEER => false, // Loopback, SSL nicht nötig
        ]);
        $result = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);
        
        if ($result === false || $httpCode >= 400) {
            error_log('Proxy cURL Error: HTTP ' . $httpCode . ', Error: ' . $error . ', URL: ' . $url);
            return false;
        }
        error_log('Proxy cURL: HTTP ' . $httpCode . ', Länge: ' . strlen($result));
        return $result;
    }
    
    // Fallback: file_get_contents
    $context = stream_context_create([
        'http' => [
            'timeout' => 15,
            'user_agent' => 'Mozilla/5.0 (compatible; MapProxy/3.0)',
            'follow_location' => true,
        ],
        'ssl' => ['verify_peer' => false, 'verify_peer_name' => false],
    ]);
    return @file_get_contents($url, false, $context);
}
?>
