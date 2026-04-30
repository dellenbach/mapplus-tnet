"""
_temp_read_maptips_entries2.py
Liest Maptips + Layers-Einträge gezielt für die drei gesuchten Layer-IDs.
"""
import paramiko, json, re, sys

SEARCH_KEYS = [
    "baulinien-nationalstrassen",
    "nw_fruchtfolgeflaechen",
    "nw_kantonaler_richtplan",
]

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('nwow.mapplus.ch', 22, 'trigonet', '3Zs,k4%Un,<[W(Kx')
sftp = ssh.open_sftp()

def read_json(fpath):
    with sftp.open(fpath, 'r') as f:
        content = f.read().decode('utf-8', errors='replace')
    try:
        return json.loads(content)
    except:
        cleaned = re.sub(r'//.*?$', '', content, flags=re.MULTILINE)
        cleaned = re.sub(r'/\*.*?\*/', '', cleaned, flags=re.DOTALL)
        return json.loads(cleaned)

def search_in_file(fpath, label):
    try:
        data = read_json(fpath)
    except Exception as e:
        print(f"  PARSE ERROR: {fpath}: {e}")
        return
    
    if not isinstance(data, dict):
        return
    
    for key, val in data.items():
        for sk in SEARCH_KEYS:
            matched = False
            if sk in key:
                matched = True
            elif isinstance(val, dict):
                ll = str(val.get('linked_layer', ''))
                ql = str(val.get('query_layers', ''))
                url_val = str(val.get('url', ''))
                if sk in ll or sk in ql or sk in url_val:
                    matched = True
            
            if matched:
                print(f"\n{'='*70}")
                print(f"GEFUNDEN in: {fpath}")
                print(f"  Schlüssel: {key}")
                print(f"  Vollständiger Eintrag:")
                print(json.dumps(val, indent=4, ensure_ascii=False))
                print(f"{'='*70}")

# 1) Maptips-Dateien prüfen
print("=" * 70)
print("TEIL 1: MAPTIPS-KONFIGURATIONEN")
print("=" * 70)

maptips_files = [
    '/www/core/config/maptips-GIS-oereb-wms.conf',
    '/www/core/config/maptips_geoadmin.conf',
    '/www/core/config/maptips_geodienste.conf',
    '/www/core/config/maptips_tnet_gis_fach_multi.conf',
    '/www/core/config/maptips_tnet_gis_fach_single.conf',
    '/www/core/config/maptips_tnet_gis_basis_multi.conf',
    '/www/core/config/maptips_tnet_gis_basis_single.conf',
    '/www/core/config/maptips_tnet_oereb_multi.conf',
    '/www/core/config/maptips_tnet_oereb_sinlge.conf',
    '/www/core/config/maptips_nodi_ch.conf',
    '/www/maps/public/config/maptips.conf',
]

for fpath in maptips_files:
    search_in_file(fpath, "MAPTIPS")

# 2) Layers-Dateien prüfen
print("\n\n" + "=" * 70)
print("TEIL 2: LAYERS-KONFIGURATIONEN")
print("=" * 70)

layers_files = []
for base in ['/www/core/config', '/www/maps/public/config']:
    try:
        items = sftp.listdir(base)
        for item in items:
            if item.startswith('layers') and item.endswith('.conf'):
                layers_files.append(base + '/' + item)
    except:
        pass

for fpath in sorted(layers_files):
    search_in_file(fpath, "LAYERS")

# 3) Auch in public/config/maptips.conf die allgemeine maptips-Struktur anschauen
print("\n\n" + "=" * 70)
print("TEIL 3: public/config/maptips.conf - Alle Schlüssel mit 'gis_fach' oder 'baulinien'")
print("=" * 70)
try:
    data = read_json('/www/maps/public/config/maptips.conf')
    for key in sorted(data.keys()):
        for sk in SEARCH_KEYS:
            if sk in key:
                print(f"\n  Key: {key}")
                print(f"  Entry: {json.dumps(data[key], indent=4, ensure_ascii=False)}")
        if 'gis_fach' in key:
            print(f"\n  Key: {key}")
            val = data[key]
            if isinstance(val, dict):
                print(f"    linked_layer: {val.get('linked_layer', '-')}")
                print(f"    query_layers: {val.get('query_layers', '-')}")
                print(f"    querytype: {val.get('querytype', '-')}")
                print(f"    url: {val.get('url', '-')}")
except Exception as e:
    print(f"  ERROR: {e}")

sftp.close()
ssh.close()
print("\n\nFertig.")
