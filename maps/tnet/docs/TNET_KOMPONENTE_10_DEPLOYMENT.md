# Komponente 10 — Deployment

## Zweck
Beschreibt den pragmatischen Deployment-Pfad für geänderte TNET-Dateien.

## Einstiegspunkte
- `_scripts/deployment/_upload_changed.py`
- `_scripts/deployment/_upload_active_file.py`
- `_scripts/deployment/_promote_dev_to_prod.py`
- weitere Spezial-Upload-Helfer in `_scripts/`

## Hauptfluss
1. Änderungen zuerst in `maps-dev/` umsetzen und prüfen.
2. Geänderte Dateien mit `_scripts/deployment/_upload_changed.py --env dev` oder Einzeldateien mit `_scripts/deployment/_upload_active_file.py --env dev <datei>` hochladen.
3. Zielpfade auf Server aktualisieren.
4. Browser mit Hard-Reload neu laden und Funktion prüfen.

## Abhängigkeiten
- Korrekte SFTP-Zugangsdaten und Netzwerkzugriff.
- Vollständige Dateiliste (bei Multi-Pfad-Dateien ggf. Spezialskript nutzen).

## Risiken/Guardrails
- Deploy-Ziel (`dev`/`prod`) immer explizit setzen.
- Bei Dateien mit mehreren Remote-Pfaden Spezialskript oder Active-File-Upload bewusst prüfen.

## Troubleshooting
- Datei nicht aktualisiert: lokales/remote Pfad-Mapping prüfen.
- Änderung sichtbar erst nach Cache-Leerung: Hard-Reload (`Ctrl+Shift+R`) durchführen.

## Relevante Dateien
- `_scripts/deployment/_upload_changed.py`
- `_scripts/deployment/_upload_active_file.py`
- `_scripts/deployment/_promote_dev_to_prod.py`
- `_scripts/_upload_helpers.py`
- `_scripts/_upload_lyrmgr_patch.py`
