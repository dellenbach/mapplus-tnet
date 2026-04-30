#!/usr/bin/env python3
"""Multi & Single OEREB Config lesen — exakte Schlüsselstruktur vergleichen"""
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

# 1) layers_tnet_oereb_multi.conf
for fname in ["layers_tnet_oereb_multi.conf", "layers_tnet_oereb_sinlge.conf"]:
    fpath = f"{base}/{fname}"
    try:
        with sftp.open(fpath, 'r') as f:
            content = f.read().decode('utf-8')
        data = json.loads(content)
        nutzung = {k: v for k, v in data.items() if 'nutzungsplanung_DEF' in k}
        print(f"\n=== {fname}: nw_nutzungsplanung_DEF keys ===")
        for k in sorted(nutzung.keys()):
            v = nutzung[k]
            if isinstance(v, dict):
                print(f"  KEY: '{k}'")
                for subk in ['url', 'type', 'visible', 'query_layers', 'linked_layer', 'sublayers', 'layers', 'legend']:
                    if subk in v:
                        val = v[subk]
                        print(f"    {subk}: {json.dumps(val) if isinstance(val, (dict,list)) else val}")
    except Exception as ex:
        print(f"\n=== {fname}: ERROR: {ex}")

# 2) layers.conf — nur die relevanten
fpath = "/www/maps/public/config/layers.conf"
try:
    with sftp.open(fpath, 'r') as f:
        content = f.read().decode('utf-8')
    data = json.loads(content)
    nutzung = {k: v for k, v in data.items() if 'nutzungsplanung_DEF' in k}
    print(f"\n=== public/config/layers.conf: nw_nutzungsplanung_DEF keys ===")
    for k in sorted(nutzung.keys()):
        v = nutzung[k]
        if isinstance(v, dict):
            print(f"  KEY: '{k}'")
            for subk in ['url', 'type', 'visible', 'sublayers', 'layers', 'coalesce']:
                if subk in v:
                    val = v[subk]
                    print(f"    {subk}: {json.dumps(val) if isinstance(val, (dict,list)) else val}")
except Exception as ex:
    print(f"\n=== layers.conf: ERROR: {ex}")

# 3) maptips.conf — public
fpath = "/www/maps/public/config/maptips.conf"
try:
    with sftp.open(fpath, 'r') as f:
        content = f.read().decode('utf-8')
    data = json.loads(content)
    nutzung = {k: v for k, v in data.items() if 'nutzungsplanung_DEF' in k}
    print(f"\n=== public/config/maptips.conf: nw_nutzungsplanung_DEF keys ===")
    for k in sorted(nutzung.keys()):
        v = nutzung[k]
        if isinstance(v, dict):
            print(f"  KEY: '{k}'")
            for subk in sorted(v.keys()):
                val = v[subk]
                print(f"    {subk}: {json.dumps(val) if isinstance(val, (dict,list)) else val}")
except Exception as ex:
    print(f"\n=== maptips.conf: ERROR: {ex}")

# 4) maptips multi
fpath = f"{base}/maptips_tnet_oereb_multi.conf"
try:
    with sftp.open(fpath, 'r') as f:
        content = f.read().decode('utf-8')
    data = json.loads(content)
    nutzung = {k: v for k, v in data.items() if 'nutzungsplanung_DEF' in k}
    print(f"\n=== core/maptips_tnet_oereb_multi.conf: nw_nutzungsplanung_DEF keys ===")
    for k in sorted(nutzung.keys()):
        v = nutzung[k]
        if isinstance(v, dict):
            print(f"  KEY: '{k}'")
            for subk in sorted(v.keys()):
                val = v[subk]
                print(f"    {subk}: {json.dumps(val) if isinstance(val, (dict,list)) else val}")
except Exception as ex:
    print(f"\n=== maptips_multi: ERROR: {ex}")

sftp.close()
ssh.close()
