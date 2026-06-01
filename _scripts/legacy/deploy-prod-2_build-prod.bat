@echo off
title [2/3] Build PROD -- JS minifizieren + obfuskieren (maps/)
call "%~dp0..\..\dev_and_deploy_config.bat"
if errorlevel 1 exit /b 1
cd /d "%MAPPLUS_WORKSPACE_ROOT%"

:: Zweck:
:: Baut alle JS-Quellen aus maps\tnet\js_ori nach maps\tnet\js.
:: PROD nutzt den zentralen Build mit Minify + Obfuscation.

echo.
echo ============================================
echo  SCHRITT 2/3 -- JS Full-Build PROD
echo  maps\tnet\js_ori\ -^> maps\tnet\js\ (minifiziert + obfuskiert)
echo ============================================
echo.
"%MAPPLUS_PYTHON_EXE%" -u _scripts\build\build_js.py --mode prod --src-root maps\tnet\js_ori --out-root maps\tnet\js --rebuild-all
if errorlevel 1 (
    echo.
    echo [FEHLER] Build fehlgeschlagen.
    pause
    exit /b 1
)
echo.
echo [OK] Build abgeschlossen.
echo      Weiter mit: 3_deploy-prod.bat
pause
