/**
 * tnet-independent-opacity.js
 * Unabhaengige Transparenz pro Sublayer fuer konfigurierte ArcGIS-Dienste.
 *
 * Hintergrund: Das Framework fasst mehrere aktive Sublayer desselben MapServers in
 * EINEN OpenLayers-Layer zusammen (LAYERS=show:0,21,51) mit EINER gemeinsamen Opacity.
 * Aendert man die Transparenz eines Sublayers, aendert sich die aller anderen.
 *
 * Loesung: Fuer in `independentOpacityServices` (tnet-global-config.json5) gelistete
 * Dienste wird die Source des kombinierten OL-Layers auf den ArcGIS-Parameter
 * `dynamicLayers` umgestellt. Dieser erlaubt pro (Blatt-)Feature-Layer eine eigene
 * `drawingInfo.transparency`. Gruppen-Layer werden dabei rekursiv auf ihre sichtbaren
 * Blatt-Layer expandiert (Gruppen selbst rendern via dynamicLayers nichts).
 *
 * Der Eingriff erfolgt nicht-invasiv ueber ein Wrapping von `source.updateParams`:
 * Sobald das Framework `LAYERS=show:...` schreibt, wird es transparent in den passenden
 * `dynamicLayers`-Aufruf uebersetzt. Nicht konfigurierte Dienste bleiben unberuehrt.
 *
 * @version    1.0
 * @date       2026-06-19
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */
(function () {
  'use strict';

  var LOG = '[IndependentOpacity]';

  // ===== STATE =====
  var _services = [];          // konfigurierte Dienst-Pfade (lowercase)
  var _meta = {};              // { servicePathLc: { byId, leafCache } }
  var _metaPending = {};       // { servicePathLc: true } waehrend Fetch
  var _opacityByGroup = {};    // { servicePathLc: { groupNum: opacity(0..1) } }
  var _wrapped = [];           // Liste bereits gewrappter Sources (Identitaet)
  var _initDone = false;

  // ===== HELPERS =====

  function log() {
    if (window.TnetLog && typeof window.TnetLog.log === 'function') {
      window.TnetLog.log.apply(window.TnetLog, [LOG].concat([].slice.call(arguments)));
    }
  }

  function getOLMap() {
    try {
      var m = window.njs && njs.AppManager && njs.AppManager.Maps && njs.AppManager.Maps['main'];
      return (m && m.mapObj && typeof m.mapObj.getLayers === 'function') ? m.mapObj : null;
    } catch (e) { return null; }
  }

  function getStore() { return window.TnetLMStore || null; }

  /** Extrahiert den Dienst-Pfad (z.B. "gis_basis/nw_basisplan_gis_dynamisch") aus einer Source-URL. */
  function extractServicePath(url) {
    if (!url) return null;
    var m = url.match(/[?&]path=([^&]+?)\/MapServer/i);
    if (m) return m[1];
    m = url.match(/\/agsproxy\/(.+?)\/MapServer/i);
    if (m) return m[1];
    m = url.match(/\/rest\/services\/(.+?)\/MapServer/i);
    if (m) return m[1];
    return null;
  }

  function sourceUrlOf(source) {
    try {
      if (!source) return null;
      if (typeof source.getUrl === 'function') return source.getUrl();
      if (typeof source.getUrls === 'function') { var u = source.getUrls(); return u && u[0]; }
    } catch (e) { /* defensiv */ }
    return null;
  }

  /** Liefert den konfigurierten Dienst-Pfad (lowercase), der zu einer Source-URL passt. */
  function matchServiceByUrl(url) {
    var sp = extractServicePath(url);
    if (!sp) return null;
    var spLc = sp.toLowerCase();
    for (var i = 0; i < _services.length; i++) {
      if (_services[i] === spLc) return spLc;
    }
    return null;
  }

  /** Liefert den konfigurierten Dienst-Pfad (lowercase), unter dem eine Layer-ID liegt. */
  function matchServiceByLayerId(layerId) {
    if (!layerId) return null;
    var idLc = String(layerId).toLowerCase();
    for (var i = 0; i < _services.length; i++) {
      if (idLc.indexOf(_services[i] + '/') === 0) return _services[i];
    }
    return null;
  }

  /** Parst "show:0,21,51" -> [0,21,51]; "show:-1" -> [-1]. */
  function parseShowNums(layersParam) {
    if (typeof layersParam !== 'string') return [];
    var body = layersParam.replace(/^show:/i, '').trim();
    if (!body) return [];
    var out = [];
    body.split(',').forEach(function (s) {
      var n = parseInt(s.trim(), 10);
      if (!isNaN(n)) out.push(n);
    });
    return out;
  }

  /** Rekursive Aufloesung eines (Gruppen-)Layers auf seine sichtbaren Blatt-IDs. */
  function leavesOf(meta, groupId) {
    if (meta.leafCache.hasOwnProperty(groupId)) return meta.leafCache[groupId];
    var byId = meta.byId;
    var result = (function collect(id) {
      var n = byId[id];
      if (!n) return [];
      var kids = n.subLayerIds;
      if (!kids || !kids.length) return [id]; // Blatt
      var out = [];
      for (var i = 0; i < kids.length; i++) {
        var c = byId[kids[i]];
        if (!c) continue;
        if (c.subLayerIds && c.subLayerIds.length) {
          out = out.concat(collect(kids[i]));
        } else if (c.defaultVisibility !== false) {
          out.push(kids[i]);
        }
      }
      return out;
    })(groupId);
    meta.leafCache[groupId] = result;
    return result;
  }

  function getGroupOpacity(servicePathLc, groupNum) {
    var byGroup = _opacityByGroup[servicePathLc];
    if (byGroup && typeof byGroup[groupNum] === 'number') return byGroup[groupNum];
    return 1;
  }

  /**
   * Baut den dynamicLayers-JSON-String fuer eine Menge aktiver Gruppen-Nummern.
   * @returns {string|null}  null wenn keine Metadaten oder keine sichtbaren Layer.
   */
  function buildDynamicLayers(servicePathLc, groupNums) {
    var meta = _meta[servicePathLc];
    if (!meta) return null;
    var dl = [];
    for (var i = 0; i < groupNums.length; i++) {
      var num = groupNums[i];
      if (num < 0) continue;
      var leaves = leavesOf(meta, num);
      if (!leaves.length) leaves = [num];
      var op = getGroupOpacity(servicePathLc, num);
      var transp = Math.round((1 - Math.max(0, Math.min(1, op))) * 100);
      for (var j = 0; j < leaves.length; j++) {
        dl.push({
          id: leaves[j],
          source: { type: 'mapLayer', mapLayerId: leaves[j] },
          drawingInfo: { transparency: transp }
        });
      }
    }
    if (!dl.length) return null;
    return JSON.stringify(dl);
  }

  /** Laedt MapServer-Metadaten (einmalig pro Dienst); ruft cb() nach Erfolg. */
  function ensureMeta(servicePathLc, source, cb) {
    if (_meta[servicePathLc]) { if (cb) cb(_meta[servicePathLc]); return; }
    if (_metaPending[servicePathLc]) return;
    var base = sourceUrlOf(source);
    if (!base) return;
    _metaPending[servicePathLc] = true;
    var url = base + (base.indexOf('?') >= 0 ? '&' : '?') + 'f=json';
    fetch(url, { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (json) {
        var byId = {};
        (json.layers || []).forEach(function (L) { byId[L.id] = L; });
        _meta[servicePathLc] = { byId: byId, leafCache: {} };
        _metaPending[servicePathLc] = false;
        log('Metadaten geladen:', servicePathLc, '(' + (json.layers || []).length + ' Layer)');
        if (cb) cb(_meta[servicePathLc]);
      })
      .catch(function (e) {
        _metaPending[servicePathLc] = false;
        log('Metadaten-Fetch fehlgeschlagen:', servicePathLc, e && e.message);
      });
  }

  /** Findet den OL-Layer + Source des kombinierten Dienstes anhand des Dienst-Pfads. */
  function findServiceLayer(servicePathLc) {
    var map = getOLMap();
    if (!map) return null;
    var arr = map.getLayers().getArray();
    for (var i = 0; i < arr.length; i++) {
      var L = arr[i];
      var src = (L.getSource && L.getSource()) || null;
      var url = sourceUrlOf(src);
      if (url && matchServiceByUrl(url) === servicePathLc) {
        return { olLayer: L, source: src };
      }
    }
    return null;
  }

  // ===== KERN: Source-Wrapping =====

  /** Wrappt source.updateParams, sodass LAYERS=show:... in dynamicLayers uebersetzt wird. */
  function wrapSource(olLayer, source, servicePathLc) {
    if (!source || _wrapped.indexOf(source) >= 0) return;
    if (typeof source.updateParams !== 'function') return;
    var orig = source.updateParams.bind(source);
    _wrapped.push(source);

    source.updateParams = function (params) {
      // Nur eingreifen, wenn das Framework eine LAYERS=show:-Liste setzt.
      if (params && (params.LAYERS != null || params.layers != null)) {
        var layersVal = params.LAYERS != null ? params.LAYERS : params.layers;
        var nums = parseShowNums(layersVal);
        var dl = buildDynamicLayers(servicePathLc, nums);
        var p = {};
        for (var k in params) { if (params.hasOwnProperty(k)) p[k] = params[k]; }
        p.dynamicLayers = dl || undefined; // undefined wird von OL aus dem Request entfernt
        if (dl) { try { olLayer.setOpacity(1); } catch (e) { /* defensiv */ } }
        return orig(p);
      }
      return orig(params);
    };

    // Metadaten vorab laden; sobald da: aktuellen Stand nachziehen (falls schon aktiv).
    ensureMeta(servicePathLc, source, function () {
      try {
        var cur = source.getParams ? source.getParams() : null;
        var curLayers = cur && (cur.LAYERS != null ? cur.LAYERS : cur.layers);
        if (curLayers != null) source.updateParams({ LAYERS: curLayers });
      } catch (e) { /* defensiv */ }
    });

    log('Source gewrappt:', servicePathLc);
  }

  /** Prueft einen OL-Layer und wrappt seine Source, wenn der Dienst konfiguriert ist. */
  function maybeWrap(olLayer) {
    try {
      var src = olLayer && olLayer.getSource && olLayer.getSource();
      if (!src) return;
      var url = sourceUrlOf(src);
      var sp = matchServiceByUrl(url);
      if (sp) wrapSource(olLayer, src, sp);
    } catch (e) { /* defensiv */ }
  }

  // ===== PUBLIC API =====

  var API = {
    /** True, wenn die Layer-ID zu einem konfigurierten Independent-Opacity-Dienst gehoert. */
    handles: function (layerId) {
      return _services.length > 0 && matchServiceByLayerId(layerId) !== null;
    },

    /**
     * Setzt die Transparenz eines einzelnen Overlays (Sublayer) unabhaengig von Geschwistern.
     * @param {string} layerId  z.B. "gis_basis/nw_basisplan_gis_dynamisch/hoehenlinien"
     * @param {number} opacity  0..1
     */
    setOverlayOpacity: function (layerId, opacity) {
      var sp = matchServiceByLayerId(layerId);
      if (!sp) return false;
      var store = getStore();
      if (!store) return false;
      var layer = store.findLayer ? store.findLayer(layerId) : null;
      var groupNum = layer && layer.params ? parseShowNums(layer.params.LAYERS || layer.params.layers)[0] : null;
      if (groupNum == null || isNaN(groupNum)) return false;

      if (!_opacityByGroup[sp]) _opacityByGroup[sp] = {};
      _opacityByGroup[sp][groupNum] = Math.max(0, Math.min(1, opacity));

      var found = findServiceLayer(sp);
      if (!found) return false; // Layer (noch) nicht im Karten-Stack

      ensureMeta(sp, found.source, function () {
        try {
          var cur = found.source.getParams ? found.source.getParams() : null;
          var curLayers = cur && (cur.LAYERS != null ? cur.LAYERS : cur.layers);
          var nums = parseShowNums(curLayers);
          var dl = buildDynamicLayers(sp, nums);
          if (dl) {
            found.olLayer.setOpacity(1);
            found.source.updateParams({ dynamicLayers: dl });
          }
        } catch (e) { log('setOverlayOpacity-Fehler:', e && e.message); }
      });
      return true;
    },

    /** Initialisiert das Modul: Map-Layer beobachten und konfigurierte Dienste wrappen. */
    init: function () {
      if (_initDone) return;
      var raw = window.__tnetIndependentOpacityServices;
      if (!Array.isArray(raw) || !raw.length) return; // Feature deaktiviert
      _services = raw.map(function (s) { return String(s).toLowerCase(); });

      var map = getOLMap();
      if (!map) return; // erneuter Versuch ueber Polling-Fallback

      _initDone = true;
      // Bestehende Layer wrappen + neue beobachten.
      map.getLayers().getArray().forEach(maybeWrap);
      map.getLayers().on('add', function (e) { maybeWrap(e.element); });
      log('Initialisiert fuer', _services.length, 'Dienst(e).');
    }
  };

  // DEAKTIVIERT (2026-06-19): Der dynamicLayers-Ansatz wirkt nicht, weil die
  // Framework-Source `dynamicLayers` ignoriert. Ersetzt durch das Ueberspringen
  // der Store-Kombination fuer konfigurierte Dienste (tnet-lm-store.js
  // _isIndependentOpacityLayer) -> jedes Overlay rendert als eigener OL-Layer
  // mit nativer Per-Layer-Opacity. Dieses Modul bleibt als No-Op erhalten und
  // wird nicht mehr initialisiert (kein Source-Wrapping).
  void API;
  window.TnetIndependentOpacity = {
    handles: function () { return false; },
    setOverlayOpacity: function () { return false; },
    init: function () {}
  };
})();
