#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

"""
upload_js_stage_to_prod.py
Ladet alle Dateien aus maps-dev/tnet/js-stage per SFTP nach
/www/maps/tnet/js hoch (Mapping js-stage -> js).

Aufruf:
    python upload_js_stage_to_prod.py
    python upload_js_stage_to_prod.py --dry-run

@version    1.0
@date       2026-06-02
@copyright  Trigonet AG
@author     Marco Dellenbach
"""

import argparse
import hashlib
import json
import os
import paramiko

from deploy_env import ensure_local_base_exists, resolve_deploy_config

HOST = "nwow.mapplus.ch"
PORT = 22
USER = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"

SCRIPT_DIR = os.path.dirname(__file__)
STATE_FILE = os.path.join(SCRIPT_DIR, "upload_state.prod.js-stage.json")


def load_state():
    """Gespeicherten Upload-State laden."""
    if os.path.isfile(STATE_FILE):
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as handle:
                return json.load(handle)
        except Exception:
            pass
    return {}


def save_state(state):
    """Upload-State speichern."""
    with open(STATE_FILE, "w", encoding="utf-8") as handle:
        json.dump(state, handle, indent=2)


def hash_file(path):
    """SHA256 fuer robuste Change-Erkennung."""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def make_state_entry(path):
    """State-Eintrag aus mtime + hash."""
    return {
        "mtime": os.path.getmtime(path),
        "sha256": hash_file(path),
    }


def has_changed(path, key, state):
    """Prueft, ob sich Datei seit letztem Upload geaendert hat."""
    if key not in state:
        return True

    entry = state[key]
    if not isinstance(entry, dict) or "sha256" not in entry:
        return True

    return hash_file(path) != entry.get("sha256")


def collect_stage_candidates(stage_root):
    """Sammelt alle .js Dateien unter maps-dev/tnet/js-stage."""
    candidates = []
    for root, dirs, files in os.walk(stage_root):
        dirs[:] = [d for d in dirs if d != "__pycache__"]
        for filename in files:
            if not filename.endswith(".js"):
                continue
            local_file = os.path.join(root, filename)
            rel = os.path.relpath(local_file, stage_root).replace("\\", "/")
            state_key = f"tnet/js-stage/{rel}"
            candidates.append((local_file, rel, state_key))
    return sorted(candidates, key=lambda row: row[1])


def main():
    parser = argparse.ArgumentParser(
        description="Upload geaenderter JS-Stage Dateien nach PROD-Runtime"
    )
    parser.add_argument("--dry-run", action="store_true", help="Nur anzeigen, nichts hochladen")
    args = parser.parse_args()

    dev_cfg = resolve_deploy_config("dev")
    prod_cfg = resolve_deploy_config("prod")

    dev_base = os.path.normpath(dev_cfg["local_base"])
    stage_root = os.path.normpath(os.path.join(dev_base, "tnet", "js-stage"))
    remote_base = prod_cfg["remote_base"]

    ensure_local_base_exists(dev_base)
    if not os.path.isdir(stage_root):
        print(f"[ERR] js-stage Verzeichnis nicht gefunden: {stage_root}")
        sys.exit(1)

    state = load_state()
    candidates = collect_stage_candidates(stage_root)

    mode = "DRY-RUN" if args.dry_run else "LIVE"
    print(f"Suche JS-Stage Dateien ({mode}) ...")
    print(f"  Quelle: {stage_root}")
    print(f"  Ziel:   {remote_base}/tnet/js")

    if not candidates:
        print("\nKeine js-stage Dateien gefunden.")
        return

    print(f"\n[INFO] Deploy-Kandidaten ({len(candidates)}):")
    for _, rel, _ in candidates:
        print(f"  * tnet/js-stage/{rel} -> tnet/js/{rel}")

    if args.dry_run:
        print("\n[OK] Dry-Run abgeschlossen (kein Upload ausgefuehrt).")
        return

    print(f"\nVerbinde zu {HOST} (prod -> {remote_base})...")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    uploaded = 0
    skipped = 0

    try:
        ssh.connect(HOST, PORT, USER, PASSWORD)
        sftp = ssh.open_sftp()

        total = len(candidates)
        for idx, (local_file, rel, state_key) in enumerate(candidates, start=1):
            progress = f"[{idx:03d}/{total:03d}]"
            remote_rel = f"tnet/js/{rel}"
            remote_file = f"{remote_base}/{remote_rel}"

            try:
                sftp.put(local_file, remote_file)
                size = os.path.getsize(local_file)
                print(f"  {progress} [OK] {remote_rel} ({size:,} bytes)")
                state[state_key] = make_state_entry(local_file)
                uploaded += 1
            except Exception as exc:
                print(f"  {progress} [ERR] {remote_rel} -- {exc}")
                skipped += 1

        sftp.close()
        ssh.close()

        save_state(state)
        print(f"\n[OK] Fertig: {uploaded} hochgeladen, {skipped} uebersprungen")

    except Exception as exc:
        print(f"[ERR] Verbindungsfehler: {exc}")
        sys.exit(1)


if __name__ == "__main__":
    main()
