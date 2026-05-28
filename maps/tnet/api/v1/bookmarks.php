<?php
/**
 * TNET API v1 - Bookmarks Endpoint
 *
 * Liefert Karten-Bookmarks (vorkonfigurierte Kartenansichten) im Schema v2.
 * v1-Daten in der Quelldatei werden zur Laufzeit normalisiert
 * (siehe BookmarkNormalizer).
 *
 * Verwendung:
 *   GET /api/v1/bookmarks.php           -> Liste aller Bookmarks (id, name?, aliases?)
 *   GET /api/v1/bookmarks.php?name=xxx  -> Einzelner Bookmark als v2-Objekt
 *
 * @version    2.0
 * @date       2026-05-27
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

require_once __DIR__ . '/../includes/ApiResponse.php';
require_once __DIR__ . '/../includes/CacheHelper.php';
require_once __DIR__ . '/../includes/BookmarkNormalizer.php';

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

if (!is_array($bookmarks)) {
    ApiResponse::serverError('Bookmarks file is not a JSON array');
}

// === Caching ===
CacheHelper::setNoCache();
CacheHelper::handleLastModified($bookmarksFile);

// === Parameter ===
$name = $_GET['name'] ?? $_GET['bookmark'] ?? null;

// === Einzelner Bookmark ===
if ($name !== null) {
    $found = BookmarkNormalizer::findByName($bookmarks, (string)$name);

    if ($found !== null) {
        ApiResponse::success($found);
    } else {
        ApiResponse::notFound("Bookmark '{$name}'");
    }
}

// === Alle Bookmarks auflisten (v2-Style) ===
$listing = [];
foreach ($bookmarks as $bookmark) {
    if (!is_array($bookmark)) continue;

    // id aus v2 oder v1 ableiten
    $id = $bookmark['id'] ?? ($bookmark['map-bookmark'] ?? null);
    if (!$id) continue;

    $entry = ['id' => $id];
    if (!empty($bookmark['name'])) {
        $entry['name'] = $bookmark['name'];
    }
    if (!empty($bookmark['aliases']) && is_array($bookmark['aliases'])) {
        $entry['aliases'] = array_values($bookmark['aliases']);
    }
    $listing[] = $entry;
}

$meta = [
    'count' => count($listing),
    'usage' => 'GET /api/v1/bookmarks.php?name=bookmark_id_or_alias',
    'schemaVersion' => 2
];

ApiResponse::success($listing, $meta);
