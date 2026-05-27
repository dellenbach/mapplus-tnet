#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
"""
init_core_dev.py
Initialisiert /www/core-dev/ auf dem Server als Kopie von /www/core/.
Die Kopie erfolgt vollstaendig remote-to-remote ueber eine SFTP-Verbindung
(kein lokaler Download noetig).

Verhalten:
  - Standardmaessig werden nur FEHLENDE Dateien kopiert (kein Ueberschreiben)
  - Mit --overwrite werden alle Dateien neu kopiert
  - .bak-Dateien werden uebersprungen
  - Leerverzeichnisse werden angelegt

Aufruf:
  python init_core_dev.py              # Fehlende Dateien kopieren
  python init_core_dev.py --dry-run    # Vorschau
  python init_core_dev.py --overwrite  # Alles neu kopieren
  python init_core_dev.py --yes        # Ohne Rueckfrage

@version    1.0
@date       2026-05-27
@copyright  Trigonet AG
@author     Marco Dellenbach
"""
import os
import sys
import stat
import io
import argparse
import paramiko

# SFTP Config
HOST     = "nwow.mapplus.ch"
PORT     = 22
USER     = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"

SRC_ROOT = "/www/core"
DST_ROOT = "/www/core-dev"

SKIP_EXTENSIONS = (".bak",)


# ─── SFTP-Hilfsfunktionen ──────────────────────────────────────────────────────

def remote_exists(sftp, path):
    try:
        sftp.stat(path)
        return True
    except IOError:
        return False


def ensure_remote_dir(sftp, path):
    """Erstellt ein Remote-Verzeichnis und alle fehlenden Elternverzeichnisse."""
    parts = path.rstrip("/").split("/")
    current = ""
    for part in parts:
        if not part:
            continue
        current = f"{current}/{part}"
        try:
            sftp.stat(current)
        except IOError:
            try:
                sftp.mkdir(current)
            except IOError:
                pass  # parallel race oder bereits vorhanden


def remote_copy(sftp, src, dst):
    """Kopiert eine Datei remote-to-remote via RAM-Puffer."""
    buf = io.BytesIO()
    sftp.getfo(src, buf)
    buf.seek(0)
    sftp.putfo(buf, dst)


def walk_remote(sftp, base):
    """
    Liefert alle Dateien unterhalb von base als Liste von (remote_path, size).
    Rekursiv, alphabetisch sortiert, versteckte Eintraege uebersprungen.
    """
    result = []
    try:
        entries = sftp.listdir_attr(base)
    except IOError as e:
        print(f"[ERR] Kann {base} nicht lesen: {e}")
        return result

    for entry in sorted(entries, key=lambda e: e.filename):
        if entry.filename.startswith("."):
            continue
        full = f"{base}/{entry.filename}"
        if stat.S_ISDIR(entry.st_mode):
            result.extend(walk_remote(sftp, full))
        elif stat.S_ISREG(entry.st_mode):
            _, ext = os.path.splitext(entry.filename)
            if ext.lower() in SKIP_EXTENSIONS:
                continue
            result.append((full, entry.st_size))

    return result


# ─── Hauptlogik ───────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description=(
            f"Initialisiert {DST_ROOT}/ als Kopie von {SRC_ROOT}/.\n"
            "Standard: nur fehlende Dateien kopieren."
        )
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Alle Dateien kopieren, auch bereits vorhandene",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Nur anzeigen, nichts veraendern",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Ohne Rueckfrage durchfuehren",
    )
    args = parser.parse_args()

    mode = "OVERWRITE" if args.overwrite else "NUR FEHLENDE"

    print()
    print("=" * 60)
    print("  INIT CORE-DEV  (einmalige Server-Operation)")
    print(f"  Quelle:  {SRC_ROOT}/")
    print(f"  Ziel:    {DST_ROOT}/")
    print(f"  Modus:   {mode}")
    if args.dry_run:
        print("  DRY-RUN: keine Aenderungen")
    print("=" * 60)
    print()

    print(f"Verbinde zu {HOST} ...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        ssh.connect(HOST, PORT, USER, PASSWORD)
        sftp = ssh.open_sftp()
    except Exception as e:
        print(f"[ERR] Verbindung fehlgeschlagen: {e}")
        sys.exit(1)

    # ── Quelle pruefen ────────────────────────────────────────────────────────
    if not remote_exists(sftp, SRC_ROOT):
        print(f"[ERR] Quellverzeichnis nicht gefunden: {SRC_ROOT}")
        sftp.close(); ssh.close()
        sys.exit(1)

    # ── Ziel-Status feststellen ───────────────────────────────────────────────
    dst_exists = remote_exists(sftp, DST_ROOT)
    if dst_exists:
        print(f"[INFO] {DST_ROOT}/ existiert bereits auf dem Server.")
        if not args.overwrite:
            print("       Modus: nur fehlende Dateien werden ergaenzt.")
            print("       (--overwrite fuer Vollkopie)")
    else:
        print(f"[INFO] {DST_ROOT}/ existiert noch nicht — wird neu angelegt.")

    # ── Quelldateien einlesen ─────────────────────────────────────────────────
    print(f"\nLese {SRC_ROOT}/ ...")
    src_files = walk_remote(sftp, SRC_ROOT)

    if not src_files:
        print("[WARN] Keine Dateien in Quelle gefunden.")
        sftp.close(); ssh.close()
        sys.exit(0)

    total_size = sum(s for _, s in src_files)
    print(f"{len(src_files)} Datei(en) gefunden  "
          f"({total_size / 1024 / 1024:.1f} MB gesamt)\n")

    # ── Planen: was wird kopiert, was uebersprungen ───────────────────────────
    to_copy   = []
    to_skip   = []

    for src_path, size in src_files:
        rel      = src_path[len(SRC_ROOT):]   # z.B. /config/layers_tnet.conf
        dst_path = DST_ROOT + rel

        if args.overwrite or not remote_exists(sftp, dst_path):
            to_copy.append((src_path, dst_path, size, rel))
        else:
            to_skip.append((rel, size))

    # ── Plan anzeigen ─────────────────────────────────────────────────────────
    if to_skip:
        print(f"[=] {len(to_skip)} Datei(en) bereits vorhanden (wird uebersprungen):")
        for rel, size in to_skip:
            print(f"      = {rel}  ({size:,} bytes)")
        print()

    if not to_copy:
        print("[OK] Nichts zu tun — alle Dateien bereits vorhanden.")
        sftp.close(); ssh.close()
        sys.exit(0)

    print(f"[+] {len(to_copy)} Datei(en) werden kopiert:")
    for src_path, dst_path, size, rel in to_copy:
        print(f"      + {rel}  ({size:,} bytes)")

    if args.dry_run:
        print(f"\n[DRY-RUN] {len(to_copy)} Datei(en) wuerden kopiert.")
        sftp.close(); ssh.close()
        sys.exit(0)

    # ── Bestaetigung ─────────────────────────────────────────────────────────
    print()
    if not args.yes:
        try:
            answer = input(
                f"[?] {len(to_copy)} Datei(en) von {SRC_ROOT}/ nach {DST_ROOT}/ kopieren? (j/n): "
            ).strip().lower()
        except EOFError:
            answer = ""
        if answer != "j":
            print("[ABBRUCH]")
            sftp.close(); ssh.close()
            sys.exit(0)

    # ── Kopieren ──────────────────────────────────────────────────────────────
    print()
    copied = 0
    errors = 0

    for src_path, dst_path, size, rel in to_copy:
        dst_dir = dst_path.rsplit("/", 1)[0]
        ensure_remote_dir(sftp, dst_dir)

        try:
            remote_copy(sftp, src_path, dst_path)
            print(f"  [OK] {rel}  ({size:,} bytes)")
            copied += 1
        except Exception as e:
            print(f"  [ERR] {rel}  -- {e}")
            errors += 1

    sftp.close()
    ssh.close()

    print()
    print("=" * 60)
    print(f"  Kopiert:     {copied}")
    print(f"  Uebersprungen: {len(to_skip)}")
    print(f"  Fehler:      {errors}")
    print("=" * 60)

    if errors:
        sys.exit(1)

    if copied > 0:
        print()
        print(f"[OK] {DST_ROOT}/ ist einsatzbereit.")
        print(f"     DEV-Anfragen (/maps-dev/) nutzen ab sofort /www/core-dev/")
        print(f"     SLM (target=dev) schreibt nach /www/core-dev/config+nls")


if __name__ == "__main__":
    main()
