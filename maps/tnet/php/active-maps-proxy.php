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
 * - Serverseitiger Cache pro Gruppe (konfigurierbar in tnet-global-config.json5)
 *
 * Läuft auf demselben Server (Loopback). cURL für Robustheit.
 *
 * @version    5.0
 * @date       2026-04-07
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
$bustCache = isset($_GET['nocache']);

$externalUrl = 'https://www.gis-daten.ch/?active-map=' . $activeMap;
if ($group !== 'nw' && $group !== 'ow' && $group !== 'none') {
    $externalUrl .= '&group=' . urlencode($group);
}

error_log('Proxy v4: Lade ' . $externalUrl);

// --- Cache-Konfiguration aus JSON5 laden (wird später nochmals gelesen für JS-Config) ---
$cacheConfig = ['enabled' => false, 'ttlSeconds' => 3600, 'directory' => '/data/Client_Data/nwow/tmp/proxy-cache'];
$cacheConfigPath = __DIR__ . '/../config/tnet-global-config.json5';
if (file_exists($cacheConfigPath)) {
    $cacheJson5 = file_get_contents($cacheConfigPath);
    $cacheJson5 = preg_replace_callback(
        '/"(?:[^"\\\\]|\\\\.)*"|\x27(?:[^\x27\\\\]|\\\\.)*\x27|(\/\/[^\n]*|\/\*.*?\*\/)/s',
        function($m) { return isset($m[1]) && $m[1] !== '' ? '' : $m[0]; },
        $cacheJson5
    );
    $cacheJson5 = preg_replace_callback(
        "/(?<![\\w])\x27((?:[^'\\\\]|\\\\.)*)\x27/",
        function($m) { return '"' . str_replace('"', '\\"', $m[1]) . '"'; },
        $cacheJson5
    );
    $cacheJson5 = preg_replace('/(?<=^|[\s{,])([a-zA-Z_][a-zA-Z0-9_-]*)\s*:/m', '"$1":', $cacheJson5);
    $cacheJson5 = preg_replace('/,(\s*[}\]])/', '$1', $cacheJson5);
    $cacheParsed = @json_decode($cacheJson5, true);
    if ($cacheParsed && isset($cacheParsed['proxy']['cache'])) {
        $cc = $cacheParsed['proxy']['cache'];
        if (isset($cc['enabled']))    $cacheConfig['enabled']    = (bool)$cc['enabled'];
        if (isset($cc['ttlSeconds'])) $cacheConfig['ttlSeconds'] = (int)$cc['ttlSeconds'];
        if (isset($cc['directory']))  $cacheConfig['directory']  = $cc['directory'];
    }
}

// --- Content laden (mit optionalem Cache) ---
$content = false;
$cacheFile = null;
$cacheHit = false;

// WP-Login-Cookies erkennen → eingeloggte User skippen den Cache
$hasWpCookies = false;
foreach ($_COOKIE as $name => $value) {
    if (strpos($name, 'wordpress_logged_in') === 0) {
        $hasWpCookies = true;
        break;
    }
}

// Cache nur für anonyme Benutzer nutzen (WP-Nonces sind session-gebunden;
// anonyme Nonces sind für alle anonymen User identisch → sicher cachebar)
$useCache = $cacheConfig['enabled'] && !$bustCache && !$hasWpCookies;
error_log('Proxy: Cache-Entscheidung: enabled=' . ($cacheConfig['enabled'] ? 'ja' : 'nein') . ', bustCache=' . ($bustCache ? 'ja' : 'nein') . ', hasWpCookies=' . ($hasWpCookies ? 'ja' : 'nein') . ' → useCache=' . ($useCache ? 'ja' : 'nein'));

if ($useCache) {
    $cacheDir = $cacheConfig['directory'];
    if (!is_dir($cacheDir)) {
        @mkdir($cacheDir, 0755, true);
    }
    $cacheFile = $cacheDir . '/proxy_' . $activeMap . '_' . md5($group) . '.html';
    
    // Cache-Datei prüfen
    if (file_exists($cacheFile)) {
        $cacheAge = time() - filemtime($cacheFile);
        if ($cacheAge < $cacheConfig['ttlSeconds']) {
            $content = file_get_contents($cacheFile);
            $cacheHit = true;
            error_log('Proxy Cache HIT: ' . $cacheFile . ' (Alter: ' . $cacheAge . 's, TTL: ' . $cacheConfig['ttlSeconds'] . 's)');
        } else {
            error_log('Proxy Cache EXPIRED: ' . $cacheFile . ' (Alter: ' . $cacheAge . 's, TTL: ' . $cacheConfig['ttlSeconds'] . 's)');
        }
    }
}

if ($content === false) {
    // Cache-Modus: OHNE Cookies fetchen → anonyme Version (cachebar)
    // Direkt-Modus: MIT Cookies fetchen → personalisierte Version
    $content = fetchContent($externalUrl, !$useCache);
    
    // Bei Erfolg in Cache schreiben (nur anonyme Fetches)
    if ($content !== false && $useCache && $cacheFile) {
        @file_put_contents($cacheFile, $content);
        error_log('Proxy Cache WRITE: ' . $cacheFile . ' (' . strlen($content) . ' bytes)');
    }
}

if ($content === false) {
    http_response_code(502);
    echo '<!DOCTYPE html><html><body>';
    echo '<h1>Fehler beim Laden der Kartenseite</h1>';
    echo '<p>URL: ' . htmlspecialchars($externalUrl) . '</p>';
    echo '</body></html>';
    error_log('Proxy Error: ' . $externalUrl);
    exit;
}

error_log('Proxy v4: Content ' . ($cacheHit ? 'aus Cache' : 'geladen') . ', Länge: ' . strlen($content));

// --- Header entfernen (server-seitig, zuverlässiger als CSS) ---
$content = preg_replace(
    '/<header[^>]*class="[^"]*site-header[^"]*"[^>]*>.*?<\/header>/si',
    '<!-- header removed by proxy -->',
    $content
);

// --- Minimales Inline-CSS (Backup + Layout) ---
$inlineStyle = '<style id="proxy-overrides">
  header.site-header { display:none!important; }
  .cdt-frontpage-maps-header > h2 { display:none!important; }
  .cdt-parallax-header-slider { display:none!important; }
  body, main { padding-top:0!important; margin-top:0!important; }

  /* Sidebar-Icon (SVG Pin) verkleinern */
  .cdt-frontpage-maps-sidebar-icon {
    position: fixed!important;
    top: 50px!important;
    left: 40px!important;
    z-index: 9999!important;
    background: transparent!important;
    padding: 0!important;
    display: flex!important;
    align-items: center!important;
    justify-content: center!important;
    cursor: pointer!important;
  }
  .cdt-frontpage-maps-sidebar-icon svg {
    max-width: 150px!important;
    max-height: 188px!important;
    width: auto!important;
    height: auto!important;
  }
  .cdt-frontpage-maps-sidebar-title {
    cursor: pointer!important;
  }

  /* Karten-Suchfeld */
  #tnet-map-search {
    position: fixed!important;
    top: 130px!important;
    left: 160px!important;
    z-index: 9999!important;
    width: 180px!important;
    padding: 8px 12px!important;
    border: 1px solid #ccc!important;
    border-radius: 4px!important;
    font-size: 14px!important;
    background: rgba(255,255,255,0.95)!important;
    box-shadow: 0 1px 4px rgba(0,0,0,0.15)!important;
    outline: none!important;
  }
  #tnet-map-search:focus {
    border-color: var(--m-color-primary, #4B7B81)!important;
    box-shadow: 0 0 0 2px rgba(75,123,129,0.25)!important;
  }
  #tnet-map-search::placeholder {
    color: #999!important;
  }
  /* Sidebar-Logo/Pin Bilder verkleinern */
  .cdt-frontpage-maps-sidebar > img,
  .cdt-frontpage-maps-sidebar > a > img,
  .cdt-frontpage-maps-sidebar > div > img,
  .cdt-frontpage-maps-sidebar > figure img {
    max-height: 60px!important;
    width: auto!important;
    object-fit: contain!important;
  }

  /* Sidebar sichtbar machen und Layout stabilisieren */
  .cdt-frontpage-maps-sidebar {
    display: block!important;
    pointer-events: auto!important;
    min-height: 100vh!important;
    flex-shrink: 0!important;
  }
  /* Content-Bereich: min-height damit Sidebar nicht springt bei Filterung */
  .cdt-frontpage-maps-maplists {
    min-height: 100vh!important;
  }

  /* KATEGORIEN-Nav: bei Toggle aufklappen */
  .cdt-frontpage-maps-sidebar-nav.cdt-frontpage-maps-sidebar-nav-active {
    display: block!important;
    position: fixed!important;
    z-index: 9999!important;
    top: 0!important;
    left: 0!important;
    width: 400px!important;
    max-width: 100vw!important;
    height: 100vh!important;
    box-sizing: border-box!important;
    background: white!important;
    overflow-x: hidden!important;
    overflow-y: auto!important;
    pointer-events: auto!important;
    box-shadow: 2px 0 8px rgba(0,0,0,0.2)!important;
    text-align: right!important;
    padding: 50px 20px 20px 20px!important;
  }
</style>';

// --- Proxy-Config aus tnet-global-config.json5 lesen ---
$proxyConfig = ['debug' => false, 'autoLogin' => false, 'autoLoginPollMs' => 300, 'autoLoginPollMax' => 20];
$proxyConfigStatus = 'default'; // wird zu 'ok' oder 'parse-failed' gesetzt
$configPath  = __DIR__ . '/../config/tnet-global-config.json5';
if (file_exists($configPath)) {
    $json5 = file_get_contents($configPath);
    // JSON5 → JSON Konvertierung:
    // Kommentare entfernen, ABER Strings (mit // drin, z.B. URLs) bewahren.
    // Regex matcht: "string" | 'string' | //Kommentar | /*Kommentar*/
    // Nur Gruppe 1 (Kommentare) wird durch '' ersetzt, Strings bleiben.
    $json5 = preg_replace_callback(
        '/"(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\'|(\/\/[^\n]*|\/\*.*?\*\/)/s',
        function($m) { return isset($m[1]) && $m[1] !== '' ? '' : $m[0]; },
        $json5
    );
    // Single-quoted Strings → Double-quoted (JSON kennt nur "...")
    $json5 = preg_replace_callback(
        "/(?<![\\w])\'((?:[^'\\\\]|\\\\.)*)'/",
        function($m) { return '"' . str_replace('"', '\\"', $m[1]) . '"'; },
        $json5
    );
    // Unquoted keys quotieren (key: → "key":)
    $json5 = preg_replace('/(?<=^|[\s{,])([a-zA-Z_][a-zA-Z0-9_-]*)\s*:/m', '"$1":', $json5);
    // Trailing commas entfernen (JSON5 → JSON)
    $json5 = preg_replace('/,(\s*[}\]])/', '$1', $json5);
    $parsed = @json_decode($json5, true);
    if ($parsed && isset($parsed['proxy'])) {
        // Nur bekannte Keys übernehmen (nicht _description etc.)
        foreach (['debug', 'autoLogin', 'autoLoginPollMs', 'autoLoginPollMax'] as $k) {
            if (array_key_exists($k, $parsed['proxy'])) {
                $proxyConfig[$k] = $parsed['proxy'][$k];
            }
        }
        $proxyConfigStatus = 'ok';
        error_log('Proxy: Config geladen – debug=' . ($proxyConfig['debug'] ? 'true' : 'false') . ', autoLogin=' . ($proxyConfig['autoLogin'] ? 'true' : 'false'));
    } else {
        $proxyConfigStatus = 'parse-failed:' . json_last_error_msg();
        error_log('Proxy: Config-Parse fehlgeschlagen (json_last_error=' . json_last_error_msg() . ')');
    }
}
// SSO-Status: muss VOR dem JS-Block ermittelt werden (wird in __TNET_PROXY_SESSION verwendet)
$isMapPlusLoggedIn = !empty($_SESSION['OIDC_CLAIM_group']) || !empty($_SESSION['app_username']);
// Login-Button im originalen WP-HTML? (VOR unserer Injection prüfen)
$hasWpLoginBtn = strpos($content, 'oauthloginbutton') !== false;

$proxyConfigJs = '<script>
window.__TNET_PROXY_DEBUG      = ' . ($proxyConfig['debug']     ? 'true' : 'false') . ';
window.__TNET_PROXY_CONFIG_STATUS = ' . json_encode($proxyConfigStatus) . ';
window.__TNET_PROXY_AUTO_LOGIN = ' . ($proxyConfig['autoLogin'] ? 'true' : 'false') . ';
window.__TNET_PROXY_NEEDS_LOGIN = ' . ($hasWpLoginBtn ? 'true' : 'false') . ';
window.__TNET_PROXY_CACHE_HIT  = ' . ($cacheHit ? 'true' : 'false') . ';
window.__TNET_PROXY_SESSION    = ' . json_encode([
    'isLoggedIn'  => $isMapPlusLoggedIn,
    'username'    => $_SESSION['app_username']  ?? null,
    'group'       => $_SESSION['app_group']     ?? null,
    'oidcGroup'   => $_SESSION['OIDC_CLAIM_group'] ?? null,
]) . ';
</script>';

// --- JS Injection: Helpers + Auto-Init ---
$v = time();
$jsHelpers = '<script src="/maps/tnet/js/tnet-mapplus-helpers.js?v=' . $v . '"></script>';
$jsInject  = '<script src="/maps/tnet/js/tnet-proxy-inject.js?v=' . $v . '"></script>';

$injection = "\n" . $proxyConfigJs . "\n" . $inlineStyle . "\n" . $jsHelpers . "\n" . $jsInject . "\n";

if (strpos($content, '</head>') !== false) {
    $content = str_replace('</head>', $injection . '</head>', $content);
} else {
    $content = preg_replace('/(<body[^>]*>)/i', '$1' . $injection, $content);
}

error_log('Proxy: SSO-Status: mapplus=' . ($isMapPlusLoggedIn ? 'ja' : 'nein') . ', WP-Login-Button=' . ($hasWpLoginBtn ? 'ja' : 'nein'));

// --- Output ---
echo $content;

// =========================================================
// Hilfsfunktionen
// =========================================================
function sanitize($str) {
    return preg_replace('/[^a-z0-9_-]/i', '', $str);
}

function fetchContent($url, $withCookies = true) {
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
            CURLOPT_USERAGENT => 'Mozilla/5.0 (compatible; MapProxy/5.0)',
            CURLOPT_SSL_VERIFYPEER => false, // Loopback, SSL nicht nötig
        ]);

        // SSO pass-through: Browser-Cookies an gis-daten.ch weiterleiten
        // Nur wenn explizit aktiviert (deaktiviert für Cache-Fetches)
        if ($withCookies && !empty($_COOKIE)) {
            $cookies = [];
            foreach ($_COOKIE as $name => $value) {
                $cookies[] = $name . '=' . urlencode($value);
            }
            curl_setopt($ch, CURLOPT_COOKIE, implode('; ', $cookies));
            error_log('Proxy: ' . count($cookies) . ' Cookies weitergeleitet');
        } elseif (!$withCookies) {
            error_log('Proxy: Fetch OHNE Cookies (für Cache)');
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
