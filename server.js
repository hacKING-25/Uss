const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 3000;
const MAX_PEERS = 2;
const MAX_TEXT = 2000;
const OPEN = 1;

const indexHtml = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    return res.end(indexHtml);
  }
  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 });
const rooms = new Map();

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/ws') return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.room = (url.searchParams.get('room') || 'lobby').slice(0, 64);
    ws.id = crypto.randomUUID();
    ws.isAlive = true;
    wss.emit('connection', ws);
  });
});

function send(ws, payload) {
  if (ws && ws.readyState === OPEN) ws.send(JSON.stringify(payload));
}

function peersOf(room, ws) {
  return [...(rooms.get(room) || [])].filter(
    (p) => p !== ws && p.readyState === OPEN,
  );
}

wss.on('connection', (ws) => {
  let room = rooms.get(ws.room);
  if (!room) {
    room = new Set();
    rooms.set(ws.room, room);
  }
  if (room.size >= MAX_PEERS) {
    send(ws, { type: 'full' });
    return ws.close(4000, 'Room is full');
  }

  const others = peersOf(ws.room, ws);
  room.add(ws);

  send(ws, { type: 'welcome', id: ws.id, peerOnline: others.length > 0 });
  for (const p of others) send(p, { type: 'peer', online: true });

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'msg') {
      const id = typeof msg.id === 'string' ? msg.id.slice(0, 64) : '';
      const text = typeof msg.text === 'string' ? msg.text.trim().slice(0, MAX_TEXT) : '';
      if (!id || !text) return;
      send(ws, { type: 'sent', id });
      for (const p of peersOf(ws.room, ws)) {
        send(p, { type: 'msg', id, text, ts: Date.now() });
      }
    } else if (msg.type === 'ack' && Array.isArray(msg.ids)) {
      const ids = msg.ids.filter((v) => typeof v === 'string').slice(0, 100);
      if (!ids.length) return;
      for (const p of peersOf(ws.room, ws)) {
        send(p, { type: 'delivered', ids });
      }
    }
  });

  ws.on('close', () => {
    room.delete(ws);
    if (room.size === 0) rooms.delete(ws.room);
    for (const p of room) send(p, { type: 'peer', online: false });
  });

  ws.on('error', () => {
    try {
      ws.close();
    } catch {}
  });
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log(`duo-chat listening on http://localhost:${PORT}`);
});