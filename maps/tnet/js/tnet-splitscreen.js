/**
 * tnet-splitscreen.js
 * Split-screen functionality for layer comparison
 *
 * Enables side-by-side map view with synchronized navigation
 * and independent layer selection for each map panel.
 *
 * @version    1.3
 * @date       2026-02-12
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

(function() {
    'use strict';

    var SplitScreen = {
        enabled: false,
        map2: null,
        originalMapContainer: null,
        dividerPosition: 50, // percentage
        isDragging: false,
        layerControlPanel: null,
        layerControlButton: null,
        layerCatalog: null, // Layer catalog instance
        layerMapping: {}, // Maps layer name -> map2 layer
        layerSyncActive: false,
        basemapConfig: null, // Cached basemap configuration
        currentBasemapId: null, // Currently active basemap ID

        /**
         * Initialize split-screen mode
         */
        init: function() {
            console.log('[SplitScreen] Initializing...');
            
            // Create the split-screen container structure
            this.createSplitLayout();
            
            // Initialize the second map
            this.initializeMap2();
            
            // Setup synchronization between maps
            this.setupSynchronization();
            
            // Setup layer synchronization (visibility, opacity changes)
            this.setupLayerSync();
            
            // Setup resizable divider
            this.setupResizer();
            
            // Create layer control panel
            this.createLayerControl();
            
            // Setup maptips for map2
            this.setupMap2Maptips();
            
            // Initialize layer catalog for map2 (if available)
            if (typeof window.TnetLayerCatalog !== 'undefined') {
                var self = this;
                setTimeout(function() {
                    if (self.map2) {
                        self.layerCatalog = Object.create(window.TnetLayerCatalog);
                        self.layerCatalog.init(self.map2);
                        console.log('[SplitScreen] Layer catalog initialized for map2');
                    }
                }, 500);
            }
            
            this.enabled = true;
            console.log('[SplitScreen] Initialized successfully');
        },

        /**
         * Create the HTML structure for split-screen layout
         */
        createSplitLayout: function() {
            var mapContainer = document.getElementById('mapContainer');
            var originalMap = document.getElementById('map');
            
            // Store original container
            this.originalMapContainer = mapContainer;
            
            // Create wrapper for split view
            var splitWrapper = document.createElement('div');
            splitWrapper.id = 'split-wrapper';
            splitWrapper.style.cssText = 'display: flex; width: 100%; height: 100%; position: relative;';
            
            // Create left panel for original map
            var leftPanel = document.createElement('div');
            leftPanel.id = 'split-panel-left';
            leftPanel.style.cssText = 'flex: 1; position: relative; overflow: hidden;';
            
            // Create divider
            var divider = document.createElement('div');
            divider.id = 'split-divider';
            divider.style.cssText = 'width: 4px; background: #2c5f6f; cursor: col-resize; position: relative; z-index: 1000; box-shadow: 0 0 5px rgba(0,0,0,0.3);';
            divider.innerHTML = '<div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 20px; height: 40px; background: rgba(44, 95, 111, 0.8); border-radius: 4px; display: flex; align-items: center; justify-content: center; color: white; font-size: 10px;">⋮</div>';
            
            // Create right panel for second map
            var rightPanel = document.createElement('div');
            rightPanel.id = 'split-panel-right';
            rightPanel.style.cssText = 'flex: 1; position: relative; overflow: hidden; background: #f0f0f0;';
            
            // Create second map container
            var map2Container = document.createElement('div');
            map2Container.id = 'map2';
            map2Container.className = 'map-cont';
            map2Container.style.cssText = 'width: 100%; height: 100%;';
            
            // Create label for map panels
            var leftLabel = document.createElement('div');
            leftLabel.style.cssText = 'position: absolute; top: 80px; left: 10px; background: rgba(255,255,255,0.9); padding: 5px 10px; border-radius: 4px; font-size: 12px; font-weight: bold; z-index: 1000; box-shadow: 0 2px 4px rgba(0,0,0,0.2);';
            leftLabel.textContent = 'Karte A';
            
            var rightLabel = document.createElement('div');
            rightLabel.style.cssText = 'position: absolute; top: 80px; left: 10px; background: rgba(255,255,255,0.9); padding: 5px 10px; border-radius: 4px; font-size: 12px; font-weight: bold; z-index: 1000; box-shadow: 0 2px 4px rgba(0,0,0,0.2);';
            rightLabel.textContent = 'Karte B';
            
            // Assemble the structure
            leftPanel.appendChild(leftLabel);
            rightPanel.appendChild(rightLabel);
            rightPanel.appendChild(map2Container);
            
            splitWrapper.appendChild(leftPanel);
            splitWrapper.appendChild(divider);
            splitWrapper.appendChild(rightPanel);
            
            // Move original map to left panel
            leftPanel.appendChild(originalMap);
            
            // Insert split wrapper into map container
            mapContainer.appendChild(splitWrapper);
        },

        /**
         * Initialize the second map instance
         */
        initializeMap2: function() {
            var self = this;
            
            // Wait for the main map to be initialized
            var checkMainMap = setInterval(function() {
                if (typeof njs !== 'undefined' && 
                    njs.AppManager && 
                    njs.AppManager.Maps && 
                    njs.AppManager.Maps.main && 
                    njs.AppManager.Maps.main.mapObj) {
                    
                    clearInterval(checkMainMap);
                    
                    var mainMap = njs.AppManager.Maps.main.mapObj;
                    var mainView = mainMap.getView();
                    
                    console.log('[SplitScreen] Main map found, creating map2...');
                    
                    // Get view parameters with fallbacks
                    var center = mainView.getCenter();
                    var projection = mainView.getProjection();
                    var zoom = mainView.getZoom();
                    
                    console.log('[SplitScreen] Main view state:', {
                        center: center,
                        centerType: center ? typeof center : 'null',
                        centerIsArray: Array.isArray(center),
                        centerLength: center ? center.length : 0,
                        centerValues: center ? center : null,
                        zoom: zoom,
                        projection: projection ? projection.getCode() : 'null'
                    });
                    
                    // Wait for view to be ready if center is invalid
                    if (!center || !Array.isArray(center) || center.length !== 2 || !projection || typeof zoom === 'undefined') {
                        console.warn('[SplitScreen] Main map view not ready yet, waiting...', {
                            hasCenter: !!center,
                            isArray: Array.isArray(center),
                            length: center ? center.length : 0,
                            hasProjection: !!projection,
                            hasZoom: typeof zoom !== 'undefined'
                        });
                        setTimeout(function() {
                            self.initializeMap2();
                        }, 500);
                        return;
                    }
                    
                    try {
                        // WICHTIG: Beide Karten teilen sich die GLEICHE View-Instanz
                        // Das verhindert View-Initialisierungsprobleme und synchronisiert automatisch
                        self.map2 = new ol.Map({
                            target: 'map2',
                            view: mainView  // Verwende die existierende View direkt!
                        });
                        
                        console.log('[SplitScreen] Map2 created with shared view:', {
                            center: mainView.getCenter(),
                            zoom: mainView.getZoom(),
                            projection: mainView.getProjection().getCode()
                        });
                    } catch (e) {
                        console.error('[SplitScreen] Error creating map2:', e);
                        return;
                    }
                    
                    // Clone layers from main map - OHNE Baselayer (die werden separat geladen)
                    var layerCount = 0;
                    console.log('[SplitScreen] ===== Starting layer cloning (non-base layers only) =====');
                    console.log('[SplitScreen] Total layers in Map A:', mainMap.getLayers().getLength());
                    
                    mainMap.getLayers().forEach(function(layer, idx) {
                        var layerName = layer.get('name') || 'unnamed';
                        var layerType = layer.constructor.name;
                        var zIndex = layer.getZIndex();
                        var visible = layer.getVisible();
                        var isGroup = layer instanceof ol.layer.Group;
                        
                        console.log('[SplitScreen] Layer ' + idx + ':', layerName, '(type:', layerType, ', group:', isGroup, ', zIndex:', zIndex, ', visible:', visible + ')');
                        
                        // Skip Baselayer - werden über setupBaseLayerSync() geladen
                        // Baselayer sind: LayerGroups, oder Layer mit isBaseLayer=true, zIndex<=0
                        var isBaseLayer = isGroup || 
                                         layer.get('isBaseLayer') === true ||
                                         (zIndex !== undefined && zIndex !== null && zIndex <= 0);
                        
                        if (isBaseLayer) {
                            console.log('[SplitScreen]   -> Skipping baselayer (handled by setupBaseLayerSync)');
                            return;
                        }
                        
                        if (layer instanceof ol.layer.Layer) {
                            var clonedLayer = self.cloneLayer(layer);
                            if (clonedLayer) {
                                self.map2.addLayer(clonedLayer);
                                layerCount++;
                                console.log('[SplitScreen]   -> ✓ Cloned (visible: ' + clonedLayer.getVisible() + ')');
                            } else {
                                // Platzhalter für nicht klonbare Layer
                                var placeholderLayer = new ol.layer.Vector({
                                    source: new ol.source.Vector(),
                                    visible: false
                                });
                                self.map2.addLayer(placeholderLayer);
                                console.warn('[SplitScreen]   -> ✗ Placeholder created');
                            }
                            
                            var uName = layer.get('name') || layer.get('title') || 'Layer_' + idx;
                            self.layerMapping['layer_' + idx + '_' + uName] = {
                                map1Layer: layer,
                                map2Layer: clonedLayer || null,
                                name: uName,
                                index: idx
                            };
                        }
                    });
                    
                    console.log('[SplitScreen] Non-base layers cloned: ' + layerCount);
                    
                    // *** Baselayer aus basemaps.conf laden und in map2 erstellen ***
                    self.setupBaseLayerSync();
                    
                    // WICHTIG: Synchronisiere Zoom/Center nach map2 Initialisierung
                    setTimeout(function() {
                        if (self.map2 && mainView) {
                            var currentCenter = mainView.getCenter();
                            var currentZoom = mainView.getZoom();
                            var currentResolution = mainView.getResolution();
                            var currentRotation = mainView.getRotation();
                            
                            var map2View = self.map2.getView();
                            map2View.setCenter(currentCenter);
                            map2View.setZoom(currentZoom);
                            map2View.setResolution(currentResolution);
                            map2View.setRotation(currentRotation);
                            
                            // Force render
                            self.map2.updateSize();
                            self.map2.renderSync();
                            
                            console.log('[SplitScreen] Initial sync complete:', {
                                zoom: currentZoom,
                                resolution: currentResolution,
                                center: currentCenter,
                                map2Zoom: map2View.getZoom(),
                                map2Resolution: map2View.getResolution()
                            });
                        }
                    }, 500);
                    
                    // Aktualisiere Layer-Control Panel NACHDEM map2 fertig ist
                    setTimeout(function() {
                        self.populateLayerControl();
                        // Öffne Panel automatisch beim Start
                        var panel = document.getElementById('splitscreen-layer-control');
                        if (panel) {
                            panel.style.display = 'flex';
                        }
                    }, 200);
                }
            }, 100);
        },

        /**
         * Clone a layer for the second map
         */
        cloneLayer: function(layer) {
            if (!layer) return null;
            
            var layerName = layer.get('name') || layer.get('title') || 'unnamed';
            
            console.log('[SplitScreen] Attempting to clone layer:', layerName);
            console.log('[SplitScreen]   -> Constructor:', layer.constructor.name);
            
            // Handle LayerGroup (Multilayer wie Basemaps)
            if (layer instanceof ol.layer.Group) {
                console.log('[SplitScreen]   -> This is a LayerGroup (Multilayer)');
                var self = this;
                var clonedLayers = [];
                var groupVisible = layer.getVisible();
                var groupIsBaseLayer = layer.get('isBaseLayer') === true;
                
                console.log('[SplitScreen]   -> Group visible:', groupVisible, 'isBaseLayer:', groupIsBaseLayer);
                
                layer.getLayers().forEach(function(subLayer) {
                    console.log('[SplitScreen]     -> Cloning sublayer:', subLayer.get('name') || 'unnamed');
                    
                    // Vererbe isBaseLayer Property an Sublayer
                    if (groupIsBaseLayer) {
                        subLayer.set('isBaseLayer', true);
                    }
                    
                    var clonedSubLayer = self.cloneLayer(subLayer);
                    if (clonedSubLayer) {
                        // Setze Sichtbarkeit des Sublayers auf Gruppen-Sichtbarkeit
                        clonedSubLayer.setVisible(groupVisible);
                        clonedLayers.push(clonedSubLayer);
                        console.log('[SplitScreen]       -> ✓ Sublayer cloned (visible:', clonedSubLayer.getVisible() + ')');
                    }
                });
                
                if (clonedLayers.length > 0) {
                    var clonedGroup = new ol.layer.Group({
                        layers: clonedLayers,
                        opacity: layer.getOpacity(),
                        visible: groupVisible,
                        zIndex: layer.getZIndex()
                    });
                    
                    // Copy metadata
                    clonedGroup.set('name', layerName);
                    clonedGroup.set('title', layer.get('title'));
                    clonedGroup.set('isBaseLayer', groupIsBaseLayer);
                    
                    console.log('[SplitScreen]   -> ✓ LayerGroup cloned with', clonedLayers.length, 'sublayers (visible:', groupVisible + ')');
                    return clonedGroup;
                } else {
                    console.warn('[SplitScreen]   -> ✗ LayerGroup has no cloneable sublayers');
                    return null;
                }
            }
            
            // Regular layer handling
            if (!layer.getSource) {
                console.warn('[SplitScreen]   -> Layer has no getSource method');
                return null;
            }
            
            var source = layer.getSource();
            if (!source) {
                console.warn('[SplitScreen]   -> Layer has no source');
                return null;
            }
            
            var newSource = null;
            
            console.log('[SplitScreen]   -> Source constructor:', source.constructor.name);
            
            try {
                // Bestimme Source-Typ über constructor.name
                var constructorName = source.constructor.name;
                console.log('[SplitScreen] Source constructor:', constructorName);
                
                // TileWMS
                if (source instanceof ol.source.TileWMS) {
                    var params = source.getParams ? source.getParams() : {};
                    var serverType = 'mapserver'; // Default
                    try {
                        if (source.getServerType) serverType = source.getServerType();
                    } catch (e) {}
                    
                    newSource = new ol.source.TileWMS({
                        url: source.getUrl(),
                        params: Object.assign({}, params),
                        serverType: serverType,
                        crossOrigin: 'anonymous'
                    });
                    console.log('[SplitScreen] Created TileWMS source');
                }
                // ImageWMS
                else if (source instanceof ol.source.ImageWMS) {
                    var params = source.getParams ? source.getParams() : {};
                    var serverType = 'mapserver';
                    try {
                        if (source.getServerType) serverType = source.getServerType();
                    } catch (e) {}
                    
                    newSource = new ol.source.ImageWMS({
                        url: source.getUrl(),
                        params: Object.assign({}, params),
                        serverType: serverType,
                        crossOrigin: 'anonymous'
                    });
                    console.log('[SplitScreen] Created ImageWMS source');
                }
                // TileArcGISRest
                else if (source instanceof ol.source.TileArcGISRest) {
                    var params = source.getParams ? source.getParams() : {};
                    newSource = new ol.source.TileArcGISRest({
                        url: source.getUrl(),
                        params: Object.assign({}, params),
                        crossOrigin: 'anonymous'
                    });
                    console.log('[SplitScreen] Created TileArcGISRest source');
                }
                // ImageArcGISRest
                else if (source instanceof ol.source.ImageArcGISRest) {
                    var params = source.getParams ? source.getParams() : {};
                    newSource = new ol.source.ImageArcGISRest({
                        url: source.getUrl(),
                        params: Object.assign({}, params),
                        crossOrigin: 'anonymous'
                    });
                    console.log('[SplitScreen] Created ImageArcGISRest source');
                }
                // XYZ
                else if (source instanceof ol.source.XYZ) {
                    var url = source.getUrl ? source.getUrl() : (source.getUrls ? source.getUrls()[0] : null);
                    if (url) {
                        newSource = new ol.source.XYZ({
                            url: url,
                            crossOrigin: 'anonymous'
                        });
                        console.log('[SplitScreen] Created XYZ source');
                    }
                }
                // OSM
                else if (source instanceof ol.source.OSM) {
                    newSource = new ol.source.OSM();
                    console.log('[SplitScreen] Created OSM source');
                }
                // WMTS
                else if (source instanceof ol.source.WMTS) {
                    // WMTS ist komplex - versuche zu klonen
                    try {
                        newSource = new ol.source.WMTS({
                            url: source.getUrls ? source.getUrls()[0] : undefined,
                            layer: source.getLayer ? source.getLayer() : '',
                            matrixSet: source.getMatrixSet ? source.getMatrixSet() : '',
                            format: source.getFormat ? source.getFormat() : 'image/png',
                            projection: source.getProjection(),
                            tileGrid: source.getTileGrid(),
                            style: source.getStyle ? source.getStyle() : 'default',
                            crossOrigin: 'anonymous'
                        });
                        console.log('[SplitScreen] Created WMTS source');
                    } catch (e) {
                        console.warn('[SplitScreen] WMTS clone failed, skipping:', e.message);
                        return null;
                    }
                }
                // Vector - nur wenn Features vorhanden
                else if (source instanceof ol.source.Vector) {
                    var features = source.getFeatures ? source.getFeatures() : [];
                    console.log('[SplitScreen] Vector layer with', features.length, 'features');
                    
                    // Skip tool/drawing layers (keine Features)
                    if (features.length === 0) {
                        console.log('[SplitScreen] Skipping empty Vector layer (tool layer)');
                        return null;
                    }
                    
                    // Klone Vector-Source mit Features
                    newSource = new ol.source.Vector({
                        features: features.map(function(f) { return f.clone(); })
                    });
                    console.log('[SplitScreen] Created Vector source');
                }
                // Unbekannter Typ
                else {
                    console.warn('[SplitScreen] Unknown/unsupported source type:', constructorName);
                    return null;
                }
            } catch (e) {
                console.error('[SplitScreen] Error cloning source:', e.message, e.stack);
                return null;
            }
            
            if (!newSource) return null;
            
            // Bestimme initiale Sichtbarkeit
            // Baselayer sollten die gleiche Sichtbarkeit wie in Map A haben
            // Andere Layer sollten standardmäßig UNSICHTBAR sein
            var initialVisible = false;
            var layerName = layer.get('name') || layer.get('title') || 'unnamed';
            
            // Prüfe ob Layer als BaseLayer markiert ist (z-index 0 oder property)
            var isBaseLayer = false;
            try {
                // Baselayer haben typischerweise zIndex 0 oder negative Werte
                var zIndex = layer.getZIndex();
                if (zIndex !== undefined && zIndex <= 0) {
                    isBaseLayer = true;
                }
                
                // Oder explizit als isBaseLayer markiert
                if (layer.get('isBaseLayer') === true) {
                    isBaseLayer = true;
                }
                
                // Oder Namen enthalten typische Baselayer-Begriffe
                if (layerName.includes('base') || 
                    layerName.includes('background') ||
                    layerName.includes('fond') ||
                    layerName.includes('ortho') ||
                    layerName.includes('hintergrund') ||
                    layerName.includes('swissimage') ||
                    layerName.includes('swisstopo')) {
                    isBaseLayer = true;
                }
            } catch (e) {
                // Ignore errors
            }
            
            // Baselayer übernehmen die Sichtbarkeit vom Original
            if (isBaseLayer) {
                initialVisible = layer.getVisible();
                console.log('[SplitScreen]   -> Baselayer detected, using original visibility:', initialVisible);
            }
            
            var newLayer = null;
            try {
                if (layer instanceof ol.layer.Tile) {
                    newLayer = new ol.layer.Tile({
                        source: newSource,
                        opacity: layer.getOpacity(),
                        visible: initialVisible,
                        zIndex: layer.getZIndex()
                    });
                } else if (layer instanceof ol.layer.Image) {
                    newLayer = new ol.layer.Image({
                        source: newSource,
                        opacity: layer.getOpacity(),
                        visible: initialVisible,
                        zIndex: layer.getZIndex()
                    });
                } else if (layer instanceof ol.layer.Vector) {
                    // Für Vector-Layer: Source direkt referenzieren
                    newLayer = new ol.layer.Vector({
                        source: source,
                        opacity: layer.getOpacity(),
                        visible: initialVisible,
                        zIndex: layer.getZIndex()
                    });
                } else {
                    console.warn('[SplitScreen] Unknown layer type, trying generic Layer');
                    newLayer = new ol.layer.Layer({
                        source: newSource,
                        opacity: layer.getOpacity(),
                        visible: initialVisible,
                        zIndex: layer.getZIndex()
                    });
                }
            } catch (e) {
                console.error('[SplitScreen] Error creating layer:', e.message);
                return null;
            }
            
            // Copy layer metadata
            if (newLayer) {
                newLayer.set('name', layer.get('name'));
                newLayer.set('title', layer.get('title'));
                newLayer.set('isBaseLayer', layer.get('isBaseLayer'));
                
                console.log('[SplitScreen]   -> ✓ Layer created (visible:', newLayer.getVisible(), ', zIndex:', newLayer.getZIndex() + ')');
            }
            
            return newLayer;
        },

        /**
         * Setup basemap synchronization for map2
         * Loads basemaps.conf via PHP service, determines active basemap,
         * creates it in map2, and hooks changeBaseMap for ongoing sync.
         */
        setupBaseLayerSync: function() {
            var self = this;
            
            if (!this.map2) {
                console.warn('[SplitScreen] setupBaseLayerSync: map2 not ready');
                return;
            }
            
            console.log('[SplitScreen] ===== Setting up Basemap Sync =====');
            
            // Determine current basemap from URL or DOM
            var currentBasemap = this.detectCurrentBasemap();
            console.log('[SplitScreen] Current basemap detected:', currentBasemap);
            
            // Fetch basemaps.conf via PHP service
            fetch('/maps/tnet/php/basemaps-to-json.php')
                .then(function(response) { return response.json(); })
                .then(function(basemapConfig) {
                    self.basemapConfig = basemapConfig;
                    console.log('[SplitScreen] Basemap config loaded, keys:', Object.keys(basemapConfig));
                    
                    // Create basemap in map2
                    if (currentBasemap && basemapConfig[currentBasemap]) {
                        self.createBasemapInMap2(currentBasemap, basemapConfig[currentBasemap]);
                    } else {
                        console.warn('[SplitScreen] Basemap "' + currentBasemap + '" not found in config, trying first available');
                        // Try first non-void basemap
                        for (var key in basemapConfig) {
                            if (basemapConfig[key].type !== 'void') {
                                self.createBasemapInMap2(key, basemapConfig[key]);
                                break;
                            }
                        }
                    }
                    
                    // Hook into changeBaseMap calls
                    self.hookChangeBaseMap();
                    
                    // Hook into BasemapTimeManager time changes
                    self._hookTimeDimensionSync();
                })
                .catch(function(err) {
                    console.error('[SplitScreen] Failed to load basemap config:', err);
                });
        },

        /**
         * Detect the currently active basemap
         */
        detectCurrentBasemap: function() {
            // 1. Try URL parameter
            var urlParams = new URLSearchParams(window.location.search);
            var basemapParam = urlParams.get('basemap');
            if (basemapParam) {
                return basemapParam;
            }
            
            // 2. Try active basemap card in DOM
            var activeCard = document.querySelector('.basemap-card.active');
            if (activeCard && activeCard.dataset.basemap) {
                return activeCard.dataset.basemap;
            }
            
            // 3. Default
            return 'swissimage';
        },

        /**
         * Create a basemap in map2 from basemaps.conf configuration
         */
        createBasemapInMap2: function(basemapId, config) {
            var self = this;
            
            console.log('[SplitScreen] Creating basemap in map2:', basemapId);
            
            // Remove existing basemap layers from map2
            this.removeBasemapFromMap2();
            
            this.currentBasemapId = basemapId;
            
            // Handle "leer" / "none" / "void"
            if (config.type === 'void' || basemapId === 'leer' || basemapId === 'none') {
                console.log('[SplitScreen] Basemap is void/none - no layers to add');
                return;
            }
            
            // Handle multisource basemaps
            if (config.multisource && config.items) {
                console.log('[SplitScreen] Creating multisource basemap with', config.items.length, 'items');
                var layerGroup = [];
                var wmtsPromises = [];
                
                config.items.forEach(function(item, idx) {
                    wmtsPromises.push(
                        self.createBasemapLayerFromItem(item, config, idx)
                            .then(function(layer) {
                                if (layer) {
                                    layerGroup.push({ layer: layer, index: idx });
                                }
                            })
                    );
                });
                
                Promise.all(wmtsPromises).then(function() {
                    // Sort by original index
                    layerGroup.sort(function(a, b) { return a.index - b.index; });
                    
                    var layers = layerGroup.map(function(item) { return item.layer; });
                    
                    if (layers.length > 0) {
                        var group = new ol.layer.Group({
                            layers: layers,
                            opacity: config.opacity || 1,
                            visible: true,
                            zIndex: 0
                        });
                        group.set('name', 'basemap_' + basemapId);
                        group.set('isBaseLayer', true);
                        group.set('basemapId', basemapId);
                        
                        // Insert at bottom (index 0)
                        self.map2.getLayers().insertAt(0, group);
                        console.log('[SplitScreen] ✓ Multisource basemap added with', layers.length, 'sublayers');
                        self.map2.renderSync();
                    }
                });
            }
            // Handle single-source basemaps
            else {
                console.log('[SplitScreen] Creating single-source basemap');
                this.createBasemapLayerFromItem(config, config, 0)
                    .then(function(layer) {
                        if (layer) {
                            layer.set('name', 'basemap_' + basemapId);
                            layer.set('isBaseLayer', true);
                            layer.set('basemapId', basemapId);
                            layer.setZIndex(0);
                            
                            // Insert at bottom (index 0)
                            self.map2.getLayers().insertAt(0, layer);
                            console.log('[SplitScreen] ✓ Single-source basemap added');
                            self.map2.renderSync();
                        }
                    });
            }
        },

        /**
         * Create a single layer from a basemap item config
         * Returns a Promise that resolves to the layer
         */
        createBasemapLayerFromItem: function(item, parentConfig, idx) {
            var self = this;
            var itemType = (item.type || '').toLowerCase();
            
            console.log('[SplitScreen]   Creating basemap item', idx, '- type:', item.type);
            
            // WMTS from capabilities
            if (itemType === 'wmtscapabilities') {
                return fetch(item.url)
                    .then(function(response) { return response.text(); })
                    .then(function(text) {
                        var parser = new ol.format.WMTSCapabilities();
                        var result = parser.read(text);
                        
                        var options = ol.source.WMTS.optionsFromCapabilities(result, {
                            layer: item.layer,
                            matrixSet: 'EPSG:2056'
                        });
                        
                        if (!options) {
                            // Try without specific matrixSet
                            options = ol.source.WMTS.optionsFromCapabilities(result, {
                                layer: item.layer
                            });
                        }
                        
                        if (options) {
                            options.crossOrigin = 'anonymous';
                            var source = new ol.source.WMTS(options);
                            
                            var layerOptions = {
                                source: source,
                                opacity: item.opacity || parentConfig.opacity || 1,
                                visible: true
                            };
                            
                            // Resolution visibility
                            if (item.resol_visibility) {
                                layerOptions.minResolution = item.resol_visibility[0];
                                layerOptions.maxResolution = item.resol_visibility[1];
                            }
                            if (parentConfig.minResolution !== undefined) {
                                layerOptions.minResolution = Math.max(layerOptions.minResolution || 0, parentConfig.minResolution);
                            }
                            
                            var layer = new ol.layer.Tile(layerOptions);
                            layer.set('isBaseLayer', true);
                            
                            console.log('[SplitScreen]     ✓ WMTS layer created:', item.layer);
                            return layer;
                        } else {
                            console.warn('[SplitScreen]     ✗ WMTS options not found for layer:', item.layer);
                            return null;
                        }
                    })
                    .catch(function(err) {
                        console.error('[SplitScreen]     ✗ WMTS capabilities fetch failed:', err.message);
                        return null;
                    });
            }
            
            // WMS
            if (itemType === 'wms') {
                var singleTile = item.options && item.options.singleTile;
                var layer;
                
                if (singleTile) {
                    var source = new ol.source.ImageWMS({
                        url: item.url,
                        params: item.params || {},
                        crossOrigin: 'anonymous'
                    });
                    
                    var layerOptions = {
                        source: source,
                        opacity: item.opacity || parentConfig.opacity || 1,
                        visible: true
                    };
                    
                    if (item.resol_visibility) {
                        layerOptions.minResolution = item.resol_visibility[0];
                        layerOptions.maxResolution = item.resol_visibility[1];
                    }
                    
                    layer = new ol.layer.Image(layerOptions);
                } else {
                    var source = new ol.source.TileWMS({
                        url: item.url,
                        params: item.params || {},
                        crossOrigin: 'anonymous'
                    });
                    
                    var layerOptions = {
                        source: source,
                        opacity: item.opacity || parentConfig.opacity || 1,
                        visible: true
                    };
                    
                    if (item.resol_visibility) {
                        layerOptions.minResolution = item.resol_visibility[0];
                        layerOptions.maxResolution = item.resol_visibility[1];
                    }
                    
                    layer = new ol.layer.Tile(layerOptions);
                }
                
                layer.set('isBaseLayer', true);
                console.log('[SplitScreen]     ✓ WMS layer created:', (item.params && item.params.layers) || 'unnamed');
                return Promise.resolve(layer);
            }
            
            // ArcGIS REST
            if (itemType === 'arcgisrest' || itemType === 'arcgis') {
                var source = new ol.source.TileArcGISRest({
                    url: item.url,
                    params: item.params || {},
                    crossOrigin: 'anonymous'
                });
                
                var layer = new ol.layer.Tile({
                    source: source,
                    opacity: item.opacity || parentConfig.opacity || 1,
                    visible: true
                });
                
                layer.set('isBaseLayer', true);
                console.log('[SplitScreen]     ✓ ArcGIS REST layer created');
                return Promise.resolve(layer);
            }
            
            console.warn('[SplitScreen]     ✗ Unknown basemap item type:', item.type);
            return Promise.resolve(null);
        },

        /**
         * Remove all basemap layers from map2
         */
        removeBasemapFromMap2: function() {
            if (!this.map2) return;
            
            var map2 = this.map2;
            var layersToRemove = [];
            map2.getLayers().forEach(function(layer) {
                if (layer.get('isBaseLayer') || layer.get('basemapId')) {
                    layersToRemove.push(layer);
                }
            });
            
            layersToRemove.forEach(function(layer) {
                map2.removeLayer(layer);
            });
            
            if (layersToRemove.length > 0) {
                console.log('[SplitScreen] Removed', layersToRemove.length, 'basemap layers from map2');
            }
        },

        /**
         * Hook into changeBaseMap to sync basemap changes to map2
         */
        hookChangeBaseMap: function() {
            var self = this;
            
            if (!njs || !njs.AppManager || !njs.AppManager.Maps || !njs.AppManager.Maps.main) {
                console.warn('[SplitScreen] Cannot hook changeBaseMap - njs not ready');
                return;
            }
            
            var mainMapInstance = njs.AppManager.Maps.main;
            
            // Store original function
            if (!mainMapInstance._originalChangeBaseMap) {
                mainMapInstance._originalChangeBaseMap = mainMapInstance.changeBaseMap;
                
                // Replace with hooked version
                mainMapInstance.changeBaseMap = function(basemapId) {
                    console.log('[SplitScreen] changeBaseMap intercepted:', basemapId);
                    
                    // Remember view BEFORE the switch
                    var mainMap = mainMapInstance.mapObj;
                    var viewBefore = mainMap ? mainMap.getView() : null;
                    
                    // Call original
                    var result = mainMapInstance._originalChangeBaseMap.call(mainMapInstance, basemapId);
                    
                    // Check if the View was replaced by the framework
                    if (mainMap && self.map2) {
                        var viewAfter = mainMap.getView();
                        if (viewBefore && viewAfter && viewBefore !== viewAfter) {
                            console.log('[SplitScreen] ⚡ View replaced by changeBaseMap! Updating map2...');
                            self.map2.setView(viewAfter);
                            self._attachViewListener(viewAfter);
                            self.map2.renderSync();
                        }
                    }
                    
                    // Sync basemap to map2
                    if (self.enabled && self.map2 && self.basemapConfig) {
                        if (self.basemapConfig[basemapId]) {
                            self.createBasemapInMap2(basemapId, self.basemapConfig[basemapId]);
                        } else if (basemapId === 'none' || basemapId === 'leer') {
                            self.removeBasemapFromMap2();
                            self.currentBasemapId = basemapId;
                        }
                    }
                    
                    return result;
                };
                
                console.log('[SplitScreen] ✓ changeBaseMap hooked for map2 sync');
            }
        },

        /**
         * Hook into BasemapTimeManager's time-change events to sync TIME dimension to map2.
         * Listens for the 'basemap-time-change' custom event dispatched by tnet-basemap-time.js.
         */
        _hookTimeDimensionSync: function() {
            var self = this;
            
            // Remove previous listener if any
            if (this._timeDimensionHandler) {
                document.removeEventListener('basemap-time-change', this._timeDimensionHandler);
            }
            
            this._timeDimensionHandler = function(evt) {
                if (!self.enabled || !self.map2) return;
                
                var detail = evt.detail;
                console.log('[SplitScreen] Time overlay sync:', detail.year, '(' + detail.timeValue + ')');
                
                try {
                    // Remove existing time overlays from map2
                    self._removeTimeOverlaysFromMap(self.map2);
                    
                    // If timeValue is null → "current" year, no overlay needed
                    if (!detail.timeValue || !detail.wmtsUrl) {
                        // Restore base layer visibility on map2
                        self._setMap2BaseLayerVisibility(true);
                        return;
                    }
                    
                    // Build the WMTS URL with time baked in
                    var wmtsUrl = detail.wmtsUrl.replace('{Time}', detail.timeValue);
                    
                    // swisstopo WMTS TileGrid
                    var resolutions = [
                        4000, 3750, 3500, 3250, 3000, 2750, 2500, 2250, 2000, 1750,
                        1500, 1250, 1000, 750, 650, 500, 250, 100, 50, 20,
                        10, 5, 2.5, 2, 1.5, 1, 0.5, 0.25, 0.1
                    ];
                    var matrixIds = [];
                    for (var mi = 0; mi < resolutions.length; mi++) matrixIds.push(mi.toString());
                    
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
                            resolutions: resolutions,
                            matrixIds: matrixIds
                        }),
                        crossOrigin: 'anonymous'
                    });
                    
                    var overlayOpacity = (window.BasemapTimeManager && window.BasemapTimeManager._currentOpacity !== undefined)
                        ? window.BasemapTimeManager._currentOpacity : 1;
                    var layer = new ol.layer.Tile({ source: source, opacity: overlayOpacity, visible: true });
                    layer.set('_isTimeOverlay', true);
                    layer.set('_timeValue', detail.timeValue);
                    
                    var layers = self.map2.getLayers();
                    if (layers.getLength() > 0) {
                        layers.insertAt(1, layer);
                    } else {
                        layers.push(layer);
                    }

                    // Apply grayscale if active
                    if (window.BasemapTimeManager && window.BasemapTimeManager._isGrayscale) {
                        window.BasemapTimeManager._applyGrayscaleCSS(layer, true);
                    }

                    // Hide base layer on map2 so it doesn't show through
                    self._setMap2BaseLayerVisibility(false);
                    console.log('[SplitScreen] ✓ Time overlay synced to map2');
                    
                } catch (e) {
                    console.warn('[SplitScreen] Time overlay sync error:', e);
                }
            };
            
            document.addEventListener('basemap-time-change', this._timeDimensionHandler);
            console.log('[SplitScreen] ✓ Time dimension sync hooked');
        },
        
        /**
         * Remove all time overlay layers (marked _isTimeOverlay) from a map.
         */
        _removeTimeOverlaysFromMap: function(map) {
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

        /**
         * Hide or show the base layer (index 0) on map2 to prevent the
         * original basemap from showing through the time overlay.
         */
        _setMap2BaseLayerVisibility: function(visible) {
            if (!this.map2) return;
            try {
                var layers = this.map2.getLayers().getArray();
                for (var i = 0; i < layers.length; i++) {
                    if (!layers[i].get('_isTimeOverlay')) {
                        layers[i].setVisible(visible);
                        break;
                    }
                }
            } catch (e) { /* ignore */ }
        },

        /**
         * Setup synchronization between the two maps.
         * Both maps share the SAME View instance (view: mainView),
         * so zoom/center/rotation are automatically in sync.
         * We also watch for View replacement (e.g. after basemap switch)
         * and re-attach map2 to the new View.
         */
        setupSynchronization: function() {
            var self = this;
            this._viewChangeListenerKey = null;
            
            var checkMainMap = setInterval(function() {
                if (typeof njs !== 'undefined' && 
                    njs.AppManager && 
                    njs.AppManager.Maps && 
                    njs.AppManager.Maps.main && 
                    njs.AppManager.Maps.main.mapObj) {
                    
                    clearInterval(checkMainMap);
                    
                    var mainMap = njs.AppManager.Maps.main.mapObj;
                    
                    // Attach render-trigger to the current View
                    self._attachViewListener(mainMap.getView());
                    
                    // CRITICAL: Watch for View replacement on the main map
                    // Framework's changeBaseMap may create a NEW View instance
                    mainMap.on('change:view', function() {
                        var newView = mainMap.getView();
                        console.log('[SplitScreen] ⚡ Main map View replaced! Re-syncing map2...');
                        
                        if (self.map2 && newView) {
                            // Transfer map2 to the new View so both maps stay in sync
                            self.map2.setView(newView);
                            
                            // Re-attach the render listener to the new View
                            self._attachViewListener(newView);
                            
                            // Force immediate re-render
                            self.map2.renderSync();
                            
                            console.log('[SplitScreen] ✓ map2 re-synced to new View:', {
                                center: newView.getCenter(),
                                zoom: newView.getZoom()
                            });
                        }
                    });
                    
                    console.log('[SplitScreen] View sync: shared View instance + change:view watcher');
                }
            }, 100);
        },
        
        /**
         * Attach a render-trigger listener to a View instance.
         * Removes old listener if one exists.
         */
        _attachViewListener: function(view) {
            var self = this;
            
            // Remove old listener
            if (this._viewChangeListenerKey) {
                ol.Observable.unByKey(this._viewChangeListenerKey);
                this._viewChangeListenerKey = null;
            }
            
            // Attach new listener
            this._viewChangeListenerKey = view.on('change', function() {
                if (self.map2) {
                    self.map2.render();
                }
            });
        },

        /**
         * Setup layer synchronization - wenn Layer in Map A ändern, auch in Map B ändern
         */
        setupLayerSync: function() {
            var self = this;
            
            if (!this.map2) return;
            
            var mainMap = njs.AppManager.Maps.main.mapObj;
            if (!mainMap) return;
            
            console.log('[SplitScreen] Setting up layer synchronization (including baselayers)');
            
            // Watch für Layer-Änderungen in der Hauptkarte
            var layerCollection = mainMap.getLayers();
            var map2LayerCollection = this.map2.getLayers();
            
            // Wenn neue Layer hinzugefügt werden
            // HINWEIS: Basemap-Wechsel werden von hookChangeBaseMap() behandelt, hier überspringen!
            layerCollection.on('add', function(event) {
                var addedLayer = event.element;
                var layerName = addedLayer.get('name') || 'unnamed';
                var isLayerGroup = addedLayer instanceof ol.layer.Group;
                
                console.log('[SplitScreen] Layer added in Map A:', layerName, '(isGroup:', isLayerGroup + ')');
                
                // Basemap-Layer überspringen - hookChangeBaseMap() kümmert sich darum
                if (isLayerGroup || addedLayer.get('isBaseLayer') === true) {
                    console.log('[SplitScreen]   -> Skipping basemap layer (handled by hookChangeBaseMap)');
                    return;
                }
                
                // Finde die Position des neuen Layers in Map A
                var layerIndex = -1;
                mainMap.getLayers().forEach(function(lyr, idx) {
                    if (lyr === addedLayer) {
                        layerIndex = idx;
                    }
                });
                
                // Klone den neuen Layer für Map B
                var clonedLayer = self.cloneLayer(addedLayer);
                if (clonedLayer) {
                    // Füge den Layer an der gleichen Position ein
                    if (layerIndex >= 0 && layerIndex < map2LayerCollection.getLength()) {
                        map2LayerCollection.insertAt(layerIndex, clonedLayer);
                        console.log('[SplitScreen] Layer inserted at index', layerIndex, 'in Map B');
                    } else {
                        self.map2.addLayer(clonedLayer);
                        console.log('[SplitScreen] Layer added to Map B');
                    }
                    
                    // Speichere Mapping
                    self.layerMapping[layerName] = clonedLayer;
                }
                
                // Aktualisiere Layer-Control Panel
                setTimeout(function() {
                    self.populateLayerControl();
                }, 100);
            });
            
            // Wenn Layer entfernt werden
            layerCollection.on('remove', function(event) {
                var removedLayer = event.element;
                var layerName = removedLayer.get('name') || 'unnamed';
                
                // Basemap-Layer überspringen - hookChangeBaseMap() kümmert sich darum
                if (removedLayer instanceof ol.layer.Group || removedLayer.get('isBaseLayer') === true) {
                    console.log('[SplitScreen] Basemap layer removed from Map A:', layerName, '(handled by hookChangeBaseMap)');
                    return;
                }
                
                console.log('[SplitScreen] Layer removed from Map A:', layerName);
                
                // Entferne entsprechenden Layer aus Map B
                var map2Layer = self.layerMapping[layerName];
                if (map2Layer) {
                    map2LayerCollection.remove(map2Layer);
                    delete self.layerMapping[layerName];
                    console.log('[SplitScreen] Removed corresponding layer from Map B');
                }
                
                // Aktualisiere Layer-Control Panel
                setTimeout(function() {
                    self.populateLayerControl();
                }, 100);
            });
            
            // Beobachte Visibility-Änderungen in allen Layern von Map A
            layerCollection.forEach(function(layer) {
                layer.on('change:visible', function() {
                    var layerName = layer.get('name') || layer.get('title') || 'unnamed';
                    var visibility = layer.getVisible();
                    
                    // Finde entsprechenden Layer in Map B
                    var map2Layer = self.layerMapping[layerName];
                    if (map2Layer) {
                        map2Layer.setVisible(visibility);
                        console.log('[SplitScreen] Layer visibility sync:', layerName, '- now', visibility);
                    }
                    
                    // Aktualisiere Checkbox im Panel
                    var checkbox = document.getElementById('layer-cb-' + layerName);
                    if (checkbox) {
                        checkbox.checked = visibility;
                    }
                });
                
                // Beobachte auch Opacity-Änderungen
                layer.on('change:opacity', function() {
                    var layerName = layer.get('name') || layer.get('title') || 'unnamed';
                    var opacity = layer.getOpacity();
                    
                    var map2Layer = self.layerMapping[layerName];
                    if (map2Layer) {
                        map2Layer.setOpacity(opacity);
                        console.log('[SplitScreen] Layer opacity sync:', layerName, '- now', opacity);
                    }
                });
            });
            
            console.log('[SplitScreen] Layer synchronization initialized');
        },

        /**
         * Setup resizable divider between the two map panels
         */
        setupResizer: function() {
            var self = this;
            var divider = document.getElementById('split-divider');
            var leftPanel = document.getElementById('split-panel-left');
            var rightPanel = document.getElementById('split-panel-right');
            
            if (!divider || !leftPanel || !rightPanel) return;
            
            divider.addEventListener('mousedown', function(e) {
                self.isDragging = true;
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
                e.preventDefault();
            });
            
            document.addEventListener('mousemove', function(e) {
                if (!self.isDragging) return;
                
                var container = document.getElementById('split-wrapper');
                var containerRect = container.getBoundingClientRect();
                var offsetX = e.clientX - containerRect.left;
                var percentage = (offsetX / containerRect.width) * 100;
                
                // Limit to 20%-80%
                percentage = Math.max(20, Math.min(80, percentage));
                
                leftPanel.style.flex = percentage;
                rightPanel.style.flex = (100 - percentage);
                
                // Update maps
                if (njs.AppManager.Maps.main && njs.AppManager.Maps.main.mapObj) {
                    njs.AppManager.Maps.main.mapObj.updateSize();
                }
                if (self.map2) {
                    self.map2.updateSize();
                }
            });
            
            document.addEventListener('mouseup', function() {
                if (self.isDragging) {
                    self.isDragging = false;
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                }
            });
        },

        /**
         * Create layer control panel to select which layers appear in map B
         */
        createLayerControl: function() {
            var self = this;
            var rightPanel = document.getElementById('split-panel-right');
            if (!rightPanel) return;
            
            // Create toggle button (icon) in map B
            var btn = document.createElement('button');
            btn.id = 'split-layer-btn';
            btn.title = 'Layer für Karte B auswählen';
            btn.style.cssText = 'position: absolute; top: 10px; right: 10px; width: 36px; height: 36px; background: white; border: none; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.2); cursor: pointer; z-index: 1002; display: flex; align-items: center; justify-content: center;';
            btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
            
            // Create panel container (popup)
            var panel = document.createElement('div');
            panel.id = 'splitscreen-layer-control';
            panel.style.cssText = 'position: absolute; top: 52px; right: 10px; width: 260px; max-height: 400px; background: white; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.3); z-index: 1003; display: none; flex-direction: column;';
            
            // Header
            var header = document.createElement('div');
            header.style.cssText = 'padding: 10px; background: #2c5f6f; color: white; font-weight: bold; font-size: 13px; border-radius: 4px 4px 0 0; display: flex; justify-content: space-between; align-items: center;';
            header.innerHTML = '<span>Layer für Karte B</span><div><button id="layer-control-reload" style="background: none; border: none; color: white; cursor: pointer; margin-right: 8px; font-size: 16px;" title="Layer neu laden">↻</button><span style="cursor: pointer; font-size: 18px;" id="layer-control-close">×</span></div>';
            
            // Close button handler
            header.querySelector('#layer-control-close').addEventListener('click', function() {
                panel.style.display = 'none';
            });
            
            // Reload button handler
            header.querySelector('#layer-control-reload').addEventListener('click', function() {
                console.log('[SplitScreen] Manual reload requested');
                self.populateLayerControl();
            });
            
            // Layer list container
            var layerList = document.createElement('div');
            layerList.id = 'splitscreen-layer-list';
            layerList.style.cssText = 'padding: 8px; overflow-y: auto; max-height: 340px; font-size: 12px;';
            layerList.innerHTML = '<div style="padding: 10px; color: #666; text-align: center;">Layer werden geladen...</div>';
            
            panel.appendChild(header);
            panel.appendChild(layerList);
            
            // Button toggle handler
            btn.addEventListener('click', function() {
                panel.style.display = (panel.style.display === 'none') ? 'flex' : 'none';
            });
            
            rightPanel.appendChild(btn);
            rightPanel.appendChild(panel);
            
            this.layerControlPanel = panel;
            this.layerControlButton = btn;
            
            // Layer-Liste wird nach Initialisierung von map2 gefüllt (siehe initializeMap2)
        },

        /**
         * Populate layer control with layers from map A
         */
        populateLayerControl: function() {
            var self = this;
            var layerList = document.getElementById('splitscreen-layer-list');
            if (!layerList) {
                console.error('[SplitScreen] Layer list element not found!');
                alert('Fehler: Layer-Liste-Element nicht gefunden!');
                return;
            }
            
            console.log('[SplitScreen] populateLayerControl called');
            layerList.innerHTML = '<div style="padding: 10px; color: #666; text-align: center;">Lade Layer...</div>';
            
            // Check if njs is available
            if (typeof njs === 'undefined') {
                console.error('[SplitScreen] njs is undefined!');
                layerList.innerHTML = '<div style="padding: 10px; color: #f00; text-align: center;">Fehler: njs nicht verfügbar</div>';
                return;
            }
            
            if (!njs.AppManager || !njs.AppManager.Maps || !njs.AppManager.Maps.main) {
                console.error('[SplitScreen] njs.AppManager.Maps.main not available!');
                layerList.innerHTML = '<div style="padding: 10px; color: #f00; text-align: center;">Fehler: AppManager nicht verfügbar</div>';
                return;
            }
            
            var mainMap = njs.AppManager.Maps.main.mapObj;
            if (!mainMap) {
                console.error('[SplitScreen] Main map not found!');
                layerList.innerHTML = '<div style="padding: 10px; color: #f00; text-align: center;">Fehler: Hauptkarte nicht gefunden</div>';
                return;
            }
            
            if (!this.map2) {
                console.error('[SplitScreen] Map2 not initialized!');
                layerList.innerHTML = '<div style="padding: 10px; color: #f00; text-align: center;">Fehler: Karte B nicht initialisiert</div>';
                return;
            }
            
            // Hole alle Layer direkt von Map A
            var layers = mainMap.getLayers().getArray();
            var map2Layers = this.map2.getLayers().getArray();
            
            console.log('[SplitScreen] ========================================');
            console.log('[SplitScreen] Populating layer control from Map A');
            console.log('[SplitScreen] Map A layers:', layers.length);
            console.log('[SplitScreen] Map B layers:', map2Layers.length);
            console.log('[SplitScreen] ========================================');
            
            layerList.innerHTML = '';
            var layerCount = 0;
            
            // Durchsuche ALLE Layer aus Map A
            layers.forEach(function(layer, index) {
                var layerName = layer.get('name') || layer.get('title') || 'Layer ' + index;
                
                console.log('[SplitScreen] Processing layer', index + ':', layerName);
                
                // Skip System-Layer UND Baselayer
                // Baselayer werden automatisch synchronisiert, müssen nicht im Panel sein
                var isBaseLayer = false;
                try {
                    var zIndex = layer.getZIndex();
                    if (zIndex !== undefined && zIndex <= 0) {
                        isBaseLayer = true;
                    }
                    if (layer.get('isBaseLayer') === true) {
                        isBaseLayer = true;
                    }
                    if (layerName.includes('base') || layerName.includes('background') ||
                        layerName.includes('fond') || layerName.includes('ortho') ||
                        layerName.includes('hintergrund') || layerName.includes('wmts') ||
                        layerName.includes('basemap')) {
                        isBaseLayer = true;
                    }
                } catch (e) {
                    // Ignore
                }
                
                if (isBaseLayer) {
                    console.log('[SplitScreen]   -> Skipping baselayer (auto-synced)');
                    return;
                }
                
                // Skip NUR echte System-Layer (cosmetic, graphic, highlight)
                // NICHT oereb - das sind echte Daten-Layer!
                if (layerName.toLowerCase().includes('cosmetic') || 
                    layerName.toLowerCase().includes('graphic') ||
                    layerName.toLowerCase().includes('highlight')) {
                    console.log('[SplitScreen]   -> Skipping system layer');
                    return;
                }
                
                // Finde entsprechenden Layer in Map B (by index)
                var map2Layer = map2Layers[index];
                
                if (!map2Layer) {
                    console.warn('[SplitScreen]   -> No map2 layer at index', index);
                    return;
                }
                
                var isVisible = map2Layer.getVisible();
                
                // Prüfe ob Layer eine echte Source hat
                var hasRealSource = false;
                var isToolLayer = false;
                try {
                    var source = map2Layer.getSource && map2Layer.getSource();
                    console.log('[SplitScreen]   -> Source type:', source ? source.constructor.name : 'no source');
                    
                    if (source) {
                        // Prüfe ob es ein Vector-Layer OHNE Features ist (Werkzeug-Layer)
                        if (source.constructor.name === 'Vector' || source.constructor.name.includes('Vector')) {
                            var features = source.getFeatures ? source.getFeatures() : [];
                            if (features.length === 0) {
                                isToolLayer = true;
                                hasRealSource = false;
                            } else {
                                // Vector mit Features ist OK
                                hasRealSource = true;
                            }
                        } else {
                            // Alle anderen Source-Typen (TileWMS, ImageWMS, XYZ, OSM, etc.) sind OK
                            hasRealSource = true;
                        }
                    }
                } catch (e) {
                    console.warn('[SplitScreen]   -> Error checking source:', e);
                }
                
                var canBeToggled = hasRealSource;
                
                // Create checkbox item
                var item = document.createElement('div');
                item.style.cssText = 'display: flex; align-items: center; padding: 6px; border-bottom: 1px solid #eee; cursor: pointer;' +
                    (canBeToggled ? '' : ' opacity: 0.5;');
                
                item.innerHTML = '<input type="checkbox" id="layer-cb-' + index + '" style="margin-right: 8px;" ' + 
                    (isVisible ? 'checked' : '') + 
                    (canBeToggled ? '' : ' disabled') +
                    '><label for="layer-cb-' + index + '" style="cursor: pointer; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">' + 
                    layerName + 
                    (isToolLayer ? ' (Werkzeug)' : '') + '</label>';
                
                var checkbox = item.querySelector('input');
                
                console.log('[SplitScreen]   -> Added to list - visible:', isVisible, 'toggleable:', canBeToggled, 'has map2Layer:', !!map2Layer);
                
                // Checkbox change handler - nur für togglebare Layer
                if (canBeToggled) {
                    (function(idx, lname, m2Layer) {
                        checkbox.addEventListener('change', function(e) {
                            console.log('[SplitScreen] Checkbox change event fired for:', lname, 'checked:', this.checked, 'has m2Layer:', !!m2Layer);
                            if (m2Layer) {
                                try {
                                    m2Layer.setVisible(this.checked);
                                    console.log('[SplitScreen] Layer "' + lname + '" (index ' + idx + ') in Karte B set to:', this.checked);
                                    console.log('[SplitScreen]   -> Layer type:', m2Layer.constructor.name);
                                    console.log('[SplitScreen]   -> Actual visible:', m2Layer.getVisible());
                                    console.log('[SplitScreen]   -> Opacity:', m2Layer.getOpacity());
                                    console.log('[SplitScreen]   -> zIndex:', m2Layer.getZIndex());
                                    console.log('[SplitScreen]   -> Source:', m2Layer.getSource());
                                    
                                    // Check if source has URL for WMS layers
                                    var src = m2Layer.getSource();
                                    if (src && src.getUrl) {
                                        console.log('[SplitScreen]   -> Source URL:', src.getUrl());
                                    }
                                    if (src && src.getParams) {
                                        console.log('[SplitScreen]   -> WMS Params:', src.getParams());
                                    }
                                    
                                    // Force map update
                                    if (self.map2) {
                                        self.map2.render();
                                        console.log('[SplitScreen]   -> Map2 rendered');
                                    }
                                } catch (err) {
                                    console.error('[SplitScreen] Error setting layer visibility:', err);
                                }
                            } else {
                                console.warn('[SplitScreen] Layer "' + lname + '" (index ' + idx + ') not found in map2');
                            }
                        });
                    })(index, layerName, map2Layer);
                    
                    // Click on item toggles checkbox
                    item.addEventListener('click', function(e) {
                        if (e.target !== checkbox) {
                            console.log('[SplitScreen] Item clicked, toggling checkbox');
                            checkbox.checked = !checkbox.checked;
                            var event = new Event('change', { bubbles: true });
                            checkbox.dispatchEvent(event);
                        }
                    });
                }
                
                layerList.appendChild(item);
                layerCount++;
            });
            
            console.log('[SplitScreen] ========================================');
            console.log('[SplitScreen] Layer control populated with', layerCount, 'layers');
            console.log('[SplitScreen] ========================================');
            
            // Debug: Log all map2 layers after population
            if (this.map2) {
                console.log('[SplitScreen] === Map2 Layer Summary ===');
                var map2Layers = this.map2.getLayers().getArray();
                map2Layers.forEach(function(lyr, idx) {
                    var name = lyr.get('name') || 'unnamed';
                    var visible = lyr.getVisible();
                    var opacity = lyr.getOpacity();
                    var zIndex = lyr.getZIndex();
                    console.log('[SplitScreen] Map2 Layer ' + idx + ': "' + name + '" visible:' + visible + ' opacity:' + opacity + ' zIndex:' + zIndex);
                });
                console.log('[SplitScreen] ===========================');
            }
            
            // Add info text if no layers
            if (layerCount === 0) {
                layerList.innerHTML = '<div style="padding: 10px; color: #999; text-align: center;">Keine Layer verfügbar<br><small>Klicken Sie auf ↻ um neu zu laden</small></div>';
            }
        },

        /**
         * Disable split-screen mode
         */
        disable: function() {
            if (!this.enabled) return;
            
            console.log('[SplitScreen] Disabling...');
            
            try {
                // Set flag immediately to prevent race conditions
                this.enabled = false;
                
                // Destroy layer catalog
                if (this.layerCatalog && this.layerCatalog.destroy) {
                    this.layerCatalog.destroy();
                    this.layerCatalog = null;
                    console.log('[SplitScreen] Layer catalog destroyed');
                }
                
                // Destroy second map FIRST (before removing DOM)
                if (this.map2) {
                    try {
                        // Clear all layers
                        var map2Layers = this.map2.getLayers().getArray().slice();
                        map2Layers.forEach(function(layer) {
                            this.map2.removeLayer(layer);
                        }, this);
                        
                        // Detach from DOM and dispose
                        this.map2.setTarget(null);
                        if (this.map2.dispose) {
                            this.map2.dispose();
                        }
                        this.map2 = null;
                        console.log('[SplitScreen] Map2 destroyed');
                    } catch (e) {
                        console.warn('[SplitScreen] Error destroying map2:', e);
                        this.map2 = null;
                    }
                }
                
                // Clear layer mapping
                this.layerMapping = {};
                this.basemapConfig = null;
                this.currentBasemapId = null;
                
                // Clean up View change listener
                if (this._viewChangeListenerKey) {
                    ol.Observable.unByKey(this._viewChangeListenerKey);
                    this._viewChangeListenerKey = null;
                }
                
                // Clean up time dimension sync listener
                if (this._timeDimensionHandler) {
                    document.removeEventListener('basemap-time-change', this._timeDimensionHandler);
                    this._timeDimensionHandler = null;
                    console.log('[SplitScreen] Time dimension sync listener removed');
                }
                
                // Restore original changeBaseMap if hooked
                try {
                    var mainMapInstance = njs.AppManager.Maps.main;
                    if (mainMapInstance && mainMapInstance._originalChangeBaseMap) {
                        mainMapInstance.changeBaseMap = mainMapInstance._originalChangeBaseMap;
                        delete mainMapInstance._originalChangeBaseMap;
                        console.log('[SplitScreen] changeBaseMap hook removed');
                    }
                } catch (e) {
                    console.warn('[SplitScreen] Error removing changeBaseMap hook:', e);
                }
                
                // Get DOM elements
                var mapContainer = document.getElementById('mapContainer');
                var splitWrapper = document.getElementById('split-wrapper');
                var originalMap = document.getElementById('map');
                
                if (splitWrapper && mapContainer && originalMap) {
                    // Extract original map from split structure
                    if (originalMap.parentNode && originalMap.parentNode !== mapContainer) {
                        mapContainer.appendChild(originalMap);
                        console.log('[SplitScreen] Original map restored to container');
                    }
                    
                    // Remove split wrapper completely
                    if (splitWrapper.parentNode) {
                        splitWrapper.parentNode.removeChild(splitWrapper);
                        console.log('[SplitScreen] Split wrapper removed');
                    }
                    
                    // Force map size update
                    setTimeout(function() {
                        if (njs.AppManager.Maps.main && njs.AppManager.Maps.main.mapObj) {
                            njs.AppManager.Maps.main.mapObj.updateSize();
                            console.log('[SplitScreen] Main map size updated');
                        }
                    }, 100);
                    
                    console.log('[SplitScreen] Disabled successfully');
                } else {
                    console.warn('[SplitScreen] DOM elements not found for cleanup');
                }
            } catch (e) {
                console.error('[SplitScreen] Error during disable:', e);
            }
        },

        /**
         * Add a layer to both maps
         * @param {ol.layer.Layer} layer - The layer to add
         * @returns {ol.layer.Layer|null} - The cloned layer added to map2, or null if not in splitscreen mode
         */
        addLayerToMaps: function(layer) {
            if (!layer) {
                console.warn('[SplitScreen] No layer provided');
                return null;
            }
            
            var mainMap = njs.AppManager.Maps.main.mapObj;
            if (!mainMap) {
                console.warn('[SplitScreen] Main map not available');
                return null;
            }
            
            // Add to main map
            // try/catch: njs.MapTip.addLayerCallback kann bei Custom-WMS-Layern
            // crashen, der Layer wird trotzdem zur OL-Collection hinzugefügt.
            try {
                mainMap.addLayer(layer);
            } catch(e) {
                console.warn('[SplitScreen] addLayer Framework-Fehler abgefangen:', e.message);
            }
            console.log('[SplitScreen] Layer added to Map A:', layer.get('name') || 'unnamed');
            
            // Clone and add to map B if splitscreen is active
            if (this.enabled && this.map2) {
                var clonedLayer = this.cloneLayer(layer);
                if (clonedLayer) {
                    this.map2.addLayer(clonedLayer);
                    var layerName = layer.get('name') || layer.get('title') || 'unnamed';
                    this.layerMapping[layerName] = clonedLayer;
                    console.log('[SplitScreen] Layer cloned and added to Map B:', layerName);
                    
                    // Update layer control panel
                    setTimeout(function() {
                        if (window.TnetSplitScreen) {
                            window.TnetSplitScreen.populateLayerControl();
                        }
                    }, 100);
                    
                    return clonedLayer;
                }
            } else if (!this.enabled) {
                console.log('[SplitScreen] Splitscreen not active - layer only added to Map A');
            }
            
            return null;
        },

        /**
         * Toggle split-screen mode
         */
        toggle: function() {
            var btn = document.getElementById('split-screen-btn');
            
            if (this.enabled) {
                this.disable();
                if (btn) btn.classList.remove('active');
            } else {
                this.init();
                if (btn) btn.classList.add('active');
            }
        },

        /**
         * Setup maptips (click info) for map2
         */
        setupMap2Maptips: function() {
            var self = this;
            
            // Wait for map2 to be ready
            var checkMap2 = setInterval(function() {
                if (self.map2) {
                    clearInterval(checkMap2);
                    
                    console.log('[SplitScreen] Setting up native OpenLayers maptips for map2...');
                    
                    // Create popup overlay
                    var popupContainer = document.createElement('div');
                    popupContainer.id = 'map2-popup';
                    popupContainer.className = 'ol-popup';
                    popupContainer.style.cssText = 'position: absolute; background: white; padding: 10px; border: 1px solid #ccc; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.3); min-width: 200px; max-width: 400px; max-height: 300px; overflow: auto;';
                    
                    var popupCloser = document.createElement('a');
                    popupCloser.href = '#';
                    popupCloser.className = 'ol-popup-closer';
                    popupCloser.style.cssText = 'position: absolute; top: 5px; right: 5px; text-decoration: none; color: #999; font-size: 18px; font-weight: bold;';
                    popupCloser.innerHTML = '×';
                    
                    var popupContent = document.createElement('div');
                    popupContent.id = 'map2-popup-content';
                    
                    popupContainer.appendChild(popupCloser);
                    popupContainer.appendChild(popupContent);
                    document.body.appendChild(popupContainer);
                    
                    var overlay = new ol.Overlay({
                        element: popupContainer,
                        autoPan: true,
                        autoPanAnimation: {
                            duration: 250
                        }
                    });
                    
                    self.map2.addOverlay(overlay);
                    
                    // Close popup handler
                    popupCloser.onclick = function() {
                        overlay.setPosition(undefined);
                        popupCloser.blur();
                        return false;
                    };
                    
                    // Add click listener to map2
                    self.map2.on('singleclick', function(evt) {
                        var coordinate = evt.coordinate;
                        var pixel = evt.pixel;
                        
                        console.log('[SplitScreen] Map2 clicked at coordinate:', coordinate, 'pixel:', pixel);
                        
                        // Independent maptip implementation for map2
                        var features = [];
                        var requests = [];
                        var layersChecked = 0;
                        var viewResolution = self.map2.getView().getResolution();
                        var projection = self.map2.getView().getProjection();
                        
                        // Query all visible layers (skip LayerGroups/basemaps)
                        self.map2.getLayers().forEach(function(layer) {
                            if (!layer.getVisible()) {
                                return;
                            }
                            
                            // Skip LayerGroups (basemaps) and layers without getSource
                            if (layer instanceof ol.layer.Group) {
                                return;
                            }
                            if (typeof layer.getSource !== 'function') {
                                return;
                            }
                            
                            layersChecked++;
                            var source = layer.getSource();
                            if (!source) return;
                            
                            var layerTitle = layer.get('title') || layer.get('name') || layer.get('catalogId') || 'Unknown';
                            
                            console.log('[SplitScreen] Querying layer:', layerTitle);
                            console.log('[SplitScreen] - source:', source);
                            console.log('[SplitScreen] - source type:', source ? source.constructor.name : 'null');
                            console.log('[SplitScreen] - has getUrl:', source && typeof source.getUrl === 'function');
                            console.log('[SplitScreen] - has getFeatureInfoUrl:', source && typeof source.getFeatureInfoUrl === 'function');
                            
                            // ArcGIS REST identify (Image and Tile)
                            // Detect ArcGIS sources: ImageArcGISRest or TileArcGISRest
                            var isArcGIS = (source instanceof ol.source.ImageArcGISRest) ||
                                           (source instanceof ol.source.TileArcGISRest) ||
                                           (typeof source.getUrl === 'function' && 
                                            source.constructor && source.constructor.name && 
                                            source.constructor.name.indexOf('ArcGISRest') > -1);
                            
                            if (isArcGIS && typeof source.getUrl === 'function') {
                                
                                try {
                                    var url = source.getUrl();
                                    var params = source.getParams ? source.getParams() : {};
                                    var mapExtent = self.map2.getView().calculateExtent(self.map2.getSize());
                                    var layerIds = params.LAYERS || params.layers || '0';
                                    
                                    // Build identify URL - handle agsproxy.php URLs
                                    var identifyUrl;
                                    if (url.indexOf('agsproxy.php') > -1) {
                                        // Proxy URL: /maps/agsproxy.php?path=.../MapServer
                                        // Append /identify to the path parameter, use & for rest
                                        identifyUrl = url.replace(/\/MapServer\/?/, '/MapServer/identify') +
                                            '&f=json' +
                                            '&geometry=' + coordinate[0] + ',' + coordinate[1] +
                                            '&geometryType=esriGeometryPoint' +
                                            '&sr=' + projection.getCode().split(':')[1] +
                                            '&layers=all:' + layerIds.replace(/^show:/, '') +
                                            '&tolerance=5' +
                                            '&mapExtent=' + mapExtent.join(',') +
                                            '&imageDisplay=' + self.map2.getSize().join(',') + ',96' +
                                            '&returnGeometry=false';
                                    } else {
                                        // Direct ArcGIS URL
                                        identifyUrl = url.replace(/\/export\/?$/, '') + '/identify' + 
                                            '?f=json' +
                                            '&geometry=' + coordinate[0] + ',' + coordinate[1] +
                                            '&geometryType=esriGeometryPoint' +
                                            '&sr=' + projection.getCode().split(':')[1] +
                                            '&layers=all:' + layerIds.replace(/^show:/, '') +
                                            '&tolerance=5' +
                                            '&mapExtent=' + mapExtent.join(',') +
                                            '&imageDisplay=' + self.map2.getSize().join(',') + ',96' +
                                            '&returnGeometry=false';
                                    }
                                    
                                    console.log('[SplitScreen] ArcGIS identify URL:', identifyUrl);
                                    
                                    requests.push(
                                        fetch(identifyUrl)
                                            .then(function(response) { return response.json(); })
                                            .then(function(data) {
                                                console.log('[SplitScreen] ArcGIS response:', data);
                                                if (data.results && data.results.length > 0) {
                                                    var feats = data.results.map(function(r) {
                                                        return { properties: r.attributes };
                                                    });
                                                    features.push({
                                                        layer: layerTitle,
                                                        data: feats
                                                    });
                                                }
                                            })
                                            .catch(function(err) {
                                                console.warn('[SplitScreen] ArcGIS error:', err);
                                            })
                                    );
                                } catch(e) {
                                    console.warn('[SplitScreen] Error building ArcGIS query:', e);
                                }
                            }
                            
                            // WMS GetFeatureInfo - try multiple formats
                            else if (source && typeof source.getFeatureInfoUrl === 'function') {
                                (function(layerTitle) {
                                    var formats = [
                                        'application/json',
                                        'application/geojson', 
                                        'text/html',
                                        'application/vnd.ogc.gml',
                                        'text/plain'
                                    ];
                                    
                                    var tryFormat = function(formatIndex) {
                                        if (formatIndex >= formats.length) {
                                            console.warn('[SplitScreen] All WMS formats failed for', layerTitle);
                                            return Promise.resolve();
                                        }
                                        
                                        var format = formats[formatIndex];
                                        var url = source.getFeatureInfoUrl(
                                            coordinate,
                                            viewResolution,
                                            projection,
                                            {'INFO_FORMAT': format, 'FEATURE_COUNT': 10}
                                        );
                                        
                                        if (!url) return Promise.resolve();
                                        
                                        // Add QUERY_LAYERS if not already present (ImageWMS adds it automatically)
                                        if (url.indexOf('QUERY_LAYERS') === -1) {
                                            var params = source.getParams();
                                            if (params && params.LAYERS) {
                                                url += '&QUERY_LAYERS=' + encodeURIComponent(params.LAYERS);
                                            } else if (url.indexOf('layers=') > -1) {
                                                // Extract layers from URL and add as QUERY_LAYERS
                                                var layersMatch = url.match(/layers=([^&]+)/i);
                                                if (layersMatch) {
                                                    url += '&QUERY_LAYERS=' + layersMatch[1];
                                                }
                                            }
                                        }
                                        
                                        console.log('[SplitScreen] WMS trying format', format, 'for', layerTitle);
                                        console.log('[SplitScreen] WMS URL:', url);
                                        
                                        return fetch(url)
                                            .then(function(response) { return response.text(); })
                                            .then(function(text) {
                                                console.log('[SplitScreen] WMS response for format', format, '- length:', text.length, '- preview:', text.substring(0, 300));
                                                
                                                // Check for ServiceException
                                                if (text.indexOf('ServiceExceptionReport') > -1 || text.indexOf('ServiceException') > -1) {
                                                    // Parse exception message
                                                    var parser = new DOMParser();
                                                    var xmlDoc = parser.parseFromString(text, 'text/xml');
                                                    var exceptionNodes = xmlDoc.getElementsByTagName('ServiceException');
                                                    var exceptionMsg = '';
                                                    if (exceptionNodes.length > 0) {
                                                        for (var i = 0; i < exceptionNodes.length; i++) {
                                                            exceptionMsg += exceptionNodes[i].textContent + ' ';
                                                        }
                                                    } else {
                                                        exceptionMsg = 'Unknown error - full response: ' + text.substring(0, 500);
                                                    }
                                                    console.error('[SplitScreen] WMS ServiceException for format', format);
                                                    console.error('[SplitScreen] Exception message:', exceptionMsg);
                                                    console.error('[SplitScreen] Failed URL:', url);
                                                    return tryFormat(formatIndex + 1);
                                                }
                                                
                                                // Try text/plain format (simple text output)
                                                if (format === 'text/plain' && text.length > 0 && text.indexOf('<?xml') !== 0) {
                                                    console.log('[SplitScreen] text/plain response:', text);
                                                    // Parse simple text response (key = 'value' format from MapServer)
                                                    var attrs = {};
                                                    var lines = text.split('\n');
                                                    for (var i = 0; i < lines.length; i++) {
                                                        var line = lines[i].trim();
                                                        // Match: key = 'value' or key = value
                                                        if (line && line.indexOf('=') > -1 && !line.match(/^(Layer|Feature|GetFeatureInfo)/)) {
                                                            var parts = line.split('=');
                                                            var key = parts[0].trim();
                                                            var value = parts.slice(1).join('=').trim();
                                                            // Remove quotes
                                                            value = value.replace(/^'|'$/g, '').replace(/^"|"$/g, '');
                                                            if (key && value) {
                                                                attrs[key] = value;
                                                            }
                                                        }
                                                    }
                                                    if (Object.keys(attrs).length > 0) {
                                                        console.log('[SplitScreen] text/plain parsed attributes:', attrs);
                                                        features.push({ layer: layerTitle, data: [{ properties: attrs }] });
                                                        console.log('[SplitScreen] WMS text/plain success for', layerTitle, 'with', Object.keys(attrs).length, 'attributes');
                                                        return;
                                                    }
                                                }
                                                
                                                // Try JSON
                                                if (format.indexOf('json') > -1) {
                                                    try {
                                                        var data = JSON.parse(text);
                                                        if (data.features && data.features.length > 0) {
                                                            var normalized = data.features.map(function(f) {
                                                                return { properties: f.properties || f.attributes || {} };
                                                            });
                                                            features.push({ layer: layerTitle, data: normalized });
                                                            console.log('[SplitScreen] WMS JSON success for', layerTitle, ':', normalized.length, 'features');
                                                            return;
                                                        }
                                                    } catch(e) {}
                                                }
                                                
                                                // Try HTML (extract table data)
                                                if (format.indexOf('html') > -1 && text.indexOf('<table') > -1) {
                                                    var tempDiv = document.createElement('div');
                                                    tempDiv.innerHTML = text;
                                                    var tables = tempDiv.getElementsByTagName('table');
                                                    if (tables.length > 0) {
                                                        var attrs = {};
                                                        var rows = tables[0].getElementsByTagName('tr');
                                                        for (var i = 0; i < rows.length; i++) {
                                                            var cells = rows[i].getElementsByTagName('td');
                                                            if (cells.length >= 2) {
                                                                attrs[cells[0].textContent.trim()] = cells[1].textContent.trim();
                                                            }
                                                        }
                                                        if (Object.keys(attrs).length > 0) {
                                                            features.push({ layer: layerTitle, data: [{ properties: attrs }] });
                                                            console.log('[SplitScreen] WMS HTML success for', layerTitle);
                                                            return;
                                                        }
                                                    }
                                                }
                                                
                                                // Try GML/XML
                                                if (text.indexOf('<?xml') === 0 || text.indexOf('<') === 0) {
                                                    var parser = new DOMParser();
                                                    var xmlDoc = parser.parseFromString(text, 'text/xml');
                                                    var featureMembers = xmlDoc.getElementsByTagName('gml:featureMember');
                                                    
                                                    if (featureMembers.length > 0) {
                                                        var xmlFeatures = [];
                                                        for (var i = 0; i < featureMembers.length; i++) {
                                                            var attrs = {};
                                                            var featureNode = featureMembers[i].children[0];
                                                            if (featureNode) {
                                                                for (var j = 0; j < featureNode.children.length; j++) {
                                                                    var child = featureNode.children[j];
                                                                    var tagName = child.localName || child.tagName;
                                                                    if (child.textContent && tagName !== 'boundedBy') {
                                                                        attrs[tagName] = child.textContent;
                                                                    }
                                                                }
                                                            }
                                                            if (Object.keys(attrs).length > 0) {
                                                                xmlFeatures.push({ properties: attrs });
                                                            }
                                                        }
                                                        
                                                        if (xmlFeatures.length > 0) {
                                                            features.push({ layer: layerTitle, data: xmlFeatures });
                                                            console.log('[SplitScreen] WMS GML success for', layerTitle, ':', xmlFeatures.length, 'features');
                                                            return;
                                                        }
                                                    }
                                                }
                                                
                                                // Try next format
                                                return tryFormat(formatIndex + 1);
                                            })
                                            .catch(function(err) {
                                                console.warn('[SplitScreen] WMS fetch error for format', format, ':', err);
                                                return tryFormat(formatIndex + 1);
                                            });
                                    };
                                    
                                    requests.push(tryFormat(0));
                                })(layerTitle);
                            }
                        });
                        
                        console.log('[SplitScreen] Layers checked:', layersChecked, 'Requests:', requests.length);
                        
                        // Wait for all requests and show popup
                        if (requests.length > 0) {
                            Promise.all(requests).then(function() {
                                if (features.length > 0) {
                                    console.log('[SplitScreen] Total features from', features.length, 'layers');
                                    
                                    // Accordion-Style HTML mit klappbaren Layer-Ergebnissen
                                    var html = '<div style="font-family: Arial, sans-serif;">';
                                    html += '<div style="font-size: 13px; font-weight: bold; margin-bottom: 10px; padding-bottom: 5px; border-bottom: 2px solid #2c5f6f; color: #2c5f6f;">Objekt-Informationen (' + features.length + ' Layer)</div>';
                                    
                                    features.forEach(function(item, idx) {
                                        var accordionId = 'accordion-' + idx;
                                        var isFirstItem = idx === 0;
                                        
                                        // Accordion Header (klappbar)
                                        html += '<div style="margin-bottom: 8px; border: 1px solid #ddd; border-radius: 4px; overflow: hidden;">';
                                        html += '<div onclick="var content = document.getElementById(\'' + accordionId + '\'); var icon = this.querySelector(\'.accordion-icon\'); if(content.style.display === \'none\'){content.style.display = \'block\'; icon.innerHTML = \'▼\';}else{content.style.display = \'none\'; icon.innerHTML = \'►\';}" ';
                                        html += 'style="background: #f5f5f5; padding: 8px 12px; cursor: pointer; font-weight: bold; font-size: 12px; color: #333; display: flex; justify-content: space-between; align-items: center; user-select: none;">';
                                        html += '<span>' + item.layer + ' (' + item.data.length + ')</span>';
                                        html += '<span class="accordion-icon" style="color: #2c5f6f; font-size: 10px;">' + (isFirstItem ? '▼' : '►') + '</span>';
                                        html += '</div>';
                                        
                                        // Accordion Content (anfangs nur erstes Item offen)
                                        html += '<div id="' + accordionId + '" style="display: ' + (isFirstItem ? 'block' : 'none') + '; padding: 10px; background: white;">';
                                        
                                        item.data.forEach(function(feature, featIdx) {
                                            if (featIdx > 0) {
                                                html += '<hr style="margin: 10px 0; border: none; border-top: 1px solid #eee;">';
                                            }
                                            
                                            var props = feature.properties || feature.attributes || {};
                                            html += '<table style="font-size: 11px; width: 100%; border-collapse: collapse;">';
                                            for (var key in props) {
                                                if (props.hasOwnProperty(key) && key !== 'geometry' && props[key]) {
                                                    html += '<tr>';
                                                    html += '<td style="padding: 3px 8px 3px 0; font-weight: 600; color: #555; vertical-align: top; width: 40%;">' + key + ':</td>';
                                                    html += '<td style="padding: 3px 0; color: #333; vertical-align: top;">' + props[key] + '</td>';
                                                    html += '</tr>';
                                                }
                                            }
                                            html += '</table>';
                                        });
                                        
                                        html += '</div>'; // Close accordion content
                                        html += '</div>'; // Close accordion item
                                    });
                                    
                                    html += '</div>';
                                    
                                    popupContent.innerHTML = html;
                                    overlay.setPosition(coordinate);
                                } else {
                                    console.log('[SplitScreen] No features found');
                                    popupContent.innerHTML = '<div style="padding: 10px; color: #999; text-align: center;">Keine Informationen gefunden</div>';
                                    overlay.setPosition(coordinate);
                                }
                            });
                        } else {
                            console.log('[SplitScreen] No queryable layers visible');
                        }
                    });
                    
                    console.log('[SplitScreen] Native maptips enabled for map2');
                }
            }, 100);
        }
    };

    // Export to global scope
    window.TnetSplitScreen = SplitScreen;
    
    // Export global toggle function
    window.toggleSplitScreen = function() {
        if (window.TnetSplitScreen) {
            window.TnetSplitScreen.toggle();
        } else {
            console.error('[SplitScreen] Module not loaded');
        }
    };
})();

/**
 * Global function to add a WMS layer to both maps
 * @param {string} wmsUrl - WMS server URL
 * @param {string} layerName - Layer name (LAYERS parameter)
 * @param {string} title - Display title for the layer (optional)
 * @param {object} params - Additional WMS parameters (optional)
 * @returns {ol.layer.Image|null}
 * 
 * Example usage:
 * addWmsLayer('http://wms.server.com/wms', 'my_layer', 'My Layer Title');
 * addWmsLayer('http://wms.server.com/wms', 'layer1', 'Layer 1', {
 *     'FORMAT': 'image/png',
 *     'TRANSPARENT': true
 * });
 */
function addWmsLayer(wmsUrl, layerName, title, params) {
    if (!wmsUrl || !layerName) {
        console.error('[SplitScreen] addWmsLayer requires wmsUrl and layerName');
        return null;
    }
    
    var wmsParams = Object.assign({
        'LAYERS': layerName,
        'FORMAT': 'image/png',
        'TRANSPARENT': true
    }, params || {});
    
    var layer = new ol.layer.Image({
        source: new ol.source.ImageWMS({
            url: wmsUrl,
            params: wmsParams,
            serverType: 'geoserver',
            crossOrigin: 'anonymous'
        }),
        opacity: 0.8,
        visible: true
    });
    
    // Set title/name
    if (title) {
        layer.set('title', title);
        layer.set('name', title);
    } else {
        layer.set('name', layerName);
    }
    
    // Add through SplitScreen manager
    if (window.TnetSplitScreen) {
        return window.TnetSplitScreen.addLayerToMaps(layer);
    } else {
        console.error('[SplitScreen] Module not loaded');
        return null;
    }
}

/**
 * Global function to add a TileWMS layer to both maps
 * @param {string} wmsUrl - WMS server URL
 * @param {string} layerName - Layer name (LAYERS parameter)
 * @param {string} title - Display title for the layer (optional)
 * @param {object} params - Additional WMS parameters (optional)
 * @returns {ol.layer.Tile|null}
 * 
 * Example usage:
 * addTileWmsLayer('http://wms.server.com/wms', 'my_layer', 'My Layer Title');
 */
function addTileWmsLayer(wmsUrl, layerName, title, params) {
    if (!wmsUrl || !layerName) {
        console.error('[SplitScreen] addTileWmsLayer requires wmsUrl and layerName');
        return null;
    }
    
    var wmsParams = Object.assign({
        'LAYERS': layerName,
        'FORMAT': 'image/png',
        'TRANSPARENT': true
    }, params || {});
    
    var layer = new ol.layer.Tile({
        source: new ol.source.TileWMS({
            url: wmsUrl,
            params: wmsParams,
            serverType: 'geoserver',
            crossOrigin: 'anonymous'
        }),
        opacity: 0.8,
        visible: true
    });
    
    // Set title/name
    if (title) {
        layer.set('title', title);
        layer.set('name', title);
    } else {
        layer.set('name', layerName);
    }
    
    // Add through SplitScreen manager
    if (window.TnetSplitScreen) {
        return window.TnetSplitScreen.addLayerToMaps(layer);
    } else {
        console.error('[SplitScreen] Module not loaded');
        return null;
    }
}

/**
 * Global function to add a custom layer to both maps
 * @param {ol.layer.Layer} layer - The OpenLayers layer to add
 * @returns {ol.layer.Layer|null} - The cloned layer in map2
 * 
 * Example usage:
 * const myLayer = new ol.layer.Vector({ ... });
 * addCustomLayer(myLayer);
 */
function addCustomLayer(layer) {
    if (window.TnetSplitScreen) {
        return window.TnetSplitScreen.addLayerToMaps(layer);
    } else {
        console.error('[SplitScreen] Module not loaded');
        return null;
    }
}
