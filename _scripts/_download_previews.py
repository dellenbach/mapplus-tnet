#!/usr/bin/env python3
"""
Download basemap preview images – identical extent for all basemaps.

Workflow per basemap:
  1. Define a fixed bounding box (same for all) around a center point
  2. Calculate which tiles cover that bbox
  3. Download all needed tiles
  4. Stitch tiles into a single image
  5. Crop to the exact bbox
  6. Resize to a uniform preview size
"""
import urllib.request
import xml.etree.ElementTree as ET
import math
import os
import ssl
import io
from PIL import Image

# ── Target ──
# Buochs / Ennetbürgen  (LV95 EPSG:2056)
CENTER_E = 2668160
CENTER_N = 1203452

# Extent: how many meters the preview covers (width × height)
EXTENT_W = 3000   # 3 km wide
EXTENT_H = 2000   # 2 km tall

# Final preview image size
PREVIEW_W = 320
PREVIEW_H = 160

# Bounding box
BBOX_MIN_E = CENTER_E - EXTENT_W / 2
BBOX_MAX_E = CENTER_E + EXTENT_W / 2
BBOX_MIN_N = CENTER_N - EXTENT_H / 2
BBOX_MAX_N = CENTER_N + EXTENT_H / 2

OUTPUT_DIR = r"c:\_Daten\mapplus-exp\maps\tnet\resources"

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE


def download_tile(url):
    """Download a single tile and return as PIL Image, or None on failure."""
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        resp = urllib.request.urlopen(req, timeout=15, context=ctx)
        data = resp.read()
        if len(data) > 200:
            return Image.open(io.BytesIO(data)).convert('RGBA')
    except Exception as e:
        print(f"    ✗ tile error: {e}")
    return None


def stitch_and_crop(origin_x, origin_y, res, tile_px, url_fn, out_name):
    """
    Download tiles covering the bbox, stitch, crop to exact bbox, resize.
    """
    span = res * tile_px  # meters per tile

    # Calculate tile range covering the bbox
    col_min = int(math.floor((BBOX_MIN_E - origin_x) / span))
    col_max = int(math.floor((BBOX_MAX_E - origin_x) / span))
    row_min = int(math.floor((origin_y - BBOX_MAX_N) / span))
    row_max = int(math.floor((origin_y - BBOX_MIN_N) / span))

    cols = col_max - col_min + 1
    rows = row_max - row_min + 1

    print(f"    Tiles: {cols}×{rows} (cols {col_min}–{col_max}, rows {row_min}–{row_max})")

    # Create stitched image
    stitched = Image.new('RGBA', (cols * tile_px, rows * tile_px), (255, 255, 255, 255))

    ok = 0
    for r in range(row_min, row_max + 1):
        for c in range(col_min, col_max + 1):
            url = url_fn(c, r)
            tile = download_tile(url)
            if tile:
                px_x = (c - col_min) * tile_px
                px_y = (r - row_min) * tile_px
                stitched.paste(tile, (px_x, px_y))
                ok += 1

    if ok == 0:
        print(f"    ✗ No tiles downloaded for {out_name}")
        return False

    # Calculate pixel coordinates of bbox within the stitched image
    stitch_min_e = origin_x + col_min * span
    stitch_max_n = origin_y - row_min * span

    px_left   = int((BBOX_MIN_E - stitch_min_e) / res)
    px_top    = int((stitch_max_n - BBOX_MAX_N) / res)
    px_right  = int((BBOX_MAX_E - stitch_min_e) / res)
    px_bottom = int((stitch_max_n - BBOX_MIN_N) / res)

    # Clamp to image bounds
    px_left   = max(0, px_left)
    px_top    = max(0, px_top)
    px_right  = min(stitched.width, px_right)
    px_bottom = min(stitched.height, px_bottom)

    # Crop
    cropped = stitched.crop((px_left, px_top, px_right, px_bottom))

    # Resize to uniform preview size
    preview = cropped.resize((PREVIEW_W, PREVIEW_H), Image.LANCZOS)

    # Save as RGB PNG
    preview_rgb = Image.new('RGB', preview.size, (255, 255, 255))
    preview_rgb.paste(preview, mask=preview.split()[3] if preview.mode == 'RGBA' else None)

    filepath = os.path.join(OUTPUT_DIR, out_name)
    preview_rgb.save(filepath, 'PNG', optimize=True)
    size = os.path.getsize(filepath)
    print(f"    ✓ {out_name} ({size:,} bytes, {PREVIEW_W}×{PREVIEW_H}px)")
    return True


def parse_wmts_grid(capabilities_url, matrixset_name, target_zoom):
    """Parse WMTS capabilities to get grid parameters."""
    try:
        req = urllib.request.Request(capabilities_url, headers={'User-Agent': 'Mozilla/5.0'})
        resp = urllib.request.urlopen(req, timeout=15, context=ctx)
        xml_data = resp.read()
    except Exception as e:
        print(f"    ✗ Cannot fetch capabilities: {e}")
        return None

    root = ET.fromstring(xml_data)
    ns = {
        'wmts': 'http://www.opengis.net/wmts/1.0',
        'ows': 'http://www.opengis.net/ows/1.1'
    }

    for tms in root.findall('.//wmts:TileMatrixSet', ns):
        ident = tms.find('ows:Identifier', ns)
        if ident is not None and ident.text == matrixset_name:
            for tm in tms.findall('wmts:TileMatrix', ns):
                tm_id = tm.find('ows:Identifier', ns)
                if tm_id is not None and tm_id.text == target_zoom:
                    scale_denom = float(tm.find('wmts:ScaleDenominator', ns).text)
                    top_left = tm.find('wmts:TopLeftCorner', ns).text.split()
                    tile_w = int(tm.find('wmts:TileWidth', ns).text)
                    res = scale_denom * 0.00028
                    origin_x = float(top_left[0])
                    origin_y = float(top_left[1])
                    return origin_x, origin_y, res, tile_w
    return None


# ═══════════════════════════════════════════════════════════════
print(f"Center: E {CENTER_E}, N {CENTER_N}")
print(f"Bbox: E {BBOX_MIN_E:.0f}–{BBOX_MAX_E:.0f}, N {BBOX_MIN_N:.0f}–{BBOX_MAX_N:.0f}")
print(f"Extent: {EXTENT_W}×{EXTENT_H}m, Preview: {PREVIEW_W}×{PREVIEW_H}px\n")

# ── Swisstopo grid params ──
ST_OX = 2420000.0
ST_OY = 1350000.0
ST_RES = 10.0       # zoom level 20
ST_TPX = 256
ST_Z = 20
base = "https://wmts.geo.admin.ch/1.0.0"

# 1) Swissimage
print("1) Swissimage (Orthofoto)")
stitch_and_crop(ST_OX, ST_OY, ST_RES, ST_TPX,
    lambda c, r: f"{base}/ch.swisstopo.swissimage/default/current/2056/{ST_Z}/{c}/{r}.jpeg",
    "preview-swissimage.png")

# 2) Landeskarte
print("2) Landeskarte (Zeitreihen 2020)")
stitch_and_crop(ST_OX, ST_OY, ST_RES, ST_TPX,
    lambda c, r: f"{base}/ch.swisstopo.zeitreihen/default/20201231/2056/{ST_Z}/{c}/{r}.png",
    "preview-landeskarte.png")

# 3) Siegfriedkarte
print("3) Siegfriedkarte (1900)")
stitch_and_crop(ST_OX, ST_OY, ST_RES, ST_TPX,
    lambda c, r: f"{base}/ch.swisstopo.hiks-siegfried/default/1900/2056/{ST_Z}/{c}/{r}.png",
    "preview-siegfried.png")

# 4) Dufourkarte
print("4) Dufourkarte")
stitch_and_crop(ST_OX, ST_OY, ST_RES, ST_TPX,
    lambda c, r: f"{base}/ch.swisstopo.hiks-dufour/default/current/2056/{ST_Z}/{c}/{r}.png",
    "preview-dufour.png")

# 5) swissTLM
print("5) swissTLM (nodi.swiss)")
grid = parse_wmts_grid("https://nodi.swiss/mapproxy/wmts/1.0.0/WMTSCapabilities.xml", "schweiz", "07")
if grid:
    ox, oy, res, tpx = grid
    print(f"    Grid: origin=({ox}, {oy}), res={res:.4f} m/px")
    stitch_and_crop(ox, oy, res, tpx,
        lambda c, r: f"https://nodi.swiss/mapproxy/wmts/swisstlm/schweiz/07/{c}/{r}.png",
        "preview-swisstlm.png")

# 6) OSM
print("6) OSM (ts5.mapplus.ch)")
grid = parse_wmts_grid("https://ts5.mapplus.ch/mapproxy/wmts/1.0.0/WMTSCapabilities.xml", "eur_2025", "07")
if grid:
    ox, oy, res, tpx = grid
    print(f"    Grid: origin=({ox}, {oy}), res={res:.4f} m/px")
    stitch_and_crop(ox, oy, res, tpx,
        lambda c, r: f"https://ts5.mapplus.ch/mapproxy/wmts/osm_eur_2025/eur_2025/07/{c}/{r}.png",
        "preview-osm.png")

print("\n✓ Fertig! Alle Vorschaubilder zeigen denselben Ausschnitt.")
