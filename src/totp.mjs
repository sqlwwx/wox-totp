/**
 * TOTP 核心算法：base32 解码 / RFC 6238 生成 / otpauth URI 解析 / 账户匹配。
 * 纯函数、无状态，不依赖 Wox 宿主。
 * @module totp
 */

import crypto from "crypto"
import { err } from "./i18n.mjs"

/**
 * base32（RFC 4648）解码，容忍小写/空格/padding。
 * @param {string} s - base32 字符串
 * @returns {Buffer} 解码后的字节
 * @throws {Error} 含非法字符
 */
export function base32Decode(s) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  let bits = 0, value = 0, out = []
  for (const c of s.toUpperCase().replace(/=+$/, "").replace(/\s/g, "")) {
    const idx = A.indexOf(c)
    if (idx < 0) throw err("err_invalid_base32_char", c)
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/**
 * RFC 6238 TOTP，Google Authenticator 兼容。
 * @param {string} secretB32 - base32 secret
 * @param {number} [offset=0] - 周期偏移（0=当前码，1=下一周期码）
 * @param {number} [step=30] - 周期秒数
 * @param {number} [digits=6] - 验证码位数
 * @param {string} [algo="SHA1"] - HMAC 算法（SHA1/SHA256/SHA512）
 * @returns {string} 验证码（前导零保留）
 * @throws {Error} secret 非法 / 算法不支持
 */
export function totp(secretB32, offset = 0, step = 30, digits = 6, algo = "SHA1") {
  const key = base32Decode(secretB32)
  const counter = Math.floor(Date.now() / 1000 / step) + offset
  const buf = Buffer.alloc(8)
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0)
  buf.writeUInt32BE(counter >>> 0, 4)
  const hmac = crypto.createHmac(algo.toLowerCase().replace("-", ""), key).update(buf).digest()
  const o = hmac[hmac.length - 1] & 0x0f
  const code = ((hmac[o] & 0x7f) << 24) | (hmac[o + 1] << 16) | (hmac[o + 2] << 8) | hmac[o + 3]
  return String(code % 10 ** digits).padStart(digits, "0")
}

/**
 * 解析 otpauth URI，提取全部参数。secret 必填；其余有默认值。
 * @param {string} uri - otpauth://totp/... 链接
 * @returns {{name: string, issuer: string, secret: string, digits: number, period: number, algo: string, uri: string}}
 * @throws {Error} 非 totp 链接 / 缺 secret / 算法不支持
 */
export function parseUri(uri) {
  // WHATWG URL 会把 otpauth://totp/LABEL 的 "totp" 当 host，LABEL 当 pathname
  const u = new URL(uri)
  if (u.protocol !== "otpauth:" || u.host !== "totp") {
    throw err("err_not_totp_uri")
  }
  const secret = u.searchParams.get("secret")
  if (!secret) throw err("err_missing_secret")
  const label = decodeURIComponent(u.pathname.replace(/^\//, ""))
  let issuer = "", name = label
  if (label.includes(":")) {
    const [iss, acct] = label.split(":", 2)
    issuer = iss.trim()
    name = acct.trim()
  }
  if (!issuer) issuer = u.searchParams.get("issuer") || ""
  if (!name) name = issuer || "account"
  const digits = parseInt(u.searchParams.get("digits") || "") || 6
  const period = parseInt(u.searchParams.get("period") || "") || 30
  const algo = (u.searchParams.get("algorithm") || "SHA1").toUpperCase()
  if (!["SHA1", "SHA256", "SHA512"].includes(algo)) throw err("err_unsupported_algo", algo)
  return { name, issuer, secret, digits, period, algo, uri }
}

/**
 * 当前周期的剩余秒数。
 * @param {number} [period=30] - 周期秒数
 * @returns {number} 1..period
 */
export function remainingSeconds(period = 30) {
  return period - (Math.floor(Date.now() / 1000) % period)
}

/**
 * 账户匹配：关键字命中 name/issuer/alias 原文（不区分大小写）。
 * 别名和原名都参与匹配。
 * @param {{name: string, issuer?: string, alias?: string}} a - 账户
 * @param {string} kw - 关键字（调用方已 toLowerCase）
 * @returns {boolean}
 */
export function matchAccount(a, kw) {
  const k = kw.toLowerCase()
  return [a.name, a.issuer || "", a.alias || ""].some((f) => f.toLowerCase().includes(k))
}
