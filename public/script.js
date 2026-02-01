/* =========================================================================
   Roll for Rocket Boots - public/script.js (Robust / Double-load-safe)
   - All state lives in window.RFRB to avoid redeclare crashes
   - Exports all functions used by inline onclick buttons + login.js
   - Pan/zoom + drawing overlay (sync only on pointerup)
   ========================================================================= */

/* global firebase, db, auth */

(function () {
  // Namespace
  const R = (window.RFRB = window.RFRB || {});

  // Prevent double-binding
  if (R.__initialized) {
    console.warn("RFRB: script already initialized; skipping re-init.");
    return;
  }
  R.__initialized = true;

  /* -----------------------------
     State (idempotent)
  ----------------------------- */
  R.zoomLevel = Number.isFinite(R.zoomLevel) ? R.zoomLevel : (parseFloat(localStorage.getItem("zoomLevel")) || 1);
  R.panX = Number.isFinite(R.panX) ? R.panX : (parseFloat(localStorage.getItem("panX")) || 0);
  R.panY = Number.isFinite(R.panY) ? R.panY : (parseFloat(localStorage.getItem("panY")) || 0);

  R.isPanning = !!R.isPanning;
  R.startX = R.startX || 0;
  R.startY = R.startY || 0;

  R.latestDisplayImage = R.latestDisplayImage ?? null;
  R.currentTabId = R.currentTabId ?? null;

  R.currentTool = R.currentTool ?? null; // 'pen' | 'erase' | null
  R.penColor = R.penColor ?? "#ff0000";
  R.drawing = !!R.drawing;

  R.offscreenCanvas = R.offscreenCanvas ?? null;
  R.offscreenCtx = R.offscreenCtx ?? null;

  R.userCanvases = R.userCanvases ?? {}; // uid => canvas
  R.drawingsUnsub = R.drawingsUnsub ?? null;

  R.gmModeActive = R.gmModeActive ?? false;
  R.gmPanelUnsubscribes = R.gmPanelUnsubscribes ?? [];

  // Optional tab state cache
  R.tabs = R.tabs ?? [];
  R.warned = R.warned ?? {}; // one-time warnings

  /* -----------------------------
     Helpers
  ----------------------------- */
  function warnOnce(key, msg) {
    if (R.warned[key]) return;
    R.warned[key] = true;
    console.warn(msg);
  }

  function qs(sel, root = document) {
    return root.querySelector(sel);
  }
  function qsa(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
  }

  function clamp(n, min, max) {
    return Math.min(Math.max(n, min), max);
  }

  function getSessionId() {
    return localStorage.getItem("currentSessionId") || "";
  }

  function getUser() {
    return firebase?.auth?.().currentUser || null;
  }

  const EL = {
    zoomContainer: () => document.getElementById("zoom-container"),
    zoomContent: () => document.getElementById("zoom-content"),
    tabImage: () => document.getElementById("tab-image"),
    drawingCanvas: () => document.getElementById("drawing-canvas"),

    characterPanel: () => document.getElementById("character-panel"),
    mainContainer: () => document.getElementById("main-container"),
    showPanel: () => document.getElementById("show-panel"),

    tabBar: () => document.getElementById("tab-bar"),
    rulesModal: () => document.getElementById("rules-modal"),

    gmToolsPanel: () => document.getElementById("gm-tools-panel"),
    gmModePanel: () => document.getElementById("gm-mode-panel"),
    gmModeToggle: () => document.getElementById("gm-mode-toggle"),
    gmCharPanels: () => document.getElementById("gm-character-panels"),

    skills: () => document.getElementById("skills-container"),
    items: () => document.getElementById("items-container"),
    conditions: () => document.getElementById("conditions-container"),

    charName: () => document.getElementById("char-name"),
    playerName: () => document.getElementById("player-name"),
    expValue: () => document.getElementById("exp-value"),
    luckValue: () => document.getElementById("luck-value"),

    penBtn: () => document.getElementById("pen-tool-btn"),
    eraserBtn: () => document.getElementById("eraser-tool-btn"),
    penColor: () => document.getElementById("pen-color"),
    strokeSlider: () => document.getElementById("stroke-width-slider"),
    clearButton: () => document.getElementById("clear-button"),

    chatInput: () => document.getElementById("chatInput"),
    chatMessages: () => document.getElementById("chat-messages"),

    gmGalleryModal: () => document.getElementById("gm-image-gallery-modal"),
    gmUpload: () => document.getElementById("gm-image-upload"),
    gmUploadFilename: () => document.getElementById("gm-upload-filename"),
    gmFolderInput: () => document.getElementById("gm-folder-input"),
    imageList: () => document.getElementById("image-list"),

    themeLink: () => document.getElementById("theme-link") || document.querySelector("link[rel='stylesheet']"),
  };

  /* =========================================================================
     THEME (fixes setTheme is not defined)
     ========================================================================= */
  function setTheme(theme) {
    const link = EL.themeLink();
    if (!link) return warnOnce("themeLinkMissing", "RFRB: theme link tag not found.");

    const map = {
      dark: "style-dark.css",
      lava: "style-lava.css",
      forest: "style-forest.css",
      ocean: "style-ocean.css",
      sky: "style-sky.css",
      default: "style-default.css"
    };

    link.setAttribute("href", map[theme] || map.default);

    // Persist like your old system did (best-effort)
    try {
      const formState = JSON.parse(localStorage.getItem("formState") || "{}");
      formState.theme = link.getAttribute("href");
      localStorage.setItem("formState", JSON.stringify(formState));
    } catch {}
  }

  /* =========================================================================
     CHARACTER SHEET CORE (skills/items/conditions + exp/luck/wounds)
     ========================================================================= */

  function silentAutoSaveCharacter() {
    // Lightweight local backup to avoid loss; your Firestore autosave (if any) can stay in login.js
    try {
      localStorage.setItem("rfrbCharacterDraft", JSON.stringify(buildCharacterDataFromDOM()));
    } catch {}
  }

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
        all.forEach(cb => { if (cb !== checkbox) cb.checked = false; });
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

    // Optional roll-to-chat
    rollButton.addEventListener("click", async () => {
      const skillName = input.value.trim() || "Unnamed Skill";
      const allChecks = checkboxes.querySelectorAll(".skill-level");
      let diceCount = 0;
      allChecks.forEach((cb, idx) => { if (cb.checked) diceCount = idx + 2; });
      if (!diceCount) return alert("No dice level selected.");

      const rolls = Array.from({ length: diceCount }, () => Math.floor(Math.random() * 6) + 1);
      const total = rolls.reduce((a, b) => a + b, 0);

      const user = getUser();
      const sessionId = getSessionId();
      if (!user || !sessionId) return alert("You must be logged in and in a session.");

      const characterName = EL.playerName()?.value || "Unknown";

      try {
        const doc = await db.collection("users").doc(user.uid).get();
        const color = doc.data()?.displayNameColor || "#ffffff";

        await db.collection("sessions").doc(sessionId).collection("chat").add({
          characterName,
          text: `${characterName}: ${skillName}: [${rolls.join(", ")}] = ${total}`,
          color,
          timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
      } catch (err) {
        console.error("RFRB: roll-to-chat failed", err);
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
    if (typeof value === "object" && value) {
      levels = value.levels || [true, false, false, false];
      value = value.name || "";
    }
    const container = EL.skills();
    if (!container) return warnOnce("skillsMissing", "RFRB: #skills-container missing.");
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
    if (!container) return warnOnce("itemsMissing", "RFRB: #items-container missing.");
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
    if (!container) return warnOnce("conditionsMissing", "RFRB: #conditions-container missing.");
    container.appendChild(createConditionInput(value));
    silentAutoSaveCharacter();
  }

  function adjustExp(amount) {
    const expSpan = EL.expValue();
    if (!expSpan) return warnOnce("expMissing", "RFRB: #exp-value missing.");
    let current = parseInt(expSpan.textContent || "0", 10);
    current = Math.max(0, current + amount);
    expSpan.textContent = String(current);
    silentAutoSaveCharacter();
  }

  function adjustLuck(amount) {
    const luckSpan = EL.luckValue();
    if (!luckSpan) return warnOnce("luckMissing", "RFRB: #luck-value missing.");
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

  function buildCharacterDataFromDOM() {
    const name = EL.charName()?.value || "";
    const exp = parseInt(EL.expValue()?.textContent || "0", 10);
    const luck = parseInt(EL.luckValue()?.textContent || "1", 10);
    const wounds = qsa(".wounds button").map(btn => btn.classList.contains("active"));

    const skills = qsa("#skills-container .input-wrapper").map(wrapper => {
      const input = wrapper.querySelector(".skill-input");
      if (!input) return null;
      const levels = qsa(".skill-level", wrapper).map(cb => cb.checked);
      const skillName = input.value.trim();
      if (!skillName) return null;
      return { name: skillName, levels };
    }).filter(Boolean);

    const items = qsa(".item-input").map(i => i.value.trim()).filter(Boolean);

    // ✅ correct conditions (previously bugged in your old code)
    const conditions = qsa(".condition-input")
      .map(i => i.value.trim())
      .filter(Boolean)
      .map(name => ({ name }));

    return { name, exp, luck, wounds, skills, items, conditions };
  }

  function applyCharacterDataToDOM(data) {
    if (!data) return;

    if (EL.charName()) EL.charName().value = data.name || "";
    if (EL.expValue()) EL.expValue().textContent = String(data.exp ?? 0);
    if (EL.luckValue()) EL.luckValue().textContent = String(data.luck ?? 1);

    const woundButtons = qsa(".wounds button");
    (data.wounds || []).forEach((isActive, i) => {
      if (woundButtons[i]) woundButtons[i].classList.toggle("active", !!isActive);
    });

    if (EL.skills()) {
      EL.skills().innerHTML = "";
      (data.skills || []).forEach(s => addSkill(s));
      if (EL.skills().children.length === 0) addSkill("Do anything");
    }

    if (EL.items()) {
      EL.items().innerHTML = "";
      (data.items || []).forEach(item => addItem(item));
      if (EL.items().children.length === 0) addItem("");
    }

    if (EL.conditions()) {
      EL.conditions().innerHTML = "";
      (data.conditions || []).forEach(c => addCondition(c?.name || c));
      if (EL.conditions().children.length === 0) addCondition("");
    }
  }

  // Legacy local save/load buttons (if your sheet still uses them)
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
    // reset basic fields if present
    if (EL.charName()) EL.charName().value = "";
    if (EL.expValue()) EL.expValue().textContent = "0";
    if (EL.luckValue()) EL.luckValue().textContent = "1";
    qsa(".wounds button").forEach(btn => btn.classList.remove("active"));
    if (EL.skills()) { EL.skills().innerHTML = ""; addSkill("Do anything"); }
    if (EL.items()) { EL.items().innerHTML = ""; addItem(""); }
    if (EL.conditions()) { EL.conditions().innerHTML = ""; addCondition(""); }
    alert("Character cleared.");
  }

  /* =========================================================================
     GM TOOLS (fixes openGMTools is not defined)
     ========================================================================= */
  function openGMTools() {
    const panel = EL.gmToolsPanel();
    if (!panel) return warnOnce("gmToolsMissing", "RFRB: #gm-tools-panel missing.");
    panel.style.display = "block";
  }

  function toggleGMTools() {
    const panel = EL.gmToolsPanel();
    if (!panel) return warnOnce("gmToolsMissing", "RFRB: #gm-tools-panel missing.");
    panel.style.display = (panel.style.display === "none" || !panel.style.display) ? "block" : "none";
  }

  /* =========================================================================
     SHOW & TELL PANEL
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
    canvas.style.pointerEvents = "none"; // ✅ default so UI remains clickable
    container.appendChild(canvas);
  }

  function toggleShowAndTell() {
    if (EL.characterPanel()) EL.characterPanel().style.display = "none";
    if (EL.mainContainer()) EL.mainContainer().style.display = "none";
    if (EL.showPanel()) EL.showPanel().style.display = "block";

    ensureTabImageExists();
    ensureDrawingCanvasExists();
    setupDrawingCanvasSafe();

    // If your login.js defines this, we’ll call it
    if (typeof window.listenForDisplayImageUpdates === "function") {
      window.listenForDisplayImageUpdates();
    }
  }

  function toggleCharacterPanel() {
    if (EL.characterPanel()) EL.characterPanel().style.display = "block";
    if (EL.mainContainer()) EL.mainContainer().style.display = "block";
    if (EL.showPanel()) EL.showPanel().style.display = "none";
  }

  /* =========================================================================
     Tabs (basic render + persist)
     ========================================================================= */
  function renderTabs(tabs, activeTabId) {
    const tabBar = EL.tabBar();
    if (!tabBar) return warnOnce("tabBarMissing", "RFRB: #tab-bar missing (tabs won’t render).");

    tabBar.innerHTML = "";
    (tabs || []).forEach(tab => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = tab.title || tab.id || "Tab";
      btn.classList.add("tab-button");
      if (tab.id === activeTabId) btn.classList.add("active");

      btn.addEventListener("click", () => {
        R.currentTabId = tab.id;
        showTabImage(tab.imageUrl);
        renderTabs(tabs, tab.id);
      });

      tabBar.appendChild(btn);
    });
  }

  function showTabImage(url) {
    ensureTabImageExists();
    const img = EL.tabImage();
    if (!img) return;
    img.src = url || "";
  }

  function createNewTab(name, imageUrl, updateFirestore = true) {
    const sessionId = getSessionId();
    if (!sessionId) return alert("No session selected.");

    const tabId = name;
    const tab = { id: tabId, title: name, imageUrl: imageUrl || "" };
    R.tabs = R.tabs || [];
    R.tabs.push(tab);
    R.currentTabId = tabId;
    renderTabs(R.tabs, tabId);
    showTabImage(tab.imageUrl);

    if (updateFirestore) {
      db.collection("sessions").doc(sessionId).collection("tabs").doc(tabId).set({ imageUrl: tab.imageUrl });
      db.collection("sessions").doc(sessionId).update({
        tabOrder: firebase.firestore.FieldValue.arrayUnion(tabId),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
  }

  /* =========================================================================
     Display Image push (GM) + restore
     ========================================================================= */
  function pushToDisplayArea(imageUrl, updateFirestore = true) {
    ensureTabImageExists();
    ensureDrawingCanvasExists();

    const img = EL.tabImage();
    const canvas = EL.drawingCanvas();
    if (!img) return warnOnce("tabImageMissing", "RFRB: #tab-image missing.");
    if (!imageUrl) return;

    img.src = imageUrl;
    R.latestDisplayImage = imageUrl;

    img.onload = () => {
      const zoomContainer = EL.zoomContainer();
      if (!zoomContainer) return;

      const box = zoomContainer.getBoundingClientRect();
      const scaleX = box.width / img.naturalWidth;
      const scaleY = box.height / img.naturalHeight;
      const s = Math.min(scaleX, scaleY);

      R.zoomLevel = s;
      R.panX = (box.width - img.naturalWidth * s) / 2;
      R.panY = (box.height - img.naturalHeight * s) / 2;

      applyTransform();
      setupDrawingCanvasSafe();
      loadAllDrawings();
    };

    // Ensure canvas exists and is layered
    if (canvas) canvas.style.pointerEvents = (R.currentTool ? "auto" : "none");

    localStorage.setItem("gmDisplayImage", imageUrl);

    if (updateFirestore) {
      const sessionId = getSessionId();
      if (!sessionId) return;
      db.collection("sessions").doc(sessionId).update({
        currentDisplayImage: imageUrl,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
  }

  function restoreDisplayIfSessionKnown() {
    const sessionId = getSessionId();
    if (!sessionId) return;

    db.collection("sessions").doc(sessionId).get().then(doc => {
      const url = doc.data()?.currentDisplayImage;
      if (doc.exists && url) {
        pushToDisplayArea(url, false);
      }
    }).catch(() => {});
  }

  /* =========================================================================
     Pan/Zoom (won’t steal clicks from UI controls)
     ========================================================================= */
  function applyTransform() {
    const zoomContent = EL.zoomContent();
    const img = qs("#zoom-content img");
    const canvas = EL.drawingCanvas();
    if (!zoomContent || !img) return;

    zoomContent.style.left = `${R.panX}px`;
    zoomContent.style.top = `${R.panY}px`;

    const w = img.naturalWidth * R.zoomLevel;
    const h = img.naturalHeight * R.zoomLevel;

    img.style.width = `${w}px`;
    img.style.height = `${h}px`;

    if (canvas) {
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }

    drawFromBuffer();
  }

  function bindPanZoom() {
    const zoomContainer = EL.zoomContainer();
    const zoomContent = EL.zoomContent();
    if (!zoomContainer || !zoomContent) return;

    applyTransform();

    zoomContainer.addEventListener("wheel", (e) => {
      if (R.currentTool) return;
      e.preventDefault();

      const rect = zoomContainer.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      const offsetY = e.clientY - rect.top;

      const zoomFactor = 0.1;
      const scaleChange = (e.deltaY < 0) ? 1 + zoomFactor : 1 - zoomFactor;
      const newZoom = clamp(R.zoomLevel * scaleChange, 0.01, 4);

      R.panX = offsetX - (offsetX - R.panX) * (newZoom / R.zoomLevel);
      R.panY = offsetY - (offsetY - R.panY) * (newZoom / R.zoomLevel);

      R.zoomLevel = newZoom;
      applyTransform();
    }, { passive: false });

    zoomContainer.addEventListener("mousedown", (e) => {
      if (R.currentTool) return;

      // ✅ Don’t start panning if clicking any UI control
      if (e.target.closest("button, input, textarea, select, label, a")) return;

      R.isPanning = true;
      R.startX = e.clientX - R.panX;
      R.startY = e.clientY - R.panY;
      zoomContainer.style.cursor = "grabbing";
    });

    document.addEventListener("mousemove", (e) => {
      if (R.currentTool) return;
      if (!R.isPanning) return;
      R.panX = e.clientX - R.startX;
      R.panY = e.clientY - R.startY;
      applyTransform();
    });

    document.addEventListener("mouseup", () => {
      if (R.currentTool) return;
      R.isPanning = false;
      zoomContainer.style.cursor = "grab";
    });

    window.addEventListener("beforeunload", () => {
      localStorage.setItem("zoomLevel", String(R.zoomLevel));
      localStorage.setItem("panX", String(R.panX));
      localStorage.setItem("panY", String(R.panY));
    });
  }

  /* =========================================================================
     Drawing (per-user layers, sync only on pointerup)
     ========================================================================= */
  function setupDrawingCanvasSafe() {
    const canvas = EL.drawingCanvas();
    const img = qs("#zoom-content img");
    if (!canvas || !img) return;

    if (!img.complete || !img.naturalWidth) {
      img.addEventListener("load", () => setupDrawingCanvasSafe(), { once: true });
      return;
    }

    setupDrawingCanvas();
  }

  function getTrueCoords(canvas, e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / R.zoomLevel,
      y: (e.clientY - rect.top) / R.zoomLevel
    };
  }

  function setupDrawingCanvas() {
    const canvas = EL.drawingCanvas();
    const img = qs("#zoom-content img");
    if (!canvas || !img) return;

    // Create offscreen reference
    R.offscreenCanvas = document.createElement("canvas");
    R.offscreenCanvas.width = img.naturalWidth;
    R.offscreenCanvas.height = img.naturalHeight;
    R.offscreenCtx = R.offscreenCanvas.getContext("2d");

    // Bind only once
    if (canvas.dataset.bound === "1") return;
    canvas.dataset.bound = "1";

    canvas.addEventListener("pointerdown", (e) => {
      if (!R.currentTool) return;
      R.drawing = true;

      const user = getUser();
      if (!user) return;

      const { x, y } = getTrueCoords(canvas, e);

      if (!R.userCanvases[user.uid]) {
        const layer = document.createElement("canvas");
        layer.width = R.offscreenCanvas.width;
        layer.height = R.offscreenCanvas.height;
        R.userCanvases[user.uid] = layer;
      }

      const myCtx = R.userCanvases[user.uid].getContext("2d");
      myCtx.beginPath();
      myCtx.lineWidth = (R.currentTool === "erase") ? 20 : parseInt(EL.strokeSlider()?.value || "4", 10);
      myCtx.strokeStyle = R.penColor;
      myCtx.globalCompositeOperation = (R.currentTool === "erase") ? "destination-out" : "source-over";
      myCtx.moveTo(x, y);

      try { canvas.setPointerCapture(e.pointerId); } catch {}
    });

    canvas.addEventListener("pointermove", (e) => {
      if (!R.drawing || !R.currentTool) return;

      const user = getUser();
      if (!user || !R.userCanvases[user.uid]) return;

      const { x, y } = getTrueCoords(canvas, e);

      const myCtx = R.userCanvases[user.uid].getContext("2d");
      myCtx.strokeStyle = R.penColor;
      myCtx.globalCompositeOperation = (R.currentTool === "erase") ? "destination-out" : "source-over";
      myCtx.lineWidth = (R.currentTool === "erase") ? 20 : parseInt(EL.strokeSlider()?.value || "4", 10);
      myCtx.lineTo(x, y);
      myCtx.stroke();

      drawFromBuffer();
    });

    canvas.addEventListener("pointerup", async (e) => {
      if (!R.currentTool) return;
      R.drawing = false;

      const user = getUser();
      if (!user || !R.userCanvases[user.uid]) return;

      try { canvas.releasePointerCapture(e.pointerId); } catch {}

      // ✅ Only write on stroke end
      await saveUserDrawingLayer(user.uid);
      drawFromBuffer();
    });

    canvas.addEventListener("pointercancel", () => {
      R.drawing = false;
    });

    loadAllDrawings();
    listenForDrawings();
  }

  function drawFromBuffer() {
    const canvas = EL.drawingCanvas();
    const img = qs("#zoom-content img");
    if (!canvas || !img || !img.naturalWidth || !R.offscreenCanvas) return;

    const displayW = img.naturalWidth * R.zoomLevel;
    const displayH = img.naturalHeight * R.zoomLevel;

    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = `${displayW}px`;
    canvas.style.height = `${displayH}px`;
    canvas.width = Math.floor(displayW * dpr);
    canvas.height = Math.floor(displayH * dpr);

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr * R.zoomLevel, 0, 0, dpr * R.zoomLevel, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // deterministic draw order
    Object.keys(R.userCanvases).sort().forEach(uid => {
      ctx.drawImage(R.userCanvases[uid], 0, 0);
    });
  }

  async function saveUserDrawingLayer(uid) {
    const sessionId = getSessionId();
    if (!sessionId || !uid) return;

    const layer = R.userCanvases[uid];
    if (!layer) return;

    const imageData = layer.toDataURL("image/png");

    try {
      await db.collection("sessions")
        .doc(sessionId)
        .collection("drawings")
        .doc(uid)
        .set({
          imageData,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    } catch (err) {
      console.error("RFRB: saveUserDrawingLayer failed", err);
    }
  }

  function loadAllDrawings() {
    const sessionId = getSessionId();
    if (!sessionId) return;

    db.collection("sessions").doc(sessionId).collection("drawings").get()
      .then(snapshot => {
        R.userCanvases = {};
        snapshot.forEach(doc => {
          const uid = doc.id;
          const imageData = doc.data()?.imageData;
          if (!imageData || !R.offscreenCanvas) return;

          const img = new Image();
          img.onload = () => {
            const layer = document.createElement("canvas");
            layer.width = R.offscreenCanvas.width;
            layer.height = R.offscreenCanvas.height;
            layer.getContext("2d").drawImage(img, 0, 0);
            R.userCanvases[uid] = layer;
            drawFromBuffer();
          };
          img.src = imageData;
        });
      })
      .catch(err => console.error("RFRB: loadAllDrawings error", err));
  }

  function listenForDrawings() {
    const sessionId = getSessionId();
    if (!sessionId) return;

    if (R.drawingsUnsub) R.drawingsUnsub();

    R.drawingsUnsub = db.collection("sessions").doc(sessionId).collection("drawings")
      .onSnapshot(snapshot => {
        snapshot.docChanges().forEach(change => {
          const uid = change.doc.id;

          if (change.type === "removed") {
            delete R.userCanvases[uid];
            drawFromBuffer();
            return;
          }

          const imageData = change.doc.data()?.imageData;
          if (!imageData || !R.offscreenCanvas) return;

          const img = new Image();
          img.onload = () => {
            const layer = document.createElement("canvas");
            layer.width = R.offscreenCanvas.width;
            layer.height = R.offscreenCanvas.height;
            layer.getContext("2d").drawImage(img, 0, 0);
            R.userCanvases[uid] = layer;
            drawFromBuffer();
          };
          img.src = imageData;
        });
      }, err => console.error("RFRB: listenForDrawings error", err));
  }

  function setDrawingMode(mode) {
    ensureDrawingCanvasExists();
    const canvas = EL.drawingCanvas();
    const zoomContainer = EL.zoomContainer();
    if (!canvas || !zoomContainer) return;

    const penBtn = EL.penBtn();
    const eraserBtn = EL.eraserBtn();

    if (R.currentTool === mode) {
      R.currentTool = null;
      canvas.style.pointerEvents = "none";
      zoomContainer.classList.remove("no-pan");
      penBtn?.classList.remove("active-tool");
      eraserBtn?.classList.remove("active-tool");
      canvas.style.cursor = "default";
    } else {
      R.currentTool = mode;
      canvas.style.pointerEvents = "auto";
      zoomContainer.classList.add("no-pan");
      penBtn?.classList.toggle("active-tool", mode === "pen");
      eraserBtn?.classList.toggle("active-tool", mode === "erase");
      canvas.style.cursor = (mode === "pen") ? "crosshair" : "cell";
    }
  }

  function clearMyDrawings() {
    const sessionId = getSessionId();
    const user = getUser();
    if (!user || !sessionId) return;

    delete R.userCanvases[user.uid];
    drawFromBuffer();

    db.collection("sessions").doc(sessionId).collection("drawings").doc(user.uid).delete()
      .catch(err => console.error("RFRB: clearMyDrawings failed", err));
  }

  function clearAllDrawings() {
    const sessionId = getSessionId();
    if (!sessionId) return;

    db.collection("sessions").doc(sessionId).collection("drawings").get().then(snapshot => {
      const batch = db.batch();
      snapshot.forEach(doc => batch.delete(doc.ref));
      return batch.commit();
    }).then(() => {
      R.userCanvases = {};
      drawFromBuffer();
    }).catch(err => console.error("RFRB: clearAllDrawings failed", err));
  }

  /* =========================================================================
     GM Image Gallery (safe, won’t crash if markup missing)
     - If you’re not using it right now, it harmlessly no-ops.
     ========================================================================= */
  function openGMImageModal() {
    const modal = EL.gmGalleryModal();
    if (!modal) return warnOnce("gmModalMissing", "RFRB: #gm-image-gallery-modal missing.");
    modal.style.display = "flex";
    loadGMImages();
  }

  function closeGMImageModal() {
    const modal = EL.gmGalleryModal();
    if (!modal) return;
    modal.style.display = "none";
  }

  function uploadGMImage() {
    const fileInput = EL.gmUpload();
    const file = fileInput?.files?.[0];
    const sessionId = getSessionId();
    const user = getUser();

    if (!fileInput) return warnOnce("gmUploadMissing", "RFRB: #gm-image-upload missing.");
    if (!file) return alert("Please select a file first.");
    if (!user || !sessionId) return alert("User or session not found.");

    const folder = (EL.gmFolderInput()?.value || "").trim() || "Unsorted";

    const storageRef = firebase.storage().ref(`sessions/${sessionId}/gmimages/${file.name}`);
    const uploadTask = storageRef.put(file);

    uploadTask.on("state_changed", null, (error) => {
      console.error("Upload failed:", error);
      alert("Upload failed.");
    }, () => {
      uploadTask.snapshot.ref.getDownloadURL().then((downloadURL) => {
        return db.collection("sessions").doc(sessionId).collection("gmimages").add({
          name: file.name,
          url: downloadURL,
          folder,
          uploadedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      }).then(() => {
        loadGMImages();
      });
    });
  }

  function loadGMImages() {
    const gallery = EL.imageList();
    const sessionId = getSessionId();
    if (!gallery) return warnOnce("imageListMissing", "RFRB: #image-list missing (GM gallery won’t render).");
    if (!sessionId) return;

    gallery.innerHTML = "<p>Loading...</p>";

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
          wrapper.style = "display:flex;flex-direction:column;align-items:center;border:1px solid #555;padding:5px;background:#111;margin-bottom:6px;";

          const img = document.createElement("img");
          img.src = url;
          img.alt = name;
          img.style = "width:100px;height:auto;margin-bottom:5px;";

          const label = document.createElement("div");
          label.textContent = name;
          label.style = "font-size:12px;color:white;";

          const btnGroup = document.createElement("div");
          btnGroup.style = "margin-top:5px;display:flex;gap:5px;flex-wrap:wrap;";

          const toDisplay = document.createElement("button");
          toDisplay.type = "button";
          toDisplay.textContent = "display";
          toDisplay.onclick = () => {
            toggleShowAndTell();
            setTimeout(() => pushToDisplayArea(url, true), 50);
          };

          const toChat = document.createElement("button");
          toChat.type = "button";
          toChat.textContent = "Chat";
          toChat.onclick = () => pushToChat(url, name);

          const del = document.createElement("button");
          del.type = "button";
          del.textContent = "❌";
          del.onclick = () => deleteGMImage(sessionId, id, name, wrapper);

          [toDisplay, toChat, del].forEach(btn => {
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
          btnGroup.appendChild(del);

          wrapper.appendChild(img);
          wrapper.appendChild(label);
          wrapper.appendChild(btnGroup);
          content.appendChild(wrapper);
        });

        section.appendChild(header);
        section.appendChild(content);
        gallery.appendChild(section);
      });
    }).catch(err => {
      console.error("RFRB: loadGMImages failed", err);
      gallery.innerHTML = "<p>Failed to load images.</p>";
    });
  }

  function deleteGMImage(sessionId, docId, fileName, wrapper) {
    if (!confirm(`Delete image "${fileName}"?`)) return;

    const storagePath = `sessions/${sessionId}/gmimages/${fileName}`;
    const storageRef = firebase.storage().ref(storagePath);

    storageRef.delete().then(() => {
      return db.collection("sessions").doc(sessionId).collection("gmimages").doc(docId).delete();
    }).then(() => {
      wrapper?.remove();
    }).catch(err => {
      console.error("RFRB: deleteGMImage failed", err);
      alert("Failed to delete image.");
    });
  }

  /* =========================================================================
     Chat helpers (safe)
     ========================================================================= */
  function pushToChat(imageUrl, label) {
    const user = getUser();
    const sessionId = getSessionId();
    if (!user || !sessionId) return;

    const characterName = EL.playerName()?.value || user.email || "Player";

    db.collection("users").doc(user.uid).get().then(doc => {
      const color = doc.data()?.displayNameColor || "#ffffff";
      return db.collection("sessions").doc(sessionId).collection("chat").add({
        characterName,
        imageUrl,
        label: label || "",
        color,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });
    }).catch(err => console.error("RFRB: pushToChat failed", err));
  }

  function clearchat() {
    const sessionId = getSessionId();
    if (!sessionId) return alert("No session selected.");

    const chatRef = db.collection("sessions").doc(sessionId).collection("chat");
    chatRef.get().then(snapshot => {
      const batch = db.batch();
      snapshot.forEach(doc => batch.delete(doc.ref));
      return batch.commit();
    }).then(() => {
      if (EL.chatMessages()) EL.chatMessages().innerHTML = "";
      console.log("Chat cleared.");
    }).catch(err => {
      console.error("RFRB: clearchat failed", err);
      alert("Failed to clear chat.");
    });
  }

  function cleardisplay() {
    // Clear tab image
    const img = EL.tabImage();
    if (img) img.src = "";

    // Clear local tabs UI
    const tabBar = EL.tabBar();
    if (tabBar) tabBar.innerHTML = "";
    R.tabs = [];
    R.currentTabId = null;

    // Clear drawings
    R.userCanvases = {};
    drawFromBuffer();

    const sessionId = getSessionId();
    if (!sessionId) return;

    // Clear tabs subcollection if present
    db.collection("sessions").doc(sessionId).collection("tabs").get().then(snapshot => {
      const batch = db.batch();
      snapshot.forEach(doc => batch.delete(doc.ref));
      return batch.commit();
    }).catch(() => {});

    db.collection("sessions").doc(sessionId).update({
      tabOrder: [],
      currentDisplayImage: "",
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(() => {});

    console.log("Display cleared by GM");
  }

  /* =========================================================================
     Rules modal
     ========================================================================= */
  function toggleRules() {
    const modal = EL.rulesModal();
    if (!modal) return warnOnce("rulesMissing", "RFRB: #rules-modal missing.");
    modal.style.display = (modal.style.display === "block") ? "none" : "block";
  }

  /* =========================================================================
     UI bindings (only once)
     ========================================================================= */
  function bindUI() {
    // Ensure baseline inputs exist
    if (EL.skills() && EL.skills().children.length === 0) addSkill("Do anything");
    if (EL.items() && EL.items().children.length === 0) addItem("");
    if (EL.conditions() && EL.conditions().children.length === 0) addCondition("");

    // Ensure GM upload filename display
    if (EL.gmUpload()) {
      EL.gmUpload().addEventListener("change", function () {
        if (!EL.gmUploadFilename()) return;
        EL.gmUploadFilename().textContent = (this.files && this.files.length > 0) ? this.files[0].name : "";
      });
    }

    // Clear my drawings button
    if (EL.clearButton()) {
      EL.clearButton().addEventListener("click", clearMyDrawings);
    }

    // Chat enter-to-send (if sendChatMessage exists)
    if (EL.chatInput()) {
      EL.chatInput().addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          if (typeof window.sendChatMessage === "function") window.sendChatMessage();
        }
      });
    }

    // Pen color sync
    if (EL.penColor()) {
      R.penColor = EL.penColor().value || R.penColor;
      EL.penColor().addEventListener("input", () => { R.penColor = EL.penColor().value; });
      EL.penColor().addEventListener("change", () => { R.penColor = EL.penColor().value; });
    }
  }

  /* =========================================================================
     Init
     ========================================================================= */
  function init() {
    bindUI();
    bindPanZoom();
    ensureTabImageExists();
    ensureDrawingCanvasExists();
    restoreDisplayIfSessionKnown();
    setupDrawingCanvasSafe();

    console.log("✅ RFRB script loaded (robust).");
  }

  window.addEventListener("DOMContentLoaded", init);

  /* =========================================================================
     EXPORTS (this is what fixes inline onclick + login.js calls)
     ========================================================================= */

  // Character UI
  window.createSkillInput = createSkillInput; // not usually called directly, but safe
  window.addSkill = addSkill;
  window.addItem = addItem;
  window.addCondition = addCondition;

  window.adjustExp = adjustExp;
  window.adjustLuck = adjustLuck;
  window.toggleWound = toggleWound;

  window.saveData = saveData;
  window.loadData = loadData;
  window.clearData = clearData;

  // Theme + rules + panels
  window.setTheme = setTheme;
  window.toggleRules = toggleRules;

  window.openGMTools = openGMTools;
  window.toggleGMTools = toggleGMTools;

  window.toggleShowAndTell = toggleShowAndTell;
  window.toggleCharacterPanel = toggleCharacterPanel;

  // Display / tabs
  window.pushToDisplayArea = pushToDisplayArea;
  window.createNewTab = createNewTab;
  window.renderTabs = renderTabs;
  window.showTabImage = showTabImage;

  // Drawing
  window.setDrawingMode = setDrawingMode;
  window.clearMyDrawings = clearMyDrawings;
  window.clearAllDrawings = clearAllDrawings;
  window.loadAllDrawings = loadAllDrawings;

  // GM images
  window.openGMImageModal = openGMImageModal;
  window.closeGMImageModal = closeGMImageModal;
  window.uploadGMImage = uploadGMImage;
  window.loadGMImages = loadGMImages;
  window.deleteGMImage = deleteGMImage;

  // Chat helpers
  window.pushToChat = pushToChat;
  window.clearchat = clearchat;
  window.cleardisplay = cleardisplay;

  // Debug helpers
  window.applyTransform = applyTransform;
})();

