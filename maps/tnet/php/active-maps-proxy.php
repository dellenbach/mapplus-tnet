<?php
/**
 * active-maps-proxy.php
 * Proxy für externe Kartenseiten mit CSS/JS Injection
 * 
 * Lädt Inhalte von www.gis-daten.ch und:
 * - Setzt <base> Tag für korrekte Ressourcen-URLs
 * - Entfernt Header und Sidebar serverseitig
 * - Injiziert CSS/JS für Button-Interaktion
 * 
 * @version    2.0
 * @date       2026-02-13
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

// CORS Header
header('Access-Control-Allow-Origin: *');
header('Content-Type: text/html; charset=utf-8');

// Get parameters
$group = isset($_GET['group']) ? sanitize($_GET['group']) : 'nw';
$mapType = ($group === 'ow') ? 'ow' : 'nw';

// Konstruiere die externe URL
$externalUrl = 'https://www.gis-daten.ch/' . $mapType . '/pub/?group=' . urlencode($group);

// Eigene Basis-URL für absolute Pfade der injizierten Assets
$scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
$selfBase = $scheme . '://' . $_SERVER['HTTP_HOST'];

error_log('Proxy v2: Lade ' . $externalUrl);

// Lade externen Content
$context = stream_context_create([
    'http' => [
        'timeout' => 10,
        'user_agent' => 'Mozilla/5.0 (compatible; MapProxy/2.0)'
    ]
]);
$content = @file_get_contents($externalUrl, false, $context);

if ($content === false) {
    http_response_code(502);
    echo '<h1>Fehler beim Laden der Kartenseite</h1>';
    echo '<p>Die externe Kartenseite konnte nicht geladen werden.</p>';
    error_log('Proxy Error: Konnte nicht laden: ' . $externalUrl);
    exit;
}

// =========================================================
// 1. <base> Tag einfügen (MUSS als erstes im <head> stehen)
//    Damit alle relativen URLs der externen Seite korrekt laden
// =========================================================
$baseTag = '<base href="https://www.gis-daten.ch/">';
$content = preg_replace('/(<head[^>]*>)/i', '$1' . "\n" . $baseTag, $content, 1);

// =========================================================
// 2. Server-seitige Entfernung: <header class="site-header">
//    Zuverlässiger als CSS-Override gegen WordPress-Spezifität
// =========================================================
$content = preg_replace(
    '/<header[^>]*class="[^"]*site-header[^"]*"[^>]*>.*?<\/header>/si',
    '<!-- header removed by proxy -->',
    $content
);

// =========================================================
// 3. Server-seitige Entfernung: Sidebar
//    Entfernt das überlagernde Sidebar-Element komplett
// =========================================================
$content = preg_replace(
    '/<div[^>]*class="[^"]*cdt-frontpage-maps-sidebar[^"]*"[^>]*>.*?<\/div>\s*<\/div>/si',
    '<!-- sidebar removed by proxy -->',
    $content
);

// =========================================================
// 4. CSS/JS Injection (mit absoluten Pfaden wegen <base>!)
// =========================================================

// Inline-Style als sofortiger Fallback (greift vor externem CSS)
$inlineStyle = '<style id="proxy-inline-overrides">
  header.site-header, .cdt-frontpage-maps-sidebar { display:none!important; height:0!important; overflow:hidden!important; }
  .cdt-frontpage-maps-header { z-index:999999!important; position:relative!important; }
  .cdt-frontpage-maps-header-buttons { z-index:999999!important; position:relative!important; pointer-events:auto!important; }
  .cdt-frontpage-maps-header-buttons button { z-index:999999!important; position:relative!important; pointer-events:auto!important; cursor:pointer!important; }
  body, main { padding-top:0!important; margin-top:0!important; }
</style>';

// Externes CSS (absolute URL wegen <base>!)
$cssInjection = '<link rel="stylesheet" href="' . $selfBase . '/maps/tnet/css/proxy-overrides.css?v=' . time() . '">';

// Externes JS (absolute URL wegen <base>!)
$jsInjection = '<script src="' . $selfBase . '/maps/tnet/js/proxy-button-handler.js?v=' . time() . '"></script>';

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
?>
