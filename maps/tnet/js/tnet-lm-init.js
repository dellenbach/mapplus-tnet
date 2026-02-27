/**
 * tnet-lm-init.js — Initialisierer für den neuen Layer-Manager (Mobile)
 *
 * Prüft das Feature-Flag in tnet-global-config.json5 → layerManager.useNew.
 * Falls aktiv:
 *   1. Dojo-TOC-Container ausblenden
 *   2. Neue Container erzeugen
 *   3. TnetLMStore → TnetLMTree → TnetLMActive initialisieren
 *
 * Muss NACH den drei Modulen geladen werden.
 *
 * @version 1.0
 * @copyright Trigonet AG
 */
(function () {
  'use strict';

  var LOG = '[LM-Init]';
  var _lmFallbackTimer = null;

  // ── Config laden ──

  function loadConfig() {
    if (typeof JSON5 === 'undefined') {
      console.warn(LOG, 'JSON5 nicht verfügbar');
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

  // ── DOM-Manipulation ──

  /**
   * Dojo-TOC ausblenden:
   * - #kantons_container im Themenkatalog Bottom-Sheet
   * - #njs_main_lyrsorter_wrapper im Dargestellte-Themen (legacy im Drawer)
   * - #sort_menu_sheet im Active-Sheet (legacy Wrapper)
   */
  function hideLegacyContainers() {
    var ids = ['kantons_container', 'njs_main_lyrsorter_wrapper', 'sort_menu_sheet'];
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.style.display = 'none';
        console.log(LOG, '#' + id + ' ausgeblendet');
      }
    });
  }

  function showLegacyContainers() {
    var ids = ['kantons_container', 'njs_main_lyrsorter_wrapper', 'sort_menu_sheet'];
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.style.display = '';
        console.log(LOG, '#' + id + ' wieder eingeblendet');
      }
    });
  }

  function activateLegacyFallback(reason) {
    console.warn(LOG, 'Fallback auf Legacy-Themenbaum:', reason || 'unbekannt');
    if (_lmFallbackTimer) {
      clearTimeout(_lmFallbackTimer);
      _lmFallbackTimer = null;
    }
    var treeContainer = document.getElementById('lm-tree-container');
    if (treeContainer && treeContainer.parentNode) {
      treeContainer.parentNode.removeChild(treeContainer);
    }
    showLegacyContainers();
  }

  /**
   * Neue Container für den Layer-Manager einfügen.
   * - Themenkatalog-Tree: dynamisch in #m-layers-sheet .m-sheet-body
   * - Active-Panel: bereits im HTML (#lm-active-container in #m-active-sheet)
   */
  function createNewContainers() {
    // 1) Themenkatalog-Tree — in m-layers-sheet .m-sheet-body
    var sheetBody = document.querySelector('#m-layers-sheet .m-sheet-body');
    if (sheetBody) {
      var existing = document.getElementById('lm-tree-container');
      if (!existing) {
        var treeContainer = document.createElement('div');
        treeContainer.id = 'lm-tree-container';
        treeContainer.className = 'lm-container';
        // Vor kantons_container einfügen (oder am Anfang)
        var kantonsEl = document.getElementById('kantons_container');
        if (kantonsEl) {
          sheetBody.insertBefore(treeContainer, kantonsEl);
        } else {
          sheetBody.appendChild(treeContainer);
        }
        console.log(LOG, '#lm-tree-container erstellt');
      } else {
        console.log(LOG, '#lm-tree-container bereits vorhanden');
      }
    }

    // 2) Active-Panel — lm-active-container ist bereits im HTML (#m-active-sheet)
    var activeContainer = document.getElementById('lm-active-container');
    if (activeContainer) {
      console.log(LOG, '#lm-active-container gefunden im Active-Sheet');
    } else {
      console.error(LOG, '#lm-active-container nicht gefunden');
    }
  }

  // ── Bootstrap ──

  function bootstrap(config) {
    var lmConfig = (config && config.layerManager) || {};

    if (!lmConfig.useNew) {
      if (lmConfig.debug || (config && config.debug)) {
        console.log(LOG, 'Feature-Flag layerManager.useNew ist deaktiviert → kein Start');
      }
      return;
    }

    console.log(LOG, 'Feature-Flag aktiv → starte neuen Layer-Manager');

    // DOM vorbereiten
    hideLegacyContainers();
    createNewContainers();

    // Store initialisieren
    if (window.TnetLMStore) {
      window.TnetLMStore.init(lmConfig);
    } else {
      console.error(LOG, 'TnetLMStore fehlt');
      activateLegacyFallback('TnetLMStore fehlt');
      return;
    }

    // Tree-UI initialisieren
    if (window.TnetLMTree) {
      window.TnetLMTree.init('lm-tree-container');
    } else {
      console.error(LOG, 'TnetLMTree fehlt');
    }

    // Active-Panel initialisieren
    if (window.TnetLMActive) {
      window.TnetLMActive.init('lm-active-container');
    } else {
      console.error(LOG, 'TnetLMActive fehlt');
    }

    // Wenn der neue LM nicht lädt, auf Legacy zurückfallen statt leeres Sheet
    var store = window.TnetLMStore;
    if (store && typeof store.on === 'function') {
      store.on('catalog-loaded', function (catalog) {
        if (_lmFallbackTimer) {
          clearTimeout(_lmFallbackTimer);
          _lmFallbackTimer = null;
        }
        if (!catalog || !catalog.length) {
          activateLegacyFallback('Katalog leer');
        }
      });
    }

    _lmFallbackTimer = setTimeout(function () {
      var treeContainer = document.getElementById('lm-tree-container');
      var hasTreeContent = !!(treeContainer && treeContainer.children && treeContainer.children.length);
      var isLoaded = !!(store && typeof store.isLoaded === 'function' && store.isLoaded());
      if (!isLoaded || !hasTreeContent) {
        activateLegacyFallback('Timeout beim Laden des neuen Layer-Managers');
      }
    }, 6000);
  }

  // ── Einstiegspunkt ──

  function start() {
    loadConfig().then(function (config) {
      if (!config) {
        console.warn(LOG, 'Config nicht geladen → Fallback-Verhalten');
        return;
      }

      // Auf tnet-app-ready warten (Map muss bereit sein)
      if (window.njs && window.njs.AppManager && window.njs.AppManager.Maps && window.njs.AppManager.Maps['main']) {
        // App schon bereit
        console.log(LOG, 'App bereits bereit → sofort starten');
        bootstrap(config);
      } else {
        var _bootstrapped = false;
        document.addEventListener('tnet-app-ready', function () {
          if (!_bootstrapped) {
            _bootstrapped = true;
            bootstrap(config);
          }
        });
        console.log(LOG, 'Warte auf tnet-app-ready...');

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
              console.log(LOG, 'App bereit (Polling-Fallback nach ' + (_pollCount * 500) + 'ms) → starte');
              bootstrap(config);
            }
          } else if (_pollCount >= _pollMax) {
            clearInterval(_pollTimer);
            console.warn(LOG, 'App nach 30s immer noch nicht bereit → Abbruch');
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
})();
