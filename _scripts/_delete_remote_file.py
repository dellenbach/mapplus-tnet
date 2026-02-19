#!/usr/bin/env python3
"""Delete a file on the SFTP server"""
import paramiko

HOST = "nwow.mapplus.ch"
PORT = 22
USER = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"

REMOTE_FILE = "/www/maps/tnet/js/tnet-basemap-time.js"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, PORT, USER, PASSWORD)
sftp = ssh.open_sftp()

try:
    sftp.remove(REMOTE_FILE)
    print(f"✓ Gelöscht: {REMOTE_FILE}")
except FileNotFoundError:
    print(f"⚠ Nicht gefunden: {REMOTE_FILE}")

sftp.close()
ssh.close()
