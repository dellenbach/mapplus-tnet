# -*- coding: utf-8 -*-
"""
Layout Template Exporter – QGIS Plugin
Initialisierungsmodul
"""


# noinspection PyPep8Naming
def classFactory(iface):  # noqa: N802
    """Wird von QGIS beim Laden des Plugins aufgerufen.

    :param iface: QgisInterface – Referenz auf die QGIS-Schnittstelle.
    :returns: LayoutTemplateExporter – Plugin-Instanz.
    """
    from .plugin import LayoutTemplateExporter
    return LayoutTemplateExporter(iface)
