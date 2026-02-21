# TNET Test Suite

Diese Tests nutzen `pytest` als Runner und können optional JUnit-XML für CI erzeugen.

## Dependencies installieren

Empfohlen aus dem Workspace-Root `mapplus-exp`:

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
- `smoke/`: schnelle Verfügbarkeitschecks zentraler Endpunkte
- `helpers/`: HTTP-Helper
- `fixtures/`, `mocks/`: Testdaten/Mocks
- `unit/js`, `unit/php`, `e2e`: vorbereitete Erweiterungspfade

## Konfiguration

### Lokale Endpunkte aktivieren

Setze die Basis-URL zur lokalen Instanz:

- PowerShell: `$env:TNET_BASE_URL = "https://localhost/maps/tnet/php"`
- Alternativ in CI als Environment Variable.

Beispiel für euren Remote-Host:

- PowerShell: `$env:TNET_BASE_URL = "https://www.gis-daten.ch/maps/tnet/php"`

### Externe Tests aktivieren

Externe ÖREB-Tests laufen nur wenn gesetzt:

- PowerShell: `$env:TNET_RUN_EXTERNAL = "1"`

## Ausführung

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
Ohne Variable nutzt der Workflow standardmässig:

- `https://www.gis-daten.ch/maps/tnet/php`
