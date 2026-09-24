/**
 * i18n：界面语言经 plugin.json 的 I18n 字典 + GetTranslation 提供。
 * 语言探测键 language_probe 返回 "en"/"zh"，用于初始化兜底字典
 * （GetTranslation 不可用时 fallback 到 zh）。
 * @module i18n
 */

/** @type {(key: string, ...args: any[]) => string} 当前生效的翻译实现，initI18n 后被替换 */
let tImpl = (_key, ..._args) => ""

/**
 * 翻译函数：静态文案查本地字典，带参文案用字典里的函数；未初始化或缺 key 时返回 key 本身。
 * @param {string} key - 翻译键
 * @param {...any} args - 带参文案的插值参数
 * @returns {string}
 */
export const t = (key, ...args) => tImpl(key, ...args)

/**
 * 初始化翻译：探测语言并绑定对应字典到 tImpl。
 * @param {Object} api - Wox API
 * @param {Object} ctx - Wox 上下文（GetTranslation 用）
 * @returns {Promise<void>}
 */
export async function initI18n(api, ctx) {
  let probe = "zh"
  try {
    probe = (await api.GetTranslation(ctx, "language_probe")).trim() || "zh"
  } catch {}
  const dict = dicts[probe] || dicts.zh
  tImpl = (key, ...args) => {
    const local = dict[key]
    if (typeof local === "function") return local(...args)
    if (local !== undefined) return local
    return key
  }
}

const dicts = {
  en: {
    hint_no_op: "Enter does nothing, keep typing parameters",
    subcmd_add: "Add a TOTP account from otpauth URI",
    subcmd_password: "Change master password (requires unlocked)",
    subcmd_lock: "Lock immediately (clears key from memory)",
    subcmd_lock_detail: "Run totp lock: requires master password on next use",
    subcmd_password_detail: "Run totp password: set a new master password (data kept)",
    subcmd_reset_detail: "Run totp reset: wipe ALL data, accounts must be re-added",
    subcmd_unlock: "Unlock / set master password (popup form)",
    subcmd_reset: "Danger: wipe all data (forgot password fallback)",
    err_invalid_uri: (m) => `Invalid otpauth URI: ${m}`,
    err_uri_example: "Example: otpauth://totp/GitHub:me?secret=XXXX",
    err_invalid_secret: (m) => `Invalid secret: ${m}`,
    err_secret_hint: "Expected base32 (A-Z2-7, as provided by Google Authenticator)",
    added: (d) => `Added ${d}`,
    view_codes: "Type totp to view codes",
    empty_title: "No accounts yet",
    empty_subtitle: "Press enter to fill in totp add, then paste an otpauth URI",
    action_add: "Add account",
    no_match: "No matching accounts",
    no_match_detail: (n, kw) => `${n} accounts total, keyword "${kw}"`,
    remain_copy: (s) => `enter to copy · ${s}s left`,
    copy_code: (c) => `Copy ${c}`,
    copy_next: "Copy next period code",
    delete_account: "Delete this account",
    copied: (d) => `Copied code for ${d}`,
    copied_next: (c) => `Copied ${c}`,
    deleted: (d) => `Deleted ${d}`,
    err_prefix: (m) => `Error: ${m}`,
    check_log: "See log ~/.wox/log/wox.log",
    build_row_detail: (n) => `${n} accounts total`,
    confirm_delete: (d) => `Delete ${d}?`,
    confirm_hint: "Press enter to confirm delete, or Esc/cancel",
    confirm_yes: "Yes, delete this account",
    confirm_cancel: "Cancel",
    confirm_gone: "Account not found (maybe already deleted)",
    set_alias: "Set alias",
    alias_label: "Alias (empty to clear)",
    alias_saved: (a2) => `Alias saved: ${a2}`,
    alias_cleared: "Alias cleared",
    locked_title: "🔒 Locked",
    locked_hint: "Enter totp unlock to view codes",
    locked_retry: "Check the password, or re-enter totp unlock",
    locked_setup_hint: "Set a master password: run totp unlock (min 6 chars). It encrypts stored accounts; re-entry required every 3 days",
    unlock_usage: "totp unlock",
    password_label: "Master password",
    new_password_label: "New master password (min 6 chars)",
    unlocked: "Unlocked",
    unlock_migrated: "Master password set, existing accounts encrypted (plaintext file removed)",
    password_set: "Master password set",
    password_usage: "totp password <new password>",
    password_usage_hint: "Change master password (requires unlocked state)",
    password_changed: "Master password changed",
    reset_entry: "Forgot password? Reset (wipes all data)",
    reset_warning: "⚠️ Reset: ALL accounts will be permanently deleted",
    reset_hint: "Use only if you forgot the master password. Enter the confirm action to proceed",
    reset_confirm_yes: "Confirm reset (data lost)",
    reset_done: "Reset done",
    reset_done_hint: "Storage cleared. Run totp unlock to set a new master password (accounts need re-add)",
  },
  zh: {
    hint_no_op: "回车无操作，继续输入参数",
    subcmd_add: "添加 TOTP 账户（otpauth 链接）",
    subcmd_password: "修改主密码（需已解锁）",
    subcmd_lock: "立即锁定（清除内存密钥）",
    subcmd_lock_detail: "执行 totp lock：下次使用需重新输入主密码",
    subcmd_password_detail: "执行 totp password：设置新主密码（数据保留）",
    subcmd_reset_detail: "执行 totp reset：清空全部数据，账户需重新添加",
    subcmd_unlock: "解锁 / 设置主密码（弹窗输入）",
    subcmd_reset: "危险：清空全部数据（忘记密码的兜底）",
    err_invalid_uri: (m) => `otpauth 链接无效: ${m}`,
    err_uri_example: "示例: otpauth://totp/GitHub:me?secret=XXXX",
    err_invalid_secret: (m) => `secret 无效: ${m}`,
    err_secret_hint: "应为 base32（A-Z2-7，Google Authenticator 提供的格式）",
    added: (d) => `已添加 ${d}`,
    view_codes: "输入 totp 查看验证码",
    empty_title: "还没有账户",
    empty_subtitle: "回车填入 totp add，再粘贴 otpauth 链接",
    action_add: "添加账户",
    no_match: "没有匹配的账户",
    no_match_detail: (n, kw) => `共 ${n} 个账户，关键字「${kw}」`,
    remain_copy: (s) => `回车复制 · 剩余 ${s}s`,
    copy_code: (c) => `复制 ${c}`,
    copy_next: "复制下一周期验证码",
    delete_account: "删除此账户",
    copied: (d) => `已复制 ${d} 的验证码`,
    copied_next: (c) => `已复制 ${c}`,
    deleted: (d) => `已删除 ${d}`,
    err_prefix: (m) => `出错: ${m}`,
    check_log: "查看日志 ~/.wox/log/wox.log",
    build_row_detail: (n) => `共 ${n} 个账户`,
    confirm_delete: (d) => `删除 ${d}？`,
    confirm_hint: "回车确认删除，Esc 或取消返回",
    confirm_yes: "确认删除此账户",
    confirm_cancel: "取消",
    confirm_gone: "账户不存在（可能已删除）",
    set_alias: "设置别名",
    alias_label: "别名（留空清除）",
    alias_saved: (a2) => `别名已保存: ${a2}`,
    alias_cleared: "别名已清除",
    locked_title: "🔒 已锁定",
    locked_hint: "输入 totp unlock 查看验证码",
    locked_retry: "密码不对，重新输入 totp unlock",
    locked_setup_hint: "设置主密码: 输入 totp unlock（至少6位），用于加密存储，每 3 天需重新输入",
    unlock_usage: "totp unlock",
    password_label: "主密码",
    new_password_label: "新主密码（至少6位）",
    unlocked: "已解锁",
    unlock_migrated: "主密码已设置，现有账户已加密（明文文件已删除）",
    password_set: "主密码已设置",
    password_usage: "totp password <新密码>",
    password_usage_hint: "修改主密码（需已解锁）",
    password_changed: "主密码已修改",
    reset_entry: "忘记密码？重置（将清空全部数据）",
    reset_warning: "⚠️ 重置将永久删除全部账户",
    reset_hint: "仅在忘记主密码时使用。回车确认重置",
    reset_confirm_yes: "确认重置（数据将丢失）",
    reset_done: "已重置",
    reset_done_hint: "存储已清空。输入 totp unlock 重新设置主密码（账户需重新添加）",
  },
}
