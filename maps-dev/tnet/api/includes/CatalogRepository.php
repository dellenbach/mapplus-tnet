<?php
/**
 * CatalogRepository.php
 * Datenbankzugriff für den Themenkatalog (lyrmgr.conf) der Staging-DB.
 *
 * Kapselt das Lesen/Schreiben der kompletten lyrmgr.conf pro Profil mit:
 *  - profilweitem Optimistic Locking (catalog_document.revision),
 *  - Änderungshistorie (catalog_document_history) für Diff/Restore,
 *  - blockweisem Publish (Merge eines lyrmgrKey ins Dokument),
 *  - Soft-Lock (catalog_lock) als UI-Hinweis fürs Mehrbenutzer-Editing.
 *
 * Payload-Format: lyrmgr.conf-Objekt (Blöcke je lyrmgrKey → structure → ...).
 *
 * @version    1.0
 * @date       2026-06-06
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

require_once __DIR__ . '/Database.php';

class CatalogRepository {

    /** @var int Soft-Lock-Dauer in Sekunden (15 Minuten) */
    const LOCK_TTL_SECONDS = 900;

    // ===== LESEN =====

    /**
     * Liest die komplette lyrmgr.conf eines Profils.
     *
     * @param string $profile Profilname (z.B. 'public')
     * @return array{exists: bool, data: array, revision: int}
     */
    public static function loadProfile(string $profile): array {
        $pdo = Database::getConnection();
        $stmt = $pdo->prepare(
            "SELECT payload, revision FROM mapplusconf.catalog_document
             WHERE profile = :profile"
        );
        $stmt->execute(['profile' => $profile]);
        $row = $stmt->fetch();

        if (!$row) {
            return ['exists' => false, 'data' => [], 'revision' => 0];
        }

        $data = self::decodePayload($row['payload']);
        return [
            'exists'   => true,
            'data'     => $data ?? [],
            'revision' => (int)$row['revision'],
        ];
    }

    /**
     * Liefert die aktuelle Revision eines Profils (Optimistic-Lock-Token).
     *
     * @param string $profile
     * @return int 0 wenn (noch) nicht vorhanden
     */
    public static function getRevision(string $profile): int {
        $pdo = Database::getConnection();
        $stmt = $pdo->prepare(
            "SELECT revision FROM mapplusconf.catalog_document WHERE profile = :profile"
        );
        $stmt->execute(['profile' => $profile]);
        $row = $stmt->fetch();
        return $row ? (int)$row['revision'] : 0;
    }

    /**
     * Liefert alle in der DB vorhandenen Profile mit Metadaten.
     *
     * @return array<int, array{profile: string, revision: int, updatedAt: string, lyrmgrKeys: int}>
     */
    public static function listProfiles(): array {
        $pdo = Database::getConnection();
        $stmt = $pdo->query(
            "SELECT profile, revision, updated_at,
                    (SELECT count(*) FROM jsonb_object_keys(payload)) AS key_count
             FROM mapplusconf.catalog_document
             ORDER BY profile"
        );
        $out = [];
        foreach ($stmt->fetchAll() as $row) {
            $out[] = [
                'profile'    => (string)$row['profile'],
                'revision'   => (int)$row['revision'],
                'updatedAt'  => (string)$row['updated_at'],
                'lyrmgrKeys' => (int)$row['key_count'],
            ];
        }
        return $out;
    }

    // ===== SCHREIBEN (Optimistic Locking) =====

    /**
     * Speichert die komplette lyrmgr.conf eines Profils atomar (Upsert).
     *
     * Optimistic Locking: stimmt $expectedRevision nicht mit der DB überein,
     * wird ein Konflikt zurückgegeben (ohne Schreibvorgang).
     *
     * @param string      $profile          Profilname
     * @param array       $data             Komplette lyrmgr.conf (Blöcke je lyrmgrKey)
     * @param int|null    $expectedRevision Vom Client zuletzt geladene Revision (null = Konfliktprüfung aus)
     * @param string|null $user             Bearbeiter (für updated_by/History)
     * @param string      $action           History-Aktion (update|import|publish)
     * @param string|null $lyrmgrKey        Betroffener Block bei blockweisem Publish
     * @return array{success: bool, conflict?: bool, revision: int, serverData?: array}
     */
    public static function saveProfile(
        string $profile,
        array $data,
        ?int $expectedRevision,
        ?string $user,
        string $action = 'update',
        ?string $lyrmgrKey = null
    ): array {
        $pdo = Database::getConnection();
        $pdo->beginTransaction();
        try {
            // Aktuellen Stand sperren (FOR UPDATE serialisiert konkurrierende Saves)
            $stmt = $pdo->prepare(
                "SELECT revision FROM mapplusconf.catalog_document
                 WHERE profile = :profile FOR UPDATE"
            );
            $stmt->execute(['profile' => $profile]);
            $row = $stmt->fetch();
            $exists = (bool)$row;
            $currentRevision = $exists ? (int)$row['revision'] : 0;

            // Optimistic-Lock-Prüfung
            if ($expectedRevision !== null && $expectedRevision !== $currentRevision) {
                $pdo->rollBack();
                $server = self::loadProfile($profile);
                return [
                    'success'    => false,
                    'conflict'   => true,
                    'revision'   => $currentRevision,
                    'serverData' => $server['data'],
                ];
            }

            $newRevision = $currentRevision + 1;
            $payloadJson = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

            if ($exists) {
                $upd = $pdo->prepare(
                    "UPDATE mapplusconf.catalog_document
                     SET payload = :payload::jsonb, revision = :revision, updated_by = :user
                     WHERE profile = :profile"
                );
                $upd->execute([
                    'payload'  => $payloadJson,
                    'revision' => $newRevision,
                    'user'     => $user,
                    'profile'  => $profile,
                ]);
            } else {
                $ins = $pdo->prepare(
                    "INSERT INTO mapplusconf.catalog_document
                        (profile, payload, revision, updated_by)
                     VALUES (:profile, :payload::jsonb, :revision, :user)"
                );
                $ins->execute([
                    'profile'  => $profile,
                    'payload'  => $payloadJson,
                    'revision' => $newRevision,
                    'user'     => $user,
                ]);
            }

            self::writeHistory($pdo, $profile, $newRevision, $action, $lyrmgrKey, $payloadJson, $user);

            $pdo->commit();

            return [
                'success'  => true,
                'conflict' => false,
                'revision' => $newRevision,
            ];
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
    }

    /**
     * Publiziert einen einzelnen lyrmgr-Block in das Profil-Dokument (Merge).
     *
     * Lädt das aktuelle Dokument, ersetzt den Block $lyrmgrKey durch $blockData
     * und speichert über saveProfile() (inkl. Optimistic Locking + History).
     *
     * @param string      $profile          Profilname
     * @param string      $lyrmgrKey        Block-Schlüssel in der lyrmgr.conf
     * @param array       $blockData        Neuer Inhalt des Blocks
     * @param int|null    $expectedRevision Optimistic-Lock-Token
     * @param string|null $user             Bearbeiter
     * @return array{success: bool, conflict?: bool, revision: int, serverData?: array}
     */
    public static function publishBlock(
        string $profile,
        string $lyrmgrKey,
        array $blockData,
        ?int $expectedRevision,
        ?string $user
    ): array {
        $current = self::loadProfile($profile);
        $doc = $current['data'];
        $doc[$lyrmgrKey] = $blockData;

        // Bei vorhandenem Dokument Revision prüfen, sonst frisch anlegen.
        $expected = $current['exists'] ? $expectedRevision : null;

        return self::saveProfile($profile, $doc, $expected, $user, 'publish', $lyrmgrKey);
    }

    // ===== SOFT-LOCK =====

    /**
     * Setzt oder erneuert den Soft-Lock für ein Profil.
     * Bestehender, gültiger Lock eines anderen Nutzers wird nicht überschrieben.
     *
     * @param string $profile Profilname
     * @param string $user    Bearbeiter
     * @return array{locked: bool, by: string, lockedAt: string, expiresAt: string, mine: bool}
     */
    public static function acquireLock(string $profile, string $user): array {
        $pdo = Database::getConnection();
        $pdo->beginTransaction();
        try {
            $current = self::fetchLock($pdo, $profile, true);
            $now = new DateTimeImmutable('now');
            $expires = $now->add(new DateInterval('PT' . self::LOCK_TTL_SECONDS . 'S'));

            $foreignActive = $current
                && $current['locked_by'] !== $user
                && new DateTimeImmutable($current['expires_at']) > $now;

            if ($foreignActive) {
                $pdo->commit();
                return [
                    'locked'    => false,
                    'by'        => $current['locked_by'],
                    'lockedAt'  => $current['locked_at'],
                    'expiresAt' => $current['expires_at'],
                    'mine'      => false,
                ];
            }

            $stmt = $pdo->prepare(
                "INSERT INTO mapplusconf.catalog_lock (profile, locked_by, locked_at, expires_at)
                 VALUES (:profile, :user, now(), :expires)
                 ON CONFLICT (profile) DO UPDATE
                   SET locked_by = EXCLUDED.locked_by,
                       locked_at = now(),
                       expires_at = EXCLUDED.expires_at"
            );
            $stmt->execute([
                'profile' => $profile,
                'user'    => $user,
                'expires' => $expires->format(DateTimeInterface::ATOM),
            ]);
            $pdo->commit();

            return [
                'locked'    => true,
                'by'        => $user,
                'lockedAt'  => $now->format(DateTimeInterface::ATOM),
                'expiresAt' => $expires->format(DateTimeInterface::ATOM),
                'mine'      => true,
            ];
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
    }

    /**
     * Gibt den Soft-Lock eines Profils frei (nur wenn er dem Nutzer gehört).
     *
     * @param string $profile Profilname
     * @param string $user    Bearbeiter
     * @return array{released: bool}
     */
    public static function releaseLock(string $profile, string $user): array {
        $pdo = Database::getConnection();
        $stmt = $pdo->prepare(
            "DELETE FROM mapplusconf.catalog_lock
             WHERE profile = :profile AND locked_by = :user"
        );
        $stmt->execute(['profile' => $profile, 'user' => $user]);
        return ['released' => $stmt->rowCount() > 0];
    }

    /**
     * Liefert den aktuellen Lock-Status eines Profils (oder null, wenn frei/abgelaufen).
     *
     * @param string $profile Profilname
     * @return array|null ['by' => string, 'lockedAt' => string, 'expiresAt' => string]
     */
    public static function lockStatus(string $profile): ?array {
        $pdo = Database::getConnection();
        $row = self::fetchLock($pdo, $profile, false);
        if (!$row) {
            return null;
        }
        if (new DateTimeImmutable($row['expires_at']) <= new DateTimeImmutable('now')) {
            return null; // abgelaufen = frei
        }
        return [
            'by'        => $row['locked_by'],
            'lockedAt'  => $row['locked_at'],
            'expiresAt' => $row['expires_at'],
        ];
    }

    // ===== HELFER =====

    /**
     * Liest den Lock-Datensatz eines Profils, optional mit Zeilensperre (FOR UPDATE).
     *
     * @param TnetSchemaConnection $pdo
     * @param string $profile
     * @param bool   $forUpdate
     * @return array|null
     */
    private static function fetchLock($pdo, string $profile, bool $forUpdate): ?array {
        $sql = "SELECT profile, locked_by, locked_at, expires_at
                FROM mapplusconf.catalog_lock WHERE profile = :profile";
        if ($forUpdate) {
            $sql .= ' FOR UPDATE';
        }
        $stmt = $pdo->prepare($sql);
        $stmt->execute(['profile' => $profile]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    /**
     * Schreibt einen Historieneintrag.
     *
     * @param TnetSchemaConnection $pdo
     * @param string      $profile
     * @param int         $revision
     * @param string      $action
     * @param string|null $lyrmgrKey
     * @param string|null $payloadJson
     * @param string|null $user
     */
    private static function writeHistory($pdo, string $profile, int $revision, string $action, ?string $lyrmgrKey, ?string $payloadJson, ?string $user): void {
        $stmt = $pdo->prepare(
            "INSERT INTO mapplusconf.catalog_document_history
                (profile, revision, action, lyrmgr_key, payload, changed_by)
             VALUES (:profile, :revision, :action, :key, :payload::jsonb, :user)"
        );
        $stmt->execute([
            'profile'  => $profile,
            'revision' => $revision,
            'action'   => $action,
            'key'      => $lyrmgrKey,
            'payload'  => $payloadJson,
            'user'     => $user,
        ]);
    }

    /**
     * Dekodiert eine JSONB-Payload-Spalte zu einem Array.
     *
     * @param mixed $payload
     * @return array|null
     */
    private static function decodePayload($payload): ?array {
        if (is_array($payload)) {
            return $payload;
        }
        if (!is_string($payload) || $payload === '') {
            return null;
        }
        $decoded = json_decode($payload, true);
        return is_array($decoded) ? $decoded : null;
    }
}
