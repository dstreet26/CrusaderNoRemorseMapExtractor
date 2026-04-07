/**
 * Map Renderer
 *
 * Renders a list of MapItems onto an image using isometric projection.
 *
 * Isometric projection (2:1):
 *   screen_x = (world_x - world_y) / 2
 *   screen_y = (world_x + world_y) / 4 - world_z
 *
 * Uses a tile-based rendering approach to handle large maps without
 * exceeding Node.js buffer size limits. The map is divided into tiles
 * that are rendered individually and composited into the final image.
 */

import sharp from "sharp";
import * as fs from "fs";
import * as path from "path";
import { type Palette, type Color } from "./palette";
import { type MapItem, sortMapItems } from "./map";
import { parseShape, type Shape, type ShapeFrame } from "./shape";
import { readFlx, getFlxEntryData, type FlxArchive } from "./flx";
import { type ShapeInfo } from "./typeflag";

/** Rendering options */
export interface RenderOptions {
  /** Background color */
  bgColor?: Color;
  /** Scale factor (1 = native, 2 = 2× upscale) */
  scale?: number;
  /** Floor filter — if set, only render items on this Z range */
  floorMinZ?: number;
  floorMaxZ?: number;
  /** Optional progress callback */
  onProgress?: (current: number, total: number) => void;
  /** Output file path (enables streaming for large images) */
  outputPath?: string;
  /** Crop to a specific region in native (unscaled) screen-space pixels.
   *  Coordinates are relative to the full map bounding box origin.
   *  Only items overlapping this region are rendered. */
  crop?: { x: number; y: number; width: number; height: number };
}

/** Shape cache to avoid re-parsing */
interface ShapeCache {
  get(shapeIdx: number, frameIdx: number): ShapeFrame | undefined;
  set(shapeIdx: number, frameIdx: number, frame: ShapeFrame): void;
}

function createShapeCache(): ShapeCache {
  const cache = new Map<string, ShapeFrame>();
  return {
    get(shapeIdx: number, frameIdx: number) {
      return cache.get(`${shapeIdx}:${frameIdx}`);
    },
    set(shapeIdx: number, frameIdx: number, frame: ShapeFrame) {
      cache.set(`${shapeIdx}:${frameIdx}`, frame);
    },
  };
}

/**
 * Isometric projection: world coords → screen coords
 */
function worldToScreen(wx: number, wy: number, wz: number): { sx: number; sy: number } {
  return {
    sx: Math.floor((wx - wy) / 2),
    sy: Math.floor((wx + wy) / 4 - wz),
  };
}

/**
 * Get the shape frame data for a given shape+frame, using cache
 */
function getShapeFrame(
  shapesArchive: FlxArchive,
  palette: Palette,
  cache: ShapeCache,
  shapeIdx: number,
  frameIdx: number
): ShapeFrame | null {
  const cached = cache.get(shapeIdx, frameIdx);
  if (cached) return cached;

  // Shape IDs map directly to archive indices (no offset per ScummVM source)
  const archiveIdx = shapeIdx;
  const data = getFlxEntryData(shapesArchive, archiveIdx);
  if (!data) return null;

  const shape = parseShape(data, palette);
  // Cache all frames
  for (let f = 0; f < shape.frames.length; f++) {
    cache.set(shapeIdx, f, shape.frames[f]);
  }

  // Wrap frame index (the game engine uses modulo for out-of-range frames)
  const wrappedIdx = shape.frameCount > 0 ? frameIdx % shape.frameCount : 0;
  const frame = shape.frames[wrappedIdx] || null;
  // Cache the wrapped result under the original requested index too
  if (frame) cache.set(shapeIdx, frameIdx, frame);
  return frame;
}

/** Pre-resolved item with screen position and frame reference */
interface ResolvedRenderItem {
  drawX: number;
  drawY: number;
  frame: ShapeFrame;
}

/**
 * Resolve all items: calculate screen positions and load frames.
 * Returns the bounding box and resolved render items.
 */
function resolveRenderItems(
  items: MapItem[],
  shapesArchive: FlxArchive,
  palette: Palette,
  cache: ShapeCache,
): {
  resolved: ResolvedRenderItem[];
  minX: number; minY: number; maxX: number; maxY: number;
} {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const resolved: ResolvedRenderItem[] = [];

  for (const item of items) {
    const frame = getShapeFrame(shapesArchive, palette, cache, item.shape, item.frame);
    if (!frame || frame.width === 0 || frame.height === 0) continue;

    const { sx, sy } = worldToScreen(item.worldX, item.worldY, item.worldZ);
    const drawX = sx - frame.xOffset;
    const drawY = sy - frame.yOffset;

    resolved.push({ drawX, drawY, frame });

    if (drawX < minX) minX = drawX;
    if (drawY < minY) minY = drawY;
    if (drawX + frame.width > maxX) maxX = drawX + frame.width;
    if (drawY + frame.height > maxY) maxY = drawY + frame.height;
  }

  return { resolved, minX, minY, maxX, maxY };
}

/** Maximum raw RGBA bytes for single-image mode (~1.5 GB) */
const MAX_SINGLE_IMAGE_BYTES = 1_500_000_000;

/** Tile size for tiled output (pixels per side) */
const TILE_SIZE = 4096;

/**
 * Render map items to an image.
 *
 * - Small images: single PNG (returned as Buffer).
 * - Large images: PNG tiles written to an output folder.
 */
export async function renderMap(
  items: MapItem[],
  shapesArchive: FlxArchive,
  palette: Palette,
  typeFlags: ShapeInfo[] | null,
  options: RenderOptions = {}
): Promise<Buffer> {
  const { bgColor, scale = 1, floorMinZ, floorMaxZ, onProgress, outputPath, crop } = options;

  const sortedItems = sortMapItems(items, typeFlags);
  const cache = createShapeCache();

  // Filter by floor if specified
  let filteredItems = sortedItems;
  if (floorMinZ !== undefined || floorMaxZ !== undefined) {
    filteredItems = sortedItems.filter((item) => {
      if (floorMinZ !== undefined && item.worldZ < floorMinZ) return false;
      if (floorMaxZ !== undefined && item.worldZ > floorMaxZ) return false;
      return true;
    });
  }

  // Resolve all items (calculate screen positions, load frames)
  const { resolved, minX, minY, maxX, maxY } = resolveRenderItems(
    filteredItems, shapesArchive, palette, cache
  );

  if (resolved.length === 0) {
    console.log("  No renderable items found.");
    return sharp({ create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
      .png()
      .toBuffer();
  }

  // Native (unscaled) bounding box
  const nativeWidth = maxX - minX;
  const nativeHeight = maxY - minY;

  // Apply crop if specified (coordinates relative to full map bounding box)
  let renderOffsetX = minX;
  let renderOffsetY = minY;
  let renderNativeW = nativeWidth;
  let renderNativeH = nativeHeight;
  let croppedResolved = resolved;

  if (crop) {
    renderOffsetX = minX + crop.x;
    renderOffsetY = minY + crop.y;
    renderNativeW = crop.width;
    renderNativeH = crop.height;

    // Filter to only items that overlap the crop rectangle
    croppedResolved = resolved.filter(({ drawX, drawY, frame }) => {
      const frameRight = drawX + frame.width;
      const frameBottom = drawY + frame.height;
      const cropRight = renderOffsetX + crop.width;
      const cropBottom = renderOffsetY + crop.height;
      return frameRight > renderOffsetX && drawX < cropRight &&
             frameBottom > renderOffsetY && drawY < cropBottom;
    });

    console.log(`  Crop region: (${crop.x}, ${crop.y}) ${crop.width}×${crop.height}`);
    console.log(`  Items in crop region: ${croppedResolved.length}`);
  }

  // Scaled output dimensions
  const imageWidth = Math.max(1, Math.ceil(renderNativeW * scale));
  const imageHeight = Math.max(1, Math.ceil(renderNativeH * scale));
  const rawBytes = imageWidth * imageHeight * 4;

  console.log(`  Native dimensions: ${nativeWidth} × ${nativeHeight}`);
  console.log(`  Output dimensions: ${imageWidth} × ${imageHeight} (scale=${scale}, ${(rawBytes / 1024 / 1024).toFixed(0)} MB raw)`);
  console.log(`  Sprites to render: ${croppedResolved.length}`);

  if (rawBytes <= MAX_SINGLE_IMAGE_BYTES) {
    // Fits in memory — single image
    return renderDirect(croppedResolved, imageWidth, imageHeight, renderOffsetX, renderOffsetY, scale, bgColor, onProgress);
  } else {
    // Too large — tiled output to folder
    const outDir = outputPath ? outputPath.replace(/\.[^.]+$/, "_tiles") : "out_tiles";
    return renderTiledOutput(croppedResolved, imageWidth, imageHeight, renderOffsetX, renderOffsetY, scale, bgColor, onProgress, outDir);
  }
}

/**
 * Direct rendering — fits in a single buffer, returns PNG.
 */
async function renderDirect(
  resolved: ResolvedRenderItem[],
  imageWidth: number,
  imageHeight: number,
  offsetX: number,
  offsetY: number,
  scale: number,
  bgColor: Color | undefined,
  onProgress: ((current: number, total: number) => void) | undefined
): Promise<Buffer> {
  const imgBuf = Buffer.alloc(imageWidth * imageHeight * 4);

  if (bgColor) {
    for (let i = 0; i < imageWidth * imageHeight; i++) {
      imgBuf[i * 4] = bgColor.r;
      imgBuf[i * 4 + 1] = bgColor.g;
      imgBuf[i * 4 + 2] = bgColor.b;
      imgBuf[i * 4 + 3] = bgColor.a;
    }
  }

  for (let i = 0; i < resolved.length; i++) {
    const { drawX, drawY, frame } = resolved[i];
    blitFrame(imgBuf, imageWidth, imageHeight, frame, drawX - offsetX, drawY - offsetY, scale);

    if (onProgress && (i % 500 === 0 || i === resolved.length - 1)) {
      onProgress(i + 1, resolved.length);
    }
  }

  return sharp(imgBuf, { raw: { width: imageWidth, height: imageHeight, channels: 4 }, limitInputPixels: false })
    .png({ compressionLevel: 6 })
    .toBuffer();
}

/**
 * Tiled rendering — writes PNG tiles to an output folder.
 * Each tile is TILE_SIZE × TILE_SIZE pixels (last column/row may be smaller).
 * Also writes a metadata.json with layout information and an HTML viewer.
 */
async function renderTiledOutput(
  resolved: ResolvedRenderItem[],
  imageWidth: number,
  imageHeight: number,
  offsetX: number,
  offsetY: number,
  scale: number,
  bgColor: Color | undefined,
  onProgress: ((current: number, total: number) => void) | undefined,
  outDir: string
): Promise<Buffer> {
  const cols = Math.ceil(imageWidth / TILE_SIZE);
  const rows = Math.ceil(imageHeight / TILE_SIZE);
  const totalTiles = cols * rows;

  fs.mkdirSync(outDir, { recursive: true });
  console.log(`  Tiled output: ${cols}×${rows} grid (${totalTiles} tiles of ${TILE_SIZE}px) → ${outDir}/`);

  let tileNum = 0;
  for (let tr = 0; tr < rows; tr++) {
    for (let tc = 0; tc < cols; tc++) {
      tileNum++;
      const tileX = tc * TILE_SIZE;
      const tileY = tr * TILE_SIZE;
      const tileW = Math.min(TILE_SIZE, imageWidth - tileX);
      const tileH = Math.min(TILE_SIZE, imageHeight - tileY);

      const tileBuf = Buffer.alloc(tileW * tileH * 4);

      // Fill with background
      if (bgColor) {
        for (let i = 0; i < tileW * tileH; i++) {
          tileBuf[i * 4] = bgColor.r;
          tileBuf[i * 4 + 1] = bgColor.g;
          tileBuf[i * 4 + 2] = bgColor.b;
          tileBuf[i * 4 + 3] = bgColor.a;
        }
      }

      // Render items that overlap this tile
      for (const { drawX, drawY, frame } of resolved) {
        const nativeX = drawX - offsetX;
        const nativeY = drawY - offsetY;

        // Compute frame bounds in output (scaled) space
        const fMinX = Math.floor(nativeX * scale);
        const fMaxX = Math.ceil((nativeX + frame.width) * scale);
        const fMinY = Math.floor(nativeY * scale);
        const fMaxY = Math.ceil((nativeY + frame.height) * scale);

        // Skip if frame doesn't overlap this tile
        if (fMaxX <= tileX || fMinX >= tileX + tileW) continue;
        if (fMaxY <= tileY || fMinY >= tileY + tileH) continue;

        blitFrameToTile(tileBuf, tileW, tileH, tileX, tileY, frame, nativeX, nativeY, scale);
      }

      // Save tile as PNG
      const tileName = `tile_r${String(tr).padStart(3, "0")}_c${String(tc).padStart(3, "0")}.png`;
      await sharp(tileBuf, { raw: { width: tileW, height: tileH, channels: 4 } })
        .png({ compressionLevel: 6 })
        .toFile(path.join(outDir, tileName));

      process.stdout.write(`\r  Tile ${tileNum}/${totalTiles}`);
    }
  }

  // Write metadata
  const metadata = {
    imageWidth,
    imageHeight,
    tileSize: TILE_SIZE,
    cols,
    rows,
    scale,
    tiles: [] as Array<{ file: string; x: number; y: number; width: number; height: number }>,
  };
  for (let tr = 0; tr < rows; tr++) {
    for (let tc = 0; tc < cols; tc++) {
      const tileX = tc * TILE_SIZE;
      const tileY = tr * TILE_SIZE;
      metadata.tiles.push({
        file: `tile_r${String(tr).padStart(3, "0")}_c${String(tc).padStart(3, "0")}.png`,
        x: tileX,
        y: tileY,
        width: Math.min(TILE_SIZE, imageWidth - tileX),
        height: Math.min(TILE_SIZE, imageHeight - tileY),
      });
    }
  }
  fs.writeFileSync(path.join(outDir, "metadata.json"), JSON.stringify(metadata, null, 2));

  // Write HTML viewer
  writeHtmlViewer(outDir, metadata);

  console.log(`\n  ${totalTiles} tiles saved to ${outDir}/`);
  console.log(`  Open ${outDir}/viewer.html in a browser to view the map.`);

  return Buffer.from("TILED");
}

/**
 * Write an interactive HTML viewer for tiled output with zoom/pan controls.
 */
function writeHtmlViewer(
  outDir: string,
  metadata: { imageWidth: number; imageHeight: number; tileSize: number; cols: number; rows: number; tiles: Array<{ file: string; x: number; y: number; width: number; height: number }> }
): void {
  const tilesJson = JSON.stringify(metadata.tiles);
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Crusader Map Viewer</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #111; overflow: hidden; width: 100vw; height: 100vh; }
  #viewport {
    position: absolute; inset: 0; overflow: hidden;
    cursor: grab;
  }
  #viewport.dragging { cursor: grabbing; }
  #map-container {
    position: absolute;
    width: ${metadata.imageWidth}px;
    height: ${metadata.imageHeight}px;
    transform-origin: 0 0;
    will-change: transform;
  }
  #map-container img {
    position: absolute;
    display: block;
    image-rendering: pixelated;
  }
  #hud {
    position: fixed; top: 8px; left: 8px;
    color: #0f0; font: 13px monospace;
    background: rgba(0,0,0,0.8); padding: 8px 12px;
    border-radius: 6px; z-index: 100;
    user-select: none;
    display: flex; flex-direction: column; gap: 6px;
  }
  #hud .title { font-size: 11px; opacity: 0.7; }
  #hud .zoom-row { display: flex; align-items: center; gap: 8px; }
  #hud button {
    background: #333; color: #0f0; border: 1px solid #0f0;
    font: 13px monospace; padding: 2px 8px; border-radius: 3px;
    cursor: pointer; line-height: 1.4;
  }
  #hud button:hover { background: #0f0; color: #111; }
  #hud .shortcuts { font-size: 10px; opacity: 0.5; margin-top: 2px; }
</style>
</head>
<body>
<div id="hud">
  <div class="title">${metadata.imageWidth}\u00d7${metadata.imageHeight}px &middot; ${metadata.cols}\u00d7${metadata.rows} tiles</div>
  <div class="zoom-row">
    <button id="btn-out" title="Zoom out (\u2212)">\u2212</button>
    <span id="zoom-label">100%</span>
    <button id="btn-in" title="Zoom in (+)">+</button>
    <button id="btn-reset" title="Reset (0)">Reset</button>
    <button id="btn-fit" title="Fit to window (F)">Fit</button>
  </div>
  <div class="shortcuts">Scroll=zoom &middot; Drag=pan &middot; +/\u2212/0/F &middot; Arrows=pan &middot; URL updates with position</div>
</div>
<div id="viewport">
  <div id="map-container"></div>
</div>
<script>
(function() {
  const MAP_W = ${metadata.imageWidth}, MAP_H = ${metadata.imageHeight};
  const TILES = ${tilesJson};
  const TILE_SIZE = ${metadata.tileSize};
  const COLS = ${metadata.cols}, ROWS = ${metadata.rows};

  const viewport = document.getElementById('viewport');
  const container = document.getElementById('map-container');
  const zoomLabel = document.getElementById('zoom-label');

  // State
  let zoom = 1;
  let panX = 0, panY = 0;
  const MIN_ZOOM = 0.02, MAX_ZOOM = 8;

  // Tile tracking: which tiles have been added to DOM
  const loadedTiles = new Set();
  const tileElements = new Map();

  function applyTransform() {
    container.style.transform = 'translate(' + panX + 'px,' + panY + 'px) scale(' + zoom + ')';
    zoomLabel.textContent = Math.round(zoom * 100) + '%';
    updateVisibleTiles();
    updateHash();
  }

  // URL hash: #x,y,zoom — map-space pixel coordinates of viewport center
  let hashTimer = null;
  function updateHash() {
    clearTimeout(hashTimer);
    hashTimer = setTimeout(function() {
      const vw = viewport.clientWidth;
      const vh = viewport.clientHeight;
      // Center of viewport in map-space
      const cx = Math.round((-panX + vw / 2) / zoom);
      const cy = Math.round((-panY + vh / 2) / zoom);
      const z = Math.round(zoom * 100);
      history.replaceState(null, '', '#' + cx + ',' + cy + ',' + z);
    }, 150);
  }

  function restoreFromHash() {
    const h = location.hash.replace('#', '');
    if (!h) return false;
    const parts = h.split(',').map(Number);
    if (parts.length < 2 || parts.some(isNaN)) return false;
    const cx = parts[0], cy = parts[1];
    const z = parts.length >= 3 ? parts[2] / 100 : 1;
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    panX = -cx * zoom + vw / 2;
    panY = -cy * zoom + vh / 2;
    return true;
  }

  // Determine which tiles are visible and load/unload them
  function updateVisibleTiles() {
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;

    // Viewport bounds in map-space
    const mapLeft = -panX / zoom;
    const mapTop = -panY / zoom;
    const mapRight = mapLeft + vw / zoom;
    const mapBottom = mapTop + vh / zoom;

    // Which tile columns/rows are visible (with 1-tile margin for smooth scrolling)
    const colMin = Math.max(0, Math.floor(mapLeft / TILE_SIZE) - 1);
    const colMax = Math.min(COLS - 1, Math.floor(mapRight / TILE_SIZE) + 1);
    const rowMin = Math.max(0, Math.floor(mapTop / TILE_SIZE) - 1);
    const rowMax = Math.min(ROWS - 1, Math.floor(mapBottom / TILE_SIZE) + 1);

    const nowVisible = new Set();

    for (let r = rowMin; r <= rowMax; r++) {
      for (let c = colMin; c <= colMax; c++) {
        const idx = r * COLS + c;
        nowVisible.add(idx);
        if (!loadedTiles.has(idx)) {
          const t = TILES[idx];
          if (!t) continue;
          const img = document.createElement('img');
          img.src = t.file;
          img.style.cssText = 'left:' + t.x + 'px;top:' + t.y + 'px;width:' + t.width + 'px;height:' + t.height + 'px;';
          container.appendChild(img);
          loadedTiles.add(idx);
          tileElements.set(idx, img);
        }
      }
    }

    // Unload tiles far from viewport to save memory
    for (const idx of loadedTiles) {
      if (!nowVisible.has(idx)) {
        const el = tileElements.get(idx);
        if (el) { container.removeChild(el); tileElements.delete(idx); }
        loadedTiles.delete(idx);
      }
    }
  }

  // Zoom centered on a point in viewport space
  function zoomAt(cx, cy, factor) {
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
    const ratio = newZoom / zoom;
    panX = cx - (cx - panX) * ratio;
    panY = cy - (cy - panY) * ratio;
    zoom = newZoom;
    applyTransform();
  }

  function zoomCenter(factor) {
    zoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, factor);
  }

  function resetView() {
    zoom = 1; panX = 0; panY = 0;
    applyTransform();
  }

  function fitView() {
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    zoom = Math.min(vw / MAP_W, vh / MAP_H, MAX_ZOOM);
    panX = (vw - MAP_W * zoom) / 2;
    panY = (vh - MAP_H * zoom) / 2;
    applyTransform();
  }

  // Mouse wheel zoom
  viewport.addEventListener('wheel', function(e) {
    e.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    zoomAt(cx, cy, factor);
  }, { passive: false });

  // Mouse drag pan
  let dragging = false, dragStartX = 0, dragStartY = 0, panStartX = 0, panStartY = 0;

  viewport.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return;
    dragging = true;
    dragStartX = e.clientX; dragStartY = e.clientY;
    panStartX = panX; panStartY = panY;
    viewport.classList.add('dragging');
    e.preventDefault();
  });

  window.addEventListener('mousemove', function(e) {
    if (!dragging) return;
    panX = panStartX + (e.clientX - dragStartX);
    panY = panStartY + (e.clientY - dragStartY);
    applyTransform();
  });

  window.addEventListener('mouseup', function() {
    dragging = false;
    viewport.classList.remove('dragging');
  });

  // Touch support: pinch-to-zoom + drag
  let lastTouchDist = 0, lastTouchMid = null, touching = false;

  viewport.addEventListener('touchstart', function(e) {
    if (e.touches.length === 1) {
      touching = true;
      dragStartX = e.touches[0].clientX; dragStartY = e.touches[0].clientY;
      panStartX = panX; panStartY = panY;
    } else if (e.touches.length === 2) {
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      lastTouchDist = Math.hypot(dx, dy);
      lastTouchMid = { x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
                        y: (e.touches[0].clientY + e.touches[1].clientY) / 2 };
    }
    e.preventDefault();
  }, { passive: false });

  viewport.addEventListener('touchmove', function(e) {
    if (e.touches.length === 1 && touching) {
      panX = panStartX + (e.touches[0].clientX - dragStartX);
      panY = panStartY + (e.touches[0].clientY - dragStartY);
      applyTransform();
    } else if (e.touches.length === 2) {
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      const dist = Math.hypot(dx, dy);
      if (lastTouchDist > 0) {
        const mid = { x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
                      y: (e.touches[0].clientY + e.touches[1].clientY) / 2 };
        const rect = viewport.getBoundingClientRect();
        zoomAt(mid.x - rect.left, mid.y - rect.top, dist / lastTouchDist);
      }
      lastTouchDist = dist;
    }
    e.preventDefault();
  }, { passive: false });

  viewport.addEventListener('touchend', function() { touching = false; lastTouchDist = 0; });

  // Keyboard shortcuts
  window.addEventListener('keydown', function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const PAN_STEP = 100;
    switch (e.key) {
      case '+': case '=': zoomCenter(1.25); e.preventDefault(); break;
      case '-': case '_': zoomCenter(1 / 1.25); e.preventDefault(); break;
      case '0': resetView(); e.preventDefault(); break;
      case 'f': case 'F': fitView(); e.preventDefault(); break;
      case 'ArrowLeft':  panX += PAN_STEP; applyTransform(); e.preventDefault(); break;
      case 'ArrowRight': panX -= PAN_STEP; applyTransform(); e.preventDefault(); break;
      case 'ArrowUp':    panY += PAN_STEP; applyTransform(); e.preventDefault(); break;
      case 'ArrowDown':  panY -= PAN_STEP; applyTransform(); e.preventDefault(); break;
    }
  });

  // Buttons
  document.getElementById('btn-in').addEventListener('click', function() { zoomCenter(1.25); });
  document.getElementById('btn-out').addEventListener('click', function() { zoomCenter(1 / 1.25); });
  document.getElementById('btn-reset').addEventListener('click', resetView);
  document.getElementById('btn-fit').addEventListener('click', fitView);

  // Initial view: restore from URL hash, or fit to window
  if (restoreFromHash()) {
    applyTransform();
  } else {
    fitView();
  }
})();
</script>
</body>
</html>`;
  fs.writeFileSync(path.join(outDir, "viewer.html"), html);
}

/**
 * Blit a shape frame onto an image buffer.
 *
 * @param nativeX  Frame draw position in native (unscaled) image space
 * @param nativeY  Frame draw position in native (unscaled) image space
 * @param scale    Scale factor applied to native coords → output coords
 */
function blitFrame(
  imgBuf: Buffer,
  imgWidth: number,
  imgHeight: number,
  frame: ShapeFrame,
  nativeX: number,
  nativeY: number,
  scale: number
): void {
  for (let row = 0; row < frame.height; row++) {
    for (let col = 0; col < frame.width; col++) {
      const srcIdx = (row * frame.width + col) * 4;
      if (frame.pixels[srcIdx + 3] === 0) continue;

      let px: number, py: number;
      if (scale === 1) {
        px = nativeX + col;
        py = nativeY + row;
      } else {
        px = Math.floor((nativeX + col) * scale);
        py = Math.floor((nativeY + row) * scale);
      }

      if (px < 0 || px >= imgWidth || py < 0 || py >= imgHeight) continue;

      const dstIdx = (py * imgWidth + px) * 4;
      imgBuf[dstIdx] = frame.pixels[srcIdx];
      imgBuf[dstIdx + 1] = frame.pixels[srcIdx + 1];
      imgBuf[dstIdx + 2] = frame.pixels[srcIdx + 2];
      imgBuf[dstIdx + 3] = 255;
    }
  }
}

/**
 * Blit a shape frame onto a tile buffer with tile-local coordinate offset.
 */
function blitFrameToTile(
  tileBuf: Buffer,
  tileW: number,
  tileH: number,
  tileX: number,
  tileY: number,
  frame: ShapeFrame,
  nativeX: number,
  nativeY: number,
  scale: number
): void {
  for (let row = 0; row < frame.height; row++) {
    for (let col = 0; col < frame.width; col++) {
      const srcIdx = (row * frame.width + col) * 4;
      if (frame.pixels[srcIdx + 3] === 0) continue;

      let px: number, py: number;
      if (scale === 1) {
        px = nativeX + col - tileX;
        py = nativeY + row - tileY;
      } else {
        px = Math.floor((nativeX + col) * scale) - tileX;
        py = Math.floor((nativeY + row) * scale) - tileY;
      }

      if (px < 0 || px >= tileW || py < 0 || py >= tileH) continue;

      const dstIdx = (py * tileW + px) * 4;
      tileBuf[dstIdx] = frame.pixels[srcIdx];
      tileBuf[dstIdx + 1] = frame.pixels[srcIdx + 1];
      tileBuf[dstIdx + 2] = frame.pixels[srcIdx + 2];
      tileBuf[dstIdx + 3] = 255;
    }
  }
}

/**
 * Render a single shape+frame to a PNG buffer (for debugging/visualization)
 */
export async function renderShapeToPng(
  shapesArchive: FlxArchive,
  palette: Palette,
  shapeIdx: number,
  frameIdx: number
): Promise<Buffer | null> {
  const cache = createShapeCache();
  const frame = getShapeFrame(shapesArchive, palette, cache, shapeIdx, frameIdx);
  if (!frame || frame.width === 0 || frame.height === 0) return null;

  return sharp(frame.pixels, { raw: { width: frame.width, height: frame.height, channels: 4 } })
    .png()
    .toBuffer();
}
