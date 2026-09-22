// 账户存储：~/.wox/cache/plugins/<id>/totp-accounts.json
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
  try {
    return JSON.parse(fs.readFileSync(storePath(), "utf8")).accounts || []
  } catch {
    return []
  }
}

export function updateAccounts(mutator) {
  const accounts = readAccounts()
  const ret = mutator(accounts)
  fs.mkdirSync(cacheDir, { recursive: true })
  fs.writeFileSync(storePath(), JSON.stringify({ accounts }, null, 2))
  return ret
}
