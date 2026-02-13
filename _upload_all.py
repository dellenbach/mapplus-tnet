#!/usr/bin/env python3
"""Upload all proxy files to CORRECT server paths"""
import paramiko, os

HOST = "nwow.mapplus.ch"
PORT = 22
USER = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"

# Mapping: lokale Datei -> Server-Pfad(e)
UPLOADS = [
    # inframe-maps.html -> BEIDE Pfade (der ohne views/ ist der aktive!)
    (r"c:\_Daten\mapplus-exp\maps\tnet\views\inframe-maps.html", [
        "/www/maps/tnet/inframe-maps.html",
        "/www/maps/tnet/views/inframe-maps.html",
    ]),
    # Proxy PHP
    (r"c:\_Daten\mapplus-exp\maps\tnet\php\active-maps-proxy.php", [
        "/www/maps/tnet/php/active-maps-proxy.php",
    ]),
    # Proxy Inject JS
    (r"c:\_Daten\mapplus-exp\maps\tnet\js\tnet-proxy-inject.js", [
        "/www/maps/tnet/js/tnet-proxy-inject.js",
    ]),
    # Helpers JS -> BEIDE Pfade
    (r"c:\_Daten\mapplus-exp\maps\tnet\js\tnet-mapplus-helpers.js", [
        "/www/maps/tnet/js/tnet-mapplus-helpers.js",
        "/www/maps/tnet/tnet-mapplus-helpers.js",
    ]),
    # Override CSS
    (r"c:\_Daten\mapplus-exp\maps\public\css\override.css", [
        "/www/maps/public/css/override.css",
    ]),
]

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, PORT, USER, PASSWORD)
sftp = ssh.open_sftp()

for local, remotes in UPLOADS:
    if not os.path.exists(local):
        print(f"  SKIP (local missing) {local}")
        continue
    size = os.path.getsize(local)
    for remote in remotes:
        try:
            sftp.put(local, remote)
            print(f"  OK {remote} ({size} bytes)")
        except Exception as e:
            print(f"  FAIL {remote}: {e}")

sftp.close()
ssh.close()
print("Done")
