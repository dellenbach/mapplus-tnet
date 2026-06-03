@echo off
title Dry-Run PROD Release -- Vorschau (keine Aenderungen)
call "%~dp0..\..\dev_and_deploy_config.bat"
if errorlevel 1 exit /b 1
cd /d "%MAPPLUS_WORKSPACE_ROOT%"

:: Zweck:
:: Vorschau fuer den Release-Ablauf ohne lokale oder Remote-Aenderungen.
:: Der JS-Stage-Build wird hier absichtlich nicht ausgefuehrt, weil es dafuer
:: keinen nebenwirkungsfreien Dry-Run gibt. Geprueft werden Stage, Sync und Upload.

echo.
echo ============================================
echo  DRY-RUN PROD RELEASE (keine Aenderungen)
echo ============================================
echo.
echo [1/2] Promotion Dry-Run (js -^> js-src, js-stage -^> js) ...
echo.
"%MAPPLUS_PYTHON_EXE%" _scripts\deployment\deployengine\promote_dev_to_prod.py --dry-run
echo.
echo [2/2] Upload Dry-Run fuer geaenderten Code (maps -^> /www/maps) ...
echo.
"%MAPPLUS_PYTHON_EXE%" _scripts\deployment\deployengine\upload_changed.py --env prod --code-only --force-js --dry-run
echo.
echo [INFO] Dry-Run abgeschlossen. Keine Dateien veraendert.
pause
