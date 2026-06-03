@echo off
title PROD Release -- Hash-Stage + Promote + Deploy + Git
call "%~dp0..\..\dev_and_deploy_config.bat"
if errorlevel 1 exit /b 1
cd /d "%MAPPLUS_WORKSPACE_ROOT%"

:: Zweck:
:: Voller PROD-Release in einem Lauf:
:: [1] JS-Stage aus maps-dev\tnet\js nach maps-dev\tnet\js-stage bauen (Hash-Cache)
:: [2] lokaler Sync maps-dev -> maps, JS-Originale nach js-src, JS-Stage nach js
:: [3] Changed-Files-Upload von maps -> /www/maps
:: [4] Git Commit + Push Workflow starten

echo.
echo ============================================
echo  PROD RELEASE -- ANWENDUNGSCODE
echo  [1] JS Stage bauen     (Hash-Cache, nur Aenderungen)
echo  [2] Promotion          (Originale -^> js-src, Stage -^> js)
echo  [3] Code nach /www/maps (SFTP, Runtime-JS forciert)
echo  [4] Git Commit + Push
echo  (JS, PHP, CSS, HTML -- KEIN Config-Deploy)
echo ============================================
echo.
set /p "RELEASE_COMMIT_MSG=Commit-Nachricht fuer diesen Release (leer = Abbruch): "
if "%RELEASE_COMMIT_MSG%"=="" (
    echo [ABBRUCH] Keine Commit-Nachricht angegeben.
    pause
    exit /b 0
)
echo.

:: ---- SCHRITT 1: JS Stage bauen ----
echo [1/4] JS Stage bauen mit Hash-Cache (maps-dev\tnet\js -^> maps-dev\tnet\js-stage) ...
echo.
"%MAPPLUS_PYTHON_EXE%" -u _scripts\build\build_js.py --mode prod --src-root maps-dev\tnet\js --out-root maps-dev\tnet\js-stage
if errorlevel 1 (
    echo.
    echo [FEHLER] JS-Stage-Build fehlgeschlagen.
    pause
    exit /b 1
)
echo [OK] JS Stage gebaut.
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
echo  [OK] PROD RELEASE ABGESCHLOSSEN
echo ============================================
echo.
echo [4/4] Git Commit + Push Workflow starten ...
echo.
call _scripts\deployment\deploy-prod\git-commit.bat --no-sync --push --msg "%RELEASE_COMMIT_MSG%"
