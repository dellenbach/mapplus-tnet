# Bookmark Smoke-Test (Desktop + Mobile)

Stand: 2026-05-29
Scope: Bookmark-Flow v2 (Speichern, Deploy, Laden/Anzeigen)

## Desktop (maps-dev)

- [x] Hard-Reload durchgefuehrt (Ctrl+Shift+R)
- [x] AGS-Import geoeffnet
- [x] Bookmark-Speichern ausgelost
- [x] Deploy ausgelost
- [x] Zielanzeige geprueft (DEV/PROD im Status)
- [x] Toast-Meldung geprueft (success/info/error)

## Mobile (maps-dev)

- [x] Hard-Reload durchgefuehrt
- [x] Karteninhalt-Sheet oeffnet korrekt
- [x] Bookmark-bezogene UI-Elemente sichtbar
- [x] Keine offensichtlichen JS-/Render-Fehler im Flow beobachtet

## Ergebnis

- Gesamtstatus: OK
- Rueckmeldung: "sieht soweit gut aus"

## Naechster Regression-Check

- URL-Varianten einmal gezielt querpruefen:
  - /maps-dev/{bookmarkId}
  - /maps-dev/{bookmarkId}?view={viewId}
  - mit/ohne layers= Parameter
