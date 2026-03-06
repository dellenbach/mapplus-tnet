import paramiko, stat

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('nwow.mapplus.ch', 22, 'trigonet', '3Zs,k4%Un,<[W(Kx')
sftp = ssh.open_sftp()

# Verzeichnisstruktur erkunden
paths = [
    '/www/maps/public',
    '/www/maps/public/config',
    '/www/maps',
]
for p in paths:
    try:
        items = sftp.listdir_attr(p)
        php_files = [i.filename for i in items if i.filename.endswith('.php')]
        conf_files = [i.filename for i in items if i.filename.endswith('.conf')]
        dirs = [i.filename for i in items if stat.S_ISDIR(i.st_mode)]
        print(f"\n{p}:")
        print(f"  PHP: {php_files}")
        print(f"  CONF: {conf_files}")
        print(f"  Dirs: {dirs[:15]}")
    except Exception as e:
        print(f"\n{p}: ERROR - {e}")

# loader.php suchen
for p in ['/www/maps', '/www/maps/public', '/www']:
    try:
        items = sftp.listdir(p)
        if 'loader.php' in items:
            print(f"\nFOUND loader.php in {p}")
            with sftp.open(p + '/loader.php', 'r') as f:
                content = f.read().decode('utf-8', errors='replace')
            print(content[:3000])
            break
    except:
        pass

sftp.close()
ssh.close()
