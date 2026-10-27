// ============================================================================
// SLACK 1-ON-1 DIRECT CHAT — ENGLISH UI, SIMPLE LOGIN, INDEXEDDB + VERCEL SYNC
// ============================================================================

(function () {
  "use strict";

  const STORAGE_KEYS = {
    REMEMBER_UID_LOCAL: "slack_v3_remembered_uid",
    SESSION_UID_TAB: "slack_v3_session_uid",
    ACTIVE_PARTNER_ID: "slack_v3_active_partner_id",
    FALLBACK_STORE: "slack_v3_fallback_store"
  };

  const IDB_NAME = "slack_1on1_idb_v3";
  const IDB_STORE = "kv";
  const IDB_KEY = "chat_state";

  const SLACK_AVATAR_COLORS = [
    { bg: "#E01E5A", fg: "#FFFFFF" },
    { bg: "#2EB67D", fg: "#FFFFFF" },
    { bg: "#36C5F0", fg: "#1D1C1D" },
    { bg: "#ECB22E", fg: "#1D1C1D" },
    { bg: "#4A154B", fg: "#FFFFFF" },
    { bg: "#1264A3", fg: "#FFFFFF" }
  ];

  const EMOJI_LIST = [
    "👍", "❤️", "😂", "🎉", "🔥", "🙌",
    "👀", "✅", "🚀", "💯", "😄", "😎",
    "🤔", "👏", "✨", "💜", "🥳", "🤝"
  ];

  // ==========================================================================
  // 1. UTILITIES (AVATARS, IMAGE COMPRESSION, PASSWORD HASH, SLACK MARKDOWN)
  // ==========================================================================

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function createSvgAvatarDataUrl(label, colorIndex = 0) {
    const clean = (label || "U").trim();
    const initials =
      clean
        .split(/[\s_]+/)
        .map((w) => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase() || "U";
    const palette = SLACK_AVATAR_COLORS[Math.abs(colorIndex) % SLACK_AVATAR_COLORS.length];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
      <rect width="160" height="160" rx="24" fill="${palette.bg}"/>
      <text x="50%" y="53%" dominant-baseline="middle" text-anchor="middle"
        fill="${palette.fg}" font-family="Lato, Helvetica, Arial, sans-serif"
        font-weight="900" font-size="64">${escapeHtml(initials)}</text>
    </svg>`;
    return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
  }

  function getPresetAvatars() {
    const icons = ["⚡", "🦊", "🚀", "🎧", "🌟", "🐼"];
    return icons.map((emoji, idx) => {
      const palette = SLACK_AVATAR_COLORS[idx % SLACK_AVATAR_COLORS.length];
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
        <rect width="160" height="160" rx="24" fill="${palette.bg}"/>
        <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-size="76">${emoji}</text>
      </svg>`;
      return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
    });
  }

  function compressImageFile(file, maxSize = 180, quality = 0.84) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith("image/")) {
        reject(new Error("Please select a valid image file."));
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          let width = img.width;
          let height = img.height;

          if (maxSize <= 220) {
            const side = Math.min(width, height);
            const sx = (width - side) / 2;
            const sy = (height - side) / 2;
            canvas.width = maxSize;
            canvas.height = maxSize;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, sx, sy, side, side, 0, 0, maxSize, maxSize);
          } else {
            if (width > maxSize || height > maxSize) {
              const ratio = Math.min(maxSize / width, maxSize / height);
              width = Math.round(width * ratio);
              height = Math.round(height * ratio);
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, width, height);
          }
          resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.onerror = () => reject(new Error("Could not process image."));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error("Error reading file."));
      reader.readAsDataURL(file);
    });
  }

  async function hashPassword(password, usernameSalt) {
    const raw = `slack_v3:${usernameSalt.toLowerCase()}:${password}`;
    if (window.crypto && window.crypto.subtle) {
      try {
        const msgBuffer = new TextEncoder().encode(raw);
        const hashBuffer = await window.crypto.subtle.digest("SHA-256", msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
      } catch (_) {}
    }
    let h1 = 0xdeadbeef ^ raw.length;
    let h2 = 0x41c6ce57 ^ raw.length;
    for (let i = 0, ch; i < raw.length; i++) {
      ch = raw.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
  }

  function normalizeUsername(input) {
    return (input || "")
      .trim()
      .toLowerCase()
      .replace(/^@+/, "")
      .replace(/\s+/g, "_");
  }

  function formatSlackText(text) {
    if (!text) return "";
    let html = escapeHtml(text);

    html = html.replace(/```([\s\S]*?)```/g, (_, code) => `<pre>${code.trim()}</pre>`);
    html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
    html = html.replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );
    html = html.replace(/(^|\s)\*([^*\n]+)\*(?=\s|$|[.,!?])/g, "$1<strong>$2</strong>");
    html = html.replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,!?])/g, "$1<em>$2</em>");
    html = html.replace(/(^|\s)~([^~\n]+)~(?=\s|$|[.,!?])/g, "$1<del>$2</del>");
    html = html.replace(/(^|\n)&gt;\s?([^\n]+)/g, "$1<blockquote>$2</blockquote>");

    return html;
  }

  function formatTimeShort(isoStr) {
    const d = new Date(isoStr);
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  }

  function formatTimeCompact(isoStr) {
    const d = new Date(isoStr);
    return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  }

  function formatDatePill(isoStr) {
    const d = new Date(isoStr);
    const now = new Date();
    const todayStr = now.toDateString();
    const yest = new Date(now);
    yest.setDate(now.getDate() - 1);

    if (d.toDateString() === todayStr) return "Today";
    if (d.toDateString() === yest.toDateString()) return "Yesterday";

    return d.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric"
    });
  }

  function generateUuid() {
    if (window.crypto && window.crypto.randomUUID) {
      return window.crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // Deterministic ID per username so the same account matches across devices
  function deterministicUserId(username) {
    const clean = normalizeUsername(username);
    return `usr_${clean}`;
  }

  // ==========================================================================
  // 2. HIGH-CAPACITY INDEXEDDB STORAGE ENGINE (HUNDREDS OF MBs)
  // ==========================================================================

  function openIdb() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("IndexedDB not supported"));
        return;
      }
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbLoadStore() {
    try {
      const db = await openIdb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readonly");
        const store = tx.objectStore(IDB_STORE);
        const getReq = store.get(IDB_KEY);
        getReq.onsuccess = () => resolve(getReq.result || null);
        getReq.onerror = () => reject(getReq.error);
      });
    } catch (_) {
      try {
        const raw = localStorage.getItem(STORAGE_KEYS.FALLBACK_STORE);
        return raw ? JSON.parse(raw) : null;
      } catch (__) {
        return null;
      }
    }
  }

  async function idbSaveStore(storeObj) {
    try {
      const db = await openIdb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        const store = tx.objectStore(IDB_STORE);
        store.put(storeObj, IDB_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (_) {
      try {
        localStorage.setItem(STORAGE_KEYS.FALLBACK_STORE, JSON.stringify(storeObj));
      } catch (__) {}
    }
  }

  // ==========================================================================
  // 3. STATE & VERCEL SERVERLESS DELTA-SYNC (/api/chat)
  // ==========================================================================

  const state = {
    authTab: "login", // "login" | "register"
    currentUser: null,
    activePartnerId: null,

    store: {
      clearedAt: 0,
      deletedIds: [],
      users: {},
      messages: []
    },

    searchQuery: "",
    pendingAttachment: null,
    drawerOpen: false,
    drawerUserId: null,
    editAvatarDataUrl: "",

    localChannel: null,
    pollTimer: null,
    partnerTypingTimeout: null,
    lastTypingSentAt: 0,
    syncInFlight: false
  };

  function getSafeSnapshotForVercel() {
    // Keep snapshot safely under Vercel's 4.5 MB limit (~3.2 MB max)
    const users = state.store.users;
    const allMsgs = state.store.messages || [];
    const selectedMsgs = [];
    let bytes = JSON.stringify(users).length;

    for (let i = allMsgs.length - 1; i >= 0; i--) {
      const m = allMsgs[i];
      const msgSize = JSON.stringify(m).length;
      if (bytes + msgSize < 3200000) {
        selectedMsgs.unshift(m);
        bytes += msgSize;
      } else {
        // Include message text without heavy image if needed
        const lightMsg = { ...m, image_url: null };
        selectedMsgs.unshift(lightMsg);
        bytes += JSON.stringify(lightMsg).length;
      }
      if (selectedMsgs.length >= 400) break;
    }

    return {
      clearedAt: state.store.clearedAt || 0,
      deletedIds: (state.store.deletedIds || []).slice(-500),
      users,
      messages: selectedMsgs
    };
  }

  function applyIncomingState(incoming) {
    if (!incoming) return false;
    let changed = false;

    if (typeof incoming.clearedAt === "number" && incoming.clearedAt > (state.store.clearedAt || 0)) {
      state.store.clearedAt = incoming.clearedAt;
      state.store.messages = state.store.messages.filter(
        (m) => new Date(m.created_at).getTime() > state.store.clearedAt
      );
      changed = true;
    }

    if (Array.isArray(incoming.deletedIds) && incoming.deletedIds.length > 0) {
      const prevLen = (state.store.deletedIds || []).length;
      const delSet = new Set([...(state.store.deletedIds || []), ...incoming.deletedIds]);
      state.store.deletedIds = Array.from(delSet).slice(-1000);
      const beforeMsgLen = state.store.messages.length;
      state.store.messages = state.store.messages.filter((m) => !delSet.has(m.id));
      if (state.store.deletedIds.length !== prevLen || state.store.messages.length !== beforeMsgLen) {
        changed = true;
      }
    }

    const incomingUsersList = Array.isArray(incoming.users)
      ? incoming.users
      : incoming.users && typeof incoming.users === "object"
      ? Object.values(incoming.users)
      : [];

    for (const u of incomingUsersList) {
      if (!u || !u.id || !u.username) continue;
      const cur = state.store.users[u.id];
      if (!cur || (u.updated_at || 0) >= (cur.updated_at || 0)) {
        if (
          !cur ||
          cur.display_name !== u.display_name ||
          cur.username !== u.username ||
          cur.avatar_url !== u.avatar_url ||
          cur.status_text !== u.status_text ||
          cur.last_seen !== u.last_seen
        ) {
          changed = true;
        }
        state.store.users[u.id] = {
          ...(cur || {}),
          ...u
        };
      }
    }

    if (Array.isArray(incoming.messages)) {
      const delSet = new Set(state.store.deletedIds || []);
      const byId = new Map();
      for (const m of state.store.messages) {
        if (!delSet.has(m.id) && new Date(m.created_at).getTime() > (state.store.clearedAt || 0)) {
          byId.set(m.id, m);
        }
      }

      for (const m of incoming.messages) {
        if (!m || !m.id || delSet.has(m.id)) continue;
        const createdMs = new Date(m.created_at).getTime() || 0;
        if (createdMs <= (state.store.clearedAt || 0)) continue;
        const existing = byId.get(m.id);
        if (!existing) {
          byId.set(m.id, m);
          changed = true;
        } else if ((m.updated_at || 0) > (existing.updated_at || 0)) {
          if (JSON.stringify(existing.reactions) !== JSON.stringify(m.reactions)) {
            changed = true;
          }
          // Preserve local image if server had stripped it
          byId.set(m.id, {
            ...m,
            image_url: m.image_url || existing.image_url
          });
        }
      }

      if (byId.size !== state.store.messages.length) {
        changed = true;
      }

      state.store.messages = Array.from(byId.values())
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .slice(-1000);
    }

    if (state.currentUser && state.store.users[state.currentUser.id]) {
      state.currentUser = state.store.users[state.currentUser.id];
    }

    if (incoming.typing && typeof incoming.typing === "object" && state.currentUser) {
      const partner = getActivePartner();
      if (partner && partner.id !== state.currentUser.id && incoming.typing[partner.id]) {
        const t = incoming.typing[partner.id];
        if (Date.now() - (t.timestamp || 0) < 3500) {
          showPartnerTyping(t.displayName);
        }
      }
    }

    if (changed) {
      idbSaveStore(state.store);
    }
    return changed;
  }

  async function persistAndBroadcast() {
    await idbSaveStore(state.store);
    if (state.localChannel) {
      state.localChannel.postMessage({
        type: "STORE_SYNC",
        store: state.store
      });
    }
  }

  async function callVercelApi(payload, includeSnapshot = false) {
    if (window.location.protocol === "file:") return { ok: true, localOnly: true };
    try {
      const bodyObj = {
        ...payload,
        activeUserId: state.currentUser ? state.currentUser.id : null
      };
      if (includeSnapshot) {
        bodyObj.snapshot = getSafeSnapshotForVercel();
      }
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyObj)
      });
      const data = await res.json();
      if (data && data.ok) {
        const serverUserCount = Array.isArray(data.users) ? data.users.length : 0;
        const localUserCount = Object.keys(state.store.users).length;
        const serverMsgCount = Array.isArray(data.messages) ? data.messages.length : 0;
        const localMsgCount = state.store.messages.length;

        const changed = applyIncomingState(data);
        if (changed && state.currentUser) {
          selectDefaultPartnerIfNeeded();
          renderAll(true);
        }

        // If Vercel instance cold-started and has fewer users/messages than our IndexedDB, re-hydrate it
        if (!includeSnapshot && (serverUserCount < localUserCount || serverMsgCount < localMsgCount)) {
          await callVercelApi({ action: "sync" }, true);
        }
      }
      return data;
    } catch (_) {
      return { ok: true, localOnly: true };
    }
  }

  function startRealtimeSync() {
    if ("BroadcastChannel" in window && !state.localChannel) {
      state.localChannel = new BroadcastChannel("slack_1on1_idb_channel_v3");
      state.localChannel.onmessage = (event) => {
        const data = event.data || {};
        if (data.type === "STORE_SYNC" && data.store) {
          const changed = applyIncomingState(data.store);
          if (changed && state.currentUser) {
            selectDefaultPartnerIfNeeded();
            renderAll(true);
          }
        } else if (data.type === "TYPING" && state.currentUser) {
          if (data.userId !== state.currentUser.id && data.userId === state.activePartnerId) {
            showPartnerTyping(data.displayName);
          }
        }
      };
    }

    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = setInterval(async () => {
      if (document.hidden || state.syncInFlight || !state.currentUser) return;
      state.syncInFlight = true;
      try {
        await callVercelApi({ action: "sync" }, false);
      } finally {
        state.syncInFlight = false;
      }
    }, 1300);
  }

  function sendTypingSignal() {
    if (!state.currentUser) return;
    const now = Date.now();
    if (now - state.lastTypingSentAt < 900) return;
    state.lastTypingSentAt = now;

    if (state.localChannel) {
      state.localChannel.postMessage({
        type: "TYPING",
        userId: state.currentUser.id,
        displayName: state.currentUser.display_name
      });
    }
    callVercelApi(
      {
        action: "typing",
        userId: state.currentUser.id,
        displayName: state.currentUser.display_name
      },
      false
    );
  }

  function showPartnerTyping(displayName) {
    const el = document.getElementById("typing-indicator-text");
    if (!el) return;
    el.innerHTML = `<strong>${escapeHtml(displayName)}</strong> is typing...`;
    if (state.partnerTypingTimeout) clearTimeout(state.partnerTypingTimeout);
    state.partnerTypingTimeout = setTimeout(() => {
      el.textContent = "";
    }, 2600);
  }

  function isUserOnline(user) {
    if (!user) return false;
    if (state.currentUser && user.id === state.currentUser.id) return true;
    if (user.last_seen) {
      const diff = Date.now() - new Date(user.last_seen).getTime();
      if (diff < 65000) return true;
    }
    return false;
  }

  // ==========================================================================
  // 4. SIMPLE AUTHENTICATION (USERNAME + PASSWORD + REMEMBER ME)
  // ==========================================================================

  function switchAuthTab(tab) {
    state.authTab = tab;
    const tabLogin = document.getElementById("tab-login");
    const tabRegister = document.getElementById("tab-register");
    const title = document.getElementById("auth-title");
    const subtitle = document.getElementById("auth-subtitle");
    const submitBtn = document.getElementById("auth-submit-btn");
    const errorBox = document.getElementById("auth-error-box");

    errorBox.classList.add("hidden");

    if (tab === "login") {
      tabLogin.classList.add("active");
      tabRegister.classList.remove("active");
      title.textContent = "Sign in to Slack";
      subtitle.textContent = "Enter your username and password to continue";
      submitBtn.textContent = "Sign In";
    } else {
      tabRegister.classList.add("active");
      tabLogin.classList.remove("active");
      title.textContent = "Create your account";
      subtitle.textContent = "Choose a username and password — nothing else required";
      submitBtn.textContent = "Create Account & Enter";
    }
  }

  function showAuthError(msg) {
    const errorBox = document.getElementById("auth-error-box");
    errorBox.textContent = msg;
    errorBox.classList.remove("hidden");
  }

  async function handleAuthSubmit(e) {
    e.preventDefault();
    const errorBox = document.getElementById("auth-error-box");
    errorBox.classList.add("hidden");

    const rawUsername = document.getElementById("auth-username").value;
    const password = document.getElementById("auth-password").value;
    const rememberMe = document.getElementById("auth-remember").checked;
    const username = normalizeUsername(rawUsername);

    if (!username || username.length < 2) {
      showAuthError("Please enter a valid username (at least 2 characters).");
      return;
    }
    if (!password || password.length < 3) {
      showAuthError("Please enter a password (at least 3 characters).");
      return;
    }

    const submitBtn = document.getElementById("auth-submit-btn");
    submitBtn.disabled = true;

    try {
      // Sync latest accounts from server first
      await callVercelApi({ action: "sync" }, true);

      const passwordHash = await hashPassword(password, username);
      const userId = deterministicUserId(username);

      if (state.authTab === "login") {
        const localUser = Object.values(state.store.users).find(
          (u) => normalizeUsername(u.username) === username
        );

        const apiRes = await callVercelApi(
          {
            action: "login",
            username,
            password_hash: passwordHash
          },
          true
        );

        const resolvedUser =
          Object.values(state.store.users).find(
            (u) => normalizeUsername(u.username) === username
          ) || localUser;

        if (!resolvedUser) {
          showAuthError(
            (apiRes && apiRes.error) ||
              `Account @${username} not found. Switch to "Create Account" to create it.`
          );
          return;
        }

        if (resolvedUser.password_hash && resolvedUser.password_hash !== passwordHash) {
          showAuthError("Incorrect password. Please try again.");
          return;
        }

        await completeLogin(resolvedUser, rememberMe);
      } else {
        const existingLocal = Object.values(state.store.users).find(
          (u) => normalizeUsername(u.username) === username
        );
        if (existingLocal) {
          showAuthError(`Username @${username} is already registered. Please Sign In instead.`);
          return;
        }

        const displayName = rawUsername.trim().replace(/^@+/, "") || username;
        const colorIdx = Object.keys(state.store.users).length;
        const newUser = {
          id: userId,
          username,
          display_name: displayName,
          password_hash: passwordHash,
          status_text: "Active in Slack",
          avatar_url: createSvgAvatarDataUrl(displayName, colorIdx),
          updated_at: Date.now(),
          last_seen: new Date().toISOString()
        };

        const apiRes = await callVercelApi(
          {
            action: "register",
            user: newUser
          },
          true
        );

        if (apiRes && apiRes.ok === false && apiRes.error) {
          showAuthError(apiRes.error);
          return;
        }

        state.store.users[newUser.id] = newUser;
        await persistAndBroadcast();
        await completeLogin(newUser, rememberMe);
      }
    } catch (err) {
      showAuthError(err.message || "Authentication failed.");
    } finally {
      submitBtn.disabled = false;
    }
  }

  async function completeLogin(user, rememberMe = true) {
    state.currentUser = user;
    state.store.users[user.id] = user;

    sessionStorage.setItem(STORAGE_KEYS.SESSION_UID_TAB, user.id);
    if (rememberMe) {
      localStorage.setItem(STORAGE_KEYS.REMEMBER_UID_LOCAL, user.id);
    } else {
      localStorage.removeItem(STORAGE_KEYS.REMEMBER_UID_LOCAL);
    }

    document.getElementById("auth-screen").classList.add("hidden");
    document.getElementById("slack-app").classList.remove("hidden");

    selectDefaultPartnerIfNeeded();
    renderAll(false);
    await callVercelApi({ action: "sync" }, true);
    document.getElementById("composer-input").focus();
  }

  function handleLogout() {
    state.currentUser = null;
    state.activePartnerId = null;
    sessionStorage.removeItem(STORAGE_KEYS.SESSION_UID_TAB);
    localStorage.removeItem(STORAGE_KEYS.REMEMBER_UID_LOCAL);

    document.getElementById("slack-app").classList.add("hidden");
    document.getElementById("auth-screen").classList.remove("hidden");
    document.getElementById("auth-password").value = "";
  }

  // ==========================================================================
  // 5. 1-ON-1 PARTNER SELECTION & UI RENDERING
  // ==========================================================================

  function getUsersArray() {
    return Object.values(state.store.users || {});
  }

  function selectDefaultPartnerIfNeeded() {
    if (!state.currentUser) return;
    const allUsers = getUsersArray();
    const otherUsers = allUsers.filter((u) => u.id !== state.currentUser.id);

    if (
      (!state.activePartnerId || state.activePartnerId === state.currentUser.id) &&
      otherUsers.length > 0
    ) {
      const savedPartner = localStorage.getItem(STORAGE_KEYS.ACTIVE_PARTNER_ID);
      const validSaved = otherUsers.find((u) => u.id === savedPartner);
      state.activePartnerId = validSaved ? validSaved.id : otherUsers[0].id;
      localStorage.setItem(STORAGE_KEYS.ACTIVE_PARTNER_ID, state.activePartnerId);
      return;
    }

    if (!state.activePartnerId || !state.store.users[state.activePartnerId]) {
      state.activePartnerId = otherUsers.length > 0 ? otherUsers[0].id : state.currentUser.id;
    }
  }

  function getActivePartner() {
    if (!state.currentUser) return null;
    const allUsers = getUsersArray();
    return (
      state.store.users[state.activePartnerId] ||
      allUsers.find((u) => u.id !== state.currentUser.id) ||
      state.currentUser
    );
  }

  function renderAll(preserveScroll = false) {
    if (!state.currentUser) return;
    renderCurrentUserBadges();
    renderSidebarUsers();
    renderChatHeader();
    renderMessagesList(preserveScroll);
    if (state.drawerOpen) {
      renderProfileDrawer();
    }
  }

  function renderCurrentUserBadges() {
    const me = state.currentUser;
    if (!me) return;
    const avatar = me.avatar_url || createSvgAvatarDataUrl(me.display_name, 0);

    document.getElementById("topbar-user-avatar").src = avatar;
    document.getElementById("sidebar-my-avatar").src = avatar;
    document.getElementById("sidebar-my-name").textContent = me.display_name;
    document.getElementById("sidebar-my-username").textContent = `@${me.username}`;

    const topLabel = document.getElementById("topbar-user-label");
    if (topLabel) {
      topLabel.textContent = `@${me.username} · Edit Profile`;
    }
  }

  function renderSidebarUsers() {
    const listEl = document.getElementById("dm-users-list");
    if (!listEl || !state.currentUser) return;

    const partner = getActivePartner();
    const otherUsers = getUsersArray().filter((u) => u.id !== state.currentUser.id);
    const ordered = [...otherUsers, state.currentUser];

    let html = "";
    ordered.forEach((u, idx) => {
      const isMe = u.id === state.currentUser.id;
      const isActive = partner && u.id === partner.id;
      const online = isUserOnline(u);
      const avatar = u.avatar_url || createSvgAvatarDataUrl(u.display_name, idx);

      html += `
        <div class="dm-item ${isActive ? "active" : ""}" data-userid="${escapeHtml(u.id)}">
          <div class="dm-avatar-wrap">
            <img class="dm-avatar" src="${escapeHtml(avatar)}" alt="${escapeHtml(u.display_name)}" />
            <span class="dm-presence-dot ${online ? "" : "offline"}"></span>
          </div>
          <div class="dm-name-wrap">
            <span class="dm-display-name">${escapeHtml(u.display_name)}${isMe ? " (you)" : ""}</span>
            <span class="dm-username-tag">@${escapeHtml(u.username)}</span>
          </div>
        </div>
      `;
    });

    if (otherUsers.length === 0) {
      html += `
        <div class="dm-empty-hint">
          💬 When the 2nd person creates their account with a username and password, they will appear here automatically in real time.
        </div>
      `;
    }

    listEl.innerHTML = html;

    listEl.querySelectorAll(".dm-item").forEach((item) => {
      item.addEventListener("click", () => {
        const uid = item.getAttribute("data-userid");
        state.activePartnerId = uid;
        localStorage.setItem(STORAGE_KEYS.ACTIVE_PARTNER_ID, uid);
        document.getElementById("slack-sidebar").classList.remove("open");
        renderSidebarUsers();
        renderChatHeader();
        renderMessagesList(false);
        if (state.drawerOpen) {
          state.drawerUserId = uid;
          renderProfileDrawer();
        }
        document.getElementById("composer-input").focus();
      });
    });
  }

  function renderChatHeader() {
    const partner = getActivePartner();
    if (!partner || !state.currentUser) return;

    const isMe = partner.id === state.currentUser.id;
    const avatar = partner.avatar_url || createSvgAvatarDataUrl(partner.display_name, 1);
    const online = isUserOnline(partner);

    document.getElementById("chat-header-avatar").src = avatar;
    document.getElementById("chat-header-name").textContent =
      partner.display_name + (isMe ? " (you)" : "");
    document.getElementById("chat-header-username").textContent = `@${partner.username}`;

    const presenceEl = document.getElementById("chat-header-presence");
    if (online) {
      presenceEl.classList.remove("offline");
    } else {
      presenceEl.classList.add("offline");
    }

    const composerInput = document.getElementById("composer-input");
    composerInput.placeholder = isMe
      ? `Jot something down in your personal space (@${partner.username})...`
      : `Message ${partner.display_name} (@${partner.username})`;
  }

  function getFilteredConversationMessages() {
    const me = state.currentUser;
    const partner = getActivePartner();
    if (!me || !partner) return [];

    const isSelfChat = me.id === partner.id;

    return state.store.messages.filter((m) => {
      let belongsToPair = false;
      if (isSelfChat) {
        belongsToPair = m.sender_id === me.id && (!m.receiver_id || m.receiver_id === me.id);
      } else {
        belongsToPair =
          (m.sender_id === me.id && (m.receiver_id === partner.id || !m.receiver_id)) ||
          (m.sender_id === partner.id && (m.receiver_id === me.id || !m.receiver_id));
      }
      if (!belongsToPair) return false;

      if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase();
        return (m.content || "").toLowerCase().includes(q);
      }
      return true;
    });
  }

  function renderMessagesList(preserveScrollIfNotBottom = false) {
    const viewport = document.getElementById("messages-viewport");
    if (!viewport || !state.currentUser) return;

    const wasNearBottom =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 120;

    const partner = getActivePartner();
    const isMe = partner.id === state.currentUser.id;
    const partnerAvatar = partner.avatar_url || createSvgAvatarDataUrl(partner.display_name, 1);

    const msgs = getFilteredConversationMessages();

    let html = `
      <div class="dm-conversation-hero">
        <div class="dm-hero-card">
          <img class="dm-hero-avatar" data-profile-uid="${escapeHtml(partner.id)}" src="${escapeHtml(partnerAvatar)}" alt="${escapeHtml(partner.display_name)}" />
          <div>
            <div class="dm-hero-title">
              <span>${escapeHtml(partner.display_name)}${isMe ? " (you)" : ""}</span>
            </div>
            <div class="dm-hero-handle">@${escapeHtml(partner.username)}</div>
          </div>
        </div>
        <p class="dm-hero-description">
          ${
            isMe
              ? `<strong>This is your space.</strong> Draft messages, test formatting, or open another window with a second account to chat in real time.`
              : `This is the very beginning of your direct message history with <strong>${escapeHtml(partner.display_name)}</strong> (<code>@${escapeHtml(partner.username)}</code>).`
          }
        </p>
      </div>
    `;

    let lastDatePill = "";
    let prevSenderId = null;
    let prevTimestampMs = 0;

    msgs.forEach((msg) => {
      const dateLabel = formatDatePill(msg.created_at);
      if (dateLabel !== lastDatePill) {
        lastDatePill = dateLabel;
        prevSenderId = null;
        html += `
          <div class="slack-date-divider">
            <span class="slack-date-pill">${escapeHtml(dateLabel)}</span>
          </div>
        `;
      }

      const sender = state.store.users[msg.sender_id] || {
        id: msg.sender_id,
        display_name: "User",
        username: "user",
        avatar_url: createSvgAvatarDataUrl("U", 2)
      };

      const msgTimeMs = new Date(msg.created_at).getTime();
      const isCompact =
        prevSenderId === msg.sender_id && msgTimeMs - prevTimestampMs < 5 * 60 * 1000;

      prevSenderId = msg.sender_id;
      prevTimestampMs = msgTimeMs;

      const senderAvatar = sender.avatar_url || createSvgAvatarDataUrl(sender.display_name, 2);
      const isOwnMsg = msg.sender_id === state.currentUser.id;

      // Reactions
      const reactionsObj = msg.reactions || {};
      const reactionEntries = Object.entries(reactionsObj).filter(
        ([, uids]) => Array.isArray(uids) && uids.length > 0
      );

      let reactionsHtml = "";
      if (reactionEntries.length > 0) {
        reactionsHtml = `<div class="msg-reactions-bar">`;
        reactionEntries.forEach(([emoji, uids]) => {
          const iReacted = uids.includes(state.currentUser.id);
          reactionsHtml += `
            <button type="button" class="reaction-chip ${iReacted ? "reacted" : ""}"
              data-react-msgid="${escapeHtml(msg.id)}" data-react-emoji="${escapeHtml(emoji)}">
              <span>${escapeHtml(emoji)}</span>
              <span>${uids.length}</span>
            </button>
          `;
        });
        reactionsHtml += `</div>`;
      }

      const attachedImgHtml = msg.image_url
        ? `<img class="msg-attached-image" src="${escapeHtml(msg.image_url)}" alt="Attached image" />`
        : "";

      html += `
        <div class="slack-msg-row ${isCompact ? "compact" : ""}" data-msgid="${escapeHtml(msg.id)}">
          <div class="msg-left-gutter">
            ${
              isCompact
                ? `<span class="compact-hover-time">${escapeHtml(formatTimeCompact(msg.created_at))}</span>`
                : `<img class="msg-avatar" data-profile-uid="${escapeHtml(sender.id)}" src="${escapeHtml(senderAvatar)}" alt="${escapeHtml(sender.display_name)}" />`
            }
          </div>

          <div class="msg-content-col">
            ${
              isCompact
                ? ""
                : `
              <div class="msg-meta-line">
                <span class="msg-author-name" data-profile-uid="${escapeHtml(sender.id)}">${escapeHtml(sender.display_name)}</span>
                <span class="msg-author-username">@${escapeHtml(sender.username)}</span>
                <span class="msg-timestamp">${escapeHtml(formatTimeShort(msg.created_at))}</span>
              </div>
            `
            }
            <div class="msg-text">${formatSlackText(msg.content)}</div>
            ${attachedImgHtml}
            ${reactionsHtml}
          </div>

          <!-- Slack Hover Action Toolbar -->
          <div class="msg-hover-toolbar">
            <button type="button" class="hover-tool-btn" data-react-msgid="${escapeHtml(msg.id)}" data-react-emoji="👍" title="Thumbs up">👍</button>
            <button type="button" class="hover-tool-btn" data-react-msgid="${escapeHtml(msg.id)}" data-react-emoji="❤️" title="Heart">❤️</button>
            <button type="button" class="hover-tool-btn" data-react-msgid="${escapeHtml(msg.id)}" data-react-emoji="😂" title="Laugh">😂</button>
            <button type="button" class="hover-tool-btn" data-react-msgid="${escapeHtml(msg.id)}" data-react-emoji="🎉" title="Celebrate">🎉</button>
            <button type="button" class="hover-tool-btn" data-react-msgid="${escapeHtml(msg.id)}" data-react-emoji="🔥" title="Fire">🔥</button>
            ${
              isOwnMsg
                ? `<button type="button" class="hover-tool-btn delete-btn" data-delete-msgid="${escapeHtml(msg.id)}" title="Delete message">🗑️</button>`
                : ""
            }
          </div>
        </div>
      `;
    });

    viewport.innerHTML = html;

    viewport.querySelectorAll("[data-profile-uid]").forEach((el) => {
      el.addEventListener("click", () => {
        openProfileDrawer(el.getAttribute("data-profile-uid"));
      });
    });

    viewport.querySelectorAll("[data-react-msgid]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const msgId = btn.getAttribute("data-react-msgid");
        const emoji = btn.getAttribute("data-react-emoji");
        toggleMessageReaction(msgId, emoji);
      });
    });

    viewport.querySelectorAll("[data-delete-msgid]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const msgId = btn.getAttribute("data-delete-msgid");
        deleteMessage(msgId);
      });
    });

    if (!preserveScrollIfNotBottom || wasNearBottom) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }

  // ==========================================================================
  // 6. SENDING MESSAGES, FORMATTING, REACTIONS & CLEAR CHAT
  // ==========================================================================

  function updateSendButtonState() {
    const input = document.getElementById("composer-input");
    const sendBtn = document.getElementById("btn-send-message");
    const hasContent = input.value.trim().length > 0 || Boolean(state.pendingAttachment);
    sendBtn.disabled = !hasContent;
  }

  async function handleSendMessage() {
    if (!state.currentUser) return;
    const input = document.getElementById("composer-input");
    const text = input.value.trim();
    const attachment = state.pendingAttachment;

    if (!text && !attachment) return;

    const partner = getActivePartner();

    input.value = "";
    input.style.height = "auto";
    clearPendingAttachment();
    updateSendButtonState();

    const now = Date.now();
    const newMsg = {
      id: generateUuid(),
      sender_id: state.currentUser.id,
      receiver_id: partner ? partner.id : null,
      content: text,
      image_url: attachment || null,
      reactions: {},
      created_at: new Date(now).toISOString(),
      updated_at: now
    };

    state.store.messages.push(newMsg);
    await persistAndBroadcast();
    renderMessagesList(false);

    await callVercelApi(
      {
        action: "send_message",
        message: newMsg
      },
      false
    );
  }

  async function toggleMessageReaction(msgId, emoji) {
    if (!state.currentUser) return;
    const msg = state.store.messages.find((m) => m.id === msgId);
    if (!msg) return;

    const reactions = { ...(msg.reactions || {}) };
    const currentList = Array.isArray(reactions[emoji]) ? [...reactions[emoji]] : [];
    const myIdx = currentList.indexOf(state.currentUser.id);

    if (myIdx === -1) {
      currentList.push(state.currentUser.id);
    } else {
      currentList.splice(myIdx, 1);
    }

    if (currentList.length === 0) {
      delete reactions[emoji];
    } else {
      reactions[emoji] = currentList;
    }

    msg.reactions = reactions;
    msg.updated_at = Date.now();
    await persistAndBroadcast();
    renderMessagesList(true);

    await callVercelApi(
      {
        action: "toggle_reaction",
        messageId: msgId,
        reactions
      },
      false
    );
  }

  async function deleteMessage(msgId) {
    state.store.deletedIds = Array.from(new Set([...(state.store.deletedIds || []), msgId])).slice(
      -1000
    );
    state.store.messages = state.store.messages.filter((m) => m.id !== msgId);
    await persistAndBroadcast();
    renderMessagesList(true);

    await callVercelApi(
      {
        action: "delete_message",
        messageId: msgId
      },
      false
    );
  }

  async function handleClearChat() {
    if (state.store.messages.length === 0) return;
    if (!confirm("Clear all messages in this conversation?")) return;

    state.store.clearedAt = Date.now();
    state.store.messages = [];
    await persistAndBroadcast();
    renderMessagesList(false);

    await callVercelApi(
      {
        action: "clear_chat"
      },
      false
    );
  }

  function applyFormatToComposer(formatType) {
    const textarea = document.getElementById("composer-input");
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.substring(start, end) || "text";

    let replacement = selected;
    if (formatType === "bold") replacement = `*${selected}*`;
    else if (formatType === "italic") replacement = `_${selected}_`;
    else if (formatType === "strike") replacement = `~${selected}~`;
    else if (formatType === "code") replacement = `\`${selected}\``;
    else if (formatType === "quote") replacement = `> ${selected}`;

    textarea.setRangeText(replacement, start, end, "end");
    textarea.focus();
    updateSendButtonState();
  }

  function clearPendingAttachment() {
    state.pendingAttachment = null;
    document.getElementById("composer-attachment-preview").classList.add("hidden");
    document.getElementById("composer-attachment-img").src = "";
    document.getElementById("composer-image-input").value = "";
    updateSendButtonState();
  }

  // ==========================================================================
  // 7. RIGHT PROFILE DRAWER & EDIT PROFILE MODAL
  // ==========================================================================

  function openProfileDrawer(userId) {
    state.drawerOpen = true;
    state.drawerUserId = userId || (getActivePartner() && getActivePartner().id);
    document.getElementById("profile-drawer").classList.remove("hidden");
    renderProfileDrawer();
  }

  function closeProfileDrawer() {
    state.drawerOpen = false;
    document.getElementById("profile-drawer").classList.add("hidden");
  }

  function renderProfileDrawer() {
    const targetId = state.drawerUserId || (getActivePartner() && getActivePartner().id);
    const user = state.store.users[targetId] || getActivePartner();
    if (!user) return;

    const online = isUserOnline(user);
    const avatar = user.avatar_url || createSvgAvatarDataUrl(user.display_name, 1);
    const isMe = state.currentUser && user.id === state.currentUser.id;

    document.getElementById("drawer-avatar").src = avatar;
    document.getElementById("drawer-name").textContent = user.display_name;
    document.getElementById("drawer-username").textContent = `@${user.username}`;

    const dot = document.getElementById("drawer-presence-dot");
    const label = document.getElementById("drawer-presence-label");
    if (online) {
      dot.classList.remove("offline");
      label.textContent = "Active now";
    } else {
      dot.classList.add("offline");
      label.textContent = "Offline";
    }

    const editBtn = document.getElementById("drawer-edit-my-profile-btn");
    if (isMe) {
      editBtn.classList.remove("hidden");
    } else {
      editBtn.classList.add("hidden");
    }

    document.getElementById("drawer-info-fullname").textContent = user.display_name;
    document.getElementById("drawer-info-handle").textContent = `@${user.username}`;
    document.getElementById("drawer-info-status").textContent =
      user.status_text || "Active in Slack";
    document.getElementById("drawer-info-localtime").textContent = new Date().toLocaleTimeString(
      "en-US",
      { hour: "2-digit", minute: "2-digit" }
    );
  }

  function openEditProfileModal() {
    if (!state.currentUser) return;
    const me = state.currentUser;
    state.editAvatarDataUrl = me.avatar_url || createSvgAvatarDataUrl(me.display_name, 0);

    document.getElementById("edit-avatar-preview").src = state.editAvatarDataUrl;
    document.getElementById("edit-display-name").value = me.display_name;
    document.getElementById("edit-username").value = me.username;
    document.getElementById("edit-status-text").value = me.status_text || "Active in Slack";
    document.getElementById("edit-new-password").value = "";
    document.getElementById("edit-profile-error").classList.add("hidden");

    document.getElementById("edit-profile-modal").classList.remove("hidden");
  }

  function closeEditProfileModal() {
    document.getElementById("edit-profile-modal").classList.add("hidden");
  }

  async function handleSaveEditProfile(e) {
    e.preventDefault();
    if (!state.currentUser) return;

    const errBox = document.getElementById("edit-profile-error");
    errBox.classList.add("hidden");

    const displayName = document.getElementById("edit-display-name").value.trim();
    const rawUsername = document.getElementById("edit-username").value;
    const username = normalizeUsername(rawUsername);
    const statusText = document.getElementById("edit-status-text").value.trim();
    const newPassword = document.getElementById("edit-new-password").value;

    if (!displayName) {
      errBox.textContent = "Display name cannot be empty.";
      errBox.classList.remove("hidden");
      return;
    }
    if (!username || username.length < 2) {
      errBox.textContent = "Username (@handle) must be at least 2 characters.";
      errBox.classList.remove("hidden");
      return;
    }

    const conflict = Object.values(state.store.users).find(
      (u) => normalizeUsername(u.username) === username && u.id !== state.currentUser.id
    );
    if (conflict) {
      errBox.textContent = `Username @${username} is already taken by another user.`;
      errBox.classList.remove("hidden");
      return;
    }

    let passwordHash = state.currentUser.password_hash;
    if (newPassword && newPassword.trim().length > 0) {
      if (newPassword.length < 3) {
        errBox.textContent = "New password must be at least 3 characters.";
        errBox.classList.remove("hidden");
        return;
      }
      passwordHash = await hashPassword(newPassword, username);
    }

    const updatedUser = {
      ...state.currentUser,
      display_name: displayName,
      username,
      status_text: statusText || "Active in Slack",
      avatar_url: state.editAvatarDataUrl || state.currentUser.avatar_url,
      password_hash: passwordHash,
      updated_at: Date.now(),
      last_seen: new Date().toISOString()
    };

    const apiRes = await callVercelApi(
      {
        action: "update_profile",
        user: updatedUser
      },
      false
    );

    if (apiRes && apiRes.ok === false && apiRes.error) {
      errBox.textContent = apiRes.error;
      errBox.classList.remove("hidden");
      return;
    }

    state.currentUser = updatedUser;
    state.store.users[updatedUser.id] = updatedUser;
    await persistAndBroadcast();
    renderAll(true);
    closeEditProfileModal();
  }

  // ==========================================================================
  // 8. INITIALIZATION & DOM EVENTS
  // ==========================================================================

  function renderPresetAvatarStrips() {
    const presets = getPresetAvatars();
    const editStrip = document.getElementById("edit-preset-avatars");
    if (!editStrip) return;

    editStrip.innerHTML = presets
      .map(
        (src, i) =>
          `<img class="preset-avatar-thumb" data-edit-preset-src="${escapeHtml(src)}" src="${escapeHtml(src)}" alt="Preset ${i + 1}" />`
      )
      .join("");

    editStrip.querySelectorAll("[data-edit-preset-src]").forEach((img) => {
      img.addEventListener("click", () => {
        editStrip
          .querySelectorAll(".preset-avatar-thumb")
          .forEach((el) => el.classList.remove("selected"));
        img.classList.add("selected");
        state.editAvatarDataUrl = img.getAttribute("data-edit-preset-src");
        document.getElementById("edit-avatar-preview").src = state.editAvatarDataUrl;
      });
    });
  }

  function renderEmojiPopover() {
    const pop = document.getElementById("emoji-popover");
    if (!pop) return;
    pop.innerHTML = EMOJI_LIST.map(
      (em) => `<button type="button" class="emoji-item-btn" data-emoji="${em}">${em}</button>`
    ).join("");

    pop.querySelectorAll("[data-emoji]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const em = btn.getAttribute("data-emoji");
        const input = document.getElementById("composer-input");
        input.value += em;
        pop.classList.add("hidden");
        input.focus();
        updateSendButtonState();
      });
    });
  }

  function bindAllEvents() {
    // Auth Tabs & Form
    document.getElementById("tab-login").addEventListener("click", () => switchAuthTab("login"));
    document
      .getElementById("tab-register")
      .addEventListener("click", () => switchAuthTab("register"));
    document.getElementById("auth-form").addEventListener("submit", handleAuthSubmit);

    // Edit Profile & Sign Out
    document.getElementById("topbar-edit-profile-btn").addEventListener("click", openEditProfileModal);
    document.getElementById("topbar-user-btn").addEventListener("click", openEditProfileModal);
    document
      .getElementById("sidebar-my-profile-trigger")
      .addEventListener("click", openEditProfileModal);
    document
      .getElementById("btn-open-edit-profile")
      .addEventListener("click", openEditProfileModal);
    document
      .getElementById("drawer-edit-my-profile-btn")
      .addEventListener("click", openEditProfileModal);
    document
      .getElementById("btn-close-edit-profile")
      .addEventListener("click", closeEditProfileModal);
    document
      .getElementById("btn-cancel-edit-profile")
      .addEventListener("click", closeEditProfileModal);
    document
      .getElementById("edit-profile-form")
      .addEventListener("submit", handleSaveEditProfile);
    document.getElementById("btn-logout").addEventListener("click", handleLogout);

    // Upload Photo in Edit Profile
    document.getElementById("edit-avatar-file").addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const dataUrl = await compressImageFile(file, 160, 0.85);
        state.editAvatarDataUrl = dataUrl;
        document.getElementById("edit-avatar-preview").src = dataUrl;
      } catch (err) {
        alert(err.message);
      }
    });

    document.getElementById("edit-avatar-url-btn").addEventListener("click", () => {
      const url = prompt("Paste your profile image URL (https://...):", state.editAvatarDataUrl);
      if (url && url.trim()) {
        state.editAvatarDataUrl = url.trim();
        document.getElementById("edit-avatar-preview").src = url.trim();
      }
    });

    // Right Profile Drawer
    document.getElementById("chat-header-partner-btn").addEventListener("click", () => {
      const partner = getActivePartner();
      if (partner) openProfileDrawer(partner.id);
    });
    document.getElementById("btn-toggle-drawer").addEventListener("click", () => {
      if (state.drawerOpen) closeProfileDrawer();
      else {
        const partner = getActivePartner();
        if (partner) openProfileDrawer(partner.id);
      }
    });
    document.getElementById("btn-close-drawer").addEventListener("click", closeProfileDrawer);

    // Clear Chat
    document.getElementById("btn-clear-chat").addEventListener("click", handleClearChat);

    // Mobile Sidebar toggle
    document.getElementById("mobile-menu-toggle").addEventListener("click", () => {
      document.getElementById("slack-sidebar").classList.toggle("open");
    });

    // Search in conversation
    const searchInput = document.getElementById("chat-search-input");
    const searchClear = document.getElementById("chat-search-clear");
    searchInput.addEventListener("input", () => {
      state.searchQuery = searchInput.value.trim();
      searchClear.classList.toggle("hidden", !state.searchQuery);
      renderMessagesList(true);
    });
    searchClear.addEventListener("click", () => {
      searchInput.value = "";
      state.searchQuery = "";
      searchClear.classList.add("hidden");
      renderMessagesList(false);
    });

    // Composer input
    const composerInput = document.getElementById("composer-input");
    composerInput.addEventListener("input", () => {
      composerInput.style.height = "auto";
      composerInput.style.height = Math.min(composerInput.scrollHeight, 160) + "px";
      updateSendButtonState();
      sendTypingSignal();
    });

    composerInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
    });

    document.getElementById("btn-send-message").addEventListener("click", handleSendMessage);

    document.getElementById("sidebar-compose-focus-btn").addEventListener("click", () => {
      composerInput.focus();
    });

    // Formatting toolbar
    document.querySelectorAll(".format-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        applyFormatToComposer(btn.getAttribute("data-format"));
      });
    });

    // Attach image in chat
    document.getElementById("composer-image-input").addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const dataUrl = await compressImageFile(file, 720, 0.82);
        state.pendingAttachment = dataUrl;
        document.getElementById("composer-attachment-img").src = dataUrl;
        document.getElementById("composer-attachment-preview").classList.remove("hidden");
        updateSendButtonState();
        composerInput.focus();
      } catch (err) {
        alert(err.message);
      }
    });

    document
      .getElementById("composer-attachment-remove")
      .addEventListener("click", clearPendingAttachment);

    // Emoji picker
    const emojiBtn = document.getElementById("btn-emoji-picker");
    const emojiPop = document.getElementById("emoji-popover");
    emojiBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      emojiPop.classList.toggle("hidden");
    });
    document.addEventListener("click", () => {
      emojiPop.classList.add("hidden");
    });
  }

  async function bootstrap() {
    renderPresetAvatarStrips();
    renderEmojiPopover();
    bindAllEvents();

    const cached = await idbLoadStore();
    if (cached && cached.users) {
      state.store = {
        clearedAt: cached.clearedAt || 0,
        deletedIds: Array.isArray(cached.deletedIds) ? cached.deletedIds : [],
        users: cached.users || {},
        messages: Array.isArray(cached.messages) ? cached.messages : []
      };
    }

    startRealtimeSync();
    await callVercelApi({ action: "sync" }, true);

    // Auto-restore remembered login
    const rememberedUid =
      sessionStorage.getItem(STORAGE_KEYS.SESSION_UID_TAB) ||
      localStorage.getItem(STORAGE_KEYS.REMEMBER_UID_LOCAL);

    if (rememberedUid && state.store.users[rememberedUid]) {
      const isPersistent = Boolean(localStorage.getItem(STORAGE_KEYS.REMEMBER_UID_LOCAL));
      await completeLogin(state.store.users[rememberedUid], isPersistent);
    }
  }

  document.addEventListener("DOMContentLoaded", bootstrap);
})();
