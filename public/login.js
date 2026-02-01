// =====================
// login.js (CLEANED + FIXED)
// =====================

let selectedSessionId = null;
let currentUserRole = null;
let currentSessionId = null;
let latestDisplayImage = null;

// --- Helpers ---
function getSessionId() {
  return (localStorage.getItem("currentSessionId") || "").trim();
}

function setSessionId(sessionId) {
  selectedSessionId = sessionId;
  currentSessionId = sessionId;
  localStorage.setItem("currentSessionId", sessionId);
}

function show(elId, display = "flex") {
  const el = document.getElementById(elId);
  if (el) el.style.display = display;
}

function hide(elId) {
  const el = document.getElementById(elId);
  if (el) el.style.display = "none";
}

// =====================
// Auth
// =====================

function login() {
  const email = document.getElementById("authEmail")?.value || "";
  const password = document.getElementById("authPassword")?.value || "";

  auth.signInWithEmailAndPassword(email, password)
    .then(() => {
      console.log("✅ Logged in");
      alert("Login successful!");
    })
    .catch((error) => {
      console.error("Login Error:", error);
      const loginError = document.getElementById("loginError");
      if (loginError) loginError.textContent = "Login failed: " + error.message;
    });
}

function signup() {
  const email = document.getElementById("authEmail")?.value || "";
  const password = document.getElementById("authPassword")?.value || "";

  firebase.auth().createUserWithEmailAndPassword(email, password)
    .then(() => {
      showUsernameModal();
    })
    .catch((error) => {
      console.error("Signup error:", error);
      alert(error.message);
    });
}

function logout() {
  auth.signOut().then(() => alert("Logged out successfully!"));
  localStorage.removeItem("autoSaveCharacterName");
  localStorage.removeItem("autoSaveInitialized");
  localStorage.removeItem("currentSessionId");
  selectedSessionId = null;
  currentSessionId = null;
}

auth.onAuthStateChanged((user) => {
  // Always reset screens
  show("login-screen", user ? "none" : "flex");
  hide("session-screen");
  hide("create-session-screen");
  hide("app-content");

  if (!user) return;

  // Check if user has username set
  db.collection("users").doc(user.uid).get().then((doc) => {
    if (doc.exists && doc.data()?.username) {
      loadSessionsForUser(user.uid);
    } else {
      showUsernameModal();
    }
  }).catch((err) => {
    console.error("Failed to check username:", err);
  });
});

// =====================
// Username Modal
// =====================

function showUsernameModal() {
  show("username-modal", "flex");
}

function submitUsername() {
  let username = document.getElementById("usernameInput")?.value?.trim() || "";
  const user = firebase.auth().currentUser;

  if (!username || !user) {
    alert("Please enter a username.");
    return;
  }

  const normalized = username.toLowerCase();

  db.collection("users")
    .where("normalizedUsername", "==", normalized)
    .get()
    .then((querySnapshot) => {
      if (!querySnapshot.empty) {
        alert("❌ Username is already taken (case-insensitive). Try another.");
        return null;
      }

      return db.collection("users").doc(user.uid).set({
        email: user.email,
        username: username,
        normalizedUsername: normalized,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    })
    .then((res) => {
      if (!res) return;

      const status = document.getElementById("username-status");
      if (status) {
        status.textContent = "✅ Username saved!";
        status.style.display = "block";
      }

      const saveBtn = document.getElementById("saveUsernameBtn");
      if (saveBtn) saveBtn.style.display = "none";

      const input = document.getElementById("usernameInput");
      if (input) input.disabled = true;

      const nextBtn = document.getElementById("nextButton");
      if (nextBtn) nextBtn.style.display = "inline-block";
    })
    .catch((error) => {
      console.error("Error checking/saving username:", error);
      alert("An error occurred. Please try again.");
    });
}

document.addEventListener("DOMContentLoaded", () => {
  const saveBtn = document.getElementById("saveUsernameBtn");
  if (saveBtn) saveBtn.addEventListener("click", submitUsername);

  const nextBtn = document.getElementById("nextButton");
  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      hide("username-modal");
      const user = auth.currentUser;
      if (user) loadSessionsForUser(user.uid);
    });
  }
});

// =====================
// Sessions
// =====================

function loadSessionsForUser(uid) {
  const userEmail = auth.currentUser?.email;
  if (!userEmail) return;

  db.collection("sessions").get()
    .then((querySnapshot) => {
      const sessionListDiv = document.getElementById("session-list");
      if (!sessionListDiv) return;

      sessionListDiv.innerHTML = "";

      querySnapshot.forEach((doc) => {
        const data = doc.data();
        const invited = (data.invitedUserEmails || []).includes(userEmail);
        const isGM = data.creatorUid === uid;

        if (!isGM && !invited) return;

        const row = document.createElement("div");
        row.style.marginBottom = "10px";

        const joinBtn = document.createElement("button");
        joinBtn.textContent = data.sessionName;
        joinBtn.onclick = () => selectSession(doc.id);
        row.appendChild(joinBtn);

        if (isGM) {
          const deleteBtn = document.createElement("button");
          deleteBtn.textContent = "❌ Delete";
          deleteBtn.style.marginLeft = "10px";
          deleteBtn.onclick = () => deleteSession(doc.id);
          row.appendChild(deleteBtn);
        }

        sessionListDiv.appendChild(row);
      });

      const sessionError = document.getElementById("sessionError");
      if (sessionError) {
        sessionError.textContent = sessionListDiv.innerHTML ? "" : "You're not invited to any sessions.";
      }

      show("session-screen", "flex");
    })
    .catch((err) => {
      console.error("Failed to load sessions:", err);
      show("session-screen", "flex");
      const sessionError = document.getElementById("sessionError");
      if (sessionError) sessionError.textContent = "Failed to load sessions.";
    });
}

function selectSession(sessionId) {
  setSessionId(sessionId);

  // Hide session UI, show app UI
  hide("session-screen");
  show("app-content", "flex");

  // Determine role + toggle GM tools button
  db.collection("sessions").doc(sessionId).get().then((doc) => {
    const data = doc.data();
    const user = auth.currentUser;
    if (!data || !user) return;

    const gmBtn = document.getElementById("gm-tools-button");

    if (user.uid === data.creatorUid) {
      console.log("You are the GM for this session.");
      currentUserRole = "gm";
      if (gmBtn) gmBtn.style.display = "inline-block";
    } else {
      console.log("You are a player in this session.");
      currentUserRole = "player";
      if (gmBtn) gmBtn.style.display = "none";
    }

    // Ensure base UI exists
    if (document.getElementById("skills-container")?.children.length === 0) addSkill("Do anything");
    if (document.getElementById("conditions-container")?.children.length === 0) addCondition();
    if (document.getElementById("items-container")?.children.length === 0) addItem();

    // Start listeners
    setupChatListener(sessionId);
    listenForDisplayImageUpdates();

    // Character load flow
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
      const pn = document.getElementById("player-name");
      if (pn) pn.value = "";
      loadCharacterFromFirestore(); // opens modal
    }

    // Load current display image once on join
    if (data.currentDisplayImage) {
      latestDisplayImage = data.currentDisplayImage;
      if (typeof pushToDisplayArea === "function") {
        pushToDisplayArea(data.currentDisplayImage, false);
      }
    }
  }).catch((error) => {
    console.error("Error loading session info:", error);
    alert("Failed to load session info.");
  });
}

function showCreateSessionScreen() {
  hide("session-screen");
  show("create-session-screen", "flex");
}

function createSession() {
  const user = auth.currentUser;
  if (!user) return alert("You must be logged in to create a session!");

  const sessionName = document.getElementById("newSessionName")?.value?.trim() || "";
  const invitedEmails = (document.getElementById("inviteEmails")?.value || "")
    .split(",")
    .map(e => e.trim())
    .filter(Boolean);

  if (!sessionName) {
    const err = document.getElementById("createSessionError");
    if (err) err.textContent = "Session name is required.";
    return;
  }

  const sessionId = db.collection("sessions").doc().id;

  db.collection("sessions").doc(sessionId).set({
    sessionName,
    creatorUid: user.uid,
    invitedUserEmails: invitedEmails,
    roles: { [user.uid]: "gm" }
  }).then(() => {
    alert("Session created!");
    hide("create-session-screen");
    loadSessionsForUser(user.uid);
  }).catch(err => {
    console.error("Failed to create session:", err);
    const e = document.getElementById("createSessionError");
    if (e) e.textContent = "Failed to create session.";
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
        return db.collection("sessions").doc(sessionId).delete()
          .then(() => loadSessionsForUser(user.uid));
      }
    })
    .catch(err => {
      console.error("Failed to delete session:", err);
      alert("Failed to delete session.");
    });
}

function returnToSessions() {
  hide("app-content");
  show("session-screen", "flex");
}

// =====================
// Character Save/Load
// =====================

function disableCharacterInputs(disabled = true) {
  const form = document.getElementById("char-form");
  if (!form) return;

  // Disable all fields except player-name
  form.querySelectorAll("input, textarea, select").forEach(el => {
    if (el.id === "player-name") return;
    el.disabled = disabled;
  });

  // Disable dynamic checkboxes + wound buttons
  form.querySelectorAll(".skill-level, .wounds button").forEach(el => {
    el.disabled = disabled;
  });

  // Disable most buttons, BUT keep Save/Load always enabled so you can recover
  form.querySelectorAll("button").forEach(btn => {
    const onclick = (btn.getAttribute("onclick") || "");
    const isSave = onclick.includes("saveCharacterToFirestore");
    const isLoad = onclick.includes("loadCharacterFromFirestore");
    const isClear = onclick.includes("clearData"); // up to you; leaving enabled is fine
    if (isSave || isLoad || isClear) {
      btn.disabled = false;
    } else {
      btn.disabled = disabled;
    }
  });
}

function saveCharacterToFirestore() {
  const user = auth.currentUser;
  if (!user) return alert("You must be logged in to save.");

  let characterName = document.getElementById("player-name")?.value?.trim() || "";
  const savedNames = window._availableCharacterNames || [];

  if (!characterName) return alert("Character not saved (no name given).");

  if (!savedNames.includes(characterName)) {
    const confirmNew = confirm(`Save as new character "${characterName}"?`);
    if (!confirmNew) return;
  }

  const skills = Array.from(document.querySelectorAll(".skill-input")).map(input => {
    const container = input.closest(".input-wrapper");
    const checkboxes = container ? container.querySelectorAll(".skill-level") : [];
    const levels = Array.from(checkboxes).map(cb => cb.checked);
    return { name: input.value, levels };
  });

  const conditions = Array.from(document.querySelectorAll(".condition-input"))
    .map(input => input.value.trim())
    .filter(Boolean);

  const items = Array.from(document.querySelectorAll(".item-input")).map(input => input.value);

  const wounds = Array.from(document.querySelectorAll(".wounds button")).map(btn =>
    btn.classList.contains("active")
  );

  const characterData = {
    name: characterName,
    exp: parseInt(document.getElementById("exp-value")?.textContent || "0", 10) || 0,
    luck: parseInt(document.getElementById("luck-value")?.textContent || "1", 10) || 1,
    skills,
    items,
    conditions,
    wounds,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  const sessionId = getSessionId();
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
      alert(`Character '${characterName}' saved!`);

      window._lastSavedCharacterName = characterName;
      localStorage.setItem("char_for_session_" + sessionId, characterName);
      localStorage.setItem("autoSaveCharacterName", characterName);

      // Enable inputs after first real save
      disableCharacterInputs(false);

      if (!localStorage.getItem("autoSaveInitialized")) {
        setupAutoSaveListeners();
        localStorage.setItem("autoSaveInitialized", "true");
        const hint = document.getElementById("autosave-hint");
        if (hint) hint.style.display = "none";
        console.log("✅ Autosave listeners activated.");
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

  const nameField = document.getElementById("player-name")?.value?.trim() || "";
  const savedName = window._lastSavedCharacterName;

  if (!nameField || nameField !== savedName) {
    console.warn("🛑 Not autosaving — name mismatch or no character loaded.");
    return;
  }

  const characterName = nameField;

  const skills = Array.from(document.querySelectorAll(".skill-input")).map(input => {
    const container = input.closest(".input-wrapper");
    const checkboxes = container ? container.querySelectorAll(".skill-level") : [];
    const levels = Array.from(checkboxes).map(cb => cb.checked);
    return { name: input.value, levels };
  });

  const conditions = Array.from(document.querySelectorAll(".condition-input"))
    .map(input => input.value.trim())
    .filter(Boolean);

  const items = Array.from(document.querySelectorAll(".item-input")).map(input => input.value);

  const wounds = Array.from(document.querySelectorAll(".wounds button")).map(btn =>
    btn.classList.contains("active")
  );

  const characterData = {
    name: characterName,
    exp: parseInt(document.getElementById("exp-value")?.textContent || "0", 10) || 0,
    luck: parseInt(document.getElementById("luck-value")?.textContent || "1", 10) || 1,
    skills,
    items,
    conditions,
    wounds,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  const sessionId = getSessionId();

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
      if (!select) return;

      select.innerHTML = "";
      names.forEach(name => {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        select.appendChild(option);
      });

      show("loadCharacterModal", "block");
      window._availableCharacterNames = names;
    })
    .catch((error) => {
      console.error("Error loading characters list:", error);
      alert("Failed to load characters.");
    });
}

function loadCharacterByName(name) {
  const user = auth.currentUser;
  const sessionId = getSessionId();
  if (!user || !sessionId || !name) return;

  db.collection("users").doc(user.uid).collection("characters").doc(name).get()
    .then(doc => {
      const data = doc.data();
      if (!data) return alert("Character not found!");

      document.getElementById("player-name").value = data.name || "";
      document.getElementById("exp-value").textContent = data.exp ?? 0;
      document.getElementById("luck-value").textContent = data.luck ?? 1;

      const woundButtons = document.querySelectorAll(".wounds button");
      woundButtons.forEach((btn, i) => {
        btn.classList.toggle("active", (data.wounds || [])[i] || false);
      });

      document.getElementById("skills-container").innerHTML = "";
      (data.skills || []).forEach(skill => addSkill(skill));

      document.getElementById("items-container").innerHTML = "";
      (data.items || []).forEach(item => addItem(item));

      document.getElementById("conditions-container").innerHTML = "";
      (data.conditions || []).forEach(cond => {
        addCondition(typeof cond === "string" ? cond : cond.name);
      });

      // Autosave state
      localStorage.setItem("autoSaveCharacterName", name);
      window._lastSavedCharacterName = name;

      disableCharacterInputs(false);

      if (!localStorage.getItem("autoSaveInitialized")) {
        setupAutoSaveListeners();
        localStorage.setItem("autoSaveInitialized", "true");
        console.log("✅ Autosave listeners activated.");
      }
    });
}

function confirmCharacterLoad() {
  const selectedName = document.getElementById("characterSelect")?.value || "";
  const names = window._availableCharacterNames || [];

  hide("loadCharacterModal");

  if (!selectedName || !names.includes(selectedName)) {
    alert("Invalid selection.");
    return;
  }

  const user = auth.currentUser;
  if (!user) return;

  db.collection("users").doc(user.uid).collection("characters").doc(selectedName).get()
    .then((doc) => {
      const data = doc.data();
      if (!data) {
        alert("Character data missing.");
        return;
      }

      document.getElementById("player-name").value = data.name || "";
      document.getElementById("exp-value").textContent = data.exp ?? 0;
      document.getElementById("luck-value").textContent = data.luck ?? 1;

      const woundButtons = document.querySelectorAll(".wounds button");
      woundButtons.forEach((btn, i) => {
        btn.classList.toggle("active", (data.wounds || [])[i] || false);
      });

      document.getElementById("skills-container").innerHTML = "";
      (data.skills || []).forEach(skill => addSkill(skill));

      document.getElementById("items-container").innerHTML = "";
      (data.items || []).forEach(item => addItem(item));

      document.getElementById("conditions-container").innerHTML = "";
      (data.conditions || []).forEach(cond => {
        addCondition(typeof cond === "string" ? cond : cond.name);
      });

      alert(`Character '${selectedName}' loaded!`);

      // ✅ THIS WAS YOUR BUG: inputs were never re-enabled on success
      disableCharacterInputs(false);

      // Keep autosave aligned with your name-mismatch guard
      window._lastSavedCharacterName = selectedName;
      localStorage.setItem("autoSaveCharacterName", selectedName);
      localStorage.setItem("char_for_session_" + getSessionId(), selectedName);

      if (!localStorage.getItem("autoSaveInitialized")) {
        setupAutoSaveListeners();
        localStorage.setItem("autoSaveInitialized", "true");
      }
    })
    .catch((error) => {
      console.error("Error loading character:", error);
      alert("Failed to load character.");
    });
}

function promptAndCreateCharacter() {
  const name = prompt("Enter your new character's name:");
  if (!name) return;

  const user = auth.currentUser;
  const sessionId = getSessionId();
  if (!user) return;

  const emptyCharacter = {
    name: name,
    exp: 0,
    luck: 1,
    skills: [],
    items: [],
    conditions: [],
    wounds: [false, false, false, false, false],
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  const promises = [];

  if (sessionId) {
    promises.push(
      db.collection("sessions").doc(sessionId)
        .collection("characters").doc(name)
        .set(emptyCharacter)
    );
  }

  promises.push(
    db.collection("users").doc(user.uid)
      .collection("characters").doc(name)
      .set(emptyCharacter)
  );

  Promise.all(promises)
    .then(() => {
      console.log(`✅ New character '${name}' created.`);
      document.getElementById("player-name").value = name;

      localStorage.setItem("autoSaveCharacterName", name);
      localStorage.setItem("char_for_session_" + sessionId, name);
      window._lastSavedCharacterName = name;

      disableCharacterInputs(false);

      if (!localStorage.getItem("autoSaveInitialized")) {
        setupAutoSaveListeners();
        localStorage.setItem("autoSaveInitialized", "true");
        console.log("✅ Autosave listeners activated.");
      }

      hide("loadCharacterModal");
    })
    .catch((err) => {
      console.error("❌ Failed to create character:", err);
      alert("Failed to create character.");
    });
}

// =====================
// Autosave
// =====================

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
    if (!charForm) return;

    const triggerEvents = ["input", "change", "click"];

    const attach = el => {
      triggerEvents.forEach(event => el.addEventListener(event, triggerSave));
    };

    charForm.querySelectorAll("input, button, textarea, select").forEach(attach);
  };

  observeAndBind();

  const form = document.getElementById("char-form");
  if (form) {
    new MutationObserver(observeAndBind).observe(form, { childList: true, subtree: true });
  }
}

// =====================
// Show & Tell image listener
// =====================

function listenForDisplayImageUpdates() {
  const sessionId = getSessionId();
  if (!sessionId) return;

  db.collection("sessions").doc(sessionId).onSnapshot(doc => {
    const data = doc.data();
    const newImage = data?.currentDisplayImage || null;

    // If GM cleared the image
    if (!newImage) {
      latestDisplayImage = null;
      localStorage.removeItem("gmDisplayImage");
      console.log("🧼 Display image cleared by GM");
      // Let script.js handle clearing the display (it already does via pushToDisplayArea/cleardisplay)
      if (typeof pushToDisplayArea === "function") {
        // Just clear visually without writing
        pushToDisplayArea("", false);
      }
      return;
    }

    if (newImage && newImage !== latestDisplayImage) {
      latestDisplayImage = newImage;
      if (typeof pushToDisplayArea === "function") {
        pushToDisplayArea(newImage, false);
      }
    }
  });
}

// =====================
// Chat + Paste Images
// =====================

// Wire up paste handler on DOM ready
document.addEventListener("DOMContentLoaded", () => {
  const chatInput = document.getElementById("chatInput");
  if (!chatInput) return;

  chatInput.addEventListener("paste", handlePasteImage);
});

function setupChatListener(sessionId) {
  const chatPanel = document.getElementById("chat-panel");
  const chatMessages = document.getElementById("chat-messages");
  if (!chatMessages || !chatPanel) return;

  chatPanel.style.display = "flex";

  db.collection("sessions").doc(sessionId).collection("chat")
    .orderBy("timestamp")
    .onSnapshot(snapshot => {
      chatMessages.innerHTML = "";

      snapshot.forEach(doc => {
        const msg = doc.data();
        const div = document.createElement("div");

        const nameSpan = document.createElement("span");
        nameSpan.textContent = (msg.characterName || "Unknown") + ": ";
        nameSpan.style.color = msg.color || "#ffffff";
        div.appendChild(nameSpan);

        if (msg.text) {
          const textSpan = document.createElement("span");
          textSpan.textContent = msg.text;
          div.appendChild(textSpan);
        }

        if (msg.imageUrl) {
          const img = document.createElement("img");
          img.src = msg.imageUrl;
          img.style.maxWidth = "100%";
          img.style.maxHeight = "300px";
          img.style.display = "block";
          img.style.marginTop = "5px";
          div.appendChild(img);
        }

        chatMessages.appendChild(div);
      });

      chatMessages.scrollTop = chatMessages.scrollHeight;
    });
}

function sendChatMessage() {
  const input = document.getElementById("chatInput");
  if (!input) return;

  const text = input.innerText.trim();
  const imgs = Array.from(input.querySelectorAll("img"));

  if (!selectedSessionId || !auth.currentUser) {
    return alert("Must be logged in and in a session.");
  }

  if (!text && imgs.length === 0) {
    input.innerHTML = "";
    return;
  }

  const user = auth.currentUser;
  const characterName = document.getElementById("player-name")?.value || user.email || "Unknown";

  db.collection("users").doc(user.uid).get().then(userDoc => {
    const color = userDoc.data()?.displayNameColor || "#ffffff";
    const writes = [];

    if (text) {
      writes.push(
        db.collection("sessions").doc(selectedSessionId).collection("chat").add({
          characterName,
          text,
          color,
          timestamp: firebase.firestore.FieldValue.serverTimestamp()
        })
      );
    }

    imgs.forEach(img => {
      writes.push(
        db.collection("sessions").doc(selectedSessionId).collection("chat").add({
          characterName,
          imageUrl: img.src,
          color,
          timestamp: firebase.firestore.FieldValue.serverTimestamp()
        })
      );
    });

    return Promise.all(writes);
  }).then(() => {
    input.innerHTML = "";
  }).catch(err => {
    console.error("Failed to send chat message:", err);
    alert("Failed to send chat message.");
  });
}

function handlePasteImage(event) {
  const items = (event.clipboardData || event.originalEvent.clipboardData)?.items || [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type.startsWith("image/")) {
      // ✅ IMPORTANT: stop browser pasting the raw blob
      event.preventDefault();

      const file = item.getAsFile();
      if (!file) return;

      const path = `chatImages/${Date.now()}_${file.name}`;
      const storageRef = storage.ref(path);

      storageRef.put(file)
        .then(snapshot => snapshot.ref.getDownloadURL())
        .then(url => {
          const user = auth.currentUser;
          if (!user || !selectedSessionId) return;

          const characterName = document.getElementById("player-name")?.value || user.email || "Unknown";

          return db.collection("sessions")
            .doc(selectedSessionId)
            .collection("chat")
            .add({
              characterName,
              imageUrl: url,
              timestamp: firebase.firestore.FieldValue.serverTimestamp(),
              color: "#ffffff"
            });
        })
        .catch(err => {
          console.error("🔥 upload or Firestore write failed", err);
          alert("Failed to upload image.");
        });

      return; // only handle first image
    }
  }
}

function saveChatColor() {
  const user = auth.currentUser;
  if (!user) return;

  const picker = document.getElementById("chatColorPicker");
  const color = picker ? picker.value : "#ffffff";

  db.collection("users").doc(user.uid).set({ displayNameColor: color }, { merge: true });
}

function rollD6(count) {
  const user = auth.currentUser;
  if (!user || !selectedSessionId) return alert("You must be in a session and logged in.");

  const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * 6) + 1);
  const characterName = document.getElementById("player-name")?.value || user.email || "Unknown";

  db.collection("users").doc(user.uid).get().then(doc => {
    const color = doc.data()?.displayNameColor || "#ffffff";
    return db.collection("sessions").doc(selectedSessionId).collection("chat").add({
      characterName,
      text: `${count}🎲 ${rolls.join(", ")}`,
      color,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
  });
}
