import paramiko, stat

host = "nwow.mapplus.ch"
user = "trigonet"
pw = "3Zs,k4%Un,<[W(Kx"

transport = paramiko.Transport((host, 22))
transport.connect(username=user, password=pw)
sftp = paramiko.SFTPClient.from_transport(transport)

# 1. Read loader.php
print('=== /www/maps/loader.php ===')
try:
    with sftp.open('/www/maps/loader.php', 'r') as f:
        content = f.read().decode('utf-8', errors='replace')
        print(content)
except Exception as e:
    print(f"Error: {e}")

# 2. Find appmanager.js
print('\n=== Finding appmanager.js ===')
try:
    items = sftp.listdir('/www/mapplus-lib/mapplus-dojo')
    print(f"  /www/mapplus-lib/mapplus-dojo/ -> {items}")
except:
    pass
try:
    items = sftp.listdir('/www/mapplus-lib')
    print(f"  /www/mapplus-lib/ -> {items[:20]}")
except:
    pass

# 3. Try to find appmanager.js at different version paths
for ver in ['v4.0.0', 'v3.0.0', 'v4.0']:
    try:
        s = sftp.stat(f'/www/mapplus-lib/mapplus-dojo/{ver}/appmanager.js')
        print(f"  FOUND: /www/mapplus-lib/mapplus-dojo/{ver}/appmanager.js ({s.st_size} bytes)")
    except:
        pass

# Try symlink
try:
    target = sftp.readlink('/www/mapplus-lib')
    print(f"  /www/mapplus-lib -> {target} (symlink)")
except:
    pass

sftp.close()
transport.close()
