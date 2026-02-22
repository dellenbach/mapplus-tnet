<?php
/**
 * search-proxy.php  v1.4
 * Suche für den Mobile-Client:
 *   1. Layer-Suche via NLS-Dateien (lyrmgrResources*.json)
 *   2. Standort-Suche via swisstopo Geocoder API
 *   Resultate werden gruppiert zurückgegeben.
 *
 * Parameter:
 *   q      = Suchbegriff (min. 2 Zeichen)
 *   limit  = max. Resultate pro Typ (4-20, default 8)
 *   canton = Kanton-Filter: NW, OW oder leer (beide)
 *   scope  = Such-Typ: locations, layers oder leer (alles)
 *
 * Aufruf: /maps/tnet/api/search-proxy.php?q=wald&limit=8&canton=NW&scope=layers
 *
 * @version  1.4
 * @date     2026-02-22
 */
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: no-store, max-age=0');

$q      = isset($_GET['q']) ? trim($_GET['q']) : '';
$limit  = max(4, min(20, (int)($_GET['limit'] ?? 8)));
$canton = isset($_GET['canton']) ? strtoupper(trim($_GET['canton'])) : '';
$scope  = isset($_GET['scope']) ? strtolower(trim($_GET['scope'])) : '';
$debug  = isset($_GET['debug']) && $_GET['debug'] === '1';

// Validierung
if ($canton !== 'NW' && $canton !== 'OW') $canton = '';
if ($scope !== 'locations' && $scope !== 'layers') $scope = '';

if ($q === '' || mb_strlen($q) < 2) {
    echo json_encode(['numRows' => 0, 'items' => [], 'groups' => []]);
    exit;
}

// 1. Layer-Suche (nur wenn scope != 'locations')
$layerItems = ($scope !== 'locations') ? searchLayers($q, $limit) : [];

// 2. Standort-Suche (nur wenn scope != 'layers')
$locationItems = ($scope !== 'layers') ? searchLocations($q, $limit, $canton) : [];

// Ergebnis zusammenstellen
$allItems = array_merge($locationItems, $layerItems);
$groups   = buildGroups($layerItems, $locationItems);

if ($debug) {
    echo json_encode([
        'debug'         => true,
        'q'             => $q,
        'layerCount'    => count($layerItems),
        'locationCount' => count($locationItems),
        'layerItems'    => $layerItems,
        'locationItems' => $locationItems,
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    exit;
}

echo json_encode([
    'numRows' => count($allItems),
    'items'   => $allItems,
    'groups'  => $groups,
], JSON_UNESCAPED_UNICODE);
exit;


// ---

/**
 * Durchsucht alle lyrmgrResources*.json im NLS-Verzeichnis
 * nach dem Suchbegriff (case-insensitiv, Teilstring).
 */
function searchLayers(string $q, int $limit): array
{
    $nlsDirs = [
        '/www/core/nls/de',
        dirname(__DIR__, 3) . '/core/nls/de',
    ];

    $nlsDir = null;
    foreach ($nlsDirs as $dir) {
        if (is_dir($dir)) {
            $nlsDir = $dir;
            break;
        }
    }
    if (!$nlsDir) return [];

    $files = glob($nlsDir . '/lyrmgrResources*.json');
    if (empty($files)) return [];

    $qLower  = mb_strtolower($q, 'UTF-8');
    $results = [];

    foreach ($files as $file) {
        $raw = @file_get_contents($file);
        if (!$raw) continue;
        $data = @json_decode($raw, true);
        if (!$data) continue;

        foreach ($data as $key => $label) {
            if (strncmp($key, 'desc_', 5) !== 0) continue;
            if (!is_string($label)) continue;
            if (mb_strpos(mb_strtolower($label, 'UTF-8'), $qLower, 0, 'UTF-8') === false) continue;

            $layerId = substr($key, 5);
            $results[] = [
                'id'    => $layerId,
                'label' => $label,
                'type'  => 'layer',
                'layer' => $layerId,
                'x'     => null,
                'y'     => null,
            ];

            if (count($results) >= $limit) break 2;
        }
    }

    return $results;
}

/**
 * Standort-Suche via swisstopo Geocoder API (LV95 / EPSG:2056).
 * x = Northing (ca. 1.2 Mio), y = Easting (ca. 2.6 Mio)
 * Gefiltert auf Kanton Nidwalden (NW) + Obwalden (OW) via Bounding Box.
 * Optional: $canton = 'NW' oder 'OW' für Eingrenzung auf einen Kanton.
 */
function searchLocations(string $q, int $limit, string $canton = ''): array
{
    // Bounding Boxen in LV95 (minEast, minNorth, maxEast, maxNorth)
    $bboxes = [
        ''   => '2632000,1158000,2700000,1215000',   // NW + OW
        'NW' => '2658000,1185000,2685000,1210000',   // Nidwalden
        'OW' => '2632000,1158000,2680000,1200000',   // Obwalden
    ];
    $bbox = $bboxes[$canton] ?? $bboxes[''];

    // Regex-Filter: nur gewählten Kanton oder beide
    $cantonFilter = $canton ?: 'NW|OW';

    // Mehr Resultate anfragen um nach Filterung genug zu haben
    $fetchLimit = $limit * 4;

    $url = 'https://api3.geo.admin.ch/rest/services/api/SearchServer'
        . '?searchText=' . rawurlencode($q)
        . '&lang=de&type=locations&sr=2056'
        . '&bbox=' . $bbox
        . '&limit=' . $fetchLimit;

    $ctx = stream_context_create(['http' => [
        'method'        => 'GET',
        'timeout'       => 5,
        'ignore_errors' => true,
        'header'        => "User-Agent: GIS-Daten-Mobile/1.3\r\n",
    ]]);

    $raw = @file_get_contents($url, false, $ctx);
    if (!$raw) return [];

    $data = @json_decode($raw, true);
    if (!$data) return [];

    $out = [];
    foreach (($data['results'] ?? []) as $r) {
        $a     = $r['attrs'] ?? [];
        $label = strip_tags($a['label'] ?? $a['detail'] ?? '');
        $label = preg_replace('/\bswisstopo\b\s*/i', '', $label);
        $label = trim($label);
        if (!$label) continue;

        // Sekundär-Filter: nur gewählte(n) Kanton(e)
        $detail = $a['detail'] ?? '';
        if (!preg_match('/\b(' . $cantonFilter . ')\b/i', $label . ' ' . $detail)) continue;

        $out[] = [
            'id'    => $a['id'] ?? uniqid(),
            'label' => $label,
            'x'     => isset($a['x']) ? (float)$a['x'] : null,
            'y'     => isset($a['y']) ? (float)$a['y'] : null,
            'type'  => 'location',
            'layer' => null,
        ];

        if (count($out) >= $limit) break;
    }
    return $out;
}

/**
 * Gruppen-Struktur aufbauen (Layer + Standorte).
 */
function buildGroups(array $layers, array $locations): array
{
    $groups = [];
    if (!empty($locations)) {
        $groups[] = ['label' => 'Standorte', 'type' => 'location', 'items' => $locations];
    }
    if (!empty($layers)) {
        $groups[] = ['label' => 'Layer', 'type' => 'layer', 'items' => $layers];
    }
    return $groups;
}