# Auto Mode 适配 DeepSeek Harness 0.1.5-rc.1

日期：2026-09-14。目标宿主：`0.1.5-rc.1`（npm `latest`）。产出：插件 `0.1.9`。

## 背景

npm `latest` 的 Harness 已经是 `0.1.5-rc.1`，但 Auto Mode `0.1.7` 的 `compatibility.json`、peer 范围和开发依赖都只声明到 `0.1.2-rc.1`。用户在 `0.1.5-rc.1` 上安装时，peer 解析失败，即使装上，`assertHarnessCompatibility()` 也会在首个用户轮次前抛错。本记录说明如何确认差异、如何适配，以及哪些结论是实测的、哪些仍属未验证。

方法论来自仓库内 vendored 的 `plugin-upgrade` / `dsh-upgrade-audit` / `plugin-test` skills（本次同时升级到上游 `ecab245c`）。这些 skill 的迁移卡止于 `0.1.3-alpha.2`，没有 `0.1.5-rc.1` 段，所以本次结论全部以精确 tag、npm 产物和真实宿主探针为准。

## 结论

**Auto Mode 消费的宿主接口在本区间没有破坏性变更，运行时源码无需改动。** 需要改的是依赖闭包、默认工具组合和默认模型 id。

与 AgentTeams 同一区间的适配形成对照：AgentTeams 撞到两个直接阻塞（subagent 投递 symbol 从 `queuePrompt` 换成 `deliverPrompt`，以及 `Context.agent` / `AgentSetup` 签名变化），Auto Mode 不使用这些接口，因此没有对应改动。

### 已核对且未变的接口

| 接口面 | 证据 |
| --- | --- |
| `permissionPresets.current(session)` 与 `permission/preset` 事件 | `packages/interaction/permission-presets/src/index.ts` 两端头部一致 |
| `tools/pre-execute`、`tools/post-execute`、`tools/result`、`ctx.tools.guard` | `packages/core/tools/src/{index,types}.ts` 差异只在 `tool/code-dispatch` → `tool/ptc-dispatch` 改名和注释，Auto Mode 不消费 |
| `approval/request` 与 `dsh-user-approval` | 该包两 tag 仅 README/package.json 版本行变化 |
| `session.header.{cwd,parentSession,origin}` | `packages/core/session/src/types.ts` 对应行号与字段一致 |
| Session 事件读取（`seq`/`eventAt` 与 alpha `events` 回退） | `harness-compat.ts` 的双分支在两端都成立；fixture 在五个宿主上均通过 |
| `system-prompt/assemble`、`systemPrompt.context` | fixture 的 `childInheritedGuidance` 与真实 API 的 guidance 探针均为 true |
| 客户端 `PermissionRow` 注入面 | `packages/client/ui-permission-presets/src/` 两 tag 无差异，仅测试文件变化 |

### 实际改动

1. **依赖闭包重建。** `0.1.5-rc.1` 的解析闭包是 231 个 DSH 包，`0.1.2-rc.1` 是 214/215 个：新增 17 个（含 `dsh-session-format*` 迁移链、`dsh-package-manifest`、`dsh-http-proxy` 等），消失 4 个。override 列表按真实闭包重新生成（264 项），而不是把旧列表整体替换版本号——这正是 skills 中“不要把宽 peer 当承诺、不要只改版本号”的规则。
2. **`compatibility.json` 与 peer 范围**加入 `0.1.5-rc.1` 并设为 `recommendedHost`，四个 `0.1.2-*` 宿主降为保留兼容。`scripts/verify-maintenance.mjs` 强制三者一致。
3. **真实 API 验收脚本**：`0.1.5-rc.1` 从 base 组合中移除了 `str_replace_editor`（改用 `read`/`write`/`edit`），验收 profile 现在显式挂载官方 `@deepseek-ai/dsh-tool-str-replace-editor`，否则 native-editor 场景会静默退化成别的工具；模型 id 改为从宿主 settings 读取，不再硬编码 `deepseek-v4-flash`。
4. **修复失效探针**：真实 API driver 的边界指引探针匹配的是 `'Auto Mode'`，而指引正文用的是 `<auto_mode_policy>`，因此它永远为 false。改为使用插件自身的标记并加入断言，现在真实请求上的证据才有意义。
5. **skills 升级到上游 `ecab245c`**：9 个 vendored skill / 120 文件，新增 `0.1.3-alpha.1`/`alpha.2` 迁移卡、precision checklist、`inject-lint`，并补入 `dsh-plugin-development`、`plugin-heavy-dep`、`dsh-benchmark-case`。上游 `inject-lint` 把 Cordis peer 固定为 `^4.0.1`，本项目使用 `^4.0.2`，不按其机械降级。

### 未改动且有意保留

- 没有为 `0.1.5-rc.1` 新增运行时分支或兼容层：既然实测接口未变，加分支只会增加未被执行的面。
- 没有缩小支持矩阵：四个 `0.1.2-*` 宿主仍在同一构建上通过 22 项 fixture 断言。
- 没有把 `0.1.5-rc.2`（`next`）或 `0.1.5-alpha.2`（`alpha`）写入支持范围：它们没有经过本记录的验证。

## 验证

| 项目 | 结果 |
| --- | --- |
| `pnpm verify`（typecheck + build + 190 单测 + 包契约） | 通过 |
| `verify-maintenance`（5 个精确宿主 + 120 个 skill 文件哈希） | 通过 |
| `harness-doctor.test.mjs` | 7 项通过 |
| 精确 cohort fixture，五个宿主各 22 项断言 | 全部通过；`0.1.5-rc.1` 闭包 231 包，69 个打包文件逐字节比对 |
| 真实 API，`0.1.5-rc.1` headless | 30 项检查通过，19 次请求；真实 `str_replace_editor`、授权删除、冗余沙箱拒绝 + 无字段重试、分类器拒绝与抗注入 |
| 真实 API，`0.1.5-rc.1` Web（Ego Lite 真实浏览器） | 会话由 UI 创建，`bash` + 1 次真实分类器请求，授权删除生效、兄弟文件未受影响、无手工审批；菜单/风险弹窗中文，确认按钮受勾选门控，取消不切换，刷新后 Auto 与图标保留 |
| 真实 API，`0.1.2-rc.1` | 23 次请求全部检查通过（在上一份候选产物上测得；与发布产物仅差版本字符串与 README 文本） |
| 真实 API，`0.1.2-alpha.5` / `0.1.2-alpha.3` / `0.1.2-alpha.2` | 未在本机重跑真实 API；fixture 与 CI 矩阵覆盖 |
| 用户报障复现与修复确认 | `0.1.7` 在 `0.1.5-rc.1` 上 `plugin tree failed to load: ... unsupported or mixed Harness packages`；修复后同 profile 正常加载 |

`v0.1.8` 标签因候选哈希与 CI 产物不一致而未发布（见下节），因此上述接受的产物重新打包为 `0.1.9`：五个宿主 fixture 与 `0.1.5-rc.1` 的 headless + 浏览器验收都在 `0.1.9` 的这一份字节上重跑通过。

证据见 [validation/0.1.9/fixture.json](../../validation/0.1.9/fixture.json)、[validation/0.1.9/real-api.json](../../validation/0.1.9/real-api.json)、[validation/0.1.9/web.json](../../validation/0.1.9/web.json) 与 [VALIDATION.md](../../VALIDATION.md)。

## 未验证

- PowerShell 与 Windows ACL 验收（走 CI 矩阵）。
- 真实用户数据迁移（本次不涉及 session 格式变更）。
- `0.1.5-rc.2` 与 `0.1.5-alpha.2`。宿主升级到这两个版本时，需要重新走一遍本流程。

## 候选产物必须与 CI 同工具链打包

`release-candidate.json` 的 `artifactSha256` 会被 `publish` 作业用 `npm pack --ignore-scripts` 的产物逐字节校验，而这个哈希对工具链和输入文件都敏感。建 `v0.1.8` 标签时踩到两点：验收用的 tarball 是在最后一次改 README **之前**打的，且用的是本机 Node 26。CI 用 Node 24.20.0（`setup-node: '24'` 当前解析到该版本），两者产物不同，`verify-release-artifact` 失败，npm 未发布。

结论：**先冻结所有进入 npm 包的文件，再用 Node 24.20.0 + npm 11.19.0 打包，并对这一份产物跑验收**。本机复现 CI 哈希：

```sh
curl -fsSL https://nodejs.org/dist/v24.20.0/node-v24.20.0-darwin-arm64.tar.gz | tar -xz -C /tmp/node24 --strip-components=1
PATH=/tmp/node24/bin:$PATH pnpm build
PATH=/tmp/node24/bin:$PATH npm pack --ignore-scripts --pack-destination /tmp/pack
```

`files[]` 之外的文件（`release-candidate.json`、`VALIDATION.md`、`validation/`、`RELEASE_NOTES.md`、`scripts/`）改动不影响哈希；`files[]` 之内的（含 `docs/`、`README*.md`、`compatibility.json`、`lib/`）任何改动都会让哈希失效。

因为 `v0.1.8` 的 tag 已推送而其元数据无法与 CI 产物对齐，按项目规则不重打已推送的 tag，改为直接发 `0.1.9`。

## 一个容易误判的点

Web profile 通过 `@deepseek-ai/dsh-agent-presets` 的 `standard` preset 组合 agent 侧工具，而 `scripts/acceptance/real-api-driver.mjs` 用 `ctx.agents.create()` 直接建会话，不会加入 preset，因此只会看到 host 侧工具（本次即显式挂载的 `str_replace_editor`）。这会让 web 模式的 driver 验收表现成“工具缺失”，但那是验收夹具的路径问题，不是插件缺陷：真实 Web UI 创建的会话有完整工具集，本次浏览器验收已验证。Web 证据必须走浏览器，不能只看 driver。

## 复现

```sh
# 1. 精确宿主 fixture（会从 npmjs.org 解析完整闭包）
node scripts/harness-runtime-verify.mjs \
  --host-version 0.1.5-rc.1 \
  --artifact <packed.tgz> \
  --out /tmp/auto-runtime-0.1.5-rc.1

# 2. 真实 API 验收（复用已安装的 runtime，报告目录必须位于 /tmp）
node scripts/acceptance/run-real-api.mjs \
  <runtime> <packed.tgz> /tmp/auto-real-0.1.5-rc.1 \
  headless scripts/acceptance/real-api-driver.mjs bash
```
