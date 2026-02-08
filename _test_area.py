"""Test multi-EGRID: alle Felder + Fläche aus Geometrie berechnen"""
import urllib.request, json, math

url = (
    'https://api3.geo.admin.ch/rest/services/ech/MapServer/identify'
    '?geometryType=esriGeometryPoint'
    '&geometry=2661200,1196800'
    '&tolerance=50'
    '&layers=all:ch.kantone.cadastralwebmap-farbe'
    '&returnGeometry=true'
    '&sr=2056'
    '&geometryFormat=geojson'
    '&imageDisplay=1000,1000,96'
    '&mapExtent=2660000,1196000,2662000,1198000'
)
r = urllib.request.urlopen(url)
d = json.loads(r.read())

def polygon_area(coords):
    """Shoelace formula for polygon area in m²"""
    n = len(coords)
    area = 0
    for i in range(n):
        j = (i + 1) % n
        area += coords[i][0] * coords[j][1]
        area -= coords[j][0] * coords[i][1]
    return abs(area) / 2

# Gemeinde-Mapping aus identnd
# identnd format: "OW0200001407" -> Kanton OW, BFS-Nr 0200, ...
# We can get the municipality name from another API

for x in d['results']:
    p = x['properties']
    geom = x.get('geometry', {})
    area_m2 = 0
    if geom and geom.get('type') == 'Polygon' and geom.get('coordinates'):
        area_m2 = polygon_area(geom['coordinates'][0])
    
    print(f"EGRID={p['egris_egrid']} Nr={p['number']} "
          f"Typ={p.get('realestate_type','?')} "
          f"identnd={p['identnd']} "
          f"Kanton={p['ak']} "
          f"Label={p.get('label','?')} "
          f"Fläche={round(area_m2)} m²")

# Check if we can get municipality from identnd via another API
print("\n=== Gemeinde-Info via identnd ===")
# identnd=OW0200001407: first 2 chars = canton, next 4 = BFS-Nr
identnd = d['results'][0]['properties']['identnd']
print(f"identnd: {identnd}")
print(f"Kanton: {identnd[:2]}")
print(f"BFS-Muster: {identnd[2:6]}")
