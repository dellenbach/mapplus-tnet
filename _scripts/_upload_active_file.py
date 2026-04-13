#!/usr/bin/env python3
"""
_upload_active_file.py
Einzelne Datei per SFTP hochladen — nur wenn sie unter maps/ liegt.
JS-Quelldateien aus js-dev/ werden automatisch via _build_js.py gebaut;
nur die minifizierte Version aus js/ wird hochgeladen.
Aufruf: python _upload_active_file.py <dateipfad>

@version    1.1
@date       2026-04-13
@copyright  Trigonet AG
@author     Marco Dellenbach
"""
import os
import sys
import subprocess
import paramiko

BUILD_SCRIPT = os.path.normpath(os.path.join(os.path.dirname(__file__), "_build_js.py"))

# SFTP Config
HOST = "nwow.mapplus.ch"
PORT = 22
USER = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"
REMOTE_BASE = "/www/maps"
LOCAL_BASE = os.path.normpath(r"c:\_Daten\mapplus-exp\maps")

def main():
    if len(sys.argv) < 2:
        print("Nutzung: python _upload_active_file.py <dateipfad>")
        sys.exit(1)

    filepath = os.path.normpath(sys.argv[1])

    # Sicherheitscheck: nur Dateien unter maps/ erlauben
    if not filepath.lower().startswith(LOCAL_BASE.lower()):
        print(f"✗ Abgelehnt: Datei liegt nicht unter maps/")
        print(f"  Pfad: {filepath}")
        print(f"  Erlaubt: {LOCAL_BASE}")
        sys.exit(1)

    if not os.path.isfile(filepath):
        print(f"✗ Datei nicht gefunden: {filepath}")
        sys.exit(1)

    # ===== JS-DEV: Build-Schritt =====
    js_dev_marker = os.path.normpath(os.path.join(LOCAL_BASE, "tnet", "js-dev"))
    is_js_dev = filepath.lower().startswith(js_dev_marker.lower())

    if is_js_dev:
        print(f"⚙ Quelldatei erkannt — baue zuerst: {os.path.basename(filepath)}")
        build_result = subprocess.run(
            ["python", BUILD_SCRIPT, filepath],
            capture_output=False  # Ausgabe direkt anzeigen
        )
        if build_result.returncode != 0:
            print("✗ Build fehlgeschlagen")
            sys.exit(1)
        # Auf js/ umleiten
        js_out = os.path.normpath(os.path.join(LOCAL_BASE, "tnet", "js"))
        filepath = filepath.replace(js_dev_marker, js_out)
        if not os.path.isfile(filepath):
            print(f"✗ Build-Output nicht gefunden: {filepath}")
            sys.exit(1)

    # Sicherheitssperre: js-dev/ darf nie direkt hochgeladen werden
    js_dev_remote_marker = os.path.normpath(os.path.join(LOCAL_BASE, "tnet", "js-dev"))
    if filepath.lower().startswith(js_dev_remote_marker.lower()):
        print("✗ GESPERRT: js-dev/-Dateien dürfen nicht direkt hochgeladen werden")
        sys.exit(1)

    # Relativen Pfad berechnen
    rel_path = os.path.relpath(filepath, LOCAL_BASE).replace("\\", "/")
    remote_path = f"{REMOTE_BASE}/{rel_path}"
    size = os.path.getsize(filepath)

    print(f"Upload: {rel_path}")
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
        print(f"  ✓ Hochgeladen ({size:,} bytes)")
    except Exception as e:
        print(f"  ✗ Fehler: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
