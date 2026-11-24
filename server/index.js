'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const store = require('./store');
const providers = require('./providers');

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// 占位会话令牌（仅本地演示用途，非生产级鉴权；重启后失效）
const sessions = new Set();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 64 * 1024) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (e) {
        reject(Object.assign(new Error('invalid json'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

function isAuthed(req) {
  const t = bearer(req);
  return t && sessions.has(t);
}

// ---------- 业务校验（最小字段清洗） ----------
function numOrEmpty(v) {
  if (v === '' || v === null || v === undefined) return '';
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function cleanVehicle(input) {
  const out = {};
  if (input.km !== undefined) { const n = numOrEmpty(input.km); if (n === undefined) return null; out.km = n; }
  if (input.pct !== undefined) {
    const n = Number(input.pct);
    if (!Number.isFinite(n)) return null;
    out.pct = Math.max(0, Math.min(100, n));
  }
  if (input.type !== undefined) {
    if (!['hev', 'ice', 'ev'].includes(input.type)) return null;
    out.type = input.type;
  }
  if (input.odo !== undefined) { const n = numOrEmpty(input.odo); if (n === undefined) return null; out.odo = n; }
  if (input.locked !== undefined) out.locked = Boolean(input.locked);
  if (input.windowClosed !== undefined) out.windowClosed = Boolean(input.windowClosed);
  if (Array.isArray(input.tire) && input.tire.length === 4) {
    out.tire = input.tire.map((t) => Math.max(0, Number(t) || 0));
  }
  return out;
}

// ---------- 路由 ----------
const routes = {
  'POST /api/auth/login': async (req, res) => {
    const body = await readBody(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    // 演示占位：任意非空账号可进入。这不是一汽丰田真实登录，不校验车厂凭证。
    if (!username || !password) {
      return sendJson(res, 400, { ok: false, message: '请输入账号和密码（演示占位）' });
    }
    const token = 'local-' + crypto.randomBytes(12).toString('hex');
    sessions.add(token);
    sendJson(res, 200, {
      ok: true,
      token,
      user: { name: username },
      note: '本地演示账号，未连接一汽丰田服务器。'
    });
  },

  'GET /api/meta': async (req, res) => {
    const state = store.load();
    sendJson(res, 200, {
      source: state.source,
      capabilities: {
        range: state.source === 'official' ? 'official' : 'mock',
        location: state.source === 'official' ? 'official' : 'mock',
        status: state.source === 'official' ? 'official' : 'mock',
        key: 'deeplink',
        remoteControl: 'unsupported'
      },
      disclaimer:
        '续航、定位、车况当前为本地演示或手动录入数据，未接入官方车联网；' +
        '蓝牙钥匙与远程控车由厂商体系签发，第三方仅提供唤起官方 App 的入口。'
    });
  },

  'GET /api/vehicle/status': async (req, res) => {
    const state = store.load();
    const provider = providers.resolve(state.source);
    try {
      sendJson(res, 200, provider.getStatus(state));
    } catch (e) {
      sendJson(res, e.status || 500, { ok: false, code: e.code, message: e.message });
    }
  },

  'PUT /api/vehicle/status': async (req, res) => {
    const body = await readBody(req);
    const patch = {};
    if (body.profile && typeof body.profile === 'object') {
      patch.profile = {
        model: String(body.profile.model || '').slice(0, 40),
        plate: String(body.profile.plate || '').slice(0, 20)
      };
    }
    if (body.vehicle) {
      const cleaned = cleanVehicle(body.vehicle);
      if (!cleaned) return sendJson(res, 400, { ok: false, message: '车况字段不合法' });
      patch.vehicle = cleaned;
    }
    if (body.source && ['mock', 'manual', 'official'].includes(body.source)) {
      patch.source = body.source;
    }
    const state = store.update(patch);
    sendJson(res, 200, { ok: true, vehicle: state.vehicle, profile: state.profile, source: state.source });
  },

  'GET /api/vehicle/location': async (req, res) => {
    const state = store.load();
    const provider = providers.resolve(state.source);
    try {
      sendJson(res, 200, provider.getLocation(state));
    } catch (e) {
      sendJson(res, e.status || 500, { ok: false, code: e.code, message: e.message });
    }
  },

  'PUT /api/vehicle/location': async (req, res) => {
    const body = await readBody(req);
    const loc = {};
    if (body.lat !== undefined) {
      const n = Number(body.lat);
      if (!Number.isFinite(n) || n < -90 || n > 90) return sendJson(res, 400, { ok: false, message: '纬度不合法' });
      loc.lat = n;
    }
    if (body.lng !== undefined) {
      const n = Number(body.lng);
      if (!Number.isFinite(n) || n < -180 || n > 180) return sendJson(res, 400, { ok: false, message: '经度不合法' });
      loc.lng = n;
    }
    if (body.acc !== undefined) loc.acc = body.acc === null ? null : Number(body.acc);
    loc.posTime = Date.now();
    const state = store.update({ location: loc });
    sendJson(res, 200, { ok: true, location: state.location });
  },

  'GET /api/key/config': async (req, res) => {
    const state = store.load();
    sendJson(res, 200, { scheme: state.key.scheme });
  },

  'PUT /api/key/config': async (req, res) => {
    const body = await readBody(req);
    const scheme = String(body.scheme || '').trim().slice(0, 120);
    const state = store.update({ key: { scheme } });
    sendJson(res, 200, { ok: true, scheme: state.key.scheme });
  },

  'POST /api/key/launch': async (req, res) => {
    const state = store.load();
    const scheme = state.key.scheme;
    if (!scheme) {
      return sendJson(res, 200, {
        ok: false,
        deeplink: null,
        message: '尚未配置官方 App 的 URL Scheme，请从桌面直接打开官方 App。'
      });
    }
    sendJson(res, 200, { ok: true, deeplink: scheme });
  }
};

// 受保护接口：除登录、meta 外均需占位令牌
const PROTECTED = Object.keys(routes).filter((k) => !['POST /api/auth/login', 'GET /api/meta'].includes(k));

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, urlPath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); return res.end('forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const method = req.method;
  const urlPath = req.url.split('?')[0];
  const key = method + ' ' + urlPath;

  if (key in routes) {
    if (PROTECTED.includes(key) && !isAuthed(req)) {
      return sendJson(res, 401, { ok: false, code: 'UNAUTHORIZED', message: '未登录或会话已失效' });
    }
    try {
      await routes[key](req, res);
    } catch (e) {
      sendJson(res, e.status || 500, { ok: false, message: e.message || 'server error' });
    }
    return;
  }

  if (method === 'GET' && urlPath.startsWith('/api/')) {
    return sendJson(res, 404, { ok: false, message: 'api not found' });
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`[toyota-car-widget] listening on http://localhost:${PORT}`);
});

module.exports = server;
