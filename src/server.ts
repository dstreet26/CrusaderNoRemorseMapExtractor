/**
 * Web Server — Level picker UI with on-demand rendering and caching.
 *
 * Routes:
 *   GET /                        — Level picker page
 *   GET /api/levels              — JSON list of available levels
 *   GET /api/render/:level       — Render a level (query: ?scale=0.25&floor=)
 *   GET /cache/*                 — Serve cached files
 */

import express from "express";
import compression from "compression";
import * as path from "path";
import * as fs from "fs";
import { type GameData } from "./gamedata";
import { getFlxEntryData } from "./flx";
import { parseFixedItems, resolveMapItems, REMORSE_MISSIONS, REBEL_BASE, REBEL_BASE_DESTROYED } from "./map";
import { renderMap } from "./renderer";

/** Level descriptor for the API */
interface LevelInfo {
  id: string;
  name: string;
  mapIndices: number[];
}

function buildLevelList(): LevelInfo[] {
  const levels: LevelInfo[] = [];
  for (const m of Object.keys(REMORSE_MISSIONS).map(Number).sort((a, b) => a - b)) {
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
function cacheKey(levelId: string, scale: number, floor: number | null, showEditor: boolean): string {
  let key = `${levelId}_s${scale.toFixed(2).replace(".", "")}`;
  if (floor !== null) key += `_f${floor}`;
  if (showEditor) key += "_editor";
  return key + ".png";
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

  // Serve cached files with aggressive caching headers
  app.use("/cache", express.static(cacheDir, {
    maxAge: '1y',  // Cache for 1 year
    immutable: true,  // Files never change
    etag: true,  // Enable ETags for validation
  }));

  // ── API: level list ──
  app.get("/api/levels", (_req, res) => {
    res.json(levels);
  });

  // ── API: cached status ──
  app.get("/api/cached", (req, res) => {
    const scale = Math.max(0.05, Math.min(2, parseFloat(req.query.scale as string) || 0.25));
    const floorParam = req.query.floor as string | undefined;
    const floor = floorParam !== undefined && floorParam !== "" ? parseInt(floorParam, 10) : null;
    const showEditor = req.query.showEditor === "true";

    const result: Record<string, { url: string; tiled: boolean }> = {};
    for (const lv of levels) {
      const key = cacheKey(lv.id, scale, floor, showEditor);
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
    const floorParam = req.query.floor as string | undefined;
    const floor = floorParam !== undefined && floorParam !== "" ? parseInt(floorParam, 10) : null;
    const showEditor = req.query.showEditor === "true";

    const key = cacheKey(levelId, scale, floor, showEditor);
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
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
      return;
    }

    // Start render
    const renderPromise = (async (): Promise<{ url: string; tiled: boolean }> => {
      const allItems: any[] = [];
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
      if (floor !== null) {
        floorMinZ = floor * 40;
        floorMaxZ = (floor + 1) * 40 - 1;
      }

      console.log(`  Rendering ${level.name} (scale=${scale}, floor=${floor ?? "all"})...`);

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
    } catch (err: any) {
      console.error(`  ✗ ${level.name}: ${err.message}`);
      res.status(500).json({ error: err.message });
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

  // ── Landing page ──
  app.get("/", (_req, res) => {
    res.type("html").send(getLandingPageHtml());
  });

  app.listen(port, () => {
    console.log(`\nCrusader Map Viewer running at http://localhost:${port}\n`);
  });
}

function getLandingPageHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Crusader: No Remorse — Map Viewer</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #0a0a0a; color: #0f0; font-family: 'Courier New', monospace;
    display: flex; flex-direction: column; min-height: 100vh;
  }
  header {
    padding: 24px 32px 16px; border-bottom: 1px solid #1a3a1a;
    background: linear-gradient(180deg, #0d1a0d 0%, #0a0a0a 100%);
  }
  header h1 { font-size: 22px; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 4px; }
  header .sub { font-size: 12px; color: #0a0; opacity: 0.7; }
  .controls {
    padding: 16px 32px; display: flex; gap: 16px; align-items: center;
    border-bottom: 1px solid #1a3a1a; flex-wrap: wrap;
  }
  .controls label { font-size: 12px; color: #0a0; }
  .controls select, .controls input {
    background: #111; color: #0f0; border: 1px solid #1a3a1a;
    font: 13px 'Courier New', monospace; padding: 6px 10px;
    border-radius: 3px; outline: none;
  }
  .controls select:focus, .controls input:focus { border-color: #0f0; }
  .controls select option { background: #111; }
  .controls button {
    background: #1a3a1a; color: #0f0; border: 1px solid #0f0;
    font: 13px 'Courier New', monospace; padding: 6px 16px;
    border-radius: 3px; cursor: pointer; text-transform: uppercase;
    letter-spacing: 1px;
  }
  .controls button:hover { background: #0f0; color: #0a0a0a; }
  .controls button:disabled { opacity: 0.4; cursor: not-allowed; }
  #status {
    padding: 8px 32px; font-size: 12px; color: #0a0;
    min-height: 28px; display: flex; align-items: center; gap: 8px;
  }
  #status .spinner {
    display: inline-block; width: 12px; height: 12px;
    border: 2px solid #1a3a1a; border-top-color: #0f0;
    border-radius: 50%; animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .grid {
    flex: 1; padding: 16px 32px; display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 12px; align-content: start;
  }
  .card {
    background: #111; border: 1px solid #1a3a1a; border-radius: 4px;
    padding: 12px; cursor: pointer; transition: border-color 0.15s, background 0.15s;
  }
  .card:hover { border-color: #0f0; background: #0d1a0d; }
  .card.active { border-color: #0f0; background: #0d1a0d; }
  .card .name { font-size: 14px; margin-bottom: 4px; }
  .card .meta { font-size: 11px; color: #0a0; opacity: 0.6; }
  .card .thumb {
    width: 100%; aspect-ratio: 16/9; background: #0a0a0a;
    margin-top: 8px; border-radius: 2px; overflow: hidden;
    display: flex; align-items: center; justify-content: center;
  }
  .card .thumb img {
    max-width: 100%; max-height: 100%; image-rendering: pixelated;
    display: none;
  }
  .card .thumb .placeholder { font-size: 11px; color: #1a3a1a; }
  .card .view-btn {
    width: 100%; margin-top: 6px; padding: 4px 0; text-align: center;
    background: #1a3a1a; color: #0f0; border: 1px solid #0f0;
    font: 12px 'Courier New', monospace; border-radius: 3px; cursor: pointer;
    text-transform: uppercase; letter-spacing: 1px;
  }
  .card .view-btn:hover { background: #0f0; color: #0a0a0a; }

  /* Viewer overlay */
  #viewer-overlay {
    display: none; position: fixed; inset: 0; z-index: 1000;
    background: #0a0a0a; flex-direction: column;
  }
  #viewer-overlay.visible { display: flex; }
  #viewer-bar {
    padding: 8px 16px; display: flex; align-items: center; gap: 12px;
    background: #0d1a0d; border-bottom: 1px solid #1a3a1a;
    font-size: 13px;
  }
  #viewer-bar button {
    background: #1a3a1a; color: #0f0; border: 1px solid #0f0;
    font: 13px 'Courier New', monospace; padding: 4px 12px;
    border-radius: 3px; cursor: pointer;
  }
  #viewer-bar button:hover { background: #0f0; color: #0a0a0a; }
  #viewer-viewport {
    flex: 1; overflow: hidden; cursor: grab; position: relative;
  }
  #viewer-viewport.dragging { cursor: grabbing; }
  #viewer-img {
    position: absolute; transform-origin: 0 0;
    image-rendering: pixelated;
  }
  #viewer-iframe {
    position: absolute; inset: 0; width: 100%; height: 100%;
    border: none; display: none;
  }
  #viewer-hud {
    position: absolute; bottom: 12px; right: 12px;
    font-size: 11px; color: #0a0; opacity: 0.8;
    background: rgba(0, 0, 0, 0.7); padding: 8px 12px;
    border-radius: 3px; border: 1px solid #1a3a1a;
    font-family: 'Courier New', monospace; line-height: 1.4;
    pointer-events: none; max-width: 400px;
  }
  #viewer-hud .coord-line {
    margin: 2px 0;
  }
  #viewer-hud .coord-label {
    color: #0a0; opacity: 0.7; display: inline-block; min-width: 80px;
  }
  #viewer-hud .coord-value {
    color: #0f0; font-weight: bold;
  }
  #viewer-hud .copy-hint {
    margin-top: 6px; padding-top: 6px; border-top: 1px solid #1a3a1a;
    font-size: 10px; opacity: 0.5;
  }
</style>
</head>
<body>

<header>
  <h1>Crusader: No Remorse</h1>
  <div class="sub">Map Viewer &amp; Extractor</div>
</header>

<div class="controls">
  <div>
    <label>Scale</label><br>
    <select id="scale-select">
      <option value="0.1">0.1×</option>
      <option value="0.25" selected>0.25×</option>
      <option value="0.5">0.5×</option>
      <option value="1">1×</option>
    </select>
  </div>
  <div>
    <label>Floor</label><br>
    <select id="floor-select">
      <option value="">All floors</option>
      <option value="0">Floor 0</option>
      <option value="1">Floor 1</option>
      <option value="2">Floor 2</option>
      <option value="3">Floor 3</option>
      <option value="4">Floor 4</option>
    </select>
  </div>
  <div>
    <label>Options</label><br>
    <label style="font-weight:normal;cursor:pointer">
      <input type="checkbox" id="show-editor" style="vertical-align:middle">
      Show Editor Items
    </label>
  </div>
  <div>
    <button id="btn-render" disabled>Select a level</button>
  </div>
  <div>
    <button id="btn-render-all" title="Render all levels sequentially">Render All</button>
  </div>
</div>

<div id="status"></div>

<div class="grid" id="level-grid"></div>

<!-- Image viewer overlay -->
<div id="viewer-overlay">
  <div id="viewer-bar">
    <button id="viewer-close">✕ Close</button>
    <span id="viewer-title"></span>
    <span style="flex:1"></span>
    <button id="viewer-zout">−</button>
    <span id="viewer-zoom">100%</span>
    <button id="viewer-zin">+</button>
    <button id="viewer-fit">Fit</button>
    <button id="viewer-reset">1:1</button>
    <span style="margin-left:15px;opacity:0.6">Zoom Sensitivity:</span>
    <input type="range" id="zoom-sensitivity" min="0.3" max="2.0" step="0.1" value="1.0" style="width:80px;vertical-align:middle">
    <span id="zoom-sensitivity-value" style="opacity:0.6;min-width:30px;display:inline-block">1.0×</span>
  </div>
  <div id="viewer-viewport">
    <img id="viewer-img" src="">
    <iframe id="viewer-iframe"></iframe>
    <div id="viewer-hud"></div>
  </div>
</div>

<script>
(function() {
  const grid = document.getElementById('level-grid');
  const status = document.getElementById('status');
  const btnRender = document.getElementById('btn-render');
  const btnRenderAll = document.getElementById('btn-render-all');
  const scaleSelect = document.getElementById('scale-select');
  const floorSelect = document.getElementById('floor-select');
  const showEditorCheckbox = document.getElementById('show-editor');

  let levels = [];
  let selectedId = null;
  let rendering = false;
  // Track rendered URLs: levelId -> { url, tiled }
  const rendered = {};

  // Helper: build query string from current UI state
  function buildQueryString() {
    const scale = scaleSelect.value;
    const floor = floorSelect.value;
    const showEditor = showEditorCheckbox.checked;
    let qs = 'scale=' + scale;
    if (floor !== '') qs += '&floor=' + floor;
    if (showEditor) qs += '&showEditor=true';
    return qs;
  }

  // Fetch level list, then check cached status
  fetch('/api/levels').then(r => r.json()).then(data => {
    levels = data;
    return loadCachedStatus();
  }).then(() => {
    renderGrid();
  });

  function loadCachedStatus() {
    const qs = buildQueryString();
    return fetch('/api/cached?' + qs).then(r => r.json()).then(data => {
      // Merge into rendered map
      for (const id in data) {
        rendered[id] = data[id];
      }
    });
  }

  // Refresh cached status when scale/floor/editor changes
  scaleSelect.addEventListener('change', function() {
    loadCachedStatus().then(renderGrid);
  });
  floorSelect.addEventListener('change', function() {
    loadCachedStatus().then(renderGrid);
  });
  showEditorCheckbox.addEventListener('change', function() {
    loadCachedStatus().then(renderGrid);
  });

  function renderGrid() {
    grid.innerHTML = '';
    for (const lv of levels) {
      const card = document.createElement('div');
      card.className = 'card' + (lv.id === selectedId ? ' active' : '');
      const hasRender = rendered[lv.id];
      card.innerHTML = '<div class="name">' + esc(lv.name) + '</div>'
        + '<div class="meta">Maps: ' + lv.mapIndices.join(', ') + '</div>'
        + '<div class="thumb"><img id="thumb-' + lv.id + '"><span class="placeholder">' + (hasRender ? 'tiled render' : 'no render') + '</span></div>'
        + (hasRender ? '<button class="view-btn" data-id="' + lv.id + '">View</button>' : '');
      card.addEventListener('click', function(e) {
        if (e.target.classList.contains('view-btn')) return;
        selectLevel(lv.id);
      });
      grid.appendChild(card);
    }
    // Wire up view buttons
    document.querySelectorAll('.view-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        const r = rendered[id];
        if (r) {
          const lv = levels.find(l => l.id === id);
          openViewer(lv.name, r.url, r.tiled);
        }
      });
    });
    refreshThumbs();
  }

  function selectLevel(id) {
    selectedId = id;
    const lv = levels.find(l => l.id === id);
    btnRender.disabled = false;
    btnRender.textContent = 'Render ' + lv.name;
    document.querySelectorAll('.card').forEach(c => c.classList.remove('active'));
    // Find and highlight
    const cards = document.querySelectorAll('.card');
    const idx = levels.findIndex(l => l.id === id);
    if (idx >= 0 && cards[idx]) cards[idx].classList.add('active');
  }

  function setStatus(html) { status.innerHTML = html; }

  async function renderLevel(levelId, showViewer) {
    const lv = levels.find(l => l.id === levelId);
    const qs = buildQueryString();

    setStatus('<span class="spinner"></span> Rendering ' + esc(lv.name) + ' ...');
    rendering = true;
    btnRender.disabled = true;
    btnRenderAll.disabled = true;

    try {
      const resp = await fetch('/api/render/' + levelId + '?' + qs);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Render failed');

      setStatus('\\u2713 ' + esc(lv.name) + ' ready');

      // Track render result
      rendered[levelId] = { url: data.url, tiled: !!data.tiled };

      // Update thumbnail (only for single-image renders)
      if (!data.tiled) {
        const thumb = document.getElementById('thumb-' + levelId);
        if (thumb) {
          thumb.src = data.url + '?t=' + Date.now();
          thumb.style.display = 'block';
          thumb.parentElement.querySelector('.placeholder').style.display = 'none';
        }
      }

      // Refresh grid to show View buttons
      renderGrid();

      if (showViewer) {
        openViewer(lv.name, data.url, !!data.tiled);
      }
    } catch (err) {
      setStatus('\\u2717 Error: ' + esc(err.message));
    } finally {
      rendering = false;
      btnRender.disabled = !selectedId;
      btnRenderAll.disabled = false;
    }
  }

  function refreshThumbs() {
    // Just try loading each — if cached, the img loads; if not, it stays hidden
    for (const lv of levels) {
      const thumb = document.getElementById('thumb-' + lv.id);
      if (!thumb) continue;
      // We don't know the cache key pattern on this end, so just try rendering endpoint
      // thumbs will populate as renders complete
    }
  }

  btnRender.addEventListener('click', function() {
    if (!selectedId || rendering) return;
    renderLevel(selectedId, true);
  });

  btnRenderAll.addEventListener('click', async function() {
    if (rendering) return;
    rendering = true;
    btnRender.disabled = true;
    btnRenderAll.disabled = true;
    for (let i = 0; i < levels.length; i++) {
      const lv = levels[i];
      setStatus('<span class="spinner"></span> [' + (i+1) + '/' + levels.length + '] Rendering ' + esc(lv.name) + ' ...');
      try {
        const qs = buildQueryString();
        const resp = await fetch('/api/render/' + lv.id + '?' + qs);
        const data = await resp.json();
        if (resp.ok) {
          rendered[lv.id] = { url: data.url, tiled: !!data.tiled };
          if (!data.tiled) {
            const thumb = document.getElementById('thumb-' + lv.id);
            if (thumb) {
              thumb.src = data.url + '?t=' + Date.now();
              thumb.style.display = 'block';
              thumb.parentElement.querySelector('.placeholder').style.display = 'none';
            }
          }
        }
      } catch (e) { /* continue */ }
    }
    setStatus('\\u2713 All levels rendered!');
    renderGrid();
    rendering = false;
    btnRender.disabled = !selectedId;
    btnRenderAll.disabled = false;
  });

  // Double-click a card to render + view
  grid.addEventListener('dblclick', function(e) {
    const card = e.target.closest('.card');
    if (!card || rendering) return;
    const idx = Array.from(grid.children).indexOf(card);
    if (idx >= 0 && levels[idx]) {
      selectLevel(levels[idx].id);
      renderLevel(levels[idx].id, true);
    }
  });

  // ── Image Viewer ──
  const overlay = document.getElementById('viewer-overlay');
  const vp = document.getElementById('viewer-viewport');
  const vImg = document.getElementById('viewer-img');
  const vIframe = document.getElementById('viewer-iframe');
  const vTitle = document.getElementById('viewer-title');
  const vZoomLabel = document.getElementById('viewer-zoom');
  const vHud = document.getElementById('viewer-hud');
  // Zoom control buttons container
  const zoomControls = [
    document.getElementById('viewer-zout'),
    document.getElementById('viewer-zoom'),
    document.getElementById('viewer-zin'),
    document.getElementById('viewer-fit'),
    document.getElementById('viewer-reset')
  ];

  let vZoom = 1, vPanX = 0, vPanY = 0;
  let viewerMode = 'image'; // 'image' or 'tiled'
  const V_MIN_ZOOM = 0.02, V_MAX_ZOOM = 10;
  let vMouseX = 0, vMouseY = 0; // Current mouse world coordinates
  let vImageOffsetX = 0, vImageOffsetY = 0; // Image offset in world space

  // Zoom sensitivity control
  let zoomSensitivity = parseFloat(localStorage.getItem('zoomSensitivity') || '1.0');
  const sensitivitySlider = document.getElementById('zoom-sensitivity');
  const sensitivityValue = document.getElementById('zoom-sensitivity-value');
  sensitivitySlider.value = zoomSensitivity.toString();
  sensitivityValue.textContent = zoomSensitivity.toFixed(1) + '×';

  sensitivitySlider.addEventListener('input', function() {
    zoomSensitivity = parseFloat(this.value);
    sensitivityValue.textContent = zoomSensitivity.toFixed(1) + '×';
    localStorage.setItem('zoomSensitivity', zoomSensitivity.toString());
  });

  function applyViewerTransform() {
    vImg.style.transform = 'translate(' + vPanX + 'px,' + vPanY + 'px) scale(' + vZoom + ')';
    vZoomLabel.textContent = Math.round(vZoom * 100) + '%';
    updateViewerHud();
  }

  function screenToWorld(screenX, screenY) {
    // Convert screen coordinates to world coordinates
    const worldX = (screenX - vPanX) / vZoom + vImageOffsetX;
    const worldY = (screenY - vPanY) / vZoom + vImageOffsetY;
    return { x: Math.round(worldX), y: Math.round(worldY) };
  }

  function updateViewerHud() {
    if (viewerMode !== 'image') return;

    const iw = vImg.naturalWidth || 0;
    const ih = vImg.naturalHeight || 0;
    if (iw === 0 || ih === 0) {
      vHud.innerHTML = 'Loading...';
      return;
    }

    // Calculate visible bounds in world coordinates
    const topLeft = screenToWorld(0, 0);
    const bottomRight = screenToWorld(vp.clientWidth, vp.clientHeight);

    const scale = parseFloat(scaleSelect.value);
    const worldMouseX = Math.round(vMouseX / scale);
    const worldMouseY = Math.round(vMouseY / scale);

    // Calculate viewport bounds
    const viewX = Math.round(topLeft.x / scale);
    const viewY = Math.round(topLeft.y / scale);
    const viewWidth = Math.round((bottomRight.x - topLeft.x) / scale);
    const viewHeight = Math.round((bottomRight.y - topLeft.y) / scale);

    vHud.innerHTML =
      '<div class="coord-line"><span class="coord-label">Image size:</span><span class="coord-value">' + iw + ' × ' + ih + 'px</span></div>' +
      '<div class="coord-line"><span class="coord-label">Mouse:</span><span class="coord-value">x=' + worldMouseX + ', y=' + worldMouseY + '</span></div>' +
      '<div class="coord-line"><span class="coord-label">Viewport:</span><span class="coord-value">' +
        'x=' + viewX + ' y=' + viewY + ' width=' + viewWidth + ' height=' + viewHeight +
      '</span></div>' +
      '<div class="copy-hint">Use viewport coords with --x --y --width --height</div>';
  }

  function viewerZoomAt(cx, cy, factor) {
    const nz = Math.min(V_MAX_ZOOM, Math.max(V_MIN_ZOOM, vZoom * factor));
    const r = nz / vZoom;
    vPanX = cx - (cx - vPanX) * r;
    vPanY = cy - (cy - vPanY) * r;
    vZoom = nz;
    applyViewerTransform();
  }

  function viewerZoomCenter(factor) {
    viewerZoomAt(vp.clientWidth / 2, vp.clientHeight / 2, factor);
  }

  function viewerFit() {
    const iw = vImg.naturalWidth || 1;
    const ih = vImg.naturalHeight || 1;
    vZoom = Math.min(vp.clientWidth / iw, vp.clientHeight / ih, V_MAX_ZOOM);
    vPanX = (vp.clientWidth - iw * vZoom) / 2;
    vPanY = (vp.clientHeight - ih * vZoom) / 2;
    applyViewerTransform();
  }

  function openViewer(name, url, tiled) {
    vTitle.textContent = name;
    if (tiled) {
      viewerMode = 'tiled';
      vImg.style.display = 'none';
      vIframe.style.display = 'block';
      vIframe.src = url;
      vHud.innerHTML = '<div class="coord-line">Tiled render — zoom controls inside viewer</div><div class="copy-hint">Coordinates not available for tiled renders</div>';
      // Hide zoom controls (the iframe has its own)
      zoomControls.forEach(function(el) { if (el) el.style.display = 'none'; });
      vp.style.cursor = 'default';
    } else {
      viewerMode = 'image';
      vIframe.style.display = 'none';
      vIframe.src = '';
      vImg.style.display = 'block';
      vImg.src = url;
      vImg.onload = function() {
        vImageOffsetX = 0;
        vImageOffsetY = 0;
        viewerFit();
        updateViewerHud();
      };
      zoomControls.forEach(function(el) { if (el) el.style.display = ''; });
      vp.style.cursor = 'grab';
    }
    overlay.classList.add('visible');
  }

  document.getElementById('viewer-close').addEventListener('click', function() {
    overlay.classList.remove('visible');
    vIframe.src = '';
  });
  document.getElementById('viewer-fit').addEventListener('click', viewerFit);
  document.getElementById('viewer-reset').addEventListener('click', function() {
    vZoom = 1; vPanX = 0; vPanY = 0; applyViewerTransform();
  });
  document.getElementById('viewer-zin').addEventListener('click', function() { viewerZoomCenter(1.25); });
  document.getElementById('viewer-zout').addEventListener('click', function() { viewerZoomCenter(1 / 1.25); });

  vp.addEventListener('wheel', function(e) {
    if (viewerMode !== 'image') return;
    e.preventDefault();
    const rect = vp.getBoundingClientRect();
    // Apply zoom sensitivity: base zoom factor powered by sensitivity
    const baseZoom = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const effectiveZoom = Math.pow(baseZoom, zoomSensitivity);
    viewerZoomAt(e.clientX - rect.left, e.clientY - rect.top, effectiveZoom);
  }, { passive: false });

  let vDragging = false, vDx = 0, vDy = 0, vPx = 0, vPy = 0;
  vp.addEventListener('mousedown', function(e) {
    if (viewerMode !== 'image') return;
    if (e.button !== 0) return;
    vDragging = true; vDx = e.clientX; vDy = e.clientY; vPx = vPanX; vPy = vPanY;
    vp.classList.add('dragging'); e.preventDefault();
  });
  window.addEventListener('mousemove', function(e) {
    if (vDragging) {
      vPanX = vPx + (e.clientX - vDx); vPanY = vPy + (e.clientY - vDy);
      applyViewerTransform();
    }
  });

  // Track mouse position for coordinate display
  vp.addEventListener('mousemove', function(e) {
    if (viewerMode !== 'image') return;
    const rect = vp.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const world = screenToWorld(screenX, screenY);
    vMouseX = world.x;
    vMouseY = world.y;
    updateViewerHud();
  });
  window.addEventListener('mouseup', function() { vDragging = false; vp.classList.remove('dragging'); });

  // Keyboard (when viewer is open)
  window.addEventListener('keydown', function(e) {
    if (!overlay.classList.contains('visible')) return;
    if (e.key === 'Escape') { overlay.classList.remove('visible'); e.preventDefault(); }
    if (e.key === '+' || e.key === '=') { viewerZoomCenter(1.25); e.preventDefault(); }
    if (e.key === '-') { viewerZoomCenter(1 / 1.25); e.preventDefault(); }
    if (e.key === 'f' || e.key === 'F') { viewerFit(); e.preventDefault(); }
    if (e.key === '0') { vZoom = 1; vPanX = 0; vPanY = 0; applyViewerTransform(); e.preventDefault(); }
  });

  function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
})();
</script>
</body>
</html>`;
}
