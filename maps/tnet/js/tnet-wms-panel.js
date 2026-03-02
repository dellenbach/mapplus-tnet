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

  // ===== KONFIGURATION =====

  // Vordefinierte WMS-Dienste (Name + GetCapabilities-URL)
  var WMS_PRESETS = [
    { name: 'Swisstopo WMS', url: 'https://wms.geo.admin.ch/?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities' },
    { name: 'Kt. Nidwalden (NSDI)', url: 'https://www.geoservice.apps.be.ch/geoservice3/services/a4p/a4p_kanton_de_ms_wms/MapServer/WMSServer?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities' },
    { name: 'Kt. Luzern', url: 'https://spatial.geo.lu.ch/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities' },
    { name: 'Kt. Uri', url: 'https://geodienste.ur.ch/geoportal/services/Basiskarten/MapServer/WMSServer?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities' },
    { name: 'Kt. Bern', url: 'https://www.geoservice.apps.be.ch/geoservice3/services/a4p/a4p_basiswmsk_de/MapServer/WMSServer?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities' }
  ];

  // State
  var _addedLayers = [];  // { olLayer, name, title, wmsUrl, opacity }
  var _isWmsDocked = false;
  var _savedWmsPosition = null;
  var _capabilitiesLayers = [];  // Letzte GetCapabilities-Ergebnisse
  var _currentWmsUrl = '';

  // ===== DOM-REFERENZEN =====

  function $(id) { return document.getElementById(id); }

  // ===== PANEL TOGGLE =====

  window.toggleWmsPanel = function() {
    var panel = $('wms-panel');
    if (!panel) return;
    // Hamburger-Menü schliessen
    var menu = document.getElementById('header_menu');
    if (menu) menu.classList.remove('open');

    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) {
      console.log('[WMS-Panel] Geöffnet');
    }
  };

  window.closeWmsPanel = function() {
    var panel = $('wms-panel');
    if (!panel) return;
    // Falls gedockt: undocken beim Schliessen
    if (_isWmsDocked) {
      _undockWms();
    }
    panel.classList.add('hidden');
  };

  // ===== DOCK/UNDOCK =====

  window.toggleWmsDock = function() {
    if (_isWmsDocked) {
      _undockWms();
    } else {
      _dockWms();
    }
  };

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
    var centerPane = document.getElementById('centerPaneLayout');
    var streetviewContainer = document.getElementById('streetviewContainer');
    var streetviewWidth = 0;
    if (streetviewContainer && streetviewContainer.offsetWidth > 0 && streetviewContainer.style.display !== 'none') {
      streetviewWidth = streetviewContainer.offsetWidth;
    }

    panel.style.setProperty('width', panelWidth + 'px', 'important');
    panel.style.setProperty('right', streetviewWidth + 'px', 'important');

    if (mapContainer) {
      var centerPaneWidth = centerPane ? centerPane.offsetWidth : window.innerWidth;
      var mapWidth = centerPaneWidth - streetviewWidth - panelWidth;
      mapContainer.style.setProperty('width', mapWidth + 'px', 'important');
      _triggerMapUpdate();
    }

    if (dockBtn) {
      dockBtn.title = 'Floating';
      dockBtn.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z"/></svg>';
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
      dockBtn.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16h-4V5h4v14z"/></svg>';
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
        console.warn('[WMS-Panel] Direkter Zugriff fehlgeschlagen, versuche Proxy:', err.message);
        // Über Proxy versuchen
        var proxyUrl = '/maps/wmsproxy.php?url=' + encodeURIComponent(capUrl);
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
      console.error('[WMS-Panel] Parse-Fehler:', e);
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
      list.push({
        name: layerObj.Name,
        title: layerObj.Title || layerObj.Name,
        abstract: layerObj.Abstract || '',
        bbox: layerObj.BoundingBox || layerObj.EX_GeographicBoundingBox || null,
        queryable: layerObj.queryable !== false
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

      // Zoom-Button
      if (layer.bbox) {
        var zoomBtn = document.createElement('button');
        zoomBtn.className = 'wms-layer-action-btn';
        zoomBtn.title = 'Auf Layer zoomen';
        zoomBtn.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zM5 9.5C5 7.01 7.01 5 9.5 5S14 7.01 14 9.5 11.99 14 9.5 14 5 11.99 5 9.5z"/></svg>';
        zoomBtn.onclick = function(e) {
          e.stopPropagation();
          _zoomToLayer(layer);
        };
        actions.appendChild(zoomBtn);
      }

      // Nur Zoom-Button rechts — Checkbox links ist der Ein/Aus-Schalter

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
        console.log('[WMS-Panel] cb.change:', layer.name, '→ checked:', cb.checked);
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

  // ===== LAYER ZUR KARTE HINZUFÜGEN =====

  function _addWmsLayer(layerDef) {
    // Duplikat-Schutz: interne Liste prüfen
    var exists = _addedLayers.some(function(a) { return a.name === layerDef.name && a.wmsUrl === _currentWmsUrl; });
    if (exists) {
      console.warn('[WMS-Panel] Duplikat verhindert (interne Liste):', layerDef.name);
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
          console.warn('[WMS-Panel] Duplikat verhindert (bereits auf Karte):', layerDef.name);
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

    // Zur Karte hinzufügen (SplitScreen-kompatibel)
    if (window.TnetSplitScreen && window.TnetSplitScreen.addLayerToMaps) {
      window.TnetSplitScreen.addLayerToMaps(olLayer);
    } else {
      try {
        var am = window.njs && window.njs.AppManager;
        if (!am) am = window.top && window.top.njs && window.top.njs.AppManager;
        var map = am.Maps['main'].mapObj;
        map.addLayer(olLayer);
      } catch (e) {
        console.error('[WMS-Panel] Karte nicht erreichbar:', e);
      }
    }

    _addedLayers.push({
      olLayer: olLayer,
      name: layerDef.name,
      title: layerDef.title,
      wmsUrl: wmsUrl,
      opacity: 0.8
    });

    _renderAddedLayers();
    console.log('[WMS-Panel] Layer hinzugefügt:', layerDef.title, '| name:', layerDef.name, '| olLayer:', !!olLayer, '| _addedLayers:', _addedLayers.length);
  }

  // ===== LAYER ENTFERNEN =====

  function _removeWmsLayer(layerName) {
    console.log('[WMS-Panel] _removeWmsLayer aufgerufen:', layerName, '| _addedLayers:', _addedLayers.length);

    // Primär: über TnetLMStore entfernen (synchronisiert Store, Karte und Dargestellte Themen)
    var storeId = 'wms:' + layerName;
    if (window.TnetLMStore && typeof window.TnetLMStore.removeLayer === 'function') {
      console.log('[WMS-Panel] Entferne via TnetLMStore:', storeId);
      window.TnetLMStore.removeLayer(storeId);
      // Event-Listener 'tnet-wms-layer-removed' kümmert sich um _addedLayers + Checkbox
      return;
    }

    // Fallback: Store nicht verfügbar → direkte Entfernung
    console.warn('[WMS-Panel] TnetLMStore nicht verfügbar, Fallback-Entfernung:', layerName);
    _removeWmsFromMapDirect(layerName);
  }

  // Direktes Entfernen von der Karte (Fallback wenn Store nicht verfügbar)
  function _removeWmsFromMapDirect(layerName) {
    var idx = -1;
    for (var i = 0; i < _addedLayers.length; i++) {
      if (_addedLayers[i].name === layerName) { idx = i; break; }
    }
    if (idx === -1) {
      console.warn('[WMS-Panel] Fallback: Layer nicht in _addedLayers gefunden:', layerName);
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
      console.error('[WMS-Panel] Fallback-Entfernung fehlgeschlagen:', e);
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
      } catch (e) { console.warn('[WMS-Panel] SplitScreen-Entfernung fehlgeschlagen:', e); }
    }

    _addedLayers.splice(idx, 1);
    _renderAddedLayers();
    _updateLayerListCheckbox(layerName, false);
    console.log('[WMS-Panel] Layer entfernt (Fallback):', layerName, '| verbleibend:', _addedLayers.length);
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
    console.log('[WMS-Panel] _updateLayerListCheckbox:', layerName, '→', checked, '| gefunden:', found);
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

      var removeBtn = document.createElement('button');
      removeBtn.className = 'wms-added-remove';
      removeBtn.title = 'Entfernen';
      removeBtn.innerHTML = '&times;';
      removeBtn.onclick = function() {
        _removeWmsLayer(entry.name);
      };

      div.appendChild(name);
      div.appendChild(slider);
      div.appendChild(removeBtn);
      list.appendChild(div);
    });
  }

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
      console.warn('[WMS-Panel] Zoom fehlgeschlagen:', e);
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

  // ===== SYNC MIT DARGESTELLTE THEMEN =====

  // Event-Listener: Layer wurde aus "Dargestellte Themen" entfernt
  document.addEventListener('tnet-wms-layer-removed', function(e) {
    var layerName = e.detail && e.detail.name;
    if (!layerName) return;
    console.log('[WMS-Panel] tnet-wms-layer-removed empfangen:', layerName);
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
    console.log('[WMS-Panel] Layer extern entfernt:', layerName, '| _addedLayers:', _addedLayers.length);
  });

  // ===== INITIALISIERUNG =====

  function _init() {
    _initPresets();
    _initFilter();
    console.log('[WMS-Panel] Initialisiert');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

  // Globale Referenz für Drag/Resize-Erweiterung
  window._savedWmsDockedWidth = 400;
  window.isWmsPanelDocked = false;

})();
