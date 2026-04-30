#!/usr/bin/env python3
"""Schnelltest: legendgroup=Gemeinde"""
import urllib.request, json

url = 'https://www.gis-daten.ch/maps/tnet/api/v1/legend-proxy.php?service=gis_oereb/nw_nutzungsplanung_DEF/MapServer&legendgroup=Gemeinde&nocache=1&format=json'
r = urllib.request.urlopen(url, timeout=60)
data = json.loads(r.read())

print('Status:', r.status)
print('groupField:', data.get('groupField'))
print('groupCount:', data.get('groupCount'))

for g in data.get('groups', []):
    print(f"  {g['groupValue']}: {g['layerCount']} Layer, {g['symbolCount']} Symbole")

# Fallback: wenn keine Gruppen → Fehler anzeigen
if 'groups' not in data:
    print('KEIN groups-Array! Keys:', list(data.keys()))
    if 'layers' in data:
        print('layerCount:', data.get('layerCount'))
