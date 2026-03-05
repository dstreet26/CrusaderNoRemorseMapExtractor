/**
 * Map / Level Parser
 *
 * Reads FIXED.DAT (FLX archive) and GLOB.FLX to load level data.
 *
 * Each FIXED.DAT entry contains a level's fixed items (16 bytes each).
 * Glob eggs (shape family 3) reference prefab groups in GLOB.FLX.
 */
import { type ShapeInfo } from "./typeflag";
/** Raw fixed item as stored in FIXED.DAT */
export interface FixedItem {
    x: number;
    y: number;
    z: number;
    shape: number;
    frame: number;
    flags: number;
    quality: number;
    npcNum: number;
    mapNum: number;
    next: number;
}
/** Glob entry (sub-item within a glob prefab) */
export interface GlobItem {
    x: number;
    y: number;
    z: number;
    shape: number;
    frame: number;
}
/** Glob prefab */
export interface Glob {
    items: GlobItem[];
}
/** Resolved map item ready for rendering */
export interface MapItem {
    worldX: number;
    worldY: number;
    worldZ: number;
    shape: number;
    frame: number;
}
/**
 * Parse fixed items from a FIXED.DAT entry (raw buffer of 16-byte records)
 */
export declare function parseFixedItems(data: Buffer): FixedItem[];
/**
 * Parse a single glob entry from GLOB.FLX
 */
export declare function parseGlob(data: Buffer): Glob;
/**
 * Load all globs from GLOB.FLX
 */
export declare function loadGlobs(globFlxPath: string): Glob[];
/**
 * Resolve a level's fixed items into renderable MapItems.
 * Expands glob eggs into their constituent items.
 *
 * @param fixedItems - Raw items from FIXED.DAT
 * @param globs - All parsed globs from GLOB.FLX
 * @param typeFlags - Shape metadata for family identification
 * @param skipNonDrawable - If true, skip items whose shape has draw=false
 */
export declare function resolveMapItems(fixedItems: FixedItem[], globs: Glob[], typeFlags: ShapeInfo[] | null, skipNonDrawable?: boolean): MapItem[];
/**
 * Sort map items for painter's algorithm rendering (back-to-front).
 * Sort by Z ascending, then by (x+y) ascending for depth.
 */
export declare function sortMapItems(items: MapItem[]): MapItem[];
/**
 * Mission-to-FIXED.DAT index mapping for Crusader: No Remorse
 */
export declare const REMORSE_MISSIONS: Record<number, number[]>;
/** Special map indices */
export declare const REBEL_BASE = 28;
export declare const REBEL_BASE_DESTROYED = 29;
//# sourceMappingURL=map.d.ts.map