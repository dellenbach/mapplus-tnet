@echo off
title Sync EDIT -- maps-dev/tnet nach edit/tnet (lokal)
call "%~dp0..\..\dev_and_deploy_config.bat"
if errorlevel 1 exit /b 1
cd /d "%MAPPLUS_WORKSPACE_ROOT%"
echo.
echo ============================================
echo  SYNC EDIT -- lokal
echo  maps-dev/tnet/      -^> edit/tnet/
echo  maps-dev/agsproxy.php -^> edit/agsproxy.php
echo  maps-dev/wmsproxy.php -^> edit/wmsproxy.php
echo  (Kein SFTP-Upload -- nur lokaler Abgleich)
echo  Danach: 02_upload-edit.bat
echo ============================================
echo.
"%MAPPLUS_PYTHON_EXE%" _scripts\deployment\deployengine\sync_tnet_to_site.py --site edit %*
if errorlevel 1 (
    echo.
    echo [FEHLER] Sync fehlgeschlagen.
    pause
    exit /b 1
)
echo.
echo [OK] Sync abgeschlossen. Naechster Schritt: 02_upload-edit.bat
pause
