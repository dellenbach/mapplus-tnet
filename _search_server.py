import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('nwow.mapplus.ch', 22, 'trigonet', '3Zs,k4%Un,<[W(Kx')

# Suche openCustomForm in mapplus-dojo
cmd = 'grep -rn "openCustomForm" /www/mapplus-lib/mapplus-dojo/v4.0.0/ --include="*.js" 2>/dev/null | head -60'
stdin, stdout, stderr = ssh.exec_command(cmd)
result = stdout.read().decode()
print("=== openCustomForm ===")
print(result if result else "Nichts gefunden")

# Suche auch MapTips
cmd2 = 'grep -rn "MapTips" /www/mapplus-lib/mapplus-dojo/v4.0.0/ --include="*.js" 2>/dev/null | head -40'
stdin2, stdout2, stderr2 = ssh.exec_command(cmd2)
result2 = stdout2.read().decode()
print("\n=== MapTips ===")
print(result2 if result2 else "Nichts gefunden")

ssh.close()
