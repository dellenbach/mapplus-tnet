#!/usr/bin/env python3
"""Upload preview images and CSS to SFTP server"""
import os
import paramiko

HOST = "nwow.mapplus.ch"
PORT = 22
USER = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"
REMOTE_BASE = "/www/maps"
LOCAL_BASE = r"c:\_Daten\mapplus-exp\maps"

FILES = [
    "tnet/resources/preview-swissimage.png",
    "tnet/resources/preview-siegfried.png",
    "tnet/resources/preview-landeskarte.png",
    "tnet/resources/preview-dufour.png",
    "public/css/override.css",
]

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, PORT, USER, PASSWORD)
sftp = ssh.open_sftp()

for f in FILES:
    local = os.path.join(LOCAL_BASE, f.replace("/", os.sep))
    remote = f"{REMOTE_BASE}/{f}"
    sftp.put(local, remote)
    size = os.path.getsize(local)
    print(f"  OK {f} ({size:,} bytes)")

sftp.close()
ssh.close()
print("Done.")
