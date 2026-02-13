<?php
/**
 * Map Bookmark Service
 *
 * Nimmt einen Bookmark-Namen entgegen und liefert die zugehörigen
 * Kartenkonfigurationen zurück (basemap, layers, theme, subtheme)
 *
 * Usage: bookmark-service.php?name=nw_nutzungsplanung
 *
 * @version    1.0
 * @date       2026-02-12
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

class BookmarkService {
    private static $bookmarks = null;
    private static $jsonFile = __DIR__ . '/map-bookmarks-all.json';
    
    /**
     * Lädt Bookmarks aus JSON (mit OPcache gecacht)
     */
    private static function loadBookmarks() {
        if (self::$bookmarks === null) {
            if (!file_exists(self::$jsonFile)) {
                return [];
            }
            
            $json = file_get_contents(self::$jsonFile);
            self::$bookmarks = json_decode($json, true);
            
            if (json_last_error() !== JSON_ERROR_NONE) {
                error_log('Bookmark JSON Parse Error: ' . json_last_error_msg());
                return [];
            }
        }
        
        return self::$bookmarks;
    }
    
    /**
     * Sucht Bookmark nach Namen (im Hauptfeld oder in Aliases)
     * 
     * @param string $name Der gesuchte Bookmark-Name
     * @return array|null Das gefundene Bookmark oder null
     */
    public static function findBookmark($name) {
        if (empty($name)) {
            return null;
        }
        
        $bookmarks = self::loadBookmarks();
        $name = trim($name);
        
        foreach ($bookmarks as $bookmark) {
            // Prüfe Hauptname
            if (isset($bookmark['map-bookmark']) && $bookmark['map-bookmark'] === $name) {
                return self::formatBookmark($bookmark);
            }
            
            // Prüfe Aliases
            if (isset($bookmark['aliases']) && is_array($bookmark['aliases'])) {
                if (in_array($name, $bookmark['aliases'], true)) {
                    return self::formatBookmark($bookmark);
                }
            }
        }
        
        return null;
    }
    
    /**
     * Formatiert Bookmark (extrahiert nur relevante Felder)
     * 
     * @param array $bookmark Das Original-Bookmark
     * @return array Gefilterte Daten
     */
    private static function formatBookmark($bookmark) {
        $result = [];
        
        // Übernehme alle Felder in derselben Struktur
        if (isset($bookmark['map-bookmark'])) {
            $result['map-bookmark'] = $bookmark['map-bookmark'];
        }
        
        if (isset($bookmark['aliases'])) {
            $result['aliases'] = $bookmark['aliases'];
        }
        
        if (isset($bookmark['basemap'])) {
            $result['basemap'] = $bookmark['basemap'];
        }
        
        if (isset($bookmark['layers'])) {
            $result['layers'] = $bookmark['layers'];
        }
        
        if (isset($bookmark['theme'])) {
            $result['theme'] = $bookmark['theme'];
        }
        
        if (isset($bookmark['subtheme'])) {
            $result['subtheme'] = $bookmark['subtheme'];
        }
        
        return $result;
    }
    
    /**
     * Listet alle verfügbaren Bookmark-Namen auf
     * 
     * @return array Liste aller Namen inkl. Aliases
     */
    public static function listAllNames() {
        $bookmarks = self::loadBookmarks();
        $names = [];
        
        foreach ($bookmarks as $bookmark) {
            if (isset($bookmark['map-bookmark'])) {
                $names[] = $bookmark['map-bookmark'];
            }
            
            if (isset($bookmark['aliases']) && is_array($bookmark['aliases'])) {
                $names = array_merge($names, $bookmark['aliases']);
            }
        }
        
        return array_unique($names);
    }
}

// API Handler
try {
    $name = $_GET['name'] ?? $_GET['bookmark'] ?? '';
    
    // Listet alle Bookmarks auf wenn kein Name angegeben
    if (empty($name)) {
        $allNames = BookmarkService::listAllNames();
        echo json_encode([
            'success' => true,
            'available_bookmarks' => $allNames,
            'count' => count($allNames),
            'usage' => 'Add ?name=bookmark_name to get specific bookmark'
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
        exit;
    }
    
    // Suche nach Bookmark
    $bookmark = BookmarkService::findBookmark($name);
    
    if ($bookmark !== null) {
        echo json_encode([
            'success' => true,
            'bookmark' => $bookmark
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    } else {
        // Kein 404 senden - JSON-API gibt immer 200 mit success:false zurück
        echo json_encode([
            'success' => false,
            'error' => 'Bookmark not found',
            'requested' => $name
        ], JSON_PRETTY_PRINT);
    }
    
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => 'Internal server error',
        'message' => $e->getMessage()
    ], JSON_PRETTY_PRINT);
}
