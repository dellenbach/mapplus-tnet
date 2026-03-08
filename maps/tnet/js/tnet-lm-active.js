/**
 * tnet-lm-active.js — Dargestellte-Themen-Panel (Desktop + Mobile)
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

  // ── Coalesce-Gruppen Expand-State ──
  var _groupExpanded = {}; // groupId → boolean (default: true = aufgeklappt)

  // SVG-Icons — geladen via TnetIcons (externe .svg Dateien)
  // Werden in _initIcons() befüllt nachdem TnetIcons.loadAll() abgeschlossen ist
  var ICON = {};

  function _initIcons() {
    ICON.eyeOn    = TnetIcons.get('eye-on', 'lm-icon');
    ICON.eyeOff   = TnetIcons.get('eye-off', 'lm-icon');
    ICON.drag     = TnetIcons.get('drag-handle', 'lm-icon lm-icon-drag');
    ICON.remove   = TnetIcons.get('close', 'lm-icon');
    ICON.legend   = TnetIcons.get('legend', 'lm-icon');
    ICON.expand   = TnetIcons.get('chevron-right', 'lm-icon');
    ICON.collapse = TnetIcons.get('chevron-down', 'lm-icon');
    ICON.group    = TnetIcons.get('folder', 'lm-icon');
    ICON.trash    = TnetIcons.get('trash', 'lm-icon');
  }

  var LMActive = {

    init: function (containerId) {
      _initIcons();
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

      // Einträge gruppieren (Standalone vs. Coalesce-Gruppen)
      var entries = this._buildActiveEntries(layers);
      var totalLayers = layers.length;

      TnetLog.log(LOG, 'render:', totalLayers, 'Layer,', entries.length, 'Einträge');

      var html = '<div class="lm-active-toolbar">';
      html += '<span class="lm-active-count">' + totalLayers + ' Themen</span>';
      html += '<button class="lm-btn-remove-all" data-action="remove-all" title="Alle Themen entfernen">';
      html += ICON.trash;
      html += ' Alle entfernen</button>';
      html += '</div>';
      html += '<ul class="lm-active-list">';

      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (entry.type === 'group') {
          html += this._renderGroup(entry);
        } else {
          html += this._renderStandalone(entry.layer);
        }
      }

      html += '</ul>';
      _container.innerHTML = html;
    },

    /**
     * Gruppiert aktive Layer in Standalone und Coalesce-Gruppen.
     * Reihenfolge: Erster Layer einer Gruppe bestimmt Position der gesamten Gruppe.
     */
    _buildActiveEntries: function (layers) {
      var entries = [];
      var seenGroups = {};  // groupId → entry-Object
      var store = window.TnetLMStore;

      for (var i = 0; i < layers.length; i++) {
        var l = layers[i];
        var coalInfo = store ? store.getCoalesceInfo(l.id) : null;

        if (coalInfo) {
          if (!seenGroups[coalInfo.groupId]) {
            // Erste Layer dieser Coalesce-Gruppe → neuer Eintrag
            var entry = {
              type: 'group',
              groupId: coalInfo.groupId,
              groupName: coalInfo.groupName,
              serviceUrl: coalInfo.serviceUrl,
              children: [l]
            };
            entries.push(entry);
            seenGroups[coalInfo.groupId] = entry;
          } else {
            // Weiterer Layer derselben Gruppe
            seenGroups[coalInfo.groupId].children.push(l);
          }
        } else {
          entries.push({ type: 'standalone', layer: l });
        }
      }

      return entries;
    },

    /**
     * Rendert einen einzelnen Standalone-Layer (identisch zum bisherigen Verhalten).
     */
    _renderStandalone: function (l) {
      var eyeIcon = l.visible ? ICON.eyeOn : ICON.eyeOff;
      var eyeCls = l.visible ? 'lm-eye' : 'lm-eye lm-eye-off';
      var opacity = (l.opacity !== undefined && l.opacity !== null) ? l.opacity : 1;
      var opacityPct = Math.round(opacity * 100);

      var html = '<li class="lm-active-item" data-layer-id="' + esc(l.id) + '">';

      // Kopfzeile: Drag-Handle | Auge | Name | Legende | X
      html += '<div class="lm-active-row">';
      html += '<div class="lm-drag-handle" data-action="drag" title="Verschieben">' + ICON.drag + '</div>';
      html += '<button class="' + eyeCls + '" data-action="eye" title="Sichtbarkeit">' + eyeIcon + '</button>';
      html += '<span class="lm-active-name">' + esc(l.name) + '</span>';

      // Legende-Button
      if (this._hasLegend(l)) {
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
      return html;
    },

    /**
     * Rendert eine Coalesce-Gruppe:
     * - Gruppen-Header: Auge | Ordner-Icon | Name | Expand/Collapse | X
     * - Gemeinsamer Opazitäts-Slider
     * - Kind-Layer (wenn aufgeklappt): nur Auge + Name
     */
    _renderGroup: function (entry) {
      var groupId = entry.groupId;
      var expanded = (_groupExpanded[groupId] !== undefined) ? _groupExpanded[groupId] : true;
      var expandCls = expanded ? '' : ' lm-collapsed';

      // Mittlere Opazität der Kinder berechnen
      var totalOpacity = 0;
      var anyVisible = false;
      for (var i = 0; i < entry.children.length; i++) {
        var c = entry.children[i];
        totalOpacity += (c.opacity !== undefined && c.opacity !== null) ? c.opacity : 1;
        if (c.visible !== false) anyVisible = true;
      }
      var avgOpacity = entry.children.length > 0 ? totalOpacity / entry.children.length : 1;
      var opacityPct = Math.round(avgOpacity * 100);

      var eyeIcon = anyVisible ? ICON.eyeOn : ICON.eyeOff;
      var eyeCls = anyVisible ? 'lm-eye' : 'lm-eye lm-eye-off';
      var expandIcon = expanded ? ICON.collapse : ICON.expand;

      var html = '<li class="lm-active-group' + expandCls + '" data-group-id="' + esc(groupId) + '">';

      // Gruppen-Header
      html += '<div class="lm-active-group-header">';
      html += '<div class="lm-drag-handle" data-action="drag" title="Verschieben">' + ICON.drag + '</div>';
      html += '<button class="' + eyeCls + '" data-action="group-eye" title="Gruppe ein/aus">' + eyeIcon + '</button>';
      html += '<span class="lm-active-group-icon">' + ICON.group + '</span>';
      html += '<span class="lm-active-group-name">' + esc(entry.groupName) + '</span>';
      // Legende-Button (Dienst-URL vorhanden)
      if (entry.serviceUrl) {
        html += '<button class="lm-btn-legend" data-action="group-legend" title="Legende anzeigen">' + ICON.legend + '</button>';
      }
      html += '<button class="lm-btn-expand" data-action="group-expand" title="Auf-/Zuklappen">' + expandIcon + '</button>';
      html += '<button class="lm-btn-remove" data-action="group-remove" title="Gruppe entfernen">' + ICON.remove + '</button>';
      html += '</div>';

      // Gemeinsamer Opazitäts-Slider
      html += '<div class="lm-opacity-row">';
      html += '<span class="lm-opacity-label">Deckkraft</span>';
      html += '<input type="range" class="lm-opacity-slider lm-group-opacity" data-action="group-opacity" min="0" max="100" value="' + opacityPct + '">';
      html += '<span class="lm-opacity-val">' + opacityPct + '%</span>';
      html += '</div>';

      // Kind-Layer
      html += '<ul class="lm-active-group-children">';
      for (var j = 0; j < entry.children.length; j++) {
        html += this._renderGroupChild(entry.children[j]);
      }
      html += '</ul>';

      html += '</li>';
      return html;
    },

    /**
     * Rendert ein Kind-Layer innerhalb einer Coalesce-Gruppe.
     * Nur Auge-Toggle + Name (kein Drag, kein eigener Opacity-Slider).
     */
    _renderGroupChild: function (l) {
      var eyeIcon = l.visible ? ICON.eyeOn : ICON.eyeOff;
      var eyeCls = l.visible ? 'lm-eye' : 'lm-eye lm-eye-off';

      var html = '<li class="lm-active-group-child" data-layer-id="' + esc(l.id) + '">';
      html += '<button class="' + eyeCls + '" data-action="child-eye" title="Sichtbarkeit">' + eyeIcon + '</button>';
      html += '<span class="lm-active-name">' + esc(l.name) + '</span>';
      html += '</li>';
      return html;
    },

    /**
     * Prüft ob ein Layer einen Legenden-Button erhalten soll.
     */
    _hasLegend: function (l) {
      var isWms = (l.type === 'wms' || (l.id && l.id.indexOf('wms:') === 0));
      var isArcgis = (!isWms && l.layerType === 'arcgisRest' && l.url && l.url.indexOf('agsproxy.php') !== -1);
      var hasExplicitLegend = (!isWms && !isArcgis && l.legendLink && l.legendLink !== '');
      return isWms || isArcgis || hasExplicitLegend;
    },

    // ============================================================
    // Event-Delegation
    // ============================================================

    _bindEvents: function () {
      var self = this;

      // ── Click-Events (Eye, Remove, Remove-All, Gruppen-Aktionen) ──
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

        // ── Coalesce-Gruppen-Aktionen ──
        var groupEl = btn.closest('.lm-active-group');

        if (action === 'group-eye' && groupEl) {
          var gid = groupEl.dataset.groupId;
          if (window.TnetLMStore) window.TnetLMStore.toggleCoalesceGroupEye(gid);
          return;
        }
        if (action === 'group-remove' && groupEl) {
          var gid2 = groupEl.dataset.groupId;
          if (window.TnetLMStore) window.TnetLMStore.removeCoalesceGroup(gid2);
          return;
        }
        if (action === 'group-expand' && groupEl) {
          var gid3 = groupEl.dataset.groupId;
          var isExpanded = !groupEl.classList.contains('lm-collapsed');
          _groupExpanded[gid3] = !isExpanded;
          groupEl.classList.toggle('lm-collapsed', isExpanded);
          // Icon austauschen
          btn.innerHTML = isExpanded ? ICON.expand : ICON.collapse;
          return;
        }
        if (action === 'group-legend' && groupEl) {
          self._openGroupLegend(groupEl.dataset.groupId);
          return;
        }
        if (action === 'child-eye') {
          var childEl = btn.closest('.lm-active-group-child');
          if (childEl) {
            var childId = childEl.dataset.layerId;
            if (window.TnetLMStore) window.TnetLMStore.toggleLayerEye(childId);
          }
          return;
        }

        // ── Standalone-Layer-Aktionen ──
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

      // ── Opacity-Slider (Standalone + Gruppen) ──
      _container.addEventListener('input', function (e) {
        if (e.target.matches('.lm-opacity-slider')) {
          var val = parseInt(e.target.value, 10) / 100;
          var valLabel = e.target.closest('.lm-opacity-row');
          if (valLabel) {
            var span = valLabel.querySelector('.lm-opacity-val');
            if (span) span.textContent = Math.round(val * 100) + '%';
          }

          // Gruppen-Opazität
          if (e.target.matches('.lm-group-opacity')) {
            var groupEl = e.target.closest('.lm-active-group');
            if (groupEl) {
              window.TnetLMStore.setCoalesceGroupOpacity(groupEl.dataset.groupId, val);
            }
            return;
          }

          // Standalone-Opazität
          var item = e.target.closest('.lm-active-item');
          if (item) {
            window.TnetLMStore.setLayerOpacity(item.dataset.layerId, val);
          }
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
      // Sowohl Standalone-Items als auch Gruppen können gezogen werden
      var item = handle.closest('.lm-active-item') || handle.closest('.lm-active-group');
      if (!item) return;
      var listEl = _container.querySelector('.lm-active-list');
      if (!listEl) return;

      var layerId = item.dataset.layerId || item.dataset.groupId || '';
      var isGroup = item.classList.contains('lm-active-group');
      // Alle Top-Level-Einträge (Items + Gruppen) als sortierbare Elemente
      var entries = Array.prototype.slice.call(listEl.querySelectorAll(':scope > .lm-active-item, :scope > .lm-active-group'));
      var startIdx = entries.indexOf(item);
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
        isGroup: isGroup,
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

      // Ziel-Index berechnen — alle Top-Level-Einträge (Items + Gruppen)
      var selector = ':scope > .lm-active-item:not(.lm-drag-hidden), :scope > .lm-active-group:not(.lm-drag-hidden)';
      var visibleEntries = Array.prototype.slice.call(ds.listEl.querySelectorAll(selector));
      var newIdx = ds.currentIdx;

      for (var i = 0; i < visibleEntries.length; i++) {
        var r = visibleEntries[i].getBoundingClientRect();
        var midY = r.top + r.height / 2;
        if (clientY < midY) {
          newIdx = i;
          break;
        }
        newIdx = i + 1;
      }

      // Placeholder an gewünschte Position verschieben
      if (newIdx !== ds.currentIdx) {
        ds.placeholder.remove();

        if (newIdx >= visibleEntries.length) {
          ds.listEl.appendChild(ds.placeholder);
        } else {
          ds.listEl.insertBefore(ds.placeholder, visibleEntries[newIdx]);
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

      // Neue Reihenfolge aus DOM lesen und an Store übergeben
      if (ds.startIdx !== ds.currentIdx) {
        var orderedIds = this._readOrderFromDOM(ds.listEl);
        if (orderedIds.length > 0 && window.TnetLMStore && window.TnetLMStore.setActiveLayerOrder) {
          window.TnetLMStore.setActiveLayerOrder(orderedIds);
        }
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

    /**
     * Liest die Layer-Reihenfolge aus der aktuellen DOM-Struktur.
     * Gruppen-Kinder werden inline expandiert.
     * @param {HTMLElement} listEl
     * @returns {string[]}
     */
    _readOrderFromDOM: function (listEl) {
      var orderedIds = [];
      var entries = listEl.querySelectorAll(':scope > .lm-active-item, :scope > .lm-active-group');
      for (var i = 0; i < entries.length; i++) {
        var el = entries[i];
        if (el.classList.contains('lm-active-group')) {
          // Gruppen-Kinder in DOM-Reihenfolge
          var children = el.querySelectorAll('.lm-active-group-child[data-layer-id]');
          for (var c = 0; c < children.length; c++) {
            orderedIds.push(children[c].dataset.layerId);
          }
        } else {
          orderedIds.push(el.dataset.layerId);
        }
      }
      return orderedIds;
    },

    /**
     * Öffnet die Legende für eine Coalesce-Gruppe.
     * Konstruiert die legend-proxy URL aus der Dienst-URL.
     * @param {string} groupId
     */
    _openGroupLegend: function (groupId) {
      try {
        var store = window.TnetLMStore;
        if (!store) return;
        // Gruppen-Info holen — serviceUrl + groupName
        var layers = store.getActiveLayers();
        var coalInfo = null;
        for (var i = 0; i < layers.length; i++) {
          coalInfo = store.getCoalesceInfo(layers[i].id);
          if (coalInfo && coalInfo.groupId === groupId) break;
          coalInfo = null;
        }
        if (!coalInfo || !coalInfo.serviceUrl) {
          TnetLog.warn(LOG, 'Keine serviceUrl für Gruppe:', groupId);
          return;
        }

        var svcUrl = coalInfo.serviceUrl;
        var legendUrl = '';

        // agsproxy.php?path=<service-pfad>
        var proxyIdx = svcUrl.indexOf('agsproxy.php?path=');
        if (proxyIdx !== -1) {
          var svcPath = svcUrl.substring(proxyIdx + 18);
          // MapServer und alles danach entfernen
          var msIdx = svcPath.indexOf('/MapServer');
          if (msIdx !== -1) svcPath = svcPath.substring(0, msIdx);
          legendUrl = '/maps/tnet/api/v1/legend-proxy.php?service=' + encodeURIComponent(svcPath);
        }
        // Fallback: /rest/services/<pfad>/MapServer
        if (!legendUrl) {
          var restIdx = svcUrl.indexOf('/rest/services/');
          if (restIdx !== -1) {
            var svcPath2 = svcUrl.substring(restIdx + 15);
            var qIdx = svcPath2.indexOf('?');
            if (qIdx !== -1) svcPath2 = svcPath2.substring(0, qIdx);
            var msIdx2 = svcPath2.indexOf('/MapServer');
            if (msIdx2 !== -1) svcPath2 = svcPath2.substring(0, msIdx2);
            legendUrl = '/maps/tnet/api/v1/legend-proxy.php?service=' + encodeURIComponent(svcPath2);
          }
        }

        if (!legendUrl) {
          TnetLog.warn(LOG, 'Keine Legenden-URL konstruierbar für:', svcUrl);
          return;
        }

        var legendTitle = coalInfo.groupName || groupId;

        var am = window.njs && window.njs.AppManager;
        if (!am) am = window.top && window.top.njs && window.top.njs.AppManager;
        if (am && typeof am.showLegend === 'function') {
          am.showLegend(legendUrl, legendTitle, true, undefined);
          TnetLog.log(LOG, 'Gruppen-Legende geöffnet:', legendUrl);
        } else {
          window.open(legendUrl, '_blank', 'noopener');
        }
      } catch (e) {
        TnetLog.error(LOG, 'Fehler beim Öffnen der Gruppen-Legende:', e);
      }
    },

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
