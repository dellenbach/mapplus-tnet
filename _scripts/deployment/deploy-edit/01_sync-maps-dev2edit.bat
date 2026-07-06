@echo off
title Sync maps-dev nach edit (lokal)
call "%~dp0..\..\dev_and_deploy_config.bat"
if errorlevel 1 exit /b 1
cd /d "%MAPPLUS_WORKSPACE_ROOT%"
echo.
echo ============================================
echo  SYNC maps-dev -^> edit (lokal)
echo  Scope: tnet/**, agsproxy.php, wmsproxy.php
echo  (Kein SFTP-Upload -- nur lokaler Abgleich)
echo  Dry-Run: 01_sync-maps-dev2edit.bat --dry-run
echo  Danach:  02_deploy-edit.bat
echo ============================================
echo.
echo [1/2] Lokaler Abgleich maps-dev -^> edit ...
echo.
"%MAPPLUS_PYTHON_EXE%" _scripts\deployment\deployengine\sync_maps_dev2edit.py %*
if errorlevel 1 (
    echo.
    echo [FEHLER] Sync fehlgeschlagen.
    pause
    exit /b 1
)
echo.
echo [OK] Sync abgeschlossen. Naechster Schritt: 02_deploy-edit.bat
pause
