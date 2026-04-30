# Komponente 09 — API v1

## Zweck
Stellt versionierte API-Endpunkte bereit und dokumentiert diese über OpenAPI.

## Einstiegspunkte
- `maps/tnet/api/v1/layers.php`
- `maps/tnet/api/docs/openapi.yaml`

## Hauptfluss
1. Client ruft v1-Endpunkt auf.
2. Endpoint verarbeitet Parameter und liest Backend-Daten.
3. Antwort wird im definierten JSON-Format zurückgegeben.
4. OpenAPI-Spezifikation dient als Referenz für Vertrag und Nutzung.

## Abhängigkeiten
- Konsistente API-Verträge zwischen Frontend und Backend.
- Laufzeitumgebung für PHP und Zugriff auf benötigte Datenquellen.

## Risiken/Guardrails
- Änderungen am Response-Schema nur versioniert ausrollen.
- Dokumentation (`openapi.yaml`) bei jedem relevanten Endpoint-Change mitpflegen.

## Troubleshooting
- Fehlende Felder: Endpoint-Output gegen OpenAPI vergleichen.
- Inkompatible Clients: Versionsannahmen im Consumer prüfen.

## Relevante Dateien
- `maps/tnet/api/v1/layers.php`
- `maps/tnet/api/docs/openapi.yaml`
- `maps/tnet/js/tnet-lm-init.js`
