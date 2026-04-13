<?php
/**
 * access-control.php
 * Zugriffschutz-Verwaltung: IP-Whitelist und Endpoint-Konfiguration.
 * Generiert .htaccess automatisch aus einer JSON-Konfigurationsdatei.
 *
 * @version    1.0
 * @date       2026-04-13
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

require_once __DIR__ . '/../includes/CorsHelper.php';
CorsHelper::handlePreflight('GET, POST, OPTIONS');
CorsHelper::setHeaders('GET, POST, OPTIONS');

header('Content-Type: application/json; charset=utf-8');

// ===== KONFIGURATION =====
define('CONFIG_FILE', '/data/Client_Data/nwow/tmp/access-config.json');
define('HTACCESS_FILE', __DIR__ . '/.htaccess');

// ===== HILFSFUNKTIONEN =====
function jsonResponse($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function jsonError($message, $code = 400) {
    jsonResponse(['success' => false, 'error' => $message], $code);
}

/**
 * Standard-Konfiguration (Falls keine Config-Datei existiert)
 */
function getDefaultConfig() {
    return [
        'ips' => [
            ['ip' => '127.0.0.1', 'label' => 'Localhost', 'proxy' => false],
            ['ip' => '::1', 'label' => 'Localhost IPv6', 'proxy' => false],
            ['ip' => '193.135.153.250', 'label' => 'nwow.mapplus.ch', 'proxy' => false],
            ['ip' => '193.135.153.10', 'label' => 'Trigonet Server', 'proxy' => true],
            ['ip' => '10.10.5.36', 'label' => 'Internes Netz', 'proxy' => true],
            ['ip' => '10.203.18.133', 'label' => 'Internes Netz', 'proxy' => true],
            ['ip' => '10.203.*.*', 'label' => 'Internes Subnetz', 'proxy' => true],
            ['ip' => '84.241.67.175', 'label' => 'Reverse-Proxy', 'proxy' => true],
        ],
        'endpoints' => [
            'restricted_html' => ['ags-import', 'slm', 'tree-builder', 'dev-test', 'tree-test'],
            'restricted_php' => ['admin', 'migrate', '_migrate_ags_import', 'treebuilder-api', 'access-control'],
            'cache_post_only' => ['cache'],
            'public' => ['layers', 'basemaps', 'bookmarks', 'info', 'server-check', 'legend-proxy', 'legend-proxy-wms'],
        ],
    ];
}

/**
 * Konfiguration laden
 */
function loadConfig() {
    if (file_exists(CONFIG_FILE)) {
        $json = file_get_contents(CONFIG_FILE);
        $config = json_decode($json, true);
        if ($config && isset($config['ips'])) {
            return $config;
        }
    }
    return getDefaultConfig();
}

/**
 * Konfiguration speichern
 */
function saveConfig($config) {
    $dir = dirname(CONFIG_FILE);
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    $json = json_encode($config, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (file_put_contents(CONFIG_FILE, $json) === false) {
        return false;
    }
    return true;
}

/**
 * IP in Apache-Regex umwandeln (Wildcards → Regex)
 * z.B. "10.203.*.*" → "^10\.203\."
 * z.B. "84.241.67.175" → "^84\.241\.67\.175$"
 */
function ipToApacheRegex($ip) {
    // Wildcard am Ende: z.B. 10.203.*.* oder 10.203.*
    if (strpos($ip, '*') !== false) {
        // Alles bis zum ersten * nehmen, Punkt escapen
        $parts = explode('.', $ip);
        $fixedParts = [];
        foreach ($parts as $p) {
            if ($p === '*') break;
            $fixedParts[] = preg_quote($p, '/');
        }
        return '"^' . implode('\\.', $fixedParts) . '\\."';
    }
    // IPv6 Localhost
    if ($ip === '::1') {
        return '"^::1$"';
    }
    // Exakte IPv4
    return '"^' . str_replace('.', '\\.', $ip) . '$"';
}

/**
 * IP für X-Forwarded-For Regex (ohne Anker — kann Teilstring sein)
 */
function ipToForwardedRegex($ip) {
    if (strpos($ip, '*') !== false) {
        $parts = explode('.', $ip);
        $fixedParts = [];
        foreach ($parts as $p) {
            if ($p === '*') break;
            $fixedParts[] = preg_quote($p, '/');
        }
        return '"' . implode('\\.', $fixedParts) . '\\."';
    }
    return '"' . str_replace('.', '\\.', $ip) . '"';
}

/**
 * .htaccess aus Konfiguration generieren
 */
function generateHtaccess($config) {
    $ips = $config['ips'] ?? [];
    $endpoints = $config['endpoints'] ?? [];

    $lines = [];
    $lines[] = '# ============================================================';
    $lines[] = '# TNET API - .htaccess (automatisch generiert)';
    $lines[] = '# Generiert am: ' . date('Y-m-d H:i:s');
    $lines[] = '# Quelle: SLM Zugriffschutz-Tab → access-control.php';
    $lines[] = '# NICHT MANUELL BEARBEITEN — wird bei Speichern überschrieben!';
    $lines[] = '# ============================================================';
    $lines[] = '';

    // GZIP
    $lines[] = '# === GZIP-Kompression für JSON-Antworten ===';
    $lines[] = '<IfModule mod_deflate.c>';
    $lines[] = '    AddOutputFilterByType DEFLATE application/json';
    $lines[] = '    AddOutputFilterByType DEFLATE text/plain';
    $lines[] = '</IfModule>';
    $lines[] = '';

    // IP-Whitelist
    $lines[] = '# === IP-WHITELIST (Apache 2.4) ===';
    foreach ($ips as $entry) {
        $label = isset($entry['label']) ? $entry['label'] : '';
        $lines[] = '# ' . $entry['ip'] . ($label ? ' — ' . $label : '');
    }
    $lines[] = '';

    // Direktzugriff (Remote_Addr)
    $lines[] = '# Direktzugriff (Remote_Addr = Client-IP)';
    foreach ($ips as $entry) {
        $regex = ipToApacheRegex($entry['ip']);
        $padded = str_pad($regex, 35);
        $lines[] = 'SetEnvIf Remote_Addr ' . $padded . ' TNET_ADMIN=1';
    }
    $lines[] = '';

    // Reverse-Proxy (X-Forwarded-For)
    $proxyIps = array_filter($ips, function($e) { return !empty($e['proxy']); });
    if (!empty($proxyIps)) {
        $lines[] = '# Über Reverse-Proxy (X-Forwarded-For enthält echte Client-IP)';
        foreach ($proxyIps as $entry) {
            $regex = ipToForwardedRegex($entry['ip']);
            $padded = str_pad($regex, 35);
            $lines[] = 'SetEnvIf X-Forwarded-For ' . $padded . ' TNET_ADMIN=1';
        }
        $lines[] = '';
    }

    // Geschützte HTML-Dateien
    $restrictedHtml = $endpoints['restricted_html'] ?? [];
    if (!empty($restrictedHtml)) {
        $lines[] = '# --- Geschützte Admin-Seiten (HTML) ---';
        $pattern = implode('|', $restrictedHtml);
        $lines[] = '<FilesMatch "^(' . $pattern . ')\.html$">';
        $lines[] = '    Require env TNET_ADMIN';
        $lines[] = '</FilesMatch>';
        $lines[] = '';
    }

    // Geschützte PHP-Endpoints
    $restrictedPhp = $endpoints['restricted_php'] ?? [];
    if (!empty($restrictedPhp)) {
        $lines[] = '# --- Geschützte Admin-Endpoints (PHP) ---';
        $pattern = implode('|', $restrictedPhp);
        $lines[] = '<FilesMatch "^(' . $pattern . ')\.php$">';
        $lines[] = '    Require env TNET_ADMIN';
        $lines[] = '</FilesMatch>';
        $lines[] = '';
    }

    // Cache-Management (POST = geschützt, GET = öffentlich)
    $cachePostOnly = $endpoints['cache_post_only'] ?? [];
    foreach ($cachePostOnly as $name) {
        $lines[] = '# --- ' . $name . '.php: POST geschützt, GET öffentlich ---';
        $lines[] = '<FilesMatch "^' . $name . '\.php$">';
        $lines[] = '    <If "%{REQUEST_METHOD} == \'POST\'">';
        $lines[] = '        Require env TNET_ADMIN';
        $lines[] = '    </If>';
        $lines[] = '    <Else>';
        $lines[] = '        Require all granted';
        $lines[] = '    </Else>';
        $lines[] = '</FilesMatch>';
        $lines[] = '';
    }

    // Rewrite-Rules
    $lines[] = 'Options +FollowSymLinks -MultiViews';
    $lines[] = 'RewriteEngine On';
    $lines[] = 'RewriteBase /maps/tnet/api/v1/';
    $lines[] = '';
    $lines[] = '# Wenn die angeforderte Datei/Ordner existiert → nichts tun';
    $lines[] = 'RewriteCond %{REQUEST_FILENAME} -f [OR]';
    $lines[] = 'RewriteCond %{REQUEST_FILENAME} -d';
    $lines[] = 'RewriteRule ^ - [L]';
    $lines[] = '';
    $lines[] = '# Clean URLs: name → name.php';
    $lines[] = 'RewriteRule ^([a-zA-Z0-9_-]+)$ $1.php [L,QSA]';

    return implode("\n", $lines) . "\n";
}

/**
 * .htaccess auf Disk schreiben
 */
function writeHtaccess($content) {
    return file_put_contents(HTACCESS_FILE, $content) !== false;
}

/**
 * Alle verfügbaren Endpoints im v1-Verzeichnis auflisten
 */
function listEndpoints() {
    $dir = __DIR__;
    $files = [];

    // PHP-Dateien
    foreach (glob($dir . '/*.php') as $f) {
        $name = basename($f, '.php');
        $files[] = ['name' => $name, 'type' => 'php'];
    }

    // HTML-Dateien
    foreach (glob($dir . '/*.html') as $f) {
        $name = basename($f, '.html');
        $files[] = ['name' => $name, 'type' => 'html'];
    }

    usort($files, function($a, $b) {
        $cmp = strcmp($a['type'], $b['type']);
        return $cmp !== 0 ? $cmp : strcmp($a['name'], $b['name']);
    });

    return $files;
}

// ===== ROUTING =====
$action = isset($_GET['action']) ? $_GET['action'] : '';

switch ($action) {
    case 'load':
        $config = loadConfig();
        jsonResponse(['success' => true, 'data' => $config]);
        break;

    case 'save':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            jsonError('POST erwartet', 405);
        }
        $input = json_decode(file_get_contents('php://input'), true);
        if (!$input || !isset($input['ips'])) {
            jsonError('Ungültige Konfiguration');
        }

        // Validierung: access-control muss immer in restricted_php bleiben
        $restrictedPhp = $input['endpoints']['restricted_php'] ?? [];
        if (!in_array('access-control', $restrictedPhp)) {
            $input['endpoints']['restricted_php'][] = 'access-control';
        }

        // Konfiguration speichern
        if (!saveConfig($input)) {
            jsonError('Konfiguration konnte nicht gespeichert werden', 500);
        }

        // .htaccess generieren und schreiben
        $htaccess = generateHtaccess($input);
        if (!writeHtaccess($htaccess)) {
            jsonError('.htaccess konnte nicht geschrieben werden', 500);
        }

        jsonResponse([
            'success' => true,
            'message' => 'Konfiguration gespeichert und .htaccess generiert',
            'htaccess_preview' => $htaccess,
        ]);
        break;

    case 'preview':
        // Vorschau generieren ohne zu speichern
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            jsonError('POST erwartet', 405);
        }
        $input = json_decode(file_get_contents('php://input'), true);
        if (!$input || !isset($input['ips'])) {
            jsonError('Ungültige Konfiguration');
        }
        $htaccess = generateHtaccess($input);
        jsonResponse(['success' => true, 'htaccess' => $htaccess]);
        break;

    case 'endpoints':
        $endpoints = listEndpoints();
        jsonResponse(['success' => true, 'data' => $endpoints]);
        break;

    case 'current-htaccess':
        // Aktuelle .htaccess lesen
        if (file_exists(HTACCESS_FILE)) {
            $content = file_get_contents(HTACCESS_FILE);
            jsonResponse(['success' => true, 'content' => $content]);
        } else {
            jsonError('.htaccess nicht gefunden', 404);
        }
        break;

    default:
        jsonError('Unbekannte Aktion. Erlaubt: load, save, preview, endpoints, current-htaccess');
}
