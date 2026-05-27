#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
"""
build_js.py
Build aller JS-Quelldateien aus js-dev/ nach js/.
Verwendet esbuild (Standalone-Binary, kein Node.js noetig).
Bei fehlendem esbuild.exe wird die Binary automatisch heruntergeladen.

Aufruf:
    py _scripts/build/build_js.py                              # Alle PROD-Dateien (maps/) bauen
    py _scripts/build/build_js.py --mode dev                   # Alle DEV-Dateien (maps-dev/) bauen
    py _scripts/build/build_js.py --mode dev  maps-dev/tnet/js-dev/foo.js
    py _scripts/build/build_js.py --mode prod maps/tnet/js-dev/foo.js

@version    1.1
@date       2026-05-27
@copyright  Trigonet AG
@author     Marco Dellenbach
"""
import os
import sys
import subprocess
import urllib.request
import zipfile
import argparse

# ===== KONFIGURATION =====
_SCRIPT_DIR      = os.path.dirname(os.path.abspath(__file__))
_WORKSPACE_ROOT  = os.path.normpath(os.path.join(_SCRIPT_DIR, "..", ".."))

ESBUILD_VERSION  = "0.25.2"
ESBUILD_URL      = f"https://registry.npmjs.org/@esbuild/win32-x64/-/win32-x64-{ESBUILD_VERSION}.tgz"
TOOLS_DIR        = os.path.normpath(os.path.join(_SCRIPT_DIR, "..", "tools"))
ESBUILD_EXE      = os.path.join(TOOLS_DIR, "esbuild.exe")

# Standard-Pfade fuer PROD (maps/) — bei Full-Build mit --mode dev auf maps-dev/ umgeleitet
JS_DEV_DIR       = os.path.normpath(os.path.join(_WORKSPACE_ROOT, "maps", "tnet", "js-dev"))
JS_OUT_DIR       = os.path.normpath(os.path.join(_WORKSPACE_ROOT, "maps", "tnet", "js"))


def resolve_js_roots(src_path=None):
    """Passende js-dev/js Wurzeln fuer maps oder maps-dev bestimmen."""
    if not src_path:
        return JS_DEV_DIR, JS_OUT_DIR

    norm_src = os.path.normpath(src_path)
    js_dev_marker = os.path.normpath(os.path.join("tnet", "js-dev"))
    js_out_marker = os.path.normpath(os.path.join("tnet", "js"))

    if js_dev_marker in norm_src:
        app_root = norm_src.split(js_dev_marker)[0].rstrip("\\/")
        return (
            os.path.join(app_root, "tnet", "js-dev"),
            os.path.join(app_root, "tnet", "js"),
        )

    if js_out_marker in norm_src:
        app_root = norm_src.split(js_out_marker)[0].rstrip("\\/")
        return (
            os.path.join(app_root, "tnet", "js-dev"),
            os.path.join(app_root, "tnet", "js"),
        )

    return JS_DEV_DIR, JS_OUT_DIR


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
        print(f"[ERR] Download fehlgeschlagen: {e}")
        return False

    import tarfile
    try:
        with tarfile.open(tgz_path, "r:gz") as tar:
            for member in tar.getmembers():
                if member.name.endswith("esbuild.exe"):
                    member.name = os.path.basename(member.name)
                    tar.extract(member, TOOLS_DIR, filter="data")
                    break
            else:
                print("[ERR] esbuild.exe nicht im Archiv gefunden")
                return False
    except Exception as e:
        print(f"[ERR] Entpacken fehlgeschlagen: {e}")
        return False
    finally:
        try:
            os.remove(tgz_path)
        except Exception:
            pass

    if os.path.isfile(ESBUILD_EXE):
        print(f"[OK] esbuild.exe heruntergeladen nach {ESBUILD_EXE}")
        return True
    else:
        print("[ERR] esbuild.exe nach Entpacken nicht gefunden")
        return False


# ===== BUILD =====

def detect_build_mode(src_path=None):
    """Leitet den Buildmodus aus dem Quellpfad ab, falls kein Modus angegeben wurde."""
    if src_path and f"{os.sep}maps-dev{os.sep}" in os.path.normpath(src_path):
        return "dev"
    return "prod"


def build_file(src_path, mode="prod"):
    """
    Einzelne Datei bauen.
    DEV bleibt lesbar, PROD wird minifiziert.
    Gibt (ok, bytes_vorher, bytes_nachher, fehlermeldung) zurueck.
    """
    js_dev_dir, js_out_dir = resolve_js_roots(src_path)
    rel = os.path.relpath(src_path, js_dev_dir)
    out_path = os.path.join(js_out_dir, rel)

    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    size_before = os.path.getsize(src_path)

    args = [
        ESBUILD_EXE,
        src_path,
        "--bundle=false",
        f"--outfile={out_path}",
    ]
    if mode == "prod":
        args.insert(-1, "--minify")

    result = subprocess.run(args, capture_output=True, text=True)

    if result.returncode != 0:
        return False, size_before, 0, result.stderr.strip()

    size_after = os.path.getsize(out_path)
    return True, size_before, size_after, ""


def collect_sources(root):
    """Alle .js Dateien aus root und root/mobile/ (nicht rekursiv tiefer)."""
    files = []
    if not os.path.isdir(root):
        print(f"[WARN] js-dev-Verzeichnis nicht gefunden: {root}")
        return files
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
    parser = argparse.ArgumentParser(
        description="Baut TNET JS-Dateien aus tnet/js-dev nach tnet/js.\n"
                    "Full-Build ohne --src: --mode dev baut maps-dev/, --mode prod baut maps/"
    )
    parser.add_argument("src", nargs="?", help="Optionale Einzeldatei aus tnet/js-dev oder tnet/js")
    parser.add_argument("--mode", choices=["dev", "prod"], help="Buildmodus: dev ohne Minify, prod mit Minify")
    args = parser.parse_args()

    if not ensure_esbuild():
        sys.exit(1)

    if args.src:
        # --- Einzeldatei-Build ---
        src = os.path.normpath(args.src)
        js_dev_dir, js_out_dir = resolve_js_roots(src)
        # Pfad darf auch aus js/ kommen → auf js-dev/ umleiten
        src = src.replace(js_out_dir + os.sep, js_dev_dir + os.sep)
        if not os.path.isfile(src):
            print(f"[ERR] Datei nicht gefunden: {src}")
            sys.exit(1)
        sources = [src]
        mode = args.mode or detect_build_mode(src)
        print(f"Einzelbuild ({mode}): {os.path.basename(src)}")
    else:
        # --- Full-Build ---
        mode = args.mode or "prod"
        if mode == "dev":
            # DEV: maps-dev/tnet/js-dev/
            build_root = os.path.normpath(os.path.join(_WORKSPACE_ROOT, "maps-dev", "tnet", "js-dev"))
        else:
            # PROD: maps/tnet/js-dev/
            build_root = JS_DEV_DIR
        sources = collect_sources(build_root)
        if not sources:
            print(f"[ERR] Keine .js-Quelldateien gefunden in: {build_root}")
            sys.exit(1)
        print(f"Full-Build ({mode}): {len(sources)} Dateien aus {build_root}\n")

    ok_count = 0
    err_count = 0
    total_before = 0
    total_after = 0

    js_dev_dir_display, _ = resolve_js_roots(sources[0]) if sources else (JS_DEV_DIR, JS_OUT_DIR)

    for src in sources:
        rel = os.path.relpath(src, js_dev_dir_display).replace("\\", "/")
        ok, before, after, err = build_file(src, mode)
        if ok:
            ratio = (1 - after / before) * 100 if before > 0 else 0
            if mode == "prod":
                print(f"  [OK] {rel:<45} {before:>7,} -> {after:>7,} bytes  ({ratio:.0f}% kleiner)")
            else:
                print(f"  [OK] {rel:<45} {before:>7,} -> {after:>7,} bytes  (lesbar)")
            ok_count += 1
            total_before += before
            total_after += after
        else:
            print(f"  [ERR] {rel} -- {err}")
            err_count += 1

    if len(sources) > 1:
        total_ratio = (1 - total_after / total_before) * 100 if total_before > 0 else 0
        print(f"\n{'─'*70}")
        print(f"  Gesamt: {ok_count} OK, {err_count} Fehler")
        print(f"  Groesse: {total_before:,} -> {total_after:,} bytes  ({total_ratio:.0f}% kleiner)")

    if err_count > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
