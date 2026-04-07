/**
 * Web Server — Level picker UI with on-demand rendering and caching.
 *
 * Routes:
 *   GET /                        — Level picker page
 *   GET /api/levels              — JSON list of available levels
 *   GET /api/render/:level       — Render a level (query: ?scale=0.25&floor=)
 *   GET /cache/*                 — Serve cached files
 */

import * as fs from "node:fs";
import * as path from "node:path";
import compression from "compression";
import express from "express";
import { errorMessage } from "./errors";
import { getFlxEntryData } from "./flx";
import type { GameData } from "./gamedata";
import {
  computeFloorZRange,
  type MapItem,
  parseFixedItems,
  REBEL_BASE,
  REBEL_BASE_DESTROYED,
  REMORSE_MISSIONS,
  resolveMapItems,
} from "./map";
import { renderMap } from "./renderer";

/** Level descriptor for the API */
interface LevelInfo {
  id: string;
  name: string;
  mapIndices: number[];
}

function buildLevelList(): LevelInfo[] {
  const levels: LevelInfo[] = [];
  for (const m of Object.keys(REMORSE_MISSIONS)
    .map(Number)
    .sort((a, b) => a - b)) {
    levels.push({
      id: `mission_${m}`,
      name: `Mission ${m}`,
      mapIndices: REMORSE_MISSIONS[m],
    });
  }
  levels.push({ id: "rebel_base", name: "Rebel Base", mapIndices: [REBEL_BASE] });
  levels.push({ id: "rebel_base_destroyed", name: "Rebel Base (Destroyed)", mapIndices: [REBEL_BASE_DESTROYED] });
  return levels;
}

/** Generate a cache key filename for a given render request */
function cacheKey(levelId: string, scale: number, floors: number[], showEditor: boolean): string {
  let key = `${levelId}_s${scale.toFixed(2).replace(".", "")}`;
  if (floors.length > 0) key += `_f${floors.join("-")}`;
  if (showEditor) key += "_editor";
  return `${key}.png`;
}

/**
 * Start the web server.
 */
export function startServer(gd: GameData, port: number, cacheDir: string): void {
  const app = express();
  const levels = buildLevelList();

  fs.mkdirSync(cacheDir, { recursive: true });

  // Enable gzip compression for all responses
  app.use(compression());

  // Serve cached files
  // TODO: revisit later or remove
  app.use("/cache", express.static(cacheDir));

  // ── API: level list ──
  app.get("/api/levels", (_req, res) => {
    res.json(levels);
  });

  // ── API: cached status ──
  app.get("/api/cached", (req, res) => {
    const scale = Math.max(0.05, Math.min(2, parseFloat(req.query.scale as string) || 0.25));
    const floorsParam = req.query.floors as string | undefined;
    const floors = floorsParam
      ? floorsParam
          .split(",")
          .map(Number)
          .filter((n) => !Number.isNaN(n))
      : [];
    const showEditor = req.query.showEditor === "true";

    const result: Record<string, { url: string; tiled: boolean }> = {};
    for (const lv of levels) {
      const key = cacheKey(lv.id, scale, floors, showEditor);
      const cachedPath = path.join(cacheDir, key);
      const tiledDir = cachedPath.replace(/\.[^.]+$/, "_tiles");

      if (fs.existsSync(cachedPath)) {
        result[lv.id] = { url: `/cache/${key}`, tiled: false };
      } else if (fs.existsSync(path.join(tiledDir, "viewer.html"))) {
        result[lv.id] = { url: `/cache/${key.replace(/\.png$/, "_tiles/viewer.html")}`, tiled: true };
      }
    }
    res.json(result);
  });

  // ── API: render ──
  // Track in-flight renders to avoid duplicate work
  const rendering = new Map<string, Promise<{ url: string; tiled: boolean }>>();

  app.get("/api/render/:levelId", async (req, res) => {
    const levelId = req.params.levelId;
    const level = levels.find((l) => l.id === levelId);
    if (!level) {
      res.status(404).json({ error: "Unknown level" });
      return;
    }

    const scale = Math.max(0.05, Math.min(2, parseFloat(req.query.scale as string) || 0.25));
    const floorsParam = req.query.floors as string | undefined;
    const floors = floorsParam
      ? floorsParam
          .split(",")
          .map(Number)
          .filter((n) => !Number.isNaN(n))
      : [];
    const showEditor = req.query.showEditor === "true";

    const key = cacheKey(levelId, scale, floors, showEditor);
    const cachedPath = path.join(cacheDir, key);
    const tiledDir = cachedPath.replace(/\.[^.]+$/, "_tiles");

    // Serve from cache if it exists (single PNG or tiled directory)
    if (fs.existsSync(cachedPath)) {
      res.json({ status: "done", url: `/cache/${key}` });
      return;
    }
    if (fs.existsSync(path.join(tiledDir, "viewer.html"))) {
      res.json({ status: "done", url: `/cache/${key.replace(/\.png$/, "_tiles/viewer.html")}`, tiled: true });
      return;
    }

    // If already rendering, wait for it
    if (rendering.has(key)) {
      try {
        const result = await rendering.get(key)!;
        res.json({ status: "done", ...result });
      } catch (err) {
        res.status(500).json({ error: errorMessage(err) });
      }
      return;
    }

    // Start render
    const renderPromise = (async (): Promise<{ url: string; tiled: boolean }> => {
      const allItems: MapItem[] = [];
      for (const idx of level.mapIndices) {
        const mapData = getFlxEntryData(gd.fixedArchive, idx);
        if (!mapData) continue;
        const fixedItems = parseFixedItems(mapData);
        const resolved = resolveMapItems(fixedItems, gd.globs, gd.typeFlags, !showEditor);
        allItems.push(...resolved);
      }

      if (allItems.length === 0) {
        throw new Error("No renderable items found");
      }

      let floorMinZ: number | undefined;
      let floorMaxZ: number | undefined;
      if (floors.length > 0) {
        ({ floorMinZ } = computeFloorZRange(Math.min(...floors)));
        ({ floorMaxZ } = computeFloorZRange(Math.max(...floors)));
      }

      console.log(
        `  Rendering ${level.name} (scale=${scale}, floors=${floors.length > 0 ? floors.join(",") : "all"})...`,
      );

      const result = await renderMap(allItems, gd.shapesArchive, gd.palette, gd.typeFlags, {
        bgColor: { r: 0, g: 0, b: 0, a: 255 },
        scale,
        floorMinZ,
        floorMaxZ,
        outputPath: cachedPath,
        onProgress: (current, total) => {
          if (current % 1000 === 0 || current === total) {
            process.stdout.write(`\r  ${level.name}: ${current}/${total} (${Math.round((current / total) * 100)}%)`);
          }
        },
      });

      process.stdout.write("\n");

      // If not tiled, write single PNG; otherwise tiles + viewer.html already written
      if (result.toString() !== "TILED") {
        fs.writeFileSync(cachedPath, result);
        console.log(`  \u2713 ${level.name} cached \u2192 ${key}`);
        return { url: `/cache/${key}`, tiled: false };
      } else {
        console.log(`  \u2713 ${level.name} cached (tiled) \u2192 ${key.replace(/\.png$/, "_tiles/")}`);
        return { url: `/cache/${key.replace(/\.png$/, "_tiles/viewer.html")}`, tiled: true };
      }
    })();

    rendering.set(key, renderPromise);

    try {
      const result = await renderPromise;
      res.json({ status: "done", ...result });
    } catch (err) {
      console.error(`  \u2717 ${level.name}: ${errorMessage(err)}`);
      res.status(500).json({ error: errorMessage(err) });
    } finally {
      rendering.delete(key);
    }
  });

  // ── API: clear cache ──
  app.post("/api/clear-cache", (_req, res) => {
    const files = fs.readdirSync(cacheDir);
    for (const f of files) {
      fs.rmSync(path.join(cacheDir, f), { recursive: true, force: true });
    }
    res.json({ cleared: files.length });
  });

  // ── Frontend (built by Vite) ──
  const clientDist = path.join(__dirname, "..", "client", "dist");
  app.use(express.static(clientDist));

  // SPA fallback: serve index.html for non-API/non-cache routes
  app.get("/{*path}", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });

  app.listen(port, () => {
    console.log(`\nCrusader Map Viewer running at http://localhost:${port}\n`);
  });
}
