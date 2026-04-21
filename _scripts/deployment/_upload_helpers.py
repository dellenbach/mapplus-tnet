#!/usr/bin/env python3
"""Upload tnet-mapplus-helpers.js to BOTH server paths"""
import paramiko

HOST = "nwow.mapplus.ch"
PORT = 22
USER = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"
LOCAL = r"c:\_Daten\mapplus-exp\maps\tnet\js\tnet-mapplus-helpers.js"

# index_de.htm referenziert /maps/tnet/tnet-mapplus-helpers.js
# proxy referenziert       /maps/tnet/js/tnet-mapplus-helpers.js
REMOTES = [
    "/www/maps/tnet/tnet-mapplus-helpers.js",
    "/www/maps/tnet/js/tnet-mapplus-helpers.js",
]

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, PORT, USER, PASSWORD)
sftp = ssh.open_sftp()

for remote in REMOTES:
    try:
        sftp.put(LOCAL, remote)
        print(f"  OK {remote}")
    except Exception as e:
        print(f"  FAIL {remote}: {e}")

sftp.close()
ssh.close()
print("Done")
