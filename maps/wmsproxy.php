<?php
/**
 * wmsproxy.php
 * CORS-Proxy für WMS-Anfragen (GetCapabilities und GetFeatureInfo).
 * Leitet nur diese beiden Request-Typen weiter (kein GetMap).
 *
 * @version    1.1
 * @date       2026-03-02
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

// CORS-Header setzen
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET');
header('Access-Control-Allow-Headers: Content-Type');

// Nur GET erlauben
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    echo 'Nur GET erlaubt';
    exit;
}

// URL-Parameter prüfen
$url = isset($_GET['url']) ? $_GET['url'] : '';
if (empty($url)) {
    http_response_code(400);
    echo 'Parameter "url" fehlt';
    exit;
}

// URL validieren
if (!filter_var($url, FILTER_VALIDATE_URL)) {
    http_response_code(400);
    echo 'Ungültige URL';
    exit;
}

// Sicherheitscheck: Nur GetCapabilities und GetFeatureInfo erlauben
$urlLower = strtolower($url);
$isGetCaps = strpos($urlLower, 'request=getcapabilities') !== false;
$isGetFeatureInfo = strpos($urlLower, 'request=getfeatureinfo') !== false;
if (!$isGetCaps && !$isGetFeatureInfo) {
    http_response_code(403);
    echo 'Nur GetCapabilities- und GetFeatureInfo-Requests erlaubt';
    exit;
}

// Protokoll prüfen (nur http/https)
$scheme = parse_url($url, PHP_URL_SCHEME);
if (!in_array($scheme, ['http', 'https'])) {
    http_response_code(400);
    echo 'Nur HTTP(S) URLs erlaubt';
    exit;
}

// GetCapabilities abrufen
$context = stream_context_create([
    'http' => [
        'timeout' => 15,
        'user_agent' => 'TNET-WMS-Proxy/1.0',
        'follow_location' => true,
        'max_redirects' => 3
    ],
    'ssl' => [
        'verify_peer' => false,
        'verify_peer_name' => false
    ]
]);

$content = @file_get_contents($url, false, $context);

if ($content === false) {
    http_response_code(502);
    echo 'Fehler beim Abrufen der URL: ' . $url;
    exit;
}

// Content-Type aus der Antwort übernehmen
$contentType = 'application/xml';
if (isset($http_response_header)) {
    foreach ($http_response_header as $header) {
        if (stripos($header, 'content-type:') !== false) {
            $contentType = trim(substr($header, strpos($header, ':') + 1));
            break;
        }
    }
}

header('Content-Type: ' . $contentType);
echo $content;
