/**
 * tnet-log.js
 * Zentrale Logging-Utility für alle TNET-Module.
 * Respektiert logLevel aus tnet-global-config.json5.
 *
 * Nutzung:
 *   TnetLog.log('[Modul]', 'Nachricht', daten);   // nur bei debug
 *   TnetLog.info('[Modul]', 'Nachricht');           // nur bei info+
 *   TnetLog.warn('[Modul]', 'Nachricht');           // nur bei warn+
 *   TnetLog.error('[Modul]', 'Nachricht');          // nur bei error+
 *   TnetLog.debug('[Modul]', 'Nachricht');          // nur bei debug
 *
 * logLevel-Stufen: 'none' (0) | 'error' (1) | 'warn' (2) | 'info' (3) | 'debug' (4)
 * Default: 'warn' — wird durch Config überschrieben sobald geladen.
 *
 * @version    1.0
 * @date       2026-03-04
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

// ===== ZENTRALE LOG-UTILITY =====
(function () {
  'use strict';

  var LEVELS = { none: 0, error: 1, warn: 2, info: 3, debug: 4 };
  var _level = LEVELS.warn; // Default bis Config geladen
  var _configLoaded = false;

  // Echte Console-Referenzen (werden nie überschrieben)
  var _con = {
    log:   console.log.bind(console),
    info:  console.info.bind(console),
    warn:  console.warn.bind(console),
    error: console.error.bind(console),
    debug: (console.debug || console.log).bind(console)
  };

  /**
   * LogLevel setzen (wird automatisch von Config-Loader aufgerufen)
   * @param {string} level - 'none', 'error', 'warn', 'info', 'debug'
   */
  function setLevel(level) {
    if (typeof level === 'string' && LEVELS.hasOwnProperty(level)) {
      _level = LEVELS[level];
    }
  }

  /**
   * Aktuellen LogLevel-Namen zurückgeben
   */
  function getLevel() {
    for (var name in LEVELS) {
      if (LEVELS[name] === _level) return name;
    }
    return 'unknown';
  }

  // ===== PUBLIC API =====
  var TnetLog = {
    /** Nur bei debug-Level */
    log: function () {
      if (_level >= LEVELS.debug) _con.log.apply(null, arguments);
    },
    /** Nur bei info-Level oder höher */
    info: function () {
      if (_level >= LEVELS.info) _con.info.apply(null, arguments);
    },
    /** Nur bei warn-Level oder höher */
    warn: function () {
      if (_level >= LEVELS.warn) _con.warn.apply(null, arguments);
    },
    /** Immer bei error-Level oder höher */
    error: function () {
      if (_level >= LEVELS.error) _con.error.apply(null, arguments);
    },
    /** Nur bei debug-Level */
    debug: function () {
      if (_level >= LEVELS.debug) _con.debug.apply(null, arguments);
    },
    /** LogLevel setzen */
    setLevel: setLevel,
    /** LogLevel abfragen */
    getLevel: getLevel,
    /** Config geladen? */
    isConfigLoaded: function () { return _configLoaded; }
  };

  // ===== CONFIG LADEN =====
  function loadConfig() {
    var paths = [
      '/maps/tnet/config/tnet-global-config.json5',
      '/maps/tnet/tnet-global-config.json5',
      '../tnet/config/tnet-global-config.json5'
    ];

    for (var i = 0; i < paths.length; i++) {
      try {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', paths[i], false); // synchron — muss vor allen anderen Modulen fertig sein
        xhr.send();
        if (xhr.status === 200) {
          var text = xhr.responseText;
          // JSON5-Parser: Kommentare (string-aware), trailing commas, unquoted keys, single quotes
          var lines = text.split('\n');
          var cleaned = [];
          for (var j = 0; j < lines.length; j++) {
            var line = lines[j];
            var inStr = false, strCh = null, cp = -1;
            for (var k = 0; k < line.length; k++) {
              var c = line[k];
              if ((c === '"' || c === "'") && (k === 0 || line[k - 1] !== '\\')) {
                if (!inStr) { inStr = true; strCh = c; }
                else if (c === strCh) { inStr = false; }
              }
              if (!inStr && k < line.length - 1 && line[k] === '/' && line[k + 1] === '/') { cp = k; break; }
            }
            if (cp > -1) line = line.substring(0, cp);
            if (line.trim()) cleaned.push(line);
          }
          var jsonText = cleaned.join('\n')
            .replace(/,(\s*[}\]])/g, '$1')
            .replace(/((?:^|[{,])\s*)([a-zA-Z_][a-zA-Z0-9_-]*)\s*:/gm, '$1"$2":')
            .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"');
          var config = JSON.parse(jsonText);

          if (config.logLevel) {
            setLevel(config.logLevel);
          }
          window.TnetGlobalLogLevel = config.logLevel || 'warn';

          // Layer-Manager Feature-Flags auf window exponieren,
          // damit tnet_toc.js, tnet-catalog-filter.js und tnet-accordion-resize.js
          // synchron prüfen können ob sie aktiv sein sollen (ohne eigenen Config-Fetch).
          var lm = config.layerManager || {};
          var useLegacyNestedHierarchyStyle = !!(
            lm.useLegacyNestedHierarchyStyle ||
            lm.useExtendedLegacyHierarchy ||
            lm.legacyNestedHierarchyStyle
          );
          window.__tnetLMFlags = {
            useNewActivePanel: !!(lm.useNewActivePanel || lm.useNew),
            useNewTree: !!lm.useNewTree,
            useNewWmsPanel: !!lm.useNewWmsPanel,
            useLegacyNestedHierarchyStyle: useLegacyNestedHierarchyStyle
          };

          window.TnetGlobalConfig = config;

          _configLoaded = true;
          break; // Erfolg — Schleife verlassen
        }
      } catch (e) {
        // Pfad fehlgeschlagen, nächsten versuchen
      }
    }
  }

  // Sofort Config laden (synchron)
  loadConfig();

  // Global verfügbar machen
  window.TnetLog = TnetLog;

})();
