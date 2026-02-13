/**
 * template-pdf-export.js
 *
 * PDF-Export-Engine für QGIS-Layout-Templates (v2.0).
 *
 * Workflow:
 *   1. QGIS-Plugin exportiert SVG-Templates mit {{PLACEHOLDER}}-Texten
 *      und textRenderFormat=AlwaysText (Text bleibt als <text>-Element)
 *   2. manifest.json beschreibt Templates + alle Elemente (Position,
 *      Grösse, Variable, Font) in mm
 *   3. Dieses Script:
 *      a) Lädt SVG-Template + manifest.json
 *      b) Ersetzt {{PLACEHOLDER}} im SVG-Text (String-Replace)
 *      c) Rendert OL-Map auf Canvas in MAP_AREA-Proportionen
 *      d) Erstellt PDF (jsPDF) in korrekter Papiergrösse
 *      e) Zeichnet SVG als Hintergrund (svg2pdf.js)
 *      f) Weisses Rechteck über MAP_AREA (verdeckt QGIS-Karteninhalt)
 *      g) OL-Map-Canvas in MAP_AREA-Position
 *      h) PDF-Text-Overlays für Elemente ohne SVG-Platzhalter
 *      i) Gibt PDF als Blob zurück (kein Auto-Download)
 *
 * Benötigt: jsPDF (global: jspdf), svg2pdf.js, OpenLayers (global: ol)
 *
 * @version    2.0
 * @date       2026-02-12
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------- //
  //  Konfiguration                                                    //
  // ---------------------------------------------------------------- //

  var CONFIG = {
    templatesBasePath: 'tnet/ol-pdf-printer/qgis-templates',
    defaultFilename: 'Kartenexport',
    defaultDpi: 150,
    // Bildformat: 'image/jpeg' (Standard) oder 'image/png'
    imageFormat: 'image/jpeg',
    // Debug-Flags (überschreibbar via tnet-global-config.json5)
    debug: true,
    debugTestLine: true,
    debugLogMetrics: true
  };

  /** Bedingte Konsolenausgabe: nur wenn CONFIG.debug === true */
  function _dbg() {
    if (CONFIG.debug) console.log.apply(console, arguments);
  }
  /** Metriken-Log: nur wenn CONFIG.debugLogMetrics === true */
  function _metrics() {
    if (CONFIG.debugLogMetrics) console.log.apply(console, arguments);
  }

  // ---------------------------------------------------------------- //
  //  Manifest                                                         //
  // ---------------------------------------------------------------- //

  var _manifestCache = null;

  /**
   * Lädt Manifest-Daten:
   * 1. Versuch: tnet/php/scan-manifests.php (scannt einzelne *.manifest.json)
   * 2. Fallback: manifest.json (legacy, altes Gesamtmanifest)
   */
  function loadManifest() {
    if (_manifestCache) return Promise.resolve(_manifestCache);

    // PHP liegt in tnet/php/ — relativ zur Seite /maps/
    var scanUrl = 'tnet/php/scan-manifests.php';
    var legacyUrl = CONFIG.templatesBasePath + '/manifest.json';

    return fetch(scanUrl)
      .then(function (r) {
        if (!r.ok) throw new Error('scan-manifests.php ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (data.templates && data.templates.length > 0) {
          _manifestCache = data;
          console.log('[TemplatePDF] Manifest via Scanner:', data.templates.length,
            'Templates aus', (data.source || 'scan-manifests.php'));
          return data;
        }
        throw new Error('Scanner lieferte 0 Templates');
      })
      .catch(function (scanErr) {
        console.warn('[TemplatePDF] Scanner nicht verfügbar:', scanErr.message, '→ Fallback manifest.json');
        return fetch(legacyUrl)
          .then(function (r) {
            if (!r.ok) throw new Error('manifest.json ' + r.status);
            return r.json();
          })
          .then(function (data) {
            _manifestCache = data;
            console.log('[TemplatePDF] Manifest (legacy):', data.templates.length, 'Templates');
            return data;
          });
      })
      .catch(function (err) {
        console.warn('[TemplatePDF] Kein Manifest gefunden:', err.message);
        _manifestCache = { version: '1.0', templates: [] };
        return _manifestCache;
      });
  }

  function getTemplates() {
    return loadManifest().then(function (m) { return m.templates || []; });
  }

  function loadTemplateSvg(templateEntry) {
    var svgPath = templateEntry.files && templateEntry.files.svg;
    if (!svgPath) {
      return Promise.reject(new Error('Keine SVG-Datei: ' + templateEntry.name));
    }
    var url = CONFIG.templatesBasePath + '/' + svgPath;
    return fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error('SVG nicht gefunden: ' + url + ' (' + r.status + ')');
        return r.text();
      });
  }

  // ---------------------------------------------------------------- //
  //  SVG-Hilfsfunktionen                                              //
  // ---------------------------------------------------------------- //

  /** Liest die SVG-viewBox-Dimensionen. */
  function parseSvgDimensions(svgText) {
    var parser = new DOMParser();
    var doc = parser.parseFromString(svgText, 'image/svg+xml');
    var svg = doc.documentElement;
    var vb = svg.getAttribute('viewBox');
    if (vb) {
      var p = vb.split(/[\s,]+/).map(Number);
      return { width: p[2], height: p[3] };
    }
    return {
      width:  parseFloat(svg.getAttribute('width'))  || 0,
      height: parseFloat(svg.getAttribute('height')) || 0
    };
  }

  /** SVG-Fallback: MAP_AREA-Rect suchen (nur wenn manifest.mapFrame fehlt). */
  function parseMapArea(svgText) {
    var parser = new DOMParser();
    var doc = parser.parseFromString(svgText, 'image/svg+xml');
    var svg = doc.documentElement;
    var vb = svg.getAttribute('viewBox');
    var svgW, svgH;
    if (vb) {
      var p = vb.split(/[\s,]+/).map(Number);
      svgW = p[2]; svgH = p[3];
    } else {
      svgW = parseFloat(svg.getAttribute('width')) || 0;
      svgH = parseFloat(svg.getAttribute('height')) || 0;
    }

    // 1. Element mit id *MAP_AREA* (nicht LABEL)
    var el = null;
    var all = doc.querySelectorAll('[id]');
    for (var i = 0; i < all.length; i++) {
      var id = all[i].getAttribute('id') || '';
      if (id.indexOf('MAP_AREA') >= 0 && id.indexOf('LABEL') < 0) {
        el = all[i]; break;
      }
    }
    // 2. Text "[ MAP AREA ]" → nächstes <rect>
    if (!el) {
      var texts = doc.querySelectorAll('text');
      for (var j = 0; j < texts.length; j++) {
        if ((texts[j].textContent || '').indexOf('MAP AREA') >= 0) {
          var rects = texts[j].parentElement
            ? texts[j].parentElement.querySelectorAll('rect') : [];
          if (rects.length) { el = rects[0]; break; }
        }
      }
    }
    // 3. Grösstes <rect> mit dash
    if (!el) {
      var maxA = 0;
      var rr = doc.querySelectorAll('rect');
      for (var k = 0; k < rr.length; k++) {
        var rw = parseFloat(rr[k].getAttribute('width')) || 0;
        var rh = parseFloat(rr[k].getAttribute('height')) || 0;
        var a = rw * rh;
        var st = rr[k].getAttribute('style') || '';
        var da = rr[k].getAttribute('stroke-dasharray') || '';
        if ((st.indexOf('dash') >= 0 || da) && a > maxA) {
          maxA = a; el = rr[k];
        }
      }
    }
    // 4. Zweitgrösstes Rect
    if (!el) {
      var sorted = Array.from(doc.querySelectorAll('rect'))
        .map(function (r) {
          return {
            el: r,
            a: (parseFloat(r.getAttribute('width')) || 0) *
               (parseFloat(r.getAttribute('height')) || 0)
          };
        })
        .sort(function (a, b) { return b.a - a.a; });
      if (sorted.length >= 2) el = sorted[1].el;
    }

    if (!el) {
      return {
        x: svgW * 0.05, y: svgH * 0.1,
        width: svgW * 0.7, height: svgH * 0.75,
        svgWidth: svgW, svgHeight: svgH
      };
    }

    var bx = parseFloat(el.getAttribute('x')) || 0;
    var by = parseFloat(el.getAttribute('y')) || 0;
    var bw = parseFloat(el.getAttribute('width')) || 0;
    var bh = parseFloat(el.getAttribute('height')) || 0;
    if (bw === 0 && el.tagName === 'g') {
      var ir = el.querySelector('rect');
      if (ir) {
        bx = parseFloat(ir.getAttribute('x')) || 0;
        by = parseFloat(ir.getAttribute('y')) || 0;
        bw = parseFloat(ir.getAttribute('width')) || 0;
        bh = parseFloat(ir.getAttribute('height')) || 0;
      }
    }
    return {
      x: bx, y: by, width: bw, height: bh,
      svgWidth: svgW, svgHeight: svgH
    };
  }

  // ---------------------------------------------------------------- //
  //  Platzhalter-Ersetzung (3 Strategien)                             //
  // ---------------------------------------------------------------- //

  /**
   * Strategie 1 (v1.3): {{PLACEHOLDER}}-Muster im SVG-Text ersetzen.
   * Einfacher String-Replace — funktioniert zuverlässig, da QGIS
   * den Text mit textRenderFormat=AlwaysText als <text>-Elemente
   * exportiert und die {{…}}-Muster im SVG-Quelltext stehen.
   */
  function replaceMustachePlaceholders(svgText, values) {
    var result = svgText;
    var count = 0;
    if (values.title)     { var b = result.length; result = result.split('{{TITLE}}').join(values.title);       if (result.length !== b) count++; }
    if (values.scaleText) { var b2 = result.length; result = result.split('{{SCALE}}').join(values.scaleText); if (result.length !== b2) count++; }
    if (values.coords)    { var b3 = result.length; result = result.split('{{COORDINATES}}').join(values.coords); if (result.length !== b3) count++; }
    if (values.date)      { var b4 = result.length; result = result.split('{{DATE}}').join(values.date);        if (result.length !== b4) count++; }
    console.log('[TemplatePDF] Mustache-Ersetzung:', count, 'Platzhalter ersetzt,',
      'Werte:', { title: values.title, scale: values.scaleText, coords: values.coords, date: values.date });
    return result;
  }

  /**
   * Strategie 2 (v1.2): SVG-Elemente per ID finden und Text ersetzen.
   * Das QGIS-Plugin setzt nach dem Export IDs via Nachbearbeitung:
   * id="TITLE_TEXT", id="SCALE_TEXT", etc.
   */
  function replaceDynamicElementsById(svgText, values) {
    var parser = new DOMParser();
    var doc = parser.parseFromString(svgText, 'image/svg+xml');
    var changed = false;

    var mapping = {
      'TITLE_TEXT':       values.title || '',
      'SCALE_TEXT':       values.scaleText || '',  // Massstabstext beibehalten
      'COORDINATES_TEXT': values.coords ? ('LV95: ' + values.coords) : '',
      'DATE_TEXT':        values.date ? ('Erstellt am: ' + values.date) : ''
    };

    for (var elemId in mapping) {
      // Nur undefined/null überspringen, NICHT leere Strings
      // (leere Strings löschen den Inhalt des Elements bewusst)
      if (mapping[elemId] === undefined || mapping[elemId] === null) continue;
      var el = doc.getElementById(elemId);
      if (!el) continue;
      var tspans = el.getElementsByTagName('tspan');
      if (tspans.length > 0) tspans[0].textContent = mapping[elemId];
      else el.textContent = mapping[elemId];
      changed = true;
      console.log('[TemplatePDF] SVG-Element ersetzt:', elemId);
    }

    if (changed) {
      return new XMLSerializer().serializeToString(doc);
    }
    return svgText;
  }

  /**
   * Strategie 3 (Legacy): [ TITLE BLOCK ] etc. ersetzen.
   */
  function replaceLegacyPlaceholders(svgText, values) {
    var r = svgText;
    if (values.title)     r = r.replace(/\[\s*TITLE\s*BLOCK[^\]]*\]/gi, values.title);
    if (values.scaleText) r = r.replace(/\[\s*SCALE\s*BAR[^\]]*\]/gi, values.scaleText);
    if (values.coords)    r = r.replace(/\[\s*COORDINATES[^\]]*\]/gi, values.coords);
    r = r.replace(/\[\s*MAP\s*AREA\s*\]/gi, '');
    return r;
  }

  /** Entfernt den MAP_AREA-Platzhalter-Rahmen (blaue gestrichelte Linie). */
  function removeMapAreaPlaceholder(svgText) {
    var r = svgText.replace(
      /<rect[^>]*(?:stroke-dasharray|stroke="#2196[fF]3")[^>]*\/>/gi, ''
    );
    r = r.replace(
      /<text[^>]*>[^<]*\[\s*MAP\s*AREA\s*\][^<]*<\/text>/gi, ''
    );
    return r;
  }

  /**
   * Normalisiert SVG-Font-Sizes für svg2pdf.js / jsPDF.
   *
   * QGIS exportiert SVG mit viewBox in Pixel (z.B. 3507×4960 für A3 bei 300 DPI).
   * Font-Sizes sind dann ebenfalls in SVG-Pixel (z.B. font-size="160" statt "12pt").
   * svg2pdf.js/jsPDF kann diese grossen Zahlen nicht als Font-Name interpretieren
   * und wirft "Unable to look up font label for font 'helvetica', '160normal'".
   *
   * Lösung: SVG-Font-Sizes durch den viewBox→mm-Skalierungsfaktor teilen und
   * explizit Einheit 'pt' anhängen, damit svg2pdf korrekte Punkt-Grössen erhält.
   */
  /**
   * Korrigiert ungültige SVG-Font-Attribute für svg2pdf.js / jsPDF.
   *
   * QGIS exportiert teilweise ungültige font-weight-Werte (z.B. "160")
   * die bei svg2pdf dazu führen, dass Fonts nicht gefunden werden
   * (Fehlermeldung: "Unable to look up font ... '160normal'").
   *
   * Font-Sizes werden NICHT geändert — svg2pdf.js rechnet die
   * viewBox→mm-Skalierung selbst korrekt um, wenn pdf.svg() mit
   * expliziter {width, height} aufgerufen wird.
   */
  function normalizeSvgFonts(svgText /*, paperW_mm, paperH_mm — unused */) {
    var parser = new DOMParser();
    var doc = parser.parseFromString(svgText, 'image/svg+xml');
    var changed = false;

    // Normalisiere ALLE font-weight Werte auf 'normal' (400) oder 'bold' (700),
    // da jsPDF nur diese beiden Stile kennt. Schwelle: ≥600 → bold, sonst normal.
    var allWithWeight = doc.querySelectorAll('[font-weight]');
    for (var i = 0; i < allWithWeight.length; i++) {
      var el = allWithWeight[i];
      var fw = el.getAttribute('font-weight');
      if (!fw) continue;

      var mapped;
      if (fw === 'normal' || fw === '400') { continue; }
      else if (fw === 'bold' || fw === '700') { continue; }
      else if (fw === 'bolder' || fw === 'lighter') {
        mapped = (fw === 'bolder') ? 'bold' : 'normal';
      } else {
        var num = parseInt(fw, 10);
        if (!isNaN(num)) {
          mapped = num >= 600 ? 'bold' : 'normal';
        } else {
          mapped = 'normal';
        }
      }
      el.setAttribute('font-weight', mapped);
      changed = true;
    }

    // Auch font-weight in style-Attributen fixen
    var styled = doc.querySelectorAll('[style]');
    for (var j = 0; j < styled.length; j++) {
      var style = styled[j].getAttribute('style');
      if (!style || style.indexOf('font-weight') < 0) continue;
      var newStyle = style.replace(
        /font-weight\s*:\s*(\w+|\d+)/g,
        function (match, val) {
          if (val === 'normal' || val === '400') return match;
          if (val === 'bold' || val === '700') return match;
          var n = parseInt(val, 10);
          if (!isNaN(n)) {
            changed = true;
            return 'font-weight: ' + (n >= 600 ? 'bold' : 'normal');
          }
          changed = true;
          return 'font-weight: normal';
        }
      );
      if (newStyle !== style) styled[j].setAttribute('style', newStyle);
    }

    if (changed) {
      console.log('[TemplatePDF] Ungültige font-weight Werte korrigiert');
      return new XMLSerializer().serializeToString(doc);
    }
    return svgText;
  }

  /**
   * Bereinigt QGIS-SVG-Export:
   * - Entfernt leere <g>-Gruppen (QGIS-Rendering-Artefakte)
   * - Normalisiert Schriftarten auf einheitliche sans-serif Familie
   * - Entfernt überflüssige Font-Attribute von Container-Gruppen
   *
   * @param {string} svgText - SVG-Quelltext
   * @returns {string} Bereinigter SVG-Text
   */
  function cleanupSvg(svgText) {
    var parser = new DOMParser();
    var doc = parser.parseFromString(svgText, 'image/svg+xml');
    var changed = false;

    // Einheitliche Schriftfamilie — muss dem jsPDF-registrierten Namen entsprechen
    // OHNE Quotes, damit svg2pdf den Namen 1:1 an pdf.setFont() weitergibt
    var targetFont = "Inter";

    // 1. Leere <g>-Elemente entfernen (mehrere Durchläufe für Verschachtelung)
    var removedCount = 0;
    for (var pass = 0; pass < 5; pass++) {
      var emptyGroups = doc.querySelectorAll('g');
      var removedThisPass = 0;
      for (var i = emptyGroups.length - 1; i >= 0; i--) {
        var g = emptyGroups[i];
        // Leer = keine Kind-Elemente (Text-Nodes zählen nicht)
        if (g.children.length === 0 && g.childElementCount === 0) {
          g.parentNode.removeChild(g);
          removedThisPass++;
          changed = true;
        }
      }
      removedCount += removedThisPass;
      if (removedThisPass === 0) break;
    }
    if (removedCount > 0) {
      console.log('[TemplatePDF] SVG-Cleanup:', removedCount, 'leere <g>-Elemente entfernt');
    }

    // 2. Schriftarten normalisieren
    var fontElements = doc.querySelectorAll('[font-family]');
    for (var j = 0; j < fontElements.length; j++) {
      var el = fontElements[j];
      var ff = el.getAttribute('font-family');
      // System-Fonts und generische Fonts ersetzen
      if (ff && /MS Shell Dlg|Helvetica|Arial|sans-serif/i.test(ff)) {
        el.setAttribute('font-family', targetFont);
        changed = true;
      }
    }

    // 3. font-family in style-Attributen normalisieren
    var styledEls = doc.querySelectorAll('[style]');
    for (var k = 0; k < styledEls.length; k++) {
      var style = styledEls[k].getAttribute('style');
      if (!style || style.indexOf('font-family') < 0) continue;
      var newStyle = style.replace(
        /font-family\s*:\s*(?:'[^']*'|"[^"]*"|[^;]+)/g,
        'font-family: ' + targetFont
      );
      if (newStyle !== style) {
        styledEls[k].setAttribute('style', newStyle);
        changed = true;
      }
    }

    if (changed) {
      console.log('[TemplatePDF] SVG-Cleanup: Fonts normalisiert auf', targetFont);
      return new XMLSerializer().serializeToString(doc);
    }
    return svgText;
  }

  // ---------------------------------------------------------------- //
  //  Server-Rendering: Kartenbilder direkt von Mapservern anfordern   //
  // ---------------------------------------------------------------- //

  /**
   * Sammelt Infos über alle sichtbaren WMS-/ArcGIS-Layer.
   * Gibt ein Array zurück mit {type, url, layers, opacity, params}.
   *
   * @param {ol.Map} map - OpenLayers Map
   * @returns {Array<Object>}
   */
  function collectLayerInfos(map) {
    var infos = [];
    map.getLayers().forEach(function (layer) {
      if (!layer.getVisible || !layer.getVisible()) return;
      var src = layer.getSource && layer.getSource();
      if (!src) return;
      // VectorSource (Redlining) überspringen
      if (typeof src.getFeatures === 'function') return;

      var url = '';
      var params = {};
      var layerType = 'unknown';

      if (typeof src.getUrl === 'function') {
        url = src.getUrl() || '';
      } else if (typeof src.getUrls === 'function') {
        var urls = src.getUrls();
        url = (urls && urls.length > 0) ? urls[0] : '';
      }
      if (!url) return;

      if (typeof src.getParams === 'function') {
        params = Object.assign({}, src.getParams() || {});
      }

      // Typ erkennen
      var urlLower = url.toLowerCase();
      var hasLayers = !!(params.LAYERS || params.layers);

      // agsproxy leitet an ArcGIS REST weiter – IMMER als arcgis behandeln,
      // auch wenn LAYERS=show:… gesetzt ist (das ist ArcGIS-Syntax, kein WMS)
      var isAgsproxy = urlLower.indexOf('agsproxy') > -1;
      var isArcGIS = isAgsproxy || (
        !hasLayers && urlLower.indexOf('arcgis/rest') > -1
      );

      if (isArcGIS) {
        layerType = 'arcgis';
      } else if (hasLayers || urlLower.indexOf('wms') > -1 || urlLower.indexOf('mapserv') > -1) {
        layerType = 'wms';
      } else {
        return; // XYZ-Tiles etc. → Server-Rendering nicht möglich
      }

      // Absolute URL
      if (url.indexOf('//') === -1) {
        url = window.location.origin + (url.charAt(0) === '/' ? '' : '/') + url;
      }

      infos.push({
        type:    layerType,
        url:     url,
        layers:  params.LAYERS || params.layers || '',
        opacity: layer.getOpacity(),
        params:  params,
        name:    layer.get('name') || layer.get('title') || ''
      });
    });
    return infos;
  }

  /**
   * Baut eine WMS-GetMap-URL mit exakten Parametern.
   *
   * @param {Object} info     - Layer-Info aus collectLayerInfos
   * @param {Array}  bbox     - [minX, minY, maxX, maxY] in LV95
   * @param {number} widthPx  - Bildbreite in Pixel
   * @param {number} heightPx - Bildhöhe in Pixel
   * @param {number} dpi      - Druckauflösung
   * @param {string} format   - 'image/png' oder 'image/jpeg'
   * @returns {string}
   */
  function buildWmsGetMapUrl(info, bbox, widthPx, heightPx, dpi, format) {
    var base = info.url.split('?')[0];
    var p = {
      SERVICE:     'WMS',
      VERSION:     info.params.VERSION || '1.3.0',
      REQUEST:     'GetMap',
      LAYERS:      info.layers,
      CRS:         'EPSG:2056',
      BBOX:        bbox.join(','),
      WIDTH:       widthPx,
      HEIGHT:      heightPx,
      FORMAT:      format || 'image/png',
      TRANSPARENT: 'TRUE',
      DPI:         dpi,
      FORMAT_OPTIONS: 'dpi:' + dpi
    };
    // Styles übernehmen falls vorhanden
    if (info.params.STYLES !== undefined) p.STYLES = info.params.STYLES;
    if (info.params.SLD_BODY) p.SLD_BODY = info.params.SLD_BODY;

    var qs = Object.keys(p).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(p[k]);
    }).join('&');
    return base + '?' + qs;
  }

  /**
   * Baut eine ArcGIS REST export-URL mit exakten Parametern.
   *
   * @param {Object} info     - Layer-Info aus collectLayerInfos
   * @param {Array}  bbox     - [minX, minY, maxX, maxY] in LV95
   * @param {number} widthPx  - Bildbreite in Pixel
   * @param {number} heightPx - Bildhöhe in Pixel
   * @param {number} dpi      - Druckauflösung
   * @param {string} format   - 'png' oder 'jpg'
   * @returns {string}
   */
  function buildArcGISExportUrl(info, bbox, widthPx, heightPx, dpi, format) {
    // URL aufsplitten: agsproxy.php?path=... hat bereits Query-String
    var url = info.url.replace(/\/?$/, '');
    var qIdx = url.indexOf('?');
    var base, existingQs;

    if (qIdx > -1) {
      base = url.substring(0, qIdx);
      existingQs = url.substring(qIdx + 1);
      // agsproxy: /export an den path-Parameter-Wert anhängen
      if (existingQs.indexOf('path=') > -1) {
        existingQs = existingQs.replace(/(path=[^&]*)/, function (m) {
          return m.replace(/\/?$/, '') + '/export';
        });
      }
    } else {
      base = url;
      existingQs = '';
      // Direkte ArcGIS-URL: /export an Basis anhängen
      if (base.toLowerCase().indexOf('/export') === -1) {
        base += '/export';
      }
    }

    // Doppeltes show:-Prefix vermeiden
    var layers = info.layers ? String(info.layers) : '';
    var layerParam = '';
    if (layers) {
      layerParam = layers.indexOf('show:') === 0 ? layers : ('show:' + layers);
    }

    var p = {
      bbox:           bbox.join(','),
      bboxSR:         '2056',
      imageSR:        '2056',
      size:           widthPx + ',' + heightPx,
      dpi:            dpi,
      format:         format || 'png32',
      transparent:    'true',
      f:              'image',
      layers:         layerParam
    };
    var qs = Object.keys(p).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(p[k]);
    }).join('&');

    // Bei vorhandenem Query-String mit & verbinden statt mit ?
    if (existingQs) {
      return base + '?' + existingQs + '&' + qs;
    }
    return base + '?' + qs;
  }

  /**
   * Fordert Kartenbilder direkt von den Mapservern an und
   * merged sie auf einem Canvas zusammen.
   *
   * @param {ol.Map}  map           - OpenLayers Map
   * @param {Array}   bbox          - [minX, minY, maxX, maxY] in LV95
   * @param {number}  widthPx       - Bildbreite in Pixel
   * @param {number}  heightPx      - Bildhöhe in Pixel
   * @param {number}  dpi           - Druckauflösung
   * @param {Object}  [opts]        - {format:'image/png'|'image/jpeg'}
   * @param {Function} [onProgress] - Fortschritts-Callback
   * @returns {Promise<HTMLCanvasElement>}
   */
  function renderServerImages(map, bbox, widthPx, heightPx, dpi, opts, onProgress) {
    opts = opts || {};
    var format = opts.format || 'image/png';
    var useSvg = !!opts.svgFormat;
    var layerInfos = collectLayerInfos(map);

    if (layerInfos.length === 0) {
      console.warn('[ServerRender] Keine WMS/ArcGIS-Layer gefunden');
      // Leeres transparentes Canvas zurückgeben
      var empty = document.createElement('canvas');
      empty.width = widthPx; empty.height = heightPx;
      return Promise.resolve(empty);
    }

    console.log('[ServerRender] Starte direktes Server-Rendering:',
      layerInfos.length, 'Layer,',
      widthPx + '×' + heightPx, 'px, DPI:', dpi,
      'BBOX:', bbox.map(function(v){return v.toFixed(1)}).join(', '));

    // Bild-URLs generieren
    var requests = layerInfos.map(function (info, idx) {
      var url;
      if (info.type === 'arcgis') {
        var agsFmt = useSvg ? 'svg' : ((format === 'image/jpeg') ? 'jpg' : 'png32');
        url = buildArcGISExportUrl(info, bbox, widthPx, heightPx, dpi, agsFmt);
      } else {
        var wmsFmt = useSvg ? 'image/svg+xml' : format;
        url = buildWmsGetMapUrl(info, bbox, widthPx, heightPx, dpi, wmsFmt);
      }
      console.log('[ServerRender] Layer', idx, info.name || info.layers,
        '(' + info.type + '):', url.substring(0, 120) + '...');
      return { info: info, url: url, index: idx };
    });

    // Alle Bilder parallel laden
    var promises = requests.map(function (req) {
      return new Promise(function (resolve) {
        var img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = function () {
          console.log('[ServerRender] ✓ Layer', req.index, req.info.name || req.info.layers,
            img.naturalWidth + '×' + img.naturalHeight);
          resolve({ img: img, info: req.info, ok: true });
        };
        img.onerror = function (e) {
          console.error('[ServerRender] ✗ Layer', req.index, req.info.name || req.info.layers,
            'Fehler:', e.type || e);
          resolve({ img: null, info: req.info, ok: false });
        };
        img.src = req.url;
      });
    });

    return Promise.all(promises).then(function (results) {
      // Canvas erstellen und Layer zusammenführen
      var canvas = document.createElement('canvas');
      canvas.width = widthPx;
      canvas.height = heightPx;
      var ctx = canvas.getContext('2d');
      // Weisser Hintergrund
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, widthPx, heightPx);

      var drawn = 0;
      var failed = 0;
      var failedNames = [];
      results.forEach(function (r) {
        if (!r.ok || !r.img) {
          failed++;
          failedNames.push(r.info.name || r.info.layers || '(unbekannt)');
          return;
        }
        ctx.globalAlpha = r.info.opacity !== undefined ? r.info.opacity : 1;
        ctx.drawImage(r.img, 0, 0, widthPx, heightPx);
        drawn++;
      });
      ctx.globalAlpha = 1;

      console.log('[ServerRender] Merge-Ergebnis:',
        drawn, 'Layer gezeichnet,', failed, 'fehlgeschlagen,',
        canvas.width + '×' + canvas.height, 'px');

      // Warnung anzeigen wenn Layer fehlgeschlagen sind
      if (failed > 0 && onProgress) {
        var warnMsg = failed + ' von ' + results.length + ' Layern fehlgeschlagen';
        if (failedNames.length > 0) warnMsg += ': ' + failedNames.join(', ');
        onProgress(-1, warnMsg);
      }
      if (drawn === 0 && results.length > 0) {
        console.error('[ServerRender] ALLE Layer fehlgeschlagen – Karte wird leer sein!');
      }

      // Vector-Overlay (Redlining) vom OL-Canvas holen
      var vectorCanvas = renderVectorOverlay(map, bbox, widthPx, heightPx);
      if (vectorCanvas) {
        ctx.drawImage(vectorCanvas, 0, 0);
        console.log('[ServerRender] Vector-Overlay hinzugefügt');
      }

      if (onProgress) onProgress(4, 'Server-Bilder geladen');
      return canvas;
    });
  }

  /**
   * Rendert nur die Vector-Layer (Redlining, Bemassungen) auf ein separates Canvas.
   * Braucht eine temporäre OL-Map-Instanz mit den gleichen Vector-Layern.
   *
   * @param {ol.Map}  map      - OpenLayers Map
   * @param {Array}   bbox     - [minX, minY, maxX, maxY]
   * @param {number}  widthPx  - Bildbreite
   * @param {number}  heightPx - Bildhöhe
   * @returns {HTMLCanvasElement|null}
   */
  function renderVectorOverlay(map, bbox, widthPx, heightPx) {
    // Prüfen ob Vector-Layer mit Features vorhanden
    var hasVectors = false;
    map.getLayers().forEach(function (layer) {
      if (!layer.getVisible || !layer.getVisible()) return;
      var src = layer.getSource && layer.getSource();
      if (src && typeof src.getFeatures === 'function' && src.getFeatures().length > 0) {
        hasVectors = true;
      }
    });
    if (!hasVectors) return null;

    // OL rendert Vektoren direkt auf Canvas im DOM.
    // Wir lesen die bestehenden Canvas-Elemente der Vector-Layer.
    // Da der Viewport ggf. andere Dimensionen hat, skalieren wir.
    try {
      var vpSize = map.getSize();
      if (!vpSize || vpSize[0] === 0) return null;

      var canvas = document.createElement('canvas');
      canvas.width = widthPx;
      canvas.height = heightPx;
      var ctx = canvas.getContext('2d');
      var scaleX = widthPx / vpSize[0];
      var scaleY = heightPx / vpSize[1];

      // Nur Vector-Layer-Canvas kopieren
      var vectorLayers = document.querySelectorAll('.ol-layer canvas');
      var found = false;
      for (var i = 0; i < vectorLayers.length; i++) {
        var lc = vectorLayers[i];
        // OL vector layers: der Layer muss ein VectorLayer sein
        // Heuristik: Prüfe ob der Canvas tatsächlich sichtbare Pixel hat
        // (Raster-Canvas haben Pixel, Vector-Canvas nur wenn Features da sind)
        // → Wir setzen auf die bekannte Layer-Reihenfolge in OL
        if (lc.width > 0 && lc.height > 0) {
          // Prüfe ob das zugehörige OL-Layer ein VectorLayer ist
          var parentLayer = lc.closest && lc.closest('.ol-layer');
          if (parentLayer) {
            var layerIndex = Array.from(
              document.querySelectorAll('.ol-layer')
            ).indexOf(parentLayer);
            var olLayers = map.getLayers().getArray();
            if (layerIndex >= 0 && layerIndex < olLayers.length) {
              var olLayer = olLayers[layerIndex];
              var src = olLayer.getSource && olLayer.getSource();
              if (src && typeof src.getFeatures === 'function') {
                ctx.save();
                ctx.scale(scaleX, scaleY);
                var op = parentLayer.style.opacity;
                ctx.globalAlpha = op === '' ? 1 : Number(op);
                var tf = lc.style.transform;
                var m = tf && tf.match(/matrix\(([^)]+)\)/);
                if (m) {
                  var mx = m[1].split(',').map(Number);
                  ctx.transform(mx[0], mx[1], mx[2], mx[3], mx[4], mx[5]);
                }
                ctx.drawImage(lc, 0, 0);
                ctx.restore();
                found = true;
              }
            }
          }
        }
      }
      return found ? canvas : null;
    } catch (e) {
      console.warn('[ServerRender] Vector-Overlay Fehler:', e);
      return null;
    }
  }

  // ---------------------------------------------------------------- //
  //  OL Map → Canvas                                                  //
  // ---------------------------------------------------------------- //

  /**
   * Rendert die OL-Karte in ein Canvas mit exakten Druckpixel-Dimensionen.
   *
   * Verwendet map.setSize() um die OL-interne Grösse direkt auf die
   * Druckpixel zu setzen — OHNE DOM-Manipulation. Dadurch entfällt:
   * - CSS-Constraint-Workaround (position:fixed off-screen)
   * - vpScale-Transformation (OL-Canvases sind bereits in Druckpixeln)
   * - view.fit() (Resolution wird direkt gesetzt)
   *
   * Die Map wird nach dem Render auf die ursprüngliche Grösse/View
   * zurückgesetzt (vollständig gekapselt).
   *
   * @param {ol.Map}    map     – OL-Karte
   * @param {number[]}  center  – [x, y] in Kartenkoordinaten (z.B. LV95)
   * @param {number}    resolution – Ziel-Resolution (m/px)
   * @param {number}    pxW     – Canvas-Breite in Druckpixeln
   * @param {number}    pxH     – Canvas-Höhe in Druckpixeln
   * @param {Object}    [opts]  – { dpi }
   * @returns {Promise<HTMLCanvasElement>}
   */
  /**
   * Off-Screen-Rendering: Erzeugt ein Canvas mit dem Kartenausschnitt
   * in exakter Druckauflösung.
   *
   * Ansatz (basierend auf dem offiziellen OL Export-PDF-Beispiel):
   *   1. Unsichtbares DIV als Target
   *   2. Neue ol.Map-Instanz mit pixelRatio:1 (kein DPR-Skalierung!)
   *   3. Sichtbare Layer referenzieren (geteilte Sources)
   *   4. View mit exaktem Center + Resolution
   *   5. rendercomplete → Canvas-Compositing (CSS-Transform 1:1)
   *   6. Off-Screen-Map zerstören, DPI-Params zurücksetzen
   *
   * Die On-Screen-Map wird NICHT verändert → kein ResizeObserver-Problem,
   * kein State-Restore nötig.
   *
   * @param {ol.Map}    map        Die Haupt-Map (für Layer-Referenzen + Projection)
   * @param {number[]}  center     Kartenzentrum [x, y] in Projektionskoordinaten
   * @param {number}    resolution Ziel-Resolution in m/px
   * @param {number}    pxW        Canvas-Breite in Pixel
   * @param {number}    pxH        Canvas-Höhe in Pixel
   * @param {Object}    opts       Optionen: { dpi, rotation }
   * @returns {Promise<HTMLCanvasElement>}
   */
  function renderMapCanvas(map, center, resolution, pxW, pxH, opts) {
    opts = opts || {};
    var printDpi = opts.dpi || 150;
    var serverDpi = opts.serverDpi || 96;  // DPI für Mapserver-Requests (Schraffuren)
    var rotation = opts.rotation || map.getView().getRotation() || 0;

    return new Promise(function (resolve, reject) {

      // ── 1. Hilfs-Funktion: WMS-Source mit Server-DPI klonen ──
      // Erstellt eine NEUE Source-Instanz mit DPI-Params für Mapserver.
      // serverDpi (96) != printDpi (150/300) → scharfes PDF + korrekte Schraffuren
      // Original-Sources der On-Screen-Map werden NICHT verändert!
      var dpiClonedCount = 0;
      function cloneSourceWithDpi(src) {
        if (!src || typeof src.updateParams !== 'function') return src;
        // VectorSource NICHT anfassen (Redlining-Schutz)
        if (typeof src.getFeatures === 'function') return src;
        if (serverDpi <= 96) return src;

        var origParams = src.getParams();
        var newParams = Object.assign({}, origParams);
        newParams['FORMAT_OPTIONS'] = 'dpi:' + serverDpi;
        newParams['DPI'] = serverDpi;
        newParams['dpi'] = serverDpi;
        if (newParams['WIDTH'])  newParams['WIDTH']  = Math.round(newParams['WIDTH']  * serverDpi / 96);
        if (newParams['HEIGHT']) newParams['HEIGHT'] = Math.round(newParams['HEIGHT'] * serverDpi / 96);

        var clonedSrc;
        if (src instanceof ol.source.TileWMS) {
          clonedSrc = new ol.source.TileWMS({
            url: src.getUrls ? src.getUrls()[0] : undefined,
            params: newParams,
            crossOrigin: 'anonymous',
            transition: 0
          });
        } else if (src instanceof ol.source.ImageWMS) {
          clonedSrc = new ol.source.ImageWMS({
            url: src.getUrl(),
            params: newParams,
            crossOrigin: 'anonymous'
          });
        } else if (typeof ol.source.TileArcGISRest !== 'undefined' &&
                   src instanceof ol.source.TileArcGISRest) {
          clonedSrc = new ol.source.TileArcGISRest({
            url: src.getUrls ? src.getUrls()[0] : undefined,
            params: newParams,
            crossOrigin: 'anonymous'
          });
        } else {
          // Unbekannter Source-Typ mit updateParams → Original behalten
          return src;
        }
        dpiClonedCount++;
        _dbg('[TemplatePDF] Source DPI-Klon erstellt: serverDpi=' + serverDpi,
          'für', src.constructor.name || 'WMS');
        return clonedSrc;
      }

      // ── 2. Sichtbare Layer klonen (neue Instanz, geklonte Source) ──
      //    OL-Layers können nur zu EINER Map gehören.
      //    WMS-Sources werden mit Druck-DPI geklont → On-Screen unberührt.
      function cloneLayerForPrint(layer) {
        var src = layer.getSource ? layer.getSource() : null;
        var printSrc = cloneSourceWithDpi(src);
        var baseOpts = {
          opacity: layer.getOpacity(),
          visible: true,
          zIndex: layer.getZIndex(),
          minResolution: layer.getMinResolution(),
          maxResolution: layer.getMaxResolution()
        };
        if (layer instanceof ol.layer.Group) {
          var subLayers = [];
          layer.getLayers().forEach(function (sub) {
            if (sub.getVisible && sub.getVisible()) {
              subLayers.push(cloneLayerForPrint(sub));
            }
          });
          return new ol.layer.Group(Object.assign(baseOpts, { layers: subLayers }));
        }
        if (layer instanceof ol.layer.VectorTile) {
          return new ol.layer.VectorTile(Object.assign(baseOpts, {
            source: printSrc,
            style: layer.getStyle ? layer.getStyle() : undefined
          }));
        }
        if (layer instanceof ol.layer.Vector) {
          return new ol.layer.Vector(Object.assign(baseOpts, {
            source: printSrc,
            style: layer.getStyle ? layer.getStyle() : undefined
          }));
        }
        if (layer instanceof ol.layer.Tile) {
          return new ol.layer.Tile(Object.assign(baseOpts, { source: printSrc }));
        }
        if (layer instanceof ol.layer.Image) {
          return new ol.layer.Image(Object.assign(baseOpts, { source: printSrc }));
        }
        // Fallback: Tile-Layer
        return new ol.layer.Tile(Object.assign(baseOpts, { source: printSrc }));
      }

      var printLayers = [];
      map.getLayers().forEach(function (layer) {
        if (layer.getVisible && layer.getVisible()) {
          printLayers.push(cloneLayerForPrint(layer));
        }
      });

      // ── 3. Off-Screen-Target-DIV erstellen ──
      var offDiv = document.createElement('div');
      offDiv.style.cssText =
        'position:absolute;left:-9999px;top:-9999px;' +
        'width:' + pxW + 'px;height:' + pxH + 'px;' +
        'overflow:hidden;';
      document.body.appendChild(offDiv);

      // ── 4. Off-Screen-View + Map erstellen ──
      var proj = map.getView().getProjection();

      var offView = new ol.View({
        projection: proj,
        center: center,
        resolution: resolution,
        rotation: rotation
      });

      var offMap = new ol.Map({
        target: offDiv,
        pixelRatio: 1,       // KRITISCH: Kein DPR-Skalierung!
        layers: printLayers,
        view: offView,
        controls: [],
        interactions: []
      });

      // ── Logging ──
      console.log('┌─────────────────────────────────────────────────────');
      console.log('│ [RENDER] Off-Screen renderMapCanvas');
      console.log('├─────────────────────────────────────────────────────');
      console.log('│ Off-Screen-DIV:', pxW + '×' + pxH, 'px');
      console.log('│ pixelRatio: 1 (window.devicePixelRatio=' + window.devicePixelRatio + ')');
      console.log('│ Projektion:', proj.getCode(), 'mpu=' + proj.getMetersPerUnit());
      console.log('│ Center:', center[0].toFixed(2) + ' / ' + center[1].toFixed(2));
      console.log('│ Resolution:', resolution.toFixed(10), 'm/px');
      console.log('│ Rotation:', (rotation * 180 / Math.PI).toFixed(1) + '°');
      console.log('│ PDF-DPI:', printDpi, ' / Server-DPI:', serverDpi);
      console.log('│ Sichtbare Layer:', printLayers.length);
      console.log('│ DPI-Quellen geklont:', dpiClonedCount);
      var expectedExtentW = pxW * resolution;
      var expectedExtentH = pxH * resolution;
      console.log('│ Erwarteter Extent:', expectedExtentW.toFixed(2) + ' × ' +
        expectedExtentH.toFixed(2), 'm');
      console.log('│ Erwartete BBOX: [' +
        (center[0] - expectedExtentW / 2).toFixed(2) + ', ' +
        (center[1] - expectedExtentH / 2).toFixed(2) + ', ' +
        (center[0] + expectedExtentW / 2).toFixed(2) + ', ' +
        (center[1] + expectedExtentH / 2).toFixed(2) + ']');
      console.log('└─────────────────────────────────────────────────────');

      // ── 5. rendercomplete-Handler + renderSync ──
      offMap.once('rendercomplete', function () {
        try {
          var size = offMap.getSize();
          var rcRes = offView.getResolution();
          var rcCtr = offView.getCenter();

          console.log('┌─────────────────────────────────────────────────────');
          console.log('│ [RENDER] Off-Screen rendercomplete');
          console.log('├─────────────────────────────────────────────────────');
          console.log('│ offMap.getSize():', JSON.stringify(size),
            size[0] === pxW && size[1] === pxH ? '✓' : '✗ SOLL: [' + pxW + ',' + pxH + ']');
          console.log('│ view.getResolution():', rcRes,
            Math.abs(rcRes - resolution) < 1e-10 ? '✓' : '✗ SOLL: ' + resolution);
          console.log('│ view.getCenter():', JSON.stringify(rcCtr));
          console.log('│ Extent:', (size[0] * rcRes).toFixed(2) + ' × ' +
            (size[1] * rcRes).toFixed(2), 'm');

          // ── 6. Canvas-Compositing (OL-Referenz-Pattern) ──
          var canvas = document.createElement('canvas');
          canvas.width  = pxW;
          canvas.height = pxH;
          var ctx = canvas.getContext('2d');

          // Nur im Off-Screen-DIV suchen (nicht global im DOM!)
          var layerCanvases = offDiv.querySelectorAll('.ol-layer canvas');
          console.log('│ Layer-Canvases:', layerCanvases.length);

          for (var i = 0; i < layerCanvases.length; i++) {
            var lc = layerCanvases[i];
            if (lc.width > 0) {
              var op = lc.parentNode && lc.parentNode.style
                ? lc.parentNode.style.opacity : '';
              ctx.globalAlpha = op === '' ? 1 : Number(op);
              var tf = lc.style.transform;
              var mat = tf && tf.match(/^matrix\(([^)]+)\)$/);

              console.log('│ Layer[' + i + ']: ' + lc.width + '×' + lc.height +
                ' (Soll: ' + pxW + '×' + pxH +
                ', Ratio: ' + (lc.width / pxW).toFixed(4) + ')' +
                ' transform: ' + (tf || 'keine'));

              if (mat) {
                var mx = mat[1].split(',').map(Number);
                console.log('│   Matrix: [' +
                  mx[0].toFixed(4) + ',' + mx[1].toFixed(4) + ',' +
                  mx[2].toFixed(4) + ',' + mx[3].toFixed(4) + ',' +
                  mx[4].toFixed(1) + ',' + mx[5].toFixed(1) + ']' +
                  (Math.abs(mx[0] - 1.0) > 0.001 ? ' ⚠ scaleX≠1' : ''));
                ctx.setTransform(mx[0], mx[1], mx[2], mx[3], mx[4], mx[5]);
              } else {
                ctx.setTransform(1, 0, 0, 1, 0, 0);
              }
              ctx.drawImage(lc, 0, 0);
            }
          }
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.globalAlpha = 1;
          console.log('└─────────────────────────────────────────────────────');

          // ── 7. Cleanup: Off-Screen-Map zerstören ──
          // Geklonte Layer werden mit dispose() automatisch aufgeräumt
          offMap.setTarget(null);
          offMap.dispose();
          if (offDiv.parentNode) {
            offDiv.parentNode.removeChild(offDiv);
          }

          // DPI: Kein Restore nötig — Sources wurden geklont, nicht modifiziert

          _dbg('[TemplatePDF] Off-Screen-Map zerstört, Canvas:',
            canvas.width + '×' + canvas.height);

          resolve(canvas);
        } catch (err) {
          // Bei Fehler trotzdem aufräumen
          try {
            offMap.setTarget(null);
            offMap.dispose();
          } catch (e) { /* ignore */ }
          if (offDiv.parentNode) {
            offDiv.parentNode.removeChild(offDiv);
          }
          // DPI: Kein Restore nötig — Sources wurden geklont, nicht modifiziert
          reject(err);
        }
      });

      offMap.renderSync();
    });
  }

  // ---------------------------------------------------------------- //
  //  PDF-Text-Overlays (Fallback)                                     //
  // ---------------------------------------------------------------- //

  /**
   * Zeichnet Text-Overlays für Elemente aus dem Manifest,
   * falls die SVG-Ersetzung nicht möglich war (z.B. ältere Templates
   * ohne {{PLACEHOLDER}}-Muster oder ohne Element-IDs).
   *
   * Nutzt die im Manifest gespeicherten Positionen (mm), Font-Infos
   * und Alignment, um den Text exakt zu platzieren.
   */
  function drawPdfTextOverlays(pdf, elements, values) {
    if (!elements || !elements.length) return;

    var variableValues = {
      'title':       values.title || '',
      'scale':       '',  // Wird dynamisch als SCALE_LABEL gezeichnet
      'coordinates': values.coords ? ('LV95: ' + values.coords) : '',
      'date':        values.date ? ('Erstellt am: ' + values.date) : ''
    };

    elements.forEach(function (elem) {
      if (elem.type !== 'text' || !elem.variable) return;
      var text = variableValues[elem.variable];
      if (!text) return;

      // Weisses Rechteck → verdeckt den Original-Text im SVG
      pdf.setFillColor(250, 250, 250);
      pdf.rect(elem.x_mm, elem.y_mm, elem.width_mm, elem.height_mm, 'F');

      // Text zeichnen
      pdf.setTextColor(0, 0, 0);
      var fs = elem.fontSize_pt || 10;
      pdf.setFontSize(fs);
      var _fontName = (typeof window.mapFontFamily === 'function')
        ? window.mapFontFamily(elem.fontFamily) : (elem.fontFamily || 'Inter');
      var _fontStyle = (typeof window.mapFontWeight === 'function')
        ? window.mapFontWeight(elem.fontWeight) : (elem.fontWeight === 'bold' ? 'bold' : 'normal');
      pdf.setFont(_fontName, _fontStyle);

      // Textposition: vertikal zentriert
      var textY = elem.y_mm + elem.height_mm * 0.65;
      var align = elem.hAlign || 'left';
      var textX;
      if (align === 'center') {
        textX = elem.x_mm + elem.width_mm / 2;
      } else if (align === 'right') {
        textX = elem.x_mm + elem.width_mm - 2;
      } else {
        textX = elem.x_mm + 2;
        align = 'left';
      }
      pdf.text(text, textX, textY, { align: align });
      console.log('[TemplatePDF] PDF-Overlay:', elem.id, '→', text);
    });

    // Font zurücksetzen
    pdf.setFont('Inter', 'normal');
    pdf.setFontSize(10);
  }

  // ---------------------------------------------------------------- //
  //  SVG-Bbox-Erkennung                                               //
  //  (Rote Bboxen aus QGIS-Export → Positionen für dynamische Elemente) //
  // ---------------------------------------------------------------- //

  /**
   * Sucht im SVG nach roten Bbox-Rechtecken, die vom QGIS-Plugin
   * als Platzhalter für dynamische Elemente eingefügt wurden.
   *
   * Diese Rects haben:
   *   - id="NORTH_ARROW" / "SCALE_BAR" / "SCALE_LABEL"
   *   - stroke="#FF0000" (rot)
   *   - data-dynamic-type="northArrow" etc.
   *
   * @param {string} svgText  - SVG-Quelltext
   * @param {number} paperW   - Papierbreite in mm
   * @param {number} paperH   - Papierhöhe in mm
   * @returns {Array} Array von {id, type, x_mm, y_mm, width_mm, height_mm}
   */
  function extractDynamicBboxes(svgText, paperW, paperH) {
    var parser = new DOMParser();
    var doc = parser.parseFromString(svgText, 'image/svg+xml');
    var svg = doc.documentElement;
    var bboxes = [];

    // ViewBox für Koordinaten-Umrechnung
    var vb = svg.getAttribute('viewBox');
    if (!vb) return bboxes;
    var parts = vb.split(/[\s,]+/).map(Number);
    var vbW = parts[2], vbH = parts[3];
    if (!vbW || !vbH) return bboxes;

    var sx = paperW / vbW;  // mm pro SVG-Unit
    var sy = paperH / vbH;

    // Bekannte dynamische Element-IDs
    var knownIds = {
      'NORTH_ARROW': 'northArrow',
      'SCALE_BAR':   'scaleBar',
      'SCALE_LABEL': 'scaleLabel'
    };

    // Suche alle <rect> mit bekannten IDs ODER data-dynamic-type
    var rects = doc.querySelectorAll('rect[id]');
    for (var i = 0; i < rects.length; i++) {
      var rect = rects[i];
      var id = rect.getAttribute('id') || '';
      var dynType = rect.getAttribute('data-dynamic-type') || '';
      var stroke = rect.getAttribute('stroke') || '';

      var type = knownIds[id] || dynType;
      if (!type) continue;

      // Optional: nur rote Rects (Sicherheitscheck)
      // Akzeptiere auch ohne Farbcheck falls ID passt
      var x = parseFloat(rect.getAttribute('x')) || 0;
      var y = parseFloat(rect.getAttribute('y')) || 0;
      var w = parseFloat(rect.getAttribute('width')) || 0;
      var h = parseFloat(rect.getAttribute('height')) || 0;

      bboxes.push({
        id:        id,
        type:      type,
        x_mm:      x * sx,
        y_mm:      y * sy,
        width_mm:  w * sx,
        height_mm: h * sy
      });

      console.log('[TemplatePDF] SVG-Bbox gefunden:', id, type,
        { x_mm: (x * sx).toFixed(1), y_mm: (y * sy).toFixed(1),
          w_mm: (w * sx).toFixed(1), h_mm: (h * sy).toFixed(1) });
    }

    return bboxes;
  }

  /**
   * Entfernt die roten Bbox-Rects aus dem SVG, damit sie
   * nicht im PDF sichtbar sind.
   *
   * @param {string} svgText - SVG-Quelltext
   * @returns {string} Bereinigter SVG-Text
   */
  function removeDynamicBboxes(svgText) {
    // Entferne den Kommentar-Block und die Bbox-Rects
    var result = svgText.replace(
      /\s*<!--\s*Dynamic element bboxes.*?-->\s*/g, '\n'
    );
    // Entferne <rect> mit bekannten IDs oder data-dynamic-type
    result = result.replace(
      /<rect\s+[^>]*(?:id="(?:NORTH_ARROW|SCALE_BAR|SCALE_LABEL)"|data-dynamic-type=")[^>]*\/>/g,
      ''
    );
    return result;
  }

  // ---------------------------------------------------------------- //
  //  Dynamische Grafik-Elemente                                       //
  //  (Nordpfeil, Massstabsbalken, Massstabstext)                      //
  // ---------------------------------------------------------------- //

  /**
   * Parsed die numerische Massstabszahl aus dem formatierten Text.
   * z.B. "1:10'000" → 10000
   */
  function parseScaleNumber(scaleText) {
    if (!scaleText) return 0;
    var m = scaleText.match(/1\s*:\s*([\d\s''\u2019\u2018\u00A0.,]+)/);
    if (!m) return 0;
    return parseInt(m[1].replace(/[^0-9]/g, ''), 10) || 0;
  }

  /**
   * Zeichnet dynamische Grafik-Elemente (Nordpfeil, Massstabsbalken,
   * Massstabstext) auf das PDF. Überschreibt die statischen QGIS-
   * Elemente mit weissen Rechtecken und zeichnet dynamische Versionen.
   *
   * Positionen werden bevorzugt aus SVG-Bboxen gelesen (vom QGIS-Plugin
   * eingefügte rote Rechtecke). Falls keine Bboxen vorhanden, werden
   * die Positionen aus dem manifest.json (template.elements) verwendet.
   *
   * @param {jsPDF}  pdf            - jsPDF-Instanz
   * @param {Object} template       - Template-Objekt aus manifest.json
   * @param {Object} exportOptions  - Optionen aus exportPdf()
   * @param {Array}  [svgBboxes]    - Aus SVG extrahierte Bbox-Positionen
   */
  function drawDynamicElements(pdf, template, exportOptions, svgBboxes) {
    var rotationDeg = exportOptions.rotation || 0;
    var scaleText   = exportOptions.scaleText || '';
    var scaleNumber = exportOptions.scaleNumber || parseScaleNumber(scaleText);

    // Element-Positionen zusammenführen:
    // 1. SVG-Bboxen (Priorität — exakte Positionen aus dem QGIS-Export)
    // 2. Manifest-Elements (Fallback)
    var elementsMap = {};

    // Manifest-Elements als Basis
    if (template.elements) {
      template.elements.forEach(function (elem) {
        if (elem.type === 'northArrow' || elem.type === 'scaleBar' || elem.type === 'scaleLabel') {
          elementsMap[elem.type] = elem;
        }
      });
    }

    // SVG-Bboxen überschreiben Manifest-Positionen
    if (svgBboxes && svgBboxes.length) {
      svgBboxes.forEach(function (bbox) {
        elementsMap[bbox.type] = bbox;
      });
      console.log('[TemplatePDF] Positionen aus SVG-Bboxen:', svgBboxes.length);
    }

    // Zeichnen
    for (var type in elementsMap) {
      var elem = elementsMap[type];
      switch (type) {
        case 'northArrow':
          drawNorthArrow(pdf, elem, rotationDeg);
          break;
        case 'scaleBar':
          drawScaleBar(pdf, elem, scaleNumber);
          break;
        case 'scaleLabel':
          drawScaleLabel(pdf, elem, scaleText);
          break;
      }
    }
  }

  /**
   * Zeichnet einen dynamisch rotierten Nordpfeil.
   * Überschreibt den statischen QGIS-Nordpfeil mit einem weissen
   * Rechteck und zeichnet einen neuen Pfeil, der um den Kartenwinkel
   * rotiert ist.
   *
   * Form: Klassischer Kite-Pfeil (linke Hälfte schwarz, rechte weiss)
   * mit "N"-Buchstabe darüber.
   *
   * @param {jsPDF}  pdf          - jsPDF-Instanz
   * @param {Object} elem         - Element-Definition aus manifest.json
   * @param {number} rotationDeg  - Kartenrotation in Grad (OL: CW positiv)
   */
  function drawNorthArrow(pdf, elem, rotationDeg) {
    var cx = elem.x_mm + elem.width_mm / 2;
    var cy = elem.y_mm + elem.height_mm / 2;
    var w  = elem.width_mm;
    var h  = elem.height_mm;

    // Transparenter Hintergrund — kein weisses Rechteck

    // Rotation: Karte CW um rotationDeg° → Nordpfeil CCW um rotationDeg°
    // In Screen-Coords (y nach unten): negativer Winkel = CCW
    var rad  = (-rotationDeg) * Math.PI / 180;
    var cosA = Math.cos(rad);
    var sinA = Math.sin(rad);

    // Punkt um (cx, cy) rotieren
    function rot(x, y) {
      var dx = x - cx, dy = y - cy;
      return [cx + dx * cosA - dy * sinA, cy + dx * sinA + dy * cosA];
    }

    // Pfeil-Proportionen (basierend auf Original-QGIS-Nordpfeil)
    // SVG-Original: B=16, H=27.2, Einbuchtung bei 35% von unten
    var arrowW  = w * 0.35;        // halbe Breite
    var arrowH  = h * 0.55;        // Pfeil-Körperhöhe
    var indent  = arrowH * 0.35;   // Einbuchtung von unten
    var arrowCY = cy + h * 0.06;   // Pfeil leicht unter Mitte (Platz für "N")

    // Eckpunkte vor Rotation
    var pTip   = [cx,            arrowCY - arrowH / 2];       // Spitze
    var pLeft  = [cx - arrowW,   arrowCY + arrowH / 2];       // links unten
    var pRight = [cx + arrowW,   arrowCY + arrowH / 2];       // rechts unten
    var pNotch = [cx,            arrowCY + arrowH / 2 - indent]; // Einbuchtung

    // Rotierte Punkte
    var tip   = rot(pTip[0],   pTip[1]);
    var left  = rot(pLeft[0],  pLeft[1]);
    var right = rot(pRight[0], pRight[1]);
    var notch = rot(pNotch[0], pNotch[1]);

    // Linke Hälfte (gefüllt schwarz)
    pdf.setFillColor(0, 0, 0);
    pdf.setDrawColor(0, 0, 0);
    pdf.setLineWidth(0.15);
    pdf.lines([
      [left[0]  - tip[0],  left[1]  - tip[1]],
      [notch[0] - left[0], notch[1] - left[1]]
    ], tip[0], tip[1], [1, 1], 'F', true);

    // Rechte Hälfte (weiss gefüllt, schwarzer Rand)
    pdf.setFillColor(255, 255, 255);
    pdf.lines([
      [right[0] - tip[0],   right[1] - tip[1]],
      [notch[0] - right[0], notch[1] - right[1]]
    ], tip[0], tip[1], [1, 1], 'FD', true);

    // "N" Buchstabe — bleibt horizontal für Lesbarkeit
    var nPos = rot(cx, arrowCY - arrowH / 2 - h * 0.15);
    pdf.setFontSize(w * 0.55);
    pdf.setFont('Inter', 'bold');
    pdf.setTextColor(0, 0, 0);
    pdf.text('N', nPos[0], nPos[1] + 1, { align: 'center' });

    console.log('[TemplatePDF] Nordpfeil gezeichnet, Rotation:', rotationDeg + '°');
  }

  /**
   * Berechnet eine "schöne" runde Segmentlänge für den Massstabsbalken.
   * Ziel: ca. 4–5 Segmente bei gegebener Papierbreite und Massstab.
   *
   * @param {number} maxWidthMm  - max. verfügbare Breite auf Papier (mm)
   * @param {number} scaleNumber - Massstab (z.B. 10000)
   * @returns {number} Segmentlänge in Metern
   */
  function niceScaleSegment(maxWidthMm, scaleNumber) {
    var maxDistM  = maxWidthMm * scaleNumber / 1000;
    var targetSeg = maxDistM / 5;
    var magnitude = Math.pow(10, Math.floor(Math.log10(targetSeg)));
    var niceVals  = [1, 2, 2.5, 5, 10];
    for (var i = 0; i < niceVals.length; i++) {
      if (niceVals[i] * magnitude >= targetSeg * 0.8) {
        return niceVals[i] * magnitude;
      }
    }
    return magnitude * 10;
  }

  /**
   * Zeichnet einen dynamischen Massstabsbalken.
   * Alternierende schwarz/weisse Segmente mit Beschriftung.
   *
   * @param {jsPDF}  pdf         - jsPDF-Instanz
   * @param {Object} elem        - Element-Definition aus manifest.json
   * @param {number} scaleNumber - Numerischer Massstab (z.B. 10000)
   */
  function drawScaleBar(pdf, elem, scaleNumber) {
    if (!scaleNumber || scaleNumber <= 0) return;

    var x0       = elem.x_mm;
    var y0       = elem.y_mm;
    var maxWidth = elem.width_mm;
    var boxH     = elem.height_mm;

    // Transparenter Hintergrund — kein weisses Rechteck

    // Schönes Segment berechnen
    var segDistM   = niceScaleSegment(maxWidth, scaleNumber);
    var segWidthMm = segDistM * 1000 / scaleNumber;
    var numSegs    = Math.floor(maxWidth / segWidthMm);
    numSegs = Math.max(2, Math.min(numSegs, 6));

    var barWidth = numSegs * segWidthMm;
    var barH     = Math.min(boxH * 0.45, 2.0);
    var barY     = y0 + 0.5;

    // Alternierende Segmente
    pdf.setDrawColor(0, 0, 0);
    pdf.setLineWidth(0.15);
    for (var s = 0; s < numSegs; s++) {
      var segX = x0 + s * segWidthMm;
      pdf.setFillColor(s % 2 === 0 ? 0 : 255, s % 2 === 0 ? 0 : 255, s % 2 === 0 ? 0 : 255);
      pdf.rect(segX, barY, segWidthMm, barH, 'FD');
    }

    // Äusserer Rahmen
    pdf.setLineWidth(0.2);
    pdf.rect(x0, barY, barWidth, barH, 'S');

    // Beschriftungen unter dem Balken (Stil wie "Situation")
    pdf.setFontSize(7);
    pdf.setFont('Inter', 'normal');
    pdf.setTextColor(0, 0, 0);
    var labelY = barY + barH + 3;

    for (var l = 0; l <= numSegs; l++) {
      var labelX = x0 + l * segWidthMm;
      var distM  = l * segDistM;
      var label;
      if (segDistM >= 1000) {
        label = (distM / 1000).toLocaleString('de-CH');
        if (l === numSegs) label += ' km';
      } else {
        label = distM.toLocaleString('de-CH');
        if (l === numSegs) label += ' m';
      }
      var align = 'center';
      if (l === 0)        align = 'left';
      if (l === numSegs)  align = 'right';
      pdf.text(label, labelX, labelY, { align: align });
    }

    console.log('[TemplatePDF] Massstabsbalken:',
      numSegs, 'Segmente à', segDistM, 'm, Breite:', barWidth.toFixed(1), 'mm');
  }

  /**
   * Zeichnet den dynamischen Massstabstext (z.B. "1:10'000").
   *
   * @param {jsPDF}  pdf       - jsPDF-Instanz
   * @param {Object} elem      - Element-Definition aus manifest.json
   * @param {string} scaleText - Formatierter Massstab (z.B. "1:10'000")
   */
  function drawScaleLabel(pdf, elem, scaleText) {
    if (!scaleText) return;

    // Transparenter Hintergrund — kein weisses Rechteck

    // Text zeichnen (Stil wie "Situation")
    pdf.setFontSize(12);
    pdf.setFont('Inter', 'bold');
    pdf.setTextColor(0, 0, 0);
    var textY = elem.y_mm + elem.height_mm * 0.75;
    pdf.text(scaleText, elem.x_mm, textY);

    console.log('[TemplatePDF] Massstabstext:', scaleText);
  }

  // ---------------------------------------------------------------- //
  //  Debug: 100 mm Kalibrier-Linie                                    //
  // ---------------------------------------------------------------- //

  /**
   * Zeichnet die 100 mm Kalibrier-Linie + Metriken direkt ins MAP-CANVAS.
   * Aktiviert via CONFIG.debugTestLine = true.
   *
   * Die Linie geht durch denselben Skalierungspfad wie der Karteninhalt
   * (Canvas → addImage → PDF). Wenn die Linie im PDF genau 100 mm misst,
   * ist die Canvas→PDF-Skalierung korrekt.
   *
   * @param {HTMLCanvasElement} canvas  - Das Map-Canvas (vor addImage)
   * @param {Object} metrics  - { scale, dpi, resolution, extentW, extentH,
   *                              mapAreaW_mm, mapAreaH_mm, canvasW, canvasH }
   */
  function drawDebugTestLine(canvas, metrics) {
    if (!CONFIG.debugTestLine) return;

    var ctx = canvas.getContext('2d');
    var cw  = canvas.width;
    var ch  = canvas.height;

    // Umrechnung: mm → Canvas-Pixel
    // Das Canvas hat cw Pixel für mapAreaW_mm Millimeter
    var pxPerMm = cw / (metrics.mapAreaW_mm || 1);
    var lineLen_px = 100 * pxPerMm;   // 100 mm in Pixel

    // Position: unten links im Canvas, 8 mm Abstand vom Rand
    var x0 = Math.round(8 * pxPerMm);
    var y0 = Math.round(ch - 8 * pxPerMm);
    var lineW = Math.max(1, Math.round(0.5 * pxPerMm));  // 0.5 mm Strich
    var tickH = Math.round(2 * pxPerMm);

    // Rote Linie
    ctx.save();
    ctx.strokeStyle = '#FF0000';
    ctx.fillStyle   = '#FF0000';
    ctx.lineWidth   = lineW;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + lineLen_px, y0);
    ctx.stroke();

    // Endmarken
    ctx.beginPath();
    ctx.moveTo(x0, y0 - tickH);
    ctx.lineTo(x0, y0 + tickH);
    ctx.moveTo(x0 + lineLen_px, y0 - tickH);
    ctx.lineTo(x0 + lineLen_px, y0 + tickH);
    ctx.stroke();

    // Beschriftung
    var fontSize = Math.max(10, Math.round(2 * pxPerMm));
    ctx.font = fontSize + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('← 100 mm Testlinie →', x0 + lineLen_px / 2, y0 - tickH - 2);

    // Metriken-Text unter der Linie
    ctx.font = Math.max(8, Math.round(1.5 * pxPerMm)) + 'px monospace';
    ctx.textAlign = 'left';
    var lines = [
      '1:' + (metrics.scale || '?') +
      '  DPI:' + (metrics.dpi || '?') +
      '  Res:' + (metrics.resolution ? metrics.resolution.toFixed(6) : '?') + ' m/px',
      'Extent:' + (metrics.extentW ? metrics.extentW.toFixed(1) : '?') + '×' +
        (metrics.extentH ? metrics.extentH.toFixed(1) : '?') + 'm' +
      '  Canvas:' + cw + '×' + ch + 'px' +
      '  pxPerMm:' + pxPerMm.toFixed(2)
    ];
    for (var i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], x0, y0 + tickH + fontSize + i * (fontSize + 2));
    }
    ctx.restore();

    console.log('[TemplatePDF] Debug-Testlinie ins Canvas gezeichnet',
      '(100 mm =', Math.round(lineLen_px), 'px, pxPerMm =', pxPerMm.toFixed(2) + ')');
  }

  // ---------------------------------------------------------------- //
  //  Haupt-Export                                                      //
  // ---------------------------------------------------------------- //

  /**
   * Exportiert die Karte mit einem QGIS-SVG-Template als PDF.
   *
   * @param {Object} options
   * @param {ol.Map}   options.map
   * @param {Object}   options.template      - Template aus manifest.json
   * @param {string}   [options.title]       - Kartentitel
   * @param {string}   [options.scaleText]   - "1:10'000"
   * @param {number}   [options.scaleNumber] - Numerischer Massstab (z.B. 10000)
   * @param {string}   [options.coords]      - "2'600'000 / 1'200'000"
   * @param {string}   [options.date]        - "11.02.2026"
   * @param {number}   [options.rotation]    - Kartenrotation (°)
   * @param {string}   [options.filename]    - PDF-Dateiname (ohne .pdf)
   * @param {number}   [options.dpi]         - Auflösung (default: 150)
   * @param {Function} [options.onProgress]  - Callback(step, msg)
   * @returns {Promise<{blob:Blob, filename:string}>}
   */
  function exportPdf(options) {
    var _t0 = performance.now();
    var map = options.map;
    var template = options.template;
    var title = options.title || CONFIG.defaultFilename;
    var dpi = options.dpi || CONFIG.defaultDpi;
    var onProgress = options.onProgress || function () {};

    if (!map) return Promise.reject(new Error('Keine Map-Instanz'));
    if (!template) return Promise.reject(new Error('Kein Template'));

    var jsPDF = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    if (!jsPDF) return Promise.reject(new Error('jsPDF nicht geladen'));

    // ── Dateiname: <Titel>_<Format>_YYYYMMDD_HHMM.pdf ──
    var now = new Date();
    var ts = now.getFullYear() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0') + '_' +
      String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0');
    var safeTitle = (title || 'Kartenexport')
      .replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, '_').substring(0, 50);
    var paperInfo = template.paper || '';
    if (template.orientation === 'landscape') paperInfo += '_quer';
    else if (template.orientation === 'portrait') paperInfo += '_hoch';
    var filename = options.filename || (safeTitle + '_' + paperInfo + '_' + ts);

    onProgress(1, 'Lade Template...');

    return loadTemplateSvg(template)
      .then(function (svgText) {
        onProgress(2, 'Verarbeite Template...');

        // ── Papiergrösse ──
        var paperW = template.width_mm;
        var paperH = template.height_mm;

        // ── SVG viewBox ↔ mm Konsistenzprüfung ──
        var svgDims = parseSvgDimensions(svgText);
        if (svgDims && paperW && paperH) {
          // SVG-width/height in mm mit Manifest vergleichen
          var wDelta = Math.abs(svgDims.width - paperW);
          var hDelta = Math.abs(svgDims.height - paperH);
          if (wDelta > 1 || hDelta > 1) {
            console.warn('[TemplatePDF] SVG-Dimensionen weichen vom Manifest ab!',
              'SVG:', svgDims.width.toFixed(1) + '×' + svgDims.height.toFixed(1) + ' mm',
              'Manifest:', paperW.toFixed(1) + '×' + paperH.toFixed(1) + ' mm',
              'Delta:', wDelta.toFixed(1) + '/' + hDelta.toFixed(1) + ' mm');
          } else {
            _dbg('[TemplatePDF] SVG ↔ Manifest Dimensionen konsistent ✓');
          }
        }

        // ── MAP_AREA-Position in mm ──
        var mapAreaX, mapAreaY, mapAreaW, mapAreaH;

        if (template.mapFrame &&
            template.mapFrame.width_mm > 0 &&
            template.mapFrame.height_mm > 0) {
          // ▸ Manifest v1.2+: mapFrame liefert exakte mm-Werte
          //   KEIN Skalierungsfaktor nötig!
          mapAreaX = template.mapFrame.x_mm;
          mapAreaY = template.mapFrame.y_mm;
          mapAreaW = template.mapFrame.width_mm;
          mapAreaH = template.mapFrame.height_mm;

          // Auto-Fix: y_mm Unterkante → Oberkante
          // (QGIS position().y() liefert je nach Layout die Unterkante)
          if (mapAreaY + mapAreaH > paperH * 1.05) {
            console.warn('[TemplatePDF] y_mm korrigiert:', mapAreaY,
              '→', mapAreaY - mapAreaH);
            mapAreaY = mapAreaY - mapAreaH;
          }

          console.log('[TemplatePDF] MAP_AREA aus Manifest (mm):',
            { x: mapAreaX, y: mapAreaY, w: mapAreaW, h: mapAreaH });
        } else {
          // ▸ Fallback: SVG parsen → SVG-Units nach mm umrechnen
          var fallback = parseMapArea(svgText);
          var svgDims = parseSvgDimensions(svgText);
          if (!paperW) paperW = svgDims.width;
          if (!paperH) paperH = svgDims.height;
          var sx = paperW / fallback.svgWidth;
          var sy = paperH / fallback.svgHeight;
          mapAreaX = fallback.x * sx;
          mapAreaY = fallback.y * sy;
          mapAreaW = fallback.width * sx;
          mapAreaH = fallback.height * sy;
          console.log('[TemplatePDF] MAP_AREA via SVG-Parsing (mm):',
            { x: mapAreaX, y: mapAreaY, w: mapAreaW, h: mapAreaH });
        }

        // ── Dynamische Bbox-Positionen aus SVG extrahieren ──
        // Rote Bboxen vom QGIS-Plugin → Positionen für Nordpfeil etc.
        var svgBboxes = extractDynamicBboxes(svgText, paperW, paperH);

        // ── SVG-Platzhalter ersetzen (3 Strategien) ──
        var dynValues = {
          title:     title,
          scaleText: options.scaleText || '',
          coords:    options.coords || '',
          date:      options.date || ''
        };

        // 1. {{PLACEHOLDER}}-Muster (v1.3 Plugin mit textRenderFormat)
        var processedSvg = replaceMustachePlaceholders(svgText, dynValues);

        // 2. Element-IDs: id="TITLE_TEXT" etc. (v1.2 Plugin)
        processedSvg = replaceDynamicElementsById(processedSvg, dynValues);

        // 3. Legacy-Platzhalter: [ TITLE BLOCK ] etc.
        processedSvg = replaceLegacyPlaceholders(processedSvg, dynValues);

        // 4. MAP_AREA-Platzhalter-Grafik entfernen
        processedSvg = removeMapAreaPlaceholder(processedSvg);

        // 5. Bbox-Rects für dynamische Elemente entfernen
        processedSvg = removeDynamicBboxes(processedSvg);

        // 6. Font-Sizes normalisieren (QGIS SVG-px → pt)
        processedSvg = normalizeSvgFonts(processedSvg, paperW, paperH);

        // 7. SVG-Cleanup: leere Gruppen entfernen, Fonts vereinheitlichen
        processedSvg = cleanupSvg(processedSvg);

        // Prüfen ob noch unreplatzierte {{…}} vorhanden → PDF-Overlay nötig
        var needPdfOverlay = /\{\{(TITLE|SCALE|COORDINATES|DATE)\}\}/.test(processedSvg);
        if (needPdfOverlay) {
          console.warn('[TemplatePDF] Nicht alle Platzhalter ersetzt → PDF-Overlay');
        }

        onProgress(3, options.serverRender ? 'Lade Kartenbilder von Server...' : 'Rendere Karte...');

        // ── BBOX-first: Eckkoordinaten sind die Wahrheit ──
        // Resolution wird aus BBOX + Pixelzahl abgeleitet.
        // Keine GPR-Korrektur (EPSG:2056, mpu=1, Meter-Projektion).
        var scaleNumber = options.scaleNumber || 0;
        var mpu = map.getView().getProjection().getMetersPerUnit() || 1;
        var desiredCenter = options.printCenter || map.getView().getCenter();

        console.log('┌─────────────────────────────────────────────────────');
        console.log('│ [PRINT] Schritt-für-Schritt Koordinatenberechnung');
        console.log('├─────────────────────────────────────────────────────');
        console.log('│ MANIFEST / EINGABE:');
        console.log('│   Template:      ', template.paper || '?',
          template.orientation || '', '(' + (template.name || template.file || '?') + ')');
        console.log('│   Papier:        ', paperW.toFixed(1) + ' × ' + paperH.toFixed(1), 'mm');
        console.log('│   MAP_AREA:      ', mapAreaW.toFixed(2) + ' × ' + mapAreaH.toFixed(2), 'mm',
          'bei (' + mapAreaX.toFixed(2) + ', ' + mapAreaY.toFixed(2) + ')');
        console.log('│   Massstab:       1:' + scaleNumber);
        console.log('│   DPI:           ', dpi);
        console.log('│   Projektion:    ', map.getView().getProjection().getCode(), ' mpu=' + mpu);
        console.log('│   Center (View): ', map.getView().getCenter()[0].toFixed(2),
          '/', map.getView().getCenter()[1].toFixed(2));
        console.log('│   Center (Print):', desiredCenter[0].toFixed(2),
          '/', desiredCenter[1].toFixed(2));
        console.log('│   printCenter:   ', options.printCenter ? 'JA (explizit)' : 'NEIN (= View-Center)');
        console.log('│   Bildformat:    ', CONFIG.imageFormat || 'image/jpeg');
        console.log('├─────────────────────────────────────────────────────');

        // 1. Extent in Meter
        var extentW_m = mapAreaW * scaleNumber / 1000;
        var extentH_m = mapAreaH * scaleNumber / 1000;
        console.log('│ SCHRITT 1: Kartenausschnitt (Extent) in Meter');
        console.log('│   Formel:   mapAreaW_mm × Massstab / 1000');
        console.log('│   Breite:  ', mapAreaW.toFixed(2), '×', scaleNumber, '/ 1000 =', extentW_m.toFixed(2), 'm');
        console.log('│   Höhe:    ', mapAreaH.toFixed(2), '×', scaleNumber, '/ 1000 =', extentH_m.toFixed(2), 'm');
        console.log('├─────────────────────────────────────────────────────');

        // 2. BBOX (Eckkoordinaten)
        var halfW = extentW_m / (2 * mpu);
        var halfH = extentH_m / (2 * mpu);
        var printBbox = [
          desiredCenter[0] - halfW,
          desiredCenter[1] - halfH,
          desiredCenter[0] + halfW,
          desiredCenter[1] + halfH
        ];
        console.log('│ SCHRITT 2: Eckkoordinaten (BBOX LV95)');
        console.log('│   halfW:    extentW / (2 × mpu) =', extentW_m.toFixed(2), '/ (2 ×', mpu + ') =', halfW.toFixed(2), 'm');
        console.log('│   halfH:    extentH / (2 × mpu) =', extentH_m.toFixed(2), '/ (2 ×', mpu + ') =', halfH.toFixed(2), 'm');
        console.log('│');
        console.log('│   Links-Unten (SW):  E ' + printBbox[0].toFixed(2) + '  /  N ' + printBbox[1].toFixed(2));
        console.log('│   Rechts-Oben (NE):  E ' + printBbox[2].toFixed(2) + '  /  N ' + printBbox[3].toFixed(2));
        console.log('│   Links-Oben  (NW):  E ' + printBbox[0].toFixed(2) + '  /  N ' + printBbox[3].toFixed(2));
        console.log('│   Rechts-Unten (SE): E ' + printBbox[2].toFixed(2) + '  /  N ' + printBbox[1].toFixed(2));
        console.log('│   Center:            E ' + desiredCenter[0].toFixed(2) + '  /  N ' + desiredCenter[1].toFixed(2));
        console.log('│');
        console.log('│   → BBOX: [' + printBbox.map(function(v){return v.toFixed(2)}).join(', ') + ']');
        console.log('│   → Prüfung: ΔE=' + (printBbox[2]-printBbox[0]).toFixed(2) + 'm (soll ' + extentW_m.toFixed(2) + ')' +
          '  ΔN=' + (printBbox[3]-printBbox[1]).toFixed(2) + 'm (soll ' + extentH_m.toFixed(2) + ')');
        console.log('├─────────────────────────────────────────────────────');

        // 3. Pixeldimensionen
        var baseVpW = mapAreaW / 25.4 * dpi;
        var baseVpH = mapAreaH / 25.4 * dpi;
        console.log('│ SCHRITT 3: Pixeldimensionen');
        console.log('│   Formel:   mapAreaW_mm / 25.4 × DPI');
        console.log('│   Breite:  ', mapAreaW.toFixed(2), '/ 25.4 ×', dpi, '=', baseVpW.toFixed(2), 'px → gerundet:', Math.round(baseVpW));
        console.log('│   Höhe:    ', mapAreaH.toFixed(2), '/ 25.4 ×', dpi, '=', baseVpH.toFixed(2), 'px → gerundet:', Math.round(baseVpH));
        console.log('├─────────────────────────────────────────────────────');

        // 4. Resolution
        var desiredRes;
        if (scaleNumber > 0 && baseVpW > 0) {
          desiredRes = extentW_m / baseVpW;
        } else {
          desiredRes = map.getView().getResolution();
        }
        console.log('│ SCHRITT 4: Resolution (m/px)');
        console.log('│   Formel:   extentW_m / baseVpW_px');
        console.log('│  ', extentW_m.toFixed(4), '/', baseVpW.toFixed(4), '=', desiredRes.toFixed(10), 'm/px');
        console.log('│   Alternativ: Massstab × 0.0254 / DPI =', (scaleNumber * 0.0254 / dpi).toFixed(10), 'm/px');
        console.log('│   → Identisch?', Math.abs(desiredRes - scaleNumber * 0.0254 / dpi) < 1e-10 ? 'JA ✓' : 'NEIN ✗');
        console.log('├─────────────────────────────────────────────────────');

        // 5. Rückrechnung → Verifikation
        var checkExtentW = desiredRes * Math.round(baseVpW);
        var checkExtentH = desiredRes * Math.round(baseVpH);
        console.log('│ SCHRITT 5: Rückrechnung (Verifikation)');
        console.log('│   res × round(pxW):', desiredRes.toFixed(10), '×', Math.round(baseVpW), '=', checkExtentW.toFixed(4), 'm (soll:', extentW_m.toFixed(4) + ')');
        console.log('│   res × round(pxH):', desiredRes.toFixed(10), '×', Math.round(baseVpH), '=', checkExtentH.toFixed(4), 'm (soll:', extentH_m.toFixed(4) + ')');
        console.log('│   ΔW:', Math.abs(checkExtentW - extentW_m).toFixed(6), 'm  ΔH:', Math.abs(checkExtentH - extentH_m).toFixed(6), 'm');
        console.log('│   Massstab rückgerechnet: 1:' + Math.round(checkExtentW / (mapAreaW / 1000)),
          '(soll: 1:' + scaleNumber + ')');
        console.log('├─────────────────────────────────────────────────────');

        // 6. Rotation + viewport
        var rotRad = map.getView().getRotation() || 0;
        var absC = Math.abs(Math.cos(rotRad));
        var absS = Math.abs(Math.sin(rotRad));
        var rotBuffer = Math.abs(rotRad) > 0.001 ? 1.15 : 1.0;
        var targetVpW = Math.round((baseVpW * absC + baseVpH * absS) * rotBuffer);
        var targetVpH = Math.round((baseVpW * absS + baseVpH * absC) * rotBuffer);
        console.log('│ SCHRITT 6: Rotation');
        console.log('│   Winkel:', (rotRad * 180 / Math.PI).toFixed(1) + '°',
          rotBuffer > 1 ? '(+15% Buffer)' : '(kein Buffer)');
        console.log('│   Base-Viewport:  ', Math.round(baseVpW) + ' × ' + Math.round(baseVpH), 'px');
        console.log('│   Target-Viewport:', targetVpW + ' × ' + targetVpH, 'px');
        console.log('├─────────────────────────────────────────────────────');

        // 7. Aktueller View vs. Print
        var curViewRes = map.getView().getResolution();
        var curViewCtr = map.getView().getCenter();
        var curViewSize = map.getSize();
        console.log('│ AKTUELLER VIEW (On-Screen):');
        console.log('│   Size:       ', curViewSize ? (curViewSize[0] + '×' + curViewSize[1] + ' px') : 'undefined');
        console.log('│   Resolution: ', curViewRes ? curViewRes.toFixed(8) + ' m/px' : 'undefined');
        console.log('│   Center:      E ' + (curViewCtr ? curViewCtr[0].toFixed(2) : '?') + '  /  N ' + (curViewCtr ? curViewCtr[1].toFixed(2) : '?'));
        if (curViewRes && curViewSize) {
          console.log('│   View-Extent:', (curViewRes * curViewSize[0]).toFixed(1) + ' × ' +
            (curViewRes * curViewSize[1]).toFixed(1), 'm');
          console.log('│   View-Scale:  ~1:' + Math.round(curViewRes / 0.00028));
        }
        console.log('│   devicePixelRatio:', window.devicePixelRatio);
        console.log('└─────────────────────────────────────────────────────');

        // ── Render-Methode wählen ──
        var useServerRender = !!options.serverRender && scaleNumber > 0;
        var renderPromise;

        if (useServerRender) {
          // ── Server-Rendering: Bilder direkt vom Mapserver ──
          // printBbox ist bereits oben berechnet (BBOX-first)
          var imgW = Math.round(baseVpW);
          var imgH = Math.round(baseVpH);

          console.log('[TemplatePDF] Server-Rendering:',
            imgW + '×' + imgH, 'px, DPI:', dpi,
            'BBOX:', printBbox.map(function(v){return v.toFixed(1)}).join(', '));

          renderPromise = renderServerImages(
            map, printBbox, imgW, imgH, dpi,
            { format: 'image/png', svgFormat: !!options.svgFormat }, onProgress
          ).then(function (serverCanvas) {
            return { canvas: serverCanvas, needsRestore: false };
          });
        } else {
          // ── Client-Rendering via Off-Screen-Map ──
          // Separate ol.Map-Instanz mit pixelRatio:1 → kein DPR-Problem,
          // kein ResizeObserver, On-Screen-Map bleibt unverändert.
          console.log('[TemplatePDF] Client-Rendering (Off-Screen):',
            'Druckpixel:', Math.round(targetVpW) + '×' + Math.round(targetVpH),
            '(Basis:', Math.round(baseVpW) + '×' + Math.round(baseVpH) + ')',
            'Resolution:', desiredRes.toFixed(8), 'm/px',
            'Center:', desiredCenter[0].toFixed(1) + '/' + desiredCenter[1].toFixed(1),
            'Rotation:', (rotRad * 180 / Math.PI).toFixed(1) + '°');

          renderPromise = renderMapCanvas(
            map,
            desiredCenter,
            desiredRes,
            Math.round(targetVpW),  // bei Rotation: mit Buffer
            Math.round(targetVpH),
            { dpi: dpi, rotation: rotRad, serverDpi: options.serverDpi || 96 }
          ).then(function (mapCanvas) {
            return { canvas: mapCanvas, needsRestore: false };
          });
        }

        return renderPromise.then(function (renderResult) {
          var mapCanvas = renderResult.canvas;

          // ── Bei Rotation: Canvas auf den Druckbereich zuschneiden ──
          var finalCanvas;
          if (!useServerRender && Math.abs(rotRad) > 0.001) {
            var cropW = Math.round(baseVpW);
            var cropH = Math.round(baseVpH);
            finalCanvas = document.createElement('canvas');
            finalCanvas.width = cropW;
            finalCanvas.height = cropH;
            var cropCtx = finalCanvas.getContext('2d');
            var sx = Math.round((mapCanvas.width - cropW) / 2);
            var sy = Math.round((mapCanvas.height - cropH) / 2);
            cropCtx.drawImage(mapCanvas, sx, sy, cropW, cropH, 0, 0, cropW, cropH);
            console.log('[TemplatePDF] Rotiertes Canvas zugeschnitten:',
              mapCanvas.width + 'x' + mapCanvas.height, '→', cropW + 'x' + cropH);
          } else {
            finalCanvas = mapCanvas;
          }

          onProgress(4, 'Erzeuge PDF...');

          var orientation = paperW > paperH ? 'landscape' : 'portrait';
          var pdf = new jsPDF({
            orientation: orientation,
            unit: 'mm',
            format: [Math.min(paperW, paperH), Math.max(paperW, paperH)],
            compress: true  // PDF-Stream-Komprimierung aktivieren
          });

          // ── Custom Fonts registrieren (Inter) ──
          var fontPromise = (typeof window.registerPdfFonts === 'function')
            ? window.registerPdfFonts(pdf)
            : Promise.resolve();

          return fontPromise.then(function () {

          var pdfW = pdf.internal.pageSize.getWidth();
          var pdfH = pdf.internal.pageSize.getHeight();

          // ── SVG als Hintergrund zeichnen (svg2pdf.js) ──
          var svgElement = new DOMParser()
            .parseFromString(processedSvg, 'image/svg+xml')
            .documentElement;

          return pdf.svg(svgElement, {
            x: 0, y: 0, width: pdfW, height: pdfH
          }).then(function () {
            onProgress(5, 'Setze Karte ein...');

            // ── Weisses Rechteck über MAP_AREA ──
            // Verdeckt den QGIS-Karteninhalt (Raster-Tiles aus dem SVG)
            pdf.setFillColor(255, 255, 255);
            pdf.rect(mapAreaX, mapAreaY, mapAreaW, mapAreaH, 'F');

            // ── OL-Map-Canvas in MAP_AREA platzieren ──
            // mapAreaX/Y/W/H sind DIREKT in mm (kein Skalierungsfaktor!)
            var imgFormat = (CONFIG.imageFormat || 'image/jpeg').toLowerCase();
            var isJpeg    = imgFormat.indexOf('jpeg') > -1 || imgFormat.indexOf('jpg') > -1;
            var jpegQuality = options.jpegQuality || CONFIG.jpegQuality || 0.7;

            // Bei JPEG: Canvas auf weissem Hintergrund rendern,
            // damit transparente Pixel nicht schwarz werden.
            var exportCanvas = finalCanvas;
            if (isJpeg) {
              var bgCanvas = document.createElement('canvas');
              bgCanvas.width  = finalCanvas.width;
              bgCanvas.height = finalCanvas.height;
              var bgCtx = bgCanvas.getContext('2d');
              bgCtx.fillStyle = '#ffffff';
              bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
              bgCtx.drawImage(finalCanvas, 0, 0);
              exportCanvas = bgCanvas;
            }

            // ── Debug: 100 mm Kalibrier-Linie ins CANVAS ──
            // VOR toDataURL → gleicher Skalierungspfad wie Karteninhalt.
            drawDebugTestLine(exportCanvas, {
              scale:       scaleNumber,
              dpi:         dpi,
              resolution:  desiredRes,
              extentW:     extentW_m,
              extentH:     extentH_m,
              mapAreaW_mm: mapAreaW,
              mapAreaH_mm: mapAreaH,
              canvasW:     exportCanvas.width,
              canvasH:     exportCanvas.height
            });

            var mapDataUrl;
            var pdfImgType;
            try {
              if (isJpeg) {
                mapDataUrl = exportCanvas.toDataURL('image/jpeg', jpegQuality);
                pdfImgType = 'JPEG';
              } else {
                mapDataUrl = exportCanvas.toDataURL('image/png');
                pdfImgType = 'PNG';
              }
            } catch (secErr) {
              // Tainted Canvas: CORS-Header fehlen auf Kartendienst
              console.error('[TemplatePDF] Canvas tainted – CORS-Header fehlen!', secErr);
              throw new Error(
                'Das Kartenbild konnte nicht exportiert werden (Tainted Canvas). ' +
                'Ursache: Ein Kartendienst liefert keinen CORS-Header (Access-Control-Allow-Origin). ' +
                'Versuchen Sie Server-Rendering oder kontaktieren Sie den Administrator.'
              );
            }
            pdf.addImage(mapDataUrl, pdfImgType,
              mapAreaX, mapAreaY, mapAreaW, mapAreaH, undefined, 'FAST');

            console.log('[TemplatePDF] Bildformat:', pdfImgType,
              isJpeg ? ('Qualität: ' + jpegQuality) : '(verlustfrei)');

            console.log('[TemplatePDF] Karte platziert bei:',
              { x: mapAreaX, y: mapAreaY, w: mapAreaW, h: mapAreaH });

            // ── Dynamische Grafik-Elemente (Nordpfeil, Massstabsbalken) ──
            drawDynamicElements(pdf, template, options, svgBboxes);

            // ── PDF-Text-Overlays (Fallback) ──
            if (needPdfOverlay && template.elements) {
              drawPdfTextOverlays(pdf, template.elements, dynValues);
            }

            // ── Rahmen um MAP_AREA (zuletzt → liegt über allem) ──
            pdf.setDrawColor(0, 0, 0);
            pdf.setLineWidth(0.4);
            pdf.rect(mapAreaX, mapAreaY, mapAreaW, mapAreaH, 'S');

            onProgress(6, 'PDF erzeugt...');

            // Als Blob zurückgeben (KEIN automatischer Download)
            var pdfBlob = pdf.output('blob');
            var pdfFilename = filename.replace(/\.pdf$/i, '') + '.pdf';

            onProgress(7, 'Fertig!');

            // ── Druckzeit & Logging ──
            var _duration = ((performance.now() - _t0) / 1000).toFixed(1);
            var _extent = map.getView().calculateExtent(map.getSize());
            var _layerInfos = collectLayerInfos(map);
            var _layerNames = _layerInfos.map(function (l) { return l.name || l.layers || '?'; });

            console.log('[TemplatePDF] Export:', pdfFilename,
              '(' + pdfBlob.size + ' Bytes)',
              '| Dauer:', _duration + 's',
              '| DPI:', dpi,
              '| Template:', (template.name || template.title || '?'),
              '| Extent:', _extent.map(function (v) { return Math.round(v); }).join(', '),
              '| Layer:', _layerNames.join(', '));

            // Server-Log: Metadaten + PDF archivieren (fire & forget)
            try {
              var _logUrl = (CONFIG.templatesBasePath || '').replace(/\/qgis-templates\/?$/, '/php/pdf-log.php');
              if (!_logUrl || _logUrl === CONFIG.templatesBasePath) {
                _logUrl = 'php/pdf-log.php';
              }

              // 1) Metadaten ins Drucklog
              var _logData = {
                timestamp: new Date().toISOString(),
                filename: pdfFilename,
                template: template.name || template.title || '?',
                paper: (template.paper || '?') + ' ' + (template.orientation || '?'),
                dpi: dpi,
                extent: _extent.map(function (v) { return Math.round(v); }),
                center: [Math.round((_extent[0] + _extent[2]) / 2), Math.round((_extent[1] + _extent[3]) / 2)],
                scale: options.scaleText || '',
                rotation: options.rotation || 0,
                duration_s: parseFloat(_duration),
                size_bytes: pdfBlob.size,
                layers: _layerNames,
                title: title
              };
              fetch(_logUrl + '?action=log', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(_logData)
              }).catch(function () { /* ignore */ });

              // 2) PDF-Datei archivieren
              var _formData = new FormData();
              _formData.append('pdf', pdfBlob, pdfFilename);
              _formData.append('filename', pdfFilename);
              fetch(_logUrl, {
                method: 'POST',
                body: _formData
              }).catch(function () { /* ignore */ });
            } catch (e) { /* ignore */ }

            return { blob: pdfBlob, filename: pdfFilename };
          });
          }); // fontPromise.then
        });
      });
  }

  // ---------------------------------------------------------------- //
  //  Globale API                                                      //
  // ---------------------------------------------------------------- //

  window.TemplatePdfExport = {
    config: CONFIG,
    loadManifest: loadManifest,
    getTemplates: getTemplates,
    loadTemplateSvg: loadTemplateSvg,
    parseMapArea: parseMapArea,
    exportPdf: exportPdf,
    renderMapCanvas: renderMapCanvas,
    renderServerImages: renderServerImages,
    collectLayerInfos: collectLayerInfos
  };

  console.log('[TemplatePDF] Template-PDF-Export Engine v2.0 geladen ✓');

})();
