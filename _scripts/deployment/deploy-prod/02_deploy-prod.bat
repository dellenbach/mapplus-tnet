@echo off
title Deploy PROD -- maps nach /www/maps
call "%~dp0..\..\dev_and_deploy_config.bat"
if errorlevel 1 exit /b 1
cd /d "%MAPPLUS_WORKSPACE_ROOT%"

echo.
echo ============================================
echo  DEPLOY PROD -- ANWENDUNGSCODE + CONFIG-SCHUTZ
echo  Geaenderte Dateien -^> /www/maps
echo  tnet-global-config.json5: logLevel = warn erzwingen
echo  JS-Dateien immer forcieren (tnet/js)
echo  Nicht-JS weiterhin hashbasiert
echo  (JS, PHP, CSS, HTML + tnet/config/)
echo  Dry-Run: 02_deploy-prod.bat --dry-run
echo  Einzeldatei: deploy-active-file.bat ^<pfad^>
echo ============================================
echo.

set "LOGLEVEL_DRY_RUN="
for %%A in (%*) do (
    if /I "%%~A"=="--dry-run" set "LOGLEVEL_DRY_RUN=--dry-run"
)

echo [1/2] PROD-Loglevel in JSON5 auf warn pruefen/setzen ...
echo.
"%MAPPLUS_PYTHON_EXE%" _scripts\deployment\deployengine\enforce_prod_loglevel.py %LOGLEVEL_DRY_RUN%
if errorlevel 1 (
    echo.
    echo [FEHLER] Loglevel-Anpassung fehlgeschlagen.
    pause
    exit /b 1
)
echo.
echo [2/2] Geaenderten Code nach /www/maps hochladen ...
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
