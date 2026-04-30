# Komponente 05 — Info Panel & Picking

## Zweck
Zeigt Objektinformationen zur Karteninteraktion an und steuert Picking als Trigger für Info-Queries.

## Einstiegspunkte
- `maps/tnet/js/tnet-info-panel.js`
- `maps/tnet/js/tnet-app.js`

## Hauptfluss
1. Benutzerinteraktion auf der Karte löst Picking-Logik aus.
2. Info-Abfrage sammelt Trefferdaten aus aktiven Layern.
3. Info-Panel rendert die Daten im jeweiligen UI-Kontext.
4. Panel-Aktionen (z. B. Schliessen/Kopieren) aktualisieren den Zustand.

## Abhängigkeiten
- Aktive Map-Instanz und eingeschaltetes Picking.
- Layer-Runtime mit korrekt initialisierten abfragbaren Layern.

## Risiken/Guardrails
- Dojo/FloatingPane-Titelleiste nicht per `display:none` aushebeln (Layout-Folgen).
- Bei mobilen Varianten auf robustes Bottom-Sheet-Verhalten und CSS-Priorität achten.

## Troubleshooting
- Kein Treffer trotz Klick: prüfen, ob Picking aktiv ist und Layer abfragbar sind.
- Panel überdeckt/verschiebt Inhalte: Titelbar-/Offset-Logik und DOM-Struktur prüfen.

## Relevante Dateien
- `maps/tnet/js/tnet-info-panel.js`
- `maps/tnet/js/tnet-app.js`
- `maps/tnet/js/tnet-lm-init.js`
