/**
 * tnet-print-legacy-bridge.js
 * Kleine Kompatibilitaetsbruecke fuer den originalen Mapplus-Print.
 *
 * @version    1.0
 * @date       2026-07-06
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */
(function () {
  'use strict';

  var _patched = false;
  var _handlersBound = false;
  var _visibleLayersFallbackPatched = false;
  var _initPatched = false;

  function log() {
    if (window.TnetLog && typeof TnetLog.log === 'function') TnetLog.log.apply(TnetLog, arguments);
    else console.log.apply(console, arguments);
  }

  function warn() {
    if (window.TnetLog && typeof TnetLog.warn === 'function') TnetLog.warn.apply(TnetLog, arguments);
    else console.warn.apply(console, arguments);
  }

  function getMap() {
    try {
      return window._olMap ||
        (window.njs && njs.AppManager && njs.AppManager.Maps && njs.AppManager.Maps.main && njs.AppManager.Maps.main.mapObj) || null;
    } catch (e) {
      return null;
    }
  }

  function getPrintInstance() {
    try {
      return window.njs && njs.AppManager && njs.AppManager.Tools &&
        njs.AppManager.Tools.PrintScaledMap && njs.AppManager.Tools.PrintScaledMap.map &&
        njs.AppManager.Tools.PrintScaledMap.map.printpdf1;
    } catch (e) {
      return null;
    }
  }

  function buildOriginalPrintOptions() {
    try {
      if (!(window.njs && njs.config && njs.config.tools && njs.config.tools.main && njs.config.tools.main.PrintScaledMap)) return null;
      var source = njs.config.tools.main.PrintScaledMap;
      var clone = {};
      for (var key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) clone[key] = source[key];
      }
      clone.tool_button = true;
      clone.tool_container = 'njs_main_print_wrapper';
      clone.printHighlight = true;
      clone.gridOption = true;
      clone.angleOption = true;
      clone.saveStateOption = true;
      clone.dialog_opts = { left: '22', top: '105', width: '400', height: '150' };
      return clone;
    } catch (e) {
      return null;
    }
  }

  function ensureOriginalPrintButtonHost() {
    var host = document.getElementById('btn_printpdf1');
    if (host) return host;

    var wrapper = document.getElementById('njs_main_print_wrapper') || document.getElementById('njs_print_wrapper');
    if (!wrapper || !wrapper.parentNode) return null;

    host = document.createElement('span');
    host.id = 'btn_printpdf1';
    wrapper.parentNode.insertBefore(host, wrapper);
    return host;
  }

  function rebuildOriginalPrintInstance() {
    if (!(window.njs && njs.Tools && typeof njs.Tools.PrintScaledMap === 'function' && njs.AppManager && njs.AppManager.Tools && njs.AppManager.Tools.PrintScaledMap)) return false;

    var bag = njs.AppManager.Tools.PrintScaledMap;
    if (!bag.map) bag.map = {};

    var current = bag.map.printpdf1 || null;
    if (current && current.tool_button === true) return true;

    var options = buildOriginalPrintOptions();
    if (!options) return false;

    ensureOriginalPrintButtonHost();

    try {
      if (current && typeof current.destroy === 'function') current.destroy();
    } catch (destroyErr) {
      warn('[Drucken] Mapplus-Print Altinstanz konnte nicht sauber entfernt werden:', destroyErr);
    }

    try {
      delete bag.map.printpdf1;
    } catch (deleteErr) { /* noop */ }

    try {
      bag.map.printpdf1 = new njs.Tools.PrintScaledMap(options);
      if (bag.map.printpdf1 && typeof bag.map.printpdf1.Activate === 'function') {
        bag.map.printpdf1.Activate(options.idmap || 'main', options.id || 'printpdf1');
      }
      if (bag.map.printpdf1 && typeof bag.map.printpdf1.preparePDFFrame === 'function' && !bag.map.printpdf1.modifyControl) {
        bag.map.printpdf1.preparePDFFrame(true);
      }
      log('[Drucken] Mapplus-Print Instanz auf Originalmodus umgestellt');
      return true;
    } catch (createErr) {
      warn('[Drucken] Mapplus-Print Originalinstanz konnte nicht neu erzeugt werden:', createErr);
      return false;
    }
  }

  function patchPrintInitForOriginalMode() {
    if (_initPatched) return true;
    if (!(window.njs && njs.Tools && njs.Tools.PrintScaledMap && njs.Tools.PrintScaledMap.prototype)) return false;

    var proto = njs.Tools.PrintScaledMap.prototype;
    var originalInit = proto.Init;
    if (typeof originalInit !== 'function') return false;

    proto.Init = function (options) {
      options = options || {};
      if (options.id === 'printpdf1') {
        options.tool_button = true;
        options.tool_container = 'njs_main_print_wrapper';
        options.printHighlight = true;
        options.gridOption = true;
        options.angleOption = true;
        options.saveStateOption = true;
        options.dialog_opts = { left: '22', top: '105', width: '400', height: '150' };
      }
      return originalInit.call(this, options);
    };

    _initPatched = true;
    return true;
  }

  function getScaleValue() {
    try {
      if (window.njs_pdfscale_list && typeof window.njs_pdfscale_list.get === 'function') {
        return parseInt(window.njs_pdfscale_list.get('value'), 10) || 50000;
      }
    } catch (e) { /* noop */ }
    return 50000;
  }

  function ensureVisibleDefaultScale() {
    var current = getScaleValue();
    if (current >= 1000) return current;

    try {
      if (window.njs_pdfscale_list && typeof window.njs_pdfscale_list.set === 'function') {
        window.njs_pdfscale_list.set('value', '5000');
        return 5000;
      }
    } catch (e) { /* noop */ }

    return current;
  }

  function getLayoutValue() {
    try {
      if (window.njs_pdfformat_list && typeof window.njs_pdfformat_list.get === 'function') {
        return String(window.njs_pdfformat_list.get('value') || 'gr_a4h');
      }
    } catch (e) { /* noop */ }
    return 'gr_a4h';
  }

  function normalizeLayoutArg(layout) {
    if (typeof layout === 'string') return layout;

    try {
      if (layout && typeof layout.get === 'function') {
        return String(layout.get('value') || 'gr_a4h');
      }
      if (layout && typeof layout.attr === 'function') {
        return String(layout.attr('value') || 'gr_a4h');
      }
      if (layout && typeof layout.value !== 'undefined') {
        return String(layout.value || 'gr_a4h');
      }
    } catch (e) { /* noop */ }

    return getLayoutValue();
  }

  function getFrameSizeMeters(scale, layout) {
    var portrait = layout.indexOf('a4q') === -1 && layout.indexOf('landscape') === -1;
    var pageW = portrait ? 0.210 : 0.297;
    var pageH = portrait ? 0.297 : 0.210;

    // Mapplus-Templates haben Rand/Legendenbereiche. 70% der Papierflaeche
    // bildet einen praxistauglichen sichtbaren Rahmen und verhindert Vollseiten-Overlays.
    return {
      width: pageW * scale * 0.70,
      height: pageH * scale * 0.70
    };
  }

  function createFallbackPrintFrame() {
    var inst = getPrintInstance();
    var map = getMap();
    if (!inst || !map || !window.ol) return false;
    if (!inst.graphicLyr || !inst.graphicLyr.getSource) return false;

    var source = inst.graphicLyr.getSource();
    if (source.getFeatures && source.getFeatures().length > 0) return true;

    var center = map.getView().getCenter();
    if (!center) return false;

    var scale = getScaleValue();
    var size = getFrameSizeMeters(scale, getLayoutValue());
    var halfW = size.width / 2;
    var halfH = size.height / 2;
    var coords = [[
      [center[0] - halfW, center[1] - halfH],
      [center[0] + halfW, center[1] - halfH],
      [center[0] + halfW, center[1] + halfH],
      [center[0] - halfW, center[1] + halfH],
      [center[0] - halfW, center[1] - halfH]
    ]];

    var feature = new ol.Feature({ geometry: new ol.geom.Polygon(coords) });
    if (source.clear) source.clear();
    source.addFeature(feature);

    if (inst.currentState) {
      inst.currentState.center = center.slice ? center.slice() : center;
      inst.currentState.proj = 'EPSG:2056';
      inst.currentState.pdf_scale = scale;
    }

    try {
      var extent = feature.getGeometry().getExtent();
      map.getView().fit(extent, { padding: [20, 20, 20, 20], nearest: true });
    } catch (fitErr) { /* noop */ }

    log('[Drucken] Legacy-Print Fallback-Rahmen erzeugt');
    return true;
  }

  function hasPrintFrameFeature(inst) {
    inst = inst || getPrintInstance();
    if (!inst || !inst.graphicLyr || !inst.graphicLyr.getSource) return false;

    try {
      var source = inst.graphicLyr.getSource();
      return !!(source && source.getFeatures && source.getFeatures().length > 0);
    } catch (e) {
      return false;
    }
  }

  function ensurePrintFrameVisible(inst) {
    inst = inst || getPrintInstance();
    if (!inst) return;

    try {
      if (inst.graphicLyr && typeof inst.graphicLyr.setVisible === 'function') {
        inst.graphicLyr.setVisible(true);
      }
      if (inst.printHighlight && typeof inst.printHighlight.setVisible === 'function') {
        inst.printHighlight.setVisible(true);
      }
    } catch (e) { /* noop */ }
  }

  function ensureGraphicLayerAttached(inst) {
    inst = inst || getPrintInstance();
    var map = getMap();
    if (!inst || !map || !map.getLayers || !inst.graphicLyr) return;

    try {
      var layers = map.getLayers().getArray();
      var attached = false;
      for (var i = 0; i < layers.length; i++) {
        if (layers[i] === inst.graphicLyr) {
          attached = true;
          break;
        }
      }

      if (!attached) {
        // Altes leeres pdfExtent-Layer entfernen, wenn vorhanden.
        for (var j = layers.length - 1; j >= 0; j--) {
          var name = (layers[j] && layers[j].get) ? layers[j].get('name') : '';
          if (name === 'pdfExtent_printpdf1') {
            map.removeLayer(layers[j]);
          }
        }

        map.addLayer(inst.graphicLyr);
        if (typeof inst.graphicLyr.setZIndex === 'function') inst.graphicLyr.setZIndex(9999);
        if (typeof inst.graphicLyr.setVisible === 'function') inst.graphicLyr.setVisible(true);
        log('[Drucken] Original-Print-Layer wurde an aktive Karte angehängt');
      }
    } catch (e) { /* noop */ }
  }

  function reassertGraphicLayerAttachment(inst) {
    // PrintScaledMap erstellt/aktualisiert seinen leeren pdfExtent-Layer teils
    // erst nach setPrintFrame(). Der sichtbare graphicLyr muss deshalb nach dem
    // synchronen Frame-Aufbau nochmals kurz nachgezogen werden; sonst bleibt beim
    // zweiten Öffnen nur der leere Layer auf der Karte und der Rahmen ist nicht
    // mehr verschiebbar.
    var delays = [0, 120, 400];
    delays.forEach(function(delay) {
      setTimeout(function() {
        ensureGraphicLayerAttached(inst);
        ensurePrintFrameVisible(inst);
      }, delay);
    });
  }

  function buildVisibleLayersFallback() {
    var fallback = {};
    if (!(window.TnetLMStore && typeof TnetLMStore.getActiveLayers === 'function')) return fallback;

    var active = TnetLMStore.getActiveLayers() || [];
    for (var i = 0; i < active.length; i++) {
      var entry = active[i] || {};
      if (!entry.id) continue;

      var node = (typeof TnetLMStore.findLayer === 'function') ? TnetLMStore.findLayer(entry.id) : null;
      var opts = (node && node.options) ? node.options : {};
      var opacity = (typeof entry.opacity === 'number')
        ? entry.opacity
        : ((typeof opts.opacity === 'number') ? opts.opacity : 1);

      fallback['tnet_' + i] = {
        id: entry.id,
        opacity: opacity,
        widget: null,
        _lyr: {
          url: opts.url || entry.url || ''
        }
      };
    }
    return fallback;
  }

  function mergeVisibleLayers(current, fallback) {
    var merged = {};
    var seenById = {};
    var nextIndex = 0;

    function pushEntry(entry) {
      if (!entry || !entry.id || seenById[entry.id]) return;
      merged['tnet_merge_' + nextIndex] = entry;
      seenById[entry.id] = true;
      nextIndex += 1;
    }

    var currentKeys = current ? Object.keys(current) : [];
    for (var i = 0; i < currentKeys.length; i++) pushEntry(current[currentKeys[i]]);

    var fallbackKeys = fallback ? Object.keys(fallback) : [];
    for (var j = 0; j < fallbackKeys.length; j++) pushEntry(fallback[fallbackKeys[j]]);

    return merged;
  }

  function withVisibleLayersFallback(fn, context, args) {
    installVisibleLayersFallback();
    return fn.apply(context, args);
  }

  function withPublicDevPrintSession(fn, context, args) {
    var isPublicDev = window.njs && njs.AppManager
      && njs.AppManager.Site === 'maps-dev'
      && njs.AppManager.ugroup === 'public';
    if (!isPublicDev || typeof window.fetch !== 'function') return fn.apply(context, args);

    var appRoot = njs.AppManager.appBasePath || '/maps-dev';
    return fetch(appRoot + '/tnet/php/keepalive-local.php', {
      credentials: 'same-origin',
      cache: 'no-store'
    }).catch(function() {
      // Der PDF-Aufruf bleibt auch bei einem Keepalive-Netzwerkfehler möglich.
      return null;
    }).then(function() {
      return fn.apply(context, args);
    });
  }

  function installVisibleLayersFallback() {
    if (_visibleLayersFallbackPatched) return;
    if (!(window.njs && njs.AppManager && typeof njs.AppManager.getVisibleLayersByMap === 'function')) return;

    var original = njs.AppManager.getVisibleLayersByMap;
    njs.AppManager.getVisibleLayersByMap = function (idmap, excludeNotVisibleInZoom) {
      var current = original.call(njs.AppManager, idmap, excludeNotVisibleInZoom);
      var fallback = buildVisibleLayersFallback();
      var currentCount = current ? Object.keys(current).length : 0;
      var fallbackCount = Object.keys(fallback).length;

      if (fallbackCount > 0) {
        var merged = mergeVisibleLayers(current, fallback);
        var mergedCount = Object.keys(merged).length;
        if (mergedCount > currentCount) {
          log('[Drucken] Mapplus-Print Layerliste aus TNET-Store ergänzt (' + currentCount + ' -> ' + mergedCount + ')');
          return merged;
        }
      }
      return current;
    };

    _visibleLayersFallbackPatched = true;
    window.__tnetLegacyPrintLayerFallbackPatched = true;
  }

  function patchPrintScaledMap() {
    if (_patched) return true;
    if (!(window.njs && njs.Tools && njs.Tools.PrintScaledMap && njs.Tools.PrintScaledMap.prototype)) return false;

    installVisibleLayersFallback();

    var proto = njs.Tools.PrintScaledMap.prototype;
    var originalSetPrintFrame = proto.setPrintFrame;
    var originalChangePrintFrame = proto.changePrintFrame;
    var originalGetPDF = proto.getPDF;
    var originalGetPredefinedPDF = proto.getPredefinedPDF;

    if (typeof originalSetPrintFrame === 'function') {
      proto.setPrintFrame = function () {
        var args = Array.prototype.slice.call(arguments);
        if (args.length > 1) args[1] = normalizeLayoutArg(args[1]);
        try {
          var result = originalSetPrintFrame.apply(this, args);
          reassertGraphicLayerAttachment(this);
          return result;
        } catch (err) {
          var msg = String((err && err.message) || err || '');
          if (msg.indexOf('getCode') === -1 && msg.indexOf('getProjection') === -1) throw err;
          var prevSaveState = this.save_state;
          this.save_state = false;
          try {
            warn('[Drucken] Mapplus-Print Projection-Fallback aktiv');
            var retryResult = originalSetPrintFrame.apply(this, args);
            reassertGraphicLayerAttachment(this);
            return retryResult;
          } finally {
            this.save_state = prevSaveState;
          }
        }
      };
    }

    if (typeof originalChangePrintFrame === 'function') {
      proto.changePrintFrame = function () {
        var args = Array.prototype.slice.call(arguments);
        if (args.length > 1) args[1] = normalizeLayoutArg(args[1]);
        var result = originalChangePrintFrame.apply(this, args);
        reassertGraphicLayerAttachment(this);
        return result;
      };
    }

    if (typeof originalGetPDF === 'function') {
      proto.getPDF = function () {
        var context = this;
        var args = arguments;
        return withPublicDevPrintSession(function() {
          return withVisibleLayersFallback(originalGetPDF, context, args);
        }, context, args);
      };
    }

    if (typeof originalGetPredefinedPDF === 'function') {
      proto.getPredefinedPDF = function () {
        return withVisibleLayersFallback(originalGetPredefinedPDF, this, arguments);
      };
    }

    _patched = true;
    window.__tnetLegacyPrintBridgePatched = true;
    log('[Drucken] Mapplus-Print Bridge aktiv');
    return true;
  }

  function triggerLegacyFrame() {
    var inst = getPrintInstance();
    if (!inst) return false;

    ensureVisibleDefaultScale();

    try {
      if (inst.tool_button === true) {
        if (typeof inst.preparePDFFrame === 'function' && (!inst.modifyControl || !inst.graphicLyr)) {
          inst.preparePDFFrame(true);
        }
        if (typeof inst.showDialog === 'function') inst.showDialog();
        if (inst.modifyControl && typeof inst.modifyControl.setActive === 'function') {
          inst.modifyControl.setActive(true);
        }
        if (window.njs_pdfscale_list && typeof inst.setPrintFrame === 'function') {
          inst.setPrintFrame(window.njs_pdfscale_list, getLayoutValue(), false);
        }
      } else if (!hasPrintFrameFeature(inst) && typeof inst.togglePDF === 'function' && !inst._nobuttonactivedialog) {
        inst.togglePDF('tp_print_menu');
      } else if (window.njs_pdfscale_list && typeof inst.changePrintFrame === 'function') {
        inst.changePrintFrame(window.njs_pdfscale_list, getLayoutValue());
      } else if (window.njs_pdfscale_list && typeof inst.setPrintFrame === 'function') {
        inst.setPrintFrame(window.njs_pdfscale_list, getLayoutValue(), false);
      }
      reassertGraphicLayerAttachment(inst);
    } catch (err) {
      warn('[Drucken] Mapplus-Print Rahmen-Trigger fehlgeschlagen:', err);
    }
    return true;
  }

  function bindPanelHandlers() {
    if (_handlersBound) return;

    var legacyMenu = document.getElementById('tp_print_menu');
    if (legacyMenu) {
      legacyMenu.style.display = '';
      if (legacyMenu.tagName === 'DETAILS' && !legacyMenu.__tnetLegacyPrintToggleBound) {
        legacyMenu.open = false;
        legacyMenu.addEventListener('toggle', function () {
          if (legacyMenu.open) triggerLegacyFrame();
        });
        legacyMenu.__tnetLegacyPrintToggleBound = true;
      }
    }

    var tnetMenu = document.getElementById('tp_tnet_print_menu');
    if (tnetMenu) tnetMenu.style.display = 'none';

    try {
      if (window.dijit && dijit.byId) {
        var legacyWidget = dijit.byId('tp_print_menu');
        var printWidget = dijit.byId('print_menu');
        if (legacyWidget && printWidget) {
          if (typeof legacyWidget.set === 'function') legacyWidget.set('open', false);
          if (typeof printWidget.set === 'function') printWidget.set('open', true);

          if (!window.__tnetLegacyPrintWatchBound) {
            if (typeof legacyWidget.watch === 'function') {
              legacyWidget.watch('open', function (name, oldVal, newVal) {
                if (newVal) {
                  if (printWidget && typeof printWidget.set === 'function') printWidget.set('open', true);
                  triggerLegacyFrame();
                }
              });
            }
            if (typeof printWidget.watch === 'function') {
              printWidget.watch('open', function (name, oldVal, newVal) {
                if (newVal) triggerLegacyFrame();
              });
            }
            window.__tnetLegacyPrintWatchBound = true;
          }

          _handlersBound = true;
        }
      }
    } catch (e) {
      warn('[Drucken] Mapplus-Print Widget-Watcher konnte nicht gebunden werden:', e);
    }
  }

  function initWithRetry() {
    var tries = 0;
    function tick() {
      tries += 1;
      patchPrintInitForOriginalMode();
      rebuildOriginalPrintInstance();
      var patched = patchPrintScaledMap();
      bindPanelHandlers();

      var current = getPrintInstance();
      var originalModeReady = !!(current && current.tool_button === true);

      if ((patched && originalModeReady) || tries >= 80) {
        if (!patched) warn('[Drucken] Mapplus-Print Bridge: PrintScaledMap nicht gefunden');
        if (patched && !originalModeReady) warn('[Drucken] Mapplus-Print blieb im Sidepanel-Modus statt Originalmodus');
        return;
      }
      setTimeout(tick, 150);
    }
    tick();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWithRetry);
  } else {
    initWithRetry();
  }
})();
