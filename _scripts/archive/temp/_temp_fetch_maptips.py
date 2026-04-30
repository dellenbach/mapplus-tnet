import urllib.request
import json

# Direkt den geladenen maptips-Config vom Server via HTTP holen (wie der Browser)
url = "https://www.gis-daten.ch/maps/public/loader.php"
data = "f=/config/maptips.conf&g=&p=public"
req = urllib.request.Request(url, data=data.encode('utf-8'), method='POST')
req.add_header('Content-Type', 'application/x-www-form-urlencoded')

try:
    with urllib.request.urlopen(req, timeout=15) as resp:
        raw = resp.read().decode('utf-8')
    maptips = json.loads(raw)
    
    # Alle linked_layer Werte extrahieren
    linked_layers = {}
    maptip_count = 0
    for key, val in maptips.items():
        if isinstance(val, dict) and 'type' in val:
            maptip_count += 1
            ll = val.get('linked_layer', '(KEINE)')
            if ll not in linked_layers:
                linked_layers[ll] = []
            linked_layers[ll].append(key)
    
    print(f"MapTip-Eintraege total: {maptip_count}")
    print(f"Unique linked_layer Werte: {len(linked_layers)}")
    
    # Alle unique linked_layer Werte anzeigen
    print("\n===== ALLE linked_layer Werte =====")
    for ll in sorted(linked_layers.keys()):
        count = len(linked_layers[ll])
        example = linked_layers[ll][0]
        print(f"  {ll}  (x{count}, z.B. {example})")
        
except Exception as e:
    print(f"HTTP Fehler: {e}")
    import traceback
    traceback.print_exc()
