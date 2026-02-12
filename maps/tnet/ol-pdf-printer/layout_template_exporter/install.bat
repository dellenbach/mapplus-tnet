@echo off
REM ============================================================
REM  install.bat
REM  Kopiert das Plugin in das QGIS 3.x Plugin-Verzeichnis
REM
REM  Aufruf: install.bat
REM  (aus dem Ordner layout_template_exporter heraus ausfuehren)
REM ============================================================

setlocal

REM --- QGIS Plugin-Zielverzeichnis ermitteln ---
set "QGIS_PLUGINS=%APPDATA%\QGIS\QGIS3\profiles\default\python\plugins"
set "PLUGIN_NAME=layout_template_exporter"
set "TARGET=%QGIS_PLUGINS%\%PLUGIN_NAME%"

echo.
echo ============================================
echo   Layout Template Exporter - Installation
echo ============================================
echo.
echo Quelle:  %~dp0
echo Ziel:    %TARGET%
echo.

REM --- Pruefen ob QGIS-Profil existiert ---
if not exist "%QGIS_PLUGINS%" (
    echo [INFO] Plugin-Verzeichnis existiert noch nicht, wird angelegt...
    mkdir "%QGIS_PLUGINS%"
)

REM --- Altes Plugin entfernen falls vorhanden ---
if exist "%TARGET%" (
    echo [INFO] Vorhandenes Plugin wird entfernt...
    rmdir /s /q "%TARGET%"
)

REM --- Plugin kopieren ---
echo [INFO] Kopiere Plugin-Dateien...
mkdir "%TARGET%"

copy /y "%~dp0__init__.py"                "%TARGET%\" >nul
copy /y "%~dp0plugin.py"                  "%TARGET%\" >nul
copy /y "%~dp0layout_export_dialog.py"    "%TARGET%\" >nul
copy /y "%~dp0resources.py"               "%TARGET%\" >nul
copy /y "%~dp0resources.qrc"              "%TARGET%\" >nul
copy /y "%~dp0metadata.txt"               "%TARGET%\" >nul
copy /y "%~dp0icon.svg"                   "%TARGET%\" >nul

REM --- icon.png kopieren falls vorhanden ---
if exist "%~dp0icon.png" (
    copy /y "%~dp0icon.png" "%TARGET%\" >nul
) else (
    REM Fallback: SVG als PNG-Referenz kopieren
    copy /y "%~dp0icon.svg" "%TARGET%\icon.png" >nul
    echo [WARNUNG] icon.png nicht gefunden, icon.svg als Fallback kopiert.
)

echo.
echo ============================================
echo   Installation abgeschlossen!
echo ============================================
echo.
echo Naechste Schritte:
echo   1. QGIS starten (oder neu starten)
echo   2. Sketching ^> Sketching verwalten ^> "Layout Template Exporter" aktivieren
echo      oder: Sketching ^> Sketching installieren aus ZIP
echo   3. Toolbar-Button oder Sketching-Menue verwenden
echo.

pause
