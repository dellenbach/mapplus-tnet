#!/usr/bin/env python3
"""Check server paths for lyrmgr.conf"""
import paramiko

HOST = "nwow.mapplus.ch"
USER = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, 22, USER, PASSWORD, timeout=15)

commands = [
    "ls -la /www/maps/public/config/lyrmgr.conf",
    "realpath /www/maps/public/config/",
    "cat /etc/php/*/fpm/pool.d/*.conf 2>/dev/null | grep -i chroot || echo 'no chroot found'",
    "php -r 'echo file_exists(\"/www/maps/public/config/lyrmgr.conf\") ? \"PHP sees it\" : \"PHP cannot see it\";'",
    "php -r 'echo \"document_root: \" . ($_SERVER[\"DOCUMENT_ROOT\"] ?? \"n/a\") . \"\\n\"; echo \"cwd: \" . getcwd() . \"\\n\";'",
    "head -1 /www/maps/public/config/lyrmgr.conf",
]

for cmd in commands:
    print(f"\n$ {cmd}")
    stdin, stdout, stderr = ssh.exec_command(cmd)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out:
        print(f"  {out}")
    if err:
        print(f"  ERR: {err}")

ssh.close()
print("\nDone.")
