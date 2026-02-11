<?php
/**
 * Basemaps Configuration Service
 * Reads basemaps.conf and returns as JSON
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

// Path to basemaps.conf
$basemapsPath = __DIR__ . '/../../../core/config/basemaps.conf';

// Check if file exists
if (!file_exists($basemapsPath)) {
    http_response_code(404);
    echo json_encode([
        'error' => 'basemaps.conf not found',
        'path' => $basemapsPath
    ]);
    exit;
}

// Read and parse basemaps.conf
$basemapsContent = file_get_contents($basemapsPath);
$basemaps = json_decode($basemapsContent, true);

if (json_last_error() !== JSON_ERROR_NONE) {
    http_response_code(500);
    echo json_encode([
        'error' => 'Failed to parse basemaps.conf',
        'message' => json_last_error_msg()
    ]);
    exit;
}

// Return basemaps configuration
echo json_encode($basemaps, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
?>
