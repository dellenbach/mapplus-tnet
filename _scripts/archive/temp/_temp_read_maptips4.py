"""Fokussiertes Skript - nur die drei gesuchten Layer-IDs."""
import paramiko, json

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('nwow.mapplus.ch', 22, 'trigonet', '3Zs,k4%Un,<[W(Kx')
sftp = ssh.open_sftp()

def read_json(fpath):
    with sftp.open(fpath, 'r') as f:
        content = f.read().decode('utf-8', errors='replace')
    return json.loads(content)

# 1. baulinien-nationalstrassen_v2_0.oereb - MAPTIP
print("=== 1. MAPTIP: ch.astra.baulinien-nationalstrassen_v2_0.oereb ===")
data = read_json('/www/core/config/maptips-GIS-oereb-wms.conf')
key1 = 'ch.astra.baulinien-nationalstrassen_v2_0.oereb'
if key1 in data:
    print("QUELLE: /www/core/config/maptips-GIS-oereb-wms.conf")
    print(json.dumps(data[key1], indent=2, ensure_ascii=False))
print()

data2 = read_json('/www/core/config/maptips_geoadmin.conf')
key2 = 'ch.astra.baulinien-nationalstrassen'
if key2 in data2:
    print("QUELLE: /www/core/config/maptips_geoadmin.conf")
    print("KEY: " + key2)
    print(json.dumps(data2[key2], indent=2, ensure_ascii=False))
print()

# 2. gis_fach/nw_fruchtfolgeflaechen - MAPTIP
print("=== 2. MAPTIP: gis_fach/nw_fruchtfolgeflaechen ===")
found = False
for fpath in ['/www/core/config/maptips_tnet_gis_fach_multi.conf',
              '/www/core/config/maptips_tnet_gis_fach_single.conf',
              '/www/maps/public/config/maptips.conf']:
    data = read_json(fpath)
    for k in sorted(data.keys()):
        if 'nw_fruchtfolge' in k:
            found = True
            print("QUELLE: " + fpath)
            print("KEY: " + k)
            print(json.dumps(data[k], indent=2, ensure_ascii=False))
            print()
if not found:
    print("NICHT GEFUNDEN!")
print()

# 3. gis_fach/nw_kantonaler_richtplan - MAPTIP (Zusammenfassung)
print("=== 3. MAPTIP: gis_fach/nw_kantonaler_richtplan ===")
data = read_json('/www/core/config/maptips_tnet_gis_fach_multi.conf')
rp_keys = sorted([k for k in data if 'nw_kantonaler_richtplan' in k])
print("Anzahl Eintraege: " + str(len(rp_keys)))
if rp_keys:
    print("Erster Key: " + rp_keys[0])
    print(json.dumps(data[rp_keys[0]], indent=2, ensure_ascii=False))
    print()
    print("Weitere Keys (query_layers | linked_layer):")
    for k in rp_keys[1:]:
        v = data[k]
        ql = v.get('query_layers', '-')
        ll = v.get('linked_layer', '-')
        print("  " + k + "  ql=" + str(ql) + "  ll=" + ll)
print()

# 4. LAYERS CONFIG
print("=== 4. LAYERS CONFIG: baulinien ===")
data = read_json('/www/core/config/layers-GIS-oereb-wms.conf')
if key1 in data:
    print("QUELLE: layers-GIS-oereb-wms.conf")
    print(json.dumps(data[key1], indent=2, ensure_ascii=False))
print()

# Alle layers-Dateien auflisten und nach fruchtfolge/richtplan suchen
items = sftp.listdir('/www/core/config')
layer_files = sorted([f for f in items if f.startswith('layers') and f.endswith('.conf')])
print("Layers-Dateien: " + str(layer_files))
print()

for lf in layer_files:
    fp = '/www/core/config/' + lf
    try:
        d = read_json(fp)
        for k in sorted(d.keys()):
            if 'nw_fruchtfolge' in k:
                print("LAYER (fruchtfolge): " + k + "  in " + lf)
                print(json.dumps(d[k], indent=2, ensure_ascii=False))
                print()
            elif k == 'gis_fach/nw_kantonaler_richtplan':
                print("LAYER (richtplan): " + k + "  in " + lf)
                print(json.dumps(d[k], indent=2, ensure_ascii=False))
                print()
    except:
        pass

sftp.close()
ssh.close()
print("Fertig.")
