/*
 * tnet_modules_m.js
 * Dojo Module-Loader für Mobile-Ansicht (index_de_m.htm)
 * Leichtgewichtiger als Desktop: kein EnhancedGrid, Pagination, Filter
 * AccordionContainer für Layer-Katalog (4 Kantone)
 *
 * @version    1.0
 * @date       2026-02-19
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */
require([
    "dojo/ready",
    "dojo/parser",
    "dojo/dom-construct",
    "dojo/dom-attr",
    "dojo/dom-style",
    "dojo/dom-geometry",
    "dijit/layout/BorderContainer",
    "dijit/layout/ContentPane",
    "dijit/TitlePane",
    "dijit/Dialog",
    "dijit/form/Select",
    "dijit/form/Button",
    "dijit/form/TextBox",
    "dijit/form/CheckBox",
    "dijit/Tooltip",
    "dijit/form/FilteringSelect",
    "dijit/form/Textarea",
    "dijit/form/ValidationTextBox",
    "dijit/form/RadioButton",
    "njs/form/GroupToggleButton",
    "njs/data/ComboBoxReadSolrStore",
    "dojo/topic",
    "dojo/fx",
    "dijit/layout/TabContainer"
], function(ready, parser, domConstruct, domAttr, domStyle) {
    ready(function() {
        var mobileCfg = window.tnetMobileConfig || {};
        function getMobileCfg(path, fallback) {
            var obj = mobileCfg;
            var parts = path.split('.');
            for (var i = 0; i < parts.length; i++) {
                if (!obj || typeof obj !== 'object' || !(parts[i] in obj)) return fallback;
                obj = obj[parts[i]];
            }
            return (obj === undefined || obj === null) ? fallback : obj;
        }

        var sheetMinVh = Number(getMobileCfg('sheets.resize.minVh', 0.30));
        var sheetMaxVh = Number(getMobileCfg('sheets.resize.maxVh', 0.85));
        var sheetSnapCloseVh = Number(getMobileCfg('sheets.resize.snapCloseVh', 0.20));
        var drawerAutoCloseDelayMs = Number(getMobileCfg('drawer.autoCloseDelayMs', 200));
        var drawerInitFallbackMs = Number(getMobileCfg('timing.drawerInitFallbackMs', 3000));
        var layersFixDelaysMs = getMobileCfg('timing.layersFixDelaysMs', [100, 400, 1000]);

        if (!(sheetMinVh > 0 && sheetMinVh < 1)) sheetMinVh = 0.30;
        if (!(sheetMaxVh > sheetMinVh && sheetMaxVh <= 1)) sheetMaxVh = 0.85;
        if (!(sheetSnapCloseVh > 0 && sheetSnapCloseVh < 1)) sheetSnapCloseVh = 0.20;
        if (!(drawerAutoCloseDelayMs >= 0)) drawerAutoCloseDelayMs = 200;
        if (!(drawerInitFallbackMs >= 0)) drawerInitFallbackMs = 3000;
        if (!Array.isArray(layersFixDelaysMs) || !layersFixDelaysMs.length) layersFixDelaysMs = [100, 400, 1000];
        layersFixDelaysMs = layersFixDelaysMs
            .map(function(v) { return Number(v); })
            .filter(function(v) { return !isNaN(v) && v >= 0; });
        if (!layersFixDelaysMs.length) layersFixDelaysMs = [100, 400, 1000];

        // FloatingPane-Stub: wird von openlayers.js erwartet, auf Mobile aber nicht benötigt
        // Vollständiger AMD-Import verursacht multipleDefine-Fehler im Dojo-Loader
        if (!window.dojox) window.dojox = {};
        if (!window.dojox.layout) window.dojox.layout = {};
        if (!window.dojox.layout.FloatingPane) {
            window.dojox.layout.FloatingPane = function() {};
            window.dojox.layout.FloatingPane.prototype.startup = function() {};
            window.dojox.layout.FloatingPane.prototype.destroy = function() {};
        }

        // Build the page
        parser.parse();

        // Loading-Indicator (Cube)
        var node = document.createElement('div');
        dojo.attr(node, "role", "presentation");
        dojo.attr(node, "id", "infolay_wait");
        dojo.attr(node, "class", "infolay_wait");
        dojo.attr(node, "style", "display:none;z-index: 99999;");

        var subnode = document.createElement('div');
        dojo.attr(subnode, "class", "cube");

        var faces = ['front', 'back', 'left', 'right', 'top', 'bottom'];
        faces.forEach(function(face) {
            var el = document.createElement('div');
            dojo.attr(el, "class", "face " + face);
            dojo.place(el, subnode, "last");
        });

        dojo.place(subnode, node, "last");
        dojo.place(node, dojo.body(), "first");

        // 3D-Viewer Funktion (identisch mit Desktop)
        njs.AppManager.start3D = function(idmap) {
            var center = njs.AppManager.Maps[idmap].mapObj.getView().getCenter();
            if (njs.AppManager.Maps[idmap].mapObj.getView().getProjection().getCode() != "EPSG:2056") {
                center = ol.proj.transform(center, njs.AppManager.Maps[idmap].mapObj.getView().getProjection().getCode(), "EPSG:2056");
            }

            var alti_obj = njs.AppManager.Tools.ElevationDisplay.map.alti1;
            var _url = alti_obj.cgi.url;
            _url += (_url.indexOf('?') > -1) ? "&" : "?";
            _url += ("&dbconn_id=" + alti_obj.cgi.dbconn_id + "&table=" + alti_obj.cgi.table + "&x=" + center[0] + "&y=" + center[1] + "&srs=" + alti_obj.elevationProj.replace("EPSG:", ""));
            var alti = 400;
            dojo.xhrGet({
                url: _url,
                preventCache: true,
                handleAs: "json",
                sync: false,
                load: function(response) {
                    if (response) {
                        alti = parseFloat(response);
                        var resol = njs.AppManager.Maps[idmap].mapObj.getView().getResolution();
                        var h = 3000 * resol;
                        if (resol < 0.4) h = 5000 * resol;
                        if (resol < 0.2) h = 8000 * resol;
                        if (h > 20000) h = 20000;
                        if (h < (alti + 200)) h = alti + 200;

                        center = njs.AppManager.Maps[idmap].mapObj.getView().getCenter();
                        if (njs.AppManager.Maps[idmap].mapObj.getProjection != "EPSG:4326") {
                            center = ol.proj.transform(center, njs.AppManager.Maps[idmap].mapObj.getView().getProjection().getCode(), "EPSG:4326");
                        }

                        var url = "https://3d.mapplus.ch/?site=public&basemap=Luftbild&bm_show=1&layers=SWISSTOPO_Buildings,SWISSTOPO_trees&camx=" + center[0] + "&camy=" + center[1] + '&camz=' + h + '&heading=6.283&pitch=-1.571';
                        window.open(url, "_blank");
                    }
                },
                error: function(error) {
                    console.error('elevation service error', error);
                }
            });
        };

        // App initialisieren
        njs.AppManager.initApp();

        njs.AppManager.legend_css = ['../core/legends/css/geoadmin_legends.css'];

        // --- Mobile Drawer Logic ---
        window.mDrawerInit = function() {
            var hamburger = document.getElementById('m-hamburger');
            var drawer = document.getElementById('m-drawer');
            var overlay = document.getElementById('m-drawer-overlay');
            var closeBtn = document.getElementById('m-drawer-close');

            function openDrawer() {
                drawer.classList.add('open');
                overlay.classList.add('open');
                document.body.style.overflow = 'hidden';
            }

            function closeDrawer() {
                drawer.classList.remove('open');
                overlay.classList.remove('open');
                document.body.style.overflow = '';
            }
            window.closeDrawer = closeDrawer;

            if (hamburger) hamburger.addEventListener('click', openDrawer);
            if (overlay) overlay.addEventListener('click', closeDrawer);
            if (closeBtn) closeBtn.addEventListener('click', closeDrawer);

            // Block clicks on disabled items
            if (drawer) {
                drawer.addEventListener('click', function(evt) {
                    var target = evt.target;
                    // Walk up DOM tree to find aria-disabled element
                    while (target && target !== drawer) {
                        if (target.getAttribute && target.getAttribute('aria-disabled') === 'true') {
                            evt.preventDefault();
                            evt.stopImmediatePropagation();
                            return false;
                        }
                        target = target.parentElement;
                    }
                }, true); // capture phase
            }

            // Expandable sub-panels
            document.querySelectorAll('[data-m-toggle]').forEach(function(item) {
                item.addEventListener('click', function() {
                    var targetId = this.getAttribute('data-m-toggle');
                    var target = document.getElementById(targetId);
                    if (!target) return;

                    var isOpen = target.classList.contains('open');
                    // Close all sub-panels
                    document.querySelectorAll('.m-sub-panel').forEach(function(p) {
                        p.classList.remove('open');
                    });
                    document.querySelectorAll('[data-m-toggle]').forEach(function(i) {
                        i.classList.remove('expanded');
                    });

                    if (!isOpen) {
                        target.classList.add('open');
                        this.classList.add('expanded');
                    }
                });
            });

            // --- Shared Overlay für Bottom-Sheets ---
            var sheetOverlay = document.getElementById('m-sheet-overlay');

            function closeAllSheets() {
                // Generic bottom-sheets (Themenkatalog)
                document.querySelectorAll('.m-bottom-sheet.open').forEach(function(s) {
                    s.classList.remove('open');
                    s.style.height = ''; // Reset resize
                });
                if (sheetOverlay) sheetOverlay.classList.remove('open');

                // Basemap-Sheet
                var bs = document.getElementById('m-basemap-sheet');
                var bo = document.getElementById('m-basemap-overlay');
                if (bs) bs.classList.remove('open');
                if (bo) bo.classList.remove('open');

                // ÖREB-Panel
                if (typeof window.closeOerebPanel === 'function') {
                    var op = document.getElementById('oereb-dock-panel');
                    if (op && !op.classList.contains('hidden')) {
                        window.closeOerebPanel();
                    }
                }

                // Drucken-Panel (tnet-print.js)
                if (typeof window.closePrintPanel === 'function') {
                    var pp = document.getElementById('print-panel');
                    if (pp && !pp.classList.contains('hidden')) {
                        window.closePrintPanel();
                    }
                }
            }

            if (sheetOverlay) {
                sheetOverlay.addEventListener('click', closeAllSheets);
            }

            // --- Universeller Bottom-Sheet Drag-to-Resize ---
            // Alle Sheets mit einem Handle bekommen Drag-to-Resize.
            // window.attachSheetResize(handle) kann auch nachträglich aufgerufen werden (z.B. ÖREB)
            window.attachSheetResize = function attachSheetResize(handle) {
                if (!handle || typeof handle.closest !== 'function' || handle._sheetResizeAttached) return;
                handle._sheetResizeAttached = true;
                var sheet = handle.closest('.m-bottom-sheet')
                         || handle.closest('#m-basemap-sheet')
                         || handle.closest('#oereb-dock-panel');
                if (!sheet) return;

                var startY = 0, startH = 0, dragging = false;

                function onStart(e) {
                    dragging = true;
                    var touch = e.touches ? e.touches[0] : e;
                    startY = touch.clientY;
                    startH = sheet.offsetHeight;
                    sheet.style.transition = 'none'; // smooth resize
                    e.preventDefault();
                }

                function onMove(e) {
                    if (!dragging) return;
                    var touch = e.touches ? e.touches[0] : e;
                    var dy = startY - touch.clientY; // nach oben = grösser
                    var newH = Math.max(
                        window.innerHeight * sheetMinVh,
                        Math.min(
                            window.innerHeight * sheetMaxVh,
                            startH + dy
                        )
                    );
                    sheet.style.setProperty('height', newH + 'px', 'important');
                    if (e.cancelable) e.preventDefault();
                }

                function onEnd() {
                    if (!dragging) return;
                    dragging = false;
                    sheet.style.transition = '';

                    // Snap close: wenn unter 20% → Sheet schliessen
                    var h = sheet.offsetHeight;
                    if (h < window.innerHeight * sheetSnapCloseVh) {
                        sheet.style.removeProperty('height');
                        // Finde die richtige Close-Funktion
                        if (sheet.id === 'm-layers-sheet' && window.closeLayersSheet) closeLayersSheet();
                        else if (sheet.id === 'm-basemap-sheet' && window.closeBasemapSheet) closeBasemapSheet();
                        else if (sheet.id === 'oereb-dock-panel' && window.closeOerebPanel) closeOerebPanel();
                        else {
                            sheet.classList.remove('open');
                            if (sheetOverlay) sheetOverlay.classList.remove('open');
                        }
                    }
                }

                handle.addEventListener('touchstart', onStart, { passive: false });
                handle.addEventListener('mousedown', onStart);
                document.addEventListener('touchmove', onMove, { passive: false });
                document.addEventListener('mousemove', onMove);
                document.addEventListener('touchend', onEnd);
                document.addEventListener('mouseup', onEnd);
            };

            // Alle bereits im DOM vorhandenen Handles initialisieren
            (function initSheetResize() {
                var handleSelectors = [
                    '.m-bottom-sheet .m-sheet-handle',
                    '#m-basemap-sheet .m-sheet-handle',
                    '#oereb-dock-panel .m-sheet-handle'
                ];
                document.querySelectorAll(handleSelectors.join(',')).forEach(function(el) {
                    window.attachSheetResize(el);
                });
            })();

            // --- Themenkatalog Bottom-Sheet ---
            var layersSheet = document.getElementById('m-layers-sheet');

            window.openLayersSheet = function() {
                closeAllSheets();

                // SYNCHRON: active-tab SOFORT setzen BEVOR Sheet geöffnet wird
                // tnet_toc.css versteckt alle Panes ohne .active-tab
                var container = document.getElementById('kantons_container');
                if (container) {
                    var activePane = container.querySelector('.dijitTitlePane.active-tab');
                    if (!activePane) {
                        // Kein active-tab → NW-Pane aktivieren
                        var firstPaneEl = document.getElementById('tp_layer_menu');
                        if (firstPaneEl) {
                            var dojoPane = firstPaneEl.closest('.dijitTitlePane') || firstPaneEl;
                            dojoPane.classList.add('active-tab');
                        }
                        // Tab-Bar synchronisieren
                        var tabBar = document.getElementById('kantons_tab_bar');
                        if (tabBar) {
                            var firstTab = tabBar.querySelector('.kanton-tab');
                            if (firstTab) firstTab.classList.add('active');
                        }
                    }
                }

                if (layersSheet) {
                    layersSheet.style.height = ''; // Reset auf CSS-Default (50vh)
                    layersSheet.classList.add('open');
                }
                if (sheetOverlay) sheetOverlay.classList.add('open');
                closeDrawer();

                // Einmaliger Fix: Ersten aktiven Tab setzen falls nötig
                function initActiveTab() {
                    var container = document.getElementById('kantons_container');
                    if (!container) return;

                    var activePane = container.querySelector('.dijitTitlePane.active-tab');
                    if (!activePane) {
                        var firstPaneEl = document.getElementById('tp_layer_menu');
                        if (firstPaneEl) {
                            var dojoPane = firstPaneEl.closest('.dijitTitlePane') || firstPaneEl;
                            dojoPane.classList.add('active-tab');
                        }
                        var tabBar = document.getElementById('kantons_tab_bar');
                        if (tabBar) {
                            var firstTab = tabBar.querySelector('.kanton-tab');
                            if (firstTab) firstTab.classList.add('active');
                        }
                    }
                }
                // Einmal initial + einmal verzögert (statt 3× forceAllPanesOpen)
                initActiveTab();
                setTimeout(initActiveTab, 500);
            };

            window.closeLayersSheet = function() {
                if (layersSheet) layersSheet.classList.remove('open');
                if (sheetOverlay) sheetOverlay.classList.remove('open');
            };

            // watchActivePane entfernt — konsolidierter Observer in tnet-toc-m.js übernimmt

            // Pointer-Events stoppen auf Sheet
            if (layersSheet) {
                layersSheet.addEventListener('pointerdown', function(e) { e.stopPropagation(); });
                layersSheet.addEventListener('mousedown', function(e) { e.stopPropagation(); });
            }

            // --- Basemap Bottom-Sheet ---
            var basemapSheet = document.getElementById('m-basemap-sheet');
            var basemapOverlay = document.getElementById('m-basemap-overlay');
            var basemapSheetClose = document.getElementById('m-basemap-sheet-close');
            var basemapSelector = document.getElementById('basemap_selector');

            window.openBasemapSheet = function() {
                closeAllSheets();
                if (basemapSheet) basemapSheet.classList.add('open');
                if (basemapOverlay) basemapOverlay.classList.add('open');
                closeDrawer();
            };

            window.closeBasemapSheet = function() {
                if (basemapSheet) basemapSheet.classList.remove('open');
                if (basemapOverlay) basemapOverlay.classList.remove('open');
            };

            if (basemapSheetClose) basemapSheetClose.addEventListener('click', closeBasemapSheet);
            if (basemapOverlay) basemapOverlay.addEventListener('click', closeBasemapSheet);

            // Pointer-Events stoppen auf Sheet (OL-Map soll nicht reagieren)
            if (basemapSheet) {
                basemapSheet.addEventListener('pointerdown', function(e) { e.stopPropagation(); });
                basemapSheet.addEventListener('mousedown', function(e) { e.stopPropagation(); });
            }

            // Basemap-Selector auf Karte → öffnet Bottom-Sheet
            if (basemapSelector) {
                basemapSelector.onclick = function(e) {
                    e.stopPropagation();
                    openBasemapSheet();
                };
            }

            // --- Delegierter Card-Klick-Handler im Bottom-Sheet ---
            // (tnet-basemap.js initBasemapCards() bindet nur an #basemap_widget,
            //  das auf Mobile hidden ist → eigener Handler nötig)
            if (basemapSheet) {
                basemapSheet.addEventListener('click', function(e) {
                    var card = e.target.closest('.basemap-card');
                    if (!card) return;

                    var basemapId = card.dataset.basemap;
                    if (!basemapId) return;

                    // Active-Klasse auf allen Cards umschalten
                    document.querySelectorAll('.basemap-card').forEach(function(c) {
                        c.classList.remove('active');
                    });
                    card.classList.add('active');

                    // Basemap wechseln
                    if (window.njs && njs.AppManager && njs.AppManager.Maps && njs.AppManager.Maps.main) {
                        njs.AppManager.Maps['main'].changeBaseMap(basemapId);
                    }

                    // Selector-Preview auf Karte aktualisieren
                    updateBasemapSelectorPreview(basemapId, card);
                });
            }

            // --- Selector-Preview synchronisieren ---
            window.updateBasemapSelectorPreview = function(basemapId, card) {
                if (!basemapSelector) return;
                var preview = basemapSelector.querySelector('.basemap-preview');
                var label = basemapSelector.querySelector('.basemap-label');

                if (preview && card) {
                    // Preview-Klasse vom Card-Preview übernehmen
                    var cardPreview = card.querySelector('.basemap-card-preview');
                    if (cardPreview) {
                        // Alle möglichen Klassen entfernen
                        var previewClasses = ['orthofoto','basisplan','grundbuch','landeskarte',
                            'siegfried','dufour','transparent','keine','osm','swisstlm'];
                        previewClasses.forEach(function(cls) {
                            preview.classList.remove(cls);
                        });
                        // Aktive Klasse setzen
                        previewClasses.forEach(function(cls) {
                            if (cardPreview.classList.contains(cls)) {
                                preview.classList.add(cls);
                            }
                        });
                    }
                }

                if (label && card) {
                    var cardLabel = card.querySelector('.basemap-card-label');
                    if (cardLabel) {
                        label.textContent = cardLabel.textContent;
                    }
                }
            };

            // Initiale Preview-Sync (aktive Card → Selector)
            var activeCard = basemapSheet ? basemapSheet.querySelector('.basemap-card.active') : null;
            if (activeCard) {
                var activeId = activeCard.dataset.basemap || '';
                updateBasemapSelectorPreview(activeId, activeCard);
            }

            // Close drawer when a simple action item is clicked
            document.querySelectorAll('.m-menu-item[data-m-action]').forEach(function(item) {
                item.addEventListener('click', function() {
                    setTimeout(closeDrawer, drawerAutoCloseDelayMs);
                });
            });
        };

        // Drawer Init nach tnet-app-ready
        document.addEventListener('tnet-app-ready', function() {
            if (window.mDrawerInit) mDrawerInit();

            // --- Layer-Fehler abfangen und als Toast melden ---
            var map = (window.TnetUtils && TnetUtils.getMainMap) ? TnetUtils.getMainMap() : null;
            if (map) {
                var _lastLayerErrorMsg = '';
                var _lastLayerErrorTime = 0;
                map.getLayers().on('add', function(evt) {
                    var layer = evt.element;
                    if (!layer || !layer.getSource) return;
                    var src = layer.getSource();
                    if (!src || !src.on) return;

                    // Image-Layer: EncodingError abfangen
                    src.on('imageloaderror', function() {
                        var name = layer.get('title') || layer.get('name') || 'Layer';
                        var now = Date.now();
                        if (name !== _lastLayerErrorMsg || now - _lastLayerErrorTime > 5000) {
                            _lastLayerErrorMsg = name;
                            _lastLayerErrorTime = now;
                            if (window.TnetUtils && TnetUtils.showToast) {
                                TnetUtils.showToast('Layer "' + name + '" konnte nicht geladen werden.', 3000);
                            }
                        }
                    });

                    // Tile-Layer: Tile-Fehler abfangen
                    src.on('tileloaderror', function() {
                        var name = layer.get('title') || layer.get('name') || 'Layer';
                        var now = Date.now();
                        if (name !== _lastLayerErrorMsg || now - _lastLayerErrorTime > 5000) {
                            _lastLayerErrorMsg = name;
                            _lastLayerErrorTime = now;
                            if (window.TnetUtils && TnetUtils.showToast) {
                                TnetUtils.showToast('Layer "' + name + '" konnte nicht geladen werden.', 3000);
                            }
                        }
                    });
                });
            }
        });

        // --- Globaler Handler für unbehandelte Promise-Fehler (z.B. GeoJSON Parse Error) ---
        window.addEventListener('unhandledrejection', function(evt) {
            if (!evt || !evt.reason) return;
            var msg = (evt.reason.message || String(evt.reason)).toLowerCase();
            // Nur Layer-relevante Fehler abfangen
            if (msg.indexOf('unexpected token') !== -1 ||
                msg.indexOf('json') !== -1 ||
                msg.indexOf('encodingerror') !== -1 ||
                msg.indexOf('source image') !== -1) {
                evt.preventDefault(); // Konsole-Fehlermeldung unterdrücken
                if (window.TnetUtils && TnetUtils.showToast) {
                    TnetUtils.showToast('Fehler beim Laden von Layerdaten.', 3000);
                }
            }
        });

        // Fallback: Init nach 3s
        setTimeout(function() {
            if (window.mDrawerInit) mDrawerInit();
        }, drawerInitFallbackMs);

        // --- Orientation Change & Resize Handler ---
        // Sicherstelle, dass BorderContainer.resize() auf Mobile zuverlässig getriggert wird
        (function setupResizeHandlers() {
            var resizeDebounceTimer = null;
            var lastWindowHeight = window.innerHeight;

            function triggerLayoutResize(reason) {
                clearTimeout(resizeDebounceTimer);
                resizeDebounceTimer = setTimeout(function() {
                    try {
                        var nc = dijit.byId('NeapoljsContainer');
                        if (nc && typeof nc.resize === 'function') {
                            nc.resize();
                            if (window.FEATURE_FLAGS && window.FEATURE_FLAGS.DEBUG_MODE) {
                                console.log('[Layout] BorderContainer.resize() triggered: ' + reason);
                            }
                        }
                    } catch(e) {
                        console.error('[Layout] Resize failed:', e.message);
                    }
                }, 200);
            }

            // Event 1: Orientation Change
            window.addEventListener('orientationchange', function() {
                setTimeout(function() { triggerLayoutResize('orientationchange'); }, 50);
            });

            // Event 2: Resize (aber mit debounce, häufig getriggert)
            window.addEventListener('resize', function() {
                var currentHeight = window.innerHeight;
                if (currentHeight !== lastWindowHeight) {
                    lastWindowHeight = currentHeight;
                    triggerLayoutResize('resize');
                }
            });
        })();

        // --- Drucken-Panel Patch (tnet-print.js) ---
        // dockPrintPanel() setzt inline Styles (Desktop-Docking) und schrumpft mapContainer.
        // Auf Mobile brauchen wir Fullscreen-CSS. Inline-Styles entfernen + mapContainer 100%.
        (function patchPrintPanel() {
            var printInlineProps = ['top','right','bottom','left','width','height','max-width'];
            var printObs = new MutationObserver(function() {
                var pp = document.getElementById('print-panel');
                if (!pp) return;
                if (!pp.classList.contains('hidden')) {
                    // Panel wurde sichtbar → Inline-Styles entfernen
                    requestAnimationFrame(function() {
                        printInlineProps.forEach(function(p) { pp.style.removeProperty(p); });
                        var mc = document.getElementById('mapContainer');
                        if (mc) mc.style.setProperty('width', '100%', 'important');
                    });
                }
            });
            // Beobachte das Body (print-panel wird dynamisch eingefügt von tnet-print.js)
            var bodyObs = new MutationObserver(function() {
                var pp = document.getElementById('print-panel');
                if (pp) {
                    bodyObs.disconnect();
                    printObs.observe(pp, { attributes: true, attributeFilter: ['class', 'style'] });
                }
            });
            bodyObs.observe(document.body, { childList: true, subtree: true });
        })();

        // --- ÖREB Bottom-Sheet Patch ---
        // ÖREB auf Mobile: Desktop-Docking komplett deaktivieren,
        // damit die CSS Bottom-Sheet-Styles (position:fixed; bottom:0) greifen.
        // tnet-oereb.js setzt window.isOerebPanelDocked = true (Default + bei deactivate).
        // Wir überschreiben die Property per defineProperty, sodass sie immer false bleibt.
        // Dadurch ruft showOerebDockPanel() nie dockOerebPanel() auf und
        // updateDockedOerebPosition() bailed sofort → keine Inline-Styles.
        (function patchOerebBottomSheet() {
            var panel = document.getElementById('oereb-dock-panel');
            if (!panel) return;

            // isOerebPanelDocked dauerhaft auf false fixieren
            Object.defineProperty(window, 'isOerebPanelDocked', {
                get: function() { return false; },
                set: function() { /* ignored on mobile */ },
                configurable: true
            });

            // --- Echten Drag-Handle einfügen (statt CSS ::before) ---
            var handle = document.createElement('div');
            handle.className = 'm-sheet-handle oereb-sheet-handle';
            handle.innerHTML = '<div class="m-sheet-bar"></div>';
            panel.insertBefore(handle, panel.firstChild);

            // Drag-to-Resize via universelle Funktion
            // Falls mDrawerInit noch nicht lief, retry bis attachSheetResize verfügbar (max 25×)
            (function tryAttachResize(attempts) {
                if (window.attachSheetResize) {
                    window.attachSheetResize(handle);
                } else if (attempts < 25) {
                    setTimeout(function() { tryAttachResize(attempts + 1); }, 200);
                }
            })(0);
            // Desktop-Inline-Styles, die beim Sichtbar-Werden entfernt werden.
            // WICHTIG: 'height' NICHT entfernen — wird vom Drag-to-Resize gesetzt.
            var inlineProps = ['position','top','right','bottom','left','width','max-height',
                               'max-width','display','flex-direction','overflow','border-radius','box-shadow',
                               'background','z-index','transform','transition'];
            inlineProps.forEach(function(p) { panel.style.removeProperty(p); });
            panel.classList.remove('docked-right');

            // Bei jedem Sichtbar-Werden: andere Sheets schliessen + Inline-Styles bereinigen
            var obs = new MutationObserver(function() {
                var isVisible = !panel.classList.contains('hidden');
                if (isVisible) {
                    // Alle anderen Sheets schliessen (nur 1 Sheet gleichzeitig)
                    document.querySelectorAll('.m-bottom-sheet.open').forEach(function(s) {
                        s.classList.remove('open');
                        s.style.height = '';
                    });
                    var so = document.getElementById('m-sheet-overlay');
                    if (so) so.classList.remove('open');
                    var bso = document.getElementById('m-basemap-sheet');
                    var boo = document.getElementById('m-basemap-overlay');
                    if (bso) bso.classList.remove('open');
                    if (boo) boo.classList.remove('open');

                    // Inline-Styles entfernen (falls doch gesetzt)
                    requestAnimationFrame(function() {
                        inlineProps.forEach(function(p) { panel.style.removeProperty(p); });
                        panel.classList.remove('docked-right');
                        var mc = document.getElementById('mapContainer');
                        if (mc) mc.style.setProperty('width', '100%', 'important');
                    });
                }
            });
            obs.observe(panel, { attributes: true, attributeFilter: ['class'] });

            // Drag-to-Resize wird vom universellen initSheetResize() übernommen
        })();

        // --- Print-Panel Bottom-Sheet Patch ---
        // Gleicher Ansatz wie ÖREB: Desktop-Docking-Inline-Styles entfernen,
        // Handle einfügen, Resize anbinden.
        (function patchPrintBottomSheet() {
            var panel = document.getElementById('print-panel');
            if (!panel) {
                // Panel wird dynamisch von tnet-print.js erzeugt — warten
                var attempts = 0;
                var timer = setInterval(function() {
                    panel = document.getElementById('print-panel');
                    attempts++;
                    if (panel) {
                        clearInterval(timer);
                        initPrintPatch(panel);
                    } else if (attempts > 50) { // 10s max
                        clearInterval(timer);
                    }
                }, 200);
                return;
            }
            initPrintPatch(panel);

            function initPrintPatch(panel) {
                // Handle einfügen
                var handle = document.createElement('div');
                handle.className = 'm-sheet-handle print-sheet-handle';
                handle.innerHTML = '<div class="m-sheet-bar"></div>';
                handle._sheetResizeAttached = true; // Verhindert doppelte Registration durch attachSheetResize
                panel.insertBefore(handle, panel.firstChild);

                // Eigenständiger Drag-to-Resize direkt auf dem Print-Handle
                // (unabhängig von attachSheetResize, keine Timing-Probleme)
                var startY = 0, startH = 0, dragging = false;
                var minH = 0.20, maxH = 0.90;

                function onStart(e) {
                    dragging = true;
                    var t = e.touches ? e.touches[0] : e;
                    startY = t.clientY;
                    startH = panel.offsetHeight;
                    panel.style.transition = 'none';
                    e.preventDefault();
                    e.stopPropagation();
                }
                function onMove(e) {
                    if (!dragging) return;
                    var t = e.touches ? e.touches[0] : e;
                    var dy = startY - t.clientY;
                    var newH = Math.max(
                        window.innerHeight * minH,
                        Math.min(window.innerHeight * maxH, startH + dy)
                    );
                    // height wird von tnet-print.js entfernt — Workaround:
                    // min-height + max-height auf gleichen Wert = erzwungene Höhe
                    panel.style.setProperty('min-height', newH + 'px', 'important');
                    panel.style.setProperty('max-height', newH + 'px', 'important');
                    if (e.cancelable) e.preventDefault();
                }
                function onEnd() {
                    if (!dragging) return;
                    dragging = false;
                    panel.style.transition = '';
                    var h = panel.offsetHeight;
                    if (h < window.innerHeight * 0.15) {
                        panel.style.removeProperty('min-height');
                        panel.style.removeProperty('max-height');
                        if (window.closePrintPanel) window.closePrintPanel();
                    }
                }

                handle.addEventListener('touchstart', onStart, { passive: false });
                handle.addEventListener('mousedown', onStart);
                document.addEventListener('touchmove', onMove, { passive: false });
                document.addEventListener('mousemove', onMove);
                document.addEventListener('touchend', onEnd);
                document.addEventListener('mouseup', onEnd);

                // Inline-Styles, die vom Desktop-Docking gesetzt werden
                var inlineProps = ['position','top','right','bottom','left','width','height','max-height',
                                   'max-width','border-radius','box-shadow','z-index','transform'];

                // MutationObserver: Desktop-Inline-Styles entfernen wenn Panel sichtbar
                var printPatchApplied = false;
                var obs = new MutationObserver(function() {
                    var isVisible = !panel.classList.contains('hidden');
                    if (isVisible && !printPatchApplied) {
                        printPatchApplied = true;

                        // Andere Sheets schliessen
                        document.querySelectorAll('.m-bottom-sheet.open').forEach(function(s) {
                            s.classList.remove('open');
                            s.style.height = '';
                        });
                        var so = document.getElementById('m-sheet-overlay');
                        if (so) so.classList.remove('open');
                        var bso = document.getElementById('m-basemap-sheet');
                        var boo = document.getElementById('m-basemap-overlay');
                        if (bso) bso.classList.remove('open');
                        if (boo) boo.classList.remove('open');
                        var oep = document.getElementById('oereb-dock-panel');
                        if (oep && !oep.classList.contains('hidden') && window.closeOerebPanel) closeOerebPanel();

                        // Desktop-Docking komplett deaktivieren:
                        if (window.togglePrintPanelDock && panel.classList.contains('docked-right')) {
                            window.togglePrintPanelDock();
                        }

                        // Verbleibende Inline-Styles bereinigen (einmalig beim Öffnen)
                        requestAnimationFrame(function() {
                            inlineProps.forEach(function(p) { panel.style.removeProperty(p); });
                            panel.classList.remove('docked-right');
                            var mc = document.getElementById('mapContainer');
                            if (mc) mc.style.setProperty('width', '100%', 'important');
                        });

                        // Mobile: Default-Massstab 1:1000
                        var scaleSelect = document.getElementById('print-scale');
                        if (scaleSelect && scaleSelect.value !== '1000') {
                            scaleSelect.value = '1000';
                            scaleSelect.dispatchEvent(new Event('change', { bubbles: true }));
                        }

                        // Mobile: view.padding setzt den logischen View-Mittelpunkt
                        // so, dass er im sichtbaren Bereich oberhalb des Panels
                        // gerendert wird. tnet-print.js positioniert den Druckrahmen
                        // auf view.getCenter() — mit Padding erscheint er oben.
                        // Delay 700ms: adjustZoomForPrintFrame() braucht 300ms
                        // Animation + 350ms setTimeout für updateFrameSize.
                        setTimeout(function() {
                            var map = window._olMap;
                            if (!map) return;
                            var view = map.getView();
                            var mapEl = map.getTargetElement();
                            if (!mapEl) return;

                            // Laufende Animationen abbrechen
                            view.cancelAnimations();

                            // Gespeicherten Kartenmittelpunkt wiederherstellen
                            // (wurde im onclick VOR openPdfPrinter gespeichert)
                            var savedCenter = window._printSavedCenter;
                            if (savedCenter) {
                                view.setCenter(savedCenter);
                            }

                            // Panel-Höhe als bottom-padding für den View
                            var mapRect = mapEl.getBoundingClientRect();
                            var panelRect = panel.getBoundingClientRect();
                            var panelH = mapRect.bottom - panelRect.top;
                            if (panelH < 0) panelH = 0;

                            // View-Padding setzen: [top, right, bottom, left]
                            view.padding = [0, 0, panelH, 0];

                            // Resolution für Druckmassstab 1:1000 berechnen
                            var mpu = view.getProjection().getMetersPerUnit() || 1;
                            var printRes = 1000 * 0.00028 / mpu;
                            // 2 Zoom-Stufen rauszoomen (Faktor 4)
                            var displayRes = printRes * 4;

                            // Resolution + Center setzen (ohne Animation)
                            view.setResolution(displayRes);
                            if (savedCenter) {
                                view.setCenter(savedCenter);
                            }
                        }, 700);
                    } else if (!isVisible && printPatchApplied) {
                        // Panel geschlossen → Padding zurücksetzen, Flag reset
                        printPatchApplied = false;
                        panel.style.removeProperty('height');
                        panel.style.removeProperty('min-height');
                        panel.style.removeProperty('max-height');
                        var map = window._olMap;
                        if (map) {
                            map.getView().padding = [0, 0, 0, 0];
                        }
                    }
                });
                obs.observe(panel, { attributes: true, attributeFilter: ['class'] });
            }
        })();

        // --- Mobile 3D Split: Vertikaler Divider-Drag ---
        // Überschreibt den Desktop-Resizer (col-resize) mit row-resize (vertikal)
        document.addEventListener('tnet-app-ready', function() {
            // Warten bis Landscape3D ggf. geladen wird
            var patchAttempts = 0;
            (function patchResizer() {
                if (window.Landscape3D && Landscape3D.setupResizer) {
                    var origSetup = Landscape3D.setupResizer.bind(Landscape3D);
                    Landscape3D.setupResizer = function() {
                        var divider = document.getElementById('split-divider-3d');
                        if (!divider) return;
                        var self = Landscape3D;

                        // Touch + Mouse Support für vertikales Drag
                        function onStart(e) {
                            self.isDragging = true;
                            var overlay = document.createElement('div');
                            overlay.id = 'drag-overlay-3d';
                            overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;cursor:row-resize;';
                            document.body.appendChild(overlay);

                            document.addEventListener('mousemove', onMove);
                            document.addEventListener('mouseup', onEnd);
                            document.addEventListener('touchmove', onMove, { passive: false });
                            document.addEventListener('touchend', onEnd);
                            e.preventDefault();
                        }

                        function onMove(e) {
                            if (!self.isDragging) return;
                            var wrapper = document.getElementById('split-wrapper-3d');
                            if (!wrapper) return;

                            var clientY = e.touches ? e.touches[0].clientY : e.clientY;
                            var rect = wrapper.getBoundingClientRect();
                            var pos = Math.max(20, Math.min(80, ((clientY - rect.top) / rect.height) * 100));

                            var top = document.getElementById('split-panel-2d');
                            var bottom = document.getElementById('split-panel-3d');
                            if (top && bottom) {
                                top.style.flex = pos.toString();
                                bottom.style.flex = (100 - pos).toString();
                                self.dividerPosition = pos;
                            }
                            self.resize2DMap();
                            if (e.cancelable) e.preventDefault();
                        }

                        function onEnd() {
                            self.isDragging = false;
                            var overlay = document.getElementById('drag-overlay-3d');
                            if (overlay) overlay.remove();
                            document.removeEventListener('mousemove', onMove);
                            document.removeEventListener('mouseup', onEnd);
                            document.removeEventListener('touchmove', onMove);
                            document.removeEventListener('touchend', onEnd);
                            self.resize2DMap();
                        }

                        divider.addEventListener('mousedown', onStart);
                        divider.addEventListener('touchstart', onStart, { passive: false });
                    };
                } else if (patchAttempts++ < 20) {
                    setTimeout(patchResizer, 500);
                }
            })();
        });
    });
});

function changemappluslang(langparam) {
    window.location = window.location.href.replace("lang=" + njs.AppManager.Language, "lang=" + langparam);
}
