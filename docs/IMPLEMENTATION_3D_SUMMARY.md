# 3D Landschaftsmodell - Implementierung Zusammenfassung

**Datum**: 10. Februar 2026  
**System**: Split-Screen 3D WebScene Integration  
**Technologie**: ESRI ArcGIS JavaScript API v4.27

## Implementierte Features

### 1. ✅ Neuer Menüpunkt "3D Landschaftsmodell"
- Im Hamburger-Menü (oben rechts) integriert
- SVG-Icon für 3D-Szenen
- Toggle-Funktionalität (Ein/Aus)
- Automatische Deaktivierung bei Aktivierung des 2D Split-Screens

### 2. ✅ 3D Split-Screen Modul (`tnet-3d-landscape.js`)
- Teilt den Map-Container 50/50 zwischen 2D und 3D
- Responsive Trennlinie mit Resizing
- ESRI ArcGIS Integration
- WebScene-Verwaltung über Portal Item IDs
- Integrierte Widgets (Home, Compass, ScaleBar)
- **🔄 Kamera-Synchronisierung**: 2D ↔ 3D gekoppelt (Standpunkt & Zoom)
- **🔘 Sync Toggle Button**: Ein-/Ausschalten der Synchronisierung
- Fehlerbehandlung und Benutzerbenachrichtigungen

### 3. ✅ ESRI ArcGIS JavaScript API
- **Version**: 4.27 (Latest)
- **CDN**: https://js.arcgis.com/4.27/
- **Fallback**: Lokale Installation möglich
- **Features**:
  - WebScene Rendering
  - SceneView (3D-Kamerasteuerung)
  - Navigation Widgets
  - Beleuchtung & Rendering

### 4. ✅ Styling (`tnet-3d-landscape.css`)
- Modern, responsives Design
- Split-Panel-Styling
- Divider mit Hover-Effekten
- ESRI Widget-Integration
- Dark Theme für 3D-Panel
- Mobile-responsive

### 5. ✅ Konfigurationsystem (`tnet-3d-landscape-config.js`)
- Zentrale WebScene-ID Verwaltung
- Multiple Szenen verfügbar
- SceneView-Optionen (Quality, Lightning, etc.)
- Layout-Einstellungen
- Helper-Funktionen

### 6. ✅ Dokumentation
- 3D_LANDSCAPE_README.md (Detaillierte Anleitung)
- Konfigurationsoptionen
- Browser-Kompatibilität
- Performance-Tipps
- Troubleshooting

## Dateien erstellt/modifiziert

### Neue Dateien
```
✓ /maps/tnet/js/tnet-3d-landscape.js
✓ /maps/tnet/js/tnet-3d-landscape-config.js
✓ /maps/tnet/css/tnet-3d-landscape.css
✓ /maps/tnet/3D_LANDSCAPE_README.md
```

### Modifizierte Dateien
```
✓ /maps/public/index_de.htm
  - Menüpunkt "3D Landschaftsmodell" hinzugefügt
  - ESRI API CSS/JS eingebunden
  - Config und Modul-Scripts geladen
```

## Wie man es benutzt

### 1. WebScene ID konfigurieren
Datei: `/maps/tnet/js/tnet-3d-landscape-config.js`

Die WebScene ID ist bereits konfiguriert:
```javascript
defaultWebSceneId: "ba869d85b15c47719721cf6676ab99c7" // Digitaler Zwilling Nidwalden/Obwalden
```

### 2. 3D-Ansicht aktivieren
1. Klick auf das **Hamburger-Menü** (oben rechts)
2. Klick auf **3D Landschaftsmodell**
3. Split-Screen mit 2D (links) und 3D (rechts) wird angezeigt

### 3. Interaktion
- **2D-Karte**: Vollständige OpenLayers Funktionalität
- **3D-Szene**: ESRI Navigation (Rotation, Zoom, Tilt)
- **Divider**: Mit Maus verschiebbar zum Resizen
- **Widgets**: Home, Compass, ScaleBar in der 3D-Ansicht
- **Kamera-Sync**: Automatische Kopplung von Standpunkt und Zoom
  - Zoom in 2D → 3D folgt automatisch
  - Pan in 2D → 3D zentriert sich auf gleicher Position
  - 3D-Navigation → 2D-Karte bewegt sich mit
  - **Toggle-Button** (oben rechts in 3D) zum Ein-/Ausschalten

## Weitere Konfiguration

### Mehrere WebScenes
In `tnet-3d-landscape-config.js` können mehrere Szenen konfiguriert werden:

```javascript
availableScenes: [
    { name: "Digitaler Zwilling Nidwalden/Obwalden", id: "ba869d85b15c47719721cf6676ab99c7" }
]
```

### Grafik-Qualität anpassen
```javascript
qualityProfile: 'low'     // Schneller
qualityProfile: 'medium'  // Standard
qualityProfile: 'high'    // Hochwertig (Standard)
```

### Beleuchtung konfigurieren
```javascript
environment: {
    lighting: {
        type: 'virtual',              // 'virtual', 'sun', 'none'
        directShadowsEnabled: true,
        ambientOcclusionEnabled: true
    }
}
```

### Kamera-Synchronisierung anpassen
```javascript
synchronization: {
    enabledByDefault: true,       // Sync beim Start aktiviert
    syncDelay: 100,               // Verzögerung in ms
    zoomScaleFactor: 40000000     // Zoom-Umrechnung (größer = weiter weg)
}
```

**Sync deaktivieren/aktivieren**:
```javascript
// Per Button in UI (oben rechts in 3D-Ansicht)
// Oder programmatisch:
window.TnetLandscape3D.toggleSync();
```

## ESRI Portal Item ID finden

1. Melden Sie sich bei [ArcGIS Online](https://www.arcgis.com) an
2. Suchen/erstellen Sie eine 3D WebScene
3. Öffnen Sie die WebScene
4. Die Portal Item ID ist in der URL:
   ```
   https://www.arcgis.com/apps/webscene/index.html?id=HIER_IST_DIE_ID
   ```

## Bro

**Aktuelle WebScene**: Digitaler Zwilling Nidwalden/Obwalden  
**Portal Item ID**: `ba869d85b15c47719721cf6676ab99c7`wser-Unterstützung
- ✓ Chrome/Chromium (empfohlen)
- ✓ Firefox
- ✓ Safari
- ✓ Edge
- ✗ Internet Explorer 11

## API-Nutzung (JavaScript)

```javascript
// 3D-Ansicht mit Standard-WebScene öffnen (Digitaler Zwilling Nidwalden/Obwalden)
toggleLandscape3D();

// Mit spezifischer WebScene
toggleLandscape3D("ba869d85b15c47719721cf6676ab99c7");

// WebScene später wechseln
window.TnetLandscape3D.setWebScene("ba869d85b15c47719721cf6676ab99c7");

// Aus einer Liste wählen (Config)
setWebSceneFromConfig("Digitaler Zwilling Nidwalden/Obwalden");

// Verfügbare Szenen auflisten
listAvailableScenes();

// Sync ein-/ausschalten
window.TnetLandscape3D.toggleSync();
```

## Wichtige Hinweise

1. **ESRI Portal-Abhängigkeit**: WebScenes müssen auf ArcGIS Online veröffentlicht sein
2. **Netzwerk**: Benötigt Internetzugang zum Laden von WebScenes und ESRI API
3. **Kamera-Sync**: Standardmäßig aktiviert - kann über Toggle-Button deaktiviert werden
4. **Layer-Sync**: Derzeit nicht implementiert - 2D und 3D Layer arbeiten unabhängig
5. **Performance**: Bei älteren Rechnern die Grafik-Qualität reduzieren oder Sync deaktivieren
6. **CORS**: ESRI Domains müssen über CORS erreichbar sein

## Nächste Schritte

1. [✅] WebScene ID mit aktueller Landschaftsdatei konfiguriert (Digitaler Zwilling Nidwalden/Obwalden)
2. [✅] Kamera-Synchronisierung zwischen 2D/3D implementiert
3. [ ] Mit verschiedenen Geräten/Browsern testen
4. [ ] Performance-Optimierung bei Bedarf
5. [ ] Optional: Layer-Synchronisierung hinzufügen
6. [ ] Optional: Custom 3D-Layer hinzufügen

## Troubleshooting

**Problem**: "ESRI Bibliothek konnte nicht geladen werden"
- **Lösung**: Netzwerk-Verbindung prüfen, ESRI CDN muss erreichbar sein

**Problem**: "3D-Szene konnte nicht geladen werden"
- **Lösung**: WebScene ID überprüfen, Portal Item muss öffentlich sein

**Problem**: Szene lädt sehr langsam
- **Lösung**: qualityProfile auf 'medium' oder 'low' stellen

**Problem**: Rendering-Fehler oder Artefakte
- **Lösung**: Browser-Cache leeren, Grafiktreiber aktualisieren

## Kontakt
Bei Fragen oder Problemen kontaktieren Sie bitte das Entwickler-Team.
