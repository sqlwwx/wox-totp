// Wox.Plugin.Totp 主入口：init/query
import { totp, parseUri, remainingSeconds, base32Decode, matchAccount } from "./totp.mjs"
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
      remain_copy: (s) => `enter to copy · ${s}s left`,
      copy_code: (c) => `Copy ${c}`,
      copy_next: "Copy next period code",
      delete_account: "Delete this account",
      copied: (d) => `Copied code for ${d}`,
      copied_next: (c) => `Copied ${c}`,
      deleted: (d) => `Deleted ${d}`,
      err_prefix: (m) => `Error: ${m}`,
      check_log: "See log ~/.wox/log/wox.log",
      build_row_detail: (n) => `${n} accounts total`,
      confirm_delete: (d) => `Delete ${d}?`,
      confirm_hint: "Press enter to confirm delete, or Esc/cancel",
      confirm_yes: "Yes, delete this account",
      confirm_cancel: "Cancel",
      confirm_gone: "Account not found (maybe already deleted)",
      set_alias: "Set alias",
      alias_label: "Alias (empty to clear)",
      alias_saved: (a2) => `Alias saved: ${a2}`,
      alias_cleared: "Alias cleared",
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
      remain_copy: (s) => `回车复制 · 剩余 ${s}s`,
      copy_code: (c) => `复制 ${c}`,
      copy_next: "复制下一周期验证码",
      delete_account: "删除此账户",
      copied: (d) => `已复制 ${d} 的验证码`,
      copied_next: (c) => `已复制 ${c}`,
      deleted: (d) => `已删除 ${d}`,
      err_prefix: (m) => `出错: ${m}`,
      check_log: "查看日志 ~/.wox/log/wox.log",
      build_row_detail: (n) => `共 ${n} 个账户`,
      confirm_delete: (d) => `删除 ${d}？`,
      confirm_hint: "回车确认删除，Esc 或取消返回",
      confirm_yes: "确认删除此账户",
      confirm_cancel: "取消",
      confirm_gone: "账户不存在（可能已删除）",
      set_alias: "设置别名",
      alias_label: "别名（留空清除）",
      alias_saved: (a2) => `别名已保存: ${a2}`,
      alias_cleared: "别名已清除",
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

// action 需要稳定显式 Id：query 每次输入都会重跑，若不设 Id，Wox 每次生成随机 id，
// UI 侧打开表单记住的 action id 在下次 query 后就失效，提交时报
// "plugin form action not found"（保存静默失败）
function act(name, icon, fn, opts) {
  return {
    Id: opts && opts.id,
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
  // 有别名时显示别名，原名退到副标题位置
  return a.alias || `${a.issuer ? a.issuer + " · " : ""}${a.name}`
}

function detail(a) {
  return a.alias ? `${a.issuer ? a.issuer + " · " : ""}${a.name}` : ""
}

// confirm 子命令用的账户键。base64url 编码 issuer/name，避免与空格/冒号混淆
function confirmKey(a) {
  return Buffer.from(`${a.issuer || ""}\u0000${a.name}`, "utf8").toString("base64url")
}

function findByConfirmKey(accounts, key) {
  try {
    const [issuer, name] = Buffer.from(key, "base64url").toString("utf8").split("\u0000")
    return accounts.findIndex((a) => (a.issuer || "") === issuer && a.name === name)
  } catch {
    return -1
  }
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

// 删除确认：totp confirm <key> 显示确认行，回车才真删
async function qConfirm(key) {
  const accounts = readAccounts()
  const i = key ? findByConfirmKey(accounts, key) : -1
  if (i < 0) {
    return single(t("confirm_gone"), t("view_codes"), [])
  }
  const a = accounts[i]
  const backToList = async (actCtx) => {
    await api.ChangeQuery(actCtx, { QueryType: "input", QueryText: "totp " })
  }
  return single(
    t("confirm_delete", display(a)),
    t("confirm_hint"),
    [
      act(t("confirm_yes"), ICON_DEL, async (actCtx) => {
        updateAccounts((accs) => {
          const j = findByConfirmKey(accs, key)
          if (j >= 0) accs.splice(j, 1)
        })
        await api.Notify(actCtx, t("deleted", display(a)))
        await backToList(actCtx)
      }, { isDefault: true }),
      act(t("confirm_cancel"), ICON_EXEC, backToList),
    ]
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
  const matched = accounts.filter((a) => !kw || matchAccount(a, kw))
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
    const sub = [detail(a), t("remain_copy", remain)].filter(Boolean).join(" · ")
    return {
      Id: rowId(a),
      ...result(`${display(a)}  ${code}`, sub, buildActions(a, code), [{ Type: "text", Text: `${remain}s` }]),
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
  // 热重载在同一 Node 进程里加载新模块实例，且不保证调用旧实例的 OnUnload。
  // 若各实例各自 setInterval，会出现多个 timer 交错 UpdateResult 同一行（标题在
  // 新旧文案间来回跳）。timer 句柄挂 globalThis 做进程级单例：启动前先杀旧的。
  if (globalThis.__TOTP_LIVE_TIMER__) clearInterval(globalThis.__TOTP_LIVE_TIMER__)
  if (liveTimer) clearInterval(liveTimer)
  liveTimer = setInterval(() => {
    tickLive().catch((e) => console.error("tickLive:", e.message))
  }, 1000)
  globalThis.__TOTP_LIVE_TIMER__ = liveTimer
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
  let accounts
  try {
    accounts = readAccounts()
  } catch (e) {
    // 存储损坏时别每秒刷屏，query 时已展示错误
    api.Log(lastCtx, "Warning", `tickLive readAccounts: ${e.message}`)
    return
  }
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
      SubTitle: [detail(a), t("remain_copy", remain)].filter(Boolean).join(" · "),
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
  const rid = rowId(a)
  return [
    act(t("copy_code", code), ICON_COPY, async (actCtx) => {
      await api.Copy(actCtx, { type: "text", text: code })
      await api.Notify(actCtx, t("copied", display(a)))
    }, { isDefault: true, id: `${rid}:copy` }),
    act(t("copy_next"), ICON_EXEC, async (actCtx) => {
      const next = totp(a.secret, 1, a.period, a.digits, a.algo)
      await api.Copy(actCtx, { type: "text", text: next })
      await api.Notify(actCtx, t("copied_next", next))
    }, { id: `${rid}:copy_next` }),
    {
      // 别名用表单收集：文本框 + 提交保存；留空提交即清除别名
      // Type 必须显式为 "form"；Id 必须稳定，见 act() 上方注释
      Id: `${rid}:alias`,
      Type: "form",
      Name: t("set_alias"),
      Icon: ICON_EXEC,
      PreventHideAfterAction: true,
      Form: [
        {
          Type: "textbox",
          Value: {
            Key: "alias",
            Label: t("alias_label"),
            DefaultValue: a.alias || "",
            MaxLines: 1,
          },
          DisabledInPlatforms: [],
          IsPlatformSpecific: false,
        },
      ],
      OnSubmit: async (formCtx, actionContext) => {
        const alias = (actionContext.Values.alias || "").trim()
        updateAccounts((accs) => {
          const j = accs.findIndex((x) => x.name === a.name && (x.issuer || "") === (a.issuer || ""))
          if (j >= 0) {
            if (alias) accs[j].alias = alias
            else delete accs[j].alias
          }
        })
        await api.Notify(formCtx, alias ? t("alias_saved", alias) : t("alias_cleared"))
        await api.RefreshQuery(formCtx, { PreserveSelectedIndex: true })
      },
    },
    act(t("delete_account"), ICON_DEL, async (actCtx) => {
      // 二次确认：跳到 confirm 子命令，回车确认行才真删
      await api.ChangeQuery(actCtx, {
        QueryType: "input",
        QueryText: `totp confirm ${confirmKey(a)}`,
      })
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
    // 热重载/卸载时停掉 liveTimer，避免旧模块的 timer 泄漏
    await api.OnUnload(ctx, async () => {
      if (globalThis.__TOTP_LIVE_TIMER__) {
        clearInterval(globalThis.__TOTP_LIVE_TIMER__)
        globalThis.__TOTP_LIVE_TIMER__ = null
      }
      if (liveTimer) {
        clearInterval(liveTimer)
        liveTimer = null
      }
      lastRendered.clear()
    })
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
      // confirm 是隐藏子命令（SUBCMDS 提示里不出现），"confirm".startsWith(cmd) 会误命中，
      // 所以单独精确匹配
      if (cmd === "confirm") return await qConfirm(parts[1])
      const hintable = !cmd || "add".startsWith(cmd)
      const hints = accounts.length > 0 && hintable ? subcmdHints(hintable ? cmd || "" : "") : []
      if (cmd === "add") return await qAdd(parts)
      const list = await qList(search)
      // 空输入时在列表末尾追加 build 时间行，用于确认热重载后的版本
      // build 时间行仅开发构建（--watch 注入 __BUILD_TIME__）时显示
      // globalThis 而非裸标识符：测试直接 import 源码时没有 Bun define，裸标识符会抛 ReferenceError
      const buildRow = !cmd && globalThis.__BUILD_TIME__ ? [result(`build ${globalThis.__BUILD_TIME__}`, t("build_row_detail", accounts.length), [])] : []
      return { Results: [...hints, ...list.Results, ...buildRow] }
    } catch (e) {
      api.Log(ctx, "Error", `query 失败: ${e.stack || e.message}`)
      return single(t("err_prefix", e.message), t("check_log"), [])
    }
  },
}

// 仅供测试使用（test_totp.js 直接取内部函数）
export const _test = { base32Decode, totp, parseUri, matchAccount }
