/**
 * tnet-lm-active.js — Dargestellte-Themen-Panel (Mobile)
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

  var LOG = '[LM-Active]';
  var _container = null;
  var _unlisteners = [];

  // ── Drag & Drop State ──
  var _dragState = null; // { item, layerId, placeholder, clone, startY, startIdx, currentIdx, listEl }

  // SVG-Icons (inline, kein externer Sprite)
  var ICON = {
    eyeOn: '<svg class="lm-icon" viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>',
    eyeOff: '<svg class="lm-icon" viewBox="0 0 24 24"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>',
    drag: '<svg class="lm-icon lm-icon-drag" viewBox="0 0 24 24"><path d="M3 15h18v-2H3v2zm0 4h18v-2H3v2zm0-8h18V9H3v2zm0-6v2h18V5H3z"/></svg>',
    remove: '<svg class="lm-icon" viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>',
    legend: '<svg class="lm-icon" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13zM6 20V4h5v5c0 .55.45 1 1 1h6v10H6z"/><rect x="8" y="13" width="8" height="1.5" rx=".5"/><rect x="8" y="16" width="5" height="1.5" rx=".5"/></svg>'
  };

  var LMActive = {

    init: function (containerId) {
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

      _unlisteners.push(store.on('active-layers-changed', this.render.bind(this)));
      _unlisteners.push(store.on('layer-visibility', this._onVisibility.bind(this)));
      _unlisteners.push(store.on('layer-opacity', this._onOpacity.bind(this)));

      // Event-Delegation
      this._bindEvents();

      // Initial-State rendern
      var active = store.getActiveLayers();
      this.render(active);
      TnetLog.log(LOG, 'Init ✓ → #' + containerId);
    },

    destroy: function () {
      _unlisteners.forEach(function (fn) { fn(); });
      _unlisteners = [];
      if (_container) _container.innerHTML = '';
    },

    // ============================================================
    // Render
    // ============================================================

    render: function (layers) {
      if (!_container) {
        TnetLog.warn(LOG, 'render: Container fehlt');
        return;
      }

      // Nicht rendern während Drag aktiv (sonst springt alles)
      if (_dragState) {
        TnetLog.log(LOG, 'render übersprungen (Drag aktiv)');
        return;
      }

      if (!layers || !layers.length) {
        _container.innerHTML = '<div class="lm-empty">Keine Themen dargestellt.<br><small style="color:#aaa">Themen im Themenkatalog aktivieren.</small></div>';
        TnetLog.log(LOG, 'render: Leerzustand');
        return;
      }
      TnetLog.log(LOG, 'render:', layers.length, 'Layer');

      var html = '<div class="lm-active-toolbar">';
      html += '<span class="lm-active-count">' + layers.length + ' Themen</span>';
      html += '<button class="lm-btn-remove-all" data-action="remove-all" title="Alle Themen entfernen">';
      html += '<svg class="lm-icon" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
      html += ' Alle entfernen</button>';
      html += '</div>';
      html += '<ul class="lm-active-list">';
      for (var i = 0; i < layers.length; i++) {
        var l = layers[i];
        var eyeIcon = l.visible ? ICON.eyeOn : ICON.eyeOff;
        var eyeCls = l.visible ? 'lm-eye' : 'lm-eye lm-eye-off';
        var opacity = (l.opacity !== undefined && l.opacity !== null) ? l.opacity : 1;
        var opacityPct = Math.round(opacity * 100);

        html += '<li class="lm-active-item" data-layer-id="' + esc(l.id) + '">';

        // Kopfzeile: Drag-Handle | Auge | Name | X
        html += '<div class="lm-active-row">';
        html += '<div class="lm-drag-handle" data-action="drag" title="Verschieben">' + ICON.drag + '</div>';
        html += '<button class="' + eyeCls + '" data-action="eye" title="Sichtbarkeit">' + eyeIcon + '</button>';
        html += '<span class="lm-active-name">' + esc(l.name) + '</span>';

        // Legende-Button: WMS immer, ArcGIS REST mit agsproxy immer, sonstige mit legendLink
        var isWms = (l.type === 'wms' || (l.id && l.id.indexOf('wms:') === 0));
        var isArcgis = (!isWms && l.layerType === 'arcgisRest' && l.url && l.url.indexOf('agsproxy.php') !== -1);
        var hasExplicitLegend = (!isWms && !isArcgis && l.legendLink && l.legendLink !== '');
        if (isWms || isArcgis || hasExplicitLegend) {
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
      }
      html += '</ul>';

      _container.innerHTML = html;
    },

    // ============================================================
    // Event-Delegation
    // ============================================================

    _bindEvents: function () {
      var self = this;

      // ── Click-Events (Eye, Remove, Remove-All) ──
      _container.addEventListener('click', function (e) {
        if (_dragState) return; // Kein Click während Drag
        var btn = e.target.closest('[data-action]');
        if (!btn) return;
        var action = btn.dataset.action;
        if (action === 'drag') return; // Drag-Handle hat eigene Handler

        // "Alle entfernen" liegt in der Toolbar, nicht in einem Item
        if (action === 'remove-all') {
          if (window.TnetLMStore && window.TnetLMStore.removeAllLayers) {
            window.TnetLMStore.removeAllLayers();
          }
          return;
        }

        var item = btn.closest('.lm-active-item');
        if (!item) return;
        var layerId = item.dataset.layerId;

        switch (action) {
          case 'eye':
            window.TnetLMStore.toggleLayerEye(layerId);
            break;
          case 'remove':
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
                      fLegendUrl = '/maps/tnet/api/v1/legend-proxy.php?service=' + encodeURIComponent(svcPath);
                      TnetLog.log(LOG, 'Legend-Proxy URL (agsproxy):', fLegendUrl);
                    }
                    // Pattern 2: Fallback /rest/services/<pfad>
                    if (!fLegendUrl) {
                      var svcIdx = svcUrl.indexOf('/rest/services/');
                      if (svcIdx !== -1) {
                        var svcPath2 = svcUrl.substring(svcIdx + 15);
                        var qIdx = svcPath2.indexOf('?');
                        if (qIdx !== -1) svcPath2 = svcPath2.substring(0, qIdx);
                        fLegendUrl = '/maps/tnet/api/v1/legend-proxy.php?service=' + encodeURIComponent(svcPath2);
                        TnetLog.log(LOG, 'Legend-Proxy URL (rest):', fLegendUrl);
                      }
                    }
                  }

                  if (fLegendUrl) {
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

      // ── Opacity-Slider ──
      _container.addEventListener('input', function (e) {
        if (e.target.matches('.lm-opacity-slider')) {
          var item = e.target.closest('.lm-active-item');
          if (!item) return;
          var val = parseInt(e.target.value, 10) / 100;
          var valLabel = item.querySelector('.lm-opacity-val');
          if (valLabel) valLabel.textContent = Math.round(val * 100) + '%';
          window.TnetLMStore.setLayerOpacity(item.dataset.layerId, val);
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
      var item = handle.closest('.lm-active-item');
      if (!item) return;
      var listEl = _container.querySelector('.lm-active-list');
      if (!listEl) return;

      var layerId = item.dataset.layerId;
      var items = Array.prototype.slice.call(listEl.querySelectorAll('.lm-active-item'));
      var startIdx = items.indexOf(item);
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

      // Ziel-Index berechnen
      var items = Array.prototype.slice.call(ds.listEl.querySelectorAll('.lm-active-item:not(.lm-drag-hidden)'));
      var newIdx = ds.currentIdx;

      for (var i = 0; i < items.length; i++) {
        var r = items[i].getBoundingClientRect();
        var midY = r.top + r.height / 2;
        if (clientY < midY) {
          newIdx = i;
          break;
        }
        newIdx = i + 1;
      }

      // Placeholder-Position korrigieren (Achtung: startIdx offset berücksichtigen)
      var allItems = Array.prototype.slice.call(ds.listEl.children);
      var placeholderCurrentIdx = allItems.indexOf(ds.placeholder);

      // Placeholder an gewünschte Position verschieben
      if (newIdx !== ds.currentIdx) {
        // Placeholder entfernen und neu einfügen
        ds.placeholder.remove();

        // Alle sichtbaren Items (ohne hidden und placeholder)
        var visibleItems = Array.prototype.slice.call(
          ds.listEl.querySelectorAll('.lm-active-item:not(.lm-drag-hidden)')
        );

        if (newIdx >= visibleItems.length) {
          // Am Ende einfügen
          ds.listEl.appendChild(ds.placeholder);
        } else {
          ds.listEl.insertBefore(ds.placeholder, visibleItems[newIdx]);
        }

        ds.currentIdx = newIdx;
      }
    },

    _dragEnd: function () {
      if (!_dragState) return;
      var ds = _dragState;

      // Aufräumen
      ds.clone.remove();
      ds.placeholder.remove();
      ds.item.classList.remove('lm-drag-hidden');
      ds.listEl.classList.remove('lm-dragging');

      // Store aktualisieren (nur wenn sich Position geändert hat)
      var finalIdx = ds.currentIdx;
      // currentIdx ist relativ zu sichtbaren Items, muss auf Gesamt-Array umgerechnet werden
      // Da wir das hidden-Item nicht mitzählen, ist der Offset korrekt wenn startIdx < finalIdx
      if (ds.startIdx < finalIdx) {
        // Element wurde nach unten verschoben — finalIdx ist schon korrekt
      }
      // Kein Offset nötig, da reorderLayer mit absolutem Index arbeitet

      if (ds.startIdx !== finalIdx) {
        window.TnetLMStore.reorderLayer(ds.layerId, finalIdx);
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

    _onVisibility: function (evt) {
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
      if (!_container || _dragState) return;
      var item = _container.querySelector('[data-layer-id="' + evt.id + '"]');
      if (!item) return;

      var slider = item.querySelector('.lm-opacity-slider');
      var valLabel = item.querySelector('.lm-opacity-val');
      var pct = Math.round(evt.opacity * 100);
      if (slider) slider.value = pct;
      if (valLabel) valLabel.textContent = pct + '%';
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
