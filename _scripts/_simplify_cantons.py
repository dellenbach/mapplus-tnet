"""
Fetch canton boundaries from swisstopo and simplify using Douglas-Peucker.
Saves as compact JSON for use in search-proxy.php.
"""
import json, urllib.request, math

def fetch_canton(name):
    url = ('https://api3.geo.admin.ch/rest/services/api/MapServer/find'
           '?layer=ch.swisstopo.swissboundaries3d-kanton-flaeche.fill'
           '&searchText=' + name + '&searchField=name&sr=2056'
           '&geometryFormat=geojson&returnGeometry=true&limit=1')
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    raw = urllib.request.urlopen(req, timeout=15).read()
    data = json.loads(raw)
    return data['results'][0]['geometry']

def douglas_peucker(coords, tolerance):
    if len(coords) <= 2:
        return coords
    start, end = coords[0], coords[-1]
    max_dist = 0
    max_idx = 0
    for i in range(1, len(coords) - 1):
        dx = end[0] - start[0]
        dy = end[1] - start[1]
        if dx == 0 and dy == 0:
            dist = math.hypot(coords[i][0] - start[0], coords[i][1] - start[1])
        else:
            t = ((coords[i][0] - start[0]) * dx + (coords[i][1] - start[1]) * dy) / (dx*dx + dy*dy)
            t = max(0, min(1, t))
            px = start[0] + t * dx
            py = start[1] + t * dy
            dist = math.hypot(coords[i][0] - px, coords[i][1] - py)
        if dist > max_dist:
            max_dist = dist
            max_idx = i
    if max_dist > tolerance:
        left = douglas_peucker(coords[:max_idx+1], tolerance)
        right = douglas_peucker(coords[max_idx:], tolerance)
        return left[:-1] + right
    else:
        return [start, end]

def simplify_multipolygon(geom, tolerance):
    result = []
    for polygon in geom['coordinates']:
        simplified_rings = []
        for ring in polygon:
            simplified = douglas_peucker(ring, tolerance)
            simplified = [[round(c[0], 0), round(c[1], 0)] for c in simplified]
            # Only keep rings with enough points
            if len(simplified) >= 4:
                simplified_rings.append(simplified)
        if simplified_rings:
            result.append(simplified_rings)
    return result

# Fetch
print('Fetching NW...')
nw_geom = fetch_canton('Nidwalden')
nw_raw = sum(len(r) for p in nw_geom['coordinates'] for r in p)
print(f'  NW raw: {nw_raw} points')

print('Fetching OW...')
ow_geom = fetch_canton('Obwalden')
ow_raw = sum(len(r) for p in ow_geom['coordinates'] for r in p)
print(f'  OW raw: {ow_raw} points')

# Simplify with 500m tolerance
tolerance = 500
nw_simplified = simplify_multipolygon(nw_geom, tolerance)
ow_simplified = simplify_multipolygon(ow_geom, tolerance)

nw_pts = sum(len(r) for p in nw_simplified for r in p)
ow_pts = sum(len(r) for p in ow_simplified for r in p)
print(f'  NW simplified: {nw_pts} points')
print(f'  OW simplified: {ow_pts} points')

# Build output
output = {
    'NW': nw_simplified,
    'OW': ow_simplified
}

outpath = r'c:\_Daten\mapplus-exp\maps\tnet\config\boundaries-simplified.json'
with open(outpath, 'w', encoding='utf-8') as f:
    json.dump(output, f, separators=(',', ':'))

size = len(json.dumps(output, separators=(',', ':')))
print(f'Saved to {outpath}')
print(f'File size: {size} bytes')
