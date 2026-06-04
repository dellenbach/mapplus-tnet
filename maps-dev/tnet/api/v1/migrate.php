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
AdminAuth::enforceEndpointPolicy('migrate', 'php');
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

    } elseif ($action === 'bookmarks-schema') {
        // Bookmark-Tabellen idempotent anlegen (Pilot-Domain Staging-DB)
        $ddls = [
            "CREATE TABLE IF NOT EXISTS mapplusconf.bookmark (
                bookmark_id TEXT PRIMARY KEY,
                name TEXT,
                payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                sort_idx INTEGER NOT NULL DEFAULT 0,
                version INTEGER NOT NULL DEFAULT 1,
                deleted BOOLEAN NOT NULL DEFAULT false,
                updated_by TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )",
            "CREATE INDEX IF NOT EXISTS idx_bookmark_active ON mapplusconf.bookmark (sort_idx) WHERE deleted = false",
            "CREATE INDEX IF NOT EXISTS idx_bookmark_payload ON mapplusconf.bookmark USING GIN (payload)",
            "CREATE TABLE IF NOT EXISTS mapplusconf.bookmark_history (
                id SERIAL PRIMARY KEY,
                bookmark_id TEXT NOT NULL,
                version INTEGER NOT NULL,
                action TEXT NOT NULL,
                payload JSONB,
                changed_by TEXT,
                changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )",
            "CREATE INDEX IF NOT EXISTS idx_bookmark_hist_id ON mapplusconf.bookmark_history (bookmark_id, version DESC)",
            "CREATE TABLE IF NOT EXISTS mapplusconf.bookmark_lock (
                scope TEXT PRIMARY KEY,
                locked_by TEXT NOT NULL,
                locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                expires_at TIMESTAMPTZ NOT NULL
            )",
            "CREATE TABLE IF NOT EXISTS mapplusconf.bookmark_meta (
                scope TEXT PRIMARY KEY,
                revision INTEGER NOT NULL DEFAULT 1,
                updated_by TEXT,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )",
            "INSERT INTO mapplusconf.bookmark_meta (scope, revision) VALUES ('bookmarks', 1) ON CONFLICT (scope) DO NOTHING",
            "DROP TRIGGER IF EXISTS trg_bookmark_updated ON mapplusconf.bookmark",
            "CREATE TRIGGER trg_bookmark_updated BEFORE UPDATE ON mapplusconf.bookmark FOR EACH ROW EXECUTE FUNCTION mapplusconf.set_updated_at()",
        ];
        $results = [];
        foreach ($ddls as $sql) {
            try {
                $pdo->exec($sql);
                $results[] = ['status' => 'OK', 'sql' => substr(preg_replace('/\s+/', ' ', $sql), 0, 80)];
            } catch (\Exception $e) {
                $results[] = ['status' => 'ERROR', 'error' => $e->getMessage(), 'sql' => substr(preg_replace('/\s+/', ' ', $sql), 0, 80)];
            }
        }
        echo json_encode(['success' => true, 'steps' => $results], JSON_PRETTY_PRINT);

    } elseif ($action === 'bookmarks-import') {
        // Einmalige (idempotente) Migration der Bookmark-Datei in die DB.
        // Quelle: Draft (tmp) bevorzugt, sonst deployte Laufzeit-Datei.
        require_once __DIR__ . '/../includes/BookmarkRepository.php';

        $scriptName  = $_SERVER['SCRIPT_NAME'] ?? '';
        $appBasePath = rtrim(str_replace('\\', '/', dirname(dirname(dirname(dirname($scriptName))))), '/');
        if ($appBasePath === '' || $appBasePath === '.') { $appBasePath = '/maps'; }
        $isDev   = ($appBasePath === '/maps-dev');
        $tmpRoot = '/data/Client_Data/nwow/tmp/' . ($isDev ? 'maps-dev' : 'maps');
        $webRoot = rtrim($_SERVER['DOCUMENT_ROOT'] ?? '/var/www/html/nwow', '/') . $appBasePath;

        $draftFile    = $tmpRoot . '/bookmarks/map-bookmarks-all.json';
        $deployedFile = $webRoot . '/tnet/data/map-bookmarks-all.json';

        $srcFile = null;
        if (file_exists($draftFile))        { $srcFile = $draftFile; $srcLabel = 'draft'; }
        elseif (file_exists($deployedFile)) { $srcFile = $deployedFile; $srcLabel = 'deployed'; }

        if ($srcFile === null) {
            echo json_encode(['success' => false, 'error' => 'Keine Bookmark-Quelldatei gefunden',
                'checked' => [$draftFile, $deployedFile]], JSON_PRETTY_PRINT);
        } else {
            $raw  = @file_get_contents($srcFile);
            $list = json_decode($raw !== false ? $raw : '', true);
            if (!is_array($list)) {
                echo json_encode(['success' => false, 'error' => 'Quelldatei ist kein gueltiges JSON-Array',
                    'source' => $srcFile], JSON_PRETTY_PRINT);
            } else {
                // Optimistic-Check uebersprungen (Erst-Import); idempotent durch Upsert.
                $res = BookmarkRepository::saveAll($list, null, 'migration');
                echo json_encode([
                    'success'  => true,
                    'source'   => $srcLabel,
                    'file'     => $srcFile,
                    'imported' => $res['count'],
                    'revision' => $res['revision']
                ], JSON_PRETTY_PRINT);
            }
        }

    } elseif ($action === 'catalog-schema') {
        // Catalog-Document-Tabellen idempotent anlegen (Themenkatalog DB-first)
        $ddls = [
            "CREATE TABLE IF NOT EXISTS mapplusconf.catalog_document (
                profile TEXT PRIMARY KEY,
                payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                revision INTEGER NOT NULL DEFAULT 1,
                updated_by TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )",
            "CREATE INDEX IF NOT EXISTS idx_catalog_doc_payload ON mapplusconf.catalog_document USING GIN (payload)",
            "CREATE TABLE IF NOT EXISTS mapplusconf.catalog_document_history (
                id SERIAL PRIMARY KEY,
                profile TEXT NOT NULL,
                revision INTEGER NOT NULL,
                action TEXT NOT NULL CHECK (action IN ('create','update','publish','delete','restore','import')),
                lyrmgr_key TEXT,
                payload JSONB,
                changed_by TEXT,
                changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )",
            "CREATE INDEX IF NOT EXISTS idx_catalog_doc_hist ON mapplusconf.catalog_document_history (profile, revision DESC)",
            "CREATE TABLE IF NOT EXISTS mapplusconf.catalog_lock (
                profile TEXT PRIMARY KEY,
                locked_by TEXT NOT NULL,
                locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                expires_at TIMESTAMPTZ NOT NULL
            )",
            "DROP TRIGGER IF EXISTS trg_catalog_document_updated ON mapplusconf.catalog_document",
            "CREATE TRIGGER trg_catalog_document_updated BEFORE UPDATE ON mapplusconf.catalog_document FOR EACH ROW EXECUTE FUNCTION mapplusconf.set_updated_at()",
        ];
        $results = [];
        foreach ($ddls as $sql) {
            try {
                $pdo->exec($sql);
                $results[] = ['status' => 'OK', 'sql' => substr(preg_replace('/\s+/', ' ', $sql), 0, 80)];
            } catch (\Exception $e) {
                $results[] = ['status' => 'ERROR', 'error' => $e->getMessage(), 'sql' => substr(preg_replace('/\s+/', ' ', $sql), 0, 80)];
            }
        }
        echo json_encode(['success' => true, 'steps' => $results], JSON_PRETTY_PRINT);

    } elseif ($action === 'catalog-import') {
        // Einmalige (idempotente) Migration der lyrmgr.conf je Profil in die DB.
        // Quelle: deployte Laufzeit-Dateien unter <webRoot>/public/config/.
        require_once __DIR__ . '/../includes/CatalogRepository.php';

        $scriptName  = $_SERVER['SCRIPT_NAME'] ?? '';
        $appBasePath = rtrim(str_replace('\\', '/', dirname(dirname(dirname(dirname($scriptName))))), '/');
        if ($appBasePath === '' || $appBasePath === '.') { $appBasePath = '/maps'; }
        $webRoot    = rtrim($_SERVER['DOCUMENT_ROOT'] ?? '/var/www/html/nwow', '/') . $appBasePath;
        $configBase = $webRoot . '/public/config';

        // Profil 'public' (Basisdatei) + Unterprofile (<configBase>/<profile>/lyrmgr.conf)
        $sources = [];
        $baseFile = $configBase . '/lyrmgr.conf';
        if (file_exists($baseFile)) {
            $sources['public'] = $baseFile;
        }
        foreach (glob($configBase . '/*/lyrmgr.conf') ?: [] as $sub) {
            $profile = basename(dirname($sub));
            // '-stage'-Suffix tolerieren (analog listLyrmgrProfiles)
            $profile = preg_replace('/-stage$/', '', $profile);
            if ($profile !== '' && $profile !== 'public') {
                $sources[$profile] = $sub;
            }
        }

        if (empty($sources)) {
            echo json_encode(['success' => false, 'error' => 'Keine lyrmgr.conf gefunden',
                'configBase' => $configBase], JSON_PRETTY_PRINT);
        } else {
            $imported = [];
            foreach ($sources as $profile => $file) {
                $raw  = @file_get_contents($file);
                $data = json_decode($raw !== false ? $raw : '', true);
                if (!is_array($data)) {
                    $imported[] = ['profile' => $profile, 'file' => $file,
                        'status' => 'ERROR', 'error' => 'Ungueltiges JSON'];
                    continue;
                }
                // Optimistic-Check uebersprungen (Erst-Import); idempotent durch Upsert.
                $res = CatalogRepository::saveProfile($profile, $data, null, 'migration', 'import');
                $imported[] = [
                    'profile'    => $profile,
                    'file'       => $file,
                    'status'     => $res['success'] ? 'OK' : 'CONFLICT',
                    'revision'   => $res['revision'],
                    'lyrmgrKeys' => count($data),
                ];
            }
            echo json_encode(['success' => true, 'imported' => $imported], JSON_PRETTY_PRINT);
        }

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
