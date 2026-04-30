# Komponente 01 — Bootstrapping

## Zweck
Initialisiert den App-Startpfad für Desktop und Mobile und lädt die benötigten Module in der korrekten Reihenfolge.

## Einstiegspunkte
- `maps/public/index_de.htm`
- `maps/public/index_de_m.htm`
- `maps/public/config/modules.js`
- `maps/tnet/js/mobile/tnet_modules_m.js`

## Hauptfluss
1. HTML-Einstieg lädt Basisskripte und Konfiguration.
2. Moduldefinitionen werden aus `modules.js` bzw. mobilem Loader gelesen.
3. Runtime-Initialisierung startet den TNET-App-Kern.
4. Nachgelagerte Komponenten (Layer, Suche, Info) hängen sich an App-Events.

## Abhängigkeiten
- Dojo/AMD-Ladeverhalten im Mobile-Entry.
- Verfügbare Modulpfade aus `maps/public/config/modules.js`.

## Risiken/Guardrails
- Kritische Dojo-Module bei Unsicherheit bevorzugt via nested `require(...)` laden.
- Keine Annahme, dass einzelne Ready-Events immer zuverlässig feuern.

## Troubleshooting
- Wenn Mobile nicht startet: zuerst `maps/tnet/js/mobile/tnet_modules_m.js` auf Pfade/Module prüfen.
- Bei partiellen Ladefehlern: Reihenfolge der Includes in den Entry-HTMLs vergleichen.

## Relevante Dateien
- `maps/public/index_de.htm`
- `maps/public/index_de_m.htm`
- `maps/public/config/modules.js`
- `maps/tnet/js/mobile/tnet_modules_m.js`
