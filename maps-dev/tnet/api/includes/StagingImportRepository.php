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

    // ===== SCHEMA =====

    public static function ensureSchema(): void {
        $pdo = Database::getConnection();
        $ddls = [
            "CREATE TABLE IF NOT EXISTS mapplusconf.staging_import_bundle (
                kuerzel TEXT PRIMARY KEY,
                tags JSONB NOT NULL DEFAULT '[]'::jsonb,
                payload JSONB NOT NULL DEFAULT '{\"files\": []}'::jsonb,
                manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
                last_imported_at TIMESTAMPTZ,
                last_imported_by TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )",
            "CREATE INDEX IF NOT EXISTS idx_staging_bundle_tags ON mapplusconf.staging_import_bundle USING GIN (tags)",
            "CREATE INDEX IF NOT EXISTS idx_staging_bundle_imported_at ON mapplusconf.staging_import_bundle (last_imported_at DESC)",
            "DROP TRIGGER IF EXISTS trg_staging_import_bundle_updated ON mapplusconf.staging_import_bundle",
            "CREATE TRIGGER trg_staging_import_bundle_updated BEFORE UPDATE ON mapplusconf.staging_import_bundle FOR EACH ROW EXECUTE FUNCTION mapplusconf.set_updated_at()",
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
            "SELECT kuerzel, tags, payload, manifest, last_imported_at, last_imported_by, created_at, updated_at
             FROM mapplusconf.staging_import_bundle
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
            "SELECT kuerzel, tags, payload, manifest, last_imported_at, last_imported_by, created_at, updated_at
             FROM mapplusconf.staging_import_bundle
             WHERE kuerzel = :kuerzel"
        );
        $stmt->execute(['kuerzel' => $kuerzel]);
        $row = $stmt->fetch();
        return $row ? self::rowToBundle($row) : null;
    }

    // ===== SCHREIBEN =====

    public static function saveBundle(string $kuerzel, array $files, array $manifest, array $tags, ?string $user): array {
        self::ensureSchema();
        $pdo = Database::getConnection();
        $payload = ['files' => array_values($files)];
        $tags = self::normalizeTags($kuerzel, $tags);

        $stmt = $pdo->prepare(
            "INSERT INTO mapplusconf.staging_import_bundle
                (kuerzel, tags, payload, manifest, last_imported_at, last_imported_by)
             VALUES (:kuerzel, :tags::jsonb, :payload::jsonb, :manifest::jsonb, now(), :user)
             ON CONFLICT (kuerzel) DO UPDATE
               SET tags = EXCLUDED.tags,
                   payload = EXCLUDED.payload,
                   manifest = EXCLUDED.manifest,
                   last_imported_at = now(),
                   last_imported_by = EXCLUDED.last_imported_by"
        );
        $stmt->execute([
            'kuerzel'  => $kuerzel,
            'tags'     => json_encode($tags, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'payload'  => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'manifest' => json_encode($manifest, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'user'     => $user,
        ]);

        return self::loadBundle($kuerzel) ?: [
            'kuerzel' => $kuerzel,
            'tags' => $tags,
            'files' => $files,
            'manifest' => $manifest,
            'lastImportedAt' => null,
            'lastImportedBy' => $user,
        ];
    }

    public static function saveFileData(string $kuerzel, string $fileName, array $data, ?string $user): array {
        self::ensureSchema();
        $pdo = Database::getConnection();
        $bundle = self::loadBundle($kuerzel);
        if (!$bundle) {
            return ['success' => false, 'error' => 'Bundle nicht gefunden: ' . $kuerzel];
        }

        $updated = false;
        foreach ($bundle['files'] as &$file) {
            if (($file['name'] ?? '') !== $fileName) {
                continue;
            }
            $file['data'] = $data;
            $file['size'] = strlen(json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
            $file['modified'] = date('Y-m-d H:i:s');
            $file['keys'] = is_array($data) ? count($data) : 0;
            $updated = true;
            break;
        }
        unset($file);

        if (!$updated) {
            return ['success' => false, 'error' => 'Datei nicht gefunden: ' . $fileName];
        }

        $stmt = $pdo->prepare(
            "UPDATE mapplusconf.staging_import_bundle
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
            $stmt = $pdo->prepare('DELETE FROM mapplusconf.staging_import_bundle WHERE kuerzel = :kuerzel');
            $stmt->execute(['kuerzel' => $safe]);
            if ($stmt->rowCount() > 0) {
                $deleted[] = $safe;
            } else {
                $errors[] = 'Nicht gefunden: ' . $safe;
            }
        }

        return ['success' => true, 'deleted' => $deleted, 'errors' => $errors];
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