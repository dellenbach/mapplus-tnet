#!/usr/bin/env python3
"""Durchsucht Server-Verzeichnisse nach layers config Dateien"""
import paramiko

HOST = "nwow.mapplus.ch"
PORT = 22
USER = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, PORT, USER, PASSWORD)
sftp = ssh.open_sftp()

# Verzeichnisse durchsuchen
paths_to_check = [
    "/www/maps/core/config",
    "/www/maps/core",
    "/www/maps/tnet/config",
    "/www/maps/tnet",
    "/www/maps",
]

for basepath in paths_to_check:
    try:
        entries = sftp.listdir(basepath)
        layers = [e for e in entries if "layers" in e.lower() and ("conf" in e.lower() or "json" in e.lower())]
        if layers:
            print(f"\n=== {basepath}/ ===")
            for l in sorted(layers)[:20]:
                print(f"  {l}")
    except Exception as ex:
        pass

# Auch nach nutzungsplanung in allen conf-Dateien suchen
print("\n=== Suche nach Dateien mit 'nutzungsplanung' ===")
for basepath in ["/www/maps/core/config", "/www/maps/tnet/config"]:
    try:
        entries = sftp.listdir(basepath)
        for e in sorted(entries):
            if e.endswith(".conf") or e.endswith(".json"):
                fpath = basepath + "/" + e
                try:
                    with sftp.open(fpath) as f:
                        content = f.read().decode("utf-8", errors="replace")
                        if "nutzungsplanung" in content.lower():
                            # Zaehle Vorkommen
                            count = content.lower().count("nutzungsplanung")
                            print(f"  {fpath} ({count}x nutzungsplanung)")
                except:
                    pass
    except:
        pass

sftp.close()
ssh.close()
