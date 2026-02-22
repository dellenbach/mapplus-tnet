import paramiko, stat

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

# 1. List /www/mapplus-lib/ to find the structure
print('=== /www/mapplus-lib/ ===')
try:
    for item in sorted(sftp.listdir('/www/mapplus-lib')):
        print(f"  {item}")
except Exception as e:
    print(f"  Error: {e}")

# 2. Check if mapplus-lib is a symlink
print('\n=== symlink check ===')
try:
    target = sftp.readlink('/www/mapplus-lib')
    print(f"  /www/mapplus-lib -> {target}")
except:
    print("  Not a symlink")

# 3. Check mapplus-dojo path
print('\n=== /www/mapplus-lib/mapplus-dojo/ ===')
try:
    for item in sorted(sftp.listdir('/www/mapplus-lib/mapplus-dojo')):
        print(f"  {item}")
except Exception as e:
    print(f"  Error: {e}")

# 4. Check v4.0.0 path
print('\n=== /www/mapplus-lib/mapplus-dojo/v4.0.0/ ===')
try:
    for item in sorted(sftp.listdir('/www/mapplus-lib/mapplus-dojo/v4.0.0')):
        print(f"  {item}")
except Exception as e:
    print(f"  Error: {e}")

sftp.close()
transport.close()
