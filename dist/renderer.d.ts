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
import { type Palette, type Color } from "./palette";
import { type MapItem } from "./map";
import { type FlxArchive } from "./flx";
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
}
/**
 * Render map items to an image.
 *
 * - Small images: single PNG (returned as Buffer).
 * - Large images: PNG tiles written to an output folder.
 */
export declare function renderMap(items: MapItem[], shapesArchive: FlxArchive, palette: Palette, options?: RenderOptions): Promise<Buffer>;
/**
 * Render a single shape+frame to a PNG buffer (for debugging/visualization)
 */
export declare function renderShapeToPng(shapesArchive: FlxArchive, palette: Palette, shapeIdx: number, frameIdx: number): Promise<Buffer | null>;
//# sourceMappingURL=renderer.d.ts.map