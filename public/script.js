/* =========================
   script.js (FIXED)
   - Character sheet UI
   - GM Gallery + Show & Tell
   - Pan/zoom viewport
   - Per-user drawing canvas (sync on pointerup)
   ========================= */

let gmUnsubscribe = null;

// --- Session helpers ---
function getActiveSessionId() {
  return (localStorage.getItem("currentSessionId") || "").trim();
}
function requireSessionId() {
  const id = getActiveSessionId();
  if (!id) console.warn("❌ Missing currentSessionId in localStorage; refusing Firestore .doc() call.");
  return id;
}

// --- Pan/zoom state ---
let zoomLevel = parseFloat(localStorage.getItem("zoomLevel")) || 1;
let panX = parseFloat(localStorage.getItem("panX")) || 0;
let panY = parseFloat(localStorage.getItem("panY")) || 0;

let isPanning = false;
let startX = 0;
let startY = 0;

// Track whether we've fit-to-view for a given url
let _lastFitUrl = null;

// =========================
// Drawing (per-user layers)
// =========================

// ✅ IMPORTANT: drawing is OFF by default (so pan works)
let drawingEnabled = false;
let drawTool = "pen"; // "pen" | "eraser"
let drawColor = "#ff0000";
let drawWidth = 4;

let isDrawing = false;
let lastPt = null;

let drawCanvas = null;
let drawCtx = null;

let myLayerCanvas = null;
let myLayerCtx = null;

let userLayers = {}; // uid -> offscreen canvas
let drawingsUnsub = null;

let _panZoomBound = false;
let _drawingBound = false;

// Helpers to locate canvas even if ID changes later
function getDrawingCanvasEl() {
  return document.getElementById("drawing-canvas") || document.getElementById("draw-canvas");
}

function setDrawingEnabled(enabled, tool = null) {
  drawingEnabled = !!enabled;
  if (tool) drawTool = tool;

  const area = document.getElementById("image-display-area");
  if (area) {
    area.classList.toggle("draw-active", drawingEnabled);
    area.style.cursor = drawingEnabled ? "crosshair" : "grab";
  }

  // If turning off drawing mid-stroke, end cleanly
  if (!drawingEnabled && isDrawing) {
    endStrokeAndSync();
  }

  // Button active styling (optional)
  const penBtn = document.getElementById("tool-pen");
  const eraserBtn = document.getElementById("tool-eraser");
  if (penBtn) penBtn.classList.toggle("active", drawingEnabled && drawTool === "pen");
  if (eraserBtn) eraserBtn.classList.toggle("active", drawingEnabled && drawTool === "eraser");
}

function togglePen() {
  // If already drawing with pen, toggle OFF
  if (drawingEnabled && drawTool === "pen") setDrawingEnabled(false);
  else setDrawingEnabled(true, "pen");
}
function toggleEraser() {
  // If already drawing with eraser, toggle OFF
  if (drawingEnabled && drawTool === "eraser") setDrawingEnabled(false);
  else setDrawingEnabled(true, "eraser");
}

// =========================
// Character Sheet Builders
// =========================

function createSkillInput(value = "", levels = [true, false, false, false]) {
  const container = document.createElement("div");
  container.className = "input-wrapper";

  const checkboxes = document.createElement("div");
  checkboxes.className = "skill-levels";

  const anyChecked = levels.includes(true);

  for (let i = 1; i <= 4; i++) {
    const label = document.createElement("label");
    label.className = "level-label";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "skill-level";
    checkbox.dataset.level = i;
    checkbox.checked = anyChecked ? levels[i - 1] : i === 1;

    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        const all = checkboxes.querySelectorAll(".skill-level");
        all.forEach(cb => { if (cb !== checkbox) cb.checked = false; });
      }
    });

    label.appendChild(checkbox);
    label.appendChild(document.createTextNode((i + 1) + "🎲"));
    checkboxes.appendChild(label);
  }

  const input = document.createElement("input");
  input.type = "text";
  input.className = "skill-input";
  input.placeholder = "New skill...";
  input.value = value;
  input.maxLength = 20;

  const rollButton = document.createElement("button");
  rollButton.type = "button";
  rollButton.textContent = "🎲";
  rollButton.style.marginTop = "4px";
  rollButton.onclick = () => {
    const skillName = input.value.trim() || "Unnamed Skill";
    const allChecks = checkboxes.querySelectorAll(".skill-level");
    let diceCount = 0;
    allChecks.forEach((cb, idx) => { if (cb.checked) diceCount = idx + 2; });

    if (diceCount === 0) return alert("No dice level selected.");

    const rolls = Array.from({ length: diceCount }, () => Math.floor(Math.random() * 6) + 1);
    const total = rolls.reduce((a, b) => a + b, 0);
    const characterName = document.getElementById("player-name")?.value || "Unknown";

    const sessionId = getActiveSessionId();
    const user = firebase.auth().currentUser;

    if (!sessionId || !user) return alert("You must be logged in and in a session.");

    db.collection("users").doc(user.uid).get().then(doc => {
      const color = doc.data()?.displayNameColor || "#ffffff";
      return db.collection("sessions").doc(sessionId).collection("chat").add({
        characterName,
        text: `${characterName}: ${skillName}: [${rolls.join(", ")}] = ${total}`,
        color,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
  };

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.textContent = "✕";
  deleteButton.className = "delete-button";
  deleteButton.onclick = () => container.remove();

  container.appendChild(checkboxes);
  container.appendChild(input);
  container.appendChild(rollButton);
  container.appendChild(deleteButton);
  return container;
}

function addSkill(value = "", levels = [true, false, false, false]) {
  if (typeof value === "object") {
    levels = value.levels || [true, false, false, false];
    value = value.name || "";
  }
  const container = document.getElementById("skills-container");
  if (!container) return;
  container.appendChild(createSkillInput(value, levels));
}

function createItemInput(value = "") {
  const div = document.createElement("div");
  div.className = "input-wrapper";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "item-input";
  input.placeholder = "Enter item";
  input.maxLength = 30;
  input.value = value;

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.textContent = "✕";
  deleteButton.className = "delete-button";
  deleteButton.onclick = () => div.remove();

  div.appendChild(input);
  div.appendChild(deleteButton);
  return div;
}

function addItem(value = "") {
  const container = document.getElementById("items-container");
  if (!container) return;
  container.appendChild(createItemInput(value));
}

function addCondition(value = "") {
  const container = document.getElementById("conditions-container");
  if (!container) return;

  const div = document.createElement("div");
  div.className = "input-wrapper";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "condition-input";
  input.placeholder = "Enter condition";
  input.maxLength = 20;
  input.value = typeof value === "object" ? (value.name || "") : value;

  const delButton = document.createElement("button");
  delButton.className = "delete-button";
  delButton.textContent = "✕";
  delButton.type = "button";
  delButton.onclick = () => div.remove();

  div.appendChild(input);
  div.appendChild(delButton);
  container.appendChild(div);
}

// =========================
// Basic sheet actions
// =========================

function adjustExp(amount) {
  const expSpan = document.getElementById("exp-value");
  if (!expSpan) return;
  let current = parseInt(expSpan.textContent || "0", 10);
  current = Math.max(0, current + amount);
  expSpan.textContent = current;
  if (typeof window.silentAutoSaveCharacter === "function") window.silentAutoSaveCharacter();
}

function adjustLuck(amount) {
  const luckSpan = document.getElementById("luck-value");
  if (!luckSpan) return;
  let current = parseInt(luckSpan.textContent || "0", 10);
  current = Math.max(0, current + amount);
  luckSpan.textContent = current;
  if (typeof window.silentAutoSaveCharacter === "function") window.silentAutoSaveCharacter();
}

function toggleWound(index) {
  const woundButtons = document.querySelectorAll(".wounds button");
  const btn = woundButtons[index];
  if (btn) btn.classList.toggle("active");
}

function clearData() {
  localStorage.removeItem("rfrbCharacter");
  const form = document.getElementById("char-form");
  if (form) form.reset();

  const exp = document.getElementById("exp-value");
  const luck = document.getElementById("luck-value");
  if (exp) exp.textContent = "0";
  if (luck) luck.textContent = "1";

  document.querySelectorAll(".wounds button").forEach(btn => btn.classList.remove("active"));

  const skills = document.getElementById("skills-container");
  const items = document.getElementById("items-container");
  const conditions = document.getElementById("conditions-container");

  if (skills) { skills.innerHTML = ""; addSkill("Do anything"); }
  if (items) { items.innerHTML = ""; addItem(); }
  if (conditions) conditions.innerHTML = "";

  alert("Character cleared.");
}

// =========================
// Rules + Theme
// =========================

function setTheme(theme) {
  const link = document.getElementById("theme-stylesheet");
  if (!link) return;

  const map = {
    default: "style-default.css",
    dark: "style-dark.css",
    forest: "style-forest.css",
    ocean: "style-ocean.css",
    sky: "style-sky.css",
    lava: "style-lava.css",
  };

  link.href = map[theme] || map.default;
}


// =========================
// Show & Tell + Pan/Zoom
// =========================

function applyTransform() {
  const layer = document.getElementById("panzoom-layer");
  if (!layer) return;
  layer.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
}

function fitImageToViewportIfNeeded(imageUrl) {
  if (!imageUrl) return;
  if (_lastFitUrl === imageUrl) return;

  const area = document.getElementById("image-display-area");
  const img = document.getElementById("tab-image");
  if (!area || !img || !img.naturalWidth || !img.naturalHeight) return;

  const rect = area.getBoundingClientRect();

  // ✅ If panel is hidden / not laid out yet, don't fit now.
  if (rect.width < 5 || rect.height < 5) {
    return; // IMPORTANT: do NOT set _lastFitUrl
  }

  const scaleX = rect.width / img.naturalWidth;
  const scaleY = rect.height / img.naturalHeight;

  zoomLevel = Math.min(scaleX, scaleY);
  panX = (rect.width - img.naturalWidth * zoomLevel) / 2;
  panY = (rect.height - img.naturalHeight * zoomLevel) / 2;

  _lastFitUrl = imageUrl;

  applyTransform();
  setupDrawingCanvasToImage();
  redrawAllLayers();
}


function toggleShowAndTell() {
  const characterPanel = document.getElementById("character-panel");
  const main = document.getElementById("main-container");
  const show = document.getElementById("show-panel");

  if (characterPanel) characterPanel.style.display = "none";
  if (main) main.style.display = "none";
  if (show) show.style.display = "block";

  const img = document.getElementById("tab-image");
  if (img && img.src) {
    requestAnimationFrame(() => {
      fitImageToViewportIfNeeded(img.src);
      setupDrawingCanvasToImage();
      redrawAllLayers();

      // ✅ IMPORTANT: now that canvas is real size, resubscribe so initial drawings apply
      startDrawingsListener();
    });
  }
}



function toggleCharacterPanel() {
  const characterPanel = document.getElementById("character-panel");
  const main = document.getElementById("main-container");
  const show = document.getElementById("show-panel");

  if (characterPanel) characterPanel.style.display = "block";
  if (main) main.style.display = "block";
  if (show) show.style.display = "none";
}

// ✅ Pan/zoom event binding (works everywhere when drawing is OFF)
function setupPanZoom() {
  if (_panZoomBound) return;
  _panZoomBound = true;

  const area = document.getElementById("image-display-area");
  if (!area) return;

  area.style.cursor = "grab";

  const stopPanning = () => {
    if (!isPanning) return;
    isPanning = false;
    area.style.cursor = drawingEnabled ? "crosshair" : "grab";

    localStorage.setItem("zoomLevel", zoomLevel);
    localStorage.setItem("panX", panX);
    localStorage.setItem("panY", panY);
  };

  // Wheel zoom
  area.addEventListener("wheel", (e) => {
    if (drawingEnabled || isDrawing) return;

    e.preventDefault();
    e.stopPropagation();

    const rect = area.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const zoomFactor = 0.12;
    const scaleChange = e.deltaY < 0 ? (1 + zoomFactor) : (1 - zoomFactor);
    const newZoom = Math.min(Math.max(zoomLevel * scaleChange, 0.1), 6);

    const worldX = (mouseX - panX) / zoomLevel;
    const worldY = (mouseY - panY) / zoomLevel;

    zoomLevel = newZoom;
    panX = mouseX - worldX * zoomLevel;
    panY = mouseY - worldY * zoomLevel;

    applyTransform();

    localStorage.setItem("zoomLevel", zoomLevel);
    localStorage.setItem("panX", panX);
    localStorage.setItem("panY", panY);
  }, { passive: false });

  // Start pan
  area.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (drawingEnabled) return; // ✅ if in draw mode, don’t pan

    e.preventDefault();
    isPanning = true;
    startX = e.clientX - panX;
    startY = e.clientY - panY;
    area.style.cursor = "grabbing";
  });

  document.addEventListener("mousemove", (e) => {
    if (!isPanning) return;
    panX = e.clientX - startX;
    panY = e.clientY - startY;
    applyTransform();
  });

  document.addEventListener("mouseup", stopPanning);
  window.addEventListener("blur", stopPanning);
  document.addEventListener("mouseleave", stopPanning);
}

// Tabs
let currentTabId = null;

function renderTabs(tabs, activeTabId) {
  const tabBar = document.getElementById("tab-bar");
  if (!tabBar) return;
  tabBar.innerHTML = "";

  tabs.forEach(tab => {
    const btn = document.createElement("button");
    btn.textContent = tab.title;
    btn.classList.add("tab-button");
    if (tab.id === activeTabId) btn.classList.add("active");

    btn.addEventListener("click", () => {
      currentTabId = tab.id;
      showTabImage(tab.imageUrl);
      renderTabs(tabs, tab.id);
    });

    tabBar.appendChild(btn);
  });
}

function showTabImage(url) {
  const img = document.getElementById("tab-image");
  if (!img) return console.warn("⚠️ #tab-image missing.");

  // Clear
  if (!url) {
    img.onload = null;
    img.src = "";
    _lastFitUrl = null;
    setupDrawingCanvasToImage();
    redrawAllLayers();
    return;
  }

  const afterLoad = async () => {
    // Fit + align canvas + start drawing sync
    fitImageToViewportIfNeeded(url);
    startDrawingsListener();
  };

  // IMPORTANT: set handler before src
  img.onload = () => { afterLoad(); };

  img.src = url;

  // Cached-image fallback (load may have already happened)
  if (img.complete && img.naturalWidth) {
    // Defer one tick so layout exists
    requestAnimationFrame(() => afterLoad());
  } else if (img.decode) {
    // Another reliable fallback in modern browsers
    img.decode().then(() => afterLoad()).catch(() => {});
  }
}

// Display push
function pushToDisplayArea(imageUrl, updateFirestore = true) {
  const img = document.getElementById("tab-image");
  if (!img) {
    console.warn("⚠️ tab-image not found.");
    return;
  }

  // Clear
  if (!imageUrl) {
    img.onload = null;
    img.src = "";
    _lastFitUrl = null;
    setupDrawingCanvasToImage();
    redrawAllLayers();
    localStorage.setItem("gmDisplayImage", "");
  } else {
    const afterLoad = async () => {
      fitImageToViewportIfNeeded(imageUrl);
      startDrawingsListener();
    };

    img.onload = () => { afterLoad(); }; // handler first
    img.src = imageUrl;

    // Cached-image fallback
    if (img.complete && img.naturalWidth) {
      requestAnimationFrame(() => afterLoad());
    } else if (img.decode) {
      img.decode().then(() => afterLoad()).catch(() => {});
    }

    localStorage.setItem("gmDisplayImage", imageUrl);
  }

  // Firestore write
  if (updateFirestore) {
    const sessionId = getActiveSessionId();
    if (sessionId) {
      db.collection("sessions").doc(sessionId).update({
        currentDisplayImage: imageUrl || "",
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
  }
}


function createNewTab(name, imageUrl, updateFirestore = true) {
  const tabBar = document.getElementById("tab-bar");
  if (!tabBar) return;

  const button = document.createElement("button");
  button.textContent = name;
  button.classList.add("tab-button");
  button.onclick = () => showTabImage(imageUrl);
  tabBar.appendChild(button);

  showTabImage(imageUrl);

  if (updateFirestore) {
    const sessionId = getActiveSessionId();
    if (sessionId) {
      const tabRef = db.collection("sessions").doc(sessionId).collection("tabs").doc(name);
      tabRef.set({ imageUrl });

      db.collection("sessions").doc(sessionId).update({
        tabOrder: firebase.firestore.FieldValue.arrayUnion(name),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
  }
}

// =========================
// Drawing implementation
// =========================

function setupDrawingCanvasToImage() {
  const img = document.getElementById("tab-image");
  const canvas = getDrawingCanvasEl();
  if (!img || !canvas) return;

  // If no image loaded, keep tiny
  if (!img.naturalWidth || !img.naturalHeight) {
    if (canvas.width !== 1 || canvas.height !== 1) {
      canvas.width = 1;
      canvas.height = 1;
    }
    drawCanvas = canvas;
    drawCtx = canvas.getContext("2d");
    return;
  }

  const targetW = img.naturalWidth;
  const targetH = img.naturalHeight;

  // ✅ Only resize display canvas if needed (resizing clears it)
  const displayNeedsResize = canvas.width !== targetW || canvas.height !== targetH;
  if (displayNeedsResize) {
    canvas.width = targetW;
    canvas.height = targetH;
    canvas.style.width = targetW + "px";
    canvas.style.height = targetH + "px";
  } else {
    // keep CSS sizing correct in case
    canvas.style.width = targetW + "px";
    canvas.style.height = targetH + "px";
  }

  drawCanvas = canvas;
  drawCtx = canvas.getContext("2d");

  if (!myLayerCanvas) {
    myLayerCanvas = document.createElement("canvas");
    myLayerCtx = myLayerCanvas.getContext("2d");
  }

  // ✅ Only resize my layer if needed; preserve content if it changes
  const myNeedsResize = myLayerCanvas.width !== targetW || myLayerCanvas.height !== targetH;
  if (myNeedsResize) {
    // preserve existing drawing
    const old = document.createElement("canvas");
    old.width = myLayerCanvas.width;
    old.height = myLayerCanvas.height;
    old.getContext("2d").drawImage(myLayerCanvas, 0, 0);

    myLayerCanvas.width = targetW;
    myLayerCanvas.height = targetH;

    // draw old content back, scaled (usually same size anyway)
    myLayerCtx.clearRect(0, 0, targetW, targetH);
    myLayerCtx.drawImage(old, 0, 0, targetW, targetH);
  }

  // ✅ Always keep my layer registered so compositor never “forgets me”
  const me = auth?.currentUser?.uid;
  if (me) userLayers[me] = myLayerCanvas;

  // If display canvas resized, redraw composite so it doesn't look blank
  if (displayNeedsResize) {
    redrawAllLayers();
  }
}

function getDrawPointFromEvent(e) {
  const area = document.getElementById("image-display-area");
  if (!area) return null;

  const rect = area.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  // Convert viewport -> image pixels (inverse of translate+scale)
  const x = (mouseX - panX) / zoomLevel;
  const y = (mouseY - panY) / zoomLevel;

  return { x, y };
}

function strokeTo(ctx, a, b) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = drawWidth;

  if (drawTool === "eraser") {
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = "rgba(0,0,0,1)";
  } else {
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = drawColor;
  }

  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function redrawAllLayers() {
  if (!drawCtx || !drawCanvas) return;
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);

  const uids = Object.keys(userLayers).sort();
  for (const uid of uids) {
    const layer = userLayers[uid];
    if (layer) drawCtx.drawImage(layer, 0, 0);
  }
}

function saveMyDrawingToFirestore() {
  const sessionId = getActiveSessionId();
  const user = auth?.currentUser;
  if (!sessionId || !user || !myLayerCanvas) return;

  const dataUrl = myLayerCanvas.toDataURL("image/png");
  return db.collection("sessions")
    .doc(sessionId)
    .collection("drawings")
    .doc(user.uid)
    .set({
      imageData: dataUrl,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
}

function startDrawingsListener() {
  const sessionId = getActiveSessionId();
  if (!sessionId) return;

  if (drawingsUnsub) drawingsUnsub();

  drawingsUnsub = db.collection("sessions")
    .doc(sessionId)
    .collection("drawings")
    .onSnapshot((snap) => {
      snap.docChanges().forEach((ch) => {
        const uid = ch.doc.id;

        if (ch.type === "removed") {
          delete userLayers[uid];
          // always keep mine present
          const me = auth?.currentUser?.uid;
          if (me && myLayerCanvas) userLayers[me] = myLayerCanvas;
          redrawAllLayers();
          return;
        }

        const data = ch.doc.data();
        const imageData = data?.imageData;
        if (!imageData) return;

        // If canvas isn't ready (no image yet), skip
        if (!drawCanvas || drawCanvas.width <= 1) return;

        const img = new Image();
        img.onload = () => {
          const me = auth?.currentUser?.uid;

          // ✅ If this doc is ME, draw into myLayerCanvas directly (never replace it)
        if (me && uid === me && myLayerCtx && myLayerCanvas) {
           // ✅ force normal drawing mode before repainting from snapshot
           myLayerCtx.globalCompositeOperation = "source-over";
         
           myLayerCtx.clearRect(0, 0, myLayerCanvas.width, myLayerCanvas.height);
           myLayerCtx.drawImage(img, 0, 0, myLayerCanvas.width, myLayerCanvas.height);
           userLayers[me] = myLayerCanvas;
           redrawAllLayers();
           return;
         }

          // Other users: store in offscreen canvas
          const c = document.createElement("canvas");
          c.width = drawCanvas.width;
          c.height = drawCanvas.height;
          const cctx = c.getContext("2d");
          cctx.drawImage(img, 0, 0, c.width, c.height);
          userLayers[uid] = c;

          // keep mine present
          if (me && myLayerCanvas) userLayers[me] = myLayerCanvas;

          redrawAllLayers();
        };
        img.src = imageData;
      });

      // Also, if nothing changed but we need to ensure mine exists:
      const me = auth?.currentUser?.uid;
      if (me && myLayerCanvas) userLayers[me] = myLayerCanvas;
      redrawAllLayers();
    });
}

// Stroke ending helper (used by toggles too)
function endStrokeAndSync() {
  if (!isDrawing) return;
  isDrawing = false;
  lastPt = null;
    
   if (myLayerCtx) myLayerCtx.globalCompositeOperation = "source-over";
  // ensure my layer is registered before saving
  const me = auth?.currentUser?.uid;
  if (me && myLayerCanvas) userLayers[me] = myLayerCanvas;

  redrawAllLayers();
  saveMyDrawingToFirestore();
}

function setupDrawingEvents() {
  if (_drawingBound) return;
  _drawingBound = true;

  const canvas = getDrawingCanvasEl();
  if (!canvas) {
    console.warn("⚠️ No drawing canvas found. Drawing disabled.");
    return;
  }

  // Prevent browser dragging/selection behavior
   canvas.addEventListener("dragstart", (e) => e.preventDefault());
   window.addEventListener("blur", endStrokeAndSync);
   document.addEventListener("mouseup", endStrokeAndSync);


  canvas.addEventListener("pointerdown", (e) => {
    if (!drawingEnabled) return;
    if (!auth?.currentUser) return;

    if (e.pointerType === "mouse" && e.button !== 0) return;

    e.preventDefault();
    e.stopPropagation();

    setupDrawingCanvasToImage();

    isDrawing = true;
    canvas.setPointerCapture(e.pointerId);
    lastPt = getDrawPointFromEvent(e);

    // ✅ ensure my layer is registered even if no move happens
    const me = auth?.currentUser?.uid;
    if (me && myLayerCanvas) userLayers[me] = myLayerCanvas;
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!isDrawing || !lastPt) return;

    e.preventDefault();
    e.stopPropagation();

    const pt = getDrawPointFromEvent(e);
    if (!pt || !myLayerCtx) return;

    strokeTo(myLayerCtx, lastPt, pt);
    lastPt = pt;

    const me = auth?.currentUser?.uid;
    if (me && myLayerCanvas) userLayers[me] = myLayerCanvas;

    redrawAllLayers();
  });

canvas.addEventListener("pointerup", (e) => {
  if (!isDrawing) return;
  e.preventDefault();
  e.stopPropagation();

  try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}

  endStrokeAndSync();
});

canvas.addEventListener("pointercancel", (e) => {
  if (!isDrawing) return;
  try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
  endStrokeAndSync();
});
}

function setupDrawingToolbar() {
  const widthEl = document.getElementById("draw-width");
  const colorEl = document.getElementById("draw-color");
  const penBtn = document.getElementById("tool-pen");
  const eraserBtn = document.getElementById("tool-eraser");
  const clearMineBtn = document.getElementById("clear-mine");
  const clearAllBtn = document.getElementById("clear-all");

  if (widthEl) {
    drawWidth = parseInt(widthEl.value, 10) || drawWidth;
    widthEl.addEventListener("input", () => {
      drawWidth = parseInt(widthEl.value, 10) || 4;
    });
  }

  if (colorEl) {
    drawColor = colorEl.value || drawColor;
    colorEl.addEventListener("input", () => {
      drawColor = colorEl.value || "#ff0000";
    });
  }

  // ✅ TOGGLE behavior (not "always on")
  if (penBtn) penBtn.addEventListener("click", togglePen);
  if (eraserBtn) eraserBtn.addEventListener("click", toggleEraser);

  if (clearMineBtn) {
    clearMineBtn.addEventListener("click", async () => {
      const user = auth?.currentUser;
      const sessionId = getActiveSessionId();
      if (!user || !sessionId || !myLayerCtx || !myLayerCanvas) return;

      myLayerCtx.clearRect(0, 0, myLayerCanvas.width, myLayerCanvas.height);
      userLayers[user.uid] = myLayerCanvas;
      redrawAllLayers();

      await db.collection("sessions").doc(sessionId).collection("drawings").doc(user.uid).delete();
    });
  }

  if (clearAllBtn) {
    const role = window.currentUserRole;
    clearAllBtn.style.display = (role === "gm") ? "inline-block" : "none";

    clearAllBtn.addEventListener("click", async () => {
      if (window.currentUserRole !== "gm") return;
      const sessionId = getActiveSessionId();
      if (!sessionId) return;
      if (!confirm("Clear ALL drawings for everyone?")) return;

      const snap = await db.collection("sessions").doc(sessionId).collection("drawings").get();
      const batch = db.batch();
      snap.forEach(doc => batch.delete(doc.ref));
      await batch.commit();

      userLayers = {};
      const me = auth?.currentUser?.uid;
      if (me && myLayerCanvas) userLayers[me] = myLayerCanvas;
      redrawAllLayers();
    });
  }

  // ✅ ensure canvas input matches CSS expectation
  setDrawingEnabled(false);
}

// =========================
// GM Tools + Gallery
// =========================

function toggleGMTools() {
  const panel = document.getElementById("gm-tools-panel");
  if (!panel) return;
  panel.style.display = (panel.style.display === "none" || !panel.style.display) ? "block" : "none";
}

function openGMTools() {
  const panel = document.getElementById("gm-tools-panel");
  if (panel) panel.style.display = "block";
}

function openGMImageModal() {
  const modal = document.getElementById("gm-image-gallery-modal");
  if (!modal) return;
  modal.style.display = "flex";
  loadGMImages();
}

function closeGMImageModal() {
  const modal = document.getElementById("gm-image-gallery-modal");
  if (modal) modal.style.display = "none";
}

function uploadGMImage() {
  const fileInput = document.getElementById("gm-image-upload");
  const status = document.getElementById("upload-status");
  const file = fileInput?.files?.[0];

  if (!file) {
    if (status) status.textContent = "Please select a file first.";
    return;
  }

  const user = firebase.auth().currentUser;
  const sessionId = getActiveSessionId();

  if (!user || !sessionId) {
    if (status) status.textContent = "User or session not found.";
    return;
  }

  const storageRef = firebase.storage().ref(`sessions/${sessionId}/gmimages/${file.name}`);
  const uploadTask = storageRef.put(file);

  if (status) status.textContent = "Uploading...";

  uploadTask.on("state_changed",
    null,
    (error) => {
      console.error("Upload failed:", error);
      if (status) status.textContent = "Upload failed.";
    },
    () => {
      uploadTask.snapshot.ref.getDownloadURL().then((downloadURL) => {
        if (status) status.textContent = "✅ Upload complete!";
        const folder = document.getElementById("gm-folder-input")?.value?.trim() || "Unsorted";

        return firebase.firestore()
          .collection("sessions")
          .doc(sessionId)
          .collection("gmimages")
          .add({
            name: file.name,
            url: downloadURL,
            folder,
            uploadedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
      }).then(() => loadGMImages());
    }
  );
}

function loadGMImages() {
  const gallery = document.getElementById("image-list");
  if (!gallery) return;

  gallery.innerHTML = "<p>Loading...</p>";
  const sessionId = getActiveSessionId();
  if (!sessionId) return (gallery.innerHTML = "<p>No session.</p>");

  db.collection("sessions").doc(sessionId).collection("gmimages").get().then(snapshot => {
    const folderMap = {};
    snapshot.forEach(doc => {
      const data = doc.data();
      const folder = data.folder || "Unsorted";
      if (!folderMap[folder]) folderMap[folder] = [];
      folderMap[folder].push({ id: doc.id, ...data });
    });

    gallery.innerHTML = "";

    Object.entries(folderMap).forEach(([folderName, images]) => {
      const section = document.createElement("div");

      const header = document.createElement("h3");
      header.style.color = "white";
      header.style.cursor = "pointer";
      header.textContent = `📁 ${folderName}`;

      const content = document.createElement("div");
      content.style.display = "none";
      content.style.marginLeft = "10px";

      header.addEventListener("click", () => {
        content.style.display = (content.style.display === "none") ? "block" : "none";
      });

      images.forEach(({ name, url, id }) => {
        const wrapper = document.createElement("div");
        wrapper.style = "display:flex; flex-direction:column; align-items:center; border:1px solid #555; padding:5px; background:#111; margin-bottom:6px;";

        const img = document.createElement("img");
        img.src = url;
        img.alt = name;
        img.style = "width:100px; height:auto; margin-bottom:5px;";

        const label = document.createElement("div");
        label.textContent = name;
        label.style = "font-size:12px; color:white;";

        const btnGroup = document.createElement("div");
        btnGroup.style = "margin-top:5px; display:flex; gap:5px; flex-wrap:wrap;";

        const toDisplay = document.createElement("button");
        toDisplay.textContent = "display";
        toDisplay.onclick = () => {
          toggleShowAndTell();
          setTimeout(() => pushToDisplayArea(url, true), 50);
        };

        const toChat = document.createElement("button");
        toChat.textContent = "Chat";
        toChat.onclick = () => pushToChat(url, name);

        const deleteBtn = document.createElement("button");
        deleteBtn.textContent = "❌";
        deleteBtn.onclick = () => deleteGMImage(sessionId, id, name, wrapper);

        [toDisplay, toChat, deleteBtn].forEach(btn => {
          btn.style.padding = "2px 6px";
          btn.style.fontSize = "12px";
          btn.style.borderRadius = "4px";
          btn.style.backgroundColor = "#333";
          btn.style.color = "#fff";
          btn.style.border = "1px solid #666";
          btn.style.cursor = "pointer";
        });

        btnGroup.appendChild(toDisplay);
        btnGroup.appendChild(toChat);
        btnGroup.appendChild(deleteBtn);

        wrapper.appendChild(img);
        wrapper.appendChild(label);
        wrapper.appendChild(btnGroup);
        content.appendChild(wrapper);
      });

      section.appendChild(header);
      section.appendChild(content);
      gallery.appendChild(section);
    });
  });
}

function deleteGMImage(sessionId, docId, fileName, wrapper) {
  if (!confirm(`Delete image "${fileName}"?`)) return;

  const storagePath = `sessions/${sessionId}/gmimages/${fileName}`;
  const storageRef = firebase.storage().ref(storagePath);

  storageRef.delete()
    .then(() => db.collection("sessions").doc(sessionId).collection("gmimages").doc(docId).delete())
    .then(() => {
      wrapper.remove();
      alert(`Deleted "${fileName}"`);
    })
    .catch((error) => {
      console.error("❌ Delete failed:", error);
      alert("Failed to delete image.");
    });
}

function cleardisplay() {
  localStorage.removeItem("gmDisplayImage");
  _lastFitUrl = null;

  pushToDisplayArea("", false);

  const tabBar = document.getElementById("tab-bar");
  if (tabBar) tabBar.innerHTML = "";

  const sessionId = getActiveSessionId();
  if (!sessionId) return;

  const tabsRef = db.collection("sessions").doc(sessionId).collection("tabs");
  tabsRef.get().then(snapshot => {
    const batch = db.batch();
    snapshot.forEach(doc => batch.delete(doc.ref));
    return batch.commit();
  }).then(() => {
    return db.collection("sessions").doc(sessionId).update({
      tabOrder: [],
      currentDisplayImage: "",
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  });
}

function clearchat() {
  const sessionId = getActiveSessionId();
  if (!sessionId) return alert("No session selected.");

  const chatRef = db.collection("sessions").doc(sessionId).collection("chat");
  chatRef.get().then(snapshot => {
    const batch = db.batch();
    snapshot.forEach(doc => batch.delete(doc.ref));
    return batch.commit();
  }).then(() => {
    const chatMessages = document.getElementById("chat-messages");
    if (chatMessages) chatMessages.innerHTML = "";
    console.log("Chat cleared.");
  }).catch(err => {
    console.error("Error clearing chat:", err);
    alert("Failed to clear chat.");
  });
}

// =========================
// GM Mode (live character panels)
// =========================

let gmModeActive = false;
let gmPanelUnsubscribes = [];

function toggleGMMode() {
  gmModeActive = !gmModeActive;

  const characterPanel = document.getElementById("character-panel");
  const gmPanel = document.getElementById("gm-mode-panel");
  const gmButton = document.getElementById("gm-mode-toggle");

  if (gmModeActive) {
    if (characterPanel) characterPanel.style.display = "none";
    if (gmPanel) gmPanel.style.display = "block";
    if (gmButton) gmButton.textContent = "Exit GM Mode";
    loadAllGMCharacterPanels();
  } else {
    if (gmPanel) gmPanel.style.display = "none";
    if (characterPanel) characterPanel.style.display = "block";
    if (gmButton) gmButton.textContent = "GM Mode";
  }
}

function loadAllGMCharacterPanels() {
  const sessionId = getActiveSessionId();
  if (!sessionId) return;

  gmPanelUnsubscribes.forEach(unsub => unsub());
  gmPanelUnsubscribes = [];

  const container = document.getElementById("gm-character-panels");
  if (!container) return;
  container.innerHTML = "<p>Loading characters...</p>";

  db.collection("sessions").doc(sessionId).collection("characters").onSnapshot(snapshot => {
    container.innerHTML = "";

    snapshot.forEach(doc => {
      const charId = doc.id;

      const panel = document.createElement("div");
      panel.id = `char-${charId}`;
      panel.style = "min-width:250px; max-width:300px; background:#111; color:white; border:2px solid #555; padding:10px;";

      panel.innerHTML = `<h3>${charId}</h3><p>Loading...</p>`;
      container.appendChild(panel);

      const unsub = db.collection("sessions").doc(sessionId).collection("characters").doc(charId)
        .onSnapshot(docSnap => {
          const data = docSnap.data();
          if (!data) return;

          const wounds = (data.wounds || []).map(active => active ? "❤️" : "🖤").join(" ");
          const skills = (data.skills || []).map(s => {
            const name = typeof s === "string" ? s : s.name;
            const dice = (typeof s === "object" && Array.isArray(s.levels))
              ? s.levels.filter(Boolean).length + 1
              : 2;
            return `• ${name} (${dice}🎲)`;
          }).join("<br>");

          const conditions = (data.conditions || []).map(c => `• ${c.name || c}`).join("<br>");
          const items = (data.items || []).map(i => `• ${i}`).join("<br>");

          panel.innerHTML = `
            <h3>${data.name || charId}</h3>
            <p><strong>EXP:</strong> ${data.exp ?? 0}</p>
            <p><strong>LUCK:</strong> ${data.luck ?? 1}</p>
            <p><strong>WOUNDS:</strong> ${wounds}</p>
            <p><strong>SKILLS:</strong><br>${skills || "."}</p>
            <p><strong>ITEMS:</strong><br>${items || "."}</p>
            <p><strong>CONDITIONS:</strong><br>${conditions || "."}</p>
          `;
        });

      gmPanelUnsubscribes.push(unsub);
    });

    if (snapshot.empty) {
      container.innerHTML = "<p>No characters found.</p>";
    }
  });
}

// =========================
// Chat image push helper (GM gallery)
// =========================

function pushToChat(imageUrl, label) {
  const user = auth.currentUser;
  if (!user) return;

  const sessionId = requireSessionId();
  if (!sessionId) return;

  const characterName = document.getElementById("player-name")?.value || user.email || "Unknown";

  db.collection("users").doc(user.uid).get().then(doc => {
    const color = doc.data()?.displayNameColor || "#ffffff";

    return db.collection("sessions").doc(sessionId).collection("chat").add({
      characterName,
      imageUrl,
      label: label || "",
      color,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
  });
}

async function uploadCharacterPortrait(file) {
  const user = auth?.currentUser;
  const sessionId = getActiveSessionId();
  if (!user || !sessionId || !file) return;

  // Optional: basic file safety
  if (!file.type.startsWith("image/")) {
    alert("Please upload an image file.");
    return;
  }
  if (file.size > 3 * 1024 * 1024) { // 3MB
    alert("Image too large. Please use something under 3MB.");
    return;
  }

  // Storage path: stable per user; overwrite to keep it simple
  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  const path = `sessions/${sessionId}/portraits/${user.uid}.${ext}`;

  const storageRef = firebase.storage().ref(path);
  await storageRef.put(file);

  const url = await storageRef.getDownloadURL();

  // Save on their character doc (recommended: characters/<uid>)
  await db.collection("sessions")
    .doc(sessionId)
    .collection("characters")
    .doc(user.uid)
    .set({ portraitUrl: url }, { merge: true });

  // Update UI immediately
  const img = document.getElementById("character-portrait");
  if (img) img.src = url;
}

function bindPortraitUpload() {
  const input = document.getElementById("portrait-upload");
  if (!input) return;

  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;

    try {
      await uploadCharacterPortrait(file);
    } catch (err) {
      console.error("Portrait upload failed:", err);
      alert("Portrait upload failed. Check console for details.");
    } finally {
      // allow re-uploading the same file
      input.value = "";
    }
  });
}

async function loadMyPortraitFromCharacterDoc() {
  const user = auth?.currentUser;
  const sessionId = getActiveSessionId();
  if (!user || !sessionId) return;

  const BLANK =
    "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";

  const doc = await db.collection("sessions")
    .doc(sessionId)
    .collection("characters")
    .doc(user.uid)
    .get();

  const url = doc.data()?.portraitUrl;

  const img = document.getElementById("character-portrait");
  if (img) {
    img.src = url || BLANK;      // ✅ never broken icon
    img.onerror = () => { img.src = BLANK; };
  }
}

// =========================
// Init
// =========================

// ✅ Called by login.js after session selection (optional but helpful)
function initDrawingSystem(sessionId, role) {
  if (role === "gm") {
    const clearAllBtn = document.getElementById("clear-all");
    if (clearAllBtn) clearAllBtn.style.display = "inline-block";
  }

  bindPortraitUpload();              // ✅ ADD
  loadMyPortraitFromCharacterDoc();  // ✅ ADD

  setupDrawingCanvasToImage();
  startDrawingsListener();
}

function toggleRules() {
  const modal = document.getElementById("rules-modal");
  if (!modal) return;
  modal.style.display = (modal.style.display === "block") ? "none" : "block";
}


function initScript() {
  // Ensure starter fields exist (only if empty)
  if (document.getElementById("skills-container")?.children.length === 0) addSkill("Do anything");
  if (document.getElementById("items-container")?.children.length === 0) addItem();
  if (document.getElementById("conditions-container")?.children.length === 0) addCondition();

  // Restore display image only if session is set
  const sid = getActiveSessionId();
  if (sid) {
    db.collection("sessions").doc(sid).get().then(doc => {
      const url = doc.data()?.currentDisplayImage;
      if (url) pushToDisplayArea(url, false);
    }).catch(() => {});
  }

  // Pan/zoom bindings
  setupPanZoom();

  // Drawing setup
  setupDrawingCanvasToImage();
  setupDrawingEvents();
  setupDrawingToolbar();
  startDrawingsListener();

  // GM upload filename label
  const gmUpload = document.getElementById("gm-image-upload");
  if (gmUpload) {
    gmUpload.addEventListener("change", function () {
      const filenameSpan = document.getElementById("gm-upload-filename");
      if (filenameSpan) filenameSpan.textContent = (this.files && this.files.length > 0) ? this.files[0].name : "";
    });
  }

  // Chat enter-to-send (sendChatMessage lives in login.js)
  const chatInput = document.getElementById("chatInput");
  if (chatInput) {
    chatInput.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (typeof window.sendChatMessage === "function") window.sendChatMessage();
      }
    });
  }

  console.log("✅ Script loaded.");
}

document.addEventListener("DOMContentLoaded", initScript);

// Expose functions used by inline HTML onclicks
window.addSkill = addSkill;
window.addItem = addItem;
window.addCondition = addCondition;

window.adjustExp = adjustExp;
window.adjustLuck = adjustLuck;
window.toggleWound = toggleWound;
window.clearData = clearData;

window.toggleRules = toggleRules;
window.setTheme = setTheme;

window.toggleShowAndTell = toggleShowAndTell;
window.toggleCharacterPanel = toggleCharacterPanel;

window.toggleGMTools = toggleGMTools;
window.openGMTools = openGMTools;
window.openGMImageModal = openGMImageModal;
window.closeGMImageModal = closeGMImageModal;

window.uploadGMImage = uploadGMImage;
window.loadGMImages = loadGMImages;
window.deleteGMImage = deleteGMImage;

window.pushToDisplayArea = pushToDisplayArea;
window.createNewTab = createNewTab;
window.cleardisplay = cleardisplay;
window.clearchat = clearchat;

window.toggleGMMode = toggleGMMode;

// ✅ used by login.js
window.initDrawingSystem = initDrawingSystem;

// Optional debug handles
window.applyTransform = applyTransform;
window.startDrawingsListener = startDrawingsListener;
window.setDrawingEnabled = setDrawingEnabled;

