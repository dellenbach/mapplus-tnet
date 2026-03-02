/**
 * tnet-lm-store.js — Zentraler Layer-State für den neuen Layer-Manager
 *
 * Lädt den Katalog von der API (/maps/tnet/api/v1/layers.php)
 * und verwaltet Sichtbarkeit, Opazität, Reihenfolge.
 *
 * API-Response-Format:
 *   { version, categories: [{ id, name, icon, subcategories: [{ id, name, groups: [{ id, name, open, layers: [...] }] }] }] }
 *
 * Karten-Steuerung ausschliesslich über TnetLayerSwitch(id, 'on'|'off').
 *
 * @version 1.0
 * @copyright Trigonet AG
 */
(function () {
  'use strict';

  var LOG = '[LM-Store]';

  // ── State ──
  var _catalog = [];           // categories[] aus API
  var _activeLayers = [];      // Aktive Layer-Objekte in Zeichenreihenfolge
  var _listeners = {};         // Event → [callback, ...]
  var _config = {};            // layerManager-Config aus tnet-global-config.json5
  var _loaded = false;
  var _suppressMapSync = false; // Guard gegen Endlosschleifen Store↔Map

  var LMStore = {

    // ============================================================
    // Init
    // ============================================================

    init: function (config) {
      _config = config || {};
      if (_config.debug) console.log(LOG, 'Init mit Config:', _config);
      this._loadCatalog();
    },

    _loadCatalog: function () {
      var self = this;
      var url = _config.apiUrl || '/maps/tnet/api/v1/layers.php';

      fetch(url)
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function (json) {
          // API liefert: { version, categories: [...] }
          // oder { success: true, data: { version, categories: [...] } }
          var data = json.data || json;
          var categories = data.categories || [];

          // API-Format normalisieren:
          //   API liefert: categories[].nodes[] statt .subcategories[]
          //   Subcategories haben .layers (Gruppen) statt .groups
          self._normalizeCategories(categories);
          self._initDefaults(categories);
          _catalog = categories;
          _loaded = true;

          if (_config.debug) console.log(LOG, 'Katalog geladen:', categories.length, 'Kategorien');
          self._emit('catalog-loaded', _catalog);

          // Aktuellen Karten-Zustand in Store übernehmen
          self._syncFromMap();
        })
        .catch(function (err) {
          console.error(LOG, 'API fehlgeschlagen:', err);
        });
    },

    /**
     * Normalisiert die API-Struktur:
     *   - category.nodes → category.subcategories
     *   - subcategory.layers (mit type=group) → subcategory.groups
     */
    _normalizeCategories: function (categories) {
      for (var i = 0; i < categories.length; i++) {
        var cat = categories[i];
        // nodes → subcategories
        if (cat.nodes && !cat.subcategories) {
          cat.subcategories = cat.nodes;
          delete cat.nodes;
        }
        var subs = cat.subcategories || [];
        for (var s = 0; s < subs.length; s++) {
          var sub = subs[s];
          // Subcategory: layers (die eigentlich Gruppen sind) → groups
          if (sub.layers && !sub.groups) {
            sub.groups = sub.layers;
            delete sub.layers;
          }
        }
      }
      if (this._config && this._config.debug) {
        console.log(LOG, 'Normalisiert:', categories.length, 'Kategorien');
      }
    },

    /**
     * Setzt Defaults für alle Knoten im Baum.
     */
    _initDefaults: function (nodes) {
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (n.subcategories) {
          // Kategorie (nidwalden, obwalden, bund, weitere)
          for (var s = 0; s < n.subcategories.length; s++) {
            var sub = n.subcategories[s];
            // Subcategories standardmässig offen (Gruppen sichtbar)
            if (sub.expanded === undefined) sub.expanded = true;
            if (sub.groups) {
              for (var g = 0; g < sub.groups.length; g++) {
                var group = sub.groups[g];
                if (group.expanded === undefined) group.expanded = group.open || false;
                if (group.layers) this._initLayerDefaults(group.layers);
              }
            }
          }
        } else if (n.groups) {
          // Subcategory direkt — standardmässig offen
          if (n.expanded === undefined) n.expanded = true;
          for (var gi = 0; gi < n.groups.length; gi++) {
            var grp = n.groups[gi];
            if (grp.expanded === undefined) grp.expanded = grp.open || false;
            if (grp.layers) this._initLayerDefaults(grp.layers);
          }
        }
      }
    },

    _initLayerDefaults: function (layers) {
      for (var i = 0; i < layers.length; i++) {
        var l = layers[i];
        if (l.type === 'group' && l.layers) {
          // Verschachtelte Gruppe
          if (l.expanded === undefined) l.expanded = l.open || false;
          this._initLayerDefaults(l.layers);
        } else {
          // Blatt-Layer
          if (l.visible === undefined) l.visible = false;
          if (l.opacity === undefined) l.opacity = (l.options && l.options.opacity !== undefined) ? l.options.opacity : 1.0;
        }
      }
    },

    // ============================================================
    // Map-Sync: Aktuellen Kartenzustand in Store übernehmen
    // ============================================================

    _syncFromMap: function () {
      var self = this;
      var am = this._getAppManager();

      if (!am || !am.Maps || !am.Maps['main'] || !am.Maps['main'].mapObj) {
        // Map noch nicht bereit, Retry
        setTimeout(function () { self._syncFromMap(); }, 500);
        return;
      }

      var map = am.Maps['main'].mapObj;
      var olLayers = map.getLayers().getArray();

      for (var i = 0; i < olLayers.length; i++) {
        var olLayer = olLayers[i];
        var lid = olLayer.get('name') || '';
        if (!lid) continue;

        var storeLayer = this.findLayer(lid);
        if (storeLayer && storeLayer.type !== 'group') {
          var isVisible = olLayer.getVisible();
          if (isVisible) {
            storeLayer.visible = true;
            storeLayer.opacity = olLayer.getOpacity();
            storeLayer._olLayerRef = olLayer; // OL-Referenz für direkten Zugriff
            if (!this._isActive(lid)) {
              _activeLayers.push(storeLayer);
            }
          }
        }
      }

      if (_activeLayers.length > 0) {
        this._emit('active-layers-changed', _activeLayers);
      }

      // OL-Events überwachen (bidirektionale Sync)
      this._watchMapChanges(map);

      if (_config.debug) console.log(LOG, 'Sync von Map:', _activeLayers.length, 'aktive Layer');
    },

    _watchMapChanges: function (map) {
      var self = this;
      map.getLayers().on('add', function (evt) {
        if (_suppressMapSync) return;
        self._onOLLayerAdd(evt.element);
      });
      map.getLayers().on('remove', function (evt) {
        if (_suppressMapSync) return;
        self._onOLLayerRemove(evt.element);
      });
    },

    _onOLLayerAdd: function (olLayer) {
      var lid = olLayer.get('name') || '';
      if (!lid) return;

      // WMS Custom-Layer: IMMER den wms:-Pfad nutzen (nie Katalog-Match)
      if (olLayer.get('tnet_wms_custom')) {
        var wmsId = 'wms:' + lid;
        if (!this._isActive(wmsId)) {
          var wmsEntry = {
            id: wmsId,
            name: olLayer.get('title') || lid,
            visible: true,
            opacity: olLayer.getOpacity(),
            type: 'wms',
            _olLayerRef: olLayer
          };
          _activeLayers.push(wmsEntry);
          console.log(LOG, '_onOLLayerAdd WMS:', wmsId, '→ _olLayerRef gesetzt');
          this._emit('layer-visibility', { id: wmsId, visible: true, source: 'map' });
          this._emit('active-layers-changed', _activeLayers);
        }
        return; // Kein Katalog-Match für WMS-Layer
      }

      var storeLayer = this.findLayer(lid);
      if (storeLayer && !storeLayer.visible) {
        storeLayer.visible = true;
        storeLayer.opacity = olLayer.getOpacity();
        storeLayer._olLayerRef = olLayer; // OL-Referenz für direkten Zugriff
        if (!this._isActive(lid)) {
          _activeLayers.push(storeLayer);
        }
        this._emit('layer-visibility', { id: lid, visible: true, source: 'map' });
        this._emit('active-layers-changed', _activeLayers);
      }
    },

    _onOLLayerRemove: function (olLayer) {
      var lid = olLayer.get('name') || '';
      if (!lid) return;

      // WMS Custom-Layer: IMMER den wms:-Pfad nutzen
      if (olLayer.get('tnet_wms_custom')) {
        var wmsId = 'wms:' + lid;
        _activeLayers = _activeLayers.filter(function (l) { return l.id !== wmsId; });
        console.log(LOG, '_onOLLayerRemove WMS:', wmsId);
        // WMS-Panel informieren (Checkbox + interne Liste synchronisieren)
        document.dispatchEvent(new CustomEvent('tnet-wms-layer-removed', { detail: { name: lid } }));
        this._emit('layer-visibility', { id: wmsId, visible: false, source: 'map' });
        this._emit('active-layers-changed', _activeLayers);
        return; // Kein Katalog-Match für WMS-Layer
      }

      var storeLayer = this.findLayer(lid);
      if (storeLayer && storeLayer.visible) {
        storeLayer.visible = false;
        _activeLayers = _activeLayers.filter(function (l) { return l.id !== lid; });
        this._emit('layer-visibility', { id: lid, visible: false, source: 'map' });
        this._emit('active-layers-changed', _activeLayers);
      }
    },

    // ============================================================
    // Öffentliche API
    // ============================================================

    getCatalog: function () { return _catalog; },
    getActiveLayers: function () { return _activeLayers.slice(); },
    isLoaded: function () { return _loaded; },

    /**
     * Layer ein-/ausschalten (Toggle).
     * Nutzt TnetLayerSwitch() als einzige Karten-Schnittstelle.
     */
    toggleLayer: function (layerId) {
      var layer = this.findLayer(layerId);
      if (!layer || layer.type === 'group') {
        console.warn(LOG, 'toggleLayer: Layer nicht gefunden oder ist Gruppe:', layerId);
        return;
      }
      var newVisible = !layer.visible;
      if (_config.debug) console.log(LOG, 'toggleLayer', layerId, '→', newVisible ? 'EIN' : 'AUS');
      this.setLayerVisible(layerId, newVisible);
    },

    /**
     * Layer explizit ein- oder ausschalten.
     */
    setLayerVisible: function (layerId, visible) {
      var layer = this.findLayer(layerId);
      if (!layer || layer.type === 'group') return;
      if (layer.visible === visible) return;

      layer.visible = visible;

      // Karte steuern via TnetLayerSwitch
      _suppressMapSync = true;
      try {
        if (typeof TnetLayerSwitch === 'function') {
          TnetLayerSwitch(layerId, visible ? 'on' : 'off');
          if (_config.debug) console.log(LOG, 'TnetLayerSwitch', layerId, visible ? 'on' : 'off');
        } else {
          console.warn(LOG, 'TnetLayerSwitch nicht verfügbar');
        }
      } catch (e) {
        console.warn(LOG, 'TnetLayerSwitch Fehler:', e);
      }
      // Guard nach kurzem Delay zurücksetzen (async OL-Events)
      setTimeout(function () { _suppressMapSync = false; }, 200);

      // Active-Liste aktualisieren
      if (visible && !this._isActive(layerId)) {
        _activeLayers.push(layer);
      } else if (!visible) {
        _activeLayers = _activeLayers.filter(function (l) { return l.id !== layerId; });
      }

      this._emit('layer-visibility', { id: layerId, visible: visible, source: 'ui' });
      this._emit('active-layers-changed', _activeLayers);
      if (_config.debug) console.log(LOG, 'Active-Layer-Liste:', _activeLayers.length, 'Layer, IDs:', _activeLayers.map(function(l) { return l.id; }));
    },

    /**
     * Sichtbarkeit eines aktiven Layers togglen (Auge an/aus).
     * Layer bleibt in der Liste, wird aber auf der Karte ein-/ausgeblendet.
     * Nutzt setVisible direkt auf dem OL-Layer statt TnetLayerSwitch
     * (weil TnetLayerSwitch bei 'off' den Layer komplett entfernt).
     */
    toggleLayerEye: function (layerId) {
      // Aktiven Eintrag suchen (hat _olLayerRef)
      var activeEntry = this._findActiveLayer(layerId);
      console.log(LOG, 'toggleLayerEye:', layerId, '→ activeEntry:', activeEntry ? 'gefunden' : 'NICHT gefunden',
        activeEntry ? '_olLayerRef:' + !!activeEntry._olLayerRef : '');

      // WMS Custom-Layer: direkte OL-Layer-Referenz nutzen
      if (layerId.indexOf('wms:') === 0) {
        if (activeEntry && activeEntry._olLayerRef) {
          var newVis = !activeEntry._olLayerRef.getVisible();
          _suppressMapSync = true;
          activeEntry._olLayerRef.setVisible(newVis);
          setTimeout(function () { _suppressMapSync = false; }, 200);
          activeEntry.visible = newVis;
          console.log(LOG, 'toggleLayerEye WMS:', layerId, '→ visible:', newVis);
          this._emit('layer-visibility', { id: layerId, visible: newVis, source: 'ui' });
          this._emit('active-layers-changed', _activeLayers);
        }
        return;
      }

      var layer = this.findLayer(layerId);
      if (!layer) return;

      // OL-Layer finden: bevorzugt gespeicherte Referenz, Fallback auf Suche
      var olLayer = (activeEntry && activeEntry._olLayerRef) ? activeEntry._olLayerRef : null;
      if (!olLayer) {
        var am = this._getAppManager();
        if (am && am.Maps && am.Maps['main'] && am.Maps['main'].mapObj) {
          olLayer = this._findOLLayer(am.Maps['main'].mapObj, layerId);
          // Referenz für nächstes Mal speichern
          if (olLayer && activeEntry) activeEntry._olLayerRef = olLayer;
        }
      }

      if (olLayer) {
        var newVisible = !olLayer.getVisible();
        _suppressMapSync = true;
        olLayer.setVisible(newVisible);
        setTimeout(function () { _suppressMapSync = false; }, 200);

        layer.visible = newVisible;
        this._emit('layer-visibility', { id: layerId, visible: newVisible, source: 'ui' });
        this._emit('active-layers-changed', _activeLayers);
      } else {
        console.warn(LOG, 'toggleLayerEye: OL-Layer nicht gefunden für', layerId);
      }
    },

    /**
     * Opazität eines Layers setzen (0.0 – 1.0).
     */
    setLayerOpacity: function (layerId, opacity) {
      var clampedOpacity = Math.max(0, Math.min(1, opacity));

      // WMS Custom-Layer: direkte OL-Layer-Referenz nutzen
      if (layerId.indexOf('wms:') === 0) {
        var wmsEntry = this._findActiveLayer(layerId);
        if (wmsEntry) {
          wmsEntry.opacity = clampedOpacity;
          if (wmsEntry._olLayerRef) {
            wmsEntry._olLayerRef.setOpacity(clampedOpacity);
          }
          this._emit('layer-opacity', { id: layerId, opacity: clampedOpacity });
        }
        return;
      }

      var layer = this.findLayer(layerId);
      if (!layer) return;
      layer.opacity = clampedOpacity;

      var am = this._getAppManager();
      if (!am || !am.Maps || !am.Maps['main'] || !am.Maps['main'].mapObj) return;

      var map = am.Maps['main'].mapObj;
      var olLayer = this._findOLLayer(map, layerId);
      if (olLayer) {
        olLayer.setOpacity(layer.opacity);
      }

      this._emit('layer-opacity', { id: layerId, opacity: layer.opacity });
    },

    /**
     * Layer in der Reihenfolge verschieben.
     */
    moveLayer: function (layerId, direction) {
      var idx = -1;
      for (var i = 0; i < _activeLayers.length; i++) {
        if (_activeLayers[i].id === layerId) { idx = i; break; }
      }
      if (idx === -1) return;

      var newIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= _activeLayers.length) return;

      // Swap
      var temp = _activeLayers[idx];
      _activeLayers[idx] = _activeLayers[newIdx];
      _activeLayers[newIdx] = temp;

      // OL z-Index synchronisieren
      this._syncZIndices();

      this._emit('active-layers-changed', _activeLayers);
    },

    /**
     * Layer an eine bestimmte Position verschieben (für Drag & Drop).
     * @param {string} layerId - ID des zu verschiebenden Layers
     * @param {number} toIndex - Ziel-Index (0-basiert)
     */
    reorderLayer: function (layerId, toIndex) {
      var fromIdx = -1;
      for (var i = 0; i < _activeLayers.length; i++) {
        if (_activeLayers[i].id === layerId) { fromIdx = i; break; }
      }
      if (fromIdx === -1) return;
      if (toIndex < 0) toIndex = 0;
      if (toIndex >= _activeLayers.length) toIndex = _activeLayers.length - 1;
      if (fromIdx === toIndex) return;

      // Element entfernen und an neuer Position einfügen
      var item = _activeLayers.splice(fromIdx, 1)[0];
      _activeLayers.splice(toIndex, 0, item);

      this._syncZIndices();
      this._emit('active-layers-changed', _activeLayers);

      if (_config.debug) console.log(LOG, 'reorderLayer', layerId, fromIdx, '→', toIndex);
    },

    /**
     * Alle aktiven Layer entfernen.
     */
    removeAllLayers: function () {
      var ids = _activeLayers.map(function (l) { return l.id; });
      var self = this;
      // Rückwärts iterieren um Index-Verschiebung zu vermeiden
      ids.forEach(function (id) {
        self.removeLayer(id);
      });
    },

    /**
     * Layer entfernen (aus Karte und Liste).
     */
    removeLayer: function (layerId) {
      console.log(LOG, 'removeLayer:', layerId);
      // WMS Custom-Layer: direkt von Karte entfernen
      if (layerId.indexOf('wms:') === 0) {
        var wmsEntry = this._findActiveLayer(layerId);
        console.log(LOG, 'removeLayer WMS:', layerId, '→ wmsEntry:', wmsEntry ? 'gefunden' : 'NICHT gefunden',
          wmsEntry ? '_olLayerRef:' + !!wmsEntry._olLayerRef : '');
        if (wmsEntry && wmsEntry._olLayerRef) {
          var am = this._getAppManager();
          if (am && am.Maps && am.Maps['main'] && am.Maps['main'].mapObj) {
            _suppressMapSync = true;
            am.Maps['main'].mapObj.removeLayer(wmsEntry._olLayerRef);
            console.log(LOG, 'removeLayer WMS: OL-Layer von Karte entfernt');
            setTimeout(function () { _suppressMapSync = false; }, 200);
          }
        }
        // WMS-Panel IMMER informieren (Checkbox + interne Liste synchronisieren)
        var realName = layerId.replace('wms:', '');
        document.dispatchEvent(new CustomEvent('tnet-wms-layer-removed', { detail: { name: realName } }));
        _activeLayers = _activeLayers.filter(function (l) { return l.id !== layerId; });
        this._emit('active-layers-changed', _activeLayers);
        return;
      }

      var layer = this.findLayer(layerId);
      var activeEntry = this._findActiveLayer(layerId);

      // OL-Layer von der Karte entfernen (via gespeicherte Referenz oder TnetLayerSwitch)
      _suppressMapSync = true;
      try {
        // 1. Versuch: gespeicherte _olLayerRef direkt nutzen
        if (activeEntry && activeEntry._olLayerRef) {
          var am = this._getAppManager();
          if (am && am.Maps && am.Maps['main'] && am.Maps['main'].mapObj) {
            am.Maps['main'].mapObj.removeLayer(activeEntry._olLayerRef);
            console.log(LOG, 'removeLayer via _olLayerRef:', layerId);
          }
        }
        // 2. Versuch: TnetLayerSwitch als Fallback (findet Layer per name-Attribut)
        else if (typeof TnetLayerSwitch === 'function') {
          TnetLayerSwitch(layerId, 'off');
          console.log(LOG, 'removeLayer via TnetLayerSwitch:', layerId);
        }
      } catch (e) {
        console.warn(LOG, 'removeLayer Fehler:', e);
      }
      setTimeout(function () { _suppressMapSync = false; }, 200);

      // Store-State aktualisieren
      if (layer) layer.visible = false;
      _activeLayers = _activeLayers.filter(function (l) { return l.id !== layerId; });
      this._emit('layer-visibility', { id: layerId, visible: false, source: 'ui' });
      this._emit('active-layers-changed', _activeLayers);
    },

    /**
     * Gruppe oder Subcategory auf-/zuklappen.
     */
    toggleGroup: function (groupId) {
      var node = this._findGroupNode(groupId);
      if (node) {
        node.expanded = !node.expanded;
        this._emit('group-toggled', { id: groupId, expanded: node.expanded });
      }
    },

    /**
     * Layer nach Name suchen. Gibt flache Liste zurück.
     */
    searchLayers: function (query) {
      if (!query || query.length < 2) return [];
      var q = query.toLowerCase();
      var results = [];
      this._walkLayers(_catalog, function (layer) {
        if (layer.name && layer.name.toLowerCase().indexOf(q) !== -1) {
          results.push(layer);
        }
      });
      return results;
    },

    /**
     * Layer per ID im Katalog-Baum finden (rekursiv).
     */
    findLayer: function (id) {
      return this._findLayerRecursive(id, _catalog);
    },

    // ============================================================
    // Events
    // ============================================================

    /**
     * Event abonnieren. Gibt Unsubscribe-Funktion zurück.
     * Events: 'catalog-loaded', 'layer-visibility', 'layer-opacity',
     *         'active-layers-changed', 'group-toggled'
     */
    on: function (event, callback) {
      if (!_listeners[event]) _listeners[event] = [];
      _listeners[event].push(callback);
      return function () {
        _listeners[event] = _listeners[event].filter(function (cb) { return cb !== callback; });
      };
    },

    // ============================================================
    // Interne Helfer
    // ============================================================

    _emit: function (event, data) {
      (_listeners[event] || []).forEach(function (cb) {
        try { cb(data); } catch (e) { console.error(LOG, event, e); }
      });
    },

    _getAppManager: function () {
      if (window.njs && window.njs.AppManager) return window.njs.AppManager;
      if (window.top && window.top.njs && window.top.njs.AppManager) return window.top.njs.AppManager;
      return null;
    },

    _findOLLayer: function (map, layerId) {
      // Rekursive Suche: auch in OL Layer-Groups (z.B. MAP+ Service-Container)
      function _searchLayers(collection) {
        var found = null;
        collection.forEach(function (layer) {
          if (found) return;
          if ((layer.get('name') || '') === layerId) {
            found = layer;
          } else if (layer.getLayers) {
            // Layer-Group: rekursiv durchsuchen
            found = _searchLayers(layer.getLayers());
          }
        });
        return found;
      }
      return _searchLayers(map.getLayers());
    },

    _findActiveLayer: function (layerId) {
      for (var i = 0; i < _activeLayers.length; i++) {
        if (_activeLayers[i].id === layerId) return _activeLayers[i];
      }
      return null;
    },

    _isActive: function (layerId) {
      for (var i = 0; i < _activeLayers.length; i++) {
        if (_activeLayers[i].id === layerId) return true;
      }
      return false;
    },

    _syncZIndices: function () {
      var am = this._getAppManager();
      if (!am || !am.Maps || !am.Maps['main'] || !am.Maps['main'].mapObj) return;
      var map = am.Maps['main'].mapObj;

      for (var i = 0; i < _activeLayers.length; i++) {
        var olLayer = this._findOLLayer(map, _activeLayers[i].id);
        if (olLayer) {
          olLayer.setZIndex(100 + i);
        }
      }
    },

    /**
     * Rekursive Layer-Suche über alle Ebenen:
     * categories → subcategories → groups → layers (→ type:"group" → layers)
     */
    _findLayerRecursive: function (id, nodes) {
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (n.id === id) return n;
        // Prüfe alle möglichen Kind-Arrays
        var childArrays = ['subcategories', 'groups', 'layers', 'children'];
        for (var c = 0; c < childArrays.length; c++) {
          var children = n[childArrays[c]];
          if (children && children.length) {
            var found = this._findLayerRecursive(id, children);
            if (found) return found;
          }
        }
      }
      return null;
    },

    /**
     * Findet eine Gruppe/Subcategory per ID (für toggleGroup).
     */
    _findGroupNode: function (id) {
      return this._findGroupRecursive(id, _catalog);
    },

    _findGroupRecursive: function (id, nodes) {
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (n.id === id && (n.subcategories || n.groups || n.layers || n.children)) return n;
        var childArrays = ['subcategories', 'groups', 'layers', 'children'];
        for (var c = 0; c < childArrays.length; c++) {
          var children = n[childArrays[c]];
          if (children && children.length) {
            var found = this._findGroupRecursive(id, children);
            if (found) return found;
          }
        }
      }
      return null;
    },

    /**
     * Iteriert über alle Blatt-Layer im Baum.
     */
    _walkLayers: function (nodes, callback) {
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        var childArrays = ['subcategories', 'groups', 'layers', 'children'];
        var hasChildren = false;
        for (var c = 0; c < childArrays.length; c++) {
          var children = n[childArrays[c]];
          if (children && children.length) {
            hasChildren = true;
            this._walkLayers(children, callback);
          }
        }
        if (!hasChildren && n.type !== 'group') {
          callback(n);
        }
      }
    }
  };

  window.TnetLMStore = LMStore;
})();
