/**
 * tnet-framework-guards.js
 * Laufzeit-Guards fuer Framework-Core-Methoden (njs / ClassicLayerMgr), die auf
 * dem Mobile-Client crashen. Der Core liegt in mapplus-lib (shared) und wird NICHT
 * veraendert; stattdessen werden betroffene Prototyp-Methoden defensiv ueberschrieben.
 *
 * Behobenes Problem: ClassicLayerCategory.deselectAll() greift auf die domNode eines
 * dijit-Checkbox-Widgets zu, das auf Mobile nicht existiert (kein klassischer
 * Layer-Manager mit Checkboxen) -> TypeError "Cannot read properties of undefined
 * (reading 'domNode')". Der Fehler bricht den Bookmark-Load ab (TnetSetBookmark ->
 * setMapBookmark -> deselectAll), sodass die Bookmark-Layer NICHT aktiviert werden
 * ("Layer auf Mobile nicht sichtbar"). Guard: Checkbox-Zugriff nur wenn vorhanden.
 *
 * @version    1.0
 * @date       2026-06-20
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */
(function () {
  'use strict';

  function log() {
    if (window.TnetLog && typeof window.TnetLog.log === 'function') {
      window.TnetLog.log.apply(window.TnetLog, ['[FrameworkGuards]'].concat([].slice.call(arguments)));
    }
  }

  // ===== Guard: ClassicLayerCategory.deselectAll =====
  function patchDeselectAll() {
    if (!(window.njs && njs.LayerMgr && njs.LayerMgr.ClassicLayerCategory &&
          njs.LayerMgr.ClassicLayerCategory.prototype)) {
      return false; // Framework noch nicht geladen
    }
    var proto = njs.LayerMgr.ClassicLayerCategory.prototype;
    if (proto.__tnetDeselectAllGuarded || typeof proto.deselectAll !== 'function') return true;
    proto.__tnetDeselectAllGuarded = true;

    // Defensive Neufassung: identisches Verhalten wie der Core (Layer deselektieren
    // + Checkbox-Sync), aber mit Guard fuer fehlende dijit-Checkbox-Widgets (Mobile).
    proto.deselectAll = function () {
      this.arLayers.forEach(function (lay) {
        try { lay.switchLayer(false); } catch (e) { /* defensiv */ }
        if (lay.group_layer) {
          var _iid = lay.domLocation + '_' + lay.group_layer.name + '_grouplayckbx';
          var _chk = (typeof dijit !== 'undefined') ? dijit.byId(_iid) : null;
          if (_chk && _chk.domNode) {
            require(['dojo/dom-class'], function (domClass) {
              try {
                domClass.replace(_chk.domNode,
                  'dijit dijitReset dijitInline dijitCheckBox',
                  'dijit dijitReset dijitInline tmpdirCheckBox tmpdirCheckBoxMixed dijitMixed');
                _chk.set('checked', false);
              } catch (e) { /* defensiv */ }
            });
          }
        }
        var _w = (typeof dijit !== 'undefined') ? dijit.byId(lay.name) : null;
        if (_w) { try { _w.set('checked', false); } catch (e) { /* defensiv */ } }
      });
      this.arCategories.forEach(function (cat) {
        if (cat.checkBoxAll != null) { try { cat.checkBoxAll.set('checked', false); } catch (e) { /* defensiv */ } }
        cat.deselectAll();
      });
    };
    log('deselectAll-Guard installiert');
    return true;
  }

  // ===== Init: sofort versuchen, sonst kurz pollen (Framework laedt async) =====
  if (patchDeselectAll()) return;
  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    if (patchDeselectAll() || tries > 100) clearInterval(timer); // max ~20s
  }, 200);
})();
