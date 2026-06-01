@echo off
title Deploy PROD -- Einzeldatei nach /www/maps
call "%~dp0..\..\dev_and_deploy_config.bat"
if errorlevel 1 exit /b 1
cd /d "%MAPPLUS_WORKSPACE_ROOT%"

:: Zweck:
:: Einzeldatei direkt nach PROD deployen.
:: Pfade unter maps-dev\ werden vor dem Upload lokal nach maps\ synchronisiert.

set "TARGET=%~1"
if "%TARGET%"=="" (
    set /p "TARGET=Datei fuer PROD-Deploy eingeben (maps\ oder maps-dev\): "
)
if "%TARGET%"=="" (
    echo.
    echo [ABBRUCH] Keine Datei angegeben.
    pause
    exit /b 1
)
echo.
echo ============================================
echo  DEPLOY PROD -- EINZELDATEI
echo  Ziel: /www/maps
echo  Datei: %TARGET%
echo  maps-dev-Pfade werden lokal nach maps synchronisiert.
echo ============================================
echo.
"%MAPPLUS_PYTHON_EXE%" _scripts\deployment\deployengine\upload_active_file.py --env prod "%TARGET%"
if errorlevel 1 (
    echo.
    echo [FEHLER] Einzeldatei-Deploy fehlgeschlagen.
    pause
    exit /b 1
)
echo.
echo [OK] Einzeldatei auf PROD deployt.
pause