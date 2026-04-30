#!/usr/bin/env python3
"""Upload fixed files, check parent .htaccess, test cache + clean URLs"""
import os
import sys
import argparse
import urllib.request
import json
import ssl
import paramiko

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "deployment"))
from deploy_env import add_env_argument, ensure_local_base_exists, resolve_deploy_config

HOST = "nwow.mapplus.ch"
PORT = 22
USER = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"
REMOTE_BASE = ""
LOCAL_BASE = ""
BASE_URL = ""

def sftp_connect():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, PORT, USER, PASSWORD)
    return ssh, ssh.open_sftp()

def http_get(path):
    ctx = ssl.create_default_context()
    url = f"{BASE_URL}{path}"
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, context=ctx) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, None
    except Exception as e:
        return 0, str(e)

def main():
    global REMOTE_BASE, LOCAL_BASE, BASE_URL

    parser = argparse.ArgumentParser(description="Server-Permissions und API fuer dev oder prod pruefen")
    add_env_argument(parser)
    args = parser.parse_args()

    deploy_config = resolve_deploy_config(args.env)
    LOCAL_BASE = os.path.normpath(deploy_config["local_base"])
    REMOTE_BASE = deploy_config["remote_base"]
    BASE_URL = f"https://www.gis-daten.ch/{os.path.basename(REMOTE_BASE)}/tnet/api"
    ensure_local_base_exists(LOCAL_BASE)

    # 1. Upload fixed JsonCache.php
    print(f"=== Upload ({deploy_config['env']}) ===")
    ssh, sftp = sftp_connect()
    
    files = [
        "tnet/api/includes/JsonCache.php",
    ]
    for f in files:
        local = os.path.join(LOCAL_BASE, f.replace('/', '\\'))
        remote = f"{REMOTE_BASE}/{f}"
        sftp.put(local, remote)
        print(f"  ✓ {f}")
    
    # 2. Download parent .htaccess
    print("\n=== Parent .htaccess ===")
    try:
        with sftp.open(f"{REMOTE_BASE}/.htaccess", "r") as f:
            content = f.read().decode()
            print(content)
    except Exception as e:
        print(f"  ✗ Nicht gefunden: {e}")
    
    sftp.close()
    ssh.close()
    
    # 3. Test Cache (nach /tmp Fallback)
    print("\n=== Cache Test ===")
    status, data = http_get("/v1/cache.php")
    if data:
        d = data.get('data', {})
        print(f"  cacheDir:  {d.get('cacheDir')}")
        print(f"  writable:  {d.get('writable')}")
        print(f"  entries:   {d.get('entries')}")
    
    # 4. Layers-Request (sollte nun cachen)
    print("\n=== Layers Test (1. Request = Miss) ===")
    status, data = http_get("/v1/layers.php?details=false")
    if data:
        meta = data.get('meta', {})
        print(f"  cache:     {meta.get('cache')}")
        print(f"  time:      {meta.get('responseTime')}")
        if 'cacheError' in meta:
            print(f"  ERROR:     {meta.get('cacheError')}")
            print(f"  writable:  {meta.get('cacheWritable')}")
    
    print("\n=== Layers Test (2. Request = Hit?) ===")
    status, data = http_get("/v1/layers.php?details=false")
    if data:
        meta = data.get('meta', {})
        print(f"  cache:     {meta.get('cache')}")
        print(f"  time:      {meta.get('responseTime')}")
    
    # 5. Clean URL Test
    print("\n=== Clean URL Test ===")
    for path in ["/v1/info", "/v1/layers?details=false", "/v1/cache"]:
        status, _ = http_get(path)
        print(f"  {path}: {status}")
    
    print("\n✓ Fertig")

if __name__ == "__main__":
    main()
