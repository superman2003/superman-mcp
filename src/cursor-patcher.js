"use strict";
/**
 * Cursor 会员类型补丁模块（Node 版）。
 *
 * 对应原 Python 项目的 `src/core/patcher.py`：在 Cursor 的
 * `resources/app/out/vs/workbench/workbench.desktop.main.js` 中注入一段
 * `r="<membership>"`，从而改变编辑器显示的会员类型。
 *
 * 所有公开方法返回纯数据对象，便于在 VSCode 扩展侧序列化后发到 Webview。
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const RELATIVE_JS_PATH = [
    "resources",
    "app",
    "out",
    "vs",
    "workbench",
    "workbench.desktop.main.js",
];

const JS_FILE_NAME = "workbench.desktop.main.js";

const ORIGINAL_SNIPPET = "r=r??Pa.FREE,";
const PATCH_MARKER = "/*__cursor_membership_patch__*/";

/**
 * 自定义会员类型允许的字符集：字母、数字、空格、加减点下划线、中文。
 * 之所以必须严格限制：`applyPatch` 会把 value 直接拼入 `r="${value}";` 这段 JS，
 * 若 value 含 `"` `\\` `\n` 等，会破坏 workbench.desktop.main.js 的语法，
 * 导致 Cursor 无法启动，甚至注入任意 JS。
 */
const MEMBERSHIP_VALUE_RE = /^[\w \u4e00-\u9fff+\-.\u00B7]{1,64}$/;

const MEMBERSHIP_TYPES = {
    free: "Free",
    free_trial: "Free Trial",
    pro: "Pro",
    pro_plus: "Pro+",
    ultra: "Ultra",
    enterprise: "Enterprise",
    custom: "自定义",
};

const BACKUP_DIR = path.join(
    process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
    "CursorMembershipSwitcher"
);
const BACKUP_PATH = path.join(BACKUP_DIR, `${JS_FILE_NAME}.bak`);

/** 把 Cursor.exe 路径映射到 workbench js 路径。 */
function jsPathFromExe(exePath) {
    try {
        if (!exePath) return null;
        const installDir = path.dirname(exePath);
        return path.join(installDir, ...RELATIVE_JS_PATH);
    } catch {
        return null;
    }
}

function defaultInstallCandidates() {
    const localAppData =
        process.env.LOCALAPPDATA ||
        path.join(os.homedir(), "AppData", "Local");
    const candidates = [
        path.join(localAppData, "Programs", "cursor", ...RELATIVE_JS_PATH),
        path.join(localAppData, "Programs", "Cursor", ...RELATIVE_JS_PATH),
        path.join("C:/", "Program Files", "Cursor", ...RELATIVE_JS_PATH),
        path.join("C:/", "Program Files (x86)", "Cursor", ...RELATIVE_JS_PATH),
    ];
    const seen = new Set();
    return candidates.filter((p) => {
        if (seen.has(p)) return false;
        seen.add(p);
        return true;
    });
}

function isFile(p) {
    try {
        return fs.statSync(p).isFile();
    } catch {
        return false;
    }
}

/**
 * 深度受限的 workbench.desktop.main.js 搜索。
 *
 * 注意：从 `<Programs>/cursor/resources/app/out/vs/workbench/workbench.desktop.main.js`
 * 算起，目标文件相对 `<Programs>` 深度为 7；`<Program Files>/Cursor/...` 为 6。
 * 默认 maxDepth 必须 ≥ 7 才能可靠地命中标准安装。
 */
function safeSearch(root, maxDepth = 8) {
    const out = [];
    if (!root) return out;
    try {
        if (!fs.existsSync(root)) return out;
    } catch {
        return out;
    }

    const walk = (dir, depth) => {
        if (depth > maxDepth) return;
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            let full;
            try {
                full = path.join(dir, entry.name);
            } catch {
                continue;
            }
            try {
                if (entry.isSymbolicLink()) continue;
                if (entry.isDirectory()) {
                    walk(full, depth + 1);
                } else if (entry.isFile() && entry.name === JS_FILE_NAME) {
                    out.push(full);
                }
            } catch {
                continue;
            }
        }
    };

    walk(root, 0);
    return out;
}

async function findFromRunningProcess() {
    if (process.platform !== "win32") return null;
    let psutil;
    try {
        const { execFile } = require("child_process");
        return await new Promise((resolve) => {
            execFile(
                "powershell.exe",
                [
                    "-NoProfile",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-Command",
                    "Get-Process -Name cursor -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path -Unique",
                ],
                { windowsHide: true, timeout: 6000 },
                (err, stdout) => {
                    if (err || !stdout) {
                        resolve(null);
                        return;
                    }
                    const lines = String(stdout)
                        .split(/\r?\n/)
                        .map((s) => s.trim())
                        .filter(Boolean);
                    for (const line of lines) {
                        const js = jsPathFromExe(line);
                        if (js && isFile(js)) {
                            resolve(js);
                            return;
                        }
                    }
                    resolve(null);
                }
            );
        });
    } catch {
        return null;
    }
}

/** 快速查找：进程 + 默认路径。 */
async function findCursorJsPathQuick() {
    const running = await findFromRunningProcess();
    if (running) return running;
    for (const p of defaultInstallCandidates()) {
        if (isFile(p)) return p;
    }
    return null;
}

/** 完整搜索：进程 + 默认 + 常见目录浅扫。 */
async function searchCursorInstallations() {
    const results = [];
    const pushUnique = (p) => {
        if (p && !results.includes(p)) results.push(p);
    };

    const running = await findFromRunningProcess();
    pushUnique(running);

    for (const p of defaultInstallCandidates()) {
        if (isFile(p)) pushUnique(p);
    }

    const localAppData =
        process.env.LOCALAPPDATA ||
        path.join(os.homedir(), "AppData", "Local");
    const home = os.homedir();
    const roots = [
        path.join(localAppData, "Programs"),
        "C:/Program Files",
        "C:/Program Files (x86)",
        path.join(home, "AppData", "Local", "Programs"),
        path.join(home, "AppData", "Local"),
    ];
    for (const root of roots) {
        for (const hit of safeSearch(root, 8)) pushUnique(hit);
    }

    results.sort((a, b) => {
        if (running && a === running) return -1;
        if (running && b === running) return 1;
        return a.length - b.length;
    });
    return results;
}

function readJs(jsPath) {
    return fs.readFileSync(jsPath, "utf8");
}

/**
 * 原子写入 workbench.desktop.main.js：
 *   1. 先把内容写到同目录的 `.tmp-<pid>-<ts>` 临时文件
 *   2. 再用 `fs.renameSync` 原子替换目标文件
 *
 * 为什么必须原子：workbench.desktop.main.js 常年 >5 MB，非原子 writeFileSync 期间
 * 若进程被杀/断电，会在磁盘上留下截断的半写入文件，导致 Cursor 无法启动。
 * rename 在同一分区上是 POSIX/Win32 原子操作，能保证「要么旧文件，要么新文件」。
 */
function writeJs(jsPath, content) {
    const dir = path.dirname(jsPath);
    const tmp = path.join(
        dir,
        `.${path.basename(jsPath)}.tmp-${process.pid}-${Date.now()}`
    );
    let tmpWritten = false;
    try {
        fs.writeFileSync(tmp, content, "utf8");
        tmpWritten = true;
        fs.renameSync(tmp, jsPath);
    } catch (e) {
        if (tmpWritten) {
            try { fs.unlinkSync(tmp); } catch { /* ignore */ }
        }
        throw e;
    }
}

function ensureBackupDir() {
    if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
}

function createBackupIfMissing(jsPath) {
    ensureBackupDir();
    if (!fs.existsSync(BACKUP_PATH)) {
        fs.copyFileSync(jsPath, BACKUP_PATH);
        return true;
    }
    return false;
}

function restoreBackup(jsPath) {
    if (!fs.existsSync(BACKUP_PATH)) return false;
    fs.copyFileSync(BACKUP_PATH, jsPath);
    return true;
}

function detectPatchedType(content) {
    const re = new RegExp(
        escapeRegex(PATCH_MARKER) + "r=\"([^\"]+)\";"
    );
    const m = content.match(re);
    return m ? m[1] : null;
}

function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 校验 jsPath 指向的确实是 workbench.desktop.main.js，防止被误导去写别的文件。
 * 返回规范化后的绝对路径；若校验失败返回 null。
 */
function sanitizeJsPath(jsPath) {
    if (typeof jsPath !== "string" || !jsPath.trim()) return null;
    let resolved;
    try {
        resolved = path.resolve(jsPath.trim());
    } catch {
        return null;
    }
    if (path.basename(resolved).toLowerCase() !== JS_FILE_NAME.toLowerCase()) {
        return null;
    }
    if (!isFile(resolved)) return null;
    return resolved;
}

/** 从当前（已打过补丁的）内容中移除补丁行，反推出原始内容，用于补建备份。 */
function stripPatchFromContent(content) {
    const re = new RegExp(
        escapeRegex(PATCH_MARKER) + "r=\"[^\"]*\";",
        "g"
    );
    return content.replace(re, "");
}

function getPatchStatus(jsPath) {
    try {
        const safe = sanitizeJsPath(jsPath);
        if (!safe) {
            return {
                isPatched: false,
                membershipType: null,
                hasBackup: fs.existsSync(BACKUP_PATH),
                error: jsPath ? "JS 路径无效或不是 workbench.desktop.main.js" : "JS file not found",
            };
        }
        const content = readJs(safe);
        const patchedType = detectPatchedType(content);
        return {
            isPatched: patchedType !== null,
            membershipType: patchedType,
            hasBackup: fs.existsSync(BACKUP_PATH),
        };
    } catch (e) {
        return {
            isPatched: false,
            membershipType: null,
            hasBackup: fs.existsSync(BACKUP_PATH),
            error: String(e && e.message ? e.message : e),
        };
    }
}

function applyPatch(jsPath, membershipType) {
    try {
        const safe = sanitizeJsPath(jsPath);
        if (!safe) {
            return { ok: false, message: "未找到 Cursor JS 文件，或路径不是 workbench.desktop.main.js" };
        }
        if (membershipType == null || !String(membershipType).trim()) {
            return { ok: false, message: "会员类型不能为空" };
        }
        const value = String(membershipType).trim();
        if (!MEMBERSHIP_VALUE_RE.test(value)) {
            return {
                ok: false,
                message: "会员类型含不允许的字符（只允许字母、数字、中文、空格、+-._·，最多 64 字符）",
            };
        }
        const content = readJs(safe);
        const current = detectPatchedType(content);
        const patchLine = `${PATCH_MARKER}r="${value}";`;

        if (current !== null) {
            if (current === value) {
                return {
                    ok: true,
                    message: `会员类型已是 '${value}'，无需修改`,
                    membershipType: value,
                };
            }
            const re = new RegExp(
                escapeRegex(PATCH_MARKER) + "r=\"[^\"]*\";",
                ""
            );
            const updated = content.replace(re, patchLine);
            if (updated === content) {
                return { ok: false, message: "补丁更新失败：未能替换已有补丁值" };
            }
            // 若用户曾删除过备份（或升级后首次切换），尝试从当前内容反推原版补建备份
            if (!fs.existsSync(BACKUP_PATH)) {
                try {
                    ensureBackupDir();
                    fs.writeFileSync(BACKUP_PATH, stripPatchFromContent(content), "utf8");
                } catch { /* 备份失败不阻塞主流程 */ }
            }
            writeJs(safe, updated);
            return {
                ok: true,
                message: `成功切换为 '${value}'`,
                membershipType: value,
            };
        }

        if (!content.includes(ORIGINAL_SNIPPET)) {
            return {
                ok: false,
                message:
                    "未找到原始补丁锚点，Cursor 版本可能已升级，" +
                    `请更新 ORIGINAL_SNIPPET（当前：${ORIGINAL_SNIPPET}）`,
            };
        }
        createBackupIfMissing(safe);
        const updated = content.replace(
            ORIGINAL_SNIPPET,
            patchLine + ORIGINAL_SNIPPET
        );
        if (updated === content) {
            return { ok: false, message: "补丁未生效：字符串替换没有产生变化" };
        }
        writeJs(safe, updated);
        return {
            ok: true,
            message: `成功补丁：会员类型设置为 '${value}'`,
            membershipType: value,
        };
    } catch (e) {
        return {
            ok: false,
            message: `补丁失败：${e && e.message ? e.message : e}`,
        };
    }
}

function restorePatch(jsPath) {
    try {
        const safe = sanitizeJsPath(jsPath);
        if (!safe) {
            return { ok: false, message: "未找到 Cursor JS 文件，或路径不是 workbench.desktop.main.js" };
        }
        if (fs.existsSync(BACKUP_PATH)) {
            if (!restoreBackup(safe)) {
                return { ok: false, message: "恢复失败" };
            }
            return { ok: true, message: "成功恢复原始文件（来自备份）" };
        }
        // 备份丢失时的兜底：直接把当前文件内的补丁行移除
        const content = readJs(safe);
        if (detectPatchedType(content) === null) {
            return { ok: true, message: "文件未被补丁，无需恢复" };
        }
        const stripped = stripPatchFromContent(content);
        if (stripped === content) {
            return { ok: false, message: "未找到备份且无法从当前文件剥离补丁" };
        }
        writeJs(safe, stripped);
        return {
            ok: true,
            message: "备份不存在，已从当前文件移除补丁标记（若 Cursor 已升级导致异常，建议重装 Cursor）",
        };
    } catch (e) {
        return {
            ok: false,
            message: `恢复失败：${e && e.message ? e.message : e}`,
        };
    }
}

function isCursorRunningSync() {
    if (process.platform !== "win32") return false;
    try {
        const { spawnSync } = require("child_process");
        const r = spawnSync(
            "tasklist",
            ["/FI", "IMAGENAME eq Cursor.exe", "/FO", "CSV", "/NH"],
            { encoding: "utf8", windowsHide: true }
        );
        const out = (r.stdout || "").toLowerCase();
        return out.includes("cursor.exe");
    } catch {
        return false;
    }
}

function closeCursor() {
    if (process.platform !== "win32") return false;
    try {
        const { spawnSync } = require("child_process");
        spawnSync("taskkill", ["/F", "/IM", "Cursor.exe"], {
            windowsHide: true,
        });
        return true;
    } catch {
        return false;
    }
}

/**
 * 从 workbench.desktop.main.js 的路径反推 Cursor 安装根目录。
 *
 * 目录布局为：
 *   <安装根>/resources/app/out/vs/workbench/workbench.desktop.main.js
 * 从 JS 文件到安装根需要 6 次 dirname；Cursor.exe 就在安装根下、与 `resources` 同级。
 */
function installRootFromJs(jsPath) {
    if (!jsPath) return null;
    try {
        let dir = jsPath;
        for (let i = 0; i < 6; i++) dir = path.dirname(dir);
        return dir;
    } catch {
        return null;
    }
}

function resolveCursorExe(jsPath) {
    const candidates = [];
    const root = installRootFromJs(jsPath);
    if (root) {
        candidates.push(path.join(root, "Cursor.exe"));
        candidates.push(path.join(root, "cursor.exe"));
    }
    const localAppData =
        process.env.LOCALAPPDATA ||
        path.join(os.homedir(), "AppData", "Local");
    candidates.push(path.join(localAppData, "Programs", "cursor", "Cursor.exe"));
    candidates.push(path.join(localAppData, "Programs", "Cursor", "Cursor.exe"));
    candidates.push("C:/Program Files/Cursor/Cursor.exe");
    candidates.push("C:/Program Files (x86)/Cursor/Cursor.exe");
    const seen = new Set();
    for (const exe of candidates) {
        if (!exe || seen.has(exe)) continue;
        seen.add(exe);
        try {
            if (fs.existsSync(exe)) return exe;
        } catch {
            continue;
        }
    }
    return null;
}

function startCursor(jsPath) {
    const { spawn } = require("child_process");
    const exe = resolveCursorExe(jsPath);
    if (exe) {
        try {
            spawn(exe, [], { detached: true, stdio: "ignore" }).unref();
            return { ok: true, exe };
        } catch (e) {
            return { ok: false, message: String(e && e.message ? e.message : e) };
        }
    }
    try {
        spawn("cursor", [], { detached: true, stdio: "ignore", shell: true }).unref();
        return { ok: true, exe: "cursor" };
    } catch (e) {
        return { ok: false, message: String(e && e.message ? e.message : e) };
    }
}

/**
 * 启动一个独立的 detached PowerShell 进程，延迟一会儿再 kill 所有 Cursor 进程
 * 并重新启动 Cursor。
 *
 * 之所以必须用外部进程：本扩展自己就运行在 Cursor 的 Extension Host 子进程里，
 * 一旦同步 taskkill /F /IM Cursor.exe，扩展进程会跟着被杀，后续的
 * applyPatch/startCursor 就不会执行。把 kill+restart 交给一个独立的 PowerShell
 * 进程后，即便扩展自身被杀，外部进程仍然会完成重启。
 *
 * @param {string|null} jsPath   workbench.desktop.main.js 路径（用来推断 Cursor.exe）
 * @param {number} [delayMs]     延迟多少毫秒再 kill（给 UI 返回反馈的时间）
 * @returns {{ok: boolean, exe?: string|null, message?: string}}
 */
function scheduleRestartCursor(jsPath, delayMs = 1500) {
    if (process.platform !== "win32") {
        return { ok: false, message: "仅支持 Windows" };
    }
    try {
        const { spawn } = require("child_process");
        const delayMsInt = Math.max(500, Math.floor(Number(delayMs) || 1500));
        const cursorExe = resolveCursorExe(jsPath);

        // PowerShell 单引号字面量不展开 $xxx；路径中的单引号要成对 '' 转义
        const psSingle = (s) => `'${String(s).replace(/'/g, "''")}'`;
        const startLine = cursorExe
            ? `Start-Process -FilePath ${psSingle(cursorExe)}`
            : `Start-Process -FilePath 'cursor'`;

        const psScript = [
            `Start-Sleep -Milliseconds ${delayMsInt}`,
            // 先用 taskkill（能杀 UI 全家桶），再兜底 Stop-Process 清残留
            `cmd /c "taskkill /F /IM Cursor.exe >NUL 2>&1"`,
            `Get-Process -Name Cursor -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue`,
            `Start-Sleep -Milliseconds 800`,
            startLine,
        ].join("; ");

        const child = spawn(
            "powershell.exe",
            [
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-WindowStyle",
                "Hidden",
                "-Command",
                psScript,
            ],
            {
                detached: true,
                stdio: "ignore",
                windowsHide: true,
            }
        );
        // 兜住 spawn 的异步错误（例如找不到 powershell.exe），避免扩展宿主崩溃
        child.on("error", () => { /* 此时扩展已返回 ok，外部重启按钮会失效，仅静默 */ });
        child.unref();
        return { ok: true, exe: cursorExe || null };
    } catch (e) {
        return {
            ok: false,
            message: String(e && e.message ? e.message : e),
        };
    }
}

module.exports = {
    MEMBERSHIP_TYPES,
    ORIGINAL_SNIPPET,
    PATCH_MARKER,
    BACKUP_PATH,
    findCursorJsPathQuick,
    searchCursorInstallations,
    getPatchStatus,
    applyPatch,
    restorePatch,
    isCursorRunningSync,
    closeCursor,
    startCursor,
    scheduleRestartCursor,
};
