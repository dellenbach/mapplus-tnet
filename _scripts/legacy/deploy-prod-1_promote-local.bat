@echo off
setlocal
title [1/3] Promote -- maps-dev nach maps + js_ori (lokal)
call "%~dp0..\..\dev_and_deploy_config.bat"
if errorlevel 1 exit /b 1
cd /d "%MAPPLUS_WORKSPACE_ROOT%"

:: Zweck:
:: Lokaler Abgleich von maps-dev nach maps fuer den PROD-Stand im Repository.
:: Danach werden die lesbaren JS-Dateien nach maps\tnet\js_ori gesichert.
:: Dieser Schritt deployed noch nichts auf den Server.

echo.
echo ============================================
echo  SCHRITT 1/3 -- Lokale Promotion
echo  maps-dev nach maps + js_ori vorbereiten
echo ============================================
echo.
"%MAPPLUS_PYTHON_EXE%" _scripts\deployment\deployengine\promote_dev_to_prod.py
if errorlevel 1 (
    echo.
    echo [FEHLER] Promotion fehlgeschlagen.
    pause
    exit /b 1
)
echo.
echo [OK] Promotion abgeschlossen.
echo      Weiter mit: 2_build-prod.bat
pause
