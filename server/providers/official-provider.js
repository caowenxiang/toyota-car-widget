'use strict';

/**
 * 官方车联网（TSP）数据源 —— 占位实现，尚未接入。
 *
 * 真实的续航、定位、车况来自一汽丰田 TSP 私有接口，需要：
 *  1. 官方开放平台资质与 AppKey/Secret；
 *  2. 车主授权 OAuth 凭证；
 *  3. 通过官方 SDK 或带签名风控的接口调用。
 * 当前没有上述授权，因此这里不构造任何私有请求，也不通过抓包绕过签名。
 * 将来拿到授权后，在本文件内补齐 TSP 客户端与字段映射，上层路由无需改动。
 */
const NOT_CONFIGURED = {
  status: 501,
  code: 'OFFICIAL_NOT_CONFIGURED',
  message: '官方车联网接口尚未接入：缺少开放平台授权。当前使用本地演示/手动录入数据。'
};

function getStatus() {
  throw NOT_CONFIGURED;
}

function getLocation() {
  throw NOT_CONFIGURED;
}

module.exports = { getStatus, getLocation, NOT_CONFIGURED };
