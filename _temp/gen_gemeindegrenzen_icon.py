"""
Generiert overlay-gemeindegrenzen.svg aus der BFS-Gemeinde-GeoJSON,
gefiltert auf die Kantone OW + NW. Einmalig ausfuehren.

Farben (Strich) pro Kanton:
- OW (Obwalden): #4B7B81
- NW (Nidwalden): #DD1633
"""
import json, urllib.request, math

URL = ('https://www.agvchapp.bfs.admin.ch/api/boundaries/divisions'
       '?division=Commune&resolution=K4&dissolve=true&date=01-01-2026')
OUT = r'c:\_Daten\mapplus-tnet\maps-dev\tnet\resources\icons\overlay-gemeindegrenzen.svg'

# Strichfarbe je Kanton
KANTON_COLORS = {'OW': '#4B7B81', 'NW': '#DD1633'}

req = urllib.request.Request(URL, headers={'User-Agent': 'Mozilla/5.0'})
data = json.load(urllib.request.urlopen(req, timeout=120))

# Ringe je Kanton sammeln (KTKZ bleibt erhalten, damit pro Kanton eigene Farbe).
rings_by_kt = {'OW': [], 'NW': []}
for f in data['features']:
    kt = (f.get('properties') or {}).get('KTKZ')
    if kt not in ('OW', 'NW'):
        continue
    g = f['geometry']
    polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
    for poly in polys:
        for ring in poly:
            rings_by_kt[kt].append([(c[0], c[1]) for c in ring])

all_rings = rings_by_kt['OW'] + rings_by_kt['NW']

# Koordinatensystem erkennen (WGS84 vs LV95) und x isotrop machen.
allx = [p[0] for r in all_rings for p in r]
ally = [p[1] for r in all_rings for p in r]
is_wgs = max(allx) < 1000
if is_wgs:
    meanlat = (min(ally) + max(ally)) / 2
    xf = math.cos(math.radians(meanlat))
else:
    xf = 1.0

# Gemeinsame Bounding-Box ueber BEIDE Kantone (gleicher Massstab/Transform).
pts_by_kt = {kt: [[(x * xf, y) for (x, y) in r] for r in rings]
             for kt, rings in rings_by_kt.items()}
xs = [p[0] for rings in pts_by_kt.values() for r in rings for p in r]
ys = [p[1] for rings in pts_by_kt.values() for r in rings for p in r]
minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
gw, gh = maxx - minx, maxy - miny
PAD, SIZE = 1.5, 24.0
avail = SIZE - 2 * PAD
scale = avail / max(gw, gh)
offx = PAD + (avail - gw * scale) / 2
offy = PAD + (avail - gh * scale) / 2

def tx(x): return round(offx + (x - minx) * scale, 2)
def ty(y): return round(offy + (maxy - y) * scale, 2)

def build_path_d(rings):
    parts = []
    for r in rings:
        if len(r) < 3:
            continue
        parts.append('M' + ' '.join('%g,%g' % (tx(x), ty(y)) for x, y in r) + 'Z')
    return ' '.join(parts)

# Ein <path> je Kanton mit eigener Strichfarbe.
path_els = []
for kt in ('OW', 'NW'):
    d = build_path_d(pts_by_kt[kt])
    if not d:
        continue
    path_els.append('<path d="%s" stroke="%s"/>' % (d, KANTON_COLORS[kt]))

svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" '
       'fill="none" stroke-width="0.55" stroke-linejoin="round" '
       'stroke-linecap="round" aria-hidden="true">%s</svg>\n' % ''.join(path_els))

with open(OUT, 'w', encoding='utf-8') as fh:
    fh.write(svg)

print('OW rings:', len(rings_by_kt['OW']), '| NW rings:', len(rings_by_kt['NW']),
      '| wgs:', is_wgs, '| bytes:', len(svg))

