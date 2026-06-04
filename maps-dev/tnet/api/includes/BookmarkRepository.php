<?php
/**
 * BookmarkRepository.php
 * Datenbankzugriff für Bookmarks (Pilot-Domain der Staging-DB).
 *
 * Kapselt das Lesen/Schreiben der ganzen Bookmark-Sammlung mit:
 *  - sammlungsweitem Optimistic Locking (bookmark_meta.revision),
 *  - Änderungshistorie (bookmark_history) für Diff/Restore,
 *  - Soft-Lock (bookmark_lock) als UI-Hinweis fürs Mehrbenutzer-Editing.
 *
 * Payload-Format: bookmark.schema.json (v2), normalisiert via BookmarkNormalizer.
 *
 * @version    1.0
 * @date       2026-06-04
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/BookmarkNormalizer.php';

class BookmarkRepository {

    /** @var string Globaler Scope für Revision und Soft-Lock */
    const SCOPE = 'bookmarks';

    /** @var int Soft-Lock-Dauer in Sekunden (15 Minuten) */
    const LOCK_TTL_SECONDS = 900;

    // ===== LESEN =====

    /**
     * Liest die gesamte aktive Bookmark-Sammlung (nicht gelöschte) in Reihenfolge.
     *
     * @return array{data: array, revision: int}
     */
    public static function loadAll(): array {
        $pdo = Database::getConnection();
        $stmt = $pdo->query(
            "SELECT payload FROM mapplusconf.bookmark
             WHERE deleted = false
             ORDER BY sort_idx ASC, bookmark_id ASC"
        );
        $rows = $stmt->fetchAll();

        $data = [];
        foreach ($rows as $row) {
            $payload = self::decodePayload($row['payload']);
            if ($payload !== null) {
                $data[] = $payload;
            }
        }

        return [
            'data'     => BookmarkNormalizer::normalizeAll($data),
            'revision' => self::getRevision(),
        ];
    }

    /**
     * Liefert die aktuelle Sammlungs-Revision (Optimistic-Lock-Token).
     *
     * @return int
     */
    public static function getRevision(): int {
        $pdo = Database::getConnection();
        $stmt = $pdo->prepare(
            "SELECT revision FROM mapplusconf.bookmark_meta WHERE scope = :scope"
        );
        $stmt->execute(['scope' => self::SCOPE]);
        $row = $stmt->fetch();
        return $row ? (int)$row['revision'] : 1;
    }

    // ===== SCHREIBEN (Optimistic Locking) =====

    /**
     * Speichert die gesamte Bookmark-Sammlung atomar.
     *
     * Optimistic Locking: stimmt $expectedRevision nicht mit der DB überein,
     * wird ein Konflikt zurückgegeben (ohne Schreibvorgang).
     *
     * @param array       $bookmarks       Liste der Bookmark-Objekte (v2 oder gemischt)
     * @param int|null    $expectedRevision Vom Client zuletzt geladene Revision
     * @param string|null $user            Bearbeiter (für updated_by/History)
     * @return array{success: bool, conflict?: bool, revision: int, count: int, serverData?: array}
     */
    public static function saveAll(array $bookmarks, ?int $expectedRevision, ?string $user): array {
        $bookmarks = BookmarkNormalizer::normalizeAll($bookmarks);
        $pdo = Database::getConnection();

        $pdo->beginTransaction();
        try {
            // Aktuelle Revision sperren (FOR UPDATE serialisiert konkurrierende Saves)
            $stmt = $pdo->prepare(
                "SELECT revision FROM mapplusconf.bookmark_meta
                 WHERE scope = :scope FOR UPDATE"
            );
            $stmt->execute(['scope' => self::SCOPE]);
            $metaRow = $stmt->fetch();
            $currentRevision = $metaRow ? (int)$metaRow['revision'] : 1;

            // Optimistic-Lock-Prüfung
            if ($expectedRevision !== null && $expectedRevision !== $currentRevision) {
                $pdo->rollBack();
                $server = self::loadAll();
                return [
                    'success'    => false,
                    'conflict'   => true,
                    'revision'   => $currentRevision,
                    'count'      => count($server['data']),
                    'serverData' => $server['data'],
                ];
            }

            // Bestehende (nicht gelöschte) IDs ermitteln
            $existing = self::fetchExistingMap($pdo);
            $incomingIds = [];

            $sortIdx = 0;
            foreach ($bookmarks as $bm) {
                $id = isset($bm['id']) ? (string)$bm['id'] : '';
                if ($id === '') {
                    continue; // ohne ID nicht persistierbar
                }
                $incomingIds[$id] = true;
                $name = isset($bm['name']) ? (string)$bm['name'] : null;
                $payloadJson = json_encode($bm, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

                if (isset($existing[$id])) {
                    $newVersion = (int)$existing[$id]['version'] + 1;
                    $upd = $pdo->prepare(
                        "UPDATE mapplusconf.bookmark
                         SET payload = :payload::jsonb, name = :name, sort_idx = :sort_idx,
                             version = :version, deleted = false, updated_by = :user
                         WHERE bookmark_id = :id"
                    );
                    $upd->execute([
                        'payload'  => $payloadJson,
                        'name'     => $name,
                        'sort_idx' => $sortIdx,
                        'version'  => $newVersion,
                        'user'     => $user,
                        'id'       => $id,
                    ]);
                    $action = $existing[$id]['deleted'] ? 'restore' : 'update';
                    self::writeHistory($pdo, $id, $newVersion, $action, $payloadJson, $user);
                } else {
                    $ins = $pdo->prepare(
                        "INSERT INTO mapplusconf.bookmark
                            (bookmark_id, name, payload, sort_idx, version, deleted, updated_by)
                         VALUES (:id, :name, :payload::jsonb, :sort_idx, 1, false, :user)"
                    );
                    $ins->execute([
                        'id'       => $id,
                        'name'     => $name,
                        'payload'  => $payloadJson,
                        'sort_idx' => $sortIdx,
                        'user'     => $user,
                    ]);
                    self::writeHistory($pdo, $id, 1, 'create', $payloadJson, $user);
                }
                $sortIdx++;
            }

            // Nicht mehr enthaltene Bookmarks soft-löschen
            foreach ($existing as $id => $meta) {
                if ($meta['deleted']) {
                    continue;
                }
                if (!isset($incomingIds[$id])) {
                    $newVersion = (int)$meta['version'] + 1;
                    $del = $pdo->prepare(
                        "UPDATE mapplusconf.bookmark
                         SET deleted = true, version = :version, updated_by = :user
                         WHERE bookmark_id = :id"
                    );
                    $del->execute(['version' => $newVersion, 'user' => $user, 'id' => $id]);
                    self::writeHistory($pdo, $id, $newVersion, 'delete', null, $user);
                }
            }

            // Revision erhöhen
            $newRevision = $currentRevision + 1;
            $metaUpd = $pdo->prepare(
                "UPDATE mapplusconf.bookmark_meta
                 SET revision = :revision, updated_by = :user, updated_at = now()
                 WHERE scope = :scope"
            );
            $metaUpd->execute([
                'revision' => $newRevision,
                'user'     => $user,
                'scope'    => self::SCOPE,
            ]);

            $pdo->commit();

            return [
                'success'  => true,
                'conflict' => false,
                'revision' => $newRevision,
                'count'    => count($incomingIds),
            ];
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
    }

    // ===== SOFT-LOCK =====

    /**
     * Setzt oder erneuert den Soft-Lock für den Bookmarks-Scope.
     * Bestehender, gültiger Lock eines anderen Nutzers wird nicht überschrieben.
     *
     * @param string $user Bearbeiter
     * @return array{locked: bool, by: string, lockedAt: string, expiresAt: string, mine: bool}
     */
    public static function acquireLock(string $user): array {
        $pdo = Database::getConnection();
        $pdo->beginTransaction();
        try {
            $current = self::fetchLock($pdo, true);
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
                "INSERT INTO mapplusconf.bookmark_lock (scope, locked_by, locked_at, expires_at)
                 VALUES (:scope, :user, now(), :expires)
                 ON CONFLICT (scope) DO UPDATE
                   SET locked_by = EXCLUDED.locked_by,
                       locked_at = now(),
                       expires_at = EXCLUDED.expires_at"
            );
            $stmt->execute([
                'scope'   => self::SCOPE,
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
     * Gibt den Soft-Lock frei (nur wenn er dem Nutzer gehört).
     *
     * @param string $user Bearbeiter
     * @return array{released: bool}
     */
    public static function releaseLock(string $user): array {
        $pdo = Database::getConnection();
        $stmt = $pdo->prepare(
            "DELETE FROM mapplusconf.bookmark_lock
             WHERE scope = :scope AND locked_by = :user"
        );
        $stmt->execute(['scope' => self::SCOPE, 'user' => $user]);
        return ['released' => $stmt->rowCount() > 0];
    }

    /**
     * Liefert den aktuellen Lock-Status (oder null, wenn frei/abgelaufen).
     *
     * @return array|null ['by' => string, 'lockedAt' => string, 'expiresAt' => string]
     */
    public static function lockStatus(): ?array {
        $pdo = Database::getConnection();
        $row = self::fetchLock($pdo, false);
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
     * Lädt alle vorhandenen Bookmark-Metadaten (auch gelöschte) als Map id => meta.
     *
     * @param TnetSchemaConnection $pdo
     * @return array<string, array{version: int, deleted: bool}>
     */
    private static function fetchExistingMap($pdo): array {
        $stmt = $pdo->query(
            "SELECT bookmark_id, version, deleted FROM mapplusconf.bookmark"
        );
        $map = [];
        foreach ($stmt->fetchAll() as $row) {
            $map[(string)$row['bookmark_id']] = [
                'version' => (int)$row['version'],
                'deleted' => self::toBool($row['deleted']),
            ];
        }
        return $map;
    }

    /**
     * Liest den Lock-Datensatz, optional mit Zeilensperre (FOR UPDATE).
     *
     * @param TnetSchemaConnection $pdo
     * @param bool $forUpdate
     * @return array|null
     */
    private static function fetchLock($pdo, bool $forUpdate): ?array {
        $sql = "SELECT scope, locked_by, locked_at, expires_at
                FROM mapplusconf.bookmark_lock WHERE scope = :scope";
        if ($forUpdate) {
            $sql .= ' FOR UPDATE';
        }
        $stmt = $pdo->prepare($sql);
        $stmt->execute(['scope' => self::SCOPE]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    /**
     * Schreibt einen Historieneintrag.
     *
     * @param TnetSchemaConnection $pdo
     * @param string      $bookmarkId
     * @param int         $version
     * @param string      $action
     * @param string|null $payloadJson
     * @param string|null $user
     */
    private static function writeHistory($pdo, string $bookmarkId, int $version, string $action, ?string $payloadJson, ?string $user): void {
        $stmt = $pdo->prepare(
            "INSERT INTO mapplusconf.bookmark_history
                (bookmark_id, version, action, payload, changed_by)
             VALUES (:id, :version, :action, :payload::jsonb, :user)"
        );
        $stmt->execute([
            'id'      => $bookmarkId,
            'version' => $version,
            'action'  => $action,
            'payload' => $payloadJson,
            'user'    => $user,
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

    /**
     * Normalisiert einen Boolean-Wert aus der DB.
     *
     * @param mixed $value
     * @return bool
     */
    private static function toBool($value): bool {
        if (is_bool($value)) {
            return $value;
        }
        return in_array($value, [true, 1, '1', 't', 'true'], true);
    }
}
