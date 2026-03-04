/**
 * tnet-header.js (ES Module) - Header, Login, Splash, Maps-Dialog, Basemap-Widget, FloatingPane-Fix
 * 
 * Enthält:
 * - Maps-Info-Dialog (iframe: öffnen/schliessen/zurück/refresh)
 * - Basemap Widget Toggle
 * - Login/Logout Status
 * - Hamburger Menü + Hilfe
 * - Splash Screen ausblenden
 * - App-Ready Check
 * - Basemap Widget Interaktion (Toggle Buttons, Cards, Expand)
 * - FloatingPane unter Header positionieren
 * - Iframe Preload bei erster Interaktion
 *
 * @version    1.0
 * @date       2026-02-12
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

// ===== MAPS-INFO-DIALOG (IFRAME) =====
var iframeHistory = [];
var iframeHistoryIndex = -1;

window.setupIframeMonitoring = function() {
    var iframe = document.getElementById("mapsInfoFrame");
    if (iframe) {
        iframe.addEventListener('load', function() {
            try {
                var currentUrl = iframe.contentWindow.location.href;
                if (iframeHistoryIndex === -1 || iframeHistory[iframeHistoryIndex] !== currentUrl) {
                    iframeHistory = iframeHistory.slice(0, iframeHistoryIndex + 1);
                    iframeHistory.push(currentUrl);
                    iframeHistoryIndex = iframeHistory.length - 1;
                }
            } catch(e) {
                // console.log("Iframe URL nicht zugänglich (cross-origin)");
            }
        });
    }
};

window.openMapsInfoDialog = function() {
    var dialog = dijit.byId("mapsInfoDialog");
    if (dialog) {
        // Toggle: Wenn Dialog offen ist, schliessen
        if (dialog.open) {
            window.closeMapsInfoDialog();
            return;
        }
        dialog.show();
        var iframe = document.getElementById("mapsInfoFrame");
        if (iframe) {
            var lazySrc = iframe.getAttribute('data-src') || '/maps/tnet/views/inframe-maps.html';
            if (!iframe.getAttribute('src')) {
                iframe.src = lazySrc;
            }
        }
        window.setupIframeMonitoring();
    }
};

window.closeMapsInfoDialog = function() {
    var dialog = dijit.byId("mapsInfoDialog");
    if (dialog) {
        dialog.hide();
        iframeHistory = [];
        iframeHistoryIndex = -1;
        var iframe = document.getElementById("mapsInfoFrame");
        if (iframe) {
            // iframe entladen, um Ressourcen freizugeben
            iframe.removeAttribute('src');
        }
    }
};

window.goBackInIframe = function() {
    var iframe = document.getElementById("mapsInfoFrame");
    if (!iframe) return;
    
    try {
        iframe.contentWindow.history.back();
    } catch(e) {
        if (iframeHistoryIndex > 0) {
            iframeHistoryIndex--;
            iframe.src = iframeHistory[iframeHistoryIndex];
        } else {
            // console.log("Keine vorherige Seite in der History");
        }
    }
};

window.refreshIframe = function() {
    var iframe = document.getElementById("mapsInfoFrame");
    if (!iframe) return;
    var baseSrc = iframe.getAttribute('data-src') || '/maps/tnet/views/inframe-maps.html';
    if (!iframe.getAttribute('src')) {
        iframe.src = baseSrc;
    } else {
        var newSrc = baseSrc + (baseSrc.indexOf('?') === -1 ? '?t=' : '&t=') + Date.now();
        iframe.src = newSrc;
    }
};

// ===== BOOKMARK-HOOK (LOGGING + DIALOG-AUTO-CLOSE) =====
function installSetMapBookmarkHook() {
    if (window.__tnetSetMapBookmarkHookInstalled) {
        return true;
    }

    var am = (window.njs && window.njs.AppManager) ? window.njs.AppManager : null;
    if (!am || typeof am.setMapBookmark !== 'function') {
        return false;
    }

    var originalSetMapBookmark = am.setMapBookmark;

    am.setMapBookmark = function(targetMaps, params) {
        try {
            if (typeof params === 'string' && params) {
                var parsed = new URLSearchParams(params);
                var layerParam = parsed.get('layers');
                var mapParam = parsed.get('map');

                if (layerParam) {
                    var layers = layerParam.split('|').filter(function(x) { return !!x; });
                    TnetLog.log('[MapBookmark] Layer ON (' + layers.length + '):', layers);
                } else if (mapParam) {
                    TnetLog.log('[MapBookmark] map=', mapParam);
                } else {
                    TnetLog.log('[MapBookmark] params=', params);
                }
            }
        } catch (e) {
            TnetLog.warn('[MapBookmark] Parse-Fehler:', e);
        }

        var result = originalSetMapBookmark.apply(am, arguments);

        try {
            if (typeof dijit !== 'undefined' && typeof dijit.byId === 'function') {
                var dialog = dijit.byId('mapsInfoDialog');
                if (dialog && dialog.open && typeof window.closeMapsInfoDialog === 'function') {
                    window.closeMapsInfoDialog();
                    TnetLog.log('[MapBookmark] mapsInfoDialog nach Kartenwechsel geschlossen');
                }
            }
        } catch (e2) {
            TnetLog.warn('[MapBookmark] Dialog-Close fehlgeschlagen:', e2);
        }

        return result;
    };

    window.__tnetSetMapBookmarkHookInstalled = true;
    TnetLog.log('[MapBookmark] setMapBookmark-Hook installiert');
    return true;
}

function installSetMapBookmarkHookWithRetry() {
    if (installSetMapBookmarkHook()) return;
    setTimeout(installSetMapBookmarkHook, 500);
    setTimeout(installSetMapBookmarkHook, 1500);
    setTimeout(installSetMapBookmarkHook, 3000);
}

// Basemap Widget Toggle → verschoben nach tnet-basemap.js

// ===== LOGIN / LOGOUT =====
window.updateLoginStatus = function() {
    var loginBtn = document.getElementById('header_login');
    var logoutSection = document.getElementById('header_logout');
    var usernameEl = document.getElementById('header_username');
    
    // Prüfe ob njs.AppManager und auth_user verfügbar
    if (window.njs && njs.AppManager && njs.AppManager.auth_user && njs.AppManager.auth_user !== '') {
        var username = njs.AppManager.auth_user;
        // Angemeldet
        if (loginBtn) loginBtn.style.display = 'none';
        if (logoutSection) logoutSection.style.display = 'flex';
        if (usernameEl) usernameEl.textContent = username;
    } else {
        // Nicht angemeldet
        if (loginBtn) loginBtn.style.display = 'flex';
        if (logoutSection) logoutSection.style.display = 'none';
    }
};

window.doLogout = function() {
    window.location.href = 'logout.php';
};

// ===== HAMBURGER MENÜ =====
window.toggleHeaderMenu = function() {
    var menu = document.getElementById('header_menu');
    if (menu) {
        menu.classList.toggle('open');
    }
};

window.openHelp = function() {
    toggleHeaderMenu(); // Menü schließen
    if (window.njs && njs.AppManager && njs.AppManager.toggleCustomPaneContent) {
        njs.AppManager.toggleCustomPaneContent('help', 'custompane', './core/help/help_de.htm', '', '');
    }
};

// Menü schließen bei Klick außerhalb
document.addEventListener('click', function(e) {
    var menu = document.getElementById('header_menu');
    if (menu && menu.classList.contains('open') && !menu.contains(e.target)) {
        menu.classList.remove('open');
    }
});

// ===== SPLASH SCREEN =====
// hideSplashScreen + checkAppReady sind jetzt als Early-Inline-Script
// direkt in index_de.htm, damit sie SOFORT starten (nicht erst nach Module-Load).
// Login-Status wird hier nachgeholt sobald das Module läuft:
// Event-basiert statt Polling-Loop
if (window._tnetAppReadyFired) {
    updateLoginStatus();
    installSetMapBookmarkHookWithRetry();
} else {
    document.addEventListener('tnet-app-ready', function() {
        updateLoginStatus();
        installSetMapBookmarkHookWithRetry();
    }, { once: true });
}

// Basemap Widget Interaktion → verschoben nach tnet-basemap.js

// ===== FLOATING PANE POSITION FIX =====
// FloatingPane (Maptips Dialog) unter Header positionieren
var headerHeight = 69;
var minTopViewport = headerHeight + 11; // 80px vom Viewport-Rand

function adjustPanePosition(pane) {
    if (!pane) return;
    // Docked-Panes nicht verschieben (haben eigene Position via CSS)
    if (pane.classList.contains('docked-right')) return;
    // Tatsächliche Viewport-Position prüfen statt CSS-top-Wert
    var rect = pane.getBoundingClientRect();
    if (rect.top < minTopViewport) {
        var currentTop = parseInt(pane.style.top) || 0;
        var delta = minTopViewport - rect.top;
        // setProperty mit important, damit Dojo-Werte überschrieben werden
        pane.style.setProperty('top', (currentTop + delta) + 'px', 'important');
    }
}

// Observer NUR auf dem Karten-Container — FloatingPanes werden DORT eingefügt
// (statt document.body mit subtree:true, was bei Dojo parser.parse() hunderte
// unnötige Callbacks auslöst)
var floatingPaneContainer = document.getElementById('NeapoljsContainer') || document.body;
var bodyObserver = new MutationObserver(function(mutations) {
    for (var m = 0; m < mutations.length; m++) {
        var mutation = mutations[m];
        if (mutation.type !== 'childList') continue;
        for (var n = 0; n < mutation.addedNodes.length; n++) {
            var node = mutation.addedNodes[n];
            if (node.nodeType === 1 && node.classList && 
                node.classList.contains('dojoxFloatingPane')) {
                adjustPanePosition(node);
                // Observer für Style-Änderungen auf diesem Pane
                var styleObserver = new MutationObserver(function(targetNode) {
                    return function() { adjustPanePosition(targetNode); };
                }(node));
                styleObserver.observe(node, { attributes: true, attributeFilter: ['style'] });
            }
        }
    }
});
bodyObserver.observe(floatingPaneContainer, { childList: true, subtree: true });

// Bestehende Panes auch behandeln
document.querySelectorAll('.dojoxFloatingPane').forEach(function(pane) {
    adjustPanePosition(pane);
    var styleObserver = new MutationObserver(function() {
        adjustPanePosition(pane);
    });
    styleObserver.observe(pane, { attributes: true, attributeFilter: ['style'] });
});

// ===== IFRAME PRELOAD =====
// Preload des iFrames bei erster Nutzerinteraktion
var preloaded = false;
function preloadMapsInfoIframe(){
    if (preloaded) return;
    var iframe = document.getElementById('mapsInfoFrame');
    if (!iframe) return;
    var lazySrc = iframe.getAttribute('data-src') || '/maps/tnet/views/inframe-maps.html';
    if (!iframe.getAttribute('src')) {
        iframe.src = lazySrc;
    }
    preloaded = true;
}
var opts = { once: true, passive: true };
document.addEventListener('pointerdown', preloadMapsInfoIframe, opts);
document.addEventListener('keydown', preloadMapsInfoIframe, opts);
document.addEventListener('touchstart', preloadMapsInfoIframe, opts);
document.addEventListener('mouseover', preloadMapsInfoIframe, opts);
