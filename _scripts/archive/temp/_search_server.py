import paramiko, re
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('nwow.mapplus.ch', 22, 'trigonet', '3Zs,k4%Un,<[W(Kx')
sftp = ssh.open_sftp()

# index_de.htm (Template) lesen — suche addLayerCallback und minResolution
path = '/www/maps/public/index_de.htm'
with sftp.open(path, 'r') as f:
    content = f.read().decode('utf-8', errors='replace')

lines = content.splitlines()
print(f"index_de.htm: {len(lines)} Zeilen, {len(content)} Bytes")

# Suche Zeile 730-740 (der Fehler sagt Zeile 735)
print(f"\n=== Zeilen 725-745 ===")
for i in range(724, min(745, len(lines))):
    print(f"  {i+1}: {lines[i]}")

# Suche addLayerCallback
for i, line in enumerate(lines):
    if 'addLayerCallback' in line:
        start = max(0, i - 3)
        end = min(len(lines), i + 10)
        print(f"\n=== addLayerCallback bei Zeile {i+1} ===")
        for j in range(start, end):
            print(f"  {j+1}: {lines[j]}")

# Suche minResolution im JS-Kontext
for i, line in enumerate(lines):
    if 'minResolution' in line and ('njs' in line or 'MapTip' in line.lower() or 'layer' in line.lower()):
        print(f"\n  minResolution bei Zeile {i+1}: {line.strip()}")

sftp.close()
ssh.close()

ssh.close()
