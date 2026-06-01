#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
"""
upload_changed.py
Geaenderte Dateien unter maps/ bzw. maps-dev/ per SFTP hochladen.
Erkennung via mtime-State-Datei — unabhaengig von git.
Nach erfolgreichem Upload wird ein Hash-State der Quelldatei gespeichert.
DEV laedt lesbare JS direkt aus tnet/js/. PROD laedt finale Build-Artefakte aus tnet/js/;
tnet/js-dev/ und tnet/js_ori/ werden nicht direkt hochgeladen.

@version    2.5
@date       2026-06-01
@copyright  Trigonet AG
@author     Marco Dellenbach
"""
import os
import subprocess
import json
import argparse
import hashlib
import paramiko
from deploy_env import add_env_argument, ensure_local_base_exists, resolve_deploy_config

# ===== KONFIGURATION =====
BUILD_SCRIPT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "build", "build_js.py"))
LOCAL_BASE   = ""
STATE_FILE   = ""

HOST         = "nwow.mapplus.ch"
PORT         = 22
USER         = "trigonet"
PASSWORD     = "3Zs,k4%Un,<[W(Kx"
REMOTE_BASE  = ""

# Verzeichnisse die nie direkt hochgeladen werden duerfen
BLOCKED_DIRS = ["tnet/js-dev/", "tnet\\js-dev\\", "tnet/js_ori/", "tnet\\js_ori\\"]

# Konfigurationsdateien sind API/Git-only und duerfen NICHT versehentlich per FTP deployt werden.
# Explizite Ausnahme nur via --allow-config --reason "...".
PROTECTED_EXTENSIONS = (".conf", ".json", ".json5")
PROTECTED_PREFIXES = (
    "core/config/",
    "core/nls/",
    "public/config/",
    "tnet/config/",
)
CODE_ONLY_EXTENSIONS = {".php", ".js", ".html", ".htm"}
SKIP_FILE_NAMES = {"db_config.php"}
LEGACY_STATE_RECHECK_KEYS = {"index.php"}


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


def hash_file(path):
    """Berechnet einen SHA256-Hash fuer robuste Change-Erkennung."""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def make_state_entry(path):
    """Erzeugt einen Upload-State-Eintrag fuer eine Datei."""
    return {
        "mtime": get_mtime(path),
        "sha256": hash_file(path),
    }


def has_file_changed(path, key, state):
    """Prueft Aenderungen hashbasiert; alte mtime-only States bleiben kompatibel."""
    if key not in state:
        return True

    entry = state[key]
    if not isinstance(entry, dict) or "sha256" not in entry:
        try:
            old_mtime = float(entry)
        except Exception:
            return True
        current_mtime = get_mtime(path)
        return current_mtime > old_mtime or (
            key in LEGACY_STATE_RECHECK_KEYS and abs(current_mtime - old_mtime) < 0.001
        )

    return hash_file(path) != entry.get("sha256")


def is_protected_config(rel_path):
    """Prueft, ob eine Datei unter geschuetzte Config-Pfade faellt."""
    rel = rel_path.replace("\\", "/").lower()
    if not rel.endswith(PROTECTED_EXTENSIONS):
        return False
    return any(rel.startswith(prefix) for prefix in PROTECTED_PREFIXES)


def is_code_only_candidate(rel_path):
    """Prueft, ob eine Datei zum reinen Code-Deploy gehoert."""
    ext = os.path.splitext(rel_path)[1].lower()
    return ext in CODE_ONLY_EXTENSIONS


def resolve_js_upload_target(local_file):
    """Leitet Upload-Ziel und Build-Bedarf fuer eine js-dev-Quelldatei ab."""
    rel = os.path.relpath(local_file, LOCAL_BASE).replace("\\", "/")
    upload_rel = rel.replace("tnet/js-dev/", "tnet/js/")
    upload_file = os.path.join(LOCAL_BASE, upload_rel.replace("/", os.sep))

    needs_build = True
    if os.path.isfile(upload_file):
        needs_build = get_mtime(upload_file) < get_mtime(local_file)

    return upload_rel, upload_file, needs_build


# ===== DATEIEN SAMMELN =====

def collect_candidates():
    """
    Alle Dateien unter maps/ oder maps-dev/ rekursiv sammeln.
    DEV nutzt tnet/js als Quelle; PROD nutzt tnet/js als finale Runtime-Ausgabe.
    js-dev/ und js_ori/ werden als lokale Quell-/Backup-Ordner uebersprungen.
    Nicht fuer Code-Deploy gedachte Doku-/Test-/Cache-Artefakte werden uebersprungen.
    """
    skip_js_dir = None
    if os.path.basename(LOCAL_BASE).lower() == "maps-dev":
        # DEV laedt kuenftig die lesbaren Originale direkt aus tnet/js/.
        skip_js_dir = os.path.normpath(os.path.join(LOCAL_BASE, "tnet", "js-dev"))
    else:
        # PROD laedt finale Build-Artefakte aus tnet/js/; Quellen/Backups bleiben lokal.
        skip_js_dir = os.path.normpath(os.path.join(LOCAL_BASE, "tnet", "js-dev"))

    SKIP_DIRS = {
        skip_js_dir,
        os.path.normpath(os.path.join(LOCAL_BASE, "tnet", "js_ori")),
        os.path.normpath(os.path.join(LOCAL_BASE, "core")),
        os.path.normpath(os.path.join(LOCAL_BASE, "public", "config")),
        os.path.normpath(os.path.join(LOCAL_BASE, "public", "guis")),
        os.path.normpath(os.path.join(LOCAL_BASE, "tnet", "docs")),
        os.path.normpath(os.path.join(LOCAL_BASE, "tnet", "tests")),
    }
    SKIP_FILE_EXTENSIONS = {".drawio", ".md", ".pyc", ".xlsx"}
    candidates = []
    for root, dirs, files in os.walk(LOCAL_BASE):
        norm_root = os.path.normpath(root)
        if any(norm_root == sd or norm_root.startswith(sd + os.sep) for sd in SKIP_DIRS):
            dirs.clear()
            continue
        dirs[:] = [d for d in dirs if d != "__pycache__"]
        for f in files:
            if f.startswith("tnet-prod-") and f.endswith(".js"):
                continue
            if f in SKIP_FILE_NAMES:
                continue
            if os.path.splitext(f)[1].lower() in SKIP_FILE_EXTENSIONS:
                continue
            candidates.append(os.path.join(root, f))
    return candidates


def get_changed_files(state):
    """Dateien zurueckgeben deren Hash vom letzten Upload abweicht."""
    changed = []
    for path in collect_candidates():
        key = os.path.relpath(path, LOCAL_BASE).replace("\\", "/")
        if has_file_changed(path, key, state):
            changed.append(path)
    return sorted(changed)


# ===== UPLOAD =====

def main():
    global LOCAL_BASE, STATE_FILE, REMOTE_BASE

    parser = argparse.ArgumentParser(description="Geaenderte Dateien per SFTP hochladen")
    add_env_argument(parser)
    parser.add_argument("--code-only", action="store_true", help="Deployt nur geaenderte PHP/JS/HTML-Dateien")
    parser.add_argument("--allow-config", action="store_true", help="Erlaubt Upload geschuetzter Config-Dateien")
    parser.add_argument("--reason", default="", help="Pflicht bei --allow-config: Grund/Referenz")
    parser.add_argument("--dry-run", action="store_true", help="Nur anzeigen, nichts hochladen")
    args = parser.parse_args()

    deploy_config = resolve_deploy_config(args.env)
    LOCAL_BASE = os.path.normpath(deploy_config["local_base"])
    STATE_FILE = os.path.normpath(deploy_config["state_file"])
    REMOTE_BASE = deploy_config["remote_base"]
    ensure_local_base_exists(LOCAL_BASE)

    if args.allow_config and not args.reason.strip():
        print("[ERR] --allow-config erfordert --reason \"...\"")
        sys.exit(2)

    state = load_state()
    source_name = os.path.basename(LOCAL_BASE)

    print(f"Suche geaenderte Dateien unter {source_name}/ (env={deploy_config['env']}) ...")
    changed = get_changed_files(state)

    if not changed:
        print("Keine geaenderten Dateien gefunden.")
        return

    print(f"{len(changed)} geaenderte Datei(en) gefunden.")

    blocked = []
    deploy_candidates = []
    code_filtered = []
    deploy_candidate_rels = []
    for p in changed:
        rel = os.path.relpath(p, LOCAL_BASE).replace("\\", "/")
        if args.code_only and not is_code_only_candidate(rel):
            code_filtered.append(rel)
            continue
        if is_protected_config(rel):
            blocked.append(rel)
            if args.allow_config:
                deploy_candidates.append(p)
                deploy_candidate_rels.append(rel)
            continue
        deploy_candidates.append(p)
        deploy_candidate_rels.append(rel)

    if args.code_only:
        print("\n[INFO] Code-Only-Modus aktiv: erlaubt sind nur PHP/JS/HTML-Dateien.")
        if code_filtered:
            print(f"[INFO] {len(code_filtered)} Datei(en) wurden wegen Code-Only uebersprungen.")

    if blocked and not args.allow_config:
        print("\n[INFO] Geschuetzte Config-Dateien werden fuer diesen Code-Deploy uebersprungen:")
        for rel in blocked:
            print(f"  * {rel}")
        print("\nFuer Notfaelle explizit freigeben mit: --allow-config --reason \"...\"")

    if blocked and args.allow_config:
        print("\n[WARN] Override aktiv: Geschuetzte Config-Dateien werden hochgeladen")
        print(f"  Grund: {args.reason.strip()}")
        for rel in blocked:
            print(f"  * {rel}")

    if not deploy_candidates:
        print("\n[OK] Keine deploybaren Code-Dateien gefunden.")
        return

    if len(deploy_candidates) != len(changed):
        print(f"\n[INFO] Es werden {len(deploy_candidates)} Datei(en) deployt, {len(blocked)} geschuetzte Config-Datei(en) bleiben unberuehrt.")

    print(f"\n[INFO] Deploy-Kandidaten ({len(deploy_candidate_rels)}):")
    for rel in deploy_candidate_rels:
        print(f"  * {rel}")

    if args.dry_run:
        print("\n[OK] Dry-Run abgeschlossen (kein Upload ausgefuehrt).")
        return

    print(f"\nVerbinde zu {HOST} ({deploy_config['env']} -> {REMOTE_BASE})...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        ssh.connect(HOST, PORT, USER, PASSWORD)
        sftp = ssh.open_sftp()

        uploaded = 0
        skipped  = 0

        total_candidates = len(deploy_candidates)

        for index, local_file in enumerate(deploy_candidates, start=1):
            rel = os.path.relpath(local_file, LOCAL_BASE).replace("\\", "/")
            progress = f"[{index:03d}/{total_candidates:03d}]"

            # ===== LEGACY JS-DEV: Build-Schritt =====
            if rel.startswith("tnet/js-dev/"):
                upload_rel, upload_file, needs_build = resolve_js_upload_target(local_file)
                if needs_build:
                    print(f"  {progress} [BUILD] {rel}")
                    build_result = subprocess.run(
                        [sys.executable, "-u", BUILD_SCRIPT, "--mode", deploy_config["env"], local_file]
                    )
                    if build_result.returncode != 0:
                        print(f"  {progress} [ERR] Build fehlgeschlagen: {rel}")
                        skipped += 1
                        continue
                else:
                    print(f"  {progress} [BUILD-SKIP] {rel} (bereits gebaut)")
            else:
                upload_rel  = rel
                upload_file = local_file

            # Sicherheitssperre
            if any(b in upload_rel for b in ["tnet/js-dev/"]):
                print(f"  {progress} [ERR] GESPERRT: {upload_rel}")
                skipped += 1
                continue

            # Config-Guard (zweite Sicherung auch waehrend Upload-Schleife)
            if is_protected_config(upload_rel) and not args.allow_config:
                print(f"  {progress} [ERR] GESPERRT (Config API/Git-only): {upload_rel}")
                skipped += 1
                continue

            if not os.path.isfile(upload_file):
                print(f"  {progress} [WARN] {upload_rel} (nicht gefunden — uebersprungen)")
                skipped += 1
                continue

            remote_file = f"{REMOTE_BASE}/{upload_rel}"
            try:
                sftp.put(upload_file, remote_file)
                size = os.path.getsize(upload_file)
                print(f"  {progress} [OK] {upload_rel} ({size:,} bytes)")
                # Hash der Quelldatei merken (nicht des Build-Outputs)
                state[rel] = make_state_entry(local_file)
                uploaded += 1
            except Exception as e:
                print(f"  {progress} [ERR] {upload_rel} -- {e}")
                skipped += 1

        sftp.close()
        ssh.close()
        save_state(state)
        print(f"\n[OK] Fertig: {uploaded} hochgeladen, {skipped} uebersprungen")

    except Exception as e:
        print(f"[ERR] Verbindungsfehler: {e}")


if __name__ == "__main__":
    main()
