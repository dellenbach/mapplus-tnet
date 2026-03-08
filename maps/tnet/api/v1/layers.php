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
 * - ?source=auto|db|file (Datenquelle: DB bevorzugt, Fallback auf Dateien)
 * 
 * Hybrid-Architektur:
 *   1. PostgreSQL (mapplusconf) — bevorzugt, schnellster Pfad
 *   2. JSON-File-Cache — Zwischenschicht
 *   3. Config-Dateien (layers_*.conf) — Fallback, langsamster Pfad
 * 
 * @version    2.0
 * @date       2026-02-21
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

require_once __DIR__ . '/../includes/ApiResponse.php';
require_once __DIR__ . '/../includes/CacheHelper.php';
require_once __DIR__ . '/../includes/ConfigReader.php';
require_once __DIR__ . '/../includes/JsonCache.php';
require_once __DIR__ . '/../includes/Database.php';

// Standard API Headers
ApiResponse::setHeaders();

// === Parameter lesen ===
$group    = $_GET['group']    ?? 'public';
$category = $_GET['category'] ?? null;
$flat     = isset($_GET['flat']) && $_GET['flat'] === 'true';
$details  = !isset($_GET['details']) || $_GET['details'] !== 'false'; // default: true
$debug    = isset($_GET['debug']) && $_GET['debug'] === '1';
$layerId  = $_GET['id'] ?? null; // Einzelner Layer per ID
$source   = strtolower(trim($_GET['source'] ?? 'auto')); // auto|db|file

// === Datenbank-Verfügbarkeit prüfen ===
$useDatabase = false;
$dbSource    = 'file'; // Tracking welche Quelle tatsächlich benutzt wird

if ($source !== 'file') {
    try {
        $dbStatus = Database::isAvailable();
        if ($dbStatus['available']) {
            $schemaOk = Database::schemaReady();
            if ($schemaOk['exists'] && $schemaOk['tables'] >= 6) {
                $useDatabase = true;
                $dbSource = 'database';
            }
        }
    } catch (\Exception $e) {
        // DB nicht verfügbar, Fallback auf File-Modus
        $useDatabase = false;
    }

    // Wenn source=db explizit gesetzt aber DB nicht bereit → Fehler
    if ($source === 'db' && !$useDatabase) {
        ApiResponse::error('Datenbank nicht verfügbar. Schema erstellen: ?action=schema via admin-Endpoint', 503);
    }
}

// =====================================================================
// Modus 1: Einzelner Layer per ID → schneller Lookup
// GET /v1/layers.php?id=TNET_gis_basis/nw_amtliche_vermessung
// =====================================================================
if ($layerId !== null) {

    // --- DB-Pfad ---
    if ($useDatabase) {
        $layer = fetchLayerFromDb($layerId);
        if ($layer) {
            $layer['_source'] = 'database';
            CacheHelper::setCacheControl(CacheHelper::DEFAULT_MAX_AGE);
            ApiResponse::success($layer);
        }
        // Kein Treffer in DB → Fallback auf Files
    }

    // --- File-Pfad (Original) ---
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
        'options'   => $def['options'] ?? [],
        '_source'   => 'file'
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

// =====================================================================
// DB-Pfad: PostgreSQL-Katalog (bevorzugt, wenn verfügbar)
// =====================================================================
if ($useDatabase) {
    $startTime = microtime(true);
    $dbError = null;

    try {
        $pdo = Database::getConnection();

        // OPTIMIERT: Eine einzige Query statt rekursiver PL/pgSQL-Funktion
        // Holt alle Knoten + Layer-Details in einem Durchgang
        $sql = "
            SELECT 
                cn.node_pk,
                cn.parent_node_pk,
                cn.category_id,
                cn.node_kind,
                cn.source_id,
                cn.display_name AS node_name,
                cn.layer_id,
                cn.sort_idx,
                cn.open_flag,
                cn.service_url,
                cn.coalesce_group,
                cn.select_all,
                cn.legend AS node_legend,
                cm.category_key,
                cm.label AS category_label,
                cm.icon AS category_icon,
                cm.sort_idx AS category_sort,
                -- Legend-Felder immer laden (für Baum-Legenden auch ohne details)
                ld.url,
                ld.layer_type,
                ld.legend_key,
                ld.legend_title,
                ld.legend_link,
                ld.params
        ";
        if ($details) {
            $sql .= ",
                ld.display_name AS layer_display_name,
                ld.icon AS layer_icon,
                ld.opacity,
                ld.visible,
                ld.searchable,
                ld.rank,
                ld.min_resolution,
                ld.max_resolution,
                ld.options
            ";
        }
        $sql .= "
            FROM mapplusconf.catalog_node cn
            JOIN mapplusconf.profile p ON cn.profile_id = p.id AND p.is_active = true
            JOIN mapplusconf.category_mapping cm ON cn.category_id = cm.id
            LEFT JOIN mapplusconf.layer_definition ld ON cn.layer_id = ld.layer_id
        ";
        $sql .= " WHERE p.code = :profile";
        if ($category) {
            $sql .= " AND cm.category_key = :category";
        }
        $sql .= " ORDER BY cm.sort_idx, cn.sort_idx";

        $params = ['profile' => $group];
        if ($category) {
            $params['category'] = $category;
        }

        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll();

        // Tree in PHP aufbauen (statt rekursiver PL/pgSQL-Funktion)
        $built = buildCatalogTree($rows, $details);
        $catalogJson = $built['tree'];
        $treeStats   = $built['stats'];

        if (!empty($rows)) {

            // Flat Mode
            if ($flat) {
                $flatLayers = [];
                flattenDbCatalog($catalogJson, $flatLayers);

                $meta = [
                    'group'       => $group,
                    'count'       => count($flatLayers),
                    'format'      => 'flat',
                    'filteredBy'  => $category,
                    'source'      => 'database',
                    'stats'       => $treeStats,
                ];

                $elapsed = round((microtime(true) - $startTime) * 1000);
                $meta['responseTime'] = $elapsed . 'ms';

                CacheHelper::setCacheControl(CacheHelper::DEFAULT_MAX_AGE);
                ApiResponse::success($flatLayers, $meta);
            }

            // Hierarchischer Modus (Standard)
            $result = [
                'version'    => '2.0',
                'categories' => $catalogJson,
            ];

            $meta = [
                'group'           => $group,
                'categoriesCount' => count($catalogJson),
                'format'          => 'tree',
                'details'         => $details,
                'filteredBy'      => $category,
                'source'          => 'database',
                'stats'           => $treeStats,
            ];

            if ($debug) {
                $meta['debug'] = [
                    'dbSource'       => true,
                    'availableGroups' => ConfigReader::listGroups(),
                ];
            }

            $elapsed = round((microtime(true) - $startTime) * 1000);
            $meta['responseTime'] = $elapsed . 'ms';

            // In Cache speichern (auch DB-Resultate cachen)
            $cache->set($cacheKey, ['data' => $result, 'meta' => $meta]);

            CacheHelper::setCacheControl(CacheHelper::DEFAULT_MAX_AGE);
            ApiResponse::success($result, $meta);
        }
        $dbError = 'Keine Katalogdaten für Profil "' . $group . '" gefunden';
    } catch (\Exception $e) {
        $dbError = $e->getMessage();
    }

    // Bei source=db → Fehler anzeigen statt stiller Fallback
    if ($source === 'db') {
        ApiResponse::error('DB-Pfad fehlgeschlagen: ' . $dbError, 500);
    }
}

// =====================================================================
// File-Pfad: Config-Dateien (Fallback)
// =====================================================================
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

// 3. Layer-Definitionen aus core/config/layers_*.conf
//    Immer laden: wird für details UND Legend-Info auf Leaf-Layern benötigt
$layerData = ConfigReader::readAllLayerDefinitions();
$layerDefinitions = $layerData['definitions'];

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
            // NLS-Lookup für Subcategory-Name, Fallback auf ucfirst
            $subName = getNlsLabel($categoryId);
            if (!$subName) $subName = ucfirst($categoryId);
            $subcategoryData = [
                'id'     => $categoryId,
                'name'   => $subName,
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

                    // Legenden-Key aus lyrmgr.conf durchreichen
                    if (isset($groupDef['legend']) && $groupDef['legend'] !== '') {
                        $groupData['legend'] = $groupDef['legend'];
                    }

                    // selectAll-Flag durchreichen
                    if (!empty($groupDef['selectAll'])) {
                        $groupData['selectAll'] = true;
                    }

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
        'filteredBy' => $category,
        'source'     => 'file'
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
    'filteredBy'      => $category,
    'source'          => 'file'
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

            // Layer-Definition laden (für Details ODER Legend-Info)
            $def = findLayerDefinition($item, $layerDefinitions);

            if ($details && $def) {
                $layerData['url']       = $def['url'] ?? null;
                $layerData['layerType'] = $def['type'] ?? null;
                $layerData['opacity']   = $def['opacity'] ?? ($def['options']['opacity'] ?? 1.0);
                $layerData['visible']   = (bool)($def['visible'] ?? false);
                $layerData['params']    = $def['params'] ?? [];
                $layerData['options']   = $def['options'] ?? [];
            }

            // Legend-Info immer generieren (auch bei details=false)
            if ($def) {
                $legendInfo = extractLegendInfo($def);
                if ($legendInfo) {
                    $layerData['legend'] = $legendInfo['legend'];
                    if (isset($legendInfo['legendLayers'])) {
                        $layerData['legendLayers'] = $legendInfo['legendLayers'];
                    }
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

            // Legenden-Key aus lyrmgr.conf durchreichen
            if (isset($item['legend']) && $item['legend'] !== '') {
                $layerData['legend'] = $item['legend'];
            }

            // selectAll-Flag durchreichen
            if (!empty($item['selectAll'])) {
                $layerData['selectAll'] = true;
            }

            if (!isset($item['items'])) {
                // Leaf-Layer: Definition laden für Details und/oder Legend-Info
                $def = findLayerDefinition($item['name'], $layerDefinitions);
                if ($def) {
                    if ($details) {
                        $layerData['url']       = $def['url'] ?? null;
                        $layerData['layerType'] = $def['type'] ?? null;
                        $layerData['opacity']   = $def['opacity'] ?? ($def['options']['opacity'] ?? 1.0);
                        $layerData['visible']   = (bool)($def['visible'] ?? false);
                        $layerData['params']    = $def['params'] ?? [];
                        $layerData['options']   = $def['options'] ?? [];
                    }
                    // Legend-Info immer generieren, falls nicht bereits aus lyrmgr.conf gesetzt
                    if (!isset($layerData['legend'])) {
                        $legendInfo = extractLegendInfo($def);
                        if ($legendInfo) {
                            $layerData['legend'] = $legendInfo['legend'];
                            if (isset($legendInfo['legendLayers'])) {
                                $layerData['legendLayers'] = $legendInfo['legendLayers'];
                            }
                        }
                    }
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
 * Extrahiert Legend-Info aus einer Layer-Definition.
 * Generiert Service-Pfad und Layer-Index für den legend-proxy.
 * 
 * @param array $def Layer-Definition aus layers_*.conf
 * @return array|null ['legend' => 'service/pfad', 'legendLayers' => '0,1'] oder null
 */
function extractLegendInfo($def) {
    $type = $def['type'] ?? '';
    $url  = $def['url'] ?? '';

    // Nur ArcGIS-Layer haben Legenden über den legend-proxy
    if ($type !== 'arcgisRest' || $url === '') {
        return null;
    }

    // Service-Pfad aus URL extrahieren:
    // /svc/rest/services/<folder>/<service>/MapServer
    // /maps/agsproxy.php?path=<folder>/<service>/MapServer
    // /maps/tnet/agsproxy/<folder>/<service>/MapServer
    $servicePath = '';
    if (preg_match('#/services/(.+?)/MapServer#i', $url, $m)) {
        $servicePath = $m[1];
    } elseif (preg_match('#agsproxy\.php\?path=(.+?)/MapServer#i', $url, $m)) {
        $servicePath = $m[1];
    } elseif (preg_match('#/agsproxy/(.+?)/MapServer#i', $url, $m)) {
        $servicePath = $m[1];
    }

    if ($servicePath === '') {
        return null;
    }

    $result = ['legend' => $servicePath];

    // Layer-Index aus params.LAYERS extrahieren (z.B. "show:0" oder "show:0,1,2")
    // "all" wird ignoriert — dann zeigt der legend-proxy die gesamte Service-Legende
    $layersParam = $def['params']['LAYERS'] ?? '';
    if (preg_match('/show:(.+)/', $layersParam, $lm)) {
        $layerIdx = trim($lm[1]);
        if ($layerIdx !== 'all') {
            $result['legendLayers'] = $layerIdx;
        }
    }

    return $result;
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
 * Lädt NLS-Labels (lyrmgrResources.json) und gibt den Display-Namen zurück.
 * Cacht die Datei nach dem ersten Laden.
 * 
 * @param string $key  Schlüssel (z.B. 'grundlagen', 'oereb')
 * @return string|null  NLS-Label oder null wenn nicht gefunden
 */
function getNlsLabel($key) {
    static $nls = null;
    if ($nls === null) {
        $nlsPath = realpath(__DIR__ . '/../../../core/nls/de/lyrmgrResources.json');
        if ($nlsPath && file_exists($nlsPath)) {
            $nls = json_decode(file_get_contents($nlsPath), true) ?: [];
        } else {
            $nls = [];
        }
    }
    // Suche: desc_<key> (exakt)
    $lookupKey = 'desc_' . $key;
    if (isset($nls[$lookupKey])) {
        return $nls[$lookupKey];
    }
    return null;
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
            if (isset($layer['params']))    $flat['params']    = $layer['params'];
            if (isset($layer['options']))   $flat['options']   = $layer['options'];

            $result[] = $flat;
        }
    }
}

// =====================================================================
// DB-Hilfsfunktionen
// =====================================================================

/**
 * Holt einen einzelnen Layer aus der Datenbank (v_layer_full View)
 * 
 * @param string $layerId Layer-ID
 * @return array|null Layer-Daten oder null
 */
function fetchLayerFromDb($layerId) {
    try {
        $pdo = Database::getConnection();

        // Exakte Suche
        $stmt = $pdo->prepare(
            "SELECT layer_id, display_name, layer_type, url, icon, icon_style,
                    legend_key, legend_title, legend_link, rank, min_resolution,
                    max_resolution, opacity, visible, searchable, attr_editable,
                    url_capabilities, params, options, source_file, maptips
             FROM mapplusconf.v_layer_full
             WHERE layer_id = ?"
        );
        $stmt->execute([$layerId]);
        $row = $stmt->fetch();

        // Fallback: Basis-ID
        if (!$row) {
            $parts = explode('/', $layerId);
            while (count($parts) > 1) {
                array_pop($parts);
                $baseId = implode('/', $parts);
                $stmt->execute([$baseId]);
                $row = $stmt->fetch();
                if ($row) break;
            }
        }

        if (!$row) return null;

        return [
            'id'              => $layerId,
            'name'            => $row['display_name'] ?: extractLayerName($layerId),
            'url'             => $row['url'],
            'layerType'       => $row['layer_type'],
            'icon'            => $row['icon'],
            'legendTitle'     => $row['legend_title'],
            'legendLink'      => $row['legend_link'],
            'opacity'         => (float)($row['opacity'] ?? 1.0),
            'visible'         => (bool)$row['visible'],
            'searchable'      => (bool)$row['searchable'],
            'rank'            => (int)($row['rank'] ?? 1),
            'minResolution'   => $row['min_resolution'] ? (float)$row['min_resolution'] : null,
            'maxResolution'   => $row['max_resolution'] ? (float)$row['max_resolution'] : null,
            'params'          => json_decode($row['params'], true) ?: [],
            'options'         => json_decode($row['options'], true) ?: [],
            'maptips'         => json_decode($row['maptips'], true) ?: [],
        ];

    } catch (\Exception $e) {
        return null;
    }
}

/**
 * Baut den hierarchischen Katalogbaum aus einer flachen SQL-Ergebnismenge in PHP.
 * 
 * Ersetzt die rekursive PL/pgSQL-Funktion get_catalog_json/_build_node_json.
 * Statt ~20.000 einzelner SQL-Queries (N+1 pro Knoten) wird alles aus einer
 * einzigen Query gebaut → O(n) mit Hash-Map.
 * 
 * @param array $rows     Flache Ergebniszeilen aus catalog_node JOIN layer_definition
 * @param bool  $details  Layer-Details einbeziehen
 * @return array           ['tree' => [...], 'stats' => ['layers' => int, 'groups' => int, 'nodes' => int]]
 */
function buildCatalogTree(array $rows, bool $details): array {
    $categories = [];  // catId → {id, name, icon, sort}
    $nodes = [];       // node_pk → node array
    $children = [];    // node_pk → [child node_pk, ...]
    $roots = [];       // category_id → [root node_pk, ...]
    $layerCount = 0;
    $groupCount = 0;
    $legendCount = 0;
    $searchableCount = 0;
    $visibleCount = 0;
    $layerTypes = [];

    // 1. Pass: Alle Knoten indizieren
    foreach ($rows as $row) {
        $nodePk   = (int) $row['node_pk'];
        $parentPk = $row['parent_node_pk'] !== null ? (int) $row['parent_node_pk'] : null;
        $catId    = (int) $row['category_id'];

        // Node-Objekt — Name bereinigen
        $nodeId = $row['source_id'] ?? $row['layer_id'] ?? (string) $nodePk;
        $nodeName = $row['node_name'];
        if ($row['node_kind'] !== 'layer') {
            // Für Gruppen/Subcategories: NLS-Lookup, dann Pfad-Bereinigung
            $nlsLabel = getNlsLabel($nodeId);
            if ($nlsLabel) {
                $nodeName = $nlsLabel;
            } elseif (strpos($nodeName, '/') !== false) {
                // Pfad-basierter Name → nur letztes Segment verwenden
                $nodeName = extractLayerName($nodeId);
            }
        }
        $node = [
            'id'   => $nodeId,
            'name' => $nodeName,
            'type' => $row['node_kind'],
        ];

        if ($row['open_flag']) {
            $node['open'] = true;
        }

        // selectAll-Flag aus DB
        if (!empty($row['select_all'])) {
            $node['selectAll'] = true;
        }

        // Legenden-Key aus DB (Gruppen-Legende aus lyrmgr.conf)
        if (!empty($row['node_legend'])) {
            $node['legend'] = $row['node_legend'];
        }

        // Coalesce-Infos für Gruppen anhängen
        if (!empty($row['service_url'])) {
            $node['serviceUrl']     = $row['service_url'];
            $node['coalesceGroup']  = $row['coalesce_group'];
        }

        // Legend-Info für Leaf-Layer generieren (immer, auch ohne details)
        // Baut ein Mini-Def-Array für extractLegendInfo(), analog zum File-Pfad
        if ($row['node_kind'] === 'layer' && !empty($row['url']) && !isset($node['legend'])) {
            $miniDef = [
                'url'    => $row['url'],
                'type'   => $row['layer_type'] ?? '',
                'params' => json_decode($row['params'] ?? '{}', true) ?: [],
            ];
            $legendInfo = extractLegendInfo($miniDef);
            if ($legendInfo) {
                $node['legend'] = $legendInfo['legend'];
                if (isset($legendInfo['legendLayers'])) {
                    $node['legendLayers'] = $legendInfo['legendLayers'];
                }
            }
        }

        // Layer-Details anhängen (nur bei details=true)
        if ($details && $row['layer_id'] && isset($row['url'])) {
            $node['url']           = $row['url'];
            $node['layerType']     = $row['layer_type'];
            $node['displayName']   = $row['layer_display_name'] ?? null;
            $node['icon']          = $row['layer_icon'] ?? null;
            $node['legendTitle']   = $row['legend_title'];
            $node['legendLink']    = $row['legend_link'];
            $node['opacity']       = (float) ($row['opacity'] ?? 1.0);
            $node['visible']       = (bool)  ($row['visible'] ?? false);
            $node['searchable']    = (bool)  ($row['searchable'] ?? false);
            $node['rank']          = (int)   ($row['rank'] ?? 1);
            $node['minResolution'] = isset($row['min_resolution']) && $row['min_resolution'] !== null ? (float) $row['min_resolution'] : null;
            $node['maxResolution'] = isset($row['max_resolution']) && $row['max_resolution'] !== null ? (float) $row['max_resolution'] : null;
            $node['params']        = json_decode($row['params'] ?? '{}', true) ?: new \stdClass();
            $node['options']       = json_decode($row['options'] ?? '{}', true) ?: new \stdClass();
        }

        $nodes[$nodePk] = $node;

        // Statistiken zählen
        if ($row['node_kind'] === 'layer') {
            $layerCount++;
            if ($details && isset($row['layer_type'])) {
                $lt = $row['layer_type'] ?? 'unknown';
                $layerTypes[$lt] = ($layerTypes[$lt] ?? 0) + 1;
            }
            if ($details && !empty($row['legend_link'])) {
                $legendCount++;
            }
            if ($details && !empty($row['searchable'])) {
                $searchableCount++;
            }
            if ($details && !empty($row['visible'])) {
                $visibleCount++;
            }
        } else {
            $groupCount++;
        }

        // Parent-Kind-Beziehungen
        if ($parentPk === null) {
            $roots[$catId][] = $nodePk;
        } else {
            $children[$parentPk][] = $nodePk;
        }

        // Kategorien sammeln
        if (!isset($categories[$catId])) {
            $categories[$catId] = [
                'id'   => $row['category_key'],
                'name' => $row['category_label'],
                'icon' => $row['category_icon'],
                'sort' => (int) $row['category_sort'],
            ];
        }
    }

    // 2. Kategorien sortieren
    uasort($categories, fn($a, $b) => $a['sort'] - $b['sort']);

    // 3. Baumstruktur aufbauen
    $result = [];
    foreach ($categories as $catId => $cat) {
        $catObj = [
            'id'    => $cat['id'],
            'name'  => $cat['name'],
            'icon'  => $cat['icon'],
            'nodes' => [],
        ];

        if (isset($roots[$catId])) {
            foreach ($roots[$catId] as $rootPk) {
                $catObj['nodes'][] = buildNodeTree($rootPk, $nodes, $children);
            }
        }

        $result[] = $catObj;
    }

    $stats = [
        'layers' => $layerCount,
        'groups' => $groupCount,
        'nodes'  => $layerCount + $groupCount,
        'categories' => array_values(array_map(fn($c) => [
            'id'   => $c['id'],
            'name' => $c['name'],
        ], $categories)),
    ];
    if ($details) {
        $stats['legends']    = $legendCount;
        $stats['searchable'] = $searchableCount;
        $stats['visible']    = $visibleCount;
        ksort($layerTypes);
        $stats['layerTypes'] = $layerTypes;
    }

    return [
        'tree'  => $result,
        'stats' => $stats,
    ];
}

/**
 * Baut einen einzelnen Knoten mit allen Kindern rekursiv auf.
 * Arbeitet auf den bereits geladenen Hash-Maps → kein DB-Zugriff.
 * 
 * @param int   $nodePk   Primärschlüssel des Knotens
 * @param array &$nodes   Alle Knoten (node_pk → array)
 * @param array &$children Parent → [child_pk, ...]
 * @return array           Fertig aufgebauter Knoten mit 'layers'-Array
 */
function buildNodeTree(int $nodePk, array &$nodes, array &$children): array {
    $node = $nodes[$nodePk];

    if (isset($children[$nodePk])) {
        $childNodes = [];
        foreach ($children[$nodePk] as $childPk) {
            $childNodes[] = buildNodeTree($childPk, $nodes, $children);
        }
        $node['layers'] = $childNodes;
    }

    return $node;
}

/**
 * Flacht den DB-Katalog (get_catalog_json-Ausgabe) für den Flat-Modus ab
 * 
 * @param array $categories Kategorien aus get_catalog_json
 * @param array &$result    Referenz auf Flat-Array
 * @param string $path      Aktueller Breadcrumb-Pfad
 */
function flattenDbCatalog($categories, &$result, $path = '') {
    foreach ($categories as $cat) {
        $catPath = $path ? $path . ' > ' . ($cat['name'] ?? '') : ($cat['name'] ?? '');
        $catId   = $cat['id'] ?? '';

        if (isset($cat['nodes'])) {
            flattenDbNodes($cat['nodes'], $result, $catPath, $catId);
        }
    }
}

/**
 * Rekursiv Nodes aus DB-Katalog abflachen
 * 
 * @param array  $nodes    Node-Array
 * @param array  &$result  Referenz auf Flat-Array
 * @param string $path     Aktueller Pfad
 * @param string $category Kategorie-ID
 */
function flattenDbNodes($nodes, &$result, $path, $category) {
    foreach ($nodes as $node) {
        $type = $node['type'] ?? 'layer';

        if ($type === 'group' || $type === 'subcategory') {
            $subPath = $path . ' > ' . ($node['name'] ?? '');
            if (isset($node['layers'])) {
                flattenDbNodes($node['layers'], $result, $subPath, $category);
            }
        } else {
            $flat = [
                'id'       => $node['id'] ?? '',
                'name'     => $node['name'] ?? '',
                'category' => $category,
                'path'     => $path,
            ];

            if (isset($node['url']))       $flat['url']       = $node['url'];
            if (isset($node['layerType'])) $flat['layerType'] = $node['layerType'];
            if (isset($node['opacity']))   $flat['opacity']   = $node['opacity'];
            if (isset($node['params']))    $flat['params']    = $node['params'];
            if (isset($node['options']))   $flat['options']   = $node['options'];

            $result[] = $flat;
        }
    }
}
