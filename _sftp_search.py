import paramiko, re, os

host = "nwow.mapplus.ch"
user = "trigonet"
pw = "3Zs,k4%Un,<[W(Kx"

ssh = paramiko.Transport((host, 22))
ssh.connect(username=user, password=pw)
sftp = paramiko.SFTPClient.from_transport(ssh)

search_terms = [b'openCustomForm', b'openForm', b'MapTips']
search_dir = '/mapplus-lib/mapplus-dojo'
extensions = ('.js',)

def search_recursive(path, depth=0):
    if depth > 4:
        return
    try:
        items = sftp.listdir_attr(path)
    except:
        return
    for item in items:
        full = path + '/' + item.filename
        if item.filename.startswith('.'):
            continue
        if stat_is_dir(item):
            search_recursive(full, depth + 1)
        elif any(item.filename.endswith(ext) for ext in extensions):
            try:
                with sftp.open(full, 'r') as f:
                    content = f.read()
                    for term in search_terms:
                        if term in content:
                            # Find line numbers
                            lines = content.split(b'\n')
                            for i, line in enumerate(lines):
                                if term in line:
                                    print(f"[{term.decode()}] {full}:{i+1}")
                                    print(f"  {line.decode('utf-8', errors='replace').strip()[:200]}")
            except Exception as e:
                pass

def stat_is_dir(attr):
    import stat
    return stat.S_ISDIR(attr.st_mode)

print(f"Searching {search_dir} for: {[t.decode() for t in search_terms]}")
print("="*60)
search_recursive(search_dir)
print("="*60)
print("Done.")

sftp.close()
ssh.close()
