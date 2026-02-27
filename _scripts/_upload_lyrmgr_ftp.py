#!/usr/bin/env python3
"""Upload lyrmgr.conf via FTP (Port 21)"""
import ftplib
import os

HOST = "nwow.mapplus.ch"
USER = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"
LOCAL_FILE = r"c:\_Daten\mapplus-exp\maps\public\config\lyrmgr.conf"
REMOTE_FILE = "/www/maps/public/config/lyrmgr.conf"

print(f"Verbinde zu {HOST} (FTP)...")
try:
    ftp = ftplib.FTP(HOST, timeout=15)
    ftp.login(USER, PASSWORD)
    print(f"  Login OK: {ftp.getwelcome()}")

    with open(LOCAL_FILE, 'rb') as f:
        ftp.storbinary(f'STOR {REMOTE_FILE}', f)
    
    size = os.path.getsize(LOCAL_FILE)
    print(f"  ✓ lyrmgr.conf hochgeladen ({size:,} bytes)")
    ftp.quit()
except Exception as e:
    print(f"  ✗ FTP Fehler: {e}")
    # Try SFTP as fallback
    print("\nVersuche SFTP (Port 22)...")
    try:
        import paramiko
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect(HOST, 22, USER, PASSWORD, timeout=15)
        sftp = ssh.open_sftp()
        sftp.put(LOCAL_FILE, REMOTE_FILE)
        info = sftp.stat(REMOTE_FILE)
        print(f"  ✓ lyrmgr.conf hochgeladen ({info.st_size:,} bytes)")
        sftp.close()
        ssh.close()
    except Exception as e2:
        print(f"  ✗ SFTP Fehler: {e2}")
