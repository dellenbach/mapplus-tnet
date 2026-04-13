<?php
/**
 * TNET API v1 - Admin / DB-Management Endpoint
 * 
 * Steuert die PostgreSQL-Datenbank (mapplusconf) über die API:
 *   - GET  ?action=status      → DB-Status und Schema-Info
 *   - GET  ?action=schema      → Schema erstellen/prüfen
 *   - GET  ?action=configToPG  → Full-Sync (alle Config-Dateien → PostgreSQL)
 *   - GET  ?action=configToPG&scope=layers   → Nur Layer-Definitionen
 *   - GET  ?action=configToPG&scope=catalog  → Nur Katalogbäume
 *   - GET  ?action=configToPG&scope=maptips  → Nur MapTips
 *   - GET  ?action=configToPG&scope=nls      → Nur NLS-Ressourcen
 *   - GET  ?action=log         → Letzte Import-Logs
 *   - GET  ?action=stats       → Tabellenstatistiken
 * 
 * Aufruf:
 *   /maps/tnet/api/v1/admin?action=status
 *   /maps/tnet/api/v1/admin?action=configToPG
 *   /maps/tnet/api/v1/admin?action=configToPG&scope=layers
 *
 * @version    1.0
 * @date       2026-02-21
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

require_once __DIR__ . '/../includes/ApiResponse.php';
require_once __DIR__ . '/../includes/AdminAuth.php';
require_once __DIR__ . '/../includes/CacheHelper.php';
require_once __DIR__ . '/../includes/Database.php';
require_once __DIR__ . '/../includes/ConfigReader.php';
require_once __DIR__ . '/../includes/LayerImporter.php';

// Cookie-Auth erforderlich
AdminAuth::requireAuth();

// Standard API Headers
ApiResponse::setHeaders();

// Kein Caching für Admin-Aktionen
CacheHelper::setCacheControl(0);

$startTime = microtime(true);

// === Parameter ===
$action = strtolower(trim($_GET['action'] ?? 'status'));
$scope  = strtolower(trim($_GET['scope']  ?? 'full'));

// === Routing ===
switch ($action) {

    // -----------------------------------------------------------------
    // STATUS: DB-Verbindung und Schema prüfen
    // -----------------------------------------------------------------
    case 'status':
        $dbStatus = Database::isAvailable();
        $result = [
            'database' => $dbStatus,
        ];

        if ($dbStatus['available']) {
            $result['schema'] = Database::schemaReady();

            // Tabellen-Details
            try {
                $pdo = Database::getConnection();
                $stmt = $pdo->query(
                    "SELECT table_name, 
                            (SELECT COUNT(*) FROM information_schema.columns c 
                             WHERE c.table_schema = 'mapplusconf' AND c.table_name = t.table_name) AS columns
                     FROM information_schema.tables t
                     WHERE t.table_schema = 'mapplusconf' AND t.table_type = 'BASE TABLE'
                     ORDER BY t.table_name"
                );
                $result['tables'] = $stmt->fetchAll();
            } catch (\Exception $e) {
                $result['tables'] = [];
            }
        }

        $elapsed = round((microtime(true) - $startTime) * 1000);
        ApiResponse::success($result, ['action' => 'status', 'responseTime' => $elapsed . 'ms']);
        break;

    // -----------------------------------------------------------------
    // SCHEMA: DDL ausführen (idempotent)
    // -----------------------------------------------------------------
    case 'schema':
        $schemaFile = realpath(__DIR__ . '/../db/schema.sql');
        if (!$schemaFile) {
            ApiResponse::error('Schema-Datei nicht gefunden (db/schema.sql)', 500);
        }

        try {
            $pdo = Database::getConnection();
            $sql = file_get_contents($schemaFile);
            $pdo->exec($sql);

            $schemaInfo = Database::schemaReady();
            $elapsed = round((microtime(true) - $startTime) * 1000);
            ApiResponse::success([
                'message' => 'Schema erfolgreich erstellt/aktualisiert',
                'schema'  => $schemaInfo,
            ], ['action' => 'schema', 'responseTime' => $elapsed . 'ms']);

        } catch (\Exception $e) {
            ApiResponse::error('Schema-Erstellung fehlgeschlagen: ' . $e->getMessage(), 500);
        }
        break;

    // -----------------------------------------------------------------
    // configToPG: Config-Dateien → PostgreSQL (Full-Sync oder Teilsync)
    // -----------------------------------------------------------------
    case 'configtopg':
        try {
            $importer = new LayerImporter();
            $stats = [];

            switch ($scope) {
                case 'layers':
                    $stats = $importer->syncLayerDefinitions();
                    break;
                case 'catalog':
                case 'tree':
                    $stats = $importer->syncCatalogNodes();
                    break;
                case 'maptips':
                    $stats = $importer->syncMaptips();
                    break;
                case 'nls':
                    $stats = $importer->syncNlsResources();
                    break;
                case 'full':
                default:
                    $stats = $importer->fullSync();
                    break;
            }

            $elapsed = round((microtime(true) - $startTime) * 1000);
            ApiResponse::success([
                'message' => "configToPG abgeschlossen (scope: {$scope})",
                'stats'   => $stats,
            ], [
                'action'       => 'configToPG',
                'scope'        => $scope,
                'responseTime' => $elapsed . 'ms',
            ]);

        } catch (\Exception $e) {
            ApiResponse::error('configToPG fehlgeschlagen: ' . $e->getMessage(), 500);
        }
        break;

    // -----------------------------------------------------------------
    // LOG: Letzte Import-Logs anzeigen
    // -----------------------------------------------------------------
    case 'log':
    case 'logs':
        try {
            $pdo = Database::getConnection();
            $limit = min((int)($_GET['limit'] ?? 10), 100);
            $stmt = $pdo->prepare(
                "SELECT id, started_at, finished_at, status, source_type,
                        records_upserted, records_deleted, errors, details
                 FROM mapplusconf.import_log
                 ORDER BY id DESC
                 LIMIT ?"
            );
            $stmt->execute([$limit]);
            $logs = $stmt->fetchAll();

            // JSONB-Felder dekodieren
            foreach ($logs as &$log) {
                $log['errors']  = json_decode($log['errors'], true);
                $log['details'] = json_decode($log['details'], true);
            }

            $elapsed = round((microtime(true) - $startTime) * 1000);
            ApiResponse::success($logs, [
                'action'       => 'log',
                'count'        => count($logs),
                'responseTime' => $elapsed . 'ms',
            ]);

        } catch (\Exception $e) {
            ApiResponse::error('Logs nicht verfügbar: ' . $e->getMessage(), 500);
        }
        break;

    // -----------------------------------------------------------------
    // STATS: Tabellenstatistiken
    // -----------------------------------------------------------------
    case 'stats':
        try {
            $pdo = Database::getConnection();
            $tables = ['profile', 'category_mapping', 'layer_definition', 'catalog_node', 'layer_maptip', 'nls_resource', 'import_log'];
            $counts = [];

            foreach ($tables as $table) {
                $stmt = $pdo->query("SELECT COUNT(*) AS cnt FROM mapplusconf.{$table}");
                $row = $stmt->fetch();
                $counts[$table] = (int) $row['cnt'];
            }

            // Zusätzliche Infos
            $stmt = $pdo->query("SELECT COUNT(DISTINCT source_file) AS files FROM mapplusconf.layer_definition");
            $sourceFiles = (int) $stmt->fetch()['files'];

            $stmt = $pdo->query("SELECT COUNT(DISTINCT profile_id) AS profiles FROM mapplusconf.catalog_node");
            $activeProfiles = (int) $stmt->fetch()['profiles'];

            $stmt = $pdo->query(
                "SELECT layer_type, COUNT(*) AS cnt 
                 FROM mapplusconf.layer_definition 
                 GROUP BY layer_type 
                 ORDER BY cnt DESC"
            );
            $layerTypes = $stmt->fetchAll();

            $elapsed = round((microtime(true) - $startTime) * 1000);
            ApiResponse::success([
                'tableCounts'    => $counts,
                'sourceFiles'    => $sourceFiles,
                'activeProfiles' => $activeProfiles,
                'layerTypes'     => $layerTypes,
            ], ['action' => 'stats', 'responseTime' => $elapsed . 'ms']);

        } catch (\Exception $e) {
            ApiResponse::error('Statistiken nicht verfügbar: ' . $e->getMessage(), 500);
        }
        break;

    // -----------------------------------------------------------------
    // UNKNOWN ACTION
    // -----------------------------------------------------------------
    default:
        ApiResponse::error("Unbekannte Aktion: {$action}. Verfügbar: status, schema, configToPG, log, stats", 400);
        break;
}
