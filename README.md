# Superman MCP

> ## ⚠️ 免责声明（请务必阅读）
>
> - **本项目仅供个人学习、技术研究与参考使用，严禁用于任何商业用途或违反法律法规、违反 Cursor / 相关第三方服务条款（ToS）的场景。**
> - 本项目基于开源项目 [`a78789191888/wkmcp-pjb`](https://github.com/a78789191888/wkmcp-pjb) 在 MIT 许可下进行二次修改、整合与研究，
>   **所有核心思路与上游代码的版权归原作者所有**，本仓库仅作为学习研究性质的复刻样本。
> - 发布者仅为源代码的整理与转存者，**与作者本人（即当前仓库的维护者）无任何利益关系**，
>   不对任何使用者因使用、修改、传播本代码而造成的直接或间接损失、账号封禁、法律责任承担任何责任。
> - 下载、克隆、编译、运行或以任何形式使用本仓库内容，即视为您**已完整阅读并同意本声明**；
>   如您不同意上述条款，请立即停止使用并删除本仓库的全部副本。
> - 如本项目侵犯到您的合法权益，请提交 Issue 告知，核实后会在第一时间移除相关内容。

---

**免卡密版 Cursor 增强插件 · Superman MCP**，基于 [`a78789191888/wkmcp-pjb`](https://github.com/a78789191888/wkmcp-pjb) 复刻并增强，
在保留其**全部侧栏多会话 MCP 功能**的同时，内置 **Cursor 会员类型切换器**（独立页面，点击跳转；原 `Cursor Membership Switcher` 项目功能移植）。

插件不再依赖任何卡密/激活码/试用期，打开即用。

> 上游项目地址：<https://github.com/a78789191888/wkmcp-pjb> （MIT License，本仓库为其研究学习性质的修改版，仅供参考）

## 功能

### 1. 侧栏多会话 MCP（保留自 wkmcp）

- 多项目、多窗口并行：最多 32 路会话（`my-mcp-1` … `my-mcp-32`），各绑独立消息通道
- `check_messages` / `send_message` / `ask_question` 三个 MCP 工具，支持附件（图片/文件 base64）
- 一键「开始配置」把当前侧栏会话列表写入工作区 `.cursor/mcp.json`
- 会话备忘、语音输入（Windows）、聊天记录持久化

### 2. Cursor 会员切换器（独立页面）

- **独立设置页**：侧栏只保留入口按钮，点击后在编辑区打开完整设置页（不再占用侧栏空间）
- 自动检测 Cursor 安装路径（运行进程 + 常见目录）
- 一键切换会员类型：`Free` / `Free Trial` / `Pro` / `Pro+` / `Ultra` / `Enterprise`，也支持自定义字符串
- 原始文件自动备份，可随时一键恢复
- 应用补丁前自动询问并关闭正在运行的 Cursor
- 一键重启 Cursor

### 3. Cursor 账单与用量（新增，独立页面）

- **独立账单页**：侧栏再加一个"打开账单与用量"按钮，在编辑区打开
- **自动读取本地 `state.vscdb`**：从 `cursorAuth/accessToken` 直接拿到当前登录 Cursor 账号（无需粘贴）
- **首次安装 → 本地记录**：优先解析 `cursorDiskKV` 中的 `composerData:*`，用近似字符权重粗估历史 token 供快速展示
- **之后每次 → 官方接口**：命中后标记 `hasFetchedFromApi`，不再回退到本地缓存
- **调用的 Cursor 接口**（参考 Open Switch 的实现与 [tokscale](https://github.com/junhoyeo/tokscale)）：
  - `POST https://api2.cursor.sh/aiserver.v1.AuthService/GetUserMeta`
  - `GET https://api2.cursor.sh/auth/full_stripe_profile`
  - `GET https://cursor.com/api/usage-summary`
  - `GET https://cursor.com/api/dashboard/export-usage-events-csv?strategy=tokens`
- **展示内容**：
  - 账号信息卡：邮箱、会员类型、订阅状态、WorkOS ID
  - 概览 KPI 卡：**今日 / 本周 / 本月 / 总计**的 $ 消耗 + token 数 + 次数
  - 近 30 天日消耗柱状图（纯 SVG，无图表库依赖）
  - 按模型细分表：次数 / 输入 / 输出 / 缓存读写 / 合计 token / 消耗 $
- **数据源标记**：页面顶部 badge 明确标出当前数据来自 `Cursor 接口（实时）` / `本地 composerData（近似）` / `本地缓存`
- 实现细节：
  - 使用内嵌 `sql.js`（已预打包 wasm，约 690 KB）读 state.vscdb，只读复制到 Buffer，不锁 Cursor
  - 用 Node 内置 `https` 调接口，无其他 npm 运行时依赖
  - 接口失败自动重试一次（TLS / socket 抖动容忍）

## 构建与打包

### 环境要求

- Node.js **18+**（需要自带 `npm`）
- Windows / macOS / Linux 均可；Windows 下建议使用 PowerShell
- 无需全局安装 `vsce`，已作为 `devDependencies` 随包拉取（`@vscode/vsce`）

### 一键打包

```bash
npm install          # 安装根依赖 + 触发 postinstall 安装 mcp-server 子包依赖
npm run compile      # 1) tsc -p . 编译 src/ → dist/   2) 执行 scripts/copy-vendor.js
npm run package      # 等价于 compile + vsce package --no-dependencies --allow-missing-repository
```

打包成功后会在仓库根目录得到：

```
cursor-free-plus-1.4.0.vsix   （版本号取自 package.json 的 "version"）

```

## 使用

1. 安装后左侧活动栏会出现 **Superman MCP** 图标，点开即是侧栏
2. （可选）如果你更习惯大窗口：命令面板运行 **`Superman MCP: 打开主面板（独立页签）`**，会在编辑区打开与侧栏相同的主界面（可拖拽分屏，和代码并排看）
3. 填写工作区路径或「使用当前」，点「开始配置」即可写入 `.cursor/mcp.json`
4. 点击「Cursor 会员类型 → 打开会员类型设置」按钮，在新页面里选择类型并「应用补丁」
5. 补丁完成后点「重启 Cursor」，重启后生效

## 命令面板

- `Superman MCP: 配置工作区（MCP）`
- `Superman MCP: 打开主面板（独立页签）`
- `Superman MCP: 打开会员类型设置`
- `Superman MCP: 打开账单与用量`
- `Superman MCP: 应用会员补丁`
- `Superman MCP: 恢复原始会员文件`
- `Superman MCP: 检测 Cursor 安装路径`

## 配置项

- `wukong.payStoreUrl`：侧栏「赞助/购买」跳转的 URL，默认 `https://pay.ldxp.cn/shop/superman`
- `cursorFree.supportGroupQQ`：交流群 QQ 号，默认 `1087432681`
- `cursorFree.defaultMembership`：默认选中的会员类型，默认 `pro`

> 其余 `wukong.*` 配置项为兼容 wkmcp 上游而保留，在免卡密版本里**不再生效**。

## 目录结构

```
Cursor-free/
├── package.json              # 扩展 manifest（命令、视图、配置、scripts 全在这）
├── tsconfig.json             # TypeScript 编译配置（outDir = dist/）
├── .vscodeignore             # vsce 打包排除清单
├── src/                      # TS 源码（编译到 dist/ 后被打进 vsix）
│   ├── extension.ts          # 扩展主入口（复刻自 wkmcp + 集成会员切换 / 账单 UI）
│   ├── license.ts            # 短路化的 license 模块（保留签名，一律永久已激活）
│   └── cursor-patcher.ts     # 会员补丁逻辑（从 Python 项目移植到 Node）
├── scripts/
│   ├── copy-vendor.js        # 把 sql.js 的 wasm 拷贝到 dist/vendor/sql.js/
│   └── smoke-billing.js      # 账单页接口 / 本地数据源冒烟脚本
├── dist/                     # 构建产物（进 vsix 的就是这一坨 + mcp-server/）
│   ├── extension.js
│   ├── license.js
│   ├── cursor-patcher.js
│   └── vendor/sql.js/        # sql-wasm.js + sql-wasm.wasm
├── mcp-server/
│   ├── index.mjs             # MCP stdio server（原样保留）
│   └── package.json
├── resources/icon.svg
├── legacy-python/            # 原 Python GUI 项目归档（不参与打包）
└── ref-wkmcp-pjb/            # wkmcp 参考源（仅作参照，不参与打包）
```

## 交流与支持

- QQ 交流群：1087432681
- 赞助 / 购买：<https://pay.ldxp.cn/shop/superman>

## 鸣谢与许可

- **上游原项目**：[a78789191888/wkmcp-pjb](https://github.com/a78789191888/wkmcp-pjb) （MIT License）
  本项目是在该项目基础上修改用于研究学习，**仅供参考**。感谢原作者的开源贡献。
- 会员切换逻辑参考：本仓库 `legacy-python/` 下的归档代码
- 账单接口调用参考：[junhoyeo/tokscale](https://github.com/junhoyeo/tokscale)

本仓库遵循 MIT 许可证进行源代码层面的二次分发（见 `LICENSE.txt`）。

## 再次声明

- **本项目仅供学习、研究、技术交流使用，不得用于任何违法违规用途，也不得用于任何商业用途。**
- 本项目为 [`a78789191888/wkmcp-pjb`](https://github.com/a78789191888/wkmcp-pjb) 的研究学习性质的修改版，**仅供参考**。
- 使用者应自行承担使用本项目所带来的全部风险（包括但不限于账号风险、法律风险），
  **任何后果均与本仓库发布者/维护者无关**。
- 请在下载后 24 小时内删除，并支持购买 Cursor 官方正版订阅。
