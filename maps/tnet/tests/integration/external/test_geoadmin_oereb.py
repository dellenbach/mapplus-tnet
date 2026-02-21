from __future__ import annotations

import math

import pytest

from helpers.http_client import get_json


def polygon_area(coords: list[list[float]]) -> float:
    area = 0.0
    count = len(coords)
    for index in range(count):
        next_index = (index + 1) % count
        area += coords[index][0] * coords[next_index][1]
        area -= coords[next_index][0] * coords[index][1]
    return abs(area) / 2


@pytest.mark.external
def test_geoadmin_identify_returns_results_for_reference_point(run_external: bool) -> None:
    if not run_external:
        pytest.skip("Externe Tests deaktiviert (TNET_RUN_EXTERNAL nicht gesetzt).")

    response = get_json(
        "https://api3.geo.admin.ch/rest/services/ech/MapServer/identify",
        params={
            "geometryType": "esriGeometryPoint",
            "geometry": "2661200,1196800",
            "tolerance": 50,
            "layers": "all:ch.kantone.cadastralwebmap-farbe",
            "returnGeometry": "true",
            "sr": 2056,
            "geometryFormat": "geojson",
            "imageDisplay": "1000,1000,96",
            "mapExtent": "2660000,1196000,2662000,1198000",
        },
        timeout=30,
    )
    assert response.status == 200

    payload = response.json()
    results = payload.get("results", [])
    assert len(results) >= 1


@pytest.mark.external
def test_geoadmin_result_contains_expected_keys(run_external: bool) -> None:
    if not run_external:
        pytest.skip("Externe Tests deaktiviert (TNET_RUN_EXTERNAL nicht gesetzt).")

    payload = get_json(
        "https://api3.geo.admin.ch/rest/services/ech/MapServer/identify",
        params={
            "geometryType": "esriGeometryPoint",
            "geometry": "2661200,1196800",
            "tolerance": 0,
            "layers": "all:ch.kantone.cadastralwebmap-farbe",
            "returnGeometry": "false",
            "sr": 2056,
        },
        timeout=30,
    ).json()

    results = payload.get("results", [])
    assert len(results) >= 1

    attrs = results[0].get("attributes", {})
    for key in ("egris_egrid", "number", "identnd", "ak"):
        assert key in attrs


@pytest.mark.external
def test_geoadmin_polygon_area_calculation_is_positive(run_external: bool) -> None:
    if not run_external:
        pytest.skip("Externe Tests deaktiviert (TNET_RUN_EXTERNAL nicht gesetzt).")

    payload = get_json(
        "https://api3.geo.admin.ch/rest/services/ech/MapServer/identify",
        params={
            "geometryType": "esriGeometryPoint",
            "geometry": "2661200,1196800",
            "tolerance": 50,
            "layers": "all:ch.kantone.cadastralwebmap-farbe",
            "returnGeometry": "true",
            "sr": 2056,
            "geometryFormat": "geojson",
            "imageDisplay": "1000,1000,96",
            "mapExtent": "2660000,1196000,2662000,1198000",
        },
        timeout=30,
    ).json()

    results = payload.get("results", [])
    if not results:
        pytest.skip("Keine Resultate von geo.admin erhalten.")

    first = results[0]
    geometry = first.get("geometry", {})
    if geometry.get("type") != "Polygon":
        pytest.skip("Erstes Resultat enthält keine Polygon-Geometrie.")

    ring = geometry.get("coordinates", [[]])[0]
    if len(ring) < 3:
        pytest.skip("Polygon enthält zu wenig Koordinaten.")

    area = polygon_area(ring)
    assert math.isfinite(area)
    assert area > 0
