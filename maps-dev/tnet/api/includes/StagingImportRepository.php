<?php
/**
 * StagingImportRepository.php
 * DB-Ablage für SLM-Staging-Bundles (ersetzt ImportToCore-Dateiordner).
 *
 * Speichert pro Kürzel ein JSONB-Bundle mit:
 *  - Dateien (payload.files),
 *  - Manifest/Quellbasis für Change-Detection,
 *  - Tags,
 *  - letztem Import-Zeitpunkt und Bearbeiter.
 *
 * @version    1.0
 * @date       2026-06-08
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

require_once __DIR__ . '/Database.php';

class StagingImportRepository {

    private const TABLE = 'mapplusconf.config_bundle_store';
    private const LEGACY_TABLE = 'mapplusconf.staging_import_bundle';

    // ===== SCHEMA =====

    public static function ensureSchema(): void {
        $pdo = Database::getConnection();

        // Einmal-Migration: alte Tabelle automatisch auf neuen Namen umbenennen.
        $pdo->exec(
            "DO $$
             BEGIN
               IF to_regclass('" . self::TABLE . "') IS NULL
                  AND to_regclass('" . self::LEGACY_TABLE . "') IS NOT NULL THEN
                 EXECUTE 'ALTER TABLE ' || quote_ident('mapplusconf') || '.' || quote_ident('staging_import_bundle')
                         || ' RENAME TO ' || quote_ident('config_bundle_store');
               END IF;
             END
             $$;"
        );

        $ddls = [
            "CREATE TABLE IF NOT EXISTS " . self::TABLE . " (
                kuerzel TEXT PRIMARY KEY,
                tags JSONB NOT NULL DEFAULT '[]'::jsonb,
                payload JSONB NOT NULL DEFAULT '{\"files\": []}'::jsonb,
                manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
                last_imported_at TIMESTAMPTZ,
                last_imported_by TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )",
            "CREATE INDEX IF NOT EXISTS idx_config_bundle_store_tags ON " . self::TABLE . " USING GIN (tags)",
            "CREATE INDEX IF NOT EXISTS idx_config_bundle_store_imported_at ON " . self::TABLE . " (last_imported_at DESC)",
            // Ueberladungskonzept (core -> override/sitecore -> profile) in der DB abbilden.
            "ALTER TABLE " . self::TABLE . " ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'core'",
            "ALTER TABLE " . self::TABLE . " ADD COLUMN IF NOT EXISTS profile TEXT",
            "CREATE INDEX IF NOT EXISTS idx_config_bundle_store_scope ON " . self::TABLE . " (scope)",
            "DROP TRIGGER IF EXISTS trg_config_bundle_store_updated ON " . self::TABLE,
            "CREATE TRIGGER trg_config_bundle_store_updated BEFORE UPDATE ON " . self::TABLE . " FOR EACH ROW EXECUTE FUNCTION mapplusconf.set_updated_at()",
        ];
        foreach ($ddls as $sql) {
            $pdo->exec($sql);
        }
    }

    // ===== LESEN =====

    public static function loadAll(): array {
        self::ensureSchema();
        $pdo = Database::getConnection();
        $stmt = $pdo->query(
            "SELECT kuerzel, tags, payload, manifest, scope, profile, last_imported_at, last_imported_by, created_at, updated_at
               FROM " . self::TABLE . "
             ORDER BY kuerzel"
        );
        $rows = $stmt->fetchAll();
        $result = [];
        foreach ($rows as $row) {
            $result[] = self::rowToBundle($row);
        }
        return $result;
    }

    public static function loadBundle(string $kuerzel): ?array {
        self::ensureSchema();
        $pdo = Database::getConnection();
        $stmt = $pdo->prepare(
            "SELECT kuerzel, tags, payload, manifest, scope, profile, last_imported_at, last_imported_by, created_at, updated_at
               FROM " . self::TABLE . "
             WHERE kuerzel = :kuerzel"
        );
        $stmt->execute(['kuerzel' => $kuerzel]);
        $row = $stmt->fetch();
        return $row ? self::rowToBundle($row) : null;
    }

    // ===== SCHREIBEN =====

    public static function saveBundle(string $kuerzel, array $files, array $manifest, array $tags, ?string $user, string $scope = 'core', ?string $profile = null): array {
        self::ensureSchema();
        $pdo = Database::getConnection();
        $payload = ['files' => array_values($files)];
        $tags = self::normalizeTags($kuerzel, $tags);
        $scope = in_array($scope, ['core', 'sitecore', 'override', 'profile'], true) ? $scope : 'core';
        $profile = ($profile !== null && $profile !== '') ? preg_replace('/[^a-zA-Z0-9_\-]/', '', $profile) : null;

        $stmt = $pdo->prepare(
            "INSERT INTO " . self::TABLE . "
                (kuerzel, tags, payload, manifest, scope, profile, last_imported_at, last_imported_by)
             VALUES (:kuerzel, :tags::jsonb, :payload::jsonb, :manifest::jsonb, :scope, :profile, now(), :user)
             ON CONFLICT (kuerzel) DO UPDATE
               SET tags = EXCLUDED.tags,
                   payload = EXCLUDED.payload,
                   manifest = EXCLUDED.manifest,
                   scope = EXCLUDED.scope,
                   profile = EXCLUDED.profile,
                   last_imported_at = now(),
                   last_imported_by = EXCLUDED.last_imported_by"
        );
        $stmt->execute([
            'kuerzel'  => $kuerzel,
            'tags'     => json_encode($tags, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'payload'  => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'manifest' => json_encode($manifest, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'scope'    => $scope,
            'profile'  => $profile,
            'user'     => $user,
        ]);

        return self::loadBundle($kuerzel) ?: [
            'kuerzel' => $kuerzel,
            'tags' => $tags,
            'files' => $files,
            'manifest' => $manifest,
            'scope' => $scope,
            'profile' => $profile,
            'lastImportedAt' => null,
            'lastImportedBy' => $user,
        ];
    }

    public static function saveFileData(string $kuerzel, string $fileName, array $data, ?string $user, array $changedKeys = []): array {
        self::ensureSchema();
        $pdo = Database::getConnection();
        $bundle = self::loadBundle($kuerzel);
        if (!$bundle) {
            return ['success' => false, 'error' => 'Bundle nicht gefunden: ' . $kuerzel];
        }

        $now = date('Y-m-d\TH:i:s');
        $updated = false;
        foreach ($bundle['files'] as &$file) {
            if (($file['name'] ?? '') !== $fileName) {
                continue;
            }
            $file['data'] = $data;
            $file['size'] = strlen(json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
            $file['modified'] = date('Y-m-d H:i:s');
            $file['keys'] = is_array($data) ? count($data) : 0;

            // Field-Edit-Tracking (nur in DB, nicht im Export)
            if (!empty($changedKeys) && $user !== null) {
                $edits = $file['_edits'] ?? [];
                foreach ($changedKeys as $key) {
                    $edits[(string)$key] = ['by' => $user, 'at' => $now];
                }
                $file['_edits'] = $edits;
            }

            $updated = true;
            break;
        }
        unset($file);

        if (!$updated) {
            return ['success' => false, 'error' => 'Datei nicht gefunden: ' . $fileName];
        }

        $stmt = $pdo->prepare(
            "UPDATE " . self::TABLE . "
             SET tags = :tags::jsonb,
                 payload = :payload::jsonb,
                 manifest = :manifest::jsonb
             WHERE kuerzel = :kuerzel"
        );
        $stmt->execute([
            'kuerzel' => $kuerzel,
            'tags' => json_encode(self::normalizeTags($kuerzel, $bundle['tags']), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'payload' => json_encode(['files' => array_values($bundle['files'])], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'manifest' => json_encode($bundle['manifest'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ]);

        return ['success' => true, 'bundle' => (self::loadBundle($kuerzel) ?: $bundle)];
    }

    public static function deleteBundles(array $kuerzelList): array {
        self::ensureSchema();
        $pdo = Database::getConnection();
        $deleted = [];
        $errors = [];

        foreach ($kuerzelList as $kuerzel) {
            $safe = preg_replace('/[^a-zA-Z0-9_\-]/', '_', (string)$kuerzel);
            if ($safe === '') {
                $errors[] = 'Ungültiger Name: ' . $kuerzel;
                continue;
            }
            $stmt = $pdo->prepare('DELETE FROM ' . self::TABLE . ' WHERE kuerzel = :kuerzel');
            $stmt->execute(['kuerzel' => $safe]);
            if ($stmt->rowCount() > 0) {
                $deleted[] = $safe;
            } else {
                $errors[] = 'Nicht gefunden: ' . $safe;
            }
        }

        return ['success' => true, 'deleted' => $deleted, 'errors' => $errors];
    }

    /**
     * Einen Tag zu einem bestehenden Bundle hinzufuegen.
     * Ermoeglicht, dass eine Ressource mehrere Tags traegt (Mehrfach-Nutzung).
     */
    public static function addTag(string $kuerzel, string $tag): array {
        self::ensureSchema();
        $safeTag = preg_replace('/[^a-zA-Z0-9_\-]/', '_', trim($tag));
        if ($safeTag === '') return ['success' => false, 'error' => 'Tag darf nicht leer sein'];
        $bundle = self::loadBundle($kuerzel);
        if (!$bundle) return ['success' => false, 'error' => 'Kuerzel nicht gefunden: ' . $kuerzel];
        $tags = is_array($bundle['tags']) ? $bundle['tags'] : [];
        if (!in_array($safeTag, $tags, true)) $tags[] = $safeTag;
        $tags = self::normalizeTags($kuerzel, $tags);
        $pdo = Database::getConnection();
        $stmt = $pdo->prepare('UPDATE ' . self::TABLE . ' SET tags = :tags::jsonb WHERE kuerzel = :kuerzel');
        $stmt->execute([
            'kuerzel' => $kuerzel,
            'tags'    => json_encode(array_values($tags), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ]);
        return ['success' => true, 'kuerzel' => $kuerzel, 'tags' => array_values($tags)];
    }

    /**
     * Einen Tag aus allen Bundles entfernen (Redundanz-Vermeidung).
     * - Bundle traegt weitere Tags  -> nur Tag entfernen (Ressource bleibt).
     * - Tag ist die Identitaet (= kuerzel) oder letzter Tag -> Bundle endgueltig loeschen.
     */
    public static function removeTagEverywhere(string $tag): array {
        self::ensureSchema();
        $safeTag = preg_replace('/[^a-zA-Z0-9_\-]/', '_', trim($tag));
        if ($safeTag === '') return ['success' => false, 'error' => 'Tag darf nicht leer sein'];
        $pdo = Database::getConnection();
        $bundles = self::loadAll();
        $updated = [];
        $deleted = [];
        foreach ($bundles as $bundle) {
            $tags = is_array($bundle['tags']) ? $bundle['tags'] : [];
            if (!in_array($safeTag, $tags, true)) continue;
            $remaining = array_values(array_filter($tags, function ($t) use ($safeTag) {
                return $t !== $safeTag;
            }));
            if (count($remaining) === 0 || $bundle['kuerzel'] === $safeTag) {
                $stmt = $pdo->prepare('DELETE FROM ' . self::TABLE . ' WHERE kuerzel = :kuerzel');
                $stmt->execute(['kuerzel' => $bundle['kuerzel']]);
                $deleted[] = $bundle['kuerzel'];
            } else {
                $stmt = $pdo->prepare('UPDATE ' . self::TABLE . ' SET tags = :tags::jsonb WHERE kuerzel = :kuerzel');
                $stmt->execute([
                    'kuerzel' => $bundle['kuerzel'],
                    'tags'    => json_encode($remaining, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                ]);
                $updated[] = $bundle['kuerzel'];
            }
        }
        return ['success' => true, 'tag' => $safeTag, 'updatedBundles' => $updated, 'deletedBundles' => $deleted];
    }

    // ===== HELFER =====

    private static function rowToBundle(array $row): array {
        $payload = self::decodeJson($row['payload']);
        $manifest = self::decodeJson($row['manifest']);
        $tags = self::decodeJson($row['tags']);

        return [
            'kuerzel' => (string)$row['kuerzel'],
            'tags' => is_array($tags) ? array_values($tags) : [(string)$row['kuerzel']],
            'files' => is_array($payload['files'] ?? null) ? $payload['files'] : [],
            'manifest' => is_array($manifest) ? $manifest : [],
            'scope' => $row['scope'] ?? 'core',
            'profile' => $row['profile'] ?? null,
            'lastImportedAt' => $row['last_imported_at'] ?? null,
            'lastImportedBy' => $row['last_imported_by'] ?? null,
            'createdAt' => $row['created_at'] ?? null,
            'updatedAt' => $row['updated_at'] ?? null,
        ];
    }

    private static function normalizeTags(string $kuerzel, array $tags): array {
        $out = [];
        $out[] = $kuerzel;
        foreach ($tags as $tag) {
            $safe = preg_replace('/[^a-zA-Z0-9_\-]/', '_', trim((string)$tag));
            if ($safe !== '' && !in_array($safe, $out, true)) {
                $out[] = $safe;
            }
        }
        return $out;
    }

    private static function decodeJson($value): array {
        if (is_array($value)) {
            return $value;
        }
        if (!is_string($value) || $value === '') {
            return [];
        }
        $decoded = json_decode($value, true);
        return is_array($decoded) ? $decoded : [];
    }
}