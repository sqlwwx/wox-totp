// TOTP 核心：base32 解码 / RFC 6238 生成 / otpauth URI 解析
import crypto from "crypto"

/** base32（RFC 4648）解码，容忍小写/空格/padding */
export function base32Decode(s) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  let bits = 0, value = 0, out = []
  for (const c of s.toUpperCase().replace(/=+$/, "").replace(/\s/g, "")) {
    const idx = A.indexOf(c)
    if (idx < 0) throw new Error(`非法 base32 字符: ${c}`)
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** RFC 6238 TOTP，Google Authenticator 兼容 */
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

/** 解析 otpauth URI，提取全部参数。secret 必填；其余有默认值。 */
export function parseUri(uri) {
  // WHATWG URL 会把 otpauth://totp/LABEL 的 "totp" 当 host，LABEL 当 pathname
  const u = new URL(uri)
  if (u.protocol !== "otpauth:" || u.host !== "totp") {
    throw new Error("仅支持 otpauth://totp/ 链接")
  }
  const secret = u.searchParams.get("secret")
  if (!secret) throw new Error("缺少 secret 参数")
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
  if (!["SHA1", "SHA256", "SHA512"].includes(algo)) throw new Error(`不支持算法: ${algo}`)
  return { name, issuer, secret, digits, period, algo, uri }
}

/** 当前周期的剩余秒数 */
export function remainingSeconds(period = 30) {
  return period - (Math.floor(Date.now() / 1000) % period)
}
