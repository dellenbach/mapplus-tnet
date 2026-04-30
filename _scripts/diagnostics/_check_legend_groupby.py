"""
Testet die groupByFieldsForStatistics Query direkt gegen Layer 12 (Grundnutzung).
Prüft welche Codes zurückkommen und welche fehlen.
"""
import urllib.request, json, ssl, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
ctx = ssl._create_unverified_context()

SERVICE = 'gis_oereb/nw_nutzungsplanung_DEF/MapServer'
BASE = 'https://www.gis-daten.ch/maps/agsproxy.php'
CODE_FIELD = 'Typ_Darstellungscode'
LABEL_FIELD = 'Typ_Bezeichnung'

# Layer 12 = Grundnutzung (meiste #-Codes)
LAYER_ID = 12

stats = json.dumps([{"statisticType": "count", "onStatisticField": "*", "outStatisticFieldName": "cnt"}])

params = urllib.parse.urlencode({
    'path': f'{SERVICE}/{LAYER_ID}/query',
    'where': '1=1',
    'groupByFieldsForStatistics': f'{CODE_FIELD},{LABEL_FIELD}',
    'outStatistics': stats,
    'returnGeometry': 'false',
    'f': 'pjson'
})

url = f'{BASE}?{params}'
print(f"URL: {url[:120]}...")
print()

resp = urllib.request.urlopen(url, context=ctx).read()
data = json.loads(resp)

if 'error' in data:
    print(f"FEHLER: {data['error']}")
    sys.exit(1)

features = data.get('features', [])
print(f"Anzahl Gruppen von Layer {LAYER_ID}: {len(features)}")
print()

# Codes sammeln
codes_from_query = {}
for f in features:
    a = f['attributes']
    code = str(a.get(CODE_FIELD, ''))
    label = a.get(LABEL_FIELD, '')
    codes_from_query[code] = label
    print(f"  {code:25s} -> {label}")

# Jetzt gegen Legend-Proxy resolve=false vergleichen
print()
print("=" * 80)
url_raw = f'https://www.gis-daten.ch/maps/tnet/api/v1/legend-proxy.php?service={SERVICE}&nocache=1&format=json&resolve=false'
raw = json.loads(urllib.request.urlopen(url_raw, context=ctx).read())

missing_in_query = []
for layer in raw['layers']:
    if layer['layerId'] != LAYER_ID:
        continue
    for entry in layer['legend']:
        label = entry.get('label', '')
        vals = entry.get('values', [])
        code = vals[0] if vals else ''
        if '#' in label and code:
            clean_code = code
            if clean_code not in codes_from_query:
                missing_in_query.append((clean_code, label))

print(f"\nLayer {LAYER_ID}: #-Codes NICHT in groupBy-Ergebnis: {len(missing_in_query)}")
for code, label in sorted(missing_in_query)[:30]:
    print(f"  {code:25s} (Legend-Label: {label})")
if len(missing_in_query) > 30:
    print(f"  ... und {len(missing_in_query) - 30} weitere")
