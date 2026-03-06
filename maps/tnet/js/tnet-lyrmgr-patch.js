/**
 * tnet-lyrmgr-patch.js
 * Monkey-Patch für ClassicLayerMgr: echte DOM-Verschachtelung
 * der Sub-Kategorien (TitlePanes) statt flacher Anordnung.
 *
 * Problem: njs.LayerMgr wird per Dojo AMD geladen und existiert
 * erst NACH initApp(). Deshalb nutzen wir Object.defineProperty
 * als Trap: sobald njs.LayerMgr zugewiesen wird, fangen wir
 * auch ClassicLayerCategory ab und patchen den Prototype per
 * Microtask (Promise.resolve().then) — BEVOR der Code die
 * Klasse verwendet um TitlePanes zu bauen.
 *
 * Konfiguration: In lyrmgr.conf "nested": true setzen.
 *
 * Muss NACH njs.js und VOR modules.js geladen werden.
 *
 * @version    25.0
 * @date       2026-03-04
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */
(function() {
  'use strict';

  var LOG = '[LyrMgr-Nested]';
  var _patched = false;
  var _groupVisibilitySnapshots = {};
  var _suppressGroupCheckboxClick = false;
  var _suppressLayerRefresh = false;

  function isLegacyNestedCssEnabled() {
    try {
      if (window.__tnetLMFlags && typeof window.__tnetLMFlags.useLegacyNestedHierarchyStyle === 'boolean') {
        return !!window.__tnetLMFlags.useLegacyNestedHierarchyStyle;
      }
      if (window.TnetGlobalConfig && window.TnetGlobalConfig.layerManager) {
        var lmCfg = window.TnetGlobalConfig.layerManager;
        return !!(lmCfg.useLegacyNestedHierarchyStyle || lmCfg.useExtendedLegacyHierarchy || lmCfg.legacyNestedHierarchyStyle);
      }
    } catch (e) {}
    return false;
  }

  function applyLegacyNestedCssScope() {
    if (!document.body) return false;
    var enabled = isLegacyNestedCssEnabled();
    if (enabled) {
      document.body.classList.add('tnet-lm-legacy-nested');
    } else {
      document.body.classList.remove('tnet-lm-legacy-nested');
    }
    return true;
  }

  function watchLegacyNestedCssScope() {
    var tries = 0;
    var timer = setInterval(function() {
      tries++;
      applyLegacyNestedCssScope();
      if (tries > 150) clearInterval(timer);
      if (window.__tnetLMFlags && typeof window.__tnetLMFlags.useLegacyNestedHierarchyStyle === 'boolean' && document.body) {
        clearInterval(timer);
      }
    }, 100);
  }

  window.TnetDumpNestedCss = function() {
    var rows = [];
    var panes = document.querySelectorAll('#layer_menu .dijitTitlePane[data-lyrmgr-depth]');
    panes.forEach(function(node, index) {
      var titleNode = node.querySelector('.dijitTitlePaneTitle');
      var labelNode = node.querySelector('.appendtitle');
      var contentNode = node.querySelector('.dijitTitlePaneContentOuter');
      var cs = titleNode ? window.getComputedStyle(titleNode) : null;
      rows.push({
        i: index,
        depth: node.getAttribute('data-lyrmgr-depth') || '-',
        id: node.id || '-',
        label: labelNode ? (labelNode.textContent || '').trim() : '-',
        openClass: node.classList.contains('lyrmgr-open') ? 'open' : 'closed',
        bg: cs ? cs.backgroundColor : '-',
        titlePaddingLeft: cs ? cs.paddingLeft : '-',
        titleBorderLeftColor: cs ? cs.borderLeftColor : '-',
        titleBorderLeftWidth: cs ? cs.borderLeftWidth : '-',
        borderLeft: window.getComputedStyle(node).borderLeftColor,
        paneBorderLeftWidth: window.getComputedStyle(node).borderLeftWidth,
        paneBorderLeftStyle: window.getComputedStyle(node).borderLeftStyle,
        marginLeft: window.getComputedStyle(node).marginLeft,
        contentDisplay: contentNode ? window.getComputedStyle(contentNode).display : '-',
        contentHeight: contentNode ? window.getComputedStyle(contentNode).height : '-'
      });
    });
    console.group(LOG + ' CSS-Dump');
    console.log('featureFlag(useLegacyNestedHierarchyStyle)=', isLegacyNestedCssEnabled());
    console.log('bodyClass contains tnet-lm-legacy-nested =', document.body && document.body.classList.contains('tnet-lm-legacy-nested'));
    console.table(rows);
    console.groupEnd();
    return rows;
  };

  if (typeof njs === 'undefined') {
    console.error(LOG, 'njs nicht definiert! Patch übersprungen.');
    return;
  }

  applyLegacyNestedCssScope();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyLegacyNestedCssScope, { once: true });
  }
  watchLegacyNestedCssScope();

  console.log(LOG, 'v25 geladen — installiere Property-Traps');

  // ===== TRAP 1: njs.LayerMgr Zuweisung abfangen =====
  var _realLM = njs.LayerMgr; // undefined aktuell

  try {
    Object.defineProperty(njs, 'LayerMgr', {
      get: function() { return _realLM; },
      set: function(val) {
        _realLM = val;
        if (val && (typeof val === 'function' || typeof val === 'object') && !_patched) {
          console.log(LOG, 'njs.LayerMgr gesetzt (Typ: ' + typeof val + ')');
          trapClassicLayerCategory(val);
        }
      },
      configurable: true,
      enumerable: true
    });
  } catch (e) {
    console.warn(LOG, 'defineProperty auf njs.LayerMgr fehlgeschlagen:', e);
    startPolling();
    return;
  }

  // Falls bereits gesetzt (unwahrscheinlich laut Console)
  if (_realLM) {
    console.log(LOG, 'njs.LayerMgr existiert bereits');
    trapClassicLayerCategory(_realLM);
  }

  // ===== TRAP 2: ClassicLayerCategory Zuweisung abfangen =====
  function trapClassicLayerCategory(lm) {
    // Bereits vorhanden?
    if (lm.ClassicLayerCategory && lm.ClassicLayerCategory.prototype) {
      console.log(LOG, 'ClassicLayerCategory existiert bereits');
      schedulePatching(lm.ClassicLayerCategory);
      return;
    }

    // Trap auf ClassicLayerCategory Property
    var _realCLC;
    try {
      Object.defineProperty(lm, 'ClassicLayerCategory', {
        get: function() { return _realCLC; },
        set: function(val) {
          _realCLC = val;
          if (val && typeof val === 'function' && !_patched) {
            console.log(LOG, 'ClassicLayerCategory gesetzt');
            schedulePatching(val);
          }
        },
        configurable: true,
        enumerable: true
      });
    } catch (e) {
      console.warn(LOG, 'defineProperty auf ClassicLayerCategory fehlgeschlagen:', e);
      startPolling();
    }
  }

  // ===== MICROTASK: Patching nach allen synchronen prototype-Zuweisungen =====
  function schedulePatching(CLC) {
    // Promise.resolve().then → Microtask: läuft nach dem synchronen
    // Code-Block der die Prototype-Methoden zuweist, aber BEVOR
    // der nächste Macrotask (setTimeout, XHR-Callback) feuert.
    Promise.resolve().then(function() {
      if (_patched) return;
      if (!CLC.prototype || !CLC.prototype._buildContentSubCat || !CLC.prototype._build) {
        console.warn(LOG, 'Prototype-Methoden fehlen — Polling-Fallback');
        startPolling();
        return;
      }
      _patched = true;
      applyPatches(CLC.prototype);
    });
  }

  // ===== FALLBACK: Polling (falls defineProperty nicht funktioniert) =====
  function startPolling() {
    if (_patched) return;
    console.log(LOG, 'Starte Polling-Fallback (50ms Intervall)...');
    var checks = 0;
    var timer = setInterval(function() {
      checks++;
      if (_patched || checks > 200) {
        clearInterval(timer);
        if (!_patched) console.error(LOG, 'Timeout nach 10s — ClassicLayerCategory nicht gefunden');
        return;
      }
      try {
        var lm = njs.LayerMgr;
        if (lm &&
            lm.ClassicLayerCategory &&
            lm.ClassicLayerCategory.prototype &&
            lm.ClassicLayerCategory.prototype._buildContentSubCat) {
          _patched = true;
          clearInterval(timer);
          console.log(LOG, 'Polling: ClassicLayerCategory gefunden (' + (checks * 50) + 'ms)');
          applyPatches(lm.ClassicLayerCategory.prototype);
        }
      } catch (e) { /* weiter warten */ }
    }, 50);
  }

  // ===== PATCHES ANWENDEN =====
  function applyPatches(proto) {
    console.log(LOG, 'Wende Patches an...');

    function getLayerManagerRoot(scope) {
      try {
        if (!window.njs || !njs.AppManager || !njs.AppManager.LyrMgr) return null;
        return njs.AppManager.LyrMgr[scope.id_lyr_mgr] || null;
      } catch (e) {
        return null;
      }
    }

    function getLayerChecked(layer) {
      if (!layer) return false;
      var widget = (window.dijit && layer.name) ? dijit.byId(layer.name) : null;
      if (widget && typeof widget.get === 'function') return !!widget.get('checked');
      return !!layer.visible;
    }

    function collectDescendantLayers(category, out) {
      if (!category || !out) return;
      if (category.arLayers && category.arLayers.length) {
        category.arLayers.forEach(function(lay) { out.push(lay); });
      }
      if (category.arCategories && category.arCategories.length) {
        category.arCategories.forEach(function(subCat) {
          collectDescendantLayers(subCat, out);
        });
      }
    }

    function collectLayerStats(category, allowVisible) {
      var list = [];
      collectDescendantLayers(category, list);
      var checked = 0;
      for (var i = 0; i < list.length; i++) {
        if (allowVisible && getLayerChecked(list[i])) checked++;
      }
      return {
        checked: checked,
        total: list.length
      };
    }

    function findCategoryById(category, groupId) {
      if (!category) return null;
      if (category.id === groupId) return category;
      if (!category.arCategories || !category.arCategories.length) return null;
      for (var i = 0; i < category.arCategories.length; i++) {
        var found = findCategoryById(category.arCategories[i], groupId);
        if (found) return found;
      }
      return null;
    }

    function findCategoryInManager(scope, groupId) {
      if (!groupId) return null;

      var mgr = getLayerManagerRoot(scope);
      if (mgr && mgr.arCategories && mgr.arCategories.length) {
        for (var i = 0; i < mgr.arCategories.length; i++) {
          var hit = findCategoryById(mgr.arCategories[i], groupId);
          if (hit) return hit;
        }
      }

      return findCategoryById(scope, groupId);
    }

    function findLayerByName(category, layerName) {
      if (!category || !layerName) return null;

      if (category.arLayers && category.arLayers.length) {
        for (var i = 0; i < category.arLayers.length; i++) {
          if (category.arLayers[i] && category.arLayers[i].name === layerName) {
            return category.arLayers[i];
          }
        }
      }

      if (category.arCategories && category.arCategories.length) {
        for (var j = 0; j < category.arCategories.length; j++) {
          var found = findLayerByName(category.arCategories[j], layerName);
          if (found) return found;
        }
      }

      return null;
    }

    function findLayerInManager(scope, layerName) {
      var mgr = getLayerManagerRoot(scope);
      if (mgr && mgr.arCategories && mgr.arCategories.length) {
        for (var i = 0; i < mgr.arCategories.length; i++) {
          var hit = findLayerByName(mgr.arCategories[i], layerName);
          if (hit) return hit;
        }
      }
      return findLayerByName(scope, layerName);
    }

    function collectAncestorPathForLayer(category, layerName, pathOut) {
      if (!category || !layerName || !pathOut) return false;

      if (category.arLayers && category.arLayers.length) {
        for (var i = 0; i < category.arLayers.length; i++) {
          if (category.arLayers[i] && category.arLayers[i].name === layerName) {
            pathOut.unshift(category);
            return true;
          }
        }
      }

      if (category.arCategories && category.arCategories.length) {
        for (var j = 0; j < category.arCategories.length; j++) {
          if (collectAncestorPathForLayer(category.arCategories[j], layerName, pathOut)) {
            pathOut.unshift(category);
            return true;
          }
        }
      }

      return false;
    }

    function findAncestorCategoriesInManager(scope, layerName) {
      var path = [];
      var mgr = getLayerManagerRoot(scope);

      if (mgr && mgr.arCategories && mgr.arCategories.length) {
        for (var i = 0; i < mgr.arCategories.length; i++) {
          if (collectAncestorPathForLayer(mgr.arCategories[i], layerName, path)) {
            return path;
          }
        }
      }

      collectAncestorPathForLayer(scope, layerName, path);
      return path;
    }

    function removeLayerIfPossible(layer) {
      if (!layer || typeof layer.removeLayer !== 'function') return;
      try {
        layer.removeLayer();
      } catch (e) {}
    }

    function setCheckboxVisualState(checkboxWidget, state) {
      if (!checkboxWidget || !checkboxWidget.domNode || !window.dojo) return;
      var node = checkboxWidget.domNode;
      var isChecked = (state === 'all' || state === 'mixed');

      _suppressGroupCheckboxClick = true;
      try {
        checkboxWidget.set('checked', isChecked);
      } finally {
        _suppressGroupCheckboxClick = false;
      }

      dojo.removeClass(node, 'tmpdirCheckBox');
      dojo.removeClass(node, 'tmpdirCheckBoxMixed');
      dojo.removeClass(node, 'dijitMixed');
      dojo.removeClass(node, 'dijitCheckBoxChecked');
      dojo.removeClass(node, 'dijitChecked');
      dojo.addClass(node, 'dijitCheckBox');

      if (state === 'all') {
        dojo.addClass(node, 'dijitCheckBoxChecked');
        dojo.addClass(node, 'dijitChecked');
      } else if (state === 'mixed') {
        dojo.addClass(node, 'tmpdirCheckBox');
        dojo.addClass(node, 'tmpdirCheckBoxMixed');
        dojo.addClass(node, 'dijitMixed');
      }
    }

    function deriveCategoryState(category) {
      var stats = collectLayerStats(category, true);
      if (stats.total > 0) {
        if (stats.checked === 0) return 'none';
        if (stats.checked === stats.total) return 'all';
        return 'mixed';
      }

      if (category && category.arCategories && category.arCategories.length) {
        var hasAnyActive = false;
        var allActive = true;

        for (var i = 0; i < category.arCategories.length; i++) {
          var subState = deriveCategoryState(category.arCategories[i]);
          if (subState === 'mixed') return 'mixed';
          if (subState === 'all') {
            hasAnyActive = true;
          } else {
            allActive = false;
            if (subState !== 'none') hasAnyActive = true;
          }
        }

        if (allActive) return 'all';
        if (hasAnyActive) return 'mixed';
        return 'none';
      }

      if (category && category.checkBoxAll && typeof category.checkBoxAll.get === 'function') {
        return category.checkBoxAll.get('checked') ? 'all' : 'none';
      }

      return 'none';
    }

    function refreshCategoryCheckboxState(category) {
      if (!category) return;

      if (category.arCategories && category.arCategories.length) {
        category.arCategories.forEach(function(subCat) {
          refreshCategoryCheckboxState(subCat);
        });
      }

      if (category.checkBoxAll) {
        setCheckboxVisualState(category.checkBoxAll, deriveCategoryState(category));
      }
    }

    function refreshAllCategoryCheckboxes(scope) {
      var mgr = getLayerManagerRoot(scope);
      if (mgr && mgr.arCategories && mgr.arCategories.length) {
        mgr.arCategories.forEach(function(rootCat) {
          refreshCategoryCheckboxState(rootCat);
        });
        return;
      }
      refreshCategoryCheckboxState(scope);
    }

    function notifyAfterLayerChange(scope) {
      if (!window.njs || !njs.AppManager) return;

      if (njs.AppManager.LyrMgr && njs.AppManager.LyrMgr[scope.id_lyr_mgr] && njs.AppManager.LyrMgr[scope.id_lyr_mgr].mod_sortlayers != null) {
        njs.AppManager.LyrMgr[scope.id_lyr_mgr].updateSortLyrMod();
      }

      if (njs.AppManager.Tools && njs.AppManager.Tools.TrackBookmark) {
        njs.AppManager.updateMapStatusUrl(njs.AppManager.LyrMgr[scope.id_lyr_mgr].targetMap[0]);
      }
    }

    function getSnapshotKey(scope, groupId) {
      var mgrId = scope && scope.id_lyr_mgr ? String(scope.id_lyr_mgr) : 'default';
      return mgrId + '::' + String(groupId || '');
    }

    function clearSnapshotsForCategories(scope, categories) {
      if (!categories || !categories.length) return;
      for (var i = 0; i < categories.length; i++) {
        if (!categories[i] || !categories[i].id) continue;
        delete _groupVisibilitySnapshots[getSnapshotKey(scope, categories[i].id)];
      }
    }

    function makeVisibilitySnapshot(category) {
      var layers = [];
      var snap = {};
      collectDescendantLayers(category, layers);
      layers.forEach(function(lay) {
        if (lay && lay.name) snap[lay.name] = getLayerChecked(lay);
      });
      return snap;
    }

    function applyVisibilityBySnapshot(scope, category, snapshot, fallbackVisible) {
      var layers = [];
      collectDescendantLayers(category, layers);
      _suppressLayerRefresh = true;
      try {
        layers.forEach(function(lay) {
          if (!lay || !lay.name) return;
          var targetVisible = fallbackVisible;
          if (snapshot && Object.prototype.hasOwnProperty.call(snapshot, lay.name)) {
            targetVisible = !!snapshot[lay.name];
          }
          var currentVisible = getLayerChecked(lay);
          if (currentVisible !== targetVisible) {
            scope.switchLayer(lay.name, targetVisible);
          }
          if (!targetVisible) {
            removeLayerIfPossible(lay);
          }
        });
      } finally {
        _suppressLayerRefresh = false;
      }
    }

    // --- 1. Init: "nested" Flag aus Config lesen ---
    var _origInit = proto.Init;
    proto.Init = function(options) {
      _origInit.call(this, options);
      if (options && options.nested) {
        this.nested = true;
      }
    };
    console.log(LOG, '  Init gepatcht');

    // --- 2. _build: Tiefe weiterreichen ---
    proto._build = function(domLocation, oCatPaneContainer, _depth) {
      var that = this;
      var depth = (typeof _depth === 'number') ? _depth : 0;
      this._domLocation = domLocation;
      this._depth = depth;
      if (oCatPaneContainer == null) oCatPaneContainer = document.createElement("DIV");

      if (this.arCategories.length > 0) {
        if (!this._inNestedContext) {
          dojo.attr(oCatPaneContainer, {"class": "categoryHeader"});
        } else {
          dojo.removeClass(oCatPaneContainer, "categoryHeader");
        }
      }

      if (!this._inNestedContext) {
        this._buildContentHeader(domLocation, oCatPaneContainer);
      }

      if (this.arBMap.length > 0) {
        this._buildContentBaseMaps(domLocation, oCatPaneContainer);
      }
      if (this.arLayers.length > 0) {
        this._buildContentLayers(domLocation, oCatPaneContainer);
      }
      if (this.arCategories.length > 0) {
        this.arCategories.forEach(function(cat) {
          that._buildContentSubCat(cat, domLocation, depth + 1);
        });
      }
    };
    console.log(LOG, '  _build gepatcht');

    // --- 3. _buildContentLayers: Leaf-Container depth-basiert markieren ---
    var _origBuildContentLayers = proto._buildContentLayers;
    proto._buildContentLayers = function(domLocation, oCatPaneContainer) {
      _origBuildContentLayers.call(this, domLocation, oCatPaneContainer);

      if (!this._inNestedContext || !oCatPaneContainer || !oCatPaneContainer.children) return;

      var parentDepth = (typeof this._depth === 'number') ? this._depth : 1;
      for (var i = 0; i < oCatPaneContainer.children.length; i++) {
        var child = oCatPaneContainer.children[i];
        if (!child) continue;
        if (child.classList && child.classList.contains('dijitTitlePane')) continue;
        child.classList.add('tnet-lm-nested-leaf');
        child.setAttribute('data-lyrmgr-parent-depth', String(parentDepth));
      }
    };
    console.log(LOG, '  _buildContentLayers gepatcht');

    // --- 4. _buildContentSubCat: DER EIGENTLICHE FIX ---
    proto._buildContentSubCat = function(_opts, domLocation, _depth) {
      var that = this;
      var depth = (typeof _depth === 'number') ? _depth : 1;

      // Nesting aktiv? (eigenes Flag oder vom Parent geerbt)
      var applyNesting = _opts.nested || this.nested || this._inNestedContext;

      var title_html = '';

      // Legenden-Link
      if (_opts.legend) {
        var _leg = _opts.legend.link;
        var _title = _opts.legend.title;
        var _print = _opts.legend.print;
        var _extern = _opts.legend.extern;
        title_html += "<a class='imagelink' href='javascript:void(0)' onclick='event.stopPropagation();njs.AppManager.showLegend(\"" + _leg + "\",\"" + escape(_title) + "\"," + _print + "," + _extern + ");'><img title='" + this.tt_legend + "' style='vertical-align: middle;' src='../core/templates/" + njs.AppManager.template + "/img/buttons/map.png' alt='' /></a>&nbsp;";
      }

      // Tool-Link
      if (_opts.tool) {
        var _toollink = _opts.tool.link;
        title_html += "<a class='imagelink' href='javascript:void(0)' onclick='event.stopPropagation();window.open(\"" + _toollink + "\",\"shop\");'><div class='grpShop'></div></a>";
      }

      // SelectAll Checkbox Placeholder
      if (_opts.selectAll) title_html += "<input id='" + domLocation + "_" + _opts.id + "_groupckbx' />";

      // Beschreibung / Titel
      var desc = _opts.description;
      title_html += "<span class='appendtitle'>" + _opts.description + "</span>";
      if (_opts.restricted)
        title_html += "&nbsp;<span class='categoryLocked'>&nbsp;&nbsp;&nbsp;</span>";

      // TitlePane erstellen
      var tp = new dijit.TitlePane({
        id: domLocation + "_" + _opts.id,
        style: "width:100%",
        title: title_html,
        content: "",
        open: _opts.open ? _opts.open : false
      });

      // CSS-Tiefe setzen
      if (applyNesting) {
        tp.domNode.setAttribute('data-lyrmgr-depth', depth);
      }

      // TitlePane an den Container hängen
      dojo.byId(domLocation).appendChild(tp.domNode);

      _opts.description = "";

      // Content-Pane des neuen TitlePane
      var childDomLocation = domLocation + "_" + _opts.id + "_pane";
      var oCatPaneContainer = dojo.byId(childDomLocation);

      // ===== DER FIX =====
      // Original: _opts._build(domLocation, oCatPaneContainer)
      //   → Kinder landen flat am Root-Container
      // Fix: _opts._build(childDomLocation, oCatPaneContainer, depth)
      //   → Kinder landen im Content-Pane des Parent-TitlePane.
      // Wichtig: _buildContentHeader wird im Nested-Context unterdrückt,
      // damit oCatPaneContainer nicht aus dem Pane verschoben wird.
      if (applyNesting) {
        var prevNestedCtx = _opts._inNestedContext;
        _opts._inNestedContext = true;
        _opts._build(childDomLocation, oCatPaneContainer, depth);
        _opts._inNestedContext = prevNestedCtx;
        console.log(LOG, '  Tiefe ' + depth + ': ' + _opts.id + ' → #' + childDomLocation);
      } else {
        // Standard: flat (Original-Verhalten)
        _opts._build(domLocation, oCatPaneContainer);
      }

      tp.startup();

      // ===== FIX 2: Dojo komplett umgehen — eigener Click + Display-Toggle =====
      // Problem: Dojos interne Click-Chain (_onTitleClick→toggle→_setOpenAttr→play)
      //          funktioniert nicht zuverlässig bei verschachtelten Panes.
      // Lösung:  1. Dojos _onTitleClick deaktivieren (noop)
      //          2. Eigener DOM addEventListener auf titleBarNode
      //          3. Reines display-toggle statt Animation
      if (applyNesting) {
        (function(pane) {
          // Bestehende Animationen stoppen
          if (pane._wipeIn && pane._wipeIn.stop) pane._wipeIn.stop();
          if (pane._wipeOut && pane._wipeOut.stop) pane._wipeOut.stop();

          function forceContentVisibility(open) {
            var displayValue = open ? 'block' : 'none';
            if (pane.wipeNode && pane.wipeNode.style && pane.wipeNode.style.setProperty) {
              pane.wipeNode.style.setProperty('display', displayValue, 'important');
              pane.wipeNode.style.setProperty('height', open ? 'auto' : '0px', 'important');
              pane.wipeNode.style.setProperty('overflow', open ? 'visible' : 'hidden', 'important');
              pane.wipeNode.style.setProperty('visibility', 'visible', 'important');
            }
          }

          // --- 1. NUR _setOpenAttr überschreiben (Sichtbarkeit/State zentral) ---
          var _toggleGuardUntil = 0;
          pane._setOpenAttr = function(open) {
            open = !!open;
            var now = Date.now();
            if (this.__tnetSettingOpen) return;
            if (now < _toggleGuardUntil && open !== this.open) {
              console.log(LOG, '[setOpen] IGNORE ' + this.id + ' → ' + (open ? 'OPEN' : 'CLOSE') + ' (guard)');
              return;
            }
            _toggleGuardUntil = now + 220;
            this.__tnetSettingOpen = true;
            try {
              forceContentVisibility(open);
              this._set('open', open);
              dojo[open ? 'addClass' : 'removeClass'](this.domNode, 'lyrmgr-open');
              dojo[open ? 'removeClass' : 'addClass'](this.domNode, 'dijitClosed');
              this._setCss();
              if (this.focusNode) this.focusNode.setAttribute('aria-pressed', String(open));
              if (this.containerNode) this.containerNode.setAttribute('aria-hidden', String(!open));
              if (open && this._started && this._onShow) this._onShow();
            } finally {
              this.__tnetSettingOpen = false;
            }
            console.log(LOG, '[setOpen] ' + this.id + ' → ' + (open ? 'OPEN' : 'CLOSE'));
            setTimeout(function() {
              console.log(LOG, '[state] ' + pane.id +
                ' hide=' + (pane.hideNode ? getComputedStyle(pane.hideNode).display : 'n/a') +
                ' wipe=' + getComputedStyle(pane.wipeNode).display +
                ' scrollHeight=' + pane.containerNode.scrollHeight);
            }, 0);
          };
          if (pane.titleBarNode) pane.titleBarNode.style.cursor = 'pointer';

          // --- 2. Eindeutiger Toggle-Pfad: nur nativer TitleBar-Click ---
          pane.toggle = function() { pane._setOpenAttr(!pane.open); };
          pane._onTitleClick = function(e) {
            if (e && e.preventDefault) e.preventDefault();
            if (e && e.stopPropagation) e.stopPropagation();
            return;
          };

          // --- 3. Nativer DOM-Click als einzige Toggle-Quelle ---
          // Ctrl+Klick: alle Geschwister derselben Hierarchiestufe öffnen/schliessen
          if (pane.titleBarNode && !pane.titleBarNode.__tnetNestedClickBound) {
            pane.titleBarNode.__tnetNestedClickBound = true;
            pane.titleBarNode.addEventListener('click', function(e) {
              var t = e.target;
              if (t && (t.tagName === 'A' || t.tagName === 'INPUT' || t.tagName === 'IMG')) return;
              if (t && t.closest && t.closest('a,input')) return;

              if (e.ctrlKey || e.metaKey) {
                // Ctrl+Klick: Alle Geschwister-Panes auf derselben Tiefe toggeln
                var targetOpen = !pane.open;
                var depth = pane.domNode.getAttribute('data-lyrmgr-depth');
                var parentContainer = pane.domNode.parentElement;
                if (parentContainer && depth) {
                  var children = parentContainer.children;
                  for (var ci = 0; ci < children.length; ci++) {
                    var sib = children[ci];
                    if (sib.classList && sib.classList.contains('dijitTitlePane') &&
                        sib.getAttribute('data-lyrmgr-depth') === depth) {
                      var sibWidget = null;
                      try { sibWidget = dijit.byNode(sib); } catch (ex) {}
                      if (!sibWidget && sib.id) sibWidget = dijit.byId(sib.id);
                      if (sibWidget && typeof sibWidget._setOpenAttr === 'function') {
                        sibWidget._setOpenAttr(targetOpen);
                      }
                    }
                  }
                  console.log(LOG, '[Ctrl+Click] depth=' + depth + ' → ' + (targetOpen ? 'OPEN' : 'CLOSE') + ' alle Geschwister');
                } else {
                  pane.toggle();
                }
              } else {
                pane.toggle();
              }

              if (e && e.preventDefault) e.preventDefault();
              if (e && e.stopPropagation) e.stopPropagation();
              if (e && e.stopImmediatePropagation) e.stopImmediatePropagation();
            }, true);
          }

          // --- 4. Dummy-Animationen ---
          pane._wipeIn = { play: function() { pane._setOpenAttr(true); }, stop: function() {}, status: function() { return 'stopped'; } };
          pane._wipeOut = { play: function() { pane._setOpenAttr(false); }, stop: function() {}, status: function() { return 'stopped'; } };

          // --- 5. Initialen State setzen ---
          if (!pane.open) {
            forceContentVisibility(false);
            dojo.removeClass(pane.domNode, 'lyrmgr-open');
            dojo.addClass(pane.domNode, 'dijitClosed');
          } else {
            forceContentVisibility(true);
            dojo.addClass(pane.domNode, 'lyrmgr-open');
            dojo.removeClass(pane.domNode, 'dijitClosed');
          }
        })(tp);
      }

      // SelectAll Checkbox Logik (rekursiv über alle Unterebenen)
      var stats = collectLayerStats(_opts, !that.hasStartLayers);
      var _box_checked = stats.checked > 0;
      var nbLayChecked = stats.checked;
      var nbLayTot = stats.total;

      if (_opts.selectAll) {
        _opts.checkBoxAll = new dijit.form.CheckBox({
          id: domLocation + "_" + _opts.id + "_groupckbx",
          name: domLocation + "_" + _opts.id + "_groupckbx",
          value: _opts.id,
          checked: _box_checked,
          onClick: function(evt) {
            if (_suppressGroupCheckboxClick) {
              return;
            }
            if (evt && evt.stopPropagation) evt.stopPropagation();
            njs.AppManager.currentSubTheme = null;
            njs.AppManager.currentTheme = null;
            that.switchGroupLayers(this.id, this.value, this.checked);
          }
        }, domLocation + "_" + _opts.id + "_groupckbx");
      }

      if (_opts.checkBoxAll) {
        if (nbLayChecked < nbLayTot && nbLayChecked > 0) {
          setCheckboxVisualState(_opts.checkBoxAll, 'mixed');
        } else if (nbLayTot > 0 && nbLayChecked === nbLayTot) {
          setCheckboxVisualState(_opts.checkBoxAll, 'all');
        } else {
          setCheckboxVisualState(_opts.checkBoxAll, 'none');
        }
      }

      _opts.description = desc;
    };

    console.log(LOG, '  _buildContentSubCat gepatcht');

    // --- 5. switchLayer: Parent-Checkboxen rekursiv nachziehen + OFF erzwingt removeLayer ---
    var _origSwitchLayer = proto.switchLayer;
    proto.switchLayer = function(id_layer, status) {
      if (typeof _origSwitchLayer === 'function') {
        _origSwitchLayer.call(this, id_layer, status);
      }

      if (status && !_suppressLayerRefresh) {
        clearSnapshotsForCategories(this, findAncestorCategoriesInManager(this, id_layer));
      }

      if (!status) {
        removeLayerIfPossible(findLayerInManager(this, id_layer));
      }

      if (!_suppressLayerRefresh) {
        refreshAllCategoryCheckboxes(this);
      }
    };
    console.log(LOG, '  switchLayer gepatcht (Parent-State + removeLayer)');

    // --- 6. switchGroupLayers: rekursives EIN/AUS + Restore-Snapshot ---
    var _origSwitchGroupLayers = proto.switchGroupLayers;
    proto.switchGroupLayers = function(idchkbox, idgroup, status) {
      var targetCategory = findCategoryInManager(this, idgroup);
      if (!targetCategory) {
        if (typeof _origSwitchGroupLayers === 'function') {
          _origSwitchGroupLayers.call(this, idchkbox, idgroup, status);
        }
        refreshAllCategoryCheckboxes(this);
        return;
      }

      var snapshotKey = getSnapshotKey(this, idgroup);

      if (!status) {
        _groupVisibilitySnapshots[snapshotKey] = makeVisibilitySnapshot(targetCategory);
        applyVisibilityBySnapshot(this, targetCategory, null, false);
      } else {
        var snapshot = _groupVisibilitySnapshots[snapshotKey] || null;
        applyVisibilityBySnapshot(this, targetCategory, snapshot, true);
        delete _groupVisibilitySnapshots[snapshotKey];
      }

      refreshAllCategoryCheckboxes(this);
      if (targetCategory.checkBoxAll) {
        var targetState = deriveCategoryState(targetCategory);
        if (status && targetState === 'none') targetState = 'all';
        setCheckboxVisualState(targetCategory.checkBoxAll, targetState);
      }
      notifyAfterLayerChange(this);
    };
    console.log(LOG, '  switchGroupLayers gepatcht (rekursiv + restore)');

    console.log(LOG, 'Alle Patches angewendet ✓ — Kategorien mit "nested":true werden verschachtelt');
  }

})();
