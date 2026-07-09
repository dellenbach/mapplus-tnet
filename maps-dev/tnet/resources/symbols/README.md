# TNET Katalog-Symbole (Tydac-Editor)

Klar getrennte Ablage der Layer-/Gruppen-Symbole fuer den Themenkatalog
(originales MAP+/TYDAC ClassicLayerMgr-Format). **Nicht** vermischt mit den
UI-Icons unter `resources/icons/` oder den Wappen unter `resources/`.

## Struktur

- `base/` — mitgeliefertes Basis-Set (aus `core/symbolsets` uebernommen).
- `custom/<site>/` — site-spezifische Uploads aus dem Tydac-Editor
  (z.B. `custom/maps/`, `custom/geohost/`).

## Referenzierung

In gespeicherten Tydac-Dokumenten werden Symbole **app-root-relativ** referenziert:

```
<appRoot>/tnet/resources/symbols/base/<name>.svg
<appRoot>/tnet/resources/symbols/custom/<site>/<name>.svg
```

`<appRoot>` ist z.B. `/maps`, `/maps-dev` oder `/geohost` und wird zur Laufzeit
aus `window.__TNET_APP_ROOT` bzw. der URL abgeleitet (Multi-Site-faehig).

## Upload / Sicherheit

Uploads laufen ueber `treebuilder-api.php?action=upload-icon` (PNG und SVG).
SVG wird serverseitig **zwingend bereinigt** (Entfernen von `<script>`,
`<foreignObject>`, `on*`-Handlern, `javascript:`- und externen `href`-Referenzen).
