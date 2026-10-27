const fs = require("fs");
const path = require("path");

const TMP_FILE = path.join("/tmp", "slack_1on1_store_v2.json");

function createSvgAvatar(initials, bg, fg = "#FFFFFF") {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
    <rect width="160" height="160" rx="24" fill="${bg}"/>
    <text x="50%" y="53%" dominant-baseline="middle" text-anchor="middle"
      fill="${fg}" font-family="Lato, Helvetica, Arial, sans-serif"
      font-weight="900" font-size="64">${initials}</text>
  </svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

function getDefaultStore() {
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
        avatar_url: createSvgAvatar("AR", "#E01E5A"),
        updated_at: 1000,
        last_seen: nowIso
      },
      user_2: {
        id: "user_2",
        username: "sam",
        display_name: "Sam Taylor",
        status_text: "Available for DM",
        avatar_url: createSvgAvatar("ST", "#2EB67D"),
        updated_at: 1000,
        last_seen: nowIso
      }
    },
    messages: [],
    typing: {}
  };
}

function loadStore() {
  if (global.__SLACK_CHAT_STORE__) {
    return global.__SLACK_CHAT_STORE__;
  }
  try {
    if (fs.existsSync(TMP_FILE)) {
      const raw = fs.readFileSync(TMP_FILE, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && parsed.users && Array.isArray(parsed.messages)) {
        global.__SLACK_CHAT_STORE__ = parsed;
        return parsed;
      }
    }
  } catch (_) {}

  const initial = getDefaultStore();
  global.__SLACK_CHAT_STORE__ = initial;
  return initial;
}

function saveStore(store) {
  global.__SLACK_CHAT_STORE__ = store;
  try {
    fs.writeFileSync(TMP_FILE, JSON.stringify(store), "utf8");
  } catch (_) {}
}

function mergeClientSnapshot(store, snapshot) {
  if (!snapshot || typeof snapshot !== "object") return;

  if (typeof snapshot.clearedAt === "number" && snapshot.clearedAt > (store.clearedAt || 0)) {
    store.clearedAt = snapshot.clearedAt;
    store.messages = store.messages.filter(
      (m) => new Date(m.created_at).getTime() > store.clearedAt
    );
  }

  if (Array.isArray(snapshot.deletedIds)) {
    const delSet = new Set([...(store.deletedIds || []), ...snapshot.deletedIds]);
    store.deletedIds = Array.from(delSet).slice(-500);
    store.messages = store.messages.filter((m) => !delSet.has(m.id));
  }

  if (snapshot.users && typeof snapshot.users === "object") {
    for (const uid of ["user_1", "user_2"]) {
      const incoming = snapshot.users[uid];
      const current = store.users[uid];
      if (incoming && current) {
        if ((incoming.updated_at || 0) > (current.updated_at || 0)) {
          store.users[uid] = {
            ...current,
            username: String(incoming.username || current.username).slice(0, 30),
            display_name: String(incoming.display_name || current.display_name).slice(0, 40),
            status_text: String(incoming.status_text || current.status_text || "").slice(0, 60),
            avatar_url: incoming.avatar_url || current.avatar_url,
            updated_at: incoming.updated_at
          };
        }
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
      if (createdMs <= (store.clearedAt || 0)) continue;
      const existing = byId.get(m.id);
      if (!existing || (m.updated_at || 0) > (existing.updated_at || 0)) {
        byId.set(m.id, m);
      }
    }
    store.messages = Array.from(byId.values())
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .slice(-400);
  }
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

    if (snapshot) {
      mergeClientSnapshot(store, snapshot);
    }

    if (activeUserId && store.users[activeUserId]) {
      store.users[activeUserId].last_seen = nowIso;
    }

    if (action === "send_message" && body.message) {
      const msg = body.message;
      if (msg.id && !store.messages.some((m) => m.id === msg.id)) {
        store.messages.push({
          id: String(msg.id),
          sender_id: String(msg.sender_id || "user_1"),
          receiver_id: String(msg.receiver_id || "user_2"),
          content: String(msg.content || ""),
          image_url: msg.image_url || null,
          reactions: msg.reactions || {},
          created_at: msg.created_at || nowIso,
          updated_at: now
        });
        if (store.messages.length > 400) {
          store.messages = store.messages.slice(-400);
        }
      }
      if (msg.sender_id && store.typing[msg.sender_id]) {
        delete store.typing[msg.sender_id];
      }
      saveStore(store);
    } else if (action === "delete_message" && body.messageId) {
      const msgId = String(body.messageId);
      store.deletedIds = Array.from(new Set([...(store.deletedIds || []), msgId])).slice(-500);
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
      if (store.users[u.id]) {
        store.users[u.id] = {
          ...store.users[u.id],
          username: String(u.username || store.users[u.id].username).slice(0, 30),
          display_name: String(u.display_name || store.users[u.id].display_name).slice(0, 40),
          status_text: String(u.status_text || "").slice(0, 60),
          avatar_url: u.avatar_url || store.users[u.id].avatar_url,
          updated_at: now,
          last_seen: nowIso
        };
        saveStore(store);
      }
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
    } else if (snapshot) {
      saveStore(store);
    }

    return res.status(200).json({
      ok: true,
      clearedAt: store.clearedAt || 0,
      deletedIds: store.deletedIds || [],
      users: Object.values(store.users),
      messages: store.messages,
      typing: store.typing
    });
  }

  return res.status(405).json({ error: "Method not allowed" });
};
