@echo off
title PROD Release -- Clean Stage + Promote + Deploy + Git
call "%~dp0..\..\dev_and_deploy_config.bat"
if errorlevel 1 exit /b 1
cd /d "%MAPPLUS_WORKSPACE_ROOT%"

:: Zweck:
:: Voller PROD-Release mit erzwungenem JS-Komplettbuild:
:: [1] JS-Stage aus maps-dev\tnet\js nach maps-dev\tnet\js-stage komplett neu bauen
:: [2] lokaler Sync maps-dev -> maps, JS-Originale nach js-src, JS-Stage nach js
:: [3] Changed-Files-Upload von maps -> /www/maps
:: [4] Git Commit + Push Workflow starten

echo.
echo ============================================
echo  PROD RELEASE -- CLEAN JS BUILD
echo  [1] JS Stage komplett neu bauen (--rebuild-all)
echo  [2] Promotion          (Originale -^> js-src, Stage -^> js)
echo  [3] Code nach /www/maps (SFTP, Runtime-JS forciert)
echo  [4] Git Commit + Push
echo  (JS, PHP, CSS, HTML -- KEIN Config-Deploy)
echo ============================================
echo.

:: ---- SCHRITT 1: JS Stage komplett neu bauen ----
echo [1/4] JS Stage komplett neu bauen (maps-dev\tnet\js -^> maps-dev\tnet\js-stage) ...
echo.
"%MAPPLUS_PYTHON_EXE%" -u _scripts\build\build_js.py --mode prod --src-root maps-dev\tnet\js --out-root maps-dev\tnet\js-stage --rebuild-all
if errorlevel 1 (
    echo.
    echo [FEHLER] JS-Stage-Build fehlgeschlagen.
    pause
    exit /b 1
)
echo [OK] JS Stage komplett neu gebaut.
echo.

:: ---- SCHRITT 2: Lokale Promotion ----
echo [2/4] Lokale Promotion (Originale nach js-src, Stage nach js) ...
echo.
"%MAPPLUS_PYTHON_EXE%" _scripts\deployment\deployengine\promote_dev_to_prod.py
if errorlevel 1 (
    echo.
    echo [FEHLER] Lokale Promotion fehlgeschlagen.
    pause
    exit /b 1
)
echo [OK] Promotion abgeschlossen.
echo.

:: Hinweis:
:: Fuer einzelne Dateien ist deploy-active-file.bat der gezielte Ausnahmefall.

:: ---- SCHRITT 3: Upload PROD ----
echo [3/4] Upload geaenderten Codes nach /www/maps ...
echo.
"%MAPPLUS_PYTHON_EXE%" _scripts\deployment\deployengine\upload_changed.py --env prod --code-only --force-js
if errorlevel 1 (
    echo.
    echo [FEHLER] Upload fehlgeschlagen.
    pause
    exit /b 1
)
echo.
echo ============================================
echo  [OK] PROD RELEASE MIT CLEAN BUILD ABGESCHLOSSEN
echo ============================================
echo.
echo [4/4] Git Commit + Push Workflow starten ...
echo.
call _scripts\deployment\deploy-prod\git-commit.bat --no-sync