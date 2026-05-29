/**
 * tnet-basemap.js
 * ================
 * Zentrales Basemap-Modul für TNET WebGIS.
 *
 * Konsolidiert alle Basemap-Funktionalität:
 *  1. Widget UI: Toggle, Card-Auswahl, Expand, delegierter Click-Handler
 *  2. Grundkarten-Layer-Sync: Höhenkurven, Projektebene, Gemeindegrenzen EIN/AUS
 *  3. Zeitreise: WMTS-Overlay für historische Basemaps (Slider, Jahrgänge)
 *  4. Opacity / Grayscale Hooks auf Framework-Funktionen
 *  5. changeBaseMap Hook inkl. fallbackBasemap-Logik
 *
 * Config: tnet-global-config.json5 → basemaps.timeDimension
 * Benötigt: JSON5 Library, OpenLayers, njs.AppManager (mapplus Framework)
 *
 * @version    2.0
 * @date       2026-02-19
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */
(function() {
    'use strict';

    function getAppRoot() {
        return window.__TNET_APP_ROOT || '/maps';
    }

    var LOG_PREFIX = '[Basemap]';

    // =========================================================
    // 1. KONSTANTEN — swisstopo WMTS TileGrid für EPSG:2056
    // =========================================================

    var SWISSTOPO_RESOLUTIONS = [
        4000, 3750, 3500, 3250, 3000, 2750, 2500, 2250, 2000, 1750,
        1500, 1250, 1000, 750, 650, 500, 250, 100, 50, 20,
        10, 5, 2.5, 2, 1.5, 1, 0.5, 0.25, 0.1
    ];
    var SWISSTOPO_MATRIX_IDS = [];
    for (var _i = 0; _i < SWISSTOPO_RESOLUTIONS.length; _i++) {
        SWISSTOPO_MATRIX_IDS.push(_i.toString());
    }

    // Exportieren für SplitScreen und 3D-Landscape
    window.SWISSTOPO_RESOLUTIONS = SWISSTOPO_RESOLUTIONS;
    window.SWISSTOPO_MATRIX_IDS = SWISSTOPO_MATRIX_IDS;

    // =========================================================
    // 2. CONFIG LOADER
    // =========================================================

    /**
     * Lädt die TimeDimension-Config ASYNCHRON via fetch.
     * Gibt ein Promise zurück, das mit der Config oder null resolved.
     * Cached in window._basemapTimeConfig.
     */
    function loadTimeDimensionConfigAsync() {
        if (window._basemapTimeConfig) return Promise.resolve(window._basemapTimeConfig);
        if (typeof JSON5 === 'undefined') {
            TnetLog.error(LOG_PREFIX, 'JSON5-Library nicht verfügbar!');
            return Promise.resolve(null);
        }
        var paths = [
            getAppRoot() + '/tnet/config/tnet-global-config.json5',
            getAppRoot() + '/tnet/tnet-global-config.json5',
            '../tnet/config/tnet-global-config.json5'
        ];

        // Sequenziell Pfade durchprobieren (async, nicht-blockierend)
        function tryPath(index) {
            if (index >= paths.length) {
                TnetLog.error(LOG_PREFIX, 'Config nicht gefunden (basemaps.timeDimension)');
                return Promise.resolve(null);
            }
            return fetch(paths[index])
                .then(function(response) {
                    if (!response.ok) throw new Error('HTTP ' + response.status);
                    return response.text();
                })
                .then(function(text) {
                    var parsed = JSON5.parse(text);
                    if (parsed && parsed.basemaps && parsed.basemaps.timeDimension) {
                        TnetLog.log(LOG_PREFIX, 'Config geladen (async):', paths[index]);
                        window._basemapTimeConfig = parsed.basemaps.timeDimension;
                        return window._basemapTimeConfig;
                    }
                    return tryPath(index + 1);
                })
                .catch(function(e) {
                    TnetLog.warn(LOG_PREFIX, 'Config-Fehler (' + paths[index] + '):', e.message);
                    return tryPath(index + 1);
                });
        }
        return tryPath(0);
    }


    // =========================================================
    // 3. WIDGET UI — Toggle, Cards, Expand
    // =========================================================

    /**
     * Basemap-Widget ein-/ausblenden
     */
    window.toggleBasemapWidget = function() {
        var widget = document.getElementById('basemap_widget');
        var selector = document.getElementById('basemap_selector');
        if (widget && selector) {
            widget.classList.toggle('basemap-widget-hidden');
            selector.classList.toggle('hidden');
        }
    };

    /**
     * Delegierter Click-Handler für alle Basemap-Cards.
     * Liest data-basemap aus und ruft changeBaseMap auf.
     * Setzt Active-Klasse auf die angeklickte Card.
     */
    function initBasemapCards() {
        // Delegierter Handler auf dem Widget
        var widget = document.getElementById('basemap_widget');
        if (!widget) return;

        // Pointer-Events im Widget stoppen, damit OL-Map nicht reagiert
        widget.addEventListener('pointerdown', function(e) { e.stopPropagation(); });
        widget.addEventListener('mousedown', function(e) { e.stopPropagation(); });

        widget.addEventListener('click', function(e) {
            var card = e.target.closest('.basemap-card');
            if (!card) return;

            var basemapId = card.dataset.basemap;
            if (!basemapId) return;

            // Bereits aktiv → nichts tun
            if (card.classList.contains('active')) return;

            // Active-Klasse: Alle Cards deaktivieren, diese aktivieren
            document.querySelectorAll('.basemap-card').forEach(function(c) {
                c.classList.remove('active');
            });
            card.classList.add('active');

            // Basemap wechseln (via gehooktes changeBaseMap)
            if (window.njs && njs.AppManager && njs.AppManager.Maps && njs.AppManager.Maps.main) {
                njs.AppManager.Maps['main'].changeBaseMap(basemapId);
            }
        });

        // Expand Header — erweiterte Basemap-Auswahl aufklappen
        var expandHeader = widget.querySelector('.basemap-expand-header');
        if (expandHeader) {
            expandHeader.addEventListener('click', function() {
                var cards = widget.querySelector('.basemap-cards');
                var icon = this.querySelector('.expand-icon');
                if (cards) {
                    cards.classList.toggle('expanded');
                    icon.textContent = cards.classList.contains('expanded') ? '▼' : '▶';
                }
            });
        }
    }


    // =========================================================
    // 4. GRUNDKARTEN-LAYER-SYNC — Höhenkurven, Projektebene, Gemeindegrenzen
    // =========================================================

    var GRUNDKARTEN_LAYER_MAPPING = {
        'hoehenkurven': 'gis_basis/nw_basisplan_gis_dynamisch/hoehenlinien',
        'projektebene': 'gis_basis/nw_basisplan_gis_dynamisch/grundbuchplan_projektierte_objekte',
        'gemeindegrenzen': 'gis_basis/nw_basisplan_gis_dynamisch/gemeindegrenzen'
    };

    // Global exportieren (für andere Module die darauf zugreifen)
    window.GRUNDKARTEN_LAYER_MAPPING = GRUNDKARTEN_LAYER_MAPPING;

    /**
     * Alle Grundkarten-Buttons optisch auf AUS setzen.
     */
    window.setGrundkartenButtonsDefaultAus = function() {
        Object.keys(GRUNDKARTEN_LAYER_MAPPING).forEach(function(btnId) {
            var btnEin = document.getElementById('btn-' + btnId + '-ein');
            var btnAus = document.getElementById('btn-' + btnId + '-aus');
            if (btnEin && btnAus) {
                btnEin.classList.remove('active');
                btnAus.classList.add('active');
                btnEin.setAttribute('aria-pressed', 'false');
                btnAus.setAttribute('aria-pressed', 'true');
            }
        });
    };

    function hasRecentBookmarkStartRequest() {
        var now = Date.now();
        var topWin = (window.top && window.top !== window) ? window.top : null;
        var requestedAt = Number(window.__tnetLastRequestedBookmarkAt || (topWin && topWin.__tnetLastRequestedBookmarkAt) || 0);

        return requestedAt > 0 && (now - requestedAt) < 15000;
    }

    function shouldSkipGrundkartenDefaults() {
        try {
            if (hasRecentBookmarkStartRequest()) {
                return true;
            }
            var path = String((window.location && window.location.pathname) || '');
            return /\/maps(?:-dev)?\/[a-zA-Z0-9_-]+\/?$/.test(path);
        } catch (ePath) {
            return false;
        }
    }

    /**
     * Grundkarten-Layer beim App-Start ausschalten.
     */
    function initGrundkartenDefaults() {
        var trySet = function() {
            if (!window.njs || !njs.AppManager || !njs.AppManager.setMapBookmark || !njs.AppManager.infoFloatWinRemoveallItems) {
                setTimeout(trySet, 200);
                return;
            }

            if (shouldSkipGrundkartenDefaults()) {
                TnetLog.log(LOG_PREFIX, 'GrundkartenDefaults übersprungen (Bookmark-Start aktiv)');

                var bookmarkMap = (njs.AppManager.Maps && njs.AppManager.Maps.main && njs.AppManager.Maps.main.mapObj)
                        ? njs.AppManager.Maps.main.mapObj : null;
                if (bookmarkMap) {
                    window._olMap = bookmarkMap;
                    initGrundkartenLayerSync(bookmarkMap);
                }
                return;
            }

            // Alle Grundkarten-Layer auf aus
            Object.keys(GRUNDKARTEN_LAYER_MAPPING).forEach(function(key) {
                try {
                    var params = 'layers=-' + GRUNDKARTEN_LAYER_MAPPING[key];
                    window.top.njs.AppManager.setMapBookmark(['main'], params);
                } catch(e) {
                    TnetLog.warn(LOG_PREFIX, 'GrundkartenSync Fehler:', GRUNDKARTEN_LAYER_MAPPING[key], e);
                }
            });

            // OL-Map global verfügbar machen (für ol-pdf-printer und andere Erweiterungen)
            var map = (njs.AppManager.Maps && njs.AppManager.Maps.main && njs.AppManager.Maps.main.mapObj)
                    ? njs.AppManager.Maps.main.mapObj : null;
            if (map) {
                window._olMap = map;
                TnetLog.log(LOG_PREFIX, 'window._olMap gesetzt ✓');
            }

            // Layer-Toggle Buttons initialisieren
            initGrundkartenLayerSync(map);
        };
        trySet();
    }

    /**
     * Registriert die EIN/AUS Toggle-Buttons für Grundkarten-Layer.
     */
    function initGrundkartenLayerSync(map) {
        var layerState = {};
        Object.keys(GRUNDKARTEN_LAYER_MAPPING).forEach(function(key) {
            layerState[GRUNDKARTEN_LAYER_MAPPING[key]] = false;
        });

        function getNonGrundkartenLayers() {
            if (!map) return [];
            var visibleLayers = [];
            var grundkartenLayerNames = Object.keys(layerState);
            map.getLayers().forEach(function(layer) {
                if (layer.getVisible()) {
                    var name = layer.get('name') || layer.get('title');
                    if (name && grundkartenLayerNames.indexOf(name) === -1) {
                        visibleLayers.push(name);
                    }
                }
            });
            return visibleLayers;
        }

        var buttons = document.querySelectorAll('.toggle-btn[data-layer]');
        buttons.forEach(function(btn) {
            btn.addEventListener('click', function() {
                var layerId = this.getAttribute('data-layer');
                var value = this.getAttribute('data-value');

                var layerName = GRUNDKARTEN_LAYER_MAPPING[layerId];
                if (!layerName) return; // Farbmodus etc. nicht hier behandelt

                try {
                    var visible = (value === 'on');
                    layerState[layerName] = visible;

                    var allLayers = getNonGrundkartenLayers();
                    Object.keys(layerState).forEach(function(name) {
                        if (layerState[name]) allLayers.push(name);
                    });

                    var params = 'layers=' + allLayers.join('|');
                    window.top.njs.AppManager.setMapBookmark(['main'], params);

                    // Active-Klasse wechseln
                    var siblings = this.parentElement.querySelectorAll('.toggle-btn');
                    siblings.forEach(function(s) { s.classList.remove('active'); });
                    this.classList.add('active');
                } catch(e) {
                    TnetLog.error(LOG_PREFIX, 'Layer-Toggle Fehler:', e);
                }
            });
        });

        TnetLog.log(LOG_PREFIX, 'GrundkartenSync:', buttons.length, 'Buttons registriert');
    }

    // Global exportieren (tnet-app.js referenziert es)
    window.initGrundkartenLayerSync = initGrundkartenLayerSync;


    // =========================================================
    // 5. ZEITREISE — BasemapTimeManager
    // =========================================================

    var BasemapTimeManager = {
        config: null,
        currentBasemap: null,
        currentYear: null,
        currentYears: [],
        _timeOverlayLayer: null,

        // DOM
        containerEl: null,
        sliderEl: null,
        labelEl: null,
        resetBtn: null,
        minEl: null,
        maxEl: null,
        infoEl: null,
        infoTextEl: null,

        // Visual state (synced from widget controls)
        _currentOpacity: 1,       // 0..1 (1 = fully opaque)
        _isGrayscale: false,
        _grayscaleListeners: {},  // prerender/postrender-Listener je Layer-Key
        _grayscaleListenerCnt: 0, // Zaehler fuer eindeutige Listener-Keys
        _grayscaleSourceEntries: [],

        // Timers für hide-Animationen (Race-Condition-Schutz)
        _hideSliderTimer: null,
        _hideInfoTimer: null,

        // Dynamic (Landeskarte)
        _moveEndHandler: null,
        _moveEndDebounceTimer: null,
        _lastIdentifyCenter: null,

        // ── Init ──

        init: function() {
            var self = this;

            // Config asynchron laden — blockiert den Main-Thread NICHT mehr
            loadTimeDimensionConfigAsync().then(function(config) {
                self.config = config;
                if (!self.config) {
                    TnetLog.warn(LOG_PREFIX, 'Keine timeDimension-Config, Zeitreise deaktiviert');
                    return;
                }
                self._initDOM();
            });
        },

        /**
         * DOM-Initialisierung (nach Config-Load)
         */
        _initDOM: function() {
            var self = this;

            this.containerEl = document.getElementById('basemap-time-container');
            this.sliderEl    = document.getElementById('basemap-time-slider');
            this.labelEl     = document.getElementById('basemap-time-label');
            this.resetBtn    = document.getElementById('basemap-time-reset');
            this.minEl       = document.getElementById('basemap-time-min');
            this.maxEl       = document.getElementById('basemap-time-max');
            this.infoEl      = document.getElementById('basemap-time-info');
            this.infoTextEl  = document.getElementById('basemap-time-info-text');

            if (!this.containerEl || !this.sliderEl) {
                TnetLog.error(LOG_PREFIX, 'Zeitreise DOM-Elemente nicht gefunden');
                return;
            }

            var self = this;

            // Slider input → change year
            this.sliderEl.addEventListener('input', function() {
                var idx = parseInt(this.value, 10);
                if (self.currentYears[idx] !== undefined) {
                    self.currentYear = self.currentYears[idx];
                    self.updateLabel(self.currentYear);
                    self.applyTimeOverlay(self.currentYear);
                }
            });

            // Reset → jump to most recent year
            if (this.resetBtn) {
                this.resetBtn.addEventListener('click', function() {
                    if (self.currentYears.length > 0) {
                        var lastIdx = self.currentYears.length - 1;
                        self.sliderEl.value = lastIdx;
                        self.currentYear = self.currentYears[lastIdx];
                        self.updateLabel(self.currentYear);
                        self.applyTimeOverlay(self.currentYear);
                    }
                });
            }

            // Detect initial basemap → wird nach hookChangeBaseMap erledigt

            this._hookOpacityAndGrayscale();
            this.hookChangeBaseMap();
            TnetLog.log(LOG_PREFIX, 'Zeitreise initialisiert ✓');
        },

        // ── Basemap Change ──

        onBasemapChange: function(basemapId) {
            this.currentBasemap = basemapId;
            this._cleanupDynamic();
            this.removeTimeOverlay();

            // Nach Basemap-Wechsel: Grau/Farbe auf den neuen Basemap-Renderpfad uebertragen.
            if (this._isGrayscale) {
                var self = this;
                setTimeout(function() { self.syncGrayscale(true); }, 50);
            }

            var cfg = this.config[basemapId];

            if (!cfg) {
                this.hideSlider();
                this.hideInfo();
                return;
            }

            if (cfg.type === 'info') {
                this.hideSlider();
                this.showInfo(cfg.infoText || cfg.label);
                return;
            }

            this.hideInfo();

            if (cfg.type === 'static') {
                this.currentYears = (cfg.years || []).slice().sort(function(a, b) {
                    if (typeof a === 'string' || typeof b === 'string') return 0;
                    return a - b;
                });
                this.initSlider();
                if (this.currentYears.length > 1) {
                    this.showSlider();
                } else {
                    this.hideSlider();
                }
                this.applyTimeOverlay(this.currentYear);
            } else if (cfg.type === 'dynamic') {
                this.currentYears = (cfg.fallbackYears || []).slice().sort(function(a, b) { return a - b; });
                this.initSlider();
                this.showSlider();
                this.applyTimeOverlay(this.currentYear);
                this.startDynamicYearFetch(cfg);
            }
        },

        // ── Slider ──

        initSlider: function() {
            if (this.currentYears.length === 0) return;
            var maxIdx = this.currentYears.length - 1;
            this.sliderEl.min = 0;
            this.sliderEl.max = maxIdx;
            this.sliderEl.step = 1;
            this.sliderEl.value = maxIdx;
            this.currentYear = this.currentYears[maxIdx];
            if (this.minEl) this.minEl.textContent = this.currentYears[0];
            if (this.maxEl) this.maxEl.textContent = this.currentYears[maxIdx];
            this.updateLabel(this.currentYear);
        },

        updateLabel: function(year) {
            if (this.labelEl) this.labelEl.textContent = year;
        },

        showSlider: function() {
            if (!this.containerEl) return;
            // Laufenden hide-Timer abbrechen (Race-Condition-Schutz)
            if (this._hideSliderTimer) {
                clearTimeout(this._hideSliderTimer);
                this._hideSliderTimer = null;
            }
            this.containerEl.style.display = '';
            // Reflow erzwingen → Browser berechnet max-height:0 BEVOR
            // .visible (max-height:100px) die Transition auslöst.
            // Ein einzelner requestAnimationFrame reicht in modernen
            // Browsern nicht mehr zuverlässig aus.
            void this.containerEl.offsetHeight;
            this.containerEl.classList.add('visible');
        },

        hideSlider: function() {
            if (!this.containerEl) return;
            this.containerEl.classList.remove('visible');
            if (this._hideSliderTimer) clearTimeout(this._hideSliderTimer);
            var el = this.containerEl;
            this._hideSliderTimer = setTimeout(function() {
                if (!el.classList.contains('visible')) el.style.display = 'none';
            }, 400);
        },

        showInfo: function(text) {
            if (this.infoEl && this.infoTextEl) {
                // Laufenden hide-Timer abbrechen
                if (this._hideInfoTimer) {
                    clearTimeout(this._hideInfoTimer);
                    this._hideInfoTimer = null;
                }
                this.infoTextEl.textContent = text;
                this.infoEl.style.display = '';
                // Reflow erzwingen (gleiche Logik wie showSlider)
                void this.infoEl.offsetHeight;
                this.infoEl.classList.add('visible');
            }
        },

        hideInfo: function() {
            if (!this.infoEl) return;
            this.infoEl.classList.remove('visible');
            if (this._hideInfoTimer) clearTimeout(this._hideInfoTimer);
            var el = this.infoEl;
            this._hideInfoTimer = setTimeout(function() {
                if (!el.classList.contains('visible')) el.style.display = 'none';
            }, 400);
        },

        // ── WMTS Overlay Layer ──

        applyTimeOverlay: function(year) {
            var cfg = this.config[this.currentBasemap];
            if (!cfg || !cfg.wmtsUrl) return;

            var timeValue;
            if (cfg.timestampFormat === 'YYYYMMDD') {
                timeValue = year + '1231';
            } else {
                timeValue = year.toString();
            }

            var wmtsUrl = cfg.wmtsUrl.replace('{Time}', timeValue);
            TnetLog.log(LOG_PREFIX, 'Overlay:', cfg.wmtsLayer, '→', timeValue);
            this._createOverlayLayer(wmtsUrl, timeValue);
            this._dispatchTimeEvent(year, timeValue);
        },

        _createOverlayLayer: function(wmtsUrl, timeValue) {
            try {
                var mapEntry = njs.AppManager.Maps && njs.AppManager.Maps.main;
                if (!mapEntry || !mapEntry.mapObj) {
                    TnetLog.warn(LOG_PREFIX, 'Karte noch nicht bereit – Overlay wird beim ersten changeBaseMap erstellt');
                    return;
                }
                var mainMap = mapEntry.mapObj;

                this._removeOverlayFromMap(mainMap);

                var source = new ol.source.WMTS({
                    url: wmtsUrl,
                    layer: '',
                    matrixSet: '2056',
                    format: 'image/png',
                    projection: 'EPSG:2056',
                    requestEncoding: 'REST',
                    style: 'default',
                    tileGrid: new ol.tilegrid.WMTS({
                        origin: [2420000, 1350000],
                        resolutions: SWISSTOPO_RESOLUTIONS,
                        matrixIds: SWISSTOPO_MATRIX_IDS
                    }),
                    crossOrigin: 'anonymous'
                });

                var layer = new ol.layer.Tile({
                    source: source,
                    opacity: this._currentOpacity,
                    visible: true,
                    zIndex: -1
                });
                layer.set('_isTimeOverlay', true);
                layer.set('_timeValue', timeValue);

                // An Position 0 einfügen (unter allen Fachlayern) + zIndex -1 als Absicherung
                var layers = mainMap.getLayers();
                layers.insertAt(0, layer);

                this._timeOverlayLayer = layer;
                this._setBaseLayerVisibility(mainMap, false);

                if (this._isGrayscale) {
                    this._applyGrayscaleViaPrerender(true);
                }
            } catch (e) {
                TnetLog.error(LOG_PREFIX, 'Overlay-Layer Fehler:', e);
            }
        },

        _removeOverlayFromMap: function(map) {
            if (!map) return;
            try {
                var layers = map.getLayers().getArray().slice();
                for (var i = 0; i < layers.length; i++) {
                    if (layers[i].get('_isTimeOverlay')) {
                        map.removeLayer(layers[i]);
                    }
                }
            } catch (e) { /* ignore */ }
        },

        _setBaseLayerVisibility: function(map, visible) {
            if (!map) return;
            try {
                var layers = map.getLayers().getArray();
                for (var i = 0; i < layers.length; i++) {
                    var lyr = layers[i];
                    // Nur den echten Basemap-Layer (nicht Time-Overlay, nicht Fachlayer)
                    if (!lyr.get('_isTimeOverlay') && lyr.get('isBaseLayer')) {
                        lyr.setVisible(visible);
                        return;
                    }
                }
                // Fallback: erster Nicht-Overlay-Layer
                for (var j = 0; j < layers.length; j++) {
                    if (!layers[j].get('_isTimeOverlay')) {
                        layers[j].setVisible(visible);
                        break;
                    }
                }
            } catch (e) { /* ignore */ }
        },

        removeTimeOverlay: function() {
            try {
                var mapEntry = njs.AppManager.Maps && njs.AppManager.Maps.main;
                if (!mapEntry || !mapEntry.mapObj) return;
                var mainMap = mapEntry.mapObj;
                this._removeOverlayFromMap(mainMap);
                this._setBaseLayerVisibility(mainMap, true);
            } catch (e) { /* ignore */ }
            this._timeOverlayLayer = null;
        },

        // ── Opacity / Grayscale Sync ──

        _hookOpacityAndGrayscale: function() {
            var self = this;

            if (njs && njs.AppManager && typeof njs.AppManager.setBaseLayerOpacity === 'function') {
                var origOpacity = njs.AppManager.setBaseLayerOpacity;
                njs.AppManager.setBaseLayerOpacity = function(mapId, value) {
                    origOpacity.call(njs.AppManager, mapId, value);
                    if (mapId === 'main') self.syncOpacity(value);
                };
                TnetLog.log(LOG_PREFIX, 'setBaseLayerOpacity gehookt ✓');
            } else {
                setTimeout(function() { self._hookOpacityAndGrayscale(); }, 500);
                return;
            }

            if (typeof njs.AppManager.toggleBaseLayerColor === 'function') {
                // MutationObserver: Framework-Filter dauerhaft entfernen (auch
                // wenn Framework ihn nachträglich oder wiederholt setzt).
                self._installFilterStripObserver();

                njs.AppManager.toggleBaseLayerColor = function(mapId, toolId, btnEl) {
                    // Framework-Filter entfernen: CSS-Klasse (.grayscale) und
                    // Inline-Style auf .ol-layer-Divs – verhindert CSS-Overgriff
                    // auf Overlay-Themen. Unser Grau laeuft via prerender/postrender.
                    var _bDivs = document.querySelectorAll('.ol-basemap');
                    for (var _bi = 0; _bi < _bDivs.length; _bi++) { _bDivs[_bi].classList.remove('grayscale'); }
                    self._stripGrayFilterFromOlLayers();
                    if (mapId === 'main') {
                        var isGrey = false;
                        if (btnEl && btnEl.getAttribute) {
                            isGrey = (btnEl.getAttribute('data-value') === 'grey');
                        } else {
                            isGrey = !self._isGrayscale;
                        }
                        self.syncGrayscale(isGrey);
                    }
                };
                TnetLog.log(LOG_PREFIX, 'toggleBaseLayerColor gehookt ✓');
            }
        },

        _stripGrayFilterFromOlLayers: function() {
            var lyrs = document.querySelectorAll('.ol-layer');
            for (var i = 0; i < lyrs.length; i++) {
                var s = lyrs[i].style;
                if (s && s.filter && (s.filter.indexOf('gray') >= 0 || s.filter.indexOf('grey') >= 0)) {
                    s.filter = '';
                }
            }
        },

        // Entfernt Framework-Inline-Filter von .ol-layer-Divs synchron.
        _captureAndStripGrayFilter: function() {
            var lyrs = document.querySelectorAll('.ol-layer');
            for (var i = 0; i < lyrs.length; i++) {
                var s = lyrs[i].style;
                if (s && s.filter && (s.filter.indexOf('gray') >= 0 || s.filter.indexOf('grey') >= 0)) {
                    s.filter = '';
                }
            }
        },

        _installFilterStripObserver: function() {
            if (this._filterObserver) return;
            var self = this;
            try {
                var mo = new MutationObserver(function(mutations) {
                    for (var m = 0; m < mutations.length; m++) {
                        var t = mutations[m].target;
                        if (t && t.classList && t.classList.contains('ol-layer')) {
                            var st = t.style;
                            if (st && st.filter && (st.filter.indexOf('gray') >= 0 || st.filter.indexOf('grey') >= 0)) {
                                st.filter = ''; // Framework-Filter sofort entfernen
                            }
                        }
                    }
                });
                mo.observe(document.body, {
                    attributes: true, subtree: true, attributeFilter: ['style']
                });
                this._filterObserver = mo;
            } catch(e) {
                TnetLog.warn(LOG_PREFIX, 'MutationObserver-Setup fehlgeschlagen:', e);
            }
        },

        syncOpacity: function(value) {
            var olOpacity = 1 - (parseInt(value, 10) / 100);
            this._currentOpacity = olOpacity;
            if (this._timeOverlayLayer) {
                this._timeOverlayLayer.setOpacity(olOpacity);
            }
        },

        syncGrayscale: function(isGrey) {
            this._isGrayscale = isGrey;
            try {
                var mapInfo = njs.AppManager.Maps && njs.AppManager.Maps.main;
                var currentBasemapId = mapInfo ? (mapInfo.currBasisMap || mapInfo.basisMap || this.currentBasemap) : this.currentBasemap;
                TnetLog.log(LOG_PREFIX, 'syncGrayscale:', isGrey, 'basemap=', currentBasemapId, 'activeLayers=', this._getActiveBasemapLayers().length, 'domTargets=', document.querySelectorAll('.ol-basemap canvas, .ol-basemap img').length);
            } catch (e) {
                TnetLog.warn(LOG_PREFIX, 'syncGrayscale Debug-Log Fehler:', e);
            }
            this._clearGrayscaleSourceFilters();
            this._applyGrayscaleViaPrerender(isGrey);
        },

        // Entfernt alle gespeicherten prerender/postrender-Listener.
        _clearGrayscaleListeners: function() {
            var keys = Object.keys(this._grayscaleListeners);
            for (var ki = 0; ki < keys.length; ki++) {
                var entry = this._grayscaleListeners[keys[ki]];
                try { entry.layer.un('prerender',  entry.pre);  } catch(e) {}
                try { entry.layer.un('postrender', entry.post); } catch(e) {}
                try { entry.layer.changed(); } catch(e) {}
            }
            this._grayscaleListeners = {};
        },

        _clearGrayscaleSourceFilters: function() {
            for (var i = 0; i < this._grayscaleSourceEntries.length; i++) {
                var entry = this._grayscaleSourceEntries[i];
                try {
                    if (entry.kind === 'tile' && entry.source.setTileLoadFunction) {
                        entry.source.setTileLoadFunction(entry.originalFn);
                    } else if (entry.kind === 'image' && entry.source.setImageLoadFunction) {
                        entry.source.setImageLoadFunction(entry.originalFn);
                    }
                    if (entry.source.refresh) entry.source.refresh();
                } catch (e) {
                    TnetLog.warn(LOG_PREFIX, '_clearGrayscaleSourceFilters Fehler:', e);
                }
            }
            this._grayscaleSourceEntries = [];
        },

        _applyGrayToImageElement: function(imgEl) {
            if (!imgEl) return;
            try {
                imgEl.style.filter = this._isGrayscale ? 'grayscale(100%)' : '';
            } catch (e) {
                TnetLog.warn(LOG_PREFIX, '_applyGrayToImageElement Fehler:', e);
            }
        },

        _wrapTileLoadFunctionForGrayscale: function(source, originalFn) {
            var self = this;
            return function(tile, src) {
                originalFn.call(source, tile, src);

                var imgEl = tile && tile.getImage ? tile.getImage() : null;
                if (!imgEl) return;

                var process = function() {
                    if (!self._isGrayscale) return;
                    self._applyGrayToImageElement(imgEl);
                };

                if (imgEl.complete && (imgEl.naturalWidth || imgEl.width)) {
                    process();
                } else if (imgEl.addEventListener) {
                    imgEl.addEventListener('load', process, { once: true });
                }
            };
        },

        _wrapImageLoadFunctionForGrayscale: function(source, originalFn) {
            var self = this;
            return function(imageObj, src) {
                originalFn.call(source, imageObj, src);

                var imgEl = imageObj && imageObj.getImage ? imageObj.getImage() : null;
                if (!imgEl) return;

                var process = function() {
                    if (!self._isGrayscale) return;
                    self._applyGrayToImageElement(imgEl);
                };

                if (imgEl.complete && (imgEl.naturalWidth || imgEl.width)) {
                    process();
                } else if (imgEl.addEventListener) {
                    imgEl.addEventListener('load', process, { once: true });
                }
            };
        },

        _applyBasemapSourceGrayscale: function(grayscale) {
            this._clearGrayscaleListeners();
            this._clearGrayscaleSourceFilters();

            if (!grayscale) return;

            var activeLayers = this._getActiveBasemapLayers();
            TnetLog.log(LOG_PREFIX, '_applyBasemapSourceGrayscale:', 'layers=', activeLayers.length, 'grayscale=', grayscale);

            for (var i = 0; i < activeLayers.length; i++) {
                var layer = activeLayers[i];
                var source = layer && layer.getSource ? layer.getSource() : null;
                if (!source) continue;

                try {
                    if (source.setTileLoadFunction && source.getTileLoadFunction) {
                        var originalTileFn = source.getTileLoadFunction();
                        this._grayscaleSourceEntries.push({ source: source, kind: 'tile', originalFn: originalTileFn });
                        source.setTileLoadFunction(this._wrapTileLoadFunctionForGrayscale(source, originalTileFn));
                        if (source.refresh) source.refresh();
                        continue;
                    }

                    if (source.setImageLoadFunction && source.getImageLoadFunction) {
                        var originalImageFn = source.getImageLoadFunction();
                        this._grayscaleSourceEntries.push({ source: source, kind: 'image', originalFn: originalImageFn });
                        source.setImageLoadFunction(this._wrapImageLoadFunctionForGrayscale(source, originalImageFn));
                        if (source.refresh) source.refresh();
                    }
                } catch (e) {
                    TnetLog.warn(LOG_PREFIX, '_applyBasemapSourceGrayscale Fehler:', e);
                }
            }
        },

        _getActiveBasemapLayers: function() {
            var result = [];
            var seen = [];

            function pushLeaf(layer, allowTimeOverlay) {
                if (!layer || seen.indexOf(layer) >= 0) return;
                seen.push(layer);

                if (!allowTimeOverlay && layer.get && layer.get('_isTimeOverlay')) return;

                if (typeof layer.getLayers === 'function') {
                    var children = layer.getLayers().getArray();
                    for (var ci = 0; ci < children.length; ci++) {
                        pushLeaf(children[ci], allowTimeOverlay);
                    }
                    return;
                }

                result.push(layer);
            }

            try {
                var mapInfo = njs.AppManager.Maps && njs.AppManager.Maps.main;
                if (!mapInfo) return result;

                var currentCfg = this.currentBasemap && this.config ? this.config[this.currentBasemap] : null;
                if (this._timeOverlayLayer && currentCfg && (currentCfg.type === 'static' || currentCfg.type === 'dynamic')) {
                    pushLeaf(this._timeOverlayLayer, true);
                    return result;
                }

                var bmId = mapInfo.currBasisMap || mapInfo.basisMap || this.currentBasemap;
                var basemapLayer = mapInfo.basisMaps && bmId ? mapInfo.basisMaps[bmId] : null;

                if (!basemapLayer && mapInfo.mapObj && mapInfo.mapObj.getLayers) {
                    var mapLayers = mapInfo.mapObj.getLayers().getArray();
                    for (var li = 0; li < mapLayers.length; li++) {
                        var mapLayer = mapLayers[li];
                        if (mapLayer && mapLayer.get && mapLayer.get('isBaseLayer') && !mapLayer.get('_isTimeOverlay')) {
                            basemapLayer = mapLayer;
                            break;
                        }
                    }
                }

                pushLeaf(basemapLayer);
            } catch (e) {
                TnetLog.warn(LOG_PREFIX, '_getActiveBasemapLayers Fehler:', e);
            }

            return result;
        },

        // Setzt ctx.filter='grayscale(1)' via OL prerender/postrender-Events.
        // Der filter gilt NUR fuer den Canvas-Draw-Pass dieses Layers – keine
        // CSS-Kaskade, kein Einfluss auf Geschwister-/Overlay-Layer.
        _applyGrayscaleViaPrerender: function(isGrey) {
            this._clearGrayscaleListeners();

            if (!isGrey) return;

            try {
                var self = this;
                var activeLayers = this._getActiveBasemapLayers();
                if (!activeLayers.length) return;

                for (var li = 0; li < activeLayers.length; li++) {
                    (function(layer) {
                    var pre = function(evt) {
                        try {
                            if (evt.context) evt.context.filter = 'grayscale(1)';
                        } catch (e) {}
                    };
                    var post = function(evt) {
                        try {
                            if (evt.context) evt.context.filter = 'none';
                        } catch (e) {}
                    };

                    layer.on('prerender', pre);
                    layer.on('postrender', post);

                    var key = 'gl' + (self._grayscaleListenerCnt++);
                    self._grayscaleListeners[key] = { layer: layer, pre: pre, post: post };
                    try { layer.changed(); } catch (e) {}
                    })(activeLayers[li]);
                }
            } catch(e) {
                TnetLog.warn(LOG_PREFIX, '_applyGrayscaleViaPrerender Fehler:', e);
            }
        },

        _applyBasemapGrayscaleCSS: function(grayscale) {
            var activeLayers = this._getActiveBasemapLayers();
            TnetLog.log(LOG_PREFIX, '_applyBasemapGrayscaleCSS:', 'layers=', activeLayers.length, 'grayscale=', grayscale);
            for (var i = 0; i < activeLayers.length; i++) {
                this._applyBasemapLayerFilter(activeLayers[i], grayscale);
            }
        },

        _applyBasemapLayerFilter: function(layer, grayscale) {
            if (!layer) return;

            var filterVal = grayscale ? 'grayscale(100%)' : '';
            var applied = false;

            var applyToMedia = function(rootEl) {
                if (!rootEl || !rootEl.querySelectorAll) return false;
                var media = rootEl.querySelectorAll('canvas, img');
                if (!media.length) return false;
                for (var mi = 0; mi < media.length; mi++) {
                    media[mi].style.filter = filterVal;
                }
                return true;
            };

            try {
                var renderer = layer.getRenderer ? layer.getRenderer() : null;
                if (renderer) {
                    applied = applyToMedia(renderer.container) || applied;
                    applied = applyToMedia(renderer.element) || applied;
                    if (!applied && renderer.canvas) {
                        renderer.canvas.style.filter = filterVal;
                        applied = true;
                    }
                }
            } catch (e) {
                TnetLog.warn(LOG_PREFIX, '_applyBasemapLayerFilter Fehler:', e);
            }

            TnetLog.log(LOG_PREFIX, '_applyBasemapLayerFilter:', 'applied=', applied, 'grayscale=', grayscale);
        },

        _applyBasemapDomGrayscale: function(grayscale) {
            var filterVal = grayscale ? 'grayscale(100%)' : '';
            var targets = document.querySelectorAll('.ol-basemap canvas, .ol-basemap img');
            TnetLog.log(LOG_PREFIX, '_applyBasemapDomGrayscale:', 'targets=', targets.length, 'filter=', filterVal || '(leer)');
            for (var i = 0; i < targets.length; i++) {
                targets[i].style.filter = filterVal;
            }
        },

        _applyGrayscaleCSS: function(layer, grayscale) {
            if (!layer) return;
            var filterVal = grayscale ? 'grayscale(100%)' : '';

            var applyToEl = function(el) {
                if (el) { el.style.filter = filterVal; return true; }
                return false;
            };

            var applyToRendererMedia = function(rootEl) {
                if (!rootEl || !rootEl.querySelectorAll) return false;
                var media = rootEl.querySelectorAll('canvas, img');
                if (!media.length) return false;
                for (var mi = 0; mi < media.length; mi++) {
                    media[mi].style.filter = filterVal;
                }
                return true;
            };

            try {
                var renderer = layer.getRenderer ? layer.getRenderer() : null;
                if (renderer) {
                    if (applyToRendererMedia(renderer.container)) return;
                    if (applyToRendererMedia(renderer.element)) return;
                    if (renderer.canvas && applyToEl(renderer.canvas)) return;
                    if (applyToEl(renderer.container)) return;
                    if (applyToEl(renderer.element)) return;
                    if (renderer.canvas) {
                        if (applyToEl(renderer.canvas.parentElement || renderer.canvas)) return;
                    }
                }
            } catch (e) { /* continue to fallback */ }

            setTimeout(function() {
                try {
                    var mapEntry = njs.AppManager.Maps && njs.AppManager.Maps.main;
                    if (!mapEntry || !mapEntry.mapObj) return;
                    var mainMap = mapEntry.mapObj;
                    var r = layer.getRenderer ? layer.getRenderer() : null;
                    if (r) {
                        if (applyToRendererMedia(r.container)) return;
                        if (applyToRendererMedia(r.element)) return;
                        if (r.canvas && applyToEl(r.canvas)) return;
                    }
                    if (r && applyToEl(r.container || r.element)) return;
                    var viewport = mainMap.getViewport();
                    var media = viewport.querySelectorAll('.ol-layer canvas, .ol-layer img');
                    if (media.length > 0) applyToEl(media[0]);
                } catch (e2) {
                    TnetLog.warn(LOG_PREFIX, 'Grayscale CSS Fallback Fehler:', e2);
                }
            }, 150);
        },

        _dispatchTimeEvent: function(year, timeValue) {
            var cfg = this.config[this.currentBasemap] || {};
            document.dispatchEvent(new CustomEvent('basemap-time-change', {
                detail: {
                    basemapId: this.currentBasemap,
                    year: year,
                    timeValue: timeValue,
                    wmtsUrl: cfg.wmtsUrl || null,
                    timestampFormat: cfg.timestampFormat || null
                }
            }));
        },

        // ── Dynamische Jahrgänge (Landeskarte) ──

        startDynamicYearFetch: function(cfg) {
            var self = this;
            this.fetchDynamicYears(cfg);
            try {
                var mapEntry = njs.AppManager.Maps && njs.AppManager.Maps.main;
                var mainMap = mapEntry ? mapEntry.mapObj : null;
                if (mainMap) {
                    this._moveEndHandler = function() {
                        if (self._moveEndDebounceTimer) clearTimeout(self._moveEndDebounceTimer);
                        self._moveEndDebounceTimer = setTimeout(function() {
                            self.fetchDynamicYears(cfg);
                        }, cfg.moveEndDebounce || 500);
                    };
                    mainMap.on('moveend', this._moveEndHandler);
                }
            } catch (e) {
                TnetLog.warn(LOG_PREFIX, 'moveend error:', e);
            }
        },

        fetchDynamicYears: function(cfg) {
            var self = this;
            try {
                var mapEntry = njs.AppManager.Maps && njs.AppManager.Maps.main;
                if (!mapEntry || !mapEntry.mapObj) return;
                var mainMap = mapEntry.mapObj;
                var view = mainMap.getView();
                var center = view.getCenter();
                var extent = view.calculateExtent(mainMap.getSize());

                if (this._lastIdentifyCenter) {
                    var dx = Math.abs(center[0] - this._lastIdentifyCenter[0]);
                    var dy = Math.abs(center[1] - this._lastIdentifyCenter[1]);
                    if (dx < 100 && dy < 100) return;
                }
                this._lastIdentifyCenter = center.slice();

                var url = cfg.identifyUrl +
                    '?layers=' + encodeURIComponent(cfg.identifyParams.layers) +
                    '&geometry=' + center[0].toFixed(0) + ',' + center[1].toFixed(0) +
                    '&geometryType=' + cfg.identifyParams.geometryType +
                    '&mapExtent=' + extent.map(function(v) { return v.toFixed(0); }).join(',') +
                    '&imageDisplay=' + cfg.identifyParams.imageDisplay +
                    '&tolerance=' + cfg.identifyParams.tolerance +
                    '&lang=de';

                fetch(url)
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        var years = self._extractYearsFromIdentify(data);
                        if (years.length > 0) self._updateDynamicSlider(years);
                    })
                    .catch(function(err) {
                        TnetLog.warn(LOG_PREFIX, 'Identify error:', err);
                    });
            } catch (e) {
                TnetLog.warn(LOG_PREFIX, 'fetchDynamicYears error:', e);
            }
        },

        _extractYearsFromIdentify: function(data) {
            var yearsSet = {};
            try {
                var results = data.results || [];
                for (var i = 0; i < results.length; i++) {
                    var attrs = results[i].attributes || results[i].properties || {};
                    var arr = attrs.array_release_years;
                    if (Array.isArray(arr)) {
                        for (var j = 0; j < arr.length; j++) {
                            if (typeof arr[j] === 'number') yearsSet[arr[j]] = true;
                        }
                    }
                    if (attrs.release_year) yearsSet[attrs.release_year] = true;
                }
            } catch (e) { /* ignore */ }
            return Object.keys(yearsSet).map(Number).sort(function(a, b) { return a - b; });
        },

        _updateDynamicSlider: function(newYears) {
            var prevYear = this.currentYear;
            this.currentYears = newYears;
            var maxIdx = newYears.length - 1;
            this.sliderEl.min = 0;
            this.sliderEl.max = maxIdx;

            if (prevYear !== null) {
                var idx = newYears.indexOf(prevYear);
                if (idx >= 0) {
                    this.sliderEl.value = idx;
                    this.currentYear = prevYear;
                } else {
                    var nearest = this._findNearest(newYears, prevYear);
                    this.sliderEl.value = newYears.indexOf(nearest);
                    this.currentYear = nearest;
                }
            } else {
                this.sliderEl.value = maxIdx;
                this.currentYear = newYears[maxIdx];
            }

            if (this.minEl) this.minEl.textContent = newYears[0];
            if (this.maxEl) this.maxEl.textContent = newYears[maxIdx];
            this.updateLabel(this.currentYear);
        },

        _findNearest: function(arr, target) {
            var closest = arr[0], minDiff = Math.abs(target - arr[0]);
            for (var i = 1; i < arr.length; i++) {
                var diff = Math.abs(target - arr[i]);
                if (diff < minDiff) { minDiff = diff; closest = arr[i]; }
            }
            return closest;
        },

        _cleanupDynamic: function() {
            if (this._moveEndHandler) {
                try {
                    var mapEntry = njs.AppManager.Maps && njs.AppManager.Maps.main;
                    var mainMap = mapEntry ? mapEntry.mapObj : null;
                    if (mainMap) mainMap.un('moveend', this._moveEndHandler);
                } catch (e) { /* ignore */ }
                this._moveEndHandler = null;
            }
            if (this._moveEndDebounceTimer) {
                clearTimeout(this._moveEndDebounceTimer);
                this._moveEndDebounceTimer = null;
            }
            this._lastIdentifyCenter = null;
        },

        // ── changeBaseMap Hook ──

        hookChangeBaseMap: function() {
            var self = this;
            var attempts = 0, maxAttempts = 30;

            function tryHook() {
                attempts++;
                if (!njs || !njs.AppManager || !njs.AppManager.Maps || !njs.AppManager.Maps.main) {
                    if (attempts < maxAttempts) setTimeout(tryHook, 500);
                    else TnetLog.warn(LOG_PREFIX, 'Hook aufgegeben nach', maxAttempts, 'Versuchen');
                    return;
                }

                var mapInstance = njs.AppManager.Maps.main;
                if (mapInstance._basemapTimeHooked) return;

                var currentFn = mapInstance.changeBaseMap;
                mapInstance._basemapTimeHooked = true;
                mapInstance._preTimeChangeBaseMap = currentFn;

                mapInstance.changeBaseMap = function(basemapId) {
                    self.removeTimeOverlay();

                    var actualBasemapId = basemapId;
                    var cfg = self.config ? self.config[basemapId] : null;
                    if (cfg && cfg.fallbackBasemap) {
                        actualBasemapId = cfg.fallbackBasemap;
                    }

                    TnetLog.log(LOG_PREFIX, 'changeBaseMap:', basemapId, '→ Framework:', actualBasemapId);

                    // Guard: Duplikat-Fehler vermeiden — OpenLayers Collection.setAt() wirft
                    // "Duplicate item added to a unique collection" wenn dasselbe Layer-Objekt
                    // bereits irgendwo in der Collection ist (nicht nur an Position 0).
                    var skipFramework = false;
                    try {
                        var layers = mapInstance.mapObj.getLayers();
                        var targetLayer = mapInstance.basisMaps[actualBasemapId];
                        if (targetLayer) {
                            var currentAtZero = layers.item(0);
                            if (currentAtZero === targetLayer) {
                                // Bereits an Position 0 → Framework-Aufruf komplett unnötig
                                TnetLog.log(LOG_PREFIX, 'Basemap-Layer bereits an Position 0, überspringe Framework-Aufruf');
                                skipFramework = true;
                            } else {
                                // Layer an anderer Position? → erst entfernen, damit setAt(0) nicht kracht
                                var arr = layers.getArray();
                                for (var idx = 1; idx < arr.length; idx++) {
                                    if (arr[idx] === targetLayer) {
                                        layers.removeAt(idx);
                                        TnetLog.warn(LOG_PREFIX, 'Basemap-Layer an Position', idx, 'entfernt (war deplatziert)');
                                        break;
                                    }
                                }
                            }
                        }
                    } catch (e) { /* ignore */ }

                    var result;
                    if (!skipFramework) {
                        result = mapInstance._preTimeChangeBaseMap.call(mapInstance, actualBasemapId);
                    }
                    setTimeout(function() {
                        // Fix: Nach View-Ersatz Viewport stabilisieren
                        var map = mapInstance.mapObj;
                        if (map) {
                            var viewport = map.getViewport();
                            if (viewport) {
                                // ondragstart (Property, nicht addEventListener → ersetzt sich selbst)
                                viewport.ondragstart = function(e) { e.preventDefault(); };
                            }
                            map.updateSize();
                        }
                        self.onBasemapChange(basemapId);
                    }, 200);
                    return result;
                };

                TnetLog.log(LOG_PREFIX, 'changeBaseMap gehookt ✓');

                // Nach dem Hook: aktuelle Framework-Basemap erkennen und Zeitreise nachholen
                var currBm = mapInstance.currBasisMap || mapInstance.basisMap;
                if (currBm) {
                    TnetLog.log(LOG_PREFIX, 'Framework-Basemap beim Hook:', currBm);
                    // Card im DOM synchronisieren
                    document.querySelectorAll('.basemap-card').forEach(function(c) {
                        c.classList.toggle('active', c.dataset.basemap === currBm);
                    });
                    // Zeitreise-Overlay anwenden (z.B. für void-Basemaps siegfried/pk_color/dufour)
                    self.onBasemapChange(currBm);
                } else {
                    // Fallback: aus DOM lesen
                    var activeCard = document.querySelector('.basemap-card.active');
                    if (activeCard && activeCard.dataset.basemap) {
                        self.onBasemapChange(activeCard.dataset.basemap);
                    }
                }
            }
            tryHook();
        },

        // ── Public API ──

        getCurrentTimeValue: function() {
            if (!this.currentYear || !this.currentBasemap) return null;
            var cfg = this.config[this.currentBasemap];
            if (!cfg || cfg.type === 'info') return null;
            if (cfg.timestampFormat === 'YYYYMMDD') return this.currentYear + '1231';
            return this.currentYear.toString();
        },

        getCurrentWmtsUrl: function() {
            if (!this.currentBasemap || !this.config[this.currentBasemap]) return null;
            return this.config[this.currentBasemap].wmtsUrl || null;
        }
    };


    // =========================================================
    // 6. INIT — Alles starten
    // =========================================================

    window.BasemapTimeManager = BasemapTimeManager;

    function initAll() {
        // Widget UI (Cards, Expand)
        initBasemapCards();

        // Grundkarten-Layer Defaults
        initGrundkartenDefaults();

        // Zeitreise
        BasemapTimeManager.init();

        // URL-Parameter ?basemap= auswerten
        applyBasemapFromUrl();

        TnetLog.log(LOG_PREFIX, 'Modul vollständig initialisiert ✓');
    }

    /**
     * Liest ?basemap=<id> aus der URL und wechselt die Basemap.
     * Wartet auf Framework-Bereitschaft UND aktiven Hook.
     */
    function applyBasemapFromUrl() {
        var urlParams = new URLSearchParams(window.location.search);
        var basemapParam = urlParams.get('basemap');
        if (!basemapParam) return;

        // Gültige IDs: alle data-basemap Attribute im DOM
        var validCards = document.querySelectorAll('.basemap-card[data-basemap]');
        var validIds = [];
        validCards.forEach(function(c) { validIds.push(c.dataset.basemap); });
        if (validIds.indexOf(basemapParam) === -1) {
            TnetLog.warn(LOG_PREFIX, 'URL basemap="' + basemapParam + '" ist ungültig. Gültig:', validIds.join(', '));
            return;
        }

        TnetLog.log(LOG_PREFIX, 'URL-Parameter basemap=' + basemapParam);

        // Active-Card im Widget sofort aktualisieren
        validCards.forEach(function(c) {
            c.classList.toggle('active', c.dataset.basemap === basemapParam);
        });

        // Warte auf Framework UND Hook, dann Basemap wechseln
        var attempts = 0;
        (function waitAndSwitch() {
            attempts++;
            var ready = window.njs && njs.AppManager && njs.AppManager.Maps && njs.AppManager.Maps.main;
            var hasChangeBaseMap = ready && typeof njs.AppManager.Maps.main.changeBaseMap === 'function';
            if (ready && hasChangeBaseMap) {
                // Nur wechseln wenn nicht schon die richtige Basemap aktiv
                var curr = njs.AppManager.Maps.main.currBasisMap || njs.AppManager.Maps.main.basisMap;
                if (curr !== basemapParam) {
                    njs.AppManager.Maps['main'].changeBaseMap(basemapParam);
                    TnetLog.log(LOG_PREFIX, 'Basemap aus URL gesetzt:', basemapParam);
                } else {
                    TnetLog.log(LOG_PREFIX, 'Basemap aus URL bereits aktiv:', basemapParam);
                }
            } else if (attempts < 40) {
                setTimeout(waitAndSwitch, 500);
            } else {
                TnetLog.warn(LOG_PREFIX, 'Framework nicht bereit, basemap aus URL konnte nicht gesetzt werden');
            }
        })();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAll);
    } else {
        initAll();
    }

})();
