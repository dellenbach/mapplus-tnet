/*
 * tnet-search.js  v2.0
 * Desktop-Suchfeld (parallel zur bestehenden njs/SOLR-Suche)
 * Nutzt search-proxy.php fuer Geo-Suche + lokalen Layer-Index fuer Themen-Suche.
 * v1.5: Filter-Popup (Radios + Checkboxen), Lupe links, Tune rechts
 * v1.6: Feature-Suche (Strassen/Gebaeude) mit Geometrie-Highlighting
 * v1.7: Subtitles, Deduplizierung, featureId-Highlight fuer Geocoder-Adressen
 * v2.0: Lokale Themen-Suche via Layer-API-Index, Breadcrumb-Subtitles,
 *       Relevanz-Ranking, Tree-Navigation bei Klick
 *
 * @version    2.0
 * @date       2026-03-07
 * @copyright  Trigonet AG
 */
(function () {
    'use strict';

    function getAppRoot() {
        return window.__TNET_APP_ROOT || '/maps';
    }

    function getLayerApiSource() {
        var src = 'db';
        try {
            if (window.TnetGlobalConfig && typeof window.TnetGlobalConfig.get === 'function') {
                src = window.TnetGlobalConfig.get('layerManager.apiSource', 'db') || 'db';
            }
        } catch (eCfg) { /* ignore */ }
        return (src === 'file') ? 'file' : 'db';
    }

    var PROXY_URL    = getAppRoot() + '/tnet/api/search-proxy.php';
    var MAPSERVER_URL = 'https://api3.geo.admin.ch/rest/services/api/MapServer/';
    var debounceTimer = null;
    var currentAbort  = null;   // AbortController
    var lastQuery    = '';
    var featureHighlightLayer = null;
    var _searchZoomConfig = null;   // aus tnet-global-config.json5 geladen
    var _searchLimits = {};          // {maxAddresses, maxLocations, maxLayers} aus Config
    var _resultCache = new Map();   // Client-Cache: query-key → {data, ts}
    var _CACHE_TTL   = 300000;      // 5 min (ms)
    var _CACHE_MAX   = 50;          // max Einträge
    var _ADDR_RESOLUTION = 0.28;    // 1:1000 Massstab (OGC: 1000 × 0.00028 m/px)
    var _layerIndex = null;        // Flache Layer-Liste von API fuer lokale Themen-Suche
    var _layerIndexReady = false;
    var _layerIndexLoading = false;

    // -- Map/Layer Helpers ---------------------------------------------------

    function getMapView() {
        try { return njs.AppManager.Maps['main'].mapObj.getView(); } catch (e) { return null; }
    }

    /** Prüft ob die aktive Basemap ein Orthophoto ist */
    function isOrthophotoActive() {
        try {
            var bm = njs.AppManager.Maps['main'].currBasisMap || njs.AppManager.Maps['main'].basisMap || '';
            if (/swissimage|ortho/i.test(bm)) return true;
        } catch (e) {}
        var card = document.querySelector('.basemap-card.active');
        if (card && /swissimage|ortho/i.test(card.dataset.basemap || '')) return true;
        return false;
    }

    /** Basemap-abhängige Zoom-Stufen (aus Config oder Fallback) */
    function getZoomLevels() {
        var key = isOrthophotoActive() ? 'orthophoto' : 'other';
        if (_searchZoomConfig && _searchZoomConfig[key]) {
            var c = _searchZoomConfig[key];
            return {
                point:      c.point      != null ? c.point      : (key === 'orthophoto' ? 25 : 24),
                fitMax:     c.fitMax     != null ? c.fitMax     : (key === 'orthophoto' ? 25 : 24),
                fitMin:     c.fitMin     != null ? c.fitMin     : (key === 'orthophoto' ? 16 : 15),
                panDefault: c.panDefault != null ? c.panDefault : (key === 'orthophoto' ? 25 : 24)
            };
        }
        // Fallback falls Config nicht geladen
        if (key === 'orthophoto') return { point: 25, fitMax: 25, fitMin: 16, panDefault: 25 };
        return { point: 24, fitMax: 24, fitMin: 15, panDefault: 24 };
    }

    /** Zur Koordinate animieren. x=Northing, y=Easting (LV95) */
    function panToResult(x, y, zoom, resolution) {
        var view = getMapView();
        if (!view || x == null || y == null) return;
        var mapProj = view.getProjection().getCode();
        var coord = (typeof ol !== 'undefined' && ol.proj)
            ? ol.proj.transform([y, x], 'EPSG:2056', mapProj)
            : [y, x];
        if (resolution) {
            view.animate({ center: coord, resolution: resolution, duration: 400 });
        } else {
            var zl = getZoomLevels();
            view.animate({ center: coord, zoom: zoom || zl.panDefault, duration: 400 });
        }
    }

    /**
     * Layer einschalten — dreistufig:
     * 1. Über TnetLMStore (respektiert Coalesce, Sichtbarkeit, Active-Liste)
     * 2. Eltern-Pfad-Fallback: wenn exakte ID nicht im Store → Pfadsegmente
     *    kürzen bis ein bekannter Layer gefunden wird (z.B. Service-Root)
     * 3. TnetLayerSwitch / setMapBookmark als letzter Fallback
     */
    function activateLayer(layerId) {
        var store = window.TnetLMStore;

        // 1. Exakte Suche im Store
        if (store && typeof store.findLayer === 'function') {
            var layer = store.findLayer(layerId);
            if (layer && layer.type !== 'group') {
                store.setLayerVisible(layerId, true);
                TnetLog.log('[DesktopSearch] Layer via Store aktiviert:', layerId);
                return;
            }

            // 2. Eltern-Pfad-Fallback: "a/b/c/d" → "a/b/c" → "a/b" → "a"
            var parts = layerId.split('/');
            while (parts.length > 1) {
                parts.pop();
                var parentId = parts.join('/');
                var parent = store.findLayer(parentId);
                if (parent && parent.type !== 'group') {
                    store.setLayerVisible(parentId, true);
                    TnetLog.log('[DesktopSearch] Eltern-Layer aktiviert:', parentId, '(statt:', layerId, ')');
                    return;
                }
            }
        }

        // 3. TnetLayerSwitch (Dojo LyrMgr)
        if (typeof window.TnetLayerSwitch === 'function') {
            window.TnetLayerSwitch(layerId, 'on');
            return;
        }

        // 4. Letzter Fallback: setMapBookmark
        try {
            var njsAM = (window.top && window.top.njs) ? window.top.njs.AppManager
                       : (window.njs ? window.njs.AppManager : null);
            if (njsAM && typeof njsAM.setMapBookmark === 'function') {
                njsAM.setMapBookmark(['main'], 'layers=' + layerId);
                return;
            }
        } catch (e) {}
        TnetLog.warn('[DesktopSearch] Layer-Aktivierung fehlgeschlagen:', layerId);
    }

    // -- Layer-Index fuer lokale Themen-Suche ----------------------------------

    /** Kategorie-Abkuerzungen und Sortierung */
    var CATEGORY_ABBR = { 'nidwalden': 'NW', 'obwalden': 'OW', 'bund': 'CH', 'weitere': 'Weitere' };
    var CATEGORY_ORDER = { 'nidwalden': 0, 'obwalden': 1, 'bund': 2, 'weitere': 3 };

    /**
     * Laedt den flachen Layer-Katalog von der API und cached ihn im Client.
     * Wird einmalig beim Init aufgerufen — alle Themen-Suchen nutzen dann den lokalen Index.
     */
    function loadLayerIndex() {
        if (_layerIndexReady || _layerIndexLoading) return;
        _layerIndexLoading = true;
        var apiUrl = getAppRoot() + '/tnet/api/v1/layers.php?flat=true&details=false&source=' + encodeURIComponent(getLayerApiSource());
        fetch(apiUrl)
            .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
            .then(function (json) {
                _layerIndex = json.data || json || [];
                if (Array.isArray(_layerIndex) && _layerIndex.length > 0) {
                    _layerIndexReady = true;
                    TnetLog.log('[DesktopSearch] Layer-Index geladen:', _layerIndex.length, 'Layer');
                } else {
                    TnetLog.warn('[DesktopSearch] Layer-Index leer oder ungueltiges Format');
                }
                _layerIndexLoading = false;
            })
            .catch(function (e) {
                _layerIndexLoading = false;
                TnetLog.warn('[DesktopSearch] Layer-Index konnte nicht geladen werden:', e);
            });
    }

    /**
     * Durchsucht den lokalen Layer-Index nach dem Suchbegriff.
     * Gibt Ergebnisse mit Breadcrumb-Subtitle und Relevanz-Ranking zurueck.
     * Viel besser als PHP-Suche: volle Layer-IDs, Pfad-Kontext, Kategorie-Info.
     */
    function searchLayersLocal(query, limit) {
        if (!_layerIndex || !_layerIndex.length) return [];
        var qLower = query.toLowerCase();
        var results = [];

        for (var i = 0; i < _layerIndex.length; i++) {
            var layer = _layerIndex[i];
            var name = layer.name || '';
            var nameLower = name.toLowerCase();
            // ID-basierter Suchtext: Unterstriche und Slashes durch Leerzeichen
            var idText = (layer.id || '').replace(/[_\/]/g, ' ').toLowerCase();

            // Relevanz-Score berechnen
            var score = 0;
            if (nameLower === qLower) score = 100;                // Exakter Treffer
            else if (nameLower.indexOf(qLower) === 0) score = 80; // Beginnt mit
            else if (nameLower.indexOf(qLower) !== -1) score = 60; // Enthaelt im Namen
            else if (idText.indexOf(qLower) !== -1) score = 20;    // Enthaelt in ID
            if (score === 0) continue;

            // Breadcrumb-Subtitle aus Pfad bauen (z.B. "NW > OEREB > Raumplanung")
            var pathParts = (layer.path || '').split(' > ');
            var cat = (layer.category || '').toLowerCase();
            if (pathParts.length > 0) {
                pathParts[0] = CATEGORY_ABBR[cat] || pathParts[0];
            }
            // Letztes Segment entfernen wenn es dem Layer-Namen aehnelt
            if (pathParts.length > 2) {
                var lastPart = pathParts[pathParts.length - 1];
                if (lastPart.toLowerCase().replace(/[\s_-]/g, '') ===
                    nameLower.replace(/[\s_-]/g, '')) {
                    pathParts.pop();
                }
            }
            var subtitle = pathParts.join(' \u203A ');

            results.push({
                id: layer.id,
                label: name,
                subtitle: subtitle,
                type: 'layer',
                layer: layer.id,
                category: layer.category || '',
                x: null,
                y: null,
                _score: score,
                _catOrder: CATEGORY_ORDER[cat] || 99
            });
        }

        // Sortieren: Relevanz absteigend, dann Kategorie-Reihenfolge
        results.sort(function (a, b) {
            if (a._score !== b._score) return b._score - a._score;
            return a._catOrder - b._catOrder;
        });

        // Limit anwenden und interne Score-Felder entfernen
        results = results.slice(0, limit || 10);
        for (var j = 0; j < results.length; j++) {
            delete results[j]._score;
            delete results[j]._catOrder;
        }
        return results;
    }

    /**
     * Verschmilzt PHP-Geo-Ergebnisse (Gruppen) mit lokalen Layer-Ergebnissen.
     * Ersetzt die PHP-Layer-Gruppe durch die (bessere) lokale Variante.
     */
    function mergeWithLocalLayers(phpGroups, localLayers) {
        if (!localLayers || !localLayers.length) return phpGroups || [];
        if (!phpGroups || !phpGroups.length) {
            return [{ label: 'Themen', type: 'layer', items: localLayers }];
        }
        var merged = [];
        for (var i = 0; i < phpGroups.length; i++) {
            if (phpGroups[i].type !== 'layer') {
                merged.push(phpGroups[i]);
            }
        }
        merged.push({ label: 'Themen', type: 'layer', items: localLayers });
        return merged;
    }

    /** Navigiert im Themenbaum zum Layer und klappt die Elternknoten auf */
    function navigateTreeToLayer(layerId, categoryId) {
        if (window.TnetLMTree && typeof window.TnetLMTree.navigateToLayer === 'function') {
            window.TnetLMTree.navigateToLayer(layerId, categoryId);
        }
    }

    // -- Feature Highlight ----------------------------------------------------

    function ensureFeatureHighlightLayer() {
        if (featureHighlightLayer) return featureHighlightLayer;
        try {
            var map = njs.AppManager.Maps['main'].mapObj;
            featureHighlightLayer = new ol.layer.Vector({
                source: new ol.source.Vector(),
                name: 'tnet_feature_highlight',
                zIndex: 9999,
                style: new ol.style.Style({
                    stroke: new ol.style.Stroke({ color: '#e74c3c', width: 4 }),
                    fill: new ol.style.Fill({ color: 'rgba(231,76,60,0.15)' }),
                    image: new ol.style.Circle({
                        radius: 8,
                        fill: new ol.style.Fill({ color: '#e74c3c' }),
                        stroke: new ol.style.Stroke({ color: '#fff', width: 2 })
                    })
                })
            });
            map.addLayer(featureHighlightLayer);
        } catch (e) {
            TnetLog.warn('[DesktopSearch] Feature-Highlight-Layer konnte nicht erstellt werden:', e);
        }
        return featureHighlightLayer;
    }

    function clearFeatureHighlight() {
        if (featureHighlightLayer) {
            featureHighlightLayer.getSource().clear();
        }
    }

    /**
     * Punkt-Marker auf dem Highlight-Layer platzieren (ohne Geometrie-Abfrage).
     * x = Northing, y = Easting (LV95)
     */
    function addPointMarker(x, y) {
        var layer = ensureFeatureHighlightLayer();
        if (!layer || x == null || y == null) return;
        var view = getMapView();
        if (!view) return;
        var mapProj = view.getProjection().getCode();
        var coord = ol.proj.transform([y, x], 'EPSG:2056', mapProj);
        var feature = new ol.Feature({ geometry: new ol.geom.Point(coord) });
        layer.getSource().addFeature(feature);
    }

    function highlightFeature(item) {
        var layer = ensureFeatureHighlightLayer();
        if (!layer) return;
        clearFeatureHighlight();

        // Fallback-Funktion: Pan + Punkt-Marker wenn MapServer fehlschlaegt
        function fallbackPan() {
            if (item.x && item.y) {
                addPointMarker(item.x, item.y);
                if (item.subtitle === 'Adresse') {
                    panToResult(item.x, item.y, null, _ADDR_RESOLUTION);
                } else {
                    panToResult(item.x, item.y);
                }
                TnetLog.log('[DesktopSearch] Fallback: Pan + Marker für', item.label);
            }
        }

        var url = MAPSERVER_URL + encodeURIComponent(item.layerId)
                + '/' + encodeURIComponent(item.featureId)
                + '?sr=2056&geometryFormat=geojson';

        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.timeout = 8000;
        xhr.onload = function () {
            if (xhr.status !== 200) {
                TnetLog.warn('[DesktopSearch] MapServer HTTP', xhr.status, 'für', item.layerId);
                fallbackPan();
                return;
            }
            try {
                var data = JSON.parse(xhr.responseText);
                var geojson = data.feature || data;
                var view = getMapView();
                if (!view) return;
                var mapProj = view.getProjection().getCode();
                var features = new ol.format.GeoJSON().readFeatures(geojson, {
                    dataProjection: 'EPSG:2056',
                    featureProjection: mapProj
                });
                if (!features.length) {
                    fallbackPan();
                    return;
                }
                layer.getSource().addFeatures(features);

                // Extent direkt aus Geometrie(n) berechnen
                var extent = features[0].getGeometry().getExtent().slice();
                for (var i = 1; i < features.length; i++) {
                    ol.extent.extend(extent, features[i].getGeometry().getExtent());
                }
                TnetLog.log('[DesktopSearch] Feature extent:', extent);

                var w = extent[2] - extent[0];
                var h = extent[3] - extent[1];
                if (w > 1 || h > 1) {
                    var zl = getZoomLevels();
                    view.fit(extent, {
                        padding: [50, 50, 50, 50],
                        minZoom: zl.fitMin,
                        maxZoom: zl.fitMax,
                        duration: 500,
                        constrainResolution: false
                    });
                } else {
                    // Punkt-Geometrie: zur Mitte zoomen
                    var cx = (extent[0] + extent[2]) / 2;
                    var cy = (extent[1] + extent[3]) / 2;
                    if (item.subtitle === 'Adresse') {
                        view.animate({ center: [cx, cy], resolution: _ADDR_RESOLUTION, duration: 500 });
                    } else {
                        var zl2 = getZoomLevels();
                        view.animate({ center: [cx, cy], zoom: zl2.point, duration: 500 });
                    }
                }
            } catch (e) {
                TnetLog.warn('[DesktopSearch] Feature-Geometrie konnte nicht geladen werden:', e);
                fallbackPan();
            }
        };
        xhr.onerror = xhr.ontimeout = function () {
            TnetLog.warn('[DesktopSearch] Feature-Geometrie Timeout/Fehler');
            fallbackPan();
        };
        xhr.send();
    }

    /** Parzellen-Geometrie via swisstopo Identify-API laden und highlighten */
    function highlightParcelByCoord(x, y) {
        var layer = ensureFeatureHighlightLayer();
        if (!layer) return;
        clearFeatureHighlight();

        // x = Northing, y = Easting (swisstopo Geocoder-Konvention)
        var easting  = Math.round(y);
        var northing = Math.round(x);

        var url = 'https://api3.geo.admin.ch/rest/services/ech/MapServer/identify'
            + '?geometryType=esriGeometryPoint'
            + '&geometry=' + easting + ',' + northing
            + '&tolerance=0'
            + '&layers=all:ch.kantone.cadastralwebmap-farbe'
            + '&returnGeometry=true'
            + '&sr=2056'
            + '&geometryFormat=geojson';

        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.timeout = 8000;
        xhr.onload = function () {
            if (xhr.status !== 200) return;
            try {
                var data = JSON.parse(xhr.responseText);
                if (!data.results || !data.results.length) {
                    // Kein Polygon gefunden, Fallback: nur hinzoomen
                    panToResult(x, y);
                    return;
                }

                var view = getMapView();
                if (!view) return;
                var mapProj = view.getProjection().getCode();

                // Erstes Resultat verwenden (genauester Treffer)
                var result = data.results[0];
                var geom = result.geometry;
                if (!geom) { panToResult(x, y); return; }

                var geojson = { type: 'Feature', geometry: geom, properties: result.properties || {} };
                var features = new ol.format.GeoJSON().readFeatures(geojson, {
                    dataProjection: 'EPSG:2056',
                    featureProjection: mapProj
                });
                if (!features.length) { panToResult(x, y); return; }

                layer.getSource().addFeatures(features);

                var extent = features[0].getGeometry().getExtent().slice();
                for (var i = 1; i < features.length; i++) {
                    ol.extent.extend(extent, features[i].getGeometry().getExtent());
                }
                TnetLog.log('[DesktopSearch] Parcel extent:', extent);

                var zl = getZoomLevels();
                view.fit(extent, {
                    padding: [50, 50, 50, 50],
                    minZoom: zl.fitMin,
                    maxZoom: zl.fitMax,
                    duration: 500,
                    constrainResolution: false
                });
            } catch (e) {
                TnetLog.warn('[DesktopSearch] Parcel-Geometrie Fehler:', e);
                panToResult(x, y);
            }
        };
        xhr.onerror = xhr.ontimeout = function () {
            TnetLog.warn('[DesktopSearch] Parcel-Identify Timeout');
            panToResult(x, y);
        };
        xhr.send();
    }

    // -- Icons (extern aus /maps/tnet/resources/icons/) -----------------------

    var ICON_BASE = getAppRoot() + '/tnet/resources/icons/';
    var ICON_CSS  = 'dt-search-item-icon';
    var _iconCache = {};

    // Inline-Fallbacks (falls fetch fehlschlägt)
    var ICON_FALLBACK = {
        layer:    '<svg class="' + ICON_CSS + '" viewBox="0 0 24 24"><path d="M11.99 2L2 7l10 5 10-5-10.01-5zM2 17l10 5 10-5-10-5-10 5zM2 12l10 5 10-5-10-5-10 5z"/></svg>',
        location: '<svg class="' + ICON_CSS + '" viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5s2.5 1.12 2.5 2.5S13.38 11.5 12 11.5z"/></svg>',
        address:  '<svg class="' + ICON_CSS + '" viewBox="0 0 24 24"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>',
        street:   '<svg class="' + ICON_CSS + '" viewBox="0 0 24 24"><path d="M11 2h2v4h-2V2zm0 6h2v4h-2V8zm0 6h2v4h-2v-4zm0 6h2v2h-2v-2zM4 2h3v20H4V2zm13 0h3v20h-3V2z"/></svg>',
        terrain:  '<svg class="' + ICON_CSS + '" viewBox="0 0 24 24"><path d="M14 6l-3.75 5 2.85 3.8-1.6 1.2C9.81 13.75 7 10 7 10l-6 8h22L14 6z"/></svg>',
    };

    /** SVG-Datei laden und im Cache speichern. Setzt CSS-Klasse auf das <svg>. */
    function loadIcon(name) {
        if (_iconCache[name]) return;
        _iconCache[name] = ICON_FALLBACK[name] || ICON_FALLBACK.location;
        fetch(ICON_BASE + 'search-' + name + '.svg')
            .then(function (r) { return r.ok ? r.text() : Promise.reject(r.status); })
            .then(function (svg) {
                _iconCache[name] = svg.replace('<svg', '<svg class="' + ICON_CSS + '"');
            })
            .catch(function () { /* Fallback bleibt */ });
    }

    // Icons vorladen
    ['layer', 'location', 'address', 'street', 'terrain'].forEach(loadIcon);

    function getIconHtml(name) {
        return _iconCache[name] || ICON_FALLBACK.location;
    }

    function getItemIcon(item) {
        if (item.type === 'layer') return getIconHtml('layer');
        var sub = (item.subtitle || '').toLowerCase();
        if (sub === 'strasse') return getIconHtml('street');
        if (sub === 'adresse') return getIconHtml('address');
        if (sub === 'gemeinde' || sub === 'plz' || sub === 'kanton' ||
            sub === 'ortschaft' || sub === 'bezirk') return getIconHtml('location');
        if (item.type === 'feature' && item.layerId === 'ch.swisstopo.swissnames3d') {
            if (/gipfel|berg|pass|gletscher|huegel/i.test(sub)) return getIconHtml('terrain');
            return getIconHtml('location');
        }
        if (sub === 'lokalname') return getIconHtml('location');
        if (item.featureId) return getIconHtml('address');
        return getIconHtml('location');
    }

    // -- DOM-Render -----------------------------------------------------------

    function showGroupedResults(groups, itemsFallback) {
        var list = document.getElementById('dt-search-results');
        if (!list) return;
        list.innerHTML = '';

        var hasItems = false;

        if (groups && groups.length) {
            groups.forEach(function (group) {
                if (!group.items || !group.items.length) return;

                var header = document.createElement('li');
                header.className = 'dt-search-group-header';
                header.setAttribute('role', 'presentation');
                header.textContent = group.label;
                list.appendChild(header);

                group.items.forEach(function (item) {
                    list.appendChild(makeItem(item));
                    hasItems = true;
                });
            });
        } else if (itemsFallback && itemsFallback.length) {
            itemsFallback.forEach(function (item) {
                list.appendChild(makeItem(item));
                hasItems = true;
            });
        }

        list.classList.toggle('open', hasItems);
    }

    /** Suchbegriff im Label fett hervorheben */
    function highlightText(text, query) {
        if (!query) return text;
        var safe = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // EGRID-Suche (z.B. CH310515347747): optionale Leerzeichen zwischen Ziffern,
        // weil swisstopo das Label mit Leerzeichen liefert (CH 3105 1534 7747)
        if (/^CH\d{6,}/i.test(query)) {
            var prefix = safe.substring(0, 2);
            var digits = safe.substring(2);
            safe = prefix + '\\s*' + digits.split('').join('\\s*');
        }
        return text.replace(new RegExp('(' + safe + ')', 'gi'), '<b class="dt-search-highlight">$1</b>');
    }

    function makeItem(item) {
        var li = document.createElement('li');
        li.className = 'dt-search-item';
        li.setAttribute('role', 'option');
        li.setAttribute('tabindex', '-1');
        var icon = getItemIcon(item);
        var label = highlightText(item.label || '', lastQuery);
        var html = icon + '<span class="dt-search-item-text">' +
            '<span class="dt-search-item-label">' + label + '</span>';
        if (item.subtitle) {
            html += '<span class="dt-search-item-subtitle">' + item.subtitle + '</span>';
        }
        html += '</span>';
        li.innerHTML = html;

        li.addEventListener('click', function () {
            var inp  = document.getElementById('dt-search-input');
            var lst  = document.getElementById('dt-search-results');
            var clr  = document.getElementById('dt-search-clear');

            // Immer vorherigen Feature-Highlight entfernen
            clearFeatureHighlight();

            if (item.type === 'layer') {
                if (inp)  { inp.value = ''; }
                if (clr)  { clr.style.display = 'none'; }
                if (lst)  { lst.classList.remove('open'); lst.innerHTML = ''; }
                activateLayer(item.layer || item.id);
                // Im Themenbaum zum Layer navigieren, Elternknoten aufklappen
                navigateTreeToLayer(item.layer || item.id, item.category);
            } else if (item.type === 'feature' || item.featureId) {
                if (inp) inp.value = item.label;
                if (lst) lst.classList.remove('open');
                if (item.layerId && item.featureId) {
                    highlightFeature(item);
                } else if (item.x && item.y) {
                    panToResult(item.x, item.y);
                }
            } else {
                if (inp) inp.value = item.label;
                if (lst) lst.classList.remove('open');
                // Parzellen: Flächengeometrie via Identify-API highlighten
                if (item.subtitle === 'Parzelle' && item.x && item.y) {
                    highlightParcelByCoord(item.x, item.y);
                } else if (item.subtitle === 'Adresse' && item.x && item.y) {
                    addPointMarker(item.x, item.y);
                    panToResult(item.x, item.y, null, _ADDR_RESOLUTION);
                } else {
                    panToResult(item.x, item.y);
                }
            }
        });

        return li;
    }

    // -- Search ---------------------------------------------------------------

    function buildSearchUrl(query, mode) {
        var cantonRadio = document.querySelector('input[name="dt-canton"]:checked');
        var canton = cantonRadio ? cantonRadio.value : '';
        var orteCb = document.getElementById('dt-filter-orte');
        var adrCb  = document.getElementById('dt-filter-adressen');
        var layCb  = document.getElementById('dt-filter-layers');
        var hasOrte = orteCb ? orteCb.checked : true;
        var hasAdr  = adrCb  ? adrCb.checked  : true;
        var hasLay  = layCb  ? layCb.checked  : true;
        var scopes = [];
        if (!hasOrte || !hasAdr || !hasLay) {
            if (hasOrte) scopes.push('orte');
            if (hasAdr)  scopes.push('adressen');
            if (hasLay)  scopes.push('layers');
        }
        var scope = scopes.join(',');
        var url = PROXY_URL + '?q=' + encodeURIComponent(query) + '&limit=10';
        // Resultat-Limits aus Konfiguration übergeben
        if (_searchLimits.maxAddresses) url += '&maxAddr=' + _searchLimits.maxAddresses;
        if (_searchLimits.maxLocations) url += '&maxLoc='  + _searchLimits.maxLocations;
        if (_searchLimits.maxLayers)    url += '&maxLay='  + _searchLimits.maxLayers;
        if (canton) url += '&canton=' + encodeURIComponent(canton);
        if (scope)  url += '&scope='  + encodeURIComponent(scope);
        if (mode)   url += '&mode='   + encodeURIComponent(mode);
        return url;
    }

    function getCacheKey(url) { return url; }

    var _searchId = 0;  // Monoton steigend, verhindert Race Conditions

    function doSearch(query) {
        lastQuery = query;
        if (currentAbort) { try { currentAbort.abort(); } catch (e) {} }

        var myId = ++_searchId;

        // Phase 0: Sofortige lokale Layer-Suche (instant, kein Netzwerk)
        var layCb = document.getElementById('dt-filter-layers');
        var hasLay = layCb ? layCb.checked : true;
        var localLayers = (hasLay && _layerIndexReady) ? searchLayersLocal(query, 10) : [];
        if (localLayers.length) {
            showGroupedResults([{ label: 'Themen', type: 'layer', items: localLayers }], null);
        }

        var fullUrl = buildSearchUrl(query);
        var fullCacheKey = getCacheKey(fullUrl);

        // Client-Cache: Vollergebnis vorhanden? Mit lokalen Layern mergen.
        var cachedFull = _resultCache.get(fullCacheKey);
        if (cachedFull && (Date.now() - cachedFull.ts) < _CACHE_TTL) {
            showGroupedResults(mergeWithLocalLayers(cachedFull.data.groups, localLayers), cachedFull.data.items);
            return;
        }

        // Phase 1: Fast-Modus (Adressen + Layers)
        var fastUrl = buildSearchUrl(query, 'fast');
        var fastCacheKey = getCacheKey(fastUrl);
        var cachedFast = _resultCache.get(fastCacheKey);

        var ac = new AbortController();
        currentAbort = ac;

        if (cachedFast && (Date.now() - cachedFast.ts) < _CACHE_TTL) {
            showGroupedResults(mergeWithLocalLayers(cachedFast.data.groups, localLayers), cachedFast.data.items);
        } else {
            fetch(fastUrl, { signal: ac.signal })
                .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
                .then(function (data) {
                    if (_searchId !== myId) return;
                    if (_resultCache.size >= _CACHE_MAX) {
                        _resultCache.delete(_resultCache.keys().next().value);
                    }
                    _resultCache.set(fastCacheKey, { data: data, ts: Date.now() });
                    if (!_resultCache.has(fullCacheKey) || (Date.now() - _resultCache.get(fullCacheKey).ts) >= _CACHE_TTL) {
                        showGroupedResults(mergeWithLocalLayers(data.groups, localLayers), data.items);
                    }
                })
                .catch(function () {});
        }

        // Phase 2: Full-Request (parallel, Geo-Ergebnisse hinzufuegen)
        fetch(fullUrl, { signal: ac.signal })
            .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
            .then(function (data) {
                if (_searchId !== myId) return;
                if (_resultCache.size >= _CACHE_MAX) {
                    _resultCache.delete(_resultCache.keys().next().value);
                }
                _resultCache.set(fullCacheKey, { data: data, ts: Date.now() });
                showGroupedResults(mergeWithLocalLayers(data.groups, localLayers), data.items);
            })
            .catch(function (e) {
                if (e.name !== 'AbortError' && localLayers.length === 0) showGroupedResults(null, []);
            });
    }

    // -- Event-Binding --------------------------------------------------------

    // DOM-Injection: baut #dt-search-bar selbst auf, falls nicht im HTML vorhanden.
    // Ermoeglicht schlankes index.htm + Wiederverwendung (Mobile/Edit).
    function ensureSearchBarDOM() {
        if (document.getElementById('dt-search-bar')) return;

        var bar = document.createElement('div');
        bar.id = 'dt-search-bar';
        bar.setAttribute('role', 'search');
        bar.innerHTML =
            '<svg class="dt-search-icon" viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>'
          + '<input type="search" id="dt-search-input" placeholder="Ort, Adresse, Thema suchen \u2026" autocomplete="off" spellcheck="false">'
          + '<button id="dt-search-clear" style="display:none" title="L\u00f6schen">&times;</button>'
          + '<button id="dt-search-filter-btn" title="Filter" type="button">'
          +   '<svg viewBox="0 0 24 24"><path d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z"/></svg>'
          + '</button>'
          + '<div id="dt-search-filter-popup">'
          +   '<div class="dt-filter-section">'
          +     '<div class="dt-filter-title">Ortsauswahl</div>'
          +     '<label class="dt-filter-radio"><input type="radio" name="dt-canton" value="" checked> Nidwalden + Obwalden</label>'
          +     '<label class="dt-filter-radio"><input type="radio" name="dt-canton" value="NW"> Nidwalden</label>'
          +     '<label class="dt-filter-radio"><input type="radio" name="dt-canton" value="OW"> Obwalden</label>'
          +   '</div>'
          +   '<hr class="dt-filter-hr">'
          +   '<div class="dt-filter-section">'
          +     '<div class="dt-filter-title">Inhalte</div>'
          +     '<label class="dt-filter-check"><input type="checkbox" id="dt-filter-orte" checked> Orte, Strassen &amp; Gebiete</label>'
          +     '<label class="dt-filter-check"><input type="checkbox" id="dt-filter-adressen" checked> Adressen</label>'
          +     '<label class="dt-filter-check"><input type="checkbox" id="dt-filter-layers" checked> Themen</label>'
          +   '</div>'
          + '</div>'
          + '<ul id="dt-search-results" role="listbox"></ul>';
        document.body.appendChild(bar);
        if (window.TnetLog) TnetLog.log('[DesktopSearch] Such-Bar DOM auto-injiziert \u2714');
    }

    function init() {
        var input    = document.getElementById('dt-search-input');
        var list     = document.getElementById('dt-search-results');
        var clearBtn = document.getElementById('dt-search-clear');
        var filterBtn = document.getElementById('dt-search-filter-btn');
        var popup    = document.getElementById('dt-search-filter-popup');

        if (!input || !list) return;
        // Filter-Button: Popup öffnen/schliessen
        if (filterBtn && popup) {
            filterBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                var isOpen = popup.classList.toggle('open');
                filterBtn.classList.toggle('active', isOpen);
            });
        }

        // Filter-Indikator aktualisieren
        function updateFilterIndicator() {
            if (!filterBtn) return;
            var cantonRadio = document.querySelector('input[name="dt-canton"]:checked');
            var canton = cantonRadio ? cantonRadio.value : '';
            var orteCb = document.getElementById('dt-filter-orte');
            var adrCb  = document.getElementById('dt-filter-adressen');
            var layCb  = document.getElementById('dt-filter-layers');
            var hasOrte = orteCb ? orteCb.checked : true;
            var hasAdr  = adrCb  ? adrCb.checked  : true;
            var hasLay  = layCb  ? layCb.checked  : true;
            var isDefault = (canton === '') && hasOrte && hasAdr && hasLay;
            filterBtn.classList.toggle('has-filter', !isDefault);
        }
        updateFilterIndicator();

        // Radio/Checkbox-Änderungen: sofort neu suchen
        if (popup) {
            popup.addEventListener('change', function () {
                updateFilterIndicator();
                var q = input.value.trim();
                if (q.length >= 3) doSearch(q);
            });
        }

        input.addEventListener('input', function () {
            var q = input.value.trim();
            if (clearBtn) clearBtn.style.display = q ? 'flex' : 'none';
            if (debounceTimer) clearTimeout(debounceTimer);
            if (q.length < 3) {
                list.classList.remove('open');
                list.innerHTML = '';
                return;
            }
            debounceTimer = setTimeout(function () { doSearch(q); }, 280);
        });

        if (clearBtn) {
            clearBtn.addEventListener('click', function () {
                input.value = '';
                clearBtn.style.display = 'none';
                list.classList.remove('open');
                list.innerHTML = '';
                clearFeatureHighlight();
                input.focus();
            });
        }

        input.addEventListener('keydown', function (e) {
            var items = list.querySelectorAll('.dt-search-item');
            if (e.key === 'Enter') {
                if (items.length) items[0].click();
                else if (input.value.trim().length >= 3) doSearch(input.value.trim());
                e.preventDefault();
            }
            if (e.key === 'Escape') { list.classList.remove('open'); input.blur(); }
            if (e.key === 'ArrowDown' && items.length) { items[0].focus(); e.preventDefault(); e.stopPropagation(); }
        });

        list.addEventListener('keydown', function (e) {
            var items   = list.querySelectorAll('.dt-search-item');
            var focused = document.activeElement;
            var idx     = Array.prototype.indexOf.call(items, focused);
            if (e.key === 'ArrowDown' && idx < items.length - 1) { items[idx + 1].focus(); e.preventDefault(); e.stopPropagation(); }
            if (e.key === 'ArrowUp') {
                if (idx > 0) items[idx - 1].focus(); else input.focus();
                e.preventDefault(); e.stopPropagation();
            }
            if (e.key === 'Enter' && idx >= 0) items[idx].click();
            if (e.key === 'Escape') { list.classList.remove('open'); input.focus(); }
        });

        document.addEventListener('click', function (e) {
            if (!e.target.closest('#dt-search-bar')) {
                list.classList.remove('open');
            }
            // Popup schliessen bei Klick ausserhalb
            if (popup && !e.target.closest('#dt-search-filter-popup') && !e.target.closest('#dt-search-filter-btn')) {
                popup.classList.remove('open');
                if (filterBtn) filterBtn.classList.remove('active');
            }
        });

        input.addEventListener('focus', function () {
            if (input.value.trim().length >= 3 && !list.children.length) {
                doSearch(input.value.trim());
            }
        });
    }

    // -- Config-basierte Steuerung: njs- und/oder tnet-Suche deaktivieren -----

    function loadSearchConfig() {
        if (typeof JSON5 === 'undefined') return Promise.resolve(null);
        var paths = [
            getAppRoot() + '/tnet/config/tnet-global-config.json5',
            getAppRoot() + '/tnet/tnet-global-config.json5',
            '../tnet/config/tnet-global-config.json5'
        ];
        function tryPath(i) {
            if (i >= paths.length) return Promise.resolve(null);
            return fetch(paths[i])
                .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
                .then(function (t) {
                    var parsed = JSON5.parse(t);
                    if (parsed && parsed.search && parsed.search.zoom) {
                        _searchZoomConfig = parsed.search.zoom;
                    }
                    // Resultat-Limits laden
                    if (parsed && parsed.search) {
                        _searchLimits = {
                            maxAddresses: parsed.search.maxAddresses || 0,
                            maxLocations: parsed.search.maxLocations || 0,
                            maxLayers:    parsed.search.maxLayers    || 0,
                        };
                    }
                    return (parsed && parsed.search) ? parsed.search : null;
                })
                .catch(function () { return tryPath(i + 1); });
        }
        return tryPath(0);
    }

    function applySearchConfig(cfg) {
        if (!cfg) return;
        // njs/TYDAC-Suche deaktivieren
        if (cfg.njsSearchEnabled === false) {
            var njsWrap = document.getElementById('njs_search_wrapper');
            if (njsWrap) njsWrap.style.display = 'none';
            TnetLog.log('[DesktopSearch] njs/MapPlus-Suche deaktiviert (Config)');
        }
        // tnet-Suche deaktivieren
        if (cfg.tnetSearchEnabled === false) {
            var dtBar = document.getElementById('dt-search-bar');
            if (dtBar) dtBar.style.display = 'none';
            TnetLog.log('[DesktopSearch] TNET-Suche deaktiviert (Config)');
        }
    }

    function initWithConfig() {
        ensureSearchBarDOM();
        init();
        loadSearchConfig().then(applySearchConfig);
        loadLayerIndex();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initWithConfig);
    } else {
        initWithConfig();
    }

    window.DesktopSearch = { init: init, search: doSearch };
})();
