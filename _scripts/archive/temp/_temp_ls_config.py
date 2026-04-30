#!/usr/bin/env python3
"""Server config/ Verzeichnis komplett auflisten"""
import paramiko

HOST = "nwow.mapplus.ch"
PORT = 22
USER = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, PORT, USER, PASSWORD)
sftp = ssh.open_sftp()

path = "/www/maps/core/config"
print(f"=== {path}/ ===")
entries = sftp.listdir_attr(path)
for e in sorted(entries, key=lambda x: x.filename):
    is_dir = e.st_mode and (e.st_mode & 0o40000)
    suffix = "/" if is_dir else f"  ({e.st_size} bytes)"
    print(f"  {e.filename}{suffix}")

# Auch tnet/config
path2 = "/www/maps/tnet/config"
print(f"\n=== {path2}/ ===")
entries2 = sftp.listdir_attr(path2)
for e in sorted(entries2, key=lambda x: x.filename):
    is_dir = e.st_mode and (e.st_mode & 0o40000)
    suffix = "/" if is_dir else f"  ({e.st_size} bytes)"
    print(f"  {e.filename}{suffix}")

sftp.close()
ssh.close()
