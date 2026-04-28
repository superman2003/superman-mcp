# Superman MCP · 桌面版（Electron）

独立的桌面应用窗口，**不再依赖 Cursor 侧栏**就能：

- 给绑定到当前 Cursor 对话的 `my-mcp-N` 通道发消息（文本）
- 自动接收 Cursor AI 通过 `check_messages` 写回的 `reply.json`
- 多路会话切换（最多 32 路）
- 一键写 `<workspace>/.cursor/mcp.json` 与规则文件

> 与 Cursor 插件版**共用**同一套文件队列协议（`~/.cursor/my-mcp-messages/`），所以 **插件 + 桌面 二选一** 来发消息（同时开会两个 UI 都看到同样的回复，但发送时只在一个 UI 里发，避免冲突）。

---

## 快速开始（开发模式）

依赖：Node.js 18+

```bash
cd desktop-app
npm install
npm start
```

第一次启动后：

1. 在「工作区配置」里浏览选择项目目录 → 点 **开始配置**  
   桌面版会把 `mcp-server` 拷到 `~/.cursor/my-mcp-server`，并往 `<workspace>/.cursor/mcp.json` 写入 `my-mcp-1` … `my-mcp-N`。
2. 在 Cursor 的对话窗口里说「请使用 my-mcp-1 的 check_messages」  
   AI 就会通过该通道拉取你在桌面版发出的消息。
3. 在桌面版「发送消息」里输入内容 → **发送**。Cursor 那边的 AI 处理完之后回复会自动出现在桌面版的「对话记录」中。

---

## 打包成 .exe

```bash
cd desktop-app
npm install
npm run dist:win
```

产物位于 `desktop-app/out/`。Windows 上为 NSIS 安装包：`Superman MCP Setup x.x.x.exe`。

---

## 与 Cursor 插件版的区别

| 对比项 | 桌面版 | Cursor 插件版 |
| --- | --- | --- |
| 入口 | 独立的桌面窗口 | Cursor 侧栏图标 / 命令面板 |
| 是否需要 Cursor | 启动时不需要，**对话需要 Cursor 在线读取 mcp** | 需要 Cursor |
| 文件队列位置 | 完全相同（`~/.cursor/my-mcp-messages/`） | 完全相同 |
| 持久化数据 | `~/.superman-mcp-desktop.json`（会话/历史） | Cursor `globalState` |
| 会员补丁 / 账单页 | **不包含**（这是 Cursor 内的功能） | 包含 |

---

## 已知限制（MVP 阶段）

- 只支持 **文本** 消息（图片/文件附件后续版本加）
- 没有系统托盘、最小化到托盘
- 多个 Cursor 窗口 + 桌面版同时打开时不做防冲突，建议同一时刻只在一个 UI 里发送
- 打包前需要保证仓库里 `mcp-server/` 存在；如果你只装了 `.vsix`，请保证 `~/.cursor/my-mcp-server/index.mjs` 已就位（任何一种"开始配置"操作都会写入它）

---

## 目录

```
desktop-app/
├── package.json          # Electron 配置 + electron-builder 打包配置
├── main.js               # 主进程：窗口、IPC、文件队列、轮询 reply.json
├── preload.js            # contextBridge 暴露安全 API
└── renderer/
    ├── index.html
    ├── styles.css
    └── app.js            # 渲染进程：会话栏 / 工作区配置 / 发送 / 对话
```
