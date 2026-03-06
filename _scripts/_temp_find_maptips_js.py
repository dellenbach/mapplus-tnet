"""
Lade maptips.js vom Framework-Server herunter.
"""
import urllib.request, os, ssl

ctx = ssl.create_default_context()
local_dir = r'c:\_Daten\mapplus-exp\_temp_framework'

# Maptips.js kann an verschiedenen Stellen liegen
urls_to_try = [
    'https://www.gis-daten.ch/mapplus-lib/mapplus-dojo/v4.0.0/maptips.js',
    'https://www.gis-daten.ch/mapplus-lib/mapplus-dojo/v4.0.0/provider/OLPlus/maptips.js',
    'https://www.gis-daten.ch/maps/public/config/maptips.js',
]

for url in urls_to_try:
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        resp = urllib.request.urlopen(req, context=ctx, timeout=15)
        data = resp.read()
        fname = url.split('/')[-1]
        if 'provider' in url:
            fname = 'OLPlus_maptips.js'
        local = os.path.join(local_dir, fname)
        with open(local, 'wb') as f:
            f.write(data)
        print(f"OK: {url} ({len(data)} Bytes)")
    except Exception as e:
        print(f"FEHLER: {url} — {e}")

# Auch das Verzeichnis-Listing der JS-Dateien im Framework versuchen
# Suche nach wmsServiceMapTip in den bereits heruntergeladenen Dateien
print("\n=== Suche wmsServiceMapTip in heruntergeladenen Dateien ===")
for fname in os.listdir(local_dir):
    if fname.endswith('.js'):
        fpath = os.path.join(local_dir, fname)
        with open(fpath, 'r', encoding='utf-8', errors='replace') as f:
            content = f.read()
        if 'wmsServiceMapTip' in content:
            # Finde relevante Zeilen
            for i, line in enumerate(content.splitlines()):
                if 'wmsServiceMapTip' in line:
                    print(f"  {fname}:{i+1}: {line.strip()[:200]}")

# Suche nach MapTip-Registrierung
print("\n=== Suche MapTip-Registrierung in appmanager.js ===")
fpath = os.path.join(local_dir, 'appmanager.js')
with open(fpath, 'r', encoding='utf-8', errors='replace') as f:
    content = f.read()
for i, line in enumerate(content.splitlines()):
    if any(kw in line for kw in ['maptips.js', 'MapTip[', 'wmsServiceMapTip', 'MapTips._wms_connector']):
        print(f"  {i+1}: {line.strip()[:200]}")

print("DONE")
