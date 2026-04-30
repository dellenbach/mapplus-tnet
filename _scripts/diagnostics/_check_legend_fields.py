"""
Prüft für jeden Layer im Service, ob die Felder Typ_Darstellungscode
und Typ_Bezeichnung existieren und ob groupByFieldsForStatistics klappt.
"""
import urllib.request, json, ssl, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
ctx = ssl._create_unverified_context()

SERVICE = 'gis_oereb/nw_nutzungsplanung_DEF/MapServer'
BASE = 'https://www.gis-daten.ch/maps/agsproxy.php'
CODE_FIELD = 'Typ_Darstellungscode'
LABEL_FIELD = 'Typ_Bezeichnung'

# 1) Layer-Liste holen
url = f'{BASE}?path={SERVICE}&f=pjson'
svc = json.loads(urllib.request.urlopen(url, context=ctx).read())
layers = svc.get('layers', [])
print(f"Service hat {len(layers)} Layers")
print()

for li in layers:
    lid = li['id']
    lname = li['name']
    
    # Felder des Layers abfragen
    furl = f'{BASE}?path={SERVICE}/{lid}&f=pjson'
    try:
        ldata = json.loads(urllib.request.urlopen(furl, context=ctx).read())
    except:
        print(f"  L{lid}: FEHLER beim Laden der Layer-Info")
        continue
    
    fields = [f['name'] for f in ldata.get('fields', [])]
    has_code = CODE_FIELD in fields
    has_label = LABEL_FIELD in fields
    
    # groupBy testen
    stats = json.dumps([{"statisticType": "count", "onStatisticField": "*", "outStatisticFieldName": "cnt"}])
    qurl = f'{BASE}?path={SERVICE}/{lid}/query&where=1%3D1&groupByFieldsForStatistics={CODE_FIELD}%2C{LABEL_FIELD}&outStatistics={stats}&returnGeometry=false&f=pjson'
    
    try:
        qdata = json.loads(urllib.request.urlopen(qurl, context=ctx).read())
        if 'error' in qdata:
            qresult = f"FEHLER: {qdata['error'].get('message', '?')}"
            qcount = 0
        else:
            qcount = len(qdata.get('features', []))
            qresult = f"OK: {qcount} Gruppen"
    except Exception as e:
        qresult = f"EXCEPTION: {e}"
        qcount = 0
    
    marker = "✓" if qcount > 0 else "✗"
    print(f"  L{lid:2d} {lname:50s} | Code={has_code} Label={has_label} | {marker} {qresult}")
