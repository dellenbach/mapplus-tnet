import urllib.request

urls = [
    'https://www.gis-daten.ch/map/nw_nutzungsplanung/pub/images/custom/Logo-GIS-Daten-AG_wuerfel.svg',
    'https://www.gis-daten.ch/app/pub/images/custom/Logo-GIS-Daten-AG_wuerfel.svg',
    'https://map.gis-daten.ch/pub/images/custom/Logo-GIS-Daten-AG_wuerfel.svg',
    'https://nw.gis-daten.ch/pub/images/custom/Logo-GIS-Daten-AG_wuerfel.svg',
    'https://webgis.gis-daten.ch/pub/images/custom/Logo-GIS-Daten-AG_wuerfel.svg',
    'https://gis.gis-daten.ch/pub/images/custom/Logo-GIS-Daten-AG_wuerfel.svg',
]

for u in urls:
    try:
        req = urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0'})
        r = urllib.request.urlopen(req, timeout=5)
        print(f"OK ({r.status}): {u}")
        # Save it
        data = r.read()
        with open(r'maps/tnet/resources/Logo-GIS-Daten-AG_wuerfel.svg', 'wb') as f:
            f.write(data)
        print(f"  Saved! ({len(data)} bytes)")
        break
    except Exception as e:
        print(f"FAIL: {u} -> {str(e)[:80]}")
