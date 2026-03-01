#!/usr/bin/env python3
"""Test Auto-Default legendgroup + none"""
import urllib.request, json

BASE = 'https://www.gis-daten.ch/maps/tnet/api/v1/legend-proxy.php?service=gis_oereb/nw_nutzungsplanung_DEF/MapServer&nocache=1&format=json'

tests = [
    ('OHNE legendgroup (Auto)', BASE),
    ('legendgroup=none', BASE + '&legendgroup=none'),
    ('legendgroup=Gemeinde', BASE + '&legendgroup=Gemeinde'),
]

for label, url in tests:
    r = urllib.request.urlopen(url, timeout=90)
    data = json.loads(r.read())
    gf = data.get('groupField', '-')
    gc = data.get('groupCount', '-')
    lc = data.get('layerCount', '-')
    
    if 'groups' in data:
        print(f"{label}: groupField={gf}, groupCount={gc}")
    else:
        print(f"{label}: KEIN groupField, layerCount={lc}")
