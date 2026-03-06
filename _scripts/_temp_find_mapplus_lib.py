"""
Suche mapplus-lib in /www/ Unterverzeichnissen.
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

# Suche mapplus-lib in /www-Unterverzeichnissen
for d in ['/www/core', '/www/nwow', '/www/nwow_ribbon', '/www/mapplus-protected']:
    print(f"\n=== {d} ===")
    try:
        for item in sftp.listdir_attr(d):
            t = 'd' if is_dir(item) else 'f'
            print(f"  [{t}] {item.filename}")
    except Exception as e:
        print(f"  {e}")

# Der URL-Pfad /mapplus-lib könnte auf ein Mapping zeigen
# Prüfe ob es ein symlink oder alias ist
# Suche in /www direkt
for d in sftp.listdir('/www'):
    if 'mapplus' in d.lower() or 'lib' in d.lower():
        full = f"/www/{d}"
        print(f"\n=== {full} ===")
        try:
            for item in sftp.listdir(full):
                print(f"  {item}")
        except:
            pass

# /www/core ist wahrscheinlich das mapplus-Framework-Verzeichnis
print("\n=== Suche mapplus-dojo in /www/core ===")
def find_mapplus_dojo(path, depth=0):
    if depth > 4:
        return
    try:
        for item in sftp.listdir_attr(path):
            full = path + '/' + item.filename
            if item.filename == 'mapplus-dojo' or item.filename == 'mapplus-lib':
                print(f"  GEFUNDEN: {full}")
                try:
                    for sub in sftp.listdir(full):
                        print(f"    {sub}")
                except:
                    pass
            elif is_dir(item) and not item.filename.startswith('.'):
                find_mapplus_dojo(full, depth + 1)
    except:
        pass

find_mapplus_dojo('/www/core')
find_mapplus_dojo('/www/nwow_ribbon')
find_mapplus_dojo('/www/nwow')

sftp.close()
ssh.close()
print("\nDONE")
