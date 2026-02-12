# -*- coding: utf-8 -*-
"""
Layout Template Exporter – Export-Dialog & Layout-Erzeugung

Exportiert QGIS-Layouts als SVG/PDF in die vollständige Ordnerstruktur
für den WebGIS-Druckdienst (ol-pdf-printer).

Erzeugte Struktur pro Zielordner:
    <ziel>/
    ├── layout_a4_portrait.svg     ← SVG-Layout-Vorlagen
    ├── layout_a3_landscape.svg
    ├── …
    └── manifest.json            ← Konfig für die Web-App
"""

import json
import os
import re
from datetime import datetime

from qgis.PyQt.QtCore import Qt, QCoreApplication
from qgis.PyQt.QtGui import QColor, QFont
from qgis.PyQt.QtWidgets import (
    QAbstractItemView,
    QCheckBox,
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QFileDialog,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QListWidget,
    QListWidgetItem,
    QMessageBox,
    QPushButton,
    QVBoxLayout,
)
from qgis.core import (
    QgsFillSymbol,
    QgsLayout,
    QgsLayoutExporter,
    QgsLayoutItemLabel,
    QgsLayoutItemMap,
    QgsLayoutItemPicture,
    QgsLayoutItemScaleBar,
    QgsLayoutItemShape,
    QgsLayoutPoint,
    QgsLayoutSize,
    QgsRenderContext,
    QgsPrintLayout,
    QgsProject,
    QgsSettings,
    QgsUnitTypes,
)


# -------------------------------------------------------------------- #
#  Konstanten                                                            #
# -------------------------------------------------------------------- #
PAPER_SIZES = {
    "A4": (210.0, 297.0),
    "A3": (297.0, 420.0),
    "A2": (420.0, 594.0),
    "A1": (594.0, 841.0),
    "A0": (841.0, 1189.0),
}

MARGIN = 10.0  # mm

# Dynamische Element-IDs (für WebGIS-Templates)
DYNAMIC_ELEMENTS = [
    "TITLE_TEXT",
    "SCALE_TEXT",
    "SCALE_BAR",
    "SCALE_LABEL",
    "COORDINATES_TEXT",
    "DATE_TEXT",
    "NORTH_ARROW",
]

# Platzhalter-Mapping: Element-ID → Variable + Platzhalter-Text
# Im SVG werden diese Platzhalter als Text exportiert und
# vom WebGIS zur Laufzeit durch echte Werte ersetzt.
PLACEHOLDER_MAP = {
    "TITLE_TEXT":       {"variable": "title",       "placeholder": "{{TITLE}}"},
    "SCALE_TEXT":       {"variable": "scale",       "placeholder": "{{SCALE}}"},
    "SCALE_BAR":        {"variable": "scaleBar",    "placeholder": "{{SCALE_BAR}}"},
    "SCALE_LABEL":      {"variable": "scaleLabel",  "placeholder": ""},
    "COORDINATES_TEXT": {"variable": "coordinates", "placeholder": "{{COORDINATES}}"},
    "DATE_TEXT":        {"variable": "date",        "placeholder": "{{DATE}}"},
    "NORTH_ARROW":      {"variable": "northArrow",  "placeholder": "{{NORTH_ARROW}}"},
}

# IDs für grafische Elemente, die im SVG durch rote Bboxen
# ersetzt und vom OL-Printer dynamisch gezeichnet werden.
GRAPHIC_ELEMENT_IDS = {"NORTH_ARROW", "SCALE_BAR", "SCALE_LABEL"}

# QgsSettings-Schlüssel für persistente Ordnerliste
SETTINGS_PREFIX = "LayoutTemplateExporter"
SETTINGS_DIRS_KEY = f"{SETTINGS_PREFIX}/outputDirs"
SETTINGS_FORMAT_KEY = f"{SETTINGS_PREFIX}/exportFormat"


# -------------------------------------------------------------------- #
#  Dialog                                                                #
# -------------------------------------------------------------------- #
class LayoutExportDialog(QDialog):
    """Dialog: Layouts per Checkbox auswählen, Zielordner,exportieren."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle(self.tr("Layout-Vorlagen für Druckdienst exportieren"))
        self.setMinimumWidth(580)
        self.setMinimumHeight(640)
        self.plugin_version = "1.2.1"
        # Lokale Zeit automatisch setzen
        from datetime import datetime as _dt
        self.plugin_date = _dt.now().strftime("%d.%m.%Y %H:%M")
        self._build_ui()
        self._restore_settings()

    # ================================================================== #
    #  UI                                                                  #
    # ================================================================== #
    def _build_ui(self):
        root = QVBoxLayout(self)

        # ---- Version-Info ------------------------------------------- #
        version_label = QLabel(
            f"<i>Version {self.plugin_version} ({self.plugin_date})</i>"
        )
        version_label.setStyleSheet("color: #666; padding: 4px;")
        root.addWidget(version_label)

        # ---- 1. Bestehende QGIS-Layouts (Checkboxen) --------------- #
        grp_layouts = QGroupBox(self.tr("QGIS-Projekt Layouts"))
        lay_layouts = QVBoxLayout()

        self.list_layouts = QListWidget()
        self.list_layouts.setMinimumHeight(120)
        self._populate_layouts()
        lay_layouts.addWidget(self.list_layouts)

        lay_sel = QHBoxLayout()
        btn_all = QPushButton(self.tr("✓ Alle"))
        btn_all.clicked.connect(self._select_all_layouts)
        btn_none = QPushButton(self.tr("✗ Keine"))
        btn_none.clicked.connect(self._deselect_all_layouts)
        btn_refresh = QPushButton(self.tr("↻ Aktualisieren"))
        btn_refresh.clicked.connect(self._refresh_layouts)
        lay_sel.addWidget(btn_all)
        lay_sel.addWidget(btn_none)
        lay_sel.addWidget(btn_refresh)
        lay_sel.addStretch()
        lay_layouts.addLayout(lay_sel)

        grp_layouts.setLayout(lay_layouts)
        root.addWidget(grp_layouts)

        # ---- 2. Neue leere Templates erzeugen (optional) ----------- #
        self.grp_new = QGroupBox(
            self.tr("Zusätzlich neue leere Templates erzeugen")
        )
        self.grp_new.setCheckable(True)
        self.grp_new.setChecked(False)
        lay_new = QVBoxLayout()

        self.list_new_templates = QListWidget()
        self.list_new_templates.setMinimumHeight(90)
        for paper in PAPER_SIZES:
            for orient_label, orient_key in [("Hoch", "portrait"),
                                             ("Quer", "landscape")]:
                item = QListWidgetItem(f"{paper} {orient_label}format")
                item.setFlags(item.flags() | Qt.ItemIsUserCheckable)
                item.setCheckState(Qt.Unchecked)
                item.setData(Qt.UserRole, {
                    "paper": paper,
                    "orientation": orient_key,
                    "label": orient_label,
                })
                self.list_new_templates.addItem(item)

        lay_new.addWidget(self.list_new_templates)
        self.grp_new.setLayout(lay_new)
        root.addWidget(self.grp_new)

        # ---- 3. Exportformat ---------------------------------------- #
        grp_fmt = QGroupBox(self.tr("Exportformat"))
        lay_fmt = QHBoxLayout()
        self.combo_format = QComboBox()
        self.combo_format.addItems(["SVG", "PDF", "SVG + PDF"])
        lay_fmt.addWidget(QLabel(self.tr("Format:")))
        lay_fmt.addWidget(self.combo_format)
        grp_fmt.setLayout(lay_fmt)
        root.addWidget(grp_fmt)

        # ---- 4. Zielordner ----------------------------------------- #
        grp_dirs = QGroupBox(self.tr("Zielordner (Druckdienst)"))
        lay_dirs = QVBoxLayout()

        lay_dirs.addWidget(QLabel(
            self.tr(
                "SVGs werden direkt in <Ordner>/ exportiert,\n"
                "manifest.json ebenfalls in <Ordner>/.\n"
                "Ordner werden beim nächsten Start gemerkt."
            )
        ))

        self.list_dirs = QListWidget()
        self.list_dirs.setSelectionMode(QAbstractItemView.ExtendedSelection)
        self.list_dirs.setMinimumHeight(80)
        lay_dirs.addWidget(self.list_dirs)

        lay_dir_btns = QHBoxLayout()
        btn_add = QPushButton(self.tr("➕ Ordner hinzufügen …"))
        btn_add.clicked.connect(self._add_directory)
        btn_remove = QPushButton(self.tr("➖ Markierte entfernen"))
        btn_remove.clicked.connect(self._remove_selected_dirs)
        lay_dir_btns.addWidget(btn_add)
        lay_dir_btns.addWidget(btn_remove)
        lay_dir_btns.addStretch()
        lay_dirs.addLayout(lay_dir_btns)

        grp_dirs.setLayout(lay_dirs)
        root.addWidget(grp_dirs)

        # ---- 5. Optionen -------------------------------------------- #
        grp_opts = QGroupBox(self.tr("Optionen"))
        lay_opts = QVBoxLayout()
        self.chk_manifest = QCheckBox(
            self.tr("manifest.json erzeugen / aktualisieren")
        )
        self.chk_manifest.setChecked(True)
        lay_opts.addWidget(self.chk_manifest)
        self.chk_overwrite = QCheckBox(
            self.tr("Vorhandene Dateien überschreiben")
        )
        self.chk_overwrite.setChecked(True)
        lay_opts.addWidget(self.chk_overwrite)
        grp_opts.setLayout(lay_opts)
        root.addWidget(grp_opts)

        # ---- OK / Abbrechen ---------------------------------------- #
        buttons = QDialogButtonBox(
            QDialogButtonBox.Ok | QDialogButtonBox.Cancel
        )
        buttons.button(QDialogButtonBox.Ok).setText(self.tr("Exportieren"))
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        root.addWidget(buttons)

    # ================================================================== #
    #  Layout-Liste befüllen (Checkboxen)                                  #
    # ================================================================== #
    def _populate_layouts(self):
        self.list_layouts.clear()
        manager = QgsProject.instance().layoutManager()
        layouts = manager.printLayouts()
        if layouts:
            for lay in layouts:
                item = QListWidgetItem(f"🗎  {lay.name()}")
                item.setFlags(item.flags() | Qt.ItemIsUserCheckable)
                item.setCheckState(Qt.Unchecked)
                item.setData(Qt.UserRole, lay.name())
                self.list_layouts.addItem(item)
        else:
            item = QListWidgetItem(self.tr("(Keine Layouts im Projekt)"))
            item.setFlags(
                item.flags() & ~Qt.ItemIsUserCheckable & ~Qt.ItemIsSelectable
            )
            item.setForeground(QColor("#888888"))
            self.list_layouts.addItem(item)

    def _select_all_layouts(self):
        for i in range(self.list_layouts.count()):
            item = self.list_layouts.item(i)
            if item.flags() & Qt.ItemIsUserCheckable:
                item.setCheckState(Qt.Checked)

    def _deselect_all_layouts(self):
        for i in range(self.list_layouts.count()):
            item = self.list_layouts.item(i)
            if item.flags() & Qt.ItemIsUserCheckable:
                item.setCheckState(Qt.Unchecked)

    def _refresh_layouts(self):
        self._populate_layouts()

    # ================================================================== #
    #  Persistente Einstellungen (QgsSettings)                            #
    # ================================================================== #
    def _restore_settings(self):
        s = QgsSettings()
        dirs_str = s.value(SETTINGS_DIRS_KEY, "")
        fmt_str = s.value(SETTINGS_FORMAT_KEY, "SVG")

        if dirs_str:
            for d in dirs_str.split("|"):
                d = d.strip()
                if d and d not in self._current_dirs():
                    self.list_dirs.addItem(d)

        if self.list_dirs.count() == 0:
            default = os.path.normpath(
                os.path.join(
                    os.path.dirname(__file__), os.pardir,
                    "integration", "ol-pdf-printer",
                )
            )
            self.list_dirs.addItem(default)

        idx = self.combo_format.findText(fmt_str)
        if idx >= 0:
            self.combo_format.setCurrentIndex(idx)

    def _save_settings(self):
        s = QgsSettings()
        s.setValue(SETTINGS_DIRS_KEY, "|".join(self._current_dirs()))
        s.setValue(SETTINGS_FORMAT_KEY, self.combo_format.currentText())

    def _current_dirs(self) -> list:
        return [
            self.list_dirs.item(i).text()
            for i in range(self.list_dirs.count())
        ]

    # ================================================================== #
    #  Ordner-Verwaltung                                                   #
    # ================================================================== #
    def _add_directory(self):
        start = ""
        if self.list_dirs.count() > 0:
            start = self.list_dirs.item(self.list_dirs.count() - 1).text()
        d = QFileDialog.getExistingDirectory(
            self, self.tr("Zielordner wählen"), start
        )
        if d:
            d = os.path.normpath(d)
            if d not in self._current_dirs():
                self.list_dirs.addItem(d)
            else:
                QMessageBox.information(
                    self, self.tr("Hinweis"),
                    self.tr(f"Ordner bereits vorhanden:\n{d}"),
                )

    def _remove_selected_dirs(self):
        for item in reversed(self.list_dirs.selectedItems()):
            self.list_dirs.takeItem(self.list_dirs.row(item))

    # ================================================================== #
    #  Properties                                                          #
    # ================================================================== #
    @staticmethod
    def tr(msg):
        return QCoreApplication.translate("LayoutExportDialog", msg)

    @property
    def export_formats(self) -> list:
        """['svg'], ['pdf'] oder ['svg','pdf']."""
        txt = self.combo_format.currentText()
        if txt == "SVG + PDF":
            return ["svg", "pdf"]
        return [txt.lower()]

    def _get_checked_existing(self) -> list:
        """Gibt die Namen aller angehakten bestehenden Layouts zurück."""
        names = []
        for i in range(self.list_layouts.count()):
            item = self.list_layouts.item(i)
            if (item.flags() & Qt.ItemIsUserCheckable) and \
               item.checkState() == Qt.Checked:
                names.append(item.data(Qt.UserRole))
        return names

    def _get_checked_new(self) -> list:
        """Gibt die angehakten neuen Template-Definitionen zurück."""
        if not self.grp_new.isChecked():
            return []
        result = []
        for i in range(self.list_new_templates.count()):
            item = self.list_new_templates.item(i)
            if item.checkState() == Qt.Checked:
                result.append(item.data(Qt.UserRole))
        return result

    # ================================================================== #
    #  EXPORT – Hauptmethode (Multi-Layout)                                #
    # ================================================================== #
    def export_layout(self, iface):
        """Exportiert alle ausgewählten Layouts in alle Zielordner."""

        dirs = self._current_dirs()
        if not dirs:
            QMessageBox.warning(
                None, self.tr("Fehler"),
                self.tr("Kein Zielordner angegeben."),
            )
            return

        existing_names = self._get_checked_existing()
        new_templates = self._get_checked_new()

        if not existing_names and not new_templates:
            QMessageBox.warning(
                None, self.tr("Fehler"),
                self.tr(
                    "Keine Layouts ausgewählt.\n"
                    "Bitte mindestens ein Layout anhaken oder\n"
                    "unter «Neue leere Templates» welche auswählen."
                ),
            )
            return

        self._save_settings()

        project = QgsProject.instance()
        exported_files = []
        errors = []

        # --- Bestehende Layouts exportieren ---
        for layout_name in existing_names:
            try:
                layout, base_filename, layout_info = \
                    self._prepare_existing_layout(project, layout_name)
                if layout is None:
                    errors.append(f"{layout_name}: Layout nicht gefunden")
                    continue
                for target_dir in dirs:
                    files = self._export_to_directory(
                        layout, base_filename, layout_info, target_dir
                    )
                    exported_files.extend(files)
            except Exception as e:
                errors.append(f"{layout_name}: {e}")

        # --- Neue leere Templates erzeugen ---
        for tmpl_def in new_templates:
            try:
                layout, base_filename, layout_info = \
                    self._prepare_new_template(
                        project,
                        tmpl_def["paper"],
                        tmpl_def["orientation"] == "landscape",
                    )
                for target_dir in dirs:
                    files = self._export_to_directory(
                        layout, base_filename, layout_info, target_dir
                    )
                    exported_files.extend(files)
            except Exception as e:
                errors.append(
                    f"{tmpl_def['paper']} {tmpl_def['label']}: {e}"
                )

        # --- Rückmeldung ---
        msg = []
        if exported_files:
            msg.append(self.tr("Erfolgreich exportiert:"))
            for f in exported_files:
                msg.append(f"  ✓ {f}")
        if errors:
            msg.append("")
            msg.append(self.tr("Fehler:"))
            for e in errors:
                msg.append(f"  ✗ {e}")

        if errors and not exported_files:
            QMessageBox.warning(
                None, self.tr("Export fehlgeschlagen"), "\n".join(msg)
            )
        else:
            QMessageBox.information(
                None, self.tr("Export abgeschlossen"), "\n".join(msg)
            )

    # ================================================================== #
    #  Layout-Vorbereitung                                                 #
    # ================================================================== #
    def _prepare_new_template(self, project, paper_key, is_landscape):
        """Erzeugt ein neues Layout mit Platzhaltern."""
        layout = QgsLayout(project)
        layout.initializeDefaults()

        w, h = PAPER_SIZES[paper_key]
        if is_landscape:
            w, h = h, w

        page = layout.pageCollection().page(0)
        page.setPageSize(QgsLayoutSize(w, h, QgsUnitTypes.LayoutMillimeters))

        self._add_page_border(layout, w, h)
        self._add_map_placeholder(layout, w, h)
        self._add_title_block(layout, w, h)
        self._add_footer_elements(layout, w, h)
        self._add_scale_bar(layout, w, h)
        self._add_north_arrow(layout, w, h)
        self._add_legend_placeholder(layout, w, h)
        self._add_logo_placeholder(layout, w, h)

        orient_str = "landscape" if is_landscape else "portrait"
        base = f"layout_{paper_key.lower()}_{orient_str}"

        orient_label = "Quer" if is_landscape else "Hoch"

        # MAP_AREA-Position aus _add_map_placeholder-Logik
        top, right, bottom = 25.0, 55.0, 20.0
        mx, my = MARGIN + 1, MARGIN + top + 1
        mw = w - 2 * MARGIN - right - 2
        mh = h - 2 * MARGIN - top - bottom - 2

        info = {
            "name": base,
            "title": f"{paper_key} {orient_label}",
            "paper": paper_key,
            "orientation": orient_str,
            "width_mm": w,
            "height_mm": h,
            "source": "generated",
            "mapFrame": {
                "x_mm": round(mx, 2),
                "y_mm": round(my, 2),
                "width_mm": round(mw, 2),
                "height_mm": round(mh, 2),
            },
        }

        # ── Alle Layout-Elemente scannen für Manifest ──
        elements = self._scan_layout_elements(layout, w, h)
        info["elements"] = elements

        return layout, base, info

    def _prepare_existing_layout(self, project, layout_name):
        """Liest ein bestehendes Layout aus dem QGIS-Projekt."""
        manager = project.layoutManager()
        layout = manager.layoutByName(layout_name)
        if layout is None:
            return None, None, None

        safe_name = layout_name.replace(" ", "_").lower()
        page = layout.pageCollection().page(0)
        size = page.pageSize()
        w_mm = size.width()
        h_mm = size.height()

        # Einheiten → mm umrechnen
        units = size.units()
        if units == QgsUnitTypes.LayoutCentimeters:
            w_mm *= 10
            h_mm *= 10
        elif units == QgsUnitTypes.LayoutInches:
            w_mm *= 25.4
            h_mm *= 25.4
        elif units == QgsUnitTypes.LayoutPoints:
            w_mm *= 0.352778
            h_mm *= 0.352778

        orient_str = "landscape" if w_mm > h_mm else "portrait"
        detected = self._detect_paper_size(w_mm, h_mm)
        base = f"{safe_name}_{orient_str}"

        # ── MAP_AREA: QgsLayoutItemMap suchen ──
        map_frame = None
        map_items = [
            item for item in layout.items()
            if isinstance(item, QgsLayoutItemMap)
        ]
        if map_items:
            # Grösstes Kartenelement verwenden
            map_item = max(
                map_items,
                key=lambda m: m.sizeWithUnits().width()
                             * m.sizeWithUnits().height(),
            )
            pos = map_item.positionWithUnits()
            sz = map_item.sizeWithUnits()
            # Position / Grösse → mm umrechnen
            mx = self._to_mm(pos.x(), pos.units())
            my = self._to_mm(pos.y(), pos.units())
            mw = self._to_mm(sz.width(), sz.units())
            mh = self._to_mm(sz.height(), sz.units())
            map_frame = {
                "x_mm": round(mx, 2),
                "y_mm": round(my, 2),
                "width_mm": round(mw, 2),
                "height_mm": round(mh, 2),
            }
        else:
            # Fallback: Shape mit ID "MAP_AREA" suchen
            for item in layout.items():
                item_id = getattr(item, 'id', lambda: '')() \
                    if callable(getattr(item, 'id', None)) else ''
                if item_id == 'MAP_AREA':
                    pos = item.positionWithUnits()
                    sz = item.sizeWithUnits()
                    mx = self._to_mm(pos.x(), pos.units())
                    my = self._to_mm(pos.y(), pos.units())
                    mw = self._to_mm(sz.width(), sz.units())
                    mh = self._to_mm(sz.height(), sz.units())
                    map_frame = {
                        "x_mm": round(mx, 2),
                        "y_mm": round(my, 2),
                        "width_mm": round(mw, 2),
                        "height_mm": round(mh, 2),
                    }
                    break

        info = {
            "name": layout_name,
            "title": layout_name,
            "paper": detected,
            "orientation": orient_str,
            "width_mm": round(w_mm, 1),
            "height_mm": round(h_mm, 1),
            "source": "qgis_project",
        }
        if map_frame:
            info["mapFrame"] = map_frame

        # ── Alle Layout-Elemente scannen für Manifest ──
        elements = self._scan_layout_elements(layout, w_mm, h_mm)
        # Interne _layout_item-Referenzen behalten (für Platzhalter)
        info["elements"] = elements

        return layout, base, info

    @staticmethod
    def _detect_paper_size(w, h):
        short, long_ = min(w, h), max(w, h)
        for name, (pw, ph) in PAPER_SIZES.items():
            if abs(short - pw) < 2 and abs(long_ - ph) < 2:
                return name
        return f"custom_{int(w)}x{int(h)}"

    @staticmethod
    def _to_mm(value, units):
        """Konvertiert einen Wert aus QGIS-Layout-Einheiten nach mm."""
        if units == QgsUnitTypes.LayoutMillimeters:
            return value
        elif units == QgsUnitTypes.LayoutCentimeters:
            return value * 10.0
        elif units == QgsUnitTypes.LayoutInches:
            return value * 25.4
        elif units == QgsUnitTypes.LayoutPoints:
            return value * 0.352778
        return value  # Fallback: annehmen mm

    # ================================================================== #
    #  Element-Scanning: Layout-Items analysieren                         #
    # ================================================================== #
    def _scan_layout_elements(self, layout, w_mm, h_mm):
        """Scannt alle Layout-Items und erstellt Element-Deskriptoren.

        Für jedes QgsLayoutItemLabel / QgsLayoutItemMap wird ein
        Eintrag mit Position, Grösse, Font-Info und Variablen-Zuordnung
        erstellt. Diese Informationen landen im manifest.json und
        ermöglichen dem WebGIS die exakte Platzierung von Overlays.

        Returns: list of dict
        """
        elements = []

        for item in layout.items():
            if isinstance(item, QgsLayoutItemMap):
                pos = item.positionWithUnits()
                sz = item.sizeWithUnits()
                elements.append({
                    "id": "MAP_AREA",
                    "type": "map",
                    "variable": "map",
                    "x_mm": round(self._to_mm(pos.x(), pos.units()), 2),
                    "y_mm": round(self._to_mm(pos.y(), pos.units()), 2),
                    "width_mm": round(self._to_mm(sz.width(), sz.units()), 2),
                    "height_mm": round(self._to_mm(sz.height(), sz.units()), 2),
                })

            elif isinstance(item, QgsLayoutItemLabel):
                item_id = item.id() if callable(getattr(item, 'id', None)) else ''
                text = item.text()
                pos = item.positionWithUnits()
                sz = item.sizeWithUnits()
                x = round(self._to_mm(pos.x(), pos.units()), 2)
                y = round(self._to_mm(pos.y(), pos.units()), 2)
                w = round(self._to_mm(sz.width(), sz.units()), 2)
                h = round(self._to_mm(sz.height(), sz.units()), 2)

                # Font-Informationen extrahieren
                font = item.font()
                font_info = {
                    "fontFamily": font.family(),
                    "fontSize_pt": font.pointSize(),
                    "fontWeight": "bold" if font.bold() else "normal",
                }

                # Alignment
                h_align = item.hAlign()
                align_str = "left"
                if h_align == Qt.AlignHCenter or h_align == Qt.AlignCenter:
                    align_str = "center"
                elif h_align == Qt.AlignRight:
                    align_str = "right"

                # Klassifizierung: Welche Variable gehört zu diesem Label?
                classified = self._classify_label(item_id, text, x, y, w_mm, h_mm)

                # Grafische Elemente (SCALE_LABEL etc.) → Bbox statt Text
                is_graphic = classified["id"] in GRAPHIC_ELEMENT_IDS

                elem = {
                    "id": classified["id"],
                    "type": classified["variable"] if is_graphic else "text",
                    "variable": classified["variable"],
                    "placeholder": classified.get("placeholder", ""),
                    "originalText": text,
                    "x_mm": x,
                    "y_mm": y,
                    "width_mm": w,
                    "height_mm": h,
                    "hAlign": align_str,
                    **font_info,
                }
                if is_graphic:
                    elem["_is_graphic"] = True
                elements.append(elem)
                # Referenz auf Layout-Item merken (für Platzhalter-Ersetzung)
                elem["_layout_item"] = item

            # ── Massstabsbalken ──
            elif isinstance(item, QgsLayoutItemScaleBar):
                item_id = item.id() if callable(getattr(item, 'id', None)) else ''
                pos = item.positionWithUnits()
                sz = item.sizeWithUnits()
                elem = {
                    "id": item_id or "SCALE_BAR",
                    "type": "scaleBar",
                    "variable": "scaleBar",
                    "x_mm": round(self._to_mm(pos.x(), pos.units()), 2),
                    "y_mm": round(self._to_mm(pos.y(), pos.units()), 2),
                    "width_mm": round(self._to_mm(sz.width(), sz.units()), 2),
                    "height_mm": round(self._to_mm(sz.height(), sz.units()), 2),
                    "_layout_item": item,
                    "_is_graphic": True,
                }
                elements.append(elem)

            # ── Nordpfeil (QgsLayoutItemPicture) ──
            elif isinstance(item, QgsLayoutItemPicture):
                item_id = item.id() if callable(getattr(item, 'id', None)) else ''
                pic_path = ''
                if hasattr(item, 'picturePath'):
                    pic_path = item.picturePath() or ''
                is_north = (
                    'NORTH' in (item_id or '').upper()
                    or 'ARROW' in (item_id or '').upper()
                    or 'NORDPFEIL' in (item_id or '').upper()
                    or 'north' in pic_path.lower()
                    or 'arrow' in pic_path.lower()
                )
                if is_north:
                    pos = item.positionWithUnits()
                    sz = item.sizeWithUnits()
                    elem = {
                        "id": item_id or "NORTH_ARROW",
                        "type": "northArrow",
                        "variable": "northArrow",
                        "x_mm": round(self._to_mm(pos.x(), pos.units()), 2),
                        "y_mm": round(self._to_mm(pos.y(), pos.units()), 2),
                        "width_mm": round(self._to_mm(sz.width(), sz.units()), 2),
                        "height_mm": round(self._to_mm(sz.height(), sz.units()), 2),
                        "_layout_item": item,
                        "_is_graphic": True,
                    }
                    elements.append(elem)

        return elements

    @staticmethod
    def _classify_label(item_id, text, x, y, page_w, page_h):
        """Klassifiziert ein Label anhand ID, Text oder Position.

        Rückgabe: dict mit id, variable, placeholder
        """
        # 1. Bekannte ID (vom Benutzer oder Plugin gesetzt)
        if item_id in PLACEHOLDER_MAP:
            info = PLACEHOLDER_MAP[item_id]
            return {
                "id": item_id,
                "variable": info["variable"],
                "placeholder": info["placeholder"],
            }

        # 2. Text enthält bereits einen {{PLACEHOLDER}}
        for elem_id, info in PLACEHOLDER_MAP.items():
            ph = info.get("placeholder", "")
            if ph and ph in text:
                return {
                    "id": elem_id,
                    "variable": info["variable"],
                    "placeholder": ph,
                }

        # 3. Heuristik: Text-Inhalt analysieren
        text_lower = text.lower().strip()

        # Massstabs-Bezeichnung (z.B. "1:100'000") → SCALE_LABEL (grafisch)
        # Kurzer Text der NUR die Massstabszahl enthält
        if re.search(r"^1\s*:\s*[\d\s''\u2019\u2018.]+$", text.strip()):
            return {
                "id": "SCALE_LABEL",
                "variable": "scaleLabel",
                "placeholder": "",
            }

        # Massstabs-Text mit Beschreibung → SCALE_TEXT (Footer)
        if re.search(r'massstab|maßstab', text_lower):
            return {
                "id": "SCALE_TEXT",
                "variable": "scale",
                "placeholder": "{{SCALE}}",
            }

        # Koordinaten-Erkennung (LV95, EPSG:2056)
        if re.search(r"lv95|lv03|koordinat|2[\u2018\u2019']?\d{3}|epsg", text_lower):
            return {
                "id": "COORDINATES_TEXT",
                "variable": "coordinates",
                "placeholder": "{{COORDINATES}}",
            }

        # Datum-Erkennung
        if re.search(r'\d{1,2}\.\d{1,2}\.\d{2,4}|datum|date|erstellt', text_lower):
            return {
                "id": "DATE_TEXT",
                "variable": "date",
                "placeholder": "{{DATE}}",
            }

        # Nordpfeil-Erkennung
        if re.search(r'nord|north|n\s*[\u2191\u25b2]|pfeil|arrow', text_lower):
            return {
                "id": "NORTH_ARROW",
                "variable": "northArrow",
                "placeholder": "{{NORTH_ARROW}}",
            }

        # Massstabsbalken-Erkennung
        if re.search(r'scale.?bar|massstab.?balken', text_lower):
            return {
                "id": "SCALE_BAR",
                "variable": "scaleBar",
                "placeholder": "{{SCALE_BAR}}",
            }

        # 4. Position-Heuristik: oben = Titel
        if y < page_h * 0.15:
            return {
                "id": "TITLE_TEXT",
                "variable": "title",
                "placeholder": "{{TITLE}}",
            }

        # 5. Unbekannt — trotzdem mit Metadaten exportieren
        safe_id = re.sub(r'[^A-Za-z0-9_]', '_', text[:20]).upper() + "_TEXT"
        return {
            "id": safe_id,
            "variable": "",
            "placeholder": "",
        }

    # ================================================================== #
    #  Platzhalter temporär setzen / wiederherstellen                      #
    # ================================================================== #
    def _set_placeholder_texts(self, layout, elements):
        """Setzt temporär {{PLACEHOLDER}} Text in Labels vor dem Export.

        Returns: dict(item_python_id → original_text)
        """
        originals = {}
        for elem in elements:
            # Grafische Elemente überspringen (werden versteckt, nicht ersetzt)
            if elem.get("_is_graphic"):
                continue
            item = elem.get("_layout_item")
            placeholder = elem.get("placeholder", "")
            if item and placeholder and isinstance(item, QgsLayoutItemLabel):
                originals[id(item)] = item.text()
                item.setText(placeholder)
        return originals

    @staticmethod
    def _restore_label_texts(layout, originals):
        """Stellt die Original-Texte nach dem Export wieder her."""
        for item in layout.items():
            if isinstance(item, QgsLayoutItemLabel):
                orig = originals.get(id(item))
                if orig is not None:
                    item.setText(orig)

    # ================================================================== #
    #  Grafische Elemente verstecken / wiederherstellen                    #
    # ================================================================== #
    @staticmethod
    def _hide_graphic_elements(elements):
        """Versteckt grafische Elemente (Nordpfeil, Massstabsbalken etc.)
        vor dem SVG-Export und gibt Restore-Info zurück.

        Returns: list of (item, was_visible) tuples
        """
        hidden = []
        for elem in elements:
            if not elem.get("_is_graphic"):
                continue
            item = elem.get("_layout_item")
            if item is None:
                continue
            was_visible = item.isVisible() if hasattr(item, 'isVisible') else True
            if hasattr(item, 'setVisibility'):
                item.setVisibility(False)
            hidden.append((item, was_visible, elem))
            print(f"[LayoutExporter] Versteckt: {elem.get('id', '?')} "
                  f"({elem.get('type', '?')})")
        return hidden

    @staticmethod
    def _restore_graphic_elements(hidden):
        """Stellt Sichtbarkeit der versteckten Elemente wieder her."""
        for item, was_visible, elem in hidden:
            if hasattr(item, 'setVisibility'):
                item.setVisibility(was_visible)

    def _inject_svg_bboxes(self, svg_path, hidden_elements, layout_info):
        """Fügt rote Bbox-Rechtecke für versteckte grafische Elemente
        in das SVG ein.

        Die Bboxen haben IDs (z.B. NORTH_ARROW, SCALE_BAR, SCALE_LABEL)
        und werden vom OL-Printer erkannt und durch dynamische Elemente
        ersetzt.
        """
        try:
            with open(svg_path, 'r', encoding='utf-8') as f:
                svg_text = f.read()
        except (IOError, UnicodeDecodeError) as e:
            print(f"[LayoutExporter] SVG lesen fehlgeschlagen: {e}")
            return

        # ViewBox auslesen für mm → SVG-Einheiten
        import xml.etree.ElementTree as ET
        try:
            root = ET.fromstring(svg_text)
        except ET.ParseError as e:
            print(f"[LayoutExporter] SVG parsen fehlgeschlagen: {e}")
            return

        vb = root.get('viewBox', '')
        vb_parts = vb.split()
        if len(vb_parts) != 4:
            print("[LayoutExporter] Kein gültiger viewBox im SVG")
            return

        vb_w = float(vb_parts[2])
        vb_h = float(vb_parts[3])
        paper_w = layout_info.get("width_mm", 297.0)
        paper_h = layout_info.get("height_mm", 420.0)
        sx = vb_w / paper_w  # SVG-Units pro mm
        sy = vb_h / paper_h

        # Bbox-Rects als SVG-Elemente erzeugen
        ns = root.tag.split('}')[0] + '}' if '}' in root.tag else ''
        bbox_elements = []
        for _item, _was_visible, elem in hidden_elements:
            x_svg = elem["x_mm"] * sx
            y_svg = elem["y_mm"] * sy
            w_svg = elem["width_mm"] * sx
            h_svg = elem["height_mm"] * sy
            elem_id = elem.get("id", "UNKNOWN")

            rect_xml = (
                f'<rect id="{elem_id}" '
                f'x="{x_svg:.2f}" y="{y_svg:.2f}" '
                f'width="{w_svg:.2f}" height="{h_svg:.2f}" '
                f'fill="none" stroke="#FF0000" stroke-width="2" '
                f'data-dynamic-type="{elem.get("type", "")}" />'
            )
            bbox_elements.append(rect_xml)
            print(f"[LayoutExporter] SVG-Bbox: id=\"{elem_id}\" "
                  f"@ ({x_svg:.1f}, {y_svg:.1f}) "
                  f"{w_svg:.1f}×{h_svg:.1f}")

        if not bbox_elements:
            return

        # Rects vor dem schliessenden </svg>-Tag einfügen
        close_tag = '</svg>'
        bbox_block = '\n  <!-- Dynamic element bboxes (OL-Printer) -->\n'
        bbox_block += '\n'.join(f'  {r}' for r in bbox_elements)
        bbox_block += '\n'

        svg_text = svg_text.replace(close_tag, bbox_block + close_tag)

        try:
            with open(svg_path, 'w', encoding='utf-8') as f:
                f.write(svg_text)
            print(f"[LayoutExporter] {len(bbox_elements)} Bbox-Rects "
                  f"in SVG eingefügt")
        except IOError as e:
            print(f"[LayoutExporter] SVG schreiben fehlgeschlagen: {e}")

    # ================================================================== #
    #  SVG-Nachbearbeitung                                                 #
    # ================================================================== #
    def _postprocess_svg(self, svg_path, layout_info):
        """SVG nachbearbeiten: IDs zu Platzhalter-Elementen hinzufügen.

        QGIS exportiert SVG über Qt's QSvgGenerator, der die Layout-Item-IDs
        NICHT als SVG-id-Attribute übernimmt. Deshalb suchen wir nach den
        {{PLACEHOLDER}}-Texten und fügen die IDs manuell hinzu.
        """
        try:
            with open(svg_path, 'r', encoding='utf-8') as f:
                svg_text = f.read()
        except (IOError, UnicodeDecodeError) as e:
            print(f"[LayoutExporter] SVG lesen fehlgeschlagen: {e}")
            return

        modified = False

        for elem_id, info in PLACEHOLDER_MAP.items():
            placeholder = info.get("placeholder", "")
            if not placeholder or placeholder not in svg_text:
                continue

            # Finde den {{PLACEHOLDER}} im SVG und das umgebende <text>-Tag
            idx = svg_text.find(placeholder)
            if idx < 0:
                continue

            # Suche rückwärts nach dem nächsten <text-Tag
            search_start = svg_text.rfind('<text', 0, idx)
            if search_start < 0:
                continue

            # Tag-Ende finden
            tag_end = svg_text.find('>', search_start)
            if tag_end < 0:
                continue

            tag_content = svg_text[search_start:tag_end]

            # Prüfe ob bereits eine id vorhanden ist
            if ' id="' in tag_content or " id='" in tag_content:
                continue

            # id-Attribut zum <text>-Tag hinzufügen
            new_tag = tag_content.replace('<text', f'<text id="{elem_id}"', 1)
            svg_text = svg_text[:search_start] + new_tag + svg_text[tag_end:]
            modified = True
            print(f"[LayoutExporter] SVG: id=\"{elem_id}\" hinzugefügt")

        if modified:
            try:
                with open(svg_path, 'w', encoding='utf-8') as f:
                    f.write(svg_text)
                print(f"[LayoutExporter] SVG nachbearbeitet: {svg_path}")
            except IOError as e:
                print(f"[LayoutExporter] SVG schreiben fehlgeschlagen: {e}")

    # ================================================================== #
    #  Export: ein Zielordner  →  <ziel>/                                #
    # ================================================================== #
    def _export_to_directory(self, layout, base_filename, layout_info,
                             target_dir):
        """Exportiert Layout + manifest.json direkt in target_dir/.

        Ablauf für SVG:
          1. Grafische Elemente (Nordpfeil, Massstabsbalken) verstecken
          2. Labels temporär auf {{PLACEHOLDER}} setzen
          3. SVG mit textRenderFormat=AlwaysText exportieren
          4. SVG nachbearbeiten (IDs hinzufügen)
          5. Rote Bbox-Rects für versteckte Elemente einfügen
          6. Originale Label-Texte + Sichtbarkeit wiederherstellen
        """

        svg_dir = target_dir
        os.makedirs(svg_dir, exist_ok=True)

        exported = []
        exporter = QgsLayoutExporter(layout)

        # Grafische Elemente verstecken (Nordpfeil, Massstabsbalken etc.)
        elements = layout_info.get("elements", [])
        hidden_graphics = self._hide_graphic_elements(elements)

        # Labels temporär auf Platzhalter setzen (nur Nicht-Grafische)
        original_texts = self._set_placeholder_texts(layout, elements)

        try:
            for fmt in self.export_formats:
                filename = f"{base_filename}.{fmt}"
                filepath = os.path.join(svg_dir, filename)

                if os.path.exists(filepath) and not self.chk_overwrite.isChecked():
                    continue

                if fmt == "svg":
                    s = QgsLayoutExporter.SvgExportSettings()
                    s.dpi = 300
                    s.exportAsLayers = False
                    # ── Text als Text exportieren (NICHT als Pfade!) ──
                    # Damit bleiben <text>/<tspan>-Elemente im SVG erhalten
                    # und können vom WebGIS dynamisch ersetzt werden.
                    try:
                        s.textRenderFormat = QgsRenderContext.TextFormatAlwaysText
                    except AttributeError:
                        try:
                            from qgis.core import Qgis
                            s.textRenderFormat = Qgis.TextRenderFormat.AlwaysText
                        except (ImportError, AttributeError):
                            print("[LayoutExporter] WARNUNG: textRenderFormat "
                                  "nicht verfügbar (QGIS < 3.12)")
                    result = exporter.exportToSvg(filepath, s)
                    if result == QgsLayoutExporter.Success:
                        # SVG nachbearbeiten: IDs hinzufügen
                        self._postprocess_svg(filepath, layout_info)
                        # Rote Bbox-Rects für versteckte Elemente einfügen
                        if hidden_graphics:
                            self._inject_svg_bboxes(
                                filepath, hidden_graphics, layout_info
                            )
                        exported.append(filepath)
                    else:
                        raise RuntimeError(
                            f"{filename} fehlgeschlagen (Code {result})"
                        )
                else:
                    s = QgsLayoutExporter.PdfExportSettings()
                    s.dpi = 300
                    result = exporter.exportToPdf(filepath, s)
                    if result == QgsLayoutExporter.Success:
                        exported.append(filepath)
                    else:
                        raise RuntimeError(
                            f"{filename} fehlgeschlagen (Code {result})"
                        )
        finally:
            # Labels immer wiederherstellen (auch bei Fehler)
            self._restore_label_texts(layout, original_texts)
            # Grafische Elemente wieder einblenden
            self._restore_graphic_elements(hidden_graphics)

        if self.chk_manifest.isChecked():
            self._write_manifest(target_dir, base_filename, layout_info)

        return exported

    # ================================================================== #
    #  manifest.json                                                       #
    # ================================================================== #
    def _write_manifest(self, target_dir, base_filename, layout_info):
        """Erzeugt / aktualisiert manifest.json im Zielordner.

        Version 1.3: Enthält neu ein «elements»-Array pro Template mit
        vollständigen Metadaten zu allen dynamischen Elementen (Position,
        Grösse, Font, Variable, Platzhalter).

        {
          "version": "1.3",
          "generated": "2026-02-11T…",
          "templates": [{
            "name": "layout_a4_portrait",
            "title": "A4 Hoch",
            "paper": "A4", "orientation": "portrait",
            "width_mm": 210, "height_mm": 297,
            "mapFrame": { "x_mm": 11.0, "y_mm": 36.0, … },
            "elements": [
              { "id": "TITLE_TEXT", "type": "text",
                "variable": "title", "placeholder": "{{TITLE}}",
                "x_mm": 12.0, "y_mm": 12.0,
                "width_mm": 275.0, "height_mm": 19.0,
                "fontSize_pt": 14, "fontFamily": "Arial",
                "fontWeight": "bold", "hAlign": "center" },
              …
            ],
            "files": { "svg": "layout_a4_portrait.svg" }
          }]
        }
        """
        manifest_path = os.path.join(target_dir, "manifest.json")

        manifest = {"version": "1.3", "generated": "", "templates": []}
        if os.path.exists(manifest_path):
            try:
                with open(manifest_path, "r", encoding="utf-8") as f:
                    manifest = json.load(f)
            except (json.JSONDecodeError, IOError):
                pass

        manifest["generated"] = datetime.now().isoformat(timespec="seconds")

        # Bestehendes Template aktualisieren oder neu einfügen
        existing_idx = None
        for i, t in enumerate(manifest.get("templates", [])):
            if t.get("name") == base_filename:
                existing_idx = i
                break

        svg_dir = target_dir
        files = {}
        for fmt in ["svg", "pdf"]:
            fpath = os.path.join(svg_dir, f"{base_filename}.{fmt}")
            if os.path.exists(fpath):
                files[fmt] = f"{base_filename}.{fmt}"

        entry = {
            "name": base_filename,
            "title": layout_info.get("title", base_filename),
            "paper": layout_info.get("paper", ""),
            "orientation": layout_info.get("orientation", ""),
            "width_mm": layout_info.get("width_mm", 0),
            "height_mm": layout_info.get("height_mm", 0),
            "source": layout_info.get("source", ""),
            "files": files,
        }
        if "mapFrame" in layout_info:
            entry["mapFrame"] = layout_info["mapFrame"]

        # ── Elements-Array: vollständige Metadaten ──
        # Interne Referenzen (_layout_item, originalText) entfernen
        raw_elements = layout_info.get("elements", [])
        clean_elements = []
        for elem in raw_elements:
            clean = {k: v for k, v in elem.items()
                     if not k.startswith("_") and k != "originalText"}
            clean_elements.append(clean)
        if clean_elements:
            entry["elements"] = clean_elements

        if existing_idx is not None:
            manifest["templates"][existing_idx] = entry
        else:
            manifest["templates"].append(entry)

        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2, ensure_ascii=False)

    # ================================================================== #
    #  Platzhalter-Elemente (neues Template)                              #
    # ================================================================== #

    @staticmethod
    def _make_rect_shape(layout, x, y, w, h, border_color="#000000",
                         fill_color=None, border_width=0.4):
        shape = QgsLayoutItemShape(layout)
        shape.setShapeType(QgsLayoutItemShape.Rectangle)
        shape.attemptMove(
            QgsLayoutPoint(x, y, QgsUnitTypes.LayoutMillimeters)
        )
        shape.attemptResize(
            QgsLayoutSize(w, h, QgsUnitTypes.LayoutMillimeters)
        )
        props = {
            "color": fill_color if fill_color else "255,255,255,0",
            "style": "solid" if fill_color else "no",
            "outline_color": border_color,
            "outline_width": str(border_width),
            "outline_style": "solid",
        }
        shape.setSymbol(QgsFillSymbol.createSimple(props))
        layout.addLayoutItem(shape)
        return shape

    @staticmethod
    def _make_label(layout, x, y, w, h, text,
                    font_size=10, bold=False, alignment=Qt.AlignCenter,
                    bg_color=None, border=True):
        label = QgsLayoutItemLabel(layout)
        label.setText(text)
        label.attemptMove(
            QgsLayoutPoint(x, y, QgsUnitTypes.LayoutMillimeters)
        )
        label.attemptResize(
            QgsLayoutSize(w, h, QgsUnitTypes.LayoutMillimeters)
        )
        font = QFont("Arial", font_size)
        font.setBold(bold)
        label.setFont(font)
        label.setHAlign(alignment)
        label.setVAlign(Qt.AlignVCenter)
        if bg_color:
            label.setBackgroundEnabled(True)
            label.setBackgroundColor(QColor(bg_color))
        else:
            label.setBackgroundEnabled(False)
        label.setFrameEnabled(border)
        if border:
            label.setFrameStrokeColor(QColor("#333333"))
            label.setFrameStrokeWidth(
                QgsLayoutSize(0.3, QgsUnitTypes.LayoutMillimeters)
            )
        layout.addLayoutItem(label)
        return label

    def _add_page_border(self, layout, pw, ph):
        self._make_rect_shape(
            layout, MARGIN, MARGIN,
            pw - 2 * MARGIN, ph - 2 * MARGIN,
            border_color="#000000", border_width=0.6,
        )

    def _add_map_placeholder(self, layout, pw, ph):
        top, right, bottom = 25.0, 55.0, 20.0
        mx, my = MARGIN + 1, MARGIN + top + 1
        mw = pw - 2 * MARGIN - right - 2
        mh = ph - 2 * MARGIN - top - bottom - 2
        props = {
            "color": "255,255,255,0", "style": "no",
            "outline_color": "#2196F3", "outline_width": "0.5",
            "outline_style": "dash",
        }
        shape = QgsLayoutItemShape(layout)
        shape.setShapeType(QgsLayoutItemShape.Rectangle)
        shape.setId("MAP_AREA")
        shape.attemptMove(
            QgsLayoutPoint(mx, my, QgsUnitTypes.LayoutMillimeters)
        )
        shape.attemptResize(
            QgsLayoutSize(mw, mh, QgsUnitTypes.LayoutMillimeters)
        )
        shape.setSymbol(QgsFillSymbol.createSimple(props))
        layout.addLayoutItem(shape)
        lbl = self._make_label(
            layout, mx + mw / 2 - 30, my + mh / 2 - 6,
            60, 12, "[ MAP AREA ]", 12, True, border=False,
        )
        lbl.setId("MAP_AREA_LABEL")

    def _add_title_block(self, layout, pw, ph):
        """Titel-Bereich oben (dynamisch aus WebGIS)."""
        x, y = MARGIN + 1, MARGIN + 1
        w, h = pw - 2 * MARGIN - 2, 23.0
        rect = self._make_rect_shape(
            layout, x, y, w, h, "#333333", "#F5F5F5", 0.4,
        )
        rect.setId("TITLE_BLOCK")
        # Label für dynamischen Titel aus WebGIS
        lbl = self._make_label(
            layout, x + 2, y + 2, w - 4, h - 4,
            "{{TITLE}}",
            14, True, Qt.AlignCenter, border=False,
        )
        lbl.setId("TITLE_TEXT")  # ← ID für WebGIS-Ersetzung

    def _add_legend_placeholder(self, layout, pw, ph):
        rb, tb = 55.0, 25.0
        x = pw - MARGIN - rb
        y = MARGIN + tb + 1
        w = rb - 1
        hl = (ph - 2 * MARGIN - tb - 20.0 - 2) * 0.55
        rect = self._make_rect_shape(
            layout, x, y, w, hl, "#666666", "#FAFAFA", 0.3,
        )
        rect.setId("LEGEND")
        lbl = self._make_label(
            layout, x + 2, y + 2, w - 4, 10,
            "[ LEGEND ]", 9, True, Qt.AlignCenter, border=False,
        )
        lbl.setId("LEGEND_LABEL")

    def _add_logo_placeholder(self, layout, pw, ph):
        rb, tb = 55.0, 25.0
        hl = (ph - 2 * MARGIN - tb - 20.0 - 2) * 0.55
        x = pw - MARGIN - rb
        y = MARGIN + tb + 1 + hl + 3
        w, h = rb - 1, 30.0
        rect = self._make_rect_shape(
            layout, x, y, w, h, "#999999", "#EEEEEE", 0.3,
        )
        rect.setId("LOGO")
        lbl = self._make_label(
            layout, x + 2, y + 2, w - 4, h - 4,
            "[ COMPANY LOGO ]", 8, False, Qt.AlignCenter, border=False,
        )
        lbl.setId("LOGO_LABEL")

    def _add_footer_elements(self, layout, pw, ph):
        """Footer-Zeile: Massstab, Koordinaten, Datum (dynamisch aus WebGIS)."""
        rb, bb = 55.0, 20.0
        x = MARGIN + 1
        y = ph - MARGIN - bb
        w = pw - 2 * MARGIN - rb - 2
        h = bb - 1

        # Hintergrund-Box für Footer
        rect = self._make_rect_shape(
            layout, x, y, w, h, "#666666", "#FAFAFA", 0.3,
        )
        rect.setId("FOOTER_BOX")

        # Massstab-Text (links)
        lbl_scale = self._make_label(
            layout, x + 2, y + 2, (w - 6) / 3, h - 4,
            "{{SCALE}}",
            9, False, Qt.AlignLeft, border=False,
        )
        lbl_scale.setId("SCALE_TEXT")  # ← ID für WebGIS

        # Koordinaten (Mitte)
        lbl_coords = self._make_label(
            layout, x + 2 + (w - 6) / 3, y + 2, (w - 6) / 3, h - 4,
            "{{COORDINATES}}",
            9, False, Qt.AlignCenter, border=False,
        )
        lbl_coords.setId("COORDINATES_TEXT")  # ← ID für WebGIS

        # Datum (rechts)
        lbl_date = self._make_label(
            layout, x + 2 + 2 * (w - 6) / 3, y + 2, (w - 6) / 3, h - 4,
            "{{DATE}}",
            9, False, Qt.AlignRight, border=False,
        )
        lbl_date.setId("DATE_TEXT")  # ← ID für WebGIS

    def _add_north_arrow(self, layout, pw, ph):
        """Nordpfeil (dynamisch rotiert aus WebGIS)."""
        rb, tb = 55.0, 25.0
        # Position: rechts oben, unter der Legende
        legend_h = (ph - 2 * MARGIN - tb - 20.0 - 2) * 0.55
        x = pw - MARGIN - rb + 5
        y = MARGIN + tb + legend_h + 40
        w, h = 30.0, 30.0

        # Platzhalter-Box für Nordpfeil
        rect = self._make_rect_shape(
            layout, x, y, w, h, "#999999", "#EEEEEE", 0.3,
        )
        rect.setId("NORTH_ARROW_BOX")

        # Label als Nordpfeil-Platzhalter
        # (WebGIS ersetzt/rotiert dieses Element)
        lbl = self._make_label(
            layout, x + 2, y + 2, w - 4, h - 4,
            "{{NORTH_ARROW}}",
            16, True, Qt.AlignCenter, border=False,
        )
        lbl.setId("NORTH_ARROW")  # ← ID für WebGIS (Rotation!)

    def _add_scale_bar(self, layout, pw, ph):
        """Massstabsbalken-Platzhalter (dynamisch aus WebGIS).

        Positioniert unterhalb der Karte, links unten.
        Das WebGIS zeichnet den grafischen Massstabsbalken
        zur Laufzeit basierend auf dem gewählten Massstab.
        """
        rb, bb = 55.0, 20.0
        # Unterhalb der Karte, links
        x = MARGIN + 1
        y = ph - MARGIN - bb - 18  # Über dem Footer, unter der Karte
        w, h = 80.0, 12.0

        # Platzhalter-Box
        rect = self._make_rect_shape(
            layout, x, y, w, h, "#999999", "#FFFFFF", 0.3,
        )
        rect.setId("SCALE_BAR_BOX")

        # Label für den Massstabsbalken
        lbl = self._make_label(
            layout, x + 2, y + 1, w - 4, h - 2,
            "{{SCALE_BAR}}",
            8, False, Qt.AlignLeft, border=False,
        )
        lbl.setId("SCALE_BAR")  # ← ID für WebGIS
