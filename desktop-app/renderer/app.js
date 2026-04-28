'use strict';

const api = window.supermanApi;
const MAX_SESSIONS = 32;

let state = {
    sessionOrder: ['1', '2', '3'],
    activeSessionId: '1',
    workspacePath: '',
    memos: {},
    histories: {},
};
let activeSessionId = '1';

const els = {
    sessionList: document.getElementById('sessionList'),
    addSessionBtn: document.getElementById('addSessionBtn'),
    pathInput: document.getElementById('pathInput'),
    browseBtn: document.getElementById('browseBtn'),
    cfgBtn: document.getElementById('cfgBtn'),
    autoDetectBtn: document.getElementById('autoDetectBtn'),
    cfgFeedback: document.getElementById('cfgFeedback'),
    msgInput: document.getElementById('msgInput'),
    sendBtn: document.getElementById('sendBtn'),
    testHelloBtn: document.getElementById('testHelloBtn'),
    copyHintBtn: document.getElementById('copyHintBtn'),
    sendFeedback: document.getElementById('sendFeedback'),
    sendTarget: document.getElementById('sendTarget'),
    activeMcpHint: document.getElementById('activeMcpHint'),
    hintPhrase: document.getElementById('hintPhrase'),
    chat: document.getElementById('chat'),
    emptyState: document.getElementById('emptyState'),
    clearChatBtn: document.getElementById('clearChatBtn'),
};

function showFeedback(el, type, text, autoHide = true) {
    el.className = 'feedback ' + type;
    el.textContent = text || '';
    if (autoHide && (type === 'success' || type === 'info')) {
        const old = text;
        setTimeout(() => {
            if (el.textContent === old) {
                el.textContent = '';
                el.className = 'feedback';
            }
        }, 4000);
    }
}

function isValidSessionId(id) {
    const n = parseInt(id, 10);
    return Number.isInteger(n) && n >= 1 && n <= MAX_SESSIONS && String(n) === String(id);
}

function renderSessions() {
    els.sessionList.innerHTML = '';
    state.sessionOrder.forEach(sid => {
        const item = document.createElement('div');
        item.className = 'session-item' + (sid === activeSessionId ? ' active' : '');
        item.dataset.sid = sid;

        const label = document.createElement('span');
        label.textContent = `MCP-${sid}`;
        item.appendChild(label);

        if (state.sessionOrder.length > 1) {
            const rm = document.createElement('button');
            rm.className = 'session-remove';
            rm.title = '删除该会话';
            rm.textContent = '×';
            rm.addEventListener('click', e => {
                e.stopPropagation();
                removeSession(sid);
            });
            item.appendChild(rm);
        }

        item.addEventListener('click', () => switchSession(sid));
        els.sessionList.appendChild(item);
    });

    els.sendTarget.textContent = `MCP-${activeSessionId}`;
    els.activeMcpHint.textContent = `当前：MCP-${activeSessionId}`;
    els.hintPhrase.textContent = `请使用 my-mcp-${activeSessionId} 的 check_messages`;
}

function switchSession(sid) {
    if (!isValidSessionId(sid)) return;
    activeSessionId = sid;
    saveState({ activeSessionId });
    renderSessions();
    renderChat();
}

function addSession() {
    if (state.sessionOrder.length >= MAX_SESSIONS) return;
    const used = new Set(state.sessionOrder);
    let next = null;
    for (let i = 1; i <= MAX_SESSIONS; i++) {
        if (!used.has(String(i))) { next = String(i); break; }
    }
    if (!next) return;
    state.sessionOrder = [...state.sessionOrder, next].sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    saveState({ sessionOrder: state.sessionOrder });
    renderSessions();
}

function removeSession(sid) {
    const next = state.sessionOrder.filter(x => x !== sid);
    if (next.length === 0) return;
    state.sessionOrder = next;
    if (activeSessionId === sid) activeSessionId = next[0];
    saveState({ sessionOrder: next, activeSessionId });
    renderSessions();
    renderChat();
}

async function saveState(patch) {
    state = await api.state.save(patch);
}

/* ---------- Workspace ---------- */

els.browseBtn.addEventListener('click', async () => {
    const r = await api.workspace.pick();
    if (r.canceled) return;
    els.pathInput.value = r.path;
    showFeedback(els.cfgFeedback, 'info', '已选择：' + r.path);
});

async function tryAutoDetect(silent) {
    const r = await api.workspace.detectRecent();
    if (r && r.ok) {
        els.pathInput.value = r.path;
        showFeedback(els.cfgFeedback, 'info', `已自动填入（来源：${r.source}）：${r.path}`);
        return true;
    }
    if (!silent) {
        showFeedback(els.cfgFeedback, 'error', '没找到最近的 Cursor 工作区，请手动「浏览…」选择');
    }
    return false;
}

els.autoDetectBtn.addEventListener('click', () => tryAutoDetect(false));

els.cfgBtn.addEventListener('click', async () => {
    const workspacePath = els.pathInput.value.trim();
    if (!workspacePath) {
        showFeedback(els.cfgFeedback, 'error', '请先选择或输入工作区路径');
        return;
    }
    showFeedback(els.cfgFeedback, 'pending', '正在写入 mcp.json…', false);
    const r = await api.workspace.configure({
        workspacePath,
        sessionOrder: state.sessionOrder,
    });
    if (!r.ok) {
        showFeedback(els.cfgFeedback, 'error', '配置失败：' + (r.message || '未知错误'));
        return;
    }
    state.workspacePath = workspacePath;
    showFeedback(
        els.cfgFeedback,
        'success',
        `已配置 ${r.sessionIds.length} 路 MCP，写入 ${r.mcpPath}`
            + (r.mcpServerCopied ? '' : '（注意：没找到 mcp-server 源码，请先安装一次插件版让 ~/.cursor/my-mcp-server 就位）')
    );
    addChatLine('system', `工作区已配置：${workspacePath}`);
});

/* ---------- Send ---------- */

async function doSend(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) {
        showFeedback(els.sendFeedback, 'error', '请输入文字');
        return;
    }
    showFeedback(els.sendFeedback, 'pending', '正在发送…', false);
    const r = await api.messages.send({
        text: trimmed,
        sessionId: activeSessionId,
        workspacePath: state.workspacePath || els.pathInput.value.trim() || '',
    });
    if (r.ok) {
        showFeedback(els.sendFeedback, 'success',
            `已发送到 MCP-${r.sessionId}！在对应 Cursor 对话中执行：「请使用 my-mcp-${r.sessionId} 的 check_messages」`);
        addChatLine('user', trimmed);
        els.msgInput.value = '';
    } else {
        showFeedback(els.sendFeedback, 'error', r.message || '发送失败');
    }
}

els.sendBtn.addEventListener('click', () => doSend(els.msgInput.value));
els.testHelloBtn.addEventListener('click', () => doSend('你好'));
els.msgInput.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        doSend(els.msgInput.value);
    }
});

els.copyHintBtn.addEventListener('click', async () => {
    const r = await api.clipboard.copyPhrase(activeSessionId);
    if (r.ok) showFeedback(els.sendFeedback, 'success', '已复制到剪贴板');
});

/* ---------- Chat ---------- */

function ensureHistoryBucket(sid) {
    if (!state.histories[sid]) state.histories[sid] = [];
    return state.histories[sid];
}

function addChatLine(type, content, time) {
    const hist = ensureHistoryBucket(activeSessionId);
    hist.push({ type, content, time: time || new Date().toISOString() });
    persistHistories();
    renderChat();
}

function persistHistories() {
    api.state.save({ histories: state.histories }).then(s => { state = s; }).catch(() => {});
}

function renderChat() {
    const hist = ensureHistoryBucket(activeSessionId);
    if (hist.length === 0) {
        els.chat.innerHTML = '';
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = '暂无消息，发送内容后 Cursor 中的 AI 会回复到这里';
        els.chat.appendChild(empty);
        return;
    }
    els.chat.innerHTML = '';
    hist.forEach(m => {
        const wrap = document.createElement('div');
        wrap.className = 'msg msg-' + m.type;
        const body = document.createElement('div');
        body.textContent = m.content;
        wrap.appendChild(body);
        const t = document.createElement('div');
        t.className = 'msg-time';
        try {
            t.textContent = new Date(m.time).toLocaleTimeString();
        } catch {
            t.textContent = '';
        }
        wrap.appendChild(t);
        els.chat.appendChild(wrap);
    });
    els.chat.scrollTop = els.chat.scrollHeight;
}

els.clearChatBtn.addEventListener('click', () => {
    state.histories[activeSessionId] = [];
    persistHistories();
    renderChat();
});

/* ---------- Cursor reply 推送 ---------- */

api.messages.onCursorReply(({ sessionId, reply, time }) => {
    if (!reply || !sessionId) return;
    const prev = state.histories[sessionId] || [];
    state.histories[sessionId] = [...prev, { type: 'cursor', content: reply, time }];
    persistHistories();
    if (sessionId === activeSessionId) renderChat();
});

/* ---------- 初始化 ---------- */

(async function init() {
    state = await api.state.load();
    if (!Array.isArray(state.sessionOrder) || state.sessionOrder.length === 0) {
        state.sessionOrder = ['1', '2', '3'];
    }
    if (!state.histories || typeof state.histories !== 'object') state.histories = {};
    activeSessionId = isValidSessionId(state.activeSessionId) ? state.activeSessionId : state.sessionOrder[0];
    if (state.workspacePath) els.pathInput.value = state.workspacePath;
    renderSessions();
    renderChat();
    if (!els.pathInput.value.trim()) {
        // 静默自动检测一次：用户没保存过工作区时，尝试从 ~/.cursor 与 Cursor storage.json 推断
        await tryAutoDetect(true);
    }
})();

els.addSessionBtn.addEventListener('click', addSession);
