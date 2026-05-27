#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
patch_paths_ui.py
1. Button "Nach Core exportieren" → dynamisch "Nach core-dev exportieren" auf DEV
2. Staging-Tab: Pfad-Bar (raw-conf → ImportToCore)
3. Config-Editor-Tab: Pfad-Bar (ImportToCore → core-dev/config + nls)
"""

fpath = r"c:\_Daten\mapplus-exp\maps-dev\tnet\api\v1\slm.html"

with open(fpath, "r", encoding="utf-8") as fh:
    c = fh.read()

# ── 1. CSS für Pfad-Bar ──────────────────────────────────────────────────────
CSS = """\r\n/* ===== PFAD-INFO-BAR (Staging / Editor) ===== */\r\n.path-info-bar {\r\n  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;\r\n  padding: 4px 14px; border-bottom: 1px solid #d0dde2;\r\n  font-size: 11px; color: #555; background: #eef3f5;\r\n}\r\n.path-info-bar .pib-lbl { font-family: -apple-system,sans-serif; font-weight: 700; color: #2c4a50; white-space: nowrap; }\r\n.path-info-bar .pib-path { font-family: Consolas,monospace; color: #3a6a6a; }\r\n.path-info-bar .pib-arrow { color: #999; }\r\nhtml[data-env="dev"] .path-info-bar { background: #fff5ed; border-bottom-color: #e8b880; }\r\nhtml[data-env="dev"] .path-info-bar .pib-path { color: #a04a00; }\r\nhtml[data-env="dev"] .path-info-bar .pib-lbl { color: #7a3000; }\r\n"""

if "PFAD-INFO-BAR" not in c:
    idx = c.index("</style>")
    c = c[:idx] + CSS + "</style>" + c[idx + len("</style>"):]
    print("[slm.html] CSS: OK")
else:
    print("[slm.html] CSS: bereits vorhanden")

# ── 2. JS: Button, Tooltip, Pfad-Bars ────────────────────────────────────────
JS = """\r\n<script>\r\n/* ===== PFAD-INFO-BARS + DEV-BUTTON ===== */\r\n(function() {\r\n  var isDev     = location.pathname.indexOf('/maps-dev/') === 0;\r\n  var coreName  = isDev ? 'core-dev' : 'core';\r\n  var rawConf   = isDev ? 'data/tmp/maps-dev/raw-conf'    : 'data/tmp/maps/raw-conf';\r\n  var impCore   = isDev ? 'data/tmp/maps-dev/ImportToCore' : 'data/tmp/maps/ImportToCore';\r\n  var coreCfg   = '/www/' + coreName + '/config/';\r\n  var coreNls   = '/www/' + coreName + '/nls/de/';\r\n\r\n  // Button-Text + Tooltip\r\n  var expBtn = document.getElementById('editor-btn-export');\r\n  if (expBtn) {\r\n    expBtn.title = 'Dateien nach ' + coreName + '/config/ und ' + coreName + '/nls/de/ exportieren';\r\n  }\r\n  var expTitle = document.getElementById('export-confirm-title');\r\n  if (expTitle) expTitle.textContent = '\\u{1F4E4} Nach ' + coreName + ' exportieren';\r\n\r\n  // Hilfsfunktion: Pfad-Bar erstellen\r\n  function makeBar(items) {\r\n    var bar = document.createElement('div');\r\n    bar.className = 'path-info-bar';\r\n    var html = '';\r\n    items.forEach(function(item, i) {\r\n      if (i > 0) html += '<span class="pib-arrow">&rarr;</span>';\r\n      html += '<span class="pib-lbl">' + item[0] + '</span> <span class="pib-path">' + item[1] + '</span>';\r\n    });\r\n    bar.innerHTML = html;\r\n    return bar;\r\n  }\r\n\r\n  // Staging-Tab: raw-conf → ImportToCore\r\n  var paneStaging = document.getElementById('pane-staging');\r\n  if (paneStaging && !paneStaging.querySelector('.path-info-bar')) {\r\n    paneStaging.insertBefore(\r\n      makeBar([['raw-conf', rawConf], ['ImportToCore', impCore]]),\r\n      paneStaging.firstChild\r\n    );\r\n  }\r\n\r\n  // Editor-Tab: ImportToCore → core-dev/config + nls\r\n  var paneEditor = document.getElementById('pane-editor');\r\n  if (paneEditor && !paneEditor.querySelector('.path-info-bar')) {\r\n    paneEditor.insertBefore(\r\n      makeBar([['ImportToCore', impCore], [coreName + '/config', coreCfg], [coreName + '/nls/de', coreNls]]),\r\n      paneEditor.firstChild\r\n    );\r\n  }\r\n})();\r\n</script>\r\n</body>"""

# Ersetze letztes </body>
last_body = c.rfind("</body>")
if last_body >= 0:
    c = c[:last_body] + JS
    print("[slm.html] JS: OK")
else:
    print("[slm.html] </body> nicht gefunden!")

with open(fpath, "w", encoding="utf-8") as fh:
    fh.write(c)

print("[slm.html] gespeichert.")
