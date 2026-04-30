# TNET Komponentenübersicht

Kompakte Architekturübersicht des TNET-Stacks im aktuellen Repo-Stand. Aussagen zu internen Abläufen sind bewusst neutral formuliert, wenn kein eindeutiger Codebeleg vorliegt.

## Inhaltsverzeichnis

1. [Komponente 01: Bootstrapping](./TNET_KOMPONENTE_01_BOOTSTRAPPING.md) — Diagramm: `TNET_KOMPONENTE_01_BOOTSTRAPPING.drawio`
2. [Komponente 02: Runtime Core](./TNET_KOMPONENTE_02_RUNTIME_CORE.md) — Diagramm: `TNET_KOMPONENTE_02_RUNTIME_CORE.drawio`
3. [Komponente 03: Layer Konfiguration](./TNET_KOMPONENTE_03_LAYER_KONFIGURATION.md) — Diagramm: `TNET_KOMPONENTE_03_LAYER_KONFIGURATION.drawio`
4. [Komponente 04: Layer Runtime](./TNET_KOMPONENTE_04_LAYER_RUNTIME.md) — Diagramm: `TNET_KOMPONENTE_04_LAYER_RUNTIME.drawio`
5. [Komponente 05: Info Panel & Picking](./TNET_KOMPONENTE_05_INFO_PANEL_PICKING.md) — Diagramm: `TNET_KOMPONENTE_05_INFO_PANEL_PICKING.drawio`
6. [Komponente 06: Search](./TNET_KOMPONENTE_06_SEARCH.md) — Diagramm: `TNET_KOMPONENTE_06_SEARCH.drawio`
7. [Komponente 07: Spatial & OEREB](./TNET_KOMPONENTE_07_SPATIAL_OEREB.md) — Diagramm: `TNET_KOMPONENTE_07_SPATIAL_OEREB.drawio`
8. [Komponente 08: Proxy Integration](./TNET_KOMPONENTE_08_PROXY_INTEGRATION.md) — Diagramm: `TNET_KOMPONENTE_08_PROXY_INTEGRATION.drawio`
9. [Komponente 09: API v1](./TNET_KOMPONENTE_09_API_V1.md) — Diagramm: `TNET_KOMPONENTE_09_API_V1.drawio`
10. [Komponente 10: Deployment](./TNET_KOMPONENTE_10_DEPLOYMENT.md) — Diagramm: `TNET_KOMPONENTE_10_DEPLOYMENT.drawio`

## Querbezüge (Kernpfade)

- Einstieg Desktop: `maps/public/index_de.htm`
- Einstieg Mobile: `maps/public/index_de_m.htm`
- Modulkonfiguration: `maps/public/config/modules.js`
- Mobile Loader: `maps/tnet/js/mobile/tnet_modules_m.js`
- Runtime Kern: `maps/tnet/js/tnet-app.js`, `maps/tnet/js/tnet-mapplus-helpers.js`, `maps/tnet/js/tnet-utils.js`
- Layer-Konfig: `maps/public/config/lyrmgr.conf`, `core/config`
- Layer-Runtime: `maps/tnet/js/tnet-lm-init.js`
- Feature-Module: `maps/tnet/js/tnet-info-panel.js`, `maps/tnet/js/tnet-search.js`, `maps/tnet/js/tnet-spatial-query.js`, `maps/tnet/js/tnet-oereb.js`
- Proxies/API: `maps/agsproxy.php`, `maps/tnet/api/search-proxy.php`, `maps/tnet/php/active-maps-proxy.php`, `maps/tnet/api/v1/layers.php`, `maps/tnet/api/docs/openapi.yaml`
- Deployment-Helfer: `_scripts/deployment/_upload_changed.py`, `_scripts/deployment/_upload_active_file.py`
