#!/usr/bin/env python3
"""Analyse des Naming-Mismatches zwischen OL-Layer-Namen und MapTip linked_layer."""
import paramiko, json

HOST = "nwow.mapplus.ch"
USER = "trigonet"
PW = "3Zs,k4%Un,<[W(Kx"

ssh = paramiko.Transport((HOST, 22))
ssh.connect(username=USER, password=PW)
sftp = paramiko.SFTPClient.from_transport(ssh)

# -- Layer-Keys aus allen layers*.conf --
all_layer_keys = {}  # key -> source file
layer_files = sorted([f for f in sftp.listdir('/www/core/config') if f.startswith('layers') and f.endswith('.conf')])
for lf in layer_files:
    with sftp.open(f'/www/core/config/{lf}', 'r') as f:
        for k in json.load(f):
            all_layer_keys[k] = f'core/{lf}'
with sftp.open('/www/maps/public/config/layers.conf', 'r') as f:
    for k in json.load(f):
        all_layer_keys[k] = 'public/layers.conf'

# -- MapTip linked_layers --
all_maptips = {}  # maptip_key -> linked_layer
mt_files = sorted([f for f in sftp.listdir('/www/core/config') if f.startswith('maptips') and f.endswith('.conf')])
for mf in mt_files:
    with sftp.open(f'/www/core/config/{mf}', 'r') as f:
        for k, v in json.load(f).items():
            if k != 'general_settings' and isinstance(v, dict):
                ll = v.get('linked_layer')
                if ll:
                    all_maptips[k] = {'linked_layer': ll, 'source': f'core/{mf}'}
with sftp.open('/www/maps/public/config/maptips.conf', 'r') as f:
    for k, v in json.load(f).items():
        if k != 'general_settings' and isinstance(v, dict):
            ll = v.get('linked_layer')
            if ll:
                all_maptips[k] = {'linked_layer': ll, 'source': 'public/maptips.conf'}

all_ll = set(m['linked_layer'] for m in all_maptips.values())

# -- OL-Layer-Namen aus lyrmgr items --
with sftp.open('/www/maps/public/config/lyrmgr.conf', 'r') as f:
    lyrmgr = json.load(f)

ol_names = set()
def ext(obj):
    if isinstance(obj, list):
        for v in obj:
            if isinstance(v, str):
                ol_names.add(v)
            elif isinstance(v, dict):
                ext(v)
    elif isinstance(obj, dict):
        if 'items' in obj:
            ext(obj['items'])
        for k, v in obj.items():
            if k in ('structure',):
                ext(v)
            elif isinstance(v, dict):
                ext(v)

for lid in lyrmgr:
    m = lyrmgr[lid]
    if isinstance(m, dict) and 'structure' in m:
        ext(m['structure'])

print(f'Layer-Keys (layers*.conf):           {len(all_layer_keys)}')
print(f'MapTip entries:                      {len(all_maptips)}')
print(f'MapTip unique linked_layer values:   {len(all_ll)}')
print(f'OL-Layer-Namen (lyrmgr items):       {len(ol_names)}')
print()

m1 = all_ll & set(all_layer_keys.keys())
m2 = all_ll & ol_names
m3 = set(all_layer_keys.keys()) & ol_names

print(f'linked_layer <-> layer-keys:    {len(m1)}/{len(all_ll)} matches')
print(f'linked_layer <-> OL-name:       {len(m2)}/{len(all_ll)} matches')
print(f'layer-keys <-> OL-name:         {len(m3)}/{len(all_layer_keys)} matches')
print()

# Beispiele zeigen
print('=== Beispiele: linked_layer die KEIN OL-Layer-Match haben (erste 20) ===')
no_match = sorted(all_ll - ol_names)
for v in no_match[:20]:
    print(f'  {v}')
print()

print('=== Beispiele: OL-Layer-Namen aus lyrmgr (erste 20) ===')
for v in sorted(ol_names)[:20]:
    print(f'  {v}')
print()

print('=== linked_layer die MIT OL-Layer matchen ===')
for v in sorted(m2):
    print(f'  {v}')
print()

# Mustererkennung: Was ist das Pattern?
print('=== PATTERN-ANALYSE ===')
print()
ll_with_slash = [v for v in all_ll if '/' in v]
ll_without_slash = [v for v in all_ll if '/' not in v]
ol_with_slash = [v for v in ol_names if '/' in v]
ol_without_slash = [v for v in ol_names if '/' not in v]
print(f'linked_layer mit /: {len(ll_with_slash)}   ohne /: {len(ll_without_slash)}')
print(f'OL-Layer mit /:     {len(ol_with_slash)}   ohne /: {len(ol_without_slash)}')
print()

# Check: Ist linked_layer ein Suffix/Teilstring eines OL-Layers?
print('=== SUFFIX/TEILSTRING-MATCHING ===')
suffix_matches = []
for ll_val in sorted(all_ll):
    for ol_val in ol_names:
        if ol_val.endswith('/' + ll_val) or ol_val == ll_val:
            suffix_matches.append((ll_val, ol_val))
            break
    else:
        # Prüfe ob linked_layer ein Präfix oder Sublayer ist
        for ol_val in ol_names:
            if ll_val.startswith(ol_val + '/'):
                suffix_matches.append((ll_val, f'{ol_val} (OL ist Präfix)'))
                break

print(f'Suffix/Teilstring-Matches: {len(suffix_matches)}/{len(all_ll)}')
for ll_val, ol_val in suffix_matches[:30]:
    print(f'  linked_layer: {ll_val}  <->  OL: {ol_val}')

sftp.close()
ssh.close()
