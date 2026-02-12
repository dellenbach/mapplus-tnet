/**
 * tnet-app.js
 * Grundkarten- und AppManager-Initialisierung für TNET WebGIS
 *
 * @version    1.0
 * @date       2026-02-12
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */
// --- Grundkarten-Layer beim Laden standardmäßig aus ---
document.addEventListener('DOMContentLoaded', function() {
    try {
        // Warte bis AppManager verfügbar ist
        var trySet = function() {
            if (!window.njs || !njs.AppManager || !njs.AppManager.setMapBookmark || !njs.AppManager.infoFloatWinRemoveallItems) {
                setTimeout(trySet, 200);
                return;
            }
            
            // Alle Grundkarten-Layer auf aus (via setMapBookmark wie bei Bookmarks)
            ['gis_basis/nw_basisplan_gis_dynamisch/hoehenlinien',
             'gis_basis/nw_basisplan_gis_dynamisch/grundbuchplan_projektierte_objekte',
             'gis_basis/nw_basisplan_gis_dynamisch/gemeindegrenzen'].forEach(function(layerName) {
                try {
                    var params = 'layers=-' + layerName;
                    window.top.njs.AppManager.setMapBookmark(['main'], params);
                    console.log('[GrundkartenSync] Layer beim Start ausgeschaltet:', layerName);
                } catch(e) {
                    console.warn('[GrundkartenSync] Fehler beim Ausschalten:', layerName, e);
                }
            });
            
            // Initialisiere Button-Event-Handler
            var map = (njs.AppManager.Maps && njs.AppManager.Maps.main && njs.AppManager.Maps.main.mapObj) ? njs.AppManager.Maps.main.mapObj : null;

            // OL-Map global verfügbar machen (für ol-pdf-printer und andere Erweiterungen)
            if (map) {
                window._olMap = map;
                console.log('[tnet-app] window._olMap gesetzt ✓');
            }

            if (typeof initGrundkartenLayerSync === 'function') {
                initGrundkartenLayerSync(map);
            }
        };
        trySet();
    } catch(e) {
        console.warn('Grundkarten-Layer-Default-Aus Fehler:', e);
    }
});
// Setzt alle Grundkarten-Buttons auf AUS (optisch und technisch)
window.setGrundkartenButtonsDefaultAus = function() {
    Object.keys(GRUNDKARTEN_LAYER_MAPPING).forEach(function(btnId) {
        var btnEin = document.getElementById('btn-' + btnId + '-ein');
        var btnAus = document.getElementById('btn-' + btnId + '-aus');
        if (btnEin && btnAus) {
            btnEin.classList.remove('active');
            btnAus.classList.add('active');
            // Optional: aria-pressed setzen
            btnEin.setAttribute('aria-pressed', 'false');
            btnAus.setAttribute('aria-pressed', 'true');
        }
    });
};
// === GRUNDKARTEN-LAYER-SYNC ===
// Mapping: Button-ID (oder data-layer) → OL-Layername (vollständiger Pfad)
window.GRUNDKARTEN_LAYER_MAPPING = {
    'hoehenkurven': 'gis_basis/nw_basisplan_gis_dynamisch/hoehenlinien',
    'projektebene': 'gis_basis/nw_basisplan_gis_dynamisch/grundbuchplan_projektierte_objekte',
    'gemeindegrenzen': 'gis_basis/nw_basisplan_gis_dynamisch/gemeindegrenzen'
};

// Initialisiert die Grundkarten-Button-Logik mit Event-Listenern
window.initGrundkartenLayerSync = function(map) {
    console.log('[GrundkartenSync] Initialisiere Layer-Schaltung');
    
    // State: Welche Grundkarten-Layer sind eingeschaltet
    var layerState = {
        'gis_basis/nw_basisplan_gis_dynamisch/hoehenlinien': false,
        'gis_basis/nw_basisplan_gis_dynamisch/grundbuchplan_projektierte_objekte': false,
        'gis_basis/nw_basisplan_gis_dynamisch/gemeindegrenzen': false
    };
    
    // Hilfsfunktion: Hole alle aktuell sichtbaren Layer (außer Grundkarten)
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
    
    // Event-Handler für alle Toggle-Buttons
    var buttons = document.querySelectorAll('.toggle-btn[data-layer]');
    buttons.forEach(function(btn) {
        btn.addEventListener('click', function() {
            var layerId = this.getAttribute('data-layer');
            var value = this.getAttribute('data-value');
            
            // Finde den Layer-Namen aus dem Mapping
            var layerName = GRUNDKARTEN_LAYER_MAPPING[layerId];
            if (!layerName) {
                console.warn('[GrundkartenSync] Kein Mapping für:', layerId);
                return;
            }
            
            // Schalte Layer ein/aus via setMapBookmark (wie bei Bookmarks)
            try {
                var visible = (value === 'on');
                
                // Aktualisiere den State
                layerState[layerName] = visible;
                console.log('[GrundkartenSync] Layer ' + (visible ? 'EIN' : 'AUS') + ':', layerName);
                
                // Sammle alle Layer die sichtbar sein sollen
                var allLayers = getNonGrundkartenLayers(); // Andere Layer
                
                // Füge aktivierte Grundkarten-Layer hinzu
                Object.keys(layerState).forEach(function(name) {
                    if (layerState[name]) {
                        allLayers.push(name);
                    }
                });
                
                console.log('[GrundkartenSync] Setze Layer-Liste:', allLayers);
                
                // Baue Parameter-String mit allen Layern
                var params = 'layers=' + allLayers.join('|');
                window.top.njs.AppManager.setMapBookmark(['main'], params);
                
                // Wechsle active-Klasse zwischen EIN/AUS
                var siblings = this.parentElement.querySelectorAll('.toggle-btn');
                siblings.forEach(function(s) { s.classList.remove('active'); });
                this.classList.add('active');
            } catch(e) {
                console.error('[GrundkartenSync] Fehler beim Schalten:', e);
            }
        });
    });
    
    console.log('[GrundkartenSync]', buttons.length, 'Buttons registriert');
};
/**
 * tnet-app.js (ES Module) - App-Initialisierung und UI-Helfer
 * 
 * Enthält:
 * - Panel-Schatten (dynamisch positioniert)
 * - Scroll-to-Top Button
 * - Bookmark Auto-Start aus URL
 * 
 * Wird geladen nach tnet_toc.js, vor dem Haupt-Script-Block.
 */

// ===== PANEL-SCHATTEN =====
function initPanelShadow() {
    var freepane = document.getElementById('freepane');
    var closeSwitch = document.querySelector('.close_switch');
    if (!freepane || !closeSwitch) {
        setTimeout(initPanelShadow, 200);
        return;
    }

    // Schatten-Element erstellen
    var shadow = document.createElement('div');
    shadow.id = 'panelShadow';
    freepane.parentNode.insertBefore(shadow, freepane.nextSibling);

    function updateShadow() {
        var rect = closeSwitch.getBoundingClientRect();
        var headerTop = 69;
        var bottom = rect.bottom;
        var width = rect.width;

        shadow.style.top = headerTop + 'px';
        shadow.style.height = (bottom - headerTop) + 'px';
        shadow.style.width = width + 'px';

        // Bei geschlossenem Panel: Breite der minimierten Leiste
        if (freepane.classList.contains('close')) {
            shadow.style.width = '170px';
            shadow.style.left = ((340 - 170) / 2) + 'px';
            shadow.style.borderRadius = '0 0 4px 4px';
        } else {
            shadow.style.left = '0px';
            shadow.style.borderRadius = '0 0 4px 4px';
        }
    }

    // Kontinuierliche Animation mit requestAnimationFrame
    function animateLoop() {
        updateShadow();
        requestAnimationFrame(animateLoop);
    }
    animateLoop();

    window.addEventListener('resize', updateShadow);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPanelShadow);
} else {
    initPanelShadow();
}

// ===== SCROLL-TO-TOP =====
function scrollSpringToTop() {
    var spring = document.getElementById('spring');
    if (spring) {
        spring.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

// Button ein-/ausblenden basierend auf Scroll-Position
function initScrollToTop() {
    var spring = document.getElementById('spring');
    var btn = document.getElementById('scrollToTopBtn');
    if (!spring || !btn) {
        setTimeout(initScrollToTop, 500);
        return;
    }

    spring.addEventListener('scroll', function() {
        if (spring.scrollTop > 100) {
            btn.classList.add('visible');
        } else {
            btn.classList.remove('visible');
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initScrollToTop);
} else {
    initScrollToTop();
}

// ===== BOOKMARK AUTO-START =====
// console.log('Auto-Start Script geladen');

function startBookmarkFromUrl() {
    var currentPath = window.location.pathname;
    // console.log('Prüfe URL:', currentPath);

    var match = currentPath.match(/\/maps\/([^\/]+)$/);

    if (match && match[1]) {
        var bookmarkId = match[1];
        // console.log('Bookmark in URL gefunden:', bookmarkId);

        // Prüfe ob alle benötigten Funktionen verfügbar sind
        if (typeof window.TnetSetBookmark === 'function' &&
            window.njs && window.njs.AppManager && 
            window.njs.AppManager.setMapBookmark &&
            typeof window.njs.AppManager.infoFloatWinRemoveallItems === 'function') {
            // console.log('Alle Funktionen verfügbar - rufe TnetSetBookmark auf');
            window.TnetSetBookmark(bookmarkId);
        } else {
            // console.log('Warte auf vollständiges Laden... (njs.AppManager.infoFloatWinRemoveallItems)');
            setTimeout(startBookmarkFromUrl, 1500);
        }
    } else {
        // console.log('Keine Bookmark-ID in URL');
    }
}

// Starte nach 2 Sekunden
setTimeout(startBookmarkFromUrl, 4000);
