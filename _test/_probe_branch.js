/* 补给分支取证：确认「稀有币 / 好币」到底是哪一道闸门被卡死。
 * 只读不改：复刻 engine.step 里的判定条件，统计每道闸门的通过率，
 * 并跟踪台面构成随时间的变化。
 * 运行：node _test/_probe_branch.js
 */
"use strict";
const path = require("path");
const D = require(path.join(__dirname, "..", "js", "data.js"));
const E = require(path.join(__dirname, "..", "js", "engine.js"));

function composition(w) {
  const m = {};
  for (const c of w.coins) m[c.kind] = (m[c.kind] || 0) + 1;
  return m;
}

function probe(label, opts) {
  const g = E.createGame({ seed: opts.seed });
  const w = g.world;
  g.st.credits = 1e9;
  g.seedField(170, 2);
  for (const k in (opts.levels || {})) g.st.upgrades[k] = opts.levels[k];
  if (opts.levels) g.applyUpgrades();

  const luck0 = g.upLevel("luck") + g.modifierDef().luck;
  console.log("=== " + label + " ===");
  console.log("  maxCoins=" + w.maxCoins + "  refillAt=" + g.refillAt() +
    "  goodFloor=" + g.goodFloor() + "  luck=" + luck0 +
    "  rake=" + D.MAINTENANCE.rake + "  maint.every=" + D.MAINTENANCE.every +
    "  maintCost=" + g.maintenanceCost());

  // 抽样：goodDef / mixDef 的实际分布（各 20000 次）
  const gd = {}, md = {};
  for (let i = 0; i < 20000; i++) {
    gd[g.goodDef().id] = (gd[g.goodDef().id] || 0) + 1;
  }
  for (let i = 0; i < 20000; i++) {
    md[g.mixDef().id] = (md[g.mixDef().id] || 0) + 1;
  }
  console.log("  goodDef 分布 " + JSON.stringify(gd));
  console.log("  mixDef  分布 " + JSON.stringify(md));

  // 分支通过率
  let fullSkip = 0, towerGate = 0, chestGate = 0, needGood = 0, countRefill = 0, ticks = 0;
  let refillTicks = 0, lastRefillAcc = g.refillAcc;
  const secs = opts.secs || 240;
  const every = opts.insertEvery != null ? opts.insertEvery : 0.5;
  let acc = 0, snapAcc = 0;
  const snaps = [];

  for (let i = 0; i < secs * 60; i++) {
    acc += 1 / 60;
    if (acc >= every) { acc = 0; g.insert(240); }
    g.step(1 / 60);
    g.drainPending();
    ticks++;
    if (g.refillAcc < lastRefillAcc) {          // 补给 tick 刚发生
      refillTicks++;
      if (w.full) fullSkip++;
      else {
        if (g.towerCd <= 0 && g.towerGap <= 0) towerGate++;
        if (g.chestCd <= 0 && g.chestGap <= 0) chestGate++;
        if (g.countGood() < g.goodFloor()) needGood++;
        if (w.coins.length < g.refillAt()) countRefill++;
      }
    }
    lastRefillAcc = g.refillAcc;

    snapAcc += 1 / 60;
    if (snapAcc >= 30) {
      snapAcc = 0;
      const c = composition(w);
      snaps.push("t=" + Math.round(i / 60) + "s 总数" + w.coins.length +
        " 好币" + g.countGood() + " " + JSON.stringify(c));
    }
  }

  console.log("  补给 tick 数 " + refillTicks);
  console.log("  满台跳过     " + fullSkip);
  console.log("  塔冷却已开   " + towerGate + " (" + ((towerGate / refillTicks) * 100).toFixed(0) + "%)");
  console.log("  箱冷却已开   " + chestGate + " (" + ((chestGate / refillTicks) * 100).toFixed(0) + "%)");
  console.log("  好币低于下限 " + needGood + " (" + ((needGood / refillTicks) * 100).toFixed(0) + "%)");
  console.log("  数量低于补给线 " + countRefill + " (" + ((countRefill / refillTicks) * 100).toFixed(0) + "%)");
  console.log("  推落种类 " + JSON.stringify(g.st.totals.kinds));
  console.log("  投入 " + g.st.totals.spent + " 产出 " + g.st.totals.earned +
    " 比值 " + (g.st.totals.earned / Math.max(1, g.st.totals.spent)).toFixed(2) +
    " 维护费 " + (g.st.totals.upkeep || 0) + " 抽成 " + (g.st.totals.rake || 0));
  console.log("  构成时间线：");
  for (const s of snaps) console.log("    " + s);
  console.log("");
}

probe("初始机台 + 持续投币（2 枚/秒）", { seed: 9101, insertEvery: 0.5 });
probe("满配机台 + 持续投币（2 枚/秒）", {
  seed: 9102, insertEvery: 0.5,
  levels: { speed: 6, reach: 6, slick: 5, multi: 4, luck: 6, rail: 5, cap: 4 }
});
