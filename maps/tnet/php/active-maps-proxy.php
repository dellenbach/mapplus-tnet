<?php
/**
 * active-maps-proxy.php
 * Proxy für die gis-daten.ch Kartenseite
 *
 * Lädt die Frontpage von www.gis-daten.ch/?active-map={nw|ow} und:
 * - Entfernt den Site-Header serverseitig (preg_replace)
 * - Injiziert tnet-mapplus-helpers.js (Bookmark-Funktionen)
 * - Injiziert tnet-proxy-inject.js  (Auto-Init: Links, Buttons)
 * - Leitet Browser-Cookies an gis-daten.ch weiter (SSO pass-through)
 * - SSO Auto-Login: Klickt WP-Login-Button wenn mapplus-Session existiert
 *
 * Läuft auf demselben Server (Loopback). cURL für Robustheit.
 *
 * @version    4.2
 * @date       2026-02-13
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

// Session starten um mapplus-Login zu prüfen
// Muss gleiche Session-Config wie index.php verwenden (SameSite, Secure, Path)
session_set_cookie_params([
    'lifetime' => 0,
    'path' => '/',
    'domain' => '',
    'secure' => true,
    'httponly' => false,
    'samesite' => 'None'
]);
session_start();

error_log('Proxy: Session-ID=' . session_id() . ', OIDC_CLAIM_group=' . ($_SESSION['OIDC_CLAIM_group'] ?? 'LEER') . ', app_username=' . ($_SESSION['app_username'] ?? 'LEER'));

header('Access-Control-Allow-Origin: *');
header('Content-Type: text/html; charset=utf-8');

// --- Parameter ---
$group = isset($_GET['group']) ? sanitize($_GET['group']) : 'nw';
$activeMap = ($group === 'ow' || strpos($group, 'ow') === 0) ? 'ow' : 'nw';

$externalUrl = 'https://www.gis-daten.ch/?active-map=' . $activeMap;
if ($group !== 'nw' && $group !== 'ow' && $group !== 'none') {
    $externalUrl .= '&group=' . urlencode($group);
}

error_log('Proxy v4: Lade ' . $externalUrl);

// --- Content laden ---
$content = fetchContent($externalUrl);

if ($content === false) {
    http_response_code(502);
    echo '<!DOCTYPE html><html><body>';
    echo '<h1>Fehler beim Laden der Kartenseite</h1>';
    echo '<p>URL: ' . htmlspecialchars($externalUrl) . '</p>';
    echo '</body></html>';
    error_log('Proxy Error: ' . $externalUrl);
    exit;
}

error_log('Proxy v4: Content geladen, Länge: ' . strlen($content));

// --- Header entfernen (server-seitig, zuverlässiger als CSS) ---
$content = preg_replace(
    '/<header[^>]*class="[^"]*site-header[^"]*"[^>]*>.*?<\/header>/si',
    '<!-- header removed by proxy -->',
    $content
);

// --- Minimales Inline-CSS (Backup + Layout) ---
$inlineStyle = '<style id="proxy-overrides">
  header.site-header { display:none!important; }
  .cdt-frontpage-maps-header { display:none!important; }
  body, main { padding-top:0!important; margin-top:0!important; }
</style>';

// --- JS Injection: Helpers + Auto-Init ---
$v = time();
$jsHelpers = '<script src="/maps/tnet/js/tnet-mapplus-helpers.js?v=' . $v . '"></script>';
$jsInject  = '<script src="/maps/tnet/js/tnet-proxy-inject.js?v=' . $v . '"></script>';

$injection = "\n" . $inlineStyle . "\n" . $jsHelpers . "\n" . $jsInject . "\n";

if (strpos($content, '</head>') !== false) {
    $content = str_replace('</head>', $injection . '</head>', $content);
} else {
    $content = preg_replace('/(<body[^>]*>)/i', '$1' . $injection, $content);
}

// --- SSO Auto-Login ---
$isMapPlusLoggedIn = !empty($_SESSION['OIDC_CLAIM_group']) || !empty($_SESSION['app_username']);
$hasWpLoginBtn = strpos($content, 'oauthloginbutton') !== false;

// Debug: IMMER Session-Status in Browser-Konsole ausgeben
$sessionDebug = json_encode([
    'session_id' => session_id(),
    'OIDC_CLAIM_group' => $_SESSION['OIDC_CLAIM_group'] ?? null,
    'app_username' => $_SESSION['app_username'] ?? null,
    'app_group' => $_SESSION['app_group'] ?? null,
    'isMapPlusLoggedIn' => $isMapPlusLoggedIn,
    'hasWpLoginBtn' => $hasWpLoginBtn,
    'cookies_received' => array_keys($_COOKIE),
    'session_name' => session_name(),
]);
$debugScript = '<script>console.log("[proxy] PHP Session Debug:", ' . $sessionDebug . ');</script>';
$content = str_replace('</body>', $debugScript . '</body>', $content);

if ($isMapPlusLoggedIn && $hasWpLoginBtn) {
    // Nach OAuth-Login zurück zum Proxy leiten (nicht zur gis-daten.ch Startseite)
    $proxyUrl = '/maps/tnet/php/active-maps-proxy.php?group=' . urlencode($group);
    $redirectTo = urlencode($proxyUrl);
    $autoLoginScript = '<script>
    console.log("[proxy] Auto-SSO: mapplus angemeldet, starte WP-Login via Redirect");
    window.location.href = "/?option=oauthredirect&app_name=adfs&redirect_to=' . $redirectTo . '";
    </script>';
    $content = str_replace('</body>', $autoLoginScript . '</body>', $content);
    error_log('Proxy: Auto-SSO Redirect injiziert (User: ' . ($_SESSION['app_username'] ?? 'unknown') . ', redirect_to: ' . $proxyUrl . ')');
} else {
    error_log('Proxy: SSO-Status: mapplus=' . ($isMapPlusLoggedIn ? 'ja' : 'nein') . ', WP-Login-Button=' . ($hasWpLoginBtn ? 'ja' : 'nein'));
}

// --- Output ---
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
            CURLOPT_USERAGENT => 'Mozilla/5.0 (compatible; MapProxy/4.1)',
            CURLOPT_SSL_VERIFYPEER => false, // Loopback, SSL nicht nötig
        ]);

        // SSO pass-through: Browser-Cookies an gis-daten.ch weiterleiten
        // Gleicher Server → Browser sendet WP-Session-Cookies an den Proxy
        if (!empty($_COOKIE)) {
            $cookies = [];
            foreach ($_COOKIE as $name => $value) {
                $cookies[] = $name . '=' . urlencode($value);
            }
            curl_setopt($ch, CURLOPT_COOKIE, implode('; ', $cookies));
            error_log('Proxy: ' . count($cookies) . ' Cookies weitergeleitet');
        }
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
