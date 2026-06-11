from fastapi import FastAPI, HTTPException, BackgroundTasks, Query, Path as FastPath, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
import tempfile
import zipfile
from pathlib import Path
import pandas as pd
import json
import shutil
import os
import stat
import io
import hashlib
import logging
from datetime import datetime

try:
    import paramiko
except ImportError:
    paramiko = None

from .ags2mapplus_ags_services import get_all_services, get_all_services_with_details
from .ags2mapplus_config import main as config_main
from .ags2mapplus_qgis import parse_qgs_xml, parse_qgz, qgis_main, list_qgis_projects, QMAP_SFTP_DIR
from .ags2mapplus_security import verify_access, AccessControlMiddleware
from .ags2mapplus_admin import router as admin_router
from .ags2mapplus_lyrmgr import router as lyrmgr_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)

tags_metadata = [
    {"name": "ArcGIS-Dienste", "description": "ArcGIS Server Dienste abfragen und Mapplus-Konfigurationen generieren"},
    {"name": "Staging-Deployment", "description": "Konfigurationen via SFTP ins Staging deployen"},
    {"name": "Git-Versionierung", "description": "Git-Repository für Konfigurations-Versionierung verwalten"},
    {"name": "LyrMgr SFTP", "description": "Layer-Manager-Konfigurationen verwalten und publizieren"},
    {"name": "Admin", "description": "IP-Zugriffsverwaltung und Admin-Oberfläche"},
    {"name": "QGIS-Projekte", "description": "QGIS-Server-Projekte parsen und MapPlus-Konfigurationen generieren"},
]

ags2mapplus = FastAPI(
    title="ags2mapplus API",
    description=(
        "API für den Export mehrerer GIS-Dienste als ZIP-Datei.\n\n"
        "🔐 [Admin / IP-Verwaltung](admin/login)"
    ),
    version="1.0.0",
    openapi_tags=tags_metadata,
    dependencies=[Depends(verify_access)],
)

ags2mapplus.include_router(admin_router)
ags2mapplus.include_router(lyrmgr_router)
ags2mapplus.add_middleware(AccessControlMiddleware)

# Definiere den Temp-Verzeichnis-Pfad relativ zur aktuellen Modul-Datei
TEMP_DIR = Path(__file__).parent / "temp"
TEMP_DIR.mkdir(parents=True, exist_ok=True)


# ===== SFTP DEPLOY KONFIGURATION =====

SFTP_HOST = "nwow.mapplus.ch"
SFTP_PORT = 22
SFTP_USER = "trigonet"
SFTP_PASSWORD = os.getenv("SFTP_PASSWORD", "")

# SFTP-Pfade (aus Sicht des SFTP-Users - NICHT der PHP-Pfad!)
DEPLOY_TARGETS = {
    "prod": {
        "staging_base": "/data/tmp/maps/ImportToCore",
        "legacy_staging_base": "/data/tmp/ImportToCore",
        "core_config_dir": "/www/core/config",
        "core_nls_dir": "/www/core/nls/de",
        "maps_root": "/www/maps",
        "legend_tuner_path": "/www/core/config/legend_tuner.json",
        "legend_tuner_load_url": "https://www.gis-daten.ch/maps/tnet/api/v1/treebuilder-api.php?action=legend-tuner-load",
        "bookmarks_draft_path": "/data/tmp/maps/bookmarks/map-bookmarks-all.json",
        "bookmarks_path": "/www/maps/tnet/data/map-bookmarks-all.json",
        "bookmarks_load_url": "https://www.gis-daten.ch/maps/tnet/api/v1/treebuilder-api.php?action=bookmarks-load",
    },
    "dev": {
        "staging_base": "/data/tmp/maps-dev/ImportToCore",
        "legacy_staging_base": None,
        "core_config_dir": "/www/core/config",
        "core_nls_dir": "/www/core/nls/de",
        "maps_root": "/www/maps-dev",
        "legend_tuner_path": "/www/core/config/legend_tuner.json",
        "legend_tuner_load_url": "https://www.gis-daten.ch/maps-dev/tnet/api/v1/treebuilder-api.php?action=legend-tuner-load",
        "bookmarks_draft_path": "/data/tmp/maps-dev/bookmarks/map-bookmarks-all.json",
        "bookmarks_path": "/www/maps-dev/tnet/data/map-bookmarks-all.json",
        "bookmarks_load_url": "https://www.gis-daten.ch/maps-dev/tnet/api/v1/treebuilder-api.php?action=bookmarks-load",
    },
}


def _normalize_target(target: str | None = None) -> str:
    """Normalisiert das Publish-Ziel. Ohne Angabe ist DEV der Default."""
    value = (target or "dev").strip().lower()
    if value in ("dev", "maps-dev"):
        return "dev"
    if value in ("prod", "production", "maps"):
        return "prod"
    raise HTTPException(status_code=400, detail=f"Unbekanntes Publish-Ziel: {target}")


def _deploy_target(target: str | None = None) -> dict:
    normalized = _normalize_target(target)
    paths = dict(DEPLOY_TARGETS[normalized])
    paths["target"] = normalized
    return paths


STAGING_BASE    = DEPLOY_TARGETS["prod"]["staging_base"]
CORE_CONFIG_DIR = DEPLOY_TARGETS["prod"]["core_config_dir"]
CORE_NLS_DIR    = DEPLOY_TARGETS["prod"]["core_nls_dir"]

# Prefix → Zielverzeichnis
PREFIX_ROUTING = {
    "layers":             CORE_CONFIG_DIR,
    "maptips":            CORE_CONFIG_DIR,
    "lyrmgrResources":    CORE_NLS_DIR,
    "maptipsResources":   CORE_NLS_DIR,
    "legendResources":    CORE_NLS_DIR,
}

ALLOWED_EXTENSIONS = {".conf", ".json"}


# ===== PYDANTIC MODELS =====

class DiensteRequest(BaseModel):
    dienstnamen: list[str] = Field(
        ...,
        description="Liste der Dienstnamen für die GIS-Services (z.B. gis_oereb/nw_gewaesserraum_DEF)",
        example=[
            "gis_oereb/nw_gewaesserraum_DEF",
            "gis_oereb/nw_gewaesserraum_PRJ"
        ]
    )


class FileAction(BaseModel):
    name: str = Field(..., description="Dateiname")
    source_path: str = Field(..., description="Quellpfad auf dem SFTP-Server")
    target_dir: str = Field(..., description="Zielverzeichnis auf dem SFTP-Server")
    target_path: str = Field(..., description="Vollständiger Zielpfad")
    size: int = Field(..., description="Dateigrösse in Bytes")
    size_display: str = Field(..., description="Dateigrösse formatiert")
    status: str = Field(..., description="Status: 'neu', 'überschreiben', 'identisch' etc.")
    result: str = Field(..., description="Ergebnis: 'deployed', 'skipped', 'error', 'dry-run'")
    error: str | None = Field(None, description="Fehlermeldung falls result='error'")
    source_mtime: float | None = Field(None, description="Änderungszeitpunkt der Quelldatei (Unix-Timestamp)")
    source_mtime_display: str | None = Field(None, description="Änderungszeitpunkt der Quelldatei formatiert")
    target_mtime: float | None = Field(None, description="Änderungszeitpunkt der Zieldatei (Unix-Timestamp)")
    target_mtime_display: str | None = Field(None, description="Änderungszeitpunkt der Zieldatei formatiert")
    source_hash: str | None = Field(None, description="MD5-Hash der Quelldatei")
    target_hash: str | None = Field(None, description="MD5-Hash der Zieldatei")
    hash_match: bool | None = Field(None, description="True wenn Quell- und Ziel-Hash identisch sind")


class DeployResult(BaseModel):
    target: str | None = Field(None, description="Publish-Ziel: prod oder dev")
    kuerzel: str = Field(..., description="Kürzel des Staging-Verzeichnisses")
    staging_dir: str = Field(..., description="Staging-Quellverzeichnis")
    staging_base: str | None = Field(None, description="Basis-Pfad des Staging-Bereichs")
    core_config_dir: str | None = Field(None, description="Zielverzeichnis fuer layers/maptips")
    core_nls_dir: str | None = Field(None, description="Zielverzeichnis fuer NLS-Dateien")
    deployed: int = Field(..., description="Anzahl erfolgreich deployter Dateien")
    skipped: int = Field(..., description="Anzahl übersprungener Dateien")
    errors: int = Field(..., description="Anzahl fehlgeschlagener Dateien")
    dry_run: bool = Field(..., description="Ob im Dry-Run-Modus ausgeführt")
    files: list[FileAction] = Field(default_factory=list, description="Details pro Datei")


class KuerzelInfo(BaseModel):
    name: str = Field(..., description="Kürzel-Name")
    file_count: int = Field(..., description="Anzahl deploybare Dateien")
    total_size: int = Field(..., description="Gesamtgrösse in Bytes")
    total_size_display: str = Field(..., description="Gesamtgrösse formatiert")
    prefixes: list[str] = Field(default_factory=list, description="Gefundene Prefix-Typen")


class StagingListResult(BaseModel):
    target: str | None = Field(None, description="Publish-Ziel: prod oder dev")
    staging_base: str = Field(..., description="Basis-Pfad des Staging-Bereichs")
    core_config_dir: str | None = Field(None, description="Zielverzeichnis fuer layers/maptips")
    core_nls_dir: str | None = Field(None, description="Zielverzeichnis fuer NLS-Dateien")
    kuerzel: list[KuerzelInfo] = Field(default_factory=list, description="Verfügbare Kürzel")
    total: int = Field(..., description="Gesamtanzahl Kürzel")


class DeployAllResult(BaseModel):
    target: str | None = Field(None, description="Publish-Ziel: prod oder dev")
    staging_base: str | None = Field(None, description="Basis-Pfad des Staging-Bereichs")
    results: list[DeployResult] = Field(default_factory=list, description="Ergebnis pro Kürzel")
    total_deployed: int = Field(..., description="Gesamtanzahl deployter Dateien")
    total_errors: int = Field(..., description="Gesamtanzahl Fehler")


# ===== SFTP HILFSFUNKTIONEN =====

def _sftp_connect():
    """Öffnet eine SFTP-Verbindung und gibt (ssh, sftp) zurück."""
    if paramiko is None:
        raise HTTPException(status_code=500, detail="paramiko nicht installiert. → pip install paramiko")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(SFTP_HOST, SFTP_PORT, SFTP_USER, SFTP_PASSWORD, timeout=30, banner_timeout=30)
        sftp = ssh.open_sftp()
        sftp.get_channel().settimeout(30)
        return ssh, sftp
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SFTP-Verbindungsfehler: {e}")


def _remote_exists(sftp, path):
    """Prüft ob ein Remote-Pfad existiert."""
    try:
        sftp.stat(path)
        return True
    except IOError:
        return False


def _remote_copy_via_sftp(sftp, src, dst):
    """Kopiert eine Datei remote-to-remote via SFTP (Download in RAM, Upload)."""
    buf = io.BytesIO()
    sftp.getfo(src, buf)
    buf.seek(0)
    sftp.putfo(buf, dst)


def _remote_file_hash(sftp, path):
    """Berechnet den MD5-Hash einer Remote-Datei via SFTP."""
    md5 = hashlib.md5()
    with sftp.open(path, 'rb') as f:
        while True:
            chunk = f.read(65536)
            if not chunk:
                break
            md5.update(chunk)
    return md5.hexdigest()


def _format_size(size):
    """Formatiert Dateigrösse lesbar."""
    if size < 1024:
        return f"{size} B"
    elif size < 1024 * 1024:
        return f"{size / 1024:.1f} KB"
    else:
        return f"{size / (1024 * 1024):.1f} MB"


def _format_mtime(ts):
    """Formatiert einen Unix-Timestamp lesbar, oder None falls ts None ist."""
    if ts is None:
        return None
    return datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M")


def _get_prefix(filename):
    """Ermittelt den Prefix einer Konfigurationsdatei."""
    for prefix in PREFIX_ROUTING:
        if filename.startswith(prefix + "_") or filename.startswith(prefix + "-"):
            return prefix
    return None


def _prefix_routing_for_target(target_paths: dict) -> dict:
    return {
        "layers":             target_paths["core_config_dir"],
        "maptips":            target_paths["core_config_dir"],
        "lyrmgrResources":    target_paths["core_nls_dir"],
        "maptipsResources":   target_paths["core_nls_dir"],
        "legendResources":    target_paths["core_nls_dir"],
    }


def _find_files_recursive(sftp, base_dir, staging_dir, prefix_routing=None):
    """Sucht rekursiv nach deploybare Dateien in einem Verzeichnis."""
    if prefix_routing is None:
        prefix_routing = PREFIX_ROUTING
    files = []
    try:
        entries = sftp.listdir_attr(base_dir)
    except IOError:
        return files

    for entry in entries:
        if entry.filename.startswith('.'):
            continue

        full_path = f"{base_dir}/{entry.filename}"

        if stat.S_ISDIR(entry.st_mode):
            files.extend(_find_files_recursive(sftp, full_path, staging_dir, prefix_routing))
            continue

        if not stat.S_ISREG(entry.st_mode):
            continue

        _, ext = os.path.splitext(entry.filename)
        if ext.lower() not in ALLOWED_EXTENSIONS:
            continue

        prefix = _get_prefix(entry.filename)
        if prefix is None:
            continue

        files.append({
            'name':       entry.filename,
            'src_path':   full_path,
            'prefix':     prefix,
            'size':       entry.st_size,
            'mtime':      entry.st_mtime,
            'target_dir': prefix_routing[prefix],
        })

    return files


def _list_staging_kuerzel(sftp, staging_base=None):
    """Listet alle verfügbaren Kürzel im Staging-Bereich."""
    staging_base = staging_base or STAGING_BASE
    try:
        entries = sftp.listdir_attr(staging_base)
    except IOError:
        return []

    dirs = []
    for entry in entries:
        if stat.S_ISDIR(entry.st_mode) and not entry.filename.startswith('.'):
            dirs.append(entry.filename)

    dirs.sort()
    return dirs


def _list_staging_files(sftp, kuerzel, staging_base=None, prefix_routing=None):
    """Listet alle deploybare Dateien eines Kürzels im Staging (rekursiv)."""
    staging_base = staging_base or STAGING_BASE
    prefix_routing = prefix_routing or PREFIX_ROUTING
    staging_dir = f"{staging_base}/{kuerzel}"
    all_files = _find_files_recursive(sftp, staging_dir, staging_dir, prefix_routing)

    seen_names = set()
    unique_files = []
    for f in all_files:
        if f['name'] in seen_names:
            continue
        seen_names.add(f['name'])
        unique_files.append(f)

    unique_files.sort(key=lambda f: f['name'])
    return unique_files


def _deploy_kuerzel(sftp, kuerzel, dry_run=False, no_backup=False, target_paths=None):
    """Deployed alle Staging-Dateien eines Kürzels in die Core-Verzeichnisse."""
    target_paths = target_paths or DEPLOY_TARGETS["dev"]
    staging_base = target_paths["staging_base"]
    prefix_routing = _prefix_routing_for_target(target_paths)
    staging_dir = f"{staging_base}/{kuerzel}"
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')

    files = _list_staging_files(sftp, kuerzel, staging_base=staging_base, prefix_routing=prefix_routing)

    deployed = 0
    skipped = 0
    errors = 0
    file_actions = []

    if not files:
        return DeployResult(
            target=target_paths.get("target"),
            kuerzel=kuerzel,
            staging_dir=staging_dir,
            staging_base=staging_base,
            core_config_dir=target_paths["core_config_dir"],
            core_nls_dir=target_paths["core_nls_dir"],
            deployed=0, skipped=0, errors=0,
            dry_run=dry_run, files=[]
        )

    for f in files:
        src_path = f['src_path']
        target_path = f"{f['target_dir']}/{f['name']}"
        size_str = _format_size(f['size'])

        # Quell-mtime immer verfügbar
        source_mtime = f.get('mtime')
        source_mtime_display = _format_mtime(source_mtime)
        target_mtime = None
        target_mtime_display = None

        # Zielverzeichnis prüfen
        if not _remote_exists(sftp, f['target_dir']):
            errors += 1
            file_actions.append(FileAction(
                name=f['name'], source_path=src_path,
                target_dir=f['target_dir'], target_path=target_path,
                size=f['size'], size_display=size_str,
                status="Zielverzeichnis fehlt",
                result="error", error=f"Zielverzeichnis fehlt: {f['target_dir']}",
                source_mtime=source_mtime,
                source_mtime_display=source_mtime_display,
                target_mtime=None,
                target_mtime_display=None,
            ))
            continue

        # Status der bestehenden Datei + Hash-Vergleich
        exists = _remote_exists(sftp, target_path)
        source_hash = None
        target_hash = None
        hash_match = None

        if exists:
            try:
                existing_stat = sftp.stat(target_path)
                existing_size = _format_size(existing_stat.st_size)
                target_mtime = existing_stat.st_mtime
                target_mtime_display = _format_mtime(target_mtime)

                # Hash-Vergleich Quell- vs. Zieldatei
                try:
                    source_hash = _remote_file_hash(sftp, src_path)
                    target_hash = _remote_file_hash(sftp, target_path)
                    hash_match = (source_hash == target_hash)
                except Exception:
                    pass  # Hash-Fehler nicht kritisch

                if hash_match:
                    status_text = f"identisch ({size_str}, MD5 gleich)"
                else:
                    status_text = f"überschreiben ({existing_size} → {size_str})"
            except IOError:
                status_text = f"neu ({size_str})"
        else:
            status_text = f"neu ({size_str})"
            # Hash der Quelle trotzdem berechnen (für Info)
            try:
                source_hash = _remote_file_hash(sftp, src_path)
            except Exception:
                pass

        if dry_run:
            if hash_match:
                skipped += 1
                result_status = "dry-run-skip"
            else:
                deployed += 1
                result_status = "dry-run"
            file_actions.append(FileAction(
                name=f['name'], source_path=src_path,
                target_dir=f['target_dir'], target_path=target_path,
                size=f['size'], size_display=size_str,
                status=status_text, result=result_status,
                source_mtime=source_mtime,
                source_mtime_display=source_mtime_display,
                target_mtime=target_mtime,
                target_mtime_display=target_mtime_display,
                source_hash=source_hash,
                target_hash=target_hash,
                hash_match=hash_match,
            ))
            continue

        # Identische Dateien überspringen
        if hash_match:
            skipped += 1
            file_actions.append(FileAction(
                name=f['name'], source_path=src_path,
                target_dir=f['target_dir'], target_path=target_path,
                size=f['size'], size_display=size_str,
                status=status_text, result="skipped",
                source_mtime=source_mtime,
                source_mtime_display=source_mtime_display,
                target_mtime=target_mtime,
                target_mtime_display=target_mtime_display,
                source_hash=source_hash,
                target_hash=target_hash,
                hash_match=hash_match,
            ))
            continue

        # Backup erstellen
        if exists and not no_backup:
            backup_path = f"{target_path}.{ts}.bak"
            try:
                _remote_copy_via_sftp(sftp, target_path, backup_path)
            except Exception:
                pass  # Backup-Fehler nicht kritisch

        # Datei kopieren
        try:
            _remote_copy_via_sftp(sftp, src_path, target_path)
            # Änderungsdatum der Quelldatei auf die Zieldatei übertragen
            if source_mtime is not None:
                try:
                    source_stat = sftp.stat(src_path)
                    sftp.utime(target_path, (source_stat.st_atime, source_stat.st_mtime))
                except Exception:
                    pass  # mtime-Fehler nicht kritisch
            deployed += 1
            file_actions.append(FileAction(
                name=f['name'], source_path=src_path,
                target_dir=f['target_dir'], target_path=target_path,
                size=f['size'], size_display=size_str,
                status=status_text, result="deployed",
                source_mtime=source_mtime,
                source_mtime_display=source_mtime_display,
                target_mtime=target_mtime,
                target_mtime_display=target_mtime_display,
                source_hash=source_hash,
                target_hash=target_hash,
                hash_match=False,
            ))
        except Exception as e:
            errors += 1
            file_actions.append(FileAction(
                name=f['name'], source_path=src_path,
                target_dir=f['target_dir'], target_path=target_path,
                size=f['size'], size_display=size_str,
                status=status_text, result="error", error=str(e),
                source_mtime=source_mtime,
                source_mtime_display=source_mtime_display,
                target_mtime=target_mtime,
                target_mtime_display=target_mtime_display,
                source_hash=source_hash,
                target_hash=target_hash,
                hash_match=hash_match,
            ))

    return DeployResult(
        target=target_paths.get("target"),
        kuerzel=kuerzel,
        staging_dir=staging_dir,
        staging_base=staging_base,
        core_config_dir=target_paths["core_config_dir"],
        core_nls_dir=target_paths["core_nls_dir"],
        deployed=deployed, skipped=skipped, errors=errors,
        dry_run=dry_run, files=file_actions
    )

def merge_excel_files(file_paths, output_path):
    """Merges multiple Excel files into one, handling empty cases."""
    all_data = []
    for file in file_paths:
        if Path(file).exists():
            try:
                df = pd.read_excel(file, engine="openpyxl")
                df.insert(0, "Quelle", Path(file).name)  # Herkunftsdatei als Spalte
                all_data.append(df)
            except Exception as e:
                print(f"Warnung: Konnte {file} nicht lesen: {e}")
    
    if not all_data:
        # Erstelle eine leere Excel-Datei mit Spaltenköpfen, wenn keine Dateien vorhanden sind
        empty_df = pd.DataFrame(columns=["Quelle", "Pfad_maschinenlesbar"])
        empty_df.to_excel(output_path, index=False)
        return output_path
    
    merged_df = pd.concat(all_data, ignore_index=True)
    merged_df.to_excel(output_path, index=False)
    return output_path

@ags2mapplus.post(
    "/mapplus-conf-export",
    tags=["ArcGIS-Dienste"],
    summary="Exportiere für mehrere ArcGIS Server Dienste entsprechende Mapplus-Configurationsfiles",
    description=(
        "Erzeugt für eine Liste von GIS-Diensten die zugehörigen Exportdateien "
        "und liefert sie gesammelt als ZIP-Archiv zurück. "
        "Die Dienstnamen werden als JSON-Liste im Request-Body übergeben. "
        "Zusätzlich werden alle erzeugten Excel-Dateien zu einer Datei zusammengeführt."
    ),
    response_description="ZIP-Archiv mit allen Exportdateien für die angegebenen Dienste und einer zusammengeführten Excel-Datei."
)
def ags2mapplus_endpoint(
    background_tasks: BackgroundTasks,
    req: DiensteRequest
):
    try:
        request_temp_dir = Path(tempfile.mkdtemp(prefix="ags2mapplus_", dir=str(TEMP_DIR)))

        # Generiere Excel-Dateien für alle angeforderten Dienste
        print(f"Generiere Dateien für folgende Dienste: {req.dienstnamen}")
        for dienst in req.dienstnamen:
            try:
                print(f"Verarbeite Dienst: {dienst}")
                config_main(dienst, output_dir=request_temp_dir)
                print(f"Dienst {dienst} erfolgreich verarbeitet.")
            except Exception as e:
                print(f"Fehler beim Verarbeiten von Dienst {dienst}: {e}")
                # Fahre mit nächstem Dienst fort, aber logge Fehler

        # Sammle alle vorhandenen Dateien im Temp-Verzeichnis
        files = []
        excel_files = []
        
        if request_temp_dir.exists():
            for f in request_temp_dir.glob("*"):
                if f.is_file():
                    files.append(f)
                    if f.name.endswith("_Layerstruktur.xlsx"):
                        excel_files.append(f)

        # Excel-Dateien zusammenführen (auch wenn die Liste leer ist)
        merged_excel = request_temp_dir / "merged_Layerstruktur.xlsx"
        try:
            print(f"Führe Excel-Dateien zusammen: {excel_files}")
            if excel_files:
                merge_excel_files(excel_files, merged_excel)
            else:
                # Erstelle eine leere Datei, wenn keine Excel-Dateien vorhanden sind
                empty_df = pd.DataFrame(columns=["Quelle", "Pfad_maschinenlesbar"])
                request_temp_dir.mkdir(parents=True, exist_ok=True)
                empty_df.to_excel(merged_excel, index=False, engine="openpyxl")
                print("Leere Excel-Datei erstellt, da keine Eingabedateien vorhanden sind.")
            
            files.append(merged_excel)
        except Exception as e:
            print(f"Fehler beim Zusammenführen der Excel-Dateien: {e}")
            background_tasks.add_task(lambda: shutil.rmtree(request_temp_dir, ignore_errors=True))
            raise HTTPException(status_code=500, detail=f"Fehler beim Zusammenführen der Excel-Dateien: {e}")

        # JSON mit Pfad_maschinenlesbar erzeugen
        try:
            if merged_excel.exists():
                df = pd.read_excel(merged_excel, engine="openpyxl")
                if "Pfad_maschinenlesbar" in df.columns:
                    pfade = df["Pfad_maschinenlesbar"].dropna().unique().tolist()
                    pfade_json_path = request_temp_dir / "pfade_maschinenlesbar.json"
                    with open(pfade_json_path, "w", encoding="utf-8") as f:
                        json.dump(pfade, f, ensure_ascii=False, indent=2)
                    files.append(pfade_json_path)
                    print(f"JSON-Datei mit Pfaden erzeugt: {pfade_json_path}")
                else:
                    print("Spalte 'Pfad_maschinenlesbar' nicht in zusammengeführter Datei vorhanden.")
        except Exception as e:
            print(f"Fehler beim Erzeugen der JSON-Datei: {e}")
            # Optional: Fehlerbehandlung, aber Export kann trotzdem weiterlaufen

        # Überprüfe, ob es zumindest die zusammengeführte Excel-Datei gibt
        missing = [str(f) for f in files if not f.exists()]
        if missing:
            print(f"Fehlende Dateien vor ZIP-Erstellung: {missing}")
            background_tasks.add_task(lambda: shutil.rmtree(request_temp_dir, ignore_errors=True))
            raise HTTPException(status_code=500, detail=f"Dateien fehlen: {missing}")

        # Erstelle ZIP-Datei mit allen verfügbaren Dateien
        zip_path = request_temp_dir / "export.zip"
        try:
            print(f"Erstelle ZIP-Datei: {zip_path}")
            with zipfile.ZipFile(zip_path, "w") as zipf:
                for file in files:
                    if file.exists() and file != zip_path:
                        print(f"Füge Datei zum ZIP hinzu: {file}")
                        zipf.write(file, arcname=file.name)
        except Exception as e:
            print(f"Fehler beim Erstellen der ZIP-Datei: {e}")
            background_tasks.add_task(lambda: shutil.rmtree(request_temp_dir, ignore_errors=True))
            raise HTTPException(status_code=500, detail=f"Fehler beim Erstellen der ZIP-Datei: {e}")

        background_tasks.add_task(lambda: shutil.rmtree(request_temp_dir, ignore_errors=True))
        try:
            file_handle = open(zip_path, "rb")
            print(f"ZIP-Datei erfolgreich erstellt und geöffnet: {zip_path}")
            return StreamingResponse(
                file_handle,
                media_type="application/zip",
                headers={"Content-Disposition": "attachment; filename=export.zip"}
            )
        except Exception as e:
            print(f"Fehler beim Senden der ZIP-Datei: {e}")
            background_tasks.add_task(lambda: shutil.rmtree(request_temp_dir, ignore_errors=True))
            raise HTTPException(status_code=500, detail=f"Fehler beim Senden der ZIP-Datei: {e}")

    except HTTPException:
        raise
    except Exception as e:
        print(f"Allgemeiner Fehler im Export-Endpunkt: {e}")
        raise HTTPException(status_code=500, detail=f"Allgemeiner Fehler im Export-Endpunkt: {e}")

@ags2mapplus.get(
    "/get-ags-services",
    tags=["ArcGIS-Dienste"],
    summary="Liste aller ArcGIS-Server-Dienste abrufen",
    description=(
        "Gibt eine Liste aller verfügbaren ArcGIS-Server-Dienste vom ArcGIS Server zurück. "
        "Mit `details=true` wird pro Dienst das Publish-Datum, der Publisher und ein Hash geliefert "
        "(nützlich um zu erkennen, ob ein Dienst neu publiziert wurde). "
        "Die Detail-Abfrage wird gecacht; mit `refresh=true` kann ein Neuaufbau erzwungen werden."
    ),
    response_description="JSON-Objekt mit einer Liste der Dienstnamen (oder Detail-Objekten)."
)
def get_ags_services_endpoint(
    details: bool = Query(False, description="Wenn true, werden Publish-Datum, Publisher und Hash pro Dienst mitgeliefert."),
    refresh: bool = Query(False, description="Wenn true, wird der Detail-Cache sofort neu aufgebaut."),
):
    try:
        if not details:
            dienstnamen = get_all_services()
            return {"dienstnamen": dienstnamen}

        service_details, cache_age = get_all_services_with_details(force_refresh=refresh)
        return {
            "dienstnamen": service_details,
            "cache_age_seconds": round(cache_age, 1),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Fehler beim Abrufen der Dienste: {e}")


# ===== DEPLOY STAGING ENDPOINTS =====

@ags2mapplus.get(
    "/deploy-staging/test",
    tags=["Staging-Deployment"],
    summary="SFTP-Verbindung testen",
    description="Prüft ob die SFTP-Verbindung zum Server hergestellt werden kann und gibt Diagnose-Infos zurück.",
    response_description="Verbindungsstatus und Diagnose-Details."
)
def test_sftp_connection_endpoint(target: str = Query("dev", description="Publish-Ziel: dev oder prod")):
    """Testet die SFTP-Verbindung ohne Dateien zu kopieren."""
    import time
    target_paths = _deploy_target(target)
    start = time.time()
    result = {
        "host": SFTP_HOST,
        "port": SFTP_PORT,
        "user": SFTP_USER,
        "target": target_paths["target"],
        "staging_base": target_paths["staging_base"],
        "core_config_dir": target_paths["core_config_dir"],
        "core_nls_dir": target_paths["core_nls_dir"],
        "maps_root": target_paths["maps_root"],
        "connected": False,
        "staging_accessible": False,
        "duration_ms": 0,
        "error": None,
    }
    ssh = None
    sftp = None
    try:
        if paramiko is None:
            result["error"] = "paramiko nicht installiert. → pip install paramiko"
            return result
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect(SFTP_HOST, SFTP_PORT, SFTP_USER, SFTP_PASSWORD, timeout=30, banner_timeout=30)
        sftp = ssh.open_sftp()
        sftp.get_channel().settimeout(30)
        result["connected"] = True
        # Staging-Verzeichnis prüfen
        try:
            sftp.listdir(target_paths["staging_base"])
            result["staging_accessible"] = True
        except IOError as e:
            result["staging_accessible"] = False
            result["error"] = f"Staging-Verzeichnis nicht erreichbar: {e}"
    except Exception as e:
        result["error"] = str(e)
    finally:
        result["duration_ms"] = round((time.time() - start) * 1000)
        if sftp:
            sftp.close()
        if ssh:
            ssh.close()
    return result


@ags2mapplus.get(
    "/deploy-staging/list",
    tags=["Staging-Deployment"],
    response_model=StagingListResult,
    summary="Staging-Kürzel auflisten",
    description=(
        "Listet alle verfügbaren Kürzel im Staging-Bereich (ImportToCore) auf dem SFTP-Server auf. "
        "Pro Kürzel werden Anzahl Dateien, Gesamtgrösse und die gefundenen Prefix-Typen angezeigt."
    ),
    response_description="Liste der verfügbaren Kürzel mit Datei-Statistiken."
)
def list_staging_endpoint(target: str = Query("dev", description="Publish-Ziel: dev oder prod")):
    target_paths = _deploy_target(target)
    prefix_routing = _prefix_routing_for_target(target_paths)
    ssh, sftp = _sftp_connect()
    try:
        kuerzel_list = _list_staging_kuerzel(sftp, target_paths["staging_base"])
        result_kuerzel = []
        for k in kuerzel_list:
            files = _list_staging_files(sftp, k, staging_base=target_paths["staging_base"], prefix_routing=prefix_routing)
            total_size = sum(f['size'] for f in files)
            prefixes = sorted(set(f['prefix'] for f in files))
            result_kuerzel.append(KuerzelInfo(
                name=k,
                file_count=len(files),
                total_size=total_size,
                total_size_display=_format_size(total_size),
                prefixes=prefixes
            ))
        return StagingListResult(
            target=target_paths["target"],
            staging_base=target_paths["staging_base"],
            core_config_dir=target_paths["core_config_dir"],
            core_nls_dir=target_paths["core_nls_dir"],
            kuerzel=result_kuerzel,
            total=len(result_kuerzel)
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Fehler beim Auflisten der Staging-Kürzel: {e}")
    finally:
        sftp.close()
        ssh.close()


@ags2mapplus.post(
    "/deploy-staging/{kuerzel}",
    tags=["Staging-Deployment"],
    response_model=DeployResult,
    summary="Einzelnes Kürzel deployen",
    description=(
        "Kopiert alle Staging-Dateien eines Kürzels vom ImportToCore-Bereich "
        "in die produktiven Core-Verzeichnisse auf dem SFTP-Server. "
        "Dateien werden anhand ihres Prefix geroutet (layers_*, maptips_* → config/, "
        "lyrmgrResources_*, maptipsResources_*, legendResources_* → nls/de/). "
        "Bestehende Dateien werden optional gesichert (.bak)."
    ),
    response_description="Deployment-Ergebnis mit Details pro Datei."
)
def deploy_staging_endpoint(
    kuerzel: str = FastPath(..., description="Kürzel des Staging-Verzeichnisses (z.B. gis_basis, ewn, awu)"),
    dry_run: bool = Query(True, description="Nur anzeigen was passieren würde, ohne Änderungen (Standard: true)"),
    no_backup: bool = Query(False, description="Keine Backups der bestehenden Dateien erstellen"),
    target: str = Query("dev", description="Publish-Ziel: dev oder prod")
):
    target_paths = _deploy_target(target)
    ssh, sftp = _sftp_connect()
    try:
        staging_dir = f"{target_paths['staging_base']}/{kuerzel}"
        if not _remote_exists(sftp, staging_dir):
            available = _list_staging_kuerzel(sftp, target_paths["staging_base"])
            raise HTTPException(
                status_code=404,
                detail=f"Kürzel '{kuerzel}' nicht gefunden in {target_paths['staging_base']}. Verfügbar: {', '.join(available)}"
            )
        return _deploy_kuerzel(sftp, kuerzel, dry_run=dry_run, no_backup=no_backup, target_paths=target_paths)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Fehler beim Deployment von '{kuerzel}': {e}")
    finally:
        sftp.close()
        ssh.close()


@ags2mapplus.post(
    "/deploy-staging-all",
    tags=["Staging-Deployment"],
    response_model=DeployAllResult,
    summary="Alle Kürzel deployen",
    description=(
        "Deployed alle verfügbaren Kürzel aus dem Staging-Bereich (ImportToCore) "
        "auf einmal in die produktiven Core-Verzeichnisse. "
        "Kann im Dry-Run-Modus ausgeführt werden, um die geplanten Aktionen zu prüfen."
    ),
    response_description="Gesamtergebnis mit Deployment-Details pro Kürzel."
)
def deploy_staging_all_endpoint(
    dry_run: bool = Query(True, description="Nur anzeigen was passieren würde, ohne Änderungen (Standard: true)"),
    no_backup: bool = Query(False, description="Keine Backups der bestehenden Dateien erstellen"),
    target: str = Query("dev", description="Publish-Ziel: dev oder prod")
):
    target_paths = _deploy_target(target)
    ssh, sftp = _sftp_connect()
    try:
        kuerzel_list = _list_staging_kuerzel(sftp, target_paths["staging_base"])
        if not kuerzel_list:
            return DeployAllResult(
                target=target_paths["target"],
                staging_base=target_paths["staging_base"],
                results=[],
                total_deployed=0,
                total_errors=0,
            )

        results = []
        total_deployed = 0
        total_errors = 0
        for k in kuerzel_list:
            result = _deploy_kuerzel(sftp, k, dry_run=dry_run, no_backup=no_backup, target_paths=target_paths)
            results.append(result)
            total_deployed += result.deployed
            total_errors += result.errors

        return DeployAllResult(
            target=target_paths["target"],
            staging_base=target_paths["staging_base"],
            results=results,
            total_deployed=total_deployed,
            total_errors=total_errors
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Fehler beim Deployment aller Kürzel: {e}")
    finally:
        sftp.close()
        ssh.close()


# ===== GIT VERSIONIERUNG ENDPOINTS =====

git = None
DulwichRepo = None
DulwichConfig = None
ParamikoSSHVendor = None

try:
    from dulwich import porcelain as git
    from dulwich.repo import Repo as DulwichRepo
    from dulwich.config import ConfigFile as DulwichConfig
    from dulwich.contrib.paramiko_vendor import ParamikoSSHVendor
    _dulwich_available = True
except ImportError:
    _dulwich_available = False

GIT_REPO_URL = "ssh://git@ssh.github.com:443/dellenbach/mapplus-conf.git"
GIT_REPO_PATH_ON_GITHUB = "/dellenbach/mapplus-conf.git"
CONFIG_REPO_DIR = Path(os.getenv(
    "GIT_CONFIG_REPO",
    str(Path(__file__).parent / "mapplus-conf")
))
DEPLOY_KEY_FILE = os.getenv(
    "GIT_DEPLOY_KEY",
    str(Path(__file__).parent / ".ssh" / "mapplus_config_deploy")
)
GIT_AUTHOR = "MapPlus Deploy <support@gis-daten.ch>"


def _get_ssh_vendor():
    """Erstellt einen ParamikoSSHVendor mit dem Deploy Key."""
    vendor = ParamikoSSHVendor()
    return vendor


def _git_push():
    """Pusht lokale Commits via paramiko SSH nach GitHub (Port 443)."""
    from dulwich.client import SSHGitClient
    import dulwich.client as _dc

    # Override: dulwich soll unseren paramiko-Vendor nutzen
    _dc.get_ssh_vendor = _get_ssh_vendor

    repo = DulwichRepo(str(CONFIG_REPO_DIR))
    client = SSHGitClient(
        "ssh.github.com",
        port=443,
        username="git",
        key_filename=DEPLOY_KEY_FILE,
    )

    def update_refs(old_refs, abilities=None):
        new_refs = dict(old_refs)
        new_refs[b"refs/heads/master"] = repo.refs[b"refs/heads/master"]
        return new_refs

    client.send_pack(
        GIT_REPO_PATH_ON_GITHUB,
        update_refs,
        repo.generate_pack_data,
    )


def _deploy_path_to_repo_rel(deploy_path: str) -> str:
    """Ermittelt den relativen Pfad innerhalb des Git-Repos aus einem SFTP-Pfad."""
    # core-dev entfernt: DEV nutzt jetzt /www/core/

    if "/www/core/" in deploy_path:
        return "core/" + deploy_path.split("/www/core/", 1)[1]
    if "/www/maps-dev/" in deploy_path:
        return "maps-dev/" + deploy_path.split("/www/maps-dev/", 1)[1]
    if "/www/maps/" in deploy_path:
        return "maps/" + deploy_path.split("/www/maps/", 1)[1]
    if "/www/" in deploy_path:
        return "www/" + deploy_path.split("/www/", 1)[1]
    raise ValueError(f"Kann Repo-Pfad nicht ermitteln: {deploy_path}")


def _validate_deploy_path_for_target(deploy_path: str, target: str):
    """Verhindert, dass DEV-Publish versehentlich PROD-Pfade versioniert."""
    normalized = _normalize_target(target)
    if normalized == "dev":
        allowed = ("/www/core/", "/www/maps-dev/")
        forbidden = ("/www/maps/",)
    else:
        allowed = ("/www/core/", "/www/maps/")
        forbidden = ("/www/maps-dev/",)
    if deploy_path.startswith(forbidden):
        raise HTTPException(status_code=400, detail=f"Pfad passt nicht zu target={normalized}: {deploy_path}")
    if not deploy_path.startswith(allowed):
        raise HTTPException(status_code=400, detail=f"Pfad ausserhalb erlaubter Zielpfade fuer target={normalized}: {deploy_path}")


def _load_dulwich():
    """Importiert dulwich bei Bedarf neu und aktualisiert den Cache."""
    global git, DulwichRepo, DulwichConfig, ParamikoSSHVendor, _dulwich_available

    if _dulwich_available and git is not None and DulwichRepo is not None and DulwichConfig is not None and ParamikoSSHVendor is not None:
        return

    try:
        from dulwich import porcelain as _git
        from dulwich.repo import Repo as _DulwichRepo
        from dulwich.config import ConfigFile as _DulwichConfig
        from dulwich.contrib.paramiko_vendor import ParamikoSSHVendor as _ParamikoSSHVendor
    except ImportError:
        _dulwich_available = False
        git = None
        DulwichRepo = None
        DulwichConfig = None
        ParamikoSSHVendor = None
        raise HTTPException(status_code=500, detail="dulwich nicht installiert. → pip install dulwich")

    git = _git
    DulwichRepo = _DulwichRepo
    DulwichConfig = _DulwichConfig
    ParamikoSSHVendor = _ParamikoSSHVendor
    _dulwich_available = True


def _ensure_dulwich():
    """Stellt sicher, dass dulwich verfügbar ist."""
    _load_dulwich()


def _ensure_repo():
    """Stellt sicher, dass das Git-Repo existiert."""
    _ensure_dulwich()
    if not (CONFIG_REPO_DIR / ".git").is_dir():
        raise HTTPException(
            status_code=500,
            detail=f"Git-Repo nicht gefunden: {CONFIG_REPO_DIR}. Bitte /git-init aufrufen."
        )


def _git_commit_and_push(rel_path: str, message: str):
    """Führt git add, commit und push via dulwich aus."""
    repo_path = str(CONFIG_REPO_DIR)
    # add
    git.add(repo_path, paths=[rel_path])

    # commit
    git.commit(
        repo_path,
        message=message,
        author=GIT_AUTHOR.encode(),
        committer=GIT_AUTHOR.encode(),
    )

    # push via paramiko SSH
    _git_push()


class GitCommitRequest(BaseModel):
    deployPath: str = Field(..., description="SFTP-Pfad der Datei (z.B. /www/core/config/layers_ewn.conf)")
    source: str = Field("", description="Quellangabe (z.B. 'editor', 'deploy')")
    message: str = Field("", description="Optionale Commit-Nachricht")
    target: str = Field("", description="Optionales Publish-Ziel: prod oder dev")


class GitBatchCommitRequest(BaseModel):
    deployPaths: list[str] = Field(..., description="Liste von SFTP-Pfaden (z.B. ['/www/core/config/layers_ewn.conf', ...])")
    source: str = Field("", description="Quellangabe (z.B. 'deploy-staging')")
    message: str = Field("", description="Optionale Commit-Nachricht")
    target: str = Field("", description="Optionales Publish-Ziel: prod oder dev")


class GitDeleteRequest(BaseModel):
    deployPath: str = Field(..., description="SFTP-Pfad der gelöschten Datei")
    source: str = Field("", description="Quellangabe")
    message: str = Field("", description="Optionale Commit-Nachricht")
    target: str = Field("", description="Optionales Publish-Ziel: prod oder dev")


@ags2mapplus.get(
    "/git-status",
    tags=["Git-Versionierung"],
    summary="Git-Versionierung Diagnose",
    description="Prüft ob dulwich, Git-Repo und Deploy Key korrekt eingerichtet sind.",
)
def git_status():
    error = None
    try:
        _load_dulwich()
    except HTTPException as exc:
        error = exc.detail

    result = {
        "dulwich_installed": _dulwich_available,
        "repo_exists": False,
        "deploy_key_exists": False,
        "config_repo_path": str(CONFIG_REPO_DIR),
        "deploy_key_path": DEPLOY_KEY_FILE,
        "git_remote": GIT_REPO_URL,
        "error": error,
    }
    try:
        result["deploy_key_exists"] = Path(DEPLOY_KEY_FILE).is_file()
        result["repo_exists"] = (CONFIG_REPO_DIR / ".git").is_dir()
    except Exception as e:
        result["error"] = str(e)
    return result


@ags2mapplus.get(
    "/git-repo-info",
    tags=["Git-Versionierung"],
    summary="Git-Repo Diagnostik",
)
def git_repo_info():
    """Zeigt Branch, HEAD, letzte Commits und Status des lokalen Repos."""
    _ensure_repo()
    from dulwich.repo import Repo as _Repo
    repo = _Repo(str(CONFIG_REPO_DIR))
    result = {}
    try:
        head = repo.head()
        result["head"] = head.decode()
        result["refs"] = {k.decode(): v.decode() for k, v in repo.refs.as_dict().items()}
        # letzte 3 commits
        commits = []
        walker = repo.get_walker(max_entries=3)
        for entry in walker:
            c = entry.commit
            commits.append({
                "id": c.id.decode()[:12],
                "message": c.message.decode().strip(),
                "author": c.author.decode(),
            })
        result["recent_commits"] = commits
    except Exception as e:
        result["error"] = f"{type(e).__name__}: {e}"
    return result


@ags2mapplus.post(
    "/git-init",
    tags=["Git-Versionierung"],
    summary="Git-Repo klonen",
    description=(
        "Klont das GitHub-Repo mit dem Deploy Key ins lokale Verzeichnis. "
        "Nur nötig beim erstmaligen Setup."
    ),
)
def git_init():
    _ensure_dulwich()
    if (CONFIG_REPO_DIR / ".git").is_dir():
        return {"success": True, "message": f"Repo existiert bereits: {CONFIG_REPO_DIR}"}

    try:
        CONFIG_REPO_DIR.parent.mkdir(parents=True, exist_ok=True)
        git.clone(
            source=GIT_REPO_URL,
            target=str(CONFIG_REPO_DIR),
            key_filename=DEPLOY_KEY_FILE,
        )
        return {"success": True, "message": f"Repo geklont nach {CONFIG_REPO_DIR}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Clone fehlgeschlagen: {e}")


@ags2mapplus.post(
    "/git-commit-conf",
    tags=["Git-Versionierung"],
    summary="Config-Datei ins Git-Repo committen",
    description=(
        "Liest eine Config-Datei vom SFTP-Server, speichert sie im lokalen Git-Repo, "
        "committet die Änderung und pusht sie nach GitHub."
    ),
    response_description="Commit-Ergebnis mit Status und Nachricht."
)
def git_commit_conf(req: GitCommitRequest, target: str = Query("dev", description="Publish-Ziel: dev oder prod")):
    _ensure_repo()
    active_target = _normalize_target(req.target or target)
    _validate_deploy_path_for_target(req.deployPath, active_target)
    try:
        rel = _deploy_path_to_repo_rel(req.deployPath)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Datei via SFTP vom Linux-Server lesen
    ssh, sftp = _sftp_connect()
    try:
        try:
            sftp.stat(req.deployPath)
        except IOError:
            raise HTTPException(status_code=404, detail=f"Datei nicht gefunden: {req.deployPath}")

        buf = io.BytesIO()
        sftp.getfo(req.deployPath, buf)
    finally:
        sftp.close()
        ssh.close()

    # Datei lokal ins Git-Repo schreiben
    repo_file = CONFIG_REPO_DIR / rel.replace("/", os.sep)
    repo_file.parent.mkdir(parents=True, exist_ok=True)
    old_content = repo_file.read_bytes() if repo_file.is_file() else None
    new_content = buf.getvalue()

    if old_content == new_content:
        return {
            "success": True,
            "committed": False,
            "target": active_target,
            "deployPath": req.deployPath,
            "repoPath": rel,
            "message": "Keine Änderungen",
        }

    repo_file.write_bytes(new_content)

    msg = req.message or f"Update {rel}"
    if req.source:
        msg = f"[{req.source}] {msg}"

    try:
        _git_commit_and_push(rel, msg)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Git-Commit fehlgeschlagen: {type(e).__name__}: {e}")

    return {
        "success": True,
        "committed": True,
        "target": active_target,
        "deployPath": req.deployPath,
        "repoPath": rel,
        "message": msg,
    }


@ags2mapplus.post(
    "/git-commit-batch",
    tags=["Git-Versionierung"],
    summary="Mehrere Config-Dateien in einem Commit ins Git-Repo uebernehmen",
    description=(
        "Liest mehrere Config-Dateien vom SFTP-Server, speichert sie im lokalen Git-Repo, "
        "committet alle Aenderungen in einem einzelnen Commit und pusht nach GitHub."
    ),
    response_description="Batch-Commit-Ergebnis mit Status und Anzahl.",
)
def git_commit_batch(req: GitBatchCommitRequest, target: str = Query("dev", description="Publish-Ziel: dev oder prod")):
    _ensure_repo()
    active_target = _normalize_target(req.target or target)
    if not req.deployPaths:
        return {"success": True, "committed": False, "message": "Keine Dateien angegeben"}

    # SFTP-Verbindung fuer alle Dateien
    ssh, sftp = _sftp_connect()
    try:
        changed_rels = []
        skipped = 0

        for deploy_path in req.deployPaths:
            _validate_deploy_path_for_target(deploy_path, active_target)
            try:
                rel = _deploy_path_to_repo_rel(deploy_path)
            except ValueError:
                continue

            # Datei vom Server lesen
            try:
                buf = io.BytesIO()
                sftp.getfo(deploy_path, buf)
            except IOError:
                continue

            # Lokal ins Repo schreiben (nur wenn geaendert)
            repo_file = CONFIG_REPO_DIR / rel.replace("/", os.sep)
            repo_file.parent.mkdir(parents=True, exist_ok=True)
            old_content = repo_file.read_bytes() if repo_file.is_file() else None
            new_content = buf.getvalue()

            if old_content == new_content:
                skipped += 1
                continue

            repo_file.write_bytes(new_content)
            changed_rels.append(rel)

        if not changed_rels:
            return {
                "success": True,
                "committed": False,
                "target": active_target,
                "deployPaths": req.deployPaths,
                "changed": 0,
                "skipped": skipped,
                "message": "Keine Aenderungen",
            }

        # Alle geaenderten Dateien in einem Commit
        repo_path = str(CONFIG_REPO_DIR)
        for rel in changed_rels:
            git.add(repo_path, paths=[rel])

        msg = req.message or f"Deploy {len(changed_rels)} Dateien"
        if req.source:
            msg = f"[{req.source}] {msg}"

        git.commit(
            repo_path,
            message=msg,
            author=GIT_AUTHOR.encode(),
            committer=GIT_AUTHOR.encode(),
        )
        _git_push()

        return {
            "success": True,
            "committed": True,
            "target": active_target,
            "deployPaths": req.deployPaths,
            "repoPaths": changed_rels,
            "changed": len(changed_rels),
            "skipped": skipped,
            "message": msg,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Git-Batch-Commit fehlgeschlagen: {type(e).__name__}: {e}")
    finally:
        sftp.close()
        ssh.close()


@ags2mapplus.post(
    "/git-delete-conf",
    tags=["Git-Versionierung"],
    summary="Config-Datei aus dem Git-Repo löschen",
    description=(
        "Entfernt eine Config-Datei aus dem lokalen Git-Repo, "
        "committet die Löschung und pusht sie nach GitHub."
    ),
    response_description="Lösch-Ergebnis mit Status und Nachricht."
)
def git_delete_conf(req: GitDeleteRequest, target: str = Query("dev", description="Publish-Ziel: dev oder prod")):
    _ensure_repo()
    active_target = _normalize_target(req.target or target)
    _validate_deploy_path_for_target(req.deployPath, active_target)
    try:
        rel = _deploy_path_to_repo_rel(req.deployPath)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    repo_file = CONFIG_REPO_DIR / rel.replace("/", os.sep)
    if not repo_file.is_file():
        return {
            "success": True,
            "committed": False,
            "target": active_target,
            "deployPath": req.deployPath,
            "repoPath": rel,
            "message": f"{rel} nicht im Repo",
        }

    msg = req.message or f"Delete {rel}"
    if req.source:
        msg = f"[{req.source}] {msg}"

    try:
        # Datei löschen und aus Index entfernen
        repo_file.unlink()
        repo_path = str(CONFIG_REPO_DIR)
        git.remove(repo_path, paths=[rel])
        git.commit(
            repo_path,
            message=msg,
            author=GIT_AUTHOR.encode(),
            committer=GIT_AUTHOR.encode(),
        )
        _git_push()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Git-Delete fehlgeschlagen: {e}")

    return {
        "success": True,
        "committed": True,
        "target": active_target,
        "deployPath": req.deployPath,
        "repoPath": rel,
        "message": msg,
    }


# ===== QGIS-PROJEKTE AUFLISTEN =====

@ags2mapplus.get(
    "/get-qgis-projects",
    tags=["QGIS-Projekte"],
    summary="Liste aller QGIS-Server-Projekte abrufen",
    description=(
        "Listet alle verfügbaren QGIS-Projekte (.qgs/.qgz) auf dem Server auf. "
        "Mit `details=true` werden pro Projekt zusätzlich Layer-Informationen geliefert "
        "(Projektname, CRS, Layer-Anzahl, Layer-Details mit Geometrietyp, Feldanzahl und Aliase)."
    ),
    response_description="JSON-Objekt mit einer Liste der QGIS-Projekte.",
)
def get_qgis_projects_endpoint(
    details: bool = Query(False, description="Wenn true, werden Layer-Details pro Projekt mitgeliefert (langsamer, da QGS/QGZ via SFTP gelesen werden)."),
):
    ssh, sftp = _sftp_connect()
    try:
        projects = list_qgis_projects(sftp, details=details)
        return {"projects": projects, "count": len(projects)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Fehler beim Auflisten der QGIS-Projekte: {e}")
    finally:
        sftp.close()
        ssh.close()


# ===== QGIS CONFIG EXPORT =====

class QgisExportRequest(BaseModel):
    """Request-Body für den QGIS-Config-Export."""
    projekte: list[dict] = Field(
        ...,
        description="Liste von Projekten mit 'folder' und 'file' (ohne Endung)",
        example=[{"folder": "test", "file": "kulturobjekte_nw_pg", "ext": ".qgs"}],
    )


@ags2mapplus.post(
    "/qgis-conf-export",
    tags=["QGIS-Projekte"],
    summary="MapPlus-Config-Dateien aus QGIS-Projekten generieren",
    description=(
        "Liest QGIS-Projektdateien (.qgs/.qgz) vom Server via SFTP, "
        "parst Layer, Felder und Aliase und erzeugt daraus die MapPlus-Config-Dateien "
        "(layers.conf, maptips.conf, lyrmgrResources.json, maptipsResources.json, "
        "legendResources.json) als ZIP-Archiv."
    ),
    response_description="ZIP-Archiv mit allen Config-Dateien für die QGIS-Projekte.",
)
def qgis_conf_export(background_tasks: BackgroundTasks, req: QgisExportRequest):
    if paramiko is None:
        raise HTTPException(status_code=500, detail="paramiko nicht installiert")

    request_temp_dir = Path(tempfile.mkdtemp(prefix="qgis_export_", dir=str(TEMP_DIR)))

    try:
        # SFTP-Verbindung öffnen
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect(SFTP_HOST, SFTP_PORT, SFTP_USER, SFTP_PASSWORD, timeout=30, banner_timeout=30)
        sftp = ssh.open_sftp()
        sftp.get_channel().settimeout(30)

        all_files = []
        excel_files = []
        # Zuordnung: Dateipfad → (folder, project_file) für ZIP-Verzeichnisstruktur
        file_project_map = {}

        for projekt in req.projekte:
            folder = projekt["folder"]
            project_file = projekt["file"]
            ext = projekt.get("ext", ".qgs")
            kuerzel = folder  # Ordnername als Kürzel

            remote_path = f"{QMAP_SFTP_DIR}/{folder}/{project_file}{ext}"
            print(f"Lese QGIS-Projekt: {remote_path}")

            try:
                with sftp.open(remote_path, "rb") as remote_file:
                    file_content = remote_file.read()
            except Exception as e:
                print(f"WARNUNG: Kann {remote_path} nicht lesen: {e}")
                continue

            # QGS-XML extrahieren
            try:
                if ext.lower() == ".qgz":
                    xml_content = parse_qgz(file_content)
                else:
                    xml_content = file_content.decode("utf-8")
            except Exception as e:
                print(f"WARNUNG: Fehler beim Parsen von {remote_path}: {e}")
                continue

            # Projekt parsen
            project_info = parse_qgs_xml(xml_content)
            print(f"  -> {len(project_info['layers'])} Layer gefunden")

            # WMS-URL für GetCapabilities
            wms_base_url = f"https://www.gis-daten.ch/qmap/{folder}/{project_file}"

            # Config-Dateien generieren
            created = qgis_main(
                project_info=project_info,
                folder=folder,
                project_file=project_file,
                kuerzel=kuerzel,
                output_dir=request_temp_dir,
                wms_base_url=wms_base_url,
            )

            for f_path in created:
                p = Path(f_path)
                all_files.append(p)
                file_project_map[str(p)] = (folder, project_file)
                if p.name.endswith("_Layerstruktur.xlsx"):
                    excel_files.append(p)

        sftp.close()
        ssh.close()

        # Excel zusammenführen (wenn mehrere Projekte)
        if len(excel_files) > 1:
            merged_excel = request_temp_dir / "merged_Layerstruktur.xlsx"
            all_data = []
            for ef in excel_files:
                try:
                    df = pd.read_excel(ef, engine="openpyxl")
                    df.insert(0, "Quelle", ef.name)
                    all_data.append(df)
                except Exception as e:
                    print(f"Warnung: Konnte {ef} nicht lesen: {e}")
            if all_data:
                merged_df = pd.concat(all_data, ignore_index=True)
                merged_df.to_excel(merged_excel, index=False)
                all_files.append(merged_excel)

        if not all_files:
            raise HTTPException(status_code=400, detail="Keine Config-Dateien erzeugt. Prüfe die Projektnamen.")

        # ZIP erstellen — Dateien in Unterordner {folder}/{project}/ packen
        # analog zur AGS-Verzeichnisstruktur in raw-conf
        zip_path = request_temp_dir / "qgis_export.zip"
        with zipfile.ZipFile(zip_path, "w") as zipf:
            for file in all_files:
                if file.exists() and file != zip_path:
                    proj = file_project_map.get(str(file))
                    if proj:
                        folder, project_file = proj
                        svc_dir = f"qgis_{folder}_{project_file}".lower()
                        arcname = f"{svc_dir}/{file.name}"
                    else:
                        arcname = file.name
                    zipf.write(file, arcname=arcname)

        background_tasks.add_task(lambda: shutil.rmtree(request_temp_dir, ignore_errors=True))

        file_handle = open(zip_path, "rb")
        return StreamingResponse(
            file_handle,
            media_type="application/zip",
            headers={"Content-Disposition": "attachment; filename=qgis_export.zip"},
        )

    except HTTPException:
        raise
    except Exception as e:
        background_tasks.add_task(lambda: shutil.rmtree(request_temp_dir, ignore_errors=True))
        print(f"Fehler im QGIS-Export: {e}")
        raise HTTPException(status_code=500, detail=f"Fehler im QGIS-Export: {e}")


# ===== LEGENDTUNER DEPLOY =====

# Pfade auf dem Server (aus Sicht des SFTP-Users)
TUNER_DEPLOYED_PATH = DEPLOY_TARGETS["prod"]["legend_tuner_path"]
# PHP-Endpoint zum Laden des Drafts (PHP hat Zugriff auf sein Dateisystem)
TUNER_PHP_LOAD_URL  = DEPLOY_TARGETS["prod"]["legend_tuner_load_url"]


@ags2mapplus.post(
    "/deploy-legend-tuner",
    tags=["Staging-Deployment"],
    summary="Legendtuner-Konfiguration deployen",
    description=(
        "Liest den Legendtuner-Draft via PHP-API, "
        "schreibt ihn per SFTP nach /www/core/config/ und "
        "committet+pusht ins Git-Repo."
    ),
)
def deploy_legend_tuner(target: str = Query("dev", description="Publish-Ziel: dev oder prod")):
    """Liest Draft von PHP, schreibt per SFTP → /www/core/config/, Git commit+push."""
    import requests, hashlib
    target_paths = _deploy_target(target)
    deployed_path = target_paths["legend_tuner_path"]
    load_url = target_paths["legend_tuner_load_url"]

    # 1. Draft via PHP-API holen (PHP sieht sein eigenes Dateisystem)
    try:
        resp = requests.get(load_url, timeout=10)
        resp.raise_for_status()
        php_result = resp.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"PHP-API nicht erreichbar: {e}")

    if not php_result.get("success"):
        raise HTTPException(status_code=500, detail=f"PHP-API Fehler: {php_result}")

    source = php_result.get("source", "empty")
    if source == "empty":
        raise HTTPException(status_code=404, detail="Kein Draft vorhanden (PHP meldet: empty)")

    # Draft-JSON aufbereiten
    draft_data = php_result.get("data", {})
    import json
    draft_json = json.dumps(draft_data, indent=4, ensure_ascii=False).encode("utf-8")
    draft_size = len(draft_json)
    draft_hash = hashlib.md5(draft_json).hexdigest()

    # 2. Per SFTP deployen
    ssh, sftp = _sftp_connect()

    try:
        # Prüfe ob deployed existiert und identisch ist
        deployed_exists = _remote_exists(sftp, deployed_path)
        if deployed_exists:
            deployed_hash = _remote_file_hash(sftp, deployed_path)
            # Vergleich: deployed-Datei vom Server lesen
            dep_buf = io.BytesIO()
            sftp.getfo(deployed_path, dep_buf)
            dep_content = dep_buf.getvalue()

            if dep_content == draft_json:
                sftp.close()
                ssh.close()
                return {
                    "success": True,
                    "action": "skipped",
                    "target": target_paths["target"],
                    "deployPath": deployed_path,
                    "loadUrl": load_url,
                    "message": "Draft und Deployed sind identisch — kein Deploy nötig",
                    "draft_size": draft_size,
                    "source": source,
                }

            # Backup
            from datetime import datetime
            backup_path = deployed_path + "." + datetime.now().strftime("%Y%m%d_%H%M%S") + ".bak"
            _remote_copy_via_sftp(sftp, deployed_path, backup_path)

        # Draft per SFTP nach deployed schreiben
        draft_buf = io.BytesIO(draft_json)
        sftp.putfo(draft_buf, deployed_path)

        sftp.close()
        ssh.close()

    except HTTPException:
        raise
    except Exception as e:
        try:
            sftp.close()
            ssh.close()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"SFTP-Deploy-Fehler: {e}")

    # 3. Git commit + push
    git_committed = False
    git_message = ""
    try:
        _ensure_repo()
        rel = _deploy_path_to_repo_rel(deployed_path)
        repo_file = CONFIG_REPO_DIR / rel.replace("/", os.sep)
        repo_file.parent.mkdir(parents=True, exist_ok=True)

        old_content = repo_file.read_bytes() if repo_file.is_file() else None
        if old_content != draft_json:
            repo_file.write_bytes(draft_json)
            git_message = f"[legendtuner] legend_tuner.json aktualisiert ({_format_size(draft_size)})"
            _git_commit_and_push(rel, git_message)
            git_committed = True
        else:
            git_message = "Keine Änderungen im Git-Repo"
    except Exception as git_err:
        git_message = f"Git-Fehler (Deploy war erfolgreich): {git_err}"

    return {
        "success": True,
        "action": "deployed",
        "target": target_paths["target"],
        "deployPath": deployed_path,
        "loadUrl": load_url,
        "message": f"legend_tuner.json deployed ({_format_size(draft_size)})",
        "draft_size": draft_size,
        "source": source,
        "git_committed": git_committed,
        "git_message": git_message,
    }


# ===== BOOKMARKS DEPLOY =====

BOOKMARKS_DEPLOYED_PATH = DEPLOY_TARGETS["prod"]["bookmarks_path"]
BOOKMARKS_PHP_LOAD_URL  = DEPLOY_TARGETS["prod"]["bookmarks_load_url"]


class BookmarksDeployRequest(BaseModel):
    message: str = Field("", description="Optionale Commit-Nachricht")
    target: str = Field("", description="Optionales Publish-Ziel: prod oder dev")


@ags2mapplus.post(
    "/deploy-bookmarks",
    tags=["Staging-Deployment"],
    summary="Bookmarks deployen (Draft → SFTP → Git)",
    description=(
        "Liest den Bookmarks-Draft via PHP-API, "
        "schreibt ihn per SFTP nach /www/maps/tnet/data/ und "
        "committet+pusht ins Git-Repo."
    ),
)
def deploy_bookmarks(req: BookmarksDeployRequest = BookmarksDeployRequest(), target: str = Query("dev", description="Publish-Ziel: dev oder prod")):
    """Liest Draft direkt via SFTP, schreibt per SFTP → deployed, Git commit+push."""
    target_paths = _deploy_target(req.target or target)
    draft_path = target_paths["bookmarks_draft_path"]
    deployed_path = target_paths["bookmarks_path"]
    load_url = target_paths["bookmarks_load_url"]

    # 1. Draft direkt via SFTP lesen
    ssh, sftp = _sftp_connect()
    try:
        source = "empty"
        raw_content = None

        if _remote_exists(sftp, draft_path):
            draft_buf = io.BytesIO()
            sftp.getfo(draft_path, draft_buf)
            raw_content = draft_buf.getvalue()
            source = "draft"
        elif _remote_exists(sftp, deployed_path):
            deployed_buf = io.BytesIO()
            sftp.getfo(deployed_path, deployed_buf)
            raw_content = deployed_buf.getvalue()
            source = "deployed"

        if raw_content is None:
            raise HTTPException(status_code=404, detail="Keine Bookmarks vorhanden (weder Draft noch deployed gefunden)")

        try:
            draft_data = json.loads(raw_content.decode("utf-8"))
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Bookmarks JSON ungueltig: {e}")

        if not isinstance(draft_data, list):
            raise HTTPException(status_code=500, detail="Bookmarks JSON ist kein Array")

        draft_json = json.dumps(draft_data, indent=4, ensure_ascii=False).encode("utf-8")
        draft_size = len(draft_json)
        draft_count = len(draft_data)

        # 2. Per SFTP deployen
        # Prüfe ob deployed existiert und identisch ist
        deployed_exists = _remote_exists(sftp, deployed_path)
        if deployed_exists:
            dep_buf = io.BytesIO()
            sftp.getfo(deployed_path, dep_buf)
            dep_content = dep_buf.getvalue()

            if dep_content == draft_json:
                sftp.close()
                ssh.close()
                return {
                    "success": True,
                    "action": "skipped",
                    "target": target_paths["target"],
                    "deployPath": deployed_path,
                    "loadUrl": load_url,
                    "message": "Draft und Deployed sind identisch — kein Deploy nötig",
                    "count": draft_count,
                    "source": source,
                }

            # Backup
            backup_path = deployed_path + "." + datetime.now().strftime("%Y%m%d_%H%M%S") + ".bak"
            _remote_copy_via_sftp(sftp, deployed_path, backup_path)

        # Draft per SFTP nach deployed schreiben
        draft_buf = io.BytesIO(draft_json)
        sftp.putfo(draft_buf, deployed_path)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SFTP-Deploy-Fehler: {e}")
    finally:
        try:
            sftp.close()
            ssh.close()
        except Exception:
            pass

    # 3. Git commit + push
    git_committed = False
    git_message = ""
    try:
        _ensure_repo()
        rel = _deploy_path_to_repo_rel(deployed_path)
        repo_file = CONFIG_REPO_DIR / rel.replace("/", os.sep)
        repo_file.parent.mkdir(parents=True, exist_ok=True)

        old_content = repo_file.read_bytes() if repo_file.is_file() else None
        if old_content != draft_json:
            repo_file.write_bytes(draft_json)
            git_message = req.message or f"[bookmarks] map-bookmarks-all.json aktualisiert ({draft_count} Bookmarks, {_format_size(draft_size)})"
            _git_commit_and_push(rel, git_message)
            git_committed = True
        else:
            git_message = "Keine Änderungen im Git-Repo"
    except Exception as git_err:
        git_message = f"Git-Fehler (Deploy war erfolgreich): {git_err}"

    return {
        "success": True,
        "action": "deployed",
        "target": target_paths["target"],
        "deployPath": deployed_path,
        "draftPath": draft_path,
        "loadUrl": load_url,
        "message": f"map-bookmarks-all.json deployed ({draft_count} Bookmarks, {_format_size(draft_size)})",
        "count": draft_count,
        "source": source,
        "git_committed": git_committed,
        "git_message": git_message,
    }
