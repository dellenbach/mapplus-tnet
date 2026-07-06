@echo off
title Deploy EDIT -- edit nach /www/edit (tnet + proxys)
call "%~dp0..\..\dev_and_deploy_config.bat"
if errorlevel 1 exit /b 1
cd /d "%MAPPLUS_WORKSPACE_ROOT%"
echo.
echo ============================================
echo  DEPLOY EDIT -- TNET + PROXYS
echo  Geaenderte Dateien aus edit -^> /www/edit
echo  Scope: tnet/**, agsproxy.php, wmsproxy.php
echo ============================================
echo.
"%MAPPLUS_PYTHON_EXE%" _scripts\deployment\deployengine\upload_changed.py --env edit
if errorlevel 1 (
    echo.
    echo [FEHLER] Deploy fehlgeschlagen.
    pause
    exit /b 1
)
echo.
echo [OK] Deploy EDIT abgeschlossen.
pause
