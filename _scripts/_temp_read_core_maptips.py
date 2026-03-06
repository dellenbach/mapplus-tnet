import paramiko, stat, re, json

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('nwow.mapplus.ch', 22, 'trigonet', '3Zs,k4%Un,<[W(Kx')
sftp = ssh.open_sftp()

# Maptips werden geladen von:
# 1. ../core/config/maptips*.conf  (= /www/core/config/maptips*.conf)
# 2. ./core/config/maptips.conf    (= /www/maps/core/config/maptips.conf)
# 3. ./<profile>/config/maptips.conf (= /www/maps/public/config/maptips.conf)

paths_to_check = [
    '/www/core/config',
    '/www/maps/core/config',
]

for p in paths_to_check:
    try:
        items = sftp.listdir(p)
        maptips = sorted([f for f in items if f.startswith('maptips') and f.endswith('.conf')])
        print(f"\n{p}: {len(maptips)} maptips configs")
        for m in maptips:
            print(f"  {m}")
    except Exception as e:
        print(f"\n{p}: ERROR - {e}")

# Nun linked_layer Werte aus /www/core/config/maptips*.conf lesen
core_path = '/www/core/config'
try:
    items = sftp.listdir(core_path)
    maptips_files = sorted([f for f in items if f.startswith('maptips') and f.endswith('.conf')])
    
    all_linked = {}
    for mc in maptips_files:
        fpath = core_path + '/' + mc
        with sftp.open(fpath, 'r') as f:
            content = f.read().decode('utf-8', errors='replace')
        matches = re.findall(r'"linked_layer"\s*:\s*"([^"]+)"', content)
        unique = sorted(set(matches))
        for m in unique:
            if m not in all_linked:
                all_linked[m] = []
            all_linked[m].append(mc)
        print(f"\n  {mc}: {len(unique)} unique linked_layer")
        for m in unique[:3]:
            print(f"    {m}")
        if len(unique) > 3:
            print(f"    ... ({len(unique) - 3} weitere)")
    
    print(f"\n===== ALLE unique linked_layer aus core ({len(all_linked)}) =====")
    for ll in sorted(all_linked.keys()):
        sources = all_linked[ll]
        print(f"  {ll}  ({', '.join(sources)})")
except Exception as e:
    print(f"\nERROR: {e}")

sftp.close()
ssh.close()
