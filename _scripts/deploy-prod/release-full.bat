@echo off
title PROD Release -- Promote + Build + Deploy
cd /d "C:\_Daten\mapplus-exp"
echo.
echo ============================================
echo  PROD RELEASE -- ANWENDUNGSCODE
echo  [1] maps-dev -> maps  (lokal, robocopy)
echo  [2] JS minifizieren   (esbuild PROD)
echo  [3] maps -> /www/maps (SFTP)
echo  (JS, PHP, CSS, HTML -- KEIN Config-Deploy)
echo ============================================
echo.

:: ---- SCHRITT 1: Lokale Promotion ----
echo [1/3] Lokale Promotion (maps-dev -> maps) ...
echo.
robocopy maps-dev maps /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1
if %errorlevel% geq 8 (
    echo.
    echo [FEHLER] Robocopy fehlgeschlagen (Exit %errorlevel%).
    pause
    exit /b 1
)
echo [OK] Promotion abgeschlossen (Exit %errorlevel%).
echo.

:: ---- SCHRITT 2: JS Full-Build PROD ----
echo [2/3] JS Full-Build PROD (minifiziert) ...
echo.
"C:\Program Files\Python313\python.exe" _scripts\build\build_js.py --mode prod
if errorlevel 1 (
    echo.
    echo [FEHLER] Build fehlgeschlagen.
    pause
    exit /b 1
)
echo [OK] Build abgeschlossen.
echo.

:: ---- SCHRITT 3: Upload PROD ----
echo [3/3] Upload geaenderter Dateien -> /www/maps ...
echo.
"C:\Program Files\Python313\python.exe" _scripts\deployment\upload_changed.py --env prod
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
