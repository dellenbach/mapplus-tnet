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

    /** @var string Aktuelle Site (Multi-Site-Kontext, request-scoped). Default 'maps'. */
    private static $site = 'maps';

    /** @var string Aktuelle Katalog-Variante (tnet | tydac), request-scoped. Default 'tnet'. */
    private static $variant = 'tnet';

    /**
     * Setzt den Site-Kontext fuer alle Katalog-Operationen (einmalig pro Request am API-Bootstrap).
     * DEV/PROD sind bereits ueber getrennte DB-Schemas getrennt; site unterscheidet nur die Site.
     */
    public static function setSite(?string $site): void {
        $s = trim((string)$site);
        self::$site = $s !== '' ? $s : 'maps';
    }

    /** Liefert die aktuell gesetzte Site. */
    public static function getSite(): string {
        return self::$site;
    }

    /**
     * Setzt die Katalog-Variante fuer alle Operationen: 'tnet' (eigener Renderer) oder
     * 'tydac' (originales MAP+/TYDAC ClassicLayerMgr-Format). Default 'tnet'.
     */
    public static function setVariant(?string $variant): void {
        $v = strtolower(trim((string)$variant));
        self::$variant = ($v === 'tydac') ? 'tydac' : 'tnet';
    }

    /** Liefert die aktuell gesetzte Katalog-Variante. */
    public static function getVariant(): string {
        return self::$variant;
    }

    // ===== LESEN =====

    /**
     * Liest die komplette lyrmgr.conf eines Profils (der aktuellen Site).
     *
     * @param string $profile Profilname (z.B. 'public')
     * @return array{exists: bool, data: array, revision: int, updatedBy: ?string, updatedAt: ?string}
     */
    public static function loadProfile(string $profile): array {
        $pdo = Database::getConnection();
        $stmt = $pdo->prepare(
            "SELECT payload, revision, updated_by, updated_at FROM mapplusconf.catalog_document
             WHERE site = :site AND profile = :profile AND variant = :variant"
        );
        $stmt->execute(['site' => self::$site, 'profile' => $profile, 'variant' => self::$variant]);
        $row = $stmt->fetch();

        if (!$row) {
            return ['exists' => false, 'data' => [], 'revision' => 0, 'updatedBy' => null, 'updatedAt' => null];
        }

        $data = self::decodePayload($row['payload']);
        return [
            'exists'   => true,
            'data'     => $data ?? [],
            'revision' => (int)$row['revision'],
            'updatedBy' => isset($row['updated_by']) ? (string)$row['updated_by'] : null,
            'updatedAt' => isset($row['updated_at']) ? (string)$row['updated_at'] : null,
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
            "SELECT revision FROM mapplusconf.catalog_document WHERE site = :site AND profile = :profile AND variant = :variant"
        );
        $stmt->execute(['site' => self::$site, 'profile' => $profile, 'variant' => self::$variant]);
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
        $stmt = $pdo->prepare(
            "SELECT profile, revision, updated_at,
                    (SELECT count(*) FROM jsonb_object_keys(payload)) AS key_count
             FROM mapplusconf.catalog_document
             WHERE site = :site AND variant = :variant
             ORDER BY profile"
        );
        $stmt->execute(['site' => self::$site, 'variant' => self::$variant]);
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
                "SELECT revision, payload FROM mapplusconf.catalog_document
                 WHERE site = :site AND profile = :profile AND variant = :variant FOR UPDATE"
            );
            $stmt->execute(['site' => self::$site, 'profile' => $profile, 'variant' => self::$variant]);
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

            // Idempotenz: Bei inhaltlich identischem Payload KEINE neue Revision
            // und kein config_revision_at-Update. Loose '==' vergleicht
            // assoziative Arrays schluesselreihenfolge-UNabhaengig (JSON-Objekte),
            // Listen aber reihenfolge-abhaengig — exakt die JSON-Inhaltssemantik.
            if ($exists) {
                $storedData = self::decodePayload($row['payload']);
                if (is_array($storedData) && $storedData == $data) {
                    $pdo->commit(); // nur Lock freigeben, kein Schreibvorgang
                    return [
                        'success'   => true,
                        'conflict'  => false,
                        'revision'  => $currentRevision,
                        'unchanged' => true,
                    ];
                }
            }

            $newRevision = $currentRevision + 1;
            $payloadJson = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

            if ($exists) {
                $upd = $pdo->prepare(
                    "UPDATE mapplusconf.catalog_document
                     SET payload = :payload::jsonb, revision = :revision, updated_by = :user,
                         config_revision_at = now(), config_revision_by = :cfguser
                     WHERE site = :site AND profile = :profile AND variant = :variant"
                );
                $upd->execute([
                    'payload'  => $payloadJson,
                    'revision' => $newRevision,
                    'user'     => $user,
                    'cfguser'  => $user,
                    'site'     => self::$site,
                    'profile'  => $profile,
                    'variant'  => self::$variant,
                ]);
            } else {
                $ins = $pdo->prepare(
                    "INSERT INTO mapplusconf.catalog_document
                        (site, profile, variant, payload, revision, updated_by, config_revision_at, config_revision_by)
                     VALUES (:site, :profile, :variant, :payload::jsonb, :revision, :user, now(), :cfguser)"
                );
                $ins->execute([
                    'site'     => self::$site,
                    'profile'  => $profile,
                    'variant'  => self::$variant,
                    'payload'  => $payloadJson,
                    'revision' => $newRevision,
                    'user'     => $user,
                    'cfguser'  => $user,
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
        $pdo = Database::getConnection();
        $blockJson = json_encode($blockData, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        // Atomarer Block-Merge via PostgreSQL JSONB ||:
        // Nur der eine Block ($lyrmgrKey) wird überschrieben.
        // Andere Blöcke im Dokument bleiben unberührt.
        // ON CONFLICT → Upsert, falls das Profil-Dokument noch nicht existiert.
        // Parallele Saves verschiedener User auf verschiedene Blöcke sind konfliktfrei.
        $stmt = $pdo->prepare("
            INSERT INTO mapplusconf.catalog_document (site, profile, variant, payload, revision, updated_by, updated_at, config_revision_at, config_revision_by)
            VALUES (:site, :profile, :variant, jsonb_build_object(:lyrmgr_key::text, :block::jsonb), 1, :user, now(), now(), :cfguser)
            ON CONFLICT (site, profile, variant) DO UPDATE
            SET payload    = mapplusconf.catalog_document.payload
                             || jsonb_build_object(:lyrmgr_key2::text, :block2::jsonb),
                revision   = mapplusconf.catalog_document.revision + 1,
                updated_by = :user2,
                updated_at = now(),
                config_revision_at = now(),
                config_revision_by = :cfguser2
            RETURNING revision
        ");
        $stmt->execute([
            'site'        => self::$site,
            'profile'     => $profile,
            'variant'     => self::$variant,
            'lyrmgr_key'  => $lyrmgrKey,
            'block'       => $blockJson,
            'user'        => $user ?? 'anonym',
            'cfguser'     => $user ?? 'anonym',
            'lyrmgr_key2' => $lyrmgrKey,
            'block2'      => $blockJson,
            'user2'       => $user ?? 'anonym',
            'cfguser2'    => $user ?? 'anonym',
        ]);
        $row = $stmt->fetch();
        $newRevision = $row ? (int)$row['revision'] : 1;

        // History (Best-Effort nach dem Schreiben)
        try {
            $docNow = self::loadProfile($profile);
            $histPayload = json_encode($docNow['data'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            self::writeHistory($pdo, $profile, $newRevision, 'publish', $lyrmgrKey, $histPayload, $user);
        } catch (\Throwable $e) {
            error_log('CatalogRepository::publishBlock: History-Schreiben fehlgeschlagen: ' . $e->getMessage());
        }

        return [
            'success'   => true,
            'conflict'  => false,
            'revision'  => $newRevision,
            'published' => true,
            'lyrmgrKey' => $lyrmgrKey,
        ];
    }

    // ===== HISTORIE / VERSIONIERUNG =====

    /**
     * Liefert die Revisions-Historie (neueste zuerst) fuer aktuelle Site+Profil+Variante.
     *
     * @param string $profile
     * @param int    $limit
     * @return array<int, array{revision:int, action:string, lyrmgrKey:?string, changedBy:?string, changedAt:string}>
     */
    public static function listHistory(string $profile, int $limit = 50): array {
        $pdo = Database::getConnection();
        $stmt = $pdo->prepare(
            "SELECT revision, action, lyrmgr_key, changed_by, changed_at
             FROM mapplusconf.catalog_document_history
             WHERE site = :site AND profile = :profile AND variant = :variant
             ORDER BY revision DESC, id DESC
             LIMIT :limit"
        );
        $stmt->bindValue(':site', self::$site);
        $stmt->bindValue(':profile', $profile);
        $stmt->bindValue(':variant', self::$variant);
        $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
        $stmt->execute();
        $out = [];
        foreach ($stmt->fetchAll() as $row) {
            $out[] = [
                'revision'  => (int)$row['revision'],
                'action'    => (string)$row['action'],
                'lyrmgrKey' => isset($row['lyrmgr_key']) ? (string)$row['lyrmgr_key'] : null,
                'changedBy' => isset($row['changed_by']) ? (string)$row['changed_by'] : null,
                'changedAt' => (string)$row['changed_at'],
            ];
        }
        return $out;
    }

    /**
     * Liefert den Payload-Stand einer bestimmten Revision (fuer Diff/Restore).
     *
     * @param string $profile
     * @param int    $revision
     * @return array|null
     */
    public static function getHistoryPayload(string $profile, int $revision): ?array {
        $pdo = Database::getConnection();
        $stmt = $pdo->prepare(
            "SELECT payload FROM mapplusconf.catalog_document_history
             WHERE site = :site AND profile = :profile AND variant = :variant AND revision = :revision
             ORDER BY id DESC LIMIT 1"
        );
        $stmt->execute([
            'site'     => self::$site,
            'profile'  => $profile,
            'variant'  => self::$variant,
            'revision' => $revision,
        ]);
        $row = $stmt->fetch();
        if (!$row) {
            return null;
        }
        return self::decodePayload($row['payload']);
    }

    // ===== DRAFT (GRANULAR, BLOCKWEISE) =====

    /**
     * Speichert den Draft eines Profils blockweise in separaten Draft-Tabellen.
     *
     * @param string      $profile Profilname
     * @param array       $data    Draft-Dokument (lyrmgrKey => block)
     * @param string|null $user    Bearbeiter
     * @return array{success: bool, revision: int, updatedBy: ?string, updatedAt: ?string}
     */
    public static function saveDraftProfile(string $profile, array $data, ?string $user): array {
        $pdo = Database::getConnection();
        self::ensureDraftTables($pdo);

        $pdo->beginTransaction();
        try {
            $stmt = $pdo->prepare(
                "SELECT revision FROM mapplusconf.catalog_draft_profile
                 WHERE site = :site AND profile = :profile FOR UPDATE"
            );
            $stmt->execute(['site' => self::$site, 'profile' => $profile]);
            $row = $stmt->fetch();
            $currentRevision = $row ? (int)$row['revision'] : 0;
            $newRevision = $currentRevision + 1;

            $upProfile = $pdo->prepare(
                "INSERT INTO mapplusconf.catalog_draft_profile (site, profile, revision, updated_by)
                 VALUES (:site, :profile, :revision, :user)
                 ON CONFLICT (site, profile) DO UPDATE
                    SET revision = EXCLUDED.revision,
                        updated_by = EXCLUDED.updated_by,
                        updated_at = now()"
            );
            $upProfile->execute([
                'site'     => self::$site,
                'profile'  => $profile,
                'revision' => $newRevision,
                'user'     => $user,
            ]);

            $existingKeys = [];
            $listStmt = $pdo->prepare(
                "SELECT lyrmgr_key FROM mapplusconf.catalog_draft_block WHERE site = :site AND profile = :profile"
            );
            $listStmt->execute(['site' => self::$site, 'profile' => $profile]);
            foreach ($listStmt->fetchAll() as $kRow) {
                $existingKeys[(string)$kRow['lyrmgr_key']] = true;
            }

            $upBlock = $pdo->prepare(
                "INSERT INTO mapplusconf.catalog_draft_block
                    (site, profile, lyrmgr_key, payload, revision, updated_by)
                 VALUES (:site, :profile, :key, :payload::jsonb, :revision, :user)
                 ON CONFLICT (site, profile, lyrmgr_key) DO UPDATE
                    SET payload = EXCLUDED.payload,
                        revision = EXCLUDED.revision,
                        updated_by = EXCLUDED.updated_by,
                        updated_at = now()"
            );
            $insEvent = $pdo->prepare(
                "INSERT INTO mapplusconf.catalog_draft_event
                    (site, profile, lyrmgr_key, action, revision, payload, changed_by)
                 VALUES (:site, :profile, :key, :action, :revision, :payload::jsonb, :user)"
            );

            foreach ($data as $lyrmgrKey => $block) {
                $payloadJson = json_encode($block, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
                $upBlock->execute([
                    'site'     => self::$site,
                    'profile'  => $profile,
                    'key'      => (string)$lyrmgrKey,
                    'payload'  => $payloadJson,
                    'revision' => $newRevision,
                    'user'     => $user,
                ]);
                $insEvent->execute([
                    'site'     => self::$site,
                    'profile'  => $profile,
                    'key'      => (string)$lyrmgrKey,
                    'action'   => 'upsert',
                    'revision' => $newRevision,
                    'payload'  => $payloadJson,
                    'user'     => $user,
                ]);
                unset($existingKeys[(string)$lyrmgrKey]);
            }

            if (!empty($existingKeys)) {
                $delBlock = $pdo->prepare(
                    "DELETE FROM mapplusconf.catalog_draft_block
                     WHERE site = :site AND profile = :profile AND lyrmgr_key = :key"
                );
                $insDeleteEvent = $pdo->prepare(
                    "INSERT INTO mapplusconf.catalog_draft_event
                        (site, profile, lyrmgr_key, action, revision, payload, changed_by)
                     VALUES (:site, :profile, :key, :action, :revision, :payload::jsonb, :user)"
                );
                $emptyPayload = '{}';
                foreach (array_keys($existingKeys) as $deletedKey) {
                    $delBlock->execute([
                        'site'    => self::$site,
                        'profile' => $profile,
                        'key'     => $deletedKey,
                    ]);
                    $insDeleteEvent->execute([
                        'site'     => self::$site,
                        'profile'  => $profile,
                        'key'      => $deletedKey,
                        'action'   => 'delete',
                        'revision' => $newRevision,
                        'payload'  => $emptyPayload,
                        'user'     => $user,
                    ]);
                }
            }

            $pdo->commit();

            $status = self::getDraftStatus($profile);
            return [
                'success'   => true,
                'revision'  => (int)($status['revision'] ?? $newRevision),
                'updatedBy' => $status['updatedBy'] ?? $user,
                'updatedAt' => $status['updatedAt'] ?? null,
            ];
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
    }

    /**
     * Lädt den blockweise gespeicherten Draft eines Profils.
     *
     * @param string $profile Profilname
     * @return array{exists: bool, data: array, revision: int, updatedBy: ?string, updatedAt: ?string, lyrmgrMeta: array}
     */
    public static function loadDraftProfile(string $profile): array {
        $pdo = Database::getConnection();
        self::ensureDraftTables($pdo);

        $statusStmt = $pdo->prepare(
            "SELECT revision, updated_by, updated_at
             FROM mapplusconf.catalog_draft_profile
             WHERE site = :site AND profile = :profile"
        );
        $statusStmt->execute(['site' => self::$site, 'profile' => $profile]);
        $status = $statusStmt->fetch();

        if (!$status) {
            return [
                'exists'     => false,
                'data'       => [],
                'revision'   => 0,
                'updatedBy'  => null,
                'updatedAt'  => null,
                'lyrmgrMeta' => [],
            ];
        }

        $blocksStmt = $pdo->prepare(
            "SELECT lyrmgr_key, payload, revision, updated_by, updated_at
             FROM mapplusconf.catalog_draft_block
             WHERE site = :site AND profile = :profile
             ORDER BY lyrmgr_key"
        );
        $blocksStmt->execute(['site' => self::$site, 'profile' => $profile]);

        $data = [];
        $meta = [];
        foreach ($blocksStmt->fetchAll() as $row) {
            $key = (string)$row['lyrmgr_key'];
            $data[$key] = self::decodePayload($row['payload']) ?? [];
            $meta[$key] = [
                'source'    => 'draft-db',
                'revision'  => (int)$row['revision'],
                'updatedBy' => isset($row['updated_by']) ? (string)$row['updated_by'] : null,
                'updatedAt' => isset($row['updated_at']) ? (string)$row['updated_at'] : null,
            ];
        }

        return [
            'exists'     => true,
            'data'       => $data,
            'revision'   => (int)$status['revision'],
            'updatedBy'  => isset($status['updated_by']) ? (string)$status['updated_by'] : null,
            'updatedAt'  => isset($status['updated_at']) ? (string)$status['updated_at'] : null,
            'lyrmgrMeta' => $meta,
        ];
    }

    /**
     * Liefert den aktuellen Draft-Status für ein Profil.
     *
     * @param string $profile Profilname
     * @return array{exists: bool, revision: int, updatedBy: ?string, updatedAt: ?string}
     */
    public static function getDraftStatus(string $profile): array {
        $pdo = Database::getConnection();
        self::ensureDraftTables($pdo);

        $stmt = $pdo->prepare(
            "SELECT revision, updated_by, updated_at
             FROM mapplusconf.catalog_draft_profile
             WHERE site = :site AND profile = :profile"
        );
        $stmt->execute(['site' => self::$site, 'profile' => $profile]);
        $row = $stmt->fetch();

        if (!$row) {
            return ['exists' => false, 'revision' => 0, 'updatedBy' => null, 'updatedAt' => null];
        }

        return [
            'exists'     => true,
            'revision'   => (int)$row['revision'],
            'updatedBy'  => isset($row['updated_by']) ? (string)$row['updated_by'] : null,
            'updatedAt'  => isset($row['updated_at']) ? (string)$row['updated_at'] : null,
        ];
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
                "INSERT INTO mapplusconf.catalog_lock (site, profile, variant, locked_by, locked_at, expires_at)
                 VALUES (:site, :profile, :variant, :user, now(), :expires)
                 ON CONFLICT (site, profile, variant) DO UPDATE
                   SET locked_by = EXCLUDED.locked_by,
                       locked_at = now(),
                       expires_at = EXCLUDED.expires_at"
            );
            $stmt->execute([
                'site'    => self::$site,
                'profile' => $profile,
                'variant' => self::$variant,
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
             WHERE site = :site AND profile = :profile AND variant = :variant AND locked_by = :user"
        );
        $stmt->execute(['site' => self::$site, 'profile' => $profile, 'variant' => self::$variant, 'user' => $user]);
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
                FROM mapplusconf.catalog_lock WHERE site = :site AND profile = :profile AND variant = :variant";
        if ($forUpdate) {
            $sql .= ' FOR UPDATE';
        }
        $stmt = $pdo->prepare($sql);
        $stmt->execute(['site' => self::$site, 'profile' => $profile, 'variant' => self::$variant]);
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
                (site, profile, variant, revision, action, lyrmgr_key, payload, changed_by)
             VALUES (:site, :profile, :variant, :revision, :action, :key, :payload::jsonb, :user)"
        );
        $stmt->execute([
            'site'     => self::$site,
            'profile'  => $profile,
            'variant'  => self::$variant,
            'revision' => $revision,
            'action'   => $action,
            'key'      => $lyrmgrKey,
            'payload'  => $payloadJson,
            'user'     => $user,
        ]);
    }

    /**
     * Erstellt bei Bedarf die Draft-Tabellen für blockweise Entwurfsstände.
     *
     * @param TnetSchemaConnection $pdo
     * @return void
     */
    private static function ensureDraftTables($pdo): void {
        static $ready = false;
        if ($ready) {
            return;
        }

        $pdo->exec(
            "CREATE TABLE IF NOT EXISTS mapplusconf.catalog_draft_profile (
                site text NOT NULL DEFAULT 'maps',
                profile text NOT NULL,
                revision integer NOT NULL DEFAULT 0,
                updated_by text,
                updated_at timestamptz NOT NULL DEFAULT now(),
                PRIMARY KEY (site, profile)
            )"
        );

        $pdo->exec(
            "CREATE TABLE IF NOT EXISTS mapplusconf.catalog_draft_block (
                site text NOT NULL DEFAULT 'maps',
                profile text NOT NULL,
                lyrmgr_key text NOT NULL,
                payload jsonb NOT NULL,
                revision integer NOT NULL DEFAULT 0,
                updated_by text,
                updated_at timestamptz NOT NULL DEFAULT now(),
                PRIMARY KEY (site, profile, lyrmgr_key)
            )"
        );

        $pdo->exec(
            "CREATE TABLE IF NOT EXISTS mapplusconf.catalog_draft_event (
                id bigserial PRIMARY KEY,
                site text NOT NULL DEFAULT 'maps',
                profile text NOT NULL,
                lyrmgr_key text NOT NULL,
                action text NOT NULL,
                revision integer NOT NULL,
                payload jsonb,
                changed_by text,
                changed_at timestamptz NOT NULL DEFAULT now()
            )"
        );

        // Migration Bestands-DB: Site-Dimension fuer Draft-Tabellen nachruesten (idempotent).
        $pdo->exec(
            "DO \$\$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                               WHERE table_schema='mapplusconf' AND table_name='catalog_draft_profile' AND column_name='site') THEN
                    ALTER TABLE mapplusconf.catalog_draft_profile ADD COLUMN site text NOT NULL DEFAULT 'maps';
                    ALTER TABLE mapplusconf.catalog_draft_profile DROP CONSTRAINT IF EXISTS catalog_draft_profile_pkey;
                    ALTER TABLE mapplusconf.catalog_draft_profile ADD PRIMARY KEY (site, profile);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                               WHERE table_schema='mapplusconf' AND table_name='catalog_draft_block' AND column_name='site') THEN
                    ALTER TABLE mapplusconf.catalog_draft_block ADD COLUMN site text NOT NULL DEFAULT 'maps';
                    ALTER TABLE mapplusconf.catalog_draft_block DROP CONSTRAINT IF EXISTS catalog_draft_block_pkey;
                    ALTER TABLE mapplusconf.catalog_draft_block ADD PRIMARY KEY (site, profile, lyrmgr_key);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                               WHERE table_schema='mapplusconf' AND table_name='catalog_draft_event' AND column_name='site') THEN
                    ALTER TABLE mapplusconf.catalog_draft_event ADD COLUMN site text NOT NULL DEFAULT 'maps';
                END IF;
            END
            \$\$;"
        );

        $pdo->exec(
            "CREATE INDEX IF NOT EXISTS idx_catalog_draft_event_profile_changed_at
             ON mapplusconf.catalog_draft_event (site, profile, changed_at DESC)"
        );

        $ready = true;
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
