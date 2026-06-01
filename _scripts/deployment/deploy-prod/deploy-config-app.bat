@echo off
title Config Deploy -- App-Config -^> PROD (/www/maps/tnet/config/)
call "%~dp0..\..\dev_and_deploy_config.bat"
if errorlevel 1 exit /b 1
cd /d "%MAPPLUS_WORKSPACE_ROOT%"
echo.
echo ============================================
echo  CONFIG DEPLOY -- App-Config PROD
echo  maps\tnet\config\ -^> /www/maps/tnet/config/
echo  (tnet-global-config.json5, tnet-mapcontrols-config.json5 ...)
echo.
echo  HINWEIS: Layer-Configs (core/config/, core/nls/)
echo  bitte primaer ueber den SLM deployen!
echo ============================================
echo.
"%MAPPLUS_PYTHON_EXE%" _scripts\deployment\deployengine\upload_config.py --type app --env prod
if errorlevel 1 (
    echo.
    echo [FEHLER] Config-Deploy fehlgeschlagen.
    pause
    exit /b 1
)
echo.
pause
