# Dynamische Layout-Elemente für WebGIS-PDF-Export

## Übersicht

Das QGIS-Plugin **Layout Template Exporter** exportiert jetzt Layout-Vorlagen mit **klaren IDs** für dynamische Elemente. Diese Elemente werden beim PDF-Export im WebGIS automatisch mit aktuellen Werten befüllt.

## Unterstützte dynamische Elemente

### 1. **TITLE_TEXT** — Kartentitel
- **Typ**: `QgsLayoutItemLabel`
- **Position**: Titelblock oben
- **WebGIS**: Ersetzt durch den Wert aus dem `kartentitel`-Feld im Print-Dialog
- **Beispiel**: `"Übersichtsplan Bauprojekt XY"`

### 2. **SCALE_TEXT** — Massstab
- **Typ**: `QgsLayoutItemLabel`
- **Position**: Footer links
- **WebGIS**: Ersetzt durch den aktuellen Kartenmassstab
- **Beispiel**: `"Massstab 1:10'000"`

### 3. **COORDINATES_TEXT** — Koordinaten
- **Typ**: `QgsLayoutItemLabel`
- **Position**: Footer Mitte
- **WebGIS**: Ersetzt durch die LV95-Koordinaten des Kartenzentrums
- **Beispiel**: `"LV95: 2'600'000 / 1'200'000"`

### 4. **DATE_TEXT** — Erstellungsdatum
- **Typ**: `QgsLayoutItemLabel`
- **Position**: Footer rechts
- **WebGIS**: Ersetzt durch das aktuelle Datum
- **Beispiel**: `"Erstellt am: 12.02.2026"`

### 5. **NORTH_ARROW** — Nordpfeil
- **Typ**: `QgsLayoutItemLabel` (Platzhalter "N ↑")
- **Position**: Rechte Sidebar, unter der Legende
- **WebGIS**: Wird entsprechend der Kartenrotation gedreht
- **Beispiel**: Bei 45° Kartenrotation wird der Nordpfeil um -45° rotiert

### 6. **FOOTER_BOX** — Footer-Hintergrund
- **Typ**: `QgsLayoutItemShape` (Rectangle)
- **Position**: Unterer Rand
- **WebGIS**: Statisch, enthält die drei Footer-Texte

### 7. **MAP_AREA** — Kartenbereich
- **Typ**: `QgsLayoutItemShape` (Rectangle, gestrichelt)
- **Position**: Zentral
- **WebGIS**: Wird entfernt, die Karte wird an dieser Position eingefügt

---

## Workflow: QGIS → WebGIS

### 1. **QGIS-Plugin: Export**
```python
# Plugin exportiert Layout mit IDs:
label_title = QgsLayoutItemLabel(layout)
label_title.setId("TITLE_TEXT")
label_title.setText("[Kartentitel wird aus WebGIS gesetzt]")
```

### 2. **SVG-Export**
QGIS exportiert das Layout als SVG, wobei die IDs erhalten bleiben:
```xml
<text id="TITLE_TEXT">
  <tspan>[Kartentitel wird aus WebGIS gesetzt]</tspan>
</text>
```

### 3. **WebGIS: SVG-Manipulation**
Die WebApp (`template-pdf-export.js`) findet die Elemente per ID und ersetzt die Inhalte:
```javascript
replaceDynamicElements(svgText, {
  title: "Übersichtsplan Bauprojekt XY",
  scaleText: "1:10'000",
  coords: "2'600'000 / 1'200'000",
  date: "12.02.2026",
  rotation: 45  // → Nordpfeil wird rotiert
});
```

### 4. **PDF-Generierung**
Das manipulierte SVG wird als Hintergrund ins PDF gezeichnet, die Karte wird in den `MAP_AREA`-Bereich eingefügt.

---

## Verwendung im QGIS-Plugin

### Neue Templates exportieren
1. Plugin öffnen: **Web → Layout Template Exporter**
2. Option aktivieren: **"Zusätzlich neue leere Templates erzeugen"**
3. Gewünschte Formate auswählen (A4 Hoch, A3 Quer, etc.)
4. Zielordner: `<Webserver>/maps/tnet/ol-pdf-printer`
5. **Exportieren** klicken

### Bestehende Layouts exportieren
1. Layout im QGIS-Projekt erstellen (mit oder ohne Titel/Footer-Texte)
2. Plugin öffnen
3. Layout in der Liste anhaken
4. Exportieren → Das Plugin erkennt automatisch den Kartenbereich über das größte `QgsLayoutItemMap`

**Hinweis**: Bestehende Layouts sollten ein `QgsLayoutItemMap` enthalten, damit der Kartenbereich korrekt erkannt wird. Falls nicht, wird ein Fallback verwendet (Shape mit ID="MAP_AREA").

---

## WebGIS-Integration

Die dynamischen Elemente werden automatisch beim PDF-Export befüllt. Keine manuelle Anpassung nötig.

**Aufruf im WebGIS:**
```javascript
templatePdfPrint({
  massstab:        10000,
  layout:          'A4 Hoch',
  aufloesung:      150,
  rotation:        0,
  kartentitel:     'Übersichtsplan Bauprojekt XY',
  koordinatennetz: false,
  netzfarbe:       'schwarz'
});
```

**Automatische Werte:**
- `kartentitel` → **TITLE_TEXT**
- Aktueller Kartenmassstab → **SCALE_TEXT**
- LV95-Koordinaten des Zentrums → **COORDINATES_TEXT**
- Aktuelles Datum → **DATE_TEXT**
- Kartenrotation → **NORTH_ARROW** (rotiert)

---

## Technische Details

### SVG-Text-Ersetzung
```javascript
function replaceTextInElement(doc, elementId, newText) {
  var el = doc.getElementById(elementId);
  var tspans = el.getElementsByTagName('tspan');
  if (tspans.length > 0) {
    tspans[0].textContent = newText;  // QGIS exportiert Labels als <tspan>
  } else {
    el.textContent = newText;
  }
}
```

### Nordpfeil-Rotation
```javascript
function rotateNorthArrow(doc, elementId, degrees) {
  var el = doc.getElementById(elementId);
  var bbox = el.getBBox();
  var cx = bbox.x + bbox.width / 2;
  var cy = bbox.y + bbox.height / 2;
  var arrowRotation = -degrees;  // Gegenrichtung zur Kartenrotation
  el.setAttribute('transform', 'rotate(' + arrowRotation + ' ' + cx + ' ' + cy + ')');
}
```

---

## Migration von alten Templates

**Alte Templates** (ohne IDs):
- Verwenden Text-Platzhalter wie `[ TITLE BLOCK ]`, `[ SCALE BAR ]`
- Werden weiterhin unterstützt (Legacy-Modus via `replacePlaceholders()`)

**Neue Templates** (mit IDs):
- Exportiert vom aktualisierten Plugin
- Verwenden klare Element-IDs statt Text-Platzhalter
- Bessere Positionierung und Formatierung

**Empfehlung**: Alte Templates neu exportieren mit dem aktualisierten Plugin.

---

## Fehlerbehebung

### "Element nicht gefunden: TITLE_TEXT"
**Ursache**: Template wurde mit alter Plugin-Version exportiert  
**Lösung**: Template neu exportieren mit dem aktualisierten Plugin

### Nordpfeil rotiert nicht
**Ursache**: Element-ID fehlt oder ist falsch  
**Lösung**: SVG-Datei prüfen: `<text id="NORTH_ARROW">` muss vorhanden sein

### Texte werden nicht ersetzt
**Ursache**: SVG enthält keine `<text>` oder `<tspan>`-Elemente mit den IDs  
**Lösung**: QGIS-Export prüfen, ggf. Plugin-Code anpassen (debugging)

---

## Erweiterungen (Zukunft)

- **Massstabsbalken**: Dynamisch generiert (noch nicht implementiert)
- **Legende**: Dynamisch aus WebGIS-Layern generiert
- **Logo**: Aus WebGIS-Config laden
- **QR-Code**: Mit Link zum WebGIS-Projekt

