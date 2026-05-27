#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
"""
upload_core_config.py
Core-Konfigurationsdateien per SFTP hochladen.

Quelle ist immer das lokale core/-Verzeichnis (Workspace-Root).
Ziel haengt von --env ab:
  --env dev   ->  lokal core/  ->  remote /www/core-dev/   (DEV-Test)
  --env prod  ->  lokal core/  ->  remote /www/core/        (PROD)

WICHTIG: Der SLM (slm.html / ags2mapplus-API) ist der primaere Weg
fuer Layer-Configs (layers_*.conf, maptips_*.conf) und NLS-Ressourcen,
da er Git-Versionierung einschliesst. Dieses Skript ist ein Fallback
fuer Massen-Uploads oder wenn der SLM nicht verfuegbar ist.

Typen (--type):
  config   ->  nur core/config/   (Layer-Configs, Basemaps, Maptips ...)
  nls      ->  nur core/nls/      (Sprachressourcen)
  all      ->  beides (Default)

Aufruf:
  python upload_core_config.py --type config --env dev
  python upload_core_config.py --type nls    --env prod
  python upload_core_config.py --type all    --env dev  --dry-run
  python upload_core_config.py --type config --env prod --yes

@version    1.0
@date       2026-05-27
@copyright  Trigonet AG
@author     Marco Dellenbach
"""
import os
import sys
import argparse
import paramiko
from deploy_env import resolve_deploy_config

# SFTP Config
HOST     = "nwow.mapplus.ch"
PORT     = 22
USER     = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"

# Workspace-Root (zwei Ebenen ueber deployment/)
WORKSPACE_ROOT = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
)
LOCAL_CORE_DIR = os.path.join(WORKSPACE_ROOT, "core")

# Dateierweiterungen, die nie hochgeladen werden (Backups etc.)
SKIP_EXTENSIONS = (".bak",)

# Unterverzeichnisse je nach --type
TYPE_SUBDIRS = {
    "config": ["config"],
    "nls":    ["nls"],
    "all":    ["config", "nls"],
}

# Umgebungs-Mapping: lokal core/ -> remote je nach env
ENV_REMOTE = {
    "dev":  "/www/core-dev",
    "prod": "/www/core",
}


def collect_files(local_dir, subdirs):
    """Alle Dateien in den angegebenen Unterverzeichnissen einsammeln."""
    result = []
    for subdir in subdirs:
        base = os.path.join(local_dir, subdir)
        if not os.path.isdir(base):
            print(f"[WARN] Verzeichnis nicht gefunden, uebersprungen: {base}")
            continue
        for root, dirs, files in os.walk(base):
            dirs[:] = [d for d in sorted(dirs) if not d.startswith(".")]
            for f in sorted(files):
                if f.startswith("."):
                    continue
                _, ext = os.path.splitext(f)
                if ext.lower() in SKIP_EXTENSIONS:
                    continue
                result.append(os.path.join(root, f))
    return result


def ensure_remote_dir(sftp, remote_dir):
    """Remote-Verzeichnis rekursiv anlegen falls noetig."""
    parts = remote_dir.rstrip("/").split("/")
    path = ""
    for part in parts:
        if not part:
            continue
        path = f"{path}/{part}"
        try:
            sftp.stat(path)
        except IOError:
            try:
                sftp.mkdir(path)
            except IOError:
                pass


def main():
    parser = argparse.ArgumentParser(
        description="Core-Konfigurationen (core/) per SFTP auf DEV oder PROD hochladen"
    )
    parser.add_argument(
        "--env",
        choices=["dev", "prod"],
        required=True,
        help="Zielumgebung: dev -> /www/core-dev/,  prod -> /www/core/",
    )
    parser.add_argument(
        "--type",
        choices=sorted(TYPE_SUBDIRS.keys()),
        default="all",
        dest="config_type",
        help="Welche Unterverzeichnisse: config, nls oder all (default: all)",
    )
    parser.add_argument("--dry-run", action="store_true", help="Nur anzeigen, nichts hochladen")
    parser.add_argument("--yes",     action="store_true", help="Ohne Rueckfrage durchfuehren")
    args = parser.parse_args()

    remote_base = ENV_REMOTE[args.env]
    subdirs     = TYPE_SUBDIRS[args.config_type]

    print()
    print("=" * 60)
    print(f"  CORE CONFIG DEPLOY  --type {args.config_type}  --env {args.env}")
    print(f"  Quelle:  {LOCAL_CORE_DIR}")
    print(f"  Remote:  {remote_base}/")
    print()
    if args.env == "prod":
        print("  HINWEIS: Layer-Configs primaer ueber den SLM deployen!")
        print("           (SLM versioniert aenderungen automatisch in Git)")
    else:
        print("  DEV-Ziel: /www/core-dev/ (nur Ueberschreiben, kein Git)")
    print("=" * 60)
    print()

    if not os.path.isdir(LOCAL_CORE_DIR):
        print(f"[ERR] Lokales core/-Verzeichnis nicht gefunden: {LOCAL_CORE_DIR}")
        sys.exit(1)

    files = collect_files(LOCAL_CORE_DIR, subdirs)

    if not files:
        print("[INFO] Keine Dateien gefunden.")
        sys.exit(0)

    print(f"{len(files)} Datei(en):")
    for f in files:
        rel  = os.path.relpath(f, LOCAL_CORE_DIR).replace("\\", "/")
        size = os.path.getsize(f)
        print(f"  * {rel:<55}  {size:>8,} bytes")

    if args.dry_run:
        print()
        print("[DRY-RUN] Kein Upload ausgefuehrt.")
        sys.exit(0)

    print()
    if not args.yes:
        try:
            answer = input(
                f"[?] {len(files)} Datei(en) nach {args.env.upper()} ({remote_base}/) hochladen? (j/n): "
            ).strip().lower()
        except EOFError:
            answer = ""
        if answer != "j":
            print("[ABBRUCH] Kein Upload.")
            sys.exit(0)

    print()
    print(f"Verbinde zu {HOST} ({args.env} -> {remote_base}) ...")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        ssh.connect(HOST, PORT, USER, PASSWORD)
        sftp = ssh.open_sftp()

        uploaded = 0
        errors   = 0

        for local_file in files:
            rel         = os.path.relpath(local_file, LOCAL_CORE_DIR).replace("\\", "/")
            remote_file = f"{remote_base}/{rel}"
            remote_dir  = remote_file.rsplit("/", 1)[0]

            ensure_remote_dir(sftp, remote_dir)

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
