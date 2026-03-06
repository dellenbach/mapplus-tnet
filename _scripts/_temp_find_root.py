"""
Finde den physischen Pfad von /mapplus-lib/ per SFTP-Browsing.
"""
import paramiko, stat

host = "nwow.mapplus.ch"
user = "trigonet"
pw = "3Zs,k4%Un,<[W(Kx"

ssh = paramiko.Transport((host, 22))
ssh.connect(username=user, password=pw)
sftp = paramiko.SFTPClient.from_transport(ssh)

def is_dir(attr):
    return stat.S_ISDIR(attr.st_mode)

# Root-Verzeichnis durchsuchen
print("=== Root / ===")
try:
    for item in sftp.listdir_attr('/'):
        t = 'd' if is_dir(item) else 'f'
        print(f"  [{t}] {item.filename}")
except Exception as e:
    print(f"  FEHLER: {e}")

# /www durchsuchen
print("\n=== /www ===")
try:
    for item in sftp.listdir_attr('/www'):
        t = 'd' if is_dir(item) else 'f'
        print(f"  [{t}] {item.filename}")
except Exception as e:
    print(f"  FEHLER: {e}")

# /data durchsuchen
print("\n=== /data ===")
try:
    for item in sftp.listdir_attr('/data'):
        t = 'd' if is_dir(item) else 'f'
        print(f"  [{t}] {item.filename}")
except Exception as e:
    print(f"  FEHLER: {e}")

# Typische Web-Server-Pfade
for p in ['/var/www', '/srv/www', '/home', '/home/trigonet', '/opt']:
    try:
        items = sftp.listdir(p)
        print(f"\n=== {p} ({len(items)} items) ===")
        for item in items[:20]:
            print(f"  {item}")
    except:
        pass

sftp.close()
ssh.close()
