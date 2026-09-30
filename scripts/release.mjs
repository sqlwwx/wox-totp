// 发版：bun scripts/release.mjs patch|minor|major（Makefile 同名目标）
// standard-version 负责：bump package.json + 生成 CHANGELOG.md + release commit + tag
// postbump 钩子（.versionrc.json）把 package.json 版本同步进 plugin.json 并 git add，
// 版本号和 changelog 一起进 release commit；tag 推送触发 .github/workflows/release.yml
import { execSync } from "child_process"

const run = (cmd, opts = {}) => execSync(cmd, { stdio: "inherit", ...opts })
// 工作区检查：显式 pipe 捕获输出（inherit 时 execSync 返回 null）
const out = (cmd) => execSync(cmd, { encoding: "utf8" })

const kind = process.argv[2]
if (!["patch", "minor", "major"].includes(kind)) {
  console.error("usage: bun scripts/release.mjs <patch|minor|major>")
  process.exit(1)
}

// 工作区必须干净：release commit（含 CHANGELOG + 双版本号）要干净落在 pull 后的 master 上
if (out("git status --porcelain").trim()) {
  console.error("工作区有未提交变更，先提交再发版")
  process.exit(1)
}
run("git checkout master && git pull")

// 发版前跑测试：tag 推上去 CI 才构建，失败的 tag 撤销麻烦
run("make test")

run(`bunx standard-version --release-as ${kind} --commit-all`)
run("git push --follow-tags origin master")
