#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_css.py
Buendelt die TNET-CSS-Dateien in EINE Datei (tnet.bundle.css) in
Kaskaden-Reihenfolge. Reduziert die Anzahl HTTP-Requests (17 -> 1).

Die Einzeldateien bleiben die Quelle der Wahrheit (wartbar); das Bundle
ist ein Build-Artefakt, das bei jedem DEV-Deploy neu erzeugt wird.

Aufruf:
    python build_css.py --css-root maps-dev/tnet/css --out maps-dev/tnet/css/tnet.bundle.css

@version    1.0
@date       2026-07-06
@copyright  Trigonet AG
@author     Marco Dellenbach
"""
import os
import sys
import io
import argparse

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# ===== KASKADEN-REIHENFOLGE =====
# Muss der Ladereihenfolge in index_de.htm entsprechen (Cascade!).
# Einzeldateien liegen alle unter tnet/css/ → relative url() bleiben gueltig,
# da das Bundle im selben Verzeichnis erzeugt wird.
CSS_ORDER = [
    "tnet_toc.css",
    "tnet-components.css",
    "tnet-splitscreen.css",
    "tnet-3d-landscape.css",
    "tnet-mapcontrols.css",
    "tnet-basemap-selector.css",
    "tnet-wms-panel.css",
    "tnet-info-panel.css",
    "tnet-search.css",
    "tnet-legend.css",
    "tnet-lm-legacy.css",
    "tnet-sidepanel-legacy.css",
    "gis-daten-splash.css",
    "tnet-lm.css",
    "tnet-sidepanel.css",
    "tnet-print.css",
]


def build_bundle(css_root, out_path):
    css_root = os.path.normpath(css_root)
    parts = []
    missing = []
    imbalanced = []
    total_in = 0

    for name in CSS_ORDER:
        path = os.path.join(css_root, name)
        if not os.path.isfile(path):
            missing.append(name)
            continue
        # utf-8-sig entfernt ein evtl. vorhandenes BOM (U+FEFF). Ein BOM ist am
        # Dateianfang harmlos, MITTEN im konkatenierten Bundle aber ein ungueltiges
        # Zeichen, das die naechste CSS-Regel bricht (z.B. #dt-search-bar).
        with open(path, "r", encoding="utf-8-sig") as f:
            content = f.read()
        # Sicherheitshalber auch inline-BOMs entfernen
        content = content.replace("\ufeff", "")
        # Klammer-Validierung: unbalancierte {} brechen beim Konkatenieren die
        # Kaskade (Regeln werden verschluckt). Einzeln tolerieren Browser das,
        # gebuendelt nicht. Darum hier hart pruefen.
        clean = _strip_css_comments(content)
        brace_balance = clean.count("{") - clean.count("}")
        if brace_balance != 0:
            imbalanced.append((name, brace_balance))
        total_in += len(content.encode("utf-8"))
        parts.append("/* ===== " + name + " ===== */\n" + content.rstrip() + "\n")

    if missing:
        print("[WARN] Nicht gefunden (uebersprungen): " + ", ".join(missing))

    if imbalanced:
        print("[ERR] Unbalancierte geschweifte Klammern (bricht Bundle-Kaskade):")
        for name, bal in imbalanced:
            print(f"       {name}: Balance {bal:+d} ({{ vs }})")
        raise RuntimeError("CSS-Bundle abgebrochen: Klammer-Ungleichgewicht in Quelldatei(en)")

    header = (
        "/*\n"
        " * tnet.bundle.css - AUTOGENERIERT durch build_css.py\n"
        " * NICHT direkt editieren! Quelle sind die Einzeldateien unter tnet/css/.\n"
        " * Reihenfolge = Kaskade wie in index_de.htm.\n"
        " */\n"
    )
    bundle = header + "\n".join(parts)

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(bundle)

    out_size = len(bundle.encode("utf-8"))
    print("[OK] tnet.bundle.css erzeugt: {} Dateien, {:,} -> {:,} bytes".format(
        len(parts), total_in, out_size))
    return out_path


def _strip_css_comments(s):
    """Entfernt /* */ Kommentare, damit Klammern in Kommentaren nicht mitzaehlen."""
    out = []
    i = 0
    n = len(s)
    while i < n:
        if s[i:i+2] == "/*":
            j = s.find("*/", i + 2)
            if j == -1:
                break
            i = j + 2
        else:
            out.append(s[i])
            i += 1
    return "".join(out)


def main():
    parser = argparse.ArgumentParser(description="Buendelt TNET-CSS in tnet.bundle.css")
    parser.add_argument("--css-root", required=True, help="Verzeichnis mit den tnet-CSS-Dateien")
    parser.add_argument("--out", required=True, help="Zielpfad fuer das Bundle")
    args = parser.parse_args()

    if not os.path.isdir(args.css_root):
        print(f"[ERR] CSS-Verzeichnis nicht gefunden: {args.css_root}")
        sys.exit(1)

    build_bundle(args.css_root, args.out)


if __name__ == "__main__":
    main()
