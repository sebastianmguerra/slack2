// ============================================================================
// SLACK 1-ON-1 PERSONAL CHAT CLONE — LÓGICA PRINCIPAL (SUPABASE + LOCAL FALLBACK)
// ============================================================================

(function () {
  "use strict";

  // --- Constantes de Almacenamiento Local ---
  const STORAGE_KEYS = {
    SESSION_USER_ID: "slack_clone_session_uid_v1",
    ACTIVE_PARTNER_ID: "slack_clone_partner_uid_v1",
    SUPABASE_CUSTOM_CFG: "slack_clone_supabase_cfg_v1",
    LOCAL_USERS: "slack_clone_local_users_v1",
    LOCAL_MESSAGES: "slack_clone_local_messages_v1"
  };

  // --- Paleta de colores oficial de avatares de Slack ---
  const SLACK_AVATAR_COLORS = [
    { bg: "#E01E5A", fg: "#FFFFFF" },
    { bg: "#36C5F0", fg: "#1D1C1D" },
    { bg: "#2EB67D", fg: "#FFFFFF" },
    { bg: "#ECB22E", fg: "#1D1C1D" },
    { bg: "#4A154B", fg: "#FFFFFF" },
    { bg: "#1264A3", fg: "#FFFFFF" }
  ];

  const EMOJI_LIST = [
    "👍", "❤️", "😂", "🎉", "🔥", "🙌",
    "👀", "✅", "🚀", "💯", "😄", "😎",
    "🤔", "👏", "✨", "💜", "🥳", "🤝"
  ];

  // --- Estado de la Aplicación ---
  const state = {
    mode: "local", // "supabase" | "local"
    supabase: null,
    realtimeChannel: null,
    pollTimer: null,
    heartbeatTimer: null,
    localChannel: null,

    authTab: "login", // "login" | "register"
    regAvatarDataUrl: "",
    editAvatarDataUrl: "",

    currentUser: null,
    users: [],
    activePartnerId: null,
    messages: [],
    searchQuery: "",
    pendingAttachment: null,
    drawerOpen: false,
    drawerUserId: null,

    onlineUserIds: new Set(),
    partnerTypingTimeout: null
  };

  // ==========================================================================
  // 1. UTILIDADES (AVATARES SVG, COMPRESIÓN DE IMAGEN, HASH DE CONTRASEÑA)
  // ==========================================================================

  function createSvgAvatarDataUrl(label, colorIndex = 0) {
    const clean = (label || "U").trim();
    const initials = clean
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

  // Recorta y comprime cualquier imagen subida a un cuadrado nítido para guardarla rápido en BD
  function compressImageFile(file, maxSize = 180, quality = 0.84) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith("image/")) {
        reject(new Error("Selecciona un archivo de imagen válido."));
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
            // Avatar cuadrado centrado
            const side = Math.min(width, height);
            const sx = (width - side) / 2;
            const sy = (height - side) / 2;
            canvas.width = maxSize;
            canvas.height = maxSize;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, sx, sy, side, side, 0, 0, maxSize, maxSize);
          } else {
            // Imagen adjunta en el chat manteniendo proporción
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
        img.onerror = () => reject(new Error("No se pudo procesar la imagen."));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error("Error al leer el archivo."));
      reader.readAsDataURL(file);
    });
  }

  // Hash determinista compatible tanto con HTTPS (Vercel) como con file:// local
  async function hashPassword(password, usernameSalt) {
    const raw = `slack_v1:${usernameSalt.toLowerCase()}:${password}`;
    if (window.crypto && window.crypto.subtle) {
      try {
        const msgBuffer = new TextEncoder().encode(raw);
        const hashBuffer = await window.crypto.subtle.digest("SHA-256", msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
      } catch (_) {
        // Fallback abajo si file:// bloquea subtle
      }
    }
    // Fallback determinista de 256 bits en JS puro
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

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Formateador de texto al estilo Slack (*negrita*, _cursiva_, ~tachado~, `código`, > cita, links)
  function formatSlackText(text) {
    if (!text) return "";
    let html = escapeHtml(text);

    // Bloques de código ```codigo```
    html = html.replace(/```([\s\S]*?)```/g, (_, code) => `<pre>${code.trim()}</pre>`);

    // Código en línea `codigo`
    html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");

    // Enlaces http/https
    html = html.replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );

    // Negrita *texto*
    html = html.replace(/(^|\s)\*([^*\n]+)\*(?=\s|$|[.,!?])/g, "$1<strong>$2</strong>");

    // Cursiva _texto_
    html = html.replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,!?])/g, "$1<em>$2</em>");

    // Tachado ~texto~
    html = html.replace(/(^|\s)~([^~\n]+)~(?=\s|$|[.,!?])/g, "$1<del>$2</del>");

    // Citas > texto
    html = html.replace(/(^|\n)&gt;\s?([^\n]+)/g, "$1<blockquote>$2</blockquote>");

    return html;
  }

  function formatTimeShort(isoStr) {
    const d = new Date(isoStr);
    return d.toLocaleTimeString("es-ES", { hour: "numeric", minute: "2-digit", hour12: true });
  }

  function formatTimeCompact(isoStr) {
    const d = new Date(isoStr);
    return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", hour12: false });
  }

  function formatDatePill(isoStr) {
    const d = new Date(isoStr);
    const now = new Date();
    const todayStr = now.toDateString();
    const yest = new Date(now);
    yest.setDate(now.getDate() - 1);

    if (d.toDateString() === todayStr) return "Hoy";
    if (d.toDateString() === yest.toDateString()) return "Ayer";

    return d.toLocaleDateString("es-ES", {
      weekday: "long",
      day: "numeric",
      month: "long"
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
  // 2. CONEXIÓN A SUPABASE O MODO LOCAL EN TIEMPO REAL
  // ==========================================================================

  function getResolvedSupabaseCredentials() {
    // 1. Verificar si el usuario guardó credenciales desde el modal del navegador
    try {
      const savedRaw = localStorage.getItem(STORAGE_KEYS.SUPABASE_CUSTOM_CFG);
      if (savedRaw) {
        const parsed = JSON.parse(savedRaw);
        if (parsed.url && parsed.anonKey) {
          return { url: parsed.url.trim(), anonKey: parsed.anonKey.trim() };
        }
      }
    } catch (_) {}

    // 2. Verificar js/config.js (o variables inyectadas por Vercel en build-config.js)
    const cfg = window.SLACK_CONFIG || {};
    if (cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY) {
      return {
        url: cfg.SUPABASE_URL.trim(),
        anonKey: cfg.SUPABASE_ANON_KEY.trim()
      };
    }

    return null;
  }

  async function initBackendConnection() {
    cleanupRealtimeSubscriptions();

    const creds = getResolvedSupabaseCredentials();
    if (creds && window.supabase && typeof window.supabase.createClient === "function") {
      try {
        state.supabase = window.supabase.createClient(creds.url, creds.anonKey, {
          auth: { persistSession: false }
        });
        state.mode = "supabase";
        updateDbBadges();
        return;
      } catch (err) {
        console.warn("No se pudo inicializar Supabase, usando modo local:", err);
      }
    }

    state.supabase = null;
    state.mode = "local";
    initLocalBroadcastChannel();
    updateDbBadges();
  }

  function initLocalBroadcastChannel() {
    if ("BroadcastChannel" in window && !state.localChannel) {
      state.localChannel = new BroadcastChannel("slack_clone_realtime_v1");
      state.localChannel.onmessage = (event) => {
        const data = event.data || {};
        if (data.type === "DB_UPDATED") {
          refreshUsersAndMessages();
        } else if (data.type === "TYPING" && state.currentUser) {
          if (data.userId !== state.currentUser.id && data.userId === state.activePartnerId) {
            showPartnerTyping(data.displayName);
          }
        }
      };
    }

    window.addEventListener("storage", (e) => {
      if (e.key === STORAGE_KEYS.LOCAL_USERS || e.key === STORAGE_KEYS.LOCAL_MESSAGES) {
        refreshUsersAndMessages();
      }
    });
  }

  function updateDbBadges() {
    const authPill = document.getElementById("auth-db-pill");
    const authLabel = document.getElementById("auth-db-label");
    const topBtn = document.getElementById("topbar-db-btn");
    const topText = document.getElementById("topbar-db-text");

    if (state.mode === "supabase") {
      authPill.classList.remove("local");
      authLabel.textContent = "Supabase Realtime activo";
      topBtn.classList.remove("local");
      topText.textContent = "Supabase Realtime";
    } else {
      authPill.classList.add("local");
      authLabel.textContent = "Modo Local (Clic para Supabase)";
      topBtn.classList.add("local");
      topText.textContent = "Conectar Supabase";
    }
  }

  // ==========================================================================
  // 3. CAPA DE DATOS (USUARIOS Y MENSAJES EN SUPABASE / LOCAL)
  // ==========================================================================

  function getLocalUsers() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.LOCAL_USERS) || "[]");
    } catch (_) {
      return [];
    }
  }

  function saveLocalUsers(users) {
    localStorage.setItem(STORAGE_KEYS.LOCAL_USERS, JSON.stringify(users));
    if (state.localChannel) {
      state.localChannel.postMessage({ type: "DB_UPDATED" });
    }
  }

  function getLocalMessages() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.LOCAL_MESSAGES) || "[]");
    } catch (_) {
      return [];
    }
  }

  function saveLocalMessages(msgs) {
    localStorage.setItem(STORAGE_KEYS.LOCAL_MESSAGES, JSON.stringify(msgs));
    if (state.localChannel) {
      state.localChannel.postMessage({ type: "DB_UPDATED" });
    }
  }

  async function dbFindUserByUsername(username) {
    const clean = normalizeUsername(username);
    if (state.mode === "supabase") {
      const { data, error } = await state.supabase
        .from("slack_users")
        .select("*")
        .ilike("username", clean)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data || null;
    } else {
      const users = getLocalUsers();
      return users.find((u) => normalizeUsername(u.username) === clean) || null;
    }
  }

  async function dbFindUserById(id) {
    if (!id) return null;
    if (state.mode === "supabase") {
      const { data, error } = await state.supabase
        .from("slack_users")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) return null;
      return data || null;
    } else {
      const users = getLocalUsers();
      return users.find((u) => u.id === id) || null;
    }
  }

  async function dbCreateUser({ username, displayName, avatarUrl, passwordHash }) {
    const cleanUsername = normalizeUsername(username);
    const nowIso = new Date().toISOString();

    if (state.mode === "supabase") {
      const { data, error } = await state.supabase
        .from("slack_users")
        .insert([
          {
            username: cleanUsername,
            display_name: displayName.trim(),
            avatar_url: avatarUrl,
            password_hash: passwordHash,
            last_seen: nowIso
          }
        ])
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return data;
    } else {
      const users = getLocalUsers();
      const newUser = {
        id: generateUuid(),
        username: cleanUsername,
        display_name: displayName.trim(),
        avatar_url: avatarUrl,
        password_hash: passwordHash,
        last_seen: nowIso,
        created_at: nowIso
      };
      users.push(newUser);
      saveLocalUsers(users);
      return newUser;
    }
  }

  async function dbUpdateUser(userId, updates) {
    const payload = {
      ...updates,
      last_seen: new Date().toISOString()
    };

    if (state.mode === "supabase") {
      const { data, error } = await state.supabase
        .from("slack_users")
        .update(payload)
        .eq("id", userId)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return data;
    } else {
      const users = getLocalUsers();
      const idx = users.findIndex((u) => u.id === userId);
      if (idx === -1) throw new Error("Usuario no encontrado.");
      users[idx] = { ...users[idx], ...payload };
      saveLocalUsers(users);
      return users[idx];
    }
  }

  async function dbFetchAllUsers() {
    if (state.mode === "supabase") {
      const { data, error } = await state.supabase
        .from("slack_users")
        .select("id, username, display_name, avatar_url, last_seen, created_at")
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return data || [];
    } else {
      return getLocalUsers();
    }
  }

  async function dbFetchMessages() {
    if (state.mode === "supabase") {
      const { data, error } = await state.supabase
        .from("slack_messages")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(500);
      if (error) throw new Error(error.message);
      return data || [];
    } else {
      return getLocalMessages();
    }
  }

  async function dbInsertMessage({ senderId, receiverId, content, imageUrl }) {
    const nowIso = new Date().toISOString();
    if (state.mode === "supabase") {
      const { data, error } = await state.supabase
        .from("slack_messages")
        .insert([
          {
            sender_id: senderId,
            receiver_id: receiverId || null,
            content: content,
            image_url: imageUrl || null,
            reactions: {}
          }
        ])
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return data;
    } else {
      const msgs = getLocalMessages();
      const newMsg = {
        id: generateUuid(),
        sender_id: senderId,
        receiver_id: receiverId || null,
        content: content,
        image_url: imageUrl || null,
        reactions: {},
        created_at: nowIso
      };
      msgs.push(newMsg);
      saveLocalMessages(msgs);
      return newMsg;
    }
  }

  async function dbUpdateMessageReactions(msgId, reactions) {
    if (state.mode === "supabase") {
      const { error } = await state.supabase
        .from("slack_messages")
        .update({ reactions })
        .eq("id", msgId);
      if (error) throw new Error(error.message);
    } else {
      const msgs = getLocalMessages();
      const idx = msgs.findIndex((m) => m.id === msgId);
      if (idx !== -1) {
        msgs[idx].reactions = reactions;
        saveLocalMessages(msgs);
      }
    }
  }

  async function dbDeleteMessage(msgId) {
    if (state.mode === "supabase") {
      const { error } = await state.supabase
        .from("slack_messages")
        .delete()
        .eq("id", msgId);
      if (error) throw new Error(error.message);
    } else {
      const msgs = getLocalMessages().filter((m) => m.id !== msgId);
      saveLocalMessages(msgs);
    }
  }

  // ==========================================================================
  // 4. SUSCRIPCIÓN REALTIME DE SUPABASE (MENSAJES, PERFILES Y TYPING)
  // ==========================================================================

  function cleanupRealtimeSubscriptions() {
    if (state.realtimeChannel && state.supabase) {
      try {
        state.supabase.removeChannel(state.realtimeChannel);
      } catch (_) {}
      state.realtimeChannel = null;
    }
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
    if (state.heartbeatTimer) {
      clearInterval(state.heartbeatTimer);
      state.heartbeatTimer = null;
    }
  }

  function setupRealtimeForLoggedUser() {
    cleanupRealtimeSubscriptions();
    if (!state.currentUser) return;

    if (state.mode === "supabase" && state.supabase) {
      const channel = state.supabase.channel("slack-personal-room", {
        config: {
          presence: { key: state.currentUser.id }
        }
      });

      // Cambios en tiempo real en la tabla de mensajes
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "slack_messages" },
        () => {
          refreshMessagesOnly();
        }
      );

      // Cambios en tiempo real en la tabla de usuarios (foto de perfil, nombre, @usuario)
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "slack_users" },
        () => {
          refreshUsersAndMessages();
        }
      );

      // Indicador "está escribiendo..." en vivo
      channel.on("broadcast", { event: "typing" }, ({ payload }) => {
        if (
          payload &&
          payload.userId !== state.currentUser.id &&
          payload.userId === state.activePartnerId
        ) {
          showPartnerTyping(payload.displayName);
        }
      });

      // Presencia en línea
      channel.on("presence", { event: "sync" }, () => {
        const presenceState = channel.presenceState();
        state.onlineUserIds = new Set(Object.keys(presenceState));
        renderSidebarUsers();
        renderChatHeader();
        if (state.drawerOpen) renderProfileDrawer();
      });

      channel.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({
            user_id: state.currentUser.id,
            online_at: new Date().toISOString()
          });
        }
      });

      state.realtimeChannel = channel;

      // Respaldo de sincronización cada 4s y latido de presencia cada 25s
      state.pollTimer = setInterval(() => {
        refreshUsersAndMessages(true);
      }, 4000);

      state.heartbeatTimer = setInterval(() => {
        if (state.currentUser) {
          dbUpdateUser(state.currentUser.id, {}).catch(() => {});
        }
      }, 25000);
    }
  }

  function sendTypingSignal() {
    if (!state.currentUser) return;
    if (state.mode === "supabase" && state.realtimeChannel) {
      state.realtimeChannel.send({
        type: "broadcast",
        event: "typing",
        payload: {
          userId: state.currentUser.id,
          displayName: state.currentUser.display_name
        }
      });
    } else if (state.localChannel) {
      state.localChannel.postMessage({
        type: "TYPING",
        userId: state.currentUser.id,
        displayName: state.currentUser.display_name
      });
    }
  }

  function showPartnerTyping(displayName) {
    const el = document.getElementById("typing-indicator-text");
    if (!el) return;
    el.innerHTML = `<strong>${escapeHtml(displayName)}</strong> está escribiendo...`;
    if (state.partnerTypingTimeout) clearTimeout(state.partnerTypingTimeout);
    state.partnerTypingTimeout = setTimeout(() => {
      el.textContent = "";
    }, 2600);
  }

  function isUserOnline(user) {
    if (!user) return false;
    if (state.currentUser && user.id === state.currentUser.id) return true;
    if (state.onlineUserIds.has(user.id)) return true;
    if (user.last_seen) {
      const diffMs = Date.now() - new Date(user.last_seen).getTime();
      if (diffMs < 65000) return true;
    }
    return state.mode === "local";
  }

  // ==========================================================================
  // 5. FLUJO DE AUTENTICACIÓN (LOGIN & REGISTRO SOLO CON USUARIO Y CONTRASEÑA)
  // ==========================================================================

  function switchAuthTab(tab) {
    state.authTab = tab;
    const tabLogin = document.getElementById("tab-login");
    const tabRegister = document.getElementById("tab-register");
    const extraFields = document.getElementById("register-extra-fields");
    const title = document.getElementById("auth-title");
    const subtitle = document.getElementById("auth-subtitle");
    const submitBtn = document.getElementById("auth-submit-btn");
    const errorBox = document.getElementById("auth-error-box");

    errorBox.classList.add("hidden");

    if (tab === "login") {
      tabLogin.classList.add("active");
      tabRegister.classList.remove("active");
      extraFields.classList.add("hidden");
      title.textContent = "Inicia sesión en el chat";
      subtitle.textContent = "Ingresa con tu usuario y contraseña para continuar";
      submitBtn.textContent = "Iniciar sesión";
    } else {
      tabRegister.classList.add("active");
      tabLogin.classList.remove("active");
      extraFields.classList.remove("hidden");
      title.textContent = "Crea tu perfil de Slack";
      subtitle.textContent = "Elige tu foto de perfil, nombre, @usuario y contraseña";
      submitBtn.textContent = "Crear cuenta y entrar";
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
    const username = normalizeUsername(rawUsername);

    if (!username || username.length < 2) {
      showAuthError("Ingresa un nombre de usuario válido (mínimo 2 caracteres).");
      return;
    }
    if (!password || password.length < 3) {
      showAuthError("Ingresa una contraseña de al menos 3 caracteres.");
      return;
    }

    const submitBtn = document.getElementById("auth-submit-btn");
    submitBtn.disabled = true;

    try {
      const passwordHash = await hashPassword(password, username);

      if (state.authTab === "login") {
        const user = await dbFindUserByUsername(username);
        if (!user) {
          showAuthError(`No existe ninguna cuenta con el usuario @${username}.`);
          return;
        }
        if (user.password_hash !== passwordHash) {
          showAuthError("Contraseña incorrecta. Inténtalo de nuevo.");
          return;
        }
        await completeLogin(user);
      } else {
        const displayNameInput = document.getElementById("reg-display-name").value.trim();
        const displayName = displayNameInput || rawUsername.trim();

        const existing = await dbFindUserByUsername(username);
        if (existing) {
          showAuthError(`El usuario @${username} ya está registrado. Inicia sesión o elige otro.`);
          return;
        }

        const avatarUrl =
          state.regAvatarDataUrl || createSvgAvatarDataUrl(displayName, username.length);

        const newUser = await dbCreateUser({
          username,
          displayName,
          avatarUrl,
          passwordHash
        });

        await completeLogin(newUser);
      }
    } catch (err) {
      showAuthError(
        err.message && err.message.includes("slack_users")
          ? "Falta ejecutar supabase/schema.sql en el SQL Editor de tu proyecto Supabase."
          : err.message || "Error al autenticar."
      );
    } finally {
      submitBtn.disabled = false;
    }
  }

  async function completeLogin(user) {
    state.currentUser = user;
    localStorage.setItem(STORAGE_KEYS.SESSION_USER_ID, user.id);

    document.getElementById("auth-screen").classList.add("hidden");
    document.getElementById("slack-app").classList.remove("hidden");

    const wsName = (window.SLACK_CONFIG && window.SLACK_CONFIG.WORKSPACE_NAME) || "Slack Chat";
    document.getElementById("workspace-name-label").textContent = wsName;

    renderCurrentUserBadges();
    await refreshUsersAndMessages();
    setupRealtimeForLoggedUser();
    document.getElementById("composer-input").focus();
  }

  function handleLogout() {
    cleanupRealtimeSubscriptions();
    state.currentUser = null;
    state.activePartnerId = null;
    localStorage.removeItem(STORAGE_KEYS.SESSION_USER_ID);

    document.getElementById("slack-app").classList.add("hidden");
    document.getElementById("auth-screen").classList.remove("hidden");
    document.getElementById("auth-password").value = "";
  }

  // ==========================================================================
  // 6. SINCRONIZACIÓN Y RENDERIZADO DE LA UI DE SLACK
  // ==========================================================================

  async function refreshUsersAndMessages(silent = false) {
    if (!state.currentUser) return;
    try {
      const [users, messages] = await Promise.all([dbFetchAllUsers(), dbFetchMessages()]);
      state.users = users;
      state.messages = messages;

      // Actualizar datos propios si cambiaron
      const updatedMe = users.find((u) => u.id === state.currentUser.id);
      if (updatedMe) {
        state.currentUser = { ...state.currentUser, ...updatedMe };
        renderCurrentUserBadges();
      }

      // Seleccionar automáticamente a la otra persona del chat 1 a 1
      selectDefaultPartnerIfNeeded();

      renderSidebarUsers();
      renderChatHeader();
      renderMessagesList(silent);
      if (state.drawerOpen) renderProfileDrawer();
    } catch (err) {
      if (!silent) console.warn("Error al sincronizar:", err);
    }
  }

  async function refreshMessagesOnly() {
    if (!state.currentUser) return;
    try {
      state.messages = await dbFetchMessages();
      renderMessagesList(false);
    } catch (_) {}
  }

  function selectDefaultPartnerIfNeeded() {
    if (!state.currentUser) return;
    const otherUsers = state.users.filter((u) => u.id !== state.currentUser.id);

    // Si el usuario estaba en su propio chat "(tú)" esperando a que se registrara la 2da persona,
    // en cuanto existe la otra persona la seleccionamos automáticamente
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

    // Si aún no hay un segundo usuario registrado, mostrar el espacio propio
    if (!state.activePartnerId) {
      state.activePartnerId = state.currentUser.id;
    }
  }

  function getActivePartner() {
    if (!state.currentUser) return null;
    return (
      state.users.find((u) => u.id === state.activePartnerId) ||
      state.users.find((u) => u.id !== state.currentUser.id) ||
      state.currentUser
    );
  }

  function renderCurrentUserBadges() {
    const me = state.currentUser;
    if (!me) return;
    const avatar = me.avatar_url || createSvgAvatarDataUrl(me.display_name, 0);

    document.getElementById("topbar-user-avatar").src = avatar;
    document.getElementById("sidebar-my-avatar").src = avatar;
    document.getElementById("sidebar-my-name").textContent = me.display_name;
    document.getElementById("sidebar-my-username").textContent = `@${me.username}`;
  }

  function renderSidebarUsers() {
    const listEl = document.getElementById("dm-users-list");
    if (!listEl || !state.currentUser) return;

    const partner = getActivePartner();
    const otherUsers = state.users.filter((u) => u.id !== state.currentUser.id);

    // Ordenar: primero la otra persona (chat 1 a 1), luego "(tú)"
    const ordered = [...otherUsers, state.currentUser];

    let html = "";
    ordered.forEach((u) => {
      const isMe = u.id === state.currentUser.id;
      const isActive = partner && u.id === partner.id;
      const online = isUserOnline(u);
      const avatar = u.avatar_url || createSvgAvatarDataUrl(u.display_name, 1);

      html += `
        <div class="dm-item ${isActive ? "active" : ""}" data-userid="${escapeHtml(u.id)}">
          <div class="dm-avatar-wrap">
            <img class="dm-avatar" src="${escapeHtml(avatar)}" alt="${escapeHtml(u.display_name)}" />
            <span class="dm-presence-dot ${online ? "" : "offline"}"></span>
          </div>
          <div class="dm-name-wrap">
            <span class="dm-display-name">${escapeHtml(u.display_name)}${isMe ? " (tú)" : ""}</span>
            <span class="dm-username-tag">@${escapeHtml(u.username)}</span>
          </div>
        </div>
      `;
    });

    if (otherUsers.length === 0) {
      html += `
        <div class="dm-empty-hint">
          💬 Cuando la 2ª persona cree su cuenta con usuario y contraseña, aparecerá aquí automáticamente en tiempo real.
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
        renderMessagesList();
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
    if (!partner) return;

    const isMe = state.currentUser && partner.id === state.currentUser.id;
    const avatar = partner.avatar_url || createSvgAvatarDataUrl(partner.display_name, 1);
    const online = isUserOnline(partner);

    document.getElementById("chat-header-avatar").src = avatar;
    document.getElementById("chat-header-name").textContent =
      partner.display_name + (isMe ? " (tú)" : "");
    document.getElementById("chat-header-username").textContent = `@${partner.username}`;

    const presenceEl = document.getElementById("chat-header-presence");
    if (online) {
      presenceEl.classList.remove("offline");
    } else {
      presenceEl.classList.add("offline");
    }

    const composerInput = document.getElementById("composer-input");
    composerInput.placeholder = isMe
      ? `Escribe una nota o mensaje de prueba (@${partner.username})...`
      : `Enviar un mensaje a ${partner.display_name} (@${partner.username})`;
  }

  function getFilteredConversationMessages() {
    const me = state.currentUser;
    const partner = getActivePartner();
    if (!me || !partner) return [];

    const isSelfChat = me.id === partner.id;

    return state.messages.filter((m) => {
      // Filtrar por par de usuarios
      let belongsToPair = false;
      if (isSelfChat) {
        belongsToPair = m.sender_id === me.id && (!m.receiver_id || m.receiver_id === me.id);
      } else {
        belongsToPair =
          (m.sender_id === me.id && (m.receiver_id === partner.id || !m.receiver_id)) ||
          (m.sender_id === partner.id && (m.receiver_id === me.id || !m.receiver_id));
      }
      if (!belongsToPair) return false;

      // Filtro de búsqueda superior en vivo
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

    const userMap = new Map();
    state.users.forEach((u) => userMap.set(u.id, u));
    userMap.set(state.currentUser.id, state.currentUser);

    const msgs = getFilteredConversationMessages();

    // Cabecera de presentación de la conversación estilo Slack DM
    let html = `
      <div class="dm-conversation-hero">
        <div class="dm-hero-card">
          <img class="dm-hero-avatar" data-profile-uid="${escapeHtml(partner.id)}" src="${escapeHtml(partnerAvatar)}" alt="${escapeHtml(partner.display_name)}" />
          <div>
            <div class="dm-hero-title">
              <span>${escapeHtml(partner.display_name)}${isMe ? " (tú)" : ""}</span>
            </div>
            <div class="dm-hero-handle">@${escapeHtml(partner.username)}</div>
          </div>
        </div>
        <p class="dm-hero-description">
          ${
            isMe
              ? `<strong>Este es tu espacio personal.</strong> Puedes probar el chat aquí o abrir otra ventana con otro usuario para conversar en tiempo real.`
              : `Este es el comienzo de tu historial de mensajes directos con <strong>${escapeHtml(partner.display_name)}</strong> (<code>@${escapeHtml(partner.username)}</code>).`
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

      const sender = userMap.get(msg.sender_id) || {
        id: msg.sender_id,
        display_name: "Usuario",
        username: "usuario",
        avatar_url: createSvgAvatarDataUrl("U", 2)
      };

      const msgTimeMs = new Date(msg.created_at).getTime();
      const isCompact =
        prevSenderId === msg.sender_id && msgTimeMs - prevTimestampMs < 5 * 60 * 1000;

      prevSenderId = msg.sender_id;
      prevTimestampMs = msgTimeMs;

      const senderAvatar = sender.avatar_url || createSvgAvatarDataUrl(sender.display_name, 2);
      const isOwnMsg = msg.sender_id === state.currentUser.id;

      // Renderizar reacciones
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
        ? `<img class="msg-attached-image" src="${escapeHtml(msg.image_url)}" alt="Imagen enviada" />`
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

          <!-- Barra flotante de acciones estilo Slack -->
          <div class="msg-hover-toolbar">
            <button type="button" class="hover-tool-btn" data-react-msgid="${escapeHtml(msg.id)}" data-react-emoji="👍" title="Me gusta">👍</button>
            <button type="button" class="hover-tool-btn" data-react-msgid="${escapeHtml(msg.id)}" data-react-emoji="❤️" title="Me encanta">❤️</button>
            <button type="button" class="hover-tool-btn" data-react-msgid="${escapeHtml(msg.id)}" data-react-emoji="😂" title="Risa">😂</button>
            <button type="button" class="hover-tool-btn" data-react-msgid="${escapeHtml(msg.id)}" data-react-emoji="🎉" title="Celebrar">🎉</button>
            <button type="button" class="hover-tool-btn" data-react-msgid="${escapeHtml(msg.id)}" data-react-emoji="🔥" title="Fuego">🔥</button>
            ${
              isOwnMsg
                ? `<button type="button" class="hover-tool-btn delete-btn" data-delete-msgid="${escapeHtml(msg.id)}" title="Eliminar mensaje">🗑️</button>`
                : ""
            }
          </div>
        </div>
      `;
    });

    viewport.innerHTML = html;

    // Eventos de clic en fotos/nombres para abrir el panel de Perfil de Slack
    viewport.querySelectorAll("[data-profile-uid]").forEach((el) => {
      el.addEventListener("click", () => {
        openProfileDrawer(el.getAttribute("data-profile-uid"));
      });
    });

    // Eventos de reacciones
    viewport.querySelectorAll("[data-react-msgid]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const msgId = btn.getAttribute("data-react-msgid");
        const emoji = btn.getAttribute("data-react-emoji");
        toggleMessageReaction(msgId, emoji);
      });
    });

    // Evento de eliminar mensaje propio
    viewport.querySelectorAll("[data-delete-msgid]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const msgId = btn.getAttribute("data-delete-msgid");
        await dbDeleteMessage(msgId);
        await refreshMessagesOnly();
      });
    });

    if (!preserveScrollIfNotBottom || wasNearBottom) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }

  // ==========================================================================
  // 7. ENVÍO DE MENSAJES, FORMATO Y REACCIONES
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

    try {
      await dbInsertMessage({
        senderId: state.currentUser.id,
        receiverId: partner ? partner.id : null,
        content: text,
        imageUrl: attachment
      });
      await refreshMessagesOnly();
    } catch (err) {
      alert("Error al enviar el mensaje: " + (err.message || err));
    }
  }

  async function toggleMessageReaction(msgId, emoji) {
    if (!state.currentUser) return;
    const msg = state.messages.find((m) => m.id === msgId);
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
    renderMessagesList(true);
    await dbUpdateMessageReactions(msgId, reactions);
  }

  function applyFormatToComposer(formatType) {
    const textarea = document.getElementById("composer-input");
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.substring(start, end) || "texto";

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
  // 8. PANEL LATERAL DE PERFIL Y MODAL DE EDITAR PERFIL
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
    const user =
      state.users.find((u) => u.id === targetId) ||
      (state.currentUser && state.currentUser.id === targetId ? state.currentUser : getActivePartner());

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
      label.textContent = "Activo ahora";
    } else {
      dot.classList.add("offline");
      label.textContent = "Desconectado";
    }

    const editBtn = document.getElementById("drawer-edit-my-profile-btn");
    if (isMe) {
      editBtn.classList.remove("hidden");
    } else {
      editBtn.classList.add("hidden");
    }

    document.getElementById("drawer-info-fullname").textContent = user.display_name;
    document.getElementById("drawer-info-handle").textContent = `@${user.username}`;
    document.getElementById("drawer-info-localtime").textContent = new Date().toLocaleTimeString(
      "es-ES",
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
    const newPassword = document.getElementById("edit-new-password").value;

    if (!displayName) {
      errBox.textContent = "El nombre visible no puede estar vacío.";
      errBox.classList.remove("hidden");
      return;
    }
    if (!username || username.length < 2) {
      errBox.textContent = "El @usuario debe tener al menos 2 caracteres.";
      errBox.classList.remove("hidden");
      return;
    }

    try {
      // Si cambió su @usuario, verificar que no esté ocupado
      if (username !== state.currentUser.username) {
        const existing = await dbFindUserByUsername(username);
        if (existing && existing.id !== state.currentUser.id) {
          errBox.textContent = `El usuario @${username} ya está en uso por otra persona.`;
          errBox.classList.remove("hidden");
          return;
        }
      }

      const updates = {
        display_name: displayName,
        username: username,
        avatar_url: state.editAvatarDataUrl || state.currentUser.avatar_url
      };

      if (newPassword && newPassword.trim().length > 0) {
        if (newPassword.length < 3) {
          errBox.textContent = "La nueva contraseña debe tener al menos 3 caracteres.";
          errBox.classList.remove("hidden");
          return;
        }
        updates.password_hash = await hashPassword(newPassword, username);
      } else if (username !== state.currentUser.username) {
        // Nota: mantenemos el hash actual si no ingresó nueva contraseña
      }

      const updatedUser = await dbUpdateUser(state.currentUser.id, updates);
      state.currentUser = updatedUser;
      renderCurrentUserBadges();
      await refreshUsersAndMessages();
      closeEditProfileModal();
    } catch (err) {
      errBox.textContent = err.message || "No se pudo actualizar el perfil.";
      errBox.classList.remove("hidden");
    }
  }

  // ==========================================================================
  // 9. MODAL DE CONFIGURACIÓN DE SUPABASE
  // ==========================================================================

  function openSupabaseModal() {
    const creds = getResolvedSupabaseCredentials();
    document.getElementById("cfg-supabase-url").value = creds ? creds.url : "";
    document.getElementById("cfg-supabase-key").value = creds ? creds.anonKey : "";
    document.getElementById("supabase-config-modal").classList.remove("hidden");
  }

  function closeSupabaseModal() {
    document.getElementById("supabase-config-modal").classList.add("hidden");
  }

  async function handleSaveSupabaseConfig(e) {
    e.preventDefault();
    const url = document.getElementById("cfg-supabase-url").value.trim();
    const anonKey = document.getElementById("cfg-supabase-key").value.trim();

    if (url && anonKey) {
      localStorage.setItem(
        STORAGE_KEYS.SUPABASE_CUSTOM_CFG,
        JSON.stringify({ url, anonKey })
      );
    } else {
      localStorage.removeItem(STORAGE_KEYS.SUPABASE_CUSTOM_CFG);
    }

    closeSupabaseModal();
    await initBackendConnection();
    if (state.currentUser) {
      handleLogout();
    }
  }

  // ==========================================================================
  // 10. INICIALIZACIÓN Y EVENTOS DEL DOM
  // ==========================================================================

  function renderPresetAvatarStrips() {
    const presets = getPresetAvatars();
    state.regAvatarDataUrl = presets[0];
    document.getElementById("reg-avatar-preview").src = presets[0];

    const regStrip = document.getElementById("reg-preset-avatars");
    const editStrip = document.getElementById("edit-preset-avatars");

    regStrip.innerHTML = presets
      .map(
        (src, i) =>
          `<img class="preset-avatar-thumb ${i === 0 ? "selected" : ""}" data-preset-src="${escapeHtml(src)}" src="${escapeHtml(src)}" alt="Avatar ${i + 1}" />`
      )
      .join("");

    editStrip.innerHTML = presets
      .map(
        (src, i) =>
          `<img class="preset-avatar-thumb" data-edit-preset-src="${escapeHtml(src)}" src="${escapeHtml(src)}" alt="Avatar ${i + 1}" />`
      )
      .join("");

    regStrip.querySelectorAll("[data-preset-src]").forEach((img) => {
      img.addEventListener("click", () => {
        regStrip.querySelectorAll(".preset-avatar-thumb").forEach((el) => el.classList.remove("selected"));
        img.classList.add("selected");
        state.regAvatarDataUrl = img.getAttribute("data-preset-src");
        document.getElementById("reg-avatar-preview").src = state.regAvatarDataUrl;
      });
    });

    editStrip.querySelectorAll("[data-edit-preset-src]").forEach((img) => {
      img.addEventListener("click", () => {
        editStrip.querySelectorAll(".preset-avatar-thumb").forEach((el) => el.classList.remove("selected"));
        img.classList.add("selected");
        state.editAvatarDataUrl = img.getAttribute("data-edit-preset-src");
        document.getElementById("edit-avatar-preview").src = state.editAvatarDataUrl;
      });
    });
  }

  function renderEmojiPopover() {
    const pop = document.getElementById("emoji-popover");
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
    // Pestañas Login / Crear cuenta
    document.getElementById("tab-login").addEventListener("click", () => switchAuthTab("login"));
    document.getElementById("tab-register").addEventListener("click", () => switchAuthTab("register"));
    document.getElementById("auth-form").addEventListener("submit", handleAuthSubmit);

    // Subir foto en Registro
    document.getElementById("reg-avatar-file").addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const dataUrl = await compressImageFile(file, 160, 0.85);
        state.regAvatarDataUrl = dataUrl;
        document.getElementById("reg-avatar-preview").src = dataUrl;
      } catch (err) {
        alert(err.message);
      }
    });

    document.getElementById("reg-avatar-url-btn").addEventListener("click", () => {
      const url = prompt("Pega la URL de tu foto de perfil (https://...):");
      if (url && url.trim()) {
        state.regAvatarDataUrl = url.trim();
        document.getElementById("reg-avatar-preview").src = url.trim();
      }
    });

    // Subir foto en Editar Perfil
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
      const url = prompt("Pega la URL de tu foto de perfil (https://...):", state.editAvatarDataUrl);
      if (url && url.trim()) {
        state.editAvatarDataUrl = url.trim();
        document.getElementById("edit-avatar-preview").src = url.trim();
      }
    });

    // Botones de Editar Perfil y Cerrar Sesión
    document.getElementById("topbar-user-btn").addEventListener("click", openEditProfileModal);
    document.getElementById("sidebar-my-profile-trigger").addEventListener("click", openEditProfileModal);
    document.getElementById("btn-open-edit-profile").addEventListener("click", openEditProfileModal);
    document.getElementById("drawer-edit-my-profile-btn").addEventListener("click", openEditProfileModal);
    document.getElementById("btn-close-edit-profile").addEventListener("click", closeEditProfileModal);
    document.getElementById("btn-cancel-edit-profile").addEventListener("click", closeEditProfileModal);
    document.getElementById("edit-profile-form").addEventListener("submit", handleSaveEditProfile);
    document.getElementById("btn-logout").addEventListener("click", handleLogout);

    // Panel derecho de Perfil (Slack Drawer)
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

    // Menú móvil
    document.getElementById("mobile-menu-toggle").addEventListener("click", () => {
      document.getElementById("slack-sidebar").classList.toggle("open");
    });

    // Búsqueda en la conversación
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

    // Composer de mensajes
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

    // Barra de formato del composer
    document.querySelectorAll(".format-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        applyFormatToComposer(btn.getAttribute("data-format"));
      });
    });

    // Adjuntar imagen en el chat
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

    // Selector de emojis
    const emojiBtn = document.getElementById("btn-emoji-picker");
    const emojiPop = document.getElementById("emoji-popover");
    emojiBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      emojiPop.classList.toggle("hidden");
    });
    document.addEventListener("click", () => {
      emojiPop.classList.add("hidden");
    });

    // Modal de Supabase
    document.getElementById("auth-db-pill").addEventListener("click", openSupabaseModal);
    document.getElementById("topbar-db-btn").addEventListener("click", openSupabaseModal);
    document.getElementById("btn-close-supabase-modal").addEventListener("click", closeSupabaseModal);
    document.getElementById("supabase-config-form").addEventListener("submit", handleSaveSupabaseConfig);
    document.getElementById("btn-clear-supabase-cfg").addEventListener("click", async () => {
      localStorage.removeItem(STORAGE_KEYS.SUPABASE_CUSTOM_CFG);
      closeSupabaseModal();
      await initBackendConnection();
    });
  }

  async function bootstrap() {
    renderPresetAvatarStrips();
    renderEmojiPopover();
    bindAllEvents();
    await initBackendConnection();

    // Restaurar sesión activa si existe
    const savedUid = localStorage.getItem(STORAGE_KEYS.SESSION_USER_ID);
    if (savedUid) {
      const existingUser = await dbFindUserById(savedUid);
      if (existingUser) {
        await completeLogin(existingUser);
      } else {
        localStorage.removeItem(STORAGE_KEYS.SESSION_USER_ID);
      }
    }
  }

  document.addEventListener("DOMContentLoaded", bootstrap);
})();
