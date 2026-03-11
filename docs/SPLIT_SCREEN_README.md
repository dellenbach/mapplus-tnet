# Split-Screen Map Feature

## Übersicht

Die Split-Screen-Funktion ermöglicht es, zwei Karten nebeneinander anzuzeigen, um verschiedene Layer oder Kartenansichten miteinander zu vergleichen. Dies ist besonders nützlich für:

- **Layer-Vergleich**: Unterschiedliche Kartenlayer gleichzeitig betrachten
- **Zeitvergleiche**: Historische vs. aktuelle Karten
- **Datenanalyse**: Verschiedene thematische Layer nebeneinander vergleichen

## Funktionen

### Hauptfunktionen

✅ **Geteilte Kartenansicht**: Zwei synchronisierte Karten nebeneinander  
✅ **Synchronisierte Navigation**: Zoom und Verschieben werden auf beide Karten angewendet  
✅ **Anpassbare Teilung**: Der Teiler kann per Drag & Drop verschoben werden  
✅ **Ein-Klick-Aktivierung**: Toggle-Button für schnelles Ein-/Ausschalten  
✅ **Layer-Kopierung**: Alle aktiven Layer werden auf beide Karten angewendet

### Bedienung

#### Split-Screen aktivieren

1. Klicken Sie auf den **Split-Screen Button** (Symbol mit zwei Rechtecken) in der oberen rechten Ecke der Karte
2. Die Karte wird in zwei Panels aufgeteilt: **Karte A** (links) und **Karte B** (rechts)
3. Beide Karten zeigen zunächst die gleichen Layer

#### Split-Screen anpassen

- **Teiler verschieben**: Ziehen Sie den mittleren Teiler nach links oder rechts, um die Größe der Panels anzupassen
- **Navigation**: Zoomen und Verschieben funktioniert in beiden Karten und wird automatisch synchronisiert

#### Split-Screen deaktivieren

1. Klicken Sie erneut auf den **Split-Screen Button**
2. Die geteilte Ansicht wird geschlossen und die ursprüngliche Einzelkartenansicht wiederhergestellt

## Technische Details

### Dateien

Die Split-Screen-Funktion besteht aus folgenden Dateien:

- **JavaScript**: `/maps/tnet/js/tnet-splitscreen.js` - Hauptlogik für Split-Screen
- **CSS**: `/maps/tnet/css/tnet-splitscreen.css` - Styling für Split-Screen Layout
- **HTML**: Änderungen in `/maps/public/index_de.htm` - Button und Script-Einbindung

### Architektur

```
┌─────────────────────────────────────────┐
│         Split-Screen Container          │
├──────────────────┬──┬───────────────────┤
│   Panel Links    │ D │   Panel Rechts   │
│   (Karte A)      │ i │   (Karte B)      │
│                  │ v │                  │
│   ┌──────────┐   │ i │   ┌──────────┐   │
│   │ Map1 (OL)│   │ d │   │ Map2 (OL)│   │
│   │          │   │ e │   │          │   │
│   │          │   │ r │   │          │   │
│   └──────────┘   │   │   └──────────┘   │
└──────────────────┴──┴───────────────────┘
```

### Synchronisation

Die beiden Karten werden über Event-Listener synchronisiert:

- **Center-Änderung**: Wird von einer Karte zur anderen übertragen
- **Zoom-Änderung**: Resolution wird synchronisiert
- **Debouncing**: 50ms Verzögerung zur Vermeidung von Endlosschleifen

### Browser-Kompatibilität

- ✅ Chrome/Edge (empfohlen)
- ✅ Firefox
- ✅ Safari
- ⚠️ Mobile Browser (eingeschränkt, responsive Design vorhanden)

## Zukünftige Erweiterungen

Mögliche zukünftige Verbesserungen:

- **Unabhängige Layer-Auswahl**: Verschiedene Layer für jede Karte auswählen
- **Vertikale Teilung**: Option für horizontale Anordnung (oben/unten)
- **Mehr als 2 Karten**: Quad-View mit 4 Karten
- **Gespeicherte Vergleiche**: Favoriten für häufige Layer-Kombinationen
- **Screenshot-Export**: Beide Karten zusammen exportieren

## Bekannte Einschränkungen

- Layer-Auswahl erfolgt aktuell global (beide Karten zeigen die gleichen Layer)
- Popup-Fenster werden nur auf der aktiven Karte angezeigt
- Bei sehr vielen Layern kann die Performance beeinträchtigt werden

## Support

Bei Problemen oder Fragen zur Split-Screen-Funktion:

1. Überprüfen Sie die Browser-Konsole auf Fehlermeldungen
2. Stellen Sie sicher, dass die neueste Version geladen ist (Cache leeren)
3. Kontaktieren Sie den Support mit einer Beschreibung des Problems

---

**Version**: 1.0  
**Datum**: Februar 2026  
**Autor**: GitHub Copilot
