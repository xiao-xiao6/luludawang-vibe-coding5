/* 惩罚 / 风险机制的**实测**脚本（不是单元断言）：
 * 模拟真实玩法，看这些机制在实战里到底会不会发生、强度是否合理。
 * 运行：node _test/penalty.js
 */
"use strict";
const path = require("path");
const D = require(path.join(__dirname, "..", "js", "data.js"));
const E = require(path.join(__dirname, "..", "js", "engine.js"));

function run(label, opts) {
  const g = E.createGame({ seed: opts.seed });
  for (const k in (opts.levels || {})) g.st.upgrades[k] = opts.levels[k];
  for (const k in (opts.gems || {})) g.st.gemUpgrades[k] = opts.gems[k];
  g.applyUpgrades();
  g.st.credits = 1e9;
  g.seedField(170, 2);
  if (opts.auto != null) g.st.auto = opts.auto;

  let t = 0, bursts = 0, streaks = 0, gutters = 0, pays = 0;
  let maxCongest = 0, congestTime = 0, overheatTime = 0;
  let offer = 0, done = 0, fail = 0, decline = 0, hot = 0;
  const secs = opts.secs || 240;

  for (let i = 0; i < secs * 60; i++) {
    t += 1 / 60;
    // 玩家行为：按频率投币，可选择是否"手贱硬塞满台"
    if (opts.insertEvery && t >= opts.insertEvery) { t = 0; g.insert(240); }
    if (opts.forceFull) {
      while (!g.world.full) g.world.drop(D.COIN_DEFS.copper, 240);
      if (opts.insertEvery == null && t >= 0.2) { t = 0; g.insert(240); }
    }
    if (opts.autoHot && g.hotReady() && g.st.credits >= D.HOT.cost && t < 1 / 60) g.useHot();
    if (opts.autoOrder && g.orderOffering()) g.acceptOrder();

    g.step(1 / 60);
    for (const e of g.drainPending()) {
      if (e.type === "burst") bursts++;
      else if (e.type === "streak") streaks++;
      else if (e.type === "gutter") gutters++;
      else if (e.type === "pay") pays++;
      else if (e.type === "orderOffer") offer++;
      else if (e.type === "orderDone") done++;
      else if (e.type === "orderFail") fail++;
      else if (e.type === "orderDecline") decline++;
      else if (e.type === "hot") hot++;
    }
    if (g.congest > maxCongest) maxCongest = g.congest;
    if (g.congest > 0.05) congestTime += 1 / 60;
    if (g.overheatT > 0) overheatTime += 1 / 60;
  }

  const pct = (v) => (v * 100).toFixed(0) + "%";
  console.log(
    label.padEnd(26) +
    "爆仓 " + String(bursts).padStart(3) +
    " | 漏币 " + String(streaks).padStart(3) +
    " | 峰值拥堵 " + pct(maxCongest).padStart(4) +
    " | 拥堵时长 " + congestTime.toFixed(0).padStart(3) + "s" +
    " | 订单 提议" + String(offer).padStart(3) + " 成" + String(done).padStart(3) + " 败" + String(fail).padStart(3) +
    " | 过热 " + overheatTime.toFixed(0).padStart(3) + "s" +
    " | 掉出 " + String(pays).padStart(5) + " 丢沟 " + String(gutters).padStart(4) +
    " | 余额 " + D.fmt(g.st.credits)
  );
  return { bursts, streaks, offer, done, fail, maxCongest, pays, gutters };
}

console.log("=== 惩罚 / 风险机制实测（每种 4 分钟）===\n");

run("正常游玩（2 枚/秒）", { seed: 7001, insertEvery: 0.5, secs: 240 });
run("慢手（0.7 枚/秒）", { seed: 7002, insertEvery: 1.4, secs: 240 });
run("快手（4 枚/秒）", { seed: 7003, insertEvery: 0.25, secs: 240 });
run("硬塞满台（故意）", { seed: 7004, forceFull: true, secs: 240 });
run("满配 + 正常游玩", {
  seed: 7005, insertEvery: 0.5, secs: 240,
  levels: { speed: 6, reach: 6, slick: 5, multi: 4, luck: 6, rail: 5, cap: 4 }
});
run("满配 + 硬塞满台", {
  seed: 7006, forceFull: true, secs: 240,
  levels: { speed: 6, reach: 6, slick: 5, multi: 4, luck: 6, rail: 5, cap: 4 }
});
run("满配 + 排风/防爆满级", {
  seed: 7007, forceFull: true, secs: 240,
  levels: { speed: 6, reach: 6, slick: 5, multi: 4, luck: 6, rail: 5, cap: 4, vent: 3, guard: 3 }
});
run("自动投币挂机（Lv6）", {
  seed: 7008, auto: true, secs: 240,
  levels: { auto: 6, speed: 6, reach: 6, slick: 5, multi: 4, luck: 6, rail: 5, cap: 4 }
});
run("接单 + 自动超频", {
  seed: 7009, insertEvery: 0.5, secs: 240, autoOrder: true, autoHot: true,
  levels: { speed: 6, reach: 6, slick: 5, multi: 4, luck: 6, rail: 5, cap: 4 }
});
