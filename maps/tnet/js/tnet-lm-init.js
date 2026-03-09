/**
 * tnet-lm-init.js
 * Initialisierer für den neuen Layer-Manager (Desktop + Mobile)
 *
 * Liest Feature-Flags aus tnet-global-config.json5 → layerManager:
 *   - useNewActivePanel: Dargestellte-Themen-Panel (Drag&Drop)
 *   - useNewTree:        Themenkatalog-Baum (Wappen-Tabs + Suche)
 *   - useNewWmsPanel:    WMS-TitlePane ausblenden (neues Panel im Hamburger-Menü)
 *
 * Flow:
 *   1. Config laden (async via fetch + JSON5)
 *   2. Feature-Flags auswerten (Rückwärtskompatibel mit altem useNew)
 *   3. Legacy-Container ausblenden (display:none, NICHT entfernen → Parallel-Betrieb)
 *   4. Neue Container erzeugen
 *   5. TnetLMStore → TnetLMTree → TnetLMActive initialisieren
 *   6. Fallback-Timer: nach 6s Legacy wiederherstellen wenn Module nicht laden
 *
 * Muss NACH den drei Modulen geladen werden (defer).
 *
 * @version    2.0
 * @date       2026-03-04
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */
(function () {
  'use strict';

  // ===== KONSTANTEN =====
  var LOG = '[LM-Init]';
  var FALLBACK_TIMEOUT = 6000; // ms bis Legacy-Fallback greift

  // ===== ZUSTAND =====
  var _isDesktop = !window.__TNET_MOBILE_ENTRY;
  var _lmFallbackTimer = null;
  var _useNewActivePanel = false;
  var _useNewTree = false;
  var _useNewWmsPanel = false;

  // ===== CONFIG LADEN =====

  function loadConfig() {
    if (typeof JSON5 === 'undefined') {
      TnetLog.warn(LOG, 'JSON5 nicht verfügbar');
      return Promise.resolve(null);
    }
    var paths = [
      '/maps/tnet/config/tnet-global-config.json5',
      '/maps/tnet/tnet-global-config.json5',
      '../tnet/config/tnet-global-config.json5'
    ];
    function tryPath(i) {
      if (i >= paths.length) return Promise.resolve(null);
      return fetch(paths[i])
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
        .then(function (t) { return JSON5.parse(t); })
        .catch(function () { return tryPath(i + 1); });
    }
    return tryPath(0);
  }

  // ===== LEGACY-CONTAINER MANAGEMENT =====

  /**
   * Legacy-Container ausblenden je nach aktiven Feature-Flags.
   * WICHTIG: Elemente werden NICHT aus dem DOM entfernt, nur visuell
   * versteckt (display:none). Legacy-Tree bleibt für Parallel-Betrieb
   * (Feature-Edit-Tools, Werkzeuge) im Hintergrund verfügbar.
   */
  function hideLegacyContainers() {
    TnetLog.log(LOG, 'hideLegacyContainers — Desktop=' + _isDesktop +
      ', useNewActivePanel=' + _useNewActivePanel +
      ', useNewTree=' + _useNewTree +
      ', useNewWmsPanel=' + _useNewWmsPanel);

    // --- Active-Panel (Dargestellte Themen) ---
    if (_useNewActivePanel) {
      _hideById('njs_main_lyrsorter_wrapper');
      if (!_isDesktop) {
        _hideById('sort_menu_sheet');
      }
    }

    // --- Themenkatalog-Baum ---
    if (_useNewTree) {
      if (_isDesktop) {
        // Desktop: Die 4 Kantons-Wrapper verstecken, aber #kantons_container
        // selbst NICHT — Dojo TitlePane braucht es für offsetHeight-Berechnung.
        // Stattdessen alle Kinder von #kantons_container ausblenden.
        var kantonsContainer = document.getElementById('kantons_container');
        if (kantonsContainer) {
          var children = kantonsContainer.children;
          for (var i = 0; i < children.length; i++) {
            children[i].style.display = 'none';
          }
          TnetLog.log(LOG, '#kantons_container Kinder ausgeblendet (' + children.length + ')');
        }
      } else {
        // Mobile: kantons_container komplett ausblenden
        _hideById('kantons_container');
      }
    }

    // --- WMS-TitlePane ---
    if (_useNewWmsPanel) {
      _hideById('tp_wms_menu');
    }
  }

  /**
   * Legacy-Container wieder einblenden (Fallback bei Fehler/Timeout).
   */
  function showLegacyContainers() {
    TnetLog.warn(LOG, 'Fallback: Legacy-Container werden wieder eingeblendet');

    // Active-Panel
    _showById('njs_main_lyrsorter_wrapper');
    if (!_isDesktop) {
      _showById('sort_menu_sheet');
    }

    // Themenkatalog
    if (_isDesktop) {
      // Desktop: Kinder von #kantons_container wieder einblenden
      var kantonsContainer = document.getElementById('kantons_container');
      if (kantonsContainer) {
        var children = kantonsContainer.children;
        for (var i = 0; i < children.length; i++) {
          // Nur die Legacy-Elemente wieder zeigen, nicht den neuen Tree-Container
          if (children[i].id !== 'lm-tree-container') {
            children[i].style.display = '';
          }
        }
      }
    } else {
      _showById('kantons_container');
    }

    // WMS
    _showById('tp_wms_menu');
  }

  /** Element per ID ausblenden */
  function _hideById(id) {
    var el = document.getElementById(id);
    if (el) {
      el.style.display = 'none';
      TnetLog.log(LOG, '#' + id + ' ausgeblendet');
    }
  }

  /** Element per ID wieder einblenden */
  function _showById(id) {
    var el = document.getElementById(id);
    if (el) {
      el.style.display = '';
    }
  }

  /**
   * Fallback auf Legacy aktivieren: neue Container entfernen,
   * Legacy-Container wiederherstellen.
   */
  function activateLegacyFallback(reason) {
    TnetLog.warn(LOG, 'Fallback auf Legacy-Themenbaum:', reason || 'unbekannt');
    if (_lmFallbackTimer) {
      clearTimeout(_lmFallbackTimer);
      _lmFallbackTimer = null;
    }
    // Neuen Tree-Container entfernen
    var treeContainer = document.getElementById('lm-tree-container');
    if (treeContainer && treeContainer.parentNode) {
      treeContainer.parentNode.removeChild(treeContainer);
    }
    showLegacyContainers();
  }

  // ===== NEUE CONTAINER ERSTELLEN =====

  /**
   * DOM-Container für den neuen Layer-Manager erzeugen.
   * Desktop: Tree in #kantons_container, Active in #sort_menu
   * Mobile:  Tree in #m-layers-sheet, Active bereits im HTML
   */
  function createNewContainers() {
    var platformClass = _isDesktop ? 'lm-container lm-container-desktop' : 'lm-container';

    // --- Tree-Container (Themenkatalog) ---
    if (_useNewTree && !document.getElementById('lm-tree-container')) {
      var treeContainer = document.createElement('div');
      treeContainer.id = 'lm-tree-container';
      treeContainer.className = platformClass;

      if (_isDesktop) {
        // Desktop: In #kantons_container einfügen (innerhalb Dojo TitlePane "Themenkatalog").
        // Die Legacy-Kinder sind bereits per display:none versteckt.
        var kantonsContainer = document.getElementById('kantons_container');
        if (kantonsContainer) {
          kantonsContainer.appendChild(treeContainer);
          TnetLog.log(LOG, '[Desktop] #lm-tree-container in #kantons_container erstellt');
        } else {
          // Fallback: direkt in tp_overview_menu
          var overviewMenu = document.getElementById('tp_overview_menu');
          if (overviewMenu) {
            overviewMenu.appendChild(treeContainer);
            TnetLog.log(LOG, '[Desktop] #lm-tree-container in #tp_overview_menu erstellt (Fallback)');
          } else {
            TnetLog.error(LOG, '[Desktop] Weder #kantons_container noch #tp_overview_menu gefunden');
          }
        }
      } else {
        // Mobile: in m-layers-sheet .m-sheet-body (vor kantons_container)
        var sheetBody = document.querySelector('#m-layers-sheet .m-sheet-body');
        if (sheetBody) {
          var kantonsEl = document.getElementById('kantons_container');
          if (kantonsEl) {
            sheetBody.insertBefore(treeContainer, kantonsEl);
          } else {
            sheetBody.appendChild(treeContainer);
          }
          TnetLog.log(LOG, '[Mobile] #lm-tree-container erstellt');
        }
      }
    }

    // --- Active-Panel-Container (Dargestellte Themen) ---
    if (_useNewActivePanel && !document.getElementById('lm-active-container')) {
      if (_isDesktop) {
        // Desktop: In #sort_menu einfügen (innerhalb "Dargestellte Themen" TitlePane)
        var sortMenu = document.getElementById('sort_menu');
        if (sortMenu) {
          var activeContainer = document.createElement('div');
          activeContainer.id = 'lm-active-container';
          activeContainer.className = platformClass;
          sortMenu.appendChild(activeContainer);
          TnetLog.log(LOG, '[Desktop] #lm-active-container in #sort_menu erstellt');
        } else {
          TnetLog.error(LOG, '[Desktop] #sort_menu nicht gefunden');
        }
      } else {
        // Mobile: Container ist bereits im HTML (#m-active-sheet)
        var mobileActive = document.getElementById('lm-active-container');
        if (mobileActive) {
          TnetLog.log(LOG, '[Mobile] #lm-active-container gefunden');
        } else {
          TnetLog.error(LOG, '[Mobile] #lm-active-container nicht im HTML');
        }
      }
    }
  }

  // ===== BOOTSTRAP =====

  function bootstrap(config) {
    var lmConfig = (config && config.layerManager) || {};

    // --- Gruppen-Parameter aus URL übernehmen (z.B. ?group=owpro) ---
    if (!lmConfig.group) {
      var urlGroup = new URLSearchParams(window.location.search).get('group');
      if (urlGroup) {
        lmConfig.group = urlGroup;
        TnetLog.log(LOG, 'Gruppe aus URL übernommen: ' + urlGroup);
      }
    }

    // --- Feature-Flags auswerten ---
    // Rückwärtskompatibilität: altes "useNew" wird als "useNewActivePanel" interpretiert
    _useNewActivePanel = lmConfig.useNewActivePanel !== undefined
      ? !!lmConfig.useNewActivePanel
      : !!lmConfig.useNew;  // Fallback auf altes Flag

    _useNewTree = !!lmConfig.useNewTree;
    _useNewWmsPanel = !!lmConfig.useNewWmsPanel;

    TnetLog.log(LOG, 'Feature-Flags: useNewActivePanel=' + _useNewActivePanel +
      ', useNewTree=' + _useNewTree +
      ', useNewWmsPanel=' + _useNewWmsPanel +
      ', Plattform=' + (_isDesktop ? 'Desktop' : 'Mobile'));

    // Wenn nichts aktiv → Legacy-Modus, nichts tun
    if (!_useNewActivePanel && !_useNewTree && !_useNewWmsPanel) {
      TnetLog.log(LOG, 'Alle Feature-Flags deaktiviert → Legacy-Modus');
      return;
    }

    // DOM vorbereiten
    hideLegacyContainers();
    createNewContainers();

    // Store initialisieren (wird von beiden Panels benötigt)
    if (window.TnetLMStore) {
      window.TnetLMStore.init(lmConfig);
    } else {
      TnetLog.error(LOG, 'TnetLMStore fehlt');
      activateLegacyFallback('TnetLMStore fehlt');
      return;
    }

    // Tree-UI initialisieren (Desktop + Mobile wenn useNewTree aktiv)
    if (_useNewTree) {
      if (window.TnetLMTree) {
        window.TnetLMTree.init('lm-tree-container');
        TnetLog.log(LOG, 'TnetLMTree initialisiert' + (_isDesktop ? ' (Desktop)' : ' (Mobile)'));
      } else {
        TnetLog.warn(LOG, 'useNewTree=true, aber TnetLMTree Modul nicht geladen');
        if (!_isDesktop) {
          // Mobile: ohne Tree ist der Themenkatalog leer → Fallback
          TnetLog.error(LOG, 'TnetLMTree fehlt auf Mobile → Fallback');
        }
      }
    }

    // Active-Panel initialisieren (Desktop + Mobile wenn useNewActivePanel aktiv)
    if (_useNewActivePanel) {
      if (window.TnetLMActive) {
        window.TnetLMActive.init('lm-active-container');
        TnetLog.log(LOG, 'TnetLMActive initialisiert' + (_isDesktop ? ' (Desktop)' : ' (Mobile)'));
      } else {
        TnetLog.error(LOG, 'TnetLMActive fehlt');
      }
    }

    // Fallback: Wenn Store/Katalog nicht laden → Legacy wiederherstellen
    var store = window.TnetLMStore;
    if (store && typeof store.on === 'function') {
      store.on('catalog-loaded', function (catalog) {
        if (_lmFallbackTimer) {
          clearTimeout(_lmFallbackTimer);
          _lmFallbackTimer = null;
        }
        if (!catalog || !catalog.length) {
          activateLegacyFallback('Katalog leer');
          return;
        }
        // Coalesce-Bridge: Layer aus URL-Parameter wiederherstellen
        if (window.TnetCoalesceBridge && window.TnetCoalesceBridge.isEnabled()) {
          window.TnetCoalesceBridge.restoreFromUrl(store);
        }
      });
    }

    // Timeout-Fallback: Module müssen innerhalb von FALLBACK_TIMEOUT laden
    _lmFallbackTimer = setTimeout(function () {
      var isLoaded = !!(store && typeof store.isLoaded === 'function' && store.isLoaded());

      // Tree-Container prüfen (wenn aktiv)
      var treeOk = !_useNewTree;
      if (_useNewTree) {
        var treeEl = document.getElementById('lm-tree-container');
        treeOk = !!(treeEl && treeEl.children && treeEl.children.length > 0);
      }

      // Active-Container prüfen (wenn aktiv)
      var activeOk = !_useNewActivePanel;
      if (_useNewActivePanel) {
        var activeEl = document.getElementById('lm-active-container');
        activeOk = !!(activeEl && activeEl.children && activeEl.children.length > 0);
      }

      if (!isLoaded || !treeOk) {
        activateLegacyFallback('Timeout (' + FALLBACK_TIMEOUT + 'ms) — Store geladen=' +
          isLoaded + ', Tree ok=' + treeOk + ', Active ok=' + activeOk);
      } else {
        TnetLog.log(LOG, 'Fallback-Timer: Alles ok (Store=' + isLoaded +
          ', Tree=' + treeOk + ', Active=' + activeOk + ')');
      }
    }, FALLBACK_TIMEOUT);
  }

  // ===== EINSTIEGSPUNKT =====

  function start() {
    loadConfig().then(function (config) {
      if (!config) {
        TnetLog.warn(LOG, 'Config nicht geladen → Fallback-Verhalten');
        return;
      }

      // Auf tnet-app-ready warten (Map muss bereit sein)
      if (window.njs && window.njs.AppManager && window.njs.AppManager.Maps && window.njs.AppManager.Maps['main']) {
        // App schon bereit
        TnetLog.log(LOG, 'App bereits bereit → sofort starten');
        bootstrap(config);
      } else {
        var _bootstrapped = false;
        document.addEventListener('tnet-app-ready', function () {
          if (!_bootstrapped) {
            _bootstrapped = true;
            bootstrap(config);
          }
        });
        TnetLog.log(LOG, 'Warte auf tnet-app-ready...');

        // Fallback: Polling falls tnet-app-ready nie gefeuert wird
        // (earlyCheckAppReady kann vor Map-Verfügbarkeit timeouten)
        var _pollCount = 0;
        var _pollMax = 60; // max 60 × 500ms = 30s
        var _pollTimer = setInterval(function () {
          _pollCount++;
          if (_bootstrapped) {
            clearInterval(_pollTimer);
            return;
          }
          if (window.njs && window.njs.AppManager && window.njs.AppManager.Maps && window.njs.AppManager.Maps['main']) {
            clearInterval(_pollTimer);
            if (!_bootstrapped) {
              _bootstrapped = true;
              TnetLog.log(LOG, 'App bereit (Polling-Fallback nach ' + (_pollCount * 500) + 'ms) → starte');
              bootstrap(config);
            }
          } else if (_pollCount >= _pollMax) {
            clearInterval(_pollTimer);
            TnetLog.warn(LOG, 'App nach 30s immer noch nicht bereit → Abbruch');
          }
        }, 500);
      }
    });
  }

  // DOM-ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  // ===== EXPORT =====
  window.TnetLMInit = {
    /** Manueller Re-Init (z.B. nach Config-Änderung in der Konsole) */
    reinit: function () {
      loadConfig().then(function (config) {
        if (config) bootstrap(config);
      });
    },
    /** Feature-Flags abfragen (für Debug/Testing) */
    getFlags: function () {
      return {
        useNewActivePanel: _useNewActivePanel,
        useNewTree: _useNewTree,
        useNewWmsPanel: _useNewWmsPanel,
        isDesktop: _isDesktop
      };
    }
  };
})();
