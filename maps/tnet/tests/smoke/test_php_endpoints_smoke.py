from __future__ import annotations

import pytest

from helpers.http_client import get_json


@pytest.mark.smoke
@pytest.mark.parametrize(
    "endpoint,params",
    [
        ("bookmark-service.php", None),
        ("scan-manifests.php", None),
        ("lyrmgr-to-json.php", None),
        ("active-maps-proxy.php", {"group": "nw"}),
    ],
)
def test_php_endpoint_is_reachable(tnet_base_url: str, endpoint: str, params: dict | None) -> None:
    response = get_json(f"{tnet_base_url}/{endpoint}", params=params, timeout=30)

    if endpoint == "active-maps-proxy.php":
        assert response.status in {200, 502}
    else:
        assert response.status == 200


@pytest.mark.smoke
def test_lyrmgr_to_json_has_categories(tnet_base_url: str) -> None:
    response = get_json(f"{tnet_base_url}/lyrmgr-to-json.php", timeout=30)
    assert response.status == 200

    payload = response.json()
    assert "categories" in payload
    assert isinstance(payload["categories"], list)
