<?php
/**
 * Map Bookmark Service
 *
 * Nimmt einen Bookmark-Namen (Hauptname oder Alias) entgegen und liefert die
 * normalisierten Kartenkonfigurationen im Schema v2 zurueck. v1-Daten in der
 * Quelldatei werden zur Laufzeit nach v2 konvertiert (via BookmarkNormalizer).
 *
 * Usage: bookmark-service.php?name=nw_nutzungsplanung
 *
 * @version    2.0
 * @date       2026-05-27
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

require_once __DIR__ . '/../api/includes/BookmarkNormalizer.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

class BookmarkService {
    private static $bookmarks = null;
    private static $jsonFile = __DIR__ . '/../data/map-bookmarks-all.json';

    /**
     * Laedt Bookmarks aus JSON (Roh - keine Normalisierung).
     */
    private static function loadBookmarks() {
        if (self::$bookmarks === null) {
            if (!file_exists(self::$jsonFile)) {
                self::$bookmarks = [];
                return self::$bookmarks;
            }

            $json = file_get_contents(self::$jsonFile);
            $parsed = json_decode($json, true);

            if (json_last_error() !== JSON_ERROR_NONE) {
                error_log('Bookmark JSON Parse Error: ' . json_last_error_msg());
                self::$bookmarks = [];
                return self::$bookmarks;
            }

            self::$bookmarks = is_array($parsed) ? $parsed : [];
        }

        return self::$bookmarks;
    }

    /**
     * Sucht Bookmark nach Hauptname (id / map-bookmark) oder Alias.
     * Liefert normalisiert v2 oder null.
     */
    public static function findBookmark($name) {
        $bookmarks = self::loadBookmarks();
        return BookmarkNormalizer::findByName($bookmarks, (string)$name);
    }

    /**
     * Listet alle verfuegbaren Bookmark-Namen auf (Haupt-IDs + Aliases).
     */
    public static function listAllNames() {
        $bookmarks = self::loadBookmarks();
        $names = [];

        foreach ($bookmarks as $bookmark) {
            if (!is_array($bookmark)) continue;
            $primary = $bookmark['id'] ?? ($bookmark['map-bookmark'] ?? null);
            if ($primary !== null && $primary !== '') {
                $names[] = $primary;
            }
            if (!empty($bookmark['aliases']) && is_array($bookmark['aliases'])) {
                foreach ($bookmark['aliases'] as $al) {
                    if (is_string($al) && $al !== '') $names[] = $al;
                }
            }
        }

        return array_values(array_unique($names));
    }
}

// API Handler
try {
    $name = $_GET['name'] ?? $_GET['bookmark'] ?? '';

    // Listet alle Bookmarks auf wenn kein Name angegeben
    if ($name === '' || $name === null) {
        $allNames = BookmarkService::listAllNames();
        echo json_encode([
            'success' => true,
            'available_bookmarks' => $allNames,
            'count' => count($allNames),
            'usage' => 'Add ?name=bookmark_name to get specific bookmark'
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
        exit;
    }

    $bookmark = BookmarkService::findBookmark($name);

    if ($bookmark !== null) {
        echo json_encode([
            'success'  => true,
            'bookmark' => $bookmark
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    } else {
        echo json_encode([
            'success'   => false,
            'error'     => 'Bookmark not found',
            'requested' => $name
        ], JSON_PRETTY_PRINT);
    }

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error'   => 'Internal server error',
        'message' => $e->getMessage()
    ], JSON_PRETTY_PRINT);
}
