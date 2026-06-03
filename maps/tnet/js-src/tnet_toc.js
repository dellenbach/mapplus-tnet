/**
 * tnet_toc.js
 * Table of Contents, Accordion und Tab-Manipulation für TNet
 *
 * @version    1.01
 * @date       2026-02-12
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

(function() {
  'use strict';

  function getAppRoot() {
    return window.__TNET_APP_ROOT || '/maps';
  }

  // Wenn neuer Themenkatalog-Baum aktiv → tnet_toc.js komplett überspringen
  // (Tabs2Accordion, TitlePane2Tabs, watchThemenkatalog werden nicht benötigt)
  if (window.__tnetLMFlags && window.__tnetLMFlags.useNewTree) {
    console.log('[tnet_toc.js] Neuer Layer-Manager-Tree aktiv → übersprungen');
    return;
  }

  // ===========================================================================
  // TABS TO ACCORDION CONVERTER (dijit TabContainer)
  // ===========================================================================

  var Tabs2Accordion = {
    // Extrahiere Tab-Info (Label + Icon)
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

    // Konvertiere einen TabContainer zu Accordion
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
        
        // Header erstellen
        var header = document.createElement('div');
        header.className = 'tabs2acc-header';
        header.setAttribute('role', 'button');
        header.setAttribute('tabindex', '0');
        header.setAttribute('aria-expanded', 'false');
        
        // Pfeil
        var arrow = document.createElement('span');
        arrow.className = 'acc-arrow';
        arrow.textContent = '▶';
        header.appendChild(arrow);
        
        // Icon falls vorhanden
        if (info.iconClass) {
          var icon = document.createElement('span');
          icon.className = 'acc-icon dijitIcon ' + info.iconClass;
          header.appendChild(icon);
        }
        
        // Label
        var label = document.createElement('span');
        label.textContent = info.label;
        header.appendChild(label);

        // Panel vorbereiten
        panelWrap.classList.add('tabs2acc-panel');
        panelWrap.classList.remove('dijitVisible', 'dijitHidden');
        panelWrap.style.display = 'none';

        // Toggle-Funktion
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

    // Finde und konvertiere alle TabContainer
    processAll: function() {
      var self = this;
      var containers = document.querySelectorAll('.dijitTabContainer');
      containers.forEach(function(c) { self.convert(c); });
    },

    // Initialisierung
    init: function() {
      var self = this;
      var attempts = 0;
      var maxAttempts = 30;
      
      function tryConvert() {
        attempts++;
        var containers = document.querySelectorAll('.dijitTabContainer');
        if (containers.length > 0) {
          self.processAll();
        }
        if (attempts < maxAttempts) {
          setTimeout(tryConvert, 300);
        }
      }
      
      tryConvert();

      // MutationObserver für dynamisch hinzugefügte Container
      if (typeof MutationObserver !== 'undefined') {
        var observer = new MutationObserver(function(mutations) {
          var shouldProcess = mutations.some(function(m) {
            return m.addedNodes.length > 0;
          });
          if (shouldProcess) self.processAll();
        });
        observer.observe(document.body, { childList: true, subtree: true });
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
      { id: 'tp_layer_menu', name: 'Nidwalden' },
      { id: 'tp_layer_menu2', name: 'Obwalden' },
      { id: 'tp_layer_menu3', name: 'Bund' },
      { id: 'tp_layer_menu4', name: 'Weitere' }
    ],

    setPaneOpenSafe: function(widget) {
      if (!widget) return;
      try {
        widget.set('open', true);
      } catch (e) {
        TnetLog.warn('[tnet_toc.js] TitlePane konnte noch nicht geoeffnet werden:', e.message);
      }
    },

    convert: function() {
      var self = this;
      var container = document.getElementById('kantons_container');
      if (!container || container.dataset.tabified === 'true') return false;

      // Prüfen ob alle Panes existieren
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
            // TitlePane öffnen falls geschlossen
            if (typeof dijit !== 'undefined' && typeof dijit.byId === 'function') {
              var widget = dijit.byId(pane.id);
              if (widget && !widget.get('open')) {
                // Prüfe ob TitlePane-Animation bereits initialisiert ist
                if (widget._wipeIn) {
                  self.setPaneOpenSafe(widget);
                } else {
                  // Widget noch nicht vollständig gestartet, verzögert öffnen
                  setTimeout(function() {
                    self.setPaneOpenSafe(widget);
                  }, 200);
                }
              }
            }
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
      
      // Widget öffnen
      function openFirstTab() {
        if (typeof dijit !== 'undefined' && typeof dijit.byId === 'function') {
          var widget = dijit.byId(self.panes[0].id);
          if (widget) {
            self.setPaneOpenSafe(widget);
            setTimeout(function() {
              self.setPaneOpenSafe(widget);
              if (widget.resize) widget.resize();
            }, 200);
          }
        }
      }
      
      openFirstTab();
      setTimeout(openFirstTab, 500);
      setTimeout(openFirstTab, 1000);

      container.dataset.tabified = 'true';
      
      // Alle Kantons-TitlePanes permanent offen halten
      self.keepPanesOpen();
      
      // Event-Listener für Themenkatalog-Öffnen hinzufügen
      self.watchThemenkatalog();
      
      return true;
    },

    // Verhindert das Schließen der Kantons-TitlePanes
    keepPanesOpen: function() {
      var self = this;
      
      if (typeof dijit === 'undefined' || typeof dijit.byId !== 'function') return;
      
      this.panes.forEach(function(pane) {
        var widget = dijit.byId(pane.id);
        if (widget) {
          // Überschreibe die toggle-Methode
          widget._originalToggle = widget.toggle;
          widget.toggle = function() {
            // Nicht togglen - immer offen bleiben
            return;
          };
          
          // Überschreibe den Setter für 'open'
          widget._originalSetOpen = widget._setOpenAttr;
          widget._setOpenAttr = function(value) {
            // Immer auf true setzen
            if (this._originalSetOpen) {
              this._originalSetOpen.call(this, true);
            }
          };
          
          // Öffne das Widget
          widget.set('open', true);
        }
      });
      
      // MutationObserver um sofort zu reagieren wenn ein Pane geschlossen wird
      var container = document.getElementById('kantons_container');
      if (container && typeof MutationObserver !== 'undefined') {
        var observer = new MutationObserver(function(mutations) {
          // Guard: Während Accordion-Resize keine Styles überschreiben
          if (window.__tnetResizing) return;
          self.panes.forEach(function(pane) {
            var el = document.getElementById(pane.id);
            if (el) {
              // Prüfe ob es geschlossen wurde
              if (el.classList.contains('dijitTitlePaneClosed')) {
                el.classList.remove('dijitTitlePaneClosed');
                el.classList.add('dijitTitlePaneOpened');
                
                // ContentOuter sichtbar machen
                var content = el.querySelector('.dijitTitlePaneContentOuter');
                if (content) {
                  content.style.display = 'block';
                  content.style.height = 'auto';
                }
              }
            }
          });
        });
        
        observer.observe(container, { 
          attributes: true, 
          subtree: true,
          attributeFilter: ['class', 'style']
        });
      }
    },

    // Überwacht den Themenkatalog und stellt aktiven Tab wieder her
    watchThemenkatalog: function() {
      var self = this;
      
      // Funktion zum Wiederherstellen des aktiven Tabs
      function restoreActiveTab() {
        // Guard: Während Accordion-Resize keine Styles überschreiben
        if (window.__tnetResizing) return;
        var tabBar = document.getElementById('kantons_tab_bar');
        if (!tabBar) return;
        
        var activeTab = tabBar.querySelector('.kanton-tab.active');
        if (activeTab) {
          var targetId = activeTab.dataset.target;
          var targetPane = document.getElementById(targetId);
          if (targetPane) {
            // Stelle sicher, dass das Pane die active-tab Klasse hat
            targetPane.classList.add('active-tab');
            
            // WICHTIG: Inline-Style display:none vom ContentOuter UND WipeNode entfernen!
            var contentOuter = targetPane.querySelector('.dijitTitlePaneContentOuter');
            if (contentOuter) {
              // KOMPLETT das style-Attribut entfernen statt nur überschreiben
              contentOuter.removeAttribute('style');
              // Dann unsere Styles setzen
              contentOuter.style.display = 'block';
              contentOuter.style.height = 'auto';
              contentOuter.style.overflow = 'visible';
              
              // Auch wipeNode (inneres div) muss sichtbar sein!
              var wipeNode = contentOuter.querySelector('.dijitReset[data-dojo-attach-point="wipeNode"]');
              if (!wipeNode) {
                wipeNode = contentOuter.querySelector('.dijitReset');
              }
              if (!wipeNode) {
                wipeNode = contentOuter.firstElementChild;
              }
              if (wipeNode) {
                // KOMPLETT das style-Attribut entfernen
                wipeNode.removeAttribute('style');
                wipeNode.style.display = 'block';
                wipeNode.style.height = 'auto';
                wipeNode.style.overflow = 'visible';
              }
            }
            
            // TitleBarNode auf "offen" setzen (Klassen korrigieren)
            var titleBarNode = targetPane.querySelector('.dijitTitlePaneTitle');
            if (titleBarNode) {
              titleBarNode.classList.remove('dijitTitlePaneTitleClosed', 'dijitClosed');
              titleBarNode.classList.add('dijitTitlePaneTitleOpen', 'dijitOpen');
              // aria-pressed aktualisieren
              var focusNode = titleBarNode.querySelector('.dijitTitlePaneTitleFocus');
              if (focusNode) {
                focusNode.setAttribute('aria-pressed', 'true');
              }
            }
            
            // ContentInner aria-hidden auf false setzen
            var contentInner = targetPane.querySelector('.dijitTitlePaneContentInner');
            if (contentInner) {
              contentInner.setAttribute('aria-hidden', 'false');
            }
            
            // Öffne das Widget falls es existiert
            if (typeof dijit !== 'undefined' && typeof dijit.byId === 'function') {
              var widget = dijit.byId(targetId);
              if (widget) {
                // WICHTIG: Dijit-interne Flags direkt setzen
                widget._wipeIn = null;  // Animation abbrechen
                widget._wipeOut = null;
                widget.open = true;
                widget._setOpenAttr(true);
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
        }
      }
      
      // AGGRESSIVER FIX: Kontinuierlich prüfen und korrigieren (alle 100ms für 2 Sekunden nach Klick)
      var fixIntervalId = null;
      var fixCount = 0;
      
      function startAggressiveFix() {
        // Guard: Während Accordion-Resize keine Styles überschreiben
        if (window.__tnetResizing) return;
        fixCount = 0;
        if (fixIntervalId) clearInterval(fixIntervalId);
        fixIntervalId = setInterval(function() {
          if (window.__tnetResizing) return;
          restoreActiveTab();
          fixCount++;
          if (fixCount > 20) { // Nach 2 Sekunden stoppen
            clearInterval(fixIntervalId);
            fixIntervalId = null;
          }
        }, 100);
      }
      
      // GLOBALER Observer: Reagiert auf ALLE TitlePane-Änderungen im Seitenbereich
      var leftPane = document.querySelector('.leftPane, #left_pane, [data-dojo-type*="ContentPane"]');
      if (!leftPane) leftPane = document.body;
      
      if (typeof MutationObserver !== 'undefined') {
        var globalObserver = new MutationObserver(function(mutations) {
          var needsRestore = false;
          
          mutations.forEach(function(mutation) {
            // Level-2 TitlePanes im Themenkatalog NICHT stören
            if (mutation.target && mutation.target.closest && mutation.target.closest('.tabs2acc-panel')) {
              return;
            }
            // Prüfe ob ein TitlePane geöffnet/geschlossen wurde
            if (mutation.target && mutation.target.classList) {
              if (mutation.target.classList.contains('dijitTitlePane') ||
                  mutation.target.classList.contains('dijitTitlePaneContentOuter') ||
                  mutation.target.classList.contains('dijitReset')) {
                needsRestore = true;
              }
            }
            // Auch auf style-Änderungen am wipeNode reagieren (nur Kantons-Pane)
            if (mutation.attributeName === 'style' && mutation.target.dataset && 
                mutation.target.dataset.dojoAttachPoint === 'wipeNode') {
              // Nur wenn der wipeNode NICHT innerhalb eines tabs2acc-panel liegt
              if (!mutation.target.closest || !mutation.target.closest('.tabs2acc-panel')) {
                needsRestore = true;
              }
            }
          });
          
          if (needsRestore && !window.__tnetResizing) {
            // Sofort und aggressiv wiederherstellen
            restoreActiveTab();
            startAggressiveFix();
          }
        });
        
        globalObserver.observe(leftPane, { 
          attributes: true, 
          subtree: true,
          attributeFilter: ['class', 'style']
        });
      }
      
      // Toggle-Events auf allen Sidebar-Panels (details-Elemente)
      ['tp_overview_menu', 'tp_sort_menu', 'tp_tools_menu', 'tp_print_menu', 'tp_ov_menu'].forEach(function(id) {
        var panel = document.getElementById(id);
        if (panel) {
          panel.addEventListener('toggle', function() {
            startAggressiveFix();
          });
        }
      });

      // Auch auf Dojo TitlePane toggle reagieren (WMS-Panel bleibt Dojo)
      if (typeof dijit !== 'undefined' && typeof dijit.byId === 'function') {
        var wmsPane = dijit.byId('tp_wms_menu');
        if (wmsPane) {
          wmsPane.watch('open', function() {
            startAggressiveFix();
          });
        }
      }
    },

    init: function() {
      var self = this;
      var attempts = 0;
      
      function tryConvert() {
        attempts++;
        if (self.convert() || attempts > 50) return;
        setTimeout(tryConvert, 200);
      }

      setTimeout(tryConvert, 1000);
    }
  };

  // ===========================================================================
  // TOC (Table of Contents) für Karten-Navigation
  // ===========================================================================
  
  var CONFIG = {
    // TOC Struktur: Gruppen mit Karten
    sections: [
      {
        id: 'nw',
        title: 'Nidwalden',
        icon: 'resources/wappen_nidwalden.svg',
        maps: []  // Wird dynamisch gefüllt oder aus JSON geladen
      },
      {
        id: 'ow',
        title: 'Obwalden',
        icon: 'resources/wappen_obwalden.svg',
        maps: []
      },
      {
        id: 'ch',
        title: 'Schweiz',
        icon: 'resources/wappen_bund.svg',
        maps: []
      }
    ],
    
    // Bookmarks-Datei für Kartenliste
    bookmarksUrl: 'map-bookmarks.json'
  };

  // ===========================================
  // State
  // ===========================================
  
  var state = {
    isOpen: false,
    activeMap: null,
    sections: {}
  };

  // ===========================================
  // DOM Helpers
  // ===========================================
  
  function $(selector) {
    return document.querySelector(selector);
  }

  function $$(selector) {
    return document.querySelectorAll(selector);
  }

  function createElement(tag, className, content) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (content) el.innerHTML = content;
    return el;
  }

  // ===========================================
  // TOC Rendering
  // ===========================================
  
  function renderTOC() {
    var toc = createElement('div', 'tnet-toc');
    toc.id = 'tnetToc';
    
    // Header
    var header = createElement('div', 'tnet-toc-header');
    header.innerHTML = 
      '<span class="tnet-toc-title">Karten</span>' +
      '<button class="tnet-toc-close" onclick="TnetTOC.close()">&times;</button>';
    toc.appendChild(header);
    
    // Sections
    CONFIG.sections.forEach(function(section) {
      toc.appendChild(renderSection(section));
    });
    
    document.body.appendChild(toc);
    
    // Toggle Button
    var toggle = createElement('button', 'tnet-toc-toggle');
    toggle.id = 'tnetTocToggle';
    toggle.innerHTML = '<span>☰</span> Karten';
    toggle.onclick = function() { TnetTOC.toggle(); };
    document.body.appendChild(toggle);
  }

  function renderSection(section) {
    var div = createElement('div', 'tnet-toc-section');
    div.dataset.sectionId = section.id;
    
    // Section Header
    var header = createElement('div', 'tnet-toc-section-header');
    header.innerHTML = 
      '<img src="' + section.icon + '" alt="">' +
      '<span>' + section.title + '</span>' +
      '<span class="tnet-toc-section-arrow">▶</span>';
    header.onclick = function() { toggleSection(section.id); };
    div.appendChild(header);
    
    // Items Container
    var items = createElement('div', 'tnet-toc-items');
    items.id = 'tnetTocItems_' + section.id;
    
    // Platzhalter falls keine Karten geladen
    if (section.maps.length === 0) {
      items.innerHTML = '<div class="tnet-toc-item" style="color:#999;font-style:italic;">Wird geladen...</div>';
    } else {
      section.maps.forEach(function(map) {
        items.appendChild(renderItem(map));
      });
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

  // ===========================================
  // TOC Actions
  // ===========================================
  
  function toggleSection(sectionId) {
    var section = $('[data-section-id="' + sectionId + '"]');
    if (section) {
      section.classList.toggle('open');
      state.sections[sectionId] = section.classList.contains('open');
    }
  }

  function selectMap(map) {
    state.activeMap = map.id || map.name;
    
    // Highlight active item
    $$('.tnet-toc-item').forEach(function(item) {
      item.classList.remove('active');
    });
    var activeItem = $('[data-map-id="' + state.activeMap + '"]');
    if (activeItem) activeItem.classList.add('active');
    
    // Navigate to map
    if (typeof window.TnetSetBookmark === 'function') {
      window.TnetSetBookmark(map.url || map.name);
    } else if (typeof window.reloadMap === 'function') {
      // Fallback
      console.log('[TOC] Map selected:', map);
    }
    
    // Close TOC on mobile
    if (window.innerWidth <= 600) {
      TnetTOC.close();
    }
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
      if (toc) {
        toc.classList.add('open');
        state.isOpen = true;
      }
    },
    
    close: function() {
      var toc = $('#tnetToc');
      if (toc) {
        toc.classList.remove('open');
        state.isOpen = false;
      }
    },
    
    toggle: function() {
      state.isOpen ? this.close() : this.open();
    },
    
    // Karten für eine Section setzen
    setMaps: function(sectionId, maps) {
      var section = CONFIG.sections.find(function(s) { return s.id === sectionId; });
      if (section) {
        section.maps = maps;
        var container = $('#tnetTocItems_' + sectionId);
        if (container) {
          container.innerHTML = '';
          maps.forEach(function(map) {
            container.appendChild(renderItem(map));
          });
        }
      }
    },
    
    // Bookmarks laden und TOC befüllen
    loadBookmarks: function(url) {
      url = url || CONFIG.bookmarksUrl;
      return fetch(url)
        .then(function(r) { return r.json(); })
        .then(function(data) {
          console.log('[TnetTOC] Bookmarks loaded:', data);
          // TODO: Bookmarks nach Gruppen aufteilen und setMaps aufrufen
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
    // Tabs zu Accordion konvertieren
    Tabs2Accordion.init();
    
    // TitlePanes zu Tabs konvertieren
    TitlePane2Tabs.init();
    
    console.log('[tnet_toc.js] Accordion/Tab-Konverter initialisiert');
  }

  // Auto-init wenn DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }

})();
