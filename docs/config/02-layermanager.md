# 2 — Layermanager-Konfiguration

> **Datei**: `lyrmgr.conf`  
> **Verzeichnis**: `public/config/` (Profil) oder `core/config/` (Mandant)  
> **Format**: JSON  
> **Tydac-Doku**: https://cloud.mapplus.ch/mapplusv4_doku/de:layer

---

## Inhaltsverzeichnis

- [Überblick](#überblick)
- [Struktur der lyrmgr.conf](#struktur-der-lyrmgrconf)
- [LyrMgr-Instanz: Root-Properties](#lyrmgr-instanz-root-properties)
- [Kategorien (1. Ebene)](#kategorien-1-ebene)
- [Layergruppen / Sub-Kategorien (2. Ebene)](#layergruppen--sub-kategorien-2-ebene)
- [Layer-Items (3.+ Ebene)](#layer-items-3-ebene)
- [Sub-Layers (verschachtelte Objekte)](#sub-layers-verschachtelte-objekte)
- [Spezialfall: Radio-Buttons](#spezialfall-radio-buttons)
- [Mehrere LyrMgr-Instanzen](#mehrere-lyrmgr-instanzen)
- [TNET: Monkey-Patch für echte Verschachtelung](#tnet-monkey-patch-für-echte-verschachtelung)
- [TNET: Neuer Themenkatalog (LM-Tree)](#tnet-neuer-themenkatalog-lm-tree)
- [TNET: Dargestellte Themen (LM-Active)](#tnet-dargestellte-themen-lm-active)
- [TNET: Coalesce-Bridge](#tnet-coalesce-bridge)
- [TNET: Feature-Flags](#tnet-feature-flags)
- [Konfigurationsbeispiel (komplett)](#konfigurationsbeispiel-komplett)

---

## Überblick

Der Layermanager (`lyrmgr.conf`) definiert die **Baumstruktur** der verfügbaren Kartenthemen. Er verweist auf Layer-Keys aus `layers.conf` und organisiert sie in Kategorien und Gruppen.

```
lyrmgr.conf                          Darstellung im Browser
┌────────────────────────┐            ┌──────────────────────────┐
│ main_lyrmgr:           │            │ [🏛] [🌳] [🚗] [⚡]      │  ← Kategorie-Tabs
│   structure:           │            │                          │
│     grundlagen:        │            │ ▼ Gefahrenkarten         │  ← Layergruppe
│       items:           │            │   ☑ Lawinen              │  ← Layer
│         gefahren:      │            │   ☐ Rutschungen          │
│           items: [     │            │   ☐ Steinschlag          │
│             "lawinen", │            │                          │
│             "rutsch",  │            │ ▶ Raumplanung            │  ← zugeklappt
│             ...        │            │                          │
└────────────────────────┘            └──────────────────────────┘
```

---

## Struktur der lyrmgr.conf

```json
{
    "<lyrmgr_id>": {
        "type": "ClassicLayerMgr",
        "useRemoveHighlight": true,
        "switchLyrChkBoxAndName": false,
        "targetMap": ["main"],
        "mod_sortlayers": { "type": "sortable_stack" },
        "statemanager_cgi": {
            "url": "/mapplus-lib/.../stateManager.php",
            "dbconn_id": "nwow"
        },
        "version": "3",
        "structure": {
            "<kategorie_id>": {
                "iconClass": "njsCategoryIcon7",
                "iconClassActive": "njsCategoryIcon7_active",
                "items": {
                    "<gruppe_id>": {
                        "open": false,
                        "legend": "<legendKey>",
                        "selectAll": true,
                        "items": [
                            "<layer_key>",
                            "<layer_key>",
                            { "name": "...", "items": [...] }
                        ]
                    }
                }
            }
        }
    }
}
```

---

## LyrMgr-Instanz: Root-Properties

Jede LyrMgr-Instanz (z.B. `main_lyrmgr`) hat folgende Root-Properties:

| Property | Typ | Pflicht | Default | Beschreibung |
|---|---|---|---|---|
| `type` | `string` | ✅ | — | Immer `"ClassicLayerMgr"` |
| `useRemoveHighlight` | `boolean` | — | `false` | Highlight beim Deaktivieren eines Layers entfernen |
| `switchLyrChkBoxAndName` | `boolean` | — | `false` | Checkbox- und Namen-Reihenfolge tauschen |
| `targetMap` | `string[]` | ✅ | — | Ziel-Karteninstanz(en), z.B. `["main"]` |
| `mod_sortlayers` | `object` | — | — | Sortier-Modul |
| `mod_sortlayers.type` | `string` | — | — | `"sortable_stack"` für Drag&Drop-Sortierung |
| `statemanager_cgi` | `object` | — | — | State-Manager für Permalink-Speicherung |
| `statemanager_cgi.url` | `string` | — | — | URL zum `stateManager.php` |
| `statemanager_cgi.dbconn_id` | `string` | — | — | Datenbank-Verbindungs-ID |
| `version` | `string` | — | — | Config-Version (aktuell `"3"`) |
| `structure` | `object` | ✅ | — | Kategorie-Baum (→ siehe unten) |

---

## Kategorien (1. Ebene)

Kategorien sind die oberste Gliederungsebene — dargestellt als **Register/Tabs** mit Icons.

```json
"structure": {
    "grundlagen": {
        "iconClass": "njsCategoryIcon7",
        "iconClassActive": "njsCategoryIcon7_active",
        "items": { ... }
    },
    "oereb": {
        "iconClass": "njsCategoryIcon2",
        "iconClassActive": "njsCategoryIcon2_active",
        "items": { ... }
    }
}
```

### Kategorie-Properties

| Property | Typ | Pflicht | Default | Beschreibung |
|---|---|---|---|---|
| `iconClass` | `string` | — | — | CSS-Klasse für das Kategorie-Icon (inaktiver Zustand) |
| `iconClassActive` | `string` | — | — | CSS-Klasse für das Kategorie-Icon (aktiver Zustand) |
| `items` | `object` | ✅ | — | Layergruppen als verschachteltes Objekt |

### Icon-Styles definieren

Die Styles werden in `PoiManager.css` definiert (Verzeichnis `core/templates/<template>/css`):

```css
.tundra .tourism {
    background-image: url("../img/poi_manager/tourism.png");
    background-repeat: no-repeat;
    background-size: contain;
    width: 40px;
    height: 40px;
}
.tundra .tourism_active {
    background-image: url("../img/poi_manager/tourism_active.png");
    /* gleiche Properties wie oben */
}
```

### Verwendete Kategorien (NW/OW-Projekt)

| Key | Beschreibung | LyrMgr-Instanz |
|---|---|---|
| `grundlagen` | Grundlagendaten | `main_lyrmgr` (NW) |
| `oereb` | ÖREB-Kataster | `main_lyrmgr` |
| `raumentw` | Raumentwicklung | `main_lyrmgr` |
| `verkehr` | Verkehr | `main_lyrmgr` |
| `gewueb` | Gewässer & Überschwemmung | `main_lyrmgr` |
| `wald_jagd` | Wald & Jagd | `main_lyrmgr` |
| `umwelt` | Umwelt | `main_lyrmgr` |
| `natur_landschaft` | Natur & Landschaft | `main_lyrmgr` |
| `energie` | Energie | `main_lyrmgr` |
| `liegenschaften` | Liegenschaften | `main_lyrmgr` |
| `freizeit` | Freizeit | `main_lyrmgr` |
| `1`–`8` | Numerische IDs | `second_lyrmgr` (OW), `third_lyrmgr` (Bund), `forth_lyrmgr` |

---

## Layergruppen / Sub-Kategorien (2. Ebene)

Layergruppen werden als **Akkordeon** (auf-/zuklappbar) dargestellt:

```json
"items": {
    "gefahren": {
        "legend": "gefahren",
        "open": true,
        "selectAll": true,
        "items": [
            "gefahrengebiet_lawine",
            "gefahrengebiet_rutschung",
            "gefahrengebiet_sturz",
            "gefahrengebiet_wasser"
        ]
    },
    "raumplanung": {
        "open": false,
        "items": [
            "bauzonen",
            "nutzungsplanung"
        ]
    }
}
```

### Layergruppen-Properties

| Property | Typ | Pflicht | Default | Beschreibung |
|---|---|---|---|---|
| `open` | `boolean` | — | `false` | Beim Start aufgeklappt |
| `legend` | `string` | — | — | Legenden-Key für die gesamte Gruppe → `legendResources.json` |
| `selectAll` | `boolean` | — | `true` | Gruppen-Checkbox zum Ein-/Ausschalten aller Layer |
| `items` | `array` | ✅ | — | Layer-Keys (Strings) und/oder verschachtelte Objekte |
| `drawtype` | `string` | — | — | `"radio"` für Radio-Buttons statt Checkboxen (→ siehe [unten](#spezialfall-radio-buttons)) |

### Anzeigename definieren

Der Anzeigename einer Layergruppe (und Kategorie) wird in `lyrmgrResources.json` definiert:

```json
{
    "desc_grundlagen": "Grundlagen",
    "desc_gefahren": "Gefahrenkarten",
    "desc_raumplanung": "Raumplanung"
}
```

→ Siehe [NLS](04-nls.md) für Details

---

## Layer-Items (3.+ Ebene)

Das `items`-Array einer Layergruppe kann zwei Formate enthalten:

### 1. Einfacher String = Layer-Key

```json
"items": [
    "gefahrengebiet_lawine",
    "gefahrengebiet_rutschung"
]
```

Der String verweist auf einen Key in `layers.conf`. Er muss dort definiert sein.

### 2. Verschachteltes Objekt = Sub-Gruppe

```json
"items": [
    "einfacher_layer",
    {
        "name": "prozessraeume",
        "legend": "prozessraeume",
        "open": false,
        "icon": "../core/symbolsets/mapplus/layers.png",
        "icon_style": "width:18px;height:18px",
        "items": [
            "prozessraum_lawine",
            "prozessraum_rutschung",
            "prozessraum_sturz"
        ]
    }
]
```

→ Siehe nächster Abschnitt

---

## Sub-Layers (verschachtelte Objekte)

Innerhalb einer Layergruppe können verschachtelte Unter-Gruppen definiert werden. Diese erzeugen im Layermanager ein **zusätzliches TitlePane** mit eigenem Auf-/Zuklapp-Verhalten.

### Sub-Layer-Properties

| Property | Typ | Pflicht | Default | Beschreibung |
|---|---|---|---|---|
| `name` | `string` | ✅ | — | Dienst-Pfad / Gruppen-Name (dient auch als Key für NLS) |
| `legend` | `string` | — | — | Legenden-Key |
| `open` | `boolean` | — | `false` | Beim Start aufgeklappt |
| `icon` | `string` | — | — | Icon-Pfad (PNG oder SVG) |
| `icon_style` | `string` | — | — | CSS-Inline-Styles für Icon |
| `items` | `array` | ✅ | — | Kind-Layer (Strings oder weitere verschachtelte Objekte) |
| `selectAll` | `boolean` | — | `true` | Gruppen-Checkbox |

### Beispiel: ÖREB-Nutzungsplanung (3 Ebenen tief)

```json
{
    "name": "gis_oereb/nw_nutzungsplanung_def",
    "legend": "gis_oereb/nw_nutzungsplanung_def",
    "open": false,
    "icon": "../core/symbolsets/mapplus/layers.png",
    "icon_style": "width:18px;height:18px",
    "items": [
        "gis_oereb/nw_nutzungsplanung_def/grundnutzung",
        "gis_oereb/nw_nutzungsplanung_def/ueberlagernde_festlegung",
        "gis_oereb/nw_nutzungsplanung_def/linienbezogene_festlegung",
        "gis_oereb/nw_nutzungsplanung_def/punktbezogene_festlegung"
    ]
}
```

> **Hinweis**: Verschachtelte Objekte können beliebig tief sein — es ist möglich, in `items` wiederum Objekte mit eigenen `items` zu platzieren. In der Praxis sind 2–3 Ebenen üblich.

---

## Spezialfall: Radio-Buttons

Wenn nur ein Layer einer Gruppe gleichzeitig aktiv sein soll (z.B. reine Raster-Layer), können Radio-Buttons statt Checkboxen verwendet werden:

```json
"orthofotos": {
    "legend": "orthofotos",
    "open": true,
    "drawtype": "radio",
    "selectAll": false,
    "items": [
        "ortho_2020",
        "ortho_2015",
        "ortho_2010"
    ]
}
```

| Property | Wert | Beschreibung |
|---|---|---|
| `drawtype` | `"radio"` | Radio-Buttons statt Checkboxen |
| `selectAll` | `false` | Sollte bei Radio-Buttons deaktiviert sein |

---

## Mehrere LyrMgr-Instanzen

Eine `lyrmgr.conf` kann mehrere Layermanager-Instanzen enthalten. Im NW/OW-Projekt gibt es vier:

```json
{
    "main_lyrmgr":   { ... },   // Nidwalden (NW) — Fach- und ÖREB-Layer
    "second_lyrmgr": { ... },   // Obwalden (OW) — Fach- und ÖREB-Layer
    "third_lyrmgr":  { ... },   // Bund (Geoadmin) — Bundesgeodaten (ch.*)
    "forth_lyrmgr":  { ... }    // Freizeit/Diverses — POI (Gastro, Wandern, etc.)
}
```

Jede Instanz hat eine eigene `structure` und kann auf eine andere `targetMap` zeigen. In der Praxis zeigen alle auf `["main"]`.

> 🔧 **TNET-Erweiterung** — Im **Themenkatalog** (LM-Tree) werden die LyrMgr-Instanzen als **Wappen-Tabs** dargestellt. Jeder Tab zeigt die Kategorien der entsprechenden Instanz.

---

## TNET: Monkey-Patch für echte Verschachtelung

> 🔧 **TNET-Erweiterung** — Datei: `tnet/js/tnet-lyrmgr-patch.js` (844 Zeilen)

### Problem

Im Standard-MAP+-Framework werden Sub-Layer-TitlePanes **flach** am Root des Layermanagers angehängt — egal wie tief sie in der `lyrmgr.conf` verschachtelt sind. Ein 3-stufiger Baum wird visuell flach dargestellt.

### Lösung

Der TNET-Patch überschreibt (Monkey-Patch) die `ClassicLayerMgr`-Methoden, um **echte DOM-Verschachtelung** zu erzeugen. Kind-TitlePanes landen im Content-Bereich des Parent-TitlePanes.

### Patching-Mechanismus

1. **Property-Traps** via `Object.defineProperty` auf `njs.LayerMgr` und `njs.LayerMgr.ClassicLayerCategory`
2. **Microtask-Timing**: `Promise.resolve().then()` — nach synchronen Prototype-Zuweisungen, vor dem ersten Macrotask
3. **Polling-Fallback**: 50ms Intervall, max. 10s wenn `defineProperty` fehlschlägt

### Gepatchte Methoden

| Methode | Was geändert wird |
|---|---|
| `Init()` | Liest `options.nested` Flag |
| `_build()` | Gibt `_depth`-Information weiter, unterdrückt `_buildContentHeader` im Nested-Context |
| `_buildContentLayers()` | Markiert Leaf-Container mit CSS-Klessen `tnet-lm-nested-leaf` und `data-lyrmgr-parent-depth` |
| `_buildContentSubCat()` | **DER EIGENTLICHE FIX**: Kinder landen im Content-Pane des Parent-TitlePane statt flat am Root. Eigener Click-Handler. Rekursive `selectAll`-Logik |
| `switchLayer()` | Parent-Checkbox-States rekursiv nachziehen, `removeLayerIfPossible` bei OFF |
| `switchGroupLayers()` | Rekursives EIN/AUS über alle Descendant-Layer |

### Gruppen-Checkbox-States

Wenn eine Gruppe teils ein- und teils ausgeschaltete Layer hat:

| Status | CSS-Klasse | Darstellung |
|---|---|---|
| Alle an | `dijitCheckBoxChecked` | ☑ |
| Gemischt | `dijitMixed` + `tmpdirCheckBoxMixed` | ☑ (grau) |
| Alle aus | (keine) | ☐ |

### Sichtbarkeits-Snapshots

Beim **Deaktivieren** einer Gruppe wird der aktuelle Zustand aller Kind-Layer gespeichert (Snapshot). Beim **Reaktivieren** wird der gespeicherte Zustand wiederhergestellt — nicht einfach alles eingeschaltet.

### Debug-Helper

```javascript
// In der Browser-Konsole:
window.TnetDumpNestedCss();
// → Gibt CSS-Dump aller verschachtelten TitlePanes aus
```

---

## TNET: Neuer Themenkatalog (LM-Tree)

> 🔧 **TNET-Erweiterung** — Datei: `tnet/js/tnet-lm-tree.js` (452 Zeilen)

Der TNET-Themenkatalog ersetzt die Standard-Kategorie-Tabs durch ein moderneres UI:

### Features

| Feature | Beschreibung |
|---|---|
| **Wappen-Tabs** | Kantonale Wappen (NW, OW, CH) statt generische Icons — je Wappen zeigt Kategorien der LyrMgr-Instanz |
| **Inline-Suche** | Suchfeld im Katalog — filtert Layer über alle Kategorien |
| **Accordion** | Auf-/zuklappbare Gruppen innerhalb jeder Kategorie |
| **Layer-Katalog API** | Bezieht Hierarchie über `tnet/api/v1/layers.php` (optional, Fallback auf `lyrmgr.conf`) |

### Aktivierung

```json5
// tnet-global-config.json5
{
    "layerManager": {
        "useNewTree": true,      // Neuer Themenkatalog
        "apiUrl": "/maps/tnet/api/v1/layers.php"
    }
}
```

---

## TNET: Dargestellte Themen (LM-Active)

> 🔧 **TNET-Erweiterung** — Datei: `tnet/js/tnet-lm-active.js` (766 Zeilen)

Das Panel "Dargestellte Themen" zeigt alle aktuell aktiven Layer mit Steuerungsmöglichkeiten:

### Features

| Feature | Beschreibung |
|---|---|
| **Drag & Drop** | Layer-Reihenfolge per Drag&Drop ändern |
| **Augen-Toggle** | Layer temporär ein-/ausblenden (ohne zu deaktivieren) |
| **Opacity-Slider** | Deckkraft per Layer stufenlos einstellen |
| **Entfernen-Button** | Layer aus der Karte entfernen |
| **Zoom-to-Extent** | Zur Ausdehnung des Layers zoomen |
| **Legenden-Link** | Legende direkt öffnen |

### Aktivierung

```json5
// tnet-global-config.json5
{
    "layerManager": {
        "useNewActivePanel": true   // Neues Dargestellte-Themen-Panel
    }
}
```

---

## TNET: Coalesce-Bridge

> 🔧 **TNET-Erweiterung** — Datei: `tnet/js/tnet-coalesce-bridge.js` (1411 Zeilen)

### Konzept

ArcGIS MapServer-Dienste haben einen **Root-Dienst** (z.B. `gis_oereb/nw_nutzungsplanung_def`) mit mehreren **Sublayern** (z.B. `/grundnutzung`, `/ueberlagernde_festlegung`). Im Standard-Framework erstellt jeder `switchLayer()` einen eigenen OpenLayers-Layer. Das Coalesce-System bündelt diese.

### Funktionsweise

```
1. User aktiviert Sublayer "grundnutzung"
   ↓
2. Coalesce-Bridge prüft: Root-Dienst aktiv?
   ├── NEIN: TnetLayerSwitch(rootKey, 'on') → Framework erstellt OL-Layer
   └── JA: OL-Layer existiert bereits
   ↓
3. Bridge setzt: source.updateParams({LAYERS: 'show:0'})
   ↓
4. User aktiviert weiteren Sublayer "ueberlagernde_festlegung"
   ↓
5. Bridge aktualisiert: source.updateParams({LAYERS: 'show:0,1'})
   ↓
6. Bridge registriert MapTip-Lookup-Callbacks für beide Sublayer
```

### Interner State

| Variable | Typ | Beschreibung |
|---|---|---|
| `_rootServices` | `Object<string, RootEntry>` | Registry aktiver Root-Dienste |
| `_sublayerToRoot` | `Object<string, string>` | Reverse-Mapping: Sublayer → Root |
| `_maptipPatched` | `boolean` | MapTip-Patches installiert |

**RootEntry-Struktur**:
```javascript
{
    olLayer: null,                          // OL-Layer-Referenz
    registeredSublayers: {                  // Sublayer-Key → Sublayer-Nummer
        "gis_oereb/.../grundnutzung": 0,
        "gis_oereb/.../ueberl_festlegung": 1
    },
    visibleSublayers: { ... },              // Aktuell sichtbare
    debounceTimer: null,                    // Debounce-Timer
    originalLAYERS: "show:0,1,2,3"          // Ursprünglicher LAYERS-Wert
}
```

### Öffentliche API

```javascript
// window.TnetCoalesceBridge
TnetCoalesceBridge.init();                                    // Initialisierung
TnetCoalesceBridge.isEnabled();                               // Bridge aktiv?
TnetCoalesceBridge.canHandle(sublayerKey);                    // Sublayer verwaltbar?
TnetCoalesceBridge.registerSublayer(key, num, rootKey, ol);   // Sublayer registrieren
TnetCoalesceBridge.unregisterSublayer(key);                   // Sublayer entfernen
TnetCoalesceBridge.restoreFromUrl(store);                     // Aus URL wiederherstellen
TnetCoalesceBridge.getStatus();                               // Debug-Info
```

### MapTip-Integration

Die Bridge patcht den MapTip-Mechanismus:
- **lookupCallbacks**: Root-Service-URL für Sublayer-Keys registrieren
- **QueryConnector-Patch**: Nur sichtbare Sublayer abfragen
- **URL-State-Patch**: Root-Keys durch aktive Sublayer-Keys ersetzen

### Debouncing

Schnelles Aktivieren mehrerer Sublayer wird debounct (konfigurierbar):

```json5
// tnet-global-config.json5
{
    "layerManager": {
        "coalesceDebounceMs": 80    // Default: 80ms
    }
}
```

### Aktivierung

```json5
// tnet-global-config.json5
{
    "layerManager": {
        "coalesceFrameworkBridge": true   // Coalesce-System aktivieren
    }
}
```

---

## TNET: Feature-Flags

> 🔧 **TNET-Erweiterung** — Datei: `tnet/js/tnet-lm-init.js` (436 Zeilen)

Alle Layermanager-Erweiterungen sind über Feature-Flags steuerbar:

### Übersicht

| Flag | Typ | Default | Beschreibung |
|---|---|---|---|
| `useNewActivePanel` | `boolean` | `true` | Neues Drag&Drop-Panel "Dargestellte Themen" |
| `useNewTree` | `boolean` | `true` | TNET-Themenkatalog mit Wappen-Tabs und Suche |
| `useNewWmsPanel` | `boolean` | `true` | WMS-TitlePane ausblenden / neues Panel |
| `apiUrl` | `string` | `'/maps/tnet/api/v1/layers.php'` | API-Endpoint für Layer-Katalog |
| `useLegacyNestedHierarchyStyle` | `boolean` | `true` | Nested-CSS für Legacy-Dojo-Layermanager |
| `coalesceFrameworkBridge` | `boolean` | `true` | Coalesce-Framework-Bridge aktivieren |
| `coalesceDebounceMs` | `number` | `80` | Debounce beim Multi-Sublayer-Aktivieren |
| `debug` | `boolean` | `true` | Debug-Konsolenausgaben |

### Konfiguration

```json5
// tnet-global-config.json5
{
    "layerManager": {
        "useNewActivePanel": true,
        "useNewTree": true,
        "useNewWmsPanel": true,
        "apiUrl": "/maps/tnet/api/v1/layers.php",
        "useLegacyNestedHierarchyStyle": true,
        "coalesceFrameworkBridge": true,
        "coalesceDebounceMs": 80,
        "debug": true
    }
}
```

### Initialisierungs-Flow

```
1. Config laden (async, JSON5, 3 Fallback-Pfade)
2. Feature-Flags auswerten
3. Legacy-Container ausblenden (nicht entfernen — Parallel-Betrieb)
4. Neue Container erzeugen:
   Desktop: in #kantons_container / #sort_menu
   Mobile:  in #m-layers-sheet
5. TnetLMStore → TnetLMTree → TnetLMActive initialisieren
6. Fallback-Timer: nach 6s Legacy wiederherstellen wenn Module nicht laden
7. Polling-Fallback: max. 30s auf njs.AppManager.Maps['main'] warten
```

### Debug-Funktionen

```javascript
// In der Browser-Konsole:
TnetLMInit.getFlags();     // → Aktive Feature-Flags anzeigen
TnetLMInit.reinit();       // → Manueller Re-Init
```

---

## Konfigurationsbeispiel (komplett)

Minimales aber vollständiges Beispiel einer `lyrmgr.conf`:

```json
{
    "main_lyrmgr": {
        "type": "ClassicLayerMgr",
        "useRemoveHighlight": true,
        "switchLyrChkBoxAndName": false,
        "targetMap": ["main"],
        "mod_sortlayers": {
            "type": "sortable_stack"
        },
        "statemanager_cgi": {
            "url": "/mapplus-lib/mapplus-dojo/v4.0/php/stateManager.php",
            "dbconn_id": "nwow"
        },
        "version": "3",
        "structure": {
            "grundlagen": {
                "iconClass": "njsCategoryIcon7",
                "iconClassActive": "njsCategoryIcon7_active",
                "items": {
                    "gefahren": {
                        "open": true,
                        "legend": "gefahren",
                        "selectAll": true,
                        "items": [
                            "gefahrengebiet_lawine",
                            "gefahrengebiet_rutschung"
                        ]
                    },
                    "oereb_raumplanung": {
                        "open": false,
                        "items": [
                            {
                                "name": "gis_oereb/nw_nutzungsplanung_def",
                                "legend": "gis_oereb/nw_nutzungsplanung_def",
                                "open": false,
                                "icon": "../core/symbolsets/mapplus/layers.png",
                                "icon_style": "width:18px;height:18px",
                                "items": [
                                    "gis_oereb/nw_nutzungsplanung_def/grundnutzung",
                                    "gis_oereb/nw_nutzungsplanung_def/ueberlagernde_festlegung"
                                ]
                            }
                        ]
                    }
                }
            }
        }
    }
}
```
