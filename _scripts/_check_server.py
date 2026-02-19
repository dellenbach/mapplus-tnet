#!/usr/bin/env python3
"""Check bookmark-service.php on server"""
import paramiko

HOST = "nwow.mapplus.ch"
PORT = 22
USER = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, PORT, USER, PASSWORD)
sftp = ssh.open_sftp()

# Prüfe mögliche Pfade
paths = [
    "/www/maps/tnet/bookmark-service.php",
    "/www/maps/tnet/php/bookmark-service.php",
    "/www/maps/tnet/php/",
    "/www/maps/tnet/",
]

for p in paths:
    try:
        info = sftp.stat(p)
        print(f"  EXISTS  {p}  (size={info.st_size})")
    except FileNotFoundError:
        print(f"  MISSING {p}")

# Liste tnet/php/ Verzeichnis
print("\n--- /www/maps/tnet/php/ ---")
try:
    for f in sftp.listdir("/www/maps/tnet/php/"):
        print(f"  {f}")
except Exception as e:
    print(f"  ERROR: {e}")

# Liste tnet/ root
print("\n--- /www/maps/tnet/ (*.php) ---")
try:
    for f in sftp.listdir("/www/maps/tnet/"):
        if f.endswith('.php') or f.endswith('.json'):
            print(f"  {f}")
except Exception as e:
    print(f"  ERROR: {e}")

sftp.close()
ssh.close()
