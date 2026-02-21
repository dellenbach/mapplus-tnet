from __future__ import annotations

from helpers.http_client import get_text


def test_active_maps_proxy_nw_returns_html_or_gateway_error(tnet_base_url: str) -> None:
    response = get_text(
        f"{tnet_base_url}/active-maps-proxy.php",
        params={"group": "nw"},
        timeout=30,
    )

    assert response.status in {200, 502}

    if response.status == 200:
        html = response.text.lower()
        assert "<html" in html
        assert "tnet-mapplus-helpers.js" in html or "header removed by proxy" in html
