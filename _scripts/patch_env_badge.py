#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
patch_env_badge.py
Robuste DEV/PROD-Anzeige: data-env im <head>, CSS-gesteuert.
"""

base = r"c:\_Daten\mapplus-exp\maps-dev\tnet\api\v1"

HEAD_SCRIPT = """<script>document.documentElement.setAttribute('data-env',location.pathname.indexOf('/maps-dev/')===0?'dev':'prod');</script>"""

CSS_BLOCK = """\r\n/* ===== ENV-BADGE (DEV / PROD) ===== */\r\n#env-badge { display: none; }\r\nhtml[data-env] #env-badge {\r\n  display: inline-block !important;\r\n  color: #fff; padding: 2px 10px; border-radius: 3px;\r\n  font-size: 12px; font-weight: 700; letter-spacing: .6px;\r\n  vertical-align: middle;\r\n}\r\nhtml[data-env="dev"] #env-badge { background: #e67e22; }\r\nhtml[data-env="dev"] #env-badge::before { content: 'DEV'; }\r\nhtml[data-env="prod"] #env-badge { background: #2e7d32; }\r\nhtml[data-env="prod"] #env-badge::before { content: 'PROD'; }\r\nhtml[data-env="dev"] .ags-toolbar { border-bottom: 3px solid #e67e22; }\r\n"""

OLD_BADGE = 'id="env-badge" style="display:none;color:#fff;padding:2px 10px;border-radius:3px;font-size:12px;font-weight:700;letter-spacing:.6px;margin-left:6px;vertical-align:middle"'
NEW_BADGE = 'id="env-badge"'

IIFE_MARKER = "var isDev = location.pathname.indexOf('/maps-dev/') === 0;"

for fn in ["slm.html", "ags-import.html"]:
    fpath = base + "\\" + fn
    with open(fpath, "r", encoding="utf-8") as fh:
        c = fh.read()

    changed = []

    # A: <script>data-env</script> vor erstem <style>
    if "data-env" not in c:
        c = c.replace("<style>", HEAD_SCRIPT + "\r\n<style>", 1)
        changed.append("A:head-script")

    # B: CSS-Block am Ende des ersten </style>
    if "ENV-BADGE" not in c:
        idx = c.index("</style>")
        c = c[:idx] + CSS_BLOCK + "</style>" + c[idx + len("</style>"):]
        changed.append("B:css")

    # C: Badge-Span: inline-style entfernen
    if OLD_BADGE in c:
        c = c.replace(f'<span {OLD_BADGE}></span>', f'<span {NEW_BADGE}></span>')
        changed.append("C:badge-cleaned")

    # D: Altes IIFE am Ende entfernen
    if IIFE_MARKER in c:
        idx = c.index(IIFE_MARKER)
        start = c.rfind("<script>", 0, idx)
        end = c.index("</script>", idx) + len("</script>")
        if start >= 0:
            c = c[:start] + c[end:]
            changed.append("D:iife-removed")

    with open(fpath, "w", encoding="utf-8") as fh:
        fh.write(c)

    status = ", ".join(changed) if changed else "keine Änderungen nötig"
    print(f"[{fn}] {status}")

print("Fertig.")
