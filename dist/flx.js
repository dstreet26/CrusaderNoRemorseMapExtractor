"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.readFlx = readFlx;
exports.parseFlx = parseFlx;
exports.getFlxEntryData = getFlxEntryData;
const fs = __importStar(require("fs"));
const FLEX_TABLE_OFFSET = 0x80;
/**
 * Parse a FLX archive from a file path
 */
function readFlx(filePath) {
    const buffer = fs.readFileSync(filePath);
    return parseFlx(buffer);
}
/**
 * Parse a FLX archive from a Buffer
 */
function parseFlx(buffer) {
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
    const entries = [];
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
function getFlxEntryData(archive, index) {
    if (index < 0 || index >= archive.entries.length)
        return null;
    const entry = archive.entries[index];
    if (entry.offset === 0 || entry.size === 0)
        return null;
    return archive.buffer.subarray(entry.offset, entry.offset + entry.size);
}
//# sourceMappingURL=flx.js.map