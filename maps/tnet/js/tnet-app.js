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
