"""
_patch_index_hide_print.py
Blendet tp_print_menu (altes DRUCKEN) in index_de.htm auf dem Server aus.
Setzt style="display:none" direkt im HTML-Tag.
"""
import paramiko
import sys

HOST = 'nwow.mapplus.ch'
PORT = 22
USER = 'trigonet'
PASS = '3Zs,k4%Un,<[W(Kx'
REMOTE = '/www/maps/public/index_de.htm'

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, port=PORT, username=USER, password=PASS)
sftp = client.open_sftp()

with sftp.open(REMOTE, 'rb') as f:
    content = f.read()

old = b'<details id="tp_print_menu" class="tnet-panel">'
new = b'<details id="tp_print_menu" class="tnet-panel" style="display:none">'

if old in content:
    content = content.replace(old, new, 1)
    with sftp.open(REMOTE, 'wb') as f:
        f.write(content)
    print('OK: tp_print_menu ausgeblendet')
else:
    # Fallback: Suche nach Teilen
    idx = content.find(b'tp_print_menu')
    if idx >= 0:
        print('Kontext:', repr(content[idx-10:idx+60]))
    print('FEHLER: Suchstring nicht gefunden — kein Patch durchgefuehrt')
    sys.exit(1)

sftp.close()
client.close()
