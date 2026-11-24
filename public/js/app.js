'use strict';

/* ================= 本地存储：仅令牌 ================= */
const TOKEN_KEY = 'ft-widget-token';
const CACHE_KEY = 'ft-widget-cache-v1';

let token = localStorage.getItem(TOKEN_KEY) || null;
let S = null;            // 车况状态，来自后端
let meta = null;
let reqSeq = 0;          // 异步结果归属：迟到响应不得覆盖新状态

/* ================= 工具 ================= */
function $(id) { return document.getElementById(id); }

function loadCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || null; }
  catch (e) { return null; }
}
function saveCache() {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(S)); } catch (e) {}
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (res.status === 401) {
    logout();
    throw Object.assign(new Error('未登录'), { code: 'UNAUTHORIZED' });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw Object.assign(new Error(data.message || '请求失败'), { status: res.status, code: data.code });
  }
  return data;
}

const toastTimer = {};
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer.t);
  toastTimer.t = setTimeout(() => el.classList.remove('show'), 2200);
}

function ago(ts) {
  if (!ts) return '未刷新';
  const d = Math.max(0, Date.now() - ts);
  const min = Math.floor(d / 60000);
  if (min < 1) return '不到 1 分钟前更新';
  if (min < 60) return min + ' 分钟前更新';
  const h = Math.floor(min / 60);
  if (h < 24) return h + ' 小时前更新';
  return Math.floor(h / 24) + ' 天前更新';
}
function clock(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n) => n < 10 ? '0' + n : '' + n;
  return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
const TYPE_LABEL = { hev: '油量', ice: '油量', ev: '电量' };

/* ================= 渲染 ================= */
function render() {
  if (!S) return;
  const kind = TYPE_LABEL[S.vehicle.type] || '油量';

  $('hd-model').textContent = S.profile.model || '未命名车辆';
  $('hd-plate').textContent = S.profile.plate || '未填写车牌';
  const srcChip = $('hd-source');
  if (S.source === 'official') {
    srcChip.textContent = '官方数据'; srcChip.className = 'chip live';
  } else if (S.source === 'manual') {
    srcChip.textContent = '手动录入'; srcChip.className = 'chip live';
  } else {
    srcChip.textContent = '演示数据'; srcChip.className = 'chip demo';
  }

  const pct = Math.max(0, Math.min(100, Number(S.vehicle.pct) || 0));
  $('g-pct').textContent = Math.round(pct);
  $('g-unit').textContent = '% ' + kind;
  $('gauge-arc').setAttribute('stroke-dashoffset', String(339.3 * (1 - pct / 100)));
  $('v-km').textContent = S.vehicle.km === '' || S.vehicle.km === null ? '—' : Math.round(Number(S.vehicle.km));

  const staleMin = 60;
  const isStale = (Date.now() - S.vehicle.capturedAt) / 60000 > staleMin;
  $('v-time').textContent = ago(S.vehicle.capturedAt);
  $('stamp-dot').className = 'dot' + (isStale ? ' stale' : '');

  $('v-lock').innerHTML = S.vehicle.locked
    ? '<span class="badge-ok">已锁止</span>' : '<span class="badge-warn">未锁止</span>';
  $('v-window').innerHTML = S.vehicle.windowClosed
    ? '<span class="badge-ok">全部关闭</span>' : '<span class="badge-warn">未关严</span>';
  $('v-tire-f').innerHTML = S.vehicle.tire[0] + ' <small>kPa</small> · ' + S.vehicle.tire[1];
  $('v-odo').innerHTML = S.vehicle.odo === '' || S.vehicle.odo === null
    ? '—' : Math.round(Number(S.vehicle.odo)) + ' <small>km</small>';

  const loc = S.location;
  $('v-pos').textContent = loc.lat === null
    ? '点击进入定位页'
    : Number(loc.lat).toFixed(4) + ', ' + Number(loc.lng).toFixed(4) + ' · ' + ago(loc.posTime);

  $('c-lat').textContent = loc.lat === null ? '—' : Number(loc.lat).toFixed(5);
  $('c-lng').textContent = loc.lng === null ? '—' : Number(loc.lng).toFixed(5);
  $('c-acc').textContent = loc.acc === null ? '—' : '±' + Math.round(loc.acc) + ' m';
  $('c-time').textContent = clock(loc.posTime);
  $('map-label').textContent = loc.lat === null ? '未获取定位' : '手机所在位置';

  // 设置页（避开正在编辑的输入框）
  const active = document.activeElement;
  const setVal = (id, val) => { const el = $(id); if (active !== el) el.value = val; };
  setVal('in-model', S.profile.model || '');
  setVal('in-plate', S.profile.plate || '');
  setVal('in-km', S.vehicle.km === '' ? '' : S.vehicle.km);
  setVal('in-pct', S.vehicle.pct === '' ? '' : S.vehicle.pct);
  $('in-type').value = S.vehicle.type;
  setVal('in-odo', S.vehicle.odo === '' ? '' : S.vehicle.odo);
  setVal('in-scheme', S.key.scheme || '');
  $('tg-lock').className = 'tog' + (S.vehicle.locked ? ' on' : '');
  $('tg-window').className = 'tog' + (S.vehicle.windowClosed ? ' on' : '');
  $('tg-demo').className = 'tog' + (S.source !== 'manual' ? ' on' : '');
}

/* ================= 数据加载 ================= */
async function loadAll() {
  const seq = ++reqSeq;
  try {
    const [status, location, key] = await Promise.all([
      api('/api/vehicle/status'),
      api('/api/vehicle/location'),
      api('/api/key/config')
    ]);
    if (seq !== reqSeq) return; // 已有更新的请求，丢弃迟到结果
    S = {
      profile: status.profile,
      vehicle: status.vehicle,
      location: location.location,
      key: { scheme: key.scheme },
      source: status.source
    };
    saveCache();
    render();
  } catch (e) {
    if (e.code === 'UNAUTHORIZED') return;
    const cached = loadCache();
    if (cached) { S = cached; render(); toast('离线：使用上次缓存数据'); }
    else toast(e.message || '加载失败');
  }
}

/* ================= 登录 / 退出 ================= */
function showApp() {
  $('view-login').hidden = true;
  $('app').hidden = false;
}
function showLogin() {
  $('app').hidden = true;
  $('view-login').hidden = false;
}

function logout() {
  token = null;
  localStorage.removeItem(TOKEN_KEY);
  showLogin();
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('btn-login');
  if (btn.disabled) return;
  const username = $('in-username').value.trim();
  const password = $('in-password').value;
  if (!username || !password) { toast('请输入账号和密码'); return; }
  btn.disabled = true;
  try {
    const data = await api('/api/auth/login', { method: 'POST', body: { username, password } });
    token = data.token;
    localStorage.setItem(TOKEN_KEY, token);
    showApp();
    await loadAll();
  } catch (err) {
    toast(err.message || '登录失败');
  } finally {
    btn.disabled = false;
  }
});

$('btn-logout').addEventListener('click', () => { logout(); toast('已退出登录'); });

/* ================= 路由 ================= */
const ROUTES = { '#/home': 'home', '#/location': 'location', '#/key': 'key', '#/settings': 'settings' };
function route() {
  const hash = location.hash || '#/home';
  if (!ROUTES[hash]) return;
  const name = ROUTES[hash];
  ['home', 'location', 'key', 'settings'].forEach((n) => { $('view-' + n).hidden = (n !== name); });
  document.querySelectorAll('[data-go]').forEach((el) => {
    if (el.classList.contains('nav-item')) el.classList.toggle('active', el.getAttribute('data-go') === hash);
  });
  window.scrollTo(0, 0);
}

/* ================= 刷新 ================= */
$('btn-refresh').addEventListener('click', () => {
  const btn = $('btn-refresh');
  if (btn.classList.contains('spin')) return;
  btn.classList.add('spin');
  loadAll().finally(() => {
    btn.classList.remove('spin');
    toast(S && S.source !== 'official' ? '已刷新（本地数据未变化）' : '已刷新');
  });
});

/* ================= 定位 ================= */
$('btn-locate').addEventListener('click', () => {
  if (!navigator.geolocation) { toast('当前浏览器不支持定位'); return; }
  const btn = $('btn-locate');
  btn.disabled = true;
  navigator.geolocation.getCurrentPosition(async (pos) => {
    try {
      await api('/api/vehicle/location', {
        method: 'PUT',
        body: { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy }
      });
      await loadAll();
      toast('定位已更新');
    } catch (e) { toast(e.message || '保存定位失败'); }
    btn.disabled = false;
  }, (err) => {
    btn.disabled = false;
    let msg = '定位失败';
    if (err.code === 1) msg = '定位权限被拒绝，请在系统设置里授权';
    else if (err.code === 2) msg = '暂时无法获取位置，换个地方再试';
    else if (err.code === 3) msg = '定位超时';
    toast(msg);
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
});

$('btn-map-open').addEventListener('click', () => {
  if (!S || S.location.lat === null) { toast('请先获取定位'); return; }
  const { lat, lng } = S.location;
  window.open('https://maps.apple.com/?ll=' + lat + ',' + lng + '&q=我的位置', '_blank');
});

/* ================= 钥匙 ================= */
$('btn-open-official').addEventListener('click', async () => {
  try {
    const data = await api('/api/key/launch', { method: 'POST' });
    if (!data.ok) { toast(data.message); return; }
    location.href = data.deeplink;
    setTimeout(() => toast('若未跳转，说明该 Scheme 不可用'), 1200);
  } catch (e) { toast(e.message || '跳转失败'); }
});

$('btn-key-help').addEventListener('click', () => {
  openSheet('为什么第三方不能做蓝牙钥匙',
    '数字钥匙走 CCC 体系：车端 PEPS 模块通过 BLE 与手机通信，配对时由车厂云端签发凭证，凭证写入手机安全元件，每次解锁都要做挑战应答。\n\n“谁是合法钥匙”由车厂定义，第三方 App 没有签发能力。唯一能“实现”的路径是破解车端协议，那等于复制一把车钥匙。\n\n可行形态只有三种：深链唤起官方 App、系统快捷指令跳转、Apple 钱包车钥匙（需车型已接入 CarKey）。');
});

/* ================= 设置：防抖保存 ================= */
let saveTimer = null;

// 车型/车牌在 profile 内，单独处理
$('in-model').addEventListener('input', (e) => {
  S.profile.model = e.target.value;
  saveCache(); render();
  clearTimeout(saveTimer);
  saveTimer = async () => {
    try { await api('/api/vehicle/status', { method: 'PUT', body: { profile: S.profile } }); }
    catch (err) { if (err.code !== 'UNAUTHORIZED') toast('保存失败'); }
  };
});
$('in-plate').addEventListener('input', (e) => {
  S.profile.plate = e.target.value;
  saveCache(); render();
  clearTimeout(saveTimer);
  saveTimer = async () => {
    try { await api('/api/vehicle/status', { method: 'PUT', body: { profile: S.profile } }); }
    catch (err) { if (err.code !== 'UNAUTHORIZED') toast('保存失败'); }
  };
});

$('in-km').addEventListener('input', (e) => {
  const v = e.target.value;
  S.vehicle.km = v === '' ? '' : Number(v);
  saveCache(); render();
  clearTimeout(saveTimer);
  saveTimer = async () => {
    try { await api('/api/vehicle/status', { method: 'PUT', body: { vehicle: { km: S.vehicle.km } } }); }
    catch (err) { if (err.code !== 'UNAUTHORIZED') toast('保存失败'); }
  };
});
$('in-pct').addEventListener('input', (e) => {
  const v = e.target.value;
  S.vehicle.pct = v === '' ? '' : Number(v);
  saveCache(); render();
  clearTimeout(saveTimer);
  saveTimer = async () => {
    try { await api('/api/vehicle/status', { method: 'PUT', body: { vehicle: { pct: S.vehicle.pct } } }); }
    catch (err) { if (err.code !== 'UNAUTHORIZED') toast('保存失败'); }
  };
});
$('in-odo').addEventListener('input', (e) => {
  const v = e.target.value;
  S.vehicle.odo = v === '' ? '' : Number(v);
  saveCache(); render();
  clearTimeout(saveTimer);
  saveTimer = async () => {
    try { await api('/api/vehicle/status', { method: 'PUT', body: { vehicle: { odo: S.vehicle.odo } } }); }
    catch (err) { if (err.code !== 'UNAUTHORIZED') toast('保存失败'); }
  };
});

$('in-type').addEventListener('change', async (e) => {
  S.vehicle.type = e.target.value;
  saveCache(); render();
  try { await api('/api/vehicle/status', { method: 'PUT', body: { vehicle: { type: S.vehicle.type } } }); }
  catch (err) { if (err.code !== 'UNAUTHORIZED') toast('保存失败'); }
});

$('tg-lock').addEventListener('click', async () => {
  S.vehicle.locked = !S.vehicle.locked;
  saveCache(); render();
  try { await api('/api/vehicle/status', { method: 'PUT', body: { vehicle: { locked: S.vehicle.locked } } }); }
  catch (err) { if (err.code !== 'UNAUTHORIZED') toast('保存失败'); }
});
$('tg-window').addEventListener('click', async () => {
  S.vehicle.windowClosed = !S.vehicle.windowClosed;
  saveCache(); render();
  try { await api('/api/vehicle/status', { method: 'PUT', body: { vehicle: { windowClosed: S.vehicle.windowClosed } } }); }
  catch (err) { if (err.code !== 'UNAUTHORIZED') toast('保存失败'); }
});

$('tg-demo').addEventListener('click', async () => {
  const toManual = S.source === 'manual';
  S.source = toManual ? 'mock' : 'manual';
  if (!toManual) { S.vehicle.km = 612; S.vehicle.pct = 68; S.vehicle.type = 'hev'; }
  saveCache(); render();
  try {
    await api('/api/vehicle/status', { method: 'PUT', body: { source: S.source, vehicle: { km: S.vehicle.km, pct: S.vehicle.pct, type: S.vehicle.type } } });
    toast(toManual ? '已切回演示数据' : '已切换为手动录入');
  } catch (err) { if (err.code !== 'UNAUTHORIZED') toast('保存失败'); }
});

$('in-scheme').addEventListener('input', (e) => {
  S.key.scheme = e.target.value;
  saveCache(); render();
  clearTimeout(saveTimer);
  saveTimer = async () => {
    try { await api('/api/key/config', { method: 'PUT', body: { scheme: S.key.scheme } }); }
    catch (err) { if (err.code !== 'UNAUTHORIZED') toast('保存失败'); }
  };
});

$('btn-reset').addEventListener('click', async () => {
  try {
    await api('/api/vehicle/status', { method: 'PUT', body: {
      source: 'mock',
      profile: { model: '亚洲龙 双擎', plate: '川S·00000' },
      vehicle: { km: 612, pct: 68, type: 'hev', odo: '', locked: true, windowClosed: true, tire: [240, 241, 236, 238] }
    }});
    await api('/api/key/config', { method: 'PUT', body: { scheme: '' } });
    await loadAll();
    toast('已恢复默认');
  } catch (err) { toast(err.message || '恢复失败'); }
});

/* ================= 弹层 ================= */
function openSheet(title, body) {
  $('sheet-title').textContent = title;
  $('sheet-body').textContent = body;
  $('sheet').hidden = false;
}
$('sheet-close').addEventListener('click', () => { $('sheet').hidden = true; });
$('sheet').addEventListener('click', (e) => { if (e.target === $('sheet')) $('sheet').hidden = true; });

/* ================= PWA ================= */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

/* ================= 启动 ================= */
window.addEventListener('hashchange', route);
document.querySelectorAll('[data-go]').forEach((el) => {
  el.addEventListener('click', () => { location.hash = el.getAttribute('data-go'); });
});

(async function init() {
  if (token) {
    showApp();
    await loadAll();
  } else {
    showLogin();
  }
  route();
})();

setInterval(() => {
  if (!S) return;
  $('v-time').textContent = ago(S.vehicle.capturedAt);
  if (S.location.lat !== null) {
    $('v-pos').textContent = Number(S.location.lat).toFixed(4) + ', ' + Number(S.location.lng).toFixed(4) + ' · ' + ago(S.location.posTime);
  }
}, 60000);
