#!/usr/bin/env python3
"""Vergleich: resolve=true vs resolve=false mit legendgroup=Gemeinde"""
import urllib.request, json

BASE = 'https://www.gis-daten.ch/maps/tnet/api/v1/legend-proxy.php?service=gis_oereb/nw_nutzungsplanung_DEF/MapServer&legendgroup=Gemeinde&nocache=1&format=json'

for resolve in ['true', 'false']:
    url = BASE + '&resolve=' + resolve
    r = urllib.request.urlopen(url, timeout=90)
    data = json.loads(r.read())
    
    print(f"\n=== resolve={resolve} ===")
    print(f"groupCount: {data.get('groupCount')}")
    for g in data.get('groups', [])[:3]:  # nur erste 3 Gemeinden
        print(f"  {g['groupValue']}: {g['layerCount']} Layer, {g['symbolCount']} Symbole")
    print(f"  ...")
