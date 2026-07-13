#!/usr/bin/env python3
"""
sync_tnet_to_site.py
Lokaler Abgleich von maps-dev/ nach <site>/ (geohost, edit).
Synchronisiert:
  - maps-dev/tnet/    -> <site>/tnet/          (Anwendungscode)
  - agsproxy.php, wmsproxy.php                 (geteilte Root-PHPs)
    maps-dev/<datei>  -> <site>/<datei>

Site-spezifische Root-Dateien (index.php, loader.php, .htaccess)
bleiben unangetastet.

Aufruf:
    python sync_tnet_to_site.py --site geohost              # Live-Sync
    python sync_tnet_to_site.py --site edit --dry-run       # Vorschau

@version    1.1
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

# Geteilte Root-PHP-Dateien: technisch identisch auf allen Sites, werden mitsynchronisiert.
# Site-spezifische Root-Dateien (index.php, loader.php, .htaccess) sind NICHT enthalten.
ROOT_LEVEL_SYNC_FILES = [
    "agsproxy.php",
    "wmsproxy.php",
]


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

    dev_base  = os.path.normpath(dev_config["local_base"])
    site_base = os.path.normpath(site_config["local_base"])
    src_tnet  = os.path.join(dev_base,  "tnet")
    dst_tnet  = os.path.join(site_base, "tnet")

    mode_label = "DRY-RUN" if args.dry_run else "LIVE"
    print(f"Sync maps-dev -> {args.site} [{mode_label}]")
    print(f"  Quelle: {dev_base}")
    print(f"  Ziel:   {site_base}")
    print(f"  Typen:  {', '.join(sorted(SYNC_EXTENSIONS))}")
    print(f"  Skip:   {', '.join(sorted(SKIP_SUBDIRS))}")
    print()

    if not os.path.isdir(src_tnet):
        print(f"[FEHLER] Quellverzeichnis existiert nicht: {src_tnet}")
        sys.exit(1)

    # ── 1. tnet/ synchronisieren ──────────────────────────────────────────────
    print("=== tnet/ ===")
    candidates = collect_candidates(src_tnet, dst_tnet)

    if not candidates:
        print("  Keine Aenderungen in tnet/.")
    else:
        for _, _, rel in candidates:
            status = "NEU" if not os.path.exists(os.path.join(dst_tnet, rel.replace("/", os.sep))) else "UPD"
            print(f"  [{status}] tnet/{rel}")

    # ── 2. Geteilte Root-PHP-Dateien synchronisieren ──────────────────────────
    root_candidates = []
    print("\n=== Root-Dateien (geteilt) ===")
    for fname in ROOT_LEVEL_SYNC_FILES:
        src_abs = os.path.join(dev_base, fname)
        dst_abs = os.path.join(site_base, fname)
        if not os.path.exists(src_abs):
            print(f"  [SKIP] {fname} (nicht in maps-dev/ vorhanden)")
            continue
        if not os.path.exists(dst_abs) or hash_file(src_abs) != hash_file(dst_abs):
            status = "NEU" if not os.path.exists(dst_abs) else "UPD"
            print(f"  [{status}] {fname}")
            root_candidates.append((src_abs, dst_abs, fname))
        else:
            print(f"  [OK ] {fname} (unveraendert)")

    total = len(candidates) + len(root_candidates)
    if total == 0:
        print("\nAlles synchron. Keine Aenderungen.")
        return

    if args.dry_run:
        print(f"\n[DRY-RUN] {total} Datei(en) wuerden kopiert.")
        return

    # Dateien kopieren
    copied = 0
    for src_abs, dst_abs, rel in candidates:
        os.makedirs(os.path.dirname(dst_abs), exist_ok=True)
        shutil.copy2(src_abs, dst_abs)
        copied += 1
    for src_abs, dst_abs, fname in root_candidates:
        os.makedirs(os.path.dirname(dst_abs), exist_ok=True)
        shutil.copy2(src_abs, dst_abs)
        copied += 1

    print(f"\n[OK] {copied} Datei(en) synchronisiert.")


if __name__ == "__main__":
    main()
