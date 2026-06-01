#!/usr/bin/env python3
"""Upload DB/API files to SFTP server and create remote directories"""
import os
import sys
import argparse
import paramiko

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "deployment", "deployengine"))
from deploy_env import add_env_argument, ensure_local_base_exists, resolve_deploy_config

# SFTP Config
HOST = "nwow.mapplus.ch"
PORT = 22
USER = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"
REMOTE_BASE = ""
LOCAL_BASE = ""

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
    global LOCAL_BASE, REMOTE_BASE

    parser = argparse.ArgumentParser(description="DB/API-Dateien fuer dev oder prod deployen")
    add_env_argument(parser)
    args = parser.parse_args()

    deploy_config = resolve_deploy_config(args.env)
    LOCAL_BASE = os.path.normpath(deploy_config["local_base"])
    REMOTE_BASE = deploy_config["remote_base"]
    ensure_local_base_exists(LOCAL_BASE)

    print(f"Verbinde zu {HOST} ({deploy_config['env']} -> {REMOTE_BASE})...")
    
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
