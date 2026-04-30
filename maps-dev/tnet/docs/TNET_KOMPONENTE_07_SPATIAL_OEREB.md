# Komponente 07 — Spatial & OEREB

## Zweck
Kombiniert räumliche Abfragen mit OEREB-bezogenen Datenflüssen für fachliche Auskunft.

## Einstiegspunkte
- `maps/tnet/js/tnet-spatial-query.js`
- `maps/tnet/js/tnet-oereb.js`

## Hauptfluss
1. Kartengeometrie oder Klickposition startet Spatial Query.
2. Ergebnis wird für OEREB-spezifische Verarbeitung aufbereitet.
3. OEREB-Modul holt/aggregiert Zusatzinformationen.
4. Ausgabe erfolgt im UI-Kontext (Panel/Overlay), abhängig von Runtime.

## Abhängigkeiten
- Funktionsfähige Layer- und Karten-Runtime.
- Verfügbare Endpunkte für räumliche/OEREB-Daten.

## Risiken/Guardrails
- Ergebnisstrukturen können je Quelle variieren; defensiv normalisieren.
- Lange Antwortzeiten bei komplexen Geometrien einplanen.

## Troubleshooting
- OEREB leer trotz Treffer: Übergabe zwischen Spatial- und OEREB-Modul prüfen.
- Geometriefehler: Koordinatenformat und Projektion im Request validieren.

## Relevante Dateien
- `maps/tnet/js/tnet-spatial-query.js`
- `maps/tnet/js/tnet-oereb.js`
- `maps/tnet/js/tnet-utils.js`
