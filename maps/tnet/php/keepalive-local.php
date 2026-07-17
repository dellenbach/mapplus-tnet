<?php
/**
 * keepalive-local.php
 * Lokaler Keepalive-Endpunkt fuer maps-dev Session-Cookies
 *
 * @version    1.0
 * @date       2026-06-16
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

$scriptName = $_SERVER['SCRIPT_NAME'] ?? '';
$requestUri = $_SERVER['REQUEST_URI'] ?? '';

function resolveAppBasePath($scriptName, $requestUri) {
    $scriptBasePath = rtrim(str_replace('\\', '/', dirname($scriptName)), '/');
    if ($scriptBasePath !== '' && $scriptBasePath !== '.') {
        if (preg_match('#^/(maps(?:-dev)?)(?:/|$)#', $scriptBasePath, $matches)) {
            return '/' . $matches[1];
        }
    }

    $requestPath = parse_url($requestUri, PHP_URL_PATH) ?: '';
    if (preg_match('#^/(maps(?:-dev)?)(?:/|$)#', $requestPath, $matches)) {
        return '/' . $matches[1];
    }

    return '/maps-dev';
}

$appBasePath = resolveAppBasePath($scriptName, $requestUri);
$appCookiePath = ($appBasePath !== '' ? $appBasePath : '') . '/';
if ($appCookiePath === '//') {
    $appCookiePath = '/';
}

session_set_cookie_params([
    'lifetime' => 0,
    'path' => $appCookiePath,
    'domain' => '',
    'secure' => true,
    'httponly' => false,
    'samesite' => 'None'
]);

session_start();

$_SESSION['tnet_keepalive_last'] = time();

$isAuthenticated = !empty($_SESSION['OIDC_CLAIM_group']) || !empty($_SESSION['app_username']);

// Der zentrale Mapplus-PDF-CGI validiert neben der Session-ID auch den
// Mandanten-/Profilkontext. Aeltere öffentliche maps-dev-Sessions enthalten
// diesen nach einem Deploy oder Browser-Restore nicht zwingend vollständig.
if (!$isAuthenticated && $appBasePath === '/maps-dev') {
    $_SESSION['app_group'] = 'public';
    $_SESSION['app_profile'] = 'public';
    $_SESSION['app_credentials']['maps-dev']['public'] = 'public';
}

header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

echo $isAuthenticated ? 'OK_AUTH' : 'OK_ANON';
