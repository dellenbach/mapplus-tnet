/**
 * tnet-info-bridge.js
 * Standardisierte Bridge für Info-Abfragen (MapTip / GetFeatureInfo).
 *
 * Zentraler singleclick-Handler, der zu drei Adaptern delegiert:
 *   1. MapPlus-Adapter  — Framework MapTips (wmsActiveLyrs → queryconnector)
 *      Enthält SOWOHL Standard-TNET-Layers ALS AUCH Coalesce-Layers.
 *      TnetSyncMapTips und Coalesce-Bridge füllen wmsActiveLyrs unabhängig.
 *   2. WMS-Custom-Adapter — Benutzer-WMS aus dem WMS-Panel (_addedLayers)
 *
 * Eliminiert:
 *   - Doppelte Singleclick-Handler (Framework + WMS-Panel)
 *   - Doppel-Abfragen von Framework-Layern
 *   - Panel-Clearing Race-Condition
 *   - mask_layer / nicht-GFI-fähige Layer in GFI-Requests
 *
 * @version    2.0
 * @date       2026-03-06
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */
(function () {
  'use strict';

  var MODULE = 'InfoBridge';
  var MAP_ID = 'main';
  var GATE_KEY = '_disablewmsgetfeatureinfo';
  // Sentinel-Wert der verhindert, dass Frameworks Activate() den singleclick-Handler
  // erneut registriert. Muss truthy sein (Activate prüft: if (infoWMSListener == null)).
  var SENTINEL = '__bridge__';

  // ===== STATE =====
  var _initialized = false;
  var _bridgeListenerKey = null;
  var _frameworkHandlerRemoved = false;
  var _clickCount = 0;
  var _lastDispatchPixel = null;
  var _activeRequestSeq = 0;
  var _watchdogTimer = null;
  var _watchdogRetryTimer = null;
  var _sentinelIntervalId = null;

  // ===== HILFSFUNKTIONEN =====

  function _getAm() {
    return window.njs && njs.AppManager;
  }

  function _log() {
    var args = ['[' + MODULE + ']'].concat(Array.prototype.slice.call(arguments));
    if (window.TnetLog && typeof TnetLog.log === 'function') {
      TnetLog.log.apply(TnetLog, args);
    } else {
      console.log.apply(console, args);
    }
  }

  function _warn() {
    var args = ['[' + MODULE + ']'].concat(Array.prototype.slice.call(arguments));
    if (window.TnetLog && typeof TnetLog.warn === 'function') {
      TnetLog.warn.apply(TnetLog, args);
    } else {
      console.warn.apply(console, args);
    }
  }

  function _ensureInfoPaneDom() {
    var pane = document.getElementById('njs_info_pane');
    var widget = null;
    if (typeof dijit !== 'undefined' && dijit.byId) {
      widget = dijit.byId('njs_info_pane');
    }

    if (widget && !widget._tnetNonDestructiveClosePatched && typeof widget.close === 'function') {
      var originalClose = widget.close;
      widget.close = function() {
        var node = widget.domNode || document.getElementById('njs_info_pane');
        if (node) {
          node.style.visibility = 'hidden';
          return;
        }
        return originalClose.apply(widget, arguments);
      };
      widget._tnetNonDestructiveClosePatched = true;
    }

    // Falls Dojo den Pane-Knoten vom DOM getrennt hat: wieder einhaengen.
    if (!pane && widget && widget.domNode) {
      pane = widget.domNode;
      if (!pane.parentNode) {
        document.body.appendChild(pane);
      }
    }

    if (!pane) return;

    var content = document.getElementById('njs_info_pane_content');
    if (!content) {
      content = document.createElement('div');
      content.id = 'njs_info_pane_content';
      pane.appendChild(content);
    }
  }

  function _forEachMapLayer(collection, callback) {
    if (!collection || typeof collection.forEach !== 'function') return;
    collection.forEach(function (layer) {
      if (!layer) return;
      if (layer.getLayers && typeof layer.getLayers === 'function') {
        _forEachMapLayer(layer.getLayers(), callback);
        return;
      }
      callback(layer);
    });
  }

  function _getLayerName(layer) {
    return layer && typeof layer.get === 'function' ? (layer.get('name') || '') : '';
  }

  function _getLayerParams(layer) {
    var src = layer && typeof layer.getSource === 'function' ? layer.getSource() : null;
    return src && typeof src.getParams === 'function' ? src.getParams() : null;
  }

  function _findMapTipLayer(map, linkedLayerId, queryLayers) {
    var exact = null;
    var host = null;
    var servicePrefix = linkedLayerId && linkedLayerId.lastIndexOf('/') > 0
      ? linkedLayerId.substring(0, linkedLayerId.lastIndexOf('/') + 1)
      : '';
    var queryNum = queryLayers != null ? String(queryLayers).split(',')[0] : '';

    _forEachMapLayer(map.getLayers(), function (layer) {
      if (exact) return;
      var name = _getLayerName(layer);
      if (name === linkedLayerId) {
        exact = layer;
        return;
      }
      if (!host && servicePrefix && name.indexOf(servicePrefix) === 0) {
        var params = _getLayerParams(layer);
        var layersParam = params && (params.LAYERS || params.layers) || '';
        if (!queryNum || layersParam.indexOf('show:' + queryNum) >= 0 || layersParam.indexOf(',' + queryNum) >= 0 || layersParam.indexOf('show:') === 0) {
          host = layer;
        }
      }
    });

    return exact || host;
  }

  // Liefert die gerenderte show:-Sublayer-Liste eines sichtbaren kombinierten
  // OL-Layers (Name == serviceId) als String-Array, oder null wenn nicht gefunden.
  // Das ist die Wahrheit fuer den Karteninhalt: nur diese Sublayer-Nummern
  // sind aktuell auf der Karte sichtbar.
  function _getServiceShowList(map, serviceId) {
    if (!map || !serviceId) return null;
    var result = null;
    _forEachMapLayer(map.getLayers(), function (layer) {
      if (result) return;
      var name = _getLayerName(layer);
      if (name !== serviceId) return;
      if (typeof layer.getVisible === 'function' && !layer.getVisible()) return;
      var params = _getLayerParams(layer);
      var layersParam = params && (params.LAYERS || params.layers) || '';
      if (typeof layersParam === 'string' && layersParam) {
        result = layersParam.replace(/^show:/i, '').split(',').map(function (v) { return v.trim(); });
      }
    });
    return result;
  }

  function _isMapTipVisible(mt, map) {
    var linkedLayerId = mt.linked_layer_id || mt.linked_layer || '';
    if (!linkedLayerId) return false;

    var store = window.TnetLMStore;

    // Wenn Store geladen: AUSSCHLIESSLICH ueber isLayerQueryable filtern.
    // Kein Fallback auf OL-Sichtbarkeit — das Dojo-Framework haelt viele
    // Layer im Hintergrund sichtbar die der User nicht aktiviert hat.
    if (store && store.isLoaded && store.isLoaded()) {
      // Sublayer-genaue Pruefung fuer Service-/Coalesce-MapTips:
      // Viele MapTips sind auf SERVICE-Ebene verschluesselt (linked_layer = Dienst,
      // query_layers = Sublayer-Nummer 0..N). isLayerQueryable(Dienst) ist true,
      // sobald IRGENDEIN Sublayer aktiv ist → sonst wuerden ALLE Sublayer abgefragt.
      // Die gerenderte show:-Liste des kombinierten OL-Layers ist die Wahrheit fuer
      // den Karteninhalt: nur Sublayer deren Nummer dort steht sind abfragbar.
      var ql = mt.query_layers != null ? String(mt.query_layers).split(',')[0].trim() : '';
      if (ql !== '') {
        var showList = _getServiceShowList(map, linkedLayerId);
        if (showList) {
          return showList.indexOf(ql) >= 0;
        }
      }
      if (typeof store.isLayerQueryable === 'function') {
        return !!store.isLayerQueryable(linkedLayerId);
      }
      // Fallback nur wenn isLayerQueryable noch nicht verfuegbar (Compat)
      if (typeof store.isRenderableLayerId === 'function' &&
          store.isRenderableLayerId(linkedLayerId) &&
          typeof store.isLayerEffectivelyVisible === 'function') {
        return !!store.isLayerEffectivelyVisible(linkedLayerId);
      }
      // Store geladen, Layer nicht im Katalog oder nicht aktiviert
      return false;
    }

    // Store noch nicht bereit (Startup-Phase): OL-Layer direkt pruefen
    var olLayer = mt.wms_layer || _findMapTipLayer(map, linkedLayerId, mt.query_layers);
    if (olLayer && typeof olLayer.getVisible === 'function') return !!olLayer.getVisible();

    try {
      var fwLayer = njs.AppManager.getLayerByMap(mt.idmap || MAP_ID, linkedLayerId);
      if (fwLayer && fwLayer._lyr && fwLayer._lyr.getVisible) return !!fwLayer._lyr.getVisible();
    } catch (e) { /* ignore */ }

    return false;
  }

  function _syncMapTipsBeforeDispatch(map) {
    var am = _getAm();
    if (!am || !am.MapTips || !am.wmsActiveLyrs || !map) return;

    if (typeof window.TnetSyncMapTips === 'function') {
      try { window.TnetSyncMapTips(); } catch (eSync) { _warn('TnetSyncMapTips vor Info-Abfrage fehlgeschlagen:', eSync.message); }
    }

    var activated = 0;
    var deactivated = 0;
    for (var mtId in am.MapTips) {
      if (!am.MapTips.hasOwnProperty(mtId)) continue;
      if (mtId === '_wms_connector' || mtId === GATE_KEY) continue;

      var mt = am.MapTips[mtId];
      if (!mt) continue;
      if (!mt.linked_layer_id && mt.linked_layer) mt.linked_layer_id = mt.linked_layer;
      if (!mt.linked_layer_id) continue;

      var shouldBeActive = _isMapTipVisible(mt, map);
      if (shouldBeActive) {
        var hostLayer = mt.wms_layer || _findMapTipLayer(map, mt.linked_layer_id, mt.query_layers);
        if (hostLayer && !mt.wms_layer && !mt.url) mt.wms_layer = hostLayer;
        if (!mt.active) {
          am.wmsActiveLyrs.push(mt);
          mt.active = true;
          activated++;
        }
      } else if (mt.active) {
        am.wmsActiveLyrs.remove(mt);
        mt.active = false;
        deactivated++;
      }
    }

    if (window.TNET_DEBUG_INFO && (activated || deactivated)) {
      console.log('[InfoBridge DEBUG] MapTips sync vor Dispatch: +' + activated + ' -' + deactivated);
    }
  }

  // ===== FRAMEWORK-HANDLER MANAGEMENT =====

  /**
   * Entfernt den Framework-eigenen singleclick-Handler (infoWMSHandler)
   * und setzt den Sentinel, damit Activate() keinen neuen registriert.
   *
   * KRITISCH: Nach dem Entfernen MUSS infoWMSListener auf den Sentinel
   * gesetzt werden (NICHT null!), weil:
   *   - Coalesce-Bridge kann _forceActivateMaptip() aufrufen
   *   - Das Frameworks Activate() wird für neue MapTips aufgerufen
   *   - Activate() prüft: if (infoWMSListener == null) → registriert Handler
   *   - Mit null: → doppelter Handler! Mit Sentinel: → kein neuer Handler.
   */
  function _removeFrameworkHandler() {
    if (_frameworkHandlerRemoved) return;
    var am = _getAm();
    if (!am) return;

    // Variante 1: Listener-Key existiert → Handler aktiv entfernen
    if (am.infoWMSListener && am.infoWMSListener !== SENTINEL) {
      try {
        ol.Observable.unByKey(am.infoWMSListener);
        _log('Framework infoWMSListener entfernt (ol.Observable.unByKey)');
      } catch (e) {
        _warn('Fehler beim Entfernen des Framework-Listeners:', e);
      }
    }

    // IMMER den Sentinel setzen — verhindert erneute Registrierung durch Activate()
    am.infoWMSListener = SENTINEL;
    _frameworkHandlerRemoved = true;
  }

  /**
   * Periodische Prüfung: Falls Framework Activate() den Sentinel überschrieben hat
   * (unwahrscheinlich, aber denkbar), setze ihn erneut.
   */
  function _ensureSentinel() {
    var am = _getAm();
    if (!am || !_initialized) return;
    if (am.infoWMSListener && am.infoWMSListener !== SENTINEL) {
      _warn('Framework-Handler wurde erneut registriert! Entferne und setze Sentinel neu.');
      try {
        ol.Observable.unByKey(am.infoWMSListener);
      } catch (e) { /* ignore */ }
      am.infoWMSListener = SENTINEL;
    }
  }

  // ===== NO-RESULTS WATCHDOG =====

  /**
   * Prüft nach Timeout ob Ergebnisse im Info-Panel vorhanden sind.
   * Falls nicht, zeigt "Keine Objekte gefunden".
   * Integriert mit dem Framework: prüft auch infoRequestsPending.
   */
  function _clearNoResultsArtifacts(container) {
    if (!container) return;

    var markers = container.querySelectorAll('.noInfoResults, .njs-info-no-results, #njs_info_pane_content_disc');
    for (var i = 0; i < markers.length; i++) {
      markers[i].remove();
    }

    // Legacy-Faelle: lose Textknoten mit "Keine ..." entfernen.
    var children = container.childNodes;
    for (var n = children.length - 1; n >= 0; n--) {
      var node = children[n];
      if (node && node.nodeType === 3 && node.textContent && node.textContent.indexOf('Keine') > -1) {
        container.removeChild(node);
      }
    }
  }

  function _cancelNoResultsWatchdog() {
    if (_watchdogTimer) {
      clearTimeout(_watchdogTimer);
      _watchdogTimer = null;
    }
    if (_watchdogRetryTimer) {
      clearTimeout(_watchdogRetryTimer);
      _watchdogRetryTimer = null;
    }
  }

  function _startNoResultsWatchdog(requestSeq, totalDispatched) {
    _cancelNoResultsWatchdog();

    var initialDelay = totalDispatched > 0 ? 5000 : 1400;
    _watchdogTimer = setTimeout(function () {
      if (requestSeq !== _activeRequestSeq) return;

      var container = document.getElementById('njs_info_pane_content');
      if (!container) return;

      // Spinner ausblenden
      var spinner = document.getElementById('infowin_wait');
      if (spinner) spinner.style.display = 'none';

      // Framework hat noch laufende Requests → noch warten
      var am = _getAm();
      if (am && am.infoRequestsPending && am.infoRequestsPending > 0) {
        // Nochmal 3s warten
        _watchdogRetryTimer = setTimeout(function () {
          if (requestSeq !== _activeRequestSeq) return;
          var spinner2 = document.getElementById('infowin_wait');
          if (spinner2) spinner2.style.display = 'none';
        }, 3000);
        return;
      }

      // Prüfe ob bereits Ergebnisse vorhanden
      var hasResults = container.querySelector('.dijitTitlePane') ||
                       container.querySelector('.wms-gfi-result');
      if (hasResults) return;

      // Prüfe ob "Keine Ergebnisse" bereits vorhanden
        if (container.querySelector('.noInfoResults') ||
          container.querySelector('.njs-info-no-results') ||
          container.querySelector('#njs_info_pane_content_disc')) return;

      // Keine Ergebnisse → Meldung anzeigen
      var noResultsText = (am && am.nls && am.nls.maptipsResources && am.nls.maptipsResources['general_noresults'])
        ? am.nls.maptipsResources['general_noresults']
        : 'Keine Objekte gefunden';

      var node = document.createElement('div');
      node.id = 'njs_info_pane_content_disc';
      node.className = 'infoWindowMsg noInfoResults';
      node.textContent = noResultsText;
      container.appendChild(node);
      _log('Keine Ergebnisse → Meldung angezeigt');
    }, initialDelay);
  }

  // ===== ADAPTER 1: MAPPLUS (Standard + Coalesce) =====

  /**
   * Dispatcht Info-Abfragen über das Framework MapTip-System.
   *
   * Iteriert wmsActiveLyrs und ruft queryconnector() auf jedem aktiven MapTip.
   * Das Framework schreibt seine Ergebnisse selbst in #njs_info_pane_content.
   *
   * wmsActiveLyrs enthält BEIDE Typen:
   *   - Standard-MapTips: von TnetSyncMapTips eingefügt (linked_layer sichtbar)
   *   - Coalesce-MapTips: von _forceActivateMaptip() eingefügt
   *
   * Die Bridge unterscheidet NICHT zwischen Coalesce und Standard — sie dispatcht
   * einfach alles was in wmsActiveLyrs steht. Die Verantwortung für das korrekte
   * Befüllen liegt bei TnetSyncMapTips (Standard) und Coalesce-Bridge (Coalesce).
   */
  function _adapterMapPlus(evt) {
    var am = _getAm();
    if (!am || !am.wmsActiveLyrs) return 0;
    var store = window.TnetLMStore;
    var dispatchMap = am.Maps && am.Maps[MAP_ID] ? am.Maps[MAP_ID].mapObj : null;

    var count = 0;
    var items = am.wmsActiveLyrs.getArray();
    var dispatched = []; // Für Log
    var _seenTargets = {}; // Dedup: serviceId::subNum bereits dispatcht

    for (var i = 0; i < items.length; i++) {
      var mt = items[i];
      if (!mt || !mt.active) continue;
      var mtLinkedId = mt.linked_layer_id || mt.linked_layer || mt.id || '';

      // Sublayer-genaue Filterung direkt im Dispatch (letzte Instanz):
      // Das Framework re-aktiviert nach _syncMapTipsBeforeDispatch teils alle
      // Service-Sublayer-MapTips. _isMapTipVisible prueft fuer Service-/Coalesce-
      // MapTips die gerenderte show:-Liste → nur Sublayer im Karteninhalt werden
      // abgefragt. Liefert saubere, gefilterte Resultate.
      if (store && store.isLoaded && store.isLoaded() && dispatchMap) {
        if (!_isMapTipVisible(mt, dispatchMap)) {
          if (window.TNET_DEBUG_INFO) {
            console.log('[InfoBridge DEBUG] skip maptip nicht im Karteninhalt:', mtLinkedId, 'ql:', mt.query_layers);
          }
          continue;
        }

        // Dedup: dasselbe Sublayer-Ziel kann sowohl ueber einen Service-MapTip
        // (linked = Dienst) als auch ueber einen Child-MapTip (linked = Sublayer)
        // aktiv sein. Beide treffen denselben Dienst + dieselbe Sublayer-Nummer
        // → nur EINMAL abfragen, sonst doppelte Ergebnis-Eintraege.
        var _ql = mt.query_layers != null ? String(mt.query_layers).split(',')[0].trim() : '';
        if (_ql !== '' && mtLinkedId) {
          var _svc = mtLinkedId;
          if (!_getServiceShowList(dispatchMap, mtLinkedId)) {
            var _slash = mtLinkedId.lastIndexOf('/');
            if (_slash > 0) _svc = mtLinkedId.substring(0, _slash);
          }
          var _key = _svc + '::' + _ql;
          if (_seenTargets[_key]) {
            if (window.TNET_DEBUG_INFO) {
              console.log('[InfoBridge DEBUG] skip Duplikat-Ziel:', _key, 'via', mtLinkedId);
            }
            continue;
          }
          _seenTargets[_key] = true;
        }
      }

      if (typeof mt.queryconnector !== 'function') {
        _warn('MapTip ohne queryconnector:', mtLinkedId || mt.id);
        continue;
      }

      // Guard: queryconnector ohne host/url fuehrt bei einzelnen Legacy-MapTips
      // zu Runtime-Fehlern (null-Zugriffe). Diese Eintraege bewusst ueberspringen,
      // damit valide Layer-Abfragen (z.B. Coalesce-Sublayer) nicht beeinflusst werden.
      if (!mt.wms_layer && !mt.url) {
        try {
          var fwLayerForGuard = njs.AppManager.getLayerByMap(mt.idmap || MAP_ID, mtLinkedId);
          if (!fwLayerForGuard || !fwLayerForGuard._lyr) {
            if (window.TNET_DEBUG_INFO) {
              console.log('[InfoBridge DEBUG] skip maptip without host/url:', mtLinkedId);
            }
            continue;
          }
        } catch (eGuard) {
          continue;
        }
      }

      if (!mt.query_layers && mtLinkedId.indexOf('/') > -1 && mtLinkedId.indexOf('wms:') !== 0) {
        // Ohne query_layers sind ArcGIS-Coalesce-Sublayer nicht eindeutig.
        // Solche Eintraege werden weiterhin zugelassen wenn sie eine direkte URL haben.
        if (!mt.url && window.TNET_DEBUG_INFO) {
          console.log('[InfoBridge DEBUG] maptip ohne query_layers (weiter mit Vorsicht):', mtLinkedId);
        }
      }

      if (typeof mt.queryconnector !== 'function') {
        _warn('MapTip ohne queryconnector:', mtLinkedId || mt.id);
        continue;
      }

      // ── Pre-Flight Diagnose: URL-Pfad loggen den queryconnector nehmen wird ──
      var urlPath = '(unbekannt)';
      var layerSource = '?';
      var parentMatch = mt._tnetParentMatch || null;
      var diag = {
        mt_url: mt.url || null,
        mt_params: mt.params ? Object.keys(mt.params).join(',') : null,
        mt_querytype: mt.querytype || null,
        wms_visible: null,
        wms_source_url: null,
        wms_source_params: null,
        fw_visible: null,
        fw_source_url: null,
        fw_source_params: null,
        map_res: null,
        mt_minRes: mt.minResolution || null,
        mt_maxRes: mt.maxResolution || null
      };
      try {
        var _am = _getAm();
        if (_am && _am.Maps && _am.Maps['main']) {
          diag.map_res = _am.Maps['main'].mapObj.getView().getResolution();
        }
        if (mt.wms_layer) {
          layerSource = parentMatch ? 'wms_layer(prefix:' + parentMatch + ')' : 'wms_layer';
          if (mt.wms_layer.getVisible) diag.wms_visible = mt.wms_layer.getVisible();
          if (mt.wms_layer.getSource && typeof mt.wms_layer.getSource === 'function') {
            var src = mt.wms_layer.getSource();
            if (src) {
              diag.wms_source_url = (typeof src.getUrl === 'function') ? src.getUrl() : null;
              if (typeof src.getParams === 'function') {
                var p = src.getParams();
                diag.wms_source_params = p ? JSON.stringify(p) : null;
              }
              urlPath = diag.wms_source_url ? diag.wms_source_url.substring(0, 100) : '(kein url)';
            }
          }
        } else {
          layerSource = 'getLayerByMap';
          var fwLayer = njs.AppManager.getLayerByMap(mt.idmap || 'main', mt.linked_layer_id);
          if (fwLayer && fwLayer._lyr) {
            if (fwLayer._lyr.getVisible) diag.fw_visible = fwLayer._lyr.getVisible();
            var fwSrc = fwLayer._lyr.getSource ? fwLayer._lyr.getSource() : null;
            if (fwSrc) {
              diag.fw_source_url = (typeof fwSrc.getUrl === 'function') ? fwSrc.getUrl() : null;
              if (typeof fwSrc.getParams === 'function') {
                var fp = fwSrc.getParams();
                diag.fw_source_params = fp ? JSON.stringify(fp) : null;
              }
              urlPath = diag.fw_source_url ? diag.fw_source_url.substring(0, 100) : '(kein url)';
            }
          } else {
            urlPath = fwLayer ? '(kein _lyr)' : '(NICHT GEFUNDEN!)';
          }
        }
      } catch (preErr) {
        urlPath = '(pre-flight Fehler: ' + preErr.message + ')';
      }

      // Debug-Flag: window.TNET_DEBUG_INFO = true aktiviert detailliertes Logging
      if (window.TNET_DEBUG_INFO) {
        console.log('[InfoBridge DEBUG]', mtLinkedId, 'ql:', mt.query_layers, 'src:', layerSource, diag);
      }

      try {
        mt.queryconnector(evt);
        count++;
        dispatched.push({
          id: mtLinkedId,
          type: mt.querytype || 'default',
          source: layerSource,
          url: urlPath,
          queryLayers: mt.query_layers || '?'
        });
      } catch (e) {
        _warn('queryconnector Fehler für', mtLinkedId, ':', e.message,
              '| source:', layerSource, '| url:', urlPath);
      }
    }

    // Detailliertes Log beim ersten Klick und dann alle 5 Klicks
    if (_clickCount <= 3 || _clickCount % 5 === 0) {
      _log('wmsActiveLyrs Inhalt (' + items.length + ' Einträge, ' + count + ' dispatcht):');
      for (var d = 0; d < dispatched.length; d++) {
        var di = dispatched[d];
        _log('  ' + (d + 1) + '. ' + di.id + ' [' + di.type + '] via:' + di.source +
             ' ql:' + di.queryLayers + ' url:' + di.url);
      }
    }

    return count;
  }

  // ===== ADAPTER 2: WMS-CUSTOM (Benutzer-WMS aus Panel) =====

  /**
   * Dispatcht GFI-Abfragen für Custom-WMS-Layer (vom Benutzer hinzugefügt).
   * Nutzt die exportierte Query-Methode des WMS-Panels.
   */
  function _adapterWmsCustom(evt, map) {
    if (!window.TnetWmsPanel || typeof TnetWmsPanel.queryCustomLayers !== 'function') {
      return 0;
    }

    var customs = TnetWmsPanel.getVisibleCustomLayers();
    if (!customs || customs.length === 0) return 0;

    _log('WMS-Custom:', customs.length, 'Layer →',
      customs.map(function (c) { return c.title; }).join(', '));

    TnetWmsPanel.queryCustomLayers(evt, customs, map);
    return customs.length;
  }

  // ===== ZENTRALER SINGLECLICK-HANDLER =====

  function _handleClick(evt) {
    var am = _getAm();
    if (!am || !am.Maps || !am.Maps[MAP_ID]) return;

    var map = am.Maps[MAP_ID].mapObj;
    if (!map) return;

    _clickCount++;
    _activeRequestSeq++;
    var currentRequestSeq = _activeRequestSeq;

    // ── Sicherheitsprüfung: Framework-Handler nicht erneut registriert? ──
    _ensureSentinel();

    // ── Tool-Exklusivität: Anderes Tool aktiv? ──
    // Nur ein Tool darf gleichzeitig Klick-Queries auslösen.
    // ÖREB-Modus, Polygon-Zeichnen und Framework-Tools haben Vorrang.
    if (window.isOerebActive) {
      _log('Click #' + _clickCount + ': ÖREB-Modus aktiv → MapTip blockiert');
      return;
    }
    if (window.isPolygonDrawing) {
      _log('Click #' + _clickCount + ': Polygon-Zeichnen aktiv → MapTip blockiert');
      return;
    }

    // ── Gate-Check: Mess-/Zeichen-/Druck-Tool aktiv? ──
    try {
      if (am.MapTips && am.MapTips[GATE_KEY] && am.MapTips[GATE_KEY][MAP_ID] === true) {
        var customCount = _adapterWmsCustom(evt, map);
        if (customCount > 0) {
          _log('Click #' + _clickCount + ': GFI blockiert, aber', customCount, 'Custom-WMS abgefragt');
        } else {
          _log('Click #' + _clickCount + ': GFI blockiert durch Tool → Abbruch');
        }
        return;
      }
    } catch (e) { /* Gate-Check fehlgeschlagen → weiter */ }

    // ── Feature-at-Pixel Check ──
    // Blockiert Klicks auf interaktive Vektor-Features (Redlining etc.)
    // AUSNAHME: Zeichenlayer der räumlichen Abfrage, Messungen und PDF-Extent sollen NICHT blockieren
    // AUSNAHME: GeoJSON-Layer mit registriertem gjsonServiceMapTip → direkt behandeln
    var isRepeatPixelClick = false;
    if (evt && evt.pixel && _lastDispatchPixel) {
      var dx = Math.abs(evt.pixel[0] - _lastDispatchPixel[0]);
      var dy = Math.abs(evt.pixel[1] - _lastDispatchPixel[1]);
      isRepeatPixelClick = (dx <= 3 && dy <= 3);
    }

    var hasBlockingFeature = false;
    try {
      if (map.hasFeatureAtPixel(evt.pixel) === true) {
        map.forEachFeatureAtPixel(evt.pixel, function (feature, layer) {
          if (!layer) return;
          var name = layer.get('name') || '';
          // Layer ohne Namen ignorieren (z.B. MapTip-Highlight-Vektor-Layer)
          if (!name) return;
          // Kosmetische Layer ignorieren
          if (name === 'cosmetic_maptip' || name === 'cosmetic_search' || name.indexOf('cosmetic_') === 0) return;
          // Framework-interne Layer ignorieren (Messungen, PDF-Extent, Select-Tools)
          if (name.indexOf('njs_') === 0 || name.indexOf('pdfExtent') === 0) return;
          // Räumliche-Abfrage-Zeichenlayer ignorieren
          if (name === 'spatial_query_draw' || name === 'tnet_spatial_query') return;
          // GeoJSON-Maptip-Layer: nicht blockieren, sondern direkt showInfoBubble aufrufen
          if (am.MapTips) {
            for (var _mtId in am.MapTips) {
              var _mt = am.MapTips[_mtId];
              if (_mt && _mt.linked_layer_id === name && typeof _mt.showInfoBubble === 'function') {
                _log('Click #' + _clickCount + ': gjsonServiceMapTip-Layer "' + name + '" → showInfoBubble');
                // Overlay/Popup initialisieren falls noch nicht geschehen
                if (!am.infoOverlay) {
                  var _popupContainer = document.getElementById('popup');
                  var _popupCloser = document.getElementById('popup-closer');
                  if (_popupContainer && _popupCloser) {
                    am.infoPopupContainer = _popupContainer;
                    am.infoPopupContent = document.getElementById('popup-content');
                    am.infoPopupCloser = _popupCloser;
                    am.infoOverlay = new ol.Overlay({
                      element: _popupContainer,
                      autoPan: true,
                      autoPanAnimation: { duration: 250 }
                    });
                    map.addOverlay(am.infoOverlay);
                    _popupCloser.onclick = function () {
                      am.infoOverlay.setPosition(undefined);
                      _popupCloser.blur();
                      document.getElementById('popup').style.display = 'none';
                      return false;
                    };
                  }
                }
                _mt.showInfoBubble(feature);
                // Popup sichtbar machen und positionieren
                var popupEl = document.getElementById('popup');
                if (popupEl) popupEl.style.display = '';
                if (am.infoOverlay) am.infoOverlay.setPosition(evt.coordinate);
                return; // forEachFeatureAtPixel-Callback verlassen (Layer gefunden)
              }
            }
          }
          // Alles andere blockiert
          hasBlockingFeature = true;
          _log('Click #' + _clickCount + ': blockierender Layer: "' + name + '"');
        });
      }
    } catch (e) { /* Ignorieren */ }

    if (hasBlockingFeature && !isRepeatPixelClick) {
      _log('Click #' + _clickCount + ': Feature-at-Pixel blockiert Info-Abfrage');
      return;
    }
    if (hasBlockingFeature && isRepeatPixelClick) {
      _log('Click #' + _clickCount + ': Feature-at-Pixel erkannt, aber Repeat-Click am selben Pixel → Info-Abfrage erlaubt');
    }

    // ── Panel vorbereiten (Framework-Funktion, EINMAL) ──
    _ensureInfoPaneDom();
    var infoContainer = document.getElementById('njs_info_pane_content');
    _clearNoResultsArtifacts(infoContainer);

    try {
      if (typeof am.prepareInfoRequest === 'function') {
        am.prepareInfoRequest(evt, MAP_ID);
      }
    } catch (e) {
      _warn('prepareInfoRequest Fehler:', e);
    }

    // Pending-Visibility-Updates sofort flushen (Debounce ueberspringen).
    // Der UI-Toggle (child-eye / group-eye) schreibt in einen Debounce-Queue
    // (VISIBILITY_FLUSH_DELAY). Wenn der Nutzer direkt nach dem Toggle auf die
    // Karte klickt, ist der Flush evtl. noch nicht gelaufen → Store hat noch
    // den alten Sichtbarkeitszustand → isLayerQueryable gibt false zurueck.
    if (window.TnetLMActive && typeof window.TnetLMActive.flushPendingVisibility === 'function') {
      try { window.TnetLMActive.flushPendingVisibility(); } catch (eFlush) { /* ignore */ }
    }

    // Direkt vor dem Dispatch mit dem effektiven Karteninhalt synchronisieren.
    // wmsActiveLyrs ist Framework-State und kann nach Coalesce-/Store-Toggles
    // stale sein: ausgeschaltete Layer bleiben aktiv oder sichtbare Sublayer
    // fehlen. Die Info-Abfrage darf nur sichtbare Runtime-Layer verwenden.
    _syncMapTipsBeforeDispatch(map);

    // ── Adapter dispatchen ──
    var mapPlusCount = _adapterMapPlus(evt);
    var wmsCustomCount = _adapterWmsCustom(evt, map);
    var totalCount = mapPlusCount + wmsCustomCount;

    if (evt && evt.pixel) {
      _lastDispatchPixel = [evt.pixel[0], evt.pixel[1]];
    }

    _log('Click #' + _clickCount + ': Dispatch', totalCount, 'Queries',
      '(MapPlus:', mapPlusCount, '| WMS-Custom:', wmsCustomCount + ')');

    // ── No-Results Watchdog ──
    _startNoResultsWatchdog(currentRequestSeq, totalCount);
  }

  // ===== INITIALISIERUNG =====

  function init() {
    if (_initialized) return;

    var am = _getAm();
    if (!am || !am.Maps || !am.Maps[MAP_ID] || !am.Maps[MAP_ID].mapObj) {
      return false;
    }

    var map = am.Maps[MAP_ID].mapObj;

    // 1. Framework-Handler entfernen + Sentinel setzen
    _removeFrameworkHandler();

    // 2. WMS-Panel: eigenen singleclick-Handler deaktivieren (Flag)
    window._tnetInfoBridgeActive = true;

    // 3. Bridge-Handler registrieren
    _bridgeListenerKey = map.on('singleclick', _handleClick);

    _initialized = true;

    // Diagnostik: Was ist aktuell in wmsActiveLyrs?
    var activeCount = am.wmsActiveLyrs ? am.wmsActiveLyrs.getLength() : 0;
    var activeIds = [];
    if (am.wmsActiveLyrs && activeCount > 0) {
      am.wmsActiveLyrs.getArray().forEach(function (mt) {
        activeIds.push(mt.linked_layer_id || mt.id || '?');
      });
    }

    // Diagnostik: Wieviele MapTips definiert?
    var totalMaptips = 0;
    for (var k in am.MapTips) {
      if (am.MapTips.hasOwnProperty(k) && k !== '_wms_connector' && k !== GATE_KEY) {
        totalMaptips++;
      }
    }

    _log('=== Initialisiert ===');
    _log('  Framework-Handler: Sentinel gesetzt');
    _log('  WMS-Panel-Handler: deaktiviert (Flag)');
    _log('  Bridge singleclick: registriert');
    _log('  MapTips definiert:', totalMaptips);
    _log('  wmsActiveLyrs:', activeCount, '→', activeIds.join(', '));

    // 4. Periodische Sentinel-Prüfung dauerhaft aktiv halten.
    // Das Framework kann den Handler auch lange nach dem Startup erneut
    // registrieren (z.B. bei späteren Activate-Pfaden). Deshalb nicht nach
    // 2 Minuten stoppen, sondern bis destroy() überwachen.
    if (_sentinelIntervalId) {
      clearInterval(_sentinelIntervalId);
      _sentinelIntervalId = null;
    }
    _sentinelIntervalId = setInterval(function () {
      _ensureSentinel();
    }, 5000);

    return true;
  }

  function destroy() {
    _cancelNoResultsWatchdog();

    if (_sentinelIntervalId) {
      clearInterval(_sentinelIntervalId);
      _sentinelIntervalId = null;
    }

    if (_bridgeListenerKey) {
      ol.Observable.unByKey(_bridgeListenerKey);
      _bridgeListenerKey = null;
    }
    window._tnetInfoBridgeActive = false;
    _initialized = false;
    _frameworkHandlerRemoved = false;
    _log('Deinitialisiert');
  }

  // ===== DIAGNOSE-EXPORT =====

  /**
   * Gibt eine Übersicht über den aktuellen Zustand aus.
   * Aufruf: TnetInfoBridge.diagnose()
   */
  function diagnose() {
    var am = _getAm();
    if (!am) { console.log('[InfoBridge] AppManager nicht verfügbar'); return; }

    console.group('[InfoBridge] Diagnose');
    console.log('Bridge aktiv:', _initialized);
    console.log('Sentinel:', am.infoWMSListener === SENTINEL ? 'OK (__bridge__)' : 'WARNUNG: ' + am.infoWMSListener);
    console.log('_tnetInfoBridgeActive:', !!window._tnetInfoBridgeActive);
    console.log('Gate (_disablewmsgetfeatureinfo):', am.MapTips && am.MapTips[GATE_KEY] ? am.MapTips[GATE_KEY][MAP_ID] : 'n/a');
    console.log('Tool-Exklusivität: ÖREB=' + !!window.isOerebActive + ' Polygon=' + !!window.isPolygonDrawing);

    // wmsActiveLyrs Dump
    var items = am.wmsActiveLyrs ? am.wmsActiveLyrs.getArray() : [];
    console.group('wmsActiveLyrs: ' + items.length + ' Einträge');
    for (var i = 0; i < items.length; i++) {
      var mt = items[i];
      console.log((i + 1) + '.', mt.linked_layer_id || mt.id || '?',
        '| active:', mt.active,
        '| querytype:', mt.querytype || 'default',
        '| wms_layer:', !!mt.wms_layer,
        '| url:', mt.url ? mt.url.substring(0, 80) : '(kein)');
    }
    console.groupEnd();

    // Alle definierten MapTips
    var all = [];
    for (var k in am.MapTips) {
      if (!am.MapTips.hasOwnProperty(k) || k === '_wms_connector' || k === GATE_KEY) continue;
      var m = am.MapTips[k];
      all.push({
        key: k,
        linked: m.linked_layer_id || '?',
        active: !!m.active,
        querytype: m.querytype || 'default',
        wms_layer: !!m.wms_layer
      });
    }
    console.group('Alle MapTips: ' + all.length + ' definiert');
    var inactive = all.filter(function (x) { return !x.active; });
    var active = all.filter(function (x) { return x.active; });
    console.log('Aktiv:', active.length, '| Inaktiv:', inactive.length);
    if (inactive.length > 0 && inactive.length <= 20) {
      console.log('Inaktive MapTips:');
      inactive.forEach(function (x) { console.log('  ' + x.key + ' → linked:' + x.linked); });
    }
    console.groupEnd();

    // OL-Layer auf Karte
    if (am.Maps && am.Maps[MAP_ID] && am.Maps[MAP_ID].mapObj) {
      var layers = am.Maps[MAP_ID].mapObj.getLayers().getArray();
      var visible = layers.filter(function (l) {
        return typeof l.getVisible === 'function' && l.getVisible();
      });
      console.log('OL-Layer auf Karte:', layers.length, '(sichtbar:', visible.length + ')');
    }

    console.groupEnd();
  }

  // ===== AUTO-INIT =====

  var _initAttempts = 0;
  var _maxInitAttempts = 40;

  function _tryInit() {
    if (_initialized) return;
    _initAttempts++;

    if (init()) {
      _log('Init nach', _initAttempts, 'Versuchen');
      return;
    }

    if (_initAttempts < _maxInitAttempts) {
      setTimeout(_tryInit, 500);
    } else {
      _warn('Init nach', _maxInitAttempts, 'Versuchen fehlgeschlagen');
    }
  }

  document.addEventListener('tnet-app-ready', function () {
    setTimeout(_tryInit, 300);
  }, { once: true });

  setTimeout(_tryInit, 2000);

  // ===== EXPORT =====

  window.TnetInfoBridge = {
    init: init,
    destroy: destroy,
    diagnose: diagnose,
    isActive: function () { return _initialized; }
  };

})();
