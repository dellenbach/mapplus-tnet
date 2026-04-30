"""
Temporäres Skript: Suche nach MapTip/identify/picking Mechanismus im Framework.
Durchsucht /mapplus-lib/mapplus-dojo und /www/maps auf dem Server.
"""
import paramiko, stat

host = "nwow.mapplus.ch"
user = "trigonet"
pw = "3Zs,k4%Un,<[W(Kx"

ssh = paramiko.Transport((host, 22))
ssh.connect(username=user, password=pw)
sftp = paramiko.SFTPClient.from_transport(ssh)

search_terms = [
    b'_wms_connector',
    b'lookupCallbacks',
    b'wmsServiceMapTip',
    b'addLayerCallback',
]

# Zuerst Framework-Verzeichnis finden
print("=== Verzeichnisstruktur /www/maps/public ===")
try:
    for item in sftp.listdir('/www/maps/public'):
        print(f"  {item}")
except Exception as e:
    print(f"  FEHLER: {e}")

print("\n=== Verzeichnisstruktur /www/maps/www ===")
try:
    for item in sftp.listdir('/www/maps/www'):
        print(f"  {item}")
except Exception as e:
    print(f"  FEHLER: {e}")

# Check ob es ein Framework-JS-Verzeichnis gibt
for check_dir in ['/www/maps/public/js', '/www/maps/public/lib', '/www/maps/public/scripts', 
                   '/www/maps/www/js', '/www/maps/www/lib',
                   '/www/maps/core', '/www/maps/njs',
                   '/www/maps/public/njs', '/www/maps/public/mapplus']:
    print(f"\n--- Checking: {check_dir} ---")
    try:
        items = sftp.listdir(check_dir)
        for item in items[:30]:
            print(f"  {item}")
        if len(items) > 30:
            print(f"  ... und {len(items)-30} weitere")
    except Exception as e:
        print(f"  nicht vorhanden: {e}")

search_dirs = ['/www/maps']
extensions = ('.js',)
max_depth = 6

def is_dir(attr):
    return stat.S_ISDIR(attr.st_mode)

def search_recursive(path, depth=0):
    if depth > max_depth:
        return
    try:
        items = sftp.listdir_attr(path)
    except Exception as e:
        print(f"  SKIP {path}: {e}")
        return
    for item in items:
        full = path + '/' + item.filename
        if item.filename.startswith('.'):
            continue
        if is_dir(item):
            search_recursive(full, depth + 1)
        elif any(item.filename.endswith(ext) for ext in extensions):
            try:
                with sftp.open(full, 'r') as f:
                    content = f.read()
                    for term in search_terms:
                        if term in content:
                            lines = content.split(b'\n')
                            for i, line in enumerate(lines):
                                if term in line:
                                    decoded = line.decode('utf-8', errors='replace').strip()[:250]
                                    print(f"[{term.decode()}] {full}:{i+1}")
                                    print(f"  {decoded}")
            except Exception as e:
                pass

for d in search_dirs:
    print(f"\n{'='*60}")
    print(f"Searching: {d}")
    print(f"{'='*60}")
    search_recursive(d)

print(f"\n{'='*60}")
print("DONE")
sftp.close()
ssh.close()
