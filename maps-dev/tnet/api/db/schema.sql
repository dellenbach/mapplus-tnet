-- ============================================================================
-- MAP+ Layer-Konfigurations-Datenbank
-- Schema: mapplusconf
-- 
-- Zweck:  Zentrale Ablage aller Layer-Definitionen, Katalogstruktur,
--         Anzeigenamen, Legenden und MapTip-Titel für die MAP+ API.
--         Ersetzt das dateibasierte Parsing von layers_*.conf,
--         lyrmgrResources_*.json, legendResources_*.json und
--         maptipsResources_*.json zur Laufzeit.
--
-- Version: 1.0
-- Datum:   2026-02-21
-- Autor:   Marco Dellenbach / Trigonet AG
-- ============================================================================

-- Schema anlegen
CREATE SCHEMA IF NOT EXISTS mapplusconf;

SET search_path TO mapplusconf, public;

-- ============================================================================
-- 1. PROFILE
-- Repräsentiert ein Benutzerprofil / eine Anwendungssicht.
-- Jedes Profil kann eine eigene Katalogstruktur (lyrmgr.conf) haben.
-- Beispiele: public (Standard), marco, uwpro, nwpro, owpro
-- ============================================================================
CREATE TABLE IF NOT EXISTS mapplusconf.profile (
    id              SERIAL PRIMARY KEY,
    code            TEXT NOT NULL UNIQUE,          -- z.B. 'public', 'marco'
    display_name    TEXT,                          -- z.B. 'Standard', 'Marco Dellenbach'
    is_active       BOOLEAN NOT NULL DEFAULT true,
    source_path     TEXT,                          -- z.B. 'maps/public/config'
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  mapplusconf.profile IS 'Benutzerprofile / Anwendungssichten mit eigener Katalogstruktur';
COMMENT ON COLUMN mapplusconf.profile.code IS 'Eindeutiger Profilschlüssel, entspricht dem Verzeichnisnamen unter maps/public/config/ oder maps/tnet/';
COMMENT ON COLUMN mapplusconf.profile.source_path IS 'Dateisystem-Pfad zur Profil-Konfiguration (lyrmgr.conf)';

-- Seed: Bekannte Profile
INSERT INTO mapplusconf.profile (code, display_name, source_path) VALUES
    ('public', 'Standard (öffentlich)',  'maps/public/config'),
    ('marco',  'Marco',                 'maps/public/config/marco'),
    ('uwpro',  'Umwelt Professional',   'maps/public/config/uwpro'),
    ('nwpro',  'Nidwalden Professional', 'maps/public/config/nwpro'),
    ('owpro',  'Obwalden Professional',  'maps/public/config/owpro')
ON CONFLICT (code) DO NOTHING;


-- ============================================================================
-- 2. CATEGORY_MAPPING
-- Zuordnung der Top-Level-Kategorien im Layermanager zu den lyrmgr-Keys.
-- Quelle: maps/tnet/php/lyrmgr-mapping.json
-- ============================================================================
CREATE TABLE IF NOT EXISTS mapplusconf.category_mapping (
    id              SERIAL PRIMARY KEY,
    category_key    TEXT NOT NULL UNIQUE,          -- z.B. 'nidwalden', 'obwalden'
    lyrmgr_key      TEXT NOT NULL,                 -- z.B. 'main_lyrmgr', 'second_lyrmgr'
    label           TEXT NOT NULL,                 -- Anzeigename, z.B. 'Nidwalden'
    icon            TEXT,                          -- CSS-Klasse, z.B. 'njsCategoryIcon8'
    sort_idx        SMALLINT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  mapplusconf.category_mapping IS 'Top-Level-Kategorien im Layermanager (Nidwalden, Obwalden, Bund, Weitere)';
COMMENT ON COLUMN mapplusconf.category_mapping.lyrmgr_key IS 'Schlüssel in lyrmgr.conf (main_lyrmgr, second_lyrmgr, ...)';

-- Seed: Kategorien aus lyrmgr-mapping.json
INSERT INTO mapplusconf.category_mapping (category_key, lyrmgr_key, label, icon, sort_idx) VALUES
    ('nidwalden', 'main_lyrmgr',   'Nidwalden', 'njsCategoryIcon8', 1),
    ('obwalden',  'second_lyrmgr', 'Obwalden',  'njsCategoryIcon8', 2),
    ('bund',      'third_lyrmgr',  'Bund',      'njsCategoryIcon5', 3),
    ('weitere',   'forth_lyrmgr',  'Weitere',   'njsCategoryIcon7', 4)
ON CONFLICT (category_key) DO NOTHING;


-- ============================================================================
-- 3. LAYER_DEFINITION
-- Zentrale Layer-Definition. Global eindeutig über layer_id.
-- Vereint Daten aus:
--   - layers_*.conf       → technische Felder (url, type, params, options, ...)
--   - lyrmgrResources     → display_name (Prefix desc_)
--   - legendResources     → legend_title (_title), legend_link (_link)
-- ============================================================================
CREATE TABLE IF NOT EXISTS mapplusconf.layer_definition (
    layer_id            TEXT PRIMARY KEY,              -- z.B. 'awu/awu_eigentum/abwasser_plan_eigentum'
    display_name        TEXT,                          -- aus lyrmgrResources: desc_<layer_id>
    layer_type          TEXT NOT NULL DEFAULT 'WMS',   -- WMS, WMTS, arcgisRest, ...
    url                 TEXT,                          -- Service-URL
    icon                TEXT,                          -- Icon-Pfad/URL
    icon_style          TEXT,                          -- CSS für Icon (z.B. 'width:18px;height:18px')
    legend_key          TEXT,                          -- Legendenschlüssel aus layers_*.conf (.legend)
    legend_title        TEXT,                          -- aus legendResources: <layer_id>_title
    legend_link         TEXT,                          -- aus legendResources: <layer_id>_link
    rank                SMALLINT DEFAULT 1,            -- Darstellungsreihenfolge
    min_resolution      NUMERIC,                      -- Untere Massstabgrenze
    max_resolution      NUMERIC,                      -- Obere Massstabgrenze
    opacity             NUMERIC DEFAULT 1.0,           -- Transparenz (0.0 - 1.0)
    visible             BOOLEAN DEFAULT false,         -- Standard-Sichtbarkeit
    searchable          BOOLEAN DEFAULT false,         -- FeatureInfo-fähig
    attr_editable       BOOLEAN DEFAULT false,         -- Attribute editierbar
    url_capabilities    TEXT,                          -- WMTS Capabilities URL
    params              JSONB DEFAULT '{}'::jsonb,     -- Request-Params (LAYERS, DPI, Time, format, ...)
    options             JSONB DEFAULT '{}'::jsonb,     -- Client-Optionen (projection, singleTile, isBaseLayer, ...)
    source_file         TEXT,                          -- Quelldatei für Rückverfolgung
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  mapplusconf.layer_definition IS 'Zentrale Layer-Definition mit allen technischen und beschreibenden Feldern';
COMMENT ON COLUMN mapplusconf.layer_definition.layer_id IS 'Primärschlüssel = Layer-ID aus layers_*.conf (z.B. awu/awu_eigentum/...)';
COMMENT ON COLUMN mapplusconf.layer_definition.display_name IS 'Anzeigename aus lyrmgrResources_*.json, Key-Muster: desc_<layer_id>';
COMMENT ON COLUMN mapplusconf.layer_definition.layer_type IS 'Diensttyp: WMS, WMTS, arcgisRest';
COMMENT ON COLUMN mapplusconf.layer_definition.legend_key IS 'Legendenschlüssel aus layers_*.conf Feld "legend"';
COMMENT ON COLUMN mapplusconf.layer_definition.legend_title IS 'Legendentitel aus legendResources_*.json, Key-Muster: <layer_id>_title';
COMMENT ON COLUMN mapplusconf.layer_definition.legend_link IS 'Legenden-URL aus legendResources_*.json, Key-Muster: <layer_id>_link';
COMMENT ON COLUMN mapplusconf.layer_definition.params IS 'Request-Parameter als JSONB (LAYERS, DPI, Time, format, transparent, ...)';
COMMENT ON COLUMN mapplusconf.layer_definition.options IS 'Client-Optionen als JSONB (projection, singleTile, isBaseLayer, opacity, ...)';
COMMENT ON COLUMN mapplusconf.layer_definition.source_file IS 'Quelldatei für Import-Rückverfolgung (z.B. layers_TNET_awu_AWU_EIGENTUM.conf)';

-- Indexe für häufige Abfragen
CREATE INDEX IF NOT EXISTS idx_layer_def_type        ON mapplusconf.layer_definition (layer_type);
CREATE INDEX IF NOT EXISTS idx_layer_def_searchable  ON mapplusconf.layer_definition (searchable) WHERE searchable = true;
CREATE INDEX IF NOT EXISTS idx_layer_def_source      ON mapplusconf.layer_definition (source_file);
CREATE INDEX IF NOT EXISTS idx_layer_def_params      ON mapplusconf.layer_definition USING GIN (params);
CREATE INDEX IF NOT EXISTS idx_layer_def_options     ON mapplusconf.layer_definition USING GIN (options);


-- ============================================================================
-- 4. CATALOG_NODE
-- Profilbezogene Baumstruktur des Layermanagers.
-- Quelle: lyrmgr.conf pro Profil (structure → Subcategories → Groups → Items).
-- ============================================================================
CREATE TABLE IF NOT EXISTS mapplusconf.catalog_node (
    node_pk         SERIAL PRIMARY KEY,
    profile_id      INTEGER NOT NULL REFERENCES mapplusconf.profile(id) ON DELETE CASCADE,
    category_id     INTEGER REFERENCES mapplusconf.category_mapping(id),
    parent_node_pk  INTEGER REFERENCES mapplusconf.catalog_node(node_pk) ON DELETE CASCADE,
    node_kind       TEXT NOT NULL CHECK (node_kind IN ('group', 'layer', 'subcategory')),
    source_id       TEXT,                          -- Original-ID aus lyrmgr.conf (z.B. 'oereb_raumplanung')
    display_name    TEXT,                          -- Angezigter Name (aus lyrmgr.conf Node oder NLS)
    open_flag       BOOLEAN DEFAULT false,         -- Standardmässig geöffnet
    select_all      BOOLEAN,                      -- selectAll aus lyrmgr.conf
    icon            TEXT,                          -- Node-spezifisches Icon (aus lyrmgr.conf)
    icon_style      TEXT,                          -- Node-spezifisches Icon-CSS
    legend          TEXT,                          -- Node-spezifische Legende (aus lyrmgr.conf)
    sort_idx        INTEGER NOT NULL DEFAULT 0,    -- Sortierung innerhalb Parent
    path_text       TEXT,                          -- Materialisierter Pfad für Flat-Output (z.B. 'ÖREB > Raumplanung')
    layer_id        TEXT REFERENCES mapplusconf.layer_definition(layer_id) ON DELETE SET NULL,
    -- Coalesce-Felder: Dienst-Gruppierung für kombinierten MapServer-Request
    service_url     TEXT,                          -- MapServer-URL auf Gruppen-Ebene (wenn alle Kinder gleiche URL)
    coalesce_group  TEXT,                          -- Coalesce-Schlüssel (z.B. 'nw_basisplan_gis_dynamisch')
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  mapplusconf.catalog_node IS 'Hierarchische Katalogstruktur pro Profil (Baum des Layermanagers)';
COMMENT ON COLUMN mapplusconf.catalog_node.node_kind IS 'Knotentyp: group (Ordner), layer (Blatt), subcategory (Unterkategorie)';
COMMENT ON COLUMN mapplusconf.catalog_node.source_id IS 'Original-ID/Name aus lyrmgr.conf';
COMMENT ON COLUMN mapplusconf.catalog_node.layer_id IS 'FK auf layer_definition – nur bei node_kind=layer gesetzt';
COMMENT ON COLUMN mapplusconf.catalog_node.path_text IS 'Materialisierter Breadcrumb-Pfad für Flat-Ausgabe';
COMMENT ON COLUMN mapplusconf.catalog_node.select_all IS 'selectAll-Flag aus lyrmgr.conf (Gruppe komplett an/aus)';
COMMENT ON COLUMN mapplusconf.catalog_node.service_url IS 'MapServer-URL auf Gruppen-Ebene (alle Kinder teilen diese URL)';
COMMENT ON COLUMN mapplusconf.catalog_node.coalesce_group IS 'Coalesce-Schlüssel: Gruppen mit gleichem Key werden zu einem Request zusammengefasst';

-- Indexe für Katalogabfragen
CREATE INDEX IF NOT EXISTS idx_catalog_tree          ON mapplusconf.catalog_node (profile_id, category_id, parent_node_pk, sort_idx);
CREATE INDEX IF NOT EXISTS idx_catalog_kind          ON mapplusconf.catalog_node (profile_id, category_id, node_kind);
CREATE INDEX IF NOT EXISTS idx_catalog_source_id     ON mapplusconf.catalog_node (profile_id, source_id);
CREATE INDEX IF NOT EXISTS idx_catalog_layer_id      ON mapplusconf.catalog_node (layer_id);
CREATE INDEX IF NOT EXISTS idx_catalog_coalesce      ON mapplusconf.catalog_node (coalesce_group) WHERE coalesce_group IS NOT NULL;


-- ============================================================================
-- 5. LAYER_MAPTIP
-- MapTip/FeatureInfo-Titel pro Layer und Kontext.
-- Quelle: maptipsResources_*.json
-- Key-Pattern: <layer_id>_<rank>_grp_<parent_path>_title
-- ============================================================================
CREATE TABLE IF NOT EXISTS mapplusconf.layer_maptip (
    id                  SERIAL PRIMARY KEY,
    layer_id            TEXT NOT NULL REFERENCES mapplusconf.layer_definition(layer_id) ON DELETE CASCADE,
    rank                INTEGER,                       -- Rank aus dem Composite-Key
    parent_group_path   TEXT,                          -- _grp_-Kontext (z.B. 'awu/awu_eigentum/abwasser_plan_eigentum')
    title               TEXT NOT NULL,                 -- Aufgelöster MapTip-Titel
    source_file         TEXT,                          -- Quelldatei
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    UNIQUE (layer_id, rank, parent_group_path)
);

COMMENT ON TABLE  mapplusconf.layer_maptip IS 'MapTip/FeatureInfo-Titel pro Layer und Kontext (1:N)';
COMMENT ON COLUMN mapplusconf.layer_maptip.rank IS 'Darstellungs-Rank (aus dem Composite-Key der maptipsResources)';
COMMENT ON COLUMN mapplusconf.layer_maptip.parent_group_path IS 'Elterngruppen-Kontext (_grp_-Teil des Keys)';

CREATE INDEX IF NOT EXISTS idx_maptip_layer ON mapplusconf.layer_maptip (layer_id, rank);


-- ============================================================================
-- 6. NLS_RESOURCE
-- Auffangtabelle für nicht-layerspezifische Übersetzungen.
-- Quellen: toolsResources.json, disclaimerResources.json,
--          editingResources.json, formsResources.json, shopsResources.json,
--          legendResources.json (Basis-Keys wie symbols_*)
-- ============================================================================
CREATE TABLE IF NOT EXISTS mapplusconf.nls_resource (
    id              SERIAL PRIMARY KEY,
    resource_type   TEXT NOT NULL,                  -- 'tools', 'disclaimer', 'editing', 'forms', 'shops', 'legend_base'
    key             TEXT NOT NULL,                  -- Original-Key aus JSON
    value           TEXT NOT NULL,                  -- Übersetzter Text
    source_file     TEXT,                           -- Quelldatei
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    UNIQUE (resource_type, key)
);

COMMENT ON TABLE  mapplusconf.nls_resource IS 'Nicht-layerspezifische NLS-Ressourcen (Tools, Disclaimer, Editing, etc.)';

CREATE INDEX IF NOT EXISTS idx_nls_type_key ON mapplusconf.nls_resource (resource_type, key);


-- ============================================================================
-- 7. IMPORT_LOG
-- Protokollierung der Sync-/Import-Läufe für Nachvollziehbarkeit.
-- ============================================================================
CREATE TABLE IF NOT EXISTS mapplusconf.import_log (
    id              SERIAL PRIMARY KEY,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at     TIMESTAMPTZ,
    status          TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'error')),
    source_type     TEXT,                          -- 'layers_conf', 'lyrmgr_conf', 'nls_resources', 'full'
    files_processed INTEGER DEFAULT 0,
    records_upserted INTEGER DEFAULT 0,
    records_deleted INTEGER DEFAULT 0,
    errors          JSONB DEFAULT '[]'::jsonb,     -- Array von Fehlermeldungen
    details         JSONB DEFAULT '{}'::jsonb      -- Zusätzliche Infos
);

COMMENT ON TABLE mapplusconf.import_log IS 'Protokoll der Daten-Synchronisierungsläufe';


-- ============================================================================
-- MIGRATIONEN: Spalten nachträglich hinzufügen (für bestehende Installationen)
-- ALTER TABLE ... ADD COLUMN IF NOT EXISTS ist idempotent (PostgreSQL 9.6+)
-- WICHTIG: Muss VOR den Views stehen, da Views diese Spalten referenzieren!
-- ============================================================================

-- 2024-06: Coalesce-Felder für Dienst-Gruppierung
ALTER TABLE mapplusconf.catalog_node ADD COLUMN IF NOT EXISTS service_url TEXT;
ALTER TABLE mapplusconf.catalog_node ADD COLUMN IF NOT EXISTS coalesce_group TEXT;
CREATE INDEX IF NOT EXISTS idx_catalog_coalesce ON mapplusconf.catalog_node (coalesce_group) WHERE coalesce_group IS NOT NULL;


-- ============================================================================
-- VIEWS: Häufig benötigte Abfragen vorformuliert
-- ============================================================================

-- View: Vollständige Layer-Info (für API details=true)
CREATE OR REPLACE VIEW mapplusconf.v_layer_full AS
SELECT
    ld.layer_id,
    ld.display_name,
    ld.layer_type,
    ld.url,
    ld.icon,
    ld.icon_style,
    ld.legend_key,
    ld.legend_title,
    ld.legend_link,
    ld.rank,
    ld.min_resolution,
    ld.max_resolution,
    ld.opacity,
    ld.visible,
    ld.searchable,
    ld.attr_editable,
    ld.url_capabilities,
    ld.params,
    ld.options,
    ld.source_file,
    ld.updated_at,
    -- Aggregierte MapTip-Titel
    COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'rank', mt.rank,
                'parentGroup', mt.parent_group_path,
                'title', mt.title
            )
        ) FILTER (WHERE mt.id IS NOT NULL),
        '[]'::jsonb
    ) AS maptips
FROM mapplusconf.layer_definition ld
LEFT JOIN mapplusconf.layer_maptip mt ON mt.layer_id = ld.layer_id
GROUP BY ld.layer_id;

COMMENT ON VIEW mapplusconf.v_layer_full IS 'Vollständige Layer-Info mit aggregierten MapTips für API-Einzelabfragen';


-- View: Katalogbaum mit Layer-Details (für API tree + details)
CREATE OR REPLACE VIEW mapplusconf.v_catalog_tree AS
SELECT
    cn.node_pk,
    cn.profile_id,
    p.code          AS profile_code,
    cn.category_id,
    cm.category_key,
    cm.label        AS category_label,
    cn.parent_node_pk,
    cn.node_kind,
    cn.source_id,
    cn.display_name AS node_name,
    cn.open_flag,
    cn.select_all,
    cn.sort_idx,
    cn.path_text,
    cn.layer_id,
    cn.service_url,
    cn.coalesce_group,
    -- Layer-Details (NULL für Gruppen)
    ld.display_name AS layer_display_name,
    ld.layer_type,
    ld.url,
    ld.icon         AS layer_icon,
    ld.legend_title,
    ld.legend_link,
    ld.opacity,
    ld.visible,
    ld.searchable,
    ld.rank,
    ld.min_resolution,
    ld.max_resolution,
    ld.params,
    ld.options
FROM mapplusconf.catalog_node cn
JOIN mapplusconf.profile p          ON p.id = cn.profile_id
LEFT JOIN mapplusconf.category_mapping cm ON cm.id = cn.category_id
LEFT JOIN mapplusconf.layer_definition ld ON ld.layer_id = cn.layer_id
ORDER BY cn.profile_id, cn.category_id, cn.sort_idx;

COMMENT ON VIEW mapplusconf.v_catalog_tree IS 'Katalogbaum mit Layer-Details für API tree-Output';


-- ============================================================================
-- FUNKTIONEN
-- ============================================================================

-- Rekursive Funktion: Gesamter Teilbaum eines Knotens
CREATE OR REPLACE FUNCTION mapplusconf.get_subtree(p_node_pk INTEGER)
RETURNS TABLE (
    node_pk         INTEGER,
    parent_node_pk  INTEGER,
    node_kind       TEXT,
    source_id       TEXT,
    display_name    TEXT,
    layer_id        TEXT,
    depth           INTEGER
) AS $$
    WITH RECURSIVE tree AS (
        SELECT 
            cn.node_pk,
            cn.parent_node_pk,
            cn.node_kind,
            cn.source_id,
            cn.display_name,
            cn.layer_id,
            0 AS depth
        FROM mapplusconf.catalog_node cn
        WHERE cn.node_pk = p_node_pk
        
        UNION ALL
        
        SELECT 
            cn.node_pk,
            cn.parent_node_pk,
            cn.node_kind,
            cn.source_id,
            cn.display_name,
            cn.layer_id,
            t.depth + 1
        FROM mapplusconf.catalog_node cn
        JOIN tree t ON cn.parent_node_pk = t.node_pk
    )
    SELECT * FROM tree ORDER BY depth, node_pk;
$$ LANGUAGE SQL STABLE;

COMMENT ON FUNCTION mapplusconf.get_subtree IS 'Liefert den gesamten Teilbaum ab einem Knoten (rekursiv)';


-- Funktion: Katalogbaum für ein Profil als JSON
CREATE OR REPLACE FUNCTION mapplusconf.get_catalog_json(
    p_profile_code TEXT,
    p_category_key TEXT DEFAULT NULL,
    p_details      BOOLEAN DEFAULT false
)
RETURNS JSONB AS $$
DECLARE
    v_profile_id INTEGER;
    v_result     JSONB;
BEGIN
    SELECT id INTO v_profile_id 
    FROM mapplusconf.profile 
    WHERE code = p_profile_code AND is_active = true;
    
    IF v_profile_id IS NULL THEN
        -- Fallback auf 'public'
        SELECT id INTO v_profile_id 
        FROM mapplusconf.profile 
        WHERE code = 'public' AND is_active = true;
    END IF;
    
    IF v_profile_id IS NULL THEN
        RETURN '{"error": "Kein aktives Profil gefunden"}'::jsonb;
    END IF;

    -- Baue JSON-Katalog
    SELECT jsonb_agg(cat_obj ORDER BY sort_idx) INTO v_result
    FROM (
        SELECT 
            cm.sort_idx,
            jsonb_build_object(
                'id',    cm.category_key,
                'name',  cm.label,
                'icon',  cm.icon,
                'nodes', COALESCE(
                    (SELECT jsonb_agg(
                        mapplusconf._build_node_json(cn.node_pk, p_details)
                        ORDER BY cn.sort_idx
                    )
                    FROM mapplusconf.catalog_node cn
                    WHERE cn.profile_id = v_profile_id
                      AND cn.category_id = cm.id
                      AND cn.parent_node_pk IS NULL),
                    '[]'::jsonb
                )
            ) AS cat_obj
        FROM mapplusconf.category_mapping cm
        WHERE (p_category_key IS NULL OR cm.category_key = p_category_key)
        GROUP BY cm.id, cm.category_key, cm.label, cm.icon, cm.sort_idx
    ) sub;

    RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql STABLE;


-- Hilfsfunktion: Einzelnen Node als JSON (rekursiv)
CREATE OR REPLACE FUNCTION mapplusconf._build_node_json(
    p_node_pk INTEGER,
    p_details BOOLEAN DEFAULT false
)
RETURNS JSONB AS $$
DECLARE
    v_node   RECORD;
    v_result JSONB;
    v_children JSONB;
BEGIN
    SELECT * INTO v_node FROM mapplusconf.catalog_node WHERE node_pk = p_node_pk;
    
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    -- Basis-Objekt
    v_result := jsonb_build_object(
        'id',   COALESCE(v_node.source_id, v_node.layer_id, v_node.node_pk::text),
        'name', v_node.display_name,
        'type', v_node.node_kind
    );

    -- open-Flag
    IF v_node.open_flag THEN
        v_result := v_result || jsonb_build_object('open', true);
    END IF;

    -- Layer-Details bei Bedarf
    IF p_details AND v_node.layer_id IS NOT NULL THEN
        SELECT v_result || jsonb_build_object(
            'url',            ld.url,
            'layerType',      ld.layer_type,
            'displayName',    ld.display_name,
            'icon',           ld.icon,
            'legendTitle',    ld.legend_title,
            'legendLink',     ld.legend_link,
            'opacity',        ld.opacity,
            'visible',        ld.visible,
            'searchable',     ld.searchable,
            'rank',           ld.rank,
            'minResolution',  ld.min_resolution,
            'maxResolution',  ld.max_resolution,
            'params',         ld.params,
            'options',        ld.options
        ) INTO v_result
        FROM mapplusconf.layer_definition ld
        WHERE ld.layer_id = v_node.layer_id;
    END IF;

    -- Kinder rekursiv
    SELECT jsonb_agg(
        mapplusconf._build_node_json(cn.node_pk, p_details)
        ORDER BY cn.sort_idx
    ) INTO v_children
    FROM mapplusconf.catalog_node cn
    WHERE cn.parent_node_pk = p_node_pk;

    IF v_children IS NOT NULL THEN
        v_result := v_result || jsonb_build_object('layers', v_children);
    END IF;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION mapplusconf.get_catalog_json IS 'Liefert den Katalogbaum als JSON für ein Profil, optional gefiltert nach Kategorie und mit Layer-Details';
COMMENT ON FUNCTION mapplusconf._build_node_json IS 'Hilfsfunktion: Baut einen einzelnen Katalogknoten rekursiv als JSON auf';


-- ============================================================================
-- UPDATE-Trigger: updated_at automatisch setzen
-- ============================================================================
CREATE OR REPLACE FUNCTION mapplusconf.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_profile_updated      ON mapplusconf.profile;
DROP TRIGGER IF EXISTS trg_category_updated     ON mapplusconf.category_mapping;
DROP TRIGGER IF EXISTS trg_layer_def_updated    ON mapplusconf.layer_definition;
DROP TRIGGER IF EXISTS trg_catalog_node_updated ON mapplusconf.catalog_node;
DROP TRIGGER IF EXISTS trg_layer_maptip_updated ON mapplusconf.layer_maptip;
DROP TRIGGER IF EXISTS trg_nls_resource_updated ON mapplusconf.nls_resource;

CREATE TRIGGER trg_profile_updated         BEFORE UPDATE ON mapplusconf.profile          FOR EACH ROW EXECUTE FUNCTION mapplusconf.set_updated_at();
CREATE TRIGGER trg_category_updated        BEFORE UPDATE ON mapplusconf.category_mapping FOR EACH ROW EXECUTE FUNCTION mapplusconf.set_updated_at();
CREATE TRIGGER trg_layer_def_updated       BEFORE UPDATE ON mapplusconf.layer_definition FOR EACH ROW EXECUTE FUNCTION mapplusconf.set_updated_at();
CREATE TRIGGER trg_catalog_node_updated    BEFORE UPDATE ON mapplusconf.catalog_node     FOR EACH ROW EXECUTE FUNCTION mapplusconf.set_updated_at();
CREATE TRIGGER trg_layer_maptip_updated    BEFORE UPDATE ON mapplusconf.layer_maptip     FOR EACH ROW EXECUTE FUNCTION mapplusconf.set_updated_at();
CREATE TRIGGER trg_nls_resource_updated    BEFORE UPDATE ON mapplusconf.nls_resource     FOR EACH ROW EXECUTE FUNCTION mapplusconf.set_updated_at();


-- ============================================================================
-- TABELLE: ags_import_history — Import-Audit-Log für AGS-Dienste
-- Jeder Import-Lauf erzeugt eine Zeile pro Dienst (volle Historie)
-- ============================================================================
CREATE TABLE IF NOT EXISTS mapplusconf.ags_import_history (
    id              SERIAL       PRIMARY KEY,
    service_name    TEXT         NOT NULL,       -- z.B. "ewn/ewn_nis_gwr"
    hash            TEXT,                        -- Hash vom AGS-Service zum Zeitpunkt des Imports
    published_at    TEXT,                        -- Publikationszeitpunkt (von GAPI)
    published_by    TEXT,                        -- Publiziert durch (von GAPI)
    imported_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ags_import_svc
    ON mapplusconf.ags_import_history (service_name, imported_at DESC);

COMMENT ON TABLE mapplusconf.ags_import_history
    IS 'Audit-Log: Jeder AGS-Import-Lauf erzeugt eine Zeile pro Dienst. Ermöglicht Hash-Vergleich und Zeitverlauf.';


-- ============================================================================
-- 8. BOOKMARK (Pilot-Domain für DB-first-Konfiguration)
-- Ersetzt die dateibasierte map-bookmarks-all.json. Jede Zeile ist ein
-- Bookmark (Lesezeichen) mit JSONB-Payload nach bookmark.schema.json (v2).
-- Optimistic Locking über `version`; Soft-Delete über `deleted`.
-- ============================================================================
CREATE TABLE IF NOT EXISTS mapplusconf.bookmark (
    bookmark_id     TEXT PRIMARY KEY,              -- id aus bookmark.schema.json
    name            TEXT,                          -- Anzeigename (denormalisiert für Listen)
    payload         JSONB NOT NULL DEFAULT '{}'::jsonb, -- vollständiges Bookmark-Objekt (v2)
    sort_idx        INTEGER NOT NULL DEFAULT 0,    -- Reihenfolge in der Liste
    version         INTEGER NOT NULL DEFAULT 1,    -- Optimistic-Lock-Zähler
    deleted         BOOLEAN NOT NULL DEFAULT false,-- Soft-Delete
    updated_by      TEXT,                          -- letzter Bearbeiter
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  mapplusconf.bookmark IS 'Bookmarks/Lesezeichen (ersetzt map-bookmarks-all.json) mit Optimistic Locking';
COMMENT ON COLUMN mapplusconf.bookmark.payload IS 'Vollständiges Bookmark-Objekt als JSONB nach bookmark.schema.json (v2)';
COMMENT ON COLUMN mapplusconf.bookmark.version IS 'Optimistic-Lock-Version; bei jeder Speicherung +1';
COMMENT ON COLUMN mapplusconf.bookmark.deleted IS 'Soft-Delete-Flag (Eintrag bleibt für Historie/Restore erhalten)';

CREATE INDEX IF NOT EXISTS idx_bookmark_active   ON mapplusconf.bookmark (sort_idx) WHERE deleted = false;
CREATE INDEX IF NOT EXISTS idx_bookmark_payload  ON mapplusconf.bookmark USING GIN (payload);


-- ============================================================================
-- 9. BOOKMARK_HISTORY
-- Vollständige Änderungshistorie für Diff und Restore. Eine Zeile pro
-- Speicher-/Lösch-Aktion mit dem jeweiligen Payload-Stand.
-- ============================================================================
CREATE TABLE IF NOT EXISTS mapplusconf.bookmark_history (
    id              SERIAL PRIMARY KEY,
    bookmark_id     TEXT NOT NULL,                 -- kein FK: Historie überlebt Hard-Delete
    version         INTEGER NOT NULL,              -- Versionsstand dieser Zeile
    action          TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete', 'restore', 'publish', 'checkout')),
    payload         JSONB,                         -- Payload-Stand nach der Aktion
    changed_by      TEXT,                          -- Bearbeiter
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  mapplusconf.bookmark_history IS 'Änderungshistorie der Bookmarks für Diff und Restore';
COMMENT ON COLUMN mapplusconf.bookmark_history.action IS 'Art der Änderung: create, update, delete, restore, publish, checkout';

CREATE INDEX IF NOT EXISTS idx_bookmark_hist_id ON mapplusconf.bookmark_history (bookmark_id, version DESC);


-- ============================================================================
-- 10. BOOKMARK_LOCK
-- Soft-Lock (UI-Hinweis) für kontrolliertes gleichzeitiges Arbeiten.
-- Nicht verbindlich erzwungen – verhindert Kollisionen via UI + Optimistic Lock.
-- ============================================================================
CREATE TABLE IF NOT EXISTS mapplusconf.bookmark_lock (
    scope           TEXT PRIMARY KEY,              -- Lock-Bereich (z.B. 'bookmarks' für globalen Editier-Lock)
    locked_by       TEXT NOT NULL,                 -- Person, die den Lock hält
    locked_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL           -- automatische Freigabe nach Ablauf
);

COMMENT ON TABLE  mapplusconf.bookmark_lock IS 'Soft-Lock (UI-Hinweis) für gleichzeitiges Bearbeiten der Bookmarks';
COMMENT ON COLUMN mapplusconf.bookmark_lock.scope IS 'Lock-Bereich; aktuell globaler Scope "bookmarks"';
COMMENT ON COLUMN mapplusconf.bookmark_lock.expires_at IS 'Ablaufzeitpunkt; abgelaufene Locks gelten als frei';

-- updated_at-Trigger für bookmark
DROP TRIGGER IF EXISTS trg_bookmark_updated ON mapplusconf.bookmark;
CREATE TRIGGER trg_bookmark_updated BEFORE UPDATE ON mapplusconf.bookmark FOR EACH ROW EXECUTE FUNCTION mapplusconf.set_updated_at();


-- ============================================================================
-- 11. BOOKMARK_META
-- Sammlungsweiter Revisions-Zähler für Optimistic Locking. Der SLM-Editor
-- speichert immer die ganze Liste; `revision` wird bei jedem Save erhöht und
-- als Konflikt-Token an den Client zurückgegeben.
-- ============================================================================
CREATE TABLE IF NOT EXISTS mapplusconf.bookmark_meta (
    scope           TEXT PRIMARY KEY,              -- aktuell globaler Scope 'bookmarks'
    revision        INTEGER NOT NULL DEFAULT 1,    -- steigt bei jeder Speicherung
    updated_by      TEXT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  mapplusconf.bookmark_meta IS 'Sammlungsweiter Revisions-Zähler für Optimistic Locking der Bookmarks';

INSERT INTO mapplusconf.bookmark_meta (scope, revision) VALUES ('bookmarks', 1)
ON CONFLICT (scope) DO NOTHING;


-- ============================================================================
-- GRANTS: API-Benutzer (read-only) und Import-Benutzer (read-write)
-- Diese Rollen müssen ggf. angepasst oder erstellt werden.
-- ============================================================================
-- DO $$
-- BEGIN
--     -- Read-only für API
--     IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mapplus_api') THEN
--         GRANT USAGE ON SCHEMA mapplusconf TO mapplus_api;
--         GRANT SELECT ON ALL TABLES IN SCHEMA mapplusconf TO mapplus_api;
--         GRANT SELECT ON ALL SEQUENCES IN SCHEMA mapplusconf TO mapplus_api;
--     END IF;
--
--     -- Read-write für Importer
--     IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mapplus_import') THEN
--         GRANT USAGE ON SCHEMA mapplusconf TO mapplus_import;
--         GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA mapplusconf TO mapplus_import;
--         GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA mapplusconf TO mapplus_import;
--     END IF;
-- END $$;


-- ============================================================================
-- 12. CATALOG_DOCUMENT (DB-first-Konfiguration für den Themenkatalog)
-- Ersetzt die dateibasierte lyrmgr.conf (Baumstruktur / Kategorien / Layer-
-- Zuordnung). Eine Zeile pro Profil; die komplette lyrmgr.conf steht als
-- JSONB-Payload. Optimistic Locking pro Profil über `revision`.
-- Die normalisierte Tabelle `catalog_node` bleibt davon unberührt (separater
-- Render-/Query-Pfad); `catalog_document` ist die editierbare Quelle.
-- ============================================================================
CREATE TABLE IF NOT EXISTS mapplusconf.catalog_document (
    site            TEXT NOT NULL DEFAULT 'maps',      -- Multi-Site: Site-Kennung (z.B. 'maps', 'geohost')
    profile         TEXT NOT NULL,                     -- Profilname (z.B. 'public' oder Unterprofil)
    variant         TEXT NOT NULL DEFAULT 'tnet',      -- Katalog-Variante: 'tnet' (TNET-Renderer) | 'tydac' (Original MAP+/TYDAC)
    payload         JSONB NOT NULL DEFAULT '{}'::jsonb, -- vollständige lyrmgr.conf als JSON-Objekt
    revision        INTEGER NOT NULL DEFAULT 1,         -- Optimistic-Lock-Zähler (pro Site+Profil+Variante)
    updated_by      TEXT,                               -- letzter Bearbeiter
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (site, profile, variant)
);

COMMENT ON TABLE  mapplusconf.catalog_document IS 'Themenkatalog (ersetzt lyrmgr.conf) pro Site+Profil+Variante als JSONB-Dokument mit Optimistic Locking';
COMMENT ON COLUMN mapplusconf.catalog_document.site IS 'Multi-Site-Kennung; DEV/PROD sind bereits ueber getrennte Schemas getrennt, site unterscheidet nur die Site';
COMMENT ON COLUMN mapplusconf.catalog_document.variant IS 'Katalog-Variante: tnet (eigener Renderer) oder tydac (originales MAP+/TYDAC ClassicLayerMgr-Format)';
COMMENT ON COLUMN mapplusconf.catalog_document.payload IS 'Vollständige lyrmgr.conf als JSON-Objekt (Blöcke nach lyrmgrKey)';
COMMENT ON COLUMN mapplusconf.catalog_document.revision IS 'Optimistic-Lock-Revision pro Site+Profil+Variante; bei jeder Speicherung +1';

CREATE INDEX IF NOT EXISTS idx_catalog_doc_payload ON mapplusconf.catalog_document USING GIN (payload);

-- Migration Bestands-DB: Site-Dimension nachruesten (idempotent).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='mapplusconf' AND table_name='catalog_document' AND column_name='site') THEN
        ALTER TABLE mapplusconf.catalog_document ADD COLUMN site TEXT NOT NULL DEFAULT 'maps';
        ALTER TABLE mapplusconf.catalog_document DROP CONSTRAINT IF EXISTS catalog_document_pkey;
        ALTER TABLE mapplusconf.catalog_document ADD PRIMARY KEY (site, profile);
    END IF;
    -- Variant-Dimension (Tydac) nachruesten (idempotent).
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='mapplusconf' AND table_name='catalog_document' AND column_name='variant') THEN
        ALTER TABLE mapplusconf.catalog_document ADD COLUMN variant TEXT NOT NULL DEFAULT 'tnet';
        ALTER TABLE mapplusconf.catalog_document DROP CONSTRAINT IF EXISTS catalog_document_pkey;
        ALTER TABLE mapplusconf.catalog_document ADD PRIMARY KEY (site, profile, variant);
    END IF;
END
$$;


-- ============================================================================
-- 13. CATALOG_DOCUMENT_HISTORY
-- Änderungshistorie pro Profil für Diff und Restore. Eine Zeile pro Speicher-/
-- Publish-Aktion mit dem jeweiligen Payload-Stand (optional blockbezogen).
-- ============================================================================
CREATE TABLE IF NOT EXISTS mapplusconf.catalog_document_history (
    id              SERIAL PRIMARY KEY,
    site            TEXT NOT NULL DEFAULT 'maps',  -- Multi-Site: Site-Kennung
    profile         TEXT NOT NULL,                 -- kein FK: Historie überlebt Hard-Delete
    variant         TEXT NOT NULL DEFAULT 'tnet',  -- Katalog-Variante (tnet | tydac)
    revision        INTEGER NOT NULL,              -- Revisionsstand dieser Zeile
    action          TEXT NOT NULL CHECK (action IN ('create', 'update', 'publish', 'delete', 'restore', 'import')),
    lyrmgr_key      TEXT,                          -- betroffener Block (bei blockweisem Publish)
    payload         JSONB,                         -- Payload-Stand nach der Aktion
    changed_by      TEXT,
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  mapplusconf.catalog_document_history IS 'Änderungshistorie des Themenkatalogs pro Site+Profil+Variante für Diff und Restore';
COMMENT ON COLUMN mapplusconf.catalog_document_history.lyrmgr_key IS 'Betroffener lyrmgr-Block bei blockweisem Publish (sonst NULL = ganzes Dokument)';

CREATE INDEX IF NOT EXISTS idx_catalog_doc_hist ON mapplusconf.catalog_document_history (site, profile, variant, revision DESC);

-- Migration Bestands-DB: Site-/Variant-Spalten fuer Historie nachruesten (idempotent).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='mapplusconf' AND table_name='catalog_document_history' AND column_name='site') THEN
        ALTER TABLE mapplusconf.catalog_document_history ADD COLUMN site TEXT NOT NULL DEFAULT 'maps';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='mapplusconf' AND table_name='catalog_document_history' AND column_name='variant') THEN
        ALTER TABLE mapplusconf.catalog_document_history ADD COLUMN variant TEXT NOT NULL DEFAULT 'tnet';
    END IF;
END
$$;


-- ============================================================================
-- 14. CATALOG_LOCK
-- Soft-Lock (UI-Hinweis) pro Profil für kontrolliertes gleichzeitiges Arbeiten.
-- ============================================================================
CREATE TABLE IF NOT EXISTS mapplusconf.catalog_lock (
    site            TEXT NOT NULL DEFAULT 'maps',  -- Multi-Site: Site-Kennung
    profile         TEXT NOT NULL,                 -- Lock-Bereich = Profilname
    variant         TEXT NOT NULL DEFAULT 'tnet',  -- Katalog-Variante (tnet | tydac)
    locked_by       TEXT NOT NULL,
    locked_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (site, profile, variant)
);

COMMENT ON TABLE  mapplusconf.catalog_lock IS 'Soft-Lock (UI-Hinweis) für gleichzeitiges Bearbeiten des Themenkatalogs pro Site+Profil+Variante';

-- Migration Bestands-DB: Site-/Variant-Dimension fuer Lock nachruesten (idempotent).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='mapplusconf' AND table_name='catalog_lock' AND column_name='site') THEN
        ALTER TABLE mapplusconf.catalog_lock ADD COLUMN site TEXT NOT NULL DEFAULT 'maps';
        ALTER TABLE mapplusconf.catalog_lock DROP CONSTRAINT IF EXISTS catalog_lock_pkey;
        ALTER TABLE mapplusconf.catalog_lock ADD PRIMARY KEY (site, profile);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='mapplusconf' AND table_name='catalog_lock' AND column_name='variant') THEN
        ALTER TABLE mapplusconf.catalog_lock ADD COLUMN variant TEXT NOT NULL DEFAULT 'tnet';
        ALTER TABLE mapplusconf.catalog_lock DROP CONSTRAINT IF EXISTS catalog_lock_pkey;
        ALTER TABLE mapplusconf.catalog_lock ADD PRIMARY KEY (site, profile, variant);
    END IF;
END
$$;

-- updated_at-Trigger für catalog_document
DROP TRIGGER IF EXISTS trg_catalog_document_updated ON mapplusconf.catalog_document;
CREATE TRIGGER trg_catalog_document_updated BEFORE UPDATE ON mapplusconf.catalog_document FOR EACH ROW EXECUTE FUNCTION mapplusconf.set_updated_at();


-- ============================================================================
-- 15. CONFIG_BUNDLE_STORE
-- DB-basierte Ablage der Konfig-Bundles aus dem SLM.
-- Ersetzt die dateibasierte Ordnerstruktur ImportToCore/<kuerzel>/ durch ein
-- JSONB-Bundle pro Kürzel/Tag-Gruppe.
-- ============================================================================
DO $$
BEGIN
    IF to_regclass('mapplusconf.config_bundle_store') IS NULL
       AND to_regclass('mapplusconf.staging_import_bundle') IS NOT NULL THEN
        ALTER TABLE mapplusconf.staging_import_bundle RENAME TO config_bundle_store;
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS mapplusconf.config_bundle_store (
    kuerzel             TEXT PRIMARY KEY,
    tags                JSONB NOT NULL DEFAULT '[]'::jsonb,
    payload             JSONB NOT NULL DEFAULT '{"files": []}'::jsonb,
    manifest            JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_imported_at    TIMESTAMPTZ,
    last_imported_by    TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE mapplusconf.config_bundle_store IS 'DB-basierter Konfig-Bundle-Store aus dem SLM (ersetzt ImportToCore/<kuerzel>/)';
COMMENT ON COLUMN mapplusconf.config_bundle_store.kuerzel IS 'Primäres Kürzel des Bundles; historisch der Ordnername unter ImportToCore/';
COMMENT ON COLUMN mapplusconf.config_bundle_store.tags IS 'Freie Tags zum Bundle; aktuell mindestens das Kürzel selbst';
COMMENT ON COLUMN mapplusconf.config_bundle_store.payload IS 'Datei-Bundle als JSONB: {files:[{name,type,prefix,data,size,modified}]}' ;
COMMENT ON COLUMN mapplusconf.config_bundle_store.manifest IS 'Manifest mit Quellbasis/Change-Detection';
COMMENT ON COLUMN mapplusconf.config_bundle_store.last_imported_at IS 'Zeitpunkt des letzten Imports in die DB';
COMMENT ON COLUMN mapplusconf.config_bundle_store.last_imported_by IS 'Bearbeiter des letzten Imports';

CREATE INDEX IF NOT EXISTS idx_config_bundle_store_tags ON mapplusconf.config_bundle_store USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_config_bundle_store_imported_at ON mapplusconf.config_bundle_store (last_imported_at DESC);

DROP TRIGGER IF EXISTS trg_config_bundle_store_updated ON mapplusconf.config_bundle_store;
CREATE TRIGGER trg_config_bundle_store_updated BEFORE UPDATE ON mapplusconf.config_bundle_store FOR EACH ROW EXECUTE FUNCTION mapplusconf.set_updated_at();
