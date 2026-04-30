"""
_temp_read_maptips_entries3.py
Fokussierte Suche: NUR die drei spezifischen Layer-IDs + zugehörige Layers-Einträge.
Kein Auflisten aller Sub-Layer.
"""
import paramiko, json, re

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

# ===== 1. Exakter Schlüssel: ch.astra.baulinien-nationalstrassen_v2_0.oereb =====
print("=" * 80)
print("1. MAPTIP: ch.astra.baulinien-nationalstrassen_v2_0.oereb")
print("=" * 80)

for fpath in [
    '/www/core/config/maptips-GIS-oereb-wms.conf',
    '/www/core/config/maptips_geoadmin.conf',
    '/www/maps/public/config/maptips.conf',
]:
    try:
        data = read_json(fpath)
        # Exakte Suche
        for exact_key in [
            'ch.astra.baulinien-nationalstrassen_v2_0.oereb',
            'ch.astra.baulinien-nationalstrassen',
        ]:
            if exact_key in data:
                print(f"\nDatei: {fpath}")
                print(f"Key: {exact_key}")
                print(json.dumps(data[exact_key], indent=2, ensure_ascii=False))
    except Exception as e:
        print(f"  Fehler: {fpath}: {e}")

# ===== 2. Exakter Schlüssel: gis_fach/nw_fruchtfolgeflaechen =====
print("\n\n" + "=" * 80)
print("2. MAPTIP: gis_fach/nw_fruchtfolgeflaechen")
print("=" * 80)

all_maptip_files = [
    '/www/core/config/maptips-GIS-oereb-wms.conf',
    '/www/core/config/maptips_geoadmin.conf',
    '/www/core/config/maptips_geodienste.conf',
    '/www/core/config/maptips_nodi_ch.conf',
    '/www/core/config/maptips_tnet_gis_fach_multi.conf',
    '/www/core/config/maptips_tnet_gis_fach_single.conf',
    '/www/core/config/maptips_tnet_gis_basis_multi.conf',
    '/www/core/config/maptips_tnet_gis_basis_single.conf',
    '/www/core/config/maptips_tnet_oereb_multi.conf',
    '/www/core/config/maptips_tnet_oereb_sinlge.conf',
    '/www/maps/public/config/maptips.conf',
]

found_fff = False
for fpath in all_maptip_files:
    try:
        data = read_json(fpath)
        for key in data:
            if 'fruchtfolge' in key.lower() and 'nw_' in key.lower():
                found_fff = True
                print(f"\nDatei: {fpath}")
                print(f"Key: {key}")
                print(json.dumps(data[key], indent=2, ensure_ascii=False))
    except Exception as e:
        print(f"  Fehler: {fpath}: {e}")

if not found_fff:
    print("\n=> KEIN Maptip-Eintrag für 'gis_fach/nw_fruchtfolgeflaechen' gefunden!")
    print("   Geprüft in allen 11 maptips-Dateien.")

# ===== 3. Schlüssel: gis_fach/nw_kantonaler_richtplan — Zählung =====
print("\n\n" + "=" * 80)
print("3. MAPTIP: gis_fach/nw_kantonaler_richtplan (Zusammenfassung)")
print("=" * 80)

for fpath in all_maptip_files:
    try:
        data = read_json(fpath)
        matches = [k for k in data if 'nw_kantonaler_richtplan' in k]
        if matches:
            print(f"\nDatei: {fpath}")
            print(f"  Anzahl Einträge: {len(matches)}")
            print(f"  Erster Schlüssel: {matches[0]}")
            # Ersten Eintrag komplett zeigen
            print(json.dumps(data[matches[0]], indent=2, ensure_ascii=False))
            if len(matches) > 1:
                print(f"  Weitere Schlüssel:")
                for m in matches[1:]:
                    val = data[m]
                    ll = val.get('linked_layer', '-') if isinstance(val, dict) else '-'
                    ql = val.get('query_layers', '-') if isinstance(val, dict) else '-'
                    print(f"    {m}  (query_layers={ql}, linked_layer={ll})")
    except Exception as e:
        print(f"  Fehler: {fpath}: {e}")

# ===== 4. Layers-Config =====
print("\n\n" + "=" * 80)
print("4. LAYERS CONFIG")
print("=" * 80)

layers_files = []
for base in ['/www/core/config', '/www/maps/core/config', '/www/maps/public/config']:
    try:
        items = sftp.listdir(base)
        for item in items:
            if item.startswith('layers') and item.endswith('.conf'):
                layers_files.append(base + '/' + item)
    except:
        pass

print(f"Layers-Dateien auf Server: {layers_files}")

for fpath in layers_files:
    try:
        data = read_json(fpath)
        for key in data:
            if any(sk in key for sk in ['fruchtfolge', 'kantonaler_richtplan', 'baulinien-nationalstrassen']):
                print(f"\nDatei: {fpath}")
                print(f"Key: {key}")
                entry = data[key]
                if isinstance(entry, dict):
                    print(f"  url: {entry.get('url', '-')}")
                    print(f"  type: {entry.get('type', '-')}")
                    print(f"  Vollständig: {json.dumps(entry, indent=2, ensure_ascii=False)}")
                else:
                    print(f"  Wert: {entry}")
    except Exception as e:
        print(f"  Fehler: {fpath}: {e}")

# ===== 5. Public maptips.conf Schlüssel mit gis_fach =====
print("\n\n" + "=" * 80)
print("5. public/config/maptips.conf — gis_fach Schlüssel")
print("=" * 80)
try:
    data = read_json('/www/maps/public/config/maptips.conf')
    gis_fach_keys = [k for k in data if 'gis_fach' in k]
    print(f"Anzahl gis_fach-Schlüssel: {len(gis_fach_keys)}")
    for k in gis_fach_keys[:5]:
        print(f"  {k}")
    if len(gis_fach_keys) > 5:
        print(f"  ... und {len(gis_fach_keys)-5} weitere")
    
    # Alle Schlüssel zeigen
    print(f"\nAlle {len(data)} Schlüssel in maptips.conf:")
    for k in sorted(data.keys())[:30]:
        print(f"  {k}")
    if len(data) > 30:
        print(f"  ... ({len(data)} total)")
except Exception as e:
    print(f"  Fehler: {e}")

sftp.close()
ssh.close()
print("\n\nFertig.")
