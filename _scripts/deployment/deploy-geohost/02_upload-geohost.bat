@echo off
title Upload GEOHOST -- geohost/tnet nach /www/geohost/tnet (SFTP)
call "%~dp0..\..\dev_and_deploy_config.bat"
if errorlevel 1 exit /b 1
cd /d "%MAPPLUS_WORKSPACE_ROOT%"
echo.
echo ============================================
echo  UPLOAD GEOHOST -- per SFTP
echo  geohost/tnet/       -^> /www/geohost/tnet/
echo  geohost/agsproxy.php -^> /www/geohost/agsproxy.php
echo  geohost/wmsproxy.php -^> /www/geohost/wmsproxy.php
echo ============================================
echo.
"%MAPPLUS_PYTHON_EXE%" _scripts\deployment\deployengine\upload_changed.py --env geohost
if errorlevel 1 (
    echo.
    echo [FEHLER] Upload fehlgeschlagen.
    pause
    exit /b 1
)
echo.
echo [OK] Upload GEOHOST abgeschlossen.
pause
