# Layout Template Exporter – QGIS Plugin

Ein QGIS 3.x Plugin zum Export leerer Layout-Vorlagen (A4–A0) als **SVG** oder **PDF**.  
Die erzeugten Templates enthalten Platzhalter für Kartenfläche, Titelblock, Legende, Firmenlogo und Maßstab – ideal für die Weiterverwendung in Web-Apps wie **ol-pdf-printer**.

---

## Features

| Element              | Beschreibung                                        |
|----------------------|-----------------------------------------------------|
| **Kartenfläche**     | Transparente Platzhalter-Box (gestrichelt)           |
| **Titelblock**       | Oberer Bereich – wird in der Web-App ersetzt         |
| **Legende**          | Rechte Spalte – Platzhalter                          |
| **Firmenlogo**       | Platzhalter-Box unter der Legende                    |
| **Maßstab**          | Fußzeile – kein echter QGIS-Maßstab, nur Platzhalter|

## Installation

### Variante A – Direkte Kopie

1. Ordner `layout_template_exporter` nach  
   `%APPDATA%\QGIS\QGIS3\profiles\default\python\plugins\`  
   kopieren (Windows) bzw.  
   `~/.local/share/QGIS/QGIS3/profiles/default/python/plugins/` (Linux/Mac).

2. QGIS starten → **Erweiterungen** → **Erweiterungen verwalten** →  
   „Layout Template Exporter" aktivieren.

### Variante B – ZIP-Installation

1. Ordner als `.zip` verpacken (Name: `layout_template_exporter.zip`).
2. QGIS → **Erweiterungen** → **Aus ZIP installieren …** → ZIP auswählen.

## Verwendung

1. **Menü**: *Sketching* → *Layout Template Exporter* → *Layout-Vorlagen exportieren (A4–A0)*  
   oder Toolbar-Button klicken.
2. Im Dialog:
   - Papierformat wählen (A4 – A0)
   - Orientierung wählen (Hochformat / Querformat)
   - Exportformat wählen (SVG / PDF)
   - Zielverzeichnis wählen
3. **OK** → Die Datei wird exportiert, z.B. `layout_a3_landscape.svg`.

## Ressourcen kompilieren (optional)

Falls das Icon geändert wird:

```bash
# Windows (OSGeo4W Shell)
pyrcc5 -o resources.py resources.qrc

# oder die mitgelieferten Skripte verwenden:
compile_resources.bat   # Windows
./compile_resources.sh  # Linux/Mac
```

## Dateistruktur

```
layout_template_exporter/
├── __init__.py                 # Plugin-Entry-Point
├── plugin.py                   # Hauptklasse (Menü, Toolbar)
├── layout_export_dialog.py     # Dialog + Layout-Erzeugung
├── resources.qrc               # Qt-Ressourcen-Definition
├── resources.py                # Kompilierte Ressourcen
├── icon.svg                    # Plugin-Icon (Quelle)
├── icon.png                    # Plugin-Icon (wird von QGIS geladen)
├── metadata.txt                # QGIS-Plugin-Metadaten
├── compile_resources.bat       # Windows Build-Skript
├── compile_resources.sh        # Linux/Mac Build-Skript
└── README.md                   # Diese Datei
```

## Lizenz

MIT License
