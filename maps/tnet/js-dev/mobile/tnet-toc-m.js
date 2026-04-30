/**
 * tnet-toc-m.js
 * Mobile Table of Contents, Accordion und Tab-Manipulation für TNet
 *
 * Mobile-Version von tnet_toc.js mit gleicher Logik:
 * - Tabs2Accordion: dijit TabContainer → Accordion
 * - TitlePane2Tabs: Kantons-Tab-Bar (NW/OW/Bund/Weitere)
 * - keepPanesOpen: Widget-Toggle deaktivieren + Observer
 * - watchThemenkatalog: Aktiven Tab sichtbar halten
 *   (mobilsicher: SETZT Styles statt removeAttribute)
 * - TnetTOC: Öffentliche API für Karten-Navigation
 *
 * @version    2.0
 * @date       2026-02-20
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */
(function() {
  'use strict';

  function getAppRoot() {
    return window.__TNET_APP_ROOT || '/maps';
  }

  // ===========================================================================
  // TABS TO ACCORDION CONVERTER (dijit TabContainer)
  // ===========================================================================

  var Tabs2Accordion = {
    getTabInfo: function(tabContainer, index) {
      var tabs = tabContainer.querySelectorAll('.dijitTabListWrapper [role="tab"]');
      var tab = tabs[index];
      var info = { label: 'Kategorie ' + (index + 1), iconClass: null };
      if (tab) {
        info.label = tab.getAttribute('title') || tab.textContent.trim() || info.label;
        var iconEl = tab.querySelector('.dijitIcon, .dijitTabButtonIcon');
        if (iconEl) {
          var classes = Array.from(iconEl.classList).filter(function(c) {
            return c.indexOf('njsCategory') !== -1 || c.indexOf('Icon') !== -1;
          });
          if (classes.length) info.iconClass = classes.join(' ');
        }
      }
      return info;
    },

    convert: function(tabContainer) {
      var self = this;
      if (tabContainer.dataset.tabs2accDone === 'true') return;

      var panelWrapper = tabContainer.querySelector('.dijitTabPaneWrapper');
      if (!panelWrapper) return;

      var panels = panelWrapper.querySelectorAll(':scope > .dijitTabContainerTopChildWrapper');
      if (!panels.length) return;

      tabContainer.classList.add('tabs2acc-converted');

      panels.forEach(function(panelWrap, idx) {
        if (panelWrap.previousElementSibling &&
            panelWrap.previousElementSibling.classList.contains('tabs2acc-header')) {
          return;
        }

        var info = self.getTabInfo(tabContainer, idx);

        var header = document.createElement('div');
        header.className = 'tabs2acc-header';
        header.setAttribute('role', 'button');
        header.setAttribute('tabindex', '0');
        header.setAttribute('aria-expanded', 'false');

        var arrow = document.createElement('span');
        arrow.className = 'acc-arrow';
        arrow.textContent = '▶';
        header.appendChild(arrow);

        if (info.iconClass) {
          var icon = document.createElement('span');
          icon.className = 'acc-icon dijitIcon ' + info.iconClass;
          header.appendChild(icon);
        }

        var label = document.createElement('span');
        label.textContent = info.label;
        header.appendChild(label);

        panelWrap.classList.add('tabs2acc-panel');
        panelWrap.classList.remove('dijitVisible', 'dijitHidden');
        panelWrap.style.display = 'none';

        function toggle() {
          var isOpen = header.classList.contains('is-open');
          header.classList.toggle('is-open', !isOpen);
          panelWrap.classList.toggle('is-open', !isOpen);
          panelWrap.style.display = isOpen ? 'none' : 'block';
          header.setAttribute('aria-expanded', !isOpen ? 'true' : 'false');
        }

        header.addEventListener('click', toggle);
        header.addEventListener('keydown', function(e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
        });

        panelWrapper.insertBefore(header, panelWrap);
      });

      tabContainer.dataset.tabs2accDone = 'true';
    },

    processAll: function() {
      var self = this;
      document.querySelectorAll('.dijitTabContainer').forEach(function(c) {
        self.convert(c);
      });
    },

    init: function() {
      var self = this;

      function doInit() {
        var containers = document.querySelectorAll('.dijitTabContainer');
        if (containers.length > 0) self.processAll();
      }

      // Bei tnet-app-ready sofort konvertieren statt 30×300ms Polling
      document.addEventListener('tnet-app-ready', function() {
        doInit();
        // Nachzügler nach 500ms (Dojo kann noch Widgets nachrendern)
        setTimeout(doInit, 500);
      });

      // Fallback: Falls Event schon gefeuert wurde (late init)
      if (window._tnetAppReady) doInit();

      if (typeof MutationObserver !== 'undefined') {
        // Gezielter Container statt document.body → weniger Fire-Events
        var target = document.getElementById('m-layers-sheet')
                  || document.getElementById('kantons_container')
                  || document.getElementById('NeapoljsContainer');
        if (target) {
          var observer = new MutationObserver(function(mutations) {
            var shouldProcess = mutations.some(function(m) {
              return m.addedNodes.length > 0;
            });
            if (shouldProcess) self.processAll();
          });
          observer.observe(target, { childList: true, subtree: true });
        }
      }
    }
  };

  // ===========================================================================
  // TITLEPANES TO TABS CONVERTER (Kantons-Tabs)
  // ===========================================================================

  var TitlePane2Tabs = {
    icons: {
      'Nidwalden': getAppRoot() + '/tnet/resources/wappen_nidwalden.svg',
      'Obwalden': getAppRoot() + '/tnet/resources/wappen_obwalden.svg',
      'Bund': getAppRoot() + '/tnet/resources/wappen_bund.svg',
      'Weitere': getAppRoot() + '/tnet/resources/icon_weitere.svg'
    },

    panes: [
      { id: 'tp_layer_menu',  name: 'Nidwalden' },
      { id: 'tp_layer_menu2', name: 'Obwalden' },
      { id: 'tp_layer_menu3', name: 'Bund' },
      { id: 'tp_layer_menu4', name: 'Weitere' }
    ],

    convert: function() {
      var self = this;
      var container = document.getElementById('kantons_container');
      if (!container || container.dataset.tabified === 'true') return false;

      var allExist = this.panes.every(function(p) {
        return document.getElementById(p.id);
      });
      if (!allExist) return false;

      // Tab-Bar erstellen
      var tabBar = document.createElement('div');
      tabBar.id = 'kantons_tab_bar';

      this.panes.forEach(function(pane, index) {
        var tab = document.createElement('div');
        tab.className = 'kanton-tab' + (index === 0 ? ' active' : '');
        tab.dataset.target = pane.id;

        if (self.icons[pane.name]) {
          var img = document.createElement('img');
          img.src = self.icons[pane.name];
          img.alt = pane.name;
          tab.appendChild(img);
        }

        tab.title = pane.name;

        tab.addEventListener('click', function() {
          // Alle Tabs deaktivieren
          tabBar.querySelectorAll('.kanton-tab').forEach(function(t) {
            t.classList.remove('active');
          });
          self.panes.forEach(function(p) {
            var el = document.getElementById(p.id);
            if (el) el.classList.remove('active-tab');
          });

          // Diesen Tab aktivieren
          tab.classList.add('active');
          var targetPane = document.getElementById(pane.id);
          if (targetPane) {
            targetPane.classList.add('active-tab');
            if (typeof dijit !== 'undefined' && typeof dijit.byId === 'function') {
              var widget = dijit.byId(pane.id);
              if (widget && !widget.get('open')) {
                if (widget._wipeIn) {
                  widget.set('open', true);
                } else {
                  setTimeout(function() {
                    try { widget.set('open', true); } catch(e) {}
                  }, 200);
                }
              }
            }
            // Sichtbarkeit sicherstellen
            self.ensurePaneVisible(targetPane);
          }
        });

        tabBar.appendChild(tab);
      });

      container.insertBefore(tabBar, container.firstChild);

      // Ersten Tab aktivieren
      var firstPane = document.getElementById(this.panes[0].id);
      if (firstPane) {
        firstPane.classList.add('active-tab');
      }

      function openFirstTab() {
        if (typeof dijit !== 'undefined' && typeof dijit.byId === 'function') {
          var widget = dijit.byId(self.panes[0].id);
          if (widget) {
            widget.set('open', true);
            if (widget.resize) widget.resize();
          }
        }
      }

      setTimeout(openFirstTab, 300);

      container.dataset.tabified = 'true';

      // Panes permanent offen halten
      self.keepPanesOpen();

      // Aktiven Tab überwachen (mobilsicher)
      self.watchThemenkatalog();

      return true;
    },

    // ── ContentOuter/wipeNode sichtbar erzwingen ───────────────────
    // MOBILE-SAFE: SETZT Styles statt removeAttribute('style')
    // → zerstört keine ClassicLayerMgr-Inline-Styles
    ensurePaneVisible: function(paneEl) {
      if (!paneEl) return;

      var co = paneEl.querySelector('.dijitTitlePaneContentOuter');
      if (co) {
        co.style.display = 'block';
        co.style.height = 'auto';
        co.style.overflow = 'visible';
        co.style.visibility = 'visible';

        var wn = co.querySelector('.dijitReset[data-dojo-attach-point="wipeNode"]')
               || co.querySelector('.dijitReset')
               || co.firstElementChild;
        if (wn) {
          wn.style.display = 'block';
          wn.style.height = 'auto';
          wn.style.overflow = 'visible';
          wn.style.visibility = 'visible';
        }
      }

      var ci = paneEl.querySelector('.dijitTitlePaneContentInner');
      if (ci) {
        ci.style.display = 'block';
        ci.style.visibility = 'visible';
        ci.removeAttribute('aria-hidden');
      }

      // TitleBarNode Klassen korrigieren
      var titleBarNode = paneEl.querySelector('.dijitTitlePaneTitle');
      if (titleBarNode) {
        titleBarNode.classList.remove('dijitTitlePaneTitleClosed', 'dijitClosed');
        titleBarNode.classList.add('dijitTitlePaneTitleOpen', 'dijitOpen');
        var focusNode = titleBarNode.querySelector('.dijitTitlePaneTitleFocus');
        if (focusNode) focusNode.setAttribute('aria-pressed', 'true');
      }

      paneEl.classList.remove('dijitTitlePaneClosed', 'dijitClosed');
      paneEl.classList.add('dijitTitlePaneOpened');
    },

    // ── Verhindert Schließen der Kantons-TitlePanes ────────────────
    keepPanesOpen: function() {
      var self = this;

      if (typeof dijit === 'undefined' || typeof dijit.byId !== 'function') return;

      this.panes.forEach(function(pane) {
        var widget = dijit.byId(pane.id);
        if (widget) {
          widget._originalToggle = widget.toggle;
          widget.toggle = function() { return; };

          widget._originalSetOpen = widget._setOpenAttr;
          widget._setOpenAttr = function(value) {
            if (this._originalSetOpen) {
              this._originalSetOpen.call(this, true);
            }
          };

          widget.set('open', true);
        }
      });
    },

    // ── Aktiven Tab sichtbar halten (MOBILE-SAFE) ──────────────────
    watchThemenkatalog: function() {
      var self = this;

      function restoreActiveTab() {
        var tabBar = document.getElementById('kantons_tab_bar');
        if (!tabBar) return;

        var activeTab = tabBar.querySelector('.kanton-tab.active');
        if (!activeTab) return;

        var targetId = activeTab.dataset.target;
        var targetPane = document.getElementById(targetId);
        if (!targetPane) return;

        targetPane.classList.add('active-tab');
        self.ensurePaneVisible(targetPane);

        if (typeof dijit !== 'undefined' && typeof dijit.byId === 'function') {
          var widget = dijit.byId(targetId);
          if (widget) {
            widget._wipeIn = null;
            widget._wipeOut = null;
            widget.open = true;
            try { widget._setOpenAttr(true); } catch(e) {}
            if (widget.hideNode) {
              widget.hideNode.style.display = 'block';
              widget.hideNode.style.height = 'auto';
            }
            if (widget.wipeNode) {
              widget.wipeNode.style.display = 'block';
              widget.wipeNode.style.height = 'auto';
            }
            if (widget.resize) widget.resize();
          }
        }
      }

      function keepPanesClosed() {
        self.panes.forEach(function(pane) {
          var el = document.getElementById(pane.id);
          if (el && el.classList.contains('dijitTitlePaneClosed')) {
            el.classList.remove('dijitTitlePaneClosed');
            el.classList.add('dijitTitlePaneOpened');
            var content = el.querySelector('.dijitTitlePaneContentOuter');
            if (content) {
              content.style.display = 'block';
              content.style.height = 'auto';
            }
          }
        });
      }

      // KONSOLIDIERTER Observer: keepPanesOpen + watchThemenkatalog in EINEM
      var container = document.getElementById('kantons_container');
      if (container && typeof MutationObserver !== 'undefined') {
        var debounceTimer = null;
        var observer = new MutationObserver(function(mutations) {
          // Debounce: Zusammenfassen wenn viele Mutations gleichzeitig kommen
          if (debounceTimer) return;
          debounceTimer = requestAnimationFrame(function() {
            debounceTimer = null;
            keepPanesClosed();

            var needsRestore = mutations.some(function(m) {
              return m.target && m.target.classList && (
                m.target.classList.contains('dijitTitlePane') ||
                m.target.classList.contains('dijitTitlePaneContentOuter') ||
                m.target.classList.contains('dijitReset') ||
                (m.attributeName === 'style' && m.target.dataset &&
                 m.target.dataset.dojoAttachPoint === 'wipeNode')
              );
            });
            if (needsRestore) restoreActiveTab();
          });
        });

        observer.observe(container, {
          attributes: true,
          subtree: true,
          attributeFilter: ['class', 'style']
        });
      }

      // Klick auf TitlePane-Titel → sanft wiederherstellen
      document.addEventListener('click', function(e) {
        var titleBar = e.target.closest('.dijitTitlePaneTitle');
        if (titleBar) {
          requestAnimationFrame(restoreActiveTab);
        }
      }, true);
    },

    init: function() {
      var self = this;

      function tryConvert() {
        if (!self.convert()) {
          // Fallback: max 10× alle 500ms statt 50×200ms
          var attempts = 0;
          var timer = setInterval(function() {
            attempts++;
            if (self.convert() || attempts > 10) clearInterval(timer);
          }, 500);
        }
      }

      // Event-basiert statt blindem Polling
      if (window._tnetAppReady) {
        tryConvert();
      } else {
        document.addEventListener('tnet-app-ready', function() {
          tryConvert();
        }, { once: true });
        // Safety-Fallback nach 5s
        setTimeout(function() { tryConvert(); }, 5000);
      }
    }
  };

  // ===========================================================================
  // TOC (Table of Contents) für Karten-Navigation
  // ===========================================================================

  var CONFIG = {
    sections: [
      { id: 'nw', title: 'Nidwalden', icon: 'resources/wappen_nidwalden.svg', maps: [] },
      { id: 'ow', title: 'Obwalden', icon: 'resources/wappen_obwalden.svg', maps: [] },
      { id: 'ch', title: 'Schweiz',  icon: 'resources/wappen_bund.svg',      maps: [] }
    ],
    bookmarksUrl: 'map-bookmarks.json'
  };

  var state = { isOpen: false, activeMap: null, sections: {} };

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return document.querySelectorAll(sel); }

  function createElement(tag, className, content) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (content) el.innerHTML = content;
    return el;
  }

  function renderTOC() {
    var toc = createElement('div', 'tnet-toc');
    toc.id = 'tnetToc';

    var header = createElement('div', 'tnet-toc-header');
    header.innerHTML =
      '<span class="tnet-toc-title">Karten</span>' +
      '<button class="tnet-toc-close" onclick="TnetTOC.close()">&times;</button>';
    toc.appendChild(header);

    CONFIG.sections.forEach(function(section) {
      toc.appendChild(renderSection(section));
    });

    document.body.appendChild(toc);

    var toggle = createElement('button', 'tnet-toc-toggle');
    toggle.id = 'tnetTocToggle';
    toggle.innerHTML = '<span>☰</span> Karten';
    toggle.onclick = function() { TnetTOC.toggle(); };
    document.body.appendChild(toggle);
  }

  function renderSection(section) {
    var div = createElement('div', 'tnet-toc-section');
    div.dataset.sectionId = section.id;

    var header = createElement('div', 'tnet-toc-section-header');
    header.innerHTML =
      '<img src="' + section.icon + '" alt="">' +
      '<span>' + section.title + '</span>' +
      '<span class="tnet-toc-section-arrow">▶</span>';
    header.onclick = function() { toggleSection(section.id); };
    div.appendChild(header);

    var items = createElement('div', 'tnet-toc-items');
    items.id = 'tnetTocItems_' + section.id;

    if (section.maps.length === 0) {
      items.innerHTML = '<div class="tnet-toc-item" style="color:#999;font-style:italic;">Wird geladen...</div>';
    } else {
      section.maps.forEach(function(map) { items.appendChild(renderItem(map)); });
    }

    div.appendChild(items);
    return div;
  }

  function renderItem(map) {
    var item = createElement('div', 'tnet-toc-item');
    item.textContent = map.title || map.name;
    item.dataset.mapId = map.id || map.name;
    item.onclick = function() { selectMap(map); };
    return item;
  }

  function toggleSection(sectionId) {
    var section = $('[data-section-id="' + sectionId + '"]');
    if (section) {
      section.classList.toggle('open');
      state.sections[sectionId] = section.classList.contains('open');
    }
  }

  function selectMap(map) {
    state.activeMap = map.id || map.name;
    $$('.tnet-toc-item').forEach(function(item) { item.classList.remove('active'); });
    var activeItem = $('[data-map-id="' + state.activeMap + '"]');
    if (activeItem) activeItem.classList.add('active');

    if (typeof window.TnetSetBookmark === 'function') {
      window.TnetSetBookmark(map.url || map.name);
    }

    // Mobile: TOC schließen
    TnetTOC.close();
  }

  // ===========================================
  // Public API
  // ===========================================

  window.TnetTOC = {
    init: function() {
      renderTOC();
      console.log('[TnetTOC] Initialized');
    },

    open: function() {
      var toc = $('#tnetToc');
      if (toc) { toc.classList.add('open'); state.isOpen = true; }
    },

    close: function() {
      var toc = $('#tnetToc');
      if (toc) { toc.classList.remove('open'); state.isOpen = false; }
    },

    toggle: function() {
      state.isOpen ? this.close() : this.open();
    },

    setMaps: function(sectionId, maps) {
      var section = CONFIG.sections.find(function(s) { return s.id === sectionId; });
      if (section) {
        section.maps = maps;
        var container = $('#tnetTocItems_' + sectionId);
        if (container) {
          container.innerHTML = '';
          maps.forEach(function(map) { container.appendChild(renderItem(map)); });
        }
      }
    },

    loadBookmarks: function(url) {
      url = url || CONFIG.bookmarksUrl;
      return fetch(url)
        .then(function(r) { return r.json(); })
        .then(function(data) {
          console.log('[TnetTOC] Bookmarks loaded:', data);
          return data;
        })
        .catch(function(err) {
          console.error('[TnetTOC] Failed to load bookmarks:', err);
        });
    }
  };

  // ===========================================================================
  // INITIALISIERUNG
  // ===========================================================================

  function initAll() {
    Tabs2Accordion.init();
    TitlePane2Tabs.init();
    console.log('[tnet-toc-m.js] Accordion/Tab-Konverter initialisiert');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }

})();
