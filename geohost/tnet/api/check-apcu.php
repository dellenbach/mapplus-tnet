<?php
header('Content-Type: application/json');
$result = [];

// APCu
$result['apcu_loaded'] = extension_loaded('apcu');
$result['apcu_enabled'] = function_exists('apcu_enabled') ? apcu_enabled() : false;
if ($result['apcu_enabled']) {
    apcu_store('test_key', 'test_value', 60);
    $result['apcu_works'] = (apcu_fetch('test_key') === 'test_value');
    apcu_delete('test_key');
}

// OPcache
$result['opcache_loaded'] = extension_loaded('Zend OPcache');

// File cache test - local dir
$cacheDir = __DIR__ . '/cache';
if (!is_dir($cacheDir)) {
    @mkdir($cacheDir, 0755, true);
}
$result['local_dir_writable'] = is_writable($cacheDir) || is_writable(__DIR__);
$testFile = $cacheDir . '/test_' . time() . '.tmp';
$result['local_file_write'] = (@file_put_contents($testFile, 'test') !== false);
if (file_exists($testFile)) @unlink($testFile);

// File cache test - /tmp
$tmpDir = sys_get_temp_dir() . '/mapplus_search_cache';
if (!is_dir($tmpDir)) {
    @mkdir($tmpDir, 0755, true);
}
$result['tmp_dir'] = $tmpDir;
$result['tmp_dir_writable'] = is_dir($tmpDir) && is_writable($tmpDir);
$tmpFile = $tmpDir . '/test_' . time() . '.tmp';
$result['tmp_file_write'] = (@file_put_contents($tmpFile, 'test') !== false);
if (file_exists($tmpFile)) @unlink($tmpFile);

// Shared memory
$result['shmop_available'] = function_exists('shmop_open');

// SQLite3
$result['sqlite3_available'] = class_exists('SQLite3');

// PHP version
$result['php_version'] = PHP_VERSION;

echo json_encode($result, JSON_PRETTY_PRINT);
