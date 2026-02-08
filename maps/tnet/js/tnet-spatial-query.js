/**
 * tnet-spatial-query.js (ES Module)
 * Polygon-Zeichnen und räumliche Abfrage: WFS, ArcGIS, geo.admin.ch
 * Layer-Erkennung, GML-Parsing, Feature-Highlighting, Ergebnis-Anzeige, Excel-Export
 */

import { waitForMap, getMainMap } from './tnet-utils.js';

// ===== POLYGON-ZEICHNEN UND RÄUMLICHE ABFRAGE =====
// Globale Variable um Zeichenmodus zu tracken
window.isPolygonDrawing = false;

var drawInteraction = null;
var drawLayer = null;
var isDrawing = false;
    
    // Zeichnen-Layer erstellen
    function getDrawLayer(map) {
        if (!drawLayer) {
            drawLayer = new ol.layer.Vector({
                source: new ol.source.Vector(),
                style: new ol.style.Style({
                    fill: new ol.style.Fill({
                        color: 'rgba(75, 123, 129, 0.2)'
                    }),
                    stroke: new ol.style.Stroke({
                        color: '#4b7b81',
                        width: 2,
                        lineDash: [5, 5]
                    }),
                    image: new ol.style.Circle({
                        radius: 5,
                        fill: new ol.style.Fill({ color: '#4b7b81' }),
                        stroke: new ol.style.Stroke({ color: 'white', width: 2 })
                    })
                }),
                zIndex: 1000
            });
            map.addLayer(drawLayer);
        }
        return drawLayer;
    }
    
    // Polygon-Zeichnen aktivieren/deaktivieren
    window.togglePolygonDraw = function() {
        waitForMap(function(map) {
            var btn = document.getElementById('polygon-tool-btn');
            var panel = document.getElementById('spatial-query-panel');
            var statusEl = document.getElementById('spatial-query-status');
            var resultsEl = document.getElementById('spatial-query-results');
            
            if (isDrawing) {
                // Deaktivieren
                if (drawInteraction) {
                    map.removeInteraction(drawInteraction);
                    drawInteraction = null;
                }
                isDrawing = false;
                window.isPolygonDrawing = false;
                document.body.classList.remove('drawing-mode');
                btn.classList.remove('active');
                panel.classList.add('hidden');
                
                // Layer leeren
                if (drawLayer) {
                    drawLayer.getSource().clear();
                }
            } else {
                // ÖREB-Modus deaktivieren falls aktiv
                if (window.isOerebActive && typeof window.toggleOerebMode === 'function') {
                    window.toggleOerebMode();
                }

                // Aktivieren
                var layer = getDrawLayer(map);
                layer.getSource().clear();
                
                drawInteraction = new ol.interaction.Draw({
                    source: layer.getSource(),
                    type: 'Polygon',
                    style: new ol.style.Style({
                        fill: new ol.style.Fill({
                            color: 'rgba(75, 123, 129, 0.1)'
                        }),
                        stroke: new ol.style.Stroke({
                            color: '#4b7b81',
                            width: 2,
                            lineDash: [5, 5]
                        }),
                        image: new ol.style.Circle({
                            radius: 5,
                            fill: new ol.style.Fill({ color: '#4b7b81' }),
                            stroke: new ol.style.Stroke({ color: 'white', width: 2 })
                        })
                    })
                });
                
                drawInteraction.on('drawend', function(evt) {
                    var polygon = evt.feature.getGeometry();
                    var coords = polygon.getCoordinates()[0];
                    
                    // Zeichenmodus beenden
                    isDrawing = false;
                    window.isPolygonDrawing = false;
                    document.body.classList.remove('drawing-mode');
                    
                    // DrawInteraction sofort entfernen damit normale Klicks wieder funktionieren
                    waitForMap(function(map) {
                        if (drawInteraction) {
                            map.removeInteraction(drawInteraction);
                            drawInteraction = null;
                        }
                    });
                    
                    // Abfrage starten
                    statusEl.textContent = 'Abfrage läuft...';
                    resultsEl.innerHTML = '<div class="loading-spinner"></div>';
                    
                    // Räumliche Abfrage ausführen
                    executeSpatialQuery(coords);
                    
                    // Zeichnen beenden
                    setTimeout(function() {
                        map.removeInteraction(drawInteraction);
                        drawInteraction = null;
                    }, 100);
                });
                
                map.addInteraction(drawInteraction);
                isDrawing = true;
                window.isPolygonDrawing = true;
                document.body.classList.add('drawing-mode');
                btn.classList.add('active');
                panel.classList.remove('hidden');
                statusEl.textContent = 'Zeichnen Sie ein Polygon auf der Karte (Doppelklick zum Beenden)...';
                resultsEl.innerHTML = '';
            }
        });
    };
    
    // Panel schließen
    window.closeSpatialQueryPanel = function() {
        var panel = document.getElementById('spatial-query-panel');
        var btn = document.getElementById('polygon-tool-btn');
        panel.classList.add('hidden');
        btn.classList.remove('active');
        isDrawing = false;
        window.isPolygonDrawing = false;
        document.body.classList.remove('drawing-mode');
        
        // Freepane zurücksetzen falls Panel angedockt war
        var freepane = document.getElementById('freepane');
        if (freepane) {
            freepane.classList.remove('panel-docked');
            freepane.style.bottom = '';
        }
        window.isPanelDocked = false;
        
        waitForMap(function(map) {
            if (drawInteraction) {
                map.removeInteraction(drawInteraction);
                drawInteraction = null;
            }
            if (drawLayer) {
                drawLayer.getSource().clear();
            }
        });
    };
    
    // geo.admin.ch REST API Abfrage
    function queryGeoAdminLayer(layer, polygonCoords) {
        return new Promise(function(resolve, reject) {
            // console.log('geo.admin.ch REST API Query für:', layer.name, layer.wmsLayers);
            
            // Layer-Name anpassen: ÖREB-Layer haben _v2_0.oereb Suffix, das muss entfernt werden
            // Beispiel: ch.astra.baulinien-nationalstrassen_v2_0.oereb → ch.astra.baulinien-nationalstrassen
            var layerName = layer.wmsLayers;
            if (layerName) {
                // Entferne .oereb Suffix
                if (layerName.endsWith('.oereb')) {
                    layerName = layerName.substring(0, layerName.length - 6);
                    // console.log('Nach Entfernung von .oereb:', layerName);
                }
                // Entferne _vX_Y Versions-Suffix (z.B. _v2_0, _v1_0)
                layerName = layerName.replace(/_v\d+_\d+$/, '');
                // console.log('ÖREB Layer-Name für API:', layerName);
            }
            
            // Polygon zu ESRI JSON Format konvertieren
            var rings = [polygonCoords.map(function(coord) {
                return [Math.round(coord[0]), Math.round(coord[1])];
            })];
            
            var geometryJson = {
                rings: rings,
                spatialReference: { wkid: 2056 }
            };
            
            // API-Endpunkt
            var apiUrl = 'https://api3.geo.admin.ch/rest/services/api/MapServer/identify';
            
            // Sprache fix auf Deutsch
            var lang = 'de';
            // console.log('API Sprache:', lang);
            
            // Parameter
            var params = new URLSearchParams({
                geometry: JSON.stringify(geometryJson),
                geometryType: 'esriGeometryPolygon',
                layers: 'all:' + layerName, // Layer-Name (ohne _vX_Y.oereb)
                tolerance: '0',
                mapExtent: '0,0,0,0',
                imageDisplay: '0,0,0',
                sr: '2056',
                returnGeometry: 'true',
                geometryFormat: 'geojson',
                lang: lang
            });
            
            var queryUrl = apiUrl + '?' + params.toString();
            // console.log('geo.admin.ch API URL:', queryUrl);
            
            fetch(queryUrl)
                .then(function(response) { return response.json(); })
                .then(function(data) {
                    // console.log('geo.admin.ch Response:', data);
                    
                    var features = [];
                    if (data.results && data.results.length > 0) {
                        features = data.results.map(function(result) {
                            var attrs = result.attributes || result.properties || {};
                            
                            // Datumsfelder formatieren (z.B. 2019-07-30T00:00:00 → 30.07.2019)
                            Object.keys(attrs).forEach(function(key) {
                                var value = attrs[key];
                                // Prüfe ob es ein ISO-Datum ist (YYYY-MM-DDTHH:mm:ss oder YYYY-MM-DD)
                                if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/.test(value)) {
                                    try {
                                        var date = new Date(value);
                                        if (!isNaN(date.getTime())) {
                                            // Formatiere als DD.MM.YYYY
                                            var day = ('0' + date.getDate()).slice(-2);
                                            var month = ('0' + (date.getMonth() + 1)).slice(-2);
                                            var year = date.getFullYear();
                                            attrs[key] = day + '.' + month + '.' + year;
                                        }
                                    } catch(e) {
                                        // Bei Fehler Original-Wert behalten
                                    }
                                }
                            });
                            
                            return {
                                attributes: attrs,
                                geometry: result.geometry || null
                            };
                        });
                    }
                    
                    // console.log('geo.admin.ch Features:', features.length);
                    
                    // Besseren Layer-Namen verwenden (wmsLayers statt layer.name)
                    var displayName = layer.wmsLayers || layer.name || 'Unbekannter Layer';
                    // Entferne .oereb und _vX_Y Suffixe für Anzeige
                    displayName = displayName.replace(/_v\d+_\d+(\.oereb)?$/, '');
                    displayName = displayName.replace(/\.oereb$/, '');
                    
                    resolve({
                        layerName: displayName + ' (geo.admin.ch)',
                        features: features,
                        error: null
                    });
                })
                .catch(function(err) {
                    console.error('geo.admin.ch API Fehler:', err);
                    
                    var displayName = layer.wmsLayers || layer.name || 'Unbekannter Layer';
                    displayName = displayName.replace(/_v\d+_\d+(\.oereb)?$/, '');
                    displayName = displayName.replace(/\.oereb$/, '');
                    
                    resolve({
                        layerName: displayName + ' (geo.admin.ch)',
                        features: [],
                        error: 'API-Fehler: ' + err.message
                    });
                });
        });
    }
    
    // Räumliche Abfrage gegen ArcGIS Server
    function executeSpatialQuery(polygonCoords) {
        var statusEl = document.getElementById('spatial-query-status');
        var resultsEl = document.getElementById('spatial-query-results');
        
        // Aktive Layer aus dem Layer-Manager holen
        var visibleLayers = getVisibleQueryableLayers();
        
        // console.log('=== SPATIAL QUERY DEBUG ===');
        // console.log('Gefundene Layer:', visibleLayers);
        // console.log('Polygon Koordinaten:', polygonCoords);
        
        if (visibleLayers.length === 0) {
            statusEl.textContent = 'Keine abfragbaren Layer aktiv.';
            resultsEl.innerHTML = '<p class="no-results">Aktivieren Sie Layer im Layer-Manager, die abgefragt werden können.</p>';
            return;
        }
        
        // Polygon-BBOX berechnen für WMS GetFeatureInfo
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        polygonCoords.forEach(function(coord) {
            if (coord[0] < minX) minX = coord[0];
            if (coord[1] < minY) minY = coord[1];
            if (coord[0] > maxX) maxX = coord[0];
            if (coord[1] > maxY) maxY = coord[1];
        });
        var polygonBbox = [minX, minY, maxX, maxY];
        var polygonCenter = [(minX + maxX) / 2, (minY + maxY) / 2];
        
        // Polygon zu ArcGIS JSON Format konvertieren
        var rings = [polygonCoords.map(function(coord) {
            return [Math.round(coord[0]), Math.round(coord[1])];
        })];
        
        var geometryJson = JSON.stringify({
            rings: rings,
            spatialReference: { wkid: 2056 }
        });
        
        // console.log('Geometry JSON:', geometryJson);
        // console.log('Polygon BBOX:', polygonBbox);
        
        statusEl.textContent = 'Abfrage von ' + visibleLayers.length + ' Layer(n)...';
        
        var promises = visibleLayers.map(function(layer) {
            if (layer.type === 'wms') {
                return queryWfsLayer(layer, polygonBbox, polygonCoords);
            } else {
                return querySingleLayer(layer, geometryJson);
            }
        });
        
        Promise.all(promises).then(function(results) {
            // console.log('Query Results:', results);
            displayResults(results, visibleLayers);
        }).catch(function(err) {
            console.error('Spatial Query Error:', err);
            statusEl.textContent = 'Fehler bei der Abfrage.';
            resultsEl.innerHTML = '<p class="error">' + err.message + '</p>';
        });
    }
    
    // WFS/API Layer abfragen (echte räumliche Abfrage mit Polygon)
    // HINWEIS: Bei MapServer kann der WFS TYPENAME vom WMS LAYERS abweichen
    function queryWfsLayer(layer, bbox, polygonCoords) {
        return new Promise(function(resolve, reject) {
            // console.log('Query für Layer:', layer.name, layer.url, layer.mapParam);
            
            // geo.admin.ch / Schweizer Bundesdienste: Verwende REST API statt WFS
            // Erkennung: URL enthält geo.admin.ch ODER Layer-Name beginnt mit "ch."
            var isGeoAdmin = (layer.url && layer.url.indexOf('geo.admin.ch') > -1) ||
                             (layer.wmsLayers && layer.wmsLayers.indexOf('ch.') === 0);
            
            if (isGeoAdmin) {
                // console.log('Schweizer Bundeslayer erkannt (geo.admin.ch), verwende REST API');
                return queryGeoAdminLayer(layer, polygonCoords).then(resolve).catch(reject);
            }
            
            // WFS URL aus WMS URL ableiten
            var wfsUrl = layer.url;
            
            // MapServer: map Parameter (direkt aus Layer-Objekt)
            var mapParam = layer.mapParam || '';
            
            // Fallback: Versuche aus sourceParams oder URL zu extrahieren
            if (!mapParam && layer.sourceParams) {
                mapParam = layer.sourceParams.map || layer.sourceParams.MAP || '';
            }
            if (!mapParam && layer.url) {
                var urlMatch = layer.url.match(/[?&]map=([^&]+)/i);
                if (urlMatch) {
                    mapParam = decodeURIComponent(urlMatch[1]);
                }
            }
            
            // console.log('MapServer map Parameter:', mapParam);
            
            // Funktion um WFS GetFeature auszuführen
            function executeWfsQuery(typeName) {
                var params = new URLSearchParams({
                    SERVICE: 'WFS',
                    VERSION: '2.0.0',
                    REQUEST: 'GetFeature',
                    TYPENAMES: typeName,  // WFS 2.0 nutzt TYPENAMES (Plural)
                    BBOX: bbox.join(',') + ',EPSG:2056',  // WFS 2.0: BBOX enthält CRS
                    COUNT: '1000'  // WFS 2.0 nutzt COUNT statt MAXFEATURES
                });
                
                if (mapParam) {
                    params.set('map', mapParam);
                }
                
                var queryUrl = wfsUrl + '?' + params.toString();
                // console.log('WFS 2.0 Query URL (BBOX):', queryUrl);
                // console.log('  TYPENAMES:', typeName);
                // console.log('  BBOX:', bbox.join(',') + ',EPSG:2056');
                
                return fetch(queryUrl).then(function(response) {
                    return response.text();
                });
            }
            
            // Zuerst: Versuche mit WMS Layer-Name
            var wmsLayerName = layer.wmsLayers;
            
            // Spezialfall: Liegenschaften-Layer (av_ls_eigentuemer.map)
            // Dieser enthält mehrere Kantone - abfrage direkt via GetCapabilities alle
            var isLiegenschaftenLayer = mapParam && mapParam.indexOf('av_ls_eigentuemer') > -1;
            
            if (isLiegenschaftenLayer) {
                // console.log('Liegenschaften-Layer erkannt (av_ls_eigentuemer.map), lade GetCapabilities für Multi-Kanton-Abfrage...');
                
                var capParams = new URLSearchParams({
                    SERVICE: 'WFS',
                    VERSION: '2.0.0',
                    REQUEST: 'GetCapabilities'
                });
                if (mapParam) capParams.set('map', mapParam);
                
                fetch(wfsUrl + '?' + capParams.toString())
                    .then(function(r) { return r.text(); })
                    .then(function(capText) {
                        // console.log('GetCapabilities Response (first 1000):', capText.substring(0, 1000));
                        var parser = new DOMParser();
                        var capXml = parser.parseFromString(capText, 'text/xml');
                        var featureTypes = capXml.querySelectorAll('FeatureType Name, FeatureType > Name');
                        // console.log('FeatureType Elements gefunden:', featureTypes.length);
                        var allTypes = Array.from(featureTypes).map(function(ft) { return ft.textContent.trim(); });
                        // console.log('Alle FeatureTypes:', allTypes);
                        
                        var liegenschaftenTypes = allTypes.filter(function(t) {
                            return t.indexOf('liegenschaften_') > -1;
                        });
                        
                        // Sortiere NW vor OW (für Test)
                        liegenschaftenTypes.sort(function(a, b) {
                            if (a.indexOf('_nw') > -1) return -1;
                            if (b.indexOf('_nw') > -1) return 1;
                            return 0;
                        });
                        
                        // console.log('Liegenschaften-Kantone (NW zuerst):', liegenschaftenTypes.join(', '));
                        
                        // Abfrage alle Kantone parallel
                        var queries = liegenschaftenTypes.map(function(typeName) {
                            // console.log('Starte WFS Query für:', typeName);
                            return executeWfsQuery(typeName)
                                .then(function(response) {
                                    // console.log('Response für ' + typeName + ':', response ? response.substring(0, 200) : 'null');
                                    if (response && response.indexOf('FeatureCollection') > -1) {
                                        var parsed = parseWfsGmlResponse(response, typeName, polygonCoords);
                                        // console.log('Geparste Features für ' + typeName + ':', parsed.features ? parsed.features.length : 0);
                                        return { typeName: typeName, data: parsed };
                                    }
                                    // console.log('Keine FeatureCollection für ' + typeName);
                                    return { typeName: typeName, data: { features: [] } };
                                })
                                .catch(function(err) {
                                    console.error('WFS Query für ' + typeName + ' fehlgeschlagen:', err);
                                    return { typeName: typeName, data: { features: [] } };
                                });
                        });
                        
                        return Promise.all(queries);
                    })
                    .then(function(results) {
                        // Kombiniere alle Features
                        var allFeatures = [];
                        results.forEach(function(result) {
                            if (result.data && result.data.features && result.data.features.length > 0) {
                                // console.log('Features von ' + result.typeName + ':', result.data.features.length);
                                // Konvertiere Features in das erwartete Format
                                result.data.features.forEach(function(f) {
                                    allFeatures.push({
                                        attributes: f.properties || f.attributes || {},
                                        geometry: f.geometry || null
                                    });
                                });
                            }
                        });
                        
                        // console.log('Gesamt Features aus allen Kantonen:', allFeatures.length);
                        
                        resolve({
                            layerName: layer.name + ' (WFS Multi-Kanton)',
                            features: allFeatures,
                            error: null
                        });
                    })
                    .catch(function(err) {
                        console.error('Multi-Kanton WFS Fehler:', err);
                        resolve({
                            layerName: layer.name + ' (WFS)',
                            features: [],
                            error: 'Multi-Kanton WFS Fehler: ' + err.message
                        });
                    });
                
                return; // Beende Funktion hier für Liegenschaften
            }
            
            // Normaler Single-Layer WFS Query
            executeWfsQuery(wmsLayerName)
                .then(function(text) {
                    // Prüfe auf "TYPENAME doesn't exist" Fehler
                    if (text.indexOf("doesn't exist") > -1 || text.indexOf('does not exist') > -1) {
                        // console.log('TYPENAME "' + wmsLayerName + '" nicht gefunden, lade GetCapabilities...');
                        // GetCapabilities abrufen um verfügbare Layer zu finden
                        var capParams = new URLSearchParams({
                            SERVICE: 'WFS',
                            VERSION: '2.0.0',
                            REQUEST: 'GetCapabilities'
                        });
                        if (mapParam) capParams.set('map', mapParam);
                        
                        return fetch(wfsUrl + '?' + capParams.toString())
                            .then(function(r) { return r.text(); })
                            .then(function(capText) {
                                // Parse XML und finde FeatureType Names
                                var parser = new DOMParser();
                                var capXml = parser.parseFromString(capText, 'text/xml');
                                var featureTypes = capXml.querySelectorAll('FeatureType Name, FeatureType > Name');
                                
                                if (featureTypes.length > 0) {
                                    var allTypes = Array.from(featureTypes).map(function(ft) { return ft.textContent.trim(); });
                                    // console.log('Verfügbare FeatureTypes:', allTypes.join(', '));
                                    
                                    // Suche nach passenden FeatureType basierend auf WMS Layer-Name
                                    var matchingType = null;
                                    
                                    // 1. Versuch: Exakte Übereinstimmung
                                    matchingType = allTypes.find(function(t) { return t === wmsLayerName; });
                                    
                                    // 2. Versuch: WMS Layer-Name enthält FeatureType
                                    if (!matchingType) {
                                        matchingType = allTypes.find(function(t) { 
                                            return wmsLayerName.toLowerCase().indexOf(t.toLowerCase()) > -1; 
                                        });
                                    }
                                    
                                    // 3. Versuch: FeatureType enthält WMS Layer-Name
                                    if (!matchingType) {
                                        matchingType = allTypes.find(function(t) { 
                                            return t.toLowerCase().indexOf(wmsLayerName.toLowerCase()) > -1; 
                                        });
                                    }
                                    
                                    // 4. Versuch: Suche nach Kanton-Kürzel (nw, ow, etc.) im WMS-Namen
                                    if (!matchingType) {
                                        var kantonMatch = wmsLayerName.match(/_(nw|ow|ur|sz|gl|zg|be|lu|ag|zh|so|bs|bl|sh|sg|ai|ar|ti|tg|vs|ge|fr|ne|ju|vd)_/i);
                                        if (kantonMatch) {
                                            var kanton = kantonMatch[1].toLowerCase();
                                            matchingType = allTypes.find(function(t) { 
                                                return t.toLowerCase().indexOf('_' + kanton) > -1 || t.toLowerCase().endsWith('_' + kanton);
                                            });
                                            // console.log('Suche nach Kanton "' + kanton + '" in FeatureTypes...');
                                        }
                                    }
                                    
                                    // Fallback: erster FeatureType
                                    if (!matchingType) {
                                        matchingType = allTypes[0];
                                        console.warn('Kein passender FeatureType gefunden, verwende ersten:', matchingType);
                                    } else {
                                        // console.log('Passender FeatureType gefunden:', matchingType);
                                    }
                                    
                                    return executeWfsQuery(matchingType);
                                }
                                return text; // Gib Original-Fehler zurück
                            });
                    }
                    return text;
                })
                .then(function(textOrData) {
                    // Spezialfall: Kombinierte Daten (von Multi-Kanton-Abfrage)
                    if (textOrData && textOrData._combined) {
                        // console.log('Kombinierte Multi-Kanton-Daten erhalten:', textOrData.features.length, 'Features');
                        return textOrData; // Bereits geparste Daten
                    }
                    
                    var text = textOrData;
                    
                    // Prüfe auf WFS Exception oder Fehler
                    if (text.indexOf('ExceptionReport') > -1 || text.indexOf('Exception') > -1) {
                        console.warn('WFS Exception oder Fehler:', text.substring(0, 500));
                        // WFS nicht verfügbar - leere Ergebnisse zurückgeben
                        return { features: [], error: 'WFS nicht verfügbar oder Layer nicht gefunden' };
                    }
                    
                    // GML Response parsen
                    return parseWfsGmlResponse(text, layer.wmsLayers, polygonCoords);
                })
                .then(function(data) {
                    var features = [];
                    
                    if (data && data.features) {
                        // Features aus GML/GeoJSON
                        data.features.forEach(function(f) {
                            var geom = f.geometry;
                            var attrs = f.properties || f.attributes || {};
                            
                            // WFS 2.0 mit BBOX filtert bereits serverseitig
                            // Nur noch prüfen ob Geometrie vorhanden, nicht mehr punktgenau filtern
                            // (die BBOX-Abfrage ist bereits räumlich korrekt)
                            features.push({
                                attributes: attrs,
                                geometry: geom || null
                            });
                        });
                    }
                    
                    // console.log('WFS Features nach BBOX-Filterung:', features.length);
                    resolve({
                        layerName: layer.name + ' (WFS)',
                        features: features,
                        error: null
                    });
                })
                .catch(function(err) {
                    console.error('WFS Query Error:', err);
                    resolve({
                        layerName: layer.name + ' (WFS)',
                        features: [],
                        error: err.message
                    });
                });
        });
    }
    
    // Prüfe ob eine Geometrie das Polygon schneidet
    function isGeometryInPolygon(geom, polygonCoords) {
        if (!geom) return false;
        
        // Punkt in Polygon prüfen
        function pointInPolygon(x, y, polygon) {
            var inside = false;
            for (var i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
                var xi = polygon[i][0], yi = polygon[i][1];
                var xj = polygon[j][0], yj = polygon[j][1];
                if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
                    inside = !inside;
                }
            }
            return inside;
        }
        
        if (geom.type === 'Point') {
            return pointInPolygon(geom.coordinates[0], geom.coordinates[1], polygonCoords);
        } else if (geom.type === 'MultiPoint') {
            return geom.coordinates.some(function(c) {
                return pointInPolygon(c[0], c[1], polygonCoords);
            });
        } else if (geom.type === 'LineString') {
            return geom.coordinates.some(function(c) {
                return pointInPolygon(c[0], c[1], polygonCoords);
            });
        } else if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
            // Für Polygone: Prüfe ob ein Punkt im Suchpolygon liegt
            var coords = geom.type === 'Polygon' ? geom.coordinates[0] : geom.coordinates[0][0];
            return coords.some(function(c) {
                return pointInPolygon(c[0], c[1], polygonCoords);
            });
        }
        
        return true; // Im Zweifelsfall akzeptieren
    }
    
    // Parse WFS GML Response (MapServer GML3)
    function parseWfsGmlResponse(text, layerName, polygonCoords) {
        var features = [];
        
        // console.log('Parsing WFS Response, length:', text.length);
        // console.log('WFS Response (first 500):', text.substring(0, 500));
        
        // Versuche als JSON zu parsen (falls doch JSON)
        try {
            var json = JSON.parse(text);
            return json;
        } catch (e) {}
        
        // Prüfe auf Exception
        if (text.indexOf('ExceptionReport') > -1 || text.indexOf('Exception') > -1) {
            console.error('WFS Exception:', text);
            return { features: [], error: text };
        }
        
        // Prüfe auf leere FeatureCollection
        if (text.indexOf('numberReturned="0"') > -1 || 
            (text.indexOf('FeatureCollection') > -1 && text.indexOf('member>') === -1 && text.indexOf('featureMember>') === -1)) {
            // console.log('Leere FeatureCollection');
            return { features: [] };
        }
        
        // GML/XML parsen
        try {
            var parser = new DOMParser();
            var xml = parser.parseFromString(text, 'text/xml');
            
            // Debug: Log XML structure
            // console.log('XML Root:', xml.documentElement ? xml.documentElement.tagName : 'null');
            
            // WFS 2.0: wfs:member
            var members = xml.getElementsByTagNameNS('http://www.opengis.net/wfs/2.0', 'member');
            
            // WFS 1.1/1.0: gml:featureMember
            if (members.length === 0) {
                members = xml.getElementsByTagNameNS('http://www.opengis.net/gml/3.2', 'featureMember');
            }
            if (members.length === 0) {
                members = xml.getElementsByTagNameNS('http://www.opengis.net/gml', 'featureMember');
            }
            
            // Fallback ohne Namespace
            if (members.length === 0) {
                members = xml.querySelectorAll('member, featureMember');
            }
            
            // MapServer-spezifisch: Suche nach Layer-Namen als Element
            if (members.length === 0 && layerName) {
                // Versuche mit ms: Namespace
                var layerElements = xml.getElementsByTagNameNS('http://mapserver.gis.umn.edu/mapserver', layerName);
                if (layerElements.length === 0) {
                    layerElements = xml.getElementsByTagName(layerName);
                }
                if (layerElements.length === 0) {
                    layerElements = xml.getElementsByTagName('ms:' + layerName);
                }
                if (layerElements.length > 0) {
                    members = Array.from(layerElements).map(function(el) {
                        return { firstElementChild: el, children: [el] };
                    });
                }
            }
            
            // console.log('Found', members.length, 'feature members');
            
            Array.from(members).forEach(function(member) {
                var feature = { properties: {}, geometry: null };
                
                // Extrahiere alle Kind-Elemente als Properties
                var featureElement = member.firstElementChild || member;
                if (featureElement) {
                    Array.from(featureElement.children || featureElement.childNodes).forEach(function(child) {
                        if (child.nodeType !== 1) return; // Nur Element-Nodes
                        
                        var tagName = child.localName || child.tagName;
                        // Entferne Namespace-Präfix
                        if (tagName.indexOf(':') > -1) {
                            tagName = tagName.split(':')[1];
                        }
                        
                        // Geometrie-Elemente speziell behandeln für Highlighting
                        if (tagName === 'geom_gml' || tagName === 'msGeometry' || 
                            tagName === 'geometry' || tagName === 'geom' || tagName === 'the_geom' ||
                            tagName === 'shape' || tagName === 'wkb_geometry') {
                            // Versuche GML-Geometrie zu parsen
                            var gmlGeom = parseGmlGeometry(child);
                            if (gmlGeom) {
                                feature.geometry = gmlGeom;
                            }
                            return;
                        }
                        
                        // Überspringe Geometrie-Container
                        if (tagName === 'boundedBy' || tagName === 'Envelope') {
                            return;
                        }
                        
                        // Extrahiere Text-Inhalt
                        var value = child.textContent || '';
                        if (value.trim()) {
                            feature.properties[tagName] = value.trim();
                        }
                    });
                }
                
                if (Object.keys(feature.properties).length > 0) {
                    features.push(feature);
                }
            });
            
            // console.log('Parsed', features.length, 'features from GML');
            
        } catch (e) {
            console.warn('GML Parse Error:', e);
        }
        
        return { features: features };
    }
    
    // GML Geometrie zu GeoJSON parsen
    function parseGmlGeometry(gmlElement) {
        try {
            // GML Namespaces (3.2 und 3.1)
            var gmlNs32 = 'http://www.opengis.net/gml/3.2';
            var gmlNs31 = 'http://www.opengis.net/gml';
            
            // Finde das eigentliche Geometrie-Element (verschiedene Namespaces)
            var geomTypes = ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'MultiSurface', 'MultiCurve'];
            var geomEl = null;
            
            for (var i = 0; i < geomTypes.length && !geomEl; i++) {
                geomEl = gmlElement.getElementsByTagNameNS(gmlNs32, geomTypes[i])[0] ||
                         gmlElement.getElementsByTagNameNS(gmlNs31, geomTypes[i])[0];
            }
            
            // Fallback ohne Namespace
            if (!geomEl) {
                geomEl = gmlElement.querySelector('Point, MultiPoint, LineString, MultiLineString, Polygon, MultiPolygon, MultiSurface, MultiCurve');
            }
            
            if (!geomEl) return null;
            
            var geomType = (geomEl.localName || geomEl.tagName).replace(/^gml:/, '');
            
            if (geomType === 'Point') {
                var coords = extractGmlCoords(geomEl);
                if (coords.length >= 1) {
                    return { type: 'Point', coordinates: coords[0] };
                }
            } else if (geomType === 'MultiPoint') {
                var coords = extractGmlCoords(geomEl);
                return { type: 'MultiPoint', coordinates: coords };
            } else if (geomType === 'LineString') {
                var coords = extractGmlCoords(geomEl);
                return { type: 'LineString', coordinates: coords };
            } else if (geomType === 'Polygon') {
                var coords = extractGmlPolygonCoords(geomEl);
                if (coords.length > 0) {
                    return { type: 'Polygon', coordinates: coords };
                }
            } else if (geomType === 'MultiPolygon' || geomType === 'MultiSurface') {
                // MultiSurface wird wie MultiPolygon behandelt
                var coords = extractGmlMultiPolygonCoords(geomEl);
                if (coords.length === 1) {
                    // Nur ein Polygon - vereinfachen
                    return { type: 'Polygon', coordinates: coords[0] };
                }
                return { type: 'MultiPolygon', coordinates: coords };
            }
        } catch (e) {
            console.warn('GML Geometry Parse Error:', e);
        }
        return null;
    }
    
    // GML Koordinaten extrahieren
    function extractGmlCoords(element) {
        var coords = [];
        var gmlNs32 = 'http://www.opengis.net/gml/3.2';
        var gmlNs31 = 'http://www.opengis.net/gml';
        
        // Versuche pos oder posList (GML 3.x)
        var posList = element.getElementsByTagNameNS(gmlNs32, 'posList')[0] ||
                      element.getElementsByTagNameNS(gmlNs31, 'posList')[0] ||
                      element.querySelector('posList');
        if (posList) {
            var values = posList.textContent.trim().split(/\s+/);
            var dim = parseInt(posList.getAttribute('srsDimension')) || 2;
            for (var i = 0; i < values.length - (dim - 1); i += dim) {
                coords.push([parseFloat(values[i]), parseFloat(values[i + 1])]);
            }
            return coords;
        }
        
        // Versuche pos (einzelner Punkt)
        var pos = element.getElementsByTagNameNS(gmlNs32, 'pos')[0] ||
                  element.getElementsByTagNameNS(gmlNs31, 'pos')[0] ||
                  element.querySelector('pos');
        if (pos) {
            var values = pos.textContent.trim().split(/\s+/);
            coords.push([parseFloat(values[0]), parseFloat(values[1])]);
            return coords;
        }
        
        // Versuche coordinates (GML 2)
        var coordinates = element.querySelector('coordinates');
        if (coordinates) {
            var pairs = coordinates.textContent.trim().split(/\s+/);
            pairs.forEach(function(pair) {
                var xy = pair.split(',');
                if (xy.length >= 2) {
                    coords.push([parseFloat(xy[0]), parseFloat(xy[1])]);
                }
            });
        }
        
        return coords;
    }
    
    // GML Polygon Koordinaten extrahieren
    function extractGmlPolygonCoords(element) {
        var rings = [];
        var gmlNs32 = 'http://www.opengis.net/gml/3.2';
        var gmlNs31 = 'http://www.opengis.net/gml';
        
        // Exterior Ring
        var exterior = element.getElementsByTagNameNS(gmlNs32, 'exterior')[0] ||
                       element.getElementsByTagNameNS(gmlNs31, 'exterior')[0] ||
                       element.querySelector('exterior, outerBoundaryIs');
        if (exterior) {
            var linearRing = exterior.getElementsByTagNameNS(gmlNs32, 'LinearRing')[0] ||
                             exterior.getElementsByTagNameNS(gmlNs31, 'LinearRing')[0] ||
                             exterior.querySelector('LinearRing');
            if (linearRing) {
                rings.push(extractGmlCoords(linearRing));
            }
        }
        
        // Interior Rings (Löcher)
        var interiors = element.getElementsByTagNameNS(gmlNs32, 'interior');
        if (interiors.length === 0) {
            interiors = element.getElementsByTagNameNS(gmlNs31, 'interior');
        }
        if (interiors.length === 0) {
            interiors = element.querySelectorAll('interior, innerBoundaryIs');
        }
        Array.from(interiors).forEach(function(interior) {
            var linearRing = interior.getElementsByTagNameNS(gmlNs32, 'LinearRing')[0] ||
                             interior.getElementsByTagNameNS(gmlNs31, 'LinearRing')[0] ||
                             interior.querySelector('LinearRing');
            if (linearRing) {
                rings.push(extractGmlCoords(linearRing));
            }
        });
        
        return rings;
    }
    
    // GML MultiPolygon Koordinaten extrahieren
    function extractGmlMultiPolygonCoords(element) {
        var polygons = [];
        var gmlNs32 = 'http://www.opengis.net/gml/3.2';
        var gmlNs31 = 'http://www.opengis.net/gml';
        
        // Suche nach verschiedenen Member-Typen
        var members = element.getElementsByTagNameNS(gmlNs32, 'surfaceMember');
        if (members.length === 0) {
            members = element.getElementsByTagNameNS(gmlNs31, 'surfaceMember');
        }
        if (members.length === 0) {
            members = element.getElementsByTagNameNS(gmlNs32, 'polygonMember');
        }
        if (members.length === 0) {
            members = element.getElementsByTagNameNS(gmlNs31, 'polygonMember');
        }
        if (members.length === 0) {
            members = element.querySelectorAll('polygonMember, surfaceMember');
        }
        
        Array.from(members).forEach(function(member) {
            var polygon = member.getElementsByTagNameNS(gmlNs32, 'Polygon')[0] ||
                          member.getElementsByTagNameNS(gmlNs31, 'Polygon')[0] ||
                          member.querySelector('Polygon');
            if (polygon) {
                var polyCoords = extractGmlPolygonCoords(polygon);
                if (polyCoords.length > 0) {
                    polygons.push(polyCoords);
                }
            }
        });
        
        // Falls keine Members gefunden, versuche direkt Polygone zu finden
        if (polygons.length === 0) {
            var directPolygons = element.getElementsByTagNameNS(gmlNs32, 'Polygon');
            if (directPolygons.length === 0) {
                directPolygons = element.getElementsByTagNameNS(gmlNs31, 'Polygon');
            }
            if (directPolygons.length === 0) {
                directPolygons = element.querySelectorAll('Polygon');
            }
            Array.from(directPolygons).forEach(function(polygon) {
                var polyCoords = extractGmlPolygonCoords(polygon);
                if (polyCoords.length > 0) {
                    polygons.push(polyCoords);
                }
            });
        }
        
        return polygons;
    }
    
    // Einzelnen ArcGIS Layer abfragen
    function querySingleLayer(layer, geometryJson) {
        return new Promise(function(resolve, reject) {
            // Die layer.url kann verschiedene Formate haben:
            // 1. Proxy-URL: /maps/agsproxy.php/gis_oereb/service/MapServer/0
            // 2. Direkte URL: https://server/arcgis/rest/services/...
            
            var serviceUrl = layer.url;
            
            // Falls es eine Proxy-URL ist, benutze sie direkt mit /query
            // Der agsproxy leitet an den richtigen Service weiter
            if (serviceUrl.indexOf('agsproxy.php') > -1) {
                // URL ist bereits im Proxy-Format: /maps/agsproxy.php/service/MapServer/0
                // Füge /query direkt an
                var queryUrl = serviceUrl + '/query';
                
                var params = new URLSearchParams({
                    f: 'json',
                    geometry: geometryJson,
                    geometryType: 'esriGeometryPolygon',
                    spatialRel: 'esriSpatialRelIntersects',
                    outFields: '*',
                    returnGeometry: 'true',
                    inSR: '2056',
                    outSR: '2056'
                });
                
                // Proxy-URL mit Query-Parametern
                var fullUrl = queryUrl + '?' + params.toString();
                
                // console.log('Query URL für Layer "' + layer.name + '":', fullUrl);
                
                fetch(fullUrl)
                    .then(function(response) { 
                        // console.log('Response Status:', response.status);
                        return response.json(); 
                    })
                    .then(function(data) {
                        // console.log('Response Data für "' + layer.name + '":', data);
                        resolve({
                            layerName: layer.name,
                            features: data.features || [],
                            error: data.error ? data.error.message : null
                        });
                    })
                    .catch(function(err) {
                        console.error('Fetch Error für "' + layer.name + '":', err);
                        resolve({
                            layerName: layer.name,
                            features: [],
                            error: err.message
                        });
                    });
            } else {
                // Direkte URL - über Proxy leiten
                var queryUrl = serviceUrl + '/query';
                
                var params = new URLSearchParams({
                    f: 'json',
                    geometry: geometryJson,
                    geometryType: 'esriGeometryPolygon',
                    spatialRel: 'esriSpatialRelIntersects',
                    outFields: '*',
                    returnGeometry: 'true',
                    inSR: '2056',
                    outSR: '2056'
                });
                
                var proxyUrl = '/maps/agsproxy.php?' + encodeURIComponent(queryUrl + '?' + params.toString());
                
                // console.log('Proxy Query URL für Layer "' + layer.name + '":', proxyUrl);
                
                fetch(proxyUrl)
                    .then(function(response) { 
                        // console.log('Response Status:', response.status);
                        return response.json(); 
                    })
                    .then(function(data) {
                        // console.log('Response Data für "' + layer.name + '":', data);
                        resolve({
                            layerName: layer.name,
                            features: data.features || [],
                            error: data.error ? data.error.message : null
                        });
                    })
                    .catch(function(err) {
                        console.error('Fetch Error für "' + layer.name + '":', err);
                        resolve({
                            layerName: layer.name,
                            features: [],
                            error: err.message
                        });
                    });
            }
        });
    }
    
    // Sichtbare abfragbare Layer ermitteln
    function getVisibleQueryableLayers() {
        var layers = [];
        
        // console.log('=== LAYER DETECTION DEBUG ===');
        
        // Versuche Layer aus dem njs Layer-Manager zu holen
        if (njs && njs.AppManager && njs.AppManager.Maps && njs.AppManager.Maps['main']) {
            var mapWrapper = njs.AppManager.Maps['main'];
            var map = mapWrapper.mapObj;
            
            // console.log('Map gefunden:', !!map);
            
            if (map) {
                var allLayers = map.getLayers().getArray();
                // console.log('Anzahl Layer in Map:', allLayers.length);
                
                allLayers.forEach(function(layer, idx) {
                    // Prüfe ob es ein gültiger Layer mit getSource ist
                    if (!layer || typeof layer.getVisible !== 'function' || typeof layer.getSource !== 'function') {
                        // console.log('Layer ' + idx + ': Kein gültiger Layer (evtl. LayerGroup)');
                        return;
                    }
                    
                    var visible = layer.getVisible();
                    var source = layer.getSource();
                    var name = layer.get('name') || layer.get('title') || 'Layer ' + idx;
                    var sourceType = source ? source.constructor.name : 'no source';
                    
                    // console.log('Layer ' + idx + ':', {
                    //     name: name,
                    //     visible: visible,
                    //     sourceType: sourceType,
                    //     hasGetUrl: !!(source && source.getUrl),
                    //     hasGetUrls: !!(source && source.getUrls),
                    //     hasParams: !!(source && source.getParams)
                    // });
                    
                    if (visible && source) {
                        var url = null;
                        
                        // Versuche verschiedene Methoden, die URL zu bekommen
                        if (typeof source.getUrl === 'function') {
                            url = source.getUrl();
                        } else if (typeof source.getUrls === 'function') {
                            var urls = source.getUrls();
                            if (urls && urls.length > 0) url = urls[0];
                        }
                        
                        // Falls source.url_ direkt verfügbar
                        if (!url && source.url_) {
                            url = source.url_;
                        }
                        
                        // Falls TileArcGISRest oder ImageArcGISRest
                        if (!url && source.urls_ && source.urls_.length > 0) {
                            url = source.urls_[0];
                        }
                        
                        if (url) {
                            // console.log('  URL:', url);
                        }
                        
                        // Hole auch die Source-Parameter für zusätzliche Infos
                        var sourceParams = null;
                        if (typeof source.getParams === 'function') {
                            sourceParams = source.getParams();
                            // console.log('  Source Params:', sourceParams);
                        }
                        
                        // Prüfe ob es ein ArcGIS Layer ist (über Proxy oder direkt)
                        // agsproxy.php = ArcGIS Server Proxy
                        var isArcGIS = url && (url.indexOf('agsproxy.php') > -1 || 
                            (url.indexOf('MapServer') > -1 && url.indexOf('cgi-bin') === -1 && url.indexOf('geo.admin.ch') === -1) || 
                            url.indexOf('FeatureServer') > -1);
                        
                        // Prüfe ob es ein WMS/MapServer Layer ist (UMN MapServer via cgi-bin)
                        // WICHTIG: Nur wenn es NICHT bereits als ArcGIS erkannt wurde
                        // Schweizer Bundeslayer (geo.admin.ch oder ch.* Layer) werden auch als WMS behandelt
                        var isWMS = false;
                        if (!isArcGIS) {
                            if (sourceType === 'TileWMS' || sourceType === 'ImageWMS') {
                                isWMS = true;
                            }
                            if (url && (url.indexOf('mapserv') > -1 || url.indexOf('cgi-bin') > -1 || url.indexOf('geo.admin.ch') > -1)) {
                                isWMS = true;
                            }
                            if (sourceParams && sourceParams.SERVICE === 'WMS') {
                                isWMS = true;
                            }
                            // Bundeslayer erkennen (ch.* Layer-Namen)
                            if (sourceParams && sourceParams.LAYERS && sourceParams.LAYERS.indexOf('ch.') === 0) {
                                isWMS = true;
                                // console.log('  Schweizer Bundeslayer erkannt (ch.* Layer)');
                            }
                        }
                        
                        // console.log('  Layer-Typ:', isArcGIS ? 'ArcGIS' : (isWMS ? 'WMS/MapServer' : 'Unbekannt'));
                        
                        if (isArcGIS) {
                            // console.log('  ArcGIS Layer erkannt');
                            
                            // Extrahiere den Service-Pfad
                            var serviceUrl = url;
                            var layerId = null;
                            
                            // Verschiedene URL-Formate handhaben:
                            // 1. /maps/agsproxy.php/gis_oereb/service/MapServer/0
                            // 2. /maps/agsproxy.php/gis_oereb/service/MapServer (mit LAYERS param)
                            // 3. https://server/arcgis/rest/services/folder/service/MapServer/0
                            
                            // Layer-ID am Ende der URL?
                            var layerMatch = url.match(/\/(\d+)\/?$/);
                            if (layerMatch) {
                                layerId = layerMatch[1];
                                serviceUrl = url.replace(/\/\d+\/?$/, '');
                            }
                            
                            // Falls LAYERS Parameter vorhanden und keine Layer-ID in URL
                            if (!layerId && sourceParams && sourceParams.LAYERS) {
                                var layerStr = sourceParams.LAYERS.replace('show:', '');
                                var layerIds = layerStr.split(',');
                                
                                // Für jeden Layer-ID einen Eintrag erstellen
                                layerIds.forEach(function(lid) {
                                    var fullUrl = serviceUrl + '/' + lid.trim();
                                    // console.log('  -> Layer hinzugefügt:', fullUrl);
                                    layers.push({
                                        name: name + ' (Layer ' + lid + ')',
                                        url: fullUrl,
                                        layerId: lid.trim(),
                                        type: 'arcgis'
                                    });
                                });
                            } else if (layerId) {
                                // Einzelner Layer mit ID in URL
                                // console.log('  -> Layer hinzugefügt:', serviceUrl + '/' + layerId);
                                layers.push({
                                    name: name,
                                    url: serviceUrl + '/' + layerId,
                                    layerId: layerId,
                                    type: 'arcgis'
                                });
                            } else {
                                // Fallback: Versuche alle Layer des Service abzufragen (Layer 0)
                                // console.log('  -> Fallback Layer 0:', serviceUrl + '/0');
                                layers.push({
                                    name: name,
                                    url: serviceUrl + '/0',
                                    layerId: '0',
                                    type: 'arcgis'
                                });
                            }
                        } else if (isWMS) {
                            // console.log('  WMS Layer erkannt');
                            
                            // Extrahiere Basis-URL (ohne Query-Parameter)
                            var baseUrl = url.split('?')[0];
                            
                            // Extrahiere map-Parameter aus der URL (für MapServer)
                            var mapParam = null;
                            var urlMapMatch = url.match(/[?&]map=([^&]+)/i);
                            if (urlMapMatch) {
                                mapParam = decodeURIComponent(urlMapMatch[1]);
                                // console.log('  MapServer map Parameter:', mapParam);
                            }
                            
                            // Hole LAYERS aus den Params
                            var wmsLayers = sourceParams && sourceParams.LAYERS ? sourceParams.LAYERS : '';
                            
                            // Filtere mask_layer aus (wird nicht abgefragt)
                            if (wmsLayers && wmsLayers !== 'mask_layer' && wmsLayers.toLowerCase() !== 'mask_layer') {
                                // console.log('  -> WMS Layer hinzugefügt:', baseUrl, 'LAYERS:', wmsLayers);
                                layers.push({
                                    name: name,
                                    url: baseUrl,
                                    wmsLayers: wmsLayers,
                                    type: 'wms',
                                    sourceParams: sourceParams,
                                    mapParam: mapParam  // MapServer map-Parameter
                                });
                            } else if (wmsLayers === 'mask_layer' || wmsLayers.toLowerCase() === 'mask_layer') {
                                // console.log('  -> mask_layer übersprungen (wird nicht abgefragt)');
                            }
                        }
                    }
                });
            }
        }
        
        // console.log('Gefundene abfragbare Layer:', layers);
        return layers;
    }
    
    // Highlight-Layer für Feature-Hervorhebung
    var highlightLayer = null;
    var allQueryFeatures = []; // Speichert alle Features für Klick-Zugriff
    
    function getHighlightLayer(map) {
        if (!highlightLayer) {
            highlightLayer = new ol.layer.Vector({
                source: new ol.source.Vector(),
                style: new ol.style.Style({
                    fill: new ol.style.Fill({
                        color: 'rgba(255, 200, 0, 0.4)'
                    }),
                    stroke: new ol.style.Stroke({
                        color: '#ff8c00',
                        width: 3
                    }),
                    image: new ol.style.Circle({
                        radius: 8,
                        fill: new ol.style.Fill({ color: '#ff8c00' }),
                        stroke: new ol.style.Stroke({ color: 'white', width: 2 })
                    })
                }),
                zIndex: 1001
            });
            map.addLayer(highlightLayer);
        }
        return highlightLayer;
    }
    
    // Feature auf Karte hervorheben
    window.highlightFeature = function(layerIdx, featureIdx) {
        // Map direkt holen
        var map = getMainMap();
        
        if (!map) {
            console.warn('Map nicht verfügbar');
            return;
        }
        
        var layer = getHighlightLayer(map);
        layer.getSource().clear();
        
        // Feature aus gespeicherten Daten holen
        // console.log('highlightFeature:', layerIdx, featureIdx, allQueryFeatures);
        
        if (allQueryFeatures[layerIdx] && allQueryFeatures[layerIdx][featureIdx]) {
            var featureData = allQueryFeatures[layerIdx][featureIdx];
            var geometry = featureData.geometry;
            
            // console.log('Feature data:', featureData);
            // console.log('Geometry:', geometry);
            
            if (geometry) {
                var olGeom = null;
                
                // ArcGIS Geometrie zu OpenLayers konvertieren
                if (geometry.rings) {
                    // ArcGIS Polygon
                    olGeom = new ol.geom.Polygon(geometry.rings);
                } else if (geometry.paths) {
                    // ArcGIS Polyline
                    olGeom = new ol.geom.MultiLineString(geometry.paths);
                } else if (geometry.x !== undefined && geometry.y !== undefined) {
                    // ArcGIS Point
                    olGeom = new ol.geom.Point([geometry.x, geometry.y]);
                } else if (geometry.points) {
                    // ArcGIS MultiPoint
                    olGeom = new ol.geom.MultiPoint(geometry.points);
                }
                // GeoJSON Geometrien
                else if (geometry.type === 'Point' && geometry.coordinates) {
                    olGeom = new ol.geom.Point(geometry.coordinates);
                } else if (geometry.type === 'MultiPoint' && geometry.coordinates) {
                    olGeom = new ol.geom.MultiPoint(geometry.coordinates);
                } else if (geometry.type === 'LineString' && geometry.coordinates) {
                    olGeom = new ol.geom.LineString(geometry.coordinates);
                } else if (geometry.type === 'MultiLineString' && geometry.coordinates) {
                    olGeom = new ol.geom.MultiLineString(geometry.coordinates);
                } else if (geometry.type === 'Polygon' && geometry.coordinates) {
                    olGeom = new ol.geom.Polygon(geometry.coordinates);
                } else if (geometry.type === 'MultiPolygon' && geometry.coordinates) {
                    olGeom = new ol.geom.MultiPolygon(geometry.coordinates);
                }
                
                if (olGeom) {
                    // Koordinatensystem erkennen und nach LV95 transformieren
                    var coords = olGeom.getFirstCoordinate();
                    
                    // WGS84 Erkennung: Schweiz liegt bei Lon ~5-11°, Lat ~45-49°
                    // Koordinaten können als [lon, lat] ODER [lat, lon] kommen
                    var isWGS84_lonlat = coords && 
                        coords[0] > 4 && coords[0] < 12 && 
                        coords[1] > 44 && coords[1] < 50;
                    var isWGS84_latlon = coords && 
                        coords[0] > 44 && coords[0] < 50 && 
                        coords[1] > 4 && coords[1] < 12;
                    
                    if ((isWGS84_lonlat || isWGS84_latlon) && window.proj4) {
                        var axisOrder = isWGS84_latlon ? '[lat,lon]' : '[lon,lat]';
                        // proj4 direkt nutzen: erwartet [lon, lat], liefert [E, N] in LV95
                        olGeom.applyTransform(function(input, output, dim) {
                            var d = dim || 2;
                            for (var i = 0; i < input.length; i += d) {
                                var lon = isWGS84_latlon ? input[i + 1] : input[i];
                                var lat = isWGS84_latlon ? input[i] : input[i + 1];
                                var lv95 = proj4('EPSG:4326', 'EPSG:2056', [lon, lat]);
                                output[i] = lv95[0];
                                output[i + 1] = lv95[1];
                                for (var j = 2; j < d; j++) {
                                    output[i + j] = input[i + j];
                                }
                            }
                            return output;
                        });
                    }
                    
                    // LV03 → LV95 Konvertierung falls nötig
                    // LV03: E ~480'000-840'000, N ~75'000-300'000
                    // LV95: E ~2'480'000-2'840'000, N ~1'075'000-1'300'000
                    coords = olGeom.getFirstCoordinate();
                    var isLV03 = coords && 
                        coords[0] > 400000 && coords[0] < 900000 && 
                        coords[1] > 50000 && coords[1] < 400000;
                    if (isLV03) {
                        // console.log('LV03 Koordinaten erkannt, konvertiere zu LV95:', coords);
                        olGeom.applyTransform(function(input, output, dim) {
                            var d = dim || 2;
                            for (var i = 0; i < input.length; i += d) {
                                output[i] = input[i] + 2000000;
                                output[i + 1] = input[i + 1] + 1000000;
                                // Weitere Dimensionen (z.B. Z) unverändert lassen
                                for (var j = 2; j < d; j++) {
                                    output[i + j] = input[i + j];
                                }
                            }
                            return output;
                        });
                        // console.log('Konvertiert zu LV95:', olGeom.getFirstCoordinate());
                    }
                    
                    var feature = new ol.Feature({ geometry: olGeom });
                    layer.getSource().addFeature(feature);
                    
                    // Zur Geometrie zoomen
                    var extent = olGeom.getExtent();
                    
                    // Bei Punkten oder sehr kleinen Extents: Mindestgrösse setzen
                    var minSize = 100; // Mindestens 100m in jede Richtung
                    var width = extent[2] - extent[0];
                    var height = extent[3] - extent[1];
                    if (width < minSize || height < minSize) {
                        var centerX = (extent[0] + extent[2]) / 2;
                        var centerY = (extent[1] + extent[3]) / 2;
                        extent = [
                            centerX - minSize,
                            centerY - minSize,
                            centerX + minSize,
                            centerY + minSize
                        ];
                    }
                    
                    map.getView().fit(extent, {
                        padding: [50, 50, 50, 50],
                        duration: 500
                    });
                }
            }
        }
    };
    
    // Highlight entfernen
    window.clearHighlight = function() {
        if (highlightLayer) {
            highlightLayer.getSource().clear();
        }
    };
    
    // Ergebnisse anzeigen
    function displayResults(results, layers) {
        var statusEl = document.getElementById('spatial-query-status');
        var resultsEl = document.getElementById('spatial-query-results');
        
        // Features für späteren Zugriff speichern
        allQueryFeatures = results.map(function(r) { return r.features || []; });
        
        // Filtere mask_layer aus den Ergebnissen aus
        results = results.filter(function(result) {
            return result.layerName !== 'mask_layer (WFS)' && 
                   result.layerName.toLowerCase().indexOf('mask_layer') === -1;
        });
        
        // Layer in Kategorien einteilen
        var layersWithResults = [];
        var layersWithoutResults = [];
        var layersNotQueryable = [];
        
        results.forEach(function(result, layerIdx) {
            var count = result.features ? result.features.length : 0;
            
            if (result.error && (result.error.indexOf('WFS nicht verfügbar') > -1 || result.error.indexOf('nicht unterstützt') > -1)) {
                layersNotQueryable.push({ result: result, layerIdx: layerIdx });
            } else if (count === 0 && !result.error) {
                layersWithoutResults.push({ result: result, layerIdx: layerIdx });
            } else if (count > 0) {
                layersWithResults.push({ result: result, layerIdx: layerIdx });
            } else {
                // Fehler - zu layersNotQueryable
                layersNotQueryable.push({ result: result, layerIdx: layerIdx });
            }
        });
        
        var totalFeatures = layersWithResults.reduce(function(sum, item) {
            return sum + (item.result.features ? item.result.features.length : 0);
        }, 0);
        
        var html = '';
        
        // 1. Layer mit Resultaten
        layersWithResults.forEach(function(item) {
            var result = item.result;
            var layerIdx = item.layerIdx;
            var count = result.features.length;
            
            html += '<div class="query-result-layer">';
            html += '<div class="query-result-header" onclick="toggleQueryResult(this)">';
            html += '<span class="query-result-icon">▶</span>';
            html += '<span class="query-result-name">' + result.layerName + '</span>';
            html += '<span class="query-result-count">' + count + '</span>';
            html += '</div>';
            html += '<div class="query-result-content hidden">';
            html += '<table class="query-result-table">';
            
            // Header
            var attrs = result.features[0].attributes;
            var keys = Object.keys(attrs).slice(0, 6); // Max 6 Spalten
            html += '<thead><tr>';
            html += '<th></th>'; // Spalte für Zoom-Button
            keys.forEach(function(key) {
                html += '<th>' + key + '</th>';
            });
            html += '</tr></thead>';
            
            // Daten (max 50 Zeilen)
            html += '<tbody>';
            result.features.slice(0, 50).forEach(function(feature, featureIdx) {
                var hasGeom = feature.geometry ? 'true' : 'false';
                html += '<tr class="query-result-row" data-layer="' + layerIdx + '" data-feature="' + featureIdx + '" onclick="highlightFeature(' + layerIdx + ',' + featureIdx + ')">';
                html += '<td class="zoom-cell"><span class="zoom-icon" title="In Karte zeigen"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg></span></td>';
                keys.forEach(function(key) {
                    var val = feature.attributes[key];
                    if (val === null || val === undefined) val = '-';
                    html += '<td>' + val + '</td>';
                });
                html += '</tr>';
            });
            html += '</tbody></table>';
            
            if (count > 50) {
                html += '<p class="more-results">... und ' + (count - 50) + ' weitere</p>';
            }
            html += '</div>';
            html += '</div>';
        });
        
        // 2. Accordion für Layer ohne Treffer
        if (layersWithoutResults.length > 0) {
            html += '<div class="query-result-layer query-result-empty">';
            html += '<div class="query-result-header" onclick="toggleQueryResult(this)">';
            html += '<span class="query-result-icon">▶</span>';
            html += '<span class="query-result-name">Keine Objekte gefunden</span>';
            html += '<span class="query-result-count">' + layersWithoutResults.length + '</span>';
            html += '</div>';
            html += '<div class="query-result-content hidden">';
            html += '<ul class="empty-layers-list">';
            layersWithoutResults.forEach(function(item) {
                html += '<li>' + item.result.layerName + '</li>';
            });
            html += '</ul>';
            html += '</div>';
            html += '</div>';
        }
        
        // 3. Accordion für nicht abfragbare Layer
        if (layersNotQueryable.length > 0) {
            html += '<div class="query-result-layer query-result-not-queryable">';
            html += '<div class="query-result-header" onclick="toggleQueryResult(this)">';
            html += '<span class="query-result-icon">▶</span>';
            html += '<span class="query-result-name">Räumliche Abfrage nicht unterstützt</span>';
            html += '<span class="query-result-count">' + layersNotQueryable.length + '</span>';
            html += '</div>';
            html += '<div class="query-result-content hidden">';
            html += '<ul class="not-queryable-layers-list">';
            layersNotQueryable.forEach(function(item) {
                var errorMsg = item.result.error || 'Unbekannter Fehler';
                html += '<li>' + item.result.layerName + ' <span class="error-hint">(' + errorMsg + ')</span></li>';
            });
            html += '</ul>';
            html += '</div>';
            html += '</div>';
        }
        
        statusEl.textContent = totalFeatures + ' Objekte in ' + layersWithResults.length + ' Layer(n) gefunden';
        resultsEl.innerHTML = html;
    }
    
    // Ergebnis auf-/zuklappen
    window.toggleQueryResult = function(header) {
        var content = header.nextElementSibling;
        var icon = header.querySelector('.query-result-icon');
        
        if (content.classList.contains('hidden')) {
            content.classList.remove('hidden');
            icon.textContent = '▼';
        } else {
            content.classList.add('hidden');
            icon.textContent = '▶';
        }
    };
    
    // Excel Export
    window.exportQueryToExcel = function() {
        if (!allQueryFeatures || allQueryFeatures.length === 0) {
            alert('Keine Daten zum Exportieren vorhanden.');
            return;
        }
        
        var csvContent = '';
        var hasData = false;
        
        allQueryFeatures.forEach(function(features, layerIdx) {
            if (features && features.length > 0) {
                hasData = true;
                
                // Layer-Name als Überschrift
                var layerName = document.querySelectorAll('.query-result-name')[layerIdx];
                csvContent += '\n"' + (layerName ? layerName.textContent : 'Layer ' + layerIdx) + '"\n';
                
                // Header
                var attrs = features[0].attributes;
                var keys = Object.keys(attrs);
                csvContent += keys.map(function(k) { return '"' + k + '"'; }).join(';') + '\n';
                
                // Daten
                features.forEach(function(feature) {
                    var row = keys.map(function(key) {
                        var val = feature.attributes[key];
                        if (val === null || val === undefined) val = '';
                        // Escape quotes
                        val = String(val).replace(/"/g, '""');
                        return '"' + val + '"';
                    });
                    csvContent += row.join(';') + '\n';
                });
            }
        });
        
        if (!hasData) {
            alert('Keine Daten zum Exportieren vorhanden.');
            return;
        }
        
        // BOM für UTF-8 hinzufügen
        var BOM = '\uFEFF';
        var blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = 'raeumliche_abfrage_' + new Date().toISOString().slice(0,10) + '.csv';
        link.click();
        URL.revokeObjectURL(url);
    };
    
    // Panel andocken (unten)
    window.isPanelDocked = false;  // Globale Variable für Drag/Resize Checks
    window.toggleDockPanel = function() {
        var panel = document.getElementById('spatial-query-panel');
        var dockBtn = document.getElementById('dock-btn');
        var freepane = document.getElementById('freepane');
        
        if (window.isPanelDocked) {
            // Undock - zurück zu floating
            panel.classList.remove('docked-bottom');
            panel.style.left = '';
            panel.style.top = '';
            panel.style.height = '';
            dockBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5v-3h14v3zm0-5H5V5h14v9z"/></svg>';
            dockBtn.title = 'Unten andocken';
            window.isPanelDocked = false;
            // Freepane wieder auf volle Höhe
            if (freepane) {
                freepane.classList.remove('panel-docked');
                freepane.style.bottom = '';
            }
        } else {
            // Dock - unten andocken
            panel.classList.add('docked-bottom');
            panel.style.left = '';
            panel.style.top = '';
            dockBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z"/></svg>';
            dockBtn.title = 'Floating';
            window.isPanelDocked = true;
            // Freepane kürzen bis Panel-Oberkante
            if (freepane) {
                freepane.classList.add('panel-docked');
                // Kurze Verzögerung damit Panel-Höhe korrekt berechnet wird
                setTimeout(function() {
                    updateFreepaneHeight();
                }, 50);
            }
        }
    };
    
    // Freepane-Höhe anpassen wenn Panel angedockt
    window.updateFreepaneHeight = function() {
        var panel = document.getElementById('spatial-query-panel');
        var freepane = document.getElementById('freepane');
        if (panel && freepane && window.isPanelDocked) {
            var panelHeight = panel.offsetHeight;
            freepane.style.bottom = (panelHeight + 32) + 'px'; // +32 für footer-bar
        }
    };
