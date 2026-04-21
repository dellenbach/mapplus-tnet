#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
"""
_build_js.py
Minifizierung und Obfuskation aller JS-Quelldateien aus js-dev/ nach js/.
Verwendet esbuild (Standalone-Binary, kein Node.js nötig).
Bei fehlendem esbuild.exe wird die Binary automatisch heruntergeladen.

Aufruf:
  py _scripts/_build_js.py                        # Alle Dateien bauen
  py _scripts/_build_js.py maps/tnet/js-dev/foo.js  # Einzelne Datei bauen

@version    1.0
@date       2026-04-13
@copyright  Trigonet AG
@author     Marco Dellenbach
"""
import os
import sys
import subprocess
import urllib.request
import zipfile

# ===== KONFIGURATION =====
ESBUILD_VERSION  = "0.25.2"
ESBUILD_URL      = f"https://registry.npmjs.org/@esbuild/win32-x64/-/win32-x64-{ESBUILD_VERSION}.tgz"
TOOLS_DIR        = os.path.normpath(os.path.join(os.path.dirname(__file__), "tools"))
ESBUILD_EXE      = os.path.join(TOOLS_DIR, "esbuild.exe")

JS_DEV_DIR       = os.path.normpath(r"c:\_Daten\mapplus-exp\maps\tnet\js-dev")
JS_OUT_DIR       = os.path.normpath(r"c:\_Daten\mapplus-exp\maps\tnet\js")

# ===== ESBUILD SETUP =====

def ensure_esbuild():
    """esbuild.exe herunterladen falls nicht vorhanden."""
    if os.path.isfile(ESBUILD_EXE):
        return True

    os.makedirs(TOOLS_DIR, exist_ok=True)
    tgz_path = os.path.join(TOOLS_DIR, "esbuild.tgz")

    print(f"esbuild nicht gefunden — lade herunter ({ESBUILD_URL})...")
    try:
        urllib.request.urlretrieve(ESBUILD_URL, tgz_path)
    except Exception as e:
        print(f"✗ Download fehlgeschlagen: {e}")
        return False

    # .tgz entpacken (tarfile statt zipfile)
    import tarfile
    try:
        with tarfile.open(tgz_path, "r:gz") as tar:
            # Binary liegt unter package/esbuild.exe im Archiv
            for member in tar.getmembers():
                if member.name.endswith("esbuild.exe"):
                    member.name = os.path.basename(member.name)
                    tar.extract(member, TOOLS_DIR, filter="data")
                    break
            else:
                print("✗ esbuild.exe nicht im Archiv gefunden")
                return False
    except Exception as e:
        print(f"✗ Entpacken fehlgeschlagen: {e}")
        return False
    finally:
        try:
            os.remove(tgz_path)
        except Exception:
            pass

    if os.path.isfile(ESBUILD_EXE):
        print(f"✓ esbuild.exe heruntergeladen nach {ESBUILD_EXE}")
        return True
    else:
        print("✗ esbuild.exe nach Entpacken nicht gefunden")
        return False


# ===== BUILD =====

def build_file(src_path):
    """
    Einzelne Datei minifizieren + obfuskieren.
    Gibt (ok, bytes_vorher, bytes_nachher) zurück.
    """
    # Relativen Pfad ermitteln: js-dev/foo.js oder js-dev/mobile/foo.js
    rel = os.path.relpath(src_path, JS_DEV_DIR)        # z.B. tnet-app.js oder mobile\tnet-toc-m.js
    out_path = os.path.join(JS_OUT_DIR, rel)

    # Ausgabe-Unterordner anlegen
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    size_before = os.path.getsize(src_path)

    result = subprocess.run(
        [ESBUILD_EXE,
         src_path,
         "--bundle=false",
         "--minify",
         f"--outfile={out_path}"],
        capture_output=True,
        text=True
    )

    if result.returncode != 0:
        return False, size_before, 0, result.stderr.strip()

    size_after = os.path.getsize(out_path)
    return True, size_before, size_after, ""


def collect_sources(root):
    """Alle .js Dateien aus root und root/mobile/ (nicht rekursiv tiefer)."""
    files = []
    for entry in sorted(os.listdir(root)):
        full = os.path.join(root, entry)
        if os.path.isfile(full) and entry.endswith(".js"):
            files.append(full)
    mobile = os.path.join(root, "mobile")
    if os.path.isdir(mobile):
        for entry in sorted(os.listdir(mobile)):
            full = os.path.join(mobile, entry)
            if os.path.isfile(full) and entry.endswith(".js"):
                files.append(full)
    return files


def main():
    if not ensure_esbuild():
        sys.exit(1)

    # Einzelne Datei oder Full-Build?
    if len(sys.argv) >= 2:
        src = os.path.normpath(sys.argv[1])
        # Pfad darf auch aus js/ kommen → auf js-dev/ umleiten
        src = src.replace(JS_OUT_DIR + os.sep, JS_DEV_DIR + os.sep)
        if not os.path.isfile(src):
            print(f"✗ Datei nicht gefunden: {src}")
            sys.exit(1)
        sources = [src]
        print(f"Einzelbuild: {os.path.basename(src)}")
    else:
        sources = collect_sources(JS_DEV_DIR)
        print(f"Full-Build: {len(sources)} Dateien aus {JS_DEV_DIR}\n")

    ok_count = 0
    err_count = 0
    total_before = 0
    total_after = 0

    for src in sources:
        rel = os.path.relpath(src, JS_DEV_DIR).replace("\\", "/")
        ok, before, after, err = build_file(src)
        if ok:
            ratio = (1 - after / before) * 100 if before > 0 else 0
            print(f"  ✓ {rel:<45} {before:>7,} → {after:>7,} bytes  ({ratio:.0f}% kleiner)")
            ok_count += 1
            total_before += before
            total_after += after
        else:
            print(f"  ✗ {rel} — {err}")
            err_count += 1

    if len(sources) > 1:
        total_ratio = (1 - total_after / total_before) * 100 if total_before > 0 else 0
        print(f"\n{'─'*70}")
        print(f"  Gesamt: {ok_count} OK, {err_count} Fehler")
        print(f"  Grösse: {total_before:,} → {total_after:,} bytes  ({total_ratio:.0f}% kleiner)")

    if err_count > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
