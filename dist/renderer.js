"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderMap = renderMap;
exports.renderShapeToPng = renderShapeToPng;
const sharp_1 = __importDefault(require("sharp"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const map_1 = require("./map");
const shape_1 = require("./shape");
const flx_1 = require("./flx");
function createShapeCache() {
    const cache = new Map();
    return {
        get(shapeIdx, frameIdx) {
            return cache.get(`${shapeIdx}:${frameIdx}`);
        },
        set(shapeIdx, frameIdx, frame) {
            cache.set(`${shapeIdx}:${frameIdx}`, frame);
        },
    };
}
/**
 * Isometric projection: world coords → screen coords
 */
function worldToScreen(wx, wy, wz) {
    return {
        sx: Math.floor((wx - wy) / 2),
        sy: Math.floor((wx + wy) / 4 - wz),
    };
}
/**
 * Get the shape frame data for a given shape+frame, using cache
 */
function getShapeFrame(shapesArchive, palette, cache, shapeIdx, frameIdx) {
    const cached = cache.get(shapeIdx, frameIdx);
    if (cached)
        return cached;
    // Shapes are 1-indexed in map data, 0-indexed in archive
    const archiveIdx = shapeIdx - 1;
    const data = (0, flx_1.getFlxEntryData)(shapesArchive, archiveIdx);
    if (!data)
        return null;
    const shape = (0, shape_1.parseShape)(data, palette);
    // Cache all frames
    for (let f = 0; f < shape.frames.length; f++) {
        cache.set(shapeIdx, f, shape.frames[f]);
    }
    // Wrap frame index (the game engine uses modulo for out-of-range frames)
    const wrappedIdx = shape.frameCount > 0 ? frameIdx % shape.frameCount : 0;
    const frame = shape.frames[wrappedIdx] || null;
    // Cache the wrapped result under the original requested index too
    if (frame)
        cache.set(shapeIdx, frameIdx, frame);
    return frame;
}
/**
 * Resolve all items: calculate screen positions and load frames.
 * Returns the bounding box and resolved render items.
 */
function resolveRenderItems(items, shapesArchive, palette, cache) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const resolved = [];
    for (const item of items) {
        const frame = getShapeFrame(shapesArchive, palette, cache, item.shape, item.frame);
        if (!frame || frame.width === 0 || frame.height === 0)
            continue;
        const { sx, sy } = worldToScreen(item.worldX, item.worldY, item.worldZ);
        const drawX = sx - frame.xOffset;
        const drawY = sy - frame.yOffset;
        resolved.push({ drawX, drawY, frame });
        if (drawX < minX)
            minX = drawX;
        if (drawY < minY)
            minY = drawY;
        if (drawX + frame.width > maxX)
            maxX = drawX + frame.width;
        if (drawY + frame.height > maxY)
            maxY = drawY + frame.height;
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
async function renderMap(items, shapesArchive, palette, options = {}) {
    const { bgColor, scale = 1, floorMinZ, floorMaxZ, onProgress, outputPath } = options;
    const sortedItems = (0, map_1.sortMapItems)(items);
    const cache = createShapeCache();
    // Filter by floor if specified
    let filteredItems = sortedItems;
    if (floorMinZ !== undefined || floorMaxZ !== undefined) {
        filteredItems = sortedItems.filter((item) => {
            if (floorMinZ !== undefined && item.worldZ < floorMinZ)
                return false;
            if (floorMaxZ !== undefined && item.worldZ > floorMaxZ)
                return false;
            return true;
        });
    }
    // Resolve all items (calculate screen positions, load frames)
    const { resolved, minX, minY, maxX, maxY } = resolveRenderItems(filteredItems, shapesArchive, palette, cache);
    if (resolved.length === 0) {
        console.log("  No renderable items found.");
        return (0, sharp_1.default)({ create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
            .png()
            .toBuffer();
    }
    // Native (unscaled) bounding box
    const nativeWidth = maxX - minX;
    const nativeHeight = maxY - minY;
    // Scaled output dimensions
    const imageWidth = Math.max(1, Math.ceil(nativeWidth * scale));
    const imageHeight = Math.max(1, Math.ceil(nativeHeight * scale));
    const rawBytes = imageWidth * imageHeight * 4;
    console.log(`  Native dimensions: ${nativeWidth} × ${nativeHeight}`);
    console.log(`  Output dimensions: ${imageWidth} × ${imageHeight} (scale=${scale}, ${(rawBytes / 1024 / 1024).toFixed(0)} MB raw)`);
    console.log(`  Sprites to render: ${resolved.length}`);
    if (rawBytes <= MAX_SINGLE_IMAGE_BYTES) {
        // Fits in memory — single image
        return renderDirect(resolved, imageWidth, imageHeight, minX, minY, scale, bgColor, onProgress);
    }
    else {
        // Too large — tiled output to folder
        const outDir = outputPath ? outputPath.replace(/\.[^.]+$/, "_tiles") : "out_tiles";
        return renderTiledOutput(resolved, imageWidth, imageHeight, minX, minY, scale, bgColor, onProgress, outDir);
    }
}
/**
 * Direct rendering — fits in a single buffer, returns PNG.
 */
async function renderDirect(resolved, imageWidth, imageHeight, offsetX, offsetY, scale, bgColor, onProgress) {
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
    return (0, sharp_1.default)(imgBuf, { raw: { width: imageWidth, height: imageHeight, channels: 4 } })
        .png({ compressionLevel: 6 })
        .toBuffer();
}
/**
 * Tiled rendering — writes PNG tiles to an output folder.
 * Each tile is TILE_SIZE × TILE_SIZE pixels (last column/row may be smaller).
 * Also writes a metadata.json with layout information and an HTML viewer.
 */
async function renderTiledOutput(resolved, imageWidth, imageHeight, offsetX, offsetY, scale, bgColor, onProgress, outDir) {
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
                if (fMaxX <= tileX || fMinX >= tileX + tileW)
                    continue;
                if (fMaxY <= tileY || fMinY >= tileY + tileH)
                    continue;
                blitFrameToTile(tileBuf, tileW, tileH, tileX, tileY, frame, nativeX, nativeY, scale);
            }
            // Save tile as PNG
            const tileName = `tile_r${String(tr).padStart(3, "0")}_c${String(tc).padStart(3, "0")}.png`;
            await (0, sharp_1.default)(tileBuf, { raw: { width: tileW, height: tileH, channels: 4 } })
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
        tiles: [],
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
 * Write a simple HTML viewer for tiled output.
 */
function writeHtmlViewer(outDir, metadata) {
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Crusader Map Viewer</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #111; overflow: auto; }
  #map-container {
    position: relative;
    width: ${metadata.imageWidth}px;
    height: ${metadata.imageHeight}px;
  }
  #map-container img {
    position: absolute;
    display: block;
    image-rendering: pixelated;
  }
  #info {
    position: fixed; top: 8px; left: 8px;
    color: #0f0; font: 14px monospace;
    background: rgba(0,0,0,0.7); padding: 6px 10px;
    border-radius: 4px; z-index: 10;
    pointer-events: none;
  }
</style>
</head>
<body>
<div id="info">Crusader Map — ${metadata.imageWidth}×${metadata.imageHeight}px (${metadata.cols}×${metadata.rows} tiles)</div>
<div id="map-container">
${metadata.tiles.map(t => `  <img src="${t.file}" style="left:${t.x}px;top:${t.y}px;width:${t.width}px;height:${t.height}px;" loading="lazy">`).join("\n")}
</div>
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
function blitFrame(imgBuf, imgWidth, imgHeight, frame, nativeX, nativeY, scale) {
    for (let row = 0; row < frame.height; row++) {
        for (let col = 0; col < frame.width; col++) {
            const srcIdx = (row * frame.width + col) * 4;
            if (frame.pixels[srcIdx + 3] === 0)
                continue;
            let px, py;
            if (scale === 1) {
                px = nativeX + col;
                py = nativeY + row;
            }
            else {
                px = Math.floor((nativeX + col) * scale);
                py = Math.floor((nativeY + row) * scale);
            }
            if (px < 0 || px >= imgWidth || py < 0 || py >= imgHeight)
                continue;
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
function blitFrameToTile(tileBuf, tileW, tileH, tileX, tileY, frame, nativeX, nativeY, scale) {
    for (let row = 0; row < frame.height; row++) {
        for (let col = 0; col < frame.width; col++) {
            const srcIdx = (row * frame.width + col) * 4;
            if (frame.pixels[srcIdx + 3] === 0)
                continue;
            let px, py;
            if (scale === 1) {
                px = nativeX + col - tileX;
                py = nativeY + row - tileY;
            }
            else {
                px = Math.floor((nativeX + col) * scale) - tileX;
                py = Math.floor((nativeY + row) * scale) - tileY;
            }
            if (px < 0 || px >= tileW || py < 0 || py >= tileH)
                continue;
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
async function renderShapeToPng(shapesArchive, palette, shapeIdx, frameIdx) {
    const cache = createShapeCache();
    const frame = getShapeFrame(shapesArchive, palette, cache, shapeIdx, frameIdx);
    if (!frame || frame.width === 0 || frame.height === 0)
        return null;
    return (0, sharp_1.default)(frame.pixels, { raw: { width: frame.width, height: frame.height, channels: 4 } })
        .png()
        .toBuffer();
}
//# sourceMappingURL=renderer.js.map