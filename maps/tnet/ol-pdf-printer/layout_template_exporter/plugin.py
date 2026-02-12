# -*- coding: utf-8 -*-
"""
Layout Template Exporter – Haupt-Plugin-Klasse

Registriert Menüeintrag + Toolbar-Button und koordiniert den Export-Workflow.

@version    1.4
@date       2026-02-13
@copyright  Trigonet AG
@author     Marco Dellenbach
"""

import os

from qgis.PyQt.QtCore import QCoreApplication, QTranslator
from qgis.PyQt.QtGui import QIcon
from qgis.PyQt.QtWidgets import QAction

# Ressourcen importieren (kompiliertes .qrc)
try:
    from . import resources  # noqa: F401
except ImportError:
    pass

from .layout_export_dialog import LayoutExportDialog


class LayoutTemplateExporter:
    """QGIS-Plugin: Layout-Vorlagen exportieren (A4–A0)."""

    def __init__(self, iface):
        """Konstruktor.

        :param iface: QgisInterface – Referenz auf die laufende QGIS-Instanz.
        """
        self.iface = iface
        self.plugin_dir = os.path.dirname(__file__)
        self.actions = []
        self.menu = self.tr("&Layout Template Exporter")
        self.toolbar = self.iface.addToolBar(self.tr("Layout Template Exporter"))
        self.toolbar.setObjectName("LayoutTemplateExporter")

    # ------------------------------------------------------------------ #
    #  Internationalisierung                                              #
    # ------------------------------------------------------------------ #
    @staticmethod
    def tr(message):
        """Kurzform für Übersetzung."""
        return QCoreApplication.translate("LayoutTemplateExporter", message)

    # ------------------------------------------------------------------ #
    #  Plugin-Registrierung                                               #
    # ------------------------------------------------------------------ #
    def initGui(self):
        """Menüpunkt und Toolbar-Button erzeugen."""
        icon_path = os.path.join(self.plugin_dir, "icon.png")
        action = QAction(
            QIcon(icon_path),
            self.tr("Layout-Vorlagen exportieren (A4–A0)"),
            self.iface.mainWindow(),
        )
        action.triggered.connect(self.run)
        action.setStatusTip(
            self.tr("Exportiert leere Layout-Vorlagen als SVG oder PDF")
        )

        # In Menü und Toolbar einhängen
        self.iface.addPluginToMenu(self.menu, action)
        self.toolbar.addAction(action)
        self.actions.append(action)

    def unload(self):
        """Plugin sauber entfernen."""
        for action in self.actions:
            self.iface.removePluginMenu(self.menu, action)
            self.iface.removeToolBarIcon(action)
        del self.toolbar

    # ------------------------------------------------------------------ #
    #  Export-Workflow                                                     #
    # ------------------------------------------------------------------ #
    def run(self):
        """Dialog öffnen und bei OK den Export starten."""
        dlg = LayoutExportDialog(self.iface.mainWindow())
        if dlg.exec_():
            dlg.export_layout(self.iface)
