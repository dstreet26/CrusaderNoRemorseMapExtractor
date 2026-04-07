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

import type { Palette } from "./palette";

export interface ShapeFrame {
  width: number;
  height: number;
  xOffset: number; // hotspot offset
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
export function parseShape(data: Buffer, palette: Palette): Shape {
  if (data.length < 6) {
    return { frameCount: 0, frames: [] };
  }

  // Shape header: 6 bytes
  const frameCount = data.readUInt16LE(4);

  const frames: ShapeFrame[] = [];

  for (let f = 0; f < frameCount; f++) {
    // Frame directory entry at offset 6 + f*8
    const dirOffset = 6 + f * 8;
    if (dirOffset + 8 > data.length) break;

    const frameOffset = data.readUInt32LE(dirOffset) & 0x7fffffff;

    if (frameOffset + 28 > data.length) {
      frames.push({ width: 0, height: 0, xOffset: 0, yOffset: 0, compression: 0, pixels: Buffer.alloc(0) });
      continue;
    }

    // Frame data header: 28 bytes
    // bytes 0-7: unknown (imageId, frameId, absoluteOffset)
    const compression = data.readUInt32LE(frameOffset + 8);
    const width = data.readUInt32LE(frameOffset + 12);
    const height = data.readUInt32LE(frameOffset + 16);
    const xOff = data.readInt32LE(frameOffset + 20);
    const yOff = data.readInt32LE(frameOffset + 24);

    if (width === 0 || height === 0 || width > 4096 || height > 4096) {
      frames.push({ width: 0, height: 0, xOffset: xOff, yOffset: yOff, compression, pixels: Buffer.alloc(0) });
      continue;
    }

    // Row offsets table starts at frameOffset + 28
    const rowOffsetsStart = frameOffset + 28;

    // Decode pixels
    const pixels = Buffer.alloc(width * height * 4, 0); // RGBA, fully transparent

    for (let row = 0; row < height; row++) {
      if (rowOffsetsStart + (row + 1) * 4 > data.length) break;

      const rowRelOffset = data.readUInt32LE(rowOffsetsStart + row * 4);
      // The row offset is relative to the address of rowOffsets[row] itself
      const rowDataStart = rowOffsetsStart + row * 4 + rowRelOffset;

      let x = 0;
      let pos = rowDataStart;

      while (x < width && pos < data.length) {
        // Skip transparent pixels
        const skip = data[pos++];
        x += skip;
        if (x >= width) break;

        if (pos >= data.length) break;
        let dlen = data[pos++];
        let type = 0;

        if (compression === 1) {
          type = dlen & 1;
          dlen >>= 1;
        }

        if (dlen === 0) continue;

        if (type === 0) {
          // Literal run: read dlen individual pixels
          for (let n = 0; n < dlen && x < width; n++, x++) {
            if (pos >= data.length) break;
            const colorIdx = data[pos++];
            const color = palette[colorIdx] || { r: 0, g: 0, b: 0, a: 255 };
            const pixIdx = (row * width + x) * 4;
            pixels[pixIdx] = color.r;
            pixels[pixIdx + 1] = color.g;
            pixels[pixIdx + 2] = color.b;
            pixels[pixIdx + 3] = color.a;
          }
        } else {
          // RLE fill: read 1 pixel, repeat dlen times
          if (pos >= data.length) break;
          const colorIdx = data[pos++];
          const color = palette[colorIdx] || { r: 0, g: 0, b: 0, a: 255 };
          for (let n = 0; n < dlen && x < width; n++, x++) {
            const pixIdx = (row * width + x) * 4;
            pixels[pixIdx] = color.r;
            pixels[pixIdx + 1] = color.g;
            pixels[pixIdx + 2] = color.b;
            pixels[pixIdx + 3] = color.a;
          }
        }
      }
    }

    frames.push({
      width,
      height,
      xOffset: xOff,
      yOffset: yOff,
      compression,
      pixels,
    });
  }

  return { frameCount, frames };
}
