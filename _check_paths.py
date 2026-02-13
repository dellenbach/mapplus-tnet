#!/usr/bin/env python3
"""Check server paths for inframe-maps.html and proxy"""
import paramiko

HOST = "nwow.mapplus.ch"
PORT = 22
USER = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, PORT, USER, PASSWORD)
sftp = ssh.open_sftp()

# Suche alle möglichen inframe-maps.html Pfade
paths = [
    "/www/maps/tnet/views/inframe-maps.html",
    "/www/maps/tnet/inframe-maps.html",
    "/www/maps/public/inframe-maps.html",
    "/www/maps/inframe-maps.html",
    "/www/inframe-maps.html",
]

print("=== inframe-maps.html ===")
for p in paths:
    try:
        info = sftp.stat(p)
        print(f"  EXISTS  {p}  (size={info.st_size})")
        # Read first few lines to check version
        with sftp.open(p, 'r') as f:
            content = f.read(2000).decode('utf-8', errors='replace')
            for line in content.split('\n'):
                if 'Version' in line or 'version' in line:
                    print(f"          -> {line.strip()}")
    except FileNotFoundError:
        print(f"  MISSING {p}")

# Suche active-maps-proxy.php
print("\n=== active-maps-proxy.php ===")
proxy_paths = [
    "/www/maps/tnet/php/active-maps-proxy.php",
    "/www/maps/tnet/active-maps-proxy.php",
]
for p in proxy_paths:
    try:
        info = sftp.stat(p)
        print(f"  EXISTS  {p}  (size={info.st_size})")
        with sftp.open(p, 'r') as f:
            content = f.read(1000).decode('utf-8', errors='replace')
            for line in content.split('\n'):
                if 'version' in line.lower() or 'Session' in line:
                    print(f"          -> {line.strip()}")
    except FileNotFoundError:
        print(f"  MISSING {p}")

# Liste tnet/ root und tnet/views/
print("\n=== /www/maps/tnet/ ===")
for f in sorted(sftp.listdir("/www/maps/tnet/")):
    if 'inframe' in f.lower() or 'html' in f.lower():
        print(f"  {f}")

print("\n=== /www/maps/tnet/views/ ===")
try:
    for f in sorted(sftp.listdir("/www/maps/tnet/views/")):
        print(f"  {f}")
except:
    print("  MISSING (kein views/ Ordner)")

sftp.close()
ssh.close()
