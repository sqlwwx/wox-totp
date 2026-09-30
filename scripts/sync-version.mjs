// standard-version postbump 钩子调用：把 package.json 的版本号同步到 plugin.json
// 版本来源链：standard-version bump package.json → 本脚本同步 plugin.json → 一起进 release commit
import { readFileSync, writeFileSync } from "fs"

const pkg = JSON.parse(readFileSync("package.json", "utf8"))
const content = readFileSync("plugin.json", "utf8")
const current = content.match(/"Version":\s*"([^"]+)"/)[1]
if (current === pkg.version) {
  console.log(`plugin.json Version 已是 ${current}，跳过同步`)
  process.exit(0)
}
// 只替换 Version 行，保住缩进/键序，diff 一行
writeFileSync("plugin.json", content.replace(/"Version":\s*"[^"]+"/, `"Version": "${pkg.version}"`))
console.log(`plugin.json Version: ${current} → ${pkg.version}`)
