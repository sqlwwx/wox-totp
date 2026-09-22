// Wox.Plugin.Totp 主入口：init/query
import { totp, parseUri, remainingSeconds, base32Decode } from "./totp.mjs"
import { setCacheDir, readAccounts, updateAccounts } from "./store.mjs"

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
    result(s.hint, "回车无操作，继续输入参数", [])
  )
}

async function qAdd(parts) {
  // 仅支持 totp add <otpauth://totp/...>，名字/issuer/参数都从 URI 解析
  let entry
  try {
    entry = parseUri(parts[1])
  } catch (e) {
    return single(`otpauth 链接无效: ${e.message}`, "示例: otpauth://totp/GitHub:me?secret=XXXX", [])
  }
  // 先验证 secret 合法，避免存进坏数据
  try {
    totp(entry.secret, 0, entry.period, entry.digits, entry.algo)
  } catch (e) {
    return single(`secret 无效: ${e.message}`, "应为 base32（A-Z2-7，Google Authenticator 提供的格式）", [])
  }
  updateAccounts((accounts) => {
    // 同一 issuer+name 视为同一条目（覆盖），否则可能账号同名
    const i = accounts.findIndex((a) => a.name === entry.name && (a.issuer || "") === entry.issuer)
    if (i >= 0) accounts[i] = entry
    else accounts.push(entry)
  })
  return single(`已添加 ${display(entry)}`, "输入 totp 查看验证码", [])
}

async function qList(search) {
  const accounts = readAccounts()
  if (accounts.length === 0) {
    return single("还没有账户", "回车填入 totp add，再粘贴 otpauth 链接", [
      act("添加账户", ICON_EXEC, async (actCtx) => {
        await api.ChangeQuery(actCtx, { QueryType: "input", QueryText: "totp add " })
      }, { isDefault: true }),
    ])
  }

  const kw = search.toLowerCase()
  const matched = accounts.filter((a) => !kw || a.name.toLowerCase().includes(kw) || (a.issuer || "").toLowerCase().includes(kw))
  if (matched.length === 0) {
    return single("没有匹配的账户", `共 ${accounts.length} 个账户，关键字「${search}」`, [])
  }

  const results = matched.map((a) => {
    let code
    try {
      code = totp(a.secret, 0, a.period, a.digits, a.algo)
    } catch (e) {
      return result(a.name, `secret 无效: ${e.message}`, [])
    }
    const remain = remainingSeconds(a.period)
    return result(`${display(a)}  ${code}`, `剩余 ${remain}s · 回车复制`, [
      act(`复制 ${code}`, ICON_COPY, async (actCtx) => {
        await api.Copy(actCtx, { type: "text", text: code })
        await api.Notify(actCtx, `已复制 ${display(a)} 的验证码`)
      }, { isDefault: true }),
      act("复制下一周期验证码", ICON_EXEC, async (actCtx) => {
        const next = totp(a.secret, 1, a.period, a.digits, a.algo)
        await api.Copy(actCtx, { type: "text", text: next })
        await api.Notify(actCtx, `已复制 ${next}`)
      }),
      act("删除此账户", ICON_DEL, async (actCtx) => {
        updateAccounts((accounts) => {
          accounts.splice(accounts.findIndex((x) => x.name === a.name && (x.issuer || "") === (a.issuer || "")), 1)
        })
        await api.Notify(actCtx, `已删除 ${display(a)}`)
        await api.RefreshQuery(actCtx, { PreserveSelectedIndex: true })
      }),
    ], [{ Type: "text", Text: `${remain}s` }])
  })
  return { Results: results }
}

// ---------- Wox 插件导出 ----------
// 注意：Wox node-host 调 init/query 时不绑定 this，用模块级变量保存状态
export const plugin = {
  async init(ctx, params) {
    api = params.API
    let dir = ""
    try {
      dir = await api.GetCacheFolder(ctx)
      setCacheDir(dir)
    } catch {
      setCacheDir("")
    }
    api.Log(ctx, "Info", `totp plugin init, cacheDir=${dir}`)
  },

  async query(ctx, query) {
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
      const buildRow = !cmd && __BUILD_TIME__ ? [result(`build ${__BUILD_TIME__}`, `共 ${accounts.length} 个账户`, [])] : []
      return { Results: [...hints, ...list.Results, ...buildRow] }
    } catch (e) {
      api.Log(ctx, "Error", `query 失败: ${e.stack || e.message}`)
      return single(`出错: ${e.message}`, "查看日志 ~/.wox/log/wox.log", [])
    }
  },
}

// 仅供测试使用（test_totp.js 直接取内部函数）
export const _test = { base32Decode, totp, parseUri }
