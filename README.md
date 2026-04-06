
# Crusader No Remorse Map Extractor

Renders *Crusader: No Remorse* game data files into high resolution PNG images. Parses FLX archives, shape graphics, FIXED.DAT maps, GLOB prefabs, palettes, and type flags to produce full isometric map renders.

## Setup

```
npm install
npx tsc
```

## Commands

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

Large images are automatically tiled into a `<name>_tiles/` folder with a `viewer.html` for pan+zoom.

**Examples:**

```bash
# Render mission 1 at quarter scale
node dist/index.js render-level --input-data-dir=./gog/Crusader\ No\ Remorse --level=1 --scale=0.25 --output=mission1.png

# Render mission 1 floor 0 only
node dist/index.js render-level --input-data-dir="gog/Crusader No Remorse" --level=1 --floor=0 --output=m1f0.png
```

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

Shows map statistics (item counts, Z-level distribution, coordinate ranges) without rendering.

## Supported data

- **Missions 1–15** with correct GOG FIXED.DAT index mapping
- **Multi-floor levels** with floor filtering by Z range
- **Glob prefab expansion** (shape 16 / family 3 eggs)
- **Full RLE shape decompression** and isometric projection
- **Painter's algorithm** depth sorting (Z ascending, then X+Y ascending)

## Requirements

- Node.js 18+
- Game data from Crusader: No Remorse (GOG version tested)

