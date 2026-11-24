import http from "node:http";
import dotenv from "dotenv";

dotenv.config();

const PORT = process.env.PORT || 3000;

// Read origins list from environment
function getOriginList() {
  const rawOrigins = process.env.ORIGIN_URLS || "";
  return rawOrigins
    .split(",")
    .map(url => url.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

// Read maintenance keywords from environment
function getMaintenanceKeywords() {
  const rawKeywords = process.env.MAINTENANCE_KEYWORDS || "This service has been suspended,under maintenance";
  return rawKeywords
    .split(",")
    .map(k => k.trim())
    .filter(Boolean);
}

const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || "3000", 10);
const REDIRECT_STATUS = parseInt(process.env.REDIRECT_STATUS || "302", 10);

// In-memory health cache: originUrl -> { healthy: boolean, expiresAt: number }
const healthCache = new Map();

/**
 * Checks if target server is alive and not displaying suspension text
 */
async function checkHealth(originUrl, keywords) {
  const cached = healthCache.get(originUrl);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.healthy;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(originUrl, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "CSE-UPCAT-Render-Balancer/1.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });

    clearTimeout(timer);

    // 1. Check HTTP Status
    if (res.status >= 500 || res.status === 503) {
      console.warn(`[Health Check] ${originUrl} returned status ${res.status}`);
      healthCache.set(originUrl, { healthy: false, expiresAt: now + 15_000 });
      return false;
    }

    // 2. Check for suspension text in body
    const bodyText = await res.text();
    const lowerBody = bodyText.toLowerCase();

    for (const keyword of keywords) {
      if (keyword && lowerBody.includes(keyword.toLowerCase())) {
        console.warn(`[Health Check] ${originUrl} contains suspension keyword: "${keyword}"`);
        healthCache.set(originUrl, { healthy: false, expiresAt: now + 15_000 });
        return false;
      }
    }

    // Origin is healthy
    healthCache.set(originUrl, { healthy: true, expiresAt: now + 30_000 });
    return true;

  } catch (err) {
    clearTimeout(timer);
    console.warn(`[Health Check] ${originUrl} failed or timed out: ${err.message}`);
    healthCache.set(originUrl, { healthy: false, expiresAt: now + 15_000 });
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  // 1. Render Health Check Endpoint (so Render knows this balancer is healthy)
  if (req.url === "/healthz" || req.url === "/_health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end("OK");
  }

  const origins = getOriginList();
  const keywords = getMaintenanceKeywords();

  if (origins.length === 0) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Error: No ORIGIN_URLS configured in Render Environment Variables.");
  }

  // 2. Find first healthy origin
  for (const target of origins) {
    const isAlive = await checkHealth(target, keywords);
    if (isAlive) {
      // Construct destination URL preserving original path and query parameters
      const destination = new URL(req.url, target).toString();

      // Issue instant 302 redirect (takes 0 bandwidth from Render)
      res.writeHead(REDIRECT_STATUS, {
        "Location": destination,
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "X-Routed-To": target
      });
      return res.end();
    }
  }

  // 3. Fallback if all origins are suspended or down
  res.writeHead(503, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>System Maintenance - CSE UPCAT</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; text-align: center; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 14px; padding: 40px 30px; max-width: 480px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    h1 { font-size: 1.5rem; margin-bottom: 12px; color: #38bdf8; }
    p { color: #94a3b8; font-size: 0.95rem; line-height: 1.6; margin-bottom: 24px; }
    .btn { display: inline-block; background: #2563eb; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; cursor: pointer; border: none; }
    .btn:hover { background: #1d4ed8; }
  </style>
</head>
<body>
  <div class="card">
    <h1>All Servers In Maintenance</h1>
    <p>All CSE UPCAT mirror servers are currently suspended or undergoing updates. Please try again shortly.</p>
    <button class="btn" onclick="location.reload()">Check Server Status</button>
  </div>
</body>
</html>`);
});

server.listen(PORT, () => {
  console.log(`[CSE UPCAT Balancer] Running on Render port ${PORT}`);
  console.log(`[CSE UPCAT Balancer] Target URLs:`, getOriginList());
  console.log(`[CSE UPCAT Balancer] Suspension Keywords:`, getMaintenanceKeywords());
});
