"use strict";
/**
 * 短路化的 license 模块：完全去除卡密依赖。
 *
 * 保留原 `wkmcp-pjb/src/license.js` 的所有导出签名，以便 `extension.js`
 * 的现有调用不需要改动；所有校验/吊销/过期清理都被替换成 no-op，
 * 「是否激活」统一返回永久有效。
 *
 * 这样做的目的：让 Infinity助手 插件完全免卡密，一律按「已激活 · 永久」呈现。
 */

const crypto = require("crypto");

Object.defineProperty(exports, "__esModule", { value: true });

exports.DEFAULT_LICENSE_SECRET = "cursor-free-no-license-required";
exports.GLOBAL_STATE_LICENSE_KEY = "wukong.license.v1";
exports.GLOBAL_STATE_USED_NONCES_KEY = "wukong.usedLicenseNonces.v1";
exports.GLOBAL_STATE_TRIAL_UNTIL_KEY = "wukong.trialUntil.v1";
exports.GLOBAL_STATE_TRIAL_USED_KEY = "wukong.trialUsed.v1";
exports.TRIAL_DURATION_MS = 30 * 60 * 1000;
exports.MIN_LICENSE_DURATION_MS = 60 * 1000;
exports.MAX_LICENSE_DURATION_MS = 10 * 365 * 24 * 3600 * 1000;

const PERMANENT_STATUS = Object.freeze({
    ok: true,
    expiresAt: null,
    label: "已激活 · 免卡密永久版",
});

function getLicenseSecret() {
    return exports.DEFAULT_LICENSE_SECRET;
}
exports.getLicenseSecret = getLicenseSecret;

function generateLicenseToken() {
    const nonce = crypto.randomBytes(8).toString("hex");
    return `WKM1.free.${nonce}.no-auth`;
}
exports.generateLicenseToken = generateLicenseToken;

function verifyAndParseToken() {
    return { ok: true, dur: "perm", nonce: "cursor-free", durationMs: 0 };
}
exports.verifyAndParseToken = verifyAndParseToken;

function checkLicenseValidity() {
    return { valid: true, expiresAt: null, isTrial: false, dur: "perm" };
}
exports.checkLicenseValidity = checkLicenseValidity;

function formatLicenseExpiry() {
    return PERMANENT_STATUS.label;
}
exports.formatLicenseExpiry = formatLicenseExpiry;

function getLicenseStatusForWebview() {
    return { ...PERMANENT_STATUS };
}
exports.getLicenseStatusForWebview = getLicenseStatusForWebview;

async function tryActivateLicenseAsync() {
    return { ok: true, msg: "无需激活，Infinity助手 已默认启用" };
}
exports.tryActivateLicenseAsync = tryActivateLicenseAsync;

function tryActivateLicense() {
    return { ok: true, msg: "无需激活，Infinity助手 已默认启用" };
}
exports.tryActivateLicense = tryActivateLicense;

function tryStartTrial30() {
    return { ok: true, msg: "无需试用，Infinity助手 已默认启用" };
}
exports.tryStartTrial30 = tryStartTrial30;

async function clearLicenseState() {
    /* no-op：免卡密版本无需存储任何授权信息 */
}
exports.clearLicenseState = clearLicenseState;

async function clearTrialUntilState() {
    /* no-op */
}
exports.clearTrialUntilState = clearTrialUntilState;

function clearExpiredLicenseIfNeeded() {
    /* no-op：永不过期 */
}
exports.clearExpiredLicenseIfNeeded = clearExpiredLicenseIfNeeded;

function clearExpiredTrialIfNeeded() {
    /* no-op：永不过期 */
}
exports.clearExpiredTrialIfNeeded = clearExpiredTrialIfNeeded;

async function enforceCloudLicenseRevocationCheck() {
    /* no-op：不再请求云端吊销校验 */
}
exports.enforceCloudLicenseRevocationCheck = enforceCloudLicenseRevocationCheck;
