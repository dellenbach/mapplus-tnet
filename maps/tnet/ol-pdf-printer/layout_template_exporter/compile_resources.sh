#!/bin/bash
# ============================================================
#  compile_resources.sh
#  Kompiliert resources.qrc -> resources.py mit pyrcc5
#
#  Aufruf: ./compile_resources.sh
#  Voraussetzung: pyrcc5 muss im PATH liegen
# ============================================================

set -e
echo "Kompiliere resources.qrc ..."
pyrcc5 -o resources.py resources.qrc
echo "Erfolgreich: resources.py wurde erzeugt."
