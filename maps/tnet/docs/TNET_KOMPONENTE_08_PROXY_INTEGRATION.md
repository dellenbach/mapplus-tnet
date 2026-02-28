# Komponente 08 — Proxy Integration

## Zweck
Kapselt externe Zugriffe über serverseitige Proxies für Routing, Sicherheit und Stabilität.

## Einstiegspunkte
- `maps/agsproxy.php`
- `maps/tnet/api/search-proxy.php`
- `maps/tnet/php/active-maps-proxy.php`

## Hauptfluss
1. Frontend sendet Request an internen Proxy-Endpunkt.
2. Proxy validiert/transformiert Parameter.
3. Proxy ruft Zielservice auf und verarbeitet Antwort.
4. Frontend erhält vereinheitlichtes Ergebnis.

## Abhängigkeiten
- PHP-Laufzeit und Serverkonfiguration.
- Erreichbarkeit externer Zielsysteme.

## Risiken/Guardrails
- Eingaben serverseitig validieren und Fehlercodes sauber durchreichen.
- Keine sensiblen Ziel-URLs oder Credentials im Frontend exponieren.

## Troubleshooting
- HTTP 500: PHP-Logs und Parameterweitergabe prüfen.
- Unerwartete Antwortfelder: Mapping im jeweiligen Proxy kontrollieren.

## Relevante Dateien
- `maps/agsproxy.php`
- `maps/tnet/api/search-proxy.php`
- `maps/tnet/php/active-maps-proxy.php`
