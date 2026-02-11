/**
 * template-pdf-export.js
 *
 * PDF-Export-Engine für QGIS-Layout-Templates.
 *
 * Workflow:
 *   1. QGIS-Plugin exportiert SVG-Templates mit Platzhaltern
 *      (ID: MAP_AREA, TITLE_BLOCK, LEGEND, LOGO, SCALE_BAR)
 *   2. Templates werden auf den Webserver in /templates/ hochgeladen
 *   3. manifest.json beschreibt verfügbare Templates
 *   4. Dieses Script:
 *      a) Lädt das SVG-Template
 *      b) Findet den MAP_AREA-Platzhalter (Rect-Position & Grösse)
 *      c) Rendert die OL-Map auf Canvas
 *      d) Erstellt ein PDF (jsPDF) in der richtigen Papiergrösse
 *      e) Zeichnet das SVG-Template als Hintergrund (svg2pdf.js)
 *      f) Setzt den Map-Canvas in die MAP_AREA-Position
 *      g) Ersetzt Platzhalter-Texte (Titel, Massstab, Datum)
 *      h) Bietet das PDF zum Download an
 *
 * Benötigt: jsPDF (global: jspdf), svg2pdf.js (global: svg2pdf)
 * Benötigt: OpenLayers (global: ol)
 *
 * Kein Bundler nötig – alles UMD.
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------- //
  //  Konfiguration                                                    //
  // ---------------------------------------------------------------- //

  var CONFIG = {
    // Relativer Pfad zum svg-Ordner (relativ zur HTML-Seite)
    templatesBasePath: 'ol-pdf-printer/svg',

    // Dateiname für den PDF-Download
    defaultFilename: 'Kartenexport',

    // DPI für den Map-Canvas Export
    defaultDpi: 150,

    // Platzhalter-Texte die im SVG ersetzt werden
    placeholders: {
      title: '[ TITLE BLOCK ]',
      legend: '[ LEGEND ]',
      logo: '[ COMPANY LOGO ]',
      scaleBar: '[ SCALE BAR ]',
      coords: '[ COORDINATES / CRS ]'
    }
  };

  // ---------------------------------------------------------------- //
  //  Template-Verwaltung (manifest.json)                              //
  // ---------------------------------------------------------------- //

  var _manifestCache = null;

  /**
   * Lädt das manifest.json vom Server.
   * @returns {Promise<Object>}
   */
  function loadManifest() {
    if (_manifestCache) {
      return Promise.resolve(_manifestCache);
    }

    var url = CONFIG.templatesBasePath + '/../manifest.json';

    return fetch(url)
      .then(function (resp) {
        if (!resp.ok) throw new Error('manifest.json nicht gefunden (' + resp.status + ')');
        return resp.json();
      })
      .then(function (data) {
        _manifestCache = data;
        console.log('[TemplatePDF] Manifest geladen:', data.templates.length, 'Templates');
        return data;
      })
      .catch(function (err) {
        console.warn('[TemplatePDF] Kein manifest.json:', err.message);
        _manifestCache = { version: '1.0', templates: [] };
        return _manifestCache;
      });
  }

  /**
   * Gibt die Liste aller verfügbaren Templates zurück.
   * @returns {Promise<Array>}
   */
  function getTemplates() {
    return loadManifest().then(function (m) {
      return m.templates || [];
    });
  }

  /**
   * Lädt ein SVG-Template als Text.
   * @param {Object} templateEntry - Eintrag aus manifest.json
   * @returns {Promise<string>}
   */
  function loadTemplateSvg(templateEntry) {
    var svgPath = templateEntry.files && templateEntry.files.svg;
    if (!svgPath) {
      return Promise.reject(new Error('Template hat keine SVG-Datei: ' + templateEntry.name));
    }

    // Pfad relativ zum Templates-Basisordner auflösen
    // manifest.json enthält "templates/layout_a4_portrait.svg"
    var url = CONFIG.templatesBasePath + '/../' + svgPath;

    return fetch(url)
      .then(function (resp) {
        if (!resp.ok) throw new Error('SVG nicht gefunden: ' + url + ' (' + resp.status + ')');
        return resp.text();
      });
  }

  // ---------------------------------------------------------------- //
  //  SVG-Parsing: MAP_AREA Platzhalter finden                         //
  // ---------------------------------------------------------------- //

  /**
   * Parst das SVG und findet die MAP_AREA-Rect-Position.
   *
   * Sucht nach:
   *  - Element mit id enthaltend "MAP_AREA" (vom QGIS-Plugin gesetzt)
   *  - Oder <rect> mit title/desc "MAP_AREA"
   *  - Oder <text> mit Inhalt "[ MAP AREA ]" und zugehöriges <rect>
   *
   * @param {string} svgText - SVG als Text
   * @returns {{ x: number, y: number, width: number, height: number, svgWidth: number, svgHeight: number }}
   */
  function parseMapArea(svgText) {
    var parser = new DOMParser();
    var doc = parser.parseFromString(svgText, 'image/svg+xml');
    var svg = doc.documentElement;

    // SVG-Gesamtgrösse (viewBox oder width/height)
    var viewBox = svg.getAttribute('viewBox');
    var svgWidth, svgHeight;
    if (viewBox) {
      var parts = viewBox.split(/[\s,]+/).map(Number);
      svgWidth = parts[2];
      svgHeight = parts[3];
    } else {
      svgWidth = parseFloat(svg.getAttribute('width')) || 0;
      svgHeight = parseFloat(svg.getAttribute('height')) || 0;
    }

    // Strategie 1: Element mit ID die "MAP_AREA" enthält (aber nicht LABEL)
    var mapAreaEl = null;
    var allElements = doc.querySelectorAll('[id]');
    for (var i = 0; i < allElements.length; i++) {
      var id = allElements[i].getAttribute('id') || '';
      if (id.indexOf('MAP_AREA') >= 0 && id.indexOf('LABEL') < 0) {
        mapAreaEl = allElements[i];
        break;
      }
    }

    // Strategie 2: Rect in der Nähe von "[ MAP AREA ]" Text
    if (!mapAreaEl) {
      var texts = doc.querySelectorAll('text');
      for (var j = 0; j < texts.length; j++) {
        if ((texts[j].textContent || '').indexOf('MAP AREA') >= 0) {
          // Suche das nächste <rect> im gleichen Parent
          var parent = texts[j].parentElement;
          var rects = parent ? parent.querySelectorAll('rect') : [];
          if (rects.length > 0) {
            mapAreaEl = rects[0];
          }
          break;
        }
      }
    }

    // Strategie 3: Grösstes <rect> mit gestrichelter Linie (dash)
    if (!mapAreaEl) {
      var allRects = doc.querySelectorAll('rect');
      var maxArea = 0;
      for (var k = 0; k < allRects.length; k++) {
        var r = allRects[k];
        var rw = parseFloat(r.getAttribute('width')) || 0;
        var rh = parseFloat(r.getAttribute('height')) || 0;
        var area = rw * rh;
        var style = r.getAttribute('style') || '';
        var dash = r.getAttribute('stroke-dasharray') || '';
        if ((style.indexOf('dash') >= 0 || dash) && area > maxArea) {
          maxArea = area;
          mapAreaEl = r;
        }
      }
    }

    // Strategie 4: Zweitgrösstes Rect (grösstes = Seitenrand)
    if (!mapAreaEl) {
      var sortedRects = Array.from(doc.querySelectorAll('rect'))
        .map(function (r) {
          return {
            el: r,
            area: (parseFloat(r.getAttribute('width')) || 0) *
                  (parseFloat(r.getAttribute('height')) || 0)
          };
        })
        .sort(function (a, b) { return b.area - a.area; });

      if (sortedRects.length >= 2) {
        mapAreaEl = sortedRects[1].el;
      }
    }

    if (!mapAreaEl) {
      console.warn('[TemplatePDF] MAP_AREA nicht gefunden, verwende Standard-Position');
      return {
        x: svgWidth * 0.05,
        y: svgHeight * 0.1,
        width: svgWidth * 0.7,
        height: svgHeight * 0.75,
        svgWidth: svgWidth,
        svgHeight: svgHeight
      };
    }

    // Position extrahieren (berücksichtigt transform)
    var bbox = {
      x: parseFloat(mapAreaEl.getAttribute('x')) || 0,
      y: parseFloat(mapAreaEl.getAttribute('y')) || 0,
      width: parseFloat(mapAreaEl.getAttribute('width')) || 0,
      height: parseFloat(mapAreaEl.getAttribute('height')) || 0
    };

    // Falls das Element ein <g> mit transform ist
    if (bbox.width === 0 && mapAreaEl.tagName === 'g') {
      var innerRect = mapAreaEl.querySelector('rect');
      if (innerRect) {
        bbox.x = parseFloat(innerRect.getAttribute('x')) || 0;
        bbox.y = parseFloat(innerRect.getAttribute('y')) || 0;
        bbox.width = parseFloat(innerRect.getAttribute('width')) || 0;
        bbox.height = parseFloat(innerRect.getAttribute('height')) || 0;
      }
    }

    console.log('[TemplatePDF] MAP_AREA gefunden:', bbox);

    return {
      x: bbox.x,
      y: bbox.y,
      width: bbox.width,
      height: bbox.height,
      svgWidth: svgWidth,
      svgHeight: svgHeight
    };
  }

  // ---------------------------------------------------------------- //
  //  SVG-Platzhalter ersetzen                                         //
  // ---------------------------------------------------------------- //

  /**
   * Ersetzt Platzhalter-Texte im SVG.
   * @param {string} svgText
   * @param {Object} values - { title, legend, logo, scaleText, coords }
   * @returns {string}
   */
  function replacePlaceholders(svgText, values) {
    var result = svgText;

    if (values.title) {
      result = result.replace(/\[\s*TITLE\s*BLOCK[^\]]*\]/gi, values.title);
    }
    if (values.scaleText) {
      result = result.replace(/\[\s*SCALE\s*BAR[^\]]*\]/gi, values.scaleText);
    }
    if (values.coords) {
      result = result.replace(/\[\s*COORDINATES[^\]]*\]/gi, values.coords);
    }
    if (values.date !== false) {
      // Datum automatisch einfügen falls ein Platzhalter existiert
      var dateStr = new Date().toLocaleDateString('de-CH');
      result = result.replace(/\[\s*DATE[^\]]*\]/gi, dateStr);
    }

    // MAP_AREA-Label entfernen (wird durch Kartenbild ersetzt)
    result = result.replace(/\[\s*MAP\s*AREA\s*\]/gi, '');

    return result;
  }

  /**
   * Entfernt den MAP_AREA-Platzhalter-Rahmen aus dem SVG,
   * damit er im PDF nicht sichtbar ist.
   * @param {string} svgText
   * @returns {string}
   */
  function removeMapAreaPlaceholder(svgText) {
    // Entferne gestrichelte blaue Linie (MAP_AREA rect)
    // QGIS exportiert: stroke="#2196F3" stroke-dasharray="..."
    var result = svgText.replace(
      /<rect[^>]*(?:stroke-dasharray|stroke="#2196[fF]3")[^>]*\/>/gi,
      ''
    );
    // Entferne auch den "[ MAP AREA ]"-Text
    result = result.replace(
      /<text[^>]*>[^<]*\[\s*MAP\s*AREA\s*\][^<]*<\/text>/gi,
      ''
    );
    return result;
  }

  // ---------------------------------------------------------------- //
  //  OL Map → Canvas                                                  //
  // ---------------------------------------------------------------- //

  /**
   * Rendert die aktuelle OpenLayers-Karte auf einen Canvas.
   * @param {ol.Map} map
   * @param {number} [scale] - Skalierungsfaktor für höhere DPI
   * @returns {Promise<HTMLCanvasElement>}
   */
  function renderMapCanvas(map, scale) {
    scale = scale || 1;

    return new Promise(function (resolve) {
      map.once('rendercomplete', function () {
        var size = map.getSize();
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(size[0] * scale);
        canvas.height = Math.round(size[1] * scale);
        var ctx = canvas.getContext('2d');
        ctx.scale(scale, scale);

        // Alle Canvas-Layer der Karte zusammenführen
        var layers = document.querySelectorAll('.ol-layer canvas, #map canvas');
        for (var i = 0; i < layers.length; i++) {
          var layerCanvas = layers[i];
          if (layerCanvas.width > 0) {
            var opacity = layerCanvas.parentNode && layerCanvas.parentNode.style
              ? layerCanvas.parentNode.style.opacity : '';
            ctx.globalAlpha = opacity === '' ? 1 : Number(opacity);

            var transform = layerCanvas.style.transform;
            var match = transform && transform.match(/matrix\(([^)]+)\)/);
            if (match) {
              var matrix = match[1].split(',').map(Number);
              ctx.setTransform(matrix[0] * scale, matrix[1], matrix[2],
                               matrix[3] * scale, matrix[4] * scale, matrix[5] * scale);
            } else {
              ctx.setTransform(scale, 0, 0, scale, 0, 0);
            }
            ctx.drawImage(layerCanvas, 0, 0);
          }
        }

        resolve(canvas);
      });

      map.renderSync();
    });
  }

  // ---------------------------------------------------------------- //
  //  PDF-Export: Alles zusammenführen                                  //
  // ---------------------------------------------------------------- //

  /**
   * Exportiert die Karte mit einem QGIS-SVG-Template als PDF.
   *
   * @param {Object} options
   * @param {ol.Map}   options.map           - OpenLayers Map
   * @param {Object}   options.template      - Template-Eintrag aus manifest.json
   * @param {string}   [options.title]       - Titel für den Titelblock
   * @param {string}   [options.scaleText]   - Massstabstext
   * @param {string}   [options.coords]      - Koordinaten/CRS-Text
   * @param {string}   [options.filename]    - PDF-Dateiname
   * @param {number}   [options.dpi]         - Auflösung (default: 150)
   * @param {Function} [options.onProgress]  - Callback(step, message)
   * @returns {Promise<void>}
   */
  function exportPdf(options) {
    var map = options.map;
    var template = options.template;
    var title = options.title || CONFIG.defaultFilename;
    var filename = (options.filename || CONFIG.defaultFilename) + '.pdf';
    var dpi = options.dpi || CONFIG.defaultDpi;
    var onProgress = options.onProgress || function () {};

    if (!map) return Promise.reject(new Error('Keine Map-Instanz übergeben'));
    if (!template) return Promise.reject(new Error('Kein Template übergeben'));

    // Prüfe ob jsPDF verfügbar ist
    var jsPDF = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    if (!jsPDF) {
      return Promise.reject(new Error(
        'jsPDF nicht geladen. Bitte jspdf.umd.min.js vor diesem Script einbinden.'
      ));
    }

    onProgress(1, 'Lade Template...');

    return loadTemplateSvg(template)
      .then(function (svgText) {
        onProgress(2, 'Parse Template...');

        // MAP_AREA-Position finden
        var mapArea = parseMapArea(svgText);

        // Platzhalter ersetzen
        var processedSvg = replacePlaceholders(svgText, {
          title: title,
          scaleText: options.scaleText || '',
          coords: options.coords || ''
        });

        // MAP_AREA-Platzhalter-Grafik entfernen
        processedSvg = removeMapAreaPlaceholder(processedSvg);

        onProgress(3, 'Rendere Karte...');

        var scaleFactor = dpi / 96;

        return renderMapCanvas(map, scaleFactor).then(function (mapCanvas) {
          onProgress(4, 'Erzeuge PDF...');

          // Papiergrösse aus Template-Metadaten (mm)
          var paperW = template.width_mm || mapArea.svgWidth;
          var paperH = template.height_mm || mapArea.svgHeight;
          var orientation = paperW > paperH ? 'landscape' : 'portrait';

          // jsPDF erstellen
          var pdf = new jsPDF({
            orientation: orientation,
            unit: 'mm',
            format: [Math.min(paperW, paperH), Math.max(paperW, paperH)]
          });

          var pdfW = pdf.internal.pageSize.getWidth();
          var pdfH = pdf.internal.pageSize.getHeight();

          // SVG-Koordinaten → PDF-mm Umrechnung
          var scaleX = pdfW / mapArea.svgWidth;
          var scaleY = pdfH / mapArea.svgHeight;

          // SVG als Hintergrund zeichnen (svg2pdf.js)
          var svgElement = new DOMParser()
            .parseFromString(processedSvg, 'image/svg+xml')
            .documentElement;

          return pdf.svg(svgElement, {
            x: 0,
            y: 0,
            width: pdfW,
            height: pdfH
          }).then(function () {
            onProgress(5, 'Setze Karte ein...');

            // Map-Canvas in die MAP_AREA-Position zeichnen
            var mapX = mapArea.x * scaleX;
            var mapY = mapArea.y * scaleY;
            var mapW = mapArea.width * scaleX;
            var mapH = mapArea.height * scaleY;

            var mapDataUrl = mapCanvas.toDataURL('image/png');
            pdf.addImage(mapDataUrl, 'PNG', mapX, mapY, mapW, mapH);

            onProgress(6, 'Speichere PDF...');

            // PDF herunterladen
            pdf.save(filename);

            onProgress(7, 'Fertig!');
            console.log('[TemplatePDF] Export abgeschlossen:', filename);
          });
        });
      });
  }

  // ---------------------------------------------------------------- //
  //  Globale API                                                      //
  // ---------------------------------------------------------------- //

  window.TemplatePdfExport = {
    /** Konfiguration anpassen */
    config: CONFIG,

    /** manifest.json laden */
    loadManifest: loadManifest,

    /** Verfügbare Templates auflisten */
    getTemplates: getTemplates,

    /** SVG-Template laden */
    loadTemplateSvg: loadTemplateSvg,

    /** MAP_AREA im SVG finden */
    parseMapArea: parseMapArea,

    /** Karte + Template → PDF exportieren */
    exportPdf: exportPdf,

    /** Map-Canvas rendern (nur Karte ohne Template) */
    renderMapCanvas: renderMapCanvas
  };

  console.log('[TemplatePDF] Template-PDF-Export Engine geladen ✓');

})();
