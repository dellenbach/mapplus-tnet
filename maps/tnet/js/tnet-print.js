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
 * @version    1.3
 * @date       2026-02-22
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
  var _svgRawCache = {};        // {layoutValue: serializedSvg} — vor Variablen-Ersetzung
  var _isPrinting = false;
  var _isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
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
  var _printCenter = null;           // Druckrahmen-Mittelpunkt in Kartenkoordinaten (unabhängig vom View-Center)
  var _frameRotation = 0;            // Rahmen-Rotation in Radiant (unabhängig von Kartenrotation)
  var _savedInteractions = [];       // Deaktivierte OL-Interaktionen (nach Schliessen wiederhergestellt)
  var _savedPickingStates = {};      // Gespeicherter Picking-Zustand pro Map-ID
  var _frameDrag = null;             // Aktiver Drag-State: {type:'move'|'rotate', ...}
  var _frameDragHandlers = null;     // Document-Event-Handler-Referenzen für Cleanup

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
      TnetLog.log('[Drucken] PDF-Libraries geladen ✓');
    });

    return _libsPromise;
  }

  // ================================================================
  //  Config laden (tnet-global-config.json5 → scales)
  // ================================================================
  function loadScalesFromConfig() {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', '/maps/tnet/config/tnet-global-config.json5', false);
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
          TnetLog.log('[Drucken] ' + _scales.length + ' Massstäbe aus Config geladen');
        }
      }
    } catch (e) {
      TnetLog.warn('[Drucken] Config nicht geladen:', e.message);
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
              TnetIcons.get('undock', null, {width: '16', height: '16'}) +
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

          // Benutzer
          '<div class="print-section">' +
            '<label>Benutzer</label>' +
            '<input type="text" id="print-user" placeholder="Benutzer">' +
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
            'Rahmen verschieben: auf den Rahmen klicken und ziehen. Drehen: an einer Ecke ziehen. Zoomen: Mausrad.' +
          '</div>' +

          // Drucken-Button
          '<div class="print-section">' +
            '<button class="print-action-btn" id="print-exec-btn" onclick="executePrint()">' +
              TnetIcons.get('printer', null, {width: '18', height: '18'}) +
              ' PDF erstellen' +
            '</button>' +
          '</div>' +

          // Fortschritt
          '<div class="print-section print-progress" id="print-progress" style="display:none">' +
            '<div class="print-progress-bar"><div class="print-progress-fill" id="print-progress-fill"></div></div>' +
            '<div class="print-progress-text" id="print-progress-text">Wird erstellt...</div>' +
          '</div>' +

          // PDF Auftr\u00e4ge (vereinigtes Accordion: Queue + Downloads)
          '<div class="print-accordion" id="print-jobs-acc" style="display:none">' +
            '<div class="print-acc-header" onclick="togglePrintAccordion(\'print-jobs-acc\')">' +
              '<span class="print-acc-arrow">&#9654;</span> \uD83D\uDCCB PDF Auftr\u00e4ge (<span id="print-jobs-count">0</span>)' +
            '</div>' +
            '<div class="print-acc-panel">' +
              '<div id="print-jobs-list" class="print-jobs-list"></div>' +
              '<iframe id="print-preview-frame" class="print-preview-frame" style="display:none"></iframe>' +
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
      TnetLog.warn('[Drucken] getAvailableLayouts() nicht verfügbar');
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
      TnetLog.log('[Drucken] ' + layouts.length + ' Layouts geladen');
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

    // Ecken-Handles (Drehen) + Mittelpunkt-Marker — nur auf Desktop
    if (!_isMobile) {
      ['nw', 'ne', 'sw', 'se'].forEach(function (corner) {
        var h = document.createElement('div');
        h.className = 'print-corner-handle print-corner-' + corner;
        h.setAttribute('data-corner', corner);
        _frameEl.appendChild(h);
      });
      var centerDot = document.createElement('div');
      centerDot.className = 'print-center-dot';
      _frameEl.appendChild(centerDot);
    }

    _frameOverlay = new ol.Overlay({
      element: _frameEl,
      positioning: 'center-center',
      position: _printCenter,
      stopEvent: true,
      className: 'print-frame-overlay-container'
    });
    map.addOverlay(_frameOverlay);

    // Mobile: Frame bis nach Zoom-Animation unsichtbar (wird in adjustMapZoomMobile eingeblendet)
    if (_isMobile) {
      _frameEl.style.opacity = '0';
      _frameEl.style.transition = 'opacity 0.2s';
    }

    // Drag/Rotate-Interaktion — nur auf Desktop
    if (!_isMobile) {
      initFrameInteraction(map);
    }

    // Initiale Grösse und Position berechnen
    updateFrameSize();
    // SVG-Vorschau laden
    loadSvgPreview();

    map.getView().on('change:center', _onViewChange);
    map.getView().on('change:resolution', _onViewChange);
    map.getView().on('change:rotation', _onViewChange);
  }

  function _onViewChange() {
    // Mobile: Frame folgt der Kartenmitte (Benutzer verschiebt die Karte, nicht den Rahmen)
    if (_isMobile) {
      var m = getMap();
      if (m) {
        _printCenter = m.getView().getCenter().slice();
        if (_frameOverlay) _frameOverlay.setPosition(_printCenter);
      }
    }
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

    // Overlay-Position = _printCenter (unabhängig vom View-Center)
    if (_frameOverlay) {
      _frameOverlay.setPosition(_printCenter || center);
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
    // Drag-Handler entfernen
    if (_frameDragHandlers) {
      document.removeEventListener('mousemove', _frameDragHandlers.move);
      document.removeEventListener('mouseup', _frameDragHandlers.up);
      _frameDragHandlers = null;
    }
    _frameDrag = null;
    document.body.style.cursor = '';

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
  //  Rahmen-Drag (Verschieben) + Ecken-Drag (Drehen)
  // ================================================================
  function initFrameInteraction(map) {
    // ── Verschieben: Mousedown auf Frame (nicht Ecke) ──
    function onFrameMouseDown(e) {
      if (e.target.classList.contains('print-corner-handle')) return;
      var res = map.getView().getResolution();
      var rot = map.getView().getRotation();
      _frameDrag = {
        type:        'move',
        startPx:     [e.clientX, e.clientY],
        startCenter: _printCenter.slice(),
        res:         res,
        cosR:        Math.cos(rot),
        sinR:        Math.sin(rot)
      };
      document.body.style.cursor = 'grabbing';
      e.preventDefault();
      e.stopPropagation();
    }

    // ── Drehen: Mousedown auf Ecken-Handle ──
    var corners = _frameEl.querySelectorAll('.print-corner-handle');
    corners.forEach(function (corner) {
      corner.addEventListener('mousedown', function (e) {
        // mapRect + centerPx einmalig beim Drag-Start lesen – kein Reflow im mousemove
        var mapRect  = map.getTargetElement().getBoundingClientRect();
        var centerPx = map.getPixelFromCoordinate(_printCenter);
        var dx = e.clientX - mapRect.left - centerPx[0];
        var dy = e.clientY - mapRect.top  - centerPx[1];
        _frameDrag = {
          type:               'rotate',
          startAngle:         Math.atan2(dy, dx),
          startFrameRotation: _frameRotation,
          mapLeft:            mapRect.left,   // gecacht – kein Reflow während Drag
          mapTop:             mapRect.top,
          centerPx:           centerPx        // gecacht – kein getPixelFromCoordinate während Drag
        };
        document.body.style.cursor = 'crosshair';
        e.preventDefault();
        e.stopPropagation();
      });
    });

    // ── Document-Level Move/Up ──
    function onDocMouseMove(e) {
      if (!_frameDrag) return;

      if (_frameDrag.type === 'move') {
        // Auflösung + Rotation wurden beim mousedown gecacht → kein DOM-Zugriff hier
        var dpx = e.clientX - _frameDrag.startPx[0];
        var dpy = e.clientY - _frameDrag.startPx[1];
        var res = _frameDrag.res;
        var cosR = _frameDrag.cosR;
        var sinR = _frameDrag.sinR;
        // Screen-Delta → Map-Delta (korrekt auch bei rotierter Karte)
        _printCenter[0] = _frameDrag.startCenter[0] + (dpx * cosR - dpy * sinR) * res;
        _printCenter[1] = _frameDrag.startCenter[1] + (dpx * sinR + dpy * cosR) * (-res);
        _frameOverlay.setPosition(_printCenter.slice());

      } else if (_frameDrag.type === 'rotate') {
        // mapLeft/mapTop + centerPx wurden beim mousedown gecacht → kein DOM-Zugriff hier
        var dx = e.clientX - _frameDrag.mapLeft - _frameDrag.centerPx[0];
        var dy = e.clientY - _frameDrag.mapTop  - _frameDrag.centerPx[1];
        var currentAngle = Math.atan2(dy, dx);
        var angleDiff    = currentAngle - _frameDrag.startAngle;
        _frameRotation = _frameDrag.startFrameRotation + angleDiff;
        applyFrameRotation();
        refreshSvgPreviewValues();
      }
    }

    function onDocMouseUp() {
      if (!_frameDrag) return;
      _frameDrag = null;
      document.body.style.cursor = '';
    }

    _frameEl.addEventListener('mousedown', onFrameMouseDown);
    document.addEventListener('mousemove', onDocMouseMove);
    document.addEventListener('mouseup',   onDocMouseUp);

    // Referenzen für Cleanup in removePrintFrame()
    _frameDragHandlers = { move: onDocMouseMove, up: onDocMouseUp };
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

    // Cache prüfen — wenn Roh-SVG bereits vorhanden, nur Variablen neu einsetzen
    if (_svgRawCache[layoutVal]) {
      refreshSvgPreviewValues();
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
                TnetLog.log('[Drucken] QGIS-Seitenhintergrund ausgeblendet');
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
      // Roh-SVG cachen (ohne Variablen-Ersetzung) für Live-Aktualisierung
      _svgRawCache[layoutVal] = serialized;
      // Variablen ersetzen und Vorschau anzeigen
      refreshSvgPreviewValues();
      TnetLog.log('[Drucken] SVG-Vorschau geladen für:', layoutVal);
    }).catch(function (err) {
      TnetLog.warn('[Drucken] SVG-Vorschau Fehler:', err.message);
      if (_svgPreviewImg) _svgPreviewImg.style.display = 'none';
    });
  }

  // ================================================================
  //  SVG-Vorschau: Live-Variablen-Ersetzung
  //
  //  Ersetzt {{PLACEHOLDER}} im gecachten Roh-SVG mit aktuellen
  //  Formularwerten. Wird bei Änderungen an Titel, Benutzer,
  //  Massstab etc. automatisch aufgerufen.
  // ================================================================

  /**
   * Sammelt aktuelle Formularwerte für die Vorschau-Ersetzung.
   */
  function getPreviewValues() {
    var scaleVal = parseInt((document.getElementById('print-scale') || {}).value) || 10000;
    var now = new Date();
    return {
      title:       (document.getElementById('print-title') || {}).value || '',
      scaleText:   '1:' + scaleVal.toLocaleString('de-CH'),
      date:        now.toLocaleDateString('de-CH'),
      time:        now.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' }),
      user:        (document.getElementById('print-user') || {}).value || '',
      coords:      _map ? (Math.round(_map.getView().getCenter()[0]).toLocaleString('de-CH') + ' / ' +
                           Math.round(_map.getView().getCenter()[1]).toLocaleString('de-CH')) : '',
      rotationDeg: parseInt((document.getElementById('print-rotation') || {}).value) || 0
    };
  }

  /**
   * Ersetzt {{PLACEHOLDER}} im gecachten Roh-SVG, zeichnet dynamische
   * Grafik-Elemente (Massstabsbalken, Massstabstext, Nordpfeil-Rotation)
   * und aktualisiert das Vorschaubild.
   * Wird bei Formularänderungen und initial nach loadSvgPreview() aufgerufen.
   */
  function refreshSvgPreviewValues() {
    if (!_svgPreviewImg) return;
    var layoutVal = (document.getElementById('print-layout') || {}).value || '';
    var rawSvg = _svgRawCache[layoutVal];
    if (!rawSvg) return;  // Noch nicht geladen

    var values = getPreviewValues();
    var result = rawSvg;

    // Bekannte Platzhalter ersetzen
    var replacements = {
      'TITLE':       values.title,
      'SCALE':       values.scaleText,
      'SCALETEXT':   values.scaleText,
      'SCALEDOT':    values.scaleText,
      'COORDINATES': values.coords,
      'DATE':        values.date,
      'TIME':        values.time,
      'USER':        values.user
    };

    for (var key in replacements) {
      if (!replacements.hasOwnProperty(key)) continue;
      var placeholder = '{{' + key + '}}';
      if (result.indexOf(placeholder) !== -1) {
        result = result.split(placeholder).join(replacements[key]);
      }
    }

    // Unbekannte {{VARIABLE}} entfernen
    result = result.replace(/\{\{[A-Z_]+\}\}/g, '');

    // ── Dynamische Grafik-Elemente in SVG einsetzen ──
    // Massstabsbalken + Massstabstext als SVG erzeugen
    result = insertDynamicSvgElements(result, values);

    var dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(result);
    // Fertigen dataUrl im Bild-Cache aktualisieren (für updateFrameSize)
    _svgPreviewCache[layoutVal] = dataUrl;
    _svgPreviewImg.src = dataUrl;
    _svgPreviewImg.style.display = '';
  }

  /**
   * Berechnet ein "schönes" rundes Segment für den Massstabsbalken.
   * (Gleiche Logik wie niceScaleSegment in template-pdf-export.js)
   */
  function niceScaleSegmentPreview(maxWidthMm, scaleNumber) {
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
   * Sucht rote Bbox-Rects (data-dynamic-type) im SVG,
   * blendet sie aus und fügt dynamische SVG-Elemente ein:
   * - scaleBar: alternierende Schwarz/Weiss-Segmente mit Beschriftung
   * - scaleLabel: Massstabstext (z.B. "1:10'000")
   * Zusätzlich wird der QGIS-Nordpfeil bei Rotation gedreht.
   */
  function insertDynamicSvgElements(svgText, values) {
    var parser = new DOMParser();
    var doc = parser.parseFromString(svgText, 'image/svg+xml');
    var svg = doc.documentElement;
    var NS = 'http://www.w3.org/2000/svg';

    // Massstab aus Text parsen
    var scaleNumber = 0;
    if (values.scaleText) {
      var m = values.scaleText.match(/1\s*:\s*([\d\s''\u2019\u2018\u00A0.,]+)/);
      if (m) scaleNumber = parseInt(m[1].replace(/[^0-9]/g, ''), 10) || 0;
    }

    // Alle <rect> mit data-dynamic-type finden
    var rects = doc.querySelectorAll('rect[data-dynamic-type]');
    for (var i = 0; i < rects.length; i++) {
      var rect = rects[i];
      var dynType = rect.getAttribute('data-dynamic-type') || '';
      var rx = parseFloat(rect.getAttribute('x')) || 0;
      var ry = parseFloat(rect.getAttribute('y')) || 0;
      var rw = parseFloat(rect.getAttribute('width')) || 0;
      var rh = parseFloat(rect.getAttribute('height')) || 0;

      // Rotes Rect ausblenden
      rect.setAttribute('visibility', 'hidden');

      if (dynType === 'scaleBar' && scaleNumber > 0) {
        // ── Massstabsbalken als SVG ──
        // ViewBox → mm Umrechnung für niceScaleSegment
        var vb = svg.getAttribute('viewBox');
        var vbParts = vb ? vb.split(/[\s,]+/).map(Number) : [0, 0, 2480, 3507];
        var layout = _layouts.find(function (l) { return l.value === ((document.getElementById('print-layout') || {}).value || ''); });
        var paperW = (layout && layout.width_mm) || 210;
        var paperH = (layout && layout.height_mm) || 297;
        var sxMm = paperW / vbParts[2];  // mm pro SVG-Unit
        var maxWidthMm = rw * sxMm;

        var segDistM   = niceScaleSegmentPreview(maxWidthMm, scaleNumber);
        var segWidthMm = segDistM * 1000 / scaleNumber;
        var segWidthSvg = segWidthMm / sxMm;  // Zurück in SVG-Units
        var numSegs    = Math.floor(rw / segWidthSvg);
        numSegs = Math.max(2, Math.min(numSegs, 6));

        var barH     = Math.min(rh * 0.45, 2.0 / sxMm);
        var barY     = ry + 0.5 / sxMm;

        var g = doc.createElementNS(NS, 'g');
        g.setAttribute('id', 'preview-scalebar');

        // Alternierende Segmente
        for (var s = 0; s < numSegs; s++) {
          var segX = rx + s * segWidthSvg;
          var segRect = doc.createElementNS(NS, 'rect');
          segRect.setAttribute('x', segX.toFixed(2));
          segRect.setAttribute('y', barY.toFixed(2));
          segRect.setAttribute('width', segWidthSvg.toFixed(2));
          segRect.setAttribute('height', barH.toFixed(2));
          segRect.setAttribute('fill', s % 2 === 0 ? '#000000' : '#ffffff');
          segRect.setAttribute('stroke', '#000000');
          segRect.setAttribute('stroke-width', '1.5');
          g.appendChild(segRect);
        }

        // Äusserer Rahmen
        var outerRect = doc.createElementNS(NS, 'rect');
        outerRect.setAttribute('x', rx.toFixed(2));
        outerRect.setAttribute('y', barY.toFixed(2));
        outerRect.setAttribute('width', (numSegs * segWidthSvg).toFixed(2));
        outerRect.setAttribute('height', barH.toFixed(2));
        outerRect.setAttribute('fill', 'none');
        outerRect.setAttribute('stroke', '#000000');
        outerRect.setAttribute('stroke-width', '2');
        g.appendChild(outerRect);

        // Beschriftungen
        var labelY = barY + barH + 14 / sxMm;
        var fontSize = Math.max(16, Math.min(24, 7 / sxMm));

        for (var l = 0; l <= numSegs; l++) {
          var labelX = rx + l * segWidthSvg;
          var distM  = l * segDistM;
          var label;
          if (segDistM >= 1000) {
            label = (distM / 1000).toLocaleString('de-CH');
            if (l === numSegs) label += ' km';
          } else {
            label = distM.toLocaleString('de-CH');
            if (l === numSegs) label += ' m';
          }
          var anchor = 'middle';
          if (l === 0)        anchor = 'start';
          if (l === numSegs)  anchor = 'end';

          var text = doc.createElementNS(NS, 'text');
          text.setAttribute('x', labelX.toFixed(2));
          text.setAttribute('y', labelY.toFixed(2));
          text.setAttribute('font-family', 'Arial, sans-serif');
          text.setAttribute('font-size', fontSize.toFixed(1));
          text.setAttribute('fill', '#000000');
          text.setAttribute('text-anchor', anchor);
          text.textContent = label;
          g.appendChild(text);
        }

        svg.appendChild(g);

      } else if (dynType === 'scaleLabel' && values.scaleText) {
        // ── Massstabstext als SVG ──
        var scaleFontSize = Math.min(rh * 0.7, 50);
        var scaleText = doc.createElementNS(NS, 'text');
        scaleText.setAttribute('x', (rx + 5).toFixed(2));
        scaleText.setAttribute('y', (ry + rh * 0.7).toFixed(2));
        scaleText.setAttribute('font-family', 'Arial, sans-serif');
        scaleText.setAttribute('font-size', scaleFontSize.toFixed(1));
        scaleText.setAttribute('font-weight', 'bold');
        scaleText.setAttribute('fill', '#000000');
        scaleText.textContent = values.scaleText;
        svg.appendChild(scaleText);
      }
    }

    // ── Nordpfeil rotieren (falls Rotation vorhanden) ──
    if (values.rotationDeg) {
      // Nordpfeil-Path identifizieren (einheitlich in allen QGIS-Templates)
      var allPaths = doc.querySelectorAll('path');
      for (var p = 0; p < allPaths.length; p++) {
        var pathD = allPaths[p].getAttribute('d') || '';
        if (pathD.indexOf('M8.003,-9.593') === 0) {
          var arrowGroup = allPaths[p].parentNode;

          // Transform-Matrix parsen: matrix(sx,0,0,sy,tx,ty)
          var tfm = arrowGroup.getAttribute('transform') || '';
          var mMatch = tfm.match(/matrix\(([^)]+)\)/);
          if (mMatch) {
            var mParts = mMatch[1].split(',').map(Number);
            var arrowSx = mParts[0], arrowSy = mParts[3];
            var arrowTx = mParts[4], arrowTy = mParts[5];

            // Zentrum des Nordpfeils in SVG-Viewport-Koordinaten
            // Path-Bbox lokal: x=[0..16.06], y=[-37.31..0]
            var localCX = 8.03;
            var localCY = -18.66;
            var arrowCx = arrowSx * localCX + arrowTx;
            var arrowCy = arrowSy * localCY + arrowTy;

            // Rotation-Wrapper: Karte CW → Nordpfeil CCW
            var wrapper = doc.createElementNS(NS, 'g');
            wrapper.setAttribute('id', 'preview-northarrow-rotate');
            wrapper.setAttribute('transform',
              'rotate(' + (-values.rotationDeg) + ', ' +
              arrowCx.toFixed(2) + ', ' + arrowCy.toFixed(2) + ')');
            arrowGroup.parentNode.insertBefore(wrapper, arrowGroup);
            wrapper.appendChild(arrowGroup);
          }
          break;
        }
      }
    }

    return new XMLSerializer().serializeToString(doc);
  }

  // ================================================================
  //  Rotation
  // ================================================================

  /** CSS-Transform auf Rahmen anwenden und UI synchronisieren. */
  function applyFrameRotation() {
    if (_frameEl) {
      _frameEl.style.transform = 'rotate(' + (_frameRotation * 180 / Math.PI).toFixed(2) + 'deg)';
    }
    syncRotationUI();
  }

  function syncRotationUI() {
    var deg;
    if (_isMobile) {
      // Mobile: Rotation aus der Karten-View lesen
      var m = getMap();
      deg = m ? Math.round(m.getView().getRotation() * 180 / Math.PI) : 0;
    } else {
      deg = Math.round(_frameRotation * 180 / Math.PI);
    }
    var el = document.getElementById('print-rotation');
    if (el) el.value = deg;
    var lbl = document.getElementById('print-rotation-val');
    if (lbl) lbl.textContent = deg + '\u00b0';
  }

  window.printRotateBy = function (deg) {
    _frameRotation += deg * Math.PI / 180;
    applyFrameRotation();
    refreshSvgPreviewValues();
  };

  window.printResetRotation = function () {
    _frameRotation = 0;
    applyFrameRotation();
    refreshSvgPreviewValues();
  };

  // ================================================================
  //  Massstab-Preset
  // ================================================================
  window.setScale = function (val) {
    var el = document.getElementById('print-scale');
    if (el) el.value = val;
  };

  // ================================================================
  //  Karten-Interaktionen deaktivieren (während Druck-Panel aktiv)
  // ================================================================

  function disableMapInteractions() {
    _savedInteractions = [];
    _savedPickingStates = {};
    var map = getMap();
    if (map) {
      // Mobile: Pan-Interaktionen bleiben aktiv (Benutzer schiebt Karte unter Rahmen)
      if (!_isMobile) {
        map.getInteractions().getArray().slice().forEach(function (interaction) {
          var cname = (interaction.constructor && interaction.constructor.name) || '';
          if ((cname === 'DragPan' || cname === 'KeyboardPan') && interaction.getActive()) {
            _savedInteractions.push(interaction);
            interaction.setActive(false);
          }
        });
      }
    }
    // Maptip-Picking deaktivieren + Info-Bridge Gate setzen
    try {
      var am = window.njs && njs.AppManager;
      var maps = am && am.Maps;
      if (maps) {
        for (var id in maps) {
          if (maps[id] && maps[id].picking !== undefined) {
            _savedPickingStates[id] = maps[id].picking;
            maps[id].picking = false;
          }
        }
      }
      // Info-Bridge Gate: blockiert singleclick-Objektabfragen
      if (am && am.MapTips) {
        if (!am.MapTips['_disablewmsgetfeatureinfo']) {
          am.MapTips['_disablewmsgetfeatureinfo'] = {};
        }
        am.MapTips['_disablewmsgetfeatureinfo']['main'] = true;
      }
    } catch (e) { /* noop */ }
  }

  function restoreMapInteractions() {
    _savedInteractions.forEach(function (i) { i.setActive(true); });
    _savedInteractions = [];
    // Picking wiederherstellen + Info-Bridge Gate zurücksetzen
    try {
      var am = window.njs && njs.AppManager;
      var maps = am && am.Maps;
      if (maps) {
        for (var id in maps) {
          if (maps[id] && _savedPickingStates[id] !== undefined) {
            maps[id].picking = _savedPickingStates[id];
          }
        }
      }
      // Info-Bridge Gate zurücksetzen
      if (am && am.MapTips && am.MapTips['_disablewmsgetfeatureinfo']) {
        am.MapTips['_disablewmsgetfeatureinfo']['main'] = false;
      }
    } catch (e) { /* noop */ }
    _savedPickingStates = {};
  }

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
      TnetLog.log('[Drucken] Frame-Grösse OK:', Math.round(currentRatio) + '% des Viewports');
      return; // Passt schon
    }

    // Faktor berechnen: um wie viel muss Resolution geändert werden?
    var scaleFactor = currentRatio / targetPercent;
    var view = map.getView();
    var currentRes = view.getResolution();
    var newRes = currentRes * scaleFactor;

    // Resolution setzen
    view.animate({ resolution: newRes, duration: 300 });
    TnetLog.log('[Drucken] Zoom angepasst:', Math.round(currentRatio) + '% → ' + 
      targetPercent + '% (Resolution:', currentRes.toFixed(2), '→', newRes.toFixed(2) + ')');

    // Nach Animation Frame-Grösse aktualisieren
    setTimeout(updateFrameSize, 350);
  }

  /**
   * Mobile: Setzt den Kartenzoom so, dass der Druckrahmen vollständig
   * im sichtbaren Bereich über dem Bottom-Sheet passt. Blendet den
   * Rahmen nach der Zoom-Animation ein.
   *
   * Basis: tatsächliche Frame-Pixelgrösse (nach updateFrameSize), da
   * _layouts async geladen wird und bei Erstaufruf noch leer sein kann.
   * Retry bis Frame-Grösse verfügbar (max. 8 Versuche à 200ms).
   */
  function adjustMapZoomMobile(printScale) {
    var map = getMap();
    if (!map) return;
    var mpu = map.getView().getProjection().getMetersPerUnit() || 1;
    var sortedAsc = _scales.slice().sort(function (a, b) { return a - b; });

    // Verfügbarer Kartenbereich über dem Bottom-Sheet:
    // Bottom-Sheet ~50vh + Toolbar ~10vh = ~60vh belegt → verbleibende Map-Fläche ~32%
    var availH = window.innerHeight * 0.25;
    var availW = window.innerWidth  * 0.80;
    var targetFill = 0.40;  // Frame soll max. 40% des verfügbaren Bereichs füllen

    var attempt = 0;
    function tryAdjust() {
      // Sicherstellen dass updateFrameSize() mit aktuellem Layout + Scale läuft
      updateFrameSize();
      var frameW = _frameEl ? parseFloat(_frameEl.style.width)  : 0;
      var frameH = _frameEl ? parseFloat(_frameEl.style.height) : 0;

      // Noch kein Layout geladen → nochmal warten
      if ((frameW <= 0 || frameH <= 0) && attempt++ < 8) {
        setTimeout(tryAdjust, 200);
        return;
      }

      if (frameW <= 0 || frameH <= 0) {
        // Fallback: einfach eine Stufe herauszoomen
        if (_frameEl) _frameEl.style.opacity = '1';
        return;
      }

      // Aktuelles Verhältnis Frame / verfügbarer Bereich
      var ratioW = frameW / availW;
      var ratioH = frameH / availH;
      var currentRatio = Math.max(ratioW, ratioH);

      if (currentRatio <= targetFill) {
        // Passt bereits — nur einblenden
        if (_frameEl) _frameEl.style.opacity = '1';
        TnetLog.log('[Drucken Mobile] Frame passt (' + Math.round(currentRatio * 100) + '% ≤ ' + Math.round(targetFill * 100) + '%)');
        return;
      }

      // Skalierungsfaktor: um wieviel muss herausgezoomt werden?
      var scaleFactor = currentRatio / targetFill;
      var view = map.getView();
      var neededRes = view.getResolution() * scaleFactor;

      // Nächsten Massstab aus _scales wählen: grösser als printScale UND gross genug
      var mapScale = null;
      for (var i = 0; i < sortedAsc.length; i++) {
        if (sortedAsc[i] > printScale && (sortedAsc[i] * 0.00028 / mpu) >= neededRes) {
          mapScale = sortedAsc[i]; break;
        }
      }
      if (mapScale === null) mapScale = sortedAsc[sortedAsc.length - 1];

      var finalRes = mapScale * 0.00028 / mpu;
      view.animate({ resolution: finalRes, duration: 300 });

      map.once('moveend', function () {
        updateFrameSize();
        if (_frameEl) _frameEl.style.opacity = '1';
      });

      TnetLog.log('[Drucken Mobile] Zoom: 1:' + mapScale + ' (Frame ' + Math.round(currentRatio * 100) + '% → Ziel ' + Math.round(targetFill * 100) + '%)');
    }

    // Kurz warten damit DOM-Render und updateFrameSize() stabil sind
    setTimeout(tryAdjust, 100);
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
      _frameRotation = 0;  // Rotation bei jedem Öffnen zurücksetzen
      loadLayouts();
      // Aktuellen Massstab im Dropdown auf nächsten Wert setzen
      var map = getMap();
      if (map) {
        var mpu = map.getView().getProjection().getMetersPerUnit() || 1;
        var currentScale = Math.round(map.getView().getResolution() * mpu / 0.00028);
        // Nächst grösserer Massstab = nächst kleinere Zahl (mehr Detail).
        // Suche den grössten _scales-Wert der < currentScale ist.
        // Falls keiner existiert (Karte bereits am detailliertesten), kleinsten nehmen.
        var sortedAsc = _scales.slice().sort(function (a, b) { return a - b; });
        var nextLarger = null;
        for (var si = sortedAsc.length - 1; si >= 0; si--) {
          if (sortedAsc[si] < currentScale) { nextLarger = sortedAsc[si]; break; }
        }
        if (nextLarger === null) nextLarger = sortedAsc[0];
        document.getElementById('print-scale').value = nextLarger;
      }
      syncRotationUI();
      document.getElementById('print-panel').classList.remove('hidden');
      // Panel andocken (Default) oder floating
      if (_isPrintPanelDocked) {
        dockPrintPanel();
      }
      // Druckrahmen-Center initialisieren: immer aktuelle Kartenmitte beim Öffnen
      _printCenter = map.getView().getCenter().slice();
      disableMapInteractions();
      showPrintFrame();
      // Benutzer-Feld vorausfüllen (aus Login)
      var userInput = document.getElementById('print-user');
      if (userInput && !userInput.value) {
        if (window.njs && njs.AppManager && njs.AppManager.auth_user) {
          userInput.value = njs.AppManager.auth_user;
        }
      }
      // Kartenausschnitt anpassen: Frame sollte ca. 60-80% des Viewports füllen
      // Auf Mobile übernimmt der Bottom-Sheet-Patch die Zoom-Steuerung
      // Verzögerung notwendig: dockPrintPanel() ändert mapContainer-Breite,
      // map.updateSize() wird erst nach 350ms aufgerufen → Frame-Berechnung
      // und Viewport-Dimensionen stimmen erst danach.
      if (!_isMobile) {
        setTimeout(function () { adjustZoomForPrintFrame(); }, 450);
      } else {
        // Mobile: Kartenmassstab eine Stufe kleiner setzen damit Rahmen sichtbar bleibt
        var printScaleVal = parseInt(document.getElementById('print-scale').value) || 10000;
        setTimeout(function () { adjustMapZoomMobile(printScaleVal); }, 450);
      }
    };

    if (_libsReady) {
      doOpen();
    } else {
      loadLibraries().then(doOpen).catch(function (err) {
        TnetLog.error('[Drucken] Libraries konnten nicht geladen werden:', err);
        alert('PDF-Export konnte nicht initialisiert werden.\n' + err.message);
      });
    }
  };

  window.closePrintPanel = function () {
    var panel = document.getElementById('print-panel');
    if (panel) panel.classList.add('hidden');
    removePrintFrame();
    restoreMapInteractions();
    // Falls angedockt: mapContainer zurücksetzen (nur Desktop — Mobile hat kein Width-Override)
    if (_isPrintPanelDocked) {
      if (!_isMobile) {
        var mapContainer = document.getElementById('mapContainer');
        if (mapContainer) {
          mapContainer.style.setProperty('width', '100%', 'important');
        }
      }
      triggerPrintMapUpdate();
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
    var benutzer        = document.getElementById('print-user').value || '';
    var gridEl          = document.getElementById('print-grid');
    var koordinatennetz = gridEl ? gridEl.checked : false;
    var netzfarbeEl    = document.querySelector('input[name="print-gridcolor"]:checked');
    var netzfarbe      = netzfarbeEl ? netzfarbeEl.value : 'schwarz';
    // Mobile: Rotation aus der Karten-View; Desktop: aus _frameRotation (CSS-Frame-Rotation)
    var rotation = _isMobile
      ? Math.round(map.getView().getRotation() * 180 / Math.PI)
      : Math.round(_frameRotation * 180 / Math.PI);
    var serverRenderEl  = document.getElementById('print-server-render');
    var serverRender    = serverRenderEl ? serverRenderEl.checked : false;
    var svgFormatEl     = document.getElementById('print-svg-format');
    var svgFormat       = svgFormatEl ? svgFormatEl.checked : false;

    // ─ Dateiname vorab generieren (gleiche Logik wie template-pdf-export.js) ─
    var layoutObj = _layouts.find(function (l) { return l.value === layout; });
    var now = new Date();
    var ts = now.getFullYear() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0') + '_' +
      String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0');
    var safeTitle = (kartentitel || 'Kartenexport')
      .replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, '_').substring(0, 50);
    var paperInfo = (layoutObj && layoutObj.paper) || '';
    if (layoutObj && layoutObj.orientation === 'landscape') paperInfo += '_quer';
    else if (layoutObj && layoutObj.orientation === 'portrait') paperInfo += '_hoch';
    var preFilename = safeTitle + '_' + paperInfo + '_' + ts + '.pdf';

    // ─ Neuer Job ─
    var jobId = ++_jobIdCounter;
    var printCenter = _printCenter ? _printCenter.slice() : map.getView().getCenter().slice();
    var job = {
      id: jobId,
      status: 'pending',  // pending, processing, completed, failed
      title: preFilename,
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
        benutzer: benutzer,
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
    TnetLog.log('[Print-Queue] Job #' + jobId + ' hinzugefügt. Queue-Länge:', _printQueue.length);
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

    TnetLog.log('[Print-Queue] Starte Job #' + job.id + ': ' + job.title);

    templatePdfPrint({
      massstab:        job.params.massstab,
      layout:          job.params.layout,
      aufloesung:      job.params.aufloesung,
      rotation:        job.params.rotation,
      kartentitel:     job.params.kartentitel,
      benutzer:        job.params.benutzer,
      koordinatennetz: job.params.koordinatennetz,
      netzfarbe:       job.params.netzfarbe,
      printCenter:     job.params.printCenter,
      serverRender:    job.params.serverRender,
      svgFormat:       job.params.svgFormat,
      jpegQuality:     job.params.jpegQuality,
      serverDpi:       job.params.serverDpi,

      onProgress: function (step, msg) {
        job.progress = Math.round((step / 7) * 100);
        // Nur Fortschrittsbalken direkt aktualisieren (kein volles renderJobs!)
        var pjFill = document.querySelector('.pj-processing .pj-progress-fill');
        var pjText = document.querySelector('.pj-processing .pj-progress-text');
        if (pjFill) pjFill.style.width = job.progress + '%';
        if (pjText) pjText.textContent = job.progress + '%';
        // Globaler Fortschrittsbalken
        if (job.id === _currentJobId) {
          document.getElementById('print-progress-fill').style.width = job.progress + '%';
          document.getElementById('print-progress-text').textContent = msg;
        }
      },

      onSuccess: function (result) {
        job.blob = result.blob;
        job.filename = result.filename;
        job.title = result.filename;  // Titel = tatsächlicher Dateiname
        job.status = 'completed';
        job.progress = 100;
        
        handlePdfResult(job.blob, job.filename);
        TnetLog.log('[Print-Queue] Job #' + job.id + ' abgeschlossen: ' + job.filename);
        
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
        TnetLog.error('[Print-Queue] Job #' + job.id + ' Fehler:', err);
        
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
      TnetIcons.get('printer', null, {width: '18', height: '18'}) + ' PDF erstellen';

    setTimeout(function () {
      document.getElementById('print-progress').style.display = 'none';
      document.getElementById('print-progress-fill').style.width = '0%';
    }, 2000);
  }

  function renderJobs() {
    var jobsList = document.getElementById('print-jobs-list');
    var jobsAcc = document.getElementById('print-jobs-acc');
    var jobsCount = document.getElementById('print-jobs-count');

    if (!jobsList) return;

    jobsCount.textContent = _printQueue.length;

    // Zeige Accordion wenn Jobs vorhanden
    if (_printQueue.length > 0) {
      jobsAcc.style.display = 'block';
      jobsAcc.classList.add('is-open');
    } else {
      jobsAcc.style.display = 'none';
      closePrintPreview();
      return;
    }

    var html = '';
    // Neueste Jobs zuerst
    var sorted = _printQueue.slice().reverse();
    sorted.forEach(function (job) {
      var statusClass = 'pj-' + job.status;
      var statusLabel = {
        pending: '\u23f3 In Warteschlange',
        processing: '\u2699 Wird verarbeitet',
        completed: '\u2713 Fertig',
        failed: '\u2715 Fehler'
      }[job.status] || job.status;

      html +=
        '<div class="print-job ' + statusClass + '">' +
          '<div class="pj-header">' +
            '<span class="pj-title">' + job.title + '</span>' +
            '<span class="pj-status">' + statusLabel + '</span>' +
          '</div>';

      if (job.status === 'processing') {
        html +=
          '<div class="pj-progress">' +
            '<div class="pj-progress-bar"><div class="pj-progress-fill" style="width:' + job.progress + '%"></div></div>' +
            '<span class="pj-progress-text">' + job.progress + '%</span>' +
          '</div>';
      }

      if (job.status === 'completed' && job.blobUrl) {
        var time = '';
        if (job.completedDate) {
          time = String(job.completedDate.getHours()).padStart(2, '0') + ':' +
                 String(job.completedDate.getMinutes()).padStart(2, '0');
        }
        var sizeStr = formatFileSize(job.size);
        var meta = [];
        if (time) meta.push(time);
        if (sizeStr) meta.push(sizeStr);
        html +=
          '<div class="pj-meta">' + meta.join(' \u00b7 ') + '</div>' +
          '<div class="pj-actions">' +
            '<a class="pj-btn pj-btn-dl" href="' + job.blobUrl + '" download="' + job.filename + '" title="Herunterladen">\u2B07 Download</a>';
        if (!_isMobile) {
          html += '<button class="pj-btn pj-btn-preview" onclick="previewJob(' + job.id + ')" title="Vorschau">\uD83D\uDD0D</button>';
        }
        html +=
            '<button class="pj-btn pj-btn-remove" onclick="removeJob(' + job.id + ')" title="Entfernen">&times;</button>' +
          '</div>';
      }

      if (job.status === 'failed') {
        html +=
          '<div class="pj-error">' + job.error + '</div>';
      }

      html += '</div>';
    });

    jobsList.innerHTML = html;
  }

  // Alias für bestehende updateQueueUI()-Aufrufe
  var updateQueueUI = renderJobs;

  window.removeJob = function (jobId) {
    var idx = _printQueue.findIndex(function (j) { return j.id === jobId; });
    if (idx < 0) return;
    var job = _printQueue[idx];
    if (job.blobUrl) URL.revokeObjectURL(job.blobUrl);
    _printQueue.splice(idx, 1);
    renderJobs();
  };

  window.previewJob = function (jobId) {
    var job = _printQueue.find(function (j) { return j.id === jobId; });
    if (!job || !job.blobUrl) return;
    showPdfPreview(job.blobUrl);
  };

  window.downloadJobPdf = function (jobId) {
    var job = _printQueue.find(function (j) { return j.id === jobId; });
    if (!job || !job.blobUrl) return;
    var link = document.createElement('a');
    link.href = job.blobUrl;
    link.download = job.filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // ================================================================
  //  PDF im Memory behalten + parallel auf Server loggen
  // ================================================================
  function handlePdfResult(blob, filename) {
    // Blob-URL erstellen und am Job speichern
    var blobUrl = URL.createObjectURL(blob);
    var job = _printQueue.find(function (j) { return j.id === _currentJobId; });
    if (job) {
      job.blobUrl = blobUrl;
      job.size = blob.size;
      job.completedDate = new Date();
    }

    // Jobs-Liste aktualisieren
    renderJobs();

    // Vorschau nur auf Desktop anzeigen
    if (!_isMobile) {
      showPdfPreview(blobUrl);
    } else {
      // Mobile: Auto-Download triggern
      var link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }

    TnetLog.log('[Drucken] PDF fertig:', filename, '(' + blob.size + ' Bytes)');

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
          TnetLog.log('[Drucken] PDF archiviert:', data.path);
        } else {
          TnetLog.warn('[Drucken] PDF-Archivierung fehlgeschlagen:', data.error);
        }
      })
      .catch(function(err) {
        TnetLog.warn('[Drucken] PDF-Archivierung Fehler:', err.message);
      });
  }

  // ================================================================
  //  PDF-Vorschau (iframe, nur Desktop)
  // ================================================================
  function showPdfPreview(url) {
    if (_isMobile) return;  // Kein iframe-Preview auf Mobile
    var iframe = document.getElementById('print-preview-frame');
    if (!iframe) return;
    iframe.src = url;
    iframe.style.display = '';
    // Zum Vorschau-Bereich scrollen
    iframe.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function closePrintPreview() {
    var iframe = document.getElementById('print-preview-frame');
    if (iframe) {
      iframe.src = 'about:blank';
      iframe.style.display = 'none';
    }
  }
  window.closePrintPreview = closePrintPreview;

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

  // addDownload, renderDownloads, removePrintDownload entfernt
  // → ersetzt durch renderJobs() und window.removeJob()

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
      // Nach updateSize den Druckrahmen neu berechnen,
      // damit die initiale Skalierung stimmt (nicht erst nach Pan)
      updateFrameSize();
    }, 350);
  }

  function dockPrintPanel() {
    var panel = document.getElementById('print-panel');
    var dockBtn = document.getElementById('print-dock-btn');
    var mapContainer = document.getElementById('mapContainer');
    if (!panel) return;

    panel.classList.add('docked-right');
    _isPrintPanelDocked = true;

    // Desktop: Panel rechts andocken, mapContainer verschmälern.
    // Mobile: Panel ist Bottom-Sheet (CSS steuert Layout) — keine Breitenanpassung!
    if (!_isMobile && mapContainer) {
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
    }
    triggerPrintMapUpdate();

    startPrintObservers();

    if (dockBtn) {
      dockBtn.title = 'Floating';
      dockBtn.innerHTML = TnetIcons.get('undock', null, {width: '16', height: '16'});
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
      dockBtn.innerHTML = TnetIcons.get('dock', null, {width: '16', height: '16'});
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

    // Massstab-Wechsel → Rahmen anpassen + Mobile: Kartenzoom nachführen
    var scaleSel = document.getElementById('print-scale');
    if (scaleSel) scaleSel.addEventListener('change', function () {
      updateFrameSize();
      refreshSvgPreviewValues();
      if (_isMobile) {
        var ps = parseInt(scaleSel.value) || 10000;
        adjustMapZoomMobile(ps);
      }
    });
    var titleInput = document.getElementById('print-title');
    if (titleInput) titleInput.addEventListener('input', refreshSvgPreviewValues);
    var userInputEl = document.getElementById('print-user');
    if (userInputEl) userInputEl.addEventListener('input', refreshSvgPreviewValues);

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
      _frameRotation = deg * Math.PI / 180;
      applyFrameRotation();
      refreshSvgPreviewValues();
    });

    TnetLog.log('[Drucken] tnet-print.js initialisiert');

    // Resize-Handle für Dock-Modus
    initPrintPanelResize();

    // Libraries im Hintergrund vorladen (kein Blockieren)
    loadLibraries().catch(function (err) {
      TnetLog.warn('[Drucken] Vorladen der PDF-Libraries fehlgeschlagen:', err);
    });
  }

  // Auto-Init bei DOMContentLoaded oder sofort falls DOM schon bereit
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
