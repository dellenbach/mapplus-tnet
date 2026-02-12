<?php
/**
 * scan-manifests.php
 *
 * Scannt das qgis-templates-Verzeichnis nach einzelnen *.manifest.json
 * Dateien und liefert ein aggregiertes JSON zurück, das von der
 * Web-Applikation (template-pdf-export.js) konsumiert wird.
 *
 * Erwartete Verzeichnisstruktur:
 *   ol-pdf-printer/qgis-templates/
 *     nw_layout_a4_quer_landscape.manifest.json
 *     nw_layout_a4_quer_landscape.svg
 *     nw_layout_a4_hoch_portrait.manifest.json
 *     nw_layout_a4_hoch_portrait.svg
 *     ...
 *
 * Rückgabe (JSON):
 *   {
 *     "version": "1.4",
 *     "source": "scan-manifests.php",
 *     "generated": "2026-02-12T15:30:00+01:00",
 *     "templates": [ ... ]
 *   }
 *
 * @version    1.0
 * @date       2026-02-12
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-cache, must-revalidate');

// Basis-Verzeichnis relativ zu diesem Script
$baseDir = realpath(__DIR__ . '/../ol-pdf-printer/qgis-templates');

if (!$baseDir || !is_dir($baseDir)) {
    http_response_code(404);
    echo json_encode([
        'error' => 'Template-Verzeichnis nicht gefunden',
        'path'  => __DIR__ . '/../ol-pdf-printer/qgis-templates'
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$templates = [];

// Alle *.manifest.json Dateien im Verzeichnis scannen
$pattern = $baseDir . DIRECTORY_SEPARATOR . '*.manifest.json';
$files = glob($pattern);

if ($files === false) {
    $files = [];
}

foreach ($files as $file) {
    $content = file_get_contents($file);
    if ($content === false) {
        continue;
    }

    $data = json_decode($content, true);
    if ($data === null) {
        continue;
    }

    // Einzel-Manifest hat "template" (Singular)
    if (isset($data['template'])) {
        $templates[] = $data['template'];
    }
    // Legacy: falls "templates" (Plural/Array) vorhanden
    elseif (isset($data['templates']) && is_array($data['templates'])) {
        foreach ($data['templates'] as $t) {
            $templates[] = $t;
        }
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
    'templates' => $templates
];

echo json_encode($result, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
