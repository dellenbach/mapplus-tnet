# 7 â€” Module, Lade-Kette & Deployment

> **Dateien**: `modules.conf`, `modules_m.conf`, `modules.js`  
> **Pfad**: `maps/public/config/` (+ Profil-Unterordner)  
> **Tydac-Doku**: https://cloud.mapplus.ch/mapplusv4_doku/de:modules

---

## Inhaltsverzeichnis

- [Ãœberblick](#Ã¼berblick)
- [Lade-Kette](#lade-kette)
- [modules.conf â€” Aufbau](#modulesconf--aufbau)
- [MenuPane â€” Sidebar-MenÃ¼](#menupane--sidebar-menÃ¼)
- [defmodules â€” Aktive Module](#defmodules--aktive-module)
- [defbuttons â€” Toolbar-Buttons](#defbuttons--toolbar-buttons)
- [Weitere Sektionen](#weitere-sektionen)
- [Mobile (modules_m.conf)](#mobile-modules_mconf)
- [Config-Vererbung (Profile & Gruppen)](#config-vererbung-profile--gruppen)
- [Server-Architektur](#server-architektur)
- [Import-Pipeline (ArcGIS â†’ Core)](#import-pipeline-arcgis--core)
- [Deployment-Workflow](#deployment-workflow)
- [Upload-Skripte](#upload-skripte)

---

## Ãœberblick

`modules.conf` ist die zentrale Steuerungsdatei, die bestimmt:
- Welche **Module** geladen werden (MapTips, Layermanager, Legende, ...)
- Welche **Toolbar-Buttons** angezeigt werden
- Wie das **Sidebar-MenÃ¼** (MenuPane) aufgebaut ist
- Ob **Tracking/Logging** aktiv ist

---

## Lade-Kette

```
Browser â†’ index_de.htm
  â”‚
  â”œâ”€â”€ <script src="/mapplus-lib/.../appmanager.js">    â† Framework
  â”œâ”€â”€ <script src="/mapplus-lib/.../common.js">
  â”œâ”€â”€ <script src="/mapplus-lib/.../layout.js">
  â”œâ”€â”€ <script src="/mapplus-lib/.../layers.js">
  â”œâ”€â”€ <script src="/mapplus-lib/.../maptips.js">
  â”‚   ...
  â””â”€â”€ <script src="config/modules.js">                 â† Einstieg
        â”‚
        â””â”€â”€ njs.AppManager.initApp()
              â”‚
              â”œâ”€â”€ POST ./loader.php { f: "/config/modules.conf", p: <profil> }
              â”‚   â””â”€â”€ loader.php lÃ¶st Profil auf â†’ JSON zurÃ¼ck
              â”‚
              â”œâ”€â”€ Parst: defmodules, defbuttons, MenuPane, TrackBookmark
              â”‚
              â””â”€â”€ loadThemeMapOptions()
                    â”œâ”€â”€ POST loader.php â†’ basemaps_mgr.conf
                    â”œâ”€â”€ POST loader.php â†’ basemaps.conf
                    â””â”€â”€ loadThemeModules()
                          â”œâ”€â”€ POST loader.php â†’ lyrmgr.conf
                          â”œâ”€â”€ POST loader.php â†’ layers.conf (multiple)
                          â”œâ”€â”€ POST loader.php â†’ maptips.conf (multiple)
                          â”œâ”€â”€ POST loader.php â†’ legends.conf
                          â”œâ”€â”€ POST loader.php â†’ disclaimer.conf
                          â””â”€â”€ POST loader.php â†’ NLS-Dateien (lyrmgr/maptips/legend/tools...)
```

### loader.php

Der `loader.php` liegt auf dem Server (`/mapplus-lib/mapplus-dojo/v4.0.0/`) und ist nicht lokal im Workspace vorhanden. Er lÃ¶st Konfigurationsanfragen auf:

1. **Profil-Pfad** prÃ¼fen: `config/<uprofile>/<datei>` (z.B. `config/nwpro/modules.conf`)
2. **Fallback**: `config/<datei>` (z.B. `config/modules.conf`)
3. JSON-Inhalt zurÃ¼ckgeben

---

## modules.conf â€” Aufbau

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

## MenuPane â€” Sidebar-MenÃ¼

Das MenuPane definiert die linke Seitenleiste mit ihren Akkordeon-EintrÃ¤gen.

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
| `label` | string | Anzeigename des MenÃ¼punkts |
| `icon` | string | Icon-Pfad |
| `hideTitleArrow` | bool | Pfeil im Titel verstecken |
| `trigger_event.id` | string | Framework-Event beim Ã–ffnen/Schliessen auslÃ¶sen |

### Typische MenÃ¼punkte

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
| `ov_menu` | Ãœbersichtskarte | Ãœbersichtskarte ein/aus |

> **TNET-ErgÃ¤nzung**: Bei `useNewTree: true` lÃ¤dt der TNET-Themenkatalog anstelle des Standard Dojo-Baums im `layer_menu`. Der Dojo-Baum bleibt im Hintergrund aktiv.

---

## defmodules â€” Aktive Module

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

## defbuttons â€” Toolbar-Buttons

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
| TogglePane | `{ "togglePane": { "url": "...", "id": "..." } }` | Panel Ã¶ffnen/schliessen |

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
| defbuttons | VollstÃ¤ndige Toolbar | Leer (TNET fÃ¼gt eigene Buttons ein) |
| defmodules | 11 Module | 6 Module (kein editing, snap, selection, streetview, printoptions) |

---

## Config-Vererbung (Profile & Gruppen)

### Verzeichnisstruktur

```
maps/public/config/
â”œâ”€â”€ modules.conf              â† Standard (public, kein Login)
â”œâ”€â”€ modules_m.conf            â† Mobile-Variante
â”œâ”€â”€ basemaps_mgr.conf         â† Basiskarten
â”œâ”€â”€ lyrmgr.conf               â† Layer-Manager-Baum (Standard)
â”œâ”€â”€ layers.conf               â† Layer-Definitionen (Zusatz)
â”‚
â”œâ”€â”€ nwpro/                    â† Profil: Nidwalden Pro
â”‚   â””â”€â”€ modules.conf
â”‚
â”œâ”€â”€ uwpro/                    â† Profil: Unterwalden Pro
â”‚   â”œâ”€â”€ modules.conf
â”‚   â””â”€â”€ lyrmgr.conf           â† Eigener LyrMgr-Baum
â”‚
â”œâ”€â”€ owpro/                    â† Profil: Obwalden Pro
â”‚   â””â”€â”€ modules.conf
â”‚
â”œâ”€â”€ marco/                    â† Profil: Admin/Dev
â”‚   â”œâ”€â”€ modules.conf
â”‚   â”œâ”€â”€ editing.conf
â”‚   â””â”€â”€ maptips.confx          â† Deaktiviert (.confx)
â”‚
â””â”€â”€ nodi/                     â† Profil: Nodi
    â””â”€â”€ lyrmgr.conf
```

### Vererbungsprinzip

```
loader.php empfÃ¤ngt: { f: "/config/modules.conf", p: "uwpro" }

1. PrÃ¼fe: config/uwpro/modules.conf â†’ vorhanden? â†’ zurÃ¼ckgeben
2. Fallback: config/modules.conf â†’ zurÃ¼ckgeben
```

Datei-fÃ¼r-Datei: Jede Konfigurationsdatei (modules, lyrmgr, layers, maptips, basemaps_mgr, ...) kann pro Profil Ã¼berschrieben werden. Nicht-Ã¼berschriebene Dateien erben den Standard.

### Deaktivierte Configs

Dateien mit Endung `.confx` werden vom Framework ignoriert. Sie dienen als Vorlage oder deaktivierte Varianten.

---

## Server-Architektur

### Verzeichnisse

| Pfad | Beschreibung |
|---|---|
| `/www/maps/` | Web-Dokumentroot (Ã¶ffentlich) |
| `/www/maps/public/` | Projekt-spezifische Dateien (HTML, CSS, Config) |
| `/www/maps/tnet/` | TNET-Erweiterungen (JS, PHP, CSS, Config) |
| `/www/maps/core/` | Mandantenebene (Config, NLS, Templates, Legenden) |
| `/www/core/` | Framework-Ebene (Config, NLS â€” wird von loader.php geladen) |
| `/www/mapplus-lib/` | MapPlus Framework (appmanager.js, common.js, ...) |
| `/data/Client_Data/nwow/` | Daten ausserhalb DocumentRoot (Logs, raw-conf, tmp) |
| `/data/Client_Data/nwow/raw-conf/` | Roh-Konfigurationen (ArcGIS-Import) |

### Framework-Dateien (mapplus-lib)

Das Framework liegt unter `/www/mapplus-lib/mapplus-dojo/v4.0.0/` und wird **nicht** lokal geÃ¤ndert. Lokale Kopien finden sich zu Referenzzwecken in `_temp_framework/`:

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

## Import-Pipeline (ArcGIS â†’ Core)

### Ablauf

```
1. ArcGIS Server REST API
   â†“ Import-Script (Python)
2. Roh-Dateien: /data/Client_Data/nwow/raw-conf/<kÃ¼rzel>/
   â”‚
   â”‚  z.B. raw-conf/gis_basis/
   â”‚       â”œâ”€â”€ layers_TNET_gis_basis_GIS_Basisplan_v2.conf
   â”‚       â”œâ”€â”€ maptips_TNET_gis_basis_GIS_Basisplan_v2.conf
   â”‚       â”œâ”€â”€ lyrmgrResources_TNET_gis_basis_GIS_Basisplan_v2.json
   â”‚       â””â”€â”€ maptipsResources_TNET_gis_basis_GIS_Basisplan_v2.json
   â”‚
   â†“ Staging-Merge (mehrere Dienste â†’ zusammengefÃ¼hrt)
3. Staging: /data/Client_Data/nwow/raw-conf/ImportToCore/<kÃ¼rzel>/
   â”‚
   â”‚  z.B. ImportToCore/gis_basis/
   â”‚       â”œâ”€â”€ layers_gis_basis.conf
   â”‚       â”œâ”€â”€ maptips_gis_basis.conf
   â”‚       â”œâ”€â”€ lyrmgrResources_gis_basis.json
   â”‚       â””â”€â”€ maptipsResources_gis_basis.json
   â”‚
   â†“ Deploy (mit Backup)
4. Produktiv:
   â”œâ”€â”€ /www/core/config/layers_gis_basis.conf
   â”œâ”€â”€ /www/core/config/maptips_gis_basis.conf
   â”œâ”€â”€ /www/core/nls/de/lyrmgrResources_gis_basis.json
   â””â”€â”€ /www/core/nls/de/maptipsResources_gis_basis.json
```

### Prefix â†’ Zielverzeichnis (Routing)

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
| **Lokaler Basispfad** | `c:\_Daten\mapplus-tnet\maps` |
| **Bibliothek** | `paramiko` (Python) |

### Typischer Workflow

```bash
# 1. GeÃ¤nderte Dateien nach DEV hochladen
py _scripts/deployment/deployengine/upload_changed.py --env dev

# Alternative: aktive Einzeldatei hochladen
py _scripts/deployment/deployengine/upload_active_file.py --env dev <datei>

# 3. Hard-Reload im Browser (Ctrl+Shift+R)
```

### Pfad-Mapping

```
Lokal:  c:\_Daten\mapplus-tnet\maps\tnet\js\tnet-basemap.js
Remote: /www/maps/tnet/js/tnet-basemap.js
```

---

## Deploy-Skripte

### Offizielle Einstiegspunkte

| Skript | Zweck |
|---|---|
| `_scripts/deployment/deployengine/upload_changed.py` | GeÃ¤nderte Dateien fuer DEV oder PROD hochladen |
| `_scripts/deployment/deployengine/upload_active_file.py` | Einzelne aktive Datei fuer DEV oder PROD hochladen |
| `_scripts/deployment/deployengine/promote_dev_to_prod.py` | DEV nach PROD promoten und optional deployen |
| `_scripts/deployment/deployengine/deploy_env.py` | DEV/PROD-Pfade und Deploy-Konfiguration |

### Build-Helfer

`_scripts/build/build_js.py` baut die PROD-Stage aus `maps-dev/tnet/js/` nach `maps-dev/tnet/js-stage/`. DEV laedt lesbare Original-JS direkt aus `maps-dev/tnet/js/`; PROD uebernimmt `js-stage/` nach `maps/tnet/js/` und die lesbaren Quellen nach `maps/tnet/js-src/`.

### Spezialfaelle

Direkte Spezial-Uploadskripte im `_scripts/`-Root sind entfernt. Fuer einzelne Dateien wird `deploy-active-file.bat` verwendet, fuer geaenderten Code `deploy-dev.bat` bzw. `release-full.bat`, fuer einen kompletten JS-Neubuild `release-full-rebuild.bat`; Configs laufen ueber `upload_config.py` oder `upload_core_config.py`.

### Multi-Pfad-Mapping

Manche Dateien mÃ¼ssen an mehrere Server-Pfade hochgeladen werden:

| Lokale Datei | Remote-Pfade |
|---|---|
| `inframe-maps.html` | `/www/maps/tnet/inframe-maps.html` + `/www/maps/tnet/views/inframe-maps.html` |
| `tnet-mapplus-helpers.js` | `/www/maps/tnet/js/tnet-mapplus-helpers.js` (+ ggf. `/www/maps/tnet/tnet-mapplus-helpers.js`) |

### VS Code Tasks

In `.vscode/tasks.json` sind folgende Aufgaben definiert:

| Task | Beschreibung |
|---|---|
| `Deploy DEV: Upload Changed Files` | FÃ¼hrt `_scripts/deployment/deployengine/upload_changed.py --env dev` aus |
| `Deploy PROD: Upload Changed Files` | FÃ¼hrt `_scripts/deployment/deployengine/upload_changed.py --env prod` aus |
| `Deploy DEV: Upload Active File` | FÃ¼hrt `_scripts/deployment/deployengine/upload_active_file.py --env dev` aus |
| `Release: Promote DEV to PROD` | FÃ¼hrt `_scripts/deployment/deployengine/promote_dev_to_prod.py` aus |

### Nach Upload

Immer **Hard-Reload** (`Ctrl+Shift+R`) im Browser durchfÃ¼hren, um den Cache zu aktualisieren.

