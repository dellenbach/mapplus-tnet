#!/usr/bin/env python3
"""Auf dem Server nach layers-Configs suchen - raw-conf und andere Pfade"""
import paramiko

HOST = "nwow.mapplus.ch"
PORT = 22
USER = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, PORT, USER, PASSWORD)
sftp = ssh.open_sftp()

# 1) raw-conf Verzeichnis auflisten
paths_to_check = [
    "/data/Client_Data/nwow/raw-conf",
    "/www/maps/public",
    "/www/maps/public/config",
]

for p in paths_to_check:
    try:
        entries = sftp.listdir(p)
        print(f"\n=== {p}/ === ({len(entries)} entries)")
        for e in sorted(entries)[:50]:
            print(f"  {e}")
        if len(entries) > 50:
            print(f"  ... and {len(entries)-50} more")
    except Exception as ex:
        print(f"\n=== {p}/ === ERROR: {ex}")

# 2) Suche per find nach layers_*oereb*
print("\n=== find /www/maps -name 'layers_*oereb*' ===")
stdin, stdout, stderr = ssh.exec_command("find /www/maps -name 'layers_*oereb*' -type f 2>/dev/null | head -20")
for line in stdout:
    print(f"  {line.strip()}")

# 3) Suche nach allen .conf Dateien
print("\n=== find /www/maps -name '*.conf' -type f ===")
stdin, stdout, stderr = ssh.exec_command("find /www/maps -name '*.conf' -type f 2>/dev/null | head -30")
for line in stdout:
    print(f"  {line.strip()}")

# 4) Suche im raw-conf
print("\n=== find /data/Client_Data/nwow/raw-conf -name 'layers_*oereb*' ===")
stdin, stdout, stderr = ssh.exec_command("find /data/Client_Data/nwow/raw-conf -name 'layers_*oereb*' -type f 2>/dev/null | head -20")
for line in stdout:
    print(f"  {line.strip()}")

# 5) Suche nach 'nutzungsplanung' in irgendwelchen Dateien
print("\n=== grep -rl 'nutzungsplanung' /www/maps/ (limited) ===")
stdin, stdout, stderr = ssh.exec_command("grep -rli 'nutzungsplanung' /www/maps/ 2>/dev/null | head -20")
for line in stdout:
    print(f"  {line.strip()}")

sftp.close()
ssh.close()
