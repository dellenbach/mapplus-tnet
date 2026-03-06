"""Upload agsproxy.php zum Server"""
import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('nwow.mapplus.ch', 22, 'trigonet', '3Zs,k4%Un,<[W(Kx')
sftp = ssh.open_sftp()

local = r'c:\_Daten\mapplus-exp\maps\agsproxy.php'
remote = '/www/maps/agsproxy.php'
sftp.put(local, remote)
print(f'OK {remote}')

sftp.close()
ssh.close()
