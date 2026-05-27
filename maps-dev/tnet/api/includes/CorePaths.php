<?php
/**
 * CorePaths - ermittelt Core-Pfade pro Laufzeitumgebung.
 *
 * DEV nutzt ausschliesslich core-dev, PROD nutzt core.
 *
 * @version    1.0
 * @date       2026-05-19
 */

class TnetCorePaths {

    private static $appBasePath = null;
    private static $coreRoot = null;

    public static function getAppBasePath() {
        if (self::$appBasePath !== null) {
            return self::$appBasePath;
        }

        $scriptName = str_replace('\\', '/', $_SERVER['SCRIPT_NAME'] ?? '');
        if (preg_match('#^/(maps(?:-dev)?)(?:/|$)#', $scriptName, $matches)) {
            self::$appBasePath = '/' . $matches[1];
            return self::$appBasePath;
        }

        $dir = str_replace('\\', '/', __DIR__);
        if (strpos($dir, '/maps-dev/') !== false) {
            self::$appBasePath = '/maps-dev';
            return self::$appBasePath;
        }
        if (strpos($dir, '/maps/') !== false) {
            self::$appBasePath = '/maps';
            return self::$appBasePath;
        }

        self::$appBasePath = '/maps';
        return self::$appBasePath;
    }

    public static function isDevApp() {
        return self::getAppBasePath() === '/maps-dev';
    }

    public static function getCoreRoot() {
        if (self::$coreRoot !== null) {
            return self::$coreRoot;
        }

        $coreDir = self::isDevApp() ? 'core-dev' : 'core';
        self::$coreRoot = self::findCoreRoot($coreDir);

        return self::$coreRoot;
    }

    public static function getSharedCoreRoot() {
        if (self::isDevApp()) {
            return null;
        }
        return self::getCoreRoot();
    }

    public static function getConfigPath() {
        $root = self::getCoreRoot();
        $path = self::existingDir($root ? $root . '/config' : null);
        if ($path) {
            return $path;
        }
        return null;
    }

    public static function getSharedConfigPath() {
        $root = self::getSharedCoreRoot();
        return self::existingDir($root ? $root . '/config' : null);
    }

    public static function getNlsPath($lang = 'de') {
        $root = self::getCoreRoot();
        $path = self::existingDir($root ? $root . '/nls/' . $lang : null);
        if ($path) {
            return $path;
        }
        return null;
    }

    public static function getSharedNlsPath($lang = 'de') {
        $root = self::getSharedCoreRoot();
        return self::existingDir($root ? $root . '/nls/' . $lang : null);
    }

    public static function getAppCoreNlsPath($lang = 'de') {
        // App-lokale NLS-Überladungen: /www/maps(-dev)/core/nls/<lang>/
        // Gilt für DEV und PROD gleichermassen (app-eigene Kategorie-Labels etc.)
        $path = realpath(__DIR__ . '/../../../core/nls/' . $lang);
        return ($path && is_dir($path)) ? $path : null;
    }

    public static function resolveCoreFile($filename) {
        $root = self::getCoreRoot();
        if (!$root) {
            return null;
        }
        $candidate = $root . '/' . ltrim($filename, '/');
        return is_file($candidate) ? $candidate : null;
    }

    public static function resolveConfigFile($filename) {
        foreach (self::getConfigSearchPaths() as $configPath) {
            $candidate = $configPath . '/' . ltrim($filename, '/');
            if (is_file($candidate)) {
                return $candidate;
            }
        }
        return null;
    }

    public static function getConfigSearchPaths() {
        $paths = [];
        self::appendPath($paths, self::getConfigPath());
        if (!self::isDevApp()) {
            self::appendPath($paths, self::getSharedConfigPath());
        }
        return $paths;
    }

    public static function getNlsSearchPaths($lang = 'de') {
        $paths = [];
        self::appendPath($paths, self::getNlsPath($lang));         // /www/core(-dev)/nls/<lang>
        if (!self::isDevApp()) {
            self::appendPath($paths, self::getSharedNlsPath($lang)); // nur PROD: shared core
        }
        // App-lokale NLS-Überladungen für DEV und PROD (/www/maps(-dev)/core/nls/<lang>)
        self::appendPath($paths, self::getAppCoreNlsPath($lang));
        return $paths;
    }

    private static function findCoreRoot($coreDir): ?string {
        $candidates = [];
        $envRoot = getenv(self::isDevApp() ? 'TNET_CORE_DEV_ROOT' : 'TNET_CORE_ROOT');
        if ($envRoot) {
            $candidates[] = $envRoot;
        }

        $docRoot = rtrim(str_replace('\\', '/', $_SERVER['DOCUMENT_ROOT'] ?? ''), '/');
        if ($docRoot !== '') {
            $candidates[] = $docRoot . '/' . $coreDir;
        }

        $projectRoot = realpath(__DIR__ . '/../../../../');
        if ($projectRoot) {
            $candidates[] = str_replace('\\', '/', $projectRoot) . '/' . $coreDir;
        }

        $candidates[] = '/www/' . $coreDir;

        foreach ($candidates as $candidate) {
            $path = self::existingDir($candidate);
            if ($path) {
                return $path;
            }
        }

        return null;
    }

    private static function existingDir($path): ?string {
        if (!$path || !is_dir($path)) {
            return null;
        }
        $real = realpath($path);
        return $real ? str_replace('\\', '/', $real) : str_replace('\\', '/', $path);
    }

    private static function appendPath(&$paths, $path) {
        if ($path && !in_array($path, $paths, true)) {
            $paths[] = $path;
        }
    }
}
