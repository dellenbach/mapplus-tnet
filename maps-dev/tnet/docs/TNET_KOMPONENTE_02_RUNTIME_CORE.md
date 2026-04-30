# Komponente 02 — Runtime Core

## Zweck
Stellt zentrale Runtime-Funktionen bereit (App-Lebenszyklus, Hilfsfunktionen, gemeinsame Utilities).

## Einstiegspunkte
- `maps/tnet/js/tnet-app.js`
- `maps/tnet/js/tnet-mapplus-helpers.js`
- `maps/tnet/js/tnet-utils.js`

## Hauptfluss
1. `tnet-app.js` orchestriert den Start und registriert Kern-Listener.
2. Helper-Layer kapselt wiederkehrende Integrationslogik.
3. Utility-Funktionen liefern gemeinsame Basis (Formatierung, Guards, kleine Adapter).
4. Feature-Module greifen auf diese Basis zu.

## Abhängigkeiten
- Verfügbarkeit der vom Loader bereitgestellten globalen App-Objekte.
- Konsistente Initialisierungsreihenfolge zwischen App, Helpers und Feature-Modulen.

## Risiken/Guardrails
- Keine tiefen Eingriffe in Lifecycle-Hooks ohne End-to-End-Test.
- Shared Helpers minimal-invasiv ändern, da mehrere Komponenten davon abhängen.

## Troubleshooting
- Bei sporadischem Verhalten: Event-Registrierung und Reihenfolge in `tnet-app.js` prüfen.
- Bei Funktionsfehlern in mehreren Modulen: zuerst `tnet-mapplus-helpers.js` und `tnet-utils.js` diffen.

## Relevante Dateien
- `maps/tnet/js/tnet-app.js`
- `maps/tnet/js/tnet-mapplus-helpers.js`
- `maps/tnet/js/tnet-utils.js`
