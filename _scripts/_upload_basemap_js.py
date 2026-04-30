#!/usr/bin/env python3
"""Upload basemap JS consolidation files to SFTP server"""
import os
import sys
import argparse
import paramiko

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "deployment"))
from deploy_env import add_env_argument, ensure_local_base_exists, resolve_deploy_config

# SFTP Config
HOST = "nwow.mapplus.ch"
PORT = 22
USER = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"
REMOTE_BASE = ""
LOCAL_BASE = ""

# Files to upload - Basemap Selector Fixes
FILES = [
    "public/css/override.css",
    "public/index_de.htm",
    "public/config/basemaps_mgr.conf",
    "tnet/js/tnet-basemap.js",
    "tnet/config/tnet-global-config.json5",
    "tnet/resources/preview-osm.png",
    "tnet/resources/preview-swisstlm.png",
    "tnet/resources/preview-swissimage.png",
    "tnet/resources/preview-landeskarte.png",
    "tnet/resources/preview-siegfried.png",
    "tnet/resources/preview-dufour.png",
]

WORKSPACE_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), ".."))


def get_extra_files(env_name, local_base):
    """Liefert env-spezifische Zusatzdateien ausserhalb des normalen maps-Trees."""
    if env_name == "prod":
        return [
            (
                os.path.normpath(os.path.join(WORKSPACE_ROOT, "core", "config", "basemaps.conf")),
                "/www/core/config/basemaps.conf",
            ),
        ]

    dev_core_file = os.path.normpath(os.path.join(local_base, "core", "config", "basemaps.conf"))
    return [
        (
            dev_core_file,
            "/www/maps-dev/core/config/basemaps.conf",
        ),
    ]

def upload_files():
    global LOCAL_BASE, REMOTE_BASE

    parser = argparse.ArgumentParser(description="Basemap-Dateien fuer dev oder prod deployen")
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

        for local_file, remote_file in get_extra_files(deploy_config["env"], LOCAL_BASE):
            if not os.path.exists(local_file):
                print(f"  ⚠ {remote_file} (lokale Quelle fehlt: {local_file})")
                skipped += 1
                continue
            try:
                sftp.put(local_file, remote_file)
                size = os.path.getsize(local_file)
                print(f"  ✓ {remote_file} ({size:,} bytes)")
                uploaded += 1
            except Exception as e:
                print(f"  ✗ {remote_file} - Fehler: {e}")
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
