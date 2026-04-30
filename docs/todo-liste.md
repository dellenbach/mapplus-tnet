# TODO-Liste (MAP+ / TNET)

Stand: 2026-03-05

## Kurzfristig

- [ ] Offene Bugs sammeln und priorisieren
- [ ] Änderungen lokal prüfen (Desktop + Mobile)
- [ ] Betroffene Konfig-Dateien auf Key-Konsistenz prüfen

## Umsetzungs-Tasks

- [ ] Code-Änderungen minimal-invasiv umsetzen
- [ ] Maptips `gis_oereb/nw_nutzungsplanung_def_0` bis `_13` mit `linked_layer: "gis_oereb/nw_nutzungsplanung_def"` (Root-Layer) ergänzen/prüfen
- [ ] Relevante Doku aktualisieren
- [ ] `docs/ai-lessons-learned.md` nach Bug-Fixes ergänzen

## KI-Training: MapPlus Editier-Konfiguration

- [ ] MapPlus-Doku lesen & analysieren (Forms, Cascading etc.) — Quelle: https://cloud.mapplus.ch/mapplusv4_doku/de:forms_cascading
- [ ] Bestehende Editier-Konfigurationen im Projekt identifizieren und prüfen
- [ ] KI-Wissensdokument erstellen: Regeln, Muster und Beispiele für MapPlus-Editierkonfiguration

## Deployment-Checkliste

- [ ] Geänderte Dateien mit `_scripts/deployment/_upload_changed.py --env dev` nach DEV hochladen
- [ ] Bei Einzeldateien `_scripts/deployment/_upload_active_file.py --env dev <datei>` verwenden
- [ ] Hard-Reload im Browser durchführen (`Ctrl+Shift+R`)

## Notizen

- [ ] 
- [ ] 
- [ ] 
