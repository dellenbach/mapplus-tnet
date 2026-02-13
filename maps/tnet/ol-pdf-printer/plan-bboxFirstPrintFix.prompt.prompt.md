# Fix: BBOX-First Print Pipeline + ResizeObserver-Schutz

## Probleme

### Bug 1: ResizeObserver überschreibt `map.setSize()`
In `renderMapCanvas()` wird nach `map.setSize([pxW, pxH])` ein `setTimeout(300)` aufgerufen. Während dieser 300ms feuert OL's interner **ResizeObserver** auf dem Target-Element → ruft `updateSize()` → liest DOM-Grösse → **überschreibt unsere setSize()**. Im Callback setzen wir nur Resolution+Center nach, **aber nicht die Size**.

### Bug 2: GPR-Korrektur macht Extent DPI-abhängig
Die `getPointResolution`-Korrekturschleife berechnet `effectiveExtent = gpr * baseVpW`. Da `gpr` von `desiredRes` abhängt und `desiredRes` DPI-abhängig ist (`extentW_m / baseVpW`, wobei `baseVpW = mapAreaW / 25.4 * dpi`), konvergiert die Schleife bei verschiedenen DPI auf **leicht verschiedene** `desiredRes`-Werte → der berechnete Extent (`pxW * desiredRes`) verschiebt sich. Für EPSG:2056 (mpu=1, Meter-Projektion) ist die Verzerrung <0.01% — die GPR-Korrektur richtet mehr Schaden an als sie nützt.

## Lösung: BBOX = Wahrheit

| Prinzip | Beschreibung |
|---|---|
| **BBOX-first** | Eckkoordinaten werden aus `center + mapAreaW/H × scale / 1000` berechnet und sind DPI-unabhängig |
| **Resolution = Extent / Pixel** | Direkte Division, keine GPR-Korrektur |
| **Kein setTimeout** | `setSize → setCenter → setRes → renderSync` synchron in einem Zug |

## Änderung 1: `renderMapCanvas()` — kein setTimeout, BBOX-Verifikation

**Datei:** `maps/tnet/ol-pdf-printer/js/template-pdf-export.js`
**Bereich:** Ab Zeile ~857 (`// ── 3. Map auf Druckpixel-Grösse`) bis Funktionsende (Zeile ~947)

### Aktueller Code (ersetzen):
```javascript
      // ── 3. Map auf Druckpixel-Grösse setzen (KEIN DOM-Resize!) ──
      map.setSize([pxW, pxH]);
      map.getView().setCenter(center);
      map.getView().setResolution(resolution);

      // Verifikation
      var actualSize = map.getSize();
      var actualRes  = map.getView().getResolution();
      var actualCtr  = map.getView().getCenter();
      console.log('[TemplatePDF] renderMapCanvas — map.setSize():',
        'Size:', actualSize[0] + '×' + actualSize[1],
        '(Soll:', pxW + '×' + pxH + ')',
        'Res:', actualRes.toFixed(8),
        '(Soll:', resolution.toFixed(8) + ')',
        'Center:', actualCtr[0].toFixed(1) + '/' + actualCtr[1].toFixed(1));

      // ── 4. Rendern ──
      // Kurze Verzögerung, damit Tile-/WMS-Requests den neuen Extent
      // mit den aktualisierten DPI-Parametern anfragen können.
      setTimeout(function () {
        // Resolution + Center nochmals erzwingen (Schutz gegen
        // mögliche interne OL-Korrektur nach setSize)
        map.getView().setResolution(resolution);
        map.getView().setCenter(center);

        map.once('rendercomplete', function () {
          var size = map.getSize();  // sollte = [pxW, pxH]

          // ── 5. Canvas-Compositing ──
          ...
          resolve(canvas);
        });
        map.renderSync();
      }, 300);
    });
  }
```

### Neuer Code:
```javascript
      // ── 3. Map auf Druckpixel-Grösse setzen + View konfigurieren ──
      // KEIN setTimeout! Alles synchron, damit OL's ResizeObserver
      // (asynchron) unsere Werte nicht überschreiben kann.
      map.setSize([pxW, pxH]);
      map.getView().setCenter(center);
      map.getView().setResolution(resolution);

      // Verifikation (synchron, vor renderSync)
      var actualSize = map.getSize();
      var actualRes  = map.getView().getResolution();
      var actualCtr  = map.getView().getCenter();
      var renderedExtentW = pxW * actualRes;
      var renderedExtentH = pxH * actualRes;
      console.log('[TemplatePDF] renderMapCanvas — BBOX-Check:',
        'Size:', actualSize[0] + '×' + actualSize[1],
        '(Soll:', pxW + '×' + pxH + ')',
        'Res:', actualRes.toFixed(8), 'm/px',
        'Extent:', renderedExtentW.toFixed(2) + '×' + renderedExtentH.toFixed(2), 'm',
        'BBOX: [' + (actualCtr[0] - renderedExtentW/2).toFixed(1) + ',' +
                    (actualCtr[1] - renderedExtentH/2).toFixed(1) + ',' +
                    (actualCtr[0] + renderedExtentW/2).toFixed(1) + ',' +
                    (actualCtr[1] + renderedExtentH/2).toFixed(1) + ']');

      // ── 4. Rendern ──
      // Kein setTimeout — renderSync() löst sofort den Request-Cycle aus.
      map.once('rendercomplete', function () {
        var size = map.getSize();

        // Sicherheitscheck: Hat ResizeObserver die Size überschrieben?
        if (size[0] !== pxW || size[1] !== pxH) {
          console.warn('[TemplatePDF] ⚠ ResizeObserver hat Size überschrieben!',
            'Ist:', size[0] + '×' + size[1],
            'Soll:', pxW + '×' + pxH);
        }

        // ── 5. Canvas-Compositing ──
        var canvas = document.createElement('canvas');
        canvas.width  = pxW;
        canvas.height = pxH;
        var ctx = canvas.getContext('2d');

        var layers = document.querySelectorAll('.ol-layer canvas, #map canvas');
        for (var i = 0; i < layers.length; i++) {
          var lc = layers[i];
          if (lc.width > 0) {
            var op = lc.parentNode && lc.parentNode.style
              ? lc.parentNode.style.opacity : '';
            ctx.globalAlpha = op === '' ? 1 : Number(op);
            var tf = lc.style.transform;
            var m = tf && tf.match(/matrix\(([^)]+)\)/);
            if (m) {
              var mx = m[1].split(',').map(Number);
              ctx.setTransform(mx[0], mx[1], mx[2], mx[3], mx[4], mx[5]);
            } else {
              ctx.setTransform(1, 0, 0, 1, 0, 0);
            }
            ctx.drawImage(lc, 0, 0);
          }
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;

        // ── 6. Quellen + Map wiederherstellen ──
        origDpiParams.forEach(function (entry) {
          entry.source.updateParams(entry.params);
        });

        if (prevSize) {
          map.setSize(prevSize);
        } else {
          map.setSize(undefined);
          map.updateSize();
        }
        map.getView().setCenter(prevCenter);
        map.getView().setResolution(prevRes);

        resolve(canvas);
      });
      map.renderSync();
    });
  }
```

## Änderung 2: `exportPdf()` — BBOX-first, keine GPR-Korrektur

**Datei:** `maps/tnet/ol-pdf-printer/js/template-pdf-export.js`
**Bereich:** Ab Zeile ~1601 (`// ── OL-Viewport: EXAKT mit Landeskoordinaten`) bis Zeile ~1660 (Ende des Kontrollausgabe-Blocks, vor `_metrics`)

### Aktueller Code (ersetzen):
```javascript
        // ── OL-Viewport: EXAKT mit Landeskoordinaten (LV95) rechnen ──
        // Kein OGC-Pixel-Constant (0.28mm) — direkte Berechnung
        // aus Papiermassen, Massstab und Druck-DPI.
        var scaleNumber = options.scaleNumber || 0;
        var mpu = map.getView().getProjection().getMetersPerUnit() || 1;
        var desiredCenter = options.printCenter || map.getView().getCenter();

        // 1. Geographische Ausdehnung in Landeskoordinaten (LV95 = Meter)
        var extentW_m = mapAreaW * scaleNumber / 1000;
        var extentH_m = mapAreaH * scaleNumber / 1000;

        // 2. Viewport-Pixel = Papiermasse bei Ziel-DPI
        var baseVpW = mapAreaW / 25.4 * dpi;
        var baseVpH = mapAreaH / 25.4 * dpi;

        // 3. OL-Resolution: exakt Meter pro Pixel
        var desiredRes;
        if (scaleNumber > 0 && baseVpW > 0) {
          desiredRes = extentW_m / baseVpW;
          // getPointResolution-Korrektur: ...
          if (ol.proj && ol.proj.getPointResolution) {
            var proj = map.getView().getProjection();
            for (var _gprI = 0; _gprI < 5; _gprI++) {
              var gpr = ol.proj.getPointResolution(proj, desiredRes, desiredCenter);
              ...
              desiredRes *= ratio;
            }
            _dbg('[TemplatePDF] getPointResolution-Korrektur: res =', desiredRes.toFixed(8));
          }
        } else {
          desiredRes = map.getView().getResolution();
        }

        // 4. Rotation: Viewport-Bounding-Box vergrössern
        var rotRad = ...
        var targetVpW = ...
        var targetVpH = ...

        // 5. Kontrollausgabe: LV95-Eckkoordinaten des Druckbereichs
        var halfW = extentW_m / (2 * mpu);
        var halfH = extentH_m / (2 * mpu);
        console.log('[TemplatePDF] LV95 Druckbereich:', ...);
```

### Neuer Code:
```javascript
        // ── BBOX-first: Eckkoordinaten sind die Wahrheit ──
        // Resolution wird aus BBOX + Pixelzahl abgeleitet.
        // Keine GPR-Korrektur nötig (EPSG:2056, mpu=1).
        var scaleNumber = options.scaleNumber || 0;
        var mpu = map.getView().getProjection().getMetersPerUnit() || 1;
        var desiredCenter = options.printCenter || map.getView().getCenter();

        // 1. BBOX in Landeskoordinaten (LV95 = Meter, mpu=1)
        //    Massstab 1:S → 1 mm Papier = S/1000 Meter Realwelt
        var extentW_m = mapAreaW * scaleNumber / 1000;
        var extentH_m = mapAreaH * scaleNumber / 1000;
        var halfW = extentW_m / (2 * mpu);
        var halfH = extentH_m / (2 * mpu);
        var printBbox = [
          desiredCenter[0] - halfW,   // minX
          desiredCenter[1] - halfH,   // minY
          desiredCenter[0] + halfW,   // maxX
          desiredCenter[1] + halfH    // maxY
        ];

        // 2. Pixeldimensionen aus Papier + DPI
        var baseVpW = mapAreaW / 25.4 * dpi;
        var baseVpH = mapAreaH / 25.4 * dpi;

        // 3. Resolution DIREKT aus BBOX und Pixeln
        //    Keine GPR-Korrektur — BBOX ist die Wahrheit.
        //    Für EPSG:2056 (mpu=1) ist dies exakt.
        var desiredRes;
        if (scaleNumber > 0 && baseVpW > 0) {
          desiredRes = extentW_m / baseVpW;
        } else {
          desiredRes = map.getView().getResolution();
        }

        // 4. Rotation: Viewport-Bounding-Box vergrössern
        var rotRad = map.getView().getRotation() || 0;
        var absC = Math.abs(Math.cos(rotRad));
        var absS = Math.abs(Math.sin(rotRad));
        var rotBuffer = Math.abs(rotRad) > 0.001 ? 1.15 : 1.0;
        var targetVpW = Math.round((baseVpW * absC + baseVpH * absS) * rotBuffer);
        var targetVpH = Math.round((baseVpW * absS + baseVpH * absC) * rotBuffer);

        // 5. Kontrollausgabe mit BBOX-Verifikation
        console.log('[TemplatePDF] BBOX:',
          '[' + printBbox.map(function(v){return v.toFixed(1)}).join(', ') + ']',
          'Extent:', extentW_m.toFixed(1) + '×' + extentH_m.toFixed(1), 'm',
          'Pixel:', Math.round(baseVpW) + '×' + Math.round(baseVpH),
          'DPI:', dpi,
          'Res:', desiredRes.toFixed(8), 'm/px',
          '1:' + scaleNumber);
        // Verifikation: Res × Pixel muss = Extent ergeben
        var verifyW = desiredRes * Math.round(baseVpW);
        var verifyH = desiredRes * Math.round(baseVpH);
        console.log('[TemplatePDF] BBOX-Verify:',
          'Res×Px:', verifyW.toFixed(2) + '×' + verifyH.toFixed(2), 'm',
          '(Soll:', extentW_m.toFixed(2) + '×' + extentH_m.toFixed(2) + ')',
          'Delta:', Math.abs(verifyW - extentW_m).toFixed(4) + '/' +
                   Math.abs(verifyH - extentH_m).toFixed(4), 'm');
```

## Verifikation nach Anwendung

1. **Console prüfen** — `BBOX-Check` Log in renderMapCanvas:
   - `Size: (Soll: pxW×pxH)` — müssen identisch sein
   - `BBOX: [...]` — LV95-Eckkoordinaten müssen bei 150 und 300 DPI **identisch** sein
   - Kein `⚠ ResizeObserver hat Size überschrieben!`

2. **DPI wechseln** (150 vs 300) — Ausschnitt im PDF muss **identisch** sein (nur Auflösung/Schärfe ändert sich)

3. **Testlinie** (`debugTestLine: true`) — 100mm messen, muss exakt 100mm sein

4. **Kartenausschnitt** — Monitor-Extent vs PDF-Extent vergleichen (aus Console-Log)

## Mathematischer Beweis: Resolution ist DPI-unabhängig

```
extentW_m = mapAreaW × scale / 1000          (DPI-unabhängig)
baseVpW   = mapAreaW / 25.4 × dpi            (DPI-abhängig)
desiredRes = extentW_m / baseVpW
           = (mapAreaW × scale / 1000) / (mapAreaW / 25.4 × dpi)
           = scale × 25.4 / (1000 × dpi)
           = scale / (dpi × 39.3701)

BBOX:
  renderedExtentW = pxW × desiredRes
                  = Math.round(baseVpW) × (extentW_m / baseVpW)
                  ≈ extentW_m                (Rundungsfehler ≤ 1 Pixel × res)
```

Der Extent variiert bei DPI-Wechsel nur um `±1 Pixel × resolution` (Rundung von `baseVpW`).
Bei 1:10'000 / 300 DPI: `±1 × 0.847 = ±0.85 m` — vernachlässigbar.
