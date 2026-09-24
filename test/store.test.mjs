// store 加密存储单测：AES-256-GCM + scrypt、主密码生命周期、明文迁移、损坏处理
import { describe, test, expect, beforeEach } from "bun:test"
import {
  setCacheDir, readAccounts, updateAccounts, unlock, lock,
  needsSetup, isUnlocked, isLocked, maybeExpire, changePassword, AUTH_TTL_MS, _test,
} from "../src/store.mjs"
import fs from "fs"
import os from "os"
import path from "path"

let tmp

beforeEach(() => {
  tmp = fs.mkdtempSync(os.tmpdir() + "/totp-store-")
  setCacheDir(tmp)
})
function encFile() { return path.join(tmp, "totp-accounts.enc") }
function legacyFile() { return path.join(tmp, "totp-accounts.json") }

describe("首次设置（needsSetup）", () => {
  test("无密文文件 = 需要设置", () => {
    expect(needsSetup()).toBe(true)
    expect(isLocked()).toBe(false) // 未设置过不算锁定
  })

  test("unlock 设置主密码并写入密文文件", () => {
    unlock("secret123")
    expect(isUnlocked()).toBe(true)
    expect(fs.existsSync(encFile())).toBe(true)
    const raw = fs.readFileSync(encFile())
    expect(raw.subarray(0, 5).toString()).toBe("WOTPE")
    // 密文中不出现明文账户数据
    expect(raw.includes("GitHub")).toBe(false)
  })

  test("密码过短拒绝", () => {
    expect(() => unlock("12345")).toThrow("至少 6 位")
  })
})

describe("明文迁移", () => {
  test("首次 unlock 迁移旧明文文件并删除", () => {
    fs.writeFileSync(legacyFile(), JSON.stringify({ accounts: [{ name: "a", issuer: "B", secret: "XXX" }] }))
    const r = unlock("secret123")
    expect(r.migrated).toBe(true)
    expect(fs.existsSync(legacyFile())).toBe(false)
    expect(readAccounts()).toHaveLength(1)
    expect(readAccounts()[0].secret).toBe("XXX")
  })
})

describe("锁定与解锁", () => {
  beforeEach(() => unlock("secret123"))

  test("lock 后读取抛错，重新 unlock 恢复", () => {
    lock()
    expect(isLocked()).toBe(true)
    expect(() => readAccounts()).toThrow("锁定")
    unlock("secret123")
    expect(readAccounts()).toHaveLength(0)
  })

  test("错误密码解锁失败且保持锁定", () => {
    lock()
    expect(() => unlock("wrong-password")).toThrow("主密码错误")
    expect(isLocked()).toBe(true)
    // 正确密码可再解锁
    unlock("secret123")
    expect(isUnlocked()).toBe(true)
  })

  test("3 天未验证自动过期", () => {
    expect(maybeExpire()).toBe(false)
    _test.setLastAuthAt(Date.now() - AUTH_TTL_MS - 1000)
    expect(maybeExpire()).toBe(true)
    expect(isLocked()).toBe(true)
    expect(() => readAccounts()).toThrow()
  })

  test("写入需要解锁态，写后可读回", () => {
    updateAccounts((a) => a.push({ name: "x", issuer: "", secret: "S" }))
    lock()
    unlock("secret123")
    expect(readAccounts()[0].name).toBe("x")
  })
})

describe("changePassword", () => {
  beforeEach(() => unlock("secret123"))

  test("改密后新密码可解锁、旧密码失效", () => {
    updateAccounts((a) => a.push({ name: "y", issuer: "", secret: "S" }))
    changePassword("newpass456")
    lock()
    expect(() => unlock("secret123")).toThrow("主密码错误")
    unlock("newpass456")
    expect(readAccounts()[0].name).toBe("y")
  })

  test("锁定态改密拒绝", () => {
    lock()
    expect(() => changePassword("newpass456")).toThrow("锁定")
  })
})

describe("密文损坏", () => {
  test("密文被篡改：GCM tag 校验使 unlock 失败（整个文件认证加密）", () => {
    unlock("secret123")
    updateAccounts((a) => a.push({ name: "z", issuer: "", secret: "S" }))
    lock()
    // 篡改密文尾部
    const raw = fs.readFileSync(encFile())
    raw[raw.length - 1] ^= 0xff
    fs.writeFileSync(encFile(), raw, { mode: 0o600 })
    expect(() => unlock("secret123")).toThrow("主密码错误")
    expect(isLocked()).toBe(true)
  })

  test("文件头非法：unlock 报错并备份", () => {
    unlock("secret123")
    lock()
    fs.writeFileSync(encFile(), "garbage data", { mode: 0o600 })
    expect(() => unlock("secret123")).toThrow("损坏")
    expect(fs.readdirSync(tmp).some((f) => f.includes(".corrupt-"))).toBe(true)
  })
})
