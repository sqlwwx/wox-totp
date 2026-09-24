/**
 * 视图：结果行与表单 action 的具体构造（锁定态、解锁/改密表单、账号行 actions）。
 * 这里只管"长什么样"，数据读写走 store，翻译走 i18n。
 * @module views
 */

import { t } from "./i18n.mjs"
import { getApi } from "./context.mjs"
import { unlock, changePassword, updateAccounts, needsSetup } from "./store.mjs"
import { totp } from "./totp.mjs"
import { ICON_EXEC, ICON_DEL, ICON_COPY, result, single, act, display, detail, rowId, confirmKey } from "./ui.mjs"

/**
 * needsSetup 的防御包装：store 未初始化 cacheDir 时会抛错，视图层不该因此崩溃。
 * @returns {boolean}
 */
function needsSetupSafe() {
  try {
    return needsSetup()
  } catch {
    return false
  }
}

// ---------- 锁定/主密码 ----------
// 密码认证：主密码加密存储配置，派生密钥只存内存，3 天未验证自动清除

/**
 * 锁定态结果列表（两行）：
 * ①锁定行——默认回车 = unlock 表单；
 * ②重置行——忘记密码兜底，回车跳 reset 警告页（不直接清数据）。
 * @param {boolean} [errLine] - 是否处于"密码错误重试"状态
 * @returns {{Results: Array<Object>}}
 */
export function lockedResult(errLine) {
  const sub = errLine ? t("locked_retry") : needsSetupSafe() ? t("locked_setup_hint") : t("locked_hint")
  return {
    Results: [
      result(t("locked_title"), sub, [unlockAction()], undefined, undefined, 910),
      result(t("reset_entry"), t("reset_hint"), [
        act(t("reset_entry"), ICON_DEL, async (actCtx) => {
          await getApi().ChangeQuery(actCtx, { QueryType: "input", QueryText: "totp reset" })
        }, { isDefault: true, id: "totp:locked:reset" }),
      ], null, "totp:locked:reset-row", 600),
    ],
  }
}

/**
 * unlock 入口行：回车弹出表单。
 * Wox 插件表单无 password 类型（枚举只有 textbox 等，写 "password" 会报
 * unknown setting type），密码以 textbox 明文输入是现有约束下的取舍。
 * @returns {Object} Type=form 的 action
 */
function unlockAction() {
  return {
    Id: "totp:unlock",
    Type: "form",
    Name: t("unlock_usage"),
    Icon: ICON_EXEC,
    IsDefault: true,
    PreventHideAfterAction: true,
    Form: [
      {
        Type: "textbox",
        Value: {
          Key: "password",
          Label: t("password_label"),
          DefaultValue: "",
          MaxLines: 1,
        },
        DisabledInPlatforms: [],
        IsPlatformSpecific: false,
      },
    ],
    OnSubmit: async (formCtx, actionContext) => {
      const pwd = (actionContext.Values.password || "").trim()
      try {
        const { migrated } = unlock(pwd)
        await getApi().Notify(formCtx, migrated ? t("unlock_migrated") : needsSetupSafe() ? t("password_set") : t("unlocked"))
        await getApi().RefreshQuery(formCtx, { PreserveSelectedIndex: true })
      } catch (e) {
        await getApi().Notify(formCtx, `TOTP: ${e.message}`)
      }
    },
  }
}

/**
 * 修改主密码入口行（需已解锁态）：表单输入新密码，提交后全量重加密。
 * @returns {Object} Type=form 的 action
 */
export function passwordAction() {
  return {
    Id: "totp:password",
    Type: "form",
    Name: t("password_usage"),
    Icon: ICON_EXEC,
    IsDefault: true,
    PreventHideAfterAction: true,
    Form: [
      {
        Type: "textbox",
        Value: {
          Key: "new_password",
          Label: t("new_password_label"),
          DefaultValue: "",
          MaxLines: 1,
        },
        DisabledInPlatforms: [],
        IsPlatformSpecific: false,
      },
    ],
    OnSubmit: async (formCtx, actionContext) => {
      const pwd = (actionContext.Values.new_password || "").trim()
      try {
        changePassword(pwd)
        await getApi().Notify(formCtx, t("password_changed"))
        await getApi().RefreshQuery(formCtx, { PreserveSelectedIndex: true })
      } catch (e) {
        await getApi().Notify(formCtx, `TOTP: ${e.message}`)
      }
    },
  }
}

/**
 * 账号行的动作集合：复制当前码 / 复制下一周期码 / 设置别名（表单）/ 删除（二次确认）。
 * @param {{issuer?: string, name: string, alias?: string, secret: string, period?: number, digits?: number, algo?: string}} a - 账户
 * @param {string} code - 当前验证码
 * @returns {Array<Object>} action 数组
 */
export function buildActions(a, code) {
  const rid = rowId(a)
  const api = getApi()
  return [
    act(t("copy_code", code), ICON_COPY, async (actCtx) => {
      await api.Copy(actCtx, { type: "text", text: code })
      await api.Notify(actCtx, t("copied", display(a)))
    }, { isDefault: true, id: `${rid}:copy` }),
    act(t("copy_next"), ICON_EXEC, async (actCtx) => {
      const next = totp(a.secret, 1, a.period, a.digits, a.algo)
      await api.Copy(actCtx, { type: "text", text: next })
      await api.Notify(actCtx, t("copied_next", next))
    }, { id: `${rid}:copy_next` }),
    {
      // 别名用表单收集：文本框 + 提交保存；留空提交即清除别名
      // Type 必须显式为 "form"；Id 必须稳定，见 ui.mjs act() 的 JSDoc
      Id: `${rid}:alias`,
      Type: "form",
      Name: t("set_alias"),
      Icon: ICON_EXEC,
      PreventHideAfterAction: true,
      Form: [
        {
          Type: "textbox",
          Value: {
            Key: "alias",
            Label: t("alias_label"),
            DefaultValue: a.alias || "",
            MaxLines: 1,
          },
          DisabledInPlatforms: [],
          IsPlatformSpecific: false,
        },
      ],
      OnSubmit: async (formCtx, actionContext) => {
        const alias = (actionContext.Values.alias || "").trim()
        updateAccounts((accs) => {
          const j = accs.findIndex((x) => x.name === a.name && (x.issuer || "") === (a.issuer || ""))
          if (j >= 0) {
            if (alias) accs[j].alias = alias
            else delete accs[j].alias
          }
        })
        await getApi().Notify(formCtx, alias ? t("alias_saved", alias) : t("alias_cleared"))
        await getApi().RefreshQuery(formCtx, { PreserveSelectedIndex: true })
      },
    },
    act(t("delete_account"), ICON_DEL, async (actCtx) => {
      // 二次确认：跳到 confirm 子命令，回车确认行才真删
      await api.ChangeQuery(actCtx, {
        QueryType: "input",
        QueryText: `totp confirm ${confirmKey(a)}`,
      })
    }),
  ]
}
