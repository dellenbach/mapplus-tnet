<?php
/**
 * LayerImporter - Full-Sync von Konfig-Dateien nach PostgreSQL
 * 
 * Liest layers_*.conf, lyrmgrResources_*.json, legendResources_*.json,
 * maptipsResources_*.json und lyrmgr.conf-Dateien und synchronisiert
 * sie vollständig in die mapplusconf-Tabellen.
 * 
 * Sync-Logik:
 *   - UPSERT: Neue/geänderte Einträge werden eingefügt/aktualisiert
 *   - DELETE: Einträge, die in den Dateien nicht mehr vorhanden sind,
 *             werden aus der DB gelöscht
 *   - Transaktional: Alles oder nichts pro Sync-Lauf
 *
 * @version    1.0
 * @date       2026-02-21
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/ConfigReader.php';

class LayerImporter {

    /** @var PDO */
    private $pdo;

    /** @var array Import-Statistik */
    private $stats = [
        'layers_upserted'   => 0,
        'layers_deleted'    => 0,
        'nodes_upserted'    => 0,
        'nodes_deleted'     => 0,
        'maptips_upserted'  => 0,
        'maptips_deleted'   => 0,
        'nls_upserted'      => 0,
        'nls_deleted'       => 0,
        'errors'            => [],
    ];

    /** @var int|null Import-Log-ID */
    private $logId = null;

    /** @var array|null Gecachte Basis-NLS-Labels (lyrmgrResources.json) */
    private $baseNls = null;

    public function __construct() {
        $this->pdo = Database::getConnection();
    }

    /**
     * Führt einen vollständigen Sync aller Daten durch
     * 
     * @return array Import-Statistik
     */
    public function fullSync(): array {
        $this->startLog('full');

        try {
            $this->pdo->beginTransaction();

            // 1. Layer-Definitionen aus layers_*.conf + NLS-Ressourcen
            $this->syncLayerDefinitions();

            // 2. Katalogbäume aus lyrmgr.conf (pro Profil)
            $this->syncCatalogNodes();

            // 3. MapTips aus maptipsResources_*.json
            $this->syncMaptips();

            // 4. Allgemeine NLS-Ressourcen
            $this->syncNlsResources();

            $this->pdo->commit();
            $this->finishLog('success');

        } catch (\Exception $e) {
            $this->pdo->rollBack();
            $this->stats['errors'][] = $e->getMessage();
            $this->finishLog('error');
            throw $e;
        }

        return $this->stats;
    }

    /**
     * Sync nur Layer-Definitionen (layers_*.conf + lyrmgrResources + legendResources)
     * 
     * @return array Import-Statistik
     */
    public function syncLayerDefinitions(): array {
        $coreConfig = ConfigReader::getCoreConfigPath();
        if (!$coreConfig) {
            $this->stats['errors'][] = 'core/config Pfad nicht gefunden';
            return $this->stats;
        }

        $nlsPath = $this->getNlsPath();

        // --- Alle layer_ids aus den Dateien sammeln ---
        $fileLayerIds = [];
        $layerFiles = glob($coreConfig . '/layers_*.conf');

        foreach ($layerFiles as $layerFile) {
            $sourceFile = basename($layerFile);
            $layers = ConfigReader::readConfFile($layerFile);
            if (!$layers || !is_array($layers)) {
                $this->stats['errors'][] = "Parse-Fehler: {$sourceFile}";
                continue;
            }

            // Zugehörige NLS-Dateien laden (Suffix-Matching)
            $suffix = $this->extractSuffix($sourceFile, 'layers_', '.conf');
            $lyrmgrNls  = $this->loadNlsFile($nlsPath, 'lyrmgrResources',  $suffix);
            $legendNls  = $this->loadNlsFile($nlsPath, 'legendResources',  $suffix);

            foreach ($layers as $layerId => $def) {
                $fileLayerIds[] = $layerId;
                $this->upsertLayerDefinition($layerId, $def, $lyrmgrNls, $legendNls, $sourceFile);
            }
        }

        // --- Verwaiste Einträge löschen ---
        if (!empty($fileLayerIds)) {
            $deleted = $this->deleteNotIn('layer_definition', 'layer_id', $fileLayerIds);
            $this->stats['layers_deleted'] = $deleted;
        }

        return $this->stats;
    }

    /**
     * Sync Katalogbäume aus lyrmgr.conf pro Profil
     * 
     * @return array Import-Statistik
     */
    public function syncCatalogNodes(): array {
        // Alle Profile laden
        $stmt = $this->pdo->query("SELECT id, code, source_path FROM mapplusconf.profile WHERE is_active = true");
        $profiles = $stmt->fetchAll();

        // Mapping laden
        $mapping = ConfigReader::readLyrmgrMapping();
        $categories = $mapping['categories'] ?? [];

        // Category-Mapping sicherstellen
        foreach ($categories as $idx => $cat) {
            $this->upsertCategoryMapping($cat, $idx + 1);
        }

        // Pro Profil: Katalogbaum synchronisieren
        foreach ($profiles as $profile) {
            $this->syncProfileCatalog($profile, $categories);
        }

        return $this->stats;
    }

    /**
     * Sync MapTips aus maptipsResources_*.json
     * 
     * @return array Import-Statistik
     */
    public function syncMaptips(): array {
        $nlsPath = $this->getNlsPath();
        if (!$nlsPath) return $this->stats;

        $allMaptipIds = [];
        $maptipFiles = glob($nlsPath . '/maptipsResources*.json');

        foreach ($maptipFiles as $file) {
            $sourceFile = basename($file);
            $data = ConfigReader::readConfFile($file);
            if (!$data || !is_array($data)) continue;

            foreach ($data as $key => $title) {
                $parsed = $this->parseMaptipKey($key);
                if (!$parsed) continue;

                $id = $this->upsertMaptip(
                    $parsed['layer_id'],
                    $parsed['rank'],
                    $parsed['parent_group_path'],
                    $title,
                    $sourceFile
                );
                if ($id) $allMaptipIds[] = $id;
            }
        }

        // Verwaiste MapTips löschen
        if (!empty($allMaptipIds)) {
            $deleted = $this->deleteNotIn('layer_maptip', 'id', $allMaptipIds);
            $this->stats['maptips_deleted'] = $deleted;
        }

        return $this->stats;
    }

    /**
     * Sync allgemeine NLS-Ressourcen (tools, disclaimer, editing, forms, shops, legend_base)
     * 
     * @return array Import-Statistik
     */
    public function syncNlsResources(): array {
        $nlsPath = $this->getNlsPath();
        if (!$nlsPath) return $this->stats;

        $nlsFiles = [
            'toolsResources.json'       => 'tools',
            'disclaimerResources.json'   => 'disclaimer',
            'editingResources.json'      => 'editing',
            'formsResources.json'        => 'forms',
            'shopsResources.json'        => 'shops',
            'legendResources.json'       => 'legend_base',
        ];

        $allKeys = [];

        foreach ($nlsFiles as $filename => $resourceType) {
            $filePath = $nlsPath . '/' . $filename;
            if (!file_exists($filePath)) continue;

            $data = ConfigReader::readConfFile($filePath);
            if (!$data || !is_array($data)) continue;

            foreach ($data as $key => $value) {
                if ($key === 'placeholder' || $key === '') continue;
                $this->upsertNlsResource($resourceType, $key, $value, $filename);
                $allKeys[] = $resourceType . '::' . $key;
            }
        }

        // Verwaiste NLS-Einträge löschen (nur für die bearbeiteten Typen)
        if (!empty($allKeys)) {
            $types = array_unique(array_values($nlsFiles));
            $this->deleteOrphanedNls($types, $allKeys);
        }

        return $this->stats;
    }

    // =========================================================================
    // Private Hilfsmethoden
    // =========================================================================

    /**
     * UPSERT einer Layer-Definition
     */
    private function upsertLayerDefinition(
        string $layerId,
        array  $def,
        array  $lyrmgrNls,
        array  $legendNls,
        string $sourceFile
    ): void {
        // Display-Name aus NLS (Prefix desc_)
        $displayName = $lyrmgrNls['desc_' . $layerId] ?? null;
        // Auch Gross-/Kleinschreibungsvarianten probieren
        if (!$displayName) {
            foreach ($lyrmgrNls as $k => $v) {
                if (strcasecmp($k, 'desc_' . $layerId) === 0) {
                    $displayName = $v;
                    break;
                }
            }
        }

        // Legendentitel + Link aus NLS (Postfix _title/_link)
        $legendTitle = $legendNls[$layerId . '_title'] ?? null;
        $legendLink  = $legendNls[$layerId . '_link']  ?? null;
        // Auch mit legend-Key probieren
        $legendKey = $def['legend'] ?? null;
        if (!$legendTitle && $legendKey) {
            $legendTitle = $legendNls[$legendKey . '_title'] ?? null;
            $legendLink  = $legendNls[$legendKey . '_link']  ?? $legendLink;
        }

        $sql = "
            INSERT INTO mapplusconf.layer_definition (
                layer_id, display_name, layer_type, url, icon, icon_style,
                legend_key, legend_title, legend_link,
                rank, min_resolution, max_resolution, opacity, visible,
                searchable, attr_editable, url_capabilities,
                params, options, source_file
            ) VALUES (
                :layer_id, :display_name, :layer_type, :url, :icon, :icon_style,
                :legend_key, :legend_title, :legend_link,
                :rank, :min_resolution, :max_resolution, :opacity, :visible,
                :searchable, :attr_editable, :url_capabilities,
                :params, :options, :source_file
            )
            ON CONFLICT (layer_id) DO UPDATE SET
                display_name     = EXCLUDED.display_name,
                layer_type       = EXCLUDED.layer_type,
                url              = EXCLUDED.url,
                icon             = EXCLUDED.icon,
                icon_style       = EXCLUDED.icon_style,
                legend_key       = EXCLUDED.legend_key,
                legend_title     = EXCLUDED.legend_title,
                legend_link      = EXCLUDED.legend_link,
                rank             = EXCLUDED.rank,
                min_resolution   = EXCLUDED.min_resolution,
                max_resolution   = EXCLUDED.max_resolution,
                opacity          = EXCLUDED.opacity,
                visible          = EXCLUDED.visible,
                searchable       = EXCLUDED.searchable,
                attr_editable    = EXCLUDED.attr_editable,
                url_capabilities = EXCLUDED.url_capabilities,
                params           = EXCLUDED.params,
                options          = EXCLUDED.options,
                source_file      = EXCLUDED.source_file,
                updated_at       = now()
        ";

        $opacity = $def['opacity'] ?? ($def['options']['opacity'] ?? 1.0);

        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([
            'layer_id'         => $layerId,
            'display_name'     => $displayName,
            'layer_type'       => $def['type'] ?? 'WMS',
            'url'              => $def['url'] ?? null,
            'icon'             => $def['icon'] ?? null,
            'icon_style'       => $def['icon_style'] ?? null,
            'legend_key'       => $legendKey,
            'legend_title'     => $legendTitle,
            'legend_link'      => $legendLink,
            'rank'             => $def['rank'] ?? 1,
            'min_resolution'   => $def['minResolution'] ?? null,
            'max_resolution'   => $def['maxResolution'] ?? null,
            'opacity'          => $opacity,
            'visible'          => ($def['visible'] ?? 0) ? 'true' : 'false',
            'searchable'       => ($def['searchable'] ?? 0) ? 'true' : 'false',
            'attr_editable'    => ($def['attr_editable'] ?? 0) ? 'true' : 'false',
            'url_capabilities' => $def['urlcapabilities'] ?? null,
            'params'           => json_encode($def['params'] ?? new \stdClass()),
            'options'          => json_encode($def['options'] ?? new \stdClass()),
            'source_file'      => $sourceFile,
        ]);

        $this->stats['layers_upserted']++;
    }

    /**
     * UPSERT Category-Mapping
     */
    private function upsertCategoryMapping(array $cat, int $sortIdx): void {
        $sql = "
            INSERT INTO mapplusconf.category_mapping (category_key, lyrmgr_key, label, icon, sort_idx)
            VALUES (:key, :lyrmgr, :label, :icon, :sort)
            ON CONFLICT (category_key) DO UPDATE SET
                lyrmgr_key = EXCLUDED.lyrmgr_key,
                label      = EXCLUDED.label,
                icon       = EXCLUDED.icon,
                sort_idx   = EXCLUDED.sort_idx,
                updated_at = now()
        ";
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([
            'key'    => $cat['id'],
            'lyrmgr' => $cat['lyrmgr'],
            'label'  => $cat['name'],
            'icon'   => $cat['icon'] ?? null,
            'sort'   => $sortIdx,
        ]);
    }

    /**
     * Sync Katalogbaum für ein bestimmtes Profil
     */
    private function syncProfileCatalog(array $profile, array $categories): void {
        $profileId = $profile['id'];

        // lyrmgr.conf für dieses Profil laden
        $lyrmgr = ConfigReader::readLyrmgrConf($profile['code']);
        if (!$lyrmgr) {
            // Kein eigenes lyrmgr.conf → Fallback auf public behalten (Nodes nicht löschen)
            return;
        }

        // Alle aktuellen Node-PKs für dieses Profil sammeln
        $currentNodePks = [];

        // Kategorie-Mapping: lyrmgr_key → category_id
        $catMap = [];
        $stmt = $this->pdo->query("SELECT id, lyrmgr_key FROM mapplusconf.category_mapping");
        foreach ($stmt->fetchAll() as $row) {
            $catMap[$row['lyrmgr_key']] = $row['id'];
        }

        foreach ($categories as $cat) {
            $lyrmgrKey = $cat['lyrmgr'];
            $categoryId = $catMap[$lyrmgrKey] ?? null;
            if (!$categoryId) continue;

            $lyrmgrBlock = $lyrmgr[$lyrmgrKey] ?? null;
            if (!$lyrmgrBlock || !isset($lyrmgrBlock['structure'])) continue;

            $structure = $lyrmgrBlock['structure'];
            $sortIdx = 0;

            foreach ($structure as $subKey => $subData) {
                $sortIdx++;
                $pks = $this->upsertCatalogSubtree(
                    $profileId, $categoryId, null, $subKey, $subData, $sortIdx, ''
                );
                $currentNodePks = array_merge($currentNodePks, $pks);
            }
        }

        // Verwaiste Nodes für dieses Profil löschen
        if (!empty($currentNodePks)) {
            $placeholders = implode(',', array_fill(0, count($currentNodePks), '?'));
            $stmt = $this->pdo->prepare(
                "DELETE FROM mapplusconf.catalog_node 
                 WHERE profile_id = ? AND node_pk NOT IN ({$placeholders})"
            );
            $params = array_merge([$profileId], $currentNodePks);
            $stmt->execute($params);
            $this->stats['nodes_deleted'] += $stmt->rowCount();
        }
    }

    /**
     * Rekursiver UPSERT eines Katalog-Teilbaums
     * 
     * @return array Alle erzeugten/aktualisierten node_pk-Werte
     */
    private function upsertCatalogSubtree(
        int     $profileId,
        int     $categoryId,
        ?int    $parentPk,
        string  $sourceId,
        array   $nodeData,
        int     $sortIdx,
        string  $pathPrefix
    ): array {
        $pks = [];

        $displayName  = $nodeData['name'] ?? ucwords(str_replace('_', ' ', $sourceId));
        $nodeKind     = isset($nodeData['items']) ? 'group' : 'layer';
        $openFlag     = $nodeData['open'] ?? false;

        // NLS-Lookup für Subcategories und Groups (desc_<sourceId>)
        if ($nodeKind !== 'layer') {
            $nlsLabel = $this->getBaseNlsLabel($sourceId);
            if ($nlsLabel) {
                $displayName = $nlsLabel;
            } elseif (strpos($sourceId, '/') !== false) {
                // Pfad-basierte ID → letztes Segment lesbar formatieren
                $parts = explode('/', $sourceId);
                $last = end($parts);
                $displayName = ucwords(str_replace('_', ' ', $last));
            }
        } elseif (strpos($sourceId, '/') !== false) {
            // Leaf-Layer mit Pfad: letztes Segment verwenden
            $parts = explode('/', $sourceId);
            $last = end($parts);
            $displayName = ucwords(str_replace('_', ' ', $last));
        }
        $selectAll    = $nodeData['selectAll'] ?? null;
        $icon         = $nodeData['icon'] ?? ($nodeData['iconClass'] ?? null);
        $iconStyle    = $nodeData['icon_style'] ?? null;
        $legend       = $nodeData['legend'] ?? null;
        $pathText     = $pathPrefix ? ($pathPrefix . ' > ' . $displayName) : $displayName;

        // Layer-ID: Bei Leaf-Nodes ist sourceId der Layer-Key
        $layerId = ($nodeKind === 'layer') ? $sourceId : null;

        // Node-Kind für Subcategories differenzieren
        if ($parentPk === null && isset($nodeData['items'])) {
            $nodeKind = 'subcategory';
        }

        // UPSERT basierend auf (profile_id, source_id, parent_node_pk)
        $nodePk = $this->upsertCatalogNode(
            $profileId, $categoryId, $parentPk, $nodeKind,
            $sourceId, $displayName, $openFlag, $selectAll,
            $icon, $iconStyle, $legend, $sortIdx, $pathText, $layerId
        );
        $pks[] = $nodePk;
        $this->stats['nodes_upserted']++;

        // Kinder rekursiv verarbeiten + Layer-IDs für Coalesce-Analyse sammeln
        $childLayerIds = []; // Sammelt die layer_ids aller direkten Kind-Layer
        if (isset($nodeData['items']) && is_array($nodeData['items'])) {
            $childIdx = 0;
            foreach ($nodeData['items'] as $childKey => $childData) {
                $childIdx++;
                if (is_string($childData)) {
                    // Einfache Layer-Referenz (String) — lesbaren Namen aus letztem Pfad-Segment
                    $leafParts = explode('/', $childData);
                    $leafName = ucwords(str_replace('_', ' ', end($leafParts)));
                    $childPks = $this->upsertCatalogSubtree(
                        $profileId, $categoryId, $nodePk,
                        $childData, ['name' => $leafName],
                        $childIdx, $pathText
                    );
                    $pks = array_merge($pks, $childPks);
                    $childLayerIds[] = $childData; // Layer-ID für Coalesce
                } elseif (is_array($childData) && isset($childData['name'])) {
                    // Benannter Node (Gruppe oder Layer mit Metadaten)
                    $childSourceId = $childData['name'];
                    $childPks = $this->upsertCatalogSubtree(
                        $profileId, $categoryId, $nodePk,
                        $childSourceId, $childData, $childIdx, $pathText
                    );
                    $pks = array_merge($pks, $childPks);
                    // Nur wenn es ein einfacher Layer ist (kein items)
                    if (!isset($childData['items'])) {
                        $childLayerIds[] = $childSourceId;
                    }
                } elseif (is_array($childData) && isset($childData['items'])) {
                    // Gruppe mit numerischem Key
                    $childSourceId = is_string($childKey) ? $childKey : ('group_' . $childIdx);
                    $childPks = $this->upsertCatalogSubtree(
                        $profileId, $categoryId, $nodePk,
                        $childSourceId, $childData, $childIdx, $pathText
                    );
                    $pks = array_merge($pks, $childPks);
                }
            }
        }

        // Coalesce-Analyse: Haben alle direkten Kind-Layer die gleiche URL?
        // Nur für ArcGIS-MapServer-Dienste relevant (serviceUrl enthält "MapServer").
        // WMS-Dienste (Geoadmin etc.) haben zwar gleiche Basis-URL, sind aber
        // keine Coalesce-Kandidaten — client-seitig nicht kombinierbar.
        if ($nodeKind !== 'layer' && count($childLayerIds) >= 2) {
            try {
                $coalesceInfo = $this->analyzeCoalesceGroup($childLayerIds);
                if ($coalesceInfo['serviceUrl'] &&
                    stripos($coalesceInfo['serviceUrl'], 'MapServer') !== false) {
                    // Gruppen-Node mit service_url und coalesce_group aktualisieren
                    $updCoalesce = $this->pdo->prepare("
                        UPDATE mapplusconf.catalog_node
                        SET service_url = ?, coalesce_group = ?
                        WHERE node_pk = ?
                    ");
                    $updCoalesce->execute([
                        $coalesceInfo['serviceUrl'],
                        $coalesceInfo['coalesceGroup'],
                        $nodePk
                    ]);
                }
            } catch (\Throwable $e) {
                // Coalesce-Analyse nicht fatal — Gruppe funktioniert auch ohne
                $this->stats['errors'][] = 'Coalesce-Analyse für ' . $sourceId . ': ' . $e->getMessage();
            }
        }

        return $pks;
    }

    /**
     * UPSERT eines einzelnen Katalog-Knotens
     * 
     * @return int node_pk des eingefügten/aktualisierten Knotens
     */
    private function upsertCatalogNode(
        int     $profileId,
        int     $categoryId,
        ?int    $parentPk,
        string  $nodeKind,
        string  $sourceId,
        string  $displayName,
        bool    $openFlag,
        ?bool   $selectAll,
        ?string $icon,
        ?string $iconStyle,
        ?string $legend,
        int     $sortIdx,
        string  $pathText,
        ?string $layerId,
        ?string $serviceUrl = null,
        ?string $coalesceGroup = null
    ): int {
        // Prüfe ob FK layer_id existiert
        if ($layerId) {
            $chk = $this->pdo->prepare(
                "SELECT 1 FROM mapplusconf.layer_definition WHERE layer_id = ?"
            );
            $chk->execute([$layerId]);
            if (!$chk->fetch()) {
                $layerId = null; // FK würde verletzen → NULL setzen
            }
        }

        // Suche existierenden Node
        if ($parentPk !== null) {
            $find = $this->pdo->prepare(
                "SELECT node_pk FROM mapplusconf.catalog_node 
                 WHERE profile_id = ? AND source_id = ? AND parent_node_pk = ?"
            );
            $find->execute([$profileId, $sourceId, $parentPk]);
        } else {
            $find = $this->pdo->prepare(
                "SELECT node_pk FROM mapplusconf.catalog_node 
                 WHERE profile_id = ? AND source_id = ? AND parent_node_pk IS NULL AND category_id = ?"
            );
            $find->execute([$profileId, $sourceId, $categoryId]);
        }

        $existing = $find->fetch();

        if ($existing) {
            // UPDATE
            $upd = $this->pdo->prepare("
                UPDATE mapplusconf.catalog_node SET
                    category_id = ?, node_kind = ?, display_name = ?,
                    open_flag = ?, select_all = ?, icon = ?, icon_style = ?,
                    legend = ?, sort_idx = ?, path_text = ?, layer_id = ?,
                    service_url = ?, coalesce_group = ?,
                    updated_at = now()
                WHERE node_pk = ?
            ");
            $upd->execute([
                $categoryId, $nodeKind, $displayName,
                $openFlag ? 'true' : 'false',
                $selectAll !== null ? ($selectAll ? 'true' : 'false') : null,
                $icon, $iconStyle, $legend, $sortIdx, $pathText, $layerId,
                $serviceUrl, $coalesceGroup,
                $existing['node_pk']
            ]);
            return (int) $existing['node_pk'];

        } else {
            // INSERT
            $ins = $this->pdo->prepare("
                INSERT INTO mapplusconf.catalog_node (
                    profile_id, category_id, parent_node_pk, node_kind,
                    source_id, display_name, open_flag, select_all,
                    icon, icon_style, legend, sort_idx, path_text, layer_id,
                    service_url, coalesce_group
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                RETURNING node_pk
            ");
            $ins->execute([
                $profileId, $categoryId, $parentPk, $nodeKind,
                $sourceId, $displayName,
                $openFlag ? 'true' : 'false',
                $selectAll !== null ? ($selectAll ? 'true' : 'false') : null,
                $icon, $iconStyle, $legend, $sortIdx, $pathText, $layerId,
                $serviceUrl, $coalesceGroup
            ]);
            $row = $ins->fetch();
            return (int) $row['node_pk'];
        }
    }

    /**
     * UPSERT eines MapTip-Eintrags
     * 
     * @return int|null ID bei Erfolg
     */
    private function upsertMaptip(
        string  $layerId,
        ?int    $rank,
        ?string $parentGroupPath,
        string  $title,
        string  $sourceFile
    ): ?int {
        // Prüfe ob layer_id existiert
        $chk = $this->pdo->prepare(
            "SELECT 1 FROM mapplusconf.layer_definition WHERE layer_id = ?"
        );
        $chk->execute([$layerId]);
        if (!$chk->fetch()) {
            return null; // Layer existiert nicht → Skip
        }

        $sql = "
            INSERT INTO mapplusconf.layer_maptip (layer_id, rank, parent_group_path, title, source_file)
            VALUES (:lid, :rank, :pgp, :title, :sf)
            ON CONFLICT (layer_id, rank, parent_group_path) DO UPDATE SET
                title       = EXCLUDED.title,
                source_file = EXCLUDED.source_file,
                updated_at  = now()
            RETURNING id
        ";
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([
            'lid'   => $layerId,
            'rank'  => $rank,
            'pgp'   => $parentGroupPath,
            'title' => $title,
            'sf'    => $sourceFile,
        ]);
        $row = $stmt->fetch();
        $this->stats['maptips_upserted']++;
        return $row ? (int) $row['id'] : null;
    }

    /**
     * UPSERT einer NLS-Ressource
     */
    private function upsertNlsResource(string $type, string $key, string $value, string $sourceFile): void {
        $sql = "
            INSERT INTO mapplusconf.nls_resource (resource_type, key, value, source_file)
            VALUES (:type, :key, :value, :sf)
            ON CONFLICT (resource_type, key) DO UPDATE SET
                value       = EXCLUDED.value,
                source_file = EXCLUDED.source_file,
                updated_at  = now()
        ";
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([
            'type'  => $type,
            'key'   => $key,
            'value' => $value,
            'sf'    => $sourceFile,
        ]);
        $this->stats['nls_upserted']++;
    }

    /**
     * Löscht Einträge aus einer Tabelle, die NICHT in der übergebenen ID-Liste vorkommen
     * 
     * @return int Anzahl gelöschter Zeilen
     */
    private function deleteNotIn(string $table, string $column, array $ids): int {
        if (empty($ids)) return 0;

        // Batch-weise, um riesige IN-Listen zu vermeiden
        $batchSize = 5000;
        $chunks = array_chunk(array_unique($ids), $batchSize);

        // Temporäre Tabelle für die IDs (ohne Schema-Prefix, da TEMP)
        $tmpTable = '_tmp_keep_' . $table;
        $this->pdo->exec("CREATE TEMP TABLE IF NOT EXISTS {$tmpTable} (keep_id TEXT PRIMARY KEY)");
        $this->pdo->exec("TRUNCATE {$tmpTable}");

        $ins = $this->pdo->prepare("INSERT INTO {$tmpTable} (keep_id) VALUES (?) ON CONFLICT DO NOTHING");
        foreach ($ids as $id) {
            $ins->execute([$id]);
        }

        $stmt = $this->pdo->prepare(
            "DELETE FROM mapplusconf.{$table} 
             WHERE {$column}::text NOT IN (SELECT keep_id FROM {$tmpTable})"
        );
        $stmt->execute();
        return $stmt->rowCount();
    }

    /**
     * Löscht verwaiste NLS-Einträge (nur für bestimmte Typen)
     */
    private function deleteOrphanedNls(array $types, array $allKeys): void {
        $typePlaceholders = implode(',', array_fill(0, count($types), '?'));
        $stmt = $this->pdo->prepare(
            "SELECT id, resource_type, key FROM mapplusconf.nls_resource 
             WHERE resource_type IN ({$typePlaceholders})"
        );
        $stmt->execute($types);

        $toDelete = [];
        foreach ($stmt->fetchAll() as $row) {
            $compositeKey = $row['resource_type'] . '::' . $row['key'];
            if (!in_array($compositeKey, $allKeys)) {
                $toDelete[] = $row['id'];
            }
        }

        if (!empty($toDelete)) {
            $placeholders = implode(',', array_fill(0, count($toDelete), '?'));
            $del = $this->pdo->prepare(
                "DELETE FROM mapplusconf.nls_resource WHERE id IN ({$placeholders})"
            );
            $del->execute($toDelete);
            $this->stats['nls_deleted'] = count($toDelete);
        }
    }

    // =========================================================================
    // Parsing-Hilfsmethoden
    // =========================================================================

    /**
     * Extrahiert Suffix aus einem Dateinamen
     * z.B. extractSuffix('layers_TNET_awu_AWU_EIGENTUM.conf', 'layers_', '.conf')
     *   → 'TNET_awu_AWU_EIGENTUM'
     */
    private function extractSuffix(string $filename, string $prefix, string $extension): string {
        $name = basename($filename);
        if (strpos($name, $prefix) === 0) {
            $name = substr($name, strlen($prefix));
        }
        $extPos = strrpos($name, $extension);
        if ($extPos !== false) {
            $name = substr($name, 0, $extPos);
        }
        return $name;
    }

    /**
     * Lädt eine NLS-Datei anhand des Typs und Suffix
     * z.B. loadNlsFile($path, 'lyrmgrResources', 'TNET_awu_AWU_EIGENTUM')
     *   → lädt lyrmgrResources_TNET_awu_AWU_EIGENTUM.json
     */
    private function loadNlsFile(string $nlsPath, string $type, string $suffix): array {
        $file = $nlsPath . '/' . $type . '_' . $suffix . '.json';
        if (!file_exists($file)) {
            // Auch Basis-Datei (ohne Suffix) probieren
            $baseFile = $nlsPath . '/' . $type . '.json';
            if (file_exists($baseFile)) {
                return ConfigReader::readConfFile($baseFile) ?: [];
            }
            return [];
        }
        return ConfigReader::readConfFile($file) ?: [];
    }

    /**
     * Parst einen MapTip-Key
     * Muster: <layer_id>_<rank>_grp_<parent_path>_title
     *      oder: <layer_id>_<rank>_title
     * 
     * @return array|null ['layer_id', 'rank', 'parent_group_path']
     */
    private function parseMaptipKey(string $key): ?array {
        // Muster 1: ..._{rank}_grp_{parent}_title
        if (preg_match('/^(.+?)_(\d+)_grp_(.+)_title$/', $key, $m)) {
            return [
                'layer_id'           => $m[1],
                'rank'               => (int) $m[2],
                'parent_group_path'  => $m[3],
            ];
        }

        // Muster 2: ..._{rank}_title
        if (preg_match('/^(.+?)_(\d+)_title$/', $key, $m)) {
            return [
                'layer_id'           => $m[1],
                'rank'               => (int) $m[2],
                'parent_group_path'  => null,
            ];
        }

        return null;
    }

    /**
      * Ermittelt den Basis-NLS-Pfad der aktiven Umgebung.
     */
    private function getNlsPath(): ?string {
          return ConfigReader::getCoreNlsPath('de');
    }

    /**
      * Ermittelt den app-lokalen Override-NLS-Pfad.
     */
    private function getNlsOverridePath(): ?string {
          $path = TnetCorePaths::getAppCoreNlsPath('de');
        $basePath = $this->getNlsPath();
        // Nur zurückgeben wenn es ein anderes Verzeichnis ist als die Basis
        if ($path && is_dir($path) && $path !== $basePath) {
            return $path;
        }
        return null;
    }

    /**
     * Lädt und cached ALLE NLS-Labels (lyrmgrResources*.json) aus Basis + Override.
     * Basis: /www/core/nls/de/ (alle dienst-spezifischen Dateien)
     * Override: /www/maps/core/nls/de/ (Überladungen, überschreibt gleichnamige Keys)
     * 
     * @param string $key  Schlüssel (z.B. 'grundlagen', 'gis_oereb/nw_nutzungsplanung_def')
     * @return string|null NLS-Label oder null
     */
    private function getBaseNlsLabel(string $key): ?string {
        if ($this->baseNls === null) {
            $this->baseNls = [];
            // Basis: alle lyrmgrResources_*.json laden
            $nlsPath = $this->getNlsPath();
            if ($nlsPath) {
                foreach (glob($nlsPath . '/lyrmgrResources*.json') as $f) {
                    $data = json_decode(file_get_contents($f), true);
                    if (is_array($data)) {
                        $this->baseNls = array_merge($this->baseNls, $data);
                    }
                }
            }
            // Override: gleichnamige Keys überschreiben
            $overridePath = $this->getNlsOverridePath();
            if ($overridePath) {
                foreach (glob($overridePath . '/lyrmgrResources*.json') as $f) {
                    $data = json_decode(file_get_contents($f), true);
                    if (is_array($data)) {
                        $this->baseNls = array_merge($this->baseNls, $data);
                    }
                }
            }
        }
        return $this->baseNls['desc_' . $key] ?? null;
    }

    // =========================================================================
    // Coalesce-Analyse
    // =========================================================================

    /**
     * Prüft ob alle übergebenen Kind-Layer die gleiche MapServer-URL haben.
     * Falls ja, wird die gemeinsame URL und ein abgeleiteter Coalesce-Key
     * zurückgegeben; andernfalls null-Werte.
     *
     * @param  string[] $childLayerIds  Layer-IDs der direkten Kind-Layer
     * @return array{serviceUrl: ?string, coalesceGroup: ?string}
     */
    private function analyzeCoalesceGroup(array $childLayerIds): array
    {
        $result = ['serviceUrl' => null, 'coalesceGroup' => null];

        if (count($childLayerIds) < 2) {
            return $result;
        }

        // URLs aller Kind-Layer aus layer_definition abfragen
        $placeholders = implode(',', array_fill(0, count($childLayerIds), '?'));
        $stmt = $this->pdo->prepare("
            SELECT layer_id, url
            FROM mapplusconf.layer_definition
            WHERE layer_id IN ($placeholders)
        ");
        $stmt->execute(array_values($childLayerIds));
        $rows = $stmt->fetchAll(\PDO::FETCH_KEY_PAIR);  // layer_id => url

        // Nur weitermachen wenn wirklich alle Kind-Layer gefunden wurden
        if (count($rows) < count($childLayerIds)) {
            return $result;
        }

        // Basis-URLs extrahieren (ohne query_layers-Parameter etc.)
        $baseUrls = [];
        foreach ($rows as $layerId => $url) {
            if ($url === null || $url === '') {
                return $result; // Keine URL → kein Coalesce möglich
            }
            $base = $this->extractServiceBaseUrl($url);
            if ($base === null) {
                return $result; // Nicht parsebar → kein Coalesce
            }
            $baseUrls[$layerId] = $base;
        }

        // Prüfe ob alle Basis-URLs identisch sind
        $uniqueUrls = array_unique(array_values($baseUrls));
        if (count($uniqueUrls) !== 1) {
            return $result; // Verschiedene Services → kein Coalesce
        }

        $commonUrl = $uniqueUrls[0];
        $coalesceKey = $this->extractCoalesceKey($commonUrl);

        $result['serviceUrl']     = $commonUrl;
        $result['coalesceGroup']  = $coalesceKey;
        return $result;
    }

    /**
     * Extrahiert die Basis-URL eines MapServer-Dienstes.
     * Entfernt query_layers, show-Parameter und Trailing-Slashes.
     *
     * Beispiel: "/maps-dev/tnet/agsproxy/gis_basis/nw_basisplan_gis_dynamisch/MapServer"
     *        → "/maps-dev/tnet/agsproxy/gis_basis/nw_basisplan_gis_dynamisch/MapServer"
     *         (Prefix /maps/ bzw. /maps-dev/ wird aus der Eingabe-URL übernommen)
     *
     * @param  string $url  Volle URL aus layer_definition
     * @return string|null  Basis-URL oder null falls nicht parsebar
     */
    private function extractServiceBaseUrl(?string $url): ?string
    {
        if ($url === null || $url === '') return null;
        // Clean-URL: /maps/tnet/agsproxy/.../MapServer[/...]
        if (preg_match('#(tnet/agsproxy/[^?]+/MapServer)#i', $url, $m)) {
            // Pfad bis /MapServer extrahieren, ohne Sublayer-IDs
            $base = preg_replace('#/MapServer/.*$#i', '/MapServer', $m[0]);
            // Vollständigen Pfad mit App-Root-Prefix zurückgeben (/maps oder /maps-dev)
            $pos = strpos($url, $base);
            if ($pos !== false) {
                return substr($url, 0, $pos) . $base;
            }
            return TnetCorePaths::getAppBasePath() . '/' . $base;
        }
        // Legacy AGS-Proxy-URLs: agsproxy.php?path=.../MapServer[/...]
        if (preg_match('#(agsproxy\.php\?path=[^&]+/MapServer)#i', $url, $m)) {
            return $m[1];
        }
        // Direkte ArcGIS-URLs: https://.../MapServer[/...]
        if (preg_match('#(https?://[^?]+/MapServer)#i', $url, $m)) {
            return $m[1];
        }
        // WMS-URLs: alles vor dem ?
        if (preg_match('#^(https?://[^?]+)\?#', $url, $m)) {
            return $m[1];
        }
        return null;
    }

    /**
     * Extrahiert einen kurzen, lesbaren Coalesce-Key aus einer MapServer-URL.
     *
     * Beispiel: "/maps/tnet/agsproxy/gis_basis/nw_basisplan_gis_dynamisch/MapServer"
     *        → "nw_basisplan_gis_dynamisch"
     *
     * @param  string $url  Basis-URL des MapServer-Dienstes
     * @return string       Coalesce-Key (Service-Name)
     */
    private function extractCoalesceKey(string $url): string
    {
        // Versuch: letztes Pfad-Segment vor /MapServer
        if (preg_match('#/([^/]+)/MapServer#i', $url, $m)) {
            return $m[1];
        }
        // Fallback: MD5-Hash der URL (eindeutig, aber weniger lesbar)
        return 'coalesce_' . substr(md5($url), 0, 8);
    }

    // =========================================================================
    // Import-Logging
    // =========================================================================

    private function startLog(string $sourceType): void {
        $stmt = $this->pdo->prepare(
            "INSERT INTO mapplusconf.import_log (source_type) VALUES (?) RETURNING id"
        );
        $stmt->execute([$sourceType]);
        $row = $stmt->fetch();
        $this->logId = $row ? (int) $row['id'] : null;
    }

    private function finishLog(string $status): void {
        if (!$this->logId) return;

        $stmt = $this->pdo->prepare("
            UPDATE mapplusconf.import_log SET
                finished_at      = now(),
                status           = ?,
                records_upserted = ?,
                records_deleted  = ?,
                errors           = ?::jsonb,
                details          = ?::jsonb
            WHERE id = ?
        ");
        $stmt->execute([
            $status,
            $this->stats['layers_upserted'] + $this->stats['nodes_upserted'] + $this->stats['maptips_upserted'] + $this->stats['nls_upserted'],
            $this->stats['layers_deleted'] + $this->stats['nodes_deleted'] + $this->stats['maptips_deleted'] + $this->stats['nls_deleted'],
            json_encode($this->stats['errors']),
            json_encode($this->stats),
            $this->logId,
        ]);
    }

    /**
     * Liefert die Import-Statistik
     */
    public function getStats(): array {
        return $this->stats;
    }
}
