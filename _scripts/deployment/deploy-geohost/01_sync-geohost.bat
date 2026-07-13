@echo off
title Sync GEOHOST -- maps-dev/tnet nach geohost/tnet (lokal)
call "%~dp0..\..\dev_and_deploy_config.bat"
if errorlevel 1 exit /b 1
cd /d "%MAPPLUS_WORKSPACE_ROOT%"
echo.
echo ============================================
echo  SYNC GEOHOST -- maps-dev/tnet/ -^> geohost/tnet/
echo  (Kein SFTP-Upload -- nur lokaler Abgleich)
echo  Danach: 02_upload-geohost.bat
echo ============================================
echo.
"%MAPPLUS_PYTHON_EXE%" _scripts\deployment\deployengine\sync_tnet_to_site.py --site geohost %*
if errorlevel 1 (
    echo.
    echo [FEHLER] Sync fehlgeschlagen.
    pause
    exit /b 1
)
echo.
echo [OK] Sync abgeschlossen. Naechster Schritt: 02_upload-geohost.bat
pause
