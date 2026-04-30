"""
Detaillierte Prüfung: welche Einträge haben '#' im Original-Label,
welche sind auf Layer 12 falsch-positive, und welche fehlen wirklich?
"""
import urllib.request, json, ssl

ctx = ssl._create_unverified_context()

# 1) Hole das JSON MIT resolve (aktuelle Produktion)
url_resolved = 'https://www.gis-daten.ch/maps/tnet/api/v1/legend-proxy.php?service=gis_oereb/nw_nutzungsplanung_DEF/MapServer&nocache=1&format=json'
data = json.loads(urllib.request.urlopen(url_resolved, context=ctx).read())

# 2) Hole das JSON OHNE resolve (Originaldaten)
url_raw = 'https://www.gis-daten.ch/maps/tnet/api/v1/legend-proxy.php?service=gis_oereb/nw_nutzungsplanung_DEF/MapServer&nocache=1&format=json&resolve=false'
raw = json.loads(urllib.request.urlopen(url_raw, context=ctx).read())

# Baue Index der Roh-Labels
raw_labels = {}  # (layerId, code) -> original_label
for layer in raw['layers']:
    lid = layer['layerId']
    for entry in layer['legend']:
        vals = entry.get('values', [])
        if vals:
            raw_labels[(lid, vals[0])] = entry.get('label', '')

print("=" * 100)
print("MAPPING-TABELLE: Label-Auflösung Legend-Proxy")
print("Service: gis_oereb/nw_nutzungsplanung_DEF/MapServer")
print("=" * 100)
print()

# Statistiken
hash_total = 0
resolved_lookup = 0
resolved_inline = 0
resolved_fallback = 0
unresolved_hash = 0

print(f"{'LID':>4s} | {'Code':25s} | {'Original-Label':50s} | {'Aufgelöstes Label':50s} | {'Quelle'}")
print("-" * 190)

for layer in data['layers']:
    lid = layer['layerId']
    for entry in layer['legend']:
        vals = entry.get('values', [])
        label = entry.get('label', '')
        rf = entry.get('_resolvedFrom', '')
        code = vals[0] if vals else ''
        
        original = raw_labels.get((lid, code), '')
        has_hash = '#' in original
        
        if has_hash or rf:
            hash_total += 1
            if rf == '#:lookup':
                resolved_lookup += 1
            elif rf == '#:inline':
                resolved_inline += 1
            elif rf == '#:fallback':
                resolved_fallback += 1
            elif not rf and has_hash:
                unresolved_hash += 1
                rf = '!! NICHT AUFGELÖST !!'
            
            print(f"{lid:4d} | {code:25s} | {original:50s} | {label:50s} | {rf}")

print()
print("=" * 100)
print(f"ZUSAMMENFASSUNG")
print(f"  Einträge mit '#' im Original:  {hash_total}")
print(f"  Aufgelöst via Lookup:          {resolved_lookup}")
print(f"  Aufgelöst via Inline:          {resolved_inline}")
print(f"  Aufgelöst via Fallback:        {resolved_fallback}")
print(f"  NICHT AUFGELÖST:               {unresolved_hash}")
print()

if unresolved_hash > 0:
    print("FEHLENDE AUFLÖSUNGEN:")
    print("-" * 80)
    for layer in data['layers']:
        lid = layer['layerId']
        for entry in layer['legend']:
            vals = entry.get('values', [])
            code = vals[0] if vals else ''
            original = raw_labels.get((lid, code), '')
            rf = entry.get('_resolvedFrom', '')
            if '#' in original and not rf:
                print(f"  L{lid}: {code} (Original: {original})")
