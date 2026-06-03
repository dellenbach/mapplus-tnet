# 7 — Module, Lade-Kette & Deployment

> **Dateien**: `modules.conf`, `modules_m.conf`, `modules.js`  
> **Pfad**: `maps/public/config/` (+ Profil-Unterordner)  
> **Tydac-Doku**: https://cloud.mapplus.ch/mapplusv4_doku/de:modules

---

## Inhaltsverzeichnis

- [Überblick](#überblick)
- [Lade-Kette](#lade-kette)
- [modules.conf — Aufbau](#modulesconf--aufbau)
- [MenuPane — Sidebar-Menü](#menupane--sidebar-menü)
- [defmodules — Aktive Module](#defmodules--aktive-module)
- [defbuttons — Toolbar-Buttons](#defbuttons--toolbar-buttons)
- [Weitere Sektionen](#weitere-sektionen)
- [Mobile (modules_m.conf)](#mobile-modules_mconf)
- [Config-Vererbung (Profile & Gruppen)](#config-vererbung-profile--gruppen)
- [Server-Architektur](#server-architektur)
- [Import-Pipeline (ArcGIS → Core)](#import-pipeline-arcgis--core)
- [Deployment-Workflow](#deployment-workflow)
- [Upload-Skripte](#upload-skripte)

---

## Überblick

`modules.conf` ist die zentrale Steuerungsdatei, die bestimmt:
- Welche **Module** geladen werden (MapTips, Layermanager, Legende, ...)
- Welche **Toolbar-Buttons** angezeigt werden
- Wie das **Sidebar-Menü** (MenuPane) aufgebaut ist
- Ob **Tracking/Logging** aktiv ist

---

## Lade-Kette

```
Browser → index_de.htm
  │
  ├── <script src="/mapplus-lib/.../appmanager.js">    ← Framework
  ├── <script src="/mapplus-lib/.../common.js">
  ├── <script src="/mapplus-lib/.../layout.js">
  ├── <script src="/mapplus-lib/.../layers.js">
  ├── <script src="/mapplus-lib/.../maptips.js">
  │   ...
  └── <script src="config/modules.js">                 ← Einstieg
        │
        └── njs.AppManager.initApp()
              │
              ├── POST ./loader.php { f: "/config/modules.conf", p: <profil> }
              │   └── loader.php löst Profil auf → JSON zurück
              │
              ├── Parst: defmodules, defbuttons, MenuPane, TrackBookmark
              │
              └── loadThemeMapOptions()
                    ├── POST loader.php → basemaps_mgr.conf
                    ├── POST loader.php → basemaps.conf
                    └── loadThemeModules()
                          ├── POST loader.php → lyrmgr.conf
                          ├── POST loader.php → layers.conf (multiple)
                          ├── POST loader.php → maptips.conf (multiple)
                          ├── POST loader.php → legends.conf
                          ├── POST loader.php → disclaimer.conf
                          └── POST loader.php → NLS-Dateien (lyrmgr/maptips/legend/tools...)
```

### loader.php

Der `loader.php` liegt auf dem Server (`/mapplus-lib/mapplus-dojo/v4.0.0/`) und ist nicht lokal im Workspace vorhanden. Er löst Konfigurationsanfragen auf:

1. **Profil-Pfad** prüfen: `config/<uprofile>/<datei>` (z.B. `config/nwpro/modules.conf`)
2. **Fallback**: `config/<datei>` (z.B. `config/modules.conf`)
3. JSON-Inhalt zurückgeben

---

## modules.conf — Aufbau

### Hauptstruktur

```json
{
    "TrackBookmark": { ... },
    "MenuPane": { ... },
    "defmodules": [ ... ],
    "defbuttons": { "main": { ... } },
    "logUser": { ... }
}
```

---

## MenuPane — Sidebar-Menü

Das MenuPane definiert die linke Seitenleiste mit ihren Akkordeon-Einträgen.

```json
"MenuPane": {
    "type": "freepane",
    "collapsible": true,
    "sync": true,
    "items": {
        "layer_menu":  { "label": "...", "icon": "...", "hideTitleArrow": true },
        "layer_menu2": { "label": "...", "icon": "..." },
        "layer_menu3": { "label": "...", "icon": "..." },
        "layer_menu4": { "label": "...", "icon": "..." },
        "wms_menu":    { "trigger_event": {"id": "toggle_importwms"} },
        "sort_menu":   { ... },
        "tools_menu":  { "trigger_event": {"id": "toolsPaneHide"} },
        "print_menu":  { "trigger_event": {"id": "toggle_pdf"} },
        "ov_menu":     { ... }
    },
    "icons": ["../core/templates/.../close_16.png", ".../open_16.png"]
}
```

### MenuPane-Item-Properties

| Property | Typ | Beschreibung |
|---|---|---|
| `label` | string | Anzeigename des Menüpunkts |
| `icon` | string | Icon-Pfad |
| `hideTitleArrow` | bool | Pfeil im Titel verstecken |
| `trigger_event.id` | string | Framework-Event beim Öffnen/Schliessen auslösen |

### Typische Menüpunkte

| Key | Beschreibung | Inhalt |
|---|---|---|
| `layer_menu` | Themen (Erster Kanton) | Layermanager-Instanz 1 (z.B. Nidwalden) |
| `layer_menu2` | Themen (Zweiter Kanton) | Layermanager-Instanz 2 (z.B. Obwalden) |
| `layer_menu3` | Themen Bund | Layermanager-Instanz 3 (Bundesebene) |
| `layer_menu4` | Freizeit & Tourismus | Layermanager-Instanz 4 |
| `wms_menu` | WMS Import | Externe WMS-Dienste einbinden |
| `sort_menu` | Dargestellte Themen | Reihenfolge aktiver Layer verwalten |
| `tools_menu` | Werkzeuge | Messen, Zeichnen, etc. |
| `print_menu` | Drucken | PDF-Export |
| `ov_menu` | Übersichtskarte | Übersichtskarte ein/aus |

> **TNET-Ergänzung**: Bei `useNewTree: true` lädt der TNET-Themenkatalog anstelle des Standard Dojo-Baums im `layer_menu`. Der Dojo-Baum bleibt im Hintergrund aktiv.

---

## defmodules — Aktive Module

Liste der Framework-Module, die beim Laden aktiviert werden:

```json
"defmodules": [
    "maptips",          // Info-Abfragen
    "editing",          // Editier-Funktionen
    "lyrmgr",           // Layermanager
    "legends",          // Legenden
    "printoptions",     // Druck/PDF
    "searchoptions",    // Standard-Suche
    "tools",            // Werkzeuge (Messen, Zeichnen)
    "snap",             // Snapping
    "selection",        // Selektion
    "streetview",       // Google Street View
    "disclaimer"        // Copyright-Hinweise
]
```

| Modul | Beschreibung |
|---|---|
| `maptips` | Info-Abfragen (GetFeatureInfo, MapTips) |
| `editing` | ArcGIS Feature-Editing |
| `lyrmgr` | Layermanager (Sidebar-Baum) |
| `legends` | Legenden-Anzeige |
| `printoptions` | PDF-Druck-Panel |
| `searchoptions` | Standard MapPlus-Suche |
| `tools` | Werkzeuge (Messen, Zeichnen, Redlining) |
| `snap` | Fang-Funktionen |
| `selection` | Feature-Selektion |
| `streetview` | Google Street View Integration |
| `disclaimer` | Copyright-Texte und Hinweise |

---

## defbuttons — Toolbar-Buttons

Definiert die Buttons in der Toolbar (typisch oben rechts/links).

```json
"defbuttons": {
    "main": {
        "ZoomIn": "btntool",
        "ZoomOut": "btntool",
        "Locate": "btntool",
        "InitialExtent": "btntool",
        "FullScreen": { "command": "njs.AppManager.goFullscreen('mapContainer')" },
        "Maps": "btntool",
        "Themes": { "togglePane": { "id": "storymap", "url": "public/pane/rightpane_#lang#.htm" } },
        "RemoveLayers": "btntool",
        "StreetView": "btntool",
        "3D": { "command": "njs.AppManager.start3D('main')" },
        "Help": { "togglePane": { "url": "./core/help/help_#lang#.htm" } },
        "geoportal": { "command": "openMapsInfoDialog();" },
        "Login": { "command": "window.location.href=..." }
    }
}
```

### Button-Typen

| Typ | Syntax | Beschreibung |
|---|---|---|
| Standard | `"btntool"` | Framework-interner Button (Verhalten vom Key abgeleitet) |
| Command | `{ "command": "js-code" }` | Beliebiger JavaScript-Befehl |
| TogglePane | `{ "togglePane": { "url": "...", "id": "..." } }` | Panel öffnen/schliessen |

### Profilunterschiede

| Button | Public | Pro-Profile (nwpro, uwpro, owpro) |
|---|---|---|
| `SplitView` | Fehlt | Vorhanden (togglePane mit Formular) |
| `Login` | Login-Redirect | **Logout** (`logout.php` / WP-Logout) |
| `geoportal` | `openMapsInfoDialog()` | Variiert je Profil |

---

## Weitere Sektionen

### TrackBookmark

```json
"TrackBookmark": { "active": true, "rl_id": "" }
```

Aktiviert Bookmark-Tracking (speichert Kartenausschnitt in URL-Hash).

### logUser

```json
"logUser": { "cgi": "logUser.php", "dbconn_id": "nwow" }
```

Sessionbasiertes User-Logging in die Server-Datenbank.

---

## Mobile (modules_m.conf)

Mobile verwendet eine **stark reduzierte** Konfiguration:

```json
{
    "MenuPane": { "type": "none" },
    "mainpane_container": "centerPaneLayout",
    "defbuttons": { "main": {} },
    "defmodules": [
        "lyrmgr", "maptips", "legends",
        "searchoptions", "tools", "disclaimer"
    ]
}
```

| Unterschied | Desktop | Mobile |
|---|---|---|
| MenuPane | `"freepane"` (Sidebar) | `"none"` |
| defbuttons | Vollständige Toolbar | Leer (TNET fügt eigene Buttons ein) |
| defmodules | 11 Module | 6 Module (kein editing, snap, selection, streetview, printoptions) |

---

## Config-Vererbung (Profile & Gruppen)

### Verzeichnisstruktur

```
maps/public/config/
├── modules.conf              ← Standard (public, kein Login)
├── modules_m.conf            ← Mobile-Variante
├── basemaps_mgr.conf         ← Basiskarten
├── lyrmgr.conf               ← Layer-Manager-Baum (Standard)
├── layers.conf               ← Layer-Definitionen (Zusatz)
│
├── nwpro/                    ← Profil: Nidwalden Pro
│   └── modules.conf
│
├── uwpro/                    ← Profil: Unterwalden Pro
│   ├── modules.conf
│   └── lyrmgr.conf           ← Eigener LyrMgr-Baum
│
├── owpro/                    ← Profil: Obwalden Pro
│   └── modules.conf
│
├── marco/                    ← Profil: Admin/Dev
│   ├── modules.conf
│   ├── editing.conf
│   └── maptips.confx          ← Deaktiviert (.confx)
│
└── nodi/                     ← Profil: Nodi
    └── lyrmgr.conf
```

### Vererbungsprinzip

```
loader.php empfängt: { f: "/config/modules.conf", p: "uwpro" }

1. Prüfe: config/uwpro/modules.conf → vorhanden? → zurückgeben
2. Fallback: config/modules.conf → zurückgeben
```

Datei-für-Datei: Jede Konfigurationsdatei (modules, lyrmgr, layers, maptips, basemaps_mgr, ...) kann pro Profil überschrieben werden. Nicht-überschriebene Dateien erben den Standard.

### Deaktivierte Configs

Dateien mit Endung `.confx` werden vom Framework ignoriert. Sie dienen als Vorlage oder deaktivierte Varianten.

---

## Server-Architektur

### Verzeichnisse

| Pfad | Beschreibung |
|---|---|
| `/www/maps/` | Web-Dokumentroot (öffentlich) |
| `/www/maps/public/` | Projekt-spezifische Dateien (HTML, CSS, Config) |
| `/www/maps/tnet/` | TNET-Erweiterungen (JS, PHP, CSS, Config) |
| `/www/maps/core/` | Mandantenebene (Config, NLS, Templates, Legenden) |
| `/www/core/` | Framework-Ebene (Config, NLS — wird von loader.php geladen) |
| `/www/mapplus-lib/` | MapPlus Framework (appmanager.js, common.js, ...) |
| `/data/Client_Data/nwow/` | Daten ausserhalb DocumentRoot (Logs, raw-conf, tmp) |
| `/data/Client_Data/nwow/raw-conf/` | Roh-Konfigurationen (ArcGIS-Import) |

### Framework-Dateien (mapplus-lib)

Das Framework liegt unter `/www/mapplus-lib/mapplus-dojo/v4.0.0/` und wird **nicht** lokal geändert. Lokale Kopien finden sich zu Referenzzwecken in `_temp_framework/`:

| Datei | Beschreibung |
|---|---|
| `appmanager.js` | Kern: initApp(), loadThemeMapOptions(), loadThemeModules() |
| `common.js` | Hilfs-Funktionen |
| `layout.js` | Layout-Management, MenuPane |
| `layers.js` | Layer-Verwaltung, addLayer(), removeLayer() |
| `maptips.js` | Info-Abfrage-Engine |
| `lyr_mgr.js` | ClassicLayerMgr (Standard-Layermanager) |
| `floatingwindow.js` | FloatingPane-Wrapper |

### core.config.php

```php
define('WMCM_DB', "nwow");
define('LOGGING_DB', "nwow");
define('API_VERSION', "v4.0.0");
define('API_URL', "../../../mapplus-lib/mapplus-dojo/");
define('API_PATH', "/var/www/html/mapplus-lib/mapplus-dojo/");
```

---

## Import-Pipeline (ArcGIS → Core)

### Ablauf

```
1. ArcGIS Server REST API
   ↓ Import-Script (Python)
2. Roh-Dateien: /data/Client_Data/nwow/raw-conf/<kürzel>/
   │
   │  z.B. raw-conf/gis_basis/
   │       ├── layers_TNET_gis_basis_GIS_Basisplan_v2.conf
   │       ├── maptips_TNET_gis_basis_GIS_Basisplan_v2.conf
   │       ├── lyrmgrResources_TNET_gis_basis_GIS_Basisplan_v2.json
   │       └── maptipsResources_TNET_gis_basis_GIS_Basisplan_v2.json
   │
   ↓ Staging-Merge (mehrere Dienste → zusammengeführt)
3. Staging: /data/Client_Data/nwow/raw-conf/ImportToCore/<kürzel>/
   │
   │  z.B. ImportToCore/gis_basis/
   │       ├── layers_gis_basis.conf
   │       ├── maptips_gis_basis.conf
   │       ├── lyrmgrResources_gis_basis.json
   │       └── maptipsResources_gis_basis.json
   │
   ↓ Deploy (mit Backup)
4. Produktiv:
   ├── /www/core/config/layers_gis_basis.conf
   ├── /www/core/config/maptips_gis_basis.conf
   ├── /www/core/nls/de/lyrmgrResources_gis_basis.json
   └── /www/core/nls/de/maptipsResources_gis_basis.json
```

### Prefix → Zielverzeichnis (Routing)

| Prefix | Ziel |
|---|---|
| `layers_*` | `/www/core/config/` |
| `maptips_*` | `/www/core/config/` |
| `lyrmgrResources_*` | `/www/core/nls/de/` |
| `maptipsResources_*` | `/www/core/nls/de/` |
| `legendResources_*` | `/www/core/nls/de/` |

### Deploy-Weg

Der ImportToCore-Transfer wird nicht mehr ueber ein Root-Spezialskript ausgefuehrt. Standard ist der SLM-/Config-Workflow; Core-Dateien werden bei Bedarf gezielt ueber `_scripts/deployment/deployengine/upload_core_config.py` deployt.

---

## Deployment-Workflow

### SFTP-Zugangsdaten

| Property | Wert |
|---|---|
| **Host** | `nwow.mapplus.ch` |
| **Port** | `22` |
| **User** | `trigonet` |
| **Remote-Basispfad** | `/www/maps` |
| **Lokaler Basispfad** | `c:\_Daten\mapplus-exp\maps` |
| **Bibliothek** | `paramiko` (Python) |

### Typischer Workflow

```bash
# 1. Geänderte Dateien nach DEV hochladen
py _scripts/deployment/deployengine/upload_changed.py --env dev

# Alternative: aktive Einzeldatei hochladen
py _scripts/deployment/deployengine/upload_active_file.py --env dev <datei>

# 3. Hard-Reload im Browser (Ctrl+Shift+R)
```

### Pfad-Mapping

```
Lokal:  c:\_Daten\mapplus-exp\maps\tnet\js\tnet-basemap.js
Remote: /www/maps/tnet/js/tnet-basemap.js
```

---

## Deploy-Skripte

### Offizielle Einstiegspunkte

| Skript | Zweck |
|---|---|
| `_scripts/deployment/deployengine/upload_changed.py` | Geänderte Dateien fuer DEV oder PROD hochladen |
| `_scripts/deployment/deployengine/upload_active_file.py` | Einzelne aktive Datei fuer DEV oder PROD hochladen |
| `_scripts/deployment/deployengine/promote_dev_to_prod.py` | DEV nach PROD promoten und optional deployen |
| `_scripts/deployment/deployengine/deploy_env.py` | DEV/PROD-Pfade und Deploy-Konfiguration |

### Build-Helfer

`_scripts/build/build_js.py` baut die PROD-Stage aus `maps-dev/tnet/js/` nach `maps-dev/tnet/js-stage/`. DEV laedt lesbare Original-JS direkt aus `maps-dev/tnet/js/`; PROD uebernimmt `js-stage/` nach `maps/tnet/js/` und die lesbaren Quellen nach `maps/tnet/js-src/`.

### Spezialfaelle

Direkte Spezial-Uploadskripte im `_scripts/`-Root sind entfernt. Fuer einzelne Dateien wird `deploy-active-file.bat` verwendet, fuer geaenderten Code `deploy-dev.bat` bzw. `release-full.bat`, fuer einen kompletten JS-Neubuild `release-full-rebuild.bat`; Configs laufen ueber `upload_config.py` oder `upload_core_config.py`.

### Multi-Pfad-Mapping

Manche Dateien müssen an mehrere Server-Pfade hochgeladen werden:

| Lokale Datei | Remote-Pfade |
|---|---|
| `inframe-maps.html` | `/www/maps/tnet/inframe-maps.html` + `/www/maps/tnet/views/inframe-maps.html` |
| `tnet-mapplus-helpers.js` | `/www/maps/tnet/js/tnet-mapplus-helpers.js` (+ ggf. `/www/maps/tnet/tnet-mapplus-helpers.js`) |

### VS Code Tasks

In `.vscode/tasks.json` sind folgende Aufgaben definiert:

| Task | Beschreibung |
|---|---|
| `Deploy DEV: Upload Changed Files` | Führt `_scripts/deployment/deployengine/upload_changed.py --env dev` aus |
| `Deploy PROD: Upload Changed Files` | Führt `_scripts/deployment/deployengine/upload_changed.py --env prod` aus |
| `Deploy DEV: Upload Active File` | Führt `_scripts/deployment/deployengine/upload_active_file.py --env dev` aus |
| `Release: Promote DEV to PROD` | Führt `_scripts/deployment/deployengine/promote_dev_to_prod.py` aus |

### Nach Upload

Immer **Hard-Reload** (`Ctrl+Shift+R`) im Browser durchführen, um den Cache zu aktualisieren.
