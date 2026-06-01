# DEV- und Deploy-Workflow

## Zweck

Diese Doku beschreibt den aktuellen Entwicklungs-, Test- und Deploy-Prozess fuer `maps-dev` und `maps`.

Schwerpunkt:

- sichere kuenftige Editierungen
- DEV-first Workflow
- Promotion von DEV nach PROD
- typische Fehlerquellen bei Pfaden, Builds und Deployments

## Kurzfassung

Der Arbeitsbaum fuer normale Weiterentwicklung ist `maps-dev/`.

Grundregel:

1. Aenderungen in `maps-dev/` machen
2. lokal oder mit technischen Checks pruefen
3. nach `/www/maps-dev` deployen
4. gegen `https://www.gis-daten.ch/maps-dev/` pruefen
5. erst nach erfolgreichem DEV-Test `maps-dev/` lokal nach `maps/` uebernehmen
6. danach `/www/maps` deployen

`maps/` ist damit Release- und PROD-Baum, nicht der primaere Editier-Baum fuer normale Weiterentwicklung.

## Verzeichnisrollen

### `maps-dev/`

Der aktive Entwicklungsbaum fuer die Webanwendung unter `/maps-dev`.

Hier werden normale Aenderungen an Frontend, PHP-Endpunkten, HTML und Ressourcen zuerst umgesetzt.

### `maps/`

Der Release-/Produktionsbaum fuer die Webanwendung unter `/maps`.

Hier sollten Aenderungen im Normalfall nicht zuerst entwickelt werden. Der Regelfall ist:

- zuerst `maps-dev/` aendern
- dort pruefen
- danach per lokalem Sync nach `maps/` uebernehmen

### `core/`

Geteilte Basis fuer beide Umgebungen.

`core/` bleibt der produktive Basis-Core. Aenderungen dort wirken potenziell auf PROD und duerfen nicht als normaler DEV-Edit behandelt werden.

### `core-dev/`

Getrennter DEV-Core fuer Laufzeitdaten.

Mindestens diese Bereiche werden in DEV bevorzugt aus `core-dev/` gelesen:

- `core-dev/config/`
- `core-dev/nls/`

Wenn ein Unterordner in `core-dev/` noch fehlt, darf die DEV-Runtime nicht auf `core/` zurueckfallen. Fehlende DEV-Core-Dateien muessen sichtbar fehlschlagen, damit DEV nicht versehentlich produktive Core-Dateien verwendet.

### `_scripts/`

Geteilte Betriebs- und Deploy-Skripte.

Aenderungen hier betreffen den Workflow selbst, nicht nur die Anwendung. Besonders wichtig sind:

- `_scripts/deployment/deployengine/deploy_env.py`
- `_scripts/deployment/deployengine/upload_changed.py`
- `_scripts/deployment/deployengine/upload_active_file.py`
- `_scripts/deployment/deployengine/promote_dev_to_prod.py`
- `_scripts/_build_js.py`

## Kuenftiges Editieren

### Grundregel fuer neue Aenderungen

Wenn eine Datei sowohl unter `maps-dev/` als auch unter `maps/` existiert, wird im Regelfall **nur die Datei unter `maps-dev/`** bearbeitet.

Erst nach erfolgreichem DEV-Test wird der Stand nach `maps/` uebernommen.

### Typische Editierziele

- Frontend-JS: `maps-dev/tnet/js-dev/`
- gebaute JS-Artefakte: `maps-dev/tnet/js/`
- PHP-Endpunkte: `maps-dev/tnet/api/`, `maps-dev/tnet/php/`
- HTML/Einstiegspunkte: `maps-dev/index.php`, `maps-dev/public/`
- CSS/Ressourcen: `maps-dev/tnet/css/`, `maps-dev/tnet/resources/`

### Was nicht der erste Editierort sein sollte

- `maps/` fuer normale Weiterentwicklung
- direkt gebaute Artefakte unter `maps-dev/tnet/js/`, wenn die Quelle unter `maps-dev/tnet/js-dev/` existiert

Wenn es eine Quelldatei unter `js-dev/` gibt, wird diese bearbeitet. Der Build- und Upload-Prozess erzeugt daraus die Datei unter `js/`.

### Ausnahmefaelle

Direktes Editieren in `maps/` ist nur sinnvoll, wenn bewusst ein PROD-spezifischer Hotfix gemacht wird. Das sollte die Ausnahme bleiben, weil DEV und PROD sonst schnell auseinanderlaufen.

## Editierregeln fuer env-aware Code

Die haeufigste Fehlerklasse in diesem Projekt sind hart codierte PROD-Pfade.

### Niemals fest verdrahten

Diese Werte sollten in Runtime-Code nicht direkt hart codiert werden:

- `/maps`
- `/www/maps`
- `/data/Client_Data/nwow`
- `/www/core`

Fuer Core-Config und Core-NLS in PHP den zentralen Resolver `TnetCorePaths` verwenden:

- DEV: `core-dev/config`, `core-dev/nls/<lang>`
- PROD: `core/config`, `core/nls/<lang>`

### Frontend-Regel

Im Frontend immer den aktuellen App-Root verwenden, typischerweise ueber:

- `window.__TNET_APP_ROOT`
- lokale Hilfsfunktion wie `getAppRoot()`

Ziel ist, dass derselbe Code sowohl unter `/maps` als auch unter `/maps-dev` laeuft.

### PHP-Regel

In PHP den App-Root aus Request-Pfaden ableiten, nicht aus festem String.

Wichtig:

- nicht blind `dirname($_SERVER['SCRIPT_NAME'])` als App-Root verwenden
- fuer Verzeichnis-Requests immer auf den ersten App-Pfadteil reduzieren: `/maps` oder `/maps-dev`
- bei Bedarf `REQUEST_URI` als Fallback verwenden

### Proxy-Regel

Proxy- und API-Pfade muessen app-root-aware aufgebaut werden.

Beispiele fuer korrekte Zielmuster:

- `/maps/tnet/agsproxy/...`
- `/maps-dev/tnet/agsproxy/...`
- `/maps/tnet/api/v1/...`
- `/maps-dev/tnet/api/v1/...`

Falsche Muster sind zum Beispiel:

- `/maps-dev//maps/...`
- `/maps-dev/tnet/api/v1/tnet/agsproxy/...`
- `/tnet/agsproxy/...` ohne App-Root

## Lokaler Workflow

### 1. Initialer Seed von PROD nach DEV

Wenn `maps-dev/` neu aufgebaut oder erneut auf PROD-Basis gesetzt werden soll:

- VS-Code-Task: `DEV: Seed maps-dev from maps`

Der Task verwendet bewusst `robocopy /E` und loescht im Ziel standardmaessig nichts.

Verwendung:

- initialer DEV-Start
- groessere Nachsynchronisation von PROD nach DEV
- Reset des DEV-Baums auf einen bekannten Ausgangspunkt

### 2. Normale taegliche Entwicklung

Regelablauf:

1. Datei in `maps-dev/` aendern
2. lokal pruefen, zum Beispiel ueber Code-Review, Build, Lint, Tests oder gezielte API-/Skript-Checks
3. geaenderte Datei(en) nach `/www/maps-dev` deployen
4. Browser per Hard-Reload neu laden
5. erst dann die Remote-Route unter `https://www.gis-daten.ch/maps-dev/` pruefen

### 3. DEV-Deploy

### Standardfall: mehrere Aenderungen

VS-Code-Task:

- `Deploy DEV: Upload Changed Files`

CLI:

```powershell
& "C:/Program Files/Python313/python.exe" _scripts/deployment/deployengine/upload_changed.py --env dev
```

### Standardfall: einzelne Datei

VS-Code-Task:

- `Deploy DEV: Upload Active File`

Batch-Wrapper:

- `_scripts/deployment/deploy-dev/deploy-active-file.bat <datei>`

CLI:

```powershell
& "C:/Program Files/Python313/python.exe" _scripts/deployment/deployengine/upload_active_file.py --env dev <datei>
```

Diese Variante ist die sicherste, wenn gezielt nur ein Fix auf DEV aktualisiert werden soll.

### Einzeldatei direkt nach PROD

VS-Code-Task:

- `Deploy PROD: Upload Active File`

Batch-Wrapper:

- `_scripts/deployment/deploy-prod/deploy-active-file.bat <datei>`

Wichtig:

- bei `--env prod` duerfen Dateipfade sowohl unter `maps/` als auch unter `maps-dev/` liegen
- Dateipfade unter `maps-dev/` werden vor dem Upload lokal nach `maps/` synchronisiert
- fuer `tnet/js-dev/*.js` laeuft danach automatisch der PROD-Build

### Spezialfall: geschuetzte Config-Dateien

Bestimmte Config-Dateien sind absichtlich geschuetzt und werden von Changed-Files-Deploys nicht einfach so mitgenommen.

Beispiele:

- `core/config/`
- `core/nls/`
- `public/config/`
- `tnet/config/`

Wenn solche Dateien bewusst deployt werden sollen, muss das explizit freigegeben werden:

```powershell
& "C:/Program Files/Python313/python.exe" _scripts/deployment/deployengine/upload_changed.py --env dev --allow-config --reason "kurze Begruendung"
```

Guardrail:

Config-Deploys nie nebenbei ausfuehren. Immer bewusst mit Grund.

## JS-Build-Verhalten

`js-dev/` ist die Quelle. `js/` ist das Build-/Deploy-Ziel.

Build-Modi:

- DEV (`--env dev`): lesbarer Build ohne Minify
- PROD (`--env prod`): minifizierter + obfuskierter Build

Die Deploy-Skripte leiten den Modus automatisch aus `--env` ab und rufen `_scripts/_build_js.py --mode dev|prod` auf.

Wichtig:

- `tnet/js-dev/*.js` niemals direkt auf den Server laden
- Upload-Skripte bauen `js-dev` zuerst und laden danach die passende Datei unter `js/` hoch

Das gilt fuer:

- `_upload_changed.py`
- `_upload_active_file.py`

Fuer GitHub-/Release-Commits kann `_scripts/deployment/deploy-prod/git-commit.bat` vor dem Staging den lokalen Abgleich `maps-dev -> maps` anstossen, damit beide Baeume vor dem Commit konsistent sind.

Wenn ein JS-Fix nicht auf dem Server ankommt, zuerst pruefen:

1. wurde die Quelldatei unter `js-dev/` geaendert?
2. lief der Build erfolgreich?
3. existiert danach die erwartete Datei unter `tnet/js/`?

## PostgreSQL

PostgreSQL ist fuer normale DEV-Kartenentwicklung nicht zwingend. Der DEV-Default fuer den LayerManager bleibt dateibasiert, wenn `layerManager.lyrmgrSource: 'file'` gesetzt ist.

Wenn DB-Workflows genutzt werden:

- PROD nutzt standardmaessig Schema `mapplusconf`
- DEV nutzt standardmaessig Schema `mapplusconf_dev`
- Override ist per `MAPPLUS_DB_SCHEMA` oder `db_config.php`-Schluessel `schema` moeglich

Der PHP-Wrapper `Database.php` setzt den `search_path` und schreibt historische `mapplusconf.`-SQL-Qualifizierungen zur Laufzeit auf das aktive Schema um.

## FastAPI / ags2mapplus

Der FastAPI-Dienst unter `/gapi/ags2mapplus` ist serverseitig separat von SFTP-Deploys unter `/www`.

DEV-Regel:

- PHP-Aufrufe an ags2mapplus senden `target=dev`
- DEV-Admin-HTMLs ergaenzen bei direkten `/gapi/ags2mapplus`-Fetches automatisch `target=dev`
- Pfade aus DEV-PHP muessen bereits auf `/data/Client_Data/nwow-dev` oder `/www/core-dev` zeigen, bevor FastAPI deployed

Wichtig: Aenderungen am eigentlichen FastAPI-Code unter `C:\FastAPI\ags2mapplus` koennen nicht per SFTP-Deploy aus diesem Workspace aktualisiert werden.

## DEV-Validierung

Nach einem DEV-Deploy mindestens diese Punkte pruefen:

Wichtig:

- lokale Validierung kann vor dem Deploy stattfinden
- die echte Pruefung gegen `https://www.gis-daten.ch/maps-dev/` ist natuerlich erst nach dem DEV-Deploy sinnvoll

### Browser

- Hard-Reload mit `Ctrl+Shift+R`
- betroffene Route direkt auf `/maps-dev/...` pruefen
- Konsole auf 404, ReferenceError und Proxy-Fehler pruefen

### API

- `https://www.gis-daten.ch/maps-dev/tnet/api/v1/info`
- betroffene API-Endpunkte mit `nocache=1` gegenpruefen, falls Caches eine Rolle spielen

### Typische Pruefpunkte

- Einstiegspunkt aktuell?
- werden CSS/JS-Dateien unter `/maps-dev/...` geladen?
- sind Proxy-URLs korrekt app-root-aware?
- laeuft die Route visuell wie erwartet?

## Release von DEV nach PROD

### 1. Lokale Promotion von `maps-dev/` nach `maps/`

VS-Code-Task:

- `PROD: Sync maps-dev to maps (local robocopy)`

Dieser Schritt aendert **nur den lokalen PROD-Baum**.

Er deployt noch nichts auf den Server.

### 2. Dry Run fuer kompletten Release

VS-Code-Task:

- `Release: Promote DEV to PROD (Dry Run, local robocopy + SFTP)`

CLI:

```powershell
& "C:/Program Files/Python313/python.exe" _scripts/deployment/deployengine/promote_dev_to_prod.py --dry-run --deploy-prod
```

Verwendung:

- vor groesseren Releases
- zur Plausibilisierung von Sync und Upload

### 3. Echter Release

VS-Code-Task:

- `Release: Promote DEV to PROD (local robocopy + SFTP)`

CLI:

```powershell
& "C:/Program Files/Python313/python.exe" _scripts/deployment/deployengine/promote_dev_to_prod.py --deploy-prod
```

### 4. Optional: separater PROD-Deploy

Wenn `maps/` bereits lokal aktuell ist:

- VS-Code-Task: `Deploy PROD: Upload Changed Files`

CLI:

```powershell
& "C:/Program Files/Python313/python.exe" _scripts/deployment/deployengine/upload_changed.py --env prod
```

## GitHub-Workflow

GitHub ist in diesem Projekt die Quelle fuer Quellcode, Review, Historie und Release-Nachvollziehbarkeit.

GitHub ist aber nicht automatisch der Beweis fuer den tatsaechlichen Serverstand. Der reale Stand auf `/www/maps-dev` oder `/www/maps` muss weiterhin per Deploy und Browser-/API-Pruefung validiert werden.

### Rollenmodell

- `maps-dev/` ist der normale Editierbaum fuer neue Aenderungen.
- `maps/` ist der lokale Release-/PROD-Baum und wird nur bewusst per Promotion aktualisiert.
- Git-Commits dokumentieren den Quellstand.
- DEV-/PROD-Deploys dokumentieren und pruefen den Serverstand.
- Release-Tags oder klare Release-Commits markieren produktive Staende.

### Normaler GitHub-Ablauf

1. Feature-Branch von `main` erstellen.
2. Aenderungen in `maps-dev/` und ggf. gemeinsamen Skripten/Dokus umsetzen.
3. Lokal pruefen.
4. Nach `/www/maps-dev` deployen und gegen `https://www.gis-daten.ch/maps-dev/` testen.
5. Pull Request erstellen.
6. PR-Checkliste ausfuellen und Testergebnis beschreiben.
7. Nach Review und DEV-Abnahme mergen.
8. Fuer Release `maps-dev/` lokal nach `maps/` promoten.
9. PROD deployen und produktiven Stand optional per Git-Tag markieren.

### PR-Regeln

Ein PR sollte klar beantworten:

- Wurde in `maps-dev/` statt direkt in `maps/` gearbeitet?
- Wurde lokal geprueft?
- Wurde nach DEV deployed und remote getestet?
- Sind geschuetzte Config-Dateien betroffen?
- Muss `docs/ai-lessons-learned.md` ergaenzt werden?
- Hat die Aenderung Auswirkungen auf PROD-Promotion oder Deploy-Skripte?

### CI-Regel

GitHub Actions sollen standardmaessig gegen DEV testen, nicht gegen PROD.

Der Default fuer `TNET_BASE_URL` ist daher:

```text
https://www.gis-daten.ch/maps-dev/tnet/php
```

Falls Tests bewusst gegen eine andere Umgebung laufen sollen, muss `TNET_BASE_URL` im Workflow oder im Testaufruf explizit angepasst werden.

### Was GitHub aktuell nicht automatisch tun soll

GitHub Actions sollen aktuell nicht automatisch nach DEV oder PROD deployen.

Gruende:

- SFTP-Secrets sind noch nicht sauber aus den lokalen Skripten herausgeloest.
- Config-Deploys brauchen bewusste Freigabe.
- `upload_state.*.json` ist lokaler Zustand und nicht GitHub-Zustand.
- Server-Drift muss weiterhin aktiv verifiziert werden.
- Rollback- und Freigabemodell fuer Auto-Deploys ist noch nicht definiert.

Auto-Deploy aus GitHub kann spaeter eingefuehrt werden, wenn Secrets, Build-Artefakte, Config-Ausnahmen und Rollback sauber modelliert sind.

### Branch Protection

Empfohlen fuer GitHub UI:

- `main` schuetzen
- Pull Requests vor Merge verlangen
- erfolgreiche Checks aus `TNET Tests` verlangen
- direkte Pushes auf `main` vermeiden
- Release-Commits oder Tags fuer PROD-Staende verwenden

Diese Regeln werden in GitHub konfiguriert, nicht ueber die Deploy-Skripte.

## Wichtige VS-Code-Tasks

- `DEV: Seed maps-dev from maps`
- `Deploy DEV: Upload Changed Files`
- `Deploy DEV: Upload Active File`
- `Deploy DEV: LyrMgr Patch`
- `PROD: Sync maps-dev to maps (local robocopy)`
- `Release: Promote DEV to PROD (Dry Run, local robocopy + SFTP)`
- `Release: Promote DEV to PROD (local robocopy + SFTP)`
- `Deploy PROD: Upload Changed Files`
- `Deploy PROD: Upload Active File`
- `Deploy PROD: LyrMgr Patch`

## Entscheidungsregeln fuer kuenftige Edits

### Ich aendere nur eine einzelne Runtime-Datei

Empfehlung:

- in `maps-dev/` editieren
- mit `Deploy DEV: Upload Active File` deployen
- Hard-Reload

### Ich aendere mehrere zusammenhaengende Dateien

Empfehlung:

- in `maps-dev/` editieren
- mit `Deploy DEV: Upload Changed Files` deployen
- danach gezielt die betroffenen Seiten pruefen

### Ich aendere Konfigurationen unter `public/config/`, `core/config/` oder `tnet/config/`

Empfehlung:

- besonders vorsichtig deployen
- bewusst mit `--allow-config --reason ...`
- anschliessend API- und UI-Verhalten pruefen

### Ich aendere Build- oder Deploy-Skripte

Empfehlung:

- kleine isolierte Aenderung
- den betroffenen CLI- oder Task-Fall direkt ausfuehren
- erst danach weitere Skript-Aenderungen

### Ich sehe auf DEV alte UI oder falsche Assets trotz lokal aktuellem Baum

Pruefen:

1. ist wirklich `/www/maps-dev` aktuell?
2. liefern `index.php`, `public/index_de.htm` und `public/config/modules.js` die erwartete Version?
3. gibt es 404s auf zentrale JS/CSS-Dateien?
4. war der Deploy vielleicht an geschuetzten Config-Dateien oder Build-Fehlern abgebrochen?

## Bekannte Fehlerbilder

### DEV sieht anders aus als lokal

Moegliche Ursachen:

- Remote-DEV nicht aktuell
- Einstiegspunkte auf dem Server alt
- Browser-Cache
- Changed-Files-Deploy ist abgebrochen

### JS-Datei wurde geaendert, kommt aber nicht an

Moegliche Ursachen:

- falsche Datei unter `js/` statt `js-dev/` bearbeitet
- Build-Fehler beim Upload
- Upload falscher Umgebung

### Proxy- oder API-Pfade laufen noch auf `/maps`

Moegliche Ursachen:

- hart codierter Pfad im Frontend oder PHP
- falsche App-Root-Ableitung
- API erzeugt Webpfade relativ zum Skriptverzeichnis statt relativ zu `/maps` oder `/maps-dev`

## Checkliste vor einem Release

1. Alle Aenderungen zuerst in `maps-dev/` umgesetzt?
2. Gegen `/maps-dev` geprueft?
3. Hard-Reload gemacht?
4. Keine offenen 404-/ReferenceError-/Proxy-Fehler mehr?
5. Falls Config-Dateien betroffen sind: bewusst freigegeben und geprueft?
6. Dry Run sinnvoll oder bereits gemacht?
7. Erst dann `maps-dev/` nach `maps/` synchronisieren und PROD deployen

## Weiterfuehrende Dateien

- `README.md`
- `.github/pull_request_template.md`
- `.github/ISSUE_TEMPLATE/bug_report.md`
- `.github/ISSUE_TEMPLATE/feature_request.md`
- `.github/workflows/tnet-tests.yml`
- `.vscode/tasks.json`
- `_scripts/deployment/deployengine/deploy_env.py`
- `_scripts/deployment/deployengine/upload_changed.py`
- `_scripts/deployment/deployengine/upload_active_file.py`
- `_scripts/deployment/deployengine/promote_dev_to_prod.py`
- `_scripts/_build_js.py`
- `docs/ai-lessons-learned.md`