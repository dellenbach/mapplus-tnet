@echo off

:: Zentrale Entwicklungs- und Deploy-Konfiguration fuer Batch-Skripte.
:: Workspace-Root wird standardmaessig relativ zu dieser Datei erkannt.
:: Optional koennen MAPPLUS_WORKSPACE_ROOT und MAPPLUS_PYTHON_EXE von aussen gesetzt werden.
if not defined MAPPLUS_WORKSPACE_ROOT (
    for %%I in ("%~dp0..") do set "MAPPLUS_WORKSPACE_ROOT=%%~fI"
)

if not defined MAPPLUS_PYTHON_EXE (
    set "MAPPLUS_PYTHON_EXE="
    if not defined MAPPLUS_PYTHON_EXE (
        if exist "C:\Program Files\Python313\python.exe" (
            set "MAPPLUS_PYTHON_EXE=C:\Program Files\Python313\python.exe"
        )
    )
    if not defined MAPPLUS_PYTHON_EXE (
        for /f "delims=" %%P in ('where python.exe 2^>nul') do (
            if not defined MAPPLUS_PYTHON_EXE set "MAPPLUS_PYTHON_EXE=%%P"
        )
    )
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