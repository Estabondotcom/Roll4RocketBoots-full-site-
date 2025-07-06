let gmUnsubscribe = null;

function createSkillInput(value = "", levels = [true, false, false, false]) {
  const container = document.createElement('div');
  container.className = 'input-wrapper';

  const checkboxes = document.createElement('div');
  checkboxes.className = 'skill-levels';

  for (let i = 1; i <= 4; i++) {
    const label = document.createElement('label');
    label.className = 'level-label';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'skill-level';
    checkbox.dataset.level = i;
    checkbox.checked = levels[i - 1];

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

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '✕';
  button.className = 'delete-button';
  button.onclick = () => container.remove();

  container.appendChild(checkboxes);
  container.appendChild(input);
  container.appendChild(button);

  return container;
}

function createItemInput(value = "") {
  const container = document.createElement('div');
  container.className = 'input-wrapper';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'item-input';
  input.placeholder = 'Item...';
  input.value = value;
  input.maxLength = 20;

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '✕';
  button.className = 'delete-button';
  button.onclick = () => container.remove();

  container.appendChild(input);
  container.appendChild(button);

  return container;
}

function addSkill(value = "", levels = [true, false, false, false]) {
  const container = document.getElementById('skills-container');
  container.appendChild(createSkillInput(value, levels));
}

function addItem(value = "") {
  const container = document.getElementById('items-container');
  container.appendChild(createItemInput(value));
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
}

function adjustLuck(amount) {
  const luckSpan = document.getElementById('luck-value');
  let current = parseInt(luckSpan.textContent);
  current += amount;
  if (current < 0) current = 0;
  luckSpan.textContent = current;
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
  // You could also auto-start with a blank condition and item if you want:
  if (document.getElementById('items-container').children.length === 0) {
    addItem();
  }
  if (document.getElementById('conditions-container').children.length === 0) {
    addCondition();
  }
    // ✅ Restore display image
  const savedImageUrl = localStorage.getItem("gmDisplayImage");
  if (savedImageUrl) {
    pushToDisplayArea(savedImageUrl);
  }
});

function toggleCharacterPanel() {
  document.getElementById("character-panel").style.display = "block";
  document.getElementById("main-container").style.display = "block";
  document.getElementById("show-panel").style.display = "none";

}

function toggleShowAndTell() {
  document.getElementById("character-panel").style.display = "none";
  document.getElementById("main-container").style.display = "none";
  document.getElementById("show-panel").style.display = "block";

  
}
function openGMTools() {
  alert("🛠️ GM Tools coming soon!");
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

        // Optionally store the URL in Firestore for later use
        firebase.firestore()
          .collection("sessions")
          .doc(sessionId)
          .collection("gmimages")
          .add({
            name: file.name,
            url: downloadURL,
            uploadedAt: firebase.firestore.FieldValue.serverTimestamp()
              }).then(() => {
              loadGMImages(); // 🔁 Refresh image list in modal
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
    gallery.innerHTML = "";
    snapshot.forEach(doc => {
      const { name, url } = doc.data();
      const docId = doc.id;

      const wrapper = document.createElement("div");
      wrapper.style = "display: flex; flex-direction: column; align-items: center; border: 1px solid #555; padding: 5px; background: #111;";

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
      toDisplay.onclick = () => pushToDisplayArea(url);

      const toChat = document.createElement("button");
      toChat.textContent = "Chat";
      toChat.onclick = () => pushToChat(url, name);

      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = "❌";
      deleteBtn.onclick = () => deleteGMImage(sessionId, docId, name, wrapper);
    
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
      gallery.appendChild(wrapper);
    });
  });
}


function pushToDisplayArea(imageUrl) {
  const container = document.getElementById("image-display-area");
  container.innerHTML = ""; // optional: clear old image

  const img = document.createElement("img");
  img.src = imageUrl;
  img.style = "max-width: 100%; margin-top: 10px;";
  img.draggable = false;
  container.appendChild(img);

  // 🧠 Save locally
  localStorage.setItem("gmDisplayImage", imageUrl);

  // ✅ Save to Firestore for all players to see
  const sessionId = localStorage.getItem("currentSessionId");
  if (sessionId) {
    db.collection("sessions").doc(sessionId).update({
      currentDisplayImage: imageUrl,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }
}



function pushToChat(imageUrl, label) {
  const user = auth.currentUser;
  const characterName = document.getElementById("player-name").value || user.email;
  db.collection("users").doc(user.uid).get().then(doc => {
    const color = doc.data()?.displayNameColor || "#ffffff";
    return db.collection("sessions").doc(selectedSessionId).collection("chat").add({
      characterName,
      imageUrl,
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
  const display = document.getElementById("image-display-area");
  if (display) display.innerHTML = "";
  localStorage.removeItem("gmDisplayImage");
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
window.addEventListener("DOMContentLoaded", () => {
  const zoomContainer = document.getElementById("zoom-container");
  const zoomContent = document.getElementById("zoom-content");

  if (!zoomContainer || !zoomContent) {
    console.warn("❌ Zoom container or content not found.");
    return;
  }

  let zoomLevel = parseFloat(localStorage.getItem("zoomLevel")) || 1;
  let panX = parseFloat(localStorage.getItem("panX")) || 0;
  let panY = parseFloat(localStorage.getItem("panY")) || 0;
  let isPanning = false;
  let startX = 0;
  let startY = 0;

  function applyTransform() {
    zoomContent.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
    zoomContent.style.transformOrigin = "0 0";
  }

  applyTransform();

  zoomContainer.addEventListener("wheel", (e) => {
  e.preventDefault();

  const rect = zoomContainer.getBoundingClientRect();
  const offsetX = e.clientX - rect.left;
  const offsetY = e.clientY - rect.top;

  const zoomFactor = 0.1;
  const scaleChange = e.deltaY < 0 ? 1 + zoomFactor : 1 - zoomFactor;

  // New zoom level clamped
  const newZoomLevel = Math.min(Math.max(zoomLevel * scaleChange, 0.5), 2);

  // Calculate the zoom focus point adjustment
  panX = offsetX - (offsetX - panX) * (newZoomLevel / zoomLevel);
  panY = offsetY - (offsetY - panY) * (newZoomLevel / zoomLevel);

  zoomLevel = newZoomLevel;
  applyTransform();
});


 zoomContainer.addEventListener("mousedown", (e) => {
  // ✅ Ignore mousedown if dragging an emoji
  if (e.target.classList.contains("draggable-emoji")) return;

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
window.addSkill = addSkill;
window.addItem = addItem;
window.addCondition = addCondition;

document.addEventListener("DOMContentLoaded", () => {
  if (localStorage.getItem("autoSaveInitialized")) {
    const hint = document.getElementById("autosave-hint");
    if (hint) hint.style.display = "none";
  }
});
function spawnEmoji(symbol) {
  const display = document.getElementById("image-display-area");

  // ✅ Generate unique ID first
  const id = `emoji-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  const emoji = document.createElement("div");
  emoji.className = "draggable-emoji";
  emoji.textContent = symbol;
  emoji.dataset.id = id;
  emoji.style.left = "100px";
  emoji.style.top = "100px";
  makeDraggable(emoji);

  // ✅ Append to DOM immediately
  display.appendChild(emoji);

  // ✅ Sync to Firestore (so others get it)
  db.collection("sessions").doc(currentSessionId)
    .collection("emojis").doc(id).set({
      symbol,
      x: 100,
      y: 100,
      id,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
}
function makeDraggable(el) {
  let startX, startY, initialLeft, initialTop;

  el.onmousedown = function (e) {
    e.preventDefault();

    const zoomLevel = parseFloat(localStorage.getItem("zoomLevel")) || 1;
    const zoomContent = document.getElementById("zoom-content");
    const rect = zoomContent.getBoundingClientRect();

    // Mouse position in zoomed space
    startX = (e.clientX - rect.left) / zoomLevel;
    startY = (e.clientY - rect.top) / zoomLevel;

    // Current emoji position
    initialLeft = parseFloat(el.style.left) || 0;
    initialTop = parseFloat(el.style.top) || 0;

    document.onmousemove = function (e) {
      const currentX = (e.clientX - rect.left) / zoomLevel;
      const currentY = (e.clientY - rect.top) / zoomLevel;

      const dx = currentX - startX;
      const dy = currentY - startY;

      const newX = initialLeft + dx;
      const newY = initialTop + dy;

      el.style.left = newX + "px";
      el.style.top = newY + "px";

      const id = el.dataset.id;
      if (id) {
        db.collection("sessions").doc(currentSessionId)
          .collection("emojis").doc(id).update({ x: newX, y: newY });
      }
    };

    document.onmouseup = () => {
      document.onmousemove = null;
      document.onmouseup = null;
    };
  };
}
