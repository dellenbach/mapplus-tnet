#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
patch_grayscale_fix.py
Fix: Grayscale-Filter greift nicht auf Overlay-Themen über.

Root-Cause:
  toggleBaseLayerColor setzt CSS-Klasse .grayscale auf .ol-basemap-Divs.
  CSS filter auf einem Div betrifft ALLE Child-Elemente → Overlay-Themen
  (Höhenkurven, Gemeindegrenzen, …) werden ebenfalls grau.

Fix:
  1. Nach origColor-Aufruf .grayscale sofort von allen .ol-basemap-Divs entfernen.
  2. syncGrayscale filtert stattdessen nur die <canvas>/<img>-Elemente
     innerhalb von .ol-basemap → isoliert, kein Einfluss auf Geschwister-Layer.
"""

fpath = r"c:\_Daten\mapplus-exp\maps-dev\tnet\js-dev\tnet-basemap.js"

# Text-mode: Python normalisiert CRLF -> LF beim Lesen;
# wir schreiben am Ende mit newline_crlf=True zurück.
with open(fpath, "r", encoding="utf-8") as fh:
    c = fh.read()

# ── 1. Hook: nach origColor-Aufruf .grayscale von Divs entfernen ──────────────
OLD_HOOK = (
    "                    try {\n"
    "                        origColor.call(njs.AppManager, mapId, toolId, btnEl);\n"
    "                    } catch (e) {\n"
    "                        TnetLog.warn(LOG_PREFIX, 'toggleBaseLayerColor Fehler (kein aktiver Basemap-Layer?):', e.message);\n"
    "                    }\n"
    "                    if (mapId === 'main') {"
)

NEW_HOOK = (
    "                    try {\n"
    "                        origColor.call(njs.AppManager, mapId, toolId, btnEl);\n"
    "                    } catch (e) {\n"
    "                        TnetLog.warn(LOG_PREFIX, 'toggleBaseLayerColor Fehler (kein aktiver Basemap-Layer?):', e.message);\n"
    "                    }\n"
    "                    // Undo: .grayscale auf .ol-basemap-Divs betrifft alle Child-Layer\n"
    "                    // (Overlay-Themen werden sonst ebenfalls grau). Stattdessen\n"
    "                    // werden nur canvas/img-Elemente in .ol-basemap gefiltert.\n"
    "                    var _bDivs = document.querySelectorAll('.ol-basemap');\n"
    "                    for (var _bi = 0; _bi < _bDivs.length; _bi++) { _bDivs[_bi].classList.remove('grayscale'); }\n"
    "                    if (mapId === 'main') {"
)

if OLD_HOOK in c:
    c = c.replace(OLD_HOOK, NEW_HOOK, 1)
    print("[tnet-basemap.js] Hook-Fix: OK")
else:
    print("[tnet-basemap.js] Hook-Fix: NICHT gefunden – bereits gepatcht oder Inhalt geändert")

# ── 2. syncGrayscale: Canvas/Img statt Div filtern ───────────────────────────
OLD_SYNC = (
    "        syncGrayscale: function(isGrey) {\n"
    "            this._isGrayscale = isGrey;\n"
    "            if (this._timeOverlayLayer) {\n"
    "                this._applyGrayscaleCSS(this._timeOverlayLayer, this._isGrayscale);\n"
    "            }\n"
    "        },"
)

NEW_SYNC = (
    "        syncGrayscale: function(isGrey) {\n"
    "            this._isGrayscale = isGrey;\n"
    "            var _filterVal = isGrey ? 'grayscale(100%)' : '';\n"
    "            // Nur <canvas> und <img> innerhalb von .ol-basemap filtern.\n"
    "            // CSS filter auf dem DIV würde auch Overlay-Themen (Geschwister-Layer)\n"
    "            // grau machen – canvas/img-Filter sind isoliert.\n"
    "            var _bMedia = document.querySelectorAll('.ol-basemap canvas, .ol-basemap img');\n"
    "            for (var _mi = 0; _mi < _bMedia.length; _mi++) { _bMedia[_mi].style.filter = _filterVal; }\n"
    "            if (this._timeOverlayLayer) {\n"
    "                this._applyGrayscaleCSS(this._timeOverlayLayer, this._isGrayscale);\n"
    "            }\n"
    "        },"
)

if OLD_SYNC in c:
    c = c.replace(OLD_SYNC, NEW_SYNC, 1)
    print("[tnet-basemap.js] syncGrayscale-Fix: OK")
else:
    print("[tnet-basemap.js] syncGrayscale-Fix: NICHT gefunden – bereits gepatcht oder Inhalt geändert")

# Zurückschreiben mit CRLF (Windows-Original)
c_crlf = c.replace("\n", "\r\n")
with open(fpath, "wb") as fh:
    fh.write(c_crlf.encode("utf-8"))

print("[tnet-basemap.js] gespeichert.")
