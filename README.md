# Wox.Plugin.Totp

Wox 目录插件（非 single-file）：快速查询并复制 TOTP 验证码（Google Authenticator 兼容，RFC 6238）。

## 功能

- `totp` / `otp` 触发，列出所有账户及当前验证码，回车复制
- 列表显示 `issuer · 账户名`，支持 SHA1/SHA256/SHA512、自定义 digits/period
- 剩余时间显示，支持复制下一周期验证码
- 关键字过滤账户（匹配账户名和 issuer）
- 支持 `otpauth://totp/...` 链接添加，完整保留 URI 参数

## 命令

```
totp                        列出账户及验证码
totp <关键字>               过滤账户
totp add <账户> <base32secret>    添加条目
totp add <otpauth://totp/...>     通过 otpauth 链接添加（自动解析 issuer/账户名）
totp del <账户>             删除条目
```

## 安装

在 Wox 查询框执行（需 Wox ≥ 2.4.2，Node.js ≥ 20）：

```
wpm dev.add /Users/wuweixing/lab/sqlwwx/wox-totp
```

Wox 解析根目录 `plugin.json` 并加载 `dist/index.js`（Entry 字段指定）。

## 存储

明文 JSON：`~/.wox/cache/plugins/<plugin-id>/totp-accounts.json`

每条目存完整 otpauth URI + 解析字段：

```json
{ "name": "me@x.com", "issuer": "GitHub", "secret": "...", "digits": 6, "period": 30, "algo": "SHA1", "uri": "otpauth://totp/..." }
```

注意：明文存储，机器上能读你用户目录的进程都能拿到 secrets。删除插件时 Wox 会自动清理缓存目录。

## 开发

ESM 源码（src/*.mjs），Bun.build 打包成单文件 CJS 到 `dist/index.js`。运行时零 npm 依赖，TOTP 用 Node 内置 crypto 实现。

```
make build       # src → dist/index.js（每次全量构建）
make dev         # watch 模式，改完自动构建 → Wox watch dist/ 自动热重载（2s 防抖）
make test        # 构建 + 单测（RFC 6238 向量、URI 解析）+ 集成（mock Wox API）
make clean       # 删 dist
```

结构：

```
plugin.json     # Wox 元数据（Entry: index.js 指向 dist 产物）
src/
  totp.mjs      # base32 / RFC 6238 / otpauth URI 解析与构造
  store.mjs     # 账户存储
  index.mjs     # init/query 命令逻辑
build.mjs       # Bun.build 打包脚本
dist/           # 产物（Wox watch 这个目录实现热重载）
```

注意：package.json 不要加 `"type": "module"` —— 会让 Wox 加载 dist .js 时按 ESM 解析报错。

## 二期计划

- WebDAV 同步（多设备）
