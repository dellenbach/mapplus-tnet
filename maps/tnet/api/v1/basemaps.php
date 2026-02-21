<?php
/**
 * TNET API v1 - Basemaps Endpoint
 * 
 * Liefert die verfügbaren Hintergrundkarten als JSON.
 * Refactored aus basemaps-to-json.php mit API-Wrapper.
 * 
 * @version    1.0
 * @date       2026-02-20
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

require_once __DIR__ . '/../includes/ApiResponse.php';
require_once __DIR__ . '/../includes/CacheHelper.php';
require_once __DIR__ . '/../includes/ConfigReader.php';

// Standard API Headers
ApiResponse::setHeaders();

// === Basemaps laden ===
$basemaps = ConfigReader::readBasemapsConf();

if ($basemaps === null) {
    ApiResponse::notFound('basemaps.conf');
}

// === Caching ===
$coreConfig = ConfigReader::getCoreConfigPath();
$basemapsFile = $coreConfig . '/basemaps.conf';

CacheHelper::setCacheControl(CacheHelper::LONG_MAX_AGE);
CacheHelper::handleLastModified($basemapsFile);

// === Response ===
$meta = [
    'count' => is_array($basemaps) ? count($basemaps) : 0
];

ApiResponse::success($basemaps, $meta);
