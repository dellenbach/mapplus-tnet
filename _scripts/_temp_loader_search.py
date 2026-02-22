import paramiko, stat, re

host = "nwow.mapplus.ch"
user = "trigonet"
pw = "3Zs,k4%Un,<[W(Kx"

transport = paramiko.Transport((host, 22))
transport.connect(username=user, password=pw)
sftp = paramiko.SFTPClient.from_transport(transport)

def is_dir(path):
    try:
        return stat.S_ISDIR(sftp.stat(path).st_mode)
    except:
        return False

def find_file(base, name, max_depth=3, depth=0):
    if depth > max_depth:
        return
    try:
        items = sftp.listdir(base)
    except:
        return
    for item in items:
        if item.startswith('.'):
            continue
        full = base + '/' + item
        if item == name:
            print(f"  FOUND: {full}")
        if is_dir(full):
            find_file(full, name, max_depth, depth + 1)

# 1. Find loader.php in web root
print('\n=== Finding loader.php ===')
for d in ['/www/mapplus-lib/mapplus-dojo/v4.0.0', '/www/maps']:
    find_file(d, 'loader.php', max_depth=3)

# 1b. Also check /www/core etc.
for d in ['/www/core', '/www/mapplus-lib/mapplus-dojo/v4.0.0/php']:
    find_file(d, 'loader.php', max_depth=3)

# 2. Read appmanager.js - search for loader.php, LyrMgr, modules, defmodules
print('\n=== appmanager.js: loader/modules/LyrMgr ===')
try:
    with sftp.open('/www/mapplus-lib/mapplus-dojo/v4.0.0/appmanager.js', 'r') as f:
        content = f.read().decode('utf-8', errors='replace')
        lines = content.split('\n')
        for i, line in enumerate(lines):
            if any(t in line for t in ['loader.php', 'modules', 'LyrMgr', 'defmodules', '_m.conf', 'lyrmgr']):
                print(f"  L{i+1}: {line.strip()[:200]}")
except Exception as e:
    print(f"  Error: {e}")

# 3. Check if modules_m.conf exists on server
print('\n=== modules_m.conf on server ===')
for p in ['/www/maps/public/config/modules_m.conf', '/www/maps/config/modules_m.conf']:
    try:
        s = sftp.stat(p)
        print(f"  EXISTS: {p} ({s.st_size} bytes)")
    except:
        print(f"  NOT FOUND: {p}")

# 4. Check if lyrmgr_m.conf exists on server
print('\n=== lyrmgr_m.conf on server ===')
for p in ['/www/maps/public/config/lyrmgr_m.conf', '/www/maps/config/lyrmgr_m.conf']:
    try:
        s = sftp.stat(p)
        print(f"  EXISTS: {p} ({s.st_size} bytes)")
    except:
        print(f"  NOT FOUND: {p}")

# 5. List /www/maps/ directory
print('\n=== /www/maps/ directory contents ===')
try:
    for item in sftp.listdir('/www/maps'):
        print(f"  {item}")
except Exception as e:
    print(f"  Error: {e}")

sftp.close()
transport.close()
