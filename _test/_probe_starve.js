/* 稀有币断流取证：模拟「玩家一直投币」的真实玩法，看
 *   1) 机台补给有没有真的产出钻石 / 宝箱 / 金币塔
 *   2) world.full（满台）会不会把整段补给闸门关死
 *   3) 台面最终还剩几种币
 * 运行：node _test/_probe_starve.js
 */
"use strict";
const path = require("path");
const D = require(path.join(__dirname, "..", "js", "data.js"));
const E = require(path.join(__dirname, "..", "js", "engine.js"));

function probe(label, opts) {
  const g = E.createGame({ seed: opts.seed });
  const world = g.world;
  const spawns = {};
  for (const k in D.COIN_DEFS) spawns[k] = 0;

  // 先撒开场币，再把 drop 挂钩子，只统计「机台自己补的币」
  g.st.credits = 1e9;
  g.seedField(170, 2);
  const origDrop = world.drop.bind(world);
  world.drop = function (def, x, y) {
    const c = origDrop(def, x, y);
    if (c) spawns[def.id] = (spawns[def.id] || 0) + 1;
    return c;
  };

  let fullTicks = 0, totalTicks = 0, minGood = 1e9, goodZeroTime = 0;
  const secs = opts.secs || 240;
  const every = opts.insertEvery != null ? opts.insertEvery : 0.5;

  let acc = 0;
  for (let i = 0; i < secs * 60; i++) {
    acc += 1 / 60;
    if (acc >= every) { acc = 0; g.insert(240); }
    g.step(1 / 60);
    g.drainPending();
    totalTicks++;
    if (world.full) fullTicks++;
    const good = g.countGood();
    if (good < minGood) minGood = good;
    if (good === 0) goodZeroTime += 1 / 60;
  }

  const field = {};
  for (const c of world.coins) field[c.kind] = (field[c.kind] || 0) + 1;

  console.log("=== " + label + " ===");
  console.log("  满台占比      " + ((fullTicks / totalTicks) * 100).toFixed(1) + "%");
  console.log("  机台补给产出  " + JSON.stringify(spawns));
  console.log("  好币存量最低  " + minGood + "  好币归零累计 " + goodZeroTime.toFixed(1) + "s");
  console.log("  台面终态      " + JSON.stringify(field));
  console.log("  推落种类      " + JSON.stringify(g.st.totals.kinds));
  console.log("  余额 " + D.fmt(g.st.credits) +
    "  投入 " + g.st.totals.spent + "  产出 " + g.st.totals.earned +
    "  比值 " + (g.st.totals.earned / Math.max(1, g.st.totals.spent)).toFixed(2));
  console.log("");
  return { spawns, field, kinds: g.st.totals.kinds };
}

console.log("=== 稀有币断流取证（4 分钟）===\n");
probe("一直投币（2 枚/秒，初始机台）", { seed: 9001, insertEvery: 0.5 });
probe("疯狂投币（4 枚/秒，初始机台）", { seed: 9002, insertEvery: 0.25 });
probe("满配 + 一直投币", {
  seed: 9003, insertEvery: 0.5,
  // 满配通过 levels 注入
});
