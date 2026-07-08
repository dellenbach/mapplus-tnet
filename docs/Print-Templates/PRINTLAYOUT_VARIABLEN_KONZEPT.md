# Printlayout-Variablen: Konzept und Doku

## Ziel

Diese Doku definiert eine saubere, robuste und zukunftssichere Print-Architektur fuer QGIS-basierte Layout-Templates im TNET-Stack.

Der Kern ist die klare Trennung von:

- Text-Variablen (inhaltliche Werte)
- Geometrie-Elementen (Position/Groesse/Rotation aus Manifest)

So vermeiden wir fragile SVG-String-Hacks fuer Grafikobjekte und halten die Layout-Geometrie reproduzierbar ueber alle Formate.

## Scope

Betroffene Komponenten:

- `maps-dev/tnet/ol-pdf-printer/js/template-pdf-export.js`
- `maps-dev/tnet/js/tnet-print.js`
- `maps-dev/tnet/ol-pdf-printer/qgis-templates/*.svg`
- `maps-dev/tnet/ol-pdf-printer/qgis-templates/*.manifest.json`

## Architekturprinzipien

1. Text ist Text
- Textinhalte werden ueber Platzhalter oder Text-IDs ersetzt.

2. Geometrie ist Geometrie
- Kartenfenster, Nordpfeil, Massstabsbalken und Massstabstext werden ueber Manifest-Elemente mit mm-Koordinaten gesteuert.

3. SVG bleibt Vorlage, Manifest ist Wahrheit
- SVG ist visuelle Basis.
- Exakte Positionen und dynamische Zeichnung kommen aus dem Manifest.

4. Mehrstufiger Fallback bleibt erhalten
- Muss stabil laufen fuer neue und alte Templates.

## Variablenmodell

### A) Text-Variablen (inhaltlich)

Diese Werte werden zur Laufzeit aus UI/Map abgeleitet:

- `title`
- `scaleText`
- `coords`
- `date`
- `time`
- `user`

Verbindliche Platzhalter im SVG (Neustandard):

- `{{TITLE}}`
- `{{SCALETEXT}}`
- `{{COORDINATES}}`
- `{{DATE}}`
- `{{TIME}}`
- `{{USER}}`

Alias-Platzhalter (nur Legacy-Fallback, gleicher Inhalt wie `{{SCALETEXT}}`):

- `{{SCALE}}`
- `{{SCALEDOT}}`

Definition Scale-Platzhalter:

- `{{SCALETEXT}}`: kanonischer Platzhalter fuer den formatierten Massstabstext (z. B. `1:10'000`).
- `{{SCALE}}`: Legacy-Alias, wird intern gleich wie `{{SCALETEXT}}` ersetzt.
- `{{SCALEDOT}}`: Legacy-Alias, wird intern gleich wie `{{SCALETEXT}}` ersetzt.

Ergaenzender ID-Fallback (bestehend):

- `TITLE_TEXT`
- `SCALE_TEXT`
- `SCALETEXT_TEXT`
- `COORDINATES_TEXT`
- `DATE_TEXT`
- `TIME_TEXT`
- `USER_TEXT`

### B) Geometrie-Variablen (layoutrelevant)

Diese werden nicht als Mustache-Text behandelt, sondern als Manifest-Elementtypen:

- `map`
- `northArrow`
- `scaleBar`
- `scaleLabel`

Diese vier sind die entscheidenden Layout-Variablen fuer die Print-Geometrie.

## Pflicht vs. Optional (verbindliche Regel)

Technisch ist **nur `map` Pflicht**. Ohne `map` gibt es keinen Kartenrahmen und
kein Kartenbild → der Export ist sinnlos.

Alle uebrigen Elemente sind **optional** (empfohlen fuer Qualitaet). Die Runtime
ueberspringt fehlende Elemente sauber ohne Fehler:

- Geometrie `northArrow`, `scaleBar`, `scaleLabel`: werden nur gezeichnet, wenn im
  Manifest vorhanden. `scaleLabel` kann sogar automatisch aus der `scaleBar`-Position
  abgeleitet werden.
- Alle Text-Felder (`title`, `date`, `time`, `user`, `coords`): fehlender Wert wird
  durch leeren String ersetzt; fehlender Platzhalter bleibt wirkungslos.

| Element | Status | Verhalten bei Abwesenheit |
|---|---|---|
| `map` | **Pflicht** | Export nicht sinnvoll moeglich |
| `northArrow`, `scaleBar`, `scaleLabel` | empfohlen | wird nicht gezeichnet, kein Fehler |
| alle Text-Felder | optional | leerer Text, kein Fehler |

## Verbindliche QGIS-Konventionen

## QGIS: Genaue Schritt-fuer-Schritt-Anweisung

Diese Anleitung ist der verbindliche Ablauf fuer neue Print-Layouts.

### 1) Layout anlegen

- QGIS Layout-Manager oeffnen und neues Layout erstellen.
- Papierformat pro Zielvariante setzen (z. B. A4 hoch, A4 quer, A3 hoch, A3 quer).
- Einheiten im Layout auf mm belassen.
- Pro Format/Ausrichtung ein eigenes Layout fuehren (keine automatische Streckung).

### 2) Kartenfenster setzen (Pflicht)

- Elementtyp: Karte.
- Element-ID: `MAP_AREA`.
- Position/Groesse exakt setzen (x, y, Breite, Hoehe in mm).

### 3) Nordpfeil setzen (empfohlen)

- Elementtyp: Bild (Nordpfeil-SVG/PNG).
- Element-ID: `NORTH_ARROW`.
- Position/Groesse in mm fix setzen.
- Keine manuellen Rotations-Workarounds im Template hinterlegen, die Runtime uebernimmt die Kartenrotation.
- Optional: fehlt der Nordpfeil im Manifest, wird er nicht gezeichnet (kein Fehler).

### 4) Massstabsbalken setzen (empfohlen)

- Elementtyp: Massstabsbalken.
- Element-ID: `SCALE_BAR`.
- Position/Groesse in mm fix setzen.
- Balkenstil schlicht halten (keine layoutkritischen Spezialeffekte).
- Optional: fehlt der Balken im Manifest, wird er nicht gezeichnet (kein Fehler).

### 5) Massstabstext setzen (empfohlen)

- Elementtyp: Text-Label.
- Element-ID: `SCALE_LABEL`.
- Textinhalt: `{{SCALETEXT}}`.
- Position/Groesse in mm fix setzen.
- Optional: fehlt das Label, kann die Runtime die Position aus dem `scaleBar` ableiten.

### 6) Textfelder setzen (alle optional)

Alle Text-Platzhalter sind technisch optional (fehlender Wert wird zu leerem Text,
kein Export-Fehler). Fuer einen vollwertigen Ausdruck empfohlen:

- Titel-Text mit `{{TITLE}}` 
- Datums-Text mit `{{DATE}}` 
- Zeit-Text mit `{{TIME}}` 
- Benutzer mit `{{USER}}` 
- Koordinaten mit `{{COORDINATES}}` 
- Fuer Massstabstext nur `{{SCALETEXT}}` in neuen Templates verwenden.

### 7) Export-Qualitaet und Textausgabe

- Sicherstellen, dass Text als echter Text exportiert wird (keine Pfad-Konvertierung), damit Platzhalter ersetzbar bleiben.
- Vorlagen nach Export pruefen: Platzhalter muessen im SVG-Quelltext sichtbar sein.

### 8) Check vor Freigabe

- Pflicht: `MAP_AREA` (Typ `map`) vorhanden und korrekt positioniert.
- Empfohlen vorhanden: `NORTH_ARROW`, `SCALE_BAR`, `SCALE_LABEL`.
- Empfohlene Platzhalter: `{{TITLE}}`, `{{SCALETEXT}}`, `{{DATE}}`, `{{TIME}}`.
- Elemente plausibel positioniert (mm) und nicht ueberlappend.
- Test in Print-Panel: Vorschau, Rotation, PDF-Export.

### 9) Mini-Beispiel fuer Textfelder in QGIS

- Titel: `{{TITLE}}`
- Massstab: `{{SCALETEXT}}`
- Datum/Zeit: `Erstellt am: {{DATE}} {{TIME}}`
- Benutzer: `{{USER}}`
- Koordinaten: `LV95: {{COORDINATES}}`

### 11 IDs fuer Schluesselobjekte

Im QGIS-Layout muessen eindeutige IDs gesetzt sein:

- `MAP_AREA` fuer Kartenfenster
- `NORTH_ARROW` fuer Nordpfeil

Bei Massstabselementen sind IDs verbindlich:

- `SCALE_BAR`
- `SCALE_LABEL`

Hinweis: Fuer die Runtime ist primaer der Manifest-Typ relevant (`scaleBar`, `scaleLabel`). Die verbindlichen IDs sind trotzdem Pflicht fuer konsistente Exporte, Debugging und Template-Review.

### 2) Einheiten und Koordinaten

- Position und Groesse immer in mm definieren.
- Keine implizite prozentuale Streckung zwischen Formaten.
- Jedes Format/Ausrichtung (A4 hoch, A4 quer, A3 hoch, A3 quer) bekommt eigene Geometriewerte.

### 3) Textfelder

- Titel/Datum/Benutzer/Koordinaten/Scale als Textobjekte sauber platzieren.
- Wo moeglich `{{...}}` direkt im Template-Text verwenden.
- Fuer maximale Kompatibilitaet optional zusaetzlich IDs (`*_TEXT`) setzen.

## Laufzeitverhalten (Soll)

1. Layout auswaehlen
- Manifest + SVG des Layouts laden.

2. Text-Ersetzung
- Strategie 1: `{{PLACEHOLDER}}`
- Strategie 2: IDs wie `TITLE_TEXT`
- Strategie 3: Legacy-Patterns

3. Dynamische Geometrie zeichnen
- `map`: Druckframe und Karte
- `northArrow`: Rotation gemaess Kartenrotation
- `scaleBar`: Segmentierung passend zu Massstab
- `scaleLabel`: formatierter Massstabstext

4. Export
- PDF/SVG/JPEG gemaess bestehender Exportpipeline.

## Warum diese Trennung wichtig ist

- Robustheit: Grafikobjekte sind nicht von Text-Replacements abhaengig.
- Praezision: mm-basierte Layout-Geometrie bleibt stabil ueber Zoom/DPI.
- Wartbarkeit: Neue Layouts brauchen keine JS-Sonderfaelle pro Template.
- Rueckwaertskompatibilitaet: Bestehende Legacy-Templates laufen weiter.

## Minimaler Standard pro neuem Template

Pflicht:

- Manifest mit `map` (das einzige zwingende Element).
- `mapFrame` korrekt gesetzt.

Empfohlen:

- Geometrie `northArrow`, `scaleBar`, `scaleLabel` als Manifest-Elemente.
- Text-Platzhalter `{{TITLE}}`, `{{DATE}}`, `{{TIME}}`.
- `{{SCALETEXT}}` fuer direkte SVG-Vorschau.
- Text-ID-Fallbacks (`*_TEXT`) fuer robuste Migration.

## Migrationsplan fuer bestehende Templates

Phase 1 (Inventar)

- Alle Templates nach vorhandenem Variablenmix klassifizieren:
  - Mustache vorhanden
  - ID-Fallback vorhanden
  - Nur Legacy
  - Geometrieelemente unvollstaendig

Phase 2 (Normalisierung)

- Fehlende Manifest-Typen (`map`, `northArrow`, `scaleBar`, `scaleLabel`) ergaenzen.
- MAP/NorthArrow IDs vereinheitlichen.
- Textplatzhalter auf Soll-Set erweitern.

Phase 3 (Qualitaetssicherung)

- Visueller Vergleich je Layout/Ausrichtung.
- Rotations-Check fuer Nordpfeil.
- Scale-Check fuer Label/Balken.
- Export-Check fuer PDF und SVG.

Phase 4 (Legacy-Risiko senken)

- Legacy-Platzhalter nur noch als Fallback behalten.
- Neue Templates nur noch nach diesem Standard erstellen.

## Akzeptanzkriterien

Ein Template gilt als konform, wenn:

- Das Pflicht-Element `map` im Manifest vorhanden und plausibel ist.
- Vorhandene Geometrieelemente (`northArrow`, `scaleBar`, `scaleLabel`) plausibel sind.
- Vorhandene Textfelder (Titel/Datum/Zeit/Scale) im Export korrekt gefuellt sind.
- Nordpfeil — falls vorhanden — bei Kartenrotation korrekt ausgerichtet ist.
- Keine Layoutverschiebungen durch Aufloesung oder Formatwechsel auftreten.

## Risiken und Guardrails

Risiken:

- QGIS-Export aendert interne SVG-Struktur.
- Inkonsistente IDs zwischen Templates.
- Fehlende Manifest-Elemente in Alt-Layouts.

Guardrails:

- Konventionen fuer IDs und Variablen verbindlich machen.
- Template-Review-Checkliste vor Deployment.
- Legacy nur als Rueckfallpfad, nicht als Zielstandard.

## Checkliste fuer Template-Autoren

Vor Export:

- Pflicht: `MAP_AREA` (Typ `map`) gesetzt und in mm positioniert
- Empfohlen: `NORTH_ARROW`, `SCALE_BAR`, `SCALE_LABEL` gesetzt
- Empfohlene Text-Platzhalter (`{{TITLE}}`, `{{SCALETEXT}}`, `{{DATE}}`, `{{TIME}}`; optional `{{COORDINATES}}`, `{{USER}}`)
- Elemente sauber in mm positioniert

Nach Export:

- Manifest pruefen: `map` (Pflicht); `northArrow`, `scaleBar`, `scaleLabel` (falls verwendet)
- SVG pruefen: Platzhalter sichtbar im Quelltext
- Schnelltest in Print-Panel (Vorschau + Export)

## Referenz: Ist-Implementierung

- Mustache- und ID-Replacement: `maps-dev/tnet/ol-pdf-printer/js/template-pdf-export.js`
- Vorschau-Replacement im Panel: `maps-dev/tnet/js/tnet-print.js`
- Beispiel-Manifest mit Geometrieelementen: `maps-dev/tnet/ol-pdf-printer/qgis-templates/webgis_a3_hoch_portrait.manifest.json`

## Entscheid

Ja, `scaleLabel`, `scaleBar`, `map`, `northArrow` sollen als strukturierte Layout-Variablen gefuehrt werden.

Aber nicht als reine Text-Platzhalter, sondern als Manifest-gesteuerte Geometrieobjekte mit verbindlichen mm-Dimensionen aus QGIS.