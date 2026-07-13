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

  function hasNewTreeContainer() {
    return !!document.getElementById('lm-tree-container');
  }

  function hasNewActiveContainer() {
    return !!document.getElementById('lm-active-container');
  }
  // Sofort versuchen (tnet-log.js sollte schon fertig sein)
  readFlags();

  // ===== KONFIGURATION =====

  // Defaults — werden durch tnet-global-config.json5 → sidepanel überschrieben
  var PANEL_DEFAULTS = {
    tp_overview_menu:   { defaultHeight: 450, minHeight: 150 },
    tp_sort_menu:       { defaultHeight: 300, minHeight: 80 },
    tp_tools_menu:      { defaultHeight: 250, minHeight: 80 },
    tp_tnet_print_menu: { defaultHeight: 250, minHeight: 120 }
  };

  // StorageKey-Mapping (fix, nicht konfigurierbar)
  var STORAGE_KEYS = {
    tp_overview_menu:   'tnet-catalog-height',
    tp_sort_menu:       'tnet-active-height',
    tp_tools_menu:      'tnet-tools-height',
    tp_tnet_print_menu: 'tnet-print-height'
  };

  // Global Config auslesen (falls bereits geladen)
  var _gcfg = (window.TnetGlobalConfig && window.TnetGlobalConfig.sidepanel) || {};
  var _gcfgPanels = _gcfg.panels || {};

  function buildConfig() {
    var panelIds = ['tp_overview_menu', 'tp_sort_menu', 'tp_tools_menu', 'tp_tnet_print_menu'];
    var panels = [];
    for (var i = 0; i < panelIds.length; i++) {
      var id = panelIds[i];
      var def = PANEL_DEFAULTS[id];
      var ovr = _gcfgPanels[id] || {};
      panels.push({
        id: id,
        storageKey: STORAGE_KEYS[id],
        minHeight: ovr.minHeight != null ? ovr.minHeight : def.minHeight,
        maxHeight: null,
        defaultHeight: ovr.defaultHeight != null ? ovr.defaultHeight : def.defaultHeight
      });
    }
    return { panels: panels };
  }

  var CONFIG = buildConfig();

  // ===== STATE =====
  var _handles = [];
  var _refreshTimer = null;
  var _layoutObserver = null;
  var _mutationObserver = null;

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
  function getMaxHeight(panelId, useActual) {
    var spring = document.getElementById('spring');
    if (!spring) return Math.round(window.innerHeight - 150);

    // #spring's verfügbare Höhe ermitteln:
    // Wenn Spatial-Query angedockt → CSS max-height ist 100% → computedStyle liefert keine Pixel.
    // Daher: offsetHeight als primäre Quelle, computedStyle als Fallback.
    var springMaxH;
    var computedMax = window.getComputedStyle(spring).maxHeight;
    if (computedMax && computedMax.indexOf('px') !== -1) {
      springMaxH = parseFloat(computedMax);
    }
    if (!springMaxH || isNaN(springMaxH) || springMaxH <= 0) {
      // offsetHeight = tatsächlich gerenderte Höhe (funktioniert immer)
      springMaxH = spring.offsetHeight;
    }
    if (!springMaxH || springMaxH <= 0) {
      springMaxH = window.innerHeight - 105;
    }

    // Falls kein panelId: grober Fallback
    if (!panelId) return Math.round(springMaxH - 170);

    // Padding von #spring abziehen
    var cs = window.getComputedStyle(spring);
    var padding = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);

    // Resizable Panel-IDs für späteren Vergleich
    var resizablePanelMap = {};
    CONFIG.panels.forEach(function (p) { resizablePanelMap[p.id] = p; });

    // Höhe aller ANDEREN Elemente in #spring ermitteln.
    // Für das EIGENE Panel: nur Titelleiste zählen.
    // Für das ANDERE resizable Panel:
    //   useActual=false (Drag): Titelleiste + minHeight (grosszügig, damit man vergrössern kann)
    //   useActual=true  (Recalc): Tatsächliche Inhaltshöhe (damit beide Panels zusammen passen)
    // Für alle sonstigen Elemente: vollen offsetHeight zählen.
    var otherH = 0;
    var children = spring.children;
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (child.id === panelId) {
        // Eigene Titelleiste mitzählen (Inhalt wird separat gesteuert)
        var titleBar = child.querySelector('summary.tnet-panel-title') || child.querySelector('.dijitTitlePaneTitle');
        if (titleBar) otherH += titleBar.offsetHeight;
      } else if (resizablePanelMap[child.id]) {
        var otherCfg = resizablePanelMap[child.id];
        var otherTitle = child.querySelector('summary.tnet-panel-title') || child.querySelector('.dijitTitlePaneTitle');
        var titleH = otherTitle ? otherTitle.offsetHeight : 30;
        // Bei geschlossenem <details> nur Titel zählen
        if (child.tagName === 'DETAILS' && !child.open) {
          otherH += titleH;
        } else if (useActual) {
          // Tatsächliche Inhaltshöhe verwenden (für recalc — damit beides passt)
          var otherContent = child.querySelector('.tnet-panel-content') || child.querySelector('.dijitTitlePaneContentOuter');
          var actualH = otherContent ? otherContent.offsetHeight : otherCfg.defaultHeight;
          otherH += titleH + Math.max(otherCfg.minHeight, actualH);
        } else {
          // Nur minHeight reservieren (für Drag — grosszügig)
          otherH += titleH + otherCfg.minHeight;
        }
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
  // ===== DOM-ELEMENT-CACHE (einmalig beim DragStart befüllt) =====
  var _elCache = {};

  function buildElCache() {
    _elCache = {};
    CONFIG.panels.forEach(function (p) {
      var paneEl = document.getElementById(p.id);
      if (!paneEl) return;
      _elCache[p.id] = {
        pane: paneEl,
        content: paneEl.querySelector('.tnet-panel-content') || paneEl.querySelector('.dijitTitlePaneContentOuter')
      };
    });
    _elCache.tree = document.getElementById('lm-tree-container');
    _elCache.active = document.getElementById('lm-active-container');
    _elCache.kantons = document.getElementById('kantons_container');
    _elCache.useTree = _useNewTree || !!_elCache.tree;
    _elCache.useActive = _useNewActivePanel || !!_elCache.active;
    _elCache.docEl = document.documentElement;
  }

  function applyHeight(panelCfg, height) {
    var clamped = Math.max(panelCfg.minHeight, Math.min(height, panelCfg.maxHeight || getMaxHeight(panelCfg.id)));

    // Optimierung: NUR die CSS-Variable setzen.
    // Die CSS-Regeln in tnet-sidepanel.css referenzieren diese Variablen
    // bereits mit !important → kein style.cssText / setProperty nötig.
    // Ein einziger Custom-Property-Write pro Panel statt 3-4 style-Writes = deutlich weniger Reflows.
    var docEl = _elCache.docEl || document.documentElement;
    if (panelCfg.id === 'tp_overview_menu') {
      docEl.style.setProperty('--tnet-catalog-height', clamped + 'px');
    } else if (panelCfg.id === 'tp_sort_menu') {
      docEl.style.setProperty('--tnet-active-height', clamped + 'px');
    } else if (panelCfg.id === 'tp_tools_menu') {
      docEl.style.setProperty('--tnet-tools-height', clamped + 'px');
    } else if (panelCfg.id === 'tp_tnet_print_menu') {
      docEl.style.setProperty('--tnet-print-height', clamped + 'px');
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
      if (_useNewTree || hasNewTreeContainer()) {
        var tc = document.getElementById('lm-tree-container');
        return tc ? tc.offsetHeight : panelCfg.defaultHeight;
      }
      var kc = document.getElementById('kantons_container');
      return kc ? kc.offsetHeight : panelCfg.defaultHeight;
    } else if (panelCfg.id === 'tp_tools_menu') {
      var tc = paneEl.querySelector('.tnet-panel-content');
      return tc ? tc.scrollHeight : panelCfg.defaultHeight;
    } else if (panelCfg.id === 'tp_tnet_print_menu') {
      var pc = paneEl.querySelector('.tnet-panel-content');
      return pc ? pc.scrollHeight : panelCfg.defaultHeight;
    } else {
      if (_useNewActivePanel || hasNewActiveContainer()) {
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
    var prevHandle = paneEl.previousElementSibling;
    if ((existingHandle && existingHandle.classList.contains('tnet-accordion-resize-handle') && existingHandle.getAttribute('data-panel') === panelCfg.id) ||
        (prevHandle && prevHandle.classList.contains('tnet-accordion-resize-handle') && prevHandle.getAttribute('data-panel') === panelCfg.id)) return;

    // Handle-Element erstellen
    var handle = document.createElement('div');
    handle.className = 'tnet-accordion-resize-handle';
    handle.title = 'Höhe anpassen (ziehen)';
    handle.setAttribute('data-panel', panelCfg.id);

    // Handle-Position: NACH dem Panel einfügen (als Geschwister im #spring)
    paneEl.parentNode.insertBefore(handle, paneEl.nextSibling);

    // Config-Default bei jedem App-Start anwenden (überschreibt localStorage)
    var currentHeight = panelCfg.defaultHeight;
    saveHeight(panelCfg.storageKey, currentHeight);
    panelCfg.maxHeight = getMaxHeight(panelCfg.id);
    applyHeight(panelCfg, currentHeight);

    // ===== DRAG-LOGIK =====
    var startY = 0;
    var startHeight = 0;
    var isDragging = false;
    var lastAppliedHeight = 0;

    // Gekoppeltes Resize: das andere Panel wird gleichzeitig verkleinert/vergrössert
    var siblingCfg = null;
    var siblingStartHeight = 0;
    var lastSiblingHeight = 0;
    var totalBudget = 0;

    function findSiblingPanel() {
      for (var i = 0; i < CONFIG.panels.length; i++) {
        if (CONFIG.panels[i].id !== panelCfg.id) {
          var sibEl = document.getElementById(CONFIG.panels[i].id);
          // Nur offene Panels als Sibling zählen
          if (sibEl && (sibEl.tagName !== 'DETAILS' || sibEl.open)) {
            return CONFIG.panels[i];
          }
        }
      }
      return null;
    }

    function onDragStart(e) {
      e.preventDefault();
      e.stopPropagation();

      isDragging = true;
      _rafPending = false;
      startY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;

      // DOM-Element-Cache einmalig aufbauen (kein getElementById während Drag)
      buildElCache();

      // Alle Werte EINMALIG berechnen (kein DOM-Read während Drag)
      // useActual wird erst nach Sibling-Bestimmung korrigiert (s.u.)
      panelCfg.maxHeight = getMaxHeight(panelCfg.id, true);
      var rawH = getContentHeight(panelCfg);
      startHeight = Math.max(panelCfg.minHeight, Math.min(rawH, panelCfg.maxHeight));
      lastAppliedHeight = startHeight;

      // Sibling-Panel für gekoppeltes Resize vorbereiten
      // Nur das Handle ZWISCHEN den Panels koppelt (erstes Panel).
      // Das Handle nach dem letzten Panel resized unabhängig,
      // sonst wächst das Panel visuell nach oben statt nach unten.
      if (panelCfg.id !== CONFIG.panels[CONFIG.panels.length - 1].id) {
        siblingCfg = findSiblingPanel();
      } else {
        siblingCfg = null;
      }
      if (siblingCfg) {
        // Bei Kopplung: maxHeight NEU berechnen mit useActual=false,
        // damit nur minHeight des Siblings reserviert wird — so kann dieses Panel
        // in den Schrumpfraum des Siblings hineinwachsen.
        panelCfg.maxHeight = getMaxHeight(panelCfg.id, false);

        var sibRawH = getContentHeight(siblingCfg);
        siblingCfg.maxHeight = getMaxHeight(siblingCfg.id, false);
        siblingStartHeight = Math.max(siblingCfg.minHeight, Math.min(sibRawH, siblingCfg.maxHeight));
        lastSiblingHeight = siblingStartHeight;
      }

      // Gesamtbudget vorberechnen: wie viel Platz haben beide zusammen?
      totalBudget = startHeight + (siblingCfg ? siblingStartHeight : 0);

      // Globales Flag — verhindert Observer-Interference + schaltet CSS-Transitions ab
      window.__tnetResizing = true;
      document.body.classList.add('tnet-resizing');
      handle.classList.add('active');

      document.addEventListener('mousemove', onDragMove, { passive: false });
      document.addEventListener('mouseup', onDragEnd);
      document.addEventListener('touchmove', onDragMove, { passive: false });
      document.addEventListener('touchend', onDragEnd);
    }

    var _rafPending = false;
    var _pendingClientY = 0;

    function onDragMove(e) {
      if (!isDragging) return;
      e.preventDefault();

      _pendingClientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;

      // RAF-Throttle: DOM-Writes nur 1× pro Frame
      if (_rafPending) return;
      _rafPending = true;
      requestAnimationFrame(function () {
        _rafPending = false;
        if (!isDragging) return;

        var deltaY = _pendingClientY - startY;
        var newHeight = startHeight + deltaY;

      // Clampen auf min/max
      newHeight = Math.max(panelCfg.minHeight, newHeight);

      if (siblingCfg) {
        // Gekoppelt: Budget zwischen beiden Panels aufteilen
        // Neues Panel darf maximal so gross werden, dass Sibling auf minHeight bleibt
        var maxForThis = totalBudget - siblingCfg.minHeight;
        newHeight = Math.min(newHeight, maxForThis);

        // Auch auf eigenes maxHeight clampen, BEVOR Sibling berechnet wird.
        // Sonst schrumpft Sibling, obwohl dieses Panel gar nicht wächst (am Max).
        newHeight = Math.min(newHeight, panelCfg.maxHeight);

        // Sibling bekommt den Rest
        var sibNewHeight = totalBudget - newHeight;
        sibNewHeight = Math.max(siblingCfg.minHeight, sibNewHeight);
        // Sibling ebenfalls auf sein maxHeight clampen
        sibNewHeight = Math.min(sibNewHeight, siblingCfg.maxHeight);
        lastSiblingHeight = applyHeight(siblingCfg, sibNewHeight);
      } else {
        newHeight = Math.min(newHeight, panelCfg.maxHeight);
      }

      lastAppliedHeight = applyHeight(panelCfg, newHeight);
      }); // Ende requestAnimationFrame
    }

    function onDragEnd() {
      if (!isDragging) return;
      isDragging = false;

      document.removeEventListener('mousemove', onDragMove);
      document.removeEventListener('mouseup', onDragEnd);
      document.removeEventListener('touchmove', onDragMove);
      document.removeEventListener('touchend', onDragEnd);

      // Finale Höhen speichern
      saveHeight(panelCfg.storageKey, lastAppliedHeight);
      if (siblingCfg && lastSiblingHeight !== siblingStartHeight) {
        saveHeight(siblingCfg.storageKey, lastSiblingHeight);
        TnetLog.log('[AccordionResize] Sibling-Höhe gespeichert:', siblingCfg.id, '→', lastSiblingHeight + 'px');
      }
      siblingCfg = null;

      handle.classList.remove('active');
      document.body.classList.remove('tnet-resizing');

      // Flag verzögert zurücksetzen (damit Observer-Callbacks abgefangen werden)
      setTimeout(function () {
        window.__tnetResizing = false;
      }, 500);

      TnetLog.log('[AccordionResize] Neue Höhe gespeichert:', panelCfg.id, '→', lastAppliedHeight + 'px');
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
   * Überwacht Panel Öffnen/Schliessen (via toggle-Event auf details-Element
   * oder Fallback: dijit.byId für Legacy Dojo TitlePanes)
   * und wendet Höhen-Styles nach dem Öffnen erneut an.
   */
  /**
   * Alle Panels neu berechnen und clampen.
   * Wird aufgerufen wenn ein Panel geöffnet/geschlossen wird,
   * damit BEIDE Panels gemeinsam in den verfügbaren Platz passen.
   */
  /**
   * Natürliche Inhaltshöhe eines Panels messen (scrollHeight des Inhalts-Containers).
   * Gibt 0 zurück wenn der Container nicht gefunden wird.
   */
  function getNaturalContentHeight(panelId) {
    if (panelId === 'tp_overview_menu') {
      // Inhalt des Themenkatalogs messen
      var treeContainer = document.getElementById('lm-tree-container');
      if (treeContainer) {
        var catContent = treeContainer.querySelector('.lm-cat-content');
        if (catContent) return catContent.scrollHeight;
        return treeContainer.scrollHeight;
      }
    } else if (panelId === 'tp_sort_menu') {
      var activeContainer = document.getElementById('lm-active-container');
      if (activeContainer) return activeContainer.scrollHeight;
    }
    return 0;
  }

  function recalcAllPanels(reason) {
    // Sequentiell verarbeiten:
    // Panel 1 (Themenkatalog) bekommt grosszügiges Maximum (andere auf minHeight).
    // Panel 2 (Dargestellte Themen) sieht die TATSÄCHLICHE Höhe von Panel 1
    // im DOM und bekommt nur den verbleibenden Platz → kein Overflow.
    _handles.forEach(function (entry, index) {
      entry.panel.maxHeight = getMaxHeight(entry.panel.id, index > 0);
      var h = loadHeight(entry.panel.storageKey, entry.panel.defaultHeight);
      var clamped = applyHeight(entry.panel, h);
      // Gespeicherten Wert aktualisieren wenn er geclamped wurde
      if (clamped !== h) {
        saveHeight(entry.panel.storageKey, clamped);
      }
    });
    TnetLog.log('[AccordionResize] recalcAllPanels:', reason || '');
  }

  // ===== EXKLUSIV-ACCORDION =====
  // Nur ein Panel gleichzeitig offen (Ausnahme: tp_ov_menu / Navigieren)
  // Steuerbar via tnet-global-config.json5 → sidepanel.exclusiveAccordion
  var _suppressExclusive = false;
  var _exclusiveEnabled = _gcfg.exclusiveAccordion !== false; // Default: true

  function closeOtherPanels(openedId) {
    if (!_exclusiveEnabled) return;
    if (_suppressExclusive) return;
    _suppressExclusive = true;

    // Alle <details> im #spring durchgehen
    var spring = document.getElementById('spring');
    if (!spring) { _suppressExclusive = false; return; }

    var panels = spring.querySelectorAll('details.tnet-panel');
    for (var i = 0; i < panels.length; i++) {
      var p = panels[i];
      // Navigieren (tp_ov_menu) nie schliessen
      if (p.id === 'tp_ov_menu') continue;
      // Das gerade geöffnete Panel nicht schliessen
      if (p.id === openedId) continue;
      // Versteckte Panels ignorieren
      if (p.style.display === 'none') continue;
      if (p.open) {
        p.open = false;
      }
    }

    _suppressExclusive = false;
  }

  function watchTitlePaneOpen(panelCfg) {
    var paneEl = document.getElementById(panelCfg.id);
    if (!paneEl) return;

    // Strategie 1: Natives details-Element — toggle-Event
    if (paneEl.tagName === 'DETAILS') {
      paneEl.addEventListener('toggle', function () {
        if (paneEl.open) {
          // Exklusiv-Accordion: andere Panels schliessen (ausser Navigieren)
          closeOtherPanels(panelCfg.id);

          // Beim Öffnen: Inhaltshöhe messen und als Zielgrösse verwenden,
          // damit z.B. alle Level-1-Einträge sichtbar sind (wenn Platz reicht).
          setTimeout(function () {
            if (panelCfg.id === 'tp_overview_menu') {
              var naturalH = getNaturalContentHeight(panelCfg.id);
              if (naturalH > 0) {
                var maxH = getMaxHeight(panelCfg.id, true);
                var targetH = Math.min(naturalH, maxH);
                targetH = Math.max(panelCfg.minHeight, targetH);
                applyHeight(panelCfg, targetH);
                saveHeight(panelCfg.storageKey, targetH);
              }
            }
            recalcAllPanels('toggle-' + panelCfg.id);
          }, 50);
          // Nochmal nach kurzem Timeout (DOM-Layout fertig stabilisiert)
          setTimeout(function () {
            recalcAllPanels('toggle-delayed-' + panelCfg.id);
          }, 200);
        }
      });
      TnetLog.log('[AccordionResize] toggle-Event registriert für:', panelCfg.id);
      return;
    }

    // Strategie 2: Dojo widget.watch('open', ...) — für Legacy TitlePanes (z.B. tp_wms_menu)
    if (typeof dijit !== 'undefined' && dijit.byId) {
      var widget = dijit.byId(panelCfg.id);
      if (widget && typeof widget.watch === 'function') {
        widget.watch('open', function (name, oldVal, newVal) {
          if (newVal) {
            setTimeout(function () {
              recalcAllPanels('dijitWatch-' + panelCfg.id);
            }, 350);
          }
        });
        TnetLog.log('[AccordionResize] Dojo widget.watch registriert für:', panelCfg.id);
        return;
      }
    }

    // Strategie 3: MutationObserver als Fallback
    if (typeof MutationObserver !== 'undefined') {
      var observer = new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
          if (mutations[i].attributeName === 'class') {
            var el = mutations[i].target;
            if (el.classList.contains('dijitOpen')) {
              setTimeout(function () {
                recalcAllPanels('dijitOpen-' + panelCfg.id);
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
    recalcAllPanels('window-resize');
  }

  function scheduleRefresh(reason, delay) {
    if (window.__tnetResizing) return;
    if (_refreshTimer) clearTimeout(_refreshTimer);
    _refreshTimer = setTimeout(function () {
      if (window.__tnetResizing) return;
      recalcAllPanels(reason || 'scheduleRefresh');
    }, typeof delay === 'number' ? delay : 120);
  }

  function scheduleStabilizedRefreshes(reason) {
    [0, 120, 400, 900, 1600].forEach(function (delay) {
      setTimeout(function () {
        if (window.__tnetResizing) return;
        recalcAllPanels(reason + '-' + delay + 'ms');
      }, delay);
    });
  }

  function installLayoutObserver() {
    if (typeof ResizeObserver === 'undefined' || _layoutObserver) return;

    var spring = document.getElementById('spring');
    var freepane = document.getElementById('freepane');
    if (!spring && !freepane) return;

    _layoutObserver = new ResizeObserver(function () {
      scheduleRefresh('ResizeObserver', 80);
    });

    if (spring) _layoutObserver.observe(spring);
    if (freepane) _layoutObserver.observe(freepane);
  }

  function installMutationObserver() {
    if (typeof MutationObserver === 'undefined' || _mutationObserver) return;

    var spring = document.getElementById('spring');
    if (!spring) return;

    _mutationObserver = new MutationObserver(function (mutations) {
      if (window.__tnetResizing) return;
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (m.type === 'childList') {
          scheduleRefresh('MutationObserver-childList', 80);
          return;
        }
        if (m.type === 'attributes') {
          // Wichtig für <details open>, class/style-Umschaltungen und Inline-Height-Updates
          if (m.attributeName === 'open' || m.attributeName === 'class' || m.attributeName === 'style') {
            scheduleRefresh('MutationObserver-attr-' + m.attributeName, 80);
            return;
          }
        }
      }
    });

    _mutationObserver.observe(spring, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['open', 'class', 'style']
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

    // Mehrfach nachklemmen, weil Tree/Active-Panel, Fonts und dynamische Inhalte
    // zeitversetzt eintreffen können. Ohne diese Folge-Refreshes ist das Panel
    // teils erst nach Benutzerinteraktion korrekt geklemmt.
    scheduleStabilizedRefreshes('init');
    installLayoutObserver();
    installMutationObserver();

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

    window.addEventListener('load', function () {
      scheduleStabilizedRefreshes('window-load');
    }, { once: true });

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        scheduleStabilizedRefreshes('fonts-ready');
      });
    }

    TnetLog.log('[AccordionResize] Initialisiert (useNewTree=' + _useNewTree + ', useNewActivePanel=' + _useNewActivePanel + ')');
    return true;
  }

  /**
   * Wartet auf verspätet erstellte Container (#lm-active-container, #lm-tree-container)
   * und wendet die gespeicherte Höhe an, sobald sie im DOM auftauchen.
   */
  function scheduleContainerRetry() {
    var targets = [];

    if ((_useNewActivePanel || hasNewActiveContainer()) && !document.getElementById('lm-active-container')) {
      targets.push({ containerId: 'lm-active-container', panelId: 'tp_sort_menu' });
    }
    if ((_useNewTree || hasNewTreeContainer()) && !document.getElementById('lm-tree-container')) {
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
          // Container erschienen → alle Panels neu berechnen
          TnetLog.log('[AccordionResize] Container erschienen:', t.containerId);
          recalcAllPanels('container-' + t.containerId);
          scheduleStabilizedRefreshes('container-' + t.containerId);
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
    setTimeout(tryInit, 0);
  }, { once: true });

  // Früher Initialisierungsversuch (falls Panels bereits da sind)
  setTimeout(tryInit, 0);

  // Polling-Fallback: mehrere Zeitpunkte
  setTimeout(tryInit, 800);
  setTimeout(tryInit, 2000);
  setTimeout(tryInit, 4000);

  // Export
  window.TnetAccordionResize = {
    init: init,
    applyHeight: applyHeight,
    scheduleRefresh: scheduleRefresh,
    CONFIG: CONFIG
  };

})();
