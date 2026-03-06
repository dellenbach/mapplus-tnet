# MAP+ Konfigurationsreferenz

> **Projekt**: MAP+ / TNET — GIS-Portal Nidwalden/Obwalden  
> **Framework**: MAP+ V4 von [TYDAC](https://www.tydac.ch) (Dojo 1.x + OpenLayers)  
> **Erweiterungen**: Trigonet AG (TNET) — eigene Module ohne Bundler/TypeScript  
> **Stand**: März 2026

---

## Inhaltsverzeichnis

| # | Seite | Inhalt |
|---|---|---|
| — | **Diese Datei** | Architektur-Überblick, Datei-Beziehungen, Glossar |
| 1 | [Layer-Konfiguration](01-layers.md) | `layers.conf` — WMS, WMTS, ArcGIS REST |
| 2 | [Layermanager](02-layermanager.md) | `lyrmgr.conf` — Baumstruktur, Kategorien, TNET-Patch |
| 3 | [Informationsabfragen](03-maptips.md) | `maptips.conf` — Info-Abfragen, Highlight, Lookups |
| 4 | [Sprachressourcen (NLS)](04-nls.md) | `*Resources.json` — Labels, Legenden, Disclaimer |
| 5 | [Basiskarten](05-basemaps.md) | `basemaps_mgr.conf` — WMTS, Zeitreise, Maske |
| 6 | [TNET-Globale Konfiguration](06-tnet-global-config.md) | `tnet-global-config.json5` — Feature-Flags, 3D, Druck |
| 7 | [Module & Deployment](07-modules-deployment.md) | `modules.conf`, Vererbung, Import-Pipeline, Upload |

---

## Architektur-Überblick

```
┌─────────────────────────────────────────────────────────────┐
│                     MAP+ V4 (TYDAC)                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │ Dojo 1.x │  │OpenLayers│  │ClassicLyr│  │  MapTips   │  │
│  │   (UI)   │  │  (Karte) │  │   Mgr    │  │  (Info)    │  │
│  └──────────┘  └──────────┘  └──────────┘  └────────────┘  │
└─────────────────────────┬───────────────────────────────────┘
                          │ erweitert durch
┌─────────────────────────▼───────────────────────────────────┐
│                TNET-Erweiterungen (Trigonet AG)             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │ LyrMgr   │  │Coalesce  │  │ Basemap  │  │  Suche /   │  │
│  │  Patch   │  │ Bridge   │  │ Widget   │  │  ÖREB      │  │
│  ├──────────┤  ├──────────┤  ├──────────┤  ├────────────┤  │
│  │ LM-Tree  │  │ LM-Store │  │Zeitreise │  │  Spatial   │  │
│  │ LM-Active│  │ LM-Init  │  │ Slider   │  │  Query     │  │
│  ├──────────┤  ├──────────┤  ├──────────┤  ├────────────┤  │
│  │Info-Panel│  │  Print   │  │Splitscr. │  │3D-Landscape│  │
│  └──────────┘  └──────────┘  └──────────┘  └────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Standard vs. Erweiterung

| Bereich | MAP+ Standard (TYDAC) | 🔧 TNET-Erweiterung (Trigonet) |
|---|---|---|
| **Layer-Typen** | WMS, WMTS | + ArcGIS REST, Coalesce-Gruppen |
| **Layermanager** | Flache TitlePanes | Echte DOM-Verschachtelung, Drag&Drop |
| **Basiskarten** | Buttons oben | Cards + Zeitreise-Slider |
| **Info-Panel** | FloatingPane | + Clipboard, Dock, Breadcrumb |
| **Suche** | NLS-Suche | Parallel-Suche (NLS + Geocoder + Features) |
| **Druck** | Framework-Print | jsPDF/svg2pdf, QGIS-Templates |
| **3D** | — | ESRI SceneView, Frustum-Indikator |
| **Split-Screen** | — | Zweite synchronisierte Karte |

---

## Datei-Übersicht

### Konfigurationsdateien

| Datei | Verzeichnis | Format | Beschreibung |
|---|---|---|---|
| `layers.conf` | `public/config/` | JSON | Layer-Definitionen (URL, Typ, Sichtbarkeit) |
| `lyrmgr.conf` | `public/config/` | JSON | Layermanager-Baumstruktur |
| `basemaps_mgr.conf` | `public/config/` | JSON | Basemap-Manager (Projektion, Extent, Basemaps) |
| `basemaps.conf` | `core/config/` | JSON | Basemap-Definitionen (WMTS, WMS, TMS) |
| `maptips.conf` | `core/config/` | JSON | Info-Abfrage-Konfiguration |
| `modules.conf` | `public/config/` | JSON | Modul- und Toolbar-Konfiguration |
| `modules_m.conf` | `public/config/` | JSON | Mobile Modul-Konfiguration |
| `disclaimer.conf` | `public/config/` | JSON | Copyright- und Tipp-Konfiguration |
| `tools.conf` | `public/config/` | JSON | Werkzeug-Konfiguration |

### TNET-Konfiguration

| Datei | Verzeichnis | Format | Beschreibung |
|---|---|---|---|
| `tnet-global-config.json5` | `tnet/config/` | JSON5 | 🔧 Zentrale TNET-Konfiguration (Feature-Flags, 3D, Druck) |

### NLS-Ressourcen (Sprachdateien)

| Datei | Verzeichnis | Inhalt |
|---|---|---|
| `lyrmgrResources.json` | `core/nls/de/` | Layer-Labels (`desc_<layerKey>`) |
| `maptipsResources.json` | `core/nls/de/` | Info-Panel-Texte (`<nls>_title`, `<nls>_field_*`) |
| `legendResources.json` | `core/nls/de/` | Legenden-Titel und -Links |
| `toolsResources.json` | `core/nls/de/` | Werkzeug- und Basiskarten-Labels |
| `disclaimerResources.json` | `core/nls/de/` | Copyright- und Hinweis-Texte |
| `editingResources.json` | `core/nls/de/` | Editier-Funktions-Texte |

### Aufgeteilte Config-Dateien (pro Dienst)

| Muster | Beispiel | Inhalt |
|---|---|---|
| `layers_TNET_<kürzel>_<Service>.conf` | `layers_TNET_ewn_EWN_NIS_gwr.conf` | TNET ArcGIS-Dienst-Layer |
| `layers_<quelle>.conf` | `layers_geoadmin.conf` | Geoadmin/NODI-Layer |
| `maptips_TNET_<kürzel>_<Service>.conf` | `maptips_TNET_nw_NW_OEREB.conf` | TNET ArcGIS-Dienst-Maptips |
| `maptips_<quelle>.conf` | `maptips_geoadmin.conf` | Geoadmin/NODI-Maptips |
| `lyrmgrResources_<kürzel>.json` | `lyrmgrResources_ewn.json` | Layer-Labels pro Dienst |
| `maptipsResources_<kürzel>.json` | `maptipsResources_nw.json` | Maptip-Texte pro Dienst |
| `legendResources_<kürzel>.json` | `legendResources_ewn.json` | Legenden-Texte pro Dienst |

---

## Datei-Beziehungen (FK-Matrix)

```
lyrmgr.conf                    layers.conf                  NLS-Ressourcen
┌────────────────┐             ┌────────────────┐            ┌─────────────────────┐
│ structure:     │             │                │            │ lyrmgrResources.json│
│   items: ─────────────────── │  "<layer_key>" │ ────────── │ desc_<layer_key>    │
│   [layer_key]  │      ┌───  │     .legend ───────────────  │                     │
│                │      │     │                │            │ legendResources.json │
└────────────────┘      │     └───────┬────────┘            │ <legend>_title       │
                        │             │                     │ <legend>_link        │
                        │             │ linked_layer        │                     │
                        │     ┌───────▼────────┐            │ maptipsResources.json│
                        │     │ maptips.conf   │            │ <nls>_title          │
                        └──── │  .linked_layer │ ─ .nls ──  │ <nls>_field_*        │
                              │  .linked_basemap            │ <nls>_tab*           │
                              └────────────────┘            └─────────────────────┘
```

### Join-Regeln im Detail

| Verknüpfung | Quell-Datei → Feld | Ziel-Datei → Feld | Typ |
|---|---|---|---|
| Layer → Maptip | `layers.conf` → Key | `maptips.conf` → `linked_layer` | 1:n |
| Layer → Label | `layers.conf` → Key | `lyrmgrResources.json` → `desc_<Key>` | 1:1 |
| Layer → Legende | `layers.conf` → `legend` | `legendResources.json` → `<legend>_title/link` | 1:n |
| Maptip → Text | `maptips.conf` → `nls` | `maptipsResources.json` → `<nls>_title/field_*` | 1:n |
| LyrMgr → Layer | `lyrmgr.conf` → `items[]` | `layers.conf` → Key | n:1 |

---

## Konfigurationsvererbung

MAP+ unterstützt eine Kaskade, bei der spezifischere Einstellungen die allgemeinen überschreiben:

```
core (Mandant-Level)          Basis-Konfiguration für alle Portale
  └── Profil                  Portal-spezifische Anpassungen
        └── Gruppe            Gruppen-spezifische Überschreibungen
```

**Verzeichnisse** (am Beispiel Layer):
- **core**: `core/config/layers.conf` + `core/config/layers_*.conf` — für alle Portale
- **Profil**: `public/config/layers.conf` — für dieses Portal
- **Gruppe**: `public/config/<gruppe>/layers.conf` — überschreibt Profil

Dateien mit gleichem Muster werden gemergt: `layers_geoadmin.conf` + `layers_nodi_ch.conf` + `layers_TNET_ewn_*.conf` → alle Layer stehen zur Verfügung.

---

## Glossar

| Begriff | Beschreibung |
|---|---|
| **Coalesce** | 🔧 TNET-Konzept: Mehrere ArcGIS-Sublayer werden über einen einzigen OL-Layer gebündelt (`show:0,3,5`) |
| **ClassicLayerMgr** | MAP+-Standard-Layermanager (Dojo TitlePanes) |
| **FloatingPane** | Dojo-Widget für frei positionierbare Panels (Info-Panel auf Desktop) |
| **Layer-Key** | Eindeutiger Schlüssel eines Layers in `layers.conf`, referenziert in `lyrmgr.conf` und `maptips.conf` |
| **lyrmgr** | Layermanager — steuert die Baumstruktur der verfügbaren Layer |
| **MapTip / Maptip** | Info-Abfrage beim Klick auf ein Kartenobjekt |
| **NLS** | National Language Support — Sprachdateien für UI-Labels und Texte |
| **NODI** | [nodi.mapplus.ch](https://nodi.mapplus.ch) — TYDAC-Plattform mit vorkonfigurierten Schweizer Geodaten |
| **Profil** | Portal-Konfiguration innerhalb eines MAP+-Mandanten |
| **Root-Dienst** | 🔧 Bei Coalesce: der übergeordnete ArcGIS-MapServer-Dienst, der den OL-Layer hält |
| **Sublayer** | 🔧 Einzelner Layer innerhalb eines ArcGIS-MapServer-Dienstes (z.B. Layer-ID 0, 1, 2) |
| **TNET** | Trigonet AG — Erweiterungen des MAP+-Frameworks |
| **WMTS** | Web Map Tile Service — Kacheldienst für performante Kartendarstellung |

---

## Links zur Original-Dokumentation (TYDAC)

> ⚠ Die Tydac-Dokumentation erfordert einen Login.

| Thema | URL |
|---|---|
| Layer-Konfiguration | https://cloud.mapplus.ch/mapplusv4_doku/de:layer |
| NLS-Sprachressourcen | https://cloud.mapplus.ch/mapplusv4_doku/de:nls |
| Informationsabfragen | https://cloud.mapplus.ch/mapplusv4_doku/de:maptips |
| Basiskarten | https://cloud.mapplus.ch/mapplusv4_doku/de:basemaps |
| swisstopo-Integration | https://cloud.mapplus.ch/mapplusv4_doku/de:swisstopo |

---

## Konventionen in dieser Doku

- **Standard-MAP+**: Konfigurationsoptionen des Frameworks von TYDAC
- **🔧 TNET-Erweiterung**: Eigene Erweiterungen von Trigonet AG — in Blockquotes markiert:
  > 🔧 **TNET-Erweiterung** — Beschreibung der Erweiterung
- **Property-Tabellen**: `Property | Typ | Pflicht | Default | Beschreibung`
- **Code-Beispiele**: Aus den tatsächlichen Projektdateien
- **Kreuzverweise**: `→ siehe [Seite](datei.md#anker)`
