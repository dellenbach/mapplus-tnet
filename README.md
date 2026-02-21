# mapplus-exp

Dieses Repository enthält die MapPlus/TNET-Implementierung (Frontend, PHP-Endpunkte, Konfigurationen und Hilfsskripte).

## Testen

Die TNET-Tests liegen unter `maps/tnet/tests` und nutzen `pytest`.

### Dependencies

```powershell
& "C:/Program Files/Python313/python.exe" -m pip install --upgrade pip
& "C:/Program Files/Python313/python.exe" -m pip install -r maps/tnet/tests/requirements-test.txt
```

### Standardlauf

```powershell
$env:TNET_BASE_URL = "https://www.gis-daten.ch/maps/tnet/php"
& "C:/Program Files/Python313/python.exe" -m pytest maps/tnet/tests --junitxml=test-results/junit.xml -q
```

### Lauf inkl. externer Tests

```powershell
$env:TNET_BASE_URL = "https://www.gis-daten.ch/maps/tnet/php"
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
$env:TNET_BASE_URL = "https://www.gis-daten.ch/maps/tnet/php"
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

## Projektstruktur

- `maps/tnet/`: TNET-Frontend, PHP-Endpunkte, Konfigurationen und Ressourcen
- `maps/tnet/tests/`: Pytest-Test-Suite (Smoke, Integration, externe Tests)
- `maps/public/`: Öffentliche Einstiegspunkte (u. a. mobile/desktop HTML)
- `core/`: Core-Konfiguration, Layer-Definitionen, Templates und Lookups
- `_scripts/`: Hilfs-, Upload- und Validierungsskripte für Betrieb/Deployment

## Weiterführende Doku

- [TNET Tests README](maps/tnet/tests/README.md)
