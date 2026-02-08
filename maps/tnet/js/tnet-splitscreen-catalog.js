/**
 * Split-Screen Layer Catalog Integration
 * Erweitert tnet-splitscreen.js um hierarchischen Layer-Katalog
 */

(function() {
    'use strict';
    
    // Warte bis SplitScreen verfügbar ist
    function initCatalog() {
        if (typeof window.TnetSplitScreen === 'undefined') {
            setTimeout(initCatalog, 100);
            return;
        }
        
        console.log('[SplitScreenCatalog] Extending TnetSplitScreen with catalog functionality');
        
        // Überschreibe populateLayerControl
        window.TnetSplitScreen.populateLayerControl = function() {
            var self = this;
            
            console.log('[SplitScreen] Populating layer control using PHP service...');
            
            var layerList = document.getElementById('splitscreen-layer-list');
            if (!layerList) {
                console.error('[SplitScreen] Layer list element not found');
                return;
            }
            
            // Clear existing content
            layerList.innerHTML = '<div style="padding: 10px; text-align: center; color: #999;">Lade Katalog...</div>';
            
            // Load catalog data from PHP service
            fetch('tnet/php/lyrmgr-to-json.php')
                .then(function(response) {
                    if (!response.ok) {
                        throw new Error('HTTP ' + response.status);
                    }
                    return response.json();
                })
                .then(function(data) {
                    console.log('[SplitScreen] Catalog data loaded:', data);
                    self.renderCatalogHierarchy(data, layerList);
                })
                .catch(function(error) {
                    console.error('[SplitScreen] Error loading catalog:', error);
                    layerList.innerHTML = '<div style="padding: 10px; text-align: center; color: #f00;">Fehler beim Laden: ' + error.message + '</div>';
                });
        };
        
        // Neue Methode: Hierarchie rendern
        window.TnetSplitScreen.renderCatalogHierarchy = function(data, container) {
            var self = this;
            
            container.innerHTML = '';
            
            if (!data.categories || data.categories.length === 0) {
                container.innerHTML = '<div style="padding: 10px; color: #999; text-align: center;">Keine Kategorien gefunden</div>';
                return;
            }
            
            console.log('[SplitScreen] Rendering', data.categories.length, 'top-level categories');
            
            // Render each top-level category (Nidwalden, Obwalden, Bund, Weitere)
            data.categories.forEach(function(topCategory) {
                var topCatEl = self.createTopCategoryElement(topCategory);
                container.appendChild(topCatEl);
            });
        };
        
        // Top-Level Category (Nidwalden, Obwalden, etc.)
        window.TnetSplitScreen.createTopCategoryElement = function(topCategory) {
            var self = this;
            var container = document.createElement('div');
            container.style.cssText = 'margin-bottom: 6px;';
            
            var header = document.createElement('div');
            header.style.cssText = 'padding: 7px; background: #2c5f6f; color: white; font-weight: 600; cursor: pointer; border-radius: 3px; display: flex; align-items: center; font-size: 11px;';
            header.innerHTML = '<span style="margin-right: 6px; font-size: 9px;">▶</span>' + topCategory.name;
            
            var content = document.createElement('div');
            content.style.cssText = 'display: none; padding-left: 6px; margin-top: 3px;';
            
            if (topCategory.subcategories && topCategory.subcategories.length > 0) {
                topCategory.subcategories.forEach(function(subcategory) {
                    var subcatEl = self.createSubcategoryElement(subcategory);
                    content.appendChild(subcatEl);
                });
            }
            
            var isOpen = false;
            header.addEventListener('click', function() {
                isOpen = !isOpen;
                content.style.display = isOpen ? 'block' : 'none';
                header.querySelector('span').textContent = isOpen ? '▼' : '▶';
            });
            
            container.appendChild(header);
            container.appendChild(content);
            
            return container;
        };
        
        // Subcategory (Grundlagen, ÖREB, etc.)
        window.TnetSplitScreen.createSubcategoryElement = function(subcategory) {
            var self = this;
            var container = document.createElement('div');
            container.style.cssText = 'margin-bottom: 5px;';
            
            var header = document.createElement('div');
            header.style.cssText = 'padding: 5px 6px; background: #e8f4f8; font-weight: 500; cursor: pointer; border-radius: 2px; display: flex; align-items: center; font-size: 10px;';
            header.innerHTML = '<span style="margin-right: 5px; font-size: 8px;">▶</span>' + subcategory.name;
            
            var content = document.createElement('div');
            content.style.cssText = 'display: none; padding-left: 6px; margin-top: 2px;';
            
            if (subcategory.groups && subcategory.groups.length > 0) {
                subcategory.groups.forEach(function(group) {
                    var groupEl = self.createGroupElement(group);
                    content.appendChild(groupEl);
                });
            }
            
            var isOpen = false;
            header.addEventListener('click', function() {
                isOpen = !isOpen;
                content.style.display = isOpen ? 'block' : 'none';
                header.querySelector('span').textContent = isOpen ? '▼' : '▶';
            });
            
            container.appendChild(header);
            container.appendChild(content);
            
            return container;
        };
        
        // Group Element
        window.TnetSplitScreen.createGroupElement = function(group) {
            var self = this;
            var container = document.createElement('div');
            container.style.cssText = 'margin-bottom: 4px;';
            
            var header = document.createElement('div');
            header.style.cssText = 'padding: 4px 5px; background: #f5f5f5; cursor: pointer; border-radius: 2px; display: flex; align-items: center; font-size: 10px; color: #333;';
            header.innerHTML = '<span style="margin-right: 4px; font-size: 7px;">▶</span>' + group.name;
            
            var content = document.createElement('div');
            content.style.cssText = 'display: none; padding-left: 6px; margin-top: 2px;';
            
            if (group.layers && group.layers.length > 0) {
                group.layers.forEach(function(layer) {
                    var layerEl = self.createLayerElementFromCatalog(layer);
                    content.appendChild(layerEl);
                });
            }
            
            var isOpen = group.open || false;
            if (isOpen) {
                content.style.display = 'block';
                header.querySelector('span').textContent = '▼';
            }
            
            header.addEventListener('click', function() {
                isOpen = !isOpen;
                content.style.display = isOpen ? 'block' : 'none';
                header.querySelector('span').textContent = isOpen ? '▼' : '▶';
            });
            
            container.appendChild(header);
            container.appendChild(content);
            
            return container;
        };
        
        // Layer Element
        window.TnetSplitScreen.createLayerElementFromCatalog = function(layer) {
            var self = this;
            
            // Check if nested group
            if (layer.type === 'group' && layer.layers) {
                var nestedGroup = document.createElement('div');
                nestedGroup.style.cssText = 'margin-bottom: 3px;';
                
                var nestedHeader = document.createElement('div');
                nestedHeader.style.cssText = 'padding: 3px 4px; background: #fafafa; cursor: pointer; border-radius: 2px; display: flex; align-items: center; font-size: 9px;';
                nestedHeader.innerHTML = '<span style="margin-right: 3px; font-size: 7px;">▶</span>' + layer.name;
                
                var nestedContent = document.createElement('div');
                nestedContent.style.cssText = 'display: none; padding-left: 6px; margin-top: 1px;';
                
                layer.layers.forEach(function(subLayer) {
                    var subLayerEl = self.createLayerElementFromCatalog(subLayer);
                    nestedContent.appendChild(subLayerEl);
                });
                
                var isOpen = layer.open || false;
                if (isOpen) {
                    nestedContent.style.display = 'block';
                    nestedHeader.querySelector('span').textContent = '▼';
                }
                
                nestedHeader.addEventListener('click', function() {
                    isOpen = !isOpen;
                    nestedContent.style.display = isOpen ? 'block' : 'none';
                    nestedHeader.querySelector('span').textContent = isOpen ? '▼' : '▶';
                });
                
                nestedGroup.appendChild(nestedHeader);
                nestedGroup.appendChild(nestedContent);
                
                return nestedGroup;
            }
            
            // It's a layer - create checkbox item
            var item = document.createElement('div');
            item.style.cssText = 'padding: 3px 4px; margin: 1px 0; cursor: pointer; border-radius: 2px; display: flex; align-items: center; font-size: 9px; background: #fff;';
            item.setAttribute('data-layer-id', layer.id);
            
            var checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.style.cssText = 'margin-right: 5px; cursor: pointer;';
            checkbox.checked = false; // Immer false beim Rendern - der tatsächliche Status wird beim Click geprüft
            
            var label = document.createElement('span');
            label.textContent = layer.name;
            label.style.cssText = 'flex: 1;';
            
            item.appendChild(checkbox);
            item.appendChild(label);
            
            // Add event handler to load/toggle layer directly from catalog definition
            checkbox.addEventListener('change', function() {
                var isChecked = this.checked;
                console.log('[SplitScreenCatalog] Layer checkbox changed:', layer.id, 'checked:', isChecked);
                
                if (isChecked) {
                    // Erst ALLE Layer mit dieser ID entfernen
                    if (self.map2) {
                        var layersToRemove = [];
                        self.map2.getLayers().forEach(function(mapLayer) {
                            var catalogId = mapLayer.get('catalogId');
                            if (catalogId === layer.id) {
                                layersToRemove.push(mapLayer);
                            }
                        });
                        
                        console.log('[SplitScreenCatalog] Removing', layersToRemove.length, 'old instances of', layer.id);
                        layersToRemove.forEach(function(oldLayer) {
                            self.map2.removeLayer(oldLayer);
                        });
                    }
                    
                    // Dann neu erstellen
                    console.log('[SplitScreenCatalog] Creating new layer:', layer.id);
                    if (layer.url) {
                        self.createLayerFromDefinition(layer);
                    } else {
                        self.addLayerToMap2(layer.id, true);
                    }
                } else {
                    // Alle Layer mit dieser ID entfernen
                    if (self.map2) {
                        var layersToRemove = [];
                        self.map2.getLayers().forEach(function(mapLayer) {
                            var catalogId = mapLayer.get('catalogId');
                            if (catalogId === layer.id) {
                                layersToRemove.push(mapLayer);
                            }
                        });
                        
                        console.log('[SplitScreenCatalog] Removing', layersToRemove.length, 'instances of', layer.id);
                        layersToRemove.forEach(function(oldLayer) {
                            self.map2.removeLayer(oldLayer);
                        });
                        
                        self.map2.render();
                    }
                }
            });
            
            item.addEventListener('click', function(e) {
                if (e.target !== checkbox) {
                    checkbox.checked = !checkbox.checked;
                    checkbox.dispatchEvent(new Event('change'));
                }
            });
            
            // Hover effect
            item.addEventListener('mouseenter', function() {
                this.style.background = '#e8f4f8';
            });
            item.addEventListener('mouseleave', function() {
                this.style.background = '#fff';
            });
            
            return item;
        };
        
        // Create layer directly from catalog definition (without loading in main map)
        window.TnetSplitScreen.createLayerFromDefinition = function(layerDef) {
            if (!this.map2) {
                console.warn('[SplitScreenCatalog] map2 not available');
                return;
            }
            
            console.log('[SplitScreenCatalog] Creating layer from definition:', layerDef);
            
            try {
                var layer = null;
                var source = null;
                
                // Normalize WMS params to uppercase (OGC standard)
                var normalizedParams = {};
                if (layerDef.params) {
                    var paramMap = {
                        'layers': 'LAYERS', 'format': 'FORMAT', 'transparent': 'TRANSPARENT',
                        'styles': 'STYLES', 'version': 'VERSION', 'srs': 'SRS', 'crs': 'CRS',
                        'bgcolor': 'BGCOLOR', 'exceptions': 'EXCEPTIONS', 'time': 'TIME',
                        'sld': 'SLD', 'sld_body': 'SLD_BODY', 'filter': 'FILTER',
                        'tiled': 'TILED', 'tilesorigin': 'TILESORIGIN'
                    };
                    for (var key in layerDef.params) {
                        var upperKey = paramMap[key.toLowerCase()] || key.toUpperCase();
                        normalizedParams[upperKey] = layerDef.params[key];
                    }
                }
                
                // Ensure LAYERS param exists for WMS
                if ((layerDef.layerType === 'wms' || layerDef.layerType === 'WMS') && !normalizedParams['LAYERS']) {
                    normalizedParams['LAYERS'] = layerDef.id;
                }
                
                // Check singleTile option
                var useSingleTile = layerDef.options && layerDef.options.singleTile;
                
                // Create source based on layer type
                if (layerDef.layerType === 'wms' || layerDef.layerType === 'WMS') {
                    
                    if (useSingleTile) {
                        // ImageWMS for singleTile (one request per viewport)
                        source = new ol.source.ImageWMS({
                            url: layerDef.url,
                            params: normalizedParams,
                            serverType: 'mapserver',
                            crossOrigin: 'anonymous'
                        });
                        
                        layer = new ol.layer.Image({
                            source: source,
                            opacity: layerDef.opacity || 1.0,
                            visible: true,
                            zIndex: 100
                        });
                        
                        console.log('[SplitScreenCatalog] Created ImageWMS (singleTile) layer');
                    } else {
                        // TileWMS for tiled requests
                        source = new ol.source.TileWMS({
                            url: layerDef.url,
                            params: normalizedParams,
                            serverType: 'mapserver',
                            crossOrigin: 'anonymous'
                        });
                        
                        layer = new ol.layer.Tile({
                            source: source,
                            opacity: layerDef.opacity || 1.0,
                            visible: true,
                            zIndex: 100
                        });
                        
                        console.log('[SplitScreenCatalog] Created TileWMS layer');
                    }
                } else if (layerDef.layerType === 'arcgisRest' || layerDef.layerType === 'ArcGISRest') {
                    // ArcGIS REST Layer
                    var arcParams = Object.assign({
                        LAYERS: 'show:0',
                        FORMAT: 'PNG32',
                        TRANSPARENT: true
                    }, layerDef.params || {});
                    
                    if (useSingleTile) {
                        // ImageArcGISRest für singleTile (schneller)
                        source = new ol.source.ImageArcGISRest({
                            url: layerDef.url,
                            params: arcParams,
                            crossOrigin: 'anonymous'
                        });
                        
                        layer = new ol.layer.Image({
                            source: source,
                            opacity: layerDef.opacity || 0.65,
                            visible: true,
                            zIndex: 100
                        });
                    } else {
                        // TileArcGISRest für gekachelte Layer
                        source = new ol.source.TileArcGISRest({
                            url: layerDef.url,
                            params: arcParams,
                            crossOrigin: 'anonymous'
                        });
                        
                        layer = new ol.layer.Tile({
                            source: source,
                            opacity: layerDef.opacity || 0.65,
                            visible: true,
                            zIndex: 100
                        });
                    }
                } else {
                    console.warn('[SplitScreenCatalog] Unknown layer type:', layerDef.layerType);
                    return;
                }
                
                // Set metadata
                layer.set('name', layerDef.id);
                layer.set('title', layerDef.name);
                layer.set('catalogId', layerDef.id);
                
                // Add to map2
                this.map2.addLayer(layer);
                console.log('[SplitScreenCatalog] Layer created and added to map2:', layerDef.id);
                console.log('[SplitScreenCatalog]   -> Visible:', layer.getVisible());
                console.log('[SplitScreenCatalog]   -> Opacity:', layer.getOpacity());
                console.log('[SplitScreenCatalog]   -> ZIndex:', layer.getZIndex());
                console.log('[SplitScreenCatalog]   -> Source:', layer.getSource());
                
                // Force render and update size
                this.map2.updateSize();
                this.map2.render();
            } catch (e) {
                console.error('[SplitScreenCatalog] Error creating layer from definition:', e);
            }
        };
        
        // Add layer to map2 using LayerManager (setMapBookmark) - Fallback method
        window.TnetSplitScreen.addLayerToMap2 = function(layerId, visible) {
            if (!this.map2) {
                console.warn('[SplitScreenCatalog] map2 not available');
                return;
            }
            
            console.log('[SplitScreenCatalog] Adding layer to map2:', layerId, 'visible:', visible);
            
            try {
                if (window.top && window.top.njs && window.top.njs.AppManager) {
                    // Get main map
                    var mainMap = window.top.njs.AppManager.Maps.main.mapObj;
                    var beforeCount = mainMap.getLayers().getLength();
                    
                    // Build params string
                    var params = 'layers=' + layerId;
                    
                    console.log('[SplitScreenCatalog] Loading layer via setMapBookmark:', params);
                    
                    // Load layer in main map
                    window.top.njs.AppManager.setMapBookmark(['main'], params);
                    
                    // Wait for layer to be added, then clone to map2
                    var self = this;
                    setTimeout(function() {
                        var afterCount = mainMap.getLayers().getLength();
                        
                        if (afterCount > beforeCount) {
                            // Get the newly added layer(s)
                            var layers = mainMap.getLayers().getArray();
                            var newLayers = [];
                            
                            // Sammle neue Layer
                            for (var i = beforeCount; i < afterCount; i++) {
                                newLayers.push(layers[i]);
                            }
                            
                            // Klone zu map2 und entferne aus main
                            newLayers.forEach(function(mainLayer) {
                                console.log('[SplitScreenCatalog] New layer detected:', mainLayer.get('name'));
                                
                                // Clone to map2
                                var clonedLayer = self.cloneLayerForMap2(mainLayer);
                                if (clonedLayer) {
                                    clonedLayer.setVisible(visible);
                                    clonedLayer.set('catalogId', layerId); // Store catalog ID
                                    self.map2.addLayer(clonedLayer);
                                    console.log('[SplitScreenCatalog] Layer cloned to map2:', mainLayer.get('name'), 'visible:', visible);
                                }
                                
                                // WICHTIG: Entferne Layer aus Karte A (main)
                                mainMap.removeLayer(mainLayer);
                                console.log('[SplitScreenCatalog] Layer removed from main map:', mainLayer.get('name'));
                            });
                        } else {
                            console.warn('[SplitScreenCatalog] No new layer detected in main map');
                        }
                    }, 1000); // Warte 1 Sekunde auf Layer-Laden
                } else {
                    console.error('[SplitScreenCatalog] njs.AppManager not available');
                }
            } catch (e) {
                console.error('[SplitScreenCatalog] Error adding layer:', e);
            }
        };
        
        // Clone layer from main to map2
        window.TnetSplitScreen.cloneLayerForMap2 = function(layer) {
            if (!layer || !layer.getSource) return null;
            
            var source = layer.getSource();
            if (!source) return null;
            
            var newSource = null;
            
            try {
                if (source.constructor.name === 'TileWMS') {
                    var params = source.getParams ? source.getParams() : {};
                    newSource = new ol.source.TileWMS({
                        url: source.getUrl(),
                        params: Object.assign({}, params),
                        serverType: source.getServerType(),
                        crossOrigin: 'anonymous'
                    });
                } else if (source.constructor.name === 'ImageWMS') {
                    var params = source.getParams ? source.getParams() : {};
                    newSource = new ol.source.ImageWMS({
                        url: source.getUrl(),
                        params: Object.assign({}, params),
                        serverType: source.getServerType(),
                        crossOrigin: 'anonymous'
                    });
                } else if (source.constructor.name === 'XYZ') {
                    newSource = new ol.source.XYZ({
                        url: source.getUrl ? source.getUrl() : source.getUrls()[0],
                        crossOrigin: 'anonymous'
                    });
                } else if (source.constructor.name === 'OSM') {
                    newSource = new ol.source.OSM();
                } else {
                    console.warn('[SplitScreenCatalog] Unknown source type:', source.constructor.name);
                    return null;
                }
                
                // Create new layer
                var LayerClass = layer.constructor;
                var newLayer = new LayerClass({
                    source: newSource,
                    opacity: layer.getOpacity(),
                    visible: layer.getVisible(),
                    zIndex: layer.getZIndex()
                });
                
                // Copy metadata
                newLayer.set('name', layer.get('name'));
                newLayer.set('title', layer.get('title'));
                
                return newLayer;
            } catch (e) {
                console.error('[SplitScreenCatalog] Error cloning layer:', e);
                return null;
            }
        };
        
        // Find layer in map2
        window.TnetSplitScreen.findLayerInMap2 = function(layerId) {
            if (!this.map2) return null;
            
            var layers = this.map2.getLayers().getArray();
            for (var i = 0; i < layers.length; i++) {
                var layer = layers[i];
                
                // Check catalogId first (if set by our catalog)
                var catalogId = layer.get('catalogId');
                if (catalogId === layerId) {
                    return layer;
                }
                
                // Fallback: check name
                var name = layer.get('name') || '';
                if (name === layerId || name.indexOf(layerId) !== -1 || layerId.indexOf(name) !== -1) {
                    return layer;
                }
            }
            
            return null;
        };
        
        console.log('[SplitScreenCatalog] Catalog integration complete');
    }
    
    // Start initialization
    initCatalog();
})();
