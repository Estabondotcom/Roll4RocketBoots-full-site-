let selectedSessionId = null;
let currentUserRole = null;
let currentSessionId = null;
let latestDisplayImage = null;
let emojiUnsubscribe = null;

// 🔼 Near top of login.js
function preloadDisplayImage() {
  const sessionId = localStorage.getItem("currentSessionId");
  if (!sessionId) return;

  db.collection("sessions").doc(sessionId).get().then(doc => {
    if (doc.exists && doc.data()?.currentDisplayImage) {
      latestDisplayImage = doc.data().currentDisplayImage;
    }
  });
}

function selectSession(sessionId) {
  selectedSessionId = sessionId;
  currentSessionId = sessionId; 
  localStorage.setItem("currentSessionId", sessionId);
    // Load current display image immediately
  db.collection("sessions").doc(sessionId).get().then(doc => {
    const data = doc.data();
    if (data?.currentDisplayImage) {
      pushToDisplayArea(data.currentDisplayImage);
    }
  });
  
  db.collection("sessions").doc(sessionId).get().then((doc) => {
    const data = doc.data();
    const user = auth.currentUser;

    if (user.uid === data.creatorUid) {
      console.log("You are the GM for this session.");
      currentUserRole = "gm";
      document.getElementById("gm-tools-button").style.display = "inline-block";
    } else {
      console.log("You are a player in this session.");
      currentUserRole = "player";
      document.getElementById("gm-tools-button").style.display = "none";
    }
const previouslySaved = localStorage.getItem("char_for_session_" + sessionId);

if (previouslySaved) {
  console.log("🔄 Auto-loading character:", previouslySaved);
  loadCharacterByName(previouslySaved);
  disableCharacterInputs(false);
  localStorage.setItem("autoSaveCharacterName", previouslySaved);
  window._lastSavedCharacterName = previouslySaved;
} else {
  console.log("🆕 No saved character for session, prompting...");
  disableCharacterInputs(true);
  document.getElementById("player-name").value = ""; // clear autofill just in case
  loadCharacterFromFirestore(); // shows modal
}

    document.getElementById("session-screen").style.display = "none";
    document.getElementById("app-content").style.display = "flex";

    if (document.getElementById('skills-container').children.length === 0) addSkill('Do anything');
    if (document.getElementById('conditions-container').children.length === 0) addCondition();
    if (document.getElementById('items-container').children.length === 0) addItem();
  
    setupChatListener(sessionId);
    listenForEmojis();
    listenForDisplayImageUpdates();
    listenForDrawings();
    
  }).catch((error) => {
    console.error("Error loading session info:", error);
    alert("Failed to load session info.");
    
  });
}
function loadCharacterByName(name) {
  const user = auth.currentUser;
  const sessionId = localStorage.getItem("currentSessionId");
  if (!user || !sessionId || !name) return;

  db.collection("users").doc(user.uid).collection("characters").doc(name).get()
    .then(doc => {
      const data = doc.data();
      if (!data) return alert("Character not found!");

      document.getElementById("player-name").value = data.name || "";
      document.getElementById("exp-value").textContent = data.exp || 0;
      document.getElementById("luck-value").textContent = data.luck || 1;

      const woundButtons = document.querySelectorAll('.wounds button');
      woundButtons.forEach((btn, i) => {
        btn.classList.toggle('active', (data.wounds || [])[i] || false);
      });

      document.getElementById("skills-container").innerHTML = "";
      (data.skills || []).forEach(skill => addSkill(skill));

      document.getElementById("items-container").innerHTML = "";
      (data.items || []).forEach(item => addItem(item));

      document.getElementById("conditions-container").innerHTML = "";
      (data.conditions || []).forEach(cond => {
        addCondition(typeof cond === 'string' ? cond : cond.name);
      });

      // Save state
      localStorage.setItem("autoSaveCharacterName", name);
      window._lastSavedCharacterName = name;
    });
  if (!localStorage.getItem("autoSaveInitialized")) {
  setupAutoSaveListeners();
  localStorage.setItem("autoSaveInitialized", "true");
  console.log("✅ Autosave listeners activated.");
}
}
function login() {
  const email = document.getElementById("authEmail").value;
  const password = document.getElementById("authPassword").value;

 auth.signInWithEmailAndPassword(email, password)
  .then(() => {
    alert("Login successful!");
    console.log("✅ Logged in");
    preloadDisplayImage();
  })
  .catch((error) => {
    console.error("Login Error:", error);
    document.getElementById("loginError").textContent = "Login failed: " + error.message;
  });

}

function signup() {
  const email = document.getElementById("authEmail").value;
  const password = document.getElementById("authPassword").value;

  auth.createUserWithEmailAndPassword(email, password)
    .then(() => alert("Signup successful!"))
    .catch((error) => {
      console.error("Signup Error:", error);
      document.getElementById("loginError").textContent = "Signup failed: " + error.message;
    });
}

function logout() {
  auth.signOut().then(() => alert("Logged out successfully!"));
  localStorage.removeItem("autoSaveCharacterName");
localStorage.removeItem("autoSaveInitialized");

}

auth.onAuthStateChanged((user) => {
  document.getElementById("login-screen").style.display = user ? "none" : "flex";
  document.getElementById("session-screen").style.display = "none";
  document.getElementById("create-session-screen").style.display = "none";
  document.getElementById("app-content").style.display = "none";
  if (user) loadSessionsForUser(user.uid);
});

function showCreateSessionScreen() {
  document.getElementById("session-screen").style.display = "none";
  document.getElementById("create-session-screen").style.display = "flex";
}

function saveCharacterToFirestore() {
  const user = auth.currentUser;
  if (!user) return alert("You must be logged in to save.");

  let characterName = document.getElementById("player-name").value.trim();
  const savedNames = window._availableCharacterNames || [];

  if (!characterName) return alert("Character not saved (no name given).");

  // If this name doesn't exist yet, confirm creating a new save
  if (!savedNames.includes(characterName)) {
    const confirmNew = confirm(`Save as new character "${characterName}"?`);
    if (!confirmNew) return;
  }

  // Build skills array with levels
  const skills = Array.from(document.querySelectorAll('.skill-input')).map(input => {
    const container = input.closest('.input-wrapper');
    const checkboxes = container.querySelectorAll('.skill-level');
    const levels = Array.from(checkboxes).map(cb => cb.checked);
    return {
      name: input.value,
      levels
    };
  });

  // Build conditions array
 const conditions = Array.from(document.querySelectorAll('.condition-input'))
  .map(input => input.value.trim())
  .filter(Boolean);
  
  // Build items array
  const items = Array.from(document.querySelectorAll('.item-input')).map(input => input.value);

  // Build wounds array (if implemented)
  const wounds = Array.from(document.querySelectorAll('.wounds button')).map(btn =>
    btn.classList.contains('active')
  );

  // Collect character data
  const characterData = {
    name: document.getElementById("player-name").value || "",
    exp: parseInt(document.getElementById("exp-value").textContent) || 0,
    luck: parseInt(document.getElementById("luck-value").textContent) || 1,
    skills,
    items,
    conditions,
    wounds,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  const sessionId = localStorage.getItem("currentSessionId");
  const promises = [];

  if (sessionId) {
    promises.push(
      db.collection("sessions").doc(sessionId)
        .collection("characters").doc(characterName)
        .set(characterData)
    );
  }

  promises.push(
    db.collection("users").doc(user.uid)
      .collection("characters").doc(characterName)
      .set(characterData)
  );

 Promise.all(promises)
  .then(() => {
    alert(`Character '${characterName}' saved to Firestore!`);
        window._lastSavedCharacterName = characterName;
    localStorage.setItem("char_for_session_" + currentSessionId, characterName);

    // ✅ Store the name for autosave use
    localStorage.setItem("char_for_session_" + currentSessionId, characterName);

    // ✅ Activate autosave listeners if not already set
    if (!localStorage.getItem("autoSaveInitialized")) {
      setupAutoSaveListeners();
      localStorage.setItem("autoSaveInitialized", "true");
      console.log("✅ Autosave listeners activated.");
      const hint = document.getElementById("autosave-hint");
  if (hint) hint.style.display = "none";
    }
  })
  .catch((error) => {
    console.error("Error saving character:", error);
    alert("Failed to save character.");
  });

}

function silentAutoSaveCharacter() {
  const user = auth.currentUser;
  if (!user) return;

const nameField = document.getElementById("player-name").value.trim();
const savedName = window._lastSavedCharacterName;

if (!nameField || nameField !== savedName) {
  console.warn("🛑 Not autosaving — name mismatch or no character loaded.");
  return;
}

const characterName = nameField;

  // Build skills array with levels
  const skills = Array.from(document.querySelectorAll('.skill-input')).map(input => {
    const container = input.closest('.input-wrapper');
    const checkboxes = container.querySelectorAll('.skill-level');
    const levels = Array.from(checkboxes).map(cb => cb.checked);
    return {
      name: input.value,
      levels
    };
  });

  const conditions = Array.from(document.querySelectorAll('.condition-input')).map(input => ({
    name: input.value
  }));

  const items = Array.from(document.querySelectorAll('.item-input')).map(input => input.value);

  const wounds = Array.from(document.querySelectorAll('.wounds button')).map(btn =>
    btn.classList.contains('active')
  );

  const characterData = {
    name: document.getElementById("player-name").value || "",
    exp: parseInt(document.getElementById("exp-value").textContent) || 0,
    luck: parseInt(document.getElementById("luck-value").textContent) || 1,
    skills,
    items,
    conditions,
    wounds,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  const sessionId = localStorage.getItem("currentSessionId");

  if (sessionId) {
    db.collection("sessions").doc(sessionId)
      .collection("characters").doc(characterName)
      .set(characterData);
  }

  db.collection("users").doc(user.uid)
    .collection("characters").doc(characterName)
    .set(characterData);
}

function loadCharacterFromFirestore() {
  const user = auth.currentUser;
  if (!user) return alert("You must be logged in to load.");

  db.collection("users").doc(user.uid).collection("characters").get()
    .then((querySnapshot) => {
      const names = [];
      querySnapshot.forEach((doc) => names.push(doc.id));
      if (names.length === 0) return alert("No saved characters found.");

      const select = document.getElementById("characterSelect");
      select.innerHTML = "";

      names.forEach(name => {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        select.appendChild(option);
      });

      document.getElementById("loadCharacterModal").style.display = "block";
      window._availableCharacterNames = names;
    })
    .catch((error) => {
      console.error("Error loading characters list:", error);
      alert("Failed to load characters.");
    });
}

function loadSessionsForUser(uid) {
  const userEmail = auth.currentUser.email;
  db.collection("sessions").get()
    .then((querySnapshot) => {
      const sessionListDiv = document.getElementById("session-list");
      sessionListDiv.innerHTML = "";
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        if (data.creatorUid === uid || (data.invitedUserEmails || []).includes(userEmail)) {
          const div = document.createElement("div");
          const joinBtn = document.createElement("button");
          joinBtn.textContent = data.sessionName;
          joinBtn.onclick = () => selectSession(doc.id);
          div.appendChild(joinBtn);
          if (data.creatorUid === uid) {
            const deleteBtn = document.createElement("button");
            deleteBtn.textContent = "❌ Delete";
            deleteBtn.style.marginLeft = "10px";
            deleteBtn.onclick = () => deleteSession(doc.id);
            div.appendChild(deleteBtn);
          }
          sessionListDiv.appendChild(div);
        }
      });
      document.getElementById("sessionError").textContent = sessionListDiv.innerHTML ? "" : "You're not invited to any sessions.";
      document.getElementById("session-screen").style.display = "flex";
    });
}

function confirmCharacterLoad() {
  const selectedName = document.getElementById("characterSelect").value;
  const names = window._availableCharacterNames || [];
  document.getElementById("loadCharacterModal").style.display = "none";

  if (!selectedName || !names.includes(selectedName)) {
    alert("Invalid selection.");
    return;
  }

  const user = auth.currentUser;
  db.collection("users").doc(user.uid).collection("characters").doc(selectedName).get()
    .then((doc) => {
      const data = doc.data();

      document.getElementById("player-name").value = data.name || "";
      document.getElementById("exp-value").textContent = data.exp || 0;
      document.getElementById("luck-value").textContent = data.luck || 1;

      // ✅ Restore wounds
      const woundButtons = document.querySelectorAll('.wounds button');
      woundButtons.forEach((btn, i) => {
        btn.classList.toggle('active', (data.wounds || [])[i] || false);
      });

      // ✅ Restore skills
      document.getElementById("skills-container").innerHTML = "";
      (data.skills || []).forEach(skill => addSkill(skill));

      // ✅ Restore items
      document.getElementById("items-container").innerHTML = "";
      (data.items || []).forEach(item => addItem(item));

      // ✅ Restore conditions
      document.getElementById("conditions-container").innerHTML = "";
      (data.conditions || []).forEach(cond => {
        addCondition(typeof cond === 'string' ? cond : cond.name);
      });

      alert(`Character '${selectedName}' loaded!`);

      // ✅ Update autosave name
      localStorage.setItem("autoSaveCharacterName", selectedName);
    })
    .catch((error) => {
      console.error("Error loading character:", error);
      alert("Failed to load character.");
      window._lastSavedCharacterName = selectedName;
localStorage.setItem("autoSaveCharacterName", selectedName);
disableCharacterInputs(false);

    });
}

function listenForDisplayImageUpdates() {
  const display = document.getElementById("zoom-content");
  const sessionId = localStorage.getItem("currentSessionId");
  if (!display || !sessionId) return;

  // Cancel previous listener
  if (emojiUnsubscribe) emojiUnsubscribe();

  // 🔁 Listen to emoji changes
  emojiUnsubscribe = db.collection("sessions").doc(sessionId).collection("emojis")
    .onSnapshot(snapshot => {
      snapshot.docChanges().forEach(change => {
        const data = change.doc.data();
        const { id, symbol, x, y } = data;

        if (change.type === "added") {
          if (!display.querySelector(`[data-id="${id}"]`)) {
            const emoji = document.createElement("div");
            emoji.className = "draggable-emoji";
            emoji.textContent = symbol;
            emoji.dataset.id = id;
            emoji.style.left = x + "px";
            emoji.style.top = y + "px";
            makeDraggable(emoji);
            display.appendChild(emoji);
          }
        }

        if (change.type === "modified") {
          const emoji = display.querySelector(`[data-id="${id}"]`);
          if (emoji) {
            emoji.style.left = x + "px";
            emoji.style.top = y + "px";
          }
        }

        if (change.type === "removed") {
          const emoji = display.querySelector(`[data-id="${id}"]`);
          if (emoji) emoji.remove();
        }
      });
    });

 // Watch display image itself
db.collection("sessions").doc(sessionId).onSnapshot(doc => {
  const data = doc.data();
  const newImage = data?.currentDisplayImage || null;

  const container = document.getElementById("zoom-content");
  const existingImg = container.querySelector("img");

  if (!newImage && existingImg) {
    // ✅ The GM cleared the image
    existingImg.remove();
    zoomLevel = 1;
    panX = 0;
    panY = 0;
    applyTransform();

    localStorage.removeItem("gmDisplayImage");
    latestDisplayImage = null;
    console.log("🧼 Display image cleared by GM");
  }

  if (newImage && newImage !== latestDisplayImage) {
    latestDisplayImage = newImage;
    pushToDisplayArea(newImage, false);
  }
});
}

function createSession() {
  const user = auth.currentUser;
  if (!user) return alert("You must be logged in to create a session!");

  const sessionName = document.getElementById("newSessionName").value.trim();
  const invitedEmails = document.getElementById("inviteEmails").value.split(",").map(e => e.trim()).filter(e => e);
  if (!sessionName) return document.getElementById("createSessionError").textContent = "Session name is required.";

  const sessionId = db.collection("sessions").doc().id;
  db.collection("sessions").doc(sessionId).set({
    sessionName,
    creatorUid: user.uid,
    invitedUserEmails: invitedEmails,
    roles: { [user.uid]: "gm" }
  }).then(() => {
    alert("Session created!");
    document.getElementById("create-session-screen").style.display = "none";
    loadSessionsForUser(user.uid);
  });
}

function deleteSession(sessionId) {
  const user = auth.currentUser;
  if (!user) return;
  db.collection("sessions").doc(sessionId).get()
    .then((doc) => {
      if (!doc.exists) return alert("Session does not exist.");
      if (doc.data().creatorUid !== user.uid) return alert("Only the session creator can delete this session.");
      if (confirm(`Are you sure you want to delete the session "${doc.data().sessionName}"?`)) {
        db.collection("sessions").doc(sessionId).delete().then(() => loadSessionsForUser(user.uid));
      }
    });
}

function returnToSessions() {
  document.getElementById("app-content").style.display = "none";
  document.getElementById("session-screen").style.display = "flex";
}
// wire up the paste-handler as soon as the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const chatInput = document.getElementById('chatInput');
  if (!chatInput) {
    console.error('❌ chatInput element not found');
    return;
  }
  chatInput.addEventListener('paste', handlePasteImage);
});

function setupChatListener(sessionId) {
  const chatPanel = document.getElementById('chat-panel');
  const chatMessages = document.getElementById('chat-messages');
  chatPanel.style.display = 'flex';
  db.collection('sessions').doc(sessionId).collection('chat')
    .orderBy('timestamp')
    .onSnapshot(snapshot => {
      chatMessages.innerHTML = '';
      snapshot.forEach(doc => {
        const msg = doc.data();
        const div = document.createElement('div');
        const nameSpan = document.createElement('span');
        nameSpan.textContent = msg.characterName + ": ";
        nameSpan.style.color = msg.color || "#ffffff";
        div.appendChild(nameSpan);
        if (msg.text) {
          const textSpan = document.createElement('span');
          textSpan.textContent = msg.text;
          div.appendChild(textSpan);
        }
        if (msg.imageUrl) {
          const img = document.createElement('img');
          img.src = msg.imageUrl;
          img.style.maxWidth = '100%';
          img.style.maxHeight = '300px';
          img.style.display = 'block';
          img.style.marginTop = '5px';
          div.appendChild(img);
        }
        chatMessages.appendChild(div);
      });
      chatMessages.scrollTop = chatMessages.scrollHeight;
    });
}

function sendChatMessage() {
  const input = document.getElementById('chatInput');
  const text = input.innerText.trim();
  const imgs = Array.from(input.querySelectorAll('img'));
  
  if (!selectedSessionId || !auth.currentUser) {
    return alert('Must be logged in and in a session.');
  }
  // nothing to send?
  if (!text && imgs.length === 0) {
    input.innerHTML = '';
    return;
  }

  const user = auth.currentUser;
  const characterName = document.getElementById('player-name').value || user.email;

  // fetch your saved color once
  db.collection("users").doc(user.uid).get().then(userDoc => {
    const color = userDoc.data()?.displayNameColor || "#ffffff";

    // build an array of promises: one for the text message, one per image
    const writes = [];

    if (text) {
      writes.push(
        db.collection('sessions')
          .doc(selectedSessionId)
          .collection('chat')
          .add({
            characterName,
            text,
            color,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
          })
      );
    }

    imgs.forEach(img => {
      writes.push(
        db.collection('sessions')
          .doc(selectedSessionId)
          .collection('chat')
          .add({
            characterName,
            imageUrl: img.src,
            color,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
          })
      );
    });

    // once all writes finish, clear the input
    return Promise.all(writes);
  })
  .then(() => {
    input.innerHTML = '';
  })
  .catch(err => {
    console.error("Failed to send chat message:", err);
    alert("Failed to send chat message.");
  });
}


function saveChatColor() {
  const user = auth.currentUser;
  if (!user) return;
  const color = document.getElementById('chatColorPicker').value;
  db.collection("users").doc(user.uid).set({ displayNameColor: color }, { merge: true });
}

function rollD6(count) {
  const user = auth.currentUser;
  if (!user || !selectedSessionId) return alert("You must be in a session and logged in.");
  const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * 6) + 1);
  const characterName = document.getElementById('player-name').value || user.email;
  db.collection("users").doc(user.uid).get().then(doc => {
    const color = doc.data()?.displayNameColor || "#ffffff";
    db.collection('sessions').doc(selectedSessionId).collection('chat').add({
      characterName,
      text: `${count}🎲 ${rolls.join(", ")}`,
      color,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
  });
}

function handlePasteImage(event) {
  console.log('📋 paste event fired!', event);

  const items = (event.clipboardData || event.originalEvent.clipboardData).items;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type.startsWith('image/')) {
      // **1)** Stop the browser from inserting the blob itself
      

      const file = item.getAsFile();
      console.log('🖼️ got image file', file);

      // **2)** Upload to Firebase Storage
      const path = `chatImages/${Date.now()}_${file.name}`;
      const storageRef = storage.ref(path);
      storageRef.put(file)
        .then(snapshot => snapshot.ref.getDownloadURL())
        .then(url => {
          console.log('✅ got download URL', url);

          const user = auth.currentUser;
          if (!user || !selectedSessionId) {
            console.warn('🔒 no user or session, aborting');
            return;
          }

          const characterName = document.getElementById('player-name').value || user.email;

          // **3)** Send the message with imageUrl
          return db.collection('sessions')
                   .doc(selectedSessionId)
                   .collection('chat')
                   .add({
                     characterName,
                     imageUrl: url,
                     timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                     color: "#ffffff"
                   });
        })
        .then(() => console.log('📸 image message sent!'))
        .catch(err => {
          console.error('🔥 upload or Firestore write failed', err);
          alert('Failed to upload image.');
        });

      // **4)** Only handle the first image
      return;
    }
  }
}
function setupAutoSaveListeners() {
  let debounceTimer;

  const triggerSave = () => {
    if (!localStorage.getItem("autoSaveCharacterName")) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      silentAutoSaveCharacter();
      console.log("💾 Autosave triggered");
    }, 800);
  };

  const observeAndBind = () => {
    const charForm = document.getElementById("char-form");
    const triggerEvents = ["input", "change", "click"];

    const attach = el => {
      triggerEvents.forEach(event =>
        el.addEventListener(event, triggerSave)
      );
    };

    charForm.querySelectorAll("input, button, textarea, select").forEach(attach);
  };

  // First run
  observeAndBind();

  // Then re-run on DOM changes
  new MutationObserver(observeAndBind).observe(document.getElementById("char-form"), {
    childList: true,
    subtree: true
  });
}

function listenForEmojis() {
  const display = document.getElementById("zoom-content");
  if (!display) {
    console.warn("⚠️ zoom-content not found");
    return;
  }

  db.collection("sessions").doc(currentSessionId).collection("emojis")
    .onSnapshot(snapshot => {
      snapshot.docChanges().forEach(change => {
        const data = change.doc.data();
        const { id, symbol, x, y, creatorUid } = data;

        if (change.type === "added") {
          if (!display.querySelector(`[data-id="${id}"]`)) {
            const emoji = document.createElement("div");
            emoji.className = "draggable-emoji";
            emoji.dataset.id = id;
            emoji.style.left = x + "px";
            emoji.style.top = y + "px";
            emoji.style.fontSize = `${Math.max(16, 64 / (zoomLevel || 1))}px`;

            // ✅ Emoji symbol
            const symbolSpan = document.createElement("span");
            symbolSpan.textContent = symbol;
            emoji.appendChild(symbolSpan);

            // ✅ Add delete button if user created it
            const user = firebase.auth().currentUser;
            if (user && user.uid === creatorUid) {
              const delBtn = document.createElement("button");
              delBtn.textContent = "🗑";
              delBtn.className = "emoji-delete";
              delBtn.onclick = (e) => {
                e.stopPropagation();
                db.collection("sessions").doc(currentSessionId).collection("emojis").doc(id).delete();
              };
              emoji.appendChild(delBtn);
            }

            makeDraggable(emoji);
            display.appendChild(emoji);
          }
        }

        if (change.type === "modified") {
          const emoji = display.querySelector(`[data-id="${id}"]`);
          if (emoji) {
            emoji.style.left = x + "px";
            emoji.style.top = y + "px";
          }
        }

        if (change.type === "removed") {
          const emoji = display.querySelector(`[data-id="${id}"]`);
          if (emoji) emoji.remove();
        }
      });
    });
}
function listenForDrawings() {
  const sessionId = localStorage.getItem("currentSessionId");
  if (!sessionId) return;

  db.collection("sessions").doc(sessionId).collection("drawings")
    .onSnapshot(snapshot => {
      snapshot.docChanges().forEach(change => {
        if (change.type === "added" || change.type === "modified") {
          const { imageData } = change.doc.data();
          const uid = change.doc.id;

          if (imageData) {
            const img = new Image();
            img.onload = () => {
              const tempCanvas = document.createElement("canvas");
              tempCanvas.width = offscreenCanvas.width;
              tempCanvas.height = offscreenCanvas.height;
              const ctx = tempCanvas.getContext("2d");
              ctx.drawImage(img, 0, 0);
              userCanvases[uid] = tempCanvas;
              drawFromBuffer();
            };
            img.src = imageData;
          }
        }

        if (change.type === "removed") {
          const uid = change.doc.id;
          delete userCanvases[uid];
          drawFromBuffer();
        }
      });
    });
}

function disableCharacterInputs(disabled = true) {
  const selectors = [
    '#char-form input', '#char-form button', '#exp-minus', '#exp-plus',
    '#luck-minus', '#luck-plus'
  ];
  selectors.forEach(selector => {
    document.querySelectorAll(selector).forEach(el => {
      if (!el.id.includes("player-name")) el.disabled = disabled;
    });
  });
}


