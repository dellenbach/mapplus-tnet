# Komponente 06 — Search

## Zweck
Bietet textbasierte Suche und integriert Resultate in die Karten- und App-Logik.

## Einstiegspunkte
- `maps/tnet/js/tnet-search.js`
- `maps/tnet/api/search-proxy.php`

## Hauptfluss
1. UI nimmt Suchbegriff entgegen.
2. Frontend triggert Suchrequest.
3. Proxy/API liefert normalisierte Treffer zurück.
4. Treffer werden in Karte/Liste visualisiert.

## Abhängigkeiten
- Erreichbarer Backend-Endpunkt (`search-proxy.php`).
- Runtime-Helfer für Darstellung, Fokus und Fehlerbehandlung.

## Risiken/Guardrails
- Timeouts und leere Resultsets explizit behandeln.
- Keine impliziten Feldannahmen bei API-Antworten ohne Schema-Check.

## Troubleshooting
- Keine Treffer: Request/Response in `tnet-search.js` und Proxy-Output prüfen.
- CORS/Netzprobleme: Serverpfad und Proxy-Routing verifizieren.

## Relevante Dateien
- `maps/tnet/js/tnet-search.js`
- `maps/tnet/api/search-proxy.php`
- `maps/tnet/js/tnet-mapplus-helpers.js`
