# ⚡ CSE UPCAT Redirect Load Balancer (Render)

A zero-bandwidth redirect router designed specifically to host on **Render**.

---

## 💡 Why This Uses Virtually Zero Bandwidth & CPU on Render

Instead of proxying megabytes of HTML, images, and exam questions through Render:
1. When a student visits your Render load balancer (e.g. `https://cse-upcat.devs.surf`), Render returns an instant **HTTP 302 Redirect** (~150 bytes).
2. The student's browser immediately navigates directly to your active mirror.
3. All heavy exam traffic is served by the target mirror—**not by Render**. Render never gets overloaded or runs out of bandwidth!
4. If a target is suspended (`This service has been suspended.`), Render immediately sends users to the next mirror!

---

## 🚀 How to Deploy on Render (Step-by-Step)

### Step 1: Push this folder to a new GitHub repo
```powershell
cd cse-upcat-loadbalancer
git remote add origin https://github.com/renneco27-crypto/cse-upcat-loadbalancer.git
git branch -M main
git push -u origin main
```

### Step 2: Create Web Service on Render
1. Go to [dashboard.render.com](https://dashboard.render.com/) $\rightarrow$ Click **New +** $\rightarrow$ **Web Service**.
2. Connect your `cse-upcat-loadbalancer` GitHub repo.
3. Set the following fields:
   * **Runtime**: `Node`
   * **Build Command**: `npm install`
   * **Start Command**: `npm start`
   * **Instance Type**: `Free`

### Step 3: Add Environment Variables in Render
Under **Environment Variables**, add:
* `ORIGIN_URLS`: `https://server1.onrender.com, https://backup-server.vercel.app`
* `MAINTENANCE_KEYWORDS`: `This service has been suspended,under maintenance`
* `TIMEOUT_MS`: `3000`

### Step 4: Add Your Custom Subdomain in Render
1. In Render, go to your new Web Service $\rightarrow$ **Settings** $\rightarrow$ **Custom Domains**.
2. Click **Add Custom Domain** and enter:
   ```text
   cse-upcat.devs.surf
   ```
3. In your `devs.surf` DNS dashboard, update your CNAME for `cse-upcat` to point to the new Render URL (e.g. `cse-upcat-loadbalancer.onrender.com`).
