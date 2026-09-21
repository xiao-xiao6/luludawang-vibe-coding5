/* 量一下钻石币的真实产出速率（决定「钻石订单」目标怎么定才公平） */
"use strict";
const path = require("path");
const D = require(path.join(__dirname, "..", "js", "data.js"));
const E = require(path.join(__dirname, "..", "js", "engine.js"));

const MAX = { speed: 6, reach: 6, slick: 5, multi: 4, luck: 6, rail: 5, cap: 4 };
const MID = { speed: 3, reach: 3, slick: 2, multi: 2, luck: 3 };

function measure(levels, insertEvery, secs, seed) {
  const g = E.createGame({ seed: seed });
  for (const k in (levels || {})) g.st.upgrades[k] = levels[k];
  g.applyUpgrades();
  g.st.credits = 1e9;
  g.seedField(170, 2);
  let t = 0, gems = 0, gemRefills = 0, pays = 0;
  for (let i = 0; i < secs * 60; i++) {
    t += 1 / 60;
    if (t >= insertEvery) { t = 0; g.insert(240); }
    g.step(1 / 60);
    for (const e of g.drainPending()) {
      if (e.type === "pay") { pays++; if (e.gem) gems++; }
    }
  }
  return {
    gems: gems, pays: pays,
    gemRate: g.gemRate(), payRate: g.payRate(),
    perSec: gems / secs
  };
}

console.log("机台".padEnd(8) + "时长".padEnd(8) + "推落总数".padEnd(10) + "钻石币".padEnd(9) + "钻石/秒".padEnd(12) + "32s 期望钻石");
for (const [lab, lv] of [["初始", {}], ["中期", MID], ["满配", MAX]]) {
  for (const secs of [60, 180]) {
    const r = measure(lv, 0.5, secs, 9001);
    console.log(
      lab.padEnd(8) + (secs + "s").padEnd(10) +
      String(r.pays).padEnd(12) + String(r.gems).padEnd(11) +
      r.perSec.toFixed(3).padEnd(14) +
      (r.perSec * 32).toFixed(2)
    );
  }
}

console.log("\n=== 不同时长下「推落 N 枚钻石币」的自然发生量（满配，3 分钟）===");
const g = E.createGame({ seed: 9002 });
for (const k in MAX) g.st.upgrades[k] = MAX[k];
g.applyUpgrades();
g.st.credits = 1e9;
g.seedField(170, 2);
let t = 0;
const buckets = { "0-10s": 0, "10-20s": 0, "20-30s": 0, "30-40s": 0 };
let windowStart = 0, count = 0;
const wins = [];
for (let i = 0; i < 180 * 60; i++) {
  t += 1 / 60;
  if (t >= 0.5) { t = 0; g.insert(240); }
  g.step(1 / 60);
  for (const e of g.drainPending()) if (e.type === "pay" && e.gem) count++;
  windowStart += 1 / 60;
  if (windowStart >= 32) {
    wins.push(count);
    windowStart = 0; count = 0;
  }
}
wins.sort((a, b) => a - b);
const mean = wins.reduce((a, b) => a + b, 0) / wins.length;
console.log("32 秒窗口数 " + wins.length + "，平均推落钻石币 " + mean.toFixed(2) +
  "，中位 " + wins[(wins.length / 2) | 0] +
  "，范围 " + wins[0] + "~" + wins[wins.length - 1]);
console.log("≥1 枚的窗口占比 " + (wins.filter((w) => w >= 1).length / wins.length * 100).toFixed(0) + "%");
console.log("≥2 枚的窗口占比 " + (wins.filter((w) => w >= 2).length / wins.length * 100).toFixed(0) + "%");
console.log("≥3 枚的窗口占比 " + (wins.filter((w) => w >= 3).length / wins.length * 100).toFixed(0) + "%");
