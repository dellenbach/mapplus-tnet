param()
# patch_env_badge.ps1
# Robuste DEV/PROD-Anzeige: data-env im <head>, CSS-gesteuert

$base  = "c:\_Daten\mapplus-exp\maps-dev\tnet\api\v1"
$CRLF  = [char]13 + [char]10
$files = @("slm.html", "ags-import.html")

# --- 1. Script-Tag fuer <head> (setzt data-env vor jedem CSS-Rendering) ------
$headScript = '<script>document.documentElement.setAttribute(''data-env'',location.pathname.indexOf(''/maps-dev/'')===0?''dev'':''prod'');</script>'

# --- 2. CSS-Regeln fuer env-badge + Toolbar-Rand ----------------------------
$css = @'

/* ===== ENV-BADGE (DEV / PROD) ===== */
#env-badge { display: none; }
html[data-env] #env-badge {
  display: inline-block !important;
  color: #fff; padding: 2px 10px; border-radius: 3px;
  font-size: 12px; font-weight: 700; letter-spacing: .6px;
  vertical-align: middle;
}
html[data-env="dev"] #env-badge { background: #e67e22; }
html[data-env="dev"] #env-badge::before { content: 'DEV'; }
html[data-env="prod"] #env-badge { background: #2e7d32; }
html[data-env="prod"] #env-badge::before { content: 'PROD'; }
html[data-env="dev"] .ags-toolbar { border-bottom: 3px solid #e67e22; }
'@

foreach ($fn in $files) {
    $f = "$base\$fn"
    $c = [System.IO.File]::ReadAllText($f, [System.Text.Encoding]::UTF8)
    Write-Host ""
    Write-Host "=== $fn ==="

    # A) head-Script VOR <style> einfuegen (nur wenn noch nicht vorhanden)
    if ($c.Contains('data-env')) {
        Write-Host "  [A] data-env-Script bereits vorhanden – ueberspringe"
    } else {
        $c = $c.Replace('<style>', $headScript + $CRLF + '<style>')
        Write-Host "  [A] head-Script eingefuegt: OK"
    }

    # B) CSS-Block nach "/* ===== TOOLBAR ===== */" einfuegen (am Ende des Style-Blocks)
    # Suche das erste </style> und fuge CSS davor ein
    $styleEnd = '</style>'
    $idxStyle = $c.IndexOf($styleEnd)
    if ($idxStyle -ge 0 -and -not $c.Contains('/* ===== ENV-BADGE')) {
        $c = $c.Substring(0, $idxStyle) + $css + $CRLF + $styleEnd + $c.Substring($idxStyle + $styleEnd.Length)
        Write-Host "  [B] CSS eingefuegt: OK"
    } else {
        Write-Host "  [B] CSS bereits vorhanden – ueberspringe"
    }

    # C) Badge-Span: inline style entfernen (CSS uebernimmt), Textinhalt leeren
    $oldBadge = '<span id="env-badge" style="display:none;color:#fff;padding:2px 10px;border-radius:3px;font-size:12px;font-weight:700;letter-spacing:.6px;margin-left:6px;vertical-align:middle"></span>'
    $newBadge = '<span id="env-badge"></span>'
    if ($c.Contains($oldBadge)) {
        $c = $c.Replace($oldBadge, $newBadge)
        Write-Host "  [C] Badge-Span bereinigt: OK"
    } else {
        Write-Host "  [C] Badge-Span (altes Format) nicht gefunden – pruefe ob schon sauber"
        if ($c.Contains($newBadge)) { Write-Host "      -> Bereits sauber" }
    }

    # D) Altes end-of-body IIFE fuer env-badge entfernen
    $oldIife = '<script>' + $CRLF + '(function() {' + $CRLF + '  var isDev = location.pathname.indexOf(''/maps-dev/'') === 0;' + $CRLF + '  var badge = document.getElementById(''env-badge'');'
    $idxIife = $c.IndexOf($oldIife)
    if ($idxIife -ge 0) {
        # Suche Ende dieses script-Blocks
        $endScript = '</script>'
        $idxEnd = $c.IndexOf($endScript, $idxIife)
        if ($idxEnd -ge 0) {
            $removeLen = $idxEnd + $endScript.Length - $idxIife
            $c = $c.Substring(0, $idxIife) + $c.Substring($idxIife + $removeLen)
            Write-Host "  [D] Altes IIFE entfernt: OK"
        }
    } else {
        Write-Host "  [D] Altes IIFE nicht gefunden – bereits entfernt oder andere Form"
        # Versuche breiteren Match
        $altStart = '  var isDev = location.pathname.indexOf(''/maps-dev/'') === 0;'
        if ($c.Contains($altStart)) {
            Write-Host "      Alternatives IIFE gefunden – manuell pruefen"
        }
    }

    [System.IO.File]::WriteAllText($f, $c, [System.Text.Encoding]::UTF8)
    Write-Host "  Gespeichert: $fn"
}

Write-Host ""
Write-Host "Fertig."
