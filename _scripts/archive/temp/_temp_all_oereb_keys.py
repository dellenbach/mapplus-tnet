#!/usr/bin/env python3
"""ALLE Schlüssel aus multi/single OEREB configs lesen"""
import paramiko, json

HOST = "nwow.mapplus.ch"
PORT = 22
USER = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, PORT, USER, PASSWORD)
sftp = ssh.open_sftp()

base = "/www/core/config"

for fname in ["layers_tnet_oereb_multi.conf", "layers_tnet_oereb_sinlge.conf", 
              "maptips_tnet_oereb_multi.conf", "maptips_tnet_oereb_sinlge.conf"]:
    fpath = f"{base}/{fname}"
    try:
        with sftp.open(fpath, 'r') as f:
            content = f.read().decode('utf-8')
        data = json.loads(content)
        keys = sorted(data.keys())
        print(f"\n=== {fname}: {len(keys)} keys ===")
        for k in keys:
            v = data[k]
            extra = ""
            if isinstance(v, dict):
                if 'url' in v:
                    extra = f" → {v['url'][-60:]}"
                if 'linked_layer' in v:
                    extra = f" → linked_layer: {v['linked_layer']}"
            print(f"  {k}{extra}")
    except Exception as ex:
        print(f"\n=== {fname}: ERROR: {ex}")

# Auch die public/config/layers.conf komplett zeigen
fpath = "/www/maps/public/config/layers.conf"
try:
    with sftp.open(fpath, 'r') as f:
        content = f.read().decode('utf-8')
    data = json.loads(content)
    # Alle Keys zeigen die gis_oereb in URL haben
    oereb_keys = {}
    for k, v in data.items():
        if isinstance(v, dict) and 'url' in v:
            url = v['url']
            if 'gis_oereb' in url and 'nutzungsplanung' in url:
                oereb_keys[k] = v
    print(f"\n=== public/config/layers.conf: gis_oereb+nutzungsplanung URL keys ({len(oereb_keys)}) ===")
    for k in sorted(oereb_keys.keys()):
        v = oereb_keys[k]
        sublayers = v.get('sublayers') or v.get('layers') or ''
        print(f"  KEY: '{k}'  sublayers: {sublayers}  visible: {v.get('visible')}")
        print(f"    url: {v.get('url','')}")
except Exception as ex:
    print(f"\n=== layers.conf: {ex}")

sftp.close()
ssh.close()
