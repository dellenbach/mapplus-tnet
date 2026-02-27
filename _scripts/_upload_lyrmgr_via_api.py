#!/usr/bin/env python3
"""Upload lyrmgr.conf to server via HTTP publish-lyrmgr API (no SFTP needed)"""
import json
import urllib.request

API_URL = "https://nwow.mapplus.ch/maps/tnet/api/v1/treebuilder-api.php"
LOCAL_FILE = r"c:\_Daten\mapplus-exp\maps\public\config\lyrmgr.conf"
PROFILE = "public"
EDITOR = "upload-script"

def main():
    print(f"Lese {LOCAL_FILE}...")
    with open(LOCAL_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)

    keys = list(data.keys())
    print(f"Gefunden: {len(keys)} lyrmgr-Blöcke: {', '.join(keys)}")

    for key in keys:
        block = data[key]
        payload = json.dumps({
            "profile": PROFILE,
            "lyrmgrKey": key,
            "data": block,
            "editor": EDITOR
        }).encode('utf-8')

        req = urllib.request.Request(
            API_URL + "?action=publish-lyrmgr",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST"
        )

        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                result = json.loads(resp.read().decode('utf-8'))
                if result.get("success") and result.get("data", {}).get("published"):
                    d = result["data"]
                    print(f"  ✓ {key}: {d.get('bytes', '?')} bytes → {d.get('path', '?')}")
                else:
                    print(f"  ✗ {key}: {result}")
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8', errors='replace')
            print(f"  ✗ {key}: HTTP {e.code} — {body[:500]}")
        except Exception as e:
            print(f"  ✗ {key}: {e}")

    # Verify
    print("\nVerifiziere Profile...")
    req2 = urllib.request.Request(API_URL + "?action=list-lyrmgr-profiles")
    with urllib.request.urlopen(req2, timeout=15) as resp:
        result = json.loads(resp.read().decode('utf-8'))
        profiles = result.get("data", [])
        for p in profiles:
            print(f"  → {p['profile']}: {len(p.get('lyrmgrKeys', []))} LM, {p.get('size', '?')} bytes, {p.get('modified', '?')}")
        if not profiles:
            print("  ⚠ Keine Profile gefunden!")

    print("Fertig.")

if __name__ == "__main__":
    main()
