@echo off
title Dry-Run DEV -- Vorschau (kein Upload)
cd /d "C:\_Daten\mapplus-exp"
echo.
echo ============================================
echo  DRY-RUN DEV -- Vorschau (kein Upload)
echo  Zeigt geaenderte Dateien fuer /www/maps-dev
echo ============================================
echo.
"C:\Program Files\Python313\python.exe" _scripts\deployment\upload_changed.py --env dev --dry-run
echo.
pause
