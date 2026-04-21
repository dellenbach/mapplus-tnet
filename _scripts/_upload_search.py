#!/usr/bin/env python3
"""Upload search-related files to SFTP server"""
import os
import paramiko

HOST = "nwow.mapplus.ch"
PORT = 22
USER = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"
REMOTE_BASE = "/www/maps"
LOCAL_BASE = r"c:\_Daten\mapplus-exp\maps"

FILES = [
    "tnet/api/search-proxy.php",
    "tnet/js/tnet-search.js",
    "tnet/js/mobile/tnet-search-m.js",
]

def upload():
    print(f"Verbinde zu {HOST}...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, PORT, USER, PASSWORD)
    sftp = ssh.open_sftp()
    for f in FILES:
        local = os.path.join(LOCAL_BASE, f.replace("/", os.sep))
        remote = REMOTE_BASE + "/" + f
        sftp.put(local, remote)
        stat = sftp.stat(remote)
        print(f"  OK {f} ({stat.st_size:,} bytes)")
    sftp.close()
    ssh.close()
    print(f"Fertig: {len(FILES)} Dateien hochgeladen")

if __name__ == "__main__":
    upload()
