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
function cacheKey(levelId: string, scale: number, floor: number | null): string {
  let key = `${levelId}_s${scale.toFixed(2).replace(".", "")}`;
  if (floor !== null) key += `_f${floor}`;
  return key + ".png";
}

/**
 * Start the web server.
 */
export function startServer(gd: GameData, port: number, cacheDir: string): void {
  const app = express();
  const levels = buildLevelList();

  fs.mkdirSync(cacheDir, { recursive: true });

  // Serve cached files
  app.use("/cache", express.static(cacheDir));

  // ── API: level list ──
  app.get("/api/levels", (_req, res) => {
    res.json(levels);
  });

  // ── API: render ──
  // Track in-flight renders to avoid duplicate work
  const rendering = new Map<string, Promise<string>>();

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

    const key = cacheKey(levelId, scale, floor);
    const cachedPath = path.join(cacheDir, key);

    // Serve from cache if it exists
    if (fs.existsSync(cachedPath)) {
      res.json({ status: "done", url: `/cache/${key}` });
      return;
    }

    // If already rendering, wait for it
    if (rendering.has(key)) {
      try {
        const url = await rendering.get(key)!;
        res.json({ status: "done", url });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
      return;
    }

    // Start render
    const renderPromise = (async (): Promise<string> => {
      const allItems: any[] = [];
      for (const idx of level.mapIndices) {
        const mapData = getFlxEntryData(gd.fixedArchive, idx);
        if (!mapData) continue;
        const fixedItems = parseFixedItems(mapData);
        const resolved = resolveMapItems(fixedItems, gd.globs, gd.typeFlags);
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

      const result = await renderMap(allItems, gd.shapesArchive, gd.palette, {
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

      // If not tiled, write single PNG
      if (result.toString() !== "TILED") {
        fs.writeFileSync(cachedPath, result);
      }

      console.log(`  ✓ ${level.name} cached → ${key}`);
      const url = `/cache/${key}`;
      return url;
    })();

    rendering.set(key, renderPromise);

    try {
      const url = await renderPromise;
      res.json({ status: "done", url });
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
  #viewer-hud {
    position: absolute; bottom: 12px; right: 12px;
    font-size: 11px; color: #0a0; opacity: 0.5;
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
  </div>
  <div id="viewer-viewport">
    <img id="viewer-img" src="">
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

  let levels = [];
  let selectedId = null;
  let rendering = false;

  // Fetch level list
  fetch('/api/levels').then(r => r.json()).then(data => {
    levels = data;
    renderGrid();
  });

  function renderGrid() {
    grid.innerHTML = '';
    for (const lv of levels) {
      const card = document.createElement('div');
      card.className = 'card' + (lv.id === selectedId ? ' active' : '');
      card.innerHTML = '<div class="name">' + esc(lv.name) + '</div>'
        + '<div class="meta">Maps: ' + lv.mapIndices.join(', ') + '</div>'
        + '<div class="thumb"><img id="thumb-' + lv.id + '"><span class="placeholder">no render</span></div>';
      card.addEventListener('click', function() { selectLevel(lv.id); });
      grid.appendChild(card);
    }
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
    const scale = scaleSelect.value;
    const floor = floorSelect.value;
    const lv = levels.find(l => l.id === levelId);
    const qs = 'scale=' + scale + (floor !== '' ? '&floor=' + floor : '');

    setStatus('<span class="spinner"></span> Rendering ' + esc(lv.name) + ' ...');
    rendering = true;
    btnRender.disabled = true;
    btnRenderAll.disabled = true;

    try {
      const resp = await fetch('/api/render/' + levelId + '?' + qs);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Render failed');

      setStatus('\\u2713 ' + esc(lv.name) + ' ready');

      // Update thumbnail
      const thumb = document.getElementById('thumb-' + levelId);
      if (thumb) {
        thumb.src = data.url + '?t=' + Date.now();
        thumb.style.display = 'block';
        thumb.parentElement.querySelector('.placeholder').style.display = 'none';
      }

      if (showViewer) openViewer(lv.name, data.url);
    } catch (err) {
      setStatus('\\u2717 Error: ' + esc(err.message));
    } finally {
      rendering = false;
      btnRender.disabled = !selectedId;
      btnRenderAll.disabled = false;
    }
  }

  function refreshThumbs() {
    const scale = scaleSelect.value;
    const floor = floorSelect.value;
    // Just try loading each — if cached, the img loads; if not, it stays hidden
    for (const lv of levels) {
      const qs = 'scale=' + scale + (floor !== '' ? '&floor=' + floor : '');
      // Quick check via a HEAD-like fetch (just try loading the image)
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
        const scale = scaleSelect.value;
        const floor = floorSelect.value;
        const qs = 'scale=' + scale + (floor !== '' ? '&floor=' + floor : '');
        const resp = await fetch('/api/render/' + lv.id + '?' + qs);
        const data = await resp.json();
        if (resp.ok) {
          const thumb = document.getElementById('thumb-' + lv.id);
          if (thumb) {
            thumb.src = data.url + '?t=' + Date.now();
            thumb.style.display = 'block';
            thumb.parentElement.querySelector('.placeholder').style.display = 'none';
          }
        }
      } catch (e) { /* continue */ }
    }
    setStatus('\\u2713 All levels rendered!');
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
  const vTitle = document.getElementById('viewer-title');
  const vZoomLabel = document.getElementById('viewer-zoom');
  const vHud = document.getElementById('viewer-hud');

  let vZoom = 1, vPanX = 0, vPanY = 0;
  const V_MIN_ZOOM = 0.02, V_MAX_ZOOM = 10;

  function applyViewerTransform() {
    vImg.style.transform = 'translate(' + vPanX + 'px,' + vPanY + 'px) scale(' + vZoom + ')';
    vZoomLabel.textContent = Math.round(vZoom * 100) + '%';
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

  function openViewer(name, url) {
    vTitle.textContent = name;
    vImg.src = url;
    vImg.onload = function() {
      vHud.textContent = vImg.naturalWidth + '\\u00d7' + vImg.naturalHeight + 'px';
      viewerFit();
    };
    overlay.classList.add('visible');
  }

  document.getElementById('viewer-close').addEventListener('click', function() {
    overlay.classList.remove('visible');
  });
  document.getElementById('viewer-fit').addEventListener('click', viewerFit);
  document.getElementById('viewer-reset').addEventListener('click', function() {
    vZoom = 1; vPanX = 0; vPanY = 0; applyViewerTransform();
  });
  document.getElementById('viewer-zin').addEventListener('click', function() { viewerZoomCenter(1.25); });
  document.getElementById('viewer-zout').addEventListener('click', function() { viewerZoomCenter(1 / 1.25); });

  vp.addEventListener('wheel', function(e) {
    e.preventDefault();
    const rect = vp.getBoundingClientRect();
    viewerZoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }, { passive: false });

  let vDragging = false, vDx = 0, vDy = 0, vPx = 0, vPy = 0;
  vp.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return;
    vDragging = true; vDx = e.clientX; vDy = e.clientY; vPx = vPanX; vPy = vPanY;
    vp.classList.add('dragging'); e.preventDefault();
  });
  window.addEventListener('mousemove', function(e) {
    if (!vDragging) return;
    vPanX = vPx + (e.clientX - vDx); vPanY = vPy + (e.clientY - vDy);
    applyViewerTransform();
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
