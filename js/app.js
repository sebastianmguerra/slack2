// ============================================================================
// SLACK 1-ON-1 DIRECT CHAT — ENGLISH UI, SIMPLE LOGIN, INDEXEDDB + VERCEL SYNC
// ============================================================================

(function () {
  "use strict";

  const CURRENT_EPOCH = 4;

  const STORAGE_KEYS = {
    REMEMBER_UID_LOCAL: "slack_v4_remembered_uid",
    SESSION_UID_TAB: "slack_v4_session_uid",
    ACTIVE_PARTNER_ID: "slack_v4_active_partner_id",
    FALLBACK_STORE: "slack_v4_fallback_store",
    CLEANED_EPOCH: "slack_v4_cleaned_epoch"
  };

  const IDB_NAME = "slack_1on1_idb_v4";
  const IDB_STORE = "kv";
  const IDB_KEY = "chat_state";

  function purgeLegacyStorage() {
    try {
      if (localStorage.getItem(STORAGE_KEYS.CLEANED_EPOCH) === String(CURRENT_EPOCH)) {
        return;
      }
      const legacyKeys = [
        "slack_clone_session_uid_v1",
        "slack_clone_partner_uid_v1",
        "slack_clone_supabase_cfg_v1",
        "slack_clone_local_users_v1",
        "slack_clone_local_messages_v1",
        "slack_v2_my_seat_id",
        "slack_v2_session_seat_id",
        "slack_v2_partner_id",
        "slack_v2_store_cache",
        "slack_v3_remembered_uid",
        "slack_v3_session_uid",
        "slack_v3_active_partner_id",
        "slack_v3_fallback_store"
      ];
      legacyKeys.forEach((k) => {
        try {
          localStorage.removeItem(k);
          sessionStorage.removeItem(k);
        } catch (_) {}
      });
      if ("indexedDB" in window) {
        try {
          indexedDB.deleteDatabase("slack_1on1_idb_v3");
        } catch (_) {}
      }
      localStorage.setItem(STORAGE_KEYS.CLEANED_EPOCH, String(CURRENT_EPOCH));
    } catch (_) {}
  }

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
      epoch: CURRENT_EPOCH,
      resetAt: 0,
      clearedAt: 0,
      deletedIds: [],
      users: {},
      messages: []
    },

    searchQuery: "",
    pendingAttachment: null,
    pendingVideoUrl: null,
    pendingAudioUrl: null,
    pendingAudioDuration: 0,
    isRecordingAudio: false,
    mediaRecorder: null,
    recordingStream: null,
    recordingChunks: [],
    recordingStartedAt: 0,
    recordingTimerInterval: null,
    sendImmediatelyOnStop: false,
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
        // Include message text without heavy media if needed
        const lightMsg = { ...m, image_url: null, video_url: null, audio_url: null };
        selectedMsgs.unshift(lightMsg);
        bytes += JSON.stringify(lightMsg).length;
      }
      if (selectedMsgs.length >= 400) break;
    }

    return {
      epoch: CURRENT_EPOCH,
      resetAt: state.store.resetAt || 0,
      clearedAt: state.store.clearedAt || 0,
      deletedIds: (state.store.deletedIds || []).slice(-500),
      users,
      messages: selectedMsgs
    };
  }

  function applyIncomingState(incoming) {
    if (!incoming) return false;
    let messagesOrProfilesChanged = false;
    let presenceOnlyChanged = false;

    if (typeof incoming.clearedAt === "number" && incoming.clearedAt > (state.store.clearedAt || 0)) {
      state.store.clearedAt = incoming.clearedAt;
      state.store.messages = state.store.messages.filter(
        (m) => new Date(m.created_at).getTime() > state.store.clearedAt
      );
      messagesOrProfilesChanged = true;
    }

    if (Array.isArray(incoming.deletedIds) && incoming.deletedIds.length > 0) {
      const prevLen = (state.store.deletedIds || []).length;
      const delSet = new Set([...(state.store.deletedIds || []), ...incoming.deletedIds]);
      state.store.deletedIds = Array.from(delSet).slice(-1000);
      const beforeMsgLen = state.store.messages.length;
      state.store.messages = state.store.messages.filter((m) => !delSet.has(m.id));
      if (state.store.deletedIds.length !== prevLen || state.store.messages.length !== beforeMsgLen) {
        messagesOrProfilesChanged = true;
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
        const mergedAvatar = u.avatar_url || (cur && cur.avatar_url) || "";
        const mergedPassHash = u.password_hash || (cur && cur.password_hash) || "";
        if (
          !cur ||
          cur.display_name !== u.display_name ||
          cur.username !== u.username ||
          cur.avatar_url !== mergedAvatar ||
          cur.status_text !== u.status_text
        ) {
          messagesOrProfilesChanged = true;
        } else if (cur.last_seen !== u.last_seen) {
          presenceOnlyChanged = true;
        }
        state.store.users[u.id] = {
          ...(cur || {}),
          ...u,
          avatar_url: mergedAvatar,
          password_hash: mergedPassHash
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
          messagesOrProfilesChanged = true;
        } else if ((m.updated_at || 0) > (existing.updated_at || 0)) {
          if (JSON.stringify(existing.reactions) !== JSON.stringify(m.reactions)) {
            messagesOrProfilesChanged = true;
          }
          // Preserve local media if server had stripped it
          byId.set(m.id, {
            ...m,
            image_url: m.image_url || existing.image_url,
            video_url: m.video_url || existing.video_url,
            audio_url: m.audio_url || existing.audio_url,
            audio_duration: m.audio_duration || existing.audio_duration
          });
        }
      }

      if (byId.size !== state.store.messages.length) {
        messagesOrProfilesChanged = true;
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

    if (messagesOrProfilesChanged) {
      idbSaveStore(state.store);
    } else if (presenceOnlyChanged && state.currentUser) {
      renderSidebarUsers();
      renderChatHeader();
      if (state.drawerOpen) renderProfileDrawer();
    }
    return messagesOrProfilesChanged;
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

  function buildClientMeta() {
    const knownMessageIds = [];
    let sinceUpdatedAt = 0;
    for (const m of state.store.messages) {
      if (!m || !m.id) continue;
      knownMessageIds.push(m.id);
      if ((m.updated_at || 0) > sinceUpdatedAt) {
        sinceUpdatedAt = m.updated_at;
      }
    }
    const userUpdatedMap = {};
    for (const u of Object.values(state.store.users)) {
      if (u && u.id && u.avatar_url) {
        userUpdatedMap[u.id] = u.updated_at || 0;
      }
    }
    return {
      knownMessageIds,
      sinceUpdatedAt,
      userUpdatedMap
    };
  }

  async function callVercelApi(payload, includeSnapshot = false) {
    if (window.location.protocol === "file:") return { ok: true, localOnly: true };
    try {
      const bodyObj = {
        ...payload,
        activeUserId: state.currentUser ? state.currentUser.id : null,
        clientMeta: buildClientMeta()
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
        const serverUserCount =
          typeof data.serverUserCount === "number"
            ? data.serverUserCount
            : Array.isArray(data.users)
            ? data.users.length
            : 0;
        const localUserCount = Object.keys(state.store.users).length;
        const serverMsgCount =
          typeof data.serverMessageCount === "number" ? data.serverMessageCount : 0;
        const localMsgCount = state.store.messages.length;

        const changed = applyIncomingState(data);
        if (changed && state.currentUser) {
          selectDefaultPartnerIfNeeded();
          renderAll(true);
        }

        // Only re-hydrate if the Vercel instance cold-started (with a 15s cooldown so it never stalls polling)
        const now = Date.now();
        if (
          !includeSnapshot &&
          now - (state.lastRehydrateAt || 0) > 15000 &&
          (serverUserCount < localUserCount || (serverMsgCount === 0 && localMsgCount > 0))
        ) {
          state.lastRehydrateAt = now;
          callVercelApi({ action: "sync" }, true);
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

    window.addEventListener("focus", () => {
      if (state.currentUser && !state.syncInFlight) {
        callVercelApi({ action: "sync" }, false);
      }
    });

    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = setInterval(async () => {
      if (document.hidden || state.syncInFlight || !state.currentUser) return;
      state.syncInFlight = true;
      try {
        await callVercelApi({ action: "sync" }, false);
      } finally {
        state.syncInFlight = false;
      }
    }, 800);
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
        ? `<div class="msg-image-wrap">
             <img class="msg-attached-image" src="${escapeHtml(msg.image_url)}" alt="Attached image" />
             <button type="button" class="msg-copy-img-btn" data-copy-img="${escapeHtml(msg.image_url)}" title="Copy image to clipboard">📋 Copy</button>
           </div>`
        : "";

      const attachedVideoHtml = msg.video_url
        ? `<div class="msg-video-wrap" data-video-card="${escapeHtml(msg.id)}">
             <video class="msg-attached-video" src="${escapeHtml(msg.video_url)}" controls playsinline preload="metadata"></video>
           </div>`
        : "";

      const attachedAudioHtml = msg.audio_url
        ? `<div class="msg-audio-card" data-audio-card="${escapeHtml(msg.id)}">
             <button type="button" class="msg-audio-play-btn" title="Play / Pause voice clip">▶</button>
             <input type="range" class="msg-audio-slider" min="0" max="100" value="0" step="0.5" />
             <span class="msg-audio-time">${escapeHtml(formatAudioSeconds(msg.audio_duration || 0))}</span>
             <button type="button" class="msg-audio-speed-btn" title="Change playback speed">1x</button>
             <audio preload="metadata" src="${escapeHtml(msg.audio_url)}" class="hidden"></audio>
           </div>`
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
            ${attachedVideoHtml}
            ${attachedAudioHtml}
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

    // Preserve any actively playing audio or video card DOM node across re-renders
    const playingAudioCards = new Map();
    viewport.querySelectorAll("[data-audio-card]").forEach((card) => {
      const a = card.querySelector("audio");
      if (a && !a.paused) {
        playingAudioCards.set(card.getAttribute("data-audio-card"), card);
      }
    });

    const playingVideoCards = new Map();
    viewport.querySelectorAll("[data-video-card]").forEach((card) => {
      const v = card.querySelector("video");
      if (v && !v.paused) {
        playingVideoCards.set(card.getAttribute("data-video-card"), card);
      }
    });

    viewport.innerHTML = html;

    // Restore any actively playing audio or video card so playback never stops
    playingAudioCards.forEach((liveCard, msgId) => {
      const placeholder = viewport.querySelector(`[data-audio-card="${CSS.escape(msgId)}"]`);
      if (placeholder && placeholder.parentNode) {
        placeholder.parentNode.replaceChild(liveCard, placeholder);
      }
    });

    playingVideoCards.forEach((liveCard, msgId) => {
      const placeholder = viewport.querySelector(`[data-video-card="${CSS.escape(msgId)}"]`);
      if (placeholder && placeholder.parentNode) {
        placeholder.parentNode.replaceChild(liveCard, placeholder);
      }
    });

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

    viewport.querySelectorAll("[data-copy-img]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const imgSrc = btn.getAttribute("data-copy-img");
        copyImageToClipboard(imgSrc, btn);
      });
    });

    bindAudioCardPlayers(viewport);

    if (!preserveScrollIfNotBottom || wasNearBottom) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }

  function formatAudioSeconds(sec) {
    const total = Math.max(0, Math.round(Number(sec) || 0));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function bindAudioCardPlayers(viewport) {
    viewport.querySelectorAll("[data-audio-card]").forEach((card) => {
      if (card.getAttribute("data-bound") === "1") return;
      card.setAttribute("data-bound", "1");
      const playBtn = card.querySelector(".msg-audio-play-btn");
      const slider = card.querySelector(".msg-audio-slider");
      const timeLabel = card.querySelector(".msg-audio-time");
      const speedBtn = card.querySelector(".msg-audio-speed-btn");
      const audioEl = card.querySelector("audio");
      if (!playBtn || !slider || !timeLabel || !speedBtn || !audioEl) return;

      const msgRow = card.closest("[data-msgid]");
      const msgId = msgRow ? msgRow.getAttribute("data-msgid") : null;
      const msgObj = msgId ? state.store.messages.find((m) => m.id === msgId) : null;
      const fallbackDuration = (msgObj && Number(msgObj.audio_duration)) || 1;

      const getEffectiveDuration = () => {
        if (isFinite(audioEl.duration) && audioEl.duration > 0) {
          return audioEl.duration;
        }
        return fallbackDuration;
      };

      audioEl.addEventListener("loadedmetadata", () => {
        if (isFinite(audioEl.duration) && audioEl.duration > 0) {
          timeLabel.textContent = formatAudioSeconds(audioEl.duration);
        }
      });

      playBtn.addEventListener("click", () => {
        if (audioEl.paused) {
          // Pause any other audio clips in viewport
          viewport.querySelectorAll("audio").forEach((other) => {
            if (other !== audioEl) {
              other.pause();
            }
          });
          audioEl.play().catch(() => {});
        } else {
          audioEl.pause();
        }
      });

      audioEl.addEventListener("play", () => {
        playBtn.textContent = "⏸";
      });

      audioEl.addEventListener("pause", () => {
        playBtn.textContent = "▶";
      });

      audioEl.addEventListener("timeupdate", () => {
        const dur = getEffectiveDuration();
        slider.value = String(Math.min(100, (audioEl.currentTime / dur) * 100));
        timeLabel.textContent = formatAudioSeconds(audioEl.currentTime);
      });

      audioEl.addEventListener("ended", () => {
        playBtn.textContent = "▶";
        slider.value = "0";
        timeLabel.textContent = formatAudioSeconds(getEffectiveDuration());
      });

      slider.addEventListener("input", () => {
        const dur = getEffectiveDuration();
        if (dur > 0) {
          audioEl.currentTime = (Number(slider.value) / 100) * dur;
        }
      });

      const speeds = [1, 1.5, 2];
      speedBtn.addEventListener("click", () => {
        const currentRate = audioEl.playbackRate || 1;
        const nextIdx = (speeds.indexOf(currentRate) + 1) % speeds.length;
        const nextRate = speeds[nextIdx];
        audioEl.playbackRate = nextRate;
        speedBtn.textContent = `${nextRate}x`;
      });
    });
  }

  async function copyImageToClipboard(imgSrc, btnEl) {
    if (!imgSrc) return;
    const originalText = btnEl ? btnEl.textContent : "";
    try {
      const pngBlob = await new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth || img.width || 400;
          canvas.height = img.naturalHeight || img.height || 400;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0);
          canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error("Canvas toBlob failed"));
          }, "image/png");
        };
        img.onerror = () => reject(new Error("Failed to load image for copying"));
        img.src = imgSrc;
      });

      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": pngBlob })
        ]);
      } else {
        throw new Error("ClipboardItem not available");
      }

      if (btnEl) {
        btnEl.textContent = "✓ Copied!";
        btnEl.classList.add("copied");
        setTimeout(() => {
          btnEl.textContent = originalText;
          btnEl.classList.remove("copied");
        }, 1600);
      }
    } catch (_) {
      try {
        await navigator.clipboard.writeText(imgSrc);
        if (btnEl) {
          btnEl.textContent = "✓ Copied!";
          btnEl.classList.add("copied");
          setTimeout(() => {
            btnEl.textContent = originalText;
            btnEl.classList.remove("copied");
          }, 1600);
        }
      } catch (__) {
        alert("Right-click the image and select 'Copy image'.");
      }
    }
  }

  async function attachImageFileToComposer(file) {
    if (!file) return;
    try {
      const dataUrl = await compressImageFile(file, 720, 0.82);
      state.pendingAttachment = dataUrl;
      document.getElementById("composer-attachment-img").src = dataUrl;
      document.getElementById("composer-attachment-preview").classList.remove("hidden");
      updateSendButtonState();
      document.getElementById("composer-input").focus();
    } catch (err) {
      alert(err.message);
    }
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = () => reject(new Error("Could not read video file."));
      reader.readAsDataURL(file);
    });
  }

  async function compressVideoBlobInBrowser(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const video = document.createElement("video");
      video.src = url;
      video.muted = true;
      video.playsInline = true;

      video.onloadedmetadata = () => {
        const maxDim = 360;
        let w = video.videoWidth || 360;
        let h = video.videoHeight || 640;
        if (w > maxDim || h > maxDim) {
          const ratio = Math.min(maxDim / w, maxDim / h);
          w = Math.max(2, Math.round((w * ratio) / 2) * 2);
          h = Math.max(2, Math.round((h * ratio) / 2) * 2);
        }

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");

        if (!canvas.captureStream || typeof MediaRecorder === "undefined") {
          URL.revokeObjectURL(url);
          reject(new Error("Please select a video file under 3 MB."));
          return;
        }

        const stream = canvas.captureStream(20);
        const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
          ? "video/webm;codecs=vp8"
          : "video/webm";
        const recorder = new MediaRecorder(stream, {
          mimeType: mime,
          videoBitsPerSecond: 400000
        });

        const chunks = [];
        recorder.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) chunks.push(ev.data);
        };

        recorder.onstop = () => {
          URL.revokeObjectURL(url);
          const outBlob = new Blob(chunks, { type: mime });
          readFileAsDataUrl(outBlob).then(resolve).catch(reject);
        };

        let rafId = null;
        const drawFrame = () => {
          if (video.paused || video.ended) return;
          ctx.drawImage(video, 0, 0, w, h);
          rafId = requestAnimationFrame(drawFrame);
        };

        video.onplay = () => {
          recorder.start();
          drawFrame();
        };

        const stopCapture = () => {
          if (rafId) cancelAnimationFrame(rafId);
          if (recorder.state !== "inactive") recorder.stop();
          video.pause();
        };

        video.onended = stopCapture;
        setTimeout(stopCapture, Math.min((video.duration || 15) * 1000, 18000));

        video.play().catch((err) => {
          URL.revokeObjectURL(url);
          reject(err);
        });
      };

      video.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Invalid video file."));
      };
    });
  }

  async function attachVideoFileToComposer(file) {
    if (!file || !file.type || !file.type.startsWith("video/")) {
      alert("Please select a valid video file.");
      return;
    }
    if (file.size > 28 * 1024 * 1024) {
      alert("Please select a video smaller than 28 MB.");
      return;
    }

    const previewBox = document.getElementById("composer-video-preview");
    const videoEl = document.getElementById("composer-attachment-video");
    const statusBadge = document.getElementById("composer-video-status");

    try {
      previewBox.classList.remove("hidden");
      if (file.size <= 2.9 * 1024 * 1024) {
        statusBadge.classList.add("hidden");
        const dataUrl = await readFileAsDataUrl(file);
        state.pendingVideoUrl = dataUrl;
        videoEl.src = dataUrl;
      } else {
        statusBadge.textContent = "Optimizing video for chat...";
        statusBadge.classList.remove("hidden");
        const dataUrl = await compressVideoBlobInBrowser(file);
        statusBadge.classList.add("hidden");
        state.pendingVideoUrl = dataUrl;
        videoEl.src = dataUrl;
      }
      updateSendButtonState();
      document.getElementById("composer-input").focus();
    } catch (err) {
      clearPendingVideo();
      alert(err.message || "Could not attach video.");
    }
  }

  function extractMediaFileFromClipboardData(clipboardData) {
    if (!clipboardData) return null;
    if (clipboardData.items) {
      for (let i = 0; i < clipboardData.items.length; i++) {
        const item = clipboardData.items[i];
        if (item.type && (item.type.startsWith("image/") || item.type.startsWith("video/"))) {
          const f = item.getAsFile();
          if (f) return f;
        }
      }
    }
    if (clipboardData.files && clipboardData.files.length > 0) {
      for (let i = 0; i < clipboardData.files.length; i++) {
        const f = clipboardData.files[i];
        if (f.type && (f.type.startsWith("image/") || f.type.startsWith("video/"))) {
          return f;
        }
      }
    }
    return null;
  }

  // ==========================================================================
  // 6. SENDING MESSAGES, FORMATTING, REACTIONS & CLEAR CHAT
  // ==========================================================================

  function updateSendButtonState() {
    const input = document.getElementById("composer-input");
    const sendBtn = document.getElementById("btn-send-message");
    const hasContent =
      input.value.trim().length > 0 ||
      Boolean(state.pendingAttachment) ||
      Boolean(state.pendingVideoUrl) ||
      Boolean(state.pendingAudioUrl) ||
      Boolean(state.isRecordingAudio);
    sendBtn.disabled = !hasContent;
  }

  async function handleSendMessage() {
    if (!state.currentUser) return;

    // If user clicks Send while actively recording, stop recording and auto-send
    if (state.isRecordingAudio) {
      state.sendImmediatelyOnStop = true;
      stopVoiceRecording();
      return;
    }

    const input = document.getElementById("composer-input");
    const text = input.value.trim();
    const attachment = state.pendingAttachment;
    const videoUrl = state.pendingVideoUrl;
    const audioUrl = state.pendingAudioUrl;
    const audioDuration = state.pendingAudioDuration || 0;

    if (!text && !attachment && !videoUrl && !audioUrl) return;

    const partner = getActivePartner();

    input.value = "";
    input.style.height = "auto";
    clearPendingAttachment();
    clearPendingVideo();
    clearPendingAudio();
    updateSendButtonState();

    const now = Date.now();
    const newMsg = {
      id: generateUuid(),
      sender_id: state.currentUser.id,
      receiver_id: partner ? partner.id : null,
      content: text,
      image_url: attachment || null,
      video_url: videoUrl || null,
      audio_url: audioUrl || null,
      audio_duration: audioDuration || null,
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

  function clearPendingVideo() {
    state.pendingVideoUrl = null;
    const previewBox = document.getElementById("composer-video-preview");
    const videoEl = document.getElementById("composer-attachment-video");
    const statusBadge = document.getElementById("composer-video-status");
    const videoInput = document.getElementById("composer-video-input");
    if (videoEl) {
      try {
        videoEl.pause();
      } catch (_) {}
      videoEl.removeAttribute("src");
    }
    if (statusBadge) statusBadge.classList.add("hidden");
    if (previewBox) previewBox.classList.add("hidden");
    if (videoInput) videoInput.value = "";
    updateSendButtonState();
  }

  function clearPendingAudio() {
    state.pendingAudioUrl = null;
    state.pendingAudioDuration = 0;
    const previewBar = document.getElementById("composer-audio-preview");
    const audioEl = document.getElementById("composer-audio-player");
    if (audioEl) {
      try {
        audioEl.pause();
      } catch (_) {}
      audioEl.removeAttribute("src");
    }
    if (previewBar) {
      previewBar.classList.add("hidden");
    }
    updateSendButtonState();
  }

  function pickSupportedAudioMimeType() {
    if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return "";
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg;codecs=opus"
    ];
    for (const mime of candidates) {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    }
    return "";
  }

  function cleanupRecordingTracks() {
    if (state.recordingTimerInterval) {
      clearInterval(state.recordingTimerInterval);
      state.recordingTimerInterval = null;
    }
    if (state.recordingStream) {
      state.recordingStream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch (_) {}
      });
      state.recordingStream = null;
    }
    state.isRecordingAudio = false;
    state.mediaRecorder = null;
    document.getElementById("composer-recording-bar").classList.add("hidden");
    document.getElementById("btn-record-audio").classList.remove("recording-active");
    updateSendButtonState();
  }

  async function startVoiceRecording() {
    if (state.isRecordingAudio) {
      stopVoiceRecording();
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Your browser does not support voice recording.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      clearPendingAudio();

      state.recordingStream = stream;
      state.recordingChunks = [];
      state.isRecordingAudio = true;
      state.sendImmediatelyOnStop = false;
      state.recordingStartedAt = Date.now();

      const mimeType = pickSupportedAudioMimeType();
      const options = { audioBitsPerSecond: 24000 };
      if (mimeType) options.mimeType = mimeType;

      const recorder = new MediaRecorder(stream, options);
      state.mediaRecorder = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          state.recordingChunks.push(e.data);
        }
      };

      recorder.onstop = () => {
        const durationSec = Math.max(1, Math.round((Date.now() - state.recordingStartedAt) / 1000));
        const chunks = state.recordingChunks.slice();
        const shouldSendNow = state.sendImmediatelyOnStop;
        cleanupRecordingTracks();

        if (chunks.length === 0) return;

        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        const reader = new FileReader();
        reader.onload = async (ev) => {
          const dataUrl = ev.target.result;
          state.pendingAudioUrl = dataUrl;
          state.pendingAudioDuration = durationSec;

          if (shouldSendNow) {
            await handleSendMessage();
          } else {
            const audioEl = document.getElementById("composer-audio-player");
            const previewBar = document.getElementById("composer-audio-preview");
            audioEl.src = dataUrl;
            previewBar.classList.remove("hidden");
            updateSendButtonState();
            document.getElementById("composer-input").focus();
          }
        };
        reader.readAsDataURL(blob);
      };

      recorder.start();

      document.getElementById("btn-record-audio").classList.add("recording-active");
      document.getElementById("recording-timer-text").textContent = "0:00";
      document.getElementById("composer-recording-bar").classList.remove("hidden");
      updateSendButtonState();

      state.recordingTimerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - state.recordingStartedAt) / 1000);
        document.getElementById("recording-timer-text").textContent = formatAudioSeconds(elapsed);
        if (elapsed >= 60) {
          stopVoiceRecording();
        }
      }, 400);
    } catch (_) {
      alert("Microphone access was denied or unavailable.");
      cleanupRecordingTracks();
    }
  }

  function stopVoiceRecording() {
    if (!state.isRecordingAudio || !state.mediaRecorder) return;
    try {
      if (state.mediaRecorder.state !== "inactive") {
        state.mediaRecorder.stop();
      }
    } catch (_) {
      cleanupRecordingTracks();
    }
  }

  function cancelVoiceRecording() {
    state.recordingChunks = [];
    state.sendImmediatelyOnStop = false;
    if (state.mediaRecorder && state.mediaRecorder.state !== "inactive") {
      try {
        state.mediaRecorder.onstop = () => cleanupRecordingTracks();
        state.mediaRecorder.stop();
      } catch (_) {
        cleanupRecordingTracks();
      }
    } else {
      cleanupRecordingTracks();
    }
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

    // Attach image in chat (file picker, Ctrl+V paste, and drag-and-drop)
    document.getElementById("composer-image-input").addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      await attachImageFileToComposer(file);
    });

    // Attach video in chat
    document.getElementById("composer-video-input").addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      await attachVideoFileToComposer(file);
    });

    // Global & composer paste handler for images and videos (Ctrl+V / Cmd+V / Right-click Paste)
    document.addEventListener("paste", async (e) => {
      if (!state.currentUser) return;
      const mediaFile = extractMediaFileFromClipboardData(e.clipboardData);
      if (!mediaFile) return;

      e.preventDefault();
      if (mediaFile.type && mediaFile.type.startsWith("video/")) {
        await attachVideoFileToComposer(mediaFile);
        return;
      }

      const editModal = document.getElementById("edit-profile-modal");
      if (editModal && !editModal.classList.contains("hidden")) {
        try {
          const dataUrl = await compressImageFile(mediaFile, 160, 0.85);
          state.editAvatarDataUrl = dataUrl;
          document.getElementById("edit-avatar-preview").src = dataUrl;
        } catch (err) {
          alert(err.message);
        }
        return;
      }

      await attachImageFileToComposer(mediaFile);
    });

    // Drag and drop images or videos into chat
    const composerBox = document.querySelector(".slack-composer");
    const mainChatArea = document.querySelector(".slack-main");
    if (mainChatArea && composerBox) {
      mainChatArea.addEventListener("dragover", (e) => {
        if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files")) {
          e.preventDefault();
          composerBox.classList.add("drag-over");
        }
      });
      mainChatArea.addEventListener("dragleave", (e) => {
        if (!mainChatArea.contains(e.relatedTarget)) {
          composerBox.classList.remove("drag-over");
        }
      });
      mainChatArea.addEventListener("drop", async (e) => {
        composerBox.classList.remove("drag-over");
        if (!e.dataTransfer || !e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
        const files = Array.from(e.dataTransfer.files);
        const videoFile = files.find((f) => f.type && f.type.startsWith("video/"));
        if (videoFile) {
          e.preventDefault();
          await attachVideoFileToComposer(videoFile);
          return;
        }
        const imgFile = files.find((f) => f.type && f.type.startsWith("image/"));
        if (imgFile) {
          e.preventDefault();
          await attachImageFileToComposer(imgFile);
        }
      });
    }

    document
      .getElementById("composer-attachment-remove")
      .addEventListener("click", clearPendingAttachment);

    document
      .getElementById("composer-video-remove")
      .addEventListener("click", clearPendingVideo);

    // Voice recording controls
    document
      .getElementById("btn-record-audio")
      .addEventListener("click", startVoiceRecording);
    document
      .getElementById("btn-stop-recording")
      .addEventListener("click", () => {
        state.sendImmediatelyOnStop = false;
        stopVoiceRecording();
      });
    document
      .getElementById("btn-cancel-recording")
      .addEventListener("click", cancelVoiceRecording);
    document
      .getElementById("composer-audio-remove")
      .addEventListener("click", clearPendingAudio);

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

    // Discrete Mini TikTok Scroller
    initMiniTikTokPlayer();
  }

  // ==========================================================================
  // 9. DISCRETE MINI TIKTOK / VERTICAL VIDEO PLAYER
  // ==========================================================================

  const miniPlayer = {
    open: false,
    minimized: false,
    muted: false,
    region: "US",
    loading: false,
    videos: [],
    observer: null
  };

  function normalizeTikwmVideo(v) {
    if (!v || (!v.play && !v.wmplay && !v.playUrl)) return null;
    if (v.playUrl) return v;
    const authorObj = v.author || {};
    return {
      id: String(v.video_id || v.id || Math.random().toString(36).slice(2)),
      title: String(v.title || "").trim() || "TikTok Video",
      playUrl: v.play || v.wmplay,
      coverUrl: v.cover || v.origin_cover || "",
      authorName: authorObj.nickname || authorObj.unique_id || "creator",
      authorHandle: authorObj.unique_id || "tiktok"
    };
  }

  async function fetchMiniTikTokBatch(region, forceRefresh = false) {
    // 1. Try Vercel /api/tiktok first
    if (window.location.protocol !== "file:") {
      try {
        const res = await fetch(
          `/api/tiktok?region=${encodeURIComponent(region)}${forceRefresh ? "&refresh=1" : ""}`
        );
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.videos) && data.videos.length > 0) {
            return data.videos;
          }
        }
      } catch (_) {}
    }

    // 2. Direct browser fallback to tikwm CORS endpoint
    try {
      const res = await fetch(
        `https://www.tikwm.com/api/feed/list?region=${encodeURIComponent(region)}&count=10`
      );
      const json = await res.json();
      if (json && json.code === 0 && Array.isArray(json.data)) {
        return json.data.map(normalizeTikwmVideo).filter(Boolean);
      }
    } catch (_) {}

    return [];
  }

  async function resolveSingleTikTokUrl(rawUrl) {
    if (window.location.protocol !== "file:") {
      try {
        const res = await fetch(`/api/tiktok?url=${encodeURIComponent(rawUrl)}`);
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.videos) && data.videos[0]) {
            return data.videos[0];
          }
        }
      } catch (_) {}
    }
    try {
      const res = await fetch(
        `https://www.tikwm.com/api/?url=${encodeURIComponent(rawUrl)}`
      );
      const json = await res.json();
      if (json && json.code === 0 && json.data) {
        return normalizeTikwmVideo(json.data);
      }
    } catch (_) {}
    return null;
  }

  function pauseAllMiniVideos() {
    const feedEl = document.getElementById("mini-tiktok-feed");
    if (!feedEl) return;
    feedEl.querySelectorAll("video").forEach((v) => {
      try {
        v.pause();
      } catch (_) {}
    });
  }

  function setupMiniScrollObserver() {
    const feedEl = document.getElementById("mini-tiktok-feed");
    if (!feedEl) return;

    if (miniPlayer.observer) {
      miniPlayer.observer.disconnect();
    }

    miniPlayer.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const video = entry.target.querySelector("video");
          if (!video) return;
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6 && miniPlayer.open && !miniPlayer.minimized) {
            video.muted = miniPlayer.muted;
            video.play().catch(() => {
              // If browser blocks unmuted autoplay, fallback to muted
              video.muted = true;
              miniPlayer.muted = true;
              updateMuteButtonIcon();
              video.play().catch(() => {});
            });

            // Infinite scroll: load more when reaching near the end
            const idx = Number(entry.target.getAttribute("data-slide-idx") || 0);
            if (idx >= miniPlayer.videos.length - 2 && !miniPlayer.loading) {
              loadMoreMiniVideos(false);
            }
          } else {
            video.pause();
          }
        });
      },
      {
        root: feedEl,
        threshold: [0.6]
      }
    );

    feedEl.querySelectorAll(".mini-video-slide").forEach((slide) => {
      miniPlayer.observer.observe(slide);
    });
  }

  function updateMuteButtonIcon() {
    const btn = document.getElementById("mini-btn-mute");
    if (btn) {
      btn.textContent = miniPlayer.muted ? "🔇" : "🔊";
    }
  }

  function createSlideElement(video, idx) {
    const slide = document.createElement("div");
    slide.className = "mini-video-slide";
    slide.setAttribute("data-slide-idx", String(idx));

    slide.innerHTML = `
      <video
        class="mini-video-el"
        src="${escapeHtml(video.playUrl)}"
        poster="${escapeHtml(video.coverUrl || "")}"
        playsinline
        webkit-playsinline
        loop
        preload="metadata"
      ></video>
      <div class="mini-slide-actions">
        <button type="button" class="mini-action-pill" data-mini-nav="prev" title="Previous video">▲</button>
        <button type="button" class="mini-action-pill" data-mini-nav="next" title="Next video">▼</button>
        <button type="button" class="mini-action-pill" data-mini-share="${idx}" title="Share to chat">💬</button>
      </div>
      <div class="mini-video-overlay">
        <div class="mini-video-author">@${escapeHtml(video.authorHandle || video.authorName || "tiktok")}</div>
        <div class="mini-video-caption">${escapeHtml(video.title || "")}</div>
      </div>
    `;

    const videoEl = slide.querySelector("video");
    videoEl.muted = miniPlayer.muted;
    videoEl.addEventListener("click", () => {
      if (videoEl.paused) {
        videoEl.play().catch(() => {});
      } else {
        videoEl.pause();
      }
    });

    slide.querySelector('[data-mini-nav="prev"]').addEventListener("click", (e) => {
      e.stopPropagation();
      const prev = slide.previousElementSibling;
      if (prev) prev.scrollIntoView({ behavior: "smooth" });
    });

    slide.querySelector('[data-mini-nav="next"]').addEventListener("click", (e) => {
      e.stopPropagation();
      const next = slide.nextElementSibling;
      if (next) next.scrollIntoView({ behavior: "smooth" });
    });

    slide.querySelector("[data-mini-share]").addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!state.currentUser) return;
      const composer = document.getElementById("composer-input");
      composer.value = `🎬 *@${video.authorHandle}*: ${video.title.slice(0, 80)} ${video.playUrl}`;
      updateSendButtonState();
      await handleSendMessage();
    });

    return slide;
  }

  async function loadMoreMiniVideos(reset = false) {
    if (miniPlayer.loading) return;
    miniPlayer.loading = true;
    const feedEl = document.getElementById("mini-tiktok-feed");

    if (reset) {
      pauseAllMiniVideos();
      miniPlayer.videos = [];
      feedEl.innerHTML = `<div class="mini-empty-state">Loading reels...</div>`;
    }

    try {
      const batch = await fetchMiniTikTokBatch(miniPlayer.region, reset);
      const existingIds = new Set(miniPlayer.videos.map((v) => v.id));
      const fresh = batch.filter((v) => v && !existingIds.has(v.id));
      const toAdd = fresh.length > 0 ? fresh : batch;

      if (reset) {
        feedEl.innerHTML = "";
      } else {
        const emptyEl = feedEl.querySelector(".mini-empty-state");
        if (emptyEl) emptyEl.remove();
      }

      if (toAdd.length === 0 && miniPlayer.videos.length === 0) {
        feedEl.innerHTML = `
          <div class="mini-empty-state">
            <span>Couldn't load feed right now.</span>
            <button type="button" class="mini-url-go" id="mini-retry-btn">Retry</button>
          </div>
        `;
        const retryBtn = document.getElementById("mini-retry-btn");
        if (retryBtn) {
          retryBtn.addEventListener("click", () => loadMoreMiniVideos(true));
        }
        return;
      }

      toAdd.forEach((v) => {
        const idx = miniPlayer.videos.length;
        miniPlayer.videos.push(v);
        const slideEl = createSlideElement(v, idx);
        feedEl.appendChild(slideEl);
      });

      setupMiniScrollObserver();
    } finally {
      miniPlayer.loading = false;
    }
  }

  function toggleMiniTikTokPlayer(forceOpen) {
    const widget = document.getElementById("mini-tiktok-widget");
    const sidebarBtn = document.getElementById("sidebar-mini-tiktok-btn");
    if (!widget || !sidebarBtn) return;

    miniPlayer.open = typeof forceOpen === "boolean" ? forceOpen : !miniPlayer.open;

    if (miniPlayer.open) {
      widget.classList.remove("hidden");
      sidebarBtn.classList.add("active-mini");
      document.getElementById("slack-sidebar").classList.remove("open");
      if (miniPlayer.videos.length === 0) {
        loadMoreMiniVideos(true);
      } else {
        setupMiniScrollObserver();
      }
    } else {
      pauseAllMiniVideos();
      widget.classList.add("hidden");
      sidebarBtn.classList.remove("active-mini");
    }
  }

  function initMiniTikTokPlayer() {
    const sidebarBtn = document.getElementById("sidebar-mini-tiktok-btn");
    const widget = document.getElementById("mini-tiktok-widget");
    const dragHandle = document.getElementById("mini-tiktok-drag-handle");
    const btnMute = document.getElementById("mini-btn-mute");
    const btnRefresh = document.getElementById("mini-btn-refresh");
    const btnMinimize = document.getElementById("mini-btn-minimize");
    const btnClose = document.getElementById("mini-btn-close");
    const regionSelect = document.getElementById("mini-region-select");
    const urlForm = document.getElementById("mini-url-form");
    const urlInput = document.getElementById("mini-url-input");

    if (!sidebarBtn || !widget) return;

    sidebarBtn.addEventListener("click", () => toggleMiniTikTokPlayer());

    btnClose.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleMiniTikTokPlayer(false);
    });

    btnMinimize.addEventListener("click", (e) => {
      e.stopPropagation();
      miniPlayer.minimized = !miniPlayer.minimized;
      widget.classList.toggle("minimized", miniPlayer.minimized);
      if (miniPlayer.minimized) {
        pauseAllMiniVideos();
      } else {
        setupMiniScrollObserver();
      }
    });

    btnMute.addEventListener("click", (e) => {
      e.stopPropagation();
      miniPlayer.muted = !miniPlayer.muted;
      updateMuteButtonIcon();
      widget.querySelectorAll("video").forEach((v) => {
        v.muted = miniPlayer.muted;
      });
    });

    btnRefresh.addEventListener("click", (e) => {
      e.stopPropagation();
      loadMoreMiniVideos(true);
    });

    regionSelect.addEventListener("change", (e) => {
      e.stopPropagation();
      miniPlayer.region = regionSelect.value || "US";
      loadMoreMiniVideos(true);
    });

    urlForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const val = urlInput.value.trim();
      if (!val) return;
      urlInput.value = "Loading...";
      urlInput.disabled = true;
      try {
        const video = await resolveSingleTikTokUrl(val);
        if (video) {
          const feedEl = document.getElementById("mini-tiktok-feed");
          const emptyEl = feedEl.querySelector(".mini-empty-state");
          if (emptyEl) emptyEl.remove();

          const idx = miniPlayer.videos.length;
          miniPlayer.videos.push(video);
          const slideEl = createSlideElement(video, idx);
          feedEl.prepend(slideEl);
          setupMiniScrollObserver();
          slideEl.scrollIntoView({ behavior: "smooth" });
        } else {
          alert("Could not load that TikTok URL. Try pasting a full tiktok.com video link.");
        }
      } finally {
        urlInput.disabled = false;
        urlInput.value = "";
      }
    });

    // Make the discrete mini widget draggable by its top header bar
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let origLeft = 0;
    let origTop = 0;

    dragHandle.addEventListener("mousedown", (e) => {
      if (e.target.closest("button") || e.target.closest("select")) return;
      isDragging = true;
      const rect = widget.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      origLeft = rect.left;
      origTop = rect.top;
      widget.style.bottom = "auto";
      widget.style.left = origLeft + "px";
      widget.style.top = origTop + "px";
    });

    document.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const maxLeft = window.innerWidth - widget.offsetWidth - 6;
      const maxTop = window.innerHeight - widget.offsetHeight - 6;
      widget.style.left = Math.max(6, Math.min(maxLeft, origLeft + dx)) + "px";
      widget.style.top = Math.max(6, Math.min(maxTop, origTop + dy)) + "px";
    });

    document.addEventListener("mouseup", () => {
      isDragging = false;
    });
  }

  async function bootstrap() {
    purgeLegacyStorage();
    renderPresetAvatarStrips();
    renderEmojiPopover();
    bindAllEvents();

    const cached = await idbLoadStore();
    if (cached && cached.epoch === CURRENT_EPOCH && cached.users) {
      state.store = {
        epoch: CURRENT_EPOCH,
        resetAt: cached.resetAt || 0,
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
    } else if (Object.keys(state.store.users).length === 0) {
      switchAuthTab("register");
    }
  }

  document.addEventListener("DOMContentLoaded", bootstrap);
})();
