#!/usr/bin/env python3
"""Check basemaps.conf on server"""
import json
import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('nwow.mapplus.ch', 22, 'trigonet', '3Zs,k4%Un,<[W(Kx')
sftp = ssh.open_sftp()

with sftp.open('/www/core/config/basemaps.conf', 'r') as f:
    content = f.read().decode()

print(f'File size: {len(content)} bytes')

try:
    data = json.loads(content)
    print(f'Valid JSON ✓')
    print(f'Keys ({len(data)}): {list(data.keys())}')
    for key in ['pk_color', 'siegfried', 'dufour', 'osm', 'leer']:
        if key in data:
            print(f'  {key}: type={data[key].get("type", "?")}')
        else:
            print(f'  {key}: MISSING!')
except json.JSONDecodeError as e:
    print(f'JSON Error: {e}')
    print(f'Near position {e.pos}: ...{content[max(0,e.pos-50):e.pos+50]}...')

sftp.close()
ssh.close()
