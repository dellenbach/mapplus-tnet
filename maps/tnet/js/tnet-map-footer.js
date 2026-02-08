/**
 * tnet-map-footer.js (ES Module) - Koordinaten-Leiste / Map Footer Bar
 * 
 * Enthält:
 * - Koordinaten-Anzeige (LV95 / WGS84 umschaltbar)
 * - Höhen-Anzeige
 * - Maßstab-Dropdown mit Zoom-Steuerung
 * - Koordinaten-Picker (fixieren/mitlaufen)
 * - Copyright-Anzeige
 * - ScaleLine (OpenLayers)
 */

// ===== KOORDINATEN-LEISTE AUF DER KARTE =====
// console.log('Footer Bar Script gestartet');
var currentCoordSystem = 'lv95';

// Koordinaten-System umschalten
window.switchCoordSystem = function(system) {
    currentCoordSystem = system;
    updateCoordDisplay();
};

// Picker toggle (Koordinaten fixieren)
// Wenn aktiv = Koordinaten sind FIXIERT (laufen nicht mit)
// Wenn inaktiv = Koordinaten laufen mit Mauszeiger
window.toggleCoordPicker = function() {
    var btn = document.getElementById('map-coord-picker-btn');

    // Original CoordDisplay Picker aufrufen
    if (njs && njs.AppManager && njs.AppManager.Tools && 
        njs.AppManager.Tools.CoordDisplay && 
        njs.AppManager.Tools.CoordDisplay['map'] && 
        njs.AppManager.Tools.CoordDisplay['map']['coord2']) {
        njs.AppManager.Tools.CoordDisplay['map']['coord2'].togglePicker('map');
    }

    // Button-Status aus dem Original-Picker synchronisieren
    setTimeout(function() {
        var pickerBtn = document.getElementById('coord2_picker');
        if (pickerBtn && btn) {
            // Wenn original Picker "Checked" hat, ist er aktiv (fixiert)
            if (pickerBtn.classList.contains('njsIconButtonCoordPickerChecked')) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        }
    }, 50);
};

// Initialen Status synchronisieren
function syncPickerStatus() {
    var btn = document.getElementById('map-coord-picker-btn');
    var pickerBtn = document.getElementById('coord2_picker');
    if (pickerBtn && btn) {
        if (pickerBtn.classList.contains('njsIconButtonCoordPickerChecked')) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    }
}

// Koordinaten-Anzeige aktualisieren
function updateCoordDisplay() {
    var coordDisplay = document.getElementById('map-coord-display');
    var lv95Input = document.getElementById('xy_coord2');
    var wgs84Input = document.getElementById('xy_coord3');

    if (!coordDisplay) return;

    if (currentCoordSystem === 'lv95' && lv95Input) {
        coordDisplay.textContent = lv95Input.value || '--';
    } else if (currentCoordSystem === 'wgs84' && wgs84Input) {
        coordDisplay.textContent = wgs84Input.value || '--';
    }
}

// Höhen-Anzeige aktualisieren
function updateAltitudeDisplay() {
    var altDisplay = document.getElementById('map-coord-altitude');
    var altInput = document.getElementById('z_alti1');

    if (altDisplay && altInput) {
        var val = altInput.value;
        if (val) {
            // Entferne m.ü.M und andere Texte, behalte nur Zahlen und | 
            val = val.replace(/m\.?ü\.?M\.?/gi, '').trim();
        }
        altDisplay.textContent = val ? val : '--';
    }
}

// Originales Koordinaten-Widget verstecken (ersetzt durch eigene Footer-Leiste)
function hideOriginalCoordWidget() {
    var wrapper = document.getElementById('njs_coordinates_wrapper');
    if (wrapper) {
        wrapper.style.display = 'none';
    }

    var lv95Input = document.getElementById('xy_coord2');
    if (lv95Input && typeof lv95Input.closest === 'function') {
        var pane = lv95Input.closest('.dojoxFloatingPane') || lv95Input.closest('.dojoxFloatingPaneContent') || lv95Input.closest('.dijitFloatingPane');
        if (pane) {
            pane.style.display = 'none';
        }
    }
}

// Observer für Änderungen an den Original-Inputs
function setupObservers() {
    // console.log('Footer Bar: setupObservers aufgerufen');

    // Debug: Was ist verfügbar?
    // console.log('njs:', typeof njs);
    if (njs) {
        // console.log('njs.AppManager:', typeof njs.AppManager);
        if (njs.AppManager) {
            // console.log('njs.AppManager.Maps:', njs.AppManager.Maps);
            if (njs.AppManager.Maps && njs.AppManager.Maps['main']) {
                // console.log('Maps[main]:', njs.AppManager.Maps['main']);
                // console.log('Maps[main].map:', njs.AppManager.Maps['main'].map);
                // console.log('Maps[main] keys:', Object.keys(njs.AppManager.Maps['main']));
            }
        }
    }

    var lv95Input = document.getElementById('xy_coord2');
    var wgs84Input = document.getElementById('xy_coord3');
    var altInput = document.getElementById('z_alti1');

    // Warte auf Map statt auf Inputs
    if (!njs || !njs.AppManager || !njs.AppManager.Maps || !njs.AppManager.Maps['main'] || !njs.AppManager.Maps['main'].mapObj) {
        // Map noch nicht da, später nochmal versuchen
        // console.log('Footer Bar: Map noch nicht bereit, warte 500ms...');
        setTimeout(setupObservers, 500);
        return;
    }

    // console.log('Footer Bar: Map gefunden!');
    var map = njs.AppManager.Maps['main'].mapObj;
    var view = map.getView();
    // console.log('Footer Bar: View:', view);

    // Originales Koordinaten-Widget verstecken
    hideOriginalCoordWidget();

    // Initialen Picker-Status synchronisieren
    syncPickerStatus();

    // Initiales Update
    updateScaleDisplay();
    updateCopyrightDisplay();

    // Event-Listener für Zoom/Resolution-Änderungen
    view.on('change:resolution', updateScaleDisplay);

    // Auch bei Bewegung aktualisieren (für den Fall)
    map.on('moveend', updateScaleDisplay);

    // console.log('Map Footer Bar: Scale Listener registriert auf View', view);

    // Polling für Koordinaten und andere Updates (nur wenn Picker nicht fixiert)
    setInterval(function() {
        updateCoordDisplay();
        updateAltitudeDisplay();
        syncPickerStatus();
    }, 500);

    // console.log('Map Footer Bar: Initialisiert');
}

// Maßstab berechnen (korrekt mit Projektion)
function getMapScale(map) {
    var view = map.getView();
    var resolution = view.getResolution();
    var projection = view.getProjection();

    if (!resolution || !projection) return null;

    // Meter pro Pixel unter Berücksichtigung der Projektion
    var metersPerPixel = resolution * projection.getMetersPerUnit();

    // DPI-Konstante (96 dpi): 1 inch = 0.0254 m
    var DPI = 96;
    var inchesPerMeter = 39.37;

    // Maßstab 1 : N
    var scale = metersPerPixel * inchesPerMeter * DPI;
    return Math.round(scale);
}

// Vordefinierte Maßstäbe für die Auswahl
var predefinedScales = [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 200000, 500000, 1000000];

// Resolution aus Maßstab berechnen (umgekehrte Formel)
function getResolutionFromScale(scale) {
    if (!njs || !njs.AppManager || !njs.AppManager.Maps || !njs.AppManager.Maps['main'] || !njs.AppManager.Maps['main'].mapObj) return null;
    var map = njs.AppManager.Maps['main'].mapObj;
    var view = map.getView();
    var projection = view.getProjection();

    var DPI = 96;
    var inchesPerMeter = 39.37;
    var metersPerUnit = projection.getMetersPerUnit();

    // scale = resolution * metersPerUnit * inchesPerMeter * DPI
    // resolution = scale / (metersPerUnit * inchesPerMeter * DPI)
    var resolution = scale / (metersPerUnit * inchesPerMeter * DPI);
    return resolution;
}

// Maßstab setzen (Zoom ändern)
window.setMapScale = function(scaleValue) {
    var scale = parseInt(scaleValue);
    if (!scale) return;

    var resolution = getResolutionFromScale(scale);
    if (!resolution) return;

    var map = njs.AppManager.Maps['main'].mapObj;
    var view = map.getView();

    // Sanft zum neuen Zoom animieren
    view.animate({
        resolution: resolution,
        duration: 250
    });
};

// Nächsten vordefinierten Maßstab finden
function findClosestScale(actualScale) {
    var closest = predefinedScales[0];
    var minDiff = Math.abs(actualScale - closest);

    for (var i = 1; i < predefinedScales.length; i++) {
        var diff = Math.abs(actualScale - predefinedScales[i]);
        if (diff < minDiff) {
            minDiff = diff;
            closest = predefinedScales[i];
        }
    }
    return closest;
}

// Maßstab im Footer aktualisieren (Dropdown)
function updateScaleDisplay() {
    var scaleSelect = document.getElementById('map-scale-select');
    if (!scaleSelect) {
        // console.log('Scale: Element #map-scale-select nicht gefunden');
        return;
    }

    if (njs && njs.AppManager && njs.AppManager.Maps && njs.AppManager.Maps['main'] && njs.AppManager.Maps['main'].mapObj) {
        var map = njs.AppManager.Maps['main'].mapObj;
        var scale = getMapScale(map);

        if (!scale) {
            // console.log('Scale: Konnte Maßstab nicht berechnen');
            return;
        }

        // Nächsten vordefinierten Maßstab finden und im Dropdown auswählen
        var closestScale = findClosestScale(scale);
        scaleSelect.value = closestScale.toString();
    } else {
        // console.log('Scale: Map nicht verfügbar');
    }
}

// Copyright aus disclaimer_copyright übernehmen
function updateCopyrightDisplay() {
    var copyrightTarget = document.getElementById('map-footer-copyright');
    var copyrightSource = document.getElementById('disclaimer_copyright');

    if (copyrightTarget && copyrightSource && copyrightSource.textContent.trim()) {
        copyrightTarget.textContent = copyrightSource.textContent.trim();
    }
}

// Initialisieren wenn DOM bereit
// console.log('Footer Bar: Warte auf DOM...');
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
        // console.log('Footer Bar: DOMContentLoaded');
        setupObservers();
    });
} else {
    // console.log('Footer Bar: DOM bereits geladen');
    setupObservers();
}
