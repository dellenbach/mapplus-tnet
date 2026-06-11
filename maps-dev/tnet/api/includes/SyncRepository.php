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
        foreach ($schemas as $env => $schema) {
            try {
                $stmt = $pdo->query("SELECT COUNT(*) AS cnt FROM " . self::q($schema) . ".bookmark WHERE deleted = false");
                $bmCounts[$env] = (int)$stmt->fetch()['cnt'];
                $stmt2 = $pdo->query("SELECT revision FROM " . self::q($schema) . ".bookmark_meta WHERE scope = 'bookmarks'");
                $row = $stmt2->fetch();
                $bmRevs[$env] = $row ? (int)$row['revision'] : 0;
            } catch (\Throwable $e) {
                $bmCounts[$env] = null;
                $bmRevs[$env]   = null;
            }
        }
        $result['domains']['bookmarks'] = [
            'label'   => 'Bookmarks',
            'counts'  => $bmCounts,
            'revs'    => $bmRevs,
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
                    "SELECT kuerzel, scope, last_imported_at
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
            $stmt = $pdo->query(
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
                "SELECT kuerzel, payload, scope, tags, notes
                 FROM " . self::q($src) . ".config_bundle_store
                 WHERE kuerzel IN (" . $placeholders . ")"
            );
            $stmt->execute($kuerzel);
        } else {
            $stmt = $pdo->query(
                "SELECT kuerzel, payload, scope, tags, notes
                 FROM " . self::q($src) . ".config_bundle_store"
            );
        }
        $rows = $stmt->fetchAll();

        foreach ($rows as $row) {
            try {
                $payload = is_array($row['payload']) ? json_encode($row['payload']) : $row['payload'];
                $tags    = is_array($row['tags'])    ? json_encode($row['tags'])    : ($row['tags'] ?? '[]');
                $upsert  = $pdo->prepare(
                    "INSERT INTO " . self::q($dst) . ".config_bundle_store
                        (kuerzel, payload, scope, tags, notes, last_imported_at, last_imported_by)
                     VALUES (:kuerzel, :payload::jsonb, :scope, :tags::jsonb, :notes, now(), :user)
                     ON CONFLICT (kuerzel) DO UPDATE
                       SET payload          = EXCLUDED.payload,
                           scope            = EXCLUDED.scope,
                           tags             = EXCLUDED.tags,
                           notes            = EXCLUDED.notes,
                           last_imported_at = now(),
                           last_imported_by = EXCLUDED.last_imported_by"
                );
                $upsert->execute([
                    'kuerzel' => $row['kuerzel'],
                    'payload' => $payload,
                    'scope'   => $row['scope'] ?? 'core',
                    'tags'    => $tags,
                    'notes'   => $row['notes'] ?? null,
                    'user'    => $user,
                ]);
                $copied++;
            } catch (\Throwable $e) {
                $errors[] = $row['kuerzel'] . ': ' . $e->getMessage();
            }
        }

        return ['copied' => $copied, 'errors' => $errors];
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
