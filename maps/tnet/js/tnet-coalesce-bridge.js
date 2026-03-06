/**
 * tnet-coalesce-bridge.js
 * Framework-Bridge v2: Steuert Coalesce-Layer über den Root-Dienst des
 * MapPlus-Frameworks statt eigene __coalesce__-OL-Layer zu erstellen.
 *
 * Strategie:
 *   Die Root-Dienste (z.B. "gis_oereb/nw_nutzungsplanung_def") sind
 *   bereits in layers_tnet_oereb_multi.conf registriert. Die Bridge:
 *     1. Aktiviert den Root-Dienst via TnetLayerSwitch(rootKey, 'on')
 *     2. Steuert Sublayer über source.updateParams({LAYERS: 'show:0,3,5'})
 *     3. Registriert lookupCallbacks für MapTip (Sublayer → Root-OL-Layer)
 *     4. Synchronisiert Dojo-Checkboxen und URL-State
 *
 *   Da der OL-Layer vom Framework erstellt wird, funktionieren MapTip,
 *   Legende, Bookmark und Layer-Sortierung automatisch.
 *
 * Aktivierung: tnet-global-config.json5 → layerManager.coalesceFrameworkBridge = true
 *
 * @version    2.0
 * @date       2025-03-05
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */
(function () {
  'use strict';

  var LOG = '[CoalesceBridge]';

  // ===== INTERNER STATE =====
  var _enabled = false;

  /**
   * Registry der aktiven Root-Dienste.
   * Key = Root-Dienst-Key (z.B. "gis_oereb/nw_nutzungsplanung_def")
   * Value = {
   *   olLayer:              ol.layer.Layer|null,
   *   registeredSublayers:  { sublayerKey: sublayerNum },
   *   visibleSublayers:     { sublayerKey: sublayerNum },
   *   debounceTimer:        number|null,
   *   originalLAYERS:       string
   * }
   */
  var _rootServices = {};

  /** Reverse-Mapping: Sublayer-Key → Root-Dienst-Key */
  var _sublayerToRoot = {};

  /** MapTip-Patch installiert */
  var _maptipPatched = false;

  /** URL-Sync Timer */
  var _urlSyncTimer = null;

  /** Ursprüngliche layers= aus URL — beim Script-Laden gespeichert, bevor Framework die URL überschreibt */
  var _originalUrlLayers = '';
  try {
    var _urlInit = new URL(window.location.href);
    _originalUrlLayers = _urlInit.searchParams.get('layers') || '';
    if (_originalUrlLayers) {
      TnetLog.log(LOG, 'Ursprüngliche URL-Layers gesichert:', _originalUrlLayers);
    }
  } catch (e) { /* URL-Parsing nicht verfügbar */ }

  // ===== HILFSFUNKTIONEN =====

  /**
   * Ermittelt den Root-Dienst-Key aus einem Sublayer-Key.
   * "gis_oereb/nw_nutzungsplanung_def/grundnutzung"
   *   → "gis_oereb/nw_nutzungsplanung_def"
   * @param {string} sublayerKey
   * @returns {string|null}
   */
  function _extractRootKey(sublayerKey) {
    if (!sublayerKey || typeof sublayerKey !== 'string') return null;
    var idx = sublayerKey.lastIndexOf('/');
    if (idx <= 0) return null;
    return sublayerKey.substring(0, idx);
  }

  /**
   * Prüft ob ein Root-Dienst im Framework existiert.
   * @param {string} rootKey
   * @returns {boolean}
   */
  function _rootExistsInFramework(rootKey) {
    try {
      var am = window.njs && window.njs.AppManager;
      if (!am) return false;
      if (am.Layers && am.Layers[rootKey]) return true;
      if (am.Maps && am.Maps['main'] && am.Maps['main'].layers) {
        if (am.Maps['main'].layers[rootKey]) return true;
      }
      if (am.LyrMgr) {
        for (var mgrId in am.LyrMgr) {
          if (!am.LyrMgr.hasOwnProperty(mgrId)) continue;
          var mgr = am.LyrMgr[mgrId];
          if (mgr && mgr.layers && mgr.layers[rootKey]) return true;
        }
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  /**
   * Liest die Original-LAYERS-Config eines Root-Dienstes.
   * @param {string} rootKey
   * @returns {string|null}
   */
  function _getOriginalLAYERS(rootKey) {
    try {
      var am = window.njs && window.njs.AppManager;
      if (!am) return null;
      var configs = [];
      if (am.Layers && am.Layers[rootKey]) configs.push(am.Layers[rootKey]);
      if (am.Maps && am.Maps['main'] && am.Maps['main'].layers && am.Maps['main'].layers[rootKey]) {
        configs.push(am.Maps['main'].layers[rootKey]);
      }
      for (var i = 0; i < configs.length; i++) {
        var c = configs[i];
        if (c.params && c.params.LAYERS) return c.params.LAYERS;
        if (c.LAYERS) return c.LAYERS;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  /**
   * Findet den OL-Layer, den das Framework (oder Standard-Coalesce) für
   * einen Layer-Key erstellt hat. Sucht in drei Stufen:
   *   1. Exakter Name-Match
   *   2. Case-insensitiver Name-Match
   *   3. URL-basierter Match (Source-URL enthält den Dienst-Pfad)
   * @param {string} layerKey
   * @returns {ol.layer.Layer|null}
   */
  function _findFrameworkOLLayer(layerKey) {
    try {
      var am = window.njs && window.njs.AppManager;
      if (!am || !am.Maps || !am.Maps['main'] || !am.Maps['main'].mapObj) return null;
      var mapObj = am.Maps['main'].mapObj;
      var layers = mapObj.getLayers().getArray();
      var layerKeyLc = layerKey.toLowerCase();

      // 1. Exakter Name-Match
      for (var i = 0; i < layers.length; i++) {
        var name = layers[i].get('name') || '';
        if (name === layerKey) return layers[i];
      }
      // 2. Case-insensitiver Name-Match
      for (var j = 0; j < layers.length; j++) {
        var name2 = (layers[j].get('name') || '').toLowerCase();
        if (name2 === layerKeyLc) return layers[j];
      }
      // 3. URL-basierter Match: Source-URL enthält den Dienst-Pfad
      for (var k = 0; k < layers.length; k++) {
        var src = layers[k].getSource && layers[k].getSource();
        if (src && typeof src.getUrl === 'function') {
          var url = (src.getUrl() || '').toLowerCase();
          if (url.indexOf(layerKeyLc + '/mapserver') !== -1 ||
              url.indexOf('path=' + layerKeyLc + '/') !== -1) {
            return layers[k];
          }
        }
      }
    } catch (e) {
      TnetLog.warn(LOG, '_findFrameworkOLLayer Fehler:', e.message);
    }
    return null;
  }

  /**
   * Baut den LAYERS-Parameter aus sichtbaren Sublayer-Nummern.
   * @param {Object} visibleSublayers  { sublayerKey: sublayerNum }
   * @returns {string}  z.B. "show:0,3,5" oder "show:-1"
   */
  function _buildLayersParam(visibleSublayers) {
    var nums = [];
    for (var lid in visibleSublayers) {
      if (visibleSublayers.hasOwnProperty(lid)) {
        nums.push(visibleSublayers[lid]);
      }
    }
    nums.sort(function (a, b) { return a - b; });
    if (nums.length === 0) return 'show:-1';
    return 'show:' + nums.join(',');
  }

  // ===== OL-LAYER-ERSTELLUNG =====

  /**
   * Erstellt einen OL-Layer für einen Root-Dienst direkt in der Bridge.
   * Wird verwendet wenn das Framework den Root-Key nicht kennt und
   * keinen eigenen OL-Layer erstellt.
   * @param {string} rootKey      z.B. "gis_oereb/nw_nutzungsplanung_def"
   * @param {Object} entry        _rootServices[rootKey] Eintrag
   * @param {string} sublayerKey  Erster Sublayer-Key (zur ServiceUrl-Ermittlung)
   * @returns {ol.layer.Layer|null}
   * @private
   */
  function _createRootOLLayer(rootKey, entry, sublayerKey) {
    var store = window.TnetLMStore;
    var serviceUrl = null;
    var opacity = 1.0;

    // ServiceUrl aus Store-CoalesceIndex holen
    if (store && typeof store.getCoalesceInfo === 'function') {
      var info = store.getCoalesceInfo(sublayerKey);
      if (info && info.serviceUrl) {
        serviceUrl = info.serviceUrl;
      }
    }
    if (!serviceUrl) {
      TnetLog.warn(LOG, '_createRootOLLayer: Kein serviceUrl fuer', rootKey);
      return null;
    }

    // Proxy-Prefix sicherstellen
    if (serviceUrl.indexOf('/maps/') !== 0 && serviceUrl.indexOf('http') !== 0) {
      serviceUrl = '/maps/' + serviceUrl;
    }

    var am = (window.njs && window.njs.AppManager) || null;
    if (!am || !am.Maps || !am.Maps['main'] || !am.Maps['main'].mapObj) {
      TnetLog.warn(LOG, '_createRootOLLayer: Map nicht bereit fuer', rootKey);
      return null;
    }
    var map = am.Maps['main'].mapObj;

    // Opacity aus erstem Sublayer-Layer übernehmen
    if (store && typeof store.findLayer === 'function') {
      var firstLayer = store.findLayer(sublayerKey);
      if (firstLayer && firstLayer.options && firstLayer.options.opacity !== undefined) {
        opacity = firstLayer.options.opacity;
      } else if (firstLayer && firstLayer.opacity !== undefined) {
        opacity = firstLayer.opacity;
      }
    }

    // LAYERS-Parameter aus aktuell sichtbaren Sublayern bauen
    var layersParam = _buildLayersParam(entry.visibleSublayers);

    var arcParams = { LAYERS: layersParam, FORMAT: 'PNG32', TRANSPARENT: true, DPI: 96 };
    var source = new ol.source.ImageArcGISRest({
      url: serviceUrl,
      params: arcParams,
      ratio: 1
    });
    var olLayer = new ol.layer.Image({
      source: source,
      opacity: opacity,
      visible: true,
      zIndex: 200
    });
    olLayer.set('name', rootKey);
    olLayer.set('tnet_bridge_created', true);

    map.addLayer(olLayer);
    TnetLog.log(LOG, 'Bridge OL-Layer erstellt:', rootKey,
      '| URL:', serviceUrl, '| LAYERS:', layersParam, '| Opacity:', opacity);

    return olLayer;
  }

  // ===== MAPTIP: FORCE-AKTIVIERUNG =====

  /**
   * Aktiviert Maptips für einen Coalesce-Sublayer direkt.
   * Das Framework aktiviert Maptips nur wenn ein OL-Layer mit name == linked_layer_id
   * hinzugefügt wird. Bei Coalesce-Layern stimmt der Name nicht überein, daher
   * müssen wir die Maptips manuell in wmsActiveLyrs einfügen.
   * @param {string} sublayerKey  z.B. "gis_oereb/nw_nutzungsplanung_def/grundnutzung"
   * @param {ol.layer.Layer} olLayer  Coalesce/Root-OL-Layer für die Identify-Abfrage
   * @private
   */
  function _forceActivateMaptip(sublayerKey, olLayer) {
    try {
      var am = window.njs && window.njs.AppManager;
      if (!am || !am.MapTips || !am.wmsActiveLyrs) {
        // Framework noch nicht bereit — Retry
        TnetLog.debug(LOG, '_forceActivateMaptip: Framework nicht bereit, Retry in 1s für:', sublayerKey);
        setTimeout(function () { _forceActivateMaptip(sublayerKey, olLayer); }, 1000);
        return;
      }

      // Root-Key ermitteln für Dedup gegen Root-Level-MapTips
      var rootKey = _extractRootKey(sublayerKey);

      var count = 0;
      var activatedQueryLayers = []; // query_layers der aktivierten Sublayer-MapTips sammeln
      for (var mtId in am.MapTips) {
        if (!am.MapTips.hasOwnProperty(mtId)) continue;
        if (mtId === '_wms_connector' || mtId === '_disablewmsgetfeatureinfo') continue;
        var mt = am.MapTips[mtId];
        if (mt && mt.linked_layer_id === sublayerKey) {
          // OL-Layer setzen damit queryconnector die Source-URL findet
          mt.wms_layer = olLayer;
          if (!mt.active) {
            am.wmsActiveLyrs.push(mt);
            mt.active = true;
            count++;
          }
          // query_layers merken für Root-Dedup
          if (mt.query_layers) {
            activatedQueryLayers.push(mt.query_layers);
          }
        }
      }

      // ── Dedup: Root-Level-MapTips deaktivieren die gleiche query_layers haben ──
      // Wenn ein spezifischer Sublayer-MapTip aktiv ist (z.B. .../grundnutzung_12),
      // muss der generische Root-MapTip (z.B. ..._def_12) deaktiviert werden,
      // sonst liefert queryconnector() doppelte Requests.
      if (rootKey && activatedQueryLayers.length > 0) {
        var dedupCount = 0;
        for (var rMtId in am.MapTips) {
          if (!am.MapTips.hasOwnProperty(rMtId)) continue;
          if (rMtId === '_wms_connector' || rMtId === '_disablewmsgetfeatureinfo') continue;
          var rMt = am.MapTips[rMtId];
          if (!rMt || !rMt.active) continue;
          // Root-Level-MapTip erkennen: linked_layer_id == rootKey (nicht sublayerKey)
          if (rMt.linked_layer_id === rootKey && rMt.query_layers) {
            if (activatedQueryLayers.indexOf(rMt.query_layers) !== -1) {
              am.wmsActiveLyrs.remove(rMt);
              rMt.active = false;
              dedupCount++;
              TnetLog.debug(LOG, 'Root-MapTip deaktiviert (Dedup):', rMtId,
                'query_layers:', rMt.query_layers, '→ Sublayer hat Vorrang:', sublayerKey);
            }
          }
        }
        if (dedupCount > 0) {
          TnetLog.log(LOG, 'Root-MapTip Dedup:', dedupCount, 'entfernt für', sublayerKey);
        }
      }

      if (count > 0) {
        TnetLog.log(LOG, 'MapTip force-aktiviert:', sublayerKey, '(' + count + ' MapTips)');
      } else {
        TnetLog.debug(LOG, 'Kein MapTip gefunden für Sublayer:', sublayerKey);
      }
    } catch (e) {
      TnetLog.warn(LOG, '_forceActivateMaptip Fehler:', e.message);
    }
  }

  /**
   * Deaktiviert Maptips für einen Coalesce-Sublayer.
   * Entfernt die MapTip-Objekte aus wmsActiveLyrs und setzt wms_layer zurück.
   * @param {string} sublayerKey
   * @private
   */
  function _forceDeactivateMaptip(sublayerKey) {
    try {
      var am = window.njs && window.njs.AppManager;
      if (!am || !am.MapTips || !am.wmsActiveLyrs) return;
      var count = 0;
      for (var mtId in am.MapTips) {
        if (!am.MapTips.hasOwnProperty(mtId)) continue;
        if (mtId === '_wms_connector' || mtId === '_disablewmsgetfeatureinfo') continue;
        var mt = am.MapTips[mtId];
        if (mt && mt.linked_layer_id === sublayerKey) {
          if (mt.active) {
            am.wmsActiveLyrs.remove(mt);
            mt.active = false;
            count++;
          }
          mt.wms_layer = null;
        }
      }
      if (count > 0) {
        TnetLog.debug(LOG, 'MapTip deaktiviert:', sublayerKey, '(' + count + ' MapTips)');
      }
    } catch (e) {
      TnetLog.debug(LOG, '_forceDeactivateMaptip Fehler:', e.message);
    }
  }

  // ===== MAPTIP: LOOKUPCALLBACKS =====

  /**
   * Registriert lookupCallback-Einträge für einen Sublayer.
   * Sucht den passenden MapTip (linked_layer = sublayerKey) und erstellt
   * lookupCallback-Keys mit der Root-Service-URL.
   * @param {string} sublayerKey
   * @param {string} rootKey
   * @private
   */
  function _registerLookupCallbacks(sublayerKey, rootKey) {
    try {
      var am = window.njs && window.njs.AppManager;
      if (!am || !am.MapTips || !am.MapTips._wms_connector) {
        TnetLog.debug(LOG, '_registerLookupCallbacks: _wms_connector nicht verfügbar, Retry in 1s');
        setTimeout(function () { _registerLookupCallbacks(sublayerKey, rootKey); }, 1000);
        return;
      }

      // MapTips finden, die auf diesen Sublayer zeigen
      var linkedMTs = [];
      for (var mtId in am.MapTips) {
        if (!am.MapTips.hasOwnProperty(mtId)) continue;
        if (mtId === '_wms_connector') continue;
        var mt = am.MapTips[mtId];
        if (mt && mt.linked_layer_id === sublayerKey) {
          linkedMTs.push({ id: mtId, mt: mt });
        }
      }

      if (linkedMTs.length === 0) {
        TnetLog.debug(LOG, 'Kein MapTip für Sublayer:', sublayerKey);
        return;
      }

      // OL-Layer des Root-Dienstes finden → URL für lookupCallback-Key
      var entry = _rootServices[rootKey];
      if (!entry || !entry.olLayer) {
        TnetLog.debug(LOG, '_registerLookupCallbacks: OL-Layer noch nicht bereit für', rootKey);
        return;
      }

      var src = entry.olLayer.getSource();
      var sourceUrl = '';
      if (src && typeof src.getUrl === 'function') sourceUrl = src.getUrl() || '';

      if (!sourceUrl) {
        TnetLog.warn(LOG, '_registerLookupCallbacks: Keine Source-URL für', rootKey);
        return;
      }

      var connector = am.MapTips._wms_connector;
      var count = 0;

      for (var mi = 0; mi < linkedMTs.length; mi++) {
        var mtInfo = linkedMTs[mi];
        var qLayers = mtInfo.mt.query_layers ? mtInfo.mt.query_layers.split(',') : [];
        var qAlias = mtInfo.mt.query_layers_alias ? mtInfo.mt.query_layers_alias.split(',') : [];

        for (var q = 0; q < qLayers.length; q++) {
          var layerNames = [];
          var alias = qAlias[q] || '';
          if (alias) {
            var aliases = alias.split('|');
            for (var a = 0; a < aliases.length; a++) {
              layerNames.push(aliases[a].toLowerCase().replace(/[^\w]/gi, '_'));
            }
          } else {
            layerNames.push(qLayers[q].toLowerCase().replace(/[^\w]/gi, '_'));
          }

          for (var n = 0; n < layerNames.length; n++) {
            var cbKey = sourceUrl + '~' + layerNames[n];

            for (var mapId in connector) {
              if (!connector.hasOwnProperty(mapId)) continue;
              if (mapId === '_wms_connector') continue;
              var mapConn = connector[mapId];
              if (!mapConn || !mapConn.lookupCallbacks) continue;

              if (!mapConn.lookupCallbacks[cbKey]) {
                mapConn.lookupCallbacks[cbKey] = [];
              }

              // Duplikat-Prüfung
              var alreadyIn = false;
              for (var cb = 0; cb < mapConn.lookupCallbacks[cbKey].length; cb++) {
                if (mapConn.lookupCallbacks[cbKey][cb] === mtInfo.mt) {
                  alreadyIn = true;
                  break;
                }
              }
              if (!alreadyIn) {
                mapConn.lookupCallbacks[cbKey].push(mtInfo.mt);
                count++;
                TnetLog.debug(LOG, 'lookupCallback registriert:', cbKey, '→', mtInfo.id);
              }
            }
          }
        }
      }

      if (count > 0) {
        TnetLog.log(LOG, 'lookupCallbacks für', sublayerKey, ':', count, 'Einträge');
      }
    } catch (e) {
      TnetLog.warn(LOG, '_registerLookupCallbacks Fehler:', e.message);
    }
  }

  /**
   * Entfernt lookupCallback-Einträge für einen Sublayer.
   * @param {string} sublayerKey
   * @param {string} rootKey
   * @private
   */
  function _unregisterLookupCallbacks(sublayerKey, rootKey) {
    try {
      var am = window.njs && window.njs.AppManager;
      if (!am || !am.MapTips || !am.MapTips._wms_connector) return;

      var linkedMTs = [];
      for (var mtId in am.MapTips) {
        if (!am.MapTips.hasOwnProperty(mtId)) continue;
        if (mtId === '_wms_connector') continue;
        var mt = am.MapTips[mtId];
        if (mt && mt.linked_layer_id === sublayerKey) {
          linkedMTs.push(mt);
        }
      }
      if (linkedMTs.length === 0) return;

      var connector = am.MapTips._wms_connector;
      for (var mapId in connector) {
        if (!connector.hasOwnProperty(mapId)) continue;
        if (mapId === '_wms_connector') continue;
        var mapConn = connector[mapId];
        if (!mapConn || !mapConn.lookupCallbacks) continue;

        for (var cbKey in mapConn.lookupCallbacks) {
          if (!mapConn.lookupCallbacks.hasOwnProperty(cbKey)) continue;
          var arr = mapConn.lookupCallbacks[cbKey];
          for (var m = 0; m < linkedMTs.length; m++) {
            var idx = arr.indexOf(linkedMTs[m]);
            if (idx !== -1) {
              arr.splice(idx, 1);
              TnetLog.debug(LOG, 'lookupCallback entfernt:', cbKey, '→ Sublayer:', sublayerKey);
            }
          }
          if (arr.length === 0) {
            delete mapConn.lookupCallbacks[cbKey];
          }
        }
      }
    } catch (e) {
      TnetLog.debug(LOG, '_unregisterLookupCallbacks Fehler:', e.message);
    }
  }

  /**
   * MapTip-Patch installieren:
   *   1. lookupCallbacks für alle aktiven Sublayer nachholen
   *   2. queryconnector patchen: Sublayer-Sichtbarkeitsfilter
   * @private
   */
  function _installMaptipPatch() {
    if (_maptipPatched) return;
    try {
      var am = window.njs && window.njs.AppManager;
      if (!am || !am.Maps || !am.Maps['main']) {
        TnetLog.debug(LOG, 'MapTip-Patch: Framework nicht bereit, Retry in 2s');
        setTimeout(_installMaptipPatch, 2000);
        return;
      }

      // ── Patch 1: lookupCallbacks + force-activate nachholen ──
      var count = 0;
      for (var rootKey in _rootServices) {
        if (!_rootServices.hasOwnProperty(rootKey)) continue;
        var entry = _rootServices[rootKey];
        if (!entry.olLayer) entry.olLayer = _findFrameworkOLLayer(rootKey);
        if (entry.olLayer) {
          for (var lid in entry.registeredSublayers) {
            if (entry.registeredSublayers.hasOwnProperty(lid)) {
              _registerLookupCallbacks(lid, rootKey);
              _forceActivateMaptip(lid, entry.olLayer);
              count++;
            }
          }
        }
      }

      // ── Patch 2: queryconnector wrappen — Sublayer-Sichtbarkeitsfilter ──
      _patchQueryconnector();

      // ── Patch 3: Framework-URL-Sync wrappen — Root-Keys durch Sublayer-Keys ersetzen ──
      _patchUpdateMapStatusUrl();

      _maptipPatched = true;
      TnetLog.log(LOG, 'MapTip-Patch installiert,', count, 'Sublayer-Callbacks, queryconnector + URL-Sync gepatcht');
    } catch (e) {
      TnetLog.warn(LOG, 'MapTip-Patch Fehler:', e.message);
    }
  }

  /**
   * Patcht wmsServiceMapTip.queryconnector():
   * Vor dem Original-Call wird geprüft, ob der query_layers-Sublayer
   * aktuell in den sichtbaren LAYERS des OL-Layers enthalten ist.
   * Unsichtbare Sublayer werden übersprungen → kein Request.
   * @private
   */
  function _patchQueryconnector() {
    try {
      var proto = njs.MapTip.wmsServiceMapTip.prototype;
      if (proto._tnet_origQueryconnector) return; // Bereits gepatcht

      var origFn = proto.queryconnector;
      proto._tnet_origQueryconnector = origFn;

      proto.queryconnector = function (evt) {
        var linkedId = this.linked_layer_id;
        if (linkedId) {
          // Root-Key ermitteln: 3 Strategien
          var rootKey = null;

          // 1) linked_layer_id IST direkt ein Root-Key (z.B. "gis_oereb/nw_nutzungsplanung_def")
          //    → MapTips wie gis_oereb/nw_nutzungsplanung_def_11 mit linked_layer = Root-Key
          if (_rootServices[linkedId]) {
            rootKey = linkedId;
          }
          // 2) linked_layer_id ist ein Sublayer-Key im _sublayerToRoot Mapping
          else if (_sublayerToRoot[linkedId]) {
            rootKey = _sublayerToRoot[linkedId];
          }
          // 3) Fallback: Root-Key aus linked_layer_id extrahieren
          else {
            var extracted = _extractRootKey(linkedId);
            if (extracted && _rootServices[extracted]) {
              rootKey = extracted;
            }
          }

          // Sichtbarkeitscheck gegen Bridge-State
          if (rootKey) {
            var entry = _rootServices[rootKey];
            if (entry && !entry.maptipOnly) {
              var visibleNums = _getVisibleSublayerNums(rootKey);
              var queryNum = parseInt(this.query_layers, 10);
              if (!isNaN(queryNum) && visibleNums.length > 0 && visibleNums.indexOf(queryNum) === -1) {
                TnetLog.debug(LOG, 'queryconnector Skip (nicht sichtbar):',
                  linkedId, 'query_layers:', this.query_layers,
                  'rootKey:', rootKey, 'visible:', visibleNums.join(','));
                return; // Sublayer nicht sichtbar → Request überspringen
              }
            }
          }
        }

        // Original aufrufen
        return origFn.call(this, evt);
      };

      TnetLog.log(LOG, 'queryconnector-Patch installiert (Sublayer-Sichtbarkeitsfilter)');
    } catch (e) {
      TnetLog.warn(LOG, '_patchQueryconnector Fehler:', e.message);
    }
  }

  /**
   * Patcht njs.AppManager.updateMapStatusUrl():
   * Das Framework schreibt bei jedem moveend/loadend die gesamte URL.
   * Es nutzt dabei LyrMgr-Root-Keys (z.B. "gis_oereb/nw_nutzungsplanung_def"),
   * nicht die von uns benötigten Sublayer-Keys ("gis_oereb/.../grundnutzung").
   *
   * Der Patch:
   *   1. Lässt das Original laufen (schreibt Root-Key in URL)
   *   2. Danach: ersetzt Root-Keys in layers= durch die aktiven Sublayer-Keys
   * @private
   */
  function _patchUpdateMapStatusUrl() {
    try {
      var am = njs.AppManager;
      if (!am || !am.updateMapStatusUrl) {
        TnetLog.debug(LOG, 'updateMapStatusUrl nicht verfügbar, URL-Patch nicht installiert');
        return;
      }
      if (am._tnet_origUpdateMapStatusUrl) return; // Bereits gepatcht

      var origFn = am.updateMapStatusUrl;
      am._tnet_origUpdateMapStatusUrl = origFn;

      am.updateMapStatusUrl = function (map_name) {
        // Original aufrufen — schreibt URL mit Root-Keys
        origFn.call(this, map_name);

        // URL nachkorrigieren: Root-Keys → Sublayer-Keys
        _fixUrlForBridgeLayers();
      };

      TnetLog.log(LOG, 'updateMapStatusUrl-Patch installiert (Root-Key → Sublayer-Key URL-Fix)');
    } catch (e) {
      TnetLog.warn(LOG, '_patchUpdateMapStatusUrl Fehler:', e.message);
    }
  }

  /**
   * Korrigiert den layers= URL-Parameter:
   *   - Bekannte Coalesce Root-Keys UND Sublayer-Keys entfernen
   *   - Nur aktive Sublayer-Keys wieder einfügen
   * Wird nach jedem Framework-URL-Update UND nach Layer-Änderungen aufgerufen.
   * @private
   */
  function _fixUrlForBridgeLayers() {
    try {
      // Aktive Sublayer-Keys aus Bridge-State sammeln
      var activeSublayerKeys = {};
      for (var rootKey in _rootServices) {
        if (!_rootServices.hasOwnProperty(rootKey)) continue;
        var entry = _rootServices[rootKey];
        if (entry.maptipOnly) continue;
        for (var lid in entry.visibleSublayers) {
          if (entry.visibleSublayers.hasOwnProperty(lid)) {
            activeSublayerKeys[lid] = true;
          }
        }
      }

      // Alle bekannten Coalesce-Keys sammeln (Root-Keys UND Sublayer-Keys)
      // Diese müssen aus der URL entfernt werden, egal ob aktiv oder nicht.
      // Nur aktive Sublayer-Keys werden anschliessend wieder eingefügt.
      var keysToFilter = {};
      if (window.TnetLMStore && typeof window.TnetLMStore.getCoalesceIndex === 'function') {
        var coalIdx = window.TnetLMStore.getCoalesceIndex();
        for (var gid in coalIdx) {
          if (!coalIdx.hasOwnProperty(gid)) continue;
          // Root-Key (groupId)
          keysToFilter[gid] = true;
          // Alle Sublayer-Keys dieser Gruppe
          var cids = coalIdx[gid].childIds;
          if (cids) {
            for (var c = 0; c < cids.length; c++) {
              keysToFilter[cids[c]] = true;
            }
          }
        }
      }
      // Auch aktive Root-Keys (falls nicht im Coalesce-Index)
      for (var rk in _rootServices) {
        if (_rootServices.hasOwnProperty(rk)) keysToFilter[rk] = true;
      }

      var url = new URL(window.location.href);
      var existingLayers = url.searchParams.get('layers') || '';
      var activeSublayerList = Object.keys(activeSublayerKeys);
      if (!existingLayers && activeSublayerList.length === 0) return;

      var layerList = existingLayers ? existingLayers.split('|') : [];
      var changed = false;

      // Bekannte Coalesce-Keys filtern
      var cleanList = [];
      for (var i = 0; i < layerList.length; i++) {
        var lyr = layerList[i];
        if (keysToFilter[lyr]) {
          changed = true;
          continue;
        }
        cleanList.push(lyr);
      }

      // Aktive Sublayer-Keys wieder hinzufügen
      for (var j = 0; j < activeSublayerList.length; j++) {
        if (cleanList.indexOf(activeSublayerList[j]) === -1) {
          cleanList.push(activeSublayerList[j]);
          changed = true;
        }
      }

      if (changed) {
        var newParam = cleanList.join('|');
        var href = window.location.href;
        var re = /([?&])layers=[^&]*/;
        if (newParam) {
          if (re.test(href)) {
            href = href.replace(re, '$1layers=' + newParam);
          } else {
            href += (href.indexOf('?') === -1 ? '?' : '&') + 'layers=' + newParam;
          }
        } else {
          // Kein Layer mehr → layers= komplett entfernen
          href = href.replace(re, '').replace(/[?&]$/, '').replace(/\?&/, '?');
        }
        window.history.replaceState(null, '', href);
        TnetLog.debug(LOG, 'URL-Fix:', newParam || '(layers entfernt)');
      }
    } catch (e) {
      TnetLog.debug(LOG, '_fixUrlForBridgeLayers Fehler:', e.message);
    }
  }

  /**
   * Gibt die aktuell sichtbaren Sublayer-Nummern eines Root-Dienstes zurück.
   * Liest aus dem visibleSublayers-State der Bridge.
   * @param {string} rootKey
   * @returns {number[]}
   */
  function _getVisibleSublayerNums(rootKey) {
    var entry = _rootServices[rootKey];
    if (!entry) return [];
    var nums = [];
    for (var lid in entry.visibleSublayers) {
      if (entry.visibleSublayers.hasOwnProperty(lid)) {
        nums.push(entry.visibleSublayers[lid]);
      }
    }
    return nums;
  }

  // ===== DOJO-SYNC =====

  /**
   * Synchronisiert die Dojo-Checkbox im Legacy-Tree.
   * @param {string} layerId
   * @param {boolean} visible
   * @private
   */
  function _syncDojoCheckbox(layerId, visible) {
    try {
      if (typeof dijit !== 'undefined' && dijit.byId) {
        var widget = dijit.byId(layerId);
        if (widget && typeof widget.set === 'function') {
          widget.set('checked', visible);
        }
      }
    } catch (e) { /* Dojo nicht verfügbar */ }
  }

  // ===== URL-STATE =====

  /**
   * Aktualisiert den URL-State (debounced).
   * @private
   */
  function _scheduleUrlSync() {
    if (_urlSyncTimer) clearTimeout(_urlSyncTimer);
    _urlSyncTimer = setTimeout(_syncUrl, 300);
  }

  /**
   * Synchronisiert den URL-Parameter layers= mit aktiven Coalesce-Layern.
   * Entfernt Root-Keys UND nicht mehr aktive Sublayer-Keys,
   * fügt aktive Sublayer-Keys hinzu.
   * @private
   */
  function _syncUrl() {
    try {
      // Aktive Root-Keys und Sublayer-Keys aus Bridge-State sammeln
      var activeRootKeys = {};
      var activeSublayerKeys = {};
      for (var rootKey in _rootServices) {
        if (!_rootServices.hasOwnProperty(rootKey)) continue;
        var entry = _rootServices[rootKey];
        if (entry.maptipOnly) continue;
        activeRootKeys[rootKey] = true;
        for (var lid in entry.visibleSublayers) {
          if (entry.visibleSublayers.hasOwnProperty(lid)) {
            activeSublayerKeys[lid] = true;
          }
        }
      }

      // Alle Sublayer-Keys sammeln die jemals Bridge-managed waren
      // (aus _layerToCoalesce im Store, falls verfügbar)
      var allKnownBridgeSublayers = {};
      if (window.TnetLMStore && typeof window.TnetLMStore.getCoalesceIndex === 'function') {
        var coalIdx = window.TnetLMStore.getCoalesceIndex();
        for (var gid in coalIdx) {
          if (!coalIdx.hasOwnProperty(gid)) continue;
          var cids = coalIdx[gid].childIds;
          for (var c = 0; c < cids.length; c++) {
            allKnownBridgeSublayers[cids[c]] = gid;
          }
        }
      }

      var url = new URL(window.location.href);
      var existingLayers = url.searchParams.get('layers') || '';
      var layerList = existingLayers ? existingLayers.split('|') : [];
      var changed = false;

      // Vorhandene Einträge filtern: Root-Keys entfernen, inaktive Sublayer-Keys entfernen
      var cleanList = [];
      for (var i = 0; i < layerList.length; i++) {
        var lyr = layerList[i];
        // Root-Key entfernen (wird durch Sublayer-Keys ersetzt)
        if (activeRootKeys[lyr]) {
          changed = true;
          continue;
        }
        // Sublayer-Key entfernen wenn er Bridge-managed ist aber nicht mehr aktiv
        if (allKnownBridgeSublayers[lyr] && !activeSublayerKeys[lyr]) {
          changed = true;
          continue;
        }
        cleanList.push(lyr);
      }

      // Aktive Sublayer-Keys hinzufügen (wenn nicht bereits drin)
      for (var sk in activeSublayerKeys) {
        if (activeSublayerKeys.hasOwnProperty(sk) && cleanList.indexOf(sk) === -1) {
          cleanList.push(sk);
          changed = true;
        }
      }

      if (changed) {
        var newParam = cleanList.join('|');
        var href = window.location.href;
        var re = /([?&])layers=[^&]*/;
        if (newParam) {
          if (re.test(href)) {
            href = href.replace(re, '$1layers=' + newParam);
          } else {
            href += (href.indexOf('?') === -1 ? '?' : '&') + 'layers=' + newParam;
          }
        } else {
          // Kein Layer mehr aktiv → layers=-Parameter komplett entfernen
          href = href.replace(re, '').replace(/[?&]$/, '').replace(/\?&/, '?');
        }
        window.history.replaceState(null, '', href);
        TnetLog.debug(LOG, 'URL-Sync:', newParam || '(leer)');
      }
    } catch (e) {
      TnetLog.debug(LOG, '_syncUrl Fehler:', e.message);
    }
  }

  /**
   * Patcht window.TnetLayerSwitch():
   * Wenn TnetLayerSwitch mit einem Coalesce-Sublayer-Key aufgerufen wird
   * (z.B. via ensureUrlLayers beim Reload), wird der Aufruf über den
   * Store geroutet statt direkt ein individuelles OL-Layer zu erstellen.
   *
   * Muss früh installiert werden (in init()), da ensureUrlLayers
   * 500ms nach tnet-app-ready läuft.
   * @private
   */
  function _patchTnetLayerSwitch() {
    if (typeof window.TnetLayerSwitch !== 'function') {
      TnetLog.debug(LOG, 'TnetLayerSwitch nicht verfügbar, Patch nicht installiert');
      return;
    }
    if (window._tnet_origTnetLayerSwitch) return; // Bereits gepatcht

    var origFn = window.TnetLayerSwitch;
    window._tnet_origTnetLayerSwitch = origFn;

    window.TnetLayerSwitch = function (layerId, mode) {
      // Nur 'on'-Aufrufe abfangen
      if (mode === 'on' && _enabled) {
        // 1. Bereits von Bridge verwaltet → überspringen
        if (_sublayerToRoot[layerId]) {
          TnetLog.debug(LOG, 'TnetLayerSwitch: Sublayer bereits verwaltet:', layerId);
          return true;
        }

        // 2. Store fragen: ist es ein Coalesce-Sublayer?
        var store = window.TnetLMStore;
        if (store && typeof store.isCoalesceSublayer === 'function' &&
            store.isCoalesceSublayer(layerId)) {
          store.setLayerVisible(layerId, true);
          TnetLog.log(LOG, 'TnetLayerSwitch → Store route (Coalesce-Sublayer):', layerId);
          return true;
        }
      }
      // Kein Coalesce-Sublayer oder mode !== 'on' → Original aufrufen
      return origFn.apply(this, arguments);
    };

    TnetLog.log(LOG, 'TnetLayerSwitch-Patch installiert (Coalesce-Sublayer → Store-Route)');
  }

  // ===== ÖFFENTLICHE API =====

  var Bridge = {

    /**
     * Initialisiert die Bridge (wird vom Store nach Katalog-Load aufgerufen).
     * @param {Object} config  layerManager-Config aus tnet-global-config.json5
     */
    init: function (config) {
      _enabled = !!(config && config.coalesceFrameworkBridge);
      if (!_enabled) {
        TnetLog.log(LOG, 'Bridge deaktiviert (coalesceFrameworkBridge = false)');
        return;
      }
      TnetLog.log(LOG, 'Bridge v2 initialisiert (Root-Dienst-Strategie)');

      // Patch 0: TnetLayerSwitch sofort patchen — vor ensureUrlLayers (500ms nach tnet-app-ready)
      _patchTnetLayerSwitch();

      // Patch 1: URL-Sync sofort patchen — Framework überschreibt URL bei jedem moveend/loadend
      _patchUpdateMapStatusUrl();

      // MapTip-Patch deferred installieren (queryconnector + lookupCallbacks)
      var patchFn = function () {
        if (!_maptipPatched) _installMaptipPatch();
      };
      document.addEventListener('tnet-app-ready', function () {
        setTimeout(patchFn, 1500);
      });
      setTimeout(patchFn, 5000);
    },

    /** Prüft ob Bridge aktiv ist. @returns {boolean} */
    isEnabled: function () {
      return _enabled;
    },

    /**
     * Prüft ob die Bridge einen Sublayer handeln kann.
     * Optimistisch: Prüft nur ob Bridge aktiv und Key hierarchisch ist.
     * Tatsächliche Root-Dienst-Verfügbarkeit wird in registerSublayer verifiziert.
     * @param {string} sublayerKey
     * @returns {boolean}
     */
    canHandle: function (sublayerKey) {
      if (!_enabled) return false;
      var rootKey = _extractRootKey(sublayerKey);
      return !!rootKey;
    },

    /**
     * Registriert einen Sublayer. Beim ersten Sublayer wird der Root-Dienst
     * via TnetLayerSwitch aktiviert.
     * @param {string} sublayerKey   z.B. "gis_oereb/nw.../grundnutzung"
     * @param {number} sublayerNum   Sublayer-Nummer (z.B. 0, 3, 5)
     * @returns {boolean}
     */
    registerSublayer: function (sublayerKey, sublayerNum) {
      if (!_enabled) return false;

      var rootKey = _extractRootKey(sublayerKey);
      if (!rootKey) {
        TnetLog.debug(LOG, 'registerSublayer: Kein Root-Key extrahierbar für:', sublayerKey);
        return false;
      }
      if (typeof sublayerNum !== 'number' || sublayerNum < 0) {
        TnetLog.warn(LOG, 'registerSublayer: Ungültige Sublayer-Nr:', sublayerNum);
        return false;
      }

      _sublayerToRoot[sublayerKey] = rootKey;
      var entry = _rootServices[rootKey];
      var isFirst = !entry;

      if (!entry) {
        // ── Erster Sublayer: Root-Dienst aktivieren ──
        _rootServices[rootKey] = {
          olLayer: null,
          registeredSublayers: {},
          visibleSublayers: {},
          debounceTimer: null,
          originalLAYERS: null
        };
        entry = _rootServices[rootKey];

        TnetLog.log(LOG, '★ Root-Dienst aktivieren:', rootKey);

        // 1. Prüfe ob Framework bereits einen OL-Layer hat (von vorherigem Session/Startup)
        entry.olLayer = _findFrameworkOLLayer(rootKey);

        if (!entry.olLayer) {
          // 2. Framework kennt den Root-Key evtl. nicht (nur Sublayer-Keys konfiguriert)
          //    → OL-Layer direkt in der Bridge erstellen (synchron, kein async-Timing-Problem)
          entry.olLayer = _createRootOLLayer(rootKey, entry, sublayerKey);
        }

        if (entry.olLayer) {
          entry.originalLAYERS = _getOriginalLAYERS(rootKey) || 'show:all';
          TnetLog.log(LOG, 'Root-OL-Layer bereit:', rootKey,
            entry.olLayer.get('tnet_bridge_created') ? '(Bridge-erstellt)' : '(Framework)');
        } else {
          // Map noch nicht bereit → Retry (z.B. beim allerersten Startup)
          TnetLog.log(LOG, 'Root-Dienst OL-Layer noch nicht erstellbar:', rootKey,
            '→ Deferred Retry');
          var self = this;
          var retryCount = 0;
          var retryFn = function () {
            if (!_rootServices[rootKey]) return; // bereits aufgeräumt
            entry.olLayer = _findFrameworkOLLayer(rootKey);
            if (!entry.olLayer) {
              entry.olLayer = _createRootOLLayer(rootKey, entry, sublayerKey);
            }
            if (entry.olLayer) {
              entry.originalLAYERS = _getOriginalLAYERS(rootKey) || 'show:all';
              TnetLog.log(LOG, 'Root-OL-Layer bereit nach Retry', retryCount, ':', rootKey);
              self._applyLAYERSParam(rootKey);
              for (var lid in entry.registeredSublayers) {
                if (entry.registeredSublayers.hasOwnProperty(lid)) {
                  _registerLookupCallbacks(lid, rootKey);
                  _forceActivateMaptip(lid, entry.olLayer);
                }
              }
            } else if (retryCount < 8) {
              retryCount++;
              setTimeout(retryFn, 300 * retryCount);
            } else {
              TnetLog.warn(LOG, 'Root-OL-Layer nicht erstellbar nach 8 Retries:', rootKey);
              for (var k in entry.registeredSublayers) {
                if (entry.registeredSublayers.hasOwnProperty(k)) {
                  delete _sublayerToRoot[k];
                }
              }
              delete _rootServices[rootKey];
            }
          };
          setTimeout(retryFn, 500);
        }
      }

      entry.registeredSublayers[sublayerKey] = sublayerNum;
      entry.visibleSublayers[sublayerKey] = sublayerNum;

      // ── Doppel-Layer-Schutz: individuellen Framework-Startup-OL-Layer entfernen ──
      // Das Framework erstellt beim Startup eigene OL-Layer pro Sublayer (name=sublayerKey).
      // Jetzt hat die Bridge einen Root-OL-Layer erstellt (name=rootKey) der ALLE Sublayer
      // enthält → individueller Layer wäre doppelt und muss weg.
      var individualStartupOL = _findFrameworkOLLayer(sublayerKey);
      if (individualStartupOL && individualStartupOL !== entry.olLayer) {
        try {
          var amClean = (window.njs && window.njs.AppManager) ? window.njs.AppManager : null;
          if (amClean && amClean.Maps && amClean.Maps['main'] && amClean.Maps['main'].mapObj) {
            amClean.Maps['main'].mapObj.removeLayer(individualStartupOL);
            TnetLog.log(LOG, 'Framework-Startup-OL-Layer entfernt (Doppel-Schutz):', sublayerKey);
          }
        } catch (e) { /* bereits entfernt */ }
      }

      TnetLog.log(LOG, 'Sublayer registriert:', sublayerKey,
        '(#' + sublayerNum + ') → Root:', rootKey,
        '| Total:', Object.keys(entry.registeredSublayers).length);

      // LAYERS-Parameter aktualisieren (debounced)
      this._updateLAYERSDebounced(rootKey);

      // MapTip: lookupCallbacks + force-activate deferred registrieren
      var self = this;
      setTimeout(function () {
        if (!entry.olLayer) entry.olLayer = _findFrameworkOLLayer(rootKey);
        _registerLookupCallbacks(sublayerKey, rootKey);
        // MapTip direkt in wmsActiveLyrs einfügen damit queryconnector aufgerufen wird
        if (entry.olLayer) {
          _forceActivateMaptip(sublayerKey, entry.olLayer);
        }
      }, isFirst ? 500 : 100);

      // Dojo-Checkbox + URL-State
      _syncDojoCheckbox(sublayerKey, true);
      _scheduleUrlSync();

      return true;
    },

    /**
     * Entfernt einen Sublayer komplett. Beim letzten wird der Root-Dienst deaktiviert.
     * @param {string} sublayerKey
     * @returns {boolean}
     */
    unregisterSublayer: function (sublayerKey) {
      var rootKey = _sublayerToRoot[sublayerKey];
      if (!rootKey) rootKey = _extractRootKey(sublayerKey);
      if (!rootKey) return false;

      var entry = _rootServices[rootKey];
      if (!entry) return false;

      _unregisterLookupCallbacks(sublayerKey, rootKey);
      _forceDeactivateMaptip(sublayerKey);
      delete entry.registeredSublayers[sublayerKey];
      delete entry.visibleSublayers[sublayerKey];
      delete _sublayerToRoot[sublayerKey];

      // ── Ghost-Layer-Schutz: individuellen Framework-Startup-OL-Layer entfernen ──
      // Das Framework erstellt beim Startup pro Sublayer eigene OL-Layer
      // (via switchLayersProgr → lay.switchLayer(true) → map.insertAt).
      // Diese haben name === sublayerKey und existieren NEBEN dem Root-OL-Layer.
      // Ohne diesen Cleanup bleiben sie als Ghost sichtbar.
      var individualOL = _findFrameworkOLLayer(sublayerKey);
      if (individualOL) {
        try {
          var amClean = (window.njs && window.njs.AppManager) ? window.njs.AppManager : null;
          if (amClean && amClean.Maps && amClean.Maps['main'] && amClean.Maps['main'].mapObj) {
            amClean.Maps['main'].mapObj.removeLayer(individualOL);
            TnetLog.log(LOG, 'Framework-Startup-OL-Layer entfernt (Ghost-Schutz):', sublayerKey);
          }
        } catch (e) { /* bereits entfernt */ }
      }

      var remaining = Object.keys(entry.registeredSublayers).length;
      TnetLog.log(LOG, 'Sublayer entfernt:', sublayerKey,
        '→ Root:', rootKey, '| verbleibend:', remaining);

      if (remaining === 0) {
        if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
        delete _rootServices[rootKey];

        TnetLog.log(LOG, '★ Root-Dienst deaktivieren:', rootKey);

        // OL-Layer frisch von der Map holen (gespeicherte Referenz kann veraltet sein
        // durch Framework ADD→REMOVE→ADD Race Condition beim Startup)
        var olLayer = _findFrameworkOLLayer(rootKey);
        if (olLayer) {
          try {
            var am = (window.njs && window.njs.AppManager) ? window.njs.AppManager : null;
            if (am && am.Maps && am.Maps['main'] && am.Maps['main'].mapObj) {
              am.Maps['main'].mapObj.removeLayer(olLayer);
              TnetLog.log(LOG, 'OL-Layer direkt entfernt:', rootKey);
            }
          } catch (e) { /* bereits entfernt */ }
        }

        // Framework-State-Cleanup (LyrMgr-Checkboxen, URL-Tracking)
        try {
          TnetLayerSwitch(rootKey, 'off');
        } catch (e) {
          TnetLog.error(LOG, 'TnetLayerSwitch OFF Fehler:', rootKey, e.message);
        }
      } else {
        this._updateLAYERSDebounced(rootKey);
      }

      _syncDojoCheckbox(sublayerKey, false);
      _scheduleUrlSync();
      return true;
    },

    /**
     * Versteckt einen Sublayer (Auge aus): entfernt aus LAYERS, bleibt registriert.
     * @param {string} sublayerKey
     */
    hideSublayer: function (sublayerKey) {
      var rootKey = _sublayerToRoot[sublayerKey];
      if (!rootKey) return;
      var entry = _rootServices[rootKey];
      if (!entry) return;

      delete entry.visibleSublayers[sublayerKey];
      this._updateLAYERSDebounced(rootKey);
      TnetLog.log(LOG, 'Sublayer versteckt:', sublayerKey);
    },

    /**
     * Zeigt einen Sublayer wieder an (Auge an): fügt in LAYERS ein.
     * @param {string} sublayerKey
     * @param {number} sublayerNum
     */
    showSublayer: function (sublayerKey, sublayerNum) {
      var rootKey = _sublayerToRoot[sublayerKey];
      if (!rootKey) return;
      var entry = _rootServices[rootKey];
      if (!entry) return;

      entry.visibleSublayers[sublayerKey] = sublayerNum;
      this._updateLAYERSDebounced(rootKey);
      TnetLog.log(LOG, 'Sublayer angezeigt:', sublayerKey, '#' + sublayerNum);
    },

    /**
     * Entfernt alle Sublayer einer Gruppe.
     * @param {string} rootKey
     * @param {Object} activeSublayers  { sublayerKey: sublayerNum }
     */
    unregisterGroup: function (rootKey, activeSublayers) {
      if (!_enabled) return;
      for (var lid in activeSublayers) {
        if (activeSublayers.hasOwnProperty(lid)) {
          this.unregisterSublayer(lid);
        }
      }
      TnetLog.log(LOG, 'Gruppe deregistriert:', rootKey);
    },

    /**
     * LAYERS-Parameter aktualisieren (debounced).
     * @param {string} rootKey
     * @private
     */
    _updateLAYERSDebounced: function (rootKey) {
      var entry = _rootServices[rootKey];
      if (!entry) return;
      if (entry.debounceTimer) clearTimeout(entry.debounceTimer);

      var delay = 80;
      try { delay = TnetGlobalConfig.get('layerManager.coalesceDebounceMs', 80); }
      catch (e) { /* default */ }

      var self = this;
      entry.debounceTimer = setTimeout(function () {
        entry.debounceTimer = null;
        self._applyLAYERSParam(rootKey);
      }, delay);
    },

    /**
     * Setzt den LAYERS-Parameter auf dem Framework-OL-Layer.
     * @param {string} rootKey
     * @private
     */
    _applyLAYERSParam: function (rootKey) {
      var entry = _rootServices[rootKey];
      if (!entry) return;
      var layersParam = _buildLayersParam(entry.visibleSublayers);
      TnetLog.log(LOG, 'LAYERS update:', rootKey, '→', layersParam);

      if (!entry.olLayer) entry.olLayer = _findFrameworkOLLayer(rootKey);

      if (!entry.olLayer) {
        var self = this;
        var retryCount = 0;
        var retryFn = function () {
          entry.olLayer = _findFrameworkOLLayer(rootKey);
          if (entry.olLayer) {
            self._setLayersOnSource(entry.olLayer, layersParam, rootKey);
          } else if (retryCount < 8) {
            retryCount++;
            TnetLog.debug(LOG, 'OL-Layer Retry', retryCount, 'für', rootKey);
            setTimeout(retryFn, 250 * retryCount);
          } else {
            TnetLog.warn(LOG, 'OL-Layer nicht gefunden nach 8 Retries:', rootKey);
          }
        };
        setTimeout(retryFn, 200);
        return;
      }
      this._setLayersOnSource(entry.olLayer, layersParam, rootKey);
    },

    /**
     * Setzt LAYERS auf der OL-Source.
     * @param {ol.layer.Layer} olLayer
     * @param {string} layersParam
     * @param {string} rootKey
     * @private
     */
    _setLayersOnSource: function (olLayer, layersParam, rootKey) {
      if (!olLayer) return;
      var src = olLayer.getSource();
      if (src && typeof src.updateParams === 'function') {
        src.updateParams({ LAYERS: layersParam });
        TnetLog.debug(LOG, 'OL-Source LAYERS gesetzt:', rootKey, '→', layersParam);
        // Karten-Render erzwingen — ohne expliziten Render-Zyklus zeigt OL
        // die neuen Tiles erst bei der nächsten User-Interaktion (Pan/Zoom)
        setTimeout(function () {
          try {
            var mapObj = njs.AppManager.Maps['main'].mapObj;
            if (mapObj && typeof mapObj.render === 'function') {
              mapObj.render();
            }
          } catch (e) { /* ignore */ }
        }, 100);
      } else {
        TnetLog.warn(LOG, 'OL-Source hat kein updateParams:', rootKey);
      }
    },

    /**
     * Öffentliche URL-Sync (für Store-Fallback wenn Bridge nicht aktiv).
     * Debounced mit 300ms wie die interne Variante.
     */
    scheduleUrlSync: function () {
      _scheduleUrlSync();
    },

    /**
     * Gibt den OL-Layer für einen Bridge-verwalteten Sublayer zurück.
     * @param {string} sublayerKey
     * @returns {ol.layer.Layer|null}
     */
    getOLLayerForSublayer: function (sublayerKey) {
      var rootKey = _sublayerToRoot[sublayerKey];
      if (!rootKey) return null;
      var entry = _rootServices[rootKey];
      if (!entry) return null;
      if (!entry.olLayer) entry.olLayer = _findFrameworkOLLayer(rootKey);
      return entry.olLayer || null;
    },

    /**
     * Gibt den Root-Key für einen Sublayer zurück.
     * @param {string} sublayerKey
     * @returns {string|null}
     */
    getRootKey: function (sublayerKey) {
      return _sublayerToRoot[sublayerKey] || _extractRootKey(sublayerKey) || null;
    },

    /**
     * Prüft ob ein Sublayer über die Bridge verwaltet wird.
     * @param {string} sublayerKey
     * @returns {boolean}
     */
    isManagedSublayer: function (sublayerKey) {
      return !!_sublayerToRoot[sublayerKey];
    },

    /**
     * Prüft ob ein Root-Dienst aktiv ist.
     * @param {string} rootKey
     * @returns {boolean}
     */
    isRootActive: function (rootKey) {
      return !!_rootServices[rootKey];
    },

    /**
     * Registriert MapTip-Callbacks für einen Standard-Coalesce-OL-Layer.
     * Wird als Fallback verwendet wenn Root-Dienst nicht verfügbar ist.
     * Der OL-Layer wurde bereits vom Standard-Coalesce-Pfad erstellt.
     * @param {string} sublayerKey   z.B. "gis_oereb/nw_nutzungsplanung_def/grundnutzung"
     * @param {ol.layer.Layer} olLayer  Standard-Coalesce OL-Layer
     * @param {number} sublayerNum   Sublayer-Nummer (z.B. 12)
     */
    patchMaptipForCoalesceLayer: function (sublayerKey, olLayer, sublayerNum) {
      if (!_enabled || !olLayer) return;
      var rootKey = _extractRootKey(sublayerKey);
      if (!rootKey) return;

      // Pseudo-Root-Service für MapTip-Callbacks erstellen/erweitern
      if (!_rootServices[rootKey]) {
        _rootServices[rootKey] = {
          olLayer: olLayer,
          registeredSublayers: {},
          visibleSublayers: {},
          debounceTimer: null,
          originalLAYERS: null,
          maptipOnly: true
        };
      }
      var entry = _rootServices[rootKey];
      if (!entry.olLayer) entry.olLayer = olLayer;
      _sublayerToRoot[sublayerKey] = rootKey;
      entry.registeredSublayers[sublayerKey] = sublayerNum;

      // lookupCallbacks + force-activate deferred registrieren
      setTimeout(function () {
        _registerLookupCallbacks(sublayerKey, rootKey);
        _forceActivateMaptip(sublayerKey, olLayer);
      }, 300);

      TnetLog.log(LOG, 'MapTip-Patch für Coalesce-Sublayer:', sublayerKey,
        '→ Root:', rootKey, '(#' + sublayerNum + ')');
    },

    /**
     * Entfernt MapTip-Callbacks für einen Standard-Coalesce-Sublayer.
     * @param {string} sublayerKey
     */
    unpatchMaptipForCoalesceLayer: function (sublayerKey) {
      var rootKey = _sublayerToRoot[sublayerKey];
      if (!rootKey) return;
      var entry = _rootServices[rootKey];
      if (!entry || !entry.maptipOnly) return;

      _unregisterLookupCallbacks(sublayerKey, rootKey);
      _forceDeactivateMaptip(sublayerKey);
      delete entry.registeredSublayers[sublayerKey];
      delete _sublayerToRoot[sublayerKey];

      if (Object.keys(entry.registeredSublayers).length === 0) {
        delete _rootServices[rootKey];
      }
      TnetLog.debug(LOG, 'MapTip-Unpatch für Coalesce-Sublayer:', sublayerKey);
    },

    /**
     * Stellt Coalesce-Layer aus dem URL-Parameter wieder her.
     * @param {Object} store  TnetLMStore-Instanz
     */
    restoreFromUrl: function (store) {
      if (!_enabled || !store) return;
      try {
        // Gesicherte URL-Layers verwenden — aktuelle URL kann bereits vom Framework
        // überschrieben sein (updateMapStatusUrl bei jedem moveend/loadend)
        var layersParam = _originalUrlLayers;
        if (!layersParam) {
          // Fallback: aktuelle URL (falls Sicherung fehlschlug)
          var url = new URL(window.location.href);
          layersParam = url.searchParams.get('layers') || '';
        }
        if (!layersParam) return;

        var layerIds = layersParam.split(/[|,]/);
        var restored = 0;
        for (var i = 0; i < layerIds.length; i++) {
          var lid = decodeURIComponent(layerIds[i]).trim();
          if (!lid) continue;
          var rootKey = _extractRootKey(lid);
          if (rootKey) {
            var layer = store.findLayer(lid);
            if (layer && !layer.visible) {
              store.setLayerVisible(lid, true);
              restored++;
            }
          }
        }
        if (restored > 0) {
          TnetLog.log(LOG, 'URL-Restore:', restored, 'Coalesce-Layer aus gesicherten URL-Params wiederhergestellt');
        }
      } catch (e) {
        TnetLog.warn(LOG, 'restoreFromUrl Fehler:', e.message);
      }
    },

    /**
     * Debug-Info.
     * @returns {Object}
     */
    getStatus: function () {
      var state = {};
      for (var rk in _rootServices) {
        if (!_rootServices.hasOwnProperty(rk)) continue;
        var e = _rootServices[rk];
        state[rk] = {
          olLayerFound: !!e.olLayer,
          maptipOnly: !!e.maptipOnly,
          registeredCount: Object.keys(e.registeredSublayers).length,
          visibleCount: Object.keys(e.visibleSublayers).length,
          registered: Object.assign({}, e.registeredSublayers),
          visible: Object.assign({}, e.visibleSublayers),
          originalLAYERS: e.originalLAYERS
        };
      }
      return {
        enabled: _enabled,
        maptipPatched: _maptipPatched,
        tnetLayerSwitchPatched: !!window._tnet_origTnetLayerSwitch,
        urlSyncPatched: !!(njs && njs.AppManager && njs.AppManager._tnet_origUpdateMapStatusUrl),
        rootServices: state,
        sublayerToRoot: Object.assign({}, _sublayerToRoot),
        hint: Object.keys(state).length === 0
          ? 'Keine Root-Dienste aktiv. Falls Standard-Coalesce läuft, werden MapTip-Callbacks über patchMaptipForCoalesceLayer registriert.'
          : null
      };
    }
  };

  window.TnetCoalesceBridge = Bridge;
})();
