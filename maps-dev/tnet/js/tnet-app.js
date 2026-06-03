/**
 * tnet-app.js — App-Initialisierung und UI-Helfer
 *
 * Enthält:
 *  - Panel-Schatten (dynamisch positioniert)
 *  - Scroll-to-Top Button
 *  - Bookmark Auto-Start aus URL
 *
 * Grundkarten-Layer-Sync und Basemap-Widget → verschoben nach tnet-basemap.js
 *
 * @version    2.0
 * @date       2026-02-19
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

var __tnetInitialUrlLayers = null;
var __tnetInitialUrlOp = null;
var __tnetInitialUrlQuery = '';
var __tnetBookmarkAutoStartStarted = false;
var __tnetInitialUrlLayerCount = 0;
var __tnetInitialUrlGuardUntil = Date.now() + 18000;
try {
    __tnetInitialUrlQuery = window.location.search || '';
    var __tnetInitialUrlParams = new URLSearchParams(window.location.search);
    __tnetInitialUrlLayers = __tnetInitialUrlParams.get('layers');
    __tnetInitialUrlOp = __tnetInitialUrlParams.get('op');
    __tnetInitialUrlLayerCount = __tnetInitialUrlLayers ? __tnetInitialUrlLayers.split('|').filter(function(id) { return !!id; }).length : 0;
} catch (eInitialUrl) { /* URLSearchParams notfalls weggelassen */ }

if (__tnetInitialUrlOp && !window.__tnetInitialOpHistoryGuardInstalled) {
    (function installInitialOpHistoryGuard() {
        var hist = window.history;
        if (!hist || typeof hist.replaceState !== 'function') return;
        var origReplace = hist.replaceState;
        var origPush = hist.pushState;
        window.__tnetInitialOpHistoryGuardInstalled = true;
        window.__tnetInitialOpHistoryGuardEnabled = true;

        function normalizeUrl(url) {
            if (url == null) return url;
            try {
                var absolute = new URL(String(url), window.location.href);
                var params = absolute.searchParams;
                var layersValue = params.get('layers') || '';
                var layerCount = layersValue ? layersValue.split('|').filter(function(id) { return !!id; }).length : 0;
                var opCount = __tnetInitialUrlOp.split('|').filter(function(id) { return id !== ''; }).length;

                if (window.__tnetInitialOpHistoryGuardEnabled && Date.now() < __tnetInitialUrlGuardUntil) {
                    if (__tnetInitialUrlLayers && __tnetInitialUrlLayerCount) {
                        params.set('layers', __tnetInitialUrlLayers);
                    }
                    if (__tnetInitialUrlOp && opCount === __tnetInitialUrlLayerCount) {
                        params.set('op', __tnetInitialUrlOp);
                    }
                }

                return absolute.pathname + (params.toString() ? ('?' + params.toString()) : '') + absolute.hash;
            } catch (eUrlGuard) {
                return url;
            }
        }

        hist.replaceState = function(state, title, url) {
            var normalized = normalizeUrl(url);
            if (normalized === window.location.pathname + window.location.search + window.location.hash) return;
            return origReplace.call(this, state, title, normalized);
        };
        if (typeof origPush === 'function') {
            hist.pushState = function(state, title, url) {
                var normalized = normalizeUrl(url);
                if (normalized === window.location.pathname + window.location.search + window.location.hash) return;
                return origPush.call(this, state, title, normalized);
            };
        }
    })();
}

if (__tnetInitialUrlOp && !window.__tnetInitialOpStabilizerInstalled) {
    (function installInitialOpStabilizer() {
        var hist = window.history;
        if (!hist || typeof hist.replaceState !== 'function') return;
        window.__tnetInitialOpStabilizerInstalled = true;
        var stopAt = Date.now() + 20000;

        function tick() {
            try {
                var current = new URL(window.location.href);
                var layersValue = current.searchParams.get('layers') || '';
                var layerCount = layersValue ? layersValue.split('|').filter(function(id) { return !!id; }).length : 0;
                var currentOp = current.searchParams.get('op') || '';
                if (Date.now() >= stopAt || Date.now() >= __tnetInitialUrlGuardUntil || !window.__tnetInitialOpHistoryGuardEnabled) {
                    return;
                }
                if (__tnetInitialUrlLayers && current.searchParams.get('layers') !== __tnetInitialUrlLayers) {
                    current.searchParams.set('layers', __tnetInitialUrlLayers);
                }
                if (__tnetInitialUrlOp && currentOp !== __tnetInitialUrlOp) {
                    current.searchParams.set('op', __tnetInitialUrlOp);
                    hist.replaceState(null, '', current.pathname + '?' + current.searchParams.toString() + current.hash);
                    return;
                }
                if (__tnetInitialUrlLayers && current.searchParams.get('layers') !== __tnetInitialUrlLayers) {
                    hist.replaceState(null, '', current.pathname + '?' + current.searchParams.toString() + current.hash);
                }
            } catch (eStabilize) {
                return;
            }

            if (typeof window.requestAnimationFrame === 'function') {
                window.requestAnimationFrame(tick);
            } else {
                setTimeout(tick, 16);
            }
        }

        tick();
    })();
}

// ===== PANEL-SCHATTEN =====
function initPanelShadow() {
    var freepane = document.getElementById('freepane');
    var closeSwitch = document.querySelector('.close_switch');
    if (!freepane || !closeSwitch) {
        setTimeout(initPanelShadow, 200);
        return;
    }

    // Schatten-Element erstellen
    var shadow = document.createElement('div');
    shadow.id = 'panelShadow';
    freepane.parentNode.insertBefore(shadow, freepane.nextSibling);

    function updateShadow() {
        var headerTop = 69;
        var spring = document.getElementById('spring');
        var bottom;

        if (spring) {
            // Höhe basierend auf dem tatsächlichen Inhalt von #spring berechnen
            // (nicht closeSwitch, das bei flex-stretch am Viewport-Ende landen kann)
            var titlePanes = spring.querySelectorAll(':scope > .dijitTitlePane');
            if (titlePanes.length > 0) {
                var lastPane = titlePanes[titlePanes.length - 1];
                var lastRect = lastPane.getBoundingClientRect();
                bottom = lastRect.bottom + 10; // +10px für close_switch
            } else {
                bottom = closeSwitch.getBoundingClientRect().bottom;
            }
        } else {
            bottom = closeSwitch.getBoundingClientRect().bottom;
        }

        // Sicherheit: Schatten nie höher als der sichtbare Inhalt
        var maxBottom = headerTop + (spring ? spring.scrollHeight : 400) + 10;
        if (bottom > maxBottom) bottom = maxBottom;

        var width = closeSwitch.offsetWidth || 340;

        shadow.style.top = headerTop + 'px';
        shadow.style.height = (bottom - headerTop) + 'px';
        shadow.style.width = width + 'px';

        // Bei geschlossenem Panel: Breite der minimierten Leiste
        if (freepane.classList.contains('close')) {
            shadow.style.width = '170px';
            shadow.style.left = ((340 - 170) / 2) + 'px';
            shadow.style.borderRadius = '0 0 4px 4px';
        } else {
            shadow.style.left = '0px';
            shadow.style.borderRadius = '0 0 4px 4px';
        }
    }

    // Schatten nur bei Bedarf aktualisieren (statt 60x/Sek rAF-Endlosschleife)
    // ResizeObserver + MutationObserver für Panel open/close
    updateShadow(); // Initial

    var spring = document.getElementById('spring');

    if (typeof ResizeObserver !== 'undefined') {
        var ro = new ResizeObserver(updateShadow);
        ro.observe(freepane);
        ro.observe(closeSwitch);
        // spring beobachten — Höhe ändert sich wenn Dojo TitlePanes parsed oder Accordion öffnet
        if (spring) ro.observe(spring);
    }

    // Panel open/close (class toggle) erkennen
    var mo = new MutationObserver(updateShadow);
    mo.observe(freepane, { attributes: true, attributeFilter: ['class'] });

    // spring-Inhalt beobachten (Dojo Parser fügt dijitTitlePane-Klassen hinzu)
    if (spring) {
        new MutationObserver(updateShadow)
            .observe(spring, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    }

    // Nach App-Ready nochmal aktualisieren (Dojo-Parser fertig)
    document.addEventListener('tnet-app-ready', function() {
        setTimeout(updateShadow, 100);
        setTimeout(updateShadow, 500);
    });

    window.addEventListener('resize', updateShadow);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPanelShadow);
} else {
    initPanelShadow();
}

// ===== SCROLL-TO-TOP =====
function scrollSpringToTop() {
    var spring = document.getElementById('spring');
    if (spring) {
        spring.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

// Button ein-/ausblenden basierend auf Scroll-Position
function initScrollToTop() {
    var spring = document.getElementById('spring');
    var btn = document.getElementById('scrollToTopBtn');
    if (!spring || !btn) {
        setTimeout(initScrollToTop, 500);
        return;
    }

    spring.addEventListener('scroll', function() {
        if (spring.scrollTop > 100) {
            btn.classList.add('visible');
        } else {
            btn.classList.remove('visible');
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initScrollToTop);
} else {
    initScrollToTop();
}

// ===== BOOKMARK AUTO-START =====

var __tnetBookmarkNameCache = window.__tnetBookmarkNameCache || {};
var __tnetBookmarkNameListPromise = null;
window.__tnetBookmarkNameCache = __tnetBookmarkNameCache;

function getCachedBookmarkDisplayName(bookmarkId) {
    var cached = __tnetBookmarkNameCache && __tnetBookmarkNameCache[bookmarkId];
    return (typeof cached === 'string' && cached) ? cached : null;
}

function rememberBookmarkDisplayNames(entries) {
    if (!Array.isArray(entries)) return;
    entries.forEach(function(entry) {
        if (!entry || typeof entry !== 'object') return;
        var id = entry.id || entry['map-bookmark'] || null;
        var name = entry.name || entry.title || entry.label || null;
        if (!id || !name) return;
        __tnetBookmarkNameCache[id] = name;
    });
}

function resolveBookmarkDisplayName(bookmarkId) {
    var cached = getCachedBookmarkDisplayName(bookmarkId);
    if (cached) return Promise.resolve(cached);
    if (!(window.TnetApi && typeof window.TnetApi.listBookmarks === 'function')) {
        return Promise.resolve(null);
    }
    if (!__tnetBookmarkNameListPromise) {
        __tnetBookmarkNameListPromise = window.TnetApi.listBookmarks()
            .then(function(entries) {
                rememberBookmarkDisplayNames(entries);
                return entries;
            })
            .catch(function() {
                return [];
            });
    }
    return __tnetBookmarkNameListPromise.then(function() {
        return getCachedBookmarkDisplayName(bookmarkId);
    });
}

function announcePendingBookmarkLoad(bookmarkId, viewId, bookmarkName) {
    try {
        window.__tnetPendingBookmarkLoad = {
            id: bookmarkId,
            name: bookmarkName || null,
            viewId: viewId || null,
            source: 'url-autostart',
            startedAt: Date.now()
        };
        document.dispatchEvent(new CustomEvent('tnet-bookmark-loading', {
            detail: {
                reason: 'url-autostart',
                pending: window.__tnetPendingBookmarkLoad,
                bookmark: window.__tnetActiveBookmark || null
            }
        }));
    } catch (ePending) { /* ignore */ }
}

function getBookmarkRequestFromUrl() {
    var currentPath = window.location.pathname;

    // Erlaubt sowohl PROD (/maps/{id}) als auch DEV (/maps-dev/{id}).
    // Pattern fuer ID entspricht der .htaccess-Rewrite-Regel: [a-zA-Z0-9_-]+
    var match = currentPath.match(/\/maps(?:-dev)?\/([a-zA-Z0-9_-]+)$/);
    if (!match || !match[1]) return null;

    var viewId = null;
    var initialQuery = __tnetInitialUrlQuery || window.__tnetOriginalUrlQuery || '';
    var initialLayers = __tnetInitialUrlLayers || window.__tnetOriginalUrlLayers || null;
    var initialOp = __tnetInitialUrlOp || window.__tnetOriginalUrlOp || null;
    try {
        var urlParams = new URLSearchParams(window.location.search);
        var rawView = urlParams.get('view');
        if (rawView && /^[a-zA-Z0-9_-]+$/.test(rawView)) viewId = rawView;
        if (!initialLayers) initialLayers = urlParams.get('layers');
        if (!initialOp) initialOp = urlParams.get('op');
    } catch (eUrl) { /* URLSearchParams notfalls weggelassen */ }

    return {
        bookmarkId: match[1],
        viewId: viewId,
        initialQuery: initialQuery,
        initialLayers: initialLayers,
        initialOp: initialOp
    };
}

function primePendingBookmarkFromUrl() {
    var request = getBookmarkRequestFromUrl();
    if (!request) return null;

    announcePendingBookmarkLoad(
        request.bookmarkId,
        request.viewId,
        getCachedBookmarkDisplayName(request.bookmarkId)
    );
    resolveBookmarkDisplayName(request.bookmarkId).then(function(bookmarkName) {
        var pending = window.__tnetPendingBookmarkLoad;
        if (!bookmarkName || !pending || pending.id !== request.bookmarkId || window.__tnetActiveBookmark) return;
        announcePendingBookmarkLoad(request.bookmarkId, request.viewId, bookmarkName);
    });
    return request;
}

function startBookmarkFromUrl() {
    var request = getBookmarkRequestFromUrl();

    if (request && request.bookmarkId) {
        if (__tnetBookmarkAutoStartStarted) return;
        __tnetBookmarkAutoStartStarted = true;
        var bookmarkId = request.bookmarkId;
        var viewId = request.viewId;
        var initialQuery = request.initialQuery;
        var initialLayers = request.initialLayers;
        var initialOp = request.initialOp;

        primePendingBookmarkFromUrl();

        function tryStart() {
            if (typeof window.TnetSetBookmark === 'function' &&
                window.njs && window.njs.AppManager &&
                typeof window.njs.AppManager.setMapBookmark === 'function') {
                var hasUrlOverride = !!(initialQuery && /[?&](lang|basemap|blop|x|y|zl|hl|theme|subtheme|layers|op|view)=/.test(initialQuery));
                var options = hasUrlOverride ? {
                    visibleLayerIds: initialLayers ? initialLayers.split('|').filter(function(id) { return !!id; }) : null,
                    originalVisibleLayerIds: initialLayers ? initialLayers.split('|').filter(function(id) { return !!id; }) : null,
                    opacityValues: initialOp ? initialOp.split('|') : null,
                    originalOp: initialOp || '',
                    urlQuery: initialQuery,
                    urlOverride: true
                } : null;
                window.TnetSetBookmark(bookmarkId, viewId, options);
            } else {
                setTimeout(tryStart, 200);
            }
        }
        tryStart();
    }
}

primePendingBookmarkFromUrl();

// Event-basiert statt festes setTimeout(4000)
if (window._tnetAppReadyFired) {
    // Event wurde schon gefeuert bevor dieses Script geladen war
    startBookmarkFromUrl();
} else {
    document.addEventListener('tnet-app-ready', function() {
        startBookmarkFromUrl();
    }, { once: true });
}

// Fallback: tnet-app-ready kann bei langsamen Dojo-Ladevorgaengen ausbleiben.
// startBookmarkFromUrl() selbst pollt weiter, bis Helper und LayerManager bereit sind.
setTimeout(startBookmarkFromUrl, 1500);
setTimeout(startBookmarkFromUrl, 3500);
setTimeout(startBookmarkFromUrl, 7000);

