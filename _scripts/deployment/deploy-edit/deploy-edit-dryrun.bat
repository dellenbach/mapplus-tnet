@echo off
title Deploy EDIT -- Dry-Run (Vorschau)
call "%~dp0..\..\dev_and_deploy_config.bat"
if errorlevel 1 exit /b 1
cd /d "%MAPPLUS_WORKSPACE_ROOT%"
echo.
echo ============================================
echo  DEPLOY EDIT -- DRY-RUN (nur Vorschau)
echo  Zeigt was hochgeladen wuerde, ohne Upload
echo ============================================
echo.
"%MAPPLUS_PYTHON_EXE%" _scripts\deployment\deployengine\upload_changed.py --env edit --dry-run
pause
