<?php
/**
 * TNET API v1 - Bookmarks Endpoint
 *
 * Liefert Karten-Bookmarks (vorkonfigurierte Kartenansichten) im Schema v2.
 * v1-Daten in der Quelldatei werden zur Laufzeit normalisiert
 * (siehe BookmarkNormalizer).
 *
 * Parameter:
 *   ?name=xxx          -> Einzelner Bookmark als v2-Objekt (für Kartenanwendung)
 *   ?source=db|file    -> Datenquelle (Pflicht; analog layers.php)
 *   ?hierarchy=1       -> Fügt pro Bookmark serviceGroups[] hinzu (Dienst-Struktur)
 *   ?hierarchy=2       -> Nested tree (kein layers[])
 *   ?profile=xxx       -> Filtert Layer auf gültige Layer des Profils (z.B. public, nwpro, marco)
 *                         Setzt hierarchy >= 1 implizit voraus. Nur Dienste mit
 *                         mindestens einem gültigen Layer werden geliefert.
 *   ?full=1            -> Liste enthält alle Felder (nicht nur id/name/aliases)
 *
 * Verwendung durch Kartenanwendung:
 *   GET /api/v1/bookmarks.php?name=nw_oereb&source=db&hierarchy=2&profile=nwpro
 *
 * @version    2.2
 * @date       2026-06-17
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

require_once __DIR__ . '/../includes/ApiResponse.php';
require_once __DIR__ . '/../includes/CacheHelper.php';
require_once __DIR__ . '/../includes/BookmarkNormalizer.php';
require_once __DIR__ . '/../includes/BookmarkRepository.php';
require_once __DIR__ . '/../includes/ConfigReader.php';
require_once __DIR__ . '/../includes/StagingImportRepository.php';

ApiResponse::setHeaders();

// === Parameter ===
$name      = $_GET['name']      ?? $_GET['bookmark'] ?? null;
$source    = strtolower(trim($_GET['source'] ?? ''));
// hierarchy=1: flache serviceGroups (svc + layerIds + opacity)
// hierarchy=2: serviceGroups mit nested tree (svc + tree + opacity)
$hierarchy = isset($_GET['hierarchy']) ? max(0, (int)$_GET['hierarchy']) : 0;
$full      = isset($_GET['full'])      && $_GET['full']      === '1';
// profile: wenn gesetzt, werden Layer serverseitig auf gültige Layer des Profils gefiltert
$profile   = isset($_GET['profile']) ? trim($_GET['profile']) : null;
if ($profile === '') $profile = null;
// names=1: fügt name-Felder (aus Katalog) zu Tree-Knoten und svc-Gruppen hinzu
$withNames = isset($_GET['names']) && $_GET['names'] === '1';

// source ist Pflicht (analog layers.php) — Ausnahme: Kartenanwendung sendet keinen source-Parameter
// → Fallback auf 'db' für Rückwärtskompatibilität, aber source=file muss explizit gesetzt werden
if ($source === '' || $source === 'auto') {
    $source = 'db'; // Kartenanwendungs-Default: DB
}
if (!in_array($source, ['db', 'file'], true)) {
    ApiResponse::error("Ungueltiger source-Parameter. Verwende source=db oder source=file.", 400);
}

// === Daten laden (DB oder File) ===
if ($source === 'db') {
    try {
        $result   = BookmarkRepository::loadAll();
        $bookmarks = $result['data'];
        $revision  = $result['revision'] ?? null;
    } catch (\Throwable $e) {
        ApiResponse::serverError('DB-Fehler beim Laden der Bookmarks: ' . $e->getMessage());
    }
} else {
    // File-Quelle
    $bookmarksFile = realpath(__DIR__ . '/../../data/map-bookmarks-all.json');
    if (!$bookmarksFile || !file_exists($bookmarksFile)) {
        ApiResponse::notFound('Bookmarks data file');
    }
    $json = file_get_contents($bookmarksFile);
    $decoded = json_decode($json, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        ApiResponse::serverError('Failed to parse bookmarks: ' . json_last_error_msg());
    }
    if (!is_array($decoded)) {
        ApiResponse::serverError('Bookmarks file is not a JSON array');
    }
    $bookmarks = BookmarkNormalizer::normalizeAll($decoded);
    $revision  = null;
    CacheHelper::handleLastModified($bookmarksFile);
}

CacheHelper::setNoCache();

// === NLS-Namen ausschliesslich aus DB (StagingImportRepository Bundles) laden ===
// Kein JSON-Fallback. Wenn die DB leer/nicht verfügbar ist, wird ein leeres Array
// zurückgegeben → formatLayerIdPart() liefert dann den rohen Layer-ID-Teil.
// Scope-Reihenfolge: core -> override/sitecore -> profile (wie listAllLayers()).
function loadProfileLayerNames(string $profile): array {
    $nlsData = [];

    try {
        $scopeRank = ['core' => 1, 'override' => 2, 'sitecore' => 2, 'profile' => 3];
        $bundles = StagingImportRepository::loadAllSafe();
        if (empty($bundles)) return []; // DB leer → kein Fallback
        usort($bundles, function ($a, $b) use ($scopeRank) {
            $ra = $scopeRank[$a['scope'] ?? 'core'] ?? 1;
            $rb = $scopeRank[$b['scope'] ?? 'core'] ?? 1;
            if ($ra === $rb) return strcmp($a['kuerzel'] ?? '', $b['kuerzel'] ?? '');
            return $ra - $rb;
        });
        foreach ($bundles as $bundle) {
            $bScope   = $bundle['scope'] ?? 'core';
            $bProfile = $bundle['profile'] ?? null;
            // Profil-Bundles nur für das aktuelle Profil
            if ($bScope === 'profile') {
                if (!$profile || $bProfile !== $profile) continue;
            }
            foreach (($bundle['files'] ?? []) as $file) {
                if (($file['prefix'] ?? '') !== 'lyrmgrResources') continue;
                $data = $file['data'] ?? null;
                if (is_array($data) && !empty($data)) {
                    $nlsData = array_merge($nlsData, $data);
                }
            }
        }
    } catch (\Throwable $e) {
        return []; // DB nicht verfügbar
    }

    // Map aufbauen: layer_id => display_name
    $map = [];
    foreach ($nlsData as $key => $value) {
        if (strpos($key, 'desc_') !== 0) continue;
        $raw = substr($key, 5);
        $map[str_replace('_', '/', $raw)] = $value;
        $map[$raw] = $value;
    }
    return $map;
}

// Formatiert einen Layer-ID-Anteil als lesbaren Namen (Fallback wenn kein NLS-Label).
// z.B. "nw_gewaesserraum_def" → "Nw Gewaesserraum Def"
function formatLayerIdPart(string $id): string {
    $parts = explode('/', $id);
    $last = end($parts);
    return ucwords(str_replace(['_', '-'], ' ', $last));
}

// === Profil-Filter: Layer-IDs aus dem Katalog für ein Profil laden ===
// Gibt ein Set aller Layer-IDs zurück, die im Profil konfiguriert sind.
// Bei DB-Fehler oder unbekanntem Profil wird null zurückgegeben (→ kein Filter).
function loadProfileLayerIds(string $profile): ?array {
    require_once __DIR__ . '/../includes/Database.php';
    try {
        $pdo = Database::getConnection();
        $stmt = $pdo->prepare(
            "SELECT ld.layer_id
             FROM mapplusconf.catalog_node cn
             JOIN mapplusconf.profile p ON cn.profile_id = p.id AND p.is_active = true
             JOIN mapplusconf.layer_definition ld ON cn.layer_id = ld.layer_id
             WHERE p.code = :profile AND ld.layer_id IS NOT NULL"
        );
        $stmt->execute(['profile' => $profile]);
        $ids = $stmt->fetchAll(PDO::FETCH_COLUMN);
        if (empty($ids)) return null; // Profil unbekannt oder leer
        return array_flip($ids); // Lookup-Set: id => true
    } catch (\Throwable $e) {
        return null; // Bei Fehler kein Filter
    }
}

// === Profil-Filter auf Bookmark anwenden ===
// Entfernt Layer die nicht im Profil-Set sind.
// Bei hierarchy=2 (tree): filtert Knoten rekursiv aus dem tree.
// Bei hierarchy=1 (flat): filtert layerIds.
// Bei hierarchy=0: filtert layers[].
function filterBookmarkByProfile(array $bookmark, array $profileIds, int $hierarchy): array {
    if ($hierarchy >= 2) {
        // Tree-Modus: serviceGroups[].tree[] rekursiv filtern
        if (!isset($bookmark['serviceGroups'])) return $bookmark;
        $filteredGroups = [];
        foreach ($bookmark['serviceGroups'] as $group) {
            $group['tree'] = filterTreeNodes($group['tree'] ?? [], $profileIds);
            if (!empty($group['tree'])) {
                $filteredGroups[] = $group;
            }
        }
        $bookmark['serviceGroups'] = $filteredGroups;
    } elseif ($hierarchy >= 1) {
        // Flat serviceGroups: layerIds filtern
        if (!isset($bookmark['serviceGroups'])) return $bookmark;
        $filteredGroups = [];
        foreach ($bookmark['serviceGroups'] as $group) {
            $filtered = array_values(array_filter(
                $group['layerIds'] ?? [],
                function($id) use ($profileIds) { return isset($profileIds[$id]); }
            ));
            if (!empty($filtered)) {
                $group['layerIds'] = $filtered;
                $filteredGroups[] = $group;
            }
        }
        $bookmark['serviceGroups'] = $filteredGroups;
    } else {
        // Kein hierarchy: layers[] direkt filtern
        $bookmark['layers'] = array_values(array_filter(
            $bookmark['layers'] ?? [],
            function($l) use ($profileIds) {
                $id = is_array($l) ? ($l['id'] ?? '') : (string)$l;
                return isset($profileIds[$id]);
            }
        ));
    }
    return $bookmark;
}

// Rekursive Hilfsfunktion: Baumknoten filtern, Kinder ebenfalls.
// Ein Knoten bleibt wenn er selbst im Profil ist ODER mindestens ein Kind bleibt.
function filterTreeNodes(array $nodes, array $profileIds): array {
    $result = [];
    foreach ($nodes as $node) {
        $children = filterTreeNodes($node['children'] ?? [], $profileIds);
        $inProfile = isset($profileIds[$node['id'] ?? '']);
        if ($inProfile || !empty($children)) {
            $node['children'] = $children;
            $result[] = $node;
        }
    }
    return $result;
}

// === Hierarchie-Erweiterung (Dienst-Struktur pro Bookmark) ===
// Ermittelt aus layers[].id die Dienst-Gruppen (erste 2 Pfad-Segmente).
// Jede Gruppe hat: svc (String), layerIds (Array), opacity (erster non-null Wert).
// Der Karteninhalt kann serviceGroups[] direkt nutzen ohne eigene Aggregation.
function buildServiceGroups(array $layers): array {
    $groups   = [];
    $svcOrder = [];
    foreach ($layers as $layer) {
        $id   = is_array($layer) ? ($layer['id'] ?? '') : (string)$layer;
        $parts = explode('/', $id);
        $svc  = count($parts) >= 2 ? $parts[0] . '/' . $parts[1] : $parts[0];
        if (!isset($svcOrder[$svc])) {
            $svcOrder[$svc] = count($groups);
            $groups[]        = ['svc' => $svc, 'layerIds' => [], 'opacity' => null];
        }
        $idx = $svcOrder[$svc];
        $groups[$idx]['layerIds'][] = $id;
        // Erste non-null opacity der Gruppe merken
        if ($groups[$idx]['opacity'] === null && is_array($layer) && isset($layer['opacity']) && $layer['opacity'] !== null) {
            $groups[$idx]['opacity'] = (float)$layer['opacity'];
        }
    }
    return $groups;
}

// === Hierarchie V2: Dienst-Gruppen mit nested tree (hierarchy=2) ===
// Gleiche Gruppierung wie buildServiceGroups, aber zusätzlich wird pro Gruppe
// ein tree[] aufgebaut: jeder Knoten hat id, visible, opacity, filter, children[].
// Kinder = alle Layer deren id mit "<parent-id>/" beginnt.
// Nur direkte Kinder des jeweiligen Parents werden eingehängt (nicht rekursiv tief).
// $nameMap (optional): layer_id => { name, coalesce_group } — aus loadProfileLayerNames()
function buildServiceGroupsTree(array $layers, array $nameMap = []): array {
    // Zuerst flache Gruppen aufbauen
    $groups = buildServiceGroups($layers);

    // Layer-Objekte als Lookup: id => layer
    $layerMap = [];
    foreach ($layers as $layer) {
        $id = is_array($layer) ? ($layer['id'] ?? '') : (string)$layer;
        if ($id !== '') {
            $layerMap[$id] = is_array($layer) ? $layer : ['id' => $id, 'visible' => true, 'opacity' => null, 'order' => null, 'filter' => null];
        }
    }

    // Pro Gruppe: Tree aus layerIds aufbauen
    foreach ($groups as &$group) {
        $ids = $group['layerIds'];
        $svc = $group['svc'];

        // Gruppen-Name bestimmen: NLS-Name des svc-Schlüssels
        if (!empty($nameMap)) {
            $svcParts = explode('/', $svc);
            $svcLastPart = end($svcParts);
            $groupName = $nameMap[$svc] ?? $nameMap[$svcLastPart] ?? null;
            $group['name'] = $groupName ?: formatLayerIdPart($svc);
        }

        // Knoten-Array: id => node (ohne children, wird unten befüllt)
        $nodes = [];
        foreach ($ids as $id) {
            $l = $layerMap[$id] ?? ['id' => $id, 'visible' => true, 'opacity' => null, 'order' => null, 'filter' => null];
            $node = [
                'id'       => $id,
                'visible'  => (bool)($l['visible'] ?? true),
                'opacity'  => $l['opacity'] ?? null,
                'order'    => $l['order'] ?? null,
                'filter'   => $l['filter'] ?? null,
                'children' => [],
            ];
            // Name aus nameMap (direkt String) oder formatiert
            if (!empty($nameMap)) {
                $node['name'] = $nameMap[$id] ?? formatLayerIdPart($id);
            }
            $nodes[$id] = $node;
        }

        // Eltern-Kind-Beziehungen: id B ist Kind von A wenn B = A + '/' + ...
        // Wir hängen nur an den *längsten* passenden Eltern (direktes Parent)
        $roots = [];
        foreach ($ids as $id) {
            $bestParent = null;
            $bestLen    = -1;
            foreach ($ids as $candidate) {
                if ($candidate !== $id && strpos($id, $candidate . '/') === 0) {
                    $len = strlen($candidate);
                    if ($len > $bestLen) {
                        $bestLen    = $len;
                        $bestParent = $candidate;
                    }
                }
            }
            if ($bestParent !== null) {
                $nodes[$bestParent]['children'][] = &$nodes[$id];
            } else {
                $roots[] = &$nodes[$id];
            }
        }

        $group['tree'] = $roots;
        unset($group['layerIds']); // layerIds im tree-Modus nicht redundant mitliefern
    }
    unset($group); // Referenz-Sicherheit

    return $groups;
}

// === Einzelner Bookmark (für Kartenanwendung) ===
if ($name !== null) {
    $found = BookmarkNormalizer::findByName($bookmarks, (string)$name);
    if ($found === null) {
        ApiResponse::notFound("Bookmark '{$name}'");
    }

    // NLS-Namen vorab laden wenn angefordert
    $nameMap = ($withNames && $profile !== null) ? loadProfileLayerNames($profile) : [];

    if ($hierarchy >= 1) {
        $found['serviceGroups'] = ($hierarchy >= 2)
            ? buildServiceGroupsTree($found['layers'] ?? [], $nameMap)
            : buildServiceGroups($found['layers'] ?? []);
        // Bei hierarchy=2: layers[] ist redundant — alle Infos stecken im tree.
        if ($hierarchy >= 2) {
            unset($found['layers']);
        }
    }
    // Profil-Filter: nur Layer liefern die im Profil vorhanden sind
    if ($profile !== null) {
        $profileIds = loadProfileLayerIds($profile);
        if ($profileIds !== null) {
            $found = filterBookmarkByProfile($found, $profileIds, $hierarchy);
            $found['_profile'] = $profile;
        }
    }
    ApiResponse::success($found);
}

// === Alle Bookmarks auflisten ===
$listing = [];
foreach ($bookmarks as $bookmark) {
    if (!is_array($bookmark)) continue;
    $id = $bookmark['id'] ?? null;
    if (!$id) continue;

    if ($full) {
        // Vollständige v2-Objekte (für SLM / Editor)
        $entry = $bookmark;
        if ($hierarchy >= 1) {
            $entry['serviceGroups'] = ($hierarchy >= 2)
                ? buildServiceGroupsTree($bookmark['layers'] ?? [])
                : buildServiceGroups($bookmark['layers'] ?? []);
            if ($hierarchy >= 2) {
                unset($entry['layers']); // redundant bei tree
            }
        }
    } else {
        // Kompakte Liste (Standard)
        $entry = [
            'id'             => $id,
            'name'           => $bookmark['name'] ?? $id,
            'aliases'        => $bookmark['aliases'] ?? [],
            'basemapColorMode' => $bookmark['basemapColorMode'] ?? 'color',
        ];
    }
    $listing[] = $entry;
}

$meta = [
    'count'         => count($listing),
    'source'        => $source,
    'hierarchy'     => $hierarchy, // 0=nein, 1=flat serviceGroups, 2=nested tree
    'schemaVersion' => 2,
    'usage'         => 'GET /api/v1/bookmarks.php?name=id&source=db',
];
if ($revision !== null) {
    $meta['revision'] = $revision;
}

ApiResponse::success($listing, $meta);
