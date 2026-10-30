import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const certPath = path.join(root, 'certs', 'dev-cert.pem');
const keyPath = path.join(root, 'certs', 'dev-key.pem');
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';

if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
  console.error('HTTPS証明書がありません。certs/dev-cert.pem と certs/dev-key.pem を配置してください。');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
app.get('/', (_req, res) => res.redirect('/input'));
app.get('/input', (_req, res) => res.sendFile(path.join(root, 'client/input/index.html')));
app.get('/display', (_req, res) => res.sendFile(path.join(root, 'client/display/index.html')));

const httpsServer = https.createServer({
  cert: fs.readFileSync(certPath),
  key: fs.readFileSync(keyPath)
}, app);
const io = new Server(httpsServer, {
  maxHttpBufferSize: 10_000,
  cors: { origin: false }
});

const limits = { shake: 100, voice: 100, draw: 12, 'draw-clear': 500 };
const valid01 = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
const valid = {
  shake: data => data && valid01(data.strength),
  voice: data => data && valid01(data.volume),
  draw: data => data && ['start', 'move', 'end'].includes(data.type) && valid01(data.x) && valid01(data.y),
  'draw-clear': data => data == null || (typeof data === 'object' && Object.keys(data).length === 0)
};

io.on('connection', socket => {
  console.log('接続:', socket.id);
  const last = new Map();

  socket.on('join-display', () => {
    // ローカル開発用。認証なしなので、本番環境では必ず認可を追加すること。
    socket.join('displays');
    console.log('表示画面参加:', socket.id);
  });

  for (const eventName of Object.keys(valid)) {
    socket.on(eventName, payload => {
      if (!valid[eventName](payload)) return;
      const now = Date.now();
      if (now - (last.get(eventName) ?? -Infinity) < limits[eventName]) return;
      last.set(eventName, now);
      io.to('displays').emit(eventName, payload ?? {});
    });
  }

  socket.on('disconnect', () => console.log('切断:', socket.id));
});

httpsServer.listen(port, host, () => {
  console.log(`HTTPSサーバー起動: https://localhost:${port}/input`);
  console.log(`表示画面: https://localhost:${port}/display`);
  console.log('iPhoneからは https://<MacのWi-Fi内IP>:3000/input にアクセス');
});
