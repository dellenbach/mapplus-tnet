<?php
/**
 * FileSyncRepository.php
 * Datei-basierter Sync zwischen DEV- und PROD-Umgebung.
 *
 * Vergleicht und kopiert Konfig-Dateien rekursiv zwischen den
 * umgebungsspezifischen Bäumen:
 *   <www>/maps-dev/  (DEV)
 *   <www>/maps/      (PROD)
 *
 * Domains (umgebungsspezifisch, daher sinnvoll vergleichbar):
 *   core           — maps-dev/core   vs maps/core   (Override-Layer + NLS/Legenden)
 *   public-config  — maps-dev/public/config vs maps/public/config (Profile)
 *   tnet-config    — maps-dev/tnet/config vs maps/tnet/config (App-Configs json5)
 *
 * Hinweis: <www>/core/ ist serverseitig GETEILT (gleicher Stand für DEV+PROD)
 * und wird daher bewusst NICHT verglichen.
 *
 * @version    2.0
 * @date       2026-06-26
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

class FileSyncRepository {

    // ===== KONFIGURATION =====

    /**
     * Ermittelt das /www-Wurzelverzeichnis relativ zum Speicherort dieser Datei.
     * Diese Datei liegt unter <www>/<maps-dev|maps>/tnet/api/includes/ →
     * vier Ebenen hoch ergibt <www>. So funktioniert es unabhängig davon, wo
     * der reale Dateisystempfad gemountet ist (SFTP-Pfad /www kann abweichen).
     */
    private static function wwwRoot(): string {
        return dirname(__DIR__, 4); // includes → api → tnet → (maps-dev|maps) → www
    }

    /** Basis-Verzeichnisse der Umgebungen (reale Dateisystempfade) */
    private static function envRoot(string $env): string {
        $map = [
            'dev'  => self::wwwRoot() . '/maps-dev',
            'prod' => self::wwwRoot() . '/maps',
        ];
        if (!isset($map[$env])) {
            throw new \InvalidArgumentException('Unbekannte Umgebung: ' . $env);
        }
        return $map[$env];
    }

    /** Datei-Domains mit Unterverzeichnis (rekursiv), Datei-Pattern und Label */
    public static function domains(): array {
        return [
            'core' => [
                'label'   => 'Core-Override (maps/core ↔ maps-dev/core)',
                'subdir'  => 'core',
                'pattern' => '/\.(conf|json|json5)$/i',
            ],
            'public-config' => [
                'label'   => 'Profil-Config (maps/public/config ↔ maps-dev/public/config)',
                'subdir'  => 'public/config',
                'pattern' => '/\.(conf|json|json5|js)$/i',
            ],
            'tnet-config' => [
                'label'   => 'Tnet App-Config (maps/tnet/config ↔ maps-dev/tnet/config)',
                'subdir'  => 'tnet/config',
                'pattern' => '/\.(json|json5)$/i',
            ],
        ];
    }

    // ===== STATUS =====

    /**
     * Liefert Datei-Vergleich für alle Domains zwischen DEV und PROD.
     * Schlüssel je Datei ist der RELATIVE Pfad innerhalb der Domain.
     */
    public static function getStatus(): array {
        $result = [];
        foreach (self::domains() as $key => $domain) {
            $devFiles  = self::listFiles('dev',  $domain['subdir'], $domain['pattern']);
            $prodFiles = self::listFiles('prod', $domain['subdir'], $domain['pattern']);

            $allNames = array_unique(array_merge(array_keys($devFiles), array_keys($prodFiles)));
            sort($allNames);

            $files = [];
            foreach ($allNames as $name) {
                $dev  = $devFiles[$name]  ?? null;
                $prod = $prodFiles[$name] ?? null;
                $files[$name] = ['dev' => $dev, 'prod' => $prod, 'status' => self::compareStatus($dev, $prod)];
            }
            $result[$key] = ['label' => $domain['label'], 'subdir' => $domain['subdir'], 'files' => $files];
        }
        return $result;
    }

    /**
     * Liefert den Inhalt einer Datei in DEV und PROD für den On-Demand-Diff.
     *
     * @param string $domain  Domain-Schlüssel
     * @param string $relpath Relativer Pfad innerhalb der Domain
     * @return array{dev: ?string, prod: ?string, relpath: string, devInfo: ?array, prodInfo: ?array}
     */
    public static function contentDiff(string $domain, string $relpath): array {
        $domains = self::domains();
        if (!isset($domains[$domain])) {
            throw new \InvalidArgumentException('Unbekannte File-Domain: ' . $domain);
        }
        $rel = self::sanitizeRelPath($relpath);
        $subdir = $domains[$domain]['subdir'];

        $devPath  = self::envRoot('dev')  . '/' . $subdir . '/' . $rel;
        $prodPath = self::envRoot('prod') . '/' . $subdir . '/' . $rel;

        $devContent  = is_file($devPath)  ? @file_get_contents($devPath)  : null;
        $prodContent = is_file($prodPath) ? @file_get_contents($prodPath) : null;

        return [
            'relpath'  => $rel,
            'dev'      => $devContent === false ? null : $devContent,
            'prod'     => $prodContent === false ? null : $prodContent,
            'devInfo'  => is_file($devPath)  ? ['size' => filesize($devPath),  'mtime' => date('c', filemtime($devPath))]  : null,
            'prodInfo' => is_file($prodPath) ? ['size' => filesize($prodPath), 'mtime' => date('c', filemtime($prodPath))] : null,
        ];
    }

    /**
     * Löst den realen PHP-Dateipfad für eine Domain/Umgebung/relativen Pfad auf
     * und validiert den erlaubten Datei-Typ. Für den FastAPI-Deploy (SFTP) genutzt.
     *
     * @param string $env     'dev' | 'prod'
     * @param string $domain  Domain-Schlüssel
     * @param string $relpath Relativer Pfad innerhalb der Domain
     * @return string Realer PHP-Pfad (z.B. /var/www/html/nwow/maps/public/config/x.conf)
     */
    public static function resolvePath(string $env, string $domain, string $relpath): string {
        $domains = self::domains();
        if (!isset($domains[$domain])) {
            throw new \InvalidArgumentException('Unbekannte File-Domain: ' . $domain);
        }
        $rel  = self::sanitizeRelPath($relpath);
        $base = basename($rel);
        if (!preg_match($domains[$domain]['pattern'], $base)) {
            throw new \InvalidArgumentException('Datei-Typ nicht erlaubt: ' . $base);
        }
        return self::envRoot($env) . '/' . $domains[$domain]['subdir'] . '/' . $rel;
    }

    // ===== DB ↔ PUBLIZIERTE DATEIEN =====

    /**
     * Vergleicht die DB-Bundles (config_bundle_store der aktuellen Umgebung)
     * gegen die publizierten Dateien im geteilten Core (<www>/core/).
     * Zeigt, ob ein neuer Export/Publish nötig ist.
     *
     * @return array{coreRoot:string, items:array, counts:array}
     */
    public static function dbPublishStatus(): array {
        require_once __DIR__ . '/StagingImportRepository.php';
        $coreRoot = self::wwwRoot() . '/core';
        $bundles  = StagingImportRepository::loadAllSafe();

        $items  = [];
        $counts = ['total' => 0, 'match' => 0, 'diff' => 0, 'missing' => 0, 'unknown' => 0];

        foreach ($bundles as $b) {
            $kuerzel = (string)($b['kuerzel'] ?? '');
            foreach (($b['files'] ?? []) as $f) {
                $name = trim((string)($f['name'] ?? ''));
                if ($name === '') continue;
                if (self::isNonPublishable($name)) continue; // interne Manifeste/Hidden überspringen
                $bucket = self::publishBucket($name);
                if ($bucket === null) continue;

                $diskPath   = $coreRoot . '/' . $bucket . '/' . $name;
                $diskExists = is_file($diskPath);
                $dbData     = $f['data'] ?? null;

                if (!$diskExists) {
                    $status = 'missing';
                } elseif (!is_array($dbData)) {
                    $status = 'unknown';
                } else {
                    $diskData = json_decode((string)@file_get_contents($diskPath), true);
                    $status = (self::canon($dbData) === self::canon($diskData)) ? 'match' : 'diff';
                }

                $counts['total']++;
                $counts[$status] = ($counts[$status] ?? 0) + 1;

                $items[] = [
                    'kuerzel'    => $kuerzel,
                    'name'       => $name,
                    'bucket'     => $bucket,
                    'status'     => $status,
                    'diskMtime'  => $diskExists ? date('c', filemtime($diskPath)) : null,
                    'dbModified' => $f['modified'] ?? ($b['lastImportedAt'] ?? null),
                ];
            }
        }

        usort($items, fn($a, $b) => strcmp($a['name'], $b['name']));
        return ['coreRoot' => 'core', 'items' => $items, 'counts' => $counts];
    }

    /**
     * Liefert DB-Inhalt und publizierten Datei-Inhalt für den On-Demand-Diff.
     * Beide Seiten werden mit identischer Schlüsselordnung pretty-gedruckt,
     * damit der Zeilen-Diff nur echte inhaltliche Unterschiede zeigt.
     */
    public static function dbPublishDiff(string $kuerzel, string $name): array {
        require_once __DIR__ . '/StagingImportRepository.php';
        $name   = basename(str_replace('\\', '/', $name));
        $bundle = StagingImportRepository::loadBundle($kuerzel);

        $dbData = null;
        if ($bundle) {
            foreach (($bundle['files'] ?? []) as $f) {
                if (trim((string)($f['name'] ?? '')) === $name) { $dbData = $f['data'] ?? null; break; }
            }
        }
        $bucket   = self::publishBucket($name);
        $diskPath = self::wwwRoot() . '/core/' . ($bucket ?? 'config') . '/' . $name;
        $diskRaw  = is_file($diskPath) ? (string)@file_get_contents($diskPath) : null;
        $diskData = $diskRaw !== null ? json_decode($diskRaw, true) : null;

        return [
            'name'    => $name,
            'kuerzel' => $kuerzel,
            'db'      => is_array($dbData)   ? self::prettyCanon($dbData)   : null,
            'disk'    => is_array($diskData) ? self::prettyCanon($diskData) : $diskRaw,
        ];
    }

    /**
     * Erstellt den Republish-Plan für eine DB-Bundle-Datei: serialisiert den
     * DB-Inhalt als pretty-JSON (gleiches Format wie der bestehende Publish) und
     * liefert den realen PHP-Zielpfad im geteilten Core. Der eigentliche Schreib-
     * vorgang läuft im Aufrufer über FastAPI /deploy-staged-conf (SFTP).
     *
     * @return array{name:string, bucket:string, content:string, deployPhpPath:string}
     */
    public static function republishPlan(string $kuerzel, string $name): array {
        require_once __DIR__ . '/StagingImportRepository.php';
        $name   = basename(str_replace('\\', '/', $name));
        if (self::isNonPublishable($name)) {
            throw new \RuntimeException('Interne Manifest-/Metadatei ist nicht publizierbar: ' . $name);
        }
        $bundle = StagingImportRepository::loadBundle($kuerzel);

        $data = null;
        if ($bundle) {
            foreach (($bundle['files'] ?? []) as $f) {
                if (trim((string)($f['name'] ?? '')) === $name) { $data = $f['data'] ?? null; break; }
            }
        }
        if (!is_array($data)) {
            throw new \RuntimeException('DB-Inhalt für ' . $name . ' (Kürzel ' . $kuerzel . ') nicht gefunden');
        }
        $bucket = self::publishBucket($name);
        if ($bucket === null) {
            throw new \RuntimeException('Kein Ziel-Bucket für ' . $name . ' (nur .conf/.json publizierbar)');
        }
        return [
            'name'          => $name,
            'bucket'        => $bucket,
            'content'       => json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'deployPhpPath' => self::wwwRoot() . '/core/' . $bucket . '/' . $name,
        ];
    }

    /** Ziel-Bucket im Core anhand der Dateiendung (.conf → config, .json → nls/de). */
    private static function publishBucket(string $name): ?string {
        if (preg_match('/\.conf$/i', $name)) return 'config';
        if (preg_match('/\.json$/i', $name)) return 'nls/de';
        return null;
    }

    /**
     * True, wenn eine Bundle-Datei NICHT publizierbar ist (interne Metadaten):
     *  - versteckte Dateien (führender Punkt), z.B. ".core-import-manifest_<kuerzel>.json"
     *  - Import-/Change-Detection-Manifeste
     * Diese sind reine Bookkeeping-Dateien der Import-Pipeline und gehören nicht nach core/.
     */
    private static function isNonPublishable(string $name): bool {
        $base = basename(str_replace('\\', '/', $name));
        if ($base === '' || $base[0] === '.') return true;
        if (stripos($base, 'core-import-manifest') !== false) return true;
        if (stripos($base, 'manifest') === 0) return true;
        return false;
    }

    /** Kanonische (schlüsselsortierte) JSON-Repräsentation für inhaltlichen Vergleich. */
    private static function canon($data): string {
        return json_encode(self::ksortRecursive($data), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    /** Pretty-Print mit stabiler Schlüsselordnung (für lesbaren Zeilen-Diff). */
    private static function prettyCanon($data): string {
        return json_encode(self::ksortRecursive($data), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    /** Sortiert assoziative Arrays rekursiv nach Schlüssel (Listen bleiben unverändert). */
    private static function ksortRecursive($value) {
        if (is_array($value)) {
            $isAssoc = array_keys($value) !== range(0, count($value) - 1);
            foreach ($value as $k => $v) {
                $value[$k] = self::ksortRecursive($v);
            }
            if ($isAssoc) ksort($value);
        }
        return $value;
    }

    // ===== SYNC =====

    /**
     * Kopiert ausgewählte Dateien (relative Pfade) einer Domain von src nach dst.
     *
     * @param string   $domain    z.B. 'core'
     * @param string   $direction 'dev-to-prod' | 'prod-to-dev'
     * @param string[] $relpaths  Relative Pfade innerhalb der Domain
     * @return array ['copied', 'errors']
     */
    public static function execute(string $domain, string $direction, array $relpaths): array {
        [$srcEnv, $dstEnv] = self::parseDirection($direction);

        $domains = self::domains();
        if (!isset($domains[$domain])) {
            throw new \InvalidArgumentException('Unbekannte File-Domain: ' . $domain);
        }
        $subdir  = $domains[$domain]['subdir'];
        $pattern = $domains[$domain]['pattern'];
        $srcRoot = self::envRoot($srcEnv) . '/' . $subdir;
        $dstRoot = self::envRoot($dstEnv) . '/' . $subdir;

        $copied = 0;
        $errors = [];

        foreach ($relpaths as $relpath) {
            try {
                $rel = self::sanitizeRelPath($relpath);
            } catch (\Throwable $e) {
                $errors[] = $relpath . ': ungültiger Pfad';
                continue;
            }
            $base = basename($rel);
            if ($pattern && !preg_match($pattern, $base)) {
                $errors[] = $rel . ': Datei-Typ nicht erlaubt in dieser Domain';
                continue;
            }

            $srcPath = $srcRoot . '/' . $rel;
            $dstPath = $dstRoot . '/' . $rel;

            if (!is_file($srcPath)) {
                $errors[] = $rel . ': Quelldatei nicht gefunden';
                continue;
            }
            $dstDir = dirname($dstPath);
            if (!is_dir($dstDir) && !@mkdir($dstDir, 0775, true)) {
                $errors[] = $rel . ': Zielverzeichnis konnte nicht angelegt werden';
                continue;
            }
            if (!@copy($srcPath, $dstPath)) {
                $errors[] = $rel . ': Kopieren fehlgeschlagen';
                continue;
            }
            $copied++;
        }

        return ['copied' => $copied, 'errors' => $errors];
    }

    // ===== PRIVATE HELPERS =====

    /**
     * Listet alle Dateien REKURSIV unter einem Verzeichnis mit MD5 und Zeitstempel.
     * Schlüssel ist der relative Pfad (mit '/' als Trenner).
     *
     * @return array [ relpath => ['size', 'md5', 'mtime'] ]
     */
    private static function listFiles(string $env, string $subdir, string $pattern): array {
        $root = self::envRoot($env) . '/' . $subdir;
        $result = [];
        if (!is_dir($root)) return $result;

        try {
            $rii = new \RecursiveIteratorIterator(
                new \RecursiveDirectoryIterator($root, \FilesystemIterator::SKIP_DOTS | \FilesystemIterator::FOLLOW_SYMLINKS),
                \RecursiveIteratorIterator::LEAVES_ONLY
            );
        } catch (\Throwable $e) {
            return $result;
        }
        foreach ($rii as $fileInfo) {
            if (!$fileInfo->isFile()) continue;
            $name = $fileInfo->getFilename();
            if ($pattern && !preg_match($pattern, $name)) continue;
            // Backup-/temporäre Dateien überspringen
            if (preg_match('/\.bak|\.\d{8}_\d{6}\.|~$/', $name)) continue;
            $full = $fileInfo->getPathname();
            $rel  = ltrim(str_replace('\\', '/', substr($full, strlen($root))), '/');
            $result[$rel] = [
                'size'  => $fileInfo->getSize(),
                'md5'   => md5_file($full),
                'mtime' => date('c', $fileInfo->getMTime()),
            ];
        }
        return $result;
    }

    /**
     * Vergleichsstatus: 'sync' | 'dev-only' | 'prod-only' | 'diff'
     */
    private static function compareStatus(?array $dev, ?array $prod): string {
        if (!$dev && !$prod) return 'unknown';
        if ($dev  && !$prod) return 'dev-only';
        if (!$dev &&  $prod) return 'prod-only';
        return ($dev['md5'] === $prod['md5']) ? 'sync' : 'diff';
    }

    /** Validiert und normalisiert einen relativen Pfad (kein Traversal, kein absoluter Pfad). */
    private static function sanitizeRelPath(string $relpath): string {
        $rel = str_replace('\\', '/', $relpath);
        $rel = ltrim($rel, '/');
        if ($rel === '' || strpos($rel, '..') !== false) {
            throw new \InvalidArgumentException('Ungültiger relativer Pfad: ' . $relpath);
        }
        return $rel;
    }

    private static function parseDirection(string $direction): array {
        if ($direction === 'dev-to-prod') return ['dev', 'prod'];
        if ($direction === 'prod-to-dev') return ['prod', 'dev'];
        throw new \InvalidArgumentException('Ungültige Sync-Richtung: ' . $direction);
    }
}
