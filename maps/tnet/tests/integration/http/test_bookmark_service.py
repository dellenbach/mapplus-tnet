from __future__ import annotations

from helpers.http_client import get_json


def test_bookmark_service_lists_names(tnet_base_url: str) -> None:
    response = get_json(f"{tnet_base_url}/bookmark-service.php")
    assert response.status == 200

    payload = response.json()
    assert payload.get("success") is True
    assert isinstance(payload.get("available_bookmarks"), list)
    assert isinstance(payload.get("count"), int)


def test_bookmark_service_unknown_name_returns_error_payload(tnet_base_url: str) -> None:
    response = get_json(
        f"{tnet_base_url}/bookmark-service.php",
        params={"name": "__pytest_unknown_bookmark__"},
    )
    assert response.status == 200

    payload = response.json()
    assert payload.get("success") is False
    assert payload.get("error") == "Bookmark not found"


def test_bookmark_service_resolves_at_least_one_listed_name(tnet_base_url: str) -> None:
    listing = get_json(f"{tnet_base_url}/bookmark-service.php").json()
    names = listing.get("available_bookmarks") or []

    if not names:
        return

    resolved = None
    for name in names[:20]:
        candidate = get_json(f"{tnet_base_url}/bookmark-service.php", params={"name": name}).json()
        if candidate.get("success") is True and isinstance(candidate.get("bookmark"), dict):
            resolved = candidate
            break

    assert resolved is not None
    assert "bookmark" in resolved
    assert "map-bookmark" in resolved["bookmark"]
