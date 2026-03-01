"""
Testet ob die Renderer-Definition (drawingInfo) ALLE Code-Label-Paare enthält.
"""
import urllib.request, json, ssl, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
ctx = ssl._create_unverified_context()

SERVICE = 'gis_oereb/nw_nutzungsplanung_DEF/MapServer'
BASE = 'https://www.gis-daten.ch/maps/agsproxy.php'

LAYER_ID = 12

# Layer-Definition mit drawingInfo abrufen
params = urllib.parse.urlencode({
    'path': f'{SERVICE}/{LAYER_ID}',
    'f': 'pjson'
})
url = f'{BASE}?{params}'
resp = urllib.request.urlopen(url, context=ctx).read()
data = json.loads(resp)

renderer = data.get('drawingInfo', {}).get('renderer', {})
rtype = renderer.get('type', '')
print(f"Renderer-Typ: {rtype}")

if rtype == 'uniqueValue':
    field1 = renderer.get('field1', '')
    field2 = renderer.get('field2', '')
    field3 = renderer.get('field3', '')
    print(f"Field1: {field1}, Field2: {field2}, Field3: {field3}")
    
    uvis = renderer.get('uniqueValueInfos', [])
    print(f"Anzahl uniqueValueInfos: {len(uvis)}")
    print()
    
    # Zeige einige Beispiele
    for uvi in uvis[:20]:
        val = uvi.get('value', '')
        label = uvi.get('label', '')
        print(f"  value={val:25s}  label={label}")
    
    if len(uvis) > 20:
        print(f"  ... und {len(uvis) - 20} weitere")
    
    # Prüfe: enthalten die uniqueValueInfos die fehlenden Codes?
    missing_codes = ['11WO01', '11WO02', '11WO10', '13MI01', '15OE01']
    print()
    print("Prüfe fehlende Codes:")
    for mc in missing_codes:
        found = [u for u in uvis if u.get('value', '') == mc]
        if found:
            print(f"  {mc}: GEFUNDEN -> label='{found[0].get('label', '')}'")
        else:
            print(f"  {mc}: NICHT GEFUNDEN")
            
    # Prüfe ob Label im Renderer das # enthält
    hash_in_renderer = sum(1 for u in uvis if '#' in u.get('label', ''))
    print(f"\nRenderer-Labels mit '#': {hash_in_renderer} von {len(uvis)}")
else:
    print(f"Kein uniqueValue Renderer, sondern: {rtype}")
    # Prüfe ob classBreaks oder anders
    print(json.dumps(renderer, indent=2)[:500])
