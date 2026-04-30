/**
 * tnet-mapcontrols.js
 * Konfigurierbare Kartensteuerungs-Buttons (Zoom, GNSS, StreetView, 3D).
 * Ersetzt die Framework-generierte mainButtonBar durch moderne SVG-Icon-Buttons.
 * Konfiguration via /maps/tnet/config/tnet-mapcontrols-config.json5
 *
 * @version    1.0
 * @date       2026-04-01
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

// ===== TNET MAP CONTROLS MODULE =====
(function () {
  'use strict';

  function getAppRoot() {
    return window.__TNET_APP_ROOT || '/maps';
  }

  var CONFIG_PATH = getAppRoot() + '/tnet/config/tnet-mapcontrols-config.json5';

  // ===== SVG ICON DEFINITIONEN =====
  var ICONS = {
    'zoom-in': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">' +
      '<line x1="12" y1="6" x2="12" y2="18"/><line x1="6" y1="12" x2="18" y2="12"/></svg>',

    'zoom-out': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">' +
      '<line x1="6" y1="12" x2="18" y2="12"/></svg>',

    'gnss': '<svg viewBox="0 0 24 24" fill="none" stroke="#444" stroke-width="2" stroke-linecap="round">' +
      '<circle cx="12" cy="12" r="8" stroke-width="1.8" fill="none"/>' +
      '<circle cx="12" cy="12" r="3" fill="#4b7b81" stroke="none"/>' +
      '<line x1="12" y1="1" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="23"/>' +
      '<line x1="1" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="23" y2="12"/></svg>',

    'streetview': '<svg viewBox="0 0 24 24" fill="none" stroke="none">' +
      '<circle cx="12" cy="4" r="2.8" fill="#4b7b81"/>' +
      '<path d="M9 8h6c1.1 0 2 .9 2 2v3h-2v5h-1.5v-5h-3v5H9v-5H7v-3c0-1.1.9-2 2-2z" fill="#4b7b81"/>' +
      '<path d="M8 18l-.8 4h1.8l1-3h4l1 3h1.8l-.8-4z" fill="#4b7b81"/></svg>',

    '3d': '<svg viewBox="0 0 24 24" fill="none" stroke="#3a6268" stroke-width="1.3" stroke-linejoin="round">' +
      '<path d="M12 2L22 8L12 14L2 8Z" fill="#a8d0d5" stroke="#3a6268" stroke-width="1.3"/>' +
      '<path d="M12 14L22 8L22 16L12 22Z" fill="#6a9ea5" stroke="#3a6268" stroke-width="1.3"/>' +
      '<path d="M12 14L2 8L2 16L12 22Z" fill="#4b7b81" stroke="#3a6268" stroke-width="1.3"/></svg>',

    'compass': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<polygon points="12,2 15,11 12,9 9,11" fill="#dd1533" stroke="none"/>' +
      '<polygon points="12,22 9,13 12,15 15,13" fill="currentColor" stroke="none"/>' +
      '<circle cx="12" cy="12" r="10"/></svg>',

    'polygon': '<svg viewBox="0 0 24 24" fill="none" stroke="#444" stroke-width="1.5">' +
      '<path d="M4 6L12 3L20 8L18 18L8 20L4 6Z"/>' +
      '<circle fill="#444" stroke="none" cx="4" cy="6" r="1.8"/>' +
      '<circle fill="#444" stroke="none" cx="12" cy="3" r="1.8"/>' +
      '<circle fill="#444" stroke="none" cx="20" cy="8" r="1.8"/>' +
      '<circle fill="#444" stroke="none" cx="18" cy="18" r="1.8"/>' +
      '<circle fill="#444" stroke="none" cx="8" cy="20" r="1.8"/>' +
      '<circle cx="18" cy="5" r="6" fill="#4b7b81" stroke="white" stroke-width="1.2"/>' +
      '<text x="18" y="8.5" text-anchor="middle" fill="white" stroke="none" font-family="serif" font-style="italic" font-weight="bold" font-size="10">i</text></svg>',

    'oereb': '<svg viewBox="-4 -4 48 56">' +
      '<polygon points="2,4 26,4 40,16 40,44 2,44" fill="#4b7b81" stroke="none"/>' +
      '<polygon points="26,4 26,16 40,16" fill="white" stroke="none"/>' +
      '<circle cx="2" cy="4" r="2.5" fill="white" stroke="#3a6268" stroke-width="0.8"/>' +
      '<circle cx="26" cy="4" r="2.5" fill="white" stroke="#3a6268" stroke-width="0.8"/>' +
      '<circle cx="26" cy="16" r="2.5" fill="white" stroke="#3a6268" stroke-width="0.8"/>' +
      '<circle cx="40" cy="16" r="2.5" fill="white" stroke="#3a6268" stroke-width="0.8"/>' +
      '<circle cx="40" cy="44" r="2.5" fill="white" stroke="#3a6268" stroke-width="0.8"/>' +
      '<circle cx="2" cy="44" r="2.5" fill="white" stroke="#3a6268" stroke-width="0.8"/>' +
      '<circle cx="2" cy="4" r="6" fill="#e20000" stroke="white" stroke-width="1.2"/>' +
      '<circle cx="2" cy="4" r="3" fill="white" stroke="none"/>' +
      '<circle cx="2" cy="4" r="1.2" fill="#e20000" stroke="none"/>' +
      '<text x="21" y="36" text-anchor="middle" fill="white" stroke="none" font-family="Arial,sans-serif" font-weight="bold" font-size="11">ÖREB</text></svg>',
  };

  // ===== ACTION HANDLERS =====
  var ACTIONS = {
    zoomIn: function () {
      var map = _getMap();
      if (map) {
        var view = map.getView();
        view.animate({ zoom: view.getZoom() + 1, duration: 200 });
      }
    },
    zoomOut: function () {
      var map = _getMap();
      if (map) {
        var view = map.getView();
        view.animate({ zoom: view.getZoom() - 1, duration: 200 });
      }
    },
    locate: function (btnEl) {
      if (typeof njs !== 'undefined' && njs.AppManager) {
        njs.AppManager.getLocation('main', -1);
        // Toggle-Zustand visuell setzen
        if (btnEl) btnEl.classList.toggle('active');
      }
    },
    streetview: function (btnEl) {
      if (typeof njs !== 'undefined' && njs.AppManager &&
        njs.AppManager.Tools && njs.AppManager.Tools.StreetView &&
        njs.AppManager.Tools.StreetView['main']) {
        njs.AppManager.Tools.StreetView['main'].toggleView(true);
        if (btnEl) btnEl.classList.toggle('active');
      }
    },
    '3d': function (btnEl) {
      // 3D-Splitscreen (Landscape) ein-/ausschalten
      if (typeof toggleLandscape3D === 'function') {
        toggleLandscape3D();
        if (btnEl && window.TnetLandscape3D) {
          btnEl.classList.toggle('active', window.TnetLandscape3D.enabled);
        }
      }
    },
    resetRotation: function () {
      var map = _getMap();
      if (map) {
        map.getView().animate({ rotation: 0, duration: 300 });
      }
    },
    polygonDraw: function (btnEl) {
      if (typeof window.togglePolygonDraw === 'function') {
        window.togglePolygonDraw();
        // Active-Zustand wird von tnet-spatial-query.js auf #polygon-tool-btn gesetzt,
        // wir synchronisieren mit unserem Button
        if (btnEl) {
          setTimeout(function () {
            btnEl.classList.toggle('active', !!window.isPolygonDrawing);
          }, 50);
        }
      }
    },
    oerebMode: function (btnEl) {
      if (typeof window.toggleOerebMode === 'function') {
        window.toggleOerebMode();
        if (btnEl) {
          setTimeout(function () {
            btnEl.classList.toggle('active', !!window.isOerebActive);
          }, 50);
        }
      }
    },
  };

  // ===== PRIVATE HELPERS =====

  /** Gibt das OL-Map-Objekt zurück */
  function _getMap() {
    if (typeof njs !== 'undefined' && njs.AppManager &&
      njs.AppManager.Maps && njs.AppManager.Maps['main']) {
      return njs.AppManager.Maps['main'].mapObj;
    }
    return null;
  }

  /** Erstellt ein einzelnes Button-Element */
  function _createButton(btnCfg, size) {
    var btn = document.createElement('button');
    btn.className = 'tnet-mc-btn';
    btn.id = 'tnet-mc-' + btnCfg.id;
    btn.title = btnCfg.tooltip || '';
    btn.setAttribute('type', 'button');
    btn.style.width = size + 'px';
    btn.style.height = size + 'px';

    // Icon einfügen
    var iconHtml = ICONS[btnCfg.icon] || '';
    btn.innerHTML = iconHtml;

    // Click-Handler
    var actionFn = ACTIONS[btnCfg.action];
    if (actionFn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        actionFn(btn);
      });
    }

    return btn;
  }

  /** Erstellt eine Button-Gruppe */
  function _createGroup(groupCfg, size) {
    var group = document.createElement('div');
    group.className = 'tnet-mc-group';
    group.id = 'tnet-mc-group-' + groupCfg.id;

    var buttons = groupCfg.buttons || [];
    for (var i = 0; i < buttons.length; i++) {
      group.appendChild(_createButton(buttons[i], size));
    }

    return group;
  }

  /** Baut den gesamten Controls-Container */
  function _buildControls(config) {
    // Framework-ButtonBar verstecken
    var oldBar = document.getElementById('mainButtonBar');
    if (oldBar) {
      oldBar.style.display = 'none';
    }

    // Container erstellen
    var container = document.createElement('div');
    container.id = 'tnet-mapcontrols';
    container.className = 'tnet-mc-container';

    // Position setzen
    var pos = config.position || 'bottom-right';
    var offset = config.offset || {};
    var parts = pos.split('-');
    container.style[parts[0]] = (offset[parts[0]] || 16) + 'px';
    container.style[parts[1]] = (offset[parts[1]] || 16) + 'px';
    container.style.setProperty('--mc-group-gap', (config.groupGap || 10) + 'px');

    // Gruppen erstellen
    var groups = config.groups || [];
    for (var i = 0; i < groups.length; i++) {
      container.appendChild(_createGroup(groups[i], config.buttonSize || 40));
    }

    // In mapContainer einfügen
    var mapContainer = document.getElementById('mapContainer');
    if (mapContainer) {
      mapContainer.appendChild(container);
      console.log('[TnetMapControls] ' + groups.length + ' Gruppen gerendert');
      // Kompass autoHide: Rotation-Listener starten
      _initCompassAutoHide();
      // Split-Awareness: Controls wandern mit dem 2D-Panel mit
      _initSplitObserver(mapContainer);
    } else {
      console.warn('[TnetMapControls] #mapContainer nicht gefunden');
    }

    // OL-eigenen Rotate-Control verstecken
    var olRotate = document.querySelector('.ol-rotate');
    if (olRotate) olRotate.style.display = 'none';
  }

  // ===== SPLIT-AWARENESS =====
  /** Verschiebt Controls in den 2D-Panel wenn 3D-Split aktiv wird, zurück wenn deaktiviert */
  function _initSplitObserver(mapContainer) {
    if (!window.MutationObserver) return;

    var controls = document.getElementById('tnet-mapcontrols');
    if (!controls) return;

    // Referenz einmalig speichern — getElementById findet detached Elemente nicht
    var basemapSel = document.getElementById('basemap_selector');

    var observer = new MutationObserver(function () {
      var splitPanel2D = document.getElementById('split-panel-2d');
      if (splitPanel2D) {
        // 3D-Split ist aktiv → Controls in den linken (2D) Panel verschieben
        if (controls.parentNode !== splitPanel2D) {
          splitPanel2D.appendChild(controls);
          if (basemapSel) splitPanel2D.appendChild(basemapSel);
          console.log('[TnetMapControls] → in split-panel-2d verschoben');
        }
      } else {
        // Kein Split → Controls zurück in mapContainer
        if (controls.parentNode !== mapContainer) {
          mapContainer.appendChild(controls);
          if (basemapSel) mapContainer.appendChild(basemapSel);
          console.log('[TnetMapControls] → zurück in mapContainer');
        }
      }
    });

    observer.observe(mapContainer, { childList: true, subtree: false });
  }

  // ===== KOMPASS AUTO-HIDE =====
  /** Zeigt den Kompass-Button nur bei rotierter Karte, dreht das Icon mit */
  function _initCompassAutoHide() {
    var compassBtn = document.getElementById('tnet-mc-compass');
    if (!compassBtn) return;
    // Initial verstecken
    compassBtn.style.display = 'none';
    compassBtn.style.transition = 'opacity 0.3s ease';

    function _watchRotation() {
      var map = _getMap();
      if (!map) {
        // Map noch nicht bereit, erneut versuchen
        setTimeout(_watchRotation, 500);
        return;
      }
      var view = map.getView();
      // Initiale Prüfung
      _updateCompass(view.getRotation());
      // Listener auf Rotation
      view.on('change:rotation', function () {
        _updateCompass(view.getRotation());
      });
    }

    function _updateCompass(rotation) {
      if (!compassBtn) return;
      var isRotated = Math.abs(rotation) > 0.001;
      compassBtn.style.display = isRotated ? '' : 'none';
      // Icon mitdrehen (Nordpfeil zeigt immer nach Norden)
      var svg = compassBtn.querySelector('svg');
      if (svg) {
        svg.style.transform = 'rotate(' + rotation + 'rad)';
      }
    }

    _watchRotation();
  }

  // ===== INITIALISIERUNG =====
  function _init() {
    // Config laden (JSON5 ist bereits global verfügbar)
    fetch(CONFIG_PATH)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function (text) {
        var config;
        if (typeof JSON5 !== 'undefined') {
          config = JSON5.parse(text);
        } else {
          // Fallback: Kommentare entfernen und als JSON parsen
          text = text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
          text = text.replace(/,\s*([\]}])/g, '$1');
          config = JSON.parse(text);
        }
        _buildControls(config);
      })
      .catch(function (err) {
        console.error('[TnetMapControls] Fehler beim Laden der Konfiguration:', err);
      });
  }

  // ===== PUBLIC API =====
  window.TnetMapControls = {
    /** Manuell neu initialisieren (z.B. nach Config-Änderung) */
    reload: function () {
      var existing = document.getElementById('tnet-mapcontrols');
      if (existing) existing.remove();
      _init();
    },

    /** Einen Button per ID ein-/ausblenden */
    toggleButton: function (btnId, visible) {
      var btn = document.getElementById('tnet-mc-' + btnId);
      if (btn) btn.style.display = visible ? '' : 'none';
    },

    /** Aktiv-Zustand eines Buttons setzen/entfernen */
    setActive: function (btnId, active) {
      var btn = document.getElementById('tnet-mc-' + btnId);
      if (btn) btn.classList.toggle('active', !!active);
    },

    /** Eigene Action registrieren */
    registerAction: function (name, fn) {
      ACTIONS[name] = fn;
    },

    /** Eigenes Icon registrieren */
    registerIcon: function (name, svgHtml) {
      ICONS[name] = svgHtml;
    },
  };

  // Start: sobald DOM bereit
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

})();
