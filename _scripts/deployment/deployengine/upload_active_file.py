#!/usr/bin/env python3
"""
upload_active_file.py
Einzelne Datei per SFTP hochladen — nur wenn sie unter maps/ bzw. maps-dev/ liegt.
DEV-JS aus tnet/js/ wird direkt hochgeladen. PROD-JS-Originale aus maps-dev/tnet/js/
werden zuerst nach maps/tnet/js_ori/ synchronisiert und danach nach maps/tnet/js/
minifiziert + obfuskiert gebaut.

Aufruf: python upload_active_file.py --env dev <dateipfad>

@version    1.4
@date       2026-06-01
@copyright  Trigonet AG
@author     Marco Dellenbach
"""
import os
import sys
import subprocess
import argparse
import shutil
import paramiko
from deploy_env import add_env_argument, ensure_local_base_exists, resolve_deploy_config

BUILD_SCRIPT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "build", "build_js.py"))

# SFTP Config
HOST = "nwow.mapplus.ch"
PORT = 22
USER = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"
REMOTE_BASE = ""
LOCAL_BASE = ""

# Konfigurationsdateien sind API/Git-only und duerfen NICHT versehentlich per FTP deployt werden.
PROTECTED_EXTENSIONS = (".conf", ".json", ".json5")
PROTECTED_PREFIXES = (
    "core/config/",
    "core/nls/",
    "public/config/",
    "tnet/config/",
)


def is_protected_config(rel_path):
    """Prueft, ob eine Datei unter geschuetzte Config-Pfade faellt."""
    rel = rel_path.replace("\\", "/").lower()
    if not rel.endswith(PROTECTED_EXTENSIONS):
        return False
    return any(rel.startswith(prefix) for prefix in PROTECTED_PREFIXES)


def is_within_tree(path, base_dir):
    """Prueft robust, ob path innerhalb von base_dir liegt."""
    try:
        norm_path = os.path.normcase(os.path.abspath(path))
        norm_base = os.path.normcase(os.path.abspath(base_dir))
        return os.path.commonpath([norm_path, norm_base]) == norm_base
    except ValueError:
        return False


def main():
    global LOCAL_BASE, REMOTE_BASE

    parser = argparse.ArgumentParser(description="Einzelne Datei per SFTP hochladen")
    add_env_argument(parser)
    parser.add_argument("filepath", help="Pfad zur hochzuladenden Datei")
    parser.add_argument("--allow-config", action="store_true", help="Erlaubt Upload geschuetzter Config-Dateien")
    parser.add_argument("--reason", default="", help="Pflicht bei --allow-config: Grund/Referenz")
    args = parser.parse_args()

    deploy_config = resolve_deploy_config(args.env)
    LOCAL_BASE = os.path.normpath(deploy_config["local_base"])
    REMOTE_BASE = deploy_config["remote_base"]
    ensure_local_base_exists(LOCAL_BASE)
    dev_config = resolve_deploy_config("dev")
    dev_local_base = os.path.normpath(dev_config["local_base"])

    if args.allow_config and not args.reason.strip():
        print("[ERR] --allow-config erfordert --reason \"...\"")
        sys.exit(2)

    filepath = os.path.normpath(args.filepath)

    if not os.path.isfile(filepath):
        print(f"[ERR] Datei nicht gefunden: {filepath}")
        sys.exit(1)

    # Sicherheitscheck: DEV erlaubt nur maps-dev/. PROD erlaubt maps/ oder maps-dev/ mit lokalem Sync.
    if is_within_tree(filepath, LOCAL_BASE):
        pass
    elif deploy_config["env"] == "prod" and is_within_tree(filepath, dev_local_base):
        rel_from_dev = os.path.relpath(filepath, dev_local_base)
        rel_from_dev_web = rel_from_dev.replace(os.sep, "/")
        if rel_from_dev_web.startswith("tnet/js/"):
            promoted_rel = os.path.join("tnet", "js_ori", rel_from_dev_web[len("tnet/js/"):].replace("/", os.sep))
        else:
            promoted_rel = rel_from_dev
        promoted_path = os.path.normpath(os.path.join(LOCAL_BASE, promoted_rel))
        os.makedirs(os.path.dirname(promoted_path), exist_ok=True)
        shutil.copy2(filepath, promoted_path)
        print(f"[SYNC] maps-dev -> maps: {rel_from_dev_web} -> {os.path.relpath(promoted_path, LOCAL_BASE).replace(os.sep, '/')}")
        filepath = promoted_path
    else:
        print("[ERR] Abgelehnt: Datei liegt nicht unter dem erlaubten Source-Tree")
        print(f"  Pfad:        {filepath}")
        print(f"  Erlaubt:     {LOCAL_BASE}")
        if deploy_config["env"] == "prod":
            print(f"  Zusaetzlich: {dev_local_base}")
        sys.exit(1)

    # ===== JS-QUELLEN: Build-Schritt =====
    js_dev_marker = os.path.normpath(os.path.join(LOCAL_BASE, "tnet", "js-dev"))
    js_ori_marker = os.path.normpath(os.path.join(LOCAL_BASE, "tnet", "js_ori"))
    is_js_dev = filepath.lower().startswith(js_dev_marker.lower())
    is_js_ori = filepath.lower().startswith(js_ori_marker.lower())

    if is_js_dev:
        print(f"[BUILD] Quelldatei erkannt -- baue zuerst: {os.path.basename(filepath)}")
        build_result = subprocess.run(
            [sys.executable, BUILD_SCRIPT, "--mode", deploy_config["env"], filepath],
            capture_output=False  # Ausgabe direkt anzeigen
        )
        if build_result.returncode != 0:
            print("[ERR] Build fehlgeschlagen")
            sys.exit(1)
        # Auf js/ umleiten
        js_out = os.path.normpath(os.path.join(LOCAL_BASE, "tnet", "js"))
        filepath = filepath.replace(js_dev_marker, js_out)
        if not os.path.isfile(filepath):
            print(f"[ERR] Build-Output nicht gefunden: {filepath}")
            sys.exit(1)

    if deploy_config["env"] == "prod" and is_js_ori:
        print(f"[BUILD] PROD-Quelle erkannt -- baue zuerst: {os.path.basename(filepath)}")
        js_out = os.path.normpath(os.path.join(LOCAL_BASE, "tnet", "js"))
        build_result = subprocess.run(
            [
                sys.executable,
                BUILD_SCRIPT,
                "--mode",
                "prod",
                "--src-root",
                js_ori_marker,
                "--out-root",
                js_out,
                filepath,
            ],
            capture_output=False
        )
        if build_result.returncode != 0:
            print("[ERR] Build fehlgeschlagen")
            sys.exit(1)
        filepath = filepath.replace(js_ori_marker, js_out)
        if not os.path.isfile(filepath):
            print(f"[ERR] Build-Output nicht gefunden: {filepath}")
            sys.exit(1)

    # Sicherheitssperre: js-dev/ darf nie direkt hochgeladen werden
    js_dev_remote_marker = os.path.normpath(os.path.join(LOCAL_BASE, "tnet", "js-dev"))
    js_ori_remote_marker = os.path.normpath(os.path.join(LOCAL_BASE, "tnet", "js_ori"))
    if filepath.lower().startswith(js_dev_remote_marker.lower()) or filepath.lower().startswith(js_ori_remote_marker.lower()):
        print("[ERR] GESPERRT: JS-Quell-/Backup-Dateien duerfen nicht direkt hochgeladen werden")
        sys.exit(1)

    # Relativen Pfad berechnen
    rel_path = os.path.relpath(filepath, LOCAL_BASE).replace("\\", "/")

    # Config-Guard
    if is_protected_config(rel_path) and not args.allow_config:
        print("[ERR] Abgelehnt: Geschuetzte Config-Datei (API/Git-only)")
        print(f"  Datei:  {rel_path}")
        print("  Verwende fuer Notfaelle explizit: --allow-config --reason \"...\"")
        sys.exit(3)

    if is_protected_config(rel_path) and args.allow_config:
        print("[WARN] Override aktiv: Geschuetzte Config-Datei wird hochgeladen")
        print(f"  Grund: {args.reason.strip()}")

    remote_path = f"{REMOTE_BASE}/{rel_path}"
    size = os.path.getsize(filepath)

    print(f"Upload ({deploy_config['env']}): {rel_path}")
    print(f"  Lokal:  {filepath}")
    print(f"  Remote: {remote_path}")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        ssh.connect(HOST, PORT, USER, PASSWORD)
        sftp = ssh.open_sftp()
        sftp.put(filepath, remote_path)
        sftp.close()
        ssh.close()
        print(f"  [OK] Hochgeladen ({size:,} bytes)")
    except Exception as e:
        print(f"  [ERR] Fehler: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
