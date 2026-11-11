# Duo chat

A deliberately tiny two-person chat: one HTML file, a ~120-line Node server, and a single
dependency (`ws`). No framework, no build step, no database.

- Two people per room (invite link creates/joins the room)
- Emoji picker
- Online / offline indicator
- Message states: queued `🕘` → sent `✓` → delivered `✓✓`
- Auto-reconnect
- **No persistence**: messages live only in transit; restarting the server or reloading the
  page clears everything

## Run locally

Requires Node.js 18+.

```bash
npm install
npm start
```

Open <http://localhost:3000> and click **Invite**. The room code is generated automatically
and stored in the URL (`?room=xxxxxx`).

On the same Wi-Fi, share `http://<your-lan-ip>:3000/?room=xxxxxx` instead of localhost.
A local link will **not** work for anyone outside your computer/network — the app shows a
warning banner when it detects this. Deploy it (next section) to get a link you can send to
anyone.

## Share it over the internet

### Option A — Render free tier (recommended)

`render.yaml` is included, so Render configures the service for you.

1. Push this folder to GitHub (create an empty repo first):
   ```bash
   git init
   git add .
   git commit -m "Duo chat"
   git branch -M main
   git remote add origin https://github.com/<you>/duo-chat.git
   git push -u origin main
   ```
2. On <https://render.com>, sign in with GitHub, then **New → Blueprint** and pick the repo.
   (Or **New → Web Service** manually: build `npm install`, start `npm start`, health check
   `/healthz`.)
3. After the deploy finishes, open `https://duo-chat-xxxx.onrender.com` and click **Invite**.
   The copied link now uses the public domain and works for anyone, on any device.
4. Optional: attach a custom domain under the service's **Settings → Custom Domains**.

The recipient does nothing special: they tap the link and start typing. Free-tier caveat: the
service sleeps after ~15 minutes of no traffic, so the first open can take 30–60 seconds.
Upgrade to a paid instance if you want it always warm.

### Option B — Cloudflare Tunnel (test quickly)

```bash
# install: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
cloudflared tunnel --url http://localhost:3000
```

Cloudflare prints a public `https://…trycloudflare.com` URL. Open it, click **Invite**, send
the link. HTTPS means `wss://` is used automatically. The URL lives only while the command runs.

### Option C — ngrok

```bash
ngrok http 3000
```

Send the generated `https://…ngrok-free.app` URL. Same idea as above.

### Option D — Your own VPS (permanent)

1. Install Node 18+ and copy this folder to the server (e.g. `/opt/duo-chat`).
2. Install dependencies and try it:
   ```bash
   cd /opt/duo-chat
   npm install --omit=dev
   PORT=3000 node server.js
   ```
3. Run it as a service with systemd, `/etc/systemd/system/duo-chat.service`:
   ```ini
   [Unit]
   Description=Duo chat
   After=network.target

   [Service]
   WorkingDirectory=/opt/duo-chat
   ExecStart=/usr/bin/node server.js
   Environment=PORT=3000
   Restart=always
   User=www-data

   [Install]
   WantedBy=multi-user.target
   ```
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now duo-chat
   ```
4. Put HTTPS in front with Caddy (it also proxies WebSockets automatically). `/etc/caddy/Caddyfile`:
   ```
   chat.example.com {
       reverse_proxy 127.0.0.1:3000
   }
   ```
   ```bash
   sudo systemctl reload caddy
   ```

   nginx equivalent:
   ```nginx
   server {
       listen 443 ssl;
       server_name chat.example.com;
       # ssl_certificate ...;

       location / {
           proxy_pass http://127.0.0.1:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
           proxy_set_header Host $host;
       }
   }
   ```

Point the domain at the server, open `https://chat.example.com`, click **Invite**.

## Notes

- Rooms hold at most 2 connections; a third gets "Room is full" and retries.
- `PORT` env var changes the port (`PORT=8080 npm start`).
- `/healthz` returns `200 ok` for uptime checks.
- Messages are relayed, never stored. Server memory stays flat during use.
- Delivery (`✓✓`) is confirmed by the recipient's browser; if they are offline, messages
  stay at `✓` and are not replayed later.