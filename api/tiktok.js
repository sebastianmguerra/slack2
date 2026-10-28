// Vercel Serverless Function — Discrete TikTok Vertical Feed & URL Resolver
const cacheByRegion = global.__TIKTOK_FEED_CACHE__ || (global.__TIKTOK_FEED_CACHE__ = {});

function normalizeVideoItem(v) {
  if (!v || (!v.play && !v.wmplay)) return null;
  const authorObj = v.author || {};
  return {
    id: String(v.video_id || v.id || Math.random().toString(36).slice(2)),
    title: String(v.title || "").trim() || "TikTok Video",
    playUrl: v.play || v.wmplay,
    coverUrl: v.cover || v.origin_cover || "",
    authorName: authorObj.nickname || authorObj.unique_id || "creator",
    authorHandle: authorObj.unique_id || "tiktok",
    authorAvatar: authorObj.avatar || "",
    likes: v.digg_count || 0,
    duration: v.duration || 0
  };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const urlParam = (req.query && req.query.url) || "";
  const region = ((req.query && req.query.region) || "US").toUpperCase().slice(0, 2);
  const refresh = req.query && req.query.refresh === "1";

  if (!refresh) {
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
  } else {
    res.setHeader("Cache-Control", "no-store");
  }

  try {
    // 1. Resolve a single TikTok video URL if provided
    if (urlParam) {
      const apiRes = await fetch(
        `https://www.tikwm.com/api/?url=${encodeURIComponent(urlParam.trim())}`,
        {
          headers: { "User-Agent": "Mozilla/5.0" }
        }
      );
      const json = await apiRes.json();
      if (json && json.code === 0 && json.data) {
        const video = normalizeVideoItem(json.data);
        if (video) {
          return res.status(200).json({ ok: true, videos: [video] });
        }
      }
      return res.status(400).json({ ok: false, error: "Could not load that TikTok URL." });
    }

    // 2. Return cached feed if fresh (< 5 minutes) and not explicitly refreshing
    const now = Date.now();
    if (!refresh && cacheByRegion[region] && now - cacheByRegion[region].timestamp < 300000) {
      return res.status(200).json({
        ok: true,
        videos: cacheByRegion[region].videos
      });
    }

    // 3. Fetch trending vertical videos from TikWM
    const feedRes = await fetch(
      `https://www.tikwm.com/api/feed/list?region=${encodeURIComponent(region)}&count=12`,
      {
        headers: { "User-Agent": "Mozilla/5.0" }
      }
    );
    const feedJson = await feedRes.json();

    if (feedJson && feedJson.code === 0 && Array.isArray(feedJson.data)) {
      const videos = feedJson.data.map(normalizeVideoItem).filter(Boolean);
      if (videos.length > 0) {
        cacheByRegion[region] = {
          timestamp: now,
          videos
        };
        return res.status(200).json({ ok: true, videos });
      }
    }

    // Fallback to previous cached videos if rate-limited for 1 second
    if (cacheByRegion[region] && cacheByRegion[region].videos) {
      return res.status(200).json({
        ok: true,
        videos: cacheByRegion[region].videos
      });
    }

    return res.status(200).json({ ok: false, videos: [], error: "Try again in a moment." });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      videos: [],
      error: "Failed to fetch TikTok feed."
    });
  }
};
