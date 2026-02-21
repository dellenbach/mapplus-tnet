from __future__ import annotations

from helpers.http_client import get_json


def test_scan_manifests_returns_valid_payload(tnet_base_url: str) -> None:
    response = get_json(f"{tnet_base_url}/scan-manifests.php")
    assert response.status == 200

    payload = response.json()
    assert payload.get("source") == "scan-manifests.php"
    assert isinstance(payload.get("templates"), list)
    assert payload.get("count") == len(payload.get("templates", []))
    assert isinstance(payload.get("errors"), list)


def test_scan_manifests_template_shape(tnet_base_url: str) -> None:
    payload = get_json(f"{tnet_base_url}/scan-manifests.php").json()
    templates = payload.get("templates", [])

    if not templates:
        return

    first = templates[0]
    assert isinstance(first, dict)
    assert "_manifestFile" in first
