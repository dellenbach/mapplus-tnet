#!/usr/bin/env python3
"""
sync_tnet_to_site.py
Lokaler Abgleich von maps-dev/tnet/ nach <site>/tnet/ (geohost, edit).
Gleicher Ablauf wie sync_maps_dev2maps.py fuer PROD, aber beschraenkt auf tnet/.

Aufruf:
    python sync_tnet_to_site.py --site geohost              # Live-Sync
    python sync_tnet_to_site.py --site edit --dry-run       # Vorschau

@version    1.0
@date       2026-07-13
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

SYNC_EXTENSIONS = {".js", ".php", ".css", ".html", ".htm", ".json", ".json5", ".conf", ".inc"}

# Verzeichnisse innerhalb von tnet/ die nicht synchronisiert werden
SKIP_SUBDIRS = {
    "js-stage",
    "js-src",
    "js_ori",
    "js-dev",
    "docs",
    "tests",
}


# ===== HILFSFUNKTIONEN =====

def hash_file(path):
    """SHA-256 Hash einer Datei."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def should_skip_dir(dirname):
    """Prueft ob ein Verzeichnis uebersprungen werden soll."""
    return dirname in SKIP_SUBDIRS or dirname.startswith(".")


def should_sync(filename):
    """Prueft ob eine Datei synchronisiert werden soll."""
    ext = os.path.splitext(filename)[1].lower()
    return ext in SYNC_EXTENSIONS


def collect_candidates(src_dir, dst_dir):
    """
    Sammelt geaenderte/neue Dateien in src_dir gegenueber dst_dir.
    Gibt Liste von (src_abs, dst_abs, rel_path) zurueck.
    Nur kopieren, nie loeschen (kein Mirror-Modus).
    """
    candidates = []

    for dirpath, dirnames, filenames in os.walk(src_dir):
        # Verzeichnisse in-place filtern
        dirnames[:] = [d for d in dirnames if not should_skip_dir(d)]

        for fname in filenames:
            if not should_sync(fname):
                continue

            src_abs = os.path.join(dirpath, fname)
            rel_file = os.path.relpath(src_abs, src_dir).replace("\\", "/")
            dst_abs = os.path.join(dst_dir, rel_file.replace("/", os.sep))

            # Kopieren wenn Zieldatei fehlt oder Hash sich unterscheidet
            if not os.path.exists(dst_abs) or hash_file(src_abs) != hash_file(dst_abs):
                candidates.append((src_abs, dst_abs, rel_file))

    return candidates


# ===== MAIN =====

def main():
    parser = argparse.ArgumentParser(
        description="Lokaler Sync: maps-dev/tnet/ -> <site>/tnet/"
    )
    parser.add_argument(
        "--site",
        required=True,
        choices=["geohost", "edit"],
        help="Ziel-Site (geohost oder edit)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Nur anzeigen, nichts kopieren",
    )
    args = parser.parse_args()

    dev_config = resolve_deploy_config("dev")
    site_config = resolve_deploy_config(args.site)

    src_dir = os.path.normpath(os.path.join(dev_config["local_base"], "tnet"))
    dst_dir = os.path.normpath(os.path.join(site_config["local_base"], "tnet"))

    mode_label = "DRY-RUN" if args.dry_run else "LIVE"
    print(f"Sync maps-dev/tnet/ -> {args.site}/tnet/ [{mode_label}]")
    print(f"  Quelle: {src_dir}")
    print(f"  Ziel:   {dst_dir}")
    print(f"  Typen:  {', '.join(sorted(SYNC_EXTENSIONS))}")
    print(f"  Skip:   {', '.join(sorted(SKIP_SUBDIRS))}")
    print()

    if not os.path.isdir(src_dir):
        print(f"[FEHLER] Quellverzeichnis existiert nicht: {src_dir}")
        sys.exit(1)

    candidates = collect_candidates(src_dir, dst_dir)

    if not candidates:
        print("Keine Aenderungen gefunden. Alles synchron.")
        return

    print(f"{len(candidates)} geaenderte/neue Datei(en):\n")
    for _, _, rel in candidates:
        status = "NEU" if not os.path.exists(os.path.join(dst_dir, rel.replace("/", os.sep))) else "UPD"
        print(f"  [{status}] tnet/{rel}")

    if args.dry_run:
        print(f"\n[DRY-RUN] {len(candidates)} Datei(en) wuerden kopiert.")
        return

    # Dateien kopieren
    copied = 0
    for src_abs, dst_abs, rel in candidates:
        os.makedirs(os.path.dirname(dst_abs), exist_ok=True)
        shutil.copy2(src_abs, dst_abs)
        copied += 1

    print(f"\n[OK] {copied} Datei(en) synchronisiert.")


if __name__ == "__main__":
    main()
