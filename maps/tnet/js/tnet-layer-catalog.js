/**
 * tnet-layer-catalog.js
 * JavaScript-based layer catalog for Karte B (without Dojo)
 * 
 * Reads layer structure from PHP-generated JSON and creates
 * a simple, interactive layer tree.
 */

(function() {
    'use strict';

    var LayerCatalog = {
        catalogData: null,
        catalogPanel: null,
        catalogButton: null,
        map: null,
        
        /**
         * Initialize the layer catalog
         * @param {ol.Map} map - The OpenLayers map instance
         */
        init: function(map) {
            console.log('[LayerCatalog] Initializing...');
            this.map = map;
            
            // Create UI
            this.createCatalogUI();
            
            // Load layer data
            this.loadCatalogData();
        },
        
        /**
         * Create catalog UI elements
         */
        createCatalogUI: function() {
            var container = document.getElementById('split-panel-right');
            if (!container) {
                console.error('[LayerCatalog] Container not found');
                return;
            }
            
            // Create catalog button
            var btn = document.createElement('button');
            btn.id = 'layer-catalog-btn';
            btn.title = 'Themenkatalog';
            btn.style.cssText = 'position: absolute; top: 52px; right: 10px; width: 36px; height: 36px; background: white; border: none; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.2); cursor: pointer; z-index: 1002; display: flex; align-items: center; justify-content: center;';
            btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z" fill="currentColor"/></svg>';
            
            // Create catalog panel
            var panel = document.createElement('div');
            panel.id = 'layer-catalog-panel';
            panel.style.cssText = 'position: absolute; top: 94px; right: 10px; width: 300px; max-height: 500px; background: white; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.3); z-index: 1003; display: none; flex-direction: column;';
            
            // Header
            var header = document.createElement('div');
            header.style.cssText = 'padding: 10px; background: #2c5f6f; color: white; font-weight: bold; font-size: 13px; border-radius: 4px 4px 0 0; display: flex; justify-content: space-between; align-items: center;';
            header.innerHTML = '<span>Themenkatalog</span><span style="cursor: pointer; font-size: 18px;" id="catalog-close">×</span>';
            
            // Content container
            var content = document.createElement('div');
            content.id = 'layer-catalog-content';
            content.style.cssText = 'padding: 8px; overflow-y: auto; max-height: 440px; font-size: 12px;';
            content.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">Lade Katalog...</div>';
            
            panel.appendChild(header);
            panel.appendChild(content);
            
            // Event handlers
            btn.addEventListener('click', function() {
                panel.style.display = (panel.style.display === 'none') ? 'flex' : 'none';
            });
            
            header.querySelector('#catalog-close').addEventListener('click', function() {
                panel.style.display = 'none';
            });
            
            container.appendChild(btn);
            container.appendChild(panel);
            
            this.catalogButton = btn;
            this.catalogPanel = panel;
        },
        
        /**
         * Load catalog data from PHP endpoint
         */
        loadCatalogData: function() {
            var self = this;
            
            fetch('php/lyrmgr-to-json.php')
                .then(function(response) {
                    if (!response.ok) {
                        throw new Error('HTTP error ' + response.status);
                    }
                    return response.json();
                })
                .then(function(data) {
                    console.log('[LayerCatalog] Data loaded:', data);
                    self.catalogData = data;
                    self.renderCatalog();
                })
                .catch(function(error) {
                    console.error('[LayerCatalog] Error loading data:', error);
                    var content = document.getElementById('layer-catalog-content');
                    if (content) {
                        content.innerHTML = '<div style="padding: 20px; text-align: center; color: #f00;">Fehler beim Laden: ' + error.message + '</div>';
                    }
                });
        },
        
        /**
         * Render the catalog tree
         */
        renderCatalog: function() {
            var content = document.getElementById('layer-catalog-content');
            if (!content || !this.catalogData) return;
            
            content.innerHTML = '';
            
            if (!this.catalogData.categories || this.catalogData.categories.length === 0) {
                content.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">Keine Kategorien gefunden</div>';
                return;
            }
            
            // Render each top-level category (Nidwalden, Obwalden, Bund, Weitere)
            this.catalogData.categories.forEach(function(topCategory) {
                var topCategoryEl = this.createTopCategoryElement(topCategory);
                content.appendChild(topCategoryEl);
            }, this);
        },
        
        /**
         * Create a top-level category element (Nidwalden, Obwalden, etc.)
         */
        createTopCategoryElement: function(topCategory) {
            var self = this;
            var container = document.createElement('div');
            container.style.cssText = 'margin-bottom: 12px;';
            
            // Top category header
            var header = document.createElement('div');
            header.style.cssText = 'padding: 10px 8px; background: #2c5f6f; color: white; font-weight: bold; cursor: pointer; border-radius: 4px; display: flex; align-items: center;';
            header.innerHTML = '<span style="margin-right: 8px;">▶</span>' + topCategory.name;
            
            // Top category content (subcategories)
            var contentDiv = document.createElement('div');
            contentDiv.style.cssText = 'display: none; padding-left: 8px; margin-top: 6px;';
            
            // Render subcategories (grundlagen, oereb, etc.)
            if (topCategory.subcategories && topCategory.subcategories.length > 0) {
                topCategory.subcategories.forEach(function(subcategory) {
                    var subcategoryEl = self.createCategoryElement(subcategory);
                    contentDiv.appendChild(subcategoryEl);
                });
            }
            
            // Toggle handler
            var isOpen = false;
            header.addEventListener('click', function() {
                isOpen = !isOpen;
                contentDiv.style.display = isOpen ? 'block' : 'none';
                header.querySelector('span').textContent = isOpen ? '▼' : '▶';
            });
            
            container.appendChild(header);
            container.appendChild(contentDiv);
            
            return container;
        },
        
        /**
         * Create a category element (subcategory like "grundlagen", "oereb")
         */
        createCategoryElement: function(category) {
            var self = this;
            var container = document.createElement('div');
            container.style.cssText = 'margin-bottom: 8px;';
            
            // Category header
            var header = document.createElement('div');
            header.style.cssText = 'padding: 8px; background: #f5f5f5; font-weight: bold; cursor: pointer; border-radius: 4px; display: flex; align-items: center;';
            header.innerHTML = '<span style="margin-right: 6px;">▶</span>' + category.name;
            
            // Category content (groups)
            var contentDiv = document.createElement('div');
            contentDiv.style.cssText = 'display: none; padding-left: 12px; margin-top: 4px;';
            
            // Render groups
            if (category.groups && category.groups.length > 0) {
                category.groups.forEach(function(group) {
                    var groupEl = self.createGroupElement(group);
                    contentDiv.appendChild(groupEl);
                });
            }
            
            // Toggle handler
            var isOpen = false;
            header.addEventListener('click', function() {
                isOpen = !isOpen;
                contentDiv.style.display = isOpen ? 'block' : 'none';
                header.querySelector('span').textContent = isOpen ? '▼' : '▶';
            });
            
            container.appendChild(header);
            container.appendChild(contentDiv);
            
            return container;
        },
        
        /**
         * Create a group element
         */
        createGroupElement: function(group) {
            var self = this;
            var container = document.createElement('div');
            container.style.cssText = 'margin-bottom: 6px;';
            
            // Group header
            var header = document.createElement('div');
            header.style.cssText = 'padding: 6px; background: #fafafa; cursor: pointer; border-radius: 3px; display: flex; align-items: center;';
            header.innerHTML = '<span style="margin-right: 6px; font-size: 10px;">▶</span>' + group.name;
            
            // Group content (layers)
            var contentDiv = document.createElement('div');
            contentDiv.style.cssText = 'display: none; padding-left: 12px; margin-top: 3px;';
            
            // Render layers
            if (group.layers && group.layers.length > 0) {
                group.layers.forEach(function(layer) {
                    var layerEl = self.createLayerElement(layer);
                    contentDiv.appendChild(layerEl);
                });
            }
            
            // Toggle handler
            var isOpen = group.open || false;
            if (isOpen) {
                contentDiv.style.display = 'block';
                header.querySelector('span').textContent = '▼';
            }
            
            header.addEventListener('click', function() {
                isOpen = !isOpen;
                contentDiv.style.display = isOpen ? 'block' : 'none';
                header.querySelector('span').textContent = isOpen ? '▼' : '▶';
            });
            
            container.appendChild(header);
            container.appendChild(contentDiv);
            
            return container;
        },
        
        /**
         * Create a layer element
         */
        createLayerElement: function(layer) {
            var self = this;
            
            if (layer.type === 'group') {
                // Nested group
                return this.createGroupElement(layer);
            }
            
            // Layer item
            var item = document.createElement('div');
            item.style.cssText = 'padding: 4px 6px; cursor: pointer; display: flex; align-items: center; border-radius: 3px;';
            item.innerHTML = '<input type="checkbox" id="layer-' + layer.id.replace(/[^a-zA-Z0-9]/g, '_') + '" style="margin-right: 6px;"><label style="cursor: pointer; flex: 1;">' + layer.name + '</label>';
            
            var checkbox = item.querySelector('input');
            
            // Check if layer is already on map
            var mapLayer = this.findLayerOnMap(layer.id);
            if (mapLayer) {
                checkbox.checked = mapLayer.getVisible();
            }
            
            // Hover effect
            item.addEventListener('mouseenter', function() {
                item.style.background = '#f0f0f0';
            });
            item.addEventListener('mouseleave', function() {
                item.style.background = '';
            });
            
            // Toggle handler
            checkbox.addEventListener('change', function() {
                self.toggleLayer(layer.id, this.checked);
            });
            
            item.addEventListener('click', function(e) {
                if (e.target !== checkbox) {
                    checkbox.checked = !checkbox.checked;
                    checkbox.dispatchEvent(new Event('change'));
                }
            });
            
            return item;
        },
        
        /**
         * Find a layer on the map by ID
         */
        findLayerOnMap: function(layerId) {
            if (!this.map) return null;
            
            var found = null;
            this.map.getLayers().forEach(function(layer) {
                var name = layer.get('name') || layer.get('title');
                if (name === layerId) {
                    found = layer;
                }
            });
            
            return found;
        },
        
        /**
         * Toggle layer visibility or add to map
         */
        toggleLayer: function(layerId, visible) {
            console.log('[LayerCatalog] Toggle layer:', layerId, visible);
            
            var layer = this.findLayerOnMap(layerId);
            
            if (layer) {
                // Layer exists - toggle visibility
                layer.setVisible(visible);
                console.log('[LayerCatalog] Layer visibility set to:', visible);
            } else if (visible) {
                // Layer doesn't exist - would need to be created
                console.warn('[LayerCatalog] Layer', layerId, 'not on map - dynamic loading not yet implemented');
                // TODO: Implement dynamic layer loading from WMS configuration
            }
        },
        
        /**
         * Destroy the catalog
         */
        destroy: function() {
            if (this.catalogButton && this.catalogButton.parentNode) {
                this.catalogButton.parentNode.removeChild(this.catalogButton);
            }
            if (this.catalogPanel && this.catalogPanel.parentNode) {
                this.catalogPanel.parentNode.removeChild(this.catalogPanel);
            }
            this.catalogButton = null;
            this.catalogPanel = null;
            this.catalogData = null;
            this.map = null;
        }
    };

    // Export to global scope
    window.TnetLayerCatalog = LayerCatalog;
})();
