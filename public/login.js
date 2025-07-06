let selectedSessionId = null;
let currentUserRole = null;


function selectSession(sessionId) {
  selectedSessionId = sessionId;
  localStorage.setItem("currentSessionId", sessionId);


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

    document.getElementById("session-screen").style.display = "none";
    document.getElementById("app-content").style.display = "flex";

    if (document.getElementById('skills-container').children.length === 0) addSkill('Do anything');
    if (document.getElementById('conditions-container').children.length === 0) addCondition();
    if (document.getElementById('items-container').children.length === 0) addItem();

    setupChatListener(sessionId);
  }).catch((error) => {
    console.error("Error loading session info:", error);
    alert("Failed to load session info.");
  });
}

function login() {
  const email = document.getElementById("authEmail").value;
  const password = document.getElementById("authPassword").value;

  auth.signInWithEmailAndPassword(email, password)
    .then(() => alert("Login successful!"))
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

function saveCharacterToFirestore() {
  const user = auth.currentUser;
  if (!user) return alert("You must be logged in to save.");

  const characterName = prompt("Enter a name for this character:");
  if (!characterName) return alert("Character not saved (no name given).");

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
  const conditions = Array.from(document.querySelectorAll('.condition-input')).map(input => ({
    name: input.value
  }));

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

    // ✅ Store the name for autosave use
    localStorage.setItem("autoSaveCharacterName", characterName);

    // ✅ Activate autosave listeners if not already set
    if (!localStorage.getItem("autoSaveInitialized")) {
      setupAutoSaveListeners();
      localStorage.setItem("autoSaveInitialized", "true");
      console.log("✅ Autosave listeners activated.");
    }
  })
  .catch((error) => {
    console.error("Error saving character:", error);
    alert("Failed to save character.");
  });

}


function loadCharacterFromFirestore() {
  const user = auth.currentUser;
  if (!user) return alert("You must be logged in to load.");

  db.collection("users").doc(user.uid).collection("characters").get()
    .then((querySnapshot) => {
      const names = [];
      querySnapshot.forEach((doc) => names.push(doc.id));
      if (names.length === 0) return alert("No saved characters found.");

      const selectedName = prompt("Which character would you like to load?\n\n" + names.join("\n"));
      if (!selectedName || !names.includes(selectedName)) return alert("Invalid selection.");

      db.collection("users").doc(user.uid).collection("characters").doc(selectedName).get()
        .then((doc) => {
          const data = doc.data();
          document.getElementById("player-name").value = data.name || "";
          document.getElementById("exp-value").textContent = data.exp || 0;
          document.getElementById("luck-value").textContent = data.luck || 1;
          document.getElementById("skills-container").innerHTML = "";
          (data.skills || []).forEach(skill => addSkill(skill));
          document.getElementById("items-container").innerHTML = "";
          (data.items || []).forEach(item => addItem(item));
          alert("Character '" + selectedName + "' loaded!");
        });
    })
    .catch((error) => {
      console.error("Error loading characters:", error);
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
      saveCharacterToFirestore(true);
      console.log("💾 Autosave triggered");
    }, 500); // Wait 500ms after last input before saving
  };

  const elements = document.querySelectorAll(
    '#player-name, #exp-value, #luck-value, .skill-input, .item-input, .condition-input, .skill-level, .wounds button'
  );

  elements.forEach(el => {
    el.addEventListener("input", triggerSave);
    el.addEventListener("change", triggerSave);
    el.addEventListener("click", triggerSave);
  });

  // Re-attach for newly added elements
  const observer = new MutationObserver(() => setupAutoSaveListeners());
  observer.observe(document.getElementById("char-form"), { childList: true, subtree: true });
}

