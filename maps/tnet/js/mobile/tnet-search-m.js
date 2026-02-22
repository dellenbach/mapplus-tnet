/*
 * tnet-search-m.js  v1.8
 * Natives Suchfeld fuer Mobile-Topbar
 * Nutzt search-proxy.php -> Layer-Suche (NLS) + swisstopo Geocoder + Feature-Suche
 * Resultate werden gruppiert angezeigt (Orte / Adressen / Themen).
 * v1.5: Filter-Popup (Radios + Checkboxen statt inline Selects)
 * v1.6: Feature-Suche (Strassen/Gebäude) mit Geometrie-Highlighting
 * v1.7: Subtitles, Deduplizierung, featureId-Highlight für Geocoder-Adressen
 * v1.8: Mobile Zoom-Fix: waitForKeyboardClose + aggressiver ViewGuard + Debug-Funktion
 *
 * @version    1.8
 * @date       2025-02-22
 * @copyright  Trigonet AG
 */
(function () {
    'use strict';

    var PROXY_URL    = '/maps/tnet/api/search-proxy.php';
    var MAPSERVER_URL = 'https://api3.geo.admin.ch/rest/services/api/MapServer/';
    var debounceTimer = null;
    var currentXhr   = null;
    var lastQuery    = '';
    var featureHighlightLayer = null;

    // -- Map/Layer Helpers ---------------------------------------------------

    function getMap() {
        try { return njs.AppManager.Maps['main'].mapObj; } catch (e) { return null; }
    }

    function getMapView() {
        try { return njs.AppManager.Maps['main'].mapObj.getView(); } catch (e) { return null; }
    }

    // -- Keyboard-aware Zoom --------------------------------------------------
    // Wartet bis die Tastatur vollständig geschlossen ist (viewport stabil),
    // dann setzt den View und bewacht ihn für 4s gegen Framework-Resets.

    var _searchViewGuardKey = null;
    var _searchViewGuardTimer = null;
    var _searchSavedView = null;
    var _searchGuardCount = 0;

    /**
     * Setzt View und bewacht ihn aggressiv gegen Resets.
     * Wird NACH dem Keyboard-Close aufgerufen (delayed).
     */
    function applyAndGuardView(map, view, center, zoom) {
        stopViewGuard();
        window._tnetBlockResize = true;
        _searchSavedView = { center: center.slice(), zoom: zoom };
        _searchGuardCount = 0;

        function forceView() {
            try { view.cancelAnimations(); } catch (e) {}
            view.setCenter(_searchSavedView.center);
            view.setZoom(_searchSavedView.zoom);
            console.log('[MobileSearch] forceView applied, zoom=' + _searchSavedView.zoom);
        }

        // Sofort setzen
        forceView();

        // Mehrfach nachsetzen um Framework-Resets zu überleben
        // (Resize-Events kommen oft in Wellen: 100ms, 300ms, 600ms nach Keyboard-Close)
        setTimeout(forceView, 150);
        setTimeout(forceView, 400);
        setTimeout(forceView, 800);

        // moveend-Guard für unvorhergesehene Resets
        _searchViewGuardKey = map.on('moveend', function () {
            if (!_searchSavedView) return;
            var curZoom = view.getZoom();
            var curCenter = view.getCenter();
            var zoomDiff = Math.abs(curZoom - _searchSavedView.zoom);
            var dx = Math.abs(curCenter[0] - _searchSavedView.center[0]);
            var dy = Math.abs(curCenter[1] - _searchSavedView.center[1]);
            if (zoomDiff > 0.3 || dx > 100 || dy > 100) {
                _searchGuardCount++;
                console.log('[MobileSearch] ViewGuard #' + _searchGuardCount +
                    ': zoom ' + curZoom.toFixed(1) + '->' + _searchSavedView.zoom +
                    ' dx=' + dx.toFixed(0) + ' dy=' + dy.toFixed(0) + ', restoring');
                forceView();
            }
        });

        // Guard nach 4s beenden
        _searchViewGuardTimer = setTimeout(function () {
            console.log('[MobileSearch] ViewGuard ended after 4s (restored ' + _searchGuardCount + 'x)');
            stopViewGuard();
        }, 4000);
    }

    function stopViewGuard() {
        if (_searchViewGuardKey) {
            ol.Observable.unByKey(_searchViewGuardKey);
            _searchViewGuardKey = null;
        }
        if (_searchViewGuardTimer) {
            clearTimeout(_searchViewGuardTimer);
            _searchViewGuardTimer = null;
        }
        _searchSavedView = null;
        _searchGuardCount = 0;
        window._tnetBlockResize = false;
    }

    /**
     * Wartet auf stabile Viewport-Höhe (Tastatur geschlossen), dann ruft callback.
     * Prüft alle 100ms ob innerHeight sich stabilisiert hat.
     */
    function waitForKeyboardClose(callback) {
        var stableHeight = window.innerHeight;
        var stableCount = 0;
        var checks = 0;
        var maxChecks = 20; // max 2s warten

        var interval = setInterval(function () {
            checks++;
            if (window.innerHeight === stableHeight) {
                stableCount++;
            } else {
                stableHeight = window.innerHeight;
                stableCount = 0;
            }
            // 3 stabile Messungen (300ms stabil) oder Timeout
            if (stableCount >= 3 || checks >= maxChecks) {
                clearInterval(interval);
                console.log('[MobileSearch] Keyboard settled after ' + (checks * 100) + 'ms, height=' + stableHeight);
                callback();
            }
        }, 100);
    }

    /** Zur Koordinate zoomen. x=Northing, y=Easting (LV95) */
    function panToResult(x, y, zoom) {
        var map  = getMap();
        var view = getMapView();
        console.log('[MobileSearch] panToResult x=' + x + ' y=' + y);
        if (!view || !map || x == null || y == null) return;
        var mapProj = view.getProjection().getCode();
        var coord = (typeof ol !== 'undefined' && ol.proj)
            ? ol.proj.transform([y, x], 'EPSG:2056', mapProj)
            : [y, x];
        var targetZoom = zoom || 14;

        // Warte bis Tastatur geschlossen, dann zoomen + bewachen
        waitForKeyboardClose(function () {
            applyAndGuardView(map, view, coord, targetZoom);
        });
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
        // Fallback: setMapBookmark direkt (falls Helpers noch nicht geladen)
        try {
            var njsAM = (window.top && window.top.njs) ? window.top.njs.AppManager
                       : (window.njs ? window.njs.AppManager : null);
            if (njsAM && typeof njsAM.setMapBookmark === 'function') {
                njsAM.setMapBookmark(['main'], 'layers=' + layerId);
                return;
            }
        } catch (e) {}
        console.warn('[MobileSearch] Layer-Aktivierung fehlgeschlagen:', layerId);
    }

    // -- Feature Highlight ----------------------------------------------------

    function ensureFeatureHighlightLayer() {
        if (featureHighlightLayer) return featureHighlightLayer;
        try {
            var map = njs.AppManager.Maps['main'].mapObj;
            featureHighlightLayer = new ol.layer.Vector({
                source: new ol.source.Vector(),
                name: 'tnet_feature_highlight_m',
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
            console.warn('[MobileSearch] Feature-Highlight-Layer konnte nicht erstellt werden:', e);
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
                console.log('[MobileSearch] Feature extent:', extent);

                var w = extent[2] - extent[0];
                var h = extent[3] - extent[1];
                var map = getMap();
                if (!map) return;

                // Zoom NACH Keyboard-Close anwenden
                waitForKeyboardClose(function () {
                    if (w > 1 || h > 1) {
                        // Flächen-Geometrie: fitten
                        try { view.cancelAnimations(); } catch (e2) {}
                        view.fit(extent, {
                            padding: [50, 50, 50, 50],
                            minZoom: 12,
                            maxZoom: 16,
                            duration: 0
                        });
                        // Guard mit resultierendem Center/Zoom
                        applyAndGuardView(map, view, view.getCenter(), view.getZoom());
                        console.log('[MobileSearch] fit applied, zoom=' + view.getZoom().toFixed(1));
                    } else {
                        // Punkt-Geometrie: zur Mitte zoomen
                        var cx = (extent[0] + extent[2]) / 2;
                        var cy = (extent[1] + extent[3]) / 2;
                        applyAndGuardView(map, view, [cx, cy], 14);
                    }
                });
            } catch (e) {
                console.warn('[MobileSearch] Feature-Geometrie konnte nicht geladen werden:', e);
            }
        };
        xhr.onerror = xhr.ontimeout = function () {
            console.warn('[MobileSearch] Feature-Geometrie Timeout/Fehler');
        };
        xhr.send();
    }

    // -- Icons (extern aus /maps/tnet/resources/icons/) -----------------------

    var ICON_BASE = '/maps/tnet/resources/icons/';
    var ICON_CSS  = 'm-search-item-icon';
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
                // CSS-Klasse injizieren
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

    /**
     * Dropdown mit gruppierten Resultaten fuellen.
     * Erwartet groups: [{label, type, items: [{id,label,type,x,y,layer}]}]
     * Fallback: items-Array direkt (ohne Gruppen).
     */
    function showGroupedResults(groups, itemsFallback) {
        var list = document.getElementById('m-search-results');
        if (!list) return;
        list.innerHTML = '';

        var hasItems = false;

        if (groups && groups.length) {
            groups.forEach(function (group) {
                if (!group.items || !group.items.length) return;

                var header = document.createElement('li');
                header.className = 'm-search-group-header';
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
        return text.replace(new RegExp('(' + safe + ')', 'gi'), '<b class="m-search-highlight">$1</b>');
    }

    function makeItem(item) {
        var li = document.createElement('li');
        li.className = 'm-search-item';
        li.setAttribute('role', 'option');
        li.setAttribute('tabindex', '-1');
        var icon = getItemIcon(item);
        var label = highlightText(item.label || '', lastQuery);
        var html = icon + '<span class="m-search-item-text">' +
            '<span class="m-search-item-label">' + label + '</span>';
        if (item.subtitle) {
            html += '<span class="m-search-item-subtitle">' + item.subtitle + '</span>';
        }
        html += '</span>';
        li.innerHTML = html;

        li.addEventListener('click', function () {
            var inp  = document.getElementById('m-search-input');
            var lst  = document.getElementById('m-search-results');
            var clr  = document.getElementById('m-search-clear');

            // Immer vorherigen Feature-Highlight entfernen
            clearFeatureHighlight();
            // Vorherigen View-Guard stoppen
            stopViewGuard();

            // SOFORT Resize blockieren bevor Tastatur schliesst (blur → resize)
            // Der Guard in panToResult/highlightFeature übernimmt danach
            if (item.type !== 'layer') {
                window._tnetBlockResize = true;
            }

            // Input blur: Tastatur schliessen bevor Karte bewegt wird
            if (inp) inp.blur();

            if (item.type === 'layer') {
                if (inp)  { inp.value = ''; }
                if (clr)  { clr.style.display = 'none'; }
                if (lst)  { lst.classList.remove('open'); lst.innerHTML = ''; }
                activateLayer(item.layer || item.id);
            } else if (item.type === 'feature' || item.featureId) {
                if (inp) inp.value = item.label;
                if (lst) lst.classList.remove('open');
                // Kurze Verzögerung: Tastatur schliesst sich
                setTimeout(function () {
                    if (item.layerId && item.featureId) {
                        highlightFeature(item);
                    } else if (item.x && item.y) {
                        panToResult(item.x, item.y);
                    }
                }, 150);
            } else {
                if (inp) inp.value = item.label;
                if (lst) lst.classList.remove('open');
                setTimeout(function () {
                    panToResult(item.x, item.y);
                }, 150);
            }
        });

        return li;
    }

    // -- XHR ------------------------------------------------------------------

    function doSearch(query) {
        lastQuery = query;
        if (currentXhr) { try { currentXhr.abort(); } catch (e) {} }

        // Kanton aus Radio-Buttons lesen
        var cantonRadio = document.querySelector('input[name="m-canton"]:checked');
        var canton = cantonRadio ? cantonRadio.value : '';

        // Scope aus Checkboxen ableiten
        var orteCb = document.getElementById('m-filter-orte');
        var adrCb  = document.getElementById('m-filter-adressen');
        var layCb  = document.getElementById('m-filter-layers');
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

        var url = PROXY_URL + '?q=' + encodeURIComponent(query) + '&limit=8';
        if (canton) url += '&canton=' + encodeURIComponent(canton);
        if (scope)  url += '&scope='  + encodeURIComponent(scope);
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.timeout = 6000;
        xhr.onload = function () {
            if (xhr.status === 200) {
                try {
                    var data = JSON.parse(xhr.responseText);
                    showGroupedResults(data.groups, data.items);
                } catch (e) { showGroupedResults(null, []); }
            }
        };
        xhr.onerror = xhr.ontimeout = function () { showGroupedResults(null, []); };
        xhr.send();
        currentXhr = xhr;
    }

    // -- Event-Binding --------------------------------------------------------

    function init() {
        var input    = document.getElementById('m-search-input');
        var list     = document.getElementById('m-search-results');
        var clearBtn = document.getElementById('m-search-clear');
        var filterBtn = document.getElementById('m-search-filter-btn');
        var popup    = document.getElementById('m-search-filter-popup');

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
            var cantonRadio = document.querySelector('input[name="m-canton"]:checked');
            var canton = cantonRadio ? cantonRadio.value : '';
            var orteCb = document.getElementById('m-filter-orte');
            var adrCb  = document.getElementById('m-filter-adressen');
            var layCb  = document.getElementById('m-filter-layers');
            var hasOrte = orteCb ? orteCb.checked : true;
            var hasAdr  = adrCb  ? adrCb.checked  : true;
            var hasLay  = layCb  ? layCb.checked  : true;
            // Default = Alle Kantone + alle 3 Checkboxen an
            var isDefault = (canton === '') && hasOrte && hasAdr && hasLay;
            filterBtn.classList.toggle('has-filter', !isDefault);
        }
        updateFilterIndicator();

        // Radio/Checkbox-Änderungen: sofort neu suchen
        var filterPopup = document.getElementById('m-search-filter-popup');
        if (filterPopup) {
            filterPopup.addEventListener('change', function () {
                updateFilterIndicator();
                var q = input.value.trim();
                if (q.length >= 2) doSearch(q);
            });
        }

        input.addEventListener('input', function () {
            var q = input.value.trim();
            if (clearBtn) clearBtn.style.display = q ? 'flex' : 'none';
            if (debounceTimer) clearTimeout(debounceTimer);
            if (q.length < 2) {
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
            var items = list.querySelectorAll('.m-search-item');
            if (e.key === 'Enter') {
                if (items.length) items[0].click();
                else if (input.value.trim().length >= 2) doSearch(input.value.trim());
                e.preventDefault();
            }
            if (e.key === 'Escape') { list.classList.remove('open'); input.blur(); }
            if (e.key === 'ArrowDown' && items.length) { items[0].focus(); e.preventDefault(); }
        });

        list.addEventListener('keydown', function (e) {
            var items   = list.querySelectorAll('.m-search-item');
            var focused = document.activeElement;
            var idx     = Array.prototype.indexOf.call(items, focused);
            if (e.key === 'ArrowDown' && idx < items.length - 1) { items[idx + 1].focus(); e.preventDefault(); }
            if (e.key === 'ArrowUp') {
                if (idx > 0) items[idx - 1].focus(); else input.focus();
                e.preventDefault();
            }
            if (e.key === 'Enter' && idx >= 0) items[idx].click();
            if (e.key === 'Escape') { list.classList.remove('open'); input.focus(); }
        });

        document.addEventListener('click', function (e) {
            if (!e.target.closest('#m-search-bar')) {
                list.classList.remove('open');
            }
            // Popup schliessen bei Klick ausserhalb
            if (popup && !e.target.closest('#m-search-filter-popup') && !e.target.closest('#m-search-filter-btn')) {
                popup.classList.remove('open');
                if (filterBtn) filterBtn.classList.remove('active');
            }
        });

        input.addEventListener('focus', function () {
            if (input.value.trim().length >= 2 && !list.children.length) {
                doSearch(input.value.trim());
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.MobileSearch = { init: init, search: doSearch };

    // -- Console Debug-Funktion -----------------------------------------------
    // Auch auf window.top exponieren (Script läuft im iframe)
    var debugObj = {
        /** Aktuellen View-State anzeigen */
        status: function () {
            var map = getMap();
            var view = getMapView();
            if (!view) { console.log('Kein Map-View verfügbar'); return; }
            var c = view.getCenter();
            var z = view.getZoom();
            var r = view.getResolution();
            var target = map ? map.getTargetElement() : null;
            var size = target ? (target.clientWidth + 'x' + target.clientHeight) : 'unknown';
            console.log('[Debug] Center:', c, 'Zoom:', z.toFixed(2), 'Resolution:', r.toFixed(4));
            console.log('[Debug] Map-Container:', size, 'innerHeight:', window.innerHeight);
            console.log('[Debug] _tnetBlockResize:', !!window._tnetBlockResize, 'Guard active:', !!_searchSavedView);
            if (_searchSavedView) console.log('[Debug] Guard savedView:', _searchSavedView);
        },
        /** Zoom auf bestimmtes Level testen */
        zoom: function (level) {
            var view = getMapView();
            if (!view) { console.log('Kein View'); return; }
            view.setZoom(level || 16);
            console.log('[Debug] Zoom gesetzt auf', level || 16);
        },
        /** Zu Koordinate zoomen (LV95 Easting, Northing) */
        zoomTo: function (easting, northing, level) {
            var view = getMapView();
            if (!view) { console.log('Kein View'); return; }
            view.setCenter([easting, northing]);
            view.setZoom(level || 16);
            console.log('[Debug] Center:', [easting, northing], 'Zoom:', level || 16);
        },
        /** Zoom testen mit Guard */
        zoomGuarded: function (easting, northing, level) {
            var map = getMap();
            var view = getMapView();
            if (!map || !view) { console.log('Kein Map/View'); return; }
            applyAndGuardView(map, view, [easting, northing], level || 16);
        },
        /** Guard manuell stoppen */
        stopGuard: function () {
            stopViewGuard();
            console.log('[Debug] Guard gestoppt');
        },
        /** Auf Extent zoomen [minE, minN, maxE, maxN] */
        fitExtent: function (minE, minN, maxE, maxN, maxZoom) {
            var view = getMapView();
            if (!view) { console.log('Kein View'); return; }
            view.fit([minE, minN, maxE, maxN], {
                padding: [50, 50, 50, 50],
                minZoom: 14,
                maxZoom: maxZoom || 17,
                duration: 0
            });
            console.log('[Debug] fitExtent done, zoom=' + view.getZoom().toFixed(2));
        },
        /** Test: Zoom auf Aemättlihof-Gebiet in Stans */
        testAem: function () {
            this.fitExtent(2669826, 1201590, 2669925, 1201790);
        },
        /** Test: Zoom auf Stans Zentrum */
        testStans: function () {
            this.zoomTo(2670100, 1201800, 16);
        }
    };
    window.MobileSearchDebug = debugObj;
    try { if (window.top && window.top !== window) window.top.MobileSearchDebug = debugObj; } catch (e) {}
    console.log('[MobileSearch] Debug: MobileSearchDebug.status() / .zoom(16) / .zoomTo(e,n,z) / .zoomGuarded(e,n,z)');
})();
