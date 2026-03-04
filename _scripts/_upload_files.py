#!/usr/bin/env python3
"""Upload changed files to SFTP server"""
import os
import paramiko

# SFTP Config
HOST = "nwow.mapplus.ch"
PORT = 22
USER = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"
REMOTE_BASE = "/www/maps"
LOCAL_BASE = r"c:\_Daten\mapplus-exp\maps"

# Files to upload
FILES = [
    # Neues zentrales Logging
    "tnet/js/tnet-log.js",
    # HTML mit tnet-log.js Script-Tag
    "public/index_de.htm",
    "public/index_de_m.htm",
    # JS-Dateien mit TnetLog-Migration
    "tnet/js/tnet-3d-landscape.js",
    "tnet/js/tnet-3d-landscape-config.js",
    "tnet/js/tnet-accordion-resize.js",
    "tnet/js/tnet-basemap.js",
    "tnet/js/tnet-catalog-filter.js",
    "tnet/js/tnet-lm-active.js",
    "tnet/js/tnet-lm-init.js",
    "tnet/js/tnet-lm-store.js",
    "tnet/js/tnet-lm-tree.js",
    "tnet/js/tnet-map-footer.js",
    "tnet/js/tnet-mapplus-helpers.js",
    "tnet/js/tnet-oereb.js",
    "tnet/js/tnet-print.js",
    "tnet/js/tnet-search.js",
    "tnet/js/tnet-spatial-query.js",
    "tnet/js/tnet-splitscreen-catalog.js",
    "tnet/js/tnet-wms-panel.js",
]

def upload_files():
    print(f"Verbinde zu {HOST}...")
    
    # SSH Client
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
                print(f"  ⚠ {file_path} (nicht gefunden)")
                skipped += 1
                continue
            
            try:
                sftp.put(local_file, remote_file)
                size = os.path.getsize(local_file)
                print(f"  ✓ {file_path} ({size:,} bytes)")
                uploaded += 1
            except Exception as e:
                print(f"  ✗ {file_path} - Fehler: {e}")
                skipped += 1
        
        sftp.close()
        ssh.close()
        
        print(f"\n✓ Fertig: {uploaded} hochgeladen, {skipped} übersprungen")
        
    except Exception as e:
        print(f"✗ Verbindungsfehler: {e}")
        return False
    
    return True

if __name__ == "__main__":
    upload_files()
