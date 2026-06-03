/**
 * tnet-context-menu.js - Rechtsklick-Kontextmenü auf der Karte (ES Module)
 *
 * Enthält:
 * - Kontextmenü bei Rechtsklick (Koordinaten, Routing, StreetView, etc.)
 * - Marker-Funktion (Linksklick + Kontextmenü)
 * - Alle ctx*-Funktionen
 *
 * @version    1.0
 * @date       2026-02-12
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

import { lv95ToWgs84, showToast, waitForMapAndDOM } from './tnet-utils.js';

function getAppRoot() {
    return window.__TNET_APP_ROOT || '/maps';
}

// ===== RECHTSKLICK-KONTEXTMENÜ =====
var contextMenu = null;
var ctxCoordsDisplay = null;
var clickedCoords = null; // {lv95: [E, N], wgs84: [lon, lat], pixel: [x, y]}

// Menü ausblenden
    window.hideContextMenu = function() {
        if (contextMenu) contextMenu.classList.remove('show');
    };
    
    // Gemeinsame Marker-Funktion (wird von Linksklick UND Kontextmenü verwendet)
    function setMarkerAtPosition(coords) {
        if (!coords || !coords.lv95) return;
        
        if (njs && njs.AppManager && njs.AppManager.Maps && njs.AppManager.Maps['main']) {
            var mapWrapper = njs.AppManager.Maps['main'];
            var map = mapWrapper.mapObj;
            
            if (!map || typeof ol === 'undefined') return;
            
            // Marker-Layer erstellen falls nicht vorhanden
            if (!window.userMarkerLayer) {
                window.userMarkerLayer = new ol.layer.Vector({
                    source: new ol.source.Vector(),
                    zIndex: 999
                });
                map.addLayer(window.userMarkerLayer);
            }
            
            // Alten Marker entfernen (nur ein aktiver Marker)
            window.userMarkerLayer.getSource().clear();
            
            // Marker-Style mit externem SVG-Pin
            var markerStyle = new ol.style.Style({
                image: new ol.style.Icon({
                    anchor: [0.5, 70],
                    anchorXUnits: 'fraction',
                    anchorYUnits: 'pixels',
                    src: getAppRoot() + '/tnet/resources/icons/marker-pin.svg',
                    scale: 0.75
                })
            });
            
            var feature = new ol.Feature({
                geometry: new ol.geom.Point(coords.lv95),
                name: 'Marker',
                coords: coords
            });
            feature.setStyle(markerStyle);
            
            window.userMarkerLayer.getSource().addFeature(feature);
        }
    }
    
    // Globale Funktion für externe Aufrufe
    window.setMarkerAtPosition = setMarkerAtPosition;
    
    // Bei Klick außerhalb oder Escape schließen
    document.addEventListener('click', function(e) {
        if (contextMenu && !contextMenu.contains(e.target)) {
            hideContextMenu();
        }
    });
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') hideContextMenu();
    });
    
    // Map Rechtsklick — wartet auf Map + DOM-Elemente
    waitForMapAndDOM(function(mapWrapper) {
        contextMenu = document.getElementById('map-context-menu');
        ctxCoordsDisplay = document.getElementById('ctx-coords-display');

        var map = mapWrapper.mapObj; // OpenLayers Map
        if (!map) {
            console.error('Context Menu: OpenLayers map nicht gefunden');
            return;
        }
        
        var mapEl = document.getElementById('map');
        if (!mapEl) {
            console.error('Context Menu: Map Element nicht gefunden');
            return;
        }
        
        // console.log('Context Menu: Initialisiert auf', mapEl);
        
        // Event direkt auf das canvas Element mit capture
        function handleContextMenu(e) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            // Ctrl+Rechtsklick → Bookmark-Export Dialog
            if (e.ctrlKey) {
                showBookmarkExportDialog();
                return false;
            }
            
            // Pixel-Koordinaten
            var rect = mapEl.getBoundingClientRect();
            var pixel = [e.clientX - rect.left, e.clientY - rect.top];
            
            // Koordinaten aus Map holen (LV95)
            var coord = map.getCoordinateFromPixel(pixel);
            if (!coord) {
                // console.log('Context Menu: Keine Koordinaten');
                return false;
            }
            
            var lv95 = [Math.round(coord[0]), Math.round(coord[1])];
            var wgs84 = lv95ToWgs84(coord[0], coord[1]);
            
            clickedCoords = {
                lv95: lv95,
                wgs84: wgs84,
                pixel: pixel
            };
            
            // Koordinaten im Header anzeigen
            if (ctxCoordsDisplay) {
                ctxCoordsDisplay.textContent = lv95[0].toLocaleString('de-CH') + ' / ' + lv95[1].toLocaleString('de-CH');
            }
            
            // console.log('Context Menu: Koordinaten', lv95);
            
            // Position des Menüs
            var menuWidth = 240;
            var menuHeight = 380;
            var posX = e.clientX;
            var posY = e.clientY;
            
            // Am rechten Rand anpassen
            if (posX + menuWidth > window.innerWidth) {
                posX = window.innerWidth - menuWidth - 10;
            }
            // Am unteren Rand anpassen
            if (posY + menuHeight > window.innerHeight) {
                posY = window.innerHeight - menuHeight - 10;
            }
            
            contextMenu.style.left = posX + 'px';
            contextMenu.style.top = posY + 'px';
            contextMenu.classList.add('show');
            
            // console.log('Context Menu: Angezeigt');
            return false;
        }
        
        // Event auf mapEl mit capture:true (fängt Event vor OpenLayers)
        mapEl.addEventListener('contextmenu', handleContextMenu, true);
        
        // Auch auf document als Fallback
        document.addEventListener('contextmenu', function(e) {
            // Nur wenn innerhalb des Map-Containers
            if (mapEl.contains(e.target) || e.target === mapEl) {
                handleContextMenu(e);
            }
        }, true);
        
        // Linksklick auf Karte: Marker setzen
        map.on('singleclick', function(evt) {
            // Nicht wenn Polygon-Tool aktiv ist
            if (window.isPolygonDrawing) return;
            
            // Koordinaten aus Event
            var coord = evt.coordinate;
            if (!coord) return;
            
            var lv95 = [Math.round(coord[0]), Math.round(coord[1])];
            var wgs84 = lv95ToWgs84(coord[0], coord[1]);
            
            var coords = {
                lv95: lv95,
                wgs84: wgs84,
                pixel: evt.pixel
            };
            
            // Marker an Klickposition setzen
            setMarkerAtPosition(coords);
        });
    }, ['map-context-menu', 'map']);
    
    // Menü-Aktionen
    // ===== BOOKMARK-EXPORT DIALOG =====

    function buildBookmarkJson(id, name, aliases, opts) {
        opts = opts || {};
        var ignoreOpacity = !!opts.ignoreOpacity;
        var includeView   = !!opts.includeView;

        // Layer-Snapshot
        var layers = [];
        if (window.TnetLMStore && typeof window.TnetLMStore.getActiveLayers === 'function') {
            var active = window.TnetLMStore.getActiveLayers();
            for (var i = 0; i < active.length; i++) {
                var l = active[i];
                if (!l || !l.id) continue;
                var entry = { id: l.id };
                if (!ignoreOpacity && l.opacity !== undefined && l.opacity !== null && l.opacity !== 1) entry.opacity = l.opacity;
                if (l.visible === false) entry.visible = false;
                layers.push(entry);
            }
        }

        // Kartenausschnitt (nur wenn Option aktiv)
        var center = null, zoom = null;
        if (includeView) {
            try {
                var mapView = njs.AppManager.Maps['main'].mapObj.getView();
                center = mapView.getCenter().map(Math.round);
                zoom = mapView.getZoom();
            } catch (ex) {}
        }

        // Basemap
        var basemap = 'av_sw';
        try { basemap = window.BasemapTimeManager.currentBasemap || basemap; } catch (ex) {}

        // Farb-Modus
        var colorMode = 'color';
        try { colorMode = (window.__tnetActiveBookmark && window.__tnetActiveBookmark.basemapColorMode) || colorMode; } catch (ex) {}

        // Aliases parsen
        var aliasArr = aliases.split(',').map(function(a) { return a.trim(); }).filter(Boolean);

        var obj = {
            id: id,
            name: name || id,
            layers: layers,
            basemap: basemap,
            basemapColorMode: colorMode
        };
        if (aliasArr.length) obj.aliases = aliasArr;
        if (center) obj.center = center;
        if (zoom !== null) obj.zoom = zoom;
        return JSON.stringify(obj, null, 2);
    }

    function showBookmarkExportDialog() {
        // Modal einmalig erstellen
        var modal = document.getElementById('bm-export-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'bm-export-modal';
            modal.className = 'bm-export-modal';
            modal.innerHTML = [
                '<div class="bm-export-backdrop"></div>',
                '<div class="bm-export-dialog">',
                '  <div class="bm-export-header">',
                '    <span>Bookmark-Snippet erstellen</span>',
                '    <button class="bm-export-close" title="Schliessen">&#x2715;</button>',
                '  </div>',
                '  <div class="bm-export-body">',
                '    <label class="bm-export-label">ID <span class="bm-export-req">*</span><input class="bm-export-input" id="bm-exp-id" type="text" placeholder="Bookmark-ID vergeben" autocomplete="off"></label>',
                '    <label class="bm-export-label">Name (Anzeige)<input class="bm-export-input" id="bm-exp-name" type="text" placeholder="Wird mit ID vorausgefüllt" autocomplete="off"></label>',
                '    <label class="bm-export-label">Aliases <span class="bm-export-hint">(kommagetrennt)</span><input class="bm-export-input" id="bm-exp-aliases" type="text" placeholder="z.B. oereb, nw" autocomplete="off"></label>',
                '    <label class="bm-export-label">JSON-Vorschau<textarea class="bm-export-preview" id="bm-exp-preview" readonly></textarea></label>',
                '    <div class="bm-export-options">',
                '      <label class="bm-export-check"><input type="checkbox" id="bm-exp-ignore-opacity"> Opacity ignorieren</label>',
                '      <label class="bm-export-check"><input type="checkbox" id="bm-exp-include-view" checked> Zoom &amp; Center übernehmen</label>',
                '    </div>',
                '  </div>',
                '  <div class="bm-export-footer">',
                '    <button class="bm-export-btn-copy" id="bm-exp-copy">&#x2398; Kopieren</button>',
                '    <button class="bm-export-btn-slm" id="bm-exp-slm">Im SLM einfügen</button>',
                '  </div>',
                '</div>'
            ].join('');
            document.body.appendChild(modal);

            // Events einmalig binden
            modal.querySelector('.bm-export-backdrop').addEventListener('click', function() { modal.classList.remove('open'); });
            modal.querySelector('.bm-export-close').addEventListener('click', function() { modal.classList.remove('open'); });

            function updatePreview() {
                var id = document.getElementById('bm-exp-id').value.trim();
                var name = document.getElementById('bm-exp-name').value.trim() || id;
                var aliases = document.getElementById('bm-exp-aliases').value;
                var opts = {
                    ignoreOpacity: document.getElementById('bm-exp-ignore-opacity').checked,
                    includeView:   document.getElementById('bm-exp-include-view').checked
                };
                document.getElementById('bm-exp-preview').value = id ? buildBookmarkJson(id, name, aliases, opts) : '';
            }

            document.getElementById('bm-exp-id').addEventListener('input', function() {
                // Name mit ID vorausfüllen wenn Name noch leer
                var nameInput = document.getElementById('bm-exp-name');
                if (!nameInput.dataset.userEdited) nameInput.value = this.value;
                updatePreview();
            });
            document.getElementById('bm-exp-name').addEventListener('input', function() {
                this.dataset.userEdited = this.value ? '1' : '';
                updatePreview();
            });
            document.getElementById('bm-exp-aliases').addEventListener('input', updatePreview);
            document.getElementById('bm-exp-ignore-opacity').addEventListener('change', updatePreview);
            document.getElementById('bm-exp-include-view').addEventListener('change', updatePreview);

            document.getElementById('bm-exp-copy').addEventListener('click', function() {
                var json = document.getElementById('bm-exp-preview').value;
                if (!json) { showToast('Bitte zuerst eine ID eingeben.'); return; }
                navigator.clipboard.writeText(json).then(function() { showToast('JSON kopiert!'); });
            });

            document.getElementById('bm-exp-slm').addEventListener('click', function() {
                var json = document.getElementById('bm-exp-preview').value;
                if (!json) { showToast('Bitte zuerst eine ID eingeben.'); return; }
                localStorage.setItem('tnet-bm-import-pending', json);
                window.open(getAppRoot() + '/tnet/api/v1/slm.html#bookmarks', '_blank');
                modal.classList.remove('open');
            });
        }

        // Felder zurücksetzen
        var idInput = document.getElementById('bm-exp-id');
        var nameInput = document.getElementById('bm-exp-name');
        var aliasInput = document.getElementById('bm-exp-aliases');
        // Mit Aktiv-Bookmark vorausfüllen falls vorhanden
        var bm = window.__tnetActiveBookmark;
        idInput.value = (bm && bm.id) ? bm.id : '';
        nameInput.value = (bm && bm.name) ? bm.name : '';
        nameInput.dataset.userEdited = nameInput.value ? '1' : '';
        aliasInput.value = (bm && bm.aliases && bm.aliases.length) ? bm.aliases.join(', ') : '';
        // JSON-Vorschau initial
        var id = idInput.value;
        var initOpts = {
            ignoreOpacity: document.getElementById('bm-exp-ignore-opacity').checked,
            includeView:   document.getElementById('bm-exp-include-view').checked
        };
        document.getElementById('bm-exp-preview').value = id ? buildBookmarkJson(id, nameInput.value, aliasInput.value, initOpts) : '';

        modal.classList.add('open');
        idInput.focus();
    }

    // Ctrl+Rechtsklick auch auf dem Sidepanel (Karteninhalt-Bereich)
    document.addEventListener('contextmenu', function(e) {
        if (!e.ctrlKey) return;
        var spring = document.getElementById('spring');
        if (!spring || !spring.contains(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        showBookmarkExportDialog();
    }, true);

    window.ctxCopyCoords = function(format) {
        if (!clickedCoords) return;
        var text;
        if (format === 'lv95') {
            // Versuche zuerst aus bestehendem Input-Feld zu lesen
            var lv95Input = document.getElementById('xy_coord2');
            if (lv95Input && lv95Input.value) {
                text = lv95Input.value;
            } else {
                text = clickedCoords.lv95[0] + ', ' + clickedCoords.lv95[1];
            }
            showToast('LV95 kopiert: ' + text);
        } else {
            // Versuche zuerst aus bestehendem Input-Feld zu lesen
            var wgs84Input = document.getElementById('xy_coord3');
            if (wgs84Input && wgs84Input.value) {
                text = wgs84Input.value;
            } else {
                text = clickedCoords.wgs84[1].toFixed(6) + ', ' + clickedCoords.wgs84[0].toFixed(6);
            }
            showToast('WGS84 kopiert: ' + text);
        }
        navigator.clipboard.writeText(text);
        hideContextMenu();
    };
    
    // Koordinaten fixieren (Picker toggle)
    window.ctxFixCoords = function() {
        hideContextMenu();
        // Toggle den CoordDisplay Picker
        if (njs && njs.AppManager && njs.AppManager.Tools && 
            njs.AppManager.Tools.CoordDisplay && 
            njs.AppManager.Tools.CoordDisplay['map'] && 
            njs.AppManager.Tools.CoordDisplay['map']['coord2']) {
            njs.AppManager.Tools.CoordDisplay['map']['coord2'].togglePicker('map');
            showToast('Koordinaten-Anzeige fixiert');
        } else {
            // Fallback: Klick auf Picker-Button simulieren
            var pickerBtn = document.getElementById('coord2_picker');
            if (pickerBtn) {
                pickerBtn.click();
                showToast('Koordinaten-Anzeige fixiert');
            }
        }
    };
    
    window.ctxWhatIsHere = function() {
        if (!clickedCoords) return;
        hideContextMenu();
        
        // Marker setzen an der Position
        setMarkerAtPosition(clickedCoords);
        
        // Feature-Info an Position abfragen (simuliere Linksklick)
        if (njs && njs.AppManager && njs.AppManager.Maps && njs.AppManager.Maps['main']) {
            var mapWrapper = njs.AppManager.Maps['main'];
            var map = mapWrapper.mapObj;
            
            if (map) {
                // Simuliere singleclick Event an der Position
                map.dispatchEvent({
                    type: 'singleclick', 
                    coordinate: clickedCoords.lv95, 
                    pixel: clickedCoords.pixel,
                    originalEvent: { preventDefault: function(){}, stopPropagation: function(){} }
                });
            }
        }
    };
    
    window.ctxZoomHere = function() {
        if (!clickedCoords) return;
        hideContextMenu();
        if (njs && njs.AppManager && njs.AppManager.Maps && njs.AppManager.Maps['main']) {
            var map = njs.AppManager.Maps['main'].mapObj;
            if (map) {
                var view = map.getView();
                view.animate({
                    center: clickedCoords.lv95,
                    zoom: Math.max(view.getZoom() + 2, 15),
                    duration: 500
                });
            }
        }
    };
    
    window.ctxSetMarker = function() {
        if (!clickedCoords) return;
        hideContextMenu();
        setMarkerAtPosition(clickedCoords);
        showToast('Marker gesetzt');
    };
    
    window.ctxRouteFrom = function() {
        if (!clickedCoords) return;
        hideContextMenu();
        // Routing-Start setzen
        showToast('Start-Position gesetzt: ' + clickedCoords.lv95[0] + ', ' + clickedCoords.lv95[1]);
        window.routeStartCoords = clickedCoords;
        // Falls Routing-Modul vorhanden
        if (njs && njs.AppManager && njs.AppManager.getModule) {
            var routing = njs.AppManager.getModule('routing');
            if (routing && routing.setStart) {
                routing.setStart(clickedCoords.lv95);
            }
        }
    };
    
    window.ctxRouteTo = function() {
        if (!clickedCoords) return;
        hideContextMenu();
        // Routing-Ziel setzen
        showToast('Ziel-Position gesetzt: ' + clickedCoords.lv95[0] + ', ' + clickedCoords.lv95[1]);
        window.routeEndCoords = clickedCoords;
        // Falls Routing-Modul vorhanden
        if (njs && njs.AppManager && njs.AppManager.getModule) {
            var routing = njs.AppManager.getModule('routing');
            if (routing && routing.setEnd) {
                routing.setEnd(clickedCoords.lv95);
            }
        }
    };
    
    window.ctxOpenGoogleMaps = function() {
        if (!clickedCoords) return;
        hideContextMenu();
        var lat = clickedCoords.wgs84[1].toFixed(6);
        var lon = clickedCoords.wgs84[0].toFixed(6);
        var url = 'https://www.google.com/maps?q=' + lat + ',' + lon + '&z=18';
        window.open(url, '_blank');
    };
    
    window.ctxOpenStreetView = function() {
        if (!clickedCoords) return;
        hideContextMenu();
        
        // Nutze das bestehende StreetView-Tool von njs
        if (njs && njs.AppManager && njs.AppManager.Tools && njs.AppManager.Tools.StreetView && njs.AppManager.Tools.StreetView['main']) {
            var svTool = njs.AppManager.Tools.StreetView['main'];
            var container = document.getElementById('streetviewContainer');
            var isVisible = container && container.style.display !== 'none' && container.offsetWidth > 0;
            
            if (isVisible) {
                // StreetView ist bereits offen - schliessen und mit neuer Position wieder öffnen
                svTool.toggleView(false); // Schliessen
                setTimeout(function() {
                    svTool.toggleView(true); // Mit neuer Position öffnen
                }, 100);
            } else {
                // StreetView ist geschlossen - normal öffnen
                svTool.toggleView(true);
            }
        } else {
            // Fallback: Google StreetView direkt öffnen
            var lat = clickedCoords.wgs84[1].toFixed(6);
            var lon = clickedCoords.wgs84[0].toFixed(6);
            var url = 'https://www.google.com/maps?layer=c&cbll=' + lat + ',' + lon;
            window.open(url, '_blank');
        }
    };
    
    window.ctxCopyLink = function() {
        hideContextMenu();
        // Einfach die aktuelle URL kopieren (enthält bereits alle Parameter)
        var currentUrl = window.location.href;
        navigator.clipboard.writeText(currentUrl);
        showToast('URL kopiert!');
    };
    
    window.ctxMailLink = function() {
        hideContextMenu();
        var currentUrl = window.location.href;
        var subject = encodeURIComponent('Kartenposition');
        var body = encodeURIComponent('Schau dir diese Position an:\n\n' + currentUrl);
        window.location.href = 'mailto:?subject=' + subject + '&body=' + body;
    };
