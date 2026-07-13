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

        // Selbstheilend: Sync-Spalten sicherstellen (idempotent, Best-Effort).
        self::ensureSyncColumns($pdo);

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
                $stmt2 = $pdo->query("SELECT revision, updated_by, updated_at, synced_at, synced_by FROM " . self::q($schema) . ".bookmark_meta WHERE scope = 'bookmarks'");
                $row = $stmt2->fetch();
                $bmRevs[$env] = $row ? (int)$row['revision'] : 0;
                $bmMeta[$env] = $row ? [
                    'updatedBy' => $row['updated_by'] ?? null,
                    'updatedAt' => $row['updated_at'] ?? null,
                    'syncedAt'  => $row['synced_at'] ?? null,
                    'syncedBy'  => $row['synced_by'] ?? null,
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
                    "SELECT cd.profile,
                            cd.revision,
                            cd.updated_by,
                            cd.updated_at,
                            COALESCE(cd.config_revision_at, ch_cfg.changed_at, cd.updated_at) AS config_updated_at,
                            COALESCE(cd.config_revision_by, cd.updated_by) AS config_updated_by,
                            ch_sync.changed_at AS sync_updated_at
                     FROM " . self::q($schema) . ".catalog_document cd
                     LEFT JOIN LATERAL (
                         SELECT h.changed_at
                         FROM " . self::q($schema) . ".catalog_document_history h
                         WHERE h.profile = cd.profile
                           AND h.revision = cd.revision
                                                     AND h.action <> 'import'
                                                 ORDER BY h.id DESC
                         LIMIT 1
                                         ) ch_cfg ON true
                                         LEFT JOIN LATERAL (
                                                 SELECT h.changed_at
                                                 FROM " . self::q($schema) . ".catalog_document_history h
                                                 WHERE h.profile = cd.profile
                                                     AND h.action = 'import'
                                                 ORDER BY h.id DESC
                                                 LIMIT 1
                                         ) ch_sync ON true
                     ORDER BY cd.profile"
                );
                foreach ($stmt->fetchAll() as $row) {
                    $p = $row['profile'];
                    $allProfiles[$p] = true;
                    $catalogProfiles[$p][$env] = [
                        'revision'  => (int)$row['revision'],
                        'updatedBy' => $row['updated_by'],
                        'updatedAt' => $row['updated_at'],
                        'configUpdatedAt' => $row['config_updated_at'] ?? null,
                        'configUpdatedBy' => $row['config_updated_by'] ?? null,
                        'syncUpdatedAt' => $row['sync_updated_at'] ?? null,
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
                    "SELECT kuerzel, payload, scope, last_imported_at, last_imported_by,
                            synced_at, synced_by
                     FROM " . self::q($schema) . ".config_bundle_store
                     ORDER BY kuerzel"
                );
                $bundleCounts[$env] = 0;
                foreach ($stmt->fetchAll() as $row) {
                    $k = $row['kuerzel'];
                    $payload = is_string($row['payload']) ? json_decode($row['payload'], true) : $row['payload'];
                    $allKuerzel[$k] = true;
                    $bundleItems[$k][$env] = [
                        'scope'      => $row['scope'],
                        'importedAt' => $row['last_imported_at'],
                        'importedBy' => $row['last_imported_by'],
                        'syncedAt'   => $row['synced_at'] ?? null,
                        'syncedBy'   => $row['synced_by'] ?? null,
                        'files'      => self::extractBundleFiles($payload),
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

    /**
     * Löscht ausgewählte Einträge in EINER Umgebung (unwiderruflich).
     * Unterstützt 'catalog' (catalog_document pro Profil) und 'bundles'
     * (config_bundle_store pro Kürzel). Bookmarks werden nicht unterstützt.
     *
     * @param string   $domain 'catalog' | 'bundles'
     * @param string   $env    'dev' | 'prod'
     * @param string[] $keys   Profil-Namen bzw. Kürzel
     * @param string   $user   Bearbeiter (für Logging)
     * @return array{deleted:int, errors:array}
     */
    public static function deleteEntries(string $domain, string $env, array $keys, string $user): array {
        $schema = self::schema($env);
        $pdo    = Database::getConnection();
        $deleted = 0; $errors = [];

        $table = null; $col = null;
        if ($domain === 'bundles')      { $table = 'config_bundle_store'; $col = 'kuerzel'; }
        elseif ($domain === 'catalog')  { $table = 'catalog_document';    $col = 'profile'; }
        else { throw new InvalidArgumentException('Löschen für Domain nicht unterstützt: ' . $domain); }

        foreach ($keys as $key) {
            $key = (string)$key;
            if ($key === '') continue;
            try {
                $stmt = $pdo->prepare(
                    "DELETE FROM " . self::q($schema) . "." . $table . " WHERE " . $col . " = :key"
                );
                $stmt->execute(['key' => $key]);
                $deleted += $stmt->rowCount();
            } catch (\Throwable $e) {
                $errors[] = $key . ': ' . $e->getMessage();
            }
        }

        return ['deleted' => $deleted, 'errors' => $errors];
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

            // Revision + Konfig-Zeit aus Quelle übernehmen; Sync-Zeit lokal setzen.
            $pdo->exec(
                "UPDATE " . self::q($dst) . ".bookmark_meta dst
                 SET revision   = COALESCE(src.revision, dst.revision),
                     updated_by = " . $pdo->quote($user) . ",
                     updated_at = COALESCE(src.updated_at, now()),
                     synced_at  = now(),
                     synced_by  = " . $pdo->quote($user) . "
                 FROM " . self::q($src) . ".bookmark_meta src
                 WHERE dst.scope = 'bookmarks' AND src.scope = 'bookmarks'"
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
                "SELECT profile, payload, revision, updated_at, config_revision_at, config_revision_by
                 FROM " . self::q($src) . ".catalog_document
                 WHERE profile IN (" . $placeholders . ")"
            );
            $stmt->execute($profiles);
        } else {
            $stmt = $pdo->query(
                "SELECT profile, payload, revision, updated_at, config_revision_at, config_revision_by FROM " . self::q($src) . ".catalog_document"
            );
        }
        $rows = $stmt->fetchAll();

        foreach ($rows as $row) {
            $pdo->beginTransaction();
            try {
                $payload = is_array($row['payload']) ? json_encode($row['payload']) : $row['payload'];
                $upsert = $pdo->prepare(
                    "INSERT INTO " . self::q($dst) . ".catalog_document
                        (profile, payload, revision, updated_by, updated_at, config_revision_at, config_revision_by)
                     VALUES (:profile, :payload::jsonb, :revision, :user, :updated_at, :cfg_at, :cfg_by)
                     ON CONFLICT (profile) DO UPDATE
                       SET payload            = EXCLUDED.payload,
                           revision           = EXCLUDED.revision,
                           updated_by         = EXCLUDED.updated_by,
                           updated_at         = EXCLUDED.updated_at,
                           config_revision_at = EXCLUDED.config_revision_at,
                           config_revision_by = EXCLUDED.config_revision_by"
                );
                $upsert->execute([
                    'profile'  => $row['profile'],
                    'payload'  => $payload,
                    'revision' => (int)$row['revision'],
                    'user'     => $user . ' (sync from ' . $src . ')',
                    'updated_at' => $row['updated_at'] ?? null,
                    // Konfig-Zeitstempel + Login 1:1 aus der Quelle (Trigger fasst sie nicht an).
                    'cfg_at'   => $row['config_revision_at'] ?? ($row['updated_at'] ?? null),
                    'cfg_by'   => $row['config_revision_by'] ?? null,
                ]);

                // Sync-Zeit separat über History erfassen (falls Tabelle vorhanden).
                try {
                    $hist = $pdo->prepare(
                        "INSERT INTO " . self::q($dst) . ".catalog_document_history
                            (profile, revision, action, lyrmgr_key, payload, changed_by, changed_at)
                         VALUES (:profile, :revision, 'import', NULL, :payload::jsonb, :user, now())"
                    );
                    $hist->execute([
                        'profile'  => $row['profile'],
                        'revision' => (int)$row['revision'],
                        'payload'  => $payload,
                        'user'     => $user . ' (sync from ' . $src . ')',
                    ]);
                } catch (\Throwable $ignore) {
                    // Legacy-Schema ohne History: Sync soll trotzdem erfolgreich bleiben.
                }

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
                "SELECT kuerzel, payload, scope, tags, last_imported_at, last_imported_by
                 FROM " . self::q($src) . ".config_bundle_store cbs
                 WHERE kuerzel IN (" . $placeholders . ")"
            );
            $stmt->execute($kuerzel);
        } else {
            $stmt = $pdo->query(
                "SELECT kuerzel, payload, scope, tags, last_imported_at, last_imported_by
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
                        (kuerzel, payload, scope, tags, last_imported_at, last_imported_by, synced_at, synced_by)
                     VALUES (:kuerzel, :payload::jsonb, :scope, :tags::jsonb, COALESCE(:imported_at, now()), :imported_by, now(), :user)
                     ON CONFLICT (kuerzel) DO UPDATE
                       SET payload          = EXCLUDED.payload,
                           scope            = EXCLUDED.scope,
                           tags             = EXCLUDED.tags,
                           last_imported_at = EXCLUDED.last_imported_at,
                           last_imported_by = EXCLUDED.last_imported_by,
                           synced_at        = now(),
                           synced_by        = EXCLUDED.synced_by"
                );
                $upsert->execute([
                    'kuerzel'     => $row['kuerzel'],
                    'payload'     => $payload,
                    'scope'       => $row['scope'] ?? 'core',
                    'tags'        => $tags,
                    'imported_at' => $row['last_imported_at'] ?? null,
                    'imported_by' => $row['last_imported_by'] ?? null,
                    'user'        => $user,
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
        $run("ALTER TABLE {$sq}.catalog_document ADD COLUMN IF NOT EXISTS config_revision_at TIMESTAMPTZ");
        $run("ALTER TABLE {$sq}.catalog_document ADD COLUMN IF NOT EXISTS config_revision_by TEXT");
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
        // Sync-Zeitstempel (von Import-Zeit getrennt)
        $run("ALTER TABLE {$sq}.bookmark_meta ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ");
        $run("ALTER TABLE {$sq}.bookmark_meta ADD COLUMN IF NOT EXISTS synced_by TEXT");
        $run("ALTER TABLE {$sq}.config_bundle_store ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ");
        $run("ALTER TABLE {$sq}.config_bundle_store ADD COLUMN IF NOT EXISTS synced_by TEXT");
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
        $useGz    = function_exists('gzencode');
        // Präfix "bookmarks_" → wird als type=bookmarks in Backup-Liste erkannt und ist restorebar
        $filename = 'bookmarks_fullbackup_' . $env . '_' . $ts . '_' . $safeUser . ($useGz ? '.json.gz' : '.json');
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

        $jsonOut = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $bytes = file_put_contents($path, $useGz ? gzencode($jsonOut, 9) : $jsonOut);
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
     * Liefert ein leichtgewichtiges Inventar eines Fullbackups für den Restore-Dialog
     * (ohne die schweren Payloads).
     */
    public static function fullBackupInventory(array $backup): array {
        $meta = isset($backup['_meta']) && is_array($backup['_meta']) ? $backup['_meta'] : [];
        $catalog = array_map(function ($c) {
            return ['profile' => (string)($c['profile'] ?? ''), 'revision' => $c['revision'] ?? null];
        }, isset($backup['catalog']) && is_array($backup['catalog']) ? $backup['catalog'] : []);
        $bundles = array_map(function ($b) {
            return ['kuerzel' => (string)($b['kuerzel'] ?? ''), 'scope' => (string)($b['scope'] ?? 'core')];
        }, isset($backup['bundles']) && is_array($backup['bundles']) ? $backup['bundles'] : []);
        return [
            'env'       => $meta['env'] ?? null,
            'savedAt'   => $meta['savedAt'] ?? null,
            'savedBy'   => $meta['savedBy'] ?? null,
            'summary'   => $meta['summary'] ?? null,
            'bookmarks' => count(isset($backup['bookmarks']) && is_array($backup['bookmarks']) ? $backup['bookmarks'] : []),
            'catalog'   => $catalog,
            'bundles'   => $bundles,
        ];
    }

    /**
     * Stellt ausgewählte Teile eines Fullbackups in eine Zielumgebung wieder her (Merge/UPSERT).
     * Löscht keine bestehenden Einträge, die nicht im Backup sind.
     *
     * @param array      $backup          Dekodierter Backup-Inhalt (_meta, bookmarks, catalog, bundles)
     * @param string     $targetEnv       'dev' | 'prod'
     * @param bool       $doBookmarks     Bookmarks wiederherstellen
     * @param array|null $catalogProfiles Profile-Auswahl ([] = keine, null = alle)
     * @param array|null $bundleKuerzel   Kürzel-Auswahl ([] = keine, null = alle)
     */
    public static function restoreFullBackup(array $backup, string $targetEnv, bool $doBookmarks, ?array $catalogProfiles, ?array $bundleKuerzel): array {
        $pdo    = Database::getConnection();
        $schema = self::schema($targetEnv);
        $out = ['bookmarks' => 0, 'catalog' => 0, 'bundles' => 0, 'errors' => []];

        // ── Bookmarks (Merge, keine Löschungen) ──
        if ($doBookmarks && !empty($backup['bookmarks']) && is_array($backup['bookmarks'])) {
            foreach ($backup['bookmarks'] as $bm) {
                try {
                    $payload = $bm['payload'] ?? [];
                    $stmt = $pdo->prepare(
                        "INSERT INTO " . self::q($schema) . ".bookmark
                            (bookmark_id, name, payload, sort_idx, deleted, updated_by)
                         VALUES (:id, :name, :payload::jsonb, :sort, false, 'restore')
                         ON CONFLICT (bookmark_id) DO UPDATE
                           SET name       = EXCLUDED.name,
                               payload    = EXCLUDED.payload,
                               sort_idx   = EXCLUDED.sort_idx,
                               version    = " . self::q($schema) . ".bookmark.version + 1,
                               deleted    = false,
                               updated_by = EXCLUDED.updated_by"
                    );
                    $stmt->execute([
                        'id'      => $bm['id'] ?? $bm['bookmark_id'] ?? null,
                        'name'    => $bm['name'] ?? null,
                        'payload' => is_array($payload) ? json_encode($payload) : (string)$payload,
                        'sort'    => isset($bm['sort_idx']) ? (int)$bm['sort_idx'] : 0,
                    ]);
                    $out['bookmarks']++;
                } catch (\Throwable $e) {
                    $out['errors'][] = 'Bookmark ' . ($bm['id'] ?? '?') . ': ' . $e->getMessage();
                }
            }
            try {
                $pdo->exec("UPDATE " . self::q($schema) . ".bookmark_meta
                            SET revision = revision + 1, updated_by = 'restore', updated_at = now()
                            WHERE scope = 'bookmarks'");
            } catch (\Throwable $e) { /* meta optional */ }
        }

        // ── Katalog (gewählte Profile) ──
        if ($catalogProfiles === null || !empty($catalogProfiles)) {
            foreach ((isset($backup['catalog']) && is_array($backup['catalog']) ? $backup['catalog'] : []) as $cat) {
                $profile = $cat['profile'] ?? null;
                if ($profile === null || $profile === '') continue;
                if (is_array($catalogProfiles) && !in_array((string)$profile, $catalogProfiles, true)) continue;
                try {
                    $payload = $cat['payload'] ?? [];
                    $stmt = $pdo->prepare(
                        "INSERT INTO " . self::q($schema) . ".catalog_document
                            (profile, payload, revision, updated_by, updated_at)
                         VALUES (:profile, :payload::jsonb, :revision, 'restore', now())
                         ON CONFLICT (profile) DO UPDATE
                           SET payload    = EXCLUDED.payload,
                               revision   = EXCLUDED.revision,
                               updated_by = EXCLUDED.updated_by,
                               updated_at = now()"
                    );
                    $stmt->execute([
                        'profile'  => (string)$profile,
                        'payload'  => is_array($payload) ? json_encode($payload) : (string)$payload,
                        'revision' => isset($cat['revision']) ? (int)$cat['revision'] : 1,
                    ]);
                    $out['catalog']++;
                } catch (\Throwable $e) {
                    $out['errors'][] = 'Profil ' . $profile . ': ' . $e->getMessage();
                }
            }
        }

        // ── Bundles (gewählte Kürzel) ──
        if ($bundleKuerzel === null || !empty($bundleKuerzel)) {
            foreach ((isset($backup['bundles']) && is_array($backup['bundles']) ? $backup['bundles'] : []) as $bn) {
                $kuerzel = $bn['kuerzel'] ?? null;
                if ($kuerzel === null || $kuerzel === '') continue;
                if (is_array($bundleKuerzel) && !in_array((string)$kuerzel, $bundleKuerzel, true)) continue;
                try {
                    $payload = $bn['payload'] ?? ['files' => []];
                    $tags    = $bn['tags'] ?? [];
                    $stmt = $pdo->prepare(
                        "INSERT INTO " . self::q($schema) . ".config_bundle_store
                            (kuerzel, payload, scope, tags, last_imported_at, last_imported_by)
                         VALUES (:kuerzel, :payload::jsonb, :scope, :tags::jsonb, COALESCE(:imported_at, now()), 'restore')
                         ON CONFLICT (kuerzel) DO UPDATE
                           SET payload          = EXCLUDED.payload,
                               scope            = EXCLUDED.scope,
                               tags             = EXCLUDED.tags,
                               last_imported_at = EXCLUDED.last_imported_at,
                               last_imported_by = EXCLUDED.last_imported_by"
                    );
                    $stmt->execute([
                        'kuerzel'     => (string)$kuerzel,
                        'payload'     => is_array($payload) ? json_encode($payload) : (string)$payload,
                        'scope'       => $bn['scope'] ?? 'core',
                        'tags'        => is_array($tags) ? json_encode($tags) : (string)($tags ?: '[]'),
                        'imported_at' => $bn['importedAt'] ?? null,
                    ]);
                    $out['bundles']++;
                } catch (\Throwable $e) {
                    $out['errors'][] = 'Bundle ' . $kuerzel . ': ' . $e->getMessage();
                }
            }
        }

        $out['ok'] = empty($out['errors']);
        $out['targetEnv'] = $targetEnv;
        return $out;
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

    private static function extractBundleFiles($payload): array {
        if (!is_array($payload) || !isset($payload['files']) || !is_array($payload['files'])) {
            return [];
        }

        $files = [];
        foreach ($payload['files'] as $file) {
            if (is_string($file)) {
                $name = trim($file);
                if ($name === '') continue;
                $files[] = ['name' => $name, 'type' => null, 'keys' => null];
                continue;
            }
            if (!is_array($file)) continue;

            $name = trim((string)($file['name'] ?? $file['file'] ?? ''));
            if ($name === '') continue;

            $keys = $file['keys'] ?? null;
            $files[] = [
                'name' => $name,
                'type' => isset($file['type']) ? (string)$file['type'] : null,
                'keys' => is_numeric($keys) ? (int)$keys : null,
            ];
        }

        usort($files, function (array $left, array $right): int {
            return strcmp($left['name'], $right['name']);
        });

        return $files;
    }

    private static function q(string $schema): string {
        return '"' . str_replace('"', '', $schema) . '"';
    }

    /**
     * Stellt die Sync-/Konfig-Zeitstempel-Spalten in beiden Schemas sicher
     * (idempotent, Best-Effort) und backfillt fehlende Konfig-Zeitstempel.
     *
     * Hintergrund: Der DB-Trigger set_updated_at() überschreibt updated_at bei
     * jedem UPDATE mit now(). Deshalb braucht der Katalog einen eigenen, vom
     * Trigger unberührten Konfig-Zeitstempel (config_revision_at), der mit der
     * Revision gesetzt und beim Sync 1:1 mitkopiert wird.
     */
    private static function ensureSyncColumns($pdo): void {
        foreach (self::schemaMap() as $schema) {
            $sq = self::q($schema);
            $alters = [
                "ALTER TABLE {$sq}.bookmark_meta ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ",
                "ALTER TABLE {$sq}.bookmark_meta ADD COLUMN IF NOT EXISTS synced_by TEXT",
                "ALTER TABLE {$sq}.config_bundle_store ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ",
                "ALTER TABLE {$sq}.config_bundle_store ADD COLUMN IF NOT EXISTS synced_by TEXT",
                "ALTER TABLE {$sq}.catalog_document ADD COLUMN IF NOT EXISTS config_revision_at TIMESTAMPTZ",
                "ALTER TABLE {$sq}.catalog_document ADD COLUMN IF NOT EXISTS config_revision_by TEXT",
            ];
            foreach ($alters as $sql) {
                try { $pdo->exec($sql); } catch (\Throwable $e) { /* Best-Effort */ }
            }
            // Backfill: bestehende Zeilen ohne Konfig-Zeitstempel aus History/updated_at ableiten.
            try {
                $pdo->exec(
                    "UPDATE {$sq}.catalog_document cd
                     SET config_revision_at = COALESCE(
                             (SELECT h.changed_at FROM {$sq}.catalog_document_history h
                              WHERE h.profile = cd.profile AND h.revision = cd.revision AND h.action <> 'import'
                              ORDER BY h.id DESC LIMIT 1),
                             cd.updated_at),
                         config_revision_by = COALESCE(cd.config_revision_by, cd.updated_by)
                     WHERE cd.config_revision_at IS NULL"
                );
            } catch (\Throwable $e) { /* Best-Effort */ }
        }
    }

    // ===== INHALTLICHER DIFF (On-Demand) =====

    /**
     * Vergleicht den tatsächlichen Inhalt zwischen DEV und PROD für einen Eintrag.
     *
     * @param string $domain 'catalog' | 'bundles' | 'bookmarks'
     * @param string $key    Profil (catalog) bzw. Kürzel (bundles); bei bookmarks ignoriert
     */
    public static function contentDiff(string $domain, string $key): array {
        $pdo  = Database::getConnection();
        $dev  = self::schema('dev');
        $prod = self::schema('prod');
        switch ($domain) {
            case 'catalog':   return self::diffCatalog($pdo, $dev, $prod, $key);
            case 'bundles':   return self::diffBundle($pdo, $dev, $prod, $key);
            case 'bookmarks': return self::diffBookmarksContent($pdo, $dev, $prod);
            default: throw new InvalidArgumentException('Unbekannte Domain: ' . $domain);
        }
    }

    private static function diffCatalog($pdo, string $dev, string $prod, string $profile): array {
        $d = self::loadJsonPayload($pdo, $dev,  'catalog_document', 'profile', $profile);
        $p = self::loadJsonPayload($pdo, $prod, 'catalog_document', 'profile', $profile);
        $res = self::diffAssoc(is_array($d) ? $d : [], is_array($p) ? $p : [], 'Layer-Schlüssel', true);
        $res['type'] = 'keys';
        return $res;
    }

    private static function diffBundle($pdo, string $dev, string $prod, string $kuerzel): array {
        $dp = self::loadJsonPayload($pdo, $dev,  'config_bundle_store', 'kuerzel', $kuerzel);
        $pp = self::loadJsonPayload($pdo, $prod, 'config_bundle_store', 'kuerzel', $kuerzel);
        $dm = self::indexBundleFilesByName(is_array($dp) ? $dp : []);
        $pm = self::indexBundleFilesByName(is_array($pp) ? $pp : []);
        $devNames  = array_keys($dm);
        $prodNames = array_keys($pm);
        $onlyDev  = array_values(array_diff($devNames, $prodNames));
        $onlyProd = array_values(array_diff($prodNames, $devNames));
        $common   = array_intersect($devNames, $prodNames);
        sort($onlyDev); sort($onlyProd);

        $changedFiles = [];
        foreach ($common as $name) {
            $df = $dm[$name]; $pf = $pm[$name];
            $dd = (isset($df['data']) && is_array($df['data'])) ? $df['data'] : null;
            $pd = (isset($pf['data']) && is_array($pf['data'])) ? $pf['data'] : null;
            if ($dd !== null && $pd !== null) {
                $sub = self::diffAssoc($dd, $pd, 'Einträge', true);
                if (!$sub['identical']) $changedFiles[] = ['name' => $name, 'diff' => $sub];
            } else {
                $dk = isset($df['keys']) ? (int)$df['keys'] : null;
                $pk = isset($pf['keys']) ? (int)$pf['keys'] : null;
                if ($dk !== null && $pk !== null && $dk !== $pk) {
                    $changedFiles[] = ['name' => $name, 'diff' => [
                        'label' => 'Einträge', 'onlyDev' => [], 'onlyProd' => [], 'changed' => [],
                        'counts' => ['dev' => $dk, 'prod' => $pk, 'onlyDev' => 0, 'onlyProd' => 0, 'changed' => 0],
                        'identical' => false,
                    ]];
                } elseif (self::canon($dd) !== self::canon($pd)) {
                    $changedFiles[] = ['name' => $name, 'diff' => null];
                }
            }
        }

        return [
            'type'          => 'bundle',
            'onlyDevFiles'  => $onlyDev,
            'onlyProdFiles' => $onlyProd,
            'changedFiles'  => $changedFiles,
            'counts'        => [
                'devFiles'  => count($devNames),
                'prodFiles' => count($prodNames),
                'onlyDev'   => count($onlyDev),
                'onlyProd'  => count($onlyProd),
                'changed'   => count($changedFiles),
            ],
            'identical' => empty($onlyDev) && empty($onlyProd) && empty($changedFiles),
        ];
    }

    private static function diffBookmarksContent($pdo, string $dev, string $prod): array {
        $d = self::loadBookmarkMap($pdo, $dev);
        $p = self::loadBookmarkMap($pdo, $prod);
        $res = self::diffAssoc($d, $p, 'Bookmarks', true);
        $res['type'] = 'keys';
        return $res;
    }

    private static function loadBookmarkMap($pdo, string $schema): array {
        $map = [];
        try {
            $stmt = $pdo->query("SELECT bookmark_id, name, payload FROM " . self::q($schema) . ".bookmark WHERE deleted = false");
            foreach ($stmt->fetchAll() as $r) {
                $pl = is_string($r['payload']) ? json_decode($r['payload'], true) : $r['payload'];
                $label = ($r['name'] !== null && $r['name'] !== '') ? $r['name'] : $r['bookmark_id'];
                $map[(string)$label] = ['payload' => $pl];
            }
        } catch (\Throwable $e) { /* leeres Schema */ }
        return $map;
    }

    private static function loadJsonPayload($pdo, string $schema, string $table, string $keyCol, string $keyVal) {
        try {
            $stmt = $pdo->prepare("SELECT payload FROM " . self::q($schema) . "." . $table . " WHERE " . $keyCol . " = :k");
            $stmt->execute(['k' => $keyVal]);
            $row = $stmt->fetch();
            if (!$row) return null;
            return is_string($row['payload']) ? json_decode($row['payload'], true) : $row['payload'];
        } catch (\Throwable $e) {
            return null;
        }
    }

    private static function indexBundleFilesByName(array $payload): array {
        $files = (isset($payload['files']) && is_array($payload['files'])) ? $payload['files'] : [];
        $map = [];
        foreach ($files as $f) {
            if (!is_array($f)) continue;
            $n = trim((string)($f['name'] ?? $f['file'] ?? ''));
            if ($n === '') continue;
            $map[$n] = $f;
        }
        return $map;
    }

    /** Generischer Schlüssel-Diff zweier assoziativer Arrays. */
    private static function diffAssoc(array $devMap, array $prodMap, string $label, bool $withDetails = false): array {
        $devKeys  = array_keys($devMap);
        $prodKeys = array_keys($prodMap);
        $onlyDev  = array_values(array_diff($devKeys, $prodKeys));
        $onlyProd = array_values(array_diff($prodKeys, $devKeys));
        $common   = array_intersect($devKeys, $prodKeys);
        $changed  = [];
        $details  = [];
        foreach ($common as $k) {
            if (self::canon($devMap[$k]) !== self::canon($prodMap[$k])) {
                $changed[] = (string)$k;
                if ($withDetails) {
                    $dPretty = self::prettyCanon($devMap[$k]);
                    $pPretty = self::prettyCanon($prodMap[$k]);
                    if (strlen($dPretty) <= 200000 && strlen($pPretty) <= 200000) {
                        $details[(string)$k] = ['dev' => $dPretty, 'prod' => $pPretty];
                    }
                }
            }
        }
        sort($onlyDev); sort($onlyProd); sort($changed);
        $res = [
            'label'    => $label,
            'onlyDev'  => array_map('strval', $onlyDev),
            'onlyProd' => array_map('strval', $onlyProd),
            'changed'  => $changed,
            'counts'   => [
                'dev'      => count($devKeys),
                'prod'     => count($prodKeys),
                'onlyDev'  => count($onlyDev),
                'onlyProd' => count($onlyProd),
                'changed'  => count($changed),
            ],
            'identical' => empty($onlyDev) && empty($onlyProd) && empty($changed),
        ];
        if ($withDetails) $res['details'] = $details;
        return $res;
    }

    /** Kanonische JSON-Repräsentation (rekursiv ksort) für stabilen Vergleich. */
    private static function canon($v): string {
        return json_encode(self::sortRec($v), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    /** Wie canon(), aber lesbar formatiert für den Zeilen-Diff. */
    private static function prettyCanon($v): string {
        return json_encode(self::sortRec($v), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    private static function sortRec($v) {
        if (is_array($v)) {
            $isList = array_keys($v) === range(0, count($v) - 1);
            $out = [];
            foreach ($v as $k => $vv) $out[$k] = self::sortRec($vv);
            if (!$isList) ksort($out);
            return $out;
        }
        return $v;
    }
}
