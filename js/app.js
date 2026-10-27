// ============================================================================
// SLACK 1-ON-1 DIRECT CHAT — PURE VERCEL + LOCAL REALTIME (NO LOGIN, ENGLISH UI)
// ============================================================================

(function () {
  "use strict";

  const STORAGE_KEYS = {
    ACTIVE_SEAT_LOCAL: "slack_v2_my_seat_id",
    ACTIVE_SEAT_SESSION: "slack_v2_session_seat_id",
    ACTIVE_PARTNER_SESSION: "slack_v2_partner_id",
    STORE_CACHE: "slack_v2_store_cache"
  };

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
  // 1. UTILITIES (SVG AVATARS, IMAGE COMPRESSION, SLACK MARKDOWN FORMATTER)
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
        .split(/\s+/)
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

    // Code blocks ```code```
    html = html.replace(/```([\s\S]*?)```/g, (_, code) => `<pre>${code.trim()}</pre>`);

    // Inline code `code`
    html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");

    // Links http/https
    html = html.replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );

    // Bold *text*
    html = html.replace(/(^|\s)\*([^*\n]+)\*(?=\s|$|[.,!?])/g, "$1<strong>$2</strong>");

    // Italic _text_
    html = html.replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,!?])/g, "$1<em>$2</em>");

    // Strikethrough ~text~
    html = html.replace(/(^|\s)~([^~\n]+)~(?=\s|$|[.,!?])/g, "$1<del>$2</del>");

    // Blockquote > text
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

  // ==========================================================================
  // 2. APPLICATION STATE & DEFAULT 1-ON-1 PARTICIPANTS
  // ==========================================================================

  function createDefaultStore() {
    const nowIso = new Date().toISOString();
    return {
      clearedAt: 0,
      deletedIds: [],
      users: {
        user_1: {
          id: "user_1",
          username: "alex",
          display_name: "Alex Rivera",
          status_text: "Active in Slack",
          avatar_url: createSvgAvatarDataUrl("Alex Rivera", 0),
          updated_at: 1000,
          last_seen: nowIso
        },
        user_2: {
          id: "user_2",
          username: "sam",
          display_name: "Sam Taylor",
          status_text: "Available for DM",
          avatar_url: createSvgAvatarDataUrl("Sam Taylor", 1),
          updated_at: 1000,
          last_seen: nowIso
        }
      },
      messages: []
    };
  }

  const state = {
    myUserId: "user_1",
    activePartnerId: "user_2",
    store: createDefaultStore(),

    searchQuery: "",
    pendingAttachment: null,
    drawerOpen: false,
    drawerUserId: null,
    editingUserId: null,
    editAvatarDataUrl: "",

    localChannel: null,
    pollTimer: null,
    partnerTypingTimeout: null,
    lastTypingSentAt: 0,
    syncInFlight: false
  };

  function getMyUser() {
    return state.store.users[state.myUserId] || state.store.users.user_1;
  }

  function getOtherSeatId(uid) {
    return uid === "user_1" ? "user_2" : "user_1";
  }

  function getActivePartner() {
    return (
      state.store.users[state.activePartnerId] ||
      state.store.users[getOtherSeatId(state.myUserId)] ||
      getMyUser()
    );
  }

  // ==========================================================================
  // 3. LOCAL PERSISTENCE + PURE VERCEL SERVERLESS SYNC (/api/chat)
  // ==========================================================================

  function loadLocalCache() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.STORE_CACHE);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.users && parsed.users.user_1 && parsed.users.user_2) {
          state.store = {
            clearedAt: parsed.clearedAt || 0,
            deletedIds: Array.isArray(parsed.deletedIds) ? parsed.deletedIds : [],
            users: parsed.users,
            messages: Array.isArray(parsed.messages) ? parsed.messages : []
          };
        }
      }
    } catch (_) {}

    // Resolve seat from URL (?user=2), sessionStorage, or localStorage
    const params = new URLSearchParams(window.location.search);
    const urlUser = params.get("user");
    const sessionSeat = sessionStorage.getItem(STORAGE_KEYS.ACTIVE_SEAT_SESSION);
    const localSeat = localStorage.getItem(STORAGE_KEYS.ACTIVE_SEAT_LOCAL);

    if (urlUser === "2" || urlUser === "user_2") {
      state.myUserId = "user_2";
    } else if (urlUser === "1" || urlUser === "user_1") {
      state.myUserId = "user_1";
    } else if (sessionSeat === "user_1" || sessionSeat === "user_2") {
      state.myUserId = sessionSeat;
    } else if (localSeat === "user_1" || localSeat === "user_2") {
      state.myUserId = localSeat;
    } else {
      state.myUserId = "user_1";
    }

    sessionStorage.setItem(STORAGE_KEYS.ACTIVE_SEAT_SESSION, state.myUserId);
    localStorage.setItem(STORAGE_KEYS.ACTIVE_SEAT_LOCAL, state.myUserId);

    const savedPartner = sessionStorage.getItem(STORAGE_KEYS.ACTIVE_PARTNER_SESSION);
    if (savedPartner === "user_1" || savedPartner === "user_2") {
      state.activePartnerId = savedPartner;
    } else {
      state.activePartnerId = getOtherSeatId(state.myUserId);
    }
  }

  function saveLocalCache(notifyTabs = true) {
    try {
      localStorage.setItem(STORAGE_KEYS.STORE_CACHE, JSON.stringify(state.store));
      if (notifyTabs && state.localChannel) {
        state.localChannel.postMessage({
          type: "STORE_SYNC",
          store: state.store
        });
      }
    } catch (_) {}
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
      state.store.deletedIds = Array.from(delSet).slice(-500);
      const beforeMsgLen = state.store.messages.length;
      state.store.messages = state.store.messages.filter((m) => !delSet.has(m.id));
      if (state.store.deletedIds.length !== prevLen || state.store.messages.length !== beforeMsgLen) {
        changed = true;
      }
    }

    // Merge users (accept either array or object map)
    const incomingUsersList = Array.isArray(incoming.users)
      ? incoming.users
      : incoming.users && typeof incoming.users === "object"
      ? Object.values(incoming.users)
      : [];

    for (const u of incomingUsersList) {
      if (!u || !u.id || !state.store.users[u.id]) continue;
      const cur = state.store.users[u.id];
      if ((u.updated_at || 0) >= (cur.updated_at || 0)) {
        if (
          cur.display_name !== u.display_name ||
          cur.username !== u.username ||
          cur.avatar_url !== u.avatar_url ||
          cur.status_text !== u.status_text ||
          cur.last_seen !== u.last_seen
        ) {
          changed = true;
        }
        state.store.users[u.id] = {
          ...cur,
          ...u
        };
      }
    }

    // Merge messages
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
          byId.set(m.id, m);
        }
      }

      if (byId.size !== state.store.messages.length) {
        changed = true;
      }

      state.store.messages = Array.from(byId.values())
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .slice(-400);
    }

    // Check typing indicator from the active partner
    if (incoming.typing && typeof incoming.typing === "object") {
      const partnerId = state.activePartnerId;
      if (partnerId !== state.myUserId && incoming.typing[partnerId]) {
        const t = incoming.typing[partnerId];
        if (Date.now() - (t.timestamp || 0) < 3500) {
          showPartnerTyping(t.displayName);
        }
      }
    }

    if (changed) {
      saveLocalCache(false);
    }
    return changed;
  }

  async function callVercelApi(payload) {
    if (window.location.protocol === "file:") return null;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          activeUserId: state.myUserId,
          snapshot: {
            clearedAt: state.store.clearedAt || 0,
            deletedIds: state.store.deletedIds || [],
            users: state.store.users,
            messages: state.store.messages
          }
        })
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (data && data.ok) {
        const changed = applyIncomingState(data);
        if (changed) {
          renderAll(true);
        }
      }
      return data;
    } catch (_) {
      return null;
    }
  }

  function startRealtimeSync() {
    if ("BroadcastChannel" in window && !state.localChannel) {
      state.localChannel = new BroadcastChannel("slack_1on1_pure_v2");
      state.localChannel.onmessage = (event) => {
        const data = event.data || {};
        if (data.type === "STORE_SYNC" && data.store) {
          const changed = applyIncomingState(data.store);
          if (changed) renderAll(true);
        } else if (data.type === "TYPING") {
          if (data.userId !== state.myUserId && data.userId === state.activePartnerId) {
            showPartnerTyping(data.displayName);
          }
        }
      };
    }

    window.addEventListener("storage", (e) => {
      if (e.key === STORAGE_KEYS.STORE_CACHE && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (applyIncomingState(parsed)) {
            renderAll(true);
          }
        } catch (_) {}
      }
    });

    // Initial sync with Vercel /api/chat + fast 1.2s polling
    callVercelApi({ action: "sync" });
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = setInterval(async () => {
      if (document.hidden || state.syncInFlight) return;
      state.syncInFlight = true;
      try {
        await callVercelApi({ action: "sync" });
      } finally {
        state.syncInFlight = false;
      }
    }, 1200);
  }

  function sendTypingSignal() {
    const now = Date.now();
    if (now - state.lastTypingSentAt < 900) return;
    state.lastTypingSentAt = now;

    const me = getMyUser();
    if (state.localChannel) {
      state.localChannel.postMessage({
        type: "TYPING",
        userId: me.id,
        displayName: me.display_name
      });
    }
    callVercelApi({
      action: "typing",
      userId: me.id,
      displayName: me.display_name
    });
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
    if (user.id === state.myUserId) return true;
    if (user.last_seen) {
      const diff = Date.now() - new Date(user.last_seen).getTime();
      if (diff < 60000) return true;
    }
    return true;
  }

  // ==========================================================================
  // 4. SWITCHING ACTIVE USER (USER 1 ⇄ USER 2)
  // ==========================================================================

  function switchActiveUserSeat() {
    const previousMe = state.myUserId;
    state.myUserId = getOtherSeatId(previousMe);
    state.activePartnerId = previousMe;

    sessionStorage.setItem(STORAGE_KEYS.ACTIVE_SEAT_SESSION, state.myUserId);
    localStorage.setItem(STORAGE_KEYS.ACTIVE_SEAT_LOCAL, state.myUserId);
    sessionStorage.setItem(STORAGE_KEYS.ACTIVE_PARTNER_SESSION, state.activePartnerId);

    if (state.drawerOpen) {
      state.drawerUserId = state.activePartnerId;
    }

    renderAll(false);
    document.getElementById("composer-input").focus();
  }

  // ==========================================================================
  // 5. UI RENDERING (TOPBAR, SIDEBAR, HEADER, MESSAGES, DRAWER)
  // ==========================================================================

  function renderAll(preserveScroll = false) {
    renderCurrentUserBadges();
    renderSidebarUsers();
    renderChatHeader();
    renderMessagesList(preserveScroll);
    if (state.drawerOpen) {
      renderProfileDrawer();
    }
  }

  function renderCurrentUserBadges() {
    const me = getMyUser();
    const other = state.store.users[getOtherSeatId(me.id)];
    const avatar = me.avatar_url || createSvgAvatarDataUrl(me.display_name, 0);

    document.getElementById("topbar-user-avatar").src = avatar;
    document.getElementById("sidebar-my-avatar").src = avatar;
    document.getElementById("sidebar-my-name").textContent = me.display_name;
    document.getElementById("sidebar-my-username").textContent = `@${me.username}`;

    const switchText = document.getElementById("topbar-switch-user-text");
    if (switchText && other) {
      switchText.textContent = `You: @${me.username} ⇄ Switch to @${other.username}`;
    }
  }

  function renderSidebarUsers() {
    const listEl = document.getElementById("dm-users-list");
    if (!listEl) return;

    const me = getMyUser();
    const other = state.store.users[getOtherSeatId(me.id)];
    const partner = getActivePartner();

    const ordered = [other, me].filter(Boolean);

    let html = "";
    ordered.forEach((u, idx) => {
      const isMe = u.id === me.id;
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

    listEl.innerHTML = html;

    listEl.querySelectorAll(".dm-item").forEach((item) => {
      item.addEventListener("click", () => {
        const uid = item.getAttribute("data-userid");
        state.activePartnerId = uid;
        sessionStorage.setItem(STORAGE_KEYS.ACTIVE_PARTNER_SESSION, uid);
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
    const me = getMyUser();
    const partner = getActivePartner();
    if (!partner) return;

    const isMe = partner.id === me.id;
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
    const me = getMyUser();
    const partner = getActivePartner();
    if (!me || !partner) return [];

    const isSelfChat = me.id === partner.id;

    return state.store.messages.filter((m) => {
      let belongsToPair = false;
      if (isSelfChat) {
        belongsToPair = m.sender_id === me.id && m.receiver_id === me.id;
      } else {
        belongsToPair =
          (m.sender_id === me.id && m.receiver_id === partner.id) ||
          (m.sender_id === partner.id && m.receiver_id === me.id) ||
          m.sender_id !== m.receiver_id;
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
    if (!viewport) return;

    const wasNearBottom =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 120;

    const me = getMyUser();
    const partner = getActivePartner();
    const isMe = partner.id === me.id;
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
              ? `<strong>This is your space.</strong> Draft messages, test formatting, or keep personal notes here.`
              : `This is the very beginning of your direct message history with <strong>${escapeHtml(partner.display_name)}</strong> (<code>@${escapeHtml(partner.username)}</code>). Click any profile photo or name to view or edit their profile.`
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

      // Reactions
      const reactionsObj = msg.reactions || {};
      const reactionEntries = Object.entries(reactionsObj).filter(
        ([, uids]) => Array.isArray(uids) && uids.length > 0
      );

      let reactionsHtml = "";
      if (reactionEntries.length > 0) {
        reactionsHtml = `<div class="msg-reactions-bar">`;
        reactionEntries.forEach(([emoji, uids]) => {
          const iReacted = uids.includes(me.id);
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
            <button type="button" class="hover-tool-btn delete-btn" data-delete-msgid="${escapeHtml(msg.id)}" title="Delete message">🗑️</button>
          </div>
        </div>
      `;
    });

    viewport.innerHTML = html;

    // Profile click handlers
    viewport.querySelectorAll("[data-profile-uid]").forEach((el) => {
      el.addEventListener("click", () => {
        openProfileDrawer(el.getAttribute("data-profile-uid"));
      });
    });

    // Reaction click handlers
    viewport.querySelectorAll("[data-react-msgid]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const msgId = btn.getAttribute("data-react-msgid");
        const emoji = btn.getAttribute("data-react-emoji");
        toggleMessageReaction(msgId, emoji);
      });
    });

    // Delete message click handlers
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
    const input = document.getElementById("composer-input");
    const text = input.value.trim();
    const attachment = state.pendingAttachment;

    if (!text && !attachment) return;

    const me = getMyUser();
    const partner = getActivePartner();

    input.value = "";
    input.style.height = "auto";
    clearPendingAttachment();
    updateSendButtonState();

    const now = Date.now();
    const newMsg = {
      id: generateUuid(),
      sender_id: me.id,
      receiver_id: partner ? partner.id : getOtherSeatId(me.id),
      content: text,
      image_url: attachment || null,
      reactions: {},
      created_at: new Date(now).toISOString(),
      updated_at: now
    };

    state.store.messages.push(newMsg);
    saveLocalCache(true);
    renderMessagesList(false);

    await callVercelApi({
      action: "send_message",
      message: newMsg
    });
  }

  async function toggleMessageReaction(msgId, emoji) {
    const me = getMyUser();
    const msg = state.store.messages.find((m) => m.id === msgId);
    if (!msg) return;

    const reactions = { ...(msg.reactions || {}) };
    const currentList = Array.isArray(reactions[emoji]) ? [...reactions[emoji]] : [];
    const myIdx = currentList.indexOf(me.id);

    if (myIdx === -1) {
      currentList.push(me.id);
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
    saveLocalCache(true);
    renderMessagesList(true);

    await callVercelApi({
      action: "toggle_reaction",
      messageId: msgId,
      reactions
    });
  }

  async function deleteMessage(msgId) {
    state.store.deletedIds = Array.from(new Set([...(state.store.deletedIds || []), msgId])).slice(
      -500
    );
    state.store.messages = state.store.messages.filter((m) => m.id !== msgId);
    saveLocalCache(true);
    renderMessagesList(true);

    await callVercelApi({
      action: "delete_message",
      messageId: msgId
    });
  }

  async function handleClearChat() {
    if (state.store.messages.length === 0) return;
    if (!confirm("Clear all messages in this conversation?")) return;

    state.store.clearedAt = Date.now();
    state.store.messages = [];
    saveLocalCache(true);
    renderMessagesList(false);

    await callVercelApi({
      action: "clear_chat"
    });
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
    const isMe = user.id === state.myUserId;

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
      label.textContent = "Away";
    }

    const editBtn = document.getElementById("drawer-edit-profile-btn");
    editBtn.textContent = isMe ? "✏️ Edit my profile" : `✏️ Edit @${user.username}'s profile`;

    document.getElementById("drawer-info-fullname").textContent = user.display_name;
    document.getElementById("drawer-info-handle").textContent = `@${user.username}`;
    document.getElementById("drawer-info-status").textContent = user.status_text || "Active in Slack";
    document.getElementById("drawer-info-localtime").textContent = new Date().toLocaleTimeString(
      "en-US",
      { hour: "2-digit", minute: "2-digit" }
    );
  }

  function openEditProfileModal(targetUserId) {
    const uid =
      typeof targetUserId === "string" && state.store.users[targetUserId]
        ? targetUserId
        : state.myUserId;
    state.editingUserId = uid;

    const user = state.store.users[uid];
    if (!user) return;

    state.editAvatarDataUrl = user.avatar_url || createSvgAvatarDataUrl(user.display_name, 0);

    document.getElementById("edit-profile-modal-title").textContent =
      uid === state.myUserId ? "Edit your profile" : `Edit ${user.display_name}'s profile`;
    document.getElementById("edit-avatar-preview").src = state.editAvatarDataUrl;
    document.getElementById("edit-display-name").value = user.display_name;
    document.getElementById("edit-username").value = user.username;
    document.getElementById("edit-status-text").value = user.status_text || "";
    document.getElementById("edit-profile-error").classList.add("hidden");

    document.getElementById("edit-profile-modal").classList.remove("hidden");
  }

  function closeEditProfileModal() {
    document.getElementById("edit-profile-modal").classList.add("hidden");
  }

  async function handleSaveEditProfile(e) {
    e.preventDefault();
    const uid = state.editingUserId || state.myUserId;
    const user = state.store.users[uid];
    if (!user) return;

    const errBox = document.getElementById("edit-profile-error");
    errBox.classList.add("hidden");

    const displayName = document.getElementById("edit-display-name").value.trim();
    const rawUsername = document.getElementById("edit-username").value;
    const username = normalizeUsername(rawUsername);
    const statusText = document.getElementById("edit-status-text").value.trim();

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

    const updatedUser = {
      ...user,
      display_name: displayName,
      username: username,
      status_text: statusText || "Active in Slack",
      avatar_url: state.editAvatarDataUrl || user.avatar_url,
      updated_at: Date.now(),
      last_seen: new Date().toISOString()
    };

    state.store.users[uid] = updatedUser;
    saveLocalCache(true);
    renderAll(true);
    closeEditProfileModal();

    await callVercelApi({
      action: "update_profile",
      user: updatedUser
    });
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
    // Switch User buttons (Topbar & Sidebar)
    document
      .getElementById("topbar-switch-user-btn")
      .addEventListener("click", switchActiveUserSeat);
    document.getElementById("btn-switch-user").addEventListener("click", switchActiveUserSeat);

    // Edit Profile triggers
    document
      .getElementById("topbar-user-btn")
      .addEventListener("click", () => openEditProfileModal(state.myUserId));
    document
      .getElementById("sidebar-my-profile-trigger")
      .addEventListener("click", () => openEditProfileModal(state.myUserId));
    document
      .getElementById("btn-open-edit-profile")
      .addEventListener("click", () => openEditProfileModal(state.myUserId));
    document.getElementById("drawer-edit-profile-btn").addEventListener("click", () => {
      openEditProfileModal(state.drawerUserId || state.myUserId);
    });

    // Edit Profile Modal controls
    document
      .getElementById("btn-close-edit-profile")
      .addEventListener("click", closeEditProfileModal);
    document
      .getElementById("btn-cancel-edit-profile")
      .addEventListener("click", closeEditProfileModal);
    document
      .getElementById("edit-profile-form")
      .addEventListener("submit", handleSaveEditProfile);

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

    // Mobile Sidebar menu
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

    // Composer formatting toolbar
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

  function bootstrap() {
    loadLocalCache();
    renderPresetAvatarStrips();
    renderEmojiPopover();
    bindAllEvents();
    renderAll(false);
    startRealtimeSync();
    document.getElementById("composer-input").focus();
  }

  document.addEventListener("DOMContentLoaded", bootstrap);
})();
