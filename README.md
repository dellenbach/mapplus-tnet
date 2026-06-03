# mapplus-exp

Dieses Repository enthält die MapPlus/TNET-Implementierung (Frontend, PHP-Endpunkte, Konfigurationen und Hilfsskripte).

## Entwicklungsworkflow

Entwicklung findet in `maps-dev/` statt.

Empfohlener Ablauf:

1. Änderungen in `maps-dev/` umsetzen
2. Lokal prüfen
3. DEV deployen
4. Gegen `https://www.gis-daten.ch/maps-dev/` testen
5. Nach erfolgreichem Test per Sync `maps-dev/` nach `maps/` übernehmen
6. Danach PROD deployen

VS-Code-Tasks dafür:

- `DEV: Seed maps-dev from maps` — initiale oder erneute Basis-Kopie von prod nach dev
- `Deploy DEV: Upload Changed Files` — Änderungen aus `maps-dev/` nach `/www/maps-dev`
- `Deploy DEV: Upload Active File` — einzelne Datei gezielt nach `/www/maps-dev`
- `PROD: Sync maps-dev to maps (local robocopy)` — nur lokaler Abgleich von dev nach prod
- `Release: Promote DEV to PROD (Dry Run, local robocopy + SFTP)` — kompletter Release-Ablauf als Vorschau
- `Release: Promote DEV to PROD (local robocopy + SFTP)` — lokale Promotion plus anschliessender PROD-Deploy
- `Deploy PROD: Upload Changed Files` — Änderungen aus `maps/` nach `/www/maps`
- `Deploy PROD: Upload Active File` — einzelne Datei gezielt nach `/www/maps`; Pfade unter `maps-dev/` werden davor lokal nach `maps/` synchronisiert

Hinweis: Der Sync-Task nutzt bewusst `robocopy /E` und löscht keine Dateien im Ziel. Falls später eine harte 1:1-Spiegelung inklusive Löschungen gewünscht ist, sollte das bewusst separat entschieden werden.

CLI-Alternative:

```powershell
& "C:/Program Files/Python313/python.exe" "_scripts/deployment/deployengine/promote_dev_to_prod.py" --dry-run --deploy-prod
& "C:/Program Files/Python313/python.exe" "_scripts/deployment/deployengine/promote_dev_to_prod.py" --deploy-prod
```

Optional kann mit `--mirror` statt `/E` eine harte 1:1-Spiegelung inklusive Löschungen in `maps/` erzwungen werden.

Für Batch-Workflows stehen ausserdem diese Wrapper bereit:

- `_scripts/deployment/deploy-dev/deploy-active-file.bat <datei>`
- `_scripts/deployment/deploy-prod/deploy-active-file.bat <datei>`

PROD-Releases laufen standardmaessig mit Hash-Cache ueber `_scripts/deployment/deploy-prod/release-full.bat`. Fuer einen kompletten JS-Neubuild gibt es `_scripts/deployment/deploy-prod/release-full-rebuild.bat`. Für den GitHub-Pfad kann `_scripts/deployment/deploy-prod/git-commit.bat` vor dem Staging direkt den lokalen Abgleich `maps-dev -> maps` ausführen.

## Testen

Die TNET-Tests liegen unter `maps/tnet/tests` und nutzen `pytest`.

### Dependencies

```powershell
& "C:/Program Files/Python313/python.exe" -m pip install --upgrade pip
& "C:/Program Files/Python313/python.exe" -m pip install -r maps/tnet/tests/requirements-test.txt
```

### Standardlauf

```powershell
$env:TNET_BASE_URL = "https://www.gis-daten.ch/maps-dev/tnet/php"
& "C:/Program Files/Python313/python.exe" -m pytest maps/tnet/tests --junitxml=test-results/junit.xml -q
```

### Lauf inkl. externer Tests

```powershell
$env:TNET_BASE_URL = "https://www.gis-daten.ch/maps-dev/tnet/php"
$env:TNET_RUN_EXTERNAL = "1"
& "C:/Program Files/Python313/python.exe" -m pytest maps/tnet/tests --junitxml=test-results/junit-external.xml -q
```

## Schnellstart (3 Schritte)

1. Dependencies installieren

```powershell
& "C:/Program Files/Python313/python.exe" -m pip install -r maps/tnet/tests/requirements-test.txt
```

2. Endpoint setzen

```powershell
$env:TNET_BASE_URL = "https://www.gis-daten.ch/maps-dev/tnet/php"
```

3. Tests starten

```powershell
& "C:/Program Files/Python313/python.exe" -m pytest maps/tnet/tests -q
```

## CI

GitHub Actions Workflow:

- [TNET Tests](.github/workflows/tnet-tests.yml)

Der Workflow führt zwei Jobs aus:

- `tests-standard` (ohne externe Tests)
- `tests-external` (mit `TNET_RUN_EXTERNAL=1`)

JUnit-Reports werden als Artefakte hochgeladen.

## GitHub-Workflow

GitHub dient fuer Quellcode, Review und Release-Nachvollziehbarkeit. Der reale Serverstand wird weiterhin durch explizite DEV-/PROD-Deploys und anschliessende Pruefung validiert.

Kurzregel:

1. Feature-Arbeit in `maps-dev/`
2. PR mit DEV-Testnachweis
3. nach Freigabe Promotion nach `maps/`
4. PROD-Deploy und optionaler Release-Tag

Details stehen in [DEV- und Deploy-Workflow](docs/DEV_DEPLOY_WORKFLOW.md).

## Projektstruktur

- `maps/tnet/`: TNET-Frontend, PHP-Endpunkte, Konfigurationen und Ressourcen
- `maps-dev/tnet/`: Entwicklungsstand der TNET-Frontend-/PHP-Dateien für `/maps-dev`
- `maps/tnet/tests/`: Pytest-Test-Suite (Smoke, Integration, externe Tests)
- `maps/public/`: Öffentliche Einstiegspunkte (u. a. mobile/desktop HTML)
- `core/`: Core-Konfiguration, Layer-Definitionen, Templates und Lookups
- `_scripts/deployment/`: offizielle DEV/PROD-Deploy-Skripte
- `_scripts/diagnostics/`, `_scripts/tests/`, `_scripts/legacy/`: Diagnose-, manuelle Test- und Legacy-Helfer

## Weiterführende Doku

- [DEV- und Deploy-Workflow](docs/DEV_DEPLOY_WORKFLOW.md)
- [TNET Tests README](maps/tnet/tests/README.md)
