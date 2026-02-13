<?php
/**
 * scan-manifests.php
 *
 * Scannt das qgis-templates-Verzeichnis (und Unterverzeichnisse) rekursiv
 * nach *.manifest.json Dateien und liefert ein aggregiertes JSON zurück,
 * das von der Web-Applikation (template-pdf-export.js) konsumiert wird.
 *
 * Wird beim Öffnen des Druckdialogs via fetch('php/scan-manifests.php')
 * aus template-pdf-export.js → loadManifest() aufgerufen.
 *
 * Erwartete Verzeichnisstruktur:
 *   ol-pdf-printer/qgis-templates/
 *     nw_layout_a4_quer_landscape.manifest.json
 *     nw_layout_a4_quer_landscape.svg
 *     subfolder/
 *       some_layout.manifest.json
 *       some_layout.svg
 *
 * Manifest-Format (Einzel-Datei):
 *   { "version": "1.4", "template": { "name": "...", ... } }
 *
 * Rückgabe (JSON):
 *   {
 *     "version": "1.4",
 *     "source": "scan-manifests.php",
 *     "generated": "2026-02-12T15:30:00+01:00",
 *     "templates": [ ... ],
 *     "count": 4,
 *     "errors": []
 *   }
 *
 * @version    2.0
 * @date       2026-02-12
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-cache, no-store, must-revalidate');
header('Pragma: no-cache');
header('Expires: 0');
header('Access-Control-Allow-Origin: *');

// Basis-Verzeichnis: ol-pdf-printer/qgis-templates relativ zu diesem Script (php/)
$baseDir = realpath(__DIR__ . '/../ol-pdf-printer/qgis-templates');

if (!$baseDir || !is_dir($baseDir)) {
    http_response_code(404);
    echo json_encode([
        'error'   => 'Template-Verzeichnis nicht gefunden',
        'path'    => __DIR__ . '/../ol-pdf-printer/qgis-templates',
        'resolved'=> $baseDir ?: '(realpath fehlgeschlagen)'
    ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

$templates = [];
$errors    = [];

// ──────────────────────────────────────────────────────────────────
//  Rekursiv alle *.manifest.json finden
// ──────────────────────────────────────────────────────────────────
$iterator = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator($baseDir, RecursiveDirectoryIterator::SKIP_DOTS),
    RecursiveIteratorIterator::LEAVES_ONLY
);

foreach ($iterator as $file) {
    if (!$file->isFile()) continue;
    if (!preg_match('/\.manifest\.json$/i', $file->getFilename())) continue;

    $relPath = str_replace($baseDir . DIRECTORY_SEPARATOR, '', $file->getPathname());
    $relPath = str_replace(DIRECTORY_SEPARATOR, '/', $relPath);

    $content = @file_get_contents($file->getPathname());
    if ($content === false) {
        $errors[] = 'Konnte nicht lesen: ' . $relPath;
        continue;
    }

    $data = json_decode($content, true);
    if ($data === null) {
        $errors[] = 'Ungültiges JSON: ' . $relPath;
        continue;
    }

    // Einzel-Manifest hat "template" (Singular) — Standard-Format
    if (isset($data['template']) && is_array($data['template'])) {
        $tmpl = $data['template'];

        // Relative Pfade für files.svg / files.pdf anpassen (Unterverzeichnisse)
        $subDir = dirname($relPath);
        if ($subDir !== '.' && isset($tmpl['files'])) {
            foreach ($tmpl['files'] as $key => $val) {
                if ($val && strpos($val, '/') === false) {
                    $tmpl['files'][$key] = $subDir . '/' . $val;
                }
            }
        }

        $tmpl['_manifestFile'] = $relPath;
        $templates[] = $tmpl;
    }
    // Legacy: falls "templates" (Plural/Array) vorhanden
    elseif (isset($data['templates']) && is_array($data['templates'])) {
        foreach ($data['templates'] as $t) {
            $t['_manifestFile'] = $relPath;
            $templates[] = $t;
        }
    }
    // Alternativ: Top-Level-Objekt mit "name" direkt
    elseif (isset($data['name'])) {
        $data['_manifestFile'] = $relPath;
        $templates[] = $data;
    }
    else {
        $errors[] = 'Kein erkanntes Manifest-Format: ' . $relPath;
    }
}

// Nach Name sortieren (für konsistente Reihenfolge)
usort($templates, function ($a, $b) {
    return strcmp($a['name'] ?? '', $b['name'] ?? '');
});

$result = [
    'version'   => '1.4',
    'source'    => 'scan-manifests.php',
    'generated' => date('c'),
    'templates' => $templates,
    'count'     => count($templates),
    'errors'    => $errors
];

echo json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
