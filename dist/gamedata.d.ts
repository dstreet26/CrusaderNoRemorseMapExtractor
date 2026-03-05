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
import { type FlxArchive } from "./flx";
import { type Palette } from "./palette";
import { type ShapeInfo } from "./typeflag";
import { type Glob } from "./map";
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
export declare function loadGameData(baseDir: string): GameData;
//# sourceMappingURL=gamedata.d.ts.map