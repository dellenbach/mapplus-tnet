<?php
/**
 * ConfigReader - Liest MAP+ Konfigurationsdateien
 * 
 * Zentraler Reader für .conf-Dateien (JSON-Format) aus core/config/.
 * Wird von allen API-Endpoints verwendet, die Konfigurationen lesen.
 *
 * @version    1.0
 * @date       2026-02-20
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

class ConfigReader {

    /** @var string Basispfad zu core/config/ */
    private static $coreConfigPath = null;

    /** @var string Basispfad zu public/config/ */
    private static $publicConfigPath = null;

    /**
     * Ermittelt und cached den Pfad zu core/config/
     * 
     * @return string|null Pfad oder null wenn nicht gefunden
     */
    public static function getCoreConfigPath() {
        if (self::$coreConfigPath !== null) {
            return self::$coreConfigPath;
        }

        // Primärer Pfad: includes/ → api/ → tnet/ → maps/ → PROJECT_ROOT/ → core/config/
        $primary = realpath(__DIR__ . '/../../../../core/config');
        if ($primary && is_dir($primary)) {
            self::$coreConfigPath = $primary;
            return self::$coreConfigPath;
        }

        // Alternativer Pfad (relativ zu DOCUMENT_ROOT)
        $alt = $_SERVER['DOCUMENT_ROOT'] . '/nwow/core/config';
        if (is_dir($alt)) {
            self::$coreConfigPath = realpath($alt);
            return self::$coreConfigPath;
        }

        return null;
    }

    /**
     * Ermittelt und cached den Pfad zu public/config/
     * 
     * @param string $group Optional: Gruppenname (nwpro, owpro, etc.)
     * @return string|null Pfad oder null wenn nicht gefunden
     */
    public static function getPublicConfigPath($group = null) {
        // Basispfad: includes/ → api/ → tnet/ → maps/ → public/config/
        $basePath = realpath(__DIR__ . '/../../../public/config');
        if (!$basePath || !is_dir($basePath)) {
            return null;
        }

        if ($group && $group !== 'public') {
            // Gruppen-spezifischer Pfad: maps/public/config/{group}/
            $path = $basePath . '/' . $group;
            if (is_dir($path)) {
                return realpath($path);
            }
            return null;
        }

        // Standard: maps/public/config/ (Hauptordner)
        return $basePath;
    }

    /**
     * Liest eine einzelne .conf-Datei (JSON) und gibt sie als Array zurück
     * 
     * @param string $filePath Vollständiger Pfad zur .conf-Datei
     * @return array|null Geparste Daten oder null bei Fehler
     */
    public static function readConfFile($filePath) {
        if (!file_exists($filePath)) {
            return null;
        }

        $content = file_get_contents($filePath);
        $data = json_decode($content, true);

        if (json_last_error() !== JSON_ERROR_NONE) {
            error_log("ConfigReader: JSON parse error in {$filePath}: " . json_last_error_msg());
            return null;
        }

        return $data;
    }

    /**
     * Liest alle Layer-Definitionen aus core/config/layers_*.conf
     * 
     * @return array ['definitions' => [...], 'filesCount' => int, 'path' => string]
     */
    public static function readAllLayerDefinitions() {
        $coreConfig = self::getCoreConfigPath();
        if (!$coreConfig) {
            return ['definitions' => [], 'filesCount' => 0, 'path' => null];
        }

        $definitions = [];
        $layerFiles = glob($coreConfig . '/layers_*.conf');
        $filesCount = count($layerFiles);

        foreach ($layerFiles as $layerFile) {
            $layers = self::readConfFile($layerFile);
            if ($layers && is_array($layers)) {
                $definitions = array_merge($definitions, $layers);
            }
        }

        return [
            'definitions' => $definitions,
            'filesCount'  => $filesCount,
            'path'        => $coreConfig
        ];
    }

    /**
     * Liest die lyrmgr.conf Datei
     * 
     * @param string $group Optional: Gruppenname
     * @return array|null Geparste lyrmgr.conf oder null
     */
    public static function readLyrmgrConf($group = 'public') {
        // 1. Gruppen-spezifische lyrmgr.conf suchen
        if ($group && $group !== 'public') {
            $groupConfig = self::getPublicConfigPath($group);
            if ($groupConfig) {
                $groupFile = $groupConfig . '/lyrmgr.conf';
                if (file_exists($groupFile)) {
                    return self::readConfFile($groupFile);
                }
            }
        }

        // 2. Fallback: Haupt lyrmgr.conf aus public/config/
        $publicConfig = self::getPublicConfigPath();
        if (!$publicConfig) {
            return null;
        }

        return self::readConfFile($publicConfig . '/lyrmgr.conf');
    }

    /**
     * Liest die basemaps.conf Datei
     * 
     * @return array|null Geparste basemaps.conf oder null
     */
    public static function readBasemapsConf() {
        $coreConfig = self::getCoreConfigPath();
        if (!$coreConfig) {
            return null;
        }

        return self::readConfFile($coreConfig . '/basemaps.conf');
    }

    /**
     * Liest die lyrmgr-mapping.json Datei
     * 
     * @return array|null Geparste Mapping-Datei oder null
     */
    public static function readLyrmgrMapping() {
        // Die Mapping-Datei liegt im php-Ordner (historisch bedingt)
        $mappingPath = realpath(__DIR__ . '/../../php/lyrmgr-mapping.json');
        if (!$mappingPath) {
            return null;
        }

        return self::readConfFile($mappingPath);
    }

    /**
     * Listet alle verfügbaren Gruppen (Profilordner) auf
     * 
     * @return array Liste der Gruppennamen
     */
    public static function listGroups() {
        // Alle Unterordner von public/config/ sind Gruppen
        $basePath = realpath(__DIR__ . '/../../../public/config');
        if (!$basePath || !is_dir($basePath)) {
            return ['public'];
        }

        $groups = ['public']; // Hauptordner ist immer verfügbar

        $dirs = scandir($basePath);
        foreach ($dirs as $dir) {
            if ($dir === '.' || $dir === '..') continue;
            if (is_dir($basePath . '/' . $dir)) {
                $groups[] = $dir;
            }
        }

        sort($groups);
        return $groups;
    }
}
