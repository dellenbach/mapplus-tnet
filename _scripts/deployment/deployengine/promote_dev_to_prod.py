#!/usr/bin/env python3
"""
promote_dev_to_prod.py
Lokale Promotion von maps-dev nach maps. Lesbare JS-Originale werden nach
maps/tnet/js-src gespiegelt; die finale PROD-Runtime kommt aus
maps-dev/tnet/js-stage nach maps/tnet/js.

Aufruf:
    python promote_dev_to_prod.py                          # Nur lokal (kein Upload)
    python promote_dev_to_prod.py --deploy-prod            # Lokal + Upload zu /www/maps
    python promote_dev_to_prod.py --dry-run --deploy-prod  # Vorschau ohne Upload-Aenderung
    python promote_dev_to_prod.py --mirror                 # Mit Loeschung von Dateien, die in maps-dev fehlen

@version    1.3
@date       2026-06-02
@copyright  Trigonet AG
@author     Marco Dellenbach
"""
import argparse
import os
import subprocess
import sys

from deploy_env import resolve_deploy_config, ensure_local_base_exists


SCRIPT_DIR = os.path.dirname(__file__)
UPLOAD_CHANGED_SCRIPT = os.path.join(SCRIPT_DIR, "upload_changed.py")


def run_command(command, description):
    """Fuehrt einen Shell-Kommando aus und behandelt Exit-Codes robust."""
    print(f"\n=== {description} ===")
    print(" ".join(command))
    result = subprocess.run(command)
    return result.returncode


def run_robocopy(source_dir, target_dir, dry_run=False, mirror=False, exclude_dirs=None):
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

    if exclude_dirs:
        command.append("/XD")
        command.extend(exclude_dirs)

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


def collect_js_files(root_dir):
    """Sammelt JS-Dateien aus root und root/mobile passend zum TNET-Build."""
    files = []
    if not os.path.isdir(root_dir):
        return files

    for entry in sorted(os.listdir(root_dir)):
        full = os.path.join(root_dir, entry)
        if os.path.isfile(full) and entry.endswith(".js"):
            files.append(full)

    mobile_dir = os.path.join(root_dir, "mobile")
    if os.path.isdir(mobile_dir):
        for entry in sorted(os.listdir(mobile_dir)):
            full = os.path.join(mobile_dir, entry)
            if os.path.isfile(full) and entry.endswith(".js"):
                files.append(full)

    return files


def validate_js_stage(dev_dir):
    """Stellt sicher, dass js-stage fuer alle DEV-Original-JS vorhanden ist."""
    js_source_dir = os.path.normpath(os.path.join(dev_dir, "tnet", "js"))
    js_stage_dir = os.path.normpath(os.path.join(dev_dir, "tnet", "js-stage"))

    if not os.path.isdir(js_source_dir):
        raise RuntimeError(f"JS-Originalverzeichnis nicht gefunden: {js_source_dir}")
    if not os.path.isdir(js_stage_dir):
        raise RuntimeError(
            "JS-Stage fehlt. Fuehre zuerst DEV-Deploy oder Stage-Build aus: "
            f"{js_stage_dir}"
        )

    source_files = collect_js_files(js_source_dir)
    stage_files = collect_js_files(js_stage_dir)
    source_rels = {os.path.relpath(path, js_source_dir).replace(os.sep, "/") for path in source_files}
    stage_rels = {os.path.relpath(path, js_stage_dir).replace(os.sep, "/") for path in stage_files}
    missing = sorted(source_rels - stage_rels)
    extra = sorted(stage_rels - source_rels)

    if missing:
        preview = ", ".join(missing[:5])
        suffix = " ..." if len(missing) > 5 else ""
        raise RuntimeError(f"JS-Stage unvollstaendig ({len(missing)} fehlt): {preview}{suffix}")

    if extra:
        preview = ", ".join(extra[:5])
        suffix = " ..." if len(extra) > 5 else ""
        raise RuntimeError(f"JS-Stage enthaelt unerwartete Datei(en) ({len(extra)}): {preview}{suffix}")

    print(f"JS-Stage OK: {len(stage_files)} Stage-Datei(en), {len(source_files)} Original-Datei(en).")


def promote_js_stage(dev_dir, prod_dir, dry_run=False):
    """Spiegelt DEV-Originale nach js-src und DEV-Stage nach PROD-Runtime js."""
    dev_js_dir = os.path.normpath(os.path.join(dev_dir, "tnet", "js"))
    dev_stage_dir = os.path.normpath(os.path.join(dev_dir, "tnet", "js-stage"))
    prod_js_src_dir = os.path.normpath(os.path.join(prod_dir, "tnet", "js-src"))
    prod_js_dir = os.path.normpath(os.path.join(prod_dir, "tnet", "js"))

    validate_js_stage(dev_dir)

    run_robocopy(
        dev_js_dir,
        prod_js_src_dir,
        dry_run=dry_run,
        mirror=True,
    )
    run_robocopy(
        dev_stage_dir,
        prod_js_dir,
        dry_run=dry_run,
        mirror=True,
    )


def run_prod_deploy(dry_run=False):
    """Fuehrt optional direkt den PROD-Deploy aus."""
    command = [sys.executable, UPLOAD_CHANGED_SCRIPT, "--env", "prod", "--code-only", "--force-js"]
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

    validate_js_stage(dev_dir)

    dev_js_dir = os.path.normpath(os.path.join(dev_dir, "tnet", "js"))
    dev_js_stage_dir = os.path.normpath(os.path.join(dev_dir, "tnet", "js-stage"))
    run_robocopy(
        dev_dir,
        prod_dir,
        dry_run=args.dry_run,
        mirror=args.mirror,
        exclude_dirs=[dev_js_dir, dev_js_stage_dir],
    )

    print("\n=== PROD-JS ueber Stage vorbereiten (js -> js-src, js-stage -> js) ===")
    promote_js_stage(dev_dir, prod_dir, dry_run=args.dry_run)

    if args.deploy_prod:
        run_prod_deploy(dry_run=args.dry_run)

    print("\n[OK] Promotion abgeschlossen")


if __name__ == "__main__":
    main()
