/**
 * Shape / Sprite Parser
 *
 * Reads Crusader: No Remorse shape data from SHAPES.FLX entries.
 *
 * Crusader Shape Format:
 *   Shape header (6 bytes):
 *     [0-1] maxX (u16le) - unused for rendering
 *     [2-3] maxY (u16le) - unused for rendering
 *     [4-5] frameCount (u16le)
 *
 *   Frame directory (8 bytes per frame):
 *     [0-3] frameOffset (u32le, mask with 0x7FFFFFFF - top bit ignored)
 *     [4-7] frameSize (u32le)
 *
 *   Per-frame data (at frameOffset, 28-byte header + row offsets + pixel data):
 *     [0-1]   imageId (u16le) - unknown
 *     [2-3]   frameId (u16le) - unknown
 *     [4-7]   absoluteOffset (u32le) - unknown
 *     [8-11]  compression (u32le) - 0=uncompressed, 1=RLE
 *     [12-15] width (u32le)
 *     [16-19] height (u32le)
 *     [20-23] xOffset (i32le) - hotspot X
 *     [24-27] yOffset (i32le) - hotspot Y
 *     [28+]   rowOffsets (u32le × height) - offset from rowOffsets[row] to scanline data
 *
 *   RLE scanline decoding:
 *     1. Read skip byte → advance X by skip pixels (transparent)
 *     2. If X >= width, line done
 *     3. Read dlen byte
 *     4. If compressed: type = dlen & 1, dlen >>= 1
 *        type=0: read dlen literal pixel bytes
 *        type=1: read 1 pixel byte, repeat dlen times
 *     5. Advance X by dlen
 *     6. Goto 1
 */
import { type Palette } from "./palette";
export interface ShapeFrame {
    width: number;
    height: number;
    xOffset: number;
    yOffset: number;
    compression: number;
    /** Decoded RGBA pixel data (width × height × 4 bytes) */
    pixels: Buffer;
}
export interface Shape {
    frameCount: number;
    frames: ShapeFrame[];
}
/**
 * Parse a shape from its raw FLX entry data
 */
export declare function parseShape(data: Buffer, palette: Palette): Shape;
/**
 * Render a single shape frame to a standalone RGBA buffer for debugging/visualization
 */
export declare function renderFrameToRGBA(frame: ShapeFrame): {
    data: Buffer;
    width: number;
    height: number;
};
//# sourceMappingURL=shape.d.ts.map