# TNET Test Suite

Diese Tests nutzen `pytest` als Runner und kÃ¶nnen optional JUnit-XML fÃ¼r CI erzeugen.

## Dependencies installieren

Empfohlen aus dem Workspace-Root `mapplus-tnet`:

```powershell
& "C:/Program Files/Python313/python.exe" -m pip install --upgrade pip
& "C:/Program Files/Python313/python.exe" -m pip install -r maps/tnet/tests/requirements-test.txt
```

Direktinstallation (Alternative):

```powershell
& "C:/Program Files/Python313/python.exe" -m pip install "pytest>=8.0"
```

## Struktur

- `integration/http/`: Integrations-Tests gegen lokale PHP-Endpunkte
- `integration/external/`: externe API-Tests (opt-in)
- `smoke/`: schnelle VerfÃ¼gbarkeitschecks zentraler Endpunkte
- `helpers/`: HTTP-Helper
- `fixtures/`, `mocks/`: Testdaten/Mocks
- `unit/js`, `unit/php`, `e2e`: vorbereitete Erweiterungspfade

## Konfiguration

### Lokale Endpunkte aktivieren

Setze die Basis-URL zur lokalen Instanz:

- PowerShell: `$env:TNET_BASE_URL = "https://localhost/maps/tnet/php"`
- Alternativ in CI als Environment Variable.

Beispiel fÃ¼r euren Remote-Host:

- PowerShell: `$env:TNET_BASE_URL = "https://www.gis-daten.ch/maps/tnet/php"`

### Externe Tests aktivieren

Externe Ã–REB-Tests laufen nur wenn gesetzt:

- PowerShell: `$env:TNET_RUN_EXTERNAL = "1"`

## AusfÃ¼hrung

Aus `maps/tnet/tests`:

```powershell
pytest
```

JUnit-Report:

```powershell
pytest --junitxml=../../../test-results/junit.xml
```

## CI (GitHub Actions)

Workflow: `.github/workflows/tnet-tests.yml`

- Job `tests-standard`: Standardlauf ohne externe Tests, Report `test-results/junit.xml`
- Job `tests-external`: Lauf mit `TNET_RUN_EXTERNAL=1`, Report `test-results/junit-external.xml`

Optional kann in GitHub unter **Repository Variables** `TNET_BASE_URL` gesetzt werden.
Ohne Variable nutzt der Workflow standardmÃ¤ssig:

- `https://www.gis-daten.ch/maps/tnet/php`

