/**
 * Palette loader
 *
 * Reads GAMEPAL.PAL — 768 bytes, 256 colors × 3 bytes (R, G, B).
 * Values are VGA 6-bit (0–63), converted to 8-bit (0–255).
 */
export interface Color {
    r: number;
    g: number;
    b: number;
    a: number;
}
export type Palette = Color[];
/**
 * Load a .PAL file (768 bytes, VGA 6-bit per channel)
 */
export declare function loadPalette(filePath: string): Palette;
/**
 * Parse palette from buffer
 */
export declare function parsePalette(buf: Buffer): Palette;
/**
 * Hardcoded palette from the existing C++ leveldraw tool.
 * Values are 6-bit VGA (0-63). This serves as a fallback.
 */
export declare function getHardcodedPalette(): Palette;
//# sourceMappingURL=palette.d.ts.map