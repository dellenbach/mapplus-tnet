<?php
/**
 * migrate.php
 * DB-Migration + Catalog-Sync-Test mit vollem Error-Reporting.
 *
 * @version    1.2
 * @date       2025-06-06
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

// Volles Error-Reporting erzwingen
ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

// Cookie-Auth erforderlich
require_once __DIR__ . '/../includes/AdminAuth.php';
AdminAuth::requireAuth();
set_time_limit(120); // 2 Minuten

// OPcache für geänderte Dateien invalidieren
if (function_exists('opcache_invalidate')) {
    $files = [
        __DIR__ . '/../includes/LayerImporter.php',
        __DIR__ . '/../includes/ConfigReader.php',
        __DIR__ . '/../includes/Database.php',
        __FILE__,
    ];
    foreach ($files as $f) {
        if (file_exists($f)) opcache_invalidate($f, true);
    }
}

header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/../includes/Database.php';
require_once __DIR__ . '/../includes/ConfigReader.php';
require_once __DIR__ . '/../includes/LayerImporter.php';

$action = $_GET['action'] ?? 'migrate';

try {
    $pdo = Database::getConnection();

    if ($action === 'migrate') {
        // Migration: Spalten hinzufügen
        $results = [];
        $migrations = [
            "ALTER TABLE mapplusconf.catalog_node ADD COLUMN IF NOT EXISTS service_url TEXT",
            "ALTER TABLE mapplusconf.catalog_node ADD COLUMN IF NOT EXISTS coalesce_group TEXT",
            "CREATE INDEX IF NOT EXISTS idx_catalog_coalesce ON mapplusconf.catalog_node (coalesce_group) WHERE coalesce_group IS NOT NULL",
        ];
        foreach ($migrations as $sql) {
            try {
                $pdo->exec($sql);
                $results[] = ['sql' => $sql, 'status' => 'OK'];
            } catch (\Exception $e) {
                $results[] = ['sql' => $sql, 'status' => 'ERROR', 'error' => $e->getMessage()];
            }
        }
        echo json_encode(['success' => true, 'migrations' => $results], JSON_PRETTY_PRINT);

    } elseif ($action === 'test-catalog') {
        // Catalog-Sync Test (mit detaillierten Fehlermeldungen)
        $importer = new LayerImporter();
        $stats = $importer->syncCatalogNodes();
        echo json_encode(['success' => true, 'stats' => $stats], JSON_PRETTY_PRINT);

    } elseif ($action === 'test-coalesce') {
        // Coalesce-Gruppen in der DB prüfen
        $stmt = $pdo->query("
            SELECT coalesce_group, service_url, count(*) as child_count
            FROM mapplusconf.catalog_node
            WHERE coalesce_group IS NOT NULL
            GROUP BY coalesce_group, service_url
            ORDER BY coalesce_group
        ");
        $groups = $stmt->fetchAll(\PDO::FETCH_ASSOC);
        echo json_encode(['success' => true, 'coalesce_groups' => $groups, 'count' => count($groups)], JSON_PRETTY_PRINT);

    } else {
        echo json_encode(['success' => false, 'error' => 'Unbekannte Aktion: ' . $action]);
    }

} catch (\Throwable $e) {
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage(),
        'file' => $e->getFile(),
        'line' => $e->getLine(),
        'trace' => explode("\n", $e->getTraceAsString())
    ], JSON_PRETTY_PRINT);
}
