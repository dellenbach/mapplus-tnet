#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
"""
_upload_all_js.py
Alle JS-Quelldateien aus js-dev/ bauen (minify + obfuscate) und
die minifizierten Versionen aus js/ vollstaendig hochladen.
Nuetzlich fuer initialen Deploy oder wenn unklar ob alle Dateien aktuell sind.

@version    1.0
@date       2026-04-21
@copyright  Trigonet AG
@author     Marco Dellenbach
"""
import os
import subprocess
import argparse
import paramiko
from deploy_env import add_env_argument, ensure_local_base_exists, resolve_deploy_config

# ===== KONFIGURATION =====
BUILD_SCRIPT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "build", "build_js.py"))
LOCAL_JS     = ""
LOCAL_BASE   = ""
HOST         = "nwow.mapplus.ch"
PORT         = 22
USER         = "trigonet"
PASSWORD     = "3Zs,k4%Un,<[W(Kx"
REMOTE_BASE  = ""


def main():
    global LOCAL_JS, LOCAL_BASE, REMOTE_BASE

    parser = argparse.ArgumentParser(description="Alle JS-Dateien fuer dev oder prod bauen und deployen")
    add_env_argument(parser)
    args = parser.parse_args()

    deploy_config = resolve_deploy_config(args.env)
    LOCAL_BASE = os.path.normpath(deploy_config["local_base"])
    LOCAL_JS = os.path.normpath(os.path.join(LOCAL_BASE, "tnet", "js"))
    REMOTE_BASE = deploy_config["remote_base"]
    ensure_local_base_exists(LOCAL_BASE)

    # ===== SCHRITT 1: Full-Build =====
    print("=" * 60)
    print(f"Schritt 1: Full-Build (env={deploy_config['env']}, js-dev/ -> js/)")
    print("=" * 60)
    result = subprocess.run([sys.executable, BUILD_SCRIPT])
    if result.returncode != 0:
        print("\n✗ Build fehlgeschlagen — Upload abgebrochen.")
        sys.exit(1)

    # ===== SCHRITT 2: Alle JS hochladen =====
    print()
    print("=" * 60)
    print(f"Schritt 2: Upload aller JS-Dateien → {HOST} ({REMOTE_BASE})")
    print("=" * 60)

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(HOST, PORT, USER, PASSWORD)
        sftp = ssh.open_sftp()

        # Remote-Verzeichnisse sicherstellen
        for d in [f"{REMOTE_BASE}/tnet/js", f"{REMOTE_BASE}/tnet/js/mobile"]:
            try:
                sftp.mkdir(d)
            except Exception:
                pass  # Existiert bereits

        uploaded = 0
        total_size = 0

        for root, dirs, files in os.walk(LOCAL_JS):
            dirs.sort()
            for f in sorted(files):
                if not f.endswith(".js"):
                    continue
                local = os.path.join(root, f)
                rel = os.path.relpath(local, LOCAL_BASE).replace("\\", "/")
                remote = f"{REMOTE_BASE}/{rel}"
                size = os.path.getsize(local)
                try:
                    sftp.put(local, remote)
                    print(f"  ✓ {rel} ({size:,} bytes)")
                    uploaded += 1
                    total_size += size
                except Exception as e:
                    print(f"  ✗ {rel} — {e}")

        sftp.close()
        ssh.close()
        print(f"\n✓ Fertig: {uploaded} Dateien hochgeladen ({total_size:,} bytes gesamt)")

    except Exception as e:
        print(f"✗ Verbindungsfehler: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
