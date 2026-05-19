#!/usr/bin/env python3
"""
_deploy_staging_to_core.py
Kopiert Konfigurationsdateien vom Staging-Bereich (ImportToCore) in die
produktiven Core-Verzeichnisse auf dem Server via SFTP.

Hintergrund: Die PHP-API (config-export-to-core) kann wegen Berechtigungen
nicht von /data/tmp/maps/ImportToCore/ nach /www/maps/core/ kopieren. Dieses
Skript nutzt den SFTP-User 'trigonet', der die nötigen Rechte hat.

WICHTIG: Der Server erlaubt NUR SFTP, keine SSH-Shell-Befehle.
Der SFTP-User sieht /data/tmp/... (nicht /data/Client_Data/nwow/tmp/...).
Dateien können in Unterordnern der Kürzel-Verzeichnisse liegen und
werden flach ins Zielverzeichnis kopiert.

Ablauf:
    1. Staging-Verzeichnis /data/tmp/maps/ImportToCore/<kuerzel>/ rekursiv lesen
  2. Dateien nach Prefix routen:
     - layers_*, maptips_*        → /www/maps/core/config/
     - lyrmgrResources_*, etc.    → /www/maps/core/nls/de/
  3. Bestehende Zieldatei sichern (.YYYYMMDD_HHMMSS.bak)
  4. Staging-Datei via SFTP-Download/Upload ans Ziel kopieren

Aufruf:
  py _scripts/_deploy_staging_to_core.py <kuerzel>
  py _scripts/_deploy_staging_to_core.py --list
  py _scripts/_deploy_staging_to_core.py --all
  py _scripts/_deploy_staging_to_core.py <kuerzel> --dry-run
  py _scripts/_deploy_staging_to_core.py <kuerzel> --no-backup

@version    2.0
@date       2026-03-01
@copyright  Trigonet AG
@author     Marco Dellenbach
"""

import sys
import os
import stat
import io
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

# SFTP-Pfade (aus Sicht des SFTP-Users — NICHT der PHP-Pfad!)
# PHP sieht:  /data/Client_Data/nwow/tmp/maps/ImportToCore
# SFTP sieht: /data/tmp/maps/ImportToCore
STAGING_BASE    = "/data/tmp/maps/ImportToCore"
CORE_CONFIG_DIR = "/www/core/config"
CORE_NLS_DIR    = "/www/core/nls/de"
BACKUP_DIR      = "/data/tmp/maps/deploy-backups"  # Backups separat, nicht in core/config oder core/nls/de

# Prefix → Zielverzeichnis
PREFIX_ROUTING = {
    "layers":             CORE_CONFIG_DIR,
    "maptips":            CORE_CONFIG_DIR,
    "lyrmgrResources":    CORE_NLS_DIR,
    "maptipsResources":   CORE_NLS_DIR,
    "legendResources":    CORE_NLS_DIR,
}

# Erlaubte Dateiendungen
ALLOWED_EXTENSIONS = {".conf", ".json"}


# ===== HILFSFUNKTIONEN =====

def get_prefix(filename):
    """Ermittelt den Prefix einer Konfigurationsdatei.
    Unterstützt sowohl '_' als auch '-' als Separator (Core-Dateien nutzen '-')."""
    # layers_gis_basis.conf → layers
    # lyrmgrResources-oereb-wms_oereb-wms.json → lyrmgrResources
    for prefix in PREFIX_ROUTING:
        if filename.startswith(prefix + "_") or filename.startswith(prefix + "-"):
            return prefix
    return None


def remote_exists(sftp, path):
    """Prüft ob ein Remote-Pfad existiert."""
    try:
        sftp.stat(path)
        return True
    except IOError:
        return False


def remote_copy_via_sftp(sftp, src, dst):
    """Kopiert eine Datei remote-to-remote via SFTP (Download in RAM, Upload).
    Nötig weil der Server keine SSH-Shell-Befehle erlaubt."""
    buf = io.BytesIO()
    sftp.getfo(src, buf)
    buf.seek(0)
    sftp.putfo(buf, dst)


def format_size(size):
    """Formatiert Dateigrösse lesbar."""
    if size < 1024:
        return f"{size} B"
    elif size < 1024 * 1024:
        return f"{size / 1024:.1f} KB"
    else:
        return f"{size / (1024 * 1024):.1f} MB"


def find_files_recursive(sftp, base_dir, staging_dir):
    """Sucht rekursiv nach deploybare Dateien in einem Verzeichnis.
    Gibt Liste von dicts zurück mit name, src_path, prefix, size, target_dir."""
    files = []

    try:
        entries = sftp.listdir_attr(base_dir)
    except IOError:
        return files

    for entry in entries:
        if entry.filename.startswith('.'):
            continue

        full_path = f"{base_dir}/{entry.filename}"

        # Rekursiv in Unterordner
        if stat.S_ISDIR(entry.st_mode):
            files.extend(find_files_recursive(sftp, full_path, staging_dir))
            continue

        # Reguläre Datei prüfen
        if not stat.S_ISREG(entry.st_mode):
            continue

        _, ext = os.path.splitext(entry.filename)
        if ext.lower() not in ALLOWED_EXTENSIONS:
            continue

        prefix = get_prefix(entry.filename)
        if prefix is None:
            continue

        files.append({
            'name':       entry.filename,
            'src_path':   full_path,
            'prefix':     prefix,
            'size':       entry.st_size,
            'target_dir': PREFIX_ROUTING[prefix],
        })

    return files


# ===== HAUPTLOGIK =====

def list_staging_kuerzel(sftp):
    """Listet alle verfügbaren Kürzel im Staging-Bereich."""
    try:
        entries = sftp.listdir_attr(STAGING_BASE)
    except IOError:
        print(f"  ✗ Staging-Verzeichnis nicht gefunden: {STAGING_BASE}")
        return []

    dirs = []
    for entry in entries:
        if stat.S_ISDIR(entry.st_mode) and not entry.filename.startswith('.'):
            dirs.append(entry.filename)

    dirs.sort()
    return dirs


def list_staging_files(sftp, kuerzel):
    """Listet alle deploybare Dateien eines Kürzels im Staging (rekursiv).
    Dateien können in Unterordnern liegen — im Ziel werden sie flach abgelegt."""
    staging_dir = f"{STAGING_BASE}/{kuerzel}"

    # Rekursiv alle passenden Dateien finden
    all_files = find_files_recursive(sftp, staging_dir, staging_dir)

    # Duplikat-Erkennung (gleicher Dateiname in versch. Unterordnern)
    seen_names = set()
    unique_files = []
    for f in all_files:
        if f['name'] in seen_names:
            rel = f['src_path'].replace(staging_dir + '/', '')
            print(f"  ⚠ Duplikat übersprungen: {rel} (bereits aus anderem Unterordner)")
            continue
        seen_names.add(f['name'])
        unique_files.append(f)

    unique_files.sort(key=lambda f: f['name'])
    return unique_files


def deploy_kuerzel(sftp, kuerzel, dry_run=False, no_backup=False):
    """Deployed alle Staging-Dateien eines Kürzels in die Core-Verzeichnisse.
    Staging-Dateien können in Unterordnern liegen — werden flach ins Ziel kopiert."""
    staging_dir = f"{STAGING_BASE}/{kuerzel}"
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')

    print(f"\n{'═' * 60}")
    print(f"  Kürzel: {kuerzel}")
    print(f"  Quelle: {staging_dir}")
    if dry_run:
        print(f"  Modus:  DRY-RUN (keine Änderungen)")
    print(f"{'═' * 60}")

    # Staging-Dateien ermitteln (rekursiv)
    files = list_staging_files(sftp, kuerzel)
    if not files:
        print(f"  ⚠ Keine deploybare Dateien gefunden in {staging_dir}")
        return 0, 0, 0

    deployed = 0
    skipped  = 0
    errors   = 0

    for f in files:
        src_path    = f['src_path']  # Voller Pfad (kann in Unterordner sein)
        target_path = f"{f['target_dir']}/{f['name']}"  # Flach im Ziel
        size_str    = format_size(f['size'])

        # Unterordner-Info anzeigen falls nicht direkt im Kürzel-Ordner
        rel_src = src_path.replace(staging_dir + '/', '')
        has_subdir = '/' in rel_src

        # Zielverzeichnis prüfen
        if not remote_exists(sftp, f['target_dir']):
            print(f"  ✗ {f['name']} — Zielverzeichnis fehlt: {f['target_dir']}")
            errors += 1
            continue

        # Status der bestehenden Datei
        exists = remote_exists(sftp, target_path)
        if exists:
            try:
                existing_stat = sftp.stat(target_path)
                existing_size = format_size(existing_stat.st_size)
                status = f"überschreiben ({existing_size} → {size_str})"
            except IOError:
                status = f"neu ({size_str})"
        else:
            status = f"neu ({size_str})"

        if dry_run:
            action = "→ " + f['target_dir'].replace("/www/maps/", "")
            src_info = f"  [{rel_src}]" if has_subdir else ""
            print(f"  ○ {f['name']:45s} {action:30s} [{status}]{src_info}")
            deployed += 1
            continue

        # Backup erstellen (in separatem Verzeichnis, nicht neben den Config-Dateien)
        if exists and not no_backup:
            backup_subdir = f"{BACKUP_DIR}/{kuerzel}/{ts}"
            try:
                # Backup-Verzeichnis erstellen (rekursiv)
                for d in [BACKUP_DIR, f"{BACKUP_DIR}/{kuerzel}", backup_subdir]:
                    if not remote_exists(sftp, d):
                        sftp.mkdir(d)
                backup_path = f"{backup_subdir}/{f['name']}"
                remote_copy_via_sftp(sftp, target_path, backup_path)
            except Exception as e:
                print(f"  ⚠ Backup fehlgeschlagen für {f['name']}: {e}")
                # Trotzdem weiterfahren

        # Datei kopieren (Staging → Core via SFTP-Download/Upload)
        try:
            remote_copy_via_sftp(sftp, src_path, target_path)
            action = "→ " + f['target_dir'].replace("/www/maps/", "")
            src_info = f"  [{rel_src}]" if has_subdir else ""
            print(f"  ✓ {f['name']:45s} {action:30s} [{size_str}]{src_info}")
            deployed += 1
        except Exception as e:
            print(f"  ✗ {f['name']:45s} Fehler: {e}")
            errors += 1

    print(f"\n  Resultat: {deployed} deployed, {skipped} übersprungen, {errors} Fehler")
    return deployed, skipped, errors


# ===== CLI =====

def main():
    parser = argparse.ArgumentParser(
        description="Kopiert Staging-Konfigurationen (ImportToCore) in die produktiven Core-Verzeichnisse via SFTP.",
        epilog="Beispiele:\n"
               "  py _scripts/_deploy_staging_to_core.py --list\n"
               "  py _scripts/_deploy_staging_to_core.py gis_basis --dry-run\n"
               "  py _scripts/_deploy_staging_to_core.py gis_basis\n"
               "  py _scripts/_deploy_staging_to_core.py --all\n",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument('kuerzel', nargs='?', default=None,
                        help='Kürzel des Staging-Verzeichnisses (z.B. gis_basis, ewn, awu)')
    parser.add_argument('--list', action='store_true',
                        help='Alle verfügbaren Kürzel im Staging auflisten')
    parser.add_argument('--all', action='store_true',
                        help='Alle Kürzel auf einmal deployen')
    parser.add_argument('--dry-run', action='store_true',
                        help='Nur anzeigen was passieren würde, ohne Änderungen')
    parser.add_argument('--no-backup', action='store_true',
                        help='Keine Backups der bestehenden Dateien erstellen')

    args = parser.parse_args()

    if not args.list and not args.all and args.kuerzel is None:
        parser.print_help()
        sys.exit(1)

    # Verbinden
    print(f"Verbinde zu {HOST}:{PORT} als {USER}...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        ssh.connect(HOST, PORT, USER, PASSWORD, timeout=15)
        sftp = ssh.open_sftp()
        print(f"  ✓ Verbunden\n")
    except Exception as e:
        print(f"  ✗ Verbindungsfehler: {e}")
        sys.exit(1)

    try:

        # --list: Kürzel auflisten
        if args.list:
            kuerzel_list = list_staging_kuerzel(sftp)
            if not kuerzel_list:
                print("  Keine Kürzel im Staging gefunden.")
                return

            print(f"Verfügbare Kürzel in {STAGING_BASE}:\n")
            for k in kuerzel_list:
                files = list_staging_files(sftp, k)
                total_size = sum(f['size'] for f in files)
                prefixes = sorted(set(f['prefix'] for f in files))
                print(f"  {k:30s} {len(files):3d} Dateien  ({format_size(total_size):>8s})  [{', '.join(prefixes)}]")

            print(f"\nTotal: {len(kuerzel_list)} Kürzel")
            return

        # --all: Alle Kürzel deployen
        if args.all:
            kuerzel_list = list_staging_kuerzel(sftp)
            if not kuerzel_list:
                print("  Keine Kürzel im Staging gefunden.")
                return

            if not args.dry_run:
                print(f"⚠ ACHTUNG: {len(kuerzel_list)} Kürzel werden deployed!")
                print(f"  Kürzel: {', '.join(kuerzel_list)}")
                confirm = input("\n  Fortfahren? (j/N): ").strip().lower()
                if confirm not in ('j', 'ja', 'y', 'yes'):
                    print("  Abgebrochen.")
                    return

            total_deployed = 0
            total_errors = 0
            for k in kuerzel_list:
                d, s, e = deploy_kuerzel(sftp, k,
                                         dry_run=args.dry_run,
                                         no_backup=args.no_backup)
                total_deployed += d
                total_errors += e

            print(f"\n{'═' * 60}")
            print(f"  GESAMT: {total_deployed} deployed, {total_errors} Fehler")
            print(f"{'═' * 60}")
            return

        # Einzelnes Kürzel deployen
        kuerzel = args.kuerzel
        staging_dir = f"{STAGING_BASE}/{kuerzel}"

        if not remote_exists(sftp, staging_dir):
            print(f"  ✗ Kürzel '{kuerzel}' nicht gefunden in {STAGING_BASE}")
            print(f"\n  Verfügbare Kürzel:")
            for k in list_staging_kuerzel(sftp):
                print(f"    - {k}")
            sys.exit(1)

        deploy_kuerzel(sftp, kuerzel,
                       dry_run=args.dry_run,
                       no_backup=args.no_backup)

    finally:
        sftp.close()
        ssh.close()
        print(f"\n✓ Verbindung geschlossen.")


if __name__ == "__main__":
    main()
