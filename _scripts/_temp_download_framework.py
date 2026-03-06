"""
Temporäres Skript: Lade die mapplus-dojo Framework-Dateien herunter
und suche nach MapTip/identify/picking Mechanismus.
"""
import paramiko, os

host = "nwow.mapplus.ch"
user = "trigonet"
pw = "3Zs,k4%Un,<[W(Kx"

ssh = paramiko.Transport((host, 22))
ssh.connect(username=user, password=pw)
sftp = paramiko.SFTPClient.from_transport(ssh)

base = '/mapplus-lib/mapplus-dojo/v4.0.0'
files_to_check = ['openlayers.js', 'appmanager.js', 'common.js', 'njs.js']
local_dir = r'c:\_Daten\mapplus-exp\_temp_framework'
os.makedirs(local_dir, exist_ok=True)

# Alle Dateien im Verzeichnis auflisten
print(f"=== Dateien in {base} ===")
try:
    items = sftp.listdir(base)
    for item in items:
        print(f"  {item}")
except Exception as e:
    print(f"  FEHLER: {e}")

# Framework-Dateien herunterladen
for fname in files_to_check:
    remote = f"{base}/{fname}"
    local = os.path.join(local_dir, fname)
    try:
        sftp.get(remote, local)
        size = os.path.getsize(local)
        print(f"\n  Heruntergeladen: {fname} ({size} Bytes)")
    except Exception as e:
        print(f"\n  FEHLER bei {fname}: {e}")

# Auch den Provider-Ordner prüfen
provider_base = f"{base}/provider/OLPlus"
print(f"\n=== Dateien in {provider_base} ===")
try:
    items = sftp.listdir(provider_base)
    for item in items:
        print(f"  {item}")
        remote = f"{provider_base}/{item}"
        if item.endswith('.js'):
            local = os.path.join(local_dir, f"OLPlus_{item}")
            sftp.get(remote, local)
            size = os.path.getsize(local)
            print(f"    Heruntergeladen: {size} Bytes")
except Exception as e:
    print(f"  FEHLER: {e}")

# Provider-Unterverzeichnisse prüfen
for subdir in ['provider', 'provider/OLPlus']:
    full = f"{base}/{subdir}"
    print(f"\n=== {full} ===")
    try:
        items = sftp.listdir(full)
        for item in items:
            print(f"  {item}")
    except Exception as e:
        print(f"  {e}")

sftp.close()
ssh.close()
print("\nDONE")
