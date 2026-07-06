@echo off
title Deploy EDIT -- Einzeldatei nach /www/edit
call "%~dp0..\..\dev_and_deploy_config.bat"
if errorlevel 1 exit /b 1
cd /d "%MAPPLUS_WORKSPACE_ROOT%"
set "TARGET=%~1"
if "%TARGET%"=="" (
    set /p "TARGET=Datei fuer EDIT-Deploy eingeben (Pfad unter edit\ oder maps-dev\): "
)
if "%TARGET%"=="" (
    echo.
    echo [ABBRUCH] Keine Datei angegeben.
    pause
    exit /b 1
)
echo.
echo ============================================
echo  DEPLOY EDIT -- EINZELDATEI
echo  Ziel: /www/edit
echo  Datei: %TARGET%
echo  Scope: tnet/**, agsproxy.php, wmsproxy.php
echo ============================================
echo.
"%MAPPLUS_PYTHON_EXE%" _scripts\deployment\deployengine\upload_active_file.py --env edit "%TARGET%"
if errorlevel 1 (
    echo.
    echo [FEHLER] Einzeldatei-Deploy fehlgeschlagen.
    pause
    exit /b 1
)
echo.
echo [OK] Einzeldatei auf EDIT deployt.
pause
