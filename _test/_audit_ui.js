/* 静态审计：app.js 引用的 DOM id 是否都在 index.html 里；
 * 以及是否有残留的旧 API / 未定义的全局引用。
 * 运行：node _test/_audit_ui.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");

let fails = 0;
function ok(cond, label, detail) {
  if (!cond) { fails++; console.log("  ✗ " + label + (detail ? "  → " + detail : "")); }
  else console.log("  ✓ " + label + (detail ? "  (" + detail + ")" : ""));
}

const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "style.css"), "utf8");

const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const usedIds = new Set([...app.matchAll(/\$\("([^"]+)"\)/g)].map((m) => m[1]));

console.log("[A] DOM id 配对");
const missing = [...usedIds].filter((id) => !htmlIds.has(id));
ok(missing.length === 0, "app.js 引用的 id 在 index.html 中都存在", missing.length ? missing.join(", ") : "全部命中");
ok(usedIds.size >= 30, "id 引用数量合理", usedIds.size + " 个");

console.log("\n[B] 脚本加载顺序");
const order = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
ok(order.indexOf("js/project.js") >= 0, "project.js 已加载");
ok(order.indexOf("js/project.js") < order.indexOf("js/app.js"), "project.js 在 app.js 之前");
ok(order.indexOf("js/layout.js") < order.indexOf("js/app.js"), "layout.js 在 app.js 之前");
ok(order.indexOf("js/data.js") < order.indexOf("js/engine.js"), "data.js 在 engine.js 之前");
for (const f of order) ok(fs.existsSync(path.join(root, f)), "脚本文件存在：" + f);

console.log("\n[C] 残留旧 API（应为 0）");
const stale = [
  "critBonus", "comboWindow", "COMBO_WINDOW_MIN", "COMBO_WINDOW_STEP",
  "renderLog", "st.version", "lotteryResult", "COIN_WINDOW_STEP",
  "Fx.shadows", "plateEdgeBake", "bakePlateGrad", "bakePlateEdge"
];
for (const s of stale) {
  const inApp = app.includes(s);
  const inCss = css.includes(s);
  ok(!inApp && !inCss, "无残留：" + s, inApp ? "app.js" : inCss ? "style.css" : "干净");
}

console.log("\n[D] 新玩法 UI 齐全");
for (const id of ["btnHot", "hotLv", "questRow", "questName", "questProg", "questTime", "btnOrderYes", "btnOrderNo", "heroFx", "congestChip", "streakChip", "overheatChip"]) {
  ok(htmlIds.has(id), "新 UI 元素存在：" + id);
}

console.log("\n[E] 2.5D 渲染管线关键调用");
for (const fn of ["P.projectX", "P.projectY", "P.scaleAt", "P.shadow", "P.kAt", "boardXFromClient"]) {
  ok(app.includes(fn), "app.js 使用了 " + fn);
}
ok(!/ctx\.shadowBlur\s*=/.test(app), "主循环不再有 shadowBlur（辉光已烘焙/分层）");
ok(app.includes("quadPath") && app.includes("band("), "台面按透视梯形绘制");

console.log("\n[F] 反投影（点击命中）");
ok(app.includes("boardXFromClient"), "屏幕 x 会反解算回台面 x（透视下点击才准）");
/* 反投影必须走 CPProject.unprojectX：机台烘焙时会 setViewport 把台面缩进内舱，
 * 只除 kAt(y) 会漏掉视口缩放，落点会向中轴收缩（s=0.76 时边缘偏差可达 43 台面像素）。
 * 所以这里不只查“公式在不在”，而是**真的跑一遍互逆断言**。 */
ok(/P\.unprojectX\s*\(/.test(app), "反投影走 CPProject.unprojectX（含视口缩放还原）");
let invOk = false, invDetail = "未执行";
try {
  const Proj = require(path.join(root, "js", "project.js"));
  Proj.setViewport({ cx: 240, cy: 268, s: 0.76 });   // 与 machine.js 的机台视口一致
  const y = 304;
  const errs = [];
  for (const bx of [60, 120, 240, 360, 420]) {
    const back = Proj.unprojectX(Proj.projectX(bx, y), y);
    errs.push(Math.abs(back - bx));
  }
  Proj.resetViewport();
  invOk = errs.every(e => e < 0.01);
  invDetail = "最大误差 " + Math.max(...errs).toExponential(1) + " 台面像素（含视口 s=0.76）";
} catch (e) {
  invDetail = "执行失败: " + e.message;
}
ok(invOk, "反投影与 projectX 在视口缩放下互逆", invDetail);

console.log("\n" + "=".repeat(58));
if (fails === 0) console.log("UI 审计通过：0 问题");
else console.log("UI 审计发现 " + fails + " 个问题");
console.log("=".repeat(58));
process.exit(fails === 0 ? 0 : 1);
