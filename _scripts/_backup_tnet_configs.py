#!/usr/bin/env python3
"""
_backup_tnet_configs.py
Verschiebt alle TNET-Konfigurationsdateien (layers_TNET_*, maptips_TNET_*,
lyrmgrResources_TNET_*, maptipsResources_TNET_*, legendResources_TNET_*)
in einen _bak-Unterordner im jeweiligen Verzeichnis.

Hintergrund: Nach dem Staging-Merge werden die alten Einzel-Dienst-Dateien
(z.B. layers_TNET_ewn_EWN_NIS.conf) durch zusammengeführte Dateien
(z.B. layers_ewn.conf) ersetzt. Die alten TNET-Dateien sollen aufgeräumt
werden, aber nicht gelöscht — daher Verschiebung nach _bak/.

Ablauf:
  1. core/config/ → alle layers_TNET_*.conf, maptips_TNET_*.conf → core/config/_bak/
  2. core/nls/de/ → alle *Resources_TNET_*.json → core/nls/de/_bak/

Aufruf:
  py _scripts/_backup_tnet_configs.py --dry-run
  py _scripts/_backup_tnet_configs.py
  py _scripts/_backup_tnet_configs.py --restore   (verschiebt zurück)

@version    1.0
@date       2026-03-01
@copyright  Trigonet AG
@author     Marco Dellenbach
"""

import sys
import stat
import argparse
from datetime import datetime

try:
    import paramiko
except ImportError:
    print("Fehler: paramiko nicht installiert. → pip install paramiko")
    sys.exit(1)


# ===== KONFIGURATION =====

HOST = "nwow.mapplus.ch"
PORT = 22
USER = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"

BAK_DIR_NAME = "_bak"

# Verzeichnisse auf dem Server
DIRECTORIES = [
    {
        "path":     "/www/core/config",
        "label":    "core/config"
    },
    {
        "path":     "/www/core/nls/de",
        "label":    "core/nls/de"
    }
]


# ===== HILFSFUNKTIONEN =====

def remote_exists(sftp, path):
    """Prüft ob ein Remote-Pfad existiert."""
    try:
        sftp.stat(path)
        return True
    except IOError:
        return False


def ensure_remote_dir(sftp, path):
    """Erstellt Remote-Verzeichnis rekursiv falls nicht vorhanden (reines SFTP)."""
    parts = path.split('/')
    current = ''
    for part in parts:
        if not part:
            current = '/'
            continue
        current = current.rstrip('/') + '/' + part
        if not remote_exists(sftp, current):
            sftp.mkdir(current)


def remote_move(sftp, src, dst):
    """Verschiebt eine Datei remote via SFTP rename."""
    sftp.rename(src, dst)


def format_size(size):
    """Formatiert Dateigrösse lesbar."""
    if size < 1024:
        return f"{size} B"
    elif size < 1024 * 1024:
        return f"{size / 1024:.1f} KB"
    else:
        return f"{size / (1024 * 1024):.1f} MB"


def find_tnet_files(sftp, directory):
    """Findet alle TNET-Dateien in einem Verzeichnis (Substring-Match auf 'TNET')."""
    try:
        entries = sftp.listdir_attr(directory)
    except IOError:
        return []

    matches = []
    for entry in entries:
        name = entry.filename
        # Nur reguläre Dateien (keine Verzeichnisse, kein _bak-Ordner)
        if name.startswith('.') or name == BAK_DIR_NAME:
            continue
        if stat.S_ISDIR(entry.st_mode):
            continue
        # Alle Dateien mit 'TNET' im Namen
        if 'TNET' in name:
            matches.append({
                'name': name,
                'size': entry.st_size,
                'path': f"{directory}/{name}"
            })

    matches.sort(key=lambda f: f['name'])
    return matches


def find_bak_files(sftp, bak_dir):
    """Findet alle Dateien im _bak-Verzeichnis."""
    try:
        entries = sftp.listdir_attr(bak_dir)
    except IOError:
        return []

    files = []
    for entry in entries:
        if entry.filename.startswith('.'):
            continue
        files.append({
            'name': entry.filename,
            'size': entry.st_size,
            'path': f"{bak_dir}/{entry.filename}"
        })

    files.sort(key=lambda f: f['name'])
    return files


# ===== HAUPTLOGIK =====

def backup_tnet_files(sftp, dry_run=False):
    """Verschiebt alle TNET-Dateien in _bak/<zeitstempel>/ Unterordner."""
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    total_moved = 0
    total_errors = 0

    for dirinfo in DIRECTORIES:
        directory = dirinfo['path']
        label     = dirinfo['label']
        bak_dir   = f"{directory}/{BAK_DIR_NAME}/{ts}"

        print(f"\n{'─' * 60}")
        print(f"  Verzeichnis: {label}")
        print(f"  Filter:      *TNET*")
        print(f"  Backup nach: {label}/{BAK_DIR_NAME}/{ts}/")
        print(f"{'─' * 60}")

        # TNET-Dateien finden
        files = find_tnet_files(sftp, directory)
        if not files:
            print(f"  (keine TNET-Dateien gefunden)")
            continue

        total_size = sum(f['size'] for f in files)
        print(f"  Gefunden: {len(files)} Dateien ({format_size(total_size)})\n")

        if not dry_run:
            ensure_remote_dir(sftp, bak_dir)

        for f in files:
            src = f['path']
            dst = f"{bak_dir}/{f['name']}"

            if dry_run:
                print(f"  ○ {f['name']:55s} ({format_size(f['size']):>8s})")
                total_moved += 1
                continue

            try:
                remote_move(sftp, src, dst)
                print(f"  ✓ {f['name']:55s} ({format_size(f['size']):>8s})")
                total_moved += 1
            except Exception as e:
                print(f"  ✗ {f['name']:55s} Fehler: {e}")
                total_errors += 1

    return total_moved, total_errors


def list_backups(sftp):
    """Listet alle vorhandenen Backup-Zeitstempel in _bak/."""
    print(f"\nVorhandene Backups:")
    found = False
    for dirinfo in DIRECTORIES:
        directory = dirinfo['path']
        label     = dirinfo['label']
        bak_base  = f"{directory}/{BAK_DIR_NAME}"
        try:
            entries = sftp.listdir_attr(bak_base)
        except IOError:
            continue
        ts_dirs = [e for e in entries
                   if not e.filename.startswith('.')
                   and stat.S_ISDIR(e.st_mode)]
        ts_dirs.sort(key=lambda e: e.filename, reverse=True)
        if ts_dirs:
            found = True
            print(f"\n  {label}/{BAK_DIR_NAME}/")
            for td in ts_dirs:
                sub_files = find_bak_files(sftp, f"{bak_base}/{td.filename}")
                total_size = sum(f['size'] for f in sub_files)
                print(f"    {td.filename:20s} {len(sub_files):4d} Dateien  ({format_size(total_size):>8s})")
    if not found:
        print("  (keine Backups gefunden)")


def restore_tnet_files(sftp, ts_name, dry_run=False):
    """Verschiebt alle Dateien aus _bak/<zeitstempel>/ zurück."""
    total_moved = 0
    total_errors = 0

    for dirinfo in DIRECTORIES:
        directory = dirinfo['path']
        label     = dirinfo['label']
        bak_dir   = f"{directory}/{BAK_DIR_NAME}/{ts_name}"

        print(f"\n{'─' * 60}")
        print(f"  Wiederherstellen: {label}/{BAK_DIR_NAME}/{ts_name}/ → {label}/")
        print(f"{'─' * 60}")

        files = find_bak_files(sftp, bak_dir)
        if not files:
            print(f"  (keine Dateien in {BAK_DIR_NAME}/{ts_name}/ gefunden)")
            continue

        total_size = sum(f['size'] for f in files)
        print(f"  Gefunden: {len(files)} Dateien ({format_size(total_size)})\n")

        for f in files:
            src = f['path']
            dst = f"{directory}/{f['name']}"

            # Prüfe ob Ziel schon existiert
            if remote_exists(sftp, dst):
                print(f"  ⚠ {f['name']:55s} existiert bereits im Zielordner → übersprungen")
                continue

            if dry_run:
                print(f"  ○ {f['name']:55s} ({format_size(f['size']):>8s})")
                total_moved += 1
                continue

            try:
                remote_move(sftp, src, dst)
                print(f"  ✓ {f['name']:55s} ({format_size(f['size']):>8s})")
                total_moved += 1
            except Exception as e:
                print(f"  ✗ {f['name']:55s} Fehler: {e}")
                total_errors += 1

    return total_moved, total_errors


# ===== CLI =====

def main():
    parser = argparse.ArgumentParser(
        description="Verschiebt alle TNET-Konfigurationsdateien in einen zeitgestempelten _bak-Unterordner (oder zurück).",
        epilog="Beispiele:\n"
               "  py _scripts/_backup_tnet_configs.py --dry-run\n"
               "  py _scripts/_backup_tnet_configs.py\n"
               "  py _scripts/_backup_tnet_configs.py --list-backups\n"
               "  py _scripts/_backup_tnet_configs.py --restore 20260301_143000\n"
               "  py _scripts/_backup_tnet_configs.py --restore 20260301_143000 --dry-run\n",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument('--dry-run', action='store_true',
                        help='Nur anzeigen was passieren würde, ohne Änderungen')
    parser.add_argument('--restore', metavar='ZEITSTEMPEL',
                        help='Dateien aus _bak/<zeitstempel>/ zurückholen (z.B. 20260301_143000)')
    parser.add_argument('--list-backups', action='store_true',
                        help='Alle vorhandenen Backup-Zeitstempel auflisten')

    args = parser.parse_args()

    action = "Wiederherstellen" if args.restore else "Backup"

    # Verbinden
    print(f"Verbinde zu {HOST}:{PORT} als {USER}...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        ssh.connect(HOST, PORT, USER, PASSWORD, timeout=15)
        sftp = ssh.open_sftp()
        print(f"  ✓ Verbunden")
    except Exception as e:
        print(f"  ✗ Verbindungsfehler: {e}")
        sys.exit(1)

    try:
        # --list-backups: Nur Backup-Verzeichnisse auflisten
        if args.list_backups:
            list_backups(sftp)
            return

        if args.dry_run:
            print(f"\n  Modus: DRY-RUN — {action} (keine Änderungen)")

        if args.restore:
            moved, errors = restore_tnet_files(sftp, args.restore, dry_run=args.dry_run)
        else:
            # Sicherheitsabfrage bei echtem Backup
            if not args.dry_run:
                # Zuerst Dateien zählen
                total_count = 0
                for dirinfo in DIRECTORIES:
                    files = find_tnet_files(sftp, dirinfo['path'])
                    total_count += len(files)

                if total_count == 0:
                    print("\n  Keine TNET-Dateien gefunden. Nichts zu tun.")
                    return

                print(f"\n  ⚠ {total_count} TNET-Dateien werden nach {BAK_DIR_NAME}/<zeitstempel>/ verschoben!")
                confirm = input("  Fortfahren? (j/N): ").strip().lower()
                if confirm not in ('j', 'ja', 'y', 'yes'):
                    print("  Abgebrochen.")
                    return

            moved, errors = backup_tnet_files(sftp, dry_run=args.dry_run)

        # Zusammenfassung
        print(f"\n{'═' * 60}")
        verb = "würden verschoben" if args.dry_run else "verschoben"
        print(f"  {action}: {moved} Dateien {verb}, {errors} Fehler")
        print(f"{'═' * 60}")

    finally:
        sftp.close()
        ssh.close()
        print(f"\n✓ Verbindung geschlossen.")


if __name__ == "__main__":
    main()
