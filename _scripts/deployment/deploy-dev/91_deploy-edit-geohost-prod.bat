@echo off
setlocal

title Deploy EDIT + GEOHOST + PROD
call "%~dp0..\..\dev_and_deploy_config.bat"
if errorlevel 1 exit /b 1
cd /d "%MAPPLUS_WORKSPACE_ROOT%"

echo.
echo ============================================
echo  KOMPLETT-DEPLOY: EDIT + GEOHOST + PROD
echo  Je Umgebung: 01 Sync, danach 02 SFTP-Upload
echo  Dry-Run: 91_deploy-edit-geohost-prod.bat --dry-run
echo ============================================
echo.

if /I "%~1"=="--dry-run" goto :dryRun

call :runStep "EDIT: lokaler Sync" "%~dp0..\deploy-edit\01_sync-edit.bat"
if errorlevel 1 goto :failed
call :runStep "EDIT: SFTP-Upload" "%~dp0..\deploy-edit\02_upload-edit.bat"
if errorlevel 1 goto :failed
call :runStep "GEOHOST: lokaler Sync" "%~dp0..\deploy-geohost\01_sync-geohost.bat"
if errorlevel 1 goto :failed
call :runStep "GEOHOST: SFTP-Upload" "%~dp0..\deploy-geohost\02_upload-geohost.bat"
if errorlevel 1 goto :failed
call :runStep "PROD: lokaler Sync" "%~dp0..\deploy-prod\01_sync-maps-dev2maps.bat"
if errorlevel 1 goto :failed
call :runStep "PROD: SFTP-Upload" "%~dp0..\deploy-prod\02_deploy-prod.bat"
if errorlevel 1 goto :failed

echo.
echo [OK] EDIT, GEOHOST und PROD wurden vollstaendig verarbeitet.
pause
exit /b 0

:dryRun
call :runStep "EDIT: lokaler Sync (Dry-Run)" "%~dp0..\deploy-edit\01_sync-edit.bat" --dry-run
if errorlevel 1 goto :failed
call :runStep "EDIT: SFTP-Upload (Dry-Run)" "%~dp0..\deploy-edit\deploy-edit-dryrun.bat"
if errorlevel 1 goto :failed
call :runStep "GEOHOST: lokaler Sync (Dry-Run)" "%~dp0..\deploy-geohost\01_sync-geohost.bat" --dry-run
if errorlevel 1 goto :failed
call :runStep "GEOHOST: SFTP-Upload (Dry-Run)" "%~dp0..\deploy-geohost\deploy-geohost-dryrun.bat"
if errorlevel 1 goto :failed
call :runStep "PROD: lokaler Sync (Dry-Run)" "%~dp0..\deploy-prod\01_sync-maps-dev2maps.bat" --dry-run
if errorlevel 1 goto :failed
call :runStep "PROD: SFTP-Upload (Dry-Run)" "%~dp0..\deploy-prod\02_deploy-prod.bat" --dry-run
if errorlevel 1 goto :failed
echo.
echo [OK] Dry-Run fuer EDIT, GEOHOST und PROD abgeschlossen.
pause
exit /b 0

:runStep
echo.
echo --------------------------------------------
echo  %~1
echo --------------------------------------------
call "%~2" %~3 %~4 %~5 %~6 %~7 %~8 %~9 < nul
exit /b %errorlevel%

:failed
echo.
echo [FEHLER] Komplett-Deploy wurde abgebrochen.
pause
exit /b 1
