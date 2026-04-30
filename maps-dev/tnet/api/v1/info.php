<?php
/**
 * TNET API v1 - Info / Health Endpoint
 * 
 * Liefert Informationen über die API und den Server-Status.
 * Kann als Health-Check oder Discovery-Endpoint verwendet werden.
 * 
 * @version    1.1
 * @date       2026-02-20
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

require_once __DIR__ . '/../includes/ApiResponse.php';
require_once __DIR__ . '/../includes/CacheHelper.php';
require_once __DIR__ . '/../includes/ConfigReader.php';
require_once __DIR__ . '/../includes/JsonCache.php';

$requestUri = $_SERVER['REQUEST_URI'] ?? '';
$requestPath = parse_url($requestUri, PHP_URL_PATH) ?: '';
$appBasePath = '';
if (preg_match('#^/(maps(?:-dev)?)(?:/|$)#', $requestPath, $matches)) {
    $appBasePath = '/' . $matches[1];
}
$apiBasePath = ($appBasePath !== '' ? $appBasePath : '/maps') . '/tnet/api/v1';
$docsPath = ($appBasePath !== '' ? $appBasePath : '/maps') . '/tnet/api/docs/';

// Standard API Headers
ApiResponse::setHeaders();

// Kein Caching für Info-Endpoint
CacheHelper::noCache();

// === Daten sammeln ===

// Verfügbare Gruppen
$groups = ConfigReader::listGroups();

// Layer-Statistiken
$layerData = ConfigReader::readAllLayerDefinitions();

// Basemaps
$basemaps = ConfigReader::readBasemapsConf();
$basemapCount = is_array($basemaps) ? count($basemaps) : 0;

// Mapping (Kategorien)
$mapping = ConfigReader::readLyrmgrMapping();
$categoryNames = [];
if ($mapping && isset($mapping['categories'])) {
    foreach ($mapping['categories'] as $cat) {
        $categoryNames[] = $cat['id'];
    }
}

// Cache-Status
$cache = new JsonCache();
$cacheStats = $cache->getStats();

// === Response ===
$info = [
    'api' => [
        'name'    => 'TNET GIS API',
        'version' => '1.0',
        'date'    => '2026-02-20',
        'author'  => 'Trigonet AG'
    ],
    'endpoints' => [
        [
            'path'        => $apiBasePath . '/layers',
            'description' => 'Layer-Katalog (hierarchisch oder flach)',
            'parameters'  => ['group', 'category', 'flat', 'details', 'id', 'debug']
        ],
        [
            'path'        => $apiBasePath . '/basemaps',
            'description' => 'Hintergrundkarten',
            'parameters'  => []
        ],
        [
            'path'        => $apiBasePath . '/bookmarks',
            'description' => 'Karten-Bookmarks',
            'parameters'  => ['name']
        ],
        [
            'path'        => $apiBasePath . '/cache',
            'description' => 'Cache-Management (GET=Status, POST?action=clear)',
            'parameters'  => ['action']
        ],
        [
            'path'        => $apiBasePath . '/info',
            'description' => 'API-Info und Health-Check',
            'parameters'  => []
        ],
        [
            'path'        => $apiBasePath . '/tree-test',
            'description' => 'Layer-Tree Vorschau (HTML, parametrierbar)',
            'parameters'  => ['group', 'category']
        ],
        [
            'path'        => $apiBasePath . '/dev-test',
            'description' => 'Dev-Testseite: Tree + Active Panel, Mobile/Desktop/Split View',
            'parameters'  => ['group', 'panel', 'view']
        ],
        [
            'path'        => $apiBasePath . '/tree-builder',
            'description' => 'Interaktiver Tree-Builder: Layer → Gruppen → Tree-Konfiguration per Drag & Drop',
            'parameters'  => []
        ]
    ],
    'docs' => $docsPath,
    'server' => [
        'status'           => 'ok',
        'php'              => PHP_VERSION,
        'groups'           => $groups,
        'categories'       => $categoryNames,
        'layerFiles'       => $layerData['filesCount'],
        'layerDefinitions' => count($layerData['definitions']),
        'basemaps'         => $basemapCount
    ],
    'cache' => [
        'entries'   => $cacheStats['entries'],
        'totalSize' => $cacheStats['totalFormatted']
    ]
];

ApiResponse::success($info);
