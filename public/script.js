let gmUnsubscribe = null;

function getActiveSessionId() {
  return (localStorage.getItem("currentSessionId") || "").trim();
}

function requireSessionId() {
  const id = getActiveSessionId();
  if (!id) {
    console.warn("❌ Missing currentSessionId in localStorage; refusing Firestore .doc() call.");
  }
  return id;
}


function createSkillInput(value = "", levels = [true, false, false, false]) {
  const container = document.createElement('div');
  container.className = 'input-wrapper';

  const checkboxes = document.createElement('div');
  checkboxes.className = 'skill-levels';

  let anyChecked = levels.includes(true);

  for (let i = 1; i <= 4; i++) {
    const label = document.createElement('label');
    label.className = 'level-label';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'skill-level';
    checkbox.dataset.level = i;

    checkbox.checked = anyChecked ? levels[i - 1] : i === 1;

    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        const all = checkboxes.querySelectorAll('.skill-level');
        all.forEach(cb => {
          if (cb !== checkbox) cb.checked = false;
        });
      }
    });

    label.appendChild(checkbox);
    label.appendChild(document.createTextNode((i + 1) + "🎲"));
    checkboxes.appendChild(label);
  }

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'skill-input';
  input.placeholder = 'New skill...';
  input.value = value;
  input.maxLength = 20;

  const rollButton = document.createElement('button');
  rollButton.type = 'button';
  rollButton.textContent = '🎲';
  rollButton.style.marginTop = '4px';
  rollButton.onclick = () => {
    const skillName = input.value.trim() || "Unnamed Skill";
    const allChecks = checkboxes.querySelectorAll('.skill-level');
    let diceCount = 0;
    allChecks.forEach((cb, idx) => {
      if (cb.checked) diceCount = idx + 2;
    });

    if (diceCount === 0) {
      alert("No dice level selected.");
      return;
    }

    const rolls = Array.from({ length: diceCount }, () => Math.floor(Math.random() * 6) + 1);
    const total = rolls.reduce((a, b) => a + b, 0);
    const characterName = document.getElementById("player-name").value || "Unknown";

    const sessionId = localStorage.getItem("currentSessionId");
    const user = firebase.auth().currentUser;

    if (!sessionId || !user) {
      alert("You must be logged in and in a session.");
      return;
    }

    db.collection("users").doc(user.uid).get().then(doc => {
      const color = doc.data()?.displayNameColor || "#ffffff";
      db.collection("sessions").doc(sessionId).collection("chat").add({
        characterName,
        text: `${characterName}: ${skillName}: [${rolls.join(", ")}] = ${total}`,
        color,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
  };

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.textContent = '✕';
  deleteButton.className = 'delete-button';
  deleteButton.onclick = () => container.remove();

  container.appendChild(checkboxes);
  container.appendChild(input);
  container.appendChild(rollButton);
  container.appendChild(deleteButton);

  return container;
}

function addSkill(value = "", levels = [true, false, false, false]) {
  if (typeof value === 'object') {
    levels = value.levels || [true, false, false, false];
    value = value.name || "";
  }
  const container = document.getElementById('skills-container');
  container.appendChild(createSkillInput(value, levels));
}

function createItemInput(value = "") {
  const div = document.createElement('div');
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
  const container = document.getElementById('items-container');
  container.appendChild(createItemInput(value));
}
function addCondition(value = "") {
  const container = document.getElementById('conditions-container');
  const div = document.createElement('div');
  div.className = "input-wrapper";

  const input = document.createElement('input');
  input.type = "text";
  input.className = "condition-input";
  input.placeholder = "Enter condition";
  input.maxLength = 20;
  input.value = typeof value === 'object' ? value.name : value;

  const delButton = document.createElement('button');
  delButton.className = "delete-button";
  delButton.textContent = "✕";
  delButton.onclick = () => div.remove();

  div.appendChild(input);
  div.appendChild(delButton);
  container.appendChild(div);
}

function saveData() {
  const name = document.getElementById('char-name').value;
  const exp = parseInt(document.getElementById('exp-value').textContent);
  const luck = parseInt(document.getElementById('luck-value').textContent);
  const woundButtons = document.querySelectorAll('.wounds button');
  const wounds = Array.from(woundButtons).map(button => button.classList.contains('active'));

  const skills = Array.from(document.querySelectorAll('.input-wrapper .skill-input')).map(input => {
    const container = input.parentElement;
    const levels = Array.from(container.querySelectorAll('.skill-level')).map(cb => cb.checked);
    return { name: input.value.trim(), levels };
  }).filter(s => s.name !== "");

  const items = Array.from(document.querySelectorAll('.item-input')).map(input => input.value.trim()).filter(Boolean);

  const conditions = Array.from(document.querySelectorAll('#conditions-container .input-wrapper')).map(wrapper => ({
    name: wrapper.querySelector('.skill-input').value,
    levels: Array.from(wrapper.querySelectorAll('.skill-level')).map(cb => cb.checked)
  }));

  const data = { name, exp, luck, wounds, skills, items, conditions };
  localStorage.setItem('rfrbCharacter', JSON.stringify(data));
  alert('Character saved!');
}


function loadData() {
  const data = JSON.parse(localStorage.getItem('rfrbCharacter'));
  if (!data) return alert('No saved character!');

  document.getElementById('char-name').value = data.name || "";
  document.getElementById('exp-value').textContent = data.exp ?? 0;
  document.getElementById('luck-value').textContent = data.luck ?? 1;

  const woundButtons = document.querySelectorAll('.wounds button');
  if (data.wounds) {
    data.wounds.forEach((isActive, i) => {
      if (woundButtons[i]) {
        woundButtons[i].classList.toggle('active', isActive);
      }
    });
  }

  const skillContainer = document.getElementById('skills-container');
  skillContainer.innerHTML = '';
  data.skills?.forEach(skill => addSkill(skill.name, skill.levels));

  const itemContainer = document.getElementById('items-container');
  itemContainer.innerHTML = '';
  data.items?.forEach(item => addItem(item));

  if (data.conditions) data.conditions.forEach(name => addCondition(name));;

  alert('Character loaded!');
}

function clearData() {
  localStorage.removeItem('rfrbCharacter');
  document.getElementById('char-form').reset();
  document.getElementById('exp-value').textContent = '0';
  document.getElementById('luck-value').textContent = '1';

  document.querySelectorAll('.wounds button').forEach(btn => btn.classList.remove('active'));

  document.getElementById('skills-container').innerHTML = '';
  addSkill('Do anything');

  document.getElementById('items-container').innerHTML = '';
  document.getElementById('conditions-container').innerHTML = '';

  alert('Character cleared.');
}

function adjustExp(amount) {
  const expSpan = document.getElementById('exp-value');
  let current = parseInt(expSpan.textContent);
  current += amount;
  if (current < 0) current = 0;
  expSpan.textContent = current;
  silentAutoSaveCharacter();
}

function adjustLuck(amount) {
  const luckSpan = document.getElementById('luck-value');
  let current = parseInt(luckSpan.textContent);
  current += amount;
  if (current < 0) current = 0;
  luckSpan.textContent = current;
  silentAutoSaveCharacter();
}
 
function toggleWound(index) {
  const woundButtons = document.querySelectorAll('.wounds button');
  if (woundButtons[index]) {
    woundButtons[index].classList.toggle('active');
  }
}

function toggleRules() {
  const modal = document.getElementById('rules-modal');
  if (modal.style.display === "block") {
    modal.style.display = "none";
  } else {
    modal.style.display = "block";
  }
}

function setTheme(theme) {
  const link = document.querySelector('link[rel="stylesheet"]');
  if (theme === 'dark') {
    link.href = 'style-dark.css';
  } else if (theme === 'lava') {
    link.href = 'style-lava.css';
  } else if (theme === 'forest') {
    link.href = 'style-forest.css';
  } else if (theme === 'ocean') {
    link.href = 'style-ocean.css';
  } else if (theme === 'sky') {
    link.href = 'style-sky.css';
  } else {
    link.href = 'style-default.css';
  }
}

// === Auto-Save and Load ===

function loadFormState() {
  const saved = localStorage.getItem("formState");
  if (!saved) return;
  const data = JSON.parse(saved);
  Object.keys(data).forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      if (el.type === "checkbox") {
        el.checked = data[id];
      } else if (el.type === "file") {
        // ❌ Skip setting file inputs like image upload
        return;
      } else {
        el.value = data[id];
      }
    }
  });

  if (data["theme"]) {
    const themeLink = document.getElementById("theme-link");
    if (themeLink) {
      themeLink.setAttribute("href", data["theme"]);
    }
  }
}

function saveFormState() {
  const elements = document.querySelectorAll("input, textarea, select");
  const data = {};
  elements.forEach(el => {
    if (el.type === "file") return; // ❌ Skip file inputs
    if (el.type === "checkbox") {
      data[el.id] = el.checked;
    } else {
      data[el.id] = el.value;
    }
  });
  data["theme"] = document.getElementById("theme-link")?.getAttribute("href");
  localStorage.setItem("formState", JSON.stringify(data));
}


window.addEventListener("load", () => {
    loadFormState();
    document.querySelectorAll("input, textarea, select").forEach(el => {
        el.addEventListener("input", saveFormState);
        el.addEventListener("change", saveFormState);
    });

    const themeButtons = document.querySelectorAll("button[data-theme]");
    themeButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            const themeHref = btn.getAttribute("data-theme");
            const themeLink = document.getElementById("theme-link");
            if (themeLink && themeHref) {
                themeLink.setAttribute("href", themeHref);
                saveFormState();
            }
        });
    });
});

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('skills-container').children.length === 0) {
    addSkill('Do anything');
  }
  if (document.getElementById('items-container').children.length === 0) {
    addItem();
  }
  if (document.getElementById('conditions-container').children.length === 0) {
    addCondition();
  }

  const savedImageUrl = localStorage.getItem("gmDisplayImage");

  // ✅ PATCH: don't call .doc("") if sessionId isn't ready
  const sid = (localStorage.getItem("currentSessionId") || "").trim();
  if (!sid) {
    console.warn("⚠️ No currentSessionId yet — skipping display restore.");
    return;
  }

  // 🔒 Only restore if Firestore still has a valid image
  db.collection("sessions").doc(sid).get().then(doc => {
    if (doc.exists && doc.data()?.currentDisplayImage) {
      pushToDisplayArea(doc.data().currentDisplayImage, false);
    } else {
      localStorage.removeItem("gmDisplayImage");
    }
  }).catch(err => {
    console.error("❌ Failed to restore display image:", err);
  });
});

function applyTransform() {
  const zoomContent = document.getElementById("zoom-content");
  const img = zoomContent?.querySelector("img");

  if (!zoomContent || !img) return;

  // Apply pan
  zoomContent.style.left = `${panX}px`;
  zoomContent.style.top = `${panY}px`;

  // Apply zoom by resizing the image (keep overlay elements aligned via the same container transform)
  const displayWidth = img.naturalWidth * zoomLevel;
  const displayHeight = img.naturalHeight * zoomLevel;

  img.style.width = `${displayWidth}px`;
  img.style.height = `${displayHeight}px`;
}

function toggleShowAndTell() {
  document.getElementById("character-panel").style.display = "none";
  document.getElementById("main-container").style.display = "none";
  document.getElementById("show-panel").style.display = "block";

  // Ensure an image element exists in the zoom-content container for tab display
  ensureTabImageExists();

  const container = document.getElementById("zoom-content");
  if (container && latestDisplayImage) {
    pushToDisplayArea(latestDisplayImage, false);
  }

  // Keep the Show & Tell image in sync with GM pushes / session state
  listenForDisplayImageUpdates();
}

  function toggleCharacterPanel() {
  document.getElementById("character-panel").style.display = "block";
  document.getElementById("main-container").style.display = "block";
  document.getElementById("show-panel").style.display = "none";
}

function toggleGMTools() {
  const panel = document.getElementById("gm-tools-panel");
  panel.style.display = (panel.style.display === "none" || !panel.style.display) ? "block" : "none";
}

function openGMTools() {
  document.getElementById("gm-tools-panel").style.display = "block";
}

function uploadGMImage() {
  const fileInput = document.getElementById("gm-image-upload");
  const file = fileInput.files[0];
  const status = document.getElementById("upload-status");

  if (!file) {
    status.textContent = "Please select a file first.";
    return;
  }

  const user = firebase.auth().currentUser;
  const sessionId = localStorage.getItem("currentSessionId"); // already used in your app

  if (!user || !sessionId) {
    status.textContent = "User or session not found.";
    return;
  }

  const storageRef = firebase.storage().ref(`sessions/${sessionId}/gmimages/${file.name}`);
  const uploadTask = storageRef.put(file);

  status.textContent = "Uploading...";

  uploadTask.on(
    "state_changed",
    null,
    (error) => {
      console.error("Upload failed:", error);
      status.textContent = "Upload failed.";
    },
    () => {
      uploadTask.snapshot.ref.getDownloadURL().then((downloadURL) => {
        status.textContent = "✅ Upload complete!";
        console.log("File available at", downloadURL);
const folder = document.getElementById("gm-folder-input").value.trim() || "Unsorted";

firebase.firestore()
  .collection("sessions")
  .doc(sessionId)
  .collection("gmimages")
  .add({
    name: file.name,
    url: downloadURL,
    folder,
    uploadedAt: firebase.firestore.FieldValue.serverTimestamp()
  })
  .then(() => {
    loadGMImages(); // refresh display
        });
    });
  }
);
}

function loadGMImages() {
  const gallery = document.getElementById("image-list");
  gallery.innerHTML = "<p>Loading...</p>";

  const sessionId = localStorage.getItem("currentSessionId");

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

  // Create folder header (clickable)
  const header = document.createElement("h3");
  header.style.color = "white";
  header.style.cursor = "pointer";
  header.textContent = `📁 ${folderName}`;
  
  // Create a collapsible content container
  const content = document.createElement("div");
  content.style.display = "none"; // collapsed by default
  content.style.marginLeft = "10px";

  header.addEventListener("click", () => {
    content.style.display = content.style.display === "none" ? "block" : "none";
  });

  images.forEach(({ name, url, id }) => {
    const wrapper = document.createElement("div");
    wrapper.style = "display: flex; flex-direction: column; align-items: center; border: 1px solid #555; padding: 5px; background: #111; margin-bottom: 6px;";

    const img = document.createElement("img");
    img.src = url;
    img.alt = name;
    img.style = "width: 100px; height: auto; margin-bottom: 5px;";

    const label = document.createElement("div");
    label.textContent = name;
    label.style = "font-size: 12px; color: white;";

    const btnGroup = document.createElement("div");
    btnGroup.style = "margin-top: 5px; display: flex; gap: 5px; flex-wrap: wrap;";

    const toDisplay = document.createElement("button");
    toDisplay.textContent = "display";
    toDisplay.onclick = () => {
  toggleShowAndTell(); // Show & Tell panel must be visible
  setTimeout(() => {
     ensureTabImageExists();
    pushToDisplayArea(url);
  }, 100); // Wait briefly to ensure DOM is ready
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

 function resizeCanvasSmart() {
  applyTransform();
}

function renderTabs(tabs, activeTabId) {
  const tabBar = document.getElementById("tab-bar");
  tabBar.innerHTML = "";

  tabs.forEach(tab => {
    const btn = document.createElement("button");
    btn.textContent = tab.title;
    btn.classList.add("tab-button");
    if (tab.id === activeTabId) btn.classList.add("active");

    btn.addEventListener("click", () => {
      currentTabId = tab.id;
      showTabImage(tab.imageUrl);
      renderTabs(tabs, tab.id); // Re-render to update active state
    });

    tabBar.appendChild(btn);
  });
}

function showTabImage(url) {
  const img = document.getElementById("tab-image");
  if (img) {
    img.src = url || "";
  } else {
    console.warn("⚠️ Tried to show image, but #tab-image is missing.");
  }
}

 function ensureTabImageExists() {
  const container = document.getElementById("zoom-content");
  if (!document.getElementById("tab-image") && container) {
    const img = document.createElement("img");
    img.id = "tab-image";
    img.style.position = "absolute";
    img.style.top = "0";
    img.style.left = "0";
    img.style.maxWidth = "none";
    img.draggable = false;
    container.appendChild(img);
  }
}


function pushToDisplayArea(imageUrl, updateFirestore = true) {
  const tabBar = document.getElementById("tab-bar");
  const tabButtons = tabBar?.children || [];
  ensureTabImageExists();

  // If no tabs exist, prompt to create one and stop here
  if (tabButtons.length === 0) {
    const newTabName = prompt("No tabs exist. Enter a name for the new tab:");
    if (!newTabName) return;

    createNewTab(newTabName, imageUrl, updateFirestore);
    return;
  }

  // Show image in current display
  const img = document.getElementById("tab-image");
  if (img) {
    img.src = imageUrl;

    img.onload = () => {
      const containerBox = document.getElementById("zoom-container").getBoundingClientRect();
      const scaleX = containerBox.width / img.naturalWidth;
      const scaleY = containerBox.height / img.naturalHeight;
      const initialScale = Math.min(scaleX, scaleY);
      zoomLevel = initialScale;

      panX = (containerBox.width - img.naturalWidth * initialScale) / 2;
      panY = (containerBox.height - img.naturalHeight * initialScale) / 2;

      applyTransform();
    };
  } else {
    console.warn("⚠️ tab-image not found.");
  }

  localStorage.setItem("gmDisplayImage", imageUrl);

  if (typeof window.resizeCanvasSmart === "function") {
    window.resizeCanvasSmart();
  }

  if (updateFirestore) {
    const sessionId = localStorage.getItem("currentSessionId");
    if (sessionId) {
      db.collection("sessions").doc(sessionId).update({
        currentDisplayImage: imageUrl,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
  }
}


function createNewTab(name, imageUrl, updateFirestore = true) {
  const tabBar = document.getElementById("tab-bar");

  const button = document.createElement("button");
  button.textContent = name;
  button.onclick = () => showTabImage(imageUrl);
  tabBar.appendChild(button);

  showTabImage(imageUrl); // immediately show the image

  if (updateFirestore) {
    const sessionId = localStorage.getItem("currentSessionId");
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

function openGMImageModal() {
  document.getElementById("gm-image-gallery-modal").style.display = "flex";
  loadGMImages();
}

function closeGMImageModal() {
  document.getElementById("gm-image-gallery-modal").style.display = "none";
}

function deleteGMImage(sessionId, docId, fileName, wrapper) {
  if (!confirm(`Delete image "${fileName}"?`)) return;
  const storagePath = `sessions/${sessionId}/gmimages/${fileName}`;
  const storageRef = firebase.storage().ref(storagePath);
  // Delete from Storage
  storageRef.delete()
    .then(() => {
      // Then delete Firestore doc
      return db.collection("sessions").doc(sessionId).collection("gmimages").doc(docId).delete();
    })
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
  // Clear the tab image visually
  const img = document.getElementById("tab-image");
  if (img) img.src = "";

  // Clear all tab buttons
  const tabBar = document.getElementById("tab-bar");
  if (tabBar) tabBar.innerHTML = "";

  // Clear local tab data
  if (window.tabs) window.tabs = [];

  // Clear tab data in Firestore
  const sessionId = localStorage.getItem("currentSessionId");
  if (sessionId) {
    const tabsRef = db.collection("sessions").doc(sessionId).collection("tabs");
    tabsRef.get().then(snapshot => {
      const batch = db.batch();
      snapshot.forEach(doc => batch.delete(doc.ref));
      return batch.commit();
    });

    db.collection("sessions").doc(sessionId).update({
      tabOrder: [],
      currentDisplayImage: "",
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }
}


function clearchat() {
  const sessionId = localStorage.getItem("currentSessionId");
  if (!sessionId) {
    alert("No session selected.");
    return;
  }

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
let gmModeActive = false;

function toggleGMMode() {
  gmModeActive = !gmModeActive;

  const characterPanel = document.getElementById("character-panel");
  const gmPanel = document.getElementById("gm-mode-panel");
  const gmButton = document.getElementById("gm-mode-toggle");
  const maincontainer = document.getElementById("main-container");

  if (gmModeActive) {
    maincontainer.style.display = "none";
    characterPanel.style.display = "none";
    gmPanel.style.display = "block";
    gmButton.textContent = "Exit GM Mode";
    loadAllGMCharacterPanels();
  } else {
    characterPanel.style.display = "block";
    gmPanel.style.display = "none";
    gmButton.textContent = "GM Mode";
    maincontainer.style.display = "block";
  }
}

let gmTabsUnsubscribe = null;

let gmPanelUnsubscribes = [];

function loadAllGMCharacterPanels() {
  const sessionId = localStorage.getItem("currentSessionId");
  if (!sessionId) return;

  // Clear any previous listeners
  gmPanelUnsubscribes.forEach(unsub => unsub());
  gmPanelUnsubscribes = [];

  const container = document.getElementById("gm-character-panels");
  container.innerHTML = "<p>Loading characters...</p>";

  db.collection("sessions").doc(sessionId).collection("characters")
    .onSnapshot(snapshot => {
      container.innerHTML = "";

      snapshot.forEach(doc => {
        const charId = doc.id;
        const panel = document.createElement("div");
        panel.id = `char-${charId}`;
        panel.style = "min-width: 250px; max-width: 300px; background: #111; color: white; border: 2px solid #555; padding: 10px;";

        panel.innerHTML = `<h3>${charId}</h3><p>Loading...</p>`;
        container.appendChild(panel);

        const unsub = db.collection("sessions").doc(sessionId).collection("characters").doc(charId)
          .onSnapshot(docSnap => {
            const data = docSnap.data();
            if (!data) return;

            const wounds = (data.wounds || []).map(active => active ? "❤️" : "🖤").join(" ");
            const skills = (data.skills || []).map(s => {
              const name = typeof s === 'string' ? s : s.name;
              const dice = typeof s === 'object' && Array.isArray(s.levels)
                ? s.levels.filter(l => l).length + 1
                : 2;
              return `• ${name} (${dice}🎲)`;
            }).join("<br>");

            const conditions = (data.conditions || []).map(c => `• ${c.name || c}`).join("<br>");
            const items = (data.items || []).map(i => `• ${i}`).join("<br>");

            panel.innerHTML = `
              <h3>${data.name || charId}</h3>
              <p><strong>EXP:</strong> ${data.exp}</p>
              <p><strong>LUCK:</strong> ${data.luck}</p>
              <p><strong>WOUNDS:</strong> ${wounds}</p>
              <p><strong>SKILLS:</strong><br>${skills}</p>
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

function viewGMCharacterLive(sessionId, charId) {
  if (gmUnsubscribe) gmUnsubscribe(); // clear previous listener

  const display = document.getElementById("gm-character-display");
  display.innerHTML = "<p>Loading...</p>";

  gmUnsubscribe = db.collection("sessions").doc(sessionId)
    .collection("characters").doc(charId)
    .onSnapshot(doc => {
      const data = doc.data();
      if (!data) {
        display.innerHTML = "<p>No data found.</p>";
        return;
      }

      display.innerHTML = `
        <h3>${data.name || charId}</h3>
        <p><strong>Exp:</strong> ${data.exp}</p>
        <p><strong>Luck:</strong> ${data.luck}</p>
        <p><strong>Wounds:</strong> ${(data.wounds || []).map(w => w ? '❤️' : '🖤').join(' ')}</p>
        <p><strong>Skills:</strong><br>${(data.skills || []).map(s => `• ${s.name} (${s.levels?.filter(l => l).length + 1}🎲)`).join("<br>")}</p>
        <p><strong>Items:</strong><br>${(data.items || []).map(i => `• ${i}`).join("<br>")}</p>
        <p><strong>Conditions:</strong><br>${(data.conditions || []).map(c => `• ${c.name}`).join("<br>")}</p>
      `;
    });
}

  let zoomLevel = parseFloat(localStorage.getItem("zoomLevel")) || 1;
  let panX = parseFloat(localStorage.getItem("panX")) || 0;
  let panY = parseFloat(localStorage.getItem("panY")) || 0;
  let isPanning = false;
  let startX = 0;
  let startY = 0;

window.addEventListener("DOMContentLoaded", () => {
  const zoomContainer = document.getElementById("zoom-container");
  const zoomContent = document.getElementById("zoom-content");

  if (!zoomContainer || !zoomContent) {
    console.warn("❌ Zoom container or content not found.");
    return;
  }

  window.applyTransform = applyTransform;

  applyTransform();

  zoomContainer.addEventListener("wheel", (e) => {
    e.preventDefault();

    const rect = zoomContainer.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;

    const zoomFactor = 0.1;
    const scaleChange = e.deltaY < 0 ? 1 + zoomFactor : 1 - zoomFactor;

    const newZoomLevel = Math.min(Math.max(zoomLevel * scaleChange, 0.01), 4);

    panX = offsetX - (offsetX - panX) * (newZoomLevel / zoomLevel);
    panY = offsetY - (offsetY - panY) * (newZoomLevel / zoomLevel);

    zoomLevel = newZoomLevel;
    applyTransform();
  });

  zoomContainer.addEventListener("mousedown", (e) => {
    isPanning = true;
    startX = e.clientX - panX;
    startY = e.clientY - panY;
    zoomContainer.style.cursor = "grabbing";
  });

  document.addEventListener("mousemove", (e) => {
    if (!isPanning) return;
    panX = e.clientX - startX;
    panY = e.clientY - startY;
    applyTransform();
  });

  document.addEventListener("mouseup", () => {
    isPanning = false;
    zoomContainer.style.cursor = "grab";
  });

  window.addEventListener("beforeunload", () => {
    localStorage.setItem("zoomLevel", zoomLevel);
    localStorage.setItem("panX", panX);
    localStorage.setItem("panY", panY);
  });
});



document.addEventListener("DOMContentLoaded", () => {
  const chatInput = document.getElementById('chatInput');
  if (chatInput) {
    chatInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    });
  }

  const gmUpload = document.getElementById("gm-image-upload");
  if (gmUpload) {
    gmUpload.addEventListener("change", function () {
      const filenameSpan = document.getElementById("gm-upload-filename");
      if (!filenameSpan) return;
      filenameSpan.textContent = (this.files && this.files.length > 0) ? this.files[0].name : "";
    });
  }
});

let currentTabId = null;





window.addSkill = addSkill;
window.addItem = addItem;
window.addCondition = addCondition;
window.pushToDisplayArea = pushToDisplayArea;
window.applyTransform = applyTransform;
console.log("✅ Script loaded.");
