"use strict";
/**
 * Cursor 本地 state.vscdb 读取器。
 *
 * 读取内容：
 *  - cursorAuth/accessToken / refreshToken / cachedEmail / ...
 *  - composerData:{uuid} / bubbleId:{uuid} 等历史对话，用于"本地记录"首次展示
 *
 * 实现：用 sql.js（纯 JS SQLite）解析 state.vscdb。Cursor 运行中时文件可能
 * 被独占，这里先把整个文件读入 Buffer，再交给 sql.js，只读不写，不会锁库。
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

// 在运行期从 dist/vendor/sql.js 懒加载（见 initSqlJsLazy）
let _initSqlJs = null;
let _sqlPromise = null;

function loadSqlJsLib() {
    if (_initSqlJs) return _initSqlJs;
    try {
        _initSqlJs = require("./vendor/sql.js/sql-wasm.js");
    } catch (e) {
        throw new Error(
            "未能加载 sql.js vendor 文件，请确认 dist/vendor/sql.js 是否完整：" +
            (e && e.message ? e.message : e)
        );
    }
    return _initSqlJs;
}

async function initSqlJsLazy() {
    if (_sqlPromise) return _sqlPromise;
    const init = loadSqlJsLib();
    const wasmFile = path.join(__dirname, "vendor", "sql.js", "sql-wasm.wasm");
    _sqlPromise = init({
        locateFile: (fileName) => {
            if (fileName === "sql-wasm.wasm") return wasmFile;
            return path.join(__dirname, "vendor", "sql.js", fileName);
        },
    });
    return _sqlPromise;
}

/** 返回当前平台默认的 Cursor 用户数据目录。 */
function getDefaultCursorDataDir() {
    if (process.platform === "win32") {
        const appdata =
            process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
        return path.join(appdata, "Cursor");
    }
    if (process.platform === "darwin") {
        return path.join(os.homedir(), "Library", "Application Support", "Cursor");
    }
    return path.join(os.homedir(), ".config", "Cursor");
}

function getDefaultStateDbPath() {
    return path.join(
        getDefaultCursorDataDir(),
        "User",
        "globalStorage",
        "state.vscdb"
    );
}

/** 读取整个 state.vscdb 为 sql.js 的 Database 对象。 */
async function openStateDb(dbPathOverride) {
    const dbPath = dbPathOverride || getDefaultStateDbPath();
    if (!fs.existsSync(dbPath)) {
        const err = new Error("未找到 state.vscdb: " + dbPath);
        err.code = "STATE_DB_NOT_FOUND";
        err.dbPath = dbPath;
        throw err;
    }
    const buf = fs.readFileSync(dbPath);
    const SQL = await initSqlJsLazy();
    const db = new SQL.Database(new Uint8Array(buf));
    return { db, dbPath };
}

/** ItemTable 读 key，找不到返回 null。 */
function readItem(db, key) {
    try {
        const stmt = db.prepare("SELECT value FROM ItemTable WHERE key = :k");
        stmt.bind({ ":k": key });
        let value = null;
        if (stmt.step()) {
            const row = stmt.get();
            value = row && row[0] != null ? String(row[0]) : null;
        }
        stmt.free();
        if (value == null) return null;
        const trimmed = value.trim();
        return trimmed === "" ? null : trimmed;
    } catch {
        return null;
    }
}

/** cursorDiskKV 读 key（Cursor 的另一个 kv 表），找不到返回 null。 */
function readKv(db, key) {
    try {
        const stmt = db.prepare("SELECT value FROM cursorDiskKV WHERE key = :k");
        stmt.bind({ ":k": key });
        let value = null;
        if (stmt.step()) {
            const row = stmt.get();
            if (row && row[0] != null) {
                if (row[0] instanceof Uint8Array) {
                    value = Buffer.from(row[0]).toString("utf-8");
                } else {
                    value = String(row[0]);
                }
            }
        }
        stmt.free();
        if (value == null) return null;
        const trimmed = value.trim();
        return trimmed === "" ? null : trimmed;
    } catch {
        return null;
    }
}

/** 扫描 cursorDiskKV 里的 composerData:{uuid}；返回 [{key, value(JSON)}, ...]。 */
function scanComposerEntries(db, maxRows = 200) {
    const out = [];
    try {
        const stmt = db.prepare(
            "SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%' LIMIT :lim"
        );
        stmt.bind({ ":lim": maxRows });
        while (stmt.step()) {
            const row = stmt.get();
            if (!row) continue;
            const key = row[0] != null ? String(row[0]) : "";
            let valStr = "";
            const raw = row[1];
            if (raw instanceof Uint8Array) {
                valStr = Buffer.from(raw).toString("utf-8");
            } else if (raw != null) {
                valStr = String(raw);
            }
            if (!key || !valStr) continue;
            let parsed = null;
            try {
                parsed = JSON.parse(valStr);
            } catch {
                parsed = null;
            }
            out.push({ key, value: parsed, raw: valStr });
        }
        stmt.free();
    } catch {
        // ignore
    }
    return out;
}

/** 从 JWT accessToken payload 里取 WorkOS user id（形如 "user_..."）。 */
function extractWorkosUserId(accessToken) {
    try {
        if (!accessToken || typeof accessToken !== "string") return null;
        const parts = accessToken.split(".");
        if (parts.length < 2) return null;
        let payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const pad = payloadB64.length % 4;
        if (pad === 2) payloadB64 += "==";
        else if (pad === 3) payloadB64 += "=";
        const decoded = Buffer.from(payloadB64, "base64").toString("utf-8");
        const obj = JSON.parse(decoded);
        const sub = typeof obj.sub === "string" ? obj.sub : null;
        if (!sub) return null;
        const last = sub.includes("|") ? sub.split("|").pop() : sub;
        if (last && last.startsWith("user_")) return last;
        return null;
    } catch {
        return null;
    }
}

/** 把 accessToken + WorkOS ID 拼成 Cursor dashboard 侧需要的 Cookie。 */
function buildSessionCookie(accessToken) {
    const userId = extractWorkosUserId(accessToken);
    if (!userId) return null;
    return `WorkosCursorSessionToken=${userId}%3A%3A${accessToken}`;
}

/**
 * 从 state.vscdb 读出 Cursor 当前登录状态（accessToken / email 等）。
 * - 未找到/未登录返回 { ok: false, reason }。
 * - 找到返回 { ok: true, accessToken, refreshToken, email, membershipType, ..., dbPath, workosId }。
 */
async function readCursorAuth(dbPathOverride) {
    try {
        const { db, dbPath } = await openStateDb(dbPathOverride);
        try {
            const accessToken = readItem(db, "cursorAuth/accessToken");
            if (!accessToken) {
                return { ok: false, reason: "未在 state.vscdb 中找到 cursorAuth/accessToken（Cursor 可能未登录）", dbPath };
            }
            const email =
                readItem(db, "cursorAuth/cachedEmail") ||
                readItem(db, "cursorAuth/email") ||
                null;
            const refreshToken = readItem(db, "cursorAuth/refreshToken");
            const membershipType =
                readItem(db, "cursorAuth/stripeMembershipType") ||
                readItem(db, "cursorAuth/cachedMembershipType");
            const subscriptionStatus = readItem(
                db,
                "cursorAuth/stripeSubscriptionStatus"
            );
            const signUpType = readItem(db, "cursorAuth/cachedSignUpType");
            const authId = readItem(db, "cursorAuth/authId");
            const workosId = extractWorkosUserId(accessToken);
            return {
                ok: true,
                accessToken,
                refreshToken,
                email,
                membershipType,
                subscriptionStatus,
                signUpType,
                authId,
                workosId,
                dbPath,
            };
        } finally {
            try { db.close(); } catch { /* ignore */ }
        }
    } catch (e) {
        if (e && e.code === "STATE_DB_NOT_FOUND") {
            return { ok: false, reason: e.message, dbPath: e.dbPath };
        }
        return { ok: false, reason: String(e && e.message ? e.message : e) };
    }
}

/** 估算文本 token 数（近似）：ASCII 字符权重 0.25 token/char，CJK/Emoji 1 token/char，其他 0.5 token/char。 */
function approxTokenCount(text) {
    if (!text || typeof text !== "string") return 0;
    let total = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code >= 0x4e00 && code <= 0x9fff) total += 1;       // CJK 统一
        else if (code >= 0x3040 && code <= 0x30ff) total += 1;  // 日文假名
        else if (code >= 0xac00 && code <= 0xd7af) total += 1;  // 韩文
        else if (code >= 0x20 && code <= 0x7e) total += 0.25;   // 可打印 ASCII
        else total += 0.5;
    }
    return Math.max(1, Math.round(total));
}

/**
 * 从本地 state.vscdb 的 composerData:* 粗估历史对话规模，用于首次展示。
 * 返回：{ events: [{date, model, tokens, projectLabel}], modelTotals: {...}, range }。
 */
async function readLocalComposerUsage(dbPathOverride, options = {}) {
    const maxRows = Number.isFinite(options.maxRows) ? options.maxRows : 200;
    try {
        const { db, dbPath } = await openStateDb(dbPathOverride);
        try {
            const entries = scanComposerEntries(db, maxRows);
            const events = [];
            const modelTotals = {};
            let rangeStart = Number.POSITIVE_INFINITY;
            let rangeEnd = Number.NEGATIVE_INFINITY;

            // 递归找 object 里合理长度的字符串文本
            const TEXT_KEYS = new Set([
                "text", "content", "body", "value", "prompt", "message",
                "title", "promptTitle", "description",
            ]);
            const collectTexts = (node, acc, depth) => {
                if (!node || depth > 5 || acc.totalLen > 120000) return;
                if (typeof node === "string") {
                    if (node.length >= 8 && node.length < 40000) {
                        acc.parts.push(node);
                        acc.totalLen += node.length;
                    }
                    return;
                }
                if (Array.isArray(node)) {
                    for (const item of node) collectTexts(item, acc, depth + 1);
                    return;
                }
                if (typeof node === "object") {
                    for (const [k, v] of Object.entries(node)) {
                        if (typeof v === "string" && TEXT_KEYS.has(k)) {
                            if (v.length >= 4 && v.length < 40000) {
                                acc.parts.push(v);
                                acc.totalLen += v.length;
                            }
                        } else if (v && (typeof v === "object" || Array.isArray(v))) {
                            collectTexts(v, acc, depth + 1);
                        }
                    }
                }
            };
            const findModel = (node, depth) => {
                if (!node || depth > 4) return null;
                if (typeof node === "object") {
                    if (typeof node.model === "string" && node.model) return node.model;
                    if (typeof node.lastModel === "string" && node.lastModel) return node.lastModel;
                    if (typeof node.currentModel === "string" && node.currentModel) return node.currentModel;
                    if (typeof node.selectedModel === "string" && node.selectedModel) return node.selectedModel;
                    const iter = Array.isArray(node) ? node : Object.values(node);
                    for (const v of iter) {
                        const r = findModel(v, depth + 1);
                        if (r) return r;
                    }
                }
                return null;
            };
            const findTimestamp = (node, depth) => {
                if (!node || depth > 4) return null;
                if (typeof node === "object") {
                    const candidates = ["updatedAt", "createdAt", "lastUpdatedAt", "timestamp"];
                    for (const key of candidates) {
                        const raw = node[key];
                        if (Number.isFinite(raw)) {
                            return raw > 1e12 ? Math.floor(raw / 1000) : Number(raw);
                        }
                    }
                    const iter = Array.isArray(node) ? node : Object.values(node);
                    for (const v of iter) {
                        const r = findTimestamp(v, depth + 1);
                        if (r) return r;
                    }
                }
                return null;
            };

            for (const it of entries) {
                const v = it.value && typeof it.value === "object" ? it.value : null;
                if (!v) continue;
                const model = findModel(v, 0) || "unknown";
                const ts = findTimestamp(v, 0);
                const timestamp = ts || Math.floor(Date.now() / 1000);
                const acc = { parts: [], totalLen: 0 };
                collectTexts(v, acc, 0);
                if (acc.totalLen === 0) continue;
                const textBody = acc.parts.join("\n");
                const approx = approxTokenCount(textBody);
                const evt = {
                    date: timestamp,
                    model,
                    tokens: approx,
                    key: it.key,
                };
                events.push(evt);
                if (!modelTotals[model]) modelTotals[model] = { tokens: 0, count: 0 };
                modelTotals[model].tokens += approx;
                modelTotals[model].count += 1;
                if (ts) {
                    if (ts < rangeStart) rangeStart = ts;
                    if (ts > rangeEnd) rangeEnd = ts;
                }
            }

            return {
                ok: true,
                dbPath,
                events,
                modelTotals,
                rangeStart: Number.isFinite(rangeStart) ? rangeStart : null,
                rangeEnd: Number.isFinite(rangeEnd) ? rangeEnd : null,
                totalScanned: entries.length,
                totalWithText: events.length,
            };
        } finally {
            try { db.close(); } catch { /* ignore */ }
        }
    } catch (e) {
        if (e && e.code === "STATE_DB_NOT_FOUND") {
            return { ok: false, reason: e.message, dbPath: e.dbPath, events: [], modelTotals: {} };
        }
        return {
            ok: false,
            reason: String(e && e.message ? e.message : e),
            events: [],
            modelTotals: {},
        };
    }
}

module.exports = {
    getDefaultCursorDataDir,
    getDefaultStateDbPath,
    readCursorAuth,
    readLocalComposerUsage,
    extractWorkosUserId,
    buildSessionCookie,
    approxTokenCount,
};
