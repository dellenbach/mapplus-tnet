@echo off
title Config Deploy -- Portal-Configs -^> PROD (/www/maps/public/config/)
call "%~dp0..\..\dev_and_deploy_config.bat"
if errorlevel 1 exit /b 1
cd /d "%MAPPLUS_WORKSPACE_ROOT%"
echo.
echo ============================================
echo  CONFIG DEPLOY -- Portal-Configs PROD
echo  maps\public\config\ -^> /www/maps/public/config/
echo  (nwpro, owpro, nodi, marco ...)
echo ============================================
echo.
"%MAPPLUS_PYTHON_EXE%" _scripts\deployment\deployengine\upload_config.py --type portals --env prod
if errorlevel 1 (
    echo.
    echo [FEHLER] Config-Deploy fehlgeschlagen.
    pause
    exit /b 1
)
echo.
pause
