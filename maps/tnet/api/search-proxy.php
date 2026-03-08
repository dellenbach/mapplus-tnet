<?php
/**
 * search-proxy.php  v2.0
 * Suche für den Mobile-Client:
 *   1. Layer-Suche via NLS-Dateien (lyrmgrResources*.json)
 *   2. Standort-Suche via swisstopo Geocoder API (Orte + Adressen getrennt)
 *   3. Feature-Suche via swisstopo featuresearch API (Strassen, Gebäude)
 *   4. Geographische Namen via swisstopo MapServer/find (swissNAMES3D)
 *   Resultate: gruppiert (Adressen / Orte / Themen), dedupliziert, natural-sortiert.
 *   Ortfilter: Grenzen-Polygone (boundaries-simplified.json) — Kantone & Gemeinden.
 *
 * Boundary-Management API (?action=boundaries):
 *   - op=list                                        Alle Boundaries auflisten
 *   - op=add&key=..&type=canton|municipality&bfs=..  Boundary von swisstopo holen
 *   - op=delete&key=..                               Boundary entfernen
 *
 * @version  2.0
 * @date     2026-02-22
 */
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: public, max-age=300');
header('Vary: Accept-Encoding');

// Gzip-Komprimierung aktivieren
if (!ob_start('ob_gzhandler')) ob_start();

// -- Grenzen-Polygone laden (vereinfacht, LV95) ------------------------------
$_cantonBoundaries = null;
function getCantonBoundaries(): array {
    global $_cantonBoundaries;
    if ($_cantonBoundaries !== null) return $_cantonBoundaries;
    $paths = [
        '/data/base/boundaries-simplified.json',
        __DIR__ . '/../config/boundaries-simplified.json',
    ];
    foreach ($paths as $p) {
        if (file_exists($p)) {
            $raw = @file_get_contents($p);
            if ($raw) {
                $_cantonBoundaries = @json_decode($raw, true) ?: [];
                return $_cantonBoundaries;
            }
        }
    }
    $_cantonBoundaries = [];
    return $_cantonBoundaries;
}

/**
 * Ray-Casting Point-in-Polygon Test.
 * @param float $px  X-Koordinate (Easting in LV95)
 * @param float $py  Y-Koordinate (Northing in LV95)
 * @param array $ring  Ring als [[x,y], [x,y], ...]
 */
function pointInRing(float $px, float $py, array $ring): bool {
    $n = count($ring);
    $inside = false;
    for ($i = 0, $j = $n - 1; $i < $n; $j = $i++) {
        $xi = $ring[$i][0]; $yi = $ring[$i][1];
        $xj = $ring[$j][0]; $yj = $ring[$j][1];
        if (($yi > $py) !== ($yj > $py)
            && $px < ($xj - $xi) * ($py - $yi) / ($yj - $yi) + $xi) {
            $inside = !$inside;
        }
    }
    return $inside;
}

/**
 * Prüft ob ein Punkt in einem der Kantons-Polygone liegt.
 * @param float $easting   Easting  (x in LV95, ca. 2.6 Mio)
 * @param float $northing  Northing (y in LV95, ca. 1.2 Mio)
 * @param string $canton   '' = NW+OW, 'NW' oder 'OW'
 * @return bool
 */
function pointInCanton(float $easting, float $northing, string $canton = ''): bool {
    $boundaries = getCantonBoundaries();
    if (empty($boundaries)) return true;  // Fallback: alles durchlassen
    $cantons = $canton ? [$canton] : array_keys($boundaries);
    foreach ($cantons as $ak) {
        $multiPolygon = $boundaries[$ak] ?? [];
        foreach ($multiPolygon as $polygon) {
            // Erster Ring = äussere Grenze
            if (!empty($polygon[0]) && pointInRing($easting, $northing, $polygon[0])) {
                return true;
            }
        }
    }
    return false;
}

// -- Dynamische Bbox aus Boundary-Polygonen -----------------------------------

/**
 * Berechnet eine Bounding Box aus den vereinfachten Grenz-Polygonen.
 * @param string $canton  Key (z.B. 'NW', 'OW') oder '' für alle
 * @return string  Bbox als "minE,minN,maxE,maxN" (LV95) oder Fallback
 */
function getBboxForCanton(string $canton = ''): string {
    static $cache = [];
    $cacheKey = $canton ?: '__all__';
    if (isset($cache[$cacheKey])) return $cache[$cacheKey];

    $boundaries = getCantonBoundaries();
    if (empty($boundaries)) {
        return ($cache[$cacheKey] = '2632000,1158000,2700000,1215000');
    }

    $cantons = $canton ? [$canton] : array_keys($boundaries);
    $minE = PHP_FLOAT_MAX; $minN = PHP_FLOAT_MAX;
    $maxE = -PHP_FLOAT_MAX; $maxN = -PHP_FLOAT_MAX;
    $found = false;

    foreach ($cantons as $key) {
        $multiPoly = $boundaries[$key] ?? [];
        foreach ($multiPoly as $polygon) {
            foreach ($polygon as $ring) {
                foreach ($ring as $pt) {
                    $e = $pt[0]; $n = $pt[1];
                    if ($e < $minE) $minE = $e;
                    if ($e > $maxE) $maxE = $e;
                    if ($n < $minN) $minN = $n;
                    if ($n > $maxN) $maxN = $n;
                    $found = true;
                }
            }
        }
    }

    if (!$found) {
        return ($cache[$cacheKey] = '2632000,1158000,2700000,1215000');
    }

    // 2km Puffer hinzufügen (Bbox ist nur Vorfilter)
    $minE -= 2000; $minN -= 2000;
    $maxE += 2000; $maxN += 2000;

    return ($cache[$cacheKey] = round($minE) . ',' . round($minN) . ',' . round($maxE) . ',' . round($maxN));
}

// -- File-basierter Cache in /tmp (5 Minuten TTL) ----------------------------

$_cacheDir = '/tmp/mapplus_search_cache_v3';
$_cacheTTL = 300; // 5 Minuten

function cacheGet(string $key): ?string {
    global $_cacheDir, $_cacheTTL;
    $file = $_cacheDir . '/' . $key . '.json';
    if (!file_exists($file)) return null;
    if (time() - filemtime($file) > $_cacheTTL) {
        @unlink($file);
        return null;
    }
    return @file_get_contents($file) ?: null;
}

function cachePut(string $key, string $data): void {
    global $_cacheDir;
    if (!is_dir($_cacheDir)) @mkdir($_cacheDir, 0755, true);
    @file_put_contents($_cacheDir . '/' . $key . '.json', $data, LOCK_EX);
}

/** Generiert einen Cache-Key aus der Query + Parametern */
function makeCacheKey(string $q, string $canton, string $scope, int $limit): string {
    return 'search_' . md5(strtolower($q) . '|' . $canton . '|' . $scope . '|' . $limit);
}

/** Alte Cache-Dateien aufräumen (einmal pro 100 Aufrufe) */
function cacheCleanup(): void {
    global $_cacheDir, $_cacheTTL;
    if (mt_rand(1, 100) !== 1) return;
    $files = @glob($_cacheDir . '/*.json');
    if (!$files) return;
    $now = time();
    foreach ($files as $f) {
        if ($now - filemtime($f) > $_cacheTTL * 2) @unlink($f);
    }
}

// -- Parallele HTTP-Anfragen via curl_multi -----------------------------------

/**
 * Holt mehrere URLs parallel via curl_multi_exec.
 * @param array $urls  Assoziatives Array ['key' => 'url', ...]
 * @return array  ['key' => 'raw_response_body', ...]
 */
function fetchMultipleUrls(array $urls): array {
    if (empty($urls)) return [];

    $mh = curl_multi_init();
    $handles = [];

    foreach ($urls as $key => $url) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 6,
            CURLOPT_CONNECTTIMEOUT => 3,
            CURLOPT_USERAGENT      => 'GIS-Daten-Search/2.0',
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_ENCODING       => '',  // gzip/deflate/br von swisstopo akzeptieren
            CURLOPT_HTTP_VERSION   => CURL_HTTP_VERSION_2_0,  // HTTP/2
        ]);
        curl_multi_add_handle($mh, $ch);
        $handles[$key] = $ch;
    }

    // Execute all queries simultaneously
    $running = null;
    do {
        curl_multi_exec($mh, $running);
        if ($running > 0) {
            curl_multi_select($mh, 0.1);
        }
    } while ($running > 0);

    $results = [];
    foreach ($handles as $key => $ch) {
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        if ($httpCode === 200) {
            $results[$key] = curl_multi_getcontent($ch);
        } else {
            $results[$key] = '';
        }
        curl_multi_remove_handle($mh, $ch);
        curl_close($ch);
    }
    curl_multi_close($mh);

    return $results;
}

// -- Boundaries-Datei: Pfad + Speichern ---------------------------------------

/**
 * Ermittelt den Pfad zur boundaries-simplified.json (erster existierender Pfad).
 * @return string|null  Dateipfad oder null wenn keiner gefunden/erstellbar
 */
function getBoundariesFilePath(): ?string {
    $paths = [
        '/data/base/boundaries-simplified.json',
        __DIR__ . '/../config/boundaries-simplified.json',
    ];
    foreach ($paths as $p) {
        if (file_exists($p)) return $p;
    }
    // Fallback: erster beschreibbarer Pfad zum Erstellen
    foreach ($paths as $p) {
        $dir = dirname($p);
        if (is_dir($dir) && is_writable($dir)) return $p;
    }
    return null;
}

/**
 * Speichert die Boundaries-Daten in die JSON-Datei.
 * Invalidiert den globalen Cache.
 * @return bool  true bei Erfolg
 */
function saveBoundaries(array $data): bool {
    global $_cantonBoundaries;
    $path = getBoundariesFilePath();
    if (!$path) return false;
    $json = json_encode($data, JSON_UNESCAPED_UNICODE);
    if ($json === false) return false;
    $ok = file_put_contents($path, $json, LOCK_EX);
    if ($ok !== false) {
        $_cantonBoundaries = null;  // Cache invalidieren
        return true;
    }
    return false;
}

// -- Douglas-Peucker Linienvereinfachung --------------------------------------

/**
 * Berechnet den senkrechten Abstand eines Punktes von einer Linie (a→b).
 * @param array $pt  [x, y]
 * @param array $a   [x, y] Linienanfang
 * @param array $b   [x, y] Linienende
 * @return float  Abstand in Koordinateneinheiten (Meter bei LV95)
 */
function perpendicularDistance(array $pt, array $a, array $b): float {
    $dx = $b[0] - $a[0];
    $dy = $b[1] - $a[1];
    $lenSq = $dx * $dx + $dy * $dy;
    if ($lenSq == 0) {
        return sqrt(($pt[0] - $a[0]) ** 2 + ($pt[1] - $a[1]) ** 2);
    }
    return abs($dy * $pt[0] - $dx * $pt[1] + $b[0] * $a[1] - $b[1] * $a[0]) / sqrt($lenSq);
}

/**
 * Douglas-Peucker Algorithmus zur Linienvereinfachung.
 * @param array $points    [[x,y], [x,y], ...]
 * @param float $tolerance Maximaler Abstand in Meter (z.B. 500 für Kantone, 100 für Gemeinden)
 * @return array  Vereinfachte Punktliste
 */
function douglasPeucker(array $points, float $tolerance): array {
    $n = count($points);
    if ($n <= 2) return $points;

    $maxDist  = 0;
    $maxIndex = 0;
    for ($i = 1; $i < $n - 1; $i++) {
        $d = perpendicularDistance($points[$i], $points[0], $points[$n - 1]);
        if ($d > $maxDist) {
            $maxDist  = $d;
            $maxIndex = $i;
        }
    }

    if ($maxDist > $tolerance) {
        $left  = douglasPeucker(array_slice($points, 0, $maxIndex + 1), $tolerance);
        $right = douglasPeucker(array_slice($points, $maxIndex), $tolerance);
        return array_merge(array_slice($left, 0, -1), $right);
    }

    return [$points[0], $points[$n - 1]];
}

// -- Boundary-Management Funktionen -------------------------------------------

/**
 * Listet alle Boundaries mit Metadaten.
 * @return array  [{key, polygonCount, pointCount}, ...]
 */
function listBoundaries(): array {
    $data = getCantonBoundaries();
    $result = [];
    foreach ($data as $key => $multiPolygon) {
        $polygonCount = count($multiPolygon);
        $pointCount   = 0;
        foreach ($multiPolygon as $polygon) {
            foreach ($polygon as $ring) {
                $pointCount += count($ring);
            }
        }
        $result[] = [
            'key'          => $key,
            'polygonCount' => $polygonCount,
            'pointCount'   => $pointCount,
        ];
    }
    return $result;
}

/**
 * Holt eine Boundary von swisstopo und speichert sie.
 * @param string $key        Schlüssel (z.B. 'NW', 'OW', 'Stans')
 * @param string $type       'canton' oder 'municipality'
 * @param int    $bfsNr      BFS-Nummer (z.B. 1509 für Stans, 7 für OW)
 * @param float  $tolerance  Douglas-Peucker Toleranz in Meter (0 = Default je nach Typ)
 * @return array  Ergebnis mit ok, message, pointCount etc.
 */
function addBoundary(string $key, string $type, int $bfsNr, float $tolerance = 0): array {
    if (!$key) return ['ok' => false, 'message' => 'Parameter key fehlt'];
    if (!$bfsNr) return ['ok' => false, 'message' => 'Parameter bfs fehlt'];

    // Layer je nach Typ
    $layers = [
        'canton'       => 'ch.swisstopo.swissboundaries3d-kanton-flaeche.fill',
        'municipality' => 'ch.swisstopo.swissboundaries3d-gemeinde-flaeche.fill',
    ];
    $layer = $layers[$type] ?? null;
    if (!$layer) return ['ok' => false, 'message' => 'Ungültiger type: ' . $type . ' (erlaubt: canton, municipality)'];

    // Default-Toleranz: 500m für Kantone, 100m für Gemeinden
    if ($tolerance <= 0) {
        $tolerance = ($type === 'canton') ? 500.0 : 100.0;
    }

    // Geometrie von swisstopo holen (GeoJSON in LV95)
    $url = 'https://api3.geo.admin.ch/rest/services/api/MapServer/' . $layer . '/' . $bfsNr
        . '?sr=2056&geometryFormat=geojson';

    $ctx = stream_context_create(['http' => [
        'method'        => 'GET',
        'timeout'       => 10,
        'ignore_errors' => true,
        'header'        => "User-Agent: GIS-Daten-Boundary-Admin/1.0\r\n",
    ]]);

    $raw = @file_get_contents($url, false, $ctx);
    if (!$raw) return ['ok' => false, 'message' => 'swisstopo API nicht erreichbar'];

    $data = @json_decode($raw, true);
    if (!$data || !isset($data['feature'])) {
        return ['ok' => false, 'message' => 'Keine Geometrie gefunden für BFS ' . $bfsNr];
    }

    $geometry = $data['feature']['geometry'] ?? null;
    if (!$geometry) return ['ok' => false, 'message' => 'Keine Geometrie in der Antwort'];

    $geomType = $geometry['type'] ?? '';
    $coords   = $geometry['coordinates'] ?? [];

    // Zu MultiPolygon normalisieren
    if ($geomType === 'Polygon') {
        $coords = [$coords];
    } elseif ($geomType !== 'MultiPolygon') {
        return ['ok' => false, 'message' => 'Unbekannter Geometrie-Typ: ' . $geomType];
    }

    // Vereinfachen: nur äussere Ringe, Douglas-Peucker
    $simplified = [];
    $totalPoints = 0;
    $rawPoints   = 0;
    foreach ($coords as $polygon) {
        $outerRing = $polygon[0] ?? [];
        if (empty($outerRing)) continue;
        $rawPoints += count($outerRing);

        // Auf ganzzahlige Koordinaten runden
        $rounded = array_map(function($pt) {
            return [round($pt[0]), round($pt[1])];
        }, $outerRing);

        // Douglas-Peucker Vereinfachung
        $simple = douglasPeucker($rounded, $tolerance);

        // Sicherstellen dass der Ring geschlossen ist
        if ($simple[0] !== $simple[count($simple) - 1]) {
            $simple[] = $simple[0];
        }

        $simplified[] = [$simple];  // [outerRing] — ohne innere Ringe
        $totalPoints += count($simple);
    }

    if (empty($simplified)) {
        return ['ok' => false, 'message' => 'Keine gültigen Polygone nach Vereinfachung'];
    }

    // In bestehende Boundaries einfügen/überschreiben
    $boundaries = getCantonBoundaries();
    $boundaries[$key] = $simplified;

    if (!saveBoundaries($boundaries)) {
        return ['ok' => false, 'message' => 'Fehler beim Speichern der Datei'];
    }

    return [
        'ok'            => true,
        'message'       => 'Boundary "' . $key . '" gespeichert',
        'key'           => $key,
        'type'          => $type,
        'bfsNr'         => $bfsNr,
        'polygonCount'  => count($simplified),
        'rawPointCount' => $rawPoints,
        'pointCount'    => $totalPoints,
        'tolerance'     => $tolerance,
    ];
}

/**
 * Entfernt eine Boundary aus der JSON-Datei.
 * @param string $key  Schlüssel (z.B. 'Stans')
 * @return array  Ergebnis mit ok, message
 */
function deleteBoundary(string $key): array {
    if (!$key) return ['ok' => false, 'message' => 'Parameter key fehlt'];

    $boundaries = getCantonBoundaries();
    if (!isset($boundaries[$key])) {
        return ['ok' => false, 'message' => 'Boundary "' . $key . '" nicht gefunden'];
    }

    unset($boundaries[$key]);

    if (!saveBoundaries($boundaries)) {
        return ['ok' => false, 'message' => 'Fehler beim Speichern der Datei'];
    }

    return ['ok' => true, 'message' => 'Boundary "' . $key . '" gelöscht'];
}

// == ROUTING ==================================================================

$action = isset($_GET['action']) ? strtolower(trim($_GET['action'])) : '';

// -- Boundary-Management Endpunkt ---------------------------------------------
if ($action === 'boundaries') {
    $op = isset($_GET['op']) ? strtolower(trim($_GET['op'])) : 'list';

    switch ($op) {
        case 'list':
            echo json_encode([
                'ok'         => true,
                'boundaries' => listBoundaries(),
            ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
            exit;

        case 'add':
            $key       = isset($_GET['key']) ? trim($_GET['key']) : '';
            $type      = isset($_GET['type']) ? strtolower(trim($_GET['type'])) : '';
            $bfsNr     = (int)($_GET['bfs'] ?? 0);
            $tolerance = (float)($_GET['tolerance'] ?? 0);
            $result = addBoundary($key, $type, $bfsNr, $tolerance);
            echo json_encode($result, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
            exit;

        case 'delete':
            $key = isset($_GET['key']) ? trim($_GET['key']) : '';
            $result = deleteBoundary($key);
            echo json_encode($result, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
            exit;

        default:
            echo json_encode([
                'ok'      => false,
                'message' => 'Unbekannte Operation: ' . $op . '. Erlaubt: list, add, delete',
            ], JSON_UNESCAPED_UNICODE);
            exit;
    }
}

// -- Such-Endpunkt (Standard) -------------------------------------------------

$q      = isset($_GET['q']) ? trim($_GET['q']) : '';
$limit  = max(4, min(20, (int)($_GET['limit'] ?? 8)));
$canton = isset($_GET['canton']) ? strtoupper(trim($_GET['canton'])) : '';
$scope  = isset($_GET['scope']) ? strtolower(trim($_GET['scope'])) : '';
$debug  = isset($_GET['debug']) && $_GET['debug'] === '1';
$mode   = isset($_GET['mode']) ? strtolower(trim($_GET['mode'])) : '';  // 'fast' = nur Adressen+Layers

// Pro-Kategorie Limits (optional, aus JSON5-Config via JS übergeben)
// 0 = kein Limit (Standard wenn Parameter fehlt)
$maxAddr = isset($_GET['maxAddr']) ? max(1, min(50, (int)$_GET['maxAddr'])) : 0;
$maxLoc  = isset($_GET['maxLoc'])  ? max(1, min(50, (int)$_GET['maxLoc']))  : 0;
$maxLay  = isset($_GET['maxLay'])  ? max(1, min(50, (int)$_GET['maxLay']))  : 0;

// Scope: komma-separierte Liste (orte, adressen, layers) oder leer = alles
$scopes = $scope ? array_map('trim', explode(',', $scope)) : [];
$hasOrte     = empty($scopes) || in_array('orte', $scopes);
$hasAdressen = empty($scopes) || in_array('adressen', $scopes);
$hasLayers   = empty($scopes) || in_array('layers', $scopes);

if ($q === '' || mb_strlen($q) < 3) {
    echo json_encode(['numRows' => 0, 'items' => [], 'groups' => []]);
    exit;
}

// -- Timing starten -----------------------------------------------------------
$t0 = microtime(true);

// -- Cache prüfen (Gesamtergebnis, 5min TTL) ----------------------------------
$cacheKey = makeCacheKey($q, $canton, $scope . ($mode === 'fast' ? ':fast' : ''), $limit);
$cached = cacheGet($cacheKey);
if ($cached !== null && !$debug) {
    echo $cached;
    exit;
}
cacheCleanup();

// == FAST MODE: Nur Adressen + Layers (1 API-Call statt 4) ====================
if ($mode === 'fast') {
    $layerItems = $hasLayers ? searchLayers($q, $limit) : [];
    $bbox = getBboxForCanton($canton);
    $fastUrls = [];
    if ($hasAdressen) {
        $fastUrls['addresses'] = 'https://api3.geo.admin.ch/rest/services/api/SearchServer'
            . '?searchText=' . rawurlencode($q)
            . '&lang=de&type=locations&origins=address&sr=2056'
            . '&bbox=' . $bbox
            . '&limit=' . ($limit * 3);
    }
    $fastResponses = fetchMultipleUrls($fastUrls);
    $fastAddresses = $hasAdressen
        ? parseLocations($fastResponses['addresses'] ?? '', $limit * 3, $canton)
        : [];
    // Nur Adressen behalten
    $addressItems = [];
    foreach ($fastAddresses as $item) {
        if ($item['subtitle'] === 'Adresse') $addressItems[] = $item;
    }
    usort($addressItems, function($a, $b) { return strnatcasecmp($a['label'], $b['label']); });
    // Pro-Kategorie Limits anwenden
    if ($maxAddr > 0) $addressItems = array_slice($addressItems, 0, $maxAddr);
    if ($maxLay  > 0) $layerItems   = array_slice($layerItems,   0, $maxLay);
    $groups = buildGroups($layerItems, [], $addressItems, []);
    $allItems = array_merge($addressItems, $layerItems);
    $output = json_encode([
        'numRows' => count($allItems),
        'items'   => $allItems,
        'groups'  => $groups,
        'partial' => true,
    ], JSON_UNESCAPED_UNICODE);
    cachePut($cacheKey, $output);
    echo $output;
    exit;
}

// == FULL MODE (Standard) =====================================================

// 1. Layer-Suche (lokal, kein HTTP)
$layerItems = $hasLayers ? searchLayers($q, $limit) : [];

// 2-4. Swisstopo API-URLs aufbauen (parallel via curl_multi)
$bbox = getBboxForCanton($canton);
$apiUrls = [];

if ($hasOrte || $hasAdressen) {
    $apiUrls['locations'] = 'https://api3.geo.admin.ch/rest/services/api/SearchServer'
        . '?searchText=' . rawurlencode($q)
        . '&lang=de&type=locations&sr=2056'
        . '&bbox=' . $bbox
        . '&limit=' . ($limit * 4);
}

// 2b. Dedizierter Adress-Aufruf (origins=address) — garantiert Adressen
if ($hasAdressen) {
    $apiUrls['addresses'] = 'https://api3.geo.admin.ch/rest/services/api/SearchServer'
        . '?searchText=' . rawurlencode($q)
        . '&lang=de&type=locations&origins=address&sr=2056'
        . '&bbox=' . $bbox
        . '&limit=' . ($limit * 3);
}

if ($hasOrte || $hasAdressen) {
    $featureLayers = 'ch.swisstopo.amtliches-strassenverzeichnis,ch.bfs.gebaeude_wohnungs_register';
    $apiUrls['features'] = 'https://api3.geo.admin.ch/rest/services/api/SearchServer'
        . '?searchText=' . rawurlencode($q)
        . '&lang=de&type=featuresearch'
        . '&features=' . $featureLayers
        . '&sr=2056'
        . '&bbox=' . $bbox
        . '&limit=' . ($limit * 2);
}

if ($hasOrte) {
    $apiUrls['swissnames'] = 'https://api3.geo.admin.ch/rest/services/api/MapServer/find'
        . '?layer=ch.swisstopo.swissnames3d'
        . '&searchText=' . rawurlencode($q)
        . '&searchField=name'
        . '&sr=2056'
        . '&lang=de'
        . '&limit=' . ($limit * 2);
}

// Alle swisstopo-Anfragen PARALLEL ausführen
$apiResponses = fetchMultipleUrls($apiUrls);
$tFetch = microtime(true);

// Ergebnisse parsen (mit vorgeladenen Rohdaten)
$allGeocoderItems = ($hasOrte || $hasAdressen)
    ? parseLocations($apiResponses['locations'] ?? '', $limit * 2, $canton)
    : [];

// Dedizierte Adressen parsen (4. API-Call)
$dedicatedAddressItems = $hasAdressen
    ? parseLocations($apiResponses['addresses'] ?? '', $limit * 3, $canton)
    : [];

// Geocoder-Ergebnisse splitten: origin=address → Adressen, Rest → Orte
$locationItems = [];
$geocoderAddressItems = [];
foreach ($allGeocoderItems as $item) {
    if ($item['subtitle'] === 'Adresse') {
        $geocoderAddressItems[] = $item;
    } else {
        $locationItems[] = $item;
    }
}

// Dedizierte Adressen mit Geocoder-Adressen mergen (dedupliziert via Label-Key)
$seenAddrKeys = [];
foreach ($geocoderAddressItems as $item) {
    $ak = mb_strtolower(preg_replace('/\s+/', ' ', trim($item['label'])));
    $seenAddrKeys[$ak] = true;
}
foreach ($dedicatedAddressItems as $item) {
    if ($item['subtitle'] !== 'Adresse') continue;
    $ak = mb_strtolower(preg_replace('/\s+/', ' ', trim($item['label'])));
    if (isset($seenAddrKeys[$ak])) continue;
    $seenAddrKeys[$ak] = true;
    $geocoderAddressItems[] = $item;
}

// Scope-Filter anwenden
if (!$hasOrte)     $locationItems = [];
if (!$hasAdressen) $geocoderAddressItems = [];

// 3. Geographische Namen (swissNAMES3D)
$swissNameItems = $hasOrte
    ? parseSwissNames($apiResponses['swissnames'] ?? '', $limit, $canton)
    : [];

// 4. Feature-Suche (Strassen + Gebäude)
$featureResult = ($hasOrte || $hasAdressen)
    ? parseFeatures($apiResponses['features'] ?? '', $limit, $canton)
    : ['streets' => [], 'buildings' => []];
$streetItems   = $hasOrte     ? ($featureResult['streets']   ?? []) : [];
$buildingItems = $hasAdressen ? ($featureResult['buildings'] ?? []) : [];
$tParse = microtime(true);

// Geocoder-Adressen + GWR-Gebäude zusammenführen
// Wenn Geocoder-Adresse vorhanden → GWR-Duplikate (gleicher Strassenname+Nr) ausblenden
$geocoderKeys = [];
foreach ($geocoderAddressItems as $item) {
    // Normalisierter Key: Label ohne PLZ ("Aemättlistrasse 3 6370 Stans" → "aemättlistrasse 3 stans")
    $key = mb_strtolower(preg_replace('/\s+\d{4}\s+/', ' ', $item['label']));
    $key = preg_replace('/\s+/', ' ', trim($key));
    $geocoderKeys[$key] = true;
}
$filteredBuildings = [];
foreach ($buildingItems as $bld) {
    $bkey = mb_strtolower(preg_replace('/\s+/', ' ', trim($bld['label'])));
    if (isset($geocoderKeys[$bkey])) continue; // Geocoder hat diesen Treffer bereits
    $filteredBuildings[] = $bld;
}
$mergedAddressItems = array_merge($geocoderAddressItems, $filteredBuildings);
$seenFids = [];
$addressItems = [];
foreach ($mergedAddressItems as $item) {
    $fid = $item['featureId'] ?? null;
    if ($fid && isset($seenFids[$fid])) continue;
    if ($fid) $seenFids[$fid] = true;
    $addressItems[] = $item;
}

// Strassen zu den Orten hinzufügen
$locationItems = array_merge($locationItems, $streetItems);

// Natural Sort innerhalb jeder Quelle, Geocoder-Adressen bleiben vor GWR
$natSort = function($a, $b) {
    // Geocoder-Adressen (type=location) vor Feature-Suche (type=feature)
    if ($a['type'] !== $b['type']) {
        return ($a['type'] === 'location') ? -1 : 1;
    }
    return strnatcasecmp($a['label'], $b['label']);
};
usort($addressItems,   $natSort);
$simpleSort = function($a, $b) { return strnatcasecmp($a['label'], $b['label']); };
usort($locationItems,  $simpleSort);
usort($swissNameItems, $simpleSort);
usort($layerItems,     $simpleSort);

// Pro-Kategorie Limits anwenden (aus Config via GET-Parameter)
if ($maxAddr > 0) $addressItems  = array_slice($addressItems,  0, $maxAddr);
if ($maxLoc  > 0) {
    $locationItems  = array_slice($locationItems,  0, $maxLoc);
    $swissNameItems = array_slice($swissNameItems, 0, $maxLoc);
}
if ($maxLay  > 0) $layerItems    = array_slice($layerItems,    0, $maxLay);

// Ergebnis zusammenstellen
$allItems = array_merge($addressItems, $locationItems, $swissNameItems, $layerItems);
$groups   = buildGroups($layerItems, $locationItems, $addressItems, $swissNameItems);

if ($debug) {
    $tEnd = microtime(true);
    echo json_encode([
        'debug'          => true,
        'q'              => $q,
        'bbox'           => $bbox,
        'timing'         => [
            'fetch_ms'   => round(($tFetch - $t0) * 1000),
            'parse_ms'   => round(($tParse - $tFetch) * 1000),
            'total_ms'   => round(($tEnd - $t0) * 1000),
        ],
        'layerCount'     => count($layerItems),
        'locationCount'  => count($locationItems),
        'addressCount'   => count($addressItems),
        'swissNameCount' => count($swissNameItems),
        'layerItems'     => $layerItems,
        'locationItems'  => $locationItems,
        'addressItems'   => $addressItems,
        'swissNameItems' => $swissNameItems,
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    exit;
}

$output = json_encode([
    'numRows' => count($allItems),
    'items'   => $allItems,
    'groups'  => $groups,
], JSON_UNESCAPED_UNICODE);

// Ergebnis cachen
cachePut($cacheKey, $output);

echo $output;
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
 * Standort-Suche: parst vorgeladene swisstopo Geocoder-Antwort.
 * x = Northing (ca. 1.2 Mio), y = Easting (ca. 2.6 Mio)
 * Gefiltert auf Kanton NW/OW via Kantonsgrenzen-Polygone.
 */
function parseLocations(string $raw, int $limit, string $canton = ''): array
{
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

        // Polygon-Filter: nur Punkte innerhalb der Kantonsgrenzen
        $px = isset($a['y']) ? (float)$a['y'] : null;  // Easting
        $py = isset($a['x']) ? (float)$a['x'] : null;  // Northing
        if ($px !== null && $py !== null && !pointInCanton($px, $py, $canton)) continue;

        // Origin-basierter Subtitel
        $origin = $a['origin'] ?? '';
        $originLabels = [
            'address'   => 'Adresse',
            'zipcode'   => 'PLZ',
            'gg25'      => 'Gemeinde',
            'district'  => 'Bezirk',
            'canton'    => 'Kanton',
            'sn25'      => 'Ortschaft',
            'gazetteer' => 'Lokalname',
            'parcel'    => 'Parzelle',
        ];
        $subtitle = $originLabels[$origin] ?? ucfirst($origin);

        // featureId + layerId vom Geocoder (für Geometrie-Highlight)
        $featureId = isset($a['featureId']) ? (string)$a['featureId'] : null;
        $layerId   = null;
        if ($featureId && !empty($a['links'])) {
            foreach ($a['links'] as $link) {
                if (!empty($link['title'])) {
                    $layerId = $link['title'];
                    break;
                }
            }
        }

        $item = [
            'id'       => $a['id'] ?? uniqid(),
            'label'    => $label,
            'subtitle' => $subtitle,
            'x'        => isset($a['x']) ? (float)$a['x'] : null,
            'y'        => isset($a['y']) ? (float)$a['y'] : null,
            'type'     => 'location',
            'layer'    => null,
        ];

        // Fallback layerId für Gazetteer-Einträge (swissNAMES3D)
        if ($featureId && !$layerId && $origin === 'gazetteer') {
            $layerId = 'ch.swisstopo.swissnames3d';
        }

        // featureId für Geometrie-Highlighting
        if ($featureId && $layerId) {
            $item['featureId'] = $featureId;
            $item['layerId']   = $layerId;
        }

        $out[] = $item;
        if (count($out) >= $limit) break;
    }
    return $out;
}

/**
 * Feature-Suche: parst vorgeladene swisstopo featuresearch-Antwort.
 * Sucht in amtliches-strassenverzeichnis und gebaeude_wohnungs_register.
 * Liefert featureId + layerId für spätere Geometrie-Abfrage via MapServer.
 */
function parseFeatures(string $raw, int $limit, string $canton = ''): array
{
    if (!$raw) return ['streets' => [], 'buildings' => []];
    $data = @json_decode($raw, true);
    if (!$data) return ['streets' => [], 'buildings' => []];

    $streets   = [];
    $buildings = [];
    foreach (($data['results'] ?? []) as $r) {
        $a     = $r['attrs'] ?? [];
        $label = strip_tags($a['label'] ?? $a['detail'] ?? '');
        $label = preg_replace('/\bswisstopo\b\s*/i', '', $label);
        $label = trim($label);
        if (!$label) continue;

        // Polygon-Filter: nur Punkte innerhalb der Kantonsgrenzen
        // featuresearch liefert KEIN attrs.x/y, aber geom_st_box2d mit LV95-Koordinaten
        // Format: "BOX(easting1 northing1,easting2 northing2)"
        $easting  = null;
        $northing = null;
        if (isset($a['y']) && isset($a['x'])) {
            // Falls doch x/y vorhanden (swisstopo-Konvention: y=Easting, x=Northing)
            $easting  = (float)$a['y'];
            $northing = (float)$a['x'];
        } elseif (isset($a['geom_st_box2d'])) {
            // Aus Bounding-Box Mittelpunkt berechnen
            if (preg_match('/BOX\(([\d.]+)\s+([\d.]+)\s*,\s*([\d.]+)\s+([\d.]+)\)/', $a['geom_st_box2d'], $m)) {
                $easting  = ((float)$m[1] + (float)$m[3]) / 2;
                $northing = ((float)$m[2] + (float)$m[4]) / 2;
            }
        }
        if ($easting !== null && $northing !== null && !pointInCanton($easting, $northing, $canton)) continue;
        // Keine Koordinaten = rausfiltern (kein Polygon-Check möglich)
        if ($easting === null || $northing === null) continue;

        // featureId und layerId extrahieren
        $featureId = $a['feature_id'] ?? null;
        $layerId   = $a['layer'] ?? null;
        if (!$featureId || !$layerId) continue;

        // Subtitel basierend auf Layer
        $isStreet = ($layerId === 'ch.swisstopo.amtliches-strassenverzeichnis');
        $subtitle = $isStreet ? 'Strasse' : 'Adresse';

        $item = [
            'id'        => $featureId,
            'label'     => $label,
            'subtitle'  => $subtitle,
            'type'      => 'feature',
            'featureId' => $featureId,
            'layerId'   => $layerId,
            'x'         => $northing,  // Northing für Client (x = Northing in LV95)
            'y'         => $easting,   // Easting für Client  (y = Easting in LV95)
            'layer'     => null,
        ];

        if ($isStreet) {
            $streets[] = $item;
        } else {
            $buildings[] = $item;
        }

        if (count($streets) + count($buildings) >= $limit * 2) break;
    }
    return ['streets' => $streets, 'buildings' => $buildings];
}

/**
 * Geographische Namen (Flurnamen, Gipfel, Gewässer etc.) via swisstopo MapServer/find.
 * Layer: ch.swisstopo.swissnames3d
 * Liefert featureId + layerId für spätere Geometrie-Abfrage via MapServer.
 */
function parseSwissNames(string $raw, int $limit, string $canton = ''): array
{
    if (!$raw) return [];
    $data = @json_decode($raw, true);
    if (!$data) return [];

    $out = [];
    $seen = [];  // Deduplizierung nach featureId

    foreach (($data['results'] ?? []) as $r) {
        $featureId = $r['featureId'] ?? $r['id'] ?? null;
        if (!$featureId) continue;

        // Duplikate überspringen
        if (isset($seen[$featureId])) continue;
        $seen[$featureId] = true;

        $attrs = $r['attributes'] ?? [];
        $name  = $attrs['name'] ?? $attrs['label'] ?? '';
        if (!$name) continue;

        $objektart = $attrs['objektart'] ?? '';
        $layerId   = $r['layerBodId'] ?? 'ch.swisstopo.swissnames3d';

        // Koordinaten aus Geometrie extrahieren (Esri JSON: points/paths/rings)
        $geom = $r['geometry'] ?? [];
        $x = null; $y = null;
        if (!empty($geom['points'])) {
            $y = (float)$geom['points'][0][0];  // Easting
            $x = (float)$geom['points'][0][1];  // Northing
        } elseif (!empty($geom['paths'])) {
            $y = (float)$geom['paths'][0][0][0];
            $x = (float)$geom['paths'][0][0][1];
        } elseif (!empty($geom['rings'])) {
            // Polygon: Mittelpunkt des ersten Rings berechnen
            $ring = $geom['rings'][0];
            $sumE = 0; $sumN = 0; $n = count($ring);
            if ($n > 0) {
                foreach ($ring as $pt) { $sumE += $pt[0]; $sumN += $pt[1]; }
                $y = $sumE / $n;  // Easting
                $x = $sumN / $n;  // Northing
            }
        } elseif (isset($geom['x']) && isset($geom['y'])) {
            // Einfacher Punkt (Esri JSON)
            $y = (float)$geom['x'];  // Easting
            $x = (float)$geom['y'];  // Northing
        }

        // Polygon-Filter: nur Punkte innerhalb der Kantonsgrenzen
        if ($y !== null && $x !== null) {
            if (!pointInCanton($y, $x, $canton)) continue;
        } else {
            // Keine Koordinaten = nicht filterbar, überspringen
            continue;
        }

        // Label und Subtitel
        $label    = $name;
        $subtitle = $objektart ?: 'Geographischer Name';
        $subtitle = trim(preg_replace('/\bswisstopo\b\s*/i', '', $subtitle));

        $out[] = [
            'id'        => (string)$featureId,
            'label'     => $label,
            'subtitle'  => $subtitle,
            'type'      => 'feature',
            'featureId' => (string)$featureId,
            'layerId'   => $layerId,
            'x'         => $x,
            'y'         => $y,
            'layer'     => null,
        ];

        if (count($out) >= $limit) break;
    }
    return $out;
}

/**
 * Gruppen-Struktur aufbauen (Adressen / Orte & Strassen / Themen).
 */
function buildGroups(array $layers, array $locations, array $addresses = [], array $swissNames = []): array
{
    $groups = [];
    // 1. Adressen (höchste Priorität)
    if (!empty($addresses)) {
        $groups[] = ['label' => 'Adressen', 'type' => 'feature', 'items' => $addresses];
    }
    // 2. Orte & Strassen: Geocoder-Standorte (ohne Adressen) + Strassen + geographische Namen
    $orteItems = array_merge($locations, $swissNames);
    if (!empty($orteItems)) {
        $groups[] = ['label' => 'Orte & Strassen', 'type' => 'location', 'items' => $orteItems];
    }
    // 3. Themen
    if (!empty($layers)) {
        $groups[] = ['label' => 'Themen', 'type' => 'layer', 'items' => $layers];
    }
    return $groups;
}