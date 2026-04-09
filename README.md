
# Crusader No Remorse Map Extractor (and Viewer)



https://github.com/user-attachments/assets/89da3316-1da5-4bcd-a6a5-c85141708cad



## Used for reference / Credits / Special Thanks

- https://github.com/dascandy/cnr
- https://github.com/scummvm/scummvm

## Inspiration

- https://www.vgmaps.com/

# Disclaimers

-  Vibe coded with mostly Opus 4.x. Commit messages, steering, and testing were me. Commit history might be useful to see pitfalls.

- Might work with other games in the Ultima 8 family (like Crusader: No Regret), but I did not test.

- I make no garuntees about anything in this or about maintaining it. Feel free to fork!
  
---

# Overview

Renders *Crusader: No Remorse* game data files into high-resolution PNG map images using accurate isometric projection. Extracts and processes FLX archives, shape graphics, FIXED.DAT maps, GLOB prefabs, palettes, and type flags. Produces optimized tiled output for large maps with an interactive web viewer.

## Setup

```bash
npm install
npm run build  # Compiles TypeScript + builds web client
```

**Requirements:**
- Node.js 18+
- Game data from Crusader: No Remorse (GOG version recommended)
- Game files should be at `gog/Crusader No Remorse/` or specify with `--input-data-dir`

## Quick Start

**Web Interface (Recommended):**
```bash
npm run serve
# Open http://localhost:3000 in your browser
```

Interactive viewer with on-demand rendering, level selection, floor filtering, and scale controls. Renders are cached for fast loading.

**Command Line:**
```bash
# Quick demo renders
npm run demo:overview  # Mission 1 at 0.25× scale
npm run demo:zoomed    # Cropped area of mission 1

# Export all 15 missions + rebel bases
npm run export-all
```

## Commands

### Serve web interface

```bash
node dist/index.js serve --input-data-dir=<path> [--port=3000]
```

Starts Express server with interactive level viewer. Supports on-demand rendering with caching, floor filtering, and scale adjustment.

### Render a level

```
node dist/index.js render-level --input-data-dir=<path> --level=<1-15> [options]
```

| Option | Description |
|---|---|
| `--input-data-dir <path>` | Path to Crusader game directory (containing `STATIC/`) |
| `--level <number>` | Mission number (1-15) |
| `--floor <number>` | Filter to a specific floor (0, 1, 2...) |
| `--output <path>` | Output PNG path (default: `out.png`) |
| `--scale <number>` | Scale factor (default: 1.0, use 0.25 or 0.5 for smaller output) |
| `--raw-index` | Treat `--level` as raw FIXED.DAT index instead of mission number |
| `--bg <color>` | Background color hex (default: `#000000`) |

Large images (>1.5GB raw RGBA) are automatically tiled into 4096×4096 tiles with a `viewer.html` for pan+zoom navigation.

**Examples:**

```bash
# Render mission 1 at quarter scale
node dist/index.js render-level --input-data-dir="gog/Crusader No Remorse" --level=1 --scale=0.25 --output=mission1.png

# Render mission 1 floor 0 only
node dist/index.js render-level --input-data-dir="gog/Crusader No Remorse" --level=1 --floor=0 --output=m1f0.png
```

### Render a cropped area

```
node dist/index.js render-area --input-data-dir=<path> --level=<1-15> --x=<n> --y=<n> --width=<n> --height=<n> [--output=<path>]
```

Renders a specific rectangular region of a map (coordinates in native pixels).

### Render a shape

```
node dist/index.js render-shape --input-data-dir=<path> --shape=<number> [--frame=<number>] [--output=<path>]
```

Renders a single shape sprite (all frames or a specific frame) from `SHAPES.FLX`.

### Dump all shapes

```
node dist/index.js dump-shapes --input-data-dir=<path> [--output-dir=<path>] [--start=<n>] [--end=<n>]
```

Exports all shape frames as individual PNG files.

### Info

```
node dist/index.js info --input-data-dir=<path>
```

Displays summary of available maps, shapes, type flags, and mission mappings.

### Inspect map

```
node dist/index.js inspect-map --input-data-dir=<path> --level=<number> [--raw-index]
```

Shows map statistics (item counts, Z-level distribution, coordinate ranges, shape usage) without rendering.

### Export all missions

```
node dist/index.js export-all --input-data-dir=<path> --output-dir=<path> [--scale=0.25]
```

Batch renders all 15 missions plus rebel base maps.

## Features

- **Accurate isometric projection** — 2:1 diamond projection matching the game engine
- **Painter's algorithm depth sorting** — Faithfully implements ScummVM's `SortItem::below()` logic with dependency graph + topological sort. Handles sprite/non-sprite separation, Z-levels, overlaps, and isometric diamond normals for correct paint order.
- **Missions 1-15** — Correct GOG FIXED.DAT index mapping, including multi-floor levels
- **Glob prefab expansion** — Automatically expands shape family 3 eggs into sub-items
- **RLE shape decompression** — Full sprite parsing with hotspot offsets
- **Memory-efficient tiling** — Large maps split into 4096×4096 tiles when >1.5GB raw RGBA
- **Interactive viewer** — Web interface with zoom, pan, floor filtering, and URL state persistence
- **Shape caching** — In-memory frame cache avoids redundant parsing during rendering

## Development

```bash
# Terminal 1 - TypeScript watch mode
npm run dev:server

# Terminal 2 - Vite dev server (proxies /api to localhost:3000)
npm run dev:client

# Code quality
npm run format  # Biome format
npm run lint    # Biome lint + auto-fix
npm run check   # Format + lint
```

## Architecture

**Data Pipeline:**
```
Game files → loadGameData() → parseFixedItems() → resolveMapItems() (expand globs)
  → sortMapItems() (painter's algorithm with dependency graph)
  → renderMap() (isometric projection → pixel blitting → PNG output)
```

**Isometric Projection:**
- `screen_x = (world_x - world_y) / 2`
- `screen_y = (world_x + world_y) / 4 - world_z`
- Sprite hotspot offsets applied per frame

**Mission Mapping:**  
Missions 1-15 map to FIXED.DAT indices. Some missions span multiple maps (e.g., mission 5 → indices 8, 9). Rebel base maps at indices 28-29.

## File Formats

The project parses several Crusader: No Remorse / Ultima 8 engine formats:

**FLX Archives** — Container format
- 82-byte header + entry count at 0x54
- Index table at 0x80: (offset u32, size u32) pairs
- Used for SHAPES.FLX, GLOB.FLX, etc.

**Shape Format** — Sprite graphics
- Header: maxX, maxY, frameCount (u16 LE)
- Per-frame: 28-byte header with hotspot offsets (xOffset, yOffset)
- Pixel data: RLE compressed or raw scanlines
- Index 0xFF treated as transparent (alpha = 0)

**FIXED.DAT** — Map items
- 16-byte records per item
- Fields: x, y, z, shape, frame, flags, quality, npcNum, mapNum, etc.

**TYPEFLAG.DAT** — Shape metadata
- 9 bytes per entry (Crusader-specific, vs 8 for Ultima 8)
- Shape family (0-13): generic, quality, quantity, globegg, npc, weapon, ammo, etc.
- Flags: solid, land, occluded, drawable, translucent, animated, etc.
- Footpad dimensions (world-space bounding box)

**GAMEPAL.PAL** — Color palette
- 768 bytes: 256 colors × 3 bytes RGB
- 6-bit VGA values (0-63) converted to 8-bit (0-255)

