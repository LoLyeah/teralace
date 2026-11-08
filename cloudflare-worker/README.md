# ⚡ Teralace Self-Hostable Cloudflare Worker Resolver

Deploy your own private, 100% uptime TeraBox API resolver on Cloudflare Workers for **free** (100,000 requests/day free tier).

When public API endpoints (like `api-free.ntmterabox.me`) go offline or get rate-limited, running your own Cloudflare Worker guarantees unlimited, fast, and private TeraBox link extraction.

---

## 🚀 Quick Setup (Web Dashboard — 2 Minutes, No CLI Required)

1. **Sign Up / Log In to Cloudflare**
   - Go to [cloudflare.com](https://dash.cloudflare.com/) and create a free account (or log in).

2. **Create a Worker**
   - On the left sidebar, click **Compute (Workers) &rarr; Workers & Pages**.
   - Click **Create Application &rarr; Create Worker**.
   - Give it any name (e.g. `teralace-resolver`) and click **Deploy**.

3. **Paste the Code**
   - Click **Edit Code** (Quick Edit).
   - Delete all existing sample code in the editor.
   - Copy the entire contents of [`worker.js`](./worker.js) and paste it into the editor.
   - Click **Deploy** (top right).

4. **Copy Your URL**
   - Your worker URL will look like:
     ```
     https://teralace-resolver.<your-subdomain>.workers.dev
     ```
   - Test it by opening it in your browser: you should see:
     ```json
     {
       "ok": true,
       "name": "Teralace Cloudflare Resolver",
       "status": "online"
     }
     ```

5. **Add to Teralace**
   - Open **Teralace &rarr; Settings (⚙) &rarr; API Pool & Balancer**.
   - Under **Add Custom Endpoint**:
     - **Provider Name**: `My Cloudflare Worker`
     - **Base URL**: `https://teralace-resolver.<your-subdomain>.workers.dev/`
   - Click **+ Add** &rarr; **Save Changes**.

---

## 💻 Alternative: Deploy via Wrangler CLI

If you already use Node.js and Wrangler:

```bash
cd cloudflare-worker
npx wrangler login
npx wrangler deploy
```

---

## 🔒 Optional Worker Settings

Under Worker **Settings &rarr; Variables and Secrets**:
- `AUTH_TOKEN` *(Optional)*: If you want to password-protect your worker, set `AUTH_TOKEN = "your_secret_passphrase"`. Then in Teralace, enter this passphrase into the **Auth Token** field.
- `TERABOX_COOKIE` *(Optional)*: If you want the worker to automatically supply your personal `ndus` session cookie to TeraBox for private folder unpacking, set `TERABOX_COOKIE = "your_ndus_value"`.

---

## 🧪 Testing Your Worker

1. **Health Check:**
   Open `https://teralace-resolver.<your-subdomain>.workers.dev/` or `/health`.
   It returns:
   ```json
   {
     "ok": true,
     "name": "TeraLace Cloudflare Resolver",
     "status": "online",
     "version": "1.0.0"
   }
   ```

2. **Resolving a Shared Link:**
   ```bash
   curl "https://teralace-resolver.<your-subdomain>.workers.dev/?url=https://terabox.app/s/1xxxxx"
   ```

---

## 🛠️ Troubleshooting & FAQ

* **Error `31045: user not exists`:**
  TeraBox blocks anonymous requests on shared folders or private links. Add your `ndus` session cookie into the worker's `TERABOX_COOKIE` secret variable, or pass it in Teralace **Settings &rarr; TeraBox Cookie**.
* **Daily Limit:**
  Cloudflare's free tier allows up to **100,000 requests per day**, which is more than enough for thousands of daily file downloads.
* **CORS Support:**
  `worker.js` includes full `OPTIONS` preflight and wildcard `Access-Control-Allow-Origin: *` headers, ensuring it functions seamlessly in web browsers and Tauri native clients alike.
