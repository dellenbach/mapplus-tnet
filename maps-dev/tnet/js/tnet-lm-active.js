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

  var LOG = '[LM-Active]';
  var _container = null;
  var _unlisteners = [];

  // ── Drag & Drop State ──
  var _dragState = null; // { item, layerId, placeholder, clone, startY, startIdx, currentIdx, listEl }

  // ── Coalesce-Gruppen Expand-State ──
  var _groupExpanded = {}; // groupId → boolean (default: true = aufgeklappt)

  // ── Bookmark Dirty State ──
  var _bmModified = false;      // true sobald der Nutzer explizit etwas geändert hat
  var _bmLoadedRecently = false; // Schonfrist nach tnet-bookmark-loaded (Store noch nicht synchron)
  var _bmLoadTimer = null;
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

  // SVG-Icons — geladen via TnetIcons (externe .svg Dateien)
  // Werden in _initIcons() befüllt nachdem TnetIcons.loadAll() abgeschlossen ist
  var ICON = {};

  function getBookmarkInfo() {
    var bookmark = window.__tnetActiveBookmark;
    if (!bookmark || !Array.isArray(bookmark.layers)) return null;
    return bookmark;
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

  // Prüft ob sichtbare Layer vom Original-Bookmark (_cfg) abweichen.
  // Opacity wird bewusst ignoriert: in der URL stehen nur sichtbare Layer, und
  // Layer-Deckkraft kann je Layer/Kontext optional definiert oder ueberschrieben sein.
  // _bmModified wird gesetzt via emitBookmarkStateChanged (Remove, Reorder)
  // und via render() (Katalog-Layer-Erkennung aus effectiveLayers).
  function _isActiveBookmarkModified() {
    var bm = window.__tnetActiveBookmark;
    if (!bm || !bm._cfg || !Array.isArray(bm._cfg.layers) || !Array.isArray(bm.layers)) return false;
    var activeView = null;
    var viewStates = null;
    var defaultVisible = [];
    var currentVisible = [];
    var defaultVisibleById = {};
    var currentVisibleById = {};

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
          currentVisible = _getStoreGroupVisible(entry.id, store.getActiveLayers ? store.getActiveLayers() : []);
          if (currentVisible !== null && currentVisible !== entry.visible && typeof store.toggleCoalesceGroupEye === 'function') {
            store.toggleCoalesceGroupEye(entry.id);
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
      if (entry.type === 'group') store.setCoalesceGroupOpacity(entry.id, entry.opacity);
      else store.setLayerOpacity(entry.id, entry.opacity);
    }
    _pendingOpacityUpdates = {};
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
      if (e.type === 'group' && typeof store.setCoalesceGroupOpacity === 'function') {
        store.setCoalesceGroupOpacity(e.id, e.value);
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

  function mergeBookmarkLayers(bookmarkLayers, liveLayers) {
    var liveById = {};
    var usedLiveIds = {};

    (liveLayers || []).forEach(function(layer) {
      if (layer && layer.id) liveById[layer.id] = layer;
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

    // Live-Layer ohne Bookmark-Eintrag anhaengen, damit nach dem Laden eines
    // Bookmarks zusaetzlich aktivierte Themen weiterhin im Karteninhalt erscheinen.
    (liveLayers || []).forEach(function(layer) {
      if (!layer || !layer.id) return;
      if (usedLiveIds[layer.id]) return;
      var copy = {};
      for (var k in layer) {
        if (Object.prototype.hasOwnProperty.call(layer, k)) copy[k] = layer[k];
      }
      if (!copy.name) copy.name = copy.id;
      if (copy.visible === undefined) copy.visible = true;
      if (copy.opacity == null) copy.opacity = 1;
      merged.push(copy);
    });

    return merged;
  }

  function filterRenderableBookmarkLayers(bookmarkLayers) {
    var store = window.TnetLMStore;
    if (!Array.isArray(bookmarkLayers)) return [];
    if (!store || typeof store.isRenderableLayerId !== 'function') return bookmarkLayers.slice();

    return bookmarkLayers.filter(function(layer) {
      return layer && layer.id && store.isRenderableLayerId(layer.id);
    });
  }

  function _initIcons() {
    ICON.eyeOn    = TnetIcons.get('eye-on', 'lm-icon');
    ICON.eyeOff   = TnetIcons.get('eye-off', 'lm-icon');
    ICON.drag     = TnetIcons.get('drag-handle', 'lm-icon lm-icon-drag');
    ICON.remove   = TnetIcons.get('close', 'lm-icon');
    ICON.legend   = TnetIcons.get('legend', 'lm-icon');
    ICON.expand   = TnetIcons.get('chevron-right', 'lm-icon');
    ICON.collapse = TnetIcons.get('chevron-down', 'lm-icon');
    ICON.group    = TnetIcons.get('folder', 'lm-icon');
    ICON.trash    = TnetIcons.get('trash', 'lm-icon');
  }

  function focusActivePanelForBookmark() {
    if (!getBookmarkInfo()) return;

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
      _unlisteners.push(store.on('layer-loading', this._scheduleRender.bind(this)));

      var self = this;
      var rerenderAndFocus = function () {
        // Schonfrist setzen: Store noch nicht synchron nach Bookmark-Load
        _bmModified = false;
        _bmLoadedRecently = true;
        if (_bmLoadTimer) clearTimeout(_bmLoadTimer);
        _bmLoadTimer = setTimeout(function () { _bmLoadedRecently = false; }, 800);
        focusActivePanelForBookmark();
        self.render(store.getActiveLayers());
      };
      var rerender = function () {
        self.render(store.getActiveLayers());
      };
      document.addEventListener('tnet-bookmark-loaded', rerenderAndFocus);
      document.addEventListener('tnet-bookmark-state-changed', rerender);
      _unlisteners.push(function () {
        document.removeEventListener('tnet-bookmark-loaded', rerenderAndFocus);
        document.removeEventListener('tnet-bookmark-state-changed', rerender);
      });

      // Event-Delegation
      this._bindEvents();

      // Initial-State rendern
      var active = store.getActiveLayers();
      this.render(active);
      focusActivePanelForBookmark();
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
      var bookmarkLayers = bookmarkInfo ? filterRenderableBookmarkLayers(bookmarkInfo.layers) : null;
      var effectiveLayers = bookmarkInfo
        ? mergeBookmarkLayers(bookmarkLayers, Array.isArray(layers) ? layers : [])
        : Array.isArray(layers) ? layers.slice() : [];

      _cleanupPendingState(effectiveLayers);
      effectiveLayers = _applyPendingLayerUiState(effectiveLayers);

      // Nicht rendern während Drag aktiv (sonst springt alles)
      if (_dragState) {
        TnetLog.log(LOG, 'render übersprungen (Drag aktiv)');
        return;
      }

      if (!effectiveLayers || !effectiveLayers.length) {
        _container.innerHTML = '<div class="lm-empty">Keine Themen dargestellt.<br><small style="color:#aaa">Themen im Themenkatalog aktivieren.</small></div>';
        _lastRenderHtml = null;  // Leerzustand: naechster nicht-leerer render() muss neu aufbauen
        TnetLog.log(LOG, 'render: Leerzustand');
        return;
      }

      // Einträge gruppieren (Standalone vs. Coalesce-Gruppen)
      var entries = this._buildActiveEntries(effectiveLayers);
      var totalLayers = effectiveLayers.length;

      TnetLog.log(LOG, 'render:', totalLayers, 'Layer,', entries.length, 'Einträge');

      // Bookmark-Name + Views-Dropdown aus globalem State lesen
      var bmName    = bookmarkInfo && (bookmarkInfo.name || bookmarkInfo.id) || null;
      var bmViews   = bookmarkInfo && bookmarkInfo.views || [];
      var bmViewId  = bookmarkInfo && bookmarkInfo.activeViewId || null;

      var bmModified = bmName ? (_isActiveBookmarkModified() || _hasVisibleExtraLayer(effectiveLayers)) : false;
      var html = '<div class="lm-active-header">';
      if (bmName) {
        html += '<div class="lm-active-bookmark-row">';
        html += '<span class="lm-active-bookmark-name" title="Geladenes Bookmark">' + esc(bmName) + '</span>';
        if (bmModified) {
          html += '<span class="lm-bm-modified-badge" title="Bookmark wurde verändert">&#10033;</span>';
          html += '<button class="lm-btn-bm-reset" data-action="bm-reset" title="Bookmark zurücksetzen">&#8635;</button>';
        }
        if (bmViews.length) {
          html += '<select class="lm-active-view-select" data-action="switch-view" title="Kartenansicht wählen">';
          html += '<option value="">(Standard)</option>';
          bmViews.forEach(function(v) {
            var sel = (v.id === bmViewId) ? ' selected' : '';
            html += '<option value="' + esc(v.id) + '"' + sel + '>' + esc(v.name || v.id) + '</option>';
          });
          html += '</select>';
        }
        html += '</div>';
      }
      html += '<div class="lm-active-toolbar">';
      html += '<span class="lm-active-count">' + totalLayers + ' Themen</span>';
      html += '<button class="lm-btn-remove-all" data-action="remove-all" title="Alle Themen entfernen">';
      html += ICON.trash;
      html += ' Alle entfernen</button>';
      html += '</div>';
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
      var row = _container.querySelector('.lm-active-bookmark-row');
      if (!row) return;  // Kein Bookmark-Header sichtbar → nichts zu tun

      var bookmarkInfo = getBookmarkInfo();
      var bmName = bookmarkInfo && (bookmarkInfo.name || bookmarkInfo.id) || null;
      if (!bmName) return;

      var store = window.TnetLMStore;
      var activeLayers = (store && store.getActiveLayers) ? store.getActiveLayers() : [];
      var bookmarkLayers = filterRenderableBookmarkLayers(bookmarkInfo.layers);
      var effectiveLayers = mergeBookmarkLayers(bookmarkLayers, activeLayers);
      effectiveLayers = _applyPendingLayerUiState(effectiveLayers);
      var bmModified = _isActiveBookmarkModified() || _hasVisibleExtraLayer(effectiveLayers);

      var badge = row.querySelector('.lm-bm-modified-badge');
      var resetBtn = row.querySelector('.lm-btn-bm-reset');

      if (bmModified && !badge) {
        var nameEl = row.querySelector('.lm-active-bookmark-name');
        var b = document.createElement('span');
        b.className = 'lm-bm-modified-badge';
        b.title = 'Bookmark wurde verändert';
        b.innerHTML = '&#10033;';
        var r = document.createElement('button');
        r.className = 'lm-btn-bm-reset';
        r.setAttribute('data-action', 'bm-reset');
        r.title = 'Bookmark zurücksetzen';
        r.innerHTML = '&#8635;';
        if (nameEl && nameEl.nextSibling) {
          row.insertBefore(r, nameEl.nextSibling);
          row.insertBefore(b, r);
        } else {
          row.appendChild(b);
          row.appendChild(r);
        }
      } else if (!bmModified && badge) {
        badge.remove();
        if (resetBtn) resetBtn.remove();
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
      var store = window.TnetLMStore;

      for (var i = 0; i < layers.length; i++) {
        var l = layers[i];
        var coalInfo = store ? store.getCoalesceInfo(l.id) : null;

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
        } else {
          entries.push({ type: 'standalone', layer: l });
        }
      }

      return entries;
    },

    /**
     * Rendert einen einzelnen Standalone-Layer (identisch zum bisherigen Verhalten).
     */
    _renderStandalone: function (l) {
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
      var opacity = (l.opacity !== undefined && l.opacity !== null) ? l.opacity : 1;
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

      html += '<button class="lm-btn-remove" data-action="remove" title="Entfernen">' + ICON.remove + '</button>';
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
        totalOpacity += (c.opacity !== undefined && c.opacity !== null) ? c.opacity : 1;
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
      var expandIcon = expanded ? ICON.collapse : ICON.expand;
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
      html += '<div class="lm-active-group-header">';
      html += '<div class="lm-drag-handle" data-action="drag" title="Verschieben">' + ICON.drag + '</div>';
      html += '<button class="' + eyeCls + '" data-action="group-eye" title="Gruppe ein/aus">' + eyeIcon + '</button>';
      html += '<span class="lm-active-group-icon">' + ICON.group + '</span>';
      html += '<span class="lm-active-group-name">' + esc(entry.groupName) + '</span>';
      html += groupStatusHtml;
      // Legende-Button (Dienst-URL vorhanden)
      if (entry.serviceUrl) {
        html += '<button class="lm-btn-legend" data-action="group-legend" title="Legende anzeigen">' + ICON.legend + '</button>';
      }
      html += '<button class="lm-btn-expand" data-action="group-expand" title="Auf-/Zuklappen">' + expandIcon + '</button>';
      html += '<button class="lm-btn-remove" data-action="group-remove" title="Gruppe entfernen">' + ICON.remove + '</button>';
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
        bm.activeViewId = viewId;
        // TnetSetBookmark mit neuer View aufrufen
        if (typeof window.TnetSetBookmark === 'function') {
          window.TnetSetBookmark(bm.id || bm['map-bookmark'], viewId || null);
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
          _bmModified = false;
          _bmLoadedRecently = false;
          _resetPendingUiState();
          if (window.TnetLMStore && window.TnetLMStore.removeAllLayers) {
            window.TnetLMStore.removeAllLayers();
          }
          return;
        }

        // Bookmark auf Original zurücksetzen
        if (action === 'bm-reset') {
          var bm = window.__tnetActiveBookmark;
          if (bm && bm.id && typeof window.TnetSetBookmark === 'function') {
            _bmModified = false;
            _resetPendingUiState();
            window.TnetSetBookmark(bm.id);
          }
          return;
        }

        // ── Coalesce-Gruppen-Aktionen ──
        var groupEl = btn.closest('.lm-active-group');

        if (action === 'group-eye' && groupEl) {
          var gid = groupEl.dataset.groupId;
          var groupVisible = _getPendingGroupVisible(gid);
          if (groupVisible === null) groupVisible = _getStoreGroupVisible(gid, window.TnetLMStore ? window.TnetLMStore.getActiveLayers() : []);
          var targetVisible = !(groupVisible === true);
          _setPendingGroupVisible(gid, targetVisible);
          _scheduleVisibilityUpdate('group', gid, targetVisible, false);
          // Sofortige DOM-Reaktion: Gruppen-Auge + alle Kind-Augen direkt umschalten (kein Render).
          btn.innerHTML = targetVisible ? ICON.eyeOn : ICON.eyeOff;
          btn.classList.toggle('lm-eye-off', !targetVisible);
          btn.classList.remove('lm-eye-partial');
          var gChildren = groupEl.querySelectorAll('.lm-active-group-child');
          for (var gci = 0; gci < gChildren.length; gci++) {
            var gcEye = gChildren[gci].querySelector('.lm-eye');
            if (gcEye) {
              gcEye.innerHTML = targetVisible ? ICON.eyeOn : ICON.eyeOff;
              gcEye.classList.toggle('lm-eye-off', !targetVisible);
            }
          }
          return;
        }
        if (action === 'group-remove' && groupEl) {
          var gid2 = groupEl.dataset.groupId;
          if (removeBookmarkGroupState(gid2)) {
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
          // Icon austauschen
          btn.innerHTML = isExpanded ? ICON.expand : ICON.collapse;
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
            // Gruppen-Auge aus aktuellem DOM-Zustand ableiten.
            var parentGrpEl = btn.closest('.lm-active-group');
            if (parentGrpEl) self._refreshGroupEyeBtn(parentGrpEl);
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
            break;
          case 'remove':
            _clearPendingLayerUiState(layerId);
            delete _pendingVisibilityUpdates[_getPendingVisibilityKey('layer', layerId)];
            delete _pendingOpacityUpdates[_getPendingOpacityKey('layer', layerId)];
            if (removeBookmarkLayerState(layerId)) {
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
            if (store && typeof store.setCoalesceGroupOpacity === 'function') {
              store.setCoalesceGroupOpacity(groupEl.dataset.groupId, val);
            }
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
        var orderedIds = this._readOrderFromDOM(ds.listEl);
        if (reorderBookmarkLayerState(orderedIds)) {
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
      var changed = updateBookmarkLayerState(evt.id, { visible: !!evt.visible });
      if (changed && !_bmLoadedRecently && evt.source !== 'bookmark-init') {
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
      }
    },

    _onOpacity: function (evt) {
      _clearPendingLayerUiState(evt.id, ['opacity']);
      delete _pendingOpacityUpdates[_getPendingOpacityKey('layer', evt.id)];
      var changed = updateBookmarkLayerState(evt.id, { opacity: evt.opacity });
      if (changed && !_bmLoadedRecently) {
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
      if (info && info.childIds) {
        for (i = 0; i < info.childIds.length; i++) {
          _clearPendingLayerUiState(info.childIds[i], ['opacity']);
          changed = updateBookmarkLayerState(info.childIds[i], { opacity: evt.opacity }) || changed;
        }
      }

      if (changed && !_bmLoadedRecently) {
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

  window.TnetLMActive = LMActive;
})();
