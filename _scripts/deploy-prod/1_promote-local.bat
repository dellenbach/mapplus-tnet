@echo off
setlocal
title [1/3] Promote -- maps-dev nach maps (lokal)
call "%~dp0..\dev_and_deploy_config.bat"
if errorlevel 1 exit /b 1
cd /d "%MAPPLUS_WORKSPACE_ROOT%"

:: Zweck:
:: Lokaler Abgleich von maps-dev nach maps fuer den PROD-Stand im Repository.
:: Dieser Schritt deployed noch nichts auf den Server.

echo.
echo ============================================
echo  SCHRITT 1/3 -- Lokale Promotion
echo  maps-dev nach maps (robocopy)
echo ============================================
echo.
robocopy maps-dev maps /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1
set "ROBOCOPY_RC=%ERRORLEVEL%"
if %ROBOCOPY_RC% geq 8 (
    echo.
    echo [FEHLER] Robocopy fehlgeschlagen. Exitcode %ROBOCOPY_RC%
    pause
    exit /b 1
)
echo.
echo [OK] Promotion abgeschlossen (robocopy Exit %ROBOCOPY_RC%).
echo      Weiter mit: 2_build-prod.bat
pause
