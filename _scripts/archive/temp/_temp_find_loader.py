#!/usr/bin/env python3
"""Find loader.php on server"""
import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pw = '3Zs,k4' + chr(37) + 'Un,<[W(Kx'
ssh.connect('nwow.mapplus.ch', 22, 'trigonet', pw)
sftp = ssh.open_sftp()
print("Connected")

for p in ['/www/maps/public/loader.php', '/www/maps/loader.php', '/www/loader.php',
          '/www/maps/public/core/loader.php', '/www/core/loader.php']:
    try:
        sftp.stat(p)
        print(f"FOUND: {p}")
    except:
        print(f"not found: {p}")

# Read loader.php
print("\n=== Reading /www/maps/loader.php ===")
with sftp.open('/www/maps/loader.php', 'r') as f:
    content = f.read().decode('utf-8')
    lines = content.split('\n')
    print(f"Total lines: {len(lines)}")
    for i, line in enumerate(lines, 1):
        print(f"{i}: {line}")

sftp.close()
ssh.close()
