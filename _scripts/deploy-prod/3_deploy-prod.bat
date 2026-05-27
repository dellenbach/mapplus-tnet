@echo off
title [3/3] Deploy PROD -- maps -> /www/maps
cd /d "C:\_Daten\mapplus-exp"
echo.
echo ============================================
echo  SCHRITT 3/3 -- Upload PROD
echo  Geaenderte Dateien -> /www/maps
echo ============================================
echo.
"C:\Program Files\Python313\python.exe" _scripts\deployment\upload_changed.py --env prod
if errorlevel 1 (
    echo.
    echo [FEHLER] Upload fehlgeschlagen.
    pause
    exit /b 1
)
echo.
echo [OK] Deploy PROD abgeschlossen.
echo      Weiter mit: git-commit.bat
pause
