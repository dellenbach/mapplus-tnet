@echo off
REM ============================================================
REM  compile_resources.bat
REM  Kompiliert resources.qrc -> resources.py mit pyrcc5
REM
REM  Aufruf: compile_resources.bat
REM  Voraussetzung: pyrcc5 muss im PATH liegen
REM  (wird mit QGIS/OSGeo4W installiert)
REM ============================================================

echo Kompiliere resources.qrc ...
pyrcc5 -o resources.py resources.qrc

if %ERRORLEVEL% equ 0 (
    echo Erfolgreich: resources.py wurde erzeugt.
) else (
    echo FEHLER: pyrcc5 nicht gefunden oder Kompilierung fehlgeschlagen.
    echo Stellen Sie sicher, dass die OSGeo4W-Shell aktiv ist oder
    echo pyrcc5 im PATH liegt.
)
pause
