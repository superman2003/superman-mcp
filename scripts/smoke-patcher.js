"use strict";
/* eslint-disable */
/**
 * 简易冒烟测试：验证 dist/cursor-patcher.js 的关键行为。
 * 跑完后自动删除临时文件；不依赖真实 Cursor 安装。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const p = require("../dist/cursor-patcher.js");

let pass = 0;
let fail = 0;
const expectEq = (name, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) {
        console.log("  [OK]", name);
        pass += 1;
    } else {
        console.log("  [FAIL]", name);
        console.log("    expected:", JSON.stringify(expected));
        console.log("    actual:  ", JSON.stringify(actual));
        fail += 1;
    }
};
const expectTrue = (name, cond) => {
    if (cond) {
        console.log("  [OK]", name);
        pass += 1;
    } else {
        console.log("  [FAIL]", name);
        fail += 1;
    }
};

console.log("=== 1. sanitizeJsPath（间接）：拒绝恶意路径 ===");
expectEq(
    "非 workbench.js 文件名",
    p.applyPatch("C:/Windows/System32/notepad.exe", "pro").ok,
    false
);
expectEq(
    "空路径",
    p.applyPatch("", "pro").ok,
    false
);
expectEq(
    "null 路径",
    p.applyPatch(null, "pro").ok,
    false
);

console.log("\n=== 2. membership 白名单 ===");
const tmp = path.join(os.tmpdir(), "workbench.desktop.main.js");
const originalContent = "abc def r=r??Pa.FREE, xxx yyy";
fs.writeFileSync(tmp, originalContent, "utf8");

expectEq(
    "含双引号 -> 拒绝",
    p.applyPatch(tmp, 'pro"; alert(1); //').ok,
    false
);
expectEq(
    "含换行 -> 拒绝",
    p.applyPatch(tmp, "line1\nline2").ok,
    false
);
expectEq(
    "含反斜杠 -> 拒绝",
    p.applyPatch(tmp, "abc\\").ok,
    false
);
expectEq(
    "空字符串 -> 拒绝",
    p.applyPatch(tmp, "").ok,
    false
);
expectEq(
    "仅空白 -> 拒绝",
    p.applyPatch(tmp, "   ").ok,
    false
);
expectEq(
    "超长 100 字符 -> 拒绝",
    p.applyPatch(tmp, "x".repeat(100)).ok,
    false
);
expectEq(
    "合法 'Pro+' -> 接受",
    p.applyPatch(tmp, "Pro+").ok,
    true
);
expectTrue(
    "补丁后内容包含 Pro+",
    fs.readFileSync(tmp, "utf8").includes('r="Pro+";')
);
expectTrue(
    "中文合法（如 '专业版'）",
    p.applyPatch(tmp, "专业版").ok === true
);

console.log("\n=== 3. 幂等性：同值重复应用 ===");
// 确保当前是 Ultra
p.applyPatch(tmp, "Ultra");
const before = fs.readFileSync(tmp, "utf8");
const r = p.applyPatch(tmp, "Ultra");
expectEq("同值重复应用返回 ok=true", r.ok, true);
expectTrue("消息含'已是'字样", /已是/.test(r.message || ""));
expectEq("文件内容不变", fs.readFileSync(tmp, "utf8"), before);

console.log("\n=== 4. 备份/恢复：备份丢失也能 restore ===");
// 删除备份
if (fs.existsSync(p.BACKUP_PATH)) fs.unlinkSync(p.BACKUP_PATH);
// 此时文件仍是带补丁的 Ultra
const stat1 = p.getPatchStatus(tmp);
expectEq("补丁状态：已打补丁", stat1.isPatched, true);
expectEq("补丁状态：hasBackup=false", stat1.hasBackup, false);
// 先切换一次（应自动重建备份）
const r2 = p.applyPatch(tmp, "Pro");
expectEq("切换 Pro 成功", r2.ok, true);
expectTrue("备份被自动重建", fs.existsSync(p.BACKUP_PATH));
// 删除备份，再 restore
fs.unlinkSync(p.BACKUP_PATH);
const rb = p.restorePatch(tmp);
expectEq("无备份时 restore 仍成功（从当前文件剥离补丁）", rb.ok, true);
expectTrue(
    "剥离后不再包含补丁标记",
    !fs.readFileSync(tmp, "utf8").includes(p.PATCH_MARKER)
);

console.log("\n=== 5. getPatchStatus 对坏路径的处理 ===");
const badStat = p.getPatchStatus("not-a-valid-path.txt");
expectEq("坏路径返回 isPatched=false", badStat.isPatched, false);
expectTrue("坏路径带 error 字段", !!badStat.error);

console.log("\n=== 6. scheduleRestartCursor 参数鲁棒性 ===");
if (process.platform === "win32") {
    // 传 -1 / NaN / 非法值不应崩溃
    const s1 = p.scheduleRestartCursor("C:/nonexistent/workbench.desktop.main.js", -1);
    expectTrue("负数 delayMs 不崩溃", typeof s1.ok === "boolean");
    // 理论上 spawn powershell 会返回 ok=true，但实际 kill 不到；冒烟不验证副作用
}

// 清理
try { fs.unlinkSync(tmp); } catch {}
try { if (fs.existsSync(p.BACKUP_PATH)) fs.unlinkSync(p.BACKUP_PATH); } catch {}

console.log("\n=== 汇总 ===");
console.log(`通过 ${pass} / 失败 ${fail}`);
if (fail > 0) process.exit(1);
