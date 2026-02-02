/* =========================
   script.js (tidied)
   - Character sheet UI
   - GM Gallery + Show & Tell tabs
   - Pan/zoom image viewport (no canvas)
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

// Track whether we've “fit to view” for a given image URL (prevents snapping back constantly)
let _lastFitUrl = null;

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

  // autosave is in login.js; don’t crash if it isn’t loaded yet
  if (typeof window.silentAutoSaveCharacter === "function") {
    window.silentAutoSaveCharacter();
  }
}

function adjustLuck(amount) {
  const luckSpan = document.getElementById("luck-value");
  if (!luckSpan) return;

  let current = parseInt(luckSpan.textContent || "0", 10);
  current = Math.max(0, current + amount);
  luckSpan.textContent = current;

  if (typeof window.silentAutoSaveCharacter === "function") {
    window.silentAutoSaveCharacter();
  }
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

function toggleRules() {
  const modal = document.getElementById("rules-modal");
  if (!modal) return;
  modal.style.display = (modal.style.display === "block") ? "none" : "block";
}

function setTheme(theme) {
  const link = document.querySelector('link[rel="stylesheet"]');
  if (!link) return;

  const map = {
    dark: "style-dark.css",
    lava: "style-lava.css",
    forest: "style-forest.css",
    ocean: "style-ocean.css",
    sky: "style-sky.css",
    default: "style-default.css"
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
  // Only auto-fit when a new image is shown
  if (!imageUrl) return;
  if (_lastFitUrl === imageUrl) return;

  const area = document.getElementById("image-display-area");
  const img = document.getElementById("tab-image");
  if (!area || !img || !img.naturalWidth || !img.naturalHeight) return;

  const rect = area.getBoundingClientRect();
  const scaleX = rect.width / img.naturalWidth;
  const scaleY = rect.height / img.naturalHeight;

  zoomLevel = Math.min(scaleX, scaleY);
  panX = (rect.width - img.naturalWidth * zoomLevel) / 2;
  panY = (rect.height - img.naturalHeight * zoomLevel) / 2;

  _lastFitUrl = imageUrl;
  applyTransform();
}

function toggleShowAndTell() {
  const characterPanel = document.getElementById("character-panel");
  const main = document.getElementById("main-container");
  const show = document.getElementById("show-panel");

  if (characterPanel) characterPanel.style.display = "none";
  if (main) main.style.display = "none";
  if (show) show.style.display = "block";

  // display image updates are handled in login.js; don’t duplicate here.
}

function toggleCharacterPanel() {
  const characterPanel = document.getElementById("character-panel");
  const main = document.getElementById("main-container");
  const show = document.getElementById("show-panel");

  if (characterPanel) characterPanel.style.display = "block";
  if (main) main.style.display = "block";
  if (show) show.style.display = "none";
}

// Pan/zoom event binding
function setupPanZoom() {
  const area = document.getElementById("image-display-area");
  if (!area) return;

  area.style.cursor = "grab";

  const stopPanning = () => {
    if (!isPanning) return;
    isPanning = false;
    area.style.cursor = "grab";

    localStorage.setItem("zoomLevel", zoomLevel);
    localStorage.setItem("panX", panX);
    localStorage.setItem("panY", panY);
  };

  // ✅ Wheel zoom (non-passive so preventDefault works)
  area.addEventListener("wheel", (e) => {
    e.preventDefault();
    e.stopPropagation();

    const rect = area.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const zoomFactor = 0.12;
    const scaleChange = e.deltaY < 0 ? (1 + zoomFactor) : (1 - zoomFactor);
    const newZoom = Math.min(Math.max(zoomLevel * scaleChange, 0.1), 6);

    // ✅ Zoom around cursor in *area space*
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

  // ✅ Start pan: only left button, and prevent browser drag/select
  area.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return; // left click only
    e.preventDefault();         // stops image dragging + selection

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

  // ✅ Stop pan in more cases
  document.addEventListener("mouseup", stopPanning);
  window.addEventListener("blur", stopPanning);      // alt-tab etc.
  document.addEventListener("mouseleave", stopPanning); // leaving document
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
  img.src = url || "";
  if (url) {
    img.onload = () => fitImageToViewportIfNeeded(url);
  }
}

// Display push
function pushToDisplayArea(imageUrl, updateFirestore = true) {
  const img = document.getElementById("tab-image");
  if (!img) {
    console.warn("⚠️ tab-image not found.");
    return;
  }

  img.src = imageUrl || "";
  if (imageUrl) {
    img.onload = () => fitImageToViewportIfNeeded(imageUrl);
  } else {
    // cleared
    _lastFitUrl = null;
  }

  localStorage.setItem("gmDisplayImage", imageUrl || "");

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
  // clear local
  localStorage.removeItem("gmDisplayImage");
  _lastFitUrl = null;

  // clear image
  pushToDisplayArea("", false);

  // clear tabs UI only (Firestore clearing stays same as your old behavior)
  const tabBar = document.getElementById("tab-bar");
  if (tabBar) tabBar.innerHTML = "";

  const sessionId = getActiveSessionId();
  if (!sessionId) return;

  // delete tabs collection
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
  const maincontainer = document.getElementById("main-container");

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

// =========================
// Init
// =========================

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
