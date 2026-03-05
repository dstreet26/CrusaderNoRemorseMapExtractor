/**
 * FLX Archive Parser
 *
 * Reads Crusader: No Remorse .FLX archive files.
 * FLX is a simple indexed container format used by the Ultima 8 / Crusader engine.
 *
 * Layout:
 *   0x00 - 0x51: 82-byte header (text identifier padded with 0x1A)
 *   0x52 - 0x53: unknown (2 bytes)
 *   0x54 - 0x57: entry count (uint32 LE)
 *   0x58 - 0x7F: padding
 *   0x80+:        index table — 8 bytes per entry (offset:u32, size:u32)
 */

import * as fs from "fs";

const FLEX_TABLE_OFFSET = 0x80;

export interface FlxEntry {
  offset: number;
  size: number;
}

export interface FlxArchive {
  headerText: string;
  entryCount: number;
  entries: FlxEntry[];
  buffer: Buffer;
}

/**
 * Parse a FLX archive from a file path
 */
export function readFlx(filePath: string): FlxArchive {
  const buffer = fs.readFileSync(filePath);
  return parseFlx(buffer);
}

/**
 * Parse a FLX archive from a Buffer
 */
export function parseFlx(buffer: Buffer): FlxArchive {
  // Read header text (first 82 bytes, terminated by 0x1A padding)
  let headerEnd = 0;
  for (let i = 0; i < 0x52; i++) {
    if (buffer[i] === 0x1a) {
      headerEnd = i;
      break;
    }
  }
  const headerText = buffer.subarray(0, headerEnd).toString("ascii");

  // Entry count at offset 0x54
  const entryCount = buffer.readUInt32LE(0x54);

  // Read index table at 0x80
  const entries: FlxEntry[] = [];
  for (let i = 0; i < entryCount; i++) {
    const tableOffset = FLEX_TABLE_OFFSET + i * 8;
    const offset = buffer.readUInt32LE(tableOffset);
    const size = buffer.readUInt32LE(tableOffset + 4);
    entries.push({ offset, size });
  }

  return { headerText, entryCount, entries, buffer };
}

/**
 * Get the raw data for a specific entry index
 */
export function getFlxEntryData(archive: FlxArchive, index: number): Buffer | null {
  if (index < 0 || index >= archive.entries.length) return null;
  const entry = archive.entries[index];
  if (entry.offset === 0 || entry.size === 0) return null;
  return archive.buffer.subarray(entry.offset, entry.offset + entry.size);
}
