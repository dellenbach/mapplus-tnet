@echo off
title Git -- Stage und Commit
cd /d "C:\_Daten\mapplus-exp"
echo.
echo ============================================
echo  GIT -- Stage und Commit
echo ============================================
echo.
echo Aktueller Branch:
git branch --show-current
echo.
echo --- Status vor Staging ---
git status --short
echo.

:: Source-Dateien stagen (maps/ und maps-dev/), Build-Output js/ ausschliessen
echo --- Staging: Source-Dateien (maps/ und maps-dev/, ohne js/) ---
git add -- maps/ maps-dev/
git restore --staged -- maps/tnet/js/ maps-dev/tnet/js/ 2>nul
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
