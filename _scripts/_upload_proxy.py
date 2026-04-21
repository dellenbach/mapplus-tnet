#!/usr/bin/env python3
"""Upload proxy-related files to SFTP server"""
import os
import paramiko

HOST = "nwow.mapplus.ch"
PORT = 22
USER = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"
REMOTE_BASE = "/www/maps"
LOCAL_BASE = r"c:\_Daten\mapplus-exp\maps"

FILES = [
    "tnet/php/active-maps-proxy.php",
    "tnet/js/tnet-proxy-inject.js",
    "tnet/js/tnet-mapplus-helpers.js",
    "tnet/views/inframe-maps.html",
]

def upload():
    print(f"Verbinde zu {HOST}...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, PORT, USER, PASSWORD)
    sftp = ssh.open_sftp()

    for f in FILES:
        local = os.path.join(LOCAL_BASE, f.replace('/', os.sep))
        remote = f"{REMOTE_BASE}/{f}"
        if os.path.exists(local):
            sftp.put(local, remote)
            print(f"  OK {f} ({os.path.getsize(local)} bytes)")
        else:
            print(f"  SKIP {f}")

    sftp.close()
    ssh.close()
    print("Done")

if __name__ == "__main__":
    upload()
