"""
Finde den physischen Pfad von /mapplus-lib/ auf dem Server.
"""
import paramiko, stat

host = "nwow.mapplus.ch"
user = "trigonet"
pw = "3Zs,k4%Un,<[W(Kx"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(host, 22, user, pw)

# Versuche verschiedene physische Pfade
paths_to_try = [
    '/mapplus-lib',
    '/www/mapplus-lib', 
    '/var/www/mapplus-lib',
    '/home/trigonet/mapplus-lib',
    '/opt/mapplus-lib',
    '/data/mapplus-lib',
    '/www/html/mapplus-lib',
]

sftp = ssh.open_sftp()
for p in paths_to_try:
    try:
        items = sftp.listdir(p)
        print(f"GEFUNDEN: {p}")
        for item in items:
            print(f"  {item}")
    except:
        pass

# Auch find nutzen
print("\n=== find / -name 'mapplus-dojo' -maxdepth 4 ===")
stdin, stdout, stderr = ssh.exec_command("find / -name 'mapplus-dojo' -maxdepth 5 -type d 2>/dev/null | head -10")
for line in stdout:
    print(f"  {line.strip()}")

print("\n=== find / -name 'openlayers.js' -path '*mapplus*' ===")
stdin, stdout, stderr = ssh.exec_command("find / -name 'openlayers.js' -path '*mapplus*' 2>/dev/null | head -10")
for line in stdout:
    print(f"  {line.strip()}")

print("\n=== Suche Apache/Nginx config für mapplus-lib Alias ===")
stdin, stdout, stderr = ssh.exec_command("grep -r 'mapplus-lib' /etc/apache2/ /etc/nginx/ /etc/httpd/ 2>/dev/null | head -10")
for line in stdout:
    print(f"  {line.strip()}")

# Alternativ: locate
print("\n=== locate appmanager.js ===")
stdin, stdout, stderr = ssh.exec_command("locate appmanager.js 2>/dev/null | head -10")
for line in stdout:
    print(f"  {line.strip()}")

sftp.close()
ssh.close()
print("\nDONE")
