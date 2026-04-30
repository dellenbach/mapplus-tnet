#!/usr/bin/env python3
"""OEREB Config-Verzeichnis auflisten und Schlüsselstrukturen analysieren"""
import paramiko
import json

HOST = "nwow.mapplus.ch"
PORT = 22
USER = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, PORT, USER, PASSWORD)
sftp = ssh.open_sftp()

# 1) OEREB Verzeichnis auflisten
oereb_path = "/www/maps/public/config/oereb"
print(f"=== {oereb_path}/ ===")
try:
    entries = sftp.listdir_attr(oereb_path)
    for e in sorted(entries, key=lambda x: x.filename):
        is_dir = e.st_mode and (e.st_mode & 0o40000)
        suffix = "/" if is_dir else f"  ({e.st_size} bytes)"
        print(f"  {e.filename}{suffix}")
except Exception as ex:
    print(f"  ERROR: {ex}")

# 2) Hauptverzeichnis layers.conf und maptips.conf lesen (Schlüssel zeigen)
for fname in ["layers.conf", "maptips.conf", "maps_layers.conf", "lyrmgr.conf"]:
    fpath = f"/www/maps/public/config/{fname}"
    try:
        with sftp.open(fpath, 'r') as f:
            content = f.read().decode('utf-8')
        data = json.loads(content)
        # Schlüssel die nutzungsplanung oder oereb enthalten
        matching = [k for k in data.keys() if 'nutzung' in k.lower() or 'oereb' in k.lower()]
        if matching:
            print(f"\n=== {fname}: OEREB/Nutzung Keys ===")
            for k in sorted(matching):
                print(f"  {k}")
        else:
            # Zeige alle keys mit gis_ prefix
            gis_keys = [k for k in data.keys() if k.startswith('gis_')]
            if gis_keys:
                print(f"\n=== {fname}: gis_* Keys ({len(gis_keys)}) ===")
                for k in sorted(gis_keys)[:30]:
                    print(f"  {k}")
    except Exception as ex:
        print(f"\n=== {fname}: ERROR: {ex}")

# 3) OEREB Unterverzeichnis-Dateien lesen
try:
    oereb_files = sftp.listdir(oereb_path)
    for fname in sorted(oereb_files):
        fpath = f"{oereb_path}/{fname}"
        try:
            attr = sftp.stat(fpath)
            if attr.st_mode and (attr.st_mode & 0o40000):
                continue  # skip directories
            with sftp.open(fpath, 'r') as f:
                content = f.read().decode('utf-8')
            try:
                data = json.loads(content)
                keys = list(data.keys())
                nutzung_keys = [k for k in keys if 'nutzung' in k.lower()]
                print(f"\n=== oereb/{fname}: {len(keys)} keys ===")
                if nutzung_keys:
                    print(f"  Nutzungsplanung keys:")
                    for k in sorted(nutzung_keys):
                        v = data[k]
                        if isinstance(v, dict):
                            print(f"    {k}: {list(v.keys())[:10]}")
                        else:
                            print(f"    {k}: {str(v)[:100]}")
                else:
                    for k in sorted(keys)[:20]:
                        print(f"  {k}")
                    if len(keys) > 20:
                        print(f"  ... and {len(keys)-20} more")
            except json.JSONDecodeError:
                # Suche trotzdem nach nutzungsplanung
                if 'nutzungsplanung' in content.lower():
                    print(f"\n=== oereb/{fname}: contains 'nutzungsplanung' (not JSON) ===")
                    for line in content.split('\n'):
                        if 'nutzungsplanung' in line.lower():
                            print(f"  {line.strip()[:150]}")
        except Exception as ex:
            print(f"\n=== oereb/{fname}: ERROR: {ex}")
except Exception as ex:
    print(f"\nOEREBDir ERROR: {ex}")

sftp.close()
ssh.close()
