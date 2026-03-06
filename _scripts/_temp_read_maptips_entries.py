"""
_temp_read_maptips_entries.py
Liest Maptips-Einträge für spezifische Layer-IDs vom Server.
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

# Alle maptips.conf Dateien sammeln
maptips_paths = []
for base in ['/www/core/config', '/www/maps/core/config', '/www/maps/public/config']:
    try:
        items = sftp.listdir(base)
        for item in items:
            if item.startswith('maptips') and item.endswith('.conf'):
                maptips_paths.append(base + '/' + item)
    except Exception as e:
        print(f"SKIP {base}: {e}")

print(f"=== Gefundene Maptips-Dateien: {len(maptips_paths)} ===")
for p in sorted(maptips_paths):
    print(f"  {p}")

# Jede Datei lesen und nach Schlüsseln suchen
print(f"\n=== Suche nach: {SEARCH_KEYS} ===\n")
found_entries = {}

for fpath in sorted(maptips_paths):
    try:
        with sftp.open(fpath, 'r') as f:
            content = f.read().decode('utf-8', errors='replace')
        
        # JSON parsen
        try:
            data = json.loads(content)
        except json.JSONDecodeError as e:
            # Versuche Kommentare zu entfernen
            cleaned = re.sub(r'//.*?$', '', content, flags=re.MULTILINE)
            cleaned = re.sub(r'/\*.*?\*/', '', cleaned, flags=re.DOTALL)
            try:
                data = json.loads(cleaned)
            except:
                print(f"  PARSE ERROR: {fpath}: {e}")
                # Fallback: Textsuche
                for sk in SEARCH_KEYS:
                    if sk in content:
                        print(f"  TEXTMATCH in {fpath} für '{sk}'")
                continue
        
        if not isinstance(data, dict):
            continue
            
        for key, val in data.items():
            for sk in SEARCH_KEYS:
                if sk in key:
                    entry_key = f"{fpath} :: {key}"
                    found_entries[entry_key] = val
                    print(f"FOUND: {fpath}")
                    print(f"  Key: {key}")
                    print(f"  Entry: {json.dumps(val, indent=4, ensure_ascii=False)}")
                    print()
            
            # Auch linked_layer prüfen
            if isinstance(val, dict):
                ll = val.get('linked_layer', '')
                ql = val.get('query_layers', '')
                for sk in SEARCH_KEYS:
                    if (sk in str(ll)) or (sk in str(ql)):
                        entry_key = f"{fpath} :: {key}"
                        if entry_key not in found_entries:
                            found_entries[entry_key] = val
                            print(f"FOUND (via linked_layer/query_layers): {fpath}")
                            print(f"  Key: {key}")
                            print(f"  Entry: {json.dumps(val, indent=4, ensure_ascii=False)}")
                            print()
    except Exception as e:
        print(f"  ERROR reading {fpath}: {e}")

# Auch layers.conf Dateien prüfen
print(f"\n=== Suche in layers.conf Dateien ===\n")
layers_paths = []
for base in ['/www/core/config', '/www/maps/core/config', '/www/maps/public/config']:
    try:
        items = sftp.listdir(base)
        for item in items:
            if item.startswith('layers') and item.endswith('.conf'):
                layers_paths.append(base + '/' + item)
    except:
        pass

print(f"Gefundene layers-Dateien: {len(layers_paths)}")
for p in sorted(layers_paths):
    print(f"  {p}")

for fpath in sorted(layers_paths):
    try:
        with sftp.open(fpath, 'r') as f:
            content = f.read().decode('utf-8', errors='replace')
        
        try:
            data = json.loads(content)
        except:
            cleaned = re.sub(r'//.*?$', '', content, flags=re.MULTILINE)
            cleaned = re.sub(r'/\*.*?\*/', '', cleaned, flags=re.DOTALL)
            try:
                data = json.loads(cleaned)
            except:
                for sk in SEARCH_KEYS:
                    if sk in content:
                        print(f"  TEXTMATCH in {fpath} für '{sk}'")
                continue
        
        if not isinstance(data, dict):
            continue
            
        for key, val in data.items():
            for sk in SEARCH_KEYS:
                if sk in key:
                    print(f"LAYER FOUND: {fpath}")
                    print(f"  Key: {key}")
                    print(f"  Entry: {json.dumps(val, indent=4, ensure_ascii=False)}")
                    print()
    except Exception as e:
        print(f"  ERROR reading {fpath}: {e}")

if not found_entries:
    print("\n!!! KEINE Maptips-Einträge gefunden für die gesuchten Layer-IDs !!!")

sftp.close()
ssh.close()
