@echo off
title Dry-Run PROD Release -- Vorschau (keine Aenderungen)
cd /d "C:\_Daten\mapplus-exp"
echo.
echo ============================================
echo  DRY-RUN PROD RELEASE (keine Aenderungen)
echo ============================================
echo.
echo [1/2] Robocopy Dry-Run (maps-dev -> maps) ...
echo.
robocopy maps-dev maps /E /L /NFL /NDL /NJH /NJS /NP /R:1 /W:1
echo.
echo [2/2] Upload Dry-Run (maps -> /www/maps) ...
echo.
"C:\Program Files\Python313\python.exe" _scripts\deployment\upload_changed.py --env prod --dry-run
echo.
echo [INFO] Dry-Run abgeschlossen. Keine Dateien veraendert.
pause
