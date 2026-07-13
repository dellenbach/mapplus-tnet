@echo off
title Deploy GEOHOST -- Dry-Run (Vorschau)
call "%~dp0..\..\dev_and_deploy_config.bat"
if errorlevel 1 exit /b 1
cd /d "%MAPPLUS_WORKSPACE_ROOT%"
echo.
echo ============================================
echo  DEPLOY GEOHOST -- DRY-RUN (nur Vorschau)
echo  Zeigt was hochgeladen wuerde, ohne Upload
echo ============================================
echo.
"%MAPPLUS_PYTHON_EXE%" _scripts\deployment\deployengine\upload_changed.py --env geohost --dry-run
pause
