#!/usr/bin/env python3
"""www/core auf Server suchen und Configs mit nutzungsplanung finden"""
import paramiko, json

HOST = "nwow.mapplus.ch"
PORT = 22
USER = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, PORT, USER, PASSWORD)
sftp = ssh.open_sftp()

# Prüfe verschiedene www/core Pfade
paths = [
    "/www/core",
    "/www/core/config",
    "/www/maps/www/core",
    "/www/maps/www/core/config",
    "/www/maps/public/config/oereb",
]

for p in paths:
    try:
        entries = sftp.listdir(p)
        print(f"\n=== {p}/ === ({len(entries)} entries)")
        for e in sorted(entries)[:60]:
            print(f"  {e}")
        if len(entries) > 60:
            print(f"  ... and {len(entries)-60} more")
    except Exception as ex:
        print(f"\n=== {p}/ === NOT FOUND: {ex}")

# Lies die OEREB-Configs und zeige Nutzungsplanung-Schlüssel
oereb_path = "/www/maps/public/config/oereb"
try:
    for fname in sorted(sftp.listdir(oereb_path)):
        fpath = f"{oereb_path}/{fname}"
        try:
            attr = sftp.stat(fpath)
            if attr.st_mode and (attr.st_mode & 0o40000):
                # Unterverzeichnis auflisten
                sub = sftp.listdir(fpath)
                print(f"\n=== oereb/{fname}/ === ({len(sub)} entries)")
                for s in sorted(sub):
                    print(f"  {s}")
                continue
            with sftp.open(fpath, 'r') as f:
                content = f.read().decode('utf-8')
            data = json.loads(content)
            nutzung = [k for k in data.keys() if 'nutzung' in k.lower()]
            if nutzung:
                print(f"\n=== oereb/{fname}: Nutzung keys ===")
                for k in sorted(nutzung):
                    v = data[k]
                    if isinstance(v, dict):
                        print(f"  KEY: {k}")
                        # Zeige wichtige Felder
                        for subk in ['url', 'linked_layer', 'type', 'query_layers', 'nls', 'visible']:
                            if subk in v:
                                print(f"    {subk}: {v[subk]}")
                    else:
                        print(f"  {k}: {str(v)[:200]}")
        except json.JSONDecodeError:
            pass
        except Exception as ex:
            print(f"  {fname}: ERROR {ex}")
except Exception as ex:
    print(f"OEREB: {ex}")

# Auch layers.conf und maptips.conf im Hauptverzeichnis prüfen
main_path = "/www/maps/public/config"
for fname in ["layers.conf", "maptips.conf", "maps_layers.conf"]:
    fpath = f"{main_path}/{fname}"
    try:
        with sftp.open(fpath, 'r') as f:
            content = f.read().decode('utf-8')
        data = json.loads(content)
        nutzung = [k for k in data.keys() if 'nutzung' in k.lower() or 'oereb' in k.lower()]
        if nutzung:
            print(f"\n=== {fname}: Nutzung/OEREB keys ===")
            for k in sorted(nutzung):
                v = data[k]
                if isinstance(v, dict):
                    print(f"  KEY: {k}")
                    for subk in ['url', 'linked_layer', 'type', 'query_layers', 'visible']:
                        if subk in v:
                            print(f"    {subk}: {v[subk]}")
                else:
                    print(f"  {k}: {str(v)[:200]}")
    except Exception as ex:
        print(f"\n=== {fname}: {ex}")

sftp.close()
ssh.close()
