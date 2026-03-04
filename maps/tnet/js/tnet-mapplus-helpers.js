/**
 * tnet-mapplus-helpers.js
 * Hilfsfunktionen für MAP+ Desktop & Mobile
 *
 * @version    2.0
 * @date       2026-02-22
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

// =====================================================================
// TnetApi — Zentraler API-Client für alle /api/v1/* Aufrufe
// =====================================================================
var TnetApi = (function() {
  var BASE = '/maps/tnet/api/v1';

  /**
   * Zentraler GET-Request an die TNET API
   * @param {string} endpoint - Pfad ohne Basis, z.B. 'bookmarks'
   * @param {Object} [params] - Query-Parameter als Key/Value
   * @returns {Promise<Object>} - JSON-Response {success, data, meta}
   */
  function get(endpoint, params) {
    var url = BASE + '/' + endpoint;
    if (params) {
      var qs = Object.keys(params)
        .filter(function(k) { return params[k] != null; })
        .map(function(k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); })
        .join('&');
      if (qs) url += '?' + qs;
    }
    return fetch(url).then(function(response) {
      if (!response.ok) {
        throw new Error('API ' + endpoint + ': HTTP ' + response.status + ' ' + response.statusText);
      }
      return response.json();
    });
  }

  return {
    /** Basis-URL, z.B. für relative Links */
    BASE_URL: BASE,

    /** Roher API-GET */
    get: get,

    /**
     * Einzelnen Bookmark laden
     * @param {string} name - Bookmark-ID oder Alias
     * @returns {Promise<Object>} - Bookmark-Daten {map-bookmark, basemap, layers, ...}
     */
    getBookmark: function(name) {
      return get('bookmarks', { name: name }).then(function(res) {
        if (!res.success) throw new Error(res.error && res.error.message || 'Bookmark nicht gefunden');
        return res.data;
      });
    },

    /**
     * Alle Bookmark-Namen auflisten
     * @returns {Promise<Array>} - [{name, aliases}, ...]
     */
    listBookmarks: function() {
      return get('bookmarks').then(function(res) {
        if (!res.success) throw new Error('Bookmarks konnten nicht geladen werden');
        return res.data;
      });
    },

    /**
     * Layer-Katalog laden
     * @param {Object} [options] - {group, category, flat, details, source}
     * @returns {Promise<Object>} - {data, meta}
     */
    getLayers: function(options) {
      var p = Object.assign({ source: 'db' }, options || {});
      return get('layers', p);
    },

    /**
     * Basemaps laden
     * @returns {Promise<Object>}
     */
    getBasemaps: function() {
      return get('basemaps');
    },

    /**
     * API-Info / Health-Check
     * @returns {Promise<Object>}
     */
    getInfo: function() {
      return get('info');
    }
  };
})();

/**
 * Extrahiert URL-Parameter aus einer URL oder einem Query-String
 * @param {string} urlOrQuery - Vollständige URL oder Query-String (z.B. "map=x&group=y")
 * @returns {URLSearchParams} - URLSearchParams Objekt
 */
function extractUrlParams(urlOrQuery) {
  try {
    if (!urlOrQuery) return new URLSearchParams();
    if (urlOrQuery.includes('://') || urlOrQuery.includes('?')) {
      const urlObj = new URL(urlOrQuery, window.location.origin);
      return new URLSearchParams(urlObj.search);
    }
    return new URLSearchParams(urlOrQuery);
  } catch (e) {
    return new URLSearchParams();
  }
}

/**
 * Wandelt /secmap/xyz URLs in /maps?map=xyz&group=uwpro um
 * @param {string} href - Original URL
 * @returns {string} - Konvertierte URL
 */
function convertSecmapUrl(href) {
  if (href.includes('/secmap/')) {
    const match = href.match(/^(.+?)\/secmap\/([^?#]+)(.*)$/);
    if (match) {
      const domain = match[1];
      const mapName = match[2];
      const rest = match[3] || '';
      if (rest && rest.startsWith('?')) {
        return `${domain}/maps?map=${mapName}${rest}&group=uwpro`;
      } else {
        return `${domain}/maps?map=${mapName}&group=uwpro`;
      }
    }
  }
  return href;
}

/**
 * Wandelt /map/xyz URLs in /maps?map=xyz um
 * @param {string} href - Original URL
 * @returns {string} - Konvertierte URL
 */
function convertMapUrl(href) {
  if (href.includes('/map/')) {
    const match = href.match(/^(.+?)\/map\/([^?#]+)(.*)$/);
    if (match) {
      const domain = match[1];
      const mapName = match[2];
      const rest = match[3] || '';
      if (rest && rest.startsWith('?')) {
        return `${domain}/maps?map=${mapName}${rest}`;
      } else {
        return `${domain}/maps?map=${mapName}`;
      }
    }
  }
  return href;
}

/**
 * Konvertiert alle URL-Formate
 * @param {string} href - Original URL
 * @returns {string} - Konvertierte URL
 */
function convertUrl(href) {
  let result = href;
  result = convertSecmapUrl(result);
  result = convertMapUrl(result);
  return result;
}

/**
 * Prüft ob URL einen group=*pro Parameter enthält
 * @param {string} url - URL zum Prüfen
 * @returns {boolean} - true wenn group=*pro gefunden
 */
function hasProGroup(url) {
  return /[?&]group=[^&]*pro(&|$|#)/.test(url);
}

/**
 * Verarbeitet alle Links im extrahierten Content
 * @param {string} selector - CSS Selector für Links
 */
function processExtractedLinks(selector) {
  const allLinks = document.querySelectorAll(selector);
  
  allLinks.forEach(link => {
    // Entferne target="_blank"
    if (link.getAttribute('target') === '_blank') {
      link.removeAttribute('target');
    }
    
    let onclick = link.getAttribute('onclick');
    let href = link.getAttribute('href');
    
    // Fall 1: Link hat bereits onclick mit setMapBookmark - ersetze durch TnetSetBookmark
    if (onclick && onclick.includes('setMapBookmark')) {
      // HTML-Entities dekodieren (z.B. &amp; -> &)
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = onclick;
      const decodedOnclick = tempDiv.textContent;
      
      // Extrahiere Parameter aus setMapBookmark(['main'], 'map=XXX&group=YYY')
      const match = decodedOnclick.match(/setMapBookmark\s*\(\s*\[[^\]]*\]\s*,\s*['"]([^'"]+)['"]\s*\)/);
      if (match && match[1]) {
        const params = match[1]; // z.B. "map=nw_nutzungsplanung_intern&group=uwpro"
        const urlParams = extractUrlParams(params);
        const bookmarkId = urlParams.get('map'); // z.B. "nw_nutzungsplanung_intern"
        
        if (bookmarkId) {
          // Ersetze onclick mit TnetSetBookmark Aufruf (async: Dialog erst nach Laden schliessen)
          link.setAttribute('onclick', `TnetSetBookmark('${bookmarkId}').then(function(){ window.top.closeMapsInfoDialog(); }); return false;`);
        }
      }
      return;
    }
    
    // Fall 2: Link hat href - konvertiere URL und erstelle TnetSetBookmark Aufruf
    if (href) {
      // URL konvertieren
      href = convertUrl(href);
      
      // Wandle HTTP(S) Links in TnetSetBookmark-Aufrufe um
      if (href.startsWith('http')) {
        const params = extractUrlParams(href);
        const bookmarkId = params.get('map');
        
        if (bookmarkId) {
          link.setAttribute('href', 'javascript:void(null)');
          link.setAttribute('style', (link.getAttribute('style') || '') + '; cursor: pointer;');
          link.setAttribute('onclick', `TnetSetBookmark('${bookmarkId}').then(function(){ window.top.closeMapsInfoDialog(); }); return false;`);
        } else {
          // Fallback: Alter setMapBookmark Aufruf wenn keine map-ID gefunden
          link.setAttribute('href', 'javascript:void(null)');
          link.setAttribute('style', (link.getAttribute('style') || '') + '; cursor: pointer;');
          link.setAttribute('onclick', `window.top.njs.AppManager.setMapBookmark(['main'], '${params.toString()}'); window.top.closeMapsInfoDialog(); return false;`);
        }
      } else {
        link.setAttribute('href', href);
      }
    }
  });
}

/**
 * Sammelt alle Stylesheets aus einem Dokument
 * @param {Document} doc - Dokument
 * @returns {string} - HTML mit allen Stylesheet-Links
 */
function collectStylesheets(doc) {
  return Array.from(doc.querySelectorAll('link[rel="stylesheet"]'))
    .map(link => `<link rel="stylesheet" href="${link.href}">`)
    .join('\n');
}

/**
 * Sammelt alle inline Styles aus einem Dokument
 * @param {Document} doc - Dokument
 * @returns {string} - HTML mit allen Style-Tags
 */
function collectInlineStyles(doc) {
  return Array.from(doc.querySelectorAll('style'))
    .map(style => `<style>${style.textContent}</style>`)
    .join('\n');
}

/**
 * Versucht Login-Button im iframe zu finden und zu klicken
 * @param {HTMLIFrameElement} iframe - Das iframe Element
 * @returns {boolean} - true wenn Button gefunden und geklickt
 */
function tryAutoLogin(iframe) {
  try {
    const doc = iframe.contentDocument || iframe.contentWindow.document;
    const loginBtn = doc.querySelector('a.oauthloginbutton[onclick*="moOAuthLoginNew"]');
    
    if (loginBtn) {
      loginBtn.click();
      return true;
    }
  } catch(e) {
    // Cross-origin oder iframe noch nicht bereit
  }
  return false;
}

// =====================================================================
// Bookmark: Laden & Anwenden via API
// =====================================================================

/**
 * Baut den Bookmark-Parameter-String für njs.AppManager.setMapBookmark()
 * @param {Object} cfg - Bookmark-Konfiguration aus der API
 * @returns {string} - z.B. 'basemap=av_sw&layers=layer1|layer2&theme=grundlagen'
 */
function _buildBookmarkParams(cfg) {
  var parts = [];
  if (cfg.basemap)                          parts.push('basemap=' + cfg.basemap);
  if (cfg.layers && cfg.layers.length)      parts.push('layers='  + cfg.layers.join('|'));
  if (cfg.opacity && cfg.opacity.length)    parts.push('op='      + cfg.opacity.join('|'));
  if (cfg.theme)                            parts.push('theme='   + cfg.theme);
  if (cfg.subtheme)                         parts.push('subtheme='+ cfg.subtheme);
  if (cfg.x && cfg.y) {
    parts.push('x=' + cfg.x, 'y=' + cfg.y);
    if (cfg.zoom) parts.push('zl=' + cfg.zoom);
  }
  return parts.join('&');
}

/**
 * Wendet einen Bookmark auf die Hauptkarte an (Framework-Aufruf)
 * @param {Object} cfg - Bookmark-Konfiguration
 * @param {string} bookmarkId - Bookmark-ID (für Logging/Return)
 * @returns {{success: boolean, bookmarkId: string, params: string}}
 */
function _applyBookmark(cfg, bookmarkId) {
  var params = _buildBookmarkParams(cfg);
  var am = (window.top && window.top.njs && window.top.njs.AppManager)
           ? window.top.njs.AppManager
           : (window.njs && window.njs.AppManager) ? window.njs.AppManager : null;
  if (!am) throw new Error('njs.AppManager nicht verfügbar');
  am.setMapBookmark(['main'], params);
  TnetLog.log('[TnetSetBookmark]', bookmarkId, params);
  return { success: true, bookmarkId: bookmarkId, params: params };
}

/**
 * Lädt einen Bookmark über die TNET API und setzt den Kartenstatus.
 *
 * @param {string} bookmarkId - ID oder Alias des Bookmarks
 * @returns {Promise<{success: boolean, bookmarkId?: string, params?: string, error?: string}>}
 */
function TnetSetBookmark(bookmarkId) {
  return TnetApi.getBookmark(bookmarkId)
    .then(function(cfg) { return _applyBookmark(cfg, bookmarkId); })
    .catch(function(err) {
      TnetLog.error('[TnetSetBookmark] Fehler:', err);
      return { success: false, error: err.message };
    });
}

/**
 * Layer in der Hauptkarte ein-/ausschalten oder umschalten (kein Bookmark-Lookup).
 *
 * Ablauf:
 *  - 'on':     Layer existiert bereits im OL-Layer-Stack → setVisible(true)
 *              Sonst noch nicht geladen → setMapBookmark('layers=layerId')
 *  - 'off':    Layer aus dem OL-Layer-Stack entfernen (removeLayer)
 *  - 'toggle': Aktuellen Zustand prüfen, dann on oder off
 *
 * Layer werden anhand von layer.get('name') mit der lyrmgr-ID verglichen.
 *
 * @param {string} layerId - Layer-ID aus dem Lyrmgr (z.B. 'gis_fach/nw_wald')
 * @param {string} [mode='toggle'] - 'on', 'off' oder 'toggle'
 * @returns {boolean} - Neuer Sichtbarkeitszustand: true = eingeschaltet
 */
function TnetLayerSwitch(layerId, mode) {
  mode = mode || 'toggle';

  var am = (window.njs && window.njs.AppManager)
           ? window.njs.AppManager
           : (window.top && window.top.njs && window.top.njs.AppManager)
             ? window.top.njs.AppManager
             : null;

  if (!am || !am.Maps || !am.Maps['main'] || !am.Maps['main'].mapObj) {
    TnetLog.warn('[TnetLayerSwitch] AppManager oder Map nicht verfügbar');
    return false;
  }

  var map = am.Maps['main'].mapObj;

  // Layer im OL-Stack suchen (nach 'name'-Property = lyrmgr-ID)
  var found = null;
  map.getLayers().forEach(function(layer) {
    if (!found) {
      var n = layer.get('name') || '';
      if (n === layerId) found = layer;
    }
  });

  var isCurrentlyOn = found ? found.getVisible() : false;

  var shouldTurnOn;
  if (mode === 'on') {
    shouldTurnOn = true;
  } else if (mode === 'off') {
    shouldTurnOn = false;
  } else {
    // toggle: einschalten wenn aus, ausschalten wenn an
    shouldTurnOn = !isCurrentlyOn;
  }

  if (shouldTurnOn) {
    if (found) {
      // Layer existiert bereits im Stack → sichtbar machen
      found.setVisible(true);
      TnetLog.log('[TnetLayerSwitch] Layer eingeblendet:', layerId);
    } else {
      // Noch nicht im Stack → über LyrMgr (Layer-Manager) laden.
      // WICHTIG: setMapBookmark NICHT verwenden — setzt gesamten Kartenstatus zurück.
      // LyrMgr ist in njs.AppManager.LyrMgr gespeichert, NICHT auf dem Map-Objekt.
      var targetLyrMgr = null;
      if (am.LyrMgr) {
        for (var lm in am.LyrMgr) {
          if (am.LyrMgr[lm].targetMap && dojo.indexOf(am.LyrMgr[lm].targetMap, 'main') > -1) {
            targetLyrMgr = am.LyrMgr[lm];
            break;
          }
        }
      }
      if (targetLyrMgr && typeof targetLyrMgr.switchLayersProgr === 'function') {
        targetLyrMgr.switchLayersProgr(layerId, null, true);
        TnetLog.log('[TnetLayerSwitch] Layer via LyrMgr.switchLayersProgr geladen:', layerId);
      } else {
        TnetLog.warn('[TnetLayerSwitch] LyrMgr nicht verfügbar für:', layerId);
        return false;
      }
    }
    return true;
  } else {
    // Ausschalten: über ClassicLayerMgr.switchLayer auf ALLEN LayerManagern
    // (nw, ow, bund, divers etc. targeten alle 'main')
    var lyrMgrHandled = false;
    if (am.LyrMgr) {
      for (var lmOff in am.LyrMgr) {
        var mgr = am.LyrMgr[lmOff];
        if (mgr.targetMap && dojo.indexOf(mgr.targetMap, 'main') > -1 &&
            typeof mgr.switchLayer === 'function') {
          mgr.switchLayer(layerId, false);
          TnetLog.log('[TnetLayerSwitch] switchLayer(false) auf LyrMgr:', lmOff, layerId);
          lyrMgrHandled = true;
        }
      }
    }
    if (!lyrMgrHandled) {
      // Fallback: direktes Entfernen wenn kein LyrMgr verfügbar
      if (found) {
        map.removeLayer(found);
        TnetLog.log('[TnetLayerSwitch] Layer direkt entfernt (kein LyrMgr):', layerId);
      } else {
        TnetLog.log('[TnetLayerSwitch] Layer war bereits aus:', layerId);
      }
    }
    return false;
  }
}
