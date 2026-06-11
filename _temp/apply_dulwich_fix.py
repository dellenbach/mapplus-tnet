"""
Dulwich Fix Script für ags2mapplus_api.py
Entfernt ParamikoSSHVendor und nutzt dulwich's built-in SSH Client
"""
import re

# Datei einlesen
with open(r"C:\_Daten\mapplus-exp\_temp\ags2mapplus_api_server.py", "r", encoding="utf-8") as f:
    content = f.read()

# ========== FIX 1: Top-Level Import (Zeilen 922-934) ==========
old_import = """git = None
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
    _dulwich_available = False"""

new_import = """git = None
DulwichRepo = None
DulwichConfig = None
_dulwich_available = False

try:
    from dulwich import porcelain as git
    from dulwich.repo import Repo as DulwichRepo
    from dulwich.config import ConfigFile as DulwichConfig
    _dulwich_available = True
except ImportError as e:
    print(f"[ERROR] Dulwich Import fehlgeschlagen: {e}")
    _dulwich_available = False"""

content = content.replace(old_import, new_import)

# ========== FIX 2: _get_ssh_vendor() löschen (Zeilen 949-952) ==========
old_get_ssh = """def _get_ssh_vendor():
    \"\"\"Erstellt einen ParamikoSSHVendor mit dem Deploy Key.\"\"\"
    vendor = ParamikoSSHVendor()
    return vendor


"""

content = content.replace(old_get_ssh, "")

# ========== FIX 3: _git_push() ersetzen (Zeilen 955-980) ==========
old_push = """def _git_push():
    \"\"\"Pusht lokale Commits via paramiko SSH nach GitHub (Port 443).\"\"\"
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
    )"""

new_push = """def _git_push():
    \"\"\"Pusht lokale Commits via SSH nach GitHub (Port 443).\"\"\"
    # Nutze dulwich.porcelain.push (built-in SSH Client)
    repo_path = str(CONFIG_REPO_DIR)
    git.push(
        repo_path,
        f"ssh://git@ssh.github.com:443{GIT_REPO_PATH_ON_GITHUB}",
        b"refs/heads/master"
    )"""

content = content.replace(old_push, new_push)

# ========== FIX 4: _load_dulwich() ersetzen (Zeilen 1013-1037) ==========
old_load = """def _load_dulwich():
    \"\"\"Importiert dulwich bei Bedarf neu und aktualisiert den Cache.\"\"\"
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
    _dulwich_available = True"""

new_load = """def _load_dulwich():
    \"\"\"Importiert dulwich bei Bedarf neu und aktualisiert den Cache.\"\"\"
    global git, DulwichRepo, DulwichConfig, _dulwich_available

    if _dulwich_available and git is not None and DulwichRepo is not None and DulwichConfig is not None:
        return

    try:
        from dulwich import porcelain as _git
        from dulwich.repo import Repo as _DulwichRepo
        from dulwich.config import ConfigFile as _DulwichConfig
    except ImportError as e:
        _dulwich_available = False
        git = None
        DulwichRepo = None
        DulwichConfig = None
        raise HTTPException(
            status_code=500, 
            detail=f"Dulwich Import fehlgeschlagen: {e}. Installiere: pip install --upgrade dulwich"
        )

    git = _git
    DulwichRepo = _DulwichRepo
    DulwichConfig = _DulwichConfig
    _dulwich_available = True"""

content = content.replace(old_load, new_load)

# ========== FIX 5: _ensure_repo() ersetzen (Zeilen 1045-1052) ==========
old_ensure = """def _ensure_repo():
    \"\"\"Stellt sicher, dass das Git-Repo existiert.\"\"\"
    _ensure_dulwich()
    if not (CONFIG_REPO_DIR / ".git").is_dir():
        raise HTTPException(
            status_code=500,
            detail=f"Git-Repo nicht gefunden: {CONFIG_REPO_DIR}. Bitte /git-init aufrufen."
        )"""

new_ensure = """def _ensure_repo():
    \"\"\"Stellt sicher, dass das Git-Repo existiert.\"\"\"
    _ensure_dulwich()
    
    if git is None:
        raise HTTPException(
            status_code=500,
            detail="Git-Modul nicht geladen (git ist None). Dulwich-Import fehlgeschlagen."
        )
    
    if not (CONFIG_REPO_DIR / ".git").is_dir():
        raise HTTPException(
            status_code=500,
            detail=f"Git-Repo nicht gefunden: {CONFIG_REPO_DIR}. Bitte /git-init aufrufen."
        )"""

content = content.replace(old_ensure, new_ensure)

# Datei speichern
with open(r"C:\_Daten\mapplus-exp\_temp\ags2mapplus_api_fixed.py", "w", encoding="utf-8") as f:
    f.write(content)

print("✓ Dulwich-Fix angewendet")
print("Ausgabedatei: C:\\_Daten\\mapplus-exp\\_temp\\ags2mapplus_api_fixed.py")
