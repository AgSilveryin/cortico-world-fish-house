# 大肥鱼的小屋 × Coopanion：适配结论与上架准备

日期：2026-11-14 · 目标：把「大肥鱼的小屋」（AstrBot 插件，MIT，作者 jiuchai）适配成 Coopanion World 扩展

适配与发布：AgSilveryin。原项目的主题包格式、画布概念与壁纸页来自 jiuchai 的 AstrBot 插件，按 MIT 许可使用。

## 结论

**能适配，而且已经跑起来了。** 包已经做成 World API 6 的 npm 包 `cortico-world-fish-house@0.1.0`，在本机通过了 Coopanion 自带的扩展检查、真实 `loadExtensions()` 装载、`dry-mount` 校验、World 集成测试，并实际渲染出了默认主题的画面。

![默认主题的休息节点](assets/screenshot-1.png)

原项目最值钱的三样东西——主题包格式、画布/节点/连线语义、壁纸页——都完整保留；AstrBot 特有的消息挂载、回复闸门和 Python 服务端则按 Coopanion 的模型重写或降级。下面分开说清楚。

## 为什么能接

Coopanion 的 World 契约（`cortico/world.ts`，API 6）给扩展留的口子刚好够：

| 需要的能力 | Coopanion 提供的接口 | 本扩展怎么用 |
| --- | --- | --- |
| 常驻后台服务 | `start(host)` / `stop()` | 起本机 HTTP + WebSocket，服务壁纸页 |
| 跟着对话演 | `onRunPhase(phase)` | `delivering` → 走进回消息分支；`model/tools` → 停住；`idle` → 回合结束继续走 |
| 回合结束 | `onTurnEnded()` | 回消息节点播完一轮后接「放下手机」 |
| 模型能操作壁纸 | `tools()` | `fishhouse_status / goto / activity` |
| 设置页与面板 | `webUi(language)` 的 `panels` / `links` / `config` / `invoke` | 面板按钮、主题选择、端口、叠化、气泡开关 |
| 提示词 | `envPromptVars()` + `promptDocs(role=envPrompt)` | 把当前节点、画布、出边注入模型前缀 |
| 独立页面 | `links` + 自己的 HTTP 服务 | 壁纸页可复制、可进 OBS、可开窗口 |
| 打开本机窗口 | Node `child_process` | Edge/Chrome `--app=` 无地址栏窗口 |

这些都是 World 的常规能力，不需要改 Coopanion 本体，也不需要私有 hook。

## 架构映射

| 原 AstrBot 插件 | 适配后的 Coopanion 版 | 状态 |
| --- | --- | --- |
| `main.py` 消息钩子 | `onRunPhase` + `onTurnEnded` | 已实现，语义按 Coopanion 回合调整 |
| 画布 / 节点 / 连线（`core/flow.py`） | `src/flow.ts`，同角色、同推进规则、循环衔接点切换 | 已移植核心部分 |
| 主题包 `.zip`（`theme_store.py`） | `src/theme-store.ts` + `src/zip.ts` | 已实现，兼容旧版 actions/videos |
| 壁纸页（`web/live`） | 原样复用，World 提供同协议 HTTP/WS | 已复现（视频 Range、state/config、playing/loop_end） |
| Python aiohttp 服务 | Node `http` + 手写 WebSocket（无额外依赖） | 已实现 |
| 气泡（模型现写） | 节点文案兜底 + `fishhouse_activity` 工具 | 已实现（不再每次进节点调模型，省 token） |
| 主题市场（FastAPI） | 未搬；保留 .zip 导入 | 未实现，路线图 |
| Vue 画布编辑器 | 未搬；面板做主题管理 + 手动切节点 | 未实现，路线图 |
| 回复闸门（走到「仅回消息」节点才发 QQ） | 无对应机制 | 不可行，见下 |

## 已经验证到什么程度

| 验证 | 结果 |
| --- | --- |
| `parseExtensionManifest` | 通过：world / api 6 / 面板产物 / 图标 / screenshots |
| `dryMountWorld` | 通过：构造、3 个工具、envPromptVars、面板、2 组配置、1 个提示词模板 |
| `checkDescribe` | 通过：describe.json 与代码完全一致 |
| 真实 `loadExtensions()`（临时 extensions 目录） | 通过：loaded、worldId=fish-house、panel=served、assets=1 |
| World 集成测试 | 通过：起服务 → 取 state/config → 视频 206 Range → WS 推送 → 消息/loop_end/phase 推进 → 工具 |
| 视觉验证 | 通过：无头 Edge 实际播放默认主题并截图（见上） |
| 发布产物验证 | 通过：`npm pack` 出的 tgz 解包后，真实 loader 仍 loaded、panel=served |
| 单元测试 | 4 项通过：画布归一化、旧主题补画布、默认主题 zip 导入、World 集成 |

复跑命令（Windows；`CORTICO_APP_DIR` 指向 Coopanion 的 `resources/app`）：

```bat
set CORTICO_APP_DIR=<Coopanion 安装目录>\resources\app
node "%CORTICO_APP_DIR%\node_modules\tsx\dist\cli.mjs" scripts/check.mjs
node "%CORTICO_APP_DIR%\node_modules\tsx\dist\cli.mjs" scripts/load-check.mjs
node --test test/*.test.mjs
```

## 不能一比一搬的地方

1. **回复闸门做不了，也不该硬做。** 原插件能扣住 QQ 回复，等壁纸走到「仅回消息」节点再发；Coopanion 的回复由它自己的主循环生成并发送，World 没有拦截发送的接口。现在的做法是：收到消息（`delivering`）就先走进回消息分支，视觉上仍然对齐，但控制不了发送时机。
2. **壁纸不是桌面图层。** v0.1 是独立网页：可以进 OBS、可以开无边框窗口、可以放第二块屏，但不会钻到桌面图标下面。真正的桌面壁纸层需要 WorkerW 重挂载或自带 Electron overlay（`@lily-cooperative/custom-farm` 已经证明这条路可行，但要额外运行时，先不塞进 v0.1）。
3. **没有画布编辑器。** 画布在主题包里，导入即用。要改节点/连线，目前得用原版 AstrBot 面板编辑后导出主题包，或直接改 theme.json。
4. **没有主题市场客户端。** 原版市场服务端（FastAPI + SQLite）没搬；v0.1 只做本地 .zip 导入。市场是独立服务，后续可以按原版 API 接回来，不需要改 Coopanion。
5. **角色会重复。** 壁纸里的「大肥鱼」和 Coopanion 桌宠是两个形象；适合把壁纸当场景（直播、第二屏），而不是替代桌宠身体。
6. **视频解码成本。** 全屏 1080p 循环播放对 GPU/CPU 有占用；默认主题是 720p 左右的短片，问题不大，但多屏/低配机器要留意。

## 安装与试用

1. Coopanion → 设置 → 扩展 → 手动安装 → 从本机目录安装，选这个仓库目录（含 package.json 那一层）。
2. 按宿主要求重启 Coopanion。
3. 设置 → 扩展 → 大肥鱼的小屋 → 启用（World 列表）。
4. 打开面板 → 「打开壁纸窗口」；或直接访问 `http://127.0.0.1:47821/`。
5. 对 Coo 说一句话，看壁纸是否从「休息」走到「拿起手机 → 回消息」，回合结束再走回休息。

如果只想先看壁纸页、不动现有环境，运行 `node scripts/preview.mjs`；它用临时数据目录，不碰 Coopanion 的配置。

## 发布到扩展商店的准备

### 已经准备好的

- `package.json`：`cortico.kind=world`、`api=6`、`displayName`、`icon`、`describe`、`webUiClient/webUiStyle`、`tags`、`locales`、`screenshots`；`type: module`；`main: ./src/index.ts`；作者与仓库都指向 AgSilveryin。
- `describe.json`：由 Coopanion 自带 `exportDescribe` 生成，3 个工具 + 环境提示词，与代码一致。
- `CHANGELOG.md`：有 `## 0.1.0` 一节（市场按版本切更新说明）。
- `README.md`：中英简介、能力、安装、主题格式、工具、限制、隐私。
- `LICENSE`：MIT，保留原项目版权行。
- 图标 152KB PNG、市场截图 780KB PNG（≤2MB/张，≤8 张）。
- `npm pack --dry-run`：27 个文件，压缩后约 9.35MB，解压约 9.43MB（主要是默认主题视频与截图），远低于 npm 限制。
- 包名 `cortico-world-fish-house` 在 npm 上可用（查询返回 404）。

### 还差的两步（需要你的账号）

1. **登录 npm 并发布**：

```bat
cd <仓库目录>
npm login
npm publish
```

2. **让市场立即收录**：发布后到 https://github.com/Pal-AI-Lab/cortico-extensions/issues/new 开一个 issue：

```text
标题：[sync] cortico-world-fish-house
正文：package: cortico-world-fish-house
```

Action 会马上同步 npm 元数据、开讨论帖；之后标签、喜欢/不喜欢、评论都从那个帖子来。不想开 issue 也可以等定时 Action（可能延迟）。

### 上架检查清单

- [x] `cortico.api = 6`，`type: module`，入口能被 Coopanion 的 tsx 加载
- [x] `describe.json` 与代码一致（`scripts/check.mjs`）
- [x] `CHANGELOG.md` 当前版本一节
- [x] 图标 / 截图 / `locales` 中英
- [x] 只监听 127.0.0.1，无外发请求，无凭证收集
- [x] 主题包导入校验路径穿越、文件数、体积
- [ ] npm 登录 + `npm publish`
- [ ] `[sync]` issue
- [ ] （可选）第三方认证 `[certify] cortico-world-fish-house`；认证要求见索引仓 DESIGN.md

### 标签说明

声明了 `video`、`browser`、`companion` 三个标签：视频壁纸、会打开/嵌入网页、给桌宠一个自己的场景。官方标签（`coopanion`、`pal-ai-world` 等）只能由维护者加，作者声明无效。

### 更新流程

改完代码 → `npm version patch|minor` → `npm publish` → 开 `[sync]` issue（可选）→ 市场按 CHANGELOG 展示新版本说明。

## 下一步（按性价比排）

1. **真正的桌面壁纸层（Windows）**：用 WorkerW 重挂载浏览器窗口，或用自带 Electron overlay。前者不需要额外运行时，优先试；失败可回退到独立窗口。
2. **画布编辑器**：Coopanion 面板里做节点拖拽/连线，或复用原版 Vue 编辑器做成独立页面。
3. **主题市场**：按原版 `/api/market/*` 协议接回原市场，或改成静态索引；注意跨域与登录态。
4. **气泡模型化**：现在用节点文案兜底；可接 `host.cognition` 现写一句（要加开关，避免每次进节点都烧 token）。
5. **多屏/性能选项**：选显示器、限制分辨率、暂停后台解码。

## 文件结构

```text
cortico-world-fish-house/
├─ package.json            # cortico 清单（world/api 6/面板/图标/标签/截图）
├─ describe.json           # 框架生成的自描述
├─ src/
│  ├─ index.ts             # 默认导出 WorldDefinition
│  ├─ definition.ts        # id/defaults/configOptions/describe
│  ├─ world.ts             # 运行时：画布推进、服务、工具、面板
│  ├─ flow.ts              # 节点/连线归一化、起点、出边、旧主题兼容
│  ├─ theme-store.ts       # 主题安装/导入/删除/封面
│  ├─ server.ts            # HTTP + Video Range
│  ├─ ws.ts                # 手写 WebSocket（无依赖）
│  ├─ zip.ts               # 只读 ZIP（store/deflate）
│  ├─ window.ts            # Edge/Chrome --app 窗口
│  ├─ paths.ts             # 扩展包自身路径
│  ├─ tools.ts             # 工具声明（describe 与运行时共用）
│  └─ ENV_PROMPT.md        # 注入模型的环境提示词
├─ dist/webui.js|css       # 设置页面板
├─ web/live/               # 壁纸页（来自原项目，MIT）
├─ assets/                 # 默认主题 zip、图标、截图
├─ scripts/check.mjs       # manifest + dry-mount + describe 检查
├─ scripts/load-check.mjs  # 真实 loadExtensions 装载
├─ scripts/describe.mjs    # 生成 describe.json
├─ scripts/preview.mjs     # 临时目录 + 无头 Edge 截图
└─ test/                   # 画布/主题/World 集成测试
```

## 一句话总结

原项目的「主题包 + 画布 + 壁纸页」和 Coopanion 的「World + 回合 + 工具」是能拼起来的；拼不上的只有 AstrBot 的回复闸门和真正的桌面图层。前者用「消息到达就进回消息分支」近似，后者留作 v0.2。现在这个包可以装、可以演、可以上架，只差 npm 登录后点发布。