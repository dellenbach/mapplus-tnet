# Copilot-Projektregeln — MAP+ / TNET

> Diese Datei wird von GitHub Copilot automatisch als Kontext geladen.
> Alle Regeln sind verbindlich. Bei Konflikt: stoppen und Rückfrage stellen.

---

## Sprache & Dokumentation

- **Kommentare, Commit-Messages, Doku**: Deutsch
- **Variablen-/Funktionsnamen**: Englisch
- **JSDoc-Header** in jeder neuen JS-Datei:
  ```javascript
  /**
   * dateiname.js
   * Kurzbeschreibung
   *
   * @version    1.0
   * @date       YYYY-MM-DD
   * @copyright  Trigonet AG
   * @author     Marco Dellenbach
   */
  ```
- **Sektions-Kommentare**: `// ===== SECTION NAME =====`

---

## Code-Stil & Architektur

- **Kein TypeScript, kein Bundler** — Plain JS mit Script-Tags (Desktop) und Dojo AMD Loader (Mobile)
- **Module Pattern**: IIFE + `window.TnetXyz`-Exports
- **Dateinamen**: `tnet-` Präfix (neu), `tnet_` (ältere/mobile Dateien)
- **CSS-Variable**: `--m-color-primary: #4B7B81`
- **OpenLayers** als Karten-Bibliothek, **Dojo 1.x** als UI-Framework
- **Keine unnötigen Refactorings** — Änderungen minimal-invasiv halten

---

## Dojo / FloatingPane — Kritische Regeln

> Diese Regeln basieren auf schmerzhaften Debugging-Sessions. Unbedingt einhalten.

1. **`dojox/layout/FloatingPane` NICHT in den Haupt-`require([])`-Array** packen.
   Wenn das Modul fehlt, blockiert es den gesamten Callback → Layer laden nicht.
   → Immer in **nested** `require(['dojox/layout/FloatingPane'], fn)` laden.

2. **`dijit.byId('njs_info_pane').get('title')` NICHT verwenden.**
   Dojo setzt `widget.title` auf den HTML-Inhalt der Ergebnistabelle.
   → Titel immer als Fallback-String `'Objektinformation'` setzen.

3. **Dojo-Titelbar (`.dojoxFloatingPaneTitle`) nicht per CSS ersetzen/verstecken.**
   Dojo berechnet `contentInfo.style.top = titleBar.offsetHeight + 'px'`.
   Mit `display: none` → `offsetHeight = 0` → Content springt nach oben.
   → Stattdessen: **Kinder leeren**, eigenen Inhalt (Span + Buttons) einfügen.

4. **`.dojoxFloatingPaneTitleText` ist ein `<input type="text">`**, kein `<span>`.
   Inline-Styles (`background-image`, `border`, `-webkit-appearance`) sind nicht per CSS überschreibbar.
   → Per JS leeren und eigene Elemente einsetzen.

5. **`dojox/layout/TableContainer`** muss im `require()`-Array stehen,
   sonst werden Info-Ergebnistabellen nicht gerendert.

---

## Mobile — Info-Panel

- **Bottom-Sheet** Darstellung (`position: fixed; bottom: 0; height: 50vh`)
- **Titelbar**: Titel links, Aktions-Buttons (Kopieren, Schliessen) rechts
- **`picking = true`** muss auf allen Maps gesetzt sein, damit Info-Queries feuern.
  Desktop setzt es via Toolbar-Button; Mobile muss es im `tnet-app-ready` Listener setzen:
  ```javascript
  document.addEventListener('tnet-app-ready', function() {
      for (var id in njs.AppManager.Maps) {
          njs.AppManager.Maps[id].picking = true;
      }
  }, { once: true });
  ```
- **Dock-Button** auf Mobile ausblenden (`#info-pane-dock-btn { display: none }`)
- **Drag-Handle** oben im Sheet für Resize (`addMobileInfoSheetHandle()`)

---

## URL-Parameter & Layer-State

- `layers=` Parameter aus URL muss nach Reload erhalten bleiben
- Das Framework hat eine ADD→REMOVE→ADD Race Condition
- Fix: `ensureUrlLayers()` mit 3 Retry-Zeitpunkten (500ms, 1500ms, 3000ms) nach `tnet-app-ready`
- `TnetLayerSwitch(layerId, 'on')` zum Aktivieren
- **`tnet-app-ready` kann verspätet oder gar nicht feuern** (Splash-Timeout < Dojo-Ladezeit).
  → Nie allein auf das Event warten. Immer Polling-Fallback einbauen, der `njs.AppManager.Maps['main']` direkt prüft.

---

## Deployment

- **Produktive URL**: `www.gis-daten.ch` (öffentlich erreichbare Anwendung)
- **Server**: `nwow.mapplus.ch` (SFTP, Port 22, User: `trigonet`)
- **Remote-Basispfad**: `/www/maps/`
- **Daten-Basispfad**: `/data/Client_Data/nwow/` (Logs, raw-conf, tmp — ausserhalb von DocumentRoot)
- **raw-conf Pfad**: `/data/Client_Data/nwow/raw-conf`
- **Python-Interpreter**: `C:\Program Files\Python313\python.exe` (Python 3.13)
- **SFTP-Bibliothek**: `paramiko`

### Upload-Workflow

1. **Offizielle Deploy-Skripte**: `_scripts/deployment/deploy-dev/` und `_scripts/deployment/deploy-prod/`
   - DEV geaenderte Dateien: `_scripts/deployment/deploy-dev/deploy-dev.bat`
   - DEV aktive Datei: `_scripts/deployment/deploy-dev/deploy-active-file.bat <datei>`
   - PROD Release: `_scripts/deployment/deploy-prod/release-full.bat`
   - PROD Dry-Run: `_scripts/deployment/deploy-prod/release-dryrun.bat`
   - Technische Engine liegt unter `_scripts/deployment/deployengine/`

2. **Build-Helfer**: `_scripts/build/build_js.py`
   - DEV laedt lesbare Original-JS direkt aus `maps-dev/tnet/js/`.
   - PROD baut aus `maps/tnet/js_ori/` nach `maps/tnet/js/`:
     `C:\Program Files\Python313\python.exe _scripts/build/build_js.py --mode prod --src-root maps/tnet/js_ori --out-root maps/tnet/js --rebuild-all`
   - `maps/tnet/js/` ist Build-Artefakt; `maps/tnet/js_ori/` ist der lesbare PROD-Vorbereitungsstand.

3. **Spezialisierte Upload-Skripte**:
   - Aktive Spezialfaelle bleiben im `_scripts/`-Root, z.B. `_upload_lyrmgr_patch.py`, `_upload_helpers.py`, `_upload_basemap_js.py`, `_upload_search.py`, `_upload_proxy.py`, `_upload_bookmark.py`, `_upload_db_api.py`.
   - Alte/ersetzte Spezialuploads liegen unter `_scripts/legacy/` und sind nicht Standardworkflow.

4. **Typischer Ablauf fuer KI**:
   ```
   # 1. Aenderung in maps-dev/ vornehmen und lokal pruefen
   # 2. DEV deployen
   _scripts\deployment\deploy-dev\deploy-dev.bat
   # 3. Benutzer informieren: Hard-Reload (Ctrl+Shift+R) im Browser
   ```

5. **Wichtig**: Manche Dateien liegen auf dem Server an **mehreren Pfaden**.
   Bei solchen Dateien bevorzugt `_upload_active_file.py` oder ein gepflegtes Spezialskript verwenden und nach dem Upload den Remote-Pfad gezielt pruefen.

- ⚠ Passwort steht im Klartext in den Skripten — Empfehlung: auf Umgebungsvariable umstellen

---

## Desktop-Einstieg vs. Mobile-Einstieg

| | Desktop | Mobile |
|---|---|---|
| HTML | `index_de.htm` | `index_de_m.htm` |
| JS-Loader | Script-Tags | `tnet_modules_m.js` (AMD) |
| Info-Panel | FloatingPane, frei positionierbar | Bottom-Sheet, fixed |
| Erkennung | `window.__TNET_MOBILE_ENTRY` fehlt | `window.__TNET_MOBILE_ENTRY = true` |

---

## Konfigurationsdateien — Struktur & Schlüssel

> Detaillierte Analyse mit FK-Matrix: `maps/tnet/docs/CONFIG_SCHLUESSEL_FK_ANALYSE.md`

### Datei-Familien (pro Dienst / Kürzel)

| Präfix | Verzeichnis | Format | Inhalt |
|---|---|---|---|
| `layers_*.conf` | `core/config/` | JSON (als `.conf`) | Layer-Definitionen (URL, Typ, Sichtbarkeit, Legende) |
| `maptips_*.conf` | `core/config/` | JSON (als `.conf`) | Info-Abfragen (query_layers, linked_layer, nls, Felder) |
| `lyrmgrResources_*.json` | `core/nls/de/` | JSON | UI-Labels für Layer-Manager (`desc_<layerKey>`) |
| `maptipsResources_*.json` | `core/nls/de/` | JSON | Info-Panel Texte (`<nls>_title`, `<nls>_field_*`) |
| `legendResources_*.json` | `core/nls/de/` | JSON | Legenden-Titel und -Links (`<key>_title`, `<key>_link`) |

### Namenskonventionen

- **TNET-Dienste**: `layers_TNET_<kuerzel>_<Service>.conf` (z.B. `layers_TNET_ewn_EWN_NIS_gwr.conf`)
- **Allgemeine**: `layers_<quelle>.conf` (z.B. `layers_nodi_ch.conf`, `layers_geoadmin.conf`)
- **Layer-Keys (TNET)**: Hierarchisch mit `/` → `ewn/ewn_nis_gwr/gwr/egid`
- **Layer-Keys (NODI/Geoadmin)**: Flach → `gwr_address`, `ch.are.bauzonen`

### Join-Regeln (Kurzform)

1. **Layer → Maptip**: `maptips_*.conf[key].linked_layer` = Key in `layers_*.conf`
2. **Layer → Label**: `desc_` + `<layerKey>` = Key in `lyrmgrResources_*.json`
3. **Maptip → Text**: `maptips_*.conf[key].nls` als Präfix → `<nls>_title`, `<nls>_field_*` in `maptipsResources_*.json`
4. **Layer → Legende**: `layers_*.conf[key].legend` → `<legend>_title` / `<legend>_link` in `legendResources_*.json`

### AGS Import/Staging Pipeline

- **Import**: ArcGIS Server REST → Roh-Conf-Dateien unter `/data/Client_Data/nwow/raw-conf/<kuerzel>/`
- **Staging Merge**: Mehrere Dienste → zusammengeführte Dateien unter `/data/Client_Data/nwow/raw-conf/ImportToCore/<kuerzel>/`
- **Duplikat-Metadaten**: `.duplicates.json` pro Kürzel-Verzeichnis speichert `{dateiname: [{key, count, sources}]}`
- **Output-Dateien**: `<prefix>_<kuerzel>.<ext>` (z.B. `layers_ewn.conf`, `lyrmgrResources_ewn.json`)
- **Prefixe → Buckets**: `layers` → `.conf`, `maptips` → `.conf`, `lyrmgrResources` → `.json`, `maptipsResources` → `.json`

---

## Workflow-Regeln für die KI

1. **Nach jedem Bug-Fix**: Ergänze `docs/ai-lessons-learned.md` mit:
   - Symptom (1 Zeile)
   - Root-Cause (1 Zeile)
   - Fix (1–2 Zeilen)
   - Guardrail (1 Zeile)

2. **Vor Framework-Änderungen**: Prüfe ob Dojo-Lifecycle betroffen ist.
   Im Zweifel: nested `require()` statt Haupt-Array.

3. **CSS auf Mobile**: Immer `!important` verwenden — Dojo setzt Inline-Styles.

4. **Testing**: Nach Upload immer Hard-Reload (Ctrl+Shift+R) im Browser empfehlen.

5. **Konsolen-Befehle**: Wenn der Benutzer mehrere Befehle in die Browser-Konsole eingeben soll,
   diese immer **zusätzlich als kopierfertigen Block** (alle Befehle am Stück) bereitstellen.
