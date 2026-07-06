# 6 — tnet-global-config.json5 — Zentrale TNET-Konfiguration

> 🔧 **TNET-Erweiterung** — Diese Datei existiert nur im TNET-Kontext (Trigonet AG)  
> **Pfad**: `maps/tnet/config/tnet-global-config.json5`  
> **Format**: JSON5 (Kommentare, trailing commas, unquoted keys erlaubt)

---

## Inhaltsverzeichnis

- [Überblick](#überblick)
- [Root-Einstellungen](#root-einstellungen)
- [3D Landscape / SplitScreen](#3d-landscape--splitscreen)
- [2D SplitScreen](#2d-splitscreen)
- [Layer Catalog](#layer-catalog)
- [Layer Manager](#layer-manager)
- [Suche](#suche)
- [ÖREB Kataster](#öreb-kataster)
- [Spatial Query](#spatial-query)
- [Basemaps / Zeitreise](#basemaps--zeitreise)
- [Druck / PDF Export](#druck--pdf-export)
- [Ladeverhalten](#ladeverhalten)

---

## Überblick

Die `tnet-global-config.json5` ist die **zentrale Feature-Flag- und Konfigurationsdatei** für alle TNET-Erweiterungen. Sie wird beim Laden per `fetch()` abgerufen und im `window._basemapTimeConfig` (Basemaps) bzw. individuell von den Modulen gelesen.

### Format: JSON5

- Kommentare (`//`) erlaubt
- Trailing Commas erlaubt
- Unquoted Keys erlaubt
- Wird per `JSON5.parse()` oder Custom-Parser gelesen

### Verwendende Module

| Modul | Sektion(en) |
|---|---|
| `tnet-basemap.js` | `basemaps.timeDimension` |
| `tnet-lyrmgr-patch.js` | `layerManager` |
| `tnet-lyrmgr-tree.js` | `layerManager`, `layerCatalog` |
| `tnet-lyrmgr-active.js` | `layerManager` |
| `tnet-search.js` | `search` |
| `tnet-splitscreen.js` | `splitscreen`, `3d-landscape` |
| `tnet-3d-landscape.js` | `3d-landscape` |
| `tnet-oereb.js` | `oereb` |
| `tnet-spatial-query.js` | `spatialQuery` |
| `tnet-print.js` | `print` |

---

## Root-Einstellungen

```json5
{
    logLevel: 'debug',
    scales: [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 75000, 100000, 250000, 500000, 1000000],
}
```

| Property | Typ | Default | Beschreibung |
|---|---|---|---|
| `logLevel` | string | `'debug'` | Konsolenausgaben: `'none'`, `'error'`, `'warn'`, `'info'`, `'debug'` |
| `scales` | number[] | — | Vordefinierte Kartenmassstäbe für Footer-Dropdown und Druck-Panel |

---

## 3D Landscape / SplitScreen

**Sektion**: `"3d-landscape"`

Konfiguriert die 3D-Ansicht (ESRI ArcGIS SceneView) im Split-Screen-Modus.

### Haupt-Properties

| Property | Typ | Beschreibung |
|---|---|---|
| `defaultWebSceneId` | string | ESRI Portal WebScene-ID |
| `availableScenes` | array | Alternative 3D-Szenen `[{name, id}]` |
| `sceneViewOptions` | object | ESRI SceneView-Parameter (qualityProfile, UI, Beleuchtung) |
| `layout` | object | Divider-Position und Min/Max-Breiten |
| `synchronization` | object | 2D↔3D Kamera-Synchronisation |
| `geoAdmin` | object | GeoAdmin API für Höhenabfragen |
| `camera` | object | Kamera-Defaults (Offset, Heading, Tilt, FOV) |
| `highlight` | object | 3D-Highlight-Styles für Punkt/Linie/Fläche |
| `frustum` | object | Sichtfeld-Indikator in 2D-Karte |

### SceneView-Optionen

```json5
sceneViewOptions: {
    qualityProfile: 'high',        // 'low', 'medium', 'high'
    ui: {
        components: ['zoom', 'compass', 'attribution'],
    },
    environment: {
        lighting: {
            type: 'sun',           // 'virtual', 'sun', 'none'
            directShadowsEnabled: true,
            ambientOcclusionEnabled: true,
        },
        atmosphere: { quality: 'high' },
    },
},
```

### Synchronisation (2D ↔ 3D)

```json5
synchronization: {
    enabledByDefault: true,
    syncDelay: 100,                         // ms
    sourceProjection: "EPSG:2056",
    scaleToCameraHeight: [
        { scale:    100, height:    10 },
        { scale:   1000, height:   100 },
        { scale:  10000, height:  800 },
        { scale: 100000, height: 3000 },
        // ...
    ],
},
```

Bei 2D-Pan wird nur die 3D-Kamera-Position geändert, bei 2D-Zoom wird der Massstab über die Lookup-Tabelle in eine Kamerahöhe umgerechnet.

### Kamera

```json5
camera: {
    terrainHeightOffset: 100,   // Höhe über Terrain (m)
    fallbackTerrainHeight: 500, // Fallback wenn API fehlschlägt
    defaultHeading: 0,          // 0 = Nord
    defaultTilt: 60,            // 0 = senkrecht, 90 = horizontal
    defaultFov: 55,             // Field of View (Grad)
},
```

### Frustum (Sichtfeld-Indikator)

Zeichnet in der 2D-Karte ein Trapez, das das 3D-Sichtfeld darstellt:

| Property | Beschreibung |
|---|---|
| `style.sideLineColor` | Farbe der Schenkel |
| `style.cameraMarkerRadius` | Radius des Kamera-Punkts |
| `style.cornerRadius` | Radius der Eck-Griffe |
| `geometry.maxVisibleDistance` | Max. Sichtweite = altitude × Faktor |
| `geometry.minVisibleDistance` | Mindest-Sichtweite (m) |
| `geometry.hitTolerance` | Pixel-Toleranz für Klick-Erkennung |
| `zIndex` | 9999 (immer im Vordergrund) |

---

## 2D SplitScreen

**Sektion**: `splitscreen`

```json5
splitscreen: {
    enabled: true,
    defaultDividerPosition: 50,     // Prozent (0-100)
},
```

| Property | Typ | Beschreibung |
|---|---|---|
| `enabled` | bool | Feature aktivieren |
| `defaultDividerPosition` | number | Start-Position des Teilers in % |

---

## Layer Catalog

**Sektion**: `layerCatalog`

```json5
layerCatalog: {
    enabled: true,
    searchEnabled: true,
    maxResults: 50,
},
```

| Property | Typ | Beschreibung |
|---|---|---|
| `enabled` | bool | Katalog aktivieren |
| `searchEnabled` | bool | Suchfeld im Katalog anzeigen |
| `maxResults` | number | Max. Suchergebnisse |

---

## Layer Manager

**Sektion**: `layerManager`

Diese Sektion steuert den gesamten TNET-Layermanager (Tree, Active-Panel, Coalesce-Bridge).

```json5
layerManager: {
    useNewActivePanel: true,
    useNewTree: true,
    useNewWmsPanel: true,
    apiUrl: '/maps/tnet/api/v1/layers.php',
    useLegacyNestedHierarchyStyle: true,
    coalesceFrameworkBridge: true,
    coalesceDebounceMs: 80,
    debug: true,
},
```

### Property-Referenz

| Property | Typ | Default | Beschreibung |
|---|---|---|---|
| `useNewActivePanel` | bool | `true` | Neues Drag&Drop-Panel ("Dargestellte Themen") statt Legacy `njs_main_lyrsorter_wrapper` |
| `useNewTree` | bool | `true` | TNET-Themenkatalog-Baum mit Wappen-Tabs + Suche statt Legacy Dojo-Baum |
| `useNewWmsPanel` | bool | `true` | WMS-Panel im Hamburger-Menü statt Legacy `#tp_wms_menu` TitlePane |
| `apiUrl` | string | — | PHP-API-Endpoint für Layer-Hierarchie |
| `useLegacyNestedHierarchyStyle` | bool | `true` | CSS-Hierarchie-Styling für verschachtelte Ebenen im Dojo-Baum |
| `coalesceFrameworkBridge` | bool | `true` | Coalesce-Bridge aktivieren (MapTip, URL-State, Dojo-Sync) |
| `coalesceDebounceMs` | number | `80` | Debounce für schnelles Aktivieren mehrerer Sublayer |
| `debug` | bool | `true` | Erweiterte Konsolenausgaben |

> **Wichtig**: `coalesceFrameworkBridge` muss `true` sein, damit MapTips für Coalesce-Layer funktionieren.

> **Hinweis**: Bei `useNewTree: true` bleibt der Legacy Dojo-Baum im Hintergrund geladen (Parallel-Betrieb), damit Feature-Edit-Tools und andere Framework-Werkzeuge weiterhin funktionieren.

---

## Suche

**Sektion**: `search`

```json5
search: {
    njsSearchEnabled: false,
    tnetSearchEnabled: true,
    zoom: {
        orthophoto: { point: 27, fitMax: 27, fitMin: 16, panDefault: 27 },
        other:      { point: 26, fitMax: 26, fitMin: 15, panDefault: 26 },
    },
},
```

### Property-Referenz

| Property | Typ | Beschreibung |
|---|---|---|
| `njsSearchEnabled` | bool | Standard MapPlus/TYDAC-Suche (`njs search.js`) aktivieren |
| `tnetSearchEnabled` | bool | TNET-Suche (`tnet-search.js` / `search-proxy.php`) aktivieren |
| `zoom.orthophoto` | object | Zoom-Level für Suchergebnisse auf Orthofoto-Basemap |
| `zoom.other` | object | Zoom-Level für Suchergebnisse auf anderen Basemaps |

### Zoom-Sub-Properties

| Property | Beschreibung |
|---|---|
| `point` | Zoom bei Punkt-Geometrie / Adresse |
| `fitMax` | Maximaler Zoom bei Flächen-Geometrie (`view.fit()`) |
| `fitMin` | Minimaler Zoom bei Flächen-Geometrie |
| `panDefault` | Standard-Zoom bei `panToResult()` (Geocoder) |

> **Referenz Swisstopo-Resolutions**: Zoom 25 = 1.0 m/px (~1:3'600), Zoom 27 = 0.25 m/px (~1:900), Zoom 28 = 0.1 m/px (~1:360)

---

## ÖREB Kataster

**Sektion**: `oereb`

```json5
oereb: {
    enabled: true,
    apiUrl: "https://api.geo.admin.ch/rest/services/api/MapServer",
    maxZoomOrthophoto: 23,
    maxZoomOther: 18,
    timeout: 5000,
},
```

| Property | Typ | Beschreibung |
|---|---|---|
| `enabled` | bool | ÖREB-Integration aktivieren |
| `apiUrl` | string | GeoAdmin API-URL |
| `maxZoomOrthophoto` | number | Max. Zoom für Parzellen-Fit (Orthofoto) |
| `maxZoomOther` | number | Max. Zoom für Parzellen-Fit (andere Basemaps) |
| `timeout` | number | API-Timeout in ms |

---

## Spatial Query

**Sektion**: `spatialQuery`

```json5
spatialQuery: {
    enabled: true,
    maxVisibleColumns: 10,
    globalBlacklist: [
        "OBJECTID*", "Shape*", "GlobalID", "gml_id",
        "*_gml_id", "SHAPE.STArea*", "SHAPE.STLength*",
    ],
    layerBlacklist: {},
    bufferDistances: [10, 25, 50, 100, 250, 500, 1000],
},
```

### Property-Referenz

| Property | Typ | Beschreibung |
|---|---|---|
| `enabled` | bool | Räumliche Abfragen aktivieren |
| `maxVisibleColumns` | number | Initial sichtbare Spalten (Rest via "Mehr"-Explorer) |
| `globalBlacklist` | string[] | Glob-Patterns für Felder, die global ausgeblendet werden |
| `layerBlacklist` | object | Layer-spezifische Feld-Blacklists `{layerName: [fields]}` |
| `bufferDistances` | number[] | Verfügbare Puffer-Distanzen in Metern |

### Blacklist-Syntax

- `*` = beliebige Zeichen (Glob)
- Gross-/Kleinschreibung wird ignoriert
- Matcht auf Feldnamen in Abfrageresultaten

---

## Basemaps / Zeitreise

**Sektion**: `basemaps.timeDimension`

Siehe [05-basemaps.md → TNET: Zeitreise (TimeDimension)](05-basemaps.md#tnet-zeitreise-timedimension) für die vollständige Dokumentation.

### Kurzübersicht

| Basemap | Typ | Jahre | Beschreibung |
|---|---|---|---|
| `swissimage` | static | 34 (1926–2024) | Orthofoto-Zeitreise |
| `pk_color` | dynamic | per API | Landeskarte-Zeitreise |
| `siegfried` | static | 80 (1870–1949) | Siegfriedkarten |
| `dufour` | static | `['current']` | Dufourkarte (kein Slider) |

---

## Druck / PDF Export

**Sektion**: `print`

```json5
print: {
    provider: 'tnet',
    pdfRetentionDays: 1,
    autoAdjustZoom: true,
    targetFramePercent: 40,
    jpegQuality: 0.85,
    serverRenderDefault: false,
    svgFormatDefault: false,
    serverDpi: 96,
    imageFormat: 'image/jpeg',
    debug: false,
    debugTestLine: false,
    debugLogMetrics: false,
},
```

### Property-Referenz

| Property | Typ | Default | Beschreibung |
|---|---|---|---|
| `provider` | string | `'tnet'` | Aktives Printing-System: `'tnet'`, `'mapplus'`, `'none'` |
| `pdfRetentionDays` | number | `1` | Archivierte PDFs löschen nach X Tagen |
| `autoAdjustZoom` | bool | `true` | Zoom automatisch anpassen beim Öffnen des Druckpanels |
| `targetFramePercent` | number | `40` | Ziel: Frame soll X% des Viewports füllen |
| `jpegQuality` | number | `0.85` | JPEG-Qualität (0.0–1.0). 0.7 = Kompromiss, 0.85 = hoch |
| `serverRenderDefault` | bool | `false` | Kartenbild per Mapserver statt OL-Canvas rendern |
| `svgFormatDefault` | bool | `false` | SVG statt Raster (nur mit Server-Rendering) |
| `serverDpi` | number | `96` | DPI für Mapserver-Requests. Sollte kleiner sein als PDF-DPI |
| `imageFormat` | string | `'image/jpeg'` | `'image/jpeg'` (kleiner) oder `'image/png'` (verlustfrei) |
| `debug` | bool | `false` | Erweiterte Konsolenausgaben |
| `debugTestLine` | bool | `false` | 100mm Kalibrier-Linie im PDF zeichnen |
| `debugLogMetrics` | bool | `false` | Scale/Resolution/DPI/Pixel/Extent in Konsole |

> **Empfehlung**: `serverDpi` auf 96 belassen, da die Mapserver-Styles für 96 DPI optimiert sind. Höhere Werte führen zu engeren Schraffuren.

### Provider-Modi

- `provider: 'tnet'`: Neues TNET-Printing aktiv, Legacy-Print ausgeblendet.
- `provider: 'mapplus'`: Legacy-Mapplus-Printing aktiv, TNET-Printing deaktiviert.
- `provider: 'none'`: Printing komplett deaktiviert.

### Rückwärtskompatibilität

Falls `provider` nicht gesetzt ist, wird als Fallback der ältere Schalter `print.enableLegacyPrint` ausgewertet:

- `enableLegacyPrint: true` -> wirkt wie `provider: 'mapplus'`
- `enableLegacyPrint: false` -> wirkt wie `provider: 'tnet'`

---

## Ladeverhalten

Die Konfiguration wird per `fetch()` einmalig geladen und gecached:

```javascript
// tnet-basemap.js
async function loadTimeDimensionConfigAsync() {
    if (window._basemapTimeConfig) return window._basemapTimeConfig;
    var resp = await fetch('/maps/tnet/config/tnet-global-config.json5');
    var text = await resp.text();
    // JSON5-kompatibles Parsen (Kommentare + trailing commas entfernen)
    var config = JSON.parse(text.replace(/\/\/.*$/gm, '').replace(/,\s*([\]}])/g, '$1'));
    window._basemapTimeConfig = config.basemaps.timeDimension;
    return window._basemapTimeConfig;
}
```

> **Hinweis**: Andere Module laden die Datei ebenfalls per `fetch()` und cachen ihren jeweiligen Abschnitt.
