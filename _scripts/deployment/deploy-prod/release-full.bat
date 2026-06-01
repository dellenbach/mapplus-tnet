@echo off
title PROD Release -- Promote + Build + Deploy
call "%~dp0..\..\dev_and_deploy_config.bat"
if errorlevel 1 exit /b 1
cd /d "%MAPPLUS_WORKSPACE_ROOT%"

:: Zweck:
:: Voller PROD-Release in einem Lauf:
:: [1] lokaler Sync maps-dev -> maps + JS-Quellen nach js_ori sichern
:: [2] JS PROD-Build mit Minify + Obfuscation aus js_ori nach js
:: [3] Changed-Files-Upload von maps -> /www/maps

echo.
echo ============================================
echo  PROD RELEASE -- ANWENDUNGSCODE
echo  [1] maps-dev nach maps + js_ori vorbereiten
echo  [2] JS Build PROD     (js_ori -^> js, minify + obfuscation)
echo  [3] Code nach /www/maps (SFTP)
echo  (JS, PHP, CSS, HTML -- KEIN Config-Deploy)
echo ============================================
echo.

:: ---- SCHRITT 1: Lokale Promotion ----
echo [1/3] Lokale Promotion (maps-dev nach maps, js_ori vorbereiten) ...
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

:: ---- SCHRITT 2: JS Full-Build PROD ----
echo [2/3] JS Full-Build PROD (minifiziert + obfuskiert) ...
echo.
"%MAPPLUS_PYTHON_EXE%" -u _scripts\build\build_js.py --mode prod --src-root maps\tnet\js_ori --out-root maps\tnet\js --rebuild-all
if errorlevel 1 (
    echo.
    echo [FEHLER] Build fehlgeschlagen.
    pause
    exit /b 1
)
echo [OK] Build abgeschlossen.
echo.

:: Hinweis:
:: Fuer einzelne Dateien ist deploy-active-file.bat der gezielte Ausnahmefall.

:: ---- SCHRITT 3: Upload PROD ----
echo [3/3] Upload geaenderten Codes nach /www/maps ...
echo.
"%MAPPLUS_PYTHON_EXE%" _scripts\deployment\deployengine\upload_changed.py --env prod --code-only
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
echo  Naechster Schritt: git-commit.bat
echo.
pause
