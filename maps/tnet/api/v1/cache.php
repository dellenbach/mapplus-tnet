<?php
/**
 * cache.php
 * TNET API v1 - Cache Management Endpoint
 * 
 * Verwaltet zwei Cache-Typen:
 * - api:   JSON API Response Cache (Standard)
 * - proxy: HTML Proxy Cache (gis-daten.ch Frontpage)
 * 
 * GET  /v1/cache                   → API Cache-Statistiken
 * GET  /v1/cache?type=proxy        → Proxy Cache-Statistiken
 * GET  /v1/cache?type=all          → Alle Cache-Statistiken
 * POST /v1/cache?action=clear      → API Cache leeren
 * POST /v1/cache?action=clear&type=proxy         → Proxy Cache leeren
 * POST /v1/cache?action=clear&type=proxy&group=ow → Proxy Cache für Gruppe leeren
 * POST /v1/cache?action=clear&type=all           → Alle Caches leeren
 * 
 * @version    2.0
 * @date       2026-04-07
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

require_once __DIR__ . '/../includes/ApiResponse.php';
require_once __DIR__ . '/../includes/CacheHelper.php';
require_once __DIR__ . '/../includes/JsonCache.php';

$method = $_SERVER['REQUEST_METHOD'];

// Cookie-Auth für schreibende Operationen (POST = Cache leeren)
if ($method === 'POST') {
    require_once __DIR__ . '/../includes/AdminAuth.php';
    AdminAuth::requireAuth();
}

// OPTIONS Preflight
require_once __DIR__ . '/../includes/CorsHelper.php';
CorsHelper::handlePreflight('GET, POST, OPTIONS');

// Standard API Headers
header('Content-Type: application/json; charset=utf-8');
CorsHelper::setHeaders('GET, POST, OPTIONS');
header('X-API-Version: 2.0');

CacheHelper::noCache();

// --- Proxy-Cache-Verzeichnis und TTL aus Config lesen ---
$proxyCacheDir = '/data/Client_Data/nwow/tmp/proxy-cache';
$proxyCacheTtl = 3600;
$proxyCacheEnabled = false;
$configPath = __DIR__ . '/../../config/tnet-global-config.json5';
if (file_exists($configPath)) {
    $json5 = file_get_contents($configPath);
    // JSON5 → JSON: Kommentare entfernen, Strings bewahren
    $json5 = preg_replace_callback(
        '/"(?:[^"\\\\]|\\\\.)*"|\x27(?:[^\x27\\\\]|\\\\.)*\x27|(\/\/[^\n]*|\/\*.*?\*\/)/s',
        function($m) { return isset($m[1]) && $m[1] !== '' ? '' : $m[0]; },
        $json5
    );
    $json5 = preg_replace_callback(
        "/(?<![\\w])\x27((?:[^'\\\\]|\\\\.)*)\x27/",
        function($m) { return '"' . str_replace('"', '\\"', $m[1]) . '"'; },
        $json5
    );
    $json5 = preg_replace('/(?<=^|[\s{,])([a-zA-Z_][a-zA-Z0-9_-]*)\s*:/m', '"$1":', $json5);
    $json5 = preg_replace('/,(\s*[}\]])/', '$1', $json5);
    $parsed = @json_decode($json5, true);
    if ($parsed && isset($parsed['proxy']['cache'])) {
        $cc = $parsed['proxy']['cache'];
        if (isset($cc['directory']))  $proxyCacheDir = $cc['directory'];
        if (isset($cc['ttlSeconds'])) $proxyCacheTtl = (int)$cc['ttlSeconds'];
        if (isset($cc['enabled']))    $proxyCacheEnabled = (bool)$cc['enabled'];
    }
}

$apiCache = new JsonCache();
$type = $_GET['type'] ?? 'api';

// ===== HILFSFUNKTIONEN für Proxy-Cache =====

/**
 * Proxy-Cache Statistiken auslesen
 */
function getProxyCacheStats(string $dir, int $ttl, bool $enabled): array {
    if (!is_dir($dir)) {
        return [
            'cacheDir' => $dir,
            'enabled'  => $enabled,
            'writable' => false,
            'entries'  => 0,
            'totalSize' => 0,
            'totalFormatted' => '0 B',
            'ttlSeconds' => $ttl,
            'ttlFormatted' => _formatDuration($ttl),
            'files'    => []
        ];
    }
    
    $files = glob($dir . '/proxy_*.html');
    $totalSize = 0;
    $entries = [];
    
    foreach ($files as $file) {
        $size = filesize($file);
        $totalSize += $size;
        $age = time() - filemtime($file);
        $basename = basename($file);
        
        // Gruppe aus Dateiname extrahieren (proxy_{activeMap}_{md5(group)}.html)
        $parts = explode('_', pathinfo($basename, PATHINFO_FILENAME));
        $activeMap = $parts[1] ?? '?';
        
        $entries[] = [
            'key'           => $basename,
            'activeMap'     => $activeMap,
            'size'          => $size,
            'sizeFormatted' => _formatBytes($size),
            'age'           => $age,
            'ageFormatted'  => _formatDuration($age),
            'expired'       => $age >= $ttl,
            'created'       => date('c', filemtime($file))
        ];
    }
    
    return [
        'cacheDir'       => realpath($dir) ?: $dir,
        'enabled'        => $enabled,
        'writable'       => is_writable($dir),
        'entries'        => count($entries),
        'totalSize'      => $totalSize,
        'totalFormatted' => _formatBytes($totalSize),
        'ttlSeconds'     => $ttl,
        'ttlFormatted'   => _formatDuration($ttl),
        'files'          => $entries
    ];
}

/**
 * Proxy-Cache leeren (optional nur für bestimmte Gruppe)
 */
function clearProxyCache(string $dir, ?string $group = null): int {
    if (!is_dir($dir)) return 0;
    
    $count = 0;
    if ($group !== null) {
        // Spezifische Gruppe: activeMap ableiten
        $activeMap = (strpos($group, 'ow') === 0 || $group === 'ow') ? 'ow' : 'nw';
        $pattern = $dir . '/proxy_' . $activeMap . '_*.html';
    } else {
        $pattern = $dir . '/proxy_*.html';
    }
    
    $files = glob($pattern);
    foreach ($files as $file) {
        if (unlink($file)) {
            $count++;
        }
    }
    return $count;
}

function _formatBytes(int $bytes): string {
    $units = ['B', 'KB', 'MB', 'GB'];
    $i = 0;
    while ($bytes >= 1024 && $i < count($units) - 1) {
        $bytes /= 1024;
        $i++;
    }
    return round($bytes, 1) . ' ' . $units[$i];
}

function _formatDuration(int $seconds): string {
    if ($seconds < 60) return $seconds . 's';
    if ($seconds < 3600) return round($seconds / 60) . 'min';
    return round($seconds / 3600, 1) . 'h';
}

// ===== ROUTING =====

if ($method === 'GET') {
    $action = $_GET['action'] ?? '';
    
    // Diagnose-Modus: Schreibtest
    if ($action === 'test') {
        $testKey = '_write_test_' . time() . '.json';
        $testData = ['test' => true, 'timestamp' => date('c')];
        $writeOk = $apiCache->set($testKey, $testData);
        
        $result = [
            'writeTest'  => $writeOk ? 'OK' : 'FAILED',
            'cacheDir'   => realpath($apiCache->getCacheDir()) ?: $apiCache->getCacheDir(),
            'writable'   => $apiCache->isWritable(),
            'dirExists'  => is_dir($apiCache->getCacheDir()),
            'phpUser'    => function_exists('posix_getpwuid') 
                ? posix_getpwuid(posix_geteuid())['name'] 
                : get_current_user(),
            'permissions' => is_dir($apiCache->getCacheDir()) 
                ? substr(sprintf('%o', fileperms($apiCache->getCacheDir())), -4) 
                : 'N/A'
        ];
        
        if (!$writeOk) {
            $result['error'] = $apiCache->getLastError();
        } else {
            $apiCache->invalidate($testKey);
            $result['message'] = 'Cache-Schreibtest erfolgreich';
        }
        
        ApiResponse::success($result, [
            'endpoint'  => '/v1/cache',
            'action'    => 'test',
            'timestamp' => date('c')
        ]);
    }
    
    // Statistiken je nach Typ
    if ($type === 'proxy') {
        $stats = getProxyCacheStats($proxyCacheDir, $proxyCacheTtl, $proxyCacheEnabled);
        ApiResponse::success($stats, ['endpoint' => '/v1/cache', 'type' => 'proxy', 'timestamp' => date('c')]);
    } elseif ($type === 'all') {
        $stats = [
            'api'   => $apiCache->getStats(),
            'proxy' => getProxyCacheStats($proxyCacheDir, $proxyCacheTtl, $proxyCacheEnabled)
        ];
        ApiResponse::success($stats, ['endpoint' => '/v1/cache', 'type' => 'all', 'timestamp' => date('c')]);
    } else {
        $stats = $apiCache->getStats();
        ApiResponse::success($stats, ['endpoint' => '/v1/cache', 'type' => 'api', 'timestamp' => date('c')]);
    }
    
} elseif ($method === 'POST') {
    $action = $_GET['action'] ?? '';
    $group  = isset($_GET['group']) ? preg_replace('/[^a-z0-9_-]/i', '', $_GET['group']) : null;
    
    if ($action === 'clear') {
        if ($type === 'proxy') {
            $count = clearProxyCache($proxyCacheDir, $group);
            ApiResponse::success([
                'message'        => $group ? "Proxy-Cache für Gruppe '{$group}' geleert" : 'Proxy-Cache geleert',
                'entriesRemoved' => $count,
                'group'          => $group
            ], ['endpoint' => '/v1/cache', 'action' => 'clear', 'type' => 'proxy', 'timestamp' => date('c')]);
        } elseif ($type === 'all') {
            $apiCount   = $apiCache->clear();
            $proxyCount = clearProxyCache($proxyCacheDir);
            ApiResponse::success([
                'message'             => 'Alle Caches geleert',
                'apiEntriesRemoved'   => $apiCount,
                'proxyEntriesRemoved' => $proxyCount
            ], ['endpoint' => '/v1/cache', 'action' => 'clear', 'type' => 'all', 'timestamp' => date('c')]);
        } else {
            $count = $apiCache->clear();
            ApiResponse::success([
                'message'        => 'API-Cache geleert',
                'entriesRemoved' => $count
            ], ['endpoint' => '/v1/cache', 'action' => 'clear', 'type' => 'api', 'timestamp' => date('c')]);
        }
    } else {
        ApiResponse::error('Unbekannte Aktion. Verwende ?action=clear', 400);
    }
    
} else {
    ApiResponse::error('Method not allowed. Use GET or POST.', 405);
}
