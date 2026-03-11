# Split-Screen Visual Guide

## UI Layout

```
┌────────────────────────────────────────────────────────────────┐
│  Header: GIS Daten AG Logo & Tools                            │
├────────────────────────────────────────────────────────────────┤
│ Layers  │                                                      │
│ Panel   │                    MAP AREA                          │
│  (L)    │                                                      │
│         │   ┌──────────────────────────────────────────┐       │
│ ◄►      │   │                                          │ [🔍+] │
│         │   │                                          │ [🔍-] │
│         │   │                                          │       │
│         │   │        SINGLE MAP VIEW                   │ [⊞]  ← Split-Screen Button
│         │   │                                          │       │
│         │   │                                          │       │
│         │   │                                          │       │
│         │   └──────────────────────────────────────────┘       │
└─────────┴────────────────────────────────────────────────────┘
```

## Split-Screen Mode ACTIVATED

```
┌────────────────────────────────────────────────────────────────┐
│  Header: GIS Daten AG Logo & Tools                            │
├────────────────────────────────────────────────────────────────┤
│ Layers  │                                                      │
│ Panel   │              SPLIT SCREEN MODE                       │
│  (L)    │                                                      │
│         │   ┌──────────────────┬─┬──────────────────┐          │
│ ◄►      │   │   KARTE A        │ │   KARTE B        │ [🔍+]   │
│         │   │   ┌────────┐     │║│   ┌────────┐     │ [🔍-]   │
│         │   │   │ Label  │     │║│   │ Label  │     │         │
│         │   │   └────────┘     │║│   └────────┘     │ [⊞]    ← Active Button
│         │   │                  │║│                  │         │
│         │   │   Map Instance 1 │║│ Map Instance 2   │         │
│         │   │   (synchronized) │║│ (synchronized)   │         │
│         │   │                  │║│                  │         │
│         │   │   [🔍+] [🔍-]    │║│   [🔍+] [🔍-]    │         │
│         │   └──────────────────┴─┴──────────────────┘         │
│         │                       ↑                              │
│         │                  Resizable                           │
│         │                   Divider                            │
└─────────┴────────────────────────────────────────────────────┘
```

## Button States

### Normal State (Inactive)
```
┌──────┐
│  ⊞  │  ← White background
└──────┘    Gray icon
            Box shadow
```

### Hover State
```
┌──────┐
│  ⊞  │  ← Light gray background
└──────┘    Slightly larger (scale 1.05)
            Stronger shadow
```

### Active State (Split-Screen ON)
```
┌──────┐
│  ⊞  │  ← Dark teal background (#2c5f6f)
└──────┘    White icon
            Highlighted
```

## Split-Screen Icon (SVG)
```
┌─────┬─────┐
│     │     │
│  A  ║  B  │
│     │     │
└─────┴─────┘
```

## Divider Details

```
Left Panel    Divider    Right Panel
─────────────────────────────────────
    50%      │  4px  │     50%
             │       │
    (flex:1) │  ⋮    │  (flex:1)
             │       │
─────────────────────────────────────
     ◄───────┼───────►
        Draggable
     (20%-80% range)
```

## User Interaction Flow

### 1. Activation
```
Click [⊞] button
    ↓
Creates split layout
    ↓
Initializes Map B
    ↓
Clones layers from Map A
    ↓
Enables synchronization
    ↓
Split-screen active!
```

### 2. Usage
```
Pan on Map A  ──→  Map B follows
Zoom on Map A ──→  Map B follows
Pan on Map B  ──→  Map A follows
Zoom on Map B ──→  Map A follows

Drag divider  ──→  Resize panels
              (20% ← → 80%)
```

### 3. Deactivation
```
Click [⊞] button again
    ↓
Destroys Map B
    ↓
Removes split layout
    ↓
Restores Map A to full width
    ↓
Single map view restored
```

## Responsive Behavior

### Desktop (> 768px)
```
┌─────────────┬─┬─────────────┐
│  Map A      │ │  Map B      │  Full features
│  (50%)      │ │  (50%)      │  Comfortable view
└─────────────┴─┴─────────────┘
```

### Mobile (≤ 768px)
```
┌──────────┬─┬──────────┐
│  Map A   │ │  Map B   │  Smaller button
│  (50%)   │ │  (50%)   │  Reduced labels
└──────────┴─┴──────────┘
```

## Layer Cloning Process

```
Main Map (Map A)
    │
    ├─ Layer 1: Orthofoto (TileWMS)
    ├─ Layer 2: Basisplan (ImageWMS)
    └─ Layer 3: Overlays (XYZ)
    
    ↓ Clone Process ↓
    
Map B (Second Map)
    │
    ├─ Layer 1: Orthofoto (cloned)
    ├─ Layer 2: Basisplan (cloned)
    └─ Layer 3: Overlays (cloned)
```

## Synchronization Mechanism

```
Event on Map A          Debounce (50ms)      Update Map B
─────────────────────────────────────────────────────────
change:center      ───→   Wait 50ms    ───→  setCenter()
change:resolution  ───→   Wait 50ms    ───→  setResolution()

                    ↕ Bidirectional ↕

Event on Map B          Debounce (50ms)      Update Map A
─────────────────────────────────────────────────────────
change:center      ───→   Wait 50ms    ───→  setCenter()
change:resolution  ───→   Wait 50ms    ───→  setResolution()
```

## Code Structure

```
window.TnetSplitScreen
    │
    ├─ enabled: boolean
    ├─ map2: ol.Map instance
    ├─ dividerPosition: number
    │
    ├─ init()
    │   ├─ createSplitLayout()
    │   ├─ initializeMap2()
    │   ├─ setupSynchronization()
    │   └─ setupResizer()
    │
    ├─ disable()
    │   ├─ Remove split wrapper
    │   ├─ Destroy map2
    │   └─ Restore original layout
    │
    ├─ toggle()
    │   └─ Call init() or disable()
    │
    └─ cloneLayer(layer)
        ├─ Check layer type
        ├─ Clone source (with deep copy)
        └─ Return new layer
```

## File Dependencies

```
index_de.htm
    │
    ├─ Includes: tnet-splitscreen.css
    │      └─ Styles for button, panels, divider
    │
    └─ Includes: tnet-splitscreen.js
           ├─ Requires: OpenLayers (ol.js)
           ├─ Requires: DOM (mapContainer, map)
           └─ Exports: window.TnetSplitScreen
                       toggleSplitScreen()
```

## Future Enhancement Ideas

```
Current Implementation
    ↓
    ├─ Independent Layer Selection
    │   └─ Control which layers show on each map
    │
    ├─ Vertical Split
    │   └─ Option for top/bottom layout
    │
    ├─ Quad View
    │   └─ Four maps (2x2 grid)
    │
    ├─ Comparison Presets
    │   └─ Save favorite layer combinations
    │
    └─ Export Feature
        └─ Screenshot both maps together
```

---

**Legend:**
- `[⊞]` = Split-screen button
- `[🔍+]` = Zoom in
- `[🔍-]` = Zoom out
- `│║│` = Resizable divider
- `◄►` = Expandable panel
- `⋮` = Drag handle
