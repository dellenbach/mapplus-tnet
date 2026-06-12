<?php
/**
 * SyncRepository.php
 * Umgebungs-Synchronisation zwischen PostgreSQL-Schemas (DEV ↔ PROD).
 *
 * Vergleicht und kopiert Inhalte zwischen:
 *   mapplusconf_dev  (maps-dev)
 *   mapplusconf      (maps / PROD)
 *
 * Unterstützte Domains:
 *   bookmarks   — bookmark-Tabellen
 *   catalog     — catalog_document pro Profil
 *   bundles     — config_bundle_store (Staging-Import-Bundles)
 *
 * Erweiterbar auf 3+ Umgebungen via $schemaMap.
 *
 * @version    1.0
 * @date       2026-06-11
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */
require_once __DIR__ . '/Database.php';

class SyncRepository {

    /** Bekannte Environments und ihre DB-Schemas */
    public static function schemaMap(): array {
        return [
            'dev'  => 'mapplusconf_dev',
            'prod' => 'mapplusconf',
        ];
    }

    /** Validiert und gibt den Schema-Namen zurück */
    public static function schema(string $env): string {
        $map = self::schemaMap();
        if (!isset($map[$env])) {
            throw new InvalidArgumentException('Unbekannte Umgebung: ' . $env);
        }
        $s = $map[$env];
        if (!preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $s)) {
            throw new InvalidArgumentException('Ungültiger Schema-Name: ' . $s);
        }
        return $s;
    }

    /**
     * Gibt einen Status-Überblick für alle Domains in allen Environments.
     */
    public static function getStatus(): array {
        $pdo    = Database::getConnection();
        $schemas = self::schemaMap();
        $result = [
            'environments' => $schemas,
            'domains'      => [],
        ];

        // ── Bookmarks ──
        $bmCounts = [];
        $bmRevs   = [];
        $bmMeta   = [];
        foreach ($schemas as $env => $schema) {
            try {
                $stmt = $pdo->query("SELECT COUNT(*) AS cnt FROM " . self::q($schema) . ".bookmark WHERE deleted = false");
                $bmCounts[$env] = (int)$stmt->fetch()['cnt'];
                $stmt2 = $pdo->query("SELECT revision, updated_by, updated_at FROM " . self::q($schema) . ".bookmark_meta WHERE scope = 'bookmarks'");
                $row = $stmt2->fetch();
                $bmRevs[$env] = $row ? (int)$row['revision'] : 0;
                $bmMeta[$env] = $row ? [
                    'updatedBy' => $row['updated_by'] ?? null,
                    'updatedAt' => $row['updated_at'] ?? null,
                ] : null;
            } catch (\Throwable $e) {
                $bmCounts[$env] = null;
                $bmRevs[$env]   = null;
                $bmMeta[$env]   = null;
            }
        }
        $result['domains']['bookmarks'] = [
            'label'   => 'Bookmarks',
            'counts'  => $bmCounts,
            'revs'    => $bmRevs,
            'meta'    => $bmMeta,
            'syncable' => ['dev-to-prod', 'prod-to-dev'],
        ];

        // ── Catalog (pro Profil) ──
        $catalogProfiles = [];
        $allProfiles = [];
        foreach ($schemas as $env => $schema) {
            try {
                $stmt = $pdo->query(
                    "SELECT profile, revision, updated_by, updated_at
                     FROM " . self::q($schema) . ".catalog_document
                     ORDER BY profile"
                );
                foreach ($stmt->fetchAll() as $row) {
                    $p = $row['profile'];
                    $allProfiles[$p] = true;
                    $catalogProfiles[$p][$env] = [
                        'revision'  => (int)$row['revision'],
                        'updatedBy' => $row['updated_by'],
                        'updatedAt' => $row['updated_at'],
                    ];
                }
            } catch (\Throwable $e) {
                $catalogProfiles['__error'][$env] = ['error' => $e->getMessage()];
            }
        }
        $catalogItems = [];
        foreach (array_keys($allProfiles) as $profile) {
            $item = ['profile' => $profile, 'envs' => []];
            foreach ($schemas as $env => $schema) {
                $item['envs'][$env] = $catalogProfiles[$profile][$env] ?? null;
            }
            // Status: identisch wenn beide vorhanden und gleiche Revision
            $revs = array_filter(array_map(function($e) { return $e ? $e['revision'] : null; }, $item['envs']));
            $item['status'] = (count($revs) === count($schemas) && count(array_unique($revs)) === 1) ? 'sync' : 'diff';
            $catalogItems[] = $item;
        }
        $result['domains']['catalog'] = [
            'label'   => 'Katalog (LyrMgr)',
            'items'   => $catalogItems,
            'syncable' => ['dev-to-prod', 'prod-to-dev'],
        ];

        // ── Config Bundles ──
        $bundleCounts = [];
        $bundleItems  = [];
        $allKuerzel   = [];
        foreach ($schemas as $env => $schema) {
            try {
                $stmt = $pdo->query(
                    "SELECT kuerzel, scope, last_imported_at, last_imported_by
                     FROM " . self::q($schema) . ".config_bundle_store
                     ORDER BY kuerzel"
                );
                $bundleCounts[$env] = 0;
                foreach ($stmt->fetchAll() as $row) {
                    $k = $row['kuerzel'];
                    $allKuerzel[$k] = true;
                    $bundleItems[$k][$env] = [
                        'scope'   => $row['scope'],
                        'importedAt' => $row['last_imported_at'],
                        'importedBy' => $row['last_imported_by'],
                    ];
                    $bundleCounts[$env]++;
                }
            } catch (\Throwable $e) {
                $bundleCounts[$env] = null;
            }
        }
        $bundleList = [];
        foreach (array_keys($allKuerzel) as $k) {
            $item = ['kuerzel' => $k, 'envs' => []];
            foreach ($schemas as $env => $schema) {
                $item['envs'][$env] = $bundleItems[$k][$env] ?? null;
            }
            $item['status'] = (count(array_filter($item['envs'])) === count($schemas)) ? 'both' : 'one-side';
            $bundleList[] = $item;
        }
        $result['domains']['bundles'] = [
            'label'   => 'Config-Bundles (Staging)',
            'counts'  => $bundleCounts,
            'items'   => $bundleList,
            'syncable' => ['dev-to-prod', 'prod-to-dev'],
        ];

        // ── Schema-Status (je Umgebung) ──
        $schemaStatus = [];
        foreach ($schemas as $env => $schema) {
            try {
                $schemaStatus[$env] = self::checkSchema($env);
            } catch (\Throwable $e) {
                $schemaStatus[$env] = ['schema' => $schema, 'missing' => ['(Fehler)'], 'ready' => false];
            }
        }
        $result['schemaStatus'] = $schemaStatus;

        return $result;
    }

    /**
     * Führt eine Sync-Operation aus.
     *
     * @param string      $domain    'bookmarks' | 'catalog' | 'bundles'
     * @param string      $direction 'dev-to-prod' | 'prod-to-dev'
     * @param array|null  $keys      Optionale Einschränkung (z.B. Profile-Namen)
     * @param string      $user      Bearbeiter
     * @return array Ergebnis mit 'copied', 'skipped', 'errors'
     */
    public static function execute(string $domain, string $direction, ?array $keys, string $user): array {
        [$srcEnv, $dstEnv] = self::parseDirection($direction);
        $src = self::schema($srcEnv);
        $dst = self::schema($dstEnv);

        switch ($domain) {
            case 'bookmarks': return self::syncBookmarks($src, $dst, $user);
            case 'catalog':   return self::syncCatalog($src, $dst, $keys, $user);
            case 'bundles':   return self::syncBundles($src, $dst, $keys, $user);
            default: throw new InvalidArgumentException('Unbekannte Domain: ' . $domain);
        }
    }

    // ===== DOMAIN-SYNC =====

    private static function syncBookmarks(string $src, string $dst, string $user): array {
        $pdo = Database::getConnection();
        $pdo->beginTransaction();
        try {
            // Alle aktiven Bookmarks aus Quelle lesen
            $stmt = $pdo->query(
                "SELECT bookmark_id, name, payload, sort_idx, version
                 FROM " . self::q($src) . ".bookmark
                 WHERE deleted = false
                 ORDER BY sort_idx ASC, bookmark_id ASC"
            );
            $rows = $stmt->fetchAll();

            // Ziel: alle als gelöscht markieren
            $pdo->exec("UPDATE " . self::q($dst) . ".bookmark SET deleted = true, updated_by = " . $pdo->quote($user));

            $copied = 0;
            foreach ($rows as $row) {
                // UPSERT: Insert or update each bookmark in destination
                $stmt2 = $pdo->prepare(
                    "INSERT INTO " . self::q($dst) . ".bookmark
                        (bookmark_id, name, payload, sort_idx, version, deleted, updated_by)
                     VALUES (:id, :name, :payload::jsonb, :sort, :version, false, :user)
                     ON CONFLICT (bookmark_id) DO UPDATE
                       SET name       = EXCLUDED.name,
                           payload    = EXCLUDED.payload,
                           sort_idx   = EXCLUDED.sort_idx,
                           version    = " . self::q($dst) . ".bookmark.version + 1,
                           deleted    = false,
                           updated_by = EXCLUDED.updated_by"
                );
                $stmt2->execute([
                    'id'      => $row['bookmark_id'],
                    'name'    => $row['name'],
                    'payload' => is_array($row['payload']) ? json_encode($row['payload']) : $row['payload'],
                    'sort'    => $row['sort_idx'],
                    'version' => $row['version'],
                    'user'    => $user,
                ]);
                $copied++;
            }

            // Revision im Ziel erhöhen
            $pdo->exec(
                "UPDATE " . self::q($dst) . ".bookmark_meta
                 SET revision = revision + 1, updated_by = " . $pdo->quote($user) . ", updated_at = now()
                 WHERE scope = 'bookmarks'"
            );

            $pdo->commit();
            return ['copied' => $copied, 'deleted' => 0, 'errors' => []];
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        }
    }

    private static function syncCatalog(string $src, string $dst, ?array $profiles, string $user): array {
        $pdo    = Database::getConnection();
        $copied = 0; $errors = [];

        // Alle oder ausgewählte Profile lesen
        if ($profiles) {
            $placeholders = implode(',', array_fill(0, count($profiles), '?'));
            $stmt = $pdo->prepare(
                "SELECT profile, payload, revision
                 FROM " . self::q($src) . ".catalog_document
                 WHERE profile IN (" . $placeholders . ")"
            );
            $stmt->execute($profiles);
        } else {
            $stmt = $pdo->query(
                "SELECT profile, payload, revision FROM " . self::q($src) . ".catalog_document"
            );
        }
        $rows = $stmt->fetchAll();

        foreach ($rows as $row) {
            $pdo->beginTransaction();
            try {
                $payload = is_array($row['payload']) ? json_encode($row['payload']) : $row['payload'];
                $upsert = $pdo->prepare(
                    "INSERT INTO " . self::q($dst) . ".catalog_document
                        (profile, payload, revision, updated_by, updated_at)
                     VALUES (:profile, :payload::jsonb, :revision, :user, now())
                     ON CONFLICT (profile) DO UPDATE
                       SET payload    = EXCLUDED.payload,
                           revision   = " . self::q($dst) . ".catalog_document.revision + 1,
                           updated_by = EXCLUDED.updated_by,
                           updated_at = now()"
                );
                $upsert->execute([
                    'profile'  => $row['profile'],
                    'payload'  => $payload,
                    'revision' => (int)$row['revision'],
                    'user'     => $user . ' (sync from ' . $src . ')',
                ]);
                $pdo->commit();
                $copied++;
            } catch (\Throwable $e) {
                if ($pdo->inTransaction()) $pdo->rollBack();
                $errors[] = $row['profile'] . ': ' . $e->getMessage();
            }
        }

        return ['copied' => $copied, 'errors' => $errors];
    }

    private static function syncBundles(string $src, string $dst, ?array $kuerzel, string $user): array {
        $pdo    = Database::getConnection();
        $copied = 0; $errors = [];

        if ($kuerzel) {
            $placeholders = implode(',', array_fill(0, count($kuerzel), '?'));
            $stmt = $pdo->prepare(
                "SELECT kuerzel, payload, scope, tags
                 FROM " . self::q($src) . ".config_bundle_store cbs
                 WHERE kuerzel IN (" . $placeholders . ")"
            );
            $stmt->execute($kuerzel);
        } else {
            $stmt = $pdo->query(
                "SELECT kuerzel, payload, scope, tags
                 FROM " . self::q($src) . ".config_bundle_store cbs"
            );
        }
        $rows = $stmt->fetchAll();

        foreach ($rows as $row) {
            try {
                $payload = is_array($row['payload']) ? json_encode($row['payload']) : $row['payload'];
                $tags    = is_array($row['tags'])    ? json_encode($row['tags'])    : ($row['tags'] ?? '[]');
                $upsert  = $pdo->prepare(
                    "INSERT INTO " . self::q($dst) . ".config_bundle_store
                        (kuerzel, payload, scope, tags, last_imported_at, last_imported_by)
                     VALUES (:kuerzel, :payload::jsonb, :scope, :tags::jsonb, now(), :user)
                     ON CONFLICT (kuerzel) DO UPDATE
                       SET payload          = EXCLUDED.payload,
                           scope            = EXCLUDED.scope,
                           tags             = EXCLUDED.tags,
                           last_imported_at = now(),
                           last_imported_by = EXCLUDED.last_imported_by"
                );
                $upsert->execute([
                    'kuerzel' => $row['kuerzel'],
                    'payload' => $payload,
                    'scope'   => $row['scope'] ?? 'core',
                    'tags'    => $tags,
                    'user'    => $user,
                ]);
                $copied++;
            } catch (\Throwable $e) {
                $errors[] = $row['kuerzel'] . ': ' . $e->getMessage();
            }
        }

        return ['copied' => $copied, 'errors' => $errors];
    }

    /**
     * Prüft welche Kerntabellen in einem Schema fehlen.
     */
    public static function checkSchema(string $env): array {
        $pdo    = Database::getConnection();
        $schema = self::schema($env);
        $tables = ['bookmark', 'bookmark_meta', 'catalog_document', 'config_bundle_store'];
        $missing = [];
        foreach ($tables as $table) {
            try {
                $pdo->query("SELECT 1 FROM " . self::q($schema) . "." . $table . " LIMIT 1");
            } catch (\Throwable $e) {
                $missing[] = $table;
            }
        }
        return ['schema' => $schema, 'missing' => $missing, 'ready' => empty($missing)];
    }

    /**
     * Legt fehlende Kerntabellen in einem Schema idempotent an (CREATE TABLE IF NOT EXISTS).
     * Bestehende Daten bleiben erhalten.
     */
    public static function initSchema(string $env): array {
        $pdo = Database::getConnection();
        $s   = self::schema($env);   // z.B. "mapplusconf" oder "mapplusconf_dev"
        $sq  = self::q($s);          // z.B. '"mapplusconf"'
        $results = [];

        $run = function(string $sql) use ($pdo, &$results): void {
            try {
                $pdo->exec($sql);
                $results[] = ['ok' => true, 'sql' => substr(preg_replace('/\s+/', ' ', $sql), 0, 80)];
            } catch (\Throwable $e) {
                $results[] = ['ok' => false, 'error' => $e->getMessage(),
                              'sql' => substr(preg_replace('/\s+/', ' ', $sql), 0, 80)];
            }
        };

        // ── Trigger-Funktion (idempotent) ──
        $run("CREATE OR REPLACE FUNCTION {$sq}.set_updated_at()
              RETURNS trigger LANGUAGE plpgsql AS
              \$\$ BEGIN NEW.updated_at = now(); RETURN NEW; END; \$\$");

        // ── Bookmarks ──
        $run("CREATE TABLE IF NOT EXISTS {$sq}.bookmark (
                bookmark_id TEXT PRIMARY KEY, name TEXT,
                payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                sort_idx INTEGER NOT NULL DEFAULT 0,
                version INTEGER NOT NULL DEFAULT 1,
                deleted BOOLEAN NOT NULL DEFAULT false,
                updated_by TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now())");
        $run("CREATE INDEX IF NOT EXISTS idx_bookmark_active ON {$sq}.bookmark (sort_idx) WHERE deleted = false");
        $run("CREATE INDEX IF NOT EXISTS idx_bookmark_payload ON {$sq}.bookmark USING GIN (payload)");
        $run("CREATE TABLE IF NOT EXISTS {$sq}.bookmark_history (
                id SERIAL PRIMARY KEY, bookmark_id TEXT NOT NULL,
                version INTEGER NOT NULL, action TEXT NOT NULL,
                payload JSONB, changed_by TEXT,
                changed_at TIMESTAMPTZ NOT NULL DEFAULT now())");
        $run("CREATE INDEX IF NOT EXISTS idx_bookmark_hist_id ON {$sq}.bookmark_history (bookmark_id, version DESC)");
        $run("CREATE TABLE IF NOT EXISTS {$sq}.bookmark_lock (
                scope TEXT PRIMARY KEY, locked_by TEXT NOT NULL,
                locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                expires_at TIMESTAMPTZ NOT NULL)");
        $run("CREATE TABLE IF NOT EXISTS {$sq}.bookmark_meta (
                scope TEXT PRIMARY KEY,
                revision INTEGER NOT NULL DEFAULT 1,
                updated_by TEXT,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now())");
        $run("INSERT INTO {$sq}.bookmark_meta (scope, revision) VALUES ('bookmarks', 1) ON CONFLICT (scope) DO NOTHING");
        $run("DROP TRIGGER IF EXISTS trg_bookmark_updated ON {$sq}.bookmark");
        $run("CREATE TRIGGER trg_bookmark_updated BEFORE UPDATE ON {$sq}.bookmark
              FOR EACH ROW EXECUTE FUNCTION {$sq}.set_updated_at()");

        // ── Katalog (catalog_document) ──
        $run("CREATE TABLE IF NOT EXISTS {$sq}.catalog_document (
                profile TEXT PRIMARY KEY,
                payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                revision INTEGER NOT NULL DEFAULT 1,
                updated_by TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now())");
        $run("CREATE TABLE IF NOT EXISTS {$sq}.catalog_document_history (
                id SERIAL PRIMARY KEY, profile TEXT NOT NULL,
                revision INTEGER NOT NULL,
                action TEXT NOT NULL, lyrmgr_key TEXT,
                payload JSONB, changed_by TEXT,
                changed_at TIMESTAMPTZ NOT NULL DEFAULT now())");
        $run("CREATE INDEX IF NOT EXISTS idx_catalog_doc_hist ON {$sq}.catalog_document_history (profile, revision DESC)");
        $run("CREATE TABLE IF NOT EXISTS {$sq}.catalog_lock (
                profile TEXT PRIMARY KEY, locked_by TEXT NOT NULL,
                locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                expires_at TIMESTAMPTZ NOT NULL)");
        $run("DROP TRIGGER IF EXISTS trg_catalog_document_updated ON {$sq}.catalog_document");
        $run("CREATE TRIGGER trg_catalog_document_updated BEFORE UPDATE ON {$sq}.catalog_document
              FOR EACH ROW EXECUTE FUNCTION {$sq}.set_updated_at()");

        // ── Config-Bundles ──
        $run("CREATE TABLE IF NOT EXISTS {$sq}.config_bundle_store (
                kuerzel TEXT PRIMARY KEY,
                tags JSONB NOT NULL DEFAULT '[]'::jsonb,
                payload JSONB NOT NULL DEFAULT '{\"files\":[]}'::jsonb,
                manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
                last_imported_at TIMESTAMPTZ, last_imported_by TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now())");
        $run("ALTER TABLE {$sq}.config_bundle_store ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'core'");
        $run("ALTER TABLE {$sq}.config_bundle_store ADD COLUMN IF NOT EXISTS profile TEXT");
        $run("CREATE INDEX IF NOT EXISTS idx_config_bundle_tags ON {$sq}.config_bundle_store USING GIN (tags)");
        $run("CREATE INDEX IF NOT EXISTS idx_config_bundle_imported_at ON {$sq}.config_bundle_store (last_imported_at DESC)");
        $run("DROP TRIGGER IF EXISTS trg_config_bundle_updated ON {$sq}.config_bundle_store");
        $run("CREATE TRIGGER trg_config_bundle_updated BEFORE UPDATE ON {$sq}.config_bundle_store
              FOR EACH ROW EXECUTE FUNCTION {$sq}.set_updated_at()");

        $errors = count(array_filter($results, fn($r) => !$r['ok']));
        return ['ok' => ($errors === 0), 'steps' => count($results), 'errors' => $errors, 'env' => $env, 'schema' => $s];
    }


    /**
     * Erstellt ein vollständiges Backup einer Umgebung:
     *   - Bookmarks (alle aktiven + Meta/Revision)
     *   - Katalog/LyrMgr (alle catalog_document-Profile + Payloads)
     *   - Config-Bundles (alle config_bundle_store-Einträge)
     *
     * Dateiname: fullbackup_<env>_<ts>_<user>.json
     * Wird als Typ "bookmarks" gelistet (damit Restore-Dialog ihn findet).
     */
    public static function createFullBackup(string $env, string $user, string $backupDir): array {
        $pdo    = Database::getConnection();
        $schema = self::schema($env);
        $warnings = [];
        $summary  = [];

        // ── Bookmarks ──────────────────────────────────────────────────
        $bookmarks = [];
        $bmRevision = 0;
        $bmMeta     = null;
        try {
            $stmt = $pdo->query(
                "SELECT bookmark_id, name, payload, sort_idx, version
                 FROM " . self::q($schema) . ".bookmark
                 WHERE deleted = false
                 ORDER BY sort_idx ASC, bookmark_id ASC"
            );
            foreach ($stmt->fetchAll() as $row) {
                $p = is_string($row['payload']) ? json_decode($row['payload'], true) : $row['payload'];
                $bookmarks[] = [
                    'id'       => $row['bookmark_id'],
                    'name'     => $row['name'],
                    'payload'  => $p,
                    'sort_idx' => (int)$row['sort_idx'],
                ];
            }
        } catch (\Throwable $e) {
            $warnings[] = 'bookmarks: ' . $e->getMessage();
        }
        try {
            $stmtM = $pdo->query(
                "SELECT revision, updated_by, updated_at
                 FROM " . self::q($schema) . ".bookmark_meta
                 WHERE scope = 'bookmarks'"
            );
            $row = $stmtM->fetch();
            if ($row) {
                $bmRevision = (int)$row['revision'];
                $bmMeta = ['updatedBy' => $row['updated_by'], 'updatedAt' => $row['updated_at']];
            }
        } catch (\Throwable $e) { /* bookmark_meta fehlt */ }
        $summary['bookmarks'] = count($bookmarks);

        // ── Katalog (catalog_document pro Profil) ──────────────────────
        $catalog = [];
        try {
            $stmt = $pdo->query(
                "SELECT profile, payload, revision, updated_by, updated_at
                 FROM " . self::q($schema) . ".catalog_document
                 ORDER BY profile"
            );
            foreach ($stmt->fetchAll() as $row) {
                $p = is_string($row['payload']) ? json_decode($row['payload'], true) : $row['payload'];
                $catalog[] = [
                    'profile'   => $row['profile'],
                    'payload'   => $p,
                    'revision'  => (int)$row['revision'],
                    'updatedBy' => $row['updated_by'],
                    'updatedAt' => $row['updated_at'],
                ];
            }
        } catch (\Throwable $e) {
            $warnings[] = 'catalog: ' . $e->getMessage();
        }
        $summary['catalog'] = count($catalog);

        // ── Config-Bundles ─────────────────────────────────────────────
        $bundles = [];
        try {
            $stmt = $pdo->query(
                "SELECT kuerzel, payload, scope, tags, last_imported_at, last_imported_by
                 FROM " . self::q($schema) . ".config_bundle_store
                 ORDER BY kuerzel"
            );
            foreach ($stmt->fetchAll() as $row) {
                $p = is_string($row['payload']) ? json_decode($row['payload'], true) : $row['payload'];
                $t = is_string($row['tags'])    ? json_decode($row['tags'],    true) : $row['tags'];
                $bundles[] = [
                    'kuerzel'    => $row['kuerzel'],
                    'scope'      => $row['scope'],
                    'tags'       => $t,
                    'importedAt' => $row['last_imported_at'],
                    'importedBy' => $row['last_imported_by'],
                    'payload'    => $p,
                ];
            }
        } catch (\Throwable $e) {
            $warnings[] = 'bundles: ' . $e->getMessage();
        }
        $summary['bundles'] = count($bundles);

        // ── Datei schreiben ────────────────────────────────────────────
        $ts       = date('Ymd_His');
        $safeUser = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $user ?: 'unknown');
        // Präfix "bookmarks_" → wird als type=bookmarks in Backup-Liste erkannt und ist restorebar
        $filename = 'bookmarks_fullbackup_' . $env . '_' . $ts . '_' . $safeUser . '.json';
        $path     = rtrim($backupDir, '/') . '/' . $filename;

        if (!is_dir($backupDir)) @mkdir($backupDir, 0775, true);

        $data = [
            '_meta' => [
                'type'        => 'fullbackup',
                'env'         => $env,
                'schema'      => $schema,
                'savedBy'     => $user,
                'savedAt'     => date('Y-m-d H:i:s'),
                'summary'     => $summary,
                'bmRevision'  => $bmRevision,
                'bmMeta'      => $bmMeta,
                'warnings'    => $warnings,
            ],
            'bookmarks' => $bookmarks,
            'catalog'   => $catalog,
            'bundles'   => $bundles,
        ];

        $bytes = file_put_contents(
            $path,
            json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
        );
        if ($bytes === false) {
            throw new \RuntimeException('Fullbackup konnte nicht geschrieben werden: ' . $path);
        }

        return [
            'file'     => $filename,
            'env'      => $env,
            'summary'  => $summary,
            'bytes'    => $bytes,
            'warnings' => $warnings,
        ];
    }

    /**
     * Erstellt ein Bookmark-Snapshot-Backup für eine gewählte Umgebung.
     * Dateiname: bookmarks_<env>_<ts>_<user>.json — wird als Typ "bookmarks" gelistet.
     */
    public static function createEnvBackup(string $env, string $user, string $backupDir): array {
        $pdo    = Database::getConnection();
        $schema = self::schema($env);

        $bookmarks = [];
        $revision  = 0;
        $meta      = null;
        $warning   = null;

        // Aktive Bookmarks laden (graceful: Tabelle fehlt in manchen Umgebungen)
        try {
            $stmt = $pdo->query(
                "SELECT bookmark_id, name, payload, sort_idx, version
                 FROM " . self::q($schema) . ".bookmark
                 WHERE deleted = false
                 ORDER BY sort_idx ASC, bookmark_id ASC"
            );
            foreach ($stmt->fetchAll() as $row) {
                $p = is_string($row['payload']) ? json_decode($row['payload'], true) : $row['payload'];
                $bookmarks[] = [
                    'id'       => $row['bookmark_id'],
                    'name'     => $row['name'],
                    'payload'  => $p,
                    'sort_idx' => (int)$row['sort_idx'],
                ];
            }
        } catch (\Throwable $e) {
            $warning = 'Bookmarks-Tabelle fehlt in ' . $schema . ' (Umgebung: ' . $env . '). Backup wird mit 0 Bookmarks erstellt.';
        }

        // Revision + Metadaten (ebenfalls graceful)
        try {
            $stmtMeta = $pdo->query(
                "SELECT revision, updated_by, updated_at
                 FROM " . self::q($schema) . ".bookmark_meta
                 WHERE scope = 'bookmarks'"
            );
            $meta     = $stmtMeta->fetch();
            $revision = $meta ? (int)$meta['revision'] : 0;
        } catch (\Throwable $e) {
            // bookmark_meta fehlt ebenfalls — revision bleibt 0
        }

        $ts         = date('Ymd_His');
        $safeUser   = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $user ?: 'unknown');
        // Präfix "bookmarks_" => wird von listAllBackups() als type=bookmarks erkannt
        $filename   = 'bookmarks_' . $env . '_' . $ts . '_' . $safeUser . '.json';
        $path       = $backupDir . '/' . $filename;

        if (!is_dir($backupDir)) @mkdir($backupDir, 0775, true);

        $data = [
            '_meta' => [
                'env'       => $env,
                'schema'    => $schema,
                'savedBy'   => $user,
                'savedAt'   => date('Y-m-d H:i:s'),
                'revision'  => $revision,
                'updatedBy' => $meta ? ($meta['updated_by'] ?? null) : null,
                'updatedAt' => $meta ? ($meta['updated_at'] ?? null) : null,
                'count'     => count($bookmarks),
                'type'      => 'sync-env-backup',
                'warning'   => $warning,
            ],
            'bookmarks' => $bookmarks,
        ];

        $bytes = file_put_contents(
            $path,
            json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
        );
        if ($bytes === false) {
            throw new \RuntimeException('Backup konnte nicht geschrieben werden: ' . $path);
        }

        return [
            'file'          => $filename,
            'bookmarkCount' => count($bookmarks),
            'env'           => $env,
            'revision'      => $revision,
            'bytes'         => $bytes,
            'warning'       => $warning,
        ];
    }

    // ===== HELFER =====

    private static function parseDirection(string $direction): array {
        if ($direction === 'dev-to-prod') return ['dev', 'prod'];
        if ($direction === 'prod-to-dev') return ['prod', 'dev'];
        throw new InvalidArgumentException('Unbekannte Richtung: ' . $direction);
    }

    private static function q(string $schema): string {
        return '"' . str_replace('"', '', $schema) . '"';
    }
}
