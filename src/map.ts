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
  // Sorting coordinates in ScummVM internal space (2x usecode for X/Y, Z unchanged).
  // worldX/worldY (from MapItem) are preserved in usecode space for rendering.
  _x: number; // worldX * 2
  _y: number; // worldY * 2
  _z: number; // worldZ (unchanged)

  // 3D bounding box (ScummVM internal coordinates)
  xLeft: number; // _x - xd
  yFar: number; // _y - yd
  zTop: number; // _z + zd

  // Full screenspace bounding box (camera offset cancels in comparisons)
  sxLeft: number; // xLeft/4 - _y/4          (LNT x)
  sxRight: number; // _x/4 - yFar/4          (RFT x)
  sxTop: number; // xLeft/4 - yFar/4         (LFT x)
  syTop: number; // xLeft/8 + yFar/8 - zTop  (LFT y)
  sxBot: number; // _x/4 - _y/4              (RNB x)
  syBot: number; // _x/8 + _y/8 - _z         (RNB y)

  // Screenspace rect (for fast overlap rejection)
  srLeft: number;
  srTop: number;
  srRight: number;
  srBottom: number;

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
    // Use raw usecode coords (NOT multiplied by 2 like ScummVM's World_FromUsecodeXY).
    // The isometric projection and glob expansion formulas account for this.
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
          // Crusader glob coordinate expansion (matching ScummVM glob_egg.cpp:42-71):
          // World space: itemx = (egg_x & ~0x3FF) + glob_x * 4 + 2
          // We work in usecode space (no ×2), so equivalent formula:
          //   itemx = (egg_uc_x & ~0x1FF) + glob_x * 2 + 1
          const itemX = (worldX & ~0x1ff) + gi.x * 2 + 1;
          const itemY = (worldY & ~0x1ff) + gi.y * 2 + 1;
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
  // Convert to ScummVM internal coordinates (2x usecode for Crusader X/Y, Z unchanged)
  const _x = item.worldX * 2;
  const _y = item.worldY * 2;
  const _z = item.worldZ;

  // Footpad world dimensions (ScummVM internal coord space)
  // Per ScummVM ShapeInfo::getFootpadWorld: xd = footpad_x * 32, yd = footpad_y * 32, zd = footpad_z * 8
  const xd = shapeInfo ? shapeInfo.x * 32 : 0;
  const yd = shapeInfo ? shapeInfo.y * 32 : 0;
  const zd = shapeInfo ? shapeInfo.z * 8 : 0;

  // 3D bounding box (ScummVM internal coordinates)
  const xLeft = _x - xd;
  const yFar = _y - yd;
  const zTop = _z + zd;

  // Detect flags from shape metadata
  const flat = zd === 0;
  const fbigsq = xd === yd && xd >= 128;

  // Full screenspace bounding box (camera offset cancels in comparisons, so omitted)
  // Per ScummVM setBoxBounds (sort_item.cpp:27-62)
  const sxLeft = Math.floor(xLeft / 4) - Math.floor(_y / 4);
  const sxRight = Math.floor(_x / 4) - Math.floor(yFar / 4);
  const sxTop = Math.floor(xLeft / 4) - Math.floor(yFar / 4);
  const syTop = Math.floor(xLeft / 8) + Math.floor(yFar / 8) - zTop;
  const sxBot = Math.floor(_x / 4) - Math.floor(_y / 4);
  const syBot = Math.floor(_x / 8) + Math.floor(_y / 8) - _z;

  // Screenspace rect
  const srLeft = sxLeft;
  const srTop = syTop;
  const srRight = sxRight + 1;
  const srBottom = syBot + 1;

  return {
    ...item,
    _x,
    _y,
    _z,
    xLeft,
    yFar,
    zTop,
    sxLeft,
    sxRight,
    sxTop,
    syTop,
    sxBot,
    syBot,
    srLeft,
    srTop,
    srRight,
    srBottom,
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
 * Faithfully matches ScummVM's SortItem::below() (sort_item.cpp:64-238).
 *
 * NOTE: C++ integer division truncates toward zero; JS Math.floor rounds toward
 * negative infinity. For the non-negative coordinates used here, they are equivalent.
 */
function below(a: SortableMapItem, b: SortableMapItem): boolean {
  // All comparisons use _x/_y/_z (ScummVM internal coords), NOT worldX/worldY/worldZ.

  // Sprite separation (non-sprites before sprites)
  if (a.sprite !== b.sprite) return a.sprite < b.sprite;

  // Check clearly in Z
  if (a.flat && b.flat) {
    if (a._z !== b._z) return a._z < b._z;
  } else if (a.invitem === b.invitem) {
    if (a.zTop <= b._z) return true;
    if (a._z >= b.zTop) return false;
  }

  // Check clearly in Y
  const yFlat1 = a.yFar === a._y;
  const yFlat2 = b.yFar === b._y;
  if (yFlat1 && yFlat2) {
    if (Math.floor(a._y / 32) !== Math.floor(b._y / 32)) return a._y < b._y;
  } else {
    if (a._y <= b.yFar) return true;
    if (a.yFar >= b._y) return false;
  }

  // Check clearly in X
  const xFlat1 = a.xLeft === a._x;
  const xFlat2 = b.xLeft === b._x;
  if (xFlat1 && xFlat2) {
    if (Math.floor(a._x / 32) !== Math.floor(b._x / 32)) return a._x < b._x;
  } else {
    if (a._x <= b.xLeft) return true;
    if (a.xLeft >= b._x) return false;
  }

  // Z tolerance (8-unit overlap handling)
  if (a.zTop - 8 <= b._z && a._z < b.zTop - 8) return true;
  if (a._z >= b.zTop - 8 && a.zTop - 8 > b._z) return false;

  // Y-flat vs non-flat handling (ScummVM lines 116-128)
  if (yFlat1 !== yFlat2) {
    if (Math.floor(a._y / 32) <= Math.floor(b.yFar / 32)) return true;
    if (Math.floor(a.yFar / 32) >= Math.floor(b._y / 32)) return false;

    const yCenter1 = Math.floor((Math.floor(a.yFar / 32) + Math.floor(a._y / 32)) / 2);
    const yCenter2 = Math.floor((Math.floor(b.yFar / 32) + Math.floor(b._y / 32)) / 2);
    if (yCenter1 !== yCenter2) return yCenter1 < yCenter2;
  }

  // X-flat vs non-flat handling (ScummVM lines 130-142)
  if (xFlat1 !== xFlat2) {
    if (Math.floor(a._x / 32) <= Math.floor(b.xLeft / 32)) return true;
    if (Math.floor(a.xLeft / 32) >= Math.floor(b._x / 32)) return false;

    const xCenter1 = Math.floor((Math.floor(a.xLeft / 32) + Math.floor(a._x / 32)) / 2);
    const xCenter2 = Math.floor((Math.floor(b.xLeft / 32) + Math.floor(b._x / 32)) / 2);
    if (xCenter1 !== xCenter2) return xCenter1 < xCenter2;
  }

  // Specialist z-flat handling
  if (a.flat || b.flat) {
    if (a._z !== b._z) return a._z < b._z;
    if (a.invitem !== b.invitem) return a.invitem < b.invitem;
    if (a.flat !== b.flat) return a.flat > b.flat;
    if (a.trans !== b.trans) return a.trans < b.trans;
    if (a.anim !== b.anim) return a.anim < b.anim;
    if (a.draw !== b.draw) return a.draw > b.draw;
    if (a.solid !== b.solid) return a.solid > b.solid;
    if (a.occl !== b.occl) return a.occl > b.occl;
    if (a.fbigsq !== b.fbigsq) return a.fbigsq > b.fbigsq;
  }

  // Same-location translucent handling (ScummVM lines 183-188)
  if (a._x === b._x && a._y === b._y) {
    if (a.trans !== b.trans) return a.trans < b.trans;
  }

  // Land before roof (ScummVM lines 194-196)
  if (a.land && b.land && a.roof !== b.roof) return a.roof < b.roof;

  // Roof always drawn first (ScummVM lines 198-200)
  if (a.roof !== b.roof) return a.roof > b.roof;

  // Lower z-bottom drawn before
  if (a._z !== b._z) return a._z < b._z;

  // Screenspace fallback for flat items (ScummVM lines 206-214)
  if (xFlat1 || xFlat2 || yFlat1 || yFlat2) {
    if (a.sxLeft !== b.sxLeft) return a.sxLeft > b.sxLeft;
    if (a.syBot !== b.syBot) return a.syBot < b.syBot;
  }

  // Partial in X + Y front
  if (a._x + a._y !== b._x + b._y) return a._x + a._y < b._x + b._y;

  // Partial in X + Y back
  if (a.xLeft + a.yFar !== b.xLeft + b.yFar) return a.xLeft + a.yFar < b.xLeft + b.yFar;

  // Partial in Y
  if (a._y !== b._y) return a._y < b._y;

  // Partial in X
  if (a._x !== b._x) return a._x < b._x;

  // Shape number for stability
  if (a.shape !== b.shape) return a.shape < b.shape;

  // Frame number
  return a.frame < b.frame;
}

/**
 * Screenspace overlap check matching ScummVM's SortItem::overlap() (sort_item.h:306-341).
 * Uses isometric diamond normals to test if two items' screen projections overlap.
 */
function overlap(a: SortableMapItem, b: SortableMapItem): boolean {
  // Fast rect rejection
  if (a.srRight <= b.srLeft || a.srLeft >= b.srRight || a.srBottom <= b.srTop || a.srTop >= b.srBottom) {
    return false;
  }

  const ptTopDx = a.sxTop - b.sxBot;
  const ptTopDy = a.syTop - b.syBot;
  const ptBotDx = a.sxBot - b.sxTop;
  const ptBotDy = a.syBot - b.syTop;

  // Dot products with isometric diamond edge normals
  const dotTopLeft = ptTopDx + ptTopDy * 2;
  const dotTopRight = -ptTopDx + ptTopDy * 2;
  const dotBotLeft = ptBotDx - ptBotDy * 2;
  const dotBotRight = -ptBotDx - ptBotDy * 2;

  const rightClear = a.sxRight <= b.sxLeft;
  const leftClear = a.sxLeft >= b.sxRight;
  const topLeftClear = dotTopLeft >= 0;
  const topRightClear = dotTopRight >= 0;
  const botLeftClear = dotBotLeft >= 0;
  const botRightClear = dotBotRight >= 0;

  const clear = rightClear || leftClear || botRightClear || botLeftClear || topRightClear || topLeftClear;
  return !clear;
}

/**
 * Sort map items for painter's algorithm rendering (back-to-front).
 * Uses dependency graph + topological DFS matching ScummVM's ItemSorter
 * (item_sorter.cpp:190-244 for graph building, 404-506 for DFS painting).
 *
 * @param items - Items to sort
 * @param typeFlags - Shape metadata for bounding box and flag detection
 */
export function sortMapItems(items: MapItem[], typeFlags: ShapeInfo[] | null): MapItem[] {
  const n = items.length;
  if (n === 0) return [];

  // Enrich all items with bounding boxes and flags
  const sortable = items.map((item) =>
    enrichMapItem(item, typeFlags && item.shape < typeFlags.length ? typeFlags[item.shape] : null),
  );

  // Initial sort by listLessThan (sprite, z, flat) for stable insertion order
  sortable.sort((a, b) => {
    if (a.sprite !== b.sprite) return a.sprite < b.sprite ? -1 : 1;
    if (a._z !== b._z) return a._z - b._z;
    if (a.flat !== b.flat) return a.flat > b.flat ? -1 : 1;
    return 0;
  });

  // Build dependency graph: depends[i] = indices of items that must be drawn before item i
  const depends: number[][] = new Array(n);
  for (let i = 0; i < n; i++) depends[i] = [];

  for (let i = 0; i < n; i++) {
    const si = sortable[i];
    for (let j = i + 1; j < n; j++) {
      const sj = sortable[j];
      if (overlap(si, sj)) {
        if (below(si, sj)) {
          // si is behind sj → sj depends on si
          depends[j].push(i);
        } else {
          // sj is behind si → si depends on sj
          depends[i].push(j);
        }
      }
    }
  }

  // Topological DFS to determine paint order
  const result: MapItem[] = [];
  const visited = new Uint8Array(n); // 0=unvisited, 1=in-progress, 2=done

  function visit(idx: number): void {
    if (visited[idx] === 2) return;
    if (visited[idx] === 1) return; // cycle — break it (matches ScummVM behavior)
    visited[idx] = 1;
    for (const dep of depends[idx]) {
      visit(dep);
    }
    visited[idx] = 2;
    result.push(sortable[idx]);
  }

  for (let i = 0; i < n; i++) {
    visit(i);
  }

  return result;
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
