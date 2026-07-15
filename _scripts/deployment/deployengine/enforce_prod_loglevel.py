#!/usr/bin/env python3
"""
enforce_prod_loglevel.py
Setzt in der PROD-App-Konfiguration den globalen logLevel auf 'warn'.

Aufruf:
    python enforce_prod_loglevel.py
    python enforce_prod_loglevel.py --dry-run
    python enforce_prod_loglevel.py --config maps/tnet/config/tnet-global-config.json5

@version    1.0
@date       2026-07-07
@copyright  Trigonet AG
@author     Marco Dellenbach
"""
import argparse
import os
import re
import sys


LOGLEVEL_PATTERN = re.compile(
    r"^(\s*logLevel\s*:\s*)(['\"])([^'\"]+)(['\"])(\s*,?.*)$",
    re.MULTILINE,
)


def enforce_warn(content):
    """Setzt den ersten gefundenen logLevel-Eintrag auf 'warn'."""
    match = LOGLEVEL_PATTERN.search(content)
    if not match:
        return None, None, None

    old_value = match.group(3)
    new_line = f"{match.group(1)}{match.group(2)}warn{match.group(4)}{match.group(5)}"
    new_content = content[:match.start()] + new_line + content[match.end():]
    return new_content, old_value, "warn"


def main():
    parser = argparse.ArgumentParser(
        description="Setzt logLevel in tnet-global-config.json5 fuer PROD auf warn"
    )
    parser.add_argument(
        "--config",
        default=os.path.join("maps", "tnet", "config", "tnet-global-config.json5"),
        help="Pfad zur JSON5-Konfiguration (Standard: maps/tnet/config/tnet-global-config.json5)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Nur anzeigen, keine Datei schreiben",
    )
    args = parser.parse_args()

    config_path = os.path.normpath(args.config)
    if not os.path.isfile(config_path):
        print(f"[FEHLER] Konfigurationsdatei nicht gefunden: {config_path}")
        return 1

    with open(config_path, "r", encoding="utf-8-sig") as f:
        original = f.read()

    updated, old_value, new_value = enforce_warn(original)
    if updated is None:
        print(f"[FEHLER] Kein logLevel-Eintrag gefunden in: {config_path}")
        return 1

    if old_value == new_value:
        mode = "DRY-RUN" if args.dry_run else "LIVE"
        print(f"[OK] logLevel bereits auf '{new_value}' ({mode}): {config_path}")
        return 0

    if args.dry_run:
        print(f"[INFO] DRY-RUN: logLevel wuerde angepasst: {old_value} -> {new_value}")
        print(f"       Datei: {config_path}")
        return 0

    with open(config_path, "w", encoding="utf-8", newline="") as f:
        f.write(updated)

    print(f"[OK] logLevel angepasst: {old_value} -> {new_value}")
    print(f"     Datei: {config_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
