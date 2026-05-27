@echo off
title Core Config -> PROD (/www/core/)
cd /d "C:\_Daten\mapplus-exp"
echo.
echo ============================================
echo  CORE CONFIG DEPLOY -- PROD
echo  core\config\ + core\nls\ -> /www/core/
echo.
echo  HINWEIS: Layer-Configs primaer ueber den
echo  SLM deployen (slm.html)!
echo  Dieses Script: Fallback / Massen-Upload
echo ============================================
echo.
echo Verfuegbare Typen:
echo   [1] Nur config/   (layers_*.conf, maptips_*.conf ...)
echo   [2] Nur nls/      (Sprachressourcen)
echo   [3] Alles         (config/ + nls/)
echo.
set /p "CHOICE=Auswahl (1/2/3): "

if "%CHOICE%"=="1" set TYPE=config
if "%CHOICE%"=="2" set TYPE=nls
if "%CHOICE%"=="3" set TYPE=all
if not defined TYPE (
    echo [ABBRUCH] Ungueltige Auswahl.
    pause
    exit /b 1
)

echo.
"C:\Program Files\Python313\python.exe" _scripts\deployment\upload_core_config.py --type %TYPE% --env prod
if errorlevel 1 (
    echo.
    echo [FEHLER] Deploy fehlgeschlagen.
    pause
    exit /b 1
)
echo.
pause
