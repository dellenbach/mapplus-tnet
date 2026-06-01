#!/usr/bin/env python3
"""Upload search-related files to SFTP server"""
import os
import sys
import argparse
import paramiko

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "deployment", "deployengine"))
from deploy_env import add_env_argument, ensure_local_base_exists, resolve_deploy_config

HOST = "nwow.mapplus.ch"
PORT = 22
USER = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"
REMOTE_BASE = ""
LOCAL_BASE = ""

FILES = [
    "tnet/api/search-proxy.php",
    "tnet/js/tnet-search.js",
    "tnet/js/mobile/tnet-search-m.js",
]

def upload():
    global LOCAL_BASE, REMOTE_BASE

    parser = argparse.ArgumentParser(description="Search-Dateien fuer dev oder prod deployen")
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
        local = os.path.join(LOCAL_BASE, f.replace("/", os.sep))
        remote = REMOTE_BASE + "/" + f
        sftp.put(local, remote)
        stat = sftp.stat(remote)
        print(f"  OK {f} ({stat.st_size:,} bytes)")
    sftp.close()
    ssh.close()
    print(f"Fertig: {len(FILES)} Dateien hochgeladen")

if __name__ == "__main__":
    upload()
