/*
 * tnet-search.js  v1.7
 * Desktop-Suchfeld (parallel zur bestehenden njs/SOLR-Suche)
 * Nutzt search-proxy.php -> Layer-Suche (NLS) + swisstopo Geocoder + Feature-Suche
 * Resultate werden gruppiert angezeigt (Orte / Adressen / Themen).
 * v1.5: Filter-Popup (Radios + Checkboxen), Lupe links, Tune rechts
 * v1.6: Feature-Suche (Strassen/Gebäude) mit Geometrie-Highlighting
 * v1.7: Subtitles, Deduplizierung, featureId-Highlight für Geocoder-Adressen
 *
 * @version    1.7
 * @date       2025-02-22
 * @copyright  Trigonet AG
 */
(function () {
    'use strict';

    var PROXY_URL    = '/maps/tnet/api/search-proxy.php';
    var MAPSERVER_URL = 'https://api3.geo.admin.ch/rest/services/api/MapServer/';
    var debounceTimer = null;
    var currentAbort  = null;   // AbortController
    var lastQuery    = '';
    var featureHighlightLayer = null;
    var _searchZoomConfig = null;   // aus tnet-global-config.json5 geladen
    var _resultCache = new Map();   // Client-Cache: query-key → {data, ts}
    var _CACHE_TTL   = 300000;      // 5 min (ms)
    var _CACHE_MAX   = 50;          // max Einträge
    var _ADDR_RESOLUTION = 0.28;    // 1:1000 Massstab (OGC: 1000 × 0.00028 m/px)

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
     * Layer einschalten via TnetLayerSwitch (aus tnet-mapplus-helpers.js).
     * Fallback: setMapBookmark direkt.
     */
    function activateLayer(layerId) {
        if (typeof window.TnetLayerSwitch === 'function') {
            window.TnetLayerSwitch(layerId, 'on');
            return;
        }
        try {
            var njsAM = (window.top && window.top.njs) ? window.top.njs.AppManager
                       : (window.njs ? window.njs.AppManager : null);
            if (njsAM && typeof njsAM.setMapBookmark === 'function') {
                njsAM.setMapBookmark(['main'], 'layers=' + layerId);
                return;
            }
        } catch (e) {}
        console.warn('[DesktopSearch] Layer-Aktivierung fehlgeschlagen:', layerId);
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
            console.warn('[DesktopSearch] Feature-Highlight-Layer konnte nicht erstellt werden:', e);
        }
        return featureHighlightLayer;
    }

    function clearFeatureHighlight() {
        if (featureHighlightLayer) {
            featureHighlightLayer.getSource().clear();
        }
    }

    function highlightFeature(item) {
        var layer = ensureFeatureHighlightLayer();
        if (!layer) return;
        clearFeatureHighlight();

        var url = MAPSERVER_URL + encodeURIComponent(item.layerId)
                + '/' + encodeURIComponent(item.featureId)
                + '?sr=2056&geometryFormat=geojson';

        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.timeout = 8000;
        xhr.onload = function () {
            if (xhr.status !== 200) return;
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
                if (!features.length) return;
                layer.getSource().addFeatures(features);

                // Extent direkt aus Geometrie(n) berechnen
                var extent = features[0].getGeometry().getExtent().slice();
                for (var i = 1; i < features.length; i++) {
                    ol.extent.extend(extent, features[i].getGeometry().getExtent());
                }
                console.log('[DesktopSearch] Feature extent:', extent);

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
                console.warn('[DesktopSearch] Feature-Geometrie konnte nicht geladen werden:', e);
            }
        };
        xhr.onerror = xhr.ontimeout = function () {
            console.warn('[DesktopSearch] Feature-Geometrie Timeout/Fehler');
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
                console.log('[DesktopSearch] Parcel extent:', extent);

                var zl = getZoomLevels();
                view.fit(extent, {
                    padding: [50, 50, 50, 50],
                    minZoom: zl.fitMin,
                    maxZoom: zl.fitMax,
                    duration: 500,
                    constrainResolution: false
                });
            } catch (e) {
                console.warn('[DesktopSearch] Parcel-Geometrie Fehler:', e);
                panToResult(x, y);
            }
        };
        xhr.onerror = xhr.ontimeout = function () {
            console.warn('[DesktopSearch] Parcel-Identify Timeout');
            panToResult(x, y);
        };
        xhr.send();
    }

    // -- Icons (extern aus /maps/tnet/resources/icons/) -----------------------

    var ICON_BASE = '/maps/tnet/resources/icons/';
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
        var fullUrl = buildSearchUrl(query);
        var fullCacheKey = getCacheKey(fullUrl);

        // Client-Cache: Vollergebnis vorhanden? Sofort anzeigen.
        var cachedFull = _resultCache.get(fullCacheKey);
        if (cachedFull && (Date.now() - cachedFull.ts) < _CACHE_TTL) {
            showGroupedResults(cachedFull.data.groups, cachedFull.data.items);
            return;
        }

        // Phase 1: Fast-Modus (nur Adressen + Layers)
        var fastUrl = buildSearchUrl(query, 'fast');
        var fastCacheKey = getCacheKey(fastUrl);
        var cachedFast = _resultCache.get(fastCacheKey);

        var ac = new AbortController();
        currentAbort = ac;

        if (cachedFast && (Date.now() - cachedFast.ts) < _CACHE_TTL) {
            // Fast aus Cache → sofort anzeigen
            showGroupedResults(cachedFast.data.groups, cachedFast.data.items);
        } else {
            // Fast-Request starten
            fetch(fastUrl, { signal: ac.signal })
                .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
                .then(function (data) {
                    if (_searchId !== myId) return;  // Veralteter Request
                    if (_resultCache.size >= _CACHE_MAX) {
                        _resultCache.delete(_resultCache.keys().next().value);
                    }
                    _resultCache.set(fastCacheKey, { data: data, ts: Date.now() });
                    // Nur anzeigen wenn Full noch nicht da ist
                    if (!_resultCache.has(fullCacheKey) || (Date.now() - _resultCache.get(fullCacheKey).ts) >= _CACHE_TTL) {
                        showGroupedResults(data.groups, data.items);
                    }
                })
                .catch(function () {});
        }

        // Phase 2: Full-Request (parallel starten)
        fetch(fullUrl, { signal: ac.signal })
            .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
            .then(function (data) {
                if (_searchId !== myId) return;  // Veralteter Request
                if (_resultCache.size >= _CACHE_MAX) {
                    _resultCache.delete(_resultCache.keys().next().value);
                }
                _resultCache.set(fullCacheKey, { data: data, ts: Date.now() });
                showGroupedResults(data.groups, data.items);
            })
            .catch(function (e) {
                if (e.name !== 'AbortError') showGroupedResults(null, []);
            });
    }

    // -- Event-Binding --------------------------------------------------------

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
            '/maps/tnet/config/tnet-global-config.json5',
            '/maps/tnet/tnet-global-config.json5',
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
            console.log('[DesktopSearch] njs/MapPlus-Suche deaktiviert (Config)');
        }
        // tnet-Suche deaktivieren
        if (cfg.tnetSearchEnabled === false) {
            var dtBar = document.getElementById('dt-search-bar');
            if (dtBar) dtBar.style.display = 'none';
            console.log('[DesktopSearch] TNET-Suche deaktiviert (Config)');
        }
    }

    function initWithConfig() {
        init();
        loadSearchConfig().then(applySearchConfig);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initWithConfig);
    } else {
        initWithConfig();
    }

    window.DesktopSearch = { init: init, search: doSearch };
})();
