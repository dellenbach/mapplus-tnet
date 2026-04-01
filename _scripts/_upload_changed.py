#!/usr/bin/env python3
"""
_upload_changed.py
Alle git-geaenderten Dateien unter maps/ per SFTP hochladen.
Erkennt: modified, added, untracked (nur unter maps/).

@version    1.0
@date       2026-04-01
@copyright  Trigonet AG
@author     Marco Dellenbach
"""
import os
import subprocess
import paramiko

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
            # git_path ist relativ zum Repo-Root: "maps/tnet/js/foo.js"
            local_file = os.path.join(REPO_ROOT, git_path.replace("/", os.sep))

            if not os.path.isfile(local_file):
                print(f"  ⚠ {git_path} (geloescht/fehlt)")
                skipped += 1
                continue

            # Remote-Pfad: maps/ Praefix entfernen
            rel = git_path[len("maps/"):]  # z.B. "tnet/js/foo.js"
            remote_file = f"{REMOTE_BASE}/{rel}"

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
