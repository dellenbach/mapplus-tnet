## Zusammenfassung

-

## Umgebung und Scope

- [ ] Aenderungen wurden primaer in `maps-dev/` umgesetzt
- [ ] Gemeinsame Dateien ausserhalb von `maps-dev/` sind bewusst betroffen
- [ ] `maps/` wurde nur im Rahmen einer bewussten Promotion angepasst

## Pruefung

- [ ] Lokal geprueft
- [ ] Nach `/www/maps-dev` deployed
- [ ] Gegen `https://www.gis-daten.ch/maps-dev/` getestet
- [ ] Browser-Konsole/Network auf 404, ReferenceError und Proxy-Fehler geprueft
- [ ] API-Endpunkte bei Bedarf mit `nocache=1` geprueft

## Config, Deploy und Release

- [ ] Keine geschuetzten Config-Dateien betroffen
- [ ] Falls Config-Dateien betroffen sind: Deploy bewusst mit `--allow-config --reason ...` geplant oder ausgefuehrt
- [ ] JS-Aenderungen wurden in `maps-dev/tnet/js/` gemacht, nicht in `maps-dev/tnet/js-stage/` oder `maps/tnet/js/`
- [ ] Auswirkungen auf PROD-Promotion geklaert
- [ ] Release-Tag oder Release-Commit erforderlich

## Bugfix-Dokumentation

- [ ] Kein Bugfix
- [ ] Bugfix in `docs/ai-lessons-learned.md` dokumentiert

## Hinweise

-