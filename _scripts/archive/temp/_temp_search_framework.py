"""
Temporäres Skript: Lade index_de.htm und suche nach Framework-JS-Einbindungen.
Dann lade die relevanten Framework-JS-Dateien herunter.
"""
import paramiko, stat, re

host = "nwow.mapplus.ch"
user = "trigonet"
pw = "3Zs,k4%Un,<[W(Kx"

ssh = paramiko.Transport((host, 22))
ssh.connect(username=user, password=pw)
sftp = paramiko.SFTPClient.from_transport(ssh)

# 1. index_de.htm lesen und nach Script-Tags suchen
path = '/www/maps/public/index_de.htm'
print(f"=== Lese {path} ===")
with sftp.open(path, 'r') as f:
    content = f.read().decode('utf-8', errors='replace')

lines = content.splitlines()
print(f"  {len(lines)} Zeilen")

# Alle Script-Tags finden
script_pattern = re.compile(r'<script[^>]*src=["\']([^"\']+)["\']', re.IGNORECASE)
scripts = []
for i, line in enumerate(lines):
    for m in script_pattern.finditer(line):
        src = m.group(1)
        scripts.append((i+1, src))
        print(f"  Zeile {i+1}: {src}")

# 2. Nach njs.MapTip, _wms_connector, picking in index_de.htm suchen
print(f"\n=== MapTip/identify-relevante Stellen im HTML ===")
for i, line in enumerate(lines):
    low = line.lower()
    if any(kw in low for kw in ['maptip', '_wms_connector', 'picking', 'identify', 'singleclick', 'lookupcallback']):
        print(f"  Zeile {i+1}: {line.strip()[:200]}")

# 3. Suche Framework-Verzeichnisse
print(f"\n=== Suche Framework-Verzeichnisse ===")
for check_dir in ['/www/njs', '/var/www/njs', '/www/libs', '/www/js',
                  '/www/maps/public/openlayers', '/www/maps/public/pane',
                  '/www/maps/public/mobile']:
    try:
        items = sftp.listdir(check_dir)
        print(f"\n  {check_dir}/ ({len(items)} items)")
        for item in items[:20]:
            print(f"    {item}")
    except:
        pass

sftp.close()
ssh.close()
