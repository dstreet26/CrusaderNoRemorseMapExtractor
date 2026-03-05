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
export declare function readFlx(filePath: string): FlxArchive;
/**
 * Parse a FLX archive from a Buffer
 */
export declare function parseFlx(buffer: Buffer): FlxArchive;
/**
 * Get the raw data for a specific entry index
 */
export declare function getFlxEntryData(archive: FlxArchive, index: number): Buffer | null;
//# sourceMappingURL=flx.d.ts.map