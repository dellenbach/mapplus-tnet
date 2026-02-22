#!/usr/bin/env python3
"""Test if loader.php serves modules_m.conf correctly"""
import urllib.request
import json

# Test: loader.php with modules_m.conf params
url = "https://nwow.mapplus.ch/maps/loader.php?f=/config/modules_m.conf&p=public&g=public"
print(f"Fetching: {url}")

try:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = resp.read().decode('utf-8')
        print(f"Status: {resp.status}")
        print(f"Content-Type: {resp.headers.get('Content-Type')}")
        print(f"Length: {len(data)} bytes")
        print(f"\nRaw response (first 500 chars):")
        print(data[:500])
        
        # Try parsing as JSON
        try:
            parsed = json.loads(data)
            print(f"\nParsed JSON keys: {list(parsed.keys())}")
            if 'defmodules' in parsed:
                print(f"defmodules: {parsed['defmodules']}")
            else:
                print("WARNING: 'defmodules' NOT FOUND!")
        except json.JSONDecodeError as e:
            print(f"\nJSON parse error: {e}")
except Exception as e:
    print(f"Error: {e}")

# Also test the desktop version for comparison
print("\n" + "="*60)
url2 = "https://nwow.mapplus.ch/maps/loader.php?f=/config/modules.conf&p=public&g=public"
print(f"Fetching: {url2}")

try:
    req = urllib.request.Request(url2, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = resp.read().decode('utf-8')
        print(f"Status: {resp.status}")
        print(f"Length: {len(data)} bytes")
        parsed = json.loads(data)
        print(f"Parsed JSON keys: {list(parsed.keys())}")
        if 'defmodules' in parsed:
            print(f"defmodules: {parsed['defmodules']}")
except Exception as e:
    print(f"Error: {e}")
