#!/usr/bin/env python3
"""Suche mapplus-lib auf dem Server"""
import paramiko

HOST = "nwow.mapplus.ch"
PORT = 22
USER = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, PORT, USER, PASSWORD)
sftp = ssh.open_sftp()

# Mögliche Pfade für mapplus-lib
candidates = [
    '/www/mapplus-lib',
    '/var/www/html/nwow/mapplus-lib',
    '/mapplus-lib',
    '/www/maps/mapplus-lib',
    '/var/www/mapplus-lib',
    '/data/mapplus-lib',
]

for p in candidates:
    try:
        items = sftp.listdir(p)
        print(f"FOUND: {p} -> {items[:20]}")
    except Exception as e:
        print(f"NOT: {p} ({e})")

# Auch nach symlinks / Referenzen in der www-Struktur schauen
print("\n=== Checking /www/ ===")
try:
    for item in sftp.listdir_attr('/www'):
        print(f"  {item.filename}  (size={item.st_size})")
except Exception as e:
    print(f"  Error: {e}")

print("\n=== Checking /www/maps/ top level ===")
try:
    for item in sftp.listdir_attr('/www/maps'):
        name = item.filename
        if not name.startswith('.'):
            print(f"  {name}/  (size={item.st_size})" if item.st_size == 0 or item.st_size > 10000 else f"  {name}  ({item.st_size}b)")
except Exception as e:
    print(f"  Error: {e}")

# Prüfe /var/www/html/nwow/ nach mapplus-lib oder Symlinks
print("\n=== Checking /var/www/html/nwow/ ===")
try:
    for item in sftp.listdir_attr('/var/www/html/nwow'):
        name = item.filename
        print(f"  {name}")
except Exception as e:
    print(f"  Error: {e}")

sftp.close()
ssh.close()
