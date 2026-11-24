/**
 * CSE UPCAT Redirect Load Balancer
 * Edge router that monitors target servers and redirects (HTTP 302/307)
 * traffic to the highest-priority healthy URL. Consumes zero server bandwidth!
 */

// In-memory health cache per edge instance: { url: { healthy: boolean, expiresAt: number } }
const healthCache = new Map();

/**
 * Perform a quick health probe against an origin URL
 */
async function checkHealth(originUrl, timeoutMs) {
  const cached = healthCache.get(originUrl);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.healthy;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Attempt lightweight HEAD request first; fallback to GET if HEAD not supported
    let res = await fetch(originUrl, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "CSE-UPCAT-HealthChecker/1.0" }
    });

    if (res.status === 405 || res.status === 501) {
      res = await fetch(originUrl, {
        method: "GET",
        signal: controller.signal,
        redirect: "follow",
        headers: { "User-Agent": "CSE-UPCAT-HealthChecker/1.0" }
      });
    }

    clearTimeout(timer);

    // Consider healthy if HTTP status < 500 and not 503 (Maintenance)
    const isHealthy = res.status < 500 && res.status !== 503;

    healthCache.set(originUrl, {
      healthy: isHealthy,
      expiresAt: now + (isHealthy ? 30_000 : 15_000) // Recheck healthy every 30s, down every 15s
    });

    return isHealthy;
  } catch (error) {
    clearTimeout(timer);
    healthCache.set(originUrl, { healthy: false, expiresAt: now + 15_000 });
    return false;
  }
}

export default {
  async fetch(request, env, ctx) {
    // 1. Read origin URLs from environment (comma-separated list)
    const rawOrigins = env.ORIGIN_URLS || "";
    const originList = rawOrigins
      .split(",")
      .map(url => url.trim().replace(/\/$/, ""))
      .filter(Boolean);

    if (originList.length === 0) {
      return new Response(
        "Load Balancer Error: No ORIGIN_URLS configured in environment variables.",
        { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } }
      );
    }

    const timeoutMs = parseInt(env.TIMEOUT_MS || "2500", 10);
    const redirectStatus = parseInt(env.REDIRECT_STATUS || "302", 10); // 302 Found or 307 Temporary Redirect
    const incomingUrl = new URL(request.url);

    // 2. Iterate through URLs in priority order and find the first healthy target
    for (let i = 0; i < originList.length; i++) {
      const targetBaseUrl = originList[i];
      const isAlive = await checkHealth(targetBaseUrl, timeoutMs);

      if (isAlive) {
        // Construct destination URL preserving original path and query parameters
        const destination = new URL(
          incomingUrl.pathname + incomingUrl.search + incomingUrl.hash,
          targetBaseUrl
        );

        return new Response(null, {
          status: redirectStatus,
          headers: {
            "Location": destination.toString(),
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "X-Routed-To": targetBaseUrl
          }
        });
      }

      console.warn(`[Load Balancer] Origin down or under maintenance: ${targetBaseUrl}`);
    }

    // 3. Fallback: If all destinations are down, display maintenance splash
    return new Response(
      `<!DOCTYPE html>
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
    <h1>All Servers Under Maintenance</h1>
    <p>All target mirrors are temporarily undergoing maintenance or updates. Please try again in a few moments.</p>
    <button class="btn" onclick="location.reload()">Check Server Status</button>
  </div>
</body>
</html>`,
      {
        status: 503,
        headers: { "Content-Type": "text/html; charset=utf-8" }
      }
    );
  }
};
