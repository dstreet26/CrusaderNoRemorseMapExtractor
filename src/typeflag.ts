/**
 * TypeFlag parser
 *
 * Reads TYPEFLAG.DAT — shape metadata (dimensions, flags, etc.)
 * Crusader uses 9 bytes per entry (vs 8 for Ultima 8).
 */

import * as fs from "fs";

export enum ShapeFamily {
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
  SF_CRUINVITEM = 13,
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
export function loadTypeFlags(filePath: string): ShapeInfo[] {
  const buf = fs.readFileSync(filePath);
  return parseTypeFlags(buf);
}

/**
 * Parse typeflag data from buffer (9 bytes per entry for Crusader)
 */
export function parseTypeFlags(buf: Buffer): ShapeInfo[] {
  const entrySize = 9;
  const count = Math.floor(buf.length / entrySize);
  const infos: ShapeInfo[] = [];

  for (let i = 0; i < count; i++) {
    const offset = i * entrySize;
    const d = buf.subarray(offset, offset + entrySize);

    // Byte 0: flags low
    const fixed = !!(d[0] & 0x01);
    const solid = !!(d[0] & 0x02);
    const sea = !!(d[0] & 0x04);
    const land = !!(d[0] & 0x08);
    const occluded = !!(d[0] & 0x10);
    const bag = !!(d[0] & 0x20);
    const damaging = !!(d[0] & 0x40);
    const noisy = !!(d[0] & 0x80);

    // Byte 1: flags mid + family low
    const draw = !!(d[1] & 0x01);
    const ignore = !!(d[1] & 0x02);
    const roof = !!(d[1] & 0x04);
    const translucent = !!(d[1] & 0x08);

    // Family: 5 bits spanning bytes 1-2
    const family: ShapeFamily = ((d[1] >> 4) | ((d[2] & 1) << 4));

    // Equip type: 4 bits in byte 2
    const equipType = (d[2] >> 1) & 0x0f;

    // x: 5 bits spanning bytes 2-3
    const x = ((d[3] << 3) | (d[2] >> 5)) & 0x1f;

    // y: 5 bits in byte 3
    const y = (d[3] >> 2) & 0x1f;

    // z: 5 bits spanning bytes 3-4
    const z = ((d[4] << 1) | (d[3] >> 7)) & 0x1f;

    // Animation: byte 4-5
    const animType = d[4] >> 4;
    const animData = d[5] & 0x0f;
    const animSpeed = d[5] >> 4;

    // Byte 6: Crusader-specific flags
    const editor = !!(d[6] & 0x01);
    const selectable = !!(d[6] & 0x02);
    const preload = !!(d[6] & 0x04);
    const sound = !!(d[6] & 0x08);
    const targetable = !!(d[6] & 0x10);
    const npc = !!(d[6] & 0x20);

    // Byte 7-8: weight, volume
    const weight = d[7];
    const volume = d[8];

    infos.push({
      fixed, solid, sea, land, occluded, bag, damaging, noisy,
      draw, ignore, roof, translucent,
      editor, selectable, preload, sound, targetable, npc,
      family, equipType,
      x, y, z,
      animType, animData, animSpeed,
      weight, volume,
    });
  }

  return infos;
}
