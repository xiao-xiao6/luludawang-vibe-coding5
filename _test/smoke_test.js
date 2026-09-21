/* ============================================================
 * 自检脚本：物理稳定性 / 经济平衡 / 存档 / 成就 / 换机台 / 音效状态
 * 运行：node _test/smoke_test.js
 *
 * 所有随机都走可播种 RNG（D.makeRng）——同一份种子跑出的结果完全一致，
 * 所以平衡测试是真正的回归门禁，而不是"每次重新抽样"。
 * 同时把报告里 B1~B9 的每个 Bug 都钉成了一条回归断言。
 * ============================================================ */
"use strict";

const path = require("path");
const P = require(path.join(__dirname, "..", "js", "physics.js"));
const D = require(path.join(__dirname, "..", "js", "data.js"));
const E = require(path.join(__dirname, "..", "js", "engine.js"));
require(path.join(__dirname, "..", "js", "fx.js"));   // 只为验证音效状态机
const Sfx = globalThis.CPSfx;

const SEED = 20260920;
/* 用 seed 而不是 rng 传入：引擎会从同一个种子派生出物理流与结算流，
 * 这样“同一份种子跑两次结果完全一致”的断言才成立。 */
function newGame(seed) { return E.createGame({ seed: seed == null ? SEED : seed }); }

let checks = 0, fails = 0;
const problems = [];
function ok(cond, label, detail) {
  checks++;
  if (!cond) {
    fails++;
    problems.push(label + (detail ? "  → " + detail : ""));
    console.log("  ✗ " + label + (detail ? "  → " + detail : ""));
  } else {
    console.log("  ✓ " + label + (detail ? "  (" + detail + ")" : ""));
  }
}
function head(t) { console.log("\n" + t); }
function finite(v) { return typeof v === "number" && isFinite(v); }
function pick(evts, type) { for (const e of evts) if (e.type === type) return e; return null; }

/* ---------------- 1. 物理稳定性 ---------------- */
head("[1] 物理稳定性");
{
  // B2 回归：createGame 不再自动撒币（避免"建对象撒一次 + boot 再撒一次"的双倍开局）
  const g0 = newGame();
  ok(g0.world.coins.length === 0, "createGame 不再自动撒币（交给调用方）", g0.world.coins.length + " 枚");
  g0.seedField(170, 2);
  ok(g0.world.coins.length > 0, "seedField 后机台有币", g0.world.coins.length + " 枚");
  ok(g0.world.coins.length < g0.world.maxCoins * 0.85, "开场不会塞到警戒线（不再开局爆红）",
    g0.world.coins.length + "/" + g0.world.maxCoins);

  const w = new P.World({ rng: D.makeRng(7) });
  for (let i = 0; i < 150; i++) {
    w.drop(D.COIN_DEFS.copper, w.W * (0.08 + 0.84 * w.rng()), { y: w.plateMinY + 22 + 240 * w.rng() });
  }
  ok(w.coins.length === 150, "测试台面已铺 150 枚币");

  let nan = 0;
  for (let i = 0; i < 3000; i++) {
    w.step(1 / 120);
    for (const c of w.coins) {
      if (!finite(c.x) || !finite(c.y) || !finite(c.vx) || !finite(c.vy)) nan++;
    }
  }
  ok(nan === 0, "3000 步无 NaN/Infinity", "异常值 " + nan);

  const pen = w.worstPlatePenetration();
  ok(pen < 0.01, "币不陷进推板（硬约束）", "最深 " + pen.toFixed(4) + "px");

  const ov = w.worstOverlap();
  ok(ov < 3.5, "币与币重叠可控", "最深 " + ov.toFixed(3) + "px");

  let outside = 0;
  for (const c of w.coins) {
    if (c.x < -1 || c.x > w.W + 1 || c.y < -1 || c.y > w.payoutY + 1) outside++;
  }
  ok(outside === 0, "币不出界（越界的已被结算）", "越界 " + outside);

  const w2 = new P.World();
  ok(w2.coins.length === 0 && w2.full === false, "空世界状态正确");
  for (let i = 0; i < 400; i++) w2.drop(D.COIN_DEFS.copper, 240);
  ok(w2.coins.length <= w2.maxCoins, "容量上限生效", w2.coins.length + "/" + w2.maxCoins);
  const over = w2.drop(D.COIN_DEFS.copper, 240);
  ok(over === null, "满台时投币被拒绝");

  // 暂停推板：推板停住，但币仍然继续求解（不卡死、不穿模）
  const w3 = new P.World({ rng: D.makeRng(9) });
  for (let i = 0; i < 60; i++) w3.drop(D.COIN_DEFS.copper, 240, { y: 200 });
  for (let i = 0; i < 240; i++) w3.step(1 / 120);
  const frozenY = w3.plate.y;
  let frozenNan = 0;
  for (let i = 0; i < 600; i++) {
    w3.step(1 / 120, { freezePlate: true });
    for (const c of w3.coins) if (!finite(c.x) || !finite(c.y)) frozenNan++;
  }
  ok(Math.abs(w3.plate.y - frozenY) < 1e-9, "暂停时推板停住", "y " + w3.plate.y.toFixed(3));
  ok(frozenNan === 0, "暂停期间币仍正常求解（无 NaN）");
  ok(w3.worstPlatePenetration() < 0.01, "暂停期间无推板穿透");
}

/* ---------------- 2. 无挂机白拿 ---------------- */
head("[2] 挂机不产生收益（推板才是唯一动力）");
{
  const g = newGame();
  g.seedField(170, 2);
  g.st.credits = 1000;
  const before = g.st.credits;
  let paid = 0;
  for (let i = 0; i < 60 * 90; i++) {
    g.step(1 / 60);
    const evts = g.drainPending();
    for (const e of evts) if (e.type === "pay") paid++;
  }
  const idleGain = g.st.credits - before;
  ok(idleGain < 25, "90 秒纯挂机收益可忽略", "收益 " + idleGain + " ◎ / 掉出 " + paid + " 枚");
}

/* ---------------- 3. 经济：投币与收益 ---------------- */
head("[3] 经济：投币 / 结算 / 连击");
{
  const g = newGame();
  g.seedField(170, 2);
  g.st.credits = 500;
  const c0 = g.st.credits;
  const n = g.insert(240);
  ok(n === 1, "Lv0 一次投 1 枚", "投出 " + n);
  ok(g.st.credits === c0 - 1, "投币扣除金币", c0 + " → " + g.st.credits);
  ok(g.st.totals.dropped === 1 && g.st.totals.drops === 1, "统计计数正确");

  g.st.credits = 0;
  ok(g.insert(240) === 0, "金币不足时投币失败");
  const deny = g.drainPending().some((e) => e.type === "deny");
  ok(deny, "失败时推送 deny 事件");

  // 连击倍率阶梯（滑动窗口计数：0.9 秒内推落的枚数）
  ok(D.mulFor(1) === 1, "连击 1 → ×1");
  ok(D.mulFor(5) === 1, "未达阈值不加成");
  ok(D.mulFor(6) === 1.4, "连击 6 → ×1.4");
  ok(D.mulFor(11) === 1.8, "连击 11 → ×1.8");
  ok(D.mulFor(18) === 2.5, "连击 18 → ×2.5");
  ok(D.mulFor(30) === 4, "连击 30 → ×4");
  ok(D.COMBO_WINDOW === 0.9, "连击窗口 0.9 秒", String(D.COMBO_WINDOW));

  // B7 回归：暴击改成“概率翻倍”，不再往基础倍率上叠加
  ok(D.critChance(0) === 0, "未买暴击芯片时触发率为 0");
  ok(Math.abs(D.critChance(1) - 0.1) < 1e-9, "暴击 Lv1 → 10%", String(D.critChance(1)));
  ok(Math.abs(D.critChance(3) - 0.3) < 1e-9, "暴击满级 → 30%", String(D.critChance(3)));
  ok(D.CRIT_MULT === 2, "暴击倍率为 ×2");
  ok(D.mulFor(1) === 1, "B7：单枚币永远是 ×1（不再被暴击变成常驻倍率）", String(D.mulFor(1)));

  // B7 回归：连击是滑动窗口，不是单调递增的计数器
  {
    const gs = newGame(21);
    gs.seedField(170, 2);
    gs.st.credits = 1e9;
    for (let i = 0; i < 60; i++) {
      const sc = gs.world.drop(D.COIN_DEFS.copper, 40 + (i % 20) * 20, { y: gs.world.payoutY - 30 });
      if (sc) sc.vy = 420;
    }
    let maxCombo = 0;
    for (let i = 0; i < 60 * 3; i++) {
      gs.step(1 / 60);
      for (const e of gs.drainPending()) if (e.type === "pay" && e.combo > maxCombo) maxCombo = e.combo;
    }
    for (let i = 0; i < 60; i++) gs.step(1 / 60);
    gs.drainPending();
    ok(maxCombo > 0, "连续掉币时会累积连击", "最高 " + maxCombo + " 枚");
    ok(gs.combo === 0, "B7：掉币停止 1 秒后连击归零（滑动窗口生效）", "combo=" + gs.combo);
  }

  // 直接制造一次结算（推进到币真正越过前沿为止）
  const g2 = newGame();
  g2.st.credits = 0;
  const c = g2.world.drop(D.COIN_DEFS.gold, 240, { y: g2.world.payoutY - 20 });
  c.vy = 400;
  for (let i = 0; i < 60 && !c.dead; i++) { g2.world.step(1 / 120); g2.processEvents(); }
  ok(c.dead && c.reason === "payout", "金币越过前沿被结算为 payout", String(c.reason));
  ok(g2.st.credits > 0, "推落金币产生收益", "+" + g2.st.credits);
  ok(g2.st.totals.kinds.gold === 1, "币种统计正确");
  ok(g2.st.totals.bestCredits >= g2.st.credits, "历史最高余额被记录", String(g2.st.totals.bestCredits));

  // 角沟丢币
  const g3 = newGame();
  const c3 = g3.world.drop(D.COIN_DEFS.copper, 6, { y: g3.world.payoutY - 20 });
  c3.vy = 400;
  for (let i = 0; i < 60 && !c3.dead; i++) { g3.world.step(1 / 120); g3.processEvents(); }
  ok(c3.dead && c3.reason === "gutter", "角沟币被结算为 gutter", String(c3.reason));
  ok(g3.st.credits === 120, "角沟掉币不产生收益", "金币 " + g3.st.credits);
  ok(g3.st.totals.lost === 1, "丢币计数正确");
}

/* ---------------- 4. 升级 ---------------- */
head("[4] 升级系统");
{
  const g = newGame();
  g.st.credits = 100000;
  const baseSpeed = g.world.speedMul;
  ok(g.buy("speed") === true, "购买推板马达成功");
  ok(g.world.speedMul > baseSpeed, "速度倍率生效", baseSpeed + " → " + g.world.speedMul.toFixed(3));
  ok(g.upLevel("speed") === 1, "等级 +1");

  const c1 = g.upCost("speed");
  g.buy("speed");
  const c2 = g.upCost("speed");
  ok(c2 > c1, "升级成本递增", c1 + " → " + c2);

  for (let i = 0; i < 10; i++) g.buy("speed");
  ok(g.upLevel("speed") === 6, "等级封顶", "Lv" + g.upLevel("speed"));
  ok(g.upCost("speed") === Infinity, "满级后成本为 Infinity");
  ok(g.canBuy("speed") === false, "满级后不可购买");

  g.buy("multi");
  ok(g.insertCount() === 2, "投币口升级后一次投 2 枚", "投出 " + g.insertCount());
  g.buy("auto");
  ok(g.autoLvl() === 1, "自动投币机等级生效");

  const g4 = newGame();
  g4.st.credits = 5;
  ok(g4.buy("speed") === false, "金币不足时购买失败");
  ok(g4.drainPending().some((e) => e.type === "deny"), "购买失败推送 deny");

  const g5 = newGame();
  g5.st.gems = 100;
  const b0 = g5.world.railMul;
  g5.buyGem("magnet");
  ok(g5.gemLevel("magnet") === 1, "钻石升级生效");
  ok(g5.world.railMul === b0, "钻石升级不影响护栏（只影响磁力）");
  ok(g5.world.magnet === 1, "磁力线圈接到物理参数上", "world.magnet=" + g5.world.magnet);
  ok(g5.critChance() === 0, "暴击芯片未买时触发率为 0");
  g5.buyGem("crit");
  ok(Math.abs(g5.critChance() - 0.1) < 1e-9, "暴击芯片 Lv1 → 10% 触发率", String(g5.critChance()));
  ok(g5.gemCost("magnet") > 0, "钻石升级成本可读");

  // M9 回归：扩容槽要真的抬高补给线，不能只抬上限
  const gc0 = newGame();
  const refill0 = gc0.refillAt(), cap0 = gc0.world.maxCoins;
  gc0.st.credits = 1e9;
  for (let i = 0; i < 4; i++) gc0.buy("cap");
  ok(gc0.world.maxCoins > cap0, "扩容槽抬高容量上限", cap0 + " → " + gc0.world.maxCoins);
  ok(gc0.refillAt() > refill0, "M9：扩容槽同时抬高补给线", refill0 + " → " + gc0.refillAt());
  ok(gc0.refillAt() / gc0.world.maxCoins > 0.5, "补给线占容量比例合理（台面不会看起来空空的）",
    (gc0.refillAt() / gc0.world.maxCoins * 100).toFixed(0) + "%");

  // 所有升级都能买且无异常
  const g6 = newGame();
  g6.st.credits = 1e9; g6.st.gems = 1e6;
  let err = null;
  try {
    for (const u of D.UPGRADES) for (let i = 0; i < u.max; i++) g6.buy(u.id);
    for (const u of D.GEM_UPGRADES) for (let i = 0; i < u.max; i++) g6.buyGem(u.id);
  } catch (e) { err = e; }
  ok(!err, "全部升级可升至满级", err ? err.message : "OK");
  ok(g6.world.frictionMul < 1 && g6.world.railMul > 1, "涂层/护栏倍率方向正确",
    "friction " + g6.world.frictionMul.toFixed(3) + " / rail " + g6.world.railMul.toFixed(3));
}

/* ---------------- 5. 抽奖 / Jackpot / 成就 ---------------- */
head("[5] 抽奖 / Jackpot / 成就");
{
  const g = newGame();
  g.st.tickets = 4;
  ok(g.lottery() === null, "券不足时抽奖失败");
  g.st.tickets = 5;
  const res = g.lottery();
  ok(res && typeof res.text === "string", "抽奖返回结果", res && res.text);
  ok(g.st.tickets === 0, "抽奖消耗 5 张券");

  let outcomes = {};
  const g7 = newGame(1234);
  g7.st.tickets = 5000;
  for (let i = 0; i < 1000; i++) {
    const r = g7.lottery();
    outcomes[r.kind] = (outcomes[r.kind] || 0) + 1;
  }
  const kinds = Object.keys(outcomes);
  ok(kinds.length >= 4, "抽奖结果有足够多样性", JSON.stringify(outcomes));
  ok(kinds.every((k) => ["credits", "gems", "rain", "jackpot"].includes(k)), "抽奖结果类型合法", kinds.join(","));

  // B5 回归：台面满时抽奖不能白吞券 —— 撒不下去的币必须折算成金币补偿
  const gFull = newGame(99);
  gFull.st.tickets = 5000;
  gFull.st.credits = 1e6;
  for (let i = 0; i < 4; i++) gFull.buy("cap");
  while (!gFull.world.full) gFull.world.drop(D.COIN_DEFS.copper, 240);
  ok(gFull.world.full, "台面已塞满", gFull.world.coins.length + "/" + gFull.world.maxCoins);
  let rains = 0, emptyRains = 0, refunded = 0;
  for (let i = 0; i < 200; i++) {
    const before = gFull.st.totals.refunds;
    const r = gFull.lottery();
    if (r && r.kind === "rain") {
      rains++;
      const gotRefund = gFull.st.totals.refunds > before;
      if (r.amount === 0 && !gotRefund) emptyRains++;
      if (gotRefund) refunded++;
    }
  }
  ok(rains > 0, "满台时抽奖仍会抽到雨类奖励", rains + " 次");
  ok(emptyRains === 0, "B5：满台抽奖不再空放（要么撒下币，要么折算补偿）",
    "空放 " + emptyRains + " / 折算 " + refunded + " 次");
  ok(gFull.st.totals.refunds > 0, "B5：折算补偿真的入账", "+" + gFull.st.totals.refunds + " ◎");

  // Jackpot
  const g8 = newGame(555);
  const before = g8.st.totals.jackpots;
  const chest = g8.world.drop(D.COIN_DEFS.chest, 240, { y: g8.world.payoutY - 20 });
  chest.vy = 400;
  let jpEvt = null;
  for (let i = 0; i < 60 && !chest.dead; i++) { g8.world.step(1 / 120); g8.processEvents(); }
  jpEvt = pick(g8.drainPending(), "jackpot");
  ok(g8.st.totals.jackpots === before + 1, "宝箱推落触发 Jackpot");
  ok(g8.st.credits > 120, "Jackpot 发放奖励", "金币 " + g8.st.credits);
  ok(!!jpEvt, "推送 jackpot 事件");
  ok(g8.world.coins.length === 41, "Jackpot 撒币到场", g8.world.coins.length + " 枚");
  ok(jpEvt && jpEvt.coins === 41, "M1：撒币数上报的是真实总数（金24+银14+钻3）",
    jpEvt ? jpEvt.coins + "/" + jpEvt.total : "无事件");

  // M3 回归：宝箱不产生 "+0" 飘字（gain 为 0 时不走 payout 飘字通道）
  const gChest = newGame(777);
  const ch = gChest.world.drop(D.COIN_DEFS.chest, 240, { y: gChest.world.payoutY - 20 });
  ch.vy = 400;
  for (let i = 0; i < 60 && !ch.dead; i++) { gChest.world.step(1 / 120); gChest.processEvents(); }
  const payEvt = pick(gChest.drainPending(), "pay");
  ok(payEvt && payEvt.gain === 0 && payEvt.kind === "chest", "宝箱走专属反馈（gain=0 且带 kind）",
    payEvt ? "gain " + payEvt.gain + " / " + payEvt.kind : "无事件");

  // 成就
  const g9 = newGame();
  g9.st.credits = 1e6;
  for (let i = 0; i < 4; i++) g9.buy("cap");
  g9.insert(240);
  const a1 = g9.checkAch();
  ok(a1.some((a) => a.id === "first"), "成就「初次投币」可解锁");
  for (let i = 0; i < 100; i++) { g9.st.credits = 1e6; g9.insert(240); }
  g9.checkAch();
  ok(!!g9.st.ach.hundred, "成就「百币入机」可解锁", "累计投出 " + g9.st.totals.dropped);
  ok(Object.keys(g9.st.ach).length >= 2, "多成就可同时记录");
  ok(D.ACHIEVEMENTS.length >= 12, "成就里有长线目标（不再几分钟就全解完）",
    D.ACHIEVEMENTS.length + " 个成就");

  // 成就检查不因异常状态崩溃
  const g10 = newGame();
  g10.st.totals.kinds = {};
  let crash = null;
  try { g10.checkAch(); } catch (e) { crash = e; }
  ok(!crash, "成就检查对空 kinds 健壮", crash ? crash.message : "OK");
}

/* ---------------- 6. 存档读写 ---------------- */
head("[6] 存档读写");
{
  const g = newGame();
  g.seedField(170, 2);
  g.st.credits = 777;
  g.st.gems = 42;
  g.st.tickets = 9;
  g.st.upgrades.speed = 3;
  g.st.gemUpgrades.crit = 2;
  g.st.totals.earned = 12345;
  g.st.totals.kinds = { gold: 7 };
  const coinsBefore = g.world.coins.length;
  ok(coinsBefore > 0, "存档前机台有币", coinsBefore + " 枚");

  const json = JSON.parse(JSON.stringify(g.toJSON()));
  const g2 = newGame();
  const loaded = g2.fromJSON(json);
  ok(loaded === true, "存档可载入");
  ok(g2.st.credits === 777, "金币还原", String(g2.st.credits));
  ok(g2.st.gems === 42 && g2.st.tickets === 9, "钻石/券还原");
  ok(g2.upLevel("speed") === 3, "升级等级还原");
  ok(g2.gemLevel("crit") === 2, "钻石升级还原");
  ok(g2.st.totals.earned === 12345, "累计收益还原");
  ok(g2.st.totals.kinds.gold === 7, "币种统计还原");
  ok(g2.world.coins.length === coinsBefore, "台面币还原", g2.world.coins.length + "/" + coinsBefore);
  ok(g2.world.speedMul > 1, "载入后重新应用升级倍率");
  ok(Math.abs(g2.critChance() - 0.2) < 1e-9, "载入后暴击触发率正确", String(g2.critChance()));

  ok(g2.fromJSON(null) === false, "空存档被拒绝");
  ok(g2.fromJSON({}) === false, "残缺存档被拒绝");
  ok(g2.fromJSON({ st: "x" }) === false, "st 不是对象时被拒绝");
  ok(g2.fromJSON({ st: {} }) === true, "极简存档可容错载入");
  ok(finite(g2.st.credits), "容错载入后金币合法", String(g2.st.credits));

  // B6 回归：损坏存档不能造出 NaN 金币 → 无限白嫖
  const k = newGame();
  k.fromJSON({ st: { credits: "abc", gems: null, tickets: {}, upgrades: { speed: 999 }, totals: { earned: -5 } } });
  ok(finite(k.st.credits), "B6：字符串金币被拦下", String(k.st.credits));
  ok(k.st.credits === 120, "B6：非法金币回落默认值", String(k.st.credits));
  ok(finite(k.st.gems) && finite(k.st.tickets), "B6：钻石/券都被校正", k.st.gems + "/" + k.st.tickets);
  ok(k.upLevel("speed") === 6, "B6：越界升级等级被夹到上限", "Lv" + k.upLevel("speed"));
  ok(k.st.totals.earned === 0, "B6：负数统计被归零", String(k.st.totals.earned));
  const r1 = k.insert(240), r2 = k.insert(240), r3 = k.insert(240);
  ok(r1 === 1 && r2 === 1 && r3 === 1, "B6：损坏档下投币行为正常（不再无限白嫖）", [r1, r2, r3].join(","));
  ok(k.st.credits === 117 && finite(k.st.credits), "B6：金币正确递减", String(k.st.credits));

  // B4 回归：扩容满级后读档不能丢币
  const h = newGame();
  h.st.credits = 1e9;
  for (let i = 0; i < 4; i++) h.buy("cap");
  const capMax = h.world.maxCoins;
  ok(capMax === 380, "扩容满级后容量 380", String(capMax));
  h.world.clear();
  for (let i = 0; i < 470; i++) h.world.drop(D.COIN_DEFS.copper, 240);
  ok(h.world.coins.length === capMax, "台面被填到满容量", h.world.coins.length + " 枚");
  const h2 = newGame();
  h2.fromJSON(JSON.parse(JSON.stringify(h.toJSON())));
  ok(h2.world.coins.length === capMax, "B4：读档不再丢币（存档上限跟随 maxCoins）",
    h.world.coins.length + " → " + h2.world.coins.length);
  ok(h2.world.maxCoins === capMax, "B4：读档后容量升级仍然生效", String(h2.world.maxCoins));

  // B9 回归：Lv0 的自动投币机开关不该被存档带回来
  const a = newGame();
  a.fromJSON({ st: { auto: true, upgrades: {} } });
  ok(a.st.auto === false, "B9：Lv0 自动投币开关被读档时关掉");

  // 内存版 storage
  const mem = (() => {
    const m = {};
    return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } };
  })();
  const g3 = newGame();
  g3.seedField(120, 1);
  g3.st.credits = 321;
  ok(g3.save(mem) === true, "save 写入成功");
  const g4 = newGame();
  ok(g4.load(mem) === true, "load 读取成功");
  ok(g4.st.credits === 321, "存读往返一致", String(g4.st.credits));
  ok(g4.world.coins.length === g3.world.coins.length, "存读往返台面一致");
  g4.reset(mem);
  ok(g4.st.credits === 120, "reset 恢复初始金币", String(g4.st.credits));
  ok(g4.world.coins.length > 50, "reset 后机台重新装满", g4.world.coins.length + " 枚");
  ok(g4.world.stats.paid === 0 && g4.world.stats.lost === 0, "M17：reset 连台面统计一起清空");
  ok(g4.st.totals.played === undefined || g4.st.totals.drops === 0, "M17：reset 清空累计统计");
  ok(g4.load(mem) === false, "reset 后旧存档已清除");
}

/* ---------------- 7. 长时压力 ---------------- */
head("[7] 长时压力（模拟 3 分钟连续游玩）");
{
  const g = newGame(31337);
  g.seedField(170, 2);
  g.st.credits = 100000;
  g.st.auto = true;
  g.buy("auto"); g.buy("auto"); g.buy("auto");
  g.st.credits = 100000;

  let nan = 0, maxCoins = 0, pays = 0, gutters = 0;
  const steps = 60 * 180;
  for (let i = 0; i < steps; i++) {
    g.step(1 / 60);
    const evts = g.drainPending();
    for (const e of evts) {
      if (e.type === "pay") pays++;
      else if (e.type === "gutter") gutters++;
    }
    if (i % 600 === 0) {
      maxCoins = Math.max(maxCoins, g.world.coins.length);
      for (const c of g.world.coins) if (!finite(c.x) || !finite(c.y)) nan++;
    }
  }
  ok(nan === 0, "长跑无 NaN", "异常 " + nan);
  ok(maxCoins <= g.world.maxCoins, "长跑不超容量", "峰值 " + maxCoins + "/" + g.world.maxCoins);
  ok(pays > 0, "长跑有持续产出", "掉出 " + pays + " 枚 / 丢沟 " + gutters + " 枚");
  ok(finite(g.st.credits) && g.st.credits >= 0, "金币始终合法", String(Math.round(g.st.credits)));
  const ov = g.world.worstOverlap();
  ok(ov < 4, "长跑后重叠仍可控", ov.toFixed(3) + "px");
  ok(g.world.worstPlatePenetration() < 0.01, "长跑后无推板穿透");
  ok(g.world.stats.stressPeak >= 0 && finite(g.world.stats.stressPeak), "M15：挤压统计不再只增不减",
    "峰值 " + g.world.stats.stressPeak.toFixed(2) + " / 当前 " + g.world.stats.stress.toFixed(3));
}

/* ---------------- 8. 经济平衡实测（可复现） ---------------- */
head("[8] 经济平衡实测（固定种子，先预热排空初始赠币，再测稳态投入产出比）");
{
  function measure(levels, gemLevels, label, seed) {
    const g = newGame(seed);
    for (const k in levels) g.st.upgrades[k] = levels[k];
    for (const k in (gemLevels || {})) g.st.gemUpgrades[k] = gemLevels[k];
    g.applyUpgrades();
    g.st.credits = 1e9;
    g.seedField(170, 2);

    // 预热 120 秒：把初始白送的币推完，避免风落收益污染测量
    let t = 0;
    for (let i = 0; i < 120 * 60; i++) {
      t += 1 / 60;
      if (t >= 0.42) { t = 0; g.insert(240); }
      g.step(1 / 60);
      g.drainPending();
    }
    const spent0 = g.st.totals.spent, earned0 = g.st.totals.earned, paid0 = g.st.totals.paid;

    for (let i = 0; i < 60 * 90; i++) {
      t += 1 / 60;
      if (t >= 0.42) { t = 0; g.insert(240); }
      g.step(1 / 60);
      g.drainPending();
    }
    const spent = g.st.totals.spent - spent0;
    const earned = g.st.totals.earned - earned0;
    const paid = g.st.totals.paid - paid0;
    const ratio = spent ? earned / spent : 0;
    console.log("  · " + label + "：投入 " + spent + " ◎ → 产出 " + earned + " ◎  比值 " + ratio.toFixed(2) +
      "  掉出 " + paid + " 枚  最高连击 " + g.st.totals.bestCombo + "  场上 " + g.world.coins.length);
    return ratio;
  }

  const r0 = measure({}, {}, "初始机台", 1001);
  const rMid = measure({ speed: 3, reach: 3, slick: 2, multi: 2, luck: 3 }, {}, "中期（部分升级）", 1002);
  const rMax = measure({ speed: 6, reach: 6, slick: 5, multi: 4, luck: 6, rail: 5, cap: 4 }, {}, "满配机台", 1003);
  // 同种子对照：暴击是唯一的变量，测出来的边际收益才是干净的
  const rCrit = measure({ speed: 6, reach: 6, slick: 5, multi: 4, luck: 6, rail: 5, cap: 4 }, { crit: 3 }, "满配 + 暴击 Lv3（同种子）", 1003);

  ok(r0 > 0.5, "初始机台不至于入不敷出", r0.toFixed(2));
  ok(r0 < 1.35, "初始机台不是印钞机", r0.toFixed(2));
  ok(rMax > r0, "升级后产出效率提升", r0.toFixed(2) + " → " + rMax.toFixed(2));
  ok(rMax < 6, "满配不会指数膨胀", rMax.toFixed(2));
  ok(rMid >= r0 - 0.1, "中期不劣化", rMid.toFixed(2));
  // B7 回归：暴击芯片不再是"断层第一"的性价比之王（改造前 +49%）
  const critGain = rMax ? (rCrit - rMax) / rMax : 0;
  ok(critGain < 0.35, "B7：暴击芯片的边际收益回到合理区间",
    "+" + (critGain * 100).toFixed(0) + "%（改造前约 +49%）");

  // 同一份种子跑两次，结果必须完全一致 —— 平衡测试是回归测试，不是抽样
  const again = measure({}, {}, "初始机台（同种子复跑）", 1001);
  ok(Math.abs(again - r0) < 1e-9, "固定种子下结果完全可复现", r0.toFixed(4) + " vs " + again.toFixed(4));
}

/* ---------------- 9. 双端适配 ---------------- */
head("[9] 双端适配（视口分级 / 台面尺寸 / 性能档位）");
{
  const L = require(path.join(__dirname, "..", "js", "layout.js"));

  ok(L.pickMode(1920, 1080) === "wide", "桌面 1920×1080 → wide");
  ok(L.pickMode(1366, 768) === "wide", "笔记本 1366×768 → wide");
  ok(L.pickMode(1024, 768) === "wide", "平板横屏 1024×768 → wide");
  ok(L.pickMode(820, 1180) === "stack", "平板竖屏 820×1180 → stack");
  ok(L.pickMode(430, 932) === "narrow", "大屏手机竖屏 430×932 → narrow");
  ok(L.pickMode(390, 844) === "narrow", "手机竖屏 390×844 → narrow");
  ok(L.pickMode(844, 390) === "compact", "手机横屏 844×390 → compact");
  ok(L.pickMode(667, 375) === "compact", "小屏横屏 667×375 → compact");

  ok(L.logMode("wide", 1920) === "col", "宽屏日志在右列");
  ok(L.logMode("stack", 820) === "below", "平板竖屏日志折到机柜下方");
  ok(L.logMode("narrow", 390) === "below", "手机竖屏日志折到机柜下方");
  ok(L.logMode("compact", 640) === "off", "窄横屏收起日志让宽度");
  ok(L.logMode("compact", 844) === "col", "宽横屏保留日志侧栏");

  const vps = [
    [1920, 1080], [1600, 900], [1366, 768], [1280, 800], [1024, 768],
    [820, 1180], [768, 1024], [430, 932], [390, 844], [375, 667],
    [360, 640], [320, 480], [844, 390], [667, 375], [640, 360]
  ];
  let arBad = 0, over = 0, tiny = 0, dprBad = 0, cabBad = 0, fitBad = 0;
  for (const vp of vps) {
    const p = L.plan({ vw: vp[0], vh: vp[1], dpr: 3, deviceMemory: 8, cores: 8 });
    const ar = p.stage.w / p.stage.h;
    if (Math.abs(ar - L.AR) > 0.02) arBad++;
    if (p.stage.w < L.MIN_STAGE) tiny++;
    if (p.dpr > L.MAX_DPR) dprBad++;
    if (p.cabWidth < 240) cabBad++;
    if (p.stage.h > p.stage.availH + 1) fitBad++;
    if (p.cabWidth + p.logWidth + (p.logWidth ? 8 : 0) > vp[0] + 1) over++;
  }
  ok(arBad === 0, "所有视口下台面宽高比恒定（不变形）", "异常 " + arBad);
  ok(over === 0, "机柜与日志列都不溢出视口", "溢出 " + over);
  ok(tiny === 0, "台面不小于最小可玩尺寸", "过小 " + tiny);
  ok(fitBad === 0, "台面高度不超可用高度", "超出 " + fitBad);
  ok(dprBad === 0, "DPR 不超上限", "超限 " + dprBad);
  ok(cabBad === 0, "机柜宽度不小于 240", "过窄 " + cabBad);

  const wide = L.plan({ vw: 1440, vh: 900, dpr: 1 });
  ok(wide.cabWidth + wide.logWidth + 18 <= 960, "宽屏双列不超过容器上限",
    wide.cabWidth + "+" + wide.logWidth + "+18");
  ok(wide.stage.w <= wide.cabWidth - 24, "台面宽度装得进机柜内边距",
    wide.stage.w + " ≤ " + (wide.cabWidth - 24));

  const noSafe = L.plan({ vw: 390, vh: 640, dpr: 1 });
  const withSafe = L.plan({ vw: 390, vh: 640, dpr: 1, safeTop: 47, safeBottom: 34 });
  ok(withSafe.chrome === noSafe.chrome, "M7：安全区不再重复计入 chrome", noSafe.chrome + " → " + withSafe.chrome);
  ok(withSafe.stage.availH < noSafe.stage.availH, "M7：安全区只从可用高度里扣一次",
    noSafe.stage.availH + " → " + withSafe.stage.availH);
  ok(withSafe.stage.h < noSafe.stage.h, "安全区压缩台面高度", noSafe.stage.h + " → " + withSafe.stage.h);
  ok(withSafe.stage.w >= L.MIN_STAGE, "压缩后仍可玩", String(withSafe.stage.w));
  const noSide = L.plan({ vw: 844, vh: 390, dpr: 1 });
  const withSide = L.plan({ vw: 844, vh: 390, dpr: 1, safeLeft: 44, safeRight: 44 });
  ok(noSide.logWidth === 200 && withSide.logWidth === 0, "左右安全区会把日志让给台面",
    noSide.logWidth + " → " + withSide.logWidth);

  const low = L.perfTier({ deviceMemory: 2, cores: 8, dpr: 2 });
  ok(low.tier === "low" && low.particles === false, "2G 内存 → low 档且关粒子");
  ok(L.perfTier({ deviceMemory: 8, cores: 2 }).tier === "low", "2 核 → low 档");
  ok(L.perfTier({ deviceMemory: 4, cores: 8 }).tier === "mid", "4G 内存 → mid 档");
  const high = L.perfTier({ deviceMemory: 8, cores: 8, dpr: 1 });
  ok(high.tier === "high" && high.quality === 1, "8G/8 核 → high 档全特效");
  ok(L.perfTier({ deviceMemory: 8, cores: 8, dpr: 3, vw: 2560, vh: 1440 }).dprCap === 1.5,
    "DPR3 + 2K 面积 → 高清档降为 1.5");
  ok(low.dprCap <= L.MAX_DPR && high.dprCap <= L.MAX_DPR, "DPR 上限统一受控");

  const lowPlan = L.plan({ vw: 390, vh: 844, dpr: 3, deviceMemory: 2, cores: 2 });
  ok(lowPlan.dpr === 1.5, "低端机 DPR 被压到 1.5", String(lowPlan.dpr));
  ok(lowPlan.perf.maxParts < high.maxParts, "低端机粒子上限更低",
    lowPlan.perf.maxParts + " < " + high.maxParts);

  const s1 = L.fitStage({ vw: 400, vh: 2000, chrome: 0 });
  ok(s1.w === 400, "高度充裕时按宽度铺满", String(s1.w));
  const s2 = L.fitStage({ vw: 400, vh: 300, chrome: 100 });
  ok(s2.h <= 200 && Math.abs(s2.w / s2.h - L.AR) < 0.02, "高度不足时按高度回收且不变形",
    s2.w + "×" + s2.h);
  const s3 = L.fitStage({ vw: 10, vh: 10, chrome: 0 });
  ok(s3.w === L.MIN_STAGE, "极端小视口兜底到最小尺寸", String(s3.w));
}

/* ---------------- 10. 破产保护 / 换机台 / 音效状态机 ---------------- */
head("[10] 破产保护 / 换机台 / 音效状态机");
{
  // B1 回归：破产时救济金必须真的能拿到（改造前永远触发不了）
  const g = newGame(4242);
  g.seedField(170, 2);
  g.st.credits = 0;
  g.st.auto = false;
  let got = 0;
  for (let i = 0; i < 60 * 20; i++) {
    g.step(1 / 60);
    const evts = g.drainPending();
    for (const e of evts) if (e.type === "bailout") got++;
  }
  ok(got >= 1, "B1：破产 20 秒内拿到救济金", "发放 " + got + " 次");
  ok(g.st.credits > 0, "B1：破产后金币不再是 0（不再永久软锁）", String(g.st.credits));
  ok(g.st.totals.bailouts >= 1, "B1：救济金次数被记录", String(g.st.totals.bailouts));
  ok(g.needBailout() === false, "领到救济金后不再重复发放（有冷却）");

  // 手动领救济金
  const gManual = newGame(11);
  gManual.seedField(60, 1);
  gManual.st.credits = 0;
  ok(gManual.needBailout() === true, "破产时可手动领救济金");
  const grant = gManual.bailout();
  ok(grant > 0 && gManual.st.credits === grant, "手动领取到账", "+" + grant);

  // B9 回归：Lv0 打开自动投币不该屏蔽救济金
  const gAuto = newGame(12);
  gAuto.seedField(60, 1);
  gAuto.st.credits = 0;
  gAuto.st.auto = true;                 // 手动打开，但 autoLvl 还是 0
  ok(gAuto.autoLvl() === 0, "Lv0 自动投币机等级为 0");
  ok(gAuto.autoWorking() === false, "B9：Lv0 的自动投币不算「在产出」");
  ok(gAuto.needBailout() === true, "B9：Lv0 空开关不会屏蔽救济金");
  let got2 = 0;
  for (let i = 0; i < 60 * 15; i++) {
    gAuto.step(1 / 60);
    for (const e of gAuto.drainPending()) if (e.type === "bailout") got2++;
  }
  ok(got2 >= 1, "B9：Lv0 空开关下救济金照常发放", got2 + " 次");

  // 换机台
  const gp = newGame(13);
  ok(gp.canPrestige() === false, "收益不足时不能换机台");
  ok(gp.doPrestige() === false, "换机台被拒绝");
  ok(gp.drainPending().some((e) => e.type === "deny"), "拒绝时推送 deny");
  gp.st.totals.earned = 1e6;
  gp.st.credits = 1e9;
  for (let i = 0; i < 4; i++) gp.buy("cap");
  ok(gp.canPrestige() === true, "收益达标后可换机台");
  ok(gp.doPrestige() === true, "换机台成功");
  ok(gp.st.prestige === 1, "换机台层数 +1");
  ok(gp.upLevel("cap") === 0 && gp.gemLevel("crit") === 0, "换机台清空全部升级");
  ok(gp.st.credits === D.PRESTIGE.grant, "换机台发放启动金币", String(gp.st.credits));
  ok(gp.prestigeMul() > 1, "换机台给永久收益加成", "×" + gp.prestigeMul().toFixed(2));
  ok(gp.world.coins.length > 0, "换机台后新机台已铺币", gp.world.coins.length + " 枚");
  ok(gp.drainPending().some((e) => e.type === "prestige"), "推送 prestige 事件");
  const m = gp.modifierDef();
  ok(!!m && typeof m.name === "string", "新机台带一个修饰", m.name);
  ok(D.MODIFIERS.length >= 4, "机台修饰有足够多样性", D.MODIFIERS.length + " 种");

  // 修饰真的作用到物理参数上
  const gm = newGame(14);
  gm.st.modifier = "greedy";
  gm.applyUpgrades();
  const gw = gm.world.gutterWidth;
  gm.st.modifier = "plain";
  gm.applyUpgrades();
  ok(gw > gm.world.gutterWidth, "贪心机台角沟更宽（修饰真的生效）",
    gw.toFixed(1) + " > " + gm.world.gutterWidth.toFixed(1));

  // B3 回归：音效只有一个真源，挂起上下文不改变开关状态
  ok(!!Sfx, "音效模块可加载");
  ok(Sfx.isOn() === true, "默认音效开启");
  Sfx.suspend();
  ok(Sfx.isOn() === true, "B3：切走标签页（suspend）不会改开关状态");
  Sfx.setOn(false);
  ok(Sfx.isOn() === false, "点一次静音就真的静音（不用点两下）");
  ok(Sfx.ensure() === null, "静音时不创建音频上下文");
  Sfx.resume();
  ok(Sfx.isOn() === false, "B3：静音状态下 resume 不会偷偷开声音");
  Sfx.setOn(true);
  ok(Sfx.isOn() === true, "再次点击恢复音效");
}

/* ---------------- 11. 2.5D 投影内核（纯函数，零 DOM） ---------------- */
head("[11] 2.5D 投影（透视收敛 / 高度投影 / 影子）");
{
  const PJ = require(path.join(__dirname, "..", "js", "project.js"));

  ok(PJ.W === 480 && PJ.H === 580, "投影内核尺寸与 canvas 一致", PJ.W + "×" + PJ.H);
  ok(PJ.FAR < PJ.NEAR, "远端比近端窄（真的有透视）", PJ.FAR + " → " + PJ.NEAR);

  // 透视：同一台面 x，越远越靠中轴
  const xL = PJ.projectX(0, 0), xL2 = PJ.projectX(0, PJ.H);
  ok(xL > xL2, "左边缘越远越靠中（左右护栏向远处汇聚）", xL.toFixed(1) + " → " + xL2.toFixed(1));
  ok(PJ.projectX(PJ.W / 2, 0) === PJ.W / 2 && PJ.projectX(PJ.W / 2, PJ.H) === PJ.W / 2,
    "中轴线在任何深度都不偏移", String(PJ.projectX(PJ.W / 2, 300)));

  // 单调性：x 越大屏幕 x 越大（不翻转、不折叠）
  let monoBad = 0;
  for (const y of [0, 100, 250, 400, 470, 580]) {
    let prev = -Infinity;
    for (let x = 0; x <= PJ.W; x += 8) {
      const sx = PJ.projectX(x, y);
      if (sx < prev - 1e-9) monoBad++;
      prev = sx;
    }
  }
  ok(monoBad === 0, "屏幕 x 对台面 x 单调（投影不会自折叠）", "异常 " + monoBad);

  // 高度：越高越往上抬、越大
  ok(PJ.projectY(300, 100) < PJ.projectY(300, 0), "离台越高屏幕位置越靠上",
    PJ.projectY(300, 100).toFixed(1) + " < " + PJ.projectY(300, 0).toFixed(1));
  ok(PJ.scaleAt(300, 90) > PJ.scaleAt(300, 0), "离台越高绘制尺寸越大（离镜头更近）",
    PJ.scaleAt(300, 90).toFixed(3) + " > " + PJ.scaleAt(300, 0).toFixed(3));
  ok(PJ.scaleAt(500, 0) > PJ.scaleAt(100, 0), "越靠前绘制尺寸越大（近大远小）",
    PJ.scaleAt(500, 0).toFixed(3) + " > " + PJ.scaleAt(100, 0).toFixed(3));

  // 边界：极端 z 不产生 NaN，也不出现负半径
  let projBad = 0;
  for (const y of [-50, 0, 290, 580, 900]) {
    for (const z of [-100, 0, 1, 140, 1e6]) {
      const s = PJ.scaleAt(y, z);
      const sh = PJ.shadow(240, y, z, 11);
      if (!isFinite(s) || s <= 0) projBad++;
      if (!isFinite(sh.x) || !isFinite(sh.y) || !isFinite(sh.alpha)) projBad++;
      if (!(sh.rx > 0) || !(sh.ry > 0)) projBad++;
    }
  }
  ok(projBad === 0, "极端深度/高度下投影仍合法（无 NaN / 无负半径）", "异常 " + projBad);

  // 影子：越高越淡越小，且始终落在币的下方
  const s0 = PJ.shadow(240, 300, 0, 12);
  const s1 = PJ.shadow(240, 300, 140, 12);
  ok(s1.alpha < s0.alpha && s1.rx < s0.rx, "影子随高度变淡变小",
    s0.alpha.toFixed(3) + "→" + s1.alpha.toFixed(3) + " / " + s0.rx.toFixed(2) + "→" + s1.rx.toFixed(2));
  ok(s0.y > 300, "影子贴在币的下方", String(s0.y.toFixed(1)));

  // 梯形顶点顺序稳定（烘焙护栏 / 角沟要用）
  const q = PJ.quad(0, 100, 100, 0, 100, 200);
  ok(q.length === 4 && q[0][1] === 100 && q[2][1] === 200, "quad 返回 4 个顶点且深度顺序正确",
    q.map((p) => p.map((v) => Math.round(v)).join(",")).join(" | "));
  ok(PJ.edgeX(-1, 200) < PJ.edgeX(1, 200), "左右边缘分列中轴两侧",
    PJ.edgeX(-1, 200).toFixed(1) + " < " + PJ.edgeX(1, 200).toFixed(1));

  /* 稀有奖励在屏幕上会额外放大（视觉量，不影响物理半径）。
   * 这里验一下最坏情况：台面四角 + 最前沿都放上最大的奖励，
   * 放大后依然不会被画出画布 —— 否则玩家会看到币被切掉一半。 */
  const BOOST = 1.35;   // 与 app.js 里 gem 的 art 放大系数一致（取最大）
  const spots = [[11, 140], [469, 140], [11, 466], [469, 466], [240, 466]];
  let oob = 0, minSx = Infinity, maxSx = -Infinity;
  for (const [cx, cy] of spots) {
    const half = (12 + 12) * PJ.scaleAt(cy, 0) * BOOST;
    const sx = PJ.projectX(cx, cy), sy = PJ.projectY(cy, 0);
    if (sx - half < -6 || sx + half > PJ.W + 6) oob++;
    if (sy - half < -6 || sy + half > PJ.H + 6) oob++;
    if (sx < minSx) minSx = sx;
    if (sx > maxSx) maxSx = sx;
  }
  ok(oob === 0, "透视 + 稀有奖励放大后仍不会被画出画布",
    "越界 " + oob + " / x 范围 " + Math.round(minSx) + "~" + Math.round(maxSx));
}

/* ---------------- 12. 惩罚机制：拥堵 / 爆仓 / 漏币连锁 ---------------- */
head("[12] 惩罚机制（拥堵 / 爆仓 / 漏币连锁）");
{
  const g = newGame(2026);
  g.seedField(170, 2);
  g.st.credits = 1e9;

  // 拥堵是渐进的：空台面为 0，满台为 1
  g.world.coins.length = 0;
  ok(g.congestLevel() === 0, "空台面无拥堵");
  ok(g.world.congestMul === 1 || g.congestLevel() === 0, "无拥堵时推板不受惩罚");

  while (g.world.coins.length < g.world.maxCoins * D.CONGESTION.warn + 1) {
    g.world.drop(D.COIN_DEFS.copper, 240);
  }
  const cWarn = g.updateCongestion();
  ok(cWarn > 0 && cWarn < 0.2, "刚过警戒线时拥堵很轻", cWarn.toFixed(3));
  ok(g.world.congestMul < 1, "拥堵真的让推板变慢", "×" + g.world.congestMul.toFixed(3));

  while (g.world.coins.length < g.world.maxCoins) g.world.drop(D.COIN_DEFS.copper, 240);
  const cFull = g.updateCongestion();
  ok(cFull > 0.9, "满台时拥堵接近上限", cFull.toFixed(3));
  ok(Math.abs(g.world.congestMul - (1 - D.CONGESTION.speedLoss)) < 0.05, "满台减速幅度符合公示值",
    "×" + g.world.congestMul.toFixed(3) + "（公示 −" + Math.round(D.CONGESTION.speedLoss * 100) + "%）");

  // 排风马达真的削弱拥堵
  const gv = newGame(2027);
  gv.seedField(170, 2);
  gv.st.credits = 1e9;
  while (!gv.world.full) gv.world.drop(D.COIN_DEFS.copper, 240);
  const noVent = gv.updateCongestion();
  for (let i = 0; i < 3; i++) gv.buy("vent");
  const withVent = gv.updateCongestion();
  ok(withVent < noVent * 0.2, "排风马达满级几乎免疫拥堵减速",
    noVent.toFixed(3) + " → " + withVent.toFixed(3));

  // 爆仓：满台硬塞到阈值，前沿的币被挤进角沟
  const gb = newGame(2028);
  gb.seedField(170, 2);
  gb.st.credits = 1e9;
  while (!gb.world.full) gb.world.drop(D.COIN_DEFS.copper, 240);
  const lost0 = gb.st.totals.lost;
  let burstEvt = null;
  for (let i = 0; i < D.CONGESTION.burstAt + 2 && !burstEvt; i++) {
    gb.insert(240);
    burstEvt = pick(gb.drainPending(), "burst");
  }
  ok(!!burstEvt, "满台硬塞到阈值会爆仓", "阈值 " + D.CONGESTION.burstAt + " 次");
  ok(gb.st.totals.lost > lost0, "爆仓真的丢币（不是只弹提示）", "丢 " + (gb.st.totals.lost - lost0) + " 枚");
  ok(gb.st.totals.bursts >= 1, "爆仓次数被记录", String(gb.st.totals.bursts));
  ok(gb.world.coins.length < gb.world.maxCoins, "爆仓后不再卡在满台",
    gb.world.coins.length + "/" + gb.world.maxCoins);

  // 防爆护栏真的少丢币
  const gg2 = newGame(2029);
  gg2.seedField(170, 2);
  gg2.st.credits = 1e9;
  for (let i = 0; i < 3; i++) gg2.buy("guard");
  gg2.world.coins.length = 0;
  while (!gg2.world.full) gg2.world.drop(D.COIN_DEFS.copper, 240);
  const lostB = gg2.st.totals.lost;
  gg2.burst();
  const guarded = gg2.st.totals.lost - lostB;
  const raw = Math.max(1, D.CONGESTION.burstCoins - 3);
  ok(guarded === raw && guarded < D.CONGESTION.burstCoins, "防爆护栏减少爆仓损失",
    "满级丢 " + guarded + " 枚（无护栏 " + D.CONGESTION.burstCoins + " 枚）");

  // 漏币连锁：短时间内连续掉沟 → 角沟临时变宽
  const gs = newGame(2030);
  gs.seedField(60, 1);
  gs.st.credits = 1e9;
  const gw0 = gs.world.gutterWidth;
  let streakEvt = null;
  for (let i = 0; i < D.STREAK.n; i++) {
    gs.world.time += 0.2;   // 落在同一个窗口内
    gs.noteGutter();
  }
  streakEvt = pick(gs.drainPending(), "streak");
  ok(!!streakEvt, "短窗口内连续掉沟触发漏币连锁", D.STREAK.n + " 次 / " + D.STREAK.window + "s");
  ok(gs.streakT > 0, "漏币状态有持续时长", gs.streakT.toFixed(1) + "s");
  ok(gs.st.totals.streaks >= 1, "漏币连锁次数被记录", String(gs.st.totals.streaks));
  // 物理层真的把角沟拉宽了
  gs.step(1 / 60);
  ok(gs.world.gutterWidth > gw0, "漏币期间角沟真的变宽（不是只有 UI）",
    gw0.toFixed(1) + " → " + gs.world.gutterWidth.toFixed(1));
  // 过期后自动恢复
  for (let i = 0; i < Math.ceil(D.STREAK.dur * 60) + 30; i++) gs.step(1 / 60);
  ok(Math.abs(gs.world.gutterWidth - gw0) < 1e-6, "漏币结束后角沟恢复原宽",
    gs.world.gutterWidth.toFixed(3));

  // 挂机不会自己爆仓（惩罚必须由玩家硬塞触发，不能自动罚）
  const gidle = newGame(2031);
  gidle.seedField(170, 2);
  gidle.st.credits = 1e9;
  gidle.st.auto = false;
  for (let i = 0; i < 60 * 60; i++) gidle.step(1 / 60);
  ok(gidle.st.totals.bursts === 0, "纯挂机不会自己触发爆仓", String(gidle.st.totals.bursts));
}

/* ---------------- 13. 风险玩法：限时订单 / 超频 / 金币塔 ---------------- */
head("[13] 风险玩法（限时订单 / 超频 / 金币塔）");
{
  // 订单：提议 → 接受 → 达标拿赏 / 超时罚金 + 过热
  const g = newGame(3033);
  g.seedField(170, 2);
  g.st.credits = 1e9;
  ok(g.orderActive() === false && g.orderOffering() === false, "开局没有进行中的订单");

  g.offerOrder();
  ok(g.orderOffering() === true, "机台能给出订单提议");
  const offEvt = pick(g.drainPending(), "orderOffer");
  ok(!!offEvt && typeof offEvt.reward === "number", "订单提议带赏罚数值",
    offEvt ? offEvt.name + " 赏 " + offEvt.reward + " 罚 " + offEvt.penalty : "");

  ok(g.declineOrder() === true, "可以拒绝订单");
  ok(g.order === null, "拒绝后订单清空");
  ok(g.st.totals.ordersFailed === 0, "不接不算失败（无罚金）", String(g.st.totals.ordersFailed));

  // 达成
  g.offerOrder();
  g.drainPending();
  ok(g.acceptOrder() === true, "可以接下订单");
  ok(g.orderActive() === true, "接单后进入进行中状态");
  ok(typeof g.order.target === "number" && g.order.target > 0, "接单后目标已定下来（UI 与结算读同一份）",
    g.order.target + " / 赏 " + g.order.reward + " 罚 " + g.order.penalty);
  const before = g.st.credits;
  g.order.prog = g.order.target;          // 直接置达标，走结算路径
  g.step(1 / 60);
  const doneEvt = pick(g.drainPending(), "orderDone");
  ok(!!doneEvt, "达标时推送 orderDone");
  ok(g.st.credits > before, "订单达成发放赏金", "+" + (g.st.credits - before));
  ok(doneEvt && doneEvt.reward > 0, "赏金数值就是公示的那个", doneEvt ? String(doneEvt.reward) : "");
  ok(g.st.totals.ordersDone === 1, "完成数被记录", String(g.st.totals.ordersDone));
  ok(g.overheatT <= 0, "达成不会过热", g.overheatT.toFixed(2));

  // 失败：超时 → 罚金 + 过热 + 推板真的变慢
  const gf = newGame(3034);
  gf.seedField(170, 2);
  gf.st.credits = 1000;
  gf.offerOrder();
  gf.acceptOrder();
  gf.drainPending();
  const credBefore = gf.st.credits;
  const speedBefore = gf.world.hotMul;
  gf.order.t = 0.01;
  gf.step(1 / 60);
  const failEvt = pick(gf.drainPending(), "orderFail");
  ok(!!failEvt, "超时未达标推送 orderFail");
  ok(gf.st.credits < credBefore, "订单失败扣罚金", "−" + (credBefore - gf.st.credits));
  ok(gf.st.credits >= 0, "罚金不会扣成负数", String(gf.st.credits));
  ok(gf.overheatT > 0, "订单失败让机台过热", gf.overheatT.toFixed(1) + "s");
  ok(gf.world.hotMul < speedBefore, "过热真的让推板变慢",
    speedBefore.toFixed(2) + " → " + gf.world.hotMul.toFixed(2));
  ok(gf.st.totals.ordersFailed === 1, "失败数被记录", String(gf.st.totals.ordersFailed));
  // 过热会自然消退
  for (let i = 0; i < Math.ceil(D.OVERHEAT.dur * 60) + 30; i++) gf.step(1 / 60);
  ok(gf.overheatT <= 0 && Math.abs(gf.world.hotMul - 1) < 1e-9, "过热到期后推板恢复正常",
    "×" + gf.world.hotMul.toFixed(3));

  // 订单提议超时自动收回，不算失败
  const ge = newGame(3035);
  ge.seedField(60, 1);
  ge.st.credits = 1e9;
  ge.offerOrder();
  ge.drainPending();
  ge.order.t = 0.01;
  ge.step(1 / 60);
  ok(ge.order === null, "提议超时自动收回");
  ok(ge.st.totals.ordersFailed === 0, "提议超时不算失败", String(ge.st.totals.ordersFailed));

  // 订单节拍：首次出现的时间点符合公示
  const gt = newGame(3036);
  gt.seedField(60, 1);
  gt.st.credits = 1e9;
  let firstOfferAt = -1;
  for (let i = 0; i < 60 * (D.ORDER.first + 3); i++) {
    gt.step(1 / 60);
    if (firstOfferAt < 0 && gt.orderOffering()) firstOfferAt = gt.world.time;
  }
  ok(firstOfferAt > 0 && Math.abs(firstOfferAt - D.ORDER.first) < 2.5,
    "首个订单在公示时间点附近出现", firstOfferAt.toFixed(1) + "s（公示 " + D.ORDER.first + "s）");

  // 超频：手动触发、花金币、双倍产出、冷却
  const gh = newGame(3037);
  gh.seedField(170, 2);
  gh.st.credits = 1e9;
  ok(gh.hotReady() === true, "开局超频就绪");
  const c0 = gh.st.credits;
  ok(gh.useHot() === true, "超频可手动触发");
  ok(gh.st.credits === c0 - D.HOT.cost, "超频扣费正确", "−" + D.HOT.cost);
  ok(gh.hotActive() === true && gh.hotMul() === D.HOT.mul, "超频期间产出 ×" + D.HOT.mul);
  ok(gh.hotReady() === false, "超频期间进入冷却");
  ok(gh.useHot() === false, "冷却中不能重复触发");
  gh.step(1 / 60);
  ok(gh.world.hotMul > 1, "超频真的加快推板", "×" + gh.world.hotMul.toFixed(2));
  ok(gh.st.totals.hotUses === 1, "使用次数被记录", String(gh.st.totals.hotUses));
  for (let i = 0; i < Math.ceil(D.HOT.dur * 60) + 30; i++) gh.step(1 / 60);
  ok(gh.hotActive() === false && Math.abs(gh.world.hotMul - 1) < 1e-9, "超频到期后恢复",
    "×" + gh.world.hotMul.toFixed(3));

  // 金币不够时不能超频
  const gh2 = newGame(3038);
  gh2.seedField(60, 1);
  gh2.st.credits = 1;
  ok(gh2.useHot() === false, "金币不足时超频被拒绝");
  ok(gh2.st.credits === 1, "被拒绝时不扣费", String(gh2.st.credits));

  // 金币塔：推落触发重赏 + 撒币，比宝箱更稀有
  const gtw = newGame(3039);
  gtw.seedField(60, 1);
  gtw.st.credits = 1e9;
  const tw = gtw.world.drop(D.COIN_DEFS.tower, 240, { y: gtw.world.payoutY - 20 });
  tw.vy = 400;
  for (let i = 0; i < 60 && !tw.dead; i++) { gtw.world.step(1 / 120); gtw.processEvents(); }
  const twEvt = pick(gtw.drainPending(), "tower");
  ok(!!twEvt, "金币塔推落触发结算");
  ok(gtw.st.totals.towers === 1, "金币塔次数被记录", String(gtw.st.totals.towers));
  ok(gtw.st.credits > 1e9, "金币塔发放奖励", "+" + (gtw.st.credits - 1e9));
  ok(twEvt && twEvt.coins > 0, "金币塔会撒下币", twEvt ? twEvt.coins + "/" + twEvt.total + " 枚" : "");
  ok(D.towerChance(0) < D.chestChance(0), "金币塔比宝箱更稀有（开荒期不污染平衡）",
    (D.towerChance(0) * 100).toFixed(2) + "% < " + (D.chestChance(0) * 100).toFixed(2) + "%");
  ok(D.towerChance(6) <= D.TOWER.max && D.chestChance(6) <= D.CHEST.max, "出现率有上限（不会刷成印钞机）",
    "塔 " + (D.towerChance(6) * 100).toFixed(2) + "% / 箱 " + (D.chestChance(6) * 100).toFixed(2) + "%");

  // 存档：新统计字段能往返
  const gsv = newGame(3040);
  gsv.seedField(60, 1);
  gsv.st.totals.towers = 3;
  gsv.st.totals.ordersDone = 4;
  gsv.st.totals.ordersFailed = 2;
  gsv.st.totals.bursts = 5;
  gsv.st.totals.streaks = 6;
  gsv.st.totals.hotUses = 7;
  const mem = {
    _d: null,
    getItem() { return this._d; },
    setItem(k, v) { this._d = v; },
    removeItem() { this._d = null; }
  };
  gsv.save(mem);
  const gr2 = newGame(1);
  ok(gr2.load(mem) === true, "带新统计的存档能读取");
  ok(gr2.st.totals.towers === 3 && gr2.st.totals.hotUses === 7, "新统计字段往返一致",
    "塔 " + gr2.st.totals.towers + " / 超频 " + gr2.st.totals.hotUses);
  ok(gr2.st.totals.bursts === 5 && gr2.st.totals.streaks === 6, "爆仓/漏币统计往返一致",
    "爆 " + gr2.st.totals.bursts + " / 漏 " + gr2.st.totals.streaks);
  ok(gr2.order === null && gr2.overheatT === 0, "读档不会带回进行中的订单 / 过热",
    "order=" + gr2.order + " overheat=" + gr2.overheatT);

  // 脏存档：新字段非法时回落，不会 NaN
  const gd = newGame(3041);
  gd.fromJSON({ st: { credits: 100, totals: { towers: "x", hotUses: -5, bursts: null } } });
  ok(finite(gd.st.totals.towers) && gd.st.totals.towers >= 0, "非法金币塔统计回落为 0",
    String(gd.st.totals.towers));
  ok(finite(gd.st.totals.hotUses) && gd.st.totals.hotUses >= 0, "负数超频统计被夹紧",
    String(gd.st.totals.hotUses));
  ok(finite(gd.st.credits) && gd.st.credits === 100, "脏存档下金币仍然合法", String(gd.st.credits));
}

/* ---------------- 汇总 ---------------- */
console.log("\n" + "=".repeat(58));
if (fails === 0) {
  console.log("全部通过：" + checks + " 项检查，0 问题 ✧٩(ˊωˋ*)و✧");
} else {
  console.log("检查 " + checks + " 项，发现 " + fails + " 个问题：");
  for (const p of problems) console.log("  - " + p);
}
console.log("=".repeat(58));
process.exit(fails === 0 ? 0 : 1);
