# ⚡ CSE UPCAT Redirect Load Balancer

A high-performance, zero-bandwidth edge load balancer that monitors multiple mirror servers and issues instant HTTP 302/307 redirects to the highest-priority healthy URL.

---

## 💡 Why This Eliminates Bandwidth Bottlenecks

Traditional reverse proxies funnel all data, PDFs, images, and video through a middleman. If that middleman runs out of bandwidth, the whole site crashes.

**How this Redirect Load Balancer works:**
1. User visits the balancer URL.
2. The balancer quickly checks your target server URLs.
3. The balancer sends an instant **HTTP 302 Redirect** directly to the active, healthy server.
4. **Bandwidth consumption: 0 MB**. The balancer only sends a 150-byte redirect header; all heavy traffic goes directly to the live server.
5. If the live server goes into maintenance, subsequent users are immediately redirected to the next backup server!

---

## ⚙️ Configuration (`wrangler.toml` or `.env`)

Simply input your target URLs separated by commas in priority order:

```env
ORIGIN_URLS="https://primary-server.com, https://backup-server.com"
TIMEOUT_MS=2500
REDIRECT_STATUS=302
```

---

## 🚀 Deployment Options

### Option A: Cloudflare Worker (Recommended — 100% Free on Cloudflare Dashboard)
1. Go to **Cloudflare Dashboard** $\rightarrow$ **Workers & Pages** $\rightarrow$ **Create Worker**.
2. Click **Edit code** and paste [`src/index.js`](./src/index.js).
3. Go to **Settings** $\rightarrow$ **Variables and Secrets** $\rightarrow$ Add `ORIGIN_URLS` with your URLs.
4. Click **Deploy**. Your worker URL (`https://your-balancer.workers.dev`) is now your load balancer!

### Option B: Standalone Node Server
```bash
npm install
npm start
```
Runs a local/VPS redirect server on port `3000`.
