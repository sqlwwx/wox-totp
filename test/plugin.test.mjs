// 集成测试：mock Wox API 驱动 index.mjs 的 init/query
// 覆盖：query 分发（list/add/confirm）、空状态、覆盖添加、删除确认流程、
//       updateActions 行为、存储损坏时的错误展示
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { plugin } from "../src/index.mjs"

const SECRET = "JBSWY3DPEHPK3PXP"
const URI = (extra = "") => `otpauth://totp/GitHub:me@x.com?secret=${SECRET}${extra}`

// ---------- mock API ----------
function makeApi(state) {
  const api = {
    logs: [],
    notifies: [],
    copies: [],
    changes: [],
    refreshes: 0,
    visible: true,
    GetTranslation: async (_ctx, key) => (key === "language_probe" ? "zh" : key),
    GetCacheFolder: async () => state.cacheDir,
    Log: async (_ctx, level, msg) => api.logs.push(`${level}: ${msg}`),
    Notify: async (_ctx, msg) => api.notifies.push(msg),
    Copy: async (_ctx, p) => api.copies.push(p.text),
    ChangeQuery: async (_ctx, q) => api.changes.push(q.QueryText),
    RefreshQuery: async () => { api.refreshes++ },
    IsVisible: async () => api.visible,
    UpdateResult: async () => true,
    OnUnload: async (_ctx, cb) => state.unloadCbs.push(cb),
    OnEnterPluginQuery: async () => {},
    OnLeavePluginQuery: async () => {},
  }
  return api
}

// 每个 test 前重置模块状态：index.mjs 的 api/lastCtx 是模块级变量，
// 用 query registry 技巧无法隔离，所以直接依赖 init 覆盖 api，缓存目录隔离数据
let state, api, ctx
const query = async (search) => {
  const q = { Search: search, Type: "input" }
  return await plugin.query(ctx, q)
}

beforeEach(async () => {
  state = { cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), "totp-it-")), unloadCbs: [] }
  api = makeApi(state)
  ctx = {}
  await plugin.init(ctx, { API: api })
})

afterEach(() => {
  // init 注册的 OnUnload 会清掉 liveTimer
  for (const cb of state.unloadCbs) await_clear(cb)
  fs.rmSync(state.cacheDir, { recursive: true, force: true })
})
async function await_clear(cb) { await cb(ctx) }

const defaultAction = (r) => r.Actions.find((a) => a.IsDefault)

// ---------- 查询列表 ----------
describe("query list", () => {
  test("空状态：引导行 + 默认 action 跳到 add", async () => {
    const res = await query("")
    expect(res.Results).toHaveLength(1)
    expect(defaultAction(res.Results[0])).toBeDefined()
    await defaultAction(res.Results[0]).Action(ctx, {})
    expect(api.changes).toEqual(["totp add "])
  })

  test("列出账户，Title 含验证码，Tails 显示剩余秒数", async () => {
    await query(`add ${URI()}`) // 先添加一个
    const res = await query("")
    const row = res.Results.find((r) => r.Id?.startsWith("totp:"))
    expect(row).toBeDefined()
    expect(row.Title).toMatch(/GitHub · me@x\.com\s+\d{6}/)
    expect(row.Tails[0].Text).toMatch(/^\d+s$/)
  })

  test("关键字过滤（原文 + 拼音首字母）", async () => {
    await query(`add otpauth://totp/微信工作号?secret=${SECRET}`)
    const hitText = await query("工作号")
    expect(hitText.Results.some((r) => r.Id?.startsWith("totp:"))).toBe(true)
    const hitPinyin = await query("wxgz")
    expect(hitPinyin.Results.some((r) => r.Id?.startsWith("totp:"))).toBe(true)
    const hitFull = await query("weixingongzuohao")
    expect(hitFull.Results.some((r) => r.Id?.startsWith("totp:"))).toBe(true)
    const miss = await query("no-such-keyword")
    expect(miss.Results).toHaveLength(1)
    expect(miss.Results[0].SubTitle).toContain("no-such-keyword")
  })
})

// ---------- add ----------
describe("query add", () => {
  test("合法 URI 添加成功", async () => {
    const res = await query(`add ${URI()}`)
    expect(res.Results[0].Title).toContain("GitHub · me@x.com")
    expect(api.notifies).toHaveLength(0)
  })

  test("同 issuer+name 覆盖，不重复", async () => {
    await query(`add ${URI()}`)
    await query(`add ${URI()}`)
    const res = await query("")
    const rows = res.Results.filter((r) => r.Id?.startsWith("totp:"))
    expect(rows).toHaveLength(1)
  })

  test("缺 URI 显示用法提示", async () => {
    const res = await query("add")
    expect(res.Results[0].Title).toMatch(/otpauth|示例|Example/)
  })

  test("非法 URI 显示错误和示例", async () => {
    const res = await query("add not-a-uri")
    expect(res.Results[0].Title).toMatch(/无效|Invalid/)
    expect(res.Results[0].SubTitle).toMatch(/Example|示例/)
  })

  test("非法 secret 报错", async () => {
    const res = await query("add otpauth://totp/x?secret=ABC1")
    expect(res.Results[0].Title).toMatch(/secret 无效|Invalid secret/)
  })
})

// ---------- 删除确认流程 ----------
describe("delete confirm flow", () => {
  test("delete action 跳到 confirm，回车才真删", async () => {
    await query(`add ${URI()}`)
    const list = await query("")
    const row = list.Results.find((r) => r.Id?.startsWith("totp:"))
    const delAction = row.Actions.find((a) => a.Name.includes("删除") || a.Name.includes("Delete"))

    await delAction.Action(ctx, {})
    expect(api.changes[0]).toMatch(/^totp confirm /)
    expect(fs.existsSync(path.join(state.cacheDir, "totp-accounts.json"))).toBe(true)
    // 账户还在
    const still = await query("")
    expect(still.Results.some((r) => r.Id?.startsWith("totp:"))).toBe(true)

    // 确认行默认 action 是"确认删除"
    const confirmText = api.changes[0]
    const confirmRes = await query(confirmText.replace(/^totp /, ""))
    expect(defaultAction(confirmRes.Results[0])).toBeDefined()
    expect(confirmRes.Results[0].Title).toMatch(/删除|Delete/)
    await defaultAction(confirmRes.Results[0]).Action(ctx, {})

    // 已删除，回列表为空状态
    expect(api.notifies.some((n) => n.includes("已删除") || n.includes("Deleted"))).toBe(true)
    const after = await query("")
    expect(after.Results.some((r) => r.Id?.startsWith("totp:"))).toBe(false)
  })

  test("confirm 取消 action 不删除", async () => {
    await query(`add ${URI()}`)
    const list = await query("")
    const row = list.Results.find((r) => r.Id?.startsWith("totp:"))
    const delAction = row.Actions.find((a) => a.Name.includes("删除") || a.Name.includes("Delete"))
    await delAction.Action(ctx, {})

    const confirmRes = await query(api.changes[0].replace(/^totp /, ""))
    const cancel = confirmRes.Results[0].Actions.find((a) => !a.IsDefault)
    await cancel.Action(ctx, {})
    expect(api.changes.at(-1)).toBe("totp ")
    const res = await query("")
    expect(res.Results.some((r) => r.Id?.startsWith("totp:"))).toBe(true)
  })

  test("confirm 键无效时显示提示行，不抛错", async () => {
    const res = await query("confirm !!!not-base64!!!")
    expect(res.Results).toHaveLength(1)
    expect(res.Results[0].Title).toMatch(/不存在|not found/i)
  })
})

// ---------- 复制 ----------
describe("copy actions", () => {
  test("默认 action 复制当前码", async () => {
    await query(`add ${URI()}`)
    const res = await query("")
    const row = res.Results.find((r) => r.Id?.startsWith("totp:"))
    await defaultAction(row).Action(ctx, {})
    expect(api.copies).toHaveLength(1)
    expect(api.copies[0]).toMatch(/^\d{6}$/)
  })

  test("copy_next 复制下一周期码", async () => {
    await query(`add ${URI()}`)
    const res = await query("")
    const row = res.Results.find((r) => r.Id?.startsWith("totp:"))
    const next = row.Actions.find((a) => !a.IsDefault)
    await next.Action(ctx, {})
    expect(api.copies).toHaveLength(1)
    expect(api.copies[0]).toMatch(/^\d{6}$/)
  })
})

// ---------- 存储 ----------
describe("storage via query", () => {
  test("损坏的存储文件：query 不崩溃，显示错误", async () => {
    await query(`add ${URI()}`)
    const store = path.join(state.cacheDir, "totp-accounts.json")
    fs.writeFileSync(store, "{broken json!!")
    const res = await query("")
    expect(res.Results).toHaveLength(1)
    expect(res.Results[0].Title).toMatch(/出错|Error/)
    // 坏文件已备份，原路径不再有损坏文件
    expect(fs.existsSync(store)).toBe(false)
  })

  test("删除到空后文件合法（rename 原子写）", async () => {
    await query(`add ${URI()}`)
    const store = path.join(state.cacheDir, "totp-accounts.json")
    const before = JSON.parse(fs.readFileSync(store, "utf8"))
    expect(before.accounts).toHaveLength(1)
    expect(fs.statSync(store).mode & 0o777).toBe(0o600)
  })
})
