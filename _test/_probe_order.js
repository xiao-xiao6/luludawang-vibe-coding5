/* 探针：订单自适应难度的达成率实测（不参与自检，只用于调参）
 * 运行：node _test/_probe_order.js
 */
"use strict";
const path = require("path");
const D = require(path.join(__dirname, "..", "js", "data.js"));
const E = require(path.join(__dirname, "..", "js", "engine.js"));

const MAX = { speed: 6, reach: 6, slick: 5, multi: 4, luck: 6, rail: 5, cap: 4 };
const MID = { speed: 3, reach: 3, slick: 2, multi: 2, luck: 3 };

/** 先热身一段（让 EMA 收敛到真实产能），再接下指定订单看能不能完成
 * N7：热身从 40s 压到 25s（EMA 时间常数 22s，25s 已收敛到 ≈68%），
 * trial 从 40 压到 12 —— 整套从“300 秒都跑不完”降到 1~2 分钟，
 * 变成真正“随手可复现”的回归探针。 */
function trial(defId, seed, insertEvery, levels) {
  const g = E.createGame({ seed: seed });
  for (const k in (levels || {})) g.st.upgrades[k] = levels[k];
  g.applyUpgrades();
  g.st.credits = 1e9;
  g.seedField(170, 2);

  let t = 0;
  // 热身 25 秒：既让 EMA 收敛，也把开场赠币推完
  for (let i = 0; i < 25 * 60; i++) {
    t += 1 / 60;
    if (t >= insertEvery) { t = 0; g.insert(240); }
    g.step(1 / 60);
    g.drainPending();
  }

  const def = D.ORDERS.find((o) => o.id === defId);
  const feasible = g.orderFeasible(def);
  const spec = g.rollOrderSpec(def);
  const before = g.st.totals.ordersDone;
  g.order = {
    id: def.id, phase: "active", t: def.time, prog: 0, gutters: 0,
    target: spec.target, reward: spec.reward, penalty: spec.penalty, def: def
  };

  const steps = Math.ceil(def.time * 60) + 6;
  for (let i = 0; i < steps && g.order; i++) {
    t += 1 / 60;
    if (t >= insertEvery) { t = 0; g.insert(240); }
    g.step(1 / 60);
    g.drainPending();
  }
  return {
    win: g.st.totals.ordersDone > before,
    spec: spec,
    feasible: feasible,
    rate: g.payRate().toFixed(1),
    vrate: g.valueRate().toFixed(1)
  };
}

function rate(defId, insertEvery, levels, n) {
  let win = 0, spec = null, rate0 = 0, vrate0 = 0, feas = 0;
  for (let i = 0; i < n; i++) {
    const r = trial(defId, 8000 + i * 13, insertEvery, levels);
    if (r.win) win++;
    if (r.feasible) feas++;
    spec = r.spec; rate0 = r.rate; vrate0 = r.vrate;
  }
  return { win, n, spec, rate0, vrate0, feas };
}

console.log("=== 订单达成率（自适应目标，热身 25s 后接单，每种 12 次）===");
console.log("（「会派单」= 该机台是否真的会收到这种单；✗ 表示已被可行性筛选拦下，不会派给玩家）");
console.log("订单".padEnd(12) + "机台".padEnd(10) + "会派单".padEnd(10) + "实测产能".padEnd(16) + "自适应目标".padEnd(16) + "赏/罚".padEnd(18) + "达成率");
for (const o of D.ORDERS) {
  for (const [lab, lv] of [["初始", {}], ["中期", MID], ["满配", MAX]]) {
    const r = rate(o.id, 0.5, lv, 12);
    console.log(
      (lab === "初始" ? o.name : "").padEnd(10) +
      lab.padEnd(12) +
      (r.feas === r.n ? "✓" : "✗ " + r.feas + "/" + r.n).padEnd(12) +
      (r.rate0 + "枚/s " + r.vrate0 + "◎/s").padEnd(18) +
      (r.spec.target + o.unit).padEnd(18) +
      (r.spec.reward + " / " + r.spec.penalty).padEnd(20) +
      (r.win / r.n * 100).toFixed(0) + "%"
    );
  }
}

console.log("\n=== 投币频率对达成率的影响（满配机台）===");
for (const iv of [0.25, 0.5, 1.0, 1.4]) {
  const out = [];
  for (const o of D.ORDERS) {
    const r = rate(o.id, iv, MAX, 8);
    out.push(o.name + " " + (r.win / r.n * 100).toFixed(0) + "%");
  }
  console.log("投币 " + (1 / iv).toFixed(1) + "/秒 → " + out.join(" | "));
}

console.log("\n=== 拥堵时间占比（4 分钟）===");
for (const [lab, iv, lv] of [["慢手 0.7/秒", 1.4, {}], ["正常 2/秒", 0.5, {}], ["快手 4/秒", 0.25, {}], ["满配 2/秒", 0.5, MAX], ["满配 6/秒", 0.17, MAX]]) {
  const g = E.createGame({ seed: 7100 });
  for (const k in lv) g.st.upgrades[k] = lv[k];
  g.applyUpgrades();
  g.st.credits = 1e9;
  g.seedField(170, 2);
  let t = 0, congestTime = 0, peak = 0, sum = 0, ns = 0;
  for (let i = 0; i < 240 * 60; i++) {
    t += 1 / 60;
    if (t >= iv) { t = 0; g.insert(240); }
    g.step(1 / 60);
    g.drainPending();
    if (g.congest > 0.05) congestTime += 1 / 60;
    if (g.congest > peak) peak = g.congest;
    if (i % 600 === 0) { sum += g.world.coins.length; ns++; }
  }
  console.log(lab.padEnd(14) + "拥堵占比 " + (congestTime / 240 * 100).toFixed(0).padStart(3) + "%  峰值 " +
    (peak * 100).toFixed(0).padStart(3) + "%  平均场上 " + Math.round(sum / ns) + "/" + g.world.maxCoins);
}
