/*
 * tnet-search.js  v1.5
 * Desktop-Suchfeld (parallel zur bestehenden njs/SOLR-Suche)
 * Nutzt search-proxy.php -> Layer-Suche (NLS) + swisstopo Geocoder
 * Resultate werden gruppiert angezeigt (Layer / Standorte).
 * v1.0: Kanton-Select + Scope-Select (inline)
 * v1.5: Filter-Popup (Radios + Checkboxen), Lupe links, Tune rechts
 *
 * @version    1.5
 * @date       2026-02-22
 * @copyright  Trigonet AG
 */
(function () {
    'use strict';

    var PROXY_URL    = '/maps/tnet/api/search-proxy.php';
    var debounceTimer = null;
    var currentXhr   = null;
    var lastQuery    = '';

    // -- Map/Layer Helpers ---------------------------------------------------

    function getMapView() {
        try { return njs.AppManager.Maps['main'].mapObj.getView(); } catch (e) { return null; }
    }

    /** Zur Koordinate animieren. x=Northing, y=Easting (LV95) */
    function panToResult(x, y, zoom) {
        var view = getMapView();
        if (!view || x == null || y == null) return;
        var mapProj = view.getProjection().getCode();
        var coord = (typeof ol !== 'undefined' && ol.proj)
            ? ol.proj.transform([y, x], 'EPSG:2056', mapProj)
            : [y, x];
        view.animate({ center: coord, zoom: Math.max(view.getZoom(), zoom || 13), duration: 400 });
    }

    /**
     * Layer einschalten via TnetLayerSwitch (aus tnet-mapplus-helpers.js).
     * Fallback: setMapBookmark direkt.
     */
    function activateLayer(layerId) {
        if (typeof window.TnetLayerSwitch === 'function') {
            window.TnetLayerSwitch(layerId, 'on');
            return;
        }
        try {
            var njsAM = (window.top && window.top.njs) ? window.top.njs.AppManager
                       : (window.njs ? window.njs.AppManager : null);
            if (njsAM && typeof njsAM.setMapBookmark === 'function') {
                njsAM.setMapBookmark(['main'], 'layers=' + layerId);
                return;
            }
        } catch (e) {}
        console.warn('[DesktopSearch] Layer-Aktivierung fehlgeschlagen:', layerId);
    }

    // -- Icons ----------------------------------------------------------------

    var ICON_LAYER =
        '<svg class="dt-search-item-icon" viewBox="0 0 24 24">' +
        '<path d="M11.99 2L2 7l10 5 10-5-10.01-5zM2 17l10 5 10-5-10-5-10 5z' +
        'M2 12l10 5 10-5-10-5-10 5z"/></svg>';

    var ICON_LOCATION =
        '<svg class="dt-search-item-icon" viewBox="0 0 24 24">' +
        '<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13' +
        'c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5' +
        ' 12 6.5s2.5 1.12 2.5 2.5S13.38 11.5 12 11.5z"/></svg>';

    // -- DOM-Render -----------------------------------------------------------

    function showGroupedResults(groups, itemsFallback) {
        var list = document.getElementById('dt-search-results');
        if (!list) return;
        list.innerHTML = '';

        var hasItems = false;

        if (groups && groups.length) {
            groups.forEach(function (group) {
                if (!group.items || !group.items.length) return;

                var header = document.createElement('li');
                header.className = 'dt-search-group-header';
                header.setAttribute('role', 'presentation');
                header.textContent = group.label;
                list.appendChild(header);

                group.items.forEach(function (item) {
                    list.appendChild(makeItem(item));
                    hasItems = true;
                });
            });
        } else if (itemsFallback && itemsFallback.length) {
            itemsFallback.forEach(function (item) {
                list.appendChild(makeItem(item));
                hasItems = true;
            });
        }

        list.classList.toggle('open', hasItems);
    }

    /** Suchbegriff im Label fett hervorheben */
    function highlightText(text, query) {
        if (!query) return text;
        var safe = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return text.replace(new RegExp('(' + safe + ')', 'gi'), '<b class="dt-search-highlight">$1</b>');
    }

    function makeItem(item) {
        var li = document.createElement('li');
        li.className = 'dt-search-item';
        li.setAttribute('role', 'option');
        li.setAttribute('tabindex', '-1');
        var icon = (item.type === 'layer') ? ICON_LAYER : ICON_LOCATION;
        var label = highlightText(item.label || '', lastQuery);
        li.innerHTML = icon + '<span class="dt-search-item-label">' + label + '</span>';

        li.addEventListener('click', function () {
            var inp  = document.getElementById('dt-search-input');
            var lst  = document.getElementById('dt-search-results');
            var clr  = document.getElementById('dt-search-clear');

            if (item.type === 'layer') {
                if (inp)  { inp.value = ''; }
                if (clr)  { clr.style.display = 'none'; }
                if (lst)  { lst.classList.remove('open'); lst.innerHTML = ''; }
                activateLayer(item.layer || item.id);
            } else {
                if (inp) inp.value = item.label;
                if (lst) lst.classList.remove('open');
                panToResult(item.x, item.y);
            }
        });

        return li;
    }

    // -- XHR ------------------------------------------------------------------

    function doSearch(query) {
        lastQuery = query;
        if (currentXhr) { try { currentXhr.abort(); } catch (e) {} }

        // Kanton aus Radio-Buttons lesen
        var cantonRadio = document.querySelector('input[name="dt-canton"]:checked');
        var canton = cantonRadio ? cantonRadio.value : '';

        // Scope aus Checkboxen ableiten
        var locCb = document.getElementById('dt-filter-locations');
        var layCb = document.getElementById('dt-filter-layers');
        var hasLoc = locCb ? locCb.checked : true;
        var hasLay = layCb ? layCb.checked : true;
        var scope = '';
        if (hasLoc && !hasLay) scope = 'locations';
        else if (!hasLoc && hasLay) scope = 'layers';

        var url = PROXY_URL + '?q=' + encodeURIComponent(query) + '&limit=10';
        if (canton) url += '&canton=' + encodeURIComponent(canton);
        if (scope)  url += '&scope='  + encodeURIComponent(scope);
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.timeout = 6000;
        xhr.onload = function () {
            if (xhr.status === 200) {
                try {
                    var data = JSON.parse(xhr.responseText);
                    showGroupedResults(data.groups, data.items);
                } catch (e) { showGroupedResults(null, []); }
            }
        };
        xhr.onerror = xhr.ontimeout = function () { showGroupedResults(null, []); };
        xhr.send();
        currentXhr = xhr;
    }

    // -- Event-Binding --------------------------------------------------------

    function init() {
        var input    = document.getElementById('dt-search-input');
        var list     = document.getElementById('dt-search-results');
        var clearBtn = document.getElementById('dt-search-clear');
        var filterBtn = document.getElementById('dt-search-filter-btn');
        var popup    = document.getElementById('dt-search-filter-popup');

        if (!input || !list) return;

        // Filter-Button: Popup öffnen/schliessen
        if (filterBtn && popup) {
            filterBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                var isOpen = popup.classList.toggle('open');
                filterBtn.classList.toggle('active', isOpen);
            });
        }

        // Radio/Checkbox-Änderungen: sofort neu suchen
        if (popup) {
            popup.addEventListener('change', function () {
                var q = input.value.trim();
                if (q.length >= 2) doSearch(q);
            });
        }

        input.addEventListener('input', function () {
            var q = input.value.trim();
            if (clearBtn) clearBtn.style.display = q ? 'flex' : 'none';
            if (debounceTimer) clearTimeout(debounceTimer);
            if (q.length < 2) {
                list.classList.remove('open');
                list.innerHTML = '';
                return;
            }
            debounceTimer = setTimeout(function () { doSearch(q); }, 280);
        });

        if (clearBtn) {
            clearBtn.addEventListener('click', function () {
                input.value = '';
                clearBtn.style.display = 'none';
                list.classList.remove('open');
                list.innerHTML = '';
                input.focus();
            });
        }

        input.addEventListener('keydown', function (e) {
            var items = list.querySelectorAll('.dt-search-item');
            if (e.key === 'Enter') {
                if (items.length) items[0].click();
                else if (input.value.trim().length >= 2) doSearch(input.value.trim());
                e.preventDefault();
            }
            if (e.key === 'Escape') { list.classList.remove('open'); input.blur(); }
            if (e.key === 'ArrowDown' && items.length) { items[0].focus(); e.preventDefault(); }
        });

        list.addEventListener('keydown', function (e) {
            var items   = list.querySelectorAll('.dt-search-item');
            var focused = document.activeElement;
            var idx     = Array.prototype.indexOf.call(items, focused);
            if (e.key === 'ArrowDown' && idx < items.length - 1) { items[idx + 1].focus(); e.preventDefault(); }
            if (e.key === 'ArrowUp') {
                if (idx > 0) items[idx - 1].focus(); else input.focus();
                e.preventDefault();
            }
            if (e.key === 'Enter' && idx >= 0) items[idx].click();
            if (e.key === 'Escape') { list.classList.remove('open'); input.focus(); }
        });

        document.addEventListener('click', function (e) {
            if (!e.target.closest('#dt-search-bar')) {
                list.classList.remove('open');
            }
            // Popup schliessen bei Klick ausserhalb
            if (popup && !e.target.closest('#dt-search-filter-popup') && !e.target.closest('#dt-search-filter-btn')) {
                popup.classList.remove('open');
                if (filterBtn) filterBtn.classList.remove('active');
            }
        });

        input.addEventListener('focus', function () {
            if (input.value.trim().length >= 2 && !list.children.length) {
                doSearch(input.value.trim());
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.DesktopSearch = { init: init, search: doSearch };
})();
