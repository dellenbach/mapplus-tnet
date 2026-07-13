/**
 * tnet-lm-active.js — Dargestellte-Themen-Panel (Desktop + Mobile)
 *
 * Zeigt aktive Layer mit:
 *   - Drag-Handle (≡) zum Verschieben per Drag & Drop (Touch + Mouse)
 *   - Augen-Toggle (sichtbar/unsichtbar ohne Entfernung)
 *   - Opazitäts-Slider
 *   - Entfernen-Button
 *
 * @version 2.0
 * @copyright Trigonet AG
 */
(function () {
  'use strict';

  function getAppRoot() {
    return window.__TNET_APP_ROOT || '/maps';
  }

  // Schlichtes Schloss-Symbol (SVG in Textfarbe) fuer gesperrte Layer.
  function getLockIconSvg() {
    return '<svg width="11" height="13" viewBox="0 0 11 13" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
      + '<rect x="1" y="5.5" width="9" height="6.5" rx="1" stroke="currentColor" stroke-width="1.2"/>'
      + '<path d="M3 5.5V3.5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" stroke-width="1.2"/>'
      + '</svg>';
  }

  function _isActiveLayerLocked(l) {
    return !!(l && (l.locked === true || l.accessDenied === true || l.secured === true));
  }

  var LOG = '[LM-Active]';
  var _container = null;
  var _unlisteners = [];

  // ── Drag & Drop State ──
  var _dragState = null; // { item, layerId, placeholder, clone, startY, startIdx, currentIdx, listEl }

  // ── Coalesce-Gruppen Expand-State ──
  var _groupExpanded = {}; // groupId → boolean (default: true = aufgeklappt)
  var _groupEyeSnapshot = {}; // groupId → { layerId: boolean }

  // ── Bookmark Dirty State ──
  var _bmModified = false;      // true sobald der Nutzer explizit etwas geändert hat
  var _bmLoadedRecently = false; // Schonfrist nach tnet-bookmark-loaded (Store noch nicht synchron)
  var _bmLoadTimer = null;
  var _bmViewSwitchUntil = 0;
  var _viewSwitchRequestToken = 0;
  var _pendingLayerUiState = {};
  var _pendingVisibilityUpdates = {};
  var _visibilityFlushTimer = null;
  var _pendingOpacityUpdates = {};
  var _opacityFlushTimer = null;
  var VISIBILITY_FLUSH_DELAY = 0;   // Store sofort per setTimeout(0) aufrufen; UI-Update kommt zuerst
  var OPACITY_FLUSH_DELAY = 120;

  // ── Opacity-Slider: rAF-Throttle + Drag-Schutz ──
  // Heavy Store-Calls auf jedem input-Event ruckeln; wir drosseln auf 1x pro Frame.
  // _activeOpacitySlider verhindert, dass _onOpacity waehrend des Ziehens slider.value
  // zurueckschreibt (das wuerde den nativen Drag unterbrechen → Slider haengt).
  var _activeOpacitySlider = null;
  var _opacityApplyRaf = null;
  var _opacityApplyQueue = {};
  // Unterdrueckt genau einen Re-render, der durch die eigene Sichtbarkeits-Flush
  // ausgeloest wird (active-layers-changed) — das Auge ist bereits inline aktualisiert.
  var _suppressVisibilityRender = false;
  // Letzter gerenderter HTML-Stand. Framework feuert active-layers-changed/layer-loading
  // im Leerlauf ~16x/s ohne echte Aenderung; ein erneuter innerHTML-Rebuild wuerde nur
  // identische Knoten austauschen (Auge flimmert, Slider-Drag bricht ab, erster Klick
  // wird verschluckt). Ist das neue HTML identisch, ueberspringen wir die Zuweisung.
  var _lastRenderHtml = null;

  // ── Render-Debounce ──
  // Viele active-layers-changed-Events (Bookmark-Load, Massen-Toggles) wuerden
  // sonst je einen vollstaendigen innerHTML-Rebuild ausloesen → Flicker + 70+
  // [LM-Active] render. Wir koaleszieren alle Renders eines Frames zu einem.
  var _renderRaf = null;

  // ===== KARTENINHALT-REIHENFOLGE & NAMEN AUS BOOKMARK-API =====
  // Loest die fruehere V2-Wrapper-Datei (tnet-lm-active-v2.js) ab. Die Bookmark-API
  // (getBookmarkV2) liefert die in der DB/im Profil gepflegte Layer-Reihenfolge und
  // NLS-Namen. Die Reihenfolge wird beim Laden EINMAL in bookmark.layers einsortiert;
  // ab da steuert bookmark.layers die Anzeige (V1-nativ) — so greifen Drag&Drop,
  // Reset-Snapshot und neue Layer konsistent. Bei API-Fehler bleibt die vorhandene
  // Reihenfolge erhalten (Fail-safe).
  var _apiOrderIndex = {};     // layerId → sortIndex aus API
  var _apiGroupNames = {};     // id → Service-/Gruppen-Label aus API (Gruppen-Header)
  var _apiLeafNames = {};      // id → Knoten-Name aus API (Standalone-Layer + Gruppen-Kinder)
  var _apiLeafMeta = {};       // id → { legendLink, legendTitle, layerType, url } aus API (Render-Metadaten)
  var _apiCache = {};          // 'bookmarkId|profile' → API-Daten (vermeidet Re-Fetch)
  var _apiBookmarkData = null; // zuletzt geladene API-Daten
  var _userReordered = false;  // true sobald der Nutzer per Drag&Drop umsortiert hat

  // SVG-Icons — geladen via TnetIcons (externe .svg Dateien)
  // Werden in _initIcons() befüllt nachdem TnetIcons.loadAll() abgeschlossen ist
  var ICON = {};

  function getBookmarkInfo() {
    var bookmark = window.__tnetActiveBookmark;
    if (!bookmark || !Array.isArray(bookmark.layers)) return null;
    return bookmark;
  }

  function getPendingBookmarkInfo() {
    var pending = window.__tnetPendingBookmarkLoad;
    if (!pending || !pending.id) return null;
    return pending;
  }

  function getUrlBookmarkHint() {
    if (window.__tnetSuppressUrlBookmarkHint) return null;
    var requestedId = window.__tnetLastRequestedBookmark || null;
    if (!requestedId) {
      try {
        var match = window.location.pathname.match(/\/maps(?:-dev)?\/([a-zA-Z0-9_-]+)$/);
        if (match && match[1]) requestedId = match[1];
      } catch (ePath) { /* ignore */ }
    }
    if (!requestedId) return null;

    var nameCache = window.__tnetBookmarkNameCache || null;
    var cachedName = nameCache && typeof nameCache[requestedId] === 'string' ? nameCache[requestedId] : null;
    return {
      id: requestedId,
      name: cachedName || null,
      source: 'url-hint'
    };
  }

  function emitBookmarkStateChanged(reason) {
    var bookmark = getBookmarkInfo();
    if (!bookmark) return;
    try {
      document.dispatchEvent(new CustomEvent('tnet-bookmark-state-changed', {
        detail: { reason: reason || null, bookmark: bookmark }
      }));
    } catch (eEvent) { /* ignore */ }
  }

  function cloneLayerList(layers) {
    return (layers || []).map(function(layer) {
      var copy = {};
      var key;
      if (!layer) return copy;
      for (key in layer) {
        if (!Object.prototype.hasOwnProperty.call(layer, key)) continue;
        if (key === '_olLayerRef') continue;
        copy[key] = layer[key];
      }
      return copy;
    });
  }

  function captureBookmarkResetSnapshot() {
    var bookmark = getBookmarkInfo();
    if (!bookmark || !Array.isArray(bookmark.layers) || bookmark._resetLayers) return;
    bookmark._resetLayers = cloneLayerList(bookmark.layers);
    if (bookmark._options) {
      bookmark._resetOptions = {};
      Object.keys(bookmark._options).forEach(function(key) {
        var value = bookmark._options[key];
        bookmark._resetOptions[key] = Array.isArray(value) ? value.slice() : value;
      });
    }
  }

  function restoreBookmarkResetSnapshot(bookmark) {
    var store = window.TnetLMStore;
    var restoredLayers;
    if (!bookmark || !Array.isArray(bookmark._resetLayers)) return false;
    restoredLayers = cloneLayerList(bookmark._resetLayers);
    normalizeResetLayerOpacities(bookmark, restoredLayers);
    bookmark.layers = restoredLayers;
    if (Object.prototype.hasOwnProperty.call(bookmark, '_resetOptions')) {
      bookmark._options = {};
      if (bookmark._resetOptions) {
        Object.keys(bookmark._resetOptions).forEach(function(key) {
          var value = bookmark._resetOptions[key];
          bookmark._options[key] = Array.isArray(value) ? value.slice() : value;
        });
      } else {
        bookmark._options = null;
      }
    }
    if (store && typeof store.loadActiveLayersFromBookmark === 'function') {
      store.loadActiveLayersFromBookmark(restoredLayers);
    }
    if (store && typeof store.reconcileMapConsistency === 'function') {
      try { store.reconcileMapConsistency(); } catch (eReconcile) { /* ignore */ }
    }
    syncUrlToResetLayers(bookmark, restoredLayers);
    return true;
  }

  function syncUrlToResetLayers(bookmark, layers) {
    var hist;
    var loc;
    var ids = [];
    var seen = {};
    if (!Array.isArray(layers)) return;
    layers.forEach(function(layer) {
      if (!layer || !layer.id || seen[layer.id]) return;
      // Für den Bookmark-Default-TOC braucht die URL neben sichtbar gerenderten
      // Layern auch renderbare Default-Container, sonst startet ein Reload wieder
      // mit reduzierter Themenliste.
      if (layer.visible === false && layer.type !== 'layer') return;
      seen[layer.id] = true;
      ids.push(layer.id);
    });
    try {
      hist = (window.top && window.top.history) ? window.top.history : window.history;
      loc = (window.top && window.top.location) ? window.top.location : window.location;
      if (!hist || typeof hist.replaceState !== 'function' || !loc) return;
      var current = new URL(loc.href);
      if (bookmark && bookmark._resetFromBookmarkDefault) {
        current.searchParams.delete('layers');
      } else {
        current.searchParams.set('layers', ids.join('|'));
      }
      current.searchParams.delete('op');
      hist.replaceState(null, '', current.pathname + '?' + current.searchParams.toString() + current.hash);
    } catch (eUrlReset) { /* URL-Sync defensiv */ }
  }

  // ===== BOOKMARK-URL-MODUS =====
  // Regel:
  //   - Nicht modifiziertes Bookmark → Bookmark-ID im Pfad, KEIN layers=/op=.
  //   - Modifiziertes Bookmark       → Bookmark-ID raus aus Pfad, expliziter layers=-Stand.
  // Beim Reload entscheidet die URL dadurch eindeutig: Bookmark neu laden ODER
  // den modifizierten Layer-Stand wiederherstellen. Das Flag window.__tnetBookmarkUrlMode
  // ('pristine' | 'layers' | 'none') steuert zusaetzlich den layers=-Strip in der Coalesce-Bridge.
  var _lastBookmarkUrlMode = null;

  function _collectActiveLayerIdsForUrl() {
    var store = window.TnetLMStore;
    var ids = [];
    var seen = {};
    if (store && typeof store.getActiveLayers === 'function') {
      (store.getActiveLayers() || []).forEach(function (l) {
        if (l && l.id && l.visible !== false && !seen[l.id]) { seen[l.id] = true; ids.push(l.id); }
      });
    }
    return ids;
  }

  function _updateBookmarkUrlMode() {
    var hist, loc;
    try {
      hist = (window.top && window.top.history) ? window.top.history : window.history;
      loc = (window.top && window.top.location) ? window.top.location : window.location;
    } catch (eTop) { hist = window.history; loc = window.location; }
    if (!hist || typeof hist.replaceState !== 'function' || !loc) return;

    var bm = getBookmarkInfo();
    var bmId = bm ? String(bm.id || bm['map-bookmark'] || '') : '';
    var mode = !bmId ? 'none' : (_isActiveBookmarkModified() ? 'layers' : 'pristine');
    window.__tnetBookmarkUrlMode = mode;
    if (mode === 'none') { _lastBookmarkUrlMode = mode; return; }

    var url;
    try { url = new URL(loc.href); } catch (eUrl) { return; }
    var pm = url.pathname.match(/^(.*\/maps(?:-dev)?)(?:\/[A-Za-z0-9_-]+)?\/?$/);
    if (!pm) return;
    var basePrefix = pm[1];

    var existingLayers = url.searchParams.get('layers');
    var existingOp = url.searchParams.get('op');
    url.searchParams.delete('layers');
    url.searchParams.delete('op');
    var baseParams = url.searchParams.toString();

    var parts = [];
    if (baseParams) parts.push(baseParams);
    var newPathname;

    if (mode === 'pristine') {
      // Bookmark im Pfad ist autoritativ → layers=/op= entfallen.
      newPathname = basePrefix + '/' + bmId;
    } else {
      // Modifiziert → Bookmark-ID aus Pfad, expliziten Layer-Stand sichern.
      newPathname = basePrefix + '/';
      var layersRaw = existingLayers || _collectActiveLayerIdsForUrl().join('|');
      if (layersRaw) parts.push('layers=' + layersRaw);
      if (existingOp) parts.push('op=' + existingOp);
    }

    var newSearch = parts.length ? '?' + parts.join('&') : '';
    var newRel = newPathname + newSearch + url.hash;
    var curRel = loc.pathname + loc.search + loc.hash;
    if (newRel !== curRel) {
      try { hist.replaceState(null, '', newRel); } catch (eRS) { /* ignore */ }
    }
    _lastBookmarkUrlMode = mode;
  }

  function buildBookmarkDefaultVisibilityMap(bookmark) {
    var result = {};
    var cfg = bookmark && bookmark._cfg ? bookmark._cfg : null;
    var cfgLayers = cfg && Array.isArray(cfg.layers) ? cfg.layers : [];
    var cfgIds = cfgLayers.map(function(entry) {
      return entry && typeof entry === 'object' ? entry.id : String(entry || '');
    }).filter(function(id) { return !!id; });
    var activeView = null;
    var states = null;
    var whitelistMode = false;
    var storeRef = window.TnetLMStore;

    if (bookmark && bookmark.activeViewId && cfg && Array.isArray(cfg.views)) {
      cfg.views.forEach(function(view) {
        if (view && view.id === bookmark.activeViewId) activeView = view;
      });
    }
    if (!activeView && cfg && Array.isArray(cfg.views)) {
      cfg.views.forEach(function(view) {
        if (!activeView && view && view.isDefault === true) activeView = view;
      });
    }
    states = activeView && activeView.layerStates ? activeView.layerStates : null;

    if (activeView && activeView.isDefault === false && states) {
      var stateKeys = Object.keys(states);
      if (stateKeys.length) {
        whitelistMode = stateKeys.every(function(stateId) {
          var entry = states[stateId];
          return !!(entry && typeof entry === 'object' && entry.visible === true);
        });
      }
    }

    cfgLayers.forEach(function(entry) {
      var id;
      var visible;
      var explicitVisible = false;
      var state;
      if (!entry) return;
      if (typeof entry === 'object') {
        id = entry.id;
        visible = ('visible' in entry) ? !!entry.visible : true;
        explicitVisible = ('visible' in entry) && !!entry.visible;
      } else {
        id = String(entry || '');
        visible = true;
      }
      if (!id) return;
      if (states && Object.prototype.hasOwnProperty.call(states, id)) {
        state = states[id];
        if (state && typeof state === 'object' && state.visible === true) explicitVisible = true;
      }
      if (_isStructuralBookmarkLayerIdForDirty(id, cfgIds, storeRef) && !explicitVisible) return;
      if (whitelistMode) visible = false;
      if (states && Object.prototype.hasOwnProperty.call(states, id)) {
        state = states[id];
        if (state && 'visible' in state) visible = !!state.visible;
      }
      result[id] = visible;
    });

    return result;
  }

  function ensureUrlOverrideResetSnapshot(bookmark) {
    var visibilityMap;
    var resetLayers;
    var resetIds = {};
    var cfgLayers;
    var store = window.TnetLMStore;
    if (!bookmark || !(bookmark._options && bookmark._options.urlOverride) || !Array.isArray(bookmark.layers)) return;

    visibilityMap = buildBookmarkDefaultVisibilityMap(bookmark);
    resetLayers = cloneLayerList(bookmark.layers);
    resetLayers.forEach(function(layer) {
      if (layer && layer.id) resetIds[layer.id] = true;
    });

    cfgLayers = bookmark._cfg && Array.isArray(bookmark._cfg.layers) ? bookmark._cfg.layers : [];
    cfgLayers.forEach(function(entry) {
      var id = entry && typeof entry === 'object' ? entry.id : String(entry || '');
      var catalogLayer;
      var copy = {};
      var key;
      if (!id || resetIds[id] || !store || typeof store.findLayer !== 'function') return;
      catalogLayer = store.findLayer(id);
      if (!catalogLayer || catalogLayer.type !== 'layer') return;
      for (key in catalogLayer) {
        if (!Object.prototype.hasOwnProperty.call(catalogLayer, key)) continue;
        if (key === '_olLayerRef') continue;
        copy[key] = catalogLayer[key];
      }
      if (entry && typeof entry === 'object') {
        for (key in entry) {
          if (Object.prototype.hasOwnProperty.call(entry, key)) copy[key] = entry[key];
        }
      }
      copy.id = id;
      copy.name = copy.name || id.split('/').pop() || id;
      resetLayers.push(copy);
      resetIds[id] = true;
    });

    resetLayers.forEach(function(layer) {
      if (!layer || !layer.id) return;
      layer.visible = Object.prototype.hasOwnProperty.call(visibilityMap, layer.id)
        ? !!visibilityMap[layer.id]
        : false;
    });

    bookmark._resetLayers = resetLayers;
    bookmark._resetOptions = null;
    bookmark._resetFromBookmarkDefault = true;
  }

  function normalizeResetLayerOpacities(bookmark, layers) {
    var store = window.TnetLMStore;
    var cfgLayers = bookmark && bookmark._cfg && Array.isArray(bookmark._cfg.layers) ? bookmark._cfg.layers : [];
    var cfgById = {};
    var originalOpById = {};
    var i;
    if (!Array.isArray(layers) || !layers.length || !store || typeof store.findLayer !== 'function') return;

    cfgLayers.forEach(function(entry) {
      var id = entry && typeof entry === 'object' ? entry.id : String(entry || '');
      if (id) cfgById[id] = entry;
    });

    if (bookmark && bookmark._resetOptions && bookmark._resetOptions.originalVisibleLayerIds && bookmark._resetOptions.originalOp) {
      var ids = bookmark._resetOptions.originalVisibleLayerIds;
      var ops = String(bookmark._resetOptions.originalOp || '').split('|');
      for (i = 0; i < ids.length; i++) {
        if (ops[i] !== undefined && ops[i] !== '') originalOpById[ids[i]] = ops[i];
      }
    }

    layers.forEach(function(layer) {
      var cfgEntry;
      var cat;
      var configOpacity;
      if (!layer || !layer.id) return;
      if (Object.prototype.hasOwnProperty.call(originalOpById, layer.id)) return;
      cfgEntry = cfgById[layer.id];
      if (cfgEntry && typeof cfgEntry === 'object' && cfgEntry.opacity != null) return;

      cat = store.findLayer(layer.id);
      if (!cat) return;
      if (cat._configOpacity !== undefined) configOpacity = cat._configOpacity;
      else if (cat.options && cat.options.opacity !== undefined) configOpacity = cat.options.opacity;
      else return;
      configOpacity = Number(configOpacity);
      if (!isFinite(configOpacity)) return;
      layer.opacity = Math.max(0, Math.min(1, configOpacity));
    });
  }

  function _isBookmarkLoadActive() {
    var bm = window.__tnetActiveBookmark;
    var until = bm && bm._loadUntil ? Number(bm._loadUntil) : 0;
    return !!(until && Date.now() < until);
  }

  function _isViewSwitchActive() {
    return Date.now() < _bmViewSwitchUntil;
  }

  // Prüft ob sichtbare Layer vom Original-Bookmark (_cfg) abweichen.
  // Opacity wird bewusst ignoriert: in der URL stehen nur sichtbare Layer, und
  // Layer-Deckkraft kann je Layer/Kontext optional definiert oder ueberschrieben sein.
  // _bmModified wird gesetzt via emitBookmarkStateChanged (Remove, Reorder)
  // und via render() (Katalog-Layer-Erkennung aus effectiveLayers).
  /**
   * Vergleicht Baseline-Snapshot und aktuelle Bookmark-Layer auf Reihenfolge- oder
   * Opazitaets-Unterschiede. Nur gemeinsame Layer-IDs werden positionsweise verglichen
   * (Sichtbarkeits-Menge wird separat geprueft). Opazitaet wird mit Epsilon verglichen;
   * fehlende Werte gelten als 1.0 (Default).
   * @returns {boolean} true wenn Reihenfolge oder Opazitaet abweicht
   */
  function _bookmarkOrderOrOpacityDiffers(baseline, current) {
    if (!Array.isArray(baseline) || !Array.isArray(current)) return false;
    var normOpacity = function(v) {
      return (v == null || isNaN(v)) ? 1 : +v;
    };
    var baseIds = baseline.filter(function(l) { return l && l.id; }).map(function(l) { return l.id; });
    var curIds = current.filter(function(l) { return l && l.id; }).map(function(l) { return l.id; });
    // Reihenfolge der gemeinsamen IDs (Schnittmenge) positionsweise vergleichen.
    var baseSet = {}; baseIds.forEach(function(id) { baseSet[id] = true; });
    var curSet = {}; curIds.forEach(function(id) { curSet[id] = true; });
    var baseCommon = baseIds.filter(function(id) { return curSet[id]; });
    var curCommon = curIds.filter(function(id) { return baseSet[id]; });
    for (var i = 0; i < baseCommon.length; i++) {
      if (baseCommon[i] !== curCommon[i]) return true; // Reihenfolge abweichend
    }
    // Opazitaet je Layer-ID vergleichen.
    var baseOpById = {};
    baseline.forEach(function(l) { if (l && l.id) baseOpById[l.id] = normOpacity(l.opacity); });
    for (var j = 0; j < current.length; j++) {
      var cl = current[j];
      if (!cl || !cl.id || !(cl.id in baseOpById)) continue;
      if (Math.abs(normOpacity(cl.opacity) - baseOpById[cl.id]) > 0.001) return true;
    }
    return false;
  }

  /**
   * Prueft, ob die uebergebene Opacity dem konfigurierten Baseline-Wert entspricht
   * (Reset-Snapshot = Bookmark-Intention; sonst Katalog-/API-Opacity). Die API liefert
   * die Soll-Opacity je Sublayer bereits mit (z.B. options.opacity = 0.65). So lassen sich
   * programmatische Opacity-Anwendungen beim (verzoegerten) Layer-Aufbau von echten
   * Nutzer-Aenderungen unterscheiden.
   * @returns {boolean} true wenn der Wert dem Baseline entspricht (→ KEINE Nutzer-Aenderung)
   */
  function _opacityMatchesBaseline(layerId, opacity) {
    var norm = function (v) { return (v == null || isNaN(v)) ? 1 : +v; };
    var target = norm(opacity);
    var bm = getBookmarkInfo();
    if (bm && Array.isArray(bm._resetLayers)) {
      for (var i = 0; i < bm._resetLayers.length; i++) {
        var l = bm._resetLayers[i];
        if (l && l.id === layerId) return Math.abs(norm(l.opacity) - target) <= 0.001;
      }
    }
    var store = window.TnetLMStore;
    var node = (store && typeof store.findLayer === 'function') ? store.findLayer(layerId) : null;
    if (node) {
      var cfgOp = (node.options && node.options.opacity != null) ? node.options.opacity : node.opacity;
      if (cfgOp != null) return Math.abs(norm(cfgOp) - target) <= 0.001;
    }
    return false;
  }

  function _isActiveBookmarkModified() {
    var bm = window.__tnetActiveBookmark;
    if (!bm || !bm._cfg || !Array.isArray(bm._cfg.layers) || !Array.isArray(bm.layers)) return false;

    // Primaere Quelle: das _bmModified-Flag. Es wird von allen Benutzer-Edits zuverlaessig
    // gesetzt (Reorder, Sichtbarkeit, Standalone- und Coalesce-Opazitaet, Remove) und bei
    // Bookmark-Load, View-Switch und Reset auf false zurueckgesetzt. Damit erscheint
    // "Aenderungen verwerfen" robust und view-aware (neue Ansicht = neue Referenz).
    if (_bmModified) return true;
    // Waehrend Bookmark-Load/View-Switch nie als modifiziert melden.
    if (_isBookmarkLoadActive() || _isViewSwitchActive()) return false;

    var activeView = null;
    var viewStates = null;
    var defaultVisible = [];
    var currentVisible = [];
    var defaultVisibleById = {};
    var currentVisibleById = {};
    var whitelistMode = false;
    var cfgIds = bm._cfg.layers.map(function(l) {
      return (l && typeof l === 'object') ? l.id : String(l || '');
    }).filter(function(id) { return !!id; });
    var storeRef = window.TnetLMStore;

    if (Array.isArray(bm._resetLayers) && bm._resetLayers.length) {
      bm._resetLayers.forEach(function(layer) {
        if (!layer || !layer.id || layer.visible === false) return;
        if (!defaultVisibleById[layer.id]) {
          defaultVisibleById[layer.id] = true;
          defaultVisible.push(layer.id);
        }
      });

      bm.layers.forEach(function(layer) {
        if (!layer || !layer.id || layer.visible === false) return;
        if (!currentVisibleById[layer.id]) {
          currentVisibleById[layer.id] = true;
          currentVisible.push(layer.id);
        }
      });

      if (defaultVisible.length !== currentVisible.length) return true;
      for (var si = 0; si < defaultVisible.length; si++) {
        if (!currentVisibleById[defaultVisible[si]]) return true;
      }
      // Reihenfolge- oder Opazitaets-Aenderung gegenueber dem Snapshot erkennen
      // (Sichtbarkeits-Menge identisch, aber Layer umsortiert oder Deckkraft veraendert).
      if (_bookmarkOrderOrOpacityDiffers(bm._resetLayers, bm.layers)) return true;
      return false;
    }

    if (_isBookmarkLoadActive() || _isViewSwitchActive()) return false;

    if (bm.activeViewId && Array.isArray(bm._cfg.views)) {
      bm._cfg.views.forEach(function(view) {
        if (view && view.id === bm.activeViewId) activeView = view;
      });
    }
    if (!activeView && Array.isArray(bm._cfg.views)) {
      bm._cfg.views.forEach(function(view) {
        if (!activeView && view && view.isDefault === true) activeView = view;
      });
    }
    viewStates = (activeView && activeView.layerStates) || null;

    if (activeView && activeView.isDefault === false && viewStates) {
      var stateKeys = Object.keys(viewStates);
      if (stateKeys.length) {
        whitelistMode = stateKeys.every(function(stateId) {
          var entry = viewStates[stateId];
          return !!(entry && typeof entry === 'object' && entry.visible === true);
        });
      }
    }

    bm._cfg.layers.forEach(function(l) {
      var id, visible, state;
      if (!l) return;
      if (typeof l === 'object') {
        id = l.id;
        visible = ('visible' in l) ? !!l.visible : true;
      } else {
        id = String(l || '');
        visible = true;
      }
      if (!id) return;
      if (_isStructuralBookmarkLayerIdForDirty(id, cfgIds, storeRef)) return;
      if (whitelistMode) visible = false;
      if (viewStates && Object.prototype.hasOwnProperty.call(viewStates, id)) {
        state = viewStates[id];
        if (state && 'visible' in state) visible = !!state.visible;
      }
      if (visible && !defaultVisibleById[id]) {
        defaultVisibleById[id] = true;
        defaultVisible.push(id);
      }
    });

    bm.layers.forEach(function(layer) {
      if (!layer || !layer.id || layer.visible === false) return;
      if (!currentVisibleById[layer.id]) {
        currentVisibleById[layer.id] = true;
        currentVisible.push(layer.id);
      }
    });

    if (defaultVisible.length !== currentVisible.length) return true;
    for (var i = 0; i < defaultVisible.length; i++) {
      if (!currentVisibleById[defaultVisible[i]]) return true;
    }
    return false;
  }

  function _isStructuralBookmarkLayerIdForDirty(layerId, allCfgIds, store) {
    if (!layerId || !Array.isArray(allCfgIds) || !allCfgIds.length) return false;
    if (store && typeof store.isRenderableLayerId === 'function' && store.isRenderableLayerId(layerId)) {
      return false;
    }
    var prefix = layerId + '/';
    for (var i = 0; i < allCfgIds.length; i++) {
      var otherId = allCfgIds[i];
      if (!otherId || otherId === layerId) continue;
      if (otherId.indexOf(prefix) === 0) return true;
    }
    return false;
  }

  function _isBookmarkLayerId(layerId) {
    var bm = window.__tnetActiveBookmark;
    if (!bm || !bm._cfg || !Array.isArray(bm._cfg.layers) || !layerId) return false;
    for (var i = 0; i < bm._cfg.layers.length; i++) {
      var layer = bm._cfg.layers[i];
      var id = layer && typeof layer === 'object' ? layer.id : String(layer || '');
      if (id === layerId) return true;
    }
    return false;
  }

  function _hasVisibleExtraLayer(effectiveLayers) {
    if (!effectiveLayers || !effectiveLayers.length) return false;
    for (var i = 0; i < effectiveLayers.length; i++) {
      var current = effectiveLayers[i];
      if (current && current.id && current.visible !== false && !_isBookmarkLayerId(current.id)) return true;
    }
    return false;
  }

  function _resolveViewFromBookmarkCfg(cfg, viewId) {
    var views = cfg && cfg.views;
    var i;
    if (!views || !views.length) return null;
    if (viewId) {
      for (i = 0; i < views.length; i++) {
        if (views[i] && views[i].id === viewId) return views[i];
      }
    }
    for (i = 0; i < views.length; i++) {
      if (views[i] && views[i].isDefault === true) return views[i];
    }
    return null;
  }

  function _isStructuralLayerIdForViewSwitch(layerId, allIds, store) {
    var prefix;
    var i;
    if (!layerId || !Array.isArray(allIds) || !allIds.length) return false;
    if (store && typeof store.isRenderableLayerId === 'function' && store.isRenderableLayerId(layerId)) {
      return false;
    }
    prefix = layerId + '/';
    for (i = 0; i < allIds.length; i++) {
      if (!allIds[i] || allIds[i] === layerId) continue;
      if (allIds[i].indexOf(prefix) === 0) return true;
    }
    return false;
  }

  function _buildViewSwitchOptions(bookmark, nextViewId) {
    var cfg = bookmark && bookmark._cfg;
    var layers = (cfg && Array.isArray(cfg.layers)) ? cfg.layers : null;
    var activeView;
    var states;
    var stateKeys;
    var whitelistMode = false;
    var allIds;
    var store = window.TnetLMStore;
    var visibleIds = [];

    if (!cfg || !layers || !layers.length) return null;

    activeView = _resolveViewFromBookmarkCfg(cfg, nextViewId || null);
    states = (activeView && activeView.layerStates) || null;
    if (states && activeView && activeView.isDefault === false) {
      stateKeys = Object.keys(states);
      if (stateKeys.length) {
        whitelistMode = stateKeys.every(function(stateId) {
          var entry = states[stateId];
          return !!(entry && typeof entry === 'object' && entry.visible === true);
        });
      }
    }

    allIds = layers.map(function(entry) {
      return (entry && typeof entry === 'object') ? entry.id : String(entry || '');
    }).filter(function(id) { return !!id; });

    layers.forEach(function(entry) {
      var id;
      var visible;
      var state;
      var explicitVisible = false;
      if (!entry) return;
      if (typeof entry === 'object') {
        id = entry.id;
        visible = ('visible' in entry) ? !!entry.visible : true;
        explicitVisible = ('visible' in entry) && !!entry.visible;
      } else {
        id = String(entry || '');
        visible = true;
      }
      if (!id) return;

      if (states && Object.prototype.hasOwnProperty.call(states, id)) {
        state = states[id];
        if (state && typeof state === 'object' && state.visible === true) {
          explicitVisible = true;
        }
      }
      if (_isStructuralLayerIdForViewSwitch(id, allIds, store) && !explicitVisible) return;

      if (whitelistMode) visible = false;
      if (states && Object.prototype.hasOwnProperty.call(states, id)) {
        state = states[id];
        if (state && typeof state === 'object' && 'visible' in state) {
          visible = !!state.visible;
        }
      }
      if (visible) visibleIds.push(id);
    });

    return { visibleLayerIds: visibleIds };
  }

  function _resetPendingUiState() {
    _pendingLayerUiState = {};
    _pendingVisibilityUpdates = {};
    _pendingOpacityUpdates = {};
    _opacityApplyQueue = {};
    _activeOpacitySlider = null;
    _lastRenderHtml = null;  // naechster render() muss vollstaendig neu aufbauen
    if (_visibilityFlushTimer) {
      clearTimeout(_visibilityFlushTimer);
      _visibilityFlushTimer = null;
    }
    if (_opacityFlushTimer) {
      clearTimeout(_opacityFlushTimer);
      _opacityFlushTimer = null;
    }
    if (_opacityApplyRaf) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(_opacityApplyRaf);
      else clearTimeout(_opacityApplyRaf);
      _opacityApplyRaf = null;
    }
  }

  function _readPendingLayerUiState(layerId) {
    if (!layerId || !_pendingLayerUiState[layerId]) return null;
    return _pendingLayerUiState[layerId];
  }

  function _writePendingLayerUiState(layerId, patch) {
    var current, key;
    if (!layerId || !patch) return;
    current = _pendingLayerUiState[layerId] || {};
    for (key in patch) {
      if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
      current[key] = patch[key];
    }
    _pendingLayerUiState[layerId] = current;
  }

  function _clearPendingLayerUiState(layerId, keys) {
    var current, i;
    if (!layerId || !_pendingLayerUiState[layerId]) return;
    if (!keys || !keys.length) {
      delete _pendingLayerUiState[layerId];
      return;
    }
    current = _pendingLayerUiState[layerId];
    for (i = 0; i < keys.length; i++) delete current[keys[i]];
    if (!Object.keys(current).length) delete _pendingLayerUiState[layerId];
  }

  function _getPendingVisible(layerId) {
    var current = _readPendingLayerUiState(layerId);
    if (!current || !Object.prototype.hasOwnProperty.call(current, 'visible')) return null;
    return !!current.visible;
  }

  function _getPendingOpacity(layerId) {
    var current = _readPendingLayerUiState(layerId);
    if (!current || !Object.prototype.hasOwnProperty.call(current, 'opacity')) return null;
    return current.opacity;
  }

  function _getPendingVisibilityKey(type, id) {
    return type + ':' + id;
  }

  function _getPendingOpacityKey(type, id) {
    return type + ':' + id;
  }

  function _getPendingGroupVisible(groupId) {
    var entry = _pendingVisibilityUpdates[_getPendingVisibilityKey('group', groupId)];
    if (!entry || entry.type !== 'group') return null;
    return !!entry.visible;
  }

  function _applyPendingLayerUiState(layers) {
    var out = [];
    var i, layer, copy, pendingVisible, pendingOpacity, key;
    for (i = 0; i < (layers || []).length; i++) {
      layer = layers[i];
      if (!layer) continue;
      copy = {};
      for (key in layer) {
        if (Object.prototype.hasOwnProperty.call(layer, key)) copy[key] = layer[key];
      }
      pendingVisible = _getPendingVisible(copy.id);
      pendingOpacity = _getPendingOpacity(copy.id);
      if (pendingVisible !== null) copy.visible = pendingVisible;
      if (pendingOpacity !== null) copy.opacity = pendingOpacity;
      out.push(copy);
    }
    return out;
  }

  function _getKnownLayerIds(layers) {
    var known = {};
    var bookmark = getBookmarkInfo();
    var i;
    for (i = 0; i < (layers || []).length; i++) {
      if (layers[i] && layers[i].id) known[layers[i].id] = true;
    }
    if (bookmark && Array.isArray(bookmark.layers)) {
      for (i = 0; i < bookmark.layers.length; i++) {
        if (bookmark.layers[i] && bookmark.layers[i].id) known[bookmark.layers[i].id] = true;
      }
    }
    return known;
  }

  function _getStoreGroupVisible(groupId, activeLayers) {
    var store = window.TnetLMStore;
    var index = store && typeof store.getCoalesceIndex === 'function' ? store.getCoalesceIndex() : null;
    var info = index && index[groupId] ? index[groupId] : null;
    var activeById = {};
    var i, childId;
    if (!info || !info.childIds || !info.childIds.length) return null;
    for (i = 0; i < (activeLayers || []).length; i++) {
      if (activeLayers[i] && activeLayers[i].id) activeById[activeLayers[i].id] = activeLayers[i];
    }
    for (i = 0; i < info.childIds.length; i++) {
      childId = info.childIds[i];
      if (activeById[childId] && activeById[childId].visible !== false) return true;
    }
    return false;
  }

  function _cleanupPendingState(layers) {
    var knownLayerIds = _getKnownLayerIds(layers);
    var store = window.TnetLMStore;
    var index = store && typeof store.getCoalesceIndex === 'function' ? store.getCoalesceIndex() : null;
    var activeLayers = store && typeof store.getActiveLayers === 'function' ? store.getActiveLayers() : [];
    var key, id, pendingEntry, currentVisible;

    for (id in _pendingLayerUiState) {
      if (!Object.prototype.hasOwnProperty.call(_pendingLayerUiState, id)) continue;
      if (!knownLayerIds[id]) delete _pendingLayerUiState[id];
    }

    for (key in _pendingVisibilityUpdates) {
      if (!Object.prototype.hasOwnProperty.call(_pendingVisibilityUpdates, key)) continue;
      pendingEntry = _pendingVisibilityUpdates[key];
      if (!pendingEntry) continue;
      if (pendingEntry.type === 'group') {
        if (!index || !index[pendingEntry.id]) {
          delete _pendingVisibilityUpdates[key];
          continue;
        }
        currentVisible = _getStoreGroupVisible(pendingEntry.id, activeLayers);
        if (currentVisible === pendingEntry.visible) delete _pendingVisibilityUpdates[key];
        continue;
      }
      if (!knownLayerIds[pendingEntry.id]) delete _pendingVisibilityUpdates[key];
    }

    for (key in _pendingOpacityUpdates) {
      if (!Object.prototype.hasOwnProperty.call(_pendingOpacityUpdates, key)) continue;
      pendingEntry = _pendingOpacityUpdates[key];
      if (!pendingEntry) continue;
      if (pendingEntry.type === 'group') {
        if (!index || !index[pendingEntry.id]) delete _pendingOpacityUpdates[key];
        continue;
      }
      if (!knownLayerIds[pendingEntry.id]) delete _pendingOpacityUpdates[key];
    }
  }

  function _setPendingGroupVisible(groupId, visible) {
    var store = window.TnetLMStore;
    var index = store && typeof store.getCoalesceIndex === 'function' ? store.getCoalesceIndex() : null;
    var info = index && index[groupId] ? index[groupId] : null;
    var childIds = [];
    var i;
    if (!info || !info.childIds || !info.childIds.length) return childIds;
    for (i = 0; i < info.childIds.length; i++) {
      childIds.push(info.childIds[i]);
      _writePendingLayerUiState(info.childIds[i], { visible: !!visible });
    }
    return childIds;
  }

  function _setPendingGroupOpacity(groupId, opacity) {
    var store = window.TnetLMStore;
    var index = store && typeof store.getCoalesceIndex === 'function' ? store.getCoalesceIndex() : null;
    var info = index && index[groupId] ? index[groupId] : null;
    var i;
    if (!info || !info.childIds || !info.childIds.length) return;
    for (i = 0; i < info.childIds.length; i++) {
      _writePendingLayerUiState(info.childIds[i], { opacity: opacity });
    }
  }

  function _flushPendingVisibilityUpdates() {
    var store = window.TnetLMStore;
    var key, entry, currentVisible;
    _visibilityFlushTimer = null;
    if (!store) return;

    // Redundante Full-Rebuilds (active-layers-changed) waehrend dieser Flush unterdruecken;
    // das Auge wurde bereits inline gesetzt und _onVisibility aktualisiert es ebenfalls inline.
    _suppressVisibilityRender = true;
    try {
      for (key in _pendingVisibilityUpdates) {
        if (!_pendingVisibilityUpdates.hasOwnProperty(key)) continue;
        entry = _pendingVisibilityUpdates[key];
        if (!entry) continue;
        if (entry.type === 'group') {
          var index = typeof store.getCoalesceIndex === 'function' ? store.getCoalesceIndex() : null;
          var info = index && index[entry.id] ? index[entry.id] : null;
          if (info && info.childIds && info.childIds.length && typeof store.setLayerEye === 'function') {
            for (var ci = 0; ci < info.childIds.length; ci++) {
              store.setLayerEye(info.childIds[ci], !!entry.visible);
            }
          } else {
            currentVisible = _getStoreGroupVisible(entry.id, store.getActiveLayers ? store.getActiveLayers() : []);
            if (currentVisible !== null && currentVisible !== entry.visible && typeof store.toggleCoalesceGroupEye === 'function') {
              store.toggleCoalesceGroupEye(entry.id);
            }
          }
          continue;
        }
        if (typeof store.setLayerEye === 'function') store.setLayerEye(entry.id, !!entry.visible);
      }
    } finally {
      _suppressVisibilityRender = false;
    }
  }

  function _scheduleVisibilityUpdate(type, id, visible, immediate) {
    var key;
    if (!id) return;
    key = _getPendingVisibilityKey(type, id);
    _pendingVisibilityUpdates[key] = { type: type, id: id, visible: !!visible };

    if (immediate) {
      if (_visibilityFlushTimer) {
        clearTimeout(_visibilityFlushTimer);
        _visibilityFlushTimer = null;
      }
      _flushPendingVisibilityUpdates();
      return;
    }

    if (_visibilityFlushTimer) return;
    _visibilityFlushTimer = setTimeout(_flushPendingVisibilityUpdates, VISIBILITY_FLUSH_DELAY);
  }

  function _flushPendingOpacityUpdates() {
    var store = window.TnetLMStore;
    var key, entry;
    _opacityFlushTimer = null;
    if (!store) return;

    for (key in _pendingOpacityUpdates) {
      if (!_pendingOpacityUpdates.hasOwnProperty(key)) continue;
      entry = _pendingOpacityUpdates[key];
      if (!entry) continue;
      if (entry.type === 'group') _applyGroupOpacity(entry.id, entry.opacity);
      else store.setLayerOpacity(entry.id, entry.opacity);
    }
    _pendingOpacityUpdates = {};
  }

  function _getGroupChildLayerIds(groupId) {
    var ids = [];
    var i;
    var store = window.TnetLMStore;
    var index = store && typeof store.getCoalesceIndex === 'function' ? store.getCoalesceIndex() : null;
    var info = index && index[groupId] ? index[groupId] : null;

    if (info && info.childIds && info.childIds.length) {
      for (i = 0; i < info.childIds.length; i++) ids.push(info.childIds[i]);
      return ids;
    }

    if (!_container) return ids;
    var groupEl = _container.querySelector('.lm-active-group[data-group-id="' + groupId + '"]');
    if (!groupEl) return ids;
    var children = groupEl.querySelectorAll('.lm-active-group-child[data-layer-id]');
    for (i = 0; i < children.length; i++) {
      var id = children[i].dataset.layerId;
      if (id) ids.push(id);
    }
    return ids;
  }

  function _applyGroupOpacity(groupId, opacity) {
    var store = window.TnetLMStore;
    var index = store && typeof store.getCoalesceIndex === 'function' ? store.getCoalesceIndex() : null;
    var isCoalesceGroup = !!(index && index[groupId]);
    var childIds;
    var ci;

    if (!store) return;

    if (isCoalesceGroup && typeof store.setCoalesceGroupOpacity === 'function') {
      store.setCoalesceGroupOpacity(groupId, opacity);
      return;
    }

    // Synthetische/Bookmark-Gruppen: Opazitaet auf alle Kindlayer anwenden.
    childIds = _getGroupChildLayerIds(groupId);
    for (ci = 0; ci < childIds.length; ci++) {
      if (typeof store.setLayerOpacity === 'function') {
        store.setLayerOpacity(childIds[ci], opacity);
      }
    }
  }

  function _scheduleOpacityUpdate(type, id, opacity, immediate) {
    var key;
    if (!id) return;
    key = _getPendingOpacityKey(type, id);
    _pendingOpacityUpdates[key] = { type: type, id: id, opacity: opacity };

    if (immediate) {
      if (_opacityFlushTimer) {
        clearTimeout(_opacityFlushTimer);
        _opacityFlushTimer = null;
      }
      _flushPendingOpacityUpdates();
      return;
    }

    if (_opacityFlushTimer) return;
    _opacityFlushTimer = setTimeout(_flushPendingOpacityUpdates, OPACITY_FLUSH_DELAY);
  }

  // Drosselt Store-Opacity-Calls auf einen pro Animationsframe (latest wins).
  function _queueOpacityApply(type, id, value) {
    if (!id) return;
    _opacityApplyQueue[type + ':' + id] = { type: type, id: id, value: value };
    if (_opacityApplyRaf) return;
    _opacityApplyRaf = (typeof requestAnimationFrame === 'function')
      ? requestAnimationFrame(_flushOpacityApply)
      : setTimeout(_flushOpacityApply, 16);
  }

  function _flushOpacityApply() {
    _opacityApplyRaf = null;
    var store = window.TnetLMStore;
    var key, e;
    if (!store) { _opacityApplyQueue = {}; return; }
    for (key in _opacityApplyQueue) {
      if (!_opacityApplyQueue.hasOwnProperty(key)) continue;
      e = _opacityApplyQueue[key];
      if (!e) continue;
      if (e.type === 'group') {
        _applyGroupOpacity(e.id, e.value);
      } else if (typeof store.setLayerOpacity === 'function') {
        store.setLayerOpacity(e.id, e.value);
      }
    }
    _opacityApplyQueue = {};
  }

  function updateBookmarkLayerState(layerId, patch) {
    var bookmark = getBookmarkInfo();
    var changed = false;
    if (!bookmark) return false;

    bookmark.layers.forEach(function(layer) {
      if (!layer || layer.id !== layerId) return;
      Object.keys(patch || {}).forEach(function(key) {
        layer[key] = patch[key];
        changed = true;
      });
    });

    return changed;
  }

  function removeBookmarkLayerState(layerId) {
    var bookmark = getBookmarkInfo();
    var before;
    if (!bookmark) return false;
    before = bookmark.layers.length;
    bookmark.layers = bookmark.layers.filter(function(layer) {
      return layer && layer.id !== layerId;
    });
    return bookmark.layers.length !== before;
  }

  function removeBookmarkGroupState(groupId) {
    var bookmark = getBookmarkInfo();
    var store = window.TnetLMStore;
    var index = store && typeof store.getCoalesceIndex === 'function' ? store.getCoalesceIndex() : null;
    var info = index && index[groupId] ? index[groupId] : null;
    var before;
    if (!bookmark || !info || !info.childIds || !info.childIds.length) return false;
    before = bookmark.layers.length;
    bookmark.layers = bookmark.layers.filter(function(layer) {
      return layer && info.childIds.indexOf(layer.id) === -1;
    });
    return bookmark.layers.length !== before;
  }

  function reorderBookmarkLayerState(orderedIds) {
    var bookmark = getBookmarkInfo();
    var byId = {};
    var reordered = [];
    if (!bookmark || !orderedIds || !orderedIds.length) return false;

    bookmark.layers.forEach(function(layer) {
      if (layer && layer.id) byId[layer.id] = layer;
    });

    orderedIds.forEach(function(layerId, index) {
      if (!byId[layerId]) return;
      byId[layerId].order = index;
      reordered.push(byId[layerId]);
      delete byId[layerId];
    });

    Object.keys(byId).forEach(function(layerId) {
      reordered.push(byId[layerId]);
    });

    bookmark.layers = reordered;
    return true;
  }

  function mergeBookmarkLayers(bookmarkLayers, liveLayers, includeLiveExtras, originalBookmarkLayers) {
    var liveById = {};
    var usedLiveIds = {};
    var originalBookmarkIds = {};

    (liveLayers || []).forEach(function(layer) {
      if (layer && layer.id) liveById[layer.id] = layer;
    });

    (originalBookmarkLayers || bookmarkLayers || []).forEach(function(layer) {
      if (layer && layer.id) originalBookmarkIds[layer.id] = true;
    });

    var merged = (bookmarkLayers || []).map(function(layer, index) {
      var out = {};
      var live = layer && layer.id ? liveById[layer.id] : null;
      var key;

      for (key in layer) {
        if (Object.prototype.hasOwnProperty.call(layer, key)) out[key] = layer[key];
      }
      if (live) {
        for (key in live) {
          if (Object.prototype.hasOwnProperty.call(live, key) && live[key] != null) out[key] = live[key];
        }
        usedLiveIds[layer.id] = true;
      }

      if (!out.name) out.name = out.id || ('Layer ' + (index + 1));
      if (out.visible === undefined) out.visible = true;
      if (out.opacity == null) out.opacity = 1;
      return out;
    });

    // Live-Layer ohne Bookmark-Eintrag OBEN einfuegen, damit neu aus dem Themenkatalog
    // aktivierte Themen zuoberst erscheinen (zuletzt hinzugefuegter ganz oben) — konsistent
    // mit dem Direkt-Pfad in _onVisibility (unshift). Frueher wurden sie unten angehaengt,
    // was je nach Aktivierungspfad zu inkonsistenter Position fuehrte.
    if (includeLiveExtras !== false) {
      var liveExtras = [];
      (liveLayers || []).forEach(function(layer) {
        if (!layer || !layer.id) return;
        if (usedLiveIds[layer.id]) return;
        if (originalBookmarkIds[layer.id]) return;
        var copy = {};
        for (var k in layer) {
          if (Object.prototype.hasOwnProperty.call(layer, k)) copy[k] = layer[k];
        }
        if (!copy.name) copy.name = copy.id;
        if (copy.visible === undefined) copy.visible = true;
        if (copy.opacity == null) copy.opacity = 1;
        liveExtras.push(copy);
      });
      if (liveExtras.length) {
        // Zuletzt hinzugefuegter ganz oben: Reihenfolge umkehren, dann vor merged setzen.
        liveExtras.reverse();
        merged = liveExtras.concat(merged);
      }
    }

    // Finale Deduplizierung nach ID: Wird ein zuvor gesperrter (locked) Bookmark-
    // Layer nach einem Login aktiviert, koennen sowohl der locked-Platzhalter als
    // auch der frisch materialisierte Live-Layer mit derselben ID in der Liste
    // landen (Duplikat mit abweichender Deckkraft). Pro ID nur einen Eintrag
    // behalten; ein nicht gesperrter Eintrag gewinnt gegen den locked-Platzhalter.
    var dedupById = {};
    var deduped = [];
    merged.forEach(function(entry) {
      if (!entry || !entry.id) { deduped.push(entry); return; }
      var existing = dedupById[entry.id];
      if (!existing) {
        dedupById[entry.id] = entry;
        deduped.push(entry);
        return;
      }
      // Konflikt: gesperrten Platzhalter durch den echten (entsperrten) Eintrag ersetzen.
      if (_isActiveLayerLocked(existing) && !_isActiveLayerLocked(entry)) {
        var idx = deduped.indexOf(existing);
        if (idx !== -1) deduped[idx] = entry;
        dedupById[entry.id] = entry;
      }
      // sonst: Duplikat verwerfen
    });
    merged = deduped;

    return merged;
  }

  function shouldIncludeLiveExtrasForBookmark(bookmark) {
    if (!bookmark) return true;
    if (_isBookmarkLoadActive() || _isViewSwitchActive()) return false;
    // Live-Extras erst dann in den TOC mischen, wenn der Nutzer das Bookmark
    // tatsaechlich veraendert hat. Ein bloss abgelaufenes Ladefenster darf
    // keine Alt-Layer aus dem vorherigen Kartenzustand wieder einblenden.
    return !!_bmModified;
  }

  function filterRenderableBookmarkLayers(bookmarkLayers) {
    var store = window.TnetLMStore;
    var filtered;
    if (!Array.isArray(bookmarkLayers)) return [];
    if (!store || typeof store.isRenderableLayerId !== 'function') return bookmarkLayers.slice();

    filtered = bookmarkLayers.filter(function(layer) {
      if (!layer || !layer.id) return false;
      // Gesperrte Layer immer im Karteninhalt anzeigen (Schloss), auch wenn
      // sie nicht renderbar sind (url:"secured").
      if (_isActiveLayerLocked(layer)) return true;
      return store.isRenderableLayerId(layer.id);
    });
    // Manche Bookmark-Layer sind im Legacy-Framework nicht belastbar über den
    // Katalog aufloesbar, sollen im Karteninhalt aber trotzdem erscheinen.
    // Wenn der Render-Filter alles wegwirft, auf die originale Bookmark-Liste
    // zurueckfallen statt einen leeren TOC zu zeigen.
    if (!filtered.length && bookmarkLayers.length) return bookmarkLayers.slice();
    return filtered;
  }

  function pruneContainerCatalogLayers(layers) {
    var store = window.TnetLMStore;
    var allIds = [];
    var i;
    if (!Array.isArray(layers) || !layers.length) return [];
    if (!store || typeof store.findLayer !== 'function') return layers.slice();

    for (i = 0; i < layers.length; i++) {
      if (layers[i] && layers[i].id) allIds.push(layers[i].id);
    }

    return layers.filter(function(layer) {
      if (!layer || !layer.id) return false;

      // Strukturelle Parent-IDs ausblenden, wenn gleichzeitig Kind-Layer
      // mit demselben Prefix aktiv sind (z.B. .../karte18_siedlung + .../karte18_siedlung/*).
      if (_isStructuralLayerIdForViewSwitch(layer.id, allIds, store)) return false;

      var catalogNode = store.findLayer(layer.id);
      if (!catalogNode) return true;

      // Nicht-blättrige Katalogknoten sind reine Container und sollen im
      // Karteninhalt nicht als eigene Layer-Zeile erscheinen.
      if (catalogNode.type === 'group') return false;
      if (Array.isArray(catalogNode.layers) && catalogNode.layers.length) return false;
      if (Array.isArray(catalogNode.groups) && catalogNode.groups.length) return false;
      if (Array.isArray(catalogNode.subcategories) && catalogNode.subcategories.length) return false;
      if (Array.isArray(catalogNode.children) && catalogNode.children.length) return false;

      return true;
    });
  }

  function _initIcons() {
    ICON.eyeOn    = TnetIcons.get('eye-on', 'lm-icon');
    ICON.eyeOff   = TnetIcons.get('eye-off', 'lm-icon');
    ICON.drag     = TnetIcons.get('drag-handle', 'lm-icon lm-icon-drag');
    ICON.remove   = TnetIcons.get('close', 'lm-icon');
    ICON.legend   = TnetIcons.get('legend-colors', 'lm-icon');
    ICON.expand   = TnetIcons.get('chevron-right', 'lm-icon');
    ICON.collapse = TnetIcons.get('chevron-down', 'lm-icon');
    ICON.group    = TnetIcons.get('folder', 'lm-icon');
    ICON.trash    = TnetIcons.get('trash', 'lm-icon');
  }

  function focusActivePanelForBookmark() {
    if (!getBookmarkInfo() && !getPendingBookmarkInfo()) return;

    if (window.__TNET_MOBILE_ENTRY) {
      if (typeof window.closeLayersSheet === 'function') {
        window.closeLayersSheet();
      }
      if (typeof window.openActiveSheet === 'function') {
        window.openActiveSheet();
      }
      return;
    }

    var activePanel = document.getElementById('tp_sort_menu');
    var overviewPanel = document.getElementById('tp_overview_menu');

    if (overviewPanel && overviewPanel.open) {
      overviewPanel.open = false;
    }
    if (activePanel && !activePanel.open) {
      activePanel.open = true;
    }
  }

  // ===== BOOKMARK-API: REIHENFOLGE & NLS-GRUPPEN-NAMEN =====

  /** Aktives Profil aus URL (?group=) ermitteln. Default: 'public'. */
  function _resolveProfile() {
    if (typeof TnetApi !== 'undefined' && typeof TnetApi.getActiveProfile === 'function') {
      return TnetApi.getActiveProfile();
    }
    try {
      var p = new URLSearchParams((window.top || window).location.search);
      var g = p.get('group');
      return (g && g.trim()) ? g.trim() : 'public';
    } catch (e) { return 'public'; }
  }

  /** Sammelt rekursiv alle Knoten-IDs eines API-Tree. */
  function _collectApiIds(nodes) {
    var ids = [];
    (nodes || []).forEach(function (n) {
      if (!n) return;
      ids.push(n.id);
      _collectApiIds(n.children || []).forEach(function (id) { ids.push(id); });
    });
    return ids;
  }

  /** Uebernimmt Knoten-Namen + Render-Metadaten + Original-Zustand rekursiv aus dem API-Tree. */
  function _storeApiNodeNames(node) {
    if (!node || !node.id) return;
    if (node.name) _apiLeafNames[node.id] = node.name;
    // Render-Metadaten (Legende, Typ, URL) aus der API uebernehmen, damit der
    // Karteninhalt diese direkt aus der Bookmark-API beziehen kann (Single-Source).
    var meta = null;
    if (node.legendLink != null) { meta = meta || {}; meta.legendLink = node.legendLink; }
    if (node.legendTitle != null) { meta = meta || {}; meta.legendTitle = node.legendTitle; }
    if (node.layerType != null) { meta = meta || {}; meta.layerType = node.layerType; }
    if (node.url != null) { meta = meta || {}; meta.url = node.url; }
    if (meta) _apiLeafMeta[node.id] = meta;
    (node.children || []).forEach(function (c) { _storeApiNodeNames(c); });
  }

  /**
   * Baut aus den API-Daten den Reihenfolge-Index (_apiOrderIndex), die Service-/
   * Gruppen-Namen (_apiGroupNames) und die Knoten-Namen (_apiLeafNames).
   * serviceGroups[].tree[] definiert die DB-/Profil-Reihenfolge; group.name liefert
   * den Gruppen-Header, node.name den jeweiligen Layer-Namen.
   */
  function _buildApiOrderIndex(data) {
    _apiOrderIndex = {};
    _apiGroupNames = {};
    _apiLeafNames = {};
    _apiLeafMeta = {};
    var sortIdx = 0;
    ((data && data.serviceGroups) || []).forEach(function (group) {
      var label = group.name || null;
      _collectApiIds(group.tree || []).forEach(function (id) {
        if (_apiOrderIndex[id] === undefined) _apiOrderIndex[id] = sortIdx++;
        if (label && _apiGroupNames[id] === undefined) _apiGroupNames[id] = label;
      });
      (group.tree || []).forEach(function (n) { _storeApiNodeNames(n); });
    });
  }

  /**
   * Sortiert bookmark.layers EINMAL nach der API-Reihenfolge. Ab dann steuert
   * bookmark.layers die Anzeige (V1-nativ). Wird uebersprungen wenn der Nutzer
   * bereits per Drag&Drop umsortiert hat (_userReordered) oder keine API-Order da ist.
   * Layer ohne API-Eintrag behalten ihre relative Reihenfolge am Ende (stabil).
   */
  function _applyApiOrderToBookmark() {
    if (_userReordered) return;
    var bm = getBookmarkInfo();
    if (!bm || !Array.isArray(bm.layers) || !bm.layers.length) return;
    if (Object.keys(_apiOrderIndex).length === 0) return;
    var order = _apiOrderIndex; var MAX = 999999;
    var indexed = bm.layers.map(function (l, i) { return { l: l, i: i }; });
    indexed.sort(function (a, b) {
      var oa = (a.l && order[a.l.id] !== undefined) ? order[a.l.id] : MAX;
      var ob = (b.l && order[b.l.id] !== undefined) ? order[b.l.id] : MAX;
      if (oa !== ob) return oa - ob;
      return a.i - b.i;
    });
    bm.layers = indexed.map(function (x) { return x.l; });
  }

  /** Wendet geladene API-Daten an: Reihenfolge in bookmark.layers einsortieren + Neuaufbau. */
  function _applyApiBookmarkData(data) {
    _apiBookmarkData = data;
    _buildApiOrderIndex(data);
    _applyApiOrderToBookmark();
    var store = window.TnetLMStore;
    if (store && typeof store.getActiveLayers === 'function') {
      _lastRenderHtml = null; // Neuaufbau mit API-Reihenfolge/Namen erzwingen
      LMActive.render(store.getActiveLayers());
    }
  }

  /**
   * Laedt die Bookmark-API-Daten (Reihenfolge + NLS-Namen) fuer eine Bookmark-ID.
   * Cached pro 'bookmarkId|profile'. Fail-safe: bei Fehler bleibt die
   * Katalog-Reihenfolge aktiv (kein Bruch des Panels).
   */
  function _loadBookmarkApiData(bookmarkId) {
    if (!bookmarkId) return;
    if (typeof TnetApi === 'undefined' || typeof TnetApi.getBookmarkV2 !== 'function') return;
    var profile = _resolveProfile();
    var cacheKey = bookmarkId + '|' + profile;
    if (_apiCache[cacheKey]) {
      _applyApiBookmarkData(_apiCache[cacheKey]);
      return;
    }
    TnetApi.getBookmarkV2(bookmarkId, profile)
      .then(function (data) {
        _apiCache[cacheKey] = data;
        _applyApiBookmarkData(data);
      })
      .catch(function (err) {
        TnetLog.warn(LOG, 'Bookmark-API Reihenfolge nicht verfuegbar:', (err && err.message) || err);
      });
  }

  /** Debug-Badge aktiv? Liest layerManager.debug aus der globalen Config. */
  function _isActivePanelDebug() {
    try {
      return !!(window.__tnetConfig && window.__tnetConfig.layerManager && window.__tnetConfig.layerManager.debug);
    } catch (e) { return false; }
  }

  /**
   * Ermittelt die fuer die Anzeige zu verwendende Opazitaet eines Layers.
   * Vorrang: explizite Layer-Opazitaet (Bookmark-Override / Live-Wert). Fehlt diese,
   * wird die im Katalog hinterlegte Default-Opazitaet (_configOpacity) genutzt. So
   * zeigt der Slider sofort den richtigen Wert statt 100% (kein Sprung beim Laden).
   */
  function _resolveDisplayOpacity(l) {
    if (l && l.opacity !== undefined && l.opacity !== null) return l.opacity;
    var store = window.TnetLMStore;
    if (l && l.id && store && typeof store.findLayer === 'function') {
      var cat = store.findLayer(l.id);
      if (cat && cat._configOpacity !== undefined && cat._configOpacity !== null) {
        return cat._configOpacity;
      }
    }
    return 1;
  }

  var LMActive = {

    init: function (containerId) {
      _initIcons();
      _container = document.getElementById(containerId);
      if (!_container) {
        TnetLog.error(LOG, 'Container #' + containerId + ' nicht gefunden');
        return;
      }

      var store = window.TnetLMStore;
      if (!store) {
        TnetLog.error(LOG, 'TnetLMStore nicht geladen');
        return;
      }

      _unlisteners.push(store.on('active-layers-changed', this._scheduleRender.bind(this)));
      _unlisteners.push(store.on('layer-visibility', this._onVisibility.bind(this)));
      _unlisteners.push(store.on('layer-opacity', this._onOpacity.bind(this)));
      _unlisteners.push(store.on('coalesce-group-opacity', this._onCoalesceGroupOpacity.bind(this)));
      _unlisteners.push(store.on('layer-loading', this._onLayerLoading.bind(this)));

      var self = this;
      var rerenderAndFocus = function () {
        // Schonfrist setzen: Store noch nicht synchron nach Bookmark-Load
        _bmModified = false;
        _bmLoadedRecently = true;
        _resetPendingUiState();
        if (_bmLoadTimer) clearTimeout(_bmLoadTimer);
        _bmLoadTimer = setTimeout(function () { _bmLoadedRecently = false; }, 800);

        // Bookmark-API: Reihenfolge/Namen-Zustand fuer das neue Bookmark zuruecksetzen
        // und neu laden. Die API sortiert bookmark.layers in die DB-Reihenfolge.
        _apiOrderIndex = {};
        _apiGroupNames = {};
        _apiLeafNames = {};
        _apiLeafMeta = {};
        _apiBookmarkData = null;
        _userReordered = false;
        var bm = window.__tnetActiveBookmark;
        var bmId = bm && (bm.id || bm['map-bookmark']);
        if (bmId) _loadBookmarkApiData(bmId);

        focusActivePanelForBookmark();
        self.render(store.getActiveLayers());
        _updateBookmarkUrlMode();
      };
      var rerender = function () {
        self.render(store.getActiveLayers());
        _updateBookmarkUrlMode();
      };
      var rerenderPending = function () {
        focusActivePanelForBookmark();
        self.render(store.getActiveLayers());
      };
      document.addEventListener('tnet-bookmark-loaded', rerenderAndFocus);
      document.addEventListener('tnet-bookmark-state-changed', rerender);
      document.addEventListener('tnet-bookmark-loading', rerenderPending);
      _unlisteners.push(function () {
        document.removeEventListener('tnet-bookmark-loaded', rerenderAndFocus);
        document.removeEventListener('tnet-bookmark-state-changed', rerender);
        document.removeEventListener('tnet-bookmark-loading', rerenderPending);
      });

      // Event-Delegation
      this._bindEvents();

      // Initial-State rendern
      var active = store.getActiveLayers();
      this.render(active);
      focusActivePanelForBookmark();

      // Falls beim Init bereits ein Bookmark aktiv ist (tnet-bookmark-loaded kann VOR
      // der Panel-Initialisierung gefeuert haben), API-Reihenfolge/Namen nachladen.
      var initBm = window.__tnetActiveBookmark;
      var initBmId = initBm && (initBm.id || initBm['map-bookmark']);
      if (initBmId) {
        _userReordered = false;
        _loadBookmarkApiData(initBmId);
      }

      TnetLog.log(LOG, 'Init ✓ → #' + containerId);
    },

    destroy: function () {
      _resetPendingUiState();
      if (_renderRaf) {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(_renderRaf);
        else clearTimeout(_renderRaf);
        _renderRaf = null;
      }
      _unlisteners.forEach(function (fn) { fn(); });
      _unlisteners = [];
      if (_container) _container.innerHTML = '';
    },

    // ============================================================
    // Render
    // ============================================================

    /**
     * Koalesziert mehrere active-layers-changed-Events eines Frames zu
     * einem einzigen render(). Verhindert Flicker beim Bookmark-Load.
     * Liest beim Flush immer den aktuellen Store-Zustand.
     */
    _scheduleRender: function () {
      if (_suppressVisibilityRender) return;  // eigener Eye-Toggle hat bereits inline aktualisiert
      if (_renderRaf) return;
      var self = this;
      var flush = function () {
        _renderRaf = null;
        var store = window.TnetLMStore;
        self.render(store ? store.getActiveLayers() : []);
      };
      _renderRaf = (typeof requestAnimationFrame === 'function')
        ? requestAnimationFrame(flush)
        : setTimeout(flush, 16);
    },

    render: function (layers) {
      if (!_container) {
        TnetLog.warn(LOG, 'render: Container fehlt');
        return;
      }

      // Waehrend einer aktiven Interaktion (Auge-Toggle-Flush oder Opacity-Drag)
      // KEIN vollstaendiger innerHTML-Rebuild: das wuerde den gerade angefassten
      // Knoten (Slider/Auge) zerstoeren → Slider haengt, Auge flimmert, Schaltung
      // wirkt verzoegert. UI ist bereits inline aktualisiert; nur das Modified-Badge
      // wird leichtgewichtig nachgezogen. Externe Aenderungen (kein Guard gesetzt)
      // rendern weiterhin vollstaendig.
      if (_suppressVisibilityRender || _activeOpacitySlider) {
        this._refreshModifiedBadge();
        return;
      }

      var bookmarkInfo = getBookmarkInfo();
      ensureUrlOverrideResetSnapshot(bookmarkInfo);
      var pendingBookmark = getPendingBookmarkInfo() || (!bookmarkInfo ? getUrlBookmarkHint() : null);
      var showPendingLoad = !bookmarkInfo && !!pendingBookmark;
      var bookmarkLayers = bookmarkInfo ? filterRenderableBookmarkLayers(bookmarkInfo.layers) : null;
      var includeLiveExtras = shouldIncludeLiveExtrasForBookmark(bookmarkInfo);
      var effectiveLayers = bookmarkInfo
        ? mergeBookmarkLayers(bookmarkLayers, Array.isArray(layers) ? layers : [], includeLiveExtras, bookmarkInfo.layers)
        : Array.isArray(layers) ? layers.slice() : [];

      effectiveLayers = pruneContainerCatalogLayers(effectiveLayers);

      _cleanupPendingState(effectiveLayers);
      effectiveLayers = _applyPendingLayerUiState(effectiveLayers);

                        var pendingName = pendingBookmark && pendingBookmark.name ? pendingBookmark.name : null;
                        var activeBookmarkName = bookmarkInfo && bookmarkInfo.name ? bookmarkInfo.name : null;
                        var unresolvedBookmark = bookmarkInfo && bookmarkInfo.id && !activeBookmarkName;
                        var bmName    = activeBookmarkName ||
                          pendingName ||
                          (unresolvedBookmark || showPendingLoad ? 'Karte wird geladen...' : null) ||
                          (!showPendingLoad && pendingBookmark && pendingBookmark.id) || null;
      var bmViews   = bookmarkInfo && bookmarkInfo.views || [];
      var bmViewId  = bookmarkInfo && bookmarkInfo.activeViewId || null;
      var totalLayers = effectiveLayers.length;
      var bmModified = bmName ? _isActiveBookmarkModified() : false;

      // Nicht rendern während Drag aktiv (sonst springt alles)
      if (_dragState) {
        TnetLog.log(LOG, 'render übersprungen (Drag aktiv)');
        return;
      }

      var html = '<div class="lm-active-header">';
      html += '<div class="lm-active-meta">';
      html += '<div class="lm-active-meta-block lm-active-meta-map">';
      html += '<span class="lm-active-meta-label">Karte</span>';
      html += '<button class="lm-active-map-switch" data-action="map-switch" title="Karte wechseln">' + esc(bmName || 'keine gewählt') + '</button>';
      html += '</div>';
      if (!window.__TNET_MOBILE_ENTRY && bmViews.length) {
        html += '<div class="lm-active-meta-block lm-active-meta-view">';
        html += '<span class="lm-active-meta-label">Ansicht</span>';
        html += '<select class="lm-active-view-select" data-action="switch-view" title="Kartenansicht wählen">';
        html += '<option value="">(Standard)</option>';
        bmViews.forEach(function(v) {
          var sel = (v.id === bmViewId) ? ' selected' : '';
          html += '<option value="' + esc(v.id) + '"' + sel + '>' + esc(v.name || v.id) + '</option>';
        });
        html += '</select>';
        html += '</div>';
      }
      html += '</div>';
      html += '<div class="lm-active-toolbar">';
      if (_isActivePanelDebug()) {
        html += '<span class="lm-active-debug-badge" title="Karteninhalt-Debug aktiv (Bookmark-API: Reihenfolge + NLS-Namen)" ' +
          'style="display:inline-flex;align-items:center;padding:1px 6px;font-size:10px;font-weight:700;' +
          'background:#1e6a4a;color:#fff;border-radius:3px;letter-spacing:.5px;cursor:default;margin-right:4px;">V2</span>';
      }
      if (showPendingLoad) {
        html += '<span class="lm-active-count lm-active-count-loading">Karte wird geladen...</span>';
      } else {
        html += '<span class="lm-active-count">' + totalLayers + ' Themen</span>';
      }
      if (bmName && bmModified) {
        html += '<span class="lm-active-modified">';
        html += '<span class="lm-bm-modified-badge" title="Bookmark wurde verändert">&#10033;</span>';
        html += '<button class="lm-btn-bm-reset" data-action="bm-reset" title="Karteninhalt zurücksetzen">Ansicht zurücksetzen</button>';
        html += '</span>';
      }
      html += '<button class="lm-btn-remove-all" data-action="remove-all" title="Karteninhalt leeren"' + (totalLayers ? '' : ' disabled') + '>Karteninhalt leeren</button>';
      html += '</div>';

      if (!totalLayers) {
        if (showPendingLoad) {
          html += '<div class="lm-pending-load">';
          html += '<div class="lm-pending-load-spinner" aria-hidden="true"></div>';
          html += '<div class="lm-pending-load-copy">';
          html += '<div class="lm-pending-load-title">Karteninhalt wird vorbereitet</div>';
          html += '<div class="lm-pending-load-text">Bookmark und Themen werden geladen. Die Grundkarte ist bereits da, der Fachinhalt folgt gleich.</div>';
          html += '</div>';
          html += '</div>';
        } else {
          html += '<div class="lm-empty">Keine Themen dargestellt.<br><small style="color:#aaa">Themen im Themenkatalog aktivieren.</small></div>';
        }
        html += '</div>';
        if (html === _lastRenderHtml && _container.firstChild) {
          return;
        }
        _lastRenderHtml = html;
        _container.innerHTML = html;
        TnetLog.log(LOG, 'render: Leerzustand');
        return;
      }

      // Einträge gruppieren (Standalone vs. Coalesce-Gruppen)
      var entries = this._buildActiveEntries(effectiveLayers);

      TnetLog.log(LOG, 'render:', totalLayers, 'Layer,', entries.length, 'Einträge');

      html += '</div>';
      html += '<ul class="lm-active-list">';

      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (entry.type === 'group') {
          html += this._renderGroup(entry);
        } else {
          html += this._renderStandalone(entry.layer);
        }
      }

      html += '</ul>';

      // Identischer Inhalt → KEIN DOM-Rebuild. Verhindert den durch den Event-Sturm
      // ausgeloesten Knoten-Austausch (Hover-Flimmern, Slider-Haenger, verschluckte Klicks).
      if (html === _lastRenderHtml && _container.firstChild) {
        return;
      }
      _lastRenderHtml = html;
      _container.innerHTML = html;
    },

    /**
     * Aktualisiert nur das Bookmark-"veraendert"-Badge + Reset-Button im bestehenden
     * Header, OHNE die Layer-Liste neu zu bauen. Wird waehrend aktiver Interaktionen
     * (Eye-Toggle, Opacity-Drag) statt eines Full-Rebuilds aufgerufen.
     */
    _refreshModifiedBadge: function () {
      if (!_container) return;
      var toolbar = _container.querySelector('.lm-active-toolbar');
      if (!toolbar) return;

      var bookmarkInfo = getBookmarkInfo();
      var bmName = bookmarkInfo && (bookmarkInfo.name || bookmarkInfo.id) || null;
      if (!bmName) return;

      var store = window.TnetLMStore;
      var activeLayers = (store && store.getActiveLayers) ? store.getActiveLayers() : [];
      var bookmarkLayers = filterRenderableBookmarkLayers(bookmarkInfo.layers);
      var includeLiveExtras = shouldIncludeLiveExtrasForBookmark(bookmarkInfo);
      var effectiveLayers = mergeBookmarkLayers(bookmarkLayers, activeLayers, includeLiveExtras, bookmarkInfo.layers);
      effectiveLayers = _applyPendingLayerUiState(effectiveLayers);
      var bmModified = _isActiveBookmarkModified();

      var modifiedWrap = toolbar.querySelector('.lm-active-modified');
      var clearBtn = toolbar.querySelector('.lm-btn-remove-all');

      if (bmModified && !modifiedWrap) {
        var wrap = document.createElement('span');
        wrap.className = 'lm-active-modified';

        var badge = document.createElement('span');
        badge.className = 'lm-bm-modified-badge';
        badge.title = 'Bookmark wurde verändert';
        badge.innerHTML = '&#10033;';

        var resetBtn = document.createElement('button');
        resetBtn.className = 'lm-btn-bm-reset';
        resetBtn.setAttribute('data-action', 'bm-reset');
        resetBtn.title = 'Bookmark zurücksetzen';
        resetBtn.textContent = 'Ansicht zurücksetzen';

        wrap.appendChild(badge);
        wrap.appendChild(resetBtn);
        if (clearBtn) toolbar.insertBefore(wrap, clearBtn);
        else toolbar.appendChild(wrap);
      } else if (!bmModified && modifiedWrap) {
        modifiedWrap.remove();
      }
      // DOM wurde ausserhalb des Render-Pfads veraendert → Signatur invalidieren,
      // damit der naechste vollstaendige render() zuverlaessig re-synchronisiert.
      _lastRenderHtml = null;
    },

    /**
     * Gruppiert aktive Layer in Standalone und Coalesce-Gruppen.
     * Reihenfolge: Erster Layer einer Gruppe bestimmt Position der gesamten Gruppe.
     */
    _buildActiveEntries: function (layers) {
      var entries = [];
      var seenGroups = {};  // groupId → entry-Object
      var syntheticGroups = {};
      var store = window.TnetLMStore;
      var haveApiLeafNames = Object.keys(_apiLeafNames).length > 0;
      var haveApiLeafMeta = Object.keys(_apiLeafMeta).length > 0;

      for (var i = 0; i < layers.length; i++) {
        var l = layers[i];
        // NLS-Layer-Namen aus der Bookmark-API uebernehmen (Standalone + Gruppen-Kinder).
        // l ist eine Kopie aus mergeBookmarkLayers → Mutation ist fuer den Store unkritisch.
        if (haveApiLeafNames && l && l.id && _apiLeafNames[l.id]) {
          l.name = _apiLeafNames[l.id];
        }
        // Render-Metadaten aus der Bookmark-API ueberlagern (Single-Source): Legende,
        // Diensttyp und URL. Die API hat Vorrang vor dem Store-Katalog; fehlt ein Feld,
        // bleibt der Store-/Katalog-Wert erhalten. Steuert _hasLegend + Legende-Button.
        if (haveApiLeafMeta && l && l.id && _apiLeafMeta[l.id]) {
          var apiMeta = _apiLeafMeta[l.id];
          if (apiMeta.legendLink != null) l.legendLink = apiMeta.legendLink;
          if (apiMeta.legendTitle != null) l.legendTitle = apiMeta.legendTitle;
          if (apiMeta.layerType != null) l.layerType = apiMeta.layerType;
          if (apiMeta.url != null) l.url = apiMeta.url;
        }
        var coalInfo = store ? store.getCoalesceInfo(l.id) : null;
        var syntheticInfo = (!coalInfo && store && typeof store.findLayer === 'function' && !store.findLayer(l.id))
          ? this._getSyntheticBookmarkGroup(l)
          : null;

        if (coalInfo) {
          if (!seenGroups[coalInfo.groupId]) {
            // Erste Layer dieser Coalesce-Gruppe → neuer Eintrag
            var entry = {
              type: 'group',
              groupId: coalInfo.groupId,
              groupName: coalInfo.groupName,
              serviceUrl: coalInfo.serviceUrl,
              children: [l]
            };
            entries.push(entry);
            seenGroups[coalInfo.groupId] = entry;
          } else {
            // Weiterer Layer derselben Gruppe
            seenGroups[coalInfo.groupId].children.push(l);
          }
        } else if (syntheticInfo) {
          if (!syntheticGroups[syntheticInfo.groupId]) {
            var syntheticEntry = {
              type: 'group',
              groupId: syntheticInfo.groupId,
              groupName: syntheticInfo.groupName,
              serviceUrl: null,
              children: [l]
            };
            entries.push(syntheticEntry);
            syntheticGroups[syntheticInfo.groupId] = syntheticEntry;
          } else {
            syntheticGroups[syntheticInfo.groupId].children.push(l);
          }
        } else {
          entries.push({ type: 'standalone', layer: l });
        }
      }

      // Gruppen-Header-Name aus der Bookmark-API (serviceGroups[].name) hat Vorrang vor
      // dem Dojo-Katalog-Namen. Die API liefert die kuratierten NLS-/Alias-Namen
      // (z.B. "Kulturobjekte (rechtskraeftig)"); der Dojo-Katalog liefert teils nur die
      // technische Kategorie-Description ("KULTURERBE"). Ohne API-Treffer bleibt der
      // bestehende Katalog-/Synthetik-Name als Fallback erhalten.
      if (Object.keys(_apiGroupNames).length > 0) {
        entries.forEach(function (entry) {
          if (entry.type !== 'group') return;
          var firstChild = entry.children && entry.children[0];
          if (!firstChild || !firstChild.id) return;
          var apiName = _apiGroupNames[firstChild.id];
          if (apiName) entry.groupName = apiName;
        });
      }

      return entries;
    },

    _getSyntheticBookmarkGroup: function (layer) {
      var id = layer && layer.id ? String(layer.id) : '';
      var parts = id.split('/');
      var root = parts.length > 2 ? parts[2] : '';
      if (!root) return null;

      return {
        groupId: 'bookmark-root:' + root,
        groupName: this._formatSyntheticBookmarkGroupName(root)
      };
    },

    _formatSyntheticBookmarkGroupName: function (root) {
      var text = String(root || '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (!text) return 'Weitere Ebenen';
      return text.replace(/(^|\s)([a-zäöü])/g, function (_, prefix, chr) {
        return prefix + chr.toUpperCase();
      });
    },

    /**
     * Rendert einen einzelnen Standalone-Layer (identisch zum bisherigen Verhalten).
     */
    _renderStandalone: function (l) {
      // Gesperrter Layer (kein Zugriff): Schloss statt Auge, ausgegraut,
      // kein Toggle und kein Opacity-Slider. Bleibt im Karteninhalt, damit
      // nach einem Login mit Zugriff dasselbe Bookmark wieder funktioniert.
      if (_isActiveLayerLocked(l)) {
        var lockedHtml = '<li class="lm-active-item lm-layer-locked" data-layer-id="' + esc(l.id) + '" data-locked="1">';
        lockedHtml += '<div class="lm-active-row">';
        lockedHtml += '<span class="lm-eye lm-cb-locked" title="Kein Zugriff – berechtigtes Login nötig" style="display:inline-flex;align-items:center;justify-content:center;opacity:.6">' + getLockIconSvg() + '</span>';
        lockedHtml += '<span class="lm-active-name" style="opacity:.6">' + esc(l.name) + '</span>';
        lockedHtml += '<button class="lm-btn-remove" data-action="remove" title="Layer entfernen" aria-label="Layer entfernen">&#10005;</button>';
        lockedHtml += '</div>';
        lockedHtml += '</li>';
        return lockedHtml;
      }
      var eyeIcon = l.visible ? ICON.eyeOn : ICON.eyeOff;
      var eyeCls = l.visible ? 'lm-eye' : 'lm-eye lm-eye-off';
      var itemCls = 'lm-active-item';
      var statusHtml = '';
      if (l.loading) {
        eyeCls += ' lm-eye-loading';
        itemCls += ' lm-layer-loading';
        statusHtml = '<span class="lm-layer-status">' + esc(l.loadingMessage || 'lädt...') + '</span>';
      } else if (l.loadingError) {
        itemCls += ' lm-layer-error';
        statusHtml = '<span class="lm-layer-status">' + esc(l.loadingMessage || 'Fehler') + '</span>';
      }
      if (l.loadingSlow) itemCls += ' lm-layer-slow';
      var opacity = _resolveDisplayOpacity(l);
      var opacityPct = Math.round(opacity * 100);

      var html = '<li class="' + itemCls + '" data-layer-id="' + esc(l.id) + '">';

      // Kopfzeile: Drag-Handle | Auge | Name | Legende | X
      html += '<div class="lm-active-row">';
      html += '<div class="lm-drag-handle" data-action="drag" title="Verschieben">' + ICON.drag + '</div>';
      html += '<button class="' + eyeCls + '" data-action="eye" title="Sichtbarkeit">' + eyeIcon + '</button>';
      html += '<span class="lm-active-name">' + esc(l.name) + '</span>';
      html += statusHtml;

      // Legende-Button
      if (this._hasLegend(l)) {
        html += '<button class="lm-btn-legend" data-action="legend" title="Legende anzeigen">' + ICON.legend + '</button>';
      }
      html += '<button class="lm-btn-remove" data-action="remove" title="Layer entfernen" aria-label="Layer entfernen">&#10005;</button>';
      html += '</div>';

      // Opazitäts-Slider
      html += '<div class="lm-opacity-row">';
      html += '<span class="lm-opacity-label">Deckkraft</span>';
      html += '<input type="range" class="lm-opacity-slider" data-action="opacity" min="0" max="100" value="' + opacityPct + '">';
      html += '<span class="lm-opacity-val">' + opacityPct + '%</span>';
      html += '</div>';

      html += '</li>';
      return html;
    },

    /**
     * Rendert eine Coalesce-Gruppe:
     * - Gruppen-Header: Auge | Ordner-Icon | Name | Expand/Collapse | X
     * - Gemeinsamer Opazitäts-Slider
     * - Kind-Layer (wenn aufgeklappt): nur Auge + Name
     */
    _renderGroup: function (entry) {
      var groupId = entry.groupId;
      var expanded = (_groupExpanded[groupId] !== undefined) ? _groupExpanded[groupId] : false;
      var expandCls = expanded ? '' : ' lm-collapsed';

      // Mittlere Opazität der Kinder berechnen + Sichtbarkeits-Zustand
      var totalOpacity = 0;
      var anyVisible = false;
      var allVisible = entry.children.length > 0;
      var anyLoading = false;
      var anyLoadingSlow = false;
      var anyLoadingError = false;
      for (var i = 0; i < entry.children.length; i++) {
        var c = entry.children[i];
        totalOpacity += _resolveDisplayOpacity(c);
        if (c.visible !== false) anyVisible = true;
        else allVisible = false;
        if (c.loading) anyLoading = true;
        if (c.loadingSlow) anyLoadingSlow = true;
        if (c.loadingError) anyLoadingError = true;
      }
      var avgOpacity = entry.children.length > 0 ? totalOpacity / entry.children.length : 1;
      var opacityPct = Math.round(avgOpacity * 100);

      // Teil-Sichtbarkeit: einige (aber nicht alle) Sublayer sichtbar → Auge heller.
      var partialVisible = anyVisible && !allVisible;
      var eyeIcon = anyVisible ? ICON.eyeOn : ICON.eyeOff;
      var eyeCls = 'lm-eye';
      if (!anyVisible) eyeCls += ' lm-eye-off';
      else if (partialVisible) eyeCls += ' lm-eye-partial';
      if (anyLoading) eyeCls += ' lm-eye-loading';
      var expandIcon = ICON.expand;
      var hasLegend = this._groupHasLegend(entry);
      var groupCls = 'lm-active-group' + expandCls;
      var groupStatusHtml = '';
      if (anyLoading) {
        groupCls += ' lm-layer-loading';
        if (anyLoadingSlow) groupCls += ' lm-layer-slow';
        groupStatusHtml = '<span class="lm-layer-status">' + (anyLoadingSlow ? 'lädt noch...' : 'lädt...') + '</span>';
      } else if (anyLoadingError) {
        groupCls += ' lm-layer-error';
        groupStatusHtml = '<span class="lm-layer-status">Fehler</span>';
      }

      var html = '<li class="' + groupCls + '" data-group-id="' + esc(groupId) + '">';

      // Gruppen-Header
      html += '<div class="lm-active-group-header" data-action="group-expand" title="Auf-/Zuklappen">';
      html += '<div class="lm-drag-handle" data-action="drag" title="Verschieben">' + ICON.drag + '</div>';
      html += '<button class="' + eyeCls + '" data-action="group-eye" title="Gruppe ein/aus">' + eyeIcon + '</button>';
      html += '<span class="lm-active-group-name">' + esc(entry.groupName) + '</span>';
      html += groupStatusHtml;
      // Legende-Button nur zeigen, wenn mindestens ein Kind effektiv eine Legende hat.
      if (hasLegend) {
        html += '<button class="lm-btn-legend" data-action="group-legend" title="Legende anzeigen">' + ICON.legend + '</button>';
      }
      html += '<button class="lm-btn-remove" data-action="group-remove" title="Gruppe entfernen" aria-label="Gruppe entfernen">&#10005;</button>';
      html += '<button class="lm-btn-expand" data-action="group-expand" title="Auf-/Zuklappen" aria-expanded="' + (expanded ? 'true' : 'false') + '">' + expandIcon + '</button>';
      html += '</div>';

      // Gemeinsamer Opazitäts-Slider
      html += '<div class="lm-opacity-row">';
      html += '<span class="lm-opacity-label">Deckkraft</span>';
      html += '<input type="range" class="lm-opacity-slider lm-group-opacity" data-action="group-opacity" min="0" max="100" value="' + opacityPct + '">';
      html += '<span class="lm-opacity-val">' + opacityPct + '%</span>';
      html += '</div>';

      // Kind-Layer
      html += '<ul class="lm-active-group-children">';
      for (var j = 0; j < entry.children.length; j++) {
        html += this._renderGroupChild(entry.children[j]);
      }
      html += '</ul>';

      html += '</li>';
      return html;
    },

    /**
     * Rendert ein Kind-Layer innerhalb einer Coalesce-Gruppe.
     * Nur Auge-Toggle + Name (kein Drag, kein eigener Opacity-Slider).
     */
    _renderGroupChild: function (l) {
      // Gesperrtes Kind-Layer: Schloss statt Auge, kein Toggle.
      if (_isActiveLayerLocked(l)) {
        var lockedHtml = '<li class="lm-active-group-child lm-layer-locked" data-layer-id="' + esc(l.id) + '" data-locked="1">';
        lockedHtml += '<span class="lm-eye lm-cb-locked" title="Kein Zugriff – berechtigtes Login nötig" style="display:inline-flex;align-items:center;justify-content:center;opacity:.6">' + getLockIconSvg() + '</span>';
        lockedHtml += '<span class="lm-active-name" style="opacity:.6">' + esc(l.name) + '</span>';
        lockedHtml += '<button class="lm-btn-remove" data-action="child-remove" title="Layer entfernen" aria-label="Layer entfernen">&#10005;</button>';
        lockedHtml += '</li>';
        return lockedHtml;
      }
      var eyeIcon = l.visible ? ICON.eyeOn : ICON.eyeOff;
      var eyeCls = l.visible ? 'lm-eye' : 'lm-eye lm-eye-off';
      var childCls = 'lm-active-group-child';
      var statusHtml = '';
      if (l.loading) {
        eyeCls += ' lm-eye-loading';
        childCls += ' lm-layer-loading';
        if (l.loadingSlow) childCls += ' lm-layer-slow';
        statusHtml = '<span class="lm-layer-status">' + esc(l.loadingMessage || 'lädt...') + '</span>';
      } else if (l.loadingError) {
        childCls += ' lm-layer-error';
        statusHtml = '<span class="lm-layer-status">' + esc(l.loadingMessage || 'Fehler') + '</span>';
      }

      var html = '<li class="' + childCls + '" data-layer-id="' + esc(l.id) + '">';
      html += '<button class="' + eyeCls + '" data-action="child-eye" title="Sichtbarkeit">' + eyeIcon + '</button>';
      html += '<span class="lm-active-name">' + esc(l.name) + '</span>';
      html += statusHtml;
      html += '<button class="lm-btn-remove" data-action="child-remove" title="Layer entfernen" aria-label="Layer entfernen">&#10005;</button>';
      html += '</li>';
      return html;
    },

    /**
     * Prüft ob ein Layer einen Legenden-Button erhalten soll.
     */
    _hasLegend: function (l) {
      var isWms = (l.type === 'wms' || (l.id && l.id.indexOf('wms:') === 0));
      var isArcgis = (!isWms && l.layerType === 'arcgisRest' && l.url && l.url.indexOf('agsproxy.php') !== -1);
      var hasExplicitLegend = (!isWms && !isArcgis && l.legendLink && l.legendLink !== '');
      return isWms || isArcgis || hasExplicitLegend;
    },

    _groupHasLegend: function (entry) {
      if (!entry || !entry.children || !entry.children.length) return false;
      for (var i = 0; i < entry.children.length; i++) {
        if (this._hasLegend(entry.children[i])) return true;
      }
      return false;
    },

    // ============================================================
    // Event-Delegation
    // ============================================================

    _bindEvents: function () {
      var self = this;

      // ── View-Dropdown (Kartenansicht wechseln) ──
      _container.addEventListener('change', function (e) {
        var sel = e.target.closest('[data-action="switch-view"]');
        if (!sel) return;
        var viewId = sel.value || null;
        var bm = window.__tnetActiveBookmark;
        if (!bm) return;
        // View-Wechsel ist kein Benutzer-Edit am Bookmark-Inhalt.
        // Während des asynchronen Reloads keine Dirty-Markierung und keine
        // Pending-UI-Reste aus der vorherigen Ansicht übernehmen.
        _bmModified = false;
        _userReordered = false;
        // Die neue Ansicht ist die neue Referenz: alten Reset-Snapshot der vorherigen
        // Ansicht verwerfen, sonst meldet _isActiveBookmarkModified faelschlich "veraendert".
        try { delete bm._resetLayers; delete bm._resetOptions; delete bm._resetFromBookmarkDefault; } catch (eDelViewSnap) { /* ignore */ }
        _bmViewSwitchUntil = Date.now() + 5000;
        _bmLoadedRecently = true;
        _resetPendingUiState();
        if (_bmLoadTimer) clearTimeout(_bmLoadTimer);
        _bmLoadTimer = setTimeout(function () { _bmLoadedRecently = false; }, 3500);
        // TnetSetBookmark mit neuer View aufrufen
        if (typeof window.TnetSetBookmark === 'function') {
          var bookmarkId = bm.id || bm['map-bookmark'];
          var requestedViewId = viewId || null;
          var switchToken = ++_viewSwitchRequestToken;
          Promise.resolve(
            window.TnetSetBookmark(
              bookmarkId,
              requestedViewId,
              _buildViewSwitchOptions(bm, requestedViewId)
            )
          ).then(function(result) {
            if (switchToken !== _viewSwitchRequestToken) return result;
            if (!result || result.success !== true) {
              return window.TnetSetBookmark(bookmarkId, requestedViewId, null);
            }
            return result;
          }).catch(function() {
            if (switchToken !== _viewSwitchRequestToken) return;
            try { window.TnetSetBookmark(bookmarkId, requestedViewId, null); }
            catch (eViewFallback) { /* ignore */ }
          });
        }
      });

      // ── Click-Events (Eye, Remove, Remove-All, Gruppen-Aktionen) ──
      _container.addEventListener('click', function (e) {
        if (_dragState) return; // Kein Click während Drag
        var btn = e.target.closest('[data-action]');
        if (!btn) return;
        var action = btn.dataset.action;
        if (action === 'drag') return; // Drag-Handle hat eigene Handler

        // "Alle entfernen" liegt in der Toolbar, nicht in einem Item
        if (action === 'remove-all') {
          // Bookmark komplett aufheben (Tabula rasa)
          window.__tnetActiveBookmark = null;
          window.__tnetPendingBookmarkLoad = null;
          window.__tnetSuppressUrlBookmarkHint = true;
          _bmModified = false;
          _bmLoadedRecently = false;
          _resetPendingUiState();
          _lastRenderHtml = null;
          self.render([]);
          if (window.TnetLMStore && window.TnetLMStore.removeAllLayers) {
            window.TnetLMStore.removeAllLayers();
          }
          return;
        }

        if (action === 'map-switch') {
          if (typeof window.openMapsInfoDialog === 'function') {
            window.openMapsInfoDialog();
          }
          return;
        }

        // Bookmark auf Original zurücksetzen — ueber den Config-basierten View-Switch
        // (TnetResetActiveBookmarkState → _applyViewSwitchOnly). Das baut die DARGESTELLTEN
        // Layer synchron aus der Bookmark-Config neu auf (loadActiveLayersFromBookmark +
        // reconcileMapConsistency): schnell und ohne den Store mit allen Service-Layern
        // aufzublaehen. Danach wird die API-Reihenfolge wiederhergestellt. Fallback:
        // voller API-Reload via TnetSetBookmark.
        if (action === 'bm-reset') {
          var bm = window.__tnetActiveBookmark;
          if (bm && bm.id) {
            _bmModified = false;
            _bmLoadedRecently = true;
            _userReordered = false;
            _resetPendingUiState();
            // Snapshot-Baseline verwerfen: der Config-View-Switch liefert den Originalzustand.
            try { delete bm._resetLayers; delete bm._resetOptions; delete bm._resetFromBookmarkDefault; } catch (eDelSnap) { /* ignore */ }
            _lastRenderHtml = null;
            self._refreshModifiedBadge();

            var store = window.TnetLMStore;
            var resetResult = null;
            if (typeof window.TnetResetActiveBookmarkState === 'function') {
              try { resetResult = window.TnetResetActiveBookmarkState(); }
              catch (eReset) { resetResult = null; }
            }

            if (resetResult && resetResult.success === true) {
              // Reihenfolge wieder nach API-Index herstellen (wie beim initialen Load).
              _applyApiOrderToBookmark();
              _lastRenderHtml = null;
              self.render(store && store.getActiveLayers ? store.getActiveLayers() : []);
            } else if (typeof window.TnetSetBookmark === 'function') {
              // Fallback: voller API-Reload, falls der Config-Reset nicht greift.
              window.TnetSetBookmark(bm.id, bm.activeViewId || null, bm._options || null);
            }

            // URL zuruecksetzen: Bookmark-ID in den Pfad, layers=/op= entfernen.
            _updateBookmarkUrlMode();

            if (_bmLoadTimer) clearTimeout(_bmLoadTimer);
            _bmLoadTimer = setTimeout(function () { _bmLoadedRecently = false; }, 1200);
          }
          return;
        }

        // ── Coalesce-Gruppen-Aktionen ──
        var groupEl = btn.closest('.lm-active-group');

        if (action === 'group-eye' && groupEl) {
          var gid = groupEl.dataset.groupId;
          var storeRef = window.TnetLMStore;
          var coalesceIndex = (storeRef && typeof storeRef.getCoalesceIndex === 'function') ? storeRef.getCoalesceIndex() : null;
          var coalesceInfo = coalesceIndex && coalesceIndex[gid];
          var gChildren = groupEl.querySelectorAll('.lm-active-group-child[data-layer-id]');
          var childState = {};
          var anyChildVisible = false;
          var targetVisible;
          var gcTmp, gcIdTmp, gcEyeTmp, gcOnTmp;

          for (gcTmp = 0; gcTmp < gChildren.length; gcTmp++) {
            gcIdTmp = gChildren[gcTmp].dataset.layerId;
            if (!gcIdTmp) continue;
            gcEyeTmp = gChildren[gcTmp].querySelector('.lm-eye');
            gcOnTmp = gcEyeTmp ? !gcEyeTmp.classList.contains('lm-eye-off') : false;
            childState[gcIdTmp] = gcOnTmp;
            if (gcOnTmp) anyChildVisible = true;
          }

          targetVisible = !anyChildVisible;

          if (coalesceInfo && storeRef && typeof storeRef.toggleCoalesceGroupEye === 'function') {
            // Echter Coalesce-Pfad: genau ein Gruppen-Render statt N Child-Toggles.
            // WICHTIG: Beim Wiedereinschalten (Snapshot-Restore) NICHT alle Kinder
            // pauschal auf pending visible=true setzen, sonst bleiben Augen faelschlich
            // auf EIN, obwohl einzelne Kinder aus dem Snapshot AUS bleiben.
            if (!targetVisible) {
              coalesceInfo.childIds.forEach(function(childId) {
                _writePendingLayerUiState(childId, { visible: false });
              });
            } else {
              coalesceInfo.childIds.forEach(function(childId) {
                _clearPendingLayerUiState(childId, ['visible']);
              });
            }
            storeRef.toggleCoalesceGroupEye(gid);
          } else if (gChildren && gChildren.length) {
            if (anyChildVisible) {
              _groupEyeSnapshot[gid] = childState;
            }
            var snap = _groupEyeSnapshot[gid] || null;
            for (var gci = 0; gci < gChildren.length; gci++) {
              var gcId = gChildren[gci].dataset.layerId;
              if (!gcId) continue;
              var gcTarget = anyChildVisible ? false : (snap ? !!snap[gcId] : true);
              _writePendingLayerUiState(gcId, { visible: gcTarget });
              _scheduleVisibilityUpdate('layer', gcId, gcTarget, false);
            }
          } else {
            // Fallback fuer Coalesce-Gruppen ohne gerenderte Kindliste
            _setPendingGroupVisible(gid, targetVisible);
            _scheduleVisibilityUpdate('group', gid, targetVisible, false);
          }
          // Sofortige DOM-Reaktion: Gruppen-Auge direkt, Kind-Augen nur dort hart
          // setzen, wo der Zielzustand sicher ist (AUS). Beim Coalesce-EIN kommen
          // die echten Child-Zustaende asynchron aus dem Store (Snapshot-Restore).
          btn.innerHTML = targetVisible ? ICON.eyeOn : ICON.eyeOff;
          btn.classList.toggle('lm-eye-off', !targetVisible);
          btn.classList.remove('lm-eye-partial');
          btn.classList.add('lm-eye-loading');
          for (var gci2 = 0; gci2 < gChildren.length; gci2++) {
            var gcId2 = gChildren[gci2].dataset.layerId;
            var pendingVis = _getPendingVisible(gcId2);
            var vis2 = (pendingVis === null) ? targetVisible : !!pendingVis;
            if (coalesceInfo && targetVisible && pendingVis === null) {
              // Beim Snapshot-Restore den bisherigen DOM-Zustand beibehalten,
              // bis die echten layer-visibility Events eintreffen.
              var currentEye = gChildren[gci2].querySelector('.lm-eye');
              vis2 = currentEye ? !currentEye.classList.contains('lm-eye-off') : vis2;
            }
            var gcEye = gChildren[gci2].querySelector('.lm-eye');
            if (gcEye) {
              gcEye.innerHTML = vis2 ? ICON.eyeOn : ICON.eyeOff;
              gcEye.classList.toggle('lm-eye-off', !vis2);
              gcEye.classList.toggle('lm-eye-loading', !!vis2);
            }
          }
          self._refreshGroupEyeBtn(groupEl);
          self._scheduleRender();
          return;
        }
        if (action === 'group-remove' && groupEl) {
          var gid2 = groupEl.dataset.groupId;
          if (removeBookmarkGroupState(gid2)) {
            _bmModified = true;
            emitBookmarkStateChanged('remove-group');
          }
          if (window.TnetLMStore) window.TnetLMStore.removeCoalesceGroup(gid2);
          return;
        }
        if (action === 'group-expand' && groupEl) {
          var gid3 = groupEl.dataset.groupId;
          var isExpanded = !groupEl.classList.contains('lm-collapsed');
          _groupExpanded[gid3] = !isExpanded;
          groupEl.classList.toggle('lm-collapsed', isExpanded);
          var expandBtn = groupEl.querySelector('.lm-btn-expand');
          if (expandBtn) expandBtn.setAttribute('aria-expanded', isExpanded ? 'false' : 'true');
          return;
        }
        if (action === 'group-legend' && groupEl) {
          self._openGroupLegend(groupEl.dataset.groupId);
          return;
        }
        if (action === 'child-eye') {
          var childEl = btn.closest('.lm-active-group-child');
          if (childEl) {
            var childId = childEl.dataset.layerId;
            var currentChildVisible = _getPendingVisible(childId);
            if (currentChildVisible === null) currentChildVisible = !btn.classList.contains('lm-eye-off');
            var newChildVis = !currentChildVisible;
            _writePendingLayerUiState(childId, { visible: newChildVis });
            _scheduleVisibilityUpdate('layer', childId, newChildVis, false);
            // Sofortige DOM-Reaktion: Kind-Auge direkt umschalten (kein Render).
            btn.innerHTML = newChildVis ? ICON.eyeOn : ICON.eyeOff;
            btn.classList.toggle('lm-eye-off', !newChildVis);
            btn.classList.toggle('lm-eye-loading', !!newChildVis);
            // Gruppen-Auge aus aktuellem DOM-Zustand ableiten.
            var parentGrpEl = btn.closest('.lm-active-group');
            if (parentGrpEl) self._refreshGroupEyeBtn(parentGrpEl);
          }
          return;
        }
        if (action === 'child-remove') {
          var childElRemove = btn.closest('.lm-active-group-child');
          if (childElRemove) {
            var childIdRemove = childElRemove.dataset.layerId;
            _clearPendingLayerUiState(childIdRemove);
            delete _pendingVisibilityUpdates[_getPendingVisibilityKey('layer', childIdRemove)];
            delete _pendingOpacityUpdates[_getPendingOpacityKey('layer', childIdRemove)];
            if (removeBookmarkLayerState(childIdRemove)) {
              _bmModified = true;
              emitBookmarkStateChanged('remove-layer');
            }
            if (window.TnetLMStore && typeof window.TnetLMStore.removeLayer === 'function') {
              window.TnetLMStore.removeLayer(childIdRemove);
            }
          }
          return;
        }

        // ── Standalone-Layer-Aktionen ──
        var item = btn.closest('.lm-active-item');
        if (!item) return;
        var layerId = item.dataset.layerId;

        switch (action) {
          case 'eye':
            var currentVisible = _getPendingVisible(layerId);
            if (currentVisible === null) currentVisible = !btn.classList.contains('lm-eye-off');
            var newEyeVis = !currentVisible;
            _writePendingLayerUiState(layerId, { visible: newEyeVis });
            _scheduleVisibilityUpdate('layer', layerId, newEyeVis, false);
            // Sofortige DOM-Reaktion: Auge direkt umschalten (kein Render).
            btn.innerHTML = newEyeVis ? ICON.eyeOn : ICON.eyeOff;
            btn.classList.toggle('lm-eye-off', !newEyeVis);
            btn.classList.toggle('lm-eye-loading', !!newEyeVis);
            break;
          case 'remove':
            _clearPendingLayerUiState(layerId);
            delete _pendingVisibilityUpdates[_getPendingVisibilityKey('layer', layerId)];
            delete _pendingOpacityUpdates[_getPendingOpacityKey('layer', layerId)];
            if (removeBookmarkLayerState(layerId)) {
              _bmModified = true;
              emitBookmarkStateChanged('remove-layer');
            }
            window.TnetLMStore.removeLayer(layerId);
            break;
          case 'legend':
            // Legende öffnen — unterscheide WMS vs. Framework-Layer
            var isWmsLayer = (layerId.indexOf('wms:') === 0);

            if (isWmsLayer) {
              // WMS-Layer: über TnetWmsLegend (legendUrl vom OL-Layer)
              if (window.TnetWmsLegend) {
                var wmsLegendUrl = '';
                var wmsLegendTitle = '';
                try {
                  var store = window.TnetLMStore;
                  var layers = store ? store.getActiveLayers() : [];
                  for (var li = 0; li < layers.length; li++) {
                    if (layers[li].id === layerId && layers[li]._olLayerRef) {
                      wmsLegendUrl = layers[li]._olLayerRef.get('tnet_wms_legendUrl') || '';
                      wmsLegendTitle = layers[li]._olLayerRef.get('title') || layers[li].name || '';
                      break;
                    }
                  }
                } catch(e) { /* Fehler ignorieren */ }
                var wmsName = layerId.substring(4);
                window.TnetWmsLegend(wmsName, wmsLegendTitle, wmsLegendUrl);
              }
            } else {
              // Framework-Layer: legendLink oder legend-proxy URL
              try {
                var fStore = window.TnetLMStore;
                var fLayers = fStore ? fStore.getActiveLayers() : [];
                var fEntry = null;
                for (var fi = 0; fi < fLayers.length; fi++) {
                  if (fLayers[fi].id === layerId) { fEntry = fLayers[fi]; break; }
                }
                if (fEntry) {
                  var fLegendUrl = fEntry.legendLink || '';
                  var fLegendTitle = fEntry.legendTitle || fEntry.name || '';

                  // Kein expliziter legendLink → legend-proxy URL aus agsproxy-URL konstruieren
                  if (!fLegendUrl) {
                    var svcUrl = fEntry.url || '';
                    // Auch OL-Layer Source-URL prüfen (Fallback)
                    if (!svcUrl && fEntry._olLayerRef) {
                      try {
                        var src = fEntry._olLayerRef.getSource();
                        if (src && typeof src.getUrl === 'function') svcUrl = src.getUrl() || '';
                        if (!svcUrl && src && typeof src.getUrls === 'function') {
                          var urls = src.getUrls();
                          if (urls && urls.length) svcUrl = urls[0];
                        }
                      } catch(se) { /* Source-Zugriff fehlgeschlagen */ }
                    }
                    // Pattern 1: agsproxy.php?path=<service-pfad>
                    var proxyIdx = svcUrl.indexOf('agsproxy.php?path=');
                    if (proxyIdx !== -1) {
                      var svcPath = svcUrl.substring(proxyIdx + 18); // nach 'agsproxy.php?path='
                      fLegendUrl = getAppRoot() + '/tnet/api/v1/legend-proxy.php?service=' + encodeURIComponent(svcPath);
                      TnetLog.log(LOG, 'Legend-Proxy URL (agsproxy):', fLegendUrl);
                    }
                    // Pattern 2: Fallback /rest/services/<pfad>
                    if (!fLegendUrl) {
                      var svcIdx = svcUrl.indexOf('/rest/services/');
                      if (svcIdx !== -1) {
                        var svcPath2 = svcUrl.substring(svcIdx + 15);
                        var qIdx = svcPath2.indexOf('?');
                        if (qIdx !== -1) svcPath2 = svcPath2.substring(0, qIdx);
                        fLegendUrl = getAppRoot() + '/tnet/api/v1/legend-proxy.php?service=' + encodeURIComponent(svcPath2);
                        TnetLog.log(LOG, 'Legend-Proxy URL (rest):', fLegendUrl);
                      }
                    }
                  }

                  if (fLegendUrl) {
                    // Metadaten anhängen wenn in Config aktiviert
                    var legendCfg = window.__TNET_LEGEND_CONFIG || {};
                    if (legendCfg.metadata && fLegendUrl.indexOf('legend-proxy') !== -1 && fLegendUrl.indexOf('metadata=') === -1) {
                      fLegendUrl += (fLegendUrl.indexOf('?') !== -1 ? '&' : '?') + 'metadata=1';
                    }

                    var am = window.njs && window.njs.AppManager;
                    if (!am) am = window.top && window.top.njs && window.top.njs.AppManager;
                    if (am && typeof am.showLegend === 'function') {
                      am.showLegend(fLegendUrl, fLegendTitle, true, undefined);
                      TnetLog.log(LOG, 'Framework-Legende geöffnet:', fLegendUrl);
                    } else {
                      window.open(fLegendUrl, '_blank', 'noopener');
                    }
                  } else {
                    TnetLog.warn(LOG, 'Keine Legenden-URL ermittelbar für:', layerId);
                  }
                } else {
                  TnetLog.warn(LOG, 'Kein Store-Eintrag für Layer:', layerId);
                }
              } catch(e) {
                TnetLog.error(LOG, 'Fehler beim Öffnen der Legende:', e);
              }
            }
            break;
        }
      });

      // ── Opacity-Slider (Standalone + Gruppen) ──
      _container.addEventListener('input', function (e) {
        if (e.target.matches('.lm-opacity-slider')) {
          _activeOpacitySlider = e.target;  // Drag aktiv: _onOpacity darf slider.value nicht zurueckschreiben
          var val = parseInt(e.target.value, 10) / 100;
          var valLabel = e.target.closest('.lm-opacity-row');
          if (valLabel) {
            var span = valLabel.querySelector('.lm-opacity-val');
            if (span) span.textContent = Math.round(val * 100) + '%';
          }

          // Gruppen-Opazität: rAF-gedrosselt an Store (emittiert nur coalesce-group-opacity)
          if (e.target.matches('.lm-group-opacity')) {
            var groupEl = e.target.closest('.lm-active-group');
            if (groupEl) {
              var opGid = groupEl.dataset.groupId;
              _setPendingGroupOpacity(opGid, val);
              _queueOpacityApply('group', opGid, val);
            }
            return;
          }

          // Standalone-Opazität: rAF-gedrosselt an Store (emittiert nur layer-opacity)
          var item = e.target.closest('.lm-active-item');
          if (item) {
            _writePendingLayerUiState(item.dataset.layerId, { opacity: val });
            _queueOpacityApply('layer', item.dataset.layerId, val);
          }
        }
      });

      _container.addEventListener('change', function (e) {
        if (!e.target.matches('.lm-opacity-slider')) return;
        _activeOpacitySlider = null;  // Drag beendet
        var val = parseInt(e.target.value, 10) / 100;
        var store = window.TnetLMStore;
        if (e.target.matches('.lm-group-opacity')) {
          var groupEl = e.target.closest('.lm-active-group');
          if (groupEl) {
            _setPendingGroupOpacity(groupEl.dataset.groupId, val);
            _applyGroupOpacity(groupEl.dataset.groupId, val);
          }
          return;
        }
        var item = e.target.closest('.lm-active-item');
        if (item) {
          _writePendingLayerUiState(item.dataset.layerId, { opacity: val });
          if (store && typeof store.setLayerOpacity === 'function') {
            store.setLayerOpacity(item.dataset.layerId, val);
          }
        }
      });

      // ── Drag & Drop (Touch + Mouse) ──
      // Touch
      _container.addEventListener('touchstart', function (e) {
        var handle = e.target.closest('.lm-drag-handle');
        if (!handle) return;
        e.preventDefault(); // Verhindert Scrolling im Sheet
        var touch = e.touches[0];
        self._dragStart(handle, touch.clientY);
      }, { passive: false });

      document.addEventListener('touchmove', function (e) {
        if (!_dragState) return;
        e.preventDefault();
        self._dragMove(e.touches[0].clientY);
      }, { passive: false });

      document.addEventListener('touchend', function () {
        if (_dragState) self._dragEnd();
      });

      document.addEventListener('touchcancel', function () {
        if (_dragState) self._dragCancel();
      });

      // Mouse
      _container.addEventListener('mousedown', function (e) {
        var handle = e.target.closest('.lm-drag-handle');
        if (!handle) return;
        e.preventDefault();
        self._dragStart(handle, e.clientY);
      });

      document.addEventListener('mousemove', function (e) {
        if (!_dragState) return;
        e.preventDefault();
        self._dragMove(e.clientY);
      });

      document.addEventListener('mouseup', function () {
        if (_dragState) self._dragEnd();
      });
    },

    // ============================================================
    // Drag & Drop — Logik
    // ============================================================

    _dragStart: function (handle, clientY) {
      // Sowohl Standalone-Items als auch Gruppen können gezogen werden
      var item = handle.closest('.lm-active-item') || handle.closest('.lm-active-group');
      if (!item) return;
      var listEl = _container.querySelector('.lm-active-list');
      if (!listEl) return;

      var layerId = item.dataset.layerId || item.dataset.groupId || '';
      var isGroup = item.classList.contains('lm-active-group');
      // Alle Top-Level-Einträge (Items + Gruppen) als sortierbare Elemente
      var entries = Array.prototype.slice.call(listEl.querySelectorAll(':scope > .lm-active-item, :scope > .lm-active-group'));
      var startIdx = entries.indexOf(item);
      if (startIdx === -1) return;

      var rect = item.getBoundingClientRect();
      var listRect = listEl.getBoundingClientRect();

      // Clone erstellen (schwebendes Element)
      var clone = item.cloneNode(true);
      clone.classList.add('lm-drag-clone');
      clone.style.width = rect.width + 'px';
      clone.style.left = rect.left + 'px';
      clone.style.top = rect.top + 'px';
      document.body.appendChild(clone);

      // Placeholder erstellen (leere Stelle wo Element war)
      var placeholder = document.createElement('li');
      placeholder.className = 'lm-drag-placeholder';
      placeholder.style.height = rect.height + 'px';
      item.parentNode.insertBefore(placeholder, item);

      // Original ausblenden
      item.classList.add('lm-drag-hidden');

      _dragState = {
        item: item,
        layerId: layerId,
        isGroup: isGroup,
        clone: clone,
        placeholder: placeholder,
        listEl: listEl,
        startY: clientY,
        offsetY: clientY - rect.top,
        startIdx: startIdx,
        currentIdx: startIdx,
        itemHeight: rect.height,
        listTop: listRect.top
      };

      listEl.classList.add('lm-dragging');
    },

    _dragMove: function (clientY) {
      if (!_dragState) return;
      var ds = _dragState;

      // Clone Position aktualisieren
      ds.clone.style.top = (clientY - ds.offsetY) + 'px';

      // Ziel-Index berechnen — alle Top-Level-Einträge (Items + Gruppen)
      var selector = ':scope > .lm-active-item:not(.lm-drag-hidden), :scope > .lm-active-group:not(.lm-drag-hidden)';
      var visibleEntries = Array.prototype.slice.call(ds.listEl.querySelectorAll(selector));
      var newIdx = ds.currentIdx;

      for (var i = 0; i < visibleEntries.length; i++) {
        var r = visibleEntries[i].getBoundingClientRect();
        var midY = r.top + r.height / 2;
        if (clientY < midY) {
          newIdx = i;
          break;
        }
        newIdx = i + 1;
      }

      // Placeholder an gewünschte Position verschieben
      if (newIdx !== ds.currentIdx) {
        ds.placeholder.remove();

        if (newIdx >= visibleEntries.length) {
          ds.listEl.appendChild(ds.placeholder);
        } else {
          ds.listEl.insertBefore(ds.placeholder, visibleEntries[newIdx]);
        }

        ds.currentIdx = newIdx;
      }
    },

    _dragEnd: function () {
      if (!_dragState) return;
      var ds = _dragState;

      // Clone entfernen
      ds.clone.remove();

      // Element an Placeholder-Position verschieben, dann Placeholder entfernen
      ds.placeholder.parentNode.insertBefore(ds.item, ds.placeholder);
      ds.placeholder.remove();

      ds.item.classList.remove('lm-drag-hidden');
      ds.listEl.classList.remove('lm-dragging');

      // Neue Reihenfolge aus DOM lesen und an Store übergeben
      if (ds.startIdx !== ds.currentIdx) {
        // Reset-Snapshot VOR der Reorder-Mutation sichern, damit "Änderungen verwerfen"
        // die urspruengliche Reihenfolge wiederherstellt.
        if (!_bmLoadedRecently && !_isBookmarkLoadActive() && !_isViewSwitchActive()) {
          captureBookmarkResetSnapshot();
        }
        var orderedIds = this._readOrderFromDOM(ds.listEl);
        if (reorderBookmarkLayerState(orderedIds)) {
          // Reorder ist eine Benutzer-Aenderung am Bookmark-Zustand → Dirty markieren
          // (zeigt "Änderungen verwerfen") und API-Reihenfolge nicht mehr ueberschreiben.
          _userReordered = true;
          _bmModified = true;
          emitBookmarkStateChanged('reorder');
        }
        if (orderedIds.length > 0 && window.TnetLMStore && window.TnetLMStore.setActiveLayerOrder) {
          window.TnetLMStore.setActiveLayerOrder(orderedIds);
        }
      }

      _dragState = null;
    },

    _dragCancel: function () {
      if (!_dragState) return;
      var ds = _dragState;
      ds.clone.remove();
      ds.placeholder.remove();
      ds.item.classList.remove('lm-drag-hidden');
      ds.listEl.classList.remove('lm-dragging');
      _dragState = null;
    },

    // ============================================================
    // Inkrementelle DOM-Updates
    // ============================================================

    /**
     * Liest die Layer-Reihenfolge aus der aktuellen DOM-Struktur.
     * Gruppen-Kinder werden inline expandiert.
     * @param {HTMLElement} listEl
     * @returns {string[]}
     */
    _readOrderFromDOM: function (listEl) {
      var orderedIds = [];
      var entries = listEl.querySelectorAll(':scope > .lm-active-item, :scope > .lm-active-group');
      for (var i = 0; i < entries.length; i++) {
        var el = entries[i];
        if (el.classList.contains('lm-active-group')) {
          // Gruppen-Kinder in DOM-Reihenfolge
          var children = el.querySelectorAll('.lm-active-group-child[data-layer-id]');
          for (var c = 0; c < children.length; c++) {
            orderedIds.push(children[c].dataset.layerId);
          }
        } else {
          orderedIds.push(el.dataset.layerId);
        }
      }
      return orderedIds;
    },

    /**
     * Aktualisiert das Gruppen-Auge aus dem aktuellen DOM-Zustand der Kind-Elemente.
     * Kein Store-Zugriff, keine Render-Anforderung — rein chirurgisch.
     * @param {HTMLElement} groupEl
     */
    _refreshGroupEyeBtn: function (groupEl) {
      if (!groupEl) return;
      var childItems = groupEl.querySelectorAll('.lm-active-group-child');
      var anyVis = false, allVis = childItems.length > 0;
      for (var i = 0; i < childItems.length; i++) {
        var cEye = childItems[i].querySelector('.lm-eye');
        var vis = cEye ? !cEye.classList.contains('lm-eye-off') : false;
        if (vis) anyVis = true;
        else allVis = false;
      }
      var gEyeBtn = groupEl.querySelector('[data-action="group-eye"]');
      if (!gEyeBtn) return;
      gEyeBtn.innerHTML = anyVis ? ICON.eyeOn : ICON.eyeOff;
      gEyeBtn.classList.toggle('lm-eye-off', !anyVis);
      gEyeBtn.classList.toggle('lm-eye-partial', anyVis && !allVis);
    },

    /**
     * Öffnet die Legende für eine Coalesce-Gruppe.
     * Konstruiert die legend-proxy URL aus der Dienst-URL.
     * @param {string} groupId
     */
    _openGroupLegend: function (groupId) {
      try {
        var store = window.TnetLMStore;
        if (!store) return;
        // Gruppen-Info holen — serviceUrl + groupName
        var layers = store.getActiveLayers();
        var coalInfo = null;
        for (var i = 0; i < layers.length; i++) {
          coalInfo = store.getCoalesceInfo(layers[i].id);
          if (coalInfo && coalInfo.groupId === groupId) break;
          coalInfo = null;
        }
        if (!coalInfo || !coalInfo.serviceUrl) {
          TnetLog.warn(LOG, 'Keine serviceUrl für Gruppe:', groupId);
          return;
        }

        var svcUrl = coalInfo.serviceUrl;
        var legendUrl = '';

        // agsproxy.php?path=<service-pfad>
        var proxyIdx = svcUrl.indexOf('agsproxy.php?path=');
        if (proxyIdx !== -1) {
          var svcPath = svcUrl.substring(proxyIdx + 18);
          // MapServer und alles danach entfernen
          var msIdx = svcPath.indexOf('/MapServer');
          if (msIdx !== -1) svcPath = svcPath.substring(0, msIdx);
          legendUrl = getAppRoot() + '/tnet/api/v1/legend-proxy.php?service=' + encodeURIComponent(svcPath);
        }
        // Fallback: /rest/services/<pfad>/MapServer
        if (!legendUrl) {
          var restIdx = svcUrl.indexOf('/rest/services/');
          if (restIdx !== -1) {
            var svcPath2 = svcUrl.substring(restIdx + 15);
            var qIdx = svcPath2.indexOf('?');
            if (qIdx !== -1) svcPath2 = svcPath2.substring(0, qIdx);
            var msIdx2 = svcPath2.indexOf('/MapServer');
            if (msIdx2 !== -1) svcPath2 = svcPath2.substring(0, msIdx2);
            legendUrl = getAppRoot() + '/tnet/api/v1/legend-proxy.php?service=' + encodeURIComponent(svcPath2);
          }
        }

        if (!legendUrl) {
          TnetLog.warn(LOG, 'Keine Legenden-URL konstruierbar für:', svcUrl);
          return;
        }

        var legendTitle = coalInfo.groupName || groupId;

        var am = window.njs && window.njs.AppManager;
        if (!am) am = window.top && window.top.njs && window.top.njs.AppManager;
        if (am && typeof am.showLegend === 'function') {
          am.showLegend(legendUrl, legendTitle, true, undefined);
          TnetLog.log(LOG, 'Gruppen-Legende geöffnet:', legendUrl);
        } else {
          window.open(legendUrl, '_blank', 'noopener');
        }
      } catch (e) {
        TnetLog.error(LOG, 'Fehler beim Öffnen der Gruppen-Legende:', e);
      }
    },

    _onVisibility: function (evt) {
      _clearPendingLayerUiState(evt.id, ['visible']);
      delete _pendingVisibilityUpdates[_getPendingVisibilityKey('layer', evt.id)];
      if (!_bmLoadedRecently && !_isBookmarkLoadActive() && !_isViewSwitchActive() && evt.source !== 'bookmark-init') {
        captureBookmarkResetSnapshot();
      }
      var changed = updateBookmarkLayerState(evt.id, { visible: !!evt.visible });
      var isUserEdit = !_bmLoadedRecently && !_isBookmarkLoadActive() && !_isViewSwitchActive() && evt.source !== 'bookmark-init';
      // Neuer Layer aus dem Themenkatalog: nicht im Bookmark (changed=false), aber jetzt
      // sichtbar geschaltet. Als Aenderung markieren, damit shouldIncludeLiveExtrasForBookmark()
      // ihn in den Karteninhalt mischt (sonst erscheint er nicht). Nur bei aktivem Bookmark
      // relevant — ohne Bookmark werden Live-Extras ohnehin immer angezeigt.
      var isNewLiveLayer = isUserEdit && !changed && !!evt.visible && !!getBookmarkInfo();
      if (isNewLiveLayer) {
        // Oben in bookmark.layers einfuegen → erscheint zuoberst und wird Teil des
        // Bookmark-Zustands (Drag&Drop, Reset-Snapshot greifen konsistent).
        var nbm = getBookmarkInfo();
        if (nbm && Array.isArray(nbm.layers) && !nbm.layers.some(function (x) { return x && x.id === evt.id; })) {
          nbm.layers.unshift({ id: evt.id, visible: true, opacity: 1 });
        }
      }
      if ((changed || isNewLiveLayer) && isUserEdit) {
        _bmModified = true;
        emitBookmarkStateChanged('visibility');
      }
      if (!_container || _dragState) return;
      var item = _container.querySelector('[data-layer-id="' + evt.id + '"]');
      if (!item) return;

      var eyeBtn = item.querySelector('.lm-eye');
      if (eyeBtn) {
        eyeBtn.innerHTML = evt.visible ? ICON.eyeOn : ICON.eyeOff;
        eyeBtn.classList.toggle('lm-eye-off', !evt.visible);
        if (!evt.visible) eyeBtn.classList.remove('lm-eye-loading');
      }
    },

    _onOpacity: function (evt) {
      _clearPendingLayerUiState(evt.id, ['opacity']);
      delete _pendingOpacityUpdates[_getPendingOpacityKey('layer', evt.id)];
      if (!_bmLoadedRecently) captureBookmarkResetSnapshot();
      var changed = updateBookmarkLayerState(evt.id, { opacity: evt.opacity });
      if (changed && !_bmLoadedRecently && !_isBookmarkLoadActive() && !_isViewSwitchActive() &&
          !_opacityMatchesBaseline(evt.id, evt.opacity)) {
        _bmModified = true;
        emitBookmarkStateChanged('opacity');
      }
      if (!_container || _dragState) return;
      var item = _container.querySelector('[data-layer-id="' + evt.id + '"]');
      if (!item) return;

      var slider = item.querySelector('.lm-opacity-slider');
      var valLabel = item.querySelector('.lm-opacity-val');
      var pct = Math.round(evt.opacity * 100);
      // Slider waehrend aktivem Drag NICHT zurueckschreiben (unterbricht nativen Drag → haengt).
      if (slider && slider !== _activeOpacitySlider) slider.value = pct;
      if (valLabel) valLabel.textContent = pct + '%';
    },

    _onCoalesceGroupOpacity: function (evt) {
      var store = window.TnetLMStore;
      var index = store && typeof store.getCoalesceIndex === 'function' ? store.getCoalesceIndex() : null;
      var info = index && evt && index[evt.groupId] ? index[evt.groupId] : null;
      var changed = false;
      var i;

      delete _pendingOpacityUpdates[_getPendingOpacityKey('group', evt.groupId)];
      if (!_bmLoadedRecently) captureBookmarkResetSnapshot();
      if (info && info.childIds) {
        for (i = 0; i < info.childIds.length; i++) {
          _clearPendingLayerUiState(info.childIds[i], ['opacity']);
          changed = updateBookmarkLayerState(info.childIds[i], { opacity: evt.opacity }) || changed;
        }
      }

      var grpBaseline = !!(info && info.childIds && info.childIds.length &&
        _opacityMatchesBaseline(info.childIds[0], evt.opacity));
      if (changed && !_bmLoadedRecently && !_isBookmarkLoadActive() && !_isViewSwitchActive() && !grpBaseline) {
        _bmModified = true;
        emitBookmarkStateChanged('opacity');
      }

      // Gruppen-Slider und Label direkt aktualisieren — kein vollstaendiger Re-render waehrend Slider-Drag.
      // Nur bei externem Ausloeser (Gruppe nicht im DOM sichtbar) wird ein Re-render angestossen.
      if (_container && evt && evt.groupId !== undefined) {
        var grpEl = _container.querySelector('.lm-active-group[data-group-id="' + evt.groupId + '"]');
        if (grpEl) {
          var grpPct = Math.round(evt.opacity * 100);
          var grpSlider = grpEl.querySelector('.lm-group-opacity');
          // Slider waehrend aktivem Drag NICHT zurueckschreiben (unterbricht nativen Drag → haengt).
          if (grpSlider && grpSlider !== _activeOpacitySlider) grpSlider.value = grpPct;
          var grpLabel = grpEl.querySelector('.lm-opacity-val');
          if (grpLabel) grpLabel.textContent = grpPct + '%';
        } else {
          // Externe Aenderung (z.B. Bookmark-Load) und Gruppe nicht im DOM
          this._scheduleRender();
        }
      }
    },

    _onLayerLoading: function (evt) {
      if (!_container || !evt || !evt.id) return;
      var state = evt.state || {};
      var isLoading = !!(state.loading || state.loadingSlow);
      var items = _container.querySelectorAll('[data-layer-id="' + evt.id + '"]');
      if (!items || !items.length) return;

      for (var i = 0; i < items.length; i++) {
        var eyeBtn = items[i].querySelector('.lm-eye');
        if (!eyeBtn) continue;
        eyeBtn.classList.toggle('lm-eye-loading', isLoading);
        if (!isLoading && state.loadingError) {
          eyeBtn.classList.remove('lm-eye-loading');
        }
      }

      // Status-Text ("laedt..."/"Fehler") wird beim Rendern aus Layer-State gebaut.
      // Ohne Re-Render kann ein alter Text im DOM stehen bleiben.
      this._scheduleRender();
    }
  };

  // HTML-Escaping
  var _escDiv = null;
  function esc(s) {
    if (!s && s !== 0) return '';
    if (!_escDiv) _escDiv = document.createElement('div');
    _escDiv.textContent = String(s);
    return _escDiv.innerHTML;
  }

  // Oeffentliche API: Pending-Visibility-Queue sofort flushen (Debounce ueberspringen).
  // Wird von tnet-info-bridge.js vor jedem Klick-Dispatch aufgerufen, damit
  // ein UI-Toggle der unmittelbar vor dem Kartenklick ausgefuehrt wurde bereits
  // im Store widergespiegelt ist (isLayerQueryable korrekt).
  LMActive.flushPendingVisibility = function() {
    _flushPendingVisibilityUpdates();
  };

  window.TnetLMActive = LMActive;
})();
