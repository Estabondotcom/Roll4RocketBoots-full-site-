/* =========================================================================
   Roll 4 Rocket Boots - script.js (rewritten)
   Goals:
   - Character sheet UI always responds
   - Pan/zoom stays smooth
   - Drawing stays aligned and syncs only on pointerup
   - Reload-safe deterministic reconstruction
   - Avoid "dead buttons" due to scope / module / inline onclick
   ========================================================================= */

/* global firebase, db, auth */

/* -----------------------------
   Global-ish shared state
----------------------------- */
let zoomLevel = parseFloat(localStorage.getItem("zoomLevel")) || 1;
let panX = parseFloat(localStorage.getItem("panX")) || 0;
let panY = parseFloat(localStorage.getItem("panY")) || 0;

let isPanning = false;
let startX = 0;
let startY = 0;

let latestDisplayImage = null; // optional - if you set it elsewhere
let currentTabId = null;

let currentTool = null; // 'pen' | 'erase' | null
let penColor = "#ff0000";
let drawing = false;

let offscreenCanvas = null; // used only for compositing / sizing reference
let offscreenCtx = null;

let userCanvases = {}; // uid => HTMLCanvasElement
let drawingsUnsub = null;

let gmModeActive = false;
let gmPanelUnsubscribes = [];

/* -----------------------------
   Element lookup helpers
----------------------------- */
const EL = {
  zoomContainer: () => document.getElementById("zoom-container"),
  zoomContent: () => document.getElementById("zoom-content"),
  tabImage: () => document.getElementById("tab-image"),
  drawingCanvas: () => document.getElementById("drawing-canvas"),

  characterPanel: () => document.getElementById("character-panel"),
  mainContainer: () => document.getElementById("main-container"),
  showPanel: () => document.getElementById("show-panel"),

  skills: () => document.getElementById("skills-container"),
  items: () => document.getElementById("items-container"),
  conditions: () => document.getElementById("conditions-container"),

  charName: () => document.getElementById("char-name"),
  playerName: () => document.getElementById("player-name"),
  expValue: () => document.getElementById("exp-value"),
  luckValue: () => document.getElementById("luck-value"),

  penBtn: () => document.getElementById("pen-tool-btn"),
  eraseBtn: () => document.getElementById("eraser-tool-btn"),
  penColor: () => document.getElementById("pen-color"),
  strokeSlider: () => document.getElementById("stroke-width-slider"),

  clearMyDrawingsBtn: () => document.getElementById("clear-button"),

  chatInput: () => document.getElementById("chatInput"),
  gmUpload: () => document.getElementById("gm-image-upload"),
  gmUploadFilename: () => document.getElementById("gm-upload-filename"),
  gmFolderInput: () => document.getElementById("gm-folder-input"),
  imageList: () => document.getElementById("image-list"),
  gmGalleryModal: () => document.getElementById("gm-image-gallery-modal"),

  gmToolsPanel: () => document.getElementById("gm-tools-panel"),
  gmModePanel: () => document.getElementById("gm-mode-panel"),
  gmModeToggle: () => document.getElementById("gm-mode-toggle"),
  gmCharPanels: () => document.getElementById("gm-character-panels"),

  tabBar: () => document.getElementById("tab-bar"),
  rulesModal: () => document.getElementById("rules-modal"),

  themeLink: () => document.getElementById("theme-link"),
};

/* -----------------------------
   Utility
----------------------------- */
function getSessionId() {
  return localStorage.getItem("currentSessionId") || "";
}
function getUser() {
  return firebase.auth().currentUser;
}
function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}
function qs(sel, root = document) {
  return root.querySelector(sel);
}
function qsa(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}

/* =========================================================================
   Character Sheet (skills/items/conditions + exp/luck/wounds)
   NOTE: These are safe to be used via event listeners OR inline onclick.
   ========================================================================= */

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
    checkbox.dataset.level = String(i);

    checkbox.checked = anyChecked ? !!levels[i - 1] : i === 1;

    checkbox.addEventListener("change", () => {
      if (!checkbox.checked) return;
      const all = checkboxes.querySelectorAll(".skill-level");
      all.forEach(cb => {
        if (cb !== checkbox) cb.checked = false;
      });
      silentAutoSaveCharacter();
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
  input.addEventListener("input", silentAutoSaveCharacter);

  const rollButton = document.createElement("button");
  rollButton.type = "button";
  rollButton.textContent = "🎲";
  rollButton.style.marginTop = "4px";

  rollButton.addEventListener("click", async () => {
    const skillName = input.value.trim() || "Unnamed Skill";
    const allChecks = checkboxes.querySelectorAll(".skill-level");

    let diceCount = 0;
    allChecks.forEach((cb, idx) => {
      if (cb.checked) diceCount = idx + 2;
    });
    if (!diceCount) return alert("No dice level selected.");

    const rolls = Array.from({ length: diceCount }, () => Math.floor(Math.random() * 6) + 1);
    const total = rolls.reduce((a, b) => a + b, 0);

    const sessionId = getSessionId();
    const user = getUser();
    if (!sessionId || !user) return alert("You must be logged in and in a session.");

    const characterName = EL.playerName()?.value || "Unknown";

    try {
      const doc = await db.collection("users").doc(user.uid).get();
      const color = doc.data()?.displayNameColor || "#ffffff";

      await db.collection("sessions").doc(sessionId).collection("chat").add({
        characterName,
        text: `${characterName}: ${skillName}: [${rolls.join(", ")}] = ${total}`,
        color,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      });
    } catch (err) {
      console.error("Failed to send roll to chat:", err);
      alert("Failed to send roll to chat.");
    }
  });

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.textContent = "✕";
  deleteButton.className = "delete-button";
  deleteButton.addEventListener("click", () => {
    container.remove();
    silentAutoSaveCharacter();
  });

  container.appendChild(checkboxes);
  container.appendChild(input);
  container.appendChild(rollButton);
  container.appendChild(deleteButton);

  return container;
}

function addSkill(value = "", levels = [true, false, false, false]) {
  // supports calling with object {name, levels}
  if (typeof value === "object" && value) {
    levels = value.levels || [true, false, false, false];
    value = value.name || "";
  }
  const container = EL.skills();
  if (!container) return;
  container.appendChild(createSkillInput(value, levels));
  silentAutoSaveCharacter();
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
  input.addEventListener("input", silentAutoSaveCharacter);

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.textContent = "✕";
  deleteButton.className = "delete-button";
  deleteButton.addEventListener("click", () => {
    div.remove();
    silentAutoSaveCharacter();
  });

  div.appendChild(input);
  div.appendChild(deleteButton);
  return div;
}

function addItem(value = "") {
  const container = EL.items();
  if (!container) return;
  container.appendChild(createItemInput(value));
  silentAutoSaveCharacter();
}

function createConditionInput(value = "") {
  const div = document.createElement("div");
  div.className = "input-wrapper";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "condition-input";
  input.placeholder = "Enter condition";
  input.maxLength = 20;
  input.value = typeof value === "object" && value ? (value.name || "") : value;
  input.addEventListener("input", silentAutoSaveCharacter);

  const delButton = document.createElement("button");
  delButton.type = "button";
  delButton.className = "delete-button";
  delButton.textContent = "✕";
  delButton.addEventListener("click", () => {
    div.remove();
    silentAutoSaveCharacter();
  });

  div.appendChild(input);
  div.appendChild(delButton);
  return div;
}

function addCondition(value = "") {
  const container = EL.conditions();
  if (!container) return;
  container.appendChild(createConditionInput(value));
  silentAutoSaveCharacter();
}

function adjustExp(amount) {
  const expSpan = EL.expValue();
  if (!expSpan) return;
  let current = parseInt(expSpan.textContent || "0", 10);
  current = Math.max(0, current + amount);
  expSpan.textContent = String(current);
  silentAutoSaveCharacter();
}

function adjustLuck(amount) {
  const luckSpan = EL.luckValue();
  if (!luckSpan) return;
  let current = parseInt(luckSpan.textContent || "1", 10);
  current = Math.max(0, current + amount);
  luckSpan.textContent = String(current);
  silentAutoSaveCharacter();
}

function toggleWound(index) {
  const woundButtons = qsa(".wounds button");
  if (!woundButtons[index]) return;
  woundButtons[index].classList.toggle("active");
  silentAutoSaveCharacter();
}

/* -----------------------------
   Local-only Save/Load (legacy)
   Keeping these in case your UI calls them.
----------------------------- */
function saveData() {
  localStorage.setItem("rfrbCharacter", JSON.stringify(buildCharacterDataFromDOM()));
  alert("Character saved!");
}
function loadData() {
  const data = JSON.parse(localStorage.getItem("rfrbCharacter") || "null");
  if (!data) return alert("No saved character!");
  applyCharacterDataToDOM(data);
  alert("Character loaded!");
}
function clearData() {
  localStorage.removeItem("rfrbCharacter");
  resetCharacterDOM();
  alert("Character cleared.");
}

/* =========================================================================
   Autosave formState (your theme + input persistence)
   ========================================================================= */

function loadFormState() {
  const saved = localStorage.getItem("formState");
  if (!saved) return;

  const data = JSON.parse(saved);
  Object.keys(data).forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;

    if (el.type === "checkbox") el.checked = !!data[id];
    else if (el.type === "file") return;
    else el.value = data[id];
  });

  if (data.theme) {
    const themeLink = EL.themeLink();
    if (themeLink) themeLink.setAttribute("href", data.theme);
  }
}

function saveFormState() {
  const elements = qsa("input, textarea, select");
  const data = {};
  elements.forEach(el => {
    if (!el.id) return;
    if (el.type === "file") return;
    data[el.id] = (el.type === "checkbox") ? el.checked : el.value;
  });

  data.theme = EL.themeLink()?.getAttribute("href") || "";
  localStorage.setItem("formState", JSON.stringify(data));
}

/* =========================================================================
   Character Data DOM <-> Object
   ========================================================================= */

function buildCharacterDataFromDOM() {
  const name = EL.charName()?.value || "";
  const exp = parseInt(EL.expValue()?.textContent || "0", 10);
  const luck = parseInt(EL.luckValue()?.textContent || "1", 10);

  const wounds = qsa(".wounds button").map(btn => btn.classList.contains("active"));

  const skills = qsa(".input-wrapper").map(wrapper => {
    const input = wrapper.querySelector(".skill-input");
    if (!input) return null;
    const levels = qsa(".skill-level", wrapper).map(cb => cb.checked);
    const skillName = input.value.trim();
    if (!skillName) return null;
    return { name: skillName, levels };
  }).filter(Boolean);

  const items = qsa(".item-input").map(i => i.value.trim()).filter(Boolean);

  // ✅ FIX: conditions were previously reading .skill-input (wrong)
  const conditions = qsa(".condition-input").map(i => i.value.trim()).filter(Boolean).map(name => ({ name }));

  return { name, exp, luck, wounds, skills, items, conditions };
}

function applyCharacterDataToDOM(data) {
  if (EL.charName()) EL.charName().value = data.name || "";
  if (EL.expValue()) EL.expValue().textContent = String(data.exp ?? 0);
  if (EL.luckValue()) EL.luckValue().textContent = String(data.luck ?? 1);

  const woundButtons = qsa(".wounds button");
  (data.wounds || []).forEach((isActive, i) => {
    if (woundButtons[i]) woundButtons[i].classList.toggle("active", !!isActive);
  });

  // skills
  if (EL.skills()) {
    EL.skills().innerHTML = "";
    (data.skills || []).forEach(s => addSkill(s));
    if (EL.skills().children.length === 0) addSkill("Do anything");
  }

  // items
  if (EL.items()) {
    EL.items().innerHTML = "";
    (data.items || []).forEach(item => addItem(item));
    if (EL.items().children.length === 0) addItem("");
  }

  // conditions
  if (EL.conditions()) {
    EL.conditions().innerHTML = "";
    (data.conditions || []).forEach(c => addCondition(c?.name || c));
    if (EL.conditions().children.length === 0) addCondition("");
  }
}

function resetCharacterDOM() {
  if (EL.charName()) EL.charName().value = "";
  if (EL.expValue()) EL.expValue().textContent = "0";
  if (EL.luckValue()) EL.luckValue().textContent = "1";
  qsa(".wounds button").forEach(btn => btn.classList.remove("active"));

  if (EL.skills()) { EL.skills().innerHTML = ""; addSkill("Do anything"); }
  if (EL.items()) { EL.items().innerHTML = ""; addItem(""); }
  if (EL.conditions()) { EL.conditions().innerHTML = ""; addCondition(""); }
}

/* =========================================================================
   Silent autosave placeholder
   (You likely have real Firestore autosave elsewhere. This keeps UI responsive.)
   ========================================================================= */
function silentAutoSaveCharacter() {
  // If you already have Firestore autosave in login.js, keep it there.
  // Here we can keep a lightweight local backup to avoid data loss.
  try {
    localStorage.setItem("rfrbCharacterDraft", JSON.stringify(buildCharacterDataFromDOM()));
  } catch (e) {
    // ignore
  }
}

/* =========================================================================
   Theme
   ========================================================================= */
function setTheme(theme) {
  const link = EL.themeLink() || qs("link[rel='stylesheet']");
  if (!link) return;

  const map = {
    dark: "style-dark.css",
    lava: "style-lava.css",
    forest: "style-forest.css",
    ocean: "style-ocean.css",
    sky: "style-sky.css",
    default: "style-default.css",
  };

  link.href = map[theme] || map.default;
  saveFormState();
}

/* =========================================================================
   Show & Tell / Tabs
   ========================================================================= */

function ensureTabImageExists() {
  const container = EL.zoomContent();
  if (!container) return;
  if (EL.tabImage()) return;

  const img = document.createElement("img");
  img.id = "tab-image";
  img.style.position = "absolute";
  img.style.top = "0";
  img.style.left = "0";
  img.style.maxWidth = "none";
  img.draggable = false;
  container.appendChild(img);
}

function toggleShowAndTell() {
  if (EL.characterPanel()) EL.characterPanel().style.display = "none";
  if (EL.mainContainer()) EL.mainContainer().style.display = "none";
  if (EL.showPanel()) EL.showPanel().style.display = "block";

  ensureTabImageExists();
  syncPenColorFromPicker();
  ensureDrawingCanvasExists();
  setupDrawingCanvasSafe(); // safe init (wait for image)
  // You likely have listenForDisplayImageUpdates() elsewhere; call if it exists.
  if (typeof window.listenForDisplayImageUpdates === "function") window.listenForDisplayImageUpdates();
}

function toggleCharacterPanel() {
  if (EL.characterPanel()) EL.characterPanel().style.display = "block";
  if (EL.mainContainer()) EL.mainContainer().style.display = "block";
  if (EL.showPanel()) EL.showPanel().style.display = "none";
}

function showTabImage(url) {
  ensureTabImageExists();
  const img = EL.tabImage();
  if (img) img.src = url || "";
}

function renderTabs(tabs, activeTabId) {
  const tabBar = EL.tabBar();
  if (!tabBar) return;

  tabBar.innerHTML = "";
  tabs.forEach(tab => {
    const btn = document.createElement("button");
    btn.textContent = tab.title;
    btn.classList.add("tab-button");
    if (tab.id === activeTabId) btn.classList.add("active");
    btn.type = "button";
    btn.addEventListener("click", () => {
      currentTabId = tab.id;
      showTabImage(tab.imageUrl);
      renderTabs(tabs, tab.id);
    });
    tabBar.appendChild(btn);
  });
}

function createNewTab(name, imageUrl, updateFirestore = true) {
  const tabBar = EL.tabBar();
  if (!tabBar) return;

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = name;
  button.addEventListener("click", () => showTabImage(imageUrl));
  tabBar.appendChild(button);

  showTabImage(imageUrl);

  if (updateFirestore) {
    const sessionId = getSessionId();
    if (!sessionId) return;

    const tabRef = db.collection("sessions").doc(sessionId).collection("tabs").doc(name);
    tabRef.set({ imageUrl });

    db.collection("sessions").doc(sessionId).update({
      tabOrder: firebase.firestore.FieldValue.arrayUnion(name),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  }
}

function pushToDisplayArea(imageUrl, updateFirestore = true) {
  ensureTabImageExists();
  ensureDrawingCanvasExists();

  const tabBar = EL.tabBar();
  const tabButtons = tabBar ? Array.from(tabBar.children) : [];

  // If no tabs exist, force-create one
  if (tabButtons.length === 0) {
    const newTabName = prompt("No tabs exist. Enter a name for the new tab:");
    if (!newTabName) return;
    createNewTab(newTabName, imageUrl, updateFirestore);
    return;
  }

  const img = EL.tabImage();
  if (!img) return;

  img.src = imageUrl;
  latestDisplayImage = imageUrl;

  img.onload = () => {
    const zoomContainer = EL.zoomContainer();
    if (!zoomContainer) return;

    const containerBox = zoomContainer.getBoundingClientRect();
    const scaleX = containerBox.width / img.naturalWidth;
    const scaleY = containerBox.height / img.naturalHeight;
    const initialScale = Math.min(scaleX, scaleY);

    zoomLevel = initialScale;
    panX = (containerBox.width - img.naturalWidth * initialScale) / 2;
    panY = (containerBox.height - img.naturalHeight * initialScale) / 2;

    applyTransform();
    drawFromBuffer();
    loadAllDrawings(); // will no-op if no session
  };

  localStorage.setItem("gmDisplayImage", imageUrl);

  if (updateFirestore) {
    const sessionId = getSessionId();
    if (!sessionId) return;
    db.collection("sessions").doc(sessionId).update({
      currentDisplayImage: imageUrl,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  }
}

function cleardisplay() {
  const img = EL.tabImage();
  if (img) img.src = "";

  const tabBar = EL.tabBar();
  if (tabBar) tabBar.innerHTML = "";

  userCanvases = {};
  drawFromBuffer();

  const sessionId = getSessionId();
  if (!sessionId) return;

  // clear tabs subcollection
  const tabsRef = db.collection("sessions").doc(sessionId).collection("tabs");
  tabsRef.get().then(snapshot => {
    const batch = db.batch();
    snapshot.forEach(doc => batch.delete(doc.ref));
    return batch.commit();
  });

  db.collection("sessions").doc(sessionId).update({
    tabOrder: [],
    currentDisplayImage: "",
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
}

/* =========================================================================
   Pan/Zoom
   ========================================================================= */

function applyTransform() {
  const zoomContent = EL.zoomContent();
  const canvas = EL.drawingCanvas();
  const img = qs("#zoom-content img"); // your image is #tab-image usually

  if (!zoomContent || !img) return;

  // pan
  zoomContent.style.left = `${panX}px`;
  zoomContent.style.top = `${panY}px`;

  // zoom by resizing image + canvas CSS size
  const displayWidth = img.naturalWidth * zoomLevel;
  const displayHeight = img.naturalHeight * zoomLevel;

  img.style.width = `${displayWidth}px`;
  img.style.height = `${displayHeight}px`;

  if (canvas) {
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;
  }

  drawFromBuffer();
}

/* =========================================================================
   Drawing (per-user layers, sync on pointerup only)
   ========================================================================= */

function ensureDrawingCanvasExists() {
  const container = EL.zoomContent();
  if (!container) return;

  let canvas = EL.drawingCanvas();
  if (canvas) return;

  canvas = document.createElement("canvas");
  canvas.id = "drawing-canvas";
  canvas.style.position = "absolute";
  canvas.style.top = "0";
  canvas.style.left = "0";
  canvas.style.zIndex = "5";
  canvas.style.pointerEvents = "none"; // ✅ default: do NOT block UI
  container.appendChild(canvas);
}

function setupDrawingCanvasSafe() {
  const canvas = EL.drawingCanvas();
  const img = qs("#zoom-content img");
  if (!canvas || !img) return;

  // Wait until image is loaded so naturalWidth/Height are valid
  if (!img.complete || !img.naturalWidth) {
    img.addEventListener("load", () => setupDrawingCanvasSafe(), { once: true });
    return;
  }

  setupDrawingCanvas();
}

function setupDrawingCanvas() {
  const canvas = EL.drawingCanvas();
  const img = qs("#zoom-content img");
  if (!canvas || !img) return;

  // Offscreen buffer just for sizing reference (not saved directly)
  offscreenCanvas = document.createElement("canvas");
  offscreenCanvas.width = img.naturalWidth;
  offscreenCanvas.height = img.naturalHeight;
  offscreenCtx = offscreenCanvas.getContext("2d");

  // Bind events once
  if (canvas.dataset.bound === "1") return;
  canvas.dataset.bound = "1";

  canvas.addEventListener("pointerdown", (e) => {
    if (!currentTool) return;
    drawing = true;

    const user = getUser();
    if (!user) return;

    const { x, y } = getTrueCoords(canvas, e);

    if (!userCanvases[user.uid]) {
      userCanvases[user.uid] = document.createElement("canvas");
      userCanvases[user.uid].width = offscreenCanvas.width;
      userCanvases[user.uid].height = offscreenCanvas.height;
    }

    const myCtx = userCanvases[user.uid].getContext("2d");
    myCtx.beginPath();
    myCtx.lineWidth = (currentTool === "erase")
      ? 20
      : parseInt(EL.strokeSlider()?.value || "4", 10);

    myCtx.strokeStyle = penColor;
    myCtx.globalCompositeOperation = (currentTool === "erase") ? "destination-out" : "source-over";
    myCtx.moveTo(x, y);

    // Capture pointer to avoid losing strokes
    try { canvas.setPointerCapture(e.pointerId); } catch {}
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!drawing || !currentTool) return;

    const user = getUser();
    if (!user || !userCanvases[user.uid]) return;

    const { x, y } = getTrueCoords(canvas, e);

    const myCtx = userCanvases[user.uid].getContext("2d");
    myCtx.strokeStyle = penColor;
    myCtx.globalCompositeOperation = (currentTool === "erase") ? "destination-out" : "source-over";
    myCtx.lineWidth = (currentTool === "erase")
      ? 20
      : parseInt(EL.strokeSlider()?.value || "4", 10);

    myCtx.lineTo(x, y);
    myCtx.stroke();

    drawFromBuffer();
  });

  canvas.addEventListener("pointerup", async (e) => {
    if (!currentTool) return;
    drawing = false;

    const user = getUser();
    if (!user || !userCanvases[user.uid]) return;

    try { canvas.releasePointerCapture(e.pointerId); } catch {}

    // ✅ Firestore write only when stroke ends
    await saveUserDrawingLayer(user.uid);

    drawFromBuffer();
  });

  canvas.addEventListener("pointercancel", () => {
    drawing = false;
  });

  // Initial load + live sync
  loadAllDrawings();
  listenForDrawings();
}

function getTrueCoords(canvas, e) {
  const rect = canvas.getBoundingClientRect();
  // Convert from displayed coords back to image-space using zoomLevel
  const x = (e.clientX - rect.left) / zoomLevel;
  const y = (e.clientY - rect.top) / zoomLevel;
  return { x, y };
}

function drawFromBuffer() {
  const canvas = EL.drawingCanvas();
  const img = qs("#zoom-content img");
  if (!canvas || !img || !img.naturalWidth || !offscreenCanvas) return;

  // Resize actual canvas to match display size * devicePixelRatio
  const displayW = img.naturalWidth * zoomLevel;
  const displayH = img.naturalHeight * zoomLevel;

  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${displayW}px`;
  canvas.style.height = `${displayH}px`;
  canvas.width = Math.floor(displayW * dpr);
  canvas.height = Math.floor(displayH * dpr);

  const ctx = canvas.getContext("2d");
  // Map image-space to screen-space
  ctx.setTransform(dpr * zoomLevel, 0, 0, dpr * zoomLevel, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw all user layers in deterministic order (uid sort)
  Object.keys(userCanvases).sort().forEach(uid => {
    ctx.drawImage(userCanvases[uid], 0, 0);
  });
}

async function saveUserDrawingLayer(uid) {
  const sessionId = getSessionId();
  if (!sessionId || !uid) return;

  const layer = userCanvases[uid];
  if (!layer) return;

  const imageData = layer.toDataURL("image/png"); // keep alpha

  try {
    await db.collection("sessions")
      .doc(sessionId)
      .collection("drawings")
      .doc(uid)
      .set({
        imageData,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
  } catch (err) {
    console.error("Failed to save drawing layer:", err);
  }
}

function loadAllDrawings() {
  const sessionId = getSessionId();
  if (!sessionId) return;

  db.collection("sessions")
    .doc(sessionId)
    .collection("drawings")
    .get()
    .then(snapshot => {
      userCanvases = {};
      snapshot.forEach(doc => {
        const uid = doc.id;
        const imageData = doc.data()?.imageData;
        if (!imageData) return;

        const img = new Image();
        img.onload = () => {
          // We must have offscreenCanvas sized already
          if (!offscreenCanvas) return;

          const layer = document.createElement("canvas");
          layer.width = offscreenCanvas.width;
          layer.height = offscreenCanvas.height;
          const ctx = layer.getContext("2d");
          ctx.drawImage(img, 0, 0);
          userCanvases[uid] = layer;
          drawFromBuffer();
        };
        img.src = imageData;
      });
    })
    .catch(err => console.error("loadAllDrawings error:", err));
}

function listenForDrawings() {
  const sessionId = getSessionId();
  if (!sessionId) return;

  if (drawingsUnsub) drawingsUnsub();
  drawingsUnsub = db.collection("sessions")
    .doc(sessionId)
    .collection("drawings")
    .onSnapshot(snapshot => {
      snapshot.docChanges().forEach(change => {
        const uid = change.doc.id;

        if (change.type === "removed") {
          delete userCanvases[uid];
          drawFromBuffer();
          return;
        }

        const imageData = change.doc.data()?.imageData;
        if (!imageData || !offscreenCanvas) return;

        const img = new Image();
        img.onload = () => {
          const layer = document.createElement("canvas");
          layer.width = offscreenCanvas.width;
          layer.height = offscreenCanvas.height;
          layer.getContext("2d").drawImage(img, 0, 0);
          userCanvases[uid] = layer;
          drawFromBuffer();
        };
        img.src = imageData;
      });
    }, err => console.error("listenForDrawings error:", err));
}

function setDrawingMode(mode) {
  ensureDrawingCanvasExists();
  const canvas = EL.drawingCanvas();
  const penBtn = EL.penBtn();
  const eraseBtn = EL.eraseBtn();
  const zoomContainer = EL.zoomContainer();

  if (!canvas || !zoomContainer) return;

  if (currentTool === mode) {
    currentTool = null;
    canvas.style.pointerEvents = "none";
    zoomContainer.classList.remove("no-pan");
    if (penBtn) penBtn.classList.remove("active-tool");
    if (eraseBtn) eraseBtn.classList.remove("active-tool");
    canvas.style.cursor = "default";
  } else {
    currentTool = mode;
    canvas.style.pointerEvents = "auto";
    zoomContainer.classList.add("no-pan");
    if (penBtn) penBtn.classList.toggle("active-tool", mode === "pen");
    if (eraseBtn) eraseBtn.classList.toggle("active-tool", mode === "erase");
    canvas.style.cursor = (mode === "pen") ? "crosshair" : "cell";
  }
}

function clearMyDrawings() {
  const sessionId = getSessionId();
  const user = getUser();
  if (!user || !sessionId) return;

  const uid = user.uid;

  delete userCanvases[uid];
  drawFromBuffer();

  db.collection("sessions").doc(sessionId).collection("drawings").doc(uid).delete()
    .catch(err => console.error("Failed to clear drawing:", err));
}

function clearAllDrawings() {
  const sessionId = getSessionId();
  if (!sessionId) return;

  db.collection("sessions").doc(sessionId).collection("drawings").get().then(snapshot => {
    const batch = db.batch();
    snapshot.forEach(doc => batch.delete(doc.ref));
    return batch.commit();
  }).then(() => {
    userCanvases = {};
    drawFromBuffer();
  }).catch(err => console.error("clearAllDrawings error:", err));
}

/* =========================================================================
   Pen color + slider fill
   ========================================================================= */

function syncPenColorFromPicker() {
  const picker = EL.penColor();
  const slider = EL.strokeSlider();
  if (!picker) return;
  penColor = picker.value;

  if (slider) {
    slider.style.setProperty("--track-color", penColor);
  }
  updateSliderFill();
}

function updateSliderFill() {
  const slider = EL.strokeSlider();
  const picker = EL.penColor();
  if (!slider || !picker) return;

  const value = parseFloat(slider.value || "4");
  const min = parseFloat(slider.min || "1");
  const max = parseFloat(slider.max || "20");
  const percent = ((value - min) / (max - min)) * 100;
  const color = picker.value;

  slider.style.setProperty(
    "--slider-fill",
    `linear-gradient(to right, ${color} 0%, ${color} ${percent}%, white ${percent}%, white 100%)`
  );
  slider.style.setProperty("--track-color", color);
}

/* =========================================================================
   GM Tools / GM Mode (kept, but safer)
   ========================================================================= */

function toggleGMTools() {
  const panel = EL.gmToolsPanel();
  if (!panel) return;
  panel.style.display = (panel.style.display === "none" || !panel.style.display) ? "block" : "none";
}

function toggleGMMode() {
  gmModeActive = !gmModeActive;

  const characterPanel = EL.characterPanel();
  const gmPanel = EL.gmModePanel();
  const gmButton = EL.gmModeToggle();
  const maincontainer = EL.mainContainer();

  if (gmModeActive) {
    if (maincontainer) maincontainer.style.display = "none";
    if (characterPanel) characterPanel.style.display = "none";
    if (gmPanel) gmPanel.style.display = "block";
    if (gmButton) gmButton.textContent = "Exit GM Mode";
    loadAllGMCharacterPanels();
  } else {
    if (characterPanel) characterPanel.style.display = "block";
    if (gmPanel) gmPanel.style.display = "none";
    if (gmButton) gmButton.textContent = "GM Mode";
    if (maincontainer) maincontainer.style.display = "block";
    // cleanup listeners
    gmPanelUnsubscribes.forEach(u => u());
    gmPanelUnsubscribes = [];
  }
}

function loadAllGMCharacterPanels() {
  const sessionId = getSessionId();
  if (!sessionId) return;

  gmPanelUnsubscribes.forEach(u => u());
  gmPanelUnsubscribes = [];

  const container = EL.gmCharPanels();
  if (!container) return;
  container.innerHTML = "<p>Loading characters...</p>";

  const unsub = db.collection("sessions").doc(sessionId).collection("characters")
    .onSnapshot(snapshot => {
      container.innerHTML = "";

      snapshot.forEach(doc => {
        const charId = doc.id;

        const panel = document.createElement("div");
        panel.id = `char-${charId}`;
        panel.style = "min-width: 250px; max-width: 300px; background: #111; color: white; border: 2px solid #555; padding: 10px;";

        panel.innerHTML = `<h3>${charId}</h3><p>Loading...</p>`;
        container.appendChild(panel);

        const u2 = db.collection("sessions").doc(sessionId).collection("characters").doc(charId)
          .onSnapshot(docSnap => {
            const data = docSnap.data();
            if (!data) return;

            const wounds = (data.wounds || []).map(active => active ? "❤️" : "🖤").join(" ");
            const skills = (data.skills || []).map(s => {
              const name = (typeof s === "string") ? s : s.name;
              const dice = (typeof s === "object" && Array.isArray(s.levels))
                ? (s.levels.filter(Boolean).length + 1)
                : 2;
              return `• ${name} (${dice}🎲)`;
            }).join("<br>");

            const conditions = (data.conditions || []).map(c => `• ${(c?.name || c)}`).join("<br>");
            const items = (data.items || []).map(i => `• ${i}`).join("<br>");

            panel.innerHTML = `
              <h3>${data.name || charId}</h3>
              <p><strong>EXP:</strong> ${data.exp ?? 0}</p>
              <p><strong>LUCK:</strong> ${data.luck ?? 1}</p>
              <p><strong>WOUNDS:</strong> ${wounds}</p>
              <p><strong>SKILLS:</strong><br>${skills}</p>
              <p><strong>ITEMS:</strong><br>${items || "."}</p>
              <p><strong>CONDITIONS:</strong><br>${conditions || "."}</p>
            `;
          });

        gmPanelUnsubscribes.push(u2);
      });

      if (snapshot.empty) container.innerHTML = "<p>No characters found.</p>";
    });

  gmPanelUnsubscribes.push(unsub);
}

/* =========================================================================
   Chat helpers (only if your app defines sendChatMessage elsewhere)
   ========================================================================= */

function clearchat() {
  const sessionId = getSessionId();
  if (!sessionId) return alert("No session selected.");

  const chatRef = db.collection("sessions").doc(sessionId).collection("chat");
  chatRef.get().then(snapshot => {
    const batch = db.batch();
    snapshot.forEach(doc => batch.delete(doc.ref));
    return batch.commit();
  }).then(() => {
    const chatMessages = document.getElementById("chat-messages");
    if (chatMessages) chatMessages.innerHTML = "";
  }).catch(err => {
    console.error("Error clearing chat:", err);
    alert("Failed to clear chat.");
  });
}

/* =========================================================================
   Rules modal
   ========================================================================= */
function toggleRules() {
  const modal = EL.rulesModal();
  if (!modal) return;
  modal.style.display = (modal.style.display === "block") ? "none" : "block";
}

/* =========================================================================
   Init / Bindings
   ========================================================================= */

function bindPanZoom() {
  const zoomContainer = EL.zoomContainer();
  const zoomContent = EL.zoomContent();
  if (!zoomContainer || !zoomContent) {
    console.warn("❌ Zoom container or content not found.");
    return;
  }

  applyTransform();

  zoomContainer.addEventListener("wheel", (e) => {
    if (currentTool) return;
    e.preventDefault();

    const rect = zoomContainer.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;

    const zoomFactor = 0.1;
    const scaleChange = (e.deltaY < 0) ? 1 + zoomFactor : 1 - zoomFactor;
    const newZoom = clamp(zoomLevel * scaleChange, 0.01, 4);

    // zoom around cursor
    panX = offsetX - (offsetX - panX) * (newZoom / zoomLevel);
    panY = offsetY - (offsetY - panY) * (newZoom / zoomLevel);

    zoomLevel = newZoom;
    applyTransform();
  }, { passive: false });

  zoomContainer.addEventListener("mousedown", (e) => {
    if (currentTool) return;

    // ✅ do not pan when clicking UI
    if (e.target.closest("button, input, textarea, select, label, a")) return;

    isPanning = true;
    startX = e.clientX - panX;
    startY = e.clientY - panY;
    zoomContainer.style.cursor = "grabbing";
  });

  document.addEventListener("mousemove", (e) => {
    if (currentTool) return;
    if (!isPanning) return;

    panX = e.clientX - startX;
    panY = e.clientY - startY;
    applyTransform();
  });

  document.addEventListener("mouseup", () => {
    if (currentTool) return;
    isPanning = false;
    zoomContainer.style.cursor = "grab";
  });

  window.addEventListener("beforeunload", () => {
    localStorage.setItem("zoomLevel", String(zoomLevel));
    localStorage.setItem("panX", String(panX));
    localStorage.setItem("panY", String(panY));
  });
}

function bindUI() {
  // formState autosave
  loadFormState();
  qsa("input, textarea, select").forEach(el => {
    el.addEventListener("input", saveFormState);
    el.addEventListener("change", saveFormState);
  });

  // theme buttons (data-theme is a href in your old code)
  qsa("button[data-theme]").forEach(btn => {
    btn.addEventListener("click", () => {
      const href = btn.getAttribute("data-theme");
      if (!href) return;
      const link = EL.themeLink();
      if (!link) return;
      link.setAttribute("href", href);
      saveFormState();
    });
  });

  // Pen / slider bindings
  if (EL.penColor()) {
    EL.penColor().addEventListener("input", () => {
      syncPenColorFromPicker();
    });
    EL.penColor().addEventListener("change", () => {
      syncPenColorFromPicker();
    });
  }

  if (EL.strokeSlider()) {
    EL.strokeSlider().addEventListener("input", updateSliderFill);
    EL.strokeSlider().addEventListener("change", updateSliderFill);
  }

  // clear-my-drawings button
  const clearBtn = EL.clearMyDrawingsBtn();
  if (clearBtn) clearBtn.addEventListener("click", clearMyDrawings);

  // chat enter-to-send (if sendChatMessage exists)
  if (EL.chatInput()) {
    EL.chatInput().addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (typeof window.sendChatMessage === "function") window.sendChatMessage();
      }
    });
  }

  // GM upload filename label
  if (EL.gmUpload()) {
    EL.gmUpload().addEventListener("change", function () {
      const span = EL.gmUploadFilename();
      if (!span) return;
      span.textContent = (this.files && this.files.length > 0) ? this.files[0].name : "";
    });
  }

  // Ensure baseline lists exist
  if (EL.skills() && EL.skills().children.length === 0) addSkill("Do anything");
  if (EL.items() && EL.items().children.length === 0) addItem("");
  if (EL.conditions() && EL.conditions().children.length === 0) addCondition("");

  // sync pen color once
  syncPenColorFromPicker();
  updateSliderFill();
}

function restoreDisplayImageIfSessionKnown() {
  const sessionId = getSessionId();
  if (!sessionId) return;

  // Only restore if Firestore still has it
  db.collection("sessions").doc(sessionId).get().then(doc => {
    const url = doc.data()?.currentDisplayImage;
    if (doc.exists && url) {
      ensureTabImageExists();
      pushToDisplayArea(url, false);
    } else {
      localStorage.removeItem("gmDisplayImage");
    }
  }).catch(err => console.warn("Failed to validate display image:", err));
}

function init() {
  bindUI();
  bindPanZoom();
  restoreDisplayImageIfSessionKnown();
  ensureDrawingCanvasExists();
  setupDrawingCanvasSafe();
  console.log("✅ Script loaded (rewritten).");
}

/* =========================================================================
   Export to window
   - This makes inline onclick work if your HTML uses it.
   ========================================================================= */
window.addSkill = addSkill;
window.addItem = addItem;
window.addCondition = addCondition;

window.saveData = saveData;
window.loadData = loadData;
window.clearData = clearData;

window.adjustExp = adjustExp;
window.adjustLuck = adjustLuck;
window.toggleWound = toggleWound;

window.toggleRules = toggleRules;
window.setTheme = setTheme;

window.toggleShowAndTell = toggleShowAndTell;
window.toggleCharacterPanel = toggleCharacterPanel;
window.pushToDisplayArea = pushToDisplayArea;

window.setDrawingMode = setDrawingMode;
window.clearMyDrawings = clearMyDrawings;
window.clearAllDrawings = clearAllDrawings;

window.toggleGMTools = toggleGMTools;
window.toggleGMMode = toggleGMMode;

window.clearchat = clearchat;
window.cleardisplay = cleardisplay;

window.applyTransform = applyTransform;

/* =========================================================================
   Start
   ========================================================================= */
window.addEventListener("DOMContentLoaded", init);

