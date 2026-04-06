/**
 * Crusader: No Remorse Map Extractor — CLI Entry Point
 *
 * Renders game data files into high-resolution PNG images.
 *
 * Usage:
 *   node dist/index.js --input-data-dir=<path> --level=<n> [--floor=<n>] [--output=<path>]
 *   node dist/index.js --input-data-dir=<path> --shape=<n> [--frame=<n>] [--output=<path>]
 *   node dist/index.js --input-data-dir=<path> --dump-shapes [--output-dir=<path>]
 *   node dist/index.js --input-data-dir=<path> --info
 */

import { Command } from "commander";
import * as path from "path";
import * as fs from "fs";
import { loadGameData } from "./gamedata";
import { getFlxEntryData } from "./flx";
import { parseFixedItems, resolveMapItems, sortMapItems, REMORSE_MISSIONS, REBEL_BASE, REBEL_BASE_DESTROYED } from "./map";
import { renderMap, renderShapeToPng } from "./renderer";
import { parseShape } from "./shape";
import { startServer } from "./server";

const program = new Command();

program
  .name("crusader-map-extractor")
  .description("Renders Crusader: No Remorse game data files into high resolution images")
  .version("1.0.0");

// ── render-level ──────────────────────────────────────────────
program
  .command("render-level")
  .description("Render a level/mission map to a PNG image")
  .requiredOption("--input-data-dir <path>", "Path to Crusader game directory (containing STATIC/)")
  .requiredOption("--level <number>", "Level/mission number (1-15) or FIXED.DAT map index")
  .option("--floor <number>", "Floor number (filters by Z range)")
  .option("--output <path>", "Output PNG file path (tiles use <name>_tiles/ folder)", "out.png")
  .option("--raw-index", "Treat --level as raw FIXED.DAT index instead of mission number")
  .option("--scale <number>", "Scale factor (default 1.0; use <1 to downscale, e.g. 0.25)", "1")
  .option("--bg <color>", "Background color (hex, e.g. #000000)", "#000000")
  .action(async (opts) => {
    try {
      const gd = loadGameData(opts.inputDataDir);

      // Determine map indices
      let mapIndices: number[];
      const levelNum = parseInt(opts.level, 10);

      if (opts.rawIndex) {
        mapIndices = [levelNum];
      } else {
        mapIndices = REMORSE_MISSIONS[levelNum];
        if (!mapIndices) {
          console.error(`Unknown mission ${levelNum}. Valid missions: ${Object.keys(REMORSE_MISSIONS).join(", ")}`);
          process.exit(1);
        }
      }

      console.log(`Rendering mission ${levelNum} (map indices: ${mapIndices.join(", ")})...`);

      // Load and merge fixed items from all map indices
      const allItems = [];
      for (const idx of mapIndices) {
        const mapData = getFlxEntryData(gd.fixedArchive, idx);
        if (!mapData) {
          console.warn(`  Warning: No data for map index ${idx}`);
          continue;
        }
        const fixedItems = parseFixedItems(mapData);
        console.log(`  Map ${idx}: ${fixedItems.length} fixed items`);
        const resolved = resolveMapItems(fixedItems, gd.globs, gd.typeFlags);
        allItems.push(...resolved);
      }

      if (allItems.length === 0) {
        console.error("No renderable items found.");
        process.exit(1);
      }

      console.log(`Total renderable items: ${allItems.length}`);

      // Floor filtering
      let floorMinZ: number | undefined;
      let floorMaxZ: number | undefined;
      if (opts.floor !== undefined) {
        const floor = parseInt(opts.floor, 10);
        // Each floor is roughly 40 Z units
        floorMinZ = floor * 40;
        floorMaxZ = (floor + 1) * 40 - 1;
        console.log(`Filtering to floor ${floor} (Z: ${floorMinZ}-${floorMaxZ})`);
      }

      // Parse background color
      const bgHex = opts.bg.replace("#", "");
      const bgColor = {
        r: parseInt(bgHex.substring(0, 2), 16),
        g: parseInt(bgHex.substring(2, 4), 16),
        b: parseInt(bgHex.substring(4, 6), 16),
        a: 255,
      };

      const scaleVal = parseFloat(opts.scale);
      if (isNaN(scaleVal) || scaleVal <= 0) {
        console.error("Invalid --scale value. Must be a positive number.");
        process.exit(1);
      }

      const result = await renderMap(allItems, gd.shapesArchive, gd.palette, {
        bgColor,
        scale: scaleVal,
        floorMinZ,
        floorMaxZ,
        outputPath: opts.output,
        onProgress: (current, total) => {
          process.stdout.write(`\r  Progress: ${current}/${total} (${Math.round((current / total) * 100)}%)`);
        },
      });

      process.stdout.write("\n");

      // "TILED" means tiles were already written to a folder
      if (result.toString() !== "TILED") {
        fs.writeFileSync(opts.output, result);
        console.log(`Output written to: ${opts.output}`);
      }
    } catch (err: any) {
      console.error("Error:", err.message);
      process.exit(1);
    }
  });

// ── render-area ───────────────────────────────────────────────
program
  .command("render-area")
  .description("Render a cropped area of a level/mission map to a PNG image")
  .requiredOption("--input-data-dir <path>", "Path to Crusader game directory (containing STATIC/)")
  .requiredOption("--level <number>", "Level/mission number (1-15)")
  .requiredOption("--x <number>", "Crop X offset in native pixels (from top-left of full map)")
  .requiredOption("--y <number>", "Crop Y offset in native pixels")
  .requiredOption("--width <number>", "Crop width in native pixels")
  .requiredOption("--height <number>", "Crop height in native pixels")
  .option("--floor <number>", "Floor number (filters by Z range)")
  .option("--output <path>", "Output PNG file path", "area.png")
  .option("--scale <number>", "Scale factor (default 1.0)", "1")
  .option("--bg <color>", "Background color (hex)", "#000000")
  .action(async (opts) => {
    try {
      const gd = loadGameData(opts.inputDataDir);

      const levelNum = parseInt(opts.level, 10);
      const mapIndices = REMORSE_MISSIONS[levelNum];
      if (!mapIndices) {
        console.error(`Unknown mission ${levelNum}. Valid missions: ${Object.keys(REMORSE_MISSIONS).join(", ")}`);
        process.exit(1);
      }

      const allItems = [];
      for (const idx of mapIndices) {
        const mapData = getFlxEntryData(gd.fixedArchive, idx);
        if (!mapData) continue;
        const fixedItems = parseFixedItems(mapData);
        const resolved = resolveMapItems(fixedItems, gd.globs, gd.typeFlags);
        allItems.push(...resolved);
      }

      if (allItems.length === 0) {
        console.error("No renderable items found.");
        process.exit(1);
      }

      let floorMinZ: number | undefined;
      let floorMaxZ: number | undefined;
      if (opts.floor !== undefined) {
        const floor = parseInt(opts.floor, 10);
        floorMinZ = floor * 40;
        floorMaxZ = (floor + 1) * 40 - 1;
      }

      const bgHex = opts.bg.replace("#", "");
      const bgColor = {
        r: parseInt(bgHex.substring(0, 2), 16),
        g: parseInt(bgHex.substring(2, 4), 16),
        b: parseInt(bgHex.substring(4, 6), 16),
        a: 255,
      };

      const scaleVal = parseFloat(opts.scale);
      const cropX = parseInt(opts.x, 10);
      const cropY = parseInt(opts.y, 10);
      const cropW = parseInt(opts.width, 10);
      const cropH = parseInt(opts.height, 10);

      console.log(`Rendering area from mission ${levelNum}: (${cropX},${cropY}) ${cropW}×${cropH} at scale ${scaleVal}...`);

      const result = await renderMap(allItems, gd.shapesArchive, gd.palette, {
        bgColor,
        scale: scaleVal,
        floorMinZ,
        floorMaxZ,
        outputPath: opts.output,
        crop: { x: cropX, y: cropY, width: cropW, height: cropH },
        onProgress: (current, total) => {
          process.stdout.write(`\r  Progress: ${current}/${total} (${Math.round((current / total) * 100)}%)`);
        },
      });

      process.stdout.write("\n");

      if (result.toString() !== "TILED") {
        fs.writeFileSync(opts.output, result);
        console.log(`Output written to: ${opts.output}`);
      }
    } catch (err: any) {
      console.error("Error:", err.message);
      process.exit(1);
    }
  });

// ── render-shape ──────────────────────────────────────────────
program
  .command("render-shape")
  .description("Render a specific shape (optionally a specific frame) to PNG")
  .requiredOption("--input-data-dir <path>", "Path to Crusader game directory")
  .requiredOption("--shape <number>", "Shape number (1-based)")
  .option("--frame <number>", "Frame number (0-based, default: all frames)", undefined)
  .option("--output <path>", "Output PNG file path (or directory for all frames)", "shape.png")
  .action(async (opts) => {
    try {
      const gd = loadGameData(opts.inputDataDir);

      const shapeNum = parseInt(opts.shape, 10);
      const archiveIdx = shapeNum - 1;
      const shapeData = getFlxEntryData(gd.shapesArchive, archiveIdx);
      if (!shapeData) {
        console.error(`Shape ${shapeNum} not found in SHAPES.FLX`);
        process.exit(1);
      }

      const shape = parseShape(shapeData, gd.palette);
      console.log(`Shape ${shapeNum}: ${shape.frameCount} frames`);

      if (opts.frame !== undefined) {
        const frameNum = parseInt(opts.frame, 10);
        const png = await renderShapeToPng(gd.shapesArchive, gd.palette, shapeNum, frameNum);
        if (!png) {
          console.error(`Frame ${frameNum} not found`);
          process.exit(1);
        }
        fs.writeFileSync(opts.output, png);
        console.log(`Written: ${opts.output} (${shape.frames[frameNum].width}×${shape.frames[frameNum].height})`);
      } else {
        // Render all frames
        const outDir = opts.output.replace(/\.png$/i, "");
        fs.mkdirSync(outDir, { recursive: true });
        for (let f = 0; f < shape.frameCount; f++) {
          const png = await renderShapeToPng(gd.shapesArchive, gd.palette, shapeNum, f);
          if (png) {
            const outPath = path.join(outDir, `frame_${f}.png`);
            fs.writeFileSync(outPath, png);
            console.log(`  Frame ${f}: ${shape.frames[f].width}×${shape.frames[f].height} → ${outPath}`);
          }
        }
      }
    } catch (err: any) {
      console.error("Error:", err.message);
      process.exit(1);
    }
  });

// ── dump-shapes ───────────────────────────────────────────────
program
  .command("dump-shapes")
  .description("Dump all shape frames as PNG files (useful for debugging)")
  .requiredOption("--input-data-dir <path>", "Path to Crusader game directory")
  .option("--output-dir <path>", "Output directory", "shapes_dump")
  .option("--start <number>", "Start shape number (1-based)", "1")
  .option("--end <number>", "End shape number (1-based, inclusive)")
  .action(async (opts) => {
    try {
      const gd = loadGameData(opts.inputDataDir);

      const outputDir = opts.outputDir;
      fs.mkdirSync(outputDir, { recursive: true });

      const start = parseInt(opts.start, 10);
      const end = opts.end ? parseInt(opts.end, 10) : gd.shapesArchive.entryCount;

      let totalFrames = 0;
      for (let s = start; s <= end; s++) {
        const shapeData = getFlxEntryData(gd.shapesArchive, s - 1);
        if (!shapeData || shapeData.length < 6) continue;

        const shape = parseShape(shapeData, gd.palette);
        for (let f = 0; f < shape.frameCount; f++) {
          const frame = shape.frames[f];
          if (frame.width === 0 || frame.height === 0) continue;

          const png = await renderShapeToPng(gd.shapesArchive, gd.palette, s, f);
          if (png) {
            const outPath = path.join(outputDir, `shape_${s}_frame_${f}.png`);
            fs.writeFileSync(outPath, png);
            totalFrames++;
          }
        }

        if (s % 100 === 0) {
          console.log(`  Processed shape ${s}/${end} (${totalFrames} frames so far)`);
        }
      }

      console.log(`Dumped ${totalFrames} frames to ${outputDir}`);
    } catch (err: any) {
      console.error("Error:", err.message);
      process.exit(1);
    }
  });

// ── info ──────────────────────────────────────────────────────
program
  .command("info")
  .description("Display information about the game data files")
  .requiredOption("--input-data-dir <path>", "Path to Crusader game directory")
  .action((opts) => {
    try {
      const gd = loadGameData(opts.inputDataDir);

      console.log("\n=== Game Data Summary ===");
      console.log(`Base directory: ${gd.baseDir}`);
      console.log(`Shapes: ${gd.shapesArchive.entryCount}`);
      console.log(`Maps: ${gd.fixedArchive.entryCount}`);
      console.log(`Globs: ${gd.globs.length}`);
      console.log(`Type flags: ${gd.typeFlags.length}`);

      console.log("\n=== Available Maps ===");
      for (let i = 0; i < gd.fixedArchive.entryCount; i++) {
        const data = getFlxEntryData(gd.fixedArchive, i);
        if (data && data.length > 0) {
          const itemCount = Math.floor(data.length / 16);
          // Find which mission this maps to
          let mission = "";
          for (const [m, indices] of Object.entries(REMORSE_MISSIONS)) {
            if (indices.includes(i)) {
              mission = ` (Mission ${m})`;
              break;
            }
          }
          if (i === 28) mission = " (Rebel Base)";
          if (i === 29) mission = " (Rebel Base Destroyed)";
          console.log(`  Map ${i}: ${itemCount} items${mission}`);
        }
      }

      // Shape statistics
      let drawableShapes = 0;
      let globEggs = 0;
      for (const tf of gd.typeFlags) {
        if (tf.draw) drawableShapes++;
        if (tf.family === 3) globEggs++;
      }
      console.log(`\n=== Type Flags Summary ===`);
      console.log(`  Drawable shapes: ${drawableShapes}`);
      console.log(`  Glob eggs: ${globEggs}`);
    } catch (err: any) {
      console.error("Error:", err.message);
      process.exit(1);
    }
  });

// ── inspect-map ───────────────────────────────────────────────
program
  .command("inspect-map")
  .description("Inspect a map's items without rendering (useful for debugging)")
  .requiredOption("--input-data-dir <path>", "Path to Crusader game directory")
  .requiredOption("--level <number>", "Level/mission number or map index")
  .option("--raw-index", "Treat --level as raw FIXED.DAT index")
  .action((opts) => {
    try {
      const gd = loadGameData(opts.inputDataDir);

      const levelNum = parseInt(opts.level, 10);
      let mapIndices: number[];
      if (opts.rawIndex) {
        mapIndices = [levelNum];
      } else {
        mapIndices = REMORSE_MISSIONS[levelNum];
        if (!mapIndices) {
          console.error(`Unknown mission ${levelNum}`);
          process.exit(1);
        }
      }

      for (const idx of mapIndices) {
        const mapData = getFlxEntryData(gd.fixedArchive, idx);
        if (!mapData) {
          console.log(`Map ${idx}: no data`);
          continue;
        }

        const fixedItems = parseFixedItems(mapData);
        const resolved = resolveMapItems(fixedItems, gd.globs, gd.typeFlags);

        console.log(`\n=== Map ${idx} ===`);
        console.log(`Raw fixed items: ${fixedItems.length}`);
        console.log(`Resolved items (with globs expanded): ${resolved.length}`);

        // Z-level histogram
        const zHist = new Map<number, number>();
        for (const item of resolved) {
          const z = item.worldZ;
          zHist.set(z, (zHist.get(z) || 0) + 1);
        }
        const sortedZ = [...zHist.entries()].sort((a, b) => a[0] - b[0]);
        console.log("\nZ-level distribution:");
        for (const [z, count] of sortedZ) {
          console.log(`  Z=${z}: ${count} items`);
        }

        // Shape usage
        const shapeHist = new Map<number, number>();
        for (const item of resolved) {
          shapeHist.set(item.shape, (shapeHist.get(item.shape) || 0) + 1);
        }
        console.log(`\nUnique shapes used: ${shapeHist.size}`);

        // Coordinate range
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const item of resolved) {
          if (item.worldX < minX) minX = item.worldX;
          if (item.worldX > maxX) maxX = item.worldX;
          if (item.worldY < minY) minY = item.worldY;
          if (item.worldY > maxY) maxY = item.worldY;
        }
        console.log(`\nCoordinate range:`);
        console.log(`  X: ${minX} - ${maxX}`);
        console.log(`  Y: ${minY} - ${maxY}`);
      }
    } catch (err: any) {
      console.error("Error:", err.message);
      process.exit(1);
    }
  });

// ── export-all ────────────────────────────────────────────────
program
  .command("export-all")
  .description("Render all missions and special maps to PNG files in a folder")
  .requiredOption("--input-data-dir <path>", "Path to Crusader game directory (containing STATIC/)")
  .option("--output-dir <path>", "Output directory for PNG files", "exports")
  .option("--scale <number>", "Scale factor (default 0.25)", "0.25")
  .option("--floor <number>", "Floor number (filters by Z range)")
  .option("--bg <color>", "Background color (hex, e.g. #000000)", "#000000")
  .action(async (opts) => {
    try {
      const gd = loadGameData(opts.inputDataDir);
      const outputDir = opts.outputDir;
      fs.mkdirSync(outputDir, { recursive: true });

      const scaleVal = parseFloat(opts.scale);
      if (isNaN(scaleVal) || scaleVal <= 0) {
        console.error("Invalid --scale value. Must be a positive number.");
        process.exit(1);
      }

      const bgHex = opts.bg.replace("#", "");
      const bgColor = {
        r: parseInt(bgHex.substring(0, 2), 16),
        g: parseInt(bgHex.substring(2, 4), 16),
        b: parseInt(bgHex.substring(4, 6), 16),
        a: 255,
      };

      let floorMinZ: number | undefined;
      let floorMaxZ: number | undefined;
      if (opts.floor !== undefined) {
        const floor = parseInt(opts.floor, 10);
        floorMinZ = floor * 40;
        floorMaxZ = (floor + 1) * 40 - 1;
      }

      // Build the list of renders: missions 1–15 + rebel base variants
      const jobs: { name: string; mapIndices: number[] }[] = [];
      for (const missionNum of Object.keys(REMORSE_MISSIONS).map(Number).sort((a, b) => a - b)) {
        const padded = String(missionNum).padStart(2, "0");
        jobs.push({ name: `Mission_${padded}`, mapIndices: REMORSE_MISSIONS[missionNum] });
      }
      jobs.push({ name: "Rebel_Base", mapIndices: [REBEL_BASE] });
      jobs.push({ name: "Rebel_Base_Destroyed", mapIndices: [REBEL_BASE_DESTROYED] });

      console.log(`Exporting ${jobs.length} maps to ${outputDir}/ at scale ${scaleVal}...\n`);

      let completed = 0;
      for (const job of jobs) {
        const outPath = path.join(outputDir, `${job.name}.png`);
        console.log(`[${completed + 1}/${jobs.length}] ${job.name} (maps: ${job.mapIndices.join(", ")})...`);

        // Load and merge fixed items
        const allItems = [];
        for (const idx of job.mapIndices) {
          const mapData = getFlxEntryData(gd.fixedArchive, idx);
          if (!mapData) {
            console.warn(`  Warning: No data for map index ${idx}`);
            continue;
          }
          const fixedItems = parseFixedItems(mapData);
          const resolved = resolveMapItems(fixedItems, gd.globs, gd.typeFlags);
          allItems.push(...resolved);
        }

        if (allItems.length === 0) {
          console.warn(`  Skipping ${job.name}: no renderable items`);
          completed++;
          continue;
        }

        const result = await renderMap(allItems, gd.shapesArchive, gd.palette, {
          bgColor,
          scale: scaleVal,
          floorMinZ,
          floorMaxZ,
          outputPath: outPath,
          onProgress: (current, total) => {
            process.stdout.write(`\r  Progress: ${current}/${total} (${Math.round((current / total) * 100)}%)`);
          },
        });

        process.stdout.write("\n");

        if (result.toString() !== "TILED") {
          fs.writeFileSync(outPath, result);
        }

        console.log(`  ✓ ${job.name} → ${outPath}`);
        completed++;
      }

      console.log(`\nDone! Exported ${completed} maps to ${outputDir}/`);
    } catch (err: any) {
      console.error("Error:", err.message);
      process.exit(1);
    }
  });

// ── serve ─────────────────────────────────────────────────────
program
  .command("serve")
  .description("Start a web server with a level picker UI and on-demand rendering")
  .requiredOption("--input-data-dir <path>", "Path to Crusader game directory (containing STATIC/)")
  .option("--port <number>", "Port to listen on", "3000")
  .option("--cache-dir <path>", "Directory to cache rendered images", "cache")
  .action((opts) => {
    try {
      const gd = loadGameData(opts.inputDataDir);
      const port = parseInt(opts.port, 10);
      startServer(gd, port, opts.cacheDir);
    } catch (err: any) {
      console.error("Error:", err.message);
      process.exit(1);
    }
  });

program.parse(process.argv);
