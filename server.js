import http from "node:http";
import dotenv from "dotenv";

dotenv.config();

const PORT = process.env.PORT || 3000;
const rawOrigins = process.env.ORIGIN_URLS || "https://upcat-reviewer.onrender.com";
const originList = rawOrigins
  .split(",")
  .map(url => url.trim().replace(/\/$/, ""))
  .filter(Boolean);

const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || "2500", 10);
const REDIRECT_STATUS = parseInt(process.env.REDIRECT_STATUS || "302", 10);

const healthCache = new Map();

async function checkHealth(originUrl) {
  const cached = healthCache.get(originUrl);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.healthy;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(originUrl, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "CSE-UPCAT-Node-Balancer/1.0" }
    });
    clearTimeout(timer);
    const isHealthy = res.status < 500 && res.status !== 503;
    healthCache.set(originUrl, {
      healthy: isHealthy,
      expiresAt: now + (isHealthy ? 30_000 : 15_000)
    });
    return isHealthy;
  } catch (err) {
    clearTimeout(timer);
    healthCache.set(originUrl, { healthy: false, expiresAt: now + 15_000 });
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  for (const target of originList) {
    const healthy = await checkHealth(target);
    if (healthy) {
      const destination = new URL(req.url, target).toString();
      res.writeHead(REDIRECT_STATUS, {
        Location: destination,
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "X-Routed-To": target
      });
      return res.end();
    }
  }

  res.writeHead(503, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<h1>503 - All Mirrors in Maintenance</h1><p>Please refresh in a moment.</p>`);
});

server.listen(PORT, () => {
  console.log(`[Load Balancer] Listening on http://localhost:${PORT}`);
  console.log(`[Load Balancer] Target URLs:`, originList);
});
