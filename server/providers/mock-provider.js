'use strict';

/**
 * Mock / 手动录入数据源。
 * 直接读取本地持久化状态：演示数值或用户在设置页手填的数值。
 * 不发起任何对一汽丰田服务器的请求。
 */
function getStatus(state) {
  return {
    source: state.source,
    profile: state.profile,
    vehicle: state.vehicle,
    capturedAt: state.vehicle.capturedAt
  };
}

function getLocation(state) {
  return {
    source: state.source,
    location: state.location
  };
}

module.exports = { getStatus, getLocation };
