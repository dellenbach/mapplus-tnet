#Requires -Version 5.1
<#
.SYNOPSIS
    Erstellt Desktop-Verkuepfungen fuer die haeufigsten Deploy-Operationen.

.DESCRIPTION
    Legt .lnk-Dateien auf dem Desktop an, die die entsprechenden .bat-Dateien
    im Workspace starten.

.USAGE
    Ausfuehren aus dem Workspace-Root oder direkt via Explorer-Rechtsklick:
    powershell -ExecutionPolicy Bypass -File _scripts\create-desktop-shortcuts.ps1
#>

$WorkspaceRoot = "C:\_Daten\mapplus-exp"
$WShell        = New-Object -ComObject WScript.Shell
$Desktop       = $WShell.SpecialFolders("Desktop")

$Shortcuts = @(
    @{
        Name    = "Deploy DEV"
        Target  = "$WorkspaceRoot\_scripts\deployment\deploy-dev\deploy-dev.bat"
        Icon    = "%SystemRoot%\System32\shell32.dll,23"
        Desc    = "Geaenderte Dateien aus maps-dev nach /www/maps-dev hochladen"
    },
    @{
        Name    = "Dry-Run DEV"
        Target  = "$WorkspaceRoot\_scripts\deployment\deploy-dev\deploy-dev-dryrun.bat"
        Icon    = "%SystemRoot%\System32\shell32.dll,23"
        Desc    = "Vorschau: Welche DEV-Dateien wuerden hochgeladen?"
    },
    @{
        Name    = "PROD Release (Hash)"
        Target  = "$WorkspaceRoot\_scripts\deployment\deploy-prod\release-full.bat"
        Icon    = "%SystemRoot%\System32\shell32.dll,131"
        Desc    = "Promote + Hash-Build + Upload: maps-dev nach /www/maps"
    },
    @{
        Name    = "PROD Release (Clean Build)"
        Target  = "$WorkspaceRoot\_scripts\deployment\deploy-prod\release-full-rebuild.bat"
        Icon    = "%SystemRoot%\System32\shell32.dll,131"
        Desc    = "Promote + kompletter JS-Rebuild + Upload: maps-dev nach /www/maps"
    },
    @{
        Name    = "Dry-Run PROD Release"
        Target  = "$WorkspaceRoot\_scripts\deployment\deploy-prod\release-dryrun.bat"
        Icon    = "%SystemRoot%\System32\shell32.dll,131"
        Desc    = "Vorschau: Was wuerden Promote + Upload veraendern?"
    },
    @{
        Name    = "Git Commit (nach PROD)"
        Target  = "$WorkspaceRoot\_scripts\deployment\deploy-prod\git-commit.bat"
        Icon    = "%SystemRoot%\System32\shell32.dll,146"
        Desc    = "Source-Dateien stagen und committen (ohne Build-Output)"
    }
)

$Created = 0
$Skipped = 0

foreach ($s in $Shortcuts) {
    $LnkPath = Join-Path $Desktop "$($s.Name).lnk"

    if (Test-Path $s.Target) {
        $Lnk                  = $WShell.CreateShortcut($LnkPath)
        $Lnk.TargetPath       = $s.Target
        $Lnk.WorkingDirectory = $WorkspaceRoot
        $Lnk.Description      = $s.Desc
        $Lnk.IconLocation     = $s.Icon
        $Lnk.Save()
        Write-Host "[OK] $($s.Name).lnk" -ForegroundColor Green
        $Created++
    } else {
        Write-Host "[WARN] Ziel nicht gefunden, uebersprungen: $($s.Target)" -ForegroundColor Yellow
        $Skipped++
    }
}

Write-Host ""
Write-Host "$Created Verkuepfung(en) erstellt, $Skipped uebersprungen." -ForegroundColor Cyan
Write-Host "Desktop: $Desktop"
