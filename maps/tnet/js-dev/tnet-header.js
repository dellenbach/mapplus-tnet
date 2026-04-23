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

// ===== OAUTH SILENT-HANDLER =====
// Pre-Authentifizierung: Wenn User in MapPlus angemeldet ist, wird WP-OAuth
// sofort im Hintergrund gestartet — noch bevor das Maps-Panel geöffnet wird.
// So sind die WP-Cookies gesetzt, wenn der User das Panel erstmals öffnet.
(function _installOAuthHandler() {
  var _hiddenFrame = null;
  var _timeoutId = null;
  var _done = false;
  var _preAuthStarted = false;

  // 1. postMessage-Listener
  window.addEventListener('message', function(evt) {
    if (!evt.data || typeof evt.data !== 'object') return;

    // Popup/iframe-Request von proxy-inject.js (manueller Klick auf Login-Button)
    if (evt.data.type === 'tnet-oauth-popup' && evt.data.url) {
      console.log('[tnet-header] OAuth-Request empfangen:', evt.data.url);
      _startSilentOAuth(evt.data.url);
    }

    // Callback von oauth-callback.html (versteckter iframe ODER Popup)
    if (evt.data.type === 'tnet-oauth-done') {
      console.log('[tnet-header] OAuth-Done empfangen');
      _onOAuthComplete();
    }
  });

  // 2. Pre-Auth: sofort starten wenn User in MapPlus angemeldet
  function _tryPreAuth() {
    if (_preAuthStarted || _done) return;
    if (!window.njs || !njs.AppManager || !njs.AppManager.auth_user || njs.AppManager.auth_user === '') {
      return; // Nicht angemeldet → kein Pre-Auth
    }
    _preAuthStarted = true;
    var base = 'https://www.gis-daten.ch';
    var callbackUrl = base + '/maps/tnet/views/oauth-callback.html';
    var oauthUrl = base + '/?option=oauthredirect&app_name=adfs&redirect_url=' + encodeURIComponent(callbackUrl);
    console.log('[tnet-header] Pre-Auth: User angemeldet → starte WP-OAuth im Hintergrund');
    _startSilentOAuth(oauthUrl);
  }

  // Pre-Auth bei App-Ready auslösen
  if (window._tnetAppReadyFired) {
    _tryPreAuth();
  }
  document.addEventListener('tnet-app-ready', function() {
    _tryPreAuth();
  }, { once: true });

  // 3. Versteckten iframe im Top-Frame erstellen
  function _startSilentOAuth(url) {
    _done = false;
    _cleanup();
    // Versteckter iframe — nicht sandboxed, direkt im Top-Frame
    _hiddenFrame = document.createElement('iframe');
    _hiddenFrame.id = '_tnet_oauth_frame';
    _hiddenFrame.style.cssText = 'position:fixed;width:1px;height:1px;left:-9999px;top:-9999px;opacity:0;pointer-events:none;';
    _hiddenFrame.src = url;
    document.body.appendChild(_hiddenFrame);
    console.log('[tnet-header] Versteckter OAuth-iframe erstellt');

    // Timeout: falls IdP-Session abgelaufen → Login-Seite kann nicht im iframe rendern
    // → Fallback auf Popup
    _timeoutId = setTimeout(function() {
      if (!_done) {
        console.warn('[tnet-header] OAuth silent timeout (8s) → Fallback: Popup');
        _cleanup();
        _openFallbackPopup(url);
      }
    }, 8000);
  }

  // 3. Fallback: Popup (falls IdP-Session abgelaufen)
  function _openFallbackPopup(url) {
    var w = 520, h = 650;
    var left = (screen.width - w) / 2;
    var top = (screen.height - h) / 2;
    var popup = window.open(url, 'tnet_oauth',
      'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top +
      ',menubar=no,toolbar=no,status=no,scrollbars=yes');
    if (!popup) {
      console.warn('[tnet-header] Popup blockiert — bitte Popup-Blocker deaktivieren');
      return;
    }
    // Polling: popup.closed
    var pollTimer = setInterval(function() {
      if (popup && popup.closed) {
        clearInterval(pollTimer);
        _onOAuthComplete();
      }
    }, 500);
  }

  // 5. OAuth abgeschlossen → ggf. sichtbaren iframe refreshen
  function _onOAuthComplete() {
    if (_done) return; // Doppel-Aufruf verhindern
    _done = true;
    _cleanup();
    // Nur refreshen wenn das Maps-Panel bereits geladen ist
    // Bei Pre-Auth ist das iframe noch nicht da → kein Refresh nötig
    var iframe = document.getElementById('mapsInfoFrame');
    if (iframe && iframe.getAttribute('src') && iframe.getAttribute('src') !== '') {
      var baseSrc = iframe.getAttribute('data-src') || '/maps/tnet/views/inframe-maps.html';
      iframe.src = baseSrc + (baseSrc.indexOf('?') === -1 ? '?t=' : '&t=') + Date.now();
      console.log('[tnet-header] iframe refresht nach OAuth');
    } else {
      console.log('[tnet-header] Pre-Auth abgeschlossen (iframe noch nicht geladen — OK)');
    }
  }

  // 5. Aufräumen
  function _cleanup() {
    if (_timeoutId) { clearTimeout(_timeoutId); _timeoutId = null; }
    if (_hiddenFrame && _hiddenFrame.parentNode) {
      _hiddenFrame.parentNode.removeChild(_hiddenFrame);
      _hiddenFrame = null;
    }
  }
})();

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
        var layersList = null;
        try {
            // Bookmark-Name aus URL-Pfad ableiten (falls /maps/<id>)
            try {
                var pathMatch = window.location.pathname.match(/\/maps\/([^\/]+)\/?$/);
                if (pathMatch && pathMatch[1]) {
                    TnetLog.log('[MapBookmark] Name:', pathMatch[1]);
                }
            } catch (eName) { /* ignore */ }

            if (typeof params === 'string' && params) {
                var parsed = new URLSearchParams(params);
                var layerParam = parsed.get('layers');
                var mapParam = parsed.get('map');

                if (layerParam) {
                    layersList = layerParam.split('|').filter(function(x) { return !!x; });
                    TnetLog.log('[MapBookmark] Layer ON (' + layersList.length + '):', layersList);
                } else if (mapParam) {
                    TnetLog.log('[MapBookmark] map=', mapParam);
                } else {
                    TnetLog.log('[MapBookmark] params=', params);
                }
            }
        } catch (e) {
            TnetLog.warn('[MapBookmark] Parse-Fehler:', e);
        }

        // Stub: FloatingPane ist bei URL-Bookmarks noch nicht geladen
        if (typeof am.infoFloatWinRemoveallItems !== 'function') {
            am.infoFloatWinRemoveallItems = function() {};
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

        // Catch-up: OL-Layer werden z.T. erst nach setMapBookmark erstellt.
        // Aktiviere nur Layer, die als OL-Layer existieren aber noch unsichtbar sind.
        if (layersList && layersList.length) {
            scheduleBookmarkLayerCatchup(layersList);
        }

        return result;
    };

    window.__tnetSetMapBookmarkHookInstalled = true;
    TnetLog.log('[MapBookmark] setMapBookmark-Hook installiert');
    return true;
}

function scheduleBookmarkLayerCatchup(wanted) {
    if (!wanted || !wanted.length) return;

    function applyOnce() {
        if (typeof window.TnetLayerSwitch !== 'function') return 0;
        var am = window.njs && window.njs.AppManager;
        var map = am && am.Maps && am.Maps['main'];
        var mapObj = map && map.mapObj;
        if (!mapObj || typeof mapObj.getLayers !== 'function') return 0;
        var existingIds = {};
        mapObj.getLayers().forEach(function(l) {
            var name = l.get && l.get('name');
            if (name) existingIds[name] = l;
        });
        var activated = 0;
        wanted.forEach(function(id) {
            var lyr = existingIds[id];
            if (lyr && lyr.getVisible && !lyr.getVisible()) {
                try { window.TnetLayerSwitch(id, 'on'); activated++; } catch (e) { /* ignore */ }
            }
        });
        if (activated > 0) {
            TnetLog.log('[MapBookmark] Catch-up: ' + activated + ' Layer aktiviert');
        }
        return activated;
    }

    setTimeout(applyOnce, 500);
    setTimeout(applyOnce, 1500);
    setTimeout(applyOnce, 3000);
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
