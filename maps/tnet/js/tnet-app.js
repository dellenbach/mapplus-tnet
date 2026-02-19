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

    // Schatten nur bei Bedarf aktualisieren (statt 60x/Sek rAF-Endlosschleife)
    // ResizeObserver + MutationObserver für Panel open/close
    updateShadow(); // Initial

    if (typeof ResizeObserver !== 'undefined') {
        var ro = new ResizeObserver(updateShadow);
        ro.observe(freepane);
        ro.observe(closeSwitch);
    }

    // Panel open/close (class toggle) erkennen
    var mo = new MutationObserver(updateShadow);
    mo.observe(freepane, { attributes: true, attributeFilter: ['class'] });

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

    var match = currentPath.match(/\/maps\/([^\/]+)$/);

    if (match && match[1]) {
        var bookmarkId = match[1];

        // Warte auf TnetSetBookmark-Funktion (wird async geladen)
        function tryStart() {
            if (typeof window.TnetSetBookmark === 'function' &&
                window.njs && window.njs.AppManager && 
                window.njs.AppManager.setMapBookmark &&
                typeof window.njs.AppManager.infoFloatWinRemoveallItems === 'function') {
                window.TnetSetBookmark(bookmarkId);
            } else {
                setTimeout(tryStart, 1500);
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
