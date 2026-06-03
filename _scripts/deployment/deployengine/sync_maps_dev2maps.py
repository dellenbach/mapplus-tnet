#!/usr/bin/env python3
"""
sync_maps_dev2maps.py
Lokaler Datei-Abgleich von maps-dev nach maps.
Kopiert geaenderte/neue Dateien (JS, PHP, CSS, HTML, tnet/config/).
Ueberspringt tnet/js/, tnet/js-stage/, tnet/js-src/ -- diese werden
vom Promotion-Schritt (promote_dev_to_prod.py) separat verwaltet.

Aufruf:
    python sync_maps_dev2maps.py              # Live-Sync
    python sync_maps_dev2maps.py --dry-run    # Vorschau ohne Aenderung

@version    1.0
@date       2026-06-02
@copyright  Trigonet AG
@author     Marco Dellenbach
"""
import argparse
import hashlib
import os
import shutil
import sys

SCRIPT_DIR = os.path.dirname(__file__)
sys.path.insert(0, SCRIPT_DIR)

from deploy_env import resolve_deploy_config

# ===== FILTER-KONFIGURATION =====

# Erweiterungen, die immer synchronisiert werden
SYNC_EXTENSIONS = {".js", ".php", ".css", ".html", ".htm", ".json", ".json5"}

SKIP_DIRS = set()  # Keine Verzeichnisse ausschliessen


# ===== HILFSFUNKTIONEN =====

def hash_file(path):
    """SHA-256 Hash einer Datei."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def is_skip_dir(rel_dir):
    """Prueft ob ein Verzeichnis (relativ zu maps-dev) uebersprungen werden soll."""
    rel = rel_dir.replace("\\", "/").rstrip("/")
    return any(rel == s or rel.startswith(s + "/") for s in SKIP_DIRS)


def should_sync(rel_path):
    """Prueft ob eine Datei synchronisiert werden soll."""
    rel = rel_path.replace("\\", "/").lower()
    ext = os.path.splitext(rel)[1].lower()
    return ext in SYNC_EXTENSIONS


def collect_candidates(src_dir, dst_dir):
    """
    Sammelt alle Dateien, die in maps-dev geaendert/neu sind gegenueber maps.
    Gibt Liste von (src_abs, dst_abs, rel_path) zurueck.

    Hinweis: Es wird nur kopiert, nie geloescht. Dateien, die in maps existieren
    aber in maps-dev fehlen, bleiben unveraendert (kein Mirror-Modus).
    """
    candidates = []

    for dirpath, dirnames, filenames in os.walk(src_dir):
        rel_dir = os.path.relpath(dirpath, src_dir).replace("\\", "/")
        if rel_dir == ".":
            rel_dir = ""

        # Ganze Unterverzeichnisse ausschliessen (in-place filtern)
        if rel_dir and is_skip_dir(rel_dir):
            dirnames.clear()
            continue

        dirnames[:] = [
            d for d in dirnames
            if not is_skip_dir((rel_dir + "/" + d).lstrip("/"))
        ]

        for fname in filenames:
            rel_file = (rel_dir + "/" + fname).lstrip("/")

            if not should_sync(rel_file):
                continue

            src_abs = os.path.join(src_dir, rel_file.replace("/", os.sep))
            dst_abs = os.path.join(dst_dir, rel_file.replace("/", os.sep))

            # Kopieren wenn Zieldatei fehlt oder sich Hash unterscheidet
            if not os.path.exists(dst_abs) or hash_file(src_abs) != hash_file(dst_abs):
                candidates.append((src_abs, dst_abs, rel_file))

    return candidates


# ===== MAIN =====

def main():
    parser = argparse.ArgumentParser(
        description="Lokaler Sync: maps-dev -> maps (JS, PHP, CSS, HTML, tnet/config/)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Nur anzeigen, nichts kopieren",
    )
    args = parser.parse_args()

    dev_config = resolve_deploy_config("dev")
    prod_config = resolve_deploy_config("prod")

    src_dir = os.path.normpath(dev_config["local_base"])
    dst_dir = os.path.normpath(prod_config["local_base"])

    mode_label = "DRY-RUN" if args.dry_run else "LIVE"
    print(f"Sync maps-dev -> maps [{mode_label}]")
    print(f"  Quelle: {src_dir}")
    print(f"  Ziel:   {dst_dir}")
    print(f"  Typen:  JS, PHP, CSS, HTML + tnet/config/ (JSON, JSON5)")
    print()

    candidates = collect_candidates(src_dir, dst_dir)

    if not candidates:
        print("[OK] Keine geaenderten Dateien gefunden.")
        return

    for src_abs, dst_abs, rel_file in candidates:
        label = "  KOPIEREN" if not args.dry_run else "  WUERDE KOPIEREN"
        print(f"{label}: {rel_file}")
        if not args.dry_run:
            os.makedirs(os.path.dirname(dst_abs), exist_ok=True)
            shutil.copy2(src_abs, dst_abs)

    print()
    verb = "kopiert" if not args.dry_run else "gefunden (Dry-Run)"
    print(f"[OK] {len(candidates)} Datei(en) {verb}.")


if __name__ == "__main__":
    main()
