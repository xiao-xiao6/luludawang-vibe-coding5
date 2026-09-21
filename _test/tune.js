/* 调参脚本：扫推板行程 / 台面长度 / 迭代次数，实测掉币率
 * 运行：node _test/tune.js
 * 每组的随机源都是可播种的（D.makeRng），所以这张表是可复现的回归基线。 */
"use strict";
const path = require("path");
const P = require(path.join(__dirname, "..", "js", "physics.js"));
const D = require(path.join(__dirname, "..", "js", "data.js"));

function run(cfg, seedN, insertPerSec, secs, seed) {
  const w = new P.World(Object.assign({ rng: D.makeRng(seed) }, cfg));
  w.maxCoins = cfg.maxCoins || 500;
  const yTop = w.plateMaxY + 14;
  const yBot = w.payoutY - 34;
  for (let i = 0; i < seedN; i++) {
    const x = w.W * (0.04 + 0.92 * w.rng());
    const y = yTop + (yBot - yTop) * w.rng();
    w.drop(D.COIN_DEFS.copper, x, { y: y });
  }
  for (let i = 0; i < 240; i++) w.step(1 / 120);
  w.resetStats();

  const dt = 1 / 60;
  let acc = 0, ins = 0;
  for (let i = 0; i < secs * 60; i++) {
    acc += dt * insertPerSec;
    while (acc >= 1) { acc -= 1; if (w.drop(D.COIN_DEFS.copper, w.W / 2)) ins++; }
    w.step(dt);
  }
  return {
    ins: ins, paid: w.stats.paid, lost: w.stats.lost,
    n: w.coins.length, ov: w.worstOverlap(), pen: w.worstPlatePenetration()
  };
}

const base = { width: 480, height: 580, gutterW: 44, iterations: 10, relax: 0.8 };
const cases = [
  ["A 行程72/面236", { plateMinY: 118, plateMaxY: 190, payoutY: 470 }, 220],
  ["B 行程102/面236", { plateMinY: 118, plateMaxY: 220, payoutY: 470 }, 250],
  ["C 行程72/面186", { plateMinY: 118, plateMaxY: 190, payoutY: 420 }, 220],
  ["D 行程132/面236", { plateMinY: 118, plateMaxY: 250, payoutY: 470 }, 260],
  ["E 行程72 ω2.0", { plateMinY: 118, plateMaxY: 190, payoutY: 470, omega: 2.0 }, 220],
  ["F 行程72 it14 rlx.9", { plateMinY: 118, plateMaxY: 190, payoutY: 470, iterations: 14, relax: 0.9 }, 220],
  ["G 行程102 面286", { plateMinY: 118, plateMaxY: 220, payoutY: 520 }, 300],
  ["H 行程162 面236", { plateMinY: 118, plateMaxY: 280, payoutY: 470 }, 300]
];

console.log("配置".padEnd(22) + "投入  掉出  丢沟  场上  掉出/投入  重叠  穿透");
console.log("-".repeat(78));
let i = 0;
for (const [label, cfg, seedN] of cases) {
  const r = run(Object.assign({}, base, cfg), seedN, 2, 90, 9000 + i * 17);
  i++;
  const ratio = r.ins ? (r.paid / r.ins) : 0;
  console.log(
    label.padEnd(20) +
    String(r.ins).padStart(5) + String(r.paid).padStart(6) + String(r.lost).padStart(6) +
    String(r.n).padStart(6) + ratio.toFixed(3).padStart(11) +
    r.ov.toFixed(2).padStart(7) + r.pen.toFixed(3).padStart(7)
  );
}
