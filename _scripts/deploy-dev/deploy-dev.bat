@echo off
title Deploy DEV -- maps-dev -> /www/maps-dev
cd /d "C:\_Daten\mapplus-exp"
echo.
echo ============================================
echo  DEPLOY DEV -- ANWENDUNGSCODE
echo  Geaenderte Dateien -> /www/maps-dev
echo  (JS, PHP, CSS, HTML -- KEIN Config-Deploy)
echo ============================================
echo.
"C:\Program Files\Python313\python.exe" _scripts\deployment\upload_changed.py --env dev
if errorlevel 1 (
    echo.
    echo [FEHLER] Deploy fehlgeschlagen.
    pause
    exit /b 1
)
echo.
echo [OK] Deploy DEV abgeschlossen.
pause
