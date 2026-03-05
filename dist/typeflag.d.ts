/**
 * TypeFlag parser
 *
 * Reads TYPEFLAG.DAT — shape metadata (dimensions, flags, etc.)
 * Crusader uses 9 bytes per entry (vs 8 for Ultima 8).
 */
export declare enum ShapeFamily {
    SF_GENERIC = 0,
    SF_QUALITY = 1,
    SF_QUANTITY = 2,
    SF_GLOBEGG = 3,
    SF_UNKEGG = 4,
    SF_BREAKABLE = 5,
    SF_CONTAINER = 6,
    SF_MONSTEREGG = 7,
    SF_TELEPORTEGG = 8,
    SF_REAGENT = 9,
    SF_CRUWEAPON = 10,
    SF_CRUAMMO = 11,
    SF_CRUBOMB = 12,
    SF_CRUINVITEM = 13
}
export interface ShapeInfo {
    /** Shape flags */
    fixed: boolean;
    solid: boolean;
    sea: boolean;
    land: boolean;
    occluded: boolean;
    bag: boolean;
    damaging: boolean;
    noisy: boolean;
    draw: boolean;
    ignore: boolean;
    roof: boolean;
    translucent: boolean;
    editor: boolean;
    selectable: boolean;
    preload: boolean;
    sound: boolean;
    targetable: boolean;
    npc: boolean;
    /** Shape family (determines behavior, e.g. glob egg, container, etc.) */
    family: ShapeFamily;
    /** Equipment type */
    equipType: number;
    /** Footpad dimensions (in shape units — multiply x,y by 32 and z by 8 for world coords) */
    x: number;
    y: number;
    z: number;
    /** Animation */
    animType: number;
    animData: number;
    animSpeed: number;
    /** Physical properties */
    weight: number;
    volume: number;
}
/**
 * Load TYPEFLAG.DAT and parse all entries
 */
export declare function loadTypeFlags(filePath: string): ShapeInfo[];
/**
 * Parse typeflag data from buffer (9 bytes per entry for Crusader)
 */
export declare function parseTypeFlags(buf: Buffer): ShapeInfo[];
//# sourceMappingURL=typeflag.d.ts.map