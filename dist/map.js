"use strict";
/**
 * Map / Level Parser
 *
 * Reads FIXED.DAT (FLX archive) and GLOB.FLX to load level data.
 *
 * Each FIXED.DAT entry contains a level's fixed items (16 bytes each).
 * Glob eggs (shape family 3) reference prefab groups in GLOB.FLX.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.REBEL_BASE_DESTROYED = exports.REBEL_BASE = exports.REMORSE_MISSIONS = void 0;
exports.parseFixedItems = parseFixedItems;
exports.parseGlob = parseGlob;
exports.loadGlobs = loadGlobs;
exports.resolveMapItems = resolveMapItems;
exports.sortMapItems = sortMapItems;
const flx_1 = require("./flx");
const typeflag_1 = require("./typeflag");
/**
 * Parse fixed items from a FIXED.DAT entry (raw buffer of 16-byte records)
 */
function parseFixedItems(data) {
    const itemSize = 16;
    const count = Math.floor(data.length / itemSize);
    const items = [];
    for (let i = 0; i < count; i++) {
        const off = i * itemSize;
        items.push({
            x: data.readUInt16LE(off),
            y: data.readUInt16LE(off + 2),
            z: data.readUInt8(off + 4),
            shape: data.readUInt16LE(off + 5),
            frame: data.readUInt8(off + 7),
            flags: data.readUInt16LE(off + 8),
            quality: data.readUInt16LE(off + 10),
            npcNum: data.readUInt8(off + 12),
            mapNum: data.readUInt8(off + 13),
            next: data.readUInt16LE(off + 14),
        });
    }
    return items;
}
/**
 * Parse a single glob entry from GLOB.FLX
 */
function parseGlob(data) {
    if (data.length < 2)
        return { items: [] };
    const itemCount = data.readUInt16LE(0);
    const items = [];
    for (let i = 0; i < itemCount; i++) {
        const off = 2 + i * 6;
        if (off + 6 > data.length)
            break;
        items.push({
            x: data.readUInt8(off),
            y: data.readUInt8(off + 1),
            z: data.readUInt8(off + 2),
            shape: data.readUInt16LE(off + 3),
            frame: data.readUInt8(off + 5),
        });
    }
    return { items };
}
/**
 * Load all globs from GLOB.FLX
 */
function loadGlobs(globFlxPath) {
    const archive = (0, flx_1.readFlx)(globFlxPath);
    const globs = [];
    for (let i = 0; i < archive.entryCount; i++) {
        const data = (0, flx_1.getFlxEntryData)(archive, i);
        if (data && data.length >= 2) {
            globs.push(parseGlob(data));
        }
        else {
            globs.push({ items: [] });
        }
    }
    return globs;
}
/** Shape IDs that should be skipped during rendering (eggs, triggers, etc.) */
const SKIP_SHAPES = new Set([1592, 1593, 1594, 1608, 1609]);
/**
 * Resolve a level's fixed items into renderable MapItems.
 * Expands glob eggs into their constituent items.
 *
 * @param fixedItems - Raw items from FIXED.DAT
 * @param globs - All parsed globs from GLOB.FLX
 * @param typeFlags - Shape metadata for family identification
 * @param skipNonDrawable - If true, skip items whose shape has draw=false
 */
function resolveMapItems(fixedItems, globs, typeFlags, skipNonDrawable = false) {
    const items = [];
    for (const fi of fixedItems) {
        // Use raw usecode coords directly (NOT multiplied by 2).
        // The C++ reference code passes entry.x, entry.y directly to drawShape.
        const worldX = fi.x;
        const worldY = fi.y;
        const worldZ = fi.z;
        // Check if this is a glob egg
        // The original C++ code checks `type == 0x10` which corresponds to shape 16.
        // ScummVM checks family == SF_GLOBEGG. We support both.
        const isGlobEgg = fi.shape === 0x10 ||
            (typeFlags && fi.shape < typeFlags.length && typeFlags[fi.shape].family === typeflag_1.ShapeFamily.SF_GLOBEGG);
        if (isGlobEgg) {
            const globIdx = fi.quality;
            if (globIdx < globs.length) {
                const glob = globs[globIdx];
                for (const gi of glob.items) {
                    // Crusader glob coordinate expansion (matching C++ reference):
                    // item_x = entry.x + glob_x * 2 - 512
                    // item_y = entry.y + glob_y * 2 - 512
                    // item_z = entry.z + glob_z
                    const itemX = worldX + gi.x * 2 - 512;
                    const itemY = worldY + gi.y * 2 - 512;
                    const itemZ = worldZ + gi.z;
                    if (SKIP_SHAPES.has(gi.shape))
                        continue;
                    if (skipNonDrawable && typeFlags && gi.shape < typeFlags.length && !typeFlags[gi.shape].draw)
                        continue;
                    items.push({
                        worldX: itemX,
                        worldY: itemY,
                        worldZ: itemZ,
                        shape: gi.shape,
                        frame: gi.frame,
                    });
                }
            }
        }
        else {
            if (SKIP_SHAPES.has(fi.shape))
                continue;
            if (skipNonDrawable && typeFlags && fi.shape < typeFlags.length && !typeFlags[fi.shape].draw)
                continue;
            items.push({
                worldX,
                worldY,
                worldZ,
                shape: fi.shape,
                frame: fi.frame,
            });
        }
    }
    return items;
}
/**
 * Sort map items for painter's algorithm rendering (back-to-front).
 * Sort by Z ascending, then by (x+y) ascending for depth.
 */
function sortMapItems(items) {
    return items.slice().sort((a, b) => {
        if (a.worldZ !== b.worldZ)
            return a.worldZ - b.worldZ;
        const depthA = a.worldX + a.worldY;
        const depthB = b.worldX + b.worldY;
        return depthA - depthB;
    });
}
/**
 * Mission-to-FIXED.DAT index mapping for Crusader: No Remorse
 */
exports.REMORSE_MISSIONS = {
    1: [1],
    2: [2],
    3: [4],
    4: [6],
    5: [8, 9],
    6: [10],
    7: [11, 12],
    8: [13, 14],
    9: [15],
    10: [16],
    11: [17],
    12: [19],
    13: [21],
    14: [23, 24],
    15: [25],
};
/** Special map indices */
exports.REBEL_BASE = 28;
exports.REBEL_BASE_DESTROYED = 29;
//# sourceMappingURL=map.js.map