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
} else {
    document.addEventListener('tnet-app-ready', function() {
        updateLoginStatus();
    }, { once: true });
}

// Basemap Widget Interaktion → verschoben nach tnet-basemap.js

// ===== FLOATING PANE POSITION FIX =====
// FloatingPane (Maptips Dialog) unter Header positionieren
var headerHeight = 69;
var minTop = 80;

function adjustPanePosition(pane) {
    if (!pane) return;
    var top = parseInt(pane.style.top) || 0;
    if (top < headerHeight) {
        pane.style.top = minTop + 'px';
    }
}

// Observer für das ganze Dokument - fängt neue Elemente ab
var bodyObserver = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
        if (mutation.type === 'childList') {
            mutation.addedNodes.forEach(function(node) {
                if (node.nodeType === 1 && node.classList && 
                    node.classList.contains('dojoxFloatingPane')) {
                    adjustPanePosition(node);
                    // Observer für Style-Änderungen auf diesem Pane
                    var styleObserver = new MutationObserver(function() {
                        adjustPanePosition(node);
                    });
                    styleObserver.observe(node, { attributes: true, attributeFilter: ['style'] });
                }
            });
        }
    });
});
bodyObserver.observe(document.body, { childList: true, subtree: true });

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
