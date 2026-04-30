"""
Temporäres Skript: Lese index_de.htm vom Server und finde Framework-JS-Pfade.
Dann suche nach olWMSGetFeatureInfo.js und _wms_connector.
"""
import paramiko, re

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('nwow.mapplus.ch', 22, 'trigonet', '3Zs,k4%Un,<[W(Kx')
sftp = ssh.open_sftp()

# 1. Lese index_de.htm
print("=== Script-Tags aus index_de.htm ===")
with sftp.open('/www/maps/public/index_de.htm', 'r') as f:
    content = f.read().decode('utf-8', errors='replace')

scripts = re.findall(r'src=["\']([^"\']+\.js)', content)
for s in scripts:
    print(f"  {s}")

# 2. Prüfe ob mapplus-lib als Apache Alias existiert
# Versuche die Script-Pfade direkt zu lesen
print("\n=== Prüfe Framework-Pfade ===")
for s in scripts:
    if 'mapplus' in s.lower() or 'njs' in s.lower() or 'GetFeatureInfo' in s:
        # Probiere als absoluter Pfad unter /www
        test_paths = [
            '/www' + s,
            '/www/maps/public' + s,
            s,
        ]
        for tp in test_paths:
            try:
                sftp.stat(tp)
                print(f"FOUND: {tp}")
                break
            except:
                pass

# 3. Suche nach _wms_connector in Framework-Verzeichnissen
print("\n=== Suche _wms_connector in /www/maps ===")
def search_in_dir(sftp, folder, term, depth=0, max_d=4):
    if depth > max_d: return
    try:
        items = sftp.listdir(folder)
    except: return
    for item in items:
        if item.startswith('.'): continue
        full = folder + '/' + item
        if item.endswith('.js') and not 'node_modules' in full:
            try:
                with sftp.open(full, 'r') as f:
                    data = f.read()
                if b'_wms_connector' in data and b'lookupCallbacks' in data:
                    print(f"\nFOUND _wms_connector + lookupCallbacks in: {full}")
                    lines = data.decode('utf-8', errors='replace').split('\n')
                    for i, line in enumerate(lines):
                        if '_wms_connector' in line or 'lookupCallbacks' in line:
                            print(f"  L{i+1}: {line.strip()[:200]}")
            except: pass
        else:
            try:
                if sftp.stat(full).st_mode & 0o40000:
                    search_in_dir(sftp, full, term, depth+1, max_d)
            except: pass

# Suche in maps/ und core/
for d in ['/www/maps', '/www/core']:
    search_in_dir(sftp, d, b'_wms_connector')

sftp.close()
ssh.close()
print("\nDONE")
