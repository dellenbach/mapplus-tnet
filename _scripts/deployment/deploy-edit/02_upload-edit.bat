@echo off
title Upload EDIT -- edit/tnet nach /www/edit/tnet (SFTP)
call "%~dp0..\..\dev_and_deploy_config.bat"
if errorlevel 1 exit /b 1
cd /d "%MAPPLUS_WORKSPACE_ROOT%"
echo.
echo ============================================
echo  UPLOAD EDIT -- edit/tnet/ -^> /www/edit/tnet/
echo  Geaenderte Dateien per SFTP hochladen
echo ============================================
echo.
"%MAPPLUS_PYTHON_EXE%" _scripts\deployment\deployengine\upload_changed.py --env edit
if errorlevel 1 (
    echo.
    echo [FEHLER] Upload fehlgeschlagen.
    pause
    exit /b 1
)
echo.
echo [OK] Upload EDIT abgeschlossen.
pause
