@echo off
title Config Deploy -- Portal-Configs -> PROD (/www/maps/public/config/)
cd /d "C:\_Daten\mapplus-exp"
echo.
echo ============================================
echo  CONFIG DEPLOY -- Portal-Configs PROD
echo  maps\public\config\ -> /www/maps/public/config/
echo  (nwpro, owpro, nodi, marco ...)
echo ============================================
echo.
"C:\Program Files\Python313\python.exe" _scripts\deployment\upload_config.py --type portals --env prod
if errorlevel 1 (
    echo.
    echo [FEHLER] Config-Deploy fehlgeschlagen.
    pause
    exit /b 1
)
echo.
pause
