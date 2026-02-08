/**
 * tnet-oereb.js (ES Module) - ÖREB Grundstückabfrage
 * 
 * Enthält:
 * - ÖREB-Button auf der Karte (Klick-Modus aktivieren)
 * - Klick auf Karte → EGRID(s) von geo.admin.ch API holen
 * - Multi-EGRID: Auswahlliste mit Fläche & Gemeinde bei mehreren Grundstücken
 * - Grundstück auf Karte hervorheben
 * - Dock-Panel rechts (ab-/andockbar) mit iframe (ÖREB-Auszug von gis-daten.ch)
 * - Interaktions-Unterdrückung während ÖREB-Modus
 */

import { waitForMap, getMainMap, showToast } from './tnet-utils.js';

// ===== CONFIG =====
var OEREB_IFRAME_BASE = 'https://www.gis-daten.ch/app/oereb/graphicsLayerOereb-nw.html';
var OEREB_IFRAME_PARAMS = 'folder=nwow&site=maps&uprofile=public&ugroup=public';

// Gemeinde-Mapping (identdn-Prefix → Gemeindename)
var GEMEINDE_MAP = {
    'OW0200001401': 'Sarnen',
    'OW0200001402': 'Alpnach',
    'OW0200001403': 'Giswil',
    'OW0200001404': 'Kerns',
    'OW0200001405': 'Lungern',
    'OW0200001406': 'Sachseln',
    'OW0200001407': 'Engelberg',
    'NW0200001321': 'Stans',
    'NW0200001322': 'Stansstad',
    'NW0200001323': 'Buochs',
    'NW0200001324': 'Ennetbürgen',
    'NW0200001325': 'Hergiswil',
    'NW0200001326': 'Beckenried',
    'NW0200001327': 'Emmetten',
    'NW0200001328': 'Wolfenschiessen',
    'NW0200001329': 'Dallenwil',
    'NW0200001330': 'Oberdorf',
    'NW0200001331': 'Ennetmoos'
};

// ===== STATE =====
var oerebActive = false;
var oerebClickListener = null;
var oerebHighlightLayer = null;
var currentResults = null;

// Globaler Flag für andere Module (analog isPolygonDrawing)
window.isOerebActive = false;
window.isOerebPanelDocked = true; // Default: angedockt rechts

// Cleanup-Timer für njs-Highlight-Unterdrückung
var _njsHighlightCleanupTimer = null;
// Kontinuierlicher Interval zum Leeren von cosmetic_maptip
var _njsHighlightSuppressionInterval = null;
// Referenz auf Objektinfo-Highlight-Layer (wenn gefunden)
var _njsInfoHighlightLayer = null;
var _njsInfoHighlightWasVisible = true;
var _njsInfoHighlightLogged = false;
var _njsInfoHighlightLayers = [];
// Gespeicherte Features vor dem Leeren
var _njsInfoHighlightFeatures = [];

// ===== HILFSFUNKTIONEN =====

/** Fläche eines Polygons berechnen (Shoelace) in m² */
function calcPolygonArea(coords) {
    var n = coords.length;
    var area = 0;
    for (var i = 0; i < n; i++) {
        var j = (i + 1) % n;
        area += coords[i][0] * coords[j][1];
        area -= coords[j][0] * coords[i][1];
    }
    return Math.abs(area) / 2;
}

/** Fläche aus GeoJSON-Geometrie berechnen */
function getArea(geom) {
    if (!geom || !geom.coordinates) return 0;
    if (geom.type === 'Polygon') {
        return calcPolygonArea(geom.coordinates[0]);
    } else if (geom.type === 'MultiPolygon') {
        var total = 0;
        geom.coordinates.forEach(function(poly) { total += calcPolygonArea(poly[0]); });
        return total;
    }
    return 0;
}

/** Fläche formatieren */
function formatArea(m2) {
    if (m2 <= 0) return '';
    if (m2 >= 10000) return (m2 / 10000).toFixed(2) + ' ha';
    return Math.round(m2).toLocaleString('de-CH') + ' m²';
}

/** Gemeinde aus identnd ableiten */
function getGemeinde(identnd) {
    if (!identnd) return '';
    return GEMEINDE_MAP[identnd] || '';
}

/** Typ erkennen: Nummer in Klammern = Baurecht, sonst Liegenschaft */
function detectType(nummer, realestate_type) {
    if (realestate_type) return realestate_type;
    if (nummer && /^\(.*\)$/.test(String(nummer).trim())) return 'Baurecht';
    return 'Liegenschaft';
}

// ===== ÖREB MODUS TOGGLE =====
window.toggleOerebMode = function() {
    if (oerebActive) {
        deactivateOereb();
    } else {
        activateOereb();
    }
};

function activateOereb() {
    oerebActive = true;
    window.isOerebActive = true;
    var btn = document.getElementById('oereb-tool-btn');
    if (btn) btn.classList.add('active');

    // Polygon-Tool deaktivieren falls aktiv
    if (window.isPolygonDrawing && typeof window.togglePolygonDraw === 'function') {
        window.togglePolygonDraw();
    }

    // Interaktionen unterdrücken (analog drawing-mode)
    document.body.classList.add('oereb-mode');

    // Cursor ändern
    var mapEl = document.getElementById('map');
    if (mapEl) mapEl.style.cursor = 'crosshair';

    // Dock-Panel zeigen mit Hinweis
    showOerebDockPanel();
    setOerebSelection('<div class="oereb-info-text">Klicken Sie auf ein Grundstück in der Karte...</div>');
    clearOerebIframe();

    // Klick-Listener registrieren (callback-basiert!)
    waitForMap(function(map) {
        // Bestehende njs-Highlights entfernen
        clearNjsHighlights(map);

        // KONTINUIERLICH cosmetic_maptip leeren (alle 100ms) - stoppt bei deactivateOereb
        if (_njsHighlightSuppressionInterval) clearInterval(_njsHighlightSuppressionInterval);
        _njsHighlightSuppressionInterval = setInterval(function() {
            if (!window.isOerebActive) return;
            suppressInfoHighlightLayer(map);
        }, 100);

        oerebClickListener = map.on('singleclick', function(evt) {
            handleOerebClick(evt.coordinate, map);
            // njs-Identify feuert parallel → verzögert aufräumen
            scheduleNjsHighlightCleanup(map);
        });
    });
}

function deactivateOereb() {
    oerebActive = false;
    window.isOerebActive = false;
    var btn = document.getElementById('oereb-tool-btn');
    if (btn) btn.classList.remove('active');

    // Interaktionen wiederherstellen
    document.body.classList.remove('oereb-mode');

    // Cursor zurücksetzen
    var mapEl = document.getElementById('map');
    if (mapEl) mapEl.style.cursor = '';

    // Klick-Listener entfernen
    if (oerebClickListener) {
        ol.Observable.unByKey(oerebClickListener);
        oerebClickListener = null;
    }

    // Cleanup-Timer stoppen
    if (_njsHighlightCleanupTimer) {
        clearTimeout(_njsHighlightCleanupTimer);
        _njsHighlightCleanupTimer = null;
    }
    
    // Kontinuierlichen Suppression-Interval stoppen
    if (_njsHighlightSuppressionInterval) {
        clearInterval(_njsHighlightSuppressionInterval);
        _njsHighlightSuppressionInterval = null;
    }

    // Objektinfo-Highlight-Layer Features NICHT wiederherstellen (bleiben gelöscht)
    // Speichern wurde nur für Zwischenspeicherung, aber nicht beim Deactivate zurückgeben
    _njsInfoHighlightFeatures = [];
    _njsInfoHighlightLogged = false; // Für nächste Aktivierung
    
    if (_njsInfoHighlightLayers.length) {
        _njsInfoHighlightLayers.forEach(function(item) {
            item.layer.setVisible(item.wasVisible);
        });
        _njsInfoHighlightLayers = [];
    } else if (_njsInfoHighlightLayer) {
        _njsInfoHighlightLayer.setVisible(_njsInfoHighlightWasVisible);
    }

    // Highlight entfernen
    clearOerebHighlight();

    // ÖREB-Daten und UI komplett clearen
    currentResults = null;
    setOerebSelection('');
    clearOerebIframe();
    window.isOerebPanelDocked = true;  // Auf Standard zurücksetzen

    // Panel schliessen
    hideOerebDockPanel();
}

// ===== KLICK-HANDLER =====
function handleOerebClick(coordinate, map) {
    var x = Math.round(coordinate[0]);
    var y = Math.round(coordinate[1]);

    // Ladeanzeige
    setOerebSelection('<div class="oereb-info-text"><div class="loading-spinner"></div> Grundstück wird abgefragt...</div>');
    clearOerebIframe();
    clearOerebHighlight();

    // geo.admin.ch API abfragen
    var url = 'https://api3.geo.admin.ch/rest/services/ech/MapServer/identify'
        + '?geometryType=esriGeometryPoint'
        + '&geometry=' + x + ',' + y
        + '&tolerance=0'
        + '&layers=all:ch.kantone.cadastralwebmap-farbe'
        + '&returnGeometry=true'
        + '&sr=2056'
        + '&geometryFormat=geojson';

    fetch(url)
        .then(function(response) {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.json();
        })
        .then(function(data) {
            if (!data.results || data.results.length === 0) {
                setOerebSelection('<div class="oereb-info-text">Kein Grundstück gefunden an dieser Position.</div>');
                return;
            }

            currentResults = data.results;

            if (data.results.length === 1) {
                // Einziges Ergebnis → direkt anzeigen
                selectOerebResult(data.results[0], map);
            } else {
                // Mehrere Ergebnisse → Auswahlliste
                showOerebResultList(data.results, map);
            }
        })
        .catch(function(err) {
            setOerebSelection('<div class="oereb-info-text oereb-error">Fehler: ' + err.message + '</div>');
        });
}

// ===== ERGEBNIS AUSWÄHLEN =====
function selectOerebResult(result, map) {
    var props = result.properties || result.attributes;
    var egrid = props.egris_egrid || '';
    var nummer = props.number || '?';
    var kanton = props.ak || '?';
    var identnd = props.identnd || '';
    var typ = detectType(nummer, props.realestate_type);
    var gemeinde = getGemeinde(identnd);
    var area = getArea(result.geometry);

    // Kompakte Info-Zeile
    var html = '<div class="oereb-selected-info">';
    html += '<div class="oereb-sel-row">';
    html += '<span class="oereb-sel-label">Parzelle ' + nummer + '</span>';
    html += '<span class="oereb-sel-egrid">' + egrid + '</span>';
    html += '<span class="oereb-sel-kanton">' + kanton + '</span>';
    html += '<span class="oereb-sel-typ">' + typ + '</span>';
    html += '</div>';
    // Zweite Zeile: Gemeinde + Fläche
    if (gemeinde || area > 0) {
        html += '<div class="oereb-sel-row2">';
        if (gemeinde) html += '<span class="oereb-sel-gemeinde">' + gemeinde + '</span>';
        if (area > 0) html += '<span class="oereb-sel-area">' + formatArea(area) + '</span>';
        html += '</div>';
    }

    // Mehrere Ergebnisse? → Zurück-Button
    if (currentResults && currentResults.length > 1) {
        html += '<button class="oereb-back-btn" id="oereb-back-btn">◀ Alle ' + currentResults.length + ' Grundstücke</button>';
    }

    html += '</div>';
    setOerebSelection(html);

    // Zurück-Button Handler
    if (currentResults && currentResults.length > 1) {
        var backBtn = document.getElementById('oereb-back-btn');
        if (backBtn) {
            backBtn.addEventListener('click', function() {
                waitForMap(function(m) { showOerebResultList(currentResults, m); });
            });
        }
    }

    // Geometrie highlighten
    if (result.geometry) {
        highlightOerebParcel(result.geometry, map);
    }

    // iframe laden
    if (egrid) {
        loadOerebIframe(egrid, typ);
    }
}

// ===== AUSWAHLLISTE (mehrere EGRID) =====
function showOerebResultList(results, map) {
    var html = '<div class="oereb-multi-header">' + results.length + ' Grundstücke gefunden – bitte wählen:</div>';
    html += '<div class="oereb-result-list">';

    results.forEach(function(r, i) {
        var props = r.properties || r.attributes;
        var egrid = props.egris_egrid || '?';
        var nummer = props.number || '?';
        var typ = detectType(nummer, props.realestate_type);
        var kanton = props.ak || '';
        var identnd = props.identnd || '';
        var gemeinde = getGemeinde(identnd);
        var area = getArea(r.geometry);

        html += '<div class="oereb-result-item" data-index="' + i + '">';
        html += '<div class="oereb-ri-main">';
        html += '<span class="oereb-ri-nr">Nr. ' + nummer + '</span>';
        html += '<span class="oereb-ri-typ">' + typ + '</span>';
        if (kanton) html += '<span class="oereb-ri-kanton">' + kanton + '</span>';
        html += '</div>';
        html += '<div class="oereb-ri-details">';
        html += '<span class="oereb-ri-egrid">' + egrid + '</span>';
        if (gemeinde) html += '<span class="oereb-ri-gemeinde">' + gemeinde + '</span>';
        if (area > 0) html += '<span class="oereb-ri-area">' + formatArea(area) + '</span>';
        html += '</div>';
        html += '</div>';
    });
    html += '</div>';

    setOerebSelection(html);
    clearOerebIframe();

    // Klick-Handler für Auswahl
    var container = document.getElementById('oereb-selection');
    if (container) {
        container.querySelectorAll('.oereb-result-item').forEach(function(item) {
            item.addEventListener('click', function() {
                var idx = parseInt(item.getAttribute('data-index'));
                selectOerebResult(results[idx], map);
            });
        });
    }
}

// ===== IFRAME =====
function loadOerebIframe(egrid, typ) {
    var iframe = document.getElementById('oereb-iframe');
    if (!iframe) return;

    var src = OEREB_IFRAME_BASE
        + '?typ=' + encodeURIComponent(typ || 'Liegenschaft')
        + '&EGRID=' + encodeURIComponent(egrid)
        + '&' + OEREB_IFRAME_PARAMS;

    iframe.src = src;
}

function clearOerebIframe() {
    var iframe = document.getElementById('oereb-iframe');
    if (iframe) iframe.src = 'about:blank';
}

// ===== NJS-FRAMEWORK HIGHLIGHT UNTERDRÜCKUNG =====
/** Features aus allen nicht-ÖREB Vector-Layern entfernen (gezielt, kein Verstecken) */
function clearNjsHighlights(map) {
    if (!map) return;
    map.getLayers().forEach(function(layer) {
        if (!(layer instanceof ol.layer.Vector)) return;
        var name = (layer.get('name') || '').toString().toLowerCase();
        var id = (layer.get('id') || '').toString();
        if (layer === oerebHighlightLayer) return;
        if (layer.get('isOereb')) return;
        if (id === 'OerebGraphics') return;
        if (layer.getSource() && typeof layer.getSource().clear === 'function') {
            // Objektinfo-Layer gezielt leeren (cosmetic_maptip)
            if (name === 'cosmetic_maptip') {
                layer.getSource().clear();
                return;
            }
        }
    });
}

/** Verzögertes Aufräumen nach Klick (njs-Identify ist asynchron) */
function scheduleNjsHighlightCleanup(map) {
    if (_njsHighlightCleanupTimer) clearTimeout(_njsHighlightCleanupTimer);
    _njsHighlightCleanupTimer = setTimeout(function() {
        if (!window.isOerebActive) return;
        clearNjsHighlights(map);
        suppressInfoHighlightLayer(map);
    }, 400);
}

/** Objektinfo-Highlight-Layer erkennen und Features leeren (gezielt) */
function suppressInfoHighlightLayer(map) {
    if (!map) return;
    
    var layers = map.getLayers().getArray();
    var found = false;
    
    // Suche cosmetic_maptip Layer und leere Features
    for (var i = 0; i < layers.length; i++) {
        var layer = layers[i];
        if (!(layer instanceof ol.layer.Vector)) continue;
        var name = (layer.get('name') || '').toString().toLowerCase();
        var id = (layer.get('id') || '').toString();
        
        // Ignoriere ÖREB-Layer
        if (layer === oerebHighlightLayer || layer.get('isOereb') || id === 'OerebGraphics') continue;
        
        // Leere cosmetic_maptip Layer
        if (name === 'cosmetic_maptip' && layer.getSource()) {
            var features = layer.getSource().getFeatures();
            if (features.length > 0) {
                // Speichere Features bevor wir sie leeren (aber nur einmal pro Objekt)
                features.forEach(function(feature) {
                    var alreadySaved = _njsInfoHighlightFeatures.some(function(item) { 
                        return item.feature === feature; 
                    });
                    if (!alreadySaved) {
                        _njsInfoHighlightFeatures.push({ layer: layer, feature: feature });
                    }
                });
                layer.getSource().clear();
                found = true;
                // Log nur beim ersten Mal - dann ist die cosmetic_maptip leer und wir brauchen kein Spam
                if (!_njsInfoHighlightLogged && _njsInfoHighlightFeatures.length > 0) {
                    _njsInfoHighlightLogged = true;
                    console.log('[ÖREB] Objektinfo-Unterdrückung aktiv: ' + _njsInfoHighlightFeatures.length + ' Features zwischengespeichert');
                }
            }
        }
    }
}

// ===== HIGHLIGHT =====
function highlightOerebParcel(geojsonGeom, map) {
    clearOerebHighlight();

    if (!oerebHighlightLayer) {
        oerebHighlightLayer = new ol.layer.Vector({
            source: new ol.source.Vector(),
            zIndex: 998,
            properties: { isOereb: true },
            style: new ol.style.Style({
                fill: new ol.style.Fill({ color: 'rgba(255, 200, 0, 0.3)' }),
                stroke: new ol.style.Stroke({ color: '#e8423f', width: 3 })
            })
        });
        map.addLayer(oerebHighlightLayer);
    }

    var format = new ol.format.GeoJSON();
    var feature = format.readFeature({
        type: 'Feature',
        geometry: geojsonGeom
    }, {
        dataProjection: 'EPSG:2056',
        featureProjection: map.getView().getProjection()
    });

    oerebHighlightLayer.getSource().addFeature(feature);

    // Auf Parzelle zoomen/pannen
    var extent = feature.getGeometry().getExtent();
    if (extent && !ol.extent.isEmpty(extent)) {
        map.getView().fit(extent, {
            padding: [60, 60, 60, 60],
            duration: 600,
            maxZoom: 18
        });
    }
}

function clearOerebHighlight() {
    if (oerebHighlightLayer) {
        oerebHighlightLayer.getSource().clear();
    }
}

// ===== DOCK-PANEL (identisch mit Objektinfo-Logik) =====
var savedOerebPanePosition = null;
var oerebMapContainerObserver = null;
var oerebStreetviewObserver = null;
var _savedOerebDockedWidth = 440;

function triggerMapUpdate() {
    setTimeout(function() {
        if (window.njs && njs.AppManager && njs.AppManager.Maps && njs.AppManager.Maps['main']) {
            var mapObj = njs.AppManager.Maps['main'].mapObj;
            if (mapObj && mapObj.updateSize) {
                mapObj.updateSize();
            }
        }
        if (typeof dijit !== 'undefined' && dijit.byId('NeapolisContainer')) {
            dijit.byId('NeapolisContainer').resize();
        }
    }, 350);
}

function showOerebDockPanel() {
    var panel = document.getElementById('oereb-dock-panel');
    if (!panel) return;
    panel.classList.remove('hidden');
    // Default = angedockt
    if (window.isOerebPanelDocked) {
        dockOerebPanel();
    }
}

function hideOerebDockPanel() {
    var panel = document.getElementById('oereb-dock-panel');
    if (!panel) return;
    // Falls angedockt: mapContainer zurücksetzen
    if (window.isOerebPanelDocked) {
        var mapContainer = document.getElementById('mapContainer');
        if (mapContainer) {
            mapContainer.style.setProperty('width', '100%', 'important');
            triggerMapUpdate();
        }
        stopOerebObservers();
    }
    panel.classList.add('hidden');
}

window.closeOerebPanel = function() {
    deactivateOereb();
};

function setOerebSelection(html) {
    var el = document.getElementById('oereb-selection');
    if (el) el.innerHTML = html;
}

// ===== DOCK / UNDOCK (identisch mit toggleInfoPaneDock) =====
function dockOerebPanel() {
    var panel = document.getElementById('oereb-dock-panel');
    var dockBtn = document.getElementById('oereb-dock-btn');
    var mapContainer = document.getElementById('mapContainer');
    if (!panel) return;

    panel.classList.add('docked-right');

    if (mapContainer) {
        var panelWidth = _savedOerebDockedWidth || 440;
        var centerPane = document.getElementById('centerPaneLayout');
        var streetviewContainer = document.getElementById('streetviewContainer');
        var streetviewWidth = 0;
        if (streetviewContainer && streetviewContainer.offsetWidth > 0 && streetviewContainer.style.display !== 'none') {
            streetviewWidth = streetviewContainer.offsetWidth;
        }
        var centerRect = centerPane ? centerPane.getBoundingClientRect() : mapContainer.getBoundingClientRect();
        panel.style.setProperty('position', 'fixed', 'important');
        panel.style.setProperty('top', centerRect.top + 'px', 'important');
        panel.style.setProperty('right', streetviewWidth + 'px', 'important');
        panel.style.setProperty('bottom', (window.innerHeight - centerRect.bottom) + 'px', 'important');
        panel.style.setProperty('left', 'auto', 'important');
        panel.style.setProperty('width', panelWidth + 'px', 'important');
        panel.style.setProperty('height', 'auto', 'important');

        var centerPaneWidth = centerPane ? centerPane.offsetWidth : window.innerWidth;
        var mapWidth = centerPaneWidth - streetviewWidth - panelWidth;
        mapContainer.style.setProperty('width', mapWidth + 'px', 'important');
        triggerMapUpdate();
    }
    startOerebObservers();

    if (dockBtn) {
        dockBtn.title = 'Floating';
        dockBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z"/></svg>';
    }
    window.isOerebPanelDocked = true;
}

function undockOerebPanel() {
    var panel = document.getElementById('oereb-dock-panel');
    var dockBtn = document.getElementById('oereb-dock-btn');
    var mapContainer = document.getElementById('mapContainer');
    if (!panel) return;

    panel.classList.remove('docked-right');
    stopOerebObservers();

    // mapContainer wieder auf volle Breite
    if (mapContainer) {
        mapContainer.style.setProperty('width', '100%', 'important');
        setTimeout(function() { triggerMapUpdate(); }, 100);
    }

    // Floating-Position wiederherstellen oder Default
    if (savedOerebPanePosition) {
        panel.style.setProperty('top', savedOerebPanePosition.top, 'important');
        panel.style.setProperty('left', savedOerebPanePosition.left, 'important');
        panel.style.setProperty('width', savedOerebPanePosition.width, 'important');
        panel.style.setProperty('height', savedOerebPanePosition.height, 'important');
    } else {
        panel.style.setProperty('top', '80px', 'important');
        panel.style.setProperty('left', 'calc(100vw - 500px)', 'important');
        panel.style.setProperty('width', '440px', 'important');
        panel.style.setProperty('height', 'calc(100vh - 160px)', 'important');
    }
    panel.style.setProperty('right', 'auto', 'important');
    panel.style.setProperty('bottom', 'auto', 'important');
    panel.style.setProperty('position', 'fixed', 'important');
    panel.style.maxHeight = '';

    if (dockBtn) {
        dockBtn.title = 'Rechts andocken';
        dockBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16h-4V5h4v14z"/></svg>';
    }
    window.isOerebPanelDocked = false;
}

window.toggleOerebDock = function() {
    if (window.isOerebPanelDocked) {
        // Position speichern
        var panel = document.getElementById('oereb-dock-panel');
        if (panel) {
            savedOerebPanePosition = {
                top: '80px',
                left: 'calc(100vw - 500px)',
                width: '440px',
                height: 'calc(100vh - 160px)'
            };
        }
        undockOerebPanel();
    } else {
        // Floating-Position speichern
        var panel = document.getElementById('oereb-dock-panel');
        if (panel) {
            savedOerebPanePosition = {
                top: panel.style.top || '80px',
                left: panel.style.left || 'calc(100vw - 500px)',
                width: panel.style.width || '440px',
                height: panel.style.height || 'calc(100vh - 160px)'
            };
        }
        dockOerebPanel();
    }
};

// ===== OBSERVER (identisch mit Objektinfo) =====
function startOerebObservers() {
    if (oerebMapContainerObserver) oerebMapContainerObserver.disconnect();
    if (oerebStreetviewObserver) oerebStreetviewObserver.disconnect();

    var mapContainer = document.getElementById('mapContainer');
    var streetviewContainer = document.getElementById('streetviewContainer');
    if (!mapContainer) return;

    if (window.ResizeObserver) {
        oerebMapContainerObserver = new ResizeObserver(function() {
            if (!window.isOerebPanelDocked) return;
            updateDockedOerebPosition();
        });
        oerebMapContainerObserver.observe(mapContainer);

        if (streetviewContainer) {
            oerebStreetviewObserver = new ResizeObserver(function() {
                if (!window.isOerebPanelDocked) return;
                updateDockedOerebPosition();
            });
            oerebStreetviewObserver.observe(streetviewContainer);
        }
    }
    window.addEventListener('resize', updateDockedOerebPosition);
}

function stopOerebObservers() {
    if (oerebMapContainerObserver) { oerebMapContainerObserver.disconnect(); oerebMapContainerObserver = null; }
    if (oerebStreetviewObserver) { oerebStreetviewObserver.disconnect(); oerebStreetviewObserver = null; }
    window.removeEventListener('resize', updateDockedOerebPosition);
}

function updateDockedOerebPosition() {
    if (!window.isOerebPanelDocked) return;
    var panel = document.getElementById('oereb-dock-panel');
    var mapContainer = document.getElementById('mapContainer');
    var centerPane = document.getElementById('centerPaneLayout');
    var streetviewContainer = document.getElementById('streetviewContainer');
    if (!panel || !mapContainer || panel.classList.contains('hidden')) return;

    var panelWidth = _savedOerebDockedWidth || panel.offsetWidth || 440;
    var streetviewWidth = 0;
    if (streetviewContainer && streetviewContainer.offsetWidth > 0 && streetviewContainer.style.display !== 'none') {
        streetviewWidth = streetviewContainer.offsetWidth;
    }

    var centerRect = centerPane ? centerPane.getBoundingClientRect() : { top: 69, bottom: window.innerHeight - 32 };
    panel.style.setProperty('top', centerRect.top + 'px', 'important');
    panel.style.setProperty('right', streetviewWidth + 'px', 'important');
    panel.style.setProperty('bottom', (window.innerHeight - centerRect.bottom) + 'px', 'important');
    panel.style.setProperty('width', panelWidth + 'px', 'important');

    var centerPaneWidth = centerPane ? centerPane.offsetWidth : window.innerWidth;
    var mapWidth = centerPaneWidth - streetviewWidth - panelWidth;
    mapContainer.style.setProperty('width', mapWidth + 'px', 'important');
    triggerMapUpdate();
}
