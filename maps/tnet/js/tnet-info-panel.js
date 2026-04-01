/**
 * tnet-info-panel.js (ES Module)
 * Info-Panel Erweiterungen: Buttons (Clipboard, Dock, Close), Resize-Handles,
 * Dock/Undock-Logik mit mapContainer-Anpassung, MutationObserver
 *
 * @version    1.1
 * @date       2026-02-12
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

// ===== INFO PANE ERWEITERUNGEN =====
// Buttons zum Info-Panel hinzufügen und Resize aktivieren
// Verwendet MutationObserver um auch bei Neuöffnen zu funktionieren
function initInfoPaneEnhancements() {
    function isMobile() { return !!window.__TNET_MOBILE_ENTRY; }

    var maptipBreadcrumbCache = {};
    var breadcrumbEnhanceTimer = null;
    var breadcrumbLookupMap = null;       // { layerId: ['ÖREB','RAUMPLANUNG',...] }
    var breadcrumbLookupBuilt = false;
    var _isEnhancingBreadcrumbs = false;  // Suppression-Flag gegen Mutations-Loop
    var _breadcrumbRetryTimer = null;     // Retry-Timer für spät initialisierte Widgets

    // Cache invalidieren wenn TnetLMStore geladen wird (TNET-Katalogpfad wird bevorzugt)
    if (window.TnetLMStore && TnetLMStore.on) {
        TnetLMStore.on('catalog-loaded', function () {
            maptipBreadcrumbCache = {};
        });
    }

    // ===== MAPTIP BREADCRUMB (DESKTOP) =====
    function normalizeCompareText(value) {
        if (value == null) return '';
        var text = String(value)
            .replace(/&nbsp;/gi, ' ')
            .replace(/[äÄ]/g, 'ae')
            .replace(/[öÖ]/g, 'oe')
            .replace(/[üÜ]/g, 'ue')
            .replace(/[ß]/g, 'ss')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '');
        return text;
    }

    function normalizeWhitespace(value) {
        if (value == null) return '';
        return String(value).replace(/\s+/g, ' ').trim();
    }

    function humanizeLayerKey(value) {
        var text = normalizeWhitespace(value);
        if (!text) return '';

        var parts = text.split('/');
        var last = parts[parts.length - 1] || text;
        last = last.split('.').pop() || last;
        last = last.replace(/^nw_|^ow_|^ch_/i, '');
        last = last.replace(/[_\-]+/g, ' ');
        return normalizeWhitespace(last.replace(/\b\w/g, function(match) { return match.toUpperCase(); }));
    }

    function getLyrmgrResources() {
        try {
            return (window.njs && njs.AppManager && njs.AppManager.nls && njs.AppManager.nls.lyrmgrResources) || null;
        } catch (e) {
            return null;
        }
    }

    function resolveDescFromResources(key, resources) {
        if (!key || !resources) return '';
        var value = resources['desc_' + key];
        if (!value) return '';
        return normalizeWhitespace(value);
    }

    function resolveCategoryLabel(category, resources) {
        if (!category) return '';

        var text = '';
        if (category.description) {
            text = normalizeWhitespace(category.description);
        }

        if (!text && category.id) {
            text = resolveDescFromResources(category.id, resources);
        }

        if (!text && category.name) {
            text = resolveDescFromResources(category.name, resources);
        }

        if (!text && category.id) {
            text = humanizeLayerKey(category.id);
        }

        if (!text && category.name) {
            text = humanizeLayerKey(category.name);
        }

        return normalizeWhitespace(text);
    }

    function resolveLayerLabel(layer, resources) {
        if (!layer) return '';

        var text = '';
        if (layer.description) {
            text = normalizeWhitespace(layer.description);
        }

        if (!text && layer.name) {
            text = resolveDescFromResources(layer.name, resources);
        }

        if (!text && layer.id) {
            text = resolveDescFromResources(layer.id, resources);
        }

        if (!text && layer.name) {
            text = humanizeLayerKey(layer.name);
        }

        if (!text && layer.id) {
            text = humanizeLayerKey(layer.id);
        }

        return normalizeWhitespace(text);
    }

    function getLayerManagerRoots() {
        try {
            var managers = window.njs && njs.AppManager && njs.AppManager.LyrMgr;
            if (!managers) return [];

            var roots = [];
            for (var key in managers) {
                if (!managers.hasOwnProperty(key)) continue;
                var root = managers[key];
                if (root && root.arCategories && root.arCategories.length) {
                    roots.push(root);
                }
            }
            return roots;
        } catch (e) {
            return [];
        }
    }

    function findLayerPathInCategory(category, layerName, categoryPath) {
        if (!category || !layerName) return null;

        var path = categoryPath.slice();
        path.push(category);

        if (category.arLayers && category.arLayers.length) {
            for (var i = 0; i < category.arLayers.length; i++) {
                var layer = category.arLayers[i];
                if (layer && layer.name === layerName) {
                    return { categories: path, layer: layer };
                }
            }
        }

        if (category.arCategories && category.arCategories.length) {
            for (var j = 0; j < category.arCategories.length; j++) {
                var found = findLayerPathInCategory(category.arCategories[j], layerName, path);
                if (found) return found;
            }
        }

        return null;
    }

    function findCategoryPathInCategory(category, key, categoryPath) {
        if (!category || !key) return null;

        var path = categoryPath.slice();
        path.push(category);

        if (category.id === key || category.name === key) {
            return path;
        }

        if (category.arCategories && category.arCategories.length) {
            for (var i = 0; i < category.arCategories.length; i++) {
                var found = findCategoryPathInCategory(category.arCategories[i], key, path);
                if (found) return found;
            }
        }

        return null;
    }

    function findLayerPathInManagers(layerName, roots) {
        if (!layerName || !roots || !roots.length) return null;

        for (var r = 0; r < roots.length; r++) {
            var root = roots[r];
            if (!root || !root.arCategories) continue;
            for (var c = 0; c < root.arCategories.length; c++) {
                var found = findLayerPathInCategory(root.arCategories[c], layerName, []);
                if (found) return found;
            }
        }

        return null;
    }

    function findCategoryPathInManagers(key, roots) {
        if (!key || !roots || !roots.length) return null;

        for (var r = 0; r < roots.length; r++) {
            var root = roots[r];
            if (!root || !root.arCategories) continue;
            for (var c = 0; c < root.arCategories.length; c++) {
                var found = findCategoryPathInCategory(root.arCategories[c], key, []);
                if (found) return found;
            }
        }

        return null;
    }

    function scanLayersInCategory(category, categoryPath, callback) {
        if (!category || typeof callback !== 'function') return;

        var path = categoryPath.slice();
        path.push(category);

        if (category.arLayers && category.arLayers.length) {
            for (var i = 0; i < category.arLayers.length; i++) {
                callback(category.arLayers[i], path);
            }
        }

        if (category.arCategories && category.arCategories.length) {
            for (var j = 0; j < category.arCategories.length; j++) {
                scanLayersInCategory(category.arCategories[j], path, callback);
            }
        }
    }

    function findTitleMatchedPath(linkedLayerId, titleText, roots, resources) {
        var titleNorm = normalizeCompareText(titleText);
        if (!linkedLayerId || !titleNorm || !roots || !roots.length) return null;

        var best = null;

        function scoreCandidate(layerLabelNorm, depth) {
            var score = depth;
            if (layerLabelNorm === titleNorm) score += 1000;
            else score += 100;
            return score;
        }

        function checkLayer(layer, categoryPath) {
            if (!layer || !layer.name) return;

            var name = layer.name;
            var matchesLinked = (name === linkedLayerId) ||
                (name.indexOf(linkedLayerId + '/') === 0) ||
                (linkedLayerId.indexOf(name + '/') === 0);
            if (!matchesLinked) return;

            var layerLabel = resolveLayerLabel(layer, resources);
            var layerNorm = normalizeCompareText(layerLabel);
            if (!layerNorm) return;

            var isMatch = (layerNorm === titleNorm) ||
                (layerNorm.indexOf(titleNorm) > -1) ||
                (titleNorm.indexOf(layerNorm) > -1);
            if (!isMatch) return;

            var score = scoreCandidate(layerNorm, categoryPath.length);
            if (!best || score > best.score) {
                best = {
                    score: score,
                    categories: categoryPath.slice()
                };
            }
        }

        for (var r = 0; r < roots.length; r++) {
            var root = roots[r];
            if (!root || !root.arCategories) continue;
            for (var c = 0; c < root.arCategories.length; c++) {
                scanLayersInCategory(root.arCategories[c], [], checkLayer);
            }
        }

        return best ? best.categories : null;
    }

    function buildBreadcrumbText(categories, resources) {
        if (!categories || !categories.length) return '';

        var labels = [];
        for (var i = 0; i < categories.length; i++) {
            var label = resolveCategoryLabel(categories[i], resources);
            if (!label) continue;
            if (labels.length && labels[labels.length - 1] === label) continue;
            labels.push(label);
        }

        return labels.join(' > ');
    }

    function getMapTipEntry(maptipId) {
        try {
            if (!maptipId || !window.njs || !njs.AppManager || !njs.AppManager.MapTips) return null;
            return njs.AppManager.MapTips[maptipId] || null;
        } catch (e) {
            return null;
        }
    }

    function resolveFastBreadcrumb(linkedLayerId, titleText) {
        var linked = normalizeWhitespace(linkedLayerId || '');
        if (!linked) return '';

        // ── Primär: TNET-Katalogpfad verwenden (autoritativ) ──
        // Der TNET-Katalog (aus der API / lyrmgr.conf) ist die definitive Quelle
        // für die Platzierung im Katalog. Vermeidet falsche Pfade durch den
        // Dojo-LyrMgr, der den tiefsten/letzten Pfad bei Mehrfachvorkommen nimmt.
        if (window.TnetLMStore && TnetLMStore.isLoaded && TnetLMStore.isLoaded()) {
            var catalogPath = TnetLMStore.getLayerCatalogPath(linked);
            console.log('[Breadcrumb] TNET-Katalog abgefragt für:', linked, '→', catalogPath);
            if (catalogPath && catalogPath.length) {
                return catalogPath.join(' > ');
            }
            console.log('[Breadcrumb] TNET-Katalog: kein Treffer, Fallback auf Dojo');
        } else {
            console.log('[Breadcrumb] TnetLMStore nicht verfügbar, Fallback auf Dojo. loaded=',
                window.TnetLMStore ? TnetLMStore.isLoaded() : 'kein Store');
        }

        // ── Fallback: Dojo-LyrMgr-Baum (wenn TNET-Katalog nicht verfügbar) ──
        if (!breadcrumbLookupBuilt) {
            breadcrumbLookupBuilt = true;
            breadcrumbLookupMap = buildBreadcrumbLookupMap();
        }

        if (!breadcrumbLookupMap) return '';

        var titleNorm = normalizeCompareText(titleText || '');
        var bestPath = null;
        var bestScore = -1;

        for (var layerId in breadcrumbLookupMap) {
            if (!breadcrumbLookupMap.hasOwnProperty(layerId)) continue;

            // Layer muss zum linked_layer passen (gleich, oder Prefix-Match)
            var match = (layerId === linked) ||
                (layerId.indexOf(linked + '/') === 0) ||
                (linked.indexOf(layerId + '/') === 0);
            if (!match) continue;

            var entry = breadcrumbLookupMap[layerId];
            var layerLabelNorm = normalizeCompareText(entry.layerLabel || '');

            // Titel-Matching scoren
            var score = 0;
            if (titleNorm && layerLabelNorm) {
                if (layerLabelNorm === titleNorm) {
                    score = 1000;
                } else if (titleNorm.indexOf(layerLabelNorm) > -1 || layerLabelNorm.indexOf(titleNorm) > -1) {
                    score = 500;
                }
            }
            // Tieferer Pfad bevorzugen
            score += (entry.path ? entry.path.length : 0);

            if (score > bestScore) {
                bestScore = score;
                bestPath = entry.path;
            }
        }

        if (bestPath && bestPath.length) {
            return bestPath.join(' > ');
        }

        return '';
    }

    // ===== BREADCRUMB LOOKUP-MAP AUS LYRMGR-BAUM AUFBAUEN =====
    // Wird einmalig aufgerufen, traversiert alle LyrMgr-Instanzen.
    // Ergebnis: { 'gis_oereb/.../grundnutzung': { path: ['ÖREB','RAUMPLANUNG',...], layerLabel: '...' } }
    function buildBreadcrumbLookupMap() {
        try {
            var managers = window.njs && njs.AppManager && njs.AppManager.LyrMgr;
            if (!managers) return null;

            var resources = getLyrmgrResources();
            var map = {};

            for (var mgrKey in managers) {
                if (!managers.hasOwnProperty(mgrKey)) continue;
                var mgr = managers[mgrKey];
                if (!mgr || !mgr.arCategories || !mgr.arCategories.length) continue;

                for (var c = 0; c < mgr.arCategories.length; c++) {
                    traverseCategoryForMap(mgr.arCategories[c], [], resources, map);
                }
            }

            return (Object.keys(map).length > 0) ? map : null;
        } catch (e) {
            console.warn('[Breadcrumb] Fehler beim Aufbau der Lookup-Map:', e);
            return null;
        }
    }

    function traverseCategoryForMap(category, parentPath, resources, map) {
        if (!category) return;

        var label = resolveCategoryLabel(category, resources);
        var path = parentPath.slice();
        if (label) path.push(label);

        // Blatt-Layer registrieren
        if (category.arLayers && category.arLayers.length) {
            for (var i = 0; i < category.arLayers.length; i++) {
                var layer = category.arLayers[i];
                if (!layer || !layer.name) continue;

                var layerLabel = resolveLayerLabel(layer, resources);
                map[layer.name] = {
                    path: path.slice(),
                    layerLabel: layerLabel
                };
            }
        }

        // Rekursiv in Unterkategorien
        if (category.arCategories && category.arCategories.length) {
            for (var j = 0; j < category.arCategories.length; j++) {
                traverseCategoryForMap(category.arCategories[j], path, resources, map);
            }
        }
    }

    function resolveBreadcrumbForMaptip(maptipId, titleText) {
        var cacheKey = maptipId + '|' + normalizeCompareText(titleText);
        if (Object.prototype.hasOwnProperty.call(maptipBreadcrumbCache, cacheKey)) {
            console.log('[Breadcrumb] Cache-Hit:', cacheKey, '→', maptipBreadcrumbCache[cacheKey] || '(leer)');
            return maptipBreadcrumbCache[cacheKey];
        }

        var maptip = getMapTipEntry(maptipId);
        if (!maptip) {
            console.log('[Breadcrumb] Kein Maptip für:', maptipId);
            maptipBreadcrumbCache[cacheKey] = '';
            return '';
        }

        var linkedLayerId = normalizeWhitespace(maptip.linked_layer_id || maptip.linked_layer || '');
        if (!linkedLayerId) {
            console.log('[Breadcrumb] Kein linked_layer für maptip:', maptipId);
            maptipBreadcrumbCache[cacheKey] = '';
            return '';
        }

        console.log('[Breadcrumb] Resolve:', maptipId, 'linked=', linkedLayerId, 'title=', titleText);
        var breadcrumb = resolveFastBreadcrumb(linkedLayerId, titleText);
        maptipBreadcrumbCache[cacheKey] = breadcrumb;
        return breadcrumb;
    }

    function getTitlePaneWidget(paneNode) {
        if (!paneNode || typeof dijit === 'undefined') return null;

        if (typeof dijit.byNode === 'function') {
            try {
                var byNode = dijit.byNode(paneNode);
                if (byNode) return byNode;
            } catch (e) {}
        }

        var widgetId = paneNode.getAttribute('widgetid') || paneNode.getAttribute('data-dojo-widget-id');
        if (!widgetId || typeof dijit.byId !== 'function') return null;
        return dijit.byId(widgetId) || null;
    }

    // ===== BREADCRUMB-KLICK → LAYER IM KATALOG HERVORHEBEN =====

    /**
     * Sucht das DOM-Element eines Layers im Themenkatalog.
     * Prüft zuerst den neuen LM-Tree (falls aktiv), dann Legacy-LyrMgr.
     */
    function findLayerElementInCatalog(layerId) {
        if (!layerId) return null;

        // 1. Neuer Tree (Priorität!): data-layer-id Attribut in #lm-tree-container
        //    Wenn useNewTree=true, ist der Legacy-Baum versteckt im Hintergrund.
        //    Ohne diese Priorität wird das Element im unsichtbaren Legacy-Baum gefunden.
        var treeContainer = document.getElementById('lm-tree-container');
        if (treeContainer) {
            var treeEl = treeContainer.querySelector('[data-layer-id="' + layerId + '"]');
            if (treeEl) {
                console.log('[ScrollToCatalog] Gefunden via data-layer-id im neuen Tree');
                return treeEl;
            }
        }

        // 2. Legacy-LyrMgr: div_<layerName>
        var el = document.getElementById('div_' + layerId);
        if (el) {
            console.log('[ScrollToCatalog] Gefunden via div_' + layerId + ' (Legacy)');
            return el;
        }

        // 3. Dijit Checkbox-Widget
        if (typeof dijit !== 'undefined' && typeof dijit.byId === 'function') {
            var cbWidget = dijit.byId(layerId);
            if (cbWidget && cbWidget.domNode) {
                var containerEl = cbWidget.domNode.closest('.layercontainer') || cbWidget.domNode.parentElement;
                if (containerEl) {
                    console.log('[ScrollToCatalog] Gefunden via dijit.byId(' + layerId + ') (Legacy)');
                    return containerEl;
                }
            }
        }

        // 4. Prefix-Match: layerId könnte ein Prefix des tatsächlichen Keys sein,
        //    ODER layerId ist ein Sublayer-Key der länger ist als der Tree-Eintrag.
        //    Beispiel A: layerId='gis_fach/nw_fff' → Tree hat 'gis_fach/nw_fff/sub'
        //    Beispiel B: layerId='gis_fach/nw_fff/sub' → Tree hat 'gis_fach/nw_fff'
        //    Suche in beiden Richtungen, bevorzuge den längsten/spezifischsten Match.
        if (treeContainer) {
            var prefixEls = treeContainer.querySelectorAll('[data-layer-id]');
            var bestMatch = null;
            var bestMatchLen = 0;
            for (var pe = 0; pe < prefixEls.length; pe++) {
                var dlid = prefixEls[pe].getAttribute('data-layer-id');
                if (!dlid) continue;
                // Richtung A: Tree-ID beginnt mit layerId (Tree ist spezifischer)
                if (dlid.indexOf(layerId) === 0 && dlid.length > bestMatchLen) {
                    bestMatch = prefixEls[pe];
                    bestMatchLen = dlid.length;
                }
                // Richtung B: layerId beginnt mit Tree-ID (layerId ist spezifischer/Sublayer)
                if (layerId.indexOf(dlid) === 0 && dlid.length > bestMatchLen) {
                    bestMatch = prefixEls[pe];
                    bestMatchLen = dlid.length;
                }
            }
            if (bestMatch) {
                console.log('[ScrollToCatalog] Gefunden via Prefix-Match im neuen Tree: ' +
                    bestMatch.getAttribute('data-layer-id') + ' (für: ' + layerId + ')');
                return bestMatch;
            }
        }
        if (typeof dijit !== 'undefined' && dijit.registry) {
            var found = null;
            // dijit.registry kann WidgetSet (forEach) oder AMD-Registry (toArray) sein
            var widgets = typeof dijit.registry.toArray === 'function'
                ? dijit.registry.toArray()
                : (typeof dijit.registry.forEach === 'function' ? null : []);
            if (widgets === null) {
                // WidgetSet mit forEach
                dijit.registry.forEach(function(w) {
                    if (found) return;
                    if (w.declaredClass === 'dijit.form.CheckBox' && w.id && w.id.indexOf(layerId) === 0) {
                        var cEl = w.domNode ? (w.domNode.closest('.layercontainer') || w.domNode.parentElement) : null;
                        if (cEl) {
                            console.log('[ScrollToCatalog] Gefunden via Prefix-Match (Legacy): ' + w.id);
                            found = cEl;
                        }
                    }
                });
            } else {
                for (var wi = 0; wi < widgets.length; wi++) {
                    var w = widgets[wi];
                    if (w.declaredClass === 'dijit.form.CheckBox' && w.id && w.id.indexOf(layerId) === 0) {
                        var cEl = w.domNode ? (w.domNode.closest('.layercontainer') || w.domNode.parentElement) : null;
                        if (cEl) {
                            console.log('[ScrollToCatalog] Gefunden via Prefix-Match (Legacy): ' + w.id);
                            found = cEl;
                            break;
                        }
                    }
                }
            }
            if (found) return found;
        }

        console.log('[ScrollToCatalog] NICHT gefunden für:', layerId);
        return null;
    }

    /**
     * Öffnet den Themenkatalog, navigiert zum Layer und hebt ihn hervor.
     * Wird bei Klick auf den Breadcrumb im Info-Panel ausgelöst.
     * Unterstützt sowohl den neuen LM-Tree als auch den Legacy-Dojo-Baum.
     */
    function scrollToLayerInCatalog(linkedLayerId) {
        console.log('[ScrollToCatalog] Aufgerufen mit:', linkedLayerId);
        if (!linkedLayerId) return;

        // 1. Layer-DOM-Element finden
        var layerEl = findLayerElementInCatalog(linkedLayerId);
        if (!layerEl) return;

        // 2. Prüfen ob Element im neuen LM-Tree oder im Legacy-Baum liegt
        var treeContainer = document.getElementById('lm-tree-container');
        var isNewTree = treeContainer && treeContainer.contains(layerEl);
        console.log('[ScrollToCatalog] Modus:', isNewTree ? 'Neuer Tree' : 'Legacy');

        // 3. Themenkatalog-Pane öffnen (tp_overview_menu) — gilt für beide Modi
        var overviewEl = document.getElementById('tp_overview_menu');
        if (overviewEl && !overviewEl.open) {
            overviewEl.open = true;
            console.log('[ScrollToCatalog] tp_overview_menu geöffnet');
        }

        if (isNewTree) {
            // ===== NEUER TREE: Tab aktivieren + Gruppen aufklappen =====
            _scrollInNewTree(layerEl, treeContainer);
        } else {
            // ===== LEGACY BAUM: Tab aktivieren + TitlePanes öffnen =====
            _scrollInLegacyTree(layerEl);
        }

        // 4. Scroll & Highlight (verzögert)
        _scrollAndHighlight(layerEl, 0);
    }

    /**
     * Navigation im neuen LM-Tree: Tab aktivieren und Gruppen aufklappen.
     */
    function _scrollInNewTree(layerEl, treeContainer) {
        // 1. Richtigen Tab aktivieren (Eltern-catContent finden)
        var catContent = layerEl.closest('.lm-cat-content');
        if (catContent) {
            var catId = catContent.getAttribute('data-cat-content');
            if (catId) {
                // Tab-Button klicken
                var tabBtn = treeContainer.querySelector('.lm-tab[data-cat-id="' + catId + '"]');
                if (tabBtn && !tabBtn.classList.contains('lm-tab-active')) {
                    tabBtn.click();
                    console.log('[ScrollToCatalog] Neuer Tree: Tab aktiviert:', catId);
                }
                // Sicherstellen dass Content sichtbar ist
                catContent.style.display = '';
            }
        }

        // 2. Alle Eltern-Gruppen aufklappen (von innen nach aussen)
        var parent = layerEl.parentElement;
        while (parent && parent !== treeContainer) {
            if (parent.classList.contains('lm-nested-group')) {
                if (parent.classList.contains('lm-collapsed')) {
                    parent.classList.remove('lm-collapsed');
                    parent.classList.add('lm-expanded');
                    console.log('[ScrollToCatalog] Neuer Tree: Gruppe aufgeklappt:',
                        parent.getAttribute('data-group-id') || '(kein)');
                }
            }
            parent = parent.parentElement;
        }
    }

    /**
     * Navigation im Legacy-Dojo-Baum: Kantons-Tab aktivieren und TitlePanes öffnen.
     */
    function _scrollInLegacyTree(layerEl) {
        if (typeof dijit === 'undefined') return;

        // 1. Bestimme welcher Kantons-Tab das Layer enthält
        var kantonsPanes = [
            'tp_layer_menu', 'tp_layer_menu2', 'tp_layer_menu3', 'tp_layer_menu4'
        ];
        var targetTab = null;
        for (var i = 0; i < kantonsPanes.length; i++) {
            var paneEl = document.getElementById(kantonsPanes[i]);
            if (paneEl && paneEl.contains(layerEl)) {
                targetTab = kantonsPanes[i];
                break;
            }
        }
        console.log('[ScrollToCatalog] Legacy Kantons-Tab:', targetTab || 'keiner');

        // 2. Richtigen Kantons-Tab aktivieren
        if (targetTab) {
            var tabBar = document.getElementById('kantons_tab_bar');
            if (tabBar) {
                var tabBtn = tabBar.querySelector('.kanton-tab[data-target="' + targetTab + '"]');
                if (tabBtn && !tabBtn.classList.contains('active')) {
                    tabBtn.click();
                    console.log('[ScrollToCatalog] Legacy Tab aktiviert:', targetTab);
                }
            }
            var tabPane = document.getElementById(targetTab);
            if (tabPane) {
                tabPane.classList.add('active-tab');
            }
        }

        // 3. Ancestor-TitlePanes sammeln und öffnen
        var ancestorPanes = [];
        var parent = layerEl.parentElement;
        while (parent) {
            if (parent.classList && parent.classList.contains('dijitTitlePane')) {
                if (parent.id && parent.id.match(/^tp_layer_menu\d?$/)) {
                    parent = parent.parentElement;
                    continue;
                }
                if (parent.id === 'tp_overview_menu') {
                    parent = parent.parentElement;
                    continue;
                }
                ancestorPanes.push(parent);
            }
            parent = parent.parentElement;
        }
        console.log('[ScrollToCatalog] Legacy TitlePanes:', ancestorPanes.length,
            ancestorPanes.map(function(n) { return n.id || '(kein)'; }));

        for (var p = ancestorPanes.length - 1; p >= 0; p--) {
            _forceOpenTitlePane(ancestorPanes[p]);
        }
    }

    /**
     * Erzwingt das Öffnen eines TitlePane sowohl via Widget-API als auch brute-force via DOM.
     */
    function _forceOpenTitlePane(paneNode) {
        var id = paneNode.id || '(kein)';

        // 1. Widget finden
        var pw = null;
        try {
            if (paneNode.id) pw = dijit.byId(paneNode.id);
        } catch (e) {}
        if (!pw) {
            try { if (dijit.byNode) pw = dijit.byNode(paneNode); } catch (e) {}
        }
        if (!pw) {
            var wid = paneNode.getAttribute('widgetid');
            if (wid) try { pw = dijit.byId(wid); } catch (e) {}
        }

        // 2. Widget-basiert öffnen (wenn verfügbar)
        if (pw) {
            try {
                if (typeof pw._setOpenAttr === 'function') {
                    pw._setOpenAttr(true);
                    console.log('[ScrollToCatalog] _setOpenAttr(true):', id);
                } else if (typeof pw.set === 'function') {
                    pw.set('open', true);
                    console.log('[ScrollToCatalog] set(open,true):', id);
                }
            } catch (e) {
                console.warn('[ScrollToCatalog] Widget-Open Fehler:', id, e);
            }
        } else {
            console.log('[ScrollToCatalog] Kein Widget für:', id, '→ nur DOM-Fallback');
        }

        // 3. Brute-force DOM: ContentOuter + wipeNode direkt sichtbar machen
        //    Traversiert Kinder des paneNode, NICHT querySelectorAll (findet sonst verschachtelte)
        var children = paneNode.children;
        for (var c = 0; c < children.length; c++) {
            var child = children[c];
            if (child.classList.contains('dijitTitlePaneContentOuter')) {
                child.style.setProperty('display', 'block', 'important');
                child.style.setProperty('height', 'auto', 'important');
                child.style.setProperty('overflow', 'visible', 'important');
                child.style.setProperty('visibility', 'visible', 'important');

                // Auch das wipeNode (erstes Kind von ContentOuter) sichtbar machen
                var innerChildren = child.children;
                for (var w = 0; w < innerChildren.length; w++) {
                    var inner = innerChildren[w];
                    if (inner.classList.contains('dijitReset') ||
                        inner.getAttribute('data-dojo-attach-point') === 'wipeNode' ||
                        inner.classList.contains('dijitTitlePaneContentInner')) {
                        inner.style.setProperty('display', 'block', 'important');
                        inner.style.setProperty('height', 'auto', 'important');
                        inner.style.setProperty('overflow', 'visible', 'important');
                        inner.style.setProperty('visibility', 'visible', 'important');
                    }
                }
                break;
            }
        }

        // 4. Klassen korrigieren
        paneNode.classList.remove('dijitClosed');
        paneNode.classList.remove('dijitTitlePaneClosed');
        if (paneNode.hasAttribute('data-lyrmgr-depth')) {
            paneNode.classList.add('lyrmgr-open');
        }
    }

    /**
     * Scrollt zum Element und hebt es hervor. Retry falls Element noch den Rect 0,0,0,0 hat.
     */
    function _scrollAndHighlight(layerEl, attempt) {
        var delay = attempt === 0 ? 300 : 500;
        setTimeout(function() {
            // Vorherige Highlights entfernen
            var prev = document.querySelectorAll('.tnet-catalog-highlight');
            for (var j = 0; j < prev.length; j++) {
                prev[j].classList.remove('tnet-catalog-highlight');
            }

            var rect = layerEl.getBoundingClientRect();
            console.log('[ScrollToCatalog] Element-Position (Versuch ' + (attempt + 1) + '):', 
                Math.round(rect.top), Math.round(rect.left), Math.round(rect.width), Math.round(rect.height));

            // Element immer noch unsichtbar → Diagnose & Retry
            if (rect.width === 0 && rect.height === 0) {
                // Diagnose: Welcher Ancestor ist unsichtbar?
                var node = layerEl;
                while (node && node !== document.body) {
                    var cs = window.getComputedStyle(node);
                    if (cs.display === 'none' || cs.visibility === 'hidden') {
                        console.warn('[ScrollToCatalog] Versteckter Ancestor:', 
                            node.tagName + '#' + (node.id || ''), 
                            'display:', cs.display, 'visibility:', cs.visibility,
                            'classes:', node.className.substring(0, 80));
                        // Brute-force: Element sichtbar machen
                        if (cs.display === 'none') {
                            node.style.setProperty('display', 'block', 'important');
                        }
                        if (cs.visibility === 'hidden') {
                            node.style.setProperty('visibility', 'visible', 'important');
                        }
                    }
                    node = node.parentElement;
                }

                if (attempt < 3) {
                    console.log('[ScrollToCatalog] Retry nach Brute-Force-Fix...');
                    _scrollAndHighlight(layerEl, attempt + 1);
                    return;
                }
                console.warn('[ScrollToCatalog] Alle Retry-Versuche erschöpft.');
            }

            layerEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            layerEl.classList.add('tnet-catalog-highlight');

            // Animation nach 3s entfernen
            setTimeout(function() {
                layerEl.classList.remove('tnet-catalog-highlight');
            }, 3000);
        }, delay);
    }

    // Funktion global verfügbar machen für externe Nutzung
    window.TnetScrollToLayerInCatalog = scrollToLayerInCatalog;

    function renderBreadcrumbInTitleBar(titleBar, breadcrumbText, linkedLayerId) {
        if (!titleBar) return;

        var node = titleBar.querySelector('.tnet-maptip-breadcrumb');

        if (!breadcrumbText) {
            if (node) node.remove();
            return;
        }

        if (!node) {
            node = document.createElement('div');
            node.className = 'tnet-maptip-breadcrumb';
            titleBar.appendChild(node);
        }

        // NUR updaten wenn sich Werte geändert haben (verhindert Mutations-Loop)
        if (node.textContent !== breadcrumbText) {
            node.textContent = breadcrumbText;
        }
        var newTitle = breadcrumbText + (linkedLayerId ? '\nKlicken \u2192 Im Katalog anzeigen' : '');
        if (node.title !== newTitle) {
            node.title = newTitle;
        }

        // Layer-ID als Data-Attribut speichern und Klick-Handler setzen
        if (linkedLayerId) {
            if (node.getAttribute('data-linked-layer') !== linkedLayerId) {
                node.setAttribute('data-linked-layer', linkedLayerId);
            }
            if (!node.classList.contains('tnet-maptip-breadcrumb-clickable')) {
                node.classList.add('tnet-maptip-breadcrumb-clickable');
            }

            // Event-Listener nur einmal setzen (Flag am Node)
            if (!node._tnetClickBound) {
                node._tnetClickBound = true;
                node.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var layerId = this.getAttribute('data-linked-layer');
                    if (layerId) scrollToLayerInCatalog(layerId);
                });
            }
        }
    }

    function enhanceMapTipResultBreadcrumbs() {
        if (isMobile()) return;

        var contentRoot = document.getElementById('njs_info_pane_content');
        if (!contentRoot) return;

        var panes = contentRoot.querySelectorAll('.dijitTitlePane');
        if (!panes || !panes.length) {
            console.log('[Breadcrumb] enhanceMapTipResultBreadcrumbs: keine TitlePanes gefunden');
            return;
        }

        var hasUnreadyPanes = false;
        var enhancedCount = 0;
        console.log('[Breadcrumb] enhanceMapTipResultBreadcrumbs:', panes.length, 'TitlePanes');
        for (var i = 0; i < panes.length; i++) {
            var pane = panes[i];
            var titleBar = pane.querySelector('.dijitTitlePaneTitle');
            if (!titleBar) continue;

            var widget = getTitlePaneWidget(pane);
            if (!widget || !widget.id_maptip) {
                // Widget noch nicht initialisiert → später erneut versuchen
                hasUnreadyPanes = true;
                continue;
            }

            var titleText = '';
            if (typeof widget.get === 'function') {
                titleText = normalizeWhitespace(widget.get('title') || '');
            }
            if (!titleText) {
                var textNode = titleBar.querySelector('.dijitTitlePaneTextNode');
                titleText = normalizeWhitespace(textNode ? textNode.textContent : '');
            }

            var breadcrumb = resolveBreadcrumbForMaptip(widget.id_maptip, titleText);

            // linked_layer_id für Klick-Navigation auflösen
            var linkedLayerId = '';
            var maptipEntry = getMapTipEntry(widget.id_maptip);
            if (maptipEntry) {
                linkedLayerId = normalizeWhitespace(maptipEntry.linked_layer_id || maptipEntry.linked_layer || '');
            }

            console.log('[Breadcrumb] Pane', i, ': maptip=', widget.id_maptip, '→', breadcrumb || '(leer)', 'layer=', linkedLayerId);
            renderBreadcrumbInTitleBar(titleBar, breadcrumb, linkedLayerId);
            if (breadcrumb) enhancedCount++;
        }

        // Retry wenn Panes ohne id_maptip existieren (Framework hat Widgets noch nicht initialisiert)
        if (hasUnreadyPanes) {
            if (_breadcrumbRetryTimer) clearTimeout(_breadcrumbRetryTimer);
            _breadcrumbRetryTimer = setTimeout(function() {
                _breadcrumbRetryTimer = null;
                console.log('[Breadcrumb] Retry: Panes hatten kein id_maptip, versuche erneut...');
                _isEnhancingBreadcrumbs = true;
                try {
                    enhanceMapTipResultBreadcrumbs();
                } finally {
                    setTimeout(function() { _isEnhancingBreadcrumbs = false; }, 200);
                }
            }, 300);
        }
    }

    function scheduleMapTipBreadcrumbEnhancement() {
        if (isMobile()) return;
        if (_isEnhancingBreadcrumbs) return; // Keine Neuplanung während Enhancement (Mutations-Loop verhindern)
        if (breadcrumbEnhanceTimer) {
            clearTimeout(breadcrumbEnhanceTimer);
        }
        breadcrumbEnhanceTimer = setTimeout(function() {
            breadcrumbEnhanceTimer = null;
            _isEnhancingBreadcrumbs = true;
            try {
                enhanceMapTipResultBreadcrumbs();
            } finally {
                // Kurze Karenzzeit bevor Observer wieder schedulen darf
                setTimeout(function() { _isEnhancingBreadcrumbs = false; }, 200);
            }
        }, 150);
    }

    function enhanceInfoPane() {
        var infoPane = document.getElementById('njs_info_pane');
        if (!infoPane) return false;

        var titleBar = infoPane.querySelector('.dojoxFloatingPaneTitle');
        if (!titleBar) return false;

        // Prüfe ob Custom-Titlebar bereits vorhanden
        if (titleBar.querySelector('.info-pane-custom-title')) {
            if (!isMobile() && !infoPane.querySelector('.info-pane-resize-left')) {
                initInfoPaneResize(infoPane);
            }
            return true;
        }

        // ── Custom Titelbar: Dojo-Kinder leeren, unseren Inhalt einsetzen ─────
        // Wir entfernen NICHT den titleBar selbst — Dojo berechnet offsetHeight
        // des Titelbars um die contentInfo absolut zu positionieren.
        // Stattdessen leeren wir ihn und befüllen ihn neu.

        // Titel fix: dijit.get('title') liefert HTML-Inhalt zurück — NICHT verwenden!
        var titleText = 'Objektinformation';
        var dojoTitleEl = titleBar.querySelector('.dojoxFloatingPaneTitleText');
        if (dojoTitleEl) {
            var _t = (dojoTitleEl.value || '').trim();
            if (_t && _t.indexOf('<') === -1 && _t.length < 80) titleText = _t;
        }

        // Alle bestehenden Dojo-Kinder entfernen (per loop, da innerHTML = '' Dojo-Widgets beschädigt)
        while (titleBar.firstChild) { titleBar.removeChild(titleBar.firstChild); }

        // Dojo setzt text-align:center inline — überschreiben
        titleBar.style.setProperty('text-align', 'left', 'important');
        titleBar.style.setProperty('justify-content', 'flex-start', 'important');

        // Titel-Span
        var titleSpan = document.createElement('span');
        titleSpan.className = 'info-pane-custom-title';
        titleSpan.textContent = titleText;

        // Actions Container
        var actions = document.createElement('div');
        actions.className = 'info-pane-actions';

        // Clipboard Button
        var clipboardBtn = document.createElement('button');
        clipboardBtn.className = 'info-pane-btn';
        clipboardBtn.title = 'In Zwischenablage kopieren';
        clipboardBtn.innerHTML = TnetIcons.get('clipboard');
        clipboardBtn.onmousedown = function(e) { e.stopPropagation(); };
        clipboardBtn.onclick = function(e) {
            e.stopPropagation();
            window.copyInfoPaneToClipboard();
        };

        // Dock Button (nur Desktop)
        var dockBtn = document.createElement('button');
        dockBtn.className = 'info-pane-btn';
        dockBtn.id = 'info-pane-dock-btn';
        dockBtn.title = 'Rechts andocken';
        dockBtn.innerHTML = TnetIcons.get('dock');
        dockBtn.onmousedown = function(e) { e.stopPropagation(); };
        dockBtn.onclick = function(e) {
            e.stopPropagation();
            window.toggleInfoPaneDock();
        };

        // Close Button
        var closeBtn = document.createElement('button');
        closeBtn.className = 'info-pane-btn info-pane-close';
        closeBtn.title = 'Schließen';
        closeBtn.innerHTML = TnetIcons.get('close');
        closeBtn.onmousedown = function(e) { e.stopPropagation(); };
        closeBtn.onclick = function(e) {
            e.stopPropagation();
            if (isInfoPaneDocked) {
                var mapContainer = document.getElementById('mapContainer');
                if (mapContainer) {
                    mapContainer.style.setProperty('width', '100%', 'important');
                    setTimeout(function() { triggerMapUpdate(); }, 100);
                }
                stopMapContainerObserver();
                isInfoPaneDocked = false;
                infoPane.classList.remove('docked-right');
            }
            var widget = (typeof dijit !== 'undefined') ? dijit.byId('njs_info_pane') : null;
            if (widget && widget.close) {
                widget.close();
            } else {
                infoPane.style.visibility = 'hidden';
            }
        };

        actions.appendChild(clipboardBtn);
        if (!isMobile()) actions.appendChild(dockBtn);
        actions.appendChild(closeBtn);

        // Direkt in den Dojo-titleBar einfügen (nicht als separaten DIV)
        // So bleibt Dojo's offsetHeight-Berechnung für die contentInfo intakt.
        titleBar.appendChild(titleSpan);
        titleBar.appendChild(actions);

        // MutationObserver: nicht mehr nötig (lesen per Dojo-Widget bei jedem show)

        // Custom Resize-Handle hinzufügen (nur Desktop)
        if (!isMobile()) {
            initInfoPaneResize(infoPane);
        } else {
            addMobileInfoSheetHandle(infoPane);
        }

        return true;
    }

    // Initial versuchen
    enhanceInfoPane();

    // Hilfsfunktion: Docked-Zustand wiederherstellen (verhindert Flackern)
    function restoreDockedLayout(infoPane) {
        if (!isInfoPaneDocked || !infoPane.classList.contains('docked-right')) return;
        var savedWidth = window._savedDockedPanelWidth || 350;
        var streetviewContainer = document.getElementById('streetviewContainer');
        var centerPane = document.getElementById('centerPaneLayout');
        var streetviewWidth = 0;
        if (streetviewContainer && streetviewContainer.offsetWidth > 0 && streetviewContainer.style.display !== 'none') {
            streetviewWidth = streetviewContainer.offsetWidth;
        }

        infoPane.style.setProperty('width', savedWidth + 'px', 'important');
        infoPane.style.setProperty('right', streetviewWidth + 'px', 'important');

        var mapContainer = document.getElementById('mapContainer');
        if (mapContainer) {
            var centerPaneWidth = centerPane ? centerPane.offsetWidth : window.innerWidth;
            var mapWidth = centerPaneWidth - streetviewWidth - savedWidth;
            mapContainer.style.setProperty('width', mapWidth + 'px', 'important');
        }
    }

    // Info-Pane unter Header positionieren (69px Header + 11px Puffer)
    function ensureBelowHeader(infoPane) {
        if (!infoPane || infoPane.classList.contains('docked-right')) return;
        if (isMobile()) return; // auf Mobile positioniert das CSS fix als Bottom-Sheet
        requestAnimationFrame(function() {
            var rect = infoPane.getBoundingClientRect();
            if (rect.top < 80) {
                var currentTop = parseInt(infoPane.style.top) || 0;
                var delta = 80 - rect.top;
                infoPane.style.setProperty('top', (currentTop + delta) + 'px', 'important');
            }
        });
    }

    // Hilfsfunktion: ist die Pane sichtbar?
    // (Mock: visibility:hidden/visible; CSS hat display:flex !important, daher kein display-Check)
    function isPaneVisible(infoPane) {
        if (!infoPane) return false;
        return infoPane.style.visibility !== 'hidden';
    }

    // Callback wenn Info-Pane sichtbar wird
    function onInfoPaneChange(infoPane) {
        if (!isPaneVisible(infoPane)) return;

        // ÖREB-Modus: Info-Pane sofort schliessen (keine Objektinfo während ÖREB)
        if (window.isOerebActive) {
            var oerebWidget = (typeof dijit !== 'undefined') ? dijit.byId('njs_info_pane') : null;
            if (oerebWidget && oerebWidget.close) {
                oerebWidget.close();
            } else {
                infoPane.style.visibility = 'hidden';
            }
            return;
        }

        enhanceInfoPane();
        scheduleMapTipBreadcrumbEnhancement();
        restoreDockedLayout(infoPane);
        ensureBelowHeader(infoPane);
    }

    // Gezielter Observer: Nur njs_info_pane selbst beobachten (nicht document.body)
    var paneObserver = null;

    function attachPaneObserver(infoPane) {
        if (paneObserver) return; // Bereits aktiv
        paneObserver = new MutationObserver(function(mutations) {
            onInfoPaneChange(infoPane);
        });
        // Attribut-Änderungen (style/class) UND DOM-Rebuilds (childList) beobachten
        paneObserver.observe(infoPane, {
            attributes: true,
            attributeFilter: ['style', 'class'],
            childList: true,
            subtree: true
        });
    }

    // Warten bis njs_info_pane im DOM erscheint, dann gezielten Observer setzen
    var waitInterval = setInterval(function() {
        var infoPane = document.getElementById('njs_info_pane');
        if (infoPane) {
            clearInterval(waitInterval);
            attachPaneObserver(infoPane);
            onInfoPaneChange(infoPane);
        }
    }, 500);

    // Fallback-Check: periodisch prüfen ob Buttons (noch) vorhanden sind
    // UND Breadcrumbs nachsetzen falls beim ersten Enhancement nicht bereit
    setInterval(function() {
        var infoPane = document.getElementById('njs_info_pane');
        if (infoPane) {
            attachPaneObserver(infoPane); // Observer setzen falls noch nicht aktiv
            if (isPaneVisible(infoPane)) {
                enhanceInfoPane();
                // Breadcrumbs nachrüsten falls fehlend (Timing-Fallback)
                var contentRoot = document.getElementById('njs_info_pane_content');
                if (contentRoot) {
                    var panes = contentRoot.querySelectorAll('.dijitTitlePane');
                    var hasMissingBreadcrumbs = false;
                    for (var k = 0; k < panes.length; k++) {
                        var tb = panes[k].querySelector('.dijitTitlePaneTitle');
                        if (tb && !tb.querySelector('.tnet-maptip-breadcrumb')) {
                            var w = getTitlePaneWidget(panes[k]);
                            if (w && w.id_maptip) {
                                hasMissingBreadcrumbs = true;
                                break;
                            }
                        }
                    }
                    if (hasMissingBreadcrumbs) {
                        console.log('[Breadcrumb] Periodischer Fallback: fehlende Breadcrumbs entdeckt');
                        scheduleMapTipBreadcrumbEnhancement();
                    }
                }
            }
        }
    }, 2000);

    // Mobile: Custom-Event vom FloatingPane-Mock (zuverlässiger als MutationObserver)
    if (isMobile()) {
        window.addEventListener('njsInfoPaneShow', function(e) {
            var infoPane = document.getElementById('njs_info_pane');
            if (!infoPane) return;
            attachPaneObserver(infoPane);
            enhanceInfoPane();
        });
        window.addEventListener('njsInfoPaneHide', function() {
            // kein Action nötig
        });
    }
}
initInfoPaneEnhancements();

// Mobile: Sheet-Handle in #njs_info_pane injizieren und Drag-to-Resize aktivieren
function addMobileInfoSheetHandle(infoPane) {
    if (!infoPane) return;
    if (infoPane.querySelector('.info-sheet-handle')) return; // bereits vorhanden

    // Handle als allererstes Kind einfügen (vor dojoxFloatingPaneTitle)
    var handle = document.createElement('div');
    handle.className = 'm-sheet-handle info-sheet-handle';
    var bar = document.createElement('div');
    bar.className = 'm-sheet-bar';
    handle.appendChild(bar);
    infoPane.insertBefore(handle, infoPane.firstChild);

    // attachSheetResize ggf. noch nicht bereit (mDrawerInit läuft asynchron)
    var retryCount = 0;
    function tryAttach() {
        if (typeof window.attachSheetResize === 'function') {
            window.attachSheetResize(handle);
        } else if (retryCount < 25) {
            retryCount++;
            setTimeout(tryAttach, 200);
        }
    }
    tryAttach();
}

// Custom Resize für Info-Panel
function initInfoPaneResize(pane) {
    if (window.__TNET_MOBILE_ENTRY) return; // keine Resize-Handles auf Mobile
    // Bestehende Resize-Handles entfernen (falls vorhanden)
    var existingHandles = pane.querySelectorAll('[class*="info-pane-resize"]');
    existingHandles.forEach(function(h) { h.remove(); });
    
    // Alle Resize-Handles erstellen
    var handles = {
        top: createHandle('info-pane-resize-top', 'position:absolute; top:0; left:0; right:0; height:6px; cursor:ns-resize; z-index:1000;'),
        bottom: createHandle('info-pane-resize-bottom', 'position:absolute; bottom:0; left:0; right:0; height:6px; cursor:ns-resize; z-index:1000;'),
        left: createHandle('info-pane-resize-left', 'position:absolute; left:0; top:0; bottom:0; width:8px; cursor:ew-resize; z-index:1000; background:linear-gradient(to right, rgba(75,123,129,0.15), transparent);'),
        right: createHandle('info-pane-resize-right', 'position:absolute; right:0; top:0; bottom:0; width:8px; cursor:ew-resize; z-index:1000; background:linear-gradient(to left, rgba(75,123,129,0.15), transparent);'),
        tl: createHandle('info-pane-resize-corner-tl', 'position:absolute; top:0; left:0; width:12px; height:12px; cursor:nwse-resize; z-index:1001;'),
        tr: createHandle('info-pane-resize-corner-tr', 'position:absolute; top:0; right:0; width:12px; height:12px; cursor:nesw-resize; z-index:1001;'),
        bl: createHandle('info-pane-resize-corner-bl', 'position:absolute; bottom:0; left:0; width:12px; height:12px; cursor:nesw-resize; z-index:1001;')
    };
    
    function createHandle(className, style) {
        var handle = document.createElement('div');
        handle.className = className;
        handle.style.cssText = style;
        pane.appendChild(handle);
        return handle;
    }
    
    var isResizing = false;
    var resizeDirection = '';
    var startX, startY, startWidth, startHeight, startLeft, startTop;
    
    function startResize(e, direction) {
        // Im angedockten Modus nur linken Rand erlauben
        if (pane.classList.contains('docked-right') && direction !== 'left' && direction !== 'tl' && direction !== 'bl') return;
        
        isResizing = true;
        resizeDirection = direction;
        startX = e.clientX;
        startY = e.clientY;
        
        var rect = pane.getBoundingClientRect();
        startWidth = rect.width;
        startHeight = rect.height;
        startLeft = rect.left;
        startTop = rect.top;
        
        document.body.style.userSelect = 'none';
        e.preventDefault();
        e.stopPropagation();
    }
    
    // Mousedown für alle Handles
    handles.top.onmousedown = function(e) { startResize(e, 'top'); };
    handles.bottom.onmousedown = function(e) { startResize(e, 'bottom'); };
    handles.left.onmousedown = function(e) { startResize(e, 'left'); };
    handles.right.onmousedown = function(e) { startResize(e, 'right'); };
    handles.tl.onmousedown = function(e) { startResize(e, 'tl'); };
    handles.tr.onmousedown = function(e) { startResize(e, 'tr'); };
    handles.bl.onmousedown = function(e) { startResize(e, 'bl'); };
    
    // Mousemove Handler
    var mouseMoveHandler = function(e) {
        if (!isResizing) return;
        
        var dx = e.clientX - startX;
        var dy = e.clientY - startY;
        var newWidth = startWidth;
        var newHeight = startHeight;
        
        // Angedockt: nur Breite über linken Rand ändern
        if (pane.classList.contains('docked-right')) {
            if (resizeDirection === 'left' || resizeDirection === 'tl' || resizeDirection === 'bl') {
                newWidth = Math.max(300, Math.min(startWidth - dx, window.innerWidth - 100));
                pane.style.setProperty('width', newWidth + 'px', 'important');
                
                // mapContainer anpassen
                var mapContainer = document.getElementById('mapContainer');
                if (mapContainer && isInfoPaneDocked) {
                    var actualPanelWidth = pane.offsetWidth;
                    mapContainer.style.setProperty('width', 'calc(100% - ' + actualPanelWidth + 'px)', 'important');
                }
            }
            e.preventDefault();
            return;
        }
        
        // Freischwebend: alle Richtungen
        switch(resizeDirection) {
            case 'top':
                newHeight = Math.max(150, startHeight - dy);
                pane.style.setProperty('height', newHeight + 'px', 'important');
                pane.style.setProperty('top', (startTop + dy) + 'px', 'important');
                break;
            case 'bottom':
                newHeight = Math.max(150, startHeight + dy);
                pane.style.setProperty('height', newHeight + 'px', 'important');
                break;
            case 'left':
                newWidth = Math.max(350, startWidth - dx);
                pane.style.setProperty('width', newWidth + 'px', 'important');
                pane.style.setProperty('left', (startLeft + dx) + 'px', 'important');
                break;
            case 'right':
                newWidth = Math.max(350, startWidth + dx);
                pane.style.setProperty('width', newWidth + 'px', 'important');
                break;
            case 'tl':
                newWidth = Math.max(350, startWidth - dx);
                newHeight = Math.max(150, startHeight - dy);
                pane.style.setProperty('width', newWidth + 'px', 'important');
                pane.style.setProperty('height', newHeight + 'px', 'important');
                pane.style.setProperty('left', (startLeft + dx) + 'px', 'important');
                pane.style.setProperty('top', (startTop + dy) + 'px', 'important');
                break;
            case 'tr':
                newWidth = Math.max(350, startWidth + dx);
                newHeight = Math.max(150, startHeight - dy);
                pane.style.setProperty('width', newWidth + 'px', 'important');
                pane.style.setProperty('height', newHeight + 'px', 'important');
                pane.style.setProperty('top', (startTop + dy) + 'px', 'important');
                break;
            case 'bl':
                newWidth = Math.max(350, startWidth - dx);
                newHeight = Math.max(150, startHeight + dy);
                pane.style.setProperty('width', newWidth + 'px', 'important');
                pane.style.setProperty('height', newHeight + 'px', 'important');
                pane.style.setProperty('left', (startLeft + dx) + 'px', 'important');
                break;
            case 'br':
                newWidth = Math.max(350, startWidth + dx);
                newHeight = Math.max(150, startHeight + dy);
                pane.style.setProperty('width', newWidth + 'px', 'important');
                pane.style.setProperty('height', newHeight + 'px', 'important');
                break;
        }
        e.preventDefault();
    };
    
    var mouseUpHandler = function() {
        if (isResizing) {
            // Nach Resize Map aktualisieren falls angedockt
            if (pane.classList.contains('docked-right')) {
                triggerMapUpdate();
            }
            isResizing = false;
            resizeDirection = '';
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    };
    
    // Alte Handler entfernen falls vorhanden
    if (window._infoPaneMouseMove) {
        document.removeEventListener('mousemove', window._infoPaneMouseMove);
    }
    if (window._infoPaneMouseUp) {
        document.removeEventListener('mouseup', window._infoPaneMouseUp);
    }
    
    // Neue Handler speichern und registrieren
    window._infoPaneMouseMove = mouseMoveHandler;
    window._infoPaneMouseUp = mouseUpHandler;
    
    document.addEventListener('mousemove', mouseMoveHandler);
    document.addEventListener('mouseup', mouseUpHandler);
    
    // CSS-Sichtbarkeit wird über CSS gesteuert - die .docked-right Klasse verbirgt die nicht-benötigten Handles automatisch
}

// Info-Panel Inhalt in Zwischenablage kopieren
window.copyInfoPaneToClipboard = function() {
    var content = document.getElementById('njs_info_pane_content');
    if (!content) return;
    
    // Versuche Tabellen-Daten zu extrahieren
    var tables = content.querySelectorAll('table');
    var text = '';
    
    if (tables.length > 0) {
        tables.forEach(function(table, idx) {
            if (idx > 0) text += '\n\n';
            
            // Titel falls vorhanden
            var prevEl = table.previousElementSibling;
            if (prevEl && (prevEl.tagName === 'H3' || prevEl.tagName === 'H4' || prevEl.className.indexOf('title') > -1)) {
                text += prevEl.textContent.trim() + '\n';
                text += '='.repeat(prevEl.textContent.trim().length) + '\n';
            }
            
            var rows = table.querySelectorAll('tr');
            rows.forEach(function(row) {
                var cells = row.querySelectorAll('td, th');
                var rowText = [];
                cells.forEach(function(cell) {
                    rowText.push(cell.textContent.trim());
                });
                text += rowText.join('\t') + '\n';
            });
        });
    } else {
        // Fallback: Nur Text
        text = content.textContent.trim();
    }
    
    // In Zwischenablage kopieren
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function() {
            showCopyNotification('In Zwischenablage kopiert!');
        }).catch(function(err) {
            console.error('Clipboard Error:', err);
            fallbackCopy(text);
        });
    } else {
        fallbackCopy(text);
    }
};

function fallbackCopy(text) {
    var textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
        showCopyNotification('In Zwischenablage kopiert!');
    } catch (err) {
        alert('Kopieren fehlgeschlagen');
    }
    document.body.removeChild(textarea);
}

function showCopyNotification(message) {
    var notification = document.createElement('div');
    notification.textContent = message;
    notification.style.cssText = 'position:fixed;bottom:60px;left:50%;transform:translateX(-50%);background:#4b7b81;color:white;padding:10px 20px;border-radius:4px;z-index:10000;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
    document.body.appendChild(notification);
    setTimeout(function() {
        notification.style.transition = 'opacity 0.3s';
        notification.style.opacity = '0';
        setTimeout(function() {
            document.body.removeChild(notification);
        }, 300);
    }, 2000);
}

// Info-Panel andocken/abdocken
var isInfoPaneDocked = false;
var savedInfoPanePosition = null;

// Hilfsfunktion um Map-Update zu triggern
function triggerMapUpdate() {
    setTimeout(function() {
        // Neapolis/OpenLayers Map
        if (window.njs && njs.AppManager && njs.AppManager.Maps && njs.AppManager.Maps['main']) {
            var mapObj = njs.AppManager.Maps['main'].mapObj;
            if (mapObj && mapObj.updateSize) {
                mapObj.updateSize();
            }
        }
        // Dijit Layout Container neu berechnen
        if (typeof dijit !== 'undefined' && dijit.byId('NeapolisContainer')) {
            dijit.byId('NeapolisContainer').resize();
        }
    }, 350);
}

window.toggleInfoPaneDock = function() {
    var infoPane = document.getElementById('njs_info_pane');
    var dockBtn = document.getElementById('info-pane-dock-btn');
    var mapContainer = document.getElementById('mapContainer');
    if (!infoPane) return;
    
    if (isInfoPaneDocked) {
        // Undock - zurück zur gespeicherten Position oder Default
        infoPane.classList.remove('docked-right');
        
        // Observer stoppen
        stopMapContainerObserver();
        
        // mapContainer wieder auf volle Breite
        if (mapContainer) {
            mapContainer.style.setProperty('width', '100%', 'important');
            setTimeout(function() {
                triggerMapUpdate();
            }, 100);
        }
        
        if (savedInfoPanePosition) {
            infoPane.style.setProperty('top', savedInfoPanePosition.top, 'important');
            infoPane.style.setProperty('left', savedInfoPanePosition.left, 'important');
            infoPane.style.setProperty('width', savedInfoPanePosition.width, 'important');
            infoPane.style.setProperty('height', savedInfoPanePosition.height, 'important');
        } else {
            infoPane.style.setProperty('top', '150px', 'important');
            infoPane.style.setProperty('left', '400px', 'important');
            infoPane.style.setProperty('width', '720px', 'important');
            infoPane.style.setProperty('height', '360px', 'important');
        }
        infoPane.style.setProperty('right', 'auto', 'important');
        infoPane.style.setProperty('bottom', 'auto', 'important');
        infoPane.style.setProperty('position', 'absolute', 'important');
        infoPane.style.maxHeight = '';
        
        if (dockBtn) {
            dockBtn.title = 'Rechts andocken';
            dockBtn.innerHTML = TnetIcons.get('dock');
        }
        isInfoPaneDocked = false;
    } else {
        // Position speichern vor dem Andocken
        savedInfoPanePosition = {
            top: infoPane.style.top || '150px',
            left: infoPane.style.left || '400px',
            width: infoPane.style.width || '720px',
            height: infoPane.style.height || '360px'
        };
        
        // Dock - Panel rechts am centerPaneLayout, mapContainer passt sich an
        infoPane.classList.add('docked-right');
        
        if (mapContainer) {
            // Gespeicherte Breite verwenden falls vorhanden, sonst 350px
            var panelWidth = window._savedDockedPanelWidth || 350;
            var centerPane = document.getElementById('centerPaneLayout');
            var streetviewContainer = document.getElementById('streetviewContainer');
            
            // Berechne den rechten Offset (falls StreetView offen)
            var streetviewWidth = 0;
            if (streetviewContainer && streetviewContainer.offsetWidth > 0 && streetviewContainer.style.display !== 'none') {
                streetviewWidth = streetviewContainer.offsetWidth;
            }
            
            // Panel am rechten Rand positionieren (neben StreetView falls offen)
            var centerRect = centerPane ? centerPane.getBoundingClientRect() : mapContainer.getBoundingClientRect();
            infoPane.style.setProperty('position', 'fixed', 'important');
            infoPane.style.setProperty('top', centerRect.top + 'px', 'important');
            infoPane.style.setProperty('right', streetviewWidth + 'px', 'important');
            infoPane.style.setProperty('bottom', (window.innerHeight - centerRect.bottom) + 'px', 'important');
            infoPane.style.setProperty('left', 'auto', 'important');
            infoPane.style.setProperty('width', panelWidth + 'px', 'important');
            infoPane.style.setProperty('height', 'auto', 'important');
            
            // mapContainer verkleinern: Absolute Berechnung
            var centerPaneWidth = centerPane ? centerPane.offsetWidth : window.innerWidth;
            var mapWidth = centerPaneWidth - streetviewWidth - panelWidth;
            mapContainer.style.setProperty('width', mapWidth + 'px', 'important');
            triggerMapUpdate();
        }
        
        // Observer für Layout-Änderungen starten (passt Panel an wenn StreetView etc. geöffnet wird)
        startMapContainerObserver();
        
        if (dockBtn) {
            dockBtn.title = 'Floating';
            dockBtn.innerHTML = TnetIcons.get('undock');
        }
        isInfoPaneDocked = true;
    }
    
    // Container-Breite bei Panel-Resize synchron halten
    updateContainerForInfoPane();
};

// Observer für Layout-Änderungen (z.B. wenn StreetView geöffnet wird)
var mapContainerObserver = null;
var streetviewObserver = null;
function startMapContainerObserver() {
    if (mapContainerObserver) mapContainerObserver.disconnect();
    if (streetviewObserver) streetviewObserver.disconnect();
    
    var mapContainer = document.getElementById('mapContainer');
    var streetviewContainer = document.getElementById('streetviewContainer');
    var infoPane = document.getElementById('njs_info_pane');
    if (!mapContainer || !infoPane) return;
    
    // ResizeObserver für Größenänderungen des mapContainer
    if (window.ResizeObserver) {
        mapContainerObserver = new ResizeObserver(function() {
            if (!isInfoPaneDocked) return;
            updateDockedInfoPanePosition();
        });
        mapContainerObserver.observe(mapContainer);
        
        // Auch streetviewContainer beobachten
        if (streetviewContainer) {
            streetviewObserver = new ResizeObserver(function() {
                if (!isInfoPaneDocked) return;
                updateDockedInfoPanePosition();
            });
            streetviewObserver.observe(streetviewContainer);
        }
    }
    
    // Auch auf Window-Resize reagieren
    window.addEventListener('resize', updateDockedInfoPanePosition);
}

function stopMapContainerObserver() {
    if (mapContainerObserver) {
        mapContainerObserver.disconnect();
        mapContainerObserver = null;
    }
    if (streetviewObserver) {
        streetviewObserver.disconnect();
        streetviewObserver = null;
    }
    window.removeEventListener('resize', updateDockedInfoPanePosition);
}

function updateDockedInfoPanePosition() {
    if (!isInfoPaneDocked) return;
    var mapContainer = document.getElementById('mapContainer');
    var infoPane = document.getElementById('njs_info_pane');
    var centerPane = document.getElementById('centerPaneLayout');
    var streetviewContainer = document.getElementById('streetviewContainer');
    if (!mapContainer || !infoPane) return;
    
    var panelWidth = window._savedDockedPanelWidth || infoPane.offsetWidth || 350;
    
    // Berechne den rechten Offset (falls StreetView offen)
    var streetviewWidth = 0;
    if (streetviewContainer && streetviewContainer.offsetWidth > 0 && streetviewContainer.style.display !== 'none') {
        streetviewWidth = streetviewContainer.offsetWidth;
    }
    
    // Panel-Position aktualisieren - rechts neben StreetView
    var centerRect = centerPane ? centerPane.getBoundingClientRect() : { top: 69, bottom: window.innerHeight - 32 };
    infoPane.style.setProperty('top', centerRect.top + 'px', 'important');
    infoPane.style.setProperty('right', streetviewWidth + 'px', 'important');
    infoPane.style.setProperty('bottom', (window.innerHeight - centerRect.bottom) + 'px', 'important');
    infoPane.style.setProperty('width', panelWidth + 'px', 'important');
    
    // mapContainer-Breite: Absolute Berechnung
    // Verfügbare Breite = centerPaneLayout.width - streetviewWidth - panelWidth
    var centerPaneWidth = centerPane ? centerPane.offsetWidth : window.innerWidth;
    var mapWidth = centerPaneWidth - streetviewWidth - panelWidth;
    mapContainer.style.setProperty('width', mapWidth + 'px', 'important');
    
    triggerMapUpdate();
}

// Funktion um Panel-Position bei Resize zu aktualisieren (ohne Container zu ändern)
function updateContainerForInfoPane() {
    // Nichts zu tun - mapContainer wird nicht mehr verändert
    // Panel passt sich automatisch über updateDockedInfoPanePosition an
}

// ===== LEGEND PANE ERWEITERUNGEN =====
// Legenden-Popup identisch zum Info-Panel stylen
// Custom Titelbar mit Titel + Close-Button, Positionierung unter Header
function initLegendPaneEnhancements() {
    function isMobile() { return !!window.__TNET_MOBILE_ENTRY; }

    function enhanceLegendPane() {
        var legendPane = document.getElementById('njs_floatlegend_pane');
        if (!legendPane) return false;

        var titleBar = legendPane.querySelector('.dojoxFloatingPaneTitle');
        if (!titleBar) return false;

        // Prüfe ob Custom-Titlebar bereits vorhanden
        if (titleBar.querySelector('.legend-pane-custom-title')) {
            ensureLegendBelowHeader(legendPane);
            return true;
        }

        // Titel aus dem Dojo-TitleNode lesen
        var titleText = 'Legende';
        var titleNode = titleBar.querySelector('.dijitTitleNode');
        if (titleNode) {
            var td = titleNode.querySelector('td');
            if (td) {
                var _t = (td.textContent || '').trim();
                if (_t && _t.length < 120) titleText = _t;
            } else {
                var _t2 = (titleNode.textContent || '').trim();
                if (_t2 && _t2.indexOf('<') === -1 && _t2.length < 120) titleText = _t2;
            }
        }

        // ── Custom Titelbar: Dojo-Kinder leeren, unseren Inhalt einsetzen ─────
        // titleBar NICHT entfernen — Dojo berechnet offsetHeight für contentInfo
        while (titleBar.firstChild) { titleBar.removeChild(titleBar.firstChild); }

        // Dojo Inline-Styles überschreiben
        titleBar.style.setProperty('text-align', 'left', 'important');
        titleBar.style.setProperty('justify-content', 'flex-start', 'important');
        titleBar.style.setProperty('position', 'relative', 'important');
        titleBar.style.setProperty('width', '100%', 'important');

        // Titel-Span
        var titleSpan = document.createElement('span');
        titleSpan.className = 'legend-pane-custom-title';
        titleSpan.textContent = titleText;

        // Actions Container
        var actions = document.createElement('div');
        actions.className = 'legend-pane-actions';

        // Dock Button (nur Desktop)
        if (!isMobile()) {
            var dockBtn = document.createElement('button');
            dockBtn.id = 'legend-pane-dock-btn';
            dockBtn.className = 'legend-pane-btn';
            dockBtn.title = 'Rechts andocken';
            dockBtn.innerHTML = TnetIcons.get('dock');
            dockBtn.onmousedown = function(e) { e.stopPropagation(); };
            dockBtn.onclick = function(e) {
                e.stopPropagation();
                if (window.toggleLegendPaneDock) window.toggleLegendPaneDock();
            };
            actions.appendChild(dockBtn);
        }

        // Close Button
        var closeBtn = document.createElement('button');
        closeBtn.className = 'legend-pane-btn legend-pane-close';
        closeBtn.title = 'Schliessen';
        closeBtn.innerHTML = TnetIcons.get('close');
        closeBtn.onmousedown = function(e) { e.stopPropagation(); };
        closeBtn.onclick = function(e) {
            e.stopPropagation();
            // Falls angedockt, zuerst abdocken
            if (window._isLegendPaneDocked) {
                window.toggleLegendPaneDock();
            }
            var widget = (typeof dijit !== 'undefined') ? dijit.byId('njs_floatlegend_pane') : null;
            if (widget && widget.close) {
                widget.close();
            } else {
                legendPane.style.visibility = 'hidden';
            }
        };

        actions.appendChild(closeBtn);
        titleBar.appendChild(titleSpan);
        titleBar.appendChild(actions);

        // Dojo-Schatten und Resize-Dreieck per JS entfernen
        legendPane.style.setProperty('border', 'none', 'important');
        var resizeHandle = legendPane.querySelector('.dojoxFloatingResizeHandle');
        if (resizeHandle) {
            resizeHandle.parentNode.removeChild(resizeHandle);
        }

        // Custom Resize-Handles hinzufügen (nur Desktop)
        if (!isMobile()) {
            initLegendPaneResize(legendPane);
        }

        // Unter Header positionieren
        ensureLegendBelowHeader(legendPane);

        return true;
    }

    // Legend-Pane unter Header positionieren (69px Header + 11px Puffer)
    function ensureLegendBelowHeader(legendPane) {
        if (!legendPane || isMobile()) return;
        requestAnimationFrame(function() {
            var rect = legendPane.getBoundingClientRect();
            if (rect.top < 80) {
                var currentTop = parseInt(legendPane.style.top) || 0;
                var delta = 80 - rect.top;
                legendPane.style.setProperty('top', (currentTop + delta) + 'px', 'important');
            }
        });
    }

    // Initial versuchen
    enhanceLegendPane();

    // MutationObserver: UI-Elemente hinzufügen wenn Legende geöffnet wird
    var observer = new MutationObserver(function(mutations) {
        for (var i = 0; i < mutations.length; i++) {
            var m = mutations[i];
            if (m.type === 'attributes' && m.attributeName === 'style') {
                var legendPane = document.getElementById('njs_floatlegend_pane');
                if (legendPane && legendPane.style.visibility === 'visible') {
                    enhanceLegendPane();
                }
            }
            if (m.type === 'childList' && m.addedNodes.length) {
                for (var j = 0; j < m.addedNodes.length; j++) {
                    var node = m.addedNodes[j];
                    if (node.id === 'njs_floatlegend_pane' || (node.querySelector && node.querySelector('#njs_floatlegend_pane'))) {
                        setTimeout(enhanceLegendPane, 100);
                    }
                }
            }
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style']
    });
}

// Legend-Pane Initialisierung
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLegendPaneEnhancements);
} else {
    initLegendPaneEnhancements();
}

// ===== LEGEND PANE RESIZE =====
// Resize-Handles für Legend-Pane (identisch zu Info-Pane, ohne Dock-Logik)
function initLegendPaneResize(pane) {
    // Bestehende Resize-Handles entfernen (falls vorhanden)
    var existingHandles = pane.querySelectorAll('[class*="legend-pane-resize"]');
    existingHandles.forEach(function(h) { h.remove(); });

    function createHandle(className, style) {
        var handle = document.createElement('div');
        handle.className = className;
        handle.style.cssText = style;
        pane.appendChild(handle);
        return handle;
    }

    // Alle Resize-Handles erstellen
    var handles = {
        top: createHandle('legend-pane-resize-top', 'position:absolute; top:0; left:0; right:0; height:6px; cursor:ns-resize; z-index:1100;'),
        bottom: createHandle('legend-pane-resize-bottom', 'position:absolute; bottom:0; left:0; right:0; height:6px; cursor:ns-resize; z-index:1100;'),
        left: createHandle('legend-pane-resize-left', 'position:absolute; left:0; top:0; bottom:0; width:8px; cursor:ew-resize; z-index:1100;'),
        right: createHandle('legend-pane-resize-right', 'position:absolute; right:0; top:0; bottom:0; width:8px; cursor:ew-resize; z-index:1100;'),
        tl: createHandle('legend-pane-resize-corner-tl', 'position:absolute; top:0; left:0; width:12px; height:12px; cursor:nwse-resize; z-index:1101;'),
        tr: createHandle('legend-pane-resize-corner-tr', 'position:absolute; top:0; right:0; width:12px; height:12px; cursor:nesw-resize; z-index:1101;'),
        bl: createHandle('legend-pane-resize-corner-bl', 'position:absolute; bottom:0; left:0; width:12px; height:12px; cursor:nesw-resize; z-index:1101;'),
        br: createHandle('legend-pane-resize-corner-br', 'position:absolute; bottom:0; right:0; width:20px; height:20px; cursor:nwse-resize; z-index:1101;')
    };

    var isResizing = false;
    var resizeDirection = '';
    var startX, startY, startWidth, startHeight, startLeft, startTop;

    function startResize(e, direction) {
        isResizing = true;
        resizeDirection = direction;
        startX = e.clientX;
        startY = e.clientY;

        var rect = pane.getBoundingClientRect();
        startWidth = rect.width;
        startHeight = rect.height;
        startLeft = rect.left;
        startTop = rect.top;

        document.body.style.userSelect = 'none';
        e.preventDefault();
        e.stopPropagation();
    }

    // Mousedown für alle Handles
    handles.top.onmousedown = function(e) { startResize(e, 'top'); };
    handles.bottom.onmousedown = function(e) { startResize(e, 'bottom'); };
    handles.left.onmousedown = function(e) { startResize(e, 'left'); };
    handles.right.onmousedown = function(e) { startResize(e, 'right'); };
    handles.tl.onmousedown = function(e) { startResize(e, 'tl'); };
    handles.tr.onmousedown = function(e) { startResize(e, 'tr'); };
    handles.bl.onmousedown = function(e) { startResize(e, 'bl'); };
    handles.br.onmousedown = function(e) { startResize(e, 'br'); };

    // Mousemove Handler
    var mouseMoveHandler = function(e) {
        if (!isResizing) return;

        var dx = e.clientX - startX;
        var dy = e.clientY - startY;
        var newWidth, newHeight;

        switch(resizeDirection) {
            case 'top':
                newHeight = Math.max(150, startHeight - dy);
                pane.style.setProperty('height', newHeight + 'px', 'important');
                pane.style.setProperty('top', (startTop + dy) + 'px', 'important');
                break;
            case 'bottom':
                newHeight = Math.max(150, startHeight + dy);
                pane.style.setProperty('height', newHeight + 'px', 'important');
                break;
            case 'left':
                newWidth = Math.max(350, startWidth - dx);
                pane.style.setProperty('width', newWidth + 'px', 'important');
                pane.style.setProperty('left', (startLeft + dx) + 'px', 'important');
                break;
            case 'right':
                newWidth = Math.max(350, startWidth + dx);
                pane.style.setProperty('width', newWidth + 'px', 'important');
                break;
            case 'tl':
                newWidth = Math.max(350, startWidth - dx);
                newHeight = Math.max(150, startHeight - dy);
                pane.style.setProperty('width', newWidth + 'px', 'important');
                pane.style.setProperty('height', newHeight + 'px', 'important');
                pane.style.setProperty('left', (startLeft + dx) + 'px', 'important');
                pane.style.setProperty('top', (startTop + dy) + 'px', 'important');
                break;
            case 'tr':
                newWidth = Math.max(350, startWidth + dx);
                newHeight = Math.max(150, startHeight - dy);
                pane.style.setProperty('width', newWidth + 'px', 'important');
                pane.style.setProperty('height', newHeight + 'px', 'important');
                pane.style.setProperty('top', (startTop + dy) + 'px', 'important');
                break;
            case 'bl':
                newWidth = Math.max(350, startWidth - dx);
                newHeight = Math.max(150, startHeight + dy);
                pane.style.setProperty('width', newWidth + 'px', 'important');
                pane.style.setProperty('height', newHeight + 'px', 'important');
                pane.style.setProperty('left', (startLeft + dx) + 'px', 'important');
                break;
            case 'br':
                newWidth = Math.max(350, startWidth + dx);
                newHeight = Math.max(150, startHeight + dy);
                pane.style.setProperty('width', newWidth + 'px', 'important');
                pane.style.setProperty('height', newHeight + 'px', 'important');
                break;
        }
        e.preventDefault();
    };

    var mouseUpHandler = function() {
        if (isResizing) {
            isResizing = false;
            resizeDirection = '';
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    };

    // Alte Handler entfernen falls vorhanden
    if (window._legendPaneMouseMove) {
        document.removeEventListener('mousemove', window._legendPaneMouseMove);
    }
    if (window._legendPaneMouseUp) {
        document.removeEventListener('mouseup', window._legendPaneMouseUp);
    }

    // Neue Handler speichern und registrieren
    window._legendPaneMouseMove = mouseMoveHandler;
    window._legendPaneMouseUp = mouseUpHandler;
    document.addEventListener('mousemove', mouseMoveHandler);
    document.addEventListener('mouseup', mouseUpHandler);
}

// ===== LEGEND PANE DOCK FUNKTIONALITÄT =====
// Andockbar analog zum Info-Panel
(function() {
    'use strict';

    window._isLegendPaneDocked = false;
    var _savedLegendPosition = null;
    var _legendDockObserver = null;

    function triggerMapUpdate() {
        setTimeout(function() {
            if (window.njs && njs.AppManager && njs.AppManager.Maps && njs.AppManager.Maps['main']) {
                var mapObj = njs.AppManager.Maps['main'].mapObj;
                if (mapObj && mapObj.updateSize) mapObj.updateSize();
            }
        }, 50);
    }

    window.toggleLegendPaneDock = function() {
        var legendPane = document.getElementById('njs_floatlegend_pane');
        var dockBtn = document.getElementById('legend-pane-dock-btn');
        var mapContainer = document.getElementById('mapContainer');
        var centerPane = document.getElementById('centerPaneLayout');
        if (!legendPane) return;

        if (window._isLegendPaneDocked) {
            // === UNDOCK ===
            legendPane.classList.remove('legend-docked-right');

            // Observer stoppen
            if (_legendDockObserver) {
                _legendDockObserver.disconnect();
                _legendDockObserver = null;
            }
            window.removeEventListener('resize', _updateDockedLegendPosition);

            // mapContainer wieder auf volle Breite
            if (mapContainer) {
                mapContainer.style.setProperty('width', '100%', 'important');
                triggerMapUpdate();
            }

            // Position wiederherstellen
            if (_savedLegendPosition) {
                legendPane.style.setProperty('position', 'absolute', 'important');
                legendPane.style.setProperty('top', _savedLegendPosition.top, 'important');
                legendPane.style.setProperty('left', _savedLegendPosition.left, 'important');
                legendPane.style.setProperty('width', _savedLegendPosition.width, 'important');
                legendPane.style.setProperty('height', _savedLegendPosition.height, 'important');
                legendPane.style.setProperty('right', 'auto', 'important');
                legendPane.style.setProperty('bottom', 'auto', 'important');
            }

            // Resize Handle Visibility: alle wieder sichtbar
            var allHandles = legendPane.querySelectorAll('[class*="legend-pane-resize"]');
            allHandles.forEach(function(h) { h.style.display = ''; });

            if (dockBtn) {
                dockBtn.title = 'Rechts andocken';
                dockBtn.innerHTML = TnetIcons.get('dock');
            }
            window._isLegendPaneDocked = false;

        } else {
            // === DOCK ===
            // Position speichern
            _savedLegendPosition = {
                top: legendPane.style.top || '80px',
                left: legendPane.style.left || '100px',
                width: legendPane.style.width || '400px',
                height: legendPane.style.height || '500px'
            };

            legendPane.classList.add('legend-docked-right');

            var panelWidth = window._savedLegendDockedWidth || 380;
            var streetviewContainer = document.getElementById('streetviewContainer');
            var streetviewWidth = 0;
            if (streetviewContainer && streetviewContainer.offsetWidth > 0 && streetviewContainer.style.display !== 'none') {
                streetviewWidth = streetviewContainer.offsetWidth;
            }

            var centerRect = centerPane ? centerPane.getBoundingClientRect() : { top: 69, bottom: window.innerHeight - 32 };

            legendPane.style.setProperty('position', 'fixed', 'important');
            legendPane.style.setProperty('top', centerRect.top + 'px', 'important');
            legendPane.style.setProperty('right', streetviewWidth + 'px', 'important');
            legendPane.style.setProperty('bottom', (window.innerHeight - centerRect.bottom) + 'px', 'important');
            legendPane.style.setProperty('left', 'auto', 'important');
            legendPane.style.setProperty('width', panelWidth + 'px', 'important');
            legendPane.style.setProperty('height', 'auto', 'important');

            // mapContainer verkleinern
            if (mapContainer && centerPane) {
                var centerPaneWidth = centerPane.offsetWidth;
                var mapWidth = centerPaneWidth - streetviewWidth - panelWidth;
                mapContainer.style.setProperty('width', mapWidth + 'px', 'important');
                triggerMapUpdate();
            }

            // Resize Handles: nur linken Rand sichtbar lassen
            var allHandles = legendPane.querySelectorAll('[class*="legend-pane-resize"]');
            allHandles.forEach(function(h) {
                if (h.className.indexOf('left') !== -1) {
                    h.style.display = '';
                } else {
                    h.style.display = 'none';
                }
            });

            // ResizeObserver für Layout-Änderungen
            if (window.ResizeObserver && mapContainer) {
                _legendDockObserver = new ResizeObserver(function() {
                    if (!window._isLegendPaneDocked) return;
                    _updateDockedLegendPosition();
                });
                _legendDockObserver.observe(mapContainer);
            }
            window.addEventListener('resize', _updateDockedLegendPosition);

            if (dockBtn) {
                dockBtn.title = 'Floating';
                dockBtn.innerHTML = TnetIcons.get('undock');
            }
            window._isLegendPaneDocked = true;
        }
    };

    function _updateDockedLegendPosition() {
        if (!window._isLegendPaneDocked) return;
        var legendPane = document.getElementById('njs_floatlegend_pane');
        var mapContainer = document.getElementById('mapContainer');
        var centerPane = document.getElementById('centerPaneLayout');
        var streetviewContainer = document.getElementById('streetviewContainer');
        if (!legendPane || !mapContainer) return;

        var panelWidth = window._savedLegendDockedWidth || legendPane.offsetWidth || 380;
        var streetviewWidth = 0;
        if (streetviewContainer && streetviewContainer.offsetWidth > 0 && streetviewContainer.style.display !== 'none') {
            streetviewWidth = streetviewContainer.offsetWidth;
        }

        var centerRect = centerPane ? centerPane.getBoundingClientRect() : { top: 69, bottom: window.innerHeight - 32 };
        legendPane.style.setProperty('top', centerRect.top + 'px', 'important');
        legendPane.style.setProperty('right', streetviewWidth + 'px', 'important');
        legendPane.style.setProperty('bottom', (window.innerHeight - centerRect.bottom) + 'px', 'important');
        legendPane.style.setProperty('width', panelWidth + 'px', 'important');

        var centerPaneWidth = centerPane ? centerPane.offsetWidth : window.innerWidth;
        var mapWidth = centerPaneWidth - streetviewWidth - panelWidth;
        mapContainer.style.setProperty('width', mapWidth + 'px', 'important');
        triggerMapUpdate();
    }

    // Gespeicherte Dock-Breite global verfügbar machen
    window._savedLegendDockedWidth = 380;
})();
