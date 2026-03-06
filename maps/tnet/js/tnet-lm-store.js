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

  // Coalesce: Gruppen-Index (groupNodeId → Info) und Reverse-Lookup (layerId → groupNodeId)
  var _coalesceIndex = {};     // { groupId: { serviceUrl, coalesceGroup, name, childIds: [] } }
  var _layerToCoalesce = {};   // { layerId: groupId }
  var _coalesceOLLayers = {};  // { groupId: { olLayer, activeSublayers: { layerId: sublayerNum } } }

  // Debounce-Timer für Coalesce LAYERS-Param-Updates
  var _coalesceDebounceTimers = {};  // { groupId: timerHandle }

  var LMStore = {

    // ============================================================
    // Init
    // ============================================================

    init: function (config) {
      _config = config || {};
      if (_config.debug) TnetLog.log(LOG, 'Init mit Config:', _config);
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
          self._propagateLegends(categories, null);
          self._initDefaults(categories);
          _catalog = categories;
          _loaded = true;

          // Coalesce-Gruppen aus Katalog indexieren
          self._initCoalesceInfo(categories);

          // Coalesce-Framework-Bridge initialisieren
          if (window.TnetCoalesceBridge) {
            window.TnetCoalesceBridge.init(_config);
          }

          if (_config.debug) TnetLog.log(LOG, 'Katalog geladen:', categories.length, 'Kategorien,', Object.keys(_coalesceIndex).length, 'Coalesce-Gruppen');
          self._emit('catalog-loaded', _catalog);

          // Aktuellen Karten-Zustand in Store übernehmen
          self._syncFromMap();
        })
        .catch(function (err) {
          TnetLog.error(LOG, 'API fehlgeschlagen:', err);
        });
    },

    /**
     * Normalisiert die API-Struktur:
     *   - category.nodes → category.subcategories
     *   - subcategory.layers (mit type=group) → subcategory.groups
     *   - Namen bereinigen (Pfad-basierte Namen, displayName bevorzugen)
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
          // Subcategory-Name bereinigen (Pfade entfernen)
          if (sub.name && sub.name.indexOf('/') !== -1) {
            sub.name = this._cleanPathName(sub.name);
          }
          // Gruppen-Namen bereinigen
          var groups = sub.groups || [];
          for (var g = 0; g < groups.length; g++) {
            var grp = groups[g];
            if (grp.name && grp.name.indexOf('/') !== -1) {
              grp.name = this._cleanPathName(grp.name);
            }
            // Layer-Namen bereinigen (displayName bevorzugen)
            this._cleanLayerNames(grp.layers || []);
          }
        }
      }
      if (this._config && this._config.debug) {
        TnetLog.log(LOG, 'Normalisiert:', categories.length, 'Kategorien');
      }
    },

    /**
     * Extrahiert aus einem Pfad-basierten Namen das letzte Segment
     * und formatiert es lesbar: "Gis Basis/nw Xyz/gemeindegrenzen" → "Gemeindegrenzen"
     */
    _cleanPathName: function (name) {
      var parts = name.split('/');
      var last = parts[parts.length - 1].trim();
      // Unterstriche ersetzen und Wortanfänge gross schreiben
      last = last.replace(/_/g, ' ');
      return last.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    },

    /**
     * Bereinigt Layer-Namen rekursiv: displayName bevorzugen, Pfade auflösen
     */
    _cleanLayerNames: function (layers) {
      if (!layers) return;
      for (var i = 0; i < layers.length; i++) {
        var lyr = layers[i];
        // displayName (aus NLS) bevorzugen
        if (lyr.displayName && lyr.displayName !== lyr.name) {
          lyr.name = lyr.displayName;
        }
        // Pfad-basierte Namen bereinigen
        if (lyr.name && lyr.name.indexOf('/') !== -1) {
          lyr.name = this._cleanPathName(lyr.name);
        }
        // Verschachtelte Gruppen rekursiv
        if (lyr.layers) {
          this._cleanLayerNames(lyr.layers);
        }
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
          // Blatt-Layer: visible immer false setzen
          // (tatsächlicher Kartenzustand wird via _syncFromMap übernommen)
          l.visible = false;
          if (l.opacity === undefined) l.opacity = (l.options && l.options.opacity !== undefined) ? l.options.opacity : 1.0;
        }
      }
    },

    /**
     * Vererbt den legend-Key von Gruppen an Blatt-Layer.
     * Wird nach _normalizeCategories aufgerufen.
     * Durchläuft den gesamten Baum rekursiv.
     *
     * @param {Array} nodes       Aktueller Knoten-Array (Kategorien/Gruppen/Layer)
     * @param {string|null} parentLegend  Legende des nächsten Eltern-Knotens
     */
    _propagateLegends: function (nodes, parentLegend) {
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        // Eigene Legende hat Vorrang, sonst vom Eltern-Knoten erben
        var effectiveLegend = n.legend || parentLegend;
        if (!n.legend && effectiveLegend) {
          n.legend = effectiveLegend;
        }
        // Rekursiv in alle Kind-Arrays absteigen
        var childArrays = ['subcategories', 'groups', 'layers', 'children'];
        for (var c = 0; c < childArrays.length; c++) {
          var children = n[childArrays[c]];
          if (children && children.length) {
            this._propagateLegends(children, effectiveLegend);
          }
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

      // Coalesce-Gruppen-Namen aus Dojo-LyrMgr nachladen (LyrMgr ist jetzt initialisiert)
      this._enrichCoalesceNamesFromDojo();

      // OL-Events überwachen (bidirektionale Sync)
      this._watchMapChanges(map);

      if (_config.debug) TnetLog.log(LOG, 'Sync von Map:', _activeLayers.length, 'aktive Layer');
    },

    _watchMapChanges: function (map) {
      var self = this;
      map.getLayers().on('add', function (evt) {
        var olLayer = evt.element;
        var lid = olLayer.get('name') || '';

        // ── Ghost-Schutz: Bridge-managed Sublayer deferred entfernen ──
        // Framework erstellt individuelle OL-Layer per switchLayersProgr.
        // Wenn die Bridge den Sublayer bereits über den Root-Dienst steuert,
        // darf dieser individuelle Layer nicht existieren (= Doppel-Layer).
        // WICHTIG: map.removeLayer() NICHT synchron im add-Handler aufrufen!
        // Das korrumpiert OpenLayers' interne Collection → bricht ALLE Layer.
        // Stattdessen: sofort unsichtbar machen + deferred entfernen.
        if (lid && window.TnetCoalesceBridge && window.TnetCoalesceBridge.isEnabled &&
            window.TnetCoalesceBridge.isEnabled() &&
            window.TnetCoalesceBridge.isManagedSublayer &&
            window.TnetCoalesceBridge.isManagedSublayer(lid)) {
          olLayer.setVisible(false);
          (function (layerToRemove) {
            setTimeout(function () {
              try {
                _suppressMapSync = true;
                map.removeLayer(layerToRemove);
              } catch (e) { /* bereits entfernt */ }
              finally { _suppressMapSync = false; }
            }, 50);
          })(olLayer);
          TnetLog.log(LOG, 'Ghost-Schutz: Bridge-Sublayer deferred entfernt:', lid);
          return;
        }

        // _olLayerRef IMMER setzen — auch bei Unterdrückung!
        // Nur State-Changes/Events werden unterdrückt, nicht die Referenz.
        if (lid) {
          var storeLayer = self.findLayer(lid);
          if (storeLayer && storeLayer.type !== 'group') {
            storeLayer._olLayerRef = olLayer;
          }
          // Auch aktive Einträge aktualisieren (können gleiche Referenz sein)
          var activeEntry = self._findActiveLayer(lid);
          if (activeEntry) {
            activeEntry._olLayerRef = olLayer;
          }
          // WMS Custom-Layer: _olLayerRef im WMS-Eintrag setzen
          if (olLayer.get('tnet_wms_custom')) {
            var wmsEntry = self._findActiveLayer('wms:' + lid);
            if (wmsEntry) wmsEntry._olLayerRef = olLayer;
          }
        }
        if (_suppressMapSync) return;
        self._onOLLayerAdd(olLayer);
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
          TnetLog.log(LOG, '_onOLLayerAdd WMS:', wmsId, '→ _olLayerRef gesetzt');
          this._emit('layer-visibility', { id: wmsId, visible: true, source: 'map' });
          this._emit('active-layers-changed', _activeLayers);
        }
        return; // Kein Katalog-Match für WMS-Layer
      }

      var storeLayer = this.findLayer(lid);
      if (storeLayer && storeLayer.type !== 'group') {
        // IMMER _olLayerRef setzen — unabhängig vom visible-Status
        storeLayer._olLayerRef = olLayer;
        storeLayer.opacity = olLayer.getOpacity();

        if (!storeLayer.visible) {
          storeLayer.visible = true;
          if (!this._isActive(lid)) {
            _activeLayers.push(storeLayer);
          }
          this._emit('layer-visibility', { id: lid, visible: true, source: 'map' });
          this._emit('active-layers-changed', _activeLayers);
        } else {
          // Layer war schon visible (via toggleLayer), aber _olLayerRef fehlte
          var activeEntry = this._findActiveLayer(lid);
          if (activeEntry && activeEntry !== storeLayer) {
            activeEntry._olLayerRef = olLayer;
          }
        }
      }
    },

    _onOLLayerRemove: function (olLayer) {
      var lid = olLayer.get('name') || '';
      if (!lid) return;

      // WMS Custom-Layer: IMMER den wms:-Pfad nutzen
      if (olLayer.get('tnet_wms_custom')) {
        var wmsId = 'wms:' + lid;
        _activeLayers = _activeLayers.filter(function (l) { return l.id !== wmsId; });
        TnetLog.log(LOG, '_onOLLayerRemove WMS:', wmsId);
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
     * Liefert den Coalesce-Index (groupId → Info) — für Active-Panel-Gruppierung.
     */
    getCoalesceIndex: function () { return _coalesceIndex; },

    /**
     * Liefert Coalesce-Gruppen-Info für einen Layer (oder null).
     * @param {string} layerId
     * @returns {{ groupId: string, groupName: string, serviceUrl: string, coalesceGroup: string, childIds: string[] }|null}
     */
    getCoalesceInfo: function (layerId) {
      var groupId = _layerToCoalesce[layerId];
      if (!groupId) return null;
      var info = _coalesceIndex[groupId];
      if (!info) return null;
      return {
        groupId: groupId,
        groupName: info.name,
        serviceUrl: info.serviceUrl,
        coalesceGroup: info.coalesceGroup,
        childIds: info.childIds.slice()
      };
    },

    /**
     * Findet den Katalog-Pfad (Breadcrumb-Labels) für einen Layer oder Dienst.
     * Verwendet den TNET-Katalog als autoritative Quelle (statt Dojo-LyrMgr).
     * Unterstützt exakte ID und Prefix-Match (Root-Service → Sublayer).
     *
     * @param {string} layerIdOrPrefix  Layer-ID oder Root-Service-Key
     * @returns {string[]|null}  Pfad-Labels (Kategorie → Subcategory → Gruppe), oder null
     */
    getLayerCatalogPath: function (layerIdOrPrefix) {
      if (!layerIdOrPrefix || !_loaded || !_catalog.length) return null;
      return this._findCatalogPath(layerIdOrPrefix, _catalog, []);
    },

    /**
     * Rekursiver Helfer: durchsucht den Katalog-Baum und gibt den Pfad zum
     * passenden Knoten zurück (exakt oder Prefix-Match).
     * Container-Knoten (mit Kindern) fügen ihren Namen zum Pfad hinzu.
     * @private
     */
    _findCatalogPath: function (query, nodes, currentPath) {
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        var nodePath = currentPath.slice();

        // Hat dieser Knoten Kinder?
        var childKeys = ['subcategories', 'groups', 'layers', 'children'];
        var hasChildren = false;
        for (var c = 0; c < childKeys.length; c++) {
          if (n[childKeys[c]] && n[childKeys[c]].length) { hasChildren = true; break; }
        }

        // Container-Knoten: Name zum Pfad hinzufügen
        if (hasChildren && n.name) {
          nodePath.push(n.name);
        }

        // Kinder rekursiv durchsuchen (tiefere Treffer bevorzugen)
        for (var c2 = 0; c2 < childKeys.length; c2++) {
          var children = n[childKeys[c2]];
          if (children && children.length) {
            var found = this._findCatalogPath(query, children, nodePath);
            if (found) return found;
          }
        }

        // Kein Kind hat getroffen → diesen Knoten prüfen
        if (n.id) {
          if (!hasChildren) {
            // Blatt-Treffer: exakt oder Layer ist Sublayer des Queries
            if (n.id === query || n.id.indexOf(query + '/') === 0) {
              return nodePath;
            }
          } else {
            // Container-Treffer: exakt oder Query ist Sublayer dieses Containers
            if (n.id === query || query.indexOf(n.id + '/') === 0) {
              return nodePath;
            }
          }
        }
      }
      return null;
    },

    /**
     * Opazität aller Layer in einer Coalesce-Gruppe setzen.
     * Setzt Opazität direkt auf dem gemeinsamen OL-Layer.
     * @param {string} groupId  ID des Gruppen-Knotens
     * @param {number} opacity  Opazität (0.0–1.0)
     */
    setCoalesceGroupOpacity: function (groupId, opacity) {
      var info = _coalesceIndex[groupId];
      if (!info) return;
      var clamped = Math.max(0, Math.min(1, opacity));
      // Gemeinsamen OL-Layer updaten (Coalesce-Modus)
      var cEntry = _coalesceOLLayers[groupId];
      if (cEntry && cEntry.olLayer) {
        cEntry.olLayer.setOpacity(clamped);
      } else {
        // Legacy-Fallback: einzelne OL-Layer pro Kind-Layer (useNewTree=false)
        var am = this._getAppManager();
        var map = am && am.Maps && am.Maps['main'] && am.Maps['main'].mapObj;
        for (var fi = 0; fi < info.childIds.length; fi++) {
          var fid = info.childIds[fi];
          var fae = this._findActiveLayer(fid);
          var fol = (fae && fae._olLayerRef) || (map ? this._findOLLayer(map, fid) : null);
          if (fol) fol.setOpacity(clamped);
        }
      }
      // Store-Einträge synchronisieren
      for (var i = 0; i < info.childIds.length; i++) {
        var layer = this.findLayer(info.childIds[i]);
        if (layer) layer.opacity = clamped;
        var ae = this._findActiveLayer(info.childIds[i]);
        if (ae) ae.opacity = clamped;
      }
      this._emit('coalesce-group-opacity', { groupId: groupId, opacity: clamped });
      TnetLog.log(LOG, 'setCoalesceGroupOpacity', groupId, '→', clamped);
    },

    /**
     * Sichtbarkeit aller Layer in einer Coalesce-Gruppe togglen.
     * Togglet direkt den gemeinsamen OL-Layer (ein Request für alle Sublayer).
     * @param {string} groupId  ID des Gruppen-Knotens
     */
    toggleCoalesceGroupEye: function (groupId) {
      var info = _coalesceIndex[groupId];
      if (!info) return;
      var cEntry = _coalesceOLLayers[groupId];

      if (cEntry && cEntry.olLayer) {
        // Coalesce-Modus: ein gemeinsamer OL-Layer
        var newVisible = !cEntry.olLayer.getVisible();
        _suppressMapSync = true;
        cEntry.olLayer.setVisible(newVisible);
        setTimeout(function () { _suppressMapSync = false; }, 200);
        for (var j = 0; j < info.childIds.length; j++) {
          var childId = info.childIds[j];
          var layer = this.findLayer(childId);
          if (layer) layer.visible = newVisible;
          var ae = this._findActiveLayer(childId);
          if (ae) ae.visible = newVisible;
        }
        this._emit('active-layers-changed', _activeLayers);
        TnetLog.log(LOG, 'toggleCoalesceGroupEye (coalesce)', groupId, '→', newVisible);
      } else {
        // Legacy-Fallback: einzelne OL-Layer pro Kind-Layer (useNewTree=false)
        var am = this._getAppManager();
        var map = am && am.Maps && am.Maps['main'] && am.Maps['main'].mapObj;
        // Sichtbarkeitszustand aus erstem aktiven Kind-Layer ableiten
        var firstVisible = false;
        for (var k = 0; k < info.childIds.length; k++) {
          var kid = info.childIds[k];
          var kae = this._findActiveLayer(kid);
          if (kae) { firstVisible = (kae.visible !== false); break; }
        }
        var newVis = !firstVisible;
        _suppressMapSync = true;
        for (var m = 0; m < info.childIds.length; m++) {
          var mid = info.childIds[m];
          var mae = this._findActiveLayer(mid);
          var mol = (mae && mae._olLayerRef) || (map ? this._findOLLayer(map, mid) : null);
          if (mol) mol.setVisible(newVis);
          var ml = this.findLayer(mid);
          if (ml) ml.visible = newVis;
          if (mae) mae.visible = newVis;
        }
        setTimeout(function () { _suppressMapSync = false; }, 200);
        this._emit('active-layers-changed', _activeLayers);
        TnetLog.log(LOG, 'toggleCoalesceGroupEye (legacy)', groupId, '→', newVis);
      }
    },

    /**
     * Entfernt alle Layer einer Coalesce-Gruppe.
     * Entfernt den gemeinsamen OL-Layer und alle Store-Einträge.
     * @param {string} groupId  ID des Gruppen-Knotens
     */
    removeCoalesceGroup: function (groupId) {
      var info = _coalesceIndex[groupId];
      if (!info) return;
      // Gemeinsamen OL-Layer von der Karte entfernen
      this._removeCoalesceOLLayer(groupId);
      // Alle Kind-Layer aus Active-Liste entfernen
      for (var i = 0; i < info.childIds.length; i++) {
        var childId = info.childIds[i];
        var layer = this.findLayer(childId);
        if (layer) layer.visible = false;
        _activeLayers = _activeLayers.filter(function (l) { return l.id !== childId; });
        this._emit('layer-visibility', { id: childId, visible: false, source: 'ui' });
      }
      this._emit('active-layers-changed', _activeLayers);
    },

    /**
     * Layer ein-/ausschalten (Toggle).
     * Nutzt TnetLayerSwitch() als einzige Karten-Schnittstelle.
     */
    toggleLayer: function (layerId) {
      var layer = this.findLayer(layerId);
      if (!layer || layer.type === 'group') {
        TnetLog.warn(LOG, 'toggleLayer: Layer nicht gefunden oder ist Gruppe:', layerId);
        return;
      }
      var newVisible = !layer.visible;
      if (_config.debug) TnetLog.log(LOG, 'toggleLayer', layerId, '→', newVisible ? 'EIN' : 'AUS');
      this.setLayerVisible(layerId, newVisible);
    },

    /**
     * Layer explizit ein- oder ausschalten.
     * Coalesce-Layer werden NICHT über TnetLayerSwitch (Dojo-LyrMgr) geschaltet,
     * sondern über einen gemeinsamen OL-Layer pro MapServer-Dienst.
     */
    setLayerVisible: function (layerId, visible) {
      var layer = this.findLayer(layerId);
      if (!layer || layer.type === 'group') return;
      if (layer.visible === visible) return;

      layer.visible = visible;

      // ── Coalesce-Pfad: gemeinsamer OL-Layer pro Dienst ──
      var coalGroupId = _layerToCoalesce[layerId];
      if (coalGroupId) {
        _suppressMapSync = true;
        if (visible) {
          this._addToCoalesceOLLayer(coalGroupId, layerId, layer);
        } else {
          this._removeFromCoalesceOLLayer(coalGroupId, layerId);
        }
        setTimeout(function () { _suppressMapSync = false; }, 200);

        // Active-Liste aktualisieren
        if (visible && !this._isActive(layerId)) {
          _activeLayers.push(layer);
        } else if (!visible) {
          _activeLayers = _activeLayers.filter(function (l) { return l.id !== layerId; });
        }

        this._emit('layer-visibility', { id: layerId, visible: visible, source: 'ui' });
        this._emit('active-layers-changed', _activeLayers);
        if (_config.debug) TnetLog.log(LOG, 'Coalesce setLayerVisible', layerId, visible ? 'EIN' : 'AUS', '(Gruppe:', coalGroupId, ')');
        return;
      }

      // ── Standard-Pfad: einzelner OL-Layer via Dojo-LyrMgr ──
      _suppressMapSync = true;
      try {
        if (typeof TnetLayerSwitch === 'function') {
          TnetLayerSwitch(layerId, visible ? 'on' : 'off');
          if (_config.debug) TnetLog.log(LOG, 'TnetLayerSwitch', layerId, visible ? 'on' : 'off');
        } else {
          TnetLog.warn(LOG, 'TnetLayerSwitch nicht verfügbar');
        }
      } catch (e) {
        TnetLog.warn(LOG, 'TnetLayerSwitch Fehler:', e);
      }
      // MapTips synchronisieren — einheitlicher Mechanismus für alle Layer-Typen
      // Zwei Zeitpunkte: 500ms (schnelle Layer) + 1500ms (langsame switchLayersProgr)
      if (typeof TnetScheduleSyncMapTips === 'function') {
        TnetScheduleSyncMapTips(500);
        setTimeout(function () {
          if (typeof TnetSyncMapTips === 'function') TnetSyncMapTips();
        }, 1500);
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
      if (_config.debug) TnetLog.log(LOG, 'Active-Layer-Liste:', _activeLayers.length, 'Layer, IDs:', _activeLayers.map(function(l) { return l.id; }));
    },

    /**
     * Sichtbarkeit eines aktiven Layers togglen (Auge an/aus).
     * Layer bleibt in der Liste, wird aber auf der Karte ein-/ausgeblendet.
     * 
     * Coalesce-Layer: Sublayer wird aus dem LAYERS-Param entfernt/hinzugefügt,
     * statt den ganzen OL-Layer unsichtbar zu machen.
     */
    toggleLayerEye: function (layerId) {
      // Aktiven Eintrag suchen (hat _olLayerRef)
      var activeEntry = this._findActiveLayer(layerId);
      TnetLog.log(LOG, 'toggleLayerEye:', layerId, '→ activeEntry:', activeEntry ? 'gefunden' : 'NICHT gefunden',
        activeEntry ? '_olLayerRef:' + !!activeEntry._olLayerRef : '');

      // WMS Custom-Layer: direkte OL-Layer-Referenz nutzen
      if (layerId.indexOf('wms:') === 0) {
        if (activeEntry && activeEntry._olLayerRef) {
          var newVis = !activeEntry._olLayerRef.getVisible();
          _suppressMapSync = true;
          activeEntry._olLayerRef.setVisible(newVis);
          setTimeout(function () { _suppressMapSync = false; }, 200);
          activeEntry.visible = newVis;
          TnetLog.log(LOG, 'toggleLayerEye WMS:', layerId, '→ visible:', newVis);
          this._emit('layer-visibility', { id: layerId, visible: newVis, source: 'ui' });
          this._emit('active-layers-changed', _activeLayers);
        }
        return;
      }

      // ── Coalesce-Pfad: Sublayer aus LAYERS-Param entfernen/hinzufügen ──
      var coalGroupId = _layerToCoalesce[layerId];
      if (coalGroupId) {
        var layer = this.findLayer(layerId);
        var cEntry = _coalesceOLLayers[coalGroupId];
        if (!layer) return;
        // Fallback für Framework-OL-Layer (beim Startup individuell erstellt, kein Coalesce-OL-Layer)
        if (!cEntry) {
          if (activeEntry && activeEntry._olLayerRef) {
            var newVis = !activeEntry._olLayerRef.getVisible();
            _suppressMapSync = true;
            activeEntry._olLayerRef.setVisible(newVis);
            setTimeout(function () { _suppressMapSync = false; }, 200);
            layer.visible = newVis;
            if (activeEntry) activeEntry.visible = newVis;
            this._emit('layer-visibility', { id: layerId, visible: newVis, source: 'ui' });
            this._emit('active-layers-changed', _activeLayers);
            TnetLog.log(LOG, 'toggleLayerEye Fallback (Framework-OL-Layer):', layerId, '→', newVis);
          }
          return;
        }
        if (!cEntry.bridgeManaged && !cEntry.olLayer) return;
        var currentlyVisible = (activeEntry && activeEntry.visible !== false);
        var newVisible = !currentlyVisible;
        _suppressMapSync = true;
        if (cEntry.bridgeManaged) {
          // ── Bridge v2: über Root-Dienst steuern ──
          if (newVisible) {
            var subNum = this._extractSublayerNum(layer);
            if (subNum !== null) {
              cEntry.activeSublayers[layerId] = subNum;
              window.TnetCoalesceBridge.showSublayer(layerId, subNum);
            }
          } else {
            delete cEntry.activeSublayers[layerId];
            window.TnetCoalesceBridge.hideSublayer(layerId);
          }
        } else {
          // ── Eigener OL-Layer: direkt LAYERS-Param updaten ──
          if (newVisible) {
            var subNum = this._extractSublayerNum(layer);
            if (subNum !== null) {
              cEntry.activeSublayers[layerId] = subNum;
              this._updateCoalesceLAYERSParam(coalGroupId);
            }
          } else {
            delete cEntry.activeSublayers[layerId];
            this._updateCoalesceLAYERSParam(coalGroupId);
          }
        }
        setTimeout(function () { _suppressMapSync = false; }, 200);
        layer.visible = newVisible;
        if (activeEntry) activeEntry.visible = newVisible;
        this._emit('layer-visibility', { id: layerId, visible: newVisible, source: 'ui' });
        this._emit('active-layers-changed', _activeLayers);
        TnetLog.log(LOG, 'toggleLayerEye Coalesce:', layerId, '→', newVisible);
        return;
      }

      // ── Standard-Pfad ──
      var layer = this.findLayer(layerId);
      if (!layer && !activeEntry) return;

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

      var currentlyVisible;
      if (activeEntry && activeEntry.visible !== undefined) {
        currentlyVisible = !!activeEntry.visible;
      } else if (layer && layer.visible !== undefined) {
        currentlyVisible = !!layer.visible;
      } else if (olLayer) {
        currentlyVisible = !!olLayer.getVisible();
      } else {
        currentlyVisible = false;
      }
      var newVisible = !currentlyVisible;

      if (olLayer) {
        _suppressMapSync = true;
        olLayer.setVisible(newVisible);
        setTimeout(function () { _suppressMapSync = false; }, 200);

        if (layer) layer.visible = newVisible;
        if (activeEntry) activeEntry.visible = newVisible;
        this._emit('layer-visibility', { id: layerId, visible: newVisible, source: 'ui' });
        this._emit('active-layers-changed', _activeLayers);
      } else {
        // Fallback: Framework-Switch verwenden (synchronisiert Legacy-Checkboxen)
        if (typeof TnetLayerSwitch === 'function') {
          _suppressMapSync = true;
          try {
            TnetLayerSwitch(layerId, newVisible ? 'on' : 'off');
          } catch (e) {
            TnetLog.warn(LOG, 'toggleLayerEye Fallback via TnetLayerSwitch fehlgeschlagen:', e);
          }
          setTimeout(function () { _suppressMapSync = false; }, 200);

          if (layer) layer.visible = newVisible;
          if (activeEntry) activeEntry.visible = newVisible;
          this._emit('layer-visibility', { id: layerId, visible: newVisible, source: 'ui' });
          this._emit('active-layers-changed', _activeLayers);
        } else {
          TnetLog.warn(LOG, 'toggleLayerEye: OL-Layer nicht gefunden und TnetLayerSwitch fehlt für', layerId);
        }
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
      var activeEntry = this._findActiveLayer(layerId);
      if (!layer && !activeEntry) return;
      if (layer) layer.opacity = clampedOpacity;
      if (activeEntry) activeEntry.opacity = clampedOpacity;

      var am = this._getAppManager();
      var olLayer = (activeEntry && activeEntry._olLayerRef) ? activeEntry._olLayerRef : null;
      if (!olLayer && am && am.Maps && am.Maps['main'] && am.Maps['main'].mapObj) {
        var map = am.Maps['main'].mapObj;
        olLayer = this._findOLLayer(map, layerId);
        if (olLayer && activeEntry) activeEntry._olLayerRef = olLayer;
      }

      if (olLayer) {
        olLayer.setOpacity(clampedOpacity);
      }

      this._emit('layer-opacity', { id: layerId, opacity: clampedOpacity });
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

      if (_config.debug) TnetLog.log(LOG, 'reorderLayer', layerId, fromIdx, '→', toIndex);
    },

    /**
     * Setzt die Reihenfolge der aktiven Layer anhand einer geordneten ID-Liste.
     * Wird vom Drag & Drop im Active-Panel verwendet.
     * @param {string[]} orderedIds - Layer-IDs in gewünschter Reihenfolge
     */
    setActiveLayerOrder: function (orderedIds) {
      if (!orderedIds || !orderedIds.length) return;
      var map = {};
      for (var i = 0; i < _activeLayers.length; i++) {
        map[_activeLayers[i].id] = _activeLayers[i];
      }
      var newOrder = [];
      for (var j = 0; j < orderedIds.length; j++) {
        if (map[orderedIds[j]]) {
          newOrder.push(map[orderedIds[j]]);
          delete map[orderedIds[j]];
        }
      }
      // Nicht genannte Layer am Ende anhängen (Sicherheit)
      for (var k in map) {
        if (map.hasOwnProperty(k)) newOrder.push(map[k]);
      }
      _activeLayers = newOrder;
      this._syncZIndices();
      this._emit('active-layers-changed', _activeLayers);
      if (_config.debug) TnetLog.log(LOG, 'setActiveLayerOrder:', orderedIds.length, 'Layer neu sortiert');
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
      TnetLog.log(LOG, 'removeLayer:', layerId);
      // WMS Custom-Layer: direkt von Karte entfernen
      if (layerId.indexOf('wms:') === 0) {
        var wmsEntry = this._findActiveLayer(layerId);
        TnetLog.log(LOG, 'removeLayer WMS:', layerId, '→ wmsEntry:', wmsEntry ? 'gefunden' : 'NICHT gefunden',
          wmsEntry ? '_olLayerRef:' + !!wmsEntry._olLayerRef : '');
        if (wmsEntry && wmsEntry._olLayerRef) {
          var am = this._getAppManager();
          if (am && am.Maps && am.Maps['main'] && am.Maps['main'].mapObj) {
            _suppressMapSync = true;
            am.Maps['main'].mapObj.removeLayer(wmsEntry._olLayerRef);
            TnetLog.log(LOG, 'removeLayer WMS: OL-Layer von Karte entfernt');
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

      // ── Coalesce-Pfad: Sublayer aus dem gemeinsamen OL-Layer entfernen ──
      var coalGroupId = _layerToCoalesce[layerId];
      if (coalGroupId) {
        _suppressMapSync = true;
        this._removeFromCoalesceOLLayer(coalGroupId, layerId);
        setTimeout(function () { _suppressMapSync = false; }, 200);
        if (layer) layer.visible = false;
        _activeLayers = _activeLayers.filter(function (l) { return l.id !== layerId; });
        this._emit('layer-visibility', { id: layerId, visible: false, source: 'ui' });
        this._emit('active-layers-changed', _activeLayers);
        TnetLog.log(LOG, 'removeLayer Coalesce:', layerId, '(Gruppe:', coalGroupId, ')');
        return;
      }

      // ── Standard-Pfad: OL-Layer via Dojo-LyrMgr entfernen ──
      _suppressMapSync = true;
      try {
        // 1. Framework-Toggle (benachrichtigt Dojo-LayerManager → Checkboxen werden entfernt)
        if (typeof TnetLayerSwitch === 'function') {
          TnetLayerSwitch(layerId, 'off');
          TnetLog.log(LOG, 'removeLayer via TnetLayerSwitch:', layerId);
        }
        // 2. Zusätzlich: gespeicherte _olLayerRef als Sicherheitsnetz
        //    (falls TnetLayerSwitch den Layer nicht gefunden hat)
        if (activeEntry && activeEntry._olLayerRef) {
          var am = this._getAppManager();
          if (am && am.Maps && am.Maps['main'] && am.Maps['main'].mapObj) {
            try {
              am.Maps['main'].mapObj.removeLayer(activeEntry._olLayerRef);
              TnetLog.log(LOG, 'removeLayer Sicherheitsnetz _olLayerRef:', layerId);
            } catch (e2) { /* Layer war bereits entfernt durch TnetLayerSwitch */ }
          }
        }
      } catch (e) {
        TnetLog.warn(LOG, 'removeLayer Fehler:', e);
      }
      setTimeout(function () { _suppressMapSync = false; }, 200);

      // Store-State aktualisieren
      if (layer) layer.visible = false;
      // WMS/BGI-Panel synchronisieren: Layer über technische ID entmarkieren
      document.dispatchEvent(new CustomEvent('tnet-wms-layer-removed', { detail: { name: layerId } }));
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

    /**
     * Prüft ob ein Layer ein Coalesce-Sublayer ist (Teil einer Coalesce-Gruppe).
     * Wird z.B. vom TnetLayerSwitch-Patch in der Bridge verwendet.
     * @param {string} layerId
     * @returns {boolean}
     */
    isCoalesceSublayer: function (layerId) {
      return !!_layerToCoalesce[layerId];
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
        try { cb(data); } catch (e) { TnetLog.error(LOG, event, e); }
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
      var result = _searchLayers(map.getLayers());

      // ── Bridge-Fallback: Coalesce-Sublayer → Root-OL-Layer ──
      if (!result && window.TnetCoalesceBridge && window.TnetCoalesceBridge.isManagedSublayer(layerId)) {
        result = window.TnetCoalesceBridge.getOLLayerForSublayer(layerId);
      }
      return result;
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
     *
     * WICHTIG: Blatt-Layer werden gegenüber Gruppen-Knoten mit gleicher ID bevorzugt.
     * In der lyrmgr.conf haben Gruppen-Wrapper häufig dieselbe ID wie ihr einziges
     * Kind-Layer (z.B. "gis_basis/…/gemeindegrenzen" als Gruppe UND als Layer).
     * Ohne diese Leaf-Präferenz würde toggleLayer den Gruppen-Knoten finden,
     * ihn wegen type==='group' überspringen und NICHTS auf der Karte ändern.
     */
    _findLayerRecursive: function (id, nodes) {
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        // Bei exaktem ID-Match UND Blatt-Knoten (kein group/subcategory): sofort zurückgeben
        if (n.id === id && n.type !== 'group' && n.type !== 'subcategory') return n;
        // Kinder durchsuchen (findet tieferliegende Blatt-Matches vor dem Gruppen-Knoten)
        var childArrays = ['subcategories', 'groups', 'layers', 'children'];
        for (var c = 0; c < childArrays.length; c++) {
          var children = n[childArrays[c]];
          if (children && children.length) {
            var found = this._findLayerRecursive(id, children);
            if (found) return found;
          }
        }
        // Fallback: Gruppen-/Subcategory-Knoten mit passendem ID zurückgeben
        // (z.B. für toggleGroup-Aufrufe wo der Gruppen-Knoten gewünscht ist)
        if (n.id === id) return n;
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
     * Baut den Coalesce-Index auf: scannt den Katalog nach Gruppen
     * mit serviceUrl/coalesceGroup und indexiert deren Kind-Layer.
     */
    _initCoalesceInfo: function (categories) {
      _coalesceIndex = {};
      _layerToCoalesce = {};
      this._scanCoalesceNodes(categories);
      if (_config.debug && Object.keys(_coalesceIndex).length > 0) {
        TnetLog.log(LOG, 'Coalesce-Index:', JSON.stringify(_coalesceIndex));
      }
    },

    /**
     * Rekursive Suche nach Coalesce-Gruppen im Baum.
     */
    _scanCoalesceNodes: function (nodes) {
      if (!nodes) return;
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        // Coalesce-Gruppe erkennen: serviceUrl + coalesceGroup vorhanden
        if (n.serviceUrl && n.coalesceGroup) {
          var childIds = this._collectChildLayerIds(n);
          if (childIds.length >= 2) {
            // Dienst-Pfad aus serviceUrl extrahieren (z.B. "gis_oereb/nw_nutzungsplanung_def")
            var servicePath = this._extractServicePath(n.serviceUrl);
            // Katalog-Name hat Vorrang — servicePath nur als Fallback
            // Generische DB-Namen ("Virtueller Layer", "Virtual Layer") überspringen
            var catalogName = n.displayName || n.name || '';
            var isGenericName = !catalogName ||
              catalogName.toLowerCase() === 'virtueller layer' ||
              catalogName.toLowerCase() === 'virtual layer';
            _coalesceIndex[n.id] = {
              serviceUrl: n.serviceUrl,
              coalesceGroup: n.coalesceGroup,
              name: isGenericName ? (servicePath || n.id) : catalogName,
              childIds: childIds
            };
            for (var c = 0; c < childIds.length; c++) {
              _layerToCoalesce[childIds[c]] = n.id;
            }
          }
        }
        // Rekursiv in Kind-Arrays absteigen
        var childArrays = ['subcategories', 'groups', 'layers', 'children'];
        for (var a = 0; a < childArrays.length; a++) {
          if (n[childArrays[a]] && n[childArrays[a]].length) {
            this._scanCoalesceNodes(n[childArrays[a]]);
          }
        }
      }
    },

    /**
     * Überschreibt Coalesce-Gruppen-Namen mit lesbaren Bezeichnungen aus dem Dojo-LyrMgr.
     * Liest ClassicLayerCategory.description (= aus lyrmgrResources, via desc_<id>).
     * Wird nach _syncFromMap aufgerufen — zu diesem Zeitpunkt ist der LyrMgr initialisiert.
     *
     * Problem: Dojo-Kategorie-IDs (z.B. "rp_def_np_fl_nutzungszonen") stimmen nicht
     * mit Coalesce-Gruppen-IDs (z.B. "gis_oereb/nw_nutzungsplanung_def") überein.
     * Lösung: Über Kind-Layer-Namen matchen — Dojo-Kategorie die Layer enthält
     * deren name zu einer Coalesce-Gruppe gehört → deren description verwenden.
     */
    _enrichCoalesceNamesFromDojo: function () {
      var am = (window.njs && window.njs.AppManager) ||
               (window.top && window.top.njs && window.top.njs.AppManager);
      if (!am || !am.LyrMgr) return;

      // 1. Schnelles reverse-Lookup bauen: layerName → coalesceGroupId
      var layerToGroup = {};
      for (var gid in _coalesceIndex) {
        if (!_coalesceIndex.hasOwnProperty(gid)) continue;
        var cids = _coalesceIndex[gid].childIds;
        for (var c = 0; c < cids.length; c++) {
          layerToGroup[cids[c]] = gid;
        }
      }

      // 2. Dojo-LyrMgr rekursiv traversieren: Kategorien mit Kind-Layern → Description sammeln
      //    groupId → best description (von der innersten Kategorie die Kind-Layer enthält)
      var groupDesc = {};
      function traverseCategory(cat) {
        // Blatt-Layer dieser Kategorie prüfen
        var layers = cat.arLayers || [];
        for (var li = 0; li < layers.length; li++) {
          var lyr = layers[li];
          var matchedGroupId = layerToGroup[lyr.name];
          if (matchedGroupId && cat.description) {
            // Innerste Kategorie mit description gewinnt
            groupDesc[matchedGroupId] = cat.description;
          }
        }
        // Rekursiv in Kind-Kategorien
        var children = cat.arCategories || [];
        for (var ci = 0; ci < children.length; ci++) {
          traverseCategory(children[ci]);
        }
      }

      // Alle LyrMgr-Instanzen durchlaufen (nw, ow, bund, etc.)
      for (var mgrId in am.LyrMgr) {
        if (!am.LyrMgr.hasOwnProperty(mgrId)) continue;
        var mgr = am.LyrMgr[mgrId];
        if (!mgr || !mgr.arCategories) continue;
        for (var i = 0; i < mgr.arCategories.length; i++) {
          traverseCategory(mgr.arCategories[i]);
        }
      }

      // 3. Coalesce-Index aktualisieren
      var enriched = 0;
      for (var groupId in groupDesc) {
        if (!groupDesc.hasOwnProperty(groupId)) continue;
        if (_coalesceIndex[groupId]) {
          _coalesceIndex[groupId].name = groupDesc[groupId];
          enriched++;
        }
      }

      if (_config.debug) TnetLog.log(LOG, '_enrichCoalesceNamesFromDojo:', enriched, 'Gruppen-Namen aus Dojo übernommen');
    },

    /**
     * Sammelt rekursiv alle Blatt-Layer-IDs eines Knotens.
     */
    _collectChildLayerIds: function (node) {
      var ids = [];
      var childArrays = ['groups', 'layers', 'children'];
      for (var a = 0; a < childArrays.length; a++) {
        var children = node[childArrays[a]];
        if (!children) continue;
        for (var i = 0; i < children.length; i++) {
          var child = children[i];
          if (child.type === 'layer' || (!child.layers && !child.groups && !child.children)) {
            ids.push(child.id);
          } else {
            ids = ids.concat(this._collectChildLayerIds(child));
          }
        }
      }
      return ids;
    },

    /**
     * Extrahiert den Dienst-Pfad aus einer serviceUrl.
     * Beispiele:
     *   "agsproxy.php?path=gis_oereb/nw_nutzungsplanung_def/MapServer"
     *     → "gis_oereb/nw_nutzungsplanung_def"
     *   "/maps/agsproxy.php?path=gis_fach/nw_wanderwege/MapServer"
     *     → "gis_fach/nw_wanderwege"
     *   "https://host/arcgis/rest/services/gis_oereb/nw_nutzungsplanung_def/MapServer"
     *     → "gis_oereb/nw_nutzungsplanung_def"
     * @param {string} url  serviceUrl aus dem Katalog
     * @returns {string|null}  Dienst-Pfad oder null
     */
    _extractServicePath: function (url) {
      if (!url) return null;

      // Variante 1: agsproxy.php?path=<service>/MapServer
      var proxyMatch = url.match(/[?&]path=([^&]+)\/MapServer/i);
      if (proxyMatch) {
        return proxyMatch[1];
      }

      // Variante 2: .../rest/services/<path>/MapServer (ArcGIS REST URL)
      var restMatch = url.match(/\/rest\/services\/(.+?)\/MapServer/i);
      if (restMatch) {
        return restMatch[1];
      }

      // Variante 3: Kein erkanntes Format → null
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
    },

    // ============================================================
    // Coalesce OL-Layer-Verwaltung
    // Ein gemeinsamer OL-Layer pro MapServer-Dienst. Sublayer werden
    // über den LAYERS-Parameter (show:0,3,5) kombiniert → ein Request.
    // ============================================================

    /**
     * Extrahiert die Sublayer-Nummer aus einem Layer-Objekt.
     * Liest params.LAYERS ("show:3") und gibt die Nummer zurück.
     * @param {Object} layer  Store-Layer-Objekt (hat .params.LAYERS)
     * @returns {number|null}
     */
    _extractSublayerNum: function (layer) {
      if (!layer || !layer.params) return null;
      var layersParam = layer.params.LAYERS || layer.params.layers || '';
      // Format: "show:3" oder "show:0,3,5"
      var match = layersParam.match(/show:(\d+)/);
      return match ? parseInt(match[1], 10) : null;
    },

    /**
     * Fügt einen Sublayer zum gemeinsamen Coalesce-OL-Layer hinzu.
     * Erstellt den OL-Layer beim ersten Sublayer, updatet LAYERS-Param bei weiteren.
     * @param {string} groupId  Coalesce-Gruppen-ID
     * @param {string} layerId  Blatt-Layer-ID
     * @param {Object} layer    Store-Layer-Objekt
     */
    _addToCoalesceOLLayer: function (groupId, layerId, layer) {
      var info = _coalesceIndex[groupId];
      if (!info) return;
      var subNum = this._extractSublayerNum(layer);
      if (subNum === null) {
        TnetLog.warn(LOG, 'Coalesce: Sublayer-Nummer nicht extrahierbar für', layerId, layer.params);
        return;
      }

      // ── Bridge v2: Root-Dienst-Strategie mit Fallback ──
      var _bridgeAvailable = window.TnetCoalesceBridge && window.TnetCoalesceBridge.canHandle(layerId);
      var _bridgeActivated = false;

      if (_bridgeAvailable) {
        _bridgeActivated = window.TnetCoalesceBridge.registerSublayer(layerId, subNum);
        if (_bridgeActivated) {
          if (!_coalesceOLLayers[groupId]) {
            _coalesceOLLayers[groupId] = {
              olLayer: null,
              activeSublayers: {},
              bridgeManaged: true
            };
          }
          _coalesceOLLayers[groupId].activeSublayers[layerId] = subNum;
          TnetLog.log(LOG, 'Coalesce Bridge: Root-Dienst aktiv, Sublayer registriert:', layerId, '→ #' + subNum, '(Gruppe:', groupId, ')');
          return;
        }
        TnetLog.log(LOG, 'Coalesce Bridge: Root-Dienst nicht verfügbar, Fallback Standard-Coalesce:', layerId);
      }

      var cEntry = _coalesceOLLayers[groupId];
      if (!cEntry) {
        // ── Ersten OL-Layer für diese Gruppe erstellen ──
        var am = this._getAppManager();
        if (!am || !am.Maps || !am.Maps['main'] || !am.Maps['main'].mapObj) {
          TnetLog.warn(LOG, 'Coalesce: Map nicht bereit für', groupId);
          return;
        }
        var map = am.Maps['main'].mapObj;
        var serviceUrl = info.serviceUrl;
        // Proxy-Prefix sicherstellen
        if (serviceUrl.indexOf('/maps/') !== 0 && serviceUrl.indexOf('http') !== 0) {
          serviceUrl = '/maps/' + serviceUrl;
        }

        var activeSublayers = {};
        activeSublayers[layerId] = subNum;
        var layersVal = 'show:' + subNum;

        // Projection und DPI aus Layer-Params/Options übernehmen
        var arcParams = { LAYERS: layersVal, FORMAT: 'PNG32', TRANSPARENT: true };
        if (layer.params && layer.params.DPI) arcParams.DPI = layer.params.DPI;

        // singleTile prüfen (aus options)
        var useSingleTile = (layer.options && layer.options.singleTile !== false) || true;
        var olLayer;
        if (useSingleTile && ol.source.ImageArcGISRest) {
          var source = new ol.source.ImageArcGISRest({
            url: serviceUrl,
            params: arcParams,
            ratio: 1
          });
          olLayer = new ol.layer.Image({
            source: source,
            opacity: layer.opacity || 1.0,
            visible: true,
            zIndex: 200
          });
        } else {
          var source = new ol.source.TileArcGISRest({
            url: serviceUrl,
            params: arcParams
          });
          olLayer = new ol.layer.Tile({
            source: source,
            opacity: layer.opacity || 1.0,
            visible: true,
            zIndex: 200
          });
        }

        // OL-Layer-Name: Dienst-Pfad (z.B. "gis_oereb/nw_nutzungsplanung_def")
        // Wird vom Framework für Maptip-Lookup und Darstellungs-Anzeige verwendet
        var layerDisplayName = info.name || groupId;
        olLayer.set('name', layerDisplayName);
        olLayer.set('tnet_coalesce_group', groupId);

        map.addLayer(olLayer);

        _coalesceOLLayers[groupId] = {
          olLayer: olLayer,
          activeSublayers: activeSublayers
        };

        TnetLog.log(LOG, 'Coalesce OL-Layer erstellt für', groupId,
          '→ URL:', serviceUrl, 'LAYERS:', layersVal);

        // MapTip-Patch: Bridge registriert lookupCallbacks für MapTip
        if (_bridgeAvailable && olLayer) {
          window.TnetCoalesceBridge.patchMaptipForCoalesceLayer(layerId, olLayer, subNum);
        }

        // URL-Sync: Standard-Coalesce-Pfad muss URL manuell aktualisieren
        if (window.TnetCoalesceBridge && typeof window.TnetCoalesceBridge.scheduleUrlSync === 'function') {
          window.TnetCoalesceBridge.scheduleUrlSync();
        }

      } else {
        // ── Bestehenden OL-Layer updaten: Sublayer hinzufügen ──
        cEntry.activeSublayers[layerId] = subNum;
        this._updateCoalesceLAYERSParamDebounced(groupId);
        // Sicherstellen dass der OL-Layer sichtbar ist
        if (!cEntry.olLayer.getVisible()) {
          cEntry.olLayer.setVisible(true);
        }

        TnetLog.log(LOG, 'Coalesce Sublayer hinzugefügt:', layerId, '→', subNum,
          '(Gruppe:', groupId, ')');

        // MapTip-Patch: auch für nachträgliche Sublayer registrieren
        if (_bridgeAvailable && cEntry.olLayer) {
          window.TnetCoalesceBridge.patchMaptipForCoalesceLayer(layerId, cEntry.olLayer, subNum);
        }

        // URL-Sync: auch bei Sublayer-Update
        if (window.TnetCoalesceBridge && typeof window.TnetCoalesceBridge.scheduleUrlSync === 'function') {
          window.TnetCoalesceBridge.scheduleUrlSync();
        }
      }
    },

    /**
     * Entfernt einen Sublayer aus dem gemeinsamen Coalesce-OL-Layer.
     * Löscht den OL-Layer wenn keine Sublayer mehr aktiv.
     * @param {string} groupId  Coalesce-Gruppen-ID
     * @param {string} layerId  Blatt-Layer-ID
     */
    _removeFromCoalesceOLLayer: function (groupId, layerId) {
      var cEntry = _coalesceOLLayers[groupId];
      if (!cEntry) {
        // ── Kein Coalesce-OL-Layer vorhanden ──
        // Framework hat beim Startup eigene individuelle OL-Layer erstellt
        // (via ClassicLayerMgr.switchLayersProgr → lay.switchLayer(true)).
        // Diese existieren einzeln auf der Map mit name = sublayerKey.
        // Ohne diesen Fallback bleiben sie als Ghost-Layer sichtbar.
        try {
          if (typeof TnetLayerSwitch === 'function') {
            TnetLayerSwitch(layerId, 'off');
          }
        } catch (e) { /* Layer war bereits entfernt */ }
        TnetLog.log(LOG, 'Coalesce Fallback: Framework-OL-Layer via TnetLayerSwitch entfernt:', layerId);
        return;
      }

      // ── Bridge v2: über Root-Dienst steuern ──
      if (cEntry.bridgeManaged) {
        window.TnetCoalesceBridge.unregisterSublayer(layerId);
        delete cEntry.activeSublayers[layerId];
        var bridgeRemaining = Object.keys(cEntry.activeSublayers).length;
        if (bridgeRemaining === 0) {
          if (_coalesceDebounceTimers[groupId]) {
            clearTimeout(_coalesceDebounceTimers[groupId]);
            delete _coalesceDebounceTimers[groupId];
          }
          delete _coalesceOLLayers[groupId];
        }
        TnetLog.log(LOG, 'Coalesce Bridge: Sublayer entfernt:', layerId,
          '(Gruppe:', groupId, ', verbleibend:', bridgeRemaining, ')');
        return;
      }

      // MapTip-Callbacks aufräumen (für Standard-Coalesce mit Bridge-Patch)
      if (window.TnetCoalesceBridge && window.TnetCoalesceBridge.isEnabled()) {
        window.TnetCoalesceBridge.unpatchMaptipForCoalesceLayer(layerId);
      }

      delete cEntry.activeSublayers[layerId];
      var remaining = Object.keys(cEntry.activeSublayers);

      if (remaining.length === 0) {
        // Letzter Sublayer → OL-Layer komplett entfernen
        this._removeCoalesceOLLayer(groupId);
      } else {
        // LAYERS-Param updaten (ohne den entfernten Sublayer)
        this._updateCoalesceLAYERSParamDebounced(groupId);
      }
      TnetLog.log(LOG, 'Coalesce Sublayer entfernt:', layerId,
        '(Gruppe:', groupId, ', verbleibend:', remaining.length, ')');
    },

    /**
     * Entfernt den gesamten Coalesce-OL-Layer von der Karte.
     * @param {string} groupId  Coalesce-Gruppen-ID
     */
    _removeCoalesceOLLayer: function (groupId) {
      var cEntry = _coalesceOLLayers[groupId];
      if (!cEntry) return;

      // ── Bridge v2: Root-Dienst deaktivieren ──
      if (cEntry.bridgeManaged) {
        var firstKey = Object.keys(cEntry.activeSublayers)[0];
        var rootKey = firstKey ? window.TnetCoalesceBridge.getRootKey(firstKey) : null;
        if (rootKey) {
          window.TnetCoalesceBridge.unregisterGroup(rootKey, cEntry.activeSublayers);
        }
        if (_coalesceDebounceTimers[groupId]) {
          clearTimeout(_coalesceDebounceTimers[groupId]);
          delete _coalesceDebounceTimers[groupId];
        }
        delete _coalesceOLLayers[groupId];
        TnetLog.log(LOG, 'Coalesce Bridge: Gruppe entfernt:', groupId);
        return;
      }

      if (!cEntry.olLayer) return;

      // Debounce-Timer aufräumen
      if (_coalesceDebounceTimers[groupId]) {
        clearTimeout(_coalesceDebounceTimers[groupId]);
        delete _coalesceDebounceTimers[groupId];
      }

      var am = this._getAppManager();
      if (am && am.Maps && am.Maps['main'] && am.Maps['main'].mapObj) {
        try {
          am.Maps['main'].mapObj.removeLayer(cEntry.olLayer);
        } catch (e) { /* Layer war bereits entfernt */ }
      }

      delete _coalesceOLLayers[groupId];
      TnetLog.log(LOG, 'Coalesce OL-Layer entfernt:', groupId);
    },

    /**
     * Aktualisiert den LAYERS-Parameter auf dem gemeinsamen OL-Layer.
     * Baut "show:0,3,5" aus den aktiven Sublayern.
     * @param {string} groupId  Coalesce-Gruppen-ID
     */
    _updateCoalesceLAYERSParam: function (groupId) {
      var cEntry = _coalesceOLLayers[groupId];
      if (!cEntry || !cEntry.olLayer) return;

      // Reihenfolge per default aus Layer-ID ableiten (Katalog-Reihenfolge via childIds)
      var info = _coalesceIndex[groupId];
      var childIds = info ? info.childIds : [];

      var pairs = [];
      for (var lid in cEntry.activeSublayers) {
        if (cEntry.activeSublayers.hasOwnProperty(lid)) {
          var subNum = cEntry.activeSublayers[lid];
          var order = childIds.indexOf(lid);
          if (order === -1) order = subNum; // Fallback: numerisch
          pairs.push({ num: subNum, order: order });
        }
      }
      pairs.sort(function (a, b) { return a.order - b.order; });
      var nums = pairs.map(function (p) { return p.num; });
      var layersVal = 'show:' + nums.join(',');

      // OL source.updateParams() → löst automatisch neuen Request aus
      var src = cEntry.olLayer.getSource();
      if (src && typeof src.updateParams === 'function') {
        src.updateParams({ LAYERS: layersVal });
      } else if (src && typeof src.setUrl === 'function') {
        // Fallback für Sources ohne updateParams
        var currentUrl = src.getUrl();
        src.setUrl(currentUrl); // Force refresh
      }

      TnetLog.log(LOG, 'Coalesce LAYERS-Param aktualisiert:', groupId, '→', layersVal);
    },

    /**
     * Debounced-Variante von _updateCoalesceLAYERSParam.
     * Bei schnellem Aktivieren mehrerer Sublayer wird nur EIN Server-Request gefeuert.
     * @param {string} groupId  Coalesce-Gruppen-ID
     */
    _updateCoalesceLAYERSParamDebounced: function (groupId) {
      var delay = (_config.coalesceDebounceMs || 50);
      var self = this;
      if (_coalesceDebounceTimers[groupId]) {
        clearTimeout(_coalesceDebounceTimers[groupId]);
      }
      _coalesceDebounceTimers[groupId] = setTimeout(function () {
        delete _coalesceDebounceTimers[groupId];
        self._updateCoalesceLAYERSParam(groupId);
      }, delay);
    },

    /**
     * Liefert den Coalesce-OL-Layer-Entry für eine Gruppe (für Debug).
     * @param {string} groupId
     * @returns {Object|null}
     */
    getCoalesceOLLayer: function (groupId) {
      return _coalesceOLLayers[groupId] || null;
    }
  };

  window.TnetLMStore = LMStore;
})();
