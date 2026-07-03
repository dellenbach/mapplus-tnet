/**
 * tnet-wms-panel.js
 * Externe Kartendienste (WMS) — Eigenes Floating-Panel, Dojo-frei.
 * GetCapabilities-Abfrage via ol.format.WMSCapabilities,
 * Layer-Hinzufügen via ol.layer.Image + ol.source.ImageWMS.
 *
 * @version    1.0
 * @date       2026-03-02
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

(function() {
  'use strict';

  function getAppRoot() {
    return window.__TNET_APP_ROOT || '/maps';
  }

  // ===== KONFIGURATION =====

  // Vordefinierte WMS-Dienste — Fallback-Defaults, werden durch tnet-global-config.json5 überschrieben
  var WMS_PRESETS = [
    { name: 'Swisstopo WMS', url: 'https://wms.geo.admin.ch/?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities' },
    { name: 'Kt. Nidwalden', url: 'https://www.gis-daten.ch/wms/nw/service?REQUEST=GetCapabilities&SERVICE=WMS' },
    { name: 'Kt. Obwalden', url: 'https://www.gis-daten.ch/wms/ow/service?REQUEST=GetCapabilities&SERVICE=WMS' },
    { name: 'Kt. Uri', url: 'https://geo.ur.ch/wms?request=getCapabilities' },
    { name: 'Geodienste AV', url: 'https://geodienste.ch/db/av_0/deu?SERVICE=WMS&REQUEST=GetCapabilities' }
  ];
  var _configLoaded = false;

  // State
  var _addedLayers = [];  // { olLayer, name, title, wmsUrl, opacity }
  var _isWmsDocked = false;
  var _savedWmsPosition = null;
  var _capabilitiesLayers = [];  // Letzte GetCapabilities-Ergebnisse
  var _currentWmsUrl = '';

  // ===== DOM-REFERENZEN =====

  function $(id) { return document.getElementById(id); }

  // ===== DOM-INJECTION =====
  // Baut das WMS-Panel-DOM selbst auf, falls es nicht im HTML vorhanden ist.
  // Ermoeglicht schlankes index.htm (kein Panel-Markup noetig) + Wiederverwendung
  // in Mobile/Edit. Ist das Panel bereits vorhanden, passiert nichts.
  function ensureWmsPanelDOM() {
    if (document.getElementById('wms-panel')) return;

    var panel = document.createElement('div');
    panel.id = 'wms-panel';
    panel.className = 'wms-panel hidden';
    panel.innerHTML =
        '<div class="wms-resize-top" id="wms-resize-top"></div>'
      + '<div class="wms-resize-left" id="wms-resize-left"></div>'
      + '<div class="wms-resize-right" id="wms-resize-right"></div>'
      + '<div class="wms-resize-bottom" id="wms-resize-bottom"></div>'
      + '<div class="wms-resize-corner-tl" id="wms-resize-corner-tl"></div>'
      + '<div class="wms-resize-corner-tr" id="wms-resize-corner-tr"></div>'
      + '<div class="wms-resize-corner-bl" id="wms-resize-corner-bl"></div>'
      + '<div class="wms-resize-corner-br" id="wms-resize-corner-br"></div>'
      + '<div class="wms-header" id="wms-header">'
      +   '<span class="wms-title">Externe Kartendienste (WMS)</span>'
      +   '<div class="wms-actions">'
      +     '<button class="wms-close" onclick="closeWmsPanel()">&times;</button>'
      +   '</div>'
      + '</div>'
      + '<div class="wms-body">'
      +   '<div class="wms-url-bar">'
      +     '<label class="wms-label">WMS-Dienst w\u00e4hlen oder URL eingeben:</label>'
      +     '<div class="wms-url-row">'
      +       '<select id="wms-preset-select" class="wms-select">'
      +         '<option value="">\u2014 Vordefinierter Dienst \u2014</option>'
      +       '</select>'
      +     '</div>'
      +     '<div class="wms-url-row">'
      +       '<input type="text" id="wms-url-input" class="wms-input" placeholder="https://wms.example.com/service?" autocomplete="off">'
      +       '<button class="wms-load-btn" id="wms-load-btn" onclick="loadWmsCapabilities()">Laden</button>'
      +     '</div>'
      +   '</div>'
      +   '<div class="wms-status" id="wms-status"></div>'
      +   '<div class="wms-filter-row" id="wms-filter-row" style="display:none">'
      +     '<input type="text" id="wms-layer-filter" class="wms-input wms-filter-input" placeholder="Layer filtern\u2026" autocomplete="off">'
      +   '</div>'
      +   '<div class="wms-layer-list" id="wms-layer-list"></div>'
      +   '<div class="wms-added-section" id="wms-added-section" style="display:none">'
      +     '<div class="wms-added-header">Hinzugef\u00fcgte Layer</div>'
      +     '<div class="wms-added-list" id="wms-added-list"></div>'
      +   '</div>'
      + '</div>';
    document.body.appendChild(panel);
    TnetLog.log('[WMS-Panel] DOM auto-injiziert \u2714');
  }

  // ===== PANEL TOGGLE =====

  window.toggleWmsPanel = function() {
    var panel = $('wms-panel');
    if (!panel) return;
    // Hamburger-Menü schliessen
    var menu = document.getElementById('header_menu');
    if (menu) menu.classList.remove('open');

    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) {
      if (_isWmsDocked || panel.classList.contains('docked-right')) {
        _undockWms();
      }
      TnetLog.log('[WMS-Panel] Geöffnet');
    }
  };

  window.closeWmsPanel = function() {
    var panel = $('wms-panel');
    if (!panel) return;
    // Falls gedockt: undocken beim Schliessen
    if (_isWmsDocked || panel.classList.contains('docked-right')) {
      _undockWms();
    }
    panel.classList.add('hidden');
  };

  // ===== DOCK/UNDOCK =====

  window.toggleWmsDock = function() {
    var panel = $('wms-panel');
    if (!panel) return;
    if (_isWmsDocked || panel.classList.contains('docked-right')) {
      _undockWms();
    }
  };

  function _getWmsDockLayoutMetrics(mapContainer) {
    var centerPane = document.getElementById('centerPaneLayout');
    var streetviewContainer = document.getElementById('streetviewContainer');
    var footerBar = document.getElementById('map-footer-bar');

    var streetviewWidth = 0;
    if (streetviewContainer && streetviewContainer.offsetWidth > 0 && streetviewContainer.style.display !== 'none') {
      streetviewWidth = streetviewContainer.offsetWidth;
    }

    var fallbackRect = mapContainer
      ? mapContainer.getBoundingClientRect()
      : { top: 69, bottom: window.innerHeight };
    var centerRect = centerPane ? centerPane.getBoundingClientRect() : fallbackRect;
    var baseBottomOffset = Math.max(0, window.innerHeight - centerRect.bottom);

    var footerHeight = 32;
    if (footerBar && footerBar.offsetHeight > 0 && window.getComputedStyle(footerBar).display !== 'none') {
      footerHeight = footerBar.offsetHeight;
    }

    return {
      centerPaneWidth: centerPane ? centerPane.offsetWidth : window.innerWidth,
      centerRect: centerRect,
      streetviewWidth: streetviewWidth,
      bottomOffset: Math.max(baseBottomOffset, footerHeight)
    };
  }

  function _dockWms() {
    var panel = $('wms-panel');
    var dockBtn = $('wms-dock-btn');
    var mapContainer = document.getElementById('mapContainer');
    if (!panel) return;

    // Position speichern
    var rect = panel.getBoundingClientRect();
    _savedWmsPosition = {
      top: panel.style.top || rect.top + 'px',
      left: panel.style.left || rect.left + 'px',
      width: panel.style.width || rect.width + 'px',
      height: panel.style.height || rect.height + 'px'
    };

    panel.classList.add('docked-right');

    var panelWidth = window._savedWmsDockedWidth || 400;
    var dockMetrics = _getWmsDockLayoutMetrics(mapContainer);

    panel.style.setProperty('top', dockMetrics.centerRect.top + 'px', 'important');
    panel.style.setProperty('bottom', dockMetrics.bottomOffset + 'px', 'important');
    panel.style.setProperty('width', panelWidth + 'px', 'important');
    panel.style.setProperty('right', dockMetrics.streetviewWidth + 'px', 'important');

    if (mapContainer) {
      var mapWidth = dockMetrics.centerPaneWidth - dockMetrics.streetviewWidth - panelWidth;
      mapContainer.style.setProperty('width', mapWidth + 'px', 'important');
      _triggerMapUpdate();
    }

    if (dockBtn) {
      dockBtn.title = 'Floating';
      dockBtn.innerHTML = TnetIcons.get('undock');
    }

    _isWmsDocked = true;
    window.isWmsPanelDocked = true;
  }

  function _undockWms() {
    var panel = $('wms-panel');
    var dockBtn = $('wms-dock-btn');
    var mapContainer = document.getElementById('mapContainer');
    if (!panel) return;

    panel.classList.remove('docked-right');

    if (mapContainer) {
      mapContainer.style.setProperty('width', '100%', 'important');
      setTimeout(function() { _triggerMapUpdate(); }, 100);
    }

    if (_savedWmsPosition) {
      panel.style.setProperty('top', _savedWmsPosition.top, 'important');
      panel.style.setProperty('left', _savedWmsPosition.left, 'important');
      panel.style.setProperty('width', _savedWmsPosition.width, 'important');
      panel.style.setProperty('height', _savedWmsPosition.height, 'important');
    } else {
      panel.style.setProperty('top', '80px', 'important');
      panel.style.setProperty('left', 'calc(50vw - 220px)', 'important');
      panel.style.setProperty('width', '440px', 'important');
      panel.style.setProperty('height', '520px', 'important');
    }
    panel.style.setProperty('right', 'auto', 'important');
    panel.style.setProperty('bottom', 'auto', 'important');

    if (dockBtn) {
      dockBtn.title = 'Rechts andocken';
      dockBtn.innerHTML = TnetIcons.get('dock');
    }

    _isWmsDocked = false;
    window.isWmsPanelDocked = false;
  }

  function _triggerMapUpdate() {
    try {
      if (window.njs && njs.AppManager && njs.AppManager.Maps && njs.AppManager.Maps['main']) {
        var mapObj = njs.AppManager.Maps['main'].mapObj;
        if (mapObj && mapObj.updateSize) mapObj.updateSize();
      }
    } catch (e) { /* ignorieren */ }
  }

  // ===== GET CAPABILITIES =====

  window.loadWmsCapabilities = function() {
    var urlInput = $('wms-url-input');
    var loadBtn = $('wms-load-btn');
    var url = (urlInput ? urlInput.value.trim() : '');
    if (!url) {
      _setStatus('Bitte eine WMS-URL eingeben.', 'error');
      return;
    }

    // URL normalisieren: GetCapabilities-Parameter hinzufügen falls nicht vorhanden
    var capUrl = _buildCapabilitiesUrl(url);
    _currentWmsUrl = _extractBaseUrl(url);

    _setStatus('Lade GetCapabilities…', '');
    if (loadBtn) loadBtn.disabled = true;

    // Zuerst direkt probieren, bei CORS-Fehler über Proxy
    fetch(capUrl)
      .then(function(resp) {
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.text();
      })
      .then(function(xml) {
        _parseCapabilities(xml);
        if (loadBtn) loadBtn.disabled = false;
      })
      .catch(function(err) {
        TnetLog.warn('[WMS-Panel] Direkter Zugriff fehlgeschlagen, versuche Proxy:', err.message);
        // Über Proxy versuchen
        var proxyUrl = getAppRoot() + '/wmsproxy.php?url=' + encodeURIComponent(capUrl);
        fetch(proxyUrl)
          .then(function(resp) {
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            return resp.text();
          })
          .then(function(xml) {
            _parseCapabilities(xml);
            if (loadBtn) loadBtn.disabled = false;
          })
          .catch(function(err2) {
            _setStatus('Fehler beim Laden: ' + err2.message, 'error');
            if (loadBtn) loadBtn.disabled = false;
          });
      });
  };

  function _buildCapabilitiesUrl(url) {
    // Falls schon GetCapabilities-Parameter vorhanden → direkt verwenden
    if (url.toLowerCase().indexOf('request=getcapabilities') > -1) return url;
    // Separator bestimmen
    var sep = url.indexOf('?') > -1 ? '&' : '?';
    return url + sep + 'SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0';
  }

  function _extractBaseUrl(url) {
    // Alles vor dem '?' oder die ganze URL
    var idx = url.indexOf('?');
    return idx > -1 ? url.substring(0, idx) : url;
  }

  function _parseCapabilities(xml) {
    try {
      var parser = new ol.format.WMSCapabilities();
      var result = parser.read(xml);

      if (!result || !result.Capability) {
        _setStatus('Keine gültige WMS-Antwort erhalten.', 'error');
        return;
      }

      // Dienst-Name anzeigen
      var serviceTitle = (result.Service && result.Service.Title) ? result.Service.Title : 'WMS';

      // Layer extrahieren (rekursiv — WMS hat verschachtelte Layer)
      _capabilitiesLayers = [];
      _flattenLayers(result.Capability.Layer, _capabilitiesLayers);

      _setStatus(serviceTitle + ' — ' + _capabilitiesLayers.length + ' Layer gefunden', 'success');
      _renderLayerList(_capabilitiesLayers);
      // Filter-Zeile anzeigen
      var filterRow = $('wms-filter-row');
      if (filterRow) filterRow.style.display = _capabilitiesLayers.length > 5 ? '' : 'none';

    } catch (e) {
      TnetLog.error('[WMS-Panel] Parse-Fehler:', e);
      _setStatus('XML-Parse-Fehler: ' + e.message, 'error');
    }
  }

  /**
   * Rekursive Layer-Extraktion aus WMS Capabilities.
   * Nur Layer mit Name (= abfragbar) werden aufgenommen.
   */
  function _flattenLayers(layerObj, list) {
    if (!layerObj) return;
    // Einzelner Layer
    if (layerObj.Name) {
      // LegendURL aus Style extrahieren (OL WMSCapabilities Parser liefert Style-Array)
      var legendUrl = '';
      var metadataUrl = '';
      try {
        if (layerObj.Style && layerObj.Style.length > 0) {
          var style = layerObj.Style[0];
          if (style.LegendURL && style.LegendURL.length > 0 && style.LegendURL[0].OnlineResource) {
            legendUrl = style.LegendURL[0].OnlineResource;
          }
        }
        if (layerObj.MetadataURL && layerObj.MetadataURL.length > 0 && layerObj.MetadataURL[0].OnlineResource) {
          metadataUrl = layerObj.MetadataURL[0].OnlineResource;
        }
      } catch (e) { /* Style/Metadata nicht vorhanden */ }

      list.push({
        name: layerObj.Name,
        title: layerObj.Title || layerObj.Name,
        abstract: layerObj.Abstract || '',
        bbox: layerObj.BoundingBox || layerObj.EX_GeographicBoundingBox || null,
        queryable: layerObj.queryable !== false,
        legendUrl: legendUrl,
        metadataUrl: metadataUrl
      });
    }
    // Kind-Layer
    if (layerObj.Layer) {
      if (Array.isArray(layerObj.Layer)) {
        layerObj.Layer.forEach(function(child) {
          _flattenLayers(child, list);
        });
      } else {
        _flattenLayers(layerObj.Layer, list);
      }
    }
  }

  // ===== STATUS =====

  function _setStatus(msg, type) {
    var el = $('wms-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'wms-status visible' + (type ? ' ' + type : '');
  }

  // ===== LAYER-LISTE RENDERN =====

  function _renderLayerList(layers) {
    var container = $('wms-layer-list');
    if (!container) return;
    container.innerHTML = '';

    if (!layers || layers.length === 0) {
      container.innerHTML = '<div style="padding:12px;color:#888;text-align:center;font-size:12px">Keine Layer gefunden</div>';
      return;
    }

    layers.forEach(function(layer, idx) {
      var isAdded = _addedLayers.some(function(a) { return a.name === layer.name && a.wmsUrl === _currentWmsUrl; });

      var div = document.createElement('div');
      div.className = 'wms-layer-item' + (isAdded ? ' added' : '');
      div.dataset.idx = idx;
      div.dataset.layerName = layer.name;

      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'wms-layer-cb';
      cb.checked = isAdded;

      var info = document.createElement('div');
      info.className = 'wms-layer-info';

      var nameHtml = '<div class="wms-layer-name" title="' + _escHtml(layer.name) + '">' + _escHtml(layer.title) + '</div>';
      info.innerHTML = nameHtml;

      if (layer.abstract) {
        var abstractDiv = document.createElement('div');
        abstractDiv.className = 'wms-layer-abstract';
        abstractDiv.textContent = layer.abstract;

        info.appendChild(abstractDiv);

        // "...mehr" Button nur bei längeren Texten
        if (layer.abstract.length > 80) {
          var moreBtn = document.createElement('button');
          moreBtn.className = 'wms-layer-more-btn';
          moreBtn.textContent = '...mehr';
          moreBtn.onclick = function(e) {
            e.stopPropagation();
            var isExpanded = abstractDiv.classList.toggle('expanded');
            moreBtn.textContent = isExpanded ? 'weniger' : '...mehr';
          };
          info.appendChild(moreBtn);
        }
      }

      var actions = document.createElement('div');
      actions.className = 'wms-layer-actions';

      // Legende-Button (immer sichtbar — Fallback-URL wird konstruiert)
      var legendBtn = document.createElement('button');
      legendBtn.className = 'wms-layer-action-btn wms-layer-legend-btn';
      legendBtn.title = 'Legende anzeigen';
      legendBtn.innerHTML = TnetIcons.get('legend');
      (function(l) {
        legendBtn.onclick = function(e) {
          e.stopPropagation();
          _showWmsLegend(l.name, l.title, l.legendUrl);
        };
      })(layer);
      actions.appendChild(legendBtn);

      // Zoom-Button
      if (layer.bbox) {
        var zoomBtn = document.createElement('button');
        zoomBtn.className = 'wms-layer-action-btn';
        zoomBtn.title = 'Auf Layer zoomen';
        zoomBtn.innerHTML = TnetIcons.get('zoom');
        zoomBtn.onclick = function(e) {
          e.stopPropagation();
          _zoomToLayer(layer);
        };
        actions.appendChild(zoomBtn);
      }

      div.appendChild(cb);
      div.appendChild(info);
      div.appendChild(actions);

      // Checkbox-Click: stopPropagation verhindert, dass div.onclick
      // die Checkbox ein zweites Mal toggled (Double-Toggle-Bug)
      cb.addEventListener('click', function(e) {
        e.stopPropagation();
      });

      // Change-Handler: Layer hinzufügen/entfernen
      cb.addEventListener('change', function() {
        TnetLog.log('[WMS-Panel] cb.change:', layer.name, '→ checked:', cb.checked);
        if (cb.checked) {
          _addWmsLayer(layer);
          div.classList.add('added');
        } else {
          _removeWmsLayer(layer.name);
          div.classList.remove('added');
        }
      });

      // Klick auf Zeile (nicht Checkbox) → Checkbox togglen
      div.addEventListener('click', function(e) {
        // Checkbox, Mehr-Button, Zoom-Button → ignorieren
        if (e.target === cb || e.target.closest('input') || e.target.closest('.wms-layer-more-btn') || e.target.closest('.wms-layer-action-btn')) return;
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change'));
      });

      container.appendChild(div);
    });
  }

  // ===== FRAMEWORK-KOMPATIBILITÄT =====

  /**
   * Injiziert einen Dummy-Eintrag in die Framework-Layer-Config (njs.AppManager.Maps['main'].layers),
   * damit njs.MapTip.addLayerCallback beim addLayer-Event keinen Null-Zugriff auf
   * minResolution/maxResolution bekommt.
   */
  function _injectFrameworkLayerConfig(layerName, wmsUrl) {
    try {
      var am = window.njs && window.njs.AppManager;
      if (!am) am = window.top && window.top.njs && window.top.njs.AppManager;
      if (!am || !am.Maps || !am.Maps['main']) return;

      var mainMap = am.Maps['main'];

      // Layers-Objekt: Framework speichert Layer-Configs als Objekt mit layerName als Key
      // Verschiedene mögliche Speicherorte prüfen
      var configStores = ['layers', 'Layers', 'layerConf', 'layersConf', 'conf'];
      for (var i = 0; i < configStores.length; i++) {
        var store = mainMap[configStores[i]];
        if (store && typeof store === 'object' && !Array.isArray(store)) {
          if (!store[layerName]) {
            store[layerName] = {
              minResolution: 0,
              maxResolution: 999999,
              resol_visibility: [0, 999999],
              url: wmsUrl,
              type: 'wms',
              visible: true,
              name: layerName,
              tnet_wms_custom: true
            };
            TnetLog.log('[WMS-Panel] Dummy-Config injiziert in mainMap.' + configStores[i] + ':', layerName);
          }
          break;
        }
      }

      // Auch MapTip-Konfiguration: Leeres Objekt damit kein null-Zugriff
      if (am.MapTips && typeof am.MapTips === 'object') {
        // Nicht überschreiben falls vorhanden
      }

      // Sicherheitsnetz: addLayerCallback wrappen falls vorhanden
      if (window.njs && window.njs.MapTip && window.njs.MapTip.addLayerCallback) {
        var origFn = window.njs.MapTip.addLayerCallback;
        if (!origFn.__tnetWrapped) {
          window.njs.MapTip.addLayerCallback = function() {
            try {
              return origFn.apply(this, arguments);
            } catch (e) {
              TnetLog.warn('[WMS-Panel] addLayerCallback-Fehler abgefangen:', e.message);
            }
          };
          window.njs.MapTip.addLayerCallback.__tnetWrapped = true;
          TnetLog.log('[WMS-Panel] addLayerCallback mit try/catch gewrapped');
        }
      }
    } catch (e) {
      TnetLog.warn('[WMS-Panel] Config-Injection fehlgeschlagen:', e.message);
    }
  }

  // ===== LAYER ZUR KARTE HINZUFÜGEN =====

  function _addWmsLayer(layerDef) {
    // Duplikat-Schutz: interne Liste prüfen
    var exists = _addedLayers.some(function(a) { return a.name === layerDef.name && a.wmsUrl === _currentWmsUrl; });
    if (exists) {
      TnetLog.warn('[WMS-Panel] Duplikat verhindert (interne Liste):', layerDef.name);
      return;
    }
    // Duplikat-Schutz: auch auf OL-Karte prüfen (falls State desynchronisiert)
    try {
      var am = window.njs && window.njs.AppManager;
      if (!am) am = window.top && window.top.njs && window.top.njs.AppManager;
      if (am && am.Maps && am.Maps['main'] && am.Maps['main'].mapObj) {
        var mapLayers = am.Maps['main'].mapObj.getLayers().getArray();
        var onMap = mapLayers.some(function(l) {
          return l.get('name') === layerDef.name && l.get('tnet_wms_custom');
        });
        if (onMap) {
          TnetLog.warn('[WMS-Panel] Duplikat verhindert (bereits auf Karte):', layerDef.name);
          return;
        }
      }
    } catch (e) { /* Karte nicht erreichbar — weiter */ }

    var wmsUrl = _currentWmsUrl;
    var olLayer = new ol.layer.Image({
      source: new ol.source.ImageWMS({
        url: wmsUrl,
        params: {
          'LAYERS': layerDef.name,
          'FORMAT': 'image/png',
          'TRANSPARENT': true
        },
        crossOrigin: 'anonymous'
      }),
      opacity: 0.8,
      visible: true,
      zIndex: 500
    });

    olLayer.set('title', layerDef.title);
    olLayer.set('name', layerDef.name);
    olLayer.set('tnet_wms_custom', true);

    // Framework-Kompatibilität: minResolution/maxResolution setzen,
    // damit njs.MapTip.addLayerCallback keinen Null-Zugriff macht
    olLayer.setMinResolution(0);
    olLayer.setMaxResolution(Infinity);

    // Dummy-Eintrag in Framework-Layer-Config injizieren,
    // damit das Framework beim addLayer-Event keinen Null-Zugriff bekommt.
    // Das Framework sucht per Layer-Name in der Config und crasht wenn null.
    _injectFrameworkLayerConfig(layerDef.name, wmsUrl);

    // Zur Karte hinzufügen (SplitScreen-kompatibel)
    // WICHTIG: try/catch um addLayer — njs.MapTip.addLayerCallback crasht bei
    // Custom-WMS-Layern mit "Cannot read properties of null (reading 'minResolution')",
    // weil die Framework-Config-Injection den richtigen Speicherort nicht immer trifft.
    // Der Layer wird trotzdem zur OL-Collection hinzugefügt (push passiert vor dem Event).
    try {
      if (window.TnetSplitScreen && window.TnetSplitScreen.addLayerToMaps) {
        window.TnetSplitScreen.addLayerToMaps(olLayer);
      } else {
        var am = window.njs && window.njs.AppManager;
        if (!am) am = window.top && window.top.njs && window.top.njs.AppManager;
        var map = am.Maps['main'].mapObj;
        map.addLayer(olLayer);
      }
    } catch (e) {
      // Framework-Callback-Fehler abfangen — Layer ist TROTZDEM auf der Karte
      // (OL Collection.insertAt fügt Element ein BEVOR Event gefeuert wird)
      TnetLog.warn('[WMS-Panel] addLayer Framework-Fehler abgefangen:', e.message);
    }

    // LegendURL: aus Capabilities oder Fallback via GetLegendGraphic
    var legendUrl = layerDef.legendUrl || '';
    if (!legendUrl && wmsUrl) {
      // Fallback: GetLegendGraphic-URL konstruieren
      var sep = wmsUrl.indexOf('?') > -1 ? '&' : '?';
      legendUrl = wmsUrl + sep + 'SERVICE=WMS&VERSION=1.3.0&REQUEST=GetLegendGraphic&LAYER=' +
        encodeURIComponent(layerDef.name) + '&FORMAT=image/png';
    }
    olLayer.set('tnet_wms_legendUrl', legendUrl);
    olLayer.set('tnet_wms_metadataUrl', layerDef.metadataUrl || '');

    _addedLayers.push({
      olLayer: olLayer,
      name: layerDef.name,
      title: layerDef.title,
      wmsUrl: wmsUrl,
      opacity: 0.8,
      legendUrl: legendUrl,
      metadataUrl: layerDef.metadataUrl || ''
    });

    _renderAddedLayers();
    TnetLog.log('[WMS-Panel] Layer hinzugefügt:', layerDef.title, '| name:', layerDef.name, '| olLayer:', !!olLayer, '| _addedLayers:', _addedLayers.length);
  }

  // ===== LAYER ENTFERNEN =====

  function _removeWmsLayer(layerName) {
    TnetLog.log('[WMS-Panel] _removeWmsLayer aufgerufen:', layerName, '| _addedLayers:', _addedLayers.length);

    // Primär: über TnetLMStore entfernen (synchronisiert Store, Karte und Dargestellte Themen)
    var storeId = 'wms:' + layerName;
    if (window.TnetLMStore && typeof window.TnetLMStore.removeLayer === 'function') {
      TnetLog.log('[WMS-Panel] Entferne via TnetLMStore:', storeId);
      window.TnetLMStore.removeLayer(storeId);
      // Event-Listener 'tnet-wms-layer-removed' kümmert sich um _addedLayers + Checkbox
      return;
    }

    // Fallback: Store nicht verfügbar → direkte Entfernung
    TnetLog.warn('[WMS-Panel] TnetLMStore nicht verfügbar, Fallback-Entfernung:', layerName);
    _removeWmsFromMapDirect(layerName);
  }

  // Direktes Entfernen von der Karte (Fallback wenn Store nicht verfügbar)
  function _removeWmsFromMapDirect(layerName) {
    var idx = -1;
    for (var i = 0; i < _addedLayers.length; i++) {
      if (_addedLayers[i].name === layerName) { idx = i; break; }
    }
    if (idx === -1) {
      TnetLog.warn('[WMS-Panel] Fallback: Layer nicht in _addedLayers gefunden:', layerName);
      return;
    }
    var entry = _addedLayers[idx];

    try {
      var am = window.njs && window.njs.AppManager;
      if (!am) am = window.top && window.top.njs && window.top.njs.AppManager;
      if (am && am.Maps && am.Maps['main'] && am.Maps['main'].mapObj) {
        var map = am.Maps['main'].mapObj;
        map.removeLayer(entry.olLayer);
        // Zusätzlich per Name suchen (falls Referenz veraltet)
        map.getLayers().forEach(function(l) {
          if (l.get('name') === layerName && l.get('tnet_wms_custom')) {
            map.removeLayer(l);
          }
        });
      }
    } catch (e) {
      TnetLog.error('[WMS-Panel] Fallback-Entfernung fehlgeschlagen:', e);
    }

    // SplitScreen: auch von Map2 entfernen
    if (window.TnetSplitScreen && window.TnetSplitScreen.map2) {
      try {
        var layers2 = window.TnetSplitScreen.map2.getLayers().getArray().slice();
        layers2.forEach(function(l) {
          if (l.get('name') === layerName && l.get('tnet_wms_custom')) {
            window.TnetSplitScreen.map2.removeLayer(l);
          }
        });
      } catch (e) { TnetLog.warn('[WMS-Panel] SplitScreen-Entfernung fehlgeschlagen:', e); }
    }

    _addedLayers.splice(idx, 1);
    _renderAddedLayers();
    _updateLayerListCheckbox(layerName, false);
    TnetLog.log('[WMS-Panel] Layer entfernt (Fallback):', layerName, '| verbleibend:', _addedLayers.length);
  }

  function _updateLayerListCheckbox(layerName, checked) {
    var container = $('wms-layer-list');
    if (!container) return;
    var found = false;
    var items = container.querySelectorAll('.wms-layer-item');
    items.forEach(function(item) {
      var idx = parseInt(item.dataset.idx);
      // Primär: über _capabilitiesLayers-Index matchen
      var match = _capabilitiesLayers[idx] && _capabilitiesLayers[idx].name === layerName;
      // Fallback: über data-name Attribut matchen
      if (!match && item.dataset.layerName === layerName) match = true;
      if (match) {
        var cb = item.querySelector('.wms-layer-cb');
        if (cb) cb.checked = checked;
        item.classList.toggle('added', checked);
        found = true;
      }
    });
    TnetLog.log('[WMS-Panel] _updateLayerListCheckbox:', layerName, '→', checked, '| gefunden:', found);
  }

  // ===== HINZUGEFÜGTE LAYER RENDERN =====

  function _renderAddedLayers() {
    var section = $('wms-added-section');
    var list = $('wms-added-list');
    if (!section || !list) return;

    if (_addedLayers.length === 0) {
      section.style.display = 'none';
      return;
    }

    section.style.display = '';
    list.innerHTML = '';

    _addedLayers.forEach(function(entry) {
      var div = document.createElement('div');
      div.className = 'wms-added-item';

      var name = document.createElement('span');
      name.className = 'wms-added-item-name';
      name.textContent = entry.title;
      name.title = entry.name;

      var slider = document.createElement('input');
      slider.type = 'range';
      slider.className = 'wms-added-opacity';
      slider.min = 0;
      slider.max = 100;
      slider.value = Math.round(entry.opacity * 100);
      slider.title = 'Deckkraft';
      slider.oninput = function() {
        var val = parseInt(slider.value) / 100;
        entry.opacity = val;
        entry.olLayer.setOpacity(val);
      };

      // Legende-Button
      var legendBtn = document.createElement('button');
      legendBtn.className = 'wms-added-legend';
      legendBtn.title = 'Legende anzeigen';
      legendBtn.innerHTML = TnetIcons.get('legend', null, {width: '16', height: '16'});
      (function(e) {
        legendBtn.onclick = function() {
          _showWmsLegend(e.name, e.title, e.legendUrl);
        };
      })(entry);

      var removeBtn = document.createElement('button');
      removeBtn.className = 'wms-added-remove';
      removeBtn.title = 'Entfernen';
      removeBtn.innerHTML = '&times;';
      removeBtn.onclick = function() {
        _removeWmsLayer(entry.name);
      };

      div.appendChild(name);
      div.appendChild(slider);
      div.appendChild(legendBtn);
      div.appendChild(removeBtn);
      list.appendChild(div);
    });
  }

  // ===== WMS-LEGENDE ANZEIGEN =====

  /**
   * Öffnet die WMS-Legende im bestehenden Legend-FloatingPane.
   * Nutzt njs.AppManager.showLegend() falls verfügbar, sonst window.open().
   * Falls keine legendUrl vorhanden, wird eine GetLegendGraphic-Fallback-URL konstruiert.
   */
  function _showWmsLegend(layerName, layerTitle, legendUrl) {
    TnetLog.log('[WMS-Panel] Legende anzeigen:', layerTitle, '| URL:', legendUrl);

    // Falls keine URL: Fallback aus der aktuellen WMS-URL konstruieren
    if (!legendUrl && _currentWmsUrl) {
      var sep = _currentWmsUrl.indexOf('?') > -1 ? '&' : '?';
      legendUrl = _currentWmsUrl + sep + 'SERVICE=WMS&VERSION=1.3.0&REQUEST=GetLegendGraphic&LAYER=' +
        encodeURIComponent(layerName) + '&FORMAT=image/png';
    }
    // Auch in _addedLayers suchen (falls über Dargestellte Themen aufgerufen)
    if (!legendUrl) {
      for (var i = 0; i < _addedLayers.length; i++) {
        if (_addedLayers[i].name === layerName) {
          legendUrl = _addedLayers[i].legendUrl;
          if (!legendUrl && _addedLayers[i].wmsUrl) {
            var s = _addedLayers[i].wmsUrl.indexOf('?') > -1 ? '&' : '?';
            legendUrl = _addedLayers[i].wmsUrl + s + 'SERVICE=WMS&VERSION=1.3.0&REQUEST=GetLegendGraphic&LAYER=' +
              encodeURIComponent(layerName) + '&FORMAT=image/png';
          }
          break;
        }
      }
    }

    if (!legendUrl) {
      TnetLog.warn('[WMS-Panel] Keine Legenden-URL für:', layerName);
      return;
    }

    // Versuch 1: Framework-Methode (öffnet im bestehenden Legend-FloatingPane)
    try {
      var am = window.njs && window.njs.AppManager;
      if (!am) am = window.top && window.top.njs && window.top.njs.AppManager;
      if (am && typeof am.showLegend === 'function') {
        am.showLegend(legendUrl, 'Legende: ' + (layerTitle || layerName), true, undefined);
        TnetLog.log('[WMS-Panel] Legende über Framework geöffnet');
        return;
      }
    } catch (e) {
      TnetLog.warn('[WMS-Panel] Framework showLegend fehlgeschlagen:', e.message);
    }

    // Versuch 2: Neues Fenster/Tab
    window.open(legendUrl, '_blank', 'noopener');
  }

  // Export für tnet-lm-active.js (Dargestellte Themen)
  window.TnetWmsLegend = _showWmsLegend;

  // ===== ZOOM AUF LAYER =====

  function _zoomToLayer(layerDef) {
    if (!layerDef.bbox) return;
    try {
      var map = njs.AppManager.Maps['main'].mapObj;
      var bbox = layerDef.bbox;
      var extent = null;

      // WMS Capabilities liefern BoundingBox als Array von Objekten
      if (Array.isArray(bbox)) {
        // EPSG:2056 bevorzugen, sonst EPSG:4326
        var found = bbox.find(function(b) { return b.crs === 'EPSG:2056'; });
        if (found) {
          extent = [found.extent[0], found.extent[1], found.extent[2], found.extent[3]];
        } else {
          var wgs = bbox.find(function(b) { return b.crs === 'EPSG:4326' || b.crs === 'CRS:84'; });
          if (wgs) {
            extent = ol.proj.transformExtent(
              [wgs.extent[0], wgs.extent[1], wgs.extent[2], wgs.extent[3]],
              'EPSG:4326', map.getView().getProjection()
            );
          } else if (bbox[0] && bbox[0].extent) {
            // Erster Eintrag als Fallback
            extent = ol.proj.transformExtent(
              bbox[0].extent,
              bbox[0].crs || 'EPSG:4326', map.getView().getProjection()
            );
          }
        }
      } else if (bbox && typeof bbox === 'object' && bbox.length === 4) {
        // EX_GeographicBoundingBox → WGS84
        extent = ol.proj.transformExtent(bbox, 'EPSG:4326', map.getView().getProjection());
      }

      if (extent) {
        map.getView().fit(extent, { duration: 500, padding: [50, 50, 50, 50] });
      }
    } catch (e) {
      TnetLog.warn('[WMS-Panel] Zoom fehlgeschlagen:', e);
    }
  }

  // ===== FILTER =====

  function _initFilter() {
    var input = $('wms-layer-filter');
    if (!input) return;
    var timer = null;

    input.addEventListener('input', function() {
      clearTimeout(timer);
      var q = input.value.trim().toLowerCase();
      timer = setTimeout(function() {
        _filterLayerList(q);
      }, 200);
    });
  }

  function _filterLayerList(query) {
    var container = $('wms-layer-list');
    if (!container) return;
    var items = container.querySelectorAll('.wms-layer-item');

    items.forEach(function(item) {
      var idx = parseInt(item.dataset.idx);
      var layer = _capabilitiesLayers[idx];
      if (!query) {
        item.style.display = '';
        return;
      }
      var text = (layer.title + ' ' + layer.name + ' ' + layer.abstract).toLowerCase();
      item.style.display = text.indexOf(query) > -1 ? '' : 'none';
    });
  }

  // ===== PRESETS =====

  function _initPresets() {
    var select = $('wms-preset-select');
    var urlInput = $('wms-url-input');
    if (!select || !urlInput) return;

    WMS_PRESETS.forEach(function(preset) {
      var opt = document.createElement('option');
      opt.value = preset.url;
      opt.textContent = preset.name;
      select.appendChild(opt);
    });

    select.addEventListener('change', function() {
      if (select.value) {
        urlInput.value = select.value;
      }
    });

    // Enter → Laden
    urlInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        window.loadWmsCapabilities();
      }
    });
  }

  // ===== HILFSFUNKTIONEN =====

  function _escHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function _getAppManager() {
    var am = window.njs && window.njs.AppManager;
    if (!am) am = window.top && window.top.njs && window.top.njs.AppManager;
    return am;
  }

  // ===== WMS GETFEATUREINFO (OBJEKTABFRAGE) =====

  var _gfiHandlerRegistered = false;
  var _gfiRetryCount = 0;
  var _GFI_MAX_RETRIES = 15; // 15 × 2s = 30 Sekunden max

  /**
   * Registriert einen singleclick-Handler auf der Hauptkarte,
   * der für alle sichtbaren Custom-WMS-Layer GetFeatureInfo abfragt
   * und die Ergebnisse im Objektinfo-Panel (njs_info_pane) anzeigt.
   */
  function _setupWmsGetFeatureInfo() {
    if (_gfiHandlerRegistered) return;
    var am = _getAppManager();
    if (!am || !am.Maps || !am.Maps['main'] || !am.Maps['main'].mapObj) {
      _gfiRetryCount++;
      if (_gfiRetryCount <= _GFI_MAX_RETRIES) {
        TnetLog.log('[WMS-GFI] Karte nicht bereit, Retry ' + _gfiRetryCount + '/' + _GFI_MAX_RETRIES);
        setTimeout(_setupWmsGetFeatureInfo, 2000);
      } else {
        TnetLog.warn('[WMS-GFI] Karte nach ' + _GFI_MAX_RETRIES + ' Versuchen nicht bereit');
      }
      return;
    }
    var map = am.Maps['main'].mapObj;
    _gfiHandlerRegistered = true;
    TnetLog.log('[WMS-GFI] singleclick-Handler auf Hauptkarte registriert (nach ' + _gfiRetryCount + ' Retries)');

    map.on('singleclick', function(evt) {
      // ── Bridge-Gate: Wenn die Info-Bridge aktiv ist, übernimmt sie den Dispatch ──
      if (window._tnetInfoBridgeActive) {
        TnetLog.log('[WMS-GFI] singleclick ignoriert — Info-Bridge aktiv');
        return;
      }
      TnetLog.log('[WMS-GFI] === singleclick Event empfangen (Legacy-Modus) ===');

      try {
        // Gate-Check: Framework's _disablewmsgetfeatureinfo prüfen
        // (wird gesetzt wenn Mess-/Zeichen-/Druck-Tool aktiv ist)
        var currentAm = _getAppManager();
        var gfiDisabled = false;
        try {
          gfiDisabled = !!(currentAm && currentAm.MapTips &&
            currentAm.MapTips['_disablewmsgetfeatureinfo'] &&
            currentAm.MapTips['_disablewmsgetfeatureinfo']['main']);
        } catch (e) { /* ignore */ }

        TnetLog.log('[WMS-GFI] gfiDisabled:', gfiDisabled, '| _addedLayers:', _addedLayers.length);

        // Wenn GFI durch Tool blockiert UND keine Custom-WMS-Layer → nichts tun
        if (gfiDisabled && _addedLayers.length === 0) {
          TnetLog.log('[WMS-GFI] GFI durch Tool blockiert und keine Custom-WMS-Layer → Abbruch');
          return;
        }

        // ===== ALLE sichtbaren WMS-Layer auf der Karte sammeln =====
        var wmsLayers = []; // { source, title, name, isCustom }
        var processedLayerParams = {};

        // 1) Custom-WMS-Layer aus Panel (IMMER abfragen, auch ohne picking)
        _addedLayers.forEach(function(entry) {
          if (entry.olLayer && entry.olLayer.getVisible()) {
            var source = entry.olLayer.getSource();
            if (source && typeof source.getFeatureInfoUrl === 'function') {
              var layerParam = '';
              try { layerParam = source.getParams().LAYERS || ''; } catch(e) {}
              processedLayerParams[layerParam] = true;
              wmsLayers.push({
                source: source,
                title: entry.title || entry.name,
                name: entry.name,
                isCustom: true
              });
              TnetLog.log('[WMS-GFI] Custom-Layer:', entry.title, '| LAYERS:', layerParam);
            } else {
              TnetLog.log('[WMS-GFI] Custom-Layer übersprungen (kein getFeatureInfoUrl):', entry.name);
            }
          }
        });

        // 2) Framework-WMS-Layer (sofern GFI nicht durch Tool blockiert)
        if (!gfiDisabled) {
          try {
            var allLayers = map.getLayers().getArray();
            TnetLog.log('[WMS-GFI] OL-Layer auf Karte:', allLayers.length);
            allLayers.forEach(function(layer, idx) {
              if (!layer || typeof layer.getVisible !== 'function' || typeof layer.getSource !== 'function') return;
              if (!layer.getVisible()) return;

              var source = layer.getSource();
              if (!source) return;
              if (typeof source.getFeatureInfoUrl !== 'function') return;

              // URL ermitteln
              var url = null;
              if (typeof source.getUrl === 'function') url = source.getUrl();
              if (!url && typeof source.getUrls === 'function') {
                var urls = source.getUrls();
                if (urls && urls.length > 0) url = urls[0];
              }
              if (!url && source.url_) url = source.url_;

              // ArcGIS-Proxy-Layer überspringen
              if (url && url.indexOf('agsproxy.php') > -1) return;

              // mask_layer (Kantonsmaske) überspringen — unterstützt kein GFI
              var layerName = layer.get('name') || '';
              if (layerName === 'mask_layer') return;

              // Params holen
              var params = (typeof source.getParams === 'function') ? source.getParams() : null;
              var layerParam = params && params.LAYERS ? params.LAYERS : '';
              if (!layerParam || layerParam === 'mask_layer') return;

              // Duplikat-Check per LAYERS-Param
              if (processedLayerParams[layerParam]) return;
              processedLayerParams[layerParam] = true;

              // Custom-WMS-Layer Marker
              if (layer.get('tnet_wms_custom')) return;

              var name = layer.get('name') || layer.get('title') || layerParam;
              var title = layer.get('title') || layer.get('name') || layerParam;

              wmsLayers.push({
                source: source,
                title: title,
                name: name,
                isCustom: false
              });
              TnetLog.log('[WMS-GFI] Framework-Layer:', title, '| LAYERS:', layerParam);
            });
          } catch(e) {
            TnetLog.warn('[WMS-GFI] Fehler beim Scannen der Karten-Layer:', e);
          }
        }

        TnetLog.log('[WMS-GFI] Gesamt WMS-Layer zum Abfragen:', wmsLayers.length,
          '(Custom:', wmsLayers.filter(function(l){return l.isCustom;}).length,
          ', Framework:', wmsLayers.filter(function(l){return !l.isCustom;}).length + ')');

        if (wmsLayers.length === 0) {
          TnetLog.log('[WMS-GFI] Keine abfragbaren WMS-Layer gefunden → Abbruch');
          return;
        }

        var coordinate = evt.coordinate;
        var viewResolution = map.getView().getResolution();
        var projection = map.getView().getProjection();
        var requests = [];
        var features = [];

      wmsLayers.forEach(function(entry) {
        var source = entry.source;
        var layerTitle = entry.title;

        // Format-Fallback-Kette: JSON → GML → HTML → text/plain
        var formats = [
          'application/json',
          'application/geojson',
          'application/vnd.ogc.gml',
          'text/html',
          'text/plain'
        ];

        var tryFormat = function(formatIndex) {
          if (formatIndex >= formats.length) {
            TnetLog.warn('[WMS-GFI] Alle Formate fehlgeschlagen für', layerTitle);
            return Promise.resolve();
          }
          var format = formats[formatIndex];
          var url = source.getFeatureInfoUrl(
            coordinate, viewResolution, projection,
            { 'INFO_FORMAT': format, 'FEATURE_COUNT': 10 }
          );
          if (!url) {
            TnetLog.warn('[WMS-GFI] getFeatureInfoUrl liefert null für', layerTitle, format);
            return Promise.resolve();
          }

          // QUERY_LAYERS ergänzen falls fehlend
          if (url.indexOf('QUERY_LAYERS') === -1) {
            var params = source.getParams();
            if (params && params.LAYERS) {
              url += '&QUERY_LAYERS=' + params.LAYERS;
            }
          }

          // Proxy nutzen für CORS (externe URLs)
          var originalUrl = url;
          if (url.indexOf(location.origin) === -1 && url.indexOf(getAppRoot() + '/') !== 0) {
            url = getAppRoot() + '/wmsproxy.php?url=' + encodeURIComponent(url);
          }

          TnetLog.log('[WMS-GFI] Request:', layerTitle, '| Format:', format, '| URL:', url.substring(0, 120) + '...');

          return fetch(url)
            .then(function(r) {
              TnetLog.log('[WMS-GFI] Response:', layerTitle, '| Status:', r.status, '| ContentType:', r.headers.get('Content-Type'));
              return r.text();
            })
            .then(function(text) {
              if (!text || text.length === 0) {
                TnetLog.log('[WMS-GFI] Leere Response für', layerTitle, format);
                return tryFormat(formatIndex + 1);
              }

              TnetLog.log('[WMS-GFI] Response-Text (' + text.length + ' bytes):', text.substring(0, 200));

              // ServiceException → nächstes Format
              if (text.indexOf('ServiceException') > -1) {
                TnetLog.log('[WMS-GFI] ServiceException für', layerTitle, format);
                return tryFormat(formatIndex + 1);
              }

              // JSON parsen
              if (format.indexOf('json') > -1) {
                try {
                  var data = JSON.parse(text);
                  if (data.features && data.features.length > 0) {
                    var normalized = data.features.map(function(f) {
                      return { properties: f.properties || f.attributes || {} };
                    });
                    features.push({ layer: layerTitle, data: normalized });
                    TnetLog.log('[WMS-GFI] JSON Features gefunden:', normalized.length, 'für', layerTitle);
                    return;
                  } else {
                    TnetLog.log('[WMS-GFI] JSON ok aber keine Features für', layerTitle);
                  }
                } catch(e) {
                  TnetLog.log('[WMS-GFI] JSON-Parse-Fehler für', layerTitle, e.message);
                }
              }

              // GML/XML parsen
              if (text.indexOf('<?xml') === 0 || text.indexOf('<') === 0) {
                try {
                  var parser = new DOMParser();
                  var xmlDoc = parser.parseFromString(text, 'text/xml');
                  // gml:featureMember und featureMember (ohne Namespace) prüfen
                  var featureMembers = xmlDoc.getElementsByTagName('gml:featureMember');
                  if (featureMembers.length === 0) featureMembers = xmlDoc.getElementsByTagName('featureMember');
                  if (featureMembers.length > 0) {
                    var xmlFeatures = [];
                    for (var i = 0; i < featureMembers.length; i++) {
                      var attrs = {};
                      var featureNode = featureMembers[i].children[0];
                      if (featureNode) {
                        for (var j = 0; j < featureNode.children.length; j++) {
                          var child = featureNode.children[j];
                          var tagName = child.localName || child.tagName;
                          if (child.textContent && tagName !== 'boundedBy') {
                            attrs[tagName] = child.textContent;
                          }
                        }
                      }
                      if (Object.keys(attrs).length > 0) xmlFeatures.push({ properties: attrs });
                    }
                    if (xmlFeatures.length > 0) {
                      features.push({ layer: layerTitle, data: xmlFeatures });
                      TnetLog.log('[WMS-GFI] GML Features gefunden:', xmlFeatures.length, 'für', layerTitle);
                      return;
                    }
                  }
                } catch(e) {
                  TnetLog.log('[WMS-GFI] GML-Parse-Fehler für', layerTitle, e.message);
                }
              }

              // HTML-Tabelle parsen
              if (format.indexOf('html') > -1 && text.indexOf('<') > -1) {
                var tempDiv = document.createElement('div');
                tempDiv.innerHTML = text;
                var tables = tempDiv.getElementsByTagName('table');
                if (tables.length > 0) {
                  var attrs = {};
                  var rows = tables[0].getElementsByTagName('tr');
                  for (var i = 0; i < rows.length; i++) {
                    var cells = rows[i].getElementsByTagName('td');
                    if (cells.length >= 2) {
                      attrs[cells[0].textContent.trim()] = cells[1].textContent.trim();
                    }
                    // th/td Kombination
                    var ths = rows[i].getElementsByTagName('th');
                    var tds = rows[i].getElementsByTagName('td');
                    if (ths.length >= 1 && tds.length >= 1) {
                      attrs[ths[0].textContent.trim()] = tds[0].textContent.trim();
                    }
                  }
                  if (Object.keys(attrs).length > 0) {
                    features.push({ layer: layerTitle, data: [{ properties: attrs }] });
                    TnetLog.log('[WMS-GFI] HTML-Tabelle Features gefunden für', layerTitle);
                    return;
                  }
                }
                // HTML ohne Tabelle → als Raw-HTML anzeigen
                var bodyContent = text.replace(/<\/?html[^>]*>/gi, '').replace(/<\/?body[^>]*>/gi, '').replace(/<\/?head[^>]*>/gi, '').trim();
                if (bodyContent.length > 10 && bodyContent.indexOf('ServiceException') === -1) {
                  features.push({ layer: layerTitle, rawHtml: bodyContent });
                  TnetLog.log('[WMS-GFI] HTML-Rohinhalt für', layerTitle);
                  return;
                }
              }

              // text/plain parsen (MapServer key = 'value')
              if (format === 'text/plain' && text.indexOf('<?xml') !== 0) {
                var attrs = {};
                var lines = text.split('\n');
                for (var i = 0; i < lines.length; i++) {
                  var line = lines[i].trim();
                  if (line && line.indexOf('=') > -1 && !line.match(/^(Layer|Feature|GetFeatureInfo)/)) {
                    var parts = line.split('=');
                    var key = parts[0].trim();
                    var value = parts.slice(1).join('=').trim().replace(/^'|'$/g, '');
                    if (key && value) attrs[key] = value;
                  }
                }
                if (Object.keys(attrs).length > 0) {
                  features.push({ layer: layerTitle, data: [{ properties: attrs }] });
                  TnetLog.log('[WMS-GFI] text/plain Features gefunden für', layerTitle);
                  return;
                }
              }

              TnetLog.log('[WMS-GFI] Keine Features extrahiert aus', format, 'für', layerTitle);
              return tryFormat(formatIndex + 1);
            })
            .catch(function(err) {
              TnetLog.warn('[WMS-GFI] Fetch-Fehler für', layerTitle, format, err.message || err);
              return tryFormat(formatIndex + 1);
            });
        };

        requests.push(tryFormat(0));
      });

      // Alle Requests abwarten, dann Ergebnisse anzeigen
      if (requests.length > 0) {
        Promise.all(requests).then(function() {
          TnetLog.log('[WMS-GFI] Alle Requests fertig | Features:', features.length);
          if (features.length > 0) {
            _showWmsInfoResults(features, coordinate);
          }
        });
      }

      } catch(gfiErr) {
        TnetLog.error('[WMS-GFI] Unerwarteter Fehler im singleclick-Handler:', gfiErr);
      }
    });
  }

  /**
   * Entfernt alle "Keine Objekte/Ergebnisse"-Meldungen aus dem Container.
   * Bereinigt: .noInfoResults, .njs-info-no-results Elemente UND
   * lose Textknoten die "Keine" enthalten.
   */
  function _removeNoResultsMessages(container) {
    // Element-basierte Meldungen
    var noResults = container.querySelectorAll('.noInfoResults, .njs-info-no-results');
    noResults.forEach(function(n) { n.remove(); });
    // Textknoten mit "Keine Ergebnisse" oder ähnlich
    var childNodes = container.childNodes;
    for (var n = childNodes.length - 1; n >= 0; n--) {
      if (childNodes[n].nodeType === 3 && childNodes[n].textContent.indexOf('Keine') > -1) {
        container.removeChild(childNodes[n]);
      }
    }
  }

  /**
   * MutationObserver: Überwacht den Info-Container nach der WMS-Injection.
   * Falls das Framework nachträglich "Keine Objekte gefunden" schreibt
   * (Race-Condition), wird die Meldung sofort entfernt — aber NUR wenn
   * WMS-Ergebnisse (.wms-gfi-result) im Container vorhanden sind.
   * Disconnected automatisch nach 5 Sekunden.
   */
  function _watchForNoResultsMessages(container) {
    if (typeof MutationObserver === 'undefined') return;
    var observer = new MutationObserver(function(mutations) {
      // Nur handeln wenn WMS-Ergebnisse vorhanden sind
      if (!container.querySelector('.wms-gfi-result')) return;
      var hasKeineText = false;
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (node.nodeType === 3 && node.textContent.indexOf('Keine') > -1) {
            hasKeineText = true;
          } else if (node.nodeType === 1 && (
            node.classList.contains('noInfoResults') ||
            node.classList.contains('njs-info-no-results') ||
            (node.textContent && node.textContent.indexOf('Keine Objekte') > -1 && !node.querySelector('.dijitTitlePane'))
          )) {
            hasKeineText = true;
          }
        }
      }
      if (hasKeineText) {
        TnetLog.log('[WMS-GFI] Observer: "Keine Objekte" nachträglich entfernt');
        _removeNoResultsMessages(container);
      }
    });
    observer.observe(container, { childList: true, subtree: false });
    // Auto-Disconnect nach 5 Sekunden
    setTimeout(function() { observer.disconnect(); }, 5000);
  }

  /**
   * Ergebnisse im Objektinfo-Panel anzeigen.
   * Wartet bis das Framework seine Ergebnisse geschrieben hat,
   * dann hängt unsere WMS-GFI-Ergebnisse an.
   */
  function _showWmsInfoResults(features, coordinate) {
    TnetLog.log('[WMS-GFI] Ergebnisse anzeigen:', features.length, 'Layer');

    // Info-Panel sichtbar machen — NICHT InitInfoFloatingWindow
    // (das löst im Framework ein erneutes Clearing aus).
    // Stattdessen Panel direkt per Dijit/DOM öffnen.
    _ensureInfoPaneVisible();

    // Ergebnisse per Polling einsetzen: warten bis Framework fertig ist
    var attempts = 0;
    var maxAttempts = 20;
    var injected = false;

    function _tryInject() {
      attempts++;
      var container = document.getElementById('njs_info_pane_content');
      if (!container) {
        if (attempts < maxAttempts) setTimeout(_tryInject, 200);
        else TnetLog.warn('[WMS-GFI] njs_info_pane_content nach', maxAttempts, 'Versuchen nicht gefunden');
        return;
      }
      if (injected) return;

      // Prüfe ob Framework seine Arbeit beendet hat:
      // - Hat TitlePanes (Framework-Ergebnisse), ODER
      // - Zeigt "Keine Ergebnisse" / ist leer, ODER
      // - Nach 1.5 Sekunden → erzwingen
      var hasTitlePanes = container.querySelector('.dijitTitlePane');
      var hasNoResults = container.textContent.indexOf('Keine') > -1 ||
                         container.querySelector('.noInfoResults');
      var forceInject = (attempts >= 8); // 8 × 200ms = 1.6s

      if (!hasTitlePanes && !hasNoResults && !forceInject) {
        setTimeout(_tryInject, 200);
        return;
      }

      injected = true;
      TnetLog.log('[WMS-GFI] Injiziere Ergebnisse (Versuch ' + attempts + ')');

      // "Keine Ergebnisse" Meldungen des Frameworks entfernen
      _removeNoResultsMessages(container);

      // MutationObserver: Framework kann "Keine Objekte" auch NACH unserer
      // Injection schreiben (asynchrone Race-Condition).
      // Observer entfernt solche Meldungen solange WMS-Ergebnisse vorhanden sind.
      _watchForNoResultsMessages(container);

      features.forEach(function(item) {
        // Raw HTML Ergebnisse
        if (item.rawHtml) {
          _createInfoTitlePane(container, item.layer, item.rawHtml);
          return;
        }

        item.data.forEach(function(feature, featIdx) {
          var props = feature.properties || {};
          var propKeys = Object.keys(props).filter(function(k) {
            return k !== 'geometry' && k !== 'boundedBy' && props[k] !== null && props[k] !== '';
          });
          if (propKeys.length === 0) return;

          // Titel: Layer-Name + Feature-Index
          var title = item.layer;
          if (item.data.length > 1) title += ' (' + (featIdx + 1) + '/' + item.data.length + ')';

          // Attribut-Tabelle
          var tableHtml = '<table class="wms-gfi-table">';
          propKeys.forEach(function(key) {
            var val = String(props[key]);
            if (val.match(/^https?:\/\//)) {
              val = '<a href="' + _escHtml(val) + '" target="_blank" rel="noopener">' + _escHtml(val) + '</a>';
            } else {
              val = _escHtml(val);
            }
            tableHtml += '<tr><td class="wms-gfi-key">' + _escHtml(key) + '</td>';
            tableHtml += '<td class="wms-gfi-val">' + val + '</td></tr>';
          });
          tableHtml += '</table>';

          _createInfoTitlePane(container, title, tableHtml);
        });
      });
    }

    // Erste Injektion nach 400ms (Framework hat sein Clearing begonnen)
    setTimeout(_tryInject, 400);
  }

  /**
   * Info-Panel sichtbar machen ohne Framework-Clearing auszulösen.
   * Nutzt dijit.byId (falls verfügbar) oder direkten DOM-Zugriff.
   */
  function _ensureInfoPaneVisible() {
    // Versuch 1: dijit FloatingPane öffnen
    try {
      if (typeof dijit !== 'undefined' && dijit.byId) {
        var widget = dijit.byId('njs_info_pane');
        if (widget) {
          if (widget.domNode) {
            widget.domNode.style.visibility = 'visible';
            widget.domNode.style.display = 'block';
          }
          if (typeof widget.show === 'function') widget.show();
          TnetLog.log('[WMS-GFI] Info-Panel per dijit sichtbar gemacht');
          return;
        }
      }
    } catch(e) {}

    // Versuch 2: DOM-Element direkt zeigen
    var pane = document.getElementById('njs_info_pane');
    if (pane) {
      pane.style.visibility = 'visible';
      pane.style.display = 'block';
      TnetLog.log('[WMS-GFI] Info-Panel per DOM sichtbar gemacht');
    }
  }

  /**
   * Erstellt ein aufklappbares TitlePane für ein GFI-Ergebnis.
   * Nutzt Dojo dijit/TitlePane falls verfügbar, sonst HTML-Fallback.
   */
  function _createInfoTitlePane(container, title, contentHtml) {
    var wrapper = document.createElement('div');
    wrapper.className = 'wms-gfi-result';

    // Dojo TitlePane (gleich wie Framework)
    if (typeof dijit !== 'undefined' && dijit.TitlePane) {
      try {
        var contentDiv = document.createElement('div');
        contentDiv.innerHTML = contentHtml;
        container.appendChild(wrapper);
        var tp = new dijit.TitlePane({
          title: '<span class="wms-gfi-title-icon">WMS</span> ' + _escHtml(title),
          content: contentDiv,
          open: true
        });
        wrapper.appendChild(tp.domNode);
        tp.startup();
        TnetLog.log('[WMS-GFI] TitlePane erstellt:', title);
        return;
      } catch(e) {
        TnetLog.warn('[WMS-GFI] TitlePane Fehler, Fallback:', e);
      }
    }

    // HTML-Fallback
    wrapper.innerHTML =
      '<details class="wms-gfi-details" open>' +
      '<summary class="wms-gfi-summary"><span class="wms-gfi-title-icon">WMS</span> ' + _escHtml(title) + '</summary>' +
      '<div class="wms-gfi-content">' + contentHtml + '</div>' +
      '</details>';
    container.appendChild(wrapper);
  }

  // ===== SYNC MIT DARGESTELLTE THEMEN =====

  // Event-Listener: Layer wurde aus "Dargestellte Themen" entfernt
  document.addEventListener('tnet-wms-layer-removed', function(e) {
    var layerName = e.detail && e.detail.name;
    if (!layerName) return;
    TnetLog.log('[WMS-Panel] tnet-wms-layer-removed empfangen:', layerName);
    // Aus interner Liste entfernen
    var idx = -1;
    for (var i = 0; i < _addedLayers.length; i++) {
      if (_addedLayers[i].name === layerName) { idx = i; break; }
    }
    if (idx !== -1) {
      _addedLayers.splice(idx, 1);
      _renderAddedLayers();
    }
    // Checkbox IMMER aktualisieren (auch wenn Layer nicht in _addedLayers war)
    _updateLayerListCheckbox(layerName, false);
    TnetLog.log('[WMS-Panel] Layer extern entfernt:', layerName, '| _addedLayers:', _addedLayers.length);
  });

  // ===== INITIALISIERUNG =====

  function _init() {
    ensureWmsPanelDOM();
    _loadWmsConfig().then(function() {
      _initPresets();
      _initFilter();
      // GetFeatureInfo-Handler registrieren (wartet auf Karte)
      _setupWmsGetFeatureInfo();
      TnetLog.log('[WMS-Panel] Initialisiert');
    });
  }

  // WMS-Presets aus tnet-global-config.json5 laden
  function _loadWmsConfig() {
    if (_configLoaded || typeof JSON5 === 'undefined') return Promise.resolve();
    var paths = [
      getAppRoot() + '/tnet/config/tnet-global-config.json5',
      getAppRoot() + '/tnet/tnet-global-config.json5',
      '../tnet/config/tnet-global-config.json5'
    ];
    function tryPath(i) {
      if (i >= paths.length) return Promise.resolve();
      return fetch(paths[i])
        .then(function(r) { if (!r.ok) throw new Error(r.status); return r.text(); })
        .then(function(t) {
          var parsed = JSON5.parse(t);
          if (parsed && parsed.wmsPanel && Array.isArray(parsed.wmsPanel.presets) && parsed.wmsPanel.presets.length) {
            WMS_PRESETS = parsed.wmsPanel.presets;
            TnetLog.log('[WMS-Panel] Presets aus Config geladen:', WMS_PRESETS.length, 'Dienste');
          }
          _configLoaded = true;
        })
        .catch(function() { return tryPath(i + 1); });
    }
    return tryPath(0);
  }

  // Auch auf tnet-app-ready reagieren (Karte ist dann sicher bereit)
  document.addEventListener('tnet-app-ready', function() {
    if (!_gfiHandlerRegistered) {
      TnetLog.log('[WMS-GFI] tnet-app-ready empfangen — versuche Handler-Registrierung');
      _setupWmsGetFeatureInfo();
    }
  }, { once: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

  // Globale Referenz für Drag/Resize-Erweiterung
  window._savedWmsDockedWidth = 400;
  window.isWmsPanelDocked = false;

  // ===== BRIDGE-API: Exportierte Funktionen für tnet-info-bridge.js =====

  /**
   * Liefert alle sichtbaren Custom-WMS-Layer (vom Benutzer hinzugefügt).
   * Wird von der Info-Bridge aufgerufen.
   * @returns {Array<{source: ol.source.TileWMS, title: string, name: string}>}
   */
  function _getVisibleCustomLayers() {
    var result = [];
    _addedLayers.forEach(function (entry) {
      if (entry.olLayer && entry.olLayer.getVisible()) {
        var source = entry.olLayer.getSource();
        if (source && typeof source.getFeatureInfoUrl === 'function') {
          result.push({
            source: source,
            title: entry.title || entry.name,
            name: entry.name,
            isCustom: true
          });
        }
      }
    });
    return result;
  }

  /**
   * Führt GFI-Abfragen für die übergebenen Custom-WMS-Layer aus und
   * zeigt Ergebnisse im Info-Panel an.
   * Wird von der Info-Bridge aufgerufen.
   * @param {ol.MapBrowserEvent} evt - Das Click-Event
   * @param {Array} customLayers - Ergebnis von getVisibleCustomLayers()
   * @param {ol.Map} map - Die Karte
   */
  function _queryCustomLayersForBridge(evt, customLayers, map) {
    if (!customLayers || customLayers.length === 0) return;

    var coordinate = evt.coordinate;
    var viewResolution = map.getView().getResolution();
    var projection = map.getView().getProjection();
    var features = [];
    var requests = [];

    // Format-Fallback-Kette (identisch mit dem Haupt-Handler)
    var formats = [
      'application/json',
      'application/geojson',
      'application/vnd.ogc.gml',
      'text/html',
      'text/plain'
    ];

    customLayers.forEach(function (entry) {
      var source = entry.source;
      var layerTitle = entry.title;

      var tryFormat = function (formatIndex) {
        if (formatIndex >= formats.length) {
          TnetLog.warn('[WMS-GFI] Alle Formate fehlgeschlagen für', layerTitle);
          return Promise.resolve();
        }
        var format = formats[formatIndex];
        var url = source.getFeatureInfoUrl(
          coordinate, viewResolution, projection,
          { 'INFO_FORMAT': format, 'FEATURE_COUNT': 10 }
        );
        if (!url) {
          TnetLog.warn('[WMS-GFI] getFeatureInfoUrl liefert null für', layerTitle, format);
          return Promise.resolve();
        }

        // QUERY_LAYERS ergänzen falls fehlend
        if (url.indexOf('QUERY_LAYERS') === -1) {
          var params = source.getParams();
          if (params && params.LAYERS) {
            url += '&QUERY_LAYERS=' + params.LAYERS;
          }
        }

        // Proxy für CORS
        if (url.indexOf(location.origin) === -1 && url.indexOf(getAppRoot() + '/') !== 0) {
          url = getAppRoot() + '/wmsproxy.php?url=' + encodeURIComponent(url);
        }

        TnetLog.log('[WMS-GFI:Bridge] Request:', layerTitle, '| Format:', format);

        return fetch(url)
          .then(function (r) { return r.text(); })
          .then(function (text) {
            if (!text || text.length === 0) return tryFormat(formatIndex + 1);
            if (text.indexOf('ServiceException') > -1) return tryFormat(formatIndex + 1);

            // JSON
            if (format.indexOf('json') > -1) {
              try {
                var data = JSON.parse(text);
                if (data.features && data.features.length > 0) {
                  features.push({
                    layer: layerTitle,
                    data: data.features.map(function (f) {
                      return { properties: f.properties || f.attributes || {} };
                    })
                  });
                  return;
                }
              } catch (e) { /* weiter */ }
            }

            // GML/XML
            if (text.indexOf('<') === 0 || text.indexOf('<?xml') === 0) {
              try {
                var xmlDoc = new DOMParser().parseFromString(text, 'text/xml');
                var fm = xmlDoc.getElementsByTagName('gml:featureMember');
                if (fm.length === 0) fm = xmlDoc.getElementsByTagName('featureMember');
                if (fm.length > 0) {
                  var xmlFeatures = [];
                  for (var i = 0; i < fm.length; i++) {
                    var attrs = {};
                    var fn = fm[i].children[0];
                    if (fn) {
                      for (var j = 0; j < fn.children.length; j++) {
                        var c = fn.children[j];
                        var tag = c.localName || c.tagName;
                        if (c.textContent && tag !== 'boundedBy') attrs[tag] = c.textContent;
                      }
                    }
                    if (Object.keys(attrs).length > 0) xmlFeatures.push({ properties: attrs });
                  }
                  if (xmlFeatures.length > 0) {
                    features.push({ layer: layerTitle, data: xmlFeatures });
                    return;
                  }
                }
              } catch (e) { /* weiter */ }
            }

            // HTML
            if (format.indexOf('html') > -1 && text.indexOf('<') > -1) {
              var tempDiv = document.createElement('div');
              tempDiv.innerHTML = text;
              var tables = tempDiv.getElementsByTagName('table');
              if (tables.length > 0) {
                var attrs = {};
                var rows = tables[0].getElementsByTagName('tr');
                for (var i = 0; i < rows.length; i++) {
                  var cells = rows[i].getElementsByTagName('td');
                  if (cells.length >= 2) attrs[cells[0].textContent.trim()] = cells[1].textContent.trim();
                  var ths = rows[i].getElementsByTagName('th');
                  var tds = rows[i].getElementsByTagName('td');
                  if (ths.length >= 1 && tds.length >= 1) attrs[ths[0].textContent.trim()] = tds[0].textContent.trim();
                }
                if (Object.keys(attrs).length > 0) {
                  features.push({ layer: layerTitle, data: [{ properties: attrs }] });
                  return;
                }
              }
              var bodyContent = text.replace(/<\/?html[^>]*>/gi, '').replace(/<\/?body[^>]*>/gi, '').replace(/<\/?head[^>]*>/gi, '').trim();
              if (bodyContent.length > 10 && bodyContent.indexOf('ServiceException') === -1) {
                features.push({ layer: layerTitle, rawHtml: bodyContent });
                return;
              }
            }

            // text/plain
            if (format === 'text/plain' && text.indexOf('<?xml') !== 0) {
              var attrs = {};
              text.split('\n').forEach(function (line) {
                line = line.trim();
                if (line && line.indexOf('=') > -1 && !line.match(/^(Layer|Feature|GetFeatureInfo)/)) {
                  var parts = line.split('=');
                  var key = parts[0].trim();
                  var value = parts.slice(1).join('=').trim().replace(/^'|'$/g, '');
                  if (key && value) attrs[key] = value;
                }
              });
              if (Object.keys(attrs).length > 0) {
                features.push({ layer: layerTitle, data: [{ properties: attrs }] });
                return;
              }
            }

            return tryFormat(formatIndex + 1);
          })
          .catch(function (err) {
            TnetLog.warn('[WMS-GFI:Bridge] Fetch-Fehler:', layerTitle, err.message || err);
            return tryFormat(formatIndex + 1);
          });
      };

      requests.push(tryFormat(0));
    });

    if (requests.length > 0) {
      Promise.all(requests).then(function () {
        TnetLog.log('[WMS-GFI:Bridge] Alle Custom-Requests fertig | Features:', features.length);
        if (features.length > 0) {
          _showWmsInfoResults(features, coordinate);
        }
      });
    }
  }

  // ── Export für Info-Bridge ──
  window.TnetWmsPanel = window.TnetWmsPanel || {};
  window.TnetWmsPanel.getVisibleCustomLayers = _getVisibleCustomLayers;
  window.TnetWmsPanel.queryCustomLayers = _queryCustomLayersForBridge;

})();
