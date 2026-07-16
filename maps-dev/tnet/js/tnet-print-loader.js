/**
 * tnet-print-loader.js
 * Laedt je nach zentralem Printing-Provider das passende Druckmodul.
 *
 * @version    1.0
 * @date       2026-07-06
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */
(function () {
  'use strict';

  function getAppRoot() {
    return window.__TNET_APP_ROOT || '/maps';
  }

  function logWarn() {
    if (window.TnetLog && typeof TnetLog.warn === 'function') TnetLog.warn.apply(TnetLog, arguments);
    else console.warn.apply(console, arguments);
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { resolve(src); };
      s.onerror = function () { reject(new Error('Script konnte nicht geladen werden: ' + src)); };
      document.head.appendChild(s);
    });
  }

  function parseJson5(text) {
    if (window.JSON5 && typeof window.JSON5.parse === 'function') {
      return window.JSON5.parse(text);
    }

    var lines = text.split('\n');
    var cleaned = [];
    for (var j = 0; j < lines.length; j++) {
      var line = lines[j];
      var inStr = false;
      var strCh = null;
      var cp = -1;
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
    return JSON.parse(jsonText);
  }

  function resolveProvider(config) {
    var print = config && config.print ? config.print : {};
    var provider = (typeof print.provider === 'string') ? print.provider.toLowerCase() : '';
    if (provider === 'tnet' || provider === 'mapplus' || provider === 'none') return provider;
    if (typeof print.enableLegacyPrint === 'boolean') return print.enableLegacyPrint ? 'mapplus' : 'tnet';
    return 'tnet';
  }

  function applyInitialVisibility(provider) {
    var legacyMenu = document.getElementById('tp_print_menu');
    var tnetMenu = document.getElementById('tp_tnet_print_menu');

    if (provider === 'mapplus') {
      if (legacyMenu) legacyMenu.style.display = '';
      if (legacyMenu && legacyMenu.tagName === 'DETAILS') legacyMenu.open = false;
      if (tnetMenu) tnetMenu.style.display = 'none';
      return;
    }

    if (provider === 'none') {
      if (legacyMenu) legacyMenu.style.display = 'none';
      if (tnetMenu) tnetMenu.style.display = 'none';
      return;
    }

    if (legacyMenu) legacyMenu.style.display = 'none';
    if (tnetMenu) tnetMenu.style.display = '';
  }

  function init() {
    var appRoot = getAppRoot();
    fetch(appRoot + '/tnet/config/tnet-global-config.json5?v=20260706b')
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function (txt) {
        var config = parseJson5(txt);
        window.TnetGlobalConfig = window.TnetGlobalConfig || config;
        var provider = resolveProvider(config);
        window.__TNET_PRINT_PROVIDER = provider;
        applyInitialVisibility(provider);

        if (provider === 'mapplus') {
          return loadScript(appRoot + '/tnet/js/tnet-print-legacy-bridge.js?v=20260715b');
        }
        if (provider === 'tnet') {
          return loadScript(appRoot + '/tnet/js/tnet-print.js?v=20260706c');
        }
        return null;
      })
      .catch(function (err) {
        logWarn('[Drucken] Print-Provider konnte nicht geladen werden, fallback auf TNET:', err);
        applyInitialVisibility('tnet');
        loadScript(getAppRoot() + '/tnet/js/tnet-print.js?v=20260706c');
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
