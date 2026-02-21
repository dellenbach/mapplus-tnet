<?php
/**
 * TNET API v1 - Bookmarks Endpoint
 * 
 * Liefert Karten-Bookmarks (vorkonfigurierte Kartenansichten).
 * Refactored aus bookmark-service.php mit API-Wrapper.
 * 
 * Verwendung:
 *   GET /api/v1/bookmarks.php           → Liste aller Bookmark-Namen
 *   GET /api/v1/bookmarks.php?name=xxx  → Einzelner Bookmark
 * 
 * @version    1.0
 * @date       2026-02-20
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

require_once __DIR__ . '/../includes/ApiResponse.php';
require_once __DIR__ . '/../includes/CacheHelper.php';

// Standard API Headers
ApiResponse::setHeaders();

// === Bookmarks-Datei laden ===
$bookmarksFile = realpath(__DIR__ . '/../../data/map-bookmarks-all.json');

if (!$bookmarksFile || !file_exists($bookmarksFile)) {
    ApiResponse::notFound('Bookmarks data file');
}

$json = file_get_contents($bookmarksFile);
$bookmarks = json_decode($json, true);

if (json_last_error() !== JSON_ERROR_NONE) {
    ApiResponse::serverError('Failed to parse bookmarks: ' . json_last_error_msg());
}

// === Caching ===
CacheHelper::setCacheControl(CacheHelper::DEFAULT_MAX_AGE);
CacheHelper::handleLastModified($bookmarksFile);

// === Parameter ===
$name = $_GET['name'] ?? $_GET['bookmark'] ?? null;

// === Einzelner Bookmark ===
if ($name !== null) {
    $name = trim($name);
    $found = findBookmark($bookmarks, $name);

    if ($found !== null) {
        ApiResponse::success($found);
    } else {
        ApiResponse::notFound("Bookmark '{$name}'");
    }
}

// === Alle Bookmarks auflisten ===
$allNames = [];
foreach ($bookmarks as $bookmark) {
    if (isset($bookmark['map-bookmark'])) {
        $entry = ['name' => $bookmark['map-bookmark']];
        if (isset($bookmark['aliases']) && !empty($bookmark['aliases'])) {
            $entry['aliases'] = $bookmark['aliases'];
        }
        $allNames[] = $entry;
    }
}

$meta = [
    'count' => count($allNames),
    'usage' => 'GET /api/v1/bookmarks.php?name=bookmark_name'
];

ApiResponse::success($allNames, $meta);

// =====================================================================
// Hilfsfunktionen
// =====================================================================

/**
 * Sucht Bookmark nach Name oder Alias
 * 
 * @param array  $bookmarks Alle Bookmarks
 * @param string $name      Gesuchter Name
 * @return array|null Gefundener Bookmark oder null
 */
function findBookmark($bookmarks, $name) {
    foreach ($bookmarks as $bookmark) {
        // Hauptname prüfen
        if (isset($bookmark['map-bookmark']) && $bookmark['map-bookmark'] === $name) {
            return formatBookmark($bookmark);
        }

        // Aliases prüfen
        if (isset($bookmark['aliases']) && is_array($bookmark['aliases'])) {
            if (in_array($name, $bookmark['aliases'], true)) {
                return formatBookmark($bookmark);
            }
        }
    }

    return null;
}

/**
 * Formatiert Bookmark (nur relevante Felder)
 * 
 * @param array $bookmark Original-Bookmark
 * @return array Bereinigte Daten
 */
function formatBookmark($bookmark) {
    $fields = ['map-bookmark', 'aliases', 'basemap', 'layers', 'theme', 'subtheme'];
    $result = [];

    foreach ($fields as $field) {
        if (isset($bookmark[$field])) {
            $result[$field] = $bookmark[$field];
        }
    }

    return $result;
}
