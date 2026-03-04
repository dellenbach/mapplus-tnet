/**
 * tnet-3d-landscape.js
 * 3D Landscape Model Split-Screen functionality (iframe-based)
 * 
 * Uses an ISOLATED IFRAME for the ESRI ArcGIS JS API to avoid
 * conflicts with the existing Dojo loader on the main page.
 * 
 * Communication between 2D map and 3D scene via postMessage.
 * Configuration loaded from tnet-global-config.json5.
 *
 * @version    1.2
 * @date       2026-02-12
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

(function() {
    'use strict';

    // =========================================================
    // Log Level System
    // Stufen: 'none' (0) | 'error' (1) | 'warn' (2) | 'info' (3) | 'debug' (4)
    // Einstellbar in tnet-global-config.json5 → logLevel (Root-Ebene)
    // console wird im IIFE-Scope geschattet → alle bestehenden
    // console.log/warn/error Aufrufe werden automatisch gefiltert.
    // =========================================================
    var _LOG_LEVELS = { none: 0, error: 1, warn: 2, info: 3, debug: 4 };
    var _logLevel = _LOG_LEVELS.warn; // Standard: nur Warnungen und Fehler
    var _realConsole = window.console;
    var console = {
        log:      function() { if (_logLevel >= _LOG_LEVELS.debug) _realConsole.log.apply(_realConsole, arguments); },
        info:     function() { if (_logLevel >= _LOG_LEVELS.info)  _realConsole.info.apply(_realConsole, arguments); },
        warn:     function() { if (_logLevel >= _LOG_LEVELS.warn)  _realConsole.warn.apply(_realConsole, arguments); },
        error:    function() { if (_logLevel >= _LOG_LEVELS.error) _realConsole.error.apply(_realConsole, arguments); },
        debug:    function() { if (_logLevel >= _LOG_LEVELS.debug) _realConsole.debug.apply(_realConsole, arguments); },
        table:    _realConsole.table    ? _realConsole.table.bind(_realConsole)    : function() {},
        group:    _realConsole.group    ? _realConsole.group.bind(_realConsole)    : function() {},
        groupEnd: _realConsole.groupEnd ? _realConsole.groupEnd.bind(_realConsole) : function() {}
    };

    // =========================================================
    // Config Loader (nutzt offizielle JSON5-Library via CDN)
    // JSON5 wird synchron geladen (kein async), ist also hier immer verfügbar
    // =========================================================

    function loadGlobalConfig() {
        if (window.Landscape3DConfig) return window.Landscape3DConfig; // bereits geladen
        if (typeof JSON5 === 'undefined') {
            console.error('[3DLandscape] JSON5-Library nicht verfügbar!');
            return null;
        }
        
        var paths = [
            '/maps/tnet/config/tnet-global-config.json5',
            '/maps/tnet/tnet-global-config.json5',
            '../tnet/config/tnet-global-config.json5'
        ];
        for (var i = 0; i < paths.length; i++) {
            try {
                var xhr = new XMLHttpRequest();
                xhr.open('GET', paths[i], false);
                xhr.send();
                if (xhr.status === 200) {
                    var config = JSON5.parse(xhr.responseText);
                    if (config && config['3d-landscape']) {
                        console.log('[3DLandscape] Config loaded from:', paths[i]);
                        // Globales logLevel separat speichern (Root-Ebene)
                        if (config.logLevel) {
                            window.TnetGlobalLogLevel = config.logLevel;
                        }
                        window.Landscape3DConfig = config['3d-landscape'];
                        return window.Landscape3DConfig;
                    }
                }
            } catch(e) {
                console.warn('[3DLandscape] Config load error (' + paths[i] + '):', e.message);
            }
        }
        console.error('[3DLandscape] FEHLER: tnet-global-config.json5 nicht gefunden!');
        return null;
    }

    // Log-Level aus Config aktualisieren (nach Config-Load)
    // logLevel liegt auf Root-Ebene der JSON5-Config
    if (window.TnetGlobalLogLevel && _LOG_LEVELS[window.TnetGlobalLogLevel] !== undefined) {
        _logLevel = _LOG_LEVELS[window.TnetGlobalLogLevel];
    }
    if (_logLevel >= _LOG_LEVELS.info) {
        var _lvlName = Object.keys(_LOG_LEVELS).filter(function(k) { return _LOG_LEVELS[k] === _logLevel; })[0] || 'warn';
        _realConsole.info('[3DLandscape] Log level:', _lvlName);
    }

    // =========================================================
    // 3D Landscape Controller
    // =========================================================
    // Hilfsfunktionen: Massstab ↔ Kamerahöhe Umrechnung
    // Interpoliert linear zwischen den Stützpunkten der Config-Tabelle
    // =========================================================

    /**
     * 2D-Massstab (Nenner) → 3D-Kamerahöhe (m)
     * Interpoliert linear in der scaleToCameraHeight-Tabelle.
     */
    function scaleToHeight(scaleDenom) {
        var table = window.Landscape3DConfig && window.Landscape3DConfig.synchronization
            && window.Landscape3DConfig.synchronization.scaleToCameraHeight;
        if (!table || table.length === 0) return scaleDenom; // 1:1 Fallback
        // Unter kleinstem Wert
        if (scaleDenom <= table[0].scale) return table[0].height;
        // Über grösstem Wert
        if (scaleDenom >= table[table.length - 1].scale) return table[table.length - 1].height;
        // Interpolieren
        for (var i = 0; i < table.length - 1; i++) {
            if (scaleDenom >= table[i].scale && scaleDenom <= table[i + 1].scale) {
                var t = (scaleDenom - table[i].scale) / (table[i + 1].scale - table[i].scale);
                return table[i].height + t * (table[i + 1].height - table[i].height);
            }
        }
        return scaleDenom;
    }

    /**
     * 3D-Kamerahöhe (m) → 2D-Massstab (Nenner)
     * Interpoliert linear in der scaleToCameraHeight-Tabelle (umgekehrt).
     */
    function heightToScale(height) {
        var table = window.Landscape3DConfig && window.Landscape3DConfig.synchronization
            && window.Landscape3DConfig.synchronization.scaleToCameraHeight;
        if (!table || table.length === 0) return height; // 1:1 Fallback
        if (height <= table[0].height) return table[0].scale;
        if (height >= table[table.length - 1].height) return table[table.length - 1].scale;
        for (var i = 0; i < table.length - 1; i++) {
            if (height >= table[i].height && height <= table[i + 1].height) {
                var t = (height - table[i].height) / (table[i + 1].height - table[i].height);
                return table[i].scale + t * (table[i + 1].scale - table[i].scale);
            }
        }
        return height;
    }

    /**
     * OL-Auflösung (m/px) → Massstab-Nenner
     * LV95 ist metrisch, daher: scale = resolution * DPI / 0.0254
     * Standard: 96 DPI → Faktor ≈ 3779.5275
     */
    function resolutionToScale(resolution) {
        return resolution * 96 / 0.0254;
    }

    /**
     * Massstab-Nenner → OL-Auflösung (m/px)
     */
    function scaleToResolution(scaleDenom) {
        return scaleDenom * 0.0254 / 96;
    }

    // =========================================================
    var Landscape3D = {
        enabled: false,
        iframe: null,
        iframeReady: false,
        originalMapContainer: null,
        dividerPosition: 50,
        isDragging: false,
        webSceneId: null,
        syncEnabled: true,
        syncLock: false,
        sync2DHandle: null,
        lastSyncedCenter: null,      // Letztes synchronisiertes 2D-Zentrum (für Pan-Erkennung)
        lastSyncedResolution: null,  // Letzte synchronisierte 2D-Auflösung (für Zoom-Erkennung)
        viewFrustumLayer: null,
        viewFrustumSource: null,
        frustumDragInteraction: null,
        lastCameraData: null,  // Last known 3D camera params (for frustum drag)
        _frustumDragActive: false,  // true während Frustum-Drag (verhindert Auto-Pan Sprünge)
        _frustumFeatures: null,     // Recycelte Frustum-Features (kein GC-Druck)
        _dragRAF: null,             // requestAnimationFrame-Handle für Frustum-Drag
        layerSyncTimer: null,
        lastLayerState: null,
        layerChangeKeys: [],  // OL event listener keys for layer changes
        
        /**
         * Initialize 3D landscape mode
         */
        init: function(webSceneId) {
            if (!window.Landscape3DConfig) {
                loadGlobalConfig();
            }
            this.webSceneId = webSceneId || this.getDefaultWebSceneId();
            if (!this.webSceneId) {
                console.error('[3DLandscape] Keine WebScene ID - Abbruch');
                return;
            }
            console.log('[3DLandscape] Initializing with WebScene:', this.webSceneId);
            
            // Disable existing split-screen if active
            if (window.TnetSplitScreen && window.TnetSplitScreen.enabled) {
                window.TnetSplitScreen.toggle();
            }
            
            this.createSplitLayout();
            this.createIframe();
            this.setupResizer();
            this.setupMessageListener();
            this.createFrustumLayer();
            // createSceneSwitcher() wird nach iframe-Erstellung aufgerufen
            
            this.enabled = true;
            console.log('[3DLandscape] Initialized');
        },

        /**
         * Get default WebScene ID from config
         */
        getDefaultWebSceneId: function() {
            var cfg = window.Landscape3DConfig;
            if (cfg && cfg.defaultWebSceneId) {
                return cfg.defaultWebSceneId;
            }
            console.error('[3DLandscape] Keine defaultWebSceneId in Config!');
            return null;
        },

        /**
         * Create split layout via map.setTarget().
         * 
         * Kein mapContainer-Resize nötig! Stattdessen:
         * - Flex-Split-Wrapper INNERHALB mapContainer (position:absolute)
         * - OL rendert via setTarget() in den linken Panel
         * - Dijit verwaltet mapContainer normal → kein Konflikt
         */
        createSplitLayout: function() {
            var mapContainer = document.getElementById('mapContainer');
            
            if (!mapContainer) {
                console.error('[3DLandscape] mapContainer not found');
                return;
            }
            
            this.originalMapContainer = mapContainer;
            
            // Remove any existing 3D split layout
            var existing = document.getElementById('split-wrapper-3d');
            if (existing) existing.remove();
            
            // Build flex layout INSIDE mapContainer
            var splitWrapper = document.createElement('div');
            splitWrapper.id = 'split-wrapper-3d';
            splitWrapper.style.cssText = 'display:flex;position:absolute;top:0;left:0;right:0;bottom:0;z-index:1;';
            
            var leftPanel = document.createElement('div');
            leftPanel.id = 'split-panel-2d';
            leftPanel.style.cssText = 'flex:1;position:relative;overflow:hidden;min-width:0;';
            
            var divider = document.createElement('div');
            divider.id = 'split-divider-3d';
            divider.style.cssText = 'width:4px;background:#2c5f6f;cursor:col-resize;position:relative;z-index:2;box-shadow:0 0 5px rgba(0,0,0,0.3);flex-shrink:0;';
            divider.innerHTML = '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:20px;height:40px;background:rgba(44,95,111,0.8);border-radius:4px;display:flex;align-items:center;justify-content:center;color:white;font-size:10px;">&#8942;</div>';
            
            var rightPanel = document.createElement('div');
            rightPanel.id = 'split-panel-3d';
            rightPanel.style.cssText = 'flex:1;position:relative;overflow:hidden;background:#1a1a2e;min-width:0;';
            
            splitWrapper.appendChild(leftPanel);
            splitWrapper.appendChild(divider);
            splitWrapper.appendChild(rightPanel);
            
            mapContainer.appendChild(splitWrapper);
            
            // OL-Karte in den linken Panel verschieben via setTarget()
            var map2D = this.get2DMap();
            if (map2D) {
                this._originalMapTarget = map2D.getTarget();
                map2D.setTarget(leftPanel);
                console.log('[3DLandscape] OL map re-targeted to split-panel-2d');
            }
            
            // Trigger OL map resize
            this.resize2DMap();
            
            // ResizeObserver: Canvas passt sich an wenn Panel-Grösse ändert
            var self = this;
            if (window.ResizeObserver) {
                this._resizeObserver = new ResizeObserver(function() {
                    self.resize2DMap();
                });
                this._resizeObserver.observe(leftPanel);
            }
            
            console.log('[3DLandscape] Split layout created');
        },

        /**
         * Query terrain elevation from GeoAdmin API
         * @param {number} lon - Longitude (WGS84)
         * @param {number} lat - Latitude (WGS84)
         * @param {function} callback - Callback(elevation_m_or_null)
         */
        queryTerrainElevation: function(lon, lat, callback) {
            try {
                this.ensureLV95Projection();
                
                // Config-Werte
                var config = (window.Landscape3DConfig && window.Landscape3DConfig.geoAdmin) || {};
                
                // Transform WGS84 -> LV95 for GeoAdmin API
                var lv95 = ol.proj.transform([lon, lat], 'EPSG:4326', 'EPSG:2056');
                var easting = Math.round(lv95[0]);
                var northing = Math.round(lv95[1]);
                
                // GeoAdmin Height API
                var url = config.heightApiUrl;
                url += '?easting=' + easting;
                url += '&northing=' + northing;
                url += '&sr=' + config.coordinateSystem;
                
                console.log('[3DLandscape] Querying terrain elevation:', url);
                
                var xhr = new XMLHttpRequest();
                xhr.open('GET', url, true);
                xhr.timeout = config.heightApiTimeout;
                
                xhr.onload = function() {
                    if (xhr.status === 200) {
                        try {
                            var response = JSON.parse(xhr.responseText);
                            var h = parseFloat(response && response.height);
                            if (!isNaN(h)) {
                                console.log('[3DLandscape] Terrain elevation:', h, 'm');
                                callback(h);
                                return;
                            }
                        } catch(e) {
                            console.warn('[3DLandscape] Error parsing elevation response:', e);
                        }
                    }
                    console.warn('[3DLandscape] Elevation query failed, status:', xhr.status, 'response:', xhr.responseText);
                    callback(null);
                };
                
                xhr.onerror = function() {
                    console.warn('[3DLandscape] Elevation query error, using fallback');
                    callback(null);
                };
                
                xhr.ontimeout = function() {
                    console.warn('[3DLandscape] Elevation query timeout, using fallback');
                    callback(null);
                };
                
                xhr.send();
            } catch(e) {
                console.warn('[3DLandscape] Error in elevation query:', e);
                callback(null);
            }
        },

        /**
         * Create iframe with the isolated 3D viewer
         */
        createIframe: function() {
            var self = this;
            var rightPanel = document.getElementById('split-panel-3d');
            if (!rightPanel) return;
            
            // Get current 2D map position for initial camera
            var initParams = this.get2DMapPosition();
            
            // Query terrain elevation and then create iframe
            var lon = initParams ? initParams.longitude : 8.36;
            var lat = initParams ? initParams.latitude : 46.95;
            
            this.queryTerrainElevation(lon, lat, function(terrainHeight) {
                var config = (window.Landscape3DConfig && window.Landscape3DConfig.camera) || {};
                
                // Initiale Kamerahöhe aus 2D-Massstab berechnen
                var map2D = self.get2DMap();
                var cameraAltitude;
                if (map2D) {
                    var res = map2D.getView().getResolution();
                    var scaleDenom = resolutionToScale(res);
                    cameraAltitude = scaleToHeight(scaleDenom);
                    console.log('[3DLandscape] Initial: 2D resolution', res, '→ scale 1:' + Math.round(scaleDenom), '→ camera height', Math.round(cameraAltitude), 'm');
                } else {
                    // Fallback: Terrain + Offset
                    var baseElevation = (terrainHeight !== null && !isNaN(terrainHeight)) ? terrainHeight : (config.fallbackTerrainHeight || 600);
                    cameraAltitude = baseElevation + (config.terrainHeightOffset || 200);
                }
                
                // Initiale Kamera 50m tiefer (näher am Boden) für bessere Übersicht
                var cameraAltitudeOffset = (config.initialAltitudeOffset !== undefined) ? config.initialAltitudeOffset : -50;
                cameraAltitude = Math.max(cameraAltitude + cameraAltitudeOffset, 50);
                console.log('[3DLandscape] Altitude after offset (' + cameraAltitudeOffset + 'm):', Math.round(cameraAltitude), 'm');
                
                // Build iframe URL (absolute for iframe context)
                var iframeSrc = window.location.origin + '/maps/tnet/tnet-3d-viewer.html?webscene=' + encodeURIComponent(self.webSceneId);
                if (initParams) {
                    iframeSrc += '&lon=' + initParams.longitude;
                    iframeSrc += '&lat=' + initParams.latitude;
                }
                // Initial camera: Höhe aus Scale-Tabelle, Heading/Tilt aus Config
                var initHeading = config.defaultHeading || 0;
                var initTilt = config.defaultTilt || 60;
                var initFov = config.defaultFov || 55;
                iframeSrc += '&altitude=' + Math.round(cameraAltitude) + '&heading=' + initHeading + '&tilt=' + initTilt;
                
                // Initiale Kamera-Daten speichern, damit Frustum sofort gezeichnet werden kann
                self.lastCameraData = {
                    type: 'cameraChanged',
                    longitude: lon,
                    latitude: lat,
                    altitude: cameraAltitude,
                    heading: initHeading,
                    tilt: initTilt,
                    fov: initFov
                };
            
                var quality = 'high';
                if (window.Landscape3DConfig && window.Landscape3DConfig.sceneViewOptions) {
                    quality = window.Landscape3DConfig.sceneViewOptions.qualityProfile || 'high';
                }
                iframeSrc += '&quality=' + quality;
                
                // Log-Level an iframe übergeben
                var _cfgLogLevel = window.TnetGlobalLogLevel || 'warn';
                iframeSrc += '&loglevel=' + encodeURIComponent(_cfgLogLevel);
                
                console.log('[3DLandscape] Creating iframe with altitude', cameraAltitude, 'm (terrain:', baseElevation, 'm +', config.terrainHeightOffset + 'm):', iframeSrc);
                
                self.iframe = document.createElement('iframe');
                self.iframe.id = 'landscape-3d-iframe';
                self.iframe.src = iframeSrc;
                self.iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;';
                self.iframe.setAttribute('allow', 'accelerometer; autoplay; fullscreen');
                
                rightPanel.appendChild(self.iframe);
                
                // Scene Switcher nach iframe-Erstellung hinzufügen
                self.createSceneSwitcher();
            });
        },

        /**
         * Get current 2D map center in WGS84
         */
        get2DMapPosition: function() {
            try {
                var map2D = this.get2DMap();
                if (!map2D) return null;
                
                var view = map2D.getView();
                var center = view.getCenter();
                var zoom = view.getZoom();
                
                if (!center) return null;
                
                // Ensure LV95 projection
                this.ensureLV95Projection();
                
                // Transform LV95 -> WGS84
                var wgs84 = ol.proj.transform(center, 'EPSG:2056', 'EPSG:4326');
                
                console.log('[3DLandscape] 2D position LV95:', center, '-> WGS84:', wgs84, 'zoom:', zoom);
                
                return {
                    longitude: wgs84[0],
                    latitude: wgs84[1],
                    zoom: zoom || 14
                };
            } catch(e) {
                console.warn('[3DLandscape] Cannot get 2D map position:', e);
                return null;
            }
        },

        /**
         * Get OpenLayers map object
         */
        get2DMap: function() {
            if (window.njs && njs.AppManager && njs.AppManager.Maps && njs.AppManager.Maps.main) {
                return njs.AppManager.Maps.main.mapObj;
            }
            return null;
        },

        /**
         * Ensure LV95 (EPSG:2056) projection is registered
         */
        ensureLV95Projection: function() {
            try {
                var proj = ol.proj.get('EPSG:2056');
                if (!proj && window.proj4) {
                    proj4.defs('EPSG:2056', '+proj=somerc +lat_0=46.95240555555556 +lon_0=7.439583333333333 +k_0=1 +x_0=2600000 +y_0=1200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs');
                    ol.proj.proj4.register(proj4);
                    console.log('[3DLandscape] LV95 projection registered');
                }
            } catch(e) {
                console.warn('[3DLandscape] Error registering LV95:', e);
            }
        },

        /**
         * Listen for messages from 3D iframe
         */
        setupMessageListener: function() {
            var self = this;
            
            this._messageHandler = function(event) {
                var data = event.data;
                if (!data || !data.type) return;
                
                switch (data.type) {
                    case 'ready':
                        console.log('[3DLandscape] 3D viewer ready');
                        self.iframeReady = true;
                        // Highlight-Config an Viewer senden
                        var hlCfg = window.Landscape3DConfig && window.Landscape3DConfig.highlight;
                        if (hlCfg) {
                            self.sendToIframe({ type: 'setHighlightConfig', highlight: hlCfg });
                        }
                        self.setup2DSync();
                        self.syncBasemapTo3D();
                        self.syncLayersTo3D();
                        self.startLayerWatch();
                        // Initiales Frustum sofort zeichnen (mit gespeicherten Init-Parametern)
                        if (self.lastCameraData) {
                            self.updateFrustum(self.lastCameraData);
                            console.log('[3DLandscape] Initial frustum drawn');
                        }
                        break;
                        
                    case 'cameraChanged':
                        self.lastCameraData = data;
                        self.updateFrustum(data);
                        // Kein sync3Dto2D → 2D-Karte folgt NICHT der 3D-Kamera
                        // Nur Auto-Pan wenn Frustum ausserhalb der sichtbaren Karte
                        self.ensureFrustumVisible(data);
                        break;
                        
                    case 'syncToggled':
                        self.syncEnabled = data.enabled;
                        console.log('[3DLandscape] Sync toggled from 3D:', data.enabled);
                        break;
                        
                    case 'error':
                        console.error('[3DLandscape] 3D viewer error:', data.message);
                        break;
                }
            };
            
            window.addEventListener('message', this._messageHandler);
        },

        /**
         * Setup 2D map -> 3D sync (listen to OL view changes)
         * 
         * ENTKOPPELT: 2D-Pan hat KEINEN Einfluss auf 3D!
         * Ausschliesslich das Frustum steuert die 3D-Kamera.
         * 
         * Zoom: 2D-Massstab → 3D-Kamerahöhe (Position bleibt beim Frustum)
         */
        setup2DSync: function() {
            var self = this;
            var map2D = this.get2DMap();
            
            if (!map2D) {
                console.warn('[3DLandscape] Cannot setup 2D sync: map not found');
                return;
            }
            
            this.ensureLV95Projection();
            
            var view = map2D.getView();
            this.lastSyncedResolution = view.getResolution();
            
            // KEIN Center-Handler → 2D-Pan bewegt 3D NICHT
            // (Frustum ist der einzige Weg, die 3D-Kamera zu positionieren)
            
            // Auf Resolution-Änderung (Zoom) reagieren
            // → 3D-Kamerahöhe ändern, Position bleibt beim aktuellen Frustum
            var resKey = view.on('change:resolution', function() {
                if (self.syncLock || !self.syncEnabled || !self.iframeReady) return;
                if (!self.lastCameraData) return;
                self.syncLock = true;
                
                try {
                    var resolution = view.getResolution();
                    
                    if (resolution) {
                        var scaleDenom = resolutionToScale(resolution);
                        var altitude = scaleToHeight(scaleDenom);
                        
                        console.log('[3DLandscape] 2D→3D zoom: scale 1:' + Math.round(scaleDenom) + ' → altitude', Math.round(altitude), 'm');
                        
                        // Zoom: Kamerahöhe ändern, Position bleibt wo 3D-Kamera ist
                        self.sendToIframe({
                            type: 'syncCamera',
                            longitude: self.lastCameraData.longitude,
                            latitude: self.lastCameraData.latitude,
                            altitude: Math.round(altitude)
                        });
                        self.lastSyncedResolution = resolution;
                    }
                } catch(e) {
                    console.warn('[3DLandscape] Error in 2D->3D zoom sync:', e);
                }
                
                var delay = (window.Landscape3DConfig && window.Landscape3DConfig.synchronization)
                    ? window.Landscape3DConfig.synchronization.syncDelay || 100
                    : 100;
                setTimeout(function() { self.syncLock = false; }, delay);
            });
            
            this.sync2DHandle = [resKey];
            console.log('[3DLandscape] 2D -> 3D sync active (nur Zoom→Altitude, Pan entkoppelt)');
        },

        /**
         * Sync 3D camera change back to 2D map
         * 
         * Kamerahöhe → Massstab via Lookup-Tabelle (heightToScale)
         * Position (lon/lat) → 2D-Kartenzentrum
         */
        sync3Dto2D: function(data) {
            if (this.syncLock || !this.syncEnabled) return;
            
            this.syncLock = true;
            
            try {
                var map2D = this.get2DMap();
                if (!map2D) return;
                
                var view = map2D.getView();
                this.ensureLV95Projection();
                
                // Camera position in LV95
                var camLV95 = ol.proj.transform(
                    [data.longitude, data.latitude],
                    'EPSG:4326',
                    'EPSG:2056'
                );
                
                // Center 2D map on camera position
                view.setCenter(camLV95);
                
                // Kamerahöhe → Massstab → OL-Resolution
                var altitude = data.altitude;
                if (altitude && altitude > 0) {
                    var scaleDenom = heightToScale(altitude);
                    var resolution = scaleToResolution(scaleDenom);
                    
                    console.log('[3DLandscape] 3D→2D: altitude', Math.round(altitude), 'm → scale 1:' + Math.round(scaleDenom), '→ resolution', resolution.toFixed(2));
                    
                    if (view.getZoomForResolution) {
                        var zoom2D = view.getZoomForResolution(resolution);
                        if (zoom2D !== undefined && !isNaN(zoom2D)) {
                            zoom2D = Math.max(2, Math.min(22, zoom2D));
                            view.setZoom(Math.round(zoom2D * 2) / 2);
                        }
                    }
                }
            } catch(e) {
                console.warn('[3DLandscape] Error in 3D->2D sync:', e);
            }
            
            var delay = (window.Landscape3DConfig && window.Landscape3DConfig.synchronization) 
                ? window.Landscape3DConfig.synchronization.syncDelay || 100 
                : 100;
            var self = this;
            setTimeout(function() { self.syncLock = false; }, delay);
        },

        /**
         * Auto-Pan der 2D-Karte wenn das Frustum ausserhalb des sichtbaren Bereichs liegt.
         * 
         * Wird bei jedem cameraChanged aufgerufen.
         * Pankt die 2D-Karte NUR wenn der Kamera-Punkt (Scheitelpunkt) ausserhalb
         * eines inneren Rands (margin) liegt → verschiebt gerade genug.
         * Während Frustum-Drag (translate/rotate/tilt) KEIN Auto-Pan,
         * da sonst Koordinaten-Sprünge entstehen.
         */
        ensureFrustumVisible: function(camData) {
            // Während Frustum-Drag kein Auto-Pan (Koordinaten würden springen)
            if (this._frustumDragActive) return;
            if (!camData || !camData.longitude || !camData.latitude) return;
            
            var map2D = this.get2DMap();
            if (!map2D) return;
            
            try {
                this.ensureLV95Projection();
                var camLV95 = ol.proj.transform(
                    [camData.longitude, camData.latitude],
                    'EPSG:4326', 'EPSG:2056'
                );
                
                var view = map2D.getView();
                var size = map2D.getSize();
                if (!size || size[0] === 0 || size[1] === 0) return;
                
                var extent = view.calculateExtent(size);
                
                // Innerer Rand (15% Margin) — Auto-Pan startet bevor Punkt ganz am Rand ist
                var margin = 0.15;
                var dx = extent[2] - extent[0];
                var dy = extent[3] - extent[1];
                var inner = [
                    extent[0] + dx * margin,
                    extent[1] + dy * margin,
                    extent[2] - dx * margin,
                    extent[3] - dy * margin
                ];
                
                // Prüfen ob Kamera-Punkt innerhalb des inneren Rands liegt
                if (ol.extent.containsCoordinate(inner, camLV95)) return;
                
                // Kamera ist ausserhalb → 2D-Karte verschieben (gerade genug)
                var center = view.getCenter();
                var newCenter = [center[0], center[1]];
                
                if (camLV95[0] < inner[0]) newCenter[0] += (camLV95[0] - inner[0]);
                if (camLV95[0] > inner[2]) newCenter[0] += (camLV95[0] - inner[2]);
                if (camLV95[1] < inner[1]) newCenter[1] += (camLV95[1] - inner[1]);
                if (camLV95[1] > inner[3]) newCenter[1] += (camLV95[1] - inner[3]);
                
                // syncLock setzen bevor view.setCenter, um circular sync zu verhindern
                this.syncLock = true;
                console.log('[3DLandscape] Auto-Pan: Frustum ausserhalb → 2D-Karte verschoben');
                view.setCenter(newCenter);
                var self2 = this;
                setTimeout(function() { self2.syncLock = false; }, 120);
            } catch(e) {
                console.warn('[3DLandscape] Error in ensureFrustumVisible:', e);
            }
        },

        /**
         * Detect active basemap and send to 3D iframe
         */
        syncBasemapTo3D: function() {
            if (!this.iframeReady) return;
            try {
                var map2D = this.get2DMap();
                if (!map2D) return;

                // Collect basemap layer info (zIndex <= 0, isBaseLayer, or Group layers)
                var basemapLayers = [];
                var self = this;
                map2D.getLayers().forEach(function(layer) {
                    if (!layer.getVisible()) return;
                    var isBase = (layer instanceof ol.layer.Group) ||
                                 layer.get('isBaseLayer') === true ||
                                 (layer.getZIndex() !== undefined && layer.getZIndex() !== null && layer.getZIndex() <= 0);
                    if (!isBase) return;

                    // Recurse groups
                    function extractSublayers(lyr) {
                        if (lyr instanceof ol.layer.Group) {
                            lyr.getLayers().forEach(function(sub) { extractSublayers(sub); });
                            return;
                        }
                        if (!lyr.getVisible()) return;
                        var src = lyr.getSource ? lyr.getSource() : null;
                        if (!src) return;
                        var info = self.extractLayerInfo(lyr);
                        if (info) {
                            info.isBasemap = true;
                            basemapLayers.push(info);
                        }
                    }
                    extractSublayers(layer);
                });

                if (basemapLayers.length > 0) {
                    console.log('[3DLandscape] Syncing basemap to 3D:', basemapLayers.length, 'sublayers');
                    self.sendToIframe({
                        type: 'syncBasemap',
                        layers: basemapLayers
                    });
                }
            } catch(e) {
                console.warn('[3DLandscape] Error syncing basemap:', e);
            }
        },

        /**
         * Send message to 3D iframe
         */
        sendToIframe: function(msg) {
            try {
                if (this.iframe && this.iframe.contentWindow) {
                    this.iframe.contentWindow.postMessage(msg, '*');
                }
            } catch(e) {
                console.warn('[3DLandscape] Cannot send to iframe:', e);
            }
        },

        /**
         * Create OpenLayers vector layer for 3D view frustum overlay
         */
        createFrustumLayer: function() {
            var map2D = this.get2DMap();
            if (!map2D) {
                console.warn('[3DLandscape] Cannot create frustum layer: map not found');
                return;
            }
            
            this.viewFrustumSource = new ol.source.Vector();
            
            // Config-Werte für Styling
            var style = window.Landscape3DConfig && window.Landscape3DConfig.frustum && window.Landscape3DConfig.frustum.style
                ? window.Landscape3DConfig.frustum.style
                : { fillColor: 'rgba(0, 120, 255, 0.15)', strokeColor: 'rgba(0, 120, 255, 0.75)', strokeWidth: 3 };
            var zIdx = window.Landscape3DConfig && window.Landscape3DConfig.frustum
                ? window.Landscape3DConfig.frustum.zIndex || 9999
                : 9999;
            
            this.viewFrustumLayer = new ol.layer.Vector({
                source: this.viewFrustumSource,
                style: new ol.style.Style({
                    fill: new ol.style.Fill({
                        color: style.fillColor
                    }),
                    stroke: new ol.style.Stroke({
                        color: style.strokeColor,
                        width: style.strokeWidth
                    })
                }),
                zIndex: zIdx
            });
            
            map2D.addLayer(this.viewFrustumLayer);
            console.log('[3DLandscape] View frustum layer created');

            // Setup drag + rotate interaction for the frustum
            this.setupFrustumInteraction(map2D);
        },

        /**
         * Frustum-Interaktion via ol.interaction.Pointer.
         * 
         * Wenn handleDownEvent true zurückgibt, "besitzt" diese Interaction die Geste
         * und DragPan wird NICHT aktiv → sauberer Pan auf der restlichen Karte.
         *
         * Kamera-Punkt (blau)   → TRANSLATE
         * Schenkel (Linien)     → ROTATE (Heading)
         * Eckpunkte (rot)       → TILT + ROTATE (Abstand = Neigung, Winkel = Heading)
         */
        setupFrustumInteraction: function(map2D) {
            var self = this;

            // Hit-Toleranz aus Config
            var hitTolerance = (window.Landscape3DConfig && window.Landscape3DConfig.frustum
                && window.Landscape3DConfig.frustum.geometry)
                ? window.Landscape3DConfig.frustum.geometry.hitTolerance || 12 : 12;

            // Hit-Detect: Frustum-Feature unter Pixel finden
            function hitTest(pixel) {
                var best = null;
                var bestPrio = -1;
                var PRIO = { camera: 5, corner: 4, sideline: 3 };
                map2D.forEachFeatureAtPixel(pixel, function(feature) {
                    var role = feature.get('_frustumRole');
                    var p = PRIO[role] || 0;
                    if (p > bestPrio) { best = role; bestPrio = p; }
                }, {
                    layerFilter: function(l) { return l === self.viewFrustumLayer; },
                    hitTolerance: hitTolerance
                });
                return best;
            }

            // Distanz → Tilt: Je weiter vom Kamerapunkt, desto flacher
            function distanceToTilt(dist, altitude) {
                var h = altitude || 800;
                var tiltRad = Math.atan2(dist, h);
                var tiltDeg = tiltRad * 180 / Math.PI;
                return Math.max(10, Math.min(85, tiltDeg));
            }

            // Interaction-State (closure)
            var mode = null;
            var rotateCamLV95 = null;
            var translateStartCoord = null;
            var translateStartCam = null;

            this._frustumInteraction = new ol.interaction.Pointer({
                // preventDefault aufrufen wenn wir die Geste besitzen → verhindert nativen Browser-Drag (🚫-Cursor)
                stopDown: function(handled) { return handled; },
                handleDownEvent: function(evt) {
                    if (!self.lastCameraData) return false;
                    var role = hitTest(evt.pixel);
                    if (!role) return false;  // Kein Frustum → DragPan darf arbeiten

                    // Frustum getroffen → Geste beanspruchen (DragPan wird blockiert)
                    self.syncLock = true;
                    self._frustumDragActive = true;
                    self.ensureLV95Projection();

                    if (role === 'corner') {
                        mode = 'tilt';
                        rotateCamLV95 = ol.proj.transform(
                            [self.lastCameraData.longitude, self.lastCameraData.latitude],
                            'EPSG:4326', 'EPSG:2056'
                        );
                    } else if (role === 'sideline') {
                        mode = 'rotate';
                        rotateCamLV95 = ol.proj.transform(
                            [self.lastCameraData.longitude, self.lastCameraData.latitude],
                            'EPSG:4326', 'EPSG:2056'
                        );
                    } else if (role === 'camera') {
                        mode = 'translate';
                        translateStartCoord = evt.coordinate;
                        translateStartCam = {
                            lon: self.lastCameraData.longitude,
                            lat: self.lastCameraData.latitude
                        };
                    }

                    map2D.getViewport().style.cursor = 'grabbing';
                    return true;  // Geste gehört uns → DragPan inaktiv
                },

                handleDragEvent: function(evt) {
                    if (!mode || !self.lastCameraData) return;
                    // requestAnimationFrame-Debounce: max 1 Update pro Frame
                    if (self._dragRAF) return;
                    var coord = evt.coordinate;
                    if (!coord) return;
                    self._dragRAF = requestAnimationFrame(function() {
                        self._dragRAF = null;

                    if (mode === 'rotate' && rotateCamLV95) {
                        var dx = coord[0] - rotateCamLV95[0];
                        var dy = coord[1] - rotateCamLV95[1];
                        var heading = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;

                        self.updateFrustum(Object.assign({}, self.lastCameraData, { heading: heading }));
                        self.sendToIframe({
                            type: 'syncCamera',
                            longitude: self.lastCameraData.longitude,
                            latitude: self.lastCameraData.latitude,
                            heading: heading,
                            tilt: self.lastCameraData.tilt
                        });
                    }

                    if (mode === 'tilt' && rotateCamLV95) {
                        var dx2 = coord[0] - rotateCamLV95[0];
                        var dy2 = coord[1] - rotateCamLV95[1];
                        var heading2 = (Math.atan2(dx2, dy2) * 180 / Math.PI + 360) % 360;
                        var dist = Math.sqrt(dx2 * dx2 + dy2 * dy2);
                        var tilt = distanceToTilt(dist, self.lastCameraData.altitude);

                        self.updateFrustum(Object.assign({}, self.lastCameraData, { heading: heading2, tilt: tilt }));
                        self.sendToIframe({
                            type: 'syncCamera',
                            longitude: self.lastCameraData.longitude,
                            latitude: self.lastCameraData.latitude,
                            heading: heading2,
                            tilt: tilt
                        });
                    }

                    if (mode === 'translate' && translateStartCoord && translateStartCam) {
                        var ddx = coord[0] - translateStartCoord[0];
                        var ddy = coord[1] - translateStartCoord[1];
                        var origLV95 = ol.proj.transform(
                            [translateStartCam.lon, translateStartCam.lat],
                            'EPSG:4326', 'EPSG:2056'
                        );
                        var newLV95 = [origLV95[0] + ddx, origLV95[1] + ddy];
                        var wgs84 = ol.proj.transform(newLV95, 'EPSG:2056', 'EPSG:4326');

                        self.updateFrustum(Object.assign({}, self.lastCameraData, {
                            longitude: wgs84[0], latitude: wgs84[1]
                        }));
                        self.sendToIframe({
                            type: 'syncCamera',
                            longitude: wgs84[0],
                            latitude: wgs84[1],
                            heading: self.lastCameraData.heading,
                            tilt: self.lastCameraData.tilt
                        });
                    }
                    }); // end requestAnimationFrame
                },

                handleUpEvent: function() {
                    mode = null;
                    rotateCamLV95 = null;
                    translateStartCoord = null;
                    translateStartCam = null;
                    map2D.getViewport().style.cursor = '';
                    self._frustumDragActive = false;
                    setTimeout(function() { self.syncLock = false; }, 200);
                    // Nach Drag-Ende: Auto-Pan prüfen falls Frustum ausserhalb
                    if (self.lastCameraData) {
                        setTimeout(function() { self.ensureFrustumVisible(self.lastCameraData); }, 250);
                    }
                    return false;
                },

                handleMoveEvent: function(evt) {
                    if (mode) return;
                    var role = hitTest(evt.pixel);
                    var viewport = map2D.getViewport();
                    if (role === 'corner') {
                        viewport.style.cursor = 'nesw-resize';
                    } else if (role === 'sideline') {
                        viewport.style.cursor = 'grab';
                    } else if (role === 'camera') {
                        viewport.style.cursor = 'move';
                    } else if (viewport.style.cursor && viewport.style.cursor !== '') {
                        viewport.style.cursor = '';
                    }
                }
            });

            map2D.addInteraction(this._frustumInteraction);
            this.frustumDragInteraction = true;
            console.log('[3DLandscape] Frustum interaction ready (ol.interaction.Pointer)');
        },

        /**
         * Create scene switcher dropdown on the 3D panel
         */
        createSceneSwitcher: function() {
            var self = this;
            var scenes = (window.Landscape3DConfig && window.Landscape3DConfig.availableScenes) || [];
            console.log('[3DLandscape] createSceneSwitcher - scenes:', scenes.length, scenes);
            if (scenes.length < 2) {
                console.warn('[3DLandscape] Not creating scene switcher - only', scenes.length, 'scene(s) available');
                return; // no point with only 1 scene
            }
            
            var rightPanel = document.getElementById('split-panel-3d');
            if (!rightPanel) {
                console.error('[3DLandscape] Cannot create scene switcher - split-panel-3d not found');
                return;
            }
            
            var switcher = document.createElement('div');
            switcher.id = 'scene-switcher-3d';
            switcher.style.cssText = 'position:absolute;top:10px;left:10px;z-index:10000;';
            
            var select = document.createElement('select');
            select.id = 'scene-select-3d';
            select.style.cssText = 'background:rgba(0,0,0,0.75);color:white;border:1px solid rgba(255,255,255,0.3);border-radius:4px;padding:6px 10px;font-size:12px;cursor:pointer;font-family:inherit;max-width:200px;';
            
            scenes.forEach(function(scene) {
                var opt = document.createElement('option');
                opt.value = scene.id;
                opt.textContent = scene.name;
                if (scene.id === self.webSceneId) opt.selected = true;
                select.appendChild(opt);
            });
            
            select.addEventListener('change', function() {
                var newId = this.value;
                if (newId && newId !== self.webSceneId) {
                    console.log('[3DLandscape] Switching scene to:', newId);
                    self.webSceneId = newId;
                    self.sendToIframe({ type: 'setWebScene', webSceneId: newId });
                }
            });
            
            switcher.appendChild(select);
            rightPanel.appendChild(switcher);
            console.log('[3DLandscape] Scene switcher created with', scenes.length, 'scenes');
        },

        /**
         * Make a URL absolute (resolve relative URLs against page origin)
         */
        makeAbsoluteUrl: function(url) {
            if (!url) return url;
            // Already absolute
            if (url.indexOf('http://') === 0 || url.indexOf('https://') === 0) return url;
            // Protocol-relative
            if (url.indexOf('//') === 0) return window.location.protocol + url;
            // Relative to root
            if (url.indexOf('/') === 0) return window.location.origin + url;
            // Relative to current page
            var base = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);
            return base + url;
        },

        /**
         * Convert agsproxy.php?path=X URLs to PATH_INFO format (agsproxy.php/X)
         * ESRI JS API's MapImageLayer appends /export, /identify etc. to the URL path.
         * With ?path= format this breaks; PATH_INFO format works correctly.
         * Beispiel: /maps/agsproxy.php?path=gis_oereb/.../MapServer
         *        → /maps/agsproxy.php/gis_oereb/.../MapServer
         */
        convertProxyUrlForEsri: function(url) {
            if (!url) return url;
            var match = url.match(/(.*agsproxy\.php)\?path=([^&]+)/);
            if (match) {
                var converted = match[1] + '/' + decodeURIComponent(match[2]);
                console.log('[3DLandscape] Proxy URL converted for ESRI:', url, '→', converted);
                return converted;
            }
            return url;
        },

        /**
         * Check if a layer is a base layer (should be excluded from sync)
         */
        isBaseLayer: function(layer) {
            // Explicit property
            if (layer.get('isBaseLayer') === true) return true;
            // zIndex <= 0 is a base layer convention
            var zIndex = layer.getZIndex();
            if (zIndex !== undefined && zIndex !== null && zIndex <= 0) return true;
            // Name-based heuristics for common Swiss basemaps
            var name = (layer.get('name') || '').toLowerCase();
            if (name.indexOf('swissimage') > -1 || name.indexOf('swisstopo') > -1 ||
                name.indexOf('ortho') > -1 || name.indexOf('pixelkarte') > -1 ||
                name.indexOf('hintergrund') > -1 || name === 'base' || name === 'basemap') return true;
            return false;
        },

        /**
         * Extract layer info from a single OL layer's source
         */
        extractLayerInfo: function(layer) {
            var source = layer.getSource ? layer.getSource() : null;
            if (!source) return null;

            var name = layer.get('name') || layer.get('title') || '';
            var opacity = layer.getOpacity();
            var url = '';
            var params = {};

            // ---- ArcGIS REST sources (ImageArcGISRest / TileArcGISRest) ----
            if ((ol.source.ImageArcGISRest && source instanceof ol.source.ImageArcGISRest) ||
                (ol.source.TileArcGISRest && source instanceof ol.source.TileArcGISRest)) {
                url = (typeof source.getUrl === 'function') ? source.getUrl() : '';
                params = (typeof source.getParams === 'function') ? (source.getParams() || {}) : {};
                if (url) {
                    var absUrl = this.makeAbsoluteUrl(url);
                    // Prüfen ob die URL tatsächlich ein ArcGIS REST Service ist
                    // oder ein OGC/MapServer-Dienst (cgi-bin/mapserv = UMN MapServer)
                    // ACHTUNG: 'mapserv' matcht ohne Regex auch 'MapServer' (ArcGIS REST)
                    // → Regex /mapserv(?!e)/ = UMN-Executable 'mapserv' aber NICHT 'mapserver'
                    var urlCheck = url.toLowerCase();
                    var isActuallyWms = (urlCheck.indexOf('cgi-bin') > -1 || /mapserv(?!e)/.test(urlCheck) ||
                                          urlCheck.indexOf('qgis') > -1 ||
                                          (urlCheck.indexOf('wms') > -1 && urlCheck.indexOf('mapserver') === -1));
                    if (isActuallyWms) {
                        // MapServer/WMS URL erkannt – immer als WMS klassifizieren
                        // LAYERS Fallback: params.LAYERS > params.layers > Layer-Name
                        var wmsLayers = params.LAYERS || params.layers || name || '';
                        return {
                            type: 'wms',
                            url: absUrl,
                            layers: wmsLayers,
                            name: name,
                            opacity: opacity,
                            transparent: params.TRANSPARENT !== false,
                            format: params.FORMAT || 'image/png'
                        };
                    }
                    return {
                        type: 'arcgis',
                        url: this.convertProxyUrlForEsri(absUrl),
                        layers: params.LAYERS || params.layers || '',
                        name: name,
                        opacity: opacity
                    };
                }
            }

            // ---- WMS sources (ImageWMS / TileWMS) ----
            if ((ol.source.ImageWMS && source instanceof ol.source.ImageWMS) ||
                (ol.source.TileWMS && source instanceof ol.source.TileWMS)) {
                if (typeof source.getUrl === 'function') {
                    url = source.getUrl();
                } else if (typeof source.getUrls === 'function') {
                    var urls = source.getUrls();
                    url = (urls && urls.length > 0) ? urls[0] : '';
                }
                params = (typeof source.getParams === 'function') ? (source.getParams() || {}) : {};
                if (url && params.LAYERS) {
                    return {
                        type: 'wms',
                        url: this.makeAbsoluteUrl(url),
                        layers: params.LAYERS,
                        name: name,
                        opacity: opacity,
                        transparent: params.TRANSPARENT !== false,
                        format: params.FORMAT || 'image/png'
                    };
                }
            }

            // ---- Fallback: duck-typing for any source with URL + LAYERS ----
            if (!url && typeof source.getUrl === 'function') {
                url = source.getUrl() || '';
            }
            if (!url && typeof source.getUrls === 'function') {
                var fallbackUrls = source.getUrls();
                url = (fallbackUrls && fallbackUrls.length > 0) ? fallbackUrls[0] : '';
            }
            if (url) {
                params = (typeof source.getParams === 'function') ? (source.getParams() || {}) : {};
                var urlLower = url.toLowerCase();
                // ArcGIS REST by URL pattern (aber NICHT MapServer-WMS wie UMN/QGIS)
                // /mapserv(?!e)/ = UMN-Executable 'mapserv' aber NICHT 'mapserver' (ArcGIS REST)
                var isArcGISUrl = (urlLower.indexOf('arcgis/rest') > -1 ||
                    urlLower.indexOf('agsproxy') > -1 ||
                    // "MapServer" nur wenn es ein ArcGIS-REST-Dienst ist (nicht UMN cgi-bin/mapserv)
                    (urlLower.indexOf('mapserver') > -1 &&
                     urlLower.indexOf('cgi-bin') === -1 &&
                     !/mapserv(?!e)/.test(urlLower) &&
                     urlLower.indexOf('qgis') === -1));
                if (isArcGISUrl) {
                    var absUrl2 = this.makeAbsoluteUrl(url);
                    return {
                        type: 'arcgis',
                        url: this.convertProxyUrlForEsri(absUrl2),
                        layers: params.LAYERS || params.layers || '',
                        name: name,
                        opacity: opacity
                    };
                }
                // WMS by LAYERS param
                if (params.LAYERS) {
                    return {
                        type: 'wms',
                        url: this.makeAbsoluteUrl(url),
                        layers: params.LAYERS,
                        name: name,
                        opacity: opacity,
                        transparent: params.TRANSPARENT !== false,
                        format: params.FORMAT || 'image/png'
                    };
                }
            }

            return null;
        },

        /**
         * Collect visible overlay layers from 2D map (WMS, ArcGIS REST, etc.)
         * Handles flat layers and LayerGroups recursively.
         */
        getVisibleOverlayLayers: function() {
            var map2D = this.get2DMap();
            if (!map2D) return [];

            var self = this;
            var layers = [];

            function collectFromLayer(layer) {
                if (!layer.getVisible()) return;

                // Skip base layers
                if (self.isBaseLayer(layer)) return;

                // Skip our own frustum layer
                if (layer === self.viewFrustumLayer) return;

                // Recurse into LayerGroups
                if (layer instanceof ol.layer.Group) {
                    layer.getLayers().forEach(function(subLayer) {
                        collectFromLayer(subLayer);
                    });
                    return;
                }

                var info = self.extractLayerInfo(layer);
                if (info) {
                    layers.push(info);
                }
            }

            map2D.getLayers().forEach(function(layer) {
                collectFromLayer(layer);
            });

            if (layers.length > 0) {
                console.log('[3DLandscape] Found', layers.length, 'overlay layers:',
                    layers.map(function(l) { return l.name + ' (' + l.type + ')'; }).join(', '));
            }
            return layers;
        },

        /**
         * Send visible overlay layers to 3D iframe
         */
        syncLayersTo3D: function() {
            if (!this.iframeReady) return;
            
            var layers = this.getVisibleOverlayLayers();
            var stateKey = JSON.stringify(layers);
            
            // Only send if changed
            if (stateKey === this.lastLayerState) return;
            this.lastLayerState = stateKey;
            
            console.log('[3DLandscape] Syncing', layers.length, 'overlay layers to 3D');
            this.sendToIframe({
                type: 'syncLayers',
                layers: layers
            });
        },

        /**
         * Watch for layer changes using OL events + fallback polling
         */
        startLayerWatch: function() {
            var self = this;

            // Clean up previous listeners
            this.stopLayerWatch();

            var map2D = this.get2DMap();
            if (map2D) {
                // Listen for layer add/remove on the map
                var collectionKey = map2D.getLayers().on(['add', 'remove'], function() {
                    console.log('[3DLandscape] Layer collection changed');
                    // Re-attach visibility listeners and sync
                    self.attachVisibilityListeners();
                    self.syncLayersTo3D();
                });
                collectionKey._collectionKey = true;
                this.layerChangeKeys.push(collectionKey);

                // Attach visibility listeners to current layers
                this.attachVisibilityListeners();
            }

            // Fallback: poll every 3 seconds for changes that events might miss
            // (e.g. sublayer visibility in groups, params changes)
            this.layerSyncTimer = setInterval(function() {
                if (self.iframeReady) {
                    self.syncLayersTo3D();
                }
            }, 3000);

            console.log('[3DLandscape] Layer watch started (events + polling)');
        },

        /**
         * Attach change:visible listeners to all current overlay layers
         */
        attachVisibilityListeners: function() {
            var self = this;
            var map2D = this.get2DMap();
            if (!map2D) return;

            // Remove old visibility keys (but keep the collection listener)
            var collectionKeys = this.layerChangeKeys.filter(function(k) {
                return k._collectionKey;
            });
            this.layerChangeKeys.forEach(function(key) {
                if (!key._collectionKey) {
                    try { ol.Observable.unByKey(key); } catch(e) {}
                }
            });
            this.layerChangeKeys = collectionKeys;

            function listenLayer(layer) {
                if (self.isBaseLayer(layer)) return;
                if (layer === self.viewFrustumLayer) return;

                if (layer instanceof ol.layer.Group) {
                    layer.getLayers().forEach(function(sub) { listenLayer(sub); });
                    return;
                }

                var key = layer.on('change:visible', function() {
                    console.log('[3DLandscape] Layer visibility changed:', layer.get('name'));
                    self.syncLayersTo3D();
                });
                self.layerChangeKeys.push(key);
            }

            map2D.getLayers().forEach(function(layer) {
                listenLayer(layer);
            });
        },

        /**
         * Stop watching layer changes
         */
        stopLayerWatch: function() {
            if (this.layerSyncTimer) {
                clearInterval(this.layerSyncTimer);
                this.layerSyncTimer = null;
            }
            // Remove all OL event keys
            this.layerChangeKeys.forEach(function(key) {
                try { ol.Observable.unByKey(key); } catch(e) {}
            });
            this.layerChangeKeys = [];
        },

        /**
         * Update the view frustum polygon on the 2D map
         * Shows camera position, view direction, and visible area
         */
        updateFrustum: function(camData) {
            if (!this.viewFrustumSource) return;
            
            try {
                this.ensureLV95Projection();
                
                // Config-Werte laden
                var camConfig = window.Landscape3DConfig && window.Landscape3DConfig.camera
                    ? window.Landscape3DConfig.camera
                    : { terrainHeightOffset: 200, fallbackTerrainHeight: 600, defaultTilt: 60, defaultFov: 55 };
                var frustumGeom = window.Landscape3DConfig && window.Landscape3DConfig.frustum && window.Landscape3DConfig.frustum.geometry
                    ? window.Landscape3DConfig.frustum.geometry
                    : { maxVisibleDistance: 30, minVisibleDistance: 500 };
                var frustumStyle = window.Landscape3DConfig && window.Landscape3DConfig.frustum && window.Landscape3DConfig.frustum.style
                    ? window.Landscape3DConfig.frustum.style
                    : { 
                        sideLineColor: 'rgba(0, 120, 255, 0.8)', sideLineWidth: 5,
                        farEdgeColor: 'rgba(0, 120, 255, 0.6)', farEdgeWidth: 4,
                        cameraMarkerRadius: 10, cameraMarkerFill: 'rgba(0, 120, 255, 0.95)',
                        cameraMarkerStroke: 'white', cameraMarkerStrokeWidth: 3,
                        cornerRadius: 7, cornerFill: 'rgba(255, 255, 255, 0.95)',
                        cornerStroke: 'rgba(220, 50, 50, 0.9)', cornerStrokeWidth: 2.5
                    };
                
                var camLV95 = ol.proj.transform(
                    [camData.longitude, camData.latitude],
                    'EPSG:4326', 'EPSG:2056'
                );
                
                var defaultAlt = camConfig.fallbackTerrainHeight + camConfig.terrainHeightOffset;
                var h = camData.altitude || defaultAlt;
                var headingRad = (camData.heading || 0) * Math.PI / 180;
                var tiltRad = (camData.tilt || camConfig.defaultTilt) * Math.PI / 180;
                var fovRad = ((camData.fov || camConfig.defaultFov) * Math.PI / 180);
                
                // Vertical FOV (assume ~16:9 aspect ratio)
                var vFov = fovRad * 0.56;
                var hFov = fovRad / 2;
                
                // Near/far ground distances based on tilt
                var tiltNear = tiltRad - vFov / 2;
                var tiltFar = tiltRad + vFov / 2;
                
                if (tiltNear < 0.02) tiltNear = 0.02;
                if (tiltFar > 1.50) tiltFar = 1.50; // ~86 degrees max
                
                var dNear = h * Math.tan(tiltNear);
                // Sichtweite aus Config
                var maxDist = Math.max(h * frustumGeom.maxVisibleDistance, frustumGeom.minVisibleDistance);
                var dFar = Math.min(h * Math.tan(tiltFar), maxDist);
                var dCenter = h * Math.tan(Math.min(tiltRad, 1.48));
                dCenter = Math.min(dCenter, maxDist * 0.75);
                
                // Horizontal spread at near/far edges
                var wNear = dNear * Math.tan(hFov);
                var wFar = dFar * Math.tan(hFov);
                
                // Direction vectors in LV95 (X=East, Y=North)
                var dx = Math.sin(headingRad);
                var dy = Math.cos(headingRad);
                // Perpendicular right
                var rx = Math.cos(headingRad);
                var ry = -Math.sin(headingRad);
                
                // Frustum corners
                var nearRight = [camLV95[0] + dx*dNear + rx*wNear, camLV95[1] + dy*dNear + ry*wNear];
                var nearLeft  = [camLV95[0] + dx*dNear - rx*wNear, camLV95[1] + dy*dNear - ry*wNear];
                var farRight  = [camLV95[0] + dx*dFar  + rx*wFar,  camLV95[1] + dy*dFar  + ry*wFar];
                var farLeft   = [camLV95[0] + dx*dFar  - rx*wFar,  camLV95[1] + dy*dFar  - ry*wFar];
                var target    = [camLV95[0] + dx*dCenter, camLV95[1] + dy*dCenter];
                
                // Features erstellen (mit Geometrie-Update statt clear/recreate)
                if (!this._frustumFeatures) {
                    // Erstmalige Erstellung
                    var sideLeftStyle = new ol.style.Style({
                        stroke: new ol.style.Stroke({
                            color: frustumStyle.sideLineColor,
                            width: frustumStyle.sideLineWidth
                        })
                    });
                    var sideRightStyle = new ol.style.Style({
                        stroke: new ol.style.Stroke({
                            color: frustumStyle.sideLineColor,
                            width: frustumStyle.sideLineWidth
                        })
                    });
                    var camMarkerStyle = new ol.style.Style({
                        image: new ol.style.Circle({
                            radius: frustumStyle.cameraMarkerRadius,
                            fill: new ol.style.Fill({ color: frustumStyle.cameraMarkerFill }),
                            stroke: new ol.style.Stroke({ color: frustumStyle.cameraMarkerStroke, width: frustumStyle.cameraMarkerStrokeWidth })
                        })
                    });
                    var cStyle = new ol.style.Style({
                        image: new ol.style.Circle({
                            radius: frustumStyle.cornerRadius,
                            fill: new ol.style.Fill({ color: frustumStyle.cornerFill }),
                            stroke: new ol.style.Stroke({ color: frustumStyle.cornerStroke, width: frustumStyle.cornerStrokeWidth })
                        })
                    });
                    
                    var sl = new ol.Feature({ geometry: new ol.geom.LineString([camLV95, farLeft]) });
                    sl.set('_frustumRole', 'sideline'); sl.setStyle(sideLeftStyle);
                    var sr = new ol.Feature({ geometry: new ol.geom.LineString([camLV95, farRight]) });
                    sr.set('_frustumRole', 'sideline'); sr.setStyle(sideRightStyle);
                    var cm = new ol.Feature({ geometry: new ol.geom.Point(camLV95) });
                    cm.set('_frustumRole', 'camera'); cm.setStyle(camMarkerStyle);
                    var cl = new ol.Feature({ geometry: new ol.geom.Point(farLeft) });
                    cl.set('_frustumRole', 'corner'); cl.setStyle(cStyle);
                    var cr = new ol.Feature({ geometry: new ol.geom.Point(farRight) });
                    cr.set('_frustumRole', 'corner'); cr.setStyle(cStyle);
                    
                    this._frustumFeatures = { sideLeft: sl, sideRight: sr, camMarker: cm, cornerLeft: cl, cornerRight: cr };
                    this.viewFrustumSource.addFeature(sl);
                    this.viewFrustumSource.addFeature(sr);
                    this.viewFrustumSource.addFeature(cm);
                    this.viewFrustumSource.addFeature(cl);
                    this.viewFrustumSource.addFeature(cr);
                } else {
                    // Geometrien aktualisieren (kein GC-Druck)
                    var ff = this._frustumFeatures;
                    ff.sideLeft.getGeometry().setCoordinates([camLV95, farLeft]);
                    ff.sideRight.getGeometry().setCoordinates([camLV95, farRight]);
                    ff.camMarker.getGeometry().setCoordinates(camLV95);
                    ff.cornerLeft.getGeometry().setCoordinates(farLeft);
                    ff.cornerRight.getGeometry().setCoordinates(farRight);
                    // Features zurück hinzufügen falls Source gecleared wurde
                    if (this.viewFrustumSource.getFeatures().length === 0) {
                        this.viewFrustumSource.addFeature(ff.sideLeft);
                        this.viewFrustumSource.addFeature(ff.sideRight);
                        this.viewFrustumSource.addFeature(ff.camMarker);
                        this.viewFrustumSource.addFeature(ff.cornerLeft);
                        this.viewFrustumSource.addFeature(ff.cornerRight);
                    }
                }
                
            } catch(e) {
                console.warn('[3DLandscape] Error updating frustum:', e);
            }
        },

        /**
         * Setup resizable divider
         * Ändert mapContainer-Breite und 3D-Panel-Breite beim Drag
         */
        setupResizer: function() {
            var self = this;
            var divider = document.getElementById('split-divider-3d');
            if (!divider) return;
            
            divider.addEventListener('mousedown', function(e) {
                self.isDragging = true;
                var overlay = document.createElement('div');
                overlay.id = 'drag-overlay-3d';
                overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;cursor:col-resize;';
                document.body.appendChild(overlay);
                
                document.addEventListener('mousemove', onDrag);
                document.addEventListener('mouseup', onDragEnd);
                e.preventDefault();
            });
            
            function onDrag(e) {
                if (!self.isDragging) return;
                var wrapper = document.getElementById('split-wrapper-3d');
                if (!wrapper) return;
                
                var rect = wrapper.getBoundingClientRect();
                var pos = Math.max(20, Math.min(80, ((e.clientX - rect.left) / rect.width) * 100));
                
                var left = document.getElementById('split-panel-2d');
                var right = document.getElementById('split-panel-3d');
                if (left && right) {
                    left.style.flex = pos.toString();
                    right.style.flex = (100 - pos).toString();
                    self.dividerPosition = pos;
                }
                // Map-Canvas während Drag aktualisieren
                self.resize2DMap();
            }
            
            function onDragEnd() {
                self.isDragging = false;
                var overlay = document.getElementById('drag-overlay-3d');
                if (overlay) overlay.remove();
                document.removeEventListener('mousemove', onDrag);
                document.removeEventListener('mouseup', onDragEnd);
                self.resize2DMap();
            }
        },

        /**
         * Trigger OL map resize
         * Debounced: ruft updateSize() verzögert auf um Layout-Thrashing zu vermeiden
         */
        resize2DMap: function() {
            var self = this;
            var map2D = this.get2DMap();
            if (!map2D || typeof map2D.updateSize !== 'function') return;
            
            // Sofort + verzögert, damit CSS-Layout Zeit hat sich zu berechnen
            map2D.updateSize();
            if (this._resizeTimer) clearTimeout(this._resizeTimer);
            this._resizeTimer = setTimeout(function() {
                map2D.updateSize();
                self._resizeTimer = null;
            }, 50);
        },

        /**
         * Disable 3D mode
         */
        disable: function() {
            console.log('[3DLandscape] Disabling...');
            
            if (this._messageHandler) {
                window.removeEventListener('message', this._messageHandler);
                this._messageHandler = null;
            }
            
            if (this.sync2DHandle) {
                if (Array.isArray(this.sync2DHandle)) {
                    this.sync2DHandle.forEach(function(k) { ol.Observable.unByKey(k); });
                } else {
                    ol.Observable.unByKey(this.sync2DHandle);
                }
                this.sync2DHandle = null;
            }
            
            // Remove frustum interaction (OL Pointer interaction)
            if (this.frustumDragInteraction) {
                var map2D_d = this.get2DMap();
                if (map2D_d) {
                    if (this._frustumInteraction) {
                        map2D_d.removeInteraction(this._frustumInteraction);
                    }
                    var vp = map2D_d.getViewport();
                    if (vp) vp.style.cursor = '';
                }
                this._frustumInteraction = null;
                this.frustumDragInteraction = null;
            }
            if (this.viewFrustumLayer) {
                var map2D = this.get2DMap();
                if (map2D) {
                    try { map2D.removeLayer(this.viewFrustumLayer); } catch(e) {}
                }
                this.viewFrustumLayer = null;
                this.viewFrustumSource = null;
            }
            this.lastCameraData = null;
            
            // Stop layer watch
            this.stopLayerWatch();
            this.lastLayerState = null;
            
            // Remove scene switcher
            var switcher = document.getElementById('scene-switcher-3d');
            if (switcher) switcher.remove();
            
            // Restore OL map target to original element
            var map2D_r = this.get2DMap();
            if (map2D_r && this._originalMapTarget) {
                map2D_r.setTarget(this._originalMapTarget);
                this._originalMapTarget = null;
                console.log('[3DLandscape] OL map target restored');
            }
            
            // Remove split wrapper
            var splitWrapper = document.getElementById('split-wrapper-3d');
            if (splitWrapper) splitWrapper.remove();
            
            // ResizeObserver aufräumen
            if (this._resizeObserver) {
                this._resizeObserver.disconnect();
                this._resizeObserver = null;
            }
            if (this._resizeTimer) {
                clearTimeout(this._resizeTimer);
                this._resizeTimer = null;
            }
            
            this.iframe = null;
            this.iframeReady = false;
            this.enabled = false;
            
            this.resize2DMap();
            
            console.log('[3DLandscape] Disabled');
        },

        /**
         * Toggle 3D mode
         */
        toggle: function(webSceneId) {
            if (this.enabled) {
                this.disable();
            } else {
                this.init(webSceneId);
            }
        },

        /**
         * Toggle sync from main page
         */
        toggleSync: function() {
            this.syncEnabled = !this.syncEnabled;
            this.sendToIframe({ type: 'toggleSync' });
            console.log('[3DLandscape] Sync:', this.syncEnabled ? 'ON' : 'OFF');
        },

        /**
         * Change WebScene
         */
        setWebScene: function(id) {
            this.webSceneId = id;
            if (this.iframe && this.iframeReady) {
                this.sendToIframe({ type: 'setWebScene', webSceneId: id });
            }
        }
    };

    // Export to global scope
    window.TnetLandscape3D = Landscape3D;
    
    window.toggleLandscape3D = function(webSceneId) {
        // Burger-Menü schließen wenn es offen ist
        var menu = document.getElementById('header_menu');
        if (menu && menu.classList.contains('open')) {
            menu.classList.remove('open');
        }
        
        if (window.TnetLandscape3D) {
            window.TnetLandscape3D.toggle(webSceneId);
        }
    };
})();
