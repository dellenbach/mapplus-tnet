# AI Lessons Learned — MAP+ / TNET

> Dokumentation konkreter Fehler und deren Lösungen.
> Wird von der KI nach jedem Bug-Fix ergänzt.
> Format: Symptom → Root-Cause → Fix → Guardrail

---

## 2026-06-xx — Legend-Button fehlt bei ArcGIS REST Layern in "Dargestellte Themen"
- **Symptom**: Planungszonen kantonal/kommunal aktiv → kein Legenden-Icon im "Dargestellte Themen"-Panel.
- **Root-Cause**: Die API läuft im **Database-Modus** (`source: "database"`), nicht File-Modus. Alle `legendLink`/`legendTitle` sind `null` in der DB. Fix-Versuch über `processLayerItems()` (File-Modus) und `legend`-Property-Vererbung griff nicht. Der Click-Handler suchte nach `/rest/services/` im URL-Pattern, aber die Layer nutzen `agsproxy.php?path=`.
- **Fix**: Button-Bedingung in `tnet-lm-active.js` auf `l.layerType === 'arcgisRest' && l.url.indexOf('agsproxy.php') !== -1` geändert. Click-Handler extrahiert Service-Pfad aus `agsproxy.php?path=<pfad>` und konstruiert `legend-proxy.php?service=<pfad>`.
- **Guardrail**: Nie annehmen, dass die API im File-Modus läuft — immer `?debug=1` prüfen für `source`-Feld. ArcGIS-Layer verwenden `agsproxy.php?path=`, nicht `/rest/services/`.

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