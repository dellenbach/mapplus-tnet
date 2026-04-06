#!/usr/bin/env python3
"""Löscht den Legenden-Cache auf dem Server via SFTP"""
import paramiko

HOST = "nwow.mapplus.ch"
PORT = 22
USER = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"
CACHE_DIR = "/data/Client_Data/nwow/tmp/legends"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, PORT, USER, PASSWORD)
sftp = ssh.open_sftp()

files = sftp.listdir(CACHE_DIR)
count = 0
for f in files:
    if f.endswith('.html') or f.endswith('.json'):
        sftp.remove(CACHE_DIR + '/' + f)
        count += 1

print(f'Deleted {count} cache files from {CACHE_DIR}')
sftp.close()
ssh.close()
