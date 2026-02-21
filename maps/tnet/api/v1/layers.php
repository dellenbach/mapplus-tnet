<?php
/**
 * TNET API v1 - Layer Catalog Endpoint
 * 
 * Liefert den hierarchischen Layer-Katalog als JSON.
 * Refactored aus lyrmgr-to-json.php mit erweiterten Features:
 * - ?group=public|nwpro|owpro|... (Profil-Auswahl)
 * - ?category=nidwalden|obwalden|bund|weitere (Filter)
 * - ?flat=true (Flache Liste statt Baum)
 * - ?details=false (Nur IDs+Namen, ohne url/params/options — viel schneller)
 * - ?debug=1 (Debug-Informationen)
 * 
 * @version    1.0
 * @date       2026-02-20
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

require_once __DIR__ . '/../includes/ApiResponse.php';
require_once __DIR__ . '/../includes/CacheHelper.php';
require_once __DIR__ . '/../includes/ConfigReader.php';
require_once __DIR__ . '/../includes/JsonCache.php';

// Standard API Headers
ApiResponse::setHeaders();

// === Parameter lesen ===
$group    = $_GET['group']    ?? 'public';
$category = $_GET['category'] ?? null;
$flat     = isset($_GET['flat']) && $_GET['flat'] === 'true';
$details  = !isset($_GET['details']) || $_GET['details'] !== 'false'; // default: true
$debug    = isset($_GET['debug']) && $_GET['debug'] === '1';
$layerId  = $_GET['id'] ?? null; // Einzelner Layer per ID

// =====================================================================
// Modus 1: Einzelner Layer per ID → schneller Lookup
// GET /v1/layers.php?id=TNET_gis_basis/nw_amtliche_vermessung
// =====================================================================
if ($layerId !== null) {
    $layerData = ConfigReader::readAllLayerDefinitions();
    $def = null;

    // Exakte Suche
    if (isset($layerData['definitions'][$layerId])) {
        $def = $layerData['definitions'][$layerId];
    } else {
        // Fallback: Basis-ID probieren
        $parts = explode('/', $layerId);
        while (count($parts) > 1) {
            array_pop($parts);
            $baseId = implode('/', $parts);
            if (isset($layerData['definitions'][$baseId])) {
                $def = $layerData['definitions'][$baseId];
                break;
            }
        }
    }

    if (!$def) {
        ApiResponse::notFound("Layer '{$layerId}'");
    }

    $layer = [
        'id'        => $layerId,
        'name'      => extractLayerName($layerId),
        'url'       => $def['url'] ?? null,
        'layerType' => $def['type'] ?? null,
        'opacity'   => $def['opacity'] ?? ($def['options']['opacity'] ?? 1.0),
        'visible'   => (bool)($def['visible'] ?? false),
        'params'    => $def['params'] ?? [],
        'options'   => $def['options'] ?? []
    ];

    CacheHelper::setCacheControl(CacheHelper::DEFAULT_MAX_AGE);
    ApiResponse::success($layer);
}

// === JSON Cache prüfen ===
$cache = new JsonCache();
$cacheParams = [
    'group'    => $group,
    'category' => $category,
    'details'  => $details ? 'true' : 'false',
    'flat'     => $flat ? 'true' : 'false'
];
$cacheKey = $cache->getCacheKey('layers', $cacheParams);

// Quell-Dateien für Cache-Invalidierung
$publicConfigBase = realpath(__DIR__ . '/../../../public/config') ?: '';
$lyrmgrFile = ($group && $group !== 'public' && file_exists($publicConfigBase . '/' . $group . '/lyrmgr.conf'))
    ? $publicConfigBase . '/' . $group . '/lyrmgr.conf'
    : $publicConfigBase . '/lyrmgr.conf';
$mappingFile = realpath(__DIR__ . '/../../php/lyrmgr-mapping.json') ?: '';
$sourceFiles = array_filter([$lyrmgrFile, $mappingFile], 'file_exists');

// Cache Hit? (ausser im Debug-Modus)
$cached = $cache->get($cacheKey, $sourceFiles, 3600);
if ($cached !== null && !$debug) {
    CacheHelper::setCacheControl(CacheHelper::DEFAULT_MAX_AGE);
    $meta = $cached['meta'] ?? [];
    $meta['cache'] = 'hit';
    ApiResponse::success($cached['data'], $meta);
}

// === Cache Miss → Konfigurationen laden ===
$startTime = microtime(true);

// 1. lyrmgr.conf (aus dem gewählten Profil)
$conf = ConfigReader::readLyrmgrConf($group);
if (!$conf) {
    ApiResponse::notFound("lyrmgr.conf for group '{$group}'");
}

// 2. lyrmgr-mapping.json
$mapping = ConfigReader::readLyrmgrMapping();
if (!$mapping) {
    ApiResponse::serverError('lyrmgr-mapping.json not found or invalid');
}

// 3. Layer-Definitionen aus core/config/layers_*.conf (nur wenn details=true)
$layerData = ['definitions' => [], 'filesCount' => 0, 'path' => null];
$layerDefinitions = [];
if ($details) {
    $layerData = ConfigReader::readAllLayerDefinitions();
    $layerDefinitions = $layerData['definitions'];
}

// === Layer-Katalog aufbauen ===
$categories = [];

foreach ($mapping['categories'] as $topCategory) {
    // Filter: Nur gewünschte Kategorie
    if ($category !== null && $topCategory['id'] !== $category) {
        continue;
    }

    $lyrmgrKey = $topCategory['lyrmgr'];

    if (!isset($conf[$lyrmgrKey])) {
        continue;
    }

    $lyrmgr = $conf[$lyrmgrKey];
    $topCategoryData = [
        'id'   => $topCategory['id'],
        'name' => $topCategory['name'],
        'icon' => $topCategory['icon'],
        'subcategories' => []
    ];

    // Struktur innerhalb des Layer-Managers
    if (isset($lyrmgr['structure'])) {
        foreach ($lyrmgr['structure'] as $categoryId => $categoryDef) {
            $subcategoryData = [
                'id'     => $categoryId,
                'name'   => ucfirst($categoryId),
                'icon'   => $categoryDef['iconClass'] ?? '',
                'groups' => []
            ];

            if (isset($categoryDef['items'])) {
                foreach ($categoryDef['items'] as $groupId => $groupDef) {
                    $groupData = [
                        'id'     => $groupId,
                        'name'   => extractLayerName($groupId),
                        'open'   => $groupDef['open'] ?? false,
                        'layers' => []
                    ];

                    if (isset($groupDef['items'])) {
                        $groupData['layers'] = processLayerItems($groupDef['items'], $layerDefinitions, $details);
                    }

                    $subcategoryData['groups'][] = $groupData;
                }
            }

            $topCategoryData['subcategories'][] = $subcategoryData;
        }
    }

    $categories[] = $topCategoryData;
}

// === Flat Mode: Alle Layer als flache Liste ===
if ($flat) {
    $flatLayers = [];
    flattenCategories($categories, $flatLayers);

    $meta = [
        'group'      => $group,
        'count'      => count($flatLayers),
        'format'     => 'flat',
        'filteredBy' => $category
    ];

    if ($debug) {
        $meta['debug'] = [
            'coreConfigPath'        => $layerData['path'],
            'layerFilesFound'       => $layerData['filesCount'],
            'layerDefinitionsCount' => count($layerDefinitions)
        ];
    }

    $elapsed = round((microtime(true) - $startTime) * 1000);
    $meta['responseTime'] = $elapsed . 'ms';
    $meta['cache'] = 'miss';

    // In Cache speichern
    $cached = $cache->set($cacheKey, ['data' => $flatLayers, 'meta' => $meta]);
    if (!$cached && $debug) {
        $meta['cacheError'] = $cache->getLastError();
        $meta['cacheWritable'] = $cache->isWritable();
    }

    // HTTP Caching
    CacheHelper::setCacheControl(CacheHelper::DEFAULT_MAX_AGE);

    ApiResponse::success($flatLayers, $meta);
}

// === Hierarchischer Modus (Standard) ===
$result = [
    'version'    => '2.0',
    'categories' => $categories
];

$meta = [
    'group'           => $group,
    'categoriesCount' => count($categories),
    'format'          => 'tree',
    'details'         => $details,
    'filteredBy'      => $category
];

if ($debug) {
    $meta['debug'] = [
        'coreConfigPath'        => $layerData['path'],
        'layerFilesFound'       => $layerData['filesCount'],
        'layerDefinitionsCount' => count($layerDefinitions),
        'availableGroups'       => ConfigReader::listGroups()
    ];
}

$elapsed = round((microtime(true) - $startTime) * 1000);
$meta['responseTime'] = $elapsed . 'ms';
$meta['cache'] = 'miss';

// In Cache speichern
$cached = $cache->set($cacheKey, ['data' => $result, 'meta' => $meta]);
if (!$cached && $debug) {
    $meta['cacheError'] = $cache->getLastError();
    $meta['cacheWritable'] = $cache->isWritable();
}

// HTTP Caching
CacheHelper::setCacheControl(CacheHelper::DEFAULT_MAX_AGE);

ApiResponse::success($result, $meta);

// =====================================================================
// Hilfsfunktionen
// =====================================================================

/**
 * Verarbeitet Layer-Items rekursiv (Baum-Struktur)
 * 
 * @param array $items            Items aus lyrmgr.conf
 * @param array $layerDefinitions Layer-Definitionen aus layers_*.conf
 * @return array Verarbeitete Layer-Daten
 */
function processLayerItems($items, &$layerDefinitions, $details = true) {
    $layers = [];

    foreach ($items as $item) {
        if (is_string($item)) {
            // Einfache Layer-Referenz (String)
            $layerData = [
                'id'   => $item,
                'name' => extractLayerName($item),
                'type' => 'layer'
            ];

            if ($details) {
                $def = findLayerDefinition($item, $layerDefinitions);
                if ($def) {
                    $layerData['url']       = $def['url'] ?? null;
                    $layerData['layerType'] = $def['type'] ?? null;
                    $layerData['opacity']   = $def['opacity'] ?? ($def['options']['opacity'] ?? 1.0);
                    $layerData['visible']   = (bool)($def['visible'] ?? false);
                    $layerData['params']    = $def['params'] ?? [];
                    $layerData['options']   = $def['options'] ?? [];
                }
            }

            $layers[] = $layerData;

        } elseif (is_array($item) && isset($item['name'])) {
            // Gruppe oder Layer mit Metadaten
            $layerData = [
                'id'   => $item['name'],
                'name' => extractLayerName($item['name']),
                'type' => isset($item['items']) ? 'group' : 'layer',
                'open' => $item['open'] ?? false
            ];

            if ($details && !isset($item['items'])) {
                $def = findLayerDefinition($item['name'], $layerDefinitions);
                if ($def) {
                    $layerData['url']       = $def['url'] ?? null;
                    $layerData['layerType'] = $def['type'] ?? null;
                    $layerData['opacity']   = $def['opacity'] ?? ($def['options']['opacity'] ?? 1.0);
                    $layerData['visible']   = (bool)($def['visible'] ?? false);
                    $layerData['params']    = $def['params'] ?? [];
                    $layerData['options']   = $def['options'] ?? [];
                }
            }

            if (isset($item['items'])) {
                $layerData['layers'] = processLayerItems($item['items'], $layerDefinitions, $details);
            }

            $layers[] = $layerData;
        }
    }

    return $layers;
}

/**
 * Sucht Layer-Definition (exakt oder über Basis-ID)
 * 
 * @param string $layerId          Layer-ID (z.B. "gis_oereb/nw_planungszonen_def")
 * @param array  $layerDefinitions Alle geladenen Definitionen
 * @return array|null Definition oder null
 */
function findLayerDefinition($layerId, &$layerDefinitions) {
    // Exakte Übereinstimmung
    if (isset($layerDefinitions[$layerId])) {
        return $layerDefinitions[$layerId];
    }

    // Ohne Sublayer probieren (z.B. "gis_oereb/nw_oereb_def/oereb_planungszonen" → "gis_oereb/nw_oereb_def")
    $parts = explode('/', $layerId);
    while (count($parts) > 1) {
        array_pop($parts);
        $baseId = implode('/', $parts);
        if (isset($layerDefinitions[$baseId])) {
            return $layerDefinitions[$baseId];
        }
    }

    return null;
}

/**
 * Extrahiert lesbaren Layer-Namen aus der ID
 * 
 * @param string $layerId Layer-ID
 * @return string Lesbarer Name
 */
function extractLayerName($layerId) {
    $parts = explode('/', $layerId);
    $lastName = end($parts);
    $name = str_replace('_', ' ', $lastName);
    return ucwords($name);
}

/**
 * Flacht die hierarchische Kategorie-Struktur ab
 * 
 * @param array $categories Hierarchische Kategorien
 * @param array &$result    Referenz auf das Ergebnis-Array
 * @param string $path      Aktueller Pfad (für Kontext)
 */
function flattenCategories($categories, &$result, $path = '') {
    foreach ($categories as $cat) {
        $catPath = $path ? $path . ' > ' . $cat['name'] : $cat['name'];

        if (isset($cat['subcategories'])) {
            foreach ($cat['subcategories'] as $sub) {
                $subPath = $catPath . ' > ' . $sub['name'];

                if (isset($sub['groups'])) {
                    foreach ($sub['groups'] as $group) {
                        $groupPath = $subPath . ' > ' . $group['name'];

                        if (isset($group['layers'])) {
                            flattenLayers($group['layers'], $result, $groupPath, $cat['id']);
                        }
                    }
                }
            }
        }
    }
}

/**
 * Flacht Layer-Items rekursiv ab
 * 
 * @param array  $layers   Layer-Array
 * @param array  &$result  Referenz auf Ergebnis
 * @param string $path     Aktueller Pfad
 * @param string $category Kategorie-ID
 */
function flattenLayers($layers, &$result, $path, $category) {
    foreach ($layers as $layer) {
        if ($layer['type'] === 'group' && isset($layer['layers'])) {
            flattenLayers($layer['layers'], $result, $path . ' > ' . $layer['name'], $category);
        } else {
            $flat = [
                'id'       => $layer['id'],
                'name'     => $layer['name'],
                'category' => $category,
                'path'     => $path
            ];

            if (isset($layer['url']))       $flat['url']       = $layer['url'];
            if (isset($layer['layerType'])) $flat['layerType'] = $layer['layerType'];
            if (isset($layer['opacity']))   $flat['opacity']   = $layer['opacity'];

            $result[] = $flat;
        }
    }
}
