#!/usr/bin/env python3
"""
deploy_env.py
Zentrale Deploy-Konfiguration fuer maps (prod) und maps-dev (dev).

@version    1.0
@date       2026-04-29
@copyright  Trigonet AG
@author     Marco Dellenbach
"""
import argparse
import os


DEFAULT_ENV = "dev"
DEPLOY_ENV_VAR = "TNET_DEPLOY_ENV"
DEPLOY_DIR = os.path.dirname(__file__)
WORKSPACE_ROOT = os.path.normpath(os.path.join(DEPLOY_DIR, "..", "..", ".."))

DEPLOY_TARGETS = {
    "prod": {
        "local_base": os.path.join(WORKSPACE_ROOT, "maps"),
        "remote_base": "/www/maps",
        "state_file": os.path.join(DEPLOY_DIR, "upload_state.prod.json"),
    },
    "dev": {
        "local_base": os.path.join(WORKSPACE_ROOT, "maps-dev"),
        "remote_base": "/www/maps-dev",
        "state_file": os.path.join(DEPLOY_DIR, "upload_state.dev.json"),
    },
    # Multi-Site: geohost/edit deployen nur den tnet/-Ordner.
    # Workflow wie PROD: lokaler Sync (maps-dev/tnet -> site/tnet), dann SFTP-Upload.
    # PHP/HTML auf Root-Ebene werden manuell abgeglichen.
    "geohost": {
        "local_base": os.path.join(WORKSPACE_ROOT, "geohost"),
        "remote_base": "/www/geohost",
        "state_file": os.path.join(DEPLOY_DIR, "upload_state.geohost.json"),
        "scan_subdir": "tnet",
    },
    "edit": {
        "local_base": os.path.join(WORKSPACE_ROOT, "edit"),
        "remote_base": "/www/edit",
        "state_file": os.path.join(DEPLOY_DIR, "upload_state.edit.json"),
        "scan_subdir": "tnet",
    },
}


def add_env_argument(parser):
    """Fuegt den gemeinsamen --env Parameter hinzu."""
    parser.add_argument(
        "--env",
        choices=sorted(DEPLOY_TARGETS.keys()),
        help=(
            "Zielumgebung fuer den Deploy. "
            "Fallback: Umgebungsvariable TNET_DEPLOY_ENV, Standard = dev"
        ),
    )


def resolve_deploy_config(env_name=None):
    """Liefert die aufgeloeste Deploy-Konfiguration fuer dev oder prod."""
    resolved_env = (env_name or os.environ.get(DEPLOY_ENV_VAR) or DEFAULT_ENV).strip().lower()
    if resolved_env not in DEPLOY_TARGETS:
        valid = ", ".join(sorted(DEPLOY_TARGETS.keys()))
        raise ValueError(
            f"Ungueltige Deploy-Umgebung '{resolved_env}'. Erlaubt: {valid}"
        )

    config = dict(DEPLOY_TARGETS[resolved_env])
    config["env"] = resolved_env
    config["workspace_root"] = WORKSPACE_ROOT
    return config


def ensure_local_base_exists(local_base):
    """Stellt sicher, dass der lokale Source-Tree fuer die Umgebung existiert."""
    if os.path.isdir(local_base):
        return
    raise FileNotFoundError(
        "Lokaler Source-Tree nicht gefunden: "
        f"{local_base}. Lege den Ordner fuer die Zielumgebung zuerst an."
    )