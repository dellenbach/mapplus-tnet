/**
 * tnet-app.js — App-Initialisierung und UI-Helfer
 *
 * Enthält:
 *  - Panel-Schatten (dynamisch positioniert)
 *  - Scroll-to-Top Button
 *  - Bookmark Auto-Start aus URL
 *
 * Grundkarten-Layer-Sync und Basemap-Widget → verschoben nach tnet-basemap.js
 *
 * @version    2.0
 * @date       2026-02-19
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
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
        var headerTop = 69;
        var spring = document.getElementById('spring');
        var bottom;

        if (spring) {
            // Höhe basierend auf dem tatsächlichen Inhalt von #spring berechnen
            // (nicht closeSwitch, das bei flex-stretch am Viewport-Ende landen kann)
            var titlePanes = spring.querySelectorAll(':scope > .dijitTitlePane');
            if (titlePanes.length > 0) {
                var lastPane = titlePanes[titlePanes.length - 1];
                var lastRect = lastPane.getBoundingClientRect();
                bottom = lastRect.bottom + 10; // +10px für close_switch
            } else {
                bottom = closeSwitch.getBoundingClientRect().bottom;
            }
        } else {
            bottom = closeSwitch.getBoundingClientRect().bottom;
        }

        // Sicherheit: Schatten nie höher als der sichtbare Inhalt
        var maxBottom = headerTop + (spring ? spring.scrollHeight : 400) + 10;
        if (bottom > maxBottom) bottom = maxBottom;

        var width = closeSwitch.offsetWidth || 340;

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

    // Schatten nur bei Bedarf aktualisieren (statt 60x/Sek rAF-Endlosschleife)
    // ResizeObserver + MutationObserver für Panel open/close
    updateShadow(); // Initial

    var spring = document.getElementById('spring');

    if (typeof ResizeObserver !== 'undefined') {
        var ro = new ResizeObserver(updateShadow);
        ro.observe(freepane);
        ro.observe(closeSwitch);
        // spring beobachten — Höhe ändert sich wenn Dojo TitlePanes parsed oder Accordion öffnet
        if (spring) ro.observe(spring);
    }

    // Panel open/close (class toggle) erkennen
    var mo = new MutationObserver(updateShadow);
    mo.observe(freepane, { attributes: true, attributeFilter: ['class'] });

    // spring-Inhalt beobachten (Dojo Parser fügt dijitTitlePane-Klassen hinzu)
    if (spring) {
        new MutationObserver(updateShadow)
            .observe(spring, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    }

    // Nach App-Ready nochmal aktualisieren (Dojo-Parser fertig)
    document.addEventListener('tnet-app-ready', function() {
        setTimeout(updateShadow, 100);
        setTimeout(updateShadow, 500);
    });

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

function startBookmarkFromUrl() {
    var currentPath = window.location.pathname;

    // Erlaubt sowohl PROD (/maps/{id}) als auch DEV (/maps-dev/{id}).
    // Pattern fuer ID entspricht der .htaccess-Rewrite-Regel: [a-zA-Z0-9_-]+
    var match = currentPath.match(/\/maps(?:-dev)?\/([a-zA-Z0-9_-]+)$/);

    if (match && match[1]) {
        var bookmarkId = match[1];

        // Kartenansicht (Schema v2) wird via Query-String ?view={viewId} uebergeben.
        // Path-Style wuerde relative Asset-URLs in der Seite kaputtmachen.
        var viewId = null;
        try {
            var rawView = new URLSearchParams(window.location.search).get('view');
            if (rawView && /^[a-zA-Z0-9_-]+$/.test(rawView)) viewId = rawView;
        } catch (eUrl) { /* URLSearchParams notfalls weggelassen */ }

        // Warte auf TnetSetBookmark-Funktion (wird async geladen).
        // Catch-up + Bookmark-Name-Logging laufen im setMapBookmark-Wrapper (tnet-header.js).
        function isLayerManagerReady() {
            try {
                var am = window.njs && window.njs.AppManager;
                var lyrMgrs = am && am.LyrMgr;
                var mainWidget = window.dijit && typeof window.dijit.byId === 'function'
                    ? window.dijit.byId('main_lyrmgr')
                    : null;

                if (!lyrMgrs) return false;
                if (!lyrMgrs.main_lyrmgr || typeof lyrMgrs.main_lyrmgr.switchLayersProgr !== 'function') {
                    return false;
                }
                if (mainWidget && mainWidget.domNode && mainWidget.domNode.childNodes && mainWidget.domNode.childNodes.length) {
                    return true;
                }
                return Object.keys(lyrMgrs).length >= 1;
            } catch (eLyrMgr) {
                return false;
            }
        }

        function tryStart() {
            if (typeof window.TnetSetBookmark === 'function' &&
                window.njs && window.njs.AppManager &&
                typeof window.njs.AppManager.setMapBookmark === 'function' &&
                isLayerManagerReady()) {
                window.TnetSetBookmark(bookmarkId, viewId);
            } else {
                setTimeout(tryStart, 200);
            }
        }
        tryStart();
    }
}

// Event-basiert statt festes setTimeout(4000)
if (window._tnetAppReadyFired) {
    // Event wurde schon gefeuert bevor dieses Script geladen war
    startBookmarkFromUrl();
} else {
    document.addEventListener('tnet-app-ready', function() {
        startBookmarkFromUrl();
    }, { once: true });
}

