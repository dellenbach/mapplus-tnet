# Komponente 04 — Layer Runtime

## Zweck
Setzt Layer-Konfiguration in konkrete Runtime-Aktionen um (Initialisierung, Aktivierung, Statusverwaltung).

## Einstiegspunkte
- `maps/tnet/js/tnet-lm-init.js`
- `maps/tnet/js/tnet-app.js`

## Hauptfluss
1. Runtime initialisiert Layer-Manager über `tnet-lm-init.js`.
2. Konfigurationslayer werden in Laufzeitobjekte überführt.
3. Layerzustände werden über UI/Events aktualisiert.
4. Nachgelagerte Komponenten reagieren auf aktive Layer.

## Abhängigkeiten
- Gültige Daten aus `maps/public/config/lyrmgr.conf`.
- App-Lifecycle und verfügbare Map-Instanzen.

## Risiken/Guardrails
- Race-Conditions bei frühem Layer-Toggle möglich; Aktivierung robust verzögert ausführen.
- Layer-Operationen nicht nur an ein einzelnes Ready-Event koppeln.

## Troubleshooting
- Layer bleibt aus: Initialisierungspfad in `tnet-lm-init.js` und Event-Timing prüfen.
- URL-Layer greift nicht: Reihenfolge zwischen App-Ready und Layer-Switch kontrollieren.

## Relevante Dateien
- `maps/tnet/js/tnet-lm-init.js`
- `maps/tnet/js/tnet-app.js`
- `maps/public/config/lyrmgr.conf`
