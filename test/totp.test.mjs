// TOTP 核心 + store 单测：RFC 6238 官方向量 + otpauth URI 解析
import { describe, test, expect } from "bun:test"
import { base32Decode, totp, parseUri, remainingSeconds, matchAccount } from "../src/totp.mjs"
import { readAccounts, updateAccounts, setCacheDir, unlock } from "../src/store.mjs"
import fs from "fs"
import os from "os"

describe("base32Decode", () => {
  test("RFC 4648 向量（ASCII 1234567890...）", () => {
    expect(base32Decode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ").toString("hex")).toBe("3132333435363738393031323334353637383930")
  })
  test("容忍小写/空格/padding", () => {
    expect(base32Decode("gezd gnbv gy3t qojq==").toString("hex")).toBe("31323334353637383930")
  })
  test("非法字符抛错", () => {
    expect(() => base32Decode("ABC1")).toThrow("err_invalid_base32_char")
  })
})

describe("totp (RFC 6238 SHA1 向量, secret=ASCII 12345678901234567890)", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
  // 源码 totp 无 time 参数，用 offset 对齐 RFC 向量的 counter：offset = 目标counter - 当前counter
  const offsetFor = (t) => Math.floor(t / 30) - Math.floor(Date.now() / 1000 / 30)
  test("T=59 → 94287082（8位）", () => {
    expect(totp(secret, offsetFor(59), 30, 8, "SHA1")).toBe("94287082")
  })
  test("T=1111111109 → 07081804（8位）", () => {
    expect(totp(secret, offsetFor(1111111109), 30, 8, "SHA1")).toBe("07081804")
  })
})

describe("parseUri", () => {
  test("标准 Google Authenticator 链接", () => {
    const e = parseUri("otpauth://totp/GitHub:me@x.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub")
    expect(e.issuer).toBe("GitHub")
    expect(e.name).toBe("me@x.com")
    expect(e.digits).toBe(6)
    expect(e.period).toBe(30)
    expect(e.algo).toBe("SHA1")
  })
  test("label 优先 issuer，缺省回退参数", () => {
    const e = parseUri("otpauth://totp/me@x.com?secret=JBSWY3DPEHPK3PXP&issuer=Corp")
    expect(e.issuer).toBe("Corp")
    expect(e.name).toBe("me@x.com")
  })
  test("缺 secret 抛错", () => {
    expect(() => parseUri("otpauth://totp/x")).toThrow("err_missing_secret")
  })
  test("非 otpauth 协议抛错", () => {
    expect(() => parseUri("https://x.com")).toThrow("err_not_totp_uri")
  })
  test("非法算法抛错", () => {
    expect(() => parseUri("otpauth://totp/a?secret=JBSWY3DPEHPK3PXP&algorithm=MD5")).toThrow("err_unsupported_algo")
  })
})

describe("remainingSeconds", () => {
  test("在 1..period 之间", () => {
    const r = remainingSeconds(30)
    expect(r).toBeGreaterThanOrEqual(1)
    expect(r).toBeLessThanOrEqual(30)
  })
})

describe("matchAccount（原文匹配）", () => {
  const github = { name: "me@x.com", issuer: "GitHub" }
  const corp = { name: " ops", issuer: "阿里云" }

  test("原文命中（不区分大小写）", () => {
    expect(matchAccount(github, "git")).toBe(true)
    expect(matchAccount(github, "GITHUB")).toBe(true)
    expect(matchAccount(github, "gitlab")).toBe(false)
  })

  test("别名原文参与匹配", () => {
    const aliased = { name: "me@x.com", issuer: "GitHub", alias: "工作主号" }
    expect(matchAccount(aliased, "工作主号")).toBe(true) // 别名原文
    expect(matchAccount(aliased, "git")).toBe(true) // 原名仍可搜
  })

  test("无别名字段不影响原匹配", () => {
    expect(matchAccount(github, "git")).toBe(true)
    expect(matchAccount({ name: "a", issuer: "", alias: "" }, "git")).toBe(false)
  })

  test("不命中返回 false", () => {
    expect(matchAccount(corp, "qq")).toBe(false)
    expect(matchAccount(github, "微信")).toBe(false)
  })
})

describe("store", () => {
  const tmp = fs.mkdtempSync(os.tmpdir() + "/totp-test-")
  setCacheDir(tmp)
  unlock("store-test-pass")

  test("空文件读出空数组", () => {
    expect(readAccounts()).toEqual([])
  })

  test("updateAccounts 写入后可读回", () => {
    updateAccounts((accounts) => accounts.push({ name: "a", issuer: "B", secret: "JBSWY3DPEHPK3PXP" }))
    expect(readAccounts().length).toBe(1)
    expect(readAccounts()[0].name).toBe("a")
  })

  test("重复 add 同 issuer+name 覆盖", () => {
    updateAccounts((accounts) => {
      const i = accounts.findIndex((a) => a.name === "a" && (a.issuer || "") === "B")
      if (i >= 0) accounts[i] = { name: "a", issuer: "B", secret: "NEW" }
      else accounts.push({ name: "a", issuer: "B", secret: "NEW" })
    })
    expect(readAccounts().length).toBe(1)
    expect(readAccounts()[0].secret).toBe("NEW")
  })

  fs.rmSync(tmp, { recursive: true, force: true })
})
