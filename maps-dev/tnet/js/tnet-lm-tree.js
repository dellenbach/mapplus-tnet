/**
 * tnet-lm-tree.js — Themenkatalog-Baum (Desktop + Mobile)
 *
 * Rendert die Layer-Hierarchie als Accordion-Baum mit Inline-Filter.
 * Struktur: Tab-Bar (Wappen) → Subcategories → Groups → Layers
 *
 * Die Suche filtert den Baum direkt (show/hide), statt separate
 * Ergebnisse anzuzeigen. Elternknoten werden automatisch geöffnet.
 *
 * @version 2.0
 * @copyright Trigonet AG
 */
(function () {
  'use strict';

  function getAppRoot() {
    return window.__TNET_APP_ROOT || '/maps';
  }

  var LOG = '[LM-Tree]';
  var _container = null;
  var _searchTimeout = null;
  var _activeTabId = null;
  var _renderedTabs = {};
  var _unlisteners = [];
  var _currentFilter = '';
  // Koalesziert active-layers-changed (Bookmark-Load) → ein Checkbox-Resync/Frame.
  var _resyncRaf = null;

  /** Wappen-/Icon-Mapping */
  // SVG Legend-Icon (Farbquadrate mit Linien) — geladen via TnetIcons
  function getLegendIconSvg() {
    return TnetIcons.get('legend-colors', null, {width: '14', height: '14', style: 'vertical-align:-2px'});
  }

  var CATEGORY_ICONS = {
    'nidwalden': { label: 'NW', wappen: getAppRoot() + '/tnet/resources/wappen_nidwalden.svg' },
    'obwalden':  { label: 'OW', wappen: getAppRoot() + '/tnet/resources/wappen_obwalden.svg' },
    'bund':      { label: 'CH', wappen: getAppRoot() + '/tnet/resources/wappen_bund.svg' },
    'weitere':   { label: '…',  wappen: getAppRoot() + '/tnet/resources/icon_weitere.svg' }
  };

  var LMTree = {

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

      _unlisteners.push(store.on('catalog-loaded', this.render.bind(this)));
      _unlisteners.push(store.on('layer-visibility', this._onLayerVisibility.bind(this)));
      _unlisteners.push(store.on('active-layers-changed', this._onActiveLayersChanged.bind(this)));
      _unlisteners.push(store.on('group-toggled', this._onGroupToggled.bind(this)));

      var self = this;
      var onBookmarkLoaded = function () {
        self._syncToActiveBookmark();
      };
      document.addEventListener('tnet-bookmark-loaded', onBookmarkLoaded);
      _unlisteners.push(function () {
        document.removeEventListener('tnet-bookmark-loaded', onBookmarkLoaded);
      });

      if (store.isLoaded()) {
        this.render(store.getCatalog());
      }

      // Resolution-Listener: Layer ausserhalb des Massstabsbereichs ausgrauen
      this._initResolutionWatch();

      if (window.__tnetActiveBookmark) {
        this._syncToActiveBookmark();
      }

      TnetLog.log(LOG, 'Init ✓ → #' + containerId);
    },

    destroy: function () {
      if (_resyncRaf) {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(_resyncRaf);
        else clearTimeout(_resyncRaf);
        _resyncRaf = null;
      }
      _unlisteners.forEach(function (fn) { fn(); });
      _unlisteners = [];
      if (_container) _container.innerHTML = '';
    },

    // ============================================================
    //  Render
    // ============================================================

    render: function (catalog) {
      if (!_container || !catalog || !catalog.length) return;

      if (!_activeTabId) _activeTabId = catalog[0].id;
      _renderedTabs = {};
      _currentFilter = '';

      var html = '';

      // 1) Tab-Bar mit Wappen-Icons
      html += '<div class="lm-tab-bar">';
      for (var c = 0; c < catalog.length; c++) {
        var cat = catalog[c];
        var info = CATEGORY_ICONS[cat.id] || { label: cat.name.substring(0, 2).toUpperCase() };
        var activeClass = cat.id === _activeTabId ? ' lm-tab-active' : '';
        html += '<div class="lm-tab' + activeClass + '" data-cat-id="' + esc(cat.id) + '">';
        if (info.wappen) {
          html += '<img class="lm-tab-icon" src="' + esc(info.wappen) + '" alt="' + esc(cat.name) + '">';
        } else {
          html += '<span class="lm-tab-label">' + esc(info.label) + '</span>';
        }
        html += '</div>';
      }
      html += '</div>';

      // 2) Suchfeld — sticky unter der Tab-Bar
      html += '<div class="lm-search-wrap">';
      html += '<input type="text" class="lm-search" placeholder="Thema suchen…">';
      html += '<span class="lm-search-clear" style="display:none">&times;</span>';
      html += '</div>';

      // 3) Kategorie-Inhalte (Lazy-Load)
      for (var ci = 0; ci < catalog.length; ci++) {
        var category = catalog[ci];
        var isActive = category.id === _activeTabId;
        html += '<div class="lm-cat-content" data-cat-content="' + esc(category.id) + '"';
        html += isActive ? '>' : ' style="display:none">';
        if (isActive) {
          html += this._renderCategory(category);
          _renderedTabs[category.id] = true;
        }
        html += '</div>';
      }

      // 4) "Keine Treffer"-Hinweis (initial verborgen)
      html += '<div class="lm-no-results" style="display:none">Keine Themen gefunden</div>';

      _container.innerHTML = html;
      this._bindEvents();
      this._resyncLayerCheckboxes();
    },

    /** Rendert den ganzen Inhalt einer Kategorie als Accordion */
    _renderCategory: function (category) {
      var subcats = category.subcategories || [];
      var html = '';
      for (var i = 0; i < subcats.length; i++) {
        html += this._renderSubcategory(subcats[i]);
      }
      return html;
    },

    _renderSubcategory: function (sub) {
      // Subcategory = Level-1 Accordion — expanded-Wert aus Store/API
      var depth = 1;
      var normalizedDepth = this._clampDepth(depth);
      var groups = sub.groups || [];
      var count = this._countLeaves(groups);
      var isExpanded = sub.expanded !== false; // default: offen
      var stateClass = isExpanded ? ' lm-expanded' : ' lm-collapsed';
      var html = '';
      html += '<div class="lm-subcat' + stateClass + '" data-group-id="' + esc(sub.id) + '">';
      html += '<div class="lm-subcat-header lm-depth-' + normalizedDepth + '" data-action="toggle-group" data-lm-depth="' + normalizedDepth + '">';
      html += '<span class="lm-arrow">▶</span>';
      html += '<span class="lm-subcat-name">' + esc(sub.name) + '</span>';
      html += '<span class="lm-count">' + count + '</span>';
      html += '</div>';
      html += '<div class="lm-subcat-body">';
      for (var g = 0; g < groups.length; g++) {
        html += this._renderGroup(groups[g], depth + 1);
      }
      html += '</div>';
      html += '</div>';
      return html;
    },

    _renderGroup: function (group, depth) {
      var normalizedDepth = this._clampDepth(depth);
      var layers = group.layers || [];
      // Einzel-Layer ohne verschachtelte Gruppe? Direkt als Layer rendern
      if (layers.length === 1 && layers[0].type !== 'group') {
        return this._renderLeafLayer(layers[0], normalizedDepth);
      }
      var count = this._countLeaves(layers);
      var isExpanded = group.open === true || group.expanded === true;
      var stateClass = isExpanded ? ' lm-expanded' : ' lm-collapsed';
      var hasSelectAll = group.selectAll === true;
      var hasLegend = group.legend && group.legend !== '';
      var html = '';
      html += '<div class="lm-group' + stateClass + ' lm-depth-' + normalizedDepth + '" data-group-id="' + esc(group.id) + '" data-lm-depth="' + normalizedDepth + '">';
      html += '<div class="lm-group-header lm-depth-' + normalizedDepth + '" data-action="toggle-group" data-lm-depth="' + normalizedDepth + '">';
      html += '<span class="lm-arrow">▶</span>';
      if (hasSelectAll) {
        html += '<input type="checkbox" class="lm-group-cb" data-action="select-all" data-group-id="' + esc(group.id) + '" title="Alle Layer ein-/ausschalten">';
      }
      html += '<span class="lm-group-name">' + esc(group.name) + '</span>';
      if (hasLegend) {
        html += '<button class="lm-legend-btn" data-action="open-legend" data-legend-key="' + esc(group.legend) + '"';
        if (group.legendLink) html += ' data-legend-link="' + esc(group.legendLink) + '"';
        if (group.legendTitle) html += ' data-legend-title="' + esc(group.legendTitle) + '"';
        html += ' title="Legende anzeigen">' + getLegendIconSvg() + '</button>';
      }
      html += '<span class="lm-count">' + count + '</span>';
      html += '</div>';
      html += '<div class="lm-group-body">';;
      for (var i = 0; i < layers.length; i++) {
        html += this._renderLayerItem(layers[i], normalizedDepth + 1);
      }
      html += '</div>';
      html += '</div>';
      return html;
    },

    _renderLayerItem: function (item, depth) {
      var normalizedDepth = this._clampDepth(depth);
      if (item.type === 'group' && item.layers && item.layers.length) {
        // Verschachtelte Untergruppe (Level 3+)
        var count = this._countLeaves(item.layers);
        var isExpanded = item.open === true || item.expanded === true;
        var stateClass = isExpanded ? ' lm-expanded' : ' lm-collapsed';
        var hasSelectAll = item.selectAll === true;
        var hasLegend = item.legend && item.legend !== '';
        var html = '';
        html += '<div class="lm-nested-group' + stateClass + ' lm-depth-' + normalizedDepth + '" data-group-id="' + esc(item.id) + '" data-lm-depth="' + normalizedDepth + '">';
        html += '<div class="lm-nested-header lm-depth-' + normalizedDepth + '" data-action="toggle-group" data-lm-depth="' + normalizedDepth + '">';
        html += '<span class="lm-arrow">▶</span>';
        if (hasSelectAll) {
          html += '<input type="checkbox" class="lm-group-cb" data-action="select-all" data-group-id="' + esc(item.id) + '" title="Alle Layer ein-/ausschalten">';
        }
        html += '<span class="lm-nested-name">' + esc(item.name) + '</span>';
        if (hasLegend) {
          html += '<button class="lm-legend-btn" data-action="open-legend" data-legend-key="' + esc(item.legend) + '"';
          if (item.legendLink) html += ' data-legend-link="' + esc(item.legendLink) + '"';
          if (item.legendTitle) html += ' data-legend-title="' + esc(item.legendTitle) + '"';
          html += ' title="Legende anzeigen">' + getLegendIconSvg() + '</button>';
        }
        html += '<span class="lm-count">' + count + '</span>';
        html += '</div>';
        html += '<div class="lm-nested-body">';
        for (var i = 0; i < item.layers.length; i++) {
          html += this._renderLayerItem(item.layers[i], normalizedDepth + 1);
        }
        html += '</div>';
        html += '</div>';
        return html;
      }
      return this._renderLeafLayer(item, normalizedDepth);
    },

    _renderLeafLayer: function (layer, depth) {
      var normalizedDepth = this._clampDepth(depth);
      var checked = layer.visible ? ' checked' : '';
      var activeClass = layer.visible ? ' lm-active' : '';
      var hasLegend = layer.legend && layer.legend !== '';
      var html = '';
      html += '<div class="lm-layer lm-depth-' + normalizedDepth + activeClass + '" data-layer-id="' + esc(layer.id) + '" data-lm-depth="' + normalizedDepth + '" data-name="' + esc((layer.name || '').toLowerCase()) + '">';
      html += '<label class="lm-layer-label">';
      html += '<input type="checkbox" class="lm-cb"' + checked + ' data-action="toggle-layer">';
      html += '<span class="lm-layer-name">' + esc(layer.name) + '</span>';
      html += '</label>';
      if (hasLegend) {
        var legendLayers = layer.legendLayers || '';
        html += '<button class="lm-legend-btn" data-action="open-legend" data-legend-key="' + esc(layer.legend) + '"';
        if (legendLayers) html += ' data-legend-layers="' + esc(legendLayers) + '"';
        if (layer.legendLink) html += ' data-legend-link="' + esc(layer.legendLink) + '"';
        if (layer.legendTitle) html += ' data-legend-title="' + esc(layer.legendTitle) + '"';
        html += ' title="Legende anzeigen">' + getLegendIconSvg() + '</button>';
      }
      html += '</div>';
      return html;
    },

    // ============================================================
    //  Event-Delegation
    // ============================================================

    _bindEvents: function () {
      // Guard: Nur 1x binden — verhindert Doppel-Toggle bei mehrfachem render()
      if (_container.__tnetLmTreeBound) return;
      _container.__tnetLmTreeBound = true;

      var self = this;

      _container.addEventListener('click', function (e) {
        // Tab-Klick
        var tabBtn = e.target.closest('.lm-tab');
        if (tabBtn) {
          var catId = tabBtn.dataset.catId;
          if (catId && catId !== _activeTabId) {
            self._switchTab(catId);
          }
          return;
        }

        // Legende öffnen
        var legendBtn = e.target.closest('[data-action="open-legend"]');
        if (legendBtn) {
          e.stopPropagation();
          self._openLegend(
            legendBtn.dataset.legendKey,
            legendBtn.dataset.legendLayers || '',
            legendBtn.dataset.legendLink || '',
            legendBtn.dataset.legendTitle || ''
          );
          return;
        }

        // SelectAll-Checkbox (Klick-Event stoppen, change-Handler übernimmt)
        if (e.target.matches('[data-action="select-all"]')) {
          e.stopPropagation(); // Verhindert toggle-group
          return;
        }

        // Gruppe auf-/zuklappen
        var groupAction = e.target.closest('[data-action="toggle-group"]');
        if (groupAction) {
          var groupEl = groupAction.closest('.lm-subcat, .lm-group, .lm-nested-group');
          if (groupEl) {
            e.preventDefault();
            // Explizit: collapsed → öffnen, sonst → schliessen
            var isClosed = groupEl.classList.contains('lm-collapsed');

            if (e.ctrlKey || e.metaKey) {
              // ── Ctrl+Klick: alle Geschwister derselben Tiefe toggeln ──
              var depth = groupAction.getAttribute('data-lm-depth');
              var parentContainer = groupEl.parentElement;
              if (parentContainer && depth) {
                var siblings = parentContainer.querySelectorAll(
                  ':scope > .lm-subcat,' +
                  ':scope > .lm-group[data-lm-depth="' + depth + '"],' +
                  ':scope > .lm-nested-group[data-lm-depth="' + depth + '"]'
                );
                for (var si = 0; si < siblings.length; si++) {
                  if (isClosed) {
                    siblings[si].classList.add('lm-expanded');
                    siblings[si].classList.remove('lm-collapsed');
                  } else {
                    siblings[si].classList.remove('lm-expanded');
                    siblings[si].classList.add('lm-collapsed');
                  }
                }
                TnetLog.debug(LOG, 'Ctrl+Klick: Tiefe', depth, '→', siblings.length,
                  'Knoten', isClosed ? 'geöffnet' : 'geschlossen');
              }
            } else {
              // Normaler Klick: nur diesen Knoten toggeln
              if (isClosed) {
                groupEl.classList.add('lm-expanded');
                groupEl.classList.remove('lm-collapsed');
              } else {
                groupEl.classList.remove('lm-expanded');
                groupEl.classList.add('lm-collapsed');
              }
              TnetLog.debug(LOG, 'Toggle:', groupEl.dataset.groupId,
                isClosed ? '→ offen' : '→ geschlossen',
                'classes:', groupEl.className.substring(0, 60));
            }
          } else {
            TnetLog.warn(LOG, 'Toggle: kein Gruppen-Element gefunden für', groupAction);
          }
          return;
        }

        // Search-Clear
        if (e.target.closest('.lm-search-clear')) {
          var input = _container.querySelector('.lm-search');
          if (input) { input.value = ''; input.focus(); }
          self._applyFilter('');
          return;
        }
      });

      _container.addEventListener('change', function (e) {
        // Einzelner Layer ein-/ausschalten
        if (e.target.matches('[data-action="toggle-layer"]')) {
          var layerEl = e.target.closest('.lm-layer');
          if (layerEl) {
            window.TnetLMStore.toggleLayer(layerEl.dataset.layerId);
          }
          return;
        }
        // SelectAll: alle Layer einer Gruppe ein-/ausschalten
        if (e.target.matches('[data-action="select-all"]')) {
          var groupId = e.target.dataset.groupId;
          var checked = e.target.checked;
          if (groupId && window.TnetLMStore) {
            window.TnetLMStore.setGroupAllVisible(groupId, checked);
            // Fallback-Sync: Nach Verarbeitung (gestaffelt) nochmals prüfen
            // ob alle Checkboxen im DOM den Store-Zustand reflektieren
            setTimeout(function () {
              self._syncGroupCheckboxes(groupId, checked);
            }, 1200);
          }
        }
      });

      // Suchfeld → Filter
      var searchInput = _container.querySelector('.lm-search');
      if (searchInput) {
        searchInput.addEventListener('input', function () {
          clearTimeout(_searchTimeout);
          var q = searchInput.value;
          _searchTimeout = setTimeout(function () { self._applyFilter(q); }, 200);
        });
      }
    },

    // ============================================================
    //  Tab-Wechsel (mit Lazy-Load)
    // ============================================================

    _switchTab: function (catId) {
      _activeTabId = catId;

      var tabs = _container.querySelectorAll('.lm-tab');
      for (var i = 0; i < tabs.length; i++) {
        tabs[i].classList.toggle('lm-tab-active', tabs[i].dataset.catId === catId);
      }

      var contents = _container.querySelectorAll('.lm-cat-content');
      for (var j = 0; j < contents.length; j++) {
        var contentId = contents[j].dataset.catContent;
        var isTarget = contentId === catId;
        contents[j].style.display = isTarget ? '' : 'none';

        if (isTarget && !_renderedTabs[catId]) {
          var store = window.TnetLMStore;
          var catalog = store ? store.getCatalog() : [];
          for (var k = 0; k < catalog.length; k++) {
            if (catalog[k].id === catId) {
              contents[j].innerHTML = this._renderCategory(catalog[k]);
              _renderedTabs[catId] = true;
              break;
            }
          }
        }
      }

      // Frisch gerenderte Tabs starten mit Katalog-Defaults; effektiven Store-Zustand
      // nachziehen, damit Themenkatalog und Karteninhalt synchron bleiben
      // (Bookmarks, externe Aktivierung).
      this._resyncLayerCheckboxes();

      // Re-apply Filter wenn aktiv
      if (_currentFilter) {
        this._applyFilter(_currentFilter);
      }
    },

    // ============================================================
    //  Inline-Filter: Blendet nicht-matchende Layer aus,
    //  öffnet Elternknoten bei Treffern automatisch.
    // ============================================================

    _applyFilter: function (query) {
      _currentFilter = query;
      var q = (query || '').trim().toLowerCase();
      var clearBtn = _container.querySelector('.lm-search-clear');
      if (clearBtn) clearBtn.style.display = q ? '' : 'none';

      var activeContent = _container.querySelector('.lm-cat-content[data-cat-content="' + _activeTabId + '"]');
      if (!activeContent) return;

      // Alle Layer im aktiven Tab
      var allLayers = activeContent.querySelectorAll('.lm-layer');
      var allGroups = activeContent.querySelectorAll('.lm-subcat, .lm-group, .lm-nested-group');

      if (!q || q.length < 2) {
        // Filter aufheben — alles sichtbar, Originalzustand wiederherstellen
        for (var i = 0; i < allLayers.length; i++) {
          allLayers[i].style.display = '';
          allLayers[i].classList.remove('lm-filter-match');
        }
        for (var g = 0; g < allGroups.length; g++) {
          allGroups[g].style.display = '';
          if (allGroups[g].classList.contains('lm-filter-open')) {
            // War nur durch den Filter geöffnet — Originalzustand wiederherstellen
            allGroups[g].classList.remove('lm-filter-open');
            if (allGroups[g].dataset.preFilterState === 'collapsed') {
              allGroups[g].classList.remove('lm-expanded');
              allGroups[g].classList.add('lm-collapsed');
            }
            delete allGroups[g].dataset.preFilterState;
          }
        }
        var noResults = _container.querySelector('.lm-no-results');
        if (noResults) noResults.style.display = 'none';
        return;
      }

      // 1) Alle Layer prüfen — match per name
      var matchCount = 0;
      for (var li = 0; li < allLayers.length; li++) {
        var layerEl = allLayers[li];
        var name = layerEl.dataset.name || '';
        var isMatch = name.indexOf(q) !== -1;
        layerEl.style.display = isMatch ? '' : 'none';
        layerEl.classList.toggle('lm-filter-match', isMatch);
        if (isMatch) matchCount++;
      }

      // 2) Gruppen: sichtbar wenn mindestens ein Kind-Layer sichtbar
      //    Von innen nach aussen (nested-group → group → subcat)
      for (var gi = allGroups.length - 1; gi >= 0; gi--) {
        var groupEl = allGroups[gi];
        var body = groupEl.querySelector('.lm-subcat-body, .lm-group-body, .lm-nested-body');
        if (!body) { groupEl.style.display = 'none'; continue; }

        // Hat dieser Knoten sichtbare Kinder?
        var hasVisible = body.querySelector('.lm-layer:not([style*="display: none"]), .lm-layer:not([style*="display:none"])') !== null;
        // Prüfe auch sichtbare Untergruppen
        if (!hasVisible) {
          var subGroups = body.querySelectorAll(':scope > .lm-group:not([style*="display: none"]):not([style*="display:none"]), :scope > .lm-nested-group:not([style*="display: none"]):not([style*="display:none"])');
          hasVisible = subGroups.length > 0;
        }

        groupEl.style.display = hasVisible ? '' : 'none';
        if (hasVisible && !groupEl.classList.contains('lm-filter-open')) {
          // Zustand VOR dem Filter merken, dann öffnen
          if (!groupEl.dataset.preFilterState) {
            groupEl.dataset.preFilterState = groupEl.classList.contains('lm-collapsed') ? 'collapsed' : 'expanded';
          }
          groupEl.classList.add('lm-expanded', 'lm-filter-open');
          groupEl.classList.remove('lm-collapsed');
        }
      }

      // 3) "Keine Treffer"-Hinweis
      var noResultsEl = _container.querySelector('.lm-no-results');
      if (noResultsEl) noResultsEl.style.display = matchCount === 0 ? '' : 'none';
    },

    // ============================================================
    //  Inkrementelle DOM-Updates
    // ============================================================

    _onLayerVisibility: function (evt) {
      if (!_container) return;
      var els = _container.querySelectorAll('[data-layer-id="' + evt.id + '"]');
      for (var i = 0; i < els.length; i++) {
        var cb = els[i].querySelector('.lm-cb');
        if (cb) cb.checked = evt.visible;
        els[i].classList.toggle('lm-active', evt.visible);
      }
      // SelectAll-Checkboxen in Eltern-Gruppen aktualisieren
      this._updateSelectAllCheckboxes();
    },

    _onActiveLayersChanged: function () {
      if (_resyncRaf) return;
      var self = this;
      var flush = function () {
        _resyncRaf = null;
        self._resyncLayerCheckboxes();
      };
      _resyncRaf = (typeof requestAnimationFrame === 'function')
        ? requestAnimationFrame(flush)
        : setTimeout(flush, 16);
    },

    _onGroupToggled: function (evt) {
      if (!_container) return;
      var els = _container.querySelectorAll('[data-group-id="' + evt.id + '"]');
      for (var i = 0; i < els.length; i++) {
        els[i].classList.toggle('lm-expanded', evt.expanded);
        els[i].classList.toggle('lm-collapsed', !evt.expanded);
      }
    },

    /**
     * Aktualisiert den Zustand aller selectAll-Checkboxen im Baum.
     * checked = alles an, indeterminate = teilweise, unchecked = alles aus.
     */
    _updateSelectAllCheckboxes: function () {
      if (!_container) return;
      var store = window.TnetLMStore;
      if (!store || typeof store.getGroupVisibilityState !== 'function') return;
      var cbs = _container.querySelectorAll('.lm-group-cb[data-action="select-all"]');
      for (var i = 0; i < cbs.length; i++) {
        var groupId = cbs[i].dataset.groupId;
        if (!groupId) continue;
        var state = store.getGroupVisibilityState(groupId);
        cbs[i].checked = (state === 'all');
        cbs[i].indeterminate = (state === 'partial');
        // Visuelles Feedback auf dem Gruppen-Container
        var groupEl = cbs[i].closest('[data-group-id]');
        if (groupEl) {
          groupEl.classList.toggle('lm-partial', state === 'partial');
        }
      }
    },

    _resyncLayerCheckboxes: function () {
      if (!_container) return;
      var store = window.TnetLMStore;
      if (!store) return;
      var visibilityReader = typeof store.isLayerRequestedVisible === 'function'
        ? store.isLayerRequestedVisible.bind(store)
        : (typeof store.isLayerEffectivelyVisible === 'function' ? store.isLayerEffectivelyVisible.bind(store) : null);
      if (!visibilityReader) return;
      var els = _container.querySelectorAll('.lm-layer[data-layer-id]');
      for (var i = 0; i < els.length; i++) {
        var layerId = els[i].dataset.layerId;
        if (!layerId) continue;
        var isVisible = visibilityReader(layerId);
        var cb = els[i].querySelector('.lm-cb');
        if (cb) cb.checked = isVisible;
        els[i].classList.toggle('lm-active', isVisible);
      }
      this._updateSelectAllCheckboxes();
    },

    _syncToActiveBookmark: function () {
      var bookmark = window.__tnetActiveBookmark;
      if (!bookmark || !_container) return;

      if (bookmark.themes) return;

      var layers = Array.isArray(bookmark.layers) ? bookmark.layers : [];
      var targetLayerId = null;
      for (var i = 0; i < layers.length; i++) {
        if (layers[i] && layers[i].id && layers[i].visible !== false) {
          targetLayerId = layers[i].id;
          break;
        }
      }
      if (!targetLayerId && layers.length && layers[0] && layers[0].id) {
        targetLayerId = layers[0].id;
      }
      if (!targetLayerId) return;

      this.navigateToLayer(targetLayerId);
    },

    // ============================================================
    //  Resolution-Watch: Layer ausserhalb Massstabsbereich ausgrauen
    // ============================================================

    _initResolutionWatch: function () {
      var self = this;
      // Warte auf Map-Objekt (kann verzögert initialisiert werden)
      function tryBind() {
        var mainMap = typeof njs !== 'undefined' && njs.AppManager && njs.AppManager.Maps && njs.AppManager.Maps['main'];
        var map = mainMap && mainMap.mapObj;
        if (!map) {
          setTimeout(tryBind, 2000);
          return;
        }
        var view = map.getView();
        if (!view) return;
        var debounceTimer = null;
        view.on('change:resolution', function () {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(function () { self._updateOutOfRange(view.getResolution()); }, 200);
        });
        // Initialer Check
        self._updateOutOfRange(view.getResolution());
        TnetLog.log(LOG, 'Resolution-Watch aktiv');
      }
      tryBind();
    },

    _updateOutOfRange: function (resolution) {
      if (!_container) return;
      var store = window.TnetLMStore;
      if (!store) return;
      var els = _container.querySelectorAll('.lm-layer[data-layer-id]');
      for (var i = 0; i < els.length; i++) {
        var layerId = els[i].dataset.layerId;
        var layer = store.findLayer(layerId);
        if (!layer) continue;
        // Resolution-Limits aus Config oder aus OL-Layer
        var maxRes = layer.maxResolution;
        var minRes = layer.minResolution;
        if (layer._olLayerRef) {
          var olMax = layer._olLayerRef.getMaxResolution();
          var olMin = layer._olLayerRef.getMinResolution();
          if (olMax && olMax !== Infinity) maxRes = olMax;
          if (olMin && olMin > 0) minRes = olMin;
        }
        var outOfRange = false;
        if (maxRes && resolution > maxRes) outOfRange = true;
        if (minRes && resolution < minRes) outOfRange = true;
        els[i].classList.toggle('lm-out-of-range', outOfRange);
      }
    },

    /**
     * Synchronisiert Kind-Checkboxen einer Gruppe mit dem Store-Zustand.
     * Fallback für Fälle wo layer-visibility Events den DOM nicht aktualisiert haben
     * (z.B. weil Tab noch nicht gerendert war oder gestaffelte Verarbeitung).
     * @param {string} groupId  Die Gruppen-ID
     * @param {boolean} visible  Ziel-Zustand
     */
    _syncGroupCheckboxes: function (groupId, visible) {
      if (!_container) return;
      var groupEl = _container.querySelector('[data-group-id="' + groupId + '"]');
      if (!groupEl) return;
      var layerEls = groupEl.querySelectorAll('.lm-layer');
      var store = window.TnetLMStore;
      var visibilityReader = store && typeof store.isLayerRequestedVisible === 'function'
        ? store.isLayerRequestedVisible.bind(store)
        : (store && typeof store.isLayerEffectivelyVisible === 'function' ? store.isLayerEffectivelyVisible.bind(store) : null);
      var synced = 0;
      for (var i = 0; i < layerEls.length; i++) {
        var cb = layerEls[i].querySelector('.lm-cb');
        if (cb && cb.checked !== visible) {
          // Store-Zustand prüfen (Single Source of Truth)
          var layerId = layerEls[i].dataset.layerId;
          if (visibilityReader) {
            if (visibilityReader(layerId) === visible) {
              cb.checked = visible;
              layerEls[i].classList.toggle('lm-active', visible);
              synced++;
            }
          }
        }
      }
      if (synced > 0) {
        TnetLog.log('[LMTree]', '_syncGroupCheckboxes:', synced, 'Checkboxen korrigiert für', groupId);
      }
      this._updateSelectAllCheckboxes();
    },

    /**
     * Legende in einem Fenster öffnen.
     * Wenn legendLink vorhanden (aus legendResources), direkt öffnen.
     * Sonst Fallback auf legend-proxy (für ArcGIS-Dienste).
     */
    _openLegend: function (legendKey, legendLayers, legendLink, legendTitle) {
      if (!legendKey) return;

      var legendUrl;
      if (legendLink) {
        // Direkte URL aus legendResources (z.B. ../core/legends/information_de.htm)
        legendUrl = legendLink;
      } else {
        // ArcGIS-Dienst → legend-proxy
        legendUrl = getAppRoot() + '/tnet/api/v1/legend-proxy.php?service=' + encodeURIComponent(legendKey);
        if (legendLayers) {
          legendUrl += '&layers=' + encodeURIComponent(legendLayers);
        }
      }

      // Metadaten anhängen wenn in Config aktiviert
      var legendCfg = window.__TNET_LEGEND_CONFIG || {};
      if (legendCfg.metadata && legendUrl.indexOf('legend-proxy') !== -1 && legendUrl.indexOf('metadata=') === -1) {
        legendUrl += (legendUrl.indexOf('?') !== -1 ? '&' : '?') + 'metadata=1';
      }

      var title = legendTitle || legendKey.split('/').pop() || 'Legende';

      var am = window.njs && window.njs.AppManager;
      if (!am) am = window.top && window.top.njs && window.top.njs.AppManager;
      if (am && typeof am.showLegend === 'function') {
        am.showLegend(legendUrl, title, true, undefined);
        TnetLog.log(LOG, 'Legende geöffnet:', legendUrl);
      } else {
        window.open(legendUrl, '_blank', 'noopener');
      }
    },

    // ============================================================
    //  Helfer
    // ============================================================

    _countLeaves: function (nodes) {
      var count = 0;
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        var children = n.layers || n.groups;
        if (children && children.length) {
          count += this._countLeaves(children);
        } else if (n.type !== 'group') {
          count++;
        }
      }
      return count;
    },

    _clampDepth: function (depth) {
      var n = parseInt(depth, 10);
      if (!isFinite(n) || n < 1) return 1;
      if (n > 6) return 6;
      return n;
    },

    // ============================================================
    //  Oeffentliche Navigation: Layer im Baum anzeigen
    // ============================================================

    /**
     * Navigiert im Themenbaum zu einem bestimmten Layer.
     * Wechselt ggf. den Tab, klappt Elternknoten auf, scrollt zum Layer.
     * Wird von der Desktop-Suche aufgerufen wenn ein Themen-Ergebnis angeklickt wird.
     *
     * @param {string} layerId     Die volle Layer-ID (z.B. "gis_oereb/nw_nutzungsplanung_def/grundnutzung")
     * @param {string} categoryId  Die Kategorie-ID (z.B. "nidwalden") fuer Tab-Wechsel
     * @returns {boolean} true wenn Navigation gestartet
     */
    navigateToLayer: function (layerId, categoryId) {
      if (!_container || !layerId) return false;
      var store = window.TnetLMStore;
      if (!store) return false;

      // 1) Richtigen Tab finden und wechseln
      var targetTabId = categoryId || null;
      if (!targetTabId) {
        // Layer in allen Kategorien suchen
        var catalog = store.getCatalog();
        for (var c = 0; c < catalog.length; c++) {
          if (this._catalogNodeContainsLayer(catalog[c], layerId)) {
            targetTabId = catalog[c].id;
            break;
          }
        }
      }
      if (targetTabId && targetTabId !== _activeTabId) {
        this._switchTab(targetTabId);
      }

      // 2) Layer-Element finden (evtl. nach Tab-Render mit kurzer Verzoegerung)
      var self = this;
      var attempts = 0;
      function tryFind() {
        var layerEl = _container.querySelector('[data-layer-id="' + layerId + '"]');
        if (!layerEl && attempts < 5) {
          attempts++;
          setTimeout(tryFind, 150);
          return;
        }
        if (!layerEl) {
          // Eltern-Pfad-Fallback: Pfadsegmente kürzen bis ein DOM-Element gefunden wird
          // z.B. "a/b/c/d/e" → "a/b/c/d" → "a/b/c" → "a/b" → "a"
          var fallbackParts = layerId.split('/');
          while (!layerEl && fallbackParts.length > 1) {
            fallbackParts.pop();
            var fallbackId = fallbackParts.join('/');
            layerEl = _container.querySelector('[data-layer-id="' + fallbackId + '"]');
          }
          if (!layerEl) {
            TnetLog.warn(LOG, 'navigateToLayer: Layer nicht im DOM gefunden:', layerId);
            return;
          }
          TnetLog.log(LOG, 'navigateToLayer: Eltern-Element gefunden:', fallbackParts.join('/'), '(statt:', layerId, ')');
        }

        // 3) Alle Elternknoten aufklappen (immer explizit setzen,
        //    nicht nur bei lm-collapsed — verhindert Zustand ohne Klasse)
        var parent = layerEl.parentElement;
        while (parent && parent !== _container) {
          if (parent.dataset && parent.dataset.groupId !== undefined) {
            parent.classList.add('lm-expanded');
            parent.classList.remove('lm-collapsed');
          }
          parent = parent.parentElement;
        }

        // 4) In den sichtbaren Bereich scrollen
        layerEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // 5) Kurz hervorheben (CSS-Animation)
        layerEl.classList.add('lm-highlight');
        setTimeout(function () {
          layerEl.classList.remove('lm-highlight');
        }, 2500);
      }
      setTimeout(tryFind, 80);
      return true;
    },

    /** Prueft rekursiv ob ein Katalog-Knoten den Layer enthaelt */
    _catalogNodeContainsLayer: function (node, layerId) {
      if (node.id === layerId) return true;
      var children = node.subcategories || node.groups || node.layers || [];
      for (var i = 0; i < children.length; i++) {
        if (this._catalogNodeContainsLayer(children[i], layerId)) return true;
      }
      return false;
    },

    // ============================================================
    //  Oeffentliche Navigation: Subcategory im Baum anzeigen
    // ============================================================

    /**
     * Navigiert im Themenbaum zu einer Subcategory anhand ihres Namens.
     * Wechselt ggf. den Tab, klappt die Subcategory auf, scrollt dorthin.
     *
     * @param {string} name        Der Subcategory-Name (z.B. "ÖREB")
     * @param {string} [categoryId] Optionale Kategorie-ID (z.B. "obwalden") fuer Tab-Wechsel
     * @returns {boolean} true wenn Navigation gestartet
     */
    navigateToSubcategory: function (name, categoryId) {
      if (!_container || !name) return false;
      var self = this;
      var store = window.TnetLMStore;
      if (!store) return false;
      var nameLower = name.trim().toLowerCase();

      // Wenn Kategorie angegeben, dort suchen
      if (categoryId && categoryId !== _activeTabId) {
        this._switchTab(categoryId);
      }

      // Subcategory im aktuellen (oder gewechselten) Tab-Content suchen
      function tryFindSubcat() {
        // Suche in der richtigen Kategorie oder in allen sichtbaren
        var searchRoot = _container;
        if (categoryId) {
          var catContent = _container.querySelector('[data-cat-content="' + categoryId + '"]');
          if (catContent) searchRoot = catContent;
        }

        // Primär: Suche per data-group-id (ID-basiert, z.B. "oereb")
        var targetSubcat = searchRoot.querySelector('.lm-subcat[data-group-id="' + nameLower + '"]');

        // Fallback: Suche per Display-Name (textContent)
        if (!targetSubcat) {
          var allNames = searchRoot.querySelectorAll('.lm-subcat-name');
          for (var i = 0; i < allNames.length; i++) {
            if (allNames[i].textContent.trim().toLowerCase() === nameLower) {
              var el = allNames[i].closest('.lm-subcat');
              if (el) { targetSubcat = el; break; }
            }
          }
        }
        return targetSubcat;
      }

      // Mit Retry wegen Lazy-Loading
      var attempts = 0;
      function doFind() {
        var subcatEl = tryFindSubcat();
        if (!subcatEl && attempts < 5) {
          attempts++;
          setTimeout(doFind, 150);
          return;
        }
        if (!subcatEl) {
          TnetLog.warn(LOG, 'navigateToSubcategory: nicht gefunden:', name, '(Kategorie:', categoryId || 'alle', ')');
          return;
        }

        // Aufklappen
        subcatEl.classList.add('lm-expanded');
        subcatEl.classList.remove('lm-collapsed');

        // Scrollen
        var header = subcatEl.querySelector('.lm-subcat-header');
        (header || subcatEl).scrollIntoView({ behavior: 'smooth', block: 'start' });

        // Hervorheben
        subcatEl.classList.add('lm-highlight');
        setTimeout(function () {
          subcatEl.classList.remove('lm-highlight');
        }, 2500);
        TnetLog.log(LOG, 'navigateToSubcategory:', name, '→', subcatEl.dataset.groupId);
      }
      setTimeout(doFind, 80);
      return true;
    },

    /**
     * Klappt mehrere Themen-Subcategories im Baum auf (Bookmark-Integration).
     * Format: Kommaseparierte IDs (data-group-id), optional mit Kategorie-Prefix.
     * Prefixe: ow: → obwalden, nw: → nidwalden, ch: → bund, we: → weitere
     * Beispiel: "ow:oereb, nw:oereb" oder einfach "oereb"
     *
     * @param {string} themesStr  Kommaseparierter String der Themen
     */
    expandThemes: function (themesStr) {
      if (!themesStr || !_container) return;
      var self = this;
      var prefixMap = { 'ow': 'obwalden', 'nw': 'nidwalden', 'ch': 'bund', 'we': 'weitere' };
      var bookmarkInfo = window.__tnetActiveBookmark;
      var skipOverviewOpen = !!(bookmarkInfo && Array.isArray(bookmarkInfo.layers));

      // THEMENKATALOG-Accordion öffnen (tp_overview_menu), sonst ist der Baum nicht sichtbar
      var overviewEl = document.getElementById('tp_overview_menu');
      if (!skipOverviewOpen && overviewEl && !overviewEl.open) {
        overviewEl.open = true;
      }

      var parts = themesStr.split(',');
      for (var i = 0; i < parts.length; i++) {
        var raw = parts[i].trim();
        if (!raw) continue;

        var categoryId = null;
        var themeName = raw;

        // Prefix parsen (z.B. "ow:ÖREB")
        var colonIdx = raw.indexOf(':');
        if (colonIdx > 0 && colonIdx <= 3) {
          var prefix = raw.substring(0, colonIdx).toLowerCase();
          if (prefixMap[prefix]) {
            categoryId = prefixMap[prefix];
            themeName = raw.substring(colonIdx + 1).trim();
          }
        }

        // Navigation mit leichtem Delay pro Eintrag (damit Tabs laden koennen)
        (function (name, catId, delay) {
          setTimeout(function () {
            self.navigateToSubcategory(name, catId);
          }, delay);
        })(themeName, categoryId, i * 300);
      }
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

  window.TnetLMTree = LMTree;
})();
