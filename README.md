# mapplus-tnet

Dieses Repository enthÃ¤lt die MapPlus/TNET-Implementierung (Frontend, PHP-Endpunkte, Konfigurationen und Hilfsskripte).

## Entwicklungsworkflow

Entwicklung findet in `maps-dev/` statt.

Empfohlener Ablauf:

1. Ã„nderungen in `maps-dev/` umsetzen
2. Lokal prÃ¼fen
3. DEV deployen
4. Gegen `https://www.gis-daten.ch/maps-dev/` testen
5. Nach erfolgreichem Test per Sync `maps-dev/` nach `maps/` Ã¼bernehmen
6. Danach PROD deployen

VS-Code-Tasks dafÃ¼r:

- `DEV: Seed maps-dev from maps` â€” initiale oder erneute Basis-Kopie von prod nach dev
- `Deploy DEV: Upload Changed Files` â€” Ã„nderungen aus `maps-dev/` nach `/www/maps-dev`
- `Deploy DEV: Upload Active File` â€” einzelne Datei gezielt nach `/www/maps-dev`
- `PROD: Sync maps-dev to maps (local robocopy)` â€” nur lokaler Abgleich von dev nach prod
- `Release: Promote DEV to PROD (Dry Run, local robocopy + SFTP)` â€” kompletter Release-Ablauf als Vorschau
- `Release: Promote DEV to PROD (local robocopy + SFTP)` â€” lokale Promotion plus anschliessender PROD-Deploy
- `Deploy PROD: Upload Changed Files` â€” Ã„nderungen aus `maps/` nach `/www/maps`
- `Deploy PROD: Upload Active File` â€” einzelne Datei gezielt nach `/www/maps`; Pfade unter `maps-dev/` werden davor lokal nach `maps/` synchronisiert

Hinweis: Der Sync-Task nutzt bewusst `robocopy /E` und lÃ¶scht keine Dateien im Ziel. Falls spÃ¤ter eine harte 1:1-Spiegelung inklusive LÃ¶schungen gewÃ¼nscht ist, sollte das bewusst separat entschieden werden.

CLI-Alternative:

```powershell
& "C:/Program Files/Python313/python.exe" "_scripts/deployment/deployengine/promote_dev_to_prod.py" --dry-run --deploy-prod
& "C:/Program Files/Python313/python.exe" "_scripts/deployment/deployengine/promote_dev_to_prod.py" --deploy-prod
```

Optional kann mit `--mirror` statt `/E` eine harte 1:1-Spiegelung inklusive LÃ¶schungen in `maps/` erzwungen werden.

FÃ¼r Batch-Workflows stehen ausserdem diese Wrapper bereit:

- `_scripts/deployment/deploy-dev/deploy-active-file.bat <datei>`
- `_scripts/deployment/deploy-prod/deploy-active-file.bat <datei>`

PROD-Releases laufen standardmaessig mit Hash-Cache ueber `_scripts/deployment/deploy-prod/release-full.bat`. Fuer einen kompletten JS-Neubuild gibt es `_scripts/deployment/deploy-prod/release-full-rebuild.bat`. FÃ¼r den GitHub-Pfad kann `_scripts/deployment/deploy-prod/git-commit.bat` vor dem Staging direkt den lokalen Abgleich `maps-dev -> maps` ausfÃ¼hren.

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

Der Workflow fÃ¼hrt zwei Jobs aus:

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
- `maps-dev/tnet/`: Entwicklungsstand der TNET-Frontend-/PHP-Dateien fÃ¼r `/maps-dev`
- `maps/tnet/tests/`: Pytest-Test-Suite (Smoke, Integration, externe Tests)
- `maps/public/`: Ã–ffentliche Einstiegspunkte (u. a. mobile/desktop HTML)
- `core/`: Core-Konfiguration, Layer-Definitionen, Templates und Lookups
- `_scripts/deployment/`: offizielle DEV/PROD-Deploy-Skripte
- `_scripts/diagnostics/`, `_scripts/tests/`, `_scripts/legacy/`: Diagnose-, manuelle Test- und Legacy-Helfer

## WeiterfÃ¼hrende Doku

- [DEV- und Deploy-Workflow](docs/DEV_DEPLOY_WORKFLOW.md)
- [TNET Tests README](maps/tnet/tests/README.md)

