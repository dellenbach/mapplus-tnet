"""
Lade Framework-Dateien direkt per HTTPS herunter.
URL: https://www.gis-daten.ch/mapplus-lib/mapplus-dojo/v4.0.0/
"""
import urllib.request, os, ssl

# SSL-Kontext (falls nötig)
ctx = ssl.create_default_context()

base_url = "https://www.gis-daten.ch/mapplus-lib/mapplus-dojo/v4.0.0"
files = ['openlayers.js', 'appmanager.js', 'common.js', 'njs.js', 'layout.js', 'search.js', 'floatingwindow.js']
local_dir = r'c:\_Daten\mapplus-exp\_temp_framework'
os.makedirs(local_dir, exist_ok=True)

for fname in files:
    url = f"{base_url}/{fname}"
    local = os.path.join(local_dir, fname)
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        resp = urllib.request.urlopen(req, context=ctx, timeout=15)
        data = resp.read()
        with open(local, 'wb') as f:
            f.write(data)
        print(f"OK: {fname} ({len(data)} Bytes)")
    except Exception as e:
        print(f"FEHLER: {fname} — {e}")

# OLPlus Provider
url = f"{base_url}/provider/OLPlus/openlayers.js"
local = os.path.join(local_dir, "OLPlus_openlayers.js")
try:
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    resp = urllib.request.urlopen(req, context=ctx, timeout=15)
    data = resp.read()
    with open(local, 'wb') as f:
        f.write(data)
    print(f"OK: OLPlus/openlayers.js ({len(data)} Bytes)")
except Exception as e:
    print(f"FEHLER: OLPlus/openlayers.js — {e}")

# modules.js config
url2 = "https://www.gis-daten.ch/maps/public/config/modules.js"
local2 = os.path.join(local_dir, "modules.js")
try:
    req = urllib.request.Request(url2, headers={'User-Agent': 'Mozilla/5.0'})
    resp = urllib.request.urlopen(req, context=ctx, timeout=15)
    data = resp.read()
    with open(local2, 'wb') as f:
        f.write(data)
    print(f"OK: modules.js ({len(data)} Bytes)")
except Exception as e:
    print(f"FEHLER: modules.js — {e}")

print("DONE")
