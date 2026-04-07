/**
 * Map / Level Parser
 *
 * Reads FIXED.DAT (FLX archive) and GLOB.FLX to load level data.
 *
 * Each FIXED.DAT entry contains a level's fixed items (16 bytes each).
 * Glob eggs (shape family 3) reference prefab groups in GLOB.FLX.
 */

import { getFlxEntryData, readFlx } from "./flx";
import { ShapeFamily, type ShapeInfo } from "./typeflag";

/** Raw fixed item as stored in FIXED.DAT */
export interface FixedItem {
  x: number; // usecode X (multiply by 2 for world coords)
  y: number; // usecode Y
  z: number; // world Z
  shape: number; // shape index
  frame: number; // frame index
  flags: number;
  quality: number; // for glob eggs: glob index in GLOB.FLX
  npcNum: number;
  mapNum: number;
  next: number;
}

/** Glob entry (sub-item within a glob prefab) */
export interface GlobItem {
  x: number; // local offset
  y: number;
  z: number;
  shape: number;
  frame: number;
}

/** Glob prefab */
export interface Glob {
  items: GlobItem[];
}

/** Compute Z range for a given floor number (each floor is ~40 Z units). */
export function computeFloorZRange(floor: number): { floorMinZ: number; floorMaxZ: number } {
  return { floorMinZ: floor * 40, floorMaxZ: (floor + 1) * 40 - 1 };
}

/** Resolved map item ready for rendering */
export interface MapItem {
  worldX: number;
  worldY: number;
  worldZ: number;
  shape: number;
  frame: number;
}

/** Internal enriched item for advanced sorting (includes bounding box and flags) */
interface SortableMapItem extends MapItem {
  // 3D bounding box (world coordinates)
  xLeft: number; // worldX - xd
  yFar: number; // worldY - yd
  zTop: number; // worldZ + zd

  // Cached shape metadata flags
  sprite: boolean;
  flat: boolean;
  fbigsq: boolean; // large flat square (xd == yd && xd >= 128)
  solid: boolean;
  draw: boolean;
  occl: boolean;
  trans: boolean;
  anim: boolean;
  roof: boolean;
  land: boolean;
  invitem: boolean;
}

/**
 * Parse fixed items from a FIXED.DAT entry (raw buffer of 16-byte records)
 */
export function parseFixedItems(data: Buffer): FixedItem[] {
  const itemSize = 16;
  const count = Math.floor(data.length / itemSize);
  const items: FixedItem[] = [];

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
export function parseGlob(data: Buffer): Glob {
  if (data.length < 2) return { items: [] };

  const itemCount = data.readUInt16LE(0);
  const items: GlobItem[] = [];

  for (let i = 0; i < itemCount; i++) {
    const off = 2 + i * 6;
    if (off + 6 > data.length) break;
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
export function loadGlobs(globFlxPath: string): Glob[] {
  const archive = readFlx(globFlxPath);
  const globs: Glob[] = [];

  for (let i = 0; i < archive.entryCount; i++) {
    const data = getFlxEntryData(archive, i);
    if (data && data.length >= 2) {
      globs.push(parseGlob(data));
    } else {
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
 * @param skipEditorItems - If true, skip items whose shape has editor=true (non-game items)
 */
export function resolveMapItems(
  fixedItems: FixedItem[],
  globs: Glob[],
  typeFlags: ShapeInfo[] | null,
  skipEditorItems: boolean = false,
): MapItem[] {
  const items: MapItem[] = [];

  for (const fi of fixedItems) {
    // Use raw usecode coords directly (NOT multiplied by 2).
    // The C++ reference code passes entry.x, entry.y directly to drawShape.
    const worldX = fi.x;
    const worldY = fi.y;
    const worldZ = fi.z;

    // Check if this is a glob egg
    // The original C++ code checks `type == 0x10` which corresponds to shape 16.
    // ScummVM checks family == SF_GLOBEGG. We support both.
    const isGlobEgg =
      fi.shape === 0x10 ||
      (typeFlags && fi.shape < typeFlags.length && typeFlags[fi.shape].family === ShapeFamily.SF_GLOBEGG);

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

          if (SKIP_SHAPES.has(gi.shape)) continue;
          if (skipEditorItems && typeFlags && gi.shape < typeFlags.length && typeFlags[gi.shape].editor) continue;

          items.push({
            worldX: itemX,
            worldY: itemY,
            worldZ: itemZ,
            shape: gi.shape,
            frame: gi.frame,
          });
        }
      }
    } else {
      if (SKIP_SHAPES.has(fi.shape)) continue;
      if (skipEditorItems && typeFlags && fi.shape < typeFlags.length && typeFlags[fi.shape].editor) continue;

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
 * Enrich a MapItem with bounding box and shape metadata for sorting.
 * Based on ScummVM's SortItem initialization.
 */
function enrichMapItem(item: MapItem, shapeInfo: ShapeInfo | null): SortableMapItem {
  // Calculate footpad world dimensions (shape units to world coords)
  // Per ScummVM: xd = footpad_x * 32, yd = footpad_y * 32, zd = footpad_z * 8
  const xd = shapeInfo ? shapeInfo.x * 32 : 0;
  const yd = shapeInfo ? shapeInfo.y * 32 : 0;
  const zd = shapeInfo ? shapeInfo.z * 8 : 0;

  // 3D bounding box (world coordinates)
  const xLeft = item.worldX - xd;
  const yFar = item.worldY - yd;
  const zTop = item.worldZ + zd;

  // Detect flags from shape metadata
  const flat = zd === 0;
  const fbigsq = xd === yd && xd >= 128;

  return {
    ...item,
    xLeft,
    yFar,
    zTop,
    sprite: false, // TODO: detect from extFlags if available
    flat,
    fbigsq,
    solid: shapeInfo?.solid ?? false,
    draw: shapeInfo?.draw ?? false,
    occl: shapeInfo?.occluded ?? false,
    trans: shapeInfo?.translucent ?? false,
    anim: shapeInfo?.animType !== 0,
    roof: shapeInfo?.roof ?? false,
    land: shapeInfo?.land ?? false,
    invitem: shapeInfo?.family === ShapeFamily.SF_CRUINVITEM,
  };
}

/**
 * Compare two items for painter's algorithm sorting.
 * Returns true if item 'a' should be drawn before (below) item 'b'.
 * Based on ScummVM's SortItem::below() method (sort_item.cpp:64-238).
 */
function below(a: SortableMapItem, b: SortableMapItem): boolean {
  // Rule 1: Sprite separation (non-sprites before sprites)
  if (a.sprite !== b.sprite) {
    return a.sprite < b.sprite;
  }

  // Rule 2: Z-level checks
  if (a.flat && b.flat) {
    // Both flat: simple Z comparison
    if (a.worldZ !== b.worldZ) {
      return a.worldZ < b.worldZ;
    }
  } else if (a.invitem === b.invitem) {
    // Non-flat or both same inventory status: bounding box check
    // Lower item must be below top of upper item
    if (a.zTop <= b.worldZ) return true;
    if (a.worldZ >= b.zTop) return false;
  }

  // Rule 3: Y-axis spatial checks (depth in isometric)
  const yFlat1 = a.yFar === a.worldY;
  const yFlat2 = b.yFar === b.worldY;

  if (yFlat1 && yFlat2) {
    // Both Y-flat: compare with precision loss (32-unit quantization)
    if (Math.floor(a.worldY / 32) !== Math.floor(b.worldY / 32)) {
      return a.worldY < b.worldY;
    }
  } else {
    // Bounding box overlap check
    if (a.worldY <= b.yFar) return true;
    if (a.yFar >= b.worldY) return false;
  }

  // Rule 4: X-axis spatial checks
  const xFlat1 = a.xLeft === a.worldX;
  const xFlat2 = b.xLeft === b.worldX;

  if (xFlat1 && xFlat2) {
    // Both X-flat: compare with precision loss
    if (Math.floor(a.worldX / 32) !== Math.floor(b.worldX / 32)) {
      return a.worldX < b.worldX;
    }
  } else {
    // Bounding box overlap check
    if (a.worldX <= b.xLeft) return true;
    if (a.xLeft >= b.worldX) return false;
  }

  // Rule 5: Z-tolerance (8-unit overlap handling)
  // Per ScummVM line 111-114: handle items that overlap in Z within tolerance
  if (a.zTop - 8 <= b.worldZ && a.worldZ < b.zTop - 8) {
    return true;
  }
  if (a.worldZ >= b.zTop - 8 && a.zTop - 8 > b.worldZ) {
    return false;
  }

  // Rule 6: Flat-specific sorting rules (when either is flat)
  if (a.flat || b.flat) {
    // Lower z-bottom first
    if (a.worldZ !== b.worldZ) {
      return a.worldZ < b.worldZ;
    }

    // Inv items always after
    if (a.invitem !== b.invitem) {
      return a.invitem < b.invitem;
    }

    // Flat before non-flat
    if (a.flat !== b.flat) {
      return a.flat > b.flat;
    }

    // Translucent after opaque
    if (a.trans !== b.trans) {
      return a.trans < b.trans;
    }

    // Animated after static
    if (a.anim !== b.anim) {
      return a.anim < b.anim;
    }

    // Draw first
    if (a.draw !== b.draw) {
      return a.draw > b.draw;
    }

    // Solid first
    if (a.solid !== b.solid) {
      return a.solid > b.solid;
    }

    // Occluders first
    if (a.occl !== b.occl) {
      return a.occl > b.occl;
    }

    // Large flat squares first
    if (a.fbigsq !== b.fbigsq) {
      return a.fbigsq > b.fbigsq;
    }
  }

  // Rule 7: Roof before non-roof
  if (a.roof !== b.roof) {
    return a.roof > b.roof;
  }

  // Rule 8: Z comparison fallback
  if (a.worldZ !== b.worldZ) {
    return a.worldZ < b.worldZ;
  }

  // Rule 9: Isometric depth (X+Y) fallback
  const depthA = a.worldX + a.worldY;
  const depthB = b.worldX + b.worldY;
  if (depthA !== depthB) {
    return depthA < depthB;
  }

  // Rule 10: Shape number for stability
  if (a.shape !== b.shape) {
    return a.shape < b.shape;
  }

  // Final: Frame number
  return a.frame < b.frame;
}

/**
 * Sort map items for painter's algorithm rendering (back-to-front).
 * Uses comprehensive comparison based on ScummVM's sorting logic.
 *
 * @param items - Items to sort
 * @param typeFlags - Shape metadata for bounding box and flag detection
 */
export function sortMapItems(items: MapItem[], typeFlags: ShapeInfo[] | null): MapItem[] {
  // Enrich all items with bounding boxes and flags
  const sortableItems = items.map((item) =>
    enrichMapItem(item, typeFlags && item.shape < typeFlags.length ? typeFlags[item.shape] : null),
  );

  // Sort using comprehensive comparison
  sortableItems.sort((a, b) => {
    if (below(a, b)) return -1;
    if (below(b, a)) return 1;
    return 0;
  });

  // Return sorted items (SortableMapItem extends MapItem, safe to return)
  return sortableItems;
}

/**
 * Mission-to-FIXED.DAT index mapping for Crusader: No Remorse
 */
export const REMORSE_MISSIONS: Record<number, number[]> = {
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
export const REBEL_BASE = 28;
export const REBEL_BASE_DESTROYED = 29;
