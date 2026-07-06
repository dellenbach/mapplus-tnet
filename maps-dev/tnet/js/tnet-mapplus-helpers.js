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
     * Bookmark V2 laden — mit Hierarchie-Tree, NLS-Namen und Profil-Filter.
     * Liefert serviceGroups[].tree[] statt layers[].
     * @param {string} name - Bookmark-ID oder Alias
     * @param {string} [profile] - Profil-Code (z.B. 'public', 'nwpro') — Default aus URL ?group=
     * @returns {Promise<Object>} - Bookmark-Daten V2 mit serviceGroups[].tree[]
     */
    getBookmarkV2: function(name, profile) {
      var p = profile || TnetApi.getActiveProfile();
      return get('bookmarks', { name: name, source: 'db', hierarchy: '2', profile: p, names: '1' }).then(function(res) {
        if (!res.success) throw new Error(res.error && res.error.message || 'Bookmark nicht gefunden');
        return res.data;
      });
    },

    /**
     * Aktives Profil aus URL lesen (?group=xxx), Default: 'public'.
     * @returns {string}
     */
    getActiveProfile: function() {
      try {
        var params = new URLSearchParams(
          (window.top && window.top.location ? window.top.location : window.location).search
        );
        var g = params.get('group');
        return (g && g.trim()) ? g.trim() : 'public';
      } catch (e) {
        return 'public';
      }
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

  // Nur 2 Retries, möglichst schnell. Framework lädt im setMapBookmark-Aufruf
  // direkt, Ensure-Calls sind nur Race-Absicherung.
  var retries = [300, 1200];
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
 * Wartet bis die OL-Layer geladen sind (via map.getLayers events) und wendet dann
 * EINMALIG die View-Visibility an. Robuster als Timer-Retries gegen das asynchrone
 * Framework-Service-Loading.
 *
 * @param {Object<string, boolean>} visibilityMap
 * @param {number} token
 */
function _scheduleViewVisibilityWhenLayersReady(visibilityMap, token) {
  var am = (window.top && window.top.njs && window.top.njs.AppManager)
            ? window.top.njs.AppManager
            : (window.njs && window.njs.AppManager) ? window.njs.AppManager : null;
  var map = am && am.Maps && am.Maps['main'] && am.Maps['main'].mapObj;
  if (!map || typeof map.getLayers !== 'function') return;

  // IDs der erwarteten Layer (für die wir Visibility setzen müssen)
  var needIds = Object.keys(visibilityMap || {});
  if (!needIds.length) return;

  // Funktion zum Anwenden: schaltet Visibility für alle Layer die JETZT in der Map sind
  function applyOnce() {
    if (token !== _bookmarkEnsureToken) return false;
    var olByName = {};
    map.getLayers().forEach(function(olLayer) {
      if (!olLayer || typeof olLayer.get !== 'function') return;
      var n = olLayer.get('name') || '';
      if (n) olByName[n] = olLayer;
    });
    var foundAll = true;
    needIds.forEach(function(layerId) {
      var should = !!visibilityMap[layerId];
      // visible:false → Store-API (Coalesce-faehig), unabhaengig vom OL-Lookup
      if (!should) {
        _setBookmarkLayerEye(layerId, false);
        return;
      }
      var olLayer = olByName[layerId];
      if (!olLayer) { foundAll = false; return; }
      if (typeof olLayer.setVisible === 'function' && olLayer.getVisible() !== should) {
        olLayer.setVisible(should);
        if (window.TnetLMStore && typeof window.TnetLMStore._emit === 'function') {
          try {
            window.TnetLMStore._emit('layer-visibility', { id: layerId, visible: should, source: 'bookmark-init' });
          } catch (eEmit) { /* ignore */ }
        }
      }
    });
    return foundAll;
  }

  // Initial-Versuch + bei jedem Layer-Add nochmal probieren (bis alle gefunden)
  var coll = map.getLayers();
  var addKey;
  function onAdd() {
    if (token !== _bookmarkEnsureToken) {
      if (addKey && typeof coll.un === 'function') coll.un('add', onAdd);
      return;
    }
    if (applyOnce()) {
      // Fertig — Listener entfernen
      if (addKey && typeof coll.un === 'function') coll.un('add', onAdd);
    }
  }
  // Erster Versuch (sofort) — falls schon alle Layer da, sind wir fertig
  if (!applyOnce()) {
    // Sonst auf weitere Layer-Adds reagieren
    if (typeof coll.on === 'function') {
      addKey = coll.on('add', onAdd);
    }
    // Sicherheits-Timeout: nach 15s aufgeben
    setTimeout(function() {
      if (addKey && typeof coll.un === 'function') {
        try { coll.un('add', onAdd); } catch (e) {}
      }
    }, 15000);
  }
}

/**
 * Variante des Ensure-Mechanismus, die invisible Layer (visible:false) direkt
 * per OL-API ausschaltet — ohne sie aus dem LMStore._activeLayers zu entfernen.
 * Der Layer bleibt im Karteninhalt aufgelistet, nur das Augen-Icon zeigt "aus".
 *
 * Hintergrund: TnetLayerSwitch('off') würde den Layer aus _activeLayers entfernen
 * (TOC-Eintrag verschwindet). Wir wollen aber den Bookmark-Layer-Stack als Inhalt
 * im Karteninhalt behalten, mit per-Layer-Visibility.
 *
 * @param {Object<string, boolean>} visibilityMap - {layerId: visible}
 * @param {number} token
 */
// ===== BOOKMARK-LAYER VISIBILITY (Coalesce-faehig) =====

/**
 * Setzt die Sichtbarkeit eines Bookmark-Layers ueber die Store-API.
 *
 * Wichtig: Viele OEREB-Layer sind Coalesce-Sublayer (gemeinsamer WMS-Layer,
 * gesteuert ueber den LAYERS-Param) und existieren NICHT als eigener OL-Layer.
 * Ein direktes map.getLayers()-Lookup + setVisible() findet diese Sublayer
 * nicht. Daher wird die Store-API toggleLayerEye() genutzt — sie behandelt
 * Coalesce-Sublayer (hideSublayer/LAYERS-Param) UND Standard-Layer korrekt,
 * behaelt den Layer im TOC (outlined-eye statt entfernt) und emittiert die
 * passenden Events.
 *
 * Da toggleLayerEye() toggelt (kein direktes Set), wird vorher die effektive
 * Sichtbarkeit geprueft und nur bei Abweichung umgeschaltet.
 *
 * @param {string} layerId
 * @param {boolean} shouldBeVisible Zielzustand
 * @returns {boolean} true, wenn eine Aenderung vorgenommen wurde
 */
function _setBookmarkLayerEye(layerId, shouldBeVisible) {
  var store = window.TnetLMStore;
  if (!store) return false;

  // Bevorzugt idempotenter Setter: reconciled den echten Karten-Render und
  // vertraut NICHT dem (evtl. desynchronen) gespeicherten Store-Zustand.
  if (typeof store.setLayerEye === 'function') {
    try {
      return store.setLayerEye(layerId, !!shouldBeVisible);
    } catch (eSet) {
      return false;
    }
  }

  // Fallback (aeltere Store-Version ohne setLayerEye): toggeln per Guard.
  if (typeof store.toggleLayerEye !== 'function') return false;
  var isVisible;
  try {
    isVisible = typeof store._getEffectiveLayerVisible === 'function'
      ? !!store._getEffectiveLayerVisible(layerId)
      : null;
  } catch (eVis) { isVisible = null; }
  if (isVisible === null) return false;
  if (isVisible === !!shouldBeVisible) return false;
  try {
    store.toggleLayerEye(layerId);
    return true;
  } catch (eToggle) {
    return false;
  }
}

function _scheduleBookmarkVisibilityEnsure(visibilityMap, token) {
  var ids = visibilityMap ? Object.keys(visibilityMap) : [];
  if (!ids.length) return;

  var retries = [400, 1200, 3000, 6000];
  retries.forEach(function(delay) {
    var timer = setTimeout(function() {
      if (token !== _bookmarkEnsureToken) return;
      var am = (window.top && window.top.njs && window.top.njs.AppManager)
                ? window.top.njs.AppManager
                : (window.njs && window.njs.AppManager) ? window.njs.AppManager : null;
      var map = am && am.Maps && am.Maps['main'] && am.Maps['main'].mapObj;
      var changedAny = false;
      if (!map || typeof map.getLayers !== 'function') return;

      // Nur visible:false-Layer korrigieren. visible:true-Layer sind durch den
      // Framework-Load bereits geladen/sichtbar und werden nicht angetastet.
      ids.forEach(function(layerId) {
        var should = !!visibilityMap[layerId];
        if (should) return; // sichtbare Layer in Ruhe lassen
        if (_setBookmarkLayerEye(layerId, false)) {
          changedAny = true;
          // Bookmark-Runtime-State mitziehen (fuer korrekte Diagnose/Persistenz)
          try {
            var bookmark = window.__tnetActiveBookmark;
            if (bookmark && Array.isArray(bookmark.layers)) {
              for (var bi = 0; bi < bookmark.layers.length; bi++) {
                if (bookmark.layers[bi] && bookmark.layers[bi].id === layerId) {
                  bookmark.layers[bi].visible = false;
                  break;
                }
              }
            }
          } catch (eBmSync) { /* ignore */ }
        }
      });

      if (changedAny && window.TnetLMStore && typeof window.TnetLMStore._emit === 'function' &&
          typeof window.TnetLMStore.getActiveLayers === 'function') {
        try {
          window.TnetLMStore._emit('active-layers-changed', window.TnetLMStore.getActiveLayers());
        } catch (eActiveEmit) { /* ignore */ }
      }
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

// ===== VIEW-URL-PERSISTENZ =====
// Das Mapplus-Framework schreibt bei Kartenaenderungen die Permalink-URL neu
// und kennt den v2-Parameter 'view=' nicht -> er ginge verloren. Daher
// history.replaceState/pushState einmalig kapseln und ein aktives 'view='
// bei jedem URL-Schreibvorgang wieder anhaengen (bzw. beim Wechsel zur
// Default-View entfernen).
var _viewUrlGuardInstalled = false;
var _bookmarkUrlSyncInstalled = false;
var _bookmarkUrlSyncInstallTimer = null;
var _bookmarkUrlSyncTimer = null;
var _bookmarkUrlSyncSignature = null;

/**
 * Liefert die aktuell zu persistierende (nicht-default) View-Id oder null.
 * @returns {string|null}
 */
function _getActiveViewIdForUrl() {
  var v = window.__tnetActiveViewForUrl;
  if (v == null && window.top && window.top !== window) {
    try { v = window.top.__tnetActiveViewForUrl; } catch (e) { v = null; }
  }
  return v || null;
}

/**
 * Setzt/entfernt den 'view='-Parameter in einer (ggf. relativen) URL.
 * @param {string} str - URL oder Query-String
 * @param {string|null} viewId - View-Id setzen, oder null zum Entfernen
 * @returns {string}
 */
function _stripOrSetView(str, viewId) {
  var hashIdx = str.indexOf('#');
  var hash = hashIdx >= 0 ? str.slice(hashIdx) : '';
  var base = hashIdx >= 0 ? str.slice(0, hashIdx) : str;
  var qIdx = base.indexOf('?');
  var path = qIdx >= 0 ? base.slice(0, qIdx) : base;
  var query = qIdx >= 0 ? base.slice(qIdx + 1) : '';
  var parts = query ? query.split('&') : [];
  var kept = [];
  for (var i = 0; i < parts.length; i++) {
    if (!parts[i]) continue;
    if (parts[i].indexOf('view=') === 0) continue; // alten view= verwerfen
    kept.push(parts[i]);
  }
  if (viewId) kept.push('view=' + encodeURIComponent(viewId));
  return path + (kept.length ? '?' + kept.join('&') : '') + hash;
}

/**
 * URL-Argument fuer history.* so anpassen, dass ein aktives view= erhalten
 * bleibt. Bei url == null (Framework aendert URL nicht) unveraendert lassen.
 * @param {string|null|undefined} url
 * @returns {string|null|undefined}
 */
function _ensureViewInUrlString(url) {
  if (url == null) return url;
  return _stripOrSetView(String(url), _getActiveViewIdForUrl());
}

function _getActiveBookmarkForUrlGuard() {
  var bookmark = window.__tnetActiveBookmark || null;
  if (!bookmark && window.top && window.top !== window) {
    try { bookmark = window.top.__tnetActiveBookmark || null; } catch (eTopBm) { bookmark = null; }
  }
  return bookmark;
}

function _ensureBookmarkOpInUrlString(url) {
  var bookmark = _getActiveBookmarkForUrlGuard();
  var next = url == null ? '' : String(url);
  var originalOp = bookmark && bookmark._options && bookmark._options.originalOp
    ? String(bookmark._options.originalOp)
    : '';
  var visibleLayers = [];
  var currentOp = '';

  if (!next || !bookmark || !(bookmark._options && bookmark._options.urlOverride)) return next;

  try {
    var absolute = new URL(next, window.location.href);
    visibleLayers = (absolute.searchParams.get('layers') || '').split('|').filter(function(id) { return !!id; });
    currentOp = absolute.searchParams.get('op') || '';
    if (!originalOp && window.__tnetOriginalUrlOp) originalOp = String(window.__tnetOriginalUrlOp || '');

    next = absolute.pathname + absolute.search + absolute.hash;
    if (originalOp) {
      next = _setRawQueryParam(next, 'op', (visibleLayers.length && originalOp.split('|').length === visibleLayers.length) ? originalOp : '');
    } else if (currentOp && currentOp.split('|').length !== visibleLayers.length) {
      next = _setRawQueryParam(next, 'op', '');
    }
  } catch (eUrlGuard) { /* ignore */ }

  return next;
}

/**
 * history.replaceState/pushState einmalig kapseln (idempotent).
 */
function _installViewUrlGuard() {
  if (_viewUrlGuardInstalled) return;
  var hist = (window.top && window.top.history) ? window.top.history : window.history;
  if (!hist || typeof hist.replaceState !== 'function') return;
  var origReplace = hist.replaceState;
  var origPush = hist.pushState;
  hist.replaceState = function (state, title, url) {
    var u = url;
    try {
      u = _ensureViewInUrlString(url);
      u = _ensureBookmarkOpInUrlString(u);
    } catch (e) { u = url; }
    return origReplace.call(this, state, title, u);
  };
  if (typeof origPush === 'function') {
    hist.pushState = function (state, title, url) {
      var u = url;
      try {
        u = _ensureViewInUrlString(url);
        u = _ensureBookmarkOpInUrlString(u);
      } catch (e) { u = url; }
      return origPush.call(this, state, title, u);
    };
  }
  _viewUrlGuardInstalled = true;
}

/**
 * Merkt die aktuell aktive (nicht-default) View-Id fuer die URL-Persistenz
 * und korrigiert die aktuelle URL sofort.
 * @param {Object|null} activeView - aufgeloeste View (oder null)
 * @param {string|null} requestedViewId - explizit angeforderte View-Id
 */
function _setActiveViewForUrl(activeView, requestedViewId) {
  var viewIdForUrl = (activeView && activeView.isDefault !== true && requestedViewId)
    ? activeView.id
    : null;
  window.__tnetActiveViewForUrl = viewIdForUrl;
  if (window.top && window.top !== window) {
    try { window.top.__tnetActiveViewForUrl = viewIdForUrl; } catch (e) { /* ignore */ }
  }
  _installViewUrlGuard();
  // Aktuelle URL sofort angleichen (set oder strip).
  try {
    var hist = (window.top && window.top.history) ? window.top.history : window.history;
    var loc = (window.top && window.top.location) ? window.top.location : window.location;
    if (hist && typeof hist.replaceState === 'function') {
      hist.replaceState(null, '', _stripOrSetView(loc.pathname + loc.search + loc.hash, viewIdForUrl));
    }
  } catch (e2) { /* ignore */ }
}

function _setRawQueryParam(url, key, value) {
  var hashIdx = url.indexOf('#');
  var hash = hashIdx >= 0 ? url.slice(hashIdx) : '';
  var base = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
  var qIdx = base.indexOf('?');
  var path = qIdx >= 0 ? base.slice(0, qIdx) : base;
  var query = qIdx >= 0 ? base.slice(qIdx + 1) : '';
  var parts = query ? query.split('&') : [];
  var kept = [];

  for (var i = 0; i < parts.length; i++) {
    if (!parts[i]) continue;
    if (parts[i].indexOf(key + '=') === 0) continue;
    kept.push(parts[i]);
  }
  if (value != null && value !== '') kept.push(key + '=' + value);
  return path + (kept.length ? '?' + kept.join('&') : '') + hash;
}

function _syncBookmarkLayersToUrl() {
  var bookmark = window.__tnetActiveBookmark;
  if (!bookmark || !Array.isArray(bookmark.layers)) return;

  _mergeStoreLayersIntoActiveBookmark();

  var visibleIds = [];
  var seen = {};

  bookmark.layers.forEach(function(layer) {
    if (!layer || !layer.id || layer.visible === false) return;
    if (seen[layer.id]) return;
    seen[layer.id] = true;
    visibleIds.push(layer.id);
  });

  if (bookmark._options) bookmark._options.visibleLayerIds = visibleIds.slice();
  _bookmarkUrlSyncSignature = visibleIds.join('|');

  try {
    var hist = (window.top && window.top.history) ? window.top.history : window.history;
    var loc = (window.top && window.top.location) ? window.top.location : window.location;
    if (!hist || typeof hist.replaceState !== 'function' || !loc) return;

    var startupFreeze = !!(
      bookmark._options && bookmark._options.urlOverride &&
      bookmark._loadUntil && Date.now() < bookmark._loadUntil &&
      (!visibleIds.length || (bookmark._options.originalVisibleLayerIds && visibleIds.length < bookmark._options.originalVisibleLayerIds.length))
    );
    if (startupFreeze) return;

    var next = loc.pathname + loc.search + loc.hash;
    if (bookmark._resetFromBookmarkDefault && !(bookmark._options && bookmark._options.urlOverride)) {
      next = _setRawQueryParam(next, 'layers', '');
      next = _setRawQueryParam(next, 'op', '');
      if (next !== loc.pathname + loc.search + loc.hash) {
        hist.replaceState(null, '', next);
      }
      return;
    }
    var originalOp = bookmark._options && bookmark._options.originalOp ? String(bookmark._options.originalOp) : '';
    var currentOp = '';
    try {
      currentOp = new URL(loc.href).searchParams.get('op') || '';
    } catch (eUrl) { currentOp = ''; }
    if (!originalOp && window.__tnetOriginalUrlOp) originalOp = String(window.__tnetOriginalUrlOp || '');
    next = _setRawQueryParam(next, 'layers', visibleIds.join('|'));
    if (originalOp) {
      var originalOpCount = originalOp.split('|').length;
      next = _setRawQueryParam(next, 'op', (visibleIds.length && originalOpCount === visibleIds.length) ? originalOp : '');
    } else if (currentOp) {
      var currentOpCount = currentOp.split('|').length;
      if (!visibleIds.length || currentOpCount !== visibleIds.length) {
        next = _setRawQueryParam(next, 'op', '');
      }
    }
    if (next !== loc.pathname + loc.search + loc.hash) {
      hist.replaceState(null, '', next);
    }
  } catch (eUrlSync) { /* URL-Sync ist defensiv */ }
}

function _getBookmarkUrlSyncSignature() {
  var bookmark = window.__tnetActiveBookmark;
  var visibleIds = [];
  var seen = {};
  if (!bookmark || !Array.isArray(bookmark.layers)) return '';

  bookmark.layers.forEach(function(layer) {
    if (!layer || !layer.id || layer.visible === false || seen[layer.id]) return;
    seen[layer.id] = true;
    visibleIds.push(layer.id);
  });

  return visibleIds.join('|');
}

function _getInitialBookmarkUrlLayersSignature() {
  var initialSignature = '';
  try {
    initialSignature = String(window.__tnetInitialUrlLayers || '');
  } catch (eWinInitial) { initialSignature = ''; }
  if (!initialSignature) {
    try {
      if (window.top && window.top !== window) initialSignature = String(window.top.__tnetInitialUrlLayers || '');
    } catch (eTopInitial) { initialSignature = ''; }
  }
  if (!initialSignature) {
    try {
      initialSignature = String(window.__tnetInitialUrlQuery ? new URLSearchParams(window.__tnetInitialUrlQuery).get('layers') || '' : '');
    } catch (eQueryInitial) { initialSignature = ''; }
  }
  return initialSignature;
}

function _disableInitialBookmarkUrlGuards() {
  function disableOnScope(scope) {
    if (!scope) return;
    try { scope.__tnetInitialOpHistoryGuardEnabled = false; } catch (eHistGuard) { /* ignore */ }
    try { scope.__tnetInitialBookmarkOpGuardEnabled = false; } catch (eBookmarkGuard) { /* ignore */ }
    try { if (scope.__tnetInitialUrlGuardUntil) scope.__tnetInitialUrlGuardUntil = Date.now(); } catch (eGuardUntil) { /* ignore */ }
  }

  disableOnScope(window);
  try {
    if (window.top && window.top !== window) disableOnScope(window.top);
  } catch (eTopScope) { /* cross-origin */ }
}

function _maybeDisableInitialBookmarkUrlGuards(evt) {
  var source = evt && evt.source ? String(evt.source) : '';
  var nextSignature = _getBookmarkUrlSyncSignature();
  var initialSignature = _getInitialBookmarkUrlLayersSignature();
  if (!nextSignature || !initialSignature || nextSignature === initialSignature) return;
  if (source === 'bookmark-init') return;
  _disableInitialBookmarkUrlGuards();
}

function _scheduleBookmarkLayersUrlSyncIfChanged() {
  var nextSignature = _getBookmarkUrlSyncSignature();
  if (nextSignature === _bookmarkUrlSyncSignature) return;
  _scheduleBookmarkLayersUrlSync();
}

function _scheduleBookmarkLayersUrlSync() {
  if (!_bookmarkUrlSyncInstalled) _installBookmarkUrlSync();
  if (_bookmarkUrlSyncTimer) clearTimeout(_bookmarkUrlSyncTimer);
  _bookmarkUrlSyncTimer = setTimeout(function() {
    _bookmarkUrlSyncTimer = null;
    _syncBookmarkLayersToUrl();
  }, 120);
}

function _findRuntimeBookmarkLayer(layerId) {
  var bookmark = window.__tnetActiveBookmark;
  if (!bookmark || !Array.isArray(bookmark.layers) || !layerId) return null;
  for (var i = 0; i < bookmark.layers.length; i++) {
    if (bookmark.layers[i] && bookmark.layers[i].id === layerId) return bookmark.layers[i];
  }
  return null;
}

function _mergeStoreLayersIntoActiveBookmark() {
  var bookmark = window.__tnetActiveBookmark;
  var store = window.TnetLMStore;
  var activeLayers = store && typeof store.getActiveLayers === 'function'
    ? store.getActiveLayers()
    : [];
  var byId = {};

  if (!bookmark || !Array.isArray(bookmark.layers) || !activeLayers || !activeLayers.length) return;

  bookmark.layers.forEach(function(layer) {
    if (layer && layer.id) byId[layer.id] = layer;
  });

  activeLayers.forEach(function(layer) {
    if (!layer || !layer.id) return;
    if (byId[layer.id]) {
      // Nur positive Sichtbarkeit aus dem Store in den Bookmark-Runtime-State
      // uebernehmen. Negative Zustandsflips kommen in diesem Legacy-Stack oft
      // aus transienten map/remove-Events waehrend Rebuild/Reconcile und sind
      // keine belastbare Benutzerintention.
      if (layer.visible === true) byId[layer.id].visible = true;
      if (layer.opacity != null && isFinite(layer.opacity)) byId[layer.id].opacity = +layer.opacity;
    }
  });
}

function _installBookmarkUrlSync() {
  var store = window.TnetLMStore;
  if (_bookmarkUrlSyncInstalled || !store || typeof store.on !== 'function') return;
  if (_bookmarkUrlSyncInstallTimer) {
    clearTimeout(_bookmarkUrlSyncInstallTimer);
    _bookmarkUrlSyncInstallTimer = null;
  }

  store.on('layer-visibility', function(evt) {
    var layerId = evt && (evt.id || evt.layerId);
    var runtimeLayer = _findRuntimeBookmarkLayer(layerId);
    var source = evt && evt.source ? String(evt.source) : '';
    if (!runtimeLayer || !evt || !('visible' in evt)) return;
    // Defensive: map-getriebene false-Events (OL remove/recreate) duerfen den
    // Bookmark-Runtime-State nicht auf AUS ziehen.
    if (source === 'map' && evt.visible === false) return;
    runtimeLayer.visible = !!evt.visible;
    _maybeDisableInitialBookmarkUrlGuards(evt);
    _scheduleBookmarkLayersUrlSyncIfChanged();
  });

  store.on('layer-opacity', function(evt) {
    var layerId = evt && (evt.id || evt.layerId);
    var runtimeLayer = _findRuntimeBookmarkLayer(layerId);
    if (!runtimeLayer || !evt || evt.opacity == null || !isFinite(evt.opacity)) return;
    runtimeLayer.opacity = Math.max(0, Math.min(1, +evt.opacity));
  });

  store.on('active-layers-changed', function() {
    _mergeStoreLayersIntoActiveBookmark();
    _scheduleBookmarkLayersUrlSyncIfChanged();
  });

  _bookmarkUrlSyncInstalled = true;
}

function _ensureBookmarkUrlSyncInstalled() {
  if (_bookmarkUrlSyncInstalled) return;
  _installBookmarkUrlSync();
  if (_bookmarkUrlSyncInstalled || _bookmarkUrlSyncInstallTimer) return;
  _bookmarkUrlSyncInstallTimer = setTimeout(function() {
    _bookmarkUrlSyncInstallTimer = null;
    _ensureBookmarkUrlSyncInstalled();
  }, 200);
}

/**
 * Prueft, ob ein Layer fuer das aktuelle Profil gesperrt ist (kein Zugriff).
 * Gesperrte Layer liefern in layers.php url:"secured" und tragen die Flags
 * locked / accessDenied / secured. Solche Layer duerfen nie geladen werden.
 * @param {Object} store - TnetLMStore
 * @param {string} layerId
 * @returns {boolean}
 */
function _isBookmarkLayerLocked(store, layerId) {
  if (!store || typeof store.findLayer !== 'function' || !layerId) return false;
  var catalogLayer;
  try {
    catalogLayer = store.findLayer(layerId);
  } catch (eLockCheck) {
    catalogLayer = null;
  }
  if (!catalogLayer) return false;
  return catalogLayer.locked === true
    || catalogLayer.accessDenied === true
    || catalogLayer.secured === true;
}

/**
 * Berechnet die Soll-Sichtbarkeit aller Layer:
 *  Default = cfg.layers[i].visible (oder true bei v1-Strings)
 *  Übersteuert von activeView.layerStates[id].visible (falls vorhanden)
 * @param {Object} cfg
 * @param {Object|null} activeView
 * @param {Object|null} options
 * @returns {Object<string, boolean>}
 */
function _computeBookmarkVisibility(cfg, activeView, options) {
  var result = {};
  var layers = (cfg && cfg.layers) || [];
  var allIds = layers.map(function(l) {
    return (l && typeof l === 'object') ? l.id : String(l || '');
  }).filter(function(id) { return !!id; });
  var storeRef = window.TnetLMStore;
  var states = (activeView && activeView.layerStates) || null;
  var explicitVisibleMap = null;
  var explicitIds = [];
  var whitelistMode = false;

  if (options && options.visibleLayerIds && options.visibleLayerIds.length) {
    explicitIds = options.visibleLayerIds.map(function(layerId) {
      return String(layerId || '').replace(/^[-\s]+/, '').trim();
    }).filter(function(normalizedId) { return !!normalizedId; });
  }

  if (explicitIds.length) {
    explicitVisibleMap = {};
    explicitIds.forEach(function(normalized) {
      explicitVisibleMap[normalized] = true;
    });
  }

  // Nicht-Default-Views werden im Bestand teils als Whitelist gespeichert:
  // layerStates enthaelt dann nur explizit sichtbare Layer (visible:true).
  // In diesem Fall duerfen nicht genannte Layer NICHT vom Default erben.
  if (!explicitVisibleMap && states && activeView && activeView.isDefault === false) {
    var stateKeys = Object.keys(states);
    if (stateKeys.length) {
      whitelistMode = stateKeys.every(function(stateId) {
        var entry = states[stateId];
        return !!(entry && typeof entry === 'object' && entry.visible === true);
      });
    }
  }

  layers.forEach(function(l) {
    if (!l) return;
    var id, visible;
    var explicitLayerVisible = false;
    if (typeof l === 'object') {
      id = l.id;
      visible = ('visible' in l) ? !!l.visible : true;
      explicitLayerVisible = ('visible' in l) && !!l.visible;
    } else {
      id = String(l);
      visible = true;
    }
    if (!id) return;
    if (states && Object.prototype.hasOwnProperty.call(states, id)) {
      var stateEntry = states[id];
      if (stateEntry && typeof stateEntry === 'object' && stateEntry.visible === true) {
        explicitLayerVisible = true;
      }
    }
    // Strukturelle Parent-IDs (nur Container fuer Unterlayer) nicht als
    // eigenstaendige Sichtbarkeits-Layer behandeln.
    if (_isStructuralBookmarkLayerId(id, allIds, storeRef) && !explicitLayerVisible) return;
    if (whitelistMode) {
      visible = false;
    }
    if (states && Object.prototype.hasOwnProperty.call(states, id)) {
      var ov = states[id];
      if (ov && 'visible' in ov) visible = !!ov.visible;
    }
    if (explicitVisibleMap) {
      visible = !!explicitVisibleMap[id];
    }
    // Gesperrte Layer (kein Zugriff fuer dieses Profil) nie aktivieren —
    // auch nicht ueber Bookmark, View-Wechsel oder URL-Override (layers=).
    if (visible && _isBookmarkLayerLocked(storeRef, id)) {
      visible = false;
    }
    result[id] = visible;
  });
  return result;
}

function _isStructuralBookmarkLayerId(layerId, allIds, store) {
  if (!layerId || !Array.isArray(allIds) || !allIds.length) return false;
  // Renderbare IDs (Katalog/Store) niemals als Strukturknoten wegfiltern.
  if (store && typeof store.isRenderableLayerId === 'function' && store.isRenderableLayerId(layerId)) {
    return false;
  }
  var prefix = layerId + '/';
  for (var i = 0; i < allIds.length; i++) {
    var otherId = allIds[i];
    if (!otherId || otherId === layerId) continue;
    if (otherId.indexOf(prefix) === 0) return true;
  }
  return false;
}

function _copyOwnProps(target, source) {
  if (!target || !source) return target;
  Object.keys(source).forEach(function(key) {
    target[key] = source[key];
  });
  return target;
}

function _normalizeOpacityValue(value) {
  if (value === null || value === undefined || value === '') return null;
  var opacity = Number(value);
  if (!isFinite(opacity)) return null;
  return Math.max(0, Math.min(1, opacity));
}

function _getLayerConfigOpacity(store, layerId) {
  var catalogLayer;
  var opacity;
  if (!store || typeof store.findLayer !== 'function' || !layerId) return null;
  try {
    catalogLayer = store.findLayer(layerId);
  } catch (eFindLayer) {
    catalogLayer = null;
  }
  if (!catalogLayer) return null;
  if (catalogLayer._configOpacity !== undefined) opacity = catalogLayer._configOpacity;
  else if (catalogLayer.options && catalogLayer.options.opacity !== undefined) opacity = catalogLayer.options.opacity;
  else if (catalogLayer.opacity !== undefined) opacity = catalogLayer.opacity;
  else opacity = null;
  return _normalizeOpacityValue(opacity);
}

function _getBookmarkRuntimeSeed(cfg) {
  var previous = window.__tnetActiveBookmark;
  if (!previous || !cfg || !cfg.id) return [];
  if (previous.id !== cfg.id) return [];
  if (!Array.isArray(previous.layers)) return [];
  return previous.layers;
}

function _buildBookmarkRuntimeLayers(cfg, activeView, options) {
  var visibilityMap = _computeBookmarkVisibility(cfg, activeView, options);
  var store = window.TnetLMStore;
  var v1Opacity = (cfg && cfg.opacity && cfg.opacity.length) ? cfg.opacity : null;
  var allIds = ((cfg && cfg.layers) || []).map(function(entry) {
    return (entry && typeof entry === 'object') ? entry.id : String(entry || '');
  }).filter(function(id) { return !!id; });
  var explicitIds = (options && options.visibleLayerIds && options.visibleLayerIds.length)
    ? options.visibleLayerIds.map(function(id) { return String(id || '').replace(/^[-\s]+/, '').trim(); }).filter(function(id) { return !!id; })
    : [];
  var explicitOpacity = {};
  var previous = _getBookmarkRuntimeSeed(cfg);
  var prevById = {};
  var runtimeById = {};

  previous.forEach(function(layer) {
    if (layer && layer.id) prevById[layer.id] = layer;
  });

  if (options && options.opacityValues && options.opacityValues.length) {
    explicitIds.forEach(function(layerId, index) {
      var op = Number(options.opacityValues[index]);
      if (isFinite(op)) explicitOpacity[layerId] = Math.max(0, Math.min(1, op));
    });
  }

  var runtimeLayers = ((cfg && cfg.layers) || []).map(function(entry, index) {
    var spec = (entry && typeof entry === 'object') ? entry : { id: String(entry || '') };
    var layerId = spec.id || '';
    var catalogLayer = (store && typeof store.findLayer === 'function' && layerId)
      ? store.findLayer(layerId)
      : null;
    var bookmarkOpacity = (spec && spec.opacity != null)
      ? _normalizeOpacityValue(spec.opacity)
      : (v1Opacity ? _normalizeOpacityValue(v1Opacity[index]) : null);
    var configOpacity = _getLayerConfigOpacity(store, layerId);
    var previousLayer = layerId ? prevById[layerId] : null;
    var runtimeLayer = {};
    var shouldKeepStructural;

    if (!layerId) return null;
    shouldKeepStructural = Object.prototype.hasOwnProperty.call(visibilityMap, layerId)
      ? !!visibilityMap[layerId]
      : false;
    if (_isStructuralBookmarkLayerId(layerId, allIds, store) && !shouldKeepStructural) return null;

    _copyOwnProps(runtimeLayer, catalogLayer || {});
    _copyOwnProps(runtimeLayer, previousLayer || {});
    _copyOwnProps(runtimeLayer, spec);

    runtimeLayer.id = layerId;
    runtimeLayer.name = runtimeLayer.name || layerId.split('/').pop() || layerId;
    runtimeLayer.visible = Object.prototype.hasOwnProperty.call(visibilityMap, layerId)
      ? !!visibilityMap[layerId]
      : (runtimeLayer.visible !== false);
    // Gesperrte Layer (kein Zugriff) bleiben als gesperrter Eintrag im Karten-
    // inhalt sichtbar (Schloss), werden aber nie gerendert (siehe _buildBookmarkParams).
    // So bleibt die Bookmark-Referenz erhalten und nach einem Login mit Zugriff
    // zeigt dasselbe Bookmark den Layer korrekt an.
    if (_isBookmarkLayerLocked(store, layerId)) {
      runtimeLayer.locked = true;
      runtimeLayer.visible = false;
    }
    if (Object.prototype.hasOwnProperty.call(explicitOpacity, layerId)) {
      runtimeLayer.opacity = explicitOpacity[layerId];
    } else if (bookmarkOpacity !== null) {
      runtimeLayer.opacity = bookmarkOpacity;
    } else if (configOpacity !== null) {
      runtimeLayer.opacity = configOpacity;
    }

    if (runtimeLayer.opacity == null || !isFinite(runtimeLayer.opacity)) {
      runtimeLayer.opacity = 1;
    } else {
      runtimeLayer.opacity = _normalizeOpacityValue(runtimeLayer.opacity);
    }

    runtimeLayer.order = (runtimeLayer.order != null && isFinite(runtimeLayer.order))
      ? +runtimeLayer.order
      : index;
    runtimeById[layerId] = runtimeLayer;
    return runtimeLayer;

  }).filter(function(layer) { return !!(layer && layer.id); });

  explicitIds.forEach(function(layerId) {
    var catalogLayer, previousLayer, runtimeLayer, configOpacity;
    var lockedLayer = _isBookmarkLayerLocked(store, layerId);
    if (runtimeById[layerId]) return;
    catalogLayer = (store && typeof store.findLayer === 'function') ? store.findLayer(layerId) : null;
    configOpacity = _getLayerConfigOpacity(store, layerId);
    previousLayer = prevById[layerId] || null;
    runtimeLayer = {};
    _copyOwnProps(runtimeLayer, catalogLayer || {});
    _copyOwnProps(runtimeLayer, previousLayer || {});
    runtimeLayer.id = layerId;
    runtimeLayer.name = runtimeLayer.name || layerId.split('/').pop() || layerId;
    // Gesperrte Layer bleiben als gesperrter Eintrag (Schloss) sichtbar,
    // werden aber nicht gerendert.
    runtimeLayer.visible = !lockedLayer;
    if (lockedLayer) runtimeLayer.locked = true;
    if (Object.prototype.hasOwnProperty.call(explicitOpacity, layerId)) runtimeLayer.opacity = explicitOpacity[layerId];
    else if (configOpacity !== null) runtimeLayer.opacity = configOpacity;
    if (runtimeLayer.opacity == null || !isFinite(runtimeLayer.opacity)) runtimeLayer.opacity = 1;
    else runtimeLayer.opacity = _normalizeOpacityValue(runtimeLayer.opacity);
    runtimeLayers.push(runtimeLayer);
    runtimeById[layerId] = runtimeLayer;
  });

  // Safety-Net: Falls durch transienten Merge/Filter alle Runtime-Layer auf
  // invisible kippen, explizite Bookmark-Defaults erneut anwenden.
  if (!runtimeLayers.some(function(layer) { return layer && layer.visible !== false; })) {
    ((cfg && cfg.layers) || []).forEach(function(entry) {
      var layerId;
      var entryVisible;
      if (!entry || typeof entry !== 'object') return;
      layerId = entry.id;
      entryVisible = ('visible' in entry) ? !!entry.visible : false;
      if (!layerId || !entryVisible || !runtimeById[layerId]) return;
      // Gesperrte Layer auch im Safety-Net nie reaktivieren.
      if (_isBookmarkLayerLocked(store, layerId)) return;
      runtimeById[layerId].visible = true;
    });
  }

  return runtimeLayers;
}

function _emitActiveBookmarkEvent(eventName, reason) {
  try {
    document.dispatchEvent(new CustomEvent(eventName, {
      detail: {
        reason: reason || null,
        bookmark: window.__tnetActiveBookmark || null
      }
    }));
  } catch (eEvent) { /* ignore */ }
}

function _emitPendingBookmarkLoadEvent(reason) {
  try {
    document.dispatchEvent(new CustomEvent('tnet-bookmark-loading', {
      detail: {
        reason: reason || null,
        pending: window.__tnetPendingBookmarkLoad || null,
        bookmark: window.__tnetActiveBookmark || null
      }
    }));
  } catch (eEvent) { /* ignore */ }
}

function _setPendingBookmarkLoad(bookmarkId, viewId, source) {
  window.__tnetSuppressUrlBookmarkHint = false;
  var existingPending = window.__tnetPendingBookmarkLoad || null;
  var cachedNames = window.__tnetBookmarkNameCache || null;
  var resolvedName = existingPending && existingPending.id === bookmarkId && existingPending.name
    ? existingPending.name
    : (cachedNames && typeof cachedNames[bookmarkId] === 'string' ? cachedNames[bookmarkId] : null);
  window.__tnetPendingBookmarkLoad = {
    id: bookmarkId,
    name: resolvedName,
    viewId: viewId || null,
    source: source || null,
    startedAt: Date.now()
  };
  _emitPendingBookmarkLoadEvent(source || 'pending');
}

function _clearPendingBookmarkLoad(reason) {
  if (!window.__tnetPendingBookmarkLoad) return;
  window.__tnetPendingBookmarkLoad = null;
  _emitPendingBookmarkLoadEvent(reason || 'cleared');
}

var _bookmarkLayerStateSync = null;

function _detachBookmarkLayerStateSync() {
  if (!_bookmarkLayerStateSync) return;
  try {
    if (_bookmarkLayerStateSync.collection && typeof _bookmarkLayerStateSync.collection.un === 'function') {
      _bookmarkLayerStateSync.collection.un('add', _bookmarkLayerStateSync.handler);
    }
  } catch (eDetach) { /* ignore */ }
  _bookmarkLayerStateSync = null;
}

function _syncBookmarkLayerStateToOL(olLayer) {
  var bookmark = window.__tnetActiveBookmark;
  var layerId;
  var runtimeLayer;
  var spec;
  var activeView;
  var viewState;

  if (!bookmark || !Array.isArray(bookmark.layers) || !olLayer || typeof olLayer.get !== 'function') return false;

  layerId = olLayer.get('name') || '';
  if (!layerId) return false;

  runtimeLayer = bookmark.layers.find(function(layer) {
    return layer && layer.id === layerId;
  });
  if (!runtimeLayer) return false;

  // Original-Spec aus _cfg holen, damit wir wissen, was der Bookmark
  // EXPLIZIT vorgibt (vs. was nur per Default-Fallback im runtimeLayer
  // gelandet ist). Visibility/Opacity nur erzwingen, wenn der Bookmark
  // dies wirklich explizit angibt — sonst soll der Layer im Zustand
  // bleiben, den die Karte/Theme (z.B. OEREB) vorgegeben hat.
  spec = null;
  try {
    var specLayers = bookmark._cfg && Array.isArray(bookmark._cfg.layers)
      ? bookmark._cfg.layers : null;
    if (specLayers) {
      for (var si = 0; si < specLayers.length; si++) {
        var s = specLayers[si];
        if (!s) continue;
        var sid = (typeof s === 'object') ? s.id : String(s);
        if (sid === layerId) { spec = s; break; }
      }
    }
  } catch (eSpec) { /* ignore */ }

  activeView = null;
  viewState = null;
  try {
    if (bookmark.activeViewId && bookmark._cfg && Array.isArray(bookmark._cfg.views)) {
      for (var vi = 0; vi < bookmark._cfg.views.length; vi++) {
        if (bookmark._cfg.views[vi] && bookmark._cfg.views[vi].id === bookmark.activeViewId) {
          activeView = bookmark._cfg.views[vi];
          break;
        }
      }
    }
    if (activeView && activeView.layerStates &&
        Object.prototype.hasOwnProperty.call(activeView.layerStates, layerId)) {
      viewState = activeView.layerStates[layerId];
    }
  } catch (eViewState) { /* ignore */ }

  // Visibility nur setzen, wenn der Bookmark explizit visible:false
  // angibt (also den Layer aktiv ausblenden will). Ein implizites
  // visible:true (Default fuer v1-Strings oder nicht gesetzte v2-Felder)
  // ueberschreibt den Karten-/Theme-Zustand nicht.
  //
  // Coalesce-faehig: Statt rohem olLayer.setVisible() die Store-API ueber
  // _setBookmarkLayerEye() nutzen, damit auch Coalesce-Sublayer (gemeinsamer
  // WMS-Layer / LAYERS-Param) korrekt ausgeblendet werden.
  var hasViewVisible = (viewState && typeof viewState === 'object' && 'visible' in viewState);
  var hasSpecVisible = (spec && typeof spec === 'object' && 'visible' in spec);
  var hasExplicitVisible = hasViewVisible || hasSpecVisible;
  var targetVisible = runtimeLayer && runtimeLayer.visible !== undefined
    ? !!runtimeLayer.visible
    : (hasViewVisible ? !!viewState.visible : (hasSpecVisible ? !!spec.visible : null));

  if (hasExplicitVisible && targetVisible === false) {
    // Flicker-Schutz: Den konkreten OL-Layer SOFORT und synchron ausschalten.
    // Wir haben die olLayer-Referenz direkt aus dem 'add'-Event, daher nicht auf
    // die (bei async Store-Population evtl. noch leere) Store-API warten. Synchron
    // im selben Tick wie das add-Event → OpenLayers rendert den Layer nie sichtbar.
    if (typeof olLayer.setVisible === 'function' && olLayer.getVisible() !== false) {
      olLayer.setVisible(false);
    }
    // Store/TOC-State zusaetzlich nachziehen (Augen-Icon, _activeLayers).
    _setBookmarkLayerEye(layerId, false);
  } else if (hasExplicitVisible && targetVisible === true) {
    if (typeof olLayer.setVisible === 'function' && olLayer.getVisible() !== true) {
      olLayer.setVisible(true);
    }
    _setBookmarkLayerEye(layerId, true);
  }

  // Opacity: Bookmark-explizit übersteuert, sonst Layer-Config-Default aus Store
  if (typeof olLayer.setOpacity === 'function') {
    var targetOp = null;
    if (spec && typeof spec === 'object' && spec.opacity != null && isFinite(spec.opacity)) {
      // Explizit im Bookmark definiert
      targetOp = Math.max(0, Math.min(1, +spec.opacity));
    } else {
      // Kein Bookmark-Wert → options.opacity aus Layer-Config via Store
      try {
        var storeL = window.TnetLMStore && typeof window.TnetLMStore.findLayer === 'function'
          ? window.TnetLMStore.findLayer(layerId) : null;
        if (storeL && storeL.options && storeL.options.opacity != null && isFinite(storeL.options.opacity)) {
          targetOp = Math.max(0, Math.min(1, +storeL.options.opacity));
        }
      } catch (eOp) { /* ignore */ }
    }
    if (targetOp !== null && olLayer.getOpacity() !== targetOp) {
      olLayer.setOpacity(targetOp);
    }
  }

  return true;
}

function _applyBookmarkRuntimeStateToMap() {
  var am = (window.top && window.top.njs && window.top.njs.AppManager)
            ? window.top.njs.AppManager
            : (window.njs && window.njs.AppManager) ? window.njs.AppManager : null;
  var map = am && am.Maps && am.Maps['main'] && am.Maps['main'].mapObj;
  var bookmark = window.__tnetActiveBookmark;
  if (!map || typeof map.getLayers !== 'function') return;

  map.getLayers().forEach(function(olLayer) {
    _syncBookmarkLayerStateToOL(olLayer);
  });

  if (bookmark && window.BasemapTimeManager && typeof window.BasemapTimeManager.syncGrayscale === 'function') {
    window.BasemapTimeManager.syncGrayscale(bookmark.basemapColorMode === 'grey');
  }
}

function _installBookmarkLayerStateSync(token) {
  var am = (window.top && window.top.njs && window.top.njs.AppManager)
            ? window.top.njs.AppManager
            : (window.njs && window.njs.AppManager) ? window.njs.AppManager : null;
  var map = am && am.Maps && am.Maps['main'] && am.Maps['main'].mapObj;
  var collection;

  _detachBookmarkLayerStateSync();
  if (!map || typeof map.getLayers !== 'function') return;

  collection = map.getLayers();
  if (!collection || typeof collection.on !== 'function') {
    _applyBookmarkRuntimeStateToMap();
    return;
  }

  function onAdd(evt) {
    if (token !== _bookmarkEnsureToken) {
      _detachBookmarkLayerStateSync();
      return;
    }
    _syncBookmarkLayerStateToOL(evt && evt.element ? evt.element : evt);
  }

  collection.on('add', onAdd);
  _bookmarkLayerStateSync = {
    collection: collection,
    handler: onAdd
  };

  _applyBookmarkRuntimeStateToMap();
}

function _clearThematicLayersBeforeBookmark() {
  // Stabiler Clear-Pfad ohne per-Layer-Races.
  try {
    if (window.TnetLMStore && typeof window.TnetLMStore.removeAllLayers === 'function') {
      window.TnetLMStore.removeAllLayers();
      TnetLog.log('[TnetSetBookmark] Fachlayer via LMStore.removeAllLayers geleert');
    }
  } catch (eStore) {
    TnetLog.warn('[TnetSetBookmark] removeAllLayers fehlgeschlagen:', eStore && eStore.message ? eStore.message : eStore);
  }

  // Zweiter Pass direkt auf der Karte: auch wenn der Store-Clear bereits lief,
  // koennen verzoegerte Framework-Layer noch sichtbar sein. Diese vor dem
  // eigentlichen Bookmark-Apply defensiv ausblenden.
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
            try { window.TnetLayerSwitch(name, 'off'); } catch (eSwitchOff) { /* ignore */ }
          }
          if (typeof layer.setVisible === 'function') {
            layer.setVisible(false);
          }
          if (typeof layer.getSource === 'function') {
            var src = layer.getSource();
            var params = src && typeof src.getParams === 'function' ? src.getParams() : null;
            var layersParam = params && (params.LAYERS || params.layers) || '';
            if (src && typeof src.updateParams === 'function' && typeof layersParam === 'string' && layersParam.indexOf('show:') === 0) {
              src.updateParams({ LAYERS: 'show:-1' });
            }
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

function _scheduleStrictBookmarkStoreReset(runtimeLayers, token) {
  var delays = [250, 900, 1800, 3200];
  delays.forEach(function(delay) {
    setTimeout(function() {
      if (token !== _bookmarkEnsureToken) return;
      var bm = window.__tnetActiveBookmark;
      if (!bm || !Array.isArray(bm.layers)) return;
      if (window.TnetLMStore && typeof window.TnetLMStore.loadActiveLayersFromBookmark === 'function') {
        try { window.TnetLMStore.loadActiveLayersFromBookmark(runtimeLayers); }
        catch (eReset) { /* ignore */ }
      }
    }, delay);
  });
}

function _applyFrameworkMapBookmarkFallback(bookmarkId) {
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

function _buildBookmarkParams(cfg, visibilityMap, options) {
  var parts = [];
  var store = window.TnetLMStore;
  var urlParams = null;
  try {
    urlParams = (options && options.urlQuery) ? new URLSearchParams(options.urlQuery) : null;
  } catch (eUrlParams) { urlParams = null; }

  function getUrlOverride(key) {
    if (!urlParams || !urlParams.has(key)) return null;
    return urlParams.get(key);
  }

  function addParam(key, value) {
    if (value === null || value === undefined || value === '') return;
    parts.push(key + '=' + encodeURIComponent(String(value)));
  }

  function valueOrNull(value) {
    return (value === null || value === undefined || value === '') ? null : value;
  }

  function addBookmarkOrUrlParam(key, bookmarkValue) {
    var urlValue = getUrlOverride(key);
    addParam(key, urlValue !== null ? urlValue : bookmarkValue);
  }

  addBookmarkOrUrlParam('lang', null);
  addBookmarkOrUrlParam('basemap', valueOrNull(cfg.basemap));
  addBookmarkOrUrlParam('blop', valueOrNull(cfg.blop));

  // Layer-Liste mit paralleler Opacity aufbauen:
  //  - v1: cfg.opacity ist Array paralleler Werte zur Layer-Liste
  //  - v2: opacity ist pro Layer (cfg.layers[i].opacity)
  var rawLayers = cfg.layers || [];
  var v1Opacity = (cfg.opacity && cfg.opacity.length) ? cfg.opacity : null;

  var entries = [];
  var urlOverrideIds = (options && options.visibleLayerIds && options.visibleLayerIds.length)
    ? options.visibleLayerIds.map(function(id) { return String(id || '').replace(/^[-\s]+/, '').trim(); }).filter(function(id) { return !!id; })
    : [];
  var urlOverrideOp = {};

  if (options && options.opacityValues && options.opacityValues.length) {
    urlOverrideIds.forEach(function(layerId, index) {
      var opValue = Number(options.opacityValues[index]);
      if (isFinite(opValue)) urlOverrideOp[layerId] = Math.max(0, Math.min(1, opValue));
    });
  }

  rawLayers.forEach(function (l, idx) {
    var id, op, defaultVisible;
    if (l && typeof l === 'object') {
      id = l.id;
      op = (l.opacity != null) ? l.opacity : '';
      defaultVisible = ('visible' in l) ? !!l.visible : true;
    }
    else {
      id = String(l || '');
      op = '';
      defaultVisible = true;
    }
    id = String(id || '').replace(/^[-\s]+/, '').trim();
    if (!id) return;
    if (v1Opacity && (op === '' || op == null)) {
      op = (v1Opacity[idx] != null ? v1Opacity[idx] : '');
    }
    if (op === '' || op == null) {
      var cfgOp = _getLayerConfigOpacity(store, id);
      if (cfgOp !== null) op = cfgOp;
    }
    if (Object.prototype.hasOwnProperty.call(urlOverrideOp, id)) {
      op = urlOverrideOp[id];
    }
    entries.push({ id: id, op: op, defaultVisible: defaultVisible });
  });

  urlOverrideIds.forEach(function(layerId) {
    var exists = entries.some(function(entry) { return entry.id === layerId; });
    if (!exists) {
      var cfgOp = _getLayerConfigOpacity(store, layerId);
      entries.push({
        id: layerId,
        op: Object.prototype.hasOwnProperty.call(urlOverrideOp, layerId) ? urlOverrideOp[layerId] : (cfgOp !== null ? cfgOp : ''),
        defaultVisible: true
      });
    }
  });

  // Gesperrte Layer (kein Zugriff fuer dieses Profil) zentral aus der Framework-
  // Layerliste entfernen — so werden sie weder ueber Bookmark, View-Wechsel noch
  // URL-Override (layers=) geladen. Greift auch vor Safety-Net/Fallbacks.
  entries = entries.filter(function (e) { return !_isBookmarkLayerLocked(store, e.id); });

  // BRIDGE: Nur SICHTBARE Layer an das Framework geben. Das Framework kennt im
  // 'layers='-Parameter nur den Zustand "einschalten" (switchLayer(id, true)) —
  // es gibt keinen "geladen aber aus". Unsichtbare Layer wuerden also sichtbar
  // gerendert und muessten danach wieder ausgeblendet werden (= Lade-Flicker).
  // Daher: unsichtbare Layer NICHT laden. Sie werden rein logisch im Karten-
  // inhalt registriert (loadActiveLayersFromBookmark) und erst bei Bedarf
  // (Augen-Klick) als eigener Framework-Layer materialisiert (Lazy-Load).
  var entriesBeforeVisibility = entries.slice();
  if (visibilityMap) {
    entries = entries.filter(function (e) {
      return Object.prototype.hasOwnProperty.call(visibilityMap, e.id)
        ? !!visibilityMap[e.id]
        : !!e.defaultVisible;
    });

    // Safety-Net: Ein leeres Ergebnis fuehrt zu `layers=` leer und damit zu
    // unbrauchbaren Startzustaenden. In dem Fall auf Bookmark-Defaults
    // zurueckfallen (und notfalls auf die urspruengliche Liste).
    if (!entries.length && entriesBeforeVisibility.length) {
      var fallbackDefaults = entriesBeforeVisibility.filter(function(entry) {
        return entry.defaultVisible === true;
      });
      entries = fallbackDefaults.length ? fallbackDefaults : entriesBeforeVisibility.slice();
      TnetLog.warn('[TnetSetBookmark] visibilityMap ergab 0 Layer, Fallback auf Bookmark-Defaults:', entries.length);
    }
  }

  // Deduplizieren (Reihenfolge erhalten)
  var seen = {};
  var deduped = [];
  entries.forEach(function (e) { if (!seen[e.id]) { seen[e.id] = true; deduped.push(e); } });

  if (deduped.length) {
    parts.push('layers=' + deduped.map(function (e) { return e.id; }).join('|'));
    var hasAnyOp = deduped.some(function (e) { return e.op !== '' && e.op != null; });
    if (hasAnyOp) {
      parts.push('op=' + deduped.map(function (e) {
        return (e.op !== '' && e.op != null) ? e.op : '';
      }).join('|'));
    }
  }

  addBookmarkOrUrlParam('theme', valueOrNull(cfg.theme));
  addBookmarkOrUrlParam('subtheme', valueOrNull(cfg.subtheme));

  // Viewport: v1 flach (cfg.x/y/zoom), v2 verschachtelt (cfg.viewport.x/y/zoom).
  var vp = (cfg.viewport && typeof cfg.viewport === 'object') ? cfg.viewport : cfg;
  addBookmarkOrUrlParam('x', valueOrNull(vp.x));
  addBookmarkOrUrlParam('y', valueOrNull(vp.y));
  addBookmarkOrUrlParam('zl', valueOrNull(vp.zoom != null ? vp.zoom : cfg.zl));
  addBookmarkOrUrlParam('hl', valueOrNull(cfg.hl));
  return parts.join('&');
}

function _applyUrlOverrideOpacity(options) {
  var ids = options && options.visibleLayerIds;
  var values = options && options.opacityValues;
  var store = window.TnetLMStore;
  if (!ids || !values || !ids.length || !values.length) return;

  ids.forEach(function(layerId, index) {
    var id = String(layerId || '').replace(/^[-\s]+/, '').trim();
    var opacity = Number(values[index]);
    if (!id || !isFinite(opacity)) return;
    opacity = Math.max(0, Math.min(1, opacity));

    if (window.__tnetActiveBookmark && Array.isArray(window.__tnetActiveBookmark.layers)) {
      window.__tnetActiveBookmark.layers.forEach(function(layer) {
        if (layer && layer.id === id) layer.opacity = opacity;
      });
    }

    if (store && typeof store.setLayerOpacity === 'function') {
      try {
        // Opacity in den Store persistieren (Katalog + Active-Eintrag), damit
        // reconcileMapConsistency den URL-Wert NICHT auf die Config-Default-Opacity
        // zuruecksetzt. Frueher wurde die Katalog-Opacity hier wiederhergestellt — das
        // fuehrte zu Divergenz (Store 0.65 vs OL 0.7) und Cross-Talk beim Reconcile.
        store.setLayerOpacity(id, opacity);
      }
      catch (eStoreOp) { /* defensiv: Runtime-State bleibt trotzdem gesetzt */ }
    }
  });

  if (store && typeof store.reconcileMapConsistency === 'function') {
    try { setTimeout(function() { store.reconcileMapConsistency(); }, 300); }
    catch (eReconcile) { /* ignore */ }
  }
}

function _getBookmarkLayerSpec(cfg, layerId) {
  var layers = cfg && Array.isArray(cfg.layers) ? cfg.layers : null;
  var i, spec, id;
  if (!layers || !layerId) return null;
  for (i = 0; i < layers.length; i++) {
    spec = layers[i];
    id = (spec && typeof spec === 'object') ? spec.id : String(spec || '');
    if (id === layerId) return { spec: spec, index: i };
  }
  return null;
}

function _getBookmarkExplicitOpacity(cfg, layerId) {
  var match = _getBookmarkLayerSpec(cfg, layerId);
  var spec = match && match.spec;
  var v1Opacity = cfg && cfg.opacity && cfg.opacity.length ? cfg.opacity : null;
  if (spec && typeof spec === 'object' && spec.opacity != null) {
    return _normalizeOpacityValue(spec.opacity);
  }
  if (v1Opacity && match && v1Opacity[match.index] != null) {
    return _normalizeOpacityValue(v1Opacity[match.index]);
  }
  return null;
}

function _applyUrlConfigFallbackOpacity(options) {
  var optionIds = options && options.visibleLayerIds;
  var store = window.TnetLMStore;
  var bookmark = window.__tnetActiveBookmark;
  if (!bookmark || !bookmark._cfg || !Array.isArray(bookmark.layers)) return false;
  var ids = [];
  function addId(layerId) {
    var id = String(layerId || '').replace(/^[-\s]+/, '').trim();
    if (id && ids.indexOf(id) === -1) ids.push(id);
  }
  if (options && options.opacityValues && options.opacityValues.length) return;
  if (!store) return false;
  if (typeof store.isLoaded === 'function' && !store.isLoaded()) return false;
  (bookmark.layers || []).forEach(function(layer) { if (layer && layer.id) addId(layer.id); });
  (optionIds || []).forEach(addId);
  if (!ids.length) return false;

  ids.forEach(function(layerId) {
    var id = String(layerId || '').replace(/^[-\s]+/, '').trim();
    var bookmarkOpacity;
    var configOpacity;
    if (!id) return;
    bookmarkOpacity = _getBookmarkExplicitOpacity(bookmark._cfg, id);
    if (bookmarkOpacity !== null) return;
    configOpacity = _getLayerConfigOpacity(store, id);
    if (configOpacity === null) return;

    bookmark.layers.forEach(function(layer) {
      if (layer && layer.id === id) layer.opacity = configOpacity;
    });

    if (typeof store.setLayerOpacity === 'function') {
      try { store.setLayerOpacity(id, configOpacity); }
      catch (eSetConfigOp) { /* defensiv */ }
    }
  });

  if (store && typeof store.reconcileMapConsistency === 'function') {
    try { setTimeout(function() { store.reconcileMapConsistency(); }, 150); }
    catch (eReconcileConfigOp) { /* ignore */ }
  }
  return true;
}

function _scheduleUrlConfigFallbackOpacity(options) {
  var startedAt = Date.now();
  var timer;
  if (options && options.opacityValues && options.opacityValues.length) return;
  if (_applyUrlConfigFallbackOpacity(options)) return;
  timer = setInterval(function() {
    if (_applyUrlConfigFallbackOpacity(options) || Date.now() - startedAt > 8000) {
      clearInterval(timer);
    }
  }, 500);
}

/**
 * Wendet einen Bookmark auf die Hauptkarte an (Framework-Aufruf)
 * @param {Object} cfg - Bookmark-Konfiguration (v2)
 * @param {string} bookmarkId - Bookmark-ID (für Logging/Return)
 * @param {string|null} [viewId] - optionale Kartenansicht (überstüpfelt isDefault-View)
 * @returns {{success: boolean, bookmarkId: string, viewId: string|null, params: string}}
 */
// View-only Switch: gleiches Bookmark, nur Visibility-Diff pro Layer anwenden.
// Kein removeAllLayers, kein setMapBookmark — Layer-Stack im TOC bleibt erhalten,
// nur die OL-Layer-Sichtbarkeit (und LMStore-State) wird umgeschaltet.
function _applyViewSwitchOnly(cfg, viewId, options) {
  var activeView   = _resolveActiveBookmarkView(cfg, viewId || null);
  // View-URL-Persistenz auch beim reinen View-Wechsel aktualisieren
  // (Dropdown: setzt view= bzw. entfernt es beim Zurück zur Default-View).
  _setActiveViewForUrl(activeView, viewId || null);
  _ensureBookmarkUrlSyncInstalled();
  var visibilityMap = _computeBookmarkVisibility(cfg, activeView, options || null);

  var am  = (window.top && window.top.njs && window.top.njs.AppManager)
            ? window.top.njs.AppManager
            : (window.njs && window.njs.AppManager) ? window.njs.AppManager : null;
  var map = am && am.Maps && am.Maps['main'] && am.Maps['main'].mapObj;
  if (!map || typeof map.getLayers !== 'function') {
    TnetLog.warn('[TnetSetBookmark] View-Switch: Map nicht verfügbar');
    return { success: false };
  }

  // Für jeden Layer im Visibility-Map den State umsetzen.
  // 1) Versuche LMStore.setLayerVisible (aktualisiert _activeLayers für TOC)
  // 2) Fallback: direkt OL-Layer setVisible (falls LMStore den Layer nicht kennt)
  var changed = 0;
  var lmStore = window.TnetLMStore;
  // OL-Layer-Lookup vorbereiten (für Fallback und Pre-Check)
  var olByName = {};
  map.getLayers().forEach(function (olLayer) {
    if (!olLayer || typeof olLayer.get !== 'function') return;
    var n = olLayer.get('name') || '';
    if (n) olByName[n] = olLayer;
  });

  Object.keys(visibilityMap).forEach(function (layerId) {
    var should = !!visibilityMap[layerId];
    var olLayer = olByName[layerId];
    // Aktuellen IST-State als SICHTBARKEIT ermitteln (nicht Membership!).
    // Externe Layer sind dauerhaft im Store aktiv, aber evtl. visible:false —
    // ein Membership-Vergleich (_isActive) würde hier fälschlich abbrechen.
    var isVisible = false;
    if (lmStore && typeof lmStore._getEffectiveLayerVisible === 'function') {
      isVisible = lmStore._getEffectiveLayerVisible(layerId);
    } else if (olLayer && typeof olLayer.getVisible === 'function') {
      isVisible = olLayer.getVisible();
    }
    if (isVisible === should) return; // bereits korrekt
    // LMStore-API bevorzugt (synct _activeLayers + dispatcht Events)
    if (lmStore && typeof lmStore.setLayerVisible === 'function') {
      try { lmStore.setLayerVisible(layerId, should); changed++; }
      catch (eSL) { /* fallthrough zu OL-Direct */ }
    }
    // OL-Layer immer passend schalten (deckt externe Layer ab, die
    // setLayerVisible mangels Katalog-Eintrag nicht kennt).
    if (olLayer && typeof olLayer.setVisible === 'function' && olLayer.getVisible() !== should) {
      olLayer.setVisible(should);
      changed++;
    }
  });

  TnetLog.log('[TnetSetBookmark] View-Switch nur Visibility:', viewId || '(none)', changed + ' Layer geändert');
  if (window.__tnetActiveBookmark) {
    window.__tnetActiveBookmark.activeViewId = activeView ? activeView.id : null;
    var newRuntime = _buildBookmarkRuntimeLayers(cfg, activeView, options || null);
    window.__tnetActiveBookmark.layers = newRuntime;
    window.__tnetActiveBookmark._options = options || null;
    // Store (Karteninhalt) mit der Soll-Sichtbarkeit der neuen View neu
    // aufbauen — deckt auch externe Layer ab, die im Store korrekt aktiv +
    // sichtbar gesetzt werden müssen (aktives Auge, Ein-Klick-Toggle).
    if (window.TnetLMStore && typeof window.TnetLMStore.loadActiveLayersFromBookmark === 'function') {
      try { window.TnetLMStore.loadActiveLayersFromBookmark(newRuntime); }
      catch (eLB) { /* ignore */ }
    }
    _applyBookmarkRuntimeStateToMap();
    _emitActiveBookmarkEvent('tnet-bookmark-state-changed', 'view-switch');
  }
  return { success: true, bookmarkId: cfg.id, viewId: activeView ? activeView.id : null, viewSwitchOnly: true };
}

function _adoptUrlOverrideBookmark(cfg, bookmarkId, viewId, options) {
  var activeView = _resolveActiveBookmarkView(cfg, viewId || null);
  var runtimeLayers = _buildBookmarkRuntimeLayers(cfg, activeView, options || null);
  var resetRuntimeLayers = (options && options.urlOverride)
    ? _buildBookmarkRuntimeLayers(cfg, activeView, null)
    : null;
  var activeViewId = activeView ? activeView.id : null;

  _setActiveViewForUrl(activeView, viewId || null);
  _bookmarkEnsureToken += 1;

  window.__tnetActiveBookmark = {
    id: bookmarkId,
    name: cfg.name || bookmarkId,
    basemap: cfg.basemap || null,
    basemapColorMode: cfg.basemapColorMode === 'grey' ? 'grey' : 'color',
    views: (cfg.views || []).filter(function(v) { return v && v.id; }),
    activeViewId: activeViewId,
    layers: runtimeLayers,
    _loadUntil: Date.now() + 8000,
    _urlOverrideFreezeUntil: (options && options.urlOverride) ? Date.now() + 16000 : 0,
    _replaceVisibleFromStoreUntil: 0,
    _cfg: cfg,
    _options: options || null,
    _resetLayers: resetRuntimeLayers,
    _resetOptions: null
  };
  _clearPendingBookmarkLoad('url-adopt');
  _bookmarkUrlSyncSignature = null;
  _emitActiveBookmarkEvent('tnet-bookmark-loaded', 'url-adopt');

  _installBookmarkLayerStateSync(_bookmarkEnsureToken);
  try {
    if (window.TnetLMStore && typeof window.TnetLMStore.loadActiveLayersFromBookmark === 'function') {
      window.TnetLMStore.loadActiveLayersFromBookmark(runtimeLayers);
      _scheduleStrictBookmarkStoreReset(runtimeLayers, _bookmarkEnsureToken);
    }
    _ensureBookmarkUrlSyncInstalled();
    _applyUrlOverrideOpacity(options || null);
    setTimeout(function() { _applyUrlOverrideOpacity(options || null); }, 700);
    _scheduleUrlConfigFallbackOpacity(options || null);
  } catch (eLoadToc) {
    TnetLog.warn('[TnetSetBookmark] URL-Adopt fehlgeschlagen:', eLoadToc && eLoadToc.message ? eLoadToc.message : eLoadToc);
  }

  _applyBookmarkRuntimeStateToMap();

  if (cfg.themes && window.TnetLMTree && typeof window.TnetLMTree.expandThemes === 'function') {
    setTimeout(function () {
      window.TnetLMTree.expandThemes(cfg.themes);
    }, 500);
  }

  TnetLog.log('[TnetSetBookmark] URL-Adopt', bookmarkId + (activeViewId ? '/' + activeViewId : ''));
  return { success: true, bookmarkId: bookmarkId, viewId: activeViewId, urlAdoptOnly: true };
}

function _applyBookmark(cfg, bookmarkId, viewId, options) {
  // View-only Switch erkennen: gleiches Bookmark (id übereinstimmt), nur viewId anders
  var prev = window.__tnetActiveBookmark;
  if (prev && prev.id === bookmarkId && prev._cfg) {
    var prevViewId = prev.activeViewId || null;
    var newViewIdCheck = viewId || null;
    if (prevViewId !== newViewIdCheck) {
      // Beim Wechsel derselben Karte nur die Sichtbarkeit umschalten. Das ist
      // fuer Agglomeration stabiler als ein kompletter Bookmark-Rebuild.
      TnetLog.log('[TnetSetBookmark] View-Switch via Visibility-Only:', prevViewId, '→', newViewIdCheck);
      return _applyViewSwitchOnly(cfg, viewId || null, options || null);
    }
  }

  var activeView = _resolveActiveBookmarkView(cfg, viewId || null);
  // View-URL-Persistenz aktivieren: aktives (nicht-default) view= in der URL
  // halten, auch nachdem das Framework die Permalink-URL neu schreibt.
  _setActiveViewForUrl(activeView, viewId || null);
  var visibilityMap = _computeBookmarkVisibility(cfg, activeView, options || null);
  var runtimeLayers = _buildBookmarkRuntimeLayers(cfg, activeView, options || null);

  // BRIDGE: Nur die SICHTBAREN Bookmark-Layer in den Framework-Aufruf — so
  // laedt das Framework ausschliesslich das, was sichtbar sein soll (mit
  // korrekter Opacity), ohne Show-then-Hide-Flicker. Die unsichtbaren Layer
  // werden weiter unten rein logisch im Karteninhalt registriert
  // (loadActiveLayersFromBookmark) und erst bei Bedarf materialisiert.
  var params = _buildBookmarkParams(cfg, visibilityMap, options || null);
  var layerIds = _normalizeBookmarkLayerIds(cfg.layers || []);

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

  // Globaler Bookmark-State SOFORT setzen — damit LM-Active beim nächsten render
  // (durch loadActiveLayersFromBookmark unten) Name + Views-Dropdown sieht.
  var activeViewIdEarly = activeView ? activeView.id : null;
  window.__tnetActiveBookmark = {
    id:           bookmarkId,
    name:         cfg.name || bookmarkId,
    basemap:      cfg.basemap || null,
    basemapColorMode: cfg.basemapColorMode === 'grey' ? 'grey' : 'color',
    views:        (cfg.views || []).filter(function(v) { return v && v.id; }),
    activeViewId: activeViewIdEarly,
    layers:       runtimeLayers,
    // Lade-Fenster: Während dieser Zeit respektiert die CoalesceBridge die
    // Bookmark-Sichtbarkeit und nimmt visible:false-Sublayer NICHT in den
    // kombinierten show:-Parameter auf (verhindert Lade-Flicker: erst alle
    // Sublayer anzeigen, dann wieder ausblenden). Deckt das Ensure-Fenster
    // (bis 6000ms) plus Framework-Retry-Marge ab.
    _loadUntil:   Date.now() + 8000,
    _urlOverrideFreezeUntil: (options && options.urlOverride) ? Date.now() + 16000 : 0,
    _replaceVisibleFromStoreUntil: (options && options.urlOverride) ? 0 : Date.now() + 5000,
    _cfg:         cfg,
    _options:     options || null
  };
  _clearPendingBookmarkLoad('apply-start');
  _bookmarkUrlSyncSignature = null;
  _emitActiveBookmarkEvent('tnet-bookmark-loaded', 'apply-start');

  _clearThematicLayersBeforeBookmark();

  _installBookmarkLayerStateSync(ensureToken);

  try {
    am.setMapBookmark(['main'], params);
  } catch (eSetMapBookmark) {
    TnetLog.warn('[TnetSetBookmark] setMapBookmark(params) fehlgeschlagen, versuche map=-Fallback:', eSetMapBookmark && eSetMapBookmark.message ? eSetMapBookmark.message : eSetMapBookmark);
    if (!_applyFrameworkMapBookmarkFallback(bookmarkId)) throw eSetMapBookmark;
  }

  // BRIDGE: Vollständigen Karteninhalt registrieren — ALLE Bookmark-Layer
  // (auch die unsichtbaren, die das Framework bewusst NICHT geladen hat)
  // logisch in den Store aufnehmen. So erscheinen sie im Karteninhalt mit
  // outlined-eye und werden bei Bedarf per Augen-Klick als eigener Framework-
  // Layer nachgeladen (Lazy-Load in setLayerEye/toggleLayerEye).
  try {
    if (window.TnetLMStore && typeof window.TnetLMStore.loadActiveLayersFromBookmark === 'function') {
      var isUrlOverrideStart = !!(options && options.urlOverride);
      window.TnetLMStore.loadActiveLayersFromBookmark(runtimeLayers);
      _scheduleStrictBookmarkStoreReset(runtimeLayers, ensureToken);
      _ensureBookmarkUrlSyncInstalled();
      _applyUrlOverrideOpacity(options || null);
      setTimeout(function() { _applyUrlOverrideOpacity(options || null); }, 700);
      _scheduleUrlConfigFallbackOpacity(options || null);
      _scheduleBookmarkLayersUrlSync();
      setTimeout(_scheduleBookmarkLayersUrlSync, 600);
      setTimeout(_scheduleBookmarkLayersUrlSync, 1800);
      if (!isUrlOverrideStart) {
        setTimeout(_scheduleBookmarkLayersUrlSync, 5600);
        setTimeout(_scheduleBookmarkLayersUrlSync, 12500);
      }
      if (typeof window.TnetLMStore.reconcileMapConsistency === 'function') {
        setTimeout(function() { window.TnetLMStore.reconcileMapConsistency(); }, 2500);
        if (!isUrlOverrideStart) {
          setTimeout(function() { window.TnetLMStore.reconcileMapConsistency(); }, 7000);
          setTimeout(function() { window.TnetLMStore.reconcileMapConsistency(); }, 12000);
        }
      }
    }
  } catch (eLoadToc) {
    TnetLog.warn('[TnetSetBookmark] loadActiveLayersFromBookmark fehlgeschlagen:', eLoadToc && eLoadToc.message ? eLoadToc.message : eLoadToc);
  }

  // Sichtbare Layer nach dem async Framework-Load bestätigen (visible:true).
  // Kein Hide-Loop mehr nötig: unsichtbare Layer wurden gar nicht geladen.
  _scheduleViewVisibilityWhenLayersReady(visibilityMap, ensureToken);
  _applyBookmarkRuntimeStateToMap();

  var activeViewId = activeView ? activeView.id : null;
  TnetLog.log('[TnetSetBookmark]', bookmarkId + (activeViewId ? '/' + activeViewId : ''), params);
  // window.__tnetActiveBookmark wurde bereits weiter oben gesetzt (vor loadActiveLayersFromBookmark)

  // Themen im Themenbaum aufklappen (falls vorhanden)
  if (cfg.themes && window.TnetLMTree && typeof window.TnetLMTree.expandThemes === 'function') {
    setTimeout(function () {
      window.TnetLMTree.expandThemes(cfg.themes);
    }, 500);
  }
  return { success: true, bookmarkId: bookmarkId, viewId: activeViewId, params: params };
}

function _isFrameworkBookmarkReady() {
  var am = (window.top && window.top.njs && window.top.njs.AppManager)
    ? window.top.njs.AppManager
    : (window.njs && window.njs.AppManager) ? window.njs.AppManager : null;
  return !!(
    am &&
    typeof am.setMapBookmark === 'function' &&
    typeof am.changeBaseMap === 'function' &&
    am.Maps && am.Maps['main'] && am.Maps['main'].mapObj
  );
}

function _waitForFrameworkBookmarkReady(timeoutMs) {
  timeoutMs = timeoutMs || 8000;
  return new Promise(function(resolve) {
    var startedAt = Date.now();
    if (_isFrameworkBookmarkReady()) {
      resolve(true);
      return;
    }
    var timer = setInterval(function() {
      if (_isFrameworkBookmarkReady()) {
        clearInterval(timer);
        resolve(true);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer);
        resolve(false);
      }
    }, 200);
  });
}

/**
 * Lädt einen Bookmark über die TNET API und setzt den Kartenstatus.
 *
 * @param {string} bookmarkId - ID oder Alias des Bookmarks
 * @param {string|null} [viewId] - optionale Kartenansicht (Schema v2: views[].id)
 * @param {Object|null} [options] - optionale Startoptionen, z.B. { visibleLayerIds: [...] }
 * @returns {Promise<{success: boolean, bookmarkId?: string, viewId?: string|null, params?: string, error?: string}>}
 */
function TnetSetBookmark(bookmarkId, viewId, options) {
  // Wenn der Aufruf aus dem Karten-Dialog-iframe kommt, die eigentliche
  // Bookmark-Logik im Top-Window ausführen. Sonst wird das iframe beim
  // Dialog-Close entladen und der laufende Request abgebrochen.
  var requestTs = Date.now();

  if (window.top && window.top !== window && typeof window.top.TnetSetBookmark === 'function') {
    try {
      window.top.__tnetLastRequestedBookmark = bookmarkId;
      window.top.__tnetLastRequestedBookmarkAt = requestTs;
    } catch (eTopReq) { /* ignore */ }
    return window.top.TnetSetBookmark(bookmarkId, viewId, options || null);
  }

  window.__tnetLastRequestedBookmark = bookmarkId;
  window.__tnetLastRequestedBookmarkAt = requestTs;
  if (window.top) {
    try {
      window.top.__tnetLastRequestedBookmark = bookmarkId;
      window.top.__tnetLastRequestedBookmarkAt = requestTs;
    } catch (eTop) { /* ignore */ }
  }

  // Dialog sofort schliessen, damit der Wechsel auch bei API-Retries/Fallback sauber wirkt.
  try {
    if (typeof window.closeMapsInfoDialog === 'function') window.closeMapsInfoDialog();
    if (window.top && typeof window.top.closeMapsInfoDialog === 'function') window.top.closeMapsInfoDialog();
  } catch (eClose) { /* ignore */ }

  function fallbackDirectMapBookmark() {
    return _applyFrameworkMapBookmarkFallback(bookmarkId);
  }

  var activeBookmark = window.__tnetActiveBookmark;
  var normalizedViewId = viewId || null;
  if (activeBookmark && activeBookmark.id === bookmarkId && activeBookmark._cfg) {
    var activeViewId = activeBookmark.activeViewId || null;
    if (activeViewId !== normalizedViewId) {
      try {
        return Promise.resolve(_applyBookmark(activeBookmark._cfg, bookmarkId, normalizedViewId, options || null));
      } catch (eCachedApply) {
        TnetLog.warn('[TnetSetBookmark] Fast-Path fuer View-Switch fehlgeschlagen, falle auf API-Load zurueck:', eCachedApply && eCachedApply.message ? eCachedApply.message : eCachedApply);
      }
    }
  }

  _setPendingBookmarkLoad(bookmarkId, normalizedViewId, 'request-start');

  return TnetApi.getBookmark(bookmarkId)
    .then(function(cfg) {
      if (options && options.urlOverride && options.visibleLayerIds && options.visibleLayerIds.length && !window.__tnetActiveBookmark) {
        return _adoptUrlOverrideBookmark(cfg, bookmarkId, viewId || null, options || null);
      }
      return _waitForFrameworkBookmarkReady(8000).then(function() {
        return _applyBookmark(cfg, bookmarkId, viewId || null, options || null);
      });
    })
    .catch(function(err) {
      _clearPendingBookmarkLoad('error');
      TnetLog.error('[TnetSetBookmark] Fehler:', err);
      if (fallbackDirectMapBookmark()) {
        return { success: true, bookmarkId: bookmarkId, fallback: true };
      }
      return { success: false, error: err.message };
    });
}

function TnetResetActiveBookmarkState() {
  var bookmark = window.__tnetActiveBookmark;
  var options = bookmark && bookmark._options ? bookmark._options : null;
  var resetOptions = null;
  if (!bookmark || !bookmark.id || !bookmark._cfg) return { success: false, error: 'no-active-bookmark' };
  try {
    if (options && options.urlOverride) {
      resetOptions = {};
      Object.keys(options).forEach(function(key) {
        resetOptions[key] = options[key];
      });
      resetOptions.visibleLayerIds = (options.originalVisibleLayerIds && options.originalVisibleLayerIds.length)
        ? options.originalVisibleLayerIds.slice()
        : null;
      resetOptions.opacityValues = options.originalOp ? String(options.originalOp).split('|') : null;
      resetOptions.urlOverride = true;
    }
    return _applyViewSwitchOnly(bookmark._cfg, bookmark.activeViewId || null, resetOptions || null);
  } catch (eResetBookmark) {
    TnetLog.warn('[TnetSetBookmark] Schneller Bookmark-Reset fehlgeschlagen:', eResetBookmark && eResetBookmark.message ? eResetBookmark.message : eResetBookmark);
    return { success: false, error: eResetBookmark && eResetBookmark.message ? eResetBookmark.message : String(eResetBookmark) };
  }
}

window.TnetResetActiveBookmarkState = TnetResetActiveBookmarkState;

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
  var retryStore = window.__tnetLayerSwitchRetryState || (window.__tnetLayerSwitchRetryState = {});

  function buildLayerIdCandidates(id) {
    var raw = String(id || '');
    var list = [];
    function add(value) {
      if (value && list.indexOf(value) === -1) list.push(value);
    }
    function stripOerebVersion(value) {
      return String(value || '').replace(/_v\d+_\d+\.oereb$/i, '');
    }
    add(raw);
    add(stripOerebVersion(raw));
    if (raw && raw.indexOf('.oereb') === -1 && raw.indexOf('/') === -1) {
      add(raw + '_v2_0.oereb');
      add(raw + '_aenderung_v2_0.oereb');
    }
    return list.length ? list : [raw];
  }

  var layerIdCandidates = buildLayerIdCandidates(layerId);

  function findCandidateByName(name) {
    if (!name) return null;
    for (var i = 0; i < layerIdCandidates.length; i++) {
      if (name === layerIdCandidates[i]) return layerIdCandidates[i];
    }
    return null;
  }

  function scheduleOnRetry() {
    var key = String(layerId || '');
    var state = retryStore[key] || { attempts: 0, timer: null };
    if (!key) return false;
    if (state.timer || state.attempts >= 8) return true;

    state.attempts += 1;
    state.timer = setTimeout(function() {
      state.timer = null;
      TnetLayerSwitch(layerId, mode);
    }, 250);
    retryStore[key] = state;
    return true;
  }

  function clearRetryState() {
    var key = String(layerId || '');
    var state = retryStore[key];
    if (!state) return;
    if (state.timer) clearTimeout(state.timer);
    delete retryStore[key];
  }

  var am = (window.njs && window.njs.AppManager)
           ? window.njs.AppManager
           : (window.top && window.top.njs && window.top.njs.AppManager)
             ? window.top.njs.AppManager
             : null;

  if (!am || !am.Maps || !am.Maps['main'] || !am.Maps['main'].mapObj) {
    TnetLog.warn('[TnetLayerSwitch] AppManager oder Map nicht verfügbar');
    if (mode === 'on') scheduleOnRetry();
    return false;
  }

  var map = am.Maps['main'].mapObj;

  // Ergaenzt eine Layer-ID im layers=-URL-Parameter (Framework kennt Direkt-Layer nicht).
  function _appendLayerToUrlParam(id) {
    try {
      var href = window.location.href;
      var m = href.match(/([?&])(layers=)([^&]*)/);
      if (!m) return;
      var cur = m[3] ? decodeURIComponent(m[3]) : '';
      var ids = cur ? cur.split('|') : [];
      if (ids.indexOf(id) !== -1) return;
      ids.push(id);
      var repl = m[1] + 'layers=' + ids.map(encodeURIComponent).join('|');
      window.history.replaceState(null, '', href.replace(/([?&])layers=[^&]*/, repl));
    } catch (e) { /* URL-Update fehlgeschlagen */ }
  }

  // Entfernt eine Layer-ID aus dem layers=-URL-Parameter (Gegenstueck zum Append).
  function _removeLayerFromUrlParam(id) {
    try {
      var href = window.location.href;
      var m = href.match(/([?&])(layers=)([^&]*)/);
      if (!m) return;
      var cur = m[3] ? decodeURIComponent(m[3]) : '';
      var ids = cur ? cur.split('|') : [];
      var idx = ids.indexOf(id);
      if (idx === -1) return;
      ids.splice(idx, 1);
      var repl = m[1] + 'layers=' + ids.map(encodeURIComponent).join('|');
      window.history.replaceState(null, '', href.replace(/([?&])layers=[^&]*/, repl));
    } catch (e) { /* URL-Update fehlgeschlagen */ }
  }

  // Direktes Laden aus dem API-Katalog (unabhaengig vom Legacy-ClassicLayerMgr).
  // Deckt WMS + arcgisRest ab. Gibt true zurueck, wenn der Layer erstellt+addiert wurde.
  function attemptDirectCatalogLoad() {
    var store = window.TnetLMStore;
    if (!store || typeof store.buildOLLayerFromCatalog !== 'function') return false;
    var olLyr = store.buildOLLayerFromCatalog(layerId);
    if (!olLyr) return false;
    // Framework-Event-Handler koennen bei unbekannten Layern crashen -> supprimieren
    try { map.addLayer(olLyr); } catch (e) { /* Framework-Event-Fehler ignoriert */ }
    // URL zuerst setzen (bevor Store-Sync updateMapStatusUrl triggert)
    _appendLayerToUrlParam(layerId);
    // Store manuell informieren (falls _onOLLayerAdd wegen Event-Fehler nicht lief)
    try { if (typeof store._onOLLayerAdd === 'function') store._onOLLayerAdd(olLyr); } catch (e) { /* Store-Sync fehlgeschlagen */ }
    // Falls updateMapStatusUrl die URL ueberschrieben hat, nochmals setzen
    _appendLayerToUrlParam(layerId);
    clearRetryState();
    TnetLog.log('[TnetLayerSwitch] Layer direkt aus API-Katalog geladen:', layerId);
    return true;
  }

  // Layer im OL-Stack suchen (nach 'name'-Property = lyrmgr-ID)
  var found = null;
  var foundId = null;
  map.getLayers().forEach(function(layer) {
    if (!found) {
      var n = layer.get('name') || '';
      var matched = findCandidateByName(n);
      if (matched) {
        found = layer;
        foundId = matched;
      }
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
      clearRetryState();
      // Layer existiert bereits im Stack → sichtbar machen
      found.setVisible(true);
      TnetLog.log('[TnetLayerSwitch] Layer eingeblendet:', foundId || layerId);

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
            if (layerIdCandidates.indexOf(mtLinked) === -1) continue;
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
      var targetLayerId = null;
      if (am.LyrMgr) {
        for (var lm in am.LyrMgr) {
          var mgr = am.LyrMgr[lm];
          if (mgr.targetMap && dojo.indexOf(mgr.targetMap, 'main') > -1 &&
              typeof mgr.getLayerById === 'function') {
            for (var ci = 0; ci < layerIdCandidates.length; ci++) {
              var cand = layerIdCandidates[ci];
              var lyrObj = mgr.getLayerById(cand);
              if (lyrObj) {
                targetLyrMgr = mgr;
                targetLayerId = cand;
                TnetLog.log('[TnetLayerSwitch] Layer gefunden in LyrMgr:', lm, 'via', cand);
                break;
              }
            }
            if (targetLyrMgr) break;
          }
        }
      }
      if (targetLyrMgr && typeof targetLyrMgr.switchLayersProgr === 'function') {
        clearRetryState();
        targetLyrMgr.switchLayersProgr(targetLayerId || layerId, null, true);
        TnetLog.log('[TnetLayerSwitch] Layer via LyrMgr.switchLayersProgr geladen:', targetLayerId || layerId);
      } else {
        // Fallback: Layer in keinem LyrMgr via getLayerById gefunden.
        // Store erstellt den OL-Layer direkt aus den API-Katalog-Daten
        // (WMS + arcgisRest), unabhaengig vom Legacy-ClassicLayerMgr.
        if (attemptDirectCatalogLoad()) {
          return true;
        }

        // Letzter Versuch: switchLayersProgr auf allen LyrMgrs
        var anyMgr = false;
        if (am.LyrMgr) {
          for (var lmFb in am.LyrMgr) {
            var mgrFb = am.LyrMgr[lmFb];
            if (mgrFb.targetMap && dojo.indexOf(mgrFb.targetMap, 'main') > -1 &&
                typeof mgrFb.switchLayersProgr === 'function') {
              for (var cf = 0; cf < layerIdCandidates.length; cf++) {
                mgrFb.switchLayersProgr(layerIdCandidates[cf], null, true);
                anyMgr = true;
              }
            }
          }
        }
        if (!anyMgr) {
          // Kein LyrMgr kennt den Layer -> direkt aus API-Katalog erstellen.
          if (attemptDirectCatalogLoad()) {
            return true;
          }
          TnetLog.warn('[TnetLayerSwitch] LyrMgr nicht verfügbar für:', layerId, 'Kandidaten:', layerIdCandidates.join(', '));
          scheduleOnRetry();
          return false;
        }
        clearRetryState();
        TnetLog.log('[TnetLayerSwitch] Layer via Fallback (alle LyrMgr) versucht:', layerId, 'Kandidaten:', layerIdCandidates.join(', '));
      }
    }
    return true;
  } else {
    // Direkt aus dem API-Katalog geladener Layer (nicht im LyrMgr): sofort entfernen.
    // Der LyrMgr-Pfad unten wuerde ins Leere laufen und den Layer auf der Karte lassen.
    if (found && found.get('tnet_direct_catalog')) {
      map.removeLayer(found);
      _removeLayerFromUrlParam(foundId || layerId);
      try {
        if (window.TnetLMStore && typeof window.TnetLMStore.forceMapLayerState === 'function') {
          window.TnetLMStore.forceMapLayerState(foundId || layerId, false, { source: 'direct-off' });
        }
      } catch (e) { /* Store-Sync fehlgeschlagen */ }
      TnetLog.log('[TnetLayerSwitch] Direkt-Layer aus API-Katalog entfernt:', layerId);
      return false;
    }
    // Ausschalten: über ClassicLayerMgr.switchLayer auf ALLEN LayerManagern
    // (nw, ow, bund, divers etc. targeten alle 'main')
    var lyrMgrHandled = false;
    if (am.LyrMgr) {
      for (var lmOff in am.LyrMgr) {
        var mgr = am.LyrMgr[lmOff];
        if (mgr.targetMap && dojo.indexOf(mgr.targetMap, 'main') > -1 &&
            typeof mgr.switchLayer === 'function') {
          for (var co = 0; co < layerIdCandidates.length; co++) {
            mgr.switchLayer(layerIdCandidates[co], false);
            TnetLog.log('[TnetLayerSwitch] switchLayer(false) auf LyrMgr:', lmOff, layerIdCandidates[co]);
            lyrMgrHandled = true;
          }
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

  // DB-Maptips aus dem Katalog cachen (Layer-ID -> Maptip-Liste).
  var store = window.TnetLMStore;
  var maptipDbCache = {};
  var maptipDbById = null;

  function buildDbMaptipIdIndex() {
    if (maptipDbById) return maptipDbById;
    maptipDbById = {};

    var cat = (store && typeof store.getCatalog === 'function') ? (store.getCatalog() || []) : [];
    (function walk(nodes) {
      if (!nodes || !nodes.length) return;
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (!n) continue;
        if (n.maptips) {
          var list = Array.isArray(n.maptips) ? n.maptips : [n.maptips];
          for (var j = 0; j < list.length; j++) {
            var mt = list[j] || {};
            var mtId = (mt._id != null) ? String(mt._id) : ((mt.id != null) ? String(mt.id) : '');
            if (mtId && !maptipDbById[mtId]) maptipDbById[mtId] = mt;
          }
        }
        var keys = ['subcategories', 'groups', 'layers', 'children'];
        for (var k = 0; k < keys.length; k++) {
          var ch = n[keys[k]];
          if (ch && ch.length) walk(ch);
        }
      }
    })(cat);

    return maptipDbById;
  }

  function getDbMaptipByRuntimeId(runtimeId) {
    if (runtimeId == null) return null;
    var idx = buildDbMaptipIdIndex();
    return idx[String(runtimeId)] || null;
  }

  function findLayerRobust(layerId) {
    if (!store || typeof store.findLayer !== 'function' || !layerId) return null;

    var candidates = [];
    function push(v) {
      if (!v) return;
      if (candidates.indexOf(v) === -1) candidates.push(v);
    }

    push(String(layerId));
    if (typeof store._getLayerIdCandidates === 'function') {
      var alt = store._getLayerIdCandidates(String(layerId)) || [];
      for (var i = 0; i < alt.length; i++) push(alt[i]);
    }
    push(String(layerId).toLowerCase());
    push(String(layerId).toUpperCase());

    for (var j = 0; j < candidates.length; j++) {
      var exact = store.findLayer(candidates[j]);
      if (exact) return exact;
    }

    // Letzter Fallback: case-insensitive Suche ueber den O(1)-Lowercase-Index.
    // (Frueher ein vollstaendiger rekursiver Katalog-Walk pro Aufruf → teuer.)
    if (typeof store.findLayerCI === 'function') {
      return store.findLayerCI(layerId);
    }
    // Kompatibilitaets-Fallback (alter Store ohne findLayerCI): rekursiver Walk.
    var cat = (typeof store.getCatalog === 'function') ? (store.getCatalog() || []) : [];
    var needle = String(layerId).toLowerCase();
    var found = null;
    (function walk(nodes) {
      if (!nodes || !nodes.length || found) return;
      for (var k = 0; k < nodes.length; k++) {
        var n = nodes[k];
        if (!n) continue;
        if (n.id && String(n.id).toLowerCase() === needle) {
          found = n;
          return;
        }
        var keys = ['subcategories', 'groups', 'layers', 'children'];
        for (var t = 0; t < keys.length; t++) {
          var ch = n[keys[t]];
          if (ch && ch.length) walk(ch);
          if (found) return;
        }
      }
    })(cat);
    return found;
  }

  function getDbMaptipsForLayer(linkedLayerId) {
    if (!linkedLayerId) return null;
    if (Object.prototype.hasOwnProperty.call(maptipDbCache, linkedLayerId)) {
      return maptipDbCache[linkedLayerId];
    }
    var result = null;
    if (store) {
      var cur = linkedLayerId;
      while (cur) {
        var layer = findLayerRobust(cur);
        if (layer && layer.maptips) {
          if (Array.isArray(layer.maptips)) result = layer.maptips;
          else if (typeof layer.maptips === 'object') result = [layer.maptips];
          break;
        }
        var slashIdx = cur.lastIndexOf('/');
        if (slashIdx <= 0) break;
        cur = cur.substring(0, slashIdx);
      }
    }
    maptipDbCache[linkedLayerId] = result;
    return result;
  }

  function mergeDbMaptipIntoLegacy(mt, dbMt) {
    if (!mt || !dbMt || typeof dbMt !== 'object') return;
    // Nur fachliche Maptip-Felder überlagern, Runtime-Objektfelder unangetastet lassen.
    var allowed = [
      'querytype',
      'qryFields', 'qryFieldsFormat', 'qryFieldsNullVal',
      'show_empty_fields', 'enabled', 'permanent_highlight',
      'highlight_geom_proj', 'highlight_style',
      'nls', 'linked_layer', 'linked_layer_id', 'query_layers'
    ];
    for (var i = 0; i < allowed.length; i++) {
      var key = allowed[i];
      if (Object.prototype.hasOwnProperty.call(dbMt, key)) {
        mt[key] = dbMt[key];
      }
    }

    // Legacy-Framework liest Highlighting über interne Cache-Felder.
    // Einige Pfade verwenden highlight_style, andere highLightstyle.
    // Deshalb beide Schreibweisen konsequent synchron halten.
    var mergedHighlightStyle = null;
    if (Object.prototype.hasOwnProperty.call(dbMt, 'highlight_style')) {
      mergedHighlightStyle = dbMt.highlight_style;
    } else if (Object.prototype.hasOwnProperty.call(dbMt, 'highLightstyle')) {
      mergedHighlightStyle = dbMt.highLightstyle;
    }
    if (mergedHighlightStyle && typeof mergedHighlightStyle === 'object') {
      mt.highlight_style = mergedHighlightStyle;
      mt.highLightstyle = mergedHighlightStyle;
    }
    if (Object.prototype.hasOwnProperty.call(dbMt, 'highlight_geom_proj')) {
      mt.highlightProj = dbMt.highlight_geom_proj;
    }
  }

  function normalizeHighlightAliases(mt) {
    if (!mt || typeof mt !== 'object') return;
    var hs = mt.highlight_style;
    var hls = mt.highLightstyle;
    if ((!hs || typeof hs !== 'object') && hls && typeof hls === 'object') {
      mt.highlight_style = hls;
      hs = hls;
    }
    if ((!hls || typeof hls !== 'object') && hs && typeof hs === 'object') {
      mt.highLightstyle = hs;
    }
  }

  function findMatchingDbMaptip(mt, linkedLayerId, mtRuntimeId) {
    var list = getDbMaptipsForLayer(linkedLayerId);
    if (!list || !list.length) return null;
    var mtId = mtRuntimeId != null ? String(mtRuntimeId) : ((mt && mt.id != null) ? String(mt.id) : '');
    var mtQl = (mt && mt.query_layers != null) ? String(mt.query_layers) : '';
    var mtNls = (mt && mt.nls) ? String(mt.nls) : '';
    var best = null;
    for (var i = 0; i < list.length; i++) {
      var cand = list[i] || {};
      var candId = (cand._id != null) ? String(cand._id) : ((cand.id != null) ? String(cand.id) : '');
      var candQl = (cand.query_layers != null) ? String(cand.query_layers) : '';
      var candNls = cand.nls ? String(cand.nls) : '';
      if (mtId !== '' && candId !== '' && candId === mtId) return cand;
      if (mtQl !== '' && candQl === mtQl) return cand;
      if (!best && mtNls !== '' && candNls === mtNls) best = cand;
      if (!best) best = cand;
    }
    return best;
  }

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

    // DB-Werte als Quelle der Wahrheit in bestehende Framework-Maptips spiegeln.
    // 1) Primär über eindeutige Runtime-ID (_id aus API)
    // 2) Fallback über linked_layer/query_layers/nls
    var dbMaptip = getDbMaptipByRuntimeId(mtId) || findMatchingDbMaptip(mt, mt.linked_layer_id, mtId);
    if (dbMaptip) {
      mergeDbMaptipIntoLegacy(mt, dbMaptip);
    }
    // Unabhängig vom DB-Match beide Legacy-Feldnamen konsistent halten.
    normalizeHighlightAliases(mt);

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
