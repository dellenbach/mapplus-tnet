<?php
/**
 * scan-manifests.php
 *
 * Scannt das qgis-templates-Verzeichnis (und Unterverzeichnisse)
 * rekursiv nach *.manifest.json Dateien und gibt ein zusammengeführtes
 * Manifest im gleichen Format wie das alte manifest.json zurück.
 *
 * Aufruf: GET scan-manifests.php
 * Rückgabe: JSON { version, generated, templates: [...], count, source }
 *
 * @version    1.0
 * @date       2026-02-12
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-cache, no-store, must-revalidate');
header('Access-Control-Allow-Origin: *');

$baseDir = __DIR__;
$templates = [];
$errors = [];

// Rekursiv alle *.manifest.json finden
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
    if (!$data || !isset($data['name'])) {
        $errors[] = 'Ungültiges Manifest: ' . $relPath;
        continue;
    }

    // Relative Pfade für files.svg / files.pdf beibehalten
    // (sind relativ zum qgis-templates-Verzeichnis)
    $subDir = dirname($relPath);
    if ($subDir !== '.' && isset($data['files'])) {
        foreach ($data['files'] as $key => $val) {
            if ($val && strpos($val, '/') === false) {
                $data['files'][$key] = $subDir . '/' . $val;
            }
        }
    }

    $data['_manifestFile'] = $relPath;
    $templates[] = $data;
}

// Nach Name sortieren für konsistente Reihenfolge
usort($templates, function ($a, $b) {
    return strcmp($a['name'], $b['name']);
});

echo json_encode([
    'version'   => '2.0',
    'generated' => date('c'),
    'templates' => $templates,
    'count'     => count($templates),
    'source'    => 'scan-manifests.php',
    'errors'    => $errors
], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
