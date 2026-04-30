#!/usr/bin/env python3
"""Server-Verzeichnisstruktur erkunden"""
import paramiko

HOST = "nwow.mapplus.ch"
PORT = 22
USER = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, PORT, USER, PASSWORD)
sftp = ssh.open_sftp()

def ls(path, indent=0):
    try:
        entries = sftp.listdir_attr(path)
        for e in sorted(entries, key=lambda x: x.filename):
            is_dir = e.st_mode and (e.st_mode & 0o40000)
            prefix = "  " * indent
            if is_dir:
                print(f"{prefix}{e.filename}/")
                if indent < 2:  # Max 3 levels deep
                    ls(path + "/" + e.filename, indent + 1)
            else:
                if e.filename.endswith((".conf", ".json", ".json5")):
                    print(f"{prefix}{e.filename}  ({e.st_size} bytes)")
    except Exception as ex:
        print(f"{'  ' * indent}ERROR: {ex}")

print("=== /www/maps/core/ ===")
ls("/www/maps/core", 0)

sftp.close()
ssh.close()
