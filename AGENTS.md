# PROJECT KNOWLEDGE BASE

**Generated:** 2026-09-30
**Commit:** d7f4e3b
**Branch:** master

## OVERVIEW

Wox 启动器 TOTP 验证码插件（RFC 6238，Google Authenticator 兼容）。纯 JavaScript ESM（.mjs）+ Bun 工具链，零运行时依赖（仅 Node 内置 crypto）。Wox 目录插件（非 single-file），本地 AES-256-GCM 加密存储。

## STRUCTURE

```
wox-totp/
├── plugin.json   # Wox 清单"源"：元数据 + 全部 en_US/zh_CN i18n 文案（运行时读的是 dist/ 下拷贝）
├── build.mjs     # Bun.build 打包 + 拷贝 plugin.json → dist/；自研 watch（非 bun --watch）
├── Makefile      # 唯一任务入口（package.json 无 scripts 字段，刻意）
├── src/          # ESM 源码，9 模块（见 CODE MAP）
├── test/         # bun test，与 src 模块一一对应（<module>.test.mjs）
└── dist/         # 构建产物（gitignored）：index.js（单文件 CJS）+ plugin.json —— Wox 只认这里
```

## WHERE TO LOOK

| 任务 | 位置 | Notes |
|------|------|-------|
| TOTP 算法 / otpauth URI 解析 | src/totp.mjs | 纯函数无状态 |
| 加密存储 / 解锁会话 / 改密 | src/store.mjs | 模块级单例，密钥只存内存 |
| 子命令分发 / 查询路由 | src/commands.mjs | `dispatchQuery` 入口 |
| 结果行 / 表单 action | src/views.mjs + src/ui.mjs | ui.mjs 是基础构造 |
| 验证码秒级刷新 | src/live.mjs | 事件驱动 timer（进面板才跑） |
| 新增用户可见文案 | plugin.json I18n | en_US/zh_CN 必须同步 |
| 错误处理 | src/i18n.mjs `err()` / `tErr()` | 抛错误码，展示层翻译 |
| api/ctx 获取 | src/context.mjs | 模块级存取 |

## CODE MAP

| 模块 | 职责 | 行数 |
|------|------|------|
| index.mjs | init/query 生命周期装配，导出 `plugin = { init, query }` | 72 |
| totp.mjs | base32 / RFC 6238 / otpauth URI / 账户匹配 | 103 |
| store.mjs | AES-256-GCM 加密存储 + 解锁会话（scrypt N=16384，3 天 TTL） | 241 |
| commands.mjs | 子命令分发（add/lock/password/reset/unlock/confirm） | 228 |
| views.mjs | 结果行与表单 action（锁定态/账号动作） | 188 |
| ui.mjs | Wox Result/Action 基础构造 | 152 |
| live.mjs | 每秒实时刷新可见行（倒计时） | 110 |
| i18n.mjs | 翻译运行时，读 plugin.json 内嵌字典 | 72 |
| context.mjs | 模块级 api/ctx 存取（host 裸调不绑定 this） | 42 |

## CONVENTIONS（仅记录与标准的偏差）

- ESM 源码（src/*.mjs）→ 单文件 CJS 产物；package.json 刻意**不加** `"type": "module"`
- Bun 工具链（Bun.build JS API + bun test + bun.lock）；命令全走 Makefile，非 npm scripts
- 无任何 lint/format 工具；风格：2 空格、双引号、分号、中文注释、JSDoc 标注类型
- 运行时零依赖：不 import @wox-launcher/wox-plugin，直接用宿主注入的 `params.API`
- 错误模式：`err("err_xxx", ...args)` 抛带 key 的 Error（message 恒为 key，日志可读），展示层 `tErr()` 查字典翻译；缺 key 返回 key 本身
- i18n：文案唯一来源是 plugin.json 的 I18n 字典；语言探测 1 次 RPC 后本地查表（非逐 key RPC）

## ANTI-PATTERNS（本项目禁止）

- ❌ package.json 加 `"type": "module"` —— Wox 按 ESM 解析 dist .js 直接报错
- ❌ action 不带稳定显式 Id —— query 重跑后表单提交报 "plugin form action not found"（见 ui.mjs act() JSDoc）
- ❌ form/action 的 Type 不显式声明（须 `"form"`，见 views.mjs）
- ❌ build watch 中让构建错误退出进程 —— watch 就死了（build.mjs）
- ❌ 损坏密文留在原路径 —— 必须改名备份 `.corrupt-<时间戳>`（store.mjs）
- ❌ 直接改 dist/ —— 下次构建覆盖
- ❌ 只改 en_US 或只改 zh_CN 的文案
- ❌ 解锁密钥写磁盘 / 持久化 —— 安全红线，只存内存

## COMMANDS

```bash
make build                    # bun build.mjs：src → dist/index.js + dist/plugin.json
make dev                      # watch 模式 → Wox watch dist/ 热重载（2s 防抖）
make test                     # 先构建再 bun test test/
make clean                    # rm -rf dist
bun test test/totp.test.mjs   # 单文件调试
```

## NOTES

- **Wox 加载链**：`wpm dev.add <root>` 时根 plugin.json 仅做元数据校验；启动/热重载实际读 `dist/plugin.json`，Entry "index.js" 相对 dist/ 解析 → dist/index.js。无 dist/plugin.json 则 reload 失败
- 插件导出形态是 `export const plugin = { init, query }` 对象（非顶层 init/query）
- 存储：`api.GetCacheFolder` 下 `totp-accounts.enc`（MAGIC "WOTPE" + salt/iv/tag，原子写 0600）；解锁密钥只存内存，3 天 TTL 且不随使用刷新，热重载/重启即锁定
- 测试模式：错误码断言 `toThrow("err_xxx")`；临时目录隔离（mkdtemp + setCacheDir）；mock Wox API（makeApi 记录调用，PluginDirectory 指仓库根供读 plugin.json）；RFC 时间向量用 `offsetFor(t)` 技巧；`store._test.setLastAuthAt` 后门伪造过期
- CI 门禁：`bun install --frozen-lockfile` → `make test` → `make build`；.npmrc 锁官方 registry（防私有源 401）
- 无发布流水线：无 release workflow、无 git tag；分发 = 本地 `wpm dev.add`；版本手动维护在 plugin.json `Version`
- 热重载 = 插件进程重启：内存密钥清空；index.mjs OnUnload 停 liveTimer 防 timer 泄漏
- 二期计划（README）：WebDAV 多设备同步
