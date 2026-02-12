/**
 * pdf-printer-init.js
 *
 * Headless API für den QGIS-Template-basierten PDF-Export.
 * KEIN eigenes UI – bindet sich an euer bestehendes Druck-Menü an.
 *
 * ══════════════════════════════════════════════════════════════
 *  Aufruf aus eurem bestehenden "PDF erstellen"-Button:
 *
 *   window.templatePdfPrint({
 *     massstab:        10000,              // 1:10'000
 *     layout:          'A4 Hoch',          // 'A3 Quer', 'A4 Hoch', etc.
 *     aufloesung:      150,                // 150 oder 300
 *     rotation:        0,                  // Grad, 0 = Norden oben
 *     kartentitel:     'Situation',         // Text im Titelblock
 *     koordinatennetz: false,              // Grid ja/nein
 *     netzfarbe:       'schwarz',          // 'schwarz' oder 'weiss'
 *     onProgress:      function(step, msg) {},
 *     onSuccess:       function() {},
 *     onError:         function(err) {}
 *   });
 *
 * ══════════════════════════════════════════════════════════════
 *  Verfügbare Layouts dynamisch abfragen (für Dropdown):
 *
 *   window.getAvailableLayouts().then(function(list) {
 *     // list = [{ label:'A4 Hoch', value:'A4 Hoch', paper:'A4', ... }, ...]
 *   });
 *
 * ══════════════════════════════════════════════════════════════
 *  Voraussetzungen (Reihenfolge!):
 *   1. OpenLayers (global: ol)
 *   2. jspdf.umd.min.js
 *   3. svg2pdf.umd.min.js
 *   4. template-pdf-export.js
 *   5. window._olMap = map (eure Map-Instanz)
 *
 *  Optional VOR diesem Script:
 *   window._pdfPrinterConfig = {
 *     templatesBasePath: 'ol-pdf-printer/templates',
 *     filename: 'Kartenexport'
 *   };
 * ══════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------- //
  //  Konfiguration                                                    //
  // ---------------------------------------------------------------- //

  var _config = {
    templatesBasePath: 'ol-pdf-printer/qgis-templates',
    filename: 'Kartenexport'
  };

  // User-Config übernehmen
  if (window._pdfPrinterConfig) {
    for (var k in window._pdfPrinterConfig) {
      if (window._pdfPrinterConfig.hasOwnProperty(k)) {
        _config[k] = window._pdfPrinterConfig[k];
      }
    }
  }

  // ---------------------------------------------------------------- //
  //  Layout-String → Template-Name Mapping                            //
  //                                                                   //
  //  Euer Dropdown liefert z.B. "A4 Hoch", "A3 Quer".               //
  //  Das QGIS-Plugin erzeugt Dateinamen wie                           //
  //    "layout_a4_portrait", "layout_a3_landscape".                   //
  // ---------------------------------------------------------------- //

  var LAYOUT_MAP = {
    'a4 hoch':        { paper: 'A4', orientation: 'portrait',  pattern: 'a4_portrait'  },
    'a4 quer':        { paper: 'A4', orientation: 'landscape', pattern: 'a4_landscape' },
    'a3 hoch':        { paper: 'A3', orientation: 'portrait',  pattern: 'a3_portrait'  },
    'a3 quer':        { paper: 'A3', orientation: 'landscape', pattern: 'a3_landscape' },
    'a2 hoch':        { paper: 'A2', orientation: 'portrait',  pattern: 'a2_portrait'  },
    'a2 quer':        { paper: 'A2', orientation: 'landscape', pattern: 'a2_landscape' },
    'a1 hoch':        { paper: 'A1', orientation: 'portrait',  pattern: 'a1_portrait'  },
    'a1 quer':        { paper: 'A1', orientation: 'landscape', pattern: 'a1_landscape' },
    'a0 hoch':        { paper: 'A0', orientation: 'portrait',  pattern: 'a0_portrait'  },
    'a0 quer':        { paper: 'A0', orientation: 'landscape', pattern: 'a0_landscape' },
    // Varianten mit "-format"
    'a4 hochformat':  { paper: 'A4', orientation: 'portrait',  pattern: 'a4_portrait'  },
    'a4 querformat':  { paper: 'A4', orientation: 'landscape', pattern: 'a4_landscape' },
    'a3 hochformat':  { paper: 'A3', orientation: 'portrait',  pattern: 'a3_portrait'  },
    'a3 querformat':  { paper: 'A3', orientation: 'landscape', pattern: 'a3_landscape' }
  };

  /**
   * Findet das passende Template aus dem Manifest anhand des Layout-Strings.
   * @param {string}  layoutStr - z.B. "A4 Hoch", "A3 Quer"
   * @param {Array}   templates - Template-Liste aus manifest.json
   * @returns {Object|null}
   */
  function findTemplate(layoutStr, templates) {
    var key = (layoutStr || '').trim().toLowerCase();

    // 1. Exakter Title-Match (v1.2 Manifest: title-Feld)
    for (var t = 0; t < templates.length; t++) {
      if ((templates[t].title || '').toLowerCase() === key) return templates[t];
    }

    // 2. Exakter Name-Match
    for (var n = 0; n < templates.length; n++) {
      if ((templates[n].name || '').toLowerCase() === key) return templates[n];
    }

    // 3. LAYOUT_MAP Mapping (Legacy: "A4 Hoch" etc.)
    var mapping = LAYOUT_MAP[key];
    if (mapping) {
      for (var j = 0; j < templates.length; j++) {
        var tmpl = templates[j];
        var name = (tmpl.name || '').toLowerCase();
        if (name.indexOf(mapping.pattern) >= 0) return tmpl;
        if (tmpl.paper === mapping.paper && tmpl.orientation === mapping.orientation) return tmpl;
      }
    }

    // 4. Fuzzy Name-Match
    for (var i = 0; i < templates.length; i++) {
      var tName = (templates[i].name || '').toLowerCase();
      if (tName.indexOf(key.replace(/\s+/g, '_')) >= 0) return templates[i];
    }

    // 5. Fuzzy Title-Match
    for (var m = 0; m < templates.length; m++) {
      var tTitle = (templates[m].title || '').toLowerCase();
      if (tTitle.indexOf(key) >= 0 || key.indexOf(tTitle) >= 0) return templates[m];
    }

    console.warn('[PdfPrinter] Layout "' + layoutStr + '" nicht erkannt, nehme erstes Template.');
    return templates[0] || null;
  }

  // ---------------------------------------------------------------- //
  //  crossOrigin Fix                                                  //
  // ---------------------------------------------------------------- //

  var _crossOriginFixed = false;

  function fixCrossOrigin(map) {
    if (_crossOriginFixed) return;
    try {
      map.getLayers().forEach(function (layer) {
        var source = layer.getSource && layer.getSource();
        if (source && typeof source.setTileLoadFunction === 'function') {
          var orig = source.getTileLoadFunction();
          source.setTileLoadFunction(function (tile, src) {
            var img = tile.getImage();
            if (img) img.crossOrigin = 'anonymous';
            orig(tile, src);
          });
        }
      });
      _crossOriginFixed = true;
    } catch (e) {
      console.warn('[PdfPrinter] crossOrigin-Fix:', e);
    }
  }

  // ---------------------------------------------------------------- //
  //  Massstab, Rotation, Hilfsfunktionen                              //
  // ---------------------------------------------------------------- //

  /**
   * Setzt den Kartenmassstab.
   * @param {ol.Map} map
   * @param {number} scale - z.B. 10000 für 1:10'000
   */
  function setMapScale(map, scale) {
    if (!scale || scale <= 0) return;
    var view = map.getView();
    var mpu = view.getProjection().getMetersPerUnit() || 1;
    // 1 Pixel = 0.00028 m bei 96 dpi Bildschirm (OGC-Standard)
    var resolution = scale * 0.00028 / mpu;
    view.setResolution(resolution);
  }

  /**
   * Liest den aktuellen Massstab.
   * @param {ol.Map} map
   * @returns {number}
   */
  function getMapScale(map) {
    var view = map.getView();
    var mpu = view.getProjection().getMetersPerUnit() || 1;
    return Math.round(view.getResolution() * mpu / 0.00028);
  }

  /**
   * Setzt die Kartenrotation.
   * @param {ol.Map} map
   * @param {number} degrees
   */
  function setMapRotation(map, degrees) {
    map.getView().setRotation((degrees || 0) * Math.PI / 180);
  }

  /**
   * Formatiert einen Massstab als "1:10'000".
   * @param {number} scale
   * @returns {string}
   */
  function formatScale(scale) {
    return '1:' + scale.toLocaleString('de-CH');
  }

  // ---------------------------------------------------------------- //
  //  Koordinatennetz zeichnen (Graticule)                             //
  // ---------------------------------------------------------------- //

  var _graticuleLayer = null;

  /**
   * Fügt ein Koordinatennetz (Graticule) zur Karte hinzu oder entfernt es.
   * @param {ol.Map}  map
   * @param {boolean} show
   * @param {string}  farbe - 'schwarz' oder 'weiss'
   */
  function toggleGraticule(map, show, farbe) {
    // Bestehendes Graticule entfernen
    if (_graticuleLayer) {
      try { map.removeLayer(_graticuleLayer); } catch (e) {}
      _graticuleLayer = null;
    }

    if (!show) return;

    // Prüfe ob ol.layer.Graticule existiert (OL >= 6)
    var GraticuleClass = (ol.layer && ol.layer.Graticule) ||
                         (ol.Graticule);

    if (!GraticuleClass) {
      console.warn('[PdfPrinter] ol.layer.Graticule nicht verfügbar – Koordinatennetz übersprungen.');
      return;
    }

    var color = (farbe === 'weiss' || farbe === 'white') ?
      'rgba(255, 255, 255, 0.5)' : 'rgba(0, 0, 0, 0.3)';
    var textColor = (farbe === 'weiss' || farbe === 'white') ? '#fff' : '#333';

    try {
      _graticuleLayer = new GraticuleClass({
        strokeStyle: new ol.style.Stroke({ color: color, width: 1 }),
        showLabels: true,
        lonLabelStyle: new ol.style.Text({
          font: '10px sans-serif',
          fill: new ol.style.Fill({ color: textColor }),
          textBaseline: 'bottom'
        }),
        latLabelStyle: new ol.style.Text({
          font: '10px sans-serif',
          fill: new ol.style.Fill({ color: textColor }),
          textAlign: 'right'
        }),
        wrapX: false
      });
      map.addLayer(_graticuleLayer);
    } catch (e) {
      console.warn('[PdfPrinter] Graticule-Fehler:', e);
    }
  }

  // ---------------------------------------------------------------- //
  //  HAUPTFUNKTION: templatePdfPrint()                                //
  //                                                                   //
  //  Passt zu eurem bestehenden Druck-Dialog:                         //
  //    massstab:        10000                                         //
  //    layout:          'A4 Hoch'                                     //
  //    aufloesung:      150 oder 300                                  //
  //    rotation:        0                                             //
  //    kartentitel:     'Situation'                                    //
  //    koordinatennetz: false                                         //
  //    netzfarbe:       'schwarz'                                     //
  // ---------------------------------------------------------------- //

  /**
   * PDF-Export mit QGIS-Template.
   * Diese Funktion wird direkt von eurem "PDF erstellen"-Button aufgerufen.
   *
   * @param {Object}   opts
   * @param {number}   opts.massstab         - Kartenmassstab (z.B. 10000)
   * @param {string}   opts.layout           - 'A4 Hoch', 'A3 Quer', etc.
   * @param {number}   opts.aufloesung       - DPI: 150 oder 300
   * @param {number}   [opts.rotation=0]     - Kartenrotation in Grad
   * @param {string}   [opts.kartentitel]    - Titel im Titelblock
   * @param {boolean}  [opts.koordinatennetz=false] - Koordinatennetz?
   * @param {string}   [opts.netzfarbe='schwarz']   - 'schwarz' oder 'weiss'
   * @param {boolean}  [opts.serverRender=false] - Bilder direkt vom Mapserver?
   * @param {Function} [opts.onProgress]     - Callback(step, message)
   * @param {Function} [opts.onSuccess]      - Callback() bei Erfolg
   * @param {Function} [opts.onError]        - Callback(error) bei Fehler
   * @returns {Promise<void>}
   */
  function templatePdfPrint(opts) {
    opts = opts || {};

    // ---- Map-Instanz holen ----
    var map = window._olMap;
    if (!map) {
      var err = new Error('window._olMap nicht gesetzt!');
      if (opts.onError) opts.onError(err);
      return Promise.reject(err);
    }

    if (typeof TemplatePdfExport === 'undefined') {
      var err2 = new Error('TemplatePdfExport nicht geladen (template-pdf-export.js fehlt).');
      if (opts.onError) opts.onError(err2);
      return Promise.reject(err2);
    }

    // crossOrigin fixen
    fixCrossOrigin(map);

    // Templates-Pfad setzen
    if (_config.templatesBasePath) {
      TemplatePdfExport.config.templatesBasePath = _config.templatesBasePath;
    }

    var onProgress = opts.onProgress || function () {};
    onProgress(0, 'Lade Templates...');

    // ---- View-Zustand merken (wird nach Export wiederhergestellt) ----
    var origResolution = map.getView().getResolution();
    var origRotation   = map.getView().getRotation();

    // ---- Massstab setzen ----
    if (opts.massstab && opts.massstab > 0) {
      setMapScale(map, opts.massstab);
    }

    // ---- Rotation setzen ----
    if (typeof opts.rotation === 'number' && opts.rotation !== 0) {
      setMapRotation(map, opts.rotation);
    }

    // ---- Koordinatennetz ----
    if (opts.koordinatennetz) {
      toggleGraticule(map, true, opts.netzfarbe || 'schwarz');
    }

    // ---- Texte vorbereiten ----
    var scaleNum  = opts.massstab || getMapScale(map);
    var scaleText = formatScale(scaleNum);
    // Print-Center: entweder explizit uebergeben oder aktuelles View-Center
    var centerNative = opts.printCenter || map.getView().getCenter();  // Projektionskoordinaten (LV95)
    // Center explizit setzen (verhindert Drift nach setMapScale)
    map.getView().setCenter(centerNative);
    var center    = ol.proj.toLonLat(centerNative);
    // LV95-Koordinaten (EPSG:2056) für Schweizer Kontext
    var coordsText = Math.round(centerNative[0]).toLocaleString('de-CH') + ' / ' +
                     Math.round(centerNative[1]).toLocaleString('de-CH');
    var dateText  = new Date().toLocaleDateString('de-CH');
    var rotationDeg = Math.round((map.getView().getRotation() || 0) * 180 / Math.PI);

    console.log('[PdfPrinter] Texte für Template:', {
      scaleText: scaleText,
      coordsText: coordsText,
      dateText: dateText,
      title: opts.kartentitel || _config.filename || 'Kartenexport',
      rotation: rotationDeg
    });

    // ---- Cleanup-Funktion (View + Graticule wiederherstellen) ----
    function restoreState() {
      map.getView().setResolution(origResolution);
      map.getView().setRotation(origRotation);
      if (opts.koordinatennetz) {
        toggleGraticule(map, false);
      }
    }

    // ---- Los geht's ----
    return TemplatePdfExport.getTemplates()
      .then(function (templates) {
        if (templates.length === 0) {
          throw new Error(
            'Keine Templates gefunden! Bitte mit dem QGIS-Plugin ' +
            'Templates nach "' + _config.templatesBasePath + '/" exportieren.'
          );
        }

        var template = findTemplate(opts.layout || 'A4 Hoch', templates);
        if (!template) {
          throw new Error('Kein passendes Template für "' + opts.layout + '".');
        }

        onProgress(1, 'Template: ' + template.name);

        return TemplatePdfExport.exportPdf({
          map:       map,
          template:  template,
          title:     opts.kartentitel || _config.filename || 'Kartenexport',
          // filename wird automatisch generiert: <Titel>_<Zeitstempel>.pdf
          dpi:       opts.aufloesung || 150,
          scaleText:   scaleText,
          scaleNumber: scaleNum,
          coords:    coordsText,
          date:      dateText,
          rotation:  rotationDeg,
          printCenter: centerNative,  // Exaktes Zentrum durchreichen
          jpegQuality: opts.jpegQuality || 0.7,  // JPEG-Qualität durchreichen
          serverRender: !!opts.serverRender,  // Server-Rendering durchreichen
          onProgress: onProgress
        });
      })
      .then(function (result) {
        restoreState();
        console.log('[PdfPrinter] exportPdf() returned:', result);
        // result = { blob: Blob, filename: 'xxx.pdf' }
        if (opts.onSuccess) opts.onSuccess(result);
        return result;
      })
      .catch(function (error) {
        restoreState();
        console.error('[PdfPrinter]', error);
        if (opts.onError) opts.onError(error);
        throw error;
      });
  }

  // ---------------------------------------------------------------- //
  //  Layouts abfragen                                                 //
  //                                                                   //
  //  Damit ihr euer bestehendes Layout-Dropdown dynamisch             //
  //  mit den tatsächlich vorhandenen Templates füllen könnt.          //
  // ---------------------------------------------------------------- //

  /**
   * Gibt die verfügbaren Layouts zurück.
   * @returns {Promise<Array<{label:string, value:string, paper:string, orientation:string}>>}
   */
  function getAvailableLayouts() {
    if (typeof TemplatePdfExport === 'undefined') return Promise.resolve([]);
    if (_config.templatesBasePath) {
      TemplatePdfExport.config.templatesBasePath = _config.templatesBasePath;
    }
    return TemplatePdfExport.getTemplates().then(function (templates) {
      return templates.map(function (t) {
        var orient = t.orientation === 'landscape' ? 'Quer' : 'Hoch';
        var label = t.title || ((t.paper || '?') + ' ' + orient);
        return {
          label:       label,
          value:       label,
          name:        t.name,
          title:       t.title,
          paper:       t.paper,
          orientation: t.orientation,
          width_mm:    t.width_mm,
          height_mm:   t.height_mm,
          mapFrame:    t.mapFrame || null
        };
      });
    });
  }

  // ---------------------------------------------------------------- //
  //  Globale API                                                      //
  // ---------------------------------------------------------------- //

  /** Hauptfunktion – euer "PDF erstellen"-Button ruft diese auf */
  window.templatePdfPrint = templatePdfPrint;

  /** Layouts abfragen (für dynamisches Dropdown-Befüllen) */
  window.getAvailableLayouts = getAvailableLayouts;

  /** Manuelle Initialisierung (optional) */
  window.initPdfPrinter = function (map, config) {
    window._olMap = map;
    if (config) {
      for (var k in config) {
        if (config.hasOwnProperty(k)) _config[k] = config[k];
      }
    }
    fixCrossOrigin(map);
    console.log('[PdfPrinter] Initialisiert.');
  };

  console.log('[PdfPrinter] Template-PDF-API geladen ✓');
  console.log('[PdfPrinter] Aufruf: templatePdfPrint({ massstab:10000, layout:"A4 Hoch", aufloesung:150, kartentitel:"Titel" })');

})();
