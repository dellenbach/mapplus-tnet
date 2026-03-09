/**
 * tnet-accordion-resize.js
 * Drag-Splitter für Sidepane-Accordions (Themenkatalog, Dargestellte Themen).
 * Fügt NACH jedem TitlePane einen horizontalen Resize-Handle ein,
 * mit dem die Höhe der jeweiligen Sektion per Drag verändert werden kann.
 * Höhen werden in localStorage gespeichert und beim Laden wiederhergestellt.
 *
 * Unterstützt sowohl Legacy-Tree als auch neuen TNET-Tree (useNewTree).
 * Bei useNewTree wird die Höhe auf #lm-tree-container bzw.
 * #lm-active-container gesetzt statt auf die Dojo-ContentOuter-Ebene.
 *
 * @version    2.1
 * @date       2026-03-04
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */
(function () {
  'use strict';

  // Erkennung: Neuer Tree / Active Panel aktiv?
  // Lazy gelesen — erst beim Init, nicht beim IIFE-Parse.
  // tnet-log.js setzt __tnetLMFlags synchron, aber als Sicherheits-Fallback
  // werden die Flags auch in init() erneut gelesen.
  var _useNewTree = false;
  var _useNewActivePanel = false;

  function readFlags() {
    _useNewTree = !!(window.__tnetLMFlags && window.__tnetLMFlags.useNewTree);
    _useNewActivePanel = !!(window.__tnetLMFlags && window.__tnetLMFlags.useNewActivePanel);
  }
  // Sofort versuchen (tnet-log.js sollte schon fertig sein)
  readFlags();

  // ===== KONFIGURATION =====
  var CONFIG = {
    panels: [
      {
        id: 'tp_overview_menu',
        storageKey: 'tnet-catalog-height',
        minHeight: 150,
        maxHeight: null,       // wird dynamisch berechnet
        defaultHeight: 450
      },
      {
        id: 'tp_sort_menu',
        storageKey: 'tnet-active-height',
        minHeight: 80,
        maxHeight: null,
        defaultHeight: 300
      }
    ]
  };

  // ===== STATE =====
  var _handles = [];

  // ===== HILFSFUNKTIONEN =====

  /**
   * Maximale Höhe dynamisch berechnen.
   * Misst den tatsächlich verfügbaren Platz im #spring-Container,
   * abzüglich aller anderen Geschwister-Elemente (geschlossene TitlePanes,
   * Resize-Handles, Padding) und der eigenen Titelleiste.
   *
   * @param {string} [panelId] - ID des Panels (z.B. 'tp_overview_menu'),
   *   um dessen Titelleiste korrekt zu berücksichtigen.
   */
  function getMaxHeight(panelId) {
    var spring = document.getElementById('spring');
    if (!spring) return Math.round(window.innerHeight - 150);

    // #spring's computed max-height (Browser löst calc() in Pixel auf)
    var springMaxH = parseFloat(window.getComputedStyle(spring).maxHeight);
    if (isNaN(springMaxH) || springMaxH <= 0) {
      springMaxH = window.innerHeight - 105;
    }

    // Falls kein panelId: grober Fallback
    if (!panelId) return Math.round(springMaxH - 170);

    // Padding von #spring abziehen
    var cs = window.getComputedStyle(spring);
    var padding = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);

    // Höhe aller ANDEREN Elemente in #spring ermitteln
    // Für das Ziel-Panel: nur die Titelleiste zählen, nicht den Inhalt
    var otherH = 0;
    var children = spring.children;
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (child.id === panelId) {
        // Eigene Titelleiste mitzählen (Inhalt wird separat gesteuert)
        var titleBar = child.querySelector('.dijitTitlePaneTitle');
        if (titleBar) otherH += titleBar.offsetHeight;
      } else {
        otherH += child.offsetHeight || 0;
      }
    }

    var maxH = Math.round(springMaxH - padding - otherH - 10);
    return Math.max(150, maxH);
  }

  /**
   * Höhe aus localStorage lesen
   */
  function loadHeight(key, defaultVal) {
    try {
      var stored = localStorage.getItem(key);
      if (stored) {
        var val = parseInt(stored, 10);
        if (!isNaN(val) && val > 0) return val;
      }
    } catch (e) { /* localStorage nicht verfügbar */ }
    return defaultVal;
  }

  /**
   * Höhe in localStorage speichern
   */
  function saveHeight(key, val) {
    try {
      localStorage.setItem(key, String(Math.round(val)));
    } catch (e) { /* ignorieren */ }
  }

  /**
   * Höhe auf die ContentOuter-Ebene anwenden.
   *
   * Legacy-Modus:
   *   tp_overview_menu: #kantons_container + ContentOuter bekommen height.
   *   tp_sort_menu: ContentOuter bekommt max-height.
   *
   * Neuer Tree / Active Panel:
   *   tp_overview_menu → #lm-tree-container bekommt max-height + overflow.
   *   tp_sort_menu → #lm-active-container bekommt max-height + overflow.
   *     Zusätzlich wird CSS-Variable --tnet-active-height gesetzt,
   *     damit das CSS-Fallback (var(--tnet-active-height, 300px)) greift
   *     selbst wenn der Container noch nicht existiert.
   */
  function applyHeight(panelCfg, height) {
    var clamped = Math.max(panelCfg.minHeight, Math.min(height, panelCfg.maxHeight || getMaxHeight(panelCfg.id)));
    var paneEl = document.getElementById(panelCfg.id);
    if (!paneEl) return clamped;

    var contentOuter = paneEl.querySelector('.dijitTitlePaneContentOuter');

    if (panelCfg.id === 'tp_overview_menu') {
      if (_useNewTree) {
        // Neuer Tree: Höhe auf #lm-tree-container setzen
        // Container scrollt selbst (overflow-y: auto), Tab-Bar und Suchfeld
        // bleiben per position:sticky oben fixiert.
        var treeContainer = document.getElementById('lm-tree-container');
        if (treeContainer) {
          treeContainer.style.setProperty('max-height', clamped + 'px', 'important');
          treeContainer.style.setProperty('height', clamped + 'px', 'important');
          treeContainer.style.setProperty('overflow-y', 'auto', 'important');
          treeContainer.style.setProperty('overflow-x', 'hidden', 'important');
        }
        // ContentOuter auch anpassen (Dojo-Wrapper)
        if (contentOuter) {
          contentOuter.style.setProperty('height', (clamped + 10) + 'px', 'important');
        }
        var kantonsContainer = document.getElementById('kantons_container');
        if (kantonsContainer) {
          kantonsContainer.style.setProperty('height', (clamped + 10) + 'px', 'important');
        }
      } else {
        // Legacy: feste Höhe auf kantons_container UND ContentOuter
        var kantonsContainer = document.getElementById('kantons_container');
        if (kantonsContainer) {
          kantonsContainer.style.setProperty('height', clamped + 'px', 'important');
        }
        if (contentOuter) {
          contentOuter.style.setProperty('height', clamped + 'px', 'important');
        }
      }
    } else if (panelCfg.id === 'tp_sort_menu') {
      // CSS-Variable setzen — wirkt sofort auf #lm-active-container via CSS-Fallback
      // auch wenn der Container noch nicht per JS-Inline-Styles konfiguriert wurde
      document.documentElement.style.setProperty('--tnet-active-height', clamped + 'px');

      if (_useNewActivePanel) {
        // Neues Active-Panel: Höhe auf #lm-active-container setzen
        var activeContainer = document.getElementById('lm-active-container');
        if (activeContainer) {
          activeContainer.style.setProperty('max-height', clamped + 'px', 'important');
          activeContainer.style.setProperty('height', clamped + 'px', 'important');
          activeContainer.style.setProperty('overflow-y', 'auto', 'important');
          activeContainer.style.setProperty('overflow-x', 'hidden', 'important');
        }
        // ContentOuter: height UND max-height setzen (max-height allein erzwingt keine Grösse)
        if (contentOuter) {
          contentOuter.style.setProperty('height', (clamped + 10) + 'px', 'important');
          contentOuter.style.setProperty('max-height', (clamped + 10) + 'px', 'important');
          contentOuter.style.setProperty('overflow-y', 'auto', 'important');
        }
      } else {
        // Legacy: height + max-height + overflow-y auf ContentOuter
        if (contentOuter) {
          contentOuter.style.setProperty('height', clamped + 'px', 'important');
          contentOuter.style.setProperty('max-height', clamped + 'px', 'important');
          contentOuter.style.setProperty('overflow-y', 'auto', 'important');
        }
      }
    }

    return clamped;
  }

  /**
   * Aktuelle gesetzte Höhe auslesen (aus localStorage/Inline-Style, nicht offsetHeight)
   * offsetHeight wäre ungenau bei max-height wenn Inhalt kleiner ist
   */
  function getContentHeight(panelCfg) {
    // Gespeicherten Wert als Basis verwenden (genauer als offsetHeight)
    var stored = loadHeight(panelCfg.storageKey, 0);
    if (stored > 0) return stored;

    var paneEl = document.getElementById(panelCfg.id);
    if (!paneEl) return panelCfg.defaultHeight;

    if (panelCfg.id === 'tp_overview_menu') {
      if (_useNewTree) {
        var tc = document.getElementById('lm-tree-container');
        return tc ? tc.offsetHeight : panelCfg.defaultHeight;
      }
      var kc = document.getElementById('kantons_container');
      return kc ? kc.offsetHeight : panelCfg.defaultHeight;
    } else {
      if (_useNewActivePanel) {
        var ac = document.getElementById('lm-active-container');
        return ac ? ac.offsetHeight : panelCfg.defaultHeight;
      }
      var outer = paneEl.querySelector('.dijitTitlePaneContentOuter');
      return outer ? outer.offsetHeight : panelCfg.defaultHeight;
    }
  }

  // ===== RESIZE-HANDLE ERSTELLEN =====

  /**
   * Erstellt und fügt Drag-Resize-Handle NACH dem TitlePane ein (als Geschwister im #spring)
   */
  function setupPanel(panelCfg) {
    var paneEl = document.getElementById(panelCfg.id);
    if (!paneEl) {
      TnetLog.warn('[AccordionResize] Panel nicht gefunden:', panelCfg.id);
      return;
    }

    // Prüfen ob Handle bereits existiert
    var existingHandle = paneEl.nextElementSibling;
    if (existingHandle && existingHandle.classList.contains('tnet-accordion-resize-handle')) return;

    // Handle-Element erstellen
    var handle = document.createElement('div');
    handle.className = 'tnet-accordion-resize-handle';
    handle.title = 'Höhe anpassen (ziehen)';
    handle.setAttribute('data-panel', panelCfg.id);

    // Handle NACH dem TitlePane-Element einfügen (als Geschwister im #spring)
    paneEl.parentNode.insertBefore(handle, paneEl.nextSibling);

    // Gespeicherte Höhe laden und anwenden
    var currentHeight = loadHeight(panelCfg.storageKey, panelCfg.defaultHeight);
    panelCfg.maxHeight = getMaxHeight(panelCfg.id);
    applyHeight(panelCfg, currentHeight);

    // ===== DRAG-LOGIK =====
    var startY = 0;
    var startHeight = 0;
    var isDragging = false;

    function onDragStart(e) {
      e.preventDefault();
      e.stopPropagation();

      isDragging = true;
      startY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
      startHeight = getContentHeight(panelCfg);
      panelCfg.maxHeight = getMaxHeight(panelCfg.id);

      // Globales Flag — verhindert aggressiveFix in tnet_toc.js
      window.__tnetResizing = true;
      document.body.classList.add('tnet-resizing');
      handle.classList.add('active');

      document.addEventListener('mousemove', onDragMove, { passive: false });
      document.addEventListener('mouseup', onDragEnd);
      document.addEventListener('touchmove', onDragMove, { passive: false });
      document.addEventListener('touchend', onDragEnd);
    }

    function onDragMove(e) {
      if (!isDragging) return;
      e.preventDefault();

      var clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;
      var deltaY = clientY - startY;
      var newHeight = startHeight + deltaY;

      applyHeight(panelCfg, newHeight);
    }

    function onDragEnd() {
      if (!isDragging) return;
      isDragging = false;

      document.removeEventListener('mousemove', onDragMove);
      document.removeEventListener('mouseup', onDragEnd);
      document.removeEventListener('touchmove', onDragMove);
      document.removeEventListener('touchend', onDragEnd);

      // Finale Höhe speichern
      var finalHeight = getContentHeight(panelCfg);
      saveHeight(panelCfg.storageKey, finalHeight);

      handle.classList.remove('active');
      document.body.classList.remove('tnet-resizing');

      // Flag verzögert zurücksetzen (damit Observer-Callbacks abgefangen werden)
      setTimeout(function () {
        window.__tnetResizing = false;
      }, 500);

      TnetLog.log('[AccordionResize] Neue Höhe gespeichert:', panelCfg.id, '→', finalHeight + 'px');
    }

    handle.addEventListener('mousedown', onDragStart);
    handle.addEventListener('touchstart', onDragStart, { passive: false });

    _handles.push({ panel: panelCfg, handle: handle, paneEl: paneEl });
    TnetLog.log('[AccordionResize] Handle eingefügt nach:', panelCfg.id, '→ Höhe:', currentHeight + 'px');

    // ===== DOJO TITLEPANE OPEN-WATCHER =====
    // Dojo setzt beim Öffnen Inline-Styles auf ContentOuter zurück.
    // Wir müssen unsere Höhen/Overflow-Styles danach erneut anwenden.
    watchTitlePaneOpen(panelCfg);
  }

  /**
   * Überwacht Dojo-TitlePane Öffnen/Schliessen (via dijit.byId oder MutationObserver)
   * und wendet Höhen-Styles nach dem Öffnen erneut an.
   */
  function watchTitlePaneOpen(panelCfg) {
    var paneEl = document.getElementById(panelCfg.id);
    if (!paneEl) return;

    // Strategie 1: Dojo widget.watch('open', ...) — zuverlässigste Methode
    if (typeof dijit !== 'undefined' && dijit.byId) {
      var widget = dijit.byId(panelCfg.id);
      if (widget && typeof widget.watch === 'function') {
        widget.watch('open', function (name, oldVal, newVal) {
          if (newVal) {
            // TitlePane wurde geöffnet → Styles nach Dojo-Animation erneut setzen
            // 350ms Delay: Dojo-Wipe-Animation dauert ca. 250ms
            setTimeout(function () {
              var h = loadHeight(panelCfg.storageKey, panelCfg.defaultHeight);
              panelCfg.maxHeight = getMaxHeight(panelCfg.id);
              applyHeight(panelCfg, h);
              TnetLog.log('[AccordionResize] TitlePane geöffnet → Höhe angewendet:', panelCfg.id, h + 'px');
            }, 350);
          }
        });
        TnetLog.log('[AccordionResize] Dojo widget.watch registriert für:', panelCfg.id);
        return;
      }
    }

    // Strategie 2: MutationObserver als Fallback (beobachtet CSS-Klasse dijitOpen)
    if (typeof MutationObserver !== 'undefined') {
      var observer = new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
          if (mutations[i].attributeName === 'class') {
            var el = mutations[i].target;
            if (el.classList.contains('dijitOpen')) {
              setTimeout(function () {
                var h = loadHeight(panelCfg.storageKey, panelCfg.defaultHeight);
                panelCfg.maxHeight = getMaxHeight(panelCfg.id);
                applyHeight(panelCfg, h);
              }, 350);
            }
          }
        }
      });
      observer.observe(paneEl, { attributes: true, attributeFilter: ['class'] });
      TnetLog.log('[AccordionResize] MutationObserver registriert für:', panelCfg.id);
    }
  }

  // ===== VIEWPORT-RESIZE =====

  function onWindowResize() {
    _handles.forEach(function (entry) {
      entry.panel.maxHeight = getMaxHeight(entry.panel.id);
      var currentHeight = loadHeight(entry.panel.storageKey, entry.panel.defaultHeight);
      applyHeight(entry.panel, currentHeight);
    });
  }

  // ===== INIT =====

  function init() {
    // Flags erneut lesen — tnet-log.js sollte jetzt sicher fertig sein
    readFlags();

    var allFound = CONFIG.panels.every(function (p) {
      return document.getElementById(p.id);
    });

    if (!allFound) {
      TnetLog.log('[AccordionResize] Panels noch nicht bereit, warte...');
      return false;
    }

    CONFIG.panels.forEach(setupPanel);

    // === CONTAINER-NACHVERFOLGUNG ===
    // #lm-active-container und #lm-tree-container werden von tnet-lm-init.js
    // asynchron erstellt. Wenn sie beim ersten setupPanel-Lauf noch nicht existieren,
    // warten wir per Polling und wenden die Höhe nach Erscheinen an.
    scheduleContainerRetry();

    // Fenster-Resize überwachen (debounced)
    var resizeTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(onWindowResize, 200);
    });

    TnetLog.log('[AccordionResize] Initialisiert (useNewTree=' + _useNewTree + ', useNewActivePanel=' + _useNewActivePanel + ')');
    return true;
  }

  /**
   * Wartet auf verspätet erstellte Container (#lm-active-container, #lm-tree-container)
   * und wendet die gespeicherte Höhe an, sobald sie im DOM auftauchen.
   */
  function scheduleContainerRetry() {
    var targets = [];

    if (_useNewActivePanel && !document.getElementById('lm-active-container')) {
      targets.push({ containerId: 'lm-active-container', panelId: 'tp_sort_menu' });
    }
    if (_useNewTree && !document.getElementById('lm-tree-container')) {
      targets.push({ containerId: 'lm-tree-container', panelId: 'tp_overview_menu' });
    }

    if (targets.length === 0) return; // Alles schon da

    TnetLog.log('[AccordionResize] Container noch nicht im DOM, starte Nachverfolgung:', targets.map(function (t) { return t.containerId; }).join(', '));

    var retryCount = 0;
    var maxRetries = 20; // 20 × 500ms = 10s
    var retryTimer = setInterval(function () {
      retryCount++;
      var remaining = [];

      for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        if (document.getElementById(t.containerId)) {
          // Container erschienen → Höhe anwenden
          var panelCfg = CONFIG.panels.filter(function (p) { return p.id === t.panelId; })[0];
          if (panelCfg) {
            var h = loadHeight(panelCfg.storageKey, panelCfg.defaultHeight);
            panelCfg.maxHeight = getMaxHeight(panelCfg.id);
            applyHeight(panelCfg, h);
            TnetLog.log('[AccordionResize] Container erschienen → Höhe angewendet:', t.containerId, h + 'px');
          }
        } else {
          remaining.push(t);
        }
      }

      targets = remaining;
      if (targets.length === 0 || retryCount >= maxRetries) {
        clearInterval(retryTimer);
        if (targets.length > 0) {
          TnetLog.warn('[AccordionResize] Container nach 10s nicht erschienen:', targets.map(function (t) { return t.containerId; }).join(', '));
        }
      }
    }, 500);
  }

  // ===== START MIT POLLING-FALLBACK =====
  var initDone = false;

  function tryInit() {
    if (initDone) return;
    if (init()) {
      initDone = true;
    }
  }

  // Event-basierter Start
  document.addEventListener('tnet-app-ready', function () {
    setTimeout(tryInit, 500);
  }, { once: true });

  // Polling-Fallback: mehrere Zeitpunkte
  setTimeout(tryInit, 2000);
  setTimeout(tryInit, 4000);
  setTimeout(tryInit, 6000);

  // Export
  window.TnetAccordionResize = {
    init: init,
    applyHeight: applyHeight,
    CONFIG: CONFIG
  };

})();
