@echo off
title Deploy DEV -- Einzeldatei nach /www/maps-dev
call "%~dp0..\..\dev_and_deploy_config.bat"
if errorlevel 1 exit /b 1
cd /d "%MAPPLUS_WORKSPACE_ROOT%"
set "TARGET=%~1"
if "%TARGET%"=="" (
    set /p "TARGET=Datei fuer DEV-Deploy eingeben (Pfad unter maps-dev\): "
)
if "%TARGET%"=="" (
    echo.
    echo [ABBRUCH] Keine Datei angegeben.
    pause
    exit /b 1
)
echo.
echo ============================================
echo  DEPLOY DEV -- EINZELDATEI
echo  Ziel: /www/maps-dev
echo  Datei: %TARGET%
echo ============================================
echo.
"%MAPPLUS_PYTHON_EXE%" _scripts\deployment\deployengine\upload_active_file.py --env dev "%TARGET%"
if errorlevel 1 (
    echo.
    echo [FEHLER] Einzeldatei-Deploy fehlgeschlagen.
    pause
    exit /b 1
)
echo.
echo [OK] Einzeldatei auf DEV deployt.
pause