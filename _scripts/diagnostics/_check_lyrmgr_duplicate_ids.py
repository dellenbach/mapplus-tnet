#!/usr/bin/env python3
"""Prueft lyrmgr.conf auf doppelte IDs (Container vs. Blatt-Layer)."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional


@dataclass
class Occurrence:
    """Ein ID-Vorkommen im Baum."""

    kind: str  # "container" oder "leaf"
    path: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Prueft lyrmgr-Konfigurationen auf IDs, die sowohl als "
            "Strukturknoten (Container) als auch als Blatt-Layer auftreten."
        )
    )
    parser.add_argument(
        "--root",
        action="append",
        default=["maps-dev/public/config", "maps/public/config"],
        help=(
            "Wurzelverzeichnis fuer die Suche nach lyrmgr.conf "
            "(mehrfach verwendbar)."
        ),
    )
    parser.add_argument(
        "--pattern",
        default="**/lyrmgr.conf",
        help="Glob-Pattern relativ zur Root (Standard: **/lyrmgr.conf).",
    )
    return parser.parse_args()


def load_json_file(path: Path) -> Optional[Dict[str, Any]]:
    try:
        text = path.read_text(encoding="utf-8-sig")
    except OSError as exc:
        print(f"[WARN] Datei nicht lesbar: {path} ({exc})")
        return None

    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        print(f"[WARN] Ungueltiges JSON in {path}: {exc}")
        return None

    if not isinstance(data, dict):
        print(f"[WARN] Unerwartete Struktur (kein Objekt) in {path}")
        return None
    return data


def iter_lyrmgr_files(roots: Iterable[str], pattern: str) -> List[Path]:
    files: List[Path] = []
    for root_str in roots:
        root = Path(root_str)
        if not root.exists():
            print(f"[WARN] Root fehlt: {root}")
            continue
        files.extend(sorted(root.glob(pattern)))
    return sorted(set(files))


def add_occurrence(
    registry: Dict[str, List[Occurrence]],
    node_id: Optional[str],
    kind: str,
    path_parts: List[str],
) -> None:
    if not node_id:
        return
    clean_id = str(node_id).strip()
    if not clean_id:
        return
    path = " / ".join(path_parts) if path_parts else "(root)"
    registry.setdefault(clean_id, []).append(Occurrence(kind=kind, path=path))


def walk_items(
    items: Any,
    registry: Dict[str, List[Occurrence]],
    path_parts: List[str],
) -> None:
    # Fall 1: Dict-Schema (key -> nodeDef), typisch in lyrmgr.conf
    if isinstance(items, dict):
        for key, value in items.items():
            if isinstance(value, dict):
                node_id = value.get("name") or str(key)
                child_items = value.get("items")
                has_children = bool(child_items)
                node_kind = "container" if has_children else "leaf"
                add_occurrence(registry, node_id, node_kind, path_parts + [str(node_id)])
                if has_children:
                    walk_items(child_items, registry, path_parts + [str(node_id)])
            elif isinstance(value, list):
                node_id = str(key)
                add_occurrence(registry, node_id, "container", path_parts + [node_id])
                walk_items(value, registry, path_parts + [node_id])
            elif isinstance(value, str):
                add_occurrence(registry, value, "leaf", path_parts + [str(key), value])
        return

    # Fall 2: List-Schema (Strings oder Objektknoten)
    if isinstance(items, list):
        for entry in items:
            if isinstance(entry, str):
                add_occurrence(registry, entry, "leaf", path_parts + [entry])
            elif isinstance(entry, dict):
                node_id = entry.get("name")
                child_items = entry.get("items")
                if node_id:
                    has_children = bool(child_items)
                    node_kind = "container" if has_children else "leaf"
                    add_occurrence(registry, node_id, node_kind, path_parts + [str(node_id)])
                if child_items:
                    walk_items(child_items, registry, path_parts + ([str(node_id)] if node_id else []))


def collect_occurrences(doc: Dict[str, Any]) -> Dict[str, List[Occurrence]]:
    registry: Dict[str, List[Occurrence]] = {}
    for mgr_name, mgr_conf in doc.items():
        if not isinstance(mgr_conf, dict):
            continue
        structure = mgr_conf.get("structure")
        if not isinstance(structure, dict):
            continue

        for category_id, category_conf in structure.items():
            if isinstance(category_conf, dict):
                items = category_conf.get("items")
            else:
                items = None
            base_path = [str(mgr_name), str(category_id)]
            if items:
                walk_items(items, registry, base_path)
    return registry


def find_conflicts(registry: Dict[str, List[Occurrence]]) -> Dict[str, List[Occurrence]]:
    conflicts: Dict[str, List[Occurrence]] = {}
    for node_id, occs in registry.items():
        kinds = {o.kind for o in occs}
        if "container" in kinds and "leaf" in kinds:
            conflicts[node_id] = occs
    return conflicts


def main() -> int:
    args = parse_args()
    files = iter_lyrmgr_files(args.root, args.pattern)

    if not files:
        print("Keine lyrmgr.conf Dateien gefunden.")
        return 2

    overall_conflicts = 0
    print(f"Gefundene Dateien: {len(files)}")

    for conf_file in files:
        doc = load_json_file(conf_file)
        if doc is None:
            continue

        registry = collect_occurrences(doc)
        conflicts = find_conflicts(registry)

        if not conflicts:
            print(f"[OK] {conf_file}: keine Container/Leaf-ID-Konflikte")
            continue

        overall_conflicts += len(conflicts)
        print("\n" + "=" * 80)
        print(f"[FAIL] {conf_file}")
        print(f"Konflikte: {len(conflicts)}")

        for node_id in sorted(conflicts):
            print(f"\n  ID: {node_id}")
            occs = conflicts[node_id]
            containers = [o for o in occs if o.kind == "container"]
            leaves = [o for o in occs if o.kind == "leaf"]

            print("    Container:")
            for occ in containers[:5]:
                print(f"      - {occ.path}")
            if len(containers) > 5:
                print(f"      - ... (+{len(containers) - 5} weitere)")

            print("    Leaf:")
            for occ in leaves[:5]:
                print(f"      - {occ.path}")
            if len(leaves) > 5:
                print(f"      - ... (+{len(leaves) - 5} weitere)")

    print("\n" + "=" * 80)
    if overall_conflicts > 0:
        print(f"Ergebnis: FAIL ({overall_conflicts} Konflikt-IDs)")
        return 1

    print("Ergebnis: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
