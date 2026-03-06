# 4 — NLS — Sprachressourcen (National Language Support)

> **Verzeichnis**: `core/nls/<sprache>/` (z.B. `core/nls/de/`)  
> **Format**: JSON  
> **Tydac-Doku**: https://cloud.mapplus.ch/mapplusv4_doku/de:nls

---

## Inhaltsverzeichnis

- [Überblick](#überblick)
- [Dateistruktur](#dateistruktur)
- [lyrmgrResources.json — Layer-Labels](#lyrmgrresourcesjson--layer-labels)
- [maptipsResources.json — Info-Panel-Texte](#maptipsresourcesjson--info-panel-texte)
- [legendResources.json — Legenden](#legendresourcesjson--legenden)
- [toolsResources.json — Werkzeuge & Basiskarten](#toolsresourcesjson--werkzeuge--basiskarten)
- [disclaimerResources.json — Copyrights & Tipps](#disclaimerresourcesjson--copyrights--tipps)
- [editingResources.json — Editier-Funktionen](#editingresourcesjson--editier-funktionen)
- [Generelle Pflichtfelder (maptipsResources)](#generelle-pflichtfelder-maptipsresources)
- [FK-Matrix: Wer verweist wohin?](#fk-matrix-wer-verweist-wohin)
- [TNET: Aufgeteilte Ressourcendateien](#tnet-aufgeteilte-ressourcendateien)
- [TNET: Import-Pipeline](#tnet-import-pipeline)

---

## Überblick

NLS (National Language Support) definiert alle Texte der Benutzeroberfläche. Die Sprache wird automatisch anhand der Browser-Einstellung gewählt (Default: Deutsch).

Unterstützte Elemente:
- Layer-Namen (Layermanager)
- Info-Abfrage-Texte (Titel, Feldnamen, Tabs, Fussnoten)
- Legenden-Titel und -Links
- Basiskarten-Namen
- Werkzeug-Labels
- Copyrights und Hinweise

### Verzeichnisstruktur

```
core/nls/
├── de/                          ← Deutsch (Default)
│   ├── lyrmgrResources.json
│   ├── maptipsResources.json
│   ├── legendResources.json
│   ├── toolsResources.json
│   ├── disclaimerResources.json
│   └── editingResources.json
├── en/                          ← Englisch
│   └── ...
├── fr/                          ← Französisch
│   └── ...
└── it/                          ← Italienisch
    └── ...
```

### Vererbung

Wie bei allen Konfigurationsdateien gilt die Kaskade:
```
core/nls (Mandant) → Profil: nls → Gruppe
```

Mehrfache Definitionen werden unterstützt: `lyrmgrResources.json` + `lyrmgrResources_ewn.json` + ... werden gemergt.

---

## Dateistruktur

| Datei | Schlüsselformat | Verwendung |
|---|---|---|
| `lyrmgrResources.json` | `desc_<layerKey>` | Layer-Labels im Layermanager |
| `maptipsResources.json` | `<nls>_title`, `<nls>_field_*`, `<nls>_tab*` | Info-Panel Texte |
| `legendResources.json` | `<key>_title`, `<key>_link` | Legenden-Titel und HTML/PDF-Links |
| `toolsResources.json` | `btnMaps_<basemapKey>`, diverse | Werkzeug-Labels, Basiskarten-Namen |
| `disclaimerResources.json` | `info_*_text`, `tip_*_text` | Copyright-Hinweise, Tipps |
| `editingResources.json` | diverse | Standard-Texte für Editier-Funktionen |

---

## lyrmgrResources.json — Layer-Labels

Definiert den **Anzeigenamen** jedes Layers, jeder Kategorie und jeder Layergruppe im Layermanager.

### Schlüsselformat

```
desc_<layerKey>
```

### Beispiel

```json
{
    "desc_grundlagen": "Grundlagendaten",
    "desc_oereb": "ÖREB-Kataster",
    "desc_gefahren": "Gefahrenkarten",
    "desc_gefahrengebiet_lawine": "Gefahrengebiet Lawine",
    "desc_gefahrengebiet_rutschung": "Gefahrengebiet Rutschung",
    "desc_gis_oereb/nw_nutzungsplanung_def": "Nutzungsplanung (def.)",
    "desc_gis_oereb/nw_nutzungsplanung_def/grundnutzung": "Grundnutzung"
}
```

> **Hinweis**: Wird kein `desc_`-Eintrag definiert, zeigt der Layermanager **undefined** an.

### Verwendung für

| Element | Key-Format | Beispiel |
|---|---|---|
| Kategorie | `desc_<kategorie_id>` | `desc_grundlagen` |
| Layergruppe | `desc_<gruppe_id>` | `desc_gefahren` |
| Layer | `desc_<layer_key>` | `desc_gefahrengebiet_lawine` |
| Sub-Gruppe | `desc_<name>` | `desc_gis_oereb/nw_nutzungsplanung_def` |

---

## maptipsResources.json — Info-Panel-Texte

Definiert Titel, Feldnamen, Tab-Labels und Fussnoten für die Info-Abfrage.

### Schlüsselformate

| Format | Beschreibung |
|---|---|
| `<nls>_title` | Titel des Info-Fensters |
| `<nls>_field_<feldname>` | Alias für ein Abfragefeld |
| `<nls>_tab<nummer>` | Tab-Label (bei Multi-Tab-Darstellung) |
| `<nls>_footnote` | Optionale Fussnote |
| `<nls>_layer_title` | Alternativer Layer-Titel |
| `<nls>_layer_field_<feldname>` | Alternativer Layer-Feldalias |

> **Hinweis**: `<nls>` ist der Wert der Property `nls` aus `maptips.conf`. Wenn `nls` nicht gesetzt ist, wird der MapTip-Key selbst als Präfix verwendet.

### Beispiel

```json
{
    "av_grenzpunkte_title": "Grenzpunkte",
    "av_grenzpunkte_field_x": "Y-Koordinate",
    "av_grenzpunkte_field_y": "X-Koordinate",
    "av_grenzpunkte_field_punktzeichen": "Punktzeichen"
}
```

### Titel mit Feldwerten

Der Titel kann dynamisch mit Feldwerten aus dem Abfrageresultat ergänzt werden:

```json
{
    "viacount_title": "ViaCount-Messungen - #name#"
}
```

`#name#` wird durch den Wert des Feldes `name` ersetzt.

### NLS-Sharing

Durch die `nls`-Property in `maptips.conf` können mehrere MapTips dieselben NLS-Einträge teilen:

```json
// maptips.conf
"sublayer_a_0": { "nls": "gemeinsamer_prefix", ... },
"sublayer_b_1": { "nls": "gemeinsamer_prefix", ... }

// maptipsResources.json
"gemeinsamer_prefix_title": "Gemeinsamer Titel",
"gemeinsamer_prefix_field_name": "Name"
```

---

## legendResources.json — Legenden

Definiert Legenden-Titel und Links zu Legenden-Inhalten.

### Schlüsselformate

| Format | Beschreibung |
|---|---|
| `<key>_title` | Legenden-Titel (Anzeigename) |
| `<key>_link` | URL zur Legende (HTML, PHP, PDF, WMS-GetLegendGraphic) |

### Beispiel

```json
{
    "unfaelle_title": "Strassenverkehrsunfälle",
    "unfaelle_link": "https://nodi.mapplus.ch/core/legends/unfaelle.htm",
    
    "lift_title": "Legende: Lift- und Bahnachsen",
    "lift_link": "cgi-bin/mapserv?map=/data/betrieb.map&LAYERS=lift&mode=legend"
}
```

### Unterstützte Legenden-Formate

| Format | Beispiel-URL |
|---|---|
| HTML | `core/legends/unfaelle.htm` |
| PHP | `core/legends/dynamic_legend.php` |
| PDF | `core/legends/plan.pdf` |
| WMS GetLegendGraphic | `...?SERVICE=WMS&REQUEST=GetLegendGraphic&LAYER=...` |
| UMN MapServer `mode=legend` | `...?map=...&LAYERS=lift&mode=legend` |

### Verknüpfung

Der `<key>` wird in `layers.conf` über die Property `legend` definiert:
```json
// layers.conf
"unfaelle": {
    "legend": "unfaelle",       // → legendResources: unfaelle_title, unfaelle_link
    ...
}
```

Oder in `lyrmgr.conf` auf Gruppen-Ebene:
```json
// lyrmgr.conf
"gefahren": {
    "legend": "gefahren",       // → legendResources: gefahren_title, gefahren_link
    "items": [...]
}
```

---

## toolsResources.json — Werkzeuge & Basiskarten

Enthält Namen der Basiskarten und Werkzeug-Labels.

### Basiskarten-Namen

```json
{
    "btnMaps_av_sw": "Vermessung grau",
    "btnMaps_av_f": "Vermessung farbig",
    "btnMaps_av_geodienste": "AV WMS geodienste.ch",
    "btnMaps_swissimage": "Luftbild swissimage",
    "btnMaps_swisstopo_lk": "Landeskarten",
    "btnMaps_swisstopo_lk_vintage": "Landeskarten Vintage",
    "btnMaps_swiss_tlm": "swisstopo TLM by TYDAC",
    "btnMaps_ch_osm": "OSM ++ Schweiz",
    "btnMaps_leer": "Leer"
}
```

Format: `btnMaps_<basemapKey>` → Angezeigter Name im Basemap-Switcher.

---

## disclaimerResources.json — Copyrights & Tipps

### Konfiguration (disclaimer.conf)

```json
{
    "main": {
        "copyright": {
            "type": "free",
            "pos_x": "5",
            "pos_y": "-5",
            "items": {
                "info_1": {
                    "baseMaps": ["av_sw", "av_f"],
                    "range": [1.6, 204.8],
                    "closable": false
                },
                "info_2": {
                    "baseMaps": ["ortho"],
                    "closable": false
                }
            }
        },
        "tips": {
            "type": "free",
            "pos_x": "5",
            "pos_y": "5",
            "items": {
                "tip_1": {
                    "baseMaps": ["all"],
                    "closable": true,
                    "timeout": 10000
                }
            }
        }
    }
}
```

| Property | Beschreibung |
|---|---|
| `range` | Copyrights abhängig der Zoomstufe (Resolutions von-bis) |
| `baseMaps` | Pro Basemap oder `["all"]` |
| `timeout` | Dauer der Anzeige beim Start (ms) |
| `closable` | Durch User schliessbar (true/false) |

### Texte (disclaimerResources.json)

```json
{
    "info_1_text": "© Quellen: <a href='...'>Kantone</a>, <a href='...'>swisstopo</a>",
    "tip_1_text": "Tipps:<br/><b>Zoomfenster</b> mit Shift/Maus aufziehen<br/>...",
    "pdf_loading_text": "<b>PDF wird offline aufbereitet</b>. Sie dürfen weiterarbeiten ..."
}
```

---

## editingResources.json — Editier-Funktionen

Standard-Texte für Editier-Funktionen. Anpassung nur bei Bedarf.

---

## Generelle Pflichtfelder (maptipsResources)

Folgende `general_*`-Einträge müssen in `maptipsResources.json` vorhanden sein:

```json
{
    "general_title": "Objektinformation",
    "general_linktext": "Klicken Sie hier",
    "general_noresults": "Keine Objekte gefunden",
    "general_ipadclose": "Fenster schliessen",
    "general_edit": "Objekt bearbeiten",
    "general_external_form": "Formular öffnen",
    "general_new_feature": "Objekt neu",
    "general_new_point": "Punktobjekt hinzufügen",
    "general_new_linestring": "Linienobjekt hinzufügen",
    "general_new_polygon": "Flächenobjekt hinzufügen",
    "general_point_symbol": "[+P]",
    "general_linestring_symbol": "[+L]",
    "general_polygon_symbol": "[+F]",
    "general_delete_all": "Alle Objekte löschen",
    "general_duplicate_feature": "Objekt duplizieren",
    "general_delete_object": "Soll dieses Objekt gelöscht werden?",
    "general_upload_photo": "Foto hinzufügen",
    "general_delete": "Löschen",
    "general_pdf_report": "PDF-Report erstellen"
}
```

---

## FK-Matrix: Wer verweist wohin?

```
┌─────────────────┐    desc_<key>     ┌──────────────────────┐
│  layers.conf    │──────────────────▶│ lyrmgrResources.json │
│  (Layer-Key)    │                   └──────────────────────┘
│                 │
│  .legend ───────│───<legend>_title──▶┌──────────────────────┐
│                 │   <legend>_link  ──▶│ legendResources.json │
└─────────────────┘                    └──────────────────────┘
        │
        │ linked_layer
        ▼
┌─────────────────┐    <nls>_title     ┌──────────────────────┐
│  maptips.conf   │──────────────────▶│maptipsResources.json │
│  .nls           │   <nls>_field_*  ──▶│                      │
│                 │   <nls>_tab*     ──▶│                      │
│                 │   <nls>_footnote ──▶│                      │
└─────────────────┘                    └──────────────────────┘

┌─────────────────┐   btnMaps_<key>    ┌──────────────────────┐
│basemaps_mgr.conf│──────────────────▶│ toolsResources.json  │
│ .basisMaps[]    │                   └──────────────────────┘
└─────────────────┘

┌─────────────────┐   <item>_text      ┌──────────────────────┐
│ disclaimer.conf │──────────────────▶│disclaimerResources   │
│ .items          │                    │        .json         │
└─────────────────┘                    └──────────────────────┘
```

### Zusammenfassung der Join-Regeln

| Richtung | Quell-Key | Ziel-Key-Format | Ziel-Datei |
|---|---|---|---|
| Layer → Label | Layer-Key | `desc_<layerKey>` | `lyrmgrResources.json` |
| Layer → Legende | `layers.conf[].legend` | `<legend>_title`, `<legend>_link` | `legendResources.json` |
| MapTip → Text | `maptips.conf[].nls` | `<nls>_title`, `<nls>_field_*` | `maptipsResources.json` |
| Basemap → Name | Basemap-Key | `btnMaps_<key>` | `toolsResources.json` |
| Disclaimer → Text | Item-Key | `<item>_text` | `disclaimerResources.json` |

---

## TNET: Aufgeteilte Ressourcendateien

> 🔧 **TNET-Erweiterung** — Pro Dienst/Kürzel existieren separate Ressourcendateien, die beim Laden gemergt werden.

### Namenskonvention

| Muster | Beispiel | Inhalt |
|---|---|---|
| `lyrmgrResources_<kürzel>.json` | `lyrmgrResources_ewn.json` | Layer-Labels für EW Nidwalden |
| `maptipsResources_<kürzel>.json` | `maptipsResources_nw.json` | MapTip-Texte für Kanton NW |
| `legendResources_<kürzel>.json` | `legendResources_ewn.json` | Legenden für EW Nidwalden |

### Vorteile

- **Wartbarkeit**: Pro Dienst eine Datei → klarere Verantwortung
- **Import-Pipeline**: ArcGIS Server → `raw-conf/` → automatisch generierte Ressourcen
- **Konfliktvermeidung**: Keine Merge-Konflikte bei gleichzeitigen Änderungen

---

## TNET: Import-Pipeline

> 🔧 **TNET-Erweiterung** — NLS-Ressourcen werden teilweise automatisch aus ArcGIS-Diensten importiert.

### Flow

```
1. ArcGIS Server REST API
   ↓ Import-Script
2. Roh-Dateien unter /data/Client_Data/nwow/raw-conf/<kürzel>/
   ↓ Staging-Merge
3. Zusammengeführte Dateien unter raw-conf/ImportToCore/<kürzel>/
   ↓ Deploy
4. core/config/ und core/nls/de/
```

### Automatisch generierte Einträge

- `desc_<layerKey>` — aus ArcGIS-Layer-Displayname
- `<nls>_title` — aus ArcGIS-Layer-Displayname
- `<nls>_field_<name>` — aus ArcGIS-Feld-Alias

### Manuell zu pflegen

- Angepasste Feldnamen (falls ArcGIS-Alias nicht passt)
- Legenden-Links (keine Automatik)
- Tab-Labels, Fussnoten
- Disclaimer-Texte
