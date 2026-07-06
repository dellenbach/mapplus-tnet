#!/usr/bin/env python3
"""
sync_maps_dev2edit.py
Lokaler Datei-Abgleich von maps-dev nach edit.
Kopiert ausschliesslich den kompletten tnet-Ordner sowie die Proxy-Dateien
agsproxy.php und wmsproxy.php.

Aufruf:
    python sync_maps_dev2edit.py              # Live-Sync
    python sync_maps_dev2edit.py --dry-run    # Vorschau ohne Aenderung

@version    1.0
@date       2026-07-02
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

SYNC_PREFIXES = (
    "tnet/",
)
SYNC_FILES = {
    "agsproxy.php",
    "wmsproxy.php",
}


def hash_file(path):
    """SHA-256 Hash einer Datei."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def should_sync(rel_path):
    """Erlaubte Datei fuer maps-dev -> edit."""
    rel = rel_path.replace("\\", "/").lstrip("/").lower()
    if rel in SYNC_FILES:
        return True
    return any(rel.startswith(prefix) for prefix in SYNC_PREFIXES)


def collect_candidates(src_dir, dst_dir):
    """Sammelt geaenderte/neue Dateien gemaess edit-Scope."""
    candidates = []

    for dirpath, _, filenames in os.walk(src_dir):
        rel_dir = os.path.relpath(dirpath, src_dir).replace("\\", "/")
        if rel_dir == ".":
            rel_dir = ""

        for fname in filenames:
            rel_file = (rel_dir + "/" + fname).lstrip("/")
            if not should_sync(rel_file):
                continue

            src_abs = os.path.join(src_dir, rel_file.replace("/", os.sep))
            dst_abs = os.path.join(dst_dir, rel_file.replace("/", os.sep))

            if not os.path.exists(dst_abs) or hash_file(src_abs) != hash_file(dst_abs):
                candidates.append((src_abs, dst_abs, rel_file))

    return sorted(candidates, key=lambda item: item[2])


def main():
    parser = argparse.ArgumentParser(
        description="Lokaler Sync: maps-dev -> edit (tnet/** + proxys)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Nur anzeigen, nichts kopieren",
    )
    args = parser.parse_args()

    dev_config = resolve_deploy_config("dev")
    edit_config = resolve_deploy_config("edit")

    src_dir = os.path.normpath(dev_config["local_base"])
    dst_dir = os.path.normpath(edit_config["local_base"])

    mode_label = "DRY-RUN" if args.dry_run else "LIVE"
    print(f"Sync maps-dev -> edit [{mode_label}]")
    print(f"  Quelle: {src_dir}")
    print(f"  Ziel:   {dst_dir}")
    print("  Scope:  tnet/**, agsproxy.php, wmsproxy.php")
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
