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
DEV laedt lesbare JS direkt aus tnet/js/ und kann lokal tnet/js-stage/ bauen.
PROD laedt finale Build-Artefakte aus tnet/js/; tnet/js-stage/, tnet/js-src/,
tnet/js-dev/ und tnet/js_ori/ werden nicht direkt hochgeladen.

@version    2.6
@date       2026-06-02
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
BUILD_SCRIPT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "build", "build_js.py"))
CSS_BUILD_SCRIPT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "build", "build_css.py"))
LOCAL_BASE   = ""
STATE_FILE   = ""
CURRENT_ENV  = ""

HOST         = "nwow.mapplus.ch"
PORT         = 22
USER         = "trigonet"
PASSWORD     = "3Zs,k4%Un,<[W(Kx"
REMOTE_BASE  = ""
SCAN_SUBDIR  = ""  # Wenn gesetzt: nur dieses Unterverzeichnis scannen (z.B. "tnet")

# Verzeichnisse die nie direkt hochgeladen werden duerfen
BLOCKED_DIRS = [
    "tnet/js-dev/",
    "tnet\\js-dev\\",
    "tnet/js-stage/",
    "tnet\\js-stage\\",
    "tnet/js-src/",
    "tnet\\js-src\\",
    "tnet/js_ori/",
    "tnet\\js_ori\\",
]

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


# tnet/config/ ist in DEV/EDIT explizit erlaubt (App-Configs gehören zum Deployment).
# In PROD bleibt tnet/config/ geschützt (Deploy dort über upload_config.py).
DEV_ALLOWED_PREFIXES = (
    "tnet/config/",
)
TNET_CONFIG_PREFIX = "tnet/config/"

EDIT_ALLOWED_PREFIXES = (
    "tnet/",
)
EDIT_ALLOWED_FILES = {
    "agsproxy.php",
    "wmsproxy.php",
    "public/index_de.htm",
    "public/index_de_m.htm",
}


def is_tnet_config(rel_path):
    """Prueft ob eine Datei unter tnet/config/ liegt."""
    rel = rel_path.replace("\\", "/").lower()
    return rel.startswith(TNET_CONFIG_PREFIX)


def is_protected_config(rel_path, env=None):
    """Prueft, ob eine Datei unter geschuetzte Config-Pfade faellt.
    In DEV/EDIT sind tnet/config/-Dateien explizit erlaubt.
    """
    rel = rel_path.replace("\\", "/").lower()
    if not rel.endswith(PROTECTED_EXTENSIONS):
        return False
    if env in ("dev", "edit") and any(rel.startswith(p) for p in DEV_ALLOWED_PREFIXES):
        return False
    return any(rel.startswith(prefix) for prefix in PROTECTED_PREFIXES)


def is_edit_deploy_allowed(rel_path):
    """Erlaubte Pfade fuer das EDIT-Ziel: gesamter tnet-Ordner plus Proxy-Dateien."""
    rel = rel_path.replace("\\", "/").lower()
    if rel in EDIT_ALLOWED_FILES:
        return True
    return any(rel.startswith(prefix) for prefix in EDIT_ALLOWED_PREFIXES)


def is_code_only_candidate(rel_path):
    """Prueft, ob eine Datei zum reinen Code-Deploy gehoert."""
    ext = os.path.splitext(rel_path)[1].lower()
    return ext in CODE_ONLY_EXTENSIONS


def run_js_stage_build(dry_run=False):
    """Baut die lokale PROD-Stage aus maps-dev/tnet/js nach maps-dev/tnet/js-stage."""
    source_root = os.path.normpath(os.path.join(LOCAL_BASE, "tnet", "js"))
    stage_root = os.path.normpath(os.path.join(LOCAL_BASE, "tnet", "js-stage"))

    if not os.path.isdir(source_root):
        raise RuntimeError(f"JS-Originalverzeichnis nicht gefunden: {source_root}")

    command = [
        sys.executable,
        "-u",
        BUILD_SCRIPT,
        "--mode",
        "prod",
        "--src-root",
        source_root,
        "--out-root",
        stage_root,
    ]

    print("\n=== JS-Stage bauen (maps-dev/tnet/js -> maps-dev/tnet/js-stage) ===")
    print(" ".join(command))
    if dry_run:
        print("[INFO] Dry-Run: JS-Stage-Build wird nicht ausgefuehrt.")
        return

    result = subprocess.run(command)
    if result.returncode != 0:
        raise RuntimeError(f"JS-Stage-Build fehlgeschlagen mit Exit-Code {result.returncode}")

    run_css_bundle_build(dry_run=dry_run)


def run_css_bundle_build(dry_run=False):
    """Buendelt die TNET-CSS aus maps-dev/tnet/css nach tnet/css/tnet.bundle.css."""
    css_root = os.path.normpath(os.path.join(LOCAL_BASE, "tnet", "css"))
    out_path = os.path.join(css_root, "tnet.bundle.css")

    if not os.path.isdir(css_root):
        print(f"[WARN] CSS-Verzeichnis nicht gefunden, Bundle uebersprungen: {css_root}")
        return

    command = [
        sys.executable,
        "-u",
        CSS_BUILD_SCRIPT,
        "--css-root",
        css_root,
        "--out",
        out_path,
    ]

    print("\n=== CSS-Bundle bauen (maps-dev/tnet/css -> tnet.bundle.css) ===")
    if dry_run:
        print("[INFO] Dry-Run: CSS-Bundle wird nicht erzeugt.")
        return

    result = subprocess.run(command)
    if result.returncode != 0:
        raise RuntimeError(f"CSS-Bundle-Build fehlgeschlagen mit Exit-Code {result.returncode}")


def collect_forced_js_files():
    """Sammelt finale Runtime-JS-Dateien aus tnet/js fuer erzwungenen Upload."""
    js_dir = os.path.normpath(os.path.join(LOCAL_BASE, "tnet", "js"))
    forced = []
    if not os.path.isdir(js_dir):
        return forced

    for root, dirs, files in os.walk(js_dir):
        dirs[:] = [d for d in dirs if d != "__pycache__"]
        for filename in files:
            if not filename.endswith(".js"):
                continue
            if filename.startswith("tnet-prod-"):
                continue
            forced.append(os.path.join(root, filename))
    return sorted(forced)


def merge_forced_files(changed, forced_files):
    """Fuegt erzwungene Dateien dedupliziert zur Changed-Liste hinzu."""
    existing = {os.path.normcase(os.path.abspath(path)) for path in changed}
    merged = list(changed)
    for path in forced_files:
        key = os.path.normcase(os.path.abspath(path))
        if key in existing:
            continue
        merged.append(path)
        existing.add(key)
    return sorted(merged)


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
                pass


# ===== DATEIEN SAMMELN =====

def collect_candidates():
    """
    Alle Dateien unter maps/ oder maps-dev/ rekursiv sammeln.
    DEV nutzt tnet/js als Quelle; PROD nutzt tnet/js als finale Runtime-Ausgabe.
    js-dev/ und js_ori/ werden als lokale Quell-/Backup-Ordner uebersprungen.
    Nicht fuer Code-Deploy gedachte Doku-/Test-/Cache-Artefakte werden uebersprungen.
    Wenn SCAN_SUBDIR gesetzt ist, wird nur dieses Unterverzeichnis gescannt.
    """
    # Bei scan_subdir: Startpunkt einschraenken
    walk_base = LOCAL_BASE
    if SCAN_SUBDIR:
        walk_base = os.path.normpath(os.path.join(LOCAL_BASE, SCAN_SUBDIR))
        if not os.path.isdir(walk_base):
            print(f"[WARN] scan_subdir '{SCAN_SUBDIR}' existiert nicht unter {LOCAL_BASE}")
            return []

    skip_js_dir = None
    if os.path.basename(LOCAL_BASE).lower() == "maps-dev":
        skip_js_dir = os.path.normpath(os.path.join(LOCAL_BASE, "tnet", "js-dev"))
    else:
        skip_js_dir = os.path.normpath(os.path.join(LOCAL_BASE, "tnet", "js-dev"))

    SKIP_DIRS = {
        skip_js_dir,
        os.path.normpath(os.path.join(LOCAL_BASE, "tnet", "js-stage")),
        os.path.normpath(os.path.join(LOCAL_BASE, "tnet", "js-src")),
        os.path.normpath(os.path.join(LOCAL_BASE, "tnet", "js_ori")),
        os.path.normpath(os.path.join(LOCAL_BASE, "core")),
        os.path.normpath(os.path.join(LOCAL_BASE, "public", "config")),
        os.path.normpath(os.path.join(LOCAL_BASE, "public", "guis")),
    }
    if CURRENT_ENV != "edit":
        SKIP_DIRS.add(os.path.normpath(os.path.join(LOCAL_BASE, "tnet", "docs")))
        SKIP_DIRS.add(os.path.normpath(os.path.join(LOCAL_BASE, "tnet", "tests")))
    SKIP_FILE_EXTENSIONS = {".drawio", ".md", ".pyc", ".xlsx"}
    candidates = []
    for root, dirs, files in os.walk(walk_base):
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
        if CURRENT_ENV == "edit" and not is_edit_deploy_allowed(key):
            continue
        if has_file_changed(path, key, state):
            changed.append(path)
    return sorted(changed)


# ===== UPLOAD =====

def main():
    global LOCAL_BASE, STATE_FILE, REMOTE_BASE, CURRENT_ENV

    parser = argparse.ArgumentParser(description="Geaenderte Dateien per SFTP hochladen")
    add_env_argument(parser)
    parser.add_argument("--code-only", action="store_true", help="Deployt nur geaenderte PHP/JS/HTML-Dateien")
    parser.add_argument("--build-js-stage", action="store_true", help="Baut bei DEV vor dem Upload lokal tnet/js-stage aus tnet/js")
    parser.add_argument("--force-js", action="store_true", help="Erzwingt Upload aller finalen Runtime-JS aus tnet/js")
    parser.add_argument("--allow-config", action="store_true", help="Erlaubt Upload geschuetzter Config-Dateien")
    parser.add_argument("--allow-tnet-config", action="store_true", help="Erlaubt nur tnet/config/-Dateien trotz Config-Schutz")
    parser.add_argument("--reason", default="", help="Pflicht bei --allow-config: Grund/Referenz")
    parser.add_argument("--dry-run", action="store_true", help="Nur anzeigen, nichts hochladen")
    args = parser.parse_args()

    deploy_config = resolve_deploy_config(args.env)
    LOCAL_BASE = os.path.normpath(deploy_config["local_base"])
    STATE_FILE = os.path.normpath(deploy_config["state_file"])
    REMOTE_BASE = deploy_config["remote_base"]
    SCAN_SUBDIR = deploy_config.get("scan_subdir", "")
    CURRENT_ENV = deploy_config["env"]
    ensure_local_base_exists(LOCAL_BASE)

    if args.allow_config and not args.reason.strip():
        print("[ERR] --allow-config erfordert --reason \"...\"")
        sys.exit(2)

    if args.build_js_stage and deploy_config["env"] != "dev":
        print("[ERR] --build-js-stage ist nur fuer DEV erlaubt")
        sys.exit(2)

    if args.build_js_stage:
        try:
            run_js_stage_build(dry_run=args.dry_run)
        except Exception as exc:
            print(f"[ERR] {exc}")
            sys.exit(1)

    state = load_state()
    source_name = os.path.basename(LOCAL_BASE)

    print(f"Suche geaenderte Dateien unter {source_name}/ (env={deploy_config['env']}) ...")
    if deploy_config["env"] == "edit":
        print("[INFO] EDIT-Scope aktiv: erlaubt sind nur tnet/** sowie agsproxy.php und wmsproxy.php.")
    changed = get_changed_files(state)

    if args.force_js:
        forced_js = collect_forced_js_files()
        print(f"[INFO] --force-js aktiv: {len(forced_js)} Runtime-JS-Datei(en) aus tnet/js werden beruecksichtigt.")
        changed = merge_forced_files(changed, forced_js)

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
        if is_protected_config(rel, env=deploy_config["env"]):
            blocked.append(rel)
            if args.allow_config or (args.allow_tnet_config and is_tnet_config(rel)):
                deploy_candidates.append(p)
                deploy_candidate_rels.append(rel)
            continue
        deploy_candidates.append(p)
        deploy_candidate_rels.append(rel)

    if args.code_only:
        print("\n[INFO] Code-Only-Modus aktiv: erlaubt sind nur PHP/JS/HTML-Dateien.")
        if code_filtered:
            print(f"[INFO] {len(code_filtered)} Datei(en) wurden wegen Code-Only uebersprungen.")

    if blocked and not args.allow_config and not args.allow_tnet_config:
        print("\n[INFO] Geschuetzte Config-Dateien werden fuer diesen Code-Deploy uebersprungen:")
        for rel in blocked:
            print(f"  * {rel}")
        print("\nFuer Notfaelle explizit freigeben mit: --allow-config --reason \"...\"")
        print("Oder nur tnet/config erlauben mit: --allow-tnet-config")

    if blocked and args.allow_config:
        print("\n[WARN] Override aktiv: Geschuetzte Config-Dateien werden hochgeladen")
        print(f"  Grund: {args.reason.strip()}")
        for rel in blocked:
            print(f"  * {rel}")

    if blocked and args.allow_tnet_config and not args.allow_config:
        released = [rel for rel in blocked if is_tnet_config(rel)]
        still_blocked = [rel for rel in blocked if not is_tnet_config(rel)]
        if released:
            print("\n[WARN] Override aktiv: tnet/config-Dateien werden hochgeladen")
            for rel in released:
                print(f"  * {rel}")
        if still_blocked:
            print("\n[INFO] Andere geschuetzte Config-Dateien bleiben gesperrt:")
            for rel in still_blocked:
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

        # Cache bereits sichergestellter Remote-Verzeichnisse (spart stat/mkdir-Calls).
        ensured_dirs = set()

        def ensure_remote_dir(remote_dir):
            # Legt remote_dir rekursiv an (idempotent). Verhindert '[Errno 2] No such file'
            # bei neuen Zielbaeumen (z.B. tnet/resources/symbols/base).
            if not remote_dir or remote_dir in ensured_dirs or remote_dir in ("/", ""):
                return
            parent = os.path.dirname(remote_dir)
            if parent and parent not in ensured_dirs and parent not in ("/", ""):
                ensure_remote_dir(parent)
            try:
                sftp.stat(remote_dir)
            except IOError:
                try:
                    sftp.mkdir(remote_dir)
                except IOError:
                    pass
            ensured_dirs.add(remote_dir)

        for index, local_file in enumerate(deploy_candidates, start=1):
            rel = os.path.relpath(local_file, LOCAL_BASE).replace("\\", "/")
            progress = f"[{index:03d}/{total_candidates:03d}]"

            upload_rel  = rel
            upload_file = local_file

            # Sicherheitssperre
            if any(b in upload_rel for b in ["tnet/js-dev/", "tnet/js-stage/", "tnet/js-src/", "tnet/js_ori/"]):
                print(f"  {progress} [ERR] GESPERRT: {upload_rel}")
                skipped += 1
                continue

            # Config-Guard (zweite Sicherung auch waehrend Upload-Schleife)
            if is_protected_config(upload_rel, env=deploy_config["env"]) and not args.allow_config and not (args.allow_tnet_config and is_tnet_config(upload_rel)):
                print(f"  {progress} [ERR] GESPERRT (Config API/Git-only): {upload_rel}")
                skipped += 1
                continue

            if not os.path.isfile(upload_file):
                print(f"  {progress} [WARN] {upload_rel} (nicht gefunden — uebersprungen)")
                skipped += 1
                continue

            remote_file = f"{REMOTE_BASE}/{upload_rel}"
            try:
                ensure_remote_dir(remote_file.rsplit("/", 1)[0])
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
