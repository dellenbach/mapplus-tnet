#!/usr/bin/env python3
"""Test: API abrufen, normalisieren und Tree-Rendering simulieren."""
import json
import urllib.request
import ssl

API_URL = "https://nwow.mapplus.ch/maps/tnet/api/v1/layers.php"

def fetch_api():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(API_URL)
    with urllib.request.urlopen(req, context=ctx) as resp:
        return json.loads(resp.read().decode('utf-8'))

def normalize(categories):
    """Gleiche Logik wie tnet-lm-store.js _normalizeCategories"""
    for cat in categories:
        # nodes → subcategories
        if 'nodes' in cat and 'subcategories' not in cat:
            cat['subcategories'] = cat['nodes']
            del cat['nodes']
        subs = cat.get('subcategories', [])
        for sub in subs:
            # subcategory.layers → subcategory.groups
            if 'layers' in sub and 'groups' not in sub:
                sub['groups'] = sub['layers']
                del sub['layers']

def simulate_render(catalog):
    """Simuliert tnet-lm-tree.js render + _renderCategory"""
    if not catalog:
        print("❌ catalog ist leer!")
        return

    active_tab = catalog[0]['id']
    print(f"\n=== Aktiver Tab: {active_tab} ===")

    for cat in catalog:
        is_active = cat['id'] == active_tab
        subcats = cat.get('subcategories', [])
        
        print(f"\n📁 Kategorie: {cat['id']} ({len(subcats)} subcategories)")
        
        if not is_active:
            print(f"   (nicht aktiv, wird lazy-loaded)")
            continue
        
        if not subcats:
            print(f"   ❌ KEINE SUBCATEGORIES! Vorhandene Keys: {list(cat.keys())}")
            # Zeige was vorhanden ist
            for key in cat:
                if isinstance(cat[key], list):
                    print(f"      '{key}': [{len(cat[key])} Einträge]")
                    if cat[key]:
                        first = cat[key][0]
                        print(f"         Erster Eintrag keys: {list(first.keys()) if isinstance(first, dict) else type(first)}")
            continue
        
        for sub in subcats:
            groups = sub.get('groups', [])
            sub_name = sub.get('name', '?')
            print(f"\n   📂 Subcategory: {sub_name} ({len(groups)} groups)")
            
            if not groups:
                print(f"      ❌ KEINE GROUPS! Vorhandene Keys: {list(sub.keys())}")
                for key in sub:
                    if isinstance(sub[key], list):
                        print(f"         '{key}': [{len(sub[key])} Einträge]")
                continue
            
            for g in groups[:3]:  # Erste 3 Gruppen
                layers = g.get('layers', [])
                g_name = g.get('name', '?')
                g_type = g.get('type', '?')
                g_open = g.get('open', None)
                
                # Prüfe ob "Einzel-Layer" (1 Layer, kein verschachtelter Typ)
                single = len(layers) == 1 and layers[0].get('type') != 'group'
                
                if single:
                    print(f"      🔹 Einzel-Layer: {layers[0].get('name', '?')}")
                else:
                    print(f"      📁 Gruppe: {g_name} (type={g_type}, open={g_open}, {len(layers)} layers)")
                    for l in layers[:2]:
                        l_type = l.get('type', '?')
                        l_name = l.get('name', '?')
                        if l_type == 'group':
                            sub_layers = l.get('layers', [])
                            print(f"         📁 Nested: {l_name} ({len(sub_layers)} layers)")
                        else:
                            print(f"         🔸 Layer: {l_name}")
            
            if len(groups) > 3:
                print(f"      ... und {len(groups) - 3} weitere Gruppen")

def main():
    print("🔄 API abrufen...")
    raw = fetch_api()
    
    data = raw.get('data', raw)
    categories = data.get('categories', [])
    
    print(f"✅ API liefert {len(categories)} Kategorien")
    
    # Vor Normalisierung
    print("\n--- VOR Normalisierung ---")
    for cat in categories:
        print(f"  {cat['id']}: keys={list(cat.keys())}")
        nodes_key = 'subcategories' if 'subcategories' in cat else ('nodes' if 'nodes' in cat else None)
        if nodes_key:
            nodes = cat[nodes_key]
            print(f"    '{nodes_key}': {len(nodes)} Einträge")
            if nodes:
                first = nodes[0]
                print(f"    Erster Eintrag: type={first.get('type')}, keys={list(first.keys())}")
                # Check ob layers oder groups
                if 'groups' in first:
                    print(f"    → Hat 'groups': {len(first['groups'])} Einträge")
                elif 'layers' in first:
                    print(f"    → Hat 'layers': {len(first['layers'])} Einträge")
                    if first['layers']:
                        fl = first['layers'][0]
                        print(f"      Erster layer: type={fl.get('type')}, name={fl.get('name', '?')[:50]}")
    
    # Normalisieren
    print("\n--- NORMALISIERUNG ---")
    normalize(categories)
    
    # Nach Normalisierung
    print("\n--- NACH Normalisierung ---")
    for cat in categories:
        subcats = cat.get('subcategories', [])
        print(f"  {cat['id']}: {len(subcats)} subcategories")
        if subcats:
            first = subcats[0]
            groups = first.get('groups', [])
            print(f"    Erste subcat '{first.get('name')}': {len(groups)} groups")
            if groups:
                fg = groups[0]
                print(f"    Erste group: name={fg.get('name', '?')[:50]}, type={fg.get('type')}, layers={len(fg.get('layers', []))}")
    
    # Rendering simulieren
    print("\n--- RENDERING SIMULATION ---")
    simulate_render(categories)
    
    print("\n✅ Test abgeschlossen")

if __name__ == "__main__":
    main()
