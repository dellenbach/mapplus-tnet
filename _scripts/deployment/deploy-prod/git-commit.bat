@echo off
title Git -- Stage und Commit
call "%~dp0..\..\dev_and_deploy_config.bat"
if errorlevel 1 exit /b 1
cd /d "%MAPPLUS_WORKSPACE_ROOT%"

:: Zweck:
:: Source-Stand aus maps-dev\ und maps\ gemeinsam committen.
:: Optional kann davor der lokale maps-dev -> maps Abgleich ausgefuehrt werden.

echo.
echo ============================================
echo  GIT -- Stage und Commit
echo ============================================
echo.
set "SYNC_GITHUB="
set /p "SYNC_GITHUB=Vor dem Git-Commit maps-dev -^> maps synchronisieren? (J/n): "
if /i not "%SYNC_GITHUB%"=="n" (
    echo.
    echo --- Lokaler Abgleich fuer GitHub (maps-dev -^> maps) ---
    "%MAPPLUS_PYTHON_EXE%" _scripts\deployment\deployengine\promote_dev_to_prod.py
    if errorlevel 1 (
        echo.
        echo [FEHLER] Lokaler Abgleich fehlgeschlagen.
        pause
        exit /b 1
    )
    echo.
)

echo Aktueller Branch:
git branch --show-current
echo.
echo --- Status vor Staging ---
git status --short
echo.

:: Source-Dateien stagen (maps/ und maps-dev/), PROD-Build-Output maps\tnet\js\ bewusst ausschliessen.
:: maps-dev\tnet\js\ ist kuenftig die lesbare DEV-Quelle und bleibt gestaged.
echo --- Staging: Source-Dateien (maps/ und maps-dev/, ohne js/) ---
git add -- maps/ maps-dev/
git restore --staged -- maps/tnet/js/ 2>nul
echo.

:: Gestage Aenderungen anzeigen
echo --- Gestagt (bereit fuer Commit) ---
git diff --cached --stat
echo.
echo --- Status nach Staging ---
git status --short
echo.

:: Pruefen ob etwas zu committen ist
git diff --cached --quiet
if %errorlevel% equ 0 (
    echo [INFO] Keine gestagten Aenderungen vorhanden.
    pause
    exit /b 0
)

:: Commit-Nachricht abfragen
set /p "COMMIT_MSG=Commit-Nachricht (leer = Abbruch): "
if "%COMMIT_MSG%"=="" (
    echo [ABBRUCH] Keine Nachricht eingegeben. Staging bleibt erhalten.
    pause
    exit /b 0
)

git commit -m "%COMMIT_MSG%"
if errorlevel 1 (
    echo.
    echo [FEHLER] Commit fehlgeschlagen.
    pause
    exit /b 1
)
echo.
echo [OK] Commit erstellt.
echo.

:: Push anbieten
set /p "PUSH=Jetzt git push ausfuehren? (j/n): "
if /i "%PUSH%"=="j" (
    git push
    if errorlevel 1 (
        echo [FEHLER] Push fehlgeschlagen.
        pause
        exit /b 1
    )
    echo [OK] Push erfolgreich.
)
echo.
pause
