const fs = require("fs");
const path = require("path");

const TMP_FILE = path.join("/tmp", "slack_1on1_store_v4.json");
const CURRENT_EPOCH = 4;

function getDefaultStore() {
  return {
    epoch: CURRENT_EPOCH,
    resetAt: 0,
    clearedAt: 0,
    deletedIds: [],
    users: {},
    messages: [],
    typing: {}
  };
}

function loadStore() {
  if (global.__SLACK_CHAT_STORE_V4__ && global.__SLACK_CHAT_STORE_V4__.epoch === CURRENT_EPOCH) {
    return global.__SLACK_CHAT_STORE_V4__;
  }
  try {
    if (fs.existsSync(TMP_FILE)) {
      const raw = fs.readFileSync(TMP_FILE, "utf8");
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        parsed.epoch === CURRENT_EPOCH &&
        parsed.users &&
        Array.isArray(parsed.messages)
      ) {
        global.__SLACK_CHAT_STORE_V4__ = parsed;
        return parsed;
      }
    }
  } catch (_) {}

  const initial = getDefaultStore();
  global.__SLACK_CHAT_STORE_V4__ = initial;
  saveStore(initial);
  return initial;
}

function saveStore(store) {
  global.__SLACK_CHAT_STORE_V4__ = store;
  try {
    fs.writeFileSync(TMP_FILE, JSON.stringify(store), "utf8");
  } catch (_) {}
}

function mergeClientSnapshot(store, snapshot) {
  if (!snapshot || typeof snapshot !== "object") return false;
  if (snapshot.epoch !== CURRENT_EPOCH) return false;
  if ((snapshot.resetAt || 0) < (store.resetAt || 0)) return false;

  let modified = false;

  if (typeof snapshot.clearedAt === "number" && snapshot.clearedAt > (store.clearedAt || 0)) {
    store.clearedAt = snapshot.clearedAt;
    store.messages = store.messages.filter(
      (m) => new Date(m.created_at).getTime() > store.clearedAt
    );
    modified = true;
  }

  if (Array.isArray(snapshot.deletedIds) && snapshot.deletedIds.length > 0) {
    const prevLen = (store.deletedIds || []).length;
    const delSet = new Set([...(store.deletedIds || []), ...snapshot.deletedIds]);
    store.deletedIds = Array.from(delSet).slice(-1000);
    const prevMsgLen = store.messages.length;
    store.messages = store.messages.filter((m) => !delSet.has(m.id));
    if (store.deletedIds.length !== prevLen || store.messages.length !== prevMsgLen) {
      modified = true;
    }
  }

  if (snapshot.users && typeof snapshot.users === "object") {
    const incomingList = Array.isArray(snapshot.users)
      ? snapshot.users
      : Object.values(snapshot.users);

    for (const incoming of incomingList) {
      if (!incoming || !incoming.id || !incoming.username) continue;
      if ((incoming.updated_at || 0) <= (store.resetAt || 0)) continue;
      const current = store.users[incoming.id];
      if (!current || (incoming.updated_at || 0) > (current.updated_at || 0)) {
        store.users[incoming.id] = {
          id: String(incoming.id),
          username: String(incoming.username).toLowerCase().slice(0, 30),
          display_name: String(incoming.display_name || incoming.username).slice(0, 40),
          password_hash: String(incoming.password_hash || (current && current.password_hash) || ""),
          status_text: String(incoming.status_text || "Active in Slack").slice(0, 60),
          avatar_url: incoming.avatar_url || (current && current.avatar_url) || "",
          updated_at: incoming.updated_at || Date.now(),
          last_seen: incoming.last_seen || new Date().toISOString()
        };
        modified = true;
      }
    }
  }

  if (Array.isArray(snapshot.messages) && snapshot.messages.length > 0) {
    const delSet = new Set(store.deletedIds || []);
    const byId = new Map();
    for (const m of store.messages) {
      if (!delSet.has(m.id) && new Date(m.created_at).getTime() > (store.clearedAt || 0)) {
        byId.set(m.id, m);
      }
    }
    for (const m of snapshot.messages) {
      if (!m || !m.id || delSet.has(m.id)) continue;
      const createdMs = new Date(m.created_at).getTime() || 0;
      if (createdMs <= (store.clearedAt || 0) || createdMs <= (store.resetAt || 0)) continue;
      const existing = byId.get(m.id);
      if (!existing || (m.updated_at || 0) > (existing.updated_at || 0)) {
        byId.set(m.id, m);
        modified = true;
      }
    }
    store.messages = Array.from(byId.values())
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .slice(-1000);
  }

  return modified;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const store = loadStore();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  // Clean up expired typing indicators (> 3.5 seconds)
  for (const uid of Object.keys(store.typing || {})) {
    if (now - (store.typing[uid].timestamp || 0) > 3500) {
      delete store.typing[uid];
    }
  }

  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      epoch: CURRENT_EPOCH,
      resetAt: store.resetAt || 0,
      clearedAt: store.clearedAt || 0,
      deletedIds: store.deletedIds || [],
      users: Object.values(store.users),
      messages: store.messages,
      typing: store.typing
    });
  }

  if (req.method === "POST") {
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch (_) {
        body = {};
      }
    }
    body = body || {};

    const { action, activeUserId, snapshot } = body;

    if (action === "reset_all") {
      const fresh = getDefaultStore();
      fresh.resetAt = now;
      fresh.clearedAt = now;
      saveStore(fresh);
      return res.status(200).json({
        ok: true,
        epoch: CURRENT_EPOCH,
        resetAt: fresh.resetAt,
        clearedAt: fresh.clearedAt,
        deletedIds: [],
        users: [],
        messages: [],
        typing: {}
      });
    }

    let modified = false;
    if (snapshot) {
      modified = mergeClientSnapshot(store, snapshot);
    }

    if (activeUserId && store.users[activeUserId]) {
      store.users[activeUserId].last_seen = nowIso;
    }

    if (action === "register" && body.user) {
      const u = body.user;
      const cleanUsername = String(u.username || "")
        .trim()
        .toLowerCase();
      const existing = Object.values(store.users).find(
        (item) => item.username.toLowerCase() === cleanUsername && item.id !== u.id
      );
      if (existing) {
        return res.status(409).json({
          ok: false,
          error: `Username @${cleanUsername} is already taken. Please sign in or pick another.`
        });
      }
      store.users[u.id] = {
        id: String(u.id),
        username: cleanUsername.slice(0, 30),
        display_name: String(u.display_name || cleanUsername).slice(0, 40),
        password_hash: String(u.password_hash || ""),
        status_text: String(u.status_text || "Active in Slack").slice(0, 60),
        avatar_url: u.avatar_url || "",
        updated_at: now,
        last_seen: nowIso
      };
      saveStore(store);
    } else if (action === "login") {
      const cleanUsername = String(body.username || "")
        .trim()
        .toLowerCase();
      const found = Object.values(store.users).find(
        (item) => item.username.toLowerCase() === cleanUsername
      );
      if (!found) {
        return res.status(404).json({
          ok: false,
          error: `Account @${cleanUsername} not found. Switch to "Create Account" to register it.`
        });
      }
      if (found.password_hash && found.password_hash !== body.password_hash) {
        return res.status(401).json({
          ok: false,
          error: "Incorrect password. Please try again."
        });
      }
      found.last_seen = nowIso;
      saveStore(store);
    } else if (action === "send_message" && body.message) {
      const msg = body.message;
      if (msg.id && !store.messages.some((m) => m.id === msg.id)) {
        store.messages.push({
          id: String(msg.id),
          sender_id: String(msg.sender_id),
          receiver_id: msg.receiver_id ? String(msg.receiver_id) : null,
          content: String(msg.content || ""),
          image_url: msg.image_url || null,
          video_url: msg.video_url || null,
          audio_url: msg.audio_url || null,
          audio_duration: msg.audio_duration || null,
          reactions: msg.reactions || {},
          created_at: msg.created_at || nowIso,
          updated_at: now
        });
        if (store.messages.length > 1000) {
          store.messages = store.messages.slice(-1000);
        }
      }
      if (msg.sender_id && store.typing[msg.sender_id]) {
        delete store.typing[msg.sender_id];
      }
      saveStore(store);
    } else if (action === "delete_message" && body.messageId) {
      const msgId = String(body.messageId);
      store.deletedIds = Array.from(new Set([...(store.deletedIds || []), msgId])).slice(-1000);
      store.messages = store.messages.filter((m) => m.id !== msgId);
      saveStore(store);
    } else if (action === "toggle_reaction" && body.messageId) {
      const msg = store.messages.find((m) => m.id === body.messageId);
      if (msg && body.reactions) {
        msg.reactions = body.reactions;
        msg.updated_at = now;
        saveStore(store);
      }
    } else if (action === "update_profile" && body.user && body.user.id) {
      const u = body.user;
      const cleanUsername = String(u.username || "")
        .trim()
        .toLowerCase();
      const conflict = Object.values(store.users).find(
        (item) => item.username.toLowerCase() === cleanUsername && item.id !== u.id
      );
      if (conflict) {
        return res.status(409).json({
          ok: false,
          error: `Username @${cleanUsername} is already taken.`
        });
      }
      const existing = store.users[u.id] || {};
      store.users[u.id] = {
        ...existing,
        id: String(u.id),
        username: cleanUsername.slice(0, 30),
        display_name: String(u.display_name || cleanUsername).slice(0, 40),
        password_hash: u.password_hash || existing.password_hash || "",
        status_text: String(u.status_text || "Active in Slack").slice(0, 60),
        avatar_url: u.avatar_url || existing.avatar_url || "",
        updated_at: now,
        last_seen: nowIso
      };
      saveStore(store);
    } else if (action === "typing" && body.userId) {
      const uid = String(body.userId);
      store.typing[uid] = {
        userId: uid,
        displayName: String(body.displayName || "Someone"),
        timestamp: now
      };
    } else if (action === "clear_chat") {
      store.clearedAt = now;
      store.messages = [];
      saveStore(store);
    } else if (modified) {
      saveStore(store);
    }

    return res.status(200).json({
      ok: true,
      epoch: CURRENT_EPOCH,
      resetAt: store.resetAt || 0,
      clearedAt: store.clearedAt || 0,
      deletedIds: store.deletedIds || [],
      users: Object.values(store.users),
      messages: store.messages,
      typing: store.typing
    });
  }

  return res.status(405).json({ error: "Method not allowed" });
};
