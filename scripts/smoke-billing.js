#!/usr/bin/env node
"use strict";
// Smoke test：本机跑一下 state 读取 + 接口调用，确认打通。
const reader = require("../dist/cursor-state-reader");
const billing = require("../dist/cursor-billing");

(async () => {
    console.log("=== state.vscdb 路径 ===");
    console.log(reader.getDefaultStateDbPath());

    console.log("\n=== readCursorAuth ===");
    const auth = await reader.readCursorAuth();
    if (auth.ok) {
        console.log({
            email: auth.email,
            membershipType: auth.membershipType,
            workosId: auth.workosId,
            hasAccessToken: !!auth.accessToken,
        });
    } else {
        console.log("读取失败:", auth.reason);
        process.exit(0);
    }

    console.log("\n=== 并发调接口 ===");
    const [meta, profile, summary] = await Promise.allSettled([
        billing.fetchUserMeta(auth.accessToken),
        billing.fetchStripeProfile(auth.accessToken),
        billing.fetchUsageSummary(auth.accessToken),
    ]);
    console.log("GetUserMeta:", meta.status, meta.status === "fulfilled" ? Object.keys(meta.value) : meta.reason.message);
    console.log("StripeProfile:", profile.status, profile.status === "fulfilled" ? (profile.value ? Object.keys(profile.value) : "null") : profile.reason.message);
    console.log("UsageSummary:", summary.status, summary.status === "fulfilled" ? Object.keys(summary.value) : summary.reason.message);

    console.log("\n=== 拉 CSV 并聚合 ===");
    try {
        const csv = await billing.fetchUsageEventsCsv(auth.accessToken);
        const head = csv.split(/\r?\n/).slice(0, 3).join("\n");
        console.log("CSV 前 3 行:\n" + head);
        const parsed = billing.parseUsageCsv(csv);
        const agg = billing.aggregateEvents(parsed.events);
        console.log({
            eventCount: parsed.events.length,
            today: agg.today,
            thisWeek: agg.thisWeek,
            thisMonth: agg.thisMonth,
            total: agg.total,
            modelCount: Object.keys(agg.byModel).length,
            modelSample: Object.entries(agg.byModel).slice(0, 3),
        });
    } catch (e) {
        console.log("CSV 接口失败:", e.message);
    }

    console.log("\n=== 本地 composerData 粗估 ===");
    const local = await reader.readLocalComposerUsage();
    console.log({
        ok: local.ok,
        totalScanned: local.totalScanned,
        totalWithText: local.totalWithText,
        rangeStart: local.rangeStart,
        rangeEnd: local.rangeEnd,
        sampleModels: Object.keys(local.modelTotals || {}).slice(0, 5),
    });
})();
