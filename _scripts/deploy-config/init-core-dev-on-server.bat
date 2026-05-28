@echo off
setlocal enabledelayedexpansion
title EINMALIG -- /www/core-dev/ auf Server initialisieren
call "%~dp0..\dev_and_deploy_config.bat"
if errorlevel 1 exit /b 1
cd /d "%MAPPLUS_WORKSPACE_ROOT%"
echo.
echo ============================================================
echo  EINMALIG: /www/core-dev/ initialisieren
echo  Kopiert /www/core/ -^> /www/core-dev/ (remote-to-remote)
echo.
echo  Danach gilt:
echo    /maps-dev/ Anfragen  -^>  /www/core-dev/
echo    /maps/     Anfragen  -^>  /www/core/
echo    SLM target=dev       -^>  /www/core-dev/
echo    SLM target=prod      -^>  /www/core/
echo ============================================================
echo.
echo Optionen:
echo   [1] Nur fehlende Dateien kopieren  (sicher, Standard)
echo   [2] Alle Dateien neu kopieren      (--overwrite)
echo   [3] Dry-Run (Vorschau, nichts wird geaendert)
echo.
set /p "CHOICE=Auswahl (1/2/3): "

if "%CHOICE%"=="1" (
    "%MAPPLUS_PYTHON_EXE%" _scripts\deployment\init_core_dev.py
    goto :check_result
)

if "%CHOICE%"=="2" (
    echo.
    echo [WARN] --overwrite ueberschreibt alle bestehenden Dateien in /www/core-dev/
    set /p "CONFIRM=Fortfahren? (j/n): "
    if /i not "!CONFIRM!"=="j" ( echo [ABBRUCH] & pause & exit /b 0 )
    "%MAPPLUS_PYTHON_EXE%" _scripts\deployment\init_core_dev.py --overwrite
    goto :check_result
)

if "%CHOICE%"=="3" (
    "%MAPPLUS_PYTHON_EXE%" _scripts\deployment\init_core_dev.py --dry-run
    goto :check_result
)

echo [ABBRUCH] Ungueltige Auswahl.
pause
exit /b 1

:check_result
if errorlevel 1 (
    echo.
    echo [FEHLER] Initialisierung fehlgeschlagen.
    pause
    exit /b 1
)
echo.
pause
