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
  function _startNoResultsWatchdog() {
    setTimeout(function () {
      var container = document.getElementById('njs_info_pane_content');
      if (!container) return;

      // Spinner ausblenden
      var spinner = document.getElementById('infowin_wait');
      if (spinner) spinner.style.display = 'none';

      // Framework hat noch laufende Requests → noch warten
      var am = _getAm();
      if (am && am.infoRequestsPending && am.infoRequestsPending > 0) {
        // Nochmal 3s warten
        setTimeout(function () {
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
    }, 5000);
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

    var count = 0;
    var items = am.wmsActiveLyrs.getArray();
    var dispatched = []; // Für Log

    for (var i = 0; i < items.length; i++) {
      var mt = items[i];
      if (!mt || !mt.active) continue;
      if (typeof mt.queryconnector !== 'function') {
        _warn('MapTip ohne queryconnector:', mt.linked_layer_id || mt.id);
        continue;
      }

      // ── Pre-Flight Diagnose: URL-Pfad loggen den queryconnector nehmen wird ──
      var mtLinkedId = mt.linked_layer_id || mt.id || '?';
      var urlPath = '(unbekannt)';
      var layerSource = '?';
      var parentMatch = mt._tnetParentMatch || null;
      try {
        if (mt.wms_layer) {
          // queryconnector nutzt wms_layer direkt
          layerSource = parentMatch ? 'wms_layer(prefix:' + parentMatch + ')' : 'wms_layer';
          if (mt.wms_layer.getSource && typeof mt.wms_layer.getSource === 'function') {
            var src = mt.wms_layer.getSource();
            urlPath = (src && typeof src.getUrl === 'function') ? (src.getUrl() || '').substring(0, 100) : '(kein getUrl)';
          }
        } else {
          // queryconnector wird getLayerByMap nutzen
          layerSource = 'getLayerByMap';
          var fwLayer = njs.AppManager.getLayerByMap(mt.idmap || 'main', mt.linked_layer_id);
          if (fwLayer && fwLayer._lyr) {
            var fwSrc = fwLayer._lyr.getSource ? fwLayer._lyr.getSource() : null;
            urlPath = (fwSrc && typeof fwSrc.getUrl === 'function') ? (fwSrc.getUrl() || '').substring(0, 100) : '(kein getUrl)';
          } else {
            urlPath = fwLayer ? '(kein _lyr)' : '(NICHT GEFUNDEN!)';
          }
        }
      } catch (preErr) {
        urlPath = '(pre-flight Fehler: ' + preErr.message + ')';
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
    var hasBlockingFeature = false;
    try {
      if (map.hasFeatureAtPixel(evt.pixel) === true) {
        map.forEachFeatureAtPixel(evt.pixel, function (feature, layer) {
          if (!layer) return;
          var name = layer.get('name') || '';
          // Kosmetische Layer ignorieren
          if (name === 'cosmetic_maptip' || name === 'cosmetic_search' || name.indexOf('cosmetic_') === 0) return;
          // Framework-interne Layer ignorieren (Messungen, PDF-Extent, Select-Tools)
          if (name.indexOf('njs_') === 0 || name.indexOf('pdfExtent') === 0) return;
          // Räumliche-Abfrage-Zeichenlayer ignorieren
          if (name === 'spatial_query_draw' || name === 'tnet_spatial_query') return;
          // Alles andere blockiert
          hasBlockingFeature = true;
          _log('Click #' + _clickCount + ': blockierender Layer: "' + name + '"');
        });
      }
    } catch (e) { /* Ignorieren */ }

    if (hasBlockingFeature) {
      _log('Click #' + _clickCount + ': Feature-at-Pixel blockiert Info-Abfrage');
      return;
    }

    // ── Panel vorbereiten (Framework-Funktion, EINMAL) ──
    try {
      if (typeof am.prepareInfoRequest === 'function') {
        am.prepareInfoRequest(evt, MAP_ID);
      }
    } catch (e) {
      _warn('prepareInfoRequest Fehler:', e);
    }

    // ── Adapter dispatchen ──
    var mapPlusCount = _adapterMapPlus(evt);
    var wmsCustomCount = _adapterWmsCustom(evt, map);
    var totalCount = mapPlusCount + wmsCustomCount;

    _log('Click #' + _clickCount + ': Dispatch', totalCount, 'Queries',
      '(MapPlus:', mapPlusCount, '| WMS-Custom:', wmsCustomCount + ')');

    // ── No-Results Watchdog ──
    _startNoResultsWatchdog();
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

    // 4. Periodische Sentinel-Prüfung (alle 10s für 2 Minuten)
    var sentinelChecks = 0;
    var sentinelInterval = setInterval(function () {
      sentinelChecks++;
      _ensureSentinel();
      if (sentinelChecks >= 12) clearInterval(sentinelInterval);
    }, 10000);

    return true;
  }

  function destroy() {
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
