#!/usr/bin/env python3
"""Stichprobe: Prüfe ob Config-Migration erfolgreich war"""
import paramiko, json

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('nwow.mapplus.ch', 22, 'trigonet', r'3Zs,k4%Un,<[W(Kx')
sftp = ssh.open_sftp()
config_dir = '/www/core/config'

# Prüfe ob noch alte URLs übrig sind
remaining = 0
for fname in sftp.listdir(config_dir):
    if fname.endswith('.conf'):
        try:
            with sftp.open(config_dir + '/' + fname) as f:
                content = f.read().decode('utf-8')
            c = content.count('agsproxy.php?path=')
            if c > 0:
                print('NOCH ALT: ' + fname + ': ' + str(c))
                remaining += c
        except:
            pass

# Stichprobe: Zeige neue URLs
with sftp.open(config_dir + '/layers_tnet_gis_fach_multi.conf') as f:
    data = json.loads(f.read().decode('utf-8'))
for key in list(data.keys())[:3]:
    if isinstance(data[key], dict) and 'url' in data[key]:
        print('Sample: ' + key + ' -> ' + data[key]['url'])

print()
if remaining == 0:
    print('ALLE URLs erfolgreich umgestellt!')
else:
    print('Noch ' + str(remaining) + ' alte URLs uebrig')

sftp.close()
ssh.close()
