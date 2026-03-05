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

import * as path from "path";
import * as fs from "fs";
import { readFlx, type FlxArchive } from "./flx";
import { loadPalette, getHardcodedPalette, type Palette } from "./palette";
import { loadTypeFlags, type ShapeInfo } from "./typeflag";
import { loadGlobs, type Glob } from "./map";

export interface GameData {
  /** Base directory containing STATIC/, USECODE/, etc. */
  baseDir: string;

  /** Palette (from GAMEPAL.PAL) */
  palette: Palette;

  /** Shape archive (SHAPES.FLX) */
  shapesArchive: FlxArchive;

  /** Fixed data archive (FIXED.DAT) — contains level map data */
  fixedArchive: FlxArchive;

  /** Glob prefabs (GLOB.FLX) */
  globs: Glob[];

  /** Shape type flags (TYPEFLAG.DAT) */
  typeFlags: ShapeInfo[];
}

/**
 * Load all game data from a Crusader: No Remorse installation directory.
 * The directory should contain a STATIC/ subfolder.
 */
export function loadGameData(baseDir: string): GameData {
  const staticDir = path.join(baseDir, "STATIC");

  // Verify STATIC directory exists
  if (!fs.existsSync(staticDir)) {
    throw new Error(`STATIC directory not found at: ${staticDir}`);
  }

  // Find files case-insensitively
  const staticFiles = fs.readdirSync(staticDir);
  const findFile = (name: string): string => {
    const found = staticFiles.find((f) => f.toUpperCase() === name.toUpperCase());
    if (!found) throw new Error(`File not found in STATIC: ${name}`);
    return path.join(staticDir, found);
  };

  console.log("Loading game data...");

  // Load palette
  let palette: Palette;
  try {
    const palPath = findFile("GAMEPAL.PAL");
    palette = loadPalette(palPath);
    console.log("  Loaded GAMEPAL.PAL");
  } catch {
    console.log("  GAMEPAL.PAL not found, using hardcoded palette");
    palette = getHardcodedPalette();
  }

  // Load shapes archive
  const shapesPath = findFile("SHAPES.FLX");
  const shapesArchive = readFlx(shapesPath);
  console.log(`  Loaded SHAPES.FLX (${shapesArchive.entryCount} shapes)`);

  // Load fixed data archive (maps)
  const fixedPath = findFile("FIXED.DAT");
  const fixedArchive = readFlx(fixedPath);
  console.log(`  Loaded FIXED.DAT (${fixedArchive.entryCount} maps)`);

  // Load globs
  const globPath = findFile("GLOB.FLX");
  const globs = loadGlobs(globPath);
  console.log(`  Loaded GLOB.FLX (${globs.length} globs)`);

  // Load type flags
  const typeFlagPath = findFile("TYPEFLAG.DAT");
  const typeFlags = loadTypeFlags(typeFlagPath);
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
