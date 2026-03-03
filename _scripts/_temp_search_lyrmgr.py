#!/usr/bin/env python3
"""Suche nach switchLayersProgr und verwandten Methoden in der mapplus-dojo Bibliothek auf dem Server."""
import paramiko, stat, sys

HOST = "nwow.mapplus.ch"
PORT = 22
USER = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"

ssh = paramiko.Transport((HOST, PORT))
ssh.connect(username=USER, password=PASSWORD)
sftp = paramiko.SFTPClient.from_transport(ssh)

search_terms = [
    b'switchLayersProgr',
    b'_removeLayerFromMap',
    b'_uncheckLayer',
    b'_onCheckboxClick',
    b'_setLayerVisible',
    b'ClassicLayerMgr',
]

# Schritt 1: nwow_floating und core templates erkunden
print("=== Schritt 1: Verzeichnisstruktur erkunden ===")
for base_path in ['/www/core/templates', '/www/core/templates/nwow_floating', '/www/core/templates/nwow_floating/js', '/www/nwow/core', '/www/nwow/public']:
    try:
        items = sftp.listdir(base_path)
        print(f"\n{base_path}/:")
        for item in sorted(items):
            print(f"  {item}")
    except Exception as e:
        print(f"\n{base_path}/: ERROR: {e}")

# Versuche verschiedene Pfade
search_dirs = [
    '/mapplus-lib/mapplus-dojo',
    '/www/mapplus-lib/mapplus-dojo',
    '/mapplus-lib',
    '/www/mapplus-lib',
]

def list_dir_recursive(path, depth=0, max_depth=3):
    if depth > max_depth:
        return
    try:
        items = sftp.listdir_attr(path)
    except:
        return
    for item in items:
        full = path + '/' + item.filename
        is_dir = stat.S_ISDIR(item.st_mode)
        prefix = '  ' * depth
        if is_dir:
            print(f'{prefix}{item.filename}/')
            list_dir_recursive(full, depth + 1, max_depth)
        elif item.filename.endswith('.js') and depth <= 2:
            print(f'{prefix}{item.filename}  ({item.st_size} bytes)')

for sd in search_dirs:
    try:
        sftp.listdir(sd)
        print(f"\n=== Struktur von {sd} (depth 3) ===")
        list_dir_recursive(sd, max_depth=3)
        break
    except:
        continue

def search_recursive(path, depth=0):
    if depth > 6:
        return
    try:
        items = sftp.listdir_attr(path)
    except Exception as e:
        print(f"ERROR listing {path}: {e}")
        return
    for item in items:
        full = path + '/' + item.filename
        if item.filename.startswith('.'):
            continue
        is_dir = stat.S_ISDIR(item.st_mode)
        if is_dir:
            search_recursive(full, depth + 1)
        elif item.filename.endswith('.js'):
            try:
                with sftp.open(full, 'r') as f:
                    content = f.read()
                    found_any = False
                    for term in search_terms:
                        if term in content:
                            found_any = True
                    if found_any:
                        lines = content.split(b'\n')
                        for i, line in enumerate(lines):
                            for term in search_terms:
                                if term in line:
                                    print(f"[{term.decode()}] {full}:{i+1}")
                                    print(f"  {line.decode('utf-8', errors='replace').strip()[:250]}")
            except Exception as e:
                print(f"ERROR reading {full}: {e}")

# Suche in allen möglichen Pfaden
for sd in search_dirs:
    try:
        sftp.listdir(sd)
        print(f"\n=== Suche in {sd} ===")
        search_recursive(sd)
    except:
        continue
print("=" * 70)
print("Done.")

sftp.close()
ssh.close()
