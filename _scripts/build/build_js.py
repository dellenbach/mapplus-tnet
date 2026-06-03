#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
"""
build_js.py
Build von TNET-JS aus einer Quellwurzel in eine Zielwurzel.
Verwendet esbuild (Standalone-Binary, kein Node.js noetig).
PROD-Builds werden zusaetzlich per Closure Compiler obfuskiert.
Bei fehlenden Tools werden die Binaries automatisch heruntergeladen.

Aufruf:
    py _scripts/build/build_js.py                              # Alle PROD-Dateien (maps/) bauen
    py _scripts/build/build_js.py --mode dev                   # Legacy DEV-Build
    py _scripts/build/build_js.py --mode prod --src-root maps-dev/tnet/js --out-root maps-dev/tnet/js-stage --rebuild-all
    py _scripts/build/build_js.py --mode prod --src-root maps/tnet/js-src --out-root maps/tnet/js --rebuild-all

@version    1.4
@date       2026-06-02
@copyright  Trigonet AG
@author     Marco Dellenbach
"""
import os
import sys
import subprocess
import tempfile
import urllib.request
import argparse
import re
import json
import hashlib

# ===== KONFIGURATION =====
_SCRIPT_DIR      = os.path.dirname(os.path.abspath(__file__))
_WORKSPACE_ROOT  = os.path.normpath(os.path.join(_SCRIPT_DIR, "..", ".."))

ESBUILD_VERSION  = "0.25.2"
ESBUILD_URL      = f"https://registry.npmjs.org/@esbuild/win32-x64/-/win32-x64-{ESBUILD_VERSION}.tgz"
TOOLS_DIR        = os.path.normpath(os.path.join(_SCRIPT_DIR, "..", "tools"))
ESBUILD_EXE      = os.path.join(TOOLS_DIR, "esbuild.exe")
CLOSURE_VERSION  = "v20240317"
CLOSURE_URL      = f"https://repo1.maven.org/maven2/com/google/javascript/closure-compiler/{CLOSURE_VERSION}/closure-compiler-{CLOSURE_VERSION}.jar"
CLOSURE_JAR      = os.path.join(TOOLS_DIR, "closure-compiler.jar")
BUILD_CACHE_TAG  = "2026-05-28-hash-skip-v1"

# Standard-Pfade fuer den aktuellen Stage-Workflow
JS_DEV_DIR       = os.path.normpath(os.path.join(_WORKSPACE_ROOT, "maps-dev", "tnet", "js"))
JS_OUT_DIR       = os.path.normpath(os.path.join(_WORKSPACE_ROOT, "maps-dev", "tnet", "js-stage"))


def resolve_js_roots(src_path=None, src_root=None, out_root=None):
    """Passende JS-Quell-/Zielwurzeln fuer maps oder maps-dev bestimmen."""
    if src_root or out_root:
        if not src_root or not out_root:
            raise ValueError("--src-root und --out-root muessen gemeinsam angegeben werden")
        return os.path.normpath(src_root), os.path.normpath(out_root)

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


def get_build_state_file(mode):
    """Liefert die State-Datei fuer den Hash-basierten Full-Build-Cache."""
    return os.path.join(_SCRIPT_DIR, f"build_state.{mode}.json")


def load_build_state(mode):
    """Laedt den Build-State fuer den angegebenen Modus."""
    state_path = get_build_state_file(mode)
    if not os.path.isfile(state_path):
        return {}

    try:
        with open(state_path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except Exception:
        return {}

    if not isinstance(data, dict):
        return {}
    return data


def save_build_state(mode, state):
    """Speichert den Hash-State fuer spaetere Full-Builds."""
    state_path = get_build_state_file(mode)
    with open(state_path, "w", encoding="utf-8") as handle:
        json.dump(state, handle, indent=2, sort_keys=True)


def hash_file(path):
    """Berechnet einen stabilen SHA256-Hash fuer eine Datei."""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def get_output_path(src_path, src_root=None, out_root=None):
    """Leitet den JS-Outputpfad aus einer Quelldatei ab."""
    js_dev_dir, js_out_dir = resolve_js_roots(src_path, src_root, out_root)
    rel = os.path.relpath(src_path, js_dev_dir)
    return os.path.join(js_out_dir, rel)


def get_build_fingerprint(mode):
    """Versions-Fingerprint fuer Cache-Invalidierung bei Build-Aenderungen."""
    return f"{BUILD_CACHE_TAG}|mode={mode}|esbuild={ESBUILD_VERSION}|closure={CLOSURE_VERSION}"


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


def ensure_closure_compiler():
    """Closure Compiler JAR herunterladen falls nicht vorhanden."""
    if os.path.isfile(CLOSURE_JAR):
        return True

    os.makedirs(TOOLS_DIR, exist_ok=True)
    print(f"Closure Compiler nicht gefunden - lade herunter ({CLOSURE_URL})...")
    try:
        urllib.request.urlretrieve(CLOSURE_URL, CLOSURE_JAR)
    except Exception as e:
        print(f"[ERR] Download des Closure Compilers fehlgeschlagen: {e}")
        return False

    if os.path.isfile(CLOSURE_JAR):
        print(f"[OK] Closure Compiler heruntergeladen nach {CLOSURE_JAR}")
        return True

    print("[ERR] Closure Compiler nach Download nicht gefunden")
    return False


# ===== BUILD =====

def detect_build_mode(src_path=None):
    """Leitet den Buildmodus aus dem Quellpfad ab, falls kein Modus angegeben wurde."""
    if src_path and f"{os.sep}maps-dev{os.sep}" in os.path.normpath(src_path):
        return "dev"
    return "prod"


def obfuscate_file(src_path, out_path):
    """Obfuskiert eine gebaute JS-Datei fuer PROD via Closure Compiler."""
    if not ensure_closure_compiler():
        return False, "Closure Compiler nicht verfuegbar"

    args = [
        "java",
        "-jar",
        CLOSURE_JAR,
        "--compilation_level",
        "SIMPLE",
        "--warning_level",
        "QUIET",
        "--language_in",
        "ECMASCRIPT_NEXT",
        "--js",
        src_path,
        "--js_output_file",
        out_path,
    ]
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode != 0:
        return False, result.stderr.strip() or result.stdout.strip()
    return True, ""


def is_es_module_source(src_path):
    """Erkennt einfache ES-Modul-Dateien ueber import/export-Statements."""
    try:
        with open(src_path, "r", encoding="utf-8") as handle:
            content = handle.read()
    except Exception:
        return False

    return re.search(r"(^|\n)\s*(import|export)\b", content) is not None


def cleanup_prod_temp_files(js_out_dir):
    """Entfernt liegen gebliebene PROD-Temp-Dateien aus frueheren Builds."""
    removed = 0
    if not os.path.isdir(js_out_dir):
        return removed

    for root, _, files in os.walk(js_out_dir):
        for filename in files:
            if not filename.startswith("tnet-prod-") or not filename.endswith(".js"):
                continue
            path = os.path.join(root, filename)
            try:
                os.remove(path)
                removed += 1
            except Exception:
                pass
    return removed


def build_file(src_path, mode="prod", src_root=None, out_root=None):
    """
    Einzelne Datei bauen.
    DEV bleibt lesbar, PROD wird minifiziert.
    Gibt (ok, bytes_vorher, bytes_nachher, fehlermeldung) zurueck.
    """
    js_dev_dir, js_out_dir = resolve_js_roots(src_path, src_root, out_root)
    rel = os.path.relpath(src_path, js_dev_dir)
    out_path = os.path.join(js_out_dir, rel)

    if os.path.normcase(os.path.abspath(src_path)) == os.path.normcase(os.path.abspath(out_path)):
        return False, os.path.getsize(src_path), 0, "Build-Output entspricht Input-Datei; Abbruch zum Schutz der Quellen"

    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    size_before = os.path.getsize(src_path)
    temp_out_path = out_path

    is_es_module = is_es_module_source(src_path) if mode == "prod" else False

    if mode == "prod":
        fd, temp_out_path = tempfile.mkstemp(prefix="tnet-prod-", suffix=".js", dir=os.path.dirname(out_path))
        os.close(fd)

    args = [
        ESBUILD_EXE,
        src_path,
        "--bundle=false",
        f"--outfile={temp_out_path}",
    ]
    if mode == "prod":
        args.insert(-1, "--minify")

    result = subprocess.run(args, capture_output=True, text=True)

    if result.returncode != 0:
        if mode == "prod" and os.path.isfile(temp_out_path):
            os.remove(temp_out_path)
        return False, size_before, 0, result.stderr.strip()

    if mode == "prod":
        if is_es_module:
            try:
                os.replace(temp_out_path, out_path)
            except Exception as exc:
                return False, size_before, 0, f"Minify-Output konnte nicht uebernommen werden: {exc}"
            size_after = os.path.getsize(out_path)
            return True, size_before, size_after, "nur minifiziert (ES-Modul, keine Einzeldatei-Obfuscation)"

        ok, err = obfuscate_file(temp_out_path, out_path)
        try:
            if os.path.isfile(temp_out_path):
                os.remove(temp_out_path)
        except Exception:
            pass
        if not ok:
            return False, size_before, 0, err

    size_after = os.path.getsize(out_path)
    return True, size_before, size_after, ""


def collect_sources(root):
    """Alle .js Dateien aus root und root/mobile/ (nicht rekursiv tiefer)."""
    files = []
    if not os.path.isdir(root):
        print(f"[WARN] JS-Quellverzeichnis nicht gefunden: {root}")
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


def log_line(message=""):
    """Schreibt eine Zeile sofort sichtbar in die Konsole."""
    print(message, flush=True)


def main():
    parser = argparse.ArgumentParser(
        description="Baut TNET JS-Dateien fuer den Stage-Workflow.\n"
                    "Standard: maps-dev/tnet/js -> maps-dev/tnet/js-stage."
    )
    parser.add_argument("src", nargs="?", help="Optionale Einzeldatei; fuer den Standardworkflow besser --src-root/--out-root verwenden")
    parser.add_argument("--mode", choices=["dev", "prod"], help="Buildmodus: dev ohne Minify, prod mit Minify")
    parser.add_argument("--rebuild-all", action="store_true", help="Ignoriert den Hash-Cache und baut alle Dateien neu")
    parser.add_argument("--src-root", help="Explizites Quellverzeichnis fuer Full-Builds, z.B. maps-dev/tnet/js")
    parser.add_argument("--out-root", help="Explizites Zielverzeichnis fuer Full-Builds, z.B. maps-dev/tnet/js-stage")
    args = parser.parse_args()

    if bool(args.src_root) != bool(args.out_root):
        log_line("[ERR] --src-root und --out-root muessen gemeinsam angegeben werden")
        sys.exit(2)

    if not ensure_esbuild():
        sys.exit(1)

    if args.src:
        # --- Einzeldatei-Build ---
        src = os.path.normpath(args.src)
        js_dev_dir, js_out_dir = resolve_js_roots(src, args.src_root, args.out_root)
        # Pfad darf auch aus js/ kommen → auf die Quellwurzel umleiten
        src = src.replace(js_out_dir + os.sep, js_dev_dir + os.sep)
        if not os.path.isfile(src):
            log_line(f"[ERR] Datei nicht gefunden: {src}")
            sys.exit(1)
        sources = [src]
        mode = args.mode or detect_build_mode(src)
        log_line(f"Einzelbuild ({mode}): {os.path.basename(src)}")
    else:
        # --- Full-Build ---
        mode = args.mode or "prod"
        if args.src_root:
            build_root = os.path.normpath(args.src_root)
            js_out_dir = os.path.normpath(args.out_root)
        else:
            # Standard: maps-dev/tnet/js -> maps-dev/tnet/js-stage
            build_root = JS_DEV_DIR
            js_out_dir = JS_OUT_DIR
        sources = collect_sources(build_root)
        if not sources:
            log_line(f"[ERR] Keine .js-Quelldateien gefunden in: {build_root}")
            sys.exit(1)
        log_line(f"Full-Build ({mode}): {len(sources)} Dateien aus {build_root}")
        if mode == "prod":
            removed_temps = cleanup_prod_temp_files(js_out_dir)
            if removed_temps:
                log_line(f"Temp-Cleanup: {removed_temps} alte tnet-prod-*.js Datei(en) entfernt")
        log_line("")

    ok_count = 0
    err_count = 0
    skipped_count = 0
    total_before = 0
    total_after = 0
    build_state = {}
    state_changed = False
    fingerprint = get_build_fingerprint(mode)

    if not args.src:
        build_state = load_build_state(mode)
        if args.rebuild_all:
            log_line("Hash-Check deaktiviert: kompletter Rebuild erzwungen.")
        else:
            log_line("Hash-Check aktiv: nur geaenderte JS-Dateien werden neu gebaut.")
        log_line("")

    if args.src:
        js_dev_dir_display, js_out_dir_display = resolve_js_roots(
            sources[0], args.src_root, args.out_root
        ) if sources else (JS_DEV_DIR, JS_OUT_DIR)
    else:
        js_dev_dir_display, js_out_dir_display = build_root, js_out_dir

    total_sources = len(sources)

    for index, src in enumerate(sources, start=1):
        rel = os.path.relpath(src, js_dev_dir_display).replace("\\", "/")
        state_key = rel
        src_hash = hash_file(src)
        out_path = get_output_path(src, js_dev_dir_display, js_out_dir_display)

        if not args.src and not args.rebuild_all:
            cached = build_state.get(state_key, {})
            if (
                cached.get("source_hash") == src_hash and
                cached.get("fingerprint") == fingerprint and
                os.path.isfile(out_path)
            ):
                before = os.path.getsize(src)
                after = os.path.getsize(out_path)
                total_before += before
                total_after += after
                skipped_count += 1
                log_line(f"  [{index:02d}/{total_sources:02d}] [SKIP] {rel} (Hash unveraendert)")
                continue

        log_line(f"  [{index:02d}/{total_sources:02d}] Starte {rel}")
        ok, before, after, err = build_file(src, mode, js_dev_dir_display, js_out_dir_display)
        if ok:
            ratio = (1 - after / before) * 100 if before > 0 else 0
            if mode == "prod":
                note = err or f"minifiziert + obfuskiert, {ratio:.0f}% kleiner"
                log_line(f"  [OK] {rel:<45} {before:>7,} -> {after:>7,} bytes  ({note})")
            else:
                log_line(f"  [OK] {rel:<45} {before:>7,} -> {after:>7,} bytes  (lesbar)")
            ok_count += 1
            total_before += before
            total_after += after
            if not args.src:
                build_state[state_key] = {
                    "source_hash": src_hash,
                    "fingerprint": fingerprint,
                }
                state_changed = True
        else:
            log_line(f"  [ERR] {rel} -- {err}")
            err_count += 1

    if len(sources) > 1:
        total_ratio = (1 - total_after / total_before) * 100 if total_before > 0 else 0
        log_line(f"\n{'─'*70}")
        log_line(f"  Gesamt: {ok_count} gebaut, {skipped_count} uebersprungen, {err_count} Fehler")
        log_line(f"  Groesse: {total_before:,} -> {total_after:,} bytes  ({total_ratio:.0f}% kleiner)")

    if not args.src and state_changed and err_count == 0:
        save_build_state(mode, build_state)

    if err_count > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
