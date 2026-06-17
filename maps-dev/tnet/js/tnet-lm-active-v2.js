/**
 * tnet-lm-active-v2.js - Karteninhalt V2
 *
 * Duenner Wrapper ueber V1 (TnetLMActive):
 *   - Delegiert Init, Render, Events, Drag&Drop, Legend vollstaendig an V1
 *   - Patcht V1._buildActiveEntries: sortiert Layer nach Bookmark-API-Reihenfolge
 *   - Uebernimmt Gruppen-Namen aus API (coalesce_group)
 *   - Fuegt Views-Dropdown in V1-Header ein
 *
 * @version    2.0
 * @date       2026-06-17
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */
(function () {
  'use strict';
  var LOG = '[LM-Active-V2]';
  var _serviceGroupsOrder = {};
  var _apiGroupNames = {};
  var _bookmarkData = null;
  var _containerId = null;
  var _v1Patched = false;

  var _userReordered = false; // true sobald Drag&Drop-Reorder erkannt

  function _resolveProfile() {
    if (typeof TnetApi !== 'undefined' && typeof TnetApi.getActiveProfile === 'function') return TnetApi.getActiveProfile();
    try { var p = new URLSearchParams((window.top||window).location.search); var g = p.get('group'); return (g&&g.trim()) ? g.trim() : 'public'; } catch(e) { return 'public'; }
  }

  function _collectAllIds(nodes) {
    var ids = [];
    (nodes||[]).forEach(function(n) { if(!n) return; ids.push(n.id); _collectAllIds(n.children||[]).forEach(function(id){ids.push(id);}); });
    return ids;
  }

  function _storeNodeNames(node) {
    if (!node||!node.id) return;
    if (node.name && !_apiGroupNames[node.id]) _apiGroupNames[node.id] = node.name;
    (node.children||[]).forEach(function(c){ _storeNodeNames(c); });
  }

  function _buildOrderIndex(data) {
    _serviceGroupsOrder = {}; _apiGroupNames = {};
    var sortIdx = 0;
    (data.serviceGroups||[]).forEach(function(group) {
      var label = group.name || null;
      _collectAllIds(group.tree||[]).forEach(function(id) {
        if (_serviceGroupsOrder[id]===undefined) _serviceGroupsOrder[id] = sortIdx++;
        if (label && !_apiGroupNames[id]) _apiGroupNames[id] = label;
      });
      (group.tree||[]).forEach(function(n){ _storeNodeNames(n); });
    });
  }

  function _sortByBookmark(layers) {
    if (_userReordered) return layers; // Nutzer hat umsortiert -> nicht ueberschreiben
    if (Object.keys(_serviceGroupsOrder).length===0) return layers;
    // Prüfen ob layers bereits explizite order-Werte haben (V1 setzt sie nach Drag&Drop)
    var hasExplicitOrder = layers.some(function(l) { return l && typeof l.order === 'number'; });
    if (hasExplicitOrder) { _userReordered = true; return layers; }
    var order = _serviceGroupsOrder; var MAX = 999999;
    return layers.slice().sort(function(a,b){ return (order[a.id]!==undefined?order[a.id]:MAX)-(order[b.id]!==undefined?order[b.id]:MAX); });
  }

  function _patchV1() {
    if (_v1Patched || !window.TnetLMActive) return;
    _v1Patched = true;
    var origBuild = window.TnetLMActive._buildActiveEntries.bind(window.TnetLMActive);
    window.TnetLMActive._buildActiveEntries = function(layers) {
      var entries = origBuild(_sortByBookmark(layers));
      if (Object.keys(_apiGroupNames).length > 0) {
        entries.forEach(function(entry) {
          if (entry.type !== 'group') return;
          var firstChild = entry.children && entry.children[0];
          if (!firstChild) return;
          var apiName = _apiGroupNames[firstChild.id];
          if (apiName) entry.groupName = apiName;
        });
      }
      return entries;
    };
    TnetLog.log(LOG, 'V1._buildActiveEntries gepatch');
  }

  function _loadBookmarkApi(bookmarkId) {
    if (typeof TnetApi==='undefined'||typeof TnetApi.getBookmarkV2!=='function') return;
    TnetApi.getBookmarkV2(bookmarkId, _resolveProfile())
      .then(function(data) {
        _bookmarkData = data; _buildOrderIndex(data); _updateViewsDropdown(data.views||[]);
        var store = window.TnetLMStore;
        if (store && window.TnetLMActive && typeof window.TnetLMActive.render==='function') window.TnetLMActive.render(store.getActiveLayers());
        TnetLog.log(LOG, 'V2 API OK:', bookmarkId);
      })
      .catch(function(err){ TnetLog.warn(LOG, 'V2 API Fehler:', err&&err.message||err); });
  }

  function _updateViewsDropdown(views) {
    var container = document.getElementById(_containerId); if (!container) return;
    var existing = container.querySelector('.lm-v2-views-row'); if (existing) existing.remove();
    if (!views||!views.length) return;
    var header = container.querySelector('.lm-active-header'); if (!header) return;
    var metaBlock = header.querySelector('.lm-active-meta');
    var row = document.createElement('div');
    row.className = 'lm-v2-views-row';
    row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 8px 0;';
    var lbl = document.createElement('span'); lbl.className='lm-active-meta-label'; lbl.textContent='Ansicht'; row.appendChild(lbl);
    var sel = document.createElement('select'); sel.className='lm-v2-views-select lm-active-view-select'; sel.style.flex='1';
    sel.innerHTML = '<option value="">(Standard)</option>';
    var bm = window.__tnetActiveBookmark;
    (views||[]).forEach(function(v){ var opt=document.createElement('option'); opt.value=v.id||''; opt.textContent=v.name||v.id||''; if(bm&&bm.activeViewId===v.id) opt.selected=true; sel.appendChild(opt); });
    sel.addEventListener('change', function(){ _applyView(sel.value||''); });
    row.appendChild(sel);
    if (metaBlock) metaBlock.appendChild(row); else header.appendChild(row);
  }

  function _isDebug() {
    try { return !!(window.__tnetConfig && window.__tnetConfig.layerManager && window.__tnetConfig.layerManager.debug); } catch(e) { return false; }
  }

  function _insertDebugBadge() {
    var container = document.getElementById(_containerId); if (!container) return;
    if (container.querySelector('.lm-v2-debug-badge')) return;
    var toolbar = container.querySelector('.lm-active-toolbar'); if (!toolbar) return;
    var badge = document.createElement('span');
    badge.className = 'lm-v2-debug-badge';
    badge.textContent = 'V2';
    badge.title = 'Karteninhalt V2 aktiv (Bookmark-API: Reihenfolge + NLS-Namen)';
    badge.style.cssText = 'display:inline-flex;align-items:center;padding:1px 6px;font-size:10px;font-weight:700;' +
      'background:#1e6a4a;color:#fff;border-radius:3px;letter-spacing:.5px;cursor:default;margin-right:4px;';
    toolbar.insertBefore(badge, toolbar.firstChild);
  }

  function _applyView(viewId) {
    if (!_bookmarkData||!Array.isArray(_bookmarkData.views)) return;
    var view = null; if (viewId) _bookmarkData.views.forEach(function(v){ if(v&&v.id===viewId) view=v; });
    var store = window.TnetLMStore; if (!store) return;
    var bm = window.__tnetActiveBookmark; if (bm) bm.activeViewId = viewId||null;
    if (!view) {
      var cfgLayers = bm&&bm._cfg&&Array.isArray(bm._cfg.layers)?bm._cfg.layers:[];
      cfgLayers.forEach(function(l){ var id=l&&typeof l==='object'?l.id:String(l||''); var vis=l&&typeof l==='object'&&'visible'in l?!!l.visible:true; if(id&&store.setLayerEye) store.setLayerEye(id,vis); });
      return;
    }
    var states=(view&&view.layerStates)||{};
    if (bm&&Array.isArray(bm.layers)) bm.layers.forEach(function(l){ if(l&&l.id&&store.setLayerEye) store.setLayerEye(l.id,false); });
    Object.keys(states).forEach(function(id){ var s=states[id]; if(s&&typeof s.visible==='boolean'&&store.setLayerEye) store.setLayerEye(id,s.visible); });
  }

  window.TnetLMActiveV2 = {
    init: function(containerId) {
      _containerId = containerId;
      _patchV1();
      if (window.TnetLMActive && typeof window.TnetLMActive.init==='function') {
        window.TnetLMActive.init(containerId);
      } else { TnetLog.error(LOG, 'TnetLMActive fehlt'); return; }
      document.addEventListener('tnet-bookmark-loaded', function() {
        _serviceGroupsOrder={}; _apiGroupNames={}; _bookmarkData=null; _userReordered=false;
        var container = document.getElementById(_containerId);
        var existing = container&&container.querySelector('.lm-v2-views-row'); if(existing) existing.remove();
        var bm=window.__tnetActiveBookmark; var bmId=bm&&(bm.id||bm['map-bookmark']); if(bmId) _loadBookmarkApi(bmId);
      });
      TnetLog.log(LOG, 'Init V2 => V1 delegiert + Ordering/Namen/Views');
      // Debug-Badge sofort und nach Bookmark-Load einblenden
      if (_isDebug()) {
        setTimeout(_insertDebugBadge, 200);
        document.addEventListener('tnet-bookmark-loaded', function() { setTimeout(_insertDebugBadge, 400); });
      }
    },
    destroy: function() { if(window.TnetLMActive&&typeof window.TnetLMActive.destroy==='function') window.TnetLMActive.destroy(); }
  };
})();