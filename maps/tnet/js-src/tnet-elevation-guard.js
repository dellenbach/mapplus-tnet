/**
 * tnet-elevation-guard.js
 * Robuste Behandlung von Hoehenabfragen mit nicht validen JSON-Antworten.
 *
 * @version    1.4
 * @date       2026-06-17
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */
(function () {
  'use strict';

  var LOG = '[ElevationGuard]';
  var _patched = false;

  // ===== HILFSFUNKTIONEN =====

  function logWarn() {
    var args = [LOG].concat(Array.prototype.slice.call(arguments));
    if (window.TnetLog && typeof TnetLog.warn === 'function') {
      TnetLog.warn.apply(TnetLog, args);
    } else if (window.console && console.warn) {
      console.warn.apply(console, args);
    }
  }

  function parseElevationValue(response) {
    var info = parseElevationInfo(response);
    return info ? info.terrain : null;
  }

  function isFiniteNumber(value) {
    return typeof value === 'number' && isFinite(value);
  }

  function parseFiniteNumber(value) {
    if (typeof value === 'number') return isFinite(value) ? value : null;
    if (value == null) return null;

    var numeric = parseFloat(String(value).replace(',', '.'));
    return isFinite(numeric) ? numeric : null;
  }

  function parseElevationInfo(response) {
    if (typeof response === 'number') return buildElevationInfo(response, null);
    if (response == null) return null;

    if (typeof response === 'object') {
      return extractElevationInfoFromObject(response);
    }

    var text = String(response).trim();
    if (!text) return null;

    var direct = parseFloat(text.replace(',', '.'));
    if (isFinite(direct)) return buildElevationInfo(direct, null);

    try {
      var parsed = JSON.parse(text);
      return extractElevationInfoFromObject(parsed);
    } catch (e) {
      return null;
    }
  }

  function buildElevationInfo(terrain, surface) {
    if (!isFiniteNumber(terrain)) return null;
    var hasSurface = isFiniteNumber(surface);
    var objectHeight = hasSurface ? (surface - terrain) : null;
    return {
      terrain: terrain,
      surface: hasSurface ? surface : null,
      objectHeight: objectHeight
    };
  }

  function extractElevationFromObject(obj) {
    var info = extractElevationInfoFromObject(obj);
    return info ? info.terrain : null;
  }

  function extractElevationInfoFromObject(obj) {
    if (obj == null) return null;
    if (typeof obj === 'number') return buildElevationInfo(obj, null);
    if (typeof obj === 'string') return parseElevationInfo(obj);

    if (Object.prototype.toString.call(obj) === '[object Array]') {
      for (var i = 0; i < obj.length; i++) {
        var itemValue = extractElevationInfoFromObject(obj[i]);
        if (itemValue !== null) return itemValue;
      }
      return null;
    }

    var dem = parseFiniteField(obj, 'dem');
    var dsm = parseFiniteField(obj, 'dsm');
    if (dem !== null) return buildElevationInfo(dem, dsm);
    if (dsm !== null) return buildElevationInfo(dsm, dsm);

    var keys = ['height', 'elevation', 'dem', 'dsm', 'z', 'value', 'alti', 'altitude'];
    for (var k = 0; k < keys.length; k++) {
      if (Object.prototype.hasOwnProperty.call(obj, keys[k])) {
        var value = parseElevationInfo(obj[keys[k]]);
        if (value !== null) return value;
      }
    }

    return null;
  }

  function parseFiniteField(obj, key) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) return null;
    return parseFiniteNumber(obj[key]);
  }

  function getRequestParam(args, name) {
    var content = args && args.content;
    if (content && typeof content === 'object' && Object.prototype.hasOwnProperty.call(content, name)) {
      return content[name];
    }

    var url = args && args.url ? String(args.url) : '';
    if (!url) return null;

    var match = new RegExp('[?&]' + name + '=([^&#]*)').exec(url);
    if (!match || typeof match[1] !== 'string') return null;

    try {
      return decodeURIComponent(match[1].replace(/\+/g, ' '));
    } catch (e) {
      return match[1];
    }
  }

  function getRequestCoordinates(args) {
    var x = parseFiniteNumber(getRequestParam(args, 'x'));
    var y = parseFiniteNumber(getRequestParam(args, 'y'));
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;

    var srsRaw = getRequestParam(args, 'srs');
    var srsText = srsRaw == null ? '' : String(srsRaw);
    var sr = srsText.indexOf('21781') !== -1 ? '21781' : '2056';

    return {
      x: Math.round(x),
      y: Math.round(y),
      sr: sr
    };
  }

  function queryGeoAdminHeight(coords, callback) {
    if (!coords || typeof callback !== 'function') return;

    var done = false;
    function finish(info) {
      if (done) return;
      done = true;
      callback(info);
    }

    var url = 'https://api3.geo.admin.ch/rest/services/height?easting=' +
      encodeURIComponent(coords.x) + '&northing=' +
      encodeURIComponent(coords.y) + '&sr=' + encodeURIComponent(coords.sr);

    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.timeout = 2500;
      xhr.onload = function () {
        if (xhr.status !== 200) {
          finish(null);
          return;
        }
        var info = parseElevationInfo(xhr.responseText);
        if (!info || !isFiniteNumber(info.terrain)) {
          finish(null);
          return;
        }
        finish(buildElevationInfo(info.terrain, info.terrain));
      };
      xhr.onerror = function () { finish(null); };
      xhr.ontimeout = function () { finish(null); };
      xhr.send();
    } catch (e) {
      finish(null);
    }
  }

  function formatHeight(value) {
    return isFiniteNumber(value) ? (Math.round(value * 10) / 10).toFixed(1) : '--';
  }

  function formatElevationDisplay(info) {
    if (!info) return '';
    if (!isFiniteNumber(info.surface) || !isFiniteNumber(info.objectHeight)) {
      return formatHeight(info.terrain) + ' m';
    }
    return 'Gel\u00e4nde: ' + formatHeight(info.terrain) + ' | Oberfl\u00e4che: ' + formatHeight(info.surface) + ' | Objekt: ' + formatHeight(info.objectHeight) + ' m';
  }

  function publishElevationDisplay(info) {
    var text = formatElevationDisplay(info);
    if (!text) return;

    function setDisplayText() {
      var input = document.getElementById('z_alti1');
      if (input) input.value = text;

      var footer = document.getElementById('map-coord-altitude');
      if (footer) footer.textContent = text;
    }

    setTimeout(setDisplayText, 0);
    setTimeout(setDisplayText, 50);
    setTimeout(setDisplayText, 250);
    setTimeout(setDisplayText, 750);
    setTimeout(setDisplayText, 1500);
  }

  function isConfiguredElevationUrl(url) {
    try {
      var tools = window.njs && njs.AppManager && njs.AppManager.Tools;
      var elevation = tools && tools.ElevationDisplay;
      if (!elevation || typeof elevation !== 'object') return false;
      return containsConfiguredCgi(elevation, url);
    } catch (e) {
      return false;
    }
  }

  function containsConfiguredCgi(obj, url) {
    if (!obj || typeof obj !== 'object') return false;
    if (obj.cgi && obj.cgi.url && url.indexOf(obj.cgi.url) !== -1) return true;

    for (var key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key) && containsConfiguredCgi(obj[key], url)) {
        return true;
      }
    }
    return false;
  }

  function hasRequestParam(args, name) {
    var url = args && args.url ? String(args.url) : '';
    var content = args && args.content;

    if (new RegExp('[?&]' + name + '=').test(url)) return true;
    if (!content || typeof content !== 'object') return false;
    return Object.prototype.hasOwnProperty.call(content, name);
  }

  function looksLikeElevationRequest(args) {
    return hasRequestParam(args, 'dbconn_id') &&
      hasRequestParam(args, 'table') &&
      hasRequestParam(args, 'x') &&
      hasRequestParam(args, 'y') &&
      hasRequestParam(args, 'srs');
  }

  function isElevationRequest(args) {
    var url = args && args.url ? String(args.url) : '';
    if (!url) return false;
    return isConfiguredElevationUrl(url) || looksLikeElevationRequest(args);
  }

  function patchDojoXhrGet() {
    if (_patched || !window.dojo || typeof dojo.xhrGet !== 'function') return false;

    var originalXhrGet = dojo.xhrGet;
    dojo.xhrGet = function (args) {
      if (!args || !isElevationRequest(args)) {
        return originalXhrGet.apply(dojo, arguments);
      }

      var patchedArgs = {};
      for (var key in args) {
        if (Object.prototype.hasOwnProperty.call(args, key)) patchedArgs[key] = args[key];
      }

      var originalLoad = args.load;
      patchedArgs.handleAs = 'text';
      patchedArgs.load = function (response, ioArgs) {
        var elevationInfo = parseElevationInfo(response);
        if (elevationInfo === null) {
          var callbackContext = this;
          var coords = getRequestCoordinates(patchedArgs);

          if (!coords) {
            logWarn('Ungueltige Hoehenantwort:', response);
            if (typeof originalLoad === 'function') {
              return originalLoad.call(callbackContext, null, ioArgs);
            }
            return null;
          }

          queryGeoAdminHeight(coords, function (fallbackInfo) {
            if (fallbackInfo) {
              publishElevationDisplay(fallbackInfo);
              if (typeof originalLoad === 'function') {
                originalLoad.call(callbackContext, fallbackInfo.terrain, ioArgs);
              }
              return;
            }

            logWarn('Ungueltige Hoehenantwort:', response);
            if (typeof originalLoad === 'function') {
              originalLoad.call(callbackContext, null, ioArgs);
            }
          });

          return null;
        }
        publishElevationDisplay(elevationInfo);
        if (typeof originalLoad === 'function') {
          var result = originalLoad.call(this, elevationInfo.terrain, ioArgs);
          publishElevationDisplay(elevationInfo);
          return result;
        }
        return elevationInfo.terrain;
      };

      return originalXhrGet.call(dojo, patchedArgs);
    };

    _patched = true;
    return true;
  }

  function init() {
    if (patchDojoXhrGet()) return;
    setTimeout(init, 250);
  }

  init();
})();
