@echo off
title Deploy DEV -- maps-dev nach /www/maps-dev
call "%~dp0..\..\dev_and_deploy_config.bat"
if errorlevel 1 exit /b 1
cd /d "%MAPPLUS_WORKSPACE_ROOT%"
echo.
echo ============================================
echo  DEPLOY DEV -- ANWENDUNGSCODE + TNET-CONFIGS
  echo  Geaenderte Dateien -^> /www/maps-dev
  echo  DEV-JS bleibt lesbar; PROD-Stage wird lokal gebaut
  echo  (JS, PHP, CSS, HTML, tnet/config/)
echo  Einzeldatei: deploy-active-file.bat ^<pfad^>
echo ============================================
echo.
"%MAPPLUS_PYTHON_EXE%" _scripts\deployment\deployengine\upload_changed.py --env dev --build-js-stage
if errorlevel 1 (
    echo.
    echo [FEHLER] Deploy fehlgeschlagen.
    pause
    exit /b 1
)
echo.
echo [OK] Deploy DEV abgeschlossen.
pause
