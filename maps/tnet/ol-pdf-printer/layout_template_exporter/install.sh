#!/bin/bash
# ============================================================
#  install.sh
#  Kopiert das Plugin in das QGIS 3.x Plugin-Verzeichnis
#
#  Aufruf: ./install.sh
#  (aus dem Ordner layout_template_exporter heraus ausfuehren)
# ============================================================

set -e

PLUGIN_NAME="layout_template_exporter"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- Betriebssystem-spezifisches Zielverzeichnis ---
if [[ "$OSTYPE" == "darwin"* ]]; then
    QGIS_PLUGINS="$HOME/Library/Application Support/QGIS/QGIS3/profiles/default/python/plugins"
else
    QGIS_PLUGINS="$HOME/.local/share/QGIS/QGIS3/profiles/default/python/plugins"
fi

TARGET="$QGIS_PLUGINS/$PLUGIN_NAME"

echo ""
echo "============================================"
echo "  Layout Template Exporter - Installation"
echo "============================================"
echo ""
echo "Quelle:  $SCRIPT_DIR"
echo "Ziel:    $TARGET"
echo ""

# --- Verzeichnis anlegen falls noetig ---
mkdir -p "$QGIS_PLUGINS"

# --- Altes Plugin entfernen ---
if [ -d "$TARGET" ]; then
    echo "[INFO] Vorhandenes Plugin wird entfernt..."
    rm -rf "$TARGET"
fi

# --- Plugin kopieren ---
echo "[INFO] Kopiere Plugin-Dateien..."
mkdir -p "$TARGET"

cp "$SCRIPT_DIR/__init__.py"              "$TARGET/"
cp "$SCRIPT_DIR/plugin.py"                "$TARGET/"
cp "$SCRIPT_DIR/layout_export_dialog.py"  "$TARGET/"
cp "$SCRIPT_DIR/resources.py"             "$TARGET/"
cp "$SCRIPT_DIR/resources.qrc"            "$TARGET/"
cp "$SCRIPT_DIR/metadata.txt"             "$TARGET/"
cp "$SCRIPT_DIR/icon.svg"                 "$TARGET/"

if [ -f "$SCRIPT_DIR/icon.png" ]; then
    cp "$SCRIPT_DIR/icon.png" "$TARGET/"
else
    cp "$SCRIPT_DIR/icon.svg" "$TARGET/icon.png"
    echo "[WARNUNG] icon.png nicht gefunden, icon.svg als Fallback kopiert."
fi

echo ""
echo "============================================"
echo "  Installation abgeschlossen!"
echo "============================================"
echo ""
echo "Naechste Schritte:"
echo "  1. QGIS starten (oder neu starten)"
echo "  2. Sketching > Sketching verwalten > 'Layout Template Exporter' aktivieren"
echo "  3. Toolbar-Button oder Sketching-Menue verwenden"
echo ""
