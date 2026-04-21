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
import paramiko

# ===== KONFIGURATION =====
BUILD_SCRIPT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "_build_js.py"))
LOCAL_BASE   = os.path.normpath(r"c:\_Daten\mapplus-exp\maps")
STATE_FILE   = os.path.normpath(os.path.join(os.path.dirname(__file__), "upload_state.json"))

HOST         = "nwow.mapplus.ch"
PORT         = 22
USER         = "trigonet"
PASSWORD     = "3Zs,k4%Un,<[W(Kx"
REMOTE_BASE  = "/www/maps"

# Verzeichnisse die nie direkt hochgeladen werden duerfen
BLOCKED_DIRS = ["tnet/js-dev/", "tnet\\js-dev\\"]


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
    state = load_state()

    print("Suche geaenderte Dateien unter maps/ ...")
    changed = get_changed_files(state)

    if not changed:
        print("Keine geaenderten Dateien gefunden.")
        return

    print(f"{len(changed)} geaenderte Datei(en) gefunden:\n")
    for p in changed:
        rel = os.path.relpath(p, LOCAL_BASE).replace("\\", "/")
        print(f"  • {rel}")

    print(f"\nVerbinde zu {HOST}...")
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
