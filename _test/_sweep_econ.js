/* 经济常量扫描：在内存里覆盖 REFILL.ratio / goodRatio / goodEvery / MAINTENANCE.rake，
 * 复用 smoke_test [8] 的口径（120s 预热排空赠币 + 90s 稳态），
 * 找出「稀有币持续出现」与「投入产出比回到验收区间」同时成立的组合。
 * 只读扫描，不改任何文件。
 * 运行：node _test/_sweep_econ.js
 */
"use strict";
const path = require("path");
const E = require(path.join(__dirname, "..", "js", "engine.js"));
const D = require(path.join(__dirname, "..", "js", "data.js"));

const MID = { speed: 3, reach: 3, slick: 2, multi: 2, luck: 3 };
const MAX = { speed: 6, reach: 6, slick: 5, multi: 4, luck: 6, rail: 5, cap: 4 };

function measure(levels, gemLevels, seed) {
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

  let t = 0;
  for (let i = 0; i < 120 * 60; i++) {           // 预热：排空开局赠币
    t += 1 / 60; if (t >= 0.42) { t = 0; g.insert(240); }
    g.step(1 / 60); g.drainPending();
  }
  for (const k in spawn) delete spawn[k];        // 只统计稳态
  const s0 = g.st.totals.spent, e0 = g.st.totals.earned;

  for (let i = 0; i < 90 * 60; i++) {
    t += 1 / 60; if (t >= 0.42) { t = 0; g.insert(240); }
    g.step(1 / 60); g.drainPending();
  }
  const spent = g.st.totals.spent - s0, earned = g.st.totals.earned - e0;
  return {
    ratio: spent ? earned / spent : 0, spent: spent, earned: earned,
    good: g.countGood(), spawn: spawn,
    chest: g.st.totals.jackpots, tower: g.st.totals.towers
  };
}

function trial(ratio, goodRatio, goodEvery, rake) {
  D.REFILL.ratio = ratio;
  D.REFILL.goodRatio = goodRatio;
  D.REFILL.goodEvery = goodEvery;
  D.MAINTENANCE.rake = rake;

  const a = measure({}, {}, 1001);
  const b = measure(MID, {}, 1002);
  const c = measure(MAX, {}, 1003);
  const d = measure(MAX, { crit: 3 }, 1003);
  const crit = c.ratio ? (d.ratio - c.ratio) / c.ratio : 0;
  const rare = (r) => ["silver", "gold", "diamond", "lucky", "chest", "tower"]
    .filter((k) => r.spawn[k]).map((k) => k + ":" + r.spawn[k]).join(" ");

  console.log("refill=" + ratio + " goodRatio=" + goodRatio + " goodEvery=" + goodEvery + " rake=" + rake);
  console.log("    r0   " + a.ratio.toFixed(2) + "  (投入 " + a.spent + " 产出 " + a.earned + ")  好币 " + a.good +
    "  箱 " + a.chest + " 塔 " + a.tower);
  console.log("         稀有 " + rare(a));
  console.log("    rMid " + b.ratio.toFixed(2) + "  好币 " + b.good + "  稀有 " + rare(b));
  console.log("    rMax " + c.ratio.toFixed(2) + "  好币 " + c.good + "  稀有 " + rare(c));
  console.log("    crit " + (crit * 100).toFixed(0) + "%   →  r0∈(0.5,1.35)=" + (a.ratio > 0.5 && a.ratio < 1.35) +
    "  rMax>r0=" + (c.ratio > a.ratio) + "  rMid>=r0-0.1=" + (b.ratio >= a.ratio - 0.1) +
    "  rMax<6=" + (c.ratio < 6) + "  crit<35%=" + (crit < 0.35));
  console.log("");
}

/* 第一步：确认「只修补给闸门、不加好币保底」的基线比值 */
trial(0.90, 0.0, 8, 0.00);
/* 第二步：用抽成把比值压回验收区间 */
trial(0.90, 0.0, 8, 0.55);
trial(0.90, 0.0, 8, 0.65);
trial(0.90, 0.0, 8, 0.72);
