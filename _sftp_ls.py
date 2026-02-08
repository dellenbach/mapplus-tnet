import paramiko, stat

host = "nwow.mapplus.ch"
user = "trigonet"
pw = "3Zs,k4%Un,<[W(Kx"

ssh = paramiko.Transport((host, 22))
ssh.connect(username=user, password=pw)
sftp = paramiko.SFTPClient.from_transport(ssh)

def list_tree(path, depth=0, max_depth=2):
    try:
        items = sftp.listdir_attr(path)
    except:
        return
    for item in sorted(items, key=lambda x: x.filename):
        is_dir = stat.S_ISDIR(item.st_mode)
        prefix = "  " * depth + ("📁 " if is_dir else "📄 ")
        size = f" ({item.st_size}b)" if not is_dir else ""
        print(f"{prefix}{item.filename}{size}")
        if is_dir and depth < max_depth:
            list_tree(path + '/' + item.filename, depth + 1, max_depth)

# Read oereb.js (first part)
path = '/www/oereb/assets/js/oereb.js'
print(f"=== {path} (first 8000 chars) ===")
try:
    with sftp.open(path, 'r') as f:
        content = f.read().decode('utf-8', errors='replace')
        print(content[:8000])
        print(f"\n\n=== Total length: {len(content)} chars ===")
except Exception as e:
    print(f"Error: {e}")

sftp.close()
ssh.close()
