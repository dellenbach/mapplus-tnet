import paramiko, stat

host = "nwow.mapplus.ch"
user = "trigonet"
pw = "3Zs,k4%Un,<[W(Kx"

transport = paramiko.Transport((host, 22))
transport.connect(username=user, password=pw)
sftp = paramiko.SFTPClient.from_transport(transport)

# Check all the .conf files the framework needs for public profile
configs_to_check = [
    '/www/maps/public/config/modules.conf',
    '/www/maps/public/config/modules_m.conf',
    '/www/maps/public/config/lyrmgr.conf',
    '/www/maps/public/config/lyrmgr_m.conf',
    '/www/maps/public/config/basemaps_mgr.conf',
    '/www/maps/public/config/tools.conf',
    '/www/maps/public/config/tools_m.conf',
    '/www/maps/public/config/maptips.conf',
    '/www/maps/public/config/legends.conf',
    '/www/maps/public/config/searchoptions.conf',
    '/www/maps/public/config/disclaimer.conf',
]

print('=== Config files existence check ===')
for p in configs_to_check:
    try:
        s = sftp.stat(p)
        print(f"  EXISTS ({s.st_size:>6} bytes): {p}")
    except:
        print(f"  MISSING:                {p}")

# Also list everything in public/config/
print('\n=== /www/maps/public/config/ contents ===')
try:
    for item in sorted(sftp.listdir('/www/maps/public/config')):
        print(f"  {item}")
except Exception as e:
    print(f"  Error: {e}")

# Read common.php to check if it outputs anything
print('\n=== /www/maps/common.php (first 30 lines) ===')
try:
    with sftp.open('/www/maps/common.php', 'r') as f:
        content = f.read().decode('utf-8', errors='replace')
        for i, line in enumerate(content.split('\n')[:30]):
            print(f"  {i+1}: {line}")
except Exception as e:
    print(f"  Error: {e}")

sftp.close()
transport.close()
