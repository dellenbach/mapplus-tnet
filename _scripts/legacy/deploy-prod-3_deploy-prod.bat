@echo off
title [3/3] Deploy PROD -- maps -^> /www/maps
call "%~dp0..\..\dev_and_deploy_config.bat"
if errorlevel 1 exit /b 1
cd /d "%MAPPLUS_WORKSPACE_ROOT%"

:: Zweck:
:: Changed-Files-Deploy fuer den bereits vorbereiteten PROD-Baum maps\.
:: Standardmaessig nur geaenderter Code: PHP, JS, HTML/HTM.
:: Fuer eine gezielte Einzeldatei stattdessen deploy-active-file.bat verwenden.

echo.
echo ============================================
echo  SCHRITT 3/3 -- Upload PROD
echo  Geaenderter Code -^> /www/maps
echo  Typen: PHP, JS, HTML/HTM
echo  Einzeldatei: deploy-active-file.bat ^<pfad^>
echo ============================================
echo.
"%MAPPLUS_PYTHON_EXE%" _scripts\deployment\deployengine\upload_changed.py --env prod --code-only
if errorlevel 1 (
    echo.
    echo [FEHLER] Upload fehlgeschlagen.
    pause
    exit /b 1
)
echo.
echo [OK] Deploy PROD abgeschlossen.
echo      Weiter mit: git-commit.bat
pause
