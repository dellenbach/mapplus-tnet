@echo off
title PROD Release -- Promote + Build + Deploy
call "%~dp0..\dev_and_deploy_config.bat"
if errorlevel 1 exit /b 1
cd /d "%MAPPLUS_WORKSPACE_ROOT%"

:: Zweck:
:: Voller PROD-Release in einem Lauf:
:: [1] lokaler Sync maps-dev -> maps
:: [2] JS PROD-Build mit Minify + Obfuscation
:: [3] Changed-Files-Upload von maps -> /www/maps

echo.
echo ============================================
echo  PROD RELEASE -- ANWENDUNGSCODE
echo  [1] maps-dev nach maps (lokal, robocopy)
echo  [2] JS Build PROD     (minify + obfuscation)
echo  [3] Code nach /www/maps (SFTP)
echo  (JS, PHP, CSS, HTML -- KEIN Config-Deploy)
echo ============================================
echo.

:: ---- SCHRITT 1: Lokale Promotion ----
echo [1/3] Lokale Promotion (maps-dev nach maps) ...
echo.
robocopy maps-dev maps /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1
set "ROBOCOPY_RC=%ERRORLEVEL%"
if %ROBOCOPY_RC% geq 8 (
    echo.
    echo [FEHLER] Robocopy fehlgeschlagen. Exitcode %ROBOCOPY_RC%
    pause
    exit /b 1
)
echo [OK] Promotion abgeschlossen (Exit %ROBOCOPY_RC%).
echo.

:: ---- SCHRITT 2: JS Full-Build PROD ----
echo [2/3] JS Full-Build PROD (minifiziert + obfuskiert) ...
echo.
"%MAPPLUS_PYTHON_EXE%" -u _scripts\build\build_js.py --mode prod
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
"%MAPPLUS_PYTHON_EXE%" _scripts\deployment\upload_changed.py --env prod --code-only
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
