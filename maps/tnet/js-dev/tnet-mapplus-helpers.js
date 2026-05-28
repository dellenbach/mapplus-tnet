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
  function getAppRoot() {
    return window.__TNET_APP_ROOT || '/maps';
  }

  var BASE = getAppRoot() + '/tnet/api/v1';

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
     * @returns {Promise<Object>} - Bookmark-Daten (Schema v2): {id, basemap, layers:[{id,visible,opacity,order,filter}], aliases?, viewport?, views?, theme?, subtheme?, themes?, meta?}
     */
    getBookmark: function(name) {
      return get('bookmarks', { name: name }).then(function(res) {
        if (!res.success) throw new Error(res.error && res.error.message || 'Bookmark nicht gefunden');
        return res.data;
      });
    },

    /**
     * Alle Bookmark-Namen auflisten
     * @returns {Promise<Array>} - [{id, name?, aliases?}, ...]
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
          // Fallback: Bei API-Fehler (Bookmark nicht gefunden) → direkter Framework-Aufruf mit Original-Parametern
          link.setAttribute('onclick', `TnetSetBookmark('${bookmarkId}').then(function(r){ if(!r.success){ console.warn('[processLinks] TnetSetBookmark fehlgeschlagen, Fallback auf Framework-Aufruf:', '${bookmarkId}'); window.top.njs.AppManager.setMapBookmark(['main'], '${params}'); } window.top.closeMapsInfoDialog(); }); return false;`);
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
          // Fallback: Bei API-Fehler → direkter Framework-Aufruf mit Original-URL-Parametern
          link.setAttribute('onclick', `TnetSetBookmark('${bookmarkId}').then(function(r){ if(!r.success){ console.warn('[processLinks] TnetSetBookmark fehlgeschlagen, Fallback:', '${bookmarkId}'); window.top.njs.AppManager.setMapBookmark(['main'], '${params.toString()}'); } window.top.closeMapsInfoDialog(); }); return false;`);
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
function _normalizeBookmarkLayerIds(layerIds) {
  if (!layerIds || !layerIds.length) return [];
  var normalized = layerIds
    .map(function(layerId) {
      // Schema v2: Layer ist ein Objekt {id, visible, opacity, ...}.
      // Schema v1: Layer ist ein reiner ID-String. Beides akzeptieren.
      if (layerId && typeof layerId === 'object') layerId = layerId.id;
      return String(layerId || '').replace(/^[-\s]+/, '').trim();
    })
    .filter(function(layerId) { return !!layerId; });

  // Nur deduplizieren: Child-IDs bleiben erhalten, da sie in manchen
  // Bookmarks die gewünschte Sub-Layer-Auswahl steuern.
  var unique = [];
  var seen = {};
  normalized.forEach(function(id) {
    if (!seen[id]) {
      seen[id] = true;
      unique.push(id);
    }
  });

  return unique;
}

var _bookmarkEnsureTimers = [];
var _bookmarkEnsureToken = 0;

function _cancelBookmarkEnsureTimers() {
  for (var i = 0; i < _bookmarkEnsureTimers.length; i++) {
    clearTimeout(_bookmarkEnsureTimers[i]);
  }
  _bookmarkEnsureTimers = [];
}

function _scheduleBookmarkLayerEnsure(layerIds, token) {
  if (!layerIds || !layerIds.length) return;

  var retries = [500, 1500, 3000, 5000, 8000];
  retries.forEach(function(delay) {
    var timer = setTimeout(function() {
      if (token !== _bookmarkEnsureToken) return;
      if (typeof window.TnetLayerSwitch !== 'function') return;
      layerIds.forEach(function(layerId) {
        try {
          window.TnetLayerSwitch(layerId, 'on');
        } catch (e) {
          TnetLog.warn('[TnetSetBookmark] Layer-Ensure fehlgeschlagen:', layerId, e && e.message ? e.message : e);
        }
      });
    }, delay);
    _bookmarkEnsureTimers.push(timer);
  });
}

/**
 * Variante des Ensure-Mechanismus, die per-Layer Sichtbarkeit (on/off) setzt.
 * Erlaubt das Konzept "Layer wird vom Bookmark geladen, ist aber initial unsichtbar"
 * und das Anwenden einer Kartenansicht (views[].layerStates).
 * @param {Object<string, boolean>} visibilityMap - {layerId: visible}
 * @param {number} token
 */
function _scheduleBookmarkVisibilityEnsure(visibilityMap, token) {
  var ids = visibilityMap ? Object.keys(visibilityMap) : [];
  if (!ids.length) return;

  var retries = [500, 1500, 3000, 5000, 8000];
  retries.forEach(function(delay) {
    var timer = setTimeout(function() {
      if (token !== _bookmarkEnsureToken) return;
      if (typeof window.TnetLayerSwitch !== 'function') return;
      ids.forEach(function(layerId) {
        var state = visibilityMap[layerId] ? 'on' : 'off';
        try {
          window.TnetLayerSwitch(layerId, state);
        } catch (e) {
          TnetLog.warn('[TnetSetBookmark] Visibility-Ensure fehlgeschlagen:', layerId, state, e && e.message ? e.message : e);
        }
      });
    }, delay);
    _bookmarkEnsureTimers.push(timer);
  });
}

/**
 * Aktive Kartenansicht aus cfg auflösen.
 *  - Wenn viewId angegeben und View existiert: diese
 *  - Sonst: erste View mit isDefault:true
 *  - Sonst: null (Layer-Defaults greifen)
 * @param {Object} cfg
 * @param {string|null} viewId
 * @returns {Object|null}
 */
function _resolveActiveBookmarkView(cfg, viewId) {
  var views = cfg && cfg.views;
  if (!views || !views.length) return null;
  if (viewId) {
    for (var i = 0; i < views.length; i++) {
      if (views[i] && views[i].id === viewId) return views[i];
    }
  }
  for (var j = 0; j < views.length; j++) {
    if (views[j] && views[j].isDefault === true) return views[j];
  }
  return null;
}

/**
 * Berechnet die Soll-Sichtbarkeit aller Layer:
 *  Default = cfg.layers[i].visible (oder true bei v1-Strings)
 *  Übersteuert von activeView.layerStates[id].visible (falls vorhanden)
 * @param {Object} cfg
 * @param {Object|null} activeView
 * @returns {Object<string, boolean>}
 */
function _computeBookmarkVisibility(cfg, activeView) {
  var result = {};
  var layers = (cfg && cfg.layers) || [];
  var states = (activeView && activeView.layerStates) || null;

  layers.forEach(function(l) {
    if (!l) return;
    var id, visible;
    if (typeof l === 'object') {
      id = l.id;
      visible = ('visible' in l) ? !!l.visible : true;
    } else {
      id = String(l);
      visible = true;
    }
    if (!id) return;
    if (states && Object.prototype.hasOwnProperty.call(states, id)) {
      var ov = states[id];
      if (ov && 'visible' in ov) visible = !!ov.visible;
    }
    result[id] = visible;
  });
  return result;
}

function _clearThematicLayersBeforeBookmark() {
  // Stabiler Clear-Pfad ohne per-Layer-Races.
  try {
    if (window.TnetLMStore && typeof window.TnetLMStore.removeAllLayers === 'function') {
      window.TnetLMStore.removeAllLayers();
      TnetLog.log('[TnetSetBookmark] Fachlayer via LMStore.removeAllLayers geleert');
      return;
    }
  } catch (eStore) {
    TnetLog.warn('[TnetSetBookmark] removeAllLayers fehlgeschlagen:', eStore && eStore.message ? eStore.message : eStore);
  }

  // Fallback ohne setMapBookmark('layers='), damit keine Bookmark-Hooks
  // den eigentlichen Kartenwechsel überlagern.
  try {
    var am = (window.top && window.top.njs && window.top.njs.AppManager)
      ? window.top.njs.AppManager
      : (window.njs && window.njs.AppManager) ? window.njs.AppManager : null;
    var map = am && am.Maps && am.Maps.main && am.Maps.main.mapObj;
    if (map && typeof map.getLayers === 'function') {
      var cleared = 0;
      map.getLayers().forEach(function (layer) {
        if (!layer || typeof layer.get !== 'function' || typeof layer.getVisible !== 'function') return;
        var name = layer.get('name') || '';
        if (!name || !layer.getVisible()) return;

        var isThematic = name.indexOf('/') !== -1 || name.indexOf('ch.') === 0;
        if (!isThematic) return;

        try {
          if (typeof window.TnetLayerSwitch === 'function') {
            window.TnetLayerSwitch(name, 'off');
          } else {
            layer.setVisible(false);
          }
          cleared++;
        } catch (eOff) {
          TnetLog.warn('[TnetSetBookmark] Fallback-Clear fehlgeschlagen:', name, eOff && eOff.message ? eOff.message : eOff);
        }
      });
      if (cleared > 0) {
        TnetLog.log('[TnetSetBookmark] Fachlayer via Map-Fallback geleert:', cleared);
      }
    }
  } catch (eMap) {
    TnetLog.warn('[TnetSetBookmark] Map-Fallback-Clear fehlgeschlagen:', eMap && eMap.message ? eMap.message : eMap);
  }
}

function _buildBookmarkParams(cfg) {
  var parts = [];
  var normalizedLayers = _normalizeBookmarkLayerIds(cfg.layers || []);
  if (cfg.basemap)                          parts.push('basemap=' + cfg.basemap);
  if (normalizedLayers.length)              parts.push('layers='  + normalizedLayers.join('|'));

  // Opacity:
  //  - v1: cfg.opacity ist Array paralleler Werte zur Layer-Liste
  //  - v2: opacity ist pro Layer (cfg.layers[i].opacity). Wir bauen das Array hier.
  var opacityList = null;
  if (cfg.opacity && cfg.opacity.length) {
    opacityList = cfg.opacity;
  } else if (cfg.layers && cfg.layers.length && typeof cfg.layers[0] === 'object') {
    var hasAny = false;
    var derived = cfg.layers.map(function (l) {
      if (l && l.opacity != null) { hasAny = true; return l.opacity; }
      return '';
    });
    if (hasAny) opacityList = derived;
  }
  if (opacityList && opacityList.length) parts.push('op=' + opacityList.join('|'));

  if (cfg.theme)                            parts.push('theme='   + cfg.theme);
  if (cfg.subtheme)                         parts.push('subtheme='+ cfg.subtheme);

  // Viewport: v1 flach (cfg.x/y/zoom), v2 verschachtelt (cfg.viewport.x/y/zoom).
  var vp = (cfg.viewport && typeof cfg.viewport === 'object') ? cfg.viewport : cfg;
  if (vp.x && vp.y) {
    parts.push('x=' + vp.x, 'y=' + vp.y);
    if (vp.zoom) parts.push('zl=' + vp.zoom);
  }
  return parts.join('&');
}

/**
 * Wendet einen Bookmark auf die Hauptkarte an (Framework-Aufruf)
 * @param {Object} cfg - Bookmark-Konfiguration (v2)
 * @param {string} bookmarkId - Bookmark-ID (für Logging/Return)
 * @param {string|null} [viewId] - optionale Kartenansicht (überstüpfelt isDefault-View)
 * @returns {{success: boolean, bookmarkId: string, viewId: string|null, params: string}}
 */
function _applyBookmark(cfg, bookmarkId, viewId) {
  var params = _buildBookmarkParams(cfg);
  var layerIds = _normalizeBookmarkLayerIds(cfg.layers || []);
  var activeView = _resolveActiveBookmarkView(cfg, viewId || null);
  var visibilityMap = _computeBookmarkVisibility(cfg, activeView);

  var ensureToken;
  var am = (window.top && window.top.njs && window.top.njs.AppManager)
           ? window.top.njs.AppManager
           : (window.njs && window.njs.AppManager) ? window.njs.AppManager : null;
  if (!am) throw new Error('njs.AppManager nicht verfügbar');
  // Stub: FloatingPane ist bei URL-Bookmarks noch nicht geladen
  if (typeof am.infoFloatWinRemoveallItems !== 'function') {
      am.infoFloatWinRemoveallItems = function() {};
  }

  _cancelBookmarkEnsureTimers();
  _bookmarkEnsureToken += 1;
  ensureToken = _bookmarkEnsureToken;

  _clearThematicLayersBeforeBookmark();

  am.setMapBookmark(['main'], params);
  // Sichtbarkeit pro Layer durchsetzen (lädt alle, schaltet 'visible:false' wieder aus).
  // Fällt auf die alte "alle on"-Logik zurück, wenn keine Sichtbarkeits-Differenzen existieren.
  var hasAnyOff = false;
  for (var id in visibilityMap) {
    if (visibilityMap[id] === false) { hasAnyOff = true; break; }
  }
  if (hasAnyOff || activeView) {
    _scheduleBookmarkVisibilityEnsure(visibilityMap, ensureToken);
  } else if (layerIds.length) {
    _scheduleBookmarkLayerEnsure(layerIds, ensureToken);
  }

  var activeViewId = activeView ? activeView.id : null;
  TnetLog.log('[TnetSetBookmark]', bookmarkId + (activeViewId ? '/' + activeViewId : ''), params);

  // Themen im Themenbaum aufklappen (falls vorhanden)
  if (cfg.themes && window.TnetLMTree && typeof window.TnetLMTree.expandThemes === 'function') {
    setTimeout(function () {
      window.TnetLMTree.expandThemes(cfg.themes);
    }, 500);
  }
  return { success: true, bookmarkId: bookmarkId, viewId: activeViewId, params: params };
}

/**
 * Lädt einen Bookmark über die TNET API und setzt den Kartenstatus.
 *
 * @param {string} bookmarkId - ID oder Alias des Bookmarks
 * @param {string|null} [viewId] - optionale Kartenansicht (Schema v2: views[].id)
 * @returns {Promise<{success: boolean, bookmarkId?: string, viewId?: string|null, params?: string, error?: string}>}
 */
function TnetSetBookmark(bookmarkId, viewId) {
  // Wenn der Aufruf aus dem Karten-Dialog-iframe kommt, die eigentliche
  // Bookmark-Logik im Top-Window ausführen. Sonst wird das iframe beim
  // Dialog-Close entladen und der laufende Request abgebrochen.
  if (window.top && window.top !== window && typeof window.top.TnetSetBookmark === 'function') {
    try { window.top.__tnetLastRequestedBookmark = bookmarkId; } catch (eTopReq) { /* ignore */ }
    return window.top.TnetSetBookmark(bookmarkId, viewId);
  }

  window.__tnetLastRequestedBookmark = bookmarkId;
  if (window.top) {
    try { window.top.__tnetLastRequestedBookmark = bookmarkId; } catch (eTop) { /* ignore */ }
  }

  // Dialog sofort schliessen, damit der Wechsel auch bei API-Retries/Fallback sauber wirkt.
  try {
    if (typeof window.closeMapsInfoDialog === 'function') window.closeMapsInfoDialog();
    if (window.top && typeof window.top.closeMapsInfoDialog === 'function') window.top.closeMapsInfoDialog();
  } catch (eClose) { /* ignore */ }

  function fallbackDirectMapBookmark() {
    try {
      var am = (window.top && window.top.njs && window.top.njs.AppManager)
        ? window.top.njs.AppManager
        : (window.njs && window.njs.AppManager) ? window.njs.AppManager : null;
      if (!am || typeof am.setMapBookmark !== 'function') return false;
      if (typeof am.infoFloatWinRemoveallItems !== 'function') {
        am.infoFloatWinRemoveallItems = function() {};
      }
      am.setMapBookmark(['main'], 'map=' + encodeURIComponent(bookmarkId));
      TnetLog.warn('[TnetSetBookmark] API-Fallback auf Framework map= angewendet:', bookmarkId);
      return true;
    } catch (eFallback) {
      TnetLog.warn('[TnetSetBookmark] API-Fallback fehlgeschlagen:', eFallback && eFallback.message ? eFallback.message : eFallback);
      return false;
    }
  }

  return TnetApi.getBookmark(bookmarkId)
    .then(function(cfg) { return _applyBookmark(cfg, bookmarkId, viewId || null); })
    .catch(function(err) {
      TnetLog.error('[TnetSetBookmark] Fehler:', err);
      if (fallbackDirectMapBookmark()) {
        return { success: true, bookmarkId: bookmarkId, fallback: true };
      }
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

      // Map-Render forcieren damit OL-Source initialisiert wird.
      // Ohne dies kann getFeatureInfoUrl() null zurückgeben bis die Source
      // zum ersten Mal gerendert wurde (erklärt warum Zoom-out/in das Problem löst).
      try {
        if (typeof map.renderSync === 'function') {
          map.renderSync();
        } else {
          map.render();
        }
      } catch (eRender) { /* noop */ }

      // setVisible() löst kein OL 'add'-Event aus → Framework's addLayerCallback
      // läuft nicht → MapTips bleiben inaktiv. Wir simulieren den add-Event manuell
      // auf allen MapTips, deren linked_layer_id zum layerId passt. Dadurch laufen
      // fldLookup-Preload, zoomEndListener-Registration und _setActiveIfVisible.
      try {
        if (am.MapTips) {
          var fakeEvt = { element: found };
          for (var mtId in am.MapTips) {
            if (!am.MapTips.hasOwnProperty(mtId)) continue;
            if (mtId === '_wms_connector' || mtId === '_disablewmsgetfeatureinfo') continue;
            var mt = am.MapTips[mtId];
            if (!mt) continue;
            var mtLinked = mt.linked_layer_id || mt.linked_layer;
            if (mtLinked !== layerId) continue;
            if (typeof mt.addLayerCallback === 'function') {
              mt.addLayerCallback(fakeEvt);
              TnetLog.log('[TnetLayerSwitch] addLayerCallback simuliert für MapTip:', mtId);
            }
          }
        }
      } catch (eCb) {
        TnetLog.warn('[TnetLayerSwitch] addLayerCallback-Simulation fehlgeschlagen:', eCb.message);
      }

      // Zusätzlicher Sync als Sicherheitsnetz (für Prefix-Match-Fälle)
      TnetScheduleSyncMapTips(200);
    } else {
      // Noch nicht im Stack → über LyrMgr (Layer-Manager) laden.
      // WICHTIG: setMapBookmark NICHT verwenden — setzt gesamten Kartenstatus zurück.
      // LyrMgr ist in njs.AppManager.LyrMgr gespeichert, NICHT auf dem Map-Objekt.
      // WICHTIG: Es gibt mehrere LyrMgr (main, second, third, forth), die alle
      // 'main' als targetMap haben. Der Layer kann in JEDEM davon registriert sein.
      // → Alle durchsuchen und denjenigen nehmen, der den Layer kennt.
      var targetLyrMgr = null;
      if (am.LyrMgr) {
        for (var lm in am.LyrMgr) {
          var mgr = am.LyrMgr[lm];
          if (mgr.targetMap && dojo.indexOf(mgr.targetMap, 'main') > -1 &&
              typeof mgr.getLayerById === 'function') {
            var lyrObj = mgr.getLayerById(layerId);
            if (lyrObj) {
              targetLyrMgr = mgr;
              TnetLog.log('[TnetLayerSwitch] Layer gefunden in LyrMgr:', lm);
              break;
            }
          }
        }
      }
      if (targetLyrMgr && typeof targetLyrMgr.switchLayersProgr === 'function') {
        targetLyrMgr.switchLayersProgr(layerId, null, true);
        TnetLog.log('[TnetLayerSwitch] Layer via LyrMgr.switchLayersProgr geladen:', layerId);
      } else {
        // Fallback: Layer in keinem LyrMgr gefunden → auf allen versuchen
        var anyMgr = false;
        if (am.LyrMgr) {
          for (var lmFb in am.LyrMgr) {
            var mgrFb = am.LyrMgr[lmFb];
            if (mgrFb.targetMap && dojo.indexOf(mgrFb.targetMap, 'main') > -1 &&
                typeof mgrFb.switchLayersProgr === 'function') {
              mgrFb.switchLayersProgr(layerId, null, true);
              anyMgr = true;
            }
          }
        }
        if (!anyMgr) {
          TnetLog.warn('[TnetLayerSwitch] LyrMgr nicht verfügbar für:', layerId);
          return false;
        }
        TnetLog.log('[TnetLayerSwitch] Layer via Fallback (alle LyrMgr) versucht:', layerId);
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

// =====================================================================
// TnetSyncMapTips — Einheitlicher MapTip-Sync für ALLE Layer-Typen
// =====================================================================
//
// Konzept:
//   1. Layer-Sichtbarkeit prüfen (OL-Layer auf der Karte)
//   2. Triage: Für jeden MapTip-Eintrag entscheiden WIE die Abfrage läuft
//      - MapTips MIT eigenem wms_layer (Activate() hat ihn gebaut) → NIE überschreiben
//      - MapTips OHNE wms_layer (nur linked_layer_id) → Karten-Layer zuweisen
//      - Coalesce-Layer → Bridge verwaltet diese selbstständig
//   3. wmsActiveLyrs in Sync bringen mit der Karte
//
// Performance:
//   - Ein einziger Durchlauf über MapTips + Karten-Layer
//   - Debounced (300ms default) bei Bulk-Operationen
//   - Kein DOM-Zugriff, nur JS-Objekte
//
// Funktioniert für ALLE Quellen:
//   - TNET ArcGIS MapServer (agsproxy) — esrigeojson
//   - WMS (Bund, NODI, Kantone) — getfeatureinfo
//   - Geoadmin (swissadmingeojson)
//   - Coalesce-Layer (übersprungen, Bridge managed)
// =====================================================================

var _syncDebounceTimer = null;
var _syncRunCount = 0;

function TnetSyncMapTips() {
  var am = window.njs && window.njs.AppManager;
  if (!am || !am.MapTips || !am.wmsActiveLyrs || !am.Maps || !am.Maps['main']) return;

  var map = am.Maps['main'].mapObj;
  if (!map) return;

  _syncRunCount++;
  var runId = _syncRunCount;

  // ── Schritt 0: singleclick-Handler ──
  // Wenn Info-Bridge aktiv → KEINEN Framework-Handler registrieren (Bridge übernimmt).
  // Nur im Legacy-Modus (ohne Bridge) den Framework-Handler sicherstellen.
  if (!window._tnetInfoBridgeActive) {
    if (!am.infoWMSListener && typeof am.infoWMSHandler === 'function') {
      am.infoWMSListener = map.on('singleclick', am.infoWMSHandler.bind({ idmap: 'main' }));
      TnetLog.log('[SyncMT #' + runId + '] Framework infoWMSHandler manuell registriert (Legacy)');
    }
  }

  // ── Schritt 1: Karten-Layer Index aufbauen ──
  // Alle OL-Layer nach Name indexieren:
  //   visibleLayers: name → olLayer (nur sichtbare)
  //   allLayersByName: name → olLayer (alle, auch unsichtbare)
  var visibleLayers = {};   // name → olLayer
  var allLayersByName = {}; // name → olLayer
  map.getLayers().forEach(function (layer) {
    var name = layer.get('name');
    if (!name) return;
    allLayersByName[name] = layer;
    if (typeof layer.getVisible === 'function' && layer.getVisible()) {
      visibleLayers[name] = layer;
    }
  });

  // ── Prefix-Matching Hilfsfunktion ──
  // MapTip linked_layer_id ist oft ein Sublayer-Key (z.B. 'gis_fach/nw_fff/fruchtfolgeflaeche')
  // aber der OL-Layer auf der Karte hat den Parent-Key (z.B. 'gis_fach/nw_fff').
  // Diese Funktion prüft zuerst exakt, dann probiert sukzessive kürzere Parent-Pfade.
  function findMatchingVisibleLayer(linkedLayerId) {
    // 1. Exakter Match
    if (visibleLayers[linkedLayerId]) {
      return { name: linkedLayerId, olLayer: visibleLayers[linkedLayerId], exact: true };
    }
    // 2. Prefix-Match: Parent-Pfade versuchen
    var parts = linkedLayerId.split('/');
    while (parts.length > 1) {
      parts.pop();
      var parentKey = parts.join('/');
      if (visibleLayers[parentKey]) {
        return { name: parentKey, olLayer: visibleLayers[parentKey], exact: false };
      }
    }
    return null;
  }

  // ── Schritt 2: Coalesce-Check vorbereiten ──
  var store = window.TnetLMStore;
  var isCoalesce = (store && typeof store.isCoalesceSublayer === 'function')
    ? function (id) { return store.isCoalesceSublayer(id); }
    : function () { return false; };

  // ── Schritt 3: Triage — jeden MapTip einzeln behandeln ──
  var activated = 0, deactivated = 0, skippedCoalesce = 0, prefixMatched = 0;

  for (var mtId in am.MapTips) {
    if (!am.MapTips.hasOwnProperty(mtId)) continue;
    // Interne Framework-Keys überspringen
    if (mtId === '_wms_connector' || mtId === '_disablewmsgetfeatureinfo') continue;

    var mt = am.MapTips[mtId];
    // Das Framework setzt linked_layer_id erst bei der ersten Aktivierung via addLayerCallback.
    // Maptips die noch nie aktiviert wurden haben nur linked_layer (raw config).
    // → linked_layer als Fallback verwenden und auf linked_layer_id normalisieren.
    if (!mt) continue;
    if (!mt.linked_layer_id && mt.linked_layer) {
      mt.linked_layer_id = mt.linked_layer;
    }
    if (!mt.linked_layer_id) continue;

    // ── Coalesce: Bridge hat eigenen Mechanismus (_forceActivateMaptip) ──
    if (isCoalesce(mt.linked_layer_id)) {
      skippedCoalesce++;
      continue;
    }

    // ── Triage: Soll dieser MapTip aktiv sein? ──
    // Prefix-Matching: Wenn der exakte linked_layer_id nicht sichtbar ist,
    // versuche den Parent-Pfad (z.B. 'gis_fach/nw_fff/sublayer' → 'gis_fach/nw_fff')
    var linkedLayerId = mt.linked_layer_id;
    var match = findMatchingVisibleLayer(linkedLayerId);
    var shouldBeActive = !!match;

    // Resolution-Check: Wenn MapTip min/maxResolution hat, nur im Bereich aktiv
    if (shouldBeActive && (mt.minResolution || mt.maxResolution)) {
      var currentResol = map.getView().getResolution();
      if (mt.minResolution && currentResol < mt.minResolution) shouldBeActive = false;
      if (mt.maxResolution && currentResol > mt.maxResolution) shouldBeActive = false;
    }

    // ── AKTIVIEREN ──
    if (shouldBeActive && !mt.active) {
      // wms_layer setzen, wenn es noch nicht gesetzt ist:
      //   - Prefix-Match: Parent-OL-Layer zuweisen (Sublayer ist nicht im LyrMgr)
      //   - Exakter Match: OL-Layer direkt zuweisen, falls Framework's Activate()
      //     noch nicht lief (passiert bei setVisible(true) ohne addLayerCallback →
      //     queryconnector würde sonst getLayerByMap() aufrufen, das vor dem
      //     ersten Render leere Ergebnisse liefert).
      // Wenn mt.url existiert, hat Activate() schon gelaufen → wms_layer nicht anfassen.
      if (match && !mt.wms_layer && !mt.url) {
        mt.wms_layer = match.olLayer;
        if (!match.exact) {
          mt._tnetParentMatch = match.name; // Logging-Marker für Prefix-Match
          prefixMatched++;
        }
      }
      am.wmsActiveLyrs.push(mt);
      mt.active = true;
      activated++;
    }
    // ── DEAKTIVIEREN ──
    else if (!shouldBeActive && mt.active) {
      // wms_layer zurücksetzen wenn wir es via Prefix-Match gesetzt hatten
      if (mt._tnetParentMatch) {
        mt.wms_layer = null;
        delete mt._tnetParentMatch;
      }
      am.wmsActiveLyrs.remove(mt);
      mt.active = false;
      deactivated++;
    }
  }

  // ── Duplikat-Bereinigung in wmsActiveLyrs ──
  // Race-Condition: addLayerCallback kann parallel feuern → gleicher MapTip doppelt
  // WICHTIG: Nur IDENTISCHE MapTips sind Duplikate. Mehrere MapTips mit gleichem
  // linked_layer_id aber unterschiedlichen query_layers (z.B. liegenschaften_eigentuemer_nw
  // vs _ow) sind KEINE Duplikate — sie decken verschiedene Kantone/Abfragen ab.
  // → Dedup-Key aus linked_layer_id + query_layers + id zusammensetzen und
  //   Referenz-Identität zusätzlich prüfen.
  var seen = {};
  var seenRefs = [];
  var dupes = [];
  am.wmsActiveLyrs.getArray().forEach(function (mt, idx) {
    // 1. Exakte Referenz-Duplikate (echte Race-Condition-Dupes)
    if (seenRefs.indexOf(mt) !== -1) {
      dupes.push(mt);
      return;
    }
    seenRefs.push(mt);
    // 2. Inhaltlich identische MapTips (gleicher linked_layer_id + query_layers + id)
    var key = (mt.linked_layer_id || '') + '|' + (mt.query_layers || '') + '|' + (mt.id || 'idx_' + idx);
    if (seen[key]) {
      dupes.push(mt);
    }
    seen[key] = true;
  });
  for (var d = 0; d < dupes.length; d++) {
    am.wmsActiveLyrs.remove(dupes[d]);
  }

  if (activated > 0 || deactivated > 0 || dupes.length > 0 || prefixMatched > 0) {
    TnetLog.log('[SyncMT #' + runId + '] +' + activated + ' -' + deactivated +
      ' prefix:' + prefixMatched +
      ' dupes:' + dupes.length +
      ' coal:' + skippedCoalesce +
      ' total:' + am.wmsActiveLyrs.getLength());
  }
}

/**
 * Debounced Variante von TnetSyncMapTips.
 * Verhindert dass bei Bulk-Operationen (z.B. restoreFromUrl) hunderte Syncs feuern.
 * @param {number} [delay=300] - Verzögerung in ms
 */
function TnetScheduleSyncMapTips(delay) {
  if (_syncDebounceTimer) clearTimeout(_syncDebounceTimer);
  _syncDebounceTimer = setTimeout(function () {
    _syncDebounceTimer = null;
    TnetSyncMapTips();
  }, delay || 300);
}

// ── Auto-Init: Nach App-Start MapTips synchronisieren ──
// Mehrere Zeitpunkte weil Layer/MapTips schrittweise geladen werden.
// Zusätzlich: Listener auf Layer-Add/Remove für laufende Sync.
(function _initSyncMapTips() {
  var INIT_DELAYS = [800, 2000, 4000, 8000];
  var _listenerInstalled = false;

  function scheduleSync(idx) {
    if (idx >= INIT_DELAYS.length) return;
    setTimeout(function () {
      TnetSyncMapTips();
      scheduleSync(idx + 1);
    }, INIT_DELAYS[idx]);
  }

  function installLayerListeners() {
    if (_listenerInstalled) return;
    var am = window.njs && window.njs.AppManager;
    if (!am || !am.Maps || !am.Maps['main'] || !am.Maps['main'].mapObj) return;
    _listenerInstalled = true;

    var map = am.Maps['main'].mapObj;
    // Bei jedem Layer-Add/Remove: debounced Sync
    map.getLayers().on('add', function () { TnetScheduleSyncMapTips(400); });
    map.getLayers().on('remove', function () { TnetScheduleSyncMapTips(400); });
    TnetLog.log('[SyncMT] Layer-Add/Remove-Listener installiert');
  }

  function startInit() {
    scheduleSync(0);
    // Listener mit kurzem Delay installieren (Map muss bereit sein)
    setTimeout(installLayerListeners, 1500);
    setTimeout(installLayerListeners, 4000); // Fallback
  }

  // Auf tnet-app-ready warten, dann mehrfach syncen
  document.addEventListener('tnet-app-ready', function () {
    startInit();
  }, { once: true });

  // Fallback falls Event nie feuert
  setTimeout(function () {
    if (!_listenerInstalled) startInit();
  }, 5000);
})();

// ===== NAVIGIEREN OL-MAP RESIZE =====
// OL-Karte in #ovWin wurde in verborgenem Container initialisiert.
// Beim ersten Öffnen des NAVIGIEREN-Panels updateSize() aufrufen.
(function () {
  function resizeOvMaps() {
    var am = window.njs && njs.AppManager;
    if (!am) return;

    // (1) Alle registrierten Maps in AppManager.Maps durchsuchen
    if (am.Maps) {
      Object.keys(am.Maps).forEach(function (id) {
        var m = am.Maps[id];
        if (m && m.mapObj && typeof m.mapObj.updateSize === 'function') {
          m.mapObj.updateSize();
          m.mapObj.render();
        }
        // Falls mapObj die Target-Element #ovWin ist — explizit erfassen
        if (m && m.mapObj && typeof m.mapObj.getTargetElement === 'function') {
          var tgt = m.mapObj.getTargetElement();
          if (tgt && tgt.id === 'ovWin') {
            m.mapObj.updateSize();
            m.mapObj.render();
          }
        }
      });
    }

    // (2) Direktzugriff über bekannte OV-Map-Property-Namen auf AppManager
    var ovCandidates = ['ovMap', 'ov_map', 'overviewMap', 'OvMap', 'OVMap', 'ov_main'];
    ovCandidates.forEach(function (key) {
      var candidate = am[key] || (am.Maps && am.Maps[key]);
      if (candidate) {
        var mapObj = candidate.mapObj || candidate;
        if (mapObj && typeof mapObj.updateSize === 'function') {
          mapObj.updateSize();
          if (typeof mapObj.render === 'function') mapObj.render();
        }
      }
    });

    // (3) OL OverviewMap-Control auf der Hauptkarte suchen
    var mainMap = am.Maps && am.Maps['main'] && am.Maps['main'].mapObj;
    if (mainMap && typeof mainMap.getControls === 'function') {
      mainMap.getControls().forEach(function (ctrl) {
        if (typeof ctrl.getOverviewMap === 'function') {
          var ovOl = ctrl.getOverviewMap();
          if (ovOl && typeof ovOl.updateSize === 'function') {
            ovOl.updateSize();
            ovOl.render();
          }
        }
      });
    }

    // (4) OL-Karte direkt im #ovWin-Container suchen (über .ol-viewport)
    var ovWin = document.getElementById('ovWin');
    if (ovWin) {
      var vp = ovWin.querySelector('.ol-viewport');
      if (vp) {
        // OL speichert manchmal die Map-Instanz auf dem Element
        var possibleKeys = ['_ol_map', '__olmap__', 'olMap', 'map', '$$olMap', '__map__'];
        possibleKeys.forEach(function (k) {
          if (vp[k] && typeof vp[k].updateSize === 'function') {
            vp[k].updateSize();
            if (typeof vp[k].render === 'function') vp[k].render();
          }
        });
        // OL intern: target-Element selbst prüfen
        possibleKeys.forEach(function (k) {
          if (ovWin[k] && typeof ovWin[k].updateSize === 'function') {
            ovWin[k].updateSize();
            if (typeof ovWin[k].render === 'function') ovWin[k].render();
          }
        });
      }
    }

    // (5) Zuverlässigstes Fallback: window-resize-Event dispatchen.
    // Alle OL-Karten lauschen auf dieses Event und rufen updateSize() selbst auf.
    try {
      window.dispatchEvent(new Event('resize'));
    } catch (e) { /* ignorieren */ }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var ovDetails = document.getElementById('tp_ov_menu');
    if (!ovDetails) return;
    ovDetails.addEventListener('toggle', function () {
      if (this.open) {
        // Mehrfache Versuche: CSS display:block muss zuerst greifen
        setTimeout(resizeOvMaps, 80);
        setTimeout(resizeOvMaps, 350);
        setTimeout(resizeOvMaps, 900);
      }
    });
  });
})();
