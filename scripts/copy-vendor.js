#!/usr/bin/env node
/**
 * 把 vsix 打包需要的第三方 vendor 文件从 node_modules 拷贝到 dist/vendor。
 *
 * 背景：项目的 .vscodeignore 排除了整个 node_modules/**，且 vsce package 使用
 * --no-dependencies。要让 sql.js 在插件运行时可用，必须把 sql-wasm.js 与
 * sql-wasm.wasm 一起打包进 dist/。
 */

"use strict";

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const distDir = path.join(repoRoot, "dist");
const vendorDir = path.join(distDir, "vendor");
const sqlJsDir = path.join(vendorDir, "sql.js");

const filesToCopy = [
  {
    from: path.join(repoRoot, "node_modules", "sql.js", "dist", "sql-wasm.js"),
    to: path.join(sqlJsDir, "sql-wasm.js"),
  },
  {
    from: path.join(repoRoot, "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
    to: path.join(sqlJsDir, "sql-wasm.wasm"),
  },
];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyOne({ from, to }) {
  if (!fs.existsSync(from)) {
    console.error(`[copy-vendor] 缺少源文件: ${from}`);
    process.exit(1);
  }
  ensureDir(path.dirname(to));
  fs.copyFileSync(from, to);
  const bytes = fs.statSync(to).size;
  const kb = (bytes / 1024).toFixed(1);
  console.log(`[copy-vendor] ${path.relative(repoRoot, from)} -> ${path.relative(repoRoot, to)} (${kb} KB)`);
}

function main() {
  ensureDir(distDir);
  for (const item of filesToCopy) copyOne(item);
  console.log("[copy-vendor] done.");
}

main();
