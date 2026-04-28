'use strict';

/**
 * Superman MCP 桌面应用 · 主进程
 *
 * 复用与 Cursor 插件版完全相同的文件队列协议：
 *   ~/.cursor/my-mcp-messages/s/<sessionId>/messages.json   渲染进程 → MCP server
 *   ~/.cursor/my-mcp-messages/s/<sessionId>/reply.json      MCP server → 渲染进程
 *   ~/.cursor/my-mcp-messages/workspace.json                工作区元信息
 *
 * 这样桌面版与插件版可以互换使用，Cursor 侧的 mcp.json 不需要改动。
 */

const { app, BrowserWindow, ipcMain, dialog, clipboard, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

const MAX_SESSIONS = 32;
const MAX_MSG_TEXT_CHARS = 64 * 1024;
const MAX_QUEUE_LEN = 500;
const MAX_ATTACH_BASE64_CHARS = Math.floor(2.5 * 1024 * 1024);
const POLL_INTERVAL_MS = 800;

const QUEUE_ROOT = path.join(os.homedir(), '.cursor', 'my-mcp-messages');
const STATE_FILE = path.join(os.homedir(), '.superman-mcp-desktop.json');

let mainWindow = null;
let pollTimer = null;
const lastReplyBySession = {};

function ensureDir(p) {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function isValidSessionId(id) {
    const s = String(id);
    const n = parseInt(s, 10);
    return Number.isInteger(n) && n >= 1 && n <= MAX_SESSIONS && String(n) === s;
}

function readJsonSafe(file, fallback) {
    try {
        if (!fs.existsSync(file)) return fallback;
        return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
        return fallback;
    }
}

function writeJson(file, data) {
    ensureDir(path.dirname(file));
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

function loadDesktopState() {
    return readJsonSafe(STATE_FILE, {
        sessionOrder: ['1', '2', '3'],
        activeSessionId: '1',
        workspacePath: '',
        memos: {},
        histories: {},
    });
}

function saveDesktopState(patch) {
    const cur = loadDesktopState();
    const next = { ...cur, ...patch };
    writeJson(STATE_FILE, next);
    return next;
}

/* ----------------------- 主窗口 ----------------------- */

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 980,
        height: 720,
        minWidth: 640,
        minHeight: 460,
        title: 'Superman MCP',
        backgroundColor: '#1e1e2e',
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });

    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

/* ----------------------- reply 轮询 ----------------------- */

function startReplyPolling() {
    if (pollTimer) clearInterval(pollTimer);
    for (let n = 1; n <= MAX_SESSIONS; n++) {
        lastReplyBySession[String(n)] = '';
    }
    pollTimer = setInterval(() => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        for (let n = 1; n <= MAX_SESSIONS; n++) {
            const sid = String(n);
            const replyPath = path.join(QUEUE_ROOT, 's', sid, 'reply.json');
            try {
                if (!fs.existsSync(replyPath)) continue;
                const raw = fs.readFileSync(replyPath, 'utf-8');
                const parsed = JSON.parse(raw);
                const ts = String(parsed.timestamp ?? '');
                if (!ts || ts === lastReplyBySession[sid]) continue;
                lastReplyBySession[sid] = ts;
                mainWindow.webContents.send('cursor-reply', {
                    sessionId: sid,
                    reply: String(parsed.reply ?? ''),
                    time: ts,
                });
                try {
                    fs.unlinkSync(replyPath);
                } catch {
                    /* ignore */
                }
            } catch {
                /* ignore */
            }
        }
    }, POLL_INTERVAL_MS);
}

/* ----------------------- 写 mcp.json (复用插件逻辑) ----------------------- */

function configureWorkspaceMcp(workspacePath, sessionOrder) {
    if (!workspacePath || !fs.existsSync(workspacePath)) {
        throw new Error(`路径不存在：${workspacePath}`);
    }
    if (!Array.isArray(sessionOrder) || sessionOrder.length === 0) {
        throw new Error('会话列表为空');
    }
    const order = sessionOrder.filter(isValidSessionId);
    if (order.length === 0) throw new Error('会话列表无有效 ID');

    // 把仓库根目录下的 mcp-server/ 拷到 ~/.cursor/my-mcp-server
    // （桌面版打包后没有 mcp-server，所以期望用户已经装过插件，或者后续我们另行打包发布）
    const appRoot = app.isPackaged ? path.dirname(app.getPath('exe')) : path.resolve(__dirname, '..');
    const candidateSrc = [
        path.join(appRoot, 'mcp-server'),
        path.join(__dirname, '..', 'mcp-server'),
    ];
    const srcDir = candidateSrc.find(p => fs.existsSync(p));
    const destDir = path.join(os.homedir(), '.cursor', 'my-mcp-server');

    if (srcDir) {
        const copyDir = (src, dest) => {
            ensureDir(dest);
            for (const name of fs.readdirSync(src)) {
                if (name === 'node_modules') continue;
                const s = path.join(src, name);
                const d = path.join(dest, name);
                if (fs.statSync(s).isDirectory()) copyDir(s, d);
                else fs.copyFileSync(s, d);
            }
        };
        copyDir(srcDir, destDir);
        if (!fs.existsSync(path.join(destDir, 'node_modules'))) {
            try {
                execSync('npm install', { cwd: destDir, stdio: 'ignore' });
            } catch {
                /* 忽略：让用户根据 README 自行 npm install */
            }
        }
    }

    const cursorDir = path.join(workspacePath, '.cursor');
    ensureDir(cursorDir);
    const mcpPath = path.join(cursorDir, 'mcp.json');
    const mcpServerPath = path.join(destDir, 'index.mjs').replace(/\\/g, '/');

    let mcpServers = {};
    if (fs.existsSync(mcpPath)) {
        try {
            const existing = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
            mcpServers = existing.mcpServers || {};
        } catch {
            mcpServers = {};
        }
    }
    delete mcpServers['my-mcp'];
    for (const k of Object.keys(mcpServers)) {
        if (/^my-mcp-\d+$/.test(k)) delete mcpServers[k];
    }
    for (const id of order) {
        mcpServers[`my-mcp-${id}`] = {
            command: 'node',
            args: [mcpServerPath],
            env: { WUKONG_SESSION: id },
        };
    }
    writeJson(mcpPath, { mcpServers });

    // 写规则文件
    const rulesDir = path.join(cursorDir, 'rules');
    ensureDir(rulesDir);
    const rulePath = path.join(rulesDir, 'my-mcp.mdc');
    const ruleContent = `---\ndescription: 助手正文只在 Cursor 显示；用 check_messages 保持循环，不向插件镜像长回复\nglobs:\nalwaysApply: true\n---\n\n# Superman MCP 多会话规则\n\n桌面/侧栏可「添加/删除会话」管理通道（最多 **${MAX_SESSIONS}** 路）。点击「开始配置」时，仅按当前列表在本工作区 \`mcp.json\` 写入对应的 **my-mcp-N**；增删会话后必须再次配置，否则 Cursor 里 MCP 列表与桌面/插件不一致。每个 Cursor 对话窗口只绑定其中一个 **my-mcp-N**。\n\n## 核心规则\n\n1. **先正常对话**：用户寒暄、提问、下任务时，要像普通聊天一样直接回应；禁止用「工具正常」「通道已验证」等套话代替回答。\n2. **用户要看的内容**：写在 Cursor 对话窗口；默认不传 \`reply\`。\n3. **循环**：每轮回应后必须立刻再调用当前 MCP 的 \`check_messages()\`。\n4. 插件可能每次只推一条消息；连发多条会分多次送达，逐次回复并继续 \`check_messages\`。\n`;
    fs.writeFileSync(rulePath, ruleContent, 'utf-8');

    // 写 workspace.json 让 MCP server 提示工作区
    writeJson(path.join(QUEUE_ROOT, 'workspace.json'), {
        workspacePath,
        time: new Date().toISOString(),
    });

    return {
        mcpPath,
        rulePath,
        destDir,
        workspacePath,
        sessionIds: order,
        mcpServerCopied: !!srcDir,
    };
}

/* ----------------------- 发送消息 ----------------------- */

function parseAttachments(message) {
    const images = [];
    const files = [];
    let total = 0;
    if (Array.isArray(message.images)) {
        for (const x of message.images) {
            if (!x || typeof x !== 'object') continue;
            const mimeType = String(x.mimeType ?? '');
            const data = String(x.data ?? '').replace(/\s/g, '');
            if (!mimeType.startsWith('image/') || !data) continue;
            total += data.length;
            if (total > MAX_ATTACH_BASE64_CHARS) {
                return { images: [], files: [], error: '附件总体积过大（约 2MB 上限）' };
            }
            images.push({ mimeType, data });
        }
    }
    if (Array.isArray(message.files)) {
        for (const x of message.files) {
            if (!x || typeof x !== 'object') continue;
            const name = String(x.name ?? 'file').replace(/[/\\]/g, '_').slice(0, 240);
            const mimeType = String(x.mimeType ?? 'application/octet-stream');
            const data = String(x.data ?? '').replace(/\s/g, '');
            if (!data) continue;
            total += data.length;
            if (total > MAX_ATTACH_BASE64_CHARS) {
                return { images: [], files: [], error: '附件总体积过大（约 2MB 上限）' };
            }
            files.push({ name, mimeType, data });
        }
    }
    return { images, files, error: null };
}

function pushMessage(sessionId, payload) {
    if (!isValidSessionId(sessionId)) throw new Error('无效会话 ID');
    const text = String(payload.text ?? '').trim();
    const { images, files, error } = parseAttachments(payload);
    if (error) throw new Error(error);
    if (!text && images.length === 0 && files.length === 0) {
        throw new Error('请输入文字或添加图片/文件');
    }
    if (text.length > MAX_MSG_TEXT_CHARS) throw new Error('单条文本超过 64KB 上限');

    const sessionDir = path.join(QUEUE_ROOT, 's', String(sessionId));
    const queuePath = path.join(sessionDir, 'messages.json');
    let data = { messages: [] };
    if (fs.existsSync(queuePath)) {
        try {
            data = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));
        } catch {
            const broken = queuePath + '.broken-' + Date.now();
            try { fs.renameSync(queuePath, broken); } catch { /* ignore */ }
            data = { messages: [] };
        }
    }
    data.messages = Array.isArray(data.messages) ? data.messages : [];
    if (data.messages.length >= MAX_QUEUE_LEN) {
        throw new Error(`队列已满（>${MAX_QUEUE_LEN} 条），请先在 Cursor 中通过 check_messages 消费一部分`);
    }
    const entry = {
        text: text || (images.length || files.length ? '(附件)' : ''),
        time: new Date().toISOString(),
    };
    if (images.length > 0) entry.images = images;
    if (files.length > 0) entry.files = files;
    data.messages.push(entry);
    writeJson(queuePath, data);
    return {
        ok: true,
        sessionId: String(sessionId),
        attachmentLabels: [
            ...(images.length > 0 ? [`图片 ×${images.length}`] : []),
            ...files.map(f => f.name),
        ],
    };
}

/* ----------------------- IPC ----------------------- */

function registerIpc() {
    ipcMain.handle('state:load', async () => loadDesktopState());
    ipcMain.handle('state:save', async (_e, patch) => saveDesktopState(patch || {}));

    ipcMain.handle('workspace:detectRecent', async () => {
        // 1) 来自任何一次「开始配置」操作（桌面或插件版）写入的 workspace.json
        try {
            const wsInfoPath = path.join(QUEUE_ROOT, 'workspace.json');
            if (fs.existsSync(wsInfoPath)) {
                const obj = JSON.parse(fs.readFileSync(wsInfoPath, 'utf-8'));
                if (typeof obj.workspacePath === 'string'
                    && obj.workspacePath.trim()
                    && fs.existsSync(obj.workspacePath)) {
                    return { ok: true, source: 'mcp-messages/workspace.json', path: obj.workspacePath };
                }
            }
        } catch {
            /* ignore */
        }
        // 2) Cursor 最近工作区列表
        const candidates = [
            path.join(os.homedir(), 'AppData', 'Roaming', 'Cursor', 'User', 'globalStorage', 'storage.json'),
            path.join(os.homedir(), 'AppData', 'Roaming', 'Cursor', 'storage.json'),
        ];
        for (const file of candidates) {
            try {
                if (!fs.existsSync(file)) continue;
                const obj = JSON.parse(fs.readFileSync(file, 'utf-8'));
                const collect = [];
                const seen = new Set();
                const visit = node => {
                    if (!node || seen.has(node)) return;
                    if (typeof node === 'object') {
                        seen.add(node);
                        if (typeof node.folderUri === 'string') collect.push(node.folderUri);
                        if (typeof node.configPath === 'string') collect.push(node.configPath);
                        for (const v of Object.values(node)) visit(v);
                    }
                };
                visit(obj);
                for (const raw of collect) {
                    let p = raw;
                    if (p.startsWith('file:///')) {
                        try { p = decodeURIComponent(new URL(p).pathname.replace(/^\//, '')); } catch { /* ignore */ }
                    }
                    p = p.replace(/\//g, path.sep);
                    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
                        return { ok: true, source: path.basename(file), path: p };
                    }
                }
            } catch {
                /* ignore */
            }
        }
        return { ok: false };
    });

    ipcMain.handle('workspace:pick', async () => {
        const r = await dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory'],
            title: '选择要配置 MCP 的工作区文件夹',
        });
        if (r.canceled || r.filePaths.length === 0) return { canceled: true };
        return { canceled: false, path: r.filePaths[0] };
    });

    ipcMain.handle('workspace:configure', async (_e, payload) => {
        const { workspacePath, sessionOrder } = payload || {};
        try {
            const result = configureWorkspaceMcp(workspacePath, sessionOrder);
            saveDesktopState({ workspacePath, sessionOrder: result.sessionIds });
            return { ok: true, ...result };
        } catch (err) {
            return { ok: false, message: String(err && err.message ? err.message : err) };
        }
    });

    ipcMain.handle('messages:send', async (_e, payload) => {
        try {
            const out = pushMessage(payload.sessionId, payload);
            if (payload.workspacePath) {
                writeJson(path.join(QUEUE_ROOT, 'workspace.json'), {
                    workspacePath: payload.workspacePath,
                    time: new Date().toISOString(),
                });
            }
            return out;
        } catch (err) {
            return { ok: false, message: String(err && err.message ? err.message : err) };
        }
    });

    ipcMain.handle('clipboard:copyPhrase', async (_e, sessionId) => {
        if (!isValidSessionId(sessionId)) return { ok: false };
        clipboard.writeText(`请使用 my-mcp-${sessionId} 的 check_messages`);
        return { ok: true };
    });

    ipcMain.handle('shell:openExternal', async (_e, url) => {
        if (typeof url !== 'string') return;
        if (!/^https?:\/\//i.test(url)) return;
        await shell.openExternal(url);
    });
}

/* ----------------------- 生命周期 ----------------------- */

app.whenReady().then(() => {
    ensureDir(QUEUE_ROOT);
    registerIpc();
    createWindow();
    startReplyPolling();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
    if (process.platform !== 'darwin') app.quit();
});
