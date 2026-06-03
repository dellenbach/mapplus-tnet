@echo off
title Upload PROD -- js-stage nach /www/maps/tnet/js
call "%~dp0..\..\dev_and_deploy_config.bat"
if errorlevel 1 exit /b 1
cd /d "%MAPPLUS_WORKSPACE_ROOT%"

echo.
echo ============================================
echo  [3/3] UPLOAD MINIFIED/OBFUSCATED
echo  maps-dev/tnet/js-stage -^> /www/maps/tnet/js
echo  Mapping: tnet/js-stage/* -^> tnet/js/*
echo  Dry-Run: 03_upload-minifiedobfuscated.bat --dry-run
echo ============================================
echo.

"%MAPPLUS_PYTHON_EXE%" _scripts\deployment\deployengine\upload_js_stage_to_prod.py %*
if errorlevel 1 (
    echo.
    echo [FEHLER] Upload js-stage fehlgeschlagen.
    pause
    exit /b 1
)

echo.
echo [OK] Upload js-stage abgeschlossen.
pause
