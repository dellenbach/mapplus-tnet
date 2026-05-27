#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
"""
upload_config.py
Konfigurationsdateien gezielt per SFTP hochladen.
NICHT fuer Layer-Configs (core/config/, core/nls/) — diese werden primaer
ueber den SLM (slm.html / ags2mapplus-API) verwaltet.

Typen:
  --type app       -> tnet/config/  (tnet-global-config.json5 etc.)
  --type portals   -> public/config/ (portal-spezifische Configs: nwpro, owpro, nodi ...)

Beides erfordert explizite Bestaetigung (oder --yes).

Aufruf:
    python upload_config.py --type app     --env dev
    python upload_config.py --type portals --env dev  --dry-run
    python upload_config.py --type app     --env prod --yes

@version    1.0
@date       2026-05-27
@copyright  Trigonet AG
@author     Marco Dellenbach
"""
import os
import sys
import argparse
import paramiko
from deploy_env import add_env_argument, ensure_local_base_exists, resolve_deploy_config

# SFTP Config
HOST     = "nwow.mapplus.ch"
PORT     = 22
USER     = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"

# Konfigurationstypen: lokaler Unterpfad -> remote Unterpfad
CONFIG_TYPES = {
    "app": {
        "local_subpath":  os.path.join("tnet", "config"),
        "remote_subpath": "tnet/config",
        "description":    "App-Konfiguration (tnet-global-config.json5 etc.)",
    },
    "portals": {
        "local_subpath":  os.path.join("public", "config"),
        "remote_subpath": "public/config",
        "description":    "Portal-Konfigurationen (nwpro, owpro, nodi, marco ...)",
    },
}


def collect_files(local_dir):
    """Alle Dateien in local_dir rekursiv einsammeln."""
    result = []
    for root, dirs, files in os.walk(local_dir):
        # versteckte Verzeichnisse ueberspringen
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for f in files:
            if f.startswith("."):
                continue
            result.append(os.path.join(root, f))
    return sorted(result)


def ensure_remote_dir(sftp, remote_dir):
    """Erstellt ein Remote-Verzeichnis rekursiv falls noetig."""
    parts = remote_dir.rstrip("/").split("/")
    path = ""
    for part in parts:
        if not part:
            continue
        path = path + "/" + part
        try:
            sftp.stat(path)
        except IOError:
            try:
                sftp.mkdir(path)
            except IOError:
                pass  # existiert bereits (race condition)


def main():
    parser = argparse.ArgumentParser(
        description="Konfigurationsdateien (app oder portals) per SFTP hochladen"
    )
    add_env_argument(parser)
    parser.add_argument(
        "--type",
        required=True,
        choices=sorted(CONFIG_TYPES.keys()),
        dest="config_type",
        help="Konfigurationstyp: 'app' (tnet/config/) oder 'portals' (public/config/)",
    )
    parser.add_argument("--dry-run", action="store_true", help="Nur anzeigen, nichts hochladen")
    parser.add_argument("--yes", action="store_true", help="Ohne Rueckfrage durchfuehren")
    args = parser.parse_args()

    deploy_config = resolve_deploy_config(args.env)
    local_base    = os.path.normpath(deploy_config["local_base"])
    remote_base   = deploy_config["remote_base"]
    ensure_local_base_exists(local_base)

    cfg         = CONFIG_TYPES[args.config_type]
    local_dir   = os.path.normpath(os.path.join(local_base, cfg["local_subpath"]))
    remote_dir  = f"{remote_base}/{cfg['remote_subpath']}"
    description = cfg["description"]

    print()
    print("=" * 52)
    print(f"  CONFIG DEPLOY  --type {args.config_type}")
    print(f"  {description}")
    print(f"  env:    {deploy_config['env']}")
    print(f"  lokal:  {local_dir}")
    print(f"  remote: {remote_dir}")
    print("=" * 52)
    print()

    if not os.path.isdir(local_dir):
        print(f"[ERR] Lokales Verzeichnis nicht gefunden: {local_dir}")
        sys.exit(1)

    files = collect_files(local_dir)
    if not files:
        print("[INFO] Keine Dateien gefunden.")
        sys.exit(0)

    print(f"{len(files)} Datei(en):")
    for f in files:
        rel = os.path.relpath(f, local_dir).replace("\\", "/")
        size = os.path.getsize(f)
        print(f"  * {rel}  ({size:,} bytes)")

    if args.dry_run:
        print()
        print("[DRY-RUN] Kein Upload ausgefuehrt.")
        sys.exit(0)

    # Bestaetigung einholen
    if not args.yes:
        print()
        try:
            answer = input(f"[?] {len(files)} Datei(en) auf {deploy_config['env'].upper()} hochladen? (j/n): ").strip().lower()
        except EOFError:
            answer = ""
        if answer != "j":
            print("[ABBRUCH] Kein Upload.")
            sys.exit(0)

    print()
    print(f"Verbinde zu {HOST} ({deploy_config['env']} -> {remote_base}) ...")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        ssh.connect(HOST, PORT, USER, PASSWORD)
        sftp = ssh.open_sftp()

        uploaded = 0
        errors   = 0

        for local_file in files:
            rel         = os.path.relpath(local_file, local_dir).replace("\\", "/")
            remote_file = f"{remote_dir}/{rel}"
            remote_subdir = remote_file.rsplit("/", 1)[0]

            ensure_remote_dir(sftp, remote_subdir)

            try:
                sftp.put(local_file, remote_file)
                size = os.path.getsize(local_file)
                print(f"  [OK] {rel}  ({size:,} bytes)")
                uploaded += 1
            except Exception as e:
                print(f"  [ERR] {rel}  -- {e}")
                errors += 1

        sftp.close()
        ssh.close()

        print()
        print(f"[OK] Fertig: {uploaded} hochgeladen, {errors} Fehler")
        if errors:
            sys.exit(1)

    except Exception as e:
        print(f"[ERR] Verbindungsfehler: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
