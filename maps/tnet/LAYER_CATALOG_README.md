# Layer Catalog für Karte B (JavaScript-basiert, ohne Dojo)

## Übersicht

Dieses System konvertiert die `lyrmgr.conf` Konfiguration in ein einfaches JSON-Format und erstellt einen JavaScript-basierten Layer-Katalog für Karte B im Split-Screen-Modus.

## Komponenten

### 1. PHP Converter (`lyrmgr-to-json.php`)
**Pfad:** `/maps/tnet/lyrmgr-to-json.php`

**Funktion:**
- Liest `lyrmgr.conf` aus dem Config-Verzeichnis
- Konvertiert die Dojo-basierte Struktur in ein einfaches JSON
- Erstellt hierarchische Struktur: Kategorien → Gruppen → Layer

**JSON-Struktur:**
```json
{
  "version": "3",
  "categories": [
    {
      "id": "grundlagen",
      "name": "grundlagen",
      "icon": "njsCategoryIcon8",
      "groups": [
        {
          "id": "group_id",
          "name": "group_name",
          "open": false,
          "layers": [
            {
              "id": "gis_basis/layer_name",
              "name": "Layer Name",
              "type": "layer"
            }
          ]
        }
      ]
    }
  ]
}
```

### 2. Layer Catalog JavaScript (`tnet-layer-catalog.js`)
**Pfad:** `/maps/tnet/js/tnet-layer-catalog.js`

**Features:**
- Vanille JavaScript (kein Dojo, kein jQuery)
- Lädt Layer-Hierarchie vom PHP-Endpoint
- Erstellt collapsible Tree-View
- Toggle Layer Visibility
- Integration mit OpenLayers Map

**API:**
```javascript
// Initialisierung
var catalog = Object.create(window.TnetLayerCatalog);
catalog.init(olMapInstance);

// Cleanup
catalog.destroy();
```

### 3. Split-Screen Integration
**Pfad:** `/maps/tnet/js/tnet-splitscreen.js`

**Änderungen:**
- Automatische Initialisierung des Layer-Katalogs für map2
- Platzierung neben dem Layer-Control-Button
- Cleanup beim Schließen des Split-Screens

## Installation

### Schritt 1: Scripts einbinden

Fügen Sie folgende Zeile in die HTML-Datei ein (nach `tnet-splitscreen.js`):

```html
<script src="/maps/tnet/js/tnet-layer-catalog.js"></script>
```

**Wo einbinden?**
Die Scripts werden wahrscheinlich in einer der folgenden Dateien geladen:
- `/maps/public/index_de.htm`
- `/maps/public/config/modules.js`
- Eine Template-Datei im `maps/public/` Verzeichnis

### Schritt 2: PHP-Datei bereitstellen

Die Datei `lyrmgr-to-json.php` muss über HTTP erreichbar sein:
```
http://your-server/maps/tnet/lyrmgr-to-json.php
```

Stellen Sie sicher, dass:
- PHP installiert und konfiguriert ist
- Der relative Pfad zu `lyrmgr.conf` korrekt ist
- CORS-Header korrekt gesetzt sind (falls nötig)

### Schritt 3: Testen

1. Öffnen Sie die Anwendung
2. Aktivieren Sie den Split-Screen
3. Klicken Sie auf den neuen "Themenkatalog"-Button (☰ Symbol)
4. Der Katalog sollte erscheinen mit der Layer-Hierarchie

## UI-Layout

```
┌─────────────────────────────────────────┐
│ Karte B (map2)                          │
│                                         │
│  ┌──┐  ← Layer-Auswahl (Checkboxen)    │
│  └──┘     für aktuelle Layer           │
│                                         │
│  ┌──┐  ← Themenkatalog (NEU!)          │
│  └──┘     vollständige Hierarchie      │
│            aus lyrmgr.conf             │
└─────────────────────────────────────────┘
```

## Funktionsweise

1. **Beim Split-Screen Start:**
   - `tnet-splitscreen.js` erstellt map2
   - Initialisiert `TnetLayerCatalog` mit map2

2. **Layer Catalog:**
   - Lädt JSON via Fetch API von `lyrmgr-to-json.php`
   - Rendert hierarchischen Tree
   - Jeder Layer hat eine Checkbox

3. **Layer Toggle:**
   - Wenn Layer bereits auf Karte: Visibility ändern
   - Wenn Layer nicht auf Karte: TODO - dynamisch laden

## TODO / Erweiterungen

### Dynamisches Layer-Laden
Aktuell werden nur Layer getoggled, die bereits auf der Karte sind. Für vollständige Funktionalität:

1. WMS-Konfiguration aus `lyrmgr.conf` extrahieren
2. Layer dynamisch erstellen und zur map2 hinzufügen
3. Layer-Eigenschaften (Opacity, Z-Index, etc.) anwenden

### Beispiel-Code für dynamisches Laden:
```javascript
addLayerToMap: function(layerId, layerConfig) {
    var layer = new ol.layer.Tile({
        source: new ol.source.TileWMS({
            url: layerConfig.url,
            params: {
                'LAYERS': layerConfig.layers,
                'TILED': true
            },
            serverType: 'geoserver'
        }),
        visible: true
    });
    layer.set('name', layerId);
    this.map.addLayer(layer);
}
```

### Such-Funktion
```javascript
// Im Header einen Search-Input hinzufügen
<input type="text" placeholder="Layer suchen..." 
       oninput="LayerCatalog.filterLayers(this.value)">
```

### Layer-Gruppen Actions
- "Alle aktivieren"
- "Alle deaktivieren"
- Opacity-Slider pro Gruppe

## Debugging

### Console-Logs aktivieren
Die Scripts loggen ausführlich in die Browser-Console:
```javascript
[LayerCatalog] Initializing...
[LayerCatalog] Data loaded: {...}
[LayerCatalog] Toggle layer: layer_id true
```

### PHP-Endpoint testen
```bash
curl http://localhost/maps/tnet/lyrmgr-to-json.php
```

Oder im Browser direkt aufrufen und JSON überprüfen.

### Häufige Probleme

**1. "Fehler beim Laden"**
- PHP-Datei nicht erreichbar → Pfad überprüfen
- `lyrmgr.conf` nicht gefunden → relativen Pfad anpassen
- CORS-Fehler → Header in PHP prüfen

**2. "Keine Kategorien gefunden"**
- JSON-Struktur der `lyrmgr.conf` überprüfen
- Browser-Console nach Parse-Errors checken
- PHP error_log überprüfen

**3. Layer werden nicht getoggled**
- Console-Logs prüfen ob Layer gefunden wird
- Map-Instanz korrekt übergeben?
- Layer-Namen stimmen überein?

## Konfiguration

### Layer-Name-Formatierung anpassen
In `lyrmgr-to-json.php`:
```php
function extractLayerName($layerId) {
    // Anpassen nach Bedarf
    $parts = explode('/', $layerId);
    $lastName = end($parts);
    // ... weitere Formatierung
    return $name;
}
```

### Katalog-Position ändern
In `tnet-layer-catalog.js`, `createCatalogUI()`:
```javascript
// Position ändern
btn.style.cssText = 'position: absolute; top: 100px; right: 10px; ...';
```

### Farben/Styling anpassen
Alle Styles sind inline in `tnet-layer-catalog.js`. Suchen Sie nach:
- `background: #2c5f6f` → Header-Farbe
- `background: #f5f5f5` → Kategorie-Hintergrund
- `background: #fafafa` → Gruppen-Hintergrund

## Vergleich: Alter vs. Neuer Ansatz

### Alter Ansatz (Karte A)
- Dojo-basiert
- `njs.AppManager.Modules.main_lyrmgr`
- Komplex, stark gekoppelt
- Schwer zu warten ohne Dojo-Kenntnisse

### Neuer Ansatz (Karte B)
- Vanille JavaScript
- Fetch API, moderne DOM-Methoden
- Entkoppelt, modulär
- Einfach zu erweitern und zu verstehen

## Lizenz & Credits

Entwickelt für die Nidwalden GIS-Anwendung.
Basiert auf OpenLayers und der bestehenden MapPlus-Infrastruktur.
