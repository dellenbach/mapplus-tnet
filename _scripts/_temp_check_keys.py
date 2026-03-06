#!/usr/bin/env python3
"""Vergleicht Root- und Sublayer-Keys auf dem Server"""
import paramiko, json

HOST = "nwow.mapplus.ch"
PORT = 22
USER = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, PORT, USER, PASSWORD)
sftp = ssh.open_sftp()

# 0. Config-Dateien auflisten
print("=== Alle layers config files ===")
files = sftp.listdir("/www/maps/core/config/")
all_layers = sorted([f for f in files if f.startswith("layers")])
for f in all_layers:
    print(f"  {f}")
oereb_files = all_layers

# 1. Multi-conf Root-Keys
print()
for fname in oereb_files:
    if "multi" in fname.lower():
        path = "/www/maps/core/config/" + fname
        print(f"=== {fname}: Root-Keys (nutzungsplanung) ===")
        with sftp.open(path) as f:
            multi = json.load(f)
            for k in sorted(multi.keys()):
                if "nutzungsplanung" in k.lower():
                    v = multi[k]
                    url = v.get("url", "")
                    params = v.get("params", {})
                    layers_val = params.get("LAYERS", "-")
                    print(f"  ROOT: {k}")
                    print(f"    url: {url}")
                    print(f"    LAYERS: {layers_val}")

# 2. Single-conf Sublayer-Keys
print()
for fname in oereb_files:
    if "single" in fname.lower():
        path = "/www/maps/core/config/" + fname
        print(f"=== {fname}: Sublayer-Keys (nutzungsplanung, erste 10) ===")
        with sftp.open(path) as f:
            single = json.load(f)
            count = 0
            for k in sorted(single.keys()):
                if "nutzungsplanung" in k.lower():
                    v = single[k]
                    params = v.get("params", {})
                    layers_val = params.get("LAYERS", "-")
                    print(f"  SUB: {k}  | LAYERS: {layers_val}")
                    count += 1
                    if count >= 10:
                        print("  ... (weitere Keys vorhanden)")
                        break

# 3. Parent-Match pruefen
print()
print("=== Root-Key vs. Sublayer-Parent Match ===")
if 'multi' in dir() and 'single' in dir():
    sub_keys = [k for k in single.keys() if "nutzungsplanung" in k.lower()]
    for sk in sub_keys[:5]:
        parent = sk.rsplit("/", 1)[0] if "/" in sk else sk
        found = parent in multi
        print(f"  SUB: {sk}")
        print(f"    parent: {parent} | in multi: {found}")

sftp.close()
ssh.close()
