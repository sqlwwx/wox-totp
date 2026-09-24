/**
 * Wox UI 构建层：Result/Action/Form 等宿主数据结构的组装。
 * （动作图标、结果行、action 构造、显示文案 helper）
 * @module ui
 */

import { getApi } from "./context.mjs"

/** 复制图标（Action Panel 需单色 svg，跟随主题变量） */
export const ICON_COPY = {
  ImageType: "svg",
  ImageData:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--wox-theme-icon-color)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
}

/** 执行图标（闪电） */
export const ICON_EXEC = {
  ImageType: "svg",
  ImageData:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--wox-theme-icon-color)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4.5 13.5h5.5L9 22l10-13h-6z"/></svg>',
}

/** 删除图标（垃圾桶） */
export const ICON_DEL = {
  ImageType: "svg",
  ImageData:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--wox-theme-icon-color)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
}

/** 锁定图标（挂锁） */
export const ICON_LOCK = {
  ImageType: "svg",
  ImageData:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--wox-theme-icon-color)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
}

/**
 * 构造一行查询结果。
 * score 控制显示顺序：Wox 按 Score 降序排列，同分则按 Title 字母序（会打乱中文行序）。
 * @param {string} title - 行标题
 * @param {string} subTitle - 行副标题
 * @param {Array<Object>} [actions=[]] - action 集合
 * @param {Array<Object>} [tails] - 行尾元素（如剩余秒数）
 * @param {string} [id] - 结果稳定 Id（UpdateResult 原地刷新依赖它）
 * @param {number} [score=100] - 排序分值
 * @returns {Object} Wox QueryResult 形状
 */
export function result(title, subTitle, actions = [], tails, id, score = 100) {
  return {
    ...(id ? { Id: id } : {}),
    Title: title,
    SubTitle: subTitle,
    Icon: { ImageType: "emoji", ImageData: "🔐" },
    Score: score,
    Actions: actions,
    ...(tails ? { Tails: tails } : {}),
  }
}

/**
 * 构造单行结果响应（错误提示/命令反馈等）。
 * @param {string} title - 行标题
 * @param {string} subTitle - 行副标题
 * @param {Array<Object>} [actions=[]] - action 集合
 * @returns {{Results: Array<Object>}}
 */
export function single(title, subTitle, actions = []) {
  return { Results: [result(title, subTitle, actions)] }
}

/**
 * 构造一个 action。action 必须带稳定显式 Id：query 每次输入都会重跑，若不设 Id，
 * Wox 每次生成随机 id，UI 侧打开表单记住的 action id 在下次 query 后就失效，提交时报
 * "plugin form action not found"（保存静默失败）。
 * @param {string} name - action 显示名
 * @param {Object} icon - action 图标
 * @param {(actCtx: Object) => Promise<void>} fn - 点击回调
 * @param {Object} [opts]
 * @param {string} [opts.id] - 稳定 action Id（强烈建议显式设置）
 * @param {boolean} [opts.isDefault] - 是否回车默认触发
 * @returns {Object} Wox QueryResultAction 形状
 */
export function act(name, icon, fn, opts) {
  return {
    Id: opts && opts.id,
    Name: name,
    Icon: icon,
    IsDefault: !!(opts && opts.isDefault),
    Action: async (actCtx) => {
      try {
        await fn(actCtx)
      } catch (e) {
        await getApi().Notify(actCtx, `TOTP: ${e.message}`)
      }
    },
  }
}

/**
 * 账户显示名：有别名时显示别名，原名退到副标题位置。
 * @param {{alias?: string, issuer?: string, name: string}} a - 账户
 * @returns {string}
 */
export function display(a) {
  return a.alias || `${a.issuer ? a.issuer + " · " : ""}${a.name}`
}

/**
 * 别名存在时的"原名"副标题；无别名返回空串（拼副标题时被 filter 掉）。
 * @param {{alias?: string, issuer?: string, name: string}} a - 账户
 * @returns {string}
 */
export function detail(a) {
  return a.alias ? `${a.issuer ? a.issuer + " · " : ""}${a.name}` : ""
}

/**
 * 列表行稳定 Id：UpdateResult 按 Id 原地刷新剩余时间/验证码。
 * @param {{issuer?: string, name: string}} a - 账户
 * @returns {string} 形如 `totp:{issuer}:{name}`
 */
export function rowId(a) {
  return `totp:${a.issuer || "-"}:${a.name}`
}

/**
 * 生成 confirm 子命令用的账户键：base64url 编码 issuer/name，避免与空格/冒号混淆。
 * @param {{issuer?: string, name: string}} a - 账户
 * @returns {string}
 */
export function confirmKey(a) {
  return Buffer.from(`${a.issuer || ""}\u0000${a.name}`, "utf8").toString("base64url")
}

/**
 * 按 confirmKey 查找账户下标。
 * @param {Array<Object>} accounts - 账户数组
 * @param {string} key - confirmKey() 生成的键
 * @returns {number} 下标；找不到或 key 非法返回 -1
 */
export function findByConfirmKey(accounts, key) {
  try {
    const [issuer, name] = Buffer.from(key, "base64url").toString("utf8").split("\u0000")
    return accounts.findIndex((a) => (a.issuer || "") === issuer && a.name === name)
  } catch {
    return -1
  }
}
