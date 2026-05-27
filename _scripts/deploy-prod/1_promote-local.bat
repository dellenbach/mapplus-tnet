@echo off
title [1/3] Promote -- maps-dev -> maps (lokal)
cd /d "C:\_Daten\mapplus-exp"
echo.
echo ============================================
echo  SCHRITT 1/3 -- Lokale Promotion
echo  maps-dev\ -> maps\ (robocopy)
echo ============================================
echo.
robocopy maps-dev maps /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1
if %errorlevel% geq 8 (
    echo.
    echo [FEHLER] Robocopy fehlgeschlagen (Exit %errorlevel%).
    pause
    exit /b 1
)
echo.
echo [OK] Promotion abgeschlossen (robocopy Exit %errorlevel%).
echo      Weiter mit: 2_build-prod.bat
pause
