## 2026-07-10 - Tydac-Editor: Eigene Kategorie-Icons kleiner als 38px oben-links statt zentriert

- Symptom: Kategorie-Icon mit eigener Grösse (≠38px, eigene Klasse `njsCatIcon_<site>_<key>`) klebte bei nicht-quadratischen/kleineren Icons oben-links statt zentriert.
- Root-Cause: Die generierte override.css-Regel setzte `background-position: center` OHNE `!important`. Das Icon-Element trägt zusätzlich `dijitIcon`; `.tundra .dijitIcon { background-position: 0 0 }` (Spezifität 0,2,0) schlägt die eigene Klasse (0,1,0) → oben-links. Bei `contain` + nicht-quadratischem SVG entsteht Letterboxing, das dann oben-links sitzt.
- Fix: `background-position: center center !important` (+ repeat/size/`vertical-align:middle` mit `!important`) in `buildCategoryIconsBlock`. Bestehende Overrides via erneutes Zuweisen/„übernehmen" neu schreiben lassen.
- Guardrail: Bei override.css-Regeln, die Dojo-`dijitIcon`-Elemente treffen, IMMER `!important` auf background-position/size/repeat setzen — sonst gewinnen die spezifischeren `.tundra .dijitIcon`-Regeln.

## 2026-07-10 - Tydac-Editor: Layer-Icon per CSS überschreiben (statt DB-Definition)

- Symptom: Im Editor gewähltes Layer-Icon erschien im Dojo-ClassicLayerMgr nicht — dort blieb das Default `lyr_layers.svg`.
- Root-Cause: Der Dojo-Renderer liest Layer-Definitionen (inkl. `icon`) über `loader.php` aus statischen `.conf`-Dateien; der Editor speicherte das Icon nur in die DB (`config_bundle_store`) ohne Datei-Deploy/Cache-Flush → Quellen-Mismatch. Layer-Icon lässt sich nicht „einfach" übersteuern, es steckt in der Layer-Definition.
- Fix: Neuer, definitionsunabhängiger Weg — CSS-Override in `public/css/override.css` (eigener Marker-Block `TNET-LAYER-ICONS`). Der Runtime rendert `<div id="div_<layerId>"><img class="njsIcon legendIcon">`; per `#div_<layerId> img.njsIcon.legendIcon { content: url(...) !important; width/height }` wird das dargestellte Bild ersetzt (img ist replaced element → `content:url()` greift). Editor: Sektion „Layer-Icon per CSS überschreiben" (Bibliothek/Upload/URL + Grösse), Deploy sofort via FastAPI. Actions `layer-icons-load`/`layer-icons-save`.
- Guardrail: `<img>`-Icons lassen sich per `content: url()` auf einen eindeutigen Container-Selektor (`#div_<layerId>`) sauber überschreiben — robuster als DB/Datei-Deploy, wenn der Runtime aus statischen Configs liest. override.css-Blöcke pro Feature getrennt markieren (CAT-ICONS vs. LAYER-ICONS), damit sich Speichervorgänge nicht gegenseitig überschreiben.

## 2026-07-10 - Tydac-Editor: Kategorie-Icon-Klasse pro Kategorie eindeutig + Grösse/Zwei-Zustand

- Symptom: Eigene Kategorie-Icons bekamen immer dieselbe Klasse (`njsCatIcon_geohost_cat`), Grösse liess sich nicht einstellen, kein grau/farbig-Zustand steuerbar.
- Root-Cause: Klassenname wurde aus `node._key || node.name` abgeleitet — bei objekt-gekeyten ClassicLayerMgr-Kategorien ist `_key` leer → Fallback `cat` für ALLE. override.css-Regel hatte zudem keine variable Grösse/Opacity.
- Fix: `catKeyForNode()` leitet den Key aus `_key`/`name` ODER dem Struktur-Segment des Pfads ab → eindeutige Klasse `njsCatIcon_<site>_<key>` (+ `_active`). Grössen-Input pro Kategorie; override.css-Regel schreibt `width/height` (Grösse) und `opacity` (normal 0.5 grau, aktiv 1 farbig). Presets in 38px nutzen weiter die Original-`njsCategoryIconN`; bei anderer Grösse/eigenem Bild eigene Regel mit Preset-SVG (`*_active.svg`) bzw. Bild. PHP-Builder/Parser unterstützen `url` (images/… oder /core/…), `size`, `opacity` mit Round-Trip.
- Guardrail: Bei objekt-gekeyten Strukturen NIE nur `_key`/`name` für abgeleitete IDs nutzen — den Objekt-/Pfad-Key als Fallback heranziehen, sonst kollidieren alle Einträge auf einen Namen.

## 2026-07-10 - Tydac-Editor: Kategorie-Icons besser über vordefinierte Framework-Klassen (njsCategoryIcon1..11)

- Symptom: Eigene hochgeladene Kategorie-Icons erschienen in der Karten-App flächig/falsch dimensioniert; Grösse liess sich nicht einstellen; unklar, welcher Icon-Pfad der richtige ist.
- Root-Cause: MAP+ hat 11 vordefinierte Kategorie-Icon-Klassen `njsCategoryIcon1..11` (+ `_active`) in `core/templates/nwow_floating/css/PoiManager.css` (shared, in JEDER App via index geladen, feste 38×38px, referenzieren die SVGs in `img/poi_manager/`). Eigene override.css-Regeln setzten keine `width/height` → das Dojo-Icon-Element rendert in Standardgrösse bzw. flächig.
- Fix: Editor bietet primär die 11 Standard-Presets (Palette mit SVG-Vorschau aus `/core/.../poi_manager/`, setzt `iconClass=njsCategoryIconN` + `iconClassActive=njsCategoryIconN_active`) — sofort sichtbar, korrekte Grösse, kein Upload/Deploy nötig. Eigenes-Bild bleibt Option; `buildCategoryIconsBlock` schreibt jetzt `width/height:38px` in den override.css-Block.
- Guardrail: Für Kategorie-Icons zuerst die vordefinierten `njsCategoryIconN`-Klassen nutzen (robust, shared, korrekt dimensioniert). Bei eigenen Bild-Klassen immer explizit `width/height` setzen, sonst rendert das Dojo-Icon flächig/falsch.

## 2026-07-10 - Tydac-Editor: Kategorie-Icon in Kartenanwendung unsichtbar (iconclass vs. iconClass)

- Symptom: Kategorie-Icon liess sich im Editor zuweisen, erschien aber nicht in der Dojo-Kartenanwendung; die Auswahl war zudem unkomfortabel (nur bereits zugewiesene Bilder wählbar).
- Root-Cause: Der Tydac-Editor schrieb `iconclass`/`iconclassActive` (klein) in die Struktur. Laufzeit (`ClassicLayerMgr` liest `cat.iconClass`/`cat.iconClassActive`), `layers.php` und `lyrmgr-to-json.php` erwarten aber camelCase `iconClass` → Schlüssel nie gefunden. Zusätzlich listete `catImgGridHtml` nur `_catIconRules` (bereits zugewiesene), keine Bibliothek.
- Fix: Editor durchgängig auf camelCase `iconClass`/`iconClassActive` umgestellt (Lesen tolerant für Alt-Daten); `loadCategoryIcons()` (PHP) listet zusätzlich alle Bilder aus `public/css/images/` (`images`), Grid zeigt Bibliothek + Auswahl-Markierung + Entfernen-Button.
- Guardrail: Config-Schlüssel exakt an die Laufzeit anpassen — `ClassicLayerMgr` nutzt `iconClass`/`iconClassActive` (camelCase, njs-DOM-Klasse muss `Icon` oder `njsCategory` enthalten, damit `tnet_toc.js` sie beim Tab→Accordion-Umbau übernimmt).

## 2026-07-10 - Tydac-Editor: Icon-Pfad falsch aufgelöst (core ist shared /core)

- Symptom: Layer-Icons erschienen nicht im Editor-Baum; DevTools zeigte `src="/maps-dev/core/symbolsets/…"` (404), das `onerror` blendete das Bild aus.
- Root-Cause: `normalizeIconUrl` löste `../core/…` mit `APP_ROOT + '/core/'` = `/maps-dev/core/…` auf. `core` ist aber SHARED unter `/core`, nicht pro App.
- Fix: `normalizeIconUrl` mappt jeden `…/core/…`-Pfad auf `/core/…` (shared) und `…/tnet/…` auf den aktuellen Kontext (`_ctxRoot`). Regex `\/core\/.*` bzw. `\/tnet\/.*` extrahiert den Rest, unabhängig von relativ/absolut.
- Guardrail: `core` immer absolut `/core` (shared, alle Apps); nur `tnet`/`public` sind app-/kontextspezifisch. Icon-/Asset-Pfade nie mit dem App-Root vor `core` prefixen.

## 2026-07-10 - Layer-Icon ging beim Speichern verloren (DB-first vs. Datei)

- Symptom: Layer-Icon im Tydac-Editor liess sich setzen, war nach dem Speichern/Neuladen aber weg.
- Root-Cause: Die Layer-Definitionen sind DB-first (`config_bundle_store`, source `db:<scope>`). Der Layer-Icon-Editor schrieb via FastAPI `save-layer-props` in die `layers_*.conf`-DATEI — die Laufzeit liest aber die DB, daher wirkungslos.
- Fix: Neue Action `save-layer-props-db` aktualisiert den Layer-Eintrag direkt im DB-Bundle über `StagingImportRepository::saveFileData($kuerzel, $fileName, $data, …)`. Frontend erkennt `source` mit Prefix `db:` und nutzt den DB-Weg; nur echte Datei-Layer gehen weiter über FastAPI.
- Guardrail: Vor jedem Layer-Property-Write prüfen, ob die Quelle DB (`db:*`) oder Datei ist. Bei DB-first NIE die Datei schreiben (wird ignoriert) — immer `config_bundle_store` via `saveFileData` aktualisieren.

## 2026-07-09 - Tydac-Editor: Icon-Management (Kategorie via override.css, Layer via save-layer-props)

- Anforderung: Kategorie-Icons (Dojo-Renderer, CSS-Sprite) und Layer-Icons sollen im Editor wähl-/hochladbar sein; userspezifisch.
- Fakten: (1) `njsCategoryIcon`-Sprites liegen im externen mapplus-dojo-Framework (nicht previewbar als Standalone). (2) `core` ist shared unter `/core` (nicht `/maps-dev/core`). (3) Per-Layer-Icons kommen aus der Layer-Definition (`layers_*.conf`, `icon`/`icon_style`), nicht aus lyrmgr.conf.
- Umsetzung: Kategorie-Icons als BILD über site-spezifische `public/css/override.css` (eigener TNET-Marker-Block) + Bilder in `public/css/images/`; Upload/Write via FastAPI (`deploy-staged-conf`, Whitelist um `public/css/` erweitert). Layer-Icons via FastAPI `save-layer-props` (schreibt `layers_*.conf`). Editor lädt override.css live für Vorschau; eigene, kollisionsfreie Klassen `njsCatIcon_<site>_<key>`.
- Guardrail: Neue Deploy-Zielpfade IMMER in FastAPI-Whitelist (TARGET_PATHS aller Ziele) UND ggf. PHP getFastApiTarget/TNET_TMP_ROOT synchron halten; Kategorie-Icon-CSS nur in einem markierten Block schreiben (restliches override.css unangetastet). `core` ist shared `/core`, nicht per-Env. FastAPI-Whitelist-Änderung braucht `nssm restart FastAPI_9030`.

## 2026-07-09 - Tydac-Publish: FastAPI kannte kein geohost/edit + Objekt-Format/NLS im Editor

- Symptom: (1) tydac-publish auf geohost scheiterte „deployPath ist fuer target=prod nicht erlaubt"; (2) Kategorien nicht aufklappbar, Layer unsichtbar; (3) NLS-Namen fehlten (Roh-Keys).
- Root-Cause: (1) FastAPI `ags2mapplus_lyrmgr.py` TARGET_PATHS/_normalize_target kannten nur `prod`/`dev`; PHP `getFastApiTarget()`/`TNET_TMP_ROOT` nur maps/maps-dev. (2) Echtes ClassicLayerMgr-Format ist OBJEKT-gekeyt (`structure` = {catId:{items:{groupId:...}}}), der Editor erwartete Arrays. (3) Anzeigenamen kommen aus `desc_<key>` (lyrmgrResources), wurden nicht aufgelöst.
- Fix: FastAPI um Targets `geohost`+`edit` erweitert (Whitelist + normalize); PHP `getFastApiTarget()`/`TNET_TMP_ROOT` env-abhängig (maps-dev|geohost|edit|maps). Editor rendert `structure`/`items` als Objekt ODER Array; `nlsName()` löst `desc_<key>` (Slash + Underscore-Variante) über die list-all-layers-Aliases auf; `itemsArrayOf()` überschreibt objekt-gekeyte items nicht mehr mit `[]`. WYSIWYG: LyrMgr-Vorschau-Tab lädt `dev-test.html?group=&source=file|db` (gerenderter Laufzeit-Baum), Auto-Reload nach Publish.
- Guardrail: Neue Deploy-Umgebungen IMMER an drei Stellen synchron halten: FastAPI TARGET_PATHS/_normalize_target, PHP getFastApiTarget(), PHP TNET_TMP_ROOT. ClassicLayerMgr-`structure`/`items` können objekt-gekeyt sein — Renderer/Editor müssen beide Formen tragen und dürfen Objekte nie in Arrays zwangswandeln. FastAPI-Änderung braucht Dienst-Neustart (`nssm restart FastAPI_9030`).

## 2026-07-09 - Tydac-Editor: Feature-Parität zu V2 (Vorschau, D&D, Editieren, Publish)

- Symptom: Tydac-Editor zeigte nur eine leere `main_lyrmgr`-Sektion, kein D&D, keine Kartenvorschau, „Speichern" schrieb keine lyrmgr.conf.
- Root-Cause: (1) `tydac-load` las nur den (leeren) DB-Stand statt der echten Datei; (2) Rendering erwartete `structure` als Objekt, das echte ClassicLayerMgr-Format ist ein Array mit `_key`/`items`; (3) Kartenvorschau/Editier-/D&D-Funktionen fehlten; (4) Kategorie-Properties nutzten `iconClass` statt real `iconclass`.
- Fix: `tydac-load` seedet aus `getConfigPath()`-Datei; Rendering unterstützt Array-Struktur; OpenLayers-Vorschau rechts (LV95, wmts.geo.admin.ch, Klick auf Layer prüft ihn); Baum-D&D (Umsortieren + Layer aus Liste einfügen); Node-Aktionen (Löschen/+Gruppe/hoch-runter, `_key` editierbar); neue Action `tydac-publish` speichert Version (variant=tydac) UND publiziert konforme lyrmgr.conf via FastAPI `/deploy-staged-conf` mit vorherigem Backup.
- Guardrail: Tydac-Editor niemals per PHP direkt nach /www schreiben — immer via FastAPI `/deploy-staged-conf` (stagedPath unter `stageConf/`, deployPath unter `public/config/`). ClassicLayerMgr-`structure` ist ein Array mit `_key`; Property-Feldnamen exakt am Originalformat (`iconclass`, nicht `iconClass`) ausrichten.

## 2026-07-09 - Tydac-Katalog: catalog_document ohne site/variant-Spalte

- Symptom: Tydac-Katalog laden schlug fehl mit `SQLSTATE[42703] column "site" does not exist`.
- Root-Cause: `CatalogRepository` wurde auf Multi-Site (site+variant) umgestellt, aber nur die Draft-Tabellen bekamen die Migration; `catalog_document`, `catalog_document_history` und `catalog_lock` hatten weiterhin nur `PRIMARY KEY (profile)`.
- Fix: Neue idempotente `ensureCatalogTables()` in `CatalogRepository` ergaenzt `site`/`variant` (Default `maps`/`tnet`) und re-keyt die PKs auf `(site, profile, variant)`; Aufruf in allen catalog_document/history/lock-Methoden.
- Guardrail: Wird ein Repository um neue Schluessel-Dimensionen erweitert, muss die idempotente Migration ALLE betroffenen Tabellen abdecken, nicht nur eine Teilmenge.

## 2026-07-09 - Tydac-Dropdown musste Ordnergruppen statt nur lyrmgr-Profile zeigen

- Symptom: Auf maps-dev waren im Tydac-Dropdown die gewuenschten Gruppen aus `public/config` nicht sichtbar.
- Root-Cause: Die Liste basierte auf `list-lyrmgr-profiles` und erfasste dadurch nur Profile mit `lyrmgr.conf`, nicht alle Config-Unterordner.
- Fix: Neue API `list-config-groups` liefert `public` plus alle Unterordner unter `public/config`; Frontend merged diese Gruppen weiterhin mit Tydac-DB-Revisionen.
- Guardrail: Wenn die Benutzeroberflaeche Ordnergruppen darstellen soll, niemals indirekt ueber dateispezifische Filter (`*lyrmgr.conf`) auflisten.

## 2026-07-09 - Tydac-Profilauswahl zeigte keine Config-Gruppen

- Symptom: Im Tydac-Editor blieb die Profilauswahl praktisch leer; `public` und Unterordner aus `public/config/` waren nicht direkt auswählbar.
- Root-Cause: Das Dropdown bezog seine Liste nur aus `tydac-list-profiles` (DB-Katalog), nicht aus den realen Profil-/Gruppenverzeichnissen (`list-lyrmgr-profiles`).
- Fix: Frontend-`loadProfiles()` kombiniert jetzt `list-lyrmgr-profiles` (Config-Gruppen) und `tydac-list-profiles` (Revisionen) zu einer gemeinsamen Auswahlliste; `public` wird priorisiert.
- Guardrail: Auswahlfelder im Editor immer aus Datei-Quelle UND DB-Quelle aufbauen, wenn Profile sowohl als Ordnerstruktur als auch als Katalogdokumente existieren.

## 2026-07-09 - Release-Kette brach nach Sync-Step ab (Robocopy Exit-Code)

- Symptom: `release-dryrun.bat` fuer EDIT stoppte nach Schritt 1, obwohl der Sync fachlich erfolgreich war.
- Root-Cause: `robocopy` liefert bei gefundenen Aenderungen oft Exit-Code `1` (Erfolg mit Kopierbedarf); der Caller behandelte `if errorlevel 1` als Fehler.
- Fix: In den `01_sync-...` Skripten nur `>=8` als Fehler behandeln und bei erfolgreichem Abschluss explizit `exit /b 0` setzen.
- Guardrail: Robocopy-Returncodes immer gemäss Robocopy-Semantik auswerten (0-7 ok, ab 8 Fehler), sonst brechen mehrstufige Batch-Release-Ketten falsch-negativ ab.

## 2026-07-09 - API-Doku zeigte aktive TreeBuilder unvollständig

- Symptom: In `/maps-dev/tnet/api/docs/` fehlten aktive TreeBuilder-Einstiege (V2/Tydac) in der Swagger-Doku.
- Root-Cause: `openapi.yaml` enthielt nur den Classic-Builder im Tools-Überblick und keine eigenen HTML-Tool-Pfade für alle aktiven Builder-Seiten.
- Fix: In `maps-dev/tnet/api/docs/openapi.yaml` Tools-Tabelle und Pfade für `tree-builder.html`, `tree-builder-v2.html` und `tree-builder-tydac.html` ergänzt; Cache-Buster in `maps-dev/tnet/api/docs/index.html` erhöht.
- Guardrail: Bei neuen Admin-/Editor-HTML-Seiten immer parallel OpenAPI-Tools-Tabelle und `paths` aktualisieren, sonst wirkt die Doku funktional unvollständig.

## 2026-06-30 - Bookmark: Gesperrte Layer dupliziert nach Login beim Einschalten

- Symptom: Gesperrter (locked) Bookmark-Layer erschien nach Login beim Sichtbar-Schalten doppelt im Karteninhalt (zwei Eintraege, abweichende Deckkraft).
- Root-Cause: Gesperrte Layer bleiben jetzt als locked-Platzhalter in `bookmark.layers` (damit Bookmark nach Login wieder funktioniert). Beim Aktivieren materialisiert das Framework einen zweiten Live-Layer mit gleicher ID; `mergeBookmarkLayers()` hatte keine finale ID-Dedup.
- Fix: In `mergeBookmarkLayers()` (tnet-lm-active.js) finale Dedup nach `id`; bei Konflikt gewinnt der nicht gesperrte Eintrag (locked-Platzhalter wird durch echten Live-Layer ersetzt).
- Guardrail: Locked-Platzhalter im Karteninhalt behalten (nicht entfernen) — aber Render-Pipeline muss pro ID deduplizieren, da Bookmark-State + Live-Map-Layer beide denselben Layer fuehren koennen.

## 2026-06-26 - File-Sync: Direkter PHP-copy() scheitert — Schreiben muss ueber FastAPI /deploy-staged-conf (SFTP)

- Symptom: Datei-Sync (DEV↔PROD) per `copy()` in PHP schrieb nichts; das Ziel unter /www blieb unveraendert.
- Root-Cause: Der PHP-/Web-User darf NICHT direkt nach /www schreiben. Saemtliche Datei-Writes laufen ueber den FastAPI-Endpoint `/deploy-staged-conf` (ags2mapplus), der die Datei via SFTP ans Ziel schreibt. PHP kann nur lesen (auch cross-tree) und in den TMP-Staging-Bereich schreiben.
- Fix: `file-sync-execute` staged den Quellinhalt nach `TNET_TMP_ROOT(zielenv)/stageConf/filesync/`, wandelt PHP-Pfade via `toSftpPath()` in SFTP-Pfade und ruft `deployStagedFileViaFastApi(stagedSftp, deploySftp, targetEnv)` (curl POST an `AGS_API_BASE/deploy-staged-conf?target=`). `FileSyncRepository::resolvePath()` liefert den realen PHP-Pfad (wwwRoot via `dirname(__DIR__,4)`).
- Wichtige FastAPI-Whitelist (TARGET_PATHS in ags2mapplus_lyrmgr.py): stagedPath muss unter `/data/tmp/<maps|maps-dev>/stageConf/` liegen; deployPath nur unter `core/config/`, `core/nls/de/`, `maps*/core/config/`, `maps*/core/nls/de/`, `maps*/public/config/`. → `tnet/config` ist NICHT deploybar (nur Vergleich), `core/legends|help` ebenfalls nicht. `target` = ZIEL-Umgebung (nicht aktuelle App).
- Guardrail: In dieser Umgebung NIE per PHP direkt nach /www schreiben — immer ueber FastAPI `/deploy-staged-conf` mit korrektem `target` (= Ziel-Env) und Staging unter dem stageConf-Whitelist-Pfad des Ziels. Pfade immer mit `toSftpPath()` umrechnen.



- Symptom: Im Sync-Tab zeigten DEV/PROD bei identischer Katalog-Revision unterschiedliche "Konfig"-Zeitstempel; auch nach mehrfachem Sync.
- Root-Cause: Der DB-Trigger `trg_catalog_document_updated` (set_updated_at) setzt `updated_at = now()` bei JEDEM UPDATE. Der Sync schrieb zwar `updated_at` aus der Quelle, der BEFORE-UPDATE-Trigger ueberschrieb es aber sofort mit der lokalen Zeit. Da die Anzeige `updated_at` als Konfig-Zeit nutzte, divergierten beide Seiten dauerhaft.
- Fix: Eigene, trigger-unabhaengige Spalten `config_revision_at` + `config_revision_by` in `catalog_document`. Sie werden in `CatalogRepository::saveProfile/publishBlock` zusammen mit der Revision gesetzt und in `SyncRepository::syncCatalog` 1:1 aus der Quelle ins Ziel kopiert (Trigger fasst sie nicht an). `getStatus` liest `COALESCE(config_revision_at, non-import-History, updated_at)`. Selbstheilendes `ensureSyncColumns()` (in getStatus, Best-Effort) legt Spalten an + backfillt. Verifiziert im Browser: nach einem Sync sind die Konfig-Zeiten identisch, Sync-Zeit bleibt getrennt.
- Guardrail: Bei "Kopie"-Sync NIE einen trigger-gesetzten Zeitstempel (updated_at via BEFORE-UPDATE) als Inhalts-/Konfig-Zeit verwenden. Inhaltszeit in eine eigene, trigger-freie Spalte schreiben, die mit der Revision gesetzt und beim Sync 1:1 mitkopiert wird.

## 2026-06-24 - File-Sync: PHP-Pfade duerfen nicht hart auf /www zeigen (SFTP-Alias != realer FS-Pfad)

- Symptom: Neue Datei-Sync-Sektion zeigte "Keine Dateien gefunden", obwohl die Dateien (tnet/config, core/nls/de) per SFTP nachweislich existieren und world-readable (0775) sind, ohne open_basedir-Restriktion.
- Root-Cause: `FileSyncRepository` nutzte hartkodierte Pfade `/www/maps-dev` bzw. `/www/maps`. Der SFTP-Pfad `/www` ist nur ein Alias (chroot/Home); der reale Dateisystempfad, den PHP zur Laufzeit sieht, ist anders (Daten-Basis liegt z.B. unter /data/Client_Data/nwow/). `is_dir('/www/...')` war daher false.
- Fix: Wurzel zur Laufzeit relativ zum Skript ableiten: `dirname(__DIR__, 4)` (includes→api→tnet→<maps-dev|maps>→www). envRoot = wwwRoot . '/maps-dev' bzw. '/maps'. Funktioniert unabhaengig vom realen Mount. Hinweis: Core-Config ist serverseitig GETEILT unter /www/core (nicht per-Env), nur tnet/config und core/nls/de sind je Umgebungsbaum getrennt.
- Guardrail: Serverseitige Datei-Pfade in PHP immer relativ zu `__DIR__` aufloesen, nie den SFTP-/Deploy-Pfad (/www) hartkodieren — der kann vom realen Dateisystempfad abweichen.

## 2026-06-24 - Sync-Tab: Konfig-Zeit griff auf Import-History statt echte Konfig-Änderung

- Symptom: Trotz neuem Sync und gleicher Revision blieben DEV/PROD-Konfig-Zeitstempel unterschiedlich.
- Root-Cause: Die Status-Abfrage nahm den letzten `catalog_document_history`-Eintrag zur Revision; nach Sync ist das oft `action='import'` mit lokaler Sync-Zeit, nicht die echte Konfig-Änderungszeit.
- Fix: `config_updated_at` filtert History-Einträge jetzt mit `action <> 'import'`; die Sync-Zeit bleibt separat über den letzten `import`-Eintrag sichtbar.
- Guardrail: Wenn Konfig- und Prozesshistorie im selben History-Table liegen, muss die Konfig-Anzeige Prozess-Events explizit ausfiltern.

## 2026-06-24 - Sync-Tab: Konfig-Zeitstempel driftete nach Sync trotz gleicher Revision

- Symptom: Nach DEV↔PROD-Sync zeigte der Sync-Tab bei gleichem Revisionsstand unterschiedliche "Konfig"-Zeitstempel zwischen den Umgebungen.
- Root-Cause: `syncCatalog()` schrieb im Ziel `catalog_document.updated_at = now()` statt den Quellwert zu uebernehmen; dadurch wurde die lokale Sync-Zeit als Konfig-Zeit angezeigt.
- Fix: Beim Katalog-Sync wird `updated_at` jetzt aus der Quelle uebernommen. Die Sync-Zeit wird separat als `import`-Eintrag in `catalog_document_history` erfasst und im Status als eigener Zeitstempel (`sync_updated_at`) geliefert.
- Guardrail: Inhaltszeit (Konfigurationsstand) und Prozesszeit (Synchronisation) nie im selben Feld mischen; Konfig-Zeit beim Copy-Sync immer aus der Quelle uebernehmen.

## 2026-06-24 - SLM Sync: Fullbackup-Button lief ins Leere + granularer Restore

- Symptom: Im Sync-Tab erzeugte „💾 Backup erstellen" scheinbar nichts Brauchbares, und ein Restore stellte nur Bookmarks (in den Editor) wieder her — Katalog/Bundles aus dem Fullbackup waren nicht restaurierbar.
- Root-Cause: `SyncRepository::createFullBackup()` existierte, war aber an KEINE Route in `treebuilder-api.php` angebunden; das Frontend rief `action=sync-fullbackup-create` ins Leere (Default-Case). Zudem behandelte `slmRestoreBackup` Fullbackups wie reine Bookmark-Backups (`restore-bookmark-backup` → nur Bookmarks in den Arbeitsspeicher), obwohl die Datei `{_meta, bookmarks[], catalog[], bundles[]}` enthält.
- Fix: Routen `sync-fullbackup-create`, `sync-fullbackup-read` (Inventar) und `sync-fullbackup-restore` ergänzt; `SyncRepository::fullBackupInventory()` + `restoreFullBackup()` (Merge/UPSERT, keine Löschungen) implementiert. Frontend: granularer Restore-Dialog (Ziel-Env DEV/PROD wählbar, Bereiche Bookmarks/Katalog/Bundles + Element-Auswahl je Profil/Kürzel). Warnhinweis aus der Toolbar entfernt (steht in der Legende).
- Guardrail: Wenn eine Repository-Methode existiert, heisst das nicht, dass sie verdrahtet ist — Frontend-Action immer gegen den Router querprüfen. Backup-Format und Restore-Pfad müssen denselben Umfang abdecken (voll vs. nur-Bookmarks war inkonsistent). Payload-Strukturen: `catalog_document.payload` = Objekt nach lyrmgrKey; Bundle-`payload.files[]` trägt `name`/`type`/`keys`/`data` (Inhalt) → erlaubt Key-Level-Diff/Restore.

## 2026-06-23 - SLM Sync: Revision lief hoch (Rev 622) und "NEU"-Badge blieb nach Sync

- Symptom: Im Sync-Tab zeigte ein Katalog-Profil (`public`) Rev. 622, obwohl real nur wenige Änderungen existierten; nach einem Sync stand weiterhin "NEU" auf einer Seite, statt dass beide Seiten als identisch galten.
- Root-Cause: `SyncRepository::syncCatalog()` setzte im `ON CONFLICT DO UPDATE` `revision = catalog_document.revision + 1` (Ziel-Revision++ statt Quell-Revision übernehmen) → jeder Sync-Lauf erhöhte die Ziel-Revision; nach ~616 Läufen 6 → 622. Gleiches Muster bei `syncBookmarks` (`bookmark_meta.revision + 1`). Dadurch wich die Revision immer um Δ=1 ab → `getSyncNewerSide` (Frontend) fand stets einen Gewinner → Badge blieb. Verschärfend: der DB-Trigger `trg_catalog_document_updated` überschreibt `updated_at` beim UPDATE mit `now()`, weshalb ein reiner Zeitstempel-Vergleich das Ziel fälschlich als "neuer" markiert.
- Fix: (1) Backend übernimmt die Quell-Werte: `revision = EXCLUDED.revision` (Catalog), Quell-`revision`/`updated_at` per `FROM src.bookmark_meta` (Bookmarks), `last_imported_at = EXCLUDED.last_imported_at` (Bundles). (2) Frontend `getSyncNewerSide` vergleicht **Revision zuerst** und gibt bei gleicher Revision `null` zurück (Zeitstempel nur noch Fallback für Bundles ohne Revision). Bestehende Rev 622 in der DB korrigiert sich beim nächsten Sync-Lauf des Profils automatisch.
- Guardrail: Bei einer "Kopie"-Sync-Operation immer die Quell-Versionsfelder (Revision/Timestamp) ins Ziel ÜBERNEHMEN, nie das Ziel inkrementieren. Für "neuer/älter"-Vergleiche die monotone Inhalts-Revision als primäres Kriterium nutzen, nicht den lokalen Schreib-Zeitstempel (DB-Trigger können ihn auf `now()` setzen).

## 2026-06-23 - SLM Sync: Bundle-Dateien fehlten und Schema-Init-Button lief ins Leere

- Symptom: Im Sync-Tab zeigte der Bundle-Bereich nur Kürzel/Metadaten, aber keine enthaltenen Dateien; ausserdem konnte der Banner-Button zur Schema-Initialisierung nie erfolgreich auslösen.
- Root-Cause: Im finalen `renderBundleTable()` wurde `fileRow` nach einem vorzeitigen `return` nie mehr an den HTML-String angehängt. Parallel dazu referenzierte das Frontend `action=sync-schema-init`, während der Router in `treebuilder-api.php` diese Action gar nicht behandelte, obwohl `SyncRepository::initSchema()` bereits existierte.
- Fix: Return-Kette in `slm.html` so korrigiert, dass die zusätzliche Dateizeile pro Bundle tatsächlich gerendert wird. In `treebuilder-api.php` den fehlenden `sync-schema-init`-POST-Route ergänzt und direkt an `SyncRepository::initSchema()` verdrahtet.
- Guardrail: Bei grossen Inline-Skripten nach Merge-/Copy-Paste-Arbeiten auf tote String-Verkettungen nach `return` achten; Frontend-Actions immer gegen den Backend-Router querprüfen, auch wenn die Repository-Methode bereits vorhanden ist.

## 2026-06-21 - Basemap-Wechsel (Orthofoto) verlor Massstab/Ausschnitt

- Symptom: Beim Wechsel auf Orthofoto (swissimage) zoomte die Karte unerwartet weit heraus (teils Fit auf die ganze Schweiz, "sehr kleiner Massstab"). Massstab und Ausschnitt sollten stabil bleiben.
- Root-Cause: Das Framework `_preTimeChangeBaseMap` (Original-`changeBaseMap`) ERSETZT die OpenLayers-View (neues View-Objekt). Dabei geht die aktuelle Resolution/Zoom verloren bzw. wird auf einen Default/Fit gesetzt. Reproduzierte sich timing-/geraeteabhaengig (im Playwright-Emulator nicht, auf dem realen Geraet schon). tnet-basemap.js selbst aenderte die View nicht.
- Fix: Im `changeBaseMap`-Hook (tnet-basemap.js) Center + Resolution VOR dem Wechsel merken und nach dem View-Ersatz per `_restoreViewState()` wiederherstellen — auf die neue View geklemmt (`getMinResolution`/`getMaxResolution`). Reassert an drei Punkten: synchron direkt nach `_preTimeChangeBaseMap`, im bestehenden 200ms-`updateSize`-Block und zusaetzlich bei 700ms (gegen verspaeteten asynchronen Fit nach Tile-/Capabilities-Load). Verifiziert: Normalzoom (res 2) bleibt exakt; Tiefzoom (res 0.05) klemmt zentriert auf Ortho-minRes 0.1 (gleicher Mittelpunkt) statt wegzuspringen.
- Guardrail: Basemap-Wechsel im Framework ersetzt die View — danach IMMER Center + Resolution explizit zuruecksetzen (geklemmt auf die neue View), wenn Massstab/Ausschnitt stabil bleiben sollen. Mehrere Reassert-Zeitpunkte einplanen, weil der Framework-Fit synchron ODER verspaetet (async Tile-Load) erfolgen kann.

## 2026-06-20 - Mobile: Info-Abfrage liefert nie Resultate (Coalesce-Bridge nicht geladen)

- Symptom: Auf dem Mobile-Client oeffnete ein Kartenklick zwar das Info-Panel, zeigte aber immer "Keine Objekte gefunden" (0 Identify-/query-Requests), insbesondere fuer OEREB-/Coalesce-Layer (Nutzungsplanung, Gewaesserraum). Desktop funktionierte.
- Root-Cause: `tnet/js/tnet-coalesce-bridge.js` war in index_de_m.htm GAR NICHT eingebunden (Desktop laedt es, Mobile nicht). Ohne die Bridge ist `window.TnetCoalesceBridge` undefined → die Coalesce-Sublayer (OEREB/Gewaesserraum) rendern KEINEN kombinierten OL-Layer auf der Karte. Die Info-Bridge (`_getDirectMapTipsForActiveContent` / Skip-Guard) findet daher fuer die aktiven Maptips keinen OL-Host (`mt.wms_layer` bleibt leer, `getLayerByMap()._lyr` ist null) → alle Maptips werden uebersprungen → 0 Queries. Zusaetzlich fehlte `tnet-wms-panel.js` (liefert `_queryCustomLayersForBridge` fuer WMS/ArcGIS-GetFeatureInfo).
- Fix: In index_de_m.htm die zwei Desktop-Skripte ergaenzt — `tnet-coalesce-bridge.js` VOR `tnet-lm-store.js` (defer) und `tnet-wms-panel.js` VOR `tnet-info-bridge.js`. Damit rendert der kombinierte Coalesce-OL-Layer (Name = Dienst-Pfad, z.B. `gis_oereb/nw_nutzungsplanung_def`) und die Root-Level-Maptips matchen ihn per `_findMapTipLayer` exakt. Verifiziert: 2 Identify-Requests (MapServer/5,9/query) feuern, echtes Resultat (Gefahrenzone 3) wird angezeigt; vorher 0 Requests.
- Guardrail: Mobile (index_de_m.htm) und Desktop (index_de.htm) muessen DIESELBE Info-/Layer-Skriptkette laden. Bei "Info-Abfrage liefert nichts auf Mobile" zuerst pruefen, ob `window.TnetCoalesceBridge` und `tnet-wms-panel.js` existieren — fehlende Bridges machen Coalesce-Layer unsichtbar UND nicht abfragbar. Sublayer-Maptips (z.B. `.../grundnutzung`) matchen den kombinierten OL-Layer nur, wenn ein Root-Level-Maptip (linked_layer = Dienst-Pfad) mit gleicher query_layers-Nummer existiert.

## 2026-06-20 - Mobile: Bookmark-Layer werden nicht aktiviert (deselectAll-Crash)

- Symptom: Auf dem Mobile-Client laedt ein Bookmark (z.B. /maps-dev/gew) die Layer NICHT auf die Karte (active=[], leere Karte), obwohl das Karteninhalt-Panel die Themen korrekt anzeigt (eigene Bookmark-API).
- Root-Cause: Framework-Core `njs.LayerMgr.ClassicLayerCategory.deselectAll()` (mapplus-lib, shared) greift auf `_chk.domNode` eines dijit-Checkbox-Widgets zu. Auf Mobile existieren diese Checkboxen NICHT (kein klassischer Layer-Manager) -> `_chk` undefined -> TypeError "Cannot read properties of undefined (reading 'domNode')". Der Crash bricht TnetSetBookmark -> setMapBookmark -> deselectAll ab, sodass die Bookmark-Layer nie aktiviert werden. Auf Desktop existieren die Checkboxen -> kein Crash.
- Fix: NICHT den shared Core anfassen. Neues `maps-dev/tnet/js/tnet-framework-guards.js` patcht `deselectAll` zur Laufzeit defensiv (Guard `if (_chk && _chk.domNode)`), eingebunden in index_de_m.htm vor dem Bookmark-Auto-Start. Verifiziert: gew-Bookmark aktiviert mobil alle 3 Layer; on/off + add/remove sauber.
- Guardrail: Mobile nutzt denselben Store/Helpers wie Desktop, aber das Framework rendert KEINE dijit-Checkbox-Widgets. Core-Methoden, die UI-Widget-domNodes voraussetzen (deselectAll, selectAll, disableAll), koennen mobil crashen -> bei Bedarf per Laufzeit-Guard in tnet-framework-guards.js defensiv machen, statt mapplus-lib zu aendern.

## 2026-06-19 - Flache Layer wurden faelschlich kombiniert + Opacity-Cross-Talk durch reconcile

- Symptom: Mehrere flache Dienste unter gleichem Kategorie-Praefix (z.B. gis_fach/nw_verkehrsrichtplan, gis_fach/nw_strassenverzeichnis): beim Aktivieren wurden manche unsichtbar (Ein/Aus unrobust), und das Verstellen EINES Opacity-Sliders setzte die anderen auf den Default zurueck.
- Root-Cause 1 (Ein/Aus): `_setFrameworkCombinedSublayer` und `reconcileMapConsistency` gruppierten Sublayer nach ID-Praefix `id.substring(0, lastIndexOf('/'))`. Bei flachen IDs `kategorie/dienst` ist das die KATEGORIE (`gis_fach/`), nicht der Dienst. Verschiedene Dienste wurden so als Sublayer EINES Dienstes behandelt → ein renderLayer gewaehlt, die anderen versteckt.
- Root-Cause 2 (Opacity-Cross-Talk): `reconcileMapConsistency` erzwang die OL-Opacity aus der Katalog-Opacity (`layer.opacity`). Diese war fuer URL-geladene Layer veraltet (Config-Default 0.65, weil `_applyUrlOverrideOpacity` die Katalog-Opacity nach dem Anwenden zuruecksetzte). Jede reconcile-Runde (durch jede Opacity-Aenderung getriggert) setzte daher die Opacity ANDERER Layer auf 0.65 zurueck.
- Fix: (a) Kombination nur bei ECHTEM Mehr-Sublayer-Dienst: Guard `_hasActiveSiblingSameService(layer)` prueft, ob ein anderer aktiver Layer dieselbe Service-URL (`layer.url`) hat. Flache Layer (eindeutige URL) werden ausgenommen → eigener OL-Layer, eigene Sichtbarkeit/Opacity. (b) `reconcileMapConsistency` erzwingt die Opacity NICHT mehr (nur Sichtbarkeit/Existenz/Z-Order) — Opacity ist autoritativ ueber setLayerOpacity + URL-Load. (c) `_applyUrlOverrideOpacity` persistiert die URL-Opacity jetzt in den Store (kein Restore mehr).
- Guardrail: Dienst-Identitaet IMMER ueber die Service-URL bestimmen, NICHT ueber das ID-Praefix (das kann eine blosse Kategorie sein). reconcile darf Laufzeit-Werte (Opacity) nicht aus potenziell veralteten Store-Defaults ueberschreiben.

## 2026-06-19 - Geaenderte Layer-Opacity ueberlebte keinen Reload (URL op=)

- Symptom: Per Slider geaenderte Transparenz ging nach Reload verloren; URL op= zeigte die Config-Default-Opacity (0.65 -> gerundet 0.7) statt des Laufzeitwerts.
- Root-Cause: Der Framework-Writer `updateMapStatusUrl` baut op= aus `curr_lays[lay].opacity` (njs-Layer-Wrapper-Property, via getVisibleLayersByMap). TNET `setLayerOpacity` setzte aber nur die OL-Layer-Opacity + Store-Eintraege, NICHT den njs-Wrapper -> Framework schrieb weiter den Default.
- Fix: In `setLayerOpacity` Helper `_syncFrameworkOpacity(layerId, opacity)`: njs-Wrapper in allen LyrMgr via getLayerById finden und `.opacity` nachziehen; danach entprellt (400ms) `updateMapStatusUrl('main')` aufrufen, gegated auf `Tools.TrackBookmark` (Muster aus tnet-lyrmgr-patch.js notifyAfterLayerChange). Read-Pfad (Reload) funktionierte bereits: ClassicLayerMgr.switchLayersProgr liest op= und setzt `_lyr.opacity` + `_lyr.setOpacity`.
- Guardrail: Es gibt ZWEI Layer-Opacity-Modelle (njs-Wrapper `.opacity` UND OL `getOpacity`) plus zwei URL-Writer (Framework updateMapStatusUrl bei mode 'none'; TNET _updateBookmarkUrlMode bei Bookmark). Opacity-Aenderungen muessen den njs-Wrapper mitziehen, sonst landet der Config-Default in op=. Framework rundet op= auf 1 Dezimalstelle.

## 2026-06-19 - Unabhaengige Opacity pro Sublayer (kombinierter ArcGIS-Dienst)

- Symptom: Beim Basisplan-Dienst (gis_basis/nw_basisplan_gis_dynamisch) aenderte der Opacity-Slider eines Overlays (z.B. Gemeindegrenzen) auch die Transparenz der Geschwister (Hoehenkurven/Projektebene).
- Root-Cause: NICHT das Framework, sondern TNET-Store-Code fasst mehrere aktive Sublayer desselben Dienst-Praefixes in EINEN OL-Layer (LAYERS=show:0,21,51) mit EINER Opacity zusammen. Es gibt ZWEI Combiner: (1) `_setFrameworkCombinedSublayer`/`_rebuildCombinedShow` (beim Toggle), (2) `reconcileMapConsistency` (Nachlauf-Konsolidierung, baut ebenfalls show:-Liste und versteckt die uebrigen OL-Layer). Das Framework selbst erzeugt pro Layer-Def einen EIGENEN `_lyr` und unterstuetzt native Per-Layer-Opacity (URL op=a|b|c).
- Fehlversuch: ArcGIS `dynamicLayers` (per-Sublayer transparency in EINEM Request) wirkt NICHT, weil die Framework-ArcGIS-Source beim Request-Bau nur `LAYERS` liest und `dynamicLayers` ignoriert (Params werden gesetzt, landen aber nie in der Export-URL).
- Fix: Beide Combiner fuer konfigurierte Dienste ueberspringen. Helper `_isIndependentOpacityLayer(layerId)` (liest `window.__tnetIndependentOpacityServices` aus config `basemapOverlays.independentOpacityServices`). In `_setFrameworkCombinedSublayer` frueh `return false`; in `reconcileMapConsistency` die Kombinations-Branch-Bedingung um `&& !self._isIndependentOpacityLayer(layer.id)` ergaenzen. Dadurch laedt jedes Overlay via TnetLayerSwitch als EIGENER OL-Layer (eigenes show:N) und `setLayerOpacity` setzt die Opacity auf dem eigenen OL-Layer → native, unabhaengige Opacity. Kein dynamicLayers, keine Source-Wrapping noetig.
- Guardrail: Bei "geteilte Opacity trotz getrennter Slider" zuerst pruefen, WER kombiniert (oft TNET-Store, nicht das Framework). Mehrere Combiner-Pfade beachten (Toggle UND reconcile). Generisch ueber config-Liste steuern, nicht hartkodieren.

## 2026-06-19 - Andocken der Objektinfo verschob Karteninhalt/Pin ruckartig (inkl. Flicker beim Resize)

- Symptom: Beim Oeffnen/Schliessen/Resizen des angedockten Info-Panels staucht/springt der Karteninhalt: erst verschoben, dann zurueck; beim Live-Resize flackert es.
- Root-Cause: (1) OL-Canvas ist `width:100%` → bei mapContainer-Verschmaelerung staucht das Canvas SOFORT, das verzoegerte `updateSize()` (setTimeout 350ms) rendert erst danach scharf nach (= sichtbares Stauchen + Korrektur). (2) `updateSize()` haelt den geografischen Mittelpunkt fix → Recenter-Sprung; ein nachgelagertes `centerOn` korrigiert (= zweiter Sprung). (3) Schliessen/Observer-Pfade hatten keinen Anker.
- Fix: Synchroner Helper `applyMapResizeStatic(anchorCoord, pinCoord, withDijit)` (tnet-info-panel.js): laeuft im SELBEN Task wie die Breitenaenderung (kein setTimeout) und setzt das Zielzentrum via `view.centerOn(anchor, newSize, [0, h/2])` VOR `updateSize()` → OL rendert genau EINMAL scharf, linke Kante stationaer. Angewandt auf ALLE Pfade: Dock, Undock, Close-Button, Observer-Reposition (StreetView/Window) und Live-Resize (rAF-gedrosselt, Anker beim Drag-Start). Pin-Recenter (`view.animate`, smooth pan) wenn der Pin verdeckt ODER sehr nah am Panel-Rand ist (Komfort-`marginRight`=120px). WICHTIG: Anker-`centerOn` NICHT anwenden waehrend `view.getAnimating()` — sonst bricht der Observer-Trigger die laufende Pin-Pan-Animation ab. Verifiziert: Andocken/Schliessen Delta 0 px; Live-Resize linke Kante fix; Pin nah am Panel → smooth zentriert (distRight 27 → 275px).
- Guardrail: Karten-Resize (width:100%-Canvas) IMMER synchron im selben Task wie die DOM-Breitenaenderung ausfuehren (kein setTimeout) und Zielzentrum VOR `updateSize()` setzen — sonst staucht das Canvas und es entsteht ein Zwei-Schritt-Sprung. Bei Live-Drag pro rAF einen verankerten `updateSize` rendern. Laufende View-Animationen (Pin-Pan) nicht durch Observer-getriggerte Re-Anker abbrechen (`getAnimating()`-Guard).

## 2026-06-19 - Objektinfo oeffnete gelegentlich floating statt angedockt

- Symptom: Nach Kartenwechsel oder laengerem Arbeiten oeffnete die Objektinfo bei einer Infoabfrage manchmal floating, obwohl `defaultDockedRight: true` gesetzt ist.
- Root-Cause: Das Auto-Docking in tnet-info-panel-default-dock.js haengte an EINEM `MutationObserver` plus der Hidden->Visible-Transition. Wird die Transition verpasst (Panel ohne beobachtete Transition sichtbar) ODER der Panel-Knoten `njs_info_pane` beim Kartenwechsel neu erzeugt, beobachtet der Observer einen toten Knoten → `toggleInfoPaneDock` wird nie aufgerufen → floating. Config-Timing war NICHT die Ursache (synchron via sync-XHR in tnet-log.js).
- Fix: Observer wird bei geaendertem Panel-Knoten neu angebunden (`observedPane`-Vergleich); Safety-Enforcer (Intervall 300ms) erzwingt Andocken bei sichtbar+`!docked-right`, solange der Nutzer nicht in dieser Sitzung bewusst abgedockt hat (`userManuallyUndocked`, beim Ausblenden zurueckgesetzt). Dock-Button-Label in enhanceInfoPane am aktuellen Dock-Status ausgerichtet (Auto-Dock kann vor Button-Erzeugung andocken).
- Guardrail: Einmalige MutationObserver auf potenziell neu erzeugte Framework-Knoten sind unzuverlaessig — Knoten-Identitaet pruefen und neu anbinden, plus idempotenten Safety-Enforcer als Netz. Erzwungene UI-Defaults muessen bewusste Nutzer-Aktionen (manuelles Abdocken) innerhalb der Sitzung respektieren.

## 2026-06-19 - Angedockte Panels ueberlappten den grueneren Karten-Footer, Info-Breite liess sich nicht stabil ziehen

- Symptom: Rechts angedockte Panels (Info, OEREB/Print/WMS) konnten in den Footer laufen; bei der Info war Dock-Breite per linkem Handle inkonsistent.
- Root-Cause: Dock-Bottom wurde aus `centerPaneLayout` abgeleitet und ignorierte den realen `#map-footer-bar`; im Info-Resize wurde `mapContainer` mit `calc(100% - width)` statt absoluter Breitenberechnung synchronisiert und `_savedDockedPanelWidth` nicht verlaesslich fortgeschrieben.
- Fix: Gemeinsame Dock-Metriken (Top/StreetView/Footer-Offset) in den Panel-Skripten eingefuehrt; Bottom-Offset auf `max(centerPaneRest, footerHeight)` gesetzt; Info-Resize speichert Dock-Breite jetzt sauber und synchronisiert `mapContainer` via Pixelbreite.
- Guardrail: Bei rechts angedockten Panels Bottom nie hart setzen oder nur aus Container-Rect ableiten; immer den tatsaechlichen Footer-Offset beruecksichtigen und Panel-/Map-Breiten mit denselben absoluten Metriken rechnen.

## 2026-06-19 - Bookmark-URL-Modus: Bookmark-ID im Pfad XOR layers= in Query

- Anforderung: Bei Layer-Anpassung den Stand in der URL festhalten und den Bookmark aus der URL entfernen; bei Reset/View-Reset die Layer raus und nur den Bookmark in der URL. Ziel: Reload entscheidet eindeutig (Bookmark neu laden ODER modifizierten Stand wiederherstellen).
- Umsetzung: Zentraler Controller `_updateBookmarkUrlMode()` in tnet-lm-active.js setzt `window.__tnetBookmarkUrlMode` ('pristine'|'layers'|'none') und schreibt Pfad+Query um. Trigger: tnet-bookmark-loaded (pristine), tnet-bookmark-state-changed (→layers bei Edit), bm-reset (pristine). Bookmark-ID = letztes Pfadsegment `/maps(-dev)?/<id>`; bei 'layers' wird das Segment entfernt (`/maps-dev/`) und `layers=` aus `store.getActiveLayers()` gesetzt; bei 'pristine' Segment gesetzt und `layers=`/`op=` entfernt.
- Chokepoint: Der Store-replaceState-Interceptor (`_installWmsUrlGuard`, tnet-lm-store.js) strippt im 'pristine'-Modus `layers=`/`op=` aus JEDEM Write \u2014 so koennen die vielen layers=-Writer (Framework updateMapStatusUrl, _syncAllWmsLayersInUrl, Coalesce-Bridge) den pristine-Zustand nicht ueberschreiben. Coalesce-Bridge `_fixUrlForBridgeLayers`/`_injectDirectWmsLayersIntoUrl` zusaetzlich pristine-gated.
- Verifiziert (Browser): pristine-Load `/maps-dev/gew` ohne layers/op; Edit \u2192 `/maps-dev/?...&layers=...`; Reset \u2192 zurueck zu `/maps-dev/gew` ohne layers; Reload-modified haelt Layer ohne Bookmark-Reapply.
- Guardrail: Bei mehreren konkurrierenden URL-Writern die Modus-Durchsetzung an EINEM Chokepoint (replaceState-Interceptor) zentralisieren statt jeden Writer einzeln zu gaten. Offen: Opacity-Wert (op=) im modifizierten Zustand wird nicht exakt persistiert (separater op=-Mechanismus).
- Mixed-URL (Bookmark-ID im Pfad UND layers=, z.B. alter Kundenlink): Bookmark gewinnt. layers=/op= muessen GANZ FRUEH (tnet-app.js Parse-Zeit, vor Framework-ensureUrlLayers/Bridge-_originalUrlLayers-Capture) gestrippt werden \u2014 ein spaeter Strip entfernt zwar den URL-Param, der Fremd-Layer wurde aber bereits verarbeitet/in den Store aufgenommen. Verifiziert: Fremd-Layer erscheint nicht mehr.
- View: `view=`-Query-Param wird vom bestehenden View-URL-Guard (_stripOrSetView/_setActiveViewForUrl in tnet-mapplus-helpers.js, window.__tnetActiveViewForUrl) autoritativ gesetzt/gestrippt. pristine-Strip betrifft nur layers=/op= \u2192 view= bleibt erhalten wenn ein Nicht-Default-View aktiv ist.

## 2026-06-19 - Falsches "Bookmark wurde verändert" / "Ansicht zurücksetzen" direkt nach Laden

- Symptom: Direkt nach dem Bookmark-Load erschien "✱ Bookmark wurde verändert" + "Ansicht zurücksetzen", obwohl der Nutzer nichts geändert hatte.
- Root-Cause: Beim (verzoegerten) Coalesce-/Framework-Layer-Aufbau feuert der Store spaet `layer-opacity`-Events, die nur den API-konfigurierten Wert (z.B. opacity 0.65) anwenden. `_onOpacity`/`_onCoalesceGroupOpacity` (tnet-lm-active.js) pruefen \u2014 anders als `_onVisibility` \u2014 nur `_bmLoadedRecently` (Schonfrist ~3.5s laengst abgelaufen) und werteten jedes `changed` als Nutzer-Edit \u2192 `_bmModified = true`.
- Fix: Helfer `_opacityMatchesBaseline(layerId, opacity)` vergleicht gegen den Reset-Snapshot bzw. die Katalog-/API-Opacity (`node.options.opacity`). `_onOpacity`/`_onCoalesceGroupOpacity` setzen `_bmModified` nur noch, wenn die Opacity vom Baseline ABWEICHT und `!_isBookmarkLoadActive() && !_isViewSwitchActive()`. Verifiziert: 0 spuriose Events nach Load, Reset-Button weg; echte Opacity-Aenderung (0.65\u21920.30) weiterhin korrekt als modified erkannt.
- Guardrail: Programmatische Anwendung API-konfigurierter Werte (Opacity/Sichtbarkeit) NIE als Nutzer-Edit werten \u2014 immer gegen den konfigurierten Baseline (API/Snapshot) pruefen, nicht gegen den transienten Vorwert. Die API liefert die Soll-Opacity je Sublayer bereits mit.

## 2026-06-19 - Startup-Freeze ~13s: findLayer machte rekursiven Katalog-Walk pro Lookup

- Symptom: Nach Laden eines Bookmarks fror die App mehrere Sekunden ein (kein Pan/Zoom); Karte spaet bereit.
- Root-Cause: `TnetLMStore.findLayer()` rief `_findLayerRecursive` (voller rekursiver Katalog-Walk) pro Aufruf. `TnetSyncMapTips` (tnet-mapplus-helpers.js) ruft das pro MapTip x Pfadsegment x 4 Kandidaten x mehreren Sync-Runs → CPU-Profiler: `_findLayerRecursive` 8-9s + case-insensitive `walk` (findLayerRobust) 4.7-5s = ~13s Main-Thread-Block.
- Fix: In tnet-lm-store.js vollstaendiger Knotenindex `_catalogLayerNodeIndex` (alle Knoten, Leaf-Vorrang via `_catalogLayerNodeLeaf`) + `_catalogLayerNodeIndexLower`; `findLayer` O(1), bei `_loaded` Index-Miss => null OHNE Walk (Index ist vollstaendig, da `_catalog` nur an 2 Stellen gesetzt + `_initCoalesceInfo` direkt danach indexiert); neue `findLayerCI()`. In tnet-mapplus-helpers.js `findLayerRobust` den case-insensitive Walk durch `store.findLayerCI()` ersetzt. Verifiziert per CPU-Profiler: Hotspots weg, laengster Long-Task <600ms.
- Guardrail: Heisse, wiederholte Katalog-Lookups immer ueber einen beim Load gebauten Index (O(1)) loesen, nie pro Aufruf rekursiv traversieren. Vollstaendigen Index fuer schnelle Negativ-Antworten nutzen.

## 2026-06-19 - Coalesce-Layer (Gewässerraum) rendert nach Bookmark-Load nicht (Startup-Race)

- Symptom: Nach Bookmark-Load fuehrt der Store den Coalesce-Layer als sichtbar, aber kein OL-Layer auf der Karte → Layer rendert nicht (intermittierend; durch schnelleren Startup nach dem findLayer-Fix verstaerkt). Manuelles TnetLayerSwitch off->on erstellte ihn.
- Root-Cause: `restoreFromUrl` erstellt den OL-Layer nur wenn `!layer.visible`; bei sauberer Bookmark-URL ist `_originalUrlLayers` leer (kein layers=-Param) → restoreFromUrl no-op. Der Bookmark-Apply-Pfad erstellt den OL-Layer nicht zuverlaessig (Framework noch nicht bereit → `_createRootOLLayer` minResolution).
- Fix: tnet-coalesce-bridge.js `_reconcileActiveCoalesceGroups()` — iteriert `store.getActiveLayers()`, ruft fuer aktive Coalesce-Sublayer ohne OL-Layer `store._forceCoalesceGroupRender(groupId)` (bewaehrter Render-Pfad mit registerSublayer-Retries). Trigger: `tnet-bookmark-loaded` + `tnet-app-ready` mit Retries (0/800/2500ms). Idempotent (agiert nur bei fehlendem OL-Layer → kein Event-Loop). Verifiziert: Gewässerraum rendert.
- Guardrail: Store ist Single Source of Truth — nach Bookmark/URL-Restore die Bridge gegen `getActiveLayers()` reconcilen, nicht auf einen einzelnen Trigger-Pfad verlassen.

## 2026-06-19 - Gewässerraum/Coalesce-Layer fielen aus layers=-URL (Framework updateMapStatusUrl)

- Symptom: Nach Bookmark-Laden/Reload (z.B. /maps-dev/gew) verschwand der Gewässerraum aus der `layers=`-URL und wurde nicht dargestellt; intermittierend.
- Root-Cause: Framework `njs.AppManager.updateMapStatusUrl` (appmanager.js) schreibt bei jedem moveend/loadend `layers=` mit seiner eigenen (leeren) Layer-Sicht. Der Post-Fix `_fixUrlForBridgeLayers` stellte aktive Sublayer nur aus dem transienten Bridge-State `_rootServices.visibleSublayers` wieder her; `_injectDirectWmsLayersIntoUrl` ergänzte nur Nicht-ArcGIS-Layer. ArcGIS-Coalesce-Layer (Gewässerraum) wurden daher waehrend der ADD->REMOVE->ADD-Race nicht wiederhergestellt.
- Fix: In `_fixUrlForBridgeLayers` zusaetzlich gegen `TnetLMStore.getActiveLayers()` (autoritative Quelle) abgleichen — alle sichtbaren Store-Active-Layer werden in die URL-Wiederherstellung aufgenommen. Verifiziert per Browser: finaler URL-Zustand ist nun immer vollstaendig.
- Guardrail: Die `layers=`-URL muss aus dem Store (Single Source of Truth) rekonstruiert werden, nie nur aus transientem Bridge-/Framework-State. Bei DEV-Tests Browser-Cache beachten (statischer `?v=`-Param → Hard-Reload noetig, sonst laeuft alter JS-Stand).

## 2026-06-19 - Info-Abfrage (ÖREB) blockierte UI mehrere Sekunden — redundante Traversierungen pro Klick

- Symptom: Nach Kartenklick mit mehreren aktiven ÖREB-Layern fror Pan/Zoom mehrere Sekunden ein, bis sich die Info-Abfrage aufbaute.
- Root-Cause: `_getServiceShowList` (Walk über alle Karten-Layer) und `_findLayerRobust` (Katalog-Walk) wurden in `tnet-info-bridge.js` pro Klick dutzendfach für dieselben IDs neu berechnet (`_syncMapTipsBeforeDispatch`, `_getDirectMapTipsForActiveContent`, `_adapterMapPlus`).
- Fix: Pro-Klick-Cache `_clickCache` (in `_resetClickCache` zu Beginn von `_handleClick` gesetzt) memoisiert beide Lookups; Karten-/Katalogzustand ist während des synchronen Handlers konstant.
- Guardrail: Read-only-Traversierungen, die pro Klick mehrfach mit identischen Argumenten laufen, immer pro Klick memoisieren statt Verhalten/Netzwerklogik zu ändern.

## 2026-06-18 - Import-User darf nicht an DB-Schema-Rechten scheitern

- Symptom: Nach neuem Import wurde `imported_at` aktualisiert, aber `imported_by` blieb leer (`-`).
- Root-Cause: In einigen Umgebungen fehlt/spinnt die DB-Spalte `imported_by` (oder Schreibrechte), dadurch landet der Import-User nicht in `ags_import_history`.
- Fix: API speichert den Import-User zusätzlich dateibasiert in `tmp/layertree/ags-import-actors.json` und merged ihn in `ags-import-meta`, wenn DB `imported_by` leer ist.
- Guardrail: Audit-kritische Felder (wer importiert hat) nicht nur an optionale DB-Schemafelder koppeln; robusten Fallback mitführen.

## 2026-06-18 - Create-Tab Importiert-Spalte: lokale Zeit und Import-Benutzer sichtbar machen

- Symptom: In der Spalte `Importiert` war nur ein Zeitwert sichtbar; wer importiert hat, blieb für Nutzer unklar.
- Root-Cause: Anzeige nutzte nur einen flachen Textwert ohne klare Benutzerzeile; Zeitformatierung war kein expliziter Localtime-Render.
- Fix: Zeitstempel werden via `Date` lokal formatiert (`YYYY-MM-DD HH:mm`), und die Importiert-Spalte rendert Benutzer als zweite Zeile (`imported_by`), mit Fallback `unbekannt`.
- Guardrail: Audit-relevante Spalten immer mit klar getrennten Feldern für Zeitpunkt und Benutzer darstellen; Zeitwerte explizit lokal formatieren.

## 2026-06-18 - Create-Tab: Roh-Konfig-Button braucht event-delegierte Checkbox-Synchronisation

- Symptom: Im Create-Tab blieb `Roh-Konfiguration erzeugen` ausgegraut, obwohl Dienste angehakt waren.
- Root-Cause: Der Aktivierungszustand hing an Klick-Handlern pro Tabellenzeile/Checkbox; je nach Ziel-Element (Input/Label) wurde `updateImportSelCount()` nicht zuverlässig ausgelöst.
- Fix: Checkbox-Click aktualisiert den Selektionszähler immer direkt, und zusätzlich synchronisiert ein `change`-Delegationshandler auf `#import-list` den Buttonzustand robust.
- Guardrail: Bei dynamisch gerenderten Tabellen mit Checkboxen den Buttonzustand immer zusätzlich über Event-Delegation (`change` auf Container) absichern.

## 2026-06-18 Sync-Tab Bundle-Dateien

- Symptom: Im Sync-Tab erschienen bei Config-Bundles nur Kürzel und Metadaten, aber keine enthaltenen synchronisierbaren Dateien.
- Root-Cause: Der Sync-Status aus SyncRepository lieferte für config_bundle_store nur Bundle-Metadaten und blendete payload.files vollständig aus.
- Fix: Bundle-Status erweitert um normalisierte Dateilisten aus payload.files und den aktiven Sync-Renderer so ergänzt, dass diese Dateien pro Kürzel direkt angezeigt werden.
- Guardrail: Wenn die UI synchronisierbare Bundle-Inhalte anzeigen soll, muss der Status-Endpoint immer sowohl die Bundle-Ebene als auch die enthaltenen Dateien liefern.
## 2026-06-18 - API-Tree-Knoten sind ALLE Service-Layer, nicht die dargestellten -> Reset/Modified Flag-basiert lassen

- **Symptom:** Nach Einbau einer API-"Baseline" (_apiOriginalState aus allen tree-Knoten): Reorder zeigte ploetzlich 108 statt 29 Layer + Opacity 100%; Opacity-Aenderungen liessen den Verwerfen-Button verschwinden; View-Switch zeigte faelschlich "veraendert".
- **Root-Cause:** Die getBookmarkV2 tree-Knoten enthalten ALLE Service-Layer eines Bookmarks (~53), nicht nur die dargestellten (~29). Reset aktivierte via setLayerEye alle -> Store-Aufblaehung -> mergeBookmarkLayers Live-Extras -> 108. Die API-Baseline war zudem nicht view-aware -> View-Switch falsch-positiv.
- **Fix:** API-Baseline-Vergleich (_isModifiedVsApiBaseline/_apiOriginalState) entfernt. Modified-Erkennung wieder primaer ueber das _bmModified-Flag (wird von Reorder/Visibility/Opacity/Coalesce zuverlaessig gesetzt, bei Load/View-Switch/Reset auf false). Reset wieder ueber TnetResetActiveBookmarkState (View-Switch-Mechanik: nur dargestellte Layer). View-Switch verwirft zusaetzlich den Alt-Snapshot (neue Ansicht = neue Referenz).
- **Guardrail:** getBookmarkV2 tree != dargestellte Layer. Fuer Modified/Reset NIE ueber alle API-Knoten iterieren. Das Flag + die view-aware Default-Logik sind die robuste Quelle; API-Daten nur fuer Anzeige (Namen/Legende/Reihenfolge/Opacity-Default), nicht als State-Baseline.

## 2026-06-18 - OEREB-Bookmark-Metadaten kommen aus StagingImportRepository, NICHT layer_definition

- **Symptom:** Bookmark-API lieferte fuer OEREB opacity:null + keine legendLink, obwohl der Karteninhalt 65% + Legende zeigte.
- **Root-Cause:** loadProfileLayerMeta jointe layer_definition ueber die Bookmark-Layer-ID. OEREB-IDs (gis_oereb/...) sind dort nicht; sie werden in layers.php ueber die lyrmgr-Coalesce-Struktur konstruiert. Die echte Quelle ist config_bundle_store (StagingImportRepository): 'layers'-Bundle (.conf) -> options.opacity/type/url, 'legendResources'-Bundle (.json) -> <id>_title/<id>_link. Genau das nutzt auch layers.php und loadProfileLayerNames.
- **Fix:** loadProfileLayerMeta auf StagingImportRepository::loadAllSafe() umgestellt (gleiches Scope-Ranking + Profil-Filter wie loadProfileLayerNames). Danach liefert die API fuer ALLE 53 OEREB-Knoten opacity+legendLink+layerType. Single-Source, kein Spezialfall.
- **Guardrail:** Fuer dienst-/coalesce-basierte Bookmark-IDs ist config_bundle_store (raw-conf Bundles) die autoritative Metadaten-Quelle, nicht layer_definition. Bei API-Datenluecken zuerst pruefen, ob die ID ueberhaupt in der abgefragten Tabelle existiert.
- **Tool-Hinweis:** fetch_webpage cacht API-Antworten aggressiv; zur API-Verifikation ein Python-urllib-Script nutzen (zeigte korrekte Daten, waehrend fetch_webpage die alte Version zeigte).

## 2026-06-18 - Bookmark-Reset: TnetSetBookmark (gleiche View) ist der falsche Pfad - View-Switch-Mechanik nutzen

- **Symptom:** "Aenderungen verwerfen" dauerte lange, Button blieb teils stehen, Zustand nicht sauber zurueckgesetzt. Nur View-Wechsel + zurueck raeumte auf.
- **Root-Cause:** Reset rief TnetSetBookmark(bm.id, SAME_view). Dessen Fast-Path greift nur bei View-WECHSEL; bei gleicher View laeuft der volle API-Pfad (getBookmark + bis 8s _waitForFrameworkBookmarkReady) und _applyBookmark setzt Reihenfolge/z-index nicht zuverlaessig zurueck.
- **Fix:** bm-reset nutzt jetzt TnetResetActiveBookmarkState() -> _applyViewSwitchOnly: baut Layer synchron aus der Config (loadActiveLayersFromBookmark + reconcileMapConsistency), schnell + sauber. Danach _applyApiOrderToBookmark fuer DB-Reihenfolge. TnetSetBookmark nur noch Fallback.
- **Guardrail:** Fuer 'auf Original zuruecksetzen' bei GLEICHER View den synchronen Config-View-Switch nutzen, nicht den vollen API-Reload (der ist fuer View-WECHSEL/Bookmark-WECHSEL gedacht).

## 2026-06-18 - Karteninhalt Single-Source: layer_definition kennt OEREB-Bookmark-IDs nicht

- **Symptom:** Erweiterte Bookmark-API (loadProfileLayerMeta) liefert fuer OEREB-Bookmark weiterhin opacity:null und keine legendLink/layerType/url.
- **Root-Cause:** Die Query joint catalog_node + layer_definition ueber die Bookmark-Layer-ID (z.B. gis_oereb/nw_kulturobjekte_def/...). Diese OEREB-spezifischen IDs existieren NICHT in layer_definition (dort stehen die Katalog-/Fach-IDs). Die NLS-Namen funktionieren nur, weil loadProfileLayerNames sie ueber StagingImportRepository (lyrmgrResources, desc_<id>) zieht - eine andere Quelle.
- **Fix:** Backend + Frontend-Overlay sind korrekt implementiert und greifen fuer Bookmarks mit Standard-Katalog-IDs. Fuer OEREB-IDs bleibt der Store-Katalog-Fallback (Legende erscheint weiter). Vollstaendige Single-Source fuer OEREB braeuchte legendResources/Meta ueber StagingImport (wie die Namen) ODER ID-Mapping (coalesce) in der API.
- **Guardrail:** Vor DB-Joins pruefen, ob die Bookmark-Layer-IDs in layer_definition existieren. OEREB-Bookmarks nutzen eigene IDs; deren Metadaten liegen im StagingImport (raw-conf), nicht in layer_definition.

## 2026-06-18 - Karteninhalt-Gruppenname: API muss Vorrang vor Dojo-Katalog haben (nicht fill-only)

- **Symptom:** Gruppen-Header im Karteninhalt zeigte "KULTURERBE" statt des korrekten API-/NLS-Namens "Kulturobjekte (rechtskraeftig)". Kinder-Layer hatten korrekte Namen.
- **Root-Cause:** `_buildActiveEntries` uebernahm den API-Gruppennamen nur fill-only (`if (entry.groupName) return;`). Der Header kam aber bereits aus `coalInfo.groupName` = Dojo-LyrMgr-Kategorie-Description (`_enrichCoalesceNamesFromDojo`), also blieb der technische Dojo-Name stehen.
- **Fix:** fill-only entfernt — API-Name (`_apiGroupNames`, aus `serviceGroups[].name`) gewinnt jetzt ueber den Dojo-Katalog-Namen; Katalog nur Fallback ohne API-Treffer.
- **Guardrail:** Wenn die API die autoritative NLS-Quelle ist, muss sie Vorrang haben. Die API liefert fuer den Karteninhalt alle noetigen Infos (id/name/visible/opacity/order/children) — fehlende Anzeige ist Frontend-Prioritaet, kein API-Datenmangel.

## 2026-06-18 - Bookmark-Dirty: Reihenfolge + Opazitaet wurden nicht als Aenderung erkannt

- **Symptom:** Nach Drag&Drop-Reorder (oder reiner Opacity-Aenderung) erschien kein "Aenderungen verwerfen".
- **Root-Cause:** `_isActiveBookmarkModified()` verglich nur die Menge der sichtbaren Layer-IDs. Reihenfolge und Opazitaet wurden ignoriert. Das `_bmModified`-Flag aus `_dragEnd` steuert das Badge NICHT.
- **Fix:** Helper `_bookmarkOrderOrOpacityDiffers(baseline, current)` ergaenzt; im Snapshot-Zweig zusaetzlich Reihenfolge (gemeinsame IDs positionsweise) und Opazitaet (Epsilon 0.001) gegen `_resetLayers` pruefen.
- **Guardrail:** Dirty-Erkennung muss alle vom Nutzer aenderbaren Dimensionen abdecken (Sichtbarkeit, Reihenfolge, Opazitaet), nicht nur die Sichtbarkeits-Menge.

## 2026-06-18 - Bookmark-Reset zuverlaessig via Voll-Reload statt Snapshot-Restore

- **Symptom:** Reset musste teils zweimal geklickt werden; Reorder-/z-index-Ueberbleibsel blieben auf der Karte.
- **Root-Cause:** Snapshot-Restore rief `reconcileMapConsistency` (setzt Sichtbarkeit+Opazitaet), aber NICHT die Reihenfolge/z-index. Async materialisierte Layer kamen erst nach dem ersten Klick.
- **Fix:** bm-reset macht jetzt IMMER einen vollen Reload via `TnetSetBookmark(bm.id, viewId, options)` (Option B). Snapshot-Felder werden vor dem Reload verworfen. 1-Klick, 100% Original.
- **Guardrail:** Fuer 'auf Original zuruecksetzen' ist ein frischer Quell-Reload zuverlaessiger als ein teil-rekonstruierter Snapshot, sofern die Ladezeit (Kacheln) akzeptabel ist.

## 2026-06-18 - Opacity-Slider-Sprung: Default muss synchron beim Render vorliegen (nicht erst aus async API)

- **Symptom:** Beim Bookmark-Load stand der Deckkraft-Slider zuerst auf 100% und sprang dann auf den echten Wert (z.B. 70%).
- **Root-Cause:** `_renderStandalone`/`_renderGroupChild` nutzten Fallback `: 1` (100%), wenn der Layer (noch) keine eigene Opazitaet trug. Die echte Default-Opazitaet kam erst spaeter.
- **Fix:** Helper `_resolveDisplayOpacity(l)` nutzt `l.opacity`, sonst synchron `store.findLayer(id)._configOpacity` (aus der Layer-Katalog-Config, sofort verfuegbar). Slider zeigt damit beim ersten Render den richtigen Wert.
- **Guardrail:** Initiale UI-Werte muessen aus einer synchron verfuegbaren Quelle kommen. Eine asynchrone API-Antwort verhindert den Sprung NICHT, weil sie nach dem ersten Render eintrifft.

## 2026-06-18 - Default-Opacity der Bookmark-API liegt nicht in layer_definition.opacity

- **Symptom:** API `bookmarks?hierarchy=2&names=1` liefert weiterhin `opacity: null`, obwohl `loadProfileLayerOpacities` aus `layer_definition.opacity` liest.
- **Root-Cause:** `mapplusconf.layer_definition.opacity` ist fuer die betroffenen Layer NULL (DEFAULT 1.0 greift nur bei INSERT ohne expliziten Wert). Die echten Default-Deckkraefte (z.B. 70%) liegen in der Framework-Layer-Config (layers_*.conf), nicht in dieser DB-Spalte.
- **Fix:** Frontend nutzt die Store-Config-Opazitaet (`_configOpacity`) — die richtige Quelle. Die API-Erweiterung bleibt als korrekter Fallback fuer den Fall, dass DB-Werte gepflegt werden.
- **Guardrail:** Vor DB-gestuetzten Feldern pruefen, ob die Spalte tatsaechlich befuellt ist. Die maszgebliche Default-Opazitaet im TNET-Stack ist die Framework-Layer-Config, nicht layer_definition.opacity.

## 2026-06-17 - Karteninhalt: Wrapper-Pattern (V2 ueber V1) erzeugt wiederkehrende Artefakte → in V1 mergen

- **Symptom:** Doppeltes "Ansicht"-Dropdown, verschwindendes Debug-Badge bei Eye-Toggle, neue Katalog-Layer erscheinen nicht/unten, Reihenfolge springt zurück. Jeder Fix oeffnete den naechsten Bug.
- **Root-Cause:** `tnet-lm-active-v2.js` patchte V1 per Monkey-Patch (`_buildActiveEntries`, `render`) und hing per `setTimeout(0)` DOM-Elemente nach. V1 hatte bereits ein eigenes Views-Dropdown → Dopplung. `_knownLayerIds` wurde gesetzt aber nicht genutzt. Patch-Layer + Original kollidierten bei jedem Re-Render.
- **Fix:** Die vier echten V2-Mehrwerte (API-Reihenfolge, NLS-Gruppen-Namen, neue-Layer-oben, Debug-Badge) direkt in V1 (`tnet-lm-active.js`) integriert: `_loadBookmarkApiData`, `_sortActiveLayersForDisplay`, `_apiGroupNames`-Override in `_buildActiveEntries`, Badge direkt im render-HTML (kein setTimeout). V2-Datei + Feature-Flag (`useActiveV2`/`activeV2`) + Script-Tag entfernt.
- **Guardrail:** Erweiterungen eines bestehenden UI-Moduls gehoeren in dieses Modul, nicht in einen Monkey-Patch-Wrapper. Wrapper, die `render()`/Builder patchen und per setTimeout DOM nachziehen, kollidieren systematisch mit dem HTML-Diffing des Originals.

## 2026-06-17 - Neuer Katalog-Layer erscheint nicht im Karteninhalt (Live-Extra-Gate)

- **Symptom:** Aktivieren eines Layers aus dem Themenkatalog fuegte ihn nicht zum Karteninhalt hinzu (bei aktivem Bookmark).
- **Root-Cause:** `shouldIncludeLiveExtrasForBookmark()` laesst Live-Layer nur durch wenn `_bmModified===true`. Ein neuer Layer ist nicht in `bookmark.layers` → `updateBookmarkLayerState` liefert `changed=false` → `_bmModified` blieb `false` → Layer herausgefiltert.
- **Fix:** In `_onVisibility` zusaetzlich `isNewLiveLayer = !changed && evt.visible && getBookmarkInfo()` als Aenderung werten und `_bmModified=true` setzen (mit denselben User-Edit-Guards).
- **Guardrail:** Das Live-Extra-Gate muss echte Neuzugaenge (sichtbarer Layer ausserhalb des Bookmarks) als Modifikation erkennen, nicht nur Aenderungen an bereits im Bookmark vorhandenen Layern.

## 2026-06-17 - V2 Wrapper darf Drag&Drop-Reihenfolge nicht beim naechsten Re-Render ueberschreiben

- **Symptom:** Nach Drag&Drop im Karteninhalt und anschliessendem Auge-Toggle sprang die Reihenfolge wieder auf den API-Urzustand zurück.
- **Root-Cause:** `_sortByBookmark()` sortierte bei jedem `_buildActiveEntries`-Aufruf (auch Eye-Toggle → `active-layers-changed`) nach dem statisch geladenen `_serviceGroupsOrder` aus dem API-Load; die vom Store bereits übernommene Drag&Drop-Reihenfolge wurde ignoriert.
- **Fix:** `_userReordered`-Flag eingeführt; wird `true` wenn Layers explizite `order`-Werte haben (V1 setzt sie nach Drag&Drop). Solange Flag gesetzt, gibt `_sortByBookmark` die Layer unverändert zurück. Flag wird bei `tnet-bookmark-loaded` zurückgesetzt.
- **Guardrail:** Wrapper-Patches auf `_buildActiveEntries` duerfen nur solange sortieren, wie kein manuelles Reordering stattgefunden hat.

## 2026-06-17 - ArcGIS-Bridge darf show:-1 nicht als Bildrequest senden

- **Symptom:** Mehrere Layer liessen sich nicht einschalten; im Browser erschien `EncodingError: The source image cannot be decoded` und der Karteninhalt zeigte `Fehler`.
- **Root-Cause:** Die Coalesce-Bridge erstellte beim ersten Root-Layer kurz eine ArcGIS-Image-Source mit `LAYERS=show:-1`; einige ArcGIS-Export-Endpunkte liefern dafuer keine dekodierbare Bildantwort.
- **Fix:** Erster sichtbarer Sublayer wird vor Root-OL-Layer-Erstellung registriert; bei leerem Sublayer-Set wird der Layer nur unsichtbar geschaltet und kein `show:-1` per `updateParams()` gesendet.
- **Guardrail:** `show:-1` ist ein interner Leerzustand, kein belastbarer ArcGIS-Export-Request. Leere Kombi-Layer ueber Sichtbarkeit steuern, nicht ueber Bildrequest.

## 2026-06-17 - URL-Bookmark-Fixes duerfen keinen 30s-Retry erzeugen

- **Symptom:** Nach Start eines Bookmarks liefen in der Konsole noch laenger als 30 Sekunden Nachzieh-/Retry-Aktivitaeten.
- **Root-Cause:** Der Opacity-Fallback wartete auf Config-Opacity fuer alle Bookmark-Zeilen; Layer ohne Config-Opacity hielten das Retry-Intervall bis Timeout offen.
- **Fix:** Retry wartet nur bis der Store geladen ist; fehlende Config-Opacity wird als normaler Skip behandelt und beendet kein weiteres Nachfassen.
- **Guardrail:** Startup-Fallbacks muessen terminieren, sobald die benoetigte Datenquelle geladen ist. Fehlende optionale Defaults duerfen keine langen Retry-Schleifen ausloesen.

## 2026-06-17 - Karteninhalt-Auge braucht generischen Lazy-Load

- **Symptom:** `ch.astra.baulinien-nationalstrassen` blieb beim Einschalten im Karteninhalt auf Spinner, ohne sichtbar zu werden.
- **Root-Cause:** `setLayerEye()` hatte einen Lazy-Load nur fuer Coalesce-Sublayer; aktive Bookmark-/URL-Layer ohne aktuellen OL-Layer und ohne Coalesce-Flag fielen durch.
- **Fix:** `setLayerEye()` startet fuer sichtbare, nicht materialisierte Layer generisch `TnetLayerSwitch(layerId, 'on')`, zieht Opacity nach und beendet den Loading-State sobald der OL-Layer auftaucht.
- **Guardrail:** Augen-Toggles muessen alle aktiven Bookmark-Layer materialisieren koennen, nicht nur Coalesce-Sublayer.

## 2026-06-17 - Reset-Baseline ist bei URL-Bookmarks der Snapshot

- **Symptom:** Nach `Änderungen verwerfen` blieben Button/Badge sichtbar und Opacity fiel wieder auf 100%.
- **Root-Cause:** Dirty-Erkennung verglich gegen die rohe Bookmark-Konfiguration statt gegen den URL-Override-Ausgangszustand; Reset-Snapshot konnte bereits mutierte Runtime-Opacity enthalten.
- **Fix:** Reset-Snapshots normalisieren `opacity:null` zur Config-Opacity; Modified-Vergleich nutzt den Reset-Snapshot als Baseline.
- **Guardrail:** Bei URL-Overrides ist der initiale URL-Zustand die Undo-Baseline, nicht zwingend die gespeicherte Bookmark-Defaultansicht.

## 2026-06-17 - URL-Bookmarks muessen Config-Opacity fuer alle TOC-Zeilen behalten

- **Symptom:** Start via `layers=` ohne `op=` zeigte Deckkraft-Slider im Karteninhalt auf 100%, obwohl Layer-Defaults z.B. 65% vorgeben.
- **Root-Cause:** Der URL-Config-Fallback griff nur fuer sichtbare URL-Layer und nutzte teils mutierbare Runtime-Opacity statt unveraenderter Layer-Config.
- **Fix:** Katalog-Layer konservieren `_configOpacity`; URL-Starts ohne `op=` wenden Config-Opacity auf alle Bookmark-Zeilen an.
- **Guardrail:** `opacity:null` im Bookmark bedeutet "Layer-Default verwenden". Runtime-/Slider-Werte nie als Config-Default behandeln.

## 2026-06-17 - OEREB-Layer brauchen ID-Kandidaten beim Ein-/Ausschalten

- **Symptom:** Layer wie `ch.astra.baulinien-nationalstrassen` liessen sich aus dem Karteninhalt nicht einschalten.
- **Root-Cause:** `TnetLayerSwitch()` suchte nur die rohe ID; Legacy-LyrMgr/OL-Layer koennen aber OEREB-Suffixe wie `_v2_0.oereb` verwenden.
- **Fix:** Layer-Switch und Store-OL-Suche nutzen ID-Kandidaten aus Basis-ID, OEREB-Version und Aenderungsvariante.
- **Guardrail:** URL-/Bookmark-IDs und Legacy-LyrMgr-IDs nie als garantiert identisch annehmen; Toggle- und OL-Suche muessen dieselben Kandidaten verwenden.

## 2026-06-17 - Bookmark-Start wird vom Layerkatalog dominiert

- **Symptom:** Start von `nw_oereb` wirkte langsam, obwohl die Bookmark-API selbst schnell antwortete.
- **Root-Cause:** Der grosse Layerkatalog wird aus DB ohne Cache geladen; `cache.enabled:false` erzwingt `nocache=1`.
- **Fix:** Kurzlebigen DB-Katalogcache in `tnet-global-config.json5` aktiviert (`enableDbCache:true`, 300s TTL).
- **Guardrail:** Startzeitmessung getrennt nach Bookmark-API, Layerkatalog und Framework-Render messen; erst dann Cache oder Payload optimieren.

## 2026-06-17 - Literaler error-Response braucht Koordinaten-Fallback

- **Symptom:** Die differenzierte Hoehenabfrage blieb leer und loggte wiederholt `Ungueltige Hoehenantwort: error`.
- **Root-Cause:** Der Primaer-Service lieferte fuer einzelne Punkte nur den Text `error`; der Guard gab dann `null` an den Legacy-Callback weiter und verlor die Anzeige.
- **Fix:** Der Guard extrahiert bei ungueltiger Primaerantwort `x/y/srs` aus dem urspruenglichen Request und holt per GeoAdmin-Height-Fallback eine stabile Hoehe; bei Erfolg wird Anzeige + Legacy-Load mit diesem Wert bedient.
- **Guardrail:** Bei Hoehenservices mit sporadischen Textfehlern nie direkt abbrechen, sondern einen koordinierten Fallback mit denselben Request-Parametern nutzen.

## 2026-06-16 - Hoehenabfrage crasht bei Textantwort

- **Symptom:** Klick auf leere Karte erzeugt `ReferenceError: error is not defined` aus `njs.Tools.ElevationDisplay._formatElevation`.
- **Root-Cause:** Dojo `xhrGet` parst die Hoehenantwort mit `handleAs: "json"`; bei Textantworten wie `error` scheitert `dojo.fromJson` per eval.
- **Fix:** TNET-Elevation-Guard setzt Hoehen-XHRs auf Text-Parsing und extrahiert Zahlen/JSON-Felder robust; der 3D-Hoehenaufruf nutzt ebenfalls tolerantes Parsing.
- **Guardrail:** Externe Services, die einfache Zahlen liefern koennen, nie hart als JSON laden; Text laden und explizit validieren.

## 2026-06-16 - Hoehen-Guard muss vor Framework-Modulen aktiv sein

- **Symptom:** Hoehenfix griff nicht zuverlaessig in allen Startpfaden; ungueltige Antworten konnten weiterhin den Framework-Fehlerpfad erreichen.
- **Root-Cause:** Guard wurde erst spaet eingebunden und erkannte nur URL-Parameter, nicht Dojo-`content`-Parameter; bei ungueltiger Antwort wurde `error` statt ein neutraler Load-Wert aufgerufen.
- **Fix:** Guard wird vor `modules.js`/`tnet_modules_m.js` geladen, erkennt Parameter in URL und `content`, und gibt bei ungueltiger Hoehe `null` an den originalen Load-Handler weiter.
- **Guardrail:** Patches fuer Framework-XHRs immer vor den Modulen einbinden und beide Dojo-Parameterformen pruefen: Querystring und `args.content`.

## 2026-06-16 - Hoehenantwort nutzt DEM/DSM-Felder

- **Symptom:** Hoehenantwort `{"dem":551.88,"dsm":551.88}` wurde trotz gueltigem JSON als ungueltig geloggt.
- **Root-Cause:** Der Guard extrahierte nur generische Felder wie `height`, `elevation`, `z`, aber nicht die GeoAdmin-Felder `dem`/`dsm`.
- **Fix:** `parseElevationValue()` akzeptiert `dem` und `dsm`, mit `dem` vor `dsm` als Terrainhoehe.
- **Guardrail:** Bei GeoAdmin-Hoehenservices immer die realen Antwortfelder `dem` und `dsm` beruecksichtigen, nicht nur generische Hoehenfeldnamen.

## 2026-06-16 - Hoehenanzeige braucht Terrain, Oberflaeche und Objekt

- **Symptom:** Trotz `dem`/`dsm`-Antwort zeigte die Fussleiste nur eine einzelne Hoehe.
- **Root-Cause:** Der Guard reduzierte die Antwort fuer das Framework auf eine Zahl und verlor die zweite Hoehe samt Differenz.
- **Fix:** Der Guard gibt dem Framework weiter die Terrainhoehe (`dem`), schreibt aber parallel Gelände, Oberfläche und Objekt in `z_alti1` und die Footer-Anzeige.
- **Guardrail:** Parser duerfen strukturierte Messwerte nicht zu frueh auf eine einzelne Zahl reduzieren, wenn die UI mehrere abgeleitete Werte anzeigen soll.

## 2026-06-16 - Kartenmarker-Spitze muss SVG-Anker verwenden

- **Symptom:** Roter Kartenmarker lag sichtbar zu tief; die Spitze traf nicht den Klickpunkt auf der Linie.
- **Root-Cause:** Der OpenLayers-Icon-Anker nutzte `y=70`, obwohl die SVG-Spitze bei `y=80` im `viewBox` liegt.
- **Fix:** Marker-Anker in `tnet-context-menu.js` auf `[0.5, 80]` gesetzt, passend zur Pin-Spitze im SVG.
- **Guardrail:** Bei SVG-Icons den Anchor aus dem `viewBox`/Pfad ablesen, nicht aus der gesamten Bildhoehe oder dem Schattensaum schaetzen.

## 2026-06-17 - URL-Override-Reset muss Bookmark-Default-TOC wiederherstellen

- **Symptom:** Ein Start mit explizitem `layers=` zeigte korrekt eine Bookmark-Übersteuerung, aber nach `Änderungen verwerfen` blieb der Karteninhalt bei 36/37 statt beim originalen 39-Themen-TOC.
- **Root-Cause:** Der Reset-Snapshot wurde aus dem URL-Override-Runtime-State abgeleitet und teilweise zu früh eingefroren, bevor alle Katalog-/Container-Layer im Store bekannt waren.
- **Fix:** Bei URL-Overrides wird der Reset-Snapshot im Active-Panel aus der vollständigen Runtime-Liste plus Bookmark-Default-Sichtbarkeit aufgebaut und während des Renderns mit später verfügbaren Katalog-Layern vervollständigt.
- **Guardrail:** URL-Override ist bereits ein Dirty-State. Der Reset-Zustand muss der originale Bookmark-Default-TOC sein, nicht die URL-Layerliste und nicht ein zu früher Runtime-Snapshot.

## 2026-06-16 - Bookmark-Reset muss Runtime-Snapshot statt Full-Reload nutzen

- **Symptom:** Nach Klick auf `Änderungen verwerfen` dauerte das Zurücksetzen lange, und der Modified-Button blieb sichtbar bzw. der Zähler blieb abweichend.
- **Root-Cause:** Der Reset lud das Bookmark vollständig neu bzw. nutzte den laufend synchronisierten URL-Override-Zustand. Dadurch wurde der aktuelle geänderte Zustand erneut angewendet oder der Ausgangszustand neu berechnet statt exakt wiederhergestellt.
- **Fix:** Vor der ersten Benutzeränderung wird ein Snapshot von `bookmark.layers` und `_options` gespeichert. `Änderungen verwerfen` stellt diesen Snapshot direkt in `TnetLMStore` wieder her, reconciliiert die Karte und entfernt das Modified-Badge sofort.
- **Guardrail:** Undo/Reset in bereits geladenen Bookmark-TOCs aus einem Runtime-Snapshot herstellen. Full-Bookmark-Reload nur als Fallback verwenden; URL-Sync-Zustand ist nach Benutzeraktionen nicht mehr die Ursprungsvorlage.

## 2026-06-16 - Live-Extras duerfen Bookmark-Filter nicht umgehen

- **Symptom:** Nach dem Einschalten einer ausgeblendeten Coalesce-Gruppe wie KULTURERBE sprang der Karteninhalt-Zaehler von 36 auf 105/108 Themen.
- **Root-Cause:** `mergeBookmarkLayers()` haengte bei modifizierten Bookmarks alle Store-Layer an, die nicht in der bereits gefilterten Bookmark-Liste waren. Dadurch kamen weggefilterte Original-Bookmark-Layer als vermeintliche Live-Extras zurueck.
- **Fix:** Live-Extras werden nun gegen die originale Bookmark-Layerliste geprueft. Nur wirklich neue, nicht im Bookmark enthaltene Layer werden angehaengt.
- **Guardrail:** Bei Bookmark-TOCs nie gegen eine bereits geprunte Liste entscheiden, ob ein Layer extern/extra ist. Immer die ungefilterte Original-Bookmark-Liste als Ausschlussmenge verwenden.

## 2026-06-16 - Keepalive muss Session-Datei aktiv schreiben

- **Symptom:** Trotz lokalem Keepalive konnte nach einigen Minuten weiterhin ein Session-Expired-Dialog erscheinen.
- **Root-Cause:** Der Keepalive-Endpunkt startete zwar die richtige `/maps-dev/`-Session, schrieb aber keinen Wert in `$_SESSION`. Mit PHP `session.lazy_write` kann die Session-Datei dadurch unveraendert bleiben. Zusätzlich lag der erste Framework-Keepalive bei 180s und damit zu nah an typischen kurzen Session-/Idle-Grenzen.
- **Fix:** `keepalive-local.php` schreibt bei jedem Ping `$_SESSION['tnet_keepalive_last'] = time()`. Desktop/Mobile setzen `njs.AppManager.keepalivetimeout` neu auf 60s.
- **Guardrail:** Keepalive muss nicht nur HTTP 200 liefern, sondern den Session-State wirklich berühren. Timer deutlich unterhalb der kuerzesten Session-Grenze setzen und einen echten Auto-Timer-Zyklus im Browser prüfen.

## 2026-06-16 - URL-Start ohne op muss Config-Opacity nachziehen

- **Symptom:** Start mit `layers=` aber ohne `op=` zeigte die URL-Layer mit 100% Deckkraft, obwohl die Layer-Konfiguration z.B. 0.65/0.75 vorgab.
- **Root-Cause:** Der URL-Override nutzt den URL-Adopt-Pfad. Dort wurden fehlende `op`-Werte nicht spät aus `TnetLMStore.findLayer(id).options.opacity` übernommen; zusätzlich kann der Katalog erst nach dem initialen Bookmark-Runtime-Aufbau bereit sein.
- **Fix:** `tnet-mapplus-helpers.js` normalisiert Opacity-Werte null-sicher, nutzt Priorität URL `op=` > Bookmark-Opacity > Config-Opacity > 1 und startet im URL-Adopt-Pfad einen Retry-Fallback, der Config-Opacities auf Bookmark, Store und OL-Layer anwendet.
- **Guardrail:** Bei URL-Bookmarks immer beide Startpfade prüfen (`_applyBookmark` und `_adoptUrlOverrideBookmark`). Fehlende Werte nie mit `Number(null)` normalisieren, da daraus 0 wird.

## 2026-06-16 - Karteninhalt-Header sollte sticky sein beim Layer-Scrollen

- **Symptom:** Beim Scrollen durch lange Themalisten verdeckte der scrollende Content die "Karteninhalt leeren" Aktion, was zu schlechter Usability führte.
- **Root-Cause:** Der Container `#lm-active-container` hatte `overflow-y: auto`, aber der Titel-Header `.lm-active-header` hatte keine sticky Positionierung.
- **Fix:** In `maps-dev/tnet/css/tnet-lm.css` `.lm-active-header` um `position: sticky; top: 0; z-index: 10;` ergänzt. Der sticky-Container funktioniert weil `#lm-active-container` bereits `overflow-y: auto !important;` hat.
- **Guardrail:** Scroll-Container mit fixen/sticky Headers: parent `overflow-y: auto` ist Voraussetzung. Z-index muss höher als Inhalts-Items sein, aber unter Modal-Overlays bleiben (z-index über 100 würde mit FloatingPane kollidieren).

## 2026-06-16 - Infoabfrage darf nicht von stale wmsActiveLyrs ausgehen

- **Symptom:** Mehrere Folgeabfragen lieferten unzuverlaessig keine oder falsche Resultate, obwohl die betreffenden Layer im Karteninhalt sichtbar waren.
- **Root-Cause:** Der Klick-Dispatcher startete weiterhin primaer aus `njs.AppManager.wmsActiveLyrs`. Diese Framework-Liste kann nach Layer-Reloads, Coalesce-Updates und URL-Restore von der echten Karteninhalt-Liste abweichen.
- **Fix:** `tnet-info-bridge.js` leitet MapTips pro Klick direkt aus `TnetLMStore.getActiveLayers()` plus sichtbar gerenderten OL-Layern ab und nutzt `wmsActiveLyrs` nur noch als Fallback/Kompatibilitaetszustand.
- **Guardrail:** Info-/GFI-Durchstiche immer vom aktuellen Karteninhalt ableiten; Framework-Collections wie `wmsActiveLyrs` sind Cache/Side-Effect, nicht die fachliche Wahrheit.

## 2026-06-16 - Keepalive muss denselben App-Cookie-Pfad verwenden

- **Symptom:** Etwa alle 2-3 Minuten erschien im Kartenbetrieb ein Browser-Dialog "Session expired. The page will be reloaded.", obwohl der Benutzer aktiv arbeitete.
- **Root-Cause:** Keepalive-XHR lief gegen `/mapplus-lib/.../keepalive.php`, waehrend die App-Session auf Cookie-Path `/maps-dev/` lief. Dadurch wurde der Session-Cookie beim Keepalive nicht konsistent mitgesendet und der Sessionstatus als abgelaufen interpretiert.
- **Fix:** In `maps-dev/public/index_de.htm` und `maps-dev/public/index_de_m.htm` Keepalive auf app-lokalen Endpunkt `/maps-dev/tnet/php/keepalive-local.php` umgestellt; neuer Endpoint startet Session mit identischem Cookie-Pfad und liefert stabile 200-Responses.
- **Guardrail:** Keepalive-Endpoints immer unter demselben URL-Root wie die App betreiben (`/maps-dev` bzw. `/maps`), damit Cookie-Path und Session-Kontext uebereinstimmen.

## 2026-06-16 - Sentinel-Guard darf nicht nach 2 Minuten enden

- **Symptom:** Infoabfrage und Docking waren direkt nach Start teils ok, kippten aber nach gewisser Laufzeit wieder auf "Keine Objekte gefunden" bzw. nicht angedocktes Verhalten.
- **Root-Cause:** Die Sentinel-Ueberwachung in `tnet-info-bridge.js` stoppte nach 12 Checks (2 Minuten). Danach konnte das Framework den eigenen `singleclick`-Handler erneut registrieren und das Verhalten driftete zeitabhaengig.
- **Fix:** Sentinel-Intervall auf dauerhaftes Monitoring umgestellt (alle 5s bis `destroy()`), inklusive sauberem Cleanup im Destroy-Pfad.
- **Guardrail:** Handler-Exklusivitaet bei Dojo/OpenLayers nicht mit Startup-Only-Checks absichern; Guard-Mechanismen muessen ueber die ganze Session aktiv bleiben.

## 2026-06-16 - Mehrfach-Abfragen brauchen request-sequenzierte Watchdogs

- **Symptom:** Erste Infoabfrage lieferte Resultat, Folgeabfragen kippten unzuverlaessig auf "Keine Objekte gefunden".
- **Root-Cause:** Der No-Results-Watchdog lief klickuebergreifend ohne Request-Sequenz; spaete Timer aus frueheren Klicks konnten in neue Abfragezyklen hineinwirken und "Keine Objekte" nachtraeglich setzen.
- **Fix:** In `tnet-info-bridge.js` Request-Sequenz (`_activeRequestSeq`) plus Timer-Cancel (`_cancelNoResultsWatchdog`) eingefuehrt, Watchdog an den aktuellen Klick gebunden und vor jedem neuen Request stale `noInfoResults`-Marker bereinigt.
- **Guardrail:** Asynchrone UI-Watchdogs in Click-Workflows immer request-lokal sequenzieren und alte Timer beim Start eines neuen Requests explizit abbrechen.

## 2026-06-16 - Repeat-Klick auf gleicher Position darf nicht an Feature-at-Pixel-Blockade scheitern

- **Symptom:** Erste Infoabfrage lieferte Resultat, ein zweiter Klick an derselben Kartenstelle lieferte kein Resultat mehr.
- **Root-Cause:** Nach dem ersten Klick lagen interaktive Overlay-Features am selben Pixel; der Feature-at-Pixel-Block in `tnet-info-bridge.js` brach die zweite Infoabfrage dadurch vor dem Dispatch ab.
- **Fix:** In `tnet-info-bridge.js` Repeat-Klick-Erkennung per Pixel-Toleranz (`<=3px`) ergänzt und bei wiederholtem Klick am selben Punkt die Blockade bewusst übersteuert, damit der Layerstich erneut ausgeführt wird.
- **Guardrail:** Feature-at-Pixel-Gates nie absolut anwenden; Wiederholungsklicks auf derselben Position müssen für Infoabfragen explizit erlaubt sein.

## 2026-06-16 - Infoabfrage muss Coalesce-Sublayer auf die gerenderte show:-Liste filtern

- **Symptom:** Klick-Abfrage lieferte unsaubere Resultate: ALLE Sublayer eines OEREB-Dienstes (z.B. waldabstandslinien, sondernutzungsplan) wurden abgefragt, obwohl nur einzelne im Karteninhalt aktiv waren.
- **Root-Cause:** Maptips sind auf SERVICE-Ebene verschluesselt (`<dienst>_0` .. `_13`, alle linked_layer = Dienst, query_layers = Sublayer-Nr). `isLayerQueryable(Dienst)` ist true sobald irgendein Sublayer aktiv ist → alle 14 Sublayer-Maptips wurden dispatcht. Der kombinierte OL-Layer hatte aber korrekt `LAYERS=show:1,8,9,12`.
- **Fix:** In `tnet-info-bridge.js` `_isMapTipVisible` + Dispatch-Loop (`_adapterMapPlus`): wenn query_layers gesetzt und ein sichtbarer kombinierter OL-Layer (Name == linked_layer) existiert, nur abfragbar wenn query_layers in dessen `show:`-Liste steht. Zusaetzlich Dedup nach `serviceId::subNum` gegen Doppel-Abfragen ueber Service- und Child-Maptip.
- **Guardrail:** Bei ArcGIS-Coalesce-Diensten die gerenderte `show:`-Liste des kombinierten OL-Layers als Wahrheit fuer den Karteninhalt nehmen, nicht die Service-Aktivitaet.

## 2026-06-16 - Auto-Dock darf nicht auf docked-right-Entfernung re-docken (Close-Race)

- **Symptom:** Nach erstem Schliessen oeffnete das Infofenster wieder schwebend statt rechts angedockt.
- **Root-Cause:** Der Close-Handler entfernt `docked-right` waehrend der Pane noch sichtbar ist; der default-dock Observer interpretierte das als Undock und re-dockte sofort → der Pane wurde mit inkonsistentem Dock-Zustand versteckt und oeffnete danach falsch. Zusaetzlich blockierte ein spekulativer `offsetParent===null`-Check die Sichtbarkeitserkennung des schwebenden (position:absolute) Panes.
- **Fix:** In `tnet-info-panel-default-dock.js` den Re-Dock-bei-docked-right-Entfernung entfernt (Andocken nur ueber Hidden->Visible-Transition) und `isInfoPaneVisible` auf reine `visibility`/`display`-Pruefung vereinfacht.
- **Guardrail:** Auto-Dock-Logik ausschliesslich an der Oeffnen-Transition aufhaengen; Klassen-Entfernung (manuelles Abdocken ODER Schliessen) nie als Re-Dock-Trigger verwenden. Keine `offsetParent`-Checks fuer position:absolute/fixed Panels.

## 2026-06-16 - Infofenster-Schliessen darf den Dojo-Pane nicht zerstoeren
- **Symptom:** Nach Reload funktionierte die erste Infoabfrage, nach Schliessen des Fensters lieferte der naechste Kartenklick keine stabilen Ergebnisse mehr.
- **Root-Cause:** Der Close-Button rief `widget.close()` auf; je nach Dojo-Pfad wurde `#njs_info_pane` aus dem DOM entfernt und Folgeabfragen liefen inkonsistent.
- **Fix:** In `tnet-info-panel.js` Close auf nicht-destruktives Ausblenden (`visibility='hidden'`) umgestellt, `widget.close()` im Custom-Close-Pfad entfernt und `dijit.byId('njs_info_pane').close` global auf Hide gepatcht.
- **Guardrail:** Custom-Close fuer persistente Dojo-Panels nie destruktiv implementieren, wenn nachfolgende Workflows denselben DOM-Knoten wiederverwenden.

## 2026-06-16 - Infofenster-Redock und Coalesce-Queryability waren zu eng an fragilen DOM/WMS-Formaten

- **Symptom:** Nach Schliessen und erneutem Kartenklick oeffnete die Objektinformation wieder schwebend; Grundnutzung lieferte in sichtbarem Zustand teils keine Treffer.
- **Root-Cause:** Der Dock-Reset erkannte nur `visibility:hidden` und verpasste Dojo-Close-Pfade mit Klassenwechsel; die Coalesce-Renderpruefung akzeptierte nur `LAYERS=show:...` und fiel bei gueltigen Varianten ohne Prefix aus.
- **Fix:** In `tnet-info-panel-default-dock.js` Sichtbarkeit robust ueber `computedStyle` + Dock-Klassenwechsel bewertet und Auto-Dock bei Verlust von `docked-right` erneut erzwungen; in `tnet-lm-store.js` Coalesce-LAYERS tolerant fuer `show:` und Plain-Listen geparst.
- **Guardrail:** Bei Dojo/FloatingPane nie nur auf `style.visibility` vertrauen; bei ArcGIS-`LAYERS` nie ein einziges String-Format als einzige Wahrheit annehmen.

## 2026-06-15 — TnetLayerSwitch brauchte zentrale ID-Kandidaten statt exakter Einzel-ID

- **Symptom:** Layer konnte im UI als aktiv erscheinen, wurde aber in `public` nicht gerendert; Konsole zeigte wiederholt `Layer via Fallback (alle LyrMgr) versucht`.
- **Root-Cause:** `TnetLayerSwitch` suchte/schaltete nur mit exakt einer ID. Wenn Legacy-LyrMgr den Layer unter Basis-ID (ohne OEREB-Versionssuffix) kennt, lief der Switch für die versionierte ID ins Leere.
- **Fix:** In `tnet-mapplus-helpers.js` wurde ein zentraler Kandidaten-Resolver ergänzt (`Original-ID` + `ID ohne OEREB-Versionssuffix`). ON/OFF-Pfade, OL-Layer-Find und LyrMgr-Lookups nutzen nun diese Kandidaten konsistent.
- **Guardrail:** Layer-Schaltlogik nie nur auf exakte Einzel-ID aufbauen; bei heterogenen Quellen immer kanonische Kandidatenliste verwenden und durchgängig in allen ON/OFF-Fällen anwenden.

## 2026-06-15 — OEREB-Token-Heuristik durfte keine ähnliche Nationalstrassen-Variante umbiegen

- **Symptom:** "Baulinien Nationalstrassen (Änderung)" aktivierte denselben WMS-Layer wie die Baseline.
- **Root-Cause:** Die OEREB-Tokenauflösung war zu breit und akzeptierte ähnliche Namen/Titel als Treffer, wodurch die Änderungsvariante auf die Basis-ID fiel.
- **Fix:** Exakte ID-/Name-/Titel-Matches werden jetzt priorisiert; unscharfe Treffer gelten nur noch bei eindeutiger Zuordnung, Mehrdeutigkeiten werden geloggt.
- **Guardrail:** Semantisch ähnliche UI-Einträge in OEREB nie per breitem Substring-Match auf Layer-IDs auflösen.

## 2026-06-15 — Doppelte Layer-IDs brauchen einen stabilen Lookup-Key

- **Symptom:** Der Themenbaum markierte den richtigen Eintrag, aber die Karte lud bei mehrfach vorkommender ID den falschen WMS.
- **Root-Cause:** Die Runtime löste Layer bisher nur über `id` auf und nahm bei Duplikaten den ersten Treffer aus dem Katalog.
- **Fix:** Themenbaum und Store verwenden jetzt einen kompositen Lookup-Key aus `id + URL + WMS-Layer-Parametern`, damit gleiche IDs mit unterschiedlicher Quelle nicht verwechselt werden.
- **Guardrail:** Wenn IDs im Katalog 1:N vorkommen dürfen, darf die Runtime nie allein über `id` auflösen; mindestens Quelle oder Layer-Parameter müssen in den Lookup-Key einfliessen.

## 2026-06-15 — URL-Layer mit OEREB-Versionssuffix trafen im Runtime-Katalog nicht immer die echte Layer-ID

- **Symptom:** `layers=ch.astra.baulinien-nationalstrassen_v2_0.oereb` liess sich im public-Kontext nicht zuverlässig einschalten/darstellen, obwohl ähnliche Layer in anderen Gruppen funktionierten.
- **Root-Cause:** Der Runtime-Store suchte Layer-IDs nur exakt; enthielt der Katalog nur die Basis-ID (ohne `_vX_Y.oereb`), schlugen `findLayer` und nachfolgend `setLayerVisible` für versionierte URL-IDs fehl.
- **Fix:** In `tnet-lm-store.js` wurde ein OEREB-ID-Fallback ergänzt (`_stripOerebVersionSuffix`), `findLayer` versucht nach Exact-Miss zusätzlich die Basis-ID, und `setLayerVisible` kanonisiert auf `layer.id` für die weiteren Schaltpfade.
- **Guardrail:** URL-/Bookmark-Layer-IDs dürfen nicht nur exakt gematcht werden; bei OEREB-IDs immer Version-/Änderungssuffixe robust auf Basis-IDs normalisieren.

## 2026-06-15 — Ohne `group` wurden eingeloggte Nutzer immer auf `public` gezwungen

- **Symptom:** Nationalstrassen liessen sich mit `?group=marco` einschalten, ohne `group` aber nicht konsistent (manuell und via `layers=`-Restore).
- **Root-Cause:** `index.php` setzte bei leerem `group` bedingungslos auf `public`, auch fuer eingeloggte Sessions mit vorhandenen Gruppenrechten.
- **Fix:** Default auf `public` nur noch fuer nicht eingeloggte Nutzer (`!isset($_SESSION['OIDC_CLAIM_group'])`), damit eingeloggte Nutzer die bestehende Gruppen-Resolution/Weiterleitung durchlaufen.
- **Guardrail:** Default-Fallbacks fuer anonyme Nutzung nie vor Auth-/Gruppen-Resolution platzieren, sonst entstehen profilabhaengige Funktionsunterschiede trotz identischer URL-Parameter.

## 2026-06-12 — Auge-Toggle konnte framework-geladene WMS/Geoadmin-Layer nicht wieder einschalten

- **Symptom:** Layer wie ch.astra.baulinien-nationalstrassen liessen sich im Karteninhalt per Auge nicht wieder einschalten; der Layer blieb unsichtbar und layers= in der URL wurde nicht aktualisiert.
- **Root-Cause:** setLayerEye() startete den Lazy-Load-Pfad per TnetLayerSwitch('on') nur fuer _layerToCoalesce-Layer. Framework-geladene WMS/Geoadmin-Layer ohne aktuellen OL-Layer fielen dadurch komplett durch.
- **Fix:** Lazy-Load in 	net-lm-store.js fuer alle Layer ohne aktuellen OL-Layer geoeffnet, damit TnetLayerSwitch('on') den Framework-Layer wieder aufbaut.
- **Guardrail:** Bei Sichtbarkeits-Toggles fuer aktive Layer nicht voraussetzen, dass bereits ein renderbarer OL-Layer existiert; Reload/Bookmark/Framework-Rebuild koennen ihn bereits entfernt haben.
## 2026-06-12 â€” Eigenschaften-Dialog im LayerManager blieb nach â€žVon Profil ladenâ€œ im Import-Modus hÃ¤ngen

- **Symptom:** Eigenschaften im LayerManager liessen sich nach Nutzung von â€žVon Profil ladenâ€œ nicht mehr normal Ã¼bernehmen.
- **Root-Cause:** Der temporÃ¤re Import-Handler am `tb-props-save`-Button wurde nur bei â€žCancelâ€œ entfernt; bei Schliessen per X/Overlay blieb der Override aktiv und blockierte den regulÃ¤ren Save-Flow.
- **Fix:** In `tree-builder.html` wurde ein zentraler Dialog-Cleanup (`_propsDialogCleanup`) ergÃ¤nzt und in `closePropsDialog()` auf allen Schliesspfaden ausgefÃ¼hrt; der Import-Override wird damit zuverlÃ¤ssig zurÃ¼ckgesetzt.
- **Guardrail:** TemporÃ¤re Event-Overrides in Dialogen immer an einen zentralen Cleanup-Hook hÃ¤ngen, der bei **jedem** Schliesspfad (Cancel, X, Overlay) lÃ¤uft.

## 2026-06-12 â€” Schnelles Ein/Aus im Themenkatalog erzeugte nicht entfernbaren Ghost-Layer

- **Symptom:** Nach schnellem Ein-/Ausschalten blieb ein Thema auf der Karte sichtbar, liess sich nicht mehr ausschalten, erschien nicht unter â€žKarteninhalt" und â€žKarteninhalt leeren" entfernte es nicht.
- **Root-Cause:** Beim AUS-Klick wÃ¤hrend eines noch laufenden EIN-Loads nahm `setLayerVisible` die â€žSync-only"-AbkÃ¼rzung: Store-Flag auf AUS + Entfernen aus `_activeLayers`, aber ohne echten Off-Switch der (asynchron eintreffenden) Karten-Ebene. Der spÃ¤t geladene OL-Layer wurde so zum Ghost (Karte EIN, nirgends getrackt). Folge: Toggle nutzte `layer.visible` (AUS) â†’ versuchte nur EIN; `removeAllLayers` iterierte nur `_activeLayers` â†’ Ghost blieb.
- **Fix:** In `tnet-lm-store.js` drei Massnahmen: (1) `setLayerVisible` kÃ¼rzt nur noch beim EINschalten ab â€” AUS mit State-Drift durchlÃ¤uft immer den echten Off-Pfad (TnetLayerSwitch off + `_applyOLState` setVisible(false) bei 0/300ms). (2) `toggleLayer` basiert auf `_getEffectiveLayerVisible` (echter Kartenzustand) statt nur `layer.visible`, damit Ghosts zuverlÃ¤ssig ausgeschaltet werden. (3) `removeAllLayers` ruft zusÃ¤tzlich `_sweepThematicLayersOffMap()` (Map-Sweep Ã¼ber Fachlayer, Baselayer bleiben). ErgÃ¤nzt durch den Visibility-Intent-Guard in `_onOLLayerAdd` fÃ¼r verspÃ¤tete Adds.
- **Guardrail:** Ein AUS-Klick muss den realen Karten-Layer immer aktiv abschalten, auch wenn er â€žeffektiv noch unsichtbar" scheint (laufender Async-Load). Toggle-Entscheidungen und Clear-Aktionen mÃ¼ssen den tatsÃ¤chlichen Kartenzustand berÃ¼cksichtigen, nicht allein Store-Flags/`_activeLayers`.

## 2026-06-12 â€” Combined-Sublayer (zwei Themen desselben Dienstes) liessen sich nicht ausschalten

- **Symptom:** Bei zwei gleichzeitig aktiven Sublayern desselben ArcGIS-Dienstes (gemeinsamer `show:a,b`-Layer) liess sich genau einer nicht mehr ausschalten; einzelne/eigenstÃ¤ndige Layer waren nicht betroffen.
- **Root-Cause:** Zwei zusammenwirkende Fehler. (1) Mein Ãœbergangs-Fix hatte `toggleLayer` auf `requested || effective` umgestellt. (2) `_getEffectiveLayerVisible` meldete fÃ¼r den Sublayer, nach dem der kombinierte OL-Layer benannt ist, fÃ¤lschlich â€žsichtbar": Die Exact-Name-PrÃ¼fung akzeptierte den weiterhin sichtbaren OL-Layer, ohne zu prÃ¼fen, ob dessen `show:`-Liste den Sublayer noch enthÃ¤lt. Dadurch war `effective` dauerhaft true â†’ der Layer wurde als â€žimmer an" interpretiert und nicht abgeschaltet.
- **Fix:** (1) `toggleLayer` entscheidet wieder primÃ¤r Ã¼ber den Store-Wunsch (`_getRequestedLayerVisible`); `effective` dient nur noch als Ghost-Erkennung, falls der Store AUS sagt, der Layer aber real sichtbar ist. (2) In `_getEffectiveLayerVisible` zÃ¤hlt ein exakt benannter `show:`-OL-Layer nur dann als sichtbar, wenn seine `show:`-Liste die Sublayer-Nummer wirklich enthÃ¤lt.
- **Guardrail:** Bei kombinierten ArcGIS-`show:`-Layern nie allein vom OL-Layer-Namen auf die Sublayer-Sichtbarkeit schliessen â€” immer die `show:`-Indexliste prÃ¼fen. Toggle-Logik primÃ¤r an der Nutzer-/Store-Intention ausrichten, Kartenzustand nur als Korrektur fÃ¼r echte Ghosts.



- **Symptom:** Beim Auf- und Zuklappen von Themen-Gruppen im neuen Layer-Manager wirkt der Ãœbergang hart/ruckartig.
- **Root-Cause:** Die Tree-Bodies (`.lm-subcat-body`, `.lm-group-body`, `.lm-nested-body`) wurden im collapsed-Zustand direkt per `display:none` ausgeblendet, ohne Ãœbergang.
- **Fix:** Collapse-Logik in CSS auf einen sehr leichten Ãœbergang via `max-height` und `opacity` umgestellt; collapsed setzt `max-height: 0` und `opacity: 0`.
- **Guardrail:** FÃ¼r hÃ¤ufige UI-Interaktionen (Accordion/Tree) keine harten `display:none`-SprÃ¼nge als einziges Mittel nutzen, sondern kurze, zurÃ¼ckhaltende Transitions vorsehen.

## 2026-06-11 â€” Sync-Bundles brachen an einer nicht vorhandenen notes-Spalte

- **Symptom:** Sync und Fullbackup schlugen mit `SQLSTATE[42703]` ab, weil `config_bundle_store.notes` in einem Schema nicht existierte.
- **Root-Cause:** Die Sync- und Backup-Abfragen selektierten `notes`, obwohl die aktuelle Tabelle `config_bundle_store` diese Spalte nicht hat.
- **Fix:** `notes` aus den Bundle-SELECTs entfernt und die Fullbackup-Ausgabe auf die tatsÃ¤chlich vorhandenen Felder reduziert.
- **Guardrail:** Vor schemaÃ¼bergreifenden SQL-Abfragen immer gegen das echte Tabellenschema prÃ¼fen; nur Felder lesen, die in allen Zielschemata vorhanden sind.

## 2026-06-11 â€” SLM zeigte im ausgeloggten Zustand keinen sichtbaren Login-CTA

- **Symptom:** Im SLM-Header erschien bei fehlender Anmeldung weder Benutzerinfo noch ein Login-Button; die Toolbar wirkte leer.
- **Root-Cause:** `slm.html` blendete nur den eingeloggten Benutzerbereich dynamisch ein, hatte aber keinen expliziten Fallback-CTA fuer den ausgeloggten Zustand.
- **Fix:** Statischen `Login`-Link im Header ergÃ¤nzt und per JS sauber zwischen `Login` sowie Benutzer/`Abmelden` umgeschaltet; Redirect-URL wird dynamisch aus aktueller URL inkl. Hash aufgebaut.
- **Guardrail:** Bei Auth-abhÃ¤ngigen Headern immer beide ZustÃ¤nde explizit rendern: eingeloggter Zustand und ausgeloggter CTA.

## 2026-06-11 â€” Themenkatalog-Filter zeigte leere Oberknoten und kein klares Aktiv-Feedback

- **Symptom:** Bei aktivem Suchfilter blieben leere Gruppen/Subkategorien sichtbar; das Filterfeld war nicht klar als aktiv markiert.
- **Root-Cause:** Die Parent-Sichtbarkeit wurde Ã¼ber fragile CSS-String-Selektoren (`style*="display:none"`) bestimmt; dadurch wurden leere Oberknoten nicht zuverlÃ¤ssig ausgeblendet.
- **Fix:** Filterlogik auf robuste SichtbarkeitsprÃ¼fung via direkte Kindknoten (`style.display !== 'none'`) umgestellt, aktive Filter-Markierung (`lm-search-active`) ergÃ¤nzt und X-Button-Interaktion abgesichert.
- **Guardrail:** Bei Baumfiltern Parent-Sichtbarkeit immer daten-/zustandsbasiert berechnen (nicht Ã¼ber CSS-String-Matching), und aktiven Filterzustand visuell eindeutig kennzeichnen.

## 2026-06-11 â€” Kategorie-Icons zeigten keinen Hover-Text mit den gewÃ¼nschten Aliasen

- **Symptom:** Beim Hover Ã¼ber die Kategorie-Icons im neuen Themenkatalog wurde kein bzw. kein gewÃ¼nschter Alias-Text angezeigt.
- **Root-Cause:** In `tnet-lm-tree.js` wurden die Tabs/Icons ohne `title`-Attribut gerendert; dadurch war kein Browser-Tooltip vorhanden.
- **Fix:** Alias-Mapping pro Kategorie ergÃ¤nzt und `title`/`alt` beim Rendern der Tab-Icons auf Alias (Fallback `cat.alias`/`cat.name`) gesetzt.
- **Guardrail:** Bei reinen Icon-Tabs immer explizit einen semantischen Tooltip (`title`) und einen aussagekrÃ¤ftigen `alt`-Text setzen.

## 2026-06-11 â€” DOM-Element entfernt aber addEventListener-Aufruf vergessen

- **Symptom:** Seite/iframe lÃ¤dt nicht mehr, JS komplett stumm.
- **Root-Cause:** `document.getElementById('removed-btn').addEventListener(...)` wirft `TypeError: null` und crasht den gesamten Init-Block.
- **Fix:** Immer null-safe: `var btn = getElementById('x'); if (btn) btn.addEventListener(...)`.
- **Guardrail:** Beim Entfernen von HTML-Elementen immer grep nach dem `id=` im JS machen und alle Listener null-safe stellen.

## 2026-06-11 â€” Modaldialoge schliessen bei Text-Selektion in Input-Feldern

- **Symptom:** Beim Versuch, Text in Input/Textarea-Feldern eines Dialogs mit der Maus zu markieren, schloss sich der Dialog spontan.
- **Root-Cause:** Event-Bubbling: Clicks auf Input-Felder bubbelten bis zu Overlay-Click-Handlern, die den Dialog schlossen (obwohl die Handler korrekt `e.target === this` prÃ¼ften, feuerte ein nachgelagerter Handler oder die Bubbling-Phase selbst das Close aus).
- **Fix:** Globaler Click-Handler (Capture-Phase) in `slm.html`, der auf alle `INPUT` und `TEXTAREA` Elemente `e.stopPropagation()` setzt, sodass Clicks in Formularfeldern nicht bis zu Modal-Handlern bubbelln.
- **Guardrail:** Bei Modal/Overlay-Patterns immer `event.stopPropagation()` auf Interaktionselementen setzen (Input, Buttons, Links); besonders wichtig bei dynamisch erzeugten Dialogen.

## 2026-06-10 â€” layers.php braucht StagingImportRepository-Require fÃ¼r echten DB-only Pfad

- **Symptom:** Fehlende Layer wurden in Karte/Preview weiterhin angezeigt, obwohl `source=db` aktiv war.
- **Root-Cause:** In `layers.php` fehlte `require_once StagingImportRepository.php`; der DB-Layer-Load warf `Class not found` und fiel still auf File-Definitionen zurÃ¼ck.
- **Fix:** `StagingImportRepository` explizit eingebunden und Missing-Filter im `processLayerItems`-Pfad auf DB-Definitionsbasis umgesetzt.
- **Guardrail:** Bei DB-first-Endpunkten Klasseneinbindung fÃ¼r alle Repository-Aufrufe validieren; Catch-Fallbacks dÃ¼rfen Source-Drift nicht unbemerkt kaschieren.

## 2026-06-10 â€” Editor-Deploy braucht Auto-Export und robustes Git-Error-Mapping

- **Symptom:** â€žKÃ¼rzel nach coreâ€œ schlug mit â€žBitte zuerst Export nach Tempâ€œ ab bzw. zeigte bei Git-Fehlern nur â€žUnbekannter Fehlerâ€œ.
- **Root-Cause:** Deploy-Flow setzte einen manuellen Vor-Export voraus und wertete Git-Fehlerantworten (`detail`) nicht aus.
- **Fix:** `exportEditorToCore()` startet nun bei fehlendem RunId automatisch `export-catalog-artifacts` und fÃ¼hrt danach Deploy aus; Git-Fehlertexte werden aus `error/message/detail` extrahiert.
- **Guardrail:** In 2-Step-Flows den zweiten Schritt resilient machen (Auto-Vorbereitung) und Backend-Fehlerfelder vollstÃ¤ndig auswerten.

## 2026-06-10 â€” Merge-Export darf Metadateien nicht als Fehler behandeln

- **Symptom:** â€žKÃ¼rzel mergenâ€œ brach mit `Merge Ã¼bersprungen (unbekannter Dateityp): .core-import-manifest_...json` ab.
- **Root-Cause:** `export-catalog-artifacts` wertete nicht-katalogische Bundle-Dateien (Manifest/Meta) als Merge-Fehler.
- **Fix:** Export filtert jetzt strikt auf die fÃ¼nf Katalog-PrÃ¤fixe (`layers`, `maptips`, `lyrmgrResources`, `maptipsResources`, `legendResources`) und Ã¼berspringt Metadateien still.
- **Guardrail:** Merge-/Deploy-Pipelines nur auf fachliche Katalogartefakte anwenden; Hilfs-/Manifest-Dateien nie als harte Fehler in User-Flows behandeln.

## 2026-06-10 â€” Raw-Conf-Helper dÃ¼rfen nicht innerhalb `getWritableRawConfDir()` definiert sein

- **Symptom:** Im SLM-Editor wurden plÃ¶tzlich keine Quellen/Tags geladen (UI blieb bei 0/leer).
- **Root-Cause:** `rawConfSourceBuckets()/resolveRawConfServiceDir()/...` waren lokal in `getWritableRawConfDir()` definiert. Bei frÃ¼hem Return (weil `RAW_CONF_DIR` bereits beschreibbar war) wurden diese Funktionen nie deklariert, spÃ¤tere Aufrufe fÃ¼hrten zu Fatal-Fehlern.
- **Fix:** Raw-Conf-Helfer auf Top-Level in `treebuilder-api.php` verschoben und aus `getWritableRawConfDir()` entfernt.
- **Guardrail:** In PHP keine global genutzten Helper-Funktionen innerhalb von Funktionen deklarieren, wenn es frÃ¼hzeitige Return-Pfade gibt.

## 2026-06-10 â€” Create-Export schrieb weiter nach ags-import/raw-conf statt raw-conf

- **Symptom:** SLM Create meldete Exporte nach `tmp/maps-dev/ags-import/raw-conf/ags/` statt nach `tmp/maps-dev/raw-conf/ags/`.
- **Root-Cause:** `RAW_CONF_DIR` war in `treebuilder-api.php` noch auf `TnetTmpPaths::agsImport('raw-conf')` verdrahtet.
- **Fix:** `RAW_CONF_DIR` auf `TnetTmpPaths::getRoot() . '/raw-conf'` umgestellt, damit AGS/QGIS/Core-Create-Exporte direkt unter `tmp/maps(-dev)/raw-conf/...` landen.
- **Guardrail:** `raw-conf` und `ImportToCore` strikt getrennt halten: `raw-conf` liegt direkt unter dem Tmp-Root, nur `ImportToCore` bleibt im `ags-import`-Pfad.

## 2026-06-10 â€” Merge-Export im SLM braucht Dialog statt Browser-Prompt und deduplizierte Typ-Merges

- **Symptom:** Beim Klick auf â€žKÃ¼rzel mergenâ€œ kam nur ein Browser-`prompt`; ausserdem konnten bei typbasiertem Merge doppelte EintrÃ¤ge in Listen entstehen.
- **Root-Cause:** Der Editor-Flow nutzte keinen eingebetteten Modal-Dialog, und der Merge-Writer fÃ¼hrte fÃ¼r Listen nur ein stumpfes AnhÃ¤ngen durch.
- **Fix:** In `slm.html` wurde ein eigener Merge-Dialog (Overlay) mit Eingabefeld/Validierung ergÃ¤nzt; in `treebuilder-api.php` merge`t `export-catalog-artifacts` assoziative JSONs key-basiert (letzter Wert gewinnt) und dedupliziert Listenwerte Ã¼ber Signaturen.
- **Guardrail:** FÃ¼r SLM-Massnahmen keine Browser-Prompts verwenden; Merge-Exports mÃ¼ssen pro JSON-Typ deterministisch und ohne doppelte Keys/EintrÃ¤ge laufen.

## 2026-06-09 â€” source=db darf nicht im JSON-API-Cache hÃ¤ngen bleiben

- **Symptom:** Nach Live-DB-Publish im Tree-Builder waren Ã„nderungen erst sichtbar nach Klick auf â€žCache leerenâ€œ im SLM.
- **Root-Cause:** `layers.php` nutzte auch im `source=db`-Modus den serverseitigen JSON-Cache mit TTL; DB-Updates invalidierten diesen Cache nicht sofort.
- **Fix:** In `layers.php` wird der JSON-Cache bei `source=db` automatisch gebypasst (`$bypassJsonCache = true`), sodass Runtime-Antworten unmittelbar aus der DB kommen.
- **Guardrail:** FÃ¼r DB-first-Live-Workflows API-Response-Caches nur im File-Modus verwenden oder per DB-Revision invalidieren.

## 2026-06-09 â€” SLM-Cache muss store-spezifisch versioniert sein

- **Symptom:** Nach Deploy waren Ã„nderungen erst sichtbar, nachdem der SLM-Cache manuell gelÃ¶scht wurde.
- **Root-Cause:** Tree-Builder nutzte einen globalen localStorage-Key ohne Store-Trennung und ohne Schema-Version; veralteter Zustand blieb aktiv.
- **Fix:** `tree-builder.html` verwendet jetzt store-spezifischen Key (`treebuilder_state_<env>`) plus Versionsmarker (`treebuilder_state_version_<env>`), der alten SLM-State automatisch invalidiert.
- **Guardrail:** Bei strukturellen Ã„nderungen am Editor-State immer Version bumpen und nie denselben localStorage-Key fÃ¼r DEV/PROD teilen.

## 2026-06-09 â€” Alias-Save darf nicht nur auf nlsEdits vertrauen, und DB-Quelle darf nicht von Profil-Datei Ã¼bersteuert werden

- **Symptom:** Trotz Klick auf â€žLive DBâ€œ blieben Alias-Ã„nderungen nach Reload/Runtime teilweise alt.
- **Root-Cause:** (1) Alias-Publish baute Payload primÃ¤r aus `state.nlsEdits`; bei inkonsistentem UI-State blieb `__nlsAliases` leer. (2) `layers.php?source=db` merge-te zusÃ¤tzlich Profil-`lyrmgrResources.json` und konnte DB-Aliase wieder Ã¼berschreiben.
- **Fix:** Tree-Builder speichert Alias-Deltas zusÃ¤tzlich aus `state.layerAliases` gegen `state.layerAliasesBase` und schreibt sie in `__nlsAliases`; `layers.php` lÃ¤dt Profil-NLS-Dateien nur noch im Datei-Modus (`source=file`), nicht im DB-Modus.
- **Guardrail:** In DB-first muss `source=db` strikt dateifreie Alias-AutoritÃ¤t haben; Alias-Persistenz darf nie allein vom Pending-Edit-Cache abhÃ¤ngen.

## 2026-06-09 â€” Alles aus der DB: Editor, Karte und NLS-Aliases

- **Symptom:** Editor zeigte anderen Stand als Karte; Aliases gingen nach Reload verloren; Karte nutzte andere Persistenz als Editor.
- **Root-Cause:** Drei Datenpfade waren entkoppelt: (1) `catalog_document` (Tree-Builder) vs. `catalog_node` (Runtime), (2) NLS-Aliases nur als Datei, (3) `tnet-lm-store.js` nicht per Apache-Alias erreichbar (`/maps-dev/public/tnet/` fehlte).
- **Fix:** `layers.php?source=db` liest jetzt `catalog_document` (statt `catalog_node`); NLS-Aliases werden als `__nlsAliases`-Block im `catalog_document` gespeichert und von `layers.php` vor Core-NLS appliziert; Apache-Rewrite `.htaccess` in `public/` leitet `tnet/â€¦` auf `/maps-dev/tnet/â€¦` um; `publishLyrmgrDbNow()` schreibt Aliases automatisch nach DB-Publish.
- **Guardrail:** Bei DB-first immer prÃ¼fen ob Runtime-Endpoint, Editor-Publish und NLS-Pfade alle dieselbe Tabelle lesen. Publizierte Payload-BlÃ¶cke wie `__nlsAliases` mÃ¼ssen in `layers.php` nach der `$_nlsAliasesRuntime = []` Initialisierung neu eingespeist werden.


- **Symptom:** `slm.html#tab=treebuilder` zeigte weiterhin einen anderen Stand als Runtime, obwohl source bereits strikt auf `db|file` stand.
- **Root-Cause:** UI-Flow lud beim Profilwechsel/Init weiterhin Draft-first und speicherte Edits primÃ¤r als Draft, wÃ¤hrend Publish zur DB separat manuell ausgelÃ¶st werden musste.
- **Fix:** Tree-Builder lÃ¤dt jetzt standardmÃ¤ssig den publizierten Stand und triggert nach Save automatisch `publish-lyrmgr` in die DB (inkl. Live-Status in der UI).
- **Guardrail:** In DB-first-Workflows dÃ¼rfen Editor-Speichern und Runtime-Quelle nicht durch Draft-first oder manuelle Zusatz-Publish-Schritte entkoppelt sein.

## 2026-06-09 â€” Bei Duplicate-ID darf der Container nicht vor spaeterem Leaf-Treffer zurÃ¼ckkehren
- **Symptom:** `HÃ¶henlinien` blieb trotz Toggle ohne Kartenwirkung, obwohl ein renderbarer Layer mit derselben ID vorhanden war.
- **Root-Cause:** `_findLayerRecursive` merkte sich zwar die Leaf-Praferenz, gab aber pro Knoten sofort den Container-Fallback zurÃ¼ck, bevor spÃ¤ter im Baum der gleichnamige Blatt-Layer gefunden wurde.
- **Fix:** Resolver auf globalen Fallback umgestellt: Leaf-Treffer sofort, Container nur merken und erst nach kompletter Schleife zurÃ¼ckgeben.
- **Guardrail:** Bei Mehrdeutigkeiten (Container+Leaf gleiche ID) nie innerhalb derselben Iteration frÃ¼h auf Container zurÃ¼ckkehren; Fallback erst nach vollstÃ¤ndiger Suche anwenden.

## 2026-06-09 â€” Container-Layer wie `.../hoehenlinien` muessen auf Blatt-Layer delegieren
- **Symptom:** `HÃ¶henlinien` liess sich im Themenbaum ankreuzen, wurde aber nicht auf Karte/Karteninhalt wirksam.
- **Root-Cause:** Der geklickte Knoten war strukturell (mit Kind-Layern wie `/2m`, `/5m`, `/10m`) und selbst nicht direkt renderbar.
- **Fix:** `setLayerVisible()` behandelt Knoten mit Kindern als Container und schaltet stattdessen alle Blatt-Layer unter dem Prefix (`_setDescendantLeafLayersVisible`).
- **Guardrail:** Bei Legacy-Katalogen nie davon ausgehen, dass ein klickbarer UI-Eintrag ein renderbarer Blatt-Layer ist; Container-IDs muessen auf konkrete Child-IDs aufgeloest werden.

## 2026-06-09 â€” setLayerVisible muss Framework-Combined-Layer (show:) vor TnetLayerSwitch behandeln
- **Symptom:** Einzelne Layer liessen sich im Themenbaum ein-/ausschalten, blieben aber auf der Karte unveraendert oder tauchten nicht im Karteninhalt auf.
- **Root-Cause:** Fuer bestimmte Legacy-/Bookmark-Pfade rendert das Framework keinen dedizierten OL-Layer pro Thema, sondern einen kombinierten Dienst-Layer mit `LAYERS=show:...`. Der Standardpfad `TnetLayerSwitch` griff dort teilweise nicht belastbar.
- **Fix:** In `tnet-lm-store.js` wurde `setLayerVisible()` erweitert: vor dem Standard-`TnetLayerSwitch` wird `_setFrameworkCombinedSublayer(...)` ausgefuehrt. Bei Treffer werden Karte + Active-Liste direkt synchronisiert.
- **Guardrail:** Bei ArcGIS-Sublayern zuerst pruefen, ob bereits ein kombinierter `show:`-Layer aktiv ist; erst wenn das nicht zutrifft, auf Legacy-Switch-Funktionen zurueckfallen.

## 2026-06-09 â€” Themenkatalog darf bei gleicher ID nicht den Container statt Blatt-Layer aufloesen
- **Symptom:** Bestimmte Themen liessen sich im Baum ankreuzen, erschienen aber weder auf der Karte noch im Karteninhalt.
- **Root-Cause:** `findLayer` lieferte bei identischer ID teils den Container-Knoten (mit Kindern) statt des renderbaren Blatt-Layers; dadurch liefen Toggle-/Render-Pfade inkonsistent.
- **Fix:** In `tnet-lm-store.js` `_findLayerRecursive` auf echte Blatt-Erkennung umgestellt (Kinder-Arrays als Kriterium), Container nur noch als Fallback.
- **Guardrail:** Bei Legacy-Katalogen mit doppelten IDs (Wrapper + Leaf) immer zuerst echte Blatt-Layer aufloesen; Knotentypen allein sind kein verlÃ¤ssliches Leaf-Kriterium.

## 2026-06-09 â€” Public-Profil: Runtime darf nicht am Legacy-DB-Baum vorbeiziehen
- **Symptom:** Im public-Profil zeigte die Kartenapp einen anderen Themenbaum als der Tree-Builder, obwohl publiziert war.
- **Root-Cause:** `layers.php?source=auto` bevorzugte den Legacy-DB-Pfad (`catalog_node`), waehrend Tree-Builder/Publish den Profil-Dokumentpfad (`CatalogRepository`) aktualisiert.
- **Fix:** In `layers.php` wird bei aktivem `configSource.catalog=db` im Auto-Modus der Legacy-DB-Pfad uebersprungen, sodass der Runtime-Read konsistent ueber `CatalogRepository::loadProfile()` laeuft.
- **Guardrail:** Bei DB-first immer sicherstellen, dass Runtime-Read und Editor-Publish dasselbe Persistenzmodell verwenden; Mischbetrieb nur explizit und kontrolliert zulassen.

## 2026-06-09 â€” UI-Zeitstempel in lokaler Fachzeitzone anzeigen
- **Symptom:** Ã„nderungszeitpunkte wurden als UTC/ISO angezeigt und wirkten fachlich zeitversetzt.
- **Root-Cause:** Frontend zeigte `updatedAt`-Werte direkt aus ISO-Strings ohne Zeitzonen-Formatierung.
- **Fix:** Im Tree-Builder wurde `formatSwissDateTime(..., Europe/Zurich)` zentral eingefÃ¼hrt und fÃ¼r Objekt-/LyrMgr-Metadaten sowie Draft-Statusmeldungen verwendet.
- **Guardrail:** Persistenz darf UTC bleiben, aber Benutzeranzeigen mit Datumsbezug immer explizit in der Zielzeitzone formatieren.

## 2026-06-09 â€” Datei-Publish muss bei DB-first den DB-Stand mitziehen
- **Symptom:** Nach Klick auf â€žPublish lyrmgr.confâ€œ blieb der Themenkatalog in der Kartenapp unverÃ¤ndert/alt.
- **Root-Cause:** Der Datei-Publish-Pfad hat DB-Publish Ã¼bersprungen, wÃ¤hrend Runtime standardmÃ¤ssig DB-first (`catalog: db`, `lyrmgrSource: api`) liest.
- **Fix:** `publishLyrmgr('file')` fÃ¼hrt jetzt ebenfalls `publish-lyrmgr` (DB-Sync) aus und danach wie bisher den Datei-Deploy.
- **Guardrail:** In DB-first-Setups darf ein sichtbarer Publish-Button nicht nur Nebenpfade (Datei) aktualisieren, wenn die Runtime aus der DB liest.

## 2026-06-09 â€” Move-Aktionen mÃ¼ssen Objekt-Metadaten explizit anfassen
- **Symptom:** Nach Layer-Verschiebungen blieben â€žLetzte Ã„nderungâ€œ-Felder leer oder unverÃ¤ndert.
- **Root-Cause:** Metadaten wurden nur bei Eigenschafts-/Alias-Ã„nderungen gesetzt, nicht bei DnD-Moves.
- **Fix:** Bei DnD-EinfÃ¼ge-/Reorder-Pfaden werden jetzt betroffene Layer/Gruppen Ã¼ber `touchNodeEditMeta` bzw. `touchMovedItemsMeta` aktualisiert.
- **Guardrail:** Jede fachliche Mutation (inkl. Reihenfolge/Verschiebung) muss denselben Ã„nderungs-Tracking-Pfad auslÃ¶sen wie Property-Edits.

## 2026-06-09 â€” Objekt-Metadaten dÃ¼rfen nicht aus globalem Publish-Meta gelesen werden
- **Symptom:** In den Objekt-Eigenschaften (Layer/Kategorie/Gruppenlayer) wurde Ã¼berall derselbe â€žLetzter Publishâ€œ-Wert angezeigt.
- **Root-Cause:** Die UI nutzte fÃ¼r Objekt-Tooltips und Properties das globale LyrMgr-Meta (`_metaInfo.updatedBy/updatedAt`) statt objektbezogene Ã„nderungsmetadaten.
- **Fix:** Im Tree-Builder wurde ein objektbezogener Metadaten-Store (`nodeEditMeta`) eingefÃ¼hrt; Ã„nderungen an Layer/Kategorie/Gruppenlayer aktualisieren nun gezielt `updatedBy/updatedAt`, und die Dialoge/Tooltips zeigen diese Werte an. Globaler Publish bleibt auf LyrMgr-Ebene.
- **Guardrail:** Ã„nderungszeitpunkte immer auf Ebene des tatsÃ¤chlichen EntitÃ¤ts-Keys speichern und darstellen; Publish-Metadaten nie als Ersatz fÃ¼r Objekt-Historie verwenden.

## 2026-06-09 â€” Kartenapp muss API-Aufruf explizit auf DB-first setzen
- **Symptom:** Trotz DB-first-Konfiguration zeigten Kartenapp und SLM teilweise unterschiedliche KatalogstÃ¤nde.
- **Root-Cause:** Der Kartenapp-Store rief `layers.php` ohne expliziten `source`-Parameter auf; damit hing das Verhalten implizit am Backend-Default statt am klaren DB-first-Pfad.
- **Fix:** `tnet-lm-store.js` ergÃ¤nzt den API-Call um `source=auto`, damit DB bevorzugt und Datei nur als Fallback genutzt wird.
- **Guardrail:** FÃ¼r produktive Quellwahl nie auf implizite Defaults verlassen; die gewÃ¼nschte AutoritÃ¤t (`db`/`auto`/`file`) im Request immer explizit setzen.

## 2026-06-09 â€” Publish muss dieselbe Laufzeitquelle bedienen wie layers.php
- **Symptom:** Nach Draft/Publish waren Ã„nderungen im Tree-Builder sichtbar, aber nicht im Live-Themenkatalog der App.
- **Root-Cause:** `layers.php?source=auto` lieferte bevorzugt Daten aus dem DB-Knotenmodell (`catalog_node`), wÃ¤hrend Tree-Builder-Publish in `catalog_document`/Datei schrieb; dadurch blieb die Laufzeitansicht auf altem Stand.
- **Fix:** `layers.php` liest bei aktivem `configSource.catalog=db` zuerst das verÃ¶ffentlichte Katalog-Dokument aus `CatalogRepository::loadProfile()` und nutzt Datei nur als Fallback.
- **Guardrail:** Bei DB-first niemals verschiedene Persistenzmodelle (Node-DB vs. Document-DB) unkoordiniert parallel bedienen; Runtime-Endpoint und Editor-Publish mÃ¼ssen auf dieselbe AutoritÃ¤tsquelle zeigen.

## 2026-06-09 â€” Multi-Editing Drafts mÃ¼ssen in DB liegen und Publish braucht Dual-Pfad
- **Symptom:** Draft wirkte nach Reload/zwischen Bearbeitern instabil; nach Publish war der Themenkatalog teils nicht im erwarteten Datei-Pfad sichtbar.
- **Root-Cause:** `save/load-lyrmgr-draft` war nur dateibasiert (`tmp/layertree`), wÃ¤hrend Runtime DB-first ist; Publish lief blockweise in DB, aber ohne expliziten Full-File-Deploy-Schritt.
- **Fix:** Draft auf DB-Storage umgestellt (`<profile>__draft` via `CatalogRepository`), inklusive Metadaten (`updatedBy/updatedAt/revision`) bis ins UI; Publish fÃ¼hrt jetzt DB-Publish plus zusÃ¤tzlichen `publish-lyrmgr-full` Datei-Deploy (Best-Effort) aus.
- **Guardrail:** In DB-first Workflows Entwurf und Publish-Endpfad nicht auf verschiedene PersistenzkanÃ¤le verteilen, ohne explizite Synchronisationsschritte und sichtbare Statusmeldungen.

## 2026-06-09 â€” Inline-Themennamen (Alias) sind NLS-Edits und mÃ¼ssen separat persistiert werden
- **Symptom:** Nach Bearbeiten eines Kategorienamens im Tree-Builder wirkte es wie â€žnicht gespeichertâ€œ: in DB-Block/Export war die Ã„nderung nicht sichtbar.
- **Root-Cause:** Inline-`cname` schreibt bewusst NLS-Aliase (`state.nlsEdits`/`state.layerAliases`), nicht den strukturellen `lyrmgr.conf`-Key. Diese NLS-Daten wurden in `getStateToPersist()` und `generateJSON()` bisher nicht mitgefÃ¼hrt.
- **Fix:** Persistenz erweitert (`layerAliases`, `layerPropEdits`, `nlsEdits`) und JSON-Export um `aliases` + `nlsEdits` ergÃ¤nzt; File-Import liest diese Felder nun ebenfalls ein.
- **Guardrail:** In UI-Flows strikt trennen zwischen Struktur-Ã„nderung (lyrmgr) und Label-Ã„nderung (NLS). Wenn beides editierbar ist, mÃ¼ssen Backup/Restore beide DatenkanÃ¤le enthalten.

## 2026-06-08 â€” Publish darf im DB-Mode nicht an Dateirechten scheitern
- **Symptom:** Im Tree-Builder wurde "Speichern" erfolgreich angezeigt, aber "Publish" brach ohne wirksame Ãœbernahme ab.
- **Root-Cause:** `publish-lyrmgr` scheiterte beim Schreiben von `maps-dev/public/config/lyrmgr.conf` (Permission denied) und beendete den Ablauf vor dem DB-Write.
- **Fix:** `publishLyrmgrBlock()` in `treebuilder-api.php` auf robustes DB-first angepasst: bei aktivem DB-Mode ist Dateischreiben Best-Effort; DB-Publish lÃ¤uft weiter und liefert Erfolg (mit Warning bei File-Fehler).
- **Guardrail:** In DB-first-Konfigurationen Dateiexport nie als harte Voraussetzung fÃ¼r Publish behandeln; Dateifehler als Warnung fÃ¼hren, DB-Write als PrimÃ¤rerfolg werten.

## 2026-06-08 â€” Tree-Builder muss Kategorienreihenfolge gegen Runtime-API synchronisieren
- **Symptom:** Im Editor war die Reihenfolge (z.B. `bau, ...`) anders als im Live-Themenkatalog (`grundlagen, oereb, ...`), obwohl beide aus demselben Profil kamen.
- **Root-Cause:** Tree-Builder Ã¼bernahm beim Laden die Reihenfolge aus dem rohen `lyrmgr.conf`-Block, Runtime aber aus `layers.php` (DB/API). Bei driftenden Quellen entstand ein sichtbarer Reihenfolge-Mismatch.
- **Fix:** Beim Profil-Laden wird die Editor-Reihenfolge jetzt gegen `layers.php?group=<profil>&source=auto` abgeglichen und anhand der bestpassenden Runtime-Topkategorie (hÃ¶chster ID-Overlap) neu sortiert.
- **Guardrail:** FÃ¼r die Editor-Darstellung immer dieselbe AutoritÃ¤tsquelle wie die Runtime verwenden; reine `rawBlock`-Reihenfolge nicht als alleinige UI-Wahrheit behandeln.

## 2026-06-08 â€” Tree-Builder Export: raw structure als Array muss per _key aufgeloest werden
- **Symptom:** Nach Speichern/Publizieren war die Reihenfolge im Editor wieder falsch bzw. instabil.
- **Root-Cause:** `generateLyrmgrConfBlock()` hat bei `rawBlock.structure` im Array-Format (`[{ _key, ... }]`) weiterhin nur `rawStructure[catKey]` geprueft. Dadurch wurde das Originalformat nicht erkannt und teils wieder Objekt-Format geschrieben, was Reihenfolge-Drift beguenstigt.
- **Fix:** Raw-Kategorie wird jetzt formatunabhaengig gefunden (Array via `_key`/`name`/`key`, sonst Objektzugriff). Ohne Referenz wird bewusst Array-Format verwendet, damit die Reihenfolge stabil bleibt.
- **Guardrail:** Bei Object->Array-Migrationen nie Key-Indexzugriff gegen Arrays verwenden; Strukturtyp immer explizit behandeln und fuer Reihenfolge-kritische Daten Array als Default bevorzugen.

## 2026-06-08 â€” Themenkatalog: `lyrmgrSource: 'file'` kann nach Array-Migration numerische Kategorien erzeugen
- **Symptom:** Nach Publish zeigt der Themenkatalog EintrÃ¤ge wie `0`, `9` statt Fachkategorien; Darstellung wirkt kaputt.
- **Root-Cause:** Runtime lief mit `layerManager.lyrmgrSource = 'file'`. Der File-Pfad interpretierte die neue Array-Structure der `lyrmgr.conf` nicht korrekt und erzeugte numerische Kategorie-IDs/-Namen.
- **Fix:** Runtime auf DB/API umgestellt (`lyrmgrSource: 'api'` in `tnet-global-config.json5`). Damit kommt die Hierarchie aus dem DB/API-Pfad und die Kategorienamen sind korrekt.
- **Guardrail:** Nach StrukturÃ¤nderungen im LyrMgr-Format (Objectâ†’Array) `source=file` nur verwenden, wenn der File-Parser nachweislich angepasst ist; sonst API/DB als fÃ¼hrende Quelle erzwingen.

## 2026-06-08 â€” Publish-Dialog: HTML-Listen dÃ¼rfen nicht in ein <p>-Wrapper gerendert werden
- **Symptom:** Beim Publish war der BestÃ¤tigungsdialog sichtbar, aber Buttons wirkten â€žwegâ€œ/nicht bedienbar bei langen Diff-Listen.
- **Root-Cause:** `_tbConfirm`/`_tbAlert` renderte den Inhalt pauschal in `<p>...</p>`. Der Publish-Text enthÃ¤lt `<ul><li>...`, was invalides HTML im `<p>` erzeugt und das Dialog-Layout bricht.
- **Fix:** Dialog-Message auf eigenen Block-Container (`.tb-confirm-msg`) umgestellt, scrollbar gemacht und Buttons im Footer fix sichtbar gehalten.
- **Guardrail:** Dialoge mit HTML-Content nie in `<p>` wrappen; stattdessen dedizierten Content-Container mit kontrolliertem Overflow nutzen.

## 2026-06-08 â€” Tree-Builder: Reihenfolge darf nicht aus lokalem Browser-State vor Server-Laden gerendert werden
- **Symptom:** Kategorien erschienen im Editor in alter/falscher Reihenfolge (z.B. BAU zuerst), obwohl API/DB bereits korrekt `_key`-Array-Reihenfolge lieferten.
- **Root-Cause:** Beim Init wurde `loadState()` aus localStorage zuerst gerendert (`_hasLyrmgrs`), und der veraltete Browser-Stand Ã¼berdeckte den aktuellen Server-Stand.
- **Fix:** Init auf server-first umgestellt: beim Start immer `loadLyrmgrForProfile(..., true)` laden, lokalen Snapshot nicht mehr direkt als PrimÃ¤rquelle rendern.
- **Guardrail:** Bei DB-first/Server-first UIs lokalen Zustand nur als Fallback nutzen, nie als initiale AutoritÃ¤tsquelle vor dem ersten Server-Load.

## 2026-06-08 â€” Tree-Builder: Profil-gefilterte Layer + Tag-Filter statt Konfigdatei-Filter
- **Symptom:** Der Tree-Builder zeigte alle Layer unabhÃ¤ngig vom Profil, und der Dropdown-Filter listete Konfig-Dateinamen (z.B. `geodienste/layers_geodienste.conf (48)`) statt der fachlichen Tags.
- **Root-Cause:** `listAllLayers` hÃ¤ngte keine Tags an die Layer, und das Frontend baute den Filter aus `sourceFile`. Profil-Bundles fremder Profile wurden nur unvollstÃ¤ndig gefiltert.
- **Fix:** Backend hÃ¤ngt jetzt `tags`/`scope`/`kuerzel` pro Layer an und zeigt Profil-Scope-Bundles nur beim exakt passenden Profil (core/sitecore immer). Frontend: Dropdown â€žAlle Tags", Filter matcht gegen `layer.tags`.
- **Guardrail:** Im DB-Overlay Bundle-Metadaten (Tags/Scope/Profil) in den `sourceMap` je Layer Ã¼bernehmen, sonst stehen sie in der flachen Layer-Liste nicht zur VerfÃ¼gung. Profil-Filter exakt (`bProfile === profile`) prÃ¼fen, nicht nur â€žungleich und gesetzt".

## 2026-06-08 â€” Scope-bewusster Export: Stufe bestimmt das Zielverzeichnis
- **Symptom:** Der Export schrieb alle Bundles pauschal nach core-dev/config + core-dev/nls, unabhÃ¤ngig von der gewÃ¤hlten Ãœberladungsebene.
- **Root-Cause:** `configExportToCoreDb` kannte nur die Core-Zielpfade und ignorierte das neue `scope`/`profile`-Feld.
- **Fix:** Export wÃ¤hlt das Ziel jetzt nach Scope: `core` â†’ core-dev/config + core-dev/nls/de, `sitecore/override` â†’ maps-dev/core/config + maps-dev/core/nls/de, `profile` â†’ maps-dev/public/config/<profil>/ (conf + nls zusammen). Profil-Ordner werden bei Bedarf angelegt. Bundle-Liste + Admin-Export-Tabelle zeigen die Stufe (scope[:profil]).
- **Guardrail:** Export-Ziele immer aus dem gespeicherten Scope ableiten, nicht hartkodieren. Profil-Bundles ohne Profilnamen beim Export ablehnen, damit nichts versehentlich in den falschen (Core-)Pfad geschrieben wird.

## 2026-06-08 â€” Konfig-Store: Stufe (Scope) beim Import + DB-only Tree-Builder + Accordion-Liste
- **Symptom:** Import-UI sprach von â€žZusammenfÃ¼hren" statt â€žImportieren", es fehlte die Ãœberladungsebene, der Tree-Builder mischte noch Datei-Quellen, und die rechte Store-Liste war durch einen Tag-Block + immer offene Detailzeilen unÃ¼bersichtlich.
- **Root-Cause:** Scope war im Datenmodell zwar vorbereitet, aber nicht in Stage-Pfad/UI durchgereicht; `listAllLayers` las weiter Dateien; die rechte Liste hatte keine Accordion-Kapselung.
- **Fix:** `saveBundle`/`stageServicesToImportDb`/`ags-stage-merge` reichen jetzt `scope` (core/sitecore/profile) und `profile` durch. Import-UI: Button â€žðŸ“¥ Importieren", Stufen-Dropdown + bedingtes Profilfeld. `listAllLayers` ist DB-only (Datei-Lesen nur Fallback bei leerer/fehlender DB). Rechte Seite: Tag-Ãœbersichtsblock entfernt, jedes KÃ¼rzel als zugeklapptes Accordion mit Stufe-Badge.
- **Guardrail:** Scope/Profile bei jeder Stage-Operation explizit mitfÃ¼hren und beim Re-Stage aus dem bestehenden Bundle erben, sonst â€žrutscht" ein Dienst beim erneuten Import auf die Default-Stufe core zurÃ¼ck.

## 2026-06-08 â€” Tree-Builder DB-first Ã¼ber Datei-Basis: Ãœberladungskonzept (core/override/profile) in DB
- **Symptom:** Import/Editor waren DB-first, der Tree-Builder las â€žVerfÃ¼gbare Layer" weiter nur aus Core-Dateien â€” gestagte DB-Inhalte erschienen erst nach Export.
- **Root-Cause:** `listAllLayers()` baute Definitionen ausschliesslich aus `core/config` + Override + Profil-Dateien. Im `config_bundle_store` lagen nur die gestagten KÃ¼rzel, nicht die 5850 Core-Layer â€” ein naives â€žnur DB" hÃ¤tte den Tree-Builder geleert.
- **Fix:** `config_bundle_store` additiv um `scope` (core/override/sitecore/profile) und `profile` erweitert. `listAllLayers()` liest weiter die Datei-Basis und legt danach die DB-Bundles scope-priorisiert (core < override < profile, DB gewinnt) darÃ¼ber â€” sowohl Layer-Definitionen als auch `lyrmgrResources`-Aliase. So gehen die Datei-Layer nie verloren, DB-Inhalte sind aber sofort sichtbar.
- **Guardrail:** â€žDB-first" bei teilbefÃ¼llter DB nie als â€žnur DB" implementieren. Datei-Basis behalten und DB als priorisiertes Overlay darÃ¼berlegen, bis der Core vollstÃ¤ndig in der DB liegt. Scope-Hierarchie additiv im Schema abbilden, nicht destruktiv umbauen.

## 2026-06-08 â€” 403 (keine Admin-Berechtigung) nicht als Session-Ablauf fehlinterpretieren
- **Symptom:** Auch nach Hard-Reload, Abmelden und erneutem Login erschien im SLM hartnÃ¤ckig â€žFehler: Bitte einloggen (Session abgelaufen)".
- **Root-Cause:** Der globale Auth-Fetch-Wrapper behandelte **jeden** HTTP 403 als Login-Problem. Da der eingeloggte Nicht-Admin-User (`del`) admin-geschÃ¼tzte Actions (z.B. `staging-delete-output`, `staging-delete-tag`, `config-export-to-core`) auslÃ¶ste, kam ein legitimes 403-JSON zurÃ¼ck, das fÃ¤lschlich als abgelaufene Sitzung dargestellt wurde.
- **Fix:** Wrapper unterscheidet jetzt: Nur 401, Redirect auf `admin-login` oder eine echte HTML-Login-Seite lÃ¶sen den Login-Banner aus. Ein 403 mit JSON-Body (Berechtigungsfehler) wird unverÃ¤ndert durchgereicht, sodass die echte Fehlermeldung (â€žNur fÃ¼r Administratoren") ankommt.
- **Guardrail:** Auth-Wrapper niemals 401 und 403 gleich behandeln. 401 = nicht authentifiziert (Login nÃ¶tig); 403 = authentifiziert, aber nicht berechtigt (kein Login-Redirect, echte Fehlermeldung zeigen).

## 2026-06-08 â€” Konfig-Store Import-Tab: Tags statt Konflikte, Re-Stage server-seitig, tag-bewusstes LÃ¶schen
- **Symptom:** Der Import-Tab zeigte kÃ¼rzelÃ¼bergreifende Keys als rote â€žKonflikte", Re-Stage fÃ¼llte nur die linke Seite vor, und LÃ¶schen war nur ganz-KÃ¼rzel ohne Redundanz-Schutz.
- **Root-Cause:** Das Modell war rein KÃ¼rzel-zentriert; geteilte Ressourcen wurden als Fehler statt als gewollte Mehrfach-Nutzung interpretiert.
- **Fix:** Auf bestehendem `config_bundle_store` (nicht-destruktiv) eine Tag-Schicht ergÃ¤nzt: `addTag`/`removeTagEverywhere` im Repository, API-Actions `staging-restage`/`staging-add-tag`/`staging-delete-tag`, Tags bleiben bei Re-Stage erhalten. Frontend: Tag-Ãœbersicht mit letztem Import/Re-Stage (Datum/User), 1-Klick-Server-Re-Stage, geteilte Keys als â€žgeteilt/merged" statt rotem Konflikt, Tag-Chips mit Add, tag-bewusstes LÃ¶schen (letzter Tag â†’ Ressource endgÃ¼ltig weg).
- **Guardrail:** Bei produktiven Konfig-Datenmodellen Tag-/Dedup-Funktionen additiv auf die bestehende Tabelle setzen, statt Export-/Editor-/Verlink-Pipelines destruktiv umzubauen â€” besonders ohne BestÃ¤tigung des Users.

## 2026-06-08 â€” Editor-/Lock-Namen aus dem Login ableiten, nicht per Prompt erzwingen
- **Symptom:** Trotz aktivem Login erschien beim Bearbeiten ein Browser-Prompt fÃ¼r â€žName/KÃ¼rzelâ€œ, was redundant und stÃ¶rend war.
- **Root-Cause:** SLM und Tree-Builder fÃ¼hrten ihren Bearbeiternamen getrennt in localStorage und fragten per `prompt()`, statt zuerst den eingeloggten Benutzer zu Ã¼bernehmen.
- **Fix:** Login-Benutzer wird jetzt in SLM und Tree-Builder als gemeinsamer Editorname gespeichert und wiederverwendet; der Prompt bleibt nur noch als Fallback ohne Login-Kontext.
- **Guardrail:** Wenn eine Sitzung bereits authentifiziert ist, keine zweite BenutzeridentitÃ¤t im Frontend abfragen. Locking- und `updated_by`-Namen immer zuerst aus dem Login ableiten.

## 2026-06-08 â€” Export-Preview-Dialog im SLM kann fachlich mehr stÃ¶ren als helfen
- **Symptom:** Beim Export aus dem SLM erschien ein separater Deploy-Dialog, der im Alltag keinen Zusatznutzen brachte und bei leeren/unklaren ZustÃ¤nden nur Verwirrung erzeugte.
- **Root-Cause:** Der Exportpfad war auf einen ausfÃ¼hrlichen Confirm-Modal mit Dry-Run-Vorschau aufgebaut, obwohl der Benutzer den Export bewusst bereits Ã¼ber die Hauptaktion auslÃ¶st.
- **Fix:** Den aktiven Exportpfad auf direkten Deploy mit Statusmeldungen umgestellt; nur einfache Browser-BestÃ¤tigungen bleiben bei Mehrfach-Deploys oder ungespeicherten Ã„nderungen erhalten.
- **Guardrail:** FÃ¼r hÃ¤ufige Admin-Aktionen keine zweite komplexe Modal-Stufe einbauen, wenn dieselbe Information auch als Statusmeldung genÃ¼gt. ZusÃ¤tzliche Dialoge nur behalten, wenn sie echte Entscheidungsrelevanz liefern.

## 2026-06-08 â€” Sensible Konfig-DB-Aktionen nur Ã¼ber dedizierte Admin-Steuerseite ausfÃ¼hren
- **Symptom:** Ein global sichtbarer Toolbar-Button `Config â†’ DB` suggerierte einen harmlosen Klick, obwohl dahinter potenziell destruktive Import-/Export-Aktionen mit Ãœberschreiben und LÃ¶schen stehen.
- **Root-Cause:** Die Aktion war zu nah an der Alltags-UI platziert und nicht granular von Admin-Rechten oder einer separaten BestÃ¤tigungsoberflÃ¤che entkoppelt.
- **Fix:** Den Button nur fÃ¼r Admins sichtbar gemacht, auf eine separate Seite `config-db-admin.html` umgebogen und Import, Export sowie DB-LÃ¶schen dort getrennt mit Warnhinweisen umgesetzt. Serverseitig sind `admin.php`, `config-db-admin.html`, `config-export-to-core` und `staging-delete-output` zusÃ¤tzlich auf Admin-Rechte gehÃ¤rtet.
- **Guardrail:** Destruktive oder Ã¼berschreibende Konfig-Aktionen nie als normale Toolbar-Schnellaktion fÃ¼r alle Benutzer anbieten. Immer separaten Admin-Einstieg plus serverseitige RollenprÃ¼fung verwenden.

## 2026-06-08 â€” Export-Dialog darf keine Core-Export-Sprache mehr tragen
- **Symptom:** Im SLM blieb ein Modal mit Texten wie â€žNach core-dev exportierenâ€œ sichtbar und vermittelte weiter einen Files-/Core-Export statt einer DB-zentrierten Konfig-Operation.
- **Root-Cause:** Die sichtbaren Button- und Modal-Titel wurden noch aus der alten DBâ†’Filesâ†’Core-Semantik gebaut.
- **Fix:** Die Beschriftungen wurden auf â€žKonfig-Store erzeugenâ€œ umgestellt und die Modal-Titel sprechen nun nur noch von der Konfig-Store-DB bzw. `core-dev` als Zielstruktur.
- **Guardrail:** Bei DB-first-UIs keine historischen Export-Begriffe in primÃ¤ren Aktionen oder Modaltiteln stehen lassen; sonst wirkt die OberflÃ¤che fachlich falsch, obwohl der Backend-Pfad schon umgestellt ist.

## 2026-06-04 â€” Naiver Regex-JSON5-Parser zerstoert String-Werte mit "wort:" oder Quotes
- **Symptom:** `configSource.bookmarks: 'db'` aus `tnet-global-config.json5` griff nicht; `bookmarks-load` lieferte trotz korrekt deployter Config und erreichbarer DB weiter `source: files`.
- **Root-Cause:** Der Regex-basierte JSON5->JSON-Konverter (kopiert aus cache.php) transformiert Kommentare/Keys/Quotes ohne String-Bewusstsein. Der `_description`-Wert "Datenquelle pro Konfigurationsdomain: db oder files" wurde durch den Unquoted-Key-Schritt zu `..."Konfigurationsdomain": db...` zerschossen â†’ `json_decode` = null â†’ leeres Array â†’ `default: 'files'`. Eingebettete Single-Quotes (`'db'`) brachen es zusaetzlich.
- **Fix:** In `ConfigSource.php` einen string-bewussten Single-Pass-Tokenizer (`json5ToJson()`) implementiert: Strings werden als Tokens gesichert, Kommentar-/Key-/Trailing-Comma-Transformationen laufen nur ausserhalb von Strings, danach Tokens zuruecksetzen. Zusaetzlich `_description` entschaerft.
- **Guardrail:** JSON5 nie mit reinen Regex-Passes nach JSON wandeln. Immer string-bewusst tokenisieren, sonst brechen Werte mit `wort:`, URLs (`http://`) oder eingebetteten Quotes das Parsing â€” und der Fehler ist still (Fallback auf Defaults).

## 2026-06-09 â€” Tree-Builder/Vorschau duerfen bei strict source nicht mehr mit `source=auto` arbeiten
- **Symptom:** In `slm.html#tab=treebuilder` wirkte der gezeigte Themenstand anders als in der Runtime-App.
- **Root-Cause:** Tree-Builder und `dev-test.html` verwendeten weiterhin `source=auto`, waehrend `layers.php` nur noch explizit `source=db|file` akzeptiert und die Runtime bereits strikt auf DB konfiguriert ist.
- **Fix:** `tree-builder.html` und `dev-test.html` auf explizites `db|file` umgestellt; Default auf `db`, inkl. Runtime-Reorder-Call (`syncEditorOrderWithRuntime`) mit `source=db`.
- **Guardrail:** Sobald ein Endpoint `auto` entfernt, alle abhÃ¤ngigen Frontends (auch interne Preview-Tools) gleichzeitig auf explizite Quellen umstellen.

## 2026-06-03 â€” Coalesce-Requests muessen pro Dienst konsolidiert werden, nicht pro Pfad-Container
- **Symptom:** Bei Agglomeration wurden mehrere Export-Requests an denselben ArcGIS-Dienst (`gis_fach/nw_agglomeration/MapServer`) geschickt, obwohl alle Sublayer aus EINEM Dienst stammen.
- **Root-Cause:** `_extractRootKey()` in der Coalesce-Bridge leitete den Root-Key aus dem Pfad-Parent (`lastIndexOf('/')`) ab. Dadurch wurde jeder Karten-Container (karte03_*, karte05_*, â€¦) zu einem eigenen Root-Layer mit eigener Source â†’ ein Export-Request pro Container.
- **Fix:** `_extractRootKey()` loest den Root-Key jetzt zuerst aus der Coalesce-Gruppe des Stores auf (`getCoalesceInfo(sublayerKey).groupId`). Alle Sublayer eines Dienstes landen unter einem Root-Key â†’ ein OL-Layer mit kombiniertem `LAYERS=show:2,3,4,...`. Pfad-Parent bleibt nur Fallback fuer Dienste ohne Coalesce-Index.
- **Guardrail:** Coalesce-Konsolidierung immer an der tatsaechlichen Dienst-/Service-Identitaet (serviceUrl bzw. Coalesce-groupId) festmachen, nie an der ID-Pfadtiefe. Sublayer-Nummern sind innerhalb eines MapServers global eindeutig und duerfen in EINEM `show:` zusammengefasst werden.

## 2026-06-03 â€” Strukturelle Parent-Layer muessen im Karteninhalt bei aktiven Kindern ausgeblendet werden
- **Symptom:** In Agglomeration erschien zusaetzlich ein Parent-Layer als eigene Zeile (z.B. `.../karte05_motorisierter_individualverkehr_miv`) mit eigener Deckkraft, wodurch Gruppen-Opacity nur teilweise wirkte und Rendering unklar wurde.
- **Root-Cause:** Der Container-Filter verlieÃŸ sich nur auf Katalog-Metadaten (`type/groups/layers/...`). Einige strukturierende Parent-IDs wurden dabei nicht als Container erkannt, obwohl gleichzeitig Kind-Layer mit demselben Prefix aktiv waren.
- **Fix:** `pruneContainerCatalogLayers()` filtert jetzt zusaetzlich alle IDs heraus, die strukturelle Prefix-Parent-IDs aktiver Kind-Layer sind.
- **Guardrail:** Bei Legacy-Katalogen Container-Erkennung nie nur an Knotentypen festmachen; Prefix-basierte Parent/Child-Beziehungen als zweite Schutzschicht nutzen.

## 2026-06-03 â€” Z-Index-Sync muss sich an Bookmark-/TOC-Reihenfolge orientieren, nicht an instabiler Active-Liste
- **Symptom:** Trotz Z-Index-Sync lagen in Agglomeration einzelne Dienst-Root-Layer (z.B. Siedlungsentwicklung) visuell oben und deckten andere Themen ab.
- **Root-Cause:** `_syncZIndices()` basierte auf `_activeLayers`, deren Reihenfolge nach asynchronen Framework-/SetLayer-Operationen von der sichtbaren TOC-Reihenfolge abweichen kann.
- **Fix:** Z-Reihenfolge wird jetzt primaer aus der aktuellen DOM-Reihenfolge im Karteninhalt (`.lm-active-list`) aufgebaut; Bookmark- und Store-Reihenfolge sind nur noch Fallback. Reconcile zieht den Z-Sync danach explizit nach.
- **Guardrail:** Rendering-Reihenfolge nie aus einer potenziell reordernden Runtime-Liste ableiten, wenn eine explizite Benutzer-/Bookmark-Reihenfolge existiert.

## 2026-06-03 â€” Gruppen-Opacity muss auch bei synthetischen Bookmark-Gruppen auf alle Kinder wirken
- **Symptom:** Beim Verschieben des Gruppen-Deckkraft-Sliders wurden nur Teile der sichtbaren Layer angepasst; einzelne betroffene Layer blieben mit alter Opazitaet.
- **Root-Cause:** Der Group-Opacity-Pfad rief ausschliesslich `setCoalesceGroupOpacity(groupId)` auf. Fuer synthetische Gruppen (`bookmark-root:*`) existiert kein Coalesce-Index-Eintrag, daher lief der Call ins Leere.
- **Fix:** Group-Opacity erkennt jetzt Coalesce vs. nicht-Coalesce. Bei synthetischen Gruppen wird die Opazitaet explizit auf alle Kind-Layer via `setLayerOpacity(childId, value)` angewendet.
- **Guardrail:** Gruppenaktionen nie an einen einzigen Gruppen-Backendpfad koppeln. Bei UI-Gruppen immer den konkreten Gruppentyp (echte Coalesce-Gruppe vs. synthetische Bookmark-Gruppe) unterscheiden.

## 2026-06-03 â€” Z-Index-Sync muss TOC-Top gleich Karten-Top abbilden
- **Symptom:** Die Layerreihenfolge wirkte invertiert: Eintraege oben im Karteninhalt lagen visuell tiefer als darunterliegende Eintraege.
- **Root-Cause:** `_syncZIndices()` vergab steigende Z-Indizes entlang der Listenreihenfolge (`100 + i`), wodurch untere TOC-Eintraege die hoeheren Z-Werte erhielten. Zudem fehlte ein stabiler Pfad fuer Coalesce-/Bridge-Renderlayer.
- **Fix:** Zuweisung auf absteigende Reihenfolge umgestellt (oberster TOC-Eintrag bekommt hoechsten Z-Index) und um Bridge-/Coalesce-Renderlayer-Aufloesung erweitert.
- **Guardrail:** Bei Layerlisten mit Benutzerreihenfolge immer explizit definieren: Top-of-list = top-on-map. Coalesce-/Combined-Renderlayer muessen in denselben Z-Index-Sync einbezogen werden.

## 2026-06-03 â€” Coalesce-Snapshot-Restore darf keine pauschalen Pending-Augen auf EIN setzen
- **Symptom:** Nach Gruppe AUS/EIN blieb die Karten-Darstellung korrekt (nur vorher aktive Sublayer sichtbar), aber im Karteninhalt wirkten viele Kind-Augen fÃ¤lschlich als EIN.
- **Root-Cause:** Der Group-Eye-Handler setzte beim Coalesce-Wiedereinschalten alle Kinder optimistisch auf `pending visible=true`. FÃ¼r Kinder, die laut Snapshot AUS bleiben sollten, kam teils kein gegenlÃ¤ufiges Event â€” dadurch blieb ein stale Pending-UI-State bestehen.
- **Fix:** Beim Coalesce-EIN werden keine pauschalen `pending visible=true` mehr gesetzt. Pending wird nur fÃ¼r den sicheren AUS-Fall gesetzt; beim EIN-Fall warten die Kind-Augen auf echte Store-Events (Snapshot-Restore).
- **Guardrail:** Bei Snapshot-basierten Wiederherstellungen nie global optimistische UI-Flags fÃ¼r alle Kinder setzen, wenn der Zielzustand pro Kind unterschiedlich ist.

## 2026-06-03 â€” Coalesce-Group-Eye darf Kinder nicht per `setLayerEye` einzeln schalten
- **Symptom:** Nach Gruppe AUS/EIN gingen zuvor selektiv ausgeblendete Unterlayer verloren (beim Wiedereinschalten waren alle Kinder an), und beim Gruppenschalten entstanden mehrere Coalesce-Requests statt eines konsolidierten Updates.
- **Root-Cause:** `toggleCoalesceGroupEye()` schaltete Kinder einzeln via `setLayerEye()`. Das triggert pro Kind Framework-/Bridge-Pfade und kann den gemerkten Snapshot-Zustand ueberschreiben bzw. Request-Faecherung erzeugen.
- **Fix:** Group-Eye setzt Child-Visibility jetzt zuerst nur im Store-Zustand und reconciliert danach genau einmal ueber `_forceCoalesceGroupRender()`. Snapshot-Restore bleibt erhalten, per-Child Schaltkaskaden entfallen. Zusaetzlich nutzt der Active-Panel-Handler fuer nicht-Coalesce-Gruppen ebenfalls Snapshot-Restore statt pauschal "alle an" beim Wiedereinschalten.
- **Guardrail:** Bei Coalesce-Gruppen nie N Einzel-Schaltungen ausloesen. Erst Zielzustand fuer alle Kinder berechnen, dann einen gemeinsamen Render-/LAYERS-Abgleich ausfuehren.

## 2026-06-03 â€” Unerwuenschte ESRI-Home-Control bei Bedarf per CSS hart unterdruecken
- **Symptom:** Die Home-Control ("Standardausdehnung") blieb trotz Entfernen der JS-Instanz sichtbar.
- **Root-Cause:** In Legacy-/Cache-/Default-Szenarien kann die Home-Control dennoch im DOM auftauchen.
- **Fix:** Zusaetzlicher CSS-Fallback eingefuehrt, der `.esri-home` im 3D-View konsequent ausblendet.
- **Guardrail:** Bei kritischen UI-Elementen mit hoher Stoerwirkung zuerst logischen Remove im JS, danach defensiven CSS-Fallback setzen.

## 2026-06-03 â€” Ungewolltes Home-Widget entfernen und Bottom-Widgets gegen Toolbar absichern
- **Symptom:** Das Haeuschen (Standardansicht) blieb sichtbar, waehrend andere Controls fehlten; zusaetzlich wurde "Neue Messung" von der unteren Werkzeugleiste ueberdeckt.
- **Root-Cause:** Das Home-Widget wurde explizit per `sceneView.ui.add()` hinzugefuegt; gleichzeitig lagen Analyse-Widgets im selben unteren Bildschirmbereich wie die Toolbar ohne vertikalen Sicherheitsabstand.
- **Fix:** Home-Widget-Import/Instanzierung entfernt, SceneView-Default-UI wieder freigegeben und fuer `.esri-ui-bottom-right` ein fixer Bottom-Offset (`86px`) gesetzt.
- **Guardrail:** Bei UI-Overlays in 3D immer Corner-Konflikte pruefen: explizit hinzugefuegte Widgets separat behandeln und Bottom-Container gegen fixe Toolbars mit Offset absichern.

## 2026-06-03 â€” Breite Analyse-Widgets sollten nicht im selben Corner wie Kern-Controls sitzen
- **Symptom:** Das Panel "Neue Messung" ueberdeckte rechte Standard-Controls (Home/Zoom/Kompass).
- **Root-Cause:** Mess- und Sichtanalyse-Widgets wurden in `top-right` gerendert, also im gleichen UI-Corner wie die Kernnavigation.
- **Fix:** Mess- und Sichtanalyse-Widgets nach `bottom-right` verschoben, damit der obere Control-Stack frei bleibt.
- **Guardrail:** Breite/expandierende Widgets nie im selben Corner wie Kernnavigation platzieren; fuer Werkzeuge getrennte UI-Zone verwenden.

## 2026-06-03 â€” Default-UI-Komponenten in SceneView koennen Custom-Controls verdecken
- **Symptom:** Die Control "Standardkartenansicht" ueberlagerte in der 3D-Ansicht andere rechte Bedienelemente.
- **Root-Cause:** ArcGIS SceneView renderte den `navigation-toggle` als Default-UI-Komponente zusaetzlich zu den bereits angepassten Controls.
- **Fix:** In der SceneView-Konfiguration wurden `ui.components` explizit auf `['attribution', 'zoom', 'compass']` gesetzt und damit der `navigation-toggle` entfernt.
- **Guardrail:** Bei angepassten Control-Layouts die SceneView-Defaults immer explizit definieren, statt implizit alle Standardkomponenten mitzunehmen.

## 2026-06-03 â€” ESRI-UI-Anker fuer Controls und Widgets muessen konsistent sein
- **Symptom:** Nach Positionsanpassungen erschienen Navigations-/Werkzeug-Controls wieder links statt rechts.
- **Root-Cause:** CSS-Anker (`.esri-ui-top-left`) und JS-Widget-Insert-Position (`top-left`) liefen gegen die gewuenschte Rechtsausrichtung.
- **Fix:** `.esri-ui-top-left` auf rechts verankert und Mess-/Sicht-Widgets wieder mit `sceneView.ui.add(..., 'top-right')` eingebunden.
- **Guardrail:** Bei ArcGIS-UI-Anpassungen CSS-Anker und `ui.add`-Position immer gemeinsam aendern, sonst entstehen gemischte Links/Rechts-Layouts.

## 2026-06-03 â€” Responsiver Tool-Breakpoint muss pixelgenau zur UX-Anforderung passen
- **Symptom:** Die 3D-Werkzeugleiste erschien erst bei zu breitem Fenster statt bereits ab 510px.
- **Root-Cause:** CSS- und JS-Guard lagen auf einem zu hohen Schwellenwert und entsprachen nicht der geforderten Grenze.
- **Fix:** Sichtbarkeits-Guard auf `<510px` gesetzt (CSS `max-width: 509px` und JS `window.innerWidth < 510`), sodass die Leiste ab 510px sichtbar bleibt.
- **Guardrail:** Bei "ab X px sichtbar" immer die Grenzlogik explizit mitdenken: ausblenden nur fuer `< X`, nicht `<= X`.

## 2026-06-03 â€” 3D-Tool-Breakpoint und Dialog-Anker muessen gemeinsam abgestimmt werden
- **Symptom:** Tools erschienen auf Desktop zu spaet oder gar nicht; Dialoge verdeckten in manchen Fenstergroessen wichtige Bereiche.
- **Root-Cause:** Verfuegbarkeits-Breakpoint und Dialog-Position waren nicht auf den realen Layout-Anker (3D-Selektor oben links) abgestimmt.
- **Fix:** Breakpoint auf `860px` gesenkt (CSS+JS konsistent) und Tool-Dialoge auf `top/left` direkt unter den Selektor verankert.
- **Guardrail:** Bei responsiven Tool-UIs immer Anzeige-Guard und Dialog-Anker zusammen anpassen; CSS- und JS-Breakpoints muessen identisch bleiben.

## 2026-06-03 â€” Pointer-Coarse allein ist kein valider Mobile-Guard fuer Desktop-WebGIS
- **Symptom:** Nach Mobile-Guard waren 3D-Werkzeuge auch auf Desktop verschwunden.
- **Root-Cause:** Die Verfuegbarkeitslogik nutzte `pointer: coarse` als hartes Kriterium; das trifft auch auf Desktop-Systeme mit Touchscreen/Hybrid-Input zu.
- **Fix:** Guard auf Kombination aus Viewport-Breite, Mobile-User-Agent und explizitem Mobile-Entry umgestellt; reine Pointer-Coarse-Pruefung entfernt.
- **Guardrail:** Feature-Gates fuer Mobile nie auf ein einzelnes Input-Merkmal stuetzen. Immer mindestens Device-Kontext + Layout-Kontext kombinieren.

## 2026-06-03 â€” 3D-Toolleiste auf kleinen Screens hart deaktivieren
- **Symptom:** In der 3D-Ansicht verdeckten Werkzeug-Dialoge auf kleinen Viewports Inhalte, und die Bedienung war unzuverlaessig.
- **Root-Cause:** Die Toolleiste/Analyse-Panels wurden unabhaengig von Viewport und Eingabetyp immer angeboten.
- **Fix:** Responsive Guard eingefuehrt (max-width/coarse pointer), Toolbar+Panels per CSS versteckt und Aktivierung im JS per `are3DToolsAvailable()` geblockt; bei Resize werden aktive Tools automatisch deaktiviert.
- **Guardrail:** Interaktive Desktop-Tools nie ungeprueft auf Mobile ausrollen. Sichtbarkeit und Aktivierung immer doppelt absichern (UI + Runtime-Guard).

## 2026-06-03 â€” 3D-Tool-Toggle darf aktives Tool nicht vor dem Vergleich nullen
- **Symptom:** Im 3D-Viewer oeffneten sich beim Klick auf mehrere Bottom-Tools uebereinanderliegende Dialoge/Widgets; manche liessen sich nicht sauber schliessen.
- **Root-Cause:** `activateTool()` rief zuerst `deactivateAllTools()` auf und setzte damit `activeTool` vor dem Gleichheitscheck auf `null`; zusaetzlich wurden Viewshed-Widget und Event-Handler mehrfach erzeugt.
- **Fix:** Toggle-Logik auf `isSameTool` vor Deaktivierung umgestellt, Viewshed in `deactivateAllTools()` konsequent zerstÃ¶rt, Async-Widget-Erzeugung per Activation-Token entprellt und Listener nur einmal gebunden.
- **Guardrail:** Bei Tool-Toggles immer erst den Zielzustand berechnen, dann de-/aktivieren. Async-`require()`-Callbacks muessen stale Aktivierungen verwerfen.

## 2026-06-03 â€” Karteninhalt muss Status-Text bei `layer-loading`-Ende aktiv neu rendern
- **Symptom:** Nach Aus-/Einschalten von Gruppenlayern wurden Layer in der Karte korrekt angezeigt, im Karteninhalt blieb aber bei einzelnen Themen dauerhaft `laedt...` stehen.
- **Root-Cause:** Der `layer-loading`-Handler in `tnet-lm-active.js` aktualisierte nur die Eye-Klasse (`lm-eye-loading`) und fuehrte keinen Re-Render fuer den Status-Text aus.
- **Fix:** Nach jedem `layer-loading`-Event wird jetzt ein throttled Re-Render (`_scheduleRender()`) angestossen, damit `loading/loadingSlow/loadingError` im Textstatus konsistent aus dem aktuellen Layer-State gebaut werden.
- **Guardrail:** Bei inkrementellen DOM-Optimierungen darf ein Event-Handler nicht nur Icon-Klassen pflegen, wenn Text-Badges aus demselben State abgeleitet sind. Dann ist mindestens ein gezielter Nach-Render erforderlich.

## 2026-06-03 â€” Variable-Shadowing in Visibility-Berechnung kann alle Layer auf false kippen
- **Symptom:** Agglomeration lud mit leerer/inkonsistenter Layerdarstellung; `visibilityMap` konnte auf 0 sichtbare Layer fallen.
- **Root-Cause:** In `_computeBookmarkVisibility()` wurde die Map `explicitVisible` durch eine lokale Boolean-Variable gleichen Namens Ã¼berschattet.
- **Fix:** Die Map wurde in `explicitVisibleMap` umbenannt und die Layer-lokale Flag-Variable getrennt (`explicitLayerVisible`).
- **Guardrail:** In kritischen Merge-/Visibility-Funktionen keine gleichnamigen Variablen fÃ¼r globale Map und lokale Flags verwenden.

## 2026-06-03 â€” Bookmark-Apply muss auf Framework-Readiness warten
- **Symptom:** `setMapBookmark(params)` schlug sporadisch im frÃ¼hen Lifecycle fehl (`changeBaseMap` undefined), wodurch Layer nicht korrekt geladen wurden.
- **Root-Cause:** `TnetSetBookmark` konnte vor vollstÃ¤ndiger Initialisierung von `AppManager`/Map laufen.
- **Fix:** Vor `_applyBookmark` wurde ein Readiness-Wait (`_waitForFrameworkBookmarkReady`) ergÃ¤nzt.
- **Guardrail:** Framework-Aufrufe mit starker Lifecycle-AbhÃ¤ngigkeit nie ungeprÃ¼ft ausfÃ¼hren; immer einen Ready-Guard vorschalten.

## 2026-06-03 â€” Strukturelle Parent-Layer nur filtern, wenn sie nicht explizit sichtbar sind
- **Symptom:** View-Wechsel bei Agglomeration wirkte wirkungslos; Runtime/Store blieben auf 0 sichtbaren Layern, obwohl `setMapBookmark` sichtbare `layers=`-Parameter erhielt.
- **Root-Cause:** Strukturfilter entfernte Parent-IDs pauschal in `_computeBookmarkVisibility`/`_buildBookmarkRuntimeLayers`; bei diesem Bookmark tragen aber genau diese IDs den expliziten Sichtbarkeitszustand.
- **Fix:** Strukturknoten werden nur noch gefiltert, wenn sie nicht explizit auf `visible:true` gesetzt sind (Layer-Spec oder View-State). Gleiches gilt fÃ¼r den View-Switch-Optionsbau im Active-Panel.
- **Guardrail:** Strukturfilter nie absolut anwenden; explizit sichtbare Parent-IDs mÃ¼ssen erhalten bleiben, sonst kollabiert die View-Semantik.

## 2026-06-03 â€” Remove-Aktion braucht ein sichtbares Text-Fallback statt nur SVG
- **Symptom:** Im Karteninhalt war kein LÃ¶schkreuz wahrnehmbar, obwohl Remove-Aktionen technisch vorhanden waren.
- **Root-Cause:** Remove-Buttons waren visuell zu subtil bzw. abhÃ¤ngig von Icon-/Hover-Kontext und wurden im UI leicht Ã¼bersehen.
- **Fix:** Remove-Buttons rendern jetzt ein klares rotes `âœ•` als Text-Fallback und bleiben auf Desktop grundsÃ¤tzlich sichtbar (Hover verstÃ¤rkt nur die Betonung).
- **Guardrail:** Kritische PrimÃ¤raktionen (Entfernen) nicht rein ikonisch/hover-only darstellen; immer ein robust sichtbares Fallback anbieten.

## 2026-06-03 â€” Group-Eye muss echte Coalesce-Gruppen als Batch schalten
- **Symptom:** Beim Ein-/Ausschalten einer Agglomeration-Gruppe liefen trotz Loop-Break noch mehrere nacheinander ausgelÃ¶ste Child-Toggles, statt eines sauberen Coalesce-Gruppenupdates.
- **Root-Cause:** Der UI-Handler schaltete Gruppenkinder einzeln (`setLayerVisible` pro Child) und verursachte dadurch unnÃ¶tige Kaskaden.
- **Fix:** In `tnet-lm-active.js` nutzt `group-eye` fÃ¼r echte Coalesce-Gruppen jetzt `toggleCoalesceGroupEye(groupId)` als Batch-Pfad; Child-Wege bleiben nur Fallback.
- **Guardrail:** FÃ¼r Coalesce-Gruppen immer den Gruppenpfad verwenden und Child-Schaltungen nicht in Schleifen triggern.

## 2026-06-03 â€” Loading-Status darf keinen active-layers-changed-Reconcile ausloesen
- **Symptom:** Sobald in Agglomeration mehr als zwei Sublayer aktiv waren, wurden im Sekundentakt neue Export-Requests abgesetzt (sichtbarer Dauer-Reload).
- **Root-Cause:** `_setLayerLoadingState()` emittierte bei jedem Loading-Statuswechsel zusaetzlich `active-layers-changed`. Das triggert `_scheduleMapConsistencyCheck()` erneut und startet einen self-triggernden Reconcile-Zyklus.
- **Fix:** In `tnet-lm-store.js` emittiert der Loading-Pfad nur noch `layer-loading`, nicht mehr `active-layers-changed`.
- **Guardrail:** Status-Events (loading/slow/error) strikt von Struktur-Events trennen. Nur echte Layerlisten-Aenderungen duerfen `active-layers-changed` feuern.

## 2026-06-03 â€” Strukturelle Bookmark-Container duerfen nicht als echte Active-Layer laufen
- **Symptom:** Im Karteninhalt tauchten ploetzlich flache Zusatzzeilen (Ghost-Layer) auf; bei OEREB stieg die Themenzahl sporadisch stark an, und im Hintergrund liefen unnoetige Nachlade-/Export-Requests.
- **Root-Cause:** Parent-/Container-IDs aus `cfg.layers` wurden wie renderbare Layer in Visibility/Runtime/Store behandelt. Diese IDs sind oft nur Strukturknoten mit Unterlayern und triggern in Reconcile-Pfaden unnoetige `on`-Schaltungen.
- **Fix:** In `tnet-mapplus-helpers.js` werden strukturelle IDs jetzt aus `_computeBookmarkVisibility()` und `_buildBookmarkRuntimeLayers()` herausgefiltert. In `tnet-lm-active.js` ignoriert auch die Dirty-Pruefung diese Strukturknoten.
- **Guardrail:** Bei Bookmark-Layern immer zwischen fachlichem Strukturknoten und renderbarem Blatt-Layer unterscheiden. Container-IDs duerfen nicht in Active-/Reconcile-Logik gelangen.

## 2026-06-03 â€” Map-getriebene false-Events duerfen Bookmark-Runtime nicht auf AUS ziehen
- **Symptom:** Nach asynchronen Framework-Rebuilds kippten Bookmark-Layer ohne User-Aktion auf `visible:false` (Auge aus), obwohl die Karte weiter lief.
- **Root-Cause:** `layer-visibility` mit `source='map'` und `visible=false` wurde ungefiltert in `window.__tnetActiveBookmark.layers` uebernommen; zusaetzlich zog der Active-Layer-Merge negative Zustandsflips aus transienten Store-Events nach.
- **Fix:** In `tnet-mapplus-helpers.js` ignoriert der Runtime-Sync jetzt map-seitige `visible:false`-Events, und der Merge uebernimmt Visibility aus `active-layers-changed` nur noch positiv (`visible:true`).
- **Guardrail:** Map-/OL-Remove-Events in Legacy-Rebuild-Phasen nie als harte Benutzerintention behandeln. Negative Status nur aus UI-/Bookmark-Pfaden uebernehmen.

## 2026-06-03 â€” Nicht-Default-Views mit reinen visible:true-States sind Whitelists
- **Symptom:** Die Ansicht `test` lud Layer nicht gemaess View-Konfiguration; entweder wurden falsche Default-Layer mitgenommen oder die erwarteten 7 Layer nicht stabil gesetzt.
- **Root-Cause:** Die Visibility-Berechnung behandelte fehlende `layerStates`-Eintraege weiterhin als Default-Vererbung. Bei Whitelist-Views (`isDefault:false` + nur `visible:true` Eintraege) ist das falsch.
- **Fix:** `tnet-mapplus-helpers.js` und `tnet-lm-active.js` erkennen diesen Modus jetzt explizit und setzen nicht genannte Layer auf `visible:false`.
- **Guardrail:** Bei View-Switch nie pauschal Default-Visibility erben. Nicht-Default-Views mit ausschliesslich `visible:true`-States als explizite Whitelist interpretieren.

## 2026-06-03 â€” Store-Merge darf Bookmark-Sichtbarkeit im Ladefenster nicht blind auf false setzen
- **Symptom:** Direkt nach View-Apply sprang der Bookmark-Zustand auf `layers=` leer bzw. alle Runtime-Layer auf `visible:false`; der Reset-Hinweis erschien ohne echte Benutzeraktion.
- **Root-Cause:** `_mergeStoreLayersIntoActiveBookmark()` setzte waehrend `_replaceVisibleFromStoreUntil` zunaechst pauschal alle Bookmark-Layer auf `false`, auch wenn der Store in diesem Moment noch keinen stabilen sichtbaren Layer lieferte.
- **Fix:** Das harte Reset greift nur noch, wenn der Store bereits mindestens einen `visible:true`-Layer hat.
- **Guardrail:** Im Bookmark-Ladefenster niemals global auf `visible:false` vorinitialisieren, solange der Store noch im transienten Aufbau ist.

## 2026-06-03 â€” Ansichtswechsel darf Bookmark nicht als manuell geaendert markieren
- **Symptom:** Nach Wechsel der Ansicht erschien ohne Benutzerinteraktion der Hinweis "Ã„nderungen verwerfen" und die Layerschaltung wurde inkonsistent.
- **Root-Cause:** Asynchrone Visibility-/Sync-Events nach `switch-view` liefen auÃŸerhalb des kurzen Ladefensters ein und setzten den Modified-Status wie bei einem echten User-Toggle.
- **Fix:** In `tnet-lm-active.js` wurde ein dediziertes View-Switch-Schutzfenster eingefÃ¼hrt (`_bmViewSwitchUntil`), das wÃ¤hrend des Ansichtswechsels Dirty-Setzen und Live-Extra-Merge unterdrÃ¼ckt.
- **Guardrail:** View-/Bookmark-Loads immer mit eigenem Guard behandeln; Event-StÃ¼rme aus Framework-Sync nie direkt als BenutzerÃ¤nderung interpretieren.

## 2026-06-03 â€” Spinner-Zentrierung bricht, wenn Animation `transform` ueberschreibt
- **Symptom:** Der Eye-Ladekringel erschien sichtbar, aber versetzt neben dem Auge statt sauber zentriert.
- **Root-Cause:** Das Pseudo-Element nutzte `transform: translate(-50%, -50%)` zur Zentrierung, die Keyframe-Animation setzte jedoch `transform: rotate(...)` und Ã¼berschreibt damit die Translate-Transformation.
- **Fix:** Keyframes auf `translate(-50%, -50%) rotate(...)` umgestellt, damit Zentrierung und Rotation gleichzeitig aktiv bleiben.
- **Guardrail:** Bei animierten, absolut positionierten Spinnern Translate-Offsets immer in den Keyframes mitfÃ¼hren oder die Rotation auf ein verschachteltes Element legen.

## 2026-06-03 â€” Group-Eye darf nicht nur Coalesce-Toggle verwenden
- **Symptom:** Bei Agglomeration war der Gruppen-Auge-Status nach Ein/Aus inkonsistent; ein zweiter Klick schaltete teils nicht mehr sauber zurÃ¼ck.
- **Root-Cause:** Der Group-Flush arbeitete primÃ¤r mit `toggleCoalesceGroupEye`, aber die betroffene Hierarchie ist nicht durchgehend Coalesce-indexiert. Dadurch blieb der Toggle ohne wirksamen Commit auf den Kindlayern.
- **Fix:** Group-Eye schaltet jetzt die sichtbaren Kindlayer explizit per `setLayerEye(layerId, target)` und nutzt Coalesce-Toggle nur als Fallback.
- **Guardrail:** Gruppen-Interaktionen in gemischten BÃ¤umen (normale Gruppen + Coalesce) immer als explizites Setzen pro Kind implementieren, nicht als blindes Toggle.

## 2026-06-03 â€” Combined-Render-Check muss rekursiv durch OL-Layer-Gruppen laufen
- **Symptom:** Layer wurden im Store/DOM als sichtbar gefÃ¼hrt, obwohl die effektive Render-Erkennung diese als unsichtbar bzw. inkonsistent meldete.
- **Root-Cause:** `_isSublayerRenderedByCombinedLayer` prÃ¼fte nur Top-Level-Layer und Ã¼bersah verschachtelte OpenLayers-Group-Layer.
- **Fix:** Der Check traversiert jetzt rekursiv alle Layer-Gruppen und wertet `show:`-Parameter auch in verschachtelten Strukturen korrekt aus.
- **Guardrail:** FÃ¼r Render-Detektion in OpenLayers nie nur `map.getLayers().forEach(...)` nutzen, wenn Layer-Groups im Framework mÃ¶glich sind.

## 2026-06-03 â€” Eye-Loaderkreis muss trotz unterdruecktem Full-Render direkt aus layer-loading reagieren
- **Symptom:** Beim Umschalten der Sichtbarkeit erschien um das Eye kein Loaderkreis mehr, obwohl der Layer noch geladen wurde.
- **Root-Cause:** Der Active-Panel-Render wurde waehrend des Sichtbarkeits-Flushs unterdrueckt. Dadurch wurde das `layer-loading`-Event zwar vom Store gefeuert, aber der visuelle Loading-Status kam nie als DOM-Update an.
- **Fix:** `tnet-lm-active.js` reagiert jetzt direkt auf `layer-loading` und setzt bzw. entfernt `lm-eye-loading` sofort am betroffenen Eye-Button, statt auf einen spaeteren Full-Render zu warten.
- **Guardrail:** Ladeindikatoren nie nur an einen reinen Renderpfad haengen, wenn dieser zeitweise unterdrueckt werden kann. Bei interaktiven Toggles braucht der visuelle Loading-Zustand einen direkten DOM-Handler.

## 2026-06-03 â€” Alte items-Hierarchien muessen vor dem Rendern ins neue Baumformat normalisiert werden
- **Symptom:** Die Agglomeration zeigte im Themenkatalog nur noch eine flache Reststruktur; tiefere Unterknoten aus dem JSON-Snippet waren im Baum nicht mehr sauber sichtbar.
- **Root-Cause:** Der Katalog-Import verstand nur `nodes`/`subcategories`/`groups`/`layers`. Das alte, rekursive `items`-Schema wurde nicht mehr in das neue Baumformat Ã¼bersetzt und brach die Hierarchie unterwegs ab.
- **Fix:** `tnet-lm-store.js` normalisiert `items` nun rekursiv in `subcategories`/`groups`/`layers` und fuellt fehlende IDs/Namen aus den Schluesseln auf.
- **Guardrail:** Bei Legacy-Katalogen zuerst das Daten-Schema normalisieren, erst dann rendern. Ein neuer Baum-Renderer hilft nicht, wenn die Import-Schicht die Hierarchie schon vorher verliert.

## 2026-06-03 â€” Frischer Bookmark-Wechsel darf Sichtbarkeit nur aus echtem Layer-Overlap uebernehmen
- **Symptom:** Beim direkten Wechsel von `nw_oereb` auf `nw_agglomeration` wurde der neue Karteninhalt weiter mit OEREB-Zustand verunreinigt; gleichzeitig erschien Agglomeration im Karteninhalt als flache, schwer lesbare Liste.
- **Root-Cause:** Der fruehe Storeâ†’Bookmark-Sync in `tnet-mapplus-helpers.js` setzte waehrend des Replace-Fensters pauschal alle neuen Bookmark-Layer auf `visible:false`, auch wenn gar kein echter Layer-Overlap zum vorherigen Bookmark existierte. Zusaetzlich hatte der Active-TOC fuer externe/nicht katalogregistrierte Bookmark-Layer keine synthetische Gruppierung und renderte sie deshalb roh/flach.
- **Fix:** Sichtbarkeitsersatz aus dem Store greift nur noch, wenn der aktuelle Store mindestens einen echten ID-Overlap zum neuen Bookmark hat. Externe Bookmark-Layer werden im Karteninhalt zusaetzlich nach ihrem fachlichen Root-Prefix zu synthetischen Gruppen wie `Basisnetz` und `Siedlungsentwicklung` zusammengefasst.
- **Guardrail:** Beim Bookmark-Wechsel niemals pauschal sichtbare Defaults aus Alt-Storezustand auf ein komplett neues Bookmark uebertragen. Store-Sync nur bei nachweisbarem Layer-Overlap anwenden und fuer externe Bookmark-Layer immer eine lesbare Gruppenstruktur bereitstellen.

## 2026-06-03 â€” Bookmark-Layer ausserhalb des Katalogs duerfen nicht aus dem Karteninhalt herausgefiltert werden
- **Symptom:** Nach `Karte leeren` und erneutem Laden von `nw_agglomeration` blieb der Karteninhalt leer (`0 Themen`), obwohl das Bookmark korrekt 25 Layer lieferte.
- **Root-Cause:** `TnetLMStore.loadActiveLayersFromBookmark()` registrierte nicht renderbare/nicht katalogaufloesbare Bookmark-Layer nur dann, wenn bereits ein passender OL-Layer auf der Karte existierte. Fuer `nw_agglomeration` war das beim Initialimport nicht der Fall, daher wurde der komplette Bookmark-Inhalt verworfen.
- **Fix:** Nicht katalogaufloesbare Bookmark-Layer werden jetzt sofort als Active-Eintraege registriert und nur zusaetzlich fuer spaetere OL-Bindung vorgemerkt.
- **Guardrail:** Der Karteninhalt darf Bookmark-Layer nicht an die unmittelbare Katalog- oder OL-Aufloesbarkeit koppeln. Bookmark ist der Sollzustand und muss auch fuer externe/legacy Layer sofort sichtbar werden.

## 2026-06-03 â€” Bookmark-Neuaufbau braucht einen mehrfachen Strict-Store-Reset in den ersten Sekunden
- **Symptom:** Trotz Clear vor `setMapBookmark` tauchten beim Wechsel einzelne Alt-Layer wieder im Karteninhalt auf (wirkte wie Dazuladen).
- **Root-Cause:** Asynchrone Framework-/OL-Events konnten direkt nach dem Apply den Active-Store kurzfristig wieder mit Altzustand befuellen.
- **Fix:** Nach dem initialen `loadActiveLayersFromBookmark(runtimeLayers)` wird der Store in kurzen Abstaenden nochmals strikt auf dieselben Bookmark-Layer zurueckgesetzt (token-guarded).
- **Guardrail:** Bei Legacy-Bookmarkwechseln mit asynchronem Framework-State nicht nur einmal initialisieren, sondern den Sollzustand kurz nachstabilisieren.

## 2026-06-03 â€” Beim Bookmark-Wechsel immer Store-Clear UND Karten-Clear ausfÃ¼hren
- **Symptom:** Beim Wechsel zwischen Karten/Bookmarks wurden neue Layer zum alten Inhalt addiert; direkt danach erschien teils unberechtigt `Ã„nderungen verwerfen`.
- **Root-Cause:** Der Clear-Pfad brach nach `LMStore.removeAllLayers()` frueh ab. Verzoegerte Framework-Layer auf der Karte blieben dadurch sichtbar und konnten den frischen Bookmark-Zustand wieder verunreinigen.
- **Fix:** Der Bookmark-Apply fuehrt nach dem Store-Clear immer einen zweiten, defensiven Map-Clear-Pass aus (sichtbare thematische Layer vor `setMapBookmark` hart ausblenden).
- **Guardrail:** Bei asynchronen Framework-Layern nie nur den Store leeren. Vor einem harten Rebuild immer Store- und Kartenzustand bereinigen, sonst mischen sich Alt-Layer in den neuen Bookmark.

## 2026-06-03 â€” Bookmark-Wechsel darf keine Alt-Layer per Runtime-Seed oder OL-Add-Events wieder einschleusen
- **Symptom:** Beim Wechsel von `nw_oereb` auf `nw_agglomeration` blieb der Karteninhalt auf OEREB-Layern stehen bzw. nach vorherigem Leeren kam gar kein sauberer Neuaufbau zustande.
- **Root-Cause:** Zwei Pfade liessen Altzustand in den neuen Bookmark-Load hineinlaufen: `tnet-mapplus-helpers.js` uebernahm Runtime-Layer aus `window.__tnetActiveBookmark.layers` auch beim Wechsel auf ein anderes Bookmark, und `tnet-lm-store.js` liess waehrend des neuen Bookmark-Loads verzoegerte OL-Add-Events alter Layer den Active-Store wieder befuellen.
- **Fix:** Runtime-Layer aus dem Vorzustand werden nur noch fuer dasselbe Bookmark als Seed verwendet. Zusaetzlich ignoriert der Store waehrend `bookmark._loadUntil` OL-Add-Events fuer Layer, die nicht zum aktuell ladenden Bookmark gehoeren.
- **Guardrail:** Bei Bookmark-Wechseln den Active-Store als exklusiven Sollzustand behandeln. Weder Runtime-Seeds noch asynchrone Map-Events duerfen Layer aus dem vorherigen Bookmark in den neuen Karteninhalt zurueckmischen.

## 2026-06-03 â€” Karteninhalt-Header muss auch im Leerzustand bestehen bleiben
- **Symptom:** Nach Leeren des Karteninhalts verschwand der komplette Header im Active-Panel; damit war der Kartenname/Fallback (`keine gewÃ¤hlt`) nicht sichtbar und der Zustand wirkte inkonsistent.
- **Root-Cause:** `tnet-lm-active.js` beendete `render()` bei `effectiveLayers.length === 0` sofort mit einem nackten Leerzustand-Block statt denselben Header-Pfad zu rendern.
- **Fix:** Der Header (Karte/Ansicht/Toolbar) wird nun immer gerendert; im Leerzustand erscheint darunter nur der Empty-Block, der Kartenname nutzt weiterhin den Fallback `keine gewÃ¤hlt`, und der Clear-Button ist bei 0 Themen deaktiviert statt zu verschwinden.
- **Guardrail:** In State-basierten Panels den Header nie an die Existenz von ListeneintrÃ¤gen koppeln. LeerzustÃ¤nde gehÃ¶ren unter denselben Header, damit Kontext und Aktionen konsistent bleiben.

## 2026-06-03 â€” Basemap-Farbmodus muss den Widget-Schalter aktiv nachziehen
- **Symptom:** Im Bookmark `nw_oereb` wurde die Grundkarte bzw. nach Basemap-Wechsel das Orthophoto grau gerendert, obwohl der Schalter sichtbar auf `FARBE` stand.
- **Root-Cause:** Der Bookmark-Start setzte `BasemapTimeManager.syncGrayscale(true)` aus `basemapColorMode = grey`, aber der FARBE/GRAU-Button blieb auf seinem HTML-Default (`FARBE active`). Wenn der Sync vor bzw. unabhÃ¤ngig von der Widget-Initialisierung lief, drifteten Renderzustand und UI auseinander.
- **Fix:** `tnet-basemap.js` synchronisiert die FARBE/GRAU-Buttons nun zentral aus dem echten `_isGrayscale`-Status und zieht diesen Zustand auch nach der DOM-Initialisierung des Widgets nochmals nach.
- **Guardrail:** Bei Bookmark-/Startup-Overrides nie nur den Runtime-State setzen. Toggle-Buttons mit Default-Markup muessen nach jedem programmgesteuerten Statuswechsel explizit aus dem echten State synchronisiert werden.

## 2026-06-03 â€” Coalesce-Consistency-Loop darf im Leerlauf keine identischen LAYERS-Updates feuern
- **Symptom:** Beim blossen Start von `https://www.gis-daten.ch/maps-dev/nw_oereb` liefen ohne jede Interaktion fortlaufend ArcGIS-`MapServer/export`-Requests in der Konsole/Network-Ansicht.
- **Root-Cause:** `reconcileMapConsistency()` rief fuer Coalesce-Gruppen im Leerlauf wiederholt `registerSublayer()`/`showSublayer()`/`hideSublayer()` auf. Die Bridge war dabei nicht idempotent: selbst bei unveraendertem Zustand wurden `visibleSublayers` erneut beschrieben, `_updateLAYERSDebounced()` erneut geplant und in `_setLayersOnSource()` identische `LAYERS` per `updateParams()` nochmals auf die Source geschrieben. Das reichte fuer erneute Export-Requests.
- **Fix:** `tnet-coalesce-bridge.js` macht `registerSublayer()`, `showSublayer()` und `hideSublayer()` idempotent und bricht bei unveraendertem Zustand frueh ab. Zusaetzlich ueberspringt `_setLayersOnSource()` `updateParams()` komplett, wenn `LAYERS` und Sichtbarkeit bereits dem Soll entsprechen. Live verifiziert: zuvor in 5s `register=40`, `show=40`, `hide=660`, `apply=19`; nach dem Fix alles `0`, dazu `exportRequests=0`.
- **Guardrail:** Bei Bridge-/Consistency-Pfaden nie auf "gleich nochmal setzen schadet nicht" vertrauen. Bei Layer-Parametern fuehrt schon ein identisches `updateParams()` auf ImageArcGISRest zu echten Netzrequests. Daher jeden Write-Pfad strikt idempotent halten.

## 2026-06-03 â€” Linkes Sidepanel war in der Breite fest auf 340px
- **Symptom:** Das links angedockte Themenkatalog-Panel liess sich nicht mit der Maus verbreitern oder verschmaelern.
- **Root-Cause:** Die Sidepanel-Breite war statisch in CSS/Offsets hinterlegt (`340px`) und es gab keinen horizontalen Resize-Handle mit Drag-Logik.
- **Fix:** Breite auf CSS-Variable `--tnet-sidepanel-width` umgestellt, Desktop-Resize-Handle am rechten Panelrand eingefuehrt, Drag-Logik mit Min/Max-Clamp und localStorage-Persistenz implementiert; abhaengige Offsets (Disclaimer/Such-Dropdown/Scroll-Button) auf dieselbe Variable gekoppelt.
- **Guardrail:** Bei fixierten Legacy-Sidepanels immer zuerst eine zentrale Breitenvariable einfuehren und danach alle flankierenden Offsets daran anbinden, sonst laufen Handle und UI-Elemente visuell auseinander.

## 2026-06-03 â€” Karteninhalt: Event-Sturm (layer-loading/active-layers-changed) baut Liste 16x/s neu
- **Symptom:** Opacity-Regler klemmte beim ersten Griff (zweiter ging), Sichtbarkeits-Auge flimmerte schon beim blossen Hovern, und der erste Klick aufs Auge wurde teils verschluckt.
- **Root-Cause:** Das Framework (u.a. CoalesceBridge-Retry) emittiert im Leerlauf `layer-loading` UND `active-layers-changed` je ~16x/s OHNE echte Zustandsaenderung. Beide haengen an `_scheduleRender` â†’ `render()` baute jedes Mal `_container.innerHTML` komplett neu. Per Playwright verifiziert: Layer-Snapshot ueber 3s identisch, dennoch wurden Auge-/Slider-/Item-Knoten 16x/s ausgetauscht (`eyeReplacedWhileIdle: true`). Der staendige Knoten-Austausch unterbrach den nativen Slider-Drag und resettete den Hover-State.
- **Fix:** `tnet-lm-active.js` `render()` vergleicht das fertig zusammengebaute HTML mit dem letzten Stand (`_lastRenderHtml`). Ist es identisch und der Container bereits befuellt, wird die `innerHTML`-Zuweisung uebersprungen â€” kein DOM-Mutation, kein Knoten-Austausch. `_lastRenderHtml` wird bei Leerzustand, Bookmark-Reset und direkter Badge-Mutation (`_refreshModifiedBadge`) invalidiert. Verifiziert unter vollem Sturm: alle `*ReplacedWhileIdle: false`, Auge schaltet beim ersten Klick, Slider bleibt waehrend Drag erhalten.
- **Guardrail:** Bei hochfrequenten Framework-Events (loading/changed) nie ungebremst `innerHTML` neu schreiben. render() idempotent machen: identisches Ausgabe-HTML â†’ DOM unangetastet lassen. Der zuverlaessigste Vergleich ist das finale HTML selbst (keine Feld-Signatur, die Felder vergessen kann).

## 2026-06-03 â€” Karteninhalt: Eye-Toggle und Opacity-Drag durch Full-Rebuild via bookmark-state-changed blockiert
- **Symptom:** Trotz inline-DOM-Updates und Pending-State blieb der Deckkraft-Regler beim Ziehen haengen und das Sichtbarkeits-Auge flimmerte beim Hover; Schaltung wirkte verzoegert.
- **Root-Cause:** `_onVisibility`/`_onOpacity` riefen `emitBookmarkStateChanged()`. Der `tnet-bookmark-state-changed`-Listener ruft `self.render()` **direkt** auf (umgeht den `_suppressVisibilityRender`/`_scheduleRender`-Guard) und baut bei einem 135-Layer-Bookmark die komplette `innerHTML`-Liste neu â€” der gerade angefasste Slider-/Auge-Knoten wird dabei zerstoert. Per Playwright verifiziert: `eyeNodeReplaced: true`, `sliderNodeReplaced: true`, Frames aber 60fps (kein JS-Jank).
- **Fix:** `tnet-lm-active.js` `render()` bricht bei aktivem `_suppressVisibilityRender` oder `_activeOpacitySlider` vor dem Full-Rebuild ab und zieht nur das Modified-Badge per neuer `_refreshModifiedBadge()` leichtgewichtig nach. Nach Verifikation: `nodeReplaced: false` fuer Auge und Slider, Live-Label aktualisiert weiter.
- **Guardrail:** Bei optimistischer UI nicht nur `_scheduleRender` guarden â€” JEDER Renderpfad (auch direkte `self.render()`-Aufrufe aus Event-Listenern wie `bookmark-state-changed`) muss waehrend aktiver Slider-/Toggle-Interaktion den Full-Rebuild ueberspringen, sonst zerstoert er den angefassten DOM-Knoten.

## 2026-06-03 â€” Karteninhalt muss Sichtbarkeit und Deckkraft zuerst lokal reagieren lassen
- **Symptom:** Augen-Toggles und Deckkraftregler im Karteninhalt wirkten trotz funktionierender Store-Logik trÃ¤ge, weil die UI auf den synchronen Karten-/Storepfad wartete.
- **Root-Cause:** Das Active-Panel delegierte Visibility und Opacity direkt in den Store. Die sichtbare Reaktion im DOM hing dadurch an nachgelagerten Karten- und Framework-Updates statt am unmittelbaren User-Intent.
- **Fix:** `tnet-lm-active.js` fuehrt einen optimistischen Pending-UI-State pro Layer ein. Auge und Deckkraft werden zuerst lokal im Panel aktualisiert; der Store wird erst leicht verzoegert idempotent per `setLayerEye()` bzw. Opacity-Setter nachgezogen und raeumt den Pending-State ueber Store-Events wieder auf.
- **Guardrail:** Bei interaktiven Layer-Panels nie die sichtbare Rueckmeldung an teure Store-/Kartenpfade koppeln. Erst den User-Intent lokal rendern, danach den Runtime-State asynchron nachziehen und per Event wieder auf echten Zustand reconciliieren.

## 2026-06-03 â€” Deckkraft-Regler darf die Karte nicht bei jedem Slider-Pixel neu rechnen
- **Symptom:** Der Deckkraft-Regler im Karteninhalt ruckelte beim Ziehen spuerbar; besonders Gruppen-Opacity fuehlte sich hakelig an.
- **Root-Cause:** Der `input`-Handler schrieb jeden einzelnen Slider-Zwischenschritt sofort in den Store und damit bis zur Karte durch. Bei vielen `input`-Events pro Drag blockierte der Karten-Update-Pfad den Regler.
- **Fix:** `tnet-lm-active.js` puffert Opacity-Aenderungen kurz an, aktualisiert nur die sichtbare Prozentanzeige sofort und schreibt den letzten Wert gesammelt mit kurzem Delay in den Store; beim `change` wird der Endwert sofort geflusht.
- **Guardrail:** Slider-UI und Karten-Writeback entkoppeln. Bei teuren Layer- oder Kartenupdates nie jeden `input` 1:1 bis zur Runtime durchreichen; waehrend des Drags kurz takten, beim Loslassen final synchronisieren.

## 2026-06-03 â€” Eye-Aktivierung darf bei spaetem LyrMgr nicht erst den zweiten Klick brauchen
- **Symptom:** Das Aktivieren eines ausgeschalteten Layers per Auge reagierte teils nicht sofort; erst nach kurzer Wartezeit und erneutem Klick liess sich der Layer einschalten.
- **Root-Cause:** `toggleLayerEye()` fiel fuer Lazy-Load-Aktivierungen auf `TnetLayerSwitch(layerId, 'on')` zurueck. Wenn `AppManager`/Map oder `LyrMgr` in diesem Moment noch nicht bereit waren, endete der erste Aktivierungsversuch wirkungslos.
- **Fix:** `TnetLayerSwitch()` merkt sich fehlgeschlagene `on`-Aktivierungen kurzzeitig und versucht denselben Aufruf automatisch erneut, bis Map/LyrMgr verfuegbar sind oder das Retry-Fenster auslaeuft.
- **Guardrail:** UI-Klicks auf Lazy-Load-Layer duerfen nicht von einem einzelnen Initialisierungs-Moment abhaengen. Wenn der Aktivierungspfad waehrend des Framework-Starts auf noch nicht bereite Manager trifft, muss derselbe Klick nachgezogen statt verworfen werden.

## 2026-06-02 â€” Bookmark-Dirty darf Opacity nicht als globalen Default vergleichen
- **Symptom:** Nach URL-Bookmarks erschien der Stern-/Undo-Zustand wegen Deckkraftabweichungen, obwohl fachlich dieselben sichtbaren Layer wie im Bookmark aktiv waren.
- **Root-Cause:** Die Dirty-Pruefung rekonstruierte Opacity aus Bookmark, View-State und Katalog-Fallbacks. In MAP+ gibt es aber keinen globalen Deckkraft-Default; Opacity ist je Layer definiert und kann in Bookmarks optional ueberschrieben werden.
- **Fix:** Die Bookmark-Dirty-Pruefung vergleicht vorerst nur noch die Menge der sichtbaren Layer gegen den Bookmark-Default. Opacity und Reihenfolge werden ignoriert.
- **Guardrail:** Fuer Stern/Undo bei URL-Bookmarks nur sichtbare Layer als Widerspruch werten. `layers=` in der URL beschreibt ausschliesslich sichtbare Layer; Opacity darf ohne belastbaren layerbezogenen Default nicht als Dirty-Kriterium dienen.

## 2026-06-02 â€” Framework-URL-Refresh muss waehrend URL-Override-Bookmark-Start eingefroren werden
- **Symptom:** Nach Start von `maps-dev/nw_oereb?...&layers=...&op=0.65` sprang der Permalink nach rund 12 bis 14 Sekunden kurz auf `op=0.7` und erst danach wieder zurueck auf `0.65`.
- **Root-Cause:** Die spaeten `ClassicLayerMgr.Activate`-/`switchLayersProgr`-Durchlaeufe kamen noch innerhalb des URL-Override-Starts, aber ausserhalb des bisherigen Initial-URL-Guard-Fensters von 8 Sekunden. Dadurch durfte der fruehe History-/Op-Guard zu frueh auslaufen und spaete Framework-Defaults wieder in den Permalink schreiben.
- **Fix:** Das Initial-URL-Guard-Fenster in Entry-HTML und `tnet-app.js` wurde auf 18 Sekunden verlaengert; der begleitende Op-Stabilisator laeuft passend laenger. Damit bleiben `layers=` und `op=` stabil, bis die spaeten Framework-URL-Rewrites abgeklungen sind.
- **Guardrail:** Bei URL-Override-Bookmarks die Guard-Dauer am realen Framework-Startup ausrichten, nicht an einem optimistischen Fruehfenster. Wenn spaete Layer-/Tool-Aktivierungen den Permalink noch ueberschreiben koennen, muss der Initial-URL-Guard bis nach diese Phase aktiv bleiben.

## 2026-06-02 â€” Eye-Toggle darf keinen Voll-Render des Karteninhalts triggern
- **Symptom:** Beim Umschalten der Augen im Karteninhalt wirkte das Eye instabil bzw. flackernd; gleichzeitig wurde der Permalink auch bei reinen Sichtbarkeitswechseln unnÃ¶tig stark nachgezogen.
- **Root-Cause:** `toggleLayerEye()` emittierte neben `layer-visibility` zusÃ¤tzlich `active-layers-changed`, obwohl sich die Liste der aktiven Themen gar nicht Ã¤nderte. Der Karteninhalt reagierte dadurch mit einem kompletten `innerHTML`-Rebuild statt nur das betroffene Eye zu aktualisieren.
- **Fix:** Im Eye-Toggle-Pfad bleibt nur noch `layer-visibility` aktiv. Add/Remove-Operationen emittieren weiter `active-layers-changed`, reine Sichtbarkeitswechsel dagegen nicht mehr.
- **Guardrail:** Sichtbarkeit und Listenstruktur getrennt behandeln: `layer-visibility` fuer Icon-/Status-Updates, `active-layers-changed` nur wenn Eintraege wirklich hinzukommen, verschwinden oder umsortiert werden.

## 2026-06-03 â€” Initiale URL-Guards duerfen echte Karteninhalt-Aenderungen nicht mehr ueberschreiben
- **Symptom:** Nach einer Aenderung im Karteninhalt sprang die URL waehrend mehrerer Sekunden zwischen dem neuen Zustand und dem urspruenglichen Start-`layers=`/`op=` hin und her.
- **Root-Cause:** Der verlaengerte Initial-URL-Guard schuetzte zwar den Startup, blieb aber auch nach echten Sichtbarkeitswechseln aus dem Karteninhalt aktiv. Dadurch arbeiteten Initial-Guard und spaeterer Bookmark-URL-Sync gegeneinander.
- **Fix:** Der Bookmark-URL-Sync schaltet die initialen History-/HTML-Guards bei der ersten nicht-`bookmark-init`-Sichtbarkeitsaenderung ab, sobald sie vom urspruenglichen URL-Layerzustand wegfuehrt. Zusaetzlich reagiert der URL-Sync nur noch auf Aenderungen der sichtbaren Layer-Signatur.
- **Guardrail:** Startup-Guards muessen enden, sobald der User den Karteninhalt real veraendert. Ab diesem Moment ist nicht mehr der initiale Permalink, sondern der aktuelle Runtime-State die Wahrheit.

## 2026-06-02 â€” Coalesce-Reconcile darf Loading nicht ohne Renderaenderung neu starten
- **Symptom:** Nach dem Bookmark-Load blieb im Karteninhalt dauerhaft `lÃ¤dt...`, obwohl der kombinierte `show:`-Layer bereits korrekt sichtbar war.
- **Root-Cause:** `_forceCoalesceGroupRender()` startete Loading bei jedem Reconcile erneut, auch wenn `LAYERS` und Sichtbarkeit unveraendert waren.
- **Fix:** Der Coalesce-Gruppenrenderer prueft nun `LAYERS` und Sichtbarkeit idempotent und startet Loading nur noch bei tatsaechlichen Renderaenderungen.
- **Guardrail:** Reconcile-Funktionen duerfen Ladefeedback nicht als Nebeneffekt jedes Abgleichs starten. Spinner nur bei echten Map-Param-/Visibility-Aenderungen aktivieren.

## 2026-06-02 â€” URL-Sync darf `op=` nicht aus Reconcile-Events neu berechnen
- **Symptom:** Nach URL-Bookmarks sprang `op=` im Permalink laufend zwischen Werten wie `0.65` und `0.7`, weil im Hintergrund Store-/Reconcile-Events konkurrierten.
- **Root-Cause:** Der Live-URL-Sync schrieb `op=` bei `layer-opacity` und `active-layers-changed` immer wieder aus dem aktuellen Runtime-State neu. Automatische Korrekturen und Framework-Defaults konnten dadurch den Permalink gegenseitig Ã¼berschreiben.
- **Fix:** Der Bookmark-URL-Sync aktualisiert live nur noch `layers=`. Der urspruengliche URL-`op`-Wert wird beim Bookmark-Start gesichert und stabil gehalten; zusaetzlich faengt ein frueher History-Guard bereits die ersten Framework-`replaceState`-Aufrufe ab. `op=` wird nur entfernt, wenn die Anzahl der Opacity-Werte nicht mehr zur sichtbaren Layerliste passt.
- **Guardrail:** `op=` nie aus automatischen Reconcile-/Store-Events als Wahrheit neu berechnen. Opacity-Parameter sind optionaler URL-Input, waehrend `layers=` die sichtbare Layerliste beschreibt; fruehe URL-Snapshots muessen spaetere Framework-Rewrites uebersteuern.

## 2026-06-02 â€” URL-Bookmark muss layers-State live synchronisieren
- **Symptom:** Reloads von URL-Bookmarks wie `nw_oereb?...&layers=...` schalteten wieder die Bookmark-Defaults ein; nach Augen-Klicks blieb der `layers=`-Permalink ausserdem stale.
- **Root-Cause:** `startBookmarkFromUrl()` startete den Pfad-Bookmark ohne den vorhandenen `layers=`-Permalink-State an `TnetSetBookmark()` weiterzugeben; spaeteres Lesen war race-anfaellig, weil Framework/Hooks die URL bereits umschreiben koennen. Danach gab es keinen zentralen Runtime-State-zu-URL-Sync fuer Bookmark-Layer.
- **Fix:** Der Auto-Start sichert den initialen Query-String sofort beim Laden von `tnet-app.js` und uebergibt ihn als Override an den Bookmark-Helper. Der Helper wendet URL-Werte wie `lang`, `basemap`, `blop`, `x`, `y`, `zl`, `hl`, `layers` und `op` vor Bookmark-Defaults an und schreibt nach `layer-visibility`/`layer-opacity`/`active-layers-changed` den effektiven Runtime-State live nach `layers=` und `op=`.
- **Guardrail:** Bei Pfad-Bookmarks mit Query-State hat der Permalink immer Vorrang vor Bookmark-Defaults. URL-Parameter als User-Anpassung behandeln: Bookmark-Kontext laden, alle vorhandenen URL-Parameter anwenden, Abweichung markieren und danach `layers=` immer aus aktuellem Runtime-/Store-Zustand neu schreiben.

## 2026-06-02 â€” Karteninhalt und Karte muessen nach Combined-Layer-Aktionen reconciled werden
- **Symptom:** Der Karteninhalt zeigte Coalesce-/Combined-Sublayer als sichtbar, waehrend der gerenderte ArcGIS-Root-Layer nicht sichtbar war oder nur ein einzelnes `show:N` enthielt; nach Undo wurden Layer erst nach Auge aus/ein wieder dargestellt.
- **Root-Cause:** OL-Add/Remove-Events fuer dedizierte Sublayer wurden als Wahrheit fuer den Store interpretiert, obwohl derselbe Sublayer weiterhin in einem kombinierten Root-Layer (`LAYERS=show:...`) gerendert werden kann. Zusaetzlich lief der Reconcile teils vor den spaeten Framework-Layer-Manipulationen.
- **Fix:** Storeâ†”Karte-Reconcile zentral nach `active-layers-changed`, `layer-visibility` und `layer-opacity` anstossen; sichtbare Sublayer serviceweit zu `show:a,b` zusammenfuehren; OL-Remove ignorieren, wenn der Sublayer weiterhin in einem sichtbaren combined Layer gerendert wird.
- **Guardrail:** Bei ArcGIS-Combined-/Coalesce-Layern darf ein einzelnes OL-Layer-Remove nie automatisch bedeuten, dass der Sublayer fachlich ausgeschaltet ist. Immer gegen den aktuellen Root-`show:`-Parameter und den Store-Sollzustand reconciliieren.

## 2026-06-02 â€” Stage-Build darf Quellen nie ueberschreiben
- **Symptom:** Ein Build-Test ohne explizite Roots konnte `maps-dev/tnet/js/` mit minifizierten Artefakten ueberschreiben; zusaetzlich blieb eine `tnet-prod-*.js` Temp-Datei in `js-stage/` liegen.
- **Root-Cause:** Die Default-Root-Erkennung im Build-Helfer war noch auf alte `js-dev -> js` Rollen ausgelegt und die Stage-Validierung pruefte nur fehlende, nicht aber ueberzaehlige Dateien.
- **Fix:** Build-Defaults auf `maps-dev/tnet/js -> maps-dev/tnet/js-stage` gesetzt, Output=Input als harten Fehler blockiert und PROD-Promotion auf exakte Source/Stage-Dateimenge gehaertet.
- **Guardrail:** Stage vor PROD-Promotion immer 1:1 gegen DEV-Originale validieren; Temp-Dateien oder fremde JS-Dateien in `js-stage/` muessen den Release stoppen.

## 2026-06-02 â€” PROD-Runtime-JS muss aus js-stage kommen
- **Symptom:** Nach `release-full.bat` wirkten PROD-JS-Dateien teilweise nicht minifiziert/obfuskiert oder konnten durch Promotion wieder als Originale in `maps/tnet/js/` landen.
- **Root-Cause:** DEV-Originale, PROD-Quellstand und PROD-Runtime nutzten zu lange dieselben Ordnerrollen (`js`, `js_ori`). Der PROD-Release baute/ladete inkrementell und war dadurch vom Upload-State sowie der Reihenfolge aus Promotion und Build abhÃ¤ngig.
- **Fix:** DEV baut lokal `maps-dev/tnet/js-stage/`; PROD kopiert Originale nach `maps/tnet/js-src/` und Stage-Artefakte nach `maps/tnet/js/`. Full-Release verwendet `--force-js`, damit Runtime-JS nach Stage-Kopie sicher hochgeladen wird.
- **Guardrail:** PROD-Runtime-JS darf nie direkt aus `maps-dev/tnet/js/` stammen. Standardpfad ist immer `maps-dev/tnet/js` â†’ `maps-dev/tnet/js-stage` â†’ `maps/tnet/js`; lesbare PROD-Quellen liegen in `maps/tnet/js-src`.

## 2026-06-03 â€” Ansichtswechsel im selben Bookmark darf keinen Full-Apply ausloesen
- **Symptom:** Bei `nw_agglomeration` schaltete `Standard` â†” `test` die Themen nicht sauber um; nach dem Wechsel blieben teils keine sichtbaren Layer mehr uebrig.
- **Root-Cause:** `_applyBookmark()` behandelte einen reinen View-Wechsel innerhalb desselben Bookmarks wie einen kompletten Bookmark-Neuaufbau. Das Legacy-Full-Apply raeumte dabei Layer- und Runtime-Zustand unnoetig ab und lief in instabile Rebuild-Pfade.
- **Fix:** Derselbe Bookmark mit anderer `viewId` geht jetzt frueh ueber `_applyViewSwitchOnly()`, das nur die Layer-Sichtbarkeit umschaltet und Runtime/Store anschliessend auf die neue View synchronisiert.
- **Guardrail:** Wenn sich bei einem Bookmark nur die View aendert, niemals reflexartig `setMapBookmark`/Full-Apply verwenden. Erst den reinen Visibility-Diff-Pfad bevorzugen; Rebuild nur fuer echten Bookmark-Wechsel.

## 2026-06-03 â€” Reiner View-Switch darf nicht erneut Bookmark-API und Ready-Wait durchlaufen
- **Symptom:** Das Umschalten zwischen `Standard` und `test` funktionierte, fuehlte sich aber sehr langsam an.
- **Root-Cause:** `TnetSetBookmark()` lud auch beim Wechsel derselben bereits aktiven Karte das Bookmark erneut per API und wartete nochmals auf Framework-Readiness, obwohl `window.__tnetActiveBookmark._cfg` schon vorlag.
- **Fix:** Fuer denselben aktiven Bookmark mit geaenderter `viewId` nutzt `TnetSetBookmark()` jetzt direkt die vorhandene `_cfg` und springt sofort in `_applyBookmark()` bzw. den View-only-Pfad.
- **Guardrail:** Bei reinen Zustandswechseln innerhalb eines bereits geladenen Bookmarks niemals erneut Netzwerk-Load plus globalen Ready-Wait anhaengen, wenn derselbe Konfigurationsstand schon im Runtime-State vorhanden ist.

## 2026-06-03 â€” URL-Bookmark-Start braucht fruehes sichtbares Ladefeedback
- **Symptom:** Beim direkten Aufruf von `maps-dev/nw_agglomeration` sah der User erst die Grundkarte; der Fachinhalt und das geoeffnete Karteninhalt-Panel kamen erst Sekunden spaeter, wodurch der Start haengen geblieben wirkte.
- **Root-Cause:** Der URL-Autostart wartet still auf Helper-, AppManager- und LayerManager-Readiness, bevor `tnet-bookmark-loaded` ueberhaupt feuert. Bis dahin gab es im Karteninhalt weder geoeffnetes Panel noch sichtbaren Pending-Zustand.
- **Fix:** Der URL-Start setzt nun sofort einen globalen Pending-Bookmark-Status, das Karteninhalt-Panel oeffnet bereits in dieser Vorphase und rendert einen klaren Ladeblock, bis der echte Bookmark-Inhalt uebernimmt.
- **Guardrail:** Bei Legacy-Bookmark-Starts nie erst auf den finalen Apply-Event warten, bevor der UI-Zustand reagiert. Sobald die Zielkarte bekannt ist, muss die Oberflaeche einen sichtbaren Pending-State zeigen.

## 2026-06-03 â€” URL-Autostart darf nicht am LayerManager-Ready-Gate haengen
- **Symptom:** Die Bookmark-Hydrierung fuer `maps-dev/nw_agglomeration?...` begann erst viele Sekunden nach dem initialen Seitenstart, obwohl URL-Layer, `TnetSetBookmark` und `AppManager` bereits frueh verfuegbar waren.
- **Root-Cause:** `startBookmarkFromUrl()` wartete zusaetzlich auf `isLayerManagerReady()`. Dieser Zustand wurde im Legacy-Stack deutlich spaeter erreicht als die fuer `TnetSetBookmark()` wirklich noetigen Voraussetzungen.
- **Fix:** Der URL-Autostart startet jetzt, sobald `TnetSetBookmark` und `AppManager.setMapBookmark` verfuegbar sind. Der tiefere Framework-Ready-Wait bleibt zentral in `TnetSetBookmark()`.
- **Guardrail:** Readiness-Gates nur einmal an der owning abstraction halten. Wenn der Helper selbst auf Framework-Ready wartet, darf der Call-Site-Code kein zweites, strengeres Gate davorschalten.

## 2026-06-03 â€” URL-Override mit expliziten Layern darf keinen spaeten Full-Apply ausloesen
- **Symptom:** Eine URL wie `nw_agglomeration?...&layers=...` zeigte die Fachlayer zuerst korrekt und schnell, spaeter wurden sie jedoch durch einen Bookmark-Apply wieder geraeumt bzw. auf einen unvollstaendigen Zustand reduziert.
- **Root-Cause:** Beim initialen URL-Override-Start fuehrte `TnetSetBookmark()` spaeter noch einen kompletten `_applyBookmark()` aus. Dieser ruft `_clearThematicLayersBeforeBookmark()` auf und zerstoert damit den bereits korrekt aus der URL aufgebauten Kartenzustand.
- **Fix:** Fuer den initialen URL-Override-Start mit expliziten `visibleLayerIds` nutzt der Helper jetzt einen URL-Adopt-Pfad: Bookmark-Metadaten und Karteninhalt werden hydratisiert, ohne Karte/Layer per Full-Apply nochmals zu leeren und neu zu setzen.
- **Guardrail:** Wenn der Runtime-Kartenzustand bereits explizit aus der URL kommt, Bookmark-Metadaten nur noch an diesen Zustand andocken. Einen spaeten Full-Apply nur fuer Faelle verwenden, in denen der Bookmark den Kartenzustand wirklich erst herstellen muss.

## 2026-06-03 â€” Tree-Checkboxen muessen Bookmark-Sichtbarkeit, nicht nur OL-Renderzustand spiegeln
- **Symptom:** Im Themenkatalog blieben Gruppen- und Layer-Checkboxen leer, obwohl dieselben Themen bereits im Karteninhalt aktiv waren.
- **Root-Cause:** Der Tree nutzte fuer den Checked-State `isLayerEffectivelyVisible()`. Bei ArcGIS-/Bookmark-Layern kann dieser Render-Check kurzzeitig `false` liefern, obwohl Store und aktiver Bookmark die Layer bereits bewusst auf sichtbar gesetzt haben.
- **Fix:** Fuer Tree-Checkboxen und Gruppen-States wird jetzt ein eigener Requested-Visibility-Pfad genutzt, der zuerst den aktiven Store-/Bookmark-Zustand und erst danach den Katalog-Fallback liest.
- **Guardrail:** UI-Checkboxen im Themenkatalog duerfen nicht direkt vom tiefsten Render/OL-State abhaengen, wenn Bookmark- oder Bridge-Logik Layer vor der finalen OL-Hydrierung bereits als aktiv fuehrt.

## 2026-06-03 â€” Pending-Header darf nie rohe Bookmark-IDs anzeigen
- **Symptom:** Im Karteninhalt erschien beim schnellen URL-Start kurz `nw_agglomeration` statt des Anzeigenamens `Agglomerationsprogramm 2. Gen.`.
- **Root-Cause:** Der Pending-State erhielt beim URL-Autostart nur die Bookmark-ID und renderte diese sofort im Header, bevor der eigentliche Bookmark-Name nachgeladen war.
- **Fix:** Der Pending-State startet jetzt ohne rohe ID im Header, nutzt wenn verfuegbar einen gecachten Anzeigenamen und aktualisiert sich parallel ueber `TnetApi.listBookmarks()` auf den echten Kartennamen.
- **Guardrail:** Vorlaeufige Lade-UI darf nie interne IDs als Nutzertext zeigen, wenn ein Anzeigename asynchron nachgereicht werden kann. Im Zweifel neutralen Platzhalter statt technischen Key rendern.

## 2026-06-03 â€” Remove-Buttons im Karteninhalt muessen trotz Desktop-Overrides sichtbar bleiben
- **Symptom:** Das Entfernen-Kreuz war im Karteninhalt zwar im DOM vorhanden, blieb aber unsichtbar und nicht nutzbar.
- **Root-Cause:** Eine Desktop-CSS-Kombination reduzierte die Remove-Buttons effektiv auf `display:none` bzw. Breite 0, obwohl das Rendering korrekt war.
- **Fix:** Die Desktop-Regel fuer `.lm-btn-remove` erzwingt jetzt wieder ein sichtbares Flex-Layout.
- **Guardrail:** Bei interaktiven Action-Buttons im Legacy-Panel nach CSS-Refactors immer DOM und Computed-Style pruefe; vorhandenes Markup ohne sichtbare Box ist fast immer ein Styling-Regression, kein Render-Bug.

## 2026-06-03 â€” Active-Panel darf keine Container-Knoten als Einzel-Layer rendern
- **Symptom:** Beim Entfernen einzelner Layer aus einer Coalesce-/Bookmark-Gruppe sprang ploetzlich ein Parent-Knoten (z.B. `Motorisierter Individualverkehr (MIV)`) als eigener Layer-Eintrag unten in die Liste.
- **Root-Cause:** In der gemergten Active-Liste standen neben Blatt-Layern auch nicht-blattrige Katalogknoten (`type: group`) mit eigener ID. Beim Neu-Render nach einem Remove wurden diese Container als Standalone-Eintrag gerendert.
- **Fix:** Vor dem Rendern werden in `tnet-lm-active.js` nicht-blattrige Katalogknoten aus `effectiveLayers` herausgefiltert (`pruneContainerCatalogLayers`). Dadurch bleiben nur echte Layer-Zeilen sichtbar.
- **Guardrail:** Der Karteninhalt darf nur Blatt-Layer darstellen. Katalog-Container gehoeren in die Baumstruktur, nicht in die Active-Liste.

## 2026-06-03 â€” Ladehinweis nur bei echtem Pending-Zustand anzeigen
- **Symptom:** Im Karteninhalt blieb `Karte wird geladen...` sichtbar, obwohl Bookmark und Themen bereits voll geladen waren.
- **Root-Cause:** Der Header koppelte den Ladehinweis zusaetzlich an ein internes `_loadUntil`-Zeitfenster. Dieses kann nach erfolgreichem Load noch laufen und erzeugt dadurch einen falschen UI-Status.
- **Fix:** Der Ladehinweis wird jetzt nur noch bei echtem Pending-Bookmark (`__tnetPendingBookmarkLoad`) angezeigt, nicht mehr aufgrund eines Zeitfensters.
- **Guardrail:** Sichtbarer Ladezustand darf nur von echten Pending-/InFlight-Flags abhÃ¤ngen, nie von einer pauschalen Schonfrist.

## 2026-06-03 â€” Karteninhalt-Header nach "Karteninhalt leeren" sofort hard-resetten
- **Symptom:** Nach `Karteninhalt leeren` blieb kurz oder dauerhaft der alte Bookmark-Name im Header stehen.
- **Root-Cause:** Der Header wartete auf nachlaufende Store-Events; bei verzÃ¶gerten/ausbleibenden Events blieb der alte Renderzustand sichtbar.
- **Fix:** Beim `remove-all` wird der Header sofort mit `render([])` neu gezeichnet, `__tnetActiveBookmark`/`__tnetPendingBookmarkLoad` werden geleert und URL-Hinweise per `__tnetSuppressUrlBookmarkHint` unterdrÃ¼ckt.
- **Guardrail:** Bei globalen Reset-Aktionen im Legacy-UI immer eine unmittelbare UI-Neuzeichnung erzwingen, statt ausschlieÃŸlich auf asynchrone Event-Ketten zu vertrauen.

## 2026-06-01 â€” Deploy-Workflow braucht klare JS-Ordnerrollen
- **Symptom:** Nach PROD-Updates war unklar, ob `/maps/tnet/js` lesbare DEV-Dateien, DEV-Builds oder minifizierte PROD-Artefakte enthaelt; alte Temp-Dateien `tnet-prod-*.js` lagen im Runtime-Ordner.
- **Root-Cause:** `js-dev` und `js` wurden gleichzeitig als Quelle, Build-Ziel und Deploy-Signal verwendet. PROD-Promotion kopierte DEV 1:1 nach `maps`, danach wurde derselbe `js`-Ordner ueberschrieben; ein lesbarer PROD-Zwischenstand fehlte.
- **Fix:** DEV nutzt kuenftig `maps-dev/tnet/js` als direkte Original-Quelle. PROD-Promotion sichert den lesbaren Stand nach `maps/tnet/js_ori`; der PROD-Build erzeugt daraus `maps/tnet/js` und bereinigt alte `tnet-prod-*.js` Temp-Artefakte.
- **Guardrail:** Runtime-Pfad darf gleich bleiben (`tnet/js/...`), aber die Ordnerrolle muss pro Umgebung eindeutig sein: DEV `js` = Quelle, PROD `js_ori` = lesbare Quelle, PROD `js` = Build-Artefakt.

## 2026-06-01 â€” PROD-Templates duerfen keine absoluten DEV-Assetpfade enthalten
- **Symptom:** Nach einem PROD-Update lud `/maps/` TNET-JS/CSS weiterhin aus `/maps-dev/tnet/...`; PROD nutzte damit nicht zuverlaessig die minifizierten/obfuskierten Assets aus `maps/tnet/js`.
- **Root-Cause:** Die per Promotion kopierten HTML-Templates enthielten absolute `/maps-dev/tnet/...` Pfade; die nachgelagerte PHP-Transformation konnte nur kanonische `/maps/...` Pfade auf DEV umbiegen, nicht aber DEV-Pfade in PROD verhindern.
- **Fix:** TNET-Assetreferenzen in Desktop- und Mobile-Templates auf relative `tnet/...` Pfade umgestellt und die app-root String-Transformation im Entry entfernt; der Login-Redirect verwendet nun den ermittelten App-Root.
- **Guardrail:** Gemeinsame `maps`/`maps-dev` Templates duerfen fuer App-Assets keine absoluten `/maps` oder `/maps-dev` Pfade enthalten. Relative Pfade oder `window.__TNET_APP_ROOT` verwenden, damit DEV/PROD ohne Transform-Schritt korrekt laden.

## 2026-06-01 â€” Coalesce-Gruppenauge muss Root-Layer aktiv reconciliieren
- **Symptom:** Bei Gruppen wie `Kbs (rechtskrÃ¤ftig)` zeigte das Gruppenauge nach EIN einen sichtbaren Zustand, aber die Objekte wurden erst dargestellt, nachdem einzelne Unterlayer aus/ein geschaltet wurden.
- **Root-Cause:** Der Gruppenpfad aktualisierte Store/KindzustÃ¤nde, aber bei Framework-kombinierten bzw. Bridge-verwalteten Coalesce-Layern wurde die tatsÃ¤chliche Root-`LAYERS=show:...`-Liste nicht immer neu aufgebaut. Einzelkind-Toggles durchliefen den Register-/Show-Pfad und reparierten den Root-Layer dadurch nachtrÃ¤glich.
- **Fix:** Nach Gruppen-AUS/EIN wird der Coalesce-Root-Layer aktiv reconciled: sichtbare Kinder werden registriert/gezeigt, unsichtbare per Bridge versteckt, `activeSublayers` neu aufgebaut und der gerenderte OL-Layer direkt auf `show:<nums>` bzw. `show:-1` gesetzt.
- **Guardrail:** Gruppenaugen bei Coalesce nie nur als Store-Massenupdate behandeln. Nach jedem Gruppen-Toggle den tatsÃ¤chlichen Root-Render-Layer gegen die sichtbare Kindliste abgleichen.

## 2026-06-01 â€” Objektinfo muss sichtbare Runtime-Layer filtern
- **Symptom:** Objektinformationen lieferten Resultate von ausgeschalteten Layern; gleichzeitig fehlten sichtbare Coalesce-Sublayer wie `Grundnutzung` teilweise in der Abfrage.
- **Root-Cause:** Die InfoBridge dispatchte stur `am.wmsActiveLyrs`; diese Framework-Liste kann nach Store-/Coalesce-Toggles stale sein. Der Coalesce-`queryconnector` liess ausserdem Root-Queries bei leerer `visibleSublayers`-Liste durch.
- **Fix:** Vor jedem Info-Klick synchronisiert die InfoBridge MapTips gegen den effektiven Store-/OL-Zustand. Der Coalesce-Queryconnector blockt nicht sichtbare Store-Sublayer und behandelt eine leere sichtbare Sublayer-Liste als â€žnichts abfragenâ€œ.
- **Guardrail:** Objektinfo nie direkt aus `wmsActiveLyrs` als Wahrheit ableiten. Vor dem Dispatch immer gegen den effektiven Karteninhalt/Store filtern; bei Coalesce ist eine leere `show:`-/visible-Liste ein harter Skip.

## 2026-06-01 â€” Ladefeedback darf nicht von zuverlÃ¤ssigen OL-End-Events abhÃ¤ngen
- **Symptom:** Langsame Layer wie KBS wirkten nach dem Einschalten sekundenlang inaktiv; ein reines `loadend`-Warten kann bei kombinierten/Framework-Layern zudem zu lange sichtbare Spinner oder falsche Fehler erzeugen.
- **Root-Cause:** Store und Karteninhalt setzten Sichtbarkeit sofort, aber es gab keinen UI-Zwischenzustand; einzelne OpenLayers-Sources liefern in diesem Legacy-Stack nicht immer passende End-Events fÃ¼r den konkreten Sublayer. Zusaetzlich koennen Tile-/Zwischenfehler auftreten, obwohl spaetere Kacheln/Bilder noch erfolgreich rendern.
- **Fix:** Der Store fÃ¼hrt pro Layer `loading`/`loadingSlow`/`loadingError` und triggert es beim Einschalten. Der Karteninhalt rendert Spinner und Status direkt am Layer; fehlende End-Events laufen nach kurzer Zeit neutral aus, Tile-Fehler erzeugen keinen roten Layer-Fehler und Image-Fehler werden nur verzÃ¶gert gewertet, falls kein Erfolg nachkommt. Wenn beim Wiedereinschalten gar kein Load-Event kommt (Cache/bereits gerendert), wird das Feedback vor `lÃ¤dt noch...` neutral beendet.
- **Guardrail:** Ladefeedback in diesem Stack als UX-Zustand modellieren: sofort beim User-Toggle starten, OL-Events nutzen wenn vorhanden, aber niemals fehlende End-Events, einzelne Tile-Errors oder komplette No-Event-Cache-Faelle als Layerfehler werten.

## 2026-06-01 â€” Coalesce-Sublayer durfte nicht vom cEntry-Status abhÃ¤ngen
- **Symptom:** `Grundnutzung` wurde im Karteninhalt auf EIN gesetzt, erschien aber erst nach Group-AUS/EIN auf der Karte.
- **Root-Cause:** `toggleLayerEye` lief in den Coalesce-Pfad und verlieÃŸ sich auf `cEntry`/Bridge-Status; bei Framework-kombiniertem `show:`-Layer wurde dadurch nicht immer der tatsÃ¤chlich gerenderte OL-Layer aktualisiert.
- **Fix:** Coalesce-Toggle nutzt jetzt zuerst den Framework-Combined-Fast-Path (`_setFrameworkCombinedSublayer`) und schreibt direkt in den aktuellen `show:`-Layer; Bridge-Referenzen werden bei LAYERS-Updates zusÃ¤tzlich auf verwaiste OL-Instanzen geprÃ¼ft und neu aufgelÃ¶st.
- **Guardrail:** Bei Framework-kombinierten Sublayern immer zuerst den real gerenderten `show:`-Layer aktualisieren; Coalesce-Bookkeeping (`cEntry`) ist sekundÃ¤r und kann stale sein.

## 2026-06-01 â€” Bookmark-View-Visibility muss Basis-Visibility uebersteuern
- **Symptom:** Baulinien Nationalstrassen war auf der Karte sichtbar, im Karteninhalt aber ohne aktives Auge; der erste Klick synchronisierte nur den Store statt den Layer auszuschalten.
- **Root-Cause:** `_syncBookmarkLayerStateToOL()` bewertete `cfg.layers[].visible:false` als explizite Wahrheit und ignorierte `views[].layerStates[id].visible:true` der aktiven NPL-View.
- **Fix:** Der OL-/Store-Sync nutzt jetzt die effektive Runtime-Visibility inkl. aktivem View-Override; externe WMS werden mit derselben Visibility/Opacity in Bookmark-State, Store und Karte gefÃ¼hrt.
- **Guardrail:** Bei Schema-v2-Bookmarks darf nie direkt die Basis-Layer-Visibility als Wahrheit verwendet werden. Immer zuerst den aktiven View-State auflÃ¶sen und daraus Runtime, Store und OL-Layer synchronisieren.

## 2026-06-01 â€” Lade-Flicker Teil 3 + Gruppen-Auge Teilzustand
- **Symptom A (Flicker):** Coalesce-Sublayer wurden trotz korrektem show:5,9 kurz alle gemalt und dann ausgeblendet.
- **Root-Cause A:** Adoptierter Framework-OL-Layer war visible:true mit show:all; das show:all-Bild war bereits in Flight â†’ OL malte es, bevor updateParams den Subset reduzierte.
- **Fix A:** In `_setLayersOnSource` Sichtbarkeit an LAYERS koppeln: `olLayer.setVisible(layersParam !== 'show:-1')`. Bei show:-1 bleibt der Layer unsichtbar â†’ in-flight show:all wird nie gemalt; erst wenn sichtbare Sublayer da sind wird er sichtbar und malt direkt den Subset.
- **Symptom B (Auge):** Gruppen-Auge zeigte keinen Teilzustand; Klick schaltete erst ALLE ein, dann ALLE aus â†’ Initial-Subset ging verloren.
- **Fix B:** (1) Render in tnet-lm-active.js `_renderGroup`: partial = anyVisible && !allVisible â†’ CSS-Klasse `lm-eye-partial` (opacity 0.5). (2) `toggleCoalesceGroupEye` in tnet-lm-store.js mit Snapshot: bei AUS aktuellen Subset in `info._eyeSnapshot` merken; bei EIN Snapshot wiederherstellen (statt alle). Per-Kind via bewÃ¤hrtem `toggleLayerEye`-Pfad (`_setCoalesceChildVisible`), damit Bridge-LAYERS/Store/Active-Liste konsistent bleiben.
- **Guardrail:** Gruppen-Auge nie den geteilten OL-Layer pauschal toggeln â€” immer per Kind Ã¼ber toggleLayerEye, damit der LAYERS-Subset und der gemerkte Teilzustand erhalten bleiben.

## 2026-06-01 â€” Lade-Flicker Teil 2: Framework-OL-Layer rendert show:all vor Debounce-Update
- **Symptom:** Beim Bookmark-Hard-Reload werden alle Coalesce-Sublayer kurz dargestellt und dann auf den korrekten Stand (z.B. show:5,9 / show:-1) reduziert.
- **Root-Cause:** Der adoptierte Framework-OL-Layer hat initial LAYERS=show:all; der korrigierende `_updateLAYERSDebounced` (80ms) feuert erst NACH der gesamten Registrierungs-Schleife â†’ OL malt zwischenzeitlich alles.
- **Fix:** In tnet-coalesce-bridge.js (a) beim Adoptieren des Framework-Layers im Lade-Fenster sofort `_applyLAYERSParam` (anfangs show:-1), (b) `_updateLAYERSDebounced` wendet wÃ¤hrend `_isBookmarkLoadActive()` SOFORT an statt debounced. Updates sind additiv â†’ nur progressives Aufdecken, kein show:all mehr.
- **Guardrail:** Bei Coalesce-Layern darf der kombinierte LAYERS-Param wÃ¤hrend des Bookmark-Loads nie kurz mehr Sublayer zeigen als der Endstand. Sofort-Apply im Lade-Fenster, Debounce nur fÃ¼r normale User-Klicks.

## 2026-06-01 â€” Lade-Flicker: Bookmark zeigt erst alle Coalesce-Sublayer, dann blendet aus
- **Symptom**: Beim Hard-Reload eines Bookmarks (z.B. `nw_oereb`) flackern Layer kurz auf und verschwinden wieder â€” sichtbares "laden und dann ausblenden".
- **Root-Cause**: Das Framework aktiviert beim Bookmark-Load ALLE Bookmark-Layer (`Layer ON (135)`). `registerSublayer` in der CoalesceBridge nahm jeden Sublayer bedingungslos in `visibleSublayers` auf â†’ kombinierter `show:`-Parameter enthielt erst alle Indizes (z.B. `show:0,1,5,6,7,8,9,11,12`), und erst die Ensure-Logik im Helper blendete die `visible:false`-Sublayer danach aus (`show:5,9`).
- **Fix**: Lade-Fenster `__tnetActiveBookmark._loadUntil` (Date.now()+8000) im Helper gesetzt. `registerSublayer` prÃ¼ft via `_isBookmarkSublayerHidden(sublayerKey)` die Bookmark-Sichtbarkeit und nimmt `visible:false`-Sublayer NICHT in `visibleSublayers` auf â†’ `show:` ist von Anfang an korrekt. Accordion bleibt unberÃ¼hrt (kommt aus dem Store, nicht aus `visibleSublayers`). Zeitfenster verhindert, dass spÃ¤tere Benutzer-Klicks unterdrÃ¼ckt werden.
- **Guardrail**: Bookmark-Visibility muss VOR dem Bau des kombinierten `show:`-Parameters greifen, nicht erst per nachtrÃ¤glicher Ensure-Korrektur â€” sonst paint-then-hide-Flicker. Korrektur am Punkt der `visibleSublayers`-BefÃ¼llung (`registerSublayer`), zeitlich auf das Lade-Fenster begrenzen.

## 2026-06-01 â€” Manuelles Ausschalten von Ã–REB-Sublayern wirkte nicht auf der Karte
- **Symptom**: Im `nw_oereb`-Bookmark liessen sich Sublayer (gefahrenzone, laermempfindlichkeitsaufstufung) und der Standalone-Layer baulinien-nationalstrassen per Auge zwar im Zustand umschalten (Konsole zeigte AUS), blieben aber auf der Karte sichtbar.
- **Root-Cause**: Ã–REB-/Bookmark-Layer werden vom Framework (`ClassicLayerMgr`) direkt in die OL-Karte geladen und tauchen **weder im Store-Katalog noch in `_activeLayers` auf** (`getCatalog().length === 0`, `getActiveLayers().length === 0`). Der Eye-Klick laeuft ueber `switchLayer` â†’ unseren Patch â†’ `forceMapLayerState`, das aber bei `if (!layer && !activeEntry) return;` sofort aussteigt und den Kartenzustand nie nachzieht. Store-basierte Helfer greifen mangels Store-Eintrag nicht.
- **Fix**: Neuer Helper `_reconcileUntrackedMapLayer(layerId, targetVisible)` in `tnet-lm-store.js`; `forceMapLayerState` ruft ihn im Frueh-Ausstieg auf. Er sucht per `_findAllOLLayers` alle OL-Layer mit exaktem Namen (Standalone wie auch Dedicated-Mode-Sublayer mit eigenem `show:N`) und setzt `setVisible`/Opacity hart auf den Zielzustand. Live verifiziert: gefahrenzone AUS blendet nur gefahrenzone aus (laerm bleibt), baulinien AUS unabhaengig, Wieder-EIN funktioniert.
- **Guardrail**: In diesem Stack sind Framework-/Bookmark-Layer (Ã–REB) **nicht im Store**. Visibility fuer solche Layer immer direkt auf der OL-Karte per exaktem Layer-Namen abgleichen â€” `findLayer`/`_activeLayers` sind dort leer und duerfen nicht als Existenz-Gate fuer den Map-Sync dienen.

## 2026-05-29 â€” Coalesce-Sublayer ignorieren rohe OL-setVisible bei Bookmark-Visibility
- **Symptom**: Ã–REB-Bookmark `nw_oereb` zeigte weiterhin zu viele Layer sichtbar (z.B. LÃ¤rmempfindlichkeitsaufstufung), obwohl sie als `visible:false` definiert waren â€” auch nach dem `setVisible(false)`-Fix.
- **Root-Cause**: Die meisten Ã–REB-Layer sind Coalesce-Sublayer und besitzen keinen eigenen OpenLayers-Layer. Der `map.getLayers()`-Lookup fand nur Standalone-Layer (`gefahrenzone`); fÃ¼r alle Coalesce-Sublayer lief `if (!olLayer) return` ins Leere, sie blieben Ã¼ber den geteilten WMS-`LAYERS`-Parameter sichtbar.
- **Fix**: Neuer Helper `_setBookmarkLayerEye(layerId, false)` nutzt `TnetLMStore.toggleLayerEye()` (Coalesce-fÃ¤hig) mit `_getEffectiveLayerVisible()` als Guard (toggelt nur bei abweichendem Zustand). Eingesetzt in `_scheduleBookmarkVisibilityEnsure`, `_syncBookmarkLayerStateToOL` und `_scheduleViewVisibilityWhenLayersReady` (Hide-Pfad); rohe `setVisible`-Lookups entfernt.
- **Guardrail**: Bookmark-/Layer-Visibility in diesem Stack nie Ã¼ber rohe OL-Layer-Lookups schalten â€” Coalesce-Sublayer sind virtuell. Immer Store-APIs (`toggleLayerEye`/`_getEffectiveLayerVisible`) verwenden, die Coalesce verstehen.

## 2026-05-29 â€” Bookmark-Start: visible:false Layer bleiben nach setMapBookmark sichtbar
- **Symptom**: Nach `TnetSetBookmark('nw_oereb')` blieben 4 Layer sichtbar, die im Bookmark als `visible:false` definiert waren.
- **Root-Cause**: `_scheduleBookmarkVisibilityEnsure` (mit 400/1200/3000ms Retry-Timern) war zwar implementiert, wurde aber nie aus `_applyBookmark` aufgerufen. Der `add`-Listener allein reichte nicht, da das Framework nach dem `add`-Event noch eigene Visibility-Resets durchfÃ¼hrt.
- **Fix**: `_scheduleBookmarkVisibilityEnsure(visibilityMap, ensureToken)` in `_applyBookmark` direkt nach `_scheduleViewVisibilityWhenLayersReady` eingebaut. Die Timer korrigieren zuverlÃ¤ssig alle `visible:false`-Layer nach dem Framework-Load.
- **Guardrail**: Bookmark-Visibility-Correction immer als zweistufig anlegen: (1) `add`-Listener fÃ¼r sofortige Korrektur, (2) Retry-Timer als Absicherung gegen Framework-eigene Post-Load-Resets.

## 2026-05-29 â€” Bookmark-Direktstart darf Views nicht implizit als Default behandeln
- **Symptom**: Beim Direktstart von Karten wie `nw_oereb` sprang der Bookmark ungefragt in die einzige vorhandene View und blendete danach Layer wieder aus dem Kartenbild aus.
- **Root-Cause**: Die Bookmark-Logik behandelte eine einzelne vorhandene View implizit wie einen Default und kombinierte das mit einem nachgelagerten Visibility-Ensure, der den normalen Bookmark-Start nochmals ueberschrieb.
- **Fix**: `tnet-mapplus-helpers.js` nutzt eine View nur noch bei explizitem `view=` oder bei `isDefault:true`; der aggressive Post-Load-Visibility-Ensure bleibt aus dem normalen Bookmark-Start draussen.
- **Guardrail**: In Bookmark-Schema-v2 gilt nur `isDefault:true` oder ein explizit angeforderter `viewId` als aktive View. Eine einzelne vorhandene View ist fachlich nicht automatisch der Startzustand.

## 2026-05-29 â€” Themenkatalog und Karteninhalt muessen gegen denselben Laufzeitzustand synchronisieren
- **Symptom**: Nach externen Aktivierungen, Bookmark-States oder Coalesce-Pfaden konnte der Themenkatalog einen anderen Sichtbarkeitszustand zeigen als der Karteninhalt bzw. die Karte selbst.
- **Root-Cause**: Sichtbarkeits-Guards und Gruppenstatus stuetzten sich teilweise auf rohes `layer.visible` aus dem Katalog, waehrend Active-Entry und OL-Layer bereits einen abweichenden Laufzeitzustand hatten.
- **Fix**: `tnet-lm-store.js` bewertet Sichtbarkeit jetzt ueber den effektiven Laufzeitzustand und synchronisiert interne Drift ohne unnoetigen zweiten Map-Toggle; `tnet-lm-tree.js` zieht Checkboxen per Vollabgleich auf `active-layers-changed` nach.
- **Guardrail**: In diesem Stack duerfen Themenkatalog und Karteninhalt nie lokale UI-Annahmen als Wahrheit verwenden. Massgeblich ist immer der effektive Store-/Runtime-Zustand.

## 2026-05-29 â€” Karteninhalt darf keine nicht renderbaren Bookmark-Layer anzeigen
- **Symptom**: Im Karteninhalt erschienen Bookmark-Eintraege, deren Sichtbarkeit sich nicht verlaesslich schalten liess, weil sie technisch gar keinen belastbaren Layer im Themenkatalog bzw. Store hatten.
- **Root-Cause**: Bookmark-Layer wurden im Active-Panel direkt mit dem Live-State gemischt; dabei konnten unbekannte IDs als reine Bookmark-Stubs bis ins UI durchrutschen.
- **Fix**: `tnet-lm-store.js` filtert beim Bookmark-Load nicht renderbare IDs heraus und baut dafuer einen performanten Layer-Index auf; `tnet-lm-active.js` filtert Bookmark-Layer vor dem Merge zusaetzlich ueber dieselbe Store-Regel.
- **Guardrail**: Active-Panels duerfen nur Layer rendern, die im Store belastbar aufloesbar oder explizit als Spezialfall verwaltet sind. Bookmark-Stubs gehoeren nie direkt ins UI.

## 2026-05-29 â€” Bookmark-Start muss den Karteninhalt aktiv fokussieren
- **Symptom**: Beim Start eines Bookmarks blieb im Sidepanel oft der Themenkatalog offen, obwohl der Bookmark-Inhalt im Karteninhalt kontrolliert werden sollte.
- **Root-Cause**: Das Bookmark-System emitierte bereits die passenden Events, aber das Active-Panel reagierte nur mit Re-Render und schaltete die sichtbare Desktop-/Mobile-UI nicht auf den Karteninhalt um.
- **Fix**: `tnet-lm-active.js` fokussiert bei `tnet-bookmark-loaded` gezielt das Karteninhalt-Panel: Desktop oeffnet `tp_sort_menu` und schliesst `tp_overview_menu`, Mobile wechselt vom Layers-Sheet auf `openActiveSheet()`.
- **Guardrail**: Wenn Bookmark-Flow und Ziel-UI bereits ueber Events gekoppelt sind, gehoert der Fokuswechsel ins owning UI-Modul statt in den Bookmark-Core.

## 2026-05-29 â€” Grundkarten-Defaults duften nicht an dauerhaft gesetzten Bookmark-Markern haengen
- **Symptom**: Der Schutz gegen Grundkarten-Overrides beim Bookmark-Start hing an globalen Bookmark-Markern und blieb dadurch potenziell laenger aktiv als der eigentliche Startup-Moment.
- **Root-Cause**: `tnet-basemap.js` pruefte pauschal auf `__tnetActiveBookmark` bzw. `__tnetLastRequestedBookmark`, waehrend `__tnetLastRequestedBookmark` im Bookmark-Flow nie wieder geloescht wurde.
- **Fix**: Der Basemap-Guard nutzt jetzt einen kurzen Zeitkorridor ueber `__tnetLastRequestedBookmarkAt`; `TnetSetBookmark()` schreibt dafuer bei jedem Request einen Timestamp statt nur eines dauerhaften Namensmarkers.
- **Guardrail**: Startup-Guards fuer Bookmark-Races immer zeitlich oder phasenbasiert modellieren, nie ueber dauerhaft gesetzte globale Flags.

## 2026-05-29 â€” Logout in Edit musste den zentralen ADFS-Signout treffen
- **Symptom**: UI zeigte zwar `Logout`, aber die Abmeldung lief nur app-lokal und entsprach nicht dem gewuenschten zentralen SSO-Signout.
- **Root-Cause**: Logout-Link zeigte auf app-/core-lokale Endpunkte statt auf den ADFS-Endpoint mit `wa=wsignout1.0`.
- **Fix**: In `edit/index.php` wurde das Logout-Ziel im UI-Patch auf `https://idp.gis-daten.ch/adfs/ls/?wa=wsignout1.0&wreply=...` umgestellt; `wreply` verweist auf die Edit-App.
- **Guardrail**: Bei OIDC/ADFS-Setups Logout-Endpunkte immer gegen den IdP-Flow validieren. Ein lokaler Logout-Link reicht oft nicht fuer echtes SSO-Signout.

## 2026-05-29 â€” Edit-Toolbar nutzte fuer Login kein klassisches Anchor-Element
- **Symptom**: `Angemeldet als: ...` wurde korrekt angezeigt, aber der sichtbare Toolbar-Eintrag blieb bei `Login` und bot kein funktionierendes Logout.
- **Root-Cause**: Der Login-Eintrag wurde in der Legacy-Toolbar als generisches UI-Element (Label/Container mit `title`) gerendert, nicht als `a[href*="/core/sso/login.php"]`. Der erste Patch traf daher nur den Anchor-Fall.
- **Fix**: `applyEditAuthUi()` in `edit/index.php` erweitert: neben Anchor-Update werden auch Toolbar-Labels (`Login`/`Anmelden`) und `title`-basierte Container erkannt, auf `Logout`/`Abmelden` umgestellt und per `onclick` auf `/core/sso/logout.php?site=edit` verdrahtet.
- **Guardrail**: In Legacy-Dojo-Toolbars Login/Logout nie nur Ã¼ber `a[href]` umschalten. Immer zusÃ¤tzlich text- und title-basierte UI-Knoten berÃ¼cksichtigen.

## 2026-05-29 â€” Edit zeigte trotz gueltiger Session weiter den Login-Link
- **Symptom**: In `/edit` blieb nach erfolgreichem OIDC-Login der sichtbare Login-Button bestehen; ein klarer Hinweis auf den angemeldeten Benutzer fehlte.
- **Root-Cause**: Der Legacy-Header in `edit` schaltete die Login-UI nicht aktiv um, obwohl `app_username` in der Session vorhanden war. `njs.AppManager.auth_user` wurde zudem unsicher als roher String in JS injiziert.
- **Fix**: In `edit/index.php` wurde `auth_user` sicher per `json_encode(...)` eingebettet, die Originalzeile dokumentiert auskommentiert belassen und ein kleiner UI-Patch ergÃ¤nzt (Login-Link -> `/core/sso/logout.php`, Text auf `Logout`, Badge `Angemeldet als: ...`).
- **Guardrail**: Bei Legacy-UIs nach Auth-Fixes immer auch die sichtbare Header-Logik pruefen. Sessionstate allein reicht nicht, wenn Login-/Logout-Elemente clientseitig nicht explizit aktualisiert werden.

## 2026-05-29 â€” target-Parameter stapelte sich ueber Entry-Redirects und verstaerkte Redirect-Loops
- **Symptom**: URLs wuchsen auf `...&target=...&target=...` an; Browser endete bei `ERR_TOO_MANY_REDIRECTS`.
- **Root-Cause**: Entry-Redirects zu `/mapplus-protected/` haengten `target=` immer an den bestehenden Query-String an, ohne bereits vorhandenes `target` vorher zu entfernen.
- **Fix**: In `maps/index.php` und `maps-dev/index.php` wird vor dem Redirect `$_SERVER['QUERY_STRING']` geparst und `target` entfernt; danach wird genau ein frisches `target=` gesetzt.
- **Guardrail**: Bei Redirect-Ketten mit Steuerparametern (`target`, `redirect`, `returnTo`) immer zuerst existierende Werte deduplizieren, dann exakt einen neuen Wert setzen.

## 2026-05-29 â€” Redirect-Loop durch konkurrierende PHPSESSID-Pfade zwischen Login-Bridge und App
- **Symptom**: Browser meldete `ERR_TOO_MANY_REDIRECTS` zwischen `/mapplus-protected/` und `/maps-dev/` bzw. `/maps/`; IDP-Dialog erschien teils nicht oder nur kurz.
- **Root-Cause**: `mapplus-protected/index.php` nutzte einen anderen Session-Cookie-Pfad als der Ziel-Entry. Dadurch existierten parallel mehrere `PHPSESSID`-Cookies, und der Entry sah den in der Bridge gesetzten OIDC-Sessionstate nicht.
- **Fix**: In `mapplus-protected/index.php` wird der Session-Cookie-Pfad vor `session_start()` dynamisch aus `target` abgeleitet (`/<app>/`). So teilen Bridge und Ziel-Entry denselben Session-Cookie.
- **Guardrail**: Bei Login-Bridges muss der Session-Cookie-Pfad mit dem Ziel-Entry konsistent sein. Unterschiedliche Cookie-Pfade mit gleichem Cookie-Namen erzeugen schwer erkennbare Redirect-Loops.

## 2026-05-29 â€” Anmelden-Button baute auf cleanen URLs einen ungueltigen Query-Start
- **Symptom**: Klick auf "Anmelden" in `/maps-dev/` bzw. `/maps/` zeigte keinen IDP-Dialog; der Login-Flow sprang nicht in den SSO-Zweig.
- **Root-Cause**: Das OnClick hing immer `&group=?` an `window.location.href`. Ohne vorhandene Query wurde damit kein gueltiger Query-Start erzeugt.
- **Fix**: In Desktop/Mobile-Templates auf bedingte Verknuepfung umgestellt: bei fehlendem `?` zuerst `?group=?`, sonst `&group=?`.
- **Guardrail**: Beim clientseitigen URL-Aufbau nie blind `&` anhaengen. Immer zuerst pruefen, ob bereits Query-Parameter vorhanden sind.

## 2026-05-29 â€” mapplus-protected auf generische target-Weiterleitung vereinfacht
- **Symptom**: Starre App-Checks in der Login-Bridge machten Rueckspruenge unflexibel und erschwerten neue Einstiegspfade.
- **Root-Cause**: Der Redirect-Teil war auf explizite Ziel-Whitelists/Fallback-Mappings zugeschnitten statt auf einen generischen Pfadfluss.
- **Fix**: `mapplus-protected/index.php` leitet jetzt generisch ueber `target` weiter, normalisiert nur den Pfad (`/`, `.../`, fehlendes `.php`) und behaelt bestehende Query-Parameter; `target` selbst wird vor der Rueckleitung entfernt.
- **Guardrail**: Fuer flexible Einstiege den Ruecksprungpfad im Entry setzen (`target`) und in der Bridge nur minimale Normalisierung vornehmen, statt App-Namen fest zu verdrahten.

## 2026-05-29 â€” Redirect-Kette brach bei group=%3F im Login-Ruecksprung
- **Symptom**: Aufrufe ueber `/mapplus-protected/?target=...&group=%3F` endeten in fehlerhaften bzw. wiederholten Redirects statt stabil im Ziel-Einstieg.
- **Root-Cause**: Der Query-Parameter `group=?` wurde unveraendert in den Ziel-Redirect uebernommen und kollidierte mit der spaeteren Gruppenauflosung im Entry-Flow.
- **Fix**: Entscheidend war nicht das Filtern von `group=?`, sondern die korrekte Query-Verkettung im Login-Button (`?group=?` oder `&group=?`). In `mapplus-protected/index.php` bleibt `group` unveraendert erhalten, weil `group=?` im Legacy-Entry den Auth-Zweig bewusst triggert.
- **Guardrail**: In diesem Legacy-Flow ist `group=?` ein technischer Trigger und darf in der Login-Bridge nicht entfernt werden. Stabilitaet entsteht ueber korrekten URL-Aufbau im Frontend, nicht ueber pauschales Filtern des Parameters.

## 2026-05-29 â€” mapplus-protected war fest auf /maps verdrahtet und brach Rueckspruenge fuer maps-dev/edit
- **Symptom**: Login ueber `/mapplus-protected/` landete immer in `/maps`, auch wenn der Aufruf aus `/maps-dev` oder `/edit` kam.
- **Root-Cause**: In `mapplus-protected/index.php` war der Erfolgs-Redirect statisch auf `/maps/index.php` gesetzt.
- **Fix**: Der Redirect nutzt jetzt ein validiertes Ziel (`target` oder fallback `app`) mit Whitelist auf `/maps/index.php`, `/maps-dev/index.php`, `/edit/index.php`; Aufrufer senden ihr Ziel explizit als `target` mit.
- **Guardrail**: Login-Bridges duerfen Zielpfade nie hart codieren und nie frei uebernehmen; immer explizit uebergeben und serverseitig whitelisten.

## 2026-05-29 â€” Edit-Entry liess geschuetzten Bereich ohne expliziten OIDC-Guard laufen
- **Symptom**: Aufrufe in `edit/index.php` konnten ohne klaren Vor-Redirect in einen inkonsistenten SSO-Flow fallen.
- **Root-Cause**: Der Legacy-Flow verliess sich nur auf `sso.php/auth.php`, ohne vorab hart zu pruefen, ob `OIDC_CLAIM_group` bereits vorhanden ist.
- **Fix**: In `edit/index.php` vor dem Auth-Include einen expliziten OIDC-Check eingefuegt; bei fehlendem Claim Redirect auf `/mapplus-protected/` inkl. Query-String. `app_group/app_profile` werden defensiv aus der Session gelesen.
- **Guardrail**: In alten Entry-Skripten zuerst harte Session-Vorbedingung pruefen (OIDC-Claim), danach erst Legacy-Auth-Includes ausfuehren.

## 2026-05-28 â€” Bookmark-Initialload liess den Karteninhalt leer, obwohl der Bookmark geladen war
- **Symptom**: Beim Direktstart eines Bookmarks unter `/maps-dev/{id}` blieb der Bereich Karteninhalt leer, obwohl die Karte und der Bookmark-Aufruf selbst liefen.
- **Root-Cause**: Der Karteninhalt hing weiterhin am asynchronen Map-Sync des LMStore. Nach dem Deaktivieren von `loadActiveLayersFromBookmark()` gab es beim Bookmark-Start keinen fruehen Datenpfad mehr fuer die UI, daher renderte das Panel leer.
- **Fix**: Der Bookmark-Apply-Pfad baut jetzt sofort einen Runtime-Layerstand aus dem Bookmark-JSON auf, speichert ihn in `window.__tnetActiveBookmark.layers`, befuellt parallel den LMStore wieder direkt aus dem Bookmark und synchronisiert spaeter eintreffende OL-Layer ueber einen Layer-Add-Hook auf Visibility/Opacity.
- **Guardrail**: Der Karteninhalt darf beim Bookmark-Start nie ausschliesslich von spaet eintreffenden Map-Events abhaengen. Bookmark-JSON muss immer sofort einen renderbaren Layerzustand fuer die UI liefern.

## 2026-05-28 â€” FastAPI-Bookmark-Deploy brach an geschuetztem PHP-Load und fehlendem dulwich ab
- **Symptom**: `POST /gapi/ags2mapplus/deploy-bookmarks?target=dev` lieferte 500; der direkte Browseraufruf per GET zeigte 405.
- **Root-Cause**: Der Deploy-Handler holte Bookmarks zunaechst ueber `treebuilder-api.php?action=bookmarks-load`, das hinter dem Admin-Gate Login-HTML statt JSON lieferte. Nach der Umstellung auf direkten SFTP-Read scheiterte der naechste Schritt daran, dass `dulwich` im laufenden FastAPI-Prozess noch nicht verfuegbar war.
- **Fix**: FastAPI liest Bookmark-Drafts jetzt direkt per SFTP aus `/data/tmp/maps(-dev)/bookmarks/map-bookmarks-all.json` und faellt bei Bedarf auf die deployed JSON-Datei zurueck. Fuer Git-Schritte muss `dulwich` in der Server-Python-Umgebung installiert sein; nach einer Nachinstallation ist ein Dienst-Neustart noetig.
- **Guardrail**: Interne Deploy-Pfade nie ueber login-geschuetzte HTTP-Admin-Endpunkte aufloesen, wenn SFTP/Dateizugriff verfuegbar ist. Bei optionalen Python-Abhaengigkeiten immer Installation und Neustart des laufenden Dienstes zusammen pruefen.

## 2026-05-28 â€” Bookmark-Publish hing implizit am globalen DEV-Fetch-Wrapper
- **Symptom**: Im Bookmarks-Tab war fuer `maps-dev` nicht transparent bzw. nicht robust abgesichert, ob der Publish wirklich nach DEV ging.
- **Root-Cause**: `saveBookmarks()` schickte an `/deploy-bookmarks` nur die Commit-Message. Das Ziel `dev` kam damit nur indirekt ueber den globalen `fetch()`-Wrapper in die Query-String-Parameter.
- **Fix**: Die Bookmarks-Deploy-Requests in `slm.html` und `ags-import.html` senden das Publish-Ziel jetzt explizit im JSON-Body (`target: dev|prod`). Die UI zeigt das vom Backend bestaetigte Ziel anschliessend sichtbar in der Statusmeldung an.
- **Guardrail**: Bei umgebungssensitiven Publish-Aktionen das Ziel nie nur implizit ueber Wrapper oder URL-Umschreibung ableiten. Das Frontend muss `target` explizit mitsenden und die Backend-Response sichtbar auswerten.

## 2026-05-28 â€” PROD-Upload startete trotz Full-Build erneut Einzelbuilds fuer JS
- **Symptom**: Nach Schritt 2 liefen in Schritt 3 fuer `tnet/js-dev/*.js` nochmals Einzelbuilds an, obwohl die passenden Dateien unter `tnet/js/` bereits gebaut waren.
- **Root-Cause**: `upload_changed.py` hat bei jedem JS-Quellfile pauschal den Einzelbuild gestartet und den vorhandenen Build-Output nicht darauf geprueft, ob er bereits aktuell ist.
- **Fix**: Der Upload leitet jetzt zuerst das Ziel unter `tnet/js/` ab und vergleicht dessen mtime mit der Quelldatei. Nur wenn der Output fehlt oder aelter ist, wird noch gebaut; sonst laeuft der Upload mit `BUILD-SKIP` direkt weiter.
- **Guardrail**: Wenn ein Workflow einen vorgelagerten Full-Build hat, darf der Upload-Schritt Build-Artefakte nicht blind neu erzeugen. Erst Zielpfad und Aktualitaet pruefen, dann gegebenenfalls gezielt nachbauen.

## 2026-05-28 â€” Code-Only-Deploy wirkte bei ausgeschlossenen Assets haengengeblieben
- **Symptom**: Der PROD-Deploy schien in der Konsole bei Dateien wie `clipboard.svg` stehenzubleiben, obwohl diese im Code-Only-Modus gar nicht deployt werden sollten.
- **Root-Cause**: `upload_changed.py` listete zuerst alle geaenderten Dateien roh auf und filterte erst danach auf `php/js/html/htm`. Dadurch sah die letzte sichtbare Datei wie ein haengender Upload aus, obwohl sie spaeter nur ausgeschlossen wurde.
- **Fix**: Die Filterung laeuft jetzt vor der Detailausgabe. Im Code-Only-Modus werden nur noch echte Deploy-Kandidaten gelistet; der Upload selbst zeigt zusaetzlich einen klaren Fortschrittszaehler `[aktuell/gesamt]` pro Datei.
- **Guardrail**: Bei gefilterten Deploys nie ungefilterte Rohlisten als Hauptfortschritt anzeigen. Konsolen-Ausgabe muss immer dem tatsaechlichen Arbeitsset entsprechen, sonst werden harmlose Filterphasen als Haenger fehlinterpretiert.

## 2026-05-28 â€” Basemap-Grauschalter toggelte den Zustand, aber die Darstellung wechselte sichtbar nicht
- **Symptom**: Der FARBE/GRAU-Schalter wurde geklickt, aber die Basemap blieb optisch unveraendert oder verlor den Zustand nach einem Basemap-Wechsel.
- **Root-Cause**: Mehrere konkurrierende Graustufen-Pfade hatten sich ueberlagert: globale Framework-Filter auf `.ol-layer`, experimentelle Source-Wrappers und der eigentliche `prerender/postrender`-Pfad. Dadurch wurde entweder der falsche Layer beeinflusst oder der sichtbare Basemap-Layer gar nicht mehr konsistent getroffen.
- **Fix**: Aktive Basemap-Layer werden jetzt zentral aufgeloest, Framework-Filter werden aus dem Steuerpfad entfernt und der Zustand wird nur noch ueber den Render-Hook auf den aktiven Basemap-Layern gesetzt. Nach Basemap-Wechsel wird derselbe zentrale Pfad ueber `syncGrayscale(true)` erneut angewendet.
- **Guardrail**: Visuelle Zustandslogik fuer Basemaps darf nur einen einzigen Besitzer haben. Sobald mehrere Filterpfade parallel existieren, wird Debugging unzuverlaessig und Basemap-Wechsel brechen den Zustand leicht wieder auf.

## 2026-05-29 â€” Non-Coalesce-Layer erschien doppelt im Karteninhalt
- **Symptom**: Layer aus dem Themenkatalog (z.B. `hangneigungen_bund`) erschien nach dem ersten Aktivieren zweimal im Karteninhalt-Panel.
- **Root-Cause**: `setLayerVisible` cachte `activeEntry = this._findActiveLayer(layerId)` vor dem Aufruf von `TnetLayerSwitch`. Dieser rief synchron `forceMapLayerState` auf (via `ClassicLayerMgr.switchLayer`-Patch), der den Layer bereits zu `_activeLayers` pushte. Danach nutzte `setLayerVisible` das veraltete `activeEntry = null` und pushte erneut.
- **Fix**: Nach `TnetLayerSwitch` wird nicht mehr das gecachte `activeEntry` geprÃ¼ft, sondern `_findActiveLayer` erneut aufgerufen (`alreadyActive`). Nur bei `!alreadyActive` wird gepusht.
- **Guardrail**: Keinen Zustand vor synchron auslÃ¶senden Seiteneffekten cachen. Immer erst nach dem Aufruf prÃ¼fen, ob ein Eintrag bereits existiert.

## 2026-05-28 â€” Basemap-Graustufe wirkte nicht und wurde beim Basemap-Wechsel nicht wieder angewendet
- **Symptom**: Der Schalter `FARBE/GRAU` hatte auf die Basemap keine sichtbare Wirkung; nach Basemap-Wechsel blieb der Zustand zudem unberuecksichtigt.
- **Root-Cause**: `_applyGrayscaleViaPrerender()` in `tnet-basemap.js` war faktisch nur noch Diagnose-Code: Listener wurden geloescht, aber keine `prerender/postrender`-Handler mehr auf den aktiven Basemap-Layern registriert.
- **Fix**: Die Funktion registriert wieder echte `prerender/postrender`-Handler auf dem aktuell aktiven Basemap-Layer bzw. dessen Kind-Layern, inklusive Fallback auf den real in der Karte liegenden `isBaseLayer`. Beim Entfernen/Setzen wird `layer.changed()` aufgerufen, damit Farbe/Grau sofort neu gerendert wird.
- **Guardrail**: Temporaere DOM-/Renderer-Diagnostik nie in der produktiven Graustufen-Pipeline stehen lassen. Wenn eine Funktion visuelle Zustandslogik steuert, muss sie nach dem Cleanup immer den konkreten Render-Pfad wieder herstellen oder explizit frueh `return`en.

## 2026-05-19 â€” FastAPI-Publish schrieb DEV-Konfigurationen potenziell nach PROD
- **Symptom**: `maps-dev`-UIs sendeten zwar `target=dev` an `/gapi/ags2mapplus`, FastAPI-Publish-Endpunkte konnten aber weiterhin harte PROD-Pfade wie `/www/core` oder `/www/maps` verwenden.
- **Root-Cause**: `ags2mapplus_api.py` und `ags2mapplus_lyrmgr.py` hatten globale PROD-Konstanten fuer Staging, Core/NLS, LyrMgr, Legendtuner, Bookmarks und Git-Pfadmapping; `deploy-staged-conf` akzeptierte pauschal `/www/...`.
- **Fix**: DEV/PROD-Zielresolver in FastAPI eingefuehrt. `target=dev` routet nun auf `/data/tmp/maps-dev`, `/www/core-dev` und `/www/maps-dev`; Publish/Delete/Git-Endpunkte validieren Pfade gegen Ziel-Whitelists und geben Ziel/Deploy-Pfade explizit in der Response aus.
- **Guardrail**: Frontend-Parameter wie `target=dev` reichen nie allein. Der Backend-Publish muss Zielpfade selbst aufloesen und falsche DEV/PROD-Kombinationen aktiv ablehnen.

## 2026-05-19 â€” maps-dev hatte noch harte /maps-API-URLs in Admin-UI und LayerManager-Config
- **Symptom**: Die `maps-dev`-Admin/Test-Seiten und der neue LayerManager konnten trotz getrenntem App-Root noch Endpunkte unter `/maps` ansprechen.
- **Root-Cause**: Mehrere Admin-HTML-Dateien enthielten absolute `/maps/...` Links und `tnet-global-config.json5` setzte `layerManager.apiUrl` hart auf `/maps/tnet/api/v1/layers.php`; `tnet-lm-store.js` uebernahm diese URL ohne App-Root-Normalisierung.
- **Fix**: Admin/Test-Seiten auf relative URLs umgestellt, DEV-Config auf `/maps-dev/tnet/api/v1/layers.php` gesetzt und `tnet-lm-store.js` normalisiert `/maps`/`/maps-dev` API-Pfade defensiv auf den aktuellen App-Root.
- **Guardrail**: In `maps-dev` duerfen UI-Links und Config-URLs nie absolute `/maps`-Endpunkte enthalten. Client-Code, der Config-URLs ausfuehrt, muss bekannte App-Root-Pfade normalisieren.

## 2026-05-19 â€” DEV-DB-Schema wurde durch Config-to-DB nicht angelegt
- **Symptom**: `maps-dev` sollte `mapplusconf_dev` verwenden, das Schema war aber noch nicht angelegt; der SLM-Button `Config â†’ DB` zielte zudem hart auf `/maps`.
- **Root-Cause**: `admin?action=schema` fuehrte `schema.sql` roh aus, wodurch `CREATE SCHEMA mapplusconf` und `SET search_path TO mapplusconf` nicht auf das aktive DEV-Schema umgeschrieben wurden. Der UI-Button startete nur `configToPG`, nicht vorher die Schema-Initialisierung.
- **Fix**: `Database::rewriteSql()` schreibt nun auch `CREATE SCHEMA` und `SET search_path` auf das aktive Schema um. `Config â†’ DB` nutzt den aktuellen App-Root und ruft vor dem Import `admin?action=schema` auf.
- **Guardrail**: DEV-DB-Aktionen muessen immer erst das aktive Schema (`Database::getSchema()`) verwenden und duerfen keine hart kodierten `/maps`-URLs oder `mapplusconf`-DDL ausfuehren.

## 2026-05-19 â€” maps-dev fiel bei fehlenden DEV-Core-Pfaden auf PROD-Core zurueck
- **Symptom**: `maps-dev` konnte trotz vorhandenem `/www/core-dev` weiterhin Dateien aus `/www/core` oder app-lokalen `maps-dev/core`-Overrides verwenden.
- **Root-Cause**: `TnetCorePaths` hatte DEV-Fallbacks auf `core`, und einzelne DEV-Einstiege nutzten direkte `../core`-Includes bzw. Treebuilder-Override-Pfade.
- **Fix**: DEV-Core-Aufloesung strikt auf `core-dev` umgestellt; direkte Includes laufen ueber `TnetCorePaths::resolveCoreFile()`, Treebuilder-Override-Konstanten zeigen in DEV auf `CORE_CONFIG_DIR`/`CORE_NLS_DIR`.
- **Guardrail**: DEV darf fuer Core-Ressourcen nie still auf PROD-Core fallen. Wenn `core-dev` fehlt, muss der Fehler sichtbar werden statt produktive Dateien zu laden.

## 2026-05-19 â€” DEV/PROD-Trennung fuer Core, Build, DB und FastAPI
- **Symptom**: DEV konnte trotz eigenem `maps-dev` weiterhin gemeinsame Core-Dateien, minifizierte DEV-Builds, PROD-DB-Schema und FastAPI-Publikationsziele verwenden.
- **Root-Cause**: Die Trennung war an mehreren Stellen nur ueber App-Pfade umgesetzt; Core-Config/NLS, JS-Buildmodus, PostgreSQL-Schema und ags2mapplus-Ziel waren nicht zentral environment-aware.
- **Fix**: `TnetCorePaths` fuer `core-dev`/`core` eingefuehrt, DEV-JS-Build ohne Minify umgesetzt, `Database.php` auf `mapplusconf_dev` fuer DEV vorbereitet und FastAPI-Aufrufe aus DEV mit `target=dev` versehen.
- **Guardrail**: Jede neue DEV/PROD-Trennung braucht einen zentralen Resolver oder Modusparameter. Keine Runtime-Komponente darf ihr Ziel aus hart codierten PROD-Pfaden ableiten.

## 2026-05-19 â€” Admin-Setup schreibt in falschen DEV-Datenpfad
- **Symptom**: Erstmaliges Admin-Passwort auf `/maps-dev` meldete `Einrichtung fehlgeschlagen (Dateisystem-Fehler)`, obwohl SFTP-Verzeichnisse angelegt wurden.
- **Root-Cause**: `AdminAuth` leitete fuer DEV `/data/Client_Data/nwow-dev/tmp` ab. Der bekannte schreibbare PHP-Tmp-Bereich liegt aber unter `/data/Client_Data/nwow/tmp` (SFTP-Sicht: `/data/tmp`).
- **Fix**: Admin- und Access-Konfigurationsdateien liegen nun immer unter `/data/Client_Data/nwow/tmp`; DEV nutzt getrennte Dateinamen `admin-env-dev.json` und `access-config-dev.json`.
- **Guardrail**: Bei PHP/SFTP-Pfaden immer PHP-Sicht und SFTP-Sicht auseinanderhalten. Fuer DEV/PROD-Trennung im gemeinsamen Tmp-Bereich lieber eindeutige Dateinamen statt erfundene Datenroots verwenden.

## 2026-05-19 â€” DEV raw-conf nutzt nicht beschreibbaren nwow-dev-Tmp-Root
- **Symptom**: AGS-Import/Raw-Conf-Funktionen auf `/maps-dev` zielten auf `/data/Client_Data/nwow-dev/tmp/raw-conf` und scheiterten an fehlenden Schreibrechten.
- **Root-Cause**: `treebuilder-api.php` leitete temporaere Arbeitsverzeichnisse aus `CLIENT_DATA_ROOT` ab; fuer DEV zeigte dieser Root auf einen nicht dauerhaft beschreibbaren Datenbaum.
- **Fix**: Neuer `TNET_TMP_ROOT`: PROD nutzt `/data/Client_Data/nwow/tmp/maps`, DEV nutzt `/data/Client_Data/nwow/tmp/maps-dev` (SFTP-Sicht: `/data/tmp/maps` bzw. `/data/tmp/maps-dev`). Raw-Conf, ImportToCore, Layertree, StageConf, Legend- und Bookmark-Drafts haengen daran.
- **Guardrail**: DEV/PROD-Trennung fuer beschreibbare Runtime-Arbeitsdaten immer unter dem bekannten schreibbaren Tmp-Root mit Umgebungs-Unterordner loesen, nicht ueber separate ClientData-Roots.

## 2026-05-19 â€” PROD Runtime-Tmp-Daten lagen flach unter /data/tmp
- **Symptom**: Nach der DEV-Trennung lagen PROD-Arbeitsdaten weiter flach unter `/data/tmp/raw-conf`, `/data/tmp/ImportToCore`, usw.; das war inkonsistent zur DEV-Struktur.
- **Root-Cause**: Historisch war PROD der implizite Default im gemeinsamen Tmp-Root. Dadurch hatten Scripts und Runtime-Code keinen expliziten Environment-Unterordner fuer `/maps`.
- **Fix**: PROD nutzt nun `/data/Client_Data/nwow/tmp/maps` (SFTP-Sicht: `/data/tmp/maps`), DEV `/data/Client_Data/nwow/tmp/maps-dev`. Bestehende PROD-Verzeichnisse und Admin-Dateien wurden per SFTP in den neuen `maps`-Ordner verschoben.
- **Guardrail**: Runtime-Tmp-Daten immer unter expliziten App-Ordnern halten (`maps`, `maps-dev`). Deploy-/Migrationsskripte duerfen nicht mehr vom flachen `/data/tmp` als PROD-Default ausgehen.

## 2026-04-30 â€” DEV lud nach Fix weiterhin gecachte modules.js und Legacy-tnet_toc
- **Symptom**: `/maps-dev` startete trotz lokaler Fixes unvollstaendig; `njs.AppManager.Maps.main` blieb leer und der Browser lief in `layout.js:initTitleFreePaneItems` auf `Cannot read properties of null (reading 'style')`.
- **Root-Cause**: Remote-DEV hatte zwar die gepatchte `public/config/modules.js`, die Seite lud aber weiter `modules.js?v=v4.0.0` aus dem Cache. Zusaetzlich zeigte der `tnet_toc.js`-Script-Tag noch auf den alten Legacy-Pfad `/tnet/tnet_toc.js`, waehrend der Build nach `/tnet/js/tnet_toc.js` deployt.
- **Fix**: DEV-HTML auf `/tnet/js/tnet_toc.js` umgestellt und den `modules.js`-Query-String fuer DEV gebumpt. Danach wurde der vorhandene `<details>`-Monkey-Patch fuer `initTitleFreePaneItems` live und die App initialisierte wieder bis `tnet-app-ready`.
- **Guardrail**: Nach Upload von Einstiegsskripten mit stabilen Query-Strings immer Cachebuster pruefen. Legacy-Script-Pfade muessen zum Build-/Deploy-Ziel passen, sonst landet der Fix nicht im Browser.

## 2026-04-30 â€” maps-dev/js-dev enthielt irrtuemlich minifizierte Build-Artefakte
- **Symptom**: Fast alle Dateien unter `maps-dev/tnet/js-dev` waren Einzeiler, obwohl die Originalquellen unter `maps/tnet/js-dev` lesbar und unminifiziert sind.
- **Root-Cause**: Beim initialen DEV-Seed wurden offenbar Dateien aus dem Build-Ziel `tnet/js` statt aus dem Source-Ziel `tnet/js-dev` nach `maps-dev/tnet/js-dev` uebernommen.
- **Fix**: `maps-dev/tnet/js-dev` aus den lesbaren Originalquellen `maps/tnet/js-dev` restauriert. DEV-spezifische Runtime-Normalisierung fuer Proxy-/Service-URLs danach wieder in `tnet-lm-store.js` und `tnet-coalesce-bridge.js` als lesbaren Source-Code eingepflegt.
- **Guardrail**: Bei DEV/PROD-Sync immer Source nach Source (`js-dev -> js-dev`) und Build-Output nach Build-Output (`js -> js`) kopieren. Nach Seed per Zeilenzahl/Stichprobe pruefen, dass `js-dev` keine Einzeiler-Artefakte enthaelt.

## 2026-04-30 â€” DEV normalisiert PROD-Proxy-Pfade aus Layer-Configs erst zur Laufzeit
- **Symptom**: DEV erzeugte trotz korrektem App-Root weiterhin Proxy-URLs wie `/maps-dev//maps/tnet/agsproxy/...` oder lieferte in `flat=true` alte Config-URLs wie `/maps/agsproxy.php?path=...` aus.
- **Root-Cause**: Layer-Configs und DB-Importe enthalten historisch PROD-Webpfade (`/maps/...`). Das ist fuer Produktion gueltig, wurde aber beim Ausliefern in DEV nicht an der API-Grenze normalisiert; Client-Code hat nur den aktuellen Root erkannt und alte absolute App-Pfade erneut geprefixt.
- **Fix**: `layers.php` normalisiert `url` und `serviceUrl` vor der JSON-Ausgabe auf den aktuellen App-Root (`/maps` oder `/maps-dev`). `tnet-lm-store.js` und `tnet-coalesce-bridge.js` normalisieren zusaetzlich defensiv vor der OL-Source-Erzeugung.
- **Guardrail**: Config-Dateien duerfen kanonische PROD-Pfade behalten. Environment-Wechsel gehoert an die Runtime-Grenze (API/Client-Normalisierung), nicht in eine massenhafte Config-Umschreibung oder relative Pfadlogik.

## 2026-04-30 â€” AGS-Proxy-URLs in layers.php liefen auf maps-dev in falsche App-Roots
- **Symptom**: Coalesce-Layer erzeugten auf DEV Proxy-Requests wie `/maps-dev//maps/tnet/agsproxy/...` bzw. zwischenzeitlich `/tnet/agsproxy/...` oder `/maps-dev/tnet/api/v1/tnet/agsproxy/...`, wodurch ArcGIS-Requests fehlschlugen.
- **Root-Cause**: `tnet/api/v1/layers.php` setzte `serviceUrl` fuer Coalesce-Knoten noch mit hart codiertem `/maps/tnet/agsproxy/`. Beim ersten Fix war zusaetzlich `$appBasePath` in `enrichCoalesceWalk()` nicht im Scope; danach zeigte sich noch, dass die API-Root-Hilfe faelschlich das komplette Skriptverzeichnis statt nur `/maps` oder `/maps-dev` lieferte.
- **Fix**: In `layers.php` eine app-root-basierte Aufloesung auf den ersten Pfadteil (`/maps` oder `/maps-dev`) eingebaut, `$appBasePath` in `enrichCoalesceWalk()` per `global` verfuegbar gemacht und die `serviceUrl` daraus erzeugt. DEV-Datei anschliessend gezielt nach `/www/maps-dev/tnet/api/v1/layers.php` hochgeladen und gegen den Live-JSON-Output verifiziert.
- **Guardrail**: API-Endpunkte duerfen fuer Webpfade nie `dirname($_SERVER['SCRIPT_NAME'])` als App-Root missverstehen. Fuer Multi-App-Setups immer nur den ersten App-Pfadteil (`/maps`, `/maps-dev`) ableiten und in rekursiven Helfern explizit in den Scope holen.

## 2026-04-30 â€” DEV-Upload uebersprang maps-dev-JS-Builds wegen hart verdrahteter maps-Pfade
- **Symptom**: Nach lokalem Seed `maps -> maps-dev` blieb `/maps-dev/nw_oereb` serverseitig unvollstaendig; zentrale Assets wie `tnet-lyrmgr-patch.js`, `tnet-log.js`, `tnet-icons.js`, `tnet-mapcontrols.js` und `tnet-coalesce-bridge.js` liefen auf `/www/maps-dev` in 404.
- **Root-Cause**: `_upload_changed.py` baut geaenderte `tnet/js-dev/*` Dateien vor dem Upload einzeln ueber `_build_js.py`. Das Build-Skript kannte aber nur die fest verdrahteten `maps/tnet/js-dev` und `maps/tnet/js` Wurzeln. Bei `maps-dev` wurde der Output dadurch auf den Inputpfad zurueckgerechnet und esbuild brach mit `Refusing to overwrite input file` ab.
- **Fix**: `_build_js.py` auf pfadbasierte Root-Erkennung fuer `maps` und `maps-dev` umgestellt. Danach den DEV-Upload mit `--allow-config --reason ...` erneut ausgefuehrt; die zuvor fehlenden Build-Artefakte wurden erfolgreich nach `/www/maps-dev/tnet/js` hochgeladen und die 404s waren weg.
- **Guardrail**: Build-/Deploy-Skripte fuer Einzeldateien duerfen `maps` und `maps-dev` nie ueber hart kodierte Output-Wurzeln unterscheiden. Die Zielwurzel muss immer aus dem uebergebenen Quellpfad abgeleitet werden.

## 2026-04-30 â€” Remote-DEV kann trotz identischem Local-Tree auf altem Einstiegspunkt stehen
- **Symptom**: `/maps-dev/nw_oereb` zeigte noch das alte Panel-Layout und lud zentrale Assets wie `tnet-log.js`, `tnet-mapcontrols.js`, `tnet-sidepanel.css` und `tnet-coalesce-bridge.js` nicht, obwohl lokal `maps/` und `maps-dev/` bereits denselben Stand hatten.
- **Root-Cause**: Nicht der Local-Tree war auseinander, sondern der Remote-Stand unter `/www/maps-dev`. Dort lagen `index.php`, `public/index_de.htm` und `public/config/modules.js` noch in einer Ã¤lteren Version, sodass DEV weiterhin den alten Einstiegspfad auslieferte.
- **Fix**: Unterschied zuerst mit Local-Hashes und cache-busted Remote-Fetches getrennt verifiziert, danach die drei DEV-Einstiegsdateien gezielt per Active-File-Upload nach `/www/maps-dev` hochgeladen und die Route erneut gegen PROD validiert.
- **Guardrail**: Bei DEV/PROD-Mismatch immer zuerst `lokal gleich?` und `remote gleich?` getrennt prÃ¼fen. Ein erfolgreiches Changed-Files-Deploy oder identische lokale BÃ¤ume beweisen nicht, dass der Remote-Einstiegspunkt schon synchron ist.

## 2026-04-30 â€” maps-dev griff im Treebuilder und in JS-Modulen weiterhin auf prod-Pfade zu
- **Symptom**: Trotz getrennter Deploy-Ziele landeten API-, Proxy-, Config- und Bookmark-Zugriffe in Teilen weiterhin unter `/maps` bzw. `/data/Client_Data/nwow` statt unter der aktiven App-Root.
- **Root-Cause**: Die Trennung war zuerst nur im Deploy umgesetzt; mehrere Runtime-Module und `treebuilder-api.php` konstruierten Web- und Datenpfade weiterhin statisch fÃ¼r Produktion.
- **Fix**: App-Root zentral aus `SCRIPT_NAME` bzw. `window.__TNET_APP_ROOT` abgeleitet und daraus Webroot-/Cookie-/Config-/Tmp-Pfade aufgebaut. In `treebuilder-api.php` zusÃ¤tzlich einen zentralen `CLIENT_DATA_ROOT` und `toSftpPath()` eingefÃ¼hrt.
- **Guardrail**: Bei Multi-Environment-Setups nie `'/maps'`, `'/www/maps'` oder `'/data/Client_Data/nwow'` direkt in Runtime-Code verdrahten. Immer erst App-Root und Daten-Root zentral auflÃ¶sen und alle Folgepfade daraus ableiten.

## 2026-04-30 â€” Directory-Index-Requests verloren den App-Root und luden /maps-Assets in /maps-dev
- **Symptom**: Die DEV-Startseite unter `/maps-dev/` lief mit `window.__TNET_APP_ROOT = ''` an und zog CSS/JS weiter aus `/maps/tnet/...`, was Folgefehler wie `TnetLog is not defined` auslÃ¶ste.
- **Root-Cause**: Die Root-Erkennung in `index.php` leitete den App-Root nur aus `dirname($_SERVER['SCRIPT_NAME'])` ab. Bei Directory-Index-Requests kann dieser Wert leer bzw. `/` sein, obwohl der Request faktisch unter `/maps-dev/` lÃ¤uft.
- **Fix**: Fallback auf den ersten Pfadteil aus `REQUEST_URI` eingebaut und damit `/maps` bzw. `/maps-dev` robust auch ohne explizites `index.php` im Request erkannt. Die API-Discovery in `info.php` verwendet denselben Request-basierten App-Root.
- **Guardrail**: FÃ¼r Root-/App-Erkennung nie nur `SCRIPT_NAME` vertrauen. Bei Verzeichnis-Requests immer einen Fallback auf den Pfadanteil aus `REQUEST_URI` einbauen.

Symptom: Im SLM-Staging war nur das ImportToCore-KÃ¼rzel als veraltet markiert, nicht aber die betroffenen raw-conf-Dienste links in der Quellenliste.
Root-Cause: Die Re-Stage-Erkennung existierte nur auf KÃ¼rzel-Ebene; die Manifest-/Change-Daten wurden nicht auf die linke Dienstliste projiziert.
Fix: Im linken Staging-Listing werden Dienste jetzt anhand der gecachten ImportToCore-Manifestdaten markiert und mit Re-Stage-Hinweis pro betroffenem KÃ¼rzel versehen.
Guardrail: Wenn Change-Detection fÃ¼r KÃ¼rzel vorhanden ist, immer auch prÃ¼fen, ob die zugrunde liegenden Quellenlisten dieselbe Information sichtbar machen.

## 2026-04-22 â€” Nach erneutem Stagen blieben alle Dienste als "Service nicht mehr in raw-conf" markiert
- **Symptom**: Trotz frischem Staging zeigte `checkSourceChanges()` 100/100 Services als fehlend; Badge "0 Quellen (keine Basis)" bzw. "100 Ã„nderungen" liess sich nicht wegbekommen.
- **Root-Cause**: `checkSourceChanges()` prÃ¼fte ausschliesslich `is_dir($rawDir . '/' . $svcKey)`. Die tatsÃ¤chliche raw-conf-Struktur ist jedoch **flach** â€” alle Dienste liegen als Dateien (`layers_TNET_<svc>.conf`, `maptips_TNET_<svc>.conf`, â€¦) direkt im `raw-conf`-Root, ohne Unterverzeichnis pro Service. Damit schlug `is_dir()` fÃ¼r jeden Dienst fehl.
- **Fix**: `checkSourceChanges()` akzeptiert jetzt beide Strukturen â€” Verzeichnis-basiert und flach. FÃ¼r flache Dienste wird raw-conf einmalig via `scandir()` + `extractServiceFromFilename()` indexiert und pro Manifest-Source gegen den Index verglichen (Size + mtime, deleted/added).
- **Guardrail**: Wenn `stageServicesToImportToCore()` und `listRawConf()` mehrere Strukturen (Verzeichnis + flach) unterstÃ¼tzen, muss jede downstream-Logik (Change-Detection, Deletion, Preview) beide Strukturen ebenfalls gleichwertig behandeln.

## 2026-04-23 â€” SLM ohne Login erreichbar, API-Calls lieferten Login-HTML ("Unexpected token '<'")
- **Symptom**: Im InPrivate-Fenster (ohne Admin-Cookie) lud `slm.html` komplett, Datenbereiche zeigten aber `Fehler: Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
- **Root-Cause**: Zwei LÃ¼cken: (1) Die Rewrite-Regel `slm.html â†’ admin-gate.php` stand nur in `/www/maps/tnet/api/v1/.htaccess`, wurde aber nie erreicht, weil die Ã¼bergeordnete `/www/maps/tnet/api/.htaccess` bei existierenden Dateien ein `RewriteRule ^ - [L]` setzt und damit das Rewriting fÃ¼r den per-dir-Context stoppte, bevor die Child-Rule greifen konnte. Die `.html` wurde direkt als statische Datei ausgeliefert. (2) `admin-gate.php` delegierte den Auth-Check ausschliesslich an `enforceEndpointPolicy()` â€” ohne vorhandene `access-config.json` bzw. ohne Eintrag in `restricted_html` kam die Policy beim "public"-Fallback raus.
- **Fix**: (1) In `/www/maps/tnet/api/.htaccess` eine explizite Admin-HTML-Regel **vor** der ExistenzprÃ¼fung ergÃ¤nzt: `RewriteRule ^v1/(slm|ags-import|tree-builder|dev-test|tree-test)\.html$ v1/admin-gate.php?page=$1 [L,QSA]`. (2) `admin-gate.php` ruft jetzt unbedingt `AdminAuth::requireAuth(false)` (fail-closed, kein IP-Bypass) bevor die HTML ausgeliefert wird. (3) In `slm.html` zusÃ¤tzlich `window.fetch`-Wrapper installiert, der bei HTML/401-Response einen prominenten Login-Banner mit Link einblendet, statt JSON-Parser-Fehler zu produzieren.
- **Guardrail**: Admin-HTML-Seiten mÃ¼ssen IMMER Ã¼ber ein PHP-Gate ausgeliefert werden â€” die Rewrite-Regel dafÃ¼r gehÃ¶rt in die **oberste** .htaccess des Pfades (vor jedem generischen Existenz-Check), sonst wird die statische Datei direkt serviert. Defense-in-depth: Das Gate selbst muss fail-closed sein (harter `requireAuth`), nicht nur via Policy-Konfiguration. Frontend-seitig zentraler fetch-Wrapper erkennt Auth-Fehler und bietet Login-Pfad.

## 2026-04-23 â€” Folge-Bug nach Fail-Closed-Fix: ERR_TOO_MANY_REDIRECTS fÃ¼r whitelisted IPs
- **Symptom**: Nach dem Fail-Closed-Fix fÃ¼r `admin-gate.php` lief der Browser in `ERR_TOO_MANY_REDIRECTS`, sobald die Client-IP in der `access-config.json`-Whitelist stand. ZusÃ¤tzlich ignorierte das Gate den im Zugriffsschutz-Tab gewÃ¤hlten Modus "Ã–ffentlich" und erzwang trotzdem Login.
- **Root-Cause**: `admin-gate.php` hatte einen fest kodierten `requireAuth(false)` â€” der die Endpoint-Policy komplett aushebelte. Dadurch: (a) public/IP-Whitelist-Konfigurationen wurden ignoriert, (b) bei whitelisted IPs im Modus `restricted_with_ip_html` entstand ein Loop (Gate erzwingt Cookie â†’ Login sieht Whitelist-IP â†’ leitet zurÃ¼ck auf Zielseite â†’ Gate â†’ Login â†’ â€¦).
- **Fix**: `admin-gate.php` ruft wieder ausschliesslich `AdminAuth::enforceEndpointPolicy($page, 'html')` auf. Die Policy selbst ist bereits fail-closed bei fehlender Config (`requireAuth(false)` im Fallback-Zweig) und respektiert sonst die vom Benutzer im SLM-Zugriffsschutz-Tab gewÃ¤hlten Modi (`restricted_html` / `restricted_with_ip_html` / `public`). Der Schutz vor Ã¶ffentlich erreichbaren Admin-Seiten bleibt durch die `.htaccess`-Rewrite-Regel bestehen, die jede `.html` zwingend durch das Gate leitet.
- **Guardrail**: Gate-Logik darf die konfigurierbare Policy nicht Ã¼berstimmen. Wenn fail-closed gewÃ¼nscht ist, gehÃ¶rt das Verhalten in die zentrale `enforceEndpointPolicy()` (bereits der Fall) â€” nicht in duplizierte Hard-Checks an jeder Einstiegsstelle. Bei Redirect-Loops immer prÃ¼fen, ob zwei Stellen unterschiedliche Policies fÃ¼r denselben Endpoint erzwingen.
# AI Lessons Learned â€” MAP+ / TNET

> Dokumentation konkreter Fehler und deren LÃ¶sungen.
> Wird von der KI nach jedem Bug-Fix ergÃ¤nzt.
> Format: Symptom â†’ Root-Cause â†’ Fix â†’ Guardrail

---

## 2026-07-09 — Multi-Site SLM/API: App-Root nur /maps(-dev), nicht generisch
- **Symptom**: SLM/API-Seiten und Endpunkte funktionierten nur unter `/maps` und `/maps-dev`; unter einer neuen Site wie `/geohost/tnet/api/v1/slm.html` brach die App-Root-Ableitung (Fallback auf `/maps`), API-Calls und Cookie-Pfade zeigten auf die falsche Site.
- **Root-Cause**: App-Root wurde an vielen Stellen binär abgeleitet (`location.pathname.indexOf('/maps-dev/')===0 ? '/maps-dev' : '/maps'`, Regex `^/(maps(?:-dev)?)`, `dirname()`-Ketten fester Tiefe). Kein generisches Site-Präfix.
- **Fix**: Zentrale Ableitung „Segment vor `/tnet/`" (`^(/.+?)/tnet/`) in `CorePaths.getAppBasePath`, `AdminAuth`, `layers.php`, sowie im Frontend (`tnet-lm-store`, slm/tree-builder/ags-import/config-db-admin). `isDevApp`/`_swEnv` über `-dev`-Suffix; Store-Root site-erhaltend `/<site>[-dev]`.
- **Guardrail**: App-Root nie binär maps/maps-dev ableiten. Immer generisch das Mount-Segment vor `/tnet/` nehmen; DEV/PROD über `-dev`-Suffix, Site separat. `admin-gate`-Rewrite für neue Admin-`.html` IMMER in der übergeordneten `tnet/api/.htaccess` (vor der Existenzprüfung) UND in `v1/.htaccess` UND in `admin-gate.php`-Whitelist ergänzen.

## 2026-07-09 — Profile/Katalog pro Site + Tydac-Variante: PK-Änderung bricht ON CONFLICT
- **Symptom**: Nach Ergänzen der `site`- (und `variant`-)Dimension in `catalog_document` schlugen `ON CONFLICT (profile)`-Upserts fehl (keine Unique-Constraint mehr auf `profile` allein).
- **Root-Cause**: PK wurde auf `(site, profile[, variant])` erweitert; bestehende Upserts/WHERE-Klauseln filterten weiter nur nach `profile`.
- **Fix**: Request-scoped Kontext `CatalogRepository::setSite()/setVariant()` (Default `maps`/`tnet` → bestehendes Verhalten unverändert); ALLE document/history/lock/draft-Queries + `ON CONFLICT` konsistent auf Site (+Variant) umgestellt. Idempotente DB-Migrationen (ADD COLUMN IF NOT EXISTS + PK-Rebuild in DO-Blöcken).
- **Guardrail**: Beim Erweitern eines Primärschlüssels IMMER alle `ON CONFLICT`- und `WHERE`-Klauseln derselben Tabelle mitziehen; Ambient-Kontext mit sinnvollem Default hält Bestandscode kompatibel. Migrationen idempotent halten (Spalten- und Constraint-Existenz prüfen).

## 2026-03-22 â€” Resize-Handle: Panel wÃ¤chst nach oben statt nach unten
- **Symptom**: Ziehen des unteren Resize-Handles (nach tp_sort_menu) nach unten vergrÃ¶ssert das Panel visuell nach oben statt nach unten.
- **Root-Cause**: Beide Handles nutzten gekoppeltes Resize: Wenn tp_sort_menu wÃ¤chst, schrumpft tp_overview_menu darÃ¼ber â†’ alles verschiebt sich nach oben â†’ visuell wÃ¤chst das Panel nach oben.
- **Fix**: Kopplung nur fÃ¼r das Handle ZWISCHEN den Panels (erstes Panel, Index 0). Das Handle nach dem letzten Panel resized unabhÃ¤ngig (`siblingCfg = null`).
- **Guardrail**: Bei gekoppeltem Accordion-Resize: Kopplung nur am Splitter zwischen zwei Panels anwenden. Handles am Rand eines Panels dÃ¼rfen nicht rÃ¼ckwÃ¤rts auf Geschwister-Panels wirken.

## 2026-03-22 â€” Scrollbar im Sidepanel verursachte Inhalts-Sprung und wirkte zu dominant
- **Symptom**: Beim Erscheinen/Verbergen der Scrollbar verschob sich der Inhalt; gewÃ¼nscht war eine dezente, leicht transparente Scrollbar ohne Layout-Resize.
- **Root-Cause**: Scroll-Container nutzten uneinheitliches `overflow-y`/Scrollbar-Styling (teils auto/ausgeblendet), wodurch der verfÃ¼gbare Inhaltsraum je nach Scroll-Zustand wechselte.
- **Fix**: FÃ¼r V2-Container (`.lm-cat-content`, `#tp_sort_menu > .tnet-panel-content`) auf stabile Scrollbar umgestellt: `overflow-y: scroll`, `scrollbar-gutter: stable both-edges`, dÃ¼nne leicht transparente Thumb-Farbe, keine Scrollbar-Buttons.
- **Guardrail**: In UI-Containern mit fester Breite Scrollbar-Platz immer stabil reservieren, damit Inhalt beim Scrollbar-Zustandswechsel nicht springt.
- **Update**: Scroll muss auf den echten inneren Zielcontainern liegen (`.lm-cat-content` und `#lm-active-container`), nicht auf Outer-Wrappern. Nur so bleiben Scrollbars visuell identisch und Resize-Effekte klar sichtbar.

## 2026-03-22 â€” Sidepanel-HÃ¶hen waren initial zu gross und korrigierten sich erst nach Interaktion
- **Symptom**: Das Sidepanel war beim ersten Render teilweise zu hoch; erst nach Resize oder anderer Benutzerinteraktion wurden die HÃ¶hen korrekt geklemmt.
- **Root-Cause**: Die initiale HÃ¶henberechnung lief, bevor Tree-/Panel-Inhalte, Fonts und finale ContainerhÃ¶hen vollstÃ¤ndig stabil waren.
- **Fix**: In `tnet-accordion-resize.js` gestaffelte Reflows nach Init/Load/Fonts-Ready ergÃ¤nzt sowie `ResizeObserver` auf `#spring`/`#freepane` und zusÃ¤tzlich `MutationObserver` auf `#spring` (childList + open/class/style), damit auch reine DOM-Ã„nderungen ohne Container-Resize automatisch nachgeklemmt werden.
- **Guardrail**: Bei dynamisch gerenderten Panel-Layouts nicht nur auf Fenster-Resize verlassen; zusÃ¤tzlich Mutation-basierte Nachkorrektur einbauen.
- **Update**: Observer-Refresh wÃ¤hrend aktivem Drag (`window.__tnetResizing`) unterdrÃ¼cken, sonst wird die alte gespeicherte HÃ¶he beim Ziehen zurÃ¼ckgesetzt und der Resize-Handle wirkt defekt.

## 2026-03-22 â€” Gesamtes Sidepanel scrollte statt nur der inneren Bereiche
- **Symptom**: Das komplette linke Sidepanel liess sich vertikal scrollen; der Panel-Footer wirkte nicht sauber an die FensterhÃ¶he gekoppelt.
- **Root-Cause**: `#freepane` und `#spring` hatten eine content-getriebene HÃ¶he mit Outer-Scroll (`overflow-y: scroll`) statt einer strikt viewportgebundenen Panel-HÃ¼lle.
- **Fix**: `#freepane` auf feste HÃ¶he `calc(100vh - 69px)` gesetzt, Outer-Overflow auf `hidden` umgestellt und Scroll nur noch in inneren Content-Bereichen belassen; Content-Caps fÃ¼r Katalog und aktive Themen konservativer gesetzt.
- **Guardrail**: Das Gesamtpanel selbst darf nicht scrollen. Scroll-Verhalten nur auf dedizierte innere Listen-/Content-Bereiche legen.

## 2026-03-22 â€” Sidepanel Ã¼berlÃ¤uft, untere Accordions verschwinden
- **Symptom**: Im linken Panel lief der Inhalt nach unten Ã¼ber; untere Accordion-Bereiche waren nicht mehr erreichbar/sichtbar.
- **Root-Cause**: `#spring` war als nicht-schrumpfender Flex-Block (`flex: 0 0 auto`) mit content-getriebener HÃ¶he konfiguriert; zusÃ¤tzlich konnten Panel-Inhalte zu gross fÃ¼r kleine Viewports werden.
- **Fix**: `#spring` auf flexiblen Scrollbereich umgestellt (`flex: 1 1 auto`, `min-height: 0`, `height: auto`) und Panel-Content-HÃ¶hen per `min(..., calc(100vh - ...))` viewportbasiert gedeckelt.
- **Guardrail**: In vertikalen Flex-Layouts mit Scrollcontainern immer `min-height: 0` auf dem Scroll-Child setzen und feste Panel-HÃ¶hen gegen `100vh` clampen.

## 2026-03-22 â€” Resize-Handles wirkten zu transparent und zu massiv
- **Symptom**: Divider zwischen Accordion-Panels waren sichtbar, wirkten aber zu durchsichtig und optisch zu dominant.
- **Root-Cause**: Handle-Styles nutzten RGBA-Farben mit Transparenz im Normal-/Hover-/Active-State.
- **Fix**: Handle-Farben auf deckende Vollfarben umgestellt (`background`, `border`, `::before`-Grip), HÃ¶he schlank bei 5px belassen.
- **Guardrail**: FÃ¼r funktionale UI-Trennelemente in dichtem Panel-Layout bevorzugt deckende Farben verwenden; Transparenz nur gezielt fÃ¼r dekorative Elemente.

## 2025-07-11 â€” PDF-Export nordgerichtet obwohl Druckrahmen rotiert ist
- **Symptom**: Frame auf Karte mit ~-24Â° CSS-Rotation; PDF-Ausgabe ist nordgerichtet (0Â°).
- **Root-Cause**: `template-pdf-export.js` berechnet `rotRad = map.getView().getRotation()` und ignoriert `options.rotation` (Grad, vom Slider). Da Map-View nie mehr gedreht wird (nur noch CSS-Frame), bleibt `rotRad = 0`.
- **Fix**: `rotRad` in `template-pdf-export.js` um `options.rotation`-Fallback ergÃ¤nzt: `(typeof options.rotation === 'number' && options.rotation !== 0) ? options.rotation * Math.PI / 180 : map.getView().getRotation()`.
- **Guardrail**: Wenn Map-Rotation via CSS-Transform (nicht View) gelÃ¶st wird, muss `options.rotation` immer explizit in Radiant in `rotRad` einfliessen.

## 2026-03-19 â€” Falsche Legende fÃ¼r WMS-Layer: â€žArcGIS Legend-Fehler: Service schweizmobil/MapServer not found"
- **Symptom**: Klick auf Legenden-Icon bei Gemeindegrenzen (Geoadmin WMS) Ã¶ffnet `legend-proxy.php?service=schweizmobil` â†’ Fehlermeldung â€žService schweizmobil/MapServer not found", da der Dienst nicht existiert.
- **Root-Cause**: `_propagateLegends()` in `tnet-lm-store.js` vererbt den Legend-Key (`"schweizmobil"`) von einer ArcGIS-Elterngruppe blind an ALLE Kind-Layer â€” auch an WMS/WMTS-Layer. `_openLegend()` in `tnet-lm-tree.js` schickt den Key dann an `legend-proxy.php`, das nur ArcGIS-Services versteht.
- **Fix**: `_propagateLegends()` prÃ¼ft bei Vererbung: Wenn Blatt-Layer (`type==='layer'`) ein `layerType` hat, das nicht `arcgisRest` ist, wird die Legende NICHT vom Eltern-Knoten geerbt.
- **Guardrail**: Legend-Vererbung darf nur an Layer gleichen Service-Typs erfolgen. `layerType`-Feld (von `extractLegendInfo()` in layers.php) immer als Typ-Check verwenden.

## 2026-03-19 â€” TnetLayerSwitch: Layer-Einschalten funktioniert nur fÃ¼r ersten LyrMgr (main_lyrmgr)
- **Symptom**: Checkbox-Klick auf Bundesdaten (Geoadmin WMS), Gemeindegrenzen, Obwalden-Layer im TNET-Tree zeigt keinen Layer auf der Karte. `switchLayersProgr` wird aufgerufen, meldet Erfolg, aber kein OL-Layer entsteht.
- **Root-Cause**: `TnetLayerSwitch()` in `tnet-mapplus-helpers.js` iteriert `am.LyrMgr` mit `break` beim ersten LyrMgr der `targetMap='main'` hat â†’ nimmt immer `main_lyrmgr` (NW-Layer). Layer wie `municipalities_borders` (Geoadmin) sind aber in `second_lyrmgr` oder `forth_lyrmgr` registriert. `switchLayersProgr` auf dem falschen LyrMgr Ã¼berspringt unbekannte Layer still.
- **Fix**: Statt `break` bei erstem Match: Alle LyrMgr mit `getLayerById(layerId)` abfragen und denjenigen nehmen, der den Layer kennt. Fallback: auf allen LyrMgr `switchLayersProgr` aufrufen.
- **Guardrail**: Bei Multi-LyrMgr-Setups (main/second/third/forth) NIE auf den ersten LyrMgr beschrÃ¤nken. Einschalten muss wie Ausschalten ALLE LyrMgr durchsuchen.

## 2026-03-19 â€” Eckige Klammern in Layer-Namen werden abgeschnitten, z.B. "Gemeindegrenzen [04/2025]" â†’ "2025]"
- **Symptom**: NLS-Beschreibungen mit `/` in eckigen Klammern (z.B. `[04/2025]`, `[kWh/m2]`) werden in der aktiven-Themen-Liste falsch dargestellt â€” nur das letzte Segment nach `/` bleibt sichtbar.
- **Root-Cause**: `_cleanPathName()` in `tnet-lm-store.js` splittet den Namen am `/` um Pfade wie `"Gis Basis/gemeindegrenzen"` aufzulÃ¶sen. Aber `"Gemeindegrenzen [04/2025]"` enthÃ¤lt ebenfalls `/` â†’ `split('/').pop()` ergibt `"2025]"`.
- **Fix**: Vor dem Split Klammer-Inhalt entfernen (`name.replace(/\[[^\]]*\]/g, '')`) und prÃ¼fen, ob dann noch ein `/` vorhanden ist. Falls nicht, Name unverÃ¤ndert zurÃ¼ckgeben.
- **Guardrail**: Bei Pfad-Split-Logik immer prÃ¼fen, ob der `/` innerhalb von Klammern, AnfÃ¼hrungszeichen oder anderen Sonderzeichen steht. Eckige Klammern in NLS-Texten sind verbreitet (Einheiten, Datumsangaben).

## 2026-03-13 â€” Basemap-Wechsel: "Duplicate item added to a unique collection" beim Orthofoto
- **Symptom**: Klick auf Orthofoto (swissimage) wirft `Uncaught Error: Duplicate item added to a unique collection` in OpenLayers Collection.setAt().
- **Root-Cause**: Framework's `changeBaseMap()` ruft `mapObj.getLayers().setAt(0, basisMaps[id])` ohne zu prÃ¼fen, ob das Layer-Objekt bereits an Index 0 liegt. OpenLayers' `assertUnique_` wirft, wenn dasselbe Objekt schon in der Collection ist â€” auch am Ziel-Index.
- **Fix**: Guard im `changeBaseMap`-Hook (tnet-basemap.js): Vor dem Framework-Aufruf prÃ¼fen ob `mapObj.getLayers().item(0) === basisMaps[actualBasemapId]`. Wenn ja, Framework-Aufruf Ã¼berspringen, `onBasemapChange` aber trotzdem ausfÃ¼hren (fÃ¼r Zeitreise-Overlay).
- **Guardrail**: Bei OpenLayers `Collection.setAt()` immer vorher prÃ¼fen, ob das Element schon in der Collection ist. Framework-Code kann diesen Check nicht, daher im Hook abfangen.

## 2026-03-10 â€” Kartenportal: Ã–FFNEN-Button-Klick tut nichts bei bestimmten Karten (z.B. Gefahrenkarte OW)
- **Symptom**: Klick auf "Ã–FFNEN" bei Gefahrenkarte Obwalden hat keine Wirkung.
- **Root-Cause**: `processExtractedLinks()` ersetzt WP-onclick (`setMapBookmark`) mit `TnetSetBookmark(bookmarkId)`, das einen API-Lookup macht. Die WP-Seite verwendet Bookmark-Namen (z.B. `ow_gefahrenkarte`), die nicht im Bookmark-API existieren (API kennt `ow_naturgefahren_pro`). `TnetSetBookmark` fÃ¤ngt den Fehler still ab â†’ keine Aktion.
- **Fix**: Fallback in onclick: wenn `TnetSetBookmark` `{success: false}` liefert â†’ direkter Framework-Aufruf `window.top.njs.AppManager.setMapBookmark(['main'], originalParams)` mit den originalen WP-Parametern.
- **Guardrail**: Bei Link-Rewriting immer einen Fallback auf den direkten Framework-Aufruf einbauen, wenn der API-basierte Bookmark-Lookup fehlschlÃ¤gt.

## 2026-03-10 â€” Proxy-SSO: redirect_to zurÃ¼ck zum Proxy blockiert WP-Session
- **Symptom**: Nach OAuth-Flow zeigt der Proxy-iframe weiterhin den Login-Button; Auto-Click lÃ¶st Loop aus statt den Benutzer einzuloggen.
- **Root-Cause**: Proxy-PHP fetched `www.gis-daten.ch` via cURL mit `$_COOKIE` des Browsers (`nwow.mapplus.ch`-Domain). WP-Session-Cookie wurde vom Browser fÃ¼r `gis-daten.ch`-Domain gesetzt â†’ wird NIE an `nwow.mapplus.ch` gesendet â†’ cURL bekommt WP-Cookie nie â†’ Proxy sieht stets Login-Button.
- **Fix**: `redirect_to` NICHT auf die Proxy-URL patchen. Nach OAuth landet das iframe direkt auf `www.gis-daten.ch` mit aktiver WP-Session (identisch zum manuellen Klick). Robustes Polling (20Ã—300 ms) statt Einzel-Timeout; `window.location.href = btn.href` statt `.click()`.
- **Guardrail**: Proxy kann WP-Cookies nie per cURL forwarden wenn Proxy und WP auf unterschiedlichen Domains laufen. Auto-Login muss das iframe auf die Ziel-Domain navigieren lassen, nicht zurÃ¼ck zum Proxy.

## 2026-03-10 â€” Proxy-SSO: sessionStorage-Flag blockiert Auto-Click nach Hard-Reload
- **Symptom**: WP Login-Button erscheint nach Hard-Reload trotz Auto-Login-Logik; manueller Klick funktioniert, automatischer nicht.
- **Root-Cause**: `sessionStorage.getItem('tnet_sso_attempted')` persistiert Ã¼ber Seitenreloads (sessionStorage wird erst beim Tab-SchliesÂ­sen geleert) â†’ Flag aus vorangehender Session blockiert den Auto-Click beim nÃ¤chsten Besuch.
- **Fix**: Loop-Schutz als reine In-Memory-Variable `_ssoAttempted` (resettet bei jedem Seitenload) statt sessionStorage. ZusÃ¤tzlich: Button-href patchen via `patchLoginButtonRedirect()`, sodass OAuth nach Abschluss mit `sso_done=1` zum Proxy zurÃ¼ckleitet statt zur gis-daten.ch Startseite. Kein Auto-Click wenn `sso_done=1` in URL.
- **Guardrail**: Persistenten Storage (sessionStorage/localStorage) fÃ¼r Einmal-Flags nur verwenden, wenn explizites Ablaufdatum oder manueller Reset vorhanden.

## 2026-03-10 â€” Proxy-SSO: window.location.href Redirect verhindert proxy-inject.js Init
- **Symptom**: Keine Konsolenausgaben von proxy-inject.js; WP-Login-Button erscheint trotz aktiver mapplus-Session; manueller Button-Klick funktioniert aber die Auto-Auth nicht.
- **Root-Cause**: PHP injizierten `window.location.href`-Redirect als Inline-`<script>` vor `</body>`. Dieser feuert synchron beim HTML-Parsen â€” bevor DOMContentLoaded und damit proxy-inject.js initialisieren.
- **Fix**: PHP-Redirect deaktiviert; `proxy-inject.js` erhÃ¤lt neue `autoClickLoginBtn()`-Funktion, die den WP-OAuth-Button per JS klickt (simuliert den manuellen Klick). Loop-Schutz via `sessionStorage`-Flag `tnet_sso_attempted`; Reset via `?sso_done=1`.
- **Guardrail**: Keine synchronen `window.location.href`-Redirects in Inline-Scripts injizieren â€” externe Script-Tags werden dadurch nie ausgefÃ¼hrt.

## 2026-03-09 â€” Server-Cache liefert veraltete API-Responses nach PHP-Fix
- **Symptom**: Nach Deploy von PHP-Fixes zeigt der LayerManager weiterhin alte/falsche Daten (z.B. â€žOereb Raumplanung 0" statt â€žRAUMPLANUNG"). API-Response mit `&debug=1` korrekt, ohne debug falsch.
- **Root-Cause**: `JsonCache` invalidiert nur bei geÃ¤nderter Quell-Datei (lyrmgr.conf, mapping) â€” Ã„nderungen an PHP-Logik (layers.php) lÃ¶sen keine Cache-Invalidierung aus. Die 1h-TTL hielt die alte Response im Cache.
- **Fix**: (a) Neuer `nocache`-URL-Parameter in layers.php: `$noCache = isset($_GET['nocache']) && $_GET['nocache'] === '1'`, Cache-Bypass: `!$debug && !$noCache`. (b) Neue `cache: true|false`-Option in `tnet-global-config.json5` (layerManager-Sektion). (c) JS hÃ¤ngt `&nocache=1` an API-URL wenn `_config.cache === false`. (d) Server-Cache manuell geleert via `POST cache.php?action=clear`.
- **Guardrail**: Nach PHP-Logik-Ã„nderungen immer Server-Cache leeren (`POST cache.php?action=clear`). Bei Entwicklung `cache: false` in json5 setzen. FÃ¼r Produktion `cache: true` verwenden.

## 2026-03-09 â€” source=file: NLS-Labels fehlen + Ã–REB-Knoten nicht Ã¶ffenbar
- **Symptom**: Bei `lyrmgrSource: 'file'` zeigt der LayerManager rohe Keys statt NLS-Labels (z.B. â€žOereb Raumplanung" statt â€žRAUMPLANUNG"). â€žOereb Raumplanung"-Knoten zeigt 0 Layer und lÃ¤sst sich nicht aufklappen.
- **Root-Cause**: Zwei Fehler: (1) Der `source=file`-Block in layers.php gab die rohe lyrmgr.conf als JSON zurÃ¼ck â€” ohne NLS-Label-Lookup (`getNlsLabel`), ohne Mapping-Merge, ohne `processLayerItems`. (2) `processLayerItems()` konnte assoziative Arrays (Key=Gruppen-ID, Value=Definition) nicht verarbeiten â€” nur Strings und `{name: ...}`-Objekte. Ã–REB-Subitems wie `{ "rp_liegenschaften": {...}, "rp_rechtskraeftig": {...} }` wurden stillschweigend Ã¼bersprungen â†’ 0 Layers. (3) Gruppen-Namen verwendeten `extractLayerName()` statt `getNlsLabel()`.
- **Fix**: (a) `source=file`-Early-Return-Block entfernt â†’ fÃ¤llt zum bewÃ¤hrten File-Fallback durch. (b) `processLayerItems` um `elseif (is_array($item) && is_string($key) && !is_numeric($key))` erweitert â†’ erkennt assoziative Gruppen. (c) Gruppen-Name: `getNlsLabel($groupId) ?: extractLayerName($groupId)`. (d) JS: client-seitige Transformation entfernt, gleicher Response-Parser wie API.
- **Guardrail**: `processLayerItems` muss drei FÃ¤lle abdecken: (1) `is_string` â†’ Leaf-Layer, (2) `isset($item['name'])` â†’ benannte Gruppe/Layer, (3) `is_string($key) && !is_numeric($key)` â†’ assoziatives Objekt (Key = ID). NLS-Labels immer zuerst via `getNlsLabel()` probieren, `extractLayerName()` nur als Fallback.

## 2026-03-08 â€” Accordion-Scroll: Inhalt unten abgeschnitten bei grossem Themenkatalog
- **Symptom**: Wenn der Themenkatalog-Abschnitt per Drag-Handle vergrÃ¶ssert wird, kann im Layer-Tree nicht mehr ganz nach unten gescrollt werden. Bei kleinerem Abschnitt funktioniert es.
- **Root-Cause**: `getMaxHeight()` gab `innerHeight - 150` zurÃ¼ck (statisch). `#spring` hat aber `max-height: calc(100vh - 105px)` und enthÃ¤lt andere Elemente (TitlePane-Titelleisten, Resize-Handles, Padding â‰ˆ 160px). Bei grosser HÃ¶he ragte `#lm-tree-container` Ã¼ber `#spring` hinaus â€” der Container fing Scroll-Events ab, aber der untere Teil war von `#spring` abgeschnitten.
- **Fix**: `getMaxHeight(panelId)` berechnet nun dynamisch den verfÃ¼gbaren Platz: misst `#spring`'s computed max-height, subtrahiert alle Geschwister-Elemente (`offsetHeight`) und die eigene Titelleiste. Alle 7 Call-Sites aktualisiert.
- **Guardrail**: Maximale HÃ¶he fÃ¼r Accordion-Panels IMMER aus dem tatsÃ¤chlichen Container-Platz ableiten, nie aus `window.innerHeight` mit statischem Offset.

## 2026-03-08 â€” Bundesdaten (Geoadmin WMS) lassen sich nicht einschalten
- **Symptom**: Geoadmin-Layer (z.B. `ch.astra.baulinien-nationalstrassen`) einschalten â†’ Log: `Coalesce: Sublayer-Nummer nicht extrahierbar`. Layer wird nicht auf der Karte angezeigt.
- **Root-Cause**: `LayerImporter.php` setzt `service_url`/`coalesce_group` auf jede Gruppe, deren Kind-Layer dieselbe Basis-URL teilen â€” auch WMS-Gruppen (Geoadmin). `_scanCoalesceNodes` erkennt diese fÃ¤lschlich als Coalesce-Gruppen. `_extractSublayerNum` erwartet ArcGIS-Format `LAYERS: "show:3"`, WMS hat aber `layers: "ch.astra...."` â†’ gibt `null` zurÃ¼ck â†’ Aktivierung bricht ab.
- **Fix**: (1) JS: `_scanCoalesceNodes` prÃ¼ft `serviceUrl.indexOf('MapServer') !== -1` â€” nur ArcGIS-Dienste werden als Coalesce klassifiziert. (2) PHP: `LayerImporter.php` schreibt `service_url`/`coalesce_group` nur wenn URL `MapServer` enthÃ¤lt.
- **Guardrail**: Coalesce-Logik darf NUR fÃ¼r ArcGIS-MapServer-Dienste greifen. WMS-Dienste immer Ã¼ber Standard-Pfad (TnetLayerSwitch) aktivieren.

---

## 2026-03-08 â€” MapTip-Crash bei Coalesce-Layer-Aktivierung â†’ SelectAll-Checkbox hÃ¤ngt
- **Symptom**: Coalesce-Layer (z.B. Grundnutzung NW) per Suche oder Checkbox einschalten â†’ `Uncaught TypeError: Cannot read properties of null (reading 'minResolution')` in `njs.MapTip.addLayerCallback`. Ãœbergeordnete SelectAll-Checkbox aktualisiert sich nur jedes zweite Mal.
- **Root-Cause**: `_createRootOLLayer` ruft `map.addLayer(olLayer)` auf â†’ Dojo `MapTip.addLayerCallback` feuert synchron â†’ sucht `layerConf` im LyrMgr fÃ¼r Bridge-erstellte Layer â†’ `null.minResolution` â†’ Crash. Der Uncaught TypeError propagiert hoch durch `_addToCoalesceOLLayer` â†’ `setLayerVisible` â†’ `_emit('layer-visibility')` wird NIE erreicht â†’ Tree erhÃ¤lt kein Event â†’ `_updateSelectAllCheckboxes()` lÃ¤uft nicht. Beim 2. Klick existiert Root-OL-Layer bereits â†’ kein `map.addLayer()` â†’ kein Crash â†’ Events feuern korrekt.
- **Fix**: `map.addLayer(olLayer)` in `_createRootOLLayer` (tnet-coalesce-bridge.js) in try-catch gewrappt. OL fÃ¼gt den Layer vor dem Callback zur Collection hinzu, daher ist die KartenfunktionalitÃ¤t nicht betroffen.
- **Guardrail**: Bei jedem `map.addLayer()` fÃ¼r Bridge-erstellte Layer immer try-catch verwenden, da Dojo-Callbacks auf Layer-Events mit unbekannten Layer-Typen crashen kÃ¶nnen.

---

## 2026-03-08 â€” Suche: Layer-Aktivierung schlÃ¤gt fehl bei tiefen Sublayer-Pfaden
- **Symptom**: Ãœber die Suche "Grundnutzung" ausgewÃ¤hlt â†’ Layer wird nicht eingeschaltet. Log: `navigateToLayer: Layer nicht im DOM gefunden: gis_fach/ow_fliessgewaesser_intern/gewaesser/.../gewaesserraumzonen_grundnutzung`
- **Root-Cause**: Drei Probleme: (1) Coalesce-Bridge-Patch fÃ¤ngt `TnetLayerSwitch('on')` ab und gibt `true` zurÃ¼ck, auch wenn `setLayerVisible` still fehlschlÃ¤gt (Layer nicht im Store-Katalog). Dadurch kein Fallback auf Original. (2) Search-`activateLayer` nutzt nur TnetLayerSwitch, nicht den Store. (3) Such-API kann Layer-IDs liefern die tiefer liegen als lyrmgr.conf definiert (z.B. aus DB-Import) â†’ weder Store noch Dojo kennt diese IDs.
- **Fix**: (1) Bridge-Patch: `findLayer`-Check vor Store-Route â€” wenn Layer nicht im Katalog â†’ Fallback auf Original. (2) `activateLayer`: Store-first mit Eltern-Pfad-Fallback (Pfadsegmente kÃ¼rzen bis bekannter Layer gefunden). (3) `navigateToLayer`: DOM-Fallback auf Eltern-Pfad wenn exakte ID nicht gefunden.
- **Guardrail**: Bei TnetLayerSwitch-Patch immer verifizieren dass der Layer im Store existiert bevor `true` zurÃ¼ckgegeben wird. Such-Aktivierung immer Ã¼ber Store routen (Coalesce, Active-Liste, Sichtbarkeits-Tracking).

---

## 2026-03-07 â€” RÃ¤umliche Abfrage: Doppeltes ? in Proxy-URL bricht ArcGIS-Queries
- **Symptom**: RÃ¤umliche Abfrage (Polygon) liefert keine Ergebnisse fÃ¼r ArcGIS-Layer wie FruchtfolgeflÃ¤chen. Fetch schlÃ¤gt fehl oder gibt leere Antwort.
- **Root-Cause**: OL-Layer-Source liefert URL im `?path=`-Format: `agsproxy.php?path=gis_fach/.../MapServer`. Die Spatial Query hÃ¤ngt `/0/query?f=json&geometry=...` an â†’ entsteht URL mit **doppeltem `?`**: `agsproxy.php?path=.../MapServer/0/query?f=json&...`. Der Browser interpretiert alles nach dem ersten `?` als Query-String, wodurch `f=json` in den `path`-Parameter eingebettet wird.
- **Fix**: Neue Funktion `normalizeProxyUrl()` in `tnet-spatial-query.js`: konvertiert `agsproxy.php?path=X` â†’ `agsproxy.php/X` (PATH_INFO-Format). Wird in `getVisibleQueryableLayers()` (nach URL-Extraktion) UND in `querySingleLayer()` (vor Query-Bau) aufgerufen.
- **Guardrail**: Proxy-URLs kÃ¶nnen in zwei Formaten vorliegen (`?path=` und PATH_INFO). Vor dem AnhÃ¤ngen von `/sublayer/query?params` IMMER erst in PATH_INFO normalisieren, damit kein doppeltes `?` entsteht.

## 2026-03-07 â€” Ã–REB/Polygon-Zeichnen lÃ¶st gleichzeitig MapTip aus
- **Symptom**: Klick auf Karte wÃ¤hrend Ã–REB-Modus oder Polygon-Zeichnen (rÃ¤umliche Abfrage) lÃ¶st parallel einen MapTip-Request aus â†’ verwirrende doppelte Ergebnisse.
- **Root-Cause**: `tnet-info-bridge.js` singleclick-Handler kannte keine Tool-ExklusivitÃ¤t. OL feuert alle registrierten singleclick-Listener unabhÃ¤ngig voneinander â€” `evt.stopPropagation()` blockiert nur DOM-Events, nicht OL-Event-Listener.
- **Fix**: Am Anfang von `_handleClick()` in der Bridge prÃ¼fen: `window.isOerebActive` â†’ early return; `window.isPolygonDrawing` â†’ early return. Globals werden von `tnet-oereb.js` bzw. `tnet-spatial-query.js` korrekt gesetzt/zurÃ¼ckgesetzt.
- **Guardrail**: Jedes neue Tool, das eigene Klick-Handler registriert, MUSS ein globales Flag setzen (z.B. `window.isToolXActive`) und dieses in der Bridge als Gate abfragen.

## 2026-03-06 â€” MapTips feuern nicht: Sublayer-Name â‰  OL-Layer-Name (Prefix-Mismatch)
- **Symptom**: Layer wie `gis_fach/nw_fruchtfolgeflaechen` auf der Karte sichtbar, aber TnetSyncMapTips aktiviert keinen MapTip â†’ null Queries beim Klick.
- **Root-Cause**: MapTip-Config hat `linked_layer = gis_fach/nw_fruchtfolgeflaechen/fruchtfolgeflaeche` (Sublayer-Key), aber der OL-Layer auf der Karte heisst `gis_fach/nw_fruchtfolgeflaechen` (Parent-Key). TnetSyncMapTips machte exakten Vergleich â†’ kein Match â†’ MapTip nie aktiviert. Auch `getLayerByMap()` findet den Sublayer-Key nicht, weil er nicht im LyrMgr registriert ist (nur der Parent ist in lyrmgr.conf).
- **Fix**: (1) Prefix-Matching in `TnetSyncMapTips`: Wenn exakter match fehlschlÃ¤gt, wird der Parent-Pfad sukzessive verkÃ¼rzt (`split('/')`, `pop()`) bis ein sichtbarer OL-Layer gefunden wird. (2) Wenn Prefix-Match: `mt.wms_layer = parentOLLayer` setzen, damit `queryconnector()` eine gÃ¼ltige Layer-Quelle hat (getLayerByMap wÃ¼rde null returnen).
- **Guardrail**: linked_layer_id in Maptips-Configs kann Sublayer-Pfade enthalten die lÃ¤nger sind als der OL-Layer-Name. IMMER Prefix-Matching verwenden, nie exakt vergleichen.

## 2026-03-06 â€” Proxy Ã¼berschreibt distance-Parameter â†’ 1m Suchradius
- **Symptom**: MapTip-Queries werden korrekt dispatcht, aber ArcGIS REST `/query` liefert keine Features trotz Klick auf sichtbare Objekte.
- **Root-Cause**: `agsproxy.php` setzt `$queryParams['distance'] = 1.0` IMMER â€” auch wenn der Client einen eigenen Wert sendet (z.B. 200m = viewResolution Ã— tolerance). Der Query-Endpunkt des ArcGIS-Servers sucht dadurch nur in 1m Radius.
- **Fix**: Auto-Parameter nur als Default setzen: `if (!isset($queryParams['distance']))` vor der Zuweisung.
- **Guardrail**: Proxy-Auto-Parameter nie bedingungslos Ã¼berschreiben. Immer `isset()`-Check, damit Client-Werte Vorrang haben.

## 2026-03-06 â€” "Keine Objekte gefunden" trotz korrekter MapTip-Registrierung
- **Symptom**: `TnetInfoBridge.diagnose()` zeigt 17 wmsActiveLyrs / 29 aktive MapTips. Klick dispatcht 2 Queries, aber Ergebnis ist immer "Keine Objekte gefunden".
- **Root-Cause**: `TnetSyncMapTips` setzte `mt.wms_layer = olLayerOnMap` fÃ¼r MapTips OHNE eigene `url`. Der OL-Layer auf der Karte nutzt eine Proxy-URL (`/maps/agsproxy.php?path=.../MapServer`). `queryconnector()` baut daraus fÃ¼r esrigeojson: `proxyUrl + "/0/query?f=json&..."` â†’ doppeltes `?` in der URL â†’ Query-Parameter werden als agsproxy-Parameter statt als ArcGIS-Parameter geparst â†’ leeres Ergebnis. Im nativen Framework-Flow bleibt `wms_layer = null`, und `queryconnector()` nutzt `getLayerByMap()` â†’ Framework-Layer-Wrapper â†’ korrekte URL-AuflÃ¶sung.
- **Fix**: In `TnetSyncMapTips` KEINEN `wms_layer` mehr setzen. Nur `mt.active` / `wmsActiveLyrs` verwalten. `queryconnector()` fÃ¤llt auf den nativen `getLayerByMap()`-Pfad zurÃ¼ck.
- **Guardrail**: *Niemals* `mt.wms_layer` von aussen setzen â€” dieses Property gehÃ¶rt ausschliesslich dem Framework (`Activate()` bei MapTips mit `url`). TnetSyncMapTips darf nur `mt.active` und `wmsActiveLyrs` steuern.

## 2026-03-05 â€” Doppelte MapTip-Requests bei Coalesce-Sublayern (z.B. Grundnutzung)
- **Symptom**: Beim Klick auf die Karte werden zwei identische REST-Requests an denselben MapServer-Sublayer (z.B. `/12/query`) gesendet â€” einer mit korrektem NLS/Alias, einer ohne.
- **Root-Cause**: In `maptips_tnet_oereb_multi.conf` existieren ZWEI MapTip-Objekte fÃ¼r die gleiche `query_layers`-Nummer: ein Root-Level-MapTip (`_def_12`, `linked_layer = Root-Key`, generisch `qryFields: ["*"]`) und ein Sublayer-MapTip (`_def/grundnutzung_12`, `linked_layer = Sublayer-Key`, detaillierte Felder + NLS). Wenn die Bridge `TnetLayerSwitch(rootKey, 'on')` aufruft, feuert das Framework `addLayerCallback` fÃ¼r ALLE Root-Level-MapTips â†’ Root-MapTip `_def_12` wird in `wmsActiveLyrs` gepusht. Gleichzeitig pusht die Bridge den Sublayer-MapTip `_def/grundnutzung_12`. Beide haben `query_layers = "12"` â†’ `queryconnector()` wird zweimal aufgerufen.
- **Fix**: In `_forceActivateMaptip()` (tnet-coalesce-bridge.js) nach Aktivierung eines Sublayer-MapTip die `query_layers` sammeln und Root-Level-MapTips mit gleicher `query_layers` aus `wmsActiveLyrs` entfernen (Dedup). Der spezifischere Sublayer-MapTip hat Vorrang.
- **Guardrail**: Immer wenn `_forceActivateMaptip` einen Sublayer-MapTip aktiviert, Root-Level-Duplikate prÃ¼fen und deaktivieren

## 2026-03-05 â€” Maptip-Breadcrumb neben Titel statt darunter
- **Symptom**: Im Objektinfo-Panel erscheint der Breadcrumb-Text (z.B. "Ã–REB > Nutzungsplanung") neben dem Titel statt auf einer eigenen Zeile darunter.
- **Root-Cause**: `.dijitTitlePaneTitle` hat `display: flex` mit default `flex-wrap: nowrap`. Der Breadcrumb-div (`display: block`) wird als Flex-Kind trotzdem in die gleiche Zeile gezwungen.
- **Fix**: `flex-wrap: wrap !important` auf `#njs_info_pane_content .dijitTitlePaneTitle`, plus `width: 100%; flex-basis: 100%` auf `.tnet-maptip-breadcrumb` â€” erzwingt Zeilenumbruch.
- **Guardrail**: Flex-Kinder brechen nur um wenn der Container `flex-wrap: wrap` hat UND das Kind volle Breite beansprucht.

---

## 2026-03-05 â€” Maptip-Breadcrumb verursachte Browser-HÃ¤nger
- **Symptom**: Beim Ã–ffnen von Maptips hing die Applikation (Browser meldete langlaufenden/aufgehÃ¤ngten Code).
- **Root-Cause**: Die Breadcrumb-AuflÃ¶sung scannte rekursiv den gesamten Layer-Tree und wurde durch den MutationObserver sehr hÃ¤ufig erneut ausgelÃ¶st.
- **Fix**: Auf schnellen, begrenzten Resolver ohne Full-Tree-Scan umgestellt und Breadcrumb-Rendering im Observer entprellt (Timer statt Direktlauf pro Mutation).
- **Guardrail**: Keine teuren Traversals im MutationObserver-Callback; UI-Anreicherung immer throttlen/debouncen und auf bekannte Layer-Keys begrenzen.

## 2026-03-05 â€” Ã–REB-Tool blockiert Sidepanel/Layermanager komplett
- **Symptom**: Bei aktivem Ã–REB-Abfrage-Tool kann das Sidepanel (Layermanager, Themenkatalog) nicht mehr bedient werden â€” Klicks gehen auf die Karte statt auf das Panel.
- **Root-Cause**: `body.oereb-mode` setzt `pointer-events: none !important` auf `#freepane` und alle Kinder (analog `drawing-mode`). Das blockiert das gesamte Sidepanel, obwohl Ã–REB-Klicks direkt auf dem OL-Map-Objekt via `map.on('singleclick')` registriert sind und kein DOM-Event-Blocking brauchen.
- **Fix**: CSS-Regeln `body.oereb-mode #freepane { pointer-events: none }` entfernt. Der Ã–REB-Klick-Listener funktioniert weiterhin, da er direkt am OL-Map-Objekt hÃ¤ngt. Maptip-UnterdrÃ¼ckung erfolgt im JS via `evt.stopPropagation()` und `suppressInfoHighlightLayer`.
- **Guardrail**: `pointer-events: none` auf `#freepane` nur bei echtem Zeichen-Modus (drawing-mode) verwenden, nicht bei Tool-Modi die nur Kartenklicks abfangen. Ã–REB, Spatial Query etc. registrieren sich direkt am OL-Map und brauchen kein DOM-Level-Blocking.

## 2026-03-05 â€” Dargestellte Themen: Gruppenname zeigt URL-Pfad statt lesbaren Namen
- **Symptom**: Coalesce-Gruppen zeigen z.B. `gis_oereb/nw_planungszon_def` statt den lesbaren Namen aus dem Dojo-LyrMgr.
- **Root-Cause**: `_scanCoalesceNodes` setzt `name: servicePath || n.name || n.id` â€” `servicePath` (der rohe URL-Pfad) gewinnt immer, auch wenn `n.name` bereits einen bereinigten Namen enthÃ¤lt. Zudem fehlt ein Lookup gegen die lyrmgrResources-Bezeichnungen im Dojo-LyrMgr.
- **Fix**: PrioritÃ¤t umgekehrt auf `n.displayName || n.name || servicePath || n.id`. Neue Methode `_enrichCoalesceNamesFromDojo()` liest nach `_syncFromMap` aus `njs.LayerMgr.arCategories[].arSubCategories[].arLayers[].description` (= lyrmgrResources-Text) und Ã¼berschreibt `_coalesceIndex[groupId].name`.
- **Guardrail**: `servicePath` ist nie ein lesbarer Name â€” immer als letzten Fallback verwenden. Dojo-LyrMgr-`description` ist die Authority fÃ¼r menschenlesbare Gruppenbezeichnungen.
- **Update 2026-03-05**: BenutzergewÃ¼nscht: servicePath soll als Gruppenname angezeigt werden (z.B. `gis_oereb/nw_nutzungsplanung_def`). PrioritÃ¤t jetzt: `servicePath || n.displayName || n.name || n.id`. DB-Name war generisch ("Virtueller Layer/Coalesce Layer").
- **Update v3 2026-03-05**: `_enrichCoalesceNamesFromDojo` war mit 4 Bugs komplett kaputt: (1) `njs.LayerMgr` statt `njs.AppManager.LyrMgr`, (2) `arSubCategories` statt `arCategories`, (3) Nicht-rekursiv, (4) ID-Mismatch Dojo-Kategorie-ID vs. Coalesce-Gruppen-ID. Fix: Reverse-Lookup Ã¼ber Kind-Layer-Namen â€” Dojo-Kategorie die Layer enthÃ¤lt deren `name` zu einer Coalesce-Gruppe gehÃ¶rt â†’ deren `description` als Gruppenname verwenden. Bridges die ID-LÃ¼cke zwischen Dojo (`rp_def_np_fl_nutzungszonen`) und Coalesce (`gis_oereb/nw_nutzungsplanung_def`).

## 2026-03-05 â€” Maptips feuern nicht fÃ¼r Coalesce-Sublayer
- **Symptom**: Klick in die Karte auf Coalesce-Layer zeigt kein Info-Panel. MapTips werden nie aktiviert.
- **Root-Cause**: Framework aktiviert MapTips nur wenn ein OL-Layer mit `name === linked_layer_id` zur Map hinzugefÃ¼gt wird. Coalesce-OL-Layer hat den Dienst-Pfad als Name (z.B. `gis_oereb/nw_nutzungsplanung_def`), MapTips haben Sublayer-Keys als `linked_layer_id` (z.B. `gis_oereb/nw_nutzungsplanung_def/grundnutzung`). â†’ MapTips nie in `wmsActiveLyrs` â†’ `queryconnector()` wird nie aufgerufen. Bisherige `lookupCallbacks`-Registrierung war wirkungslos, da das Framework diese nie ausliest.
- **Fix**: Neue Funktionen `_forceActivateMaptip(sublayerKey, olLayer)` / `_forceDeactivateMaptip(sublayerKey)` in tnet-coalesce-bridge.js. Setzen `mt.wms_layer = olLayer` und pushen MapTip manuell in `wmsActiveLyrs`. Aufgerufen von `registerSublayer` (Bridge), `patchMaptipForCoalesceLayer` (Standard-Coalesce), `_installMaptipPatch` (Nachholen) und den Deaktivierungs-GegenstÃ¼cken.
- **Guardrail**: Jeder OL-Layer ausserhalb des Frameworks braucht manuelles Maptip-Lifecycle-Management (`wmsActiveLyrs.push` / `.remove`, `mt.active`, `mt.wms_layer`). `lookupCallbacks` allein reicht nicht â€” die Abfrage muss erst durch `queryconnector()` ausgelÃ¶st werden.

## 2026-03-05 â€” Dargestellte Themen: Auge und Deckkraft ohne Wirkung bei legacy-geschalteten Layern
- **Symptom**: Klick auf Auge-Icon oder Deckkraft-Slider im "Dargestellte Themen"-Panel hat keinen Effekt, obwohl Layer sichtbar auf der Karte ist.
- **Root-Cause**: `toggleCoalesceGroupEye`/`setCoalesceGroupOpacity` prÃ¼fen nur `_coalesceOLLayers[groupId]` (Coalesce-Modus). Bei `useNewTree: false` werden Layer Ã¼ber den Dojo-LyrMgr eingeschaltet â€” dabei wird kein `_coalesceOLLayers`-Eintrag erstellt. Die Funktionen brechen stillschweigend ab (`return`).
- **Fix**: Legacy-Fallback-Zweig in beiden Funktionen ergÃ¤nzt: Iteriert Ã¼ber `info.childIds`, holt OL-Layer via `activeEntry._olLayerRef` oder `_findOLLayer`, setzt `setVisible()` / `setOpacity()` direkt. `_suppressMapSync` schÃ¼tzt vor RÃ¼ckkopplungs-Events.
- **Guardrail**: Coalesce-Funktionen mÃ¼ssen immer beide Modi unterstÃ¼tzen: Coalesce-OL-Layer (neuer Tree) UND individuelle OL-Layer pro Kind (Legacy-LyrMgr).

## 2026-03-04 â€” Coalesce-OL-Layer inkompatibel mit MapPlus-Framework
- **Symptom**: TNET-Coalesce erstellt eigene `__coalesce__`-OL-Layer mit `show:0,3,5` â€” MapTip, Bookmark/URL-State und Legacy-Checkboxen funktionieren nicht fÃ¼r diese Layer.
- **Root-Cause**: Der `ClassicLayerMgr` macht kein natives Coalescing â€” jeder `switchLayer()` erstellt einen eigenen OL-Layer. Das TNET-Coalesce-System erstellt Layer ausserhalb des Frameworks, die von `_wms_connector.lookupCallbacks` (MapTip) und `updateMapStatusUrl` (Bookmark) nicht erkannt werden.
- **Fix**: Neue `tnet-coalesce-bridge.js` als Framework-Bridge: registriert Coalesce-Sublayer in `lookupCallbacks`, synchronisiert URL-State via `history.replaceState()` und pflegt Legacy-Dojo-Checkboxen. Zudem Debounce fÃ¼r `_updateCoalesceLAYERSParam` (50ms Default) um bei schnellem Aktivieren nur einen Server-Request auszulÃ¶sen.
- **Guardrail**: OL-Layer die ausserhalb des MapPlus-Frameworks erstellt werden, mÃ¼ssen immer manuell in `_wms_connector.lookupCallbacks` registriert werden (Key: `<URL>~<normalizedLayerName>`). Nie annehmen, der ClassicLayerMgr mache automatisch Coalescing.

## 2026-03-05 â€” Bridge v1 MapTip zeigt `__coalesce__`-Gruppennamen statt echte Layer-Info
- **Symptom**: MapTip zeigt `__coalesce__rp_def_np_fl_nutzungszonen (Layer 12)` â€” den internen Coalesce-Gruppennamen statt der echten Objektinformation.
- **Root-Cause**: Bridge v1 erstellte eigene `__coalesce__`-OL-Layer ausserhalb des Frameworks. Die lookupCallbacks zeigten auf diese internen Layer-URLs, aber der MapTip-Handler konnte die `linked_layer`-Referenzen nicht korrekt auflÃ¶sen. Der OL-Layer-Name (`__coalesce__...`) wurde statt des konfigurierten Titels angezeigt.
- **Fix**: Bridge v2 (Root-Dienst-Strategie): Anstatt eigene OL-Layer zu erstellen, werden die bereits in `layers_tnet_oereb_multi.conf` existierenden Root-Dienste (z.B. `gis_oereb/nw_nutzungsplanung_def`) via `TnetLayerSwitch(rootKey, 'on')` aktiviert. Die Sublayer-Sichtbarkeit wird Ã¼ber `source.updateParams({LAYERS: 'show:0,3,5'})` gesteuert. Da der OL-Layer vom Framework erstellt wird, funktionieren MapTip, Legende und Bookmark automatisch. Store-Hooks in `_addToCoalesceOLLayer`, `_removeFromCoalesceOLLayer`, `_removeCoalesceOLLayer` und `toggleLayerEye` prÃ¼fen `Bridge.canHandle()` und delegieren ggf. an die Bridge. `_findOLLayer` hat einen Bridge-Fallback fÃ¼r Sublayerâ†’Root-AuflÃ¶sung.
- **Guardrail**: Coalesce-Layer die einen Root-Dienst in der Framework-Config haben, IMMER Ã¼ber die Bridge (TnetLayerSwitch) verwalten â€” nie eigene OL-Layer erstellen. FÃ¼r Root-Dienste mÃ¼ssen `layers_tnet_oereb_multi.conf`-EintrÃ¤ge vorhanden sein.

---

## 2026-03-04 â€” Nordpfeil und Massstabstext im PDF nicht sichtbar
- **Symptom**: Nach EinfÃ¼hrung von `rotateNorthArrowInSvg()` fehlen Nordpfeil und ggf. Massstabstext im exportierten PDF.
- **Root-Cause**: Z-Order-Problem. Der Nordpfeil liegt innerhalb des MAP_AREA. `pdf.svg()` rendert das SVG (inkl. rotiertem Nordpfeil) als unterste Schicht. Danach folgen ein weisses Rect + Kartenbild, die den Bereich komplett Ã¼berdecken. `drawNorthArrow()` wurde wegen `_northArrowInSvg`-Flag fÃ¤lschlich Ã¼bersprungen. ZusÃ¤tzlich konnte `pdf.svg()` den jsPDF-internen Graphics-State (Clip/Transform) verÃ¤ndern, was folgende `drawScaleLabel()`/`drawScaleBar()`-Aufrufe beeintrÃ¤chtigte.
- **Fix**: (1) `rotateNorthArrowInSvg()`-Aufruf im Export-Flow deaktiviert (Nordpfeil innerhalb MAP_AREA â†’ wird immer Ã¼berdeckt). (2) `drawNorthArrow()` wird jetzt IMMER nach dem Kartenbild aufgerufen, ohne `_northArrowInSvg`-Skip. (3) `drawDynamicElements()` und `drawScaleLabel()` mit `saveGraphicsState()`/`restoreGraphicsState()` abgesichert.
- **Guardrail**: Dynamische Elemente, die innerhalb des MAP_AREA liegen, mÃ¼ssen IMMER per jsPDF NACH dem Kartenbild gezeichnet werden. SVG-basierte Manipulation funktioniert nur fÃ¼r Elemente ausserhalb des MAP_AREA (z.B. Titel, Copyright).

## 2026-03-04 â€” Nested Layer-Accordion toggelt im Log, aber bleibt visuell zu
- **Symptom**: Klick auf verschachtelte Layer-Kategorien loggt korrekt `OPEN/CLOSE`, aber das Accordion bleibt geschlossen und zeigt keine Inhalte.
- **Root-Cause**: Kombination aus (1) detached-Container beim Nested-Build, (2) doppeltem Event-Pfad (`ondijitclick` + nativer `click`) und (3) CSS-Konflikt: `.tabs2acc-panel .categoryHeader { display:none !important; }` blendete verschachtelte Container aus, weil sie dieselbe Klasse erhielten.
- **Fix**: Nested-Build auf echten Pane-Container stabilisiert (`_buildContentHeader()` im Nested-Context Ã¼bersprungen), Klickpfad auf **eine** Quelle reduziert und Re-Entrancy-Guard in `_setOpenAttr` ergÃ¤nzt. ZusÃ¤tzlich wird `categoryHeader` im Nested-Context nicht mehr gesetzt (bzw. entfernt), damit Tabs2Accordion-CSS die Nested-Inhalte nicht versteckt.
- **Guardrail**: Bei verschachtelten Dojo-Containern Klassennamen auf globale CSS-Regeln prÃ¼fen (insb. `display:none !important` in Tabs/Accordion-Styles) und Event-Toggle immer auf genau einen Pfad begrenzen.

## 2026-03-04 â€” Nested-Hierarchie-CSS soll nur bei aktivierter JSON5-Option greifen
- **Symptom**: Hierarchie-Styling griff global, auch wenn die erweiterte Legacy-Hierarchie nicht explizit gewÃ¼nscht war.
- **Root-Cause**: CSS-Regeln waren direkt auf `#layer_menu .dijitTitlePane[data-lyrmgr-depth]` gebunden, ohne Feature-Gate aus `tnet-global-config.json5`.
- **Fix**: Neues Config-Flag `layerManager.useLegacyNestedHierarchyStyle` eingefÃ¼hrt, in `window.__tnetLMFlags` exponiert und CSS auf `body.tnet-lm-legacy-nested ...` gescoped. ZusÃ¤tzlich `window.TnetDumpNestedCss()` fÃ¼r reproduzierbaren Style-Dump ergÃ¤nzt.
- **Guardrail**: GrÃ¶ssere Legacy-UI-Overrides immer per Feature-Flag in JSON5 schalten und CSS nie ungescoped global auf Standard-Pfade legen.

## 2026-03-04 â€” Nested-Hierarchie zeigt trotz korrekter Titel-Linie noch grauen linken Rand
- **Symptom**: EinrÃ¼ckung und Titel-Border pro Depth greifen, aber zusÃ¤tzlich bleibt eine graue linke Legacy-Linie (`rgb(51, 51, 51)`) sichtbar.
- **Root-Cause**: Der Standard-Rand der Dojo-`dijitTitlePane` blieb auf Pane-/Content-Ebene aktiv und konkurrierte mit der gewÃ¼nschten Titel-`border-left`-Logik.
- **Fix**: In `override.css` fÃ¼r `body.tnet-lm-legacy-nested #layer_menu .dijitTitlePane[data-lyrmgr-depth]` sowie `> .dijitTitlePaneContentOuter` den Rand per `border: 0 !important` plus `border-left: 0 !important` neutralisiert; Dump um Pane-Border-Metriken erweitert.
- **Guardrail**: Bei Legacy-Dojo-Hierarchien immer sowohl Titel- als auch Pane-/Content-RÃ¤nder prÃ¼fen; visuelle Vertical-Guides nur auf einem Elementpfad aktiv lassen.

## 2026-03-04 â€” Leaf-Layer erscheinen linksbÃ¼ndig statt unter der Nested-Unterkategorie
- **Symptom**: EintrÃ¤ge wie â€žGrundnutzungâ€œ stehen visuell ganz links, obwohl sie in einer tiefen Nested-Kategorie liegen.
- **Root-Cause**: Depth-Styling wurde auf `dijitTitlePaneTitle` angewendet, aber die Leaf-Layer-Container im Content erhielten keine depth-basierte Klasse/EinrÃ¼ckung.
- **Fix**: In `tnet-lyrmgr-patch.js` `_buildContentLayers` ergÃ¤nzt und Leaf-Container mit `tnet-lm-nested-leaf` + `data-lyrmgr-parent-depth` markiert; in `override.css` depth-spezifische `margin-left`-Regeln fÃ¼r diese Leaf-Container ergÃ¤nzt.
- **Guardrail**: Bei Hierarchie-CSS immer Header **und** Content-Leaves separat behandeln; reine Titel-EinrÃ¼ckung reicht fÃ¼r visuell korrekte Baumtiefe nicht aus.

## 2026-03-04 â€” Leaf-EinrÃ¼ckung wirkt trotz Depth-Attribut visuell weiterhin falsch
- **Symptom**: Child-Layer stehen nicht klar unter dem Parent-Titel, obwohl `data-lyrmgr-parent-depth` korrekt gesetzt ist.
- **Root-Cause**: EinrÃ¼ckung via `margin-left` am Leaf-Wrapper war durch Breiten-/Layoutregeln (Dojo/TOC) visuell unzuverlÃ¤ssig.
- **Fix**: Leaf-EinrÃ¼ckung auf `padding-left` umgestellt und pro Depth mit zusÃ¤tzlichem Offset gegenÃ¼ber Headern abgestuft, damit Checkbox+Label stabil in der Baumtiefe ausgerichtet sind.
- **Guardrail**: Bei Legacy-Dojo-Listen EinrÃ¼ckung fÃ¼r Zeileninhalte bevorzugt Ã¼ber `padding-left` statt Wrapper-`margin-left` lÃ¶sen.

## 2026-03-04 â€” Neuer Layer-Manager zeigte tiefe Gruppen nicht stufenweise (Farbe + EinrÃ¼ckung)
- **Symptom**: In der neuen Tree-Ansicht wirkten tief verschachtelte Ebenen (z.B. zwischen â€žRechtskrÃ¤ftigâ€œ und â€žNutzungszonenâ€œ) optisch auf gleicher Stufe.
- **Root-Cause**: Rekursive Nodes (`lm-nested-group`) erhielten keine depth-spezifischen Klassen/Attribute; CSS konnte daher nur eine fixe Nested-Stufe stylen.
- **Fix**: In `tnet-lm-tree.js` depth-Werte (`lm-depth-N`, `data-lm-depth`) rekursiv auf Header/Layer gesetzt und in `tnet-lm.css` pro Depth (1â€“6) abgestufte Farben (dunkelâ†’hell) sowie gestaffelte EinrÃ¼ckung fÃ¼r Header und Leaf-Zeilen ergÃ¤nzt (inkl. Desktop-Offsets).
- **Guardrail**: FÃ¼r rekursive Baum-UI immer depth-Metadaten bereits beim Rendern mitgeben; reine Klassen wie `nested` reichen fÃ¼r mehr als eine Unterebene nicht aus.

## 2026-03-04 â€” Legacy Gruppen-Checkbox schaltete Unterebenen nicht rekursiv
- **Symptom**: Bei deaktivierter Parent-Checkbox blieben unterliegende Layer teilweise sichtbar bzw. beim Reaktivieren ging der frÃ¼here Child-Zustand verloren.
- **Root-Cause**: `switchGroupLayers` arbeitete effektiv nur mit direkten `arLayers` der Zielkategorie; rekursive Unterkategorien wurden nicht konsistent verarbeitet.
- **Fix**: In `tnet-lyrmgr-patch.js` rekursives Sammeln aller Descendant-Layer ergÃ¤nzt, Parent-OFF auf rekursiv AUS umgestellt und beim OFF ein Sichtbarkeits-Snapshot gespeichert, der beim Parent-ON rekursiv restauriert wird. ZusÃ¤tzlich rekursive all/mixed/none-Checkbox-States fÃ¼r Gruppen eingefÃ¼hrt.
- **Guardrail**: FÃ¼r hierarchische Group-Toggles immer rekursiv Ã¼ber den vollstÃ¤ndigen Descendant-Baum arbeiten und den Child-Zustand vor Bulk-OFF explizit als Snapshot sichern.

## 2026-03-04 â€” Ausklappen brach nach rekursiver Gruppen-Logik (Legacy)
- **Symptom**: Nach der rekursiven Gruppen-Umschaltung reagierte das Ausklappen der Layer-Kategorien unzuverlÃ¤ssig bzw. brach bei Klicks auf Gruppen-Checkboxen.
- **Root-Cause**: Programmatische Checkbox-Status-Updates konnten in den Gruppen-`onClick`-Pfad hineinlaufen; zusÃ¤tzlich war `stopPropagation()` ohne Event-Guard anfÃ¤llig.
- **Fix**: In `tnet-lyrmgr-patch.js` Suppress-Flag fÃ¼r programmatische Checkbox-Updates ergÃ¤nzt und im Gruppen-`onClick` Event-Guards (`evt` prÃ¼fen, `stopPropagation`/`preventDefault` nur falls vorhanden) eingebaut.
- **Guardrail**: Bei Dojo-Checkboxen UI-State-Updates immer von Benutzer-Click-Handlern entkoppeln (Reentrancy-/Suppress-Guard + null-safe Event-Nutzung).

## 2026-03-04 â€” Parent/Child-Schaltung im Legacy-Tree war inkonsistent
- **Symptom**: Parent AUS schaltete Child-Layer nicht in allen FÃ¤llen effektiv aus der Karte; Child EIN zog Parent-Checkboxen nicht zuverlÃ¤ssig rekursiv nach.
- **Root-Cause**: Bei Einzel-Layer-Toggles fehlte ein konsistentes rekursives Refresh der Ã¼bergeordneten Gruppenstates; zusÃ¤tzlich konnten alte Gruppen-Snapshots trotz manueller Child-Ã„nderungen weiterwirken.
- **Fix**: `switchLayer` in `tnet-lyrmgr-patch.js` gepatcht: rekursives Parent-State-Refresh (all/mixed/none) nach jedem Layer-Toggle, OFF mit zusÃ¤tzlichem `removeLayerIfPossible`, Bulk-Suppress-Guard sowie Snapshot-Invalidierung entlang der Ancestor-Pfade bei manuellem Child-EIN.
- **Guardrail**: In hierarchischen TOCs nach jedem Child-Toggle Parent-States rekursiv neu berechnen und bei manuellen Child-Ã„nderungen gespeicherte Parent-Snapshots verwerfen.

## 2026-03-04 â€” Geklickte Gruppen-Checkbox blieb leer, wÃ¤hrend Parent/Child gesetzt wurden
- **Symptom**: Beim Aktivieren einer mittleren Gruppe wurden obere und untere Ebenen visuell gesetzt, das direkt geklickte KÃ¤stchen blieb jedoch leer.
- **Root-Cause**: Die Gruppen-State-Ableitung basierte primÃ¤r auf rekursiv gesammelten Descendant-Layern. FÃ¼r bestimmte Zwischenknoten lieferte die Statistik `total=0`, wodurch fÃ¤lschlich `none` zurÃ¼ckkam.
- **Fix**: `deriveCategoryState` in `tnet-lyrmgr-patch.js` erweitert: bei `total=0` Fallback auf rekursive Ableitung aus Subkategorien (`all/mixed/none`) und erst danach Checkbox-Fallback.
- **Guardrail**: Gruppen-State-Logik darf nicht nur auf direkt zÃ¤hlbaren Layern basieren; Zwischenknoten immer Ã¼ber Child-States auflÃ¶sen.

## 2026-03-04 â€” Eigene Gruppen-Checkbox verlor Check-Status nach Klick
- **Symptom**: Nach Klick auf eine Gruppen-Checkbox wurden Parent/Child korrekt gesetzt, aber das direkt geklickte KÃ¤stchen fiel in einzelnen FÃ¤llen visuell auf â€žnicht angekreuztâ€œ zurÃ¼ck.
- **Root-Cause**: `preventDefault()` im Dojo-Checkbox-`onClick` stÃ¶rte den nativen Toggle-Pfad des geklickten Widgets.
- **Fix**: `preventDefault()` aus dem Gruppen-Checkbox-Handler entfernt (nur `stopPropagation` belassen) und im `switchGroupLayers`-Pfad den Ziel-Checkbox-State nach dem Refresh explizit synchronisiert.
- **Guardrail**: Bei Checkbox-`onClick` nie pauschal `preventDefault()` setzen, ausser ein vollstÃ¤ndiger eigener Toggle-Flow ersetzt das native Widget-Verhalten.

## 2026-03-04 â€” Steuerung im Panel â€žDargestellte Themenâ€œ reagierte teilweise nicht
- **Symptom**: Auge/Deckkraft im Active-Panel wirkten bei einzelnen EintrÃ¤gen ohne Effekt, obwohl die EintrÃ¤ge sichtbar waren.
- **Root-Cause**: Die Aktionen verlieÃŸen sich auf `findLayer(layerId)` im Katalog. Bei EintrÃ¤gen ohne sauberen Katalog-Match brach der Standardpfad vor der Kartenaktion ab.
- **Fix**: In `tnet-lm-store.js` Fallback auf `activeEntry` + `_olLayerRef` ergÃ¤nzt; bei fehlendem OL-Ref wird fÃ¼r Standard-Layer auf `TnetLayerSwitch(on/off)` zurÃ¼ckgefallen. Deckkraft arbeitet nun ebenfalls Ã¼ber Active-Entry-Fallback.
- **Guardrail**: Active-Panel-Aktionen immer gegen beide Quellen robust machen: Katalog-Layer **und** aktive Laufzeit-EintrÃ¤ge.

## 2026-06-xx â€” Nordpfeil in Druck-Vorschau dreht sich nicht bei Rotation
- **Symptom**: Beim Ã„ndern des Rotations-Sliders im Druck-Panel dreht sich der Nordpfeil im SVG-Overlay nicht mit.
- **Root-Cause**: `insertDynamicSvgElements()` behandelte nur `scaleBar`/`scaleLabel`, nicht den Nordpfeil. Der Rotation-Slider aktualisierte die SVG-Vorschau nicht.
- **Fix**: In `insertDynamicSvgElements()` den QGIS-Nordpfeil-Path (`M8.003,-9.593`) per Path-Signatur finden, Transform-Matrix des Parent-`<g>` parsen, Rotations-Wrapper hinzufÃ¼gen. `rotationDeg` in `getPreviewValues()` ergÃ¤nzt. `refreshSvgPreviewValues()` wird jetzt auch vom Rotation-Slider aufgerufen.
- **Guardrail**: Bei dynamischen SVG-Elementen ohne `data-dynamic-type`-Rect: stabile Element-Signaturen (Path-Data, ID) fÃ¼r die Erkennung verwenden, nicht Reihenfolge/Index.

## 2026-03-04 â€” Druckrahmen initial falsch skaliert (erst nach Pan korrekt)
- **Symptom**: Beim Ã–ffnen des Druck-Panels wird der Druckrahmen zu gross/klein angezeigt; erst nach kleinem Pan stimmt die Skalierung.
- **Root-Cause**: `dockPrintPanel()` Ã¤ndert `mapContainer`-Breite und ruft `map.updateSize()` verzÃ¶gert (350ms). `showPrintFrame()` â†’ `updateFrameSize()` lÃ¤uft aber sofort, mit der alten Resolution/Viewport-GrÃ¶sse. Ebenso `adjustZoomForPrintFrame()` liest veraltete `clientWidth`.
- **Fix**: In `triggerPrintMapUpdate()` nach `updateSize()` auch `updateFrameSize()` aufrufen. `adjustZoomForPrintFrame()` in `openPdfPrinter` um 450ms verzÃ¶gern (nach Map-Update).
- **Guardrail**: Nach `map.updateSize()` immer alle davon abhÃ¤ngigen Berechnungen (Frame-GrÃ¶sse, Viewport-Ratio) erneut triggern.

## 2026-06-xx â€” Legend-Button fehlt bei ArcGIS REST Layern in "Dargestellte Themen"
- **Symptom**: Planungszonen kantonal/kommunal aktiv â†’ kein Legenden-Icon im "Dargestellte Themen"-Panel.
- **Root-Cause**: Die API lÃ¤uft im **Database-Modus** (`source: "database"`), nicht File-Modus. Alle `legendLink`/`legendTitle` sind `null` in der DB. Fix-Versuch Ã¼ber `processLayerItems()` (File-Modus) und `legend`-Property-Vererbung griff nicht. Der Click-Handler suchte nach `/rest/services/` im URL-Pattern, aber die Layer nutzen `agsproxy.php?path=`.
- **Fix**: Button-Bedingung in `tnet-lm-active.js` auf `l.layerType === 'arcgisRest' && l.url.indexOf('agsproxy.php') !== -1` geÃ¤ndert. Click-Handler extrahiert Service-Pfad aus `agsproxy.php?path=<pfad>` und konstruiert `legend-proxy.php?service=<pfad>`.
- **Guardrail**: Nie annehmen, dass die API im File-Modus lÃ¤uft â€” immer `?debug=1` prÃ¼fen fÃ¼r `source`-Feld. ArcGIS-Layer verwenden `agsproxy.php?path=`, nicht `/rest/services/`.

---

## 2026-03-03 â€” Entfernte Themen bleiben im BGI/WMS-Katalog angehakt
- **Symptom**: Layer in "Dargestellte Themen" entfernt, im BGI/WMS-Katalog bleibt die Checkbox trotzdem aktiv.
- **Root-Cause**: `tnet-wms-panel.js` synchronisiert Checkboxen Ã¼ber das Event `tnet-wms-layer-removed`. Beim `removeLayer()` in `tnet-lm-store.js` wurde dieses Event nur fÃ¼r `wms:`-Layer dispatcht, nicht fÃ¼r normale Geoadmin-Layer-IDs (`ch.*`).
- **Fix**: In `tnet-lm-store.js` beim Entfernen normaler Layer ebenfalls `tnet-wms-layer-removed` mit `detail.name = layerId` dispatchen.
- **Guardrail**: Bei Layer-Entfernung immer beide UI-Pfade synchronisieren: Store-Events (`layer-visibility`) **und** WMS-Panel-Event (`tnet-wms-layer-removed`).

---

## 2026-03-03 â€” Entfernte Themen bleiben im Dojo-Themenkatalog angehakt (alle LayerManager)
- **Symptom**: Layer in "Dargestellte Themen" entfernt â†’ Checkbox im Themenkatalog (nw, ow, bund, divers) bleibt checked.
- **Root-Cause**: `TnetLayerSwitch(id, 'off')` in `tnet-mapplus-helpers.js` rief nur `map.removeLayer(found)` auf â€” direkte OL-Entfernung ohne Benachrichtigung des Dojo ClassicLayerMgr. Der ClassicLayerMgr steuert Checkboxen intern via `switchLayer(id, false)` â†’ `dijit.byId(id).set('checked', false)`. ZusÃ¤tzlich wurde nur der **erste** LyrMgr gesucht (nw), nicht alle (ow, bund, divers).
- **Fix**: `TnetLayerSwitch('off')` iteriert jetzt Ã¼ber **alle** `am.LyrMgr` die `targetMap: ['main']` haben und ruft jeweils `mgr.switchLayer(layerId, false)` auf. In `tnet-lm-store.js` wird `TnetLayerSwitch` immer zuerst aufgerufen, `_olLayerRef` nur noch als Sicherheitsnetz.
- **Guardrail**: Layer-Entfernung **immer** Ã¼ber `ClassicLayerMgr.switchLayer(id, false)` â€” nie nur `map.removeLayer()`. Immer alle LyrMgr iterieren, nicht beim ersten `break`en.

---

## 2026-02-27 â€” Staging: "Dienst nicht gefunden" obwohl Dienst in raw-conf sichtbar
- **Symptom**: Staging-Merge meldet fÃ¼r alle gewÃ¤hlten Dienste "Dienst nicht gefunden: ewn_EWN_NIS" â€” Verwalten-Tab zeigt sie aber korrekt an.
- **Root-Cause**: `listRawConf()` berechnete `$svcKey = $parts[0] . '/' . $parts[1]` fÃ¼r ALLE Tiefen. Bei 2-Ebenen-Struktur (`service_dir/datei.conf`) wurde dadurch `svcKey = 'ewn_EWN_NIS/layers_...'` (directory+filename) statt nur `'ewn_EWN_NIS'` (directory). `stageServicesToImportToCore` suchte dann `is_dir('ewn_EWN_NIS/layers_...')` â†’ nicht gefunden.
- **Fix**: Drei-Wege-Logik fÃ¼r svcKey: `count >= 3` â†’ `parts[0]/parts[1]`, `count == 2` â†’ `parts[0]`, `count == 1` â†’ extractService(). Gleiche Korrektur in `deleteRawConfBackups`. `stageServicesToImportToCore` mit Flat-Fallback ergÃ¤nzt.
- **Guardrail**: svcKey-Berechnung zentral halten â€” nur EINE Funktion nutzen. Bei 2-Level-ZIP-Struktur immer nur `$parts[0]` als Service-Dir, nie Directory+Dateiname kombinieren.

---

## 2026-02-27 â€” Import-Tab eingefroren bei "Dienste werden geladenâ€¦" (JS komplett defekt)
- **Symptom**: ags-import.html lÃ¤dt, Import-Tab zeigt dauerhaft "Dienste werden geladenâ€¦", keine Reaktion â€” als ob JS gar nicht lÃ¤uft.
- **Root-Cause**: Beim EinfÃ¼gen des Refresh-Button-Handlers (Staging-Case) wurde nur der Handler-Body eingefÃ¼gt, nicht die Ã¶ffnende `addEventListener`-Zeile â€” `});` stand orphaned auf Modulebene â†’ JS-SyntaxError â†’ komplettes Skript defekt.
- **Fix**: `document.getElementById('ags-btn-refresh').addEventListener('click', function() {` vor der ersten Handler-Zeile ergÃ¤nzt.
- **Guardrail**: Nach jedem Multi-Replace sofort im Browser verifizieren; `});` auf 0-Ebene ohne passendes Ã–ffner ist immer ein SyntaxError, der das gesamte Script bricht.

---

## 2026-05-xx â€” Editor-Textarea unsichtbar (kein Highlighting, Caret fehlt)
- **Symptom**: Editor Ã¶ffnet sich, Textarea bleibt leer/unsichtbar, kein Cursor sichtbar.
- **Root-Cause**: CSS-Overlay-Ansatz erfordert `color:transparent; caret-color:#d4d4d4` auf der Textarea â€” fehlte nach Redesign.
- **Fix**: `.fe-editor-wrapper { position:relative }`, Textarea + `<pre>` mit `position:absolute; inset:0`; Textarea `color:transparent`, `<pre>` als Highlight-Overlay darunter (pointer-events:none).
- **Guardrail**: Bei Overlay-Editor immer prÃ¼fen ob `caret-color` gesetzt ist, sonst ist Cursor unsichtbar.

## 2026-05-xx â€” `switchEditorTab()` deprecated nach Overlay-Redesign
- **Symptom**: Tabs-Button-Handler warf Fehler weil `#file-editor-tabs` nicht mehr im DOM war.
- **Root-Cause**: Tabs wurden entfernt, aber Event-Handler auf `.fe-tab`-Buttons noch vorhanden.
- **Fix**: `switchEditorTab()` zu leerem Stub gemacht, Tabs-Event-Handler entfernt, Scroll-Sync-Handler stattdessen hinzugefÃ¼gt.
- **Guardrail**: Nach DOM-Umstrukturierung immer alle Event-Handler auf entfernte Elemente suchen und entfernen.

## 2026-02-27 â€” Datei-Editor-Modal im AGS-Modal muss in `.tb-ags-dialog` liegen

- **Symptom**: Editor-Overlay `position:fixed` auf Body-Ebene wÃ¼rde durch den Dojo z-index-Stack vom AGS-Modal Ã¼berdeckt, wenn das AGS-Modal seinerseits in einem Dojo-FloatingPane sitzt.
- **Root-Cause**: fixe z-index-Hierarchie â€” AGS-Modal hat eigenen Stacking-Context.
- **Fix**: Editor-Overlay `position:absolute; inset:0` innerhalb von `.tb-ags-dialog` (relativem Container), damit es den Modal-Dialog Ã¼berlagert ohne Dojo-Stack zu brechen. Standalone-Seite nutzt weiterhin `position:fixed` auf Body.
- **Guardrail**: Neue modals in tree-builder.html â†’ `position:absolute` verschachteln, nicht `position:fixed` auf Body-Ebene.

---

## 2026-02-27 â€” AGS-Modal/Seite hatten inkonsistente Multi-Workflows

- **Symptom**: Import war global blockiert (kein paralleler Start), Shift-Range fehlte, Verwalten war zwischen eigenstÃ¤ndiger Seite und Tree-Builder-Modal funktional uneinheitlich (Backup-Filter/-Delete fehlte teilweise).
- **Root-Cause**: Historisch getrennte UI-Implementierungen mit unterschiedlichen Feature-StÃ¤nden; harte globale Export-Sperre per Flag.
- **Fix**: Beide UIs auf denselben Umfang gebracht: Shift-Range bei Checkboxen (Import + Verwalten), Backup-Filter (Aktive/Alle/Nur Backups), Bulk-Action `ags-delete-backups` fÃ¼r ausgewÃ¤hlte Services; Import-Flow auf parallele Requests mit laufender Count-Anzeige umgestellt.
- **Guardrail**: AGS-Ã„nderungen immer in `ags-import.html` **und** Tree-Builder-AGS-Modal spiegeln und OpenAPI-Action-Enums/Query-Parameter synchron mitziehen.

---

## 2026-02-27 â€” raw-conf Pfad war zwischen Backend, UI und Doku inkonsistent

- **Symptom**: Export-/Manage-Meldungen zeigten `data/tmp/raw-conf`, wÃ¤hrend Projektvorgaben und andere Teile bereits `/data/Client_Data/nwow/raw-conf` verwendeten.
- **Root-Cause**: Historisch gewachsene Ã„nderungen fÃ¼hrten zu gemischten Pfaden in API-Konstante, UI-Texten und Lessons-Learned-EintrÃ¤gen.
- **Fix**: `RAW_CONF_DIR` in der API und die AGS-Statusmeldungen im UI auf `/data/Client_Data/nwow/tmp/raw-conf` vereinheitlicht; widersprÃ¼chliche Lessons-Learned-Stelle angepasst.
- **Guardrail**: Betriebsrelevante Pfade nur zentral Ã¼ber Konstanten fÃ¼hren und bei PfadÃ¤nderungen Backend, UI-Texte und Doku in einem Schritt synchronisieren.

---

## 2026-02-26 â€” FloatingPane blockiert Layer-Laden

- **Symptom**: Keine Layer geladen, ganzer `require`-Callback wird nie aufgerufen.
- **Root-Cause**: `"dojox/layout/FloatingPane"` im Haupt-`require([])`-Array. Wenn das Modul fehlt/spÃ¤t kommt, blockiert es den gesamten Callback.
- **Fix**: Aus dem Haupt-Array entfernt, in nested `require(['dojox/layout/FloatingPane'], fn)` verlagert.
- **Guardrail**: FloatingPane + Ã¤hnliche optionale Module **nie** in den Haupt-`require`-Array.

---

## 2026-02-26 â€” Info-Query feuert nicht auf Mobile

- **Symptom**: Klick auf Karte zeigt kein Info-Fenster.
- **Root-Cause**: `picking`-Flag auf Mobile nie gesetzt. Desktop setzt es via Toolbar-Button, Mobile hat keinen.
- **Fix**: `picking = true` im `tnet-app-ready` Listener auf allen Maps setzen.
- **Guardrail**: Bei Info-Debugging immer zuerst prÃ¼fen: `njs.AppManager.Maps[id].picking === true`?

---

## 2026-02-26 â€” Info-Ergebnisse rendern nicht

- **Symptom**: Info-Pane Ã¶ffnet sich, aber Tabelle bleibt leer.
- **Root-Cause**: `dojox/layout/TableContainer` fehlt im `require`-Array.
- **Fix**: `"dojox/layout/TableContainer"` zum `require`-Array hinzugefÃ¼gt.
- **Guardrail**: Wenn Dojo-Widgets fehlen â†’ im Netzwerk-Tab nach 404 suchen.

---

## 2026-02-26 â€” URL-Layer gehen bei Reload verloren

- **Symptom**: `?layers=xyz` Parameter wird bei Seitenreload ignoriert.
- **Root-Cause**: Framework hat ADDâ†’REMOVEâ†’ADD Race Condition; Layer werden kurz nach dem Setzen wieder entfernt.
- **Fix**: `ensureUrlLayers()` mit 3 Retry-Zeitpunkten (500ms, 1500ms, 3000ms) nach `tnet-app-ready`.
- **Guardrail**: Layer-State immer asynchron mit Retries wiederherstellen, nie nur einmal bei init.

---

## 2026-02-26 â€” Dojo-Titelbar: display:none bricht Layout

- **Symptom**: Content-Bereich springt nach oben, Ã¼berdeckt Titelbar.
- **Root-Cause**: Dojo berechnet `contentInfo.style.top = titleBar.offsetHeight + 'px'`. Mit `display:none` â†’ `offsetHeight = 0`.
- **Fix**: Titelbar-Kinder leeren und eigenen Inhalt (Span + Buttons) direkt im Dojo-`.dojoxFloatingPaneTitle` einfÃ¼gen.
- **Guardrail**: Dojo-Layout-Container NIE mit `display:none` verstecken. Stattdessen: Inhalt ersetzen.

---

## 2026-02-26 â€” TitleText ist ein Input, nicht ein Span

- **Symptom**: Weisse Box / Input-Styling in der Titelbar statt sauberem Text.
- **Root-Cause**: `.dojoxFloatingPaneTitleText` ist ein `<input type="text">`. Dojo setzt Inline-Styles (`background-image`, `border`, `-webkit-appearance`), die nicht per CSS Ã¼berschreibbar sind.
- **Fix**: Alle Dojo-Kinder des Titelbars per JS entfernen, eigenes `<span>` mit Titel-Text einfÃ¼gen.
- **Guardrail**: Dojo-TitleText NIE per CSS stylen â†’ immer per JS ersetzen.

---

## 2026-02-26 â€” dijit.get('title') liefert HTML

- **Symptom**: Titelbar zeigt `<table border='0' cellpadding='0'...` statt "Objektinformation".
- **Root-Cause**: Dojo setzt `widget.title` auf den HTML-Inhalt der Ergebnistabelle. `dijit.get('title')` gibt diesen HTML-String zurÃ¼ck.
- **Fix**: Immer Fallback-String `'Objektinformation'` verwenden. Input-Value nur nehmen wenn kein `<`-Zeichen enthalten.
- **Guardrail**: `dijit.get('title')` auf FloatingPane â†’ **verboten**. Immer eigenen Titel-String setzen.

---

## 2026-02-26 â€” CSS auf Mobile braucht !important

- **Symptom**: CSS-Regeln greifen nicht, Dojo-Styling bleibt.
- **Root-Cause**: Dojo setzt Inline-Styles direkt auf DOM-Elemente. Externe CSS-Regeln haben niedrigere SpezifitÃ¤t.
- **Fix**: Alle Mobile-CSS-Regeln mit `!important`.
- **Guardrail**: Auf Mobile **immer** `!important` bei CSS-Overrides verwenden.

---

## 2026-02-26 â€” Mobile-Themenbaum bleibt leer

- **Symptom**: Im Mobile-Bottom-Sheet wird kein Layerbaum angezeigt.
- **Root-Cause**: Legacy-Container wurde ausgeblendet, aber der neue Layer-Manager lieferte keinen gerenderten Katalog (Lade-/Init-Fehler) und es gab keinen Fallback.
- **Fix**: In `tnet-lm-init.js` einen robusten Fallback ergÃ¤nzt: bei Timeout/leerem Katalog wird `lm-tree-container` entfernt und der Legacy-Baum automatisch wieder eingeblendet.
- **Guardrail**: Neue UI erst dann exklusiv machen, wenn ein erfolgreicher Render bestÃ¤tigt ist; sonst immer automatisch auf Legacy zurÃ¼ckfallen.

---

## 2026-02-26 â€” tnet-app-ready wird nie gefeuert â†’ Layer-Manager hÃ¤ngt

- **Symptom**: Layer-Manager zeigt weder Baum noch Suchfeld. Konsole zeigt nur `[LM-Init] Warte auf tnet-app-ready...` â€” kein Bootstrap.
- **Root-Cause**: Der `earlyCheckAppReady`-Poller in `index_de_m.htm` gibt nach 8s Splash-Timeout auf (`return` ohne Event-Dispatch), wenn die Map noch nicht bereit ist. Das `tnet-app-ready` Event wird dann **nie** gefeuert, obwohl die Map Sekunden spÃ¤ter verfÃ¼gbar ist.
- **Fix**: Doppelte Absicherung: 1) `index_de_m.htm` pollt nach Splash-Timeout weiter (alle 500ms, max 30s) und feuert Event nachtrÃ¤glich. 2) `tnet-lm-init.js` hat eigenes Polling als Fallback, prÃ¼ft direkt `njs.AppManager.Maps['main']`.
- **Guardrail**: Nie auf ein einzelnes Event ohne Fallback warten. Bei Event-AbhÃ¤ngigkeiten immer Polling-Fallback einbauen, der den Zustand direkt prÃ¼ft.

---

## 2025-07-17 â€” Neue API-Endpoints in Swagger-Docs nicht sichtbar

- **Symptom**: Neue Endpoints (ags-services, ags-export, ags-list-raw, ags-delete-raw, ags-read-raw) im PHP-Backend funktionieren, aber Swagger-UI unter `/maps/tnet/api/docs/` zeigt sie nicht.
- **Root-Cause**: `openapi.yaml` wurde nicht aktualisiert â€” enthielt nur die ursprÃ¼nglichen 8 Pfade.
- **Fix**: Neue Tags (Tree-Builder, AGS Import) und Pfade (`/v1/treebuilder-api.php`, `/v1/treebuilder-api.php/ags`) samt Schemas in `openapi.yaml` ergÃ¤nzt, hochgeladen.
- **Guardrail**: Bei neuen API-Endpoints immer auch `openapi.yaml` aktualisieren und mit deployen.

---

## 2026-02-26 â€” AGS Import als eigenstÃ¤ndige Seite mit Multi-Delete

- **Symptom**: AGS-Import nur als Modal innerhalb des Tree-Builders verfÃ¼gbar, Verwalten-Tab hat nur Einzel-LÃ¶schen (kein Multi-Select).
- **Root-Cause**: Feature war als schnelle ErgÃ¤nzung ins Tree-Builder-Modal gebaut, Multi-Delete fehlte.
- **Fix**: Neue eigenstÃ¤ndige Seite `ags-import.html` erstellt mit Import-Tab (Checkboxen, Multi-Export) und Verwalten-Tab (Checkboxen auf Service-Ebene, Alle/Keine, Multi-Delete mit BestÃ¤tigungs-Dialog). Gleiche API-Endpoints, kein Backend-Change nÃ¶tig.
- **Guardrail**: Multi-Delete sequenziell Ã¼ber bestehende Single-Delete-API abwickeln (Promise-Kette), statt neuen Batch-Endpoint zu bauen â€” vermeidet Backend-KomplexitÃ¤t.

---

## 2026-02-26 â€” AGS Export meldet Erfolg aber Dateien fehlen

- **Symptom**: Export zeigt "âœ“ Export erfolgreich! 12 Dateien in data/raw-conf/ gespeichert", aber Verwalten-Tab ist leer.
- **Root-Cause**: Verzeichnis `/data/Client_Data/nwow/raw-conf` gehÃ¶rt User `trigonet` (Perms `0775`), PHP lÃ¤uft als `www-data`. `file_put_contents` scheitert lautlos mit "Permission denied", aber der Code prÃ¼ft den RÃ¼ckgabewert nicht und meldet trotzdem Erfolg.
- **Fix**: (1) Permissions via SFTP auf `0777` gesetzt (wie `/data/tmp` es bereits hat). (2) PHP-Export: Schreibtest vor Beginn (`is_writable`), `file_put_contents`-RÃ¼ckgabewert prÃ¼fen, fehlgeschlagene Dateien separat melden. (3) Frontend: Unterscheidet jetzt âœ“ Erfolg / âš  Teilweise / âœ— Fehlgeschlagen.
- **Guardrail**: SFTP-Pfade ausserhalb von DocumentRoot immer `0777` setzen, da PHP als `www-data` lÃ¤uft. Bei `file_put_contents` immer `=== false` prÃ¼fen.

---

## 2026-02-26 â€” Service-Gruppierung und Delete bei flacher Dateistruktur

- **Symptom**: Verwalten-Tab zeigt jede Datei als eigenen "Service", Delete schlÃ¤gt fehl mit "Service-Verzeichnis nicht gefunden".
- **Root-Cause**: ZIP-Export der externen API speichert Dateien flach (ohne Unterverzeichnisse). Die Listing-Logik nutzte den Ordnerpfad als Service-Key, die Delete-Logik erwartete ein Verzeichnis.
- **Fix**: `extractServiceFromFilename()` extrahiert den Service-Namen aus Dateinamens-Pattern (`layers_TNET_<SVC>.conf`, etc.). Delete-Funktion unterstÃ¼tzt jetzt sowohl Verzeichnis- als auch flache Dateien.
- **Guardrail**: Bei Service-Gruppierung nicht auf Verzeichnisstruktur verlassen â€” immer auch Dateinamen-basierte Gruppierung unterstÃ¼tzen.

---

## 2026-02-26 â€” file_get_contents schlÃ¤gt fÃ¼r Server-zu-Server-Aufrufe fehl

- **Symptom**: `file_get_contents(https://www.gis-daten.ch/gapi/...): Failed to open stream: HTTP request failed!`
- **Root-Cause**: `file_get_contents` liefert bei HTTP-Fehler-Statuscodes (4xx/5xx) nur `false` ohne Details. Zudem kann es bei Self-Referencing (Server ruft sich selbst auf) zu Problemen kommen.
- **Fix**: Auf `curl_exec()` umgestellt mit `CURLOPT_RETURNTRANSFER`, HTTP-Status-Code-PrÃ¼fung und Error-String-Extraktion via `curl_error()`. Beide AGS-Endpunkte (`getAgsServices`, `exportAgsServices`) verwenden jetzt cURL.
- **Guardrail**: FÃ¼r externe HTTP-Aufrufe in PHP immer cURL statt `file_get_contents` verwenden â€” bessere Fehlerinfos, Status-Code-Handling, Timeout-Kontrolle.

---

## 2026-02-26 â€” raw-conf Verzeichnis-Permissions werden periodisch zurÃ¼ckgesetzt

- **Symptom**: SFTP `chmod 0777` auf `/data/raw-conf` wird nach kurzer Zeit auf `0775` zurÃ¼ckgesetzt. PHP (`www-data`) verliert Schreibrechte.
- **Root-Cause**: Serverseitiger Prozess (Backup, Sicherheits-Cron o.Ã¤.) setzt Verzeichnis-Permissions periodisch zurÃ¼ck. Owner bleibt `trigonet`, PHP lÃ¤uft als `www-data` â†’ `0775` reicht nicht.
- **Fix**: (1) Via SFTP Verzeichnis gelÃ¶scht und neu erstellt (temporÃ¤r als 0777). (2) PHP-Code: `getWritableRawConfDir()` mit Fallback-Strategie â€” prÃ¼ft primÃ¤ren Pfad (`/data/Client_Data/nwow/raw-conf`), versucht chmod, fÃ¤llt zurÃ¼ck. Ergebnis wird pro Request gecacht.
- **Guardrail**: Nie von festen Permissions auf Server-Verzeichnissen ausgehen. Immer dynamisch prÃ¼fen (`is_writable`) und Fallback-Pfad bereithalten.

---

## 2026-02-26 â€” raw-conf unter /data/tmp/ statt direkt unter /data/

- **Symptom**: `/data/Client_Data/nwow/raw-conf` (SFTP `/data/raw-conf`) immer gid=1000 (trigonet), Permissions werden periodisch auf 0775 zurÃ¼ckgesetzt. PHP (www-data, uid/gid 33) hat keinen Gruppen-Zugriff. `chown` via SFTP scheitert (nur root darf das).
- **Root-Cause**: `/data/raw-conf` wird von `trigonet` erstellt â†’ Owner+Gruppe = trigonet. `/data/tmp/` hingegen hat gid=33 (www-data) + 0777 â†’ PHP-erstellte Unterverzeichnisse gehÃ¶ren automatisch www-data.
- **Fix**: `RAW_CONF_DIR` auf `/data/Client_Data/nwow/tmp/raw-conf` vereinheitlicht.
- **Guardrail**: Auf Servern mit getrennten Users (SFTP â‰  PHP) immer Verzeichnisse unter einem Pfad anlegen, der bereits der PHP-Gruppe gehÃ¶rt (z.B. `/tmp/` oder ein bestehendes www-data-Verzeichnis). Nie darauf vertrauen, dass chmod/chown via SFTP dauerhaft wirkt.
---

## 2026-02-27 â€” Staging Merge: 0 Dateien gemergt (_TNET_-Filter killt Quelldateien)

- **Symptom**: Merge-Aktion meldet Erfolg, aber `ImportToCore/<kuerzel>/` enthÃ¤lt keine Dateien.
- **Root-Cause**: `stripos($fname, '_TNET_') !== false` sollte bereits-gemergte Outputs Ã¼berspringen, filtert aber ALLE Quelldateien aus, da diese `layers_TNET_ewn_EWN_NIS.conf` heissen (enthalten `_TNET_`). Outputs landen in separatem `ImportToCore/`-Dir â€” werden also nie als Quelle gescannt.
- **Fix**: `_TNET_`-Filter-Zeile komplett entfernt (unnÃ¶tig, da Quelle â‰  Ziel-Verzeichnis). Output-Naming von `prefix_TNET_kuerzel.ext` auf `prefix_kuerzel.ext` geÃ¤ndert (z.B. `layers_ewn.conf`).
- **Guardrail**: Filter in Merge-Logik nie auf Namens-Patterns der Quelldateien matchen â€” immer Verzeichnis-Trennung (raw-conf vs. ImportToCore) als Abgrenzung nutzen.

---

## 2026-06-xx â€” Staging Tab Split: ImportToCore Ausgabe-Panel

- **Symptom**: Nach Merge-Aktion war kein direkter Blick auf die erzeugten ImportToCore-Dateien m\u00f6glich; Nutzer musste SFTP oder separates Tool nutzen.
- **Root-Cause**: Staging-Pane war einspaltig â€” nur Linke Seite (Dienstauswahl) ohne Anzeige der Merge-Ausgabe.
- **Fix**: Split-Layout `.staging-split { display:flex }` mit `.staging-left` (47%) und `.staging-right` (flex:1). Rechts: `loadStagingOutput()` listet ImportToCore-KÃ¼rzel-Dirs + Dateien, Dateien per `openFileEditor(path, 'staging-read-output', 'staging-write-output', cb)` editierbar. `_feReadAction`/`_feWriteAction`/`_feAfterSave` machen den gemeinsamen File-Editor kontextsensitiv (raw-conf UND ImportToCore).
- **Guardrail**: `openFileEditor` immer mit `readAction`/`writeAction`/`afterSave` aufrufen â€” nie hardcoded `ags-read-raw` annehmen wenn der Editor auch f\u00fcr andere Verzeichnisse genutzt wird.

---

## 2026-06-xx  Nach Import: Selektion blieb bestehen, bereits importierte Dienste nicht erkennbar

- **Symptom**: Nach erfolgreichem Export/Import bleiben alle Checkboxen angehakt; re-importierbare Dienste sind nicht von neuen unterscheidbar.
- **Root-Cause**: `exportAgsServices()` rief nur `updateImportSelCount()`  kein Deselektieren, kein visuelles Markieren.
- **Fix**: Nach Export-Erfolg Checkboxen leeren; `_importedServiceNames` befï¿½llen; `refreshImportImportedMarkers()` setzt Klasse `imported` + Badge + Legende. `loadRawConfList` befï¿½llt dieselbe Map.
- **Guardrail**: Nach mutierendem API-Call immer visuellen State synchronisieren  Checkboxen leeren und Markierungen updaten statt nur Zï¿½hler refreshen.

---

## 2026-02-28 â€” Legend-Proxy: ArcGIS `size`-Parameter liefert proportional skalierte Symbole

- **Symptom**: Bei `size=80,160` liefert ArcGIS nicht exakt 80Ã—160, sondern z.B. 106Ã—213 â€” grÃ¶sser, aber proportional skaliert.
- **Root-Cause**: ArcGIS REST Legend-Endpoint interpretiert `size` als ZielgrÃ¶sse, skaliert aber proportional zum Originalsymbol. Kein exaktes Clipping.
- **Fix**: CSS `width`/`height` auf `<img>` erzwingt exakte AnzeigegrÃ¶sse; ArcGIS liefert dennoch hÃ¶here AuflÃ¶sung â†’ bessere Darstellung.
- **Guardrail**: Nie `size`-Parameter allein fÃ¼r exakte PixelgrÃ¶ssen verlassen â€” immer zusÃ¤tzlich CSS/HTML `width`/`height` setzen.

---

## 2025-07-13 â€” Tree-Builder Staging Redesign: renderTree() per-LyrMgr-Closure

- **Symptom**: Beim Umstellen von Tab-basiertem Rendering (ein LyrMgr gleichzeitig) auf unified Tree (alle LyrMgrs als Root-Knoten) referenzierten D&D-Handler die falsche `profile`-Variable â†’ Drops landeten im falschen LyrMgr.
- **Root-Cause**: `renderTree()` hatte eine einzige `var profile = getActiveTree()` am Anfang. Bei mehreren LyrMgrs in einem DOM mÃ¼ssten Handler wissen, welcher LyrMgr ihr Ziel ist.
- **Fix**: `renderTree()` iteriert Ã¼ber alle LyrMgr-Keys und ruft `renderLyrmgrBlock(container, lmKey, profile)` pro Eintrag auf. Jeder Aufruf hat eigene DOM-Elemente und eigenen `profile`-Closure. D&D-Daten enthalten `srcLyrmgr` fÃ¼r Cross-LyrMgr-Operationen.
- **Guardrail**: Bei mehreren unabhÃ¤ngigen BÃ¤umen in einem DOM immer per-Subtree-Closure mit eigenem Datenzugriff verwenden â€” nie eine Single-Variable fÃ¼r alle Handler teilen.

---

## 2026-03-02 â€” Sidepane Ã¼berlappt Footer + fixe Accordion-HÃ¶hen

- **Symptom**: Sidepane-Inhalt (`#spring`) ragt Ã¼ber den `#map-footer-bar` (26px) hinaus. Themenkatalog und Dargestellte Themen haben nicht verstellbare HÃ¶hen (fest 450px / 500px).
- **Root-Cause**: `#spring` hatte `max-height: calc(100vh - 79px)` â€” berÃ¼cksichtigte nur Header (69px) und close_switch (10px), nicht den 26px Footer. `#kantons_container` war auf `height: 450px !important` fixiert.
- **Fix**: 1) `max-height` auf `calc(100vh - 105px)` geÃ¤ndert (79px + 26px Footer). 2) Fixe HÃ¶hen durch CSS-Variablen ersetzt (`--tnet-catalog-height`, `--tnet-active-height`). 3) Neues Modul `tnet-accordion-resize.js` mit Drag-Splitter-Handles am unteren Rand der Accordion-Inhalte. HÃ¶hen werden in localStorage gespeichert. 4) Guard `window.__tnetResizing` in `tnet_toc.js` â†’ verhindert dass MutationObserver/aggressiveFix die Resize-Styles Ã¼berschreibt.
- **Guardrail**: Bei `max-height`-Berechnungen auf Sidepanes immer alle fixen UI-Elemente (Header, Footer, Toolbars) abziehen. Vor Inline-Style-Manipulation im Sidepane prÃ¼fen ob der MutationObserver in tnet_toc.js eine Feedback-Schleife auslÃ¶st â€” immer `window.__tnetResizing`-Flag nutzen.

---

## 2026-03-02 â€” Dargestellte Themen: Eye-Toggle + Remove wirkungslos, WMS Remove geht nicht

- **Symptom**: Eye-Toggle (Sichtbarkeit) in "Dargestellte Themen" ohne Effekt. Remove entfernt Eintrag aus Liste, Layer bleibt auf Karte. WMS-Checkbox: HinzufÃ¼gen funktioniert, Entfernen nicht.
- **Root-Cause**: Drei Bugs: (1) `_olLayerRef` wurde nur fÃ¼r WMS-EintrÃ¤ge gespeichert, nicht fÃ¼r regulÃ¤re Layer â€” dadurch kein direkter OL-Zugriff. (2) `_findOLLayer` suchte nur Top-Level-Layer, nicht in OL-LayerGroups. (3) `removeLayer` bei `visible=false` (Auge aus) entfernte Layer nur aus der Liste, nicht von der Karte. (4) WMS-Panel nutzte `njs.AppManager` statt `window.njs.AppManager` â€” in Strict-Mode-IIFE potentiell undefiniert, Fehler wurden stumm verschluckt (`catch(e){}`).
- **Fix**: (1) `_olLayerRef` in `_syncFromMap` und `_onOLLayerAdd` fÃ¼r ALLE Layer setzen. (2) `_findOLLayer` rekursiv gemacht (sucht auch in `layer.getLayers()`). (3) `removeLayer` immer `map.removeLayer(_olLayerRef)` aufrufen, Fallback via `TnetLayerSwitch`. (4) WMS-Panel: `window.njs`/`window.top.njs` mit Fehler-Logging statt stiller Catch.
- **Guardrail**: Bei OL-Layer-Manipulation immer gespeicherte `_olLayerRef` bevorzugen statt Suche via `name`-Attribut. Nie `catch(e){}` ohne Logging verwenden â€” erschwert debugging massiv.

---

## 2026-03-02 â€” Themenkatalog: Level-2-Gruppen (Gemeindegrenzen etc.) lassen sich nicht einklappen

- **Symptom**: Klick auf GruppenÃ¼berschriften (z.B. Gemeindegrenzen, HÃ¶henlinien) im Themenkatalog hat keinen Effekt â€” die Gruppen bleiben immer aufgeklappt. Level-1 (Accordions wie GRUNDLAGEN, Ã–REB) und Level-3 (Einzel-Layer) funktionieren.
- **Root-Cause**: CSS-Counter-Regeln verwendeten `.dijitClosed` als Klassenname. Dojo setzt aber `.dijitTitlePaneClosed` auf dem domNode (Widget-Root) und `.dijitClosed` nur auf dem titleBarNode (Geschwister-Element). Da `.dijitTitlePaneContentOuter` ein Kind des domNodes ist, matchte der Selektor `.dijitTitlePane.dijitClosed > .dijitTitlePaneContentOuter` kein einziges Element â€” die ULTIMATIV-Regeln (`display: block !important`) gewannen immer.
- **Fix**: Alle 7 Selektoren in den Counter-Regeln (tnet_toc.css, Zeilen 346â€“381) von `.dijitClosed` auf `.dijitTitlePaneClosed` geÃ¤ndert.
- **Guardrail**: Bei Dojo dijit.TitlePane immer die korrekte Klasse pro DOM-Ebene verwenden: `dijitTitlePaneClosed`/`dijitTitlePaneOpened` auf dem **domNode**, `dijitClosed`/`dijitOpen` auf dem **titleBarNode**. Mobile-CSS (tnet_override_m.css) als Referenz nutzen â€” dort war es bereits korrekt.

---

## 2026-03-02 â€” Level-2-Gruppen: Klassenname-Fix allein reicht nicht â€” Descendant-Selektoren sind das Problem

- **Symptom**: Trotz korrigiertem Klassennamen (`dijitTitlePaneClosed`) lassen sich Level-2-Gruppen (Gemeindegrenzen, HÃ¶henlinien, etc.) im Themenkatalog weiterhin nicht ein-/ausklappen.
- **Root-Cause**: Die ULTIMATIV/SUPER-ULTIMATIV CSS-Regeln verwendeten **Nachfahren-Selektoren** (Leerzeichen) statt **Kind-Selektoren** (`>`). Dadurch matchten `#kantons_container .dijitTitlePane.active-tab .dijitTitlePaneContentOuter` und `#kantons_container .dijitTitlePane.active-tab .dijitReset` auch Level-2-Elemente tief in der Hierarchie â€” nicht nur die Kantons-Pane selbst. CSS setzte `display: block !important` auf Level-2-ContentOuter/wipeNode und blockierte Dojos Toggle-Animation komplett. ZusÃ¤tzlich feuerte der `globalObserver` (MutationObserver) und der Capture-Phase-Click-Handler `startAggressiveFix()` bei jedem Level-2-Klick.
- **Fix**: (1) ALLE Descendant-Selektoren in ULTIMATIV/SUPER-ULTIMATIV BlÃ¶cken durch Child-Combinators (`>`) ersetzt â€” matchen jetzt nur noch direkte Kinder der Kantons-Pane. (2) Counter-Rules komplett entfernt (unnÃ¶tig, da ULTIMATIV-Regeln Level-2 nicht mehr berÃ¼hren). (3) `globalObserver`: Skip fÃ¼r Mutations innerhalb `.tabs2acc-panel`. (4) Capture-Phase-Click-Handler: Return bei Klick auf TitlePanes innerhalb `.tabs2acc-panel`.
- **Guardrail**: Bei CSS-Regeln fÃ¼r verschachtelte Dojo-Widgets **immer Kind-Selektoren (`>`) verwenden**, nie Nachfahren-Selektoren. Descendant-Selektoren in `#kantons_container` treffen unweigerlich auch tiefer verschachtelte TitlePanes. MutationObserver und aggressive Fix-Routinen mÃ¼ssen Level-2-TitlePanes explizit ausschliessen (`.closest('.tabs2acc-panel')`-Check).

---

## 2026-03-02 â€” WMS GetFeatureInfo fÃ¼r Custom-WMS-Layer

- **Symptom**: Ãœber das WMS-Panel hinzugefÃ¼gte Layer liessen sich nicht per Klick abfragen â€” kein Eintrag im Objektinfo-Panel.
- **Root-Cause**: Das Framework nutzt `wmsActiveLyrs` (ol.Collection registrierter MapTip-Instanzen) fÃ¼r GetFeatureInfo. Custom-WMS-Layer werden dort nie eingetragen, da sie keine Maptip-Config haben.
- **Fix**: In `tnet-wms-panel.js` eigenen `singleclick`-Handler auf die Hauptkarte registriert. Iteriert `_addedLayers`, ruft `source.getFeatureInfoUrl()` pro sichtbarem WMS-Layer auf (Format-Fallback: JSONâ†’GMLâ†’HTMLâ†’text/plain), nutzt `wmsproxy.php` als CORS-Proxy und injiziert Ergebnisse als `dijit.TitlePane` in `njs_info_pane_content`. Proxy (`wmsproxy.php`) auf `GetFeatureInfo` erweitert.
- **Guardrail**: `wmsproxy.php` nur `GetCapabilities` + `GetFeatureInfo` erlauben â€” nie `GetMap` (Missbrauchsrisiko). GFI-Ergebnisse mit 300ms Delay einfÃ¼gen, damit Framework-Clearing abgeschlossen ist.

---

## 2026-03-04 â€” Console-Spam trotz logLevel:'none' + Footer-Massstab fehlt

- **Symptom**: 238+ console.log-Meldungen trotz `logLevel: 'none'` in Config. Massstab 1:50 fehlt in Footer-Dropdown.
- **Root-Cause**: (1) Kein Modul prÃ¼fte den logLevel â€” alle nutzten direkt `console.log/warn/error`. (2) Footer-JSON5-Parser war zu simpel: Regex `//.*$` zerstÃ¶rte URLs mit `://`, unquoted Keys wurden nicht gequoted. (3) Config lag an zwei Server-Pfaden mit unterschiedlichem Inhalt.
- **Fix**: (1) Neues `tnet-log.js` als zentrale Logging-Utility: liest `logLevel` synchron aus Config, gated alle Ausgaben. (2) 341 `console.*`-Aufrufe in 17 Modulen durch `TnetLog.*` ersetzt. (3) Footer-JSON5-Parser durch string-aware Variante ersetzt (wie in tnet-print.js). (4) Config-Pfad auf `/maps/tnet/config/` vereinheitlicht, alte Kopie gelÃ¶scht.
- **Guardrail**: Neue Module mÃ¼ssen `TnetLog.*` statt `console.*` verwenden. JSON5-Parsing immer string-aware (Zeichen innerhalb Strings nie als Kommentar-Start interpretieren).

---

## 2026-03-04 â€” Sidebar-Close: Handle verschwindet / Spalt bleibt

- **Symptom**: Nach dem Zusammenklappen blieb ein Spalt unter dem Header sichtbar; in einem Folgefix verschwand der Close-Handle komplett und das Panel liess sich nicht mehr aufklappen.
- **Root-Cause**: `#spring` wurde mit `height:0` und `overflow:hidden` kollabiert, wodurch der Handle (als Kind von `#spring`) mit weggeclippt wurde. Gleichzeitig wurden ResthÃ¶hen von Child-Elementen nicht konsistent neutralisiert.
- **Fix**: Im Close-Zustand werden alle `#spring`-Kinder ausser `.close_switch` auf `max-height:0`/`opacity:0` gesetzt; `#spring` bleibt auf Handle-HÃ¶he (`10px`) mit `overflow:visible`; `.close_switch` bleibt relativ und klickbar.
- **Guardrail**: Bei Collapse-Layouts nie den einzigen Reopen-Trigger in einem `overflow:hidden`-Container clippen. Reopen-Element explizit sichtbar/klickbar halten und nur Nicht-Trigger-Inhalt kollabieren.

---

## 2026-03-04 â€” Sidebar-Close: Handle nicht bÃ¼ndig am Header

- **Symptom**: Nach dem Zusammenklappen blieb der Handle sichtbar, lag aber mit Abstand unterhalb des Headers statt bÃ¼ndig anzuliegen.
- **Root-Cause**: ResthÃ¶hen/Min-Heights kollabierter `#spring`-Kinder beeinflussten den normalen Flow und drÃ¼ckten den Handle nach unten.
- **Fix**: Close-Regeln fÃ¼r `#spring > *:not(.close_switch)` um `height:0` und `min-height:0` ergÃ¤nzt; Handle im Close-Zustand absolut auf `top:0` innerhalb von `#spring` verankert; `#spring` bleibt `position:relative`.
- **Guardrail**: Bei Collapse-UI mit Trigger innerhalb des Containers Trigger-Position entkoppeln (absolute Verankerung) und bei Geschwister-Elementen immer auch `height/min-height` explizit nullen.

---

## 2025-07-09 â€” Tree-Builder: replace_string_in_file scheitert leise an grossen HTML-Dateien

- **Symptom**: `replace_string_in_file` meldet "successfully edited" aber die Datei bleibt unverÃ¤ndert (tree-builder.html, ~300 KB).
- **Root-Cause**: Grosse inlined HTML-Dateien mit JavaScript-BlÃ¶cken werden vom Edit-Tool manchmal nicht korrekt geschrieben, obwohl Matches gefunden werden.
- **Fix**: FÃ¼r grosse Dateien (>100 KB) ein Python-Patch-Skript erstellen, das `str.replace()` auf den gelesenen Inhalt anwendet und die Datei direkt schreibt.
- **Guardrail**: Bei tree-builder.html und Ã¤hnlich grossen HTML-Dateien immer via Python-Skript patchen. Nach jedem Edit per Terminal verifizieren (`Select-String` oder Python-Check).

## 2025-07-09 â€” Tree-Builder: Config-Datei Tooltip + Rechtsklick

- **Symptom**: Im Tree-Builder war nicht erkennbar, aus welcher Server-Datei ein Layer stammt (nur Dateiname, kein voller Pfad).
- **Root-Cause**: `listAllLayers()` in treebuilder-api.php speicherte nur `basename($f)` als `sourceFile`, nicht den vollen Pfad.
- **Fix**: PHP: `sourceFilePath` (dir + filename) pro Layer hinzugefÃ¼gt. JS: Gruppen-Header-Tooltip zeigt alle Config-Pfade; Source-Badge-Tooltip zeigt vollen Pfad; Rechtsklick auf Badge/Header Ã¶ffnet Config im bestehenden Modal via neuem `read-config-file` API-Endpoint.
- **Guardrail**: Bei API-Erweiterungen die `openCtxMenu()`-Infrastruktur wiederverwenden statt eigene KontextmenÃ¼s zu bauen.

## 2026-04-01 â€” Tree-Builder Publish ohne Git-Commit

- **Symptom**: `publishLyrmgr()` im Tree-Builder schrieb die lyrmgr.conf via SFTP, aber es wurde kein Git-Commit erstellt. Die Ã„nderung war nicht versioniert.
- **Root-Cause**: `publishLyrmgr()` rief nur `/publish-lyrmgr-full` auf. Der Git-Commit-Schritt (POST `/git-commit-conf`) fehlte, obwohl er im Deployed-Tab (ags-import.html) bereits implementiert war.
- **Fix**: Non-blocking `fetch(GAPI_URL + '/git-commit-conf', ...)` nach erfolgreichem Publish eingefÃ¼gt. Parameter: `deployPath` aus Response, `source: 'tree-builder'`, Message mit Profilname und Blockanzahl. Bei Erfolg wird die Alert-Box auf â€žGit âœ“" aktualisiert.
- **Guardrail**: Bei jeder SFTP-Schreiboperation auf Config-Dateien prÃ¼fen, ob ein anschliessender Git-Commit nÃ¶tig ist. Muster: non-blocking POST, catch ignoriert Fehler.

## 2026-03-04 â€” Neuer LM-Tree: Gruppen-/Subcategory-Namen zeigen Rohpfade statt Labels

- **Symptom**: Im neuen Desktop-Layermanager werden Gruppen als "Gis Basis/nw Basisplan Gis Dynamisch/gemeindegrenzen" und Subcategories als "Grundlagen" (ucfirst) statt NLS-Label "GRUNDLAGEN" angezeigt.
- **Root-Cause**: Die API (`layers.php`) im DB-Pfad setzt `name = catalog_node.display_name` ohne Bereinigung â€” die DB speichert den vollen Service-Pfad. Im File-Pfad wird fÃ¼r Subcategory-Namen nur `ucfirst($categoryId)` statt NLS-Lookup genutzt. Das Frontend hat keinen Fallback fÃ¼r Pfad-basierte Namen.
- **Fix**: (1) PHP: `getNlsLabel()` Funktion hinzugefÃ¼gt (liest `lyrmgrResources.json`, gecacht). DB-Pfad: Gruppen/Subcategories bekommen NLS-Lookup, Fallback `extractLayerName()` (letztes Pfad-Segment). File-Pfad: Subcategory-Name per NLS auflÃ¶sen. (2) JS: `_cleanPathName()` und `_cleanLayerNames()` in Store-Normalisierung â€” Pfade bereinigen, `displayName` Ã¼ber `name` bevorzugen.
- **Guardrail**: Bei Gruppen-/Kategorie-Namen aus der DB immer NLS-Lookup zuerst, dann Pfad-Bereinigung (letztes Segment). Nie den rohen `display_name` aus der DB unbereinigt durchreichen. Frontend-Fallback (`_cleanPathName`) als Sicherheitsnetz beibehalten.

## 2026-03-04 â€” Bundesthemen (ch.*) kÃ¶nnen nicht ein-/ausgeschaltet werden

- **Symptom**: Klick auf Bundesthemen-Layer (ch.ensi.*, ch.kantone.*) schaltet zuerst AUS statt EIN. Nach erfolgreichem Einschalten zeigt `toggleLayerEye` "OL-Layer nicht gefunden" (`_olLayerRef:false`).
- **Root-Cause**: Drei Bugs in `tnet-lm-store.js`: (1) `_onOLLayerAdd` setzt `_olLayerRef` nur wenn `!storeLayer.visible` â€” aber `setLayerVisible()` setzt `visible=true` bevor der async OL-Layer-Add passiert. (2) `_initLayerDefaults` Ã¼bernimmt `visible: true` aus API-Daten als Ist-Zustand. (3) **Hauptursache**: `_watchMapChanges` unterdrÃ¼ckt `_onOLLayerAdd` **komplett** wenn `_suppressMapSync=true` â€” aber `setLayerVisible` setzt genau dieses Flag bevor `TnetLayerSwitch` den Layer lÃ¤dt. Dadurch wird `_olLayerRef` fÃ¼r ALLE via `toggleLayer` aktivierten Layer nie gesetzt.
- **Fix**: (1) `_onOLLayerAdd`: `_olLayerRef` immer setzen, unabhÃ¤ngig vom `visible`-Status. (2) `_initLayerDefaults`: `l.visible = false` bedingungslos. (3) **Kern-Fix**: In `_watchMapChanges` den `add`-Handler aufgeteilt â€” `_olLayerRef` wird VOR dem `_suppressMapSync`-Check zugewiesen (auf storeLayer UND activeEntry). Nur State-Changes/Events werden unterdrÃ¼ckt.
- **Guardrail**: `_suppressMapSync` darf nie die Zuweisung von OL-Layer-Referenzen blockieren. Referenz-Updates (`_olLayerRef`) gehÃ¶ren VOR den Suppress-Check. Nur State-/Event-Propagation darf unterdrÃ¼ckt werden.

---

## 2026-06-12 â€” SLM Backup-Liste mit ungewollten State-EintrÃ¤gen und zu spÃ¤ter Bereinigung

- **Symptom:** In der Backup-Verwaltung erschienen `state_*`-Backups, obwohl sie operativ nicht benÃ¶tigt werden; die Bereinigung startete erst beim Ã–ffnen des Backup-Dialogs.
- **Root-Cause:** `list-backups` lieferte State-Dateien standardmÃ¤ssig mit, und `cleanupBackups()` lief nur indirekt bei bestimmten Aktionen statt beim Ã–ffnen von SLM.
- **Fix:** `list-backups` liefert standardmÃ¤ssig nur noch manuelle Backups (`lyrmgr_manual_*` + `bookmarks_*`), periodische/technische State-Dateien und andere technische Backups nur optional per Query-Flag; neue API-Aktion `cleanup-backups` triggert die Bereinigung explizit, und `slm.html`/`tree-builder.html` rufen diese Aktion direkt beim Laden auf; zusÃ¤tzlich whitelistet das Frontend defensiv auf `lyrmgr_manual`/`state_manual` + `bookmarks` (Legacy-kompatibel). Manuelle LyrMgr-Backups enthalten jetzt das Profil im Dateinamen (`lyrmgr_manual_<profile>_YYYYMMDD_HHMMSS_<user>.json`).
- **Guardrail:** Nicht-fachliche Editor-Snapshots (State) in Admin-Listen standardmÃ¤ssig ausblenden und Cleanup-Tasks am Einstiegspunkt starten, nicht erst in nachgelagerten Dialogen.

---

## 2026-06-12 â€” Tree-Builder zeigt nach Reload falsche Round-Trip-Ã„nderungen

- **Symptom:** Nach Reload und ohne inhaltliche Ã„nderungen meldete â€žLyrmgr publizieren?â€œ viele Unterschiede wie â€žKey-Reihenfolge geÃ¤ndertâ€œ.
- **Root-Cause:** `findBlockDifferences()` bewertete reine Objekt-Key-Reihenfolgen als Ã„nderung; diese Reihenfolge kann sich durch JSONB/Serialisierung Ã¤ndern, ohne fachliche Differenz.
- **Fix:** Key-Order-Vergleich im Objekt-Zweig entfernt; Vergleich prÃ¼ft nur noch fehlende/zusÃ¤tzliche Keys und Werte.
- **Guardrail:** Round-Trip-Vergleiche fÃ¼r Konfigobjekte mÃ¼ssen semantisch sein; reine Key-Reihenfolge bei Objekten nie als fachliche Ã„nderung zÃ¤hlen.

---

## 2026-06-12 â€” WMS-Layer nach Ghost-Fix nicht mehr sichtbar

- **Symptom:** WMS-Layer wurden auf DEV nicht mehr dargestellt, obwohl Checkbox aktiv war.
- **Root-Cause:** `_sweepThematicLayersOffMap` setzte `_suppressMapSync = true` und resetzte es erst nach 200ms. In diesem Fenster wurden alle `_onOLLayerAdd`-Events geblockt â†’ neue Aktivierungen wurden nicht im Store registriert.
- **Fix:** `_suppressMapSync` aus dem Sweep entfernt. Ghost-Layer sind nicht im Store getrackt, daher sind deren Remove-Events harmlos.
- **Guardrail:** `_suppressMapSync` nie mit `setTimeout`-Reset setzen, wenn danach sofort neue Layer-Aktivierungen zu erwarten sind.

---

## 2026-06-12 â€” â€žValidieren"-Aktion im LyrMgr-Editor fehlte in Actions-Bar

- **Symptom:** Der frÃ¼here Button â€žâœ“ Validierenâ€œ war im LyrMgr-Editor nicht mehr sichtbar.
- **Root-Cause:** Beim Redesign der Actions-Bar wurde der `lyrmgr-verify`-Button nicht mehr gerendert, obwohl die Validierungslogik (`verifyLyrmgr`) weiterhin vorhanden war.
- **Fix:** Action-Button `data-action="lyrmgr-verify"` in der File-Config-Sektion der Tree-Builder-Actions-Bar wieder eingefÃ¼gt (DEV und PROD-Datei).
- **Guardrail:** Bei UI-Refactors bestehende Aktionen gegen die vorhandenen Handler (`data-action` Mapping) prÃ¼fen, damit keine Funktion nur optisch â€žverschwindetâ€œ.

---

## 2026-03-04 â€” PHP OPcache blockiert Datei-Updates auf Server (Deploy fehlschlÃ¤gt)

- **Symptom**: Nach SFTP-Upload von LayerImporter.php zeigt der Server identischen Fehler mit identischen Zeilennummern, trotz korrekter Datei auf Disk und `opcache_reset()`.
- **Root-Cause**: Nicht PHP OPcache â€” ein **HTTP-Response-Cache** (Reverse-Proxy/CDN vor www.gis-daten.ch) cached JSON-Antworten. Gleiche URL â†’ gleiche gecachte Antwort. `opcache_invalidate()` und `opcache_reset()` wirkungslos weil das Problem vor PHP liegt. Beweis: Reflection-Endpoint (neue URL) zeigt korrekten Code, aber `?action=test-catalog` (gecachte URL) zeigt alten Fehler. Zeilennummern-Differenz (910 vs 913) = exakt die 3 eingefÃ¼gten Zeilen.
- **Fix**: Cache-Busting-Parameter `&_bust=<timestamp>` an die URL anhÃ¤ngen â†’ frische Antwort, Import erfolgreich (10.302 Knoten, 0 Fehler).
- **Guardrail**: Bei API-Tests auf dem Server **immer** einen Cache-Busting-Parameter `&_bust=<stamp>` anhÃ¤ngen. Nie davon ausgehen, dass JSON-Antworten nicht gecacht werden. Wenn identischer Fehler trotz Code-Ã„nderung: Response-Cache prÃ¼fen, nicht nur OPcache.

---

## 2026-03-04 â€” LayerImporter.extractServiceBaseUrl() crasht bei NULL-URLs

- **Symptom**: `TypeError: Argument #1 ($url) must be of type string, null given` in `extractServiceBaseUrl()` wÃ¤hrend Catalog-Import.
- **Root-Cause**: `layer_definition.url` kann NULL sein in der DB (z.B. bei Gruppen ohne eigene URL). `FETCH_KEY_PAIR` liefert `[layer_id => null]`. Der foreach-Loop rief `extractServiceBaseUrl($url)` ohne Null-Check auf, und die Methode hatte `string $url` (non-nullable).
- **Fix**: (1) Methodensignatur auf `?string $url` geÃ¤ndert mit early-return bei null. (2) Null-Check vor dem Aufruf: `if ($url === null || $url === '') return $result;`. (3) Gesamter Coalesce-Block in `try/catch (\Throwable)` gewrappt.
- **Guardrail**: DB-Felder die NULL sein kÃ¶nnen: immer nullable Type-Hints verwenden und Null-Checks VOR dem Funktionsaufruf einbauen. `FETCH_KEY_PAIR` kann NULL-Values liefern.

## 2026-03-04 â€” Neuer Themenkatalog: Layer-Toggle wirkungslos (keine Layer auf Karte)

- **Symptom**: Klick auf Layer-Checkbox im neuen Themenkatalog â†’ kein Layer wird auf der Karte dargestellt. `toggleLayer` meldet "Layer nicht gefunden oder ist Gruppe".
- **Root-Cause**: In der lyrmgr.conf haben Gruppen-Wrapper hÃ¤ufig die **exakt gleiche ID** wie ihr einziges Kind-Layer (z.B. `gis_basis/nw_basisplan_gis_dynamisch/gemeindegrenzen` als Gruppe UND als Blatt-Layer). `_findLayerRecursive()` suchte top-down und gab den **Gruppen-Knoten** (type='group') zuerst zurÃ¼ck. `toggleLayer` prÃ¼ft `layer.type === 'group'` â†’ return ohne Aktion.
- **Fix**: `_findLayerRecursive()` so angepasst, dass Blatt-Layer gegenÃ¼ber gleichnamigen Gruppen-Knoten bevorzugt werden: Bei ID-Match + type=group/subcategory â†’ zuerst Kinder durchsuchen; nur als Fallback den Gruppen-Knoten zurÃ¼ckgeben.
- **Guardrail**: Beim Aufbau hierarchischer Kataloge wo Eltern/Kind gleiche IDs haben kÃ¶nnen: rekursive Suchen mÃ¼ssen IMMER BlÃ¤tter vor Containern bevorzugen. `findLayer` nie blind den ersten Match zurÃ¼ckgeben.

## 2026-03-04 â€” Dargestellte Themen (Active Panel) nicht scrollbar

- **Symptom**: Neue Active-Panel-Container (`#lm-active-container`) scrollt nicht, obwohl mehr EintrÃ¤ge vorhanden sind als sichtbar.
- **Root-Cause**: Drei Probleme: (1) CSS `max-height: calc(100vh - 260px)` war ~820px â€” Content Ã¼berlÃ¤uft nie innerhalb des Containers. (2) Dojo TitlePane setzt ContentOuter Inline-Styles beim Ã–ffnen zurÃ¼ck â†’ `overflow-y: auto` geht verloren. (3) `#lm-active-container` wird asynchron von `tnet-lm-init.js` erstellt, existiert ggf. noch nicht wenn `setupPanel()` in `tnet-accordion-resize.js` erstmals lÃ¤uft â†’ Inline-Styles werden auf NULL-Element angewendet.
- **Fix**: (a) CSS: `max-height` auf `var(--tnet-active-height, 300px)` mit `!important`-Overflow. ZusÃ¤tzliche Regel auf `#tp_sort_menu > .dijitTitlePaneContentOuter` mit `overflow-y: auto !important`. (b) JS v2.1: `applyHeight()` setzt CSS-Variable `--tnet-active-height` als Fallback. Lazy Flag-Reads via `readFlags()` statt IIFE-Scope. Dojo `widget.watch('open', ...)` re-appliziert Styles nach Animation. Container-Nachverfolgung per Polling falls `#lm-active-container` verspÃ¤tet erscheint.
- **Guardrail**: Bei Dojo-TitlePanes: Inline-Styles werden beim Open/Close Ã¼berschrieben â†’ immer CSS `!important` als Basis verwenden + JS re-apply nach Open. Asynchron erstellte Container brauchen Polling/Observer fÃ¼r nachtrÃ¤gliche Style-Anwendung.

## 2026-03-06 â€” Coalesce-Bridge: queryconnector filtert nicht bei root-linked MapTip-EintrÃ¤gen

- **Symptom**: MapTip zeigt Ergebnisse aller 14 Sublayer, obwohl nur 2 sichtbar sind. queryconnector-Patch greift nicht.
- **Root-Cause**: MapTip-EintrÃ¤ge `_0` bis `_13` in multi.conf verwenden `linked_layer: "gis_oereb/nw_nutzungsplanung_def"` (Root-Key direkt), nicht einen Sublayer-Key. `_sublayerToRoot[rootKey]` â†’ undefined. `_extractRootKey(rootKey)` â†’ `"gis_oereb"` (falsch, splittet 2-Segment-Key).
- **Fix**: Queryconnector v2 mit 3-Strategie-PrioritÃ¤t: (1) Direct-Match: `_rootServices[linkedId]`, (2) Sublayer-Lookup: `_sublayerToRoot[linkedId]`, (3) Fallback: `_extractRootKey()` + Verifikation.
- **Guardrail**: MapTip-`linked_layer` kann sowohl ein Root-Key als auch ein Sublayer-Key sein. Root-Key Matching immer als erste Strategie prÃ¼fen.

## 2026-03-06 â€” Coalesce-Bridge: Framework-URL Ã¼berschreibt Sublayer-Keys mit Root-Keys

- **Symptom**: URL wechselt von korrekten Sublayer-Keys auf Root-Key (`layers=gis_oereb/nw_nutzungsplanung_def`). Beim Reload wird der konsolidierte Layer statt der korrekten Sublayer aktiviert.
- **Root-Cause**: `njs.AppManager.updateMapStatusUrl()` wird bei jedem `moveend`/`loadend` aufgerufen, schreibt `layers=` mit LyrMgr-Root-Key-IDs via `history.replaceState()`.
- **Fix**: 3 Patches: (1) `_patchUpdateMapStatusUrl()` â€” nach Original: Root-Keys durch Sublayer-Keys ersetzen. (2) `_patchTnetLayerSwitch()` â€” bei `on`-Aufruf fÃ¼r Coalesce-Sublayer: Ã¼ber Store routen statt individuelles OL-Layer erstellen. (3) `restoreFromUrl()` auf `catalog-loaded`: Sublayer-Keys aus URL via Store aktivieren.
- **Guardrail**: Bei URL-State-Management immer prÃ¼fen, wer die URL schreibt (Framework vs. eigener Code). TnetLayerSwitch-Aufrufe fÃ¼r Coalesce-Sublayer MÃœSSEN Ã¼ber den Store laufen, nie direkt Ã¼ber LyrMgr.switchLayersProgr().

## 2026-03-05 â€” Ghost-Layer: Coalesce-Layer bleiben auf Karte nach Entfernung

- **Symptom**: Layer bleiben auf der Karte sichtbar, obwohl sie aus dem Panel Â«Dargestellte ThemenÂ» entfernt wurden (kein Eintrag mehr im Store/Panel). Maptip funktioniert nicht auf Ghost-Layern, aber RÃ¤umliche Abfrage findet Daten.
- **Root-Cause (v4, endgÃ¼ltig)**: Das Framework erstellt beim Startup via `ClassicLayerMgr.switchLayersProgr()` â†’ `lay.switchLayer(true)` **individuelle OL-Layer** fÃ¼r jeden Sublayer-Key (z.B. `gis_oereb/nw_nutzungsplanung_def/grundnutzung`). Diese gehen NICHT durch `TnetLayerSwitch` und NICHT durch die Coalesce-Bridge. Der Store erkennt sie via `_onOLLayerAdd` und zeigt sie im Active-Panel. Aber `_coalesceOLLayers[groupId]` wird NIE erstellt, weil `restoreFromUrl` die Layer als bereits sichtbar sieht. Beim Entfernen: `removeLayer` â†’ `_layerToCoalesce[layerId]` existiert â†’ Coalesce-Pfad â†’ `_removeFromCoalesceOLLayer` findet kein `cEntry` â†’ **return sofort** â†’ OL-Layer bleibt auf der Karte!
- **Fix**: In `_removeFromCoalesceOLLayer` (tnet-lm-store.js): Wenn `cEntry` nicht existiert, Fallback auf `TnetLayerSwitch(layerId, 'off')` â€” das findet den Framework-OL-Layer am richtigen Namen und entfernt ihn via `mgr.switchLayer(sublayerKey, false)` â†’ `lay.switchLayer(false)` â†’ `map.removeLayer(this._lyr)`. ZusÃ¤tzlich: `toggleLayerEye` Fallback Ã¼ber `_olLayerRef.setVisible()` fÃ¼r Startup-Layer ohne Coalesce-Entry.
- **Guardrail**: Wenn `_layerToCoalesce[id]` zwar gesetzt ist (aus Katalog) aber kein `_coalesceOLLayers`-Eintrag existiert (weil Framework die Layer beim Startup direkt erstellt hat), muss der Entfernungs-Code auf den Standard-Pfad (`TnetLayerSwitch off`) zurÃ¼ckfallen.
- **Fehlgeschlagene AnsÃ¤tze (v1-v3)**: (1) Dreifach-Sicherung in Bridge â€” zu komplex. (2) `map.removeLayer(entry.olLayer)` â€” entry.olLayer zeigt auf Root, nicht auf individuelle Sublayer. (3) `_findFrameworkOLLayer(rootKey)` â€” findet Root-Layer, aber die Ghosts sind individuelle Sublayer-OL-Layer.
- **Update v5 2026-03-05**: v4-Fix greift nur wenn KEIN Bridge-`cEntry` existiert. Aber bei URL-Start (`?layers=...`) erstellt das Framework einen individuellen OL-Layer (name=sublayerKey) UND die Bridge einen Root-OL-Layer (name=rootKey) â†’ zwei Layer Ã¼bereinander. v4-Fallback (`!cEntry`) feuert nie, weil Bridge-Entry existiert. Fix: In `unregisterSublayer` (Bridge) zusÃ¤tzlich `_findFrameworkOLLayer(sublayerKey)` aufrufen und individuellen OL-Layer von der Map entfernen. Auch bei `registerSublayer` den individuellen Layer sofort entfernen (Doppel-Schutz wÃ¤hrend Nutzung).
- **Update v6 2026-03-05**: v5-Cleanup in `registerSublayer` lÃ¤uft zu FRÃœH â€” der individuelle Framework-Layer existiert noch nicht zu dem Zeitpunkt. Framework erstellt ihn verzÃ¶gert via `switchLayersProgr` oder `ensureUrlLayers` NACH der Bridge-Registrierung. Fix: Ghost-Schutz direkt im `_watchMapChanges` â†’ `map.getLayers().on('add')` Listener (tnet-lm-store.js). PrÃ¼ft VOR `_olLayerRef`-Setzen und `_suppressMapSync`: wenn `TnetCoalesceBridge.isManagedSublayer(lid)` â†’ sofort `map.removeLayer(olLayer)`. FÃ¤ngt den Layer exakt im Moment ab in dem er zur Map hinzugefÃ¼gt wird, unabhÃ¤ngig vom Timing.
- **KRITISCH v6b**: `map.removeLayer()` synchron innerhalb eines `map.getLayers().on('add')` Handlers aufrufen **korrumpiert OpenLayers' interne Collection**! ALLE nachfolgenden Layer-Operationen brechen (Basemap-Wechsel, Layer schalten, etc.). Fix: `olLayer.setVisible(false)` sofort (unsichtbar), dann `setTimeout(function() { map.removeLayer(olLayer); }, 50)` deferred. **Guardrail**: NIEMALS `removeLayer` synchron in einem `add`-Event-Handler aufrufen â€” immer deferren!

## 2026-03-05 â€” Breadcrumb zeigt falschen Katalogpfad (z.B. Ã–REB statt Grundbuchplan)

- **Symptom**: Objektinfo-Breadcrumb zeigt â€žÃ–REB > RAUMPLANUNG > ..." obwohl der Layer im Katalog unter â€žGrundlagen > Grundbuchplan" platziert ist. Tiefste Verschachtelung im Dojo-LyrMgr-Baum gewinnt immer.
- **Root-Cause**: `resolveFastBreadcrumb` (tnet-info-panel.js) baut eine Lookup-Map aus dem Dojo-`arCategories`-Baum. Bei Mehrfachvorkommen (gleicher `layer.name` in mehreren Kategorien) Ã¼berschreibt der letzte Traversal. Scoring: `score += path.length` â†’ tiefster Pfad bevorzugt. Dojo-Baum hat artikulierte Tiefen-Struktur mit NLS-Labels, die den Admin-Katalog nicht widerspiegelt.
- **Fix**: TNET-Katalog (aus API / `lyrmgr.conf`) als **primÃ¤re Breadcrumb-Quelle** verwenden. Neue Methode `TnetLMStore.getLayerCatalogPath(prefix)` traversiert rekursiv `_catalog` (exakt + Prefix-Match). `resolveFastBreadcrumb` prÃ¼ft zuerst den TNET-Katalog; nur bei Nicht-Treffer Fallback auf Dojo-LyrMgr-Baum. Breadcrumb-Cache wird bei `catalog-loaded` Event invalidiert.
- **Guardrail**: FÃ¼r Breadcrumbs immer den TNET-Katalog als autoritative Quelle verwenden â€” der Dojo-LyrMgr-Baum hat unkontrollierbare Tiefe und Mehrfachvorkommen.

## 2026-03-06 â€” Feature: Breadcrumb-Klick â†’ Layer im Themenkatalog hervorheben

- **Feature**: Klick auf Breadcrumb im Info-Panel Ã¶ffnet den Themenkatalog, expandiert Eltern-TitlePanes, aktiviert den richtigen Kantons-Tab und scrollt zum Layer mit Highlight-Animation.
- **Implementierung**: `scrollToLayerInCatalog(linkedLayerId)` in tnet-info-panel.js. Findet Layer-DOM via `div_<key>` oder `dijit.byId(<key>)`. Traversiert DOM aufwÃ¤rts um Kantons-Tab zu bestimmen und TitlePanes zu Ã¶ffnen. `renderBreadcrumbInTitleBar` erweitert um `data-linked-layer` Attribut und Click-Handler. CSS: `.tnet-maptip-breadcrumb-clickable` (cursor, hover-Feedback), `.tnet-catalog-highlight` (@keyframes Puls-Animation in `--m-color-primary`).
- **Guardrail**: `scrollIntoView` mit 450ms Delay aufrufen â€” TitlePane-Animationen brauchen Zeit. `e.stopPropagation()` im Click-Handler, sonst Ã¶ffnet/schliesst sich das Ã¼bergeordnete TitlePane.

## 2026-03-06 â€” Feature: Ctrl+Klick â†’ Alle Geschwister-Knoten im Katalog Ã¶ffnen/schliessen

- **Feature**: Ctrl+Klick auf einen Kategorie-Knoten im Themenkatalog toggelt alle Geschwister derselben Hierarchiestufe (gleicher Parent-Container, gleiches `data-lyrmgr-depth`).
- **Implementierung**: Im TitleBar-Click-Handler (tnet-lyrmgr-patch.js, Abschnitt â€žNativer DOM-Click") wird `e.ctrlKey || e.metaKey` geprÃ¼ft. Bei Ctrl: Parent-Container durchlaufen, alle `dijitTitlePane[data-lyrmgr-depth="<N>"]` Geschwister finden, jeweils `_setOpenAttr(targetOpen)` aufrufen.
- **Guardrail**: Nur Geschwister im selben Parent-Container toggeln (nicht global alle Panes derselben Tiefe). `dijit.byNode()` in try/catch, da nicht alle Panes das Widget haben.

## 2026-03-06 â€” Coalesce-Layer rendert erst nach doppeltem Toggle (aus/ein)

- **Symptom**: Beim ersten Einschalten eines Coalesce-Sublayers (z.B. Ã–REB Nutzungsplanung) wurde der Karteninhalt nicht dargestellt. Erst nach Aus- und wieder Einschalten war der Layer sichtbar. ZusÃ¤tzlich wurde die URL (`layers=`) nicht aktualisiert.
- **Root-Cause**: `registerSublayer()` in der Coalesce-Bridge rief `TnetLayerSwitch(rootKey, 'on')` auf, was intern `switchLayersProgr()` (asynchron) triggert. Direkt danach wurde synchron `_findFrameworkOLLayer(rootKey)` geprÃ¼ft â€” der OL-Layer existierte aber noch nicht (async!). Die Bridge gab `false` zurÃ¼ck â†’ der Store fiel auf den Standard-Coalesce-Pfad zurÃ¼ck und erstellte einen eigenen `ol.source.ImageArcGISRest`-Layer. Beim zweiten Toggle war der Framework-OL-Layer bereits da â†’ Bridge funktionierte. Der Standard-Coalesce-Pfad hatte zudem keine URL-Sync â†’ `layers=`-Parameter blieb leer.
- **Fix**: (1) `registerSublayer()` gibt jetzt immer `true` zurÃ¼ck (kein sofortiger Fallback). Der OL-Layer wird asynchron mit Retry gesucht (bis 12 Versuche, 300â€“1500ms). Erst nach allen Retries wird aufgerÃ¤umt. (2) Ã–ffentliche `scheduleUrlSync()` Methode auf Bridge exponiert. (3) Standard-Coalesce-Pfad im Store ruft `TnetCoalesceBridge.scheduleUrlSync()` auf.
- **Guardrail**: Nach `TnetLayerSwitch()` NIEMALS synchron auf den OL-Layer prÃ¼fen â€” `switchLayersProgr` ist asynchron. Immer Retry-Pattern verwenden.

## 2026-03-06 â€” Coalesce-Layer laden nicht aus URL beim App-Start

- **Symptom**: URL mit `layers=gis_oereb/nw_nutzungsplanung_def/ueberlagernde_festlegung|.../grundnutzung` zeigt beim Start keine Layer an.
- **Root-Cause**: `registerSublayer()` rief `TnetLayerSwitch(rootKey, 'on')` auf, aber das Framework kennt den Root-Service-Key (`gis_oereb/nw_nutzungsplanung_def`) nicht als konfigurierten Layer â†’ `switchLayersProgr` erzeugt keinen OL-Layer â†’ trotz Async-Retry wird nie einer gefunden â†’ Layer bleiben unsichtbar.
- **Fix**: Bridge erstellt den OL-Layer jetzt **selbst** (`_createRootOLLayer`), statt auf das Framework zu warten. `serviceUrl` wird via `TnetLMStore.getCoalesceInfo(sublayerKey)` geholt. `ol.source.ImageArcGISRest` + `ol.layer.Image` werden synchron erstellt und der Map hinzugefÃ¼gt. `TnetLayerSwitch(rootKey, 'on')` wird nicht mehr aufgerufen.
- **Guardrail**: Nie davon ausgehen, dass das Dojo-Framework einen Root-Dienst-Key kennt â€” es kennt nur Blatt-Layer-Keys. FÃ¼r Coalesce-Root-Dienste immer den OL-Layer selbst erstellen.

## 2026-03-06 â€” Coalesce-Gruppenname zeigt Service-Pfad statt Alias

- **Symptom**: Im Active-Layers-Panel steht `gis_oereb/nw_nutzung...` statt des lesbaren Namens ("Nutzungszonen").
- **Root-Cause**: In `_scanCoalesceNodes` hatte `servicePath` Vorrang Ã¼ber `n.name`: `name: servicePath || n.displayName || n.name || n.id`. Kommentar sagte "DB-Name ist oft generisch" â€” trifft aber auf die meisten Katalog-Knoten nicht zu.
- **Fix**: PrioritÃ¤t umgekehrt: `n.displayName || n.name || servicePath || n.id`. Generische Namen ("Virtueller Layer") werden mit PrÃ¼fung Ã¼bersprungen.
- **Guardrail**: Katalog-Knoten-Namen (`n.name`, `n.displayName`) haben immer Vorrang vor technischen Pfaden. Nur als Fallback hinter Generik-Check verwenden.

## 2026-03-08 â€” DB-Pfad: selectAll und legend fehlen auf verschachtelten Gruppen

- **Symptom**: SelectAll-Checkbox und Legenden-Button auf verschachtelten Gruppen (z.B. "Nw Nutzungsplanung Def") nicht sichtbar â€” obwohl in lyrmgr.conf `selectAll: true` und `legend` korrekt gesetzt sind.
- **Root-Cause (1/2)**: SQL-Query im DB-Pfad (`buildCatalogTree`) selektierte weder `cn.select_all` noch `cn.legend` aus `catalog_node`. Die Spalten existierten in der DB und wurden vom Importer geschrieben, aber die Query ignorierte sie.
- **Root-Cause (2/2)**: Die Daten fehlten initial in der DB auch wegen fehlendem Katalog-Resync (`admin.php?action=configtopg&scope=catalog`) nach dem HinzufÃ¼gen der Spalten.
- **Fix**: `cn.select_all` und `cn.legend AS node_legend` zur SQL hinzugefÃ¼gt. In der Node-Verarbeitung: `$node['selectAll'] = true` wenn `select_all` gesetzt, `$node['legend']` aus `node_legend`. Anschliessend Katalog-Resync ausgefÃ¼hrt.
- **Guardrail**: Wenn neue Spalten zu `catalog_node` hinzugefÃ¼gt werden â†’ IMMER auch die SQL-Query in layers.php UND die Node-Verarbeitung in `buildCatalogTree` anpassen. Nach Schema-Ã„nderung: Katalog-Resync via `admin.php?action=configtopg&scope=catalog` triggern.

## 2026-03-08 â€” DB-Pfad: Leaf-Layer ohne legend/legendLayers

- **Symptom**: Legenden-Button (ðŸ—º) fehlt auf Blatt-Layern im neuen Tree, obwohl der File-basierte API-Pfad `legend`/`legendLayers` korrekt liefert.
- **Root-Cause**: Der DB-Pfad lieferte nur `legendTitle`/`legendLink` (volle URL), aber der JS-Renderer erwartet `legend` (Service-Pfad) und `legendLayers` (Layer-Index). Die Konvertierung via `extractLegendInfo()` fehlte im DB-Pfad.
- **Fix**: `ld.url`, `ld.layer_type`, `ld.params` werden jetzt IMMER selektiert (nicht nur bei `details=true`). FÃ¼r Leaf-Layer wird ein Mini-Def-Array gebaut und `extractLegendInfo()` aufgerufen â€” identisch zum File-Pfad. LEFT JOIN auf `layer_definition` ist jetzt immer aktiv.
- **Guardrail**: Beide API-Pfade (File + DB) MÃœSSEN identische Felder auf den Leaf-Layern liefern. `extractLegendInfo()` ist die einzige Quelle fÃ¼r `legend`/`legendLayers` â€” immer diese Funktion verwenden.

## 2026-03-08 â€” Toggle nach Breadcrumb-Navigation funktioniert nicht

- **Symptom**: Nach Breadcrumb-Navigation zu einem Layer (z.B. "Grundnutzung") lassen sich Ã¼bergeordnete Gruppen nicht mehr schliessen.
- **Root-Cause**: Toggle-Handler nutzte `closest('[data-group-id]')` fÃ¼r die Gruppen-Suche â€” das matchte auf jeden Elternknoten mit `data-group-id`, potenziell auch auf den falschen. Zustandserkennung via `!contains('lm-collapsed')` konnte bei fehlender Klasse (weder expanded noch collapsed) inkorrekt sein. `classList.toggle(name, force)` hatte Browser-Quirks.
- **Fix**: Selektor geÃ¤ndert auf `closest('.lm-subcat, .lm-group, .lm-nested-group')` (explizite Klassen). Explizites `classList.add/remove` statt `toggle(name, force)`. `e.preventDefault()` ergÃ¤nzt. Debug-Logging via TnetLog.
- **Guardrail**: CSS-Klassen-Toggle immer explicit add+remove verwenden, nie `classList.toggle(name, boolForce)`. Group-Suche immer via CSS-Klasse (`.lm-subcat` etc.), nicht via Daten-Attribut.

## 2026-06-19 â€” Breadcrumb-Jump fand Zielknoten nicht mehr

- **Symptom**: Klick auf den Breadcrumb im Info-Panel Ã¶ffnete den Katalog zwar, sprang aber nicht zum Ziel-Layer oder hob ihn nicht hervor.
- **Root-Cause**: Die Zielsuche lief vor dem Ã–ffnen des `tp_overview_menu`; bei lazy gerenderten bzw. noch versteckten Knoten war der Layer-DOM dadurch noch nicht vorhanden.
- **Fix**: `scrollToLayerInCatalog()` Ã¶ffnet den Katalog jetzt zuerst und wiederholt die Zielsuche nach einem kurzen Retry. Die eigentliche Navigation wurde in `_scrollToCatalogTarget()` ausgelagert, damit der gefundene Knoten nach dem Retry ohne Duplikatpfad verarbeitet wird.
- **Guardrail**: Bei Breadcrumb-Navigation zu lazy gerenderten Katalogen immer zuerst das Zielpanel Ã¶ffnen und mindestens einen kurzen Retry fÃ¼r die DOM-Suche einplanen.

## 2026-06-19 â€” Breadcrumb-Jump: Delegation, Gruppen-IDs, Keyframe-!important, CSS-Cache

- **Symptom**: Breadcrumb-Klick im Info-Panel sprang teils gar nicht (z.B. LÃ¤rm-Layer), und das gefundene Ziel blinkte nicht auf.
- **Root-Cause 1 (Sprung)**: `scrollToLayerInCatalog()` baute die Navigation selbst nach und scheiterte an lazy gerenderten Tabs (inaktive Tabs haben 0 Layer im DOM). Zudem suchte `TnetLMTree.navigateToLayer()` nur nach `[data-layer-id]`; zeigt `linked_layer` auf einen Dienst/Gruppe, existiert dafÃ¼r aber nur `[data-group-id]`.
- **Root-Cause 2 (Blinken)**: `@keyframes lm-highlight-pulse` enthielt `!important` in den Keyframe-Deklarationen. `!important` ist in `@keyframes` laut CSS-Spec ungÃ¼ltig â†’ Browser verwirft die Deklarationen â†’ leere Keyframes, keine Animation.
- **Root-Cause 3 (Cache)**: `override.css` war ohne `?v=` eingebunden und wurde aggressiv gecacht; selbst Hard-Reload behielt die alte (kaputte) Version.
- **Fix**: `scrollToLayerInCatalog()` delegiert an `window.TnetLMTree.navigateToLayer()` (Lazy-Render, Tab-Wechsel, Eltern-Expand, Scroll/Highlight inklusive). `tryFind` sucht jetzt zusÃ¤tzlich `[data-group-id]` (exakt + Eltern-Pfad-Fallback). `!important` aus den Keyframes entfernt (in `override.css` und `tnet-lm.css`). Cache-Buster `?v=20260619b` an den `override.css`-Link in `index_de.htm`.
- **Guardrail**: Niemals `!important` innerhalb von `@keyframes` â€” wird still ignoriert. CSS-Dateien immer mit `?v=`-Cache-Buster einbinden, sonst greifen Fixes trotz Deploy nicht. Bei Katalog-Navigation sowohl `data-layer-id` als auch `data-group-id` berÃ¼cksichtigen.

## 2026-03-08 â€” Gruppen-Legend: Case-Mismatch ArcGIS-Servicename vs. Config
- **Symptom**: Klick auf Legenden-Button einer Gruppe zeigt "ArcGIS Legend-Fehler: Could not find service". Leaf-Layer-Legenden funktionieren.
- **Root-Cause**: lyrmgr.conf und DB-Spalte `catalog_node.legend` enthalten den Service-Pfad in Kleinbuchstaben (z.B. `gis_oereb/nw_nutzungsplanung_def`), aber der ArcGIS-Dienst heisst `nw_nutzungsplanung_DEF` (Grossbuchstaben). ArcGIS REST ist case-sensitive. Leaf-Layer haben den korrekten Case aus `extractLegendInfo()` (direkt aus der URL), Gruppen-Legend kommt aber aus der Config.
- **Fix**: `_propagateLegends()` im Store ergÃ¤nzt: Nach der Vererbung an Kinder, wird `_findCorrectLegendCase()` aufgerufen. Diese Funktion sucht rekursiv in Kind-Knoten nach einem `legend`-Wert der case-insensitiv Ã¼bereinstimmt aber korrekt gecastet ist (aus extractLegendInfo). Gruppen-Legend wird dann auf den korrekten Case aktualisiert.
- **Guardrail**: ArcGIS REST ist case-sensitive. Service-Pfade aus Config nie direkt verwenden â€” immer gegen die aus der URL extrahierten Pfade (extractLegendInfo) abgleichen.

## 2025-07-27 â€” Icon-Zentralisierung: Inline-SVGs in externe Dateien + TnetIcons Modul
- **Symptom**: ~45 inline SVGs verstreut Ã¼ber 10+ JS-Dateien. Gleiche Icons (dock, undock, close) mehrfach dupliziert. Wartung und Konsistenz schwierig.
- **Root-Cause**: Historisch gewachsen â€” jedes Modul definierte eigene SVG-Strings inline.
- **Fix**: 22 SVG-Dateien unter `/maps/tnet/resources/icons/` erstellt. Neues `tnet-icons.js` Modul mit `window.TnetIcons` (fetch-basierter Loader mit Cache). `TnetIcons.loadAll()` im HTML-Head aufgerufen, alle Module nutzen `TnetIcons.get('name')`. CSS data-URIs beibehalten (currentColor funktioniert nicht in externen SVGs via url()). Search-Fallback-SVGs beibehalten (eigener Loader).
- **Guardrail**: Neue Icons immer als .svg in `/resources/icons/` ablegen und in `TnetIcons.ALL` registrieren. FÃ¼r CSS-Hintergrundbilder weiterhin data-URIs verwenden.

## 2026-03-08 â€” SelectAll-Checkbox: Gruppen-Layer nicht robust eingeschaltet
- **Symptom**: Gruppen-Checkbox (selectAll) anhaken â†’ nicht alle Kind-Layer werden eingeschaltet. Intermittent.
- **Root-Cause**: `setLayerVisible` hat Guard `if (layer.visible === visible) return;`. Wenn Store durch `_syncFromMap` bereits `visible: true` hat, aber UI-Checkbox noch unchecked (Tab war nicht gerendert bei Sync), werden Layer Ã¼bersprungen â†’ kein Event â†’ Checkbox bleibt unchecked. ZusÃ¤tzlich: Standard-Layer (TnetLayerSwitch/switchLayersProgr) vertragen keine 9+ Aufrufe in enger Schleife.
- **Fix**: `setGroupAllVisible` komplett Ã¼berarbeitet: (1) Guard umgehen â€” `visible`-State vor Aufruf auf Gegenteil setzen falls nÃ¶tig, (2) Coalesce-Layer synchron (Debounce bÃ¼ndelt), Standard-Layer gestaffelt (50ms Abstand), (3) Fehler pro Layer abfangen, Event trotzdem emittieren, (4) Fallback-Sync `_syncGroupCheckboxes` nach 800ms prÃ¼ft DOM vs. Store.
- **Guardrail**: Bei Batch-Operationen nie den `layer.visible === visible` Guard verlassen. Immer force-through fÃ¼r Gruppen-Aktionen.

## 2026-03-08 â€” SelectAll: "Jedes zweite Mal" Race Condition
- **Symptom**: SelectAll-Checkbox fÃ¼r Gruppen-Layer (Ã–REB, SLB) funktioniert nur jedes zweite Mal (nicht deterministisch, timing-abhÃ¤ngig).
- **Root-Cause**: Bridge's `_syncDojoCheckbox()` in `registerSublayer`/`unregisterSublayer` setzt Dojo-Checkboxen â†’ Dojo-Framework reagiert async mit `switchLayersProgr` â†’ erstellt individuelle Ghost-OL-Layer â†’ Ghost-Schutz muss diese asynchron entfernen. Race Condition zwischen `_suppressMapSync` (200ms Reset), Dojo-Async und Ghost-Schutz (50ms Deferred) â†’ je nach Browser-Timing funktioniert es oder nicht.
- **Fix**: Batch-Modus (`beginBatch`/`endBatch`) in der CoalesceBridge. Store's `setGroupAllVisible` aktiviert Batch vor Coalesce-Verarbeitung. Im Batch-Modus wird `_syncDojoCheckbox` komplett unterdrÃ¼ckt â†’ keine Dojo-Seiteneffekte â†’ keine Ghost-Layer â†’ kein Timing-Problem. URL-Sync wird einmal am Ende ausgelÃ¶st. Fallback-Sync-Timeout auf 1200ms erhÃ¶ht.
- **Guardrail**: `_syncDojoCheckbox` NIE in Batch-Operationen aufrufen. Dojo-Checkbox-Sync nur fÃ¼r einzelne Layer-Toggles, nie fÃ¼r Massen-Aktivierung.

## 2026-03-xx â€” Proxy-SSO: autoLogin: false wird ignoriert trotz korrekter JS-Logik
- **Symptom**: Auto-Login startet weiterhin obwohl `autoLogin: false` in `tnet-global-config.json5` gesetzt ist und JS-Logik korrekt `=== true` prÃ¼ft.
- **Root-Cause**: PHP-Default-Array hatte `'autoLogin' => true`. Wenn JSON5-Parse fehlschlÃ¤gt (oder bis der Parse-Status unbekannt war), blieb der Fallback `true` â†’ PHP injizierte `window.__TNET_PROXY_AUTO_LOGIN = true` trotz Config-Einstellung.
- **Fix**: PHP-Default auf `'autoLogin' => false` geÃ¤ndert (sicherer Fallback). ZusÃ¤tzlich `window.__TNET_PROXY_CONFIG_STATUS` als JS-Variable injiziert (`'ok'`, `'default'` oder `'parse-failed:...'`) damit der Parse-Zustand im iframe-Kontext der Browser-Konsole sichtbar ist.
- **Guardrail**: PHP-Defaults fÃ¼r Sicherheits-/Verhaltensflags immer auf den restriktiveren Wert setzen (`false`). Parse-Fehler nie stillschweigend durch `true`-Fallbacks maskieren.

---

### Duplikat-Layer in OL-Map nicht synchron geschaltet (2026-04-10)

- **Symptom**: Layer ausschalten â†’ noch sichtbar (reduzierte Deckkraft), weil nur eine von mehreren OL-Layer-Instanzen geschaltet wurde. Layer erscheint mehrfach in URL (`layers=id|id|id`).
- **Root-Cause**: `_findOLLayer` findet nur den **ersten** OL-Layer mit dem Namen. Wenn das Framework denselben Layer aus mehreren lyrmgr-BlÃ¶cken erstellt, existieren Duplikate in der Karte. Jeder `switchLayersProgr`-Aufruf erstellt einen eigenen OL-Layer.
- **Fix**: (1) `_findAllOLLayers()` + Sync in `toggleLayerEye`/`setLayerVisible`/`setLayerOpacity`. (2) **Duplikat-Schutz im `add`-Handler** â€” zweiter OL-Layer mit gleicher ID wird sofort entfernt. (3) **`_syncFromMap` Duplikat-Erkennung** â€” beim Init nur ersten OL-Layer behalten. (4) **`_dedupUrlLayers()`** â€” bereinigt `layers=` und `op=` in der URL nach Duplikat-Entfernung + beim Init nach 2s.
- **Guardrail**: Duplikat-Schutz greift automatisch im `add`-Handler. URL wird automatisch bereinigt.

---

### Name vs. Alias Konzept-Bereinigung (2026-04-10)

- **Symptom**: Kategorie/Gruppen-Namen (gelb markiert) werden nach Publish nicht auf dem Server Ã¼bernommen.
- **Root-Cause**: `publishLyrmgr()` schreibt nur die lyrmgr.conf (Struktur mit Keys, keine Namen). Das `name`-Feld im Properties-Dialog war ein Hybrid â€” weder Key noch NLS-Alias. NLS-Edits wurden nicht automatisch mit-deployt.
- **Fix**: Properties-Dialog: `name` â†’ `_alias` (NLS) analog zur Layer-Alias-Logik. Save-Handler: `_alias` registriert NLS-Edit. Publish: nach erfolgreichem Conf-Deploy werden pending NLS-Edits automatisch mit-deployt via `_deployAllGroups()`. Inline `.cname` schreibt NLS statt `cat.name`.
- **Guardrail**: Cat/Group haben nur Key (Struktur) + Alias (NLS). `ref.name` bleibt nur als interner Fallback.

---

### KontextmenÃ¼ im Treebuilder (2025-06-20)

- **Symptom**: `+ Subkategorie`-Button war zu limitiert â€” kein EinfÃ¼gen vor/nach Knoten, keine Untergruppen, keine Properties-Bearbeitung
- **Root-Cause**: Bestehende Buttons konnten nur ans Ende der letzten Kategorie hinzufÃ¼gen, keine positionsgenaue EinfÃ¼gung
- **Fix**: Rechtsklick-KontextmenÃ¼ auf allen Baum-Knoten (Kat/Sub/Untergruppe/Item) mit Insert before/after, Properties-Dialog (legend, selectAll, drawtype, icon, open etc.), LÃ¶schen, In-Zwischenablage-Kopieren. `getItemByPath()` navigiert Ã¼ber verschachtelte Item-Arrays per Pfad-Array. Properties-Dialog mit dynamischem Formular je Knotentyp.
- **Guardrail**: KontextmenÃ¼-Handler via Event-Delegation auf `#tb-tree-body`, `.closest()` von innen nach aussen prÃ¼fen (Item â†’ Subgrp â†’ Sub â†’ Cat â†’ Lyrmgr).

---

### Resize-Handle funktioniert nicht â€” keepPanesOpen ohne Guard (2026-03-22)

- **Symptom**: Accordion-Resize-Handle nicht bedienbar, Drag bewirkt nichts
- **Root-Cause**: `keepPanesOpen()` MutationObserver in `tnet_toc.js` beobachtet `#kantons_container` inkl. `style`-Attribut, hat aber **keinen `__tnetResizing`-Guard**. `restoreActiveTab()` ebenso nicht. â†’ WÃ¤hrend Drag setzt `applyHeight()` Inline-Styles â†’ Observer feuert â†’ setzt `height: auto` â†’ Resize sofort rÃ¼ckgÃ¤ngig gemacht.
- **Fix**: `if (window.__tnetResizing) return;` in `keepPanesOpen` MutationObserver-Callback und am Anfang von `restoreActiveTab()` eingefÃ¼gt.
- **Guardrail**: **Jeder** MutationObserver der Inline-Styles auf Sidepanel-Elemente setzt, muss das `__tnetResizing`-Flag prÃ¼fen.

### Grosses Refactoring: Subkategorien â†’ Gruppenlayer (2025-01-XX)
- **Symptom**: Subkategorien waren nicht verschachtbar, umstÃ¤ndlich, nicht 1:1 kompatibel mit lyrmgr.conf Layergruppen
- **Root-Cause**: Internes Datenmodell `categories[].subcategories[].items[]` erzwang flache 1-Ebene-Hierarchie
- **Fix**: Komplettes Refactoring auf `categories[].items[]` (rekursiv verschachtbar). Betroffene Bereiche:
  - Core-Modell: `convertLyrmgrStructure`, `generateLyrmgrConfBlock`, `collectAllStagingIds`, `deriveGroupsFromLyrmgrs`
  - Rendering: Neues `renderTreeItem()` mit path-basierter Adressierung
  - CSS: `.tb-tree-sub*` / `.tb-tree-subgrp*` â†’ `.tb-tree-group*`
  - D&D: Vereinheitlicht auf `.tb-tree-item, .tb-tree-group` Selektoren
  - KontextmenÃ¼: `showSubCtxMenu` + `showSubgrpCtxMenu` â†’ `showGroupCtxMenu`
  - Properties-Dialog: `type === 'sub'` + `'subgrp'` â†’ `type === 'group'`
  - Clipboard: Gesamte Zwischenablage auf `cat.items[]` umgestellt
  - Preview-Click-Handler: Alle `data-clip-sub` / `data-sub-idx` entfernt
  - Export-Preview: `buildExportPreviewHtml` direkt auf `cat.items` lesen
  - Legacy-Import `importFromAPI`: Erzeugt jetzt Gruppenlayer-Objekte statt subcategories
- **Guardrail**: `getItemByPath()` fÃ¼r Lese-Zugriff, `getItemRefByPath()` fÃ¼r Mutations-Zugriff (liefert `{parent, index, item}`). Nie direkt `subcategories` indexieren.

## 2026-03-17 â€” legend-proxy.php: ÃœberzÃ¤hlige `}` nach JSON-MISS-Pfad â†’ HTTP 500

- **Symptom**: Nach Performance-Refactoring (gzip/ETag/sendCachedFile) liefert legend-proxy.php HTTP 500 â€” Body leer, kein PHP-Fehlertext sichtbar.
- **Root-Cause**: Beim Ersetzen des JSON-MISS-Ausgabepfads (`jsonResponse()` â†’ `sendCachedFile()`) blieb eine Ã¼berzÃ¤hlige `}` stehen, die den ursprÃ¼nglichen `if/else`-Block geschlossen hatte. PHP-Syntaxfehler â†’ 500 mit leerem Body.
- **Fix**: ÃœberflÃ¼ssige `}` direkt nach `sendCachedFile($cacheFile, 'application/json', ...)` entfernt.
- **Guardrail**: Nach jedem PHP-Strukturrefactoring lokal `php -l datei.php` ausfÃ¼hren. Leerer 500-Body = PHP-Syntaxfehler (nicht Runtime). Auf ungematchte Klammern unterhalb von `exit`-Aufrufen achten.

## 2026-03-19 â€” replace_string_in_file bei grossen Dateien wirkungslos

- **Symptom**: `replace_string_in_file` meldet Erfolg fÃ¼r tree-builder.html (~296KB), aber die Datei auf Disk bleibt unverÃ¤ndert (mehrfach reproduziert).
- **Root-Cause**: Bei sehr grossen Dateien (>250KB) schlÃ¤gt die interne Persistierung fehl, obwohl das Tool Erfolg meldet.
- **Fix**: Python-Script (`_temp_patch_treebuilder.py`) mit `str.replace()` und `open(..., 'w')` verwenden.
- **Guardrail**: Bei grossen Dateien (>100KB) nach jeder Ã„nderung via Terminal/Python verifizieren, ob die Ã„nderung tatsÃ¤chlich geschrieben wurde. PowerShell-String-Ersetzungen mit `\n` vs `\r\n` (CRLF) sorgfÃ¤ltig prÃ¼fen â€” `IndexOf` mit LF-only findet auf Windows-Dateien den falschen Offset.

## 2026-03-19 â€” PowerShell Here-String + CRLF â†’ Datei-Korruption

- **Symptom**: PowerShell-basierte String-Ersetzung mit Here-Strings (`@"..."@`) und `\`n` (LF) als Marker korruptiert die Datei durch falschen Splice-Offset.
- **Root-Cause**: Windows-Dateien verwenden CRLF (`\r\n`). PowerShell-`\`n` ist nur LF. `IndexOf` auf CRLF-Inhalt mit LF-Marker gibt -1 oder falschen Offset â†’ `Substring()` schneidet an falscher Stelle.
- **Fix**: Python-Script mit expliziter Encoding-Kontrolle (`newline=''`) verwenden. Keine PowerShell-Here-Strings fÃ¼r Dateimanipulation grosser Dateien.
- **Guardrail**: Grosse HTML-Dateien immer mit Python manipulieren, nie mit PowerShell-String-Operationen.

## 2026-03-30 â€” Adresssuche: kein Pan/Highlight nach Klick auf Suchresultat

- **Symptom**: Desktop- und Mobile-Suche findet Adressen, aber Klick auf ein Resultat zeigt weder Highlight noch Pan/Zoom.
- **Root-Cause**: swisstopo Geocoder liefert fÃ¼r Adressen `featureId` + `layerId = ch.swisstopo.amtliches-gebaeudeadressverzeichnis`. Dieser Layer ist im MapServer REST-API **nicht vorhanden** (HTTP 404). `highlightFeature()` brach bei non-200 Status ab, ohne Fallback auf `panToResult()`.
- **Fix**: `highlightFeature()` mit `fallbackPan()`-Funktion ergÃ¤nzt: bei XHR-Fehler (404, Timeout, Parse-Error) wird `panToResult()` mit Punkt-Marker aufgerufen. Neue Hilfsfunktion `addPointMarker()` platziert roten Kreis auf Highlight-Layer. Fix in Desktop (`tnet-search.js`) und Mobile (`tnet-search-m.js`).
- **Guardrail**: Bei XHR-basierten Highlight-Funktionen IMMER einen Fallback auf Koordinaten-Pan einbauen. Externe APIs (swisstopo MapServer) kÃ¶nnen jederzeit Layer entfernen oder umbenennen.

## 2026-03-30 â€” Druckvorschau: SVG-Preview fÃ¼llt Rahmen nicht aus

- **Symptom**: Druckrahmen auf der Karte zeigt zwei sichtbare Rechtecke â€” Ã¤usseres Papier und innere MAP_AREA. SVG-Vorschau ragt Ã¼ber den Frame hinaus.
- **Root-Cause**: `_frameEl` wurde auf MAP_AREA-GrÃ¶sse dimensioniert, die SVG-Vorschau (gesamtes Papier) war grÃ¶sser und ragte Ã¼ber den Frame hinaus. Box-Shadow dimmte ab MAP_AREA-Kante, SVG-weisse RÃ¤nder lagen darÃ¼ber â†’ zwei sichtbare Grenzen.
- **Fix**: `updateFrameSize()` setzt Frame auf PapiergrÃ¶sse. SVG fÃ¼llt Frame bei (0,0). Overlay-Offset per `setOffset()` verschiebt Element, damit MAP_AREA-Zentrum auf `_printCenter` bleibt. `transformOrigin` auf MAP_AREA-Zentrum fÃ¼r korrekte Rotation. Mittelpunkt-Marker analog repositioniert.
- **Guardrail**: Bei WYSIWYG-Print-Vorschauen den Ã¤usseren Rahmen immer auf PapiergrÃ¶sse setzen, nicht auf den inneren Druckbereich. Das SVG-Layout muss den gesamten Rahmen ausfÃ¼llen.

## 2026-04-08 â€” URL-Bookmark Crash: infoFloatWinRemoveallItems is not a function

- **Symptom**: Beim Laden eines URL-Bookmarks (z.B. `/maps/nw_oereb`) stÃ¼rzt `setMapBookmark()` mit TypeError ab: `am.infoFloatWinRemoveallItems is not a function`. Keine Layer werden geladen.
- **Root-Cause**: `setMapBookmark()` ruft intern `this.infoFloatWinRemoveallItems()` auf. Diese Funktion existiert erst nach dem Laden des FloatingPane-Moduls (`dojox/layout/FloatingPane`), das bei URL-Bookmarks noch nicht geladen ist.
- **Fix**: Vor jedem `setMapBookmark()`-Aufruf prÃ¼fen und No-Op-Stub setzen: `if (typeof am.infoFloatWinRemoveallItems !== 'function') { am.infoFloatWinRemoveallItems = function() {}; }`. EingefÃ¼gt in `tnet-mapplus-helpers.js` (`_applyBookmark`) und `tnet-header.js` (`installSetMapBookmarkHook`).
- **Guardrail**: Framework-Methoden, die von FloatingPane abhÃ¤ngen, kÃ¶nnen beim frÃ¼hen Aufruf fehlen. Vor Verwendung immer auf Existenz prÃ¼fen und ggf. stubben.

## 2026-04-08 â€” Duplikat-Layer: Rendering bricht ab nach erstem Duplikat

- **Symptom**: Layer-Manager rendert keine weiteren Kategorien/Layer mehr nach dem ersten Duplikat-Layer. Konsole: `Tried to register widget with id==capricorn but that id is already registered`.
- **Root-Cause**: `ClassicLayerMgr._buildContentLayers` erstellt `dijit.form.CheckBox` mit `layer.name` als Widget-ID. Bei Duplikaten im Katalog (gleiche Layer-ID in mehreren Kategorien oder doppelt im selben Array) wirft `dijit.registry.add()` einen Error, der das gesamte Rendering abbricht.
- **Fix v1 (falsch)**: Layer aus `arLayers` filtern â†’ kein Error, aber Rendering stoppt trotzdem still (Framework-interne DeferredList-Kette bricht ab). **Fix v2 (korrekt)**: `dijit.registry.add` patchen â€” bei Duplikat altes Widget aus Registry entfernen (`dijit.registry.remove(id)`), neues registrieren. DOM des alten Widgets bleibt intakt. Alle Duplikat-Checkboxen rendern korrekt.
- **Guardrail**: Dojo-Widget-ID-Konflikte NICHT durch Ãœberspringen lÃ¶sen â€” das bricht den Rendering-Flow. Stattdessen `dijit.registry.add` tolerant patchen.

## 2026-04-10 â€” NLS-Alias Deploy: Ã„nderungen gehen nach Refresh verloren

- **Symptom**: Im Tree-Builder geÃ¤nderte Aliase (Layer/Kategorie) werden deployed (OK), verschwinden aber nach Seiten-Refresh wieder.
- **Root-Cause**: `stage-nls-conf` scannte nur EIN NLS-Verzeichnis (basierend auf `$source`-Parameter = Layer-Quelle). Kategorie-Keys wie `desc_Guguseli_Gugus` lagen aber in der Override-Datei (`/www/maps/core/nls/de/lyrmgrResources.json`), nicht in core. PHP fand den Key nicht â†’ Fallback schrieb an falschen Pfad. Override-Datei behielt alten Wert und gewann bei `array_merge`.
- **Fix**: `stage-nls-conf` scannt jetzt ALLE NLS-Verzeichnisse (core + override + profile). FÃ¼r jeden Key wird die hÃ¶chstpriorisierte Datei aktualisiert (Override > Core). Profil-Fallback nutzt `getProfileNlsPath()` statt `CONFIG_BASE`.
- **Guardrail**: NLS-Keys kÃ¶nnen in verschiedenen PrioritÃ¤tsstufen liegen (core < override < profile). Bei NLS-Operationen immer ALLE Stufen durchsuchen, nie nur eine basierend auf Layer-Quelle.

## 2026-04-22 â€” Admin-Login trotz Whitelist-IP

- **Symptom**: Aufrufe wie `admin-login.php?redirect=/maps/tnet/api/v1/slm.html` verlangten weiterhin Login, obwohl die Client-IP in der Zugriffsschutz-Whitelist stand.
- **Root-Cause**: Apache-Whitelist (`TNET_ADMIN`) und PHP-Cookie-Auth waren getrennt. `AdminAuth::isAuthenticated()` akzeptierte nur Cookie und ignorierte die gepflegte IP-Whitelist (`access-config.json`).
- **Fix**: Kein globaler Bypass. Stattdessen neuer Endpoint-Modus **â€žGeschÃ¼tzt + IP-Freigabeâ€œ** (pro HTML/PHP konfigurierbar). `AdminAuth::enforceEndpointPolicy()` wertet die Endpoint-Konfiguration aus und erlaubt Whitelist-IP nur in diesem Modus. ZusÃ¤tzlich robuste Client-IP-Normalisierung fÃ¼r `IPv4:port` und `[IPv6]:port`.
- **Guardrail**: IP-Freigabe nie global auf Auth schalten. Immer pro Endpoint als expliziter Modus fÃ¼hren, damit sensible Endpunkte (z.B. Security-UI) rein Cookie-geschÃ¼tzt bleiben.
## 2026-04-23 â€” Bookmark: 19 "fehlende" Layer waren ArcGIS-Sublayer-Indizes
- **Symptom**: Beim Laden eines Bookmarks listet das Log 26 Layer (7 Parents + 19 Kinder). Die 7 Parents werden aktiviert, die 19 Kinder nicht â€” der Catch-up meldet sie wiederholt als `fehlend`. Visuell ist die Karte aber komplett korrekt.
- **Root-Cause**: Bookmark-JSON enthÃ¤lt pro Parent-Layer noch die IDs aller `linked_layer`-Kinder (Legende-EintrÃ¤ge). Diese Kinder sind aber **keine eigenstÃ¤ndigen OL-Layer**, sondern Sublayer-Indizes `show:2,3,4,5,...` im `LAYERS`-Param des Parent-MapServers (`gis_fach/.../MapServer`). Der Server rendert sie automatisch mit. `getLayerById()` im LyrMgr findet sie daher nie und `switchLayersProgr()` lÃ¤uft ins Leere.
- **Fix**: Catch-up-Polling in `tnet-header.js` und `tnet-app.js` wieder entfernt. Der `setMapBookmark`-Hook loggt die Layer nur noch. Das Bookmark funktioniert ohne Nachzug, weil der Parent die Sublayer automatisch rendert.
- **Guardrail**: Bevor Retry-/Catch-up-Logik fÃ¼r Layer eingebaut wird, erst prÃ¼fen ob die Layer-IDs als eigenstÃ¤ndige OL-Layer existieren (via `map.getLayers()`) oder nur als Sublayer-Indizes in einem Parent-MapServer konfiguriert sind. Bei ArcGIS-Diensten sind Legenden-EintrÃ¤ge oft keine aktivierbaren Layer.

## 2026-04-24 â€” Bookmark-Layer nicht immer vollstÃ¤ndig aktiv trotz erfolgreichem Bookmark-Load
- **Symptom**: Einzelne Bookmark-Aufrufe (z.B. `nw_agglomeration`) laden die Karte, aber die erwarteten Layer sind nicht immer vollstÃ¤ndig sichtbar.
- **Root-Cause**: Die Bookmark-API liefert gemischte Layer-Listen (Parent + tiefe Child-Pfade). Diese Mischung ist fÃ¼r `setMapBookmark` timing-sensitiv und kann bei der Framework-Race-Condition zu inkonsistenter Layer-Aktivierung fÃ¼hren.
- **Fix**: In `tnet-mapplus-helpers.js` werden Bookmark-Layer vor dem Anwenden nur bereinigt (trim + dedupe), aber vollstÃ¤ndig beibehalten. ZusÃ¤tzlich lÃ¤uft ein verstÃ¤rkter Retry-Ensure (500/1500/3000/5000/8000ms) Ã¼ber `TnetLayerSwitch(..., 'on')` auf der kompletten Bookmark-Liste.
- **Guardrail**: Bei Bookmark-Layern keine Child-IDs pauschal entfernen. Nur Duplikate bereinigen und die Robustheit Ã¼ber zeitlich gestaffelte Retries herstellen.

## 2026-04-24 â€” Kartenwechsel per Bookmark stapelt alte Fachlayer statt sauber zu ersetzen
- **Symptom**: Beim Wechsel von Karte A auf Karte B bleiben Fachlayer von A sichtbar; B-Layer werden nur zusÃ¤tzlich geladen.
- **Root-Cause**: `setMapBookmark()` wurde direkt aufgerufen, ohne vorher den bestehenden Fachlayer-Stack explizit zu leeren. In bestimmten Timing-FÃ¤llen fÃ¼hrt das zu additivem Verhalten.
- **Fix**: In `_applyBookmark()` (tnet-mapplus-helpers.js) vor `setMapBookmark()` ein Pre-Clear eingebaut: zuerst aktive Layer via `TnetLMStore` deaktivieren (`setLayerVisible(false)`), danach Fallback Ã¼ber sichtbare Kartenlayer (`TnetLayerSwitch(name,'off')` fÃ¼r Fachlayer-Heuristik).
- **Guardrail**: Bei Bookmark-basiertem Kartenwechsel immer zuerst den thematischen Layer-Stack leeren, dann den neuen Bookmark anwenden.

## 2026-04-24 â€” Regression: Kartenwechsel blockiert durch Race zwischen Pre-Clear und alten Ensure-Retries
- **Symptom**: Nach dem Pre-Clear-Fix funktionierte der Kartenwechsel teilweise nicht mehr bzw. verhielt sich inkonsistent.
- **Root-Cause**: Alte `TnetSetBookmark`-Retry-Timer (`Layer-Ensure`) liefen weiter und griffen in den nÃ¤chsten Kartenwechsel ein. Gleichzeitig war das per-Layer-Clear timing-anfÃ¤llig.
- **Fix**: Vor jedem neuen Bookmark werden alle alten Ensure-Timer gecancelt und per Token invalidiert. Pre-Clear: `TnetLMStore.removeAllLayers()` (primÃ¤r), Fallback Ã¼ber direkte Layer-Deaktivierung (`TnetLayerSwitch(...,'off')`/`setVisible(false)`) statt Framework-Bookmark-Clear.
- **Guardrail**: Bei gestaffelten Retry-Strategien immer Cancel/Token-Mechanismus pro neuer Aktion einbauen. FÃ¼r Clear-Operationen **kein** `setMapBookmark('layers=')` als Fallback verwenden, da das erneut Bookmark-Hooks auslÃ¶st.

## 2026-04-24 â€” Falscher MapBookmark-Name im Log + Kartenauswahl-Dialog bleibt offen
- **Symptom**: In der Konsole wird weiterhin ein alter/anderer Bookmark-Name geloggt (z.B. `nw_agglomeration`), obwohl eine andere Karte geladen wurde. Zudem schliesst `mapsInfoDialog` nach dem Wechsel nicht zuverlÃ¤ssig.
- **Root-Cause**: Der Hook leitete den Namen primÃ¤r aus `window.location.pathname` ab (statisch fÃ¼r die aktuelle URL), nicht aus der tatsÃ¤chlich angeforderten Bookmark-ID. Das Dialog-Schliessen hing zusÃ¤tzlich von einem engen Pfad (`dialog.open && window.closeMapsInfoDialog`) ab.
- **Fix**: `TnetSetBookmark()` schreibt die zuletzt angeforderte ID in `window.__tnetLastRequestedBookmark` (inkl. top-window). Der Hook loggt bevorzugt diese ID. Dialog-Close wurde robust gemacht: Close-Versuch Ã¼ber lokale und top-window Funktion plus dijit-Fallback, inkl. kurzem Follow-up-Delay.
- **Guardrail**: FÃ¼r Aktions-Logging niemals nur auf URL-Pfade vertrauen; immer die echte Request-ID mitschreiben. Dialog-Schliessen in eingebetteten/Dojo-Kontexten immer Ã¼ber mehrere Fallback-Pfade absichern.

## 2026-04-24 â€” Dialog bleibt offen + Bookmark lÃ¤dt nicht bei API-/Timing-Fehler
- **Symptom**: Kartenauswahl-Dialog bleibt offen und der gewÃ¤hlte Bookmark wird nicht geladen.
- **Root-Cause**: `TnetSetBookmark()` war vollstÃ¤ndig vom API-Pfad abhÃ¤ngig; bei Fehlern blieb nur `{success:false}` Ã¼brig. Das Dialog-Schliessen passierte zu spÃ¤t und war an nachgelagerte Pfade gekoppelt.
- **Fix**: In `TnetSetBookmark()` wird der Dialog sofort geschlossen (lokal + top). Bei API-Fehlern wird ein direkter Framework-Fallback ausgefÃ¼hrt: `setMapBookmark(['main'], 'map=<bookmarkId>')`. Im Hook wird Name-Logging priorisiert aus `params.map` statt aus potenziell stale request-state.
- **Guardrail**: Bei Bookmark-Wechsel immer einen Framework-Fallback auf `map=<id>` vorsehen. Logging-Reihenfolge: `params.map` > request-state > URL-Pfad.

## 2026-04-24 â€” Sofortiges Dialog-Close hat Bookmark-Load aus dem Iframe abgewÃ¼rgt
- **Symptom**: Der Kartenauswahl-Dialog schliesst, aber der Bookmark wird gar nicht geladen.
- **Root-Cause**: `TnetSetBookmark()` wurde aus dem `mapsInfoFrame`-Iframe aufgerufen. Das frÃ¼he Schliessen des Dialogs entfernt `src` am Iframe und entlÃ¤dt damit genau den Kontext, in dem der Fetch/Promise noch lief.
- **Fix**: `TnetSetBookmark()` delegiert bei Iframe-Aufruf sofort an `window.top.TnetSetBookmark(bookmarkId)`. Die eigentliche Bookmark-Logik lÃ¤uft dadurch im Top-Window und Ã¼berlebt das anschliessende Dialog-Close.
- **Guardrail**: Aktionen aus modalen Iframes, die asynchron weiterlaufen, immer ins Top-Window delegieren bevor das Iframe geschlossen oder neu geladen wird.

## 2026-06-11 â€” Bookmark-Calls folgten noch der Seiten-URL statt dem Store
- **Symptom**: Bookmarks und Lock/Unlock liefen je nach Seitenpfad noch gegen die falsche Umgebung oder lieferten Store-Mismatches.
- **Root-Cause**: Mehrere Bookmark-Fetches nutzten noch relative `treebuilder-api.php`-URLs statt der bereits vorhandenen store-aware `API_URL`.
- **Fix**: Alle Bookmark-Calls in `slm.html` auf `API_URL` umgestellt, damit Bookmarks denselben Store verwenden wie der Rest der SLM.
- **Guardrail**: Store-sensitive API-Aufrufe in der SLM nie relativ formulieren, sondern immer ueber die zentrale Store-Basis schicken.

## 2026-06-11 Ã¢â‚¬â€ Sync-Tab zeigte nur Detailtabellen, aber keine schnelle Einordnung
- **Symptom**: Der Sync-Tab wirkte erst nach dem Aufklappen der Domains nÃ¼tzlich; der Unterschied zwischen DEV und PROD war auf einen Blick nicht erkennbar.
- **Root-Cause**: `slm.html` rendert zwar Statusdaten fuer Bookmarks, Katalog und Bundles, hatte aber keine verdichtete Zusammenfassung oberhalb der Detailtabellen.
- **Fix**: In `slm.html` wurde eine kompakte Summary mit Karten fuer Bookmarks, Katalog und Bundles ergÃ¤nzt. Sie zeigt Count-/Diff-Signale direkt im ersten Viewport und laesst die bestehenden Sync-Aktionen unveraendert.
- **Guardrail**: Bei Status-Views zuerst eine knappe Entscheidungsansicht liefern, dann erst die Detailtabellen rendern.

## 2026-06-11 Ã¢â‚¬â€ Sync-Auswahl war nicht granular genug
- **Symptom**: Im Sync-Tab war nicht direkt ersichtlich, welche Profile oder Bundles wirklich mitlaufen; die Aktion wirkte zu grob.
- **Root-Cause**: Die Tabellen zeigten nur Revisionen oder Scope, aber keine auswÃ¤hlbaren EintrÃ¤ge mit aktiviertem Sync-Status pro Zeile.
- **Fix**: In `slm.html` wurden Checkboxen pro Profil/KÃ¼rzel ergÃ¤nzt, dazu ein Domain-Toggle und ein Select-All pro Tabelle. Die Tabellen zeigen jetzt zusÃ¤tzlich Zeitstempel und Benutzer pro Umgebung, damit die Auswahl fachlich nachvollziehbar ist.
- **Guardrail**: Bei Sync-Operationen immer zuerst die auswÃ¤hlbaren Einheiten anzeigen und die Aktion nur auf die markierten EintrÃ¤ge anwenden.

## 2026-06-11 Ã¢â‚¬â€ Fullbackup und Restore fehlten im Sync-Tab
- **Symptom**: Der Sync-Tab hatte zwar Sync-Aktionen, aber keinen klaren Weg fÃ¼r einen vollstÃ¤ndigen State-Backup mit anschliessendem Restore.
- **Root-Cause**: Der vorhandene State-Backup-Flow war nur Ã¼ber die Backup-Verwaltung erreichbar und nicht direkt im Sync-Workflow verdrahtet.
- **Fix**: In `slm.html` wurde eine Fullbackup-Leiste mit `Fullbackup erstellen` und `Verwalten & Restore` ergÃ¤nzt. Auf Serverseite erstellt `create-full-backup` jetzt eine `state_full_*.json`, die im bestehenden Backup-Manager als `state`-Backup wiederhergestellt werden kann.
- **Guardrail**: Wenn Sync-Daten Ã¼berschrieben werden kÃ¶nnen, gehÃ¶rt der Fullbackup-/Restore-Pfad sichtbar und direkt neben die Sync-Aktion.

## 2026-06-12 â€” Bookmarks-Tab crashte mit `forEach`-Fehler
- **Symptom**: Im Bookmarks-Tab erschien `Cannot read properties of undefined (reading 'forEach')`, und die Liste blieb leer.
- **Root-Cause**: Durch eine Namenskollision existierten zwei globale Funktionen `renderBookmarkTable(...)`; die spÃ¤tere Sync-Variante Ã¼berschrieb die eigentliche Bookmark-Renderfunktion.
- **Fix**: Die Sync-Renderer-Funktion wurde auf `renderSyncBookmarkTable(...)` umbenannt und alle Sync-Aufrufe wurden entsprechend angepasst.
- **Guardrail**: In grossen Single-File-UIs keine generischen globalen Funktionsnamen wiederverwenden; domain-spezifische PrÃ¤fixe (`renderSync*`, `renderBookmark*`) konsequent beibehalten.

## 2026-06-12 â€” â€žVon Profil ladenâ€œ konnte im PROD-Store kein `public` laden
- **Symptom**: Im Tree-Builder zeigte der Import-Dialog Profile aus `lyrmgr.conf`, aber der Import von `public` schlug im PROD-Store fehl.
- **Root-Cause**: `load-lyrmgr` lief im DB-Modus standardmÃ¤ssig gegen den Katalog-Store; fehlte dort ein Profil-Dokument, kam `exists=false`, obwohl die Datei auf dem Server vorhanden war.
- **Fix**: `load-lyrmgr` unterstÃ¼tzt jetzt `source=file` (erzwingt File-Lesen), und der UI-Flow â€žVon Profil ladenâ€œ nutzt explizit `source=file`.
- **Guardrail**: File-Config-Workflows dÃ¼rfen im DB-First-Betrieb nicht implizit auf DB-Reads umbiegen; Quelle immer explizit im API-Call markieren.


---

## 2026-06-17 - Config-Editor: Maptips-Tab bei grossen Kuerzeln sehr langsam

- **Symptom**: Der Config-Editor wurde bei grossen Kuertzeln (z.B. `gis_basis`) im Maptips-Tab beim Laden und Filtern deutlich traege.
- **Root-Cause**: Pro Maptip-Eintrag wurden zusaetzliche versteckte Expand-Zeilen vorgerendert (hohe DOM-Menge). Der Filter lief bei jedem Keypress sofort ueber alle Zeilen. Zudem war der Change-Count O(n) ueber alle Inputs.
- **Fix**: Expand-Panels auf Lazy-Erzeugung umgestellt (erst bei Klick). Tabellenfilter auf debounce (140ms) und Search-Cache pro Datenzeile. Change-Count auf geaenderte Zellen (`td.et-changed`) umgestellt.
- **Guardrail**: In grossen Editor-Tabellen niemals versteckte Detailzeilen vorab fuer alle Eintraege rendern; Details immer lazy laden und Filtereingaben debouncen.

## 2026-06-17 - Config-Editor: Listener-Overhead bremst Sub-Tab-Wechsel

- **Symptom**: Wechsel zwischen Sub-Tabs (Layers, Maptips, etc.) blieb bei grossen Datenbestaenden deutlich traege.
- **Root-Cause**: Pro editierbarer Zelle wurden eigene `input`/`change`-Listener gebunden (sehr hohe Listener-Anzahl). Zusaetzlich machte der Filter pro Datenzeile teure Zusatz-Queries auf Expand-Zeilen.
- **Fix**: Editor auf delegierte Events am `#editor-tbody` umgestellt (ein zentraler Handler fuer `input`/`change`). Filter auf globale Expand-Zeilen-Behandlung umgebaut. Change-Count asynchron geplant statt synchron bei jedem Event.
- **Guardrail**: In grossen Grid-UIs nie Listener pro Zelle binden; immer Event-Delegation am Container verwenden und teure DOM-Queries aus inneren Schleifen entfernen.

## 2026-06-17 - Color-Picker im highlight_style blockiert Browser teilweise

- **Symptom**: Beim Bearbeiten von `highlight_style` (vor allem Farbfelder) wirkte der Browser teilweise haengend.
- **Root-Cause**: Der Color-Picker schrieb bei jedem `input`-Event sofort in den Datenstore (`onEditorCellChange`) und triggert dadurch viele teure Folgeupdates.
- **Fix**: Color-Picker auf zweistufiges Verhalten umgestellt: `input` nur Live-Vorschau im Textfeld, Persistenz erst bei `change`.
- **Guardrail**: Bei hochfrequenten UI-Quellen (Color-Picker, Slider) niemals jeden `input` sofort persistieren; immer Preview und commit-on-change trennen.

## 2026-06-18 - Runtime nutzte DB-Layer, aber nicht DB-Maptips/Highlight-Style

- **Symptom**: Trotz DB-Modus war geaenderter `highlight_style` erst nach Core-Deploy sichtbar.
- **Root-Cause**: `layers.php?source=db` lieferte im Katalogbaum keine `maptips`-Daten; die Runtime arbeitete weiter mit Legacy-`am.MapTips` aus Datei-Kontext.
- **Fix**: `layers.php` erweitert: DB-Query liefert `ld.maptips` und baut `node.maptips` in den Detail-Response. `TnetSyncMapTips()` merged pro Layer die DB-Maptip-Felder (inkl. `highlight_style`) in die Runtime-MapTips.
- **Guardrail**: Bei DB-First muss jede Runtime-Property (z.B. `highlight_style`) im API-Response enthalten UND in den laufenden Framework-State gespiegelt werden; sonst bleibt verdeckter Datei-Fallback aktiv.

## 2026-06-18 - Dispatch nutzte stale Runtime-Maptips trotz DB-Response

- **Symptom**: `highlight_style` blieb im Klick-Resultat alt, obwohl `layers.php?source=db` bereits DB-Maptips lieferte.
- **Root-Cause**: Vor dem Dispatch wurden `am.MapTips` nicht konsequent mit den DB-Maptip-Objekten überlagert; Legacy-Runtimewerte konnten aktiv bleiben.
- **Fix**: In `tnet-info-bridge.js` wird vor jedem Dispatch je MapTip ein DB-Match (`linked_layer` + `query_layers`/`nls`) gesucht und die relevanten Felder (`highlight_style`, `qryFields*`, `querytype`, etc.) in `am.MapTips` gespiegelt.
- **Guardrail**: Bei Framework-State mit langlebigen Objekten niemals auf initiale Belegung vertrauen; vor kritischen Aktionen (Dispatch/Klick) DB-Source erneut mergen.

## 2026-06-18 - Highlight blieb alt wegen internen Legacy-Cachefeldern

- **Symptom**: Trotz korrektem `highlight_style` in DB/API wurde auf der Karte weiterhin der alte Stil gezeichnet.
- **Root-Cause**: Das Framework rendert über interne Felder `highLightstyle` und `highlightProj`, nicht direkt über `highlight_style`/`highlight_geom_proj`.
- **Fix**: Beim DB-Merge in `tnet-mapplus-helpers.js` und `tnet-info-bridge.js` werden zusätzlich `mt.highLightstyle` und `mt.highlightProj` aus den DB-Werten gesetzt.
- **Guardrail**: Bei Legacy-Objekten immer prüfen, ob Render-Code interne Cache-/Alias-Felder nutzt; reine JSON-Feldupdates reichen sonst nicht.

## 2026-06-18 - DB-Maptips wurden wegen ID-Variante/Gross-Kleinschreibung nicht gefunden

- **Symptom**: Runtime zeigte weiterhin alten Style; Diagnose ergab bei betroffenen Maptips `db_count=0`.
- **Root-Cause**: `TnetLMStore.findLayer()` wurde nur exakt verwendet; Layer-IDs mit Varianten (Suffixe, Case-Unterschiede) lieferten keinen Treffer.
- **Fix**: Robuster Layer-Lookup in `tnet-mapplus-helpers.js` und `tnet-info-bridge.js`: Kandidatenliste (`_getLayerIdCandidates`) + lower/upper + case-insensitive Katalog-Scan als letzter Fallback.
- **Guardrail**: Bei Store-Lookups nie nur exakte ID-Matches annehmen; besonders bei OEREB/Coalesce IDs immer robuste Kandidaten-/Case-Strategie einsetzen.

## 2026-06-18 - Highlight blieb inkonsistent wegen gemischter Feldnamen

- **Symptom**: In Runtime war `highLightstyle` gesetzt, `highlight_style` aber leer; Highlight-Verhalten blieb inkonsistent.
- **Root-Cause**: Legacy-/Neu-Pfade verwenden unterschiedliche Property-Namen (`highLightstyle` vs. `highlight_style`).
- **Fix**: Beim DB-Merge werden in `tnet-mapplus-helpers.js` und `tnet-info-bridge.js` beide Feldnamen bidirektional auf denselben Stil synchronisiert.
- **Guardrail**: Bei Legacy-Objekten Alias-Feldnamen immer explizit gemeinsam pflegen, nicht nur einen Feldnamen setzen.

## 2026-06-18 - Runtime-Fix wirkte nicht wegen veralteter Script-Cachebuster

- **Symptom**: Konsole zeigte weiterhin altes Verhalten (`highlight_style` leer), obwohl JS-Dateien bereits gepatcht und deployt waren.
- **Root-Cause**: Entry-HTML referenzierte unveränderte `?v=`-Werte; Browser/CDN lieferte dadurch weiterhin alte Script-Stände.
- **Fix**: `index_de.htm` und `index_de_m.htm` auf neue Cachebuster für `tnet-mapplus-helpers.js` und `tnet-info-bridge.js` aktualisiert und neu deployt.
- **Guardrail**: Nach JS-Hotfixes immer auch die referenzierenden `?v=`-Parameter erhöhen, wenn aggressive Caches im Spiel sind.

## 2026-06-18 - OEREB-Mobile überschrieb Maptip-Highlight mit hartcodiertem Grün

- **Symptom**: Runtime zeigte korrekte `highlight_style`-Werte, visuell blieb das Highlight aber grün/falsch.
- **Root-Cause**: In `tnet-oereb.js` nutzte der Mobile-`OerebGraphics`-Layer einen fixen grünen OL-Style, unabhängig vom aktiven Maptip.
- **Fix**: OEREB-Highlight-Styles (Mobile + allgemeiner OEREB-Highlight-Layer) dynamisch aus aktivem OEREB-Maptip-Style aufgebaut, mit Framework-`getNewOLStyle()` und robustem Fallback.
- **Guardrail**: Bei OEREB-Overlays keine hartcodierten Farben verwenden; Style immer über Runtime-Maptip/Config ableiten.

## 2026-07-10 - ÖREB zeigt "Something went wrong!" trotz 200 bei extract/json

- **Symptom**: In `maps-dev` zeigt das ÖREB-Panel "Something went wrong!", obwohl `/oereb/extract/json?...details=true...` mit HTTP 200 und gültigem `Extract` antwortet.
- **Root-Cause**: Nicht der JSON-Request war defekt, sondern ein Laufzeitfehler im externen `graphicsLayer.js` (`Cannot read properties of null (reading 'switchLayer')`) beim Layer-Toggle im Parent-Kontext. Dadurch kippt der externe Viewer in sein generisches Error-Handling.
- **Fix**: In `tnet-oereb.js` einen Kompatibilitäts-Fallback für `AppManager.getLayerManagerByLayer(...)` eingebaut: Wenn `null` zurückkommt, wird auf `main_lyrmgr` (bzw. `<map>_lyrmgr`) mit `switchLayer()` zurückgefallen. Aktivierung beim Start des ÖREB-Modus.
- **Guardrail**: Bei ÖREB-Fehlern mit "Something went wrong!" zuerst Request/Response prüfen, dann zwingend Browser-Konsole auf Laufzeitfehler im externen Viewer kontrollieren. HTTP 200 allein bedeutet nicht, dass der Viewer-Endzustand gesund ist.

## 2026-07-10 - AGS-Proxy: sporadische 498 (Invalid Token) beim Karten-Nachladen

- **Symptom**: Beim Nachladen von Kacheln/Export über `agsproxy.php` kam gelegentlich `{"error":{"code":498,"message":"Invalid Token"}}` direkt im Browser an.
- **Root-Cause**: Token-Refresh ohne Single-Flight. Sobald der Token ins Safety-Skew-Fenster kam, holten viele parallele Requests gleichzeitig ein neues Token (Thundering Herd). Da `client=requestip` gebundene Tokens ausgibt, entwertete das Token-Churn kurz zuvor gebaute Requests → 498. Der einmalige, ebenfalls ungelockte Retry lief ins gleiche Race und reichte den 498 durch.
- **Fix**: In `maps-dev/agsproxy.php` und `maps/agsproxy.php` `getToken()` auf Single-Flight umgestellt (exklusiver `flock` auf `<cacheFile>.lock` + Double-Checked Read). 498-Retry auf Compare-and-Set + propagations-tolerante Backoff-Retries umgebaut (eine koordinierte Erneuerung, danach warten statt weiter generieren). Safety-Skew-Default von 60s auf 120s angehoben.
- **Tiefere Root-Cause (Nachtrag)**: Es gibt MEHRERE unabhängige Token-Erzeuger mit denselben Credentials (`mapplus-imp`): `agsproxy.php` und `legend-proxy.php` je in `maps` UND `maps-dev` — jeder mit eigenem `_token_cache`. Der Token-Service hält pro User nur EIN aktives Token; jede Erneuerung durch einen Consumer entwertet die Tokens aller anderen → dauerhaftes Cross-Instance/Cross-Consumer-Churn, das ein Single-Flight PRO Instanz nicht lösen kann.
- **Fix 2**: Gemeinsamer Token-Cache für ALLE Consumer mit gleichen Credentials: `agsproxy.php` und `legend-proxy.php` (maps + maps-dev) nutzen jetzt `/data/Client_Data/nwow/tmp/token_shared/arcgis_token_<md5(user|tokenUrl)>.json` mit gemeinsamem `.lock`. Dadurch existiert global genau EIN Token und EIN koordinierter Refresh. `legend-proxy.php` `agsGetToken()` ebenfalls auf Single-Flight (`agsFetchToken`) umgestellt.
- **Fix 3 (Propagation)**: Ein frisch generiertes Token ist auf einzelnen Backend-Knoten kurz noch nicht aktiv. Der 498-Retry wartet daher nach einem Refresh 150ms und macht bis zu 6 Versuche mit gedeckeltem Backoff (250ms..1000ms). Verifiziert: 120 gemischte Parallel-Requests (DEV+PROD) → 0×498 (vorher 5/30).
- **Guardrail**: Bei geteilten Backend-Credentials MÜSSEN alle Token-Consumer denselben Cache+Lock teilen (Cache-Pfad ausserhalb Docroot, Dateiname credential-abhängig). Single-Flight pro Instanz reicht nicht, wenn mehrere Instanzen/Skripte dieselben Credentials nutzen. Nach Token-Rotation immer propagations-tolerant retryen (kurz warten statt sofort neu generieren).
