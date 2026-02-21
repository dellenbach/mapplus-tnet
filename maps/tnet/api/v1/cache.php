<?php
/**
 * TNET API v1 - Cache Management Endpoint
 * 
 * GET  /v1/cache              → Cache-Statistiken
 * POST /v1/cache?action=clear → Cache leeren
 * 
 * @version    1.0
 * @date       2026-02-20
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

require_once __DIR__ . '/../includes/ApiResponse.php';
require_once __DIR__ . '/../includes/CacheHelper.php';
require_once __DIR__ . '/../includes/JsonCache.php';

$method = $_SERVER['REQUEST_METHOD'];

// OPTIONS Preflight
if ($method === 'OPTIONS') {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    http_response_code(204);
    exit;
}

// Standard API Headers
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('X-API-Version: 1.0');

CacheHelper::noCache();

$cache = new JsonCache();

if ($method === 'GET') {
    $action = $_GET['action'] ?? '';
    
    // Diagnose-Modus: Schreibtest
    if ($action === 'test') {
        $testKey = '_write_test_' . time() . '.json';
        $testData = ['test' => true, 'timestamp' => date('c')];
        $writeOk = $cache->set($testKey, $testData);
        
        $result = [
            'writeTest'  => $writeOk ? 'OK' : 'FAILED',
            'cacheDir'   => realpath($cache->getCacheDir()) ?: $cache->getCacheDir(),
            'writable'   => $cache->isWritable(),
            'dirExists'  => is_dir($cache->getCacheDir()),
            'phpUser'    => function_exists('posix_getpwuid') 
                ? posix_getpwuid(posix_geteuid())['name'] 
                : get_current_user(),
            'permissions' => is_dir($cache->getCacheDir()) 
                ? substr(sprintf('%o', fileperms($cache->getCacheDir())), -4) 
                : 'N/A'
        ];
        
        if (!$writeOk) {
            $result['error'] = $cache->getLastError();
        } else {
            // Test-Datei wieder löschen
            $cache->invalidate($testKey);
            $result['message'] = 'Cache write test successful — file written and removed';
        }
        
        ApiResponse::success($result, [
            'endpoint'  => '/v1/cache',
            'action'    => 'test',
            'timestamp' => date('c')
        ]);
    }
    
    $stats = $cache->getStats();
    ApiResponse::success($stats, [
        'endpoint'  => '/v1/cache',
        'timestamp' => date('c')
    ]);
    
} elseif ($method === 'POST') {
    $action = $_GET['action'] ?? '';
    
    if ($action === 'clear') {
        $count = $cache->clear();
        ApiResponse::success([
            'message'        => 'Cache cleared successfully',
            'entriesRemoved' => $count
        ], [
            'endpoint'  => '/v1/cache',
            'action'    => 'clear',
            'timestamp' => date('c')
        ]);
    } else {
        ApiResponse::error('Unknown action. Use ?action=clear', 400);
    }
    
} else {
    ApiResponse::error('Method not allowed. Use GET or POST.', 405);
}
