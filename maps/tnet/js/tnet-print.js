/**
 * tnet-print.js
 *
 * Drucken Side-Panel für tnet WebGIS.
 * Nutzt die QGIS-Template PDF-Export API (templatePdfPrint / getAvailableLayouts)
 * aus ol-pdf-printer/js/pdf-printer-init.js.
 *
 * Erzeugt das Panel-HTML dynamisch, lädt Layouts aus manifest.json,
 * zeigt einen Druckrahmen als OL-Overlay auf der Karte und steuert
 * den gesamten Export-Workflow.
 *
 * Einbindung in index_de.htm:
 *   <link rel="stylesheet" href="/maps/tnet/css/tnet-print.css">
 *   <script src="/maps/tnet/js/tnet-print.js"></script>
 *
 * @version    1.2
 * @date       2026-02-12
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */
(function () {
  'use strict';

  // ================================================================
  //  State
  // ================================================================
  var _map = null;
  var _frameOverlay = null;
  var _frameEl = null;
  var _svgPreviewImg = null;   // <img> für Template-SVG-Vorschau
  var _svgPreviewCache = {};   // {layoutValue: dataUrl}
  var _isPrinting = false;
  var _downloads = [];
  var PDF_SAVE_URL = '/maps/tnet/php/pdf-save.php';
  var PDF_LOG_URL = '/maps/tnet/php/pdf-log.php';  // Parallel-Logging
  var _layouts = [];
  var _globalConfig = {};  // Wird aus tnet-global-config.json5 befuellt
  // ── Print-Job-Queue (für Background-Processing) ──
  var _printQueue = [];  // Array von Job-Objekten
  var _currentJobId = null;  // Job-ID des aktuellen Jobs
  var _jobIdCounter = 0;  // Für Job-ID-Generierung
  var _queueWorkerScheduled = false;  // Flag für setTimeout
  // Fallback Scales (werden aus tnet-global-config.json5 überschrieben)
  var _scales = [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 75000, 100000, 250000, 500000, 1000000];
  // Dock-State
  var _isPrintPanelDocked = true;  // Default: angedockt
  var _savedPrintDockedWidth = 380;
  var _printResizeObserver = null;

  // ================================================================
  //  Library-Loader — lädt UMD-Scripts per fetch+eval,
  //  sodass «define» nur während der Ausführung versteckt ist
  //  und Dojos AMD-Loader nicht gestört wird.
  // ================================================================
  var _libsReady = false;
  var _libsPromise = null;
  var LIB_BASE = '/maps/tnet/ol-pdf-printer/js/';
  var LIBS = [
    LIB_BASE + 'jspdf.umd.min.js',
    LIB_BASE + 'svg2pdf.umd.min.js',
    LIB_BASE + 'pdf-fonts.js',
    LIB_BASE + 'template-pdf-export.js',
    LIB_BASE + 'pdf-printer-init.js'
  ];

  /**
   * Lädt ein Script per fetch(), versteckt «define» nur
   * für den synchronen eval-Aufruf und stellt es danach
   * sofort wieder her.
   */
  function loadScriptSafe(src) {
    return fetch(src).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' beim Laden von ' + src);
      return r.text();
    }).then(function (code) {
      var saved = window.define;
      window.define = undefined;
      try {
        // indirect eval → globaler Scope
        (0, eval)(code);   // jshint ignore:line
      } finally {
        window.define = saved;
      }
    });
  }

  /**
   * Lädt alle PDF-Libraries sequenziell.
   * Gibt ein Promise zurück, das resolved wenn alle bereit sind.
   */
  function loadLibraries() {
    if (_libsPromise) return _libsPromise;

    // Config muss gesetzt sein BEVOR pdf-printer-init.js geladen wird
    window._pdfPrinterConfig = {
      filename: 'tnet_Kartenexport',
      templatesBasePath: '/maps/tnet/ol-pdf-printer/qgis-templates'
    };

    _libsPromise = LIBS.reduce(function (chain, src) {
      return chain.then(function () { return loadScriptSafe(src); });
    }, Promise.resolve()).then(function () {
      _libsReady = true;
      console.log('[Drucken] PDF-Libraries geladen ✓');
    });

    return _libsPromise;
  }

  // ================================================================
  //  Config laden (tnet-global-config.json5 → scales)
  // ================================================================
  function loadScalesFromConfig() {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', '/maps/tnet/tnet-global-config.json5', false);
      xhr.send();
      if (xhr.status === 200) {
          var text = xhr.responseText;
          // Einfacher JSON5-Parser: Kommentare + trailing commas + unquoted keys
          var lines = text.split('\n');
          var cleaned = [];
          for (var j = 0; j < lines.length; j++) {
            var line = lines[j];
            var inStr = false, strCh = null, cp = -1;
            for (var k = 0; k < line.length; k++) {
              var c = line[k];
              if ((c === '"' || c === "'") && (k === 0 || line[k - 1] !== '\\')) {
                if (!inStr) { inStr = true; strCh = c; }
                else if (c === strCh) { inStr = false; }
              }
              if (!inStr && k < line.length - 1 && line[k] === '/' && line[k + 1] === '/') { cp = k; break; }
            }
            if (cp > -1) line = line.substring(0, cp);
            if (line.trim()) cleaned.push(line);
          }
          var jsonText = cleaned.join('\n')
            .replace(/,(\s*[}\]])/g, '$1')
            .replace(/((?:^|[{,])\s*)([a-zA-Z_][a-zA-Z0-9_-]*)\s*:/gm, '$1"$2":')
            .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"');
        var config = JSON.parse(jsonText);
        _globalConfig = config;  // Gesamte Config speichern (fuer print.pdfRetentionDays etc.)
        if (config.scales && Array.isArray(config.scales)) {
          _scales = config.scales;
          window._tnetScales = _scales;
          console.log('[Drucken] ' + _scales.length + ' Massstäbe aus Config geladen');
        }
      }
    } catch (e) {
      console.warn('[Drucken] Config nicht geladen:', e.message);
    }
  }

  // ================================================================
  //  Massstab-Dropdown dynamisch rendern
  // ================================================================
  function renderScaleDropdown() {
    var select = document.getElementById('print-scale');
    if (!select) return;
    select.innerHTML = '';
    _scales.forEach(function (s) {
      var opt = document.createElement('option');
      opt.value = s;
      opt.textContent = '1 : ' + s.toLocaleString('de-CH');
      if (s === 10000) opt.selected = true;
      select.appendChild(opt);
    });
  }

  // ================================================================
  //  Panel-HTML erzeugen
  // ================================================================
  function createPanelHTML() {
    return '' +
      '<div id="print-panel" class="print-panel hidden">' +
        '<div class="print-panel-header">' +
          '<span class="print-panel-title">\uD83D\uDDA8 Drucken / Export</span>' +
          '<div class="print-panel-actions">' +
            '<button class="print-panel-btn" id="print-dock-btn" onclick="togglePrintPanelDock()" title="Floating">' +
              '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z"/></svg>' +
            '</button>' +
            '<button class="print-panel-btn print-panel-close" onclick="closePrintPanel()" title="Schliessen">&times;</button>' +
          '</div>' +
        '</div>' +
        '<div class="print-panel-body">' +

          // Layout
          '<div class="print-section">' +
            '<label>Layout</label>' +
            '<select id="print-layout"><option value="">Wird geladen...</option></select>' +
          '</div>' +

          // Massstab
          '<div class="print-section">' +
            '<label>Massstab</label>' +
            '<select id="print-scale"></select>' +
          '</div>' +

          // Auflösung
          '<div class="print-section">' +
            '<label>Aufl\u00f6sung</label>' +
            '<div class="print-radio-row">' +
              '<label class="print-radio"><input type="radio" name="print-dpi" value="150" checked> 150 dpi</label>' +
              '<label class="print-radio"><input type="radio" name="print-dpi" value="300"> 300 dpi</label>' +
            '</div>' +
          '</div>' +

          // Kartentitel
          '<div class="print-section">' +
            '<label>Kartentitel</label>' +
            '<input type="text" id="print-title" placeholder="Kartentitel" value="Situationsplan">' +
          '</div>' +

          // Server-Rendering
          '<div class="print-section print-checks">' +
            '<label class="print-check"><input type="checkbox" id="print-server-render"> ' +
            'Server-Rendering <span style="color:#888;font-size:11px">(Bilder direkt vom Mapserver)</span></label>' +
          '</div>' +

          // SVG-Vektorgrafik
          '<div class="print-section print-checks print-svg-section" id="print-svg-section">' +
            '<label class="print-check"><input type="checkbox" id="print-svg-format"> ' +
            'Vektorgrafik (SVG) <span style="color:#888;font-size:11px">(schärfer, grössere Datei)</span></label>' +
          '</div>' +

          // Koordinatennetz (vorerst deaktiviert)
          // '<div class="print-section print-checks">' +
          //   '<label><input type="checkbox" id="print-grid"> Koordinatennetz</label>' +
          //   '<div id="print-grid-color" class="print-grid-colors" style="display:none">' +
          //     '<label class="print-radio"><input type="radio" name="print-gridcolor" value="schwarz" checked> Schwarz</label>' +
          //     '<label class="print-radio"><input type="radio" name="print-gridcolor" value="weiss"> Weiss</label>' +
          //   '</div>' +
          // '</div>' +

          // Rotation
          '<div class="print-section print-frame-info">' +
            '<label>Kartenrotation</label>' +
            '<div class="print-rotation-row">' +
              '<input type="range" id="print-rotation" min="-180" max="180" value="0" step="1">' +
              '<span id="print-rotation-val">0\u00b0</span>' +
            '</div>' +
            '<div class="print-frame-controls">' +
              '<button class="print-ctrl-btn" onclick="printRotateBy(-15)" title="-15\u00b0">\u21ba 15\u00b0</button>' +
              '<button class="print-ctrl-btn" onclick="printRotateBy(15)" title="+15\u00b0">\u21bb 15\u00b0</button>' +
              '<button class="print-ctrl-btn" onclick="printResetRotation()" title="Auf 0\u00b0 zur\u00fccksetzen">\u27f3 0\u00b0</button>' +
            '</div>' +
          '</div>' +

          // Hinweis
          '<div class="print-section print-hint-box">' +
            'Karte verschieben/zoomen, um den Druckbereich anzupassen. Der Rahmen zeigt den exportierten Ausschnitt.' +
          '</div>' +

          // Drucken-Button
          '<div class="print-section">' +
            '<button class="print-action-btn" id="print-exec-btn" onclick="executePrint()">' +
              '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z" fill="currentColor"/></svg>' +
              ' PDF erstellen' +
            '</button>' +
          '</div>' +

          // Fortschritt
          '<div class="print-section print-progress" id="print-progress" style="display:none">' +
            '<div class="print-progress-bar"><div class="print-progress-fill" id="print-progress-fill"></div></div>' +
            '<div class="print-progress-text" id="print-progress-text">Wird erstellt...</div>' +
          '</div>' +

          // Job-Queue-Status (Accordion)
          '<div class="print-accordion" id="print-queue-acc" style="display:none">' +
            '<div class="print-acc-header" onclick="togglePrintAccordion(\'print-queue-acc\')">' +
              '<span class="print-acc-arrow">&#9654;</span> \u267B Druck-Warteschlange (<span id="print-queue-count">0</span>)' +
            '</div>' +
            '<div class="print-acc-panel">' +
              '<div id="print-queue-list" class="print-queue-list"></div>' +
            '</div>' +
          '</div>' +

          // PDF-Vorschau (Accordion)
          '<div class="print-accordion" id="print-preview-acc" style="display:none">' +
            '<div class="print-acc-header" onclick="togglePrintAccordion(\'print-preview-acc\')">' +
              '<span class="print-acc-arrow">&#9654;</span> Vorschau' +
            '</div>' +
            '<div class="print-acc-panel">' +
              '<iframe id="print-preview-frame" class="print-preview-frame"></iframe>' +
            '</div>' +
          '</div>' +

          // Downloads (Accordion)
          '<div class="print-accordion" id="print-downloads-acc" style="display:none">' +
            '<div class="print-acc-header" onclick="togglePrintAccordion(\'print-downloads-acc\')">' +
              '<span class="print-acc-arrow">&#9654;</span> \uD83D\uDCE5 Erzeugte PDFs' +
            '</div>' +
            '<div class="print-acc-panel">' +
              '<div id="print-download-list"></div>' +
            '</div>' +
          '</div>' +

        '</div>' +
      '</div>';
  }

  // ================================================================
  //  Map holen
  // ================================================================
  function getMap() {
    if (_map) return _map;
    try {
      _map = window._olMap ||
        (njs.AppManager.Maps && njs.AppManager.Maps.main && njs.AppManager.Maps.main.mapObj) || null;
    } catch (e) { /* noop */ }
    if (_map && !window._olMap) window._olMap = _map;
    return _map;
  }

  // ================================================================
  //  Layouts laden
  // ================================================================
  function loadLayouts() {
    if (typeof getAvailableLayouts !== 'function') {
      console.warn('[Drucken] getAvailableLayouts() nicht verfügbar');
      return;
    }
    getAvailableLayouts().then(function (layouts) {
      _layouts = layouts;
      var select = document.getElementById('print-layout');
      if (!select) return;
      select.innerHTML = '';
      if (layouts.length === 0) {
        select.innerHTML = '<option value="">Keine Layouts verfügbar</option>';
        return;
      }
      // Standard-Layout: A4 Hoch bevorzugen
      var defaultIdx = 0;
      for (var di = 0; di < layouts.length; di++) {
        if (layouts[di].paper === 'A4' && layouts[di].orientation === 'portrait') {
          defaultIdx = di;
          break;
        }
      }
      layouts.forEach(function (l, idx) {
        var opt = document.createElement('option');
        opt.value = l.value;
        opt.textContent = l.label;
        if (idx === defaultIdx) opt.selected = true;
        select.appendChild(opt);
      });
      updateFrameSize();
      loadSvgPreview();
      console.log('[Drucken] ' + layouts.length + ' Layouts geladen');
    });
  }

  // ================================================================
  //  Druckrahmen (OL Overlay) + SVG-Template-Vorschau
  // ================================================================
  function showPrintFrame() {
    var map = getMap();
    if (!map) return;
    removePrintFrame();

    _frameEl = document.createElement('div');
    _frameEl.className = 'print-frame-rect';

    // SVG-Vorschau-Bild (wird per loadSvgPreview befüllt)
    _svgPreviewImg = document.createElement('img');
    _svgPreviewImg.className = 'print-frame-svg-preview';
    _svgPreviewImg.style.display = 'none';
    _svgPreviewImg.draggable = false;
    _frameEl.appendChild(_svgPreviewImg);

    _frameOverlay = new ol.Overlay({
      element: _frameEl,
      positioning: 'center-center',
      position: map.getView().getCenter(),
      stopEvent: false,
      className: 'print-frame-overlay-container'
    });
    map.addOverlay(_frameOverlay);

    // Initiale Grösse und Position berechnen
    updateFrameSize();
    // SVG-Vorschau laden
    loadSvgPreview();

    map.getView().on('change:center', _onViewChange);
    map.getView().on('change:resolution', _onViewChange);
    map.getView().on('change:rotation', _onViewChange);
  }

  function _onViewChange() {
    updateFrameSize();
  }

  function updateFrameSize() {
    if (!_frameEl || !_map) return;
    var layoutVal = (document.getElementById('print-layout') || {}).value || '';
    var layout = _layouts.find(function (l) { return l.value === layoutVal; });

    // mapFrame-Dimensionen aus dem Manifest (mm auf Papier)
    var mapFrameW_mm, mapFrameH_mm;
    if (layout && layout.mapFrame) {
      mapFrameW_mm = layout.mapFrame.width_mm;
      mapFrameH_mm = layout.mapFrame.height_mm;
    } else {
      mapFrameW_mm = (layout && layout.width_mm) || 210;
      mapFrameH_mm = (layout && layout.height_mm) || 297;
    }

    // Gewählter Druckmassstab
    var scaleVal = parseInt((document.getElementById('print-scale') || {}).value) || 10000;

    var view = _map.getView();
    var mpu  = view.getProjection().getMetersPerUnit() || 1;
    var center = view.getCenter();
    var res  = view.getResolution();
    var rot  = view.getRotation() || 0;

    // ── Geographische Ausdehnung in Projektionseinheiten (LV95: Meter) ──
    var halfW = (mapFrameW_mm / 1000) * scaleVal / (2 * mpu);
    var halfH = (mapFrameH_mm / 1000) * scaleVal / (2 * mpu);

    // ── Pixelgrösse direkt aus Resolution (rotations-unabhängig) ──
    // Keine getPixelFromCoordinate — die enthält Rotation und verzerrt.
    var w = (halfW * 2) / res;
    var h = (halfH * 2) / res;
    _frameEl.style.width  = Math.round(w) + 'px';
    _frameEl.style.height = Math.round(h) + 'px';

    // Kein CSS-Rotate: Rahmen bleibt immer achsparallel zum Browserfenster.
    // Die Karte wird gedreht, nicht der Rahmen.

    // Overlay-Position = View-Center
    if (_frameOverlay) {
      _frameOverlay.setPosition(center);
    }

    // ── SVG-Vorschau positionieren ──
    if (_svgPreviewImg && _svgPreviewImg.style.display !== 'none' && layout) {
      var paperW_mm = layout.width_mm || 210;
      var paperH_mm = layout.height_mm || 297;
      // Skalierung: gesamtes Papier relativ zum Kartenbereich
      var svgDispW = w * (paperW_mm / mapFrameW_mm);
      var svgDispH = h * (paperH_mm / mapFrameH_mm);
      _svgPreviewImg.style.width  = Math.round(svgDispW) + 'px';
      _svgPreviewImg.style.height = Math.round(svgDispH) + 'px';
      // Offset: MAP_AREA liegt innerhalb des Papiers
      var mfX_mm = (layout.mapFrame && layout.mapFrame.x_mm) || 0;
      var mfY_mm = (layout.mapFrame && layout.mapFrame.y_mm) || 0;
      // Auto-Fix: Falls y_mm die Unterkante ist
      if (mfY_mm + mapFrameH_mm > paperH_mm * 1.05) {
        mfY_mm = mfY_mm - mapFrameH_mm;
      }
      var offsetX = mfX_mm * (w / mapFrameW_mm);
      var offsetY = mfY_mm * (h / mapFrameH_mm);
      _svgPreviewImg.style.left = Math.round(-offsetX) + 'px';
      _svgPreviewImg.style.top  = Math.round(-offsetY) + 'px';
    }
  }

  function removePrintFrame() {
    if (_frameOverlay && _map) {
      _map.removeOverlay(_frameOverlay);
      _map.getView().un('change:center', _onViewChange);
      _map.getView().un('change:resolution', _onViewChange);
      _map.getView().un('change:rotation', _onViewChange);
    }
    _frameOverlay = null;
    _frameEl = null;
    _svgPreviewImg = null;
  }

  // ================================================================
  //  SVG-Template-Vorschau laden
  //
  //  Lädt das SVG des gewählten Layouts, stanzt die MAP_AREA aus
  //  (transparent), und zeigt es als Bild über dem Druckrahmen.
  // ================================================================
  function loadSvgPreview() {
    if (!_svgPreviewImg) return;
    var layoutVal = (document.getElementById('print-layout') || {}).value || '';
    var layout = _layouts.find(function (l) { return l.value === layoutVal; });
    if (!layout || !layout.files || !layout.files.svg) {
      _svgPreviewImg.style.display = 'none';
      return;
    }

    // Cache prüfen
    if (_svgPreviewCache[layoutVal]) {
      _svgPreviewImg.src = _svgPreviewCache[layoutVal];
      _svgPreviewImg.style.display = '';
      return;
    }

    // SVG laden über die TemplatePdfExport-API
    if (typeof TemplatePdfExport === 'undefined' || !TemplatePdfExport.loadTemplateSvg) {
      _svgPreviewImg.style.display = 'none';
      return;
    }

    TemplatePdfExport.loadTemplateSvg(layout).then(function (svgText) {
      var parser = new DOMParser();
      var doc = parser.parseFromString(svgText, 'image/svg+xml');
      var svg = doc.documentElement;

      // MAP_AREA-Elemente ausblenden
      var allEls = doc.querySelectorAll('[id]');
      for (var i = 0; i < allEls.length; i++) {
        var elId = allEls[i].getAttribute('id') || '';
        if (elId.indexOf('MAP_AREA') >= 0 && elId.indexOf('LABEL') < 0) {
          allEls[i].setAttribute('visibility', 'hidden');
        }
      }

      // "[ MAP AREA ]" Text entfernen
      var texts = doc.querySelectorAll('text');
      for (var j = 0; j < texts.length; j++) {
        if ((texts[j].textContent || '').indexOf('MAP AREA') >= 0) {
          texts[j].setAttribute('visibility', 'hidden');
        }
      }

      // Gestrichelte blaue MAP_AREA-Rects ausblenden
      var svgRects = doc.querySelectorAll('rect');
      for (var k = 0; k < svgRects.length; k++) {
        var st = svgRects[k].getAttribute('style') || '';
        var da = svgRects[k].getAttribute('stroke-dasharray') || '';
        var sk = svgRects[k].getAttribute('stroke') || '';
        if ((st.indexOf('dash') >= 0 || da) &&
            (sk.indexOf('2196') >= 0 || st.indexOf('2196') >= 0)) {
          svgRects[k].setAttribute('visibility', 'hidden');
        }
      }

      // Originalen QGIS-Seitenhintergrund (weisser Full-Page-Path) entfernen
      // QGIS exportiert <g fill="#ffffff"><path d="M-2,-2 L3510,-2 ..."/></g>
      var vb = svg.getAttribute('viewBox');
      var vbParts = vb ? vb.split(/[\s,]+/).map(Number) : null;
      if (vbParts) {
        var vbW = vbParts[2], vbH = vbParts[3];
        var bgGroups = doc.querySelectorAll('g[fill="#ffffff"], g[fill="white"]');
        for (var bg = 0; bg < bgGroups.length; bg++) {
          var bgPaths = bgGroups[bg].querySelectorAll('path');
          for (var bp = 0; bp < bgPaths.length; bp++) {
            var pd = bgPaths[bp].getAttribute('d') || '';
            var coords = pd.match(/-?\d+\.?\d*/g);
            if (coords && coords.length >= 8) {
              var xs = [parseFloat(coords[0]), parseFloat(coords[2]), parseFloat(coords[4]), parseFloat(coords[6])];
              var ys = [parseFloat(coords[1]), parseFloat(coords[3]), parseFloat(coords[5]), parseFloat(coords[7])];
              var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
              var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
              var pathW = maxX - minX, pathH = maxY - minY;
              if (pathW >= vbW * 0.9 && pathH >= vbH * 0.9) {
                bgGroups[bg].setAttribute('visibility', 'hidden');
                console.log('[Drucken] QGIS-Seitenhintergrund ausgeblendet');
              }
            }
          }
        }
      }

      // Weisses Blatt mit MAP_AREA-Loch (Compound Path, fill-rule evenodd)
      if (vb && layout.mapFrame) {
        var parts = vb.split(/[\s,]+/).map(Number);
        var paperW = layout.width_mm || 210;
        var paperH = layout.height_mm || 297;
        var sx = parts[2] / paperW;
        var sy = parts[3] / paperH;
        var mf = layout.mapFrame;
        var mfY = mf.y_mm;
        if (mfY + mf.height_mm > paperH * 1.05) mfY = mfY - mf.height_mm;

        // Outer rect (CW) = ganzes Blatt, Inner rect (CCW) = MAP_AREA Loch
        var ox = parts[0], oy = parts[1], ow = parts[2], oh = parts[3];
        var ix = (mf.x_mm * sx), iy = (mfY * sy);
        var iw = (mf.width_mm * sx), ih = (mf.height_mm * sy);

        var d = 'M' + ox + ',' + oy
              + ' L' + (ox + ow) + ',' + oy
              + ' L' + (ox + ow) + ',' + (oy + oh)
              + ' L' + ox + ',' + (oy + oh)
              + ' Z'
              + ' M' + ix.toFixed(2) + ',' + iy.toFixed(2)
              + ' L' + ix.toFixed(2) + ',' + (iy + ih).toFixed(2)
              + ' L' + (ix + iw).toFixed(2) + ',' + (iy + ih).toFixed(2)
              + ' L' + (ix + iw).toFixed(2) + ',' + iy.toFixed(2)
              + ' Z';

        var maskPath = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
        maskPath.setAttribute('d', d);
        maskPath.setAttribute('fill', 'white');
        maskPath.setAttribute('fill-rule', 'evenodd');
        // Als allererstes Element einfügen (unter allen SVG-Inhalten)
        if (svg.firstChild) svg.insertBefore(maskPath, svg.firstChild);
        else svg.appendChild(maskPath);
      }

      var serialized = new XMLSerializer().serializeToString(doc);
      var dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(serialized);
      _svgPreviewCache[layoutVal] = dataUrl;

      if (_svgPreviewImg) {
        _svgPreviewImg.src = dataUrl;
        _svgPreviewImg.style.display = '';
      }
      console.log('[Drucken] SVG-Vorschau geladen für:', layoutVal);
    }).catch(function (err) {
      console.warn('[Drucken] SVG-Vorschau Fehler:', err.message);
      if (_svgPreviewImg) _svgPreviewImg.style.display = 'none';
    });
  }

  // ================================================================
  //  Rotation
  // ================================================================
  function syncRotationUI() {
    var map = getMap();
    if (!map) return;
    var deg = Math.round(map.getView().getRotation() * 180 / Math.PI);
    var el = document.getElementById('print-rotation');
    if (el) el.value = deg;
    var lbl = document.getElementById('print-rotation-val');
    if (lbl) lbl.textContent = deg + '\u00b0';
  }

  window.printRotateBy = function (deg) {
    var map = getMap();
    if (!map) return;
    map.getView().adjustRotation(deg * Math.PI / 180);
    syncRotationUI();
  };

  window.printResetRotation = function () {
    var map = getMap();
    if (!map) return;
    map.getView().setRotation(0);
    syncRotationUI();
  };

  // ================================================================
  //  Massstab-Preset
  // ================================================================
  window.setScale = function (val) {
    var el = document.getElementById('print-scale');
    if (el) el.value = val;
  };

  // ================================================================
  //  Zoom anpassen für Druckrahmen
  // ================================================================
  /**
   * Passt den Kartenausschnitt an, damit der Druckrahmen ca. 70% des
   * sichtbaren Viewports ausfüllt (nicht zu gross, nicht zu klein).
   */
  function adjustZoomForPrintFrame() {
    var map = getMap();
    if (!map || !_frameEl) return;

    // Konfiguration aus Global Config
    var autoAdjust = (_globalConfig.print && _globalConfig.print.autoAdjustZoom !== false);
    if (!autoAdjust) return;
    
    var targetPercent = (_globalConfig.print && _globalConfig.print.targetFramePercent) || 70;
    targetPercent = Math.max(40, Math.min(95, targetPercent)); // Clamp 40-95%

    // Aktuelles Viewport ermitteln
    var mapEl = map.getTargetElement();
    if (!mapEl) return;
    var vpW = mapEl.clientWidth;
    var vpH = mapEl.clientHeight;

    // Aktuelle Frame-Grösse berechnen
    var frameW = parseFloat(_frameEl.style.width) || 0;
    var frameH = parseFloat(_frameEl.style.height) || 0;
    if (frameW <= 0 || frameH <= 0) return;

    // Verhältnis: wie viel % des Viewports nimmt der Frame ein?
    var ratioW = (frameW / vpW) * 100;
    var ratioH = (frameH / vpH) * 100;
    var currentRatio = Math.max(ratioW, ratioH);

    // Abweichung vom Ziel berechnen
    // Wenn Frame < 40% oder > 90% des Viewports, anpassen
    if (currentRatio >= 40 && currentRatio <= 90) {
      console.log('[Drucken] Frame-Grösse OK:', Math.round(currentRatio) + '% des Viewports');
      return; // Passt schon
    }

    // Faktor berechnen: um wie viel muss Resolution geändert werden?
    var scaleFactor = currentRatio / targetPercent;
    var view = map.getView();
    var currentRes = view.getResolution();
    var newRes = currentRes * scaleFactor;

    // Resolution setzen
    view.animate({ resolution: newRes, duration: 300 });
    console.log('[Drucken] Zoom angepasst:', Math.round(currentRatio) + '% → ' + 
      targetPercent + '% (Resolution:', currentRes.toFixed(2), '→', newRes.toFixed(2) + ')');

    // Nach Animation Frame-Grösse aktualisieren
    setTimeout(updateFrameSize, 350);
  }

  // ================================================================
  //  Panel öffnen / schliessen
  // ================================================================
  window.openPdfPrinter = function () {
    if (typeof toggleHeaderMenu === 'function') toggleHeaderMenu();
    if (!getMap()) {
      alert('Drucken ist erst verfügbar, wenn die Karte vollständig geladen ist.');
      return;
    }

    // Libraries bei Bedarf laden, dann Layouts holen
    var doOpen = function () {
      loadLayouts();
      // Aktuellen Massstab im Dropdown auf nächsten Wert setzen
      var map = getMap();
      if (map) {
        var mpu = map.getView().getProjection().getMetersPerUnit() || 1;
        var currentScale = Math.round(map.getView().getResolution() * mpu / 0.00028);
        var closest = _scales.reduce(function (prev, curr) {
          return Math.abs(curr - currentScale) < Math.abs(prev - currentScale) ? curr : prev;
        });
        document.getElementById('print-scale').value = closest;
      }
      syncRotationUI();
      document.getElementById('print-panel').classList.remove('hidden');
      // Panel andocken (Default) oder floating
      if (_isPrintPanelDocked) {
        dockPrintPanel();
      }
      showPrintFrame();
      // Kartenausschnitt anpassen: Frame sollte ca. 60-80% des Viewports füllen
      adjustZoomForPrintFrame();
    };

    if (_libsReady) {
      doOpen();
    } else {
      loadLibraries().then(doOpen).catch(function (err) {
        console.error('[Drucken] Libraries konnten nicht geladen werden:', err);
        alert('PDF-Export konnte nicht initialisiert werden.\n' + err.message);
      });
    }
  };

  window.closePrintPanel = function () {
    var panel = document.getElementById('print-panel');
    if (panel) panel.classList.add('hidden');
    removePrintFrame();
    var map = getMap();
    if (map) map.getView().setRotation(0);
    // Falls angedockt: mapContainer zurücksetzen
    if (_isPrintPanelDocked) {
      var mapContainer = document.getElementById('mapContainer');
      if (mapContainer) {
        mapContainer.style.setProperty('width', '100%', 'important');
        triggerPrintMapUpdate();
      }
      stopPrintObservers();
    }
  };

  // ================================================================
  //  PDF erstellen (zur Queue hinzufügen)
  // ================================================================
  window.executePrint = function () {
    var map = getMap();
    if (!map) { alert('Karte nicht bereit.'); return; }
    if (typeof templatePdfPrint !== 'function') { alert('PDF-Export-API nicht geladen.'); return; }

    var layout         = document.getElementById('print-layout').value;
    var massstab       = parseInt(document.getElementById('print-scale').value) || 10000;
    var dpiEl          = document.querySelector('input[name="print-dpi"]:checked');
    var aufloesung     = dpiEl ? parseInt(dpiEl.value) : 150;
    var kartentitel    = document.getElementById('print-title').value || '';
    var gridEl          = document.getElementById('print-grid');
    var koordinatennetz = gridEl ? gridEl.checked : false;
    var netzfarbeEl    = document.querySelector('input[name="print-gridcolor"]:checked');
    var netzfarbe      = netzfarbeEl ? netzfarbeEl.value : 'schwarz';
    var rotation       = parseInt(document.getElementById('print-rotation').value) || 0;
    var serverRenderEl  = document.getElementById('print-server-render');
    var serverRender    = serverRenderEl ? serverRenderEl.checked : false;
    var svgFormatEl     = document.getElementById('print-svg-format');
    var svgFormat       = svgFormatEl ? svgFormatEl.checked : false;

    // ─ Neuer Job ─
    var jobId = ++_jobIdCounter;
    var printCenter = map.getView().getCenter().slice();
    var job = {
      id: jobId,
      status: 'pending',  // pending, processing, completed, failed
      title: kartentitel || ('Druck #' + jobId),
      progress: 0,
      error: null,
      blob: null,
      filename: null,
      timestamp: new Date().toLocaleString('de-CH'),
      params: {
        massstab: massstab,
        layout: layout,
        aufloesung: aufloesung,
        rotation: rotation,
        kartentitel: kartentitel,
        koordinatennetz: koordinatennetz,
        netzfarbe: netzfarbe,
        printCenter: printCenter,
        serverRender: serverRender,
        svgFormat: svgFormat,
        jpegQuality: (_globalConfig.print && _globalConfig.print.jpegQuality) || 0.7,
        serverDpi: (_globalConfig.print && _globalConfig.print.serverDpi) || 96
      }
    };

    _printQueue.push(job);
    console.log('[Print-Queue] Job #' + jobId + ' hinzugefügt. Queue-Länge:', _printQueue.length);
    updateQueueUI();
    processNextQueueJob();
  };

  // ================================================================
  //  Queue-Worker: Verarbeitet Jobs sequenziell
  // ================================================================
  function processNextQueueJob() {
    if (_queueWorkerScheduled) return;
    if (_currentJobId !== null) return;  // Job läuft bereits
    
    var job = _printQueue.find(function (j) { return j.status === 'pending'; });
    if (!job) return;

    _currentJobId = job.id;
    job.status = 'processing';
    updateQueueUI();

    console.log('[Print-Queue] Starte Job #' + job.id + ': ' + job.title);

    templatePdfPrint({
      massstab:        job.params.massstab,
      layout:          job.params.layout,
      aufloesung:      job.params.aufloesung,
      rotation:        job.params.rotation,
      kartentitel:     job.params.kartentitel,
      koordinatennetz: job.params.koordinatennetz,
      netzfarbe:       job.params.netzfarbe,
      printCenter:     job.params.printCenter,
      serverRender:    job.params.serverRender,
      svgFormat:       job.params.svgFormat,
      jpegQuality:     job.params.jpegQuality,
      serverDpi:       job.params.serverDpi,

      onProgress: function (step, msg) {
        job.progress = Math.round((step / 7) * 100);
        updateQueueUI();
        // UI-Update pro Job
        if (job.id === _currentJobId) {
          document.getElementById('print-progress-fill').style.width = job.progress + '%';
          document.getElementById('print-progress-text').textContent = msg;
        }
      },

      onSuccess: function (result) {
        job.blob = result.blob;
        job.filename = result.filename;
        job.status = 'completed';
        job.progress = 100;
        
        handlePdfResult(job.blob, job.filename);
        console.log('[Print-Queue] Job #' + job.id + ' abgeschlossen: ' + job.filename);
        
        finishQueueJobUI();
        _currentJobId = null;
        updateQueueUI();
        
        // Nächsten Job nach kurzer Verzögerung starten
        setTimeout(function () {
          processNextQueueJob();
        }, 500);
      },

      onError: function (err) {
        job.status = 'failed';
        job.error = err.message;
        console.error('[Print-Queue] Job #' + job.id + ' Fehler:', err);
        
        finishQueueJobUI();
        _currentJobId = null;
        updateQueueUI();
        
        // Nächsten Job starten trotz Fehler
        setTimeout(function () {
          processNextQueueJob();
        }, 500);
      }
    });
  }

  function finishQueueJobUI() {
    var btn = document.getElementById('print-exec-btn');
    btn.disabled = false;
    btn.classList.remove('printing');
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z" fill="currentColor"/></svg> PDF erstellen';

    setTimeout(function () {
      document.getElementById('print-progress').style.display = 'none';
      document.getElementById('print-progress-fill').style.width = '0%';
    }, 2000);
  }

  function updateQueueUI() {
    var queueList = document.getElementById('print-queue-list');
    var queueAcc = document.getElementById('print-queue-acc');
    var queueCount = document.getElementById('print-queue-count');
    
    if (!queueList) return;

    var pendingCount = _printQueue.filter(function (j) { return j.status === 'pending'; }).length;
    var processingJob = _printQueue.find(function (j) { return j.status === 'processing'; });
    
    queueCount.textContent = _printQueue.length;
    
    // Zeige Accordion wenn Jobs vorhanden
    if (_printQueue.length > 0) {
      queueAcc.style.display = 'block';
    } else {
      queueAcc.style.display = 'none';
      return;
    }

    var html = '';
    _printQueue.forEach(function (job) {
      var statusClass = 'queue-job-' + job.status;
      var statusLabel = {
        pending: '⏳ In Warteschlange',
        processing: '⚙ Wird verarbeitet',
        completed: '✓ Fertig',
        failed: '✕ Fehler'
      }[job.status] || job.status;

      html += 
        '<div class="queue-job ' + statusClass + '">' +
          '<div class="queue-job-header">' +
            '<span class="queue-job-title">' + job.title + '</span>' +
            '<span class="queue-job-status">' + statusLabel + '</span>' +
          '</div>';
      
      if (job.status === 'processing') {
        html += 
          '<div class="queue-job-progress">' +
            '<div class="queue-job-progress-bar"><div class="queue-job-progress-fill" style="width:' + job.progress + '%"></div></div>' +
            '<span class="queue-job-progress-text">' + job.progress + '%</span>' +
          '</div>';
      }
      
      if (job.status === 'completed' && job.blob) {
        html +=
          '<div class="queue-job-actions">' +
            '<button class="queue-job-btn" onclick="downloadJobPdf(' + job.id + ')">⬇ Download</button>' +
          '</div>';
      }
      
      if (job.status === 'failed') {
        html +=
          '<div class="queue-job-error">' + job.error + '</div>';
      }
      
      html += '</div>';
    });

    queueList.innerHTML = html;
  }

  window.downloadJobPdf = function (jobId) {
    var job = _printQueue.find(function (j) { return j.id === jobId; });
    if (!job || !job.blob) return;
    
    var blobUrl = URL.createObjectURL(job.blob);
    var link = document.createElement('a');
    link.href = blobUrl;
    link.download = job.filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(blobUrl);
  };

  // ================================================================
  //  PDF im Memory behalten + parallel auf Server loggen
  // ================================================================
  function handlePdfResult(blob, filename) {
    // Blob-URL erstellen
    var blobUrl = URL.createObjectURL(blob);
    
    // In Download-Liste aufnehmen
    addDownload(filename, blobUrl, blob.size);
    
    // Vorschau sofort anzeigen
    showPdfPreview(blobUrl);
    
    console.log('[Drucken] PDF fertig:', filename, '(' + blob.size + ' Bytes)');
    
    // Parallel: PDF auf Server loggen (fire-and-forget)
    logPdfToServer(blob, filename);
  }
  
  /**
   * Sendet PDF an Server zur Archivierung im Log-Verzeichnis.
   * Fire-and-forget — Fehler werden nur geloggt, nicht dem User gezeigt.
   */
  function logPdfToServer(blob, filename) {
    var formData = new FormData();
    formData.append('pdf', blob, filename);
    formData.append('filename', filename);
    
    // Retention aus Config (Default: 1 Tag)
    var retentionDays = (_globalConfig.print && _globalConfig.print.pdfRetentionDays) || 1;
    var url = PDF_LOG_URL + '?retention=' + retentionDays;
    
    fetch(url, { method: 'POST', body: formData })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.ok) {
          console.log('[Drucken] PDF archiviert:', data.path);
        } else {
          console.warn('[Drucken] PDF-Archivierung fehlgeschlagen:', data.error);
        }
      })
      .catch(function(err) {
        console.warn('[Drucken] PDF-Archivierung Fehler:', err.message);
      });
  }

  // ================================================================
  //  PDF-Vorschau (iframe)
  // ================================================================
  function showPdfPreview(url) {
    var accDiv = document.getElementById('print-preview-acc');
    var iframe = document.getElementById('print-preview-frame');
    if (!accDiv || !iframe) return;
    iframe.src = url;
    accDiv.style.display = '';
    // Accordion aufklappen
    accDiv.classList.add('is-open');
    // Zum Vorschau-Bereich scrollen
    accDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  window.closePrintPreview = function () {
    var accDiv = document.getElementById('print-preview-acc');
    var iframe = document.getElementById('print-preview-frame');
    if (accDiv) { accDiv.style.display = 'none'; accDiv.classList.remove('is-open'); }
    if (iframe) iframe.src = 'about:blank';
  };

  window.previewPrintDownload = function (idx) {
    if (_downloads[idx] && _downloads[idx].url) {
      showPdfPreview(_downloads[idx].url);
    }
  };

  // ================================================================
  //  Accordion Toggle
  // ================================================================
  window.togglePrintAccordion = function (id) {
    var acc = document.getElementById(id);
    if (!acc) return;
    acc.classList.toggle('is-open');
  };

  // ================================================================
  //  Download-Liste
  // ================================================================
  function formatFileSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function addDownload(name, url, size) {
    _downloads.push({ name: name, url: url, size: size, date: new Date() });
    renderDownloads();
  }

  function renderDownloads() {
    var accDiv = document.getElementById('print-downloads-acc');
    var list = document.getElementById('print-download-list');
    if (!accDiv || !list) return;
    if (_downloads.length > 0) {
      accDiv.style.display = '';
      accDiv.classList.add('is-open');
    } else {
      accDiv.style.display = 'none';
    }
    list.innerHTML = '';
    _downloads.forEach(function (dl, idx) {
      var item = document.createElement('div');
      item.className = 'print-dl-item';
      var time = String(dl.date.getHours()).padStart(2, '0') + ':' +
                 String(dl.date.getMinutes()).padStart(2, '0');
      var sizeStr = formatFileSize(dl.size);
      item.innerHTML =
        '<div class="print-dl-main">' +
          '<a href="' + dl.url + '" download="' + dl.name + '" title="Herunterladen">' + dl.name + '</a>' +
          '<span class="dl-meta">' + time + (sizeStr ? ' \u00b7 ' + sizeStr : '') + '</span>' +
        '</div>' +
        '<div class="print-dl-actions">' +
          '<button class="dl-preview-btn" onclick="previewPrintDownload(' + idx + ')" title="Vorschau">\uD83D\uDD0D</button>' +
          '<a class="dl-download-btn" href="' + dl.url + '" download="' + dl.name + '" title="Herunterladen">\u2B07</a>' +
          '<button class="dl-remove" onclick="removePrintDownload(' + idx + ')" title="Entfernen">&times;</button>' +
        '</div>';
      list.appendChild(item);
    });
  }

  window.removePrintDownload = function (idx) {
    if (_downloads[idx]) {
      _downloads.splice(idx, 1);
      renderDownloads();
      // Vorschau schliessen falls leer
      if (_downloads.length === 0) window.closePrintPreview();
    }
  };

  // ================================================================
  //  Dock / Undock (analog Info-Panel + ÖREB)
  // ================================================================
  function triggerPrintMapUpdate() {
    setTimeout(function () {
      if (window.njs && njs.AppManager && njs.AppManager.Maps && njs.AppManager.Maps['main']) {
        var mapObj = njs.AppManager.Maps['main'].mapObj;
        if (mapObj && mapObj.updateSize) mapObj.updateSize();
      }
      if (typeof dijit !== 'undefined' && dijit.byId('NeapolisContainer')) {
        dijit.byId('NeapolisContainer').resize();
      }
    }, 350);
  }

  function dockPrintPanel() {
    var panel = document.getElementById('print-panel');
    var dockBtn = document.getElementById('print-dock-btn');
    var mapContainer = document.getElementById('mapContainer');
    if (!panel) return;

    panel.classList.add('docked-right');
    _isPrintPanelDocked = true;

    if (mapContainer) {
      var panelWidth = _savedPrintDockedWidth || 380;
      var centerPane = document.getElementById('centerPaneLayout');
      var streetviewContainer = document.getElementById('streetviewContainer');
      var streetviewWidth = 0;
      if (streetviewContainer && streetviewContainer.offsetWidth > 0 && streetviewContainer.style.display !== 'none') {
        streetviewWidth = streetviewContainer.offsetWidth;
      }
      var centerRect = centerPane ? centerPane.getBoundingClientRect() : mapContainer.getBoundingClientRect();
      panel.style.setProperty('top', centerRect.top + 'px', 'important');
      panel.style.setProperty('right', streetviewWidth + 'px', 'important');
      panel.style.setProperty('bottom', (window.innerHeight - centerRect.bottom) + 'px', 'important');
      panel.style.setProperty('left', 'auto', 'important');
      panel.style.setProperty('width', panelWidth + 'px', 'important');
      panel.style.setProperty('height', 'auto', 'important');

      var centerPaneWidth = centerPane ? centerPane.offsetWidth : window.innerWidth;
      var mapWidth = centerPaneWidth - streetviewWidth - panelWidth;
      mapContainer.style.setProperty('width', mapWidth + 'px', 'important');
      triggerPrintMapUpdate();
    }

    startPrintObservers();

    if (dockBtn) {
      dockBtn.title = 'Floating';
      dockBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z"/></svg>';
    }
  }

  function undockPrintPanel() {
    var panel = document.getElementById('print-panel');
    var dockBtn = document.getElementById('print-dock-btn');
    var mapContainer = document.getElementById('mapContainer');
    if (!panel) return;

    panel.classList.remove('docked-right');
    stopPrintObservers();
    _isPrintPanelDocked = false;

    if (mapContainer) {
      mapContainer.style.setProperty('width', '100%', 'important');
      setTimeout(function () { triggerPrintMapUpdate(); }, 100);
    }

    // Floating-Position
    panel.style.setProperty('top', '80px', 'important');
    panel.style.setProperty('left', 'calc(100vw - 420px)', 'important');
    panel.style.setProperty('width', '380px', 'important');
    panel.style.setProperty('height', 'calc(100vh - 160px)', 'important');
    panel.style.setProperty('right', 'auto', 'important');
    panel.style.setProperty('bottom', 'auto', 'important');
    panel.style.maxHeight = '';

    if (dockBtn) {
      dockBtn.title = 'Rechts andocken';
      dockBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16h-4V5h4v14z"/></svg>';
    }
  }

  window.togglePrintPanelDock = function () {
    if (_isPrintPanelDocked) {
      undockPrintPanel();
    } else {
      dockPrintPanel();
    }
  };

  // ── Observers für Layout-Änderungen (StreetView, Fenster-Resize) ──
  function startPrintObservers() {
    stopPrintObservers();
    var mapContainer = document.getElementById('mapContainer');
    if (!mapContainer || !window.ResizeObserver) return;

    _printResizeObserver = new ResizeObserver(function () {
      if (!_isPrintPanelDocked) return;
      updateDockedPrintPosition();
    });
    _printResizeObserver.observe(mapContainer);

    var sv = document.getElementById('streetviewContainer');
    if (sv) _printResizeObserver.observe(sv);

    window.addEventListener('resize', updateDockedPrintPosition);
  }

  function stopPrintObservers() {
    if (_printResizeObserver) {
      _printResizeObserver.disconnect();
      _printResizeObserver = null;
    }
    window.removeEventListener('resize', updateDockedPrintPosition);
  }

  function updateDockedPrintPosition() {
    var panel = document.getElementById('print-panel');
    var mapContainer = document.getElementById('mapContainer');
    if (!panel || !_isPrintPanelDocked) return;

    var panelWidth = panel.offsetWidth || _savedPrintDockedWidth;
    var centerPane = document.getElementById('centerPaneLayout');
    var streetviewContainer = document.getElementById('streetviewContainer');
    var streetviewWidth = 0;
    if (streetviewContainer && streetviewContainer.offsetWidth > 0 && streetviewContainer.style.display !== 'none') {
      streetviewWidth = streetviewContainer.offsetWidth;
    }
    var centerRect = centerPane ? centerPane.getBoundingClientRect() : (mapContainer ? mapContainer.getBoundingClientRect() : { top: 60, bottom: window.innerHeight });
    panel.style.setProperty('top', centerRect.top + 'px', 'important');
    panel.style.setProperty('right', streetviewWidth + 'px', 'important');
    panel.style.setProperty('bottom', (window.innerHeight - centerRect.bottom) + 'px', 'important');

    if (mapContainer) {
      var centerPaneWidth = centerPane ? centerPane.offsetWidth : window.innerWidth;
      var mapWidth = centerPaneWidth - streetviewWidth - panelWidth;
      mapContainer.style.setProperty('width', mapWidth + 'px', 'important');
    }
  }

  // ── Resize-Handle (links) im angedockten Modus ──
  function initPrintPanelResize() {
    var panel = document.getElementById('print-panel');
    if (!panel || panel.querySelector('.print-resize-handle')) return;

    var handle = document.createElement('div');
    handle.className = 'print-resize-handle';
    panel.appendChild(handle);

    var isResizing = false;
    var startX, startWidth;

    handle.addEventListener('mousedown', function (e) {
      if (!_isPrintPanelDocked) return;
      isResizing = true;
      startX = e.clientX;
      startWidth = panel.offsetWidth;
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', function (e) {
      if (!isResizing) return;
      var dx = e.clientX - startX;
      var newWidth = Math.max(300, Math.min(startWidth - dx, window.innerWidth - 200));
      panel.style.setProperty('width', newWidth + 'px', 'important');
      _savedPrintDockedWidth = newWidth;

      var mapContainer = document.getElementById('mapContainer');
      if (mapContainer) {
        mapContainer.style.setProperty('width', 'calc(100% - ' + newWidth + 'px)', 'important');
      }
      e.preventDefault();
    });

    document.addEventListener('mouseup', function () {
      if (isResizing) {
        isResizing = false;
        document.body.style.userSelect = '';
        triggerPrintMapUpdate();
      }
    });
  }

  // ================================================================
  //  Init: Panel-HTML einfügen + Event-Listener
  // ================================================================
  function init() {
    // Config laden (Massstäbe aus tnet-global-config.json5)
    loadScalesFromConfig();

    // Panel-HTML vor </body> einfügen
    var container = document.createElement('div');
    container.innerHTML = createPanelHTML();
    var panel = container.firstElementChild;
    document.body.appendChild(panel);

    // Massstab-Dropdown dynamisch aus Config rendern
    renderScaleDropdown();

    // Layout-Wechsel → Rahmen + SVG-Vorschau anpassen
    var layoutSel = document.getElementById('print-layout');
    if (layoutSel) layoutSel.addEventListener('change', function () {
      updateFrameSize();
      loadSvgPreview();
    });

    // Massstab-Wechsel → Rahmen anpassen
    var scaleSel = document.getElementById('print-scale');
    if (scaleSel) scaleSel.addEventListener('change', updateFrameSize);

    // Koordinatennetz Checkbox → Farbwahl ein-/ausblenden
    var gridCb = document.getElementById('print-grid');
    if (gridCb) gridCb.addEventListener('change', function () {
      document.getElementById('print-grid-color').style.display = gridCb.checked ? 'flex' : 'none';
    });

    // Server-Rendering Checkbox: Default aus Config
    var srCb = document.getElementById('print-server-render');
    if (srCb && _globalConfig.print && _globalConfig.print.serverRenderDefault) {
      srCb.checked = true;
    }

    // SVG-Format Checkbox: immer sichtbar (SVG auch ohne Server-Rendering nutzbar)
    var svgCb = document.getElementById('print-svg-format');
    if (svgCb && _globalConfig.print && _globalConfig.print.svgFormatDefault) {
      svgCb.checked = true;
    }

    // Rotation-Slider
    var rotSlider = document.getElementById('print-rotation');
    if (rotSlider) rotSlider.addEventListener('input', function () {
      var deg = parseInt(rotSlider.value);
      document.getElementById('print-rotation-val').textContent = deg + '\u00b0';
      var map = getMap();
      if (map) map.getView().setRotation(deg * Math.PI / 180);
    });

    console.log('[Drucken] tnet-print.js initialisiert');

    // Resize-Handle für Dock-Modus
    initPrintPanelResize();

    // Libraries im Hintergrund vorladen (kein Blockieren)
    loadLibraries().catch(function (err) {
      console.warn('[Drucken] Vorladen der PDF-Libraries fehlgeschlagen:', err);
    });
  }

  // Auto-Init bei DOMContentLoaded oder sofort falls DOM schon bereit
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
