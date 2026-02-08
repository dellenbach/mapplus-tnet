"""Test geo.admin.ch API für ÖREB - Mehrfach-Ergebnisse und Objektarten"""
import urllib.request, json

# Testkoordinaten wo möglicherweise Baurecht existiert
# Sarnen OW Zentrum
coords = [
    (2661200, 1196800, "Sarnen Zentrum"),
    (2673880, 1185883, "OW Test"),
    (2660800, 1197200, "Sarnen Bahnhof"),
]

for x, y, label in coords:
    url = (
        f'https://api3.geo.admin.ch/rest/services/ech/MapServer/identify'
        f'?geometryType=esriGeometryPoint'
        f'&geometry={x},{y}'
        f'&tolerance=0'
        f'&layers=all:ch.kantone.cadastralwebmap-farbe'
        f'&returnGeometry=false'
        f'&sr=2056'
    )
    try:
        r = urllib.request.urlopen(url)
        d = json.loads(r.read())
        results = d.get('results', [])
        print(f"\n=== {label} ({x},{y}) - {len(results)} Treffer ===")
        for i, res in enumerate(results):
            a = res['attributes']
            print(f"  [{i}] EGRID={a.get('egris_egrid','?')} Nr={a.get('number','?')} "
                  f"Typ={a.get('realestate_type','?')} Kanton={a.get('ak','?')} "
                  f"IdentDN={a.get('identnd','?')} Label={a.get('label','?')}")
    except Exception as e:
        print(f"\n=== {label} ({x},{y}) - FEHLER: {e} ===")

# Jetzt mit tolerance=1 und imageDisplay um benachbarte Parzellen zu finden
print("\n\n=== TEST mit tolerance=1 ===")
url = (
    'https://api3.geo.admin.ch/rest/services/ech/MapServer/identify'
    '?geometryType=esriGeometryPoint'
    '&geometry=2661200,1196800'
    '&tolerance=1'
    '&layers=all:ch.kantone.cadastralwebmap-farbe'
    '&returnGeometry=false'
    '&sr=2056'
    '&imageDisplay=1000,1000,96'
    '&mapExtent=2660000,1196000,2662000,1198000'
)
try:
    r = urllib.request.urlopen(url)
    d = json.loads(r.read())
    results = d.get('results', [])
    print(f"  {len(results)} Treffer")
    for i, res in enumerate(results):
        a = res['attributes']
        print(f"  [{i}] EGRID={a.get('egris_egrid','?')} Nr={a.get('number','?')} "
              f"Typ={a.get('realestate_type','?')} Label={a.get('label','?')}")
except Exception as e:
    print(f"  FEHLER: {e}")
