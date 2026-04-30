import paramiko
import re

HOST = "nwow.mapplus.ch"
PORT = 22
USER = "trigonet"
PASSWORD = "3Zs,k4%Un,<[W(Kx"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, PORT, USER, PASSWORD)
sftp = ssh.open_sftp()

# Prüfe den öffentlichen Config-Pfad
config_path = "/www/maps/public/config"
items = sftp.listdir(config_path)
maptips_confs = sorted([f for f in items if f.startswith('maptips') and f.endswith('.conf')])
print(f"Maptips-Configs in {config_path}: {len(maptips_confs)}")
for mc in maptips_confs:
    print(f"  {mc}")

# Für jede Maptips-Config: linked_layer Werte extrahieren (unique)
print("\n===== LINKED_LAYER Werte pro Config =====")
all_linked = set()
for mc in maptips_confs:
    fpath = config_path + "/" + mc
    with sftp.open(fpath, 'r') as f:
        content = f.read().decode('utf-8', errors='replace')
    matches = re.findall(r'"linked_layer"\s*:\s*"([^"]+)"', content)
    unique = sorted(set(matches))
    all_linked.update(unique)
    print(f"\n--- {mc} ({len(unique)} unique linked_layer) ---")
    for m in unique[:5]:
        print(f"    {m}")
    if len(unique) > 5:
        print(f"    ... ({len(unique) - 5} weitere)")

# Auch layers.conf und lyrmgr.conf Layer-Keys prüfen
print("\n\n===== VERGLEICH: layers.conf Keys =====")
with sftp.open(config_path + "/layers.conf", 'r') as f:
    layers_content = f.read().decode('utf-8', errors='replace')
import json
layers = json.loads(layers_content)
layer_keys = sorted(layers.keys())
print(f"Layer-Keys in layers.conf: {len(layer_keys)}")
for k in layer_keys[:20]:
    print(f"  {k}")
if len(layer_keys) > 20:
    print(f"  ... ({len(layer_keys) - 20} weitere)")

# Zusammenfassung: linked_layer die NICHT in layers.conf Keys vorkommen
not_in_layers = sorted([ll for ll in all_linked if ll not in layers])
print(f"\n===== linked_layer NICHT in layers.conf ({len(not_in_layers)}/{len(all_linked)}) =====")
for ll in not_in_layers[:20]:
    print(f"  {ll}")
if len(not_in_layers) > 20:
    print(f"  ... ({len(not_in_layers) - 20} weitere)")

# linked_layer die IN layers.conf vorkommen
in_layers = sorted([ll for ll in all_linked if ll in layers])
print(f"\n===== linked_layer IN layers.conf ({len(in_layers)}/{len(all_linked)}) =====")
for ll in in_layers[:20]:
    print(f"  {ll}")

sftp.close()
ssh.close()
