// 账户存储：~/.wox/cache/plugins/<id>/totp-accounts.json
// 写入走「临时文件 + rename」保证原子性（写一半崩溃不会损坏原文件）；
// 读取发现 JSON 损坏时把坏文件改名备份并抛错，避免下一次 add/delete
// 用空数据静默覆盖（secret 不可再生，丢不起）。文件权限收紧为 0600。
import fs from "fs"

let cacheDir = ""

export function setCacheDir(dir) {
  cacheDir = dir
}

function storePath() {
  if (!cacheDir) throw new Error("cache folder 不可用")
  return cacheDir + "/totp-accounts.json"
}

export function readAccounts() {
  const path = storePath()
  let raw
  try {
    raw = fs.readFileSync(path, "utf8")
  } catch (e) {
    if (e.code === "ENOENT") return [] // 首次使用，正常空状态
    throw e
  }
  try {
    return JSON.parse(raw).accounts || []
  } catch (e) {
    // 损坏：备份原文件后抛错，绝不静默返回 []
    const backup = `${path}.corrupt-${Date.now()}`
    try {
      fs.renameSync(path, backup)
    } catch {}
    throw new Error(`存储文件损坏，已备份到 ${backup}: ${e.message}`)
  }
}

export function updateAccounts(mutator) {
  const accounts = readAccounts()
  const ret = mutator(accounts)
  fs.mkdirSync(cacheDir, { recursive: true })
  const tmp = `${storePath()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ accounts }, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, storePath()) // 同目录 rename，原子生效
  return ret
}
