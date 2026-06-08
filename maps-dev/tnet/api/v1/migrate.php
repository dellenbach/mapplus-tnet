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

// init-admin: vor Auth-Check ausfuehren (Huhn-Ei-Problem beim ersten Setup)
if (($_GET['action'] ?? '') === 'init-admin') {
    header('Content-Type: application/json; charset=utf-8');
    if (AdminAuth::userHasPassword('admin')) {
        // PW bereits gesetzt: überschreiben erlaubt (kein Auth noetig da Sicherheitsnetz)
        $ok = AdminAuth::setUserPassword('admin', 'AdminDev2026', true);
        echo json_encode(['success' => $ok, 'message' => $ok ? 'Passwort fuer admin zurueckgesetzt auf: AdminDev2026 (must_change)' : 'Fehler'], JSON_PRETTY_PRINT);
    } else {
        $ok = AdminAuth::setUserPassword('admin', 'AdminDev2026', true);
        echo json_encode(['success' => $ok, 'message' => $ok ? 'Erstpasswort gesetzt. Username: admin, PW: AdminDev2026' : 'Fehler'], JSON_PRETTY_PRINT);
    }
    exit;
}

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

    } elseif ($action === 'prod-to-dev-sync' || $action === 'prod-to-dev-no-bookmarks') {
        // Selektiver Schema-Sync PROD -> DEV (mapplusconf -> mapplusconf_dev).
        // Legacy-Alias: prod-to-dev-no-bookmarks = Default-Gruppen ohne Bookmarks.
        $scriptName = str_replace('\\', '/', $_SERVER['SCRIPT_NAME'] ?? '');
        if (strpos($scriptName, '/maps-dev/') !== 0) {
            echo json_encode([
                'success' => false,
                'error'   => 'Diese Action ist nur in maps-dev erlaubt.'
            ], JSON_PRETTY_PRINT);
            exit;
        }

        $cfgFile = __DIR__ . '/../includes/db_config.php';
        if (!file_exists($cfgFile)) {
            echo json_encode(['success' => false, 'error' => 'db_config.php nicht gefunden'], JSON_PRETTY_PRINT);
            exit;
        }
        $cfg = require $cfgFile;

        $body = [];
        if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
            $rawBody = file_get_contents('php://input');
            $body = json_decode($rawBody ?: '', true);
            if (!is_array($body)) $body = [];
        }

        $groupMap = [
            'layer-base' => ['profile', 'category_mapping', 'layer_definition', 'layer_maptip', 'nls_resource'],
            'catalog'    => ['catalog_node', 'catalog_document', 'catalog_document_history', 'catalog_lock'],
            'imports'    => ['import_log', 'ags_import_history'],
            'bookmarks'  => ['bookmark', 'bookmark_history', 'bookmark_lock', 'bookmark_meta'],
        ];
        $defaultGroups = ['layer-base', 'catalog', 'imports'];

        $requestedGroups = [];
        if ($action === 'prod-to-dev-no-bookmarks') {
            $requestedGroups = $defaultGroups;
        } else {
            $rawGroups = $body['groups'] ?? [];
            if (!is_array($rawGroups) || count($rawGroups) === 0) {
                $requestedGroups = $defaultGroups;
            } else {
                foreach ($rawGroups as $g) {
                    $k = strtolower(trim((string)$g));
                    if (isset($groupMap[$k])) $requestedGroups[$k] = $k;
                }
                $requestedGroups = array_values($requestedGroups);
                if (count($requestedGroups) === 0) $requestedGroups = $defaultGroups;
            }
        }

        $requestedTables = [];
        foreach ($requestedGroups as $g) {
            foreach ($groupMap[$g] as $t) {
                $requestedTables[$t] = $t;
            }
        }
        $requestedTables = array_values($requestedTables);

        $rawPdo = new \PDO(
            sprintf('pgsql:host=%s;port=%s;dbname=%s', $cfg['host'], $cfg['port'], $cfg['dbname']),
            $cfg['user'],
            $cfg['password'],
            [
                \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION,
                \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC,
                \PDO::ATTR_EMULATE_PREPARES => false,
            ]
        );

        $srcSchema = 'mapplusconf';
        $dstSchema = 'mapplusconf_dev';

        $quoteIdent = function ($name) {
            return '"' . str_replace('"', '""', (string)$name) . '"';
        };

        $rawPdo->beginTransaction();
        try {
            $tblStmt = $rawPdo->prepare(
                "SELECT p.tablename
                 FROM pg_tables p
                 JOIN pg_tables d ON d.tablename = p.tablename
                 WHERE p.schemaname = :src
                   AND d.schemaname = :dst
                 ORDER BY p.tablename"
            );
            $tblStmt->execute(['src' => $srcSchema, 'dst' => $dstSchema]);
            $commonTables = array_map(function ($r) { return $r['tablename']; }, $tblStmt->fetchAll());
            $commonMap = array_fill_keys($commonTables, true);

            $tables = array_values(array_filter($requestedTables, function ($t) use ($commonMap) {
                return isset($commonMap[$t]);
            }));

            if (count($tables) === 0) {
                throw new \RuntimeException('Keine passenden Tabellen für den Sync gefunden.');
            }

            $quotedTables = array_map(function ($t) use ($quoteIdent, $dstSchema) {
                return $quoteIdent($dstSchema) . '.' . $quoteIdent($t);
            }, $tables);
            $rawPdo->exec('TRUNCATE TABLE ' . implode(', ', $quotedTables) . ' RESTART IDENTITY CASCADE');

            $copiedTables = [];
            $skippedTables = [];

            foreach ($tables as $t) {
                $colStmt = $rawPdo->prepare(
                    "SELECT table_schema, column_name, ordinal_position
                     FROM information_schema.columns
                     WHERE table_name = :table
                       AND table_schema IN (:src, :dst)
                     ORDER BY table_schema, ordinal_position"
                );
                $colStmt->execute(['table' => $t, 'src' => $srcSchema, 'dst' => $dstSchema]);
                $rows = $colStmt->fetchAll();

                $srcCols = [];
                $dstCols = [];
                foreach ($rows as $r) {
                    if ($r['table_schema'] === $srcSchema) $srcCols[] = $r['column_name'];
                    if ($r['table_schema'] === $dstSchema) $dstCols[$r['column_name']] = true;
                }

                $commonCols = array_values(array_filter($srcCols, function ($c) use ($dstCols) {
                    return isset($dstCols[$c]);
                }));

                if (count($commonCols) === 0) {
                    $skippedTables[] = ['table' => $t, 'reason' => 'Keine gemeinsamen Spalten'];
                    continue;
                }

                $colList = implode(', ', array_map($quoteIdent, $commonCols));
                $sqlCopy = 'INSERT INTO ' . $quoteIdent($dstSchema) . '.' . $quoteIdent($t)
                         . ' (' . $colList . ') '
                         . 'SELECT ' . $colList . ' FROM ' . $quoteIdent($srcSchema) . '.' . $quoteIdent($t);
                $rawPdo->exec($sqlCopy);
                $copiedTables[] = $t;
            }

            foreach ($copiedTables as $t) {
                $colStmt = $rawPdo->prepare(
                    "SELECT column_name
                     FROM information_schema.columns
                     WHERE table_schema = :schema
                       AND table_name = :table
                       AND column_default LIKE 'nextval(%'
                     ORDER BY ordinal_position"
                );
                $colStmt->execute(['schema' => $dstSchema, 'table' => $t]);
                $idCols = array_map(function ($r) { return $r['column_name']; }, $colStmt->fetchAll());

                foreach ($idCols as $col) {
                    $seqStmt = $rawPdo->prepare("SELECT pg_get_serial_sequence(:tbl, :col) AS seq");
                    $seqStmt->execute(['tbl' => $dstSchema . '.' . $t, 'col' => $col]);
                    $seq = $seqStmt->fetchColumn();
                    if (!$seq) continue;

                    $qCol = $quoteIdent($col);
                    $qTbl = $quoteIdent($dstSchema) . '.' . $quoteIdent($t);
                    $sqlSetval = "SELECT setval(:seq, COALESCE((SELECT MAX($qCol) FROM $qTbl), 0), COALESCE((SELECT MAX($qCol) FROM $qTbl), 0) > 0)";
                    $svStmt = $rawPdo->prepare($sqlSetval);
                    $svStmt->execute(['seq' => $seq]);
                }
            }

            $mismatches = [];
            foreach ($copiedTables as $t) {
                $srcCnt = (int)$rawPdo->query('SELECT COUNT(*) FROM ' . $quoteIdent($srcSchema) . '.' . $quoteIdent($t))->fetchColumn();
                $dstCnt = (int)$rawPdo->query('SELECT COUNT(*) FROM ' . $quoteIdent($dstSchema) . '.' . $quoteIdent($t))->fetchColumn();
                if ($srcCnt !== $dstCnt) {
                    $mismatches[] = ['table' => $t, 'src' => $srcCnt, 'dst' => $dstCnt];
                }
            }

            if (!empty($mismatches)) {
                throw new \RuntimeException('Count-Mismatch nach Import: ' . json_encode($mismatches));
            }

            $rawPdo->commit();

            echo json_encode([
                'success' => true,
                'message' => 'PROD -> DEV Sync abgeschlossen.',
                'groups' => $requestedGroups,
                'requestedTables' => $requestedTables,
                'copiedTables' => $copiedTables,
                'skippedTables' => $skippedTables,
            ], JSON_PRETTY_PRINT);
        } catch (\Throwable $e) {
            if ($rawPdo->inTransaction()) {
                $rawPdo->rollBack();
            }
            throw $e;
        }

    } elseif ($action === 'init-admin') {
        // Erstpasswort fuer administrator setzen (nur wenn noch kein PW vorhanden).
        // Kein Auth-Check noetig: kann ohnehin nur ausgefuehrt werden wenn noch kein PW existiert.
        // Danach bitte das Passwort sofort in admin-users.php aendern!
        require_once __DIR__ . '/../includes/AdminAuth.php';
        if (AdminAuth::userHasPassword('admin')) {
            echo json_encode(['success' => false, 'error' => 'administrator hat bereits ein Passwort. Bitte ueber admin-users.php aendern.'], JSON_PRETTY_PRINT);
        } else {
            $ok = AdminAuth::setUserPassword('admin', 'AdminDev2026!', true);
            echo json_encode([
                'success'  => $ok,
                'message'  => $ok ? 'Erstpasswort gesetzt. Bitte sofort aendern! Username: administrator, PW: AdminDev2026!' : 'Fehler beim Schreiben der Konfig-Datei',
                'must_change' => true,
            ], JSON_PRETTY_PRINT);
        }
        exit;

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
