# 3 — Informationsabfragen (MapTips)

> **Datei**: `maptips.conf` (+ `maptips_*.conf` für aufgeteilte Dienste)  
> **Verzeichnis**: `core/config/` (Mandant) oder `public/config/` (Profil)  
> **Format**: JSON  
> **Tydac-Doku**: https://cloud.mapplus.ch/mapplusv4_doku/de:maptips

---

## Inhaltsverzeichnis

- [Überblick](#überblick)
- [Generelle Einstellungen](#generelle-einstellungen)
- [WMS-Abfragen](#wms-abfragen)
- [ArcGIS REST-Abfragen](#arcgis-rest-abfragen)
- [Abfragen auf Basiskarten](#abfragen-auf-basiskarten)
- [Abfragen auf andere Layer](#abfragen-auf-andere-layer)
- [Feldformatierung](#feldformatierung)
- [Lookups (Domains)](#lookups-domains)
- [Tabs (Mehrere Register)](#tabs-mehrere-register)
- [Titel und Abschnitte](#titel-und-abschnitte)
- [Relationen (1:n)](#relationen-1n)
- [Verschneidungen (Overlays)](#verschneidungen-overlays)
- [Highlight-Funktion](#highlight-funktion)
- [Formulare und Reports](#formulare-und-reports)
- [Layer-Alias](#layer-alias)
- [Property-Referenz (komplett)](#property-referenz-komplett)
- [TNET: Coalesce-MapTip-Integration](#tnet-coalesce-maptip-integration)
- [TNET: Info-Panel-Erweiterungen](#tnet-info-panel-erweiterungen)
- [Dateinamen-Konventionen](#dateinamen-konventionen)

---

## Überblick

Informationsabfragen (MapTips) werden ausgelöst, wenn der Benutzer auf ein Kartenobjekt klickt. Die Konfiguration in `maptips.conf` definiert für jeden abfragbaren Layer:

- **Welcher Dienst** abgefragt wird (WMS GetFeatureInfo, ArcGIS REST Identify)
- **Welche Felder** zurückgegeben werden
- **Wie die Resultate** dargestellt werden (Titel, Feldnamen, Formatierung)
- **Ob und wie** Objekte hervorgehoben werden (Highlight)

```
Klick auf Karte
      ↓
maptips.conf prüft: Welcher Layer ist aktiv?
      ↓
linked_layer → Layer aus layers.conf
      ↓
query_layers → Abfrage an den Kartendienst
      ↓
Resultat → Darstellung im Info-Panel
      ↓
nls → Titel/Feldnamen aus maptipsResources.json
```

→ Siehe [NLS](04-nls.md) für die Textdefinitionen  
→ Siehe [Layer-Konfiguration](01-layers.md) für `layers.conf`

---

## Generelle Einstellungen

Optionale globale Einstellungen für alle MapTips:

```json
"general_settings": {
    "start_x": 360,
    "start_y": 130,
    "start_w": 600,
    "start_h": 360,
    "proxy": "/mapplus-lib/.../proxy.php?proxy_url=",
    "permanent_highlight": true,
    "infoboxesOnlyFirstItemOpen": true
}
```

| Property | Typ | Default | Beschreibung |
|---|---|---|---|
| `start_x` | `number` | — | X-Position des Info-Dialogs (Pixel) |
| `start_y` | `number` | — | Y-Position des Info-Dialogs (Pixel) |
| `start_w` | `number` | — | Breite des Info-Dialogs (Pixel) |
| `start_h` | `number` | — | Höhe des Info-Dialogs (Pixel) |
| `proxy` | `string` | — | Proxy-URL (nicht verändern) |
| `permanent_highlight` | `boolean` | `true` | `true` = Highlight immer sichtbar, `false` = nur bei Mouse-over auf Info |

### Verhalten bei Mehrfachtreffern

Genau **eine** der folgenden Optionen verwenden:

| Property | Beschreibung |
|---|---|
| `infoboxesOnlyFirstItemOpen` | Nur erste Info aufgeklappt (empfohlen) |
| `infoboxesAlwaysOpen` | Alle Infos aufgeklappt |
| `infoboxesAlwaysClosed` | Alle Infos zugeklappt |

---

## WMS-Abfragen

### Beispiel (vollständig)

```json
"kbs": {
    "type": "wmsServiceMapTip",
    "idmap": "main",
    "nls": "kbs",
    "linked_layer": "kbs",
    "query_layers": "kbs",
    "key_attr": "oid",
    "show_empty_fields": false,
    "qryFields": ["STA_NR", "STA_NAME", "ART_NR", "GEMEINDEN", "STATUS", "FLAECHE", "VOLUMEN"],
    "qryFieldsFormat": [null, null, null, null, null, "num(0|,|')", "num(0|,|')"],
    "qryFieldsNullVal": ["0", "0", "0", "0", "0", "0", "0"],
    "fldLookup": {
        "2": {
            "filterlang": true,
            "items": {
                "de": {
                    "1": "Ablagerungsstandort",
                    "2": "Betriebsstandort"
                },
                "fr": {
                    "1": "Site de stockage",
                    "2": "Aire d'exploitation"
                }
            }
        }
    },
    "highlight_geom_proj": "EPSG:2056",
    "highlight_style": {
        "fillColor": "#FFFF00",
        "fillOpacity": 0.5,
        "strokeColor": "#FFFF00",
        "strokeWidth": 5,
        "strokeOpacity": 0.5,
        "pointRadius": 15
    }
}
```

### Erläuterung der Properties

| Property | Beschreibung |
|---|---|
| `type` | Immer `"wmsServiceMapTip"` |
| `idmap` | Ziel-Karte, immer `"main"` |
| `nls` | Präfix für Texte in `maptipsResources.json` (optional — sonst ist der MapTip-Key der Präfix) |
| `linked_layer` | Verweis auf Layer-Key in `layers.conf` |
| `query_layers` | WMS-Layer-Name für GetFeatureInfo (immer nur **ein** Layer, keine Gruppen) |
| `key_attr` | Primärschlüssel (nur bei editierbaren Layern) |
| `show_empty_fields` | `false` = leere Felder ausblenden (Standard) |
| `qryFields` | Abfragefelder (`["*"]` für alle) |
| `qryFieldsFormat` | Formatierung pro Feld (→ siehe [Feldformatierung](#feldformatierung)) |
| `qryFieldsNullVal` | Werte, die als NULL interpretiert werden |
| `fldLookup` | Domain-Lookups (→ siehe [Lookups](#lookups-domains)) |
| `highlight_*` | Highlight-Konfiguration (→ siehe [Highlight](#highlight-funktion)) |

> **Wichtig — WMS-Layer-Namenskonventionen**: Die Übergabe erfolgt in XML. Daher:
> - Namen müssen mit Buchstabe oder `_` beginnen (keine Zahlen!)
> - Namen sind case-sensitive
> - Keine Leerzeichen erlaubt
> - Nicht mit `XML` beginnen

---

## ArcGIS REST-Abfragen

> 🔧 **TNET-Erweiterung** — ArcGIS REST-Abfragen verwenden den `querytype: "esrigeojson"` und numerische Sublayer-IDs.

### Beispiel

```json
"gis_oereb/nw_gewaesserraum_def/gewaesserraum_grundnutzung_0": {
    "type": "wmsServiceMapTip",
    "idmap": "main",
    "nls": "nw_gewaesserraum",
    "linked_layer": "gis_oereb/nw_gewaesserraum_def/gewaesserraum",
    "query_layers": "0",
    "querytype": "esrigeojson",
    "enabled": true,
    "show_empty_fields": false,
    "qryFields": ["OBJECTID", "xtf_id", "planmassstab", "zustaendigestelle"],
    "highlight_geom_proj": "EPSG:2056",
    "highlight_style": {
        "fillColor": "#ffff00",
        "fillOpacity": 0.5,
        "strokeColor": "#ffff00",
        "strokeWidth": 10,
        "strokeOpacity": 0.5,
        "pointRadius": 15
    }
}
```

### TNET-spezifische Properties

| Property | Typ | Beschreibung |
|---|---|---|
| `querytype` | `string` | `"esrigeojson"` für ArcGIS REST Identify |
| `query_layers` | `string` | Numerische Sublayer-ID: `"0"`, `"0,1"` |
| `enabled` | `boolean` | MapTip aktiviert (Standard: implizit `true`) |

### MapTip-Key-Konventionen (TNET)

> 🔧 **TNET-Konvention**:
> ```
> <root-service>/<sublayer>_<queryLayerNum>
> ```
> Beispiel: `gis_oereb/nw_gewaesserraum_def/gewaesserraum_grundnutzung_0`
>
> Bei Gruppen-MapTips:
> ```
> ..._grp_<groupPath>
> ```
> Beispiel: `ewn/ewn_nis_gwr/gwr/egid_2_grp_ewn/ewn_nis_gwr/gwr`

---

## Abfragen auf Basiskarten

Abfragen auf Basiskarten (z.B. amtliche Vermessung) verwenden `linked_basemap` statt `linked_layer`:

```json
"av_grenzpunkte": {
    "type": "wmsServiceMapTip",
    "idmap": "main",
    "linked_layer": "",
    "linked_basemap": ["av_sw", "av_f"],
    "query_layers": "Grenzpunkte",
    "qryFields": ["x", "y", "punktzeichen"],
    "url": "https://nodi.mapplus.ch/cgi-bin/mapserv?map=/data/ms_av_sw.map&",
    "params": {
        "layers": "Grenzpunkte",
        "format": "image/png",
        "srs": "EPSG:2056",
        "transparent": true
    },
    "highlight_geom_proj": "EPSG:2056",
    "highlight_style": { ... },
    "maxResolution": 0.2
}
```

| Property | Beschreibung |
|---|---|
| `linked_basemap` | Array von Basemap-Keys — die Abfrage ist nur aktiv, wenn eine dieser Basiskarten gewählt ist |
| `linked_layer` | Leer lassen (`""`) |
| `url` | URL des WMS für die Abfrage (nicht die Basiskarte selbst) |
| `params` | WMS-Parameter für die Abfrage |

---

## Abfragen auf andere Layer

Man kann die Abfrage auf einem **anderen** Dienst durchführen als dem angezeigten Layer. Beispiel: Höhenkurven anzeigen, aber Höhenmodell abfragen:

```json
"contours": {
    "type": "wmsServiceMapTip",
    "idmap": "main",
    "linked_layer": "contours",
    "nls": "dtm",
    "query_layers": "dem_lidar_combined",
    "qryFields": ["value_0", "value_1", "value_2"],
    "qryFieldsFormat": ["num(1|.|')", "num(1|.|')", "num(1|.|')"],
    "url": "https://nodi.mapplus.ch/cgi-bin/mapserv?map=/data/ch_dems.map&",
    "params": {
        "layers": "dem_lidar_combined",
        "format": "image/png",
        "srs": "EPSG:2056",
        "transparent": true
    },
    "maxFeatures": 1
}
```

| Property | Beschreibung |
|---|---|
| `url` | URL des **abzufragenden** WMS (abweichend vom angezeigten Layer) |
| `params` | Parameter des abzufragenden WMS |
| `maxFeatures` | Max. Anzahl Treffer (bei Raster: `1` empfohlen, da auf Pixelecken bis zu 4 Treffer) |

---

## Feldformatierung

Die Property `qryFieldsFormat` erlaubt Formatierung pro Feld. Unterstützte Formate:

### `num(decimals|decimalpoint|separator)`

Zahlenformatierung:
- `decimals` — Dezimalstellen
- `decimalpoint` — Dezimaltrennzeichen
- `separator` — Tausender-Trennzeichen

```json
"qryFieldsFormat": ["num(0|,|')", "num(2|.|,)"]
// 1234567 → 1'234'567
// 1234.56 → 1,234.56
```

### `date(pattern)`

Datumsformatierung:
- `d.m.y` — Tag.Monat.Jahr (2-stellig)
- `d.m.Y` — Tag.Monat.Jahr (4-stellig)

```json
"qryFieldsFormat": ["date(d.m.Y)"]
```

### `concat(item1,item2,...)`

Zusammenfügen von Attributen und Text:

```json
"qryFieldsFormat": ["concat(ADDRESS,', ','PLZ:num(0|.|)',', ',LOCALITY)"]
```

- `neconcat(...)` — wie `concat`, aber leere Einträge ignorieren

### `add_url_format`

URLs in klickbare Links konvertieren:

```json
"qryFieldsFormat": ["add_url_format"]
```

### Sprachabhängige Attribute

Felder mit Sprachsuffix (z.B. `name_de`, `name_fr`) automatisch auswählen:

```json
"qryFields": ["name#lang#"]
// → wählt name_de, name_fr etc. je nach Browser-Sprache
```

Sprach-Fallback definieren:
```json
"qryFields": ["#lang:de,it#"]
// → de zuerst, it als Fallback
```

---

## Lookups (Domains)

Datenbank-Werte können in lesbare Texte übersetzt werden.

### Inline-Lookups

Direkt in `maptips.conf`:

```json
"fldLookup": {
    "2": {
        "filterlang": true,
        "items": {
            "de": {
                "1": "Ablagerungsstandort",
                "2": "Betriebsstandort"
            },
            "fr": {
                "1": "Site de stockage",
                "2": "Aire d'exploitation"
            }
        }
    }
}
```

- `"2"` = Index des Feldes in `qryFields` (0-basiert)
- `filterlang: true` = sprachabhängig

### JSON-Datei-Lookups

```json
"fldLookup": {
    "1": {
        "url": "./lookups/lookup_pisten_#lang#.json",
        "items": null
    }
}
```

- `#lang#` = wird durch Browser-Sprache ersetzt
- Eine Lookup-Datei kann Werte für mehrere Felder/Layer enthalten

### Datenbank-Lookups

```json
"fldLookup": {
    "7": {
        "url": "/mapplus-lib/.../getLookupList.php?action=getLookup",
        "table": "schema_x.mitarbeiter",
        "key": "id_person",
        "fkey": "id",
        "field": {
            "de": ["vorname, name"],
            "fr": ["vorname, name"]
        },
        "db": "name_database"
    }
}
```

### Thumbnail/Image Lookups

```json
"fldLookup": {
    "1": {
        "url": "/mapplus-lib/.../getThumbnailLookupList.php?action=getLookup&loc=/photos/",
        "table": "schema_x.neophyten",
        "fkey": "id_art",
        "field": {"de": "foto"},
        "db": "id_datenbank",
        "label": "name_deutsch"
    }
}
```

---

## Tabs (Mehrere Register)

Felder können auf mehrere Tabs verteilt werden:

```json
"unfealle": {
    "qryFields": ["sbs_code", "unfall_nr", "unfalldatum", "unfallzeit", ...],
    "qryFieldsTab": [1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3]
}
```

Tab-Texte in `maptipsResources.json`:
```json
{
    "unfealle_tab1": "&nbsp;Übersicht&nbsp;",
    "unfealle_tab2": "&nbsp;Details Unfallort&nbsp;"
}
```

---

## Titel und Abschnitte

In `qryFields` können Titel-Abschnitte eingefügt werden:

```json
"qryFields": [
    "title_ri",
    "bauherr",
    "bauherr_kontakt",
    "title_anlage",
    "anlage_groesse"
]
```

Definition in `maptipsResources.json`:
```json
{
    "energie_solarplattform_field_title_ri": "<b>Realisierungs-Interesse</b>",
    "energie_solarplattform_field_title_anlage": "<b>Installierte Anlage</b>"
}
```

### Dynamischer Titel

Titel mit Feld-Werten aus dem Resultat ergänzen:
```json
{
    "viacount_title": "ViaCount-Messungen - #name#"
}
```

`#name#` wird durch den Wert des Feldes `name` ersetzt.

---

## Relationen (1:n)

Verknüpfte Tabellen (z.B. Liegenschaft → Eigentümer) über `qrySpecialsFields`:

```json
"av_liegenschaften": {
    "type": "wmsServiceMapTip",
    "idmap": "main",
    "linked_basemap": ["av", "av_f"],
    "query_layers": "Liegenschaften",
    "qryFields": ["nummer", "art", "gueltigkeit", "flaechenmass"],
    "qrySpecialsFields": [
        {
            "fields": ["nummer"],
            "cgi": "/mapplus-lib/.../getJoinedRecords.php?key=nummer&fkey=parzellen_nummer&keytype=char&fields=parzellen_nummer,name,vorname,adresse,plz,ort&table=eigentum&dbconn_id=owners",
            "tab": 2,
            "export": 1,
            "width": 800
        }
    ]
}
```

| Property | Beschreibung |
|---|---|
| `fields` | Schlüsselfeld(er) in der Haupttabelle |
| `cgi` | PHP-Script mit Parametern (Pfad abhängig von MAP+-Version) |
| `key` / `fkey` | Schlüsselfelder (Haupt- und Fremdtabelle) |
| `keytype` | `"char"` oder `"numeric"` |
| `table` | Verknüpfte Tabelle |
| `dbconn_id` | Datenbank-Verbindungs-ID |
| `tab` | Register-Nummer |
| `export` | CSV-Export erlaubt: `1` = ja |
| `width` | Tabellenbreite in Pixel |

---

## Verschneidungen (Overlays)

Live-Verschnitte (z.B. Parzelle × Zonenplan):

```json
"qrySpecialsFields": [
    {
        "fields": ["nummer"],
        "click_xy": true,
        "tab": 2,
        "cgi": "/mapplus-lib/.../getParcelZones.php?dbconn_id=bern_av&parcel_tbl=liegenschaften&zone_tbl=bodenbedeckung&zone_fld=art_beschreibung&geom_func=ST_CurveToLine",
        "width": 800
    }
]
```

| Property | Beschreibung |
|---|---|
| `click_xy` | Klickkoordinaten übergeben: `true` |
| `parcel_tbl` | Tabelle mit Grundstücken |
| `zone_tbl` | Tabelle zum Verschneiden (z.B. Bodenbedeckung, Zonenplan) |
| `zone_fld` | Anzuzeigende Spalte (z.B. Zonenart) |
| `geom_func` | PostGIS-Funktion (z.B. `ST_CurveToLine` für Bögenauflösung) |

---

## Highlight-Funktion

Abgefragte Objekte können auf der Karte hervorgehoben werden.

### Konfiguration

```json
"highlight_geom_proj": "EPSG:2056",
"highlight_style": {
    "fillColor": "#ffff00",
    "fillOpacity": 0.5,
    "strokeColor": "#ffff00",
    "strokeWidth": 10,
    "strokeOpacity": 0.5,
    "pointRadius": 15
}
```

### highlight_style Properties

| Property | Typ | Beschreibung |
|---|---|---|
| `fillColor` | `string` | Füllfarbe (Hex) |
| `fillOpacity` | `number` | Füll-Deckkraft (0.0–1.0) |
| `strokeColor` | `string` | Linien-/Randfarbe (Hex) |
| `strokeWidth` | `number` | Linienbreite (Pixel) |
| `strokeOpacity` | `number` | Linien-Deckkraft (0.0–1.0) |
| `pointRadius` | `number` | Punkt-Radius (Pixel) |
| `externalGraphic` | `string` | Icon-Pfad für Punkt-Highlight |

### Punkt-Highlight mit Grafik

```json
"highlight_style": {
    "externalGraphic": "../core/symbolsets/mapplus/png/farmacies.png",
    "pointRadius": 24
}
```

### Voraussetzungen

- **UMN MapServer WMS**: `gml_geometries` und `gml_geom_gml_type` in METADATA definieren
- **Geometrie-Typen**: point, multipoint, line, multiline, polygon, multipolygon
- **Optional**: Attribut `geom_json` mit GeoJSON-Geometrie (hat Priorität über WMS-Geometrie)
- **Bögen müssen aufgelöst werden** (GeoJSON unterstützt keine Bögen)

---

## Formulare und Reports

### Formular öffnen (`external_form`)

```json
"external_form": {
    "field": ["oid"],
    "target": "_pane",
    "url": "/mapplus-lib/.../forms/index.php?form=bauzonen_unueberbaut",
    "iconClass": "dijitEditorIconPen"
}
```

### Report-Link (`pdf_report`)

```json
"pdf_report": {
    "id_field": "xtf_id",
    "url": "/mapplus-lib/.../generatePDFreport.php?report=sk_messstelle&bl=av_sw&vl=aw_sk_messstelle&dpi=150&buffer=200"
}
```

| Parameter | Beschreibung |
|---|---|
| `id_field` | Primärschlüssel in Haupttabelle |
| `report` | Name des Reports |
| `bl` | Basemap in der Karte |
| `vl` | Layer(s) in der Karte (mehrere durch `|` separiert) |
| `buffer` | Puffer um Objekt (Meter) |

Text in NLS: `"general_pdf_report"`.

---

## Layer-Alias

Wenn der WMS-Server abweichende Layernamen zurückgibt (z.B. bei UMN MapServer GROUP vs. LAYER):

```json
"lkbe_wasser_flaechen": {
    "type": "wmsServiceMapTip",
    "linked_layer": "lkbe_wasser",
    "query_layers": "lk_wasser",
    "query_layers_alias": "lkflaeche_meta_wasser|lklinie_meta_abwasser|lkflaeche_meta_abwasser",
    "querytype": "getfeatureinfo",
    "enabled": true
}
```

| Property | Beschreibung |
|---|---|
| `query_layers_alias` | Alternative Layernamen, Pipe-separiert. Notwendig wenn der Server andere Namen zurückgibt als angefragt |

---

## Property-Referenz (komplett)

### Pflichtfelder

| Property | Typ | Beschreibung |
|---|---|---|
| `type` | `string` | Immer `"wmsServiceMapTip"` |
| `idmap` | `string` | Ziel-Karte: `"main"` |
| `linked_layer` | `string` | Verknüpfter Layer-Key aus `layers.conf` (leer bei Basemap-Abfragen) |

### Abfrage-Konfiguration

| Property | Typ | Default | Beschreibung |
|---|---|---|---|
| `query_layers` | `string` | — | WMS-Layer-Name oder 🔧 ArcGIS Sublayer-ID(s) |
| `querytype` | `string` | `"getfeatureinfo"` | 🔧 `"esrigeojson"` für ArcGIS REST |
| `qryFields` | `string[]` | `["*"]` | Abzufragende Felder |
| `qryFieldsFormat` | `(string\|null)[]` | — | Feldformatierung (→ siehe oben) |
| `qryFieldsNullVal` | `string[]` | — | Werte die als NULL gelten |
| `qryFieldsTab` | `number[]` | — | Tab-Zuordnung pro Feld |
| `show_empty_fields` | `boolean` | `false` | Leere Felder anzeigen |
| `maxFeatures` | `number` | — | Max. Anzahl Treffer |
| `maxResolution` | `number` | — | Max. Auflösung für diese Abfrage |
| `enabled` | `boolean` | `true` | 🔧 MapTip aktiviert/deaktiviert |

### Verknüpfungen

| Property | Typ | Beschreibung |
|---|---|---|
| `nls` | `string` | NLS-Präfix (→ `maptipsResources.json`). Optional — ohne: MapTip-Key als Präfix |
| `linked_basemap` | `string[]` | Basemap-Keys für Basiskarten-Abfragen |
| `query_layers_alias` | `string` | Alternative Layernamen (Pipe-separiert) |
| `key_attr` | `string` | Primärschlüssel (nur editierbare Layer) |

### Alternativer Dienst

| Property | Typ | Beschreibung |
|---|---|---|
| `url` | `string` | Abweichende Service-URL |
| `params` | `object` | Abweichende WMS-Parameter |

### Highlight

| Property | Typ | Beschreibung |
|---|---|---|
| `highlight_geom_proj` | `string` | Geometrie-Projektion, z.B. `"EPSG:2056"` |
| `highlight_style` | `object` | Highlight-Styling (→ siehe oben) |

### Lookups & Relationen

| Property | Typ | Beschreibung |
|---|---|---|
| `fldLookup` | `object` | Domain-Lookups (→ siehe oben) |
| `qrySpecialsFields` | `array` | Relationen und Verschneidungen (→ siehe oben) |

### Formulare & Reports

| Property | Typ | Beschreibung |
|---|---|---|
| `external_form` | `object` | Formular-Verlinkung |
| `pdf_report` | `object` | Report-Verlinkung |

---

## TNET: Coalesce-MapTip-Integration

> 🔧 **TNET-Erweiterung** — Die Coalesce-Bridge registriert MapTip-Callbacks für gebündelte Sublayer.

### Problem

Wenn mehrere Sublayer über einen einzigen OL-Layer laufen (Coalesce), muss das MapTip-System wissen, **welcher** Sublayer an einer bestimmten Stelle abgefragt werden soll.

### Lösung

Die `tnet-coalesce-bridge.js` patcht den MapTip-Mechanismus:

1. **lookupCallbacks** registrieren: Root-Service-URL wird für Sublayer-Keys eintragen
2. **QueryConnector-Patch**: Nur aktuell sichtbare Sublayer werden abgefragt
3. **`wmsActiveLyrs`-Manipulation**: Sublayer werden manuell in die aktive-Layer-Liste gepusht

### Konfiguration

Keine separate Konfiguration nötig — die Bridge arbeitet automatisch basierend auf der Layer-Hierarchie in `layers.conf` und `lyrmgr.conf`.

→ Siehe [Layermanager → Coalesce-Bridge](02-layermanager.md#tnet-coalesce-bridge) für Details

---

## TNET: Info-Panel-Erweiterungen

> 🔧 **TNET-Erweiterung** — Datei: `tnet/js/tnet-info-panel.js` (1831 Zeilen)

Das Standard-FloatingPane wird durch folgende Features erweitert:

| Feature | Beschreibung |
|---|---|
| **Clipboard-Button** | Tabelleninhalt in Zwischenablage kopieren |
| **Dock-Button** | Panel an der Seite andocken/lösen (Desktop) |
| **Close-Button** | Panel schliessen |
| **Resize** | Grössenanpassung ziehbar |
| **MutationObserver** | Überwacht DOM-Änderungen für dynamische Inhalte |
| **Breadcrumb** | Navigationspfad bei verschachtelten Ergebnissen |
| **Bottom-Sheet** | Mobile Darstellung (fixed, 50vh, Drag-Handle) |

### Mobile-spezifisch

- `picking = true` muss auf allen Maps gesetzt werden
- Bottom-Sheet statt FloatingPane
- Dock-Button ausgeblendet
- Drag-Handle für Resize

---

## Dateinamen-Konventionen

### Standard (TYDAC)

- `maptips.conf` — Einzeldatei pro Profil
- `maptips_<quelle>.conf` — Aufgeteilte Dateien (Merge)

### TNET-spezifisch

> 🔧 **TNET-Konvention**:
> ```
> maptips_TNET_<kürzel>_<Service>.conf
> ```
> Beispiele:
> - `maptips_TNET_nw_NW_OEREB.conf`
> - `maptips_tnet_oereb_multi.conf` (15'491 Zeilen — alle ÖREB-Multi-Dienst-Abfragen)
> - `maptips_geoadmin.conf`
> - `maptips_nodi_ch.conf`
