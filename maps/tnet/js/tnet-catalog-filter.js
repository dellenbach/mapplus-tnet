/**
 * tnet-catalog-filter.js
 * Filterbox für den Themenkatalog-Baum. Ermöglicht Wildcard-Suche
 * in Layer-Labels aller Kantons-Tabs. Matching-Eltern bleiben sichtbar,
 * nicht-passende Elemente werden per CSS-Klasse ausgeblendet.
 *
 * @version    1.0
 * @date       2026-03-02
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */
(function () {
  'use strict';

  // ===== KONFIGURATION =====
  var FILTER_DEBOUNCE = 200;
  var HIDDEN_CLASS = 'tnet-filter-hidden';

  // ===== STATE =====
  var _filterInput = null;
  var _debounceTimer = null;

  // ===== HILFSFUNKTIONEN =====

  /**
   * Wildcard-Pattern in RegExp umwandeln.
   * '*' → '.*', '?' → '.', ohne Wildcard → Substring-Suche
   */
  function buildRegex(query) {
    query = query.trim().toLowerCase();
    if (!query) return null;

    var hasWildcard = query.indexOf('*') !== -1 || query.indexOf('?') !== -1;
    if (hasWildcard) {
      var escaped = query.replace(/([.+^${}()|[\]\\])/g, '\\$1');
      escaped = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
      return new RegExp(escaped, 'i');
    } else {
      return new RegExp(query.replace(/([.+*?^${}()|[\]\\])/g, '\\$1'), 'i');
    }
  }

  function getAllTabContents() {
    return document.querySelectorAll('#kantons_container > .dijitTitlePane');
  }

  // ===== FILTER-LOGIK =====

  function applyFilter(query) {
    var regex = buildRegex(query);
    var tabs = getAllTabContents();
    for (var t = 0; t < tabs.length; t++) {
      filterTab(tabs[t], regex);
    }
  }

  function filterTab(tabEl, regex) {
    if (!regex) { clearFilter(tabEl); return; }

    // Ebene 2: Accordion-Header + Panels
    var accHeaders = tabEl.querySelectorAll('.tabs2acc-header');
    for (var i = 0; i < accHeaders.length; i++) {
      var header = accHeaders[i];
      var panel = header.nextElementSibling;
      if (!panel || !panel.classList.contains('tabs2acc-panel')) continue;

      var panelHasMatch = filterPanel(panel, regex);
      var headerMatches = regex.test(header.textContent || '');

      if (panelHasMatch || headerMatches) {
        header.classList.remove(HIDDEN_CLASS);
        panel.classList.remove(HIDDEN_CLASS);
        if (panelHasMatch) {
          panel.classList.add('is-open');
          panel.style.display = 'block';
        }
      } else {
        header.classList.add(HIDDEN_CLASS);
        panel.classList.add(HIDDEN_CLASS);
      }
    }
  }

  function filterPanel(panelEl, regex) {
    var hasMatch = false;
    var innerPanes = panelEl.querySelectorAll('.dijitTitlePane');

    for (var i = 0; i < innerPanes.length; i++) {
      var pane = innerPanes[i];
      var titleNode = pane.querySelector('.dijitTitlePaneTextNode, .appendtitle');
      var titleText = titleNode ? titleNode.textContent : '';
      var contentInner = pane.querySelector('.dijitTitlePaneContentInner');
      var paneHasMatch = contentInner ? filterDirectItems(contentInner, regex) : false;

      if (paneHasMatch || regex.test(titleText)) {
        pane.classList.remove(HIDDEN_CLASS);
        hasMatch = true;
        if (paneHasMatch) {
          var outer = pane.querySelector('.dijitTitlePaneContentOuter');
          if (outer) outer.style.display = 'block';
        }
      } else {
        pane.classList.add(HIDDEN_CLASS);
      }
    }
    return hasMatch;
  }

  function filterDirectItems(container, regex) {
    var hasMatch = false;
    var groupHeaders = container.querySelectorAll('[id^="div_head_"]');

    for (var i = 0; i < groupHeaders.length; i++) {
      var gh = groupHeaders[i];
      var ghLabel = gh.querySelector('label');
      var ghText = ghLabel ? ghLabel.textContent : '';
      var ghMatches = regex.test(ghText);

      // Zugehörigen Gruppen-Container finden
      var groupId = gh.id.replace('div_head_', 'div_gis_');
      var groupContent = document.getElementById(groupId);

      var groupHasMatch = false;
      if (groupContent) {
        groupHasMatch = filterGroupContent(groupContent, regex);
      }

      if (ghMatches || groupHasMatch) {
        gh.classList.remove(HIDDEN_CLASS);
        if (groupContent) {
          groupContent.classList.remove(HIDDEN_CLASS);
          if (groupHasMatch) groupContent.style.display = 'block';
        }
        hasMatch = true;
      } else {
        gh.classList.add(HIDDEN_CLASS);
        if (groupContent) groupContent.classList.add(HIDDEN_CLASS);
      }
    }
    return hasMatch;
  }

  function filterGroupContent(groupEl, regex) {
    var hasMatch = false;
    var items = groupEl.children;
    for (var i = 0; i < items.length; i++) {
      var label = items[i].querySelector('label');
      var text = label ? label.textContent : '';
      if (regex.test(text)) {
        items[i].classList.remove(HIDDEN_CLASS);
        hasMatch = true;
      } else {
        items[i].classList.add(HIDDEN_CLASS);
      }
    }
    return hasMatch;
  }

  function clearFilter(tabEl) {
    var hidden = tabEl.querySelectorAll('.' + HIDDEN_CLASS);
    for (var i = 0; i < hidden.length; i++) {
      hidden[i].classList.remove(HIDDEN_CLASS);
    }
  }

  function clearAllFilters() {
    var tabs = getAllTabContents();
    for (var i = 0; i < tabs.length; i++) clearFilter(tabs[i]);
  }

  // ===== UI ERSTELLEN =====

  function createFilterBox() {
    var container = document.getElementById('kantons_container');
    if (!container) return false;
    var tabBar = document.getElementById('kantons_tab_bar');
    if (!tabBar) return false;
    if (document.getElementById('kantons_filter_box')) return true;

    // Container
    var filterBox = document.createElement('div');
    filterBox.id = 'kantons_filter_box';
    filterBox.className = 'tnet-catalog-filter';

    // Input
    var input = document.createElement('input');
    input.type = 'text';
    input.id = 'kantons_filter_input';
    input.className = 'tnet-catalog-filter-input';
    input.placeholder = 'Themen filtern... (* = Wildcard)';
    input.autocomplete = 'off';
    input.spellcheck = false;

    // Clear-Button
    var clearBtn = document.createElement('button');
    clearBtn.className = 'tnet-catalog-filter-clear';
    clearBtn.innerHTML = '&times;';
    clearBtn.title = 'Filter löschen';
    clearBtn.style.display = 'none';

    filterBox.appendChild(input);
    filterBox.appendChild(clearBtn);

    // Nach Tab-Bar einfügen
    tabBar.parentNode.insertBefore(filterBox, tabBar.nextSibling);
    _filterInput = input;

    // Event-Handler
    input.addEventListener('input', function () {
      var query = input.value;
      clearBtn.style.display = query ? 'block' : 'none';
      clearTimeout(_debounceTimer);
      _debounceTimer = setTimeout(function () { applyFilter(query); }, FILTER_DEBOUNCE);
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        input.value = '';
        clearBtn.style.display = 'none';
        clearAllFilters();
        input.blur();
      }
    });

    clearBtn.addEventListener('click', function () {
      input.value = '';
      clearBtn.style.display = 'none';
      clearAllFilters();
      input.focus();
    });

    TnetLog.log('[CatalogFilter] Filterbox eingefügt');
    return true;
  }

  // ===== INIT =====
  var initDone = false;
  function tryInit() {
    if (initDone) return;
    if (createFilterBox()) initDone = true;
  }

  document.addEventListener('tnet-app-ready', function () {
    setTimeout(tryInit, 800);
  }, { once: true });

  setTimeout(tryInit, 3000);
  setTimeout(tryInit, 5000);
  setTimeout(tryInit, 7000);

  window.TnetCatalogFilter = {
    init: createFilterBox,
    applyFilter: applyFilter,
    clearAllFilters: clearAllFilters
  };
})();
