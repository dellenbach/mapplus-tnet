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
 * - ?source=db|file (Datenquelle muss explizit gesetzt sein)
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
require_once __DIR__ . '/../includes/ConfigSource.php';
require_once __DIR__ . '/../includes/CatalogRepository.php';

// Standard API Headers
ApiResponse::setHeaders();

function resolveAppBasePath($scriptName, $requestUri) {
    foreach ([$scriptName, parse_url($requestUri, PHP_URL_PATH) ?: ''] as $candidatePath) {
        $normalizedPath = str_replace('\\', '/', (string)$candidatePath);
        if (preg_match('#^/(maps(?:-dev)?)(?:/|$)#', $normalizedPath, $matches)) {
            return '/' . $matches[1];
        }
    }

    return '';
}

function normalizeAppProxyUrl($url) {
    global $appBasePath;

    if (!is_string($url) || $url === '') {
        return $url;
    }

    $normalizedUrl = str_replace('\\', '/', $url);
    if (preg_match('#^https?://#i', $normalizedUrl) || strpos($normalizedUrl, '//') === 0) {
        return $url;
    }

    $root = $appBasePath !== '' ? $appBasePath : '';
    if (preg_match('#^/maps(?:-dev)?(/tnet/agsproxy/.*)$#i', $normalizedUrl, $matches)) {
        return $root . $matches[1];
    }
    if (preg_match('#^/maps(?:-dev)?(/agsproxy\.php(?:\?.*)?)$#i', $normalizedUrl, $matches)) {
        return $root . $matches[1];
    }
    if (preg_match('#^/tnet/agsproxy/#i', $normalizedUrl) || preg_match('#^/agsproxy\.php#i', $normalizedUrl)) {
        return $root . $normalizedUrl;
    }
    if (preg_match('#^(tnet/agsproxy/.*|agsproxy\.php(?:\?.*)?)$#i', $normalizedUrl)) {
        return ($root !== '' ? $root . '/' : '/') . $normalizedUrl;
    }

    return $url;
}

$appBasePath = resolveAppBasePath($_SERVER['SCRIPT_NAME'] ?? '', $_SERVER['REQUEST_URI'] ?? '');

// === Parameter lesen ===
$group    = $_GET['group']    ?? 'public';
$category = $_GET['category'] ?? null;
$flat     = isset($_GET['flat']) && $_GET['flat'] === 'true';
$details  = !isset($_GET['details']) || $_GET['details'] !== 'false'; // default: true
$debug    = isset($_GET['debug']) && $_GET['debug'] === '1';
$layerId  = $_GET['id'] ?? null; // Einzelner Layer per ID
$source   = strtolower(trim($_GET['source'] ?? '')); // db|file (explizit)
$noCache  = isset($_GET['nocache']) && $_GET['nocache'] === '1';
$action   = $_GET['action'] ?? null;

if ($source === '' || $source === 'auto' || !in_array($source, ['db', 'file'], true)) {
    ApiResponse::error("Ungueltiger source-Parameter. Verwende source=db oder source=file.", 400);
}

// Quelltrennung: pro Request genau EINE Quelle verwenden (DB ODER Files).
// Kein Mischen von Katalog aus DB mit Layer-Details aus Dateien.
// Wichtig: DB-Quelle darf nicht über TTL-JSON-Cache verzögert werden,
// sonst sind Live-Publishes erst nach "Cache leeren" sichtbar.
$bypassJsonCache = ($source === 'db');

// =====================================================================
// Action: NLS-Label-Check
// GET /v1/layers.php?action=nls_check&group=owpro
// Listet alle Keys aus der lyrmgr.conf und zeigt ob ein NLS-Label existiert.
// =====================================================================
if ($action === 'nls_check') {
    header('Content-Type: application/json; charset=utf-8');

    // 1. Alle lyrmgrResources_*.json laden
  //    Basis: Umgebungs-Core (DEV und PROD: core)
    //    Überladungen: app-lokaler core/nls/de Pfad
    //    Überladungen überschreiben gleichnamige Keys aus der Basis.
    $nlsDirBase     = ConfigReader::getCoreNlsPath('de');
    $nlsDirOverride = TnetCorePaths::getAppCoreNlsPath('de');
    $allNls = [];       // nlsKey => { label, file }
    $nlsFiles = [];     // filename => count
    $nlsDirs = [];      // Debug: welche Verzeichnisse geladen wurden

    // Basis laden
    if ($nlsDirBase && is_dir($nlsDirBase)) {
        $nlsDirs[] = $nlsDirBase . ' (Basis)';
        foreach (glob($nlsDirBase . '/lyrmgrResources*.json') as $f) {
            $fname = basename($f);
            $data = json_decode(file_get_contents($f), true);
            if (is_array($data)) {
                $nlsFiles[$fname] = count($data);
                foreach ($data as $k => $v) {
                    $allNls[$k] = ['label' => $v, 'file' => $fname];
                }
            }
        }
    }
    // Überladungen laden (überschreibt gleichnamige Keys)
    if ($nlsDirOverride && is_dir($nlsDirOverride) && $nlsDirOverride !== $nlsDirBase) {
        $nlsDirs[] = $nlsDirOverride . ' (Override)';
        foreach (glob($nlsDirOverride . '/lyrmgrResources*.json') as $f) {
            $fname = 'override/' . basename($f);
            $data = json_decode(file_get_contents($f), true);
            if (is_array($data)) {
                $nlsFiles[$fname] = count($data);
                foreach ($data as $k => $v) {
                    $allNls[$k] = ['label' => $v, 'file' => $fname];
                }
            }
        }
    }

    // 2. lyrmgr.conf laden (gruppenspezifisch oder public)
    $confBase = ConfigReader::getPublicConfigPath($group);
    $confPath = $confBase ? $confBase . '/lyrmgr.conf' : null;
    if (!$confPath || !file_exists($confPath)) {
        $confBase = ConfigReader::getPublicConfigPath('public');
        $confPath = $confBase ? $confBase . '/lyrmgr.conf' : null;
    }
    if (!$confPath || !file_exists($confPath)) {
        ApiResponse::error("lyrmgr.conf nicht gefunden (group={$group})", 404);
    }
    $lyrmgr = json_decode(file_get_contents($confPath), true);
    if (!$lyrmgr) {
        ApiResponse::error("lyrmgr.conf parse error", 500);
    }

    // 3. Alle Keys rekursiv aus der Struktur extrahieren
    $allKeys = [];
    _nlsExtractKeys($lyrmgr, 'lyrmgr', $allKeys);

    // 4. Abgleich: welche Keys haben ein NLS-Label, welche nicht?
    $missing = [];
    $found   = [];
    foreach ($allKeys as $entry) {
        $nlsKey = 'desc_' . $entry['key'];
        if (isset($allNls[$nlsKey])) {
            $found[] = [
                'key'    => $entry['key'],
                'type'   => $entry['type'],
                'nlsKey' => $nlsKey,
                'label'  => $allNls[$nlsKey]['label'],
                'file'   => $allNls[$nlsKey]['file'],
            ];
        } else {
            // Fallback-Name wie im JS: letzter Pfadteil, Unterstriche→Leerzeichen, ucwords
            $base = (strpos($entry['key'], '/') !== false)
                ? substr($entry['key'], strrpos($entry['key'], '/') + 1)
                : $entry['key'];
            $missing[] = [
                'key'      => $entry['key'],
                'type'     => $entry['type'],
                'nlsKey'   => $nlsKey,
                'fallback' => ucwords(str_replace('_', ' ', $base)),
            ];
        }
    }

    echo json_encode([
        'group'          => $group,
        'confPath'       => basename(dirname($confPath)) . '/' . basename($confPath),
        'nlsDirs'        => $nlsDirs,
        'nlsFiles'       => $nlsFiles,
        'totalNlsLabels' => count($allNls),
        'totalKeys'      => count($allKeys),
        'summary'        => ['found' => count($found), 'missing' => count($missing)],
        'missing'        => $missing,
        'found'          => $found,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    exit;
}

/**
 * Rekursive Hilfsfunktion: Alle Keys aus lyrmgr.conf-Struktur extrahieren.
 * Erkennt Strings (Layer-Keys), benannte Objekte ({name,...,items:[...]}),
 * und assoziative Unter-Gruppen (Key=ID, Value=Array).
 */
function _nlsExtractKeys($node, $type, &$out) {
    // Meta-Keys überspringen
    static $skip = ['open','iconClass','type','useRemoveHighlight',
        'switchLyrChkBoxAndName','targetMap','mod_sortlayers',
        'statemanager_cgi','version','structure','name','items'];

    if (is_string($node)) {
        $out[] = ['key' => $node, 'type' => 'layer'];
        return;
    }
    if (!is_array($node)) return;

    // Numerisches Array → Liste von Items
    if (array_values($node) === $node) {
        foreach ($node as $item) {
            // Gruppen-Objekt mit "name"-Property → Service-Root-Key extrahieren
            // z.B. {"name": "gis_oereb/nw_nutzungsplanung_def", "items": [...]}
            if (is_array($item) && isset($item['name'])) {
                $out[] = ['key' => $item['name'], 'type' => 'group'];
            }
            _nlsExtractKeys($item, 'layer', $out);
        }
        return;
    }

    // Assoziatives Array → Gruppen / Kategorien
    foreach ($node as $key => $value) {
        if (in_array($key, $skip, true)) continue;

        if ($key === 'structure' || $key === 'items') {
            _nlsExtractKeys($value, 'group', $out);
            continue;
        }

        if (is_array($value)) {
            $out[] = ['key' => $key, 'type' => $type];
            // Unterstruktur: items-Array oder weitere verschachtelte Gruppen
            if (isset($value['items'])) {
                _nlsExtractKeys($value['items'], 'group', $out);
            }
            if (isset($value['structure'])) {
                _nlsExtractKeys($value['structure'], 'subcategory', $out);
            }
            // Weitere verschachtelte assoziative Schlüssel
            foreach ($value as $sk => $sv) {
                if (in_array($sk, $skip, true)) continue;
                if (is_array($sv) && !is_numeric($sk)) {
                    _nlsExtractKeys([$sk => $sv], 'group', $out);
                }
            }
        }
    }
}

// === Datenbank-Verfügbarkeit prüfen ===
$useDatabase = false;
$dbSource    = 'file'; // Tracking welche Quelle tatsächlich benutzt wird

// Bei source=db: immer catalog_document (Tree-Builder Quelle) verwenden.
// catalog_node-Pfad (altes Schema) wird komplett übersprungen.
// Keine Abhängigkeit von ConfigSource, da source=db explizit vom Client gesetzt wird.
$useCatalogDocument = ($source === 'db');

if ($source !== 'file' && !$useCatalogDocument) {
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
            CacheHelper::setNoCache();
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

    CacheHelper::setNoCache();
    ApiResponse::success($layer);
}

// === JSON Cache prüfen ===
$cache = new JsonCache();
$cacheParams = [
    'group'    => $group,
    'category' => $category,
    'details'  => $details ? 'true' : 'false',
    'flat'     => $flat ? 'true' : 'false',
    'source'   => $source
];
$cacheKey = $cache->getCacheKey('layers', $cacheParams);

// Quell-Dateien für Cache-Invalidierung
$publicConfigBase = realpath(__DIR__ . '/../../../public/config') ?: '';
$lyrmgrFile = ($group && $group !== 'public' && file_exists($publicConfigBase . '/' . $group . '/lyrmgr.conf'))
    ? $publicConfigBase . '/' . $group . '/lyrmgr.conf'
    : $publicConfigBase . '/lyrmgr.conf';
$mappingFile = realpath(__DIR__ . '/../../php/lyrmgr-mapping.json') ?: '';
$sourceFiles = array_filter([$lyrmgrFile, $mappingFile], 'file_exists');

// Cache Hit? (ausser im Debug- oder NoCache-Modus)
$cached = $cache->get($cacheKey, $sourceFiles, 3600);
if (!$bypassJsonCache && $cached !== null && !$debug && !$noCache) {
    CacheHelper::setNoCache();
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

                CacheHelper::setNoCache();
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
            if (!$bypassJsonCache) {
                $cache->set($cacheKey, ['data' => $result, 'meta' => $meta]);
            }

            CacheHelper::setNoCache();
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

$lyrmgrSourceUsed = 'file';

// 1. lyrmgr.conf: Bei source=db aus catalog_document laden (Tree-Builder Quelle),
//    sonst aus Konfigurationsdatei lesen.
if ($useCatalogDocument) {
    require_once __DIR__ . '/../includes/CatalogRepository.php';
    try {
        $doc = CatalogRepository::loadProfile($group);
        if (empty($doc['exists']) || empty($doc['data'])) {
            ApiResponse::error(
                'Kein Katalog-Dokument für Profil "' . $group . '" in der DB. Bitte im Tree-Builder publizieren. Hinweis: Profil muss mindestens einmal im Tree-Builder gespeichert werden.',
                404
            );
        }
        $conf = $doc['data'];
        $lyrmgrSourceUsed = 'catalog-db';
        // __nlsAliases und __nodeEditMeta aus dem Payload in NLS-Runtime einspeisen
        if (isset($conf['__nlsAliases']) && is_array($conf['__nlsAliases'])) {
            foreach ($conf['__nlsAliases'] as $k => $v) {
                if (is_string($v)) $_nlsAliasesRuntime[$k] = $v;
            }
        }
        // Meta-Schlüssel aus $conf entfernen (kein Baum-Block)
        unset($conf['__nlsAliases'], $conf['__nodeEditMeta']);
    } catch (\Throwable $e) {
        ApiResponse::error('Katalog-DB nicht erreichbar: ' . $e->getMessage() . ' | ' . $e->getFile() . ':' . $e->getLine(), 500);
    }
} else {
    $conf = ConfigReader::readLyrmgrConf($group);
    if (!$conf) {
        ApiResponse::notFound("lyrmgr.conf for group '{$group}'");
    }
}

// 2. lyrmgr-mapping.json
$mapping = ConfigReader::readLyrmgrMapping();
if (!$mapping) {
    ApiResponse::serverError('lyrmgr-mapping.json not found or invalid');
}

// 3. Layer-Definitionen + NLS-Aliases: bei source=db aus config_bundle_store,
//    sonst aus Core-Dateien (identische Scope-Reihenfolge wie SLM Tree-Builder).
$layerDefinitions = [];
$_nlsAliasesRuntime = []; // nlsKey => label
$layerData = ['definitions' => [], 'path' => '', 'filesCount' => 0]; // Fallback fuer Debug-Meta

// catalog_document-Aliases aus $conf nachladen (wurden vor dieser Zeile geparst
// und in $conf gelesen, aber $conf ist jetzt bereinigt — direkt aus $doc lesen).
if ($useCatalogDocument && isset($doc) && isset($doc['data']['__nlsAliases'])) {
    foreach ($doc['data']['__nlsAliases'] as $k => $v) {
        if (is_string($v) && $v !== '') $_nlsAliasesRuntime[$k] = $v;
    }
}

if ($useCatalogDocument) {
    // DB-Pfad: config_bundle_store analog zum SLM Tree-Builder
    // loadAllSafe() statt loadAll() um Schema-DDL im Runtime-Kontext zu vermeiden.
    try {
        $scopeRank = ['core' => 1, 'override' => 2, 'sitecore' => 2, 'profile' => 3];
        $bundles = StagingImportRepository::loadAllSafe();
        usort($bundles, function ($a, $b) use ($scopeRank) {
            $ra = $scopeRank[$a['scope'] ?? 'core'] ?? 1;
            $rb = $scopeRank[$b['scope'] ?? 'core'] ?? 1;
            if ($ra === $rb) return strcmp($a['kuerzel'], $b['kuerzel']);
            return $ra - $rb;
        });
        foreach ($bundles as $bundle) {
            $bScope = $bundle['scope'] ?? 'core';
            $bProfile = $bundle['profile'] ?? null;
            if ($bScope === 'profile') {
                if (!$group || $bProfile !== $group) continue;
            }
            foreach (($bundle['files'] ?? []) as $file) {
                $prefix = $file['prefix'] ?? '';
                $data = $file['data'] ?? null;
                if (!is_array($data) || empty($data)) continue;
                if ($prefix === 'layers') {
                    foreach ($data as $k => $v) {
                        if (is_array($v)) $layerDefinitions[$k] = $v;
                    }
                } elseif ($prefix === 'lyrmgrResources') {
                    foreach ($data as $k => $v) {
                        if (is_string($v)) $_nlsAliasesRuntime[$k] = $v;
                    }
                }
            }
        }
    } catch (\Throwable $e) {
        error_log('layers.php: config_bundle_store Fehler: ' . $e->getMessage());
    }
    // Fallback: wenn config_bundle_store noch leer ist, Dateien lesen
    if (empty($layerDefinitions)) {
        $layerData = ConfigReader::readAllLayerDefinitions();
        $layerDefinitions = $layerData['definitions'];
    }
} else {
    $layerData = ConfigReader::readAllLayerDefinitions();
    $layerDefinitions = $layerData['definitions'];
}

// Profil-spezifische NLS-Datei nur im Datei-Modus nachladen.
// In source=db ist catalog_document.__nlsAliases die Quelle der Wahrheit.
if (!$useCatalogDocument) {
    $_profileNlsBase = realpath(__DIR__ . '/../../../public/config') . '/';
    $_profileNlsSafe = preg_replace('/[^a-zA-Z0-9_\-]/', '', $group);
    $_profileNlsPath = ($_profileNlsSafe === 'public')
        ? $_profileNlsBase . 'lyrmgrResources.json'
        : $_profileNlsBase . $_profileNlsSafe . '/lyrmgrResources.json';
    if (file_exists($_profileNlsPath)) {
        $_profileNlsData = json_decode(file_get_contents($_profileNlsPath), true);
        if (is_array($_profileNlsData)) {
            $_nlsAliasesRuntime = array_merge($_nlsAliasesRuntime, $_profileNlsData);
        }
    }
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
        $structureList = [];
        if (array_keys($lyrmgr['structure']) === range(0, count($lyrmgr['structure']) - 1)) {
            // Array-Format (mit _key)
            foreach ($lyrmgr['structure'] as $entry) {
                if (!is_array($entry)) continue;
                $cid = $entry['_key'] ?? ($entry['key'] ?? ($entry['name'] ?? null));
                if (!$cid) continue;
                $structureList[$cid] = $entry;
            }
        } else {
            // Objekt-Format
            $structureList = $lyrmgr['structure'];
        }

        foreach ($structureList as $categoryId => $categoryDef) {
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
                $groupList = [];
                if (array_keys($categoryDef['items']) === range(0, count($categoryDef['items']) - 1)) {
                    // Array-Format (z.B. [{key,name,items}])
                    foreach ($categoryDef['items'] as $grpEntry) {
                        if (!is_array($grpEntry)) continue;
                        $gid = $grpEntry['key'] ?? ($grpEntry['name'] ?? null);
                        if (!$gid) continue;
                        $groupList[$gid] = $grpEntry;
                    }
                } else {
                    // Objekt-Format
                    $groupList = $categoryDef['items'];
                }

                foreach ($groupList as $groupId => $groupDef) {
                    // NLS-Lookup für Gruppen-Name, Fallback auf extractLayerName
                    $grpName = getNlsLabel($groupId);
                    if (!$grpName) $grpName = extractLayerName($groupId);
                    $groupData = [
                        'id'     => $groupId,
                        'name'   => $grpName,
                        'open'   => $groupDef['open'] ?? false,
                        'layers' => []
                    ];

                    // Legenden-Key aus lyrmgr.conf durchreichen + legendResources auflösen
                    if (isset($groupDef['legend']) && $groupDef['legend'] !== '') {
                        $groupData['legend'] = $groupDef['legend'];
                        $legInfo = getLegendLink($groupDef['legend']);
                        if ($legInfo) {
                            $groupData['legendLink']  = $legInfo['link'];
                            $groupData['legendTitle'] = $legInfo['title'];
                        }
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

// === Coalesce-Info anreichern (nur bei details=true, da url/params benötigt) ===
if ($details) {
    enrichCoalesceInfo($categories);
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
        'source'     => $lyrmgrSourceUsed
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
    $meta['cache'] = $bypassJsonCache ? 'bypass' : 'miss';

    // In Cache speichern
    if (!$bypassJsonCache) {
        $cached = $cache->set($cacheKey, ['data' => $flatLayers, 'meta' => $meta]);
        if (!$cached && $debug) {
            $meta['cacheError'] = $cache->getLastError();
            $meta['cacheWritable'] = $cache->isWritable();
        }
    }

    // HTTP Caching
    CacheHelper::setNoCache();

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
    'source'          => $lyrmgrSourceUsed
];

if ($debug) {
    $meta['debug'] = [
        'coreConfigPath'        => $layerData['path'],
        'layerFilesFound'       => $layerData['filesCount'],
        'layerDefinitionsCount' => count($layerDefinitions),
        'availableGroups'       => ConfigReader::listGroups(),
        'nlsAliasesRuntime'     => array_slice($_nlsAliasesRuntime, 0, 10, true),
        'docHasNlsAliases'      => isset($doc) && isset($doc['data']['__nlsAliases']) ? array_keys($doc['data']['__nlsAliases']) : 'doc-not-set',
    ];
}

$elapsed = round((microtime(true) - $startTime) * 1000);
$meta['responseTime'] = $elapsed . 'ms';
$meta['cache'] = $bypassJsonCache ? 'bypass' : 'miss';

// In Cache speichern
if (!$bypassJsonCache) {
    $cached = $cache->set($cacheKey, ['data' => $result, 'meta' => $meta]);
    if (!$cached && $debug) {
        $meta['cacheError'] = $cache->getLastError();
        $meta['cacheWritable'] = $cache->isWritable();
    }
}

// HTTP Caching
CacheHelper::setNoCache();

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

    foreach ($items as $key => $item) {
        if (is_string($item)) {
            // Einfache Layer-Referenz (String)
            $layerData = [
                'id'   => $item,
                'name' => getNlsLabel($item) ?: extractLayerName($item),
                'type' => 'layer'
            ];

            // Layer-Definition laden (für Details ODER Legend-Info)
            $def = findLayerDefinition($item, $layerDefinitions);

            if ($details && $def) {
                $layerData['url']       = isset($def['url']) ? normalizeAppProxyUrl($def['url']) : null;
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
                // Fallback: legend-Feld aus Layer-Definition direkt übernehmen
                // (für nicht-ArcGIS Layer wie GeoJSON, WMS etc.)
                if (!isset($layerData['legend']) && !empty($def['legend'])) {
                    $layerData['legend'] = $def['legend'];
                }
            }
            // Zusätzlich legendResources auflösen (für nicht-ArcGIS Legenden)
            if (isset($layerData['legend']) && !isset($layerData['legendLink'])) {
                $legInfo = getLegendLink($layerData['legend']);
                if ($legInfo) {
                    $layerData['legendLink']  = $legInfo['link'];
                    $layerData['legendTitle'] = $legInfo['title'];
                }
            }

            $layers[] = $layerData;

        } elseif (is_array($item) && isset($item['name'])) {
            // Gruppe oder Layer mit Metadaten
            $layerData = [
                'id'   => $item['name'],
                'name' => getNlsLabel($item['name']) ?: extractLayerName($item['name']),
                'type' => isset($item['items']) ? 'group' : 'layer',
                'open' => $item['open'] ?? false
            ];

            // Legenden-Key aus lyrmgr.conf durchreichen + legendResources auflösen
            if (isset($item['legend']) && $item['legend'] !== '') {
                $layerData['legend'] = $item['legend'];
                $legInfo = getLegendLink($item['legend']);
                if ($legInfo) {
                    $layerData['legendLink']  = $legInfo['link'];
                    $layerData['legendTitle'] = $legInfo['title'];
                }
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
                        $layerData['url']       = isset($def['url']) ? normalizeAppProxyUrl($def['url']) : null;
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
                    // Zusätzlich legendResources auflösen
                    if (isset($layerData['legend']) && !isset($layerData['legendLink'])) {
                        $legInfo = getLegendLink($layerData['legend']);
                        if ($legInfo) {
                            $layerData['legendLink']  = $legInfo['link'];
                            $layerData['legendTitle'] = $legInfo['title'];
                        }
                    }
                }
            }

            if (isset($item['items'])) {
                $layerData['layers'] = processLayerItems($item['items'], $layerDefinitions, $details);
            }

            $layers[] = $layerData;

        } elseif (is_array($item) && is_string($key) && !is_numeric($key)) {
            // Assoziatives Array: Key ist die Gruppen-ID
            // (z.B. oereb_raumplanung.items = { rp_liegenschaften: {...}, rp_rechtskraeftig: {...} })
            $grpName = getNlsLabel($key);
            if (!$grpName) $grpName = extractLayerName($key);

            $layerData = [
                'id'   => $key,
                'name' => $grpName,
                'type' => 'group',
                'open' => $item['open'] ?? false
            ];

            if (isset($item['legend']) && $item['legend'] !== '') {
                $layerData['legend'] = $item['legend'];
                $legInfo = getLegendLink($item['legend']);
                if ($legInfo) {
                    $layerData['legendLink']  = $legInfo['link'];
                    $layerData['legendTitle'] = $legInfo['title'];
                }
            }
            if (!empty($item['selectAll'])) {
                $layerData['selectAll'] = true;
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
 * Lädt ALLE NLS-Labels (lyrmgrResources*.json) und gibt den Display-Namen zurück.
 * Cacht die Dateien nach dem ersten Laden.
 * Pfad: Umgebungs-Core nls/de (DEV und PROD: core).
 * 
 * @param string $key  Schlüssel (z.B. 'grundlagen', 'gis_oereb/nw_nutzungsplanung_def')
 * @return string|null  NLS-Label oder null wenn nicht gefunden
 */
function getNlsLabel($key) {
    static $nls = null;
    if ($nls === null) {
        $nls = [];
  // Basis: Umgebungs-Core (DEV und PROD: core)
        $nlsDirBase = ConfigReader::getCoreNlsPath('de');
        if ($nlsDirBase && is_dir($nlsDirBase)) {
            foreach (glob($nlsDirBase . '/lyrmgrResources*.json') as $f) {
                $data = json_decode(file_get_contents($f), true);
                if (is_array($data)) {
                    $nls = array_merge($nls, $data);
                }
            }
        }
        // Überladungen: app-lokaler core/nls/de Pfad, überschreibt Basis
        $nlsDirOverride = TnetCorePaths::getAppCoreNlsPath('de');
        if ($nlsDirOverride && is_dir($nlsDirOverride) && $nlsDirOverride !== $nlsDirBase) {
            foreach (glob($nlsDirOverride . '/lyrmgrResources*.json') as $f) {
                $data = json_decode(file_get_contents($f), true);
                if (is_array($data)) {
                    $nls = array_merge($nls, $data);
                }
            }
        }
    }
    // Suche: desc_<key> (exakt)
    $lookupKey = 'desc_' . $key;
    // DB-Aliases bevorzugen (aus config_bundle_store, geladen in $_nlsAliasesRuntime)
    global $_nlsAliasesRuntime;
    if (!empty($_nlsAliasesRuntime) && isset($_nlsAliasesRuntime[$lookupKey])) {
        return $_nlsAliasesRuntime[$lookupKey];
    }
    if (isset($nls[$lookupKey])) {
        return $nls[$lookupKey];
    }
    return null;
}

/**
 * Löst einen Legend-Key gegen legendResources_*.json auf.
 * Gibt Link und Titel zurück, falls vorhanden.
 * 
 * @param string $legendKey  z.B. 'information', 'schweizmobil', 'gastro'
 * @return array|null  ['link' => '...', 'title' => '...'] oder null
 */
function getLegendLink($legendKey) {
    static $legendRes = null;
    if ($legendRes === null) {
        $legendRes = [];
        $nlsDirBase = ConfigReader::getCoreNlsPath('de');
        if ($nlsDirBase && is_dir($nlsDirBase)) {
            foreach (glob($nlsDirBase . '/legendResources*.json') as $f) {
                // Backup-Dateien (.bak) ignorieren
                if (preg_match('/\.bak$/', $f)) continue;
                $data = json_decode(file_get_contents($f), true);
                if (is_array($data)) {
                    $legendRes = array_merge($legendRes, $data);
                }
            }
        }
        $nlsDirOverride = TnetCorePaths::getAppCoreNlsPath('de');
        if ($nlsDirOverride && is_dir($nlsDirOverride) && $nlsDirOverride !== $nlsDirBase) {
            foreach (glob($nlsDirOverride . '/legendResources*.json') as $f) {
                if (preg_match('/\.bak$/', $f)) continue;
                $data = json_decode(file_get_contents($f), true);
                if (is_array($data)) {
                    $legendRes = array_merge($legendRes, $data);
                }
            }
        }
    }
    $link  = $legendRes[$legendKey . '_link'] ?? null;
    $title = $legendRes[$legendKey . '_title'] ?? null;
    if ($link) {
        return ['link' => $link, 'title' => $title];
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

// ===== COALESCE-ERKENNUNG (FILE-PFAD) =====

/**
 * Reichert Coalesce-Information für den File-Pfad an.
 * Erkennt Gruppen, deren rekursive Blatt-Layer denselben ArcGIS MapServer-
 * Dienst mit individuellen show:N-Sublayern verwenden, und setzt
 * serviceUrl + coalesceGroup auf diesen Gruppen.
 *
 * @param array &$categories  Kategorie-Array (wird in-place modifiziert)
 */
function enrichCoalesceInfo(&$categories) {
    foreach ($categories as &$cat) {
        if (isset($cat['subcategories'])) {
            enrichCoalesceWalk($cat['subcategories']);
        }
    }
}

/**
 * Rekursive Hilfsfunktion: Durchläuft Knoten und setzt Coalesce-Info.
 *
 * @param array &$nodes  Knoten-Array (subcategories, groups oder layers)
 */
function enrichCoalesceWalk(&$nodes) {
    global $appBasePath;

    foreach ($nodes as &$node) {
        // Rekursiv in Kind-Arrays absteigen (Bottom-Up: Kinder zuerst)
        foreach (['subcategories', 'groups', 'layers'] as $childKey) {
            if (isset($node[$childKey]) && is_array($node[$childKey])) {
                enrichCoalesceWalk($node[$childKey]);
            }
        }

        // Coalesce nur auf Knoten mit layers-Array
        if (!isset($node['layers']) || !is_array($node['layers'])) {
            continue;
        }

        // Bereits gesetzte Coalesce-Info nicht überschreiben
        if (isset($node['serviceUrl'])) continue;

        // Prüfen ob ALLE rekursiven Blatt-Layer denselben MapServer teilen
        $commonPath = getCommonMapServerPath($node['layers']);
        if ($commonPath === null) continue;

        // ≥2 Blatt-Layer nötig für Coalesce
        $leafCount = countCoalesceLeaves($node['layers']);
        if ($leafCount < 2) continue;

        // serviceUrl im tnet/agsproxy-Format (wie DB-Pfad)
        $node['serviceUrl'] = ($appBasePath !== '' ? $appBasePath : '') . '/tnet/agsproxy/' . $commonPath;

        // coalesceGroup: Dienst-Name (letztes Pfad-Segment vor /MapServer)
        $pathParts = explode('/', rtrim($commonPath, '/'));
        // "MapServer" ist das letzte Element — davor kommt der Service-Name
        $node['coalesceGroup'] = $pathParts[count($pathParts) - 2] ?? $node['id'];
    }
}

/**
 * Prüft ob ALLE rekursiven Blatt-Layer denselben MapServer-Dienst
 * mit individuellem show:N-Parameter teilen.
 *
 * @param array $layers  Verschachtelte Layer/Gruppen
 * @return string|null   Gemeinsamer MapServer-Pfad oder null
 */
function getCommonMapServerPath($layers) {
    $commonPath = null;

    foreach ($layers as $layer) {
        if (isset($layer['layers']) && is_array($layer['layers']) && count($layer['layers']) > 0) {
            // Sub-Gruppe → rekursiv prüfen
            $subPath = getCommonMapServerPath($layer['layers']);
            if ($subPath === null) return null;

            if ($commonPath === null) {
                $commonPath = $subPath;
            } elseif (strcasecmp($commonPath, $subPath) !== 0) {
                return null; // Verschiedene MapServer-Dienste
            }
        } else {
            // Blatt-Layer: URL und LAYERS-Param prüfen
            $url = $layer['url'] ?? '';
            $layersParam = $layer['params']['LAYERS'] ?? '';

            // Nur individuelle Sublayer (show:N, genau eine Zahl)
            if (!preg_match('/^show:\d+$/', $layersParam)) return null;

            // MapServer-Pfad aus URL extrahieren
            $path = extractMapServerPathForCoalesce($url);
            if ($path === null) return null;

            if ($commonPath === null) {
                $commonPath = $path;
            } elseif (strcasecmp($commonPath, $path) !== 0) {
                return null; // Verschiedene MapServer-Dienste
            }
        }
    }

    return $commonPath;
}

/**
 * Extrahiert den MapServer-Pfad aus einer Layer-URL.
 *
 * @param string $url  z.B. "/maps/agsproxy.php?path=gis_oereb/nw_gewaesserraum_DEF/MapServer"
 * @return string|null z.B. "gis_oereb/nw_gewaesserraum_DEF/MapServer"
 */
function extractMapServerPathForCoalesce($url) {
    // Format 1: agsproxy.php?path=SERVICE/MapServer
    if (preg_match('/[?&]path=([^&]+\/MapServer)/i', $url, $m)) {
        return $m[1];
    }
    // Format 2: /maps/tnet/agsproxy/SERVICE/MapServer (Rewrite-URL)
    if (preg_match('/\/agsproxy\/(.+\/MapServer)/i', $url, $m)) {
        return $m[1];
    }
    return null;
}

/**
 * Zählt rekursiv alle Blatt-Layer.
 *
 * @param array $layers  Verschachtelte Layer/Gruppen
 * @return int
 */
function countCoalesceLeaves($layers) {
    $count = 0;
    foreach ($layers as $layer) {
        if (isset($layer['layers']) && is_array($layer['layers']) && count($layer['layers']) > 0) {
            $count += countCoalesceLeaves($layer['layers']);
        } else {
            $count++;
        }
    }
    return $count;
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
            'url'             => normalizeAppProxyUrl($row['url']),
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
        // NLS-Lookup für alle Knoten-Typen (Gruppen, Subcategories UND Layer)
        $nlsLabel = getNlsLabel($nodeId);
        if ($nlsLabel) {
            $nodeName = $nlsLabel;
        } elseif ($row['node_kind'] !== 'layer' && strpos($nodeName, '/') !== false) {
            // Pfad-basierter Name bei Nicht-Layern → nur letztes Segment verwenden
            $nodeName = extractLayerName($nodeId);
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
            $node['serviceUrl']     = normalizeAppProxyUrl($row['service_url']);
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
            $node['url']           = normalizeAppProxyUrl($row['url']);
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
