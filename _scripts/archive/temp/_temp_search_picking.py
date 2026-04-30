"""Temporäres Skript: Suche nach 'picking' auf dem Server via SFTP."""
import paramiko
import os

HOST = 'nwow.mapplus.ch'
PORT = 22
USER = 'trigonet'
PASSWORD = '3Zs,k4%Un,<[W(Kx'
OUT_DIR = r'c:\_Daten\mapplus-exp\_temp_framework'

transport = paramiko.Transport((HOST, PORT))
transport.connect(username=USER, password=PASSWORD)
sftp = paramiko.SFTPClient.from_transport(transport)

# Liste tools-bezogene JS-Dateien
def list_js_files(path):
    files = []
    try:
        for entry in sftp.listdir_attr(path):
            full = path + '/' + entry.filename
            if entry.filename.startswith('.'):
                continue
            if entry.longname.startswith('d'):
                files.extend(list_js_files(full))
            elif entry.filename.endswith('.js'):
                files.append(full)
    except Exception as e:
        pass
    return files

# 0. Download loader.php und suche nach picking
print("=== loader.php Inhalt (picking-relevante Zeilen) ===")
try:
    with sftp.open('/www/maps/loader.php', 'r') as fh:
        content = fh.read().decode('utf-8', errors='replace')
        for i, line in enumerate(content.split('\n'), 1):
            if 'picking' in line.lower():
                print(f"  L{i}: {line.strip()}")
        # Auch nach 'tools' suchen
        print("\n  Tools-relevante Zeilen:")
        for i, line in enumerate(content.split('\n'), 1):
            if 'tools' in line.lower() and ('mapplus' in line.lower() or 'script' in line.lower() or '.js' in line.lower()):
                print(f"  L{i}: {line.strip()}")
except Exception as e:
    print(f"Error: {e}")

# 1. Suche picking in allen JS unter /www/maps/tnet/
print("\n=== picking in /www/maps/tnet/js/*.js ===")
tnet_js = list_js_files('/www/maps/tnet/js')
print(f"Gefunden: {len(tnet_js)} JS-Dateien")
for f in sorted(tnet_js):
    try:
        with sftp.open(f, 'r') as fh:
            content = fh.read().decode('utf-8', errors='replace')
            if 'picking' in content:
                for i, line in enumerate(content.split('\n'), 1):
                    if 'picking' in line:
                        print(f"  {f}:{i}: {line.strip()}")
    except:
        pass

# 2. Suche die tools.conf Konfiguration
print("\n=== Suche tools*.conf unter /www/maps/core/config/ ===")
try:
    for entry in sorted(sftp.listdir('/www/maps/core/config')):
        if 'tool' in entry.lower():
            print(f"  {entry}")
except Exception as e:
    print(f"Error: {e}")

# 3. Suche picking in core/config
print("\n=== picking in /www/maps/core/config/ ===")
try:
    for entry in sorted(sftp.listdir('/www/maps/core/config')):
        full = '/www/maps/core/config/' + entry
        try:
            with sftp.open(full, 'r') as fh:
                content = fh.read().decode('utf-8', errors='replace')
                if 'picking' in content.lower():
                    print(f"  {entry} enthält 'picking'!")
        except:
            pass
except:
    pass

# 3. Download provider tools.js
print("\n=== Provider JS mit 'picking' ===")
provider_js = list_js_files('/www/maps/core/provider')
for f in sorted(provider_js):
    try:
        with sftp.open(f, 'r') as fh:
            content = fh.read().decode('utf-8', errors='replace')
            if 'picking' in content.lower():
                for i, line in enumerate(content.split('\n'), 1):
                    if 'picking' in line.lower():
                        print(f"{f}:{i}: {line.strip()}")
    except:
        pass

sftp.close()
transport.close()
print("\nDone.")
