@echo off
title Deploy PROD -- maps nach /www/maps
call "%~dp0..\..\dev_and_deploy_config.bat"
if errorlevel 1 exit /b 1
cd /d "%MAPPLUS_WORKSPACE_ROOT%"

echo.
echo ============================================
echo  DEPLOY PROD -- ANWENDUNGSCODE + CONFIG-SCHUTZ
echo  Geaenderte Dateien -^> /www/maps
echo  JS-Dateien immer forcieren (tnet/js)
echo  Nicht-JS weiterhin hashbasiert
echo  (JS, PHP, CSS, HTML + tnet/config/)
echo  Dry-Run: 02_deploy-prod.bat --dry-run
echo  Einzeldatei: deploy-active-file.bat ^<pfad^>
echo ============================================
echo.

"%MAPPLUS_PYTHON_EXE%" _scripts\deployment\deployengine\upload_changed.py --env prod --force-js --allow-tnet-config %*
if errorlevel 1 (
    echo. public, uwpro, nwpr, owpro
    echo [FEHLER] Deploy fehlgeschlagen.
    pause
    exit /b 1
)

echo.
echo [OK] Deploy PROD abgeschlossen.
pause
