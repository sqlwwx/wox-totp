/**
 * 账户加密存储：~/.wox/cache/plugins/<id>/totp-accounts.enc
 * - AES-256-GCM 认证加密，密钥由主密码经 scrypt 派生（salt 存文件头，不存密码）
 * - 主密码/派生密钥只存内存（模块级变量）：进程重启丢失；3 天未验证自动清除
 * - 兼容迁移：首次解锁发现旧明文 totp-accounts.json 时转密文并删除明文
 * - 写入走「临时文件 + rename」原子落盘，权限 0600
 * @module store
 */
import fs from "fs"
import crypto from "crypto"
import { err } from "./i18n.mjs"

const MAGIC = Buffer.from("WOTPE", "utf8") // 5 字节文件标识
const VERSION = 1
const SALT_LEN = 16
const IV_LEN = 12
const KEY_LEN = 32
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
export const AUTH_TTL_MS = 3 * 24 * 60 * 60 * 1000

let cacheDir = ""
let encKey = null // Buffer(32)，解锁后缓存，lock/过期/进程退出即消失
let encSalt = null
let lastAuthAt = 0

/**
 * 设置缓存目录并清空内存会话（init 时调用；热重载重设目录相当于重新锁定）。
 * @param {string} dir - Wox 插件缓存目录绝对路径
 * @returns {void}
 */
export function setCacheDir(dir) {
  cacheDir = dir
  encKey = null
  encSalt = null
  lastAuthAt = 0
}

function encPath() {
  if (!cacheDir) throw err("err_cache_dir")
  return cacheDir + "/totp-accounts.enc"
}
function legacyPath() {
  return cacheDir + "/totp-accounts.json"
}

/** 从未设置过主密码（无密文文件） */
export function needsSetup() {
  return !fs.existsSync(encPath())
}
/**
 * 是否处于已解锁会话（内存中有派生密钥）。
 * @returns {boolean}
 */
export function isUnlocked() {
  return !!encKey
}
/**
 * 是否处于锁定态：已设置过主密码且内存无密钥（未设置过不算锁定，算 needsSetup）。
 * @returns {boolean}
 */
export function isLocked() {
  return !needsSetup() && !isUnlocked()
}

function deriveKey(password, salt) {
  return crypto.scryptSync(String(password), salt, KEY_LEN, SCRYPT)
}

function encryptAccounts(key, salt, accounts) {
  const iv = crypto.randomBytes(IV_LEN)
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv)
  const data = Buffer.concat([cipher.update(JSON.stringify({ accounts }), "utf8"), cipher.final()])
  return Buffer.concat([MAGIC, Buffer.from([VERSION]), salt, iv, cipher.getAuthTag(), data])
}

// 解析文件头，格式非法时备份坏文件并抛错（同旧明文存储的损坏处理）
function parseEncFile(raw) {
  const headerLen = MAGIC.length + 1 + SALT_LEN + IV_LEN + 16
  if (raw.length <= headerLen || !raw.subarray(0, MAGIC.length).equals(MAGIC)) {
    throwCorrupt(raw, "invalid file header")
  }
  const version = raw[MAGIC.length]
  if (version !== VERSION) {
    throwCorrupt(raw, `unsupported version ${version}`)
  }
  let off = MAGIC.length + 1
  const salt = raw.subarray(off, off + SALT_LEN); off += SALT_LEN
  const iv = raw.subarray(off, off + IV_LEN); off += IV_LEN
  const tag = raw.subarray(off, off + 16); off += 16
  return { salt, iv, tag, data: raw.subarray(off) }
}

function throwCorrupt(raw, reason) {
  // 改名备份（原路径清空），绝不把损坏文件留在原路径——防后续写入拿空数据覆盖
  const backup = `${encPath()}.corrupt-${Date.now()}`
  try {
    fs.renameSync(encPath(), backup)
  } catch {}
  // reason 是给日志看的英文诊断短语（invalid header / unsupported version N），
  // 中文描述由 err_corrupt 模板整体承担
  throw err("err_corrupt", backupFileName(backup), reason)
}

// 备份路径放进文案前先去掉目录前缀，避免超长/泄漏缓存目录结构
function backupFileName(backup) {
  return backup.split("/").pop()
}

function writeEncFile(buf) {
  fs.mkdirSync(cacheDir, { recursive: true })
  const tmp = encPath() + ".tmp"
  fs.writeFileSync(tmp, buf, { mode: 0o600 })
  fs.renameSync(tmp, encPath())
}

/**
 * 解锁/初始化。首次调用即设置主密码；已有密文时验证密码（GCM tag 校验，错误即失败）。
 * 发现旧明文 totp-accounts.json 时迁移进密文并删除明文。
 * @param {string|number} password - 主密码（至少 6 位）
 * @returns {{migrated: boolean}} migrated = 本次是否从旧明文文件迁移
 * @throws {Error} 密码过短 / 主密码错误
 */
export function unlock(password) {
  const pwd = String(password || "")
  if (pwd.length < 6) throw err("err_pwd_short")
  if (needsSetup()) {
    const salt = crypto.randomBytes(SALT_LEN)
    encKey = deriveKey(pwd, salt)
    encSalt = salt
    let accounts = []
    let migrated = false
    if (fs.existsSync(legacyPath())) {
      try {
        accounts = JSON.parse(fs.readFileSync(legacyPath(), "utf8")).accounts || []
        migrated = true
      } catch {
        accounts = []
      }
    }
    writeEncFile(encryptAccounts(encKey, salt, accounts))
    if (migrated) fs.unlinkSync(legacyPath())
    lastAuthAt = Date.now()
    return { migrated }
  }
  const raw = fs.readFileSync(encPath())
  const parsed = parseEncFile(raw)
  const key = deriveKey(pwd, parsed.salt)
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, parsed.iv)
    decipher.setAuthTag(parsed.tag)
    decipher.update(parsed.data)
    decipher.final() // tag 不匹配在这里抛错 = 密码错误
  } catch {
    throw err("err_wrong_password")
  }
  encKey = key
  encSalt = parsed.salt
  lastAuthAt = Date.now()
  return { migrated: false }
}

/** 立即锁定：清空内存密钥/salt/上次认证时间。 */
export function lock() {
  encKey = null
  encSalt = null
  lastAuthAt = 0
}

/** 3 天未验证则自动清除内存密钥。返回当前是否处于锁定态 */
export function maybeExpire() {
  if (encKey && Date.now() - lastAuthAt > AUTH_TTL_MS) lock()
  return isLocked()
}

/** 解锁状态下读账户；锁定抛错（query 层会在更早处拦截） */
export function readAccounts() {
  if (!encKey) throw err("err_locked")
  let raw
  try {
    raw = fs.readFileSync(encPath())
  } catch (e) {
    if (e.code === "ENOENT") return []
    throw e
  }
  const parsed = parseEncFile(raw)
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", encKey, parsed.iv)
    decipher.setAuthTag(parsed.tag)
    const plain = Buffer.concat([decipher.update(parsed.data), decipher.final()]).toString("utf8")
    return JSON.parse(plain).accounts || []
  } catch (e) {
    throw err("err_decrypt_failed", e.message)
  }
}

/**
 * 解锁状态下读-改-写账户（整体重加密落盘）。
 * @param {(accounts: Array<Object>) => any} mutator - 原地修改账户数组的回调
 * @returns {any} mutator 的返回值
 * @throws {Error} 锁定态抛「已锁定，无法写入」
 */
export function updateAccounts(mutator) {
  if (!encKey) throw err("err_locked_write")
  const accounts = readAccounts()
  const ret = mutator(accounts)
  writeEncFile(encryptAccounts(encKey, encSalt, accounts))
  return ret
}

/**
 * 修改主密码：新 salt 重新派生并整体重加密（数据保留）。
 * @param {string|number} newPwd - 新主密码（至少 6 位）
 * @returns {void}
 * @throws {Error} 密码过短 / 锁定态
 */
export function changePassword(newPwd) {
  const pwd = String(newPwd || "")
  if (pwd.length < 6) throw err("err_pwd_short")
  if (!encKey) throw err("err_locked")
  const accounts = readAccounts()
  const salt = crypto.randomBytes(SALT_LEN)
  encKey = deriveKey(pwd, salt)
  encSalt = salt
  writeEncFile(encryptAccounts(encKey, salt, accounts))
  lastAuthAt = Date.now()
}

/** 硬重置：删除加密文件回到未设置状态（忘记密码的兜底，数据不可恢复） */
export function resetStorage() {
  try {
    fs.unlinkSync(encPath())
  } catch {}
  lock()
}

/** 仅供测试：伪造上次认证时间验证过期逻辑 */
export const _test = {
  setLastAuthAt(t) {
    lastAuthAt = t
  },
}
