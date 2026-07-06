@echo off
title Dry-Run EDIT -- Vorschau (kein Upload)
call "%~dp0..\..\dev_and_deploy_config.bat"
if errorlevel 1 exit /b 1
cd /d "%MAPPLUS_WORKSPACE_ROOT%"
echo.
echo ============================================
echo  DRY-RUN EDIT -- Vorschau (kein Upload)
echo  Zeigt geaenderte Dateien aus edit fuer /www/edit
echo  Scope: tnet/**, agsproxy.php, wmsproxy.php
echo ============================================
echo.
"%MAPPLUS_PYTHON_EXE%" _scripts\deployment\deployengine\upload_changed.py --env edit --dry-run
echo.
pause
