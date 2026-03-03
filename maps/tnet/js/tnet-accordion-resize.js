/**
 * tnet-accordion-resize.js
 * Drag-Splitter für Sidepane-Accordions (Themenkatalog, Dargestellte Themen).
 * Fügt NACH jedem TitlePane einen horizontalen Resize-Handle ein,
 * mit dem die Höhe der jeweiligen Sektion per Drag verändert werden kann.
 * Höhen werden in localStorage gespeichert und beim Laden wiederhergestellt.
 *
 * @version    1.1
 * @date       2026-03-02
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */
(function () {
  'use strict';

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
   * Maximale Höhe berechnen: gesamter verfügbarer Platz abzüglich Header (69px),
   * Footer (26px), Titelbar (~35px) und etwas Puffer
   */
  function getMaxHeight() {
    return Math.round(window.innerHeight - 150);
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
   * Für tp_overview_menu: #kantons_container + ContentOuter bekommen height.
   * Für tp_sort_menu: ContentOuter bekommt max-height.
   */
  function applyHeight(panelCfg, height) {
    var clamped = Math.max(panelCfg.minHeight, Math.min(height, panelCfg.maxHeight || getMaxHeight()));
    var paneEl = document.getElementById(panelCfg.id);
    if (!paneEl) return clamped;

    var contentOuter = paneEl.querySelector('.dijitTitlePaneContentOuter');

    if (panelCfg.id === 'tp_overview_menu') {
      // Themenkatalog: feste Höhe auf kantons_container UND ContentOuter
      var kantonsContainer = document.getElementById('kantons_container');
      if (kantonsContainer) {
        kantonsContainer.style.setProperty('height', clamped + 'px', 'important');
      }
      if (contentOuter) {
        contentOuter.style.setProperty('height', clamped + 'px', 'important');
      }
    } else {
      // Dargestellte Themen: max-height + overflow-y
      if (contentOuter) {
        contentOuter.style.setProperty('max-height', clamped + 'px', 'important');
        contentOuter.style.setProperty('overflow-y', 'auto', 'important');
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
      var kc = document.getElementById('kantons_container');
      return kc ? kc.offsetHeight : panelCfg.defaultHeight;
    } else {
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
      console.warn('[AccordionResize] Panel nicht gefunden:', panelCfg.id);
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
    panelCfg.maxHeight = getMaxHeight();
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
      panelCfg.maxHeight = getMaxHeight();

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

      console.log('[AccordionResize] Neue Höhe gespeichert:', panelCfg.id, '→', finalHeight + 'px');
    }

    handle.addEventListener('mousedown', onDragStart);
    handle.addEventListener('touchstart', onDragStart, { passive: false });

    _handles.push({ panel: panelCfg, handle: handle, paneEl: paneEl });
    console.log('[AccordionResize] Handle eingefügt nach:', panelCfg.id, '→ Höhe:', currentHeight + 'px');
  }

  // ===== VIEWPORT-RESIZE =====

  function onWindowResize() {
    _handles.forEach(function (entry) {
      entry.panel.maxHeight = getMaxHeight();
      var currentHeight = loadHeight(entry.panel.storageKey, entry.panel.defaultHeight);
      applyHeight(entry.panel, currentHeight);
    });
  }

  // ===== INIT =====

  function init() {
    var allFound = CONFIG.panels.every(function (p) {
      return document.getElementById(p.id);
    });

    if (!allFound) {
      console.log('[AccordionResize] Panels noch nicht bereit, warte...');
      return false;
    }

    CONFIG.panels.forEach(setupPanel);

    // Fenster-Resize überwachen (debounced)
    var resizeTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(onWindowResize, 200);
    });

    console.log('[AccordionResize] Initialisiert');
    return true;
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
