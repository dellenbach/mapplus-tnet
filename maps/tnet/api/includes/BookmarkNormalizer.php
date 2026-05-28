<?php
/**
 * BookmarkNormalizer - Normalisiert Bookmark-Daten auf Schema v2
 *
 * Spiegelt die Logik des Python-Migrationsskripts
 * (_scripts/_temp_bookmark_migration/migrate_bookmarks_v1_to_v2.py),
 * angewendet zur Laufzeit. Solange die Daten-Datei noch v1 ist, konvertiert
 * der Normalizer beim Lesen on-the-fly nach v2, damit die Clients immer ein
 * einheitliches Format bekommen.
 *
 * Schema-Definition: maps-dev/tnet/data/bookmark.schema.json
 *
 * Aliases werden 1:1 uebernommen (kritisch fuer Rueckwaertskompatibilitaet
 * von Fremdsystem-Links).
 *
 * @version    1.0
 * @date       2026-05-27
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

class BookmarkNormalizer {

    /**
     * Erkennt das Schema eines einzelnen Bookmarks.
     *
     * @return int 2 wenn v2 (hat 'id' und Layer-Objekte oder meta.schemaVersion=2),
     *             sonst 1
     */
    public static function detectVersion(array $bookmark): int {
        if (isset($bookmark['meta']['schemaVersion']) && (int)$bookmark['meta']['schemaVersion'] >= 2) {
            return 2;
        }
        if (isset($bookmark['id']) && !isset($bookmark['map-bookmark'])) {
            return 2;
        }
        $layers = $bookmark['layers'] ?? [];
        if (is_array($layers) && !empty($layers) && is_array($layers[0])) {
            return 2;
        }
        return 1;
    }

    /**
     * Normalisiert ein Bookmark auf v2.
     * v2-Bookmarks werden unveraendert zurueckgegeben (mit Layer-Defaults ergaenzt).
     */
    public static function normalize(array $bookmark): array {
        if (self::detectVersion($bookmark) === 2) {
            return self::completeV2($bookmark);
        }
        return self::convertV1ToV2($bookmark);
    }

    /**
     * Normalisiert eine ganze Liste.
     * @param array $bookmarks
     * @return array
     */
    public static function normalizeAll(array $bookmarks): array {
        $out = [];
        foreach ($bookmarks as $bm) {
            if (!is_array($bm)) continue;
            $out[] = self::normalize($bm);
        }
        return $out;
    }

    /**
     * Sucht ein Bookmark per id, altem map-bookmark-Feld oder Alias.
     * Liefert die normalisierte v2-Variante zurueck.
     *
     * @param array  $bookmarks Rohdaten (v1 oder v2 oder gemischt)
     * @param string $name      Gesuchter Identifier oder Alias
     * @return array|null
     */
    public static function findByName(array $bookmarks, string $name): ?array {
        $needle = trim($name);
        if ($needle === '') return null;

        foreach ($bookmarks as $bm) {
            if (!is_array($bm)) continue;

            // v2: 'id', v1: 'map-bookmark'
            $primary = $bm['id'] ?? ($bm['map-bookmark'] ?? null);
            if ($primary === $needle) {
                return self::normalize($bm);
            }

            $aliases = $bm['aliases'] ?? [];
            if (is_array($aliases) && in_array($needle, $aliases, true)) {
                return self::normalize($bm);
            }
        }
        return null;
    }

    // ----- intern -----

    private static function convertV1ToV2(array $bm): array {
        $out = [];

        $id = $bm['map-bookmark'] ?? '';
        $out['id'] = is_string($id) ? $id : '';

        if (!empty($bm['aliases']) && is_array($bm['aliases'])) {
            $out['aliases'] = array_values($bm['aliases']);
        }

        $out['basemap'] = isset($bm['basemap']) && is_string($bm['basemap']) && $bm['basemap'] !== ''
            ? $bm['basemap']
            : 'av_sw'; // Fallback (siehe Migrations-Skript)

        foreach (['theme', 'subtheme', 'themes'] as $f) {
            if (isset($bm[$f]) && $bm[$f] !== null && $bm[$f] !== '') {
                $out[$f] = $bm[$f];
            }
        }

        $viewport = [];
        foreach (['x', 'y', 'zoom'] as $vk) {
            if (isset($bm[$vk]) && is_numeric($bm[$vk])) {
                $viewport[$vk] = $bm[$vk] + 0; // int/float koerzieren
            }
        }
        if (!empty($viewport)) {
            $out['viewport'] = $viewport;
        }

        $topOpacity = (isset($bm['opacity']) && is_numeric($bm['opacity']))
            ? ($bm['opacity'] + 0) : null;

        $layers = [];
        $seen = [];
        $rawLayers = $bm['layers'] ?? [];
        if (is_array($rawLayers)) {
            foreach ($rawLayers as $lid) {
                if (!is_string($lid) || trim($lid) === '') continue;
                if (isset($seen[$lid])) continue;
                $seen[$lid] = true;
                $layers[] = [
                    'id'      => $lid,
                    'visible' => true,
                    'opacity' => $topOpacity, // top-level opacity auf alle mappen
                    'order'   => null,
                    'filter'  => null,
                ];
            }
        }
        $out['layers'] = $layers;

        $out['meta'] = ['schemaVersion' => 2];

        return $out;
    }

    /**
     * Ein v2-Bookmark mit Layer-Defaults ergaenzen
     * (kommt vor, wenn Editor unvollstaendige Eintraege schreibt).
     */
    private static function completeV2(array $bm): array {
        // 'meta' garantieren
        if (!isset($bm['meta']) || !is_array($bm['meta'])) {
            $bm['meta'] = [];
        }
        $bm['meta']['schemaVersion'] = 2;

        // Layer-Defaults vervollstaendigen
        if (isset($bm['layers']) && is_array($bm['layers'])) {
            $bm['layers'] = array_map([self::class, 'completeLayer'], $bm['layers']);
        } else {
            $bm['layers'] = [];
        }

        return $bm;
    }

    private static function completeLayer($layer): array {
        if (is_string($layer)) {
            // Falls einzelner v1-Layer in einem v2-Array auftaucht — robust handhaben
            return [
                'id' => $layer, 'visible' => true,
                'opacity' => null, 'order' => null, 'filter' => null
            ];
        }
        if (!is_array($layer)) {
            return ['id' => '', 'visible' => true, 'opacity' => null, 'order' => null, 'filter' => null];
        }
        return [
            'id'      => (string)($layer['id'] ?? ''),
            'visible' => array_key_exists('visible', $layer) ? (bool)$layer['visible'] : true,
            'opacity' => isset($layer['opacity']) && is_numeric($layer['opacity']) ? ($layer['opacity'] + 0) : null,
            'order'   => isset($layer['order']) && is_numeric($layer['order']) ? (int)$layer['order'] : null,
            'filter'  => isset($layer['filter']) && is_string($layer['filter']) && $layer['filter'] !== '' ? $layer['filter'] : null,
        ];
    }
}
