#!/usr/bin/env python3
"""
_promote_dev_to_prod.py
Lokale Promotion von maps-dev nach maps mit optionalem anschliessendem PROD-Deploy.

@version    1.0
@date       2026-04-30
@copyright  Trigonet AG
@author     Marco Dellenbach
"""
import argparse
import os
import subprocess
import sys

from deploy_env import resolve_deploy_config, ensure_local_base_exists


SCRIPT_DIR = os.path.dirname(__file__)
UPLOAD_CHANGED_SCRIPT = os.path.join(SCRIPT_DIR, "_upload_changed.py")


def run_command(command, description):
    """Fuehrt einen Shell-Kommando aus und behandelt Exit-Codes robust."""
    print(f"\n=== {description} ===")
    print(" ".join(command))
    result = subprocess.run(command)
    return result.returncode


def run_robocopy(source_dir, target_dir, dry_run=False, mirror=False):
    """Synchronisiert den DEV-Stand lokal nach PROD."""
    command = [
        "robocopy",
        source_dir,
        target_dir,
    ]

    if mirror:
        command.append("/MIR")
    else:
        command.append("/E")

    command.extend([
        "/NFL",
        "/NDL",
        "/NJH",
        "/NJS",
        "/NP",
        "/R:1",
        "/W:1",
    ])

    if dry_run:
        command.append("/L")

    exit_code = run_command(command, "Lokale Promotion maps-dev -> maps")

    # Robocopy: 0-7 = Erfolg/Warnungen, >=8 = Fehler
    if exit_code >= 8:
        raise RuntimeError(f"Robocopy fehlgeschlagen mit Exit-Code {exit_code}")

    print(f"Robocopy beendet mit Exit-Code {exit_code}.")


def run_prod_deploy(dry_run=False):
    """Fuehrt optional direkt den PROD-Deploy aus."""
    command = [sys.executable, UPLOAD_CHANGED_SCRIPT, "--env", "prod"]
    if dry_run:
        command.append("--dry-run")

    exit_code = run_command(command, "PROD-Deploy geaenderter Dateien")
    if exit_code != 0:
        raise RuntimeError(f"PROD-Deploy fehlgeschlagen mit Exit-Code {exit_code}")


def main():
    parser = argparse.ArgumentParser(
        description="Promoted den lokalen Stand von maps-dev nach maps und optional nach PROD"
    )
    parser.add_argument("--dry-run", action="store_true", help="Nur anzeigen, nichts veraendern")
    parser.add_argument(
        "--mirror",
        action="store_true",
        help="Verwendet /MIR statt /E und loescht damit lokale Dateien in maps, die in maps-dev fehlen",
    )
    parser.add_argument(
        "--deploy-prod",
        action="store_true",
        help="Fuehrt nach der lokalen Promotion direkt den PROD-Deploy aus",
    )
    args = parser.parse_args()

    dev_config = resolve_deploy_config("dev")
    prod_config = resolve_deploy_config("prod")

    dev_dir = os.path.normpath(dev_config["local_base"])
    prod_dir = os.path.normpath(prod_config["local_base"])

    ensure_local_base_exists(dev_dir)
    ensure_local_base_exists(prod_dir)

    mode_label = "DRY-RUN" if args.dry_run else "LIVE"
    sync_mode = "/MIR" if args.mirror else "/E"

    print(f"Promotion-Modus: {mode_label}")
    print(f"Quelle: {dev_dir}")
    print(f"Ziel:   {prod_dir}")
    print(f"Sync:   {sync_mode}")
    print(f"Deploy: {'ja' if args.deploy_prod else 'nein'}")

    run_robocopy(dev_dir, prod_dir, dry_run=args.dry_run, mirror=args.mirror)

    if args.deploy_prod:
        run_prod_deploy(dry_run=args.dry_run)

    print("\n✓ Promotion abgeschlossen")


if __name__ == "__main__":
    main()