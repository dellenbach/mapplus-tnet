#!/usr/bin/env python3
"""Upload basemaps.conf and tnet-global-config.json5 to SFTP server"""
import os
import paramiko

HOST = "nwow.mapplus.ch"
PORT = 22
USER = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"
REMOTE_BASE = "/www"
LOCAL_BASE = r"c:\_Daten\mapplus-exp"

FILES = [
    ("core/config/basemaps.conf", "/www/core/config/basemaps.conf"),
    ("maps/tnet/config/tnet-global-config.json5", "/www/maps/tnet/config/tnet-global-config.json5"),
]

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, PORT, USER, PASSWORD)
sftp = ssh.open_sftp()

for local_rel, remote in FILES:
    local = os.path.join(LOCAL_BASE, local_rel.replace("/", os.sep))
    sftp.put(local, remote)
    size = os.path.getsize(local)
    print(f"  OK {local_rel} ({size:,} bytes)")

sftp.close()
ssh.close()
print("Done.")
