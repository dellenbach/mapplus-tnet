@echo off

:: Zentrale Entwicklungs- und Deploy-Konfiguration fuer Batch-Skripte.
:: Bei Standortwechsel oder Python-Upgrade nur diese Werte anpassen.
:: Workspace-Root wird robust relativ zum Skriptverzeichnis abgeleitet
:: (dieses Skript liegt in <root>\_scripts\), damit Umbenennungen/Moves nicht brechen.
if not defined MAPPLUS_WORKSPACE_ROOT (
    for %%I in ("%~dp0..") do set "MAPPLUS_WORKSPACE_ROOT=%%~fI"
)

if not defined MAPPLUS_PYTHON_EXE (
    set "MAPPLUS_PYTHON_EXE=C:\Program Files\Python313\python.exe"
)

if not exist "%MAPPLUS_WORKSPACE_ROOT%\" (
    echo [FEHLER] MAPPLUS_WORKSPACE_ROOT nicht gefunden: %MAPPLUS_WORKSPACE_ROOT%
    exit /b 1
)

if not exist "%MAPPLUS_PYTHON_EXE%" (
    echo [FEHLER] MAPPLUS_PYTHON_EXE nicht gefunden: %MAPPLUS_PYTHON_EXE%
    exit /b 1
)

exit /b 0