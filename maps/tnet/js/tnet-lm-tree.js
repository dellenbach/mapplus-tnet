/**
 * tnet-lm-tree.js — Themenkatalog-Baum (Mobile)
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

  var LOG = '[LM-Tree]';
  var _container = null;
  var _searchTimeout = null;
  var _activeTabId = null;
  var _renderedTabs = {};
  var _unlisteners = [];
  var _currentFilter = '';

  /** Wappen-/Icon-Mapping */
  var CATEGORY_ICONS = {
    'nidwalden': { label: 'NW', wappen: '/maps/tnet/resources/wappen_nidwalden.svg' },
    'obwalden':  { label: 'OW', wappen: '/maps/tnet/resources/wappen_obwalden.svg' },
    'bund':      { label: 'CH', wappen: '/maps/tnet/resources/wappen_bund.svg' },
    'weitere':   { label: '…',  wappen: '/maps/tnet/resources/icon_weitere.svg' }
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
      _unlisteners.push(store.on('group-toggled', this._onGroupToggled.bind(this)));

      if (store.isLoaded()) {
        this.render(store.getCatalog());
      }

      TnetLog.log(LOG, 'Init ✓ → #' + containerId);
    },

    destroy: function () {
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
      var groups = sub.groups || [];
      var count = this._countLeaves(groups);
      var isExpanded = sub.expanded !== false; // default: offen
      var stateClass = isExpanded ? ' lm-expanded' : ' lm-collapsed';
      var html = '';
      html += '<div class="lm-subcat' + stateClass + '" data-group-id="' + esc(sub.id) + '">';
      html += '<div class="lm-subcat-header" data-action="toggle-group">';
      html += '<span class="lm-arrow">▶</span>';
      html += '<span class="lm-subcat-name">' + esc(sub.name) + '</span>';
      html += '<span class="lm-count">' + count + '</span>';
      html += '</div>';
      html += '<div class="lm-subcat-body">';
      for (var g = 0; g < groups.length; g++) {
        html += this._renderGroup(groups[g]);
      }
      html += '</div>';
      html += '</div>';
      return html;
    },

    _renderGroup: function (group) {
      var layers = group.layers || [];
      // Einzel-Layer ohne verschachtelte Gruppe? Direkt als Layer rendern
      if (layers.length === 1 && layers[0].type !== 'group') {
        return this._renderLeafLayer(layers[0]);
      }
      var count = this._countLeaves(layers);
      var isExpanded = group.open === true || group.expanded === true;
      var stateClass = isExpanded ? ' lm-expanded' : ' lm-collapsed';
      var html = '';
      html += '<div class="lm-group' + stateClass + '" data-group-id="' + esc(group.id) + '">';
      html += '<div class="lm-group-header" data-action="toggle-group">';
      html += '<span class="lm-arrow">▶</span>';
      html += '<span class="lm-group-name">' + esc(group.name) + '</span>';
      html += '<span class="lm-count">' + count + '</span>';
      html += '</div>';
      html += '<div class="lm-group-body">';
      for (var i = 0; i < layers.length; i++) {
        html += this._renderLayerItem(layers[i]);
      }
      html += '</div>';
      html += '</div>';
      return html;
    },

    _renderLayerItem: function (item) {
      if (item.type === 'group' && item.layers && item.layers.length) {
        // Verschachtelte Untergruppe (Level 3+)
        var count = this._countLeaves(item.layers);
        var isExpanded = item.open === true || item.expanded === true;
        var stateClass = isExpanded ? ' lm-expanded' : ' lm-collapsed';
        var html = '';
        html += '<div class="lm-nested-group' + stateClass + '" data-group-id="' + esc(item.id) + '">';
        html += '<div class="lm-nested-header" data-action="toggle-group">';
        html += '<span class="lm-arrow">▶</span>';
        html += '<span class="lm-nested-name">' + esc(item.name) + '</span>';
        html += '<span class="lm-count">' + count + '</span>';
        html += '</div>';
        html += '<div class="lm-nested-body">';
        for (var i = 0; i < item.layers.length; i++) {
          html += this._renderLayerItem(item.layers[i]);
        }
        html += '</div>';
        html += '</div>';
        return html;
      }
      return this._renderLeafLayer(item);
    },

    _renderLeafLayer: function (layer) {
      var checked = layer.visible ? ' checked' : '';
      var activeClass = layer.visible ? ' lm-active' : '';
      var html = '';
      html += '<div class="lm-layer' + activeClass + '" data-layer-id="' + esc(layer.id) + '" data-name="' + esc((layer.name || '').toLowerCase()) + '">';
      html += '<label class="lm-layer-label">';
      html += '<input type="checkbox" class="lm-cb"' + checked + ' data-action="toggle-layer">';
      html += '<span class="lm-layer-name">' + esc(layer.name) + '</span>';
      html += '</label>';
      html += '</div>';
      return html;
    },

    // ============================================================
    //  Event-Delegation
    // ============================================================

    _bindEvents: function () {
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

        // Gruppe auf-/zuklappen (nur wenn kein aktiver Filter)
        var groupAction = e.target.closest('[data-action="toggle-group"]');
        if (groupAction) {
          var groupEl = groupAction.closest('[data-group-id]');
          if (groupEl) {
            // Lokaler DOM-Toggle (schneller als Store-Roundtrip)
            var isExpanded = groupEl.classList.contains('lm-expanded');
            groupEl.classList.toggle('lm-expanded', !isExpanded);
            groupEl.classList.toggle('lm-collapsed', isExpanded);
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
        if (e.target.matches('[data-action="toggle-layer"]')) {
          var layerEl = e.target.closest('.lm-layer');
          if (layerEl) {
            window.TnetLMStore.toggleLayer(layerEl.dataset.layerId);
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
        // Filter aufheben — alles sichtbar, Gruppen zuklappen
        for (var i = 0; i < allLayers.length; i++) {
          allLayers[i].style.display = '';
          allLayers[i].classList.remove('lm-filter-match');
        }
        for (var g = 0; g < allGroups.length; g++) {
          allGroups[g].style.display = '';
          allGroups[g].classList.remove('lm-filter-open');
          // Originalzustand wiederherstellen (collapsed)
          if (!allGroups[g].dataset.wasExpanded) {
            allGroups[g].classList.remove('lm-expanded');
            allGroups[g].classList.add('lm-collapsed');
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
        if (hasVisible) {
          // Auto-expand bei Filter
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
    },

    _onGroupToggled: function (evt) {
      if (!_container) return;
      var els = _container.querySelectorAll('[data-group-id="' + evt.id + '"]');
      for (var i = 0; i < els.length; i++) {
        els[i].classList.toggle('lm-expanded', evt.expanded);
        els[i].classList.toggle('lm-collapsed', !evt.expanded);
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
