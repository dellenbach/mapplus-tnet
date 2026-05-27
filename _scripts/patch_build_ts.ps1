param()
# patch_build_ts.ps1 — Fuegt Release-Zeitstempel (document.lastModified) in alle API-Seiten ein

$base = "c:\_Daten\mapplus-exp\maps-dev\tnet\api\v1"
$CRLF = [char]13 + [char]10

# ─── JS-Hilfsfunktion (als literal string, kein Interpolieren) ───────────────
$jsFnRaw = @'
function _showBuildTs(id) {
  var el = document.getElementById(id);
  if (!el) return;
  var d = new Date(document.lastModified);
  var z = function(n) { return n < 10 ? '0' + n : String(n); };
  el.textContent = z(d.getDate()) + '.' + z(d.getMonth()+1) + '.' + d.getFullYear() + ' ' + z(d.getHours()) + ':' + z(d.getMinutes());
}
'@

# ─── Hilfsfunktion: </body> ersetzen ─────────────────────────────────────────
function AddBuildTsScript {
    param($content, $spanId)
    $callLine = "_showBuildTs('" + $spanId + "');"
    $block = $CRLF + '<script>' + $CRLF + $jsFnRaw + $callLine + $CRLF + '</script>' + $CRLF + '</body>'
    return $content.Replace('</body>', $block)
}

# ─────────────────────────────────────────────────────────────────────────────
# 1. slm.html
# ─────────────────────────────────────────────────────────────────────────────
$f1 = "$base\slm.html"
$c1 = [System.IO.File]::ReadAllText($f1, [System.Text.Encoding]::UTF8)

$slm_old = '  <a href="../docs/" target="_blank">API Docs</a>' + $CRLF + '</div>'
$slm_span = '  <span id="slm-build-ts" title="Release-Zeitstempel (letzter Deploy)" style="font-size:10px;color:rgba(255,255,255,.55);font-family:monospace;white-space:nowrap"></span>'
$slm_new = '  <a href="../docs/" target="_blank">API Docs</a>' + $CRLF + '  <span class="sep"></span>' + $CRLF + $slm_span + $CRLF + '</div>'

if ($c1.Contains($slm_old)) {
    $c1 = $c1.Replace($slm_old, $slm_new)
    Write-Host "[slm.html] Span: OK"
} else {
    Write-Host "[slm.html] Anker nicht gefunden!"
    exit 1
}
$c1 = AddBuildTsScript $c1 'slm-build-ts'
Write-Host "[slm.html] Script: OK"
[System.IO.File]::WriteAllText($f1, $c1, [System.Text.Encoding]::UTF8)
Write-Host "[slm.html] gespeichert."

# ─────────────────────────────────────────────────────────────────────────────
# 2. ags-import.html
# ─────────────────────────────────────────────────────────────────────────────
$f2 = "$base\ags-import.html"
$c2 = [System.IO.File]::ReadAllText($f2, [System.Text.Encoding]::UTF8)

# Finde letzten Link in der Toolbar
$treeLink = [char]0x2190 + ' Tree-Builder</a>'
$idx2 = $c2.LastIndexOf($treeLink)
Write-Host "[ags-import.html] Tree-Builder-Link idx=$idx2"

if ($idx2 -ge 0) {
    $afterLink = $c2.IndexOf($CRLF + '</div>', $idx2)
    if ($afterLink -ge 0) {
        $ags_old = $CRLF + '</div>'
        $ags_span = '  <span class="sep"></span>' + $CRLF + '  <span id="ags-build-ts" title="Release-Zeitstempel (letzter Deploy)" style="font-size:10px;color:rgba(255,255,255,.55);font-family:monospace;white-space:nowrap"></span>'
        # Nur die erste Toolbar-schliessende </div> ersetzen ab idx2
        $insertPos = $afterLink
        $beforeInsert = $c2.Substring(0, $insertPos)
        $afterInsert = $c2.Substring($insertPos)
        # afterInsert beginnt mit \r\n</div> - wir fuegen den Span davor ein
        $afterInsertNew = $CRLF + $ags_span + $CRLF + '</div>' + $afterInsert.Substring(($CRLF + '</div>').Length)
        $c2 = $beforeInsert + $afterInsertNew
        Write-Host "[ags-import.html] Span: OK"
    } else {
        Write-Host "[ags-import.html] </div> nach Tree-Builder-Link nicht gefunden"
    }
} else {
    Write-Host "[ags-import.html] Tree-Builder-Link nicht gefunden"
}

$c2 = AddBuildTsScript $c2 'ags-build-ts'
Write-Host "[ags-import.html] Script: OK"
[System.IO.File]::WriteAllText($f2, $c2, [System.Text.Encoding]::UTF8)
Write-Host "[ags-import.html] gespeichert."

# ─────────────────────────────────────────────────────────────────────────────
# 3. tree-builder.html
# ─────────────────────────────────────────────────────────────────────────────
$f3 = "$base\tree-builder.html"
$c3 = [System.IO.File]::ReadAllText($f3, [System.Text.Encoding]::UTF8)

# Span nach dem DEV-Badge einfuegen
$devBadge = '          <span id="tb-dev-env-badge" style="display:none;background:#e67e22;color:#fff;padding:1px 8px;border-radius:3px;font-size:11px;font-weight:700;letter-spacing:.5px;margin-left:2px">DEV</span>'
$tbTsSpan = '          <span id="tb-build-ts" title="Release-Zeitstempel (letzter Deploy)" style="font-size:10px;color:rgba(0,0,0,.35);font-family:monospace;white-space:nowrap;margin-left:6px"></span>'

if ($c3.Contains($devBadge)) {
    $c3 = $c3.Replace($devBadge, $devBadge + $CRLF + $tbTsSpan)
    Write-Host "[tree-builder.html] Span: OK"
} else {
    Write-Host "[tree-builder.html] DEV-Badge nicht gefunden!"
    exit 1
}

# JS nach _devBadgeEl-Zeile einfuegen
# Suche nach dem bekannten Satz ohne problematische Zeichen
$devBadgeJs_marker = "if (_devBadgeEl) _devBadgeEl.style.display = ''; }"
$idx3 = $c3.IndexOf($devBadgeJs_marker)
Write-Host "[tree-builder.html] JS-Marker idx=$idx3"
if ($idx3 -ge 0) {
    $endOfLine = $c3.IndexOf($CRLF, $idx3)
    $insertAt = $endOfLine
    $callTs = $CRLF + "_showBuildTs('tb-build-ts');" + $CRLF + $jsFnRaw.TrimEnd()
    # Wir setzen die Funktion direkt nach der Marker-Zeile
    $c3 = $c3.Substring(0, $endOfLine) + $CRLF + $jsFnRaw.TrimEnd() + $CRLF + "_showBuildTs('tb-build-ts');" + $c3.Substring($endOfLine)
    Write-Host "[tree-builder.html] JS: OK"
} else {
    Write-Host "[tree-builder.html] JS-Marker nicht gefunden"
}

[System.IO.File]::WriteAllText($f3, $c3, [System.Text.Encoding]::UTF8)
Write-Host "[tree-builder.html] gespeichert."

Write-Host ""
Write-Host "Fertig. Alle drei Dateien gepatcht."
