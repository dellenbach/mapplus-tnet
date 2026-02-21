#!/usr/bin/env python3
"""Upload fixed files, check parent .htaccess, test cache + clean URLs"""
import paramiko
import os
import urllib.request
import json
import ssl

HOST = "nwow.mapplus.ch"
PORT = 22
USER = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"
REMOTE_BASE = "/www/maps"
LOCAL_BASE = r"c:\_Daten\mapplus-exp\maps"
BASE_URL = "https://www.gis-daten.ch/maps/tnet/api"

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
    # 1. Upload fixed JsonCache.php
    print("=== Upload ===")
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
        with sftp.open("/www/maps/.htaccess", "r") as f:
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
