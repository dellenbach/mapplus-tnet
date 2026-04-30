#!/usr/bin/env python3
"""Upload API-Dateien zum Server und teste Clean URLs + Cache"""
import os
import sys
import argparse
import paramiko

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "deployment"))
from deploy_env import add_env_argument, ensure_local_base_exists, resolve_deploy_config

HOST = "nwow.mapplus.ch"
PORT = 22
USER = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"
REMOTE_BASE = ""
LOCAL_BASE = ""

FILES = [
    "tnet/api/v1/legend-proxy.php",
    "tnet/api/v1/legend-proxy-wms.php",
    "tnet/api/docs/openapi.yaml",
]

def main():
    global LOCAL_BASE, REMOTE_BASE

    parser = argparse.ArgumentParser(description="API-Debug-Dateien fuer dev oder prod deployen")
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
