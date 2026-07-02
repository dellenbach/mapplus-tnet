/**
 * tnet-loader.js
 * Zentraler Bootstrap-Loader fuer TNET WebGIS Module.
 *
 * Stellt alle gemeinsamen Abhaengigkeiten bereit und laedt Module dynamisch.
 * Integration in beliebiger Umgebung: eine Zeile im HTML.
 *
 * Verwendung:
 *   <script src="tnet/js/tnet-loader.js" data-modules="basemap"></script>
 *   <script src="tnet/js/tnet-loader.js" data-modules="basemap,log,app"></script>
 *
 * Stellt bereit:
 *   - window.__TNET_APP_ROOT (automatisch aus Script-URL)
 *   - window.TnetLog (Stub, bis tnet-log.js ueberschreibt)
 *   - JSON5 (CDN -> lokal)
 *   - CSS-Auto-Inject pro Modul
 *   - window.TnetLoader.ready (Promise)
 *
 * @version    1.0
 * @date       2026-07-02
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */
(function() {
    'use strict';

    // =========================================================
    // 1. APP-ROOT — aus eigener Script-URL ableiten
    // =========================================================

    var loaderScript = document.currentScript
        || document.querySelector('script[src*="tnet-loader"]');
    // .src (Property) gibt die VOLL aufgeloeste URL zurueck,
    // .getAttribute('src') nur den rohen Attribut-Wert (ggf. relativ).
    var loaderSrc = loaderScript ? (loaderScript.src || loaderScript.getAttribute('src')) : '';
    var appRoot = '/maps';

    if (loaderSrc) {
        // Pfad aus voller URL extrahieren (https://host/edit/tnet/js/... → /edit)
        try {
            var _url = new URL(loaderSrc, window.location.href);
            var _path = _url.pathname; // z.B. /edit/tnet/js/tnet-loader.js
            var _match = _path.match(/^(.+?)\/tnet\/js\/tnet-loader/);
            if (_match) appRoot = _match[1];
        } catch (eUrl) {
            var match = loaderSrc.match(/^(.+?)\/tnet\/js\/tnet-loader/);
            if (match) appRoot = match[1];
        }
    }
    if (!window.__TNET_APP_ROOT) window.__TNET_APP_ROOT = appRoot;
    appRoot = window.__TNET_APP_ROOT;

    // =========================================================
    // 2. TNET-LOG STUB — minimaler Logger bis tnet-log.js laedt
    // =========================================================

    if (typeof window.TnetLog === 'undefined') {
        window.TnetLog = {
            log:   function() { console.log.apply(console, arguments); },
            warn:  function() { console.warn.apply(console, arguments); },
            error: function() { console.error.apply(console, arguments); },
            info:  function() { console.info.apply(console, arguments); }
        };
    }

    // =========================================================
    // 3. CSS-MAPPING — welches Modul braucht welche CSS-Dateien
    // =========================================================

    var CSS_MAP = {
        'basemap': ['tnet-basemap-selector.css'],
        'app':     [],
        'log':     [],
        'search':  ['tnet-search.css'],
        'info':    ['tnet-info-panel.css'],
        'print':   ['tnet-print.css'],
        'lm':     ['tnet-lm.css', 'tnet-lm-legacy.css'],
    };

    function injectCss(filename) {
        if (document.querySelector('link[href*="' + filename + '"]')) return;
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = appRoot + '/tnet/css/' + filename;
        document.head.appendChild(link);
    }

    // =========================================================
    // 4. SCRIPT-LOADER — Promise-basiert
    // =========================================================

    function loadScript(url) {
        return new Promise(function(resolve, reject) {
            var s = document.createElement('script');
            s.src = url;
            s.onload = function() { resolve(url); };
            s.onerror = function() { reject(new Error('Failed: ' + url)); };
            document.head.appendChild(s);
        });
    }

    /**
     * Laedt ein UMD-Script ohne AMD-Kollision.
     * Neutralisiert temporaer define/define.amd damit das Script als
     * globale Variable registriert wird (statt in Dojos AMD-Loader).
     */
    function loadScriptNoAmd(url) {
        return new Promise(function(resolve, reject) {
            var origDefine = window.define;
            window.define = undefined;
            var s = document.createElement('script');
            s.src = url;
            s.onload = function() {
                window.define = origDefine;
                resolve(url);
            };
            s.onerror = function() {
                window.define = origDefine;
                reject(new Error('Failed: ' + url));
            };
            document.head.appendChild(s);
        });
    }

    function loadWithFallback(primaryUrl, fallbackUrl) {
        return loadScriptNoAmd(primaryUrl).catch(function() {
            if (fallbackUrl) return loadScriptNoAmd(fallbackUrl);
            return Promise.reject(new Error('Beide URLs fehlgeschlagen'));
        });
    }

    // =========================================================
    // 5. DEPENDENCY LOADING — JSON5
    // =========================================================

    function ensureDeps() {
        var tasks = [];

        // JSON5
        if (typeof JSON5 === 'undefined') {
            tasks.push(
                loadWithFallback(
                    'https://cdn.jsdelivr.net/npm/json5@2/dist/index.min.js',
                    appRoot + '/tnet/js/json5.min.js'
                ).catch(function() {
                    TnetLog.warn('[Loader]', 'JSON5 nicht verfuegbar — Config-Features eingeschraenkt');
                })
            );
        }

        return Promise.all(tasks);
    }

    // =========================================================
    // 6. MODULE LOADING
    // =========================================================

    // Modul-Name → JS-Dateiname Mapping
    var MODULE_MAP = {
        'log':        'tnet-log.js',
        'app':        'tnet-app.js',
        'basemap':    'tnet-basemap.js',
        'search':     'tnet-search.js',
        'info':       'tnet-info-panel.js',
        'print':      'tnet-print.js',
        'header':     'tnet-header.js',
        'icons':      'tnet-icons.js',
        'mapcontrols':'tnet-mapcontrols.js',
        'footer':     'tnet-map-footer.js',
        'lm':         'tnet-lm-init.js',
    };

    function loadModules(moduleNames) {
        // CSS fuer alle Module injizieren (sync, non-blocking)
        moduleNames.forEach(function(name) {
            var cssFiles = CSS_MAP[name] || [];
            cssFiles.forEach(injectCss);
        });

        // Module sequenziell laden (Reihenfolge kann relevant sein)
        var chain = Promise.resolve();
        moduleNames.forEach(function(name) {
            chain = chain.then(function() {
                var file = MODULE_MAP[name];
                if (!file) {
                    TnetLog.warn('[Loader]', 'Unbekanntes Modul:', name);
                    return Promise.resolve();
                }
                return loadScript(appRoot + '/tnet/js/' + file);
            });
        });
        return chain;
    }

    // =========================================================
    // 7. INIT — data-modules auslesen und starten
    // =========================================================

    var requestedModules = [];
    if (loaderScript && loaderScript.getAttribute('data-modules')) {
        requestedModules = loaderScript.getAttribute('data-modules')
            .split(',')
            .map(function(s) { return s.trim(); })
            .filter(function(s) { return s.length > 0; });
    }

    var readyPromise = ensureDeps()
        .then(function() {
            if (requestedModules.length > 0) {
                return loadModules(requestedModules);
            }
        })
        .then(function() {
            TnetLog.log('[Loader]', 'Alle Module geladen ✓', requestedModules);
            document.dispatchEvent(new CustomEvent('tnet-modules-ready', {
                detail: { modules: requestedModules }
            }));
        })
        .catch(function(err) {
            TnetLog.error('[Loader]', 'Fehler beim Laden:', err);
        });

    // =========================================================
    // 8. PUBLIC API
    // =========================================================

    window.TnetLoader = {
        appRoot: appRoot,
        ready: readyPromise,
        loadModule: function(name) {
            var cssFiles = CSS_MAP[name] || [];
            cssFiles.forEach(injectCss);
            var file = MODULE_MAP[name];
            if (!file) return Promise.reject(new Error('Unbekanntes Modul: ' + name));
            return loadScript(appRoot + '/tnet/js/' + file);
        },
        injectCss: injectCss,
    };

})();
