/**
 * tnet-icons.js
 * Zentraler Icon-Loader — lädt SVG-Dateien aus /maps/tnet/resources/icons/
 * und stellt sie per TnetIcons.get('name') als HTML-String bereit.
 *
 * @version    1.0
 * @date       2025-01-27
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

// ===== TNET ICONS MODULE =====
(function () {
  'use strict';

  var BASE = '/maps/tnet/resources/icons/';

  // Cache: name → SVG-HTML-String
  var _cache = {};

  // Alle bekannten Icon-Namen
  var ALL_ICONS = [
    'eye-on', 'eye-off', 'drag-handle', 'close', 'legend',
    'chevron-right', 'chevron-down', 'folder', 'trash',
    'legend-colors', 'clipboard', 'dock', 'undock', 'dock-bottom',
    'printer', 'crosshair', 'list', 'hamburger', 'zoom', 'compass',
    'select-arrow', 'close-white', 'checkmark'
  ];

  // ===== PRIVATE HELPERS =====

  /**
   * Lädt eine einzelne SVG-Datei via fetch() und speichert im Cache.
   * @param {string} name  Icon-Name (ohne .svg)
   * @returns {Promise<string>}  SVG-HTML-String
   */
  function _fetchIcon(name) {
    return fetch(BASE + name + '.svg')
      .then(function (r) {
        if (!r.ok) throw new Error('Icon ' + name + ': HTTP ' + r.status);
        return r.text();
      })
      .then(function (svg) {
        // Zeilenumbrüche entfernen für sauberes innerHTML
        svg = svg.trim().replace(/\r?\n/g, '');
        _cache[name] = svg;
        return svg;
      })
      .catch(function (err) {
        console.warn('[TnetIcons] Fehler beim Laden von "' + name + '":', err.message);
        return '';
      });
  }

  // ===== PUBLIC API =====

  window.TnetIcons = {

    /**
     * Lädt alle Icons parallel vor (Preload).
     * @returns {Promise<void>}
     */
    loadAll: function () {
      var promises = ALL_ICONS.map(function (name) {
        if (_cache[name]) return Promise.resolve(_cache[name]);
        return _fetchIcon(name);
      });
      return Promise.all(promises).then(function () {
        console.log('[TnetIcons] ' + ALL_ICONS.length + ' Icons geladen');
      });
    },

    /**
     * Gibt den SVG-HTML-String für ein Icon zurück (synchron aus Cache).
     * Falls noch nicht geladen, wird ein leerer String zurückgegeben
     * und das Icon asynchron nachgeladen.
     *
     * @param {string} name       Icon-Name (z.B. 'dock', 'close', 'eye-on')
     * @param {string} [cssClass] Optionale CSS-Klasse, die auf das <svg> gesetzt wird
     * @param {object} [attrs]    Optionale Attribute (z.B. {width:'16', height:'16'})
     * @returns {string}  SVG-HTML-String
     */
    get: function (name, cssClass, attrs) {
      var svg = _cache[name];
      if (!svg) {
        // Async nachladen (für den nächsten Aufruf bereit)
        _fetchIcon(name);
        return '';
      }
      // CSS-Klasse einfügen
      if (cssClass) {
        svg = svg.replace('<svg', '<svg class="' + cssClass + '"');
      }
      // Zusätzliche Attribute
      if (attrs) {
        var attrStr = '';
        for (var key in attrs) {
          if (attrs.hasOwnProperty(key)) {
            attrStr += ' ' + key + '="' + attrs[key] + '"';
          }
        }
        if (attrStr) {
          svg = svg.replace('<svg', '<svg' + attrStr);
        }
      }
      return svg;
    },

    /**
     * Gibt ein einzelnes Icon per Promise zurück (garantiert geladen).
     *
     * @param {string} name       Icon-Name
     * @param {string} [cssClass] Optionale CSS-Klasse
     * @param {object} [attrs]    Optionale Attribute
     * @returns {Promise<string>}
     */
    getAsync: function (name, cssClass, attrs) {
      var self = this;
      if (_cache[name]) {
        return Promise.resolve(self.get(name, cssClass, attrs));
      }
      return _fetchIcon(name).then(function () {
        return self.get(name, cssClass, attrs);
      });
    },

    /**
     * Prüft ob ein Icon im Cache ist.
     * @param {string} name
     * @returns {boolean}
     */
    has: function (name) {
      return !!_cache[name];
    },

    /**
     * Setzt ein Icon manuell in den Cache (für Inline-Fallbacks).
     * @param {string} name
     * @param {string} svg
     */
    set: function (name, svg) {
      _cache[name] = svg;
    },

    /** Liste aller bekannten Icon-Namen */
    ALL: ALL_ICONS,

    /** Basis-URL */
    BASE: BASE
  };

})();
