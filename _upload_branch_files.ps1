# SFTP Upload Script für Branch-Dateien
$files = @(
    "maps/public/index_de.htm",
    "maps/tnet/css/tnet-components.css",
    "maps/tnet/css/tnet-splitscreen.css",
    "maps/tnet/js/tnet-app.js",
    "maps/tnet/js/tnet-context-menu.js",
    "maps/tnet/js/tnet-header.js",
    "maps/tnet/js/tnet-info-panel.js",
    "maps/tnet/js/tnet-map-footer.js",
    "maps/tnet/js/tnet-oereb.js",
    "maps/tnet/js/tnet-panel-drag-resize.js",
    "maps/tnet/js/tnet-spatial-query.js",
    "maps/tnet/js/tnet-splitscreen.js"
)

$sftpHost = "nwow.mapplus.ch"
$user = "trigonet"
$password = "3Zs,k4%Un,<[W(Kx"
$remotePath = "/www/maps"

Write-Host "Erstelle SFTP Batch-Datei..." -ForegroundColor Cyan

# Erstelle SFTP Batch-Befehle
$batchContent = ""
foreach ($file in $files) {
    $localFile = $file -replace '/', '\'
    $remoteFile = "$remotePath/$($file -replace '\\', '/')"
    $remoteDir = Split-Path $remoteFile -Parent
    
    if (Test-Path $localFile) {
        $batchContent += "put `"$localFile`" `"$remoteFile`"`n"
        Write-Host "  + $file" -ForegroundColor Green
    } else {
        Write-Host "  ! $file (nicht gefunden)" -ForegroundColor Yellow
    }
}
$batchContent += "bye`n"

# Speichere Batch-Datei
$batchFile = "c:\_Daten\mapplus-exp\_sftp_upload.txt"
$batchContent | Out-File -FilePath $batchFile -Encoding ASCII

Write-Host "`nStarte SFTP Upload..." -ForegroundColor Cyan
Write-Host "Host: $sftpHost" -ForegroundColor Gray
Write-Host "User: $user" -ForegroundColor Gray

# SFTP mit Passwort (über expect-ähnliches Verhalten)
$sftpProcess = Start-Process -FilePath "sftp" -ArgumentList "-b", $batchFile, "$user@$sftpHost" -NoNewWindow -Wait -PassThru

if ($sftpProcess.ExitCode -eq 0) {
    Write-Host "`n[OK] Upload erfolgreich abgeschlossen!" -ForegroundColor Green
} else {
    Write-Host "`n[FEHLER] Upload fehlgeschlagen (Exit Code: $($sftpProcess.ExitCode))" -ForegroundColor Red
}

# Cleanup
Remove-Item $batchFile -ErrorAction SilentlyContinue
