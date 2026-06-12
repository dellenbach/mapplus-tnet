## 2026-06-11 — Sync-Bundles brachen an einer nicht vorhandenen notes-Spalte

- **Symptom:** Sync und Fullbackup schlugen mit `SQLSTATE[42703]` ab, weil `config_bundle_store.notes` in einem Schema nicht existierte.
- **Root-Cause:** Die Sync- und Backup-Abfragen selektierten `notes`, obwohl die aktuelle Tabelle `config_bundle_store` diese Spalte nicht hat.
- **Fix:** `notes` aus den Bundle-SELECTs entfernt und die Fullbackup-Ausgabe auf die tatsächlich vorhandenen Felder reduziert.
- **Guardrail:** Vor schemaübergreifenden SQL-Abfragen immer gegen das echte Tabellenschema prüfen; nur Felder lesen, die in allen Zielschemata vorhanden sind.

## 2026-06-11 — SLM zeigte im ausgeloggten Zustand keinen sichtbaren Login-CTA

- **Symptom:** Im SLM-Header erschien bei fehlender Anmeldung weder Benutzerinfo noch ein Login-Button; die Toolbar wirkte leer.
- **Root-Cause:** `slm.html` blendete nur den eingeloggten Benutzerbereich dynamisch ein, hatte aber keinen expliziten Fallback-CTA fuer den ausgeloggten Zustand.
- **Fix:** Statischen `Login`-Link im Header ergänzt und per JS sauber zwischen `Login` sowie Benutzer/`Abmelden` umgeschaltet; Redirect-URL wird dynamisch aus aktueller URL inkl. Hash aufgebaut.
- **Guardrail:** Bei Auth-abhängigen Headern immer beide Zustände explizit rendern: eingeloggter Zustand und ausgeloggter CTA.

## 2026-06-11 — Themenkatalog-Filter zeigte leere Oberknoten und kein klares Aktiv-Feedback

- **Symptom:** Bei aktivem Suchfilter blieben leere Gruppen/Subkategorien sichtbar; das Filterfeld war nicht klar als aktiv markiert.
- **Root-Cause:** Die Parent-Sichtbarkeit wurde über fragile CSS-String-Selektoren (`style*="display:none"`) bestimmt; dadurch wurden leere Oberknoten nicht zuverlässig ausgeblendet.
- **Fix:** Filterlogik auf robuste Sichtbarkeitsprüfung via direkte Kindknoten (`style.display !== 'none'`) umgestellt, aktive Filter-Markierung (`lm-search-active`) ergänzt und X-Button-Interaktion abgesichert.
- **Guardrail:** Bei Baumfiltern Parent-Sichtbarkeit immer daten-/zustandsbasiert berechnen (nicht über CSS-String-Matching), und aktiven Filterzustand visuell eindeutig kennzeichnen.

## 2026-06-11 — Kategorie-Icons zeigten keinen Hover-Text mit den gewünschten Aliasen

- **Symptom:** Beim Hover über die Kategorie-Icons im neuen Themenkatalog wurde kein bzw. kein gewünschter Alias-Text angezeigt.
- **Root-Cause:** In `tnet-lm-tree.js` wurden die Tabs/Icons ohne `title`-Attribut gerendert; dadurch war kein Browser-Tooltip vorhanden.
- **Fix:** Alias-Mapping pro Kategorie ergänzt und `title`/`alt` beim Rendern der Tab-Icons auf Alias (Fallback `cat.alias`/`cat.name`) gesetzt.
- **Guardrail:** Bei reinen Icon-Tabs immer explizit einen semantischen Tooltip (`title`) und einen aussagekräftigen `alt`-Text setzen.

## 2026-06-11 — DOM-Element entfernt aber addEventListener-Aufruf vergessen

- **Symptom:** Seite/iframe lädt nicht mehr, JS komplett stumm.
- **Root-Cause:** `document.getElementById('removed-btn').addEventListener(...)` wirft `TypeError: null` und crasht den gesamten Init-Block.
- **Fix:** Immer null-safe: `var btn = getElementById('x'); if (btn) btn.addEventListener(...)`.
- **Guardrail:** Beim Entfernen von HTML-Elementen immer grep nach dem `id=` im JS machen und alle Listener null-safe stellen.

## 2026-06-11 — Modaldialoge schliessen bei Text-Selektion in Input-Feldern

- **Symptom:** Beim Versuch, Text in Input/Textarea-Feldern eines Dialogs mit der Maus zu markieren, schloss sich der Dialog spontan.
- **Root-Cause:** Event-Bubbling: Clicks auf Input-Felder bubbelten bis zu Overlay-Click-Handlern, die den Dialog schlossen (obwohl die Handler korrekt `e.target === this` prüften, feuerte ein nachgelagerter Handler oder die Bubbling-Phase selbst das Close aus).
- **Fix:** Globaler Click-Handler (Capture-Phase) in `slm.html`, der auf alle `INPUT` und `TEXTAREA` Elemente `e.stopPropagation()` setzt, sodass Clicks in Formularfeldern nicht bis zu Modal-Handlern bubbelln.
- **Guardrail:** Bei Modal/Overlay-Patterns immer `event.stopPropagation()` auf Interaktionselementen setzen (Input, Buttons, Links); besonders wichtig bei dynamisch erzeugten Dialogen.

## 2026-06-10 — layers.php braucht StagingImportRepository-Require für echten DB-only Pfad

- **Symptom:** Fehlende Layer wurden in Karte/Preview weiterhin angezeigt, obwohl `source=db` aktiv war.
- **Root-Cause:** In `layers.php` fehlte `require_once StagingImportRepository.php`; der DB-Layer-Load warf `Class not found` und fiel still auf File-Definitionen zurück.
- **Fix:** `StagingImportRepository` explizit eingebunden und Missing-Filter im `processLayerItems`-Pfad auf DB-Definitionsbasis umgesetzt.
- **Guardrail:** Bei DB-first-Endpunkten Klasseneinbindung für alle Repository-Aufrufe validieren; Catch-Fallbacks dürfen Source-Drift nicht unbemerkt kaschieren.

## 2026-06-10 — Editor-Deploy braucht Auto-Export und robustes Git-Error-Mapping

- **Symptom:** „Kürzel nach core“ schlug mit „Bitte zuerst Export nach Temp“ ab bzw. zeigte bei Git-Fehlern nur „Unbekannter Fehler“.
- **Root-Cause:** Deploy-Flow setzte einen manuellen Vor-Export voraus und wertete Git-Fehlerantworten (`detail`) nicht aus.
- **Fix:** `exportEditorToCore()` startet nun bei fehlendem RunId automatisch `export-catalog-artifacts` und führt danach Deploy aus; Git-Fehlertexte werden aus `error/message/detail` extrahiert.
- **Guardrail:** In 2-Step-Flows den zweiten Schritt resilient machen (Auto-Vorbereitung) und Backend-Fehlerfelder vollständig auswerten.

## 2026-06-10 — Merge-Export darf Metadateien nicht als Fehler behandeln

- **Symptom:** „Kürzel mergen“ brach mit `Merge übersprungen (unbekannter Dateityp): .core-import-manifest_...json` ab.
- **Root-Cause:** `export-catalog-artifacts` wertete nicht-katalogische Bundle-Dateien (Manifest/Meta) als Merge-Fehler.
- **Fix:** Export filtert jetzt strikt auf die fünf Katalog-Präfixe (`layers`, `maptips`, `lyrmgrResources`, `maptipsResources`, `legendResources`) und überspringt Metadateien still.
- **Guardrail:** Merge-/Deploy-Pipelines nur auf fachliche Katalogartefakte anwenden; Hilfs-/Manifest-Dateien nie als harte Fehler in User-Flows behandeln.

## 2026-06-10 — Raw-Conf-Helper dürfen nicht innerhalb `getWritableRawConfDir()` definiert sein

- **Symptom:** Im SLM-Editor wurden plötzlich keine Quellen/Tags geladen (UI blieb bei 0/leer).
- **Root-Cause:** `rawConfSourceBuckets()/resolveRawConfServiceDir()/...` waren lokal in `getWritableRawConfDir()` definiert. Bei frühem Return (weil `RAW_CONF_DIR` bereits beschreibbar war) wurden diese Funktionen nie deklariert, spätere Aufrufe führten zu Fatal-Fehlern.
- **Fix:** Raw-Conf-Helfer auf Top-Level in `treebuilder-api.php` verschoben und aus `getWritableRawConfDir()` entfernt.
- **Guardrail:** In PHP keine global genutzten Helper-Funktionen innerhalb von Funktionen deklarieren, wenn es frühzeitige Return-Pfade gibt.

## 2026-06-10 — Create-Export schrieb weiter nach ags-import/raw-conf statt raw-conf

- **Symptom:** SLM Create meldete Exporte nach `tmp/maps-dev/ags-import/raw-conf/ags/` statt nach `tmp/maps-dev/raw-conf/ags/`.
- **Root-Cause:** `RAW_CONF_DIR` war in `treebuilder-api.php` noch auf `TnetTmpPaths::agsImport('raw-conf')` verdrahtet.
- **Fix:** `RAW_CONF_DIR` auf `TnetTmpPaths::getRoot() . '/raw-conf'` umgestellt, damit AGS/QGIS/Core-Create-Exporte direkt unter `tmp/maps(-dev)/raw-conf/...` landen.
- **Guardrail:** `raw-conf` und `ImportToCore` strikt getrennt halten: `raw-conf` liegt direkt unter dem Tmp-Root, nur `ImportToCore` bleibt im `ags-import`-Pfad.

## 2026-06-10 — Merge-Export im SLM braucht Dialog statt Browser-Prompt und deduplizierte Typ-Merges

- **Symptom:** Beim Klick auf „Kürzel mergen“ kam nur ein Browser-`prompt`; ausserdem konnten bei typbasiertem Merge doppelte Einträge in Listen entstehen.
- **Root-Cause:** Der Editor-Flow nutzte keinen eingebetteten Modal-Dialog, und der Merge-Writer führte für Listen nur ein stumpfes Anhängen durch.
- **Fix:** In `slm.html` wurde ein eigener Merge-Dialog (Overlay) mit Eingabefeld/Validierung ergänzt; in `treebuilder-api.php` merge`t `export-catalog-artifacts` assoziative JSONs key-basiert (letzter Wert gewinnt) und dedupliziert Listenwerte über Signaturen.
- **Guardrail:** Für SLM-Massnahmen keine Browser-Prompts verwenden; Merge-Exports müssen pro JSON-Typ deterministisch und ohne doppelte Keys/Einträge laufen.

## 2026-06-09 — source=db darf nicht im JSON-API-Cache hängen bleiben

- **Symptom:** Nach Live-DB-Publish im Tree-Builder waren Änderungen erst sichtbar nach Klick auf „Cache leeren“ im SLM.
- **Root-Cause:** `layers.php` nutzte auch im `source=db`-Modus den serverseitigen JSON-Cache mit TTL; DB-Updates invalidierten diesen Cache nicht sofort.
- **Fix:** In `layers.php` wird der JSON-Cache bei `source=db` automatisch gebypasst (`$bypassJsonCache = true`), sodass Runtime-Antworten unmittelbar aus der DB kommen.
- **Guardrail:** Für DB-first-Live-Workflows API-Response-Caches nur im File-Modus verwenden oder per DB-Revision invalidieren.

## 2026-06-09 — SLM-Cache muss store-spezifisch versioniert sein

- **Symptom:** Nach Deploy waren Änderungen erst sichtbar, nachdem der SLM-Cache manuell gelöscht wurde.
- **Root-Cause:** Tree-Builder nutzte einen globalen localStorage-Key ohne Store-Trennung und ohne Schema-Version; veralteter Zustand blieb aktiv.
- **Fix:** `tree-builder.html` verwendet jetzt store-spezifischen Key (`treebuilder_state_<env>`) plus Versionsmarker (`treebuilder_state_version_<env>`), der alten SLM-State automatisch invalidiert.
- **Guardrail:** Bei strukturellen Änderungen am Editor-State immer Version bumpen und nie denselben localStorage-Key für DEV/PROD teilen.

## 2026-06-09 — Alias-Save darf nicht nur auf nlsEdits vertrauen, und DB-Quelle darf nicht von Profil-Datei übersteuert werden

- **Symptom:** Trotz Klick auf „Live DB“ blieben Alias-Änderungen nach Reload/Runtime teilweise alt.
- **Root-Cause:** (1) Alias-Publish baute Payload primär aus `state.nlsEdits`; bei inkonsistentem UI-State blieb `__nlsAliases` leer. (2) `layers.php?source=db` merge-te zusätzlich Profil-`lyrmgrResources.json` und konnte DB-Aliase wieder überschreiben.
- **Fix:** Tree-Builder speichert Alias-Deltas zusätzlich aus `state.layerAliases` gegen `state.layerAliasesBase` und schreibt sie in `__nlsAliases`; `layers.php` lädt Profil-NLS-Dateien nur noch im Datei-Modus (`source=file`), nicht im DB-Modus.
- **Guardrail:** In DB-first muss `source=db` strikt dateifreie Alias-Autorität haben; Alias-Persistenz darf nie allein vom Pending-Edit-Cache abhängen.

## 2026-06-09 — Alles aus der DB: Editor, Karte und NLS-Aliases

- **Symptom:** Editor zeigte anderen Stand als Karte; Aliases gingen nach Reload verloren; Karte nutzte andere Persistenz als Editor.
- **Root-Cause:** Drei Datenpfade waren entkoppelt: (1) `catalog_document` (Tree-Builder) vs. `catalog_node` (Runtime), (2) NLS-Aliases nur als Datei, (3) `tnet-lm-store.js` nicht per Apache-Alias erreichbar (`/maps-dev/public/tnet/` fehlte).
- **Fix:** `layers.php?source=db` liest jetzt `catalog_document` (statt `catalog_node`); NLS-Aliases werden als `__nlsAliases`-Block im `catalog_document` gespeichert und von `layers.php` vor Core-NLS appliziert; Apache-Rewrite `.htaccess` in `public/` leitet `tnet/…` auf `/maps-dev/tnet/…` um; `publishLyrmgrDbNow()` schreibt Aliases automatisch nach DB-Publish.
- **Guardrail:** Bei DB-first immer prüfen ob Runtime-Endpoint, Editor-Publish und NLS-Pfade alle dieselbe Tabelle lesen. Publizierte Payload-Blöcke wie `__nlsAliases` müssen in `layers.php` nach der `$_nlsAliasesRuntime = []` Initialisierung neu eingespeist werden.


- **Symptom:** `slm.html#tab=treebuilder` zeigte weiterhin einen anderen Stand als Runtime, obwohl source bereits strikt auf `db|file` stand.
- **Root-Cause:** UI-Flow lud beim Profilwechsel/Init weiterhin Draft-first und speicherte Edits primär als Draft, während Publish zur DB separat manuell ausgelöst werden musste.
- **Fix:** Tree-Builder lädt jetzt standardmässig den publizierten Stand und triggert nach Save automatisch `publish-lyrmgr` in die DB (inkl. Live-Status in der UI).
- **Guardrail:** In DB-first-Workflows dürfen Editor-Speichern und Runtime-Quelle nicht durch Draft-first oder manuelle Zusatz-Publish-Schritte entkoppelt sein.

## 2026-06-09 — Bei Duplicate-ID darf der Container nicht vor spaeterem Leaf-Treffer zurückkehren
- **Symptom:** `Höhenlinien` blieb trotz Toggle ohne Kartenwirkung, obwohl ein renderbarer Layer mit derselben ID vorhanden war.
- **Root-Cause:** `_findLayerRecursive` merkte sich zwar die Leaf-Praferenz, gab aber pro Knoten sofort den Container-Fallback zurück, bevor später im Baum der gleichnamige Blatt-Layer gefunden wurde.
- **Fix:** Resolver auf globalen Fallback umgestellt: Leaf-Treffer sofort, Container nur merken und erst nach kompletter Schleife zurückgeben.
- **Guardrail:** Bei Mehrdeutigkeiten (Container+Leaf gleiche ID) nie innerhalb derselben Iteration früh auf Container zurückkehren; Fallback erst nach vollständiger Suche anwenden.

## 2026-06-09 — Container-Layer wie `.../hoehenlinien` muessen auf Blatt-Layer delegieren
- **Symptom:** `Höhenlinien` liess sich im Themenbaum ankreuzen, wurde aber nicht auf Karte/Karteninhalt wirksam.
- **Root-Cause:** Der geklickte Knoten war strukturell (mit Kind-Layern wie `/2m`, `/5m`, `/10m`) und selbst nicht direkt renderbar.
- **Fix:** `setLayerVisible()` behandelt Knoten mit Kindern als Container und schaltet stattdessen alle Blatt-Layer unter dem Prefix (`_setDescendantLeafLayersVisible`).
- **Guardrail:** Bei Legacy-Katalogen nie davon ausgehen, dass ein klickbarer UI-Eintrag ein renderbarer Blatt-Layer ist; Container-IDs muessen auf konkrete Child-IDs aufgeloest werden.

## 2026-06-09 — setLayerVisible muss Framework-Combined-Layer (show:) vor TnetLayerSwitch behandeln
- **Symptom:** Einzelne Layer liessen sich im Themenbaum ein-/ausschalten, blieben aber auf der Karte unveraendert oder tauchten nicht im Karteninhalt auf.
- **Root-Cause:** Fuer bestimmte Legacy-/Bookmark-Pfade rendert das Framework keinen dedizierten OL-Layer pro Thema, sondern einen kombinierten Dienst-Layer mit `LAYERS=show:...`. Der Standardpfad `TnetLayerSwitch` griff dort teilweise nicht belastbar.
- **Fix:** In `tnet-lm-store.js` wurde `setLayerVisible()` erweitert: vor dem Standard-`TnetLayerSwitch` wird `_setFrameworkCombinedSublayer(...)` ausgefuehrt. Bei Treffer werden Karte + Active-Liste direkt synchronisiert.
- **Guardrail:** Bei ArcGIS-Sublayern zuerst pruefen, ob bereits ein kombinierter `show:`-Layer aktiv ist; erst wenn das nicht zutrifft, auf Legacy-Switch-Funktionen zurueckfallen.

## 2026-06-09 — Themenkatalog darf bei gleicher ID nicht den Container statt Blatt-Layer aufloesen
- **Symptom:** Bestimmte Themen liessen sich im Baum ankreuzen, erschienen aber weder auf der Karte noch im Karteninhalt.
- **Root-Cause:** `findLayer` lieferte bei identischer ID teils den Container-Knoten (mit Kindern) statt des renderbaren Blatt-Layers; dadurch liefen Toggle-/Render-Pfade inkonsistent.
- **Fix:** In `tnet-lm-store.js` `_findLayerRecursive` auf echte Blatt-Erkennung umgestellt (Kinder-Arrays als Kriterium), Container nur noch als Fallback.
- **Guardrail:** Bei Legacy-Katalogen mit doppelten IDs (Wrapper + Leaf) immer zuerst echte Blatt-Layer aufloesen; Knotentypen allein sind kein verlässliches Leaf-Kriterium.

## 2026-06-09 — Public-Profil: Runtime darf nicht am Legacy-DB-Baum vorbeiziehen
- **Symptom:** Im public-Profil zeigte die Kartenapp einen anderen Themenbaum als der Tree-Builder, obwohl publiziert war.
- **Root-Cause:** `layers.php?source=auto` bevorzugte den Legacy-DB-Pfad (`catalog_node`), waehrend Tree-Builder/Publish den Profil-Dokumentpfad (`CatalogRepository`) aktualisiert.
- **Fix:** In `layers.php` wird bei aktivem `configSource.catalog=db` im Auto-Modus der Legacy-DB-Pfad uebersprungen, sodass der Runtime-Read konsistent ueber `CatalogRepository::loadProfile()` laeuft.
- **Guardrail:** Bei DB-first immer sicherstellen, dass Runtime-Read und Editor-Publish dasselbe Persistenzmodell verwenden; Mischbetrieb nur explizit und kontrolliert zulassen.

## 2026-06-09 — UI-Zeitstempel in lokaler Fachzeitzone anzeigen
- **Symptom:** Änderungszeitpunkte wurden als UTC/ISO angezeigt und wirkten fachlich zeitversetzt.
- **Root-Cause:** Frontend zeigte `updatedAt`-Werte direkt aus ISO-Strings ohne Zeitzonen-Formatierung.
- **Fix:** Im Tree-Builder wurde `formatSwissDateTime(..., Europe/Zurich)` zentral eingeführt und für Objekt-/LyrMgr-Metadaten sowie Draft-Statusmeldungen verwendet.
- **Guardrail:** Persistenz darf UTC bleiben, aber Benutzeranzeigen mit Datumsbezug immer explizit in der Zielzeitzone formatieren.

## 2026-06-09 — Datei-Publish muss bei DB-first den DB-Stand mitziehen
- **Symptom:** Nach Klick auf „Publish lyrmgr.conf“ blieb der Themenkatalog in der Kartenapp unverändert/alt.
- **Root-Cause:** Der Datei-Publish-Pfad hat DB-Publish übersprungen, während Runtime standardmässig DB-first (`catalog: db`, `lyrmgrSource: api`) liest.
- **Fix:** `publishLyrmgr('file')` führt jetzt ebenfalls `publish-lyrmgr` (DB-Sync) aus und danach wie bisher den Datei-Deploy.
- **Guardrail:** In DB-first-Setups darf ein sichtbarer Publish-Button nicht nur Nebenpfade (Datei) aktualisieren, wenn die Runtime aus der DB liest.

## 2026-06-09 — Move-Aktionen müssen Objekt-Metadaten explizit anfassen
- **Symptom:** Nach Layer-Verschiebungen blieben „Letzte Änderung“-Felder leer oder unverändert.
- **Root-Cause:** Metadaten wurden nur bei Eigenschafts-/Alias-Änderungen gesetzt, nicht bei DnD-Moves.
- **Fix:** Bei DnD-Einfüge-/Reorder-Pfaden werden jetzt betroffene Layer/Gruppen über `touchNodeEditMeta` bzw. `touchMovedItemsMeta` aktualisiert.
- **Guardrail:** Jede fachliche Mutation (inkl. Reihenfolge/Verschiebung) muss denselben Änderungs-Tracking-Pfad auslösen wie Property-Edits.

## 2026-06-09 — Objekt-Metadaten dürfen nicht aus globalem Publish-Meta gelesen werden
- **Symptom:** In den Objekt-Eigenschaften (Layer/Kategorie/Gruppenlayer) wurde überall derselbe „Letzter Publish“-Wert angezeigt.
- **Root-Cause:** Die UI nutzte für Objekt-Tooltips und Properties das globale LyrMgr-Meta (`_metaInfo.updatedBy/updatedAt`) statt objektbezogene Änderungsmetadaten.
- **Fix:** Im Tree-Builder wurde ein objektbezogener Metadaten-Store (`nodeEditMeta`) eingeführt; Änderungen an Layer/Kategorie/Gruppenlayer aktualisieren nun gezielt `updatedBy/updatedAt`, und die Dialoge/Tooltips zeigen diese Werte an. Globaler Publish bleibt auf LyrMgr-Ebene.
- **Guardrail:** Änderungszeitpunkte immer auf Ebene des tatsächlichen Entitäts-Keys speichern und darstellen; Publish-Metadaten nie als Ersatz für Objekt-Historie verwenden.

## 2026-06-09 — Kartenapp muss API-Aufruf explizit auf DB-first setzen
- **Symptom:** Trotz DB-first-Konfiguration zeigten Kartenapp und SLM teilweise unterschiedliche Katalogstände.
- **Root-Cause:** Der Kartenapp-Store rief `layers.php` ohne expliziten `source`-Parameter auf; damit hing das Verhalten implizit am Backend-Default statt am klaren DB-first-Pfad.
- **Fix:** `tnet-lm-store.js` ergänzt den API-Call um `source=auto`, damit DB bevorzugt und Datei nur als Fallback genutzt wird.
- **Guardrail:** Für produktive Quellwahl nie auf implizite Defaults verlassen; die gewünschte Autorität (`db`/`auto`/`file`) im Request immer explizit setzen.

## 2026-06-09 — Publish muss dieselbe Laufzeitquelle bedienen wie layers.php
- **Symptom:** Nach Draft/Publish waren Änderungen im Tree-Builder sichtbar, aber nicht im Live-Themenkatalog der App.
- **Root-Cause:** `layers.php?source=auto` lieferte bevorzugt Daten aus dem DB-Knotenmodell (`catalog_node`), während Tree-Builder-Publish in `catalog_document`/Datei schrieb; dadurch blieb die Laufzeitansicht auf altem Stand.
- **Fix:** `layers.php` liest bei aktivem `configSource.catalog=db` zuerst das veröffentlichte Katalog-Dokument aus `CatalogRepository::loadProfile()` und nutzt Datei nur als Fallback.
- **Guardrail:** Bei DB-first niemals verschiedene Persistenzmodelle (Node-DB vs. Document-DB) unkoordiniert parallel bedienen; Runtime-Endpoint und Editor-Publish müssen auf dieselbe Autoritätsquelle zeigen.

## 2026-06-09 — Multi-Editing Drafts müssen in DB liegen und Publish braucht Dual-Pfad
- **Symptom:** Draft wirkte nach Reload/zwischen Bearbeitern instabil; nach Publish war der Themenkatalog teils nicht im erwarteten Datei-Pfad sichtbar.
- **Root-Cause:** `save/load-lyrmgr-draft` war nur dateibasiert (`tmp/layertree`), während Runtime DB-first ist; Publish lief blockweise in DB, aber ohne expliziten Full-File-Deploy-Schritt.
- **Fix:** Draft auf DB-Storage umgestellt (`<profile>__draft` via `CatalogRepository`), inklusive Metadaten (`updatedBy/updatedAt/revision`) bis ins UI; Publish führt jetzt DB-Publish plus zusätzlichen `publish-lyrmgr-full` Datei-Deploy (Best-Effort) aus.
- **Guardrail:** In DB-first Workflows Entwurf und Publish-Endpfad nicht auf verschiedene Persistenzkanäle verteilen, ohne explizite Synchronisationsschritte und sichtbare Statusmeldungen.

## 2026-06-09 — Inline-Themennamen (Alias) sind NLS-Edits und müssen separat persistiert werden
- **Symptom:** Nach Bearbeiten eines Kategorienamens im Tree-Builder wirkte es wie „nicht gespeichert“: in DB-Block/Export war die Änderung nicht sichtbar.
- **Root-Cause:** Inline-`cname` schreibt bewusst NLS-Aliase (`state.nlsEdits`/`state.layerAliases`), nicht den strukturellen `lyrmgr.conf`-Key. Diese NLS-Daten wurden in `getStateToPersist()` und `generateJSON()` bisher nicht mitgeführt.
- **Fix:** Persistenz erweitert (`layerAliases`, `layerPropEdits`, `nlsEdits`) und JSON-Export um `aliases` + `nlsEdits` ergänzt; File-Import liest diese Felder nun ebenfalls ein.
- **Guardrail:** In UI-Flows strikt trennen zwischen Struktur-Änderung (lyrmgr) und Label-Änderung (NLS). Wenn beides editierbar ist, müssen Backup/Restore beide Datenkanäle enthalten.

## 2026-06-08 — Publish darf im DB-Mode nicht an Dateirechten scheitern
- **Symptom:** Im Tree-Builder wurde "Speichern" erfolgreich angezeigt, aber "Publish" brach ohne wirksame Übernahme ab.
- **Root-Cause:** `publish-lyrmgr` scheiterte beim Schreiben von `maps-dev/public/config/lyrmgr.conf` (Permission denied) und beendete den Ablauf vor dem DB-Write.
- **Fix:** `publishLyrmgrBlock()` in `treebuilder-api.php` auf robustes DB-first angepasst: bei aktivem DB-Mode ist Dateischreiben Best-Effort; DB-Publish läuft weiter und liefert Erfolg (mit Warning bei File-Fehler).
- **Guardrail:** In DB-first-Konfigurationen Dateiexport nie als harte Voraussetzung für Publish behandeln; Dateifehler als Warnung führen, DB-Write als Primärerfolg werten.

## 2026-06-08 — Tree-Builder muss Kategorienreihenfolge gegen Runtime-API synchronisieren
- **Symptom:** Im Editor war die Reihenfolge (z.B. `bau, ...`) anders als im Live-Themenkatalog (`grundlagen, oereb, ...`), obwohl beide aus demselben Profil kamen.
- **Root-Cause:** Tree-Builder übernahm beim Laden die Reihenfolge aus dem rohen `lyrmgr.conf`-Block, Runtime aber aus `layers.php` (DB/API). Bei driftenden Quellen entstand ein sichtbarer Reihenfolge-Mismatch.
- **Fix:** Beim Profil-Laden wird die Editor-Reihenfolge jetzt gegen `layers.php?group=<profil>&source=auto` abgeglichen und anhand der bestpassenden Runtime-Topkategorie (höchster ID-Overlap) neu sortiert.
- **Guardrail:** Für die Editor-Darstellung immer dieselbe Autoritätsquelle wie die Runtime verwenden; reine `rawBlock`-Reihenfolge nicht als alleinige UI-Wahrheit behandeln.

## 2026-06-08 — Tree-Builder Export: raw structure als Array muss per _key aufgeloest werden
- **Symptom:** Nach Speichern/Publizieren war die Reihenfolge im Editor wieder falsch bzw. instabil.
- **Root-Cause:** `generateLyrmgrConfBlock()` hat bei `rawBlock.structure` im Array-Format (`[{ _key, ... }]`) weiterhin nur `rawStructure[catKey]` geprueft. Dadurch wurde das Originalformat nicht erkannt und teils wieder Objekt-Format geschrieben, was Reihenfolge-Drift beguenstigt.
- **Fix:** Raw-Kategorie wird jetzt formatunabhaengig gefunden (Array via `_key`/`name`/`key`, sonst Objektzugriff). Ohne Referenz wird bewusst Array-Format verwendet, damit die Reihenfolge stabil bleibt.
- **Guardrail:** Bei Object->Array-Migrationen nie Key-Indexzugriff gegen Arrays verwenden; Strukturtyp immer explizit behandeln und fuer Reihenfolge-kritische Daten Array als Default bevorzugen.

## 2026-06-08 — Themenkatalog: `lyrmgrSource: 'file'` kann nach Array-Migration numerische Kategorien erzeugen
- **Symptom:** Nach Publish zeigt der Themenkatalog Einträge wie `0`, `9` statt Fachkategorien; Darstellung wirkt kaputt.
- **Root-Cause:** Runtime lief mit `layerManager.lyrmgrSource = 'file'`. Der File-Pfad interpretierte die neue Array-Structure der `lyrmgr.conf` nicht korrekt und erzeugte numerische Kategorie-IDs/-Namen.
- **Fix:** Runtime auf DB/API umgestellt (`lyrmgrSource: 'api'` in `tnet-global-config.json5`). Damit kommt die Hierarchie aus dem DB/API-Pfad und die Kategorienamen sind korrekt.
- **Guardrail:** Nach Strukturänderungen im LyrMgr-Format (Object→Array) `source=file` nur verwenden, wenn der File-Parser nachweislich angepasst ist; sonst API/DB als führende Quelle erzwingen.

## 2026-06-08 — Publish-Dialog: HTML-Listen dürfen nicht in ein <p>-Wrapper gerendert werden
- **Symptom:** Beim Publish war der Bestätigungsdialog sichtbar, aber Buttons wirkten „weg“/nicht bedienbar bei langen Diff-Listen.
- **Root-Cause:** `_tbConfirm`/`_tbAlert` renderte den Inhalt pauschal in `<p>...</p>`. Der Publish-Text enthält `<ul><li>...`, was invalides HTML im `<p>` erzeugt und das Dialog-Layout bricht.
- **Fix:** Dialog-Message auf eigenen Block-Container (`.tb-confirm-msg`) umgestellt, scrollbar gemacht und Buttons im Footer fix sichtbar gehalten.
- **Guardrail:** Dialoge mit HTML-Content nie in `<p>` wrappen; stattdessen dedizierten Content-Container mit kontrolliertem Overflow nutzen.

## 2026-06-08 — Tree-Builder: Reihenfolge darf nicht aus lokalem Browser-State vor Server-Laden gerendert werden
- **Symptom:** Kategorien erschienen im Editor in alter/falscher Reihenfolge (z.B. BAU zuerst), obwohl API/DB bereits korrekt `_key`-Array-Reihenfolge lieferten.
- **Root-Cause:** Beim Init wurde `loadState()` aus localStorage zuerst gerendert (`_hasLyrmgrs`), und der veraltete Browser-Stand überdeckte den aktuellen Server-Stand.
- **Fix:** Init auf server-first umgestellt: beim Start immer `loadLyrmgrForProfile(..., true)` laden, lokalen Snapshot nicht mehr direkt als Primärquelle rendern.
- **Guardrail:** Bei DB-first/Server-first UIs lokalen Zustand nur als Fallback nutzen, nie als initiale Autoritätsquelle vor dem ersten Server-Load.

## 2026-06-08 — Tree-Builder: Profil-gefilterte Layer + Tag-Filter statt Konfigdatei-Filter
- **Symptom:** Der Tree-Builder zeigte alle Layer unabhängig vom Profil, und der Dropdown-Filter listete Konfig-Dateinamen (z.B. `geodienste/layers_geodienste.conf (48)`) statt der fachlichen Tags.
- **Root-Cause:** `listAllLayers` hängte keine Tags an die Layer, und das Frontend baute den Filter aus `sourceFile`. Profil-Bundles fremder Profile wurden nur unvollständig gefiltert.
- **Fix:** Backend hängt jetzt `tags`/`scope`/`kuerzel` pro Layer an und zeigt Profil-Scope-Bundles nur beim exakt passenden Profil (core/sitecore immer). Frontend: Dropdown „Alle Tags", Filter matcht gegen `layer.tags`.
- **Guardrail:** Im DB-Overlay Bundle-Metadaten (Tags/Scope/Profil) in den `sourceMap` je Layer übernehmen, sonst stehen sie in der flachen Layer-Liste nicht zur Verfügung. Profil-Filter exakt (`bProfile === profile`) prüfen, nicht nur „ungleich und gesetzt".

## 2026-06-08 — Scope-bewusster Export: Stufe bestimmt das Zielverzeichnis
- **Symptom:** Der Export schrieb alle Bundles pauschal nach core-dev/config + core-dev/nls, unabhängig von der gewählten Überladungsebene.
- **Root-Cause:** `configExportToCoreDb` kannte nur die Core-Zielpfade und ignorierte das neue `scope`/`profile`-Feld.
- **Fix:** Export wählt das Ziel jetzt nach Scope: `core` → core-dev/config + core-dev/nls/de, `sitecore/override` → maps-dev/core/config + maps-dev/core/nls/de, `profile` → maps-dev/public/config/<profil>/ (conf + nls zusammen). Profil-Ordner werden bei Bedarf angelegt. Bundle-Liste + Admin-Export-Tabelle zeigen die Stufe (scope[:profil]).
- **Guardrail:** Export-Ziele immer aus dem gespeicherten Scope ableiten, nicht hartkodieren. Profil-Bundles ohne Profilnamen beim Export ablehnen, damit nichts versehentlich in den falschen (Core-)Pfad geschrieben wird.

## 2026-06-08 — Konfig-Store: Stufe (Scope) beim Import + DB-only Tree-Builder + Accordion-Liste
- **Symptom:** Import-UI sprach von „Zusammenführen" statt „Importieren", es fehlte die Überladungsebene, der Tree-Builder mischte noch Datei-Quellen, und die rechte Store-Liste war durch einen Tag-Block + immer offene Detailzeilen unübersichtlich.
- **Root-Cause:** Scope war im Datenmodell zwar vorbereitet, aber nicht in Stage-Pfad/UI durchgereicht; `listAllLayers` las weiter Dateien; die rechte Liste hatte keine Accordion-Kapselung.
- **Fix:** `saveBundle`/`stageServicesToImportDb`/`ags-stage-merge` reichen jetzt `scope` (core/sitecore/profile) und `profile` durch. Import-UI: Button „📥 Importieren", Stufen-Dropdown + bedingtes Profilfeld. `listAllLayers` ist DB-only (Datei-Lesen nur Fallback bei leerer/fehlender DB). Rechte Seite: Tag-Übersichtsblock entfernt, jedes Kürzel als zugeklapptes Accordion mit Stufe-Badge.
- **Guardrail:** Scope/Profile bei jeder Stage-Operation explizit mitführen und beim Re-Stage aus dem bestehenden Bundle erben, sonst „rutscht" ein Dienst beim erneuten Import auf die Default-Stufe core zurück.

## 2026-06-08 — Tree-Builder DB-first über Datei-Basis: Überladungskonzept (core/override/profile) in DB
- **Symptom:** Import/Editor waren DB-first, der Tree-Builder las „Verfügbare Layer" weiter nur aus Core-Dateien — gestagte DB-Inhalte erschienen erst nach Export.
- **Root-Cause:** `listAllLayers()` baute Definitionen ausschliesslich aus `core/config` + Override + Profil-Dateien. Im `config_bundle_store` lagen nur die gestagten Kürzel, nicht die 5850 Core-Layer — ein naives „nur DB" hätte den Tree-Builder geleert.
- **Fix:** `config_bundle_store` additiv um `scope` (core/override/sitecore/profile) und `profile` erweitert. `listAllLayers()` liest weiter die Datei-Basis und legt danach die DB-Bundles scope-priorisiert (core < override < profile, DB gewinnt) darüber — sowohl Layer-Definitionen als auch `lyrmgrResources`-Aliase. So gehen die Datei-Layer nie verloren, DB-Inhalte sind aber sofort sichtbar.
- **Guardrail:** „DB-first" bei teilbefüllter DB nie als „nur DB" implementieren. Datei-Basis behalten und DB als priorisiertes Overlay darüberlegen, bis der Core vollständig in der DB liegt. Scope-Hierarchie additiv im Schema abbilden, nicht destruktiv umbauen.

## 2026-06-08 — 403 (keine Admin-Berechtigung) nicht als Session-Ablauf fehlinterpretieren
- **Symptom:** Auch nach Hard-Reload, Abmelden und erneutem Login erschien im SLM hartnäckig „Fehler: Bitte einloggen (Session abgelaufen)".
- **Root-Cause:** Der globale Auth-Fetch-Wrapper behandelte **jeden** HTTP 403 als Login-Problem. Da der eingeloggte Nicht-Admin-User (`del`) admin-geschützte Actions (z.B. `staging-delete-output`, `staging-delete-tag`, `config-export-to-core`) auslöste, kam ein legitimes 403-JSON zurück, das fälschlich als abgelaufene Sitzung dargestellt wurde.
- **Fix:** Wrapper unterscheidet jetzt: Nur 401, Redirect auf `admin-login` oder eine echte HTML-Login-Seite lösen den Login-Banner aus. Ein 403 mit JSON-Body (Berechtigungsfehler) wird unverändert durchgereicht, sodass die echte Fehlermeldung („Nur für Administratoren") ankommt.
- **Guardrail:** Auth-Wrapper niemals 401 und 403 gleich behandeln. 401 = nicht authentifiziert (Login nötig); 403 = authentifiziert, aber nicht berechtigt (kein Login-Redirect, echte Fehlermeldung zeigen).

## 2026-06-08 — Konfig-Store Import-Tab: Tags statt Konflikte, Re-Stage server-seitig, tag-bewusstes Löschen
- **Symptom:** Der Import-Tab zeigte kürzelübergreifende Keys als rote „Konflikte", Re-Stage füllte nur die linke Seite vor, und Löschen war nur ganz-Kürzel ohne Redundanz-Schutz.
- **Root-Cause:** Das Modell war rein Kürzel-zentriert; geteilte Ressourcen wurden als Fehler statt als gewollte Mehrfach-Nutzung interpretiert.
- **Fix:** Auf bestehendem `config_bundle_store` (nicht-destruktiv) eine Tag-Schicht ergänzt: `addTag`/`removeTagEverywhere` im Repository, API-Actions `staging-restage`/`staging-add-tag`/`staging-delete-tag`, Tags bleiben bei Re-Stage erhalten. Frontend: Tag-Übersicht mit letztem Import/Re-Stage (Datum/User), 1-Klick-Server-Re-Stage, geteilte Keys als „geteilt/merged" statt rotem Konflikt, Tag-Chips mit Add, tag-bewusstes Löschen (letzter Tag → Ressource endgültig weg).
- **Guardrail:** Bei produktiven Konfig-Datenmodellen Tag-/Dedup-Funktionen additiv auf die bestehende Tabelle setzen, statt Export-/Editor-/Verlink-Pipelines destruktiv umzubauen — besonders ohne Bestätigung des Users.

## 2026-06-08 — Editor-/Lock-Namen aus dem Login ableiten, nicht per Prompt erzwingen
- **Symptom:** Trotz aktivem Login erschien beim Bearbeiten ein Browser-Prompt für „Name/Kürzel“, was redundant und störend war.
- **Root-Cause:** SLM und Tree-Builder führten ihren Bearbeiternamen getrennt in localStorage und fragten per `prompt()`, statt zuerst den eingeloggten Benutzer zu übernehmen.
- **Fix:** Login-Benutzer wird jetzt in SLM und Tree-Builder als gemeinsamer Editorname gespeichert und wiederverwendet; der Prompt bleibt nur noch als Fallback ohne Login-Kontext.
- **Guardrail:** Wenn eine Sitzung bereits authentifiziert ist, keine zweite Benutzeridentität im Frontend abfragen. Locking- und `updated_by`-Namen immer zuerst aus dem Login ableiten.

## 2026-06-08 — Export-Preview-Dialog im SLM kann fachlich mehr stören als helfen
- **Symptom:** Beim Export aus dem SLM erschien ein separater Deploy-Dialog, der im Alltag keinen Zusatznutzen brachte und bei leeren/unklaren Zuständen nur Verwirrung erzeugte.
- **Root-Cause:** Der Exportpfad war auf einen ausführlichen Confirm-Modal mit Dry-Run-Vorschau aufgebaut, obwohl der Benutzer den Export bewusst bereits über die Hauptaktion auslöst.
- **Fix:** Den aktiven Exportpfad auf direkten Deploy mit Statusmeldungen umgestellt; nur einfache Browser-Bestätigungen bleiben bei Mehrfach-Deploys oder ungespeicherten Änderungen erhalten.
- **Guardrail:** Für häufige Admin-Aktionen keine zweite komplexe Modal-Stufe einbauen, wenn dieselbe Information auch als Statusmeldung genügt. Zusätzliche Dialoge nur behalten, wenn sie echte Entscheidungsrelevanz liefern.

## 2026-06-08 — Sensible Konfig-DB-Aktionen nur über dedizierte Admin-Steuerseite ausführen
- **Symptom:** Ein global sichtbarer Toolbar-Button `Config → DB` suggerierte einen harmlosen Klick, obwohl dahinter potenziell destruktive Import-/Export-Aktionen mit Überschreiben und Löschen stehen.
- **Root-Cause:** Die Aktion war zu nah an der Alltags-UI platziert und nicht granular von Admin-Rechten oder einer separaten Bestätigungsoberfläche entkoppelt.
- **Fix:** Den Button nur für Admins sichtbar gemacht, auf eine separate Seite `config-db-admin.html` umgebogen und Import, Export sowie DB-Löschen dort getrennt mit Warnhinweisen umgesetzt. Serverseitig sind `admin.php`, `config-db-admin.html`, `config-export-to-core` und `staging-delete-output` zusätzlich auf Admin-Rechte gehärtet.
- **Guardrail:** Destruktive oder überschreibende Konfig-Aktionen nie als normale Toolbar-Schnellaktion für alle Benutzer anbieten. Immer separaten Admin-Einstieg plus serverseitige Rollenprüfung verwenden.

## 2026-06-08 — Export-Dialog darf keine Core-Export-Sprache mehr tragen
- **Symptom:** Im SLM blieb ein Modal mit Texten wie „Nach core-dev exportieren“ sichtbar und vermittelte weiter einen Files-/Core-Export statt einer DB-zentrierten Konfig-Operation.
- **Root-Cause:** Die sichtbaren Button- und Modal-Titel wurden noch aus der alten DB→Files→Core-Semantik gebaut.
- **Fix:** Die Beschriftungen wurden auf „Konfig-Store erzeugen“ umgestellt und die Modal-Titel sprechen nun nur noch von der Konfig-Store-DB bzw. `core-dev` als Zielstruktur.
- **Guardrail:** Bei DB-first-UIs keine historischen Export-Begriffe in primären Aktionen oder Modaltiteln stehen lassen; sonst wirkt die Oberfläche fachlich falsch, obwohl der Backend-Pfad schon umgestellt ist.

## 2026-06-04 — Naiver Regex-JSON5-Parser zerstoert String-Werte mit "wort:" oder Quotes
- **Symptom:** `configSource.bookmarks: 'db'` aus `tnet-global-config.json5` griff nicht; `bookmarks-load` lieferte trotz korrekt deployter Config und erreichbarer DB weiter `source: files`.
- **Root-Cause:** Der Regex-basierte JSON5->JSON-Konverter (kopiert aus cache.php) transformiert Kommentare/Keys/Quotes ohne String-Bewusstsein. Der `_description`-Wert "Datenquelle pro Konfigurationsdomain: db oder files" wurde durch den Unquoted-Key-Schritt zu `..."Konfigurationsdomain": db...` zerschossen → `json_decode` = null → leeres Array → `default: 'files'`. Eingebettete Single-Quotes (`'db'`) brachen es zusaetzlich.
- **Fix:** In `ConfigSource.php` einen string-bewussten Single-Pass-Tokenizer (`json5ToJson()`) implementiert: Strings werden als Tokens gesichert, Kommentar-/Key-/Trailing-Comma-Transformationen laufen nur ausserhalb von Strings, danach Tokens zuruecksetzen. Zusaetzlich `_description` entschaerft.
- **Guardrail:** JSON5 nie mit reinen Regex-Passes nach JSON wandeln. Immer string-bewusst tokenisieren, sonst brechen Werte mit `wort:`, URLs (`http://`) oder eingebetteten Quotes das Parsing — und der Fehler ist still (Fallback auf Defaults).

## 2026-06-09 — Tree-Builder/Vorschau duerfen bei strict source nicht mehr mit `source=auto` arbeiten
- **Symptom:** In `slm.html#tab=treebuilder` wirkte der gezeigte Themenstand anders als in der Runtime-App.
- **Root-Cause:** Tree-Builder und `dev-test.html` verwendeten weiterhin `source=auto`, waehrend `layers.php` nur noch explizit `source=db|file` akzeptiert und die Runtime bereits strikt auf DB konfiguriert ist.
- **Fix:** `tree-builder.html` und `dev-test.html` auf explizites `db|file` umgestellt; Default auf `db`, inkl. Runtime-Reorder-Call (`syncEditorOrderWithRuntime`) mit `source=db`.
- **Guardrail:** Sobald ein Endpoint `auto` entfernt, alle abhängigen Frontends (auch interne Preview-Tools) gleichzeitig auf explizite Quellen umstellen.

## 2026-06-03 — Coalesce-Requests muessen pro Dienst konsolidiert werden, nicht pro Pfad-Container
- **Symptom:** Bei Agglomeration wurden mehrere Export-Requests an denselben ArcGIS-Dienst (`gis_fach/nw_agglomeration/MapServer`) geschickt, obwohl alle Sublayer aus EINEM Dienst stammen.
- **Root-Cause:** `_extractRootKey()` in der Coalesce-Bridge leitete den Root-Key aus dem Pfad-Parent (`lastIndexOf('/')`) ab. Dadurch wurde jeder Karten-Container (karte03_*, karte05_*, …) zu einem eigenen Root-Layer mit eigener Source → ein Export-Request pro Container.
- **Fix:** `_extractRootKey()` loest den Root-Key jetzt zuerst aus der Coalesce-Gruppe des Stores auf (`getCoalesceInfo(sublayerKey).groupId`). Alle Sublayer eines Dienstes landen unter einem Root-Key → ein OL-Layer mit kombiniertem `LAYERS=show:2,3,4,...`. Pfad-Parent bleibt nur Fallback fuer Dienste ohne Coalesce-Index.
- **Guardrail:** Coalesce-Konsolidierung immer an der tatsaechlichen Dienst-/Service-Identitaet (serviceUrl bzw. Coalesce-groupId) festmachen, nie an der ID-Pfadtiefe. Sublayer-Nummern sind innerhalb eines MapServers global eindeutig und duerfen in EINEM `show:` zusammengefasst werden.

## 2026-06-03 — Strukturelle Parent-Layer muessen im Karteninhalt bei aktiven Kindern ausgeblendet werden
- **Symptom:** In Agglomeration erschien zusaetzlich ein Parent-Layer als eigene Zeile (z.B. `.../karte05_motorisierter_individualverkehr_miv`) mit eigener Deckkraft, wodurch Gruppen-Opacity nur teilweise wirkte und Rendering unklar wurde.
- **Root-Cause:** Der Container-Filter verließ sich nur auf Katalog-Metadaten (`type/groups/layers/...`). Einige strukturierende Parent-IDs wurden dabei nicht als Container erkannt, obwohl gleichzeitig Kind-Layer mit demselben Prefix aktiv waren.
- **Fix:** `pruneContainerCatalogLayers()` filtert jetzt zusaetzlich alle IDs heraus, die strukturelle Prefix-Parent-IDs aktiver Kind-Layer sind.
- **Guardrail:** Bei Legacy-Katalogen Container-Erkennung nie nur an Knotentypen festmachen; Prefix-basierte Parent/Child-Beziehungen als zweite Schutzschicht nutzen.

## 2026-06-03 — Z-Index-Sync muss sich an Bookmark-/TOC-Reihenfolge orientieren, nicht an instabiler Active-Liste
- **Symptom:** Trotz Z-Index-Sync lagen in Agglomeration einzelne Dienst-Root-Layer (z.B. Siedlungsentwicklung) visuell oben und deckten andere Themen ab.
- **Root-Cause:** `_syncZIndices()` basierte auf `_activeLayers`, deren Reihenfolge nach asynchronen Framework-/SetLayer-Operationen von der sichtbaren TOC-Reihenfolge abweichen kann.
- **Fix:** Z-Reihenfolge wird jetzt primaer aus der aktuellen DOM-Reihenfolge im Karteninhalt (`.lm-active-list`) aufgebaut; Bookmark- und Store-Reihenfolge sind nur noch Fallback. Reconcile zieht den Z-Sync danach explizit nach.
- **Guardrail:** Rendering-Reihenfolge nie aus einer potenziell reordernden Runtime-Liste ableiten, wenn eine explizite Benutzer-/Bookmark-Reihenfolge existiert.

## 2026-06-03 — Gruppen-Opacity muss auch bei synthetischen Bookmark-Gruppen auf alle Kinder wirken
- **Symptom:** Beim Verschieben des Gruppen-Deckkraft-Sliders wurden nur Teile der sichtbaren Layer angepasst; einzelne betroffene Layer blieben mit alter Opazitaet.
- **Root-Cause:** Der Group-Opacity-Pfad rief ausschliesslich `setCoalesceGroupOpacity(groupId)` auf. Fuer synthetische Gruppen (`bookmark-root:*`) existiert kein Coalesce-Index-Eintrag, daher lief der Call ins Leere.
- **Fix:** Group-Opacity erkennt jetzt Coalesce vs. nicht-Coalesce. Bei synthetischen Gruppen wird die Opazitaet explizit auf alle Kind-Layer via `setLayerOpacity(childId, value)` angewendet.
- **Guardrail:** Gruppenaktionen nie an einen einzigen Gruppen-Backendpfad koppeln. Bei UI-Gruppen immer den konkreten Gruppentyp (echte Coalesce-Gruppe vs. synthetische Bookmark-Gruppe) unterscheiden.

## 2026-06-03 — Z-Index-Sync muss TOC-Top gleich Karten-Top abbilden
- **Symptom:** Die Layerreihenfolge wirkte invertiert: Eintraege oben im Karteninhalt lagen visuell tiefer als darunterliegende Eintraege.
- **Root-Cause:** `_syncZIndices()` vergab steigende Z-Indizes entlang der Listenreihenfolge (`100 + i`), wodurch untere TOC-Eintraege die hoeheren Z-Werte erhielten. Zudem fehlte ein stabiler Pfad fuer Coalesce-/Bridge-Renderlayer.
- **Fix:** Zuweisung auf absteigende Reihenfolge umgestellt (oberster TOC-Eintrag bekommt hoechsten Z-Index) und um Bridge-/Coalesce-Renderlayer-Aufloesung erweitert.
- **Guardrail:** Bei Layerlisten mit Benutzerreihenfolge immer explizit definieren: Top-of-list = top-on-map. Coalesce-/Combined-Renderlayer muessen in denselben Z-Index-Sync einbezogen werden.

## 2026-06-03 — Coalesce-Snapshot-Restore darf keine pauschalen Pending-Augen auf EIN setzen
- **Symptom:** Nach Gruppe AUS/EIN blieb die Karten-Darstellung korrekt (nur vorher aktive Sublayer sichtbar), aber im Karteninhalt wirkten viele Kind-Augen fälschlich als EIN.
- **Root-Cause:** Der Group-Eye-Handler setzte beim Coalesce-Wiedereinschalten alle Kinder optimistisch auf `pending visible=true`. Für Kinder, die laut Snapshot AUS bleiben sollten, kam teils kein gegenläufiges Event — dadurch blieb ein stale Pending-UI-State bestehen.
- **Fix:** Beim Coalesce-EIN werden keine pauschalen `pending visible=true` mehr gesetzt. Pending wird nur für den sicheren AUS-Fall gesetzt; beim EIN-Fall warten die Kind-Augen auf echte Store-Events (Snapshot-Restore).
- **Guardrail:** Bei Snapshot-basierten Wiederherstellungen nie global optimistische UI-Flags für alle Kinder setzen, wenn der Zielzustand pro Kind unterschiedlich ist.

## 2026-06-03 — Coalesce-Group-Eye darf Kinder nicht per `setLayerEye` einzeln schalten
- **Symptom:** Nach Gruppe AUS/EIN gingen zuvor selektiv ausgeblendete Unterlayer verloren (beim Wiedereinschalten waren alle Kinder an), und beim Gruppenschalten entstanden mehrere Coalesce-Requests statt eines konsolidierten Updates.
- **Root-Cause:** `toggleCoalesceGroupEye()` schaltete Kinder einzeln via `setLayerEye()`. Das triggert pro Kind Framework-/Bridge-Pfade und kann den gemerkten Snapshot-Zustand ueberschreiben bzw. Request-Faecherung erzeugen.
- **Fix:** Group-Eye setzt Child-Visibility jetzt zuerst nur im Store-Zustand und reconciliert danach genau einmal ueber `_forceCoalesceGroupRender()`. Snapshot-Restore bleibt erhalten, per-Child Schaltkaskaden entfallen. Zusaetzlich nutzt der Active-Panel-Handler fuer nicht-Coalesce-Gruppen ebenfalls Snapshot-Restore statt pauschal "alle an" beim Wiedereinschalten.
- **Guardrail:** Bei Coalesce-Gruppen nie N Einzel-Schaltungen ausloesen. Erst Zielzustand fuer alle Kinder berechnen, dann einen gemeinsamen Render-/LAYERS-Abgleich ausfuehren.

## 2026-06-03 — Unerwuenschte ESRI-Home-Control bei Bedarf per CSS hart unterdruecken
- **Symptom:** Die Home-Control ("Standardausdehnung") blieb trotz Entfernen der JS-Instanz sichtbar.
- **Root-Cause:** In Legacy-/Cache-/Default-Szenarien kann die Home-Control dennoch im DOM auftauchen.
- **Fix:** Zusaetzlicher CSS-Fallback eingefuehrt, der `.esri-home` im 3D-View konsequent ausblendet.
- **Guardrail:** Bei kritischen UI-Elementen mit hoher Stoerwirkung zuerst logischen Remove im JS, danach defensiven CSS-Fallback setzen.

## 2026-06-03 — Ungewolltes Home-Widget entfernen und Bottom-Widgets gegen Toolbar absichern
- **Symptom:** Das Haeuschen (Standardansicht) blieb sichtbar, waehrend andere Controls fehlten; zusaetzlich wurde "Neue Messung" von der unteren Werkzeugleiste ueberdeckt.
- **Root-Cause:** Das Home-Widget wurde explizit per `sceneView.ui.add()` hinzugefuegt; gleichzeitig lagen Analyse-Widgets im selben unteren Bildschirmbereich wie die Toolbar ohne vertikalen Sicherheitsabstand.
- **Fix:** Home-Widget-Import/Instanzierung entfernt, SceneView-Default-UI wieder freigegeben und fuer `.esri-ui-bottom-right` ein fixer Bottom-Offset (`86px`) gesetzt.
- **Guardrail:** Bei UI-Overlays in 3D immer Corner-Konflikte pruefen: explizit hinzugefuegte Widgets separat behandeln und Bottom-Container gegen fixe Toolbars mit Offset absichern.

## 2026-06-03 — Breite Analyse-Widgets sollten nicht im selben Corner wie Kern-Controls sitzen
- **Symptom:** Das Panel "Neue Messung" ueberdeckte rechte Standard-Controls (Home/Zoom/Kompass).
- **Root-Cause:** Mess- und Sichtanalyse-Widgets wurden in `top-right` gerendert, also im gleichen UI-Corner wie die Kernnavigation.
- **Fix:** Mess- und Sichtanalyse-Widgets nach `bottom-right` verschoben, damit der obere Control-Stack frei bleibt.
- **Guardrail:** Breite/expandierende Widgets nie im selben Corner wie Kernnavigation platzieren; fuer Werkzeuge getrennte UI-Zone verwenden.

## 2026-06-03 — Default-UI-Komponenten in SceneView koennen Custom-Controls verdecken
- **Symptom:** Die Control "Standardkartenansicht" ueberlagerte in der 3D-Ansicht andere rechte Bedienelemente.
- **Root-Cause:** ArcGIS SceneView renderte den `navigation-toggle` als Default-UI-Komponente zusaetzlich zu den bereits angepassten Controls.
- **Fix:** In der SceneView-Konfiguration wurden `ui.components` explizit auf `['attribution', 'zoom', 'compass']` gesetzt und damit der `navigation-toggle` entfernt.
- **Guardrail:** Bei angepassten Control-Layouts die SceneView-Defaults immer explizit definieren, statt implizit alle Standardkomponenten mitzunehmen.

## 2026-06-03 — ESRI-UI-Anker fuer Controls und Widgets muessen konsistent sein
- **Symptom:** Nach Positionsanpassungen erschienen Navigations-/Werkzeug-Controls wieder links statt rechts.
- **Root-Cause:** CSS-Anker (`.esri-ui-top-left`) und JS-Widget-Insert-Position (`top-left`) liefen gegen die gewuenschte Rechtsausrichtung.
- **Fix:** `.esri-ui-top-left` auf rechts verankert und Mess-/Sicht-Widgets wieder mit `sceneView.ui.add(..., 'top-right')` eingebunden.
- **Guardrail:** Bei ArcGIS-UI-Anpassungen CSS-Anker und `ui.add`-Position immer gemeinsam aendern, sonst entstehen gemischte Links/Rechts-Layouts.

## 2026-06-03 — Responsiver Tool-Breakpoint muss pixelgenau zur UX-Anforderung passen
- **Symptom:** Die 3D-Werkzeugleiste erschien erst bei zu breitem Fenster statt bereits ab 510px.
- **Root-Cause:** CSS- und JS-Guard lagen auf einem zu hohen Schwellenwert und entsprachen nicht der geforderten Grenze.
- **Fix:** Sichtbarkeits-Guard auf `<510px` gesetzt (CSS `max-width: 509px` und JS `window.innerWidth < 510`), sodass die Leiste ab 510px sichtbar bleibt.
- **Guardrail:** Bei "ab X px sichtbar" immer die Grenzlogik explizit mitdenken: ausblenden nur fuer `< X`, nicht `<= X`.

## 2026-06-03 — 3D-Tool-Breakpoint und Dialog-Anker muessen gemeinsam abgestimmt werden
- **Symptom:** Tools erschienen auf Desktop zu spaet oder gar nicht; Dialoge verdeckten in manchen Fenstergroessen wichtige Bereiche.
- **Root-Cause:** Verfuegbarkeits-Breakpoint und Dialog-Position waren nicht auf den realen Layout-Anker (3D-Selektor oben links) abgestimmt.
- **Fix:** Breakpoint auf `860px` gesenkt (CSS+JS konsistent) und Tool-Dialoge auf `top/left` direkt unter den Selektor verankert.
- **Guardrail:** Bei responsiven Tool-UIs immer Anzeige-Guard und Dialog-Anker zusammen anpassen; CSS- und JS-Breakpoints muessen identisch bleiben.

## 2026-06-03 — Pointer-Coarse allein ist kein valider Mobile-Guard fuer Desktop-WebGIS
- **Symptom:** Nach Mobile-Guard waren 3D-Werkzeuge auch auf Desktop verschwunden.
- **Root-Cause:** Die Verfuegbarkeitslogik nutzte `pointer: coarse` als hartes Kriterium; das trifft auch auf Desktop-Systeme mit Touchscreen/Hybrid-Input zu.
- **Fix:** Guard auf Kombination aus Viewport-Breite, Mobile-User-Agent und explizitem Mobile-Entry umgestellt; reine Pointer-Coarse-Pruefung entfernt.
- **Guardrail:** Feature-Gates fuer Mobile nie auf ein einzelnes Input-Merkmal stuetzen. Immer mindestens Device-Kontext + Layout-Kontext kombinieren.

## 2026-06-03 — 3D-Toolleiste auf kleinen Screens hart deaktivieren
- **Symptom:** In der 3D-Ansicht verdeckten Werkzeug-Dialoge auf kleinen Viewports Inhalte, und die Bedienung war unzuverlaessig.
- **Root-Cause:** Die Toolleiste/Analyse-Panels wurden unabhaengig von Viewport und Eingabetyp immer angeboten.
- **Fix:** Responsive Guard eingefuehrt (max-width/coarse pointer), Toolbar+Panels per CSS versteckt und Aktivierung im JS per `are3DToolsAvailable()` geblockt; bei Resize werden aktive Tools automatisch deaktiviert.
- **Guardrail:** Interaktive Desktop-Tools nie ungeprueft auf Mobile ausrollen. Sichtbarkeit und Aktivierung immer doppelt absichern (UI + Runtime-Guard).

## 2026-06-03 — 3D-Tool-Toggle darf aktives Tool nicht vor dem Vergleich nullen
- **Symptom:** Im 3D-Viewer oeffneten sich beim Klick auf mehrere Bottom-Tools uebereinanderliegende Dialoge/Widgets; manche liessen sich nicht sauber schliessen.
- **Root-Cause:** `activateTool()` rief zuerst `deactivateAllTools()` auf und setzte damit `activeTool` vor dem Gleichheitscheck auf `null`; zusaetzlich wurden Viewshed-Widget und Event-Handler mehrfach erzeugt.
- **Fix:** Toggle-Logik auf `isSameTool` vor Deaktivierung umgestellt, Viewshed in `deactivateAllTools()` konsequent zerstört, Async-Widget-Erzeugung per Activation-Token entprellt und Listener nur einmal gebunden.
- **Guardrail:** Bei Tool-Toggles immer erst den Zielzustand berechnen, dann de-/aktivieren. Async-`require()`-Callbacks muessen stale Aktivierungen verwerfen.

## 2026-06-03 — Karteninhalt muss Status-Text bei `layer-loading`-Ende aktiv neu rendern
- **Symptom:** Nach Aus-/Einschalten von Gruppenlayern wurden Layer in der Karte korrekt angezeigt, im Karteninhalt blieb aber bei einzelnen Themen dauerhaft `laedt...` stehen.
- **Root-Cause:** Der `layer-loading`-Handler in `tnet-lm-active.js` aktualisierte nur die Eye-Klasse (`lm-eye-loading`) und fuehrte keinen Re-Render fuer den Status-Text aus.
- **Fix:** Nach jedem `layer-loading`-Event wird jetzt ein throttled Re-Render (`_scheduleRender()`) angestossen, damit `loading/loadingSlow/loadingError` im Textstatus konsistent aus dem aktuellen Layer-State gebaut werden.
- **Guardrail:** Bei inkrementellen DOM-Optimierungen darf ein Event-Handler nicht nur Icon-Klassen pflegen, wenn Text-Badges aus demselben State abgeleitet sind. Dann ist mindestens ein gezielter Nach-Render erforderlich.

## 2026-06-03 — Variable-Shadowing in Visibility-Berechnung kann alle Layer auf false kippen
- **Symptom:** Agglomeration lud mit leerer/inkonsistenter Layerdarstellung; `visibilityMap` konnte auf 0 sichtbare Layer fallen.
- **Root-Cause:** In `_computeBookmarkVisibility()` wurde die Map `explicitVisible` durch eine lokale Boolean-Variable gleichen Namens überschattet.
- **Fix:** Die Map wurde in `explicitVisibleMap` umbenannt und die Layer-lokale Flag-Variable getrennt (`explicitLayerVisible`).
- **Guardrail:** In kritischen Merge-/Visibility-Funktionen keine gleichnamigen Variablen für globale Map und lokale Flags verwenden.

## 2026-06-03 — Bookmark-Apply muss auf Framework-Readiness warten
- **Symptom:** `setMapBookmark(params)` schlug sporadisch im frühen Lifecycle fehl (`changeBaseMap` undefined), wodurch Layer nicht korrekt geladen wurden.
- **Root-Cause:** `TnetSetBookmark` konnte vor vollständiger Initialisierung von `AppManager`/Map laufen.
- **Fix:** Vor `_applyBookmark` wurde ein Readiness-Wait (`_waitForFrameworkBookmarkReady`) ergänzt.
- **Guardrail:** Framework-Aufrufe mit starker Lifecycle-Abhängigkeit nie ungeprüft ausführen; immer einen Ready-Guard vorschalten.

## 2026-06-03 — Strukturelle Parent-Layer nur filtern, wenn sie nicht explizit sichtbar sind
- **Symptom:** View-Wechsel bei Agglomeration wirkte wirkungslos; Runtime/Store blieben auf 0 sichtbaren Layern, obwohl `setMapBookmark` sichtbare `layers=`-Parameter erhielt.
- **Root-Cause:** Strukturfilter entfernte Parent-IDs pauschal in `_computeBookmarkVisibility`/`_buildBookmarkRuntimeLayers`; bei diesem Bookmark tragen aber genau diese IDs den expliziten Sichtbarkeitszustand.
- **Fix:** Strukturknoten werden nur noch gefiltert, wenn sie nicht explizit auf `visible:true` gesetzt sind (Layer-Spec oder View-State). Gleiches gilt für den View-Switch-Optionsbau im Active-Panel.
- **Guardrail:** Strukturfilter nie absolut anwenden; explizit sichtbare Parent-IDs müssen erhalten bleiben, sonst kollabiert die View-Semantik.

## 2026-06-03 — Remove-Aktion braucht ein sichtbares Text-Fallback statt nur SVG
- **Symptom:** Im Karteninhalt war kein Löschkreuz wahrnehmbar, obwohl Remove-Aktionen technisch vorhanden waren.
- **Root-Cause:** Remove-Buttons waren visuell zu subtil bzw. abhängig von Icon-/Hover-Kontext und wurden im UI leicht übersehen.
- **Fix:** Remove-Buttons rendern jetzt ein klares rotes `✕` als Text-Fallback und bleiben auf Desktop grundsätzlich sichtbar (Hover verstärkt nur die Betonung).
- **Guardrail:** Kritische Primäraktionen (Entfernen) nicht rein ikonisch/hover-only darstellen; immer ein robust sichtbares Fallback anbieten.

## 2026-06-03 — Group-Eye muss echte Coalesce-Gruppen als Batch schalten
- **Symptom:** Beim Ein-/Ausschalten einer Agglomeration-Gruppe liefen trotz Loop-Break noch mehrere nacheinander ausgelöste Child-Toggles, statt eines sauberen Coalesce-Gruppenupdates.
- **Root-Cause:** Der UI-Handler schaltete Gruppenkinder einzeln (`setLayerVisible` pro Child) und verursachte dadurch unnötige Kaskaden.
- **Fix:** In `tnet-lm-active.js` nutzt `group-eye` für echte Coalesce-Gruppen jetzt `toggleCoalesceGroupEye(groupId)` als Batch-Pfad; Child-Wege bleiben nur Fallback.
- **Guardrail:** Für Coalesce-Gruppen immer den Gruppenpfad verwenden und Child-Schaltungen nicht in Schleifen triggern.

## 2026-06-03 — Loading-Status darf keinen active-layers-changed-Reconcile ausloesen
- **Symptom:** Sobald in Agglomeration mehr als zwei Sublayer aktiv waren, wurden im Sekundentakt neue Export-Requests abgesetzt (sichtbarer Dauer-Reload).
- **Root-Cause:** `_setLayerLoadingState()` emittierte bei jedem Loading-Statuswechsel zusaetzlich `active-layers-changed`. Das triggert `_scheduleMapConsistencyCheck()` erneut und startet einen self-triggernden Reconcile-Zyklus.
- **Fix:** In `tnet-lm-store.js` emittiert der Loading-Pfad nur noch `layer-loading`, nicht mehr `active-layers-changed`.
- **Guardrail:** Status-Events (loading/slow/error) strikt von Struktur-Events trennen. Nur echte Layerlisten-Aenderungen duerfen `active-layers-changed` feuern.

## 2026-06-03 — Strukturelle Bookmark-Container duerfen nicht als echte Active-Layer laufen
- **Symptom:** Im Karteninhalt tauchten ploetzlich flache Zusatzzeilen (Ghost-Layer) auf; bei OEREB stieg die Themenzahl sporadisch stark an, und im Hintergrund liefen unnoetige Nachlade-/Export-Requests.
- **Root-Cause:** Parent-/Container-IDs aus `cfg.layers` wurden wie renderbare Layer in Visibility/Runtime/Store behandelt. Diese IDs sind oft nur Strukturknoten mit Unterlayern und triggern in Reconcile-Pfaden unnoetige `on`-Schaltungen.
- **Fix:** In `tnet-mapplus-helpers.js` werden strukturelle IDs jetzt aus `_computeBookmarkVisibility()` und `_buildBookmarkRuntimeLayers()` herausgefiltert. In `tnet-lm-active.js` ignoriert auch die Dirty-Pruefung diese Strukturknoten.
- **Guardrail:** Bei Bookmark-Layern immer zwischen fachlichem Strukturknoten und renderbarem Blatt-Layer unterscheiden. Container-IDs duerfen nicht in Active-/Reconcile-Logik gelangen.

## 2026-06-03 — Map-getriebene false-Events duerfen Bookmark-Runtime nicht auf AUS ziehen
- **Symptom:** Nach asynchronen Framework-Rebuilds kippten Bookmark-Layer ohne User-Aktion auf `visible:false` (Auge aus), obwohl die Karte weiter lief.
- **Root-Cause:** `layer-visibility` mit `source='map'` und `visible=false` wurde ungefiltert in `window.__tnetActiveBookmark.layers` uebernommen; zusaetzlich zog der Active-Layer-Merge negative Zustandsflips aus transienten Store-Events nach.
- **Fix:** In `tnet-mapplus-helpers.js` ignoriert der Runtime-Sync jetzt map-seitige `visible:false`-Events, und der Merge uebernimmt Visibility aus `active-layers-changed` nur noch positiv (`visible:true`).
- **Guardrail:** Map-/OL-Remove-Events in Legacy-Rebuild-Phasen nie als harte Benutzerintention behandeln. Negative Status nur aus UI-/Bookmark-Pfaden uebernehmen.

## 2026-06-03 — Nicht-Default-Views mit reinen visible:true-States sind Whitelists
- **Symptom:** Die Ansicht `test` lud Layer nicht gemaess View-Konfiguration; entweder wurden falsche Default-Layer mitgenommen oder die erwarteten 7 Layer nicht stabil gesetzt.
- **Root-Cause:** Die Visibility-Berechnung behandelte fehlende `layerStates`-Eintraege weiterhin als Default-Vererbung. Bei Whitelist-Views (`isDefault:false` + nur `visible:true` Eintraege) ist das falsch.
- **Fix:** `tnet-mapplus-helpers.js` und `tnet-lm-active.js` erkennen diesen Modus jetzt explizit und setzen nicht genannte Layer auf `visible:false`.
- **Guardrail:** Bei View-Switch nie pauschal Default-Visibility erben. Nicht-Default-Views mit ausschliesslich `visible:true`-States als explizite Whitelist interpretieren.

## 2026-06-03 — Store-Merge darf Bookmark-Sichtbarkeit im Ladefenster nicht blind auf false setzen
- **Symptom:** Direkt nach View-Apply sprang der Bookmark-Zustand auf `layers=` leer bzw. alle Runtime-Layer auf `visible:false`; der Reset-Hinweis erschien ohne echte Benutzeraktion.
- **Root-Cause:** `_mergeStoreLayersIntoActiveBookmark()` setzte waehrend `_replaceVisibleFromStoreUntil` zunaechst pauschal alle Bookmark-Layer auf `false`, auch wenn der Store in diesem Moment noch keinen stabilen sichtbaren Layer lieferte.
- **Fix:** Das harte Reset greift nur noch, wenn der Store bereits mindestens einen `visible:true`-Layer hat.
- **Guardrail:** Im Bookmark-Ladefenster niemals global auf `visible:false` vorinitialisieren, solange der Store noch im transienten Aufbau ist.

## 2026-06-03 — Ansichtswechsel darf Bookmark nicht als manuell geaendert markieren
- **Symptom:** Nach Wechsel der Ansicht erschien ohne Benutzerinteraktion der Hinweis "Änderungen verwerfen" und die Layerschaltung wurde inkonsistent.
- **Root-Cause:** Asynchrone Visibility-/Sync-Events nach `switch-view` liefen außerhalb des kurzen Ladefensters ein und setzten den Modified-Status wie bei einem echten User-Toggle.
- **Fix:** In `tnet-lm-active.js` wurde ein dediziertes View-Switch-Schutzfenster eingeführt (`_bmViewSwitchUntil`), das während des Ansichtswechsels Dirty-Setzen und Live-Extra-Merge unterdrückt.
- **Guardrail:** View-/Bookmark-Loads immer mit eigenem Guard behandeln; Event-Stürme aus Framework-Sync nie direkt als Benutzeränderung interpretieren.

## 2026-06-03 — Spinner-Zentrierung bricht, wenn Animation `transform` ueberschreibt
- **Symptom:** Der Eye-Ladekringel erschien sichtbar, aber versetzt neben dem Auge statt sauber zentriert.
- **Root-Cause:** Das Pseudo-Element nutzte `transform: translate(-50%, -50%)` zur Zentrierung, die Keyframe-Animation setzte jedoch `transform: rotate(...)` und überschreibt damit die Translate-Transformation.
- **Fix:** Keyframes auf `translate(-50%, -50%) rotate(...)` umgestellt, damit Zentrierung und Rotation gleichzeitig aktiv bleiben.
- **Guardrail:** Bei animierten, absolut positionierten Spinnern Translate-Offsets immer in den Keyframes mitführen oder die Rotation auf ein verschachteltes Element legen.

## 2026-06-03 — Group-Eye darf nicht nur Coalesce-Toggle verwenden
- **Symptom:** Bei Agglomeration war der Gruppen-Auge-Status nach Ein/Aus inkonsistent; ein zweiter Klick schaltete teils nicht mehr sauber zurück.
- **Root-Cause:** Der Group-Flush arbeitete primär mit `toggleCoalesceGroupEye`, aber die betroffene Hierarchie ist nicht durchgehend Coalesce-indexiert. Dadurch blieb der Toggle ohne wirksamen Commit auf den Kindlayern.
- **Fix:** Group-Eye schaltet jetzt die sichtbaren Kindlayer explizit per `setLayerEye(layerId, target)` und nutzt Coalesce-Toggle nur als Fallback.
- **Guardrail:** Gruppen-Interaktionen in gemischten Bäumen (normale Gruppen + Coalesce) immer als explizites Setzen pro Kind implementieren, nicht als blindes Toggle.

## 2026-06-03 — Combined-Render-Check muss rekursiv durch OL-Layer-Gruppen laufen
- **Symptom:** Layer wurden im Store/DOM als sichtbar geführt, obwohl die effektive Render-Erkennung diese als unsichtbar bzw. inkonsistent meldete.
- **Root-Cause:** `_isSublayerRenderedByCombinedLayer` prüfte nur Top-Level-Layer und übersah verschachtelte OpenLayers-Group-Layer.
- **Fix:** Der Check traversiert jetzt rekursiv alle Layer-Gruppen und wertet `show:`-Parameter auch in verschachtelten Strukturen korrekt aus.
- **Guardrail:** Für Render-Detektion in OpenLayers nie nur `map.getLayers().forEach(...)` nutzen, wenn Layer-Groups im Framework möglich sind.

## 2026-06-03 — Eye-Loaderkreis muss trotz unterdruecktem Full-Render direkt aus layer-loading reagieren
- **Symptom:** Beim Umschalten der Sichtbarkeit erschien um das Eye kein Loaderkreis mehr, obwohl der Layer noch geladen wurde.
- **Root-Cause:** Der Active-Panel-Render wurde waehrend des Sichtbarkeits-Flushs unterdrueckt. Dadurch wurde das `layer-loading`-Event zwar vom Store gefeuert, aber der visuelle Loading-Status kam nie als DOM-Update an.
- **Fix:** `tnet-lm-active.js` reagiert jetzt direkt auf `layer-loading` und setzt bzw. entfernt `lm-eye-loading` sofort am betroffenen Eye-Button, statt auf einen spaeteren Full-Render zu warten.
- **Guardrail:** Ladeindikatoren nie nur an einen reinen Renderpfad haengen, wenn dieser zeitweise unterdrueckt werden kann. Bei interaktiven Toggles braucht der visuelle Loading-Zustand einen direkten DOM-Handler.

## 2026-06-03 — Alte items-Hierarchien muessen vor dem Rendern ins neue Baumformat normalisiert werden
- **Symptom:** Die Agglomeration zeigte im Themenkatalog nur noch eine flache Reststruktur; tiefere Unterknoten aus dem JSON-Snippet waren im Baum nicht mehr sauber sichtbar.
- **Root-Cause:** Der Katalog-Import verstand nur `nodes`/`subcategories`/`groups`/`layers`. Das alte, rekursive `items`-Schema wurde nicht mehr in das neue Baumformat übersetzt und brach die Hierarchie unterwegs ab.
- **Fix:** `tnet-lm-store.js` normalisiert `items` nun rekursiv in `subcategories`/`groups`/`layers` und fuellt fehlende IDs/Namen aus den Schluesseln auf.
- **Guardrail:** Bei Legacy-Katalogen zuerst das Daten-Schema normalisieren, erst dann rendern. Ein neuer Baum-Renderer hilft nicht, wenn die Import-Schicht die Hierarchie schon vorher verliert.

## 2026-06-03 — Frischer Bookmark-Wechsel darf Sichtbarkeit nur aus echtem Layer-Overlap uebernehmen
- **Symptom:** Beim direkten Wechsel von `nw_oereb` auf `nw_agglomeration` wurde der neue Karteninhalt weiter mit OEREB-Zustand verunreinigt; gleichzeitig erschien Agglomeration im Karteninhalt als flache, schwer lesbare Liste.
- **Root-Cause:** Der fruehe Store→Bookmark-Sync in `tnet-mapplus-helpers.js` setzte waehrend des Replace-Fensters pauschal alle neuen Bookmark-Layer auf `visible:false`, auch wenn gar kein echter Layer-Overlap zum vorherigen Bookmark existierte. Zusaetzlich hatte der Active-TOC fuer externe/nicht katalogregistrierte Bookmark-Layer keine synthetische Gruppierung und renderte sie deshalb roh/flach.
- **Fix:** Sichtbarkeitsersatz aus dem Store greift nur noch, wenn der aktuelle Store mindestens einen echten ID-Overlap zum neuen Bookmark hat. Externe Bookmark-Layer werden im Karteninhalt zusaetzlich nach ihrem fachlichen Root-Prefix zu synthetischen Gruppen wie `Basisnetz` und `Siedlungsentwicklung` zusammengefasst.
- **Guardrail:** Beim Bookmark-Wechsel niemals pauschal sichtbare Defaults aus Alt-Storezustand auf ein komplett neues Bookmark uebertragen. Store-Sync nur bei nachweisbarem Layer-Overlap anwenden und fuer externe Bookmark-Layer immer eine lesbare Gruppenstruktur bereitstellen.

## 2026-06-03 — Bookmark-Layer ausserhalb des Katalogs duerfen nicht aus dem Karteninhalt herausgefiltert werden
- **Symptom:** Nach `Karte leeren` und erneutem Laden von `nw_agglomeration` blieb der Karteninhalt leer (`0 Themen`), obwohl das Bookmark korrekt 25 Layer lieferte.
- **Root-Cause:** `TnetLMStore.loadActiveLayersFromBookmark()` registrierte nicht renderbare/nicht katalogaufloesbare Bookmark-Layer nur dann, wenn bereits ein passender OL-Layer auf der Karte existierte. Fuer `nw_agglomeration` war das beim Initialimport nicht der Fall, daher wurde der komplette Bookmark-Inhalt verworfen.
- **Fix:** Nicht katalogaufloesbare Bookmark-Layer werden jetzt sofort als Active-Eintraege registriert und nur zusaetzlich fuer spaetere OL-Bindung vorgemerkt.
- **Guardrail:** Der Karteninhalt darf Bookmark-Layer nicht an die unmittelbare Katalog- oder OL-Aufloesbarkeit koppeln. Bookmark ist der Sollzustand und muss auch fuer externe/legacy Layer sofort sichtbar werden.

## 2026-06-03 — Bookmark-Neuaufbau braucht einen mehrfachen Strict-Store-Reset in den ersten Sekunden
- **Symptom:** Trotz Clear vor `setMapBookmark` tauchten beim Wechsel einzelne Alt-Layer wieder im Karteninhalt auf (wirkte wie Dazuladen).
- **Root-Cause:** Asynchrone Framework-/OL-Events konnten direkt nach dem Apply den Active-Store kurzfristig wieder mit Altzustand befuellen.
- **Fix:** Nach dem initialen `loadActiveLayersFromBookmark(runtimeLayers)` wird der Store in kurzen Abstaenden nochmals strikt auf dieselben Bookmark-Layer zurueckgesetzt (token-guarded).
- **Guardrail:** Bei Legacy-Bookmarkwechseln mit asynchronem Framework-State nicht nur einmal initialisieren, sondern den Sollzustand kurz nachstabilisieren.

## 2026-06-03 — Beim Bookmark-Wechsel immer Store-Clear UND Karten-Clear ausführen
- **Symptom:** Beim Wechsel zwischen Karten/Bookmarks wurden neue Layer zum alten Inhalt addiert; direkt danach erschien teils unberechtigt `Änderungen verwerfen`.
- **Root-Cause:** Der Clear-Pfad brach nach `LMStore.removeAllLayers()` frueh ab. Verzoegerte Framework-Layer auf der Karte blieben dadurch sichtbar und konnten den frischen Bookmark-Zustand wieder verunreinigen.
- **Fix:** Der Bookmark-Apply fuehrt nach dem Store-Clear immer einen zweiten, defensiven Map-Clear-Pass aus (sichtbare thematische Layer vor `setMapBookmark` hart ausblenden).
- **Guardrail:** Bei asynchronen Framework-Layern nie nur den Store leeren. Vor einem harten Rebuild immer Store- und Kartenzustand bereinigen, sonst mischen sich Alt-Layer in den neuen Bookmark.

## 2026-06-03 — Bookmark-Wechsel darf keine Alt-Layer per Runtime-Seed oder OL-Add-Events wieder einschleusen
- **Symptom:** Beim Wechsel von `nw_oereb` auf `nw_agglomeration` blieb der Karteninhalt auf OEREB-Layern stehen bzw. nach vorherigem Leeren kam gar kein sauberer Neuaufbau zustande.
- **Root-Cause:** Zwei Pfade liessen Altzustand in den neuen Bookmark-Load hineinlaufen: `tnet-mapplus-helpers.js` uebernahm Runtime-Layer aus `window.__tnetActiveBookmark.layers` auch beim Wechsel auf ein anderes Bookmark, und `tnet-lm-store.js` liess waehrend des neuen Bookmark-Loads verzoegerte OL-Add-Events alter Layer den Active-Store wieder befuellen.
- **Fix:** Runtime-Layer aus dem Vorzustand werden nur noch fuer dasselbe Bookmark als Seed verwendet. Zusaetzlich ignoriert der Store waehrend `bookmark._loadUntil` OL-Add-Events fuer Layer, die nicht zum aktuell ladenden Bookmark gehoeren.
- **Guardrail:** Bei Bookmark-Wechseln den Active-Store als exklusiven Sollzustand behandeln. Weder Runtime-Seeds noch asynchrone Map-Events duerfen Layer aus dem vorherigen Bookmark in den neuen Karteninhalt zurueckmischen.

## 2026-06-03 — Karteninhalt-Header muss auch im Leerzustand bestehen bleiben
- **Symptom:** Nach Leeren des Karteninhalts verschwand der komplette Header im Active-Panel; damit war der Kartenname/Fallback (`keine gewählt`) nicht sichtbar und der Zustand wirkte inkonsistent.
- **Root-Cause:** `tnet-lm-active.js` beendete `render()` bei `effectiveLayers.length === 0` sofort mit einem nackten Leerzustand-Block statt denselben Header-Pfad zu rendern.
- **Fix:** Der Header (Karte/Ansicht/Toolbar) wird nun immer gerendert; im Leerzustand erscheint darunter nur der Empty-Block, der Kartenname nutzt weiterhin den Fallback `keine gewählt`, und der Clear-Button ist bei 0 Themen deaktiviert statt zu verschwinden.
- **Guardrail:** In State-basierten Panels den Header nie an die Existenz von Listeneinträgen koppeln. Leerzustände gehören unter denselben Header, damit Kontext und Aktionen konsistent bleiben.

## 2026-06-03 — Basemap-Farbmodus muss den Widget-Schalter aktiv nachziehen
- **Symptom:** Im Bookmark `nw_oereb` wurde die Grundkarte bzw. nach Basemap-Wechsel das Orthophoto grau gerendert, obwohl der Schalter sichtbar auf `FARBE` stand.
- **Root-Cause:** Der Bookmark-Start setzte `BasemapTimeManager.syncGrayscale(true)` aus `basemapColorMode = grey`, aber der FARBE/GRAU-Button blieb auf seinem HTML-Default (`FARBE active`). Wenn der Sync vor bzw. unabhängig von der Widget-Initialisierung lief, drifteten Renderzustand und UI auseinander.
- **Fix:** `tnet-basemap.js` synchronisiert die FARBE/GRAU-Buttons nun zentral aus dem echten `_isGrayscale`-Status und zieht diesen Zustand auch nach der DOM-Initialisierung des Widgets nochmals nach.
- **Guardrail:** Bei Bookmark-/Startup-Overrides nie nur den Runtime-State setzen. Toggle-Buttons mit Default-Markup muessen nach jedem programmgesteuerten Statuswechsel explizit aus dem echten State synchronisiert werden.

## 2026-06-03 — Coalesce-Consistency-Loop darf im Leerlauf keine identischen LAYERS-Updates feuern
- **Symptom:** Beim blossen Start von `https://www.gis-daten.ch/maps-dev/nw_oereb` liefen ohne jede Interaktion fortlaufend ArcGIS-`MapServer/export`-Requests in der Konsole/Network-Ansicht.
- **Root-Cause:** `reconcileMapConsistency()` rief fuer Coalesce-Gruppen im Leerlauf wiederholt `registerSublayer()`/`showSublayer()`/`hideSublayer()` auf. Die Bridge war dabei nicht idempotent: selbst bei unveraendertem Zustand wurden `visibleSublayers` erneut beschrieben, `_updateLAYERSDebounced()` erneut geplant und in `_setLayersOnSource()` identische `LAYERS` per `updateParams()` nochmals auf die Source geschrieben. Das reichte fuer erneute Export-Requests.
- **Fix:** `tnet-coalesce-bridge.js` macht `registerSublayer()`, `showSublayer()` und `hideSublayer()` idempotent und bricht bei unveraendertem Zustand frueh ab. Zusaetzlich ueberspringt `_setLayersOnSource()` `updateParams()` komplett, wenn `LAYERS` und Sichtbarkeit bereits dem Soll entsprechen. Live verifiziert: zuvor in 5s `register=40`, `show=40`, `hide=660`, `apply=19`; nach dem Fix alles `0`, dazu `exportRequests=0`.
- **Guardrail:** Bei Bridge-/Consistency-Pfaden nie auf "gleich nochmal setzen schadet nicht" vertrauen. Bei Layer-Parametern fuehrt schon ein identisches `updateParams()` auf ImageArcGISRest zu echten Netzrequests. Daher jeden Write-Pfad strikt idempotent halten.

## 2026-06-03 — Linkes Sidepanel war in der Breite fest auf 340px
- **Symptom:** Das links angedockte Themenkatalog-Panel liess sich nicht mit der Maus verbreitern oder verschmaelern.
- **Root-Cause:** Die Sidepanel-Breite war statisch in CSS/Offsets hinterlegt (`340px`) und es gab keinen horizontalen Resize-Handle mit Drag-Logik.
- **Fix:** Breite auf CSS-Variable `--tnet-sidepanel-width` umgestellt, Desktop-Resize-Handle am rechten Panelrand eingefuehrt, Drag-Logik mit Min/Max-Clamp und localStorage-Persistenz implementiert; abhaengige Offsets (Disclaimer/Such-Dropdown/Scroll-Button) auf dieselbe Variable gekoppelt.
- **Guardrail:** Bei fixierten Legacy-Sidepanels immer zuerst eine zentrale Breitenvariable einfuehren und danach alle flankierenden Offsets daran anbinden, sonst laufen Handle und UI-Elemente visuell auseinander.

## 2026-06-03 — Karteninhalt: Event-Sturm (layer-loading/active-layers-changed) baut Liste 16x/s neu
- **Symptom:** Opacity-Regler klemmte beim ersten Griff (zweiter ging), Sichtbarkeits-Auge flimmerte schon beim blossen Hovern, und der erste Klick aufs Auge wurde teils verschluckt.
- **Root-Cause:** Das Framework (u.a. CoalesceBridge-Retry) emittiert im Leerlauf `layer-loading` UND `active-layers-changed` je ~16x/s OHNE echte Zustandsaenderung. Beide haengen an `_scheduleRender` → `render()` baute jedes Mal `_container.innerHTML` komplett neu. Per Playwright verifiziert: Layer-Snapshot ueber 3s identisch, dennoch wurden Auge-/Slider-/Item-Knoten 16x/s ausgetauscht (`eyeReplacedWhileIdle: true`). Der staendige Knoten-Austausch unterbrach den nativen Slider-Drag und resettete den Hover-State.
- **Fix:** `tnet-lm-active.js` `render()` vergleicht das fertig zusammengebaute HTML mit dem letzten Stand (`_lastRenderHtml`). Ist es identisch und der Container bereits befuellt, wird die `innerHTML`-Zuweisung uebersprungen — kein DOM-Mutation, kein Knoten-Austausch. `_lastRenderHtml` wird bei Leerzustand, Bookmark-Reset und direkter Badge-Mutation (`_refreshModifiedBadge`) invalidiert. Verifiziert unter vollem Sturm: alle `*ReplacedWhileIdle: false`, Auge schaltet beim ersten Klick, Slider bleibt waehrend Drag erhalten.
- **Guardrail:** Bei hochfrequenten Framework-Events (loading/changed) nie ungebremst `innerHTML` neu schreiben. render() idempotent machen: identisches Ausgabe-HTML → DOM unangetastet lassen. Der zuverlaessigste Vergleich ist das finale HTML selbst (keine Feld-Signatur, die Felder vergessen kann).

## 2026-06-03 — Karteninhalt: Eye-Toggle und Opacity-Drag durch Full-Rebuild via bookmark-state-changed blockiert
- **Symptom:** Trotz inline-DOM-Updates und Pending-State blieb der Deckkraft-Regler beim Ziehen haengen und das Sichtbarkeits-Auge flimmerte beim Hover; Schaltung wirkte verzoegert.
- **Root-Cause:** `_onVisibility`/`_onOpacity` riefen `emitBookmarkStateChanged()`. Der `tnet-bookmark-state-changed`-Listener ruft `self.render()` **direkt** auf (umgeht den `_suppressVisibilityRender`/`_scheduleRender`-Guard) und baut bei einem 135-Layer-Bookmark die komplette `innerHTML`-Liste neu — der gerade angefasste Slider-/Auge-Knoten wird dabei zerstoert. Per Playwright verifiziert: `eyeNodeReplaced: true`, `sliderNodeReplaced: true`, Frames aber 60fps (kein JS-Jank).
- **Fix:** `tnet-lm-active.js` `render()` bricht bei aktivem `_suppressVisibilityRender` oder `_activeOpacitySlider` vor dem Full-Rebuild ab und zieht nur das Modified-Badge per neuer `_refreshModifiedBadge()` leichtgewichtig nach. Nach Verifikation: `nodeReplaced: false` fuer Auge und Slider, Live-Label aktualisiert weiter.
- **Guardrail:** Bei optimistischer UI nicht nur `_scheduleRender` guarden — JEDER Renderpfad (auch direkte `self.render()`-Aufrufe aus Event-Listenern wie `bookmark-state-changed`) muss waehrend aktiver Slider-/Toggle-Interaktion den Full-Rebuild ueberspringen, sonst zerstoert er den angefassten DOM-Knoten.

## 2026-06-03 — Karteninhalt muss Sichtbarkeit und Deckkraft zuerst lokal reagieren lassen
- **Symptom:** Augen-Toggles und Deckkraftregler im Karteninhalt wirkten trotz funktionierender Store-Logik träge, weil die UI auf den synchronen Karten-/Storepfad wartete.
- **Root-Cause:** Das Active-Panel delegierte Visibility und Opacity direkt in den Store. Die sichtbare Reaktion im DOM hing dadurch an nachgelagerten Karten- und Framework-Updates statt am unmittelbaren User-Intent.
- **Fix:** `tnet-lm-active.js` fuehrt einen optimistischen Pending-UI-State pro Layer ein. Auge und Deckkraft werden zuerst lokal im Panel aktualisiert; der Store wird erst leicht verzoegert idempotent per `setLayerEye()` bzw. Opacity-Setter nachgezogen und raeumt den Pending-State ueber Store-Events wieder auf.
- **Guardrail:** Bei interaktiven Layer-Panels nie die sichtbare Rueckmeldung an teure Store-/Kartenpfade koppeln. Erst den User-Intent lokal rendern, danach den Runtime-State asynchron nachziehen und per Event wieder auf echten Zustand reconciliieren.

## 2026-06-03 — Deckkraft-Regler darf die Karte nicht bei jedem Slider-Pixel neu rechnen
- **Symptom:** Der Deckkraft-Regler im Karteninhalt ruckelte beim Ziehen spuerbar; besonders Gruppen-Opacity fuehlte sich hakelig an.
- **Root-Cause:** Der `input`-Handler schrieb jeden einzelnen Slider-Zwischenschritt sofort in den Store und damit bis zur Karte durch. Bei vielen `input`-Events pro Drag blockierte der Karten-Update-Pfad den Regler.
- **Fix:** `tnet-lm-active.js` puffert Opacity-Aenderungen kurz an, aktualisiert nur die sichtbare Prozentanzeige sofort und schreibt den letzten Wert gesammelt mit kurzem Delay in den Store; beim `change` wird der Endwert sofort geflusht.
- **Guardrail:** Slider-UI und Karten-Writeback entkoppeln. Bei teuren Layer- oder Kartenupdates nie jeden `input` 1:1 bis zur Runtime durchreichen; waehrend des Drags kurz takten, beim Loslassen final synchronisieren.

## 2026-06-03 — Eye-Aktivierung darf bei spaetem LyrMgr nicht erst den zweiten Klick brauchen
- **Symptom:** Das Aktivieren eines ausgeschalteten Layers per Auge reagierte teils nicht sofort; erst nach kurzer Wartezeit und erneutem Klick liess sich der Layer einschalten.
- **Root-Cause:** `toggleLayerEye()` fiel fuer Lazy-Load-Aktivierungen auf `TnetLayerSwitch(layerId, 'on')` zurueck. Wenn `AppManager`/Map oder `LyrMgr` in diesem Moment noch nicht bereit waren, endete der erste Aktivierungsversuch wirkungslos.
- **Fix:** `TnetLayerSwitch()` merkt sich fehlgeschlagene `on`-Aktivierungen kurzzeitig und versucht denselben Aufruf automatisch erneut, bis Map/LyrMgr verfuegbar sind oder das Retry-Fenster auslaeuft.
- **Guardrail:** UI-Klicks auf Lazy-Load-Layer duerfen nicht von einem einzelnen Initialisierungs-Moment abhaengen. Wenn der Aktivierungspfad waehrend des Framework-Starts auf noch nicht bereite Manager trifft, muss derselbe Klick nachgezogen statt verworfen werden.

## 2026-06-02 — Bookmark-Dirty darf Opacity nicht als globalen Default vergleichen
- **Symptom:** Nach URL-Bookmarks erschien der Stern-/Undo-Zustand wegen Deckkraftabweichungen, obwohl fachlich dieselben sichtbaren Layer wie im Bookmark aktiv waren.
- **Root-Cause:** Die Dirty-Pruefung rekonstruierte Opacity aus Bookmark, View-State und Katalog-Fallbacks. In MAP+ gibt es aber keinen globalen Deckkraft-Default; Opacity ist je Layer definiert und kann in Bookmarks optional ueberschrieben werden.
- **Fix:** Die Bookmark-Dirty-Pruefung vergleicht vorerst nur noch die Menge der sichtbaren Layer gegen den Bookmark-Default. Opacity und Reihenfolge werden ignoriert.
- **Guardrail:** Fuer Stern/Undo bei URL-Bookmarks nur sichtbare Layer als Widerspruch werten. `layers=` in der URL beschreibt ausschliesslich sichtbare Layer; Opacity darf ohne belastbaren layerbezogenen Default nicht als Dirty-Kriterium dienen.

## 2026-06-02 — Framework-URL-Refresh muss waehrend URL-Override-Bookmark-Start eingefroren werden
- **Symptom:** Nach Start von `maps-dev/nw_oereb?...&layers=...&op=0.65` sprang der Permalink nach rund 12 bis 14 Sekunden kurz auf `op=0.7` und erst danach wieder zurueck auf `0.65`.
- **Root-Cause:** Die spaeten `ClassicLayerMgr.Activate`-/`switchLayersProgr`-Durchlaeufe kamen noch innerhalb des URL-Override-Starts, aber ausserhalb des bisherigen Initial-URL-Guard-Fensters von 8 Sekunden. Dadurch durfte der fruehe History-/Op-Guard zu frueh auslaufen und spaete Framework-Defaults wieder in den Permalink schreiben.
- **Fix:** Das Initial-URL-Guard-Fenster in Entry-HTML und `tnet-app.js` wurde auf 18 Sekunden verlaengert; der begleitende Op-Stabilisator laeuft passend laenger. Damit bleiben `layers=` und `op=` stabil, bis die spaeten Framework-URL-Rewrites abgeklungen sind.
- **Guardrail:** Bei URL-Override-Bookmarks die Guard-Dauer am realen Framework-Startup ausrichten, nicht an einem optimistischen Fruehfenster. Wenn spaete Layer-/Tool-Aktivierungen den Permalink noch ueberschreiben koennen, muss der Initial-URL-Guard bis nach diese Phase aktiv bleiben.

## 2026-06-02 — Eye-Toggle darf keinen Voll-Render des Karteninhalts triggern
- **Symptom:** Beim Umschalten der Augen im Karteninhalt wirkte das Eye instabil bzw. flackernd; gleichzeitig wurde der Permalink auch bei reinen Sichtbarkeitswechseln unnötig stark nachgezogen.
- **Root-Cause:** `toggleLayerEye()` emittierte neben `layer-visibility` zusätzlich `active-layers-changed`, obwohl sich die Liste der aktiven Themen gar nicht änderte. Der Karteninhalt reagierte dadurch mit einem kompletten `innerHTML`-Rebuild statt nur das betroffene Eye zu aktualisieren.
- **Fix:** Im Eye-Toggle-Pfad bleibt nur noch `layer-visibility` aktiv. Add/Remove-Operationen emittieren weiter `active-layers-changed`, reine Sichtbarkeitswechsel dagegen nicht mehr.
- **Guardrail:** Sichtbarkeit und Listenstruktur getrennt behandeln: `layer-visibility` fuer Icon-/Status-Updates, `active-layers-changed` nur wenn Eintraege wirklich hinzukommen, verschwinden oder umsortiert werden.

## 2026-06-03 — Initiale URL-Guards duerfen echte Karteninhalt-Aenderungen nicht mehr ueberschreiben
- **Symptom:** Nach einer Aenderung im Karteninhalt sprang die URL waehrend mehrerer Sekunden zwischen dem neuen Zustand und dem urspruenglichen Start-`layers=`/`op=` hin und her.
- **Root-Cause:** Der verlaengerte Initial-URL-Guard schuetzte zwar den Startup, blieb aber auch nach echten Sichtbarkeitswechseln aus dem Karteninhalt aktiv. Dadurch arbeiteten Initial-Guard und spaeterer Bookmark-URL-Sync gegeneinander.
- **Fix:** Der Bookmark-URL-Sync schaltet die initialen History-/HTML-Guards bei der ersten nicht-`bookmark-init`-Sichtbarkeitsaenderung ab, sobald sie vom urspruenglichen URL-Layerzustand wegfuehrt. Zusaetzlich reagiert der URL-Sync nur noch auf Aenderungen der sichtbaren Layer-Signatur.
- **Guardrail:** Startup-Guards muessen enden, sobald der User den Karteninhalt real veraendert. Ab diesem Moment ist nicht mehr der initiale Permalink, sondern der aktuelle Runtime-State die Wahrheit.

## 2026-06-02 — Coalesce-Reconcile darf Loading nicht ohne Renderaenderung neu starten
- **Symptom:** Nach dem Bookmark-Load blieb im Karteninhalt dauerhaft `lädt...`, obwohl der kombinierte `show:`-Layer bereits korrekt sichtbar war.
- **Root-Cause:** `_forceCoalesceGroupRender()` startete Loading bei jedem Reconcile erneut, auch wenn `LAYERS` und Sichtbarkeit unveraendert waren.
- **Fix:** Der Coalesce-Gruppenrenderer prueft nun `LAYERS` und Sichtbarkeit idempotent und startet Loading nur noch bei tatsaechlichen Renderaenderungen.
- **Guardrail:** Reconcile-Funktionen duerfen Ladefeedback nicht als Nebeneffekt jedes Abgleichs starten. Spinner nur bei echten Map-Param-/Visibility-Aenderungen aktivieren.

## 2026-06-02 — URL-Sync darf `op=` nicht aus Reconcile-Events neu berechnen
- **Symptom:** Nach URL-Bookmarks sprang `op=` im Permalink laufend zwischen Werten wie `0.65` und `0.7`, weil im Hintergrund Store-/Reconcile-Events konkurrierten.
- **Root-Cause:** Der Live-URL-Sync schrieb `op=` bei `layer-opacity` und `active-layers-changed` immer wieder aus dem aktuellen Runtime-State neu. Automatische Korrekturen und Framework-Defaults konnten dadurch den Permalink gegenseitig überschreiben.
- **Fix:** Der Bookmark-URL-Sync aktualisiert live nur noch `layers=`. Der urspruengliche URL-`op`-Wert wird beim Bookmark-Start gesichert und stabil gehalten; zusaetzlich faengt ein frueher History-Guard bereits die ersten Framework-`replaceState`-Aufrufe ab. `op=` wird nur entfernt, wenn die Anzahl der Opacity-Werte nicht mehr zur sichtbaren Layerliste passt.
- **Guardrail:** `op=` nie aus automatischen Reconcile-/Store-Events als Wahrheit neu berechnen. Opacity-Parameter sind optionaler URL-Input, waehrend `layers=` die sichtbare Layerliste beschreibt; fruehe URL-Snapshots muessen spaetere Framework-Rewrites uebersteuern.

## 2026-06-02 — URL-Bookmark muss layers-State live synchronisieren
- **Symptom:** Reloads von URL-Bookmarks wie `nw_oereb?...&layers=...` schalteten wieder die Bookmark-Defaults ein; nach Augen-Klicks blieb der `layers=`-Permalink ausserdem stale.
- **Root-Cause:** `startBookmarkFromUrl()` startete den Pfad-Bookmark ohne den vorhandenen `layers=`-Permalink-State an `TnetSetBookmark()` weiterzugeben; spaeteres Lesen war race-anfaellig, weil Framework/Hooks die URL bereits umschreiben koennen. Danach gab es keinen zentralen Runtime-State-zu-URL-Sync fuer Bookmark-Layer.
- **Fix:** Der Auto-Start sichert den initialen Query-String sofort beim Laden von `tnet-app.js` und uebergibt ihn als Override an den Bookmark-Helper. Der Helper wendet URL-Werte wie `lang`, `basemap`, `blop`, `x`, `y`, `zl`, `hl`, `layers` und `op` vor Bookmark-Defaults an und schreibt nach `layer-visibility`/`layer-opacity`/`active-layers-changed` den effektiven Runtime-State live nach `layers=` und `op=`.
- **Guardrail:** Bei Pfad-Bookmarks mit Query-State hat der Permalink immer Vorrang vor Bookmark-Defaults. URL-Parameter als User-Anpassung behandeln: Bookmark-Kontext laden, alle vorhandenen URL-Parameter anwenden, Abweichung markieren und danach `layers=` immer aus aktuellem Runtime-/Store-Zustand neu schreiben.

## 2026-06-02 — Karteninhalt und Karte muessen nach Combined-Layer-Aktionen reconciled werden
- **Symptom:** Der Karteninhalt zeigte Coalesce-/Combined-Sublayer als sichtbar, waehrend der gerenderte ArcGIS-Root-Layer nicht sichtbar war oder nur ein einzelnes `show:N` enthielt; nach Undo wurden Layer erst nach Auge aus/ein wieder dargestellt.
- **Root-Cause:** OL-Add/Remove-Events fuer dedizierte Sublayer wurden als Wahrheit fuer den Store interpretiert, obwohl derselbe Sublayer weiterhin in einem kombinierten Root-Layer (`LAYERS=show:...`) gerendert werden kann. Zusaetzlich lief der Reconcile teils vor den spaeten Framework-Layer-Manipulationen.
- **Fix:** Store↔Karte-Reconcile zentral nach `active-layers-changed`, `layer-visibility` und `layer-opacity` anstossen; sichtbare Sublayer serviceweit zu `show:a,b` zusammenfuehren; OL-Remove ignorieren, wenn der Sublayer weiterhin in einem sichtbaren combined Layer gerendert wird.
- **Guardrail:** Bei ArcGIS-Combined-/Coalesce-Layern darf ein einzelnes OL-Layer-Remove nie automatisch bedeuten, dass der Sublayer fachlich ausgeschaltet ist. Immer gegen den aktuellen Root-`show:`-Parameter und den Store-Sollzustand reconciliieren.

## 2026-06-02 — Stage-Build darf Quellen nie ueberschreiben
- **Symptom:** Ein Build-Test ohne explizite Roots konnte `maps-dev/tnet/js/` mit minifizierten Artefakten ueberschreiben; zusaetzlich blieb eine `tnet-prod-*.js` Temp-Datei in `js-stage/` liegen.
- **Root-Cause:** Die Default-Root-Erkennung im Build-Helfer war noch auf alte `js-dev -> js` Rollen ausgelegt und die Stage-Validierung pruefte nur fehlende, nicht aber ueberzaehlige Dateien.
- **Fix:** Build-Defaults auf `maps-dev/tnet/js -> maps-dev/tnet/js-stage` gesetzt, Output=Input als harten Fehler blockiert und PROD-Promotion auf exakte Source/Stage-Dateimenge gehaertet.
- **Guardrail:** Stage vor PROD-Promotion immer 1:1 gegen DEV-Originale validieren; Temp-Dateien oder fremde JS-Dateien in `js-stage/` muessen den Release stoppen.

## 2026-06-02 — PROD-Runtime-JS muss aus js-stage kommen
- **Symptom:** Nach `release-full.bat` wirkten PROD-JS-Dateien teilweise nicht minifiziert/obfuskiert oder konnten durch Promotion wieder als Originale in `maps/tnet/js/` landen.
- **Root-Cause:** DEV-Originale, PROD-Quellstand und PROD-Runtime nutzten zu lange dieselben Ordnerrollen (`js`, `js_ori`). Der PROD-Release baute/ladete inkrementell und war dadurch vom Upload-State sowie der Reihenfolge aus Promotion und Build abhängig.
- **Fix:** DEV baut lokal `maps-dev/tnet/js-stage/`; PROD kopiert Originale nach `maps/tnet/js-src/` und Stage-Artefakte nach `maps/tnet/js/`. Full-Release verwendet `--force-js`, damit Runtime-JS nach Stage-Kopie sicher hochgeladen wird.
- **Guardrail:** PROD-Runtime-JS darf nie direkt aus `maps-dev/tnet/js/` stammen. Standardpfad ist immer `maps-dev/tnet/js` → `maps-dev/tnet/js-stage` → `maps/tnet/js`; lesbare PROD-Quellen liegen in `maps/tnet/js-src`.

## 2026-06-03 — Ansichtswechsel im selben Bookmark darf keinen Full-Apply ausloesen
- **Symptom:** Bei `nw_agglomeration` schaltete `Standard` ↔ `test` die Themen nicht sauber um; nach dem Wechsel blieben teils keine sichtbaren Layer mehr uebrig.
- **Root-Cause:** `_applyBookmark()` behandelte einen reinen View-Wechsel innerhalb desselben Bookmarks wie einen kompletten Bookmark-Neuaufbau. Das Legacy-Full-Apply raeumte dabei Layer- und Runtime-Zustand unnoetig ab und lief in instabile Rebuild-Pfade.
- **Fix:** Derselbe Bookmark mit anderer `viewId` geht jetzt frueh ueber `_applyViewSwitchOnly()`, das nur die Layer-Sichtbarkeit umschaltet und Runtime/Store anschliessend auf die neue View synchronisiert.
- **Guardrail:** Wenn sich bei einem Bookmark nur die View aendert, niemals reflexartig `setMapBookmark`/Full-Apply verwenden. Erst den reinen Visibility-Diff-Pfad bevorzugen; Rebuild nur fuer echten Bookmark-Wechsel.

## 2026-06-03 — Reiner View-Switch darf nicht erneut Bookmark-API und Ready-Wait durchlaufen
- **Symptom:** Das Umschalten zwischen `Standard` und `test` funktionierte, fuehlte sich aber sehr langsam an.
- **Root-Cause:** `TnetSetBookmark()` lud auch beim Wechsel derselben bereits aktiven Karte das Bookmark erneut per API und wartete nochmals auf Framework-Readiness, obwohl `window.__tnetActiveBookmark._cfg` schon vorlag.
- **Fix:** Fuer denselben aktiven Bookmark mit geaenderter `viewId` nutzt `TnetSetBookmark()` jetzt direkt die vorhandene `_cfg` und springt sofort in `_applyBookmark()` bzw. den View-only-Pfad.
- **Guardrail:** Bei reinen Zustandswechseln innerhalb eines bereits geladenen Bookmarks niemals erneut Netzwerk-Load plus globalen Ready-Wait anhaengen, wenn derselbe Konfigurationsstand schon im Runtime-State vorhanden ist.

## 2026-06-03 — URL-Bookmark-Start braucht fruehes sichtbares Ladefeedback
- **Symptom:** Beim direkten Aufruf von `maps-dev/nw_agglomeration` sah der User erst die Grundkarte; der Fachinhalt und das geoeffnete Karteninhalt-Panel kamen erst Sekunden spaeter, wodurch der Start haengen geblieben wirkte.
- **Root-Cause:** Der URL-Autostart wartet still auf Helper-, AppManager- und LayerManager-Readiness, bevor `tnet-bookmark-loaded` ueberhaupt feuert. Bis dahin gab es im Karteninhalt weder geoeffnetes Panel noch sichtbaren Pending-Zustand.
- **Fix:** Der URL-Start setzt nun sofort einen globalen Pending-Bookmark-Status, das Karteninhalt-Panel oeffnet bereits in dieser Vorphase und rendert einen klaren Ladeblock, bis der echte Bookmark-Inhalt uebernimmt.
- **Guardrail:** Bei Legacy-Bookmark-Starts nie erst auf den finalen Apply-Event warten, bevor der UI-Zustand reagiert. Sobald die Zielkarte bekannt ist, muss die Oberflaeche einen sichtbaren Pending-State zeigen.

## 2026-06-03 — URL-Autostart darf nicht am LayerManager-Ready-Gate haengen
- **Symptom:** Die Bookmark-Hydrierung fuer `maps-dev/nw_agglomeration?...` begann erst viele Sekunden nach dem initialen Seitenstart, obwohl URL-Layer, `TnetSetBookmark` und `AppManager` bereits frueh verfuegbar waren.
- **Root-Cause:** `startBookmarkFromUrl()` wartete zusaetzlich auf `isLayerManagerReady()`. Dieser Zustand wurde im Legacy-Stack deutlich spaeter erreicht als die fuer `TnetSetBookmark()` wirklich noetigen Voraussetzungen.
- **Fix:** Der URL-Autostart startet jetzt, sobald `TnetSetBookmark` und `AppManager.setMapBookmark` verfuegbar sind. Der tiefere Framework-Ready-Wait bleibt zentral in `TnetSetBookmark()`.
- **Guardrail:** Readiness-Gates nur einmal an der owning abstraction halten. Wenn der Helper selbst auf Framework-Ready wartet, darf der Call-Site-Code kein zweites, strengeres Gate davorschalten.

## 2026-06-03 — URL-Override mit expliziten Layern darf keinen spaeten Full-Apply ausloesen
- **Symptom:** Eine URL wie `nw_agglomeration?...&layers=...` zeigte die Fachlayer zuerst korrekt und schnell, spaeter wurden sie jedoch durch einen Bookmark-Apply wieder geraeumt bzw. auf einen unvollstaendigen Zustand reduziert.
- **Root-Cause:** Beim initialen URL-Override-Start fuehrte `TnetSetBookmark()` spaeter noch einen kompletten `_applyBookmark()` aus. Dieser ruft `_clearThematicLayersBeforeBookmark()` auf und zerstoert damit den bereits korrekt aus der URL aufgebauten Kartenzustand.
- **Fix:** Fuer den initialen URL-Override-Start mit expliziten `visibleLayerIds` nutzt der Helper jetzt einen URL-Adopt-Pfad: Bookmark-Metadaten und Karteninhalt werden hydratisiert, ohne Karte/Layer per Full-Apply nochmals zu leeren und neu zu setzen.
- **Guardrail:** Wenn der Runtime-Kartenzustand bereits explizit aus der URL kommt, Bookmark-Metadaten nur noch an diesen Zustand andocken. Einen spaeten Full-Apply nur fuer Faelle verwenden, in denen der Bookmark den Kartenzustand wirklich erst herstellen muss.

## 2026-06-03 — Tree-Checkboxen muessen Bookmark-Sichtbarkeit, nicht nur OL-Renderzustand spiegeln
- **Symptom:** Im Themenkatalog blieben Gruppen- und Layer-Checkboxen leer, obwohl dieselben Themen bereits im Karteninhalt aktiv waren.
- **Root-Cause:** Der Tree nutzte fuer den Checked-State `isLayerEffectivelyVisible()`. Bei ArcGIS-/Bookmark-Layern kann dieser Render-Check kurzzeitig `false` liefern, obwohl Store und aktiver Bookmark die Layer bereits bewusst auf sichtbar gesetzt haben.
- **Fix:** Fuer Tree-Checkboxen und Gruppen-States wird jetzt ein eigener Requested-Visibility-Pfad genutzt, der zuerst den aktiven Store-/Bookmark-Zustand und erst danach den Katalog-Fallback liest.
- **Guardrail:** UI-Checkboxen im Themenkatalog duerfen nicht direkt vom tiefsten Render/OL-State abhaengen, wenn Bookmark- oder Bridge-Logik Layer vor der finalen OL-Hydrierung bereits als aktiv fuehrt.

## 2026-06-03 — Pending-Header darf nie rohe Bookmark-IDs anzeigen
- **Symptom:** Im Karteninhalt erschien beim schnellen URL-Start kurz `nw_agglomeration` statt des Anzeigenamens `Agglomerationsprogramm 2. Gen.`.
- **Root-Cause:** Der Pending-State erhielt beim URL-Autostart nur die Bookmark-ID und renderte diese sofort im Header, bevor der eigentliche Bookmark-Name nachgeladen war.
- **Fix:** Der Pending-State startet jetzt ohne rohe ID im Header, nutzt wenn verfuegbar einen gecachten Anzeigenamen und aktualisiert sich parallel ueber `TnetApi.listBookmarks()` auf den echten Kartennamen.
- **Guardrail:** Vorlaeufige Lade-UI darf nie interne IDs als Nutzertext zeigen, wenn ein Anzeigename asynchron nachgereicht werden kann. Im Zweifel neutralen Platzhalter statt technischen Key rendern.

## 2026-06-03 — Remove-Buttons im Karteninhalt muessen trotz Desktop-Overrides sichtbar bleiben
- **Symptom:** Das Entfernen-Kreuz war im Karteninhalt zwar im DOM vorhanden, blieb aber unsichtbar und nicht nutzbar.
- **Root-Cause:** Eine Desktop-CSS-Kombination reduzierte die Remove-Buttons effektiv auf `display:none` bzw. Breite 0, obwohl das Rendering korrekt war.
- **Fix:** Die Desktop-Regel fuer `.lm-btn-remove` erzwingt jetzt wieder ein sichtbares Flex-Layout.
- **Guardrail:** Bei interaktiven Action-Buttons im Legacy-Panel nach CSS-Refactors immer DOM und Computed-Style pruefe; vorhandenes Markup ohne sichtbare Box ist fast immer ein Styling-Regression, kein Render-Bug.

## 2026-06-03 — Active-Panel darf keine Container-Knoten als Einzel-Layer rendern
- **Symptom:** Beim Entfernen einzelner Layer aus einer Coalesce-/Bookmark-Gruppe sprang ploetzlich ein Parent-Knoten (z.B. `Motorisierter Individualverkehr (MIV)`) als eigener Layer-Eintrag unten in die Liste.
- **Root-Cause:** In der gemergten Active-Liste standen neben Blatt-Layern auch nicht-blattrige Katalogknoten (`type: group`) mit eigener ID. Beim Neu-Render nach einem Remove wurden diese Container als Standalone-Eintrag gerendert.
- **Fix:** Vor dem Rendern werden in `tnet-lm-active.js` nicht-blattrige Katalogknoten aus `effectiveLayers` herausgefiltert (`pruneContainerCatalogLayers`). Dadurch bleiben nur echte Layer-Zeilen sichtbar.
- **Guardrail:** Der Karteninhalt darf nur Blatt-Layer darstellen. Katalog-Container gehoeren in die Baumstruktur, nicht in die Active-Liste.

## 2026-06-03 — Ladehinweis nur bei echtem Pending-Zustand anzeigen
- **Symptom:** Im Karteninhalt blieb `Karte wird geladen...` sichtbar, obwohl Bookmark und Themen bereits voll geladen waren.
- **Root-Cause:** Der Header koppelte den Ladehinweis zusaetzlich an ein internes `_loadUntil`-Zeitfenster. Dieses kann nach erfolgreichem Load noch laufen und erzeugt dadurch einen falschen UI-Status.
- **Fix:** Der Ladehinweis wird jetzt nur noch bei echtem Pending-Bookmark (`__tnetPendingBookmarkLoad`) angezeigt, nicht mehr aufgrund eines Zeitfensters.
- **Guardrail:** Sichtbarer Ladezustand darf nur von echten Pending-/InFlight-Flags abhängen, nie von einer pauschalen Schonfrist.

## 2026-06-03 — Karteninhalt-Header nach "Karteninhalt leeren" sofort hard-resetten
- **Symptom:** Nach `Karteninhalt leeren` blieb kurz oder dauerhaft der alte Bookmark-Name im Header stehen.
- **Root-Cause:** Der Header wartete auf nachlaufende Store-Events; bei verzögerten/ausbleibenden Events blieb der alte Renderzustand sichtbar.
- **Fix:** Beim `remove-all` wird der Header sofort mit `render([])` neu gezeichnet, `__tnetActiveBookmark`/`__tnetPendingBookmarkLoad` werden geleert und URL-Hinweise per `__tnetSuppressUrlBookmarkHint` unterdrückt.
- **Guardrail:** Bei globalen Reset-Aktionen im Legacy-UI immer eine unmittelbare UI-Neuzeichnung erzwingen, statt ausschließlich auf asynchrone Event-Ketten zu vertrauen.

## 2026-06-01 — Deploy-Workflow braucht klare JS-Ordnerrollen
- **Symptom:** Nach PROD-Updates war unklar, ob `/maps/tnet/js` lesbare DEV-Dateien, DEV-Builds oder minifizierte PROD-Artefakte enthaelt; alte Temp-Dateien `tnet-prod-*.js` lagen im Runtime-Ordner.
- **Root-Cause:** `js-dev` und `js` wurden gleichzeitig als Quelle, Build-Ziel und Deploy-Signal verwendet. PROD-Promotion kopierte DEV 1:1 nach `maps`, danach wurde derselbe `js`-Ordner ueberschrieben; ein lesbarer PROD-Zwischenstand fehlte.
- **Fix:** DEV nutzt kuenftig `maps-dev/tnet/js` als direkte Original-Quelle. PROD-Promotion sichert den lesbaren Stand nach `maps/tnet/js_ori`; der PROD-Build erzeugt daraus `maps/tnet/js` und bereinigt alte `tnet-prod-*.js` Temp-Artefakte.
- **Guardrail:** Runtime-Pfad darf gleich bleiben (`tnet/js/...`), aber die Ordnerrolle muss pro Umgebung eindeutig sein: DEV `js` = Quelle, PROD `js_ori` = lesbare Quelle, PROD `js` = Build-Artefakt.

## 2026-06-01 — PROD-Templates duerfen keine absoluten DEV-Assetpfade enthalten
- **Symptom:** Nach einem PROD-Update lud `/maps/` TNET-JS/CSS weiterhin aus `/maps-dev/tnet/...`; PROD nutzte damit nicht zuverlaessig die minifizierten/obfuskierten Assets aus `maps/tnet/js`.
- **Root-Cause:** Die per Promotion kopierten HTML-Templates enthielten absolute `/maps-dev/tnet/...` Pfade; die nachgelagerte PHP-Transformation konnte nur kanonische `/maps/...` Pfade auf DEV umbiegen, nicht aber DEV-Pfade in PROD verhindern.
- **Fix:** TNET-Assetreferenzen in Desktop- und Mobile-Templates auf relative `tnet/...` Pfade umgestellt und die app-root String-Transformation im Entry entfernt; der Login-Redirect verwendet nun den ermittelten App-Root.
- **Guardrail:** Gemeinsame `maps`/`maps-dev` Templates duerfen fuer App-Assets keine absoluten `/maps` oder `/maps-dev` Pfade enthalten. Relative Pfade oder `window.__TNET_APP_ROOT` verwenden, damit DEV/PROD ohne Transform-Schritt korrekt laden.

## 2026-06-01 — Coalesce-Gruppenauge muss Root-Layer aktiv reconciliieren
- **Symptom:** Bei Gruppen wie `Kbs (rechtskräftig)` zeigte das Gruppenauge nach EIN einen sichtbaren Zustand, aber die Objekte wurden erst dargestellt, nachdem einzelne Unterlayer aus/ein geschaltet wurden.
- **Root-Cause:** Der Gruppenpfad aktualisierte Store/Kindzustände, aber bei Framework-kombinierten bzw. Bridge-verwalteten Coalesce-Layern wurde die tatsächliche Root-`LAYERS=show:...`-Liste nicht immer neu aufgebaut. Einzelkind-Toggles durchliefen den Register-/Show-Pfad und reparierten den Root-Layer dadurch nachträglich.
- **Fix:** Nach Gruppen-AUS/EIN wird der Coalesce-Root-Layer aktiv reconciled: sichtbare Kinder werden registriert/gezeigt, unsichtbare per Bridge versteckt, `activeSublayers` neu aufgebaut und der gerenderte OL-Layer direkt auf `show:<nums>` bzw. `show:-1` gesetzt.
- **Guardrail:** Gruppenaugen bei Coalesce nie nur als Store-Massenupdate behandeln. Nach jedem Gruppen-Toggle den tatsächlichen Root-Render-Layer gegen die sichtbare Kindliste abgleichen.

## 2026-06-01 — Objektinfo muss sichtbare Runtime-Layer filtern
- **Symptom:** Objektinformationen lieferten Resultate von ausgeschalteten Layern; gleichzeitig fehlten sichtbare Coalesce-Sublayer wie `Grundnutzung` teilweise in der Abfrage.
- **Root-Cause:** Die InfoBridge dispatchte stur `am.wmsActiveLyrs`; diese Framework-Liste kann nach Store-/Coalesce-Toggles stale sein. Der Coalesce-`queryconnector` liess ausserdem Root-Queries bei leerer `visibleSublayers`-Liste durch.
- **Fix:** Vor jedem Info-Klick synchronisiert die InfoBridge MapTips gegen den effektiven Store-/OL-Zustand. Der Coalesce-Queryconnector blockt nicht sichtbare Store-Sublayer und behandelt eine leere sichtbare Sublayer-Liste als „nichts abfragen“.
- **Guardrail:** Objektinfo nie direkt aus `wmsActiveLyrs` als Wahrheit ableiten. Vor dem Dispatch immer gegen den effektiven Karteninhalt/Store filtern; bei Coalesce ist eine leere `show:`-/visible-Liste ein harter Skip.

## 2026-06-01 — Ladefeedback darf nicht von zuverlässigen OL-End-Events abhängen
- **Symptom:** Langsame Layer wie KBS wirkten nach dem Einschalten sekundenlang inaktiv; ein reines `loadend`-Warten kann bei kombinierten/Framework-Layern zudem zu lange sichtbare Spinner oder falsche Fehler erzeugen.
- **Root-Cause:** Store und Karteninhalt setzten Sichtbarkeit sofort, aber es gab keinen UI-Zwischenzustand; einzelne OpenLayers-Sources liefern in diesem Legacy-Stack nicht immer passende End-Events für den konkreten Sublayer. Zusaetzlich koennen Tile-/Zwischenfehler auftreten, obwohl spaetere Kacheln/Bilder noch erfolgreich rendern.
- **Fix:** Der Store führt pro Layer `loading`/`loadingSlow`/`loadingError` und triggert es beim Einschalten. Der Karteninhalt rendert Spinner und Status direkt am Layer; fehlende End-Events laufen nach kurzer Zeit neutral aus, Tile-Fehler erzeugen keinen roten Layer-Fehler und Image-Fehler werden nur verzögert gewertet, falls kein Erfolg nachkommt. Wenn beim Wiedereinschalten gar kein Load-Event kommt (Cache/bereits gerendert), wird das Feedback vor `lädt noch...` neutral beendet.
- **Guardrail:** Ladefeedback in diesem Stack als UX-Zustand modellieren: sofort beim User-Toggle starten, OL-Events nutzen wenn vorhanden, aber niemals fehlende End-Events, einzelne Tile-Errors oder komplette No-Event-Cache-Faelle als Layerfehler werten.

## 2026-06-01 — Coalesce-Sublayer durfte nicht vom cEntry-Status abhängen
- **Symptom:** `Grundnutzung` wurde im Karteninhalt auf EIN gesetzt, erschien aber erst nach Group-AUS/EIN auf der Karte.
- **Root-Cause:** `toggleLayerEye` lief in den Coalesce-Pfad und verließ sich auf `cEntry`/Bridge-Status; bei Framework-kombiniertem `show:`-Layer wurde dadurch nicht immer der tatsächlich gerenderte OL-Layer aktualisiert.
- **Fix:** Coalesce-Toggle nutzt jetzt zuerst den Framework-Combined-Fast-Path (`_setFrameworkCombinedSublayer`) und schreibt direkt in den aktuellen `show:`-Layer; Bridge-Referenzen werden bei LAYERS-Updates zusätzlich auf verwaiste OL-Instanzen geprüft und neu aufgelöst.
- **Guardrail:** Bei Framework-kombinierten Sublayern immer zuerst den real gerenderten `show:`-Layer aktualisieren; Coalesce-Bookkeeping (`cEntry`) ist sekundär und kann stale sein.

## 2026-06-01 — Bookmark-View-Visibility muss Basis-Visibility uebersteuern
- **Symptom:** Baulinien Nationalstrassen war auf der Karte sichtbar, im Karteninhalt aber ohne aktives Auge; der erste Klick synchronisierte nur den Store statt den Layer auszuschalten.
- **Root-Cause:** `_syncBookmarkLayerStateToOL()` bewertete `cfg.layers[].visible:false` als explizite Wahrheit und ignorierte `views[].layerStates[id].visible:true` der aktiven NPL-View.
- **Fix:** Der OL-/Store-Sync nutzt jetzt die effektive Runtime-Visibility inkl. aktivem View-Override; externe WMS werden mit derselben Visibility/Opacity in Bookmark-State, Store und Karte geführt.
- **Guardrail:** Bei Schema-v2-Bookmarks darf nie direkt die Basis-Layer-Visibility als Wahrheit verwendet werden. Immer zuerst den aktiven View-State auflösen und daraus Runtime, Store und OL-Layer synchronisieren.

## 2026-06-01 — Lade-Flicker Teil 3 + Gruppen-Auge Teilzustand
- **Symptom A (Flicker):** Coalesce-Sublayer wurden trotz korrektem show:5,9 kurz alle gemalt und dann ausgeblendet.
- **Root-Cause A:** Adoptierter Framework-OL-Layer war visible:true mit show:all; das show:all-Bild war bereits in Flight → OL malte es, bevor updateParams den Subset reduzierte.
- **Fix A:** In `_setLayersOnSource` Sichtbarkeit an LAYERS koppeln: `olLayer.setVisible(layersParam !== 'show:-1')`. Bei show:-1 bleibt der Layer unsichtbar → in-flight show:all wird nie gemalt; erst wenn sichtbare Sublayer da sind wird er sichtbar und malt direkt den Subset.
- **Symptom B (Auge):** Gruppen-Auge zeigte keinen Teilzustand; Klick schaltete erst ALLE ein, dann ALLE aus → Initial-Subset ging verloren.
- **Fix B:** (1) Render in tnet-lm-active.js `_renderGroup`: partial = anyVisible && !allVisible → CSS-Klasse `lm-eye-partial` (opacity 0.5). (2) `toggleCoalesceGroupEye` in tnet-lm-store.js mit Snapshot: bei AUS aktuellen Subset in `info._eyeSnapshot` merken; bei EIN Snapshot wiederherstellen (statt alle). Per-Kind via bewährtem `toggleLayerEye`-Pfad (`_setCoalesceChildVisible`), damit Bridge-LAYERS/Store/Active-Liste konsistent bleiben.
- **Guardrail:** Gruppen-Auge nie den geteilten OL-Layer pauschal toggeln — immer per Kind über toggleLayerEye, damit der LAYERS-Subset und der gemerkte Teilzustand erhalten bleiben.

## 2026-06-01 — Lade-Flicker Teil 2: Framework-OL-Layer rendert show:all vor Debounce-Update
- **Symptom:** Beim Bookmark-Hard-Reload werden alle Coalesce-Sublayer kurz dargestellt und dann auf den korrekten Stand (z.B. show:5,9 / show:-1) reduziert.
- **Root-Cause:** Der adoptierte Framework-OL-Layer hat initial LAYERS=show:all; der korrigierende `_updateLAYERSDebounced` (80ms) feuert erst NACH der gesamten Registrierungs-Schleife → OL malt zwischenzeitlich alles.
- **Fix:** In tnet-coalesce-bridge.js (a) beim Adoptieren des Framework-Layers im Lade-Fenster sofort `_applyLAYERSParam` (anfangs show:-1), (b) `_updateLAYERSDebounced` wendet während `_isBookmarkLoadActive()` SOFORT an statt debounced. Updates sind additiv → nur progressives Aufdecken, kein show:all mehr.
- **Guardrail:** Bei Coalesce-Layern darf der kombinierte LAYERS-Param während des Bookmark-Loads nie kurz mehr Sublayer zeigen als der Endstand. Sofort-Apply im Lade-Fenster, Debounce nur für normale User-Klicks.

## 2026-06-01 — Lade-Flicker: Bookmark zeigt erst alle Coalesce-Sublayer, dann blendet aus
- **Symptom**: Beim Hard-Reload eines Bookmarks (z.B. `nw_oereb`) flackern Layer kurz auf und verschwinden wieder — sichtbares "laden und dann ausblenden".
- **Root-Cause**: Das Framework aktiviert beim Bookmark-Load ALLE Bookmark-Layer (`Layer ON (135)`). `registerSublayer` in der CoalesceBridge nahm jeden Sublayer bedingungslos in `visibleSublayers` auf → kombinierter `show:`-Parameter enthielt erst alle Indizes (z.B. `show:0,1,5,6,7,8,9,11,12`), und erst die Ensure-Logik im Helper blendete die `visible:false`-Sublayer danach aus (`show:5,9`).
- **Fix**: Lade-Fenster `__tnetActiveBookmark._loadUntil` (Date.now()+8000) im Helper gesetzt. `registerSublayer` prüft via `_isBookmarkSublayerHidden(sublayerKey)` die Bookmark-Sichtbarkeit und nimmt `visible:false`-Sublayer NICHT in `visibleSublayers` auf → `show:` ist von Anfang an korrekt. Accordion bleibt unberührt (kommt aus dem Store, nicht aus `visibleSublayers`). Zeitfenster verhindert, dass spätere Benutzer-Klicks unterdrückt werden.
- **Guardrail**: Bookmark-Visibility muss VOR dem Bau des kombinierten `show:`-Parameters greifen, nicht erst per nachträglicher Ensure-Korrektur — sonst paint-then-hide-Flicker. Korrektur am Punkt der `visibleSublayers`-Befüllung (`registerSublayer`), zeitlich auf das Lade-Fenster begrenzen.

## 2026-06-01 — Manuelles Ausschalten von ÖREB-Sublayern wirkte nicht auf der Karte
- **Symptom**: Im `nw_oereb`-Bookmark liessen sich Sublayer (gefahrenzone, laermempfindlichkeitsaufstufung) und der Standalone-Layer baulinien-nationalstrassen per Auge zwar im Zustand umschalten (Konsole zeigte AUS), blieben aber auf der Karte sichtbar.
- **Root-Cause**: ÖREB-/Bookmark-Layer werden vom Framework (`ClassicLayerMgr`) direkt in die OL-Karte geladen und tauchen **weder im Store-Katalog noch in `_activeLayers` auf** (`getCatalog().length === 0`, `getActiveLayers().length === 0`). Der Eye-Klick laeuft ueber `switchLayer` → unseren Patch → `forceMapLayerState`, das aber bei `if (!layer && !activeEntry) return;` sofort aussteigt und den Kartenzustand nie nachzieht. Store-basierte Helfer greifen mangels Store-Eintrag nicht.
- **Fix**: Neuer Helper `_reconcileUntrackedMapLayer(layerId, targetVisible)` in `tnet-lm-store.js`; `forceMapLayerState` ruft ihn im Frueh-Ausstieg auf. Er sucht per `_findAllOLLayers` alle OL-Layer mit exaktem Namen (Standalone wie auch Dedicated-Mode-Sublayer mit eigenem `show:N`) und setzt `setVisible`/Opacity hart auf den Zielzustand. Live verifiziert: gefahrenzone AUS blendet nur gefahrenzone aus (laerm bleibt), baulinien AUS unabhaengig, Wieder-EIN funktioniert.
- **Guardrail**: In diesem Stack sind Framework-/Bookmark-Layer (ÖREB) **nicht im Store**. Visibility fuer solche Layer immer direkt auf der OL-Karte per exaktem Layer-Namen abgleichen — `findLayer`/`_activeLayers` sind dort leer und duerfen nicht als Existenz-Gate fuer den Map-Sync dienen.

## 2026-05-29 — Coalesce-Sublayer ignorieren rohe OL-setVisible bei Bookmark-Visibility
- **Symptom**: ÖREB-Bookmark `nw_oereb` zeigte weiterhin zu viele Layer sichtbar (z.B. Lärmempfindlichkeitsaufstufung), obwohl sie als `visible:false` definiert waren — auch nach dem `setVisible(false)`-Fix.
- **Root-Cause**: Die meisten ÖREB-Layer sind Coalesce-Sublayer und besitzen keinen eigenen OpenLayers-Layer. Der `map.getLayers()`-Lookup fand nur Standalone-Layer (`gefahrenzone`); für alle Coalesce-Sublayer lief `if (!olLayer) return` ins Leere, sie blieben über den geteilten WMS-`LAYERS`-Parameter sichtbar.
- **Fix**: Neuer Helper `_setBookmarkLayerEye(layerId, false)` nutzt `TnetLMStore.toggleLayerEye()` (Coalesce-fähig) mit `_getEffectiveLayerVisible()` als Guard (toggelt nur bei abweichendem Zustand). Eingesetzt in `_scheduleBookmarkVisibilityEnsure`, `_syncBookmarkLayerStateToOL` und `_scheduleViewVisibilityWhenLayersReady` (Hide-Pfad); rohe `setVisible`-Lookups entfernt.
- **Guardrail**: Bookmark-/Layer-Visibility in diesem Stack nie über rohe OL-Layer-Lookups schalten — Coalesce-Sublayer sind virtuell. Immer Store-APIs (`toggleLayerEye`/`_getEffectiveLayerVisible`) verwenden, die Coalesce verstehen.

## 2026-05-29 — Bookmark-Start: visible:false Layer bleiben nach setMapBookmark sichtbar
- **Symptom**: Nach `TnetSetBookmark('nw_oereb')` blieben 4 Layer sichtbar, die im Bookmark als `visible:false` definiert waren.
- **Root-Cause**: `_scheduleBookmarkVisibilityEnsure` (mit 400/1200/3000ms Retry-Timern) war zwar implementiert, wurde aber nie aus `_applyBookmark` aufgerufen. Der `add`-Listener allein reichte nicht, da das Framework nach dem `add`-Event noch eigene Visibility-Resets durchführt.
- **Fix**: `_scheduleBookmarkVisibilityEnsure(visibilityMap, ensureToken)` in `_applyBookmark` direkt nach `_scheduleViewVisibilityWhenLayersReady` eingebaut. Die Timer korrigieren zuverlässig alle `visible:false`-Layer nach dem Framework-Load.
- **Guardrail**: Bookmark-Visibility-Correction immer als zweistufig anlegen: (1) `add`-Listener für sofortige Korrektur, (2) Retry-Timer als Absicherung gegen Framework-eigene Post-Load-Resets.

## 2026-05-29 — Bookmark-Direktstart darf Views nicht implizit als Default behandeln
- **Symptom**: Beim Direktstart von Karten wie `nw_oereb` sprang der Bookmark ungefragt in die einzige vorhandene View und blendete danach Layer wieder aus dem Kartenbild aus.
- **Root-Cause**: Die Bookmark-Logik behandelte eine einzelne vorhandene View implizit wie einen Default und kombinierte das mit einem nachgelagerten Visibility-Ensure, der den normalen Bookmark-Start nochmals ueberschrieb.
- **Fix**: `tnet-mapplus-helpers.js` nutzt eine View nur noch bei explizitem `view=` oder bei `isDefault:true`; der aggressive Post-Load-Visibility-Ensure bleibt aus dem normalen Bookmark-Start draussen.
- **Guardrail**: In Bookmark-Schema-v2 gilt nur `isDefault:true` oder ein explizit angeforderter `viewId` als aktive View. Eine einzelne vorhandene View ist fachlich nicht automatisch der Startzustand.

## 2026-05-29 — Themenkatalog und Karteninhalt muessen gegen denselben Laufzeitzustand synchronisieren
- **Symptom**: Nach externen Aktivierungen, Bookmark-States oder Coalesce-Pfaden konnte der Themenkatalog einen anderen Sichtbarkeitszustand zeigen als der Karteninhalt bzw. die Karte selbst.
- **Root-Cause**: Sichtbarkeits-Guards und Gruppenstatus stuetzten sich teilweise auf rohes `layer.visible` aus dem Katalog, waehrend Active-Entry und OL-Layer bereits einen abweichenden Laufzeitzustand hatten.
- **Fix**: `tnet-lm-store.js` bewertet Sichtbarkeit jetzt ueber den effektiven Laufzeitzustand und synchronisiert interne Drift ohne unnoetigen zweiten Map-Toggle; `tnet-lm-tree.js` zieht Checkboxen per Vollabgleich auf `active-layers-changed` nach.
- **Guardrail**: In diesem Stack duerfen Themenkatalog und Karteninhalt nie lokale UI-Annahmen als Wahrheit verwenden. Massgeblich ist immer der effektive Store-/Runtime-Zustand.

## 2026-05-29 — Karteninhalt darf keine nicht renderbaren Bookmark-Layer anzeigen
- **Symptom**: Im Karteninhalt erschienen Bookmark-Eintraege, deren Sichtbarkeit sich nicht verlaesslich schalten liess, weil sie technisch gar keinen belastbaren Layer im Themenkatalog bzw. Store hatten.
- **Root-Cause**: Bookmark-Layer wurden im Active-Panel direkt mit dem Live-State gemischt; dabei konnten unbekannte IDs als reine Bookmark-Stubs bis ins UI durchrutschen.
- **Fix**: `tnet-lm-store.js` filtert beim Bookmark-Load nicht renderbare IDs heraus und baut dafuer einen performanten Layer-Index auf; `tnet-lm-active.js` filtert Bookmark-Layer vor dem Merge zusaetzlich ueber dieselbe Store-Regel.
- **Guardrail**: Active-Panels duerfen nur Layer rendern, die im Store belastbar aufloesbar oder explizit als Spezialfall verwaltet sind. Bookmark-Stubs gehoeren nie direkt ins UI.

## 2026-05-29 — Bookmark-Start muss den Karteninhalt aktiv fokussieren
- **Symptom**: Beim Start eines Bookmarks blieb im Sidepanel oft der Themenkatalog offen, obwohl der Bookmark-Inhalt im Karteninhalt kontrolliert werden sollte.
- **Root-Cause**: Das Bookmark-System emitierte bereits die passenden Events, aber das Active-Panel reagierte nur mit Re-Render und schaltete die sichtbare Desktop-/Mobile-UI nicht auf den Karteninhalt um.
- **Fix**: `tnet-lm-active.js` fokussiert bei `tnet-bookmark-loaded` gezielt das Karteninhalt-Panel: Desktop oeffnet `tp_sort_menu` und schliesst `tp_overview_menu`, Mobile wechselt vom Layers-Sheet auf `openActiveSheet()`.
- **Guardrail**: Wenn Bookmark-Flow und Ziel-UI bereits ueber Events gekoppelt sind, gehoert der Fokuswechsel ins owning UI-Modul statt in den Bookmark-Core.

## 2026-05-29 — Grundkarten-Defaults duften nicht an dauerhaft gesetzten Bookmark-Markern haengen
- **Symptom**: Der Schutz gegen Grundkarten-Overrides beim Bookmark-Start hing an globalen Bookmark-Markern und blieb dadurch potenziell laenger aktiv als der eigentliche Startup-Moment.
- **Root-Cause**: `tnet-basemap.js` pruefte pauschal auf `__tnetActiveBookmark` bzw. `__tnetLastRequestedBookmark`, waehrend `__tnetLastRequestedBookmark` im Bookmark-Flow nie wieder geloescht wurde.
- **Fix**: Der Basemap-Guard nutzt jetzt einen kurzen Zeitkorridor ueber `__tnetLastRequestedBookmarkAt`; `TnetSetBookmark()` schreibt dafuer bei jedem Request einen Timestamp statt nur eines dauerhaften Namensmarkers.
- **Guardrail**: Startup-Guards fuer Bookmark-Races immer zeitlich oder phasenbasiert modellieren, nie ueber dauerhaft gesetzte globale Flags.

## 2026-05-29 — Logout in Edit musste den zentralen ADFS-Signout treffen
- **Symptom**: UI zeigte zwar `Logout`, aber die Abmeldung lief nur app-lokal und entsprach nicht dem gewuenschten zentralen SSO-Signout.
- **Root-Cause**: Logout-Link zeigte auf app-/core-lokale Endpunkte statt auf den ADFS-Endpoint mit `wa=wsignout1.0`.
- **Fix**: In `edit/index.php` wurde das Logout-Ziel im UI-Patch auf `https://idp.gis-daten.ch/adfs/ls/?wa=wsignout1.0&wreply=...` umgestellt; `wreply` verweist auf die Edit-App.
- **Guardrail**: Bei OIDC/ADFS-Setups Logout-Endpunkte immer gegen den IdP-Flow validieren. Ein lokaler Logout-Link reicht oft nicht fuer echtes SSO-Signout.

## 2026-05-29 — Edit-Toolbar nutzte fuer Login kein klassisches Anchor-Element
- **Symptom**: `Angemeldet als: ...` wurde korrekt angezeigt, aber der sichtbare Toolbar-Eintrag blieb bei `Login` und bot kein funktionierendes Logout.
- **Root-Cause**: Der Login-Eintrag wurde in der Legacy-Toolbar als generisches UI-Element (Label/Container mit `title`) gerendert, nicht als `a[href*="/core/sso/login.php"]`. Der erste Patch traf daher nur den Anchor-Fall.
- **Fix**: `applyEditAuthUi()` in `edit/index.php` erweitert: neben Anchor-Update werden auch Toolbar-Labels (`Login`/`Anmelden`) und `title`-basierte Container erkannt, auf `Logout`/`Abmelden` umgestellt und per `onclick` auf `/core/sso/logout.php?site=edit` verdrahtet.
- **Guardrail**: In Legacy-Dojo-Toolbars Login/Logout nie nur über `a[href]` umschalten. Immer zusätzlich text- und title-basierte UI-Knoten berücksichtigen.

## 2026-05-29 — Edit zeigte trotz gueltiger Session weiter den Login-Link
- **Symptom**: In `/edit` blieb nach erfolgreichem OIDC-Login der sichtbare Login-Button bestehen; ein klarer Hinweis auf den angemeldeten Benutzer fehlte.
- **Root-Cause**: Der Legacy-Header in `edit` schaltete die Login-UI nicht aktiv um, obwohl `app_username` in der Session vorhanden war. `njs.AppManager.auth_user` wurde zudem unsicher als roher String in JS injiziert.
- **Fix**: In `edit/index.php` wurde `auth_user` sicher per `json_encode(...)` eingebettet, die Originalzeile dokumentiert auskommentiert belassen und ein kleiner UI-Patch ergänzt (Login-Link -> `/core/sso/logout.php`, Text auf `Logout`, Badge `Angemeldet als: ...`).
- **Guardrail**: Bei Legacy-UIs nach Auth-Fixes immer auch die sichtbare Header-Logik pruefen. Sessionstate allein reicht nicht, wenn Login-/Logout-Elemente clientseitig nicht explizit aktualisiert werden.

## 2026-05-29 — target-Parameter stapelte sich ueber Entry-Redirects und verstaerkte Redirect-Loops
- **Symptom**: URLs wuchsen auf `...&target=...&target=...` an; Browser endete bei `ERR_TOO_MANY_REDIRECTS`.
- **Root-Cause**: Entry-Redirects zu `/mapplus-protected/` haengten `target=` immer an den bestehenden Query-String an, ohne bereits vorhandenes `target` vorher zu entfernen.
- **Fix**: In `maps/index.php` und `maps-dev/index.php` wird vor dem Redirect `$_SERVER['QUERY_STRING']` geparst und `target` entfernt; danach wird genau ein frisches `target=` gesetzt.
- **Guardrail**: Bei Redirect-Ketten mit Steuerparametern (`target`, `redirect`, `returnTo`) immer zuerst existierende Werte deduplizieren, dann exakt einen neuen Wert setzen.

## 2026-05-29 — Redirect-Loop durch konkurrierende PHPSESSID-Pfade zwischen Login-Bridge und App
- **Symptom**: Browser meldete `ERR_TOO_MANY_REDIRECTS` zwischen `/mapplus-protected/` und `/maps-dev/` bzw. `/maps/`; IDP-Dialog erschien teils nicht oder nur kurz.
- **Root-Cause**: `mapplus-protected/index.php` nutzte einen anderen Session-Cookie-Pfad als der Ziel-Entry. Dadurch existierten parallel mehrere `PHPSESSID`-Cookies, und der Entry sah den in der Bridge gesetzten OIDC-Sessionstate nicht.
- **Fix**: In `mapplus-protected/index.php` wird der Session-Cookie-Pfad vor `session_start()` dynamisch aus `target` abgeleitet (`/<app>/`). So teilen Bridge und Ziel-Entry denselben Session-Cookie.
- **Guardrail**: Bei Login-Bridges muss der Session-Cookie-Pfad mit dem Ziel-Entry konsistent sein. Unterschiedliche Cookie-Pfade mit gleichem Cookie-Namen erzeugen schwer erkennbare Redirect-Loops.

## 2026-05-29 — Anmelden-Button baute auf cleanen URLs einen ungueltigen Query-Start
- **Symptom**: Klick auf "Anmelden" in `/maps-dev/` bzw. `/maps/` zeigte keinen IDP-Dialog; der Login-Flow sprang nicht in den SSO-Zweig.
- **Root-Cause**: Das OnClick hing immer `&group=?` an `window.location.href`. Ohne vorhandene Query wurde damit kein gueltiger Query-Start erzeugt.
- **Fix**: In Desktop/Mobile-Templates auf bedingte Verknuepfung umgestellt: bei fehlendem `?` zuerst `?group=?`, sonst `&group=?`.
- **Guardrail**: Beim clientseitigen URL-Aufbau nie blind `&` anhaengen. Immer zuerst pruefen, ob bereits Query-Parameter vorhanden sind.

## 2026-05-29 — mapplus-protected auf generische target-Weiterleitung vereinfacht
- **Symptom**: Starre App-Checks in der Login-Bridge machten Rueckspruenge unflexibel und erschwerten neue Einstiegspfade.
- **Root-Cause**: Der Redirect-Teil war auf explizite Ziel-Whitelists/Fallback-Mappings zugeschnitten statt auf einen generischen Pfadfluss.
- **Fix**: `mapplus-protected/index.php` leitet jetzt generisch ueber `target` weiter, normalisiert nur den Pfad (`/`, `.../`, fehlendes `.php`) und behaelt bestehende Query-Parameter; `target` selbst wird vor der Rueckleitung entfernt.
- **Guardrail**: Fuer flexible Einstiege den Ruecksprungpfad im Entry setzen (`target`) und in der Bridge nur minimale Normalisierung vornehmen, statt App-Namen fest zu verdrahten.

## 2026-05-29 — Redirect-Kette brach bei group=%3F im Login-Ruecksprung
- **Symptom**: Aufrufe ueber `/mapplus-protected/?target=...&group=%3F` endeten in fehlerhaften bzw. wiederholten Redirects statt stabil im Ziel-Einstieg.
- **Root-Cause**: Der Query-Parameter `group=?` wurde unveraendert in den Ziel-Redirect uebernommen und kollidierte mit der spaeteren Gruppenauflosung im Entry-Flow.
- **Fix**: Entscheidend war nicht das Filtern von `group=?`, sondern die korrekte Query-Verkettung im Login-Button (`?group=?` oder `&group=?`). In `mapplus-protected/index.php` bleibt `group` unveraendert erhalten, weil `group=?` im Legacy-Entry den Auth-Zweig bewusst triggert.
- **Guardrail**: In diesem Legacy-Flow ist `group=?` ein technischer Trigger und darf in der Login-Bridge nicht entfernt werden. Stabilitaet entsteht ueber korrekten URL-Aufbau im Frontend, nicht ueber pauschales Filtern des Parameters.

## 2026-05-29 — mapplus-protected war fest auf /maps verdrahtet und brach Rueckspruenge fuer maps-dev/edit
- **Symptom**: Login ueber `/mapplus-protected/` landete immer in `/maps`, auch wenn der Aufruf aus `/maps-dev` oder `/edit` kam.
- **Root-Cause**: In `mapplus-protected/index.php` war der Erfolgs-Redirect statisch auf `/maps/index.php` gesetzt.
- **Fix**: Der Redirect nutzt jetzt ein validiertes Ziel (`target` oder fallback `app`) mit Whitelist auf `/maps/index.php`, `/maps-dev/index.php`, `/edit/index.php`; Aufrufer senden ihr Ziel explizit als `target` mit.
- **Guardrail**: Login-Bridges duerfen Zielpfade nie hart codieren und nie frei uebernehmen; immer explizit uebergeben und serverseitig whitelisten.

## 2026-05-29 — Edit-Entry liess geschuetzten Bereich ohne expliziten OIDC-Guard laufen
- **Symptom**: Aufrufe in `edit/index.php` konnten ohne klaren Vor-Redirect in einen inkonsistenten SSO-Flow fallen.
- **Root-Cause**: Der Legacy-Flow verliess sich nur auf `sso.php/auth.php`, ohne vorab hart zu pruefen, ob `OIDC_CLAIM_group` bereits vorhanden ist.
- **Fix**: In `edit/index.php` vor dem Auth-Include einen expliziten OIDC-Check eingefuegt; bei fehlendem Claim Redirect auf `/mapplus-protected/` inkl. Query-String. `app_group/app_profile` werden defensiv aus der Session gelesen.
- **Guardrail**: In alten Entry-Skripten zuerst harte Session-Vorbedingung pruefen (OIDC-Claim), danach erst Legacy-Auth-Includes ausfuehren.

## 2026-05-28 — Bookmark-Initialload liess den Karteninhalt leer, obwohl der Bookmark geladen war
- **Symptom**: Beim Direktstart eines Bookmarks unter `/maps-dev/{id}` blieb der Bereich Karteninhalt leer, obwohl die Karte und der Bookmark-Aufruf selbst liefen.
- **Root-Cause**: Der Karteninhalt hing weiterhin am asynchronen Map-Sync des LMStore. Nach dem Deaktivieren von `loadActiveLayersFromBookmark()` gab es beim Bookmark-Start keinen fruehen Datenpfad mehr fuer die UI, daher renderte das Panel leer.
- **Fix**: Der Bookmark-Apply-Pfad baut jetzt sofort einen Runtime-Layerstand aus dem Bookmark-JSON auf, speichert ihn in `window.__tnetActiveBookmark.layers`, befuellt parallel den LMStore wieder direkt aus dem Bookmark und synchronisiert spaeter eintreffende OL-Layer ueber einen Layer-Add-Hook auf Visibility/Opacity.
- **Guardrail**: Der Karteninhalt darf beim Bookmark-Start nie ausschliesslich von spaet eintreffenden Map-Events abhaengen. Bookmark-JSON muss immer sofort einen renderbaren Layerzustand fuer die UI liefern.

## 2026-05-28 — FastAPI-Bookmark-Deploy brach an geschuetztem PHP-Load und fehlendem dulwich ab
- **Symptom**: `POST /gapi/ags2mapplus/deploy-bookmarks?target=dev` lieferte 500; der direkte Browseraufruf per GET zeigte 405.
- **Root-Cause**: Der Deploy-Handler holte Bookmarks zunaechst ueber `treebuilder-api.php?action=bookmarks-load`, das hinter dem Admin-Gate Login-HTML statt JSON lieferte. Nach der Umstellung auf direkten SFTP-Read scheiterte der naechste Schritt daran, dass `dulwich` im laufenden FastAPI-Prozess noch nicht verfuegbar war.
- **Fix**: FastAPI liest Bookmark-Drafts jetzt direkt per SFTP aus `/data/tmp/maps(-dev)/bookmarks/map-bookmarks-all.json` und faellt bei Bedarf auf die deployed JSON-Datei zurueck. Fuer Git-Schritte muss `dulwich` in der Server-Python-Umgebung installiert sein; nach einer Nachinstallation ist ein Dienst-Neustart noetig.
- **Guardrail**: Interne Deploy-Pfade nie ueber login-geschuetzte HTTP-Admin-Endpunkte aufloesen, wenn SFTP/Dateizugriff verfuegbar ist. Bei optionalen Python-Abhaengigkeiten immer Installation und Neustart des laufenden Dienstes zusammen pruefen.

## 2026-05-28 — Bookmark-Publish hing implizit am globalen DEV-Fetch-Wrapper
- **Symptom**: Im Bookmarks-Tab war fuer `maps-dev` nicht transparent bzw. nicht robust abgesichert, ob der Publish wirklich nach DEV ging.
- **Root-Cause**: `saveBookmarks()` schickte an `/deploy-bookmarks` nur die Commit-Message. Das Ziel `dev` kam damit nur indirekt ueber den globalen `fetch()`-Wrapper in die Query-String-Parameter.
- **Fix**: Die Bookmarks-Deploy-Requests in `slm.html` und `ags-import.html` senden das Publish-Ziel jetzt explizit im JSON-Body (`target: dev|prod`). Die UI zeigt das vom Backend bestaetigte Ziel anschliessend sichtbar in der Statusmeldung an.
- **Guardrail**: Bei umgebungssensitiven Publish-Aktionen das Ziel nie nur implizit ueber Wrapper oder URL-Umschreibung ableiten. Das Frontend muss `target` explizit mitsenden und die Backend-Response sichtbar auswerten.

## 2026-05-28 — PROD-Upload startete trotz Full-Build erneut Einzelbuilds fuer JS
- **Symptom**: Nach Schritt 2 liefen in Schritt 3 fuer `tnet/js-dev/*.js` nochmals Einzelbuilds an, obwohl die passenden Dateien unter `tnet/js/` bereits gebaut waren.
- **Root-Cause**: `upload_changed.py` hat bei jedem JS-Quellfile pauschal den Einzelbuild gestartet und den vorhandenen Build-Output nicht darauf geprueft, ob er bereits aktuell ist.
- **Fix**: Der Upload leitet jetzt zuerst das Ziel unter `tnet/js/` ab und vergleicht dessen mtime mit der Quelldatei. Nur wenn der Output fehlt oder aelter ist, wird noch gebaut; sonst laeuft der Upload mit `BUILD-SKIP` direkt weiter.
- **Guardrail**: Wenn ein Workflow einen vorgelagerten Full-Build hat, darf der Upload-Schritt Build-Artefakte nicht blind neu erzeugen. Erst Zielpfad und Aktualitaet pruefen, dann gegebenenfalls gezielt nachbauen.

## 2026-05-28 — Code-Only-Deploy wirkte bei ausgeschlossenen Assets haengengeblieben
- **Symptom**: Der PROD-Deploy schien in der Konsole bei Dateien wie `clipboard.svg` stehenzubleiben, obwohl diese im Code-Only-Modus gar nicht deployt werden sollten.
- **Root-Cause**: `upload_changed.py` listete zuerst alle geaenderten Dateien roh auf und filterte erst danach auf `php/js/html/htm`. Dadurch sah die letzte sichtbare Datei wie ein haengender Upload aus, obwohl sie spaeter nur ausgeschlossen wurde.
- **Fix**: Die Filterung laeuft jetzt vor der Detailausgabe. Im Code-Only-Modus werden nur noch echte Deploy-Kandidaten gelistet; der Upload selbst zeigt zusaetzlich einen klaren Fortschrittszaehler `[aktuell/gesamt]` pro Datei.
- **Guardrail**: Bei gefilterten Deploys nie ungefilterte Rohlisten als Hauptfortschritt anzeigen. Konsolen-Ausgabe muss immer dem tatsaechlichen Arbeitsset entsprechen, sonst werden harmlose Filterphasen als Haenger fehlinterpretiert.

## 2026-05-28 — Basemap-Grauschalter toggelte den Zustand, aber die Darstellung wechselte sichtbar nicht
- **Symptom**: Der FARBE/GRAU-Schalter wurde geklickt, aber die Basemap blieb optisch unveraendert oder verlor den Zustand nach einem Basemap-Wechsel.
- **Root-Cause**: Mehrere konkurrierende Graustufen-Pfade hatten sich ueberlagert: globale Framework-Filter auf `.ol-layer`, experimentelle Source-Wrappers und der eigentliche `prerender/postrender`-Pfad. Dadurch wurde entweder der falsche Layer beeinflusst oder der sichtbare Basemap-Layer gar nicht mehr konsistent getroffen.
- **Fix**: Aktive Basemap-Layer werden jetzt zentral aufgeloest, Framework-Filter werden aus dem Steuerpfad entfernt und der Zustand wird nur noch ueber den Render-Hook auf den aktiven Basemap-Layern gesetzt. Nach Basemap-Wechsel wird derselbe zentrale Pfad ueber `syncGrayscale(true)` erneut angewendet.
- **Guardrail**: Visuelle Zustandslogik fuer Basemaps darf nur einen einzigen Besitzer haben. Sobald mehrere Filterpfade parallel existieren, wird Debugging unzuverlaessig und Basemap-Wechsel brechen den Zustand leicht wieder auf.

## 2026-05-29 — Non-Coalesce-Layer erschien doppelt im Karteninhalt
- **Symptom**: Layer aus dem Themenkatalog (z.B. `hangneigungen_bund`) erschien nach dem ersten Aktivieren zweimal im Karteninhalt-Panel.
- **Root-Cause**: `setLayerVisible` cachte `activeEntry = this._findActiveLayer(layerId)` vor dem Aufruf von `TnetLayerSwitch`. Dieser rief synchron `forceMapLayerState` auf (via `ClassicLayerMgr.switchLayer`-Patch), der den Layer bereits zu `_activeLayers` pushte. Danach nutzte `setLayerVisible` das veraltete `activeEntry = null` und pushte erneut.
- **Fix**: Nach `TnetLayerSwitch` wird nicht mehr das gecachte `activeEntry` geprüft, sondern `_findActiveLayer` erneut aufgerufen (`alreadyActive`). Nur bei `!alreadyActive` wird gepusht.
- **Guardrail**: Keinen Zustand vor synchron auslösenden Seiteneffekten cachen. Immer erst nach dem Aufruf prüfen, ob ein Eintrag bereits existiert.

## 2026-05-28 — Basemap-Graustufe wirkte nicht und wurde beim Basemap-Wechsel nicht wieder angewendet
- **Symptom**: Der Schalter `FARBE/GRAU` hatte auf die Basemap keine sichtbare Wirkung; nach Basemap-Wechsel blieb der Zustand zudem unberuecksichtigt.
- **Root-Cause**: `_applyGrayscaleViaPrerender()` in `tnet-basemap.js` war faktisch nur noch Diagnose-Code: Listener wurden geloescht, aber keine `prerender/postrender`-Handler mehr auf den aktiven Basemap-Layern registriert.
- **Fix**: Die Funktion registriert wieder echte `prerender/postrender`-Handler auf dem aktuell aktiven Basemap-Layer bzw. dessen Kind-Layern, inklusive Fallback auf den real in der Karte liegenden `isBaseLayer`. Beim Entfernen/Setzen wird `layer.changed()` aufgerufen, damit Farbe/Grau sofort neu gerendert wird.
- **Guardrail**: Temporaere DOM-/Renderer-Diagnostik nie in der produktiven Graustufen-Pipeline stehen lassen. Wenn eine Funktion visuelle Zustandslogik steuert, muss sie nach dem Cleanup immer den konkreten Render-Pfad wieder herstellen oder explizit frueh `return`en.

## 2026-05-19 — FastAPI-Publish schrieb DEV-Konfigurationen potenziell nach PROD
- **Symptom**: `maps-dev`-UIs sendeten zwar `target=dev` an `/gapi/ags2mapplus`, FastAPI-Publish-Endpunkte konnten aber weiterhin harte PROD-Pfade wie `/www/core` oder `/www/maps` verwenden.
- **Root-Cause**: `ags2mapplus_api.py` und `ags2mapplus_lyrmgr.py` hatten globale PROD-Konstanten fuer Staging, Core/NLS, LyrMgr, Legendtuner, Bookmarks und Git-Pfadmapping; `deploy-staged-conf` akzeptierte pauschal `/www/...`.
- **Fix**: DEV/PROD-Zielresolver in FastAPI eingefuehrt. `target=dev` routet nun auf `/data/tmp/maps-dev`, `/www/core-dev` und `/www/maps-dev`; Publish/Delete/Git-Endpunkte validieren Pfade gegen Ziel-Whitelists und geben Ziel/Deploy-Pfade explizit in der Response aus.
- **Guardrail**: Frontend-Parameter wie `target=dev` reichen nie allein. Der Backend-Publish muss Zielpfade selbst aufloesen und falsche DEV/PROD-Kombinationen aktiv ablehnen.

## 2026-05-19 — maps-dev hatte noch harte /maps-API-URLs in Admin-UI und LayerManager-Config
- **Symptom**: Die `maps-dev`-Admin/Test-Seiten und der neue LayerManager konnten trotz getrenntem App-Root noch Endpunkte unter `/maps` ansprechen.
- **Root-Cause**: Mehrere Admin-HTML-Dateien enthielten absolute `/maps/...` Links und `tnet-global-config.json5` setzte `layerManager.apiUrl` hart auf `/maps/tnet/api/v1/layers.php`; `tnet-lm-store.js` uebernahm diese URL ohne App-Root-Normalisierung.
- **Fix**: Admin/Test-Seiten auf relative URLs umgestellt, DEV-Config auf `/maps-dev/tnet/api/v1/layers.php` gesetzt und `tnet-lm-store.js` normalisiert `/maps`/`/maps-dev` API-Pfade defensiv auf den aktuellen App-Root.
- **Guardrail**: In `maps-dev` duerfen UI-Links und Config-URLs nie absolute `/maps`-Endpunkte enthalten. Client-Code, der Config-URLs ausfuehrt, muss bekannte App-Root-Pfade normalisieren.

## 2026-05-19 — DEV-DB-Schema wurde durch Config-to-DB nicht angelegt
- **Symptom**: `maps-dev` sollte `mapplusconf_dev` verwenden, das Schema war aber noch nicht angelegt; der SLM-Button `Config → DB` zielte zudem hart auf `/maps`.
- **Root-Cause**: `admin?action=schema` fuehrte `schema.sql` roh aus, wodurch `CREATE SCHEMA mapplusconf` und `SET search_path TO mapplusconf` nicht auf das aktive DEV-Schema umgeschrieben wurden. Der UI-Button startete nur `configToPG`, nicht vorher die Schema-Initialisierung.
- **Fix**: `Database::rewriteSql()` schreibt nun auch `CREATE SCHEMA` und `SET search_path` auf das aktive Schema um. `Config → DB` nutzt den aktuellen App-Root und ruft vor dem Import `admin?action=schema` auf.
- **Guardrail**: DEV-DB-Aktionen muessen immer erst das aktive Schema (`Database::getSchema()`) verwenden und duerfen keine hart kodierten `/maps`-URLs oder `mapplusconf`-DDL ausfuehren.

## 2026-05-19 — maps-dev fiel bei fehlenden DEV-Core-Pfaden auf PROD-Core zurueck
- **Symptom**: `maps-dev` konnte trotz vorhandenem `/www/core-dev` weiterhin Dateien aus `/www/core` oder app-lokalen `maps-dev/core`-Overrides verwenden.
- **Root-Cause**: `TnetCorePaths` hatte DEV-Fallbacks auf `core`, und einzelne DEV-Einstiege nutzten direkte `../core`-Includes bzw. Treebuilder-Override-Pfade.
- **Fix**: DEV-Core-Aufloesung strikt auf `core-dev` umgestellt; direkte Includes laufen ueber `TnetCorePaths::resolveCoreFile()`, Treebuilder-Override-Konstanten zeigen in DEV auf `CORE_CONFIG_DIR`/`CORE_NLS_DIR`.
- **Guardrail**: DEV darf fuer Core-Ressourcen nie still auf PROD-Core fallen. Wenn `core-dev` fehlt, muss der Fehler sichtbar werden statt produktive Dateien zu laden.

## 2026-05-19 — DEV/PROD-Trennung fuer Core, Build, DB und FastAPI
- **Symptom**: DEV konnte trotz eigenem `maps-dev` weiterhin gemeinsame Core-Dateien, minifizierte DEV-Builds, PROD-DB-Schema und FastAPI-Publikationsziele verwenden.
- **Root-Cause**: Die Trennung war an mehreren Stellen nur ueber App-Pfade umgesetzt; Core-Config/NLS, JS-Buildmodus, PostgreSQL-Schema und ags2mapplus-Ziel waren nicht zentral environment-aware.
- **Fix**: `TnetCorePaths` fuer `core-dev`/`core` eingefuehrt, DEV-JS-Build ohne Minify umgesetzt, `Database.php` auf `mapplusconf_dev` fuer DEV vorbereitet und FastAPI-Aufrufe aus DEV mit `target=dev` versehen.
- **Guardrail**: Jede neue DEV/PROD-Trennung braucht einen zentralen Resolver oder Modusparameter. Keine Runtime-Komponente darf ihr Ziel aus hart codierten PROD-Pfaden ableiten.

## 2026-05-19 — Admin-Setup schreibt in falschen DEV-Datenpfad
- **Symptom**: Erstmaliges Admin-Passwort auf `/maps-dev` meldete `Einrichtung fehlgeschlagen (Dateisystem-Fehler)`, obwohl SFTP-Verzeichnisse angelegt wurden.
- **Root-Cause**: `AdminAuth` leitete fuer DEV `/data/Client_Data/nwow-dev/tmp` ab. Der bekannte schreibbare PHP-Tmp-Bereich liegt aber unter `/data/Client_Data/nwow/tmp` (SFTP-Sicht: `/data/tmp`).
- **Fix**: Admin- und Access-Konfigurationsdateien liegen nun immer unter `/data/Client_Data/nwow/tmp`; DEV nutzt getrennte Dateinamen `admin-env-dev.json` und `access-config-dev.json`.
- **Guardrail**: Bei PHP/SFTP-Pfaden immer PHP-Sicht und SFTP-Sicht auseinanderhalten. Fuer DEV/PROD-Trennung im gemeinsamen Tmp-Bereich lieber eindeutige Dateinamen statt erfundene Datenroots verwenden.

## 2026-05-19 — DEV raw-conf nutzt nicht beschreibbaren nwow-dev-Tmp-Root
- **Symptom**: AGS-Import/Raw-Conf-Funktionen auf `/maps-dev` zielten auf `/data/Client_Data/nwow-dev/tmp/raw-conf` und scheiterten an fehlenden Schreibrechten.
- **Root-Cause**: `treebuilder-api.php` leitete temporaere Arbeitsverzeichnisse aus `CLIENT_DATA_ROOT` ab; fuer DEV zeigte dieser Root auf einen nicht dauerhaft beschreibbaren Datenbaum.
- **Fix**: Neuer `TNET_TMP_ROOT`: PROD nutzt `/data/Client_Data/nwow/tmp/maps`, DEV nutzt `/data/Client_Data/nwow/tmp/maps-dev` (SFTP-Sicht: `/data/tmp/maps` bzw. `/data/tmp/maps-dev`). Raw-Conf, ImportToCore, Layertree, StageConf, Legend- und Bookmark-Drafts haengen daran.
- **Guardrail**: DEV/PROD-Trennung fuer beschreibbare Runtime-Arbeitsdaten immer unter dem bekannten schreibbaren Tmp-Root mit Umgebungs-Unterordner loesen, nicht ueber separate ClientData-Roots.

## 2026-05-19 — PROD Runtime-Tmp-Daten lagen flach unter /data/tmp
- **Symptom**: Nach der DEV-Trennung lagen PROD-Arbeitsdaten weiter flach unter `/data/tmp/raw-conf`, `/data/tmp/ImportToCore`, usw.; das war inkonsistent zur DEV-Struktur.
- **Root-Cause**: Historisch war PROD der implizite Default im gemeinsamen Tmp-Root. Dadurch hatten Scripts und Runtime-Code keinen expliziten Environment-Unterordner fuer `/maps`.
- **Fix**: PROD nutzt nun `/data/Client_Data/nwow/tmp/maps` (SFTP-Sicht: `/data/tmp/maps`), DEV `/data/Client_Data/nwow/tmp/maps-dev`. Bestehende PROD-Verzeichnisse und Admin-Dateien wurden per SFTP in den neuen `maps`-Ordner verschoben.
- **Guardrail**: Runtime-Tmp-Daten immer unter expliziten App-Ordnern halten (`maps`, `maps-dev`). Deploy-/Migrationsskripte duerfen nicht mehr vom flachen `/data/tmp` als PROD-Default ausgehen.

## 2026-04-30 — DEV lud nach Fix weiterhin gecachte modules.js und Legacy-tnet_toc
- **Symptom**: `/maps-dev` startete trotz lokaler Fixes unvollstaendig; `njs.AppManager.Maps.main` blieb leer und der Browser lief in `layout.js:initTitleFreePaneItems` auf `Cannot read properties of null (reading 'style')`.
- **Root-Cause**: Remote-DEV hatte zwar die gepatchte `public/config/modules.js`, die Seite lud aber weiter `modules.js?v=v4.0.0` aus dem Cache. Zusaetzlich zeigte der `tnet_toc.js`-Script-Tag noch auf den alten Legacy-Pfad `/tnet/tnet_toc.js`, waehrend der Build nach `/tnet/js/tnet_toc.js` deployt.
- **Fix**: DEV-HTML auf `/tnet/js/tnet_toc.js` umgestellt und den `modules.js`-Query-String fuer DEV gebumpt. Danach wurde der vorhandene `<details>`-Monkey-Patch fuer `initTitleFreePaneItems` live und die App initialisierte wieder bis `tnet-app-ready`.
- **Guardrail**: Nach Upload von Einstiegsskripten mit stabilen Query-Strings immer Cachebuster pruefen. Legacy-Script-Pfade muessen zum Build-/Deploy-Ziel passen, sonst landet der Fix nicht im Browser.

## 2026-04-30 — maps-dev/js-dev enthielt irrtuemlich minifizierte Build-Artefakte
- **Symptom**: Fast alle Dateien unter `maps-dev/tnet/js-dev` waren Einzeiler, obwohl die Originalquellen unter `maps/tnet/js-dev` lesbar und unminifiziert sind.
- **Root-Cause**: Beim initialen DEV-Seed wurden offenbar Dateien aus dem Build-Ziel `tnet/js` statt aus dem Source-Ziel `tnet/js-dev` nach `maps-dev/tnet/js-dev` uebernommen.
- **Fix**: `maps-dev/tnet/js-dev` aus den lesbaren Originalquellen `maps/tnet/js-dev` restauriert. DEV-spezifische Runtime-Normalisierung fuer Proxy-/Service-URLs danach wieder in `tnet-lm-store.js` und `tnet-coalesce-bridge.js` als lesbaren Source-Code eingepflegt.
- **Guardrail**: Bei DEV/PROD-Sync immer Source nach Source (`js-dev -> js-dev`) und Build-Output nach Build-Output (`js -> js`) kopieren. Nach Seed per Zeilenzahl/Stichprobe pruefen, dass `js-dev` keine Einzeiler-Artefakte enthaelt.

## 2026-04-30 — DEV normalisiert PROD-Proxy-Pfade aus Layer-Configs erst zur Laufzeit
- **Symptom**: DEV erzeugte trotz korrektem App-Root weiterhin Proxy-URLs wie `/maps-dev//maps/tnet/agsproxy/...` oder lieferte in `flat=true` alte Config-URLs wie `/maps/agsproxy.php?path=...` aus.
- **Root-Cause**: Layer-Configs und DB-Importe enthalten historisch PROD-Webpfade (`/maps/...`). Das ist fuer Produktion gueltig, wurde aber beim Ausliefern in DEV nicht an der API-Grenze normalisiert; Client-Code hat nur den aktuellen Root erkannt und alte absolute App-Pfade erneut geprefixt.
- **Fix**: `layers.php` normalisiert `url` und `serviceUrl` vor der JSON-Ausgabe auf den aktuellen App-Root (`/maps` oder `/maps-dev`). `tnet-lm-store.js` und `tnet-coalesce-bridge.js` normalisieren zusaetzlich defensiv vor der OL-Source-Erzeugung.
- **Guardrail**: Config-Dateien duerfen kanonische PROD-Pfade behalten. Environment-Wechsel gehoert an die Runtime-Grenze (API/Client-Normalisierung), nicht in eine massenhafte Config-Umschreibung oder relative Pfadlogik.

## 2026-04-30 — AGS-Proxy-URLs in layers.php liefen auf maps-dev in falsche App-Roots
- **Symptom**: Coalesce-Layer erzeugten auf DEV Proxy-Requests wie `/maps-dev//maps/tnet/agsproxy/...` bzw. zwischenzeitlich `/tnet/agsproxy/...` oder `/maps-dev/tnet/api/v1/tnet/agsproxy/...`, wodurch ArcGIS-Requests fehlschlugen.
- **Root-Cause**: `tnet/api/v1/layers.php` setzte `serviceUrl` fuer Coalesce-Knoten noch mit hart codiertem `/maps/tnet/agsproxy/`. Beim ersten Fix war zusaetzlich `$appBasePath` in `enrichCoalesceWalk()` nicht im Scope; danach zeigte sich noch, dass die API-Root-Hilfe faelschlich das komplette Skriptverzeichnis statt nur `/maps` oder `/maps-dev` lieferte.
- **Fix**: In `layers.php` eine app-root-basierte Aufloesung auf den ersten Pfadteil (`/maps` oder `/maps-dev`) eingebaut, `$appBasePath` in `enrichCoalesceWalk()` per `global` verfuegbar gemacht und die `serviceUrl` daraus erzeugt. DEV-Datei anschliessend gezielt nach `/www/maps-dev/tnet/api/v1/layers.php` hochgeladen und gegen den Live-JSON-Output verifiziert.
- **Guardrail**: API-Endpunkte duerfen fuer Webpfade nie `dirname($_SERVER['SCRIPT_NAME'])` als App-Root missverstehen. Fuer Multi-App-Setups immer nur den ersten App-Pfadteil (`/maps`, `/maps-dev`) ableiten und in rekursiven Helfern explizit in den Scope holen.

## 2026-04-30 — DEV-Upload uebersprang maps-dev-JS-Builds wegen hart verdrahteter maps-Pfade
- **Symptom**: Nach lokalem Seed `maps -> maps-dev` blieb `/maps-dev/nw_oereb` serverseitig unvollstaendig; zentrale Assets wie `tnet-lyrmgr-patch.js`, `tnet-log.js`, `tnet-icons.js`, `tnet-mapcontrols.js` und `tnet-coalesce-bridge.js` liefen auf `/www/maps-dev` in 404.
- **Root-Cause**: `_upload_changed.py` baut geaenderte `tnet/js-dev/*` Dateien vor dem Upload einzeln ueber `_build_js.py`. Das Build-Skript kannte aber nur die fest verdrahteten `maps/tnet/js-dev` und `maps/tnet/js` Wurzeln. Bei `maps-dev` wurde der Output dadurch auf den Inputpfad zurueckgerechnet und esbuild brach mit `Refusing to overwrite input file` ab.
- **Fix**: `_build_js.py` auf pfadbasierte Root-Erkennung fuer `maps` und `maps-dev` umgestellt. Danach den DEV-Upload mit `--allow-config --reason ...` erneut ausgefuehrt; die zuvor fehlenden Build-Artefakte wurden erfolgreich nach `/www/maps-dev/tnet/js` hochgeladen und die 404s waren weg.
- **Guardrail**: Build-/Deploy-Skripte fuer Einzeldateien duerfen `maps` und `maps-dev` nie ueber hart kodierte Output-Wurzeln unterscheiden. Die Zielwurzel muss immer aus dem uebergebenen Quellpfad abgeleitet werden.

## 2026-04-30 — Remote-DEV kann trotz identischem Local-Tree auf altem Einstiegspunkt stehen
- **Symptom**: `/maps-dev/nw_oereb` zeigte noch das alte Panel-Layout und lud zentrale Assets wie `tnet-log.js`, `tnet-mapcontrols.js`, `tnet-sidepanel.css` und `tnet-coalesce-bridge.js` nicht, obwohl lokal `maps/` und `maps-dev/` bereits denselben Stand hatten.
- **Root-Cause**: Nicht der Local-Tree war auseinander, sondern der Remote-Stand unter `/www/maps-dev`. Dort lagen `index.php`, `public/index_de.htm` und `public/config/modules.js` noch in einer älteren Version, sodass DEV weiterhin den alten Einstiegspfad auslieferte.
- **Fix**: Unterschied zuerst mit Local-Hashes und cache-busted Remote-Fetches getrennt verifiziert, danach die drei DEV-Einstiegsdateien gezielt per Active-File-Upload nach `/www/maps-dev` hochgeladen und die Route erneut gegen PROD validiert.
- **Guardrail**: Bei DEV/PROD-Mismatch immer zuerst `lokal gleich?` und `remote gleich?` getrennt prüfen. Ein erfolgreiches Changed-Files-Deploy oder identische lokale Bäume beweisen nicht, dass der Remote-Einstiegspunkt schon synchron ist.

## 2026-04-30 — maps-dev griff im Treebuilder und in JS-Modulen weiterhin auf prod-Pfade zu
- **Symptom**: Trotz getrennter Deploy-Ziele landeten API-, Proxy-, Config- und Bookmark-Zugriffe in Teilen weiterhin unter `/maps` bzw. `/data/Client_Data/nwow` statt unter der aktiven App-Root.
- **Root-Cause**: Die Trennung war zuerst nur im Deploy umgesetzt; mehrere Runtime-Module und `treebuilder-api.php` konstruierten Web- und Datenpfade weiterhin statisch für Produktion.
- **Fix**: App-Root zentral aus `SCRIPT_NAME` bzw. `window.__TNET_APP_ROOT` abgeleitet und daraus Webroot-/Cookie-/Config-/Tmp-Pfade aufgebaut. In `treebuilder-api.php` zusätzlich einen zentralen `CLIENT_DATA_ROOT` und `toSftpPath()` eingeführt.
- **Guardrail**: Bei Multi-Environment-Setups nie `'/maps'`, `'/www/maps'` oder `'/data/Client_Data/nwow'` direkt in Runtime-Code verdrahten. Immer erst App-Root und Daten-Root zentral auflösen und alle Folgepfade daraus ableiten.

## 2026-04-30 — Directory-Index-Requests verloren den App-Root und luden /maps-Assets in /maps-dev
- **Symptom**: Die DEV-Startseite unter `/maps-dev/` lief mit `window.__TNET_APP_ROOT = ''` an und zog CSS/JS weiter aus `/maps/tnet/...`, was Folgefehler wie `TnetLog is not defined` auslöste.
- **Root-Cause**: Die Root-Erkennung in `index.php` leitete den App-Root nur aus `dirname($_SERVER['SCRIPT_NAME'])` ab. Bei Directory-Index-Requests kann dieser Wert leer bzw. `/` sein, obwohl der Request faktisch unter `/maps-dev/` läuft.
- **Fix**: Fallback auf den ersten Pfadteil aus `REQUEST_URI` eingebaut und damit `/maps` bzw. `/maps-dev` robust auch ohne explizites `index.php` im Request erkannt. Die API-Discovery in `info.php` verwendet denselben Request-basierten App-Root.
- **Guardrail**: Für Root-/App-Erkennung nie nur `SCRIPT_NAME` vertrauen. Bei Verzeichnis-Requests immer einen Fallback auf den Pfadanteil aus `REQUEST_URI` einbauen.

Symptom: Im SLM-Staging war nur das ImportToCore-Kürzel als veraltet markiert, nicht aber die betroffenen raw-conf-Dienste links in der Quellenliste.
Root-Cause: Die Re-Stage-Erkennung existierte nur auf Kürzel-Ebene; die Manifest-/Change-Daten wurden nicht auf die linke Dienstliste projiziert.
Fix: Im linken Staging-Listing werden Dienste jetzt anhand der gecachten ImportToCore-Manifestdaten markiert und mit Re-Stage-Hinweis pro betroffenem Kürzel versehen.
Guardrail: Wenn Change-Detection für Kürzel vorhanden ist, immer auch prüfen, ob die zugrunde liegenden Quellenlisten dieselbe Information sichtbar machen.

## 2026-04-22 — Nach erneutem Stagen blieben alle Dienste als "Service nicht mehr in raw-conf" markiert
- **Symptom**: Trotz frischem Staging zeigte `checkSourceChanges()` 100/100 Services als fehlend; Badge "0 Quellen (keine Basis)" bzw. "100 Änderungen" liess sich nicht wegbekommen.
- **Root-Cause**: `checkSourceChanges()` prüfte ausschliesslich `is_dir($rawDir . '/' . $svcKey)`. Die tatsächliche raw-conf-Struktur ist jedoch **flach** — alle Dienste liegen als Dateien (`layers_TNET_<svc>.conf`, `maptips_TNET_<svc>.conf`, …) direkt im `raw-conf`-Root, ohne Unterverzeichnis pro Service. Damit schlug `is_dir()` für jeden Dienst fehl.
- **Fix**: `checkSourceChanges()` akzeptiert jetzt beide Strukturen — Verzeichnis-basiert und flach. Für flache Dienste wird raw-conf einmalig via `scandir()` + `extractServiceFromFilename()` indexiert und pro Manifest-Source gegen den Index verglichen (Size + mtime, deleted/added).
- **Guardrail**: Wenn `stageServicesToImportToCore()` und `listRawConf()` mehrere Strukturen (Verzeichnis + flach) unterstützen, muss jede downstream-Logik (Change-Detection, Deletion, Preview) beide Strukturen ebenfalls gleichwertig behandeln.

## 2026-04-23 — SLM ohne Login erreichbar, API-Calls lieferten Login-HTML ("Unexpected token '<'")
- **Symptom**: Im InPrivate-Fenster (ohne Admin-Cookie) lud `slm.html` komplett, Datenbereiche zeigten aber `Fehler: Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
- **Root-Cause**: Zwei Lücken: (1) Die Rewrite-Regel `slm.html → admin-gate.php` stand nur in `/www/maps/tnet/api/v1/.htaccess`, wurde aber nie erreicht, weil die übergeordnete `/www/maps/tnet/api/.htaccess` bei existierenden Dateien ein `RewriteRule ^ - [L]` setzt und damit das Rewriting für den per-dir-Context stoppte, bevor die Child-Rule greifen konnte. Die `.html` wurde direkt als statische Datei ausgeliefert. (2) `admin-gate.php` delegierte den Auth-Check ausschliesslich an `enforceEndpointPolicy()` — ohne vorhandene `access-config.json` bzw. ohne Eintrag in `restricted_html` kam die Policy beim "public"-Fallback raus.
- **Fix**: (1) In `/www/maps/tnet/api/.htaccess` eine explizite Admin-HTML-Regel **vor** der Existenzprüfung ergänzt: `RewriteRule ^v1/(slm|ags-import|tree-builder|dev-test|tree-test)\.html$ v1/admin-gate.php?page=$1 [L,QSA]`. (2) `admin-gate.php` ruft jetzt unbedingt `AdminAuth::requireAuth(false)` (fail-closed, kein IP-Bypass) bevor die HTML ausgeliefert wird. (3) In `slm.html` zusätzlich `window.fetch`-Wrapper installiert, der bei HTML/401-Response einen prominenten Login-Banner mit Link einblendet, statt JSON-Parser-Fehler zu produzieren.
- **Guardrail**: Admin-HTML-Seiten müssen IMMER über ein PHP-Gate ausgeliefert werden — die Rewrite-Regel dafür gehört in die **oberste** .htaccess des Pfades (vor jedem generischen Existenz-Check), sonst wird die statische Datei direkt serviert. Defense-in-depth: Das Gate selbst muss fail-closed sein (harter `requireAuth`), nicht nur via Policy-Konfiguration. Frontend-seitig zentraler fetch-Wrapper erkennt Auth-Fehler und bietet Login-Pfad.

## 2026-04-23 — Folge-Bug nach Fail-Closed-Fix: ERR_TOO_MANY_REDIRECTS für whitelisted IPs
- **Symptom**: Nach dem Fail-Closed-Fix für `admin-gate.php` lief der Browser in `ERR_TOO_MANY_REDIRECTS`, sobald die Client-IP in der `access-config.json`-Whitelist stand. Zusätzlich ignorierte das Gate den im Zugriffsschutz-Tab gewählten Modus "Öffentlich" und erzwang trotzdem Login.
- **Root-Cause**: `admin-gate.php` hatte einen fest kodierten `requireAuth(false)` — der die Endpoint-Policy komplett aushebelte. Dadurch: (a) public/IP-Whitelist-Konfigurationen wurden ignoriert, (b) bei whitelisted IPs im Modus `restricted_with_ip_html` entstand ein Loop (Gate erzwingt Cookie → Login sieht Whitelist-IP → leitet zurück auf Zielseite → Gate → Login → …).
- **Fix**: `admin-gate.php` ruft wieder ausschliesslich `AdminAuth::enforceEndpointPolicy($page, 'html')` auf. Die Policy selbst ist bereits fail-closed bei fehlender Config (`requireAuth(false)` im Fallback-Zweig) und respektiert sonst die vom Benutzer im SLM-Zugriffsschutz-Tab gewählten Modi (`restricted_html` / `restricted_with_ip_html` / `public`). Der Schutz vor öffentlich erreichbaren Admin-Seiten bleibt durch die `.htaccess`-Rewrite-Regel bestehen, die jede `.html` zwingend durch das Gate leitet.
- **Guardrail**: Gate-Logik darf die konfigurierbare Policy nicht überstimmen. Wenn fail-closed gewünscht ist, gehört das Verhalten in die zentrale `enforceEndpointPolicy()` (bereits der Fall) — nicht in duplizierte Hard-Checks an jeder Einstiegsstelle. Bei Redirect-Loops immer prüfen, ob zwei Stellen unterschiedliche Policies für denselben Endpoint erzwingen.
# AI Lessons Learned — MAP+ / TNET

> Dokumentation konkreter Fehler und deren Lösungen.
> Wird von der KI nach jedem Bug-Fix ergänzt.
> Format: Symptom → Root-Cause → Fix → Guardrail

---

## 2026-03-22 — Resize-Handle: Panel wächst nach oben statt nach unten
- **Symptom**: Ziehen des unteren Resize-Handles (nach tp_sort_menu) nach unten vergrössert das Panel visuell nach oben statt nach unten.
- **Root-Cause**: Beide Handles nutzten gekoppeltes Resize: Wenn tp_sort_menu wächst, schrumpft tp_overview_menu darüber → alles verschiebt sich nach oben → visuell wächst das Panel nach oben.
- **Fix**: Kopplung nur für das Handle ZWISCHEN den Panels (erstes Panel, Index 0). Das Handle nach dem letzten Panel resized unabhängig (`siblingCfg = null`).
- **Guardrail**: Bei gekoppeltem Accordion-Resize: Kopplung nur am Splitter zwischen zwei Panels anwenden. Handles am Rand eines Panels dürfen nicht rückwärts auf Geschwister-Panels wirken.

## 2026-03-22 — Scrollbar im Sidepanel verursachte Inhalts-Sprung und wirkte zu dominant
- **Symptom**: Beim Erscheinen/Verbergen der Scrollbar verschob sich der Inhalt; gewünscht war eine dezente, leicht transparente Scrollbar ohne Layout-Resize.
- **Root-Cause**: Scroll-Container nutzten uneinheitliches `overflow-y`/Scrollbar-Styling (teils auto/ausgeblendet), wodurch der verfügbare Inhaltsraum je nach Scroll-Zustand wechselte.
- **Fix**: Für V2-Container (`.lm-cat-content`, `#tp_sort_menu > .tnet-panel-content`) auf stabile Scrollbar umgestellt: `overflow-y: scroll`, `scrollbar-gutter: stable both-edges`, dünne leicht transparente Thumb-Farbe, keine Scrollbar-Buttons.
- **Guardrail**: In UI-Containern mit fester Breite Scrollbar-Platz immer stabil reservieren, damit Inhalt beim Scrollbar-Zustandswechsel nicht springt.
- **Update**: Scroll muss auf den echten inneren Zielcontainern liegen (`.lm-cat-content` und `#lm-active-container`), nicht auf Outer-Wrappern. Nur so bleiben Scrollbars visuell identisch und Resize-Effekte klar sichtbar.

## 2026-03-22 — Sidepanel-Höhen waren initial zu gross und korrigierten sich erst nach Interaktion
- **Symptom**: Das Sidepanel war beim ersten Render teilweise zu hoch; erst nach Resize oder anderer Benutzerinteraktion wurden die Höhen korrekt geklemmt.
- **Root-Cause**: Die initiale Höhenberechnung lief, bevor Tree-/Panel-Inhalte, Fonts und finale Containerhöhen vollständig stabil waren.
- **Fix**: In `tnet-accordion-resize.js` gestaffelte Reflows nach Init/Load/Fonts-Ready ergänzt sowie `ResizeObserver` auf `#spring`/`#freepane` und zusätzlich `MutationObserver` auf `#spring` (childList + open/class/style), damit auch reine DOM-Änderungen ohne Container-Resize automatisch nachgeklemmt werden.
- **Guardrail**: Bei dynamisch gerenderten Panel-Layouts nicht nur auf Fenster-Resize verlassen; zusätzlich Mutation-basierte Nachkorrektur einbauen.
- **Update**: Observer-Refresh während aktivem Drag (`window.__tnetResizing`) unterdrücken, sonst wird die alte gespeicherte Höhe beim Ziehen zurückgesetzt und der Resize-Handle wirkt defekt.

## 2026-03-22 — Gesamtes Sidepanel scrollte statt nur der inneren Bereiche
- **Symptom**: Das komplette linke Sidepanel liess sich vertikal scrollen; der Panel-Footer wirkte nicht sauber an die Fensterhöhe gekoppelt.
- **Root-Cause**: `#freepane` und `#spring` hatten eine content-getriebene Höhe mit Outer-Scroll (`overflow-y: scroll`) statt einer strikt viewportgebundenen Panel-Hülle.
- **Fix**: `#freepane` auf feste Höhe `calc(100vh - 69px)` gesetzt, Outer-Overflow auf `hidden` umgestellt und Scroll nur noch in inneren Content-Bereichen belassen; Content-Caps für Katalog und aktive Themen konservativer gesetzt.
- **Guardrail**: Das Gesamtpanel selbst darf nicht scrollen. Scroll-Verhalten nur auf dedizierte innere Listen-/Content-Bereiche legen.

## 2026-03-22 — Sidepanel überläuft, untere Accordions verschwinden
- **Symptom**: Im linken Panel lief der Inhalt nach unten über; untere Accordion-Bereiche waren nicht mehr erreichbar/sichtbar.
- **Root-Cause**: `#spring` war als nicht-schrumpfender Flex-Block (`flex: 0 0 auto`) mit content-getriebener Höhe konfiguriert; zusätzlich konnten Panel-Inhalte zu gross für kleine Viewports werden.
- **Fix**: `#spring` auf flexiblen Scrollbereich umgestellt (`flex: 1 1 auto`, `min-height: 0`, `height: auto`) und Panel-Content-Höhen per `min(..., calc(100vh - ...))` viewportbasiert gedeckelt.
- **Guardrail**: In vertikalen Flex-Layouts mit Scrollcontainern immer `min-height: 0` auf dem Scroll-Child setzen und feste Panel-Höhen gegen `100vh` clampen.

## 2026-03-22 — Resize-Handles wirkten zu transparent und zu massiv
- **Symptom**: Divider zwischen Accordion-Panels waren sichtbar, wirkten aber zu durchsichtig und optisch zu dominant.
- **Root-Cause**: Handle-Styles nutzten RGBA-Farben mit Transparenz im Normal-/Hover-/Active-State.
- **Fix**: Handle-Farben auf deckende Vollfarben umgestellt (`background`, `border`, `::before`-Grip), Höhe schlank bei 5px belassen.
- **Guardrail**: Für funktionale UI-Trennelemente in dichtem Panel-Layout bevorzugt deckende Farben verwenden; Transparenz nur gezielt für dekorative Elemente.

## 2025-07-11 — PDF-Export nordgerichtet obwohl Druckrahmen rotiert ist
- **Symptom**: Frame auf Karte mit ~-24° CSS-Rotation; PDF-Ausgabe ist nordgerichtet (0°).
- **Root-Cause**: `template-pdf-export.js` berechnet `rotRad = map.getView().getRotation()` und ignoriert `options.rotation` (Grad, vom Slider). Da Map-View nie mehr gedreht wird (nur noch CSS-Frame), bleibt `rotRad = 0`.
- **Fix**: `rotRad` in `template-pdf-export.js` um `options.rotation`-Fallback ergänzt: `(typeof options.rotation === 'number' && options.rotation !== 0) ? options.rotation * Math.PI / 180 : map.getView().getRotation()`.
- **Guardrail**: Wenn Map-Rotation via CSS-Transform (nicht View) gelöst wird, muss `options.rotation` immer explizit in Radiant in `rotRad` einfliessen.

## 2026-03-19 — Falsche Legende für WMS-Layer: „ArcGIS Legend-Fehler: Service schweizmobil/MapServer not found"
- **Symptom**: Klick auf Legenden-Icon bei Gemeindegrenzen (Geoadmin WMS) öffnet `legend-proxy.php?service=schweizmobil` → Fehlermeldung „Service schweizmobil/MapServer not found", da der Dienst nicht existiert.
- **Root-Cause**: `_propagateLegends()` in `tnet-lm-store.js` vererbt den Legend-Key (`"schweizmobil"`) von einer ArcGIS-Elterngruppe blind an ALLE Kind-Layer — auch an WMS/WMTS-Layer. `_openLegend()` in `tnet-lm-tree.js` schickt den Key dann an `legend-proxy.php`, das nur ArcGIS-Services versteht.
- **Fix**: `_propagateLegends()` prüft bei Vererbung: Wenn Blatt-Layer (`type==='layer'`) ein `layerType` hat, das nicht `arcgisRest` ist, wird die Legende NICHT vom Eltern-Knoten geerbt.
- **Guardrail**: Legend-Vererbung darf nur an Layer gleichen Service-Typs erfolgen. `layerType`-Feld (von `extractLegendInfo()` in layers.php) immer als Typ-Check verwenden.

## 2026-03-19 — TnetLayerSwitch: Layer-Einschalten funktioniert nur für ersten LyrMgr (main_lyrmgr)
- **Symptom**: Checkbox-Klick auf Bundesdaten (Geoadmin WMS), Gemeindegrenzen, Obwalden-Layer im TNET-Tree zeigt keinen Layer auf der Karte. `switchLayersProgr` wird aufgerufen, meldet Erfolg, aber kein OL-Layer entsteht.
- **Root-Cause**: `TnetLayerSwitch()` in `tnet-mapplus-helpers.js` iteriert `am.LyrMgr` mit `break` beim ersten LyrMgr der `targetMap='main'` hat → nimmt immer `main_lyrmgr` (NW-Layer). Layer wie `municipalities_borders` (Geoadmin) sind aber in `second_lyrmgr` oder `forth_lyrmgr` registriert. `switchLayersProgr` auf dem falschen LyrMgr überspringt unbekannte Layer still.
- **Fix**: Statt `break` bei erstem Match: Alle LyrMgr mit `getLayerById(layerId)` abfragen und denjenigen nehmen, der den Layer kennt. Fallback: auf allen LyrMgr `switchLayersProgr` aufrufen.
- **Guardrail**: Bei Multi-LyrMgr-Setups (main/second/third/forth) NIE auf den ersten LyrMgr beschränken. Einschalten muss wie Ausschalten ALLE LyrMgr durchsuchen.

## 2026-03-19 — Eckige Klammern in Layer-Namen werden abgeschnitten, z.B. "Gemeindegrenzen [04/2025]" → "2025]"
- **Symptom**: NLS-Beschreibungen mit `/` in eckigen Klammern (z.B. `[04/2025]`, `[kWh/m2]`) werden in der aktiven-Themen-Liste falsch dargestellt — nur das letzte Segment nach `/` bleibt sichtbar.
- **Root-Cause**: `_cleanPathName()` in `tnet-lm-store.js` splittet den Namen am `/` um Pfade wie `"Gis Basis/gemeindegrenzen"` aufzulösen. Aber `"Gemeindegrenzen [04/2025]"` enthält ebenfalls `/` → `split('/').pop()` ergibt `"2025]"`.
- **Fix**: Vor dem Split Klammer-Inhalt entfernen (`name.replace(/\[[^\]]*\]/g, '')`) und prüfen, ob dann noch ein `/` vorhanden ist. Falls nicht, Name unverändert zurückgeben.
- **Guardrail**: Bei Pfad-Split-Logik immer prüfen, ob der `/` innerhalb von Klammern, Anführungszeichen oder anderen Sonderzeichen steht. Eckige Klammern in NLS-Texten sind verbreitet (Einheiten, Datumsangaben).

## 2026-03-13 — Basemap-Wechsel: "Duplicate item added to a unique collection" beim Orthofoto
- **Symptom**: Klick auf Orthofoto (swissimage) wirft `Uncaught Error: Duplicate item added to a unique collection` in OpenLayers Collection.setAt().
- **Root-Cause**: Framework's `changeBaseMap()` ruft `mapObj.getLayers().setAt(0, basisMaps[id])` ohne zu prüfen, ob das Layer-Objekt bereits an Index 0 liegt. OpenLayers' `assertUnique_` wirft, wenn dasselbe Objekt schon in der Collection ist — auch am Ziel-Index.
- **Fix**: Guard im `changeBaseMap`-Hook (tnet-basemap.js): Vor dem Framework-Aufruf prüfen ob `mapObj.getLayers().item(0) === basisMaps[actualBasemapId]`. Wenn ja, Framework-Aufruf überspringen, `onBasemapChange` aber trotzdem ausführen (für Zeitreise-Overlay).
- **Guardrail**: Bei OpenLayers `Collection.setAt()` immer vorher prüfen, ob das Element schon in der Collection ist. Framework-Code kann diesen Check nicht, daher im Hook abfangen.

## 2026-03-10 — Kartenportal: ÖFFNEN-Button-Klick tut nichts bei bestimmten Karten (z.B. Gefahrenkarte OW)
- **Symptom**: Klick auf "ÖFFNEN" bei Gefahrenkarte Obwalden hat keine Wirkung.
- **Root-Cause**: `processExtractedLinks()` ersetzt WP-onclick (`setMapBookmark`) mit `TnetSetBookmark(bookmarkId)`, das einen API-Lookup macht. Die WP-Seite verwendet Bookmark-Namen (z.B. `ow_gefahrenkarte`), die nicht im Bookmark-API existieren (API kennt `ow_naturgefahren_pro`). `TnetSetBookmark` fängt den Fehler still ab → keine Aktion.
- **Fix**: Fallback in onclick: wenn `TnetSetBookmark` `{success: false}` liefert → direkter Framework-Aufruf `window.top.njs.AppManager.setMapBookmark(['main'], originalParams)` mit den originalen WP-Parametern.
- **Guardrail**: Bei Link-Rewriting immer einen Fallback auf den direkten Framework-Aufruf einbauen, wenn der API-basierte Bookmark-Lookup fehlschlägt.

## 2026-03-10 — Proxy-SSO: redirect_to zurück zum Proxy blockiert WP-Session
- **Symptom**: Nach OAuth-Flow zeigt der Proxy-iframe weiterhin den Login-Button; Auto-Click löst Loop aus statt den Benutzer einzuloggen.
- **Root-Cause**: Proxy-PHP fetched `www.gis-daten.ch` via cURL mit `$_COOKIE` des Browsers (`nwow.mapplus.ch`-Domain). WP-Session-Cookie wurde vom Browser für `gis-daten.ch`-Domain gesetzt → wird NIE an `nwow.mapplus.ch` gesendet → cURL bekommt WP-Cookie nie → Proxy sieht stets Login-Button.
- **Fix**: `redirect_to` NICHT auf die Proxy-URL patchen. Nach OAuth landet das iframe direkt auf `www.gis-daten.ch` mit aktiver WP-Session (identisch zum manuellen Klick). Robustes Polling (20×300 ms) statt Einzel-Timeout; `window.location.href = btn.href` statt `.click()`.
- **Guardrail**: Proxy kann WP-Cookies nie per cURL forwarden wenn Proxy und WP auf unterschiedlichen Domains laufen. Auto-Login muss das iframe auf die Ziel-Domain navigieren lassen, nicht zurück zum Proxy.

## 2026-03-10 — Proxy-SSO: sessionStorage-Flag blockiert Auto-Click nach Hard-Reload
- **Symptom**: WP Login-Button erscheint nach Hard-Reload trotz Auto-Login-Logik; manueller Klick funktioniert, automatischer nicht.
- **Root-Cause**: `sessionStorage.getItem('tnet_sso_attempted')` persistiert über Seitenreloads (sessionStorage wird erst beim Tab-Schlies­sen geleert) → Flag aus vorangehender Session blockiert den Auto-Click beim nächsten Besuch.
- **Fix**: Loop-Schutz als reine In-Memory-Variable `_ssoAttempted` (resettet bei jedem Seitenload) statt sessionStorage. Zusätzlich: Button-href patchen via `patchLoginButtonRedirect()`, sodass OAuth nach Abschluss mit `sso_done=1` zum Proxy zurückleitet statt zur gis-daten.ch Startseite. Kein Auto-Click wenn `sso_done=1` in URL.
- **Guardrail**: Persistenten Storage (sessionStorage/localStorage) für Einmal-Flags nur verwenden, wenn explizites Ablaufdatum oder manueller Reset vorhanden.

## 2026-03-10 — Proxy-SSO: window.location.href Redirect verhindert proxy-inject.js Init
- **Symptom**: Keine Konsolenausgaben von proxy-inject.js; WP-Login-Button erscheint trotz aktiver mapplus-Session; manueller Button-Klick funktioniert aber die Auto-Auth nicht.
- **Root-Cause**: PHP injizierten `window.location.href`-Redirect als Inline-`<script>` vor `</body>`. Dieser feuert synchron beim HTML-Parsen — bevor DOMContentLoaded und damit proxy-inject.js initialisieren.
- **Fix**: PHP-Redirect deaktiviert; `proxy-inject.js` erhält neue `autoClickLoginBtn()`-Funktion, die den WP-OAuth-Button per JS klickt (simuliert den manuellen Klick). Loop-Schutz via `sessionStorage`-Flag `tnet_sso_attempted`; Reset via `?sso_done=1`.
- **Guardrail**: Keine synchronen `window.location.href`-Redirects in Inline-Scripts injizieren — externe Script-Tags werden dadurch nie ausgeführt.

## 2026-03-09 — Server-Cache liefert veraltete API-Responses nach PHP-Fix
- **Symptom**: Nach Deploy von PHP-Fixes zeigt der LayerManager weiterhin alte/falsche Daten (z.B. „Oereb Raumplanung 0" statt „RAUMPLANUNG"). API-Response mit `&debug=1` korrekt, ohne debug falsch.
- **Root-Cause**: `JsonCache` invalidiert nur bei geänderter Quell-Datei (lyrmgr.conf, mapping) — Änderungen an PHP-Logik (layers.php) lösen keine Cache-Invalidierung aus. Die 1h-TTL hielt die alte Response im Cache.
- **Fix**: (a) Neuer `nocache`-URL-Parameter in layers.php: `$noCache = isset($_GET['nocache']) && $_GET['nocache'] === '1'`, Cache-Bypass: `!$debug && !$noCache`. (b) Neue `cache: true|false`-Option in `tnet-global-config.json5` (layerManager-Sektion). (c) JS hängt `&nocache=1` an API-URL wenn `_config.cache === false`. (d) Server-Cache manuell geleert via `POST cache.php?action=clear`.
- **Guardrail**: Nach PHP-Logik-Änderungen immer Server-Cache leeren (`POST cache.php?action=clear`). Bei Entwicklung `cache: false` in json5 setzen. Für Produktion `cache: true` verwenden.

## 2026-03-09 — source=file: NLS-Labels fehlen + ÖREB-Knoten nicht öffenbar
- **Symptom**: Bei `lyrmgrSource: 'file'` zeigt der LayerManager rohe Keys statt NLS-Labels (z.B. „Oereb Raumplanung" statt „RAUMPLANUNG"). „Oereb Raumplanung"-Knoten zeigt 0 Layer und lässt sich nicht aufklappen.
- **Root-Cause**: Zwei Fehler: (1) Der `source=file`-Block in layers.php gab die rohe lyrmgr.conf als JSON zurück — ohne NLS-Label-Lookup (`getNlsLabel`), ohne Mapping-Merge, ohne `processLayerItems`. (2) `processLayerItems()` konnte assoziative Arrays (Key=Gruppen-ID, Value=Definition) nicht verarbeiten — nur Strings und `{name: ...}`-Objekte. ÖREB-Subitems wie `{ "rp_liegenschaften": {...}, "rp_rechtskraeftig": {...} }` wurden stillschweigend übersprungen → 0 Layers. (3) Gruppen-Namen verwendeten `extractLayerName()` statt `getNlsLabel()`.
- **Fix**: (a) `source=file`-Early-Return-Block entfernt → fällt zum bewährten File-Fallback durch. (b) `processLayerItems` um `elseif (is_array($item) && is_string($key) && !is_numeric($key))` erweitert → erkennt assoziative Gruppen. (c) Gruppen-Name: `getNlsLabel($groupId) ?: extractLayerName($groupId)`. (d) JS: client-seitige Transformation entfernt, gleicher Response-Parser wie API.
- **Guardrail**: `processLayerItems` muss drei Fälle abdecken: (1) `is_string` → Leaf-Layer, (2) `isset($item['name'])` → benannte Gruppe/Layer, (3) `is_string($key) && !is_numeric($key)` → assoziatives Objekt (Key = ID). NLS-Labels immer zuerst via `getNlsLabel()` probieren, `extractLayerName()` nur als Fallback.

## 2026-03-08 — Accordion-Scroll: Inhalt unten abgeschnitten bei grossem Themenkatalog
- **Symptom**: Wenn der Themenkatalog-Abschnitt per Drag-Handle vergrössert wird, kann im Layer-Tree nicht mehr ganz nach unten gescrollt werden. Bei kleinerem Abschnitt funktioniert es.
- **Root-Cause**: `getMaxHeight()` gab `innerHeight - 150` zurück (statisch). `#spring` hat aber `max-height: calc(100vh - 105px)` und enthält andere Elemente (TitlePane-Titelleisten, Resize-Handles, Padding ≈ 160px). Bei grosser Höhe ragte `#lm-tree-container` über `#spring` hinaus — der Container fing Scroll-Events ab, aber der untere Teil war von `#spring` abgeschnitten.
- **Fix**: `getMaxHeight(panelId)` berechnet nun dynamisch den verfügbaren Platz: misst `#spring`'s computed max-height, subtrahiert alle Geschwister-Elemente (`offsetHeight`) und die eigene Titelleiste. Alle 7 Call-Sites aktualisiert.
- **Guardrail**: Maximale Höhe für Accordion-Panels IMMER aus dem tatsächlichen Container-Platz ableiten, nie aus `window.innerHeight` mit statischem Offset.

## 2026-03-08 — Bundesdaten (Geoadmin WMS) lassen sich nicht einschalten
- **Symptom**: Geoadmin-Layer (z.B. `ch.astra.baulinien-nationalstrassen`) einschalten → Log: `Coalesce: Sublayer-Nummer nicht extrahierbar`. Layer wird nicht auf der Karte angezeigt.
- **Root-Cause**: `LayerImporter.php` setzt `service_url`/`coalesce_group` auf jede Gruppe, deren Kind-Layer dieselbe Basis-URL teilen — auch WMS-Gruppen (Geoadmin). `_scanCoalesceNodes` erkennt diese fälschlich als Coalesce-Gruppen. `_extractSublayerNum` erwartet ArcGIS-Format `LAYERS: "show:3"`, WMS hat aber `layers: "ch.astra...."` → gibt `null` zurück → Aktivierung bricht ab.
- **Fix**: (1) JS: `_scanCoalesceNodes` prüft `serviceUrl.indexOf('MapServer') !== -1` — nur ArcGIS-Dienste werden als Coalesce klassifiziert. (2) PHP: `LayerImporter.php` schreibt `service_url`/`coalesce_group` nur wenn URL `MapServer` enthält.
- **Guardrail**: Coalesce-Logik darf NUR für ArcGIS-MapServer-Dienste greifen. WMS-Dienste immer über Standard-Pfad (TnetLayerSwitch) aktivieren.

---

## 2026-03-08 — MapTip-Crash bei Coalesce-Layer-Aktivierung → SelectAll-Checkbox hängt
- **Symptom**: Coalesce-Layer (z.B. Grundnutzung NW) per Suche oder Checkbox einschalten → `Uncaught TypeError: Cannot read properties of null (reading 'minResolution')` in `njs.MapTip.addLayerCallback`. Übergeordnete SelectAll-Checkbox aktualisiert sich nur jedes zweite Mal.
- **Root-Cause**: `_createRootOLLayer` ruft `map.addLayer(olLayer)` auf → Dojo `MapTip.addLayerCallback` feuert synchron → sucht `layerConf` im LyrMgr für Bridge-erstellte Layer → `null.minResolution` → Crash. Der Uncaught TypeError propagiert hoch durch `_addToCoalesceOLLayer` → `setLayerVisible` → `_emit('layer-visibility')` wird NIE erreicht → Tree erhält kein Event → `_updateSelectAllCheckboxes()` läuft nicht. Beim 2. Klick existiert Root-OL-Layer bereits → kein `map.addLayer()` → kein Crash → Events feuern korrekt.
- **Fix**: `map.addLayer(olLayer)` in `_createRootOLLayer` (tnet-coalesce-bridge.js) in try-catch gewrappt. OL fügt den Layer vor dem Callback zur Collection hinzu, daher ist die Kartenfunktionalität nicht betroffen.
- **Guardrail**: Bei jedem `map.addLayer()` für Bridge-erstellte Layer immer try-catch verwenden, da Dojo-Callbacks auf Layer-Events mit unbekannten Layer-Typen crashen können.

---

## 2026-03-08 — Suche: Layer-Aktivierung schlägt fehl bei tiefen Sublayer-Pfaden
- **Symptom**: Über die Suche "Grundnutzung" ausgewählt → Layer wird nicht eingeschaltet. Log: `navigateToLayer: Layer nicht im DOM gefunden: gis_fach/ow_fliessgewaesser_intern/gewaesser/.../gewaesserraumzonen_grundnutzung`
- **Root-Cause**: Drei Probleme: (1) Coalesce-Bridge-Patch fängt `TnetLayerSwitch('on')` ab und gibt `true` zurück, auch wenn `setLayerVisible` still fehlschlägt (Layer nicht im Store-Katalog). Dadurch kein Fallback auf Original. (2) Search-`activateLayer` nutzt nur TnetLayerSwitch, nicht den Store. (3) Such-API kann Layer-IDs liefern die tiefer liegen als lyrmgr.conf definiert (z.B. aus DB-Import) → weder Store noch Dojo kennt diese IDs.
- **Fix**: (1) Bridge-Patch: `findLayer`-Check vor Store-Route — wenn Layer nicht im Katalog → Fallback auf Original. (2) `activateLayer`: Store-first mit Eltern-Pfad-Fallback (Pfadsegmente kürzen bis bekannter Layer gefunden). (3) `navigateToLayer`: DOM-Fallback auf Eltern-Pfad wenn exakte ID nicht gefunden.
- **Guardrail**: Bei TnetLayerSwitch-Patch immer verifizieren dass der Layer im Store existiert bevor `true` zurückgegeben wird. Such-Aktivierung immer über Store routen (Coalesce, Active-Liste, Sichtbarkeits-Tracking).

---

## 2026-03-07 — Räumliche Abfrage: Doppeltes ? in Proxy-URL bricht ArcGIS-Queries
- **Symptom**: Räumliche Abfrage (Polygon) liefert keine Ergebnisse für ArcGIS-Layer wie Fruchtfolgeflächen. Fetch schlägt fehl oder gibt leere Antwort.
- **Root-Cause**: OL-Layer-Source liefert URL im `?path=`-Format: `agsproxy.php?path=gis_fach/.../MapServer`. Die Spatial Query hängt `/0/query?f=json&geometry=...` an → entsteht URL mit **doppeltem `?`**: `agsproxy.php?path=.../MapServer/0/query?f=json&...`. Der Browser interpretiert alles nach dem ersten `?` als Query-String, wodurch `f=json` in den `path`-Parameter eingebettet wird.
- **Fix**: Neue Funktion `normalizeProxyUrl()` in `tnet-spatial-query.js`: konvertiert `agsproxy.php?path=X` → `agsproxy.php/X` (PATH_INFO-Format). Wird in `getVisibleQueryableLayers()` (nach URL-Extraktion) UND in `querySingleLayer()` (vor Query-Bau) aufgerufen.
- **Guardrail**: Proxy-URLs können in zwei Formaten vorliegen (`?path=` und PATH_INFO). Vor dem Anhängen von `/sublayer/query?params` IMMER erst in PATH_INFO normalisieren, damit kein doppeltes `?` entsteht.

## 2026-03-07 — ÖREB/Polygon-Zeichnen löst gleichzeitig MapTip aus
- **Symptom**: Klick auf Karte während ÖREB-Modus oder Polygon-Zeichnen (räumliche Abfrage) löst parallel einen MapTip-Request aus → verwirrende doppelte Ergebnisse.
- **Root-Cause**: `tnet-info-bridge.js` singleclick-Handler kannte keine Tool-Exklusivität. OL feuert alle registrierten singleclick-Listener unabhängig voneinander — `evt.stopPropagation()` blockiert nur DOM-Events, nicht OL-Event-Listener.
- **Fix**: Am Anfang von `_handleClick()` in der Bridge prüfen: `window.isOerebActive` → early return; `window.isPolygonDrawing` → early return. Globals werden von `tnet-oereb.js` bzw. `tnet-spatial-query.js` korrekt gesetzt/zurückgesetzt.
- **Guardrail**: Jedes neue Tool, das eigene Klick-Handler registriert, MUSS ein globales Flag setzen (z.B. `window.isToolXActive`) und dieses in der Bridge als Gate abfragen.

## 2026-03-06 — MapTips feuern nicht: Sublayer-Name ≠ OL-Layer-Name (Prefix-Mismatch)
- **Symptom**: Layer wie `gis_fach/nw_fruchtfolgeflaechen` auf der Karte sichtbar, aber TnetSyncMapTips aktiviert keinen MapTip → null Queries beim Klick.
- **Root-Cause**: MapTip-Config hat `linked_layer = gis_fach/nw_fruchtfolgeflaechen/fruchtfolgeflaeche` (Sublayer-Key), aber der OL-Layer auf der Karte heisst `gis_fach/nw_fruchtfolgeflaechen` (Parent-Key). TnetSyncMapTips machte exakten Vergleich → kein Match → MapTip nie aktiviert. Auch `getLayerByMap()` findet den Sublayer-Key nicht, weil er nicht im LyrMgr registriert ist (nur der Parent ist in lyrmgr.conf).
- **Fix**: (1) Prefix-Matching in `TnetSyncMapTips`: Wenn exakter match fehlschlägt, wird der Parent-Pfad sukzessive verkürzt (`split('/')`, `pop()`) bis ein sichtbarer OL-Layer gefunden wird. (2) Wenn Prefix-Match: `mt.wms_layer = parentOLLayer` setzen, damit `queryconnector()` eine gültige Layer-Quelle hat (getLayerByMap würde null returnen).
- **Guardrail**: linked_layer_id in Maptips-Configs kann Sublayer-Pfade enthalten die länger sind als der OL-Layer-Name. IMMER Prefix-Matching verwenden, nie exakt vergleichen.

## 2026-03-06 — Proxy überschreibt distance-Parameter → 1m Suchradius
- **Symptom**: MapTip-Queries werden korrekt dispatcht, aber ArcGIS REST `/query` liefert keine Features trotz Klick auf sichtbare Objekte.
- **Root-Cause**: `agsproxy.php` setzt `$queryParams['distance'] = 1.0` IMMER — auch wenn der Client einen eigenen Wert sendet (z.B. 200m = viewResolution × tolerance). Der Query-Endpunkt des ArcGIS-Servers sucht dadurch nur in 1m Radius.
- **Fix**: Auto-Parameter nur als Default setzen: `if (!isset($queryParams['distance']))` vor der Zuweisung.
- **Guardrail**: Proxy-Auto-Parameter nie bedingungslos überschreiben. Immer `isset()`-Check, damit Client-Werte Vorrang haben.

## 2026-03-06 — "Keine Objekte gefunden" trotz korrekter MapTip-Registrierung
- **Symptom**: `TnetInfoBridge.diagnose()` zeigt 17 wmsActiveLyrs / 29 aktive MapTips. Klick dispatcht 2 Queries, aber Ergebnis ist immer "Keine Objekte gefunden".
- **Root-Cause**: `TnetSyncMapTips` setzte `mt.wms_layer = olLayerOnMap` für MapTips OHNE eigene `url`. Der OL-Layer auf der Karte nutzt eine Proxy-URL (`/maps/agsproxy.php?path=.../MapServer`). `queryconnector()` baut daraus für esrigeojson: `proxyUrl + "/0/query?f=json&..."` → doppeltes `?` in der URL → Query-Parameter werden als agsproxy-Parameter statt als ArcGIS-Parameter geparst → leeres Ergebnis. Im nativen Framework-Flow bleibt `wms_layer = null`, und `queryconnector()` nutzt `getLayerByMap()` → Framework-Layer-Wrapper → korrekte URL-Auflösung.
- **Fix**: In `TnetSyncMapTips` KEINEN `wms_layer` mehr setzen. Nur `mt.active` / `wmsActiveLyrs` verwalten. `queryconnector()` fällt auf den nativen `getLayerByMap()`-Pfad zurück.
- **Guardrail**: *Niemals* `mt.wms_layer` von aussen setzen — dieses Property gehört ausschliesslich dem Framework (`Activate()` bei MapTips mit `url`). TnetSyncMapTips darf nur `mt.active` und `wmsActiveLyrs` steuern.

## 2026-03-05 — Doppelte MapTip-Requests bei Coalesce-Sublayern (z.B. Grundnutzung)
- **Symptom**: Beim Klick auf die Karte werden zwei identische REST-Requests an denselben MapServer-Sublayer (z.B. `/12/query`) gesendet — einer mit korrektem NLS/Alias, einer ohne.
- **Root-Cause**: In `maptips_tnet_oereb_multi.conf` existieren ZWEI MapTip-Objekte für die gleiche `query_layers`-Nummer: ein Root-Level-MapTip (`_def_12`, `linked_layer = Root-Key`, generisch `qryFields: ["*"]`) und ein Sublayer-MapTip (`_def/grundnutzung_12`, `linked_layer = Sublayer-Key`, detaillierte Felder + NLS). Wenn die Bridge `TnetLayerSwitch(rootKey, 'on')` aufruft, feuert das Framework `addLayerCallback` für ALLE Root-Level-MapTips → Root-MapTip `_def_12` wird in `wmsActiveLyrs` gepusht. Gleichzeitig pusht die Bridge den Sublayer-MapTip `_def/grundnutzung_12`. Beide haben `query_layers = "12"` → `queryconnector()` wird zweimal aufgerufen.
- **Fix**: In `_forceActivateMaptip()` (tnet-coalesce-bridge.js) nach Aktivierung eines Sublayer-MapTip die `query_layers` sammeln und Root-Level-MapTips mit gleicher `query_layers` aus `wmsActiveLyrs` entfernen (Dedup). Der spezifischere Sublayer-MapTip hat Vorrang.
- **Guardrail**: Immer wenn `_forceActivateMaptip` einen Sublayer-MapTip aktiviert, Root-Level-Duplikate prüfen und deaktivieren

## 2026-03-05 — Maptip-Breadcrumb neben Titel statt darunter
- **Symptom**: Im Objektinfo-Panel erscheint der Breadcrumb-Text (z.B. "ÖREB > Nutzungsplanung") neben dem Titel statt auf einer eigenen Zeile darunter.
- **Root-Cause**: `.dijitTitlePaneTitle` hat `display: flex` mit default `flex-wrap: nowrap`. Der Breadcrumb-div (`display: block`) wird als Flex-Kind trotzdem in die gleiche Zeile gezwungen.
- **Fix**: `flex-wrap: wrap !important` auf `#njs_info_pane_content .dijitTitlePaneTitle`, plus `width: 100%; flex-basis: 100%` auf `.tnet-maptip-breadcrumb` — erzwingt Zeilenumbruch.
- **Guardrail**: Flex-Kinder brechen nur um wenn der Container `flex-wrap: wrap` hat UND das Kind volle Breite beansprucht.

---

## 2026-03-05 — Maptip-Breadcrumb verursachte Browser-Hänger
- **Symptom**: Beim Öffnen von Maptips hing die Applikation (Browser meldete langlaufenden/aufgehängten Code).
- **Root-Cause**: Die Breadcrumb-Auflösung scannte rekursiv den gesamten Layer-Tree und wurde durch den MutationObserver sehr häufig erneut ausgelöst.
- **Fix**: Auf schnellen, begrenzten Resolver ohne Full-Tree-Scan umgestellt und Breadcrumb-Rendering im Observer entprellt (Timer statt Direktlauf pro Mutation).
- **Guardrail**: Keine teuren Traversals im MutationObserver-Callback; UI-Anreicherung immer throttlen/debouncen und auf bekannte Layer-Keys begrenzen.

## 2026-03-05 — ÖREB-Tool blockiert Sidepanel/Layermanager komplett
- **Symptom**: Bei aktivem ÖREB-Abfrage-Tool kann das Sidepanel (Layermanager, Themenkatalog) nicht mehr bedient werden — Klicks gehen auf die Karte statt auf das Panel.
- **Root-Cause**: `body.oereb-mode` setzt `pointer-events: none !important` auf `#freepane` und alle Kinder (analog `drawing-mode`). Das blockiert das gesamte Sidepanel, obwohl ÖREB-Klicks direkt auf dem OL-Map-Objekt via `map.on('singleclick')` registriert sind und kein DOM-Event-Blocking brauchen.
- **Fix**: CSS-Regeln `body.oereb-mode #freepane { pointer-events: none }` entfernt. Der ÖREB-Klick-Listener funktioniert weiterhin, da er direkt am OL-Map-Objekt hängt. Maptip-Unterdrückung erfolgt im JS via `evt.stopPropagation()` und `suppressInfoHighlightLayer`.
- **Guardrail**: `pointer-events: none` auf `#freepane` nur bei echtem Zeichen-Modus (drawing-mode) verwenden, nicht bei Tool-Modi die nur Kartenklicks abfangen. ÖREB, Spatial Query etc. registrieren sich direkt am OL-Map und brauchen kein DOM-Level-Blocking.

## 2026-03-05 — Dargestellte Themen: Gruppenname zeigt URL-Pfad statt lesbaren Namen
- **Symptom**: Coalesce-Gruppen zeigen z.B. `gis_oereb/nw_planungszon_def` statt den lesbaren Namen aus dem Dojo-LyrMgr.
- **Root-Cause**: `_scanCoalesceNodes` setzt `name: servicePath || n.name || n.id` — `servicePath` (der rohe URL-Pfad) gewinnt immer, auch wenn `n.name` bereits einen bereinigten Namen enthält. Zudem fehlt ein Lookup gegen die lyrmgrResources-Bezeichnungen im Dojo-LyrMgr.
- **Fix**: Priorität umgekehrt auf `n.displayName || n.name || servicePath || n.id`. Neue Methode `_enrichCoalesceNamesFromDojo()` liest nach `_syncFromMap` aus `njs.LayerMgr.arCategories[].arSubCategories[].arLayers[].description` (= lyrmgrResources-Text) und überschreibt `_coalesceIndex[groupId].name`.
- **Guardrail**: `servicePath` ist nie ein lesbarer Name — immer als letzten Fallback verwenden. Dojo-LyrMgr-`description` ist die Authority für menschenlesbare Gruppenbezeichnungen.
- **Update 2026-03-05**: Benutzergewünscht: servicePath soll als Gruppenname angezeigt werden (z.B. `gis_oereb/nw_nutzungsplanung_def`). Priorität jetzt: `servicePath || n.displayName || n.name || n.id`. DB-Name war generisch ("Virtueller Layer/Coalesce Layer").
- **Update v3 2026-03-05**: `_enrichCoalesceNamesFromDojo` war mit 4 Bugs komplett kaputt: (1) `njs.LayerMgr` statt `njs.AppManager.LyrMgr`, (2) `arSubCategories` statt `arCategories`, (3) Nicht-rekursiv, (4) ID-Mismatch Dojo-Kategorie-ID vs. Coalesce-Gruppen-ID. Fix: Reverse-Lookup über Kind-Layer-Namen — Dojo-Kategorie die Layer enthält deren `name` zu einer Coalesce-Gruppe gehört → deren `description` als Gruppenname verwenden. Bridges die ID-Lücke zwischen Dojo (`rp_def_np_fl_nutzungszonen`) und Coalesce (`gis_oereb/nw_nutzungsplanung_def`).

## 2026-03-05 — Maptips feuern nicht für Coalesce-Sublayer
- **Symptom**: Klick in die Karte auf Coalesce-Layer zeigt kein Info-Panel. MapTips werden nie aktiviert.
- **Root-Cause**: Framework aktiviert MapTips nur wenn ein OL-Layer mit `name === linked_layer_id` zur Map hinzugefügt wird. Coalesce-OL-Layer hat den Dienst-Pfad als Name (z.B. `gis_oereb/nw_nutzungsplanung_def`), MapTips haben Sublayer-Keys als `linked_layer_id` (z.B. `gis_oereb/nw_nutzungsplanung_def/grundnutzung`). → MapTips nie in `wmsActiveLyrs` → `queryconnector()` wird nie aufgerufen. Bisherige `lookupCallbacks`-Registrierung war wirkungslos, da das Framework diese nie ausliest.
- **Fix**: Neue Funktionen `_forceActivateMaptip(sublayerKey, olLayer)` / `_forceDeactivateMaptip(sublayerKey)` in tnet-coalesce-bridge.js. Setzen `mt.wms_layer = olLayer` und pushen MapTip manuell in `wmsActiveLyrs`. Aufgerufen von `registerSublayer` (Bridge), `patchMaptipForCoalesceLayer` (Standard-Coalesce), `_installMaptipPatch` (Nachholen) und den Deaktivierungs-Gegenstücken.
- **Guardrail**: Jeder OL-Layer ausserhalb des Frameworks braucht manuelles Maptip-Lifecycle-Management (`wmsActiveLyrs.push` / `.remove`, `mt.active`, `mt.wms_layer`). `lookupCallbacks` allein reicht nicht — die Abfrage muss erst durch `queryconnector()` ausgelöst werden.

## 2026-03-05 — Dargestellte Themen: Auge und Deckkraft ohne Wirkung bei legacy-geschalteten Layern
- **Symptom**: Klick auf Auge-Icon oder Deckkraft-Slider im "Dargestellte Themen"-Panel hat keinen Effekt, obwohl Layer sichtbar auf der Karte ist.
- **Root-Cause**: `toggleCoalesceGroupEye`/`setCoalesceGroupOpacity` prüfen nur `_coalesceOLLayers[groupId]` (Coalesce-Modus). Bei `useNewTree: false` werden Layer über den Dojo-LyrMgr eingeschaltet — dabei wird kein `_coalesceOLLayers`-Eintrag erstellt. Die Funktionen brechen stillschweigend ab (`return`).
- **Fix**: Legacy-Fallback-Zweig in beiden Funktionen ergänzt: Iteriert über `info.childIds`, holt OL-Layer via `activeEntry._olLayerRef` oder `_findOLLayer`, setzt `setVisible()` / `setOpacity()` direkt. `_suppressMapSync` schützt vor Rückkopplungs-Events.
- **Guardrail**: Coalesce-Funktionen müssen immer beide Modi unterstützen: Coalesce-OL-Layer (neuer Tree) UND individuelle OL-Layer pro Kind (Legacy-LyrMgr).

## 2026-03-04 — Coalesce-OL-Layer inkompatibel mit MapPlus-Framework
- **Symptom**: TNET-Coalesce erstellt eigene `__coalesce__`-OL-Layer mit `show:0,3,5` — MapTip, Bookmark/URL-State und Legacy-Checkboxen funktionieren nicht für diese Layer.
- **Root-Cause**: Der `ClassicLayerMgr` macht kein natives Coalescing — jeder `switchLayer()` erstellt einen eigenen OL-Layer. Das TNET-Coalesce-System erstellt Layer ausserhalb des Frameworks, die von `_wms_connector.lookupCallbacks` (MapTip) und `updateMapStatusUrl` (Bookmark) nicht erkannt werden.
- **Fix**: Neue `tnet-coalesce-bridge.js` als Framework-Bridge: registriert Coalesce-Sublayer in `lookupCallbacks`, synchronisiert URL-State via `history.replaceState()` und pflegt Legacy-Dojo-Checkboxen. Zudem Debounce für `_updateCoalesceLAYERSParam` (50ms Default) um bei schnellem Aktivieren nur einen Server-Request auszulösen.
- **Guardrail**: OL-Layer die ausserhalb des MapPlus-Frameworks erstellt werden, müssen immer manuell in `_wms_connector.lookupCallbacks` registriert werden (Key: `<URL>~<normalizedLayerName>`). Nie annehmen, der ClassicLayerMgr mache automatisch Coalescing.

## 2026-03-05 — Bridge v1 MapTip zeigt `__coalesce__`-Gruppennamen statt echte Layer-Info
- **Symptom**: MapTip zeigt `__coalesce__rp_def_np_fl_nutzungszonen (Layer 12)` — den internen Coalesce-Gruppennamen statt der echten Objektinformation.
- **Root-Cause**: Bridge v1 erstellte eigene `__coalesce__`-OL-Layer ausserhalb des Frameworks. Die lookupCallbacks zeigten auf diese internen Layer-URLs, aber der MapTip-Handler konnte die `linked_layer`-Referenzen nicht korrekt auflösen. Der OL-Layer-Name (`__coalesce__...`) wurde statt des konfigurierten Titels angezeigt.
- **Fix**: Bridge v2 (Root-Dienst-Strategie): Anstatt eigene OL-Layer zu erstellen, werden die bereits in `layers_tnet_oereb_multi.conf` existierenden Root-Dienste (z.B. `gis_oereb/nw_nutzungsplanung_def`) via `TnetLayerSwitch(rootKey, 'on')` aktiviert. Die Sublayer-Sichtbarkeit wird über `source.updateParams({LAYERS: 'show:0,3,5'})` gesteuert. Da der OL-Layer vom Framework erstellt wird, funktionieren MapTip, Legende und Bookmark automatisch. Store-Hooks in `_addToCoalesceOLLayer`, `_removeFromCoalesceOLLayer`, `_removeCoalesceOLLayer` und `toggleLayerEye` prüfen `Bridge.canHandle()` und delegieren ggf. an die Bridge. `_findOLLayer` hat einen Bridge-Fallback für Sublayer→Root-Auflösung.
- **Guardrail**: Coalesce-Layer die einen Root-Dienst in der Framework-Config haben, IMMER über die Bridge (TnetLayerSwitch) verwalten — nie eigene OL-Layer erstellen. Für Root-Dienste müssen `layers_tnet_oereb_multi.conf`-Einträge vorhanden sein.

---

## 2026-03-04 — Nordpfeil und Massstabstext im PDF nicht sichtbar
- **Symptom**: Nach Einführung von `rotateNorthArrowInSvg()` fehlen Nordpfeil und ggf. Massstabstext im exportierten PDF.
- **Root-Cause**: Z-Order-Problem. Der Nordpfeil liegt innerhalb des MAP_AREA. `pdf.svg()` rendert das SVG (inkl. rotiertem Nordpfeil) als unterste Schicht. Danach folgen ein weisses Rect + Kartenbild, die den Bereich komplett überdecken. `drawNorthArrow()` wurde wegen `_northArrowInSvg`-Flag fälschlich übersprungen. Zusätzlich konnte `pdf.svg()` den jsPDF-internen Graphics-State (Clip/Transform) verändern, was folgende `drawScaleLabel()`/`drawScaleBar()`-Aufrufe beeinträchtigte.
- **Fix**: (1) `rotateNorthArrowInSvg()`-Aufruf im Export-Flow deaktiviert (Nordpfeil innerhalb MAP_AREA → wird immer überdeckt). (2) `drawNorthArrow()` wird jetzt IMMER nach dem Kartenbild aufgerufen, ohne `_northArrowInSvg`-Skip. (3) `drawDynamicElements()` und `drawScaleLabel()` mit `saveGraphicsState()`/`restoreGraphicsState()` abgesichert.
- **Guardrail**: Dynamische Elemente, die innerhalb des MAP_AREA liegen, müssen IMMER per jsPDF NACH dem Kartenbild gezeichnet werden. SVG-basierte Manipulation funktioniert nur für Elemente ausserhalb des MAP_AREA (z.B. Titel, Copyright).

## 2026-03-04 — Nested Layer-Accordion toggelt im Log, aber bleibt visuell zu
- **Symptom**: Klick auf verschachtelte Layer-Kategorien loggt korrekt `OPEN/CLOSE`, aber das Accordion bleibt geschlossen und zeigt keine Inhalte.
- **Root-Cause**: Kombination aus (1) detached-Container beim Nested-Build, (2) doppeltem Event-Pfad (`ondijitclick` + nativer `click`) und (3) CSS-Konflikt: `.tabs2acc-panel .categoryHeader { display:none !important; }` blendete verschachtelte Container aus, weil sie dieselbe Klasse erhielten.
- **Fix**: Nested-Build auf echten Pane-Container stabilisiert (`_buildContentHeader()` im Nested-Context übersprungen), Klickpfad auf **eine** Quelle reduziert und Re-Entrancy-Guard in `_setOpenAttr` ergänzt. Zusätzlich wird `categoryHeader` im Nested-Context nicht mehr gesetzt (bzw. entfernt), damit Tabs2Accordion-CSS die Nested-Inhalte nicht versteckt.
- **Guardrail**: Bei verschachtelten Dojo-Containern Klassennamen auf globale CSS-Regeln prüfen (insb. `display:none !important` in Tabs/Accordion-Styles) und Event-Toggle immer auf genau einen Pfad begrenzen.

## 2026-03-04 — Nested-Hierarchie-CSS soll nur bei aktivierter JSON5-Option greifen
- **Symptom**: Hierarchie-Styling griff global, auch wenn die erweiterte Legacy-Hierarchie nicht explizit gewünscht war.
- **Root-Cause**: CSS-Regeln waren direkt auf `#layer_menu .dijitTitlePane[data-lyrmgr-depth]` gebunden, ohne Feature-Gate aus `tnet-global-config.json5`.
- **Fix**: Neues Config-Flag `layerManager.useLegacyNestedHierarchyStyle` eingeführt, in `window.__tnetLMFlags` exponiert und CSS auf `body.tnet-lm-legacy-nested ...` gescoped. Zusätzlich `window.TnetDumpNestedCss()` für reproduzierbaren Style-Dump ergänzt.
- **Guardrail**: Grössere Legacy-UI-Overrides immer per Feature-Flag in JSON5 schalten und CSS nie ungescoped global auf Standard-Pfade legen.

## 2026-03-04 — Nested-Hierarchie zeigt trotz korrekter Titel-Linie noch grauen linken Rand
- **Symptom**: Einrückung und Titel-Border pro Depth greifen, aber zusätzlich bleibt eine graue linke Legacy-Linie (`rgb(51, 51, 51)`) sichtbar.
- **Root-Cause**: Der Standard-Rand der Dojo-`dijitTitlePane` blieb auf Pane-/Content-Ebene aktiv und konkurrierte mit der gewünschten Titel-`border-left`-Logik.
- **Fix**: In `override.css` für `body.tnet-lm-legacy-nested #layer_menu .dijitTitlePane[data-lyrmgr-depth]` sowie `> .dijitTitlePaneContentOuter` den Rand per `border: 0 !important` plus `border-left: 0 !important` neutralisiert; Dump um Pane-Border-Metriken erweitert.
- **Guardrail**: Bei Legacy-Dojo-Hierarchien immer sowohl Titel- als auch Pane-/Content-Ränder prüfen; visuelle Vertical-Guides nur auf einem Elementpfad aktiv lassen.

## 2026-03-04 — Leaf-Layer erscheinen linksbündig statt unter der Nested-Unterkategorie
- **Symptom**: Einträge wie „Grundnutzung“ stehen visuell ganz links, obwohl sie in einer tiefen Nested-Kategorie liegen.
- **Root-Cause**: Depth-Styling wurde auf `dijitTitlePaneTitle` angewendet, aber die Leaf-Layer-Container im Content erhielten keine depth-basierte Klasse/Einrückung.
- **Fix**: In `tnet-lyrmgr-patch.js` `_buildContentLayers` ergänzt und Leaf-Container mit `tnet-lm-nested-leaf` + `data-lyrmgr-parent-depth` markiert; in `override.css` depth-spezifische `margin-left`-Regeln für diese Leaf-Container ergänzt.
- **Guardrail**: Bei Hierarchie-CSS immer Header **und** Content-Leaves separat behandeln; reine Titel-Einrückung reicht für visuell korrekte Baumtiefe nicht aus.

## 2026-03-04 — Leaf-Einrückung wirkt trotz Depth-Attribut visuell weiterhin falsch
- **Symptom**: Child-Layer stehen nicht klar unter dem Parent-Titel, obwohl `data-lyrmgr-parent-depth` korrekt gesetzt ist.
- **Root-Cause**: Einrückung via `margin-left` am Leaf-Wrapper war durch Breiten-/Layoutregeln (Dojo/TOC) visuell unzuverlässig.
- **Fix**: Leaf-Einrückung auf `padding-left` umgestellt und pro Depth mit zusätzlichem Offset gegenüber Headern abgestuft, damit Checkbox+Label stabil in der Baumtiefe ausgerichtet sind.
- **Guardrail**: Bei Legacy-Dojo-Listen Einrückung für Zeileninhalte bevorzugt über `padding-left` statt Wrapper-`margin-left` lösen.

## 2026-03-04 — Neuer Layer-Manager zeigte tiefe Gruppen nicht stufenweise (Farbe + Einrückung)
- **Symptom**: In der neuen Tree-Ansicht wirkten tief verschachtelte Ebenen (z.B. zwischen „Rechtskräftig“ und „Nutzungszonen“) optisch auf gleicher Stufe.
- **Root-Cause**: Rekursive Nodes (`lm-nested-group`) erhielten keine depth-spezifischen Klassen/Attribute; CSS konnte daher nur eine fixe Nested-Stufe stylen.
- **Fix**: In `tnet-lm-tree.js` depth-Werte (`lm-depth-N`, `data-lm-depth`) rekursiv auf Header/Layer gesetzt und in `tnet-lm.css` pro Depth (1–6) abgestufte Farben (dunkel→hell) sowie gestaffelte Einrückung für Header und Leaf-Zeilen ergänzt (inkl. Desktop-Offsets).
- **Guardrail**: Für rekursive Baum-UI immer depth-Metadaten bereits beim Rendern mitgeben; reine Klassen wie `nested` reichen für mehr als eine Unterebene nicht aus.

## 2026-03-04 — Legacy Gruppen-Checkbox schaltete Unterebenen nicht rekursiv
- **Symptom**: Bei deaktivierter Parent-Checkbox blieben unterliegende Layer teilweise sichtbar bzw. beim Reaktivieren ging der frühere Child-Zustand verloren.
- **Root-Cause**: `switchGroupLayers` arbeitete effektiv nur mit direkten `arLayers` der Zielkategorie; rekursive Unterkategorien wurden nicht konsistent verarbeitet.
- **Fix**: In `tnet-lyrmgr-patch.js` rekursives Sammeln aller Descendant-Layer ergänzt, Parent-OFF auf rekursiv AUS umgestellt und beim OFF ein Sichtbarkeits-Snapshot gespeichert, der beim Parent-ON rekursiv restauriert wird. Zusätzlich rekursive all/mixed/none-Checkbox-States für Gruppen eingeführt.
- **Guardrail**: Für hierarchische Group-Toggles immer rekursiv über den vollständigen Descendant-Baum arbeiten und den Child-Zustand vor Bulk-OFF explizit als Snapshot sichern.

## 2026-03-04 — Ausklappen brach nach rekursiver Gruppen-Logik (Legacy)
- **Symptom**: Nach der rekursiven Gruppen-Umschaltung reagierte das Ausklappen der Layer-Kategorien unzuverlässig bzw. brach bei Klicks auf Gruppen-Checkboxen.
- **Root-Cause**: Programmatische Checkbox-Status-Updates konnten in den Gruppen-`onClick`-Pfad hineinlaufen; zusätzlich war `stopPropagation()` ohne Event-Guard anfällig.
- **Fix**: In `tnet-lyrmgr-patch.js` Suppress-Flag für programmatische Checkbox-Updates ergänzt und im Gruppen-`onClick` Event-Guards (`evt` prüfen, `stopPropagation`/`preventDefault` nur falls vorhanden) eingebaut.
- **Guardrail**: Bei Dojo-Checkboxen UI-State-Updates immer von Benutzer-Click-Handlern entkoppeln (Reentrancy-/Suppress-Guard + null-safe Event-Nutzung).

## 2026-03-04 — Parent/Child-Schaltung im Legacy-Tree war inkonsistent
- **Symptom**: Parent AUS schaltete Child-Layer nicht in allen Fällen effektiv aus der Karte; Child EIN zog Parent-Checkboxen nicht zuverlässig rekursiv nach.
- **Root-Cause**: Bei Einzel-Layer-Toggles fehlte ein konsistentes rekursives Refresh der übergeordneten Gruppenstates; zusätzlich konnten alte Gruppen-Snapshots trotz manueller Child-Änderungen weiterwirken.
- **Fix**: `switchLayer` in `tnet-lyrmgr-patch.js` gepatcht: rekursives Parent-State-Refresh (all/mixed/none) nach jedem Layer-Toggle, OFF mit zusätzlichem `removeLayerIfPossible`, Bulk-Suppress-Guard sowie Snapshot-Invalidierung entlang der Ancestor-Pfade bei manuellem Child-EIN.
- **Guardrail**: In hierarchischen TOCs nach jedem Child-Toggle Parent-States rekursiv neu berechnen und bei manuellen Child-Änderungen gespeicherte Parent-Snapshots verwerfen.

## 2026-03-04 — Geklickte Gruppen-Checkbox blieb leer, während Parent/Child gesetzt wurden
- **Symptom**: Beim Aktivieren einer mittleren Gruppe wurden obere und untere Ebenen visuell gesetzt, das direkt geklickte Kästchen blieb jedoch leer.
- **Root-Cause**: Die Gruppen-State-Ableitung basierte primär auf rekursiv gesammelten Descendant-Layern. Für bestimmte Zwischenknoten lieferte die Statistik `total=0`, wodurch fälschlich `none` zurückkam.
- **Fix**: `deriveCategoryState` in `tnet-lyrmgr-patch.js` erweitert: bei `total=0` Fallback auf rekursive Ableitung aus Subkategorien (`all/mixed/none`) und erst danach Checkbox-Fallback.
- **Guardrail**: Gruppen-State-Logik darf nicht nur auf direkt zählbaren Layern basieren; Zwischenknoten immer über Child-States auflösen.

## 2026-03-04 — Eigene Gruppen-Checkbox verlor Check-Status nach Klick
- **Symptom**: Nach Klick auf eine Gruppen-Checkbox wurden Parent/Child korrekt gesetzt, aber das direkt geklickte Kästchen fiel in einzelnen Fällen visuell auf „nicht angekreuzt“ zurück.
- **Root-Cause**: `preventDefault()` im Dojo-Checkbox-`onClick` störte den nativen Toggle-Pfad des geklickten Widgets.
- **Fix**: `preventDefault()` aus dem Gruppen-Checkbox-Handler entfernt (nur `stopPropagation` belassen) und im `switchGroupLayers`-Pfad den Ziel-Checkbox-State nach dem Refresh explizit synchronisiert.
- **Guardrail**: Bei Checkbox-`onClick` nie pauschal `preventDefault()` setzen, ausser ein vollständiger eigener Toggle-Flow ersetzt das native Widget-Verhalten.

## 2026-03-04 — Steuerung im Panel „Dargestellte Themen“ reagierte teilweise nicht
- **Symptom**: Auge/Deckkraft im Active-Panel wirkten bei einzelnen Einträgen ohne Effekt, obwohl die Einträge sichtbar waren.
- **Root-Cause**: Die Aktionen verließen sich auf `findLayer(layerId)` im Katalog. Bei Einträgen ohne sauberen Katalog-Match brach der Standardpfad vor der Kartenaktion ab.
- **Fix**: In `tnet-lm-store.js` Fallback auf `activeEntry` + `_olLayerRef` ergänzt; bei fehlendem OL-Ref wird für Standard-Layer auf `TnetLayerSwitch(on/off)` zurückgefallen. Deckkraft arbeitet nun ebenfalls über Active-Entry-Fallback.
- **Guardrail**: Active-Panel-Aktionen immer gegen beide Quellen robust machen: Katalog-Layer **und** aktive Laufzeit-Einträge.

## 2026-06-xx — Nordpfeil in Druck-Vorschau dreht sich nicht bei Rotation
- **Symptom**: Beim Ändern des Rotations-Sliders im Druck-Panel dreht sich der Nordpfeil im SVG-Overlay nicht mit.
- **Root-Cause**: `insertDynamicSvgElements()` behandelte nur `scaleBar`/`scaleLabel`, nicht den Nordpfeil. Der Rotation-Slider aktualisierte die SVG-Vorschau nicht.
- **Fix**: In `insertDynamicSvgElements()` den QGIS-Nordpfeil-Path (`M8.003,-9.593`) per Path-Signatur finden, Transform-Matrix des Parent-`<g>` parsen, Rotations-Wrapper hinzufügen. `rotationDeg` in `getPreviewValues()` ergänzt. `refreshSvgPreviewValues()` wird jetzt auch vom Rotation-Slider aufgerufen.
- **Guardrail**: Bei dynamischen SVG-Elementen ohne `data-dynamic-type`-Rect: stabile Element-Signaturen (Path-Data, ID) für die Erkennung verwenden, nicht Reihenfolge/Index.

## 2026-03-04 — Druckrahmen initial falsch skaliert (erst nach Pan korrekt)
- **Symptom**: Beim Öffnen des Druck-Panels wird der Druckrahmen zu gross/klein angezeigt; erst nach kleinem Pan stimmt die Skalierung.
- **Root-Cause**: `dockPrintPanel()` ändert `mapContainer`-Breite und ruft `map.updateSize()` verzögert (350ms). `showPrintFrame()` → `updateFrameSize()` läuft aber sofort, mit der alten Resolution/Viewport-Grösse. Ebenso `adjustZoomForPrintFrame()` liest veraltete `clientWidth`.
- **Fix**: In `triggerPrintMapUpdate()` nach `updateSize()` auch `updateFrameSize()` aufrufen. `adjustZoomForPrintFrame()` in `openPdfPrinter` um 450ms verzögern (nach Map-Update).
- **Guardrail**: Nach `map.updateSize()` immer alle davon abhängigen Berechnungen (Frame-Grösse, Viewport-Ratio) erneut triggern.

## 2026-06-xx — Legend-Button fehlt bei ArcGIS REST Layern in "Dargestellte Themen"
- **Symptom**: Planungszonen kantonal/kommunal aktiv → kein Legenden-Icon im "Dargestellte Themen"-Panel.
- **Root-Cause**: Die API läuft im **Database-Modus** (`source: "database"`), nicht File-Modus. Alle `legendLink`/`legendTitle` sind `null` in der DB. Fix-Versuch über `processLayerItems()` (File-Modus) und `legend`-Property-Vererbung griff nicht. Der Click-Handler suchte nach `/rest/services/` im URL-Pattern, aber die Layer nutzen `agsproxy.php?path=`.
- **Fix**: Button-Bedingung in `tnet-lm-active.js` auf `l.layerType === 'arcgisRest' && l.url.indexOf('agsproxy.php') !== -1` geändert. Click-Handler extrahiert Service-Pfad aus `agsproxy.php?path=<pfad>` und konstruiert `legend-proxy.php?service=<pfad>`.
- **Guardrail**: Nie annehmen, dass die API im File-Modus läuft — immer `?debug=1` prüfen für `source`-Feld. ArcGIS-Layer verwenden `agsproxy.php?path=`, nicht `/rest/services/`.

---

## 2026-03-03 — Entfernte Themen bleiben im BGI/WMS-Katalog angehakt
- **Symptom**: Layer in "Dargestellte Themen" entfernt, im BGI/WMS-Katalog bleibt die Checkbox trotzdem aktiv.
- **Root-Cause**: `tnet-wms-panel.js` synchronisiert Checkboxen über das Event `tnet-wms-layer-removed`. Beim `removeLayer()` in `tnet-lm-store.js` wurde dieses Event nur für `wms:`-Layer dispatcht, nicht für normale Geoadmin-Layer-IDs (`ch.*`).
- **Fix**: In `tnet-lm-store.js` beim Entfernen normaler Layer ebenfalls `tnet-wms-layer-removed` mit `detail.name = layerId` dispatchen.
- **Guardrail**: Bei Layer-Entfernung immer beide UI-Pfade synchronisieren: Store-Events (`layer-visibility`) **und** WMS-Panel-Event (`tnet-wms-layer-removed`).

---

## 2026-03-03 — Entfernte Themen bleiben im Dojo-Themenkatalog angehakt (alle LayerManager)
- **Symptom**: Layer in "Dargestellte Themen" entfernt → Checkbox im Themenkatalog (nw, ow, bund, divers) bleibt checked.
- **Root-Cause**: `TnetLayerSwitch(id, 'off')` in `tnet-mapplus-helpers.js` rief nur `map.removeLayer(found)` auf — direkte OL-Entfernung ohne Benachrichtigung des Dojo ClassicLayerMgr. Der ClassicLayerMgr steuert Checkboxen intern via `switchLayer(id, false)` → `dijit.byId(id).set('checked', false)`. Zusätzlich wurde nur der **erste** LyrMgr gesucht (nw), nicht alle (ow, bund, divers).
- **Fix**: `TnetLayerSwitch('off')` iteriert jetzt über **alle** `am.LyrMgr` die `targetMap: ['main']` haben und ruft jeweils `mgr.switchLayer(layerId, false)` auf. In `tnet-lm-store.js` wird `TnetLayerSwitch` immer zuerst aufgerufen, `_olLayerRef` nur noch als Sicherheitsnetz.
- **Guardrail**: Layer-Entfernung **immer** über `ClassicLayerMgr.switchLayer(id, false)` — nie nur `map.removeLayer()`. Immer alle LyrMgr iterieren, nicht beim ersten `break`en.

---

## 2026-02-27 — Staging: "Dienst nicht gefunden" obwohl Dienst in raw-conf sichtbar
- **Symptom**: Staging-Merge meldet für alle gewählten Dienste "Dienst nicht gefunden: ewn_EWN_NIS" — Verwalten-Tab zeigt sie aber korrekt an.
- **Root-Cause**: `listRawConf()` berechnete `$svcKey = $parts[0] . '/' . $parts[1]` für ALLE Tiefen. Bei 2-Ebenen-Struktur (`service_dir/datei.conf`) wurde dadurch `svcKey = 'ewn_EWN_NIS/layers_...'` (directory+filename) statt nur `'ewn_EWN_NIS'` (directory). `stageServicesToImportToCore` suchte dann `is_dir('ewn_EWN_NIS/layers_...')` → nicht gefunden.
- **Fix**: Drei-Wege-Logik für svcKey: `count >= 3` → `parts[0]/parts[1]`, `count == 2` → `parts[0]`, `count == 1` → extractService(). Gleiche Korrektur in `deleteRawConfBackups`. `stageServicesToImportToCore` mit Flat-Fallback ergänzt.
- **Guardrail**: svcKey-Berechnung zentral halten — nur EINE Funktion nutzen. Bei 2-Level-ZIP-Struktur immer nur `$parts[0]` als Service-Dir, nie Directory+Dateiname kombinieren.

---

## 2026-02-27 — Import-Tab eingefroren bei "Dienste werden geladen…" (JS komplett defekt)
- **Symptom**: ags-import.html lädt, Import-Tab zeigt dauerhaft "Dienste werden geladen…", keine Reaktion — als ob JS gar nicht läuft.
- **Root-Cause**: Beim Einfügen des Refresh-Button-Handlers (Staging-Case) wurde nur der Handler-Body eingefügt, nicht die öffnende `addEventListener`-Zeile — `});` stand orphaned auf Modulebene → JS-SyntaxError → komplettes Skript defekt.
- **Fix**: `document.getElementById('ags-btn-refresh').addEventListener('click', function() {` vor der ersten Handler-Zeile ergänzt.
- **Guardrail**: Nach jedem Multi-Replace sofort im Browser verifizieren; `});` auf 0-Ebene ohne passendes Öffner ist immer ein SyntaxError, der das gesamte Script bricht.

---

## 2026-05-xx — Editor-Textarea unsichtbar (kein Highlighting, Caret fehlt)
- **Symptom**: Editor öffnet sich, Textarea bleibt leer/unsichtbar, kein Cursor sichtbar.
- **Root-Cause**: CSS-Overlay-Ansatz erfordert `color:transparent; caret-color:#d4d4d4` auf der Textarea — fehlte nach Redesign.
- **Fix**: `.fe-editor-wrapper { position:relative }`, Textarea + `<pre>` mit `position:absolute; inset:0`; Textarea `color:transparent`, `<pre>` als Highlight-Overlay darunter (pointer-events:none).
- **Guardrail**: Bei Overlay-Editor immer prüfen ob `caret-color` gesetzt ist, sonst ist Cursor unsichtbar.

## 2026-05-xx — `switchEditorTab()` deprecated nach Overlay-Redesign
- **Symptom**: Tabs-Button-Handler warf Fehler weil `#file-editor-tabs` nicht mehr im DOM war.
- **Root-Cause**: Tabs wurden entfernt, aber Event-Handler auf `.fe-tab`-Buttons noch vorhanden.
- **Fix**: `switchEditorTab()` zu leerem Stub gemacht, Tabs-Event-Handler entfernt, Scroll-Sync-Handler stattdessen hinzugefügt.
- **Guardrail**: Nach DOM-Umstrukturierung immer alle Event-Handler auf entfernte Elemente suchen und entfernen.

## 2026-02-27 — Datei-Editor-Modal im AGS-Modal muss in `.tb-ags-dialog` liegen

- **Symptom**: Editor-Overlay `position:fixed` auf Body-Ebene würde durch den Dojo z-index-Stack vom AGS-Modal überdeckt, wenn das AGS-Modal seinerseits in einem Dojo-FloatingPane sitzt.
- **Root-Cause**: fixe z-index-Hierarchie — AGS-Modal hat eigenen Stacking-Context.
- **Fix**: Editor-Overlay `position:absolute; inset:0` innerhalb von `.tb-ags-dialog` (relativem Container), damit es den Modal-Dialog überlagert ohne Dojo-Stack zu brechen. Standalone-Seite nutzt weiterhin `position:fixed` auf Body.
- **Guardrail**: Neue modals in tree-builder.html → `position:absolute` verschachteln, nicht `position:fixed` auf Body-Ebene.

---

## 2026-02-27 — AGS-Modal/Seite hatten inkonsistente Multi-Workflows

- **Symptom**: Import war global blockiert (kein paralleler Start), Shift-Range fehlte, Verwalten war zwischen eigenständiger Seite und Tree-Builder-Modal funktional uneinheitlich (Backup-Filter/-Delete fehlte teilweise).
- **Root-Cause**: Historisch getrennte UI-Implementierungen mit unterschiedlichen Feature-Ständen; harte globale Export-Sperre per Flag.
- **Fix**: Beide UIs auf denselben Umfang gebracht: Shift-Range bei Checkboxen (Import + Verwalten), Backup-Filter (Aktive/Alle/Nur Backups), Bulk-Action `ags-delete-backups` für ausgewählte Services; Import-Flow auf parallele Requests mit laufender Count-Anzeige umgestellt.
- **Guardrail**: AGS-Änderungen immer in `ags-import.html` **und** Tree-Builder-AGS-Modal spiegeln und OpenAPI-Action-Enums/Query-Parameter synchron mitziehen.

---

## 2026-02-27 — raw-conf Pfad war zwischen Backend, UI und Doku inkonsistent

- **Symptom**: Export-/Manage-Meldungen zeigten `data/tmp/raw-conf`, während Projektvorgaben und andere Teile bereits `/data/Client_Data/nwow/raw-conf` verwendeten.
- **Root-Cause**: Historisch gewachsene Änderungen führten zu gemischten Pfaden in API-Konstante, UI-Texten und Lessons-Learned-Einträgen.
- **Fix**: `RAW_CONF_DIR` in der API und die AGS-Statusmeldungen im UI auf `/data/Client_Data/nwow/tmp/raw-conf` vereinheitlicht; widersprüchliche Lessons-Learned-Stelle angepasst.
- **Guardrail**: Betriebsrelevante Pfade nur zentral über Konstanten führen und bei Pfadänderungen Backend, UI-Texte und Doku in einem Schritt synchronisieren.

---

## 2026-02-26 — FloatingPane blockiert Layer-Laden

- **Symptom**: Keine Layer geladen, ganzer `require`-Callback wird nie aufgerufen.
- **Root-Cause**: `"dojox/layout/FloatingPane"` im Haupt-`require([])`-Array. Wenn das Modul fehlt/spät kommt, blockiert es den gesamten Callback.
- **Fix**: Aus dem Haupt-Array entfernt, in nested `require(['dojox/layout/FloatingPane'], fn)` verlagert.
- **Guardrail**: FloatingPane + ähnliche optionale Module **nie** in den Haupt-`require`-Array.

---

## 2026-02-26 — Info-Query feuert nicht auf Mobile

- **Symptom**: Klick auf Karte zeigt kein Info-Fenster.
- **Root-Cause**: `picking`-Flag auf Mobile nie gesetzt. Desktop setzt es via Toolbar-Button, Mobile hat keinen.
- **Fix**: `picking = true` im `tnet-app-ready` Listener auf allen Maps setzen.
- **Guardrail**: Bei Info-Debugging immer zuerst prüfen: `njs.AppManager.Maps[id].picking === true`?

---

## 2026-02-26 — Info-Ergebnisse rendern nicht

- **Symptom**: Info-Pane öffnet sich, aber Tabelle bleibt leer.
- **Root-Cause**: `dojox/layout/TableContainer` fehlt im `require`-Array.
- **Fix**: `"dojox/layout/TableContainer"` zum `require`-Array hinzugefügt.
- **Guardrail**: Wenn Dojo-Widgets fehlen → im Netzwerk-Tab nach 404 suchen.

---

## 2026-02-26 — URL-Layer gehen bei Reload verloren

- **Symptom**: `?layers=xyz` Parameter wird bei Seitenreload ignoriert.
- **Root-Cause**: Framework hat ADD→REMOVE→ADD Race Condition; Layer werden kurz nach dem Setzen wieder entfernt.
- **Fix**: `ensureUrlLayers()` mit 3 Retry-Zeitpunkten (500ms, 1500ms, 3000ms) nach `tnet-app-ready`.
- **Guardrail**: Layer-State immer asynchron mit Retries wiederherstellen, nie nur einmal bei init.

---

## 2026-02-26 — Dojo-Titelbar: display:none bricht Layout

- **Symptom**: Content-Bereich springt nach oben, überdeckt Titelbar.
- **Root-Cause**: Dojo berechnet `contentInfo.style.top = titleBar.offsetHeight + 'px'`. Mit `display:none` → `offsetHeight = 0`.
- **Fix**: Titelbar-Kinder leeren und eigenen Inhalt (Span + Buttons) direkt im Dojo-`.dojoxFloatingPaneTitle` einfügen.
- **Guardrail**: Dojo-Layout-Container NIE mit `display:none` verstecken. Stattdessen: Inhalt ersetzen.

---

## 2026-02-26 — TitleText ist ein Input, nicht ein Span

- **Symptom**: Weisse Box / Input-Styling in der Titelbar statt sauberem Text.
- **Root-Cause**: `.dojoxFloatingPaneTitleText` ist ein `<input type="text">`. Dojo setzt Inline-Styles (`background-image`, `border`, `-webkit-appearance`), die nicht per CSS überschreibbar sind.
- **Fix**: Alle Dojo-Kinder des Titelbars per JS entfernen, eigenes `<span>` mit Titel-Text einfügen.
- **Guardrail**: Dojo-TitleText NIE per CSS stylen → immer per JS ersetzen.

---

## 2026-02-26 — dijit.get('title') liefert HTML

- **Symptom**: Titelbar zeigt `<table border='0' cellpadding='0'...` statt "Objektinformation".
- **Root-Cause**: Dojo setzt `widget.title` auf den HTML-Inhalt der Ergebnistabelle. `dijit.get('title')` gibt diesen HTML-String zurück.
- **Fix**: Immer Fallback-String `'Objektinformation'` verwenden. Input-Value nur nehmen wenn kein `<`-Zeichen enthalten.
- **Guardrail**: `dijit.get('title')` auf FloatingPane → **verboten**. Immer eigenen Titel-String setzen.

---

## 2026-02-26 — CSS auf Mobile braucht !important

- **Symptom**: CSS-Regeln greifen nicht, Dojo-Styling bleibt.
- **Root-Cause**: Dojo setzt Inline-Styles direkt auf DOM-Elemente. Externe CSS-Regeln haben niedrigere Spezifität.
- **Fix**: Alle Mobile-CSS-Regeln mit `!important`.
- **Guardrail**: Auf Mobile **immer** `!important` bei CSS-Overrides verwenden.

---

## 2026-02-26 — Mobile-Themenbaum bleibt leer

- **Symptom**: Im Mobile-Bottom-Sheet wird kein Layerbaum angezeigt.
- **Root-Cause**: Legacy-Container wurde ausgeblendet, aber der neue Layer-Manager lieferte keinen gerenderten Katalog (Lade-/Init-Fehler) und es gab keinen Fallback.
- **Fix**: In `tnet-lm-init.js` einen robusten Fallback ergänzt: bei Timeout/leerem Katalog wird `lm-tree-container` entfernt und der Legacy-Baum automatisch wieder eingeblendet.
- **Guardrail**: Neue UI erst dann exklusiv machen, wenn ein erfolgreicher Render bestätigt ist; sonst immer automatisch auf Legacy zurückfallen.

---

## 2026-02-26 — tnet-app-ready wird nie gefeuert → Layer-Manager hängt

- **Symptom**: Layer-Manager zeigt weder Baum noch Suchfeld. Konsole zeigt nur `[LM-Init] Warte auf tnet-app-ready...` — kein Bootstrap.
- **Root-Cause**: Der `earlyCheckAppReady`-Poller in `index_de_m.htm` gibt nach 8s Splash-Timeout auf (`return` ohne Event-Dispatch), wenn die Map noch nicht bereit ist. Das `tnet-app-ready` Event wird dann **nie** gefeuert, obwohl die Map Sekunden später verfügbar ist.
- **Fix**: Doppelte Absicherung: 1) `index_de_m.htm` pollt nach Splash-Timeout weiter (alle 500ms, max 30s) und feuert Event nachträglich. 2) `tnet-lm-init.js` hat eigenes Polling als Fallback, prüft direkt `njs.AppManager.Maps['main']`.
- **Guardrail**: Nie auf ein einzelnes Event ohne Fallback warten. Bei Event-Abhängigkeiten immer Polling-Fallback einbauen, der den Zustand direkt prüft.

---

## 2025-07-17 — Neue API-Endpoints in Swagger-Docs nicht sichtbar

- **Symptom**: Neue Endpoints (ags-services, ags-export, ags-list-raw, ags-delete-raw, ags-read-raw) im PHP-Backend funktionieren, aber Swagger-UI unter `/maps/tnet/api/docs/` zeigt sie nicht.
- **Root-Cause**: `openapi.yaml` wurde nicht aktualisiert — enthielt nur die ursprünglichen 8 Pfade.
- **Fix**: Neue Tags (Tree-Builder, AGS Import) und Pfade (`/v1/treebuilder-api.php`, `/v1/treebuilder-api.php/ags`) samt Schemas in `openapi.yaml` ergänzt, hochgeladen.
- **Guardrail**: Bei neuen API-Endpoints immer auch `openapi.yaml` aktualisieren und mit deployen.

---

## 2026-02-26 — AGS Import als eigenständige Seite mit Multi-Delete

- **Symptom**: AGS-Import nur als Modal innerhalb des Tree-Builders verfügbar, Verwalten-Tab hat nur Einzel-Löschen (kein Multi-Select).
- **Root-Cause**: Feature war als schnelle Ergänzung ins Tree-Builder-Modal gebaut, Multi-Delete fehlte.
- **Fix**: Neue eigenständige Seite `ags-import.html` erstellt mit Import-Tab (Checkboxen, Multi-Export) und Verwalten-Tab (Checkboxen auf Service-Ebene, Alle/Keine, Multi-Delete mit Bestätigungs-Dialog). Gleiche API-Endpoints, kein Backend-Change nötig.
- **Guardrail**: Multi-Delete sequenziell über bestehende Single-Delete-API abwickeln (Promise-Kette), statt neuen Batch-Endpoint zu bauen — vermeidet Backend-Komplexität.

---

## 2026-02-26 — AGS Export meldet Erfolg aber Dateien fehlen

- **Symptom**: Export zeigt "✓ Export erfolgreich! 12 Dateien in data/raw-conf/ gespeichert", aber Verwalten-Tab ist leer.
- **Root-Cause**: Verzeichnis `/data/Client_Data/nwow/raw-conf` gehört User `trigonet` (Perms `0775`), PHP läuft als `www-data`. `file_put_contents` scheitert lautlos mit "Permission denied", aber der Code prüft den Rückgabewert nicht und meldet trotzdem Erfolg.
- **Fix**: (1) Permissions via SFTP auf `0777` gesetzt (wie `/data/tmp` es bereits hat). (2) PHP-Export: Schreibtest vor Beginn (`is_writable`), `file_put_contents`-Rückgabewert prüfen, fehlgeschlagene Dateien separat melden. (3) Frontend: Unterscheidet jetzt ✓ Erfolg / ⚠ Teilweise / ✗ Fehlgeschlagen.
- **Guardrail**: SFTP-Pfade ausserhalb von DocumentRoot immer `0777` setzen, da PHP als `www-data` läuft. Bei `file_put_contents` immer `=== false` prüfen.

---

## 2026-02-26 — Service-Gruppierung und Delete bei flacher Dateistruktur

- **Symptom**: Verwalten-Tab zeigt jede Datei als eigenen "Service", Delete schlägt fehl mit "Service-Verzeichnis nicht gefunden".
- **Root-Cause**: ZIP-Export der externen API speichert Dateien flach (ohne Unterverzeichnisse). Die Listing-Logik nutzte den Ordnerpfad als Service-Key, die Delete-Logik erwartete ein Verzeichnis.
- **Fix**: `extractServiceFromFilename()` extrahiert den Service-Namen aus Dateinamens-Pattern (`layers_TNET_<SVC>.conf`, etc.). Delete-Funktion unterstützt jetzt sowohl Verzeichnis- als auch flache Dateien.
- **Guardrail**: Bei Service-Gruppierung nicht auf Verzeichnisstruktur verlassen — immer auch Dateinamen-basierte Gruppierung unterstützen.

---

## 2026-02-26 — file_get_contents schlägt für Server-zu-Server-Aufrufe fehl

- **Symptom**: `file_get_contents(https://www.gis-daten.ch/gapi/...): Failed to open stream: HTTP request failed!`
- **Root-Cause**: `file_get_contents` liefert bei HTTP-Fehler-Statuscodes (4xx/5xx) nur `false` ohne Details. Zudem kann es bei Self-Referencing (Server ruft sich selbst auf) zu Problemen kommen.
- **Fix**: Auf `curl_exec()` umgestellt mit `CURLOPT_RETURNTRANSFER`, HTTP-Status-Code-Prüfung und Error-String-Extraktion via `curl_error()`. Beide AGS-Endpunkte (`getAgsServices`, `exportAgsServices`) verwenden jetzt cURL.
- **Guardrail**: Für externe HTTP-Aufrufe in PHP immer cURL statt `file_get_contents` verwenden — bessere Fehlerinfos, Status-Code-Handling, Timeout-Kontrolle.

---

## 2026-02-26 — raw-conf Verzeichnis-Permissions werden periodisch zurückgesetzt

- **Symptom**: SFTP `chmod 0777` auf `/data/raw-conf` wird nach kurzer Zeit auf `0775` zurückgesetzt. PHP (`www-data`) verliert Schreibrechte.
- **Root-Cause**: Serverseitiger Prozess (Backup, Sicherheits-Cron o.ä.) setzt Verzeichnis-Permissions periodisch zurück. Owner bleibt `trigonet`, PHP läuft als `www-data` → `0775` reicht nicht.
- **Fix**: (1) Via SFTP Verzeichnis gelöscht und neu erstellt (temporär als 0777). (2) PHP-Code: `getWritableRawConfDir()` mit Fallback-Strategie — prüft primären Pfad (`/data/Client_Data/nwow/raw-conf`), versucht chmod, fällt zurück. Ergebnis wird pro Request gecacht.
- **Guardrail**: Nie von festen Permissions auf Server-Verzeichnissen ausgehen. Immer dynamisch prüfen (`is_writable`) und Fallback-Pfad bereithalten.

---

## 2026-02-26 — raw-conf unter /data/tmp/ statt direkt unter /data/

- **Symptom**: `/data/Client_Data/nwow/raw-conf` (SFTP `/data/raw-conf`) immer gid=1000 (trigonet), Permissions werden periodisch auf 0775 zurückgesetzt. PHP (www-data, uid/gid 33) hat keinen Gruppen-Zugriff. `chown` via SFTP scheitert (nur root darf das).
- **Root-Cause**: `/data/raw-conf` wird von `trigonet` erstellt → Owner+Gruppe = trigonet. `/data/tmp/` hingegen hat gid=33 (www-data) + 0777 → PHP-erstellte Unterverzeichnisse gehören automatisch www-data.
- **Fix**: `RAW_CONF_DIR` auf `/data/Client_Data/nwow/tmp/raw-conf` vereinheitlicht.
- **Guardrail**: Auf Servern mit getrennten Users (SFTP ≠ PHP) immer Verzeichnisse unter einem Pfad anlegen, der bereits der PHP-Gruppe gehört (z.B. `/tmp/` oder ein bestehendes www-data-Verzeichnis). Nie darauf vertrauen, dass chmod/chown via SFTP dauerhaft wirkt.
---

## 2026-02-27 — Staging Merge: 0 Dateien gemergt (_TNET_-Filter killt Quelldateien)

- **Symptom**: Merge-Aktion meldet Erfolg, aber `ImportToCore/<kuerzel>/` enthält keine Dateien.
- **Root-Cause**: `stripos($fname, '_TNET_') !== false` sollte bereits-gemergte Outputs überspringen, filtert aber ALLE Quelldateien aus, da diese `layers_TNET_ewn_EWN_NIS.conf` heissen (enthalten `_TNET_`). Outputs landen in separatem `ImportToCore/`-Dir — werden also nie als Quelle gescannt.
- **Fix**: `_TNET_`-Filter-Zeile komplett entfernt (unnötig, da Quelle ≠ Ziel-Verzeichnis). Output-Naming von `prefix_TNET_kuerzel.ext` auf `prefix_kuerzel.ext` geändert (z.B. `layers_ewn.conf`).
- **Guardrail**: Filter in Merge-Logik nie auf Namens-Patterns der Quelldateien matchen — immer Verzeichnis-Trennung (raw-conf vs. ImportToCore) als Abgrenzung nutzen.

---

## 2026-06-xx — Staging Tab Split: ImportToCore Ausgabe-Panel

- **Symptom**: Nach Merge-Aktion war kein direkter Blick auf die erzeugten ImportToCore-Dateien m\u00f6glich; Nutzer musste SFTP oder separates Tool nutzen.
- **Root-Cause**: Staging-Pane war einspaltig — nur Linke Seite (Dienstauswahl) ohne Anzeige der Merge-Ausgabe.
- **Fix**: Split-Layout `.staging-split { display:flex }` mit `.staging-left` (47%) und `.staging-right` (flex:1). Rechts: `loadStagingOutput()` listet ImportToCore-Kürzel-Dirs + Dateien, Dateien per `openFileEditor(path, 'staging-read-output', 'staging-write-output', cb)` editierbar. `_feReadAction`/`_feWriteAction`/`_feAfterSave` machen den gemeinsamen File-Editor kontextsensitiv (raw-conf UND ImportToCore).
- **Guardrail**: `openFileEditor` immer mit `readAction`/`writeAction`/`afterSave` aufrufen — nie hardcoded `ags-read-raw` annehmen wenn der Editor auch f\u00fcr andere Verzeichnisse genutzt wird.

---

## 2026-06-xx  Nach Import: Selektion blieb bestehen, bereits importierte Dienste nicht erkennbar

- **Symptom**: Nach erfolgreichem Export/Import bleiben alle Checkboxen angehakt; re-importierbare Dienste sind nicht von neuen unterscheidbar.
- **Root-Cause**: `exportAgsServices()` rief nur `updateImportSelCount()`  kein Deselektieren, kein visuelles Markieren.
- **Fix**: Nach Export-Erfolg Checkboxen leeren; `_importedServiceNames` bef�llen; `refreshImportImportedMarkers()` setzt Klasse `imported` + Badge + Legende. `loadRawConfList` bef�llt dieselbe Map.
- **Guardrail**: Nach mutierendem API-Call immer visuellen State synchronisieren  Checkboxen leeren und Markierungen updaten statt nur Z�hler refreshen.

---

## 2026-02-28 — Legend-Proxy: ArcGIS `size`-Parameter liefert proportional skalierte Symbole

- **Symptom**: Bei `size=80,160` liefert ArcGIS nicht exakt 80×160, sondern z.B. 106×213 — grösser, aber proportional skaliert.
- **Root-Cause**: ArcGIS REST Legend-Endpoint interpretiert `size` als Zielgrösse, skaliert aber proportional zum Originalsymbol. Kein exaktes Clipping.
- **Fix**: CSS `width`/`height` auf `<img>` erzwingt exakte Anzeigegrösse; ArcGIS liefert dennoch höhere Auflösung → bessere Darstellung.
- **Guardrail**: Nie `size`-Parameter allein für exakte Pixelgrössen verlassen — immer zusätzlich CSS/HTML `width`/`height` setzen.

---

## 2025-07-13 — Tree-Builder Staging Redesign: renderTree() per-LyrMgr-Closure

- **Symptom**: Beim Umstellen von Tab-basiertem Rendering (ein LyrMgr gleichzeitig) auf unified Tree (alle LyrMgrs als Root-Knoten) referenzierten D&D-Handler die falsche `profile`-Variable → Drops landeten im falschen LyrMgr.
- **Root-Cause**: `renderTree()` hatte eine einzige `var profile = getActiveTree()` am Anfang. Bei mehreren LyrMgrs in einem DOM müssten Handler wissen, welcher LyrMgr ihr Ziel ist.
- **Fix**: `renderTree()` iteriert über alle LyrMgr-Keys und ruft `renderLyrmgrBlock(container, lmKey, profile)` pro Eintrag auf. Jeder Aufruf hat eigene DOM-Elemente und eigenen `profile`-Closure. D&D-Daten enthalten `srcLyrmgr` für Cross-LyrMgr-Operationen.
- **Guardrail**: Bei mehreren unabhängigen Bäumen in einem DOM immer per-Subtree-Closure mit eigenem Datenzugriff verwenden — nie eine Single-Variable für alle Handler teilen.

---

## 2026-03-02 — Sidepane überlappt Footer + fixe Accordion-Höhen

- **Symptom**: Sidepane-Inhalt (`#spring`) ragt über den `#map-footer-bar` (26px) hinaus. Themenkatalog und Dargestellte Themen haben nicht verstellbare Höhen (fest 450px / 500px).
- **Root-Cause**: `#spring` hatte `max-height: calc(100vh - 79px)` — berücksichtigte nur Header (69px) und close_switch (10px), nicht den 26px Footer. `#kantons_container` war auf `height: 450px !important` fixiert.
- **Fix**: 1) `max-height` auf `calc(100vh - 105px)` geändert (79px + 26px Footer). 2) Fixe Höhen durch CSS-Variablen ersetzt (`--tnet-catalog-height`, `--tnet-active-height`). 3) Neues Modul `tnet-accordion-resize.js` mit Drag-Splitter-Handles am unteren Rand der Accordion-Inhalte. Höhen werden in localStorage gespeichert. 4) Guard `window.__tnetResizing` in `tnet_toc.js` → verhindert dass MutationObserver/aggressiveFix die Resize-Styles überschreibt.
- **Guardrail**: Bei `max-height`-Berechnungen auf Sidepanes immer alle fixen UI-Elemente (Header, Footer, Toolbars) abziehen. Vor Inline-Style-Manipulation im Sidepane prüfen ob der MutationObserver in tnet_toc.js eine Feedback-Schleife auslöst — immer `window.__tnetResizing`-Flag nutzen.

---

## 2026-03-02 — Dargestellte Themen: Eye-Toggle + Remove wirkungslos, WMS Remove geht nicht

- **Symptom**: Eye-Toggle (Sichtbarkeit) in "Dargestellte Themen" ohne Effekt. Remove entfernt Eintrag aus Liste, Layer bleibt auf Karte. WMS-Checkbox: Hinzufügen funktioniert, Entfernen nicht.
- **Root-Cause**: Drei Bugs: (1) `_olLayerRef` wurde nur für WMS-Einträge gespeichert, nicht für reguläre Layer — dadurch kein direkter OL-Zugriff. (2) `_findOLLayer` suchte nur Top-Level-Layer, nicht in OL-LayerGroups. (3) `removeLayer` bei `visible=false` (Auge aus) entfernte Layer nur aus der Liste, nicht von der Karte. (4) WMS-Panel nutzte `njs.AppManager` statt `window.njs.AppManager` — in Strict-Mode-IIFE potentiell undefiniert, Fehler wurden stumm verschluckt (`catch(e){}`).
- **Fix**: (1) `_olLayerRef` in `_syncFromMap` und `_onOLLayerAdd` für ALLE Layer setzen. (2) `_findOLLayer` rekursiv gemacht (sucht auch in `layer.getLayers()`). (3) `removeLayer` immer `map.removeLayer(_olLayerRef)` aufrufen, Fallback via `TnetLayerSwitch`. (4) WMS-Panel: `window.njs`/`window.top.njs` mit Fehler-Logging statt stiller Catch.
- **Guardrail**: Bei OL-Layer-Manipulation immer gespeicherte `_olLayerRef` bevorzugen statt Suche via `name`-Attribut. Nie `catch(e){}` ohne Logging verwenden — erschwert debugging massiv.

---

## 2026-03-02 — Themenkatalog: Level-2-Gruppen (Gemeindegrenzen etc.) lassen sich nicht einklappen

- **Symptom**: Klick auf Gruppenüberschriften (z.B. Gemeindegrenzen, Höhenlinien) im Themenkatalog hat keinen Effekt — die Gruppen bleiben immer aufgeklappt. Level-1 (Accordions wie GRUNDLAGEN, ÖREB) und Level-3 (Einzel-Layer) funktionieren.
- **Root-Cause**: CSS-Counter-Regeln verwendeten `.dijitClosed` als Klassenname. Dojo setzt aber `.dijitTitlePaneClosed` auf dem domNode (Widget-Root) und `.dijitClosed` nur auf dem titleBarNode (Geschwister-Element). Da `.dijitTitlePaneContentOuter` ein Kind des domNodes ist, matchte der Selektor `.dijitTitlePane.dijitClosed > .dijitTitlePaneContentOuter` kein einziges Element — die ULTIMATIV-Regeln (`display: block !important`) gewannen immer.
- **Fix**: Alle 7 Selektoren in den Counter-Regeln (tnet_toc.css, Zeilen 346–381) von `.dijitClosed` auf `.dijitTitlePaneClosed` geändert.
- **Guardrail**: Bei Dojo dijit.TitlePane immer die korrekte Klasse pro DOM-Ebene verwenden: `dijitTitlePaneClosed`/`dijitTitlePaneOpened` auf dem **domNode**, `dijitClosed`/`dijitOpen` auf dem **titleBarNode**. Mobile-CSS (tnet_override_m.css) als Referenz nutzen — dort war es bereits korrekt.

---

## 2026-03-02 — Level-2-Gruppen: Klassenname-Fix allein reicht nicht — Descendant-Selektoren sind das Problem

- **Symptom**: Trotz korrigiertem Klassennamen (`dijitTitlePaneClosed`) lassen sich Level-2-Gruppen (Gemeindegrenzen, Höhenlinien, etc.) im Themenkatalog weiterhin nicht ein-/ausklappen.
- **Root-Cause**: Die ULTIMATIV/SUPER-ULTIMATIV CSS-Regeln verwendeten **Nachfahren-Selektoren** (Leerzeichen) statt **Kind-Selektoren** (`>`). Dadurch matchten `#kantons_container .dijitTitlePane.active-tab .dijitTitlePaneContentOuter` und `#kantons_container .dijitTitlePane.active-tab .dijitReset` auch Level-2-Elemente tief in der Hierarchie — nicht nur die Kantons-Pane selbst. CSS setzte `display: block !important` auf Level-2-ContentOuter/wipeNode und blockierte Dojos Toggle-Animation komplett. Zusätzlich feuerte der `globalObserver` (MutationObserver) und der Capture-Phase-Click-Handler `startAggressiveFix()` bei jedem Level-2-Klick.
- **Fix**: (1) ALLE Descendant-Selektoren in ULTIMATIV/SUPER-ULTIMATIV Blöcken durch Child-Combinators (`>`) ersetzt — matchen jetzt nur noch direkte Kinder der Kantons-Pane. (2) Counter-Rules komplett entfernt (unnötig, da ULTIMATIV-Regeln Level-2 nicht mehr berühren). (3) `globalObserver`: Skip für Mutations innerhalb `.tabs2acc-panel`. (4) Capture-Phase-Click-Handler: Return bei Klick auf TitlePanes innerhalb `.tabs2acc-panel`.
- **Guardrail**: Bei CSS-Regeln für verschachtelte Dojo-Widgets **immer Kind-Selektoren (`>`) verwenden**, nie Nachfahren-Selektoren. Descendant-Selektoren in `#kantons_container` treffen unweigerlich auch tiefer verschachtelte TitlePanes. MutationObserver und aggressive Fix-Routinen müssen Level-2-TitlePanes explizit ausschliessen (`.closest('.tabs2acc-panel')`-Check).

---

## 2026-03-02 — WMS GetFeatureInfo für Custom-WMS-Layer

- **Symptom**: Über das WMS-Panel hinzugefügte Layer liessen sich nicht per Klick abfragen — kein Eintrag im Objektinfo-Panel.
- **Root-Cause**: Das Framework nutzt `wmsActiveLyrs` (ol.Collection registrierter MapTip-Instanzen) für GetFeatureInfo. Custom-WMS-Layer werden dort nie eingetragen, da sie keine Maptip-Config haben.
- **Fix**: In `tnet-wms-panel.js` eigenen `singleclick`-Handler auf die Hauptkarte registriert. Iteriert `_addedLayers`, ruft `source.getFeatureInfoUrl()` pro sichtbarem WMS-Layer auf (Format-Fallback: JSON→GML→HTML→text/plain), nutzt `wmsproxy.php` als CORS-Proxy und injiziert Ergebnisse als `dijit.TitlePane` in `njs_info_pane_content`. Proxy (`wmsproxy.php`) auf `GetFeatureInfo` erweitert.
- **Guardrail**: `wmsproxy.php` nur `GetCapabilities` + `GetFeatureInfo` erlauben — nie `GetMap` (Missbrauchsrisiko). GFI-Ergebnisse mit 300ms Delay einfügen, damit Framework-Clearing abgeschlossen ist.

---

## 2026-03-04 — Console-Spam trotz logLevel:'none' + Footer-Massstab fehlt

- **Symptom**: 238+ console.log-Meldungen trotz `logLevel: 'none'` in Config. Massstab 1:50 fehlt in Footer-Dropdown.
- **Root-Cause**: (1) Kein Modul prüfte den logLevel — alle nutzten direkt `console.log/warn/error`. (2) Footer-JSON5-Parser war zu simpel: Regex `//.*$` zerstörte URLs mit `://`, unquoted Keys wurden nicht gequoted. (3) Config lag an zwei Server-Pfaden mit unterschiedlichem Inhalt.
- **Fix**: (1) Neues `tnet-log.js` als zentrale Logging-Utility: liest `logLevel` synchron aus Config, gated alle Ausgaben. (2) 341 `console.*`-Aufrufe in 17 Modulen durch `TnetLog.*` ersetzt. (3) Footer-JSON5-Parser durch string-aware Variante ersetzt (wie in tnet-print.js). (4) Config-Pfad auf `/maps/tnet/config/` vereinheitlicht, alte Kopie gelöscht.
- **Guardrail**: Neue Module müssen `TnetLog.*` statt `console.*` verwenden. JSON5-Parsing immer string-aware (Zeichen innerhalb Strings nie als Kommentar-Start interpretieren).

---

## 2026-03-04 — Sidebar-Close: Handle verschwindet / Spalt bleibt

- **Symptom**: Nach dem Zusammenklappen blieb ein Spalt unter dem Header sichtbar; in einem Folgefix verschwand der Close-Handle komplett und das Panel liess sich nicht mehr aufklappen.
- **Root-Cause**: `#spring` wurde mit `height:0` und `overflow:hidden` kollabiert, wodurch der Handle (als Kind von `#spring`) mit weggeclippt wurde. Gleichzeitig wurden Resthöhen von Child-Elementen nicht konsistent neutralisiert.
- **Fix**: Im Close-Zustand werden alle `#spring`-Kinder ausser `.close_switch` auf `max-height:0`/`opacity:0` gesetzt; `#spring` bleibt auf Handle-Höhe (`10px`) mit `overflow:visible`; `.close_switch` bleibt relativ und klickbar.
- **Guardrail**: Bei Collapse-Layouts nie den einzigen Reopen-Trigger in einem `overflow:hidden`-Container clippen. Reopen-Element explizit sichtbar/klickbar halten und nur Nicht-Trigger-Inhalt kollabieren.

---

## 2026-03-04 — Sidebar-Close: Handle nicht bündig am Header

- **Symptom**: Nach dem Zusammenklappen blieb der Handle sichtbar, lag aber mit Abstand unterhalb des Headers statt bündig anzuliegen.
- **Root-Cause**: Resthöhen/Min-Heights kollabierter `#spring`-Kinder beeinflussten den normalen Flow und drückten den Handle nach unten.
- **Fix**: Close-Regeln für `#spring > *:not(.close_switch)` um `height:0` und `min-height:0` ergänzt; Handle im Close-Zustand absolut auf `top:0` innerhalb von `#spring` verankert; `#spring` bleibt `position:relative`.
- **Guardrail**: Bei Collapse-UI mit Trigger innerhalb des Containers Trigger-Position entkoppeln (absolute Verankerung) und bei Geschwister-Elementen immer auch `height/min-height` explizit nullen.

---

## 2025-07-09 — Tree-Builder: replace_string_in_file scheitert leise an grossen HTML-Dateien

- **Symptom**: `replace_string_in_file` meldet "successfully edited" aber die Datei bleibt unverändert (tree-builder.html, ~300 KB).
- **Root-Cause**: Grosse inlined HTML-Dateien mit JavaScript-Blöcken werden vom Edit-Tool manchmal nicht korrekt geschrieben, obwohl Matches gefunden werden.
- **Fix**: Für grosse Dateien (>100 KB) ein Python-Patch-Skript erstellen, das `str.replace()` auf den gelesenen Inhalt anwendet und die Datei direkt schreibt.
- **Guardrail**: Bei tree-builder.html und ähnlich grossen HTML-Dateien immer via Python-Skript patchen. Nach jedem Edit per Terminal verifizieren (`Select-String` oder Python-Check).

## 2025-07-09 — Tree-Builder: Config-Datei Tooltip + Rechtsklick

- **Symptom**: Im Tree-Builder war nicht erkennbar, aus welcher Server-Datei ein Layer stammt (nur Dateiname, kein voller Pfad).
- **Root-Cause**: `listAllLayers()` in treebuilder-api.php speicherte nur `basename($f)` als `sourceFile`, nicht den vollen Pfad.
- **Fix**: PHP: `sourceFilePath` (dir + filename) pro Layer hinzugefügt. JS: Gruppen-Header-Tooltip zeigt alle Config-Pfade; Source-Badge-Tooltip zeigt vollen Pfad; Rechtsklick auf Badge/Header öffnet Config im bestehenden Modal via neuem `read-config-file` API-Endpoint.
- **Guardrail**: Bei API-Erweiterungen die `openCtxMenu()`-Infrastruktur wiederverwenden statt eigene Kontextmenüs zu bauen.

## 2026-04-01 — Tree-Builder Publish ohne Git-Commit

- **Symptom**: `publishLyrmgr()` im Tree-Builder schrieb die lyrmgr.conf via SFTP, aber es wurde kein Git-Commit erstellt. Die Änderung war nicht versioniert.
- **Root-Cause**: `publishLyrmgr()` rief nur `/publish-lyrmgr-full` auf. Der Git-Commit-Schritt (POST `/git-commit-conf`) fehlte, obwohl er im Deployed-Tab (ags-import.html) bereits implementiert war.
- **Fix**: Non-blocking `fetch(GAPI_URL + '/git-commit-conf', ...)` nach erfolgreichem Publish eingefügt. Parameter: `deployPath` aus Response, `source: 'tree-builder'`, Message mit Profilname und Blockanzahl. Bei Erfolg wird die Alert-Box auf „Git ✓" aktualisiert.
- **Guardrail**: Bei jeder SFTP-Schreiboperation auf Config-Dateien prüfen, ob ein anschliessender Git-Commit nötig ist. Muster: non-blocking POST, catch ignoriert Fehler.

## 2026-03-04 — Neuer LM-Tree: Gruppen-/Subcategory-Namen zeigen Rohpfade statt Labels

- **Symptom**: Im neuen Desktop-Layermanager werden Gruppen als "Gis Basis/nw Basisplan Gis Dynamisch/gemeindegrenzen" und Subcategories als "Grundlagen" (ucfirst) statt NLS-Label "GRUNDLAGEN" angezeigt.
- **Root-Cause**: Die API (`layers.php`) im DB-Pfad setzt `name = catalog_node.display_name` ohne Bereinigung — die DB speichert den vollen Service-Pfad. Im File-Pfad wird für Subcategory-Namen nur `ucfirst($categoryId)` statt NLS-Lookup genutzt. Das Frontend hat keinen Fallback für Pfad-basierte Namen.
- **Fix**: (1) PHP: `getNlsLabel()` Funktion hinzugefügt (liest `lyrmgrResources.json`, gecacht). DB-Pfad: Gruppen/Subcategories bekommen NLS-Lookup, Fallback `extractLayerName()` (letztes Pfad-Segment). File-Pfad: Subcategory-Name per NLS auflösen. (2) JS: `_cleanPathName()` und `_cleanLayerNames()` in Store-Normalisierung — Pfade bereinigen, `displayName` über `name` bevorzugen.
- **Guardrail**: Bei Gruppen-/Kategorie-Namen aus der DB immer NLS-Lookup zuerst, dann Pfad-Bereinigung (letztes Segment). Nie den rohen `display_name` aus der DB unbereinigt durchreichen. Frontend-Fallback (`_cleanPathName`) als Sicherheitsnetz beibehalten.

## 2026-03-04 — Bundesthemen (ch.*) können nicht ein-/ausgeschaltet werden

- **Symptom**: Klick auf Bundesthemen-Layer (ch.ensi.*, ch.kantone.*) schaltet zuerst AUS statt EIN. Nach erfolgreichem Einschalten zeigt `toggleLayerEye` "OL-Layer nicht gefunden" (`_olLayerRef:false`).
- **Root-Cause**: Drei Bugs in `tnet-lm-store.js`: (1) `_onOLLayerAdd` setzt `_olLayerRef` nur wenn `!storeLayer.visible` — aber `setLayerVisible()` setzt `visible=true` bevor der async OL-Layer-Add passiert. (2) `_initLayerDefaults` übernimmt `visible: true` aus API-Daten als Ist-Zustand. (3) **Hauptursache**: `_watchMapChanges` unterdrückt `_onOLLayerAdd` **komplett** wenn `_suppressMapSync=true` — aber `setLayerVisible` setzt genau dieses Flag bevor `TnetLayerSwitch` den Layer lädt. Dadurch wird `_olLayerRef` für ALLE via `toggleLayer` aktivierten Layer nie gesetzt.
- **Fix**: (1) `_onOLLayerAdd`: `_olLayerRef` immer setzen, unabhängig vom `visible`-Status. (2) `_initLayerDefaults`: `l.visible = false` bedingungslos. (3) **Kern-Fix**: In `_watchMapChanges` den `add`-Handler aufgeteilt — `_olLayerRef` wird VOR dem `_suppressMapSync`-Check zugewiesen (auf storeLayer UND activeEntry). Nur State-Changes/Events werden unterdrückt.
- **Guardrail**: `_suppressMapSync` darf nie die Zuweisung von OL-Layer-Referenzen blockieren. Referenz-Updates (`_olLayerRef`) gehören VOR den Suppress-Check. Nur State-/Event-Propagation darf unterdrückt werden.

---

## 2026-03-04 — PHP OPcache blockiert Datei-Updates auf Server (Deploy fehlschlägt)

- **Symptom**: Nach SFTP-Upload von LayerImporter.php zeigt der Server identischen Fehler mit identischen Zeilennummern, trotz korrekter Datei auf Disk und `opcache_reset()`.
- **Root-Cause**: Nicht PHP OPcache — ein **HTTP-Response-Cache** (Reverse-Proxy/CDN vor www.gis-daten.ch) cached JSON-Antworten. Gleiche URL → gleiche gecachte Antwort. `opcache_invalidate()` und `opcache_reset()` wirkungslos weil das Problem vor PHP liegt. Beweis: Reflection-Endpoint (neue URL) zeigt korrekten Code, aber `?action=test-catalog` (gecachte URL) zeigt alten Fehler. Zeilennummern-Differenz (910 vs 913) = exakt die 3 eingefügten Zeilen.
- **Fix**: Cache-Busting-Parameter `&_bust=<timestamp>` an die URL anhängen → frische Antwort, Import erfolgreich (10.302 Knoten, 0 Fehler).
- **Guardrail**: Bei API-Tests auf dem Server **immer** einen Cache-Busting-Parameter `&_bust=<stamp>` anhängen. Nie davon ausgehen, dass JSON-Antworten nicht gecacht werden. Wenn identischer Fehler trotz Code-Änderung: Response-Cache prüfen, nicht nur OPcache.

---

## 2026-03-04 — LayerImporter.extractServiceBaseUrl() crasht bei NULL-URLs

- **Symptom**: `TypeError: Argument #1 ($url) must be of type string, null given` in `extractServiceBaseUrl()` während Catalog-Import.
- **Root-Cause**: `layer_definition.url` kann NULL sein in der DB (z.B. bei Gruppen ohne eigene URL). `FETCH_KEY_PAIR` liefert `[layer_id => null]`. Der foreach-Loop rief `extractServiceBaseUrl($url)` ohne Null-Check auf, und die Methode hatte `string $url` (non-nullable).
- **Fix**: (1) Methodensignatur auf `?string $url` geändert mit early-return bei null. (2) Null-Check vor dem Aufruf: `if ($url === null || $url === '') return $result;`. (3) Gesamter Coalesce-Block in `try/catch (\Throwable)` gewrappt.
- **Guardrail**: DB-Felder die NULL sein können: immer nullable Type-Hints verwenden und Null-Checks VOR dem Funktionsaufruf einbauen. `FETCH_KEY_PAIR` kann NULL-Values liefern.

## 2026-03-04 — Neuer Themenkatalog: Layer-Toggle wirkungslos (keine Layer auf Karte)

- **Symptom**: Klick auf Layer-Checkbox im neuen Themenkatalog → kein Layer wird auf der Karte dargestellt. `toggleLayer` meldet "Layer nicht gefunden oder ist Gruppe".
- **Root-Cause**: In der lyrmgr.conf haben Gruppen-Wrapper häufig die **exakt gleiche ID** wie ihr einziges Kind-Layer (z.B. `gis_basis/nw_basisplan_gis_dynamisch/gemeindegrenzen` als Gruppe UND als Blatt-Layer). `_findLayerRecursive()` suchte top-down und gab den **Gruppen-Knoten** (type='group') zuerst zurück. `toggleLayer` prüft `layer.type === 'group'` → return ohne Aktion.
- **Fix**: `_findLayerRecursive()` so angepasst, dass Blatt-Layer gegenüber gleichnamigen Gruppen-Knoten bevorzugt werden: Bei ID-Match + type=group/subcategory → zuerst Kinder durchsuchen; nur als Fallback den Gruppen-Knoten zurückgeben.
- **Guardrail**: Beim Aufbau hierarchischer Kataloge wo Eltern/Kind gleiche IDs haben können: rekursive Suchen müssen IMMER Blätter vor Containern bevorzugen. `findLayer` nie blind den ersten Match zurückgeben.

## 2026-03-04 — Dargestellte Themen (Active Panel) nicht scrollbar

- **Symptom**: Neue Active-Panel-Container (`#lm-active-container`) scrollt nicht, obwohl mehr Einträge vorhanden sind als sichtbar.
- **Root-Cause**: Drei Probleme: (1) CSS `max-height: calc(100vh - 260px)` war ~820px — Content überläuft nie innerhalb des Containers. (2) Dojo TitlePane setzt ContentOuter Inline-Styles beim Öffnen zurück → `overflow-y: auto` geht verloren. (3) `#lm-active-container` wird asynchron von `tnet-lm-init.js` erstellt, existiert ggf. noch nicht wenn `setupPanel()` in `tnet-accordion-resize.js` erstmals läuft → Inline-Styles werden auf NULL-Element angewendet.
- **Fix**: (a) CSS: `max-height` auf `var(--tnet-active-height, 300px)` mit `!important`-Overflow. Zusätzliche Regel auf `#tp_sort_menu > .dijitTitlePaneContentOuter` mit `overflow-y: auto !important`. (b) JS v2.1: `applyHeight()` setzt CSS-Variable `--tnet-active-height` als Fallback. Lazy Flag-Reads via `readFlags()` statt IIFE-Scope. Dojo `widget.watch('open', ...)` re-appliziert Styles nach Animation. Container-Nachverfolgung per Polling falls `#lm-active-container` verspätet erscheint.
- **Guardrail**: Bei Dojo-TitlePanes: Inline-Styles werden beim Open/Close überschrieben → immer CSS `!important` als Basis verwenden + JS re-apply nach Open. Asynchron erstellte Container brauchen Polling/Observer für nachträgliche Style-Anwendung.

## 2026-03-06 — Coalesce-Bridge: queryconnector filtert nicht bei root-linked MapTip-Einträgen

- **Symptom**: MapTip zeigt Ergebnisse aller 14 Sublayer, obwohl nur 2 sichtbar sind. queryconnector-Patch greift nicht.
- **Root-Cause**: MapTip-Einträge `_0` bis `_13` in multi.conf verwenden `linked_layer: "gis_oereb/nw_nutzungsplanung_def"` (Root-Key direkt), nicht einen Sublayer-Key. `_sublayerToRoot[rootKey]` → undefined. `_extractRootKey(rootKey)` → `"gis_oereb"` (falsch, splittet 2-Segment-Key).
- **Fix**: Queryconnector v2 mit 3-Strategie-Priorität: (1) Direct-Match: `_rootServices[linkedId]`, (2) Sublayer-Lookup: `_sublayerToRoot[linkedId]`, (3) Fallback: `_extractRootKey()` + Verifikation.
- **Guardrail**: MapTip-`linked_layer` kann sowohl ein Root-Key als auch ein Sublayer-Key sein. Root-Key Matching immer als erste Strategie prüfen.

## 2026-03-06 — Coalesce-Bridge: Framework-URL überschreibt Sublayer-Keys mit Root-Keys

- **Symptom**: URL wechselt von korrekten Sublayer-Keys auf Root-Key (`layers=gis_oereb/nw_nutzungsplanung_def`). Beim Reload wird der konsolidierte Layer statt der korrekten Sublayer aktiviert.
- **Root-Cause**: `njs.AppManager.updateMapStatusUrl()` wird bei jedem `moveend`/`loadend` aufgerufen, schreibt `layers=` mit LyrMgr-Root-Key-IDs via `history.replaceState()`.
- **Fix**: 3 Patches: (1) `_patchUpdateMapStatusUrl()` — nach Original: Root-Keys durch Sublayer-Keys ersetzen. (2) `_patchTnetLayerSwitch()` — bei `on`-Aufruf für Coalesce-Sublayer: über Store routen statt individuelles OL-Layer erstellen. (3) `restoreFromUrl()` auf `catalog-loaded`: Sublayer-Keys aus URL via Store aktivieren.
- **Guardrail**: Bei URL-State-Management immer prüfen, wer die URL schreibt (Framework vs. eigener Code). TnetLayerSwitch-Aufrufe für Coalesce-Sublayer MÜSSEN über den Store laufen, nie direkt über LyrMgr.switchLayersProgr().

## 2026-03-05 — Ghost-Layer: Coalesce-Layer bleiben auf Karte nach Entfernung

- **Symptom**: Layer bleiben auf der Karte sichtbar, obwohl sie aus dem Panel «Dargestellte Themen» entfernt wurden (kein Eintrag mehr im Store/Panel). Maptip funktioniert nicht auf Ghost-Layern, aber Räumliche Abfrage findet Daten.
- **Root-Cause (v4, endgültig)**: Das Framework erstellt beim Startup via `ClassicLayerMgr.switchLayersProgr()` → `lay.switchLayer(true)` **individuelle OL-Layer** für jeden Sublayer-Key (z.B. `gis_oereb/nw_nutzungsplanung_def/grundnutzung`). Diese gehen NICHT durch `TnetLayerSwitch` und NICHT durch die Coalesce-Bridge. Der Store erkennt sie via `_onOLLayerAdd` und zeigt sie im Active-Panel. Aber `_coalesceOLLayers[groupId]` wird NIE erstellt, weil `restoreFromUrl` die Layer als bereits sichtbar sieht. Beim Entfernen: `removeLayer` → `_layerToCoalesce[layerId]` existiert → Coalesce-Pfad → `_removeFromCoalesceOLLayer` findet kein `cEntry` → **return sofort** → OL-Layer bleibt auf der Karte!
- **Fix**: In `_removeFromCoalesceOLLayer` (tnet-lm-store.js): Wenn `cEntry` nicht existiert, Fallback auf `TnetLayerSwitch(layerId, 'off')` — das findet den Framework-OL-Layer am richtigen Namen und entfernt ihn via `mgr.switchLayer(sublayerKey, false)` → `lay.switchLayer(false)` → `map.removeLayer(this._lyr)`. Zusätzlich: `toggleLayerEye` Fallback über `_olLayerRef.setVisible()` für Startup-Layer ohne Coalesce-Entry.
- **Guardrail**: Wenn `_layerToCoalesce[id]` zwar gesetzt ist (aus Katalog) aber kein `_coalesceOLLayers`-Eintrag existiert (weil Framework die Layer beim Startup direkt erstellt hat), muss der Entfernungs-Code auf den Standard-Pfad (`TnetLayerSwitch off`) zurückfallen.
- **Fehlgeschlagene Ansätze (v1-v3)**: (1) Dreifach-Sicherung in Bridge — zu komplex. (2) `map.removeLayer(entry.olLayer)` — entry.olLayer zeigt auf Root, nicht auf individuelle Sublayer. (3) `_findFrameworkOLLayer(rootKey)` — findet Root-Layer, aber die Ghosts sind individuelle Sublayer-OL-Layer.
- **Update v5 2026-03-05**: v4-Fix greift nur wenn KEIN Bridge-`cEntry` existiert. Aber bei URL-Start (`?layers=...`) erstellt das Framework einen individuellen OL-Layer (name=sublayerKey) UND die Bridge einen Root-OL-Layer (name=rootKey) → zwei Layer übereinander. v4-Fallback (`!cEntry`) feuert nie, weil Bridge-Entry existiert. Fix: In `unregisterSublayer` (Bridge) zusätzlich `_findFrameworkOLLayer(sublayerKey)` aufrufen und individuellen OL-Layer von der Map entfernen. Auch bei `registerSublayer` den individuellen Layer sofort entfernen (Doppel-Schutz während Nutzung).
- **Update v6 2026-03-05**: v5-Cleanup in `registerSublayer` läuft zu FRÜH — der individuelle Framework-Layer existiert noch nicht zu dem Zeitpunkt. Framework erstellt ihn verzögert via `switchLayersProgr` oder `ensureUrlLayers` NACH der Bridge-Registrierung. Fix: Ghost-Schutz direkt im `_watchMapChanges` → `map.getLayers().on('add')` Listener (tnet-lm-store.js). Prüft VOR `_olLayerRef`-Setzen und `_suppressMapSync`: wenn `TnetCoalesceBridge.isManagedSublayer(lid)` → sofort `map.removeLayer(olLayer)`. Fängt den Layer exakt im Moment ab in dem er zur Map hinzugefügt wird, unabhängig vom Timing.
- **KRITISCH v6b**: `map.removeLayer()` synchron innerhalb eines `map.getLayers().on('add')` Handlers aufrufen **korrumpiert OpenLayers' interne Collection**! ALLE nachfolgenden Layer-Operationen brechen (Basemap-Wechsel, Layer schalten, etc.). Fix: `olLayer.setVisible(false)` sofort (unsichtbar), dann `setTimeout(function() { map.removeLayer(olLayer); }, 50)` deferred. **Guardrail**: NIEMALS `removeLayer` synchron in einem `add`-Event-Handler aufrufen — immer deferren!

## 2026-03-05 — Breadcrumb zeigt falschen Katalogpfad (z.B. ÖREB statt Grundbuchplan)

- **Symptom**: Objektinfo-Breadcrumb zeigt „ÖREB > RAUMPLANUNG > ..." obwohl der Layer im Katalog unter „Grundlagen > Grundbuchplan" platziert ist. Tiefste Verschachtelung im Dojo-LyrMgr-Baum gewinnt immer.
- **Root-Cause**: `resolveFastBreadcrumb` (tnet-info-panel.js) baut eine Lookup-Map aus dem Dojo-`arCategories`-Baum. Bei Mehrfachvorkommen (gleicher `layer.name` in mehreren Kategorien) überschreibt der letzte Traversal. Scoring: `score += path.length` → tiefster Pfad bevorzugt. Dojo-Baum hat artikulierte Tiefen-Struktur mit NLS-Labels, die den Admin-Katalog nicht widerspiegelt.
- **Fix**: TNET-Katalog (aus API / `lyrmgr.conf`) als **primäre Breadcrumb-Quelle** verwenden. Neue Methode `TnetLMStore.getLayerCatalogPath(prefix)` traversiert rekursiv `_catalog` (exakt + Prefix-Match). `resolveFastBreadcrumb` prüft zuerst den TNET-Katalog; nur bei Nicht-Treffer Fallback auf Dojo-LyrMgr-Baum. Breadcrumb-Cache wird bei `catalog-loaded` Event invalidiert.
- **Guardrail**: Für Breadcrumbs immer den TNET-Katalog als autoritative Quelle verwenden — der Dojo-LyrMgr-Baum hat unkontrollierbare Tiefe und Mehrfachvorkommen.

## 2026-03-06 — Feature: Breadcrumb-Klick → Layer im Themenkatalog hervorheben

- **Feature**: Klick auf Breadcrumb im Info-Panel öffnet den Themenkatalog, expandiert Eltern-TitlePanes, aktiviert den richtigen Kantons-Tab und scrollt zum Layer mit Highlight-Animation.
- **Implementierung**: `scrollToLayerInCatalog(linkedLayerId)` in tnet-info-panel.js. Findet Layer-DOM via `div_<key>` oder `dijit.byId(<key>)`. Traversiert DOM aufwärts um Kantons-Tab zu bestimmen und TitlePanes zu öffnen. `renderBreadcrumbInTitleBar` erweitert um `data-linked-layer` Attribut und Click-Handler. CSS: `.tnet-maptip-breadcrumb-clickable` (cursor, hover-Feedback), `.tnet-catalog-highlight` (@keyframes Puls-Animation in `--m-color-primary`).
- **Guardrail**: `scrollIntoView` mit 450ms Delay aufrufen — TitlePane-Animationen brauchen Zeit. `e.stopPropagation()` im Click-Handler, sonst öffnet/schliesst sich das übergeordnete TitlePane.

## 2026-03-06 — Feature: Ctrl+Klick → Alle Geschwister-Knoten im Katalog öffnen/schliessen

- **Feature**: Ctrl+Klick auf einen Kategorie-Knoten im Themenkatalog toggelt alle Geschwister derselben Hierarchiestufe (gleicher Parent-Container, gleiches `data-lyrmgr-depth`).
- **Implementierung**: Im TitleBar-Click-Handler (tnet-lyrmgr-patch.js, Abschnitt „Nativer DOM-Click") wird `e.ctrlKey || e.metaKey` geprüft. Bei Ctrl: Parent-Container durchlaufen, alle `dijitTitlePane[data-lyrmgr-depth="<N>"]` Geschwister finden, jeweils `_setOpenAttr(targetOpen)` aufrufen.
- **Guardrail**: Nur Geschwister im selben Parent-Container toggeln (nicht global alle Panes derselben Tiefe). `dijit.byNode()` in try/catch, da nicht alle Panes das Widget haben.

## 2026-03-06 — Coalesce-Layer rendert erst nach doppeltem Toggle (aus/ein)

- **Symptom**: Beim ersten Einschalten eines Coalesce-Sublayers (z.B. ÖREB Nutzungsplanung) wurde der Karteninhalt nicht dargestellt. Erst nach Aus- und wieder Einschalten war der Layer sichtbar. Zusätzlich wurde die URL (`layers=`) nicht aktualisiert.
- **Root-Cause**: `registerSublayer()` in der Coalesce-Bridge rief `TnetLayerSwitch(rootKey, 'on')` auf, was intern `switchLayersProgr()` (asynchron) triggert. Direkt danach wurde synchron `_findFrameworkOLLayer(rootKey)` geprüft — der OL-Layer existierte aber noch nicht (async!). Die Bridge gab `false` zurück → der Store fiel auf den Standard-Coalesce-Pfad zurück und erstellte einen eigenen `ol.source.ImageArcGISRest`-Layer. Beim zweiten Toggle war der Framework-OL-Layer bereits da → Bridge funktionierte. Der Standard-Coalesce-Pfad hatte zudem keine URL-Sync → `layers=`-Parameter blieb leer.
- **Fix**: (1) `registerSublayer()` gibt jetzt immer `true` zurück (kein sofortiger Fallback). Der OL-Layer wird asynchron mit Retry gesucht (bis 12 Versuche, 300–1500ms). Erst nach allen Retries wird aufgeräumt. (2) Öffentliche `scheduleUrlSync()` Methode auf Bridge exponiert. (3) Standard-Coalesce-Pfad im Store ruft `TnetCoalesceBridge.scheduleUrlSync()` auf.
- **Guardrail**: Nach `TnetLayerSwitch()` NIEMALS synchron auf den OL-Layer prüfen — `switchLayersProgr` ist asynchron. Immer Retry-Pattern verwenden.

## 2026-03-06 — Coalesce-Layer laden nicht aus URL beim App-Start

- **Symptom**: URL mit `layers=gis_oereb/nw_nutzungsplanung_def/ueberlagernde_festlegung|.../grundnutzung` zeigt beim Start keine Layer an.
- **Root-Cause**: `registerSublayer()` rief `TnetLayerSwitch(rootKey, 'on')` auf, aber das Framework kennt den Root-Service-Key (`gis_oereb/nw_nutzungsplanung_def`) nicht als konfigurierten Layer → `switchLayersProgr` erzeugt keinen OL-Layer → trotz Async-Retry wird nie einer gefunden → Layer bleiben unsichtbar.
- **Fix**: Bridge erstellt den OL-Layer jetzt **selbst** (`_createRootOLLayer`), statt auf das Framework zu warten. `serviceUrl` wird via `TnetLMStore.getCoalesceInfo(sublayerKey)` geholt. `ol.source.ImageArcGISRest` + `ol.layer.Image` werden synchron erstellt und der Map hinzugefügt. `TnetLayerSwitch(rootKey, 'on')` wird nicht mehr aufgerufen.
- **Guardrail**: Nie davon ausgehen, dass das Dojo-Framework einen Root-Dienst-Key kennt — es kennt nur Blatt-Layer-Keys. Für Coalesce-Root-Dienste immer den OL-Layer selbst erstellen.

## 2026-03-06 — Coalesce-Gruppenname zeigt Service-Pfad statt Alias

- **Symptom**: Im Active-Layers-Panel steht `gis_oereb/nw_nutzung...` statt des lesbaren Namens ("Nutzungszonen").
- **Root-Cause**: In `_scanCoalesceNodes` hatte `servicePath` Vorrang über `n.name`: `name: servicePath || n.displayName || n.name || n.id`. Kommentar sagte "DB-Name ist oft generisch" — trifft aber auf die meisten Katalog-Knoten nicht zu.
- **Fix**: Priorität umgekehrt: `n.displayName || n.name || servicePath || n.id`. Generische Namen ("Virtueller Layer") werden mit Prüfung übersprungen.
- **Guardrail**: Katalog-Knoten-Namen (`n.name`, `n.displayName`) haben immer Vorrang vor technischen Pfaden. Nur als Fallback hinter Generik-Check verwenden.

## 2026-03-08 — DB-Pfad: selectAll und legend fehlen auf verschachtelten Gruppen

- **Symptom**: SelectAll-Checkbox und Legenden-Button auf verschachtelten Gruppen (z.B. "Nw Nutzungsplanung Def") nicht sichtbar — obwohl in lyrmgr.conf `selectAll: true` und `legend` korrekt gesetzt sind.
- **Root-Cause (1/2)**: SQL-Query im DB-Pfad (`buildCatalogTree`) selektierte weder `cn.select_all` noch `cn.legend` aus `catalog_node`. Die Spalten existierten in der DB und wurden vom Importer geschrieben, aber die Query ignorierte sie.
- **Root-Cause (2/2)**: Die Daten fehlten initial in der DB auch wegen fehlendem Katalog-Resync (`admin.php?action=configtopg&scope=catalog`) nach dem Hinzufügen der Spalten.
- **Fix**: `cn.select_all` und `cn.legend AS node_legend` zur SQL hinzugefügt. In der Node-Verarbeitung: `$node['selectAll'] = true` wenn `select_all` gesetzt, `$node['legend']` aus `node_legend`. Anschliessend Katalog-Resync ausgeführt.
- **Guardrail**: Wenn neue Spalten zu `catalog_node` hinzugefügt werden → IMMER auch die SQL-Query in layers.php UND die Node-Verarbeitung in `buildCatalogTree` anpassen. Nach Schema-Änderung: Katalog-Resync via `admin.php?action=configtopg&scope=catalog` triggern.

## 2026-03-08 — DB-Pfad: Leaf-Layer ohne legend/legendLayers

- **Symptom**: Legenden-Button (🗺) fehlt auf Blatt-Layern im neuen Tree, obwohl der File-basierte API-Pfad `legend`/`legendLayers` korrekt liefert.
- **Root-Cause**: Der DB-Pfad lieferte nur `legendTitle`/`legendLink` (volle URL), aber der JS-Renderer erwartet `legend` (Service-Pfad) und `legendLayers` (Layer-Index). Die Konvertierung via `extractLegendInfo()` fehlte im DB-Pfad.
- **Fix**: `ld.url`, `ld.layer_type`, `ld.params` werden jetzt IMMER selektiert (nicht nur bei `details=true`). Für Leaf-Layer wird ein Mini-Def-Array gebaut und `extractLegendInfo()` aufgerufen — identisch zum File-Pfad. LEFT JOIN auf `layer_definition` ist jetzt immer aktiv.
- **Guardrail**: Beide API-Pfade (File + DB) MÜSSEN identische Felder auf den Leaf-Layern liefern. `extractLegendInfo()` ist die einzige Quelle für `legend`/`legendLayers` — immer diese Funktion verwenden.

## 2026-03-08 — Toggle nach Breadcrumb-Navigation funktioniert nicht

- **Symptom**: Nach Breadcrumb-Navigation zu einem Layer (z.B. "Grundnutzung") lassen sich übergeordnete Gruppen nicht mehr schliessen.
- **Root-Cause**: Toggle-Handler nutzte `closest('[data-group-id]')` für die Gruppen-Suche — das matchte auf jeden Elternknoten mit `data-group-id`, potenziell auch auf den falschen. Zustandserkennung via `!contains('lm-collapsed')` konnte bei fehlender Klasse (weder expanded noch collapsed) inkorrekt sein. `classList.toggle(name, force)` hatte Browser-Quirks.
- **Fix**: Selektor geändert auf `closest('.lm-subcat, .lm-group, .lm-nested-group')` (explizite Klassen). Explizites `classList.add/remove` statt `toggle(name, force)`. `e.preventDefault()` ergänzt. Debug-Logging via TnetLog.
- **Guardrail**: CSS-Klassen-Toggle immer explicit add+remove verwenden, nie `classList.toggle(name, boolForce)`. Group-Suche immer via CSS-Klasse (`.lm-subcat` etc.), nicht via Daten-Attribut.

## 2026-03-08 — Gruppen-Legend: Case-Mismatch ArcGIS-Servicename vs. Config
- **Symptom**: Klick auf Legenden-Button einer Gruppe zeigt "ArcGIS Legend-Fehler: Could not find service". Leaf-Layer-Legenden funktionieren.
- **Root-Cause**: lyrmgr.conf und DB-Spalte `catalog_node.legend` enthalten den Service-Pfad in Kleinbuchstaben (z.B. `gis_oereb/nw_nutzungsplanung_def`), aber der ArcGIS-Dienst heisst `nw_nutzungsplanung_DEF` (Grossbuchstaben). ArcGIS REST ist case-sensitive. Leaf-Layer haben den korrekten Case aus `extractLegendInfo()` (direkt aus der URL), Gruppen-Legend kommt aber aus der Config.
- **Fix**: `_propagateLegends()` im Store ergänzt: Nach der Vererbung an Kinder, wird `_findCorrectLegendCase()` aufgerufen. Diese Funktion sucht rekursiv in Kind-Knoten nach einem `legend`-Wert der case-insensitiv übereinstimmt aber korrekt gecastet ist (aus extractLegendInfo). Gruppen-Legend wird dann auf den korrekten Case aktualisiert.
- **Guardrail**: ArcGIS REST ist case-sensitive. Service-Pfade aus Config nie direkt verwenden — immer gegen die aus der URL extrahierten Pfade (extractLegendInfo) abgleichen.

## 2025-07-27 — Icon-Zentralisierung: Inline-SVGs in externe Dateien + TnetIcons Modul
- **Symptom**: ~45 inline SVGs verstreut über 10+ JS-Dateien. Gleiche Icons (dock, undock, close) mehrfach dupliziert. Wartung und Konsistenz schwierig.
- **Root-Cause**: Historisch gewachsen — jedes Modul definierte eigene SVG-Strings inline.
- **Fix**: 22 SVG-Dateien unter `/maps/tnet/resources/icons/` erstellt. Neues `tnet-icons.js` Modul mit `window.TnetIcons` (fetch-basierter Loader mit Cache). `TnetIcons.loadAll()` im HTML-Head aufgerufen, alle Module nutzen `TnetIcons.get('name')`. CSS data-URIs beibehalten (currentColor funktioniert nicht in externen SVGs via url()). Search-Fallback-SVGs beibehalten (eigener Loader).
- **Guardrail**: Neue Icons immer als .svg in `/resources/icons/` ablegen und in `TnetIcons.ALL` registrieren. Für CSS-Hintergrundbilder weiterhin data-URIs verwenden.

## 2026-03-08 — SelectAll-Checkbox: Gruppen-Layer nicht robust eingeschaltet
- **Symptom**: Gruppen-Checkbox (selectAll) anhaken → nicht alle Kind-Layer werden eingeschaltet. Intermittent.
- **Root-Cause**: `setLayerVisible` hat Guard `if (layer.visible === visible) return;`. Wenn Store durch `_syncFromMap` bereits `visible: true` hat, aber UI-Checkbox noch unchecked (Tab war nicht gerendert bei Sync), werden Layer übersprungen → kein Event → Checkbox bleibt unchecked. Zusätzlich: Standard-Layer (TnetLayerSwitch/switchLayersProgr) vertragen keine 9+ Aufrufe in enger Schleife.
- **Fix**: `setGroupAllVisible` komplett überarbeitet: (1) Guard umgehen — `visible`-State vor Aufruf auf Gegenteil setzen falls nötig, (2) Coalesce-Layer synchron (Debounce bündelt), Standard-Layer gestaffelt (50ms Abstand), (3) Fehler pro Layer abfangen, Event trotzdem emittieren, (4) Fallback-Sync `_syncGroupCheckboxes` nach 800ms prüft DOM vs. Store.
- **Guardrail**: Bei Batch-Operationen nie den `layer.visible === visible` Guard verlassen. Immer force-through für Gruppen-Aktionen.

## 2026-03-08 — SelectAll: "Jedes zweite Mal" Race Condition
- **Symptom**: SelectAll-Checkbox für Gruppen-Layer (ÖREB, SLB) funktioniert nur jedes zweite Mal (nicht deterministisch, timing-abhängig).
- **Root-Cause**: Bridge's `_syncDojoCheckbox()` in `registerSublayer`/`unregisterSublayer` setzt Dojo-Checkboxen → Dojo-Framework reagiert async mit `switchLayersProgr` → erstellt individuelle Ghost-OL-Layer → Ghost-Schutz muss diese asynchron entfernen. Race Condition zwischen `_suppressMapSync` (200ms Reset), Dojo-Async und Ghost-Schutz (50ms Deferred) → je nach Browser-Timing funktioniert es oder nicht.
- **Fix**: Batch-Modus (`beginBatch`/`endBatch`) in der CoalesceBridge. Store's `setGroupAllVisible` aktiviert Batch vor Coalesce-Verarbeitung. Im Batch-Modus wird `_syncDojoCheckbox` komplett unterdrückt → keine Dojo-Seiteneffekte → keine Ghost-Layer → kein Timing-Problem. URL-Sync wird einmal am Ende ausgelöst. Fallback-Sync-Timeout auf 1200ms erhöht.
- **Guardrail**: `_syncDojoCheckbox` NIE in Batch-Operationen aufrufen. Dojo-Checkbox-Sync nur für einzelne Layer-Toggles, nie für Massen-Aktivierung.

## 2026-03-xx — Proxy-SSO: autoLogin: false wird ignoriert trotz korrekter JS-Logik
- **Symptom**: Auto-Login startet weiterhin obwohl `autoLogin: false` in `tnet-global-config.json5` gesetzt ist und JS-Logik korrekt `=== true` prüft.
- **Root-Cause**: PHP-Default-Array hatte `'autoLogin' => true`. Wenn JSON5-Parse fehlschlägt (oder bis der Parse-Status unbekannt war), blieb der Fallback `true` → PHP injizierte `window.__TNET_PROXY_AUTO_LOGIN = true` trotz Config-Einstellung.
- **Fix**: PHP-Default auf `'autoLogin' => false` geändert (sicherer Fallback). Zusätzlich `window.__TNET_PROXY_CONFIG_STATUS` als JS-Variable injiziert (`'ok'`, `'default'` oder `'parse-failed:...'`) damit der Parse-Zustand im iframe-Kontext der Browser-Konsole sichtbar ist.
- **Guardrail**: PHP-Defaults für Sicherheits-/Verhaltensflags immer auf den restriktiveren Wert setzen (`false`). Parse-Fehler nie stillschweigend durch `true`-Fallbacks maskieren.

---

### Duplikat-Layer in OL-Map nicht synchron geschaltet (2026-04-10)

- **Symptom**: Layer ausschalten → noch sichtbar (reduzierte Deckkraft), weil nur eine von mehreren OL-Layer-Instanzen geschaltet wurde. Layer erscheint mehrfach in URL (`layers=id|id|id`).
- **Root-Cause**: `_findOLLayer` findet nur den **ersten** OL-Layer mit dem Namen. Wenn das Framework denselben Layer aus mehreren lyrmgr-Blöcken erstellt, existieren Duplikate in der Karte. Jeder `switchLayersProgr`-Aufruf erstellt einen eigenen OL-Layer.
- **Fix**: (1) `_findAllOLLayers()` + Sync in `toggleLayerEye`/`setLayerVisible`/`setLayerOpacity`. (2) **Duplikat-Schutz im `add`-Handler** — zweiter OL-Layer mit gleicher ID wird sofort entfernt. (3) **`_syncFromMap` Duplikat-Erkennung** — beim Init nur ersten OL-Layer behalten. (4) **`_dedupUrlLayers()`** — bereinigt `layers=` und `op=` in der URL nach Duplikat-Entfernung + beim Init nach 2s.
- **Guardrail**: Duplikat-Schutz greift automatisch im `add`-Handler. URL wird automatisch bereinigt.

---

### Name vs. Alias Konzept-Bereinigung (2026-04-10)

- **Symptom**: Kategorie/Gruppen-Namen (gelb markiert) werden nach Publish nicht auf dem Server übernommen.
- **Root-Cause**: `publishLyrmgr()` schreibt nur die lyrmgr.conf (Struktur mit Keys, keine Namen). Das `name`-Feld im Properties-Dialog war ein Hybrid — weder Key noch NLS-Alias. NLS-Edits wurden nicht automatisch mit-deployt.
- **Fix**: Properties-Dialog: `name` → `_alias` (NLS) analog zur Layer-Alias-Logik. Save-Handler: `_alias` registriert NLS-Edit. Publish: nach erfolgreichem Conf-Deploy werden pending NLS-Edits automatisch mit-deployt via `_deployAllGroups()`. Inline `.cname` schreibt NLS statt `cat.name`.
- **Guardrail**: Cat/Group haben nur Key (Struktur) + Alias (NLS). `ref.name` bleibt nur als interner Fallback.

---

### Kontextmenü im Treebuilder (2025-06-20)

- **Symptom**: `+ Subkategorie`-Button war zu limitiert — kein Einfügen vor/nach Knoten, keine Untergruppen, keine Properties-Bearbeitung
- **Root-Cause**: Bestehende Buttons konnten nur ans Ende der letzten Kategorie hinzufügen, keine positionsgenaue Einfügung
- **Fix**: Rechtsklick-Kontextmenü auf allen Baum-Knoten (Kat/Sub/Untergruppe/Item) mit Insert before/after, Properties-Dialog (legend, selectAll, drawtype, icon, open etc.), Löschen, In-Zwischenablage-Kopieren. `getItemByPath()` navigiert über verschachtelte Item-Arrays per Pfad-Array. Properties-Dialog mit dynamischem Formular je Knotentyp.
- **Guardrail**: Kontextmenü-Handler via Event-Delegation auf `#tb-tree-body`, `.closest()` von innen nach aussen prüfen (Item → Subgrp → Sub → Cat → Lyrmgr).

---

### Resize-Handle funktioniert nicht — keepPanesOpen ohne Guard (2026-03-22)

- **Symptom**: Accordion-Resize-Handle nicht bedienbar, Drag bewirkt nichts
- **Root-Cause**: `keepPanesOpen()` MutationObserver in `tnet_toc.js` beobachtet `#kantons_container` inkl. `style`-Attribut, hat aber **keinen `__tnetResizing`-Guard**. `restoreActiveTab()` ebenso nicht. → Während Drag setzt `applyHeight()` Inline-Styles → Observer feuert → setzt `height: auto` → Resize sofort rückgängig gemacht.
- **Fix**: `if (window.__tnetResizing) return;` in `keepPanesOpen` MutationObserver-Callback und am Anfang von `restoreActiveTab()` eingefügt.
- **Guardrail**: **Jeder** MutationObserver der Inline-Styles auf Sidepanel-Elemente setzt, muss das `__tnetResizing`-Flag prüfen.

### Grosses Refactoring: Subkategorien → Gruppenlayer (2025-01-XX)
- **Symptom**: Subkategorien waren nicht verschachtbar, umständlich, nicht 1:1 kompatibel mit lyrmgr.conf Layergruppen
- **Root-Cause**: Internes Datenmodell `categories[].subcategories[].items[]` erzwang flache 1-Ebene-Hierarchie
- **Fix**: Komplettes Refactoring auf `categories[].items[]` (rekursiv verschachtbar). Betroffene Bereiche:
  - Core-Modell: `convertLyrmgrStructure`, `generateLyrmgrConfBlock`, `collectAllStagingIds`, `deriveGroupsFromLyrmgrs`
  - Rendering: Neues `renderTreeItem()` mit path-basierter Adressierung
  - CSS: `.tb-tree-sub*` / `.tb-tree-subgrp*` → `.tb-tree-group*`
  - D&D: Vereinheitlicht auf `.tb-tree-item, .tb-tree-group` Selektoren
  - Kontextmenü: `showSubCtxMenu` + `showSubgrpCtxMenu` → `showGroupCtxMenu`
  - Properties-Dialog: `type === 'sub'` + `'subgrp'` → `type === 'group'`
  - Clipboard: Gesamte Zwischenablage auf `cat.items[]` umgestellt
  - Preview-Click-Handler: Alle `data-clip-sub` / `data-sub-idx` entfernt
  - Export-Preview: `buildExportPreviewHtml` direkt auf `cat.items` lesen
  - Legacy-Import `importFromAPI`: Erzeugt jetzt Gruppenlayer-Objekte statt subcategories
- **Guardrail**: `getItemByPath()` für Lese-Zugriff, `getItemRefByPath()` für Mutations-Zugriff (liefert `{parent, index, item}`). Nie direkt `subcategories` indexieren.

## 2026-03-17 — legend-proxy.php: Überzählige `}` nach JSON-MISS-Pfad → HTTP 500

- **Symptom**: Nach Performance-Refactoring (gzip/ETag/sendCachedFile) liefert legend-proxy.php HTTP 500 — Body leer, kein PHP-Fehlertext sichtbar.
- **Root-Cause**: Beim Ersetzen des JSON-MISS-Ausgabepfads (`jsonResponse()` → `sendCachedFile()`) blieb eine überzählige `}` stehen, die den ursprünglichen `if/else`-Block geschlossen hatte. PHP-Syntaxfehler → 500 mit leerem Body.
- **Fix**: Überflüssige `}` direkt nach `sendCachedFile($cacheFile, 'application/json', ...)` entfernt.
- **Guardrail**: Nach jedem PHP-Strukturrefactoring lokal `php -l datei.php` ausführen. Leerer 500-Body = PHP-Syntaxfehler (nicht Runtime). Auf ungematchte Klammern unterhalb von `exit`-Aufrufen achten.

## 2026-03-19 — replace_string_in_file bei grossen Dateien wirkungslos

- **Symptom**: `replace_string_in_file` meldet Erfolg für tree-builder.html (~296KB), aber die Datei auf Disk bleibt unverändert (mehrfach reproduziert).
- **Root-Cause**: Bei sehr grossen Dateien (>250KB) schlägt die interne Persistierung fehl, obwohl das Tool Erfolg meldet.
- **Fix**: Python-Script (`_temp_patch_treebuilder.py`) mit `str.replace()` und `open(..., 'w')` verwenden.
- **Guardrail**: Bei grossen Dateien (>100KB) nach jeder Änderung via Terminal/Python verifizieren, ob die Änderung tatsächlich geschrieben wurde. PowerShell-String-Ersetzungen mit `\n` vs `\r\n` (CRLF) sorgfältig prüfen — `IndexOf` mit LF-only findet auf Windows-Dateien den falschen Offset.

## 2026-03-19 — PowerShell Here-String + CRLF → Datei-Korruption

- **Symptom**: PowerShell-basierte String-Ersetzung mit Here-Strings (`@"..."@`) und `\`n` (LF) als Marker korruptiert die Datei durch falschen Splice-Offset.
- **Root-Cause**: Windows-Dateien verwenden CRLF (`\r\n`). PowerShell-`\`n` ist nur LF. `IndexOf` auf CRLF-Inhalt mit LF-Marker gibt -1 oder falschen Offset → `Substring()` schneidet an falscher Stelle.
- **Fix**: Python-Script mit expliziter Encoding-Kontrolle (`newline=''`) verwenden. Keine PowerShell-Here-Strings für Dateimanipulation grosser Dateien.
- **Guardrail**: Grosse HTML-Dateien immer mit Python manipulieren, nie mit PowerShell-String-Operationen.

## 2026-03-30 — Adresssuche: kein Pan/Highlight nach Klick auf Suchresultat

- **Symptom**: Desktop- und Mobile-Suche findet Adressen, aber Klick auf ein Resultat zeigt weder Highlight noch Pan/Zoom.
- **Root-Cause**: swisstopo Geocoder liefert für Adressen `featureId` + `layerId = ch.swisstopo.amtliches-gebaeudeadressverzeichnis`. Dieser Layer ist im MapServer REST-API **nicht vorhanden** (HTTP 404). `highlightFeature()` brach bei non-200 Status ab, ohne Fallback auf `panToResult()`.
- **Fix**: `highlightFeature()` mit `fallbackPan()`-Funktion ergänzt: bei XHR-Fehler (404, Timeout, Parse-Error) wird `panToResult()` mit Punkt-Marker aufgerufen. Neue Hilfsfunktion `addPointMarker()` platziert roten Kreis auf Highlight-Layer. Fix in Desktop (`tnet-search.js`) und Mobile (`tnet-search-m.js`).
- **Guardrail**: Bei XHR-basierten Highlight-Funktionen IMMER einen Fallback auf Koordinaten-Pan einbauen. Externe APIs (swisstopo MapServer) können jederzeit Layer entfernen oder umbenennen.

## 2026-03-30 — Druckvorschau: SVG-Preview füllt Rahmen nicht aus

- **Symptom**: Druckrahmen auf der Karte zeigt zwei sichtbare Rechtecke — äusseres Papier und innere MAP_AREA. SVG-Vorschau ragt über den Frame hinaus.
- **Root-Cause**: `_frameEl` wurde auf MAP_AREA-Grösse dimensioniert, die SVG-Vorschau (gesamtes Papier) war grösser und ragte über den Frame hinaus. Box-Shadow dimmte ab MAP_AREA-Kante, SVG-weisse Ränder lagen darüber → zwei sichtbare Grenzen.
- **Fix**: `updateFrameSize()` setzt Frame auf Papiergrösse. SVG füllt Frame bei (0,0). Overlay-Offset per `setOffset()` verschiebt Element, damit MAP_AREA-Zentrum auf `_printCenter` bleibt. `transformOrigin` auf MAP_AREA-Zentrum für korrekte Rotation. Mittelpunkt-Marker analog repositioniert.
- **Guardrail**: Bei WYSIWYG-Print-Vorschauen den äusseren Rahmen immer auf Papiergrösse setzen, nicht auf den inneren Druckbereich. Das SVG-Layout muss den gesamten Rahmen ausfüllen.

## 2026-04-08 — URL-Bookmark Crash: infoFloatWinRemoveallItems is not a function

- **Symptom**: Beim Laden eines URL-Bookmarks (z.B. `/maps/nw_oereb`) stürzt `setMapBookmark()` mit TypeError ab: `am.infoFloatWinRemoveallItems is not a function`. Keine Layer werden geladen.
- **Root-Cause**: `setMapBookmark()` ruft intern `this.infoFloatWinRemoveallItems()` auf. Diese Funktion existiert erst nach dem Laden des FloatingPane-Moduls (`dojox/layout/FloatingPane`), das bei URL-Bookmarks noch nicht geladen ist.
- **Fix**: Vor jedem `setMapBookmark()`-Aufruf prüfen und No-Op-Stub setzen: `if (typeof am.infoFloatWinRemoveallItems !== 'function') { am.infoFloatWinRemoveallItems = function() {}; }`. Eingefügt in `tnet-mapplus-helpers.js` (`_applyBookmark`) und `tnet-header.js` (`installSetMapBookmarkHook`).
- **Guardrail**: Framework-Methoden, die von FloatingPane abhängen, können beim frühen Aufruf fehlen. Vor Verwendung immer auf Existenz prüfen und ggf. stubben.

## 2026-04-08 — Duplikat-Layer: Rendering bricht ab nach erstem Duplikat

- **Symptom**: Layer-Manager rendert keine weiteren Kategorien/Layer mehr nach dem ersten Duplikat-Layer. Konsole: `Tried to register widget with id==capricorn but that id is already registered`.
- **Root-Cause**: `ClassicLayerMgr._buildContentLayers` erstellt `dijit.form.CheckBox` mit `layer.name` als Widget-ID. Bei Duplikaten im Katalog (gleiche Layer-ID in mehreren Kategorien oder doppelt im selben Array) wirft `dijit.registry.add()` einen Error, der das gesamte Rendering abbricht.
- **Fix v1 (falsch)**: Layer aus `arLayers` filtern → kein Error, aber Rendering stoppt trotzdem still (Framework-interne DeferredList-Kette bricht ab). **Fix v2 (korrekt)**: `dijit.registry.add` patchen — bei Duplikat altes Widget aus Registry entfernen (`dijit.registry.remove(id)`), neues registrieren. DOM des alten Widgets bleibt intakt. Alle Duplikat-Checkboxen rendern korrekt.
- **Guardrail**: Dojo-Widget-ID-Konflikte NICHT durch Überspringen lösen — das bricht den Rendering-Flow. Stattdessen `dijit.registry.add` tolerant patchen.

## 2026-04-10 — NLS-Alias Deploy: Änderungen gehen nach Refresh verloren

- **Symptom**: Im Tree-Builder geänderte Aliase (Layer/Kategorie) werden deployed (OK), verschwinden aber nach Seiten-Refresh wieder.
- **Root-Cause**: `stage-nls-conf` scannte nur EIN NLS-Verzeichnis (basierend auf `$source`-Parameter = Layer-Quelle). Kategorie-Keys wie `desc_Guguseli_Gugus` lagen aber in der Override-Datei (`/www/maps/core/nls/de/lyrmgrResources.json`), nicht in core. PHP fand den Key nicht → Fallback schrieb an falschen Pfad. Override-Datei behielt alten Wert und gewann bei `array_merge`.
- **Fix**: `stage-nls-conf` scannt jetzt ALLE NLS-Verzeichnisse (core + override + profile). Für jeden Key wird die höchstpriorisierte Datei aktualisiert (Override > Core). Profil-Fallback nutzt `getProfileNlsPath()` statt `CONFIG_BASE`.
- **Guardrail**: NLS-Keys können in verschiedenen Prioritätsstufen liegen (core < override < profile). Bei NLS-Operationen immer ALLE Stufen durchsuchen, nie nur eine basierend auf Layer-Quelle.

## 2026-04-22 — Admin-Login trotz Whitelist-IP

- **Symptom**: Aufrufe wie `admin-login.php?redirect=/maps/tnet/api/v1/slm.html` verlangten weiterhin Login, obwohl die Client-IP in der Zugriffsschutz-Whitelist stand.
- **Root-Cause**: Apache-Whitelist (`TNET_ADMIN`) und PHP-Cookie-Auth waren getrennt. `AdminAuth::isAuthenticated()` akzeptierte nur Cookie und ignorierte die gepflegte IP-Whitelist (`access-config.json`).
- **Fix**: Kein globaler Bypass. Stattdessen neuer Endpoint-Modus **„Geschützt + IP-Freigabe“** (pro HTML/PHP konfigurierbar). `AdminAuth::enforceEndpointPolicy()` wertet die Endpoint-Konfiguration aus und erlaubt Whitelist-IP nur in diesem Modus. Zusätzlich robuste Client-IP-Normalisierung für `IPv4:port` und `[IPv6]:port`.
- **Guardrail**: IP-Freigabe nie global auf Auth schalten. Immer pro Endpoint als expliziter Modus führen, damit sensible Endpunkte (z.B. Security-UI) rein Cookie-geschützt bleiben.
## 2026-04-23 — Bookmark: 19 "fehlende" Layer waren ArcGIS-Sublayer-Indizes
- **Symptom**: Beim Laden eines Bookmarks listet das Log 26 Layer (7 Parents + 19 Kinder). Die 7 Parents werden aktiviert, die 19 Kinder nicht — der Catch-up meldet sie wiederholt als `fehlend`. Visuell ist die Karte aber komplett korrekt.
- **Root-Cause**: Bookmark-JSON enthält pro Parent-Layer noch die IDs aller `linked_layer`-Kinder (Legende-Einträge). Diese Kinder sind aber **keine eigenständigen OL-Layer**, sondern Sublayer-Indizes `show:2,3,4,5,...` im `LAYERS`-Param des Parent-MapServers (`gis_fach/.../MapServer`). Der Server rendert sie automatisch mit. `getLayerById()` im LyrMgr findet sie daher nie und `switchLayersProgr()` läuft ins Leere.
- **Fix**: Catch-up-Polling in `tnet-header.js` und `tnet-app.js` wieder entfernt. Der `setMapBookmark`-Hook loggt die Layer nur noch. Das Bookmark funktioniert ohne Nachzug, weil der Parent die Sublayer automatisch rendert.
- **Guardrail**: Bevor Retry-/Catch-up-Logik für Layer eingebaut wird, erst prüfen ob die Layer-IDs als eigenständige OL-Layer existieren (via `map.getLayers()`) oder nur als Sublayer-Indizes in einem Parent-MapServer konfiguriert sind. Bei ArcGIS-Diensten sind Legenden-Einträge oft keine aktivierbaren Layer.

## 2026-04-24 — Bookmark-Layer nicht immer vollständig aktiv trotz erfolgreichem Bookmark-Load
- **Symptom**: Einzelne Bookmark-Aufrufe (z.B. `nw_agglomeration`) laden die Karte, aber die erwarteten Layer sind nicht immer vollständig sichtbar.
- **Root-Cause**: Die Bookmark-API liefert gemischte Layer-Listen (Parent + tiefe Child-Pfade). Diese Mischung ist für `setMapBookmark` timing-sensitiv und kann bei der Framework-Race-Condition zu inkonsistenter Layer-Aktivierung führen.
- **Fix**: In `tnet-mapplus-helpers.js` werden Bookmark-Layer vor dem Anwenden nur bereinigt (trim + dedupe), aber vollständig beibehalten. Zusätzlich läuft ein verstärkter Retry-Ensure (500/1500/3000/5000/8000ms) über `TnetLayerSwitch(..., 'on')` auf der kompletten Bookmark-Liste.
- **Guardrail**: Bei Bookmark-Layern keine Child-IDs pauschal entfernen. Nur Duplikate bereinigen und die Robustheit über zeitlich gestaffelte Retries herstellen.

## 2026-04-24 — Kartenwechsel per Bookmark stapelt alte Fachlayer statt sauber zu ersetzen
- **Symptom**: Beim Wechsel von Karte A auf Karte B bleiben Fachlayer von A sichtbar; B-Layer werden nur zusätzlich geladen.
- **Root-Cause**: `setMapBookmark()` wurde direkt aufgerufen, ohne vorher den bestehenden Fachlayer-Stack explizit zu leeren. In bestimmten Timing-Fällen führt das zu additivem Verhalten.
- **Fix**: In `_applyBookmark()` (tnet-mapplus-helpers.js) vor `setMapBookmark()` ein Pre-Clear eingebaut: zuerst aktive Layer via `TnetLMStore` deaktivieren (`setLayerVisible(false)`), danach Fallback über sichtbare Kartenlayer (`TnetLayerSwitch(name,'off')` für Fachlayer-Heuristik).
- **Guardrail**: Bei Bookmark-basiertem Kartenwechsel immer zuerst den thematischen Layer-Stack leeren, dann den neuen Bookmark anwenden.

## 2026-04-24 — Regression: Kartenwechsel blockiert durch Race zwischen Pre-Clear und alten Ensure-Retries
- **Symptom**: Nach dem Pre-Clear-Fix funktionierte der Kartenwechsel teilweise nicht mehr bzw. verhielt sich inkonsistent.
- **Root-Cause**: Alte `TnetSetBookmark`-Retry-Timer (`Layer-Ensure`) liefen weiter und griffen in den nächsten Kartenwechsel ein. Gleichzeitig war das per-Layer-Clear timing-anfällig.
- **Fix**: Vor jedem neuen Bookmark werden alle alten Ensure-Timer gecancelt und per Token invalidiert. Pre-Clear: `TnetLMStore.removeAllLayers()` (primär), Fallback über direkte Layer-Deaktivierung (`TnetLayerSwitch(...,'off')`/`setVisible(false)`) statt Framework-Bookmark-Clear.
- **Guardrail**: Bei gestaffelten Retry-Strategien immer Cancel/Token-Mechanismus pro neuer Aktion einbauen. Für Clear-Operationen **kein** `setMapBookmark('layers=')` als Fallback verwenden, da das erneut Bookmark-Hooks auslöst.

## 2026-04-24 — Falscher MapBookmark-Name im Log + Kartenauswahl-Dialog bleibt offen
- **Symptom**: In der Konsole wird weiterhin ein alter/anderer Bookmark-Name geloggt (z.B. `nw_agglomeration`), obwohl eine andere Karte geladen wurde. Zudem schliesst `mapsInfoDialog` nach dem Wechsel nicht zuverlässig.
- **Root-Cause**: Der Hook leitete den Namen primär aus `window.location.pathname` ab (statisch für die aktuelle URL), nicht aus der tatsächlich angeforderten Bookmark-ID. Das Dialog-Schliessen hing zusätzlich von einem engen Pfad (`dialog.open && window.closeMapsInfoDialog`) ab.
- **Fix**: `TnetSetBookmark()` schreibt die zuletzt angeforderte ID in `window.__tnetLastRequestedBookmark` (inkl. top-window). Der Hook loggt bevorzugt diese ID. Dialog-Close wurde robust gemacht: Close-Versuch über lokale und top-window Funktion plus dijit-Fallback, inkl. kurzem Follow-up-Delay.
- **Guardrail**: Für Aktions-Logging niemals nur auf URL-Pfade vertrauen; immer die echte Request-ID mitschreiben. Dialog-Schliessen in eingebetteten/Dojo-Kontexten immer über mehrere Fallback-Pfade absichern.

## 2026-04-24 — Dialog bleibt offen + Bookmark lädt nicht bei API-/Timing-Fehler
- **Symptom**: Kartenauswahl-Dialog bleibt offen und der gewählte Bookmark wird nicht geladen.
- **Root-Cause**: `TnetSetBookmark()` war vollständig vom API-Pfad abhängig; bei Fehlern blieb nur `{success:false}` übrig. Das Dialog-Schliessen passierte zu spät und war an nachgelagerte Pfade gekoppelt.
- **Fix**: In `TnetSetBookmark()` wird der Dialog sofort geschlossen (lokal + top). Bei API-Fehlern wird ein direkter Framework-Fallback ausgeführt: `setMapBookmark(['main'], 'map=<bookmarkId>')`. Im Hook wird Name-Logging priorisiert aus `params.map` statt aus potenziell stale request-state.
- **Guardrail**: Bei Bookmark-Wechsel immer einen Framework-Fallback auf `map=<id>` vorsehen. Logging-Reihenfolge: `params.map` > request-state > URL-Pfad.

## 2026-04-24 — Sofortiges Dialog-Close hat Bookmark-Load aus dem Iframe abgewürgt
- **Symptom**: Der Kartenauswahl-Dialog schliesst, aber der Bookmark wird gar nicht geladen.
- **Root-Cause**: `TnetSetBookmark()` wurde aus dem `mapsInfoFrame`-Iframe aufgerufen. Das frühe Schliessen des Dialogs entfernt `src` am Iframe und entlädt damit genau den Kontext, in dem der Fetch/Promise noch lief.
- **Fix**: `TnetSetBookmark()` delegiert bei Iframe-Aufruf sofort an `window.top.TnetSetBookmark(bookmarkId)`. Die eigentliche Bookmark-Logik läuft dadurch im Top-Window und überlebt das anschliessende Dialog-Close.
- **Guardrail**: Aktionen aus modalen Iframes, die asynchron weiterlaufen, immer ins Top-Window delegieren bevor das Iframe geschlossen oder neu geladen wird.

## 2026-06-11 — Bookmark-Calls folgten noch der Seiten-URL statt dem Store
- **Symptom**: Bookmarks und Lock/Unlock liefen je nach Seitenpfad noch gegen die falsche Umgebung oder lieferten Store-Mismatches.
- **Root-Cause**: Mehrere Bookmark-Fetches nutzten noch relative `treebuilder-api.php`-URLs statt der bereits vorhandenen store-aware `API_URL`.
- **Fix**: Alle Bookmark-Calls in `slm.html` auf `API_URL` umgestellt, damit Bookmarks denselben Store verwenden wie der Rest der SLM.
- **Guardrail**: Store-sensitive API-Aufrufe in der SLM nie relativ formulieren, sondern immer ueber die zentrale Store-Basis schicken.

## 2026-06-11 â€” Sync-Tab zeigte nur Detailtabellen, aber keine schnelle Einordnung
- **Symptom**: Der Sync-Tab wirkte erst nach dem Aufklappen der Domains nützlich; der Unterschied zwischen DEV und PROD war auf einen Blick nicht erkennbar.
- **Root-Cause**: `slm.html` rendert zwar Statusdaten fuer Bookmarks, Katalog und Bundles, hatte aber keine verdichtete Zusammenfassung oberhalb der Detailtabellen.
- **Fix**: In `slm.html` wurde eine kompakte Summary mit Karten fuer Bookmarks, Katalog und Bundles ergänzt. Sie zeigt Count-/Diff-Signale direkt im ersten Viewport und laesst die bestehenden Sync-Aktionen unveraendert.
- **Guardrail**: Bei Status-Views zuerst eine knappe Entscheidungsansicht liefern, dann erst die Detailtabellen rendern.

## 2026-06-11 â€” Sync-Auswahl war nicht granular genug
- **Symptom**: Im Sync-Tab war nicht direkt ersichtlich, welche Profile oder Bundles wirklich mitlaufen; die Aktion wirkte zu grob.
- **Root-Cause**: Die Tabellen zeigten nur Revisionen oder Scope, aber keine auswählbaren Einträge mit aktiviertem Sync-Status pro Zeile.
- **Fix**: In `slm.html` wurden Checkboxen pro Profil/Kürzel ergänzt, dazu ein Domain-Toggle und ein Select-All pro Tabelle. Die Tabellen zeigen jetzt zusätzlich Zeitstempel und Benutzer pro Umgebung, damit die Auswahl fachlich nachvollziehbar ist.
- **Guardrail**: Bei Sync-Operationen immer zuerst die auswählbaren Einheiten anzeigen und die Aktion nur auf die markierten Einträge anwenden.

## 2026-06-11 â€” Fullbackup und Restore fehlten im Sync-Tab
- **Symptom**: Der Sync-Tab hatte zwar Sync-Aktionen, aber keinen klaren Weg für einen vollständigen State-Backup mit anschliessendem Restore.
- **Root-Cause**: Der vorhandene State-Backup-Flow war nur über die Backup-Verwaltung erreichbar und nicht direkt im Sync-Workflow verdrahtet.
- **Fix**: In `slm.html` wurde eine Fullbackup-Leiste mit `Fullbackup erstellen` und `Verwalten & Restore` ergänzt. Auf Serverseite erstellt `create-full-backup` jetzt eine `state_full_*.json`, die im bestehenden Backup-Manager als `state`-Backup wiederhergestellt werden kann.
- **Guardrail**: Wenn Sync-Daten überschrieben werden können, gehört der Fullbackup-/Restore-Pfad sichtbar und direkt neben die Sync-Aktion.
