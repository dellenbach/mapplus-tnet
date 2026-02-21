#!/usr/bin/env python3
"""Upload API-Dateien zum Server und teste Clean URLs + Cache"""
import paramiko
import os

HOST = "nwow.mapplus.ch"
PORT = 22
USER = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"
REMOTE_BASE = "/www/maps"
LOCAL_BASE = r"c:\_Daten\mapplus-exp\maps"

FILES = [
    "tnet/api/includes/JsonCache.php",
    "tnet/api/v1/cache.php",
    "tnet/api/v1/layers.php",
    "tnet/api/v1/server-check.php",
    "tnet/api/.htaccess",
]

def main():
    print(f"Verbinde zu {HOST}...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    
    try:
        ssh.connect(HOST, PORT, USER, PASSWORD)
        sftp = ssh.open_sftp()
        
        for f in FILES:
            local = os.path.join(LOCAL_BASE, f.replace('/', '\\'))
            remote = f"{REMOTE_BASE}/{f}"
            
            if not os.path.exists(local):
                print(f"  ⚠ {f} (nicht gefunden)")
                continue
            
            sftp.put(local, remote)
            size = os.path.getsize(local)
            print(f"  ✓ {f} ({size:,} bytes)")
        
        sftp.close()
        ssh.close()
        print("\n✓ Upload fertig")
        
    except Exception as e:
        print(f"✗ Fehler: {e}")
        return False
    
    return True

if __name__ == "__main__":
    main()
