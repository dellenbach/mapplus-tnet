# Schlüssel- und FK-Analyse (Beispielfiles)

Stand: 2026-02-27

## Analysierte Dateien (Beispiele)

### TNET-Beispiel (EWN GWR)
- `c:\_Daten\mapplus-exp\core\config\layers_TNET_ewn_EWN_NIS_gwr.conf`
- `c:\_Daten\mapplus-exp\core\config\maptips_TNET_ewn_EWN_NIS_gwr.conf`
- `c:\_Daten\mapplus-exp\core\nls\de\lyrmgrResources_TNET_ewn_EWN_NIS_gwr.json`
- `c:\_Daten\mapplus-exp\core\nls\de\maptipsResources_TNET_ewn_EWN_NIS_gwr.json`

### Ohne TNET (NODI / Geoadmin)
- `c:\_Daten\mapplus-exp\core\config\layers_nodi_ch.conf`
- `c:\_Daten\mapplus-exp\core\config\maptips_nodi_ch.conf`
- `c:\_Daten\mapplus-exp\core\nls\de\lyrmgrResources_nodi_ch.json`
- `c:\_Daten\mapplus-exp\core\nls\de\maptipsResources_nodi_ch.json`
- `c:\_Daten\mapplus-exp\core\nls\de\legendResources_nodi.json`
- `c:\_Daten\mapplus-exp\core\config\layers_geoadmin.conf`
- `c:\_Daten\mapplus-exp\core\config\maptips_geoadmin.conf`
- `c:\_Daten\mapplus-exp\core\nls\de\maptipsResources_geoadmin.json`
- `c:\_Daten\mapplus-exp\core\nls\de\legendResources_geoadmin.json`

## Tabelle: Schlüssel, FK und Muster

| Bereich | Datei | PK / Schlüssel im File | FK / Referenz | Schlüsselmuster (beobachtet) | Beispiel |
|---|---|---|---|---|---|
| Layer-Definition (TNET) | `layers_TNET_ewn_EWN_NIS_gwr.conf` | Objekt-Key pro Layer | Von Maptips via `linked_layer` referenziert | Hierarchischer Layer-Key mit `/` | `ewn/ewn_nis_gwr/gwr/egid` |
| Maptips (TNET) | `maptips_TNET_ewn_EWN_NIS_gwr.conf` | Objekt-Key pro Maptip-Konfiguration | `linked_layer` -> Layer-Key; `nls` -> Ressourcen-Key | `<layerPath>_<queryLayerId>` und teils `<...>_grp_<groupLayerPath>` | `ewn/ewn_nis_gwr/gwr/egid_2` / `ewn/ewn_nis_gwr/gwr/egid_2_grp_ewn/ewn_nis_gwr/gwr` |
| Layer-UI-Text (TNET) | `lyrmgrResources_TNET_ewn_EWN_NIS_gwr.json` | JSON-Key | Referenziert Layer-Keys (beschreibend) | `desc_<layerKey>` | `desc_ewn/ewn_nis_gwr/gwr/egid` |
| Maptip-Text (TNET) | `maptipsResources_TNET_ewn_EWN_NIS_gwr.json` | JSON-Key | Referenziert `nls` aus Maptips | `<nls>_title` (und analog Feld-Keys in anderen Files) | `ewn/ewn_nis_gwr/gwr/egid_2_title` |
| Layer-Definition (NODI, ohne TNET) | `layers_nodi_ch.conf` | Objekt-Key pro Layer | Von Maptips via `linked_layer`; von Legend via `legend` | Flache Layer-Keys (oft technisch/fachlich) | `av_update`, `gwr_address`, `swissalti3dslope_percent` |
| Maptips (NODI, ohne TNET) | `maptips_nodi_ch.conf` | Objekt-Key pro Maptip-Konfiguration | `linked_layer` -> Layer-Key; `linked_basemap` -> Basemap-Key; `nls` -> Ressourcen-Präfix | Frei benannte Maptip-Keys, häufig mit Präfixen (`av_`, `gwr_`, ...) | `av_fixpunkte_lfp1`, `gwr_address_av` |
| Layer-UI-Text (NODI, ohne TNET) | `lyrmgrResources_nodi_ch.json` | JSON-Key | Referenziert Layer-Key | `desc_<layerKey>` | `desc_gwr_address` |
| Maptip-Text (NODI, ohne TNET) | `maptipsResources_nodi_ch.json` | JSON-Key | Referenziert `nls` aus Maptips | `<nls>_title`, `<nls>_field_<attribut>`, `<nls>_tabX` | `gwr_address_title`, `gwr_address_field_egid` |
| Legenden-Text/Link (NODI) | `legendResources_nodi.json` | JSON-Key | Referenziert `legend` aus Layer-Config | `<legendKey>_title`, `<legendKey>_link` | `gwr_address_title`, `gwr_address_link` |
| Geoadmin (ohne TNET) | `layers_geoadmin.conf` + `maptips_geoadmin.conf` + Ressourcen | Layer-Key = Maptip-Key (1:1) | `linked_layer` == Layer-Key; `legend` == Layer-Key; Ressourcen nutzen denselben Key-Präfix | `<key>_title`, `<key>_link` | `ch.agroscope.abschaetzung-organische_boeden_*` |

## Zusammengesetzte Schlüssel (beobachtet)

### 1) TNET-Layer-Key
- Muster: `<domain>/<service>/<group>/<sublayer>` (hierarchisch, variabel tief)
- Beispiel: `ewn/ewn_nis_gwr/gwr/egid`

### 2) TNET-Maptip-Key
- Muster A: `<layerPath>_<queryLayerId>`
- Muster B: `<layerPath>_<queryLayerId>_grp_<groupLayerPath>`
- Beispiele:
  - `ewn/ewn_nis_gwr/gwr/egid_2`
  - `ewn/ewn_nis_gwr/gwr/egid_2_grp_ewn/ewn_nis_gwr/gwr`

### 3) Ressourcen-Key Layermanager
- Muster: `desc_<layerKey>`
- Beispiel: `desc_gwr_address` oder `desc_ewn/ewn_nis_gwr/gwr/egid`

### 4) Ressourcen-Key Maptips
- Muster: `<nls>_title`, `<nls>_field_<feldname>`
- Beispiele:
  - `gwr_address_title`
  - `gwr_address_field_egid`
  - `ewn/ewn_nis_gwr/gwr/egid_2_title`

### 5) Ressourcen-Key Legende
- Muster: `<legendKey>_title`, `<legendKey>_link`
- Beispiele:
  - `swissalti3dslope_percent_title`
  - `swissalti3dslope_percent_link`

## Join-Regeln (praktisch)

1. Layer zu Maptip
   - `maptips_*.conf[*].linked_layer` -> Key in `layers_*.conf`

2. Layer zu Layer-Label
   - `desc_ + <layerKey>` -> Key in `lyrmgrResources_*.json`

3. Maptip zu Maptip-Label
   - `maptips_*.conf[*].nls` als Präfix -> Keys in `maptipsResources_*.json`

4. Layer zu Legende
   - `layers_*.conf[*].legend` als Präfix -> `<legend>_title` / `<legend>_link` in `legendResources_*.json`

## Wichtige Besonderheiten

- In TNET-Dateien können Key-Segmente in unterschiedlicher Gross-/Kleinschreibung vorkommen (z. B. in Top-Level-Beschreibungen). Bei automatischen Joins daher normalisierte Vergleiche oder definierte Mapping-Regeln verwenden.
- Bei NODI-Maptips existieren auch Einträge mit leerem `linked_layer` und stattdessen `linked_basemap`; das ist ein eigener Beziehungstyp (Basemap-gebundene Abfrage).
- Im Geoadmin-Set ist das Mapping am klarsten: Layer-Key, Legend-Key, Maptip-Key und Ressourcen-Key-Präfix sind weitgehend identisch.

## Feld-zu-Feld Join-Matrix

| Quelle | Quellfeld | Ziel | Zielfeld | Join-Typ | Beispiel |
|---|---|---|---|---|---|
| `layers_*.conf` | Objekt-Key (Top-Level-Key) | `maptips_*.conf` | `linked_layer` | 1:n | `ewn/ewn_nis_gwr/gwr/egid` -> `linked_layer: ewn/ewn_nis_gwr/gwr/egid` |
| `maptips_*.conf` | `nls` | `maptipsResources_*.json` | Key-Präfix (`<nls>_title`, `<nls>_field_*`) | 1:n | `nls: gwr_address` -> `gwr_address_title`, `gwr_address_field_egid` |
| `layers_*.conf` | Objekt-Key | `lyrmgrResources_*.json` | `desc_<layerKey>` | 1:1 (logisch) | `gwr_address` -> `desc_gwr_address` |
| `layers_*.conf` | `legend` | `legendResources_*.json` | `<legend>_title`, `<legend>_link` | 1:n | `legend: gwr_address` -> `gwr_address_title`, `gwr_address_link` |
| `maptips_*.conf` | Objekt-Key (Maptip-Key) | `maptipsResources_*.json` | `<maptipKey>_title` (bei TNET häufig) | 1:1 oder 1:n | `ewn/ewn_nis_gwr/gwr/egid_2` -> `ewn/ewn_nis_gwr/gwr/egid_2_title` |
| `maptips_*.conf` | `query_layers` | Layer-Service (`layers.params.layers` oder externer Service-Layer) | Layername/Layer-ID | n:1 (fachlich) | `query_layers: 2` (ArcGIS MapServer) oder `query_layers: CPPT` (WMS) |
| `maptips_*.conf` | `linked_basemap[]` | Basemap-Layer in `layers_*.conf` | Objekt-Key | n:m | `linked_basemap: ["av_sw", "av_f"]` |
| `layers_geoadmin.conf` | Objekt-Key | `maptips_geoadmin.conf` | Objekt-Key und `linked_layer` | 1:1 | `ch.agroscope.abschaetzung-organische_boeden` in beiden Dateien identisch |
| `layers_geoadmin.conf` | `legend` | `legendResources_geoadmin.json` | `<legend>_title`, `<legend>_link` | 1:1 | `legend: ch.agroscope.abschaetzung-organische_boeden` -> `..._title/link` |
| `maptips_geoadmin.conf` | `nls: geoadmin` + `linked_layer` | `maptipsResources_geoadmin.json` | `<linked_layer>_title` und Feld-Keys | 1:n | `linked_layer: ch.are.bauzonen` -> `ch.are.bauzonen_title` |
