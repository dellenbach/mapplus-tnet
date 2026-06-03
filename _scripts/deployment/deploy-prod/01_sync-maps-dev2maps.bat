@echo off
title Sync maps-dev nach maps (lokal)
call "%~dp0..\..\dev_and_deploy_config.bat"
if errorlevel 1 exit /b 1
cd /d "%MAPPLUS_WORKSPACE_ROOT%"
echo.
echo ============================================
echo  SYNC maps-dev -^> maps (lokal)
echo  JS, PHP, CSS, HTML, tnet/config/ (alle Verzeichnisse)
echo  (Kein SFTP-Upload -- nur lokaler Abgleich)
echo  Dry-Run: 01_sync-maps-dev2maps.bat --dry-run
echo  Danach:  02_deploy-prod.bat
echo ============================================
echo.
echo [1/2] Lokaler Abgleich maps-dev -^> maps ...
echo.
"%MAPPLUS_PYTHON_EXE%" _scripts\deployment\deployengine\sync_maps_dev2maps.py %*
if errorlevel 1 (
    echo.
    echo [FEHLER] Sync fehlgeschlagen.
    pause
    exit /b 1
)
echo.
echo [OK] Sync abgeschlossen. Naechster Schritt: 02_deploy-prod.bat
pause
