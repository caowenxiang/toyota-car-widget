'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

/**
 * 本地演示状态。
 * 注意：这里的所有车况、定位数值都是演示或用户手动录入的，
 * 不来自一汽丰田车联网服务器。官方 Provider 尚未接入（见 providers/official-provider.js）。
 */
function defaultState() {
  return {
    profile: {
      model: '亚洲龙 双擎',
      plate: '川S·00000'
    },
    vehicle: {
      km: 612,
      pct: 68,
      type: 'hev', // hev | ice | ev
      odo: '',
      locked: true,
      windowClosed: true,
      tire: [240, 241, 236, 238],
      capturedAt: Date.now() - 8 * 60 * 1000
    },
    location: {
      lat: null,
      lng: null,
      acc: null,
      posTime: null
    },
    key: {
      scheme: '' // 官方 App 的 URL Scheme，仅用于深链唤起
    },
    source: 'mock' // mock | manual | official
  };
}

function deepMerge(base, override) {
  if (!override || typeof override !== 'object') return base;
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  for (const k of Object.keys(override)) {
    const b = base ? base[k] : undefined;
    const o = override[k];
    if (o && typeof o === 'object' && !Array.isArray(o) && b && typeof b === 'object') {
      out[k] = deepMerge(b, o);
    } else if (o !== undefined) {
      out[k] = Array.isArray(o) ? o.slice() : o;
    }
  }
  return out;
}

let cache = null;

function load() {
  if (cache) return cache;
  const base = defaultState();
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      cache = deepMerge(base, JSON.parse(raw));
    } else {
      cache = base;
      persist();
    }
  } catch (e) {
    cache = base;
  }
  return cache;
}

function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf8');
  fs.renameSync(tmp, STATE_FILE);
}

function update(patch) {
  cache = deepMerge(load(), patch);
  persist();
  return cache;
}

function reset() {
  cache = defaultState();
  persist();
  return cache;
}

module.exports = { load, update, reset, STATE_FILE };
