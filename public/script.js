/* =========================================================================
   Roll 4 Rocket Boots - script.js (double-load safe)
   Everything lives under window.RFRB to prevent redeclare crashes.
   ========================================================================= */

/* global firebase, db, auth */

(function () {
  // Create a single shared namespace
  const R = (window.RFRB = window.RFRB || {});

  // If already initialized, do not re-bind handlers again
  if (R.__initialized) {
    console.warn("RFRB script already initialized; skipping re-init.");
    return;
  }
  R.__initialized = true;

  /* -----------------------------
     Shared State (lives on R)
  ----------------------------- */
  R.zoomLevel = parseFloat(localStorage.getItem("zoomLevel")) || 1;
  R.panX = parseFloat(localStorage.getItem("panX")) || 0;
  R.panY = parseFloat(localStorage.getItem("panY")) || 0;

  R.isPanning = false;
  R.startX = 0;
  R.startY = 0;

  R.latestDisplayImage = R.latestDisplayImage ?? null;
  R.currentTabId = R.currentTabId ?? null;

  R.currentTool = R.currentTool ?? null; // 'pen' | 'erase' | null
  R.penColor = R.penColor ?? "#ff0000";
  R.drawing = false;

  R.offscreenCanvas = R.offscreenCanvas ?? null;
  R.offscreenCtx = R.offscreenCtx ?? null;

  R.userCanvases = R.userCanvases ?? {}; // uid => canvas
  R.drawingsUnsub = R.drawingsUnsub ?? null;

  R.gmModeActive = R.gmModeActive ?? false;
  R.gmPanelUnsubscribes = R.gmPanelUnsubscribes ?? [];

  /* -----------------------------
     Helpers
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

    gmToolsPanel: () => document.getElementById("gm-tools-panel"),
    gmModePanel: () => document.getElementById("gm-mode-panel"),
    gmModeToggle: () => document.getElementById("gm-mode-toggle"),
    gmCharPanels: () => document.getElementById("gm-character-panels"),

    tabBar: () => document.getElementById("tab-bar"),
    rulesModal: () => document.getElementById("rules-modal"),
    themeLink: () => document.getElementById("theme-link"),
  };

  /* =========================================================================
     Character sheet data + autosave
     ========================================================================= */
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

    // ✅ Correct conditions serialization
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

  function silentAutoSaveCharacter() {
    try {
      localStorage.setItem("rfrbCharacterDraft", JSON.stringify(buildCharacterDataFromDOM()));
    } catch {}
  }

  /* =========================================================================
     Skills / Items / Conditions UI
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

    rollButton.addEventListener("click", async () => {
      const skillName = input.value.trim() || "Unnamed Skill";
      const allChecks = checkboxes.querySelectorAll(".skill-level");

      let diceCount = 0;
      allChecks.forEach((cb, idx) => { if (cb.checked) diceCount = idx + 2; });
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
        console.error("Failed to send roll:", err);
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

  function toggleRules() {
    const modal = EL.rulesModal();
    if (!modal) return;
    modal.style.display = (modal.style.display === "block") ? "none" : "block";
  }

  /* =========================================================================
     Pan/Zoom
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
      if (e.target.closest("button, input, textarea, select, label, a")) return; // ✅ don't steal UI clicks
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
     Drawing (safe, sync on pointerup)
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
    canvas.style.pointerEvents = "none"; // ✅ default: don't block UI
    container.appendChild(canvas);
  }

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
      y: (e.clientY - rect.top) / R.zoomLevel,
    };
  }

  function setupDrawingCanvas() {
    const canvas = EL.drawingCanvas();
    const img = qs("#zoom-content img");
    if (!canvas || !img) return;

    R.offscreenCanvas = document.createElement("canvas");
    R.offscreenCanvas.width = img.naturalWidth;
    R.offscreenCanvas.height = img.naturalHeight;
    R.offscreenCtx = R.offscreenCanvas.getContext("2d");

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

      await saveUserDrawingLayer(user.uid);
      drawFromBuffer();
    });

    canvas.addEventListener("pointercancel", () => { R.drawing = false; });

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
      await db.collection("sessions").doc(sessionId).collection("drawings").doc(uid).set({
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
      .catch(err => console.error("loadAllDrawings error:", err));
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
      }, err => console.error("listenForDrawings error:", err));
  }

  function setDrawingMode(mode) {
    ensureDrawingCanvasExists();

    const canvas = EL.drawingCanvas();
    const zoomContainer = EL.zoomContainer();
    const penBtn = EL.penBtn();
    const eraseBtn = EL.eraseBtn();
    if (!canvas || !zoomContainer) return;

    if (R.currentTool === mode) {
      R.currentTool = null;
      canvas.style.pointerEvents = "none";
      zoomContainer.classList.remove("no-pan");
      penBtn?.classList.remove("active-tool");
      eraseBtn?.classList.remove("active-tool");
      canvas.style.cursor = "default";
    } else {
      R.currentTool = mode;
      canvas.style.pointerEvents = "auto";
      zoomContainer.classList.add("no-pan");
      penBtn?.classList.toggle("active-tool", mode === "pen");
      eraseBtn?.classList.toggle("active-tool", mode === "erase");
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
      R.userCanvases = {};
      drawFromBuffer();
    });
  }

  /* =========================================================================
     Show & Tell basics (kept light)
     ========================================================================= */
  function toggleShowAndTell() {
    EL.characterPanel() && (EL.characterPanel().style.display = "none");
    EL.mainContainer() && (EL.mainContainer().style.display = "none");
    EL.showPanel() && (EL.showPanel().style.display = "block");

    ensureTabImageExists();
    ensureDrawingCanvasExists();
    setupDrawingCanvasSafe();
  }

  function toggleCharacterPanel() {
    EL.characterPanel() && (EL.characterPanel().style.display = "block");
    EL.mainContainer() && (EL.mainContainer().style.display = "block");
    EL.showPanel() && (EL.showPanel().style.display = "none");
  }

  function pushToDisplayArea(imageUrl, updateFirestore = true) {
    ensureTabImageExists();
    ensureDrawingCanvasExists();

    const img = EL.tabImage();
    if (!img) return;

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

  /* =========================================================================
     Bind UI
     ========================================================================= */
  function bindUI() {
    // Ensure default lists exist
    if (EL.skills() && EL.skills().children.length === 0) addSkill("Do anything");
    if (EL.items() && EL.items().children.length === 0) addItem("");
    if (EL.conditions() && EL.conditions().children.length === 0) addCondition("");

    // Clear drawings button
    const clearBtn = EL.clearMyDrawingsBtn();
    if (clearBtn) clearBtn.addEventListener("click", clearMyDrawings);

    // Chat enter-to-send (if sendChatMessage exists)
    const chatInput = EL.chatInput();
    if (chatInput) {
      chatInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          if (typeof window.sendChatMessage === "function") window.sendChatMessage();
        }
      });
    }

    // Pen color binding
    const picker = EL.penColor();
    if (picker) {
      R.penColor = picker.value || R.penColor;
      picker.addEventListener("input", () => { R.penColor = picker.value; });
      picker.addEventListener("change", () => { R.penColor = picker.value; });
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

  function init() {
    bindUI();
    bindPanZoom();
    ensureDrawingCanvasExists();
    ensureTabImageExists();
    restoreDisplayIfSessionKnown();
    setupDrawingCanvasSafe();
    console.log("✅ Script loaded (double-load safe).");
  }

  // Start
  window.addEventListener("DOMContentLoaded", init);

  /* =========================================================================
     Export to window (so inline onclick and login.js can call them)
     ========================================================================= */
  window.addSkill = addSkill;
  window.addItem = addItem;
  window.addCondition = addCondition;

  window.adjustExp = adjustExp;
  window.adjustLuck = adjustLuck;
  window.toggleWound = toggleWound;

  window.toggleRules = toggleRules;

  window.toggleShowAndTell = toggleShowAndTell;
  window.toggleCharacterPanel = toggleCharacterPanel;
  window.pushToDisplayArea = pushToDisplayArea;

  window.setDrawingMode = setDrawingMode;
  window.clearMyDrawings = clearMyDrawings;
  window.clearAllDrawings = clearAllDrawings;

  // Useful for debugging
  window.applyTransform = applyTransform;
  window.RFRB = R;
})();
