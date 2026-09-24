/**
 * 插件运行时上下文：Wox API 与最近 query/action ctx 的模块级存取。
 * Wox node-host 裸调插件方法不绑定 this，api/ctx 用模块级变量保存，跨 query 存活。
 * @module context
 */

let api = null
let lastCtx = null

/**
 * 保存 init 时注入的 Wox API 对象。
 * @param {Object} a - Wox API（params.API）
 * @returns {void}
 */
export function setApi(a) {
  api = a
}

/**
 * 获取当前 Wox API；init 前调用返回 null。
 * @returns {Object|null}
 */
export function getApi() {
  return api
}

/**
 * 记录最近一次 query/action 的 ctx，供定时器里的 IsVisible/UpdateResult/Log 使用。
 * @param {Object} ctx - Wox 上下文
 * @returns {void}
 */
export function captureCtx(ctx) {
  lastCtx = ctx
}

/**
 * 获取最近一次记录的 ctx。
 * @returns {Object|null}
 */
export function currentCtx() {
  return lastCtx
}
