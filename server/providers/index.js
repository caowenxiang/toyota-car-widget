'use strict';

const mock = require('./mock-provider');
const official = require('./official-provider');

/**
 * 数据源选择器。
 * source:
 *  - mock / manual：本地 Mock 与手动录入（当前可用）
 *  - official：官方 TSP（占位，未接入）
 */
function resolve(source) {
  if (source === 'official') return official;
  return mock;
}

module.exports = { resolve, official };
