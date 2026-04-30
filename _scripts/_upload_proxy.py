#!/usr/bin/env python3
"""Upload proxy-related files to SFTP server"""
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
    "tnet/php/active-maps-proxy.php",
    "tnet/js/tnet-proxy-inject.js",
    "tnet/js/tnet-mapplus-helpers.js",
    "tnet/views/inframe-maps.html",
]

def upload():
    global LOCAL_BASE, REMOTE_BASE

    parser = argparse.ArgumentParser(description="Proxy-Dateien fuer dev oder prod deployen")
    add_env_argument(parser)
    args = parser.parse_args()

    deploy_config = resolve_deploy_config(args.env)
    LOCAL_BASE = os.path.normpath(deploy_config["local_base"])
    REMOTE_BASE = deploy_config["remote_base"]
    ensure_local_base_exists(LOCAL_BASE)

    print(f"Verbinde zu {HOST} ({deploy_config['env']} -> {REMOTE_BASE})...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, PORT, USER, PASSWORD)
    sftp = ssh.open_sftp()

    for f in FILES:
        local = os.path.join(LOCAL_BASE, f.replace('/', os.sep))
        remote = f"{REMOTE_BASE}/{f}"
        if os.path.exists(local):
            sftp.put(local, remote)
            print(f"  OK {f} ({os.path.getsize(local)} bytes)")
        else:
            print(f"  SKIP {f}")

    sftp.close()
    ssh.close()
    print("Done")

if __name__ == "__main__":
    upload()
