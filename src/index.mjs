// Wox.Plugin.Totp 主入口：init/query
import { totp, parseUri, remainingSeconds, base32Decode } from "./totp.mjs"
import { setCacheDir, readAccounts, updateAccounts } from "./store.mjs"

// ---------- i18n ----------
// 界面语言经 plugin.json 的 I18n 字典 + GetTranslation 提供；语言探测键 language_probe
// 返回 "en"/"zh"，用于初始化兜底字典（GetTranslation 不可用时 fallback 到 zh）
let t = (_key, ...args) => ""
async function initI18n(ctx) {
  let probe = "zh"
  try {
    probe = (await api.GetTranslation(ctx, "language_probe")).trim() || "zh"
  } catch {}
  const dicts = {
    en: {
      hint_no_op: "Enter does nothing, keep typing parameters",
      err_invalid_uri: (m) => `Invalid otpauth URI: ${m}`,
      err_uri_example: "Example: otpauth://totp/GitHub:me?secret=XXXX",
      err_invalid_secret: (m) => `Invalid secret: ${m}`,
      err_secret_hint: "Expected base32 (A-Z2-7, as provided by Google Authenticator)",
      added: (d) => `Added ${d}`,
      view_codes: "Type totp to view codes",
      empty_title: "No accounts yet",
      empty_subtitle: "Press enter to fill in totp add, then paste an otpauth URI",
      action_add: "Add account",
      no_match: "No matching accounts",
      no_match_detail: (n, kw) => `${n} accounts total, keyword "${kw}"`,
      remain_copy: (s) => `${s}s left · enter to copy`,
      copy_code: (c) => `Copy ${c}`,
      copy_next: "Copy next period code",
      delete_account: "Delete this account",
      copied: (d) => `Copied code for ${d}`,
      copied_next: (c) => `Copied ${c}`,
      deleted: (d) => `Deleted ${d}`,
      err_prefix: (m) => `Error: ${m}`,
      check_log: "See log ~/.wox/log/wox.log",
      build_row_detail: (n) => `${n} accounts total`,
    },
    zh: {
      hint_no_op: "回车无操作，继续输入参数",
      err_invalid_uri: (m) => `otpauth 链接无效: ${m}`,
      err_uri_example: "示例: otpauth://totp/GitHub:me?secret=XXXX",
      err_invalid_secret: (m) => `secret 无效: ${m}`,
      err_secret_hint: "应为 base32（A-Z2-7，Google Authenticator 提供的格式）",
      added: (d) => `已添加 ${d}`,
      view_codes: "输入 totp 查看验证码",
      empty_title: "还没有账户",
      empty_subtitle: "回车填入 totp add，再粘贴 otpauth 链接",
      action_add: "添加账户",
      no_match: "没有匹配的账户",
      no_match_detail: (n, kw) => `共 ${n} 个账户，关键字「${kw}」`,
      remain_copy: (s) => `剩余 ${s}s · 回车复制`,
      copy_code: (c) => `复制 ${c}`,
      copy_next: "复制下一周期验证码",
      delete_account: "删除此账户",
      copied: (d) => `已复制 ${d} 的验证码`,
      copied_next: (c) => `已复制 ${c}`,
      deleted: (d) => `已删除 ${d}`,
      err_prefix: (m) => `出错: ${m}`,
      check_log: "查看日志 ~/.wox/log/wox.log",
      build_row_detail: (n) => `共 ${n} 个账户`,
    },
  }
  const dict = dicts[probe] || dicts.zh
  // t(key, ...args)：优先 Wox 翻译（静态文案），带参文案用本地字典函数
  t = (key, ...args) => {
    const local = dict[key]
    if (typeof local === "function") return local(...args)
    if (local !== undefined) return local
    return key
  }
}

// 动作图标（Action Panel 需单色 svg，跟随主题变量）
const ICON_COPY = {
  ImageType: "svg",
  ImageData:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--wox-theme-icon-color)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
}
const ICON_EXEC = {
  ImageType: "svg",
  ImageData:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--wox-theme-icon-color)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4.5 13.5h5.5L9 22l10-13h-6z"/></svg>',
}

const ICON_DEL = {
  ImageType: "svg",
  ImageData:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--wox-theme-icon-color)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
}

// 编译时间由 Bun.build define 注入（见 build.mjs），用于确认热重载生效

// ---------- 插件状态（模块级变量，跨 query 存活；Wox node-host 裸调不绑定 this） ----------
let api = null

// ---------- 结果构造 ----------
function result(title, subTitle, actions = [], tails) {
  return {
    Title: title,
    SubTitle: subTitle,
    Icon: { ImageType: "emoji", ImageData: "🔐" },
    Score: 100,
    Actions: actions,
    ...(tails ? { Tails: tails } : {}),
  }
}

// 列表行稳定 Id：UpdateResult 按 Id 原地刷新剩余时间/验证码
function rowId(a) {
  return `totp:${a.issuer || "-"}:${a.name}`
}

function single(title, subTitle, actions = []) {
  return { Results: [result(title, subTitle, actions)] }
}

function act(name, icon, fn, opts) {
  return {
    Name: name,
    Icon: icon,
    IsDefault: !!(opts && opts.isDefault),
    Action: async (actCtx) => {
      try {
        await fn(actCtx)
      } catch (e) {
        await api.Notify(actCtx, `TOTP: ${e.message}`)
      }
    },
  }
}

function display(a) {
  return `${a.issuer ? a.issuer + " · " : ""}${a.name}`
}

// ---------- 各命令 ----------
// 子命令提示：输入为空或部分匹配时显示
const SUBCMDS = [
  { cmd: "add", hint: "totp add <otpauth://totp/...>" },
]

function subcmdHints(cmd) {
  return SUBCMDS.filter((s) => !cmd || s.cmd.startsWith(cmd.toLowerCase())).map((s) =>
    result(s.hint, t("hint_no_op"), [])
  )
}

async function qAdd(parts) {
  // 仅支持 totp add <otpauth://totp/...>，名字/issuer/参数都从 URI 解析
  let entry
  try {
    entry = parseUri(parts[1])
  } catch (e) {
    return single(t("err_invalid_uri", e.message), t("err_uri_example"), [])
  }
  // 先验证 secret 合法，避免存进坏数据
  try {
    totp(entry.secret, 0, entry.period, entry.digits, entry.algo)
  } catch (e) {
    return single(t("err_invalid_secret", e.message), t("err_secret_hint"), [])
  }
  updateAccounts((accounts) => {
    // 同一 issuer+name 视为同一条目（覆盖），否则可能账号同名
    const i = accounts.findIndex((a) => a.name === entry.name && (a.issuer || "") === entry.issuer)
    if (i >= 0) accounts[i] = entry
    else accounts.push(entry)
  })
  return single(t("added", display(entry)), t("view_codes"), [])
}

async function qList(search) {
  const accounts = readAccounts()
  if (accounts.length === 0) {
    return single(t("empty_title"), t("empty_subtitle"), [
      act(t("action_add"), ICON_EXEC, async (actCtx) => {
        await api.ChangeQuery(actCtx, { QueryType: "input", QueryText: "totp add " })
      }, { isDefault: true }),
    ])
  }

  const kw = search.toLowerCase()
  const matched = accounts.filter((a) => !kw || a.name.toLowerCase().includes(kw) || (a.issuer || "").toLowerCase().includes(kw))
  if (matched.length === 0) {
    return single(t("no_match"), t("no_match_detail", accounts.length, search), [])
  }

  const results = matched.map((a) => {
    let code
    try {
      code = totp(a.secret, 0, a.period, a.digits, a.algo)
    } catch (e) {
      return result(a.name, t("err_invalid_secret", e.message), [])
    }
    const remain = remainingSeconds(a.period)
    lastRendered.set(rowId(a), { code, remain })
    return {
      Id: rowId(a),
      ...result(`${display(a)}  ${code}`, t("remain_copy", remain), buildActions(a, code), [{ Type: "text", Text: `${remain}s` }]),
    }
  })
  return { Results: results }
}

// 最近一次 query/action 的 ctx，供定时器里的 IsVisible/UpdateResult/Log 使用
let lastCtx = null
function captureCtx(ctx) {
  lastCtx = ctx
}

// 渲染快照：值变化才发 UpdateResult，避免每秒无谓重绘
const lastRendered = new Map()

// 实时刷新：每秒重算可见列表行的剩余秒数，UpdateResult 原地更新
// 周期翻转（code 变了）时连 Actions 一起更新，否则复制动作闭包里还是旧 code
let liveTimer = null
function startLiveTimer() {
  if (liveTimer) return
  liveTimer = setInterval(tickLive, 1000)
}

async function tickLive() {
  if (!lastCtx) return
  let visible = false
  try {
    visible = await api.IsVisible(lastCtx)
  } catch {
    return
  }
  if (!visible) return
  const accounts = readAccounts()
  for (const a of accounts) {
    let code
    try {
      code = totp(a.secret, 0, a.period, a.digits, a.algo)
    } catch {
      continue // 无效 secret 行保持原样（query 时已显示错误）
    }
    const remain = remainingSeconds(a.period)
    const prev = lastRendered.get(rowId(a))
    if (prev && prev.code === code && prev.remain === remain) continue
    const update = {
      Id: rowId(a),
      Title: `${display(a)}  ${code}`,
      SubTitle: t("remain_copy", remain),
      Tails: [{ Type: "text", Text: `${remain}s` }],
    }
    if (!prev || prev.code !== code) {
      update.Actions = buildActions(a, code)
    }
    lastRendered.set(rowId(a), { code, remain })
    try {
      await api.UpdateResult(lastCtx, update)
    } catch (e) {
      api.Log(lastCtx, "Warning", `UpdateResult ${rowId(a)}: ${e.message}`)
    }
  }
}

function buildActions(a, code) {
  return [
    act(t("copy_code", code), ICON_COPY, async (actCtx) => {
      await api.Copy(actCtx, { type: "text", text: code })
      await api.Notify(actCtx, t("copied", display(a)))
    }, { isDefault: true }),
    act(t("copy_next"), ICON_EXEC, async (actCtx) => {
      const next = totp(a.secret, 1, a.period, a.digits, a.algo)
      await api.Copy(actCtx, { type: "text", text: next })
      await api.Notify(actCtx, t("copied_next", next))
    }),
    act(t("delete_account"), ICON_DEL, async (actCtx) => {
      updateAccounts((accounts) => {
        accounts.splice(accounts.findIndex((x) => x.name === a.name && (x.issuer || "") === (a.issuer || "")), 1)
      })
      await api.Notify(actCtx, t("deleted", display(a)))
      await api.RefreshQuery(actCtx, { PreserveSelectedIndex: true })
    }),
  ]
}

// ---------- Wox 插件导出 ----------
// 注意：Wox node-host 调 init/query 时不绑定 this，用模块级变量保存状态
export const plugin = {
  async init(ctx, params) {
    api = params.API
    captureCtx(ctx)
    await initI18n(ctx)
    let dir = ""
    try {
      dir = await api.GetCacheFolder(ctx)
      setCacheDir(dir)
    } catch {
      setCacheDir("")
    }
    api.Log(ctx, "Info", `totp plugin init, cacheDir=${dir}`)
    startLiveTimer()
  },

  async query(ctx, query) {
    captureCtx(ctx)
    const search = (query.Search || "").trim()
    const parts = search.split(/\s+/).filter(Boolean)
    const cmd = parts[0]

    try {
      // 空输入或正输入 add 前缀时，列表前置子命令用法提示
      // 空状态不给提示（add 用法在空状态引导里）；有账户时仅当输入为空或 add 前缀才提示，避免干扰搜索
      const accounts = readAccounts()
      const hintable = !cmd || "add".startsWith(cmd)
      const hints = accounts.length > 0 && hintable ? subcmdHints(hintable ? cmd || "" : "") : []
      if (cmd === "add") return await qAdd(parts)
      const list = await qList(search)
      // 空输入时在列表末尾追加 build 时间行，用于确认热重载后的版本
      // build 时间行仅开发构建（--watch 注入 __BUILD_TIME__）时显示
      const buildRow = !cmd && __BUILD_TIME__ ? [result(`build ${__BUILD_TIME__}`, t("build_row_detail", accounts.length), [])] : []
      return { Results: [...hints, ...list.Results, ...buildRow] }
    } catch (e) {
      api.Log(ctx, "Error", `query 失败: ${e.stack || e.message}`)
      return single(t("err_prefix", e.message), t("check_log"), [])
    }
  },
}

// 仅供测试使用（test_totp.js 直接取内部函数）
export const _test = { base32Decode, totp, parseUri }
