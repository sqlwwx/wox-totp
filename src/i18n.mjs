/**
 * i18n：文案唯一来源是 plugin.json 的 I18n 字典（构建时拷进 dist，随包分发）。
 * initI18n 时经 GetTranslation("language_probe") 探测语言（en/zh，1 次 RPC），
 * 然后读插件目录下 plugin.json 的 I18n map，t() 同步查表 + {0} 占位符插值。
 * 不逐 key 走 GetTranslation：每次调用是一次 websocket 往返，query 每敲一键
 * 会产生几十次 RPC；探测一次后查本地字典零开销。
 * @module i18n
 */
import fs from "fs"
import path from "path"

/** @type {(key: string) => string} 当前生效的查表实现，initI18n 后被替换 */
let lookup = (key) => key

/**
 * 翻译函数：查 I18n 字典并做 {0}/{1} 占位符插值；缺 key 返回 key 本身。
 * @param {string} key - 翻译键
 * @param {...any} args - 占位符参数
 * @returns {string}
 */
export const t = (key, ...args) => interpolate(lookup(key), args)

/**
 * 构造带翻译键的错误：Error.message 恒为 key（日志可读、与初始化状态无关），
 * key/args 挂在错误对象上，展示层（Notify/错误结果行）用 tErr 按当前语言翻译。
 * @param {string} key - I18n 翻译键
 * @param {...any} args - 占位符参数
 * @returns {Error}
 */
export function err(key, ...args) {
  const e = new Error(key)
  e.key = key
  e.args = args
  return e
}

/**
 * 展示层的错误翻译：带 key 的错误按当前语言查字典插值，其余返回原 message。
 * @param {unknown} e - 任意抛出值
 * @returns {string}
 */
export function tErr(e) {
  return e && e.key ? interpolate(lookup(e.key), e.args) : String((e && e.message) || e)
}

/** 占位符插值：{0}/{1} 替换为 args，缺参留空 */
function interpolate(tpl, args) {
  return String(tpl).replace(/\{(\d+)\}/g, (_, i) => String(args[i] ?? ""))
}

/**
 * 初始化翻译：探测语言，读取插件目录下 plugin.json 的 I18n 字典。
 * Wox 运行期切换语言不触发插件重载，新语言需重启 Wox 或重载插件生效
 * （与旧版探测方案行为一致）。
 * @param {Object} api - Wox API
 * @param {Object} ctx - Wox 上下文
 * @param {string} [pluginDir] - 插件目录（initParams.PluginDirectory）
 * @returns {Promise<void>}
 */
export async function initI18n(api, ctx, pluginDir) {
  let probe = "zh"
  try {
    probe = (await api.GetTranslation(ctx, "language_probe")).trim() || "zh"
  } catch {}
  let i18n = {}
  try {
    i18n = JSON.parse(fs.readFileSync(path.join(pluginDir, "plugin.json"), "utf8")).I18n || {}
  } catch {}
  // 插件只提供 en_US/zh_CN 两语言；探测到其他语言回退英文
  const lang = probe.startsWith("en") ? "en_US" : "zh_CN"
  lookup = (key) => i18n[lang]?.[key] ?? (i18n.en_US || {})[key] ?? key
}
