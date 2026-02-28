# Komponente 03 — Layer Konfiguration

## Zweck
Definiert Layer-Quellen, Metadaten und Umschaltbarkeit auf Konfigurationsbasis.

## Einstiegspunkte
- `maps/public/config/lyrmgr.conf`
- `core/config`

## Hauptfluss
1. Konfigurationsdateien deklarieren Layer und Parameter.
2. Laufzeit liest Konfiguration und baut internes Layer-Modell.
3. UI/Runtime nutzt das Modell für Sichtbarkeit und Interaktion.
4. Änderungen an Konfigs wirken nach Reload.

## Abhängigkeiten
- Konsistente IDs und Pfade in den Konfigdateien.
- Runtime-Parser, der das Format der Configs erwartet.

## Risiken/Guardrails
- Layer-IDs stabil halten; ID-Änderungen beeinflussen URL- und Runtime-Logik.
- Konfigänderungen immer zusammen mit betroffenen Runtime-Initialisierern prüfen.

## Troubleshooting
- Fehlende Layer in UI: zuerst Syntax/Inhalt von `lyrmgr.conf` kontrollieren.
- Unterschiedliches Verhalten je Umgebung: Werte in `core/config` vergleichen.

## Relevante Dateien
- `maps/public/config/lyrmgr.conf`
- `core/config`
- `maps/tnet/js/tnet-lm-init.js`
