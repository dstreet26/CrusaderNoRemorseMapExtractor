"use strict";
/**
 * GameData — Central loader for all Crusader: No Remorse game data files
 *
 * Loads and caches:
 *   - SHAPES.FLX (shape archive)
 *   - FIXED.DAT (map data archive)
 *   - GLOB.FLX (glob prefabs)
 *   - GAMEPAL.PAL (palette)
 *   - TYPEFLAG.DAT (shape metadata)
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
exports.loadGameData = loadGameData;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const flx_1 = require("./flx");
const palette_1 = require("./palette");
const typeflag_1 = require("./typeflag");
const map_1 = require("./map");
/**
 * Load all game data from a Crusader: No Remorse installation directory.
 * The directory should contain a STATIC/ subfolder.
 */
function loadGameData(baseDir) {
    const staticDir = path.join(baseDir, "STATIC");
    // Verify STATIC directory exists
    if (!fs.existsSync(staticDir)) {
        throw new Error(`STATIC directory not found at: ${staticDir}`);
    }
    // Find files case-insensitively
    const staticFiles = fs.readdirSync(staticDir);
    const findFile = (name) => {
        const found = staticFiles.find((f) => f.toUpperCase() === name.toUpperCase());
        if (!found)
            throw new Error(`File not found in STATIC: ${name}`);
        return path.join(staticDir, found);
    };
    console.log("Loading game data...");
    // Load palette
    let palette;
    try {
        const palPath = findFile("GAMEPAL.PAL");
        palette = (0, palette_1.loadPalette)(palPath);
        console.log("  Loaded GAMEPAL.PAL");
    }
    catch {
        console.log("  GAMEPAL.PAL not found, using hardcoded palette");
        palette = (0, palette_1.getHardcodedPalette)();
    }
    // Load shapes archive
    const shapesPath = findFile("SHAPES.FLX");
    const shapesArchive = (0, flx_1.readFlx)(shapesPath);
    console.log(`  Loaded SHAPES.FLX (${shapesArchive.entryCount} shapes)`);
    // Load fixed data archive (maps)
    const fixedPath = findFile("FIXED.DAT");
    const fixedArchive = (0, flx_1.readFlx)(fixedPath);
    console.log(`  Loaded FIXED.DAT (${fixedArchive.entryCount} maps)`);
    // Load globs
    const globPath = findFile("GLOB.FLX");
    const globs = (0, map_1.loadGlobs)(globPath);
    console.log(`  Loaded GLOB.FLX (${globs.length} globs)`);
    // Load type flags
    const typeFlagPath = findFile("TYPEFLAG.DAT");
    const typeFlags = (0, typeflag_1.loadTypeFlags)(typeFlagPath);
    console.log(`  Loaded TYPEFLAG.DAT (${typeFlags.length} shapes)`);
    console.log("Game data loaded successfully.");
    return {
        baseDir,
        palette,
        shapesArchive,
        fixedArchive,
        globs,
        typeFlags,
    };
}
//# sourceMappingURL=gamedata.js.map