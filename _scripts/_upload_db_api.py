#!/usr/bin/env python3
"""Upload DB/API files to SFTP server and create remote directories"""
import os
import paramiko

# SFTP Config
HOST = "nwow.mapplus.ch"
PORT = 22
USER = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"
REMOTE_BASE = "/www/maps"
LOCAL_BASE = r"c:\_Daten\mapplus-exp\maps"

# Files to upload - DB API Implementation
FILES = [
    "tnet/js/tnet-mapplus-helpers.js",
    "tnet/api/v1/bookmarks.php",
]

def ensure_remote_dir(sftp, remote_path):
    """Erstellt Remote-Verzeichnis rekursiv falls nötig"""
    dirs = []
    while True:
        try:
            sftp.stat(remote_path)
            break
        except FileNotFoundError:
            dirs.append(remote_path)
            remote_path = os.path.dirname(remote_path)
    
    for d in reversed(dirs):
        try:
            sftp.mkdir(d)
            print(f"  📁 Verzeichnis erstellt: {d}")
        except Exception:
            pass

def upload_files():
    print(f"Verbinde zu {HOST}...")
    
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    
    try:
        ssh.connect(HOST, PORT, USER, PASSWORD)
        sftp = ssh.open_sftp()
        
        uploaded = 0
        skipped = 0
        
        for file_path in FILES:
            local_file = os.path.join(LOCAL_BASE, file_path.replace('/', '\\'))
            remote_file = f"{REMOTE_BASE}/{file_path}"
            
            if not os.path.exists(local_file):
                print(f"  ! {file_path} (nicht gefunden)")
                skipped += 1
                continue
            
            # Remote-Verzeichnis sicherstellen
            remote_dir = os.path.dirname(remote_file)
            ensure_remote_dir(sftp, remote_dir)
            
            try:
                sftp.put(local_file, remote_file)
                size = os.path.getsize(local_file)
                print(f"  OK {file_path} ({size:,} bytes)")
                uploaded += 1
            except Exception as e:
                print(f"  FAIL {file_path} - Fehler: {e}")
                skipped += 1
        
        sftp.close()
        ssh.close()
        
        print(f"\nFertig: {uploaded} hochgeladen, {skipped} uebersprungen")
        
    except Exception as e:
        print(f"Verbindungsfehler: {e}")
        return False
    
    return True

if __name__ == "__main__":
    upload_files()
