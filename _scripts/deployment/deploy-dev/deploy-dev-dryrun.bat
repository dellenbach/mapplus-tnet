@echo off
title Dry-Run DEV -- Vorschau (kein Upload)
call "%~dp0..\..\dev_and_deploy_config.bat"
if errorlevel 1 exit /b 1
cd /d "%MAPPLUS_WORKSPACE_ROOT%"
echo.
echo ============================================
echo  DRY-RUN DEV -- Vorschau (kein Upload)
echo  Zeigt geaenderte Dateien fuer /www/maps-dev
echo ============================================
echo.
"%MAPPLUS_PYTHON_EXE%" _scripts\deployment\deployengine\upload_changed.py --env dev --build-js-stage --dry-run
echo.
pause
