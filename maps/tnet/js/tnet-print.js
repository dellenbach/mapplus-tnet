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
 */
(function () {
  'use strict';

  // ================================================================
  //  State
  // ================================================================
  var _map = null;
  var _frameOverlay = null;
  var _frameEl = null;
  var _isPrinting = false;
  var _downloads = [];
  var PDF_SAVE_URL = '/maps/tnet/php/pdf-save.php';
  var _layouts = [];

  // Papierformat-Grössen (mm, Landscape-first)
  var PAPER_SIZES = {
    'A0': [1189, 841], 'A1': [841, 594], 'A2': [594, 420],
    'A3': [420, 297],  'A4': [297, 210], 'A5': [210, 148]
  };

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
      templatesBasePath: '/maps/tnet/ol-pdf-printer/templates/svg'
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
  //  Panel-HTML erzeugen
  // ================================================================
  function createPanelHTML() {
    return '' +
      '<div id="print-panel" class="print-panel hidden">' +
        '<div class="print-panel-header">' +
          '<span class="print-panel-title">\uD83D\uDDA8 Drucken / Export</span>' +
          '<button class="print-panel-close" onclick="closePrintPanel()">&times;</button>' +
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
            '<div class="print-scale-row">' +
              '<span class="print-scale-prefix">1 :</span>' +
              '<input type="number" id="print-scale" value="10000" min="100" max="500000" step="500">' +
              '<div class="print-scale-presets">' +
                '<button class="print-preset-btn" onclick="setScale(500)">500</button>' +
                '<button class="print-preset-btn" onclick="setScale(1000)">1k</button>' +
                '<button class="print-preset-btn" onclick="setScale(2500)">2.5k</button>' +
                '<button class="print-preset-btn" onclick="setScale(5000)">5k</button>' +
                '<button class="print-preset-btn" onclick="setScale(10000)">10k</button>' +
                '<button class="print-preset-btn" onclick="setScale(25000)">25k</button>' +
                '<button class="print-preset-btn" onclick="setScale(50000)">50k</button>' +
              '</div>' +
            '</div>' +
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
            '<input type="text" id="print-title" placeholder="Situation" value="">' +
          '</div>' +

          // Koordinatennetz
          '<div class="print-section print-checks">' +
            '<label><input type="checkbox" id="print-grid"> Koordinatennetz</label>' +
            '<div id="print-grid-color" class="print-grid-colors" style="display:none">' +
              '<label class="print-radio"><input type="radio" name="print-gridcolor" value="schwarz" checked> Schwarz</label>' +
              '<label class="print-radio"><input type="radio" name="print-gridcolor" value="weiss"> Weiss</label>' +
            '</div>' +
          '</div>' +

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

          // PDF-Vorschau (iframe)
          '<div class="print-section print-preview" id="print-preview" style="display:none">' +
            '<div class="print-preview-header">' +
              '<label class="print-preview-title">Vorschau</label>' +
              '<button class="print-preview-close" onclick="closePrintPreview()">&times;</button>' +
            '</div>' +
            '<iframe id="print-preview-frame" class="print-preview-frame"></iframe>' +
          '</div>' +

          // Downloads
          '<div class="print-section print-downloads" id="print-downloads" style="display:none">' +
            '<label class="print-downloads-title">\uD83D\uDCE5 Erzeugte PDFs</label>' +
            '<div id="print-download-list"></div>' +
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
      layouts.forEach(function (l, idx) {
        var opt = document.createElement('option');
        opt.value = l.value;
        opt.textContent = l.label;
        if (idx === 0) opt.selected = true;
        select.appendChild(opt);
      });
      updateFrameSize();
      console.log('[Drucken] ' + layouts.length + ' Layouts geladen');
    });
  }

  // ================================================================
  //  Druckrahmen (OL Overlay)
  // ================================================================
  function showPrintFrame() {
    var map = getMap();
    if (!map) return;
    removePrintFrame();

    _frameEl = document.createElement('div');
    _frameEl.className = 'print-frame-rect';
    updateFrameSize();

    ['tl', 'tr', 'bl', 'br', 'tm', 'bm', 'ml', 'mr'].forEach(function (pos) {
      var h = document.createElement('div');
      h.className = 'print-frame-handle ' + pos;
      _frameEl.appendChild(h);
    });

    _frameOverlay = new ol.Overlay({
      element: _frameEl,
      positioning: 'center-center',
      position: map.getView().getCenter(),
      stopEvent: false,
      className: 'print-frame-overlay-container'
    });
    map.addOverlay(_frameOverlay);

    map.getView().on('change:center', _updateFramePosition);
    map.getView().on('change:resolution', _onViewChange);
    map.getView().on('change:rotation', _onViewChange);
  }

  function _updateFramePosition() {
    if (_frameOverlay && _map) _frameOverlay.setPosition(_map.getView().getCenter());
  }

  function _onViewChange() {
    updateFrameSize();
    _updateFramePosition();
  }

  function updateFrameSize() {
    if (!_frameEl || !_map) return;
    var layoutVal = (document.getElementById('print-layout') || {}).value || '';
    var layout = _layouts.find(function (l) { return l.value === layoutVal; });
    var dim;
    if (layout) {
      var paper = PAPER_SIZES[layout.paper] || PAPER_SIZES['A4'];
      dim = (layout.orientation === 'landscape') ? [paper[0], paper[1]] : [paper[1], paper[0]];
    } else {
      dim = [297, 210];
    }

    var viewportW = _map.getSize()[0];
    var viewportH = _map.getSize()[1];
    var aspect = dim[0] / dim[1];
    var maxW = viewportW * 0.65;
    var maxH = viewportH * 0.65;
    var w, h;
    if (maxW / maxH > aspect) { h = maxH; w = h * aspect; }
    else { w = maxW; h = w / aspect; }

    _frameEl.style.width = Math.round(w) + 'px';
    _frameEl.style.height = Math.round(h) + 'px';
    _frameEl.style.marginLeft = -Math.round(w / 2) + 'px';
    _frameEl.style.marginTop = -Math.round(h / 2) + 'px';
  }

  function removePrintFrame() {
    if (_frameOverlay && _map) {
      _map.removeOverlay(_frameOverlay);
      _map.getView().un('change:center', _updateFramePosition);
      _map.getView().un('change:resolution', _onViewChange);
      _map.getView().un('change:rotation', _onViewChange);
    }
    _frameOverlay = null;
    _frameEl = null;
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
      // Aktuellen Massstab übernehmen
      var map = getMap();
      if (map) {
        var mpu = map.getView().getProjection().getMetersPerUnit() || 1;
        var currentScale = Math.round(map.getView().getResolution() * mpu / 0.00028);
        document.getElementById('print-scale').value = currentScale;
      }
      syncRotationUI();
      document.getElementById('print-panel').classList.remove('hidden');
      showPrintFrame();
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
    document.getElementById('print-panel').classList.add('hidden');
    removePrintFrame();
    var map = getMap();
    if (map) map.getView().setRotation(0);
  };

  // ================================================================
  //  PDF erstellen
  // ================================================================
  window.executePrint = function () {
    if (_isPrinting) return;
    var map = getMap();
    if (!map) { alert('Karte nicht bereit.'); return; }
    if (typeof templatePdfPrint !== 'function') { alert('PDF-Export-API nicht geladen.'); return; }

    var layout         = document.getElementById('print-layout').value;
    var massstab       = parseInt(document.getElementById('print-scale').value) || 10000;
    var dpiEl          = document.querySelector('input[name="print-dpi"]:checked');
    var aufloesung     = dpiEl ? parseInt(dpiEl.value) : 150;
    var kartentitel    = document.getElementById('print-title').value || '';
    var koordinatennetz = document.getElementById('print-grid').checked;
    var netzfarbeEl    = document.querySelector('input[name="print-gridcolor"]:checked');
    var netzfarbe      = netzfarbeEl ? netzfarbeEl.value : 'schwarz';
    var rotation       = parseInt(document.getElementById('print-rotation').value) || 0;

    _isPrinting = true;
    var btn = document.getElementById('print-exec-btn');
    btn.disabled = true;
    btn.classList.add('printing');
    btn.innerHTML = '\u23f3 Wird erstellt...';
    document.getElementById('print-progress').style.display = 'block';

    if (_frameEl) _frameEl.style.display = 'none';

    templatePdfPrint({
      massstab:        massstab,
      layout:          layout,
      aufloesung:      aufloesung,
      rotation:        rotation,
      kartentitel:     kartentitel,
      koordinatennetz: koordinatennetz,
      netzfarbe:       netzfarbe,

      onProgress: function (step, msg) {
        var pct = Math.round((step / 7) * 100);
        document.getElementById('print-progress-fill').style.width = pct + '%';
        document.getElementById('print-progress-text').textContent = msg;
      },

      onSuccess: function (result) {
        finishPrint(true);
        if (!result || !result.blob) {
          console.warn('[Drucken] Kein PDF-Blob erhalten');
          return;
        }
        // PDF an Server senden
        uploadPdfToServer(result.blob, result.filename);
      },

      onError: function (err) {
        finishPrint(false);
        alert('Fehler beim PDF-Export:\n' + err.message);
      }
    });
  };

  function finishPrint(success) {
    _isPrinting = false;
    var btn = document.getElementById('print-exec-btn');
    btn.disabled = false;
    btn.classList.remove('printing');
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z" fill="currentColor"/></svg> PDF erstellen';

    setTimeout(function () {
      document.getElementById('print-progress').style.display = 'none';
      document.getElementById('print-progress-fill').style.width = '0%';
    }, success ? 2000 : 500);

    if (_frameEl) _frameEl.style.display = '';
    if (!document.getElementById('print-panel').classList.contains('hidden')) {
      if (!_frameOverlay) showPrintFrame();
    }
  }

  // ================================================================
  //  PDF an Server senden
  // ================================================================
  function uploadPdfToServer(blob, filename) {
    var formData = new FormData();
    formData.append('pdf', blob, filename);
    formData.append('filename', filename);

    // Fortschritt: "Wird hochgeladen..."
    var progText = document.getElementById('print-progress-text');
    if (progText) progText.textContent = 'Wird hochgeladen...';
    document.getElementById('print-progress').style.display = 'block';
    document.getElementById('print-progress-fill').style.width = '90%';

    fetch(PDF_SAVE_URL, { method: 'POST', body: formData })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        document.getElementById('print-progress').style.display = 'none';
        document.getElementById('print-progress-fill').style.width = '0%';

        if (!data.ok) {
          alert('Fehler beim Speichern: ' + (data.error || 'Unbekannt'));
          return;
        }

        // In Download-Liste aufnehmen
        addDownload(filename, data.url, data.size);

        // Vorschau sofort anzeigen
        showPdfPreview(data.url);

        console.log('[Drucken] PDF auf Server gespeichert:', data.url);
      })
      .catch(function (err) {
        document.getElementById('print-progress').style.display = 'none';
        console.error('[Drucken] Upload fehlgeschlagen:', err);
        // Fallback: lokaler Blob-Download
        var blobUrl = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = blobUrl; a.download = filename; a.click();
        addDownload(filename, blobUrl, blob.size);
      });
  }

  // ================================================================
  //  PDF-Vorschau (iframe)
  // ================================================================
  function showPdfPreview(url) {
    var previewDiv = document.getElementById('print-preview');
    var iframe = document.getElementById('print-preview-frame');
    if (!previewDiv || !iframe) return;
    iframe.src = url;
    previewDiv.style.display = 'block';
    // Zum Vorschau-Bereich scrollen
    previewDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  window.closePrintPreview = function () {
    var previewDiv = document.getElementById('print-preview');
    var iframe = document.getElementById('print-preview-frame');
    if (previewDiv) previewDiv.style.display = 'none';
    if (iframe) iframe.src = 'about:blank';
  };

  window.previewPrintDownload = function (idx) {
    if (_downloads[idx] && _downloads[idx].url) {
      showPdfPreview(_downloads[idx].url);
    }
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
    var container = document.getElementById('print-downloads');
    var list = document.getElementById('print-download-list');
    if (!container || !list) return;
    container.style.display = _downloads.length > 0 ? 'block' : 'none';
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
  //  Init: Panel-HTML einfügen + Event-Listener
  // ================================================================
  function init() {
    // Panel-HTML vor </body> einfügen
    var container = document.createElement('div');
    container.innerHTML = createPanelHTML();
    var panel = container.firstElementChild;
    document.body.appendChild(panel);

    // Layout-Wechsel → Rahmen anpassen
    var layoutSel = document.getElementById('print-layout');
    if (layoutSel) layoutSel.addEventListener('change', updateFrameSize);

    // Koordinatennetz Checkbox → Farbwahl ein-/ausblenden
    var gridCb = document.getElementById('print-grid');
    if (gridCb) gridCb.addEventListener('change', function () {
      document.getElementById('print-grid-color').style.display = gridCb.checked ? 'flex' : 'none';
    });

    // Rotation-Slider
    var rotSlider = document.getElementById('print-rotation');
    if (rotSlider) rotSlider.addEventListener('input', function () {
      var deg = parseInt(rotSlider.value);
      document.getElementById('print-rotation-val').textContent = deg + '\u00b0';
      var map = getMap();
      if (map) map.getView().setRotation(deg * Math.PI / 180);
    });

    console.log('[Drucken] tnet-print.js initialisiert');

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
