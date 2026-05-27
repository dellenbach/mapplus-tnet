@echo off
title Config Deploy -- App-Config -> DEV (/www/maps-dev/tnet/config/)
cd /d "C:\_Daten\mapplus-exp"
echo.
echo ============================================
echo  CONFIG DEPLOY -- App-Config DEV
echo  maps-dev\tnet\config\ -> /www/maps-dev/tnet/config/
echo  (tnet-global-config.json5, tnet-mapcontrols-config.json5 ...)
echo.
echo  HINWEIS: Layer-Configs (core/config/, core/nls/)
echo  bitte primaer ueber den SLM deployen!
echo ============================================
echo.
"C:\Program Files\Python313\python.exe" _scripts\deployment\upload_config.py --type app --env dev
if errorlevel 1 (
    echo.
    echo [FEHLER] Config-Deploy fehlgeschlagen.
    pause
    exit /b 1
)
echo.
pause
