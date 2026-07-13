<?php
/**
 * CacheHelper - HTTP Caching für API Responses
 * 
 * Unterstützt Cache-Control, ETag und 304 Not Modified.
 * Reduziert Server-Last und verbessert Response-Zeiten.
 *
 * @version    1.0
 * @date       2026-02-20
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

class CacheHelper {

    /** @var int Standard Cache-Dauer in Sekunden (1 Stunde) */
    const DEFAULT_MAX_AGE = 3600;

    /** @var int Kurze Cache-Dauer (5 Minuten) */
    const SHORT_MAX_AGE = 300;

    /** @var int Lange Cache-Dauer (24 Stunden) */
    const LONG_MAX_AGE = 86400;

    /**
     * Setzt Cache-Control Header
     * 
     * @param int  $maxAge   Max-Age in Sekunden
     * @param bool $isPublic Ob der Cache öffentlich sein darf
     */
    public static function setCacheControl($maxAge = self::DEFAULT_MAX_AGE, $isPublic = true) {
        $visibility = $isPublic ? 'public' : 'private';
        header("Cache-Control: {$visibility}, max-age={$maxAge}");
    }

    /**
     * Setzt no-cache Header — Browser muss immer beim Server revalidieren.
     * ETag/304 sorgt dafür, dass bei unverändertem Inhalt kein Body
     * übertragen wird (schnell), aber Änderungen sofort sichtbar sind.
     */
    public static function setNoCache() {
        header("Cache-Control: no-cache, must-revalidate");
    }

    /**
     * Setzt ETag und prüft auf 304 Not Modified
     * 
     * Wenn der Client den gleichen ETag sendet, wird 304 zurückgegeben
     * und kein Body gesendet → spart Bandbreite.
     * 
     * @param string $data Die Daten, für die der ETag berechnet wird
     * @return void
     */
    public static function handleETag($data) {
        $etag = '"' . md5($data) . '"';
        header("ETag: {$etag}");

        // Prüfe ob Client den gleichen ETag hat
        $clientETag = $_SERVER['HTTP_IF_NONE_MATCH'] ?? '';
        if ($clientETag === $etag) {
            http_response_code(304);
            exit;
        }
    }

    /**
     * Setzt Last-Modified Header basierend auf Datei-Änderungsdatum
     * 
     * @param string $filePath Pfad zur Datei
     * @return void
     */
    public static function handleLastModified($filePath) {
        if (!file_exists($filePath)) {
            return;
        }

        $lastModified = filemtime($filePath);
        $lastModifiedGmt = gmdate('D, d M Y H:i:s', $lastModified) . ' GMT';
        header("Last-Modified: {$lastModifiedGmt}");

        // Prüfe If-Modified-Since
        $ifModifiedSince = $_SERVER['HTTP_IF_MODIFIED_SINCE'] ?? '';
        if ($ifModifiedSince === $lastModifiedGmt) {
            http_response_code(304);
            exit;
        }
    }

    /**
     * Setzt No-Cache Header (für dynamische oder Debug-Responses)
     */
    public static function noCache() {
        header('Cache-Control: no-cache, no-store, must-revalidate');
        header('Pragma: no-cache');
        header('Expires: 0');
    }
}
