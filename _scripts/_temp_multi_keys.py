#!/usr/bin/env python3
"""Genau die multi conf keys lesen — ALLE"""
import paramiko, json

HOST = "nwow.mapplus.ch"
PORT = 22
USER = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, PORT, USER, PASSWORD)
sftp = ssh.open_sftp()

# Die multi.conf lesen
fpath = "/www/core/config/layers_tnet_oereb_multi.conf"
with sftp.open(fpath, 'r') as f:
    content = f.read().decode('utf-8')
data = json.loads(content)
print(f"=== layers_tnet_oereb_multi.conf: {len(data)} keys ===")
for k in sorted(data.keys()):
    v = data[k]
    url_end = ''
    if isinstance(v, dict) and 'url' in v:
        url_end = v['url'].split('/services/')[-1] if '/services/' in v['url'] else ''
    print(f"  '{k}' → {url_end}")

# Die single.conf lesen (nur die nw_nutzungsplanung_def sublayers)
fpath2 = "/www/core/config/layers_tnet_oereb_sinlge.conf"
with sftp.open(fpath2, 'r') as f:
    content2 = f.read().decode('utf-8')
data2 = json.loads(content2)
nutz = {k: v for k, v in data2.items() if 'nw_nutzungsplanung_def' in k.lower()}
print(f"\n=== layers_tnet_oereb_sinlge.conf: nw_nutzungsplanung_def sublayer keys ({len(nutz)}) ===")
for k in sorted(nutz.keys()):
    v = nutz[k]
    sublayers = v.get('sublayers', '') if isinstance(v, dict) else ''
    visible = v.get('visible', '') if isinstance(v, dict) else ''
    url_end = ''
    if isinstance(v, dict) and 'url' in v:
        url_end = v['url'].split('/services/')[-1] if '/services/' in v['url'] else ''
    print(f"  '{k}' → sublayers: {sublayers}, visible: {visible}, url: {url_end}")

sftp.close()
ssh.close()
