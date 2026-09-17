/** Locale namespace owned by the Auto permission client. */
export const AUTO_MODE_LOCALE_NAMESPACE = 'dsh-auto-mode.permission'

/** Simplified Chinese copy for every plugin-owned permission surface. */
export const zh = {
  'preset.label': '自动审批',
  'preset.description': '保护优先：每次模型审查风险与授权，文件编辑仍需逐次人工确认，未隔离的代码执行被阻止。',
  'dialog.title': '确认启用自动审批？',
  'dialog.description': 'Auto 每次调用当前模型审查风险与授权，模型不能越过硬规则或替代人工审批。Shell、脚本、安装、构建、删除、未知工具和权限提升均被阻止；工作区内的结构化文件修改需要每次人工确认。链接、路径别名和敏感配置受到额外限制。该插件只约束启用 Auto 时经过 Harness 工具链的调用，不能替代独立操作系统隔离，也不能防御被篡改的宿主或插件。切换其他模式后这些限制不再适用。',
  'dialog.acknowledge': '我已了解风险，并愿意继续',
  'dialog.cancel': '取消',
  'dialog.confirm': '启用自动审批',
  'dialog.close': '关闭',
} satisfies Record<string, string>

/** Locale keys consumed by the compatibility layer. */
export type AutoModeLocaleKey = keyof typeof zh

/** English copy, checked against the Chinese source key set. */
export const en = {
  'preset.label': 'Auto',
  'preset.description': 'Preservation first: fresh model review on every admissible call, exact manual file edits, and no unisolated code execution.',
  'dialog.title': 'Enable Auto?',
  'dialog.description': 'Auto reviews each admissible call with the current model. Model output cannot override hard rules or exact manual approval. Shells, scripts, installs, builds, deletion, unknown tools and privilege widening are blocked. Each structured workspace file edit requires exact manual approval. Links, ambiguous paths and sensitive configuration are restricted. This policy covers only Harness tool calls while Auto is active; it cannot replace independent OS isolation or defend against a compromised host or plugin. Other permission modes are outside this protection.',
  'dialog.acknowledge': 'I understand the risks and want to continue',
  'dialog.cancel': 'Cancel',
  'dialog.confirm': 'Enable Auto',
  'dialog.close': 'Close',
} satisfies Record<AutoModeLocaleKey, string>

/** Stable translation function passed from the official locale service. */
export type AutoModeTranslate = (key: AutoModeLocaleKey) => string

/** English fallback for direct use outside an assembled DSH client. */
export const translateEnglish: AutoModeTranslate = key => en[key]
