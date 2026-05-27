@echo off
title [2/3] Build PROD -- JS minifizieren (maps/)
cd /d "C:\_Daten\mapplus-exp"
echo.
echo ============================================
echo  SCHRITT 2/3 -- JS Full-Build PROD
echo  maps\tnet\js-dev\ -> maps\tnet\js\ (minifiziert)
echo ============================================
echo.
"C:\Program Files\Python313\python.exe" _scripts\build\build_js.py --mode prod
if errorlevel 1 (
    echo.
    echo [FEHLER] Build fehlgeschlagen.
    pause
    exit /b 1
)
echo.
echo [OK] Build abgeschlossen.
echo      Weiter mit: 3_deploy-prod.bat
pause
