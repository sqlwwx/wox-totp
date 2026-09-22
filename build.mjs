// bun 打包：src/index.mjs → dist/index.js（单文件 CJS，Entry 见根目录 plugin.json）
// 目录插件形式：make dev 注册后，Wox watch dist/，产物变化自动热重载（无需手动部署）
// --watch：用 fs.watch 监视 src/，变化后自动重建
import { copyFileSync, readFileSync, watch } from "fs"

const options = {
  entrypoints: ["src/index.mjs"],
  outdir: "dist",
  format: "cjs", // Wox nodejs 插件入口是 CommonJS
  target: "node",
  // 编译时间仅 --watch（开发时）注入，用于确认热重载生效；正式构建不注入 → build 行不显示
  define: process.argv.includes("--watch")
    ? { __BUILD_TIME__: JSON.stringify(new Date().toLocaleString("sv-SE")) }
    : { __BUILD_TIME__: JSON.stringify("") },
}

const build = async () => {
  await Bun.build(options)
  copyFileSync("plugin.json", "dist/plugin.json") // Wox 加载/热重载读 dist/plugin.json（官方模板同款结构）
  console.log(`[${new Date().toLocaleTimeString()}] build → dist/index.js`)
}

if (process.argv.includes("--watch")) {
  await build()
  let timer = null
  watch("src", { recursive: true }, (_event, filename) => {
    if (!filename || !/\.mjs$/.test(filename)) return
    clearTimeout(timer) // 编辑器保存常触发多次事件，300ms 去抖
    timer = setTimeout(build, 300)
  })
  console.log("watching src/ → dist/index.js (Ctrl+C 退出)")
} else {
  await build()
}
