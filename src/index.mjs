/**
 * Wox.Plugin.Totp 主入口：init/query 生命周期装配。
 * 职责划分：
 *   totp.mjs     — 纯算法（TOTP/base32/URI 解析/匹配）
 *   store.mjs    — 加密存储与会话（AES-GCM/scrypt/unlock/lock）
 *   i18n.mjs     — 翻译
 *   context.mjs  — 模块级 api/ctx 存取（node-host 裸调不绑定 this）
 *   ui.mjs       — Wox Result/Action 基础构造
 *   views.mjs    — 结果行与表单 action（锁定态/账号动作）
 *   commands.mjs — 子命令与查询分发
 *   live.mjs     — 每秒实时刷新可见行
 *   index.mjs    — init/query 生命周期装配（本文件）
 * @module index
 */

import { setApi, captureCtx, getApi } from "./context.mjs"
import { initI18n, t, tErr } from "./i18n.mjs"
import { initStore } from "./store.mjs"
import { dispatchQuery } from "./commands.mjs"
import { startLiveTimer, stopLiveTimer, clearRenderCache } from "./live.mjs"
import { single } from "./ui.mjs"

export const plugin = {
  /**
   * 插件初始化：保存 api/ctx、初始化翻译、定位缓存目录、启动秒级刷新 timer。
   * @param {Object} ctx - Wox 上下文
   * @param {{API: Object}} params - 宿主注入参数，params.API 为 Wox API
   * @returns {Promise<void>}
   */
  async init(ctx, params) {
    const api = params.API
    setApi(api)
    captureCtx(ctx)
    await initI18n(api, ctx, params.PluginDirectory)
    // 加密存储改用插件 setting（升级/卸载缓存目录会被 Wox 清掉，setting 保留）
    await initStore(api, ctx)
    // 热重载/卸载时停掉 liveTimer，避免旧模块的 timer 泄漏
    await api.OnUnload(ctx, async () => {
      stopLiveTimer()
      clearRenderCache()
    })
    // 事件驱动刷新：进入插件面板才起 timer，离开即停。
    // 之前是 init 起常驻 timer + 每秒轮询 IsVisible，面板没开也在跑（7×24 每秒 1 次 RPC）。
    await api.OnEnterPluginQuery(ctx, () => startLiveTimer())
    await api.OnLeavePluginQuery(ctx, () => stopLiveTimer())
  },

  /**
   * 查询入口：捕获 ctx 后交给 dispatchQuery 分发，任何异常兜底成错误结果行。
   * @param {Object} ctx - Wox 上下文
   * @param {{Search: string}} query - Wox 查询对象
   * @returns {Promise<{Results: Array<Object>}>}
   */
  async query(ctx, query) {
    captureCtx(ctx)
    try {
      return await dispatchQuery(ctx, query)
    } catch (e) {
      getApi().Log(ctx, "Error", `query 失败: ${e.stack || e.message}`)
      return single(t("err_prefix", tErr(e)), t("check_log"), [])
    }
  },
}

// 仅供测试使用（test_totp.js 直接取内部函数）
export { base32Decode, totp, parseUri, matchAccount } from "./totp.mjs"
