import { errorMessage } from "./errors";
import {
  getSelectedFloors,
  levels,
  loadCachedStatus,
  rendered,
  renderGrid,
  scaleSelect,
  setStatus,
  showEditorCheckbox,
} from "./main";

const overlay = document.getElementById("viewer-overlay")!;
const vp = document.getElementById("viewer-viewport")!;
const vImg = document.getElementById("viewer-img") as HTMLImageElement;
const vIframe = document.getElementById("viewer-iframe") as HTMLIFrameElement;
const vTitle = document.getElementById("viewer-title")!;
const vZoomLabel = document.getElementById("viewer-zoom")!;
const vHud = document.getElementById("viewer-hud")!;
const zoomControls = [
  document.getElementById("viewer-zout"),
  document.getElementById("viewer-zoom"),
  document.getElementById("viewer-zin"),
  document.getElementById("viewer-fit"),
  document.getElementById("viewer-reset"),
];

let vZoom = 1,
  vPanX = 0,
  vPanY = 0;
let viewerMode: "image" | "tiled" = "image";
const V_MIN_ZOOM = 0.02,
  V_MAX_ZOOM = 10;
let vMouseX = 0,
  vMouseY = 0;
let vImageOffsetX = 0,
  vImageOffsetY = 0;

const viewerScale = document.getElementById("viewer-scale") as HTMLSelectElement;
const viewerShowEditor = document.getElementById("viewer-show-editor") as HTMLInputElement;
const viewerFloorCheckboxes = document.querySelectorAll<HTMLInputElement>(".viewer-floor-checkbox");
const viewerRefreshBtn = document.getElementById("viewer-refresh") as HTMLButtonElement;
export let currentViewerLevelId: string | null = null;

function syncViewerControls() {
  viewerScale.value = scaleSelect.value;
  viewerShowEditor.checked = showEditorCheckbox.checked;
  const selectedFloors = getSelectedFloors();
  viewerFloorCheckboxes.forEach((cb) => {
    if (selectedFloors.length === 0) {
      cb.checked = true;
    } else {
      cb.checked = selectedFloors.includes(parseInt(cb.value, 10));
    }
  });
}

async function refreshViewer() {
  if (!currentViewerLevelId) return;

  const scale = viewerScale.value;
  const floors = getSelectedFloors(viewerFloorCheckboxes);
  const showEditor = viewerShowEditor.checked;
  let qs = `scale=${scale}`;
  if (floors.length > 0) qs += `&floors=${floors.join(",")}`;
  if (showEditor) qs += "&showEditor=true";

  if (viewerMode === "image") {
    vImg.style.opacity = "0.3";
  }
  viewerRefreshBtn.disabled = true;
  viewerRefreshBtn.textContent = "Rendering...";
  setStatus('<span class="spinner"></span> Rendering with new settings...');

  try {
    const resp = await fetch(`/api/render/${currentViewerLevelId}?${qs}`);
    const data = await resp.json();

    if (resp.ok) {
      const lv = levels.find((l) => l.id === currentViewerLevelId);
      const name = lv ? lv.name : currentViewerLevelId!;

      const curScale = viewerScale.value;
      const curEditor = viewerShowEditor.checked;
      const curFloors = Array.from(viewerFloorCheckboxes).map((cb) => cb.checked);

      overlay.classList.remove("visible");
      openViewer(currentViewerLevelId!, name, data.url, !!data.tiled);

      viewerScale.value = curScale;
      viewerShowEditor.checked = curEditor;
      Array.from(viewerFloorCheckboxes).forEach((cb, i) => {
        cb.checked = curFloors[i];
      });

      rendered[currentViewerLevelId!] = { url: data.url, tiled: !!data.tiled };
      viewerRefreshBtn.disabled = false;
      viewerRefreshBtn.textContent = "Refresh";
      setStatus("View refreshed");
      saveViewerStateToURL();
      loadCachedStatus().then(renderGrid);
    } else {
      if (viewerMode === "image") vImg.style.opacity = "1";
      viewerRefreshBtn.disabled = false;
      viewerRefreshBtn.textContent = "Refresh";
      setStatus(`Error: ${data.error || "Render failed"}`);
    }
  } catch (err) {
    if (viewerMode === "image") vImg.style.opacity = "1";
    viewerRefreshBtn.disabled = false;
    viewerRefreshBtn.textContent = "Refresh";
    setStatus(`Error: ${errorMessage(err)}`);
  }
}

function applyViewerTransform() {
  vImg.style.transform = `translate(${vPanX}px,${vPanY}px) scale(${vZoom})`;
  vZoomLabel.textContent = `${Math.round(vZoom * 100)}%`;
  updateViewerHud();
  saveViewerStateToURL();
}

export function saveViewerStateToURL() {
  if (!currentViewerLevelId) return;
  const params = new URLSearchParams();
  params.set("level", currentViewerLevelId);
  params.set("scale", viewerScale.value);
  const floors = getSelectedFloors(viewerFloorCheckboxes);
  if (floors.length > 0) params.set("floors", floors.join(","));
  if (viewerShowEditor.checked) params.set("editor", "true");
  if (viewerMode === "image") {
    params.set("zoom", vZoom.toFixed(2));
    params.set("panX", Math.round(vPanX).toString());
    params.set("panY", Math.round(vPanY).toString());
  }
  window.history.replaceState(null, "", `#${params.toString()}`);
}

function screenToWorld(screenX: number, screenY: number) {
  const worldX = (screenX - vPanX) / vZoom + vImageOffsetX;
  const worldY = (screenY - vPanY) / vZoom + vImageOffsetY;
  return { x: Math.round(worldX), y: Math.round(worldY) };
}

function updateViewerHud() {
  if (viewerMode !== "image") return;

  const iw = vImg.naturalWidth || 0;
  const ih = vImg.naturalHeight || 0;
  if (iw === 0 || ih === 0) {
    vHud.innerHTML = "Loading...";
    return;
  }

  const topLeft = screenToWorld(0, 0);
  const bottomRight = screenToWorld(vp.clientWidth, vp.clientHeight);

  const scale = parseFloat(scaleSelect.value);
  const worldMouseX = Math.round(vMouseX / scale);
  const worldMouseY = Math.round(vMouseY / scale);

  const viewX = Math.round(topLeft.x / scale);
  const viewY = Math.round(topLeft.y / scale);
  const viewWidth = Math.round((bottomRight.x - topLeft.x) / scale);
  const viewHeight = Math.round((bottomRight.y - topLeft.y) / scale);

  vHud.innerHTML =
    '<div class="coord-line"><span class="coord-label">Image size:</span><span class="coord-value">' +
    iw +
    " × " +
    ih +
    "px</span></div>" +
    '<div class="coord-line"><span class="coord-label">Mouse:</span><span class="coord-value">x=' +
    worldMouseX +
    ", y=" +
    worldMouseY +
    "</span></div>" +
    '<div class="coord-line"><span class="coord-label">Viewport:</span><span class="coord-value">' +
    "x=" +
    viewX +
    " y=" +
    viewY +
    " width=" +
    viewWidth +
    " height=" +
    viewHeight +
    "</span></div>" +
    '<div class="copy-hint">Use viewport coords with --x --y --width --height</div>';
}

function viewerZoomAt(cx: number, cy: number, factor: number) {
  const nz = Math.min(V_MAX_ZOOM, Math.max(V_MIN_ZOOM, vZoom * factor));
  const r = nz / vZoom;
  vPanX = cx - (cx - vPanX) * r;
  vPanY = cy - (cy - vPanY) * r;
  vZoom = nz;
  applyViewerTransform();
}

function viewerZoomCenter(factor: number) {
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

export interface RestoreState {
  zoom: number;
  panX: number;
  panY: number;
}

export function openViewer(
  levelId: string,
  name: string,
  url: string,
  tiled: boolean,
  restoreState?: RestoreState | null,
) {
  currentViewerLevelId = levelId;
  syncViewerControls();
  vTitle.textContent = name;

  let savedZoom: number | null = null,
    savedPanX: number | null = null,
    savedPanY: number | null = null;
  if (restoreState && typeof restoreState === "object") {
    savedZoom = restoreState.zoom;
    savedPanX = restoreState.panX;
    savedPanY = restoreState.panY;
  }

  if (tiled) {
    viewerMode = "tiled";
    vImg.style.display = "none";
    vIframe.style.display = "block";
    vIframe.src = url;
    vHud.innerHTML =
      '<div class="coord-line">Tiled render — zoom controls inside viewer</div><div class="copy-hint">Coordinates not available for tiled renders</div>';
    zoomControls.forEach((el) => {
      if (el) el.style.display = "none";
    });
    vp.style.cursor = "default";
  } else {
    viewerMode = "image";
    vIframe.style.display = "none";
    vIframe.src = "";
    vImg.style.display = "block";
    vImg.src = url;
    vImg.onload = () => {
      vImageOffsetX = 0;
      vImageOffsetY = 0;
      viewerFit();
      if (savedZoom !== null && !Number.isNaN(savedZoom) && !Number.isNaN(savedPanX!) && !Number.isNaN(savedPanY!)) {
        vZoom = savedZoom;
        vPanX = savedPanX!;
        vPanY = savedPanY!;
        applyViewerTransform();
      }
      updateViewerHud();
    };
    zoomControls.forEach((el) => {
      if (el) el.style.display = "";
    });
    vp.style.cursor = "grab";
  }
  overlay.classList.add("visible");
}

// Wire up event listeners
export function initViewer() {
  viewerRefreshBtn.addEventListener("click", refreshViewer);

  viewerScale.addEventListener("change", saveViewerStateToURL);
  viewerShowEditor.addEventListener("change", saveViewerStateToURL);
  for (const cb of viewerFloorCheckboxes) cb.addEventListener("change", saveViewerStateToURL);

  document.getElementById("viewer-close")!.addEventListener("click", () => {
    overlay.classList.remove("visible");
    vIframe.src = "";
  });
  document.getElementById("viewer-fit")!.addEventListener("click", viewerFit);
  document.getElementById("viewer-reset")!.addEventListener("click", () => {
    vZoom = 1;
    vPanX = 0;
    vPanY = 0;
    applyViewerTransform();
  });
  document.getElementById("viewer-zin")!.addEventListener("click", () => viewerZoomCenter(1.25));
  document.getElementById("viewer-zout")!.addEventListener("click", () => viewerZoomCenter(1 / 1.25));

  vp.addEventListener(
    "wheel",
    (e) => {
      if (viewerMode !== "image") return;
      e.preventDefault();
      const rect = vp.getBoundingClientRect();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      viewerZoomAt(e.clientX - rect.left, e.clientY - rect.top, zoomFactor);
    },
    { passive: false },
  );

  let vDragging = false,
    vDx = 0,
    vDy = 0,
    vPx = 0,
    vPy = 0;
  vp.addEventListener("mousedown", (e) => {
    if (viewerMode !== "image") return;
    if (e.button !== 0) return;
    vDragging = true;
    vDx = e.clientX;
    vDy = e.clientY;
    vPx = vPanX;
    vPy = vPanY;
    vp.classList.add("dragging");
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e) => {
    if (vDragging) {
      vPanX = vPx + (e.clientX - vDx);
      vPanY = vPy + (e.clientY - vDy);
      applyViewerTransform();
    }
  });
  vp.addEventListener("mousemove", (e) => {
    if (viewerMode !== "image") return;
    const rect = vp.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const world = screenToWorld(screenX, screenY);
    vMouseX = world.x;
    vMouseY = world.y;
    updateViewerHud();
  });
  window.addEventListener("mouseup", () => {
    vDragging = false;
    vp.classList.remove("dragging");
  });

  window.addEventListener("keydown", (e) => {
    if (!overlay.classList.contains("visible")) return;
    if (e.key === "Escape") {
      overlay.classList.remove("visible");
      e.preventDefault();
    }
    if (e.key === "+" || e.key === "=") {
      viewerZoomCenter(1.25);
      e.preventDefault();
    }
    if (e.key === "-") {
      viewerZoomCenter(1 / 1.25);
      e.preventDefault();
    }
    if (e.key === "f" || e.key === "F") {
      viewerFit();
      e.preventDefault();
    }
    if (e.key === "0") {
      vZoom = 1;
      vPanX = 0;
      vPanY = 0;
      applyViewerTransform();
      e.preventDefault();
    }
  });
}
