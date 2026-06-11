<?php
/**
 * TmpPaths.php
 * Zentrale Tmp-Pfad-Verwaltung pro Laufzeitumgebung (maps vs maps-dev).
 *
 * Liefert strukturierte Unterverzeichnisse unter dem Tmp-Root der jeweiligen
 * Umgebung. Ersetzt hardcodierte Literal-Pfade in API-Dateien.
 *
 * Root-Schema:
 *   /data/Client_Data/nwow/tmp/maps(-dev)/
 *   ├── cache/        → cache($sub)
 *   ├── runtime/      → runtime($sub)
 *   ├── logs/         → logs()
 *   ├── editor/       → editor($sub)
 *   ├── ags-import/   → agsImport($sub)
 *   └── config-export/→ configExport($scope)
 *
 * @version    1.0
 * @date       2026-06-10
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

class TnetTmpPaths {

    private static $root = null;

    // ===== ROOT =====

    /**
     * Liefert den Tmp-Root für die aktuelle Umgebung.
     * Erkennt maps-dev vs maps anhand des Dateipfads oder TNET_TMP_ROOT-Konstante.
     */
    public static function getRoot(): string {
        if (self::$root !== null) {
            return self::$root;
        }

        // Bereits definiert (z.B. durch treebuilder-api.php)?
        if (defined('TNET_TMP_ROOT')) {
            self::$root = rtrim(TNET_TMP_ROOT, '/');
            return self::$root;
        }

        $base = '/data/Client_Data/nwow/tmp';
        $dir  = str_replace('\\', '/', __FILE__);

        if (strpos($dir, '/maps-dev/') !== false) {
            self::$root = $base . '/maps-dev';
        } else {
            self::$root = $base . '/maps';
        }

        return self::$root;
    }

    // ===== GETTER =====

    /**
     * Pfad zum Cache-Unterverzeichnis.
     * @param string $sub  Unterordner (z.B. 'api-cache', 'proxy-cache', 'legends')
     */
    public static function cache(string $sub = ''): string {
        return self::sub('cache', $sub);
    }

    /**
     * Pfad zum Runtime-Unterverzeichnis (Tokens, transiente Artefakte).
     * @param string $sub  Unterordner (z.B. 'token', 'aggregation_png')
     */
    public static function runtime(string $sub = ''): string {
        return self::sub('runtime', $sub);
    }

    /**
     * Pfad zum Logs-Verzeichnis.
     */
    public static function logs(): string {
        return self::getRoot() . '/logs';
    }

    /**
     * Pfad zum Editor-Unterverzeichnis (persistente Editor-Daten).
     * @param string $sub  Unterordner (z.B. 'layertree', 'bookmarks')
     */
    public static function editor(string $sub = ''): string {
        return self::sub('editor', $sub);
    }

    /**
     * Pfad zum AGS-Import-Unterverzeichnis.
     * @param string $sub  Unterordner (z.B. 'raw-conf', 'ImportToCore')
     */
    public static function agsImport(string $sub = ''): string {
        return self::sub('ags-import', $sub);
    }

    /**
     * Pfad zum Config-Export-Unterverzeichnis (DB-Export-Pipeline).
     * Liegt unter stageConf/config-export/ damit der FastAPI-Endpoint /deploy-staged-conf
     * die Staging-Pfade akzeptiert (stage_conf_base-Whitelist).
     * @param string $scope  Scope (z.B. 'core', 'site-core', 'public')
     */
    public static function configExport(string $scope = ''): string {
        return self::sub('stageConf/config-export', $scope);
    }

    // ===== INTERN =====

    private static function sub(string $category, string $sub): string {
        $path = self::getRoot() . '/' . $category;
        if ($sub !== '') {
            $path .= '/' . ltrim($sub, '/');
        }
        return $path;
    }
}
