# Komponente 10 — Deployment

## Zweck
Beschreibt den pragmatischen Deployment-Pfad für geänderte TNET-Dateien.

## Einstiegspunkte
- `_scripts/_upload_files.py`
- weitere Upload-Helfer in `_scripts/`

## Hauptfluss
1. Geänderte Pfade in der `FILES`-Liste von `_upload_files.py` eintragen.
2. Upload-Skript lokal ausführen.
3. Zielpfade auf Server aktualisieren.
4. Browser mit Hard-Reload neu laden und Funktion prüfen.

## Abhängigkeiten
- Korrekte SFTP-Zugangsdaten und Netzwerkzugriff.
- Vollständige Dateiliste (bei Multi-Pfad-Dateien ggf. Spezialskript nutzen).

## Risiken/Guardrails
- Unvollständige FILES-Liste führt zu Teil-Deployments.
- Bei Dateien mit mehreren Remote-Pfaden beide Ziele explizit bedienen.

## Troubleshooting
- Datei nicht aktualisiert: lokales/remote Pfad-Mapping prüfen.
- Änderung sichtbar erst nach Cache-Leerung: Hard-Reload (`Ctrl+Shift+R`) durchführen.

## Relevante Dateien
- `_scripts/_upload_files.py`
- `_scripts/_upload_helpers.py`
- `_scripts/_upload_all.py`
