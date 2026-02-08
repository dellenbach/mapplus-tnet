"""Test multi-EGRID mit tolerance"""
import urllib.request, json

url = (
    'https://api3.geo.admin.ch/rest/services/ech/MapServer/identify'
    '?geometryType=esriGeometryPoint'
    '&geometry=2661200,1196800'
    '&tolerance=50'
    '&layers=all:ch.kantone.cadastralwebmap-farbe'
    '&returnGeometry=false'
    '&sr=2056'
    '&imageDisplay=1000,1000,96'
    '&mapExtent=2660000,1196000,2662000,1198000'
)
r = urllib.request.urlopen(url)
d = json.loads(r.read())
results = d['results']
print(f"{len(results)} Treffer")
for i, x in enumerate(results):
    a = x['attributes']
    print(f"  [{i}] EGRID={a.get('egris_egrid','?')} Nr={a.get('number','?')} Typ={a.get('realestate_type','?')} Label={a.get('label','?')}")

# Auch testen mit dem Baurecht-spezifischen Layer
print("\n=== Test mit ch.BFSNR ===")
url2 = (
    'https://api3.geo.admin.ch/rest/services/ech/MapServer/identify'
    '?geometryType=esriGeometryPoint'
    '&geometry=2661200,1196800'
    '&tolerance=0'
    '&layers=all:ch.kantone.cadastralwebmap-farbe'
    '&returnGeometry=false'
    '&sr=2056'
)
r2 = urllib.request.urlopen(url2)
d2 = json.loads(r2.read())
# Print full response to see all available fields
print(json.dumps(d2, indent=2, ensure_ascii=False))
