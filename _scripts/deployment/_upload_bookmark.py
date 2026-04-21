#!/usr/bin/env python3
"""Upload bookmark-service.php to server"""
import paramiko

HOST = "nwow.mapplus.ch"
PORT = 22
USER = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"
LOCAL = r"c:\_Daten\mapplus-exp\maps\tnet\php\bookmark-service.php"

REMOTES = [
    "/www/maps/tnet/bookmark-service.php",
    "/www/maps/tnet/php/bookmark-service.php",
]

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, PORT, USER, PASSWORD)
sftp = ssh.open_sftp()

for remote in REMOTES:
    sftp.put(LOCAL, remote)
    print(f"  OK {remote}")

sftp.close()
ssh.close()
print("Done")
