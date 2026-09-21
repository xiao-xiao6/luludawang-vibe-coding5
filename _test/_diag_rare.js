/* ============================================================
 * 稀有币断流诊断：统计各币种实际生成量 / 台面币数轨迹 / 补给是否触发
 * 只读诊断，不改游戏逻辑。
 * ============================================================ */
const path = require("path");
const E = require(path.join(__dirname, "..", "js", "engine.js"));
const D = require(path.join(__dirname, "..", "js", "data.js"));

const RARE = { silver: 1, gold: 1, diamond: 1, lucky: 1, chest: 1, tower: 1 };

function play(seed, minutes, ips, ups) {
  const g = E.createGame({ seed: seed });
  g.seedField(170, 2);
  if (ups) for (const k in ups) g.st.upgrades[k] = ups[k];
  g.applyUpgrades();

  const dropsByKind = {};
  const rare = [];
  const seedSnapshot = {};   // 开局种子币构成

  const od = g.world.drop.bind(g.world);
  let counting = false;
  g.world.drop = function (def, x, o) {
    const c = od(def, x, o);
    if (c) {
      const bucket = counting ? dropsByKind : seedSnapshot;
      bucket[def.id] = (bucket[def.id] || 0) + 1;
      if (counting && RARE[def.id]) rare.push({ t: +g.world.time.toFixed(1), k: def.id });
    }
    return c;
  };

  let maxCoins = 0, minCoins = 1e9, sumCoins = 0, n = 0;
  let belowRefill = 0;              // 台面币数低于补给线的采样次数
  counting = true;

  const steps = Math.round(minutes * 60 * 120);
  let acc = 0;
  const refillAt = g.refillAt();
  for (let i = 0; i < steps; i++) {
    acc += 1 / 120;
    if (acc >= 1 / ips) { acc = 0; g.insert(null); }
    g.step(1 / 120);
    const cl = g.world.coins.length;
    if (cl > maxCoins) maxCoins = cl;
    if (cl < minCoins) minCoins = cl;
    if (cl < refillAt) belowRefill++;
    sumCoins += cl; n++;
  }

  return {
    seed: seed, minutes: minutes, ips: ips, ups: ups || "none",
    seedSnapshot: seedSnapshot,
    coinsMin: minCoins, coinsMax: maxCoins, coinsAvg: +(sumCoins / n).toFixed(1),
    refillAt: refillAt, maxCoinsCap: g.world.maxCoins,
    belowRefillPct: +(100 * belowRefill / n).toFixed(1),
    dropsByKind: dropsByKind,
    rareCount: rare.length,
    rareFirst: rare.slice(0, 24),
    paidKinds: g.st.totals.kinds,
    towers: g.st.totals.towers, jackpots: g.st.totals.jackpots,
    credits: Math.round(g.st.credits),
    earned: Math.round(g.st.totals.earned), spent: Math.round(g.st.totals.spent),
    bestCombo: g.st.totals.bestCombo
  };
}

const FULL = { luck: 6, cap: 4, multi: 4, auto: 6, speed: 6, reach: 6 };
const runs = [
  play(20260921, 8, 2, null),
  play(20260921, 8, 2, FULL),
  play(20260921, 8, 5, FULL)
];
for (const r of runs) console.log(JSON.stringify(r, null, 1));
