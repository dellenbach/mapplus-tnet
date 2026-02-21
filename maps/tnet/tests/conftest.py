from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest


TESTS_ROOT = Path(__file__).resolve().parent
if str(TESTS_ROOT) not in sys.path:
    sys.path.insert(0, str(TESTS_ROOT))


def _normalize_base_url(raw: str) -> str:
    value = raw.strip().rstrip("/")
    if value.endswith("/php"):
        return value
    return f"{value}/php"


@pytest.fixture(scope="session")
def tnet_base_url() -> str:
    raw = os.getenv("TNET_BASE_URL", "").strip()
    if not raw:
        pytest.skip("TNET_BASE_URL ist nicht gesetzt; lokale PHP-Integrationstests werden übersprungen.")
    return _normalize_base_url(raw)


@pytest.fixture(scope="session")
def tests_root() -> Path:
    return TESTS_ROOT


@pytest.fixture(scope="session")
def run_external() -> bool:
    return os.getenv("TNET_RUN_EXTERNAL", "").strip() in {"1", "true", "yes", "on"}
