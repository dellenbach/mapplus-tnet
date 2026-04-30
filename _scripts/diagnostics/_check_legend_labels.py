"""
Prüft die Label-Auflösung des Legend-Proxy und gibt eine Mapping-Tabelle aus.
"""
import urllib.request, json, ssl

ctx = ssl._create_unverified_context()
url = 'https://www.gis-daten.ch/maps/tnet/api/v1/legend-proxy.php?service=gis_oereb/nw_nutzungsplanung_DEF/MapServer&nocache=1&format=json'
data = json.loads(urllib.request.urlopen(url, context=ctx).read())

print(f"Service: {data['service']}")
print(f"Layers: {data['layerCount']}")
print()

# Statistiken
total = 0
lookup = 0
inline = 0
fallback = 0
unresolved = 0

header = f"{'Layer':5s} | {'Code':25s} | {'Label':55s} | {'Quelle'}"
print(header)
print("-" * len(header))

for layer in data['layers']:
    lid = layer['layerId']
    lname = layer['layerName']
    for entry in layer['legend']:
        vals = entry.get('values', [])
        label = entry.get('label', '')
        rf = entry.get('_resolvedFrom', '')
        code = vals[0] if vals else ''
        
        # Nur Einträge zeigen, die einen #-Code hatten oder aufgelöst wurden
        if rf:
            total += 1
            src = rf
            if rf == '#:lookup':
                lookup += 1
            elif rf == '#:inline':
                inline += 1
            elif rf == '#:fallback':
                fallback += 1
            print(f"L{lid:<4d} | {code:25s} | {label:55s} | {src}")
        elif code and code != label and not label.startswith('<'):
            # Label != Code aber kein _resolvedFrom -> möglicherweise nicht aufgelöst
            # Prüfe ob Code wie ein #-Code aussieht (z.B. 81NO04, 11WO01)
            if len(code) >= 4 and any(c.isdigit() for c in code) and any(c.isalpha() for c in code):
                total += 1
                unresolved += 1
                print(f"L{lid:<4d} | {code:25s} | {label:55s} | NICHT AUFGELÖST!")

print()
print("=" * 60)
print(f"Total #-Labels: {total}")
print(f"  Lookup (Attribut-Query): {lookup}")
print(f"  Inline (nach #):        {inline}")
print(f"  Fallback (Code):        {fallback}")
print(f"  NICHT AUFGELÖST:        {unresolved}")
print()

# Zeige auch Layer ohne resolve-Info die auffällig sind
print("Alle eindeutigen Labels pro Code (nur aufgelöste):")
print("-" * 60)
code_labels = {}
for layer in data['layers']:
    for entry in layer['legend']:
        rf = entry.get('_resolvedFrom', '')
        if rf:
            vals = entry.get('values', [])
            code = vals[0] if vals else ''
            label = entry.get('label', '')
            if code not in code_labels:
                code_labels[code] = {}
            code_labels[code][label] = rf

for code in sorted(code_labels.keys()):
    labels = code_labels[code]
    for label, src in labels.items():
        print(f"  {code:25s} -> {label:45s} [{src}]")
