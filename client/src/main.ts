import "./style.css";
import { initViewer, openViewer, type RestoreState } from "./viewer";

interface LevelInfo {
  id: string;
  name: string;
  mapIndices: number[];
}

const grid = document.getElementById("level-grid")!;
const status = document.getElementById("status")!;
const btnRender = document.getElementById("btn-render") as HTMLButtonElement;
const btnRenderAll = document.getElementById("btn-render-all") as HTMLButtonElement;
const btnFloorAll = document.getElementById("floor-all") as HTMLButtonElement;
export const scaleSelect = document.getElementById("scale-select") as HTMLSelectElement;
const floorCheckboxes = document.querySelectorAll<HTMLInputElement>(".floor-checkbox");
export const showEditorCheckbox = document.getElementById("show-editor") as HTMLInputElement;

export let levels: LevelInfo[] = [];
let selectedId: string | null = null;
let rendering = false;
export const rendered: Record<string, { url: string; tiled: boolean }> = {};

const ALL_FLOORS = [0, 1, 2, 3, 4];

export function getSelectedFloors(checkboxes?: NodeListOf<HTMLInputElement>): number[] {
  checkboxes = checkboxes || floorCheckboxes;
  const selected = Array.from(checkboxes)
    .filter((cb) => cb.checked)
    .map((cb) => parseInt(cb.value, 10));
  if (selected.length === ALL_FLOORS.length) return [];
  return selected;
}

function buildQueryString(): string {
  const scale = scaleSelect.value;
  const floors = getSelectedFloors();
  const showEditor = showEditorCheckbox.checked;
  let qs = "scale=" + scale;
  if (floors.length > 0) qs += "&floors=" + floors.join(",");
  if (showEditor) qs += "&showEditor=true";
  return qs;
}

function saveStateToURL() {
  const params = new URLSearchParams();
  if (selectedId) params.set("level", selectedId);
  params.set("scale", scaleSelect.value);
  const floors = getSelectedFloors();
  if (floors.length > 0) params.set("floors", floors.join(","));
  if (showEditorCheckbox.checked) params.set("editor", "true");
  window.history.replaceState(null, "", "#" + params.toString());
}

function loadStateFromURL(): string | false {
  const hash = window.location.hash.slice(1);
  if (!hash) return false;
  const params = new URLSearchParams(hash);

  const scale = params.get("scale");
  if (scale) scaleSelect.value = scale;

  const floors = params.get("floors");
  if (floors) {
    const floorNums = floors.split(",").map(Number);
    floorCheckboxes.forEach((cb) => {
      cb.checked = floorNums.includes(parseInt(cb.value, 10));
    });
  }

  if (params.get("editor") === "true") {
    showEditorCheckbox.checked = true;
  }

  const levelId = params.get("level");
  if (levelId) {
    selectedId = levelId;
    return levelId;
  }

  return false;
}

// Capture full URL state before anything overwrites it
let urlRestoreState: (RestoreState & { levelId: string }) | null = null;
(function () {
  const hash = window.location.hash.slice(1);
  if (!hash) return;
  const params = new URLSearchParams(hash);
  const levelId = params.get("level");
  if (!levelId) return;
  urlRestoreState = {
    levelId: levelId,
    zoom: parseFloat(params.get("zoom") || "NaN"),
    panX: parseInt(params.get("panX") || "NaN", 10),
    panY: parseInt(params.get("panY") || "NaN", 10),
  };
})();

export function loadCachedStatus(): Promise<void> {
  const qs = buildQueryString();
  return fetch("/api/cached?" + qs)
    .then((r) => r.json())
    .then((data) => {
      for (const id in data) {
        rendered[id] = data[id];
      }
    });
}

export function setStatus(html: string) {
  status.innerHTML = html;
}

export function renderGrid() {
  grid.innerHTML = "";
  for (const lv of levels) {
    const card = document.createElement("div");
    card.className = "card" + (lv.id === selectedId ? " active" : "");
    const hasRender = rendered[lv.id];
    card.innerHTML =
      '<div class="name">' + esc(lv.name) + "</div>" +
      '<div class="meta">Maps: ' + lv.mapIndices.join(", ") + "</div>" +
      '<div class="thumb"><img id="thumb-' + lv.id + '"><span class="placeholder">' + (hasRender ? "tiled render" : "no render") + "</span></div>" +
      (hasRender ? '<button class="view-btn" data-id="' + lv.id + '">View</button>' : "");
    card.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).classList.contains("view-btn")) return;
      selectLevel(lv.id);
    });
    grid.appendChild(card);
  }
  document.querySelectorAll(".view-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = (btn as HTMLElement).getAttribute("data-id")!;
      const r = rendered[id];
      if (r) {
        const lv = levels.find((l) => l.id === id);
        if (lv) openViewer(lv.id, lv.name, r.url, r.tiled);
      }
    });
  });
  refreshThumbs();
}

function selectLevel(id: string) {
  selectedId = id;
  const lv = levels.find((l) => l.id === id);
  btnRender.disabled = false;
  btnRender.textContent = "Render " + lv!.name;
  document.querySelectorAll(".card").forEach((c) => c.classList.remove("active"));
  const cards = document.querySelectorAll(".card");
  const idx = levels.findIndex((l) => l.id === id);
  if (idx >= 0 && cards[idx]) cards[idx].classList.add("active");
  saveStateToURL();
}

async function renderLevel(levelId: string, showViewer: boolean) {
  const lv = levels.find((l) => l.id === levelId)!;
  const qs = buildQueryString();

  setStatus('<span class="spinner"></span> Rendering ' + esc(lv.name) + " ...");
  rendering = true;
  btnRender.disabled = true;
  btnRenderAll.disabled = true;

  try {
    const resp = await fetch("/api/render/" + levelId + "?" + qs);
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Render failed");

    setStatus("\u2713 " + esc(lv.name) + " ready");
    rendered[levelId] = { url: data.url, tiled: !!data.tiled };

    if (!data.tiled) {
      const thumb = document.getElementById("thumb-" + levelId) as HTMLImageElement | null;
      if (thumb) {
        thumb.src = data.url + "?t=" + Date.now();
        thumb.style.display = "block";
        thumb.parentElement!.querySelector<HTMLElement>(".placeholder")!.style.display = "none";
      }
    }

    renderGrid();

    if (showViewer) {
      openViewer(lv.id, lv.name, data.url, !!data.tiled);
    }
  } catch (err: any) {
    setStatus("\u2717 Error: " + esc(err.message));
  } finally {
    rendering = false;
    btnRender.disabled = !selectedId;
    btnRenderAll.disabled = false;
  }
}

function refreshThumbs() {
  // Thumbs populate as renders complete
}

function esc(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// ── Init ──

initViewer();

// Event listeners
scaleSelect.addEventListener("change", () => {
  saveStateToURL();
  loadCachedStatus().then(renderGrid);
});
floorCheckboxes.forEach((cb) => {
  cb.addEventListener("change", () => {
    saveStateToURL();
    loadCachedStatus().then(renderGrid);
  });
});
showEditorCheckbox.addEventListener("change", () => {
  saveStateToURL();
  loadCachedStatus().then(renderGrid);
});

btnFloorAll.addEventListener("click", () => {
  const allChecked = Array.from(floorCheckboxes).every((cb) => cb.checked);
  floorCheckboxes.forEach((cb) => (cb.checked = !allChecked));
  saveStateToURL();
  loadCachedStatus().then(renderGrid);
});

btnRender.addEventListener("click", () => {
  if (!selectedId || rendering) return;
  renderLevel(selectedId, true);
});

btnRenderAll.addEventListener("click", async () => {
  if (rendering) return;
  rendering = true;
  btnRender.disabled = true;
  btnRenderAll.disabled = true;
  for (let i = 0; i < levels.length; i++) {
    const lv = levels[i];
    setStatus('<span class="spinner"></span> [' + (i + 1) + "/" + levels.length + "] Rendering " + esc(lv.name) + " ...");
    try {
      const qs = buildQueryString();
      const resp = await fetch("/api/render/" + lv.id + "?" + qs);
      const data = await resp.json();
      if (resp.ok) {
        rendered[lv.id] = { url: data.url, tiled: !!data.tiled };
        if (!data.tiled) {
          const thumb = document.getElementById("thumb-" + lv.id) as HTMLImageElement | null;
          if (thumb) {
            thumb.src = data.url + "?t=" + Date.now();
            thumb.style.display = "block";
            thumb.parentElement!.querySelector<HTMLElement>(".placeholder")!.style.display = "none";
          }
        }
      }
    } catch (_e) { /* continue */ }
  }
  setStatus("\u2713 All levels rendered!");
  renderGrid();
  rendering = false;
  btnRender.disabled = !selectedId;
  btnRenderAll.disabled = false;
});

grid.addEventListener("dblclick", (e) => {
  const card = (e.target as HTMLElement).closest(".card");
  if (!card || rendering) return;
  const idx = Array.from(grid.children).indexOf(card);
  if (idx >= 0 && levels[idx]) {
    selectLevel(levels[idx].id);
    renderLevel(levels[idx].id, true);
  }
});

// Fetch level list, then check cached status
fetch("/api/levels")
  .then((r) => r.json())
  .then((data) => {
    levels = data;
    const restoredLevelId = loadStateFromURL();
    if (restoredLevelId) {
      selectLevel(restoredLevelId);
    }
    return loadCachedStatus();
  })
  .then(() => {
    renderGrid();
    if (urlRestoreState && rendered[urlRestoreState.levelId]) {
      const r = urlRestoreState;
      const lv = levels.find((l) => l.id === r.levelId);
      if (lv) {
        openViewer(lv.id, lv.name, rendered[r.levelId].url, rendered[r.levelId].tiled, r);
      }
    }
  });
