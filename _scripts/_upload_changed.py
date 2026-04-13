#!/usr/bin/env python3
"""
_upload_changed.py
Alle git-geaenderten Dateien unter maps/ per SFTP hochladen.
Erkennt: modified, added, untracked (nur unter maps/).
JS-Quelldateien (js-dev/) werden automatisch via _build_js.py gebaut,
nur die minifizierte Version (js/) wird hochgeladen.

@version    1.1
@date       2026-04-13
@copyright  Trigonet AG
@author     Marco Dellenbach
"""
import os
import subprocess
import paramiko

BUILD_SCRIPT = os.path.normpath(os.path.join(os.path.dirname(__file__), "_build_js.py"))
LOCAL_BASE_STR = r"c:\_Daten\mapplus-exp\maps"

# SFTP Config
HOST = "nwow.mapplus.ch"
PORT = 22
USER = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"
REMOTE_BASE = "/www/maps"
LOCAL_BASE = os.path.normpath(r"c:\_Daten\mapplus-exp\maps")
REPO_ROOT = os.path.normpath(r"c:\_Daten\mapplus-exp")

def get_changed_files():
    """Git-geaenderte Dateien unter maps/ ermitteln (modified + added + untracked)."""
    files = set()

    # Modified + Added (staged und unstaged)
    for cmd in [
        ["git", "diff", "--name-only", "--", "maps/"],
        ["git", "diff", "--cached", "--name-only", "--", "maps/"],
    ]:
        result = subprocess.run(cmd, capture_output=True, text=True, cwd=REPO_ROOT)
        if result.returncode == 0:
            for line in result.stdout.strip().splitlines():
                line = line.strip()
                if line:
                    files.add(line)

    # Untracked unter maps/
    result = subprocess.run(
        ["git", "ls-files", "--others", "--exclude-standard", "--", "maps/"],
        capture_output=True, text=True, cwd=REPO_ROOT
    )
    if result.returncode == 0:
        for line in result.stdout.strip().splitlines():
            line = line.strip()
            if line:
                files.add(line)

    return sorted(files)

def main():
    print("Suche geaenderte Dateien unter maps/ ...")
    changed = get_changed_files()

    if not changed:
        print("Keine geaenderten Dateien unter maps/ gefunden.")
        return

    print(f"{len(changed)} geaenderte Datei(en) gefunden:\n")
    for f in changed:
        print(f"  • {f}")

    print(f"\nVerbinde zu {HOST}...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        ssh.connect(HOST, PORT, USER, PASSWORD)
        sftp = ssh.open_sftp()

        uploaded = 0
        skipped = 0

        for git_path in changed:
            # git_path ist relativ zum Repo-Root: "maps/tnet/js-dev/foo.js"

            # ===== JS-DEV: Build-Schritt =====
            # Quelldatei aus js-dev/ → minifizieren → js/-Version hochladen
            if "/tnet/js-dev/" in git_path:
                src_local = os.path.join(REPO_ROOT, git_path.replace("/", os.sep))
                if not os.path.isfile(src_local):
                    print(f"  ⚠ {git_path} (geloescht/fehlt — übersprungen)")
                    skipped += 1
                    continue
                print(f"  ⚙ Build: {git_path}")
                build_result = subprocess.run(
                    ["python", BUILD_SCRIPT, src_local],
                    capture_output=True, text=True
                )
                if build_result.returncode != 0:
                    print(f"  ✗ Build fehlgeschlagen: {build_result.stderr.strip() or build_result.stdout.strip()}")
                    skipped += 1
                    continue
                # Pfad auf js/ umleiten für den Upload
                out_git_path = git_path.replace("/tnet/js-dev/", "/tnet/js/")
                local_file = os.path.join(REPO_ROOT, out_git_path.replace("/", os.sep))
                rel = out_git_path[len("maps/"):]
            else:
                local_file = os.path.join(REPO_ROOT, git_path.replace("/", os.sep))
                rel = git_path[len("maps/"):]

            if not os.path.isfile(local_file):
                print(f"  ⚠ {git_path} (geloescht/fehlt)")
                skipped += 1
                continue

            # Remote-Pfad: maps/ Praefix entfernen
            remote_file = f"{REMOTE_BASE}/{rel}"

            # Sicherheitssperre: js-dev/ darf nie direkt hochgeladen werden
            if "/tnet/js-dev/" in remote_file:
                print(f"  ✗ GESPERRT (js-dev/ darf nicht hochgeladen werden): {rel}")
                skipped += 1
                continue

            try:
                sftp.put(local_file, remote_file)
                size = os.path.getsize(local_file)
                print(f"  ✓ {rel} ({size:,} bytes)")
                uploaded += 1
            except Exception as e:
                print(f"  ✗ {rel} — {e}")
                skipped += 1

        sftp.close()
        ssh.close()

        print(f"\n✓ Fertig: {uploaded} hochgeladen, {skipped} uebersprungen")

    except Exception as e:
        print(f"✗ Verbindungsfehler: {e}")

if __name__ == "__main__":
    main()
