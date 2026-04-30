#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
"""
_upload_changed.py
Geaenderte Dateien unter maps/ per SFTP hochladen.
Erkennung via mtime-State-Datei (upload_state.json) — unabhaengig von git.
Nach erfolgreichem Upload wird die mtime der Quelldatei gespeichert.
JS-Quelldateien (js-dev/) werden automatisch gebaut; js/ wird hochgeladen.

@version    2.0
@date       2026-04-21
@copyright  Trigonet AG
@author     Marco Dellenbach
"""
import os
import subprocess
import json
import argparse
import paramiko
from deploy_env import add_env_argument, ensure_local_base_exists, resolve_deploy_config

# ===== KONFIGURATION =====
BUILD_SCRIPT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "_build_js.py"))
LOCAL_BASE   = ""
STATE_FILE   = ""

HOST         = "nwow.mapplus.ch"
PORT         = 22
USER         = "trigonet"
PASSWORD     = "3Zs,k4%Un,<[W(Kx"
REMOTE_BASE  = ""

# Verzeichnisse die nie direkt hochgeladen werden duerfen
BLOCKED_DIRS = ["tnet/js-dev/", "tnet\\js-dev\\"]

# Konfigurationsdateien sind API/Git-only und duerfen NICHT versehentlich per FTP deployt werden.
# Explizite Ausnahme nur via --allow-config --reason "...".
PROTECTED_EXTENSIONS = (".conf", ".json", ".json5")
PROTECTED_PREFIXES = (
    "core/config/",
    "core/nls/",
    "public/config/",
    "tnet/config/",
)


# ===== STATE-VERWALTUNG =====

def load_state():
    """Gespeicherte Upload-Timestamps laden."""
    if os.path.isfile(STATE_FILE):
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def save_state(state):
    """Upload-Timestamps speichern."""
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)


def get_mtime(path):
    """Datei-mtime als float."""
    return os.path.getmtime(path)


def is_protected_config(rel_path):
    """Prueft, ob eine Datei unter geschuetzte Config-Pfade faellt."""
    rel = rel_path.replace("\\", "/").lower()
    if not rel.endswith(PROTECTED_EXTENSIONS):
        return False
    return any(rel.startswith(prefix) for prefix in PROTECTED_PREFIXES)


# ===== DATEIEN SAMMELN =====

def collect_candidates():
    """
    Alle Dateien unter maps/ rekursiv sammeln.
    js/ (Build-Output) wird uebersprungen — wird via js-dev/ abgedeckt.
    Verzeichnisse die in .gitignore stehen (core/, public/config/ etc.) werden uebersprungen.
    """
    SKIP_DIRS = {
        os.path.normpath(os.path.join(LOCAL_BASE, "tnet", "js")),
        os.path.normpath(os.path.join(LOCAL_BASE, "core")),
        os.path.normpath(os.path.join(LOCAL_BASE, "public", "config")),
        os.path.normpath(os.path.join(LOCAL_BASE, "public", "guis")),
    }
    candidates = []
    for root, dirs, files in os.walk(LOCAL_BASE):
        norm_root = os.path.normpath(root)
        if any(norm_root == sd or norm_root.startswith(sd + os.sep) for sd in SKIP_DIRS):
            dirs.clear()
            continue
        for f in files:
            candidates.append(os.path.join(root, f))
    return candidates


def get_changed_files(state):
    """Dateien zurueckgeben deren mtime neuer ist als der letzte Upload."""
    changed = []
    for path in collect_candidates():
        key = os.path.relpath(path, LOCAL_BASE).replace("\\", "/")
        mtime = get_mtime(path)
        if key not in state or mtime > state[key]:
            changed.append(path)
    return sorted(changed)


# ===== UPLOAD =====

def main():
    global LOCAL_BASE, STATE_FILE, REMOTE_BASE

    parser = argparse.ArgumentParser(description="Geaenderte Dateien unter maps/ per SFTP hochladen")
    add_env_argument(parser)
    parser.add_argument("--allow-config", action="store_true", help="Erlaubt Upload geschuetzter Config-Dateien")
    parser.add_argument("--reason", default="", help="Pflicht bei --allow-config: Grund/Referenz")
    parser.add_argument("--dry-run", action="store_true", help="Nur anzeigen, nichts hochladen")
    args = parser.parse_args()

    deploy_config = resolve_deploy_config(args.env)
    LOCAL_BASE = os.path.normpath(deploy_config["local_base"])
    STATE_FILE = os.path.normpath(deploy_config["state_file"])
    REMOTE_BASE = deploy_config["remote_base"]
    ensure_local_base_exists(LOCAL_BASE)

    if args.allow_config and not args.reason.strip():
        print("✗ --allow-config erfordert --reason \"...\"")
        sys.exit(2)

    state = load_state()
    source_name = os.path.basename(LOCAL_BASE)

    print(f"Suche geaenderte Dateien unter {source_name}/ (env={deploy_config['env']}) ...")
    changed = get_changed_files(state)

    if not changed:
        print("Keine geaenderten Dateien gefunden.")
        return

    print(f"{len(changed)} geaenderte Datei(en) gefunden:\n")
    for p in changed:
        rel = os.path.relpath(p, LOCAL_BASE).replace("\\", "/")
        print(f"  • {rel}")

    blocked = []
    for p in changed:
        rel = os.path.relpath(p, LOCAL_BASE).replace("\\", "/")
        if is_protected_config(rel):
            blocked.append(rel)

    if blocked and not args.allow_config:
        print("\n✗ Abbruch: Geschuetzte Config-Dateien erkannt (API/Git-only):")
        for rel in blocked:
            print(f"  • {rel}")
        print("\nVerwende fuer Notfaelle explizit: --allow-config --reason \"...\"")
        sys.exit(3)

    if blocked and args.allow_config:
        print("\n⚠ Override aktiv: Geschuetzte Config-Dateien werden hochgeladen")
        print(f"  Grund: {args.reason.strip()}")
        for rel in blocked:
            print(f"  • {rel}")

    if args.dry_run:
        print("\n✓ Dry-Run abgeschlossen (kein Upload ausgefuehrt).")
        return

    print(f"\nVerbinde zu {HOST} ({deploy_config['env']} -> {REMOTE_BASE})...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        ssh.connect(HOST, PORT, USER, PASSWORD)
        sftp = ssh.open_sftp()

        uploaded = 0
        skipped  = 0

        for local_file in changed:
            rel = os.path.relpath(local_file, LOCAL_BASE).replace("\\", "/")

            # ===== JS-DEV: Build-Schritt =====
            if rel.startswith("tnet/js-dev/"):
                print(f"  ⚙ Build: {rel}")
                build_result = subprocess.run(
                    [sys.executable, BUILD_SCRIPT, local_file],
                    capture_output=True, text=True
                )
                if build_result.returncode != 0:
                    print(f"  ✗ Build fehlgeschlagen: {build_result.stderr.strip() or build_result.stdout.strip()}")
                    skipped += 1
                    continue
                # Auf js/ umleiten
                upload_rel  = rel.replace("tnet/js-dev/", "tnet/js/")
                upload_file = os.path.join(LOCAL_BASE, upload_rel.replace("/", os.sep))
            else:
                upload_rel  = rel
                upload_file = local_file

            # Sicherheitssperre
            if any(b in upload_rel for b in ["tnet/js-dev/"]):
                print(f"  ✗ GESPERRT: {upload_rel}")
                skipped += 1
                continue

            # Config-Guard (zweite Sicherung auch waehrend Upload-Schleife)
            if is_protected_config(upload_rel) and not args.allow_config:
                print(f"  ✗ GESPERRT (Config API/Git-only): {upload_rel}")
                skipped += 1
                continue

            if not os.path.isfile(upload_file):
                print(f"  ⚠ {upload_rel} (nicht gefunden — uebersprungen)")
                skipped += 1
                continue

            remote_file = f"{REMOTE_BASE}/{upload_rel}"
            try:
                sftp.put(upload_file, remote_file)
                size = os.path.getsize(upload_file)
                print(f"  ✓ {upload_rel} ({size:,} bytes)")
                # mtime der Quelldatei merken (nicht des Build-Outputs)
                state[rel] = get_mtime(local_file)
                uploaded += 1
            except Exception as e:
                print(f"  ✗ {upload_rel} — {e}")
                skipped += 1

        sftp.close()
        ssh.close()
        save_state(state)
        print(f"\n✓ Fertig: {uploaded} hochgeladen, {skipped} uebersprungen")

    except Exception as e:
        print(f"✗ Verbindungsfehler: {e}")


if __name__ == "__main__":
    main()
