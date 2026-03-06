# 1 — Layer-Konfiguration

> **Datei**: `layers.conf` (+ `layers_*.conf` für aufgeteilte Dienste)  
> **Verzeichnis**: `public/config/` (Profil) oder `core/config/` (Mandant)  
> **Format**: JSON  
> **Tydac-Doku**: https://cloud.mapplus.ch/mapplusv4_doku/de:layer

---

## Inhaltsverzeichnis

- [Überblick](#überblick)
- [Unterstützte Layer-Typen](#unterstützte-layer-typen)
- [WMS-Layer](#wms-layer)
- [WMTS-Layer](#wmts-layer)
- [ArcGIS REST-Layer](#arcgis-rest-layer)
- [Spezielle Layer-Typen](#spezielle-layer-typen)
- [Property-Referenz (komplett)](#property-referenz-komplett)
- [Listen direkt öffnen](#listen-direkt-öffnen)
- [Vorkonfigurierte Pakete (TYDAC)](#vorkonfigurierte-pakete-tydac)
- [Dateinamen-Konventionen](#dateinamen-konventionen)
- [Layer-Key-Konventionen](#layer-key-konventionen)
- [Coalesce-System (Überblick)](#coalesce-system-überblick)

---

## Überblick

Layer werden in `layers.conf` als JSON-Objekt definiert. Jeder Schlüssel ist ein **Layer-Key**, der in `lyrmgr.conf` (Baumstruktur), `maptips.conf` (Info-Abfragen) und `lyrmgrResources.json` (Anzeigename) referenziert wird.

```json
{
    "<layer_key>": {
        "type": "WMS",
        "url": "https://...",
        "params": { ... },
        "options": { ... },
        ...
    },
    "<layer_key_2>": { ... }
}
```

Pro Mandant können mehrere `layers_*.conf`-Dateien existieren. Sie werden beim Laden automatisch zusammengeführt (Merge).

→ Siehe [Layermanager](02-layermanager.md) für die Baumstruktur  
→ Siehe [NLS](04-nls.md) für die Anzeigenamen (`desc_<layer_key>`)

---

## Unterstützte Layer-Typen

| Typ | `type`-Wert | Beschreibung |
|---|---|---|
| **WMS** | `"WMS"` | Web Mapping Service — Einzelbilder oder Kacheln vom Server |
| **WMTS** | `"WMTS"` | Web Map Tile Service — vorgenerierte Kacheln |
| **ArcGIS REST** | `"arcgisRest"` | 🔧 ArcGIS MapServer REST-API |
| **GeoJSON** | `"geoJSON"` | Vektordaten als GeoJSON |
| **WebCams** | `"WCTravel"` | Webcam-Standorte |
| **Wikipedia** | `"Wikipedia"` | Wikipedia-Einträge als POI |

---

## WMS-Layer

Web Mapping Services sind der Standard-Layer-Typ in MAP+.

### Beispiel

```json
"plz_borders": {
    "params": {
        "layers": "plz",
        "format": "image/png",
        "transparent": true
    },
    "icon": "../core/symbolsets/mapplus/svg/layers.svg",
    "icon_style": "width:18px;height:18px",
    "type": "WMS",
    "url": "https://www.mapplus.ch/cgi-bin/mapserv?map=/data/.../boundaries.map&",
    "visible": 0,
    "minResolution": 0,
    "maxResolution": 160,
    "rank": 2,
    "options": {
        "isBaseLayer": false,
        "singleTile": true,
        "opacity": 1
    }
}
```

### WMS-spezifische `params`

| Property | Typ | Beschreibung |
|---|---|---|
| `layers` | `string` | WMS-Layer-Name (kommaseparierte Liste für Gruppen) |
| `format` | `string` | Bildformat: `"image/png"`, `"image/jpeg"` |
| `transparent` | `boolean` | Transparenter Hintergrund |
| `srs` | `string` | Koordinatensystem, z.B. `"EPSG:2056"` |

### WMS-spezifische `options`

| Property | Typ | Default | Beschreibung |
|---|---|---|---|
| `singleTile` | `boolean` | `false` | `true` = ein Einzelbild, `false` = Kacheln. **Empfohlen: `true`** für Overlay-Layer |
| `ratio` | `number` | `1.5` | Verhältnis Kachelgrösse zu Kartengrösse (nur bei `singleTile: true`) |
| `opacity` | `number` | `1` | Deckkraft (0.0–1.0) |
| `isBaseLayer` | `boolean` | `false` | Immer `false` für Overlay-Layer |
| `projection` | `string` | — | Projektion in EPSG (falls abweichend) |
| `units` | `string` | — | Einheiten (z.B. `"m"`) |
| `transitionEffect` | `string` | `"resize"` | `"resize"` = Vergrössern beim Zoomen, `null` = Ausblenden |

---

## WMTS-Layer

WMTS-Layer nutzen die WMTSCapabilities-URL für automatische Konfiguration.

### Beispiel

```json
"swisstopo_lk": {
    "legend": "swisstopo_lk",
    "icon": "../core/symbolsets/mapplus/svg/layers.svg",
    "icon_style": "width:18px;height:18px",
    "type": "WMTS",
    "urlcapabilities": "https://wmts.geo.admin.ch/EPSG/2056/1.0.0/WMTSCapabilities.xml",
    "visible": 0,
    "minResolution": 0.2,
    "rank": 2,
    "params": {
        "layer": "ch.swisstopo.pixelkarte-farbe"
    },
    "options": {
        "projection": "EPSG:2056",
        "isBaseLayer": false,
        "opacity": 1.0
    }
}
```

### WMTS-spezifische Properties

| Property | Typ | Beschreibung |
|---|---|---|
| `urlcapabilities` | `string` | URL zur WMTSCapabilities.xml |
| `params.layer` | `string` | WMTS-Layer-Identifier |
| `params.Time` | `string` | Optional: Zeitstempel für Zeitreihen (z.B. `"2009"`) |

→ Siehe [Basiskarten](05-basemaps.md) und [swisstopo-Integration](05-basemaps.md#swisstopo-integration) für WMTS als Basiskarte

---

## ArcGIS REST-Layer

> 🔧 **TNET-Erweiterung** — ArcGIS REST-Layer werden für die kantonalen Fachdienste (NW, OW) verwendet. Der Typ `"arcgisRest"` ist eine Erweiterung des Standard-Frameworks.

### Beispiel

```json
"gis_oereb/nw_nutzungsplanung_def/grundnutzung": {
    "icon": "../core/symbolsets/mapplus/lyrmgr/lyr_layers_info.svg",
    "type": "arcgisRest",
    "rank": 1,
    "minResolution": 0,
    "maxResolution": 250,
    "visible": 0,
    "searchable": 1,
    "url": "https://maps.nw.ch/arcgis/rest/services/OEREB/NW_Nutzungsplanung_def/MapServer",
    "params": {
        "LAYERS": "show:0",
        "DPI": 180
    },
    "options": {
        "projection": "EPSG:2056",
        "isBaseLayer": false,
        "singleTile": true,
        "opacity": 0.6
    },
    "legend": "gis_oereb/nw_nutzungsplanung_def"
}
```

### ArcGIS-spezifische `params`

| Property | Typ | Beschreibung |
|---|---|---|
| `LAYERS` | `string` | Sichtbare Sublayer im Format `"show:0"`, `"show:0,1,3"` |
| `DPI` | `number` | Server-DPI (typisch: `180`) |

### Hierarchische Layer-Keys

> 🔧 **TNET-Konvention** — ArcGIS-Layer verwenden hierarchische Keys mit `/`-Trennung:
>
> `<domain>/<service>/<group>/<sublayer>`  
> z.B. `gis_oereb/nw_nutzungsplanung_def/grundnutzung`

Die Hierarchie spiegelt die ArcGIS-MapServer-Struktur wider und ermöglicht das **Coalesce-System** (→ siehe [unten](#coalesce-system-überblick) und [Layermanager](02-layermanager.md#coalesce-bridge)).

---

## Spezielle Layer-Typen

### GeoJSON

```json
"wanderwege": {
    "type": "geoJSON",
    "url": "data/wanderwege.geojson",
    "visible": 0,
    "options": {
        "projection": "EPSG:2056"
    }
}
```

### WebCams / Wikipedia

Diese Spezialtypen werden hier nicht behandelt — sie sind MAP+-intern definiert und selten konfiguriert.

---

## Property-Referenz (komplett)

### Root-Properties eines Layer-Eintrags

| Property | Typ | Pflicht | Default | Beschreibung |
|---|---|---|---|---|
| `type` | `string` | ✅ | — | Layer-Typ: `"WMS"`, `"WMTS"`, `"arcgisRest"`, `"geoJSON"` |
| `url` | `string` | ✅ | — | Service-URL |
| `visible` | `number` | — | `0` | Sichtbar bei Start: `0` = aus, `1` = ein |
| `rank` | `number` | — | `1` | Darstellungs-Priorität (höher = weiter oben). Bei gleichem Rank bestimmt die Einschalt-Reihenfolge |
| `minResolution` | `number` | — | `0` | Minimale Auflösung für die Anzeige (= max. Zoomstufe) |
| `maxResolution` | `number` | — | `∞` | Maximale Auflösung für die Anzeige (= min. Zoomstufe) |
| `icon` | `string` | — | — | Icon-Pfad für Layermanager-Darstellung (SVG oder PNG) |
| `icon_style` | `string` | — | — | CSS-Inline-Styles für Icon, z.B. `"width:18px;height:18px"` |
| `legend` | `string` | — | — | Legenden-Key → verweist auf `legendResources.json` (`<legend>_title`, `<legend>_link`) |
| `searchable` | `number` | — | `0` | Durchsuchbar für Info-Abfragen: `0` = nein, `1` = ja |
| `attr_editable` | `number` | — | `0` | Editierbar: `0` = nein, `1` = ja |
| `params` | `object` | ✅ | — | Parameter für den Kartendienst (typ-abhängig, → siehe oben) |
| `options` | `object` | — | — | OpenLayers-Layer-Optionen (→ siehe oben) |
| `urlcapabilities` | `string` | — | — | Nur WMTS: URL zur WMTSCapabilities.xml |
| `open_list` | `object` | — | — | DB-Liste direkt öffnen (→ siehe [unten](#listen-direkt-öffnen)) |

### `params`-Properties (zusammengefasst)

| Property | Gültig für | Typ | Beschreibung |
|---|---|---|---|
| `layers` | WMS | `string` | WMS-Layer-Name(n), kommasepariert |
| `layer` | WMTS | `string` | WMTS-Layer-Identifier |
| `LAYERS` | arcgisRest | `string` | 🔧 Sublayer-Sichtbarkeit: `"show:0,1,3"` |
| `DPI` | arcgisRest | `number` | 🔧 Server-DPI |
| `format` | WMS | `string` | Bildformat (`"image/png"`, `"image/jpeg"`) |
| `transparent` | WMS | `boolean` | Transparenter Hintergrund |
| `srs` | WMS | `string` | Koordinatensystem |
| `Time` | WMTS | `string` | Zeitstempel für Zeitreihen |

### `options`-Properties (zusammengefasst)

| Property | Typ | Default | Beschreibung |
|---|---|---|---|
| `isBaseLayer` | `boolean` | `false` | Basislayer (Overlay immer `false`) |
| `singleTile` | `boolean` | `false` | Einzelbild statt Kacheln |
| `opacity` | `number` | `1` | Deckkraft (0.0–1.0) |
| `projection` | `string` | — | EPSG-Code |
| `ratio` | `number` | `1.5` | Kachel/Karten-Verhältnis (nur `singleTile: true`) |
| `units` | `string` | — | Masseinheit |
| `transitionEffect` | `string` | `"resize"` | Zoom-Übergangseffekt |
| `sphericalMercator` | `boolean` | `false` | Spherical Mercator Projektion (nur TMS, Google etc.) |

---

## Listen direkt öffnen

Layer können eine DB-Liste (Tabelle) direkt aus dem Layermanager öffnen:

```json
"bauzonen_unueberbaut": {
    "type": "WMS",
    "url": "/cgi-bin/mapserv?map=/data/Client_Data/demo/demo.map&",
    "params": { "layers": "bauzonen_unueberbaut_group", ... },
    "options": { ... },
    "open_list": {
        "form": "bauzonen_unueberbaut"
    }
}
```

| Property | Typ | Beschreibung |
|---|---|---|
| `open_list.form` | `string` | Name des Formulars / der Liste |

---

## Vorkonfigurierte Pakete (TYDAC)

TYDAC stellt MAP+-Pro-Kunden folgende Pakete zur Verfügung (inkl. MapTips und Legenden):

| Paket | Quelle | Beschreibung |
|---|---|---|
| `mapplus` | [mapplus.ch](https://www.mapplus.ch) | Eigene TYDAC-Layer |
| `nodi` | [nodi.mapplus.ch](https://nodi.mapplus.ch) | Schweizer Geodaten (Kantone, AV, etc.) |
| `geoadmin` | [geo.admin.ch](https://geo.admin.ch) | Bundeslayer (swisstopo, ARE, BAFU etc.) |
| `bern` | [be.mapplus.ch](https://be.mapplus.ch) | Kanton Bern |
| `gr` | [geogr.mapplus.ch](http://geogr.mapplus.ch) | Kanton Graubünden |

---

## Dateinamen-Konventionen

### Standard (TYDAC)

- **Einfach**: `layers.conf` — eine Datei pro Profil
- **Aufgeteilt**: `layers_<quelle>.conf` — mehrere Dateien pro Mandant (Merge)

### TNET-spezifisch

> 🔧 **TNET-Konvention** — TNET verwendet eine systematische Benennung pro ArcGIS-Dienst:
>
> `layers_TNET_<kürzel>_<Service>.conf`

Beispiele:
- `layers_TNET_ewn_EWN_NIS_gwr.conf` — EW Nidwalden, GWR-Dienst
- `layers_TNET_nw_NW_OEREB.conf` — Kanton NW, ÖREB-Dienst
- `layers_nodi_ch.conf` — NODI-Schweiz-Layer
- `layers_geoadmin.conf` — Bundes-Layer

---

## Layer-Key-Konventionen

### Standard (flach)

NODI- und Geoadmin-Layer verwenden flache Keys:
```
gwr_address
ch.are.bauzonen
ch.swisstopo.pixelkarte-farbe
```

### TNET (hierarchisch)

> 🔧 **TNET-Konvention** — ArcGIS-MapServer-Layer verwenden hierarchische Keys:
> ```
> <domain>/<service>/<group>/<sublayer>
> ```
>
> Beispiele:
> ```
> ewn/ewn_nis_gwr/gwr/egid
> gis_oereb/nw_nutzungsplanung_def/grundnutzung
> gis_oereb/nw_nutzungsplanung_def/ueberlagernde_festlegung
> ```
>
> Die Hierarchie ermöglicht:
> - Gruppierung im Layermanager (verschachtelte TitlePanes)
> - Coalesce-System (Sublayer über einen Root-Dienst)
> - Eindeutige Zuordnung zu ArcGIS-MapServer-Sublayer-IDs

---

## Coalesce-System (Überblick)

> 🔧 **TNET-Erweiterung** — Das Coalesce-System bündelt mehrere ArcGIS-Sublayer über einen einzigen OpenLayers-Layer.

### Problem

Im Standard-Framework erstellt jeder `switchLayer()`-Aufruf einen neuen OL-Layer. Bei ArcGIS-Diensten mit 10+ Sublayern führt das zu:
- 10+ HTTP-Requests statt einem
- Fehlende MapTip-Zuordnung (Sublayer → OL-Layer)
- Bookmark/URL-State-Probleme

### Lösung: Coalesce-Bridge

```
Ohne Coalesce:           Mit Coalesce:
┌──────────┐             ┌──────────┐
│Sublayer 0│→ OL-Layer   │Sublayer 0│─┐
├──────────┤             ├──────────┤ │  ┌────────────────┐
│Sublayer 1│→ OL-Layer   │Sublayer 1│─┼──│ 1 OL-Layer     │
├──────────┤             ├──────────┤ │  │ LAYERS=show:0,1,3
│Sublayer 3│→ OL-Layer   │Sublayer 3│─┘  └────────────────┘
└──────────┘             └──────────┘
3 Requests               1 Request
```

→ Detaillierte Beschreibung: [Layermanager → Coalesce-Bridge](02-layermanager.md#coalesce-bridge)

---

## Beispiel: Vollständiger Layer-Eintrag

### WMS (Standard)

```json
"naturschutzgebiete": {
    "legend": "naturschutzgebiete",
    "params": {
        "layers": "naturschutzgebiete",
        "format": "image/png",
        "srs": "EPSG:2056",
        "transparent": true
    },
    "icon": "../core/symbolsets/mapplus/svg/layers_info.svg",
    "icon_style": "width:18px;height:18px",
    "type": "WMS",
    "url": "https://nodi.mapplus.ch/cgi-bin/mapserv?map=/data/env.map&",
    "visible": 0,
    "searchable": 1,
    "minResolution": 0,
    "maxResolution": 160,
    "rank": 2,
    "options": {
        "projection": "EPSG:2056",
        "isBaseLayer": false,
        "singleTile": true,
        "opacity": 0.75
    }
}
```

### ArcGIS REST (TNET)

```json
"gis_oereb/nw_gewaesserraum_def/gewaesserraum": {
    "icon": "../core/symbolsets/mapplus/lyrmgr/lyr_layers_info.svg",
    "type": "arcgisRest",
    "rank": 1,
    "minResolution": 0,
    "maxResolution": 250,
    "visible": 0,
    "searchable": 1,
    "url": "https://maps.nw.ch/arcgis/rest/services/OEREB/NW_Gewaesserraum_def/MapServer",
    "params": {
        "LAYERS": "show:0",
        "DPI": 180
    },
    "options": {
        "projection": "EPSG:2056",
        "isBaseLayer": false,
        "singleTile": true,
        "opacity": 0.6
    },
    "legend": "gis_oereb/nw_gewaesserraum_def"
}
```

### WMTS (swisstopo)

```json
"swissimage": {
    "legend": "swissimage",
    "icon": "../core/symbolsets/mapplus/svg/layers_info.svg",
    "icon_style": "width:18px;height:18px",
    "type": "WMTS",
    "urlcapabilities": "https://wmts.geo.admin.ch/EPSG/2056/1.0.0/WMTSCapabilities.xml",
    "visible": 0,
    "minResolution": 0.2,
    "rank": 2,
    "params": {
        "layer": "ch.swisstopo.swissimage"
    },
    "options": {
        "projection": "EPSG:2056",
        "isBaseLayer": false,
        "opacity": 1.0
    }
}
```
