/**
 * CSE UPCAT Redirect Load Balancer
 * Edge router that monitors target servers and redirects (HTTP 302/307)
 * traffic to the highest-priority healthy URL.
 * Automatically detects maintenance & suspension body keywords (e.g. "This service has been suspended").
 */

// In-memory health cache per edge instance: { url: { healthy: boolean, expiresAt: number } }
const healthCache = new Map();

/**
 * Perform a health check probe against an origin URL
 * Checks HTTP status AND inspects response body for suspension/maintenance keywords
 */
async function checkHealth(originUrl, timeoutMs, maintenanceKeywords = []) {
  const cached = healthCache.get(originUrl);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.healthy;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(originUrl, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "CSE-UPCAT-HealthChecker/1.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });

    clearTimeout(timer);

    // 1. Check HTTP Status (5xx or 503 Maintenance)
    if (res.status >= 500 || res.status === 503) {
      console.warn(`[Health Check] ${originUrl} returned status ${res.status}`);
      healthCache.set(originUrl, { healthy: false, expiresAt: now + 15_000 });
      return false;
    }

    // 2. Read first chunk of response body to detect suspension / maintenance messages
    // (Even if hosting providers return HTTP 200 for suspended pages)
    const bodyText = await res.text();
    const lowerBody = bodyText.toLowerCase();

    for (const keyword of maintenanceKeywords) {
      if (keyword && lowerBody.includes(keyword.toLowerCase())) {
        console.warn(`[Health Check] ${originUrl} matched maintenance keyword: "${keyword}". Marking down.`);
        healthCache.set(originUrl, { healthy: false, expiresAt: now + 15_000 });
        return false;
      }
    }

    // Origin is healthy and serving active content
    healthCache.set(originUrl, { healthy: true, expiresAt: now + 30_000 });
    return true;

  } catch (error) {
    clearTimeout(timer);
    console.warn(`[Health Check] ${originUrl} unreachable or timed out: ${error.message}`);
    healthCache.set(originUrl, { healthy: false, expiresAt: now + 15_000 });
    return false;
  }
}

export default {
  async fetch(request, env, ctx) {
    // 1. Read origin URLs
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

    // 2. Read keywords to flag as maintenance/suspended
    const rawKeywords = env.MAINTENANCE_KEYWORDS || "This service has been suspended,under maintenance";
    const maintenanceKeywords = rawKeywords
      .split(",")
      .map(k => k.trim())
      .filter(Boolean);

    const timeoutMs = parseInt(env.TIMEOUT_MS || "3000", 10);
    const redirectStatus = parseInt(env.REDIRECT_STATUS || "302", 10);
    const incomingUrl = new URL(request.url);

    // 3. Find first healthy target
    for (let i = 0; i < originList.length; i++) {
      const targetBaseUrl = originList[i];
      const isAlive = await checkHealth(targetBaseUrl, timeoutMs, maintenanceKeywords);

      if (isAlive) {
        const destination = new URL(
          incomingUrl.pathname + incomingUrl.search + incomingUrl.hash,
          targetBaseUrl
        );

        return new Response(null, {
          status: redirectStatus,
          headers: {
            "Location": destination.toString(),
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "X-Routed-To": targetBaseUrl,
            "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
            "Referrer-Policy": "strict-origin-when-cross-origin"
          }
        });
      }
    }

    // 4. Fallback if all origins are suspended or in maintenance
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
    <h1>All Mirrors In Maintenance</h1>
    <p>All CSE UPCAT application servers are currently undergoing maintenance or scheduled updates. Please refresh in a moment.</p>
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
