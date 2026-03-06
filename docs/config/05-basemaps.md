# 5 — Basemaps — Grundkarten-Konfiguration

> **Dateien**: `core/config/basemaps.conf`, `<profil>/config/basemaps_mgr.conf`  
> **TNET-Erweiterung**: `tnet-basemap.js`, `tnet-global-config.json5` (Sektion `basemaps`)  
> **Tydac-Doku**: https://cloud.mapplus.ch/mapplusv4_doku/de:basemaps  
> **Tydac-Doku (swisstopo)**: https://cloud.mapplus.ch/mapplusv4_doku/de:swisstopo

---

## Inhaltsverzeichnis

- [Überblick & Architektur](#überblick--architektur)
- [basemaps_mgr.conf — Karten-Container](#basemaps_mgrconf--karten-container)
- [basemaps.conf — Basemap-Definitionen](#basemapsconf--basemap-definitionen)
- [Basemap-Typen](#basemap-typen)
- [swisstopo-Integration](#swisstopo-integration)
- [Mask-Layer](#mask-layer)
- [NLS: toolsResources.json](#nls-toolsresourcesjson)
- [TNET: Basemap-Widget](#tnet-basemap-widget)
- [TNET: Grundkarten-Layer-Sync](#tnet-grundkarten-layer-sync)
- [TNET: Zeitreise (TimeDimension)](#tnet-zeitreise-timedimension)
- [TNET: SplitScreen-Sync](#tnet-splitscreen-sync)
- [URL-Parameter](#url-parameter)
- [Deployment](#deployment)

---

## Überblick & Architektur

Basemaps definieren die Hintergrundkarte(n), auf der alle thematischen Layer dargestellt werden. Die Konfiguration ist zweigeteilt:

```
┌──────────────────────┐         ┌──────────────────────┐
│  basemaps_mgr.conf   │         │   basemaps.conf      │
│  (Profil-Ebene)      │         │   (Framework-Ebene)  │
│                      │         │                      │
│  - Container, EPSG   │    ID   │  - Layer-Definition  │
│  - Resolutions       │───────▶│  - type, url, params │
│  - basisMaps[] (IDs) │         │  - Optionen          │
│  - Extent            │         │                      │
└──────────────────────┘         └──────────────────────┘
        │                                 │
        │  btnMaps_<id>                   │  changeBaseMap()
        ▼                                 ▼
┌──────────────────────┐         ┌──────────────────────┐
│ toolsResources.json  │         │  OpenLayers BaseLayer │
│ (Button-Label)       │         │  (im DOM)            │
└──────────────────────┘         └──────────────────────┘
```

### Lade-Reihenfolge

1. `basemaps_mgr.conf` wird pro Profil geladen (Kaskade: core → Profil → Gruppe)
2. `basemaps.conf` wird per `loader.php` geladen (nur Framework-Ebene)
3. Die IDs in `basisMaps[]` referenzieren Keys in `basemaps.conf`
4. Das Framework erstellt die OpenLayers-BaseLayer

---

## basemaps_mgr.conf — Karten-Container

Definiert die Kartenansicht (Extent, Projektion, Zoom) und die verfügbaren Basemaps.

### Vollständiges Beispiel

```json
{
    "main": {
        "container": "map",
        "projection": "EPSG:2056",
        "constrainResolution": true,
        "initialExtent": [2645000, 1172000, 2690000, 1212000],
        "restrictedExtent": [2350000, 960000, 2880000, 1420000],
        "resolutions": [
            500.0, 250.0, 100.0, 50.0, 20.0, 10.0, 5.0,
            2.5, 2.0, 1.5, 1.0, 0.5, 0.25, 0.1, 0.05, 0.025
        ],
        "basisMaps": [
            "plan_fuer_grundbuch_bund", "av_sw", "av_geodienste",
            "swissimage", "swisstopo_lk", "swisstopo_lk_vintage",
            "swiss_tlm", "osm_ch", "pk_color", "siegfried", "dufour", "leer"
        ],
        "basisMapsSwitch": {
            "type": "mapButtons",
            "style": {
                "unselectedStyle": { "color": "#333", "fontWeight": "normal", "backgroundColor": "#fff" },
                "selectedStyle": { "color": "#FFFFFF", "fontWeight": "bold", "backgroundColor": "#2b65ae" }
            }
        },
        "startMap": "swissimage",
        "mask_layer": { ... }
    }
}
```

### Property-Referenz

| Property | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `container` | string | ✅ | DOM-Container-ID (z.B. `"map"`) |
| `projection` | string | ✅ | EPSG-Code (z.B. `"EPSG:2056"` für LV95) |
| `constrainResolution` | bool | — | `true` = nur Ganzzahl-Zoomstufen erlauben |
| `initialExtent` | number[4] | ✅ | Startansicht `[minX, minY, maxX, maxY]` |
| `restrictedExtent` | number[4] | — | Maximaler Navigationsbereich |
| `resolutions` | number[] | ✅ | Erlaubte Auflösungen (m/px), von grob nach fein |
| `basisMaps` | string[] | ✅ | Liste der Basemap-IDs (Reihenfolge = Darstellungsreihenfolge) |
| `basisMapsSwitch` | object | — | Konfiguration der Basemap-Auswahl-Buttons |
| `startMap` | string | — | Basemap beim Laden (Default: erste in `basisMaps`) |
| `mask_layer` | object | — | Kantons-Maske als WMS-Overlay |

### Mehrere Karten (SplitScreen)

Für Split-Screen kann ein zweiter Container definiert werden:

```json
{
    "main": { ... },
    "second": {
        "container": "map2",
        "projection": "EPSG:2056",
        ...
    }
}
```

---

## basemaps.conf — Basemap-Definitionen

> **Hinweis**: `basemaps.conf` liegt nur auf dem Server (`/www/core/config/basemaps.conf`) und wird per `loader.php` geladen. Es gibt keinen lokalen Klon.

Jeder Key in `basemaps.conf` definiert eine Basemap mit ihrem Typ und Verbindungsparametern.

### Schlüsselformat

```json
{
    "swissimage": {
        "type": "wmtscapabilities",
        ...
    },
    "av_sw": {
        "type": "WMS",
        ...
    },
    "leer": {
        "type": "void"
    }
}
```

---

## Basemap-Typen

### `void` — Leere Karte

Keine Hintergrundkarte. Für Darstellung ohne Basemap.

```json
{
    "leer": {
        "type": "void"
    }
}
```

### `WMS` — Web Map Service

```json
{
    "av_sw": {
        "type": "WMS",
        "url": "https://nodi.mapplus.ch/cgi-bin/mapserv?map=...",
        "params": {
            "layers": "av_sw_all",
            "format": "image/png",
            "transparent": false,
            "srs": "EPSG:2056"
        },
        "options": {
            "singleTile": true,
            "isBaseLayer": true
        }
    }
}
```

### `tms` — Tile Map Service

Kacheln als vordefiniertes Grid:

```json
{
    "osm_ch": {
        "type": "tms",
        "url": "https://tiles.mapplus.ch/osm/schweiz/",
        "options": {
            "isBaseLayer": true,
            "layername": ".",
            "type": "png"
        }
    }
}
```

### `wmtscapabilities` — WMTS (OGC Standard)

OpenLayers liest das Capabilities-Dokument und erstellt den Layer automatisch:

```json
{
    "swisstopo_lk": {
        "type": "wmtscapabilities",
        "url": "https://wmts.geo.admin.ch/1.0.0/WMTSCapabilities.xml",
        "options": {
            "layer": "ch.swisstopo.pixelkarte-farbe",
            "matrixSet": "2056_28"
        }
    }
}
```

### `multisource` — Kombinierte Basemap

Erlaubt mehrere Quellen (z.B. WMTS + WMS) mit auflösungsabhängiger Sichtbarkeit:

```json
{
    "av_geodienste": {
        "type": "multisource",
        "sources": [
            {
                "type": "wmtscapabilities",
                "url": "https://geodienste.ch/...",
                "resol_visibility": [1.0, 500.0]
            },
            {
                "type": "WMS",
                "url": "https://...",
                "resol_visibility": [0.025, 1.0]
            }
        ]
    }
}
```

| Property | Beschreibung |
|---|---|
| `resol_visibility` | `[min, max]` — Auflösungsbereich in m/px, in dem diese Quelle sichtbar ist |

---

## swisstopo-Integration

swisstopo stellt WMTS-Dienste über `wmts.geo.admin.ch` bereit.

### Typische WMTS-Layer

| Basemap-ID | swisstopo WMTS-Layer | Beschreibung |
|---|---|---|
| `swissimage` | `ch.swisstopo.swissimage-product` | Orthofoto (Luftbild) |
| `swisstopo_lk` | `ch.swisstopo.pixelkarte-farbe` | Landeskarte farbig |
| `swisstopo_lk_vintage` | `ch.swisstopo.pixelkarte-farbe` | Landeskarte Vintage-Stil |
| `pk_color` | `ch.swisstopo.zeitreihen` | Historische Landeskarten (Zeitreise) |
| `siegfried` | `ch.swisstopo.hiks-siegfried` | Siegfriedkarte (1870–1949) |
| `dufour` | `ch.swisstopo.hiks-dufour` | Dufourkarte |
| `swiss_tlm` | `ch.swisstopo.swisstlm3d-karte-farbe` | TLM-Vektorkarte von TYDAC |

### swisstopo Resolutions

swisstopo verwendet 29 Zoomstufen (0–28) mit vordefinierten Auflösungen:

```javascript
// Von TNET vordefiniert (tnet-basemap.js)
SWISSTOPO_RESOLUTIONS = [
    4000, 3750, 3500, 3250, 3000, 2750, 2500, 2250, 2000, 1750,
    1500, 1250, 1000, 750, 650, 500, 250, 100, 50, 20,
    10, 5, 2.5, 2, 1.5, 1, 0.5, 0.25, 0.1
];
SWISSTOPO_MATRIX_IDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    20, 21, 22, 23, 24, 25, 26, 27, 28];
```

Diese werden global auf `window.SWISSTOPO_RESOLUTIONS` und `window.SWISSTOPO_MATRIX_IDS` exportiert, da sie auch vom SplitScreen und der Zeitreise benötigt werden.

---

## Mask-Layer

Optionaler WMS-Layer, der die Karte ausserhalb eines Gebiets maskiert (z.B. Kantonsgrenzen):

```json
"mask_layer": {
    "name": "mask_layer",
    "minResolution": 0,
    "params": {
        "layers": "kanton_uw",
        "format": "image/png",
        "transparent": true,
        "srs": "EPSG:2056"
    },
    "type": "WMS",
    "url": "https://nodi.mapplus.ch/cgi-bin/mapserv?map=/data/mapplus/mymaps/poi_ch_mymaps.map&",
    "options": {
        "singleTile": true,
        "isBaseLayer": false,
        "opacity": 1.0
    }
}
```

---

## NLS: toolsResources.json

Basemap-Labels für Legacy-Buttons (Framework `basisMapsSwitch: "mapButtons"`):

```json
{
    "btnMaps_av_sw": "AV grau",
    "btnMaps_av_f": "AV farbig",
    "btnMaps_osm": "OSM++ Alpen",
    "btnMaps_ch_osm": "OSM++ Schweiz"
}
```

> **Hinweis**: Das TNET-Widget verwendet eigene Labels direkt im HTML (`basemap-card-label`) und nicht mehr `toolsResources.json`. Die `btnMaps_*`-Einträge werden nur noch vom Legacy-Framework-Button-Switcher gebraucht.

---

## TNET: Basemap-Widget

> 🔧 **TNET-Erweiterung** — Eigenes Kachelbasiertes Basemap-Auswahl-Widget statt Framework-Buttons.

### Widget-Aufbau (HTML-Struktur)

```
#basemap_selector            ← Trigger-Kachel (rechts unten, 100×80px)
#basemap_widget              ← Hauptpanel (slide-in)
  ├── .basemap-widget-header      "GRUNDKARTE" + Close-Button
  └── .basemap-widget-content
      ├── .basemap-layer-section   EIN/AUS-Toggles:
      │   ├── Höhenkurven
      │   ├── Projektebene
      │   ├── Gemeindegrenzen
      │   ├── Farbig/Grau
      │   └── Transparenz-Slider
      ├── #basemap-time-container  Zeitreise-Slider (dynamisch)
      ├── #basemap-time-info       Info-Label
      └── .basemap-cards-scroll    Kachel-Grid (3 Spalten)
          ├── swissimage ⏱         (Default aktiv)
          ├── av_sw
          ├── plan_fuer_grundbuch_bund
          ├── pk_color ⏱
          ├── siegfried ⏱
          ├── dufour ⏱
          ├── swiss_tlm
          ├── osm_ch
          └── leer
```

> ⏱ = Basemaps mit Zeitreise-Funktion

### Kachel-Markup (Beispiel)

```html
<div class="basemap-card active"
     data-basemap="swissimage"
     data-has-timeslider="true">
    <img src="maps/tnet/resources/preview-swissimage.png">
    <div class="basemap-card-label">Luftbild</div>
</div>
```

### Relevante CSS (override.css / tnet_override_m.css)

- `.basemap-card` — Kachel mit Preview-Bild und Label
- `.basemap-card.active` — Aktive Karte, Rahmen farbig (`--m-color-primary`)
- `#basemap_widget` — Slide-in-Panel (Desktop: rechts, Mobile: Bottom-Sheet)
- `.basemap-time-slider` — Zeitreise-Slider

### API

| Funktion | Beschreibung |
|---|---|
| `toggleBasemapWidget()` | Panel öffnen/schliessen |

---

## TNET: Grundkarten-Layer-Sync

> 🔧 **TNET-Erweiterung** — Schaltet Overlay-Layer synchron mit der Basemap ein/aus.

### Mapping

```javascript
window.GRUNDKARTEN_LAYER_MAPPING = {
    'hoehenkurven': 'gis_basis/nw_basisplan_gis_dynamisch/hoehenlinien',
    'projektebene': 'gis_basis/nw_basisplan_gis_dynamisch/grundbuchplan_projektierte_objekte',
    'gemeindegrenzen': 'gis_basis/nw_basisplan_gis_dynamisch/gemeindegrenzen'
};
```

Diese Layer sind ArcGIS-Sublayer, die über Coalesce-Gruppen gesteuert werden. Die Buttons im Widget schalten die Layer per `setMapBookmark` ein/aus.

### Transparenz & Graustufen

| Control | Beschreibung |
|---|---|
| Transparenz-Slider | Opacity des Basemap-Layers (0–100%) |
| Farbig/Grau-Toggle | CSS-Filter `grayscale(1)` auf der Basemap |

---

## TNET: Zeitreise (TimeDimension)

> 🔧 **TNET-Erweiterung** — Historische Kartenversionen (swisstopo) mit animiertem Slider.

### Konfiguration in tnet-global-config.json5

```json5
basemaps: {
    timeDimension: {
        swissimage: {
            type: 'static',
            wmtsLayer: 'ch.swisstopo.swissimage-product',
            wmtsUrl: 'https://wmts.geo.admin.ch/.../default/{Time}/2056/{TileMatrix}/{TileCol}/{TileRow}.png',
            timestampFormat: 'YYYY',
            years: [1926, 1943, 1946, 1951, ..., 2024]
        },
        pk_color: {
            type: 'dynamic',
            wmtsLayer: 'ch.swisstopo.zeitreihen',
            wmtsUrl: 'https://wmts.geo.admin.ch/.../default/{Time}/2056/...',
            timestampFormat: 'YYYYMMDD',
            identifyUrl: 'https://api3.geo.admin.ch/rest/services/api/MapServer/identify',
            fallbackYears: [1864, 1880, ..., 2020],
            moveEndDebounce: 500
        },
        siegfried: {
            type: 'static',
            wmtsLayer: 'ch.swisstopo.hiks-siegfried',
            timestampFormat: 'YYYY',
            years: [1870, 1871, ..., 1949]
        },
        dufour: {
            type: 'static',
            wmtsLayer: 'ch.swisstopo.hiks-dufour',
            years: ['current']
        }
    }
}
```

### TimeDimension-Typen

| Typ | Verhalten | Slider | Beispiel |
|---|---|---|---|
| `static` | Feste Jahrgangs-Liste | ✅ (fixe Stufen) | swissimage, siegfried |
| `dynamic` | Jahre per swisstopo Identify API dynamisch | ✅ (aktualisiert) | pk_color |
| *Spezialfall* | `years: ['current']` → kein Slider | — | dufour |

### Property-Referenz (TimeDimension-Eintrag)

| Property | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `type` | string | ✅ | `'static'` oder `'dynamic'` |
| `wmtsLayer` | string | ✅ | swisstopo WMTS-Layer-Name |
| `wmtsUrl` | string | ✅ | URL-Template mit `{Time}`, `{TileMatrix}`, `{TileCol}`, `{TileRow}` |
| `timestampFormat` | string | ✅ | `'YYYY'` oder `'YYYYMMDD'` |
| `years` | array | ✅ (static) | Liste der Jahrgänge oder `['current']` |
| `identifyUrl` | string | ✅ (dynamic) | swisstopo Identify API-URL |
| `fallbackYears` | array | — (dynamic) | Fallback-Jahrgänge wenn API nicht verfügbar |
| `moveEndDebounce` | number | — (dynamic) | Debounce in ms für `moveend`-Events |
| `fallbackBasemap` | string | — | Framework-Basemap-ID für virtuelle Basemaps |

### BasemapTimeManager-Objekt

Wird auf `window.BasemapTimeManager` exportiert.

| Methode | Beschreibung |
|---|---|
| `onBasemapChange(basemapId)` | Prüft ob Basemap eine TimeDimension hat, zeigt/versteckt Slider |
| `removeTimeOverlay()` | Entfernt aktuelles Zeitreise-WMTS-Overlay |
| `updateSlider(years)` | Aktualisiert Slider-Werte (dynamisch) |
| `setYear(year)` | Setzt ein bestimmtes Jahr und aktualisiert WMTS-Overlay |

### Flow beim Basemap-Wechsel

```
1. User klickt Basemap-Kachel (z.B. "Landeskarte")
2. removeTimeOverlay()               — altes Overlay entfernen
3. fallbackBasemap prüfen            — ggf. andere Framework-Basemap aktivieren
4. _preTimeChangeBaseMap(id)         — Framework wechselt Basemap
5. 200ms Delay
6. onBasemapChange(basemapId)        — TimeDimension-Config laden
7. Falls vorhanden:
   a) Slider einblenden
   b) WMTS-Overlay erstellen (aktuellstes Jahr)
   c) Falls dynamic: Identify-API abfragen → Slider aktualisieren
```

### CustomEvent: basemap-time-change

Bei Jahrgangs-Wechsel wird ein CustomEvent dispatched:

```javascript
document.dispatchEvent(new CustomEvent('basemap-time-change', {
    detail: { basemapId: 'pk_color', year: '19561231' }
}));
```

Dieses Event wird vom SplitScreen abgehört, um die zweite Karte zu synchronisieren.

---

## TNET: SplitScreen-Sync

> 🔧 **TNET-Erweiterung** — Bei aktivem SplitScreen wird die Basemap in die zweite Karte gespiegelt.

### Ablauf

1. Basemaps-Config per PHP-API laden (`/maps/tnet/php/basemaps-to-json.php`)
2. Aktive Basemap erkennen (URL → DOM → Default `swissimage`)
3. Basemap in `map2` als WMTS/WMS/multisource erstellen
4. `changeBaseMap`-Hook für Basemap-Sync registrieren
5. `basemap-time-change`-Event für TimeDimension-Sync registrieren

---

## URL-Parameter

| Parameter | Beschreibung | Beispiel |
|---|---|---|
| `basemap=<id>` | Basemap beim Laden forcieren | `?basemap=swisstopo_lk` |

Wird von `applyBasemapFromUrl()` in `tnet-basemap.js` ausgewertet.

---

## Deployment

Upload über das Spezialskript `_scripts/_upload_basemap_js.py`:

| Datei | Remote-Pfad |
|---|---|
| `public/css/override.css` | `/www/maps/public/css/override.css` |
| `public/index_de.htm` | `/www/maps/public/index_de.htm` |
| `public/config/basemaps_mgr.conf` | `/www/maps/public/config/basemaps_mgr.conf` |
| `tnet/js/tnet-basemap.js` | `/www/maps/tnet/js/tnet-basemap.js` |
| `tnet/config/tnet-global-config.json5` | `/www/maps/tnet/config/tnet-global-config.json5` |
| `core/config/basemaps.conf` | `/www/core/config/basemaps.conf` |
| `tnet/resources/preview-*.png` | `/www/maps/tnet/resources/preview-*.png` |

### Preview-Bilder

6 PNG-Vorschaubilder für Basemap-Kacheln:

| Datei | Basemap |
|---|---|
| `preview-swissimage.png` | Luftbild |
| `preview-landeskarte.png` | Landeskarte |
| `preview-siegfried.png` | Siegfriedkarte |
| `preview-dufour.png` | Dufourkarte |
| `preview-osm.png` | OpenStreetMap |
| `preview-swisstlm.png` | swisstopo TLM |
