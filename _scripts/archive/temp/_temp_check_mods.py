#!/usr/bin/env python3
"""Check which conf files exist for defmodules on server"""
import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
pw = '3Zs,k4' + chr(37) + 'Un,<[W(Kx'
ssh.connect('nwow.mapplus.ch', 22, 'trigonet', pw)
sftp = ssh.open_sftp()

modules = ['lyrmgr', 'maptips', 'legends', 'searchoptions', 'tools', 'disclaimer']

for mod in modules:
    base = f"/www/maps/public/config/{mod}.conf"
    mobile = f"/www/maps/public/config/{mod}_m.conf"
    
    for p in [base, mobile]:
        try:
            stat = sftp.stat(p)
            print(f"  EXISTS: {p} ({stat.st_size} bytes)")
        except:
            print(f"  MISSING: {p}")

# Also check core config
print("\nCore config:")
for mod in modules:
    base = f"/www/maps/core/config/{mod}.conf"
    try:
        stat = sftp.stat(base)
        print(f"  EXISTS: {base} ({stat.st_size} bytes)")
    except:
        print(f"  MISSING: {base}")

sftp.close()
ssh.close()
