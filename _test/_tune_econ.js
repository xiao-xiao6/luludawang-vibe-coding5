/* 经济调参：复刻 smoke_test [8] 的 measure()，并额外打印
 * 稀有币出现次数 / 好币存量 / 维护费 / 抽成，方便迭代常量。
 * 运行：node _test/_tune_econ.js
 */
"use strict";
const path = require("path");
const E = require(path.join(__dirname, "..", "js", "engine.js"));
const D = require(path.join(__dirname, "..", "js", "data.js"));

function measure(levels, gemLevels, label, seed, secs) {
  const g = E.createGame({ seed });
  for (const k in levels) g.st.upgrades[k] = levels[k];
  for (const k in (gemLevels || {})) g.st.gemUpgrades[k] = gemLevels[k];
  g.applyUpgrades();
  g.st.credits = 1e9;
  g.seedField(170, 2);

  const spawn = {};
  const od = g.world.drop.bind(g.world);
  g.world.drop = function (def, x, o) {
    const c = od(def, x, o);
    if (c) spawn[def.id] = (spawn[def.id] || 0) + 1;
    return c;
  };

  const warm = 120;
  let t = 0;
  for (let i = 0; i < warm * 60; i++) {
    t += 1 / 60; if (t >= 0.42) { t = 0; g.insert(240); } g.step(1 / 60); g.drainPending();
  }
  for (const k in spawn) delete spawn[k];
  const s0 = g.st.totals.spent, e0 = g.st.totals.earned, p0 = g.st.totals.paid;
  const g0 = g.st.totals.gross, r0 = g.st.totals.rake, u0 = g.st.totals.upkeep;

  for (let i = 0; i < (secs || 90) * 60; i++) {
    t += 1 / 60; if (t >= 0.42) { t = 0; g.insert(240); } g.step(1 / 60); g.drainPending();
  }
  const spent = g.st.totals.spent - s0, earned = g.st.totals.earned - e0, paid = g.st.totals.paid - p0;
  const gross = g.st.totals.gross - g0, rake = g.st.totals.rake - r0, upkeep = g.st.totals.upkeep - u0;
  const ratio = spent ? earned / spent : 0;
  const fmt = (o) => Object.keys(o).map((k) => k + ":" + o[k]).join(" ");
  console.log("  · " + label.padEnd(18) + " 投入 " + String(spent).padStart(5) + " → 产出 " + String(earned).padStart(6) +
    "  比值 " + ratio.toFixed(2) + "  掉出 " + String(paid).padStart(5) + "  连击 " + String(g.st.totals.bestCombo).padStart(3) +
    "  场上 " + String(g.world.coins.length).padStart(3) + "  好币 " + g.countGood() +
    "  维护 " + upkeep + "  抽成 " + rake + "  毛 " + gross);
  console.log("      稀有产出: " + fmt(spawn) + "   宝箱 " + g.st.totals.jackpots + " 塔 " + g.st.totals.towers);
  return ratio;
}

const r0 = measure({}, {}, "初始机台", 1001);
const rMid = measure({ speed: 3, reach: 3, slick: 2, multi: 2, luck: 3 }, {}, "中期", 1002);
const rMax = measure({ speed: 6, reach: 6, slick: 5, multi: 4, luck: 6, rail: 5, cap: 4 }, {}, "满配", 1003);
const rCrit = measure({ speed: 6, reach: 6, slick: 5, multi: 4, luck: 6, rail: 5, cap: 4 }, { crit: 3 }, "满配+暴击", 1003);
console.log("\n判定：r0>0.5=" + (r0 > 0.5) + "  r0<1.35=" + (r0 < 1.35) +
  "  rMax>r0=" + (rMax > r0) + "  rMax<6=" + (rMax < 6) + "  rMid>=r0-0.1=" + (rMid >= r0 - 0.1) +
  "  critGain=" + (((rCrit - rMax) / rMax) * 100).toFixed(0) + "%");

/* 长跑：稀有币是否持续出现（用户反馈「只剩普通金币」的回归验证） */
console.log("\n=== 长跑 5 分钟：稀有币出现分布 ===");
function longRun(seed, ups, ips) {
  const g = E.createGame({ seed });
  if (ups) for (const k in ups) g.st.upgrades[k] = ups[k];
  g.applyUpgrades();
  g.seedField(170, 2);
  g.st.credits = 1e9;
  const spawn = {};
  const od = g.world.drop.bind(g.world);
  g.world.drop = function (def, x, o) {
    const c = od(def, x, o); if (c) spawn[def.id] = (spawn[def.id] || 0) + 1; return c;
  };
  let acc = 0;
  for (let i = 0; i < 5 * 60 * 120; i++) {
    acc += 1 / 120; if (acc >= 1 / ips) { acc = 0; g.insert(null); }
    g.st.credits = 1e9; g.step(1 / 120); g.drainPending();
  }
  return { spawn, kinds: g.st.totals.kinds, paid: g.st.totals.paid };
}
for (const [label, ups, ips] of [["无升级 2/秒", null, 2], ["满配 2/秒", { luck: 6, cap: 4, multi: 4, speed: 6, reach: 6, slick: 5, rail: 5 }, 2]]) {
  const r = longRun(4242, ups, ips);
  console.log("  " + label + " → 生成 " + JSON.stringify(r.spawn));
  console.log("       推落 " + JSON.stringify(r.kinds) + "  总掉出 " + r.paid);
}
