"use strict";
/**
 * TypeFlag parser
 *
 * Reads TYPEFLAG.DAT — shape metadata (dimensions, flags, etc.)
 * Crusader uses 9 bytes per entry (vs 8 for Ultima 8).
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
exports.ShapeFamily = void 0;
exports.loadTypeFlags = loadTypeFlags;
exports.parseTypeFlags = parseTypeFlags;
const fs = __importStar(require("fs"));
var ShapeFamily;
(function (ShapeFamily) {
    ShapeFamily[ShapeFamily["SF_GENERIC"] = 0] = "SF_GENERIC";
    ShapeFamily[ShapeFamily["SF_QUALITY"] = 1] = "SF_QUALITY";
    ShapeFamily[ShapeFamily["SF_QUANTITY"] = 2] = "SF_QUANTITY";
    ShapeFamily[ShapeFamily["SF_GLOBEGG"] = 3] = "SF_GLOBEGG";
    ShapeFamily[ShapeFamily["SF_UNKEGG"] = 4] = "SF_UNKEGG";
    ShapeFamily[ShapeFamily["SF_BREAKABLE"] = 5] = "SF_BREAKABLE";
    ShapeFamily[ShapeFamily["SF_CONTAINER"] = 6] = "SF_CONTAINER";
    ShapeFamily[ShapeFamily["SF_MONSTEREGG"] = 7] = "SF_MONSTEREGG";
    ShapeFamily[ShapeFamily["SF_TELEPORTEGG"] = 8] = "SF_TELEPORTEGG";
    ShapeFamily[ShapeFamily["SF_REAGENT"] = 9] = "SF_REAGENT";
    ShapeFamily[ShapeFamily["SF_CRUWEAPON"] = 10] = "SF_CRUWEAPON";
    ShapeFamily[ShapeFamily["SF_CRUAMMO"] = 11] = "SF_CRUAMMO";
    ShapeFamily[ShapeFamily["SF_CRUBOMB"] = 12] = "SF_CRUBOMB";
    ShapeFamily[ShapeFamily["SF_CRUINVITEM"] = 13] = "SF_CRUINVITEM";
})(ShapeFamily || (exports.ShapeFamily = ShapeFamily = {}));
/**
 * Load TYPEFLAG.DAT and parse all entries
 */
function loadTypeFlags(filePath) {
    const buf = fs.readFileSync(filePath);
    return parseTypeFlags(buf);
}
/**
 * Parse typeflag data from buffer (9 bytes per entry for Crusader)
 */
function parseTypeFlags(buf) {
    const entrySize = 9;
    const count = Math.floor(buf.length / entrySize);
    const infos = [];
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
        const family = ((d[1] >> 4) | ((d[2] & 1) << 4));
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
//# sourceMappingURL=typeflag.js.map