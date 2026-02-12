# Template-Schnittstelle: QGIS → WebGIS

> **Version:** 1.2  
> **Stand:** 2026-02-11  
> **Zweck:** Schnittstellenvertrag zwischen QGIS-Plugin (Producer) und WebGIS-App (Consumer)

---

## Überblick

```
┌─────────────────────┐         FTP/Copy          ┌─────────────────────┐
│   QGIS-Desktop      │  ──────────────────────►   │   WebGIS-Server     │
│                      │   ol-pdf-printer/          │                     │
│  Plugin:             │   ├── manifest.json        │   JS liest:         │
│  Layout Template     │   └── qgis-templates/           │   manifest.json     │
│  Exporter            │       ├── *.svg            │   + SVG-Dateien     │
│                      │       └── *.pdf (opt.)     │   → erzeugt PDF     │
└─────────────────────┘                             └─────────────────────┘
```

---

## Ordnerstruktur (Server)

```
ol-pdf-printer/                      ← Root-Ordner auf dem Server
├── manifest.json                    ← Template-Verzeichnis (JSON)
├── qgis-templates/                  ← SVG-Vorlagen (+ optionale PDFs)
│   ├── layout_a4_portrait.svg
│   ├── layout_a4_landscape.svg
│   ├── layout_a3_portrait.svg
│   └── …
└── js/                              ← JS-Engine (nicht vom Plugin erzeugt)
    ├── jspdf.umd.min.js
    ├── svg2pdf.umd.min.js
    ├── template-pdf-export.js
    └── pdf-printer-init.js
```

**Konvention:** Das QGIS-Plugin erzeugt ausschliesslich `manifest.json` und `qgis-templates/*.svg`. Die `js/`-Dateien werden separat deployt.

---

## manifest.json — Schema

```jsonc
{
  "version": "1.2",                          // Schema-Version
  "generated": "2026-02-11T17:08:04",       // ISO 8601, letzte Erzeugung

  "templates": [
    {
      // ─── Identifikation ───
      "name":        "a4_hoch_portrait",          // string, eindeutiger Dateiname (ohne Extension)
      "title":       "A4 Hoch",                   // string, Anzeigename aus QGIS (für UI-Dropdown)

      // ─── Papierformat ───
      "paper":       "A4",                        // string, "A4"|"A3"|"A2"|"A1"|"A0"|"custom_WxH"
      "orientation": "portrait",                   // string, "portrait"|"landscape"
      "width_mm":    210.0,                        // number, Papierbreite in mm
      "height_mm":   297.0,                        // number, Papierhöhe in mm

      // ─── Kartenrahmen (exakte Position in mm) ───
      "mapFrame": {
        "x_mm":      11.0,                         // number, linke Kante in mm ab Seitenrand links
        "y_mm":      36.0,                         // number, obere Kante in mm ab Seitenrand oben
        "width_mm":  142.0,                        // number, Breite des Kartenbereichs in mm
        "height_mm": 249.0                         // number, Höhe des Kartenbereichs in mm
      },

      // ─── Herkunft ───
      "source":      "qgis_project",              // string, "qgis_project"|"generated"

      // ─── Dateien (relativ zu manifest.json) ───
      "files": {
        "svg": "qgis-templates/a4_hoch_portrait.svg",         // string, Pfad zur SVG-Vorlage
        "pdf": "qgis-templates/a4_hoch_portrait.pdf"           // string, optional, Pfad zur PDF-Vorlage
      }
    }
  ]
}
```

### Felder im Detail

| Feld          | Typ      | Pflicht | Beschreibung                                                        |
|---------------|----------|---------|---------------------------------------------------------------------|
| `name`        | `string` | ✓       | Eindeutiger Bezeichner (=Dateiname ohne Extension). Wird als Key für Manifest-Updates verwendet. |
| `title`       | `string` | ✓       | **Menschenlesbarer Name** des Layouts aus QGIS. Für Anzeige in Dropdowns und UI. Bei generierten Templates: `"A4 Hoch"`, bei QGIS-Projekten: der Layoutname (z.B. `"Situationsplan A3"`). |
| `paper`       | `string` | ✓       | Erkanntes Papierformat. Standard: `"A4"`, `"A3"`, `"A2"`, `"A1"`, `"A0"`. Bei Nicht-Standard: `"custom_WxH"` (z.B. `"custom_500x700"`). |
| `orientation` | `string` | ✓       | `"portrait"` (Hochformat) oder `"landscape"` (Querformat). |
| `width_mm`    | `number` | ✓       | Seitenbreite in Millimeter (immer in mm, unabhängig von QGIS-Einheiten). |
| `height_mm`   | `number` | ✓       | Seitenhöhe in Millimeter. |
| `source`      | `string` | ✓       | `"qgis_project"` = bestehendes Layout exportiert, `"generated"` = leeres Template erzeugt. |
| `mapFrame`    | `object` | ✓       | **Exakte Position und Grösse des Kartenrahmens in mm.** Wird für Bildberechnung und Kartenausschnitt verwendet. Enthält `x_mm`, `y_mm`, `width_mm`, `height_mm`. |
| `files`       | `object` | ✓       | Pfade relativ zu `manifest.json`. Schlüssel: `"svg"` (Pflicht), `"pdf"` (optional). |

#### mapFrame — Unterfelder

| Feld              | Typ      | Beschreibung                                                                                      |
|-------------------|----------|---------------------------------------------------------------------------------------------------|
| `x_mm`            | `number` | Abstand der linken Kartenrahmenkante zum linken Seitenrand in mm.                                |
| `y_mm`            | `number` | Abstand der oberen Kartenrahmenkante zum oberen Seitenrand in mm.                                |
| `width_mm`        | `number` | Breite des Kartenbereichs in mm.                                                                  |
| `height_mm`       | `number` | Höhe des Kartenbereichs in mm.                                                                    |

> **Herkunft:** Bei bestehenden QGIS-Layouts wird die Position des grössten `QgsLayoutItemMap` gelesen. Bei generierten Templates entspricht `mapFrame` der berechneten MAP_AREA-Position. Alle Werte sind in mm (Einheiten-Konvertierung erfolgt im Plugin).
>
> **Verwendung im Web:** Die JS-Engine nutzt `mapFrame` direkt für die Berechnung der Kartenbild-Grösse (Pixel = mm × DPI / 25.4) und die Positionierung im PDF. SVG-Parsing dient nur noch als Fallback.

---

## SVG-Template — Platzhalter-Elemente

Das QGIS-Plugin setzt auf bestimmte Layout-Elemente **IDs**, damit die Web-Engine sie im SVG parsen kann.

### Element-IDs (Vertrag)

| Element-ID         | SVG-Element  | Beschreibung                                | Web-Engine Verhalten                    |
|--------------------|-------------|---------------------------------------------|-----------------------------------------|
| `MAP_AREA`         | `<rect>`    | Kartenfenster (gestrichelter blauer Rahmen) | Wird durch Kartencanvas ersetzt         |
| `MAP_AREA_LABEL`   | `<text>`    | Text "[ MAP AREA ]"                        | Wird entfernt                           |
| `TITLE_BLOCK`      | `<rect>`    | Titelblock-Hintergrund                     | Bleibt als Hintergrund                  |
| `TITLE_BLOCK_LABEL`| `<text>`    | Text "[ TITLE BLOCK ]"                     | Wird durch `kartentitel` ersetzt        |
| `LEGEND`           | `<rect>`    | Legendenbereich                            | Aktuell nicht verarbeitet (Platzhalter) |
| `LEGEND_LABEL`     | `<text>`    | Text "[ LEGEND ]"                          | Aktuell nicht verarbeitet               |
| `LOGO`             | `<rect>`    | Logo-Bereich                               | Aktuell nicht verarbeitet (Platzhalter) |
| `LOGO_LABEL`       | `<text>`    | Text "[ COMPANY LOGO ]"                    | Aktuell nicht verarbeitet               |
| `SCALE_BAR`        | `<rect>`    | Massstabsleisten-Bereich                   | Bleibt als Hintergrund                  |
| `SCALE_BAR_LABEL`  | `<text>`    | Text "[ SCALE BAR ] [ COORDINATES / CRS ]" | Wird durch Massstab + Koordinaten ersetzt |

### Platzhalter-Texte (Text-Ersetzung)

Die Web-Engine sucht nach diesen Regex-Mustern im SVG-Text und ersetzt sie:

| Pattern (Regex)                       | Ersetzung                                    |
|---------------------------------------|----------------------------------------------|
| `\[\s*TITLE\s*BLOCK[^\]]*\]`         | Wert von `kartentitel` (z.B. "Situation")    |
| `\[\s*SCALE\s*BAR[^\]]*\]`           | Massstabstext (z.B. "1:10'000")             |
| `\[\s*COORDINATES[^\]]*\]`           | Koordinaten (z.B. "47.37° N, 8.54° E")      |
| `\[\s*DATE[^\]]*\]`                  | Aktuelles Datum (z.B. "11.2.2026")           |
| `\[\s*MAP\s*AREA\s*\]`               | Wird entfernt (Kartenbild deckt Bereich ab)  |

### MAP_AREA — Positionsermittlung

**Primär (ab v1.2):** Die Web-Engine liest `mapFrame` aus dem Manifest. Position (`x_mm`, `y_mm`) und Grösse (`width_mm`, `height_mm`) sind exakt in mm angegeben – keine SVG-Analyse nötig.

**Fallback (v1.0/1.1-Kompatibilität):** Falls `mapFrame` fehlt, sucht die Engine den Kartenbereich im SVG mit 4 Strategien (Priorität):

1. **ID-Suche:** Element mit `id` das `"MAP_AREA"` enthält (nicht `"LABEL"`)
2. **Text-Suche:** `<text>` mit `"MAP AREA"` → nächstes `<rect>` im Parent
3. **Gestrichelt:** Grösstes `<rect>` mit `stroke-dasharray`
4. **Zweitgrösstes:** Zweitgrösstes `<rect>` nach Fläche

#### Berechnung der Kartenbild-Grösse (Pixel)

```
pixel_width  = mapFrame.width_mm  × DPI / 25.4
pixel_height = mapFrame.height_mm × DPI / 25.4
```

Beispiel A4 Hoch bei 150 DPI:  
`mapFrame: { x_mm: 11, y_mm: 36, width_mm: 142, height_mm: 249 }`  
→ Canvas: 838 × 1470 px

---

## Web-API — Funktionen

Die JS-Engine stellt diese globalen Funktionen bereit:

### `templatePdfPrint(options)` → `Promise<void>`

Hauptfunktion für den PDF-Export. Alle Parameter entsprechen 1:1 dem bestehenden Druck-Dialog.

```javascript
templatePdfPrint({
  massstab:        10000,              // number  – Kartenmassstab
  layout:          'A4 Hoch',          // string  – Template-Auswahl (matched gegen title/name)
  aufloesung:      150,                // number  – DPI (96|150|200|300)
  rotation:        0,                  // number  – Kartenrotation in Grad
  kartentitel:     'Situation',        // string  – Titel im Titelblock
  koordinatennetz: false,              // boolean – Graticule anzeigen
  netzfarbe:       'schwarz',          // string  – 'schwarz'|'weiss'
  onProgress:      function(step, msg) {},  // Callback (step: 0-7, msg: string)
  onSuccess:       function() {},           // Callback nach Erfolg
  onError:         function(err) {}         // Callback mit Error-Objekt
});
```

#### Layout-Matching

Der `layout`-String wird wie folgt auf ein Template gemappt:

| Eingabe (layout)  | Gemappt auf manifest.json                         |
|--------------------|---------------------------------------------------|
| `"A4 Hoch"`       | `paper="A4"` + `orientation="portrait"`           |
| `"A3 Quer"`       | `paper="A3"` + `orientation="landscape"`          |
| `"A4 Hochformat"` | `paper="A4"` + `orientation="portrait"`           |
| Freitext           | Sucht `name` das den String enthält (fuzzy)       |

### `getAvailableLayouts()` → `Promise<Array>`

Gibt die verfügbaren Templates zurück (für dynamisches Dropdown).

```javascript
getAvailableLayouts().then(function(layouts) {
  // layouts = [
  //   { label: "A4 Hoch", value: "A4 Hoch", name: "a4_hoch_portrait",
  //     paper: "A4", orientation: "portrait", title: "A4 Hoch" },
  //   ...
  // ]
});
```

### `initPdfPrinter(map, config)` — Manuelle Initialisierung

```javascript
window.initPdfPrinter(map, {
  templatesBasePath: 'ol-pdf-printer/svg',
  filename: 'Kartenexport'
});
```

---

## Export-Ablauf (Sequenz)

```
Benutzer klickt "PDF erstellen"
        │
        ▼
templatePdfPrint(opts)
        │
        ├─► View-Zustand merken (Resolution, Rotation)
        ├─► Massstab setzen (opts.massstab)
        ├─► Rotation setzen (opts.rotation)
        ├─► Koordinatennetz ein (opts.koordinatennetz)
        │
        ├─► manifest.json laden → Template finden
        ├─► SVG laden (fetch)
        ├─► MAP_AREA parsen (Position + Grösse in SVG-Einheiten)
        ├─► Platzhalter-Texte ersetzen
        ├─► MAP_AREA-Grafik aus SVG entfernen
        │
        ├─► OL-Map auf Canvas rendern (DPI-Skalierung)
        │
        ├─► jsPDF erstellen (Papiergrösse aus Manifest)
        ├─► SVG als Hintergrund rendern (svg2pdf.js)
        ├─► Karten-Canvas in MAP_AREA-Position einsetzen
        ├─► PDF speichern (Download)
        │
        ├─► View-Zustand wiederherstellen
        └─► Koordinatennetz entfernen
```

---

## Konfiguration

### window._pdfPrinterConfig (vor Script-Einbindung setzen)

```javascript
window._pdfPrinterConfig = {
  templatesBasePath: 'ol-pdf-printer/qgis-templates',  // Pfad zum Templates-Ordner (relativ zur HTML-Seite)
  filename: 'Kartenexport'                   // PDF-Dateiname (ohne .pdf)
};
```

### window._olMap (Pflicht)

```javascript
window._olMap = map;  // eure OpenLayers Map-Instanz
```

---

## Script-Einbindung (Reihenfolge!)

```html
<script src="ol-pdf-printer/js/jspdf.umd.min.js"></script>
<script src="ol-pdf-printer/js/svg2pdf.umd.min.js"></script>
<script src="ol-pdf-printer/js/template-pdf-export.js"></script>
<script>
  window._pdfPrinterConfig = { filename: 'Kartenexport', templatesBasePath: 'ol-pdf-printer/qgis-templates' };
</script>
<script src="ol-pdf-printer/js/pdf-printer-init.js"></script>
```

---

## Abhängigkeiten

| Bibliothek         | Version | Typ  | Grösse  | Global              |
|--------------------|---------|------|---------|---------------------|
| jsPDF              | 2.5.2   | UMD  | 357 KB  | `window.jspdf.jsPDF`|
| svg2pdf.js         | 2.2.4   | UMD  | 83 KB   | erweitert jsPDF     |
| OpenLayers         | ≥6.x    | —    | vorhanden| `window.ol`         |

---

## Versionierung Schnittstellenvertrag

| Version | Datum      | Änderungen                                        |
|---------|------------|---------------------------------------------------|
| 1.0     | 2026-02-11 | Erstversion: `templates/`, Basis-Manifest          |
| 1.1     | 2026-02-11 | `templates/` → `svg/`, `title`-Feld hinzugefügt, Multi-Layout-Export, Einheiten-Konvertierung |
| 1.2     | 2026-02-11 | `mapFrame`-Objekt: exakte Kartenrahmen-Position (x, y, Breite, Höhe in mm) im Manifest. JS-Engine nutzt Manifest-Daten direkt statt SVG-Parsing. `svg/` → `qgis-templates/`, Ordner von `integration/ol-pdf-printer/` nach `ol-pdf-printer/` (Root) verschoben. |
