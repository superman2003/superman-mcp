"use strict";
/**
 * Cursor 官方账单/用量接口客户端 + CSV 解析 + 聚合。
 *
 * 参考：
 *   - https://cursor.com/api/usage-summary              （JSON 摘要）
 *   - https://cursor.com/api/dashboard/export-usage-events-csv?strategy=tokens （CSV 明细）
 *   - https://api2.cursor.sh/aiserver.v1.AuthService/GetUserMeta          （用户资料）
 *   - https://api2.cursor.sh/auth/full_stripe_profile | /auth/stripe_profile （订阅）
 *
 * 所有请求都用 Node 内置 https，不依赖额外 npm 包。
 */

const https = require("https");
const { URL } = require("url");

const {
    extractWorkosUserId,
    buildSessionCookie,
} = require("./cursor-state-reader");

const DEFAULT_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";

function httpRequestOnce({ method, url, headers, body, timeoutMs = 20000 }) {
    return new Promise((resolve, reject) => {
        let parsed;
        try {
            parsed = new URL(url);
        } catch (e) {
            reject(new Error("URL 无效: " + url));
            return;
        }
        const hdrs = Object.assign(
            {
                "User-Agent": DEFAULT_UA,
                "Accept": "application/json",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
                "Connection": "close",
            },
            headers || {}
        );
        const opts = {
            method,
            hostname: parsed.hostname,
            port: parsed.port || 443,
            path: parsed.pathname + (parsed.search || ""),
            headers: hdrs,
            servername: parsed.hostname, // 确保 SNI 正确
        };
        const req = https.request(opts, (res) => {
            const chunks = [];
            res.on("data", (d) => chunks.push(d));
            res.on("end", () => {
                const buf = Buffer.concat(chunks);
                resolve({
                    statusCode: res.statusCode || 0,
                    headers: res.headers,
                    body: buf,
                    text: buf.toString("utf-8"),
                });
            });
        });
        req.on("error", (e) => reject(e));
        if (timeoutMs > 0) {
            req.setTimeout(timeoutMs, () => {
                req.destroy(new Error("请求超时"));
            });
        }
        if (body != null) {
            if (Buffer.isBuffer(body)) req.write(body);
            else req.write(String(body));
        }
        req.end();
    });
}

/** 带 1 次重试的 httpRequest（应对偶发 TLS 断连）。 */
async function httpRequest(opt) {
    try {
        return await httpRequestOnce(opt);
    } catch (e) {
        const msg = String(e && e.message ? e.message : e);
        if (/TLS|socket|ECONN|EAI_AGAIN|超时/i.test(msg)) {
            await new Promise((r) => setTimeout(r, 400));
            return await httpRequestOnce(opt);
        }
        throw e;
    }
}

/** 用户资料 */
async function fetchUserMeta(accessToken) {
    const res = await httpRequest({
        method: "POST",
        url: "https://api2.cursor.sh/aiserver.v1.AuthService/GetUserMeta",
        headers: {
            "Authorization": "Bearer " + accessToken,
            "Content-Type": "application/json",
        },
        body: "{}",
    });
    if (res.statusCode === 401 || res.statusCode === 403) {
        throw new Error("accessToken 无效或已过期");
    }
    if (res.statusCode !== 200) {
        throw new Error("GetUserMeta 返回状态码 " + res.statusCode);
    }
    try {
        return JSON.parse(res.text);
    } catch (e) {
        throw new Error("GetUserMeta 响应无法解析 JSON：" + e.message);
    }
}

/** 订阅信息（full_stripe_profile 失败时回退 stripe_profile） */
async function fetchStripeProfile(accessToken) {
    const tryUrl = async (url) =>
        httpRequest({
            method: "GET",
            url,
            headers: {
                "Authorization": "Bearer " + accessToken,
            },
        });
    let res = await tryUrl("https://api2.cursor.sh/auth/full_stripe_profile");
    if (res.statusCode === 401 || res.statusCode === 403) {
        throw new Error("accessToken 无效或已过期");
    }
    if (res.statusCode !== 200) {
        res = await tryUrl("https://api2.cursor.sh/auth/stripe_profile");
        if (res.statusCode === 401 || res.statusCode === 403) {
            throw new Error("accessToken 无效或已过期");
        }
        if (res.statusCode !== 200) return null;
    }
    try {
        return JSON.parse(res.text);
    } catch {
        return null;
    }
}

/** 用量摘要（JSON） */
async function fetchUsageSummary(accessToken) {
    const cookie = buildSessionCookie(accessToken);
    if (!cookie) throw new Error("无法从 accessToken 解析 WorkOS 用户 ID");
    const res = await httpRequest({
        method: "GET",
        url: "https://cursor.com/api/usage-summary",
        headers: {
            "Cookie": cookie,
        },
    });
    if (res.statusCode === 401 || res.statusCode === 403) {
        throw new Error("accessToken 无效或已过期");
    }
    if (res.statusCode !== 200) {
        throw new Error("usage-summary 返回状态码 " + res.statusCode);
    }
    try {
        return JSON.parse(res.text);
    } catch (e) {
        throw new Error("usage-summary 响应无法解析 JSON：" + e.message);
    }
}

/** 用量明细 CSV（字符串） */
async function fetchUsageEventsCsv(accessToken) {
    const cookie = buildSessionCookie(accessToken);
    if (!cookie) throw new Error("无法从 accessToken 解析 WorkOS 用户 ID");
    const res = await httpRequest({
        method: "GET",
        url: "https://cursor.com/api/dashboard/export-usage-events-csv?strategy=tokens",
        headers: {
            "Cookie": cookie,
            "Accept": "text/csv,*/*",
        },
        timeoutMs: 30000,
    });
    if (res.statusCode === 401 || res.statusCode === 403) {
        throw new Error("accessToken 无效或已过期");
    }
    if (res.statusCode !== 200) {
        throw new Error("export-usage-events-csv 返回状态码 " + res.statusCode);
    }
    return res.text;
}

// ---------------------------------------------------------------------------
// CSV 解析（RFC4180 子集：支持双引号转义、\r\n / \n、引号中的逗号）
// ---------------------------------------------------------------------------

function parseCsv(text) {
    const out = [];
    if (!text) return out;
    // 去 BOM
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    let i = 0;
    const n = text.length;
    let field = "";
    let row = [];
    let inQuotes = false;
    while (i < n) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (i + 1 < n && text[i + 1] === '"') {
                    field += '"';
                    i += 2;
                    continue;
                }
                inQuotes = false;
                i += 1;
                continue;
            }
            field += c;
            i += 1;
            continue;
        }
        if (c === '"') {
            inQuotes = true;
            i += 1;
            continue;
        }
        if (c === ",") {
            row.push(field);
            field = "";
            i += 1;
            continue;
        }
        if (c === "\r") {
            if (i + 1 < n && text[i + 1] === "\n") i += 1;
            row.push(field);
            field = "";
            out.push(row);
            row = [];
            i += 1;
            continue;
        }
        if (c === "\n") {
            row.push(field);
            field = "";
            out.push(row);
            row = [];
            i += 1;
            continue;
        }
        field += c;
        i += 1;
    }
    if (field.length > 0 || row.length > 0) {
        row.push(field);
        out.push(row);
    }
    // 过滤空行
    return out.filter((r) => !(r.length === 1 && r[0] === ""));
}

function normalizeHeader(h) {
    return String(h || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

function parseIntSafe(raw) {
    if (raw == null) return 0;
    const s = String(raw).trim().replace(/,/g, "");
    if (!s) return 0;
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : 0;
}

function parseCostSafe(raw) {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (!s) return null;
    if (/^included$/i.test(s)) return 0;
    const t = s.replace(/^\$/, "").replace(/,/g, "");
    const n = parseFloat(t);
    return Number.isFinite(n) ? n : null;
}

function parseTimestamp(raw) {
    if (!raw) return null;
    const d = new Date(String(raw).trim());
    if (isNaN(d.getTime())) return null;
    return Math.floor(d.getTime() / 1000);
}

/** 把 Cursor 的 usage CSV 解析成结构化 events 数组。 */
function parseUsageCsv(csvText) {
    const rows = parseCsv(csvText);
    if (rows.length === 0) return { events: [], rangeStart: null, rangeEnd: null };
    const header = rows[0].map(normalizeHeader);
    const idx = {};
    header.forEach((h, i) => {
        if (!(h in idx)) idx[h] = i;
    });
    const get = (row, name) => {
        const i = idx[name];
        if (i == null) return undefined;
        return row[i];
    };
    // 支持多个备选列名（Cursor 先后用过不同表头，例如
    //   "Input (w/ Cache Write)" → input_w_cache_write
    //   老版 API 里是          → input_with_cache_write
    // "Cost to You" / "Cost" / "API Cost" 同理）
    const getAny = (row, names) => {
        for (const n of names) {
            const v = get(row, n);
            if (v !== undefined && v !== null && String(v).trim() !== "") return v;
        }
        return undefined;
    };
    const events = [];
    let rangeStart = Number.POSITIVE_INFINITY;
    let rangeEnd = Number.NEGATIVE_INFINITY;
    for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        if (!row || row.every((v) => v == null || String(v).trim() === "")) continue;
        const ts = parseTimestamp(get(row, "date"));
        if (ts == null) continue;
        const model = String(get(row, "model") || "").trim();
        if (!model) continue;
        const kind = String(get(row, "kind") || "").trim();
        const maxMode = String(get(row, "max_mode") || "").trim();
        const inputCache = parseIntSafe(getAny(row, ["input_w_cache_write", "input_with_cache_write"]));
        const inputNoCache = parseIntSafe(getAny(row, ["input_w_o_cache_write", "input_without_cache_write"]));
        const cacheRead = parseIntSafe(get(row, "cache_read"));
        const outputTokens = parseIntSafe(get(row, "output_tokens"));
        const totalTokens = parseIntSafe(get(row, "total_tokens"));
        const costYou = parseCostSafe(get(row, "cost_to_you"));
        const costRaw = parseCostSafe(getAny(row, ["cost", "api_cost"]));
        const cost = costYou != null ? costYou : costRaw;
        const inputTokens = inputNoCache;
        const cacheCreation = inputCache;
        const sumTokens = totalTokens > 0
            ? totalTokens
            : (inputTokens + outputTokens + cacheRead + cacheCreation);
        if (sumTokens === 0 && (cost == null || cost === 0)) continue;
        events.push({
            timestamp: ts,
            date: new Date(ts * 1000).toISOString().slice(0, 10),
            kind,
            model,
            maxMode,
            inputTokens,
            cacheCreationTokens: cacheCreation,
            cacheReadTokens: cacheRead,
            outputTokens,
            totalTokens: sumTokens,
            costUsd: cost,
        });
        if (ts < rangeStart) rangeStart = ts;
        if (ts > rangeEnd) rangeEnd = ts;
    }
    return {
        events,
        rangeStart: Number.isFinite(rangeStart) ? rangeStart : null,
        rangeEnd: Number.isFinite(rangeEnd) ? rangeEnd : null,
    };
}

// ---------------------------------------------------------------------------
// 聚合：按天 / 周 / 月 / 模型 / 近 30 天
// ---------------------------------------------------------------------------

function ymdInLocal(tsSec) {
    const d = new Date(tsSec * 1000);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function ymInLocal(tsSec) {
    const d = new Date(tsSec * 1000);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
}

/** ISO 周编号（简化版：返回 YYYY-Www） */
function isoWeek(tsSec) {
    const d = new Date(tsSec * 1000);
    // 取星期一作为一周起点
    const day = (d.getDay() + 6) % 7;
    const monday = new Date(d);
    monday.setDate(d.getDate() - day);
    monday.setHours(0, 0, 0, 0);
    // 用 ISO 周算法：找到该年第一个星期四
    const tmp = new Date(monday.getFullYear(), 0, 4);
    const dayOf4 = (tmp.getDay() + 6) % 7;
    const firstMonday = new Date(tmp);
    firstMonday.setDate(tmp.getDate() - dayOf4);
    const weekNum = Math.round((monday - firstMonday) / (7 * 24 * 3600 * 1000)) + 1;
    return `${monday.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function emptyBucket() {
    return { cost: 0, tokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, events: 0 };
}

function addEventIntoBucket(b, e) {
    if (e.costUsd != null) b.cost += e.costUsd;
    b.tokens += e.totalTokens || 0;
    b.inputTokens += e.inputTokens || 0;
    b.outputTokens += e.outputTokens || 0;
    b.cacheReadTokens += e.cacheReadTokens || 0;
    b.cacheCreationTokens += e.cacheCreationTokens || 0;
    b.events += 1;
}

/** 把 events 聚合到不同粒度，返回 UI 需要的结构。 */
function aggregateEvents(events) {
    const byDay = {};
    const byWeek = {};
    const byMonth = {};
    const byModel = {};
    const total = emptyBucket();
    for (const e of events) {
        const dayKey = ymdInLocal(e.timestamp);
        const weekKey = isoWeek(e.timestamp);
        const monthKey = ymInLocal(e.timestamp);
        if (!byDay[dayKey]) byDay[dayKey] = emptyBucket();
        if (!byWeek[weekKey]) byWeek[weekKey] = emptyBucket();
        if (!byMonth[monthKey]) byMonth[monthKey] = emptyBucket();
        const model = e.model || "unknown";
        if (!byModel[model]) byModel[model] = emptyBucket();
        addEventIntoBucket(byDay[dayKey], e);
        addEventIntoBucket(byWeek[weekKey], e);
        addEventIntoBucket(byMonth[monthKey], e);
        addEventIntoBucket(byModel[model], e);
        addEventIntoBucket(total, e);
    }
    // 最近 30 天（含今天）
    const last30 = [];
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        const key = `${y}-${m}-${day}`;
        last30.push({ date: key, bucket: byDay[key] || emptyBucket() });
    }
    // 最近 7 天（含今天，按自然日）
    const last7 = last30.slice(-7);
    // 最近 24 小时（按小时桶，含当前小时）
    const last24h = [];
    const nowHour = new Date();
    nowHour.setMinutes(0, 0, 0);
    const byHour = {};
    for (const e of events) {
        const d = new Date(e.timestamp * 1000);
        d.setMinutes(0, 0, 0);
        const diff = nowHour.getTime() - d.getTime();
        if (diff < 0 || diff >= 24 * 3600 * 1000) continue;
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}`;
        if (!byHour[key]) byHour[key] = emptyBucket();
        addEventIntoBucket(byHour[key], e);
    }
    for (let i = 23; i >= 0; i--) {
        const d = new Date(nowHour.getTime() - i * 3600 * 1000);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}`;
        const label = `${String(d.getHours()).padStart(2, "0")}:00`;
        last24h.push({ date: label, fullKey: key, bucket: byHour[key] || emptyBucket() });
    }
    // 今日 / 本周 / 本月
    const todayKey = ymdInLocal(Math.floor(Date.now() / 1000));
    const weekKey = isoWeek(Math.floor(Date.now() / 1000));
    const monthKey = ymInLocal(Math.floor(Date.now() / 1000));
    return {
        total,
        today: byDay[todayKey] || emptyBucket(),
        thisWeek: byWeek[weekKey] || emptyBucket(),
        thisMonth: byMonth[monthKey] || emptyBucket(),
        byDay,
        byWeek,
        byMonth,
        byModel,
        last30,
        last7,
        last24h,
    };
}

/** 把本地 composerData 粗估结果融合到与 aggregateEvents 一致的结构里（供离线展示） */
function aggregateLocalComposer(localUsage) {
    if (!localUsage || !Array.isArray(localUsage.events)) {
        return aggregateEvents([]);
    }
    const pseudo = localUsage.events.map((e) => ({
        timestamp: e.date,
        model: e.model || "unknown",
        inputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 0,
        totalTokens: e.tokens || 0,
        costUsd: null,
    }));
    return aggregateEvents(pseudo);
}

module.exports = {
    fetchUserMeta,
    fetchStripeProfile,
    fetchUsageSummary,
    fetchUsageEventsCsv,
    parseUsageCsv,
    aggregateEvents,
    aggregateLocalComposer,
    extractWorkosUserId,
    buildSessionCookie,
};
