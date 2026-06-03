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
set "COMMIT_MSG_ARG="
set "AUTO_PUSH=n"
:: Parameter parsen
:parse_args
if "%~1"=="" goto args_done
if /i "%~1"=="--no-sync" set "SYNC_GITHUB=n"
if /i "%~1"=="--push"   set "AUTO_PUSH=y"
if /i "%~1"=="--msg" (
    set "COMMIT_MSG_ARG=%~2"
    shift
)
shift
goto parse_args
:args_done
if not defined SYNC_GITHUB set /p "SYNC_GITHUB=Vor dem Git-Commit maps-dev -^> maps synchronisieren? [J/n]: "
if /i not "%SYNC_GITHUB%"=="n" (
    echo.
    echo --- Lokaler Abgleich fuer GitHub: maps-dev -^> maps ---
    "%MAPPLUS_PYTHON_EXE%" _scripts\deployment\deployengine\promote_dev_to_prod.py
    if errorlevel 1 (
        echo.
        echo [FEHLER] Lokaler Abgleich fehlgeschlagen.
        pause
        exit /b 1
    )
    echo.
)
if /i "%SYNC_GITHUB%"=="n" (
    echo [INFO] Lokaler Abgleich uebersprungen.
    echo.
)

:: Git-Pager deaktivieren -- verhindert "less"-Prompts in Batch-Umgebungen
set GIT_PAGER=cat

echo Aktueller Branch:
git branch --show-current
echo.
echo --- Status vor Staging ---
git status --short
echo.

:: Source-Dateien stagen (maps/ und maps-dev/), Build-Artefakte bewusst ausschliessen.
:: maps-dev\tnet\js\ ist die lesbare DEV-Quelle; maps\tnet\js-src\ ist der lesbare PROD-Quellstand.
echo --- Staging: Source-Dateien (maps/ und maps-dev/, ohne Build-Artefakte) ---
git add -- maps/ maps-dev/
git restore --staged -- maps/tnet/js/ 2>nul
git restore --staged -- maps-dev/tnet/js-stage/ 2>nul
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

:: Commit-Nachricht -- ggf. aus --msg uebernehmen, sonst interaktiv abfragen
if defined COMMIT_MSG_ARG (
    set "COMMIT_MSG=%COMMIT_MSG_ARG%"
) else (
    set /p "COMMIT_MSG=Commit-Nachricht (leer = Abbruch): "
)
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

:: Push anbieten -- ggf. automatisch via --push, sonst interaktiv
if /i "%AUTO_PUSH%"=="y" (
    set "PUSH=j"
) else (
    set /p "PUSH=Jetzt git push ausfuehren? (j/n): "
)
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
