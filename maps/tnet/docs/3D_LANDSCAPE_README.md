# 3D Landschaftsmodell - Implementierungsanleitung

## Überblick
Das System integriert ESRI ArcGIS 3D WebScenes in einen Split-Screen-Modus neben der existierenden 2D-Karte. Dies ermöglicht den gleichzeitigen Vergleich von 2D und 3D-Daten.

## Features
- **Split-Screen View**: 50/50 Split zwischen 2D (OpenLayers) und 3D (ESRI)
- **Resizable Divider**: Flexible Größenverstellung zwischen den Ansichten
- **Camera Synchronization**: Automatische Kopplung von Standpunkt und Zoom zwischen 2D und 3D
- **ESRI Widgets**: Home, Compass, ScaleBar in der 3D-Ansicht integriert
- **Sync Toggle**: Button zum Ein-/Ausschalten der Kamera-Synchronisierung
- **Responsive Design**: Passt sich verschiedenen Bildschirmgrößen an
- **Fehlerbehandlung**: Benutzerfreundliche Fehlermeldungen bei Ladefehler

## Aktivierung
Der 3D-Modus wird aktiviert durch:
1. **Menü** (oben rechts) → **3D Landschaftsmodell**
2. Oder programmativ: `toggleLandscape3D(webSceneId)`

## Konfiguration

### WebScene ID setzen
Die WebScene ID wird von der ESRI Portal Item übernommen. Sie können diese auf unterschiedliche Weise setzen:

#### 1. Standardwert ändern
In `tnet-3d-landscape-config.js`, ändern der `defaultWebSceneId`:

```javascript
defaultWebSceneId: "ba869d85b15c47719721cf6676ab99c7" // Digitaler Zwilling Nidwalden/Obwalden
```

#### 2. Programmativ beim Öffnen
```javascript
toggleLandscape3D("ba869d85b15c47719721cf6676ab99c7");
```

#### 3. WebScene später wechseln
```javascript
window.TnetLandscape3D.setWebScene("ba869d85b15c47719721cf6676ab99c7");
```

### ESRI Portal Items (WebScenes) finden
1. Melden Sie sich bei ArcGIS Online an
2. Erstellen oder finden Sie eine 3D WebScene
3. Öffnen Sie die WebScene und kopieren Sie die ID aus der URL:
   - URL: `https://www.arcgis.com/apps/webscene/index.html?id=3d1f9eb7e01b4b2bb4b7e01b4b2bb4b7`
   - WebScene ID: `3d1f9eb7e01b4b2bb4b7e01b4b2bb4b7`

## Technische Details

### Dateistruktur
```
maps/tnet/
├── js/
│   └── tnet-3d-landscape.js          # Main 3D module
├── css/
│   └── tnet-3d-landscape.css         # Styles for 3D split screen
└── public/
    └── index_de.htm                   # Includes ESRI API + module
```

### ESRI API Integration
- **Version**: 4.27 (latest)
- **CDN**: https://js.arcgis.com/4.27/
- **Fallback**: Lokale Installation unter `/mapplus-lib/arcgis-js-api/`

### Module
- **WebScene**: Verwaltet 3D-Inhalte vom ESRI Portal
- **SceneView**: Rendert die 3D-Szene in einem HTML-Container
- **Home Widget**: Zoomschaltfläche zum Zurücksetzen auf die Standard-Kameraposition
- **Compass Widget**: Orientierungskompass
- **ScaleBar Widget**: Maßstabsanzeige in Metern

## Kamera-Synchronisierung

### Funktionsweise
Die 2D-Karte (OpenLayers) und die 3D-Szene (ESRI) sind standardmäßig gekoppelt:
- **2D → 3D**: Zoom oder Pan in der 2D-Karte bewegt die 3D-Kamera zum gleichen Standpunkt
- **3D → 2D**: Navigation in der 3D-Szene aktualisiert die 2D-Kartenansicht

### Sync-Button
- **Position**: Oben rechts in der 3D-Ansicht
- **Symbol**: Kreisförmige Pfeile (Sync-Icon)
- **Aktiv** (blau): Synchronisierung ist eingeschaltet
- **Inaktiv** (grau): Synchronisierung ist ausgeschaltet

### Konfiguration
In `tnet-3d-landscape-config.js`:
```javascript
synchronization: {
    enabledByDefault: true,       // Sync standardmäßig aktiv
    syncDelay: 100,               // Verzögerung zwischen Updates (ms)
    zoomScaleFactor: 40000000     // Faktor für Zoom-Umrechnung
}
```

**Zoom-Anpassung**: Bei Bedarf den `zoomScaleFactor` anpassen:
- **Größerer Wert** → 3D-Kamera ist weiter entfernt
- **Kleinerer Wert** → 3D-Kamera ist näher

### Technische Details
- **Koordinaten-Transformation**: Automatische Konvertierung zwischen Map-Projektion und WGS84
- **Deadlock-Prevention**: Sync-Lock verhindert Endlos-Schleifen
- **Performance**: Konfigurierbare Verzögerung für flüssige Navigation

## Browser-Kompatibilität
- Chrome/Chromium: ✓ (empfohlen)
- Firefox: ✓
- Safari: ✓ (mit Einschränkungen)
- Edge: ✓
- IE11: ✗ (nicht unterstützt)

## Performance-Tipps
1. **SceneView Container**: Achten Sie darauf, dass der Container sichtbar ist, bevor die View initialisiert wird
2. **Netzwerk**: WebScenes von ArcGIS Online laden schneller wenn sich der Nutzer in einem stabilen Netzwerk befindet
3. **Grafik**: Die qualityProfile "high" kann auf älteren Rechnern langsam sein - auf "medium" oder "low" umschalten:
   ```javascript
   qualityProfile: 'medium' // 'low', 'medium', 'high'
   ```

## Fehlerbehandlung
Das System zeigt automatisch Fehlermeldungen für:
- Ungültige WebScene IDs
- Netzwerkfehler beim Laden der ESRI Bibliothek
- Fehlerhafte Portal-Items

Fehler werden mit Timeout nach 5 Sekunden entfernt.

## Anpassungen

### Styling
Alle Styles sind in `tnet-3d-landscape.css` definiert. Wichtige Klassen:
- `#split-wrapper-3d`: Hauptcontainer
- `#split-panel-2d`: 2D-Karten-Panel
- `#split-panel-3d`: 3D-Szenen-Panel
- `#split-divider-3d`: Trennlinie

### Quality Profile
Ändern Sie `qualityProfile` für unterschiedliche Grafik-Qualität:
```javascript
qualityProfile: 'high'    // Hochwertig, höherer Speicherverbrauch
qualityProfile: 'medium'  // Ausgeglichen (Standard)
qualityProfile: 'low'     // Schnell, weniger Details
```

### Beleuchtung
Passen Sie die Szenenbeleuchtung an:
```javascript
environment: {
    lighting: {
        type: 'virtual',        // oder 'sun', 'none'
        directShadowsEnabled: true
    }
}
```

## Integration mit bestehendem Code

### Konflikt mit Split-Screen
Die 3D-Ansicht und der 2D Split-Screen können nicht gleichzeitig aktiviert sein. Das System deaktiviert automatisch eine Ansicht, wenn die andere aktiviert wird.

### Layer-Synchronisierung
Derzeit werden Layer nicht automatisch zwischen 2D und 3D synchronisiert. Sie können jedoch:
1. In 2D Layer einstellen
2. 3D-Ansicht öffnen (diese zeigt die konfigurierte WebScene)
3. Beide Ansichten unabhängig verwenden

## Bekannte Limitationen
1. **Keine Layer-Synchronisierung**: 2D und 3D-Layer werden getrennt verwaltet
2. **Keine Kamera-Synchronisierung**: Zoom/Pan zwischen 2D und 3D erfolgt nicht automatisch
3. **ESRI Portal-Abhängigkeit**: WebScenes müssen auf ArcGIS Online veröffentlicht sein
4. **Offline-Modus**: Benötigt externe JavaScript-Bibliothek

## Zukünftige Verbesserungen
- [✅] Kamera-Koppelung zwischen 2D und 3D (implementiert)
- [ ] Layer-Synchronisierung
- [ ] Custom 3D-Layer aus lokalen Quellen
- [ ] Offline-WebScene-Unterstützung
- [ ] Screenshot/Export-Funktionalität
- [ ] Annotation-Tools für 3D-Szenen

## Troubleshooting

### Allgemeine Probleme
**Problem**: "ESRI Bibliothek konnte nicht geladen werden"
- **Lösung**: Netzwerk-Verbindung prüfen, ESRI CDN muss erreichbar sein

**Problem**: "3D-Szene konnte nicht geladen werden"
- **Lösung**: WebScene ID überprüfen, Portal Item muss öffentlich zugänglich sein

**Problem**: Szene lädt sehr langsam
- **Lösung**: qualityProfile auf 'medium' oder 'low' stellen

**Problem**: Rendering-Fehler oder Artefakte
- **Lösung**: Browser-Cache leeren, Grafiktreiber aktualisieren

### Synchronisierungs-Probleme
**Problem**: 2D und 3D bewegen sich nicht synchron
- **Lösung**: 
  1. Sync-Button (oben rechts in 3D) überprüfen - muss blau sein
  2. Browser-Konsole auf Fehler prüfen
  3. `window.TnetLandscape3D.syncEnabled` sollte `true` sein

**Problem**: Zoom-Level stimmt nicht überein
- **Lösung**: `zoomScaleFactor` in Config anpassen (größer = weiter entfernt)

**Problem**: Ruckelnde Navigation bei aktivierter Sync
- **Lösung**: 
  1. `syncDelay` in Config erhöhen (z.B. auf 200ms)
  2. Sync temporär deaktivieren für schnelle Navigation
  3. Quality Profile reduzieren

## Kontakt & Support
Bei Fragen oder Problemen kontaktieren Sie den TNET-Entwickler oder das GIS-Team.
