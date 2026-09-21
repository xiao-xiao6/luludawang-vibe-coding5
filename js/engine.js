/* ============================================================
 * 游戏逻辑层：经济 / 连击 / 升级 / 抽奖 / 存档 / 成就 / 换机台 / 惩罚 / 订单 / 暂停
 * 不碰 DOM，可在 node 里 headless 跑完整局
 *
 * 随机源分两条独立通道：
 *   world.rng → 物理与掉落（决定仿真轨迹）
 *   rollRng   → 暴击等结算随机
 * 分开之后，暴击不会扰动物理轨迹，平衡测试里
 * "满配 vs 满配+暴击"的差异就只剩暴击本身，测出来的数字才干净。
 * ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./physics.js"), require("./data.js"));
  } else {
    root.CPEngine = factory(root.CPPhysics, root.CPData);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (P, D) {
  "use strict";

  const SAVE_KEY = "coinpusher_save_v1";
  const SAVE_VERSION = 2;
  const COIN_WINDOW = D.COMBO_WINDOW;   // 连击滑动窗口（秒）

  /* 破产救济：金币见底持续一小段时间就自动补，玩家也可以手动点按钮领。
   * 这里**不再有** "场上币数 < 14" 这种永远不可能满足的条件 ——
   * 那正是导致"破产即永久软锁"的元凶。 */
  const BAILOUT_GRANT = 30;
  const BAILOUT_DELAY = 2.5;     // 金币见底持续多久自动发放
  const BAILOUT_COOLDOWN = 8;    // 两次自动救济之间的最短间隔

  const BASE_GUTTER = 44;        // 角沟基准宽度（机台修饰会乘一个系数）
  const MAX_SAFE = 1e12;

  function clampInt(v, lo, hi, dflt) {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return dflt;
    return Math.min(hi, Math.max(lo, Math.round(n)));
  }
  function clampNum(v, lo, hi, dflt) {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return dflt;
    return Math.min(hi, Math.max(lo, n));
  }

  function newState() {
    return {
      credits: 120,
      gems: 0,
      tickets: 0,
      upgrades: {},
      gemUpgrades: {},
      ach: {},
      auto: false,
      prestige: 0,
      modifier: "plain",
      totals: {
        dropped: 0, paid: 0, lost: 0, spent: 0, earned: 0,
        bestCombo: 0, jackpots: 0, playTime: 0, drops: 0,
        bestPayout: 0, kinds: {}, bailouts: 0,
        bestCredits: 120, refunds: 0,
        /* 新玩法（惩罚 / 风险 / 大奖）的统计 */
        towers: 0, ordersDone: 0, ordersFailed: 0,
        bursts: 0, hotUses: 0, streaks: 0
      },
      version: SAVE_VERSION
    };
  }

  function createGame(opts) {
    opts = opts || {};
    const seedIn = opts.seed != null ? (opts.seed >>> 0) : ((Math.random() * 0xffffffff) >>> 0);
    const worldRng = typeof opts.rng === "function" ? opts.rng : D.makeRng(seedIn);
    const rollRng = typeof opts.rollRng === "function" ? opts.rollRng : D.makeRng((seedIn ^ 0x5bf03635) >>> 0);
    const world = new P.World(Object.assign({}, opts, { rng: worldRng }));
    const st = newState();
    const g = {
      world: world,
      st: st,
      seed: seedIn,
      rollRng: rollRng,
      combo: 0,
      comboTimes: [],    // 滑动窗口：最近推落的时间戳（连击 = 窗口内的枚数）
      comboMul: 1,
      batchValue: 0,
      batchCount: 0,
      batchTimer: 0,
      autoAcc: 0,
      refillAcc: 0,
      chestCd: 0,
      towerCd: 0,
      brokeT: 0,
      bailoutCd: 0,
      /* --- 失败机制 / 主动技能 / 限时订单 --- */
      hotCd: 0,          // 超频冷却剩余
      hotT: 0,           // 超频剩余时间
      overheatT: 0,      // 过热（订单失败）剩余时间
      gutterTimes: [],   // 漏币时间戳（滑动窗口）
      streakT: 0,        // 漏币连锁剩余
      overflow: 0,       // 满台后硬塞的次数
      congest: 0,        // 当前拥堵程度 0~1（给 UI 与物理共用）
      /* 产出速率的指数滑动平均（时间常数 D.ORDER.ema 秒）：
       * 订单目标是**自适应**的，靠它反推「玩家现在大概能打多少」，
       * 所以初始机台不会收到做不完的单，满配也不会收到白送单。 */
      rate: { pays: 0, gems: 0, value: 0, combo: 0, clean: 0 },
      order: null,       // 当前订单：{ id, phase:'offer'|'active', t, prog, target, reward, penalty, def }
      orderNext: D.ORDER.first,
      paused: false,
      pending: [],       // 给渲染/音效消费的事件
      booted: false      // 是否已经撒过开场币（由调用方决定）
    };

    /* ---------------- 升级 ---------------- */
    g.upLevel = function (id) { return st.upgrades[id] || 0; };
    g.gemLevel = function (id) { return st.gemUpgrades[id] || 0; };
    g.upDef = function (id) {
      for (let i = 0; i < D.UPGRADES.length; i++) if (D.UPGRADES[i].id === id) return D.UPGRADES[i];
      return null;
    };
    g.gemDef = function (id) {
      for (let i = 0; i < D.GEM_UPGRADES.length; i++) if (D.GEM_UPGRADES[i].id === id) return D.GEM_UPGRADES[i];
      return null;
    };
    g.upCost = function (id) {
      const u = g.upDef(id);
      if (!u) return Infinity;
      const lv = g.upLevel(id);
      return lv >= u.max ? Infinity : D.upCost(u, lv);
    };
    g.gemCost = function (id) {
      const u = g.gemDef(id);
      if (!u) return Infinity;
      const lv = g.gemLevel(id);
      return lv >= u.max ? Infinity : u.costs[lv];
    };
    g.canBuy = function (id) {
      const c = g.upCost(id);
      return isFinite(c) && st.credits >= c;
    };
    g.canBuyGem = function (id) {
      const c = g.gemCost(id);
      return isFinite(c) && st.gems >= c;
    };
    g.buy = function (id) {
      if (!g.canBuy(id)) { g.push("deny", { id: id }); return false; }
      const c = g.upCost(id);
      st.credits -= c;
      st.upgrades[id] = g.upLevel(id) + 1;
      g.applyUpgrades();
      g.push("buy", { id: id, level: st.upgrades[id], cost: c });
      g.checkAch();
      return true;
    };
    g.buyGem = function (id) {
      if (!g.canBuyGem(id)) { g.push("deny", { id: id }); return false; }
      const c = g.gemCost(id);
      st.gems -= c;
      st.gemUpgrades[id] = g.gemLevel(id) + 1;
      g.applyUpgrades();
      g.push("buyGem", { id: id, level: st.gemUpgrades[id], cost: c });
      g.checkAch();
      return true;
    };

    /* 所有升级都落到真实仿真参数上，玩家"感觉得到"而不只是数字变大 */
    g.applyUpgrades = function () {
      const L = (id) => g.upLevel(id);
      const mod = g.modifierDef();
      world.speedMul = (1 + 0.12 * L("speed")) * mod.speed;
      world.reachMul = 1 + 0.09 * L("reach");
      world.frictionMul = Math.pow(0.92, L("slick")) * mod.friction;
      world.railMul = Math.pow(1.12, L("rail"));
      world.gutterW = BASE_GUTTER * mod.gut;
      world.maxCoins = 260 + 30 * L("cap");
      world.magnet = g.gemLevel("magnet");
      g.updateCongestion();
    };

    g.insertCount = function () { return 1 + g.upLevel("multi"); };
    g.autoLvl = function () { return g.upLevel("auto"); };
    /* 补给线 = 容量的固定比例：扩容槽升到多少，台面就真的填到相应水平，
     * 不会出现"容量 380 但只补到 100"这种升级形同虚设的情况（M9）。 */
    g.refillAt = function () {
      return Math.max(D.REFILL.min, Math.round(world.maxCoins * D.REFILL.ratio));
    };
    g.critChance = function () { return D.critChance(g.gemLevel("crit")); };

    /* ---------------- 失败机制第一层：拥堵 / 爆仓 ----------------
     * 台面越满，推板越推不动；满台之后还硬塞，前沿的币会被「挤爆」掉进角沟。
     * 惩罚是**渐进**的：先减速（可感知、可挽回），再爆仓（真丢币）。
     * 对策是排风马达（抵消减速）与防爆护栏（少丢币），以及自己把币推下去。 */
    g.congestLevel = function () {
      const r = world.coins.length / Math.max(1, world.maxCoins);
      if (r <= D.CONGESTION.warn) return 0;
      const span = Math.max(1e-6, 1 - D.CONGESTION.warn);
      return Math.min(1, (r - D.CONGESTION.warn) / span);
    };
    g.ventRelief = function () {
      return Math.min(1, D.CONGESTION.ventRelief * g.upLevel("vent"));
    };
    g.updateCongestion = function () {
      const c = g.congestLevel();
      const eff = c * (1 - g.ventRelief());   // 排风马达直接削弱拥堵的实际影响
      g.congest = eff;
      world.congestMul = 1 - D.CONGESTION.speedLoss * eff;
      return eff;
    };

    /* 满台时硬塞：累计到阈值就爆仓，把最前沿的几枚币挤进角沟 */
    g.overflowPush = function () {
      g.overflow++;
      if (g.overflow < D.CONGESTION.burstAt) return 0;
      return g.burst();
    };
    g.burst = function () {
      const w = world;
      const n = Math.max(1, D.CONGESTION.burstCoins - g.upLevel("guard"));
      const arr = w.coins;
      arr.sort((a, b) => b.y - a.y);          // 最前沿的先被挤出去
      const lost = Math.min(n, arr.length);
      const drop = [];
      for (let i = 0; i < lost; i++) {
        const c = arr[i];
        c.dead = true;
        c.reason = "gutter";
        drop.push({ x: c.x, y: c.y, kind: c.kind });
        st.totals.lost++;
        w.stats.lost++;
      }
      if (lost) w.coins = arr.slice(lost);
      g.overflow = 0;
      st.totals.bursts++;
      g.push("burst", { n: lost, drop: drop });
      g.checkAch();
      return lost;
    };

    /* ---------------- 失败机制第二层：漏币连锁 ----------------
     * 短时间内连续掉沟，机台会「漏」：角沟临时变宽，越漏越亏。 */
    g.noteGutter = function () {
      const S = D.STREAK;
      const t = world.time;
      const arr = g.gutterTimes;
      arr.push(t);
      const cut = t - S.window;
      let i = 0;
      while (i < arr.length && arr[i] < cut) i++;
      if (i) arr.splice(0, i);
      if (arr.length >= S.n) {
        if (g.streakT <= 0) { st.totals.streaks++; g.push("streak", { n: arr.length }); }
        g.streakT = S.dur;
        arr.length = 0;
      }
      /* 零失误：掉沟会把连续进度归零（可以重新积，不是一票否决） */
      if (g.order && g.order.phase === "active" && g.order.id === "clean") {
        g.order.prog = 0;
        g.order.gutters++;
      }
      g.rate.clean = 0;
    };

    /* ---------------- 稀有奖励：金币塔 ----------------
     * 比宝箱更稀有，推落后立刻结算一大笔现金并撒下一批币。
     * 出现率同样由 D.TOWER 唯一定义，UI 直接读同一份。 */
    g.hasTower = function () {
      for (const c of world.coins) if (c.kind === "tower") return true;
      return false;
    };
    g.tower = function () {
      const T = D.TOWER;
      st.totals.towers++;
      const bonus = T.bonusBase + Math.round(world.rng() * T.bonusSpread) + T.bonusPerLuck * g.upLevel("luck");
      st.credits += bonus;
      st.totals.earned += bonus;
      if (st.credits > st.totals.bestCredits) st.totals.bestCredits = st.credits;
      const a = g.dropManyCompensated(D.COIN_DEFS.gold, T.gold);
      const b = g.dropManyCompensated(D.COIN_DEFS.silver, T.silver);
      g.push("tower", {
        bonus: bonus,
        coins: a.made.length + b.made.length,
        refund: a.refund + b.refund,
        total: T.gold + T.silver
      });
      g.checkAch();
      return bonus;
    };

    /* ---------------- 主动技能：超频 ----------------
     * 冷却好了玩家自己点：花金币换 8 秒双倍产出 + 推板加速。
     * 必须手动触发，所以自动化长跑测试永远不会误触它。 */
    g.hotActive = function () { return g.hotT > 0; };
    g.hotMul = function () { return g.hotT > 0 ? D.HOT.mul : 1; };
    g.hotReady = function () { return g.hotCd <= 0; };
    g.hotLeft = function () { return Math.max(0, g.hotT); };
    g.hotCdLeft = function () { return Math.max(0, g.hotCd); };
    g.useHot = function () {
      if (g.hotCd > 0 || st.credits < D.HOT.cost) { g.push("deny", { id: "hot" }); return false; }
      st.credits -= D.HOT.cost;
      st.totals.spent += D.HOT.cost;
      g.hotCd = D.HOT.readyEvery;
      g.hotT = D.HOT.dur;
      st.totals.hotUses++;
      g.push("hot", { dur: D.HOT.dur, cost: D.HOT.cost });
      g.checkAch();
      return true;
    };

    /* ---------------- 失败机制第三层：限时订单 ----------------
     * 机台不定时给出一个限时订单，玩家自己决定接不接：
     *   接了 → 达标拿重赏；没达标 → 罚金 + 机台过热（推板减速）
     *   不接 → 提议到期自动收回，**不算失败**（所以惩罚永远是玩家自己选的） */
    g.orderActive = function () { return !!(g.order && g.order.phase === "active"); };
    g.orderOffering = function () { return !!(g.order && g.order.phase === "offer"); };
    g.orderProgress = function (isGem) {
      const o = g.order;
      if (!o || o.phase !== "active") return;
      if (o.id === "rush") o.prog++;
      else if (o.id === "combo") o.prog = Math.max(o.prog, g.combo);
      else if (o.id === "gem") { if (isGem) o.prog++; }
      /* 零失误：要求的是「连续不掉沟」，不是「全程一枚不掉」。
       * 掉一次沟只把进度归零，仍然可以重新积 —— 否则就是不可能完成的任务。 */
      else if (o.id === "clean") o.prog++;
    };

    /* 当前产出速率（每秒）：EMA 累加器 / 时间常数 */
    g.payRate = function () { return g.rate.pays / D.ORDER.ema; };
    g.gemRate = function () { return g.rate.gems / D.ORDER.ema; };
    g.valueRate = function () { return g.rate.value / D.ORDER.ema; };
    g.comboRef = function () { return g.rate.combo; };
    g.cleanRef = function () { return g.rate.clean; };

    /* 把订单定义 + 当前产出速率 → 具体的目标 / 赏金 / 罚金。
     * 这里算出来的数字会**存进订单对象**，UI 显示和结算读同一份，
     * 不会出现"看到的赏金和到手的不一样"。 */
    g.rollOrderSpec = function (def) {
      let raw;
      if (def.basis === "combo") raw = g.comboRef() * def.ask;
      else if (def.basis === "gems") raw = g.gemRate() * def.time * def.ask;
      else if (def.basis === "clean") raw = g.cleanRef() * def.ask;
      else raw = g.payRate() * def.time * def.ask;
      const target = Math.max(def.min, Math.min(def.max, Math.round(raw)));

      // 赏金 = 「这段时间本来大概能赚多少」× pay；未达到速率下限时用 floor 兜底
      const projected = g.valueRate() * def.time * def.pay;
      const reward = Math.max(def.floor, Math.round(projected));
      const penalty = Math.max(10, Math.round(reward * D.ORDER_PENALTY_RATIO));
      return { target: target, reward: reward, penalty: penalty };
    };
    /** 这种订单在当前产能下是否值得给出（不给玩家做不完的任务）。
     * 注意「零失误」不设门槛：它的目标已经按玩家真实的连击水平自适应缩放，
     * 再筛一层只会让「刚掉过一次沟」时永远收不到单，反而更难玩。 */
    g.orderFeasible = function (def) {
      const F = D.ORDER_FEASIBLE;
      if (def.basis === "clean") return true;
      if (def.basis === "gems") return g.gemRate() * def.time >= D.ORDER_GEM_FEASIBLE;
      if (def.basis === "combo") return g.comboRef() >= F;
      return g.payRate() * def.time >= F * 8;
    };
    g.offerOrder = function () {
      const pool = D.ORDERS.filter((o) => g.orderFeasible(o));
      const list = pool.length ? pool : [D.ORDERS[0]];
      const def = list[(world.rng() * list.length) | 0] || list[0];
      const spec = g.rollOrderSpec(def);
      g.order = {
        id: def.id, phase: "offer", t: D.ORDER.expire, prog: 0, gutters: 0,
        target: spec.target, reward: spec.reward, penalty: spec.penalty, def: def
      };
      g.push("orderOffer", {
        id: def.id, name: def.name, unit: def.unit,
        target: spec.target, reward: spec.reward, penalty: spec.penalty, t: D.ORDER.expire
      });
    };
    g.acceptOrder = function () {
      if (!g.order || g.order.phase !== "offer") return false;
      g.order.phase = "active";
      g.order.t = g.order.def.time;
      g.order.prog = 0;
      g.order.gutters = 0;
      g.push("orderStart", {
        id: g.order.id, name: g.order.def.name, t: g.order.def.time,
        target: g.order.target, reward: g.order.reward, penalty: g.order.penalty
      });
      return true;
    };
    g.declineOrder = function () {
      if (!g.order || g.order.phase !== "offer") return false;
      g.push("orderDecline", { id: g.order.id, name: g.order.def.name });
      g.order = null;
      g.orderNext = D.ORDER.every;
      return true;
    };
    function finishOrder(win) {
      const o = g.order;
      if (!o) return;
      const def = o.def;
      g.order = null;
      g.orderNext = D.ORDER.every;
      if (win) {
        st.credits += o.reward;
        st.totals.earned += o.reward;
        st.totals.ordersDone++;
        if (st.credits > st.totals.bestCredits) st.totals.bestCredits = st.credits;
        g.push("orderDone", { id: def.id, name: def.name, reward: o.reward, prog: o.prog, target: o.target });
      } else {
        const pay = Math.min(st.credits, o.penalty);
        st.credits -= pay;
        st.totals.ordersFailed++;
        g.overheatT = D.OVERHEAT.dur;
        g.push("orderFail", {
          id: def.id, name: def.name, penalty: pay, prog: o.prog,
          target: o.target, overheat: D.OVERHEAT.dur
        });
      }
      g.checkAch();
    }
    function tickOrder(dt) {
      if (!g.order) {
        g.orderNext -= dt;
        if (g.orderNext <= 0) g.offerOrder();
        return;
      }
      const o = g.order;
      o.t -= dt;
      if (o.phase === "offer") {
        if (o.t <= 0) {
          g.order = null;
          g.orderNext = D.ORDER.every;
          g.push("orderExpire", {});
        }
        return;
      }
      if (o.prog >= o.target) finishOrder(true);
      else if (o.t <= 0) finishOrder(false);
    }

    /* 连击的滑动窗口：只保留最近 COIN_WINDOW 秒内的推落记录。
     * 这是 B7 的根治手段 —— 原来的单调计数器在满配下几乎不归零，
     * 直接把"稀有爆发 ×4"变成了常驻基础倍率。 */
    function pruneCombo(now) {
      const cut = now - COIN_WINDOW;
      const arr = g.comboTimes;
      let i = 0;
      while (i < arr.length && arr[i] < cut) i++;
      if (i) arr.splice(0, i);
      g.combo = arr.length;
      if (g.combo === 0) g.comboMul = 1;
    }

    /* ---------------- 机台修饰 / 换机台 ---------------- */
    g.modifierDef = function () { return D.modById(st.modifier); };
    g.prestigeMul = function () { return 1 + D.PRESTIGE.bonus * (st.prestige || 0); };
    g.prestigeNeed = function () { return D.PRESTIGE.earned * ((st.prestige || 0) + 1); };
    g.canPrestige = function () { return st.totals.earned >= g.prestigeNeed(); };
    g.doPrestige = function () {
      if (!g.canPrestige()) { g.push("deny", { id: "prestige" }); return false; }
      st.prestige = (st.prestige || 0) + 1;
      st.upgrades = {};
      st.gemUpgrades = {};
      st.modifier = D.rollModifier(world.rng, st.modifier);
      st.credits = D.PRESTIGE.grant;
      st.auto = false;
      g.applyUpgrades();
      world.clear();
      g.seedField(140, 1);
      g.comboTimes.length = 0;
      g.combo = 0; g.comboMul = 1;
      g.batchValue = 0; g.batchCount = 0;
      g.brokeT = 0; g.bailoutCd = 0; g.chestCd = 0; g.towerCd = 0;
      g.hotCd = 0; g.hotT = 0; g.overheatT = 0;
      g.gutterTimes.length = 0; g.streakT = 0; g.overflow = 0; g.congest = 0;
      g.order = null; g.orderNext = D.ORDER.first;
      g.rate.pays = 0; g.rate.gems = 0; g.rate.value = 0; g.rate.combo = 0; g.rate.clean = 0;
      g.push("prestige", { level: st.prestige, mod: st.modifier });
      g.checkAch();
      return true;
    };

    /* ---------------- 机台补给 ---------------- */
    g.mixDef = function (luckBoost) {
      const luck = g.upLevel("luck") + g.modifierDef().luck + (luckBoost || 0);
      const w = {
        copper: Math.max(40, 86 - luck * 5),
        silver: 9 + luck * 1.6,
        gold: 2.6 + luck * 1.2,
        diamond: 0.45 + luck * 0.35,
        lucky: 1.4 + luck * 0.5
      };
      let total = 0;
      for (const k in w) total += w[k];
      let roll = world.rng() * total;
      for (const k in w) { roll -= w[k]; if (roll <= 0) return D.COIN_DEFS[k]; }
      return D.COIN_DEFS.copper;
    };

    /* 撒开场币。**不再由 createGame 自动调用** ——
     * 只由调用方按需触发（boot 的无存档分支 / reset / 换机台），
     * 避免"建对象时撒一次、boot 又撒一次"的双倍撒币。 */
    g.seedField = function (n, luckBoost) {
      const yTop = world.plateMinY + 22;   // 必须落在推板扫过的区间内，否则推板推不到币
      const yBot = world.payoutY - 44;
      for (let i = 0; i < n; i++) {
        const def = g.mixDef(luckBoost);
        const x = world.W * (0.08 + 0.84 * world.rng());
        const y = yTop + (yBot - yTop) * world.rng();
        world.drop(def, x, { y: y });
      }
      for (let i = 0; i < 120; i++) world.step(1 / 120);
      world.drainEvents();
      world.resetStats();
      g.booted = true;
    };

    g.hasChest = function () {
      for (const c of world.coins) if (c.kind === "chest") return true;
      return false;
    };

    /* ---------------- 投币 ---------------- */
    g.insert = function (x) {
      const n = g.insertCount();
      let done = 0;
      const made = [];
      for (let i = 0; i < n; i++) {
        if (st.credits < 1) break;
        if (world.full) { g.push("full", {}); g.overflowPush(); break; }
        const off = n > 1 ? (i - (n - 1) / 2) * 26 : 0;
        const cx = (x != null ? x : world.W / 2) + off + (world.rng() - 0.5) * 8;
        const c = world.drop(D.COIN_DEFS.copper, cx);
        if (!c) break;
        made.push(c);
        st.credits -= 1;
        st.totals.spent += 1;
        done++;
      }
      if (done) {
        st.totals.dropped += done;
        st.totals.drops += 1;
        if (st.credits > st.totals.bestCredits) st.totals.bestCredits = st.credits;
        g.push("drop", { n: done, x: x, coins: made });
      } else {
        g.push("deny", { id: "insert" });
      }
      return done;
    };

    /* 撒币落不下时把差额折算成金币返还，绝不让玩家的券/奖励凭空蒸发 */
    g.dropManyCompensated = function (def, n) {
      const made = world.dropMany(def, n);
      const missing = Math.max(0, n - made.length);
      const per = Math.max(2, Math.round((def.value || 1) * 0.2));
      const refund = missing * per;
      if (refund > 0) {
        st.credits += refund;
        st.totals.earned += refund;
        st.totals.refunds += refund;
      }
      return { made: made, missing: missing, refund: refund, per: per };
    };

    /* ---------------- 结算 ---------------- */
    g.processEvents = function () {
      const evts = world.drainEvents();
      for (let i = 0; i < evts.length; i++) {
        const e = evts[i];
        const def = D.COIN_DEFS[e.coin.kind];
        if (!def) continue;
        if (e.type === "gutter") {
          st.totals.lost++;
          g.noteGutter();
          g.push("gutter", { x: e.coin.x, y: e.coin.y, kind: e.coin.kind });
          continue;
        }
        st.totals.paid++;
        st.totals.kinds[def.id] = (st.totals.kinds[def.id] || 0) + 1;
        // 滑动窗口计数：连击 = 最近 0.9 秒内推落的枚数
        pruneCombo(world.time);
        g.comboTimes.push(world.time);
        g.combo = g.comboTimes.length;
        let mul = D.mulFor(g.combo);
        const crit = g.rollRng() < g.critChance();
        if (crit) mul = Math.round(mul * D.CRIT_MULT * 100) / 100;
        mul = Math.round(mul * g.hotMul() * 100) / 100;
        g.comboMul = mul;
        if (g.combo > st.totals.bestCombo) st.totals.bestCombo = g.combo;
        const gain = Math.round(def.value * mul * g.prestigeMul() * g.modifierDef().gain);
        if (gain > 0) { st.credits += gain; st.totals.earned += gain; }
        if (st.credits > st.totals.bestCredits) st.totals.bestCredits = st.credits;
        if (def.gem) st.gems += def.gem;
        if (def.ticket) st.tickets += def.ticket;
        g.batchValue += gain;
        g.batchCount++;
        g.batchTimer = COIN_WINDOW;
        if (g.batchValue > st.totals.bestPayout) st.totals.bestPayout = g.batchValue;
        g.orderProgress(!!def.gem);
        /* 产出速率 EMA：订单目标靠它自适应。
         * 这里只**累加原始计数**，指数衰减统一放在 step() 里做 ——
         * 一处衰减、一处累加，不会出现"插值一次、再衰减一次"的双重计数。
         * 用 EMA 而不是固定目标，是因为「玩家的产能」在开荒期和满配期
         * 差了十几倍 —— 固定目标不是把新手罚死，就是把老手喂饭。 */
        g.rate.pays += 1;
        g.rate.value += gain;
        g.rate.clean += 1;
        if (def.gem) g.rate.gems += def.gem;
        if (g.combo > g.rate.combo) g.rate.combo = g.combo;
        g.push("pay", {
          x: e.coin.x, y: e.coin.y, gain: gain, kind: def.id,
          mul: mul, combo: g.combo, crit: crit, hot: g.hotActive(),
          gem: def.gem || 0, ticket: def.ticket || 0
        });
        if (def.jackpot) g.jackpot();
        if (def.tower) g.tower();
      }
    };

    g.jackpot = function () {
      st.totals.jackpots++;
      const C = D.CHEST;
      const bonus = C.bonusBase + Math.round(world.rng() * C.bonusSpread) + C.bonusPerLuck * g.upLevel("luck");
      st.credits += bonus;
      st.totals.earned += bonus;
      if (st.credits > st.totals.bestCredits) st.totals.bestCredits = st.credits;
      const a = g.dropManyCompensated(D.COIN_DEFS.gold, C.gold);
      const b = g.dropManyCompensated(D.COIN_DEFS.silver, C.silver);
      const c = g.dropManyCompensated(D.COIN_DEFS.diamond, C.diamond);
      // 上报的是**真正撒下的总数**（金 24 + 银 14 + 钻 3 = 41），不是只有金币那批
      const coins = a.made.length + b.made.length + c.made.length;
      const refund = a.refund + b.refund + c.refund;
      g.push("jackpot", {
        bonus: bonus, coins: coins, refund: refund,
        total: C.gold + C.silver + C.diamond
      });
      g.checkAch();
      return bonus;
    };

    /* 抽奖：奖池比例由 D.LOTTERY_TABLE 唯一定义，UI 里也直接读同一张表，
     * 保证"公示的概率"和"代码里的概率"永远是同一个。 */
    g.lottery = function () {
      if (st.tickets < D.LOTTERY_TICKET_COST) { g.push("deny", { id: "lottery" }); return null; }
      st.tickets -= D.LOTTERY_TICKET_COST;
      const roll = world.rng();
      let acc = 0, idx = D.LOTTERY_TABLE.length - 1;
      for (let i = 0; i < D.LOTTERY_TABLE.length; i++) {
        acc += D.LOTTERY_TABLE[i].p;
        if (roll < acc) { idx = i; break; }
      }
      let res;
      if (idx === 0) {
        const c = 120 + Math.round(world.rng() * 300);
        st.credits += c; st.totals.earned += c;
        if (st.credits > st.totals.bestCredits) st.totals.bestCredits = st.credits;
        res = { kind: "credits", amount: c, text: "+" + c + " 金币" };
      } else if (idx === 1) {
        const n = 1 + Math.floor(world.rng() * 3);
        st.gems += n;
        res = { kind: "gems", amount: n, text: "+" + n + " 钻石" };
      } else if (idx === 2) {
        const r = g.dropManyCompensated(D.COIN_DEFS.gold, 10);
        res = {
          kind: "rain", amount: r.made.length,
          text: "金币雨 ×" + r.made.length + (r.refund ? "（台面已满，折算 +" + r.refund + " 金币）" : "")
        };
      } else if (idx === 3) {
        const r = g.dropManyCompensated(D.COIN_DEFS.diamond, 5);
        res = {
          kind: "rain", amount: r.made.length,
          text: "钻石雨 ×" + r.made.length + (r.refund ? "（台面已满，折算 +" + r.refund + " 金币）" : "")
        };
      } else {
        const b = g.jackpot();
        res = { kind: "jackpot", amount: b, text: "JACKPOT! +" + b };
      }
      g.push("lottery", res);
      return res;
    };

    /* ---------------- 破产保护 ---------------- */
    /* "能不能靠机台自己产出"的判定：只有自动投币机真的在工作（等级>0 且还有钱投）
     * 才算能产出。这样 Lv0 打开的空开关不会把唯一的安全网关掉（B9）。 */
    g.autoWorking = function () { return !!st.auto && g.autoLvl() > 0 && st.credits >= 1; };
    g.needBailout = function () { return st.credits < 1 && !g.autoWorking(); };
    g.bailout = function () {
      const grant = BAILOUT_GRANT;
      st.credits += grant;
      st.totals.bailouts++;
      if (st.credits > st.totals.bestCredits) st.totals.bestCredits = st.credits;
      g.brokeT = 0;
      g.bailoutCd = BAILOUT_COOLDOWN;
      g.push("bailout", { amount: grant });
      return grant;
    };

    g.setPaused = function (v) {
      g.paused = !!v;
      g.push("pause", { paused: g.paused });
      return g.paused;
    };
    g.togglePause = function () { return g.setPaused(!g.paused); };

    g.checkAch = function () {
      const unlocked = [];
      for (let i = 0; i < D.ACHIEVEMENTS.length; i++) {
        const a = D.ACHIEVEMENTS[i];
        if (st.ach[a.id]) continue;
        let ok = false;
        try { ok = !!a.check(st); } catch (err) { ok = false; }
        if (ok) { st.ach[a.id] = Date.now(); unlocked.push(a); }
      }
      if (unlocked.length) g.push("ach", { list: unlocked.map((a) => a.id) });
      return unlocked;
    };

    /* ---------------- 主循环 ---------------- */
    g.step = function (dt) {
      if (!(dt > 0)) return;
      dt = Math.min(dt, 0.05);
      st.totals.playTime += dt;

      const auto = st.auto ? g.autoLvl() : 0;
      if (auto > 0) {
        g.autoAcc += dt * auto;
        let guard = 0;
        while (g.autoAcc >= 1 && guard++ < 40) {
          g.autoAcc -= 1;
          if (!g.insert(null)) break;
        }
      }

      // 暂停推板：推板停住，台面上的币仍然继续求解（不会卡住、不会穿模）
      world.step(dt, g.paused ? { freezePlate: true } : null);
      g.processEvents();

      pruneCombo(world.time);
      if (g.batchTimer > 0) {
        g.batchTimer -= dt;
        if (g.batchTimer <= 0) { g.batchValue = 0; g.batchCount = 0; }
      }

      /* 产出速率 EMA 的指数衰减：与 processEvents 里的累加配对，
       * 时间常数 D.ORDER.ema 秒。 */
      const damp = Math.exp(-dt / D.ORDER.ema);
      g.rate.pays *= damp;
      g.rate.value *= damp;
      g.rate.gems *= damp;
      g.rate.combo *= damp;
      g.rate.clean *= damp;

      /* --- 惩罚 / 技能 / 订单的计时 --- */
      g.updateCongestion();
      if (g.streakT > 0) {
        g.streakT -= dt;
        world.streakMul = g.streakT > 0 ? D.STREAK.mul : 1;
      } else {
        world.streakMul = 1;
      }
      if (g.hotCd > 0) g.hotCd -= dt;
      if (g.hotT > 0) g.hotT -= dt;
      if (g.overheatT > 0) g.overheatT -= dt;
      tickOrder(dt);
      // 超频与过热都直接作用到推板速度上，玩家能当场感觉到。
      // 必须在 tickOrder 之后算：订单失败会当场开始过热，不能慢一帧才生效。
      world.hotMul = (g.hotT > 0 ? D.HOT.speed : 1) * (g.overheatT > 0 ? D.OVERHEAT.mul : 1);

      g.refillAcc += dt;
      if (g.chestCd > 0) g.chestCd -= dt;
      if (g.towerCd > 0) g.towerCd -= dt;
      if (g.refillAcc >= D.REFILL.every) {
        g.refillAcc = 0;
        if (world.coins.length < g.refillAt() && !world.full) {
          const luck = g.upLevel("luck") + g.modifierDef().luck;
          if (!g.hasTower() && g.towerCd <= 0 && world.rng() < D.towerChance(luck)) {
            if (world.drop(D.COIN_DEFS.tower)) g.towerCd = D.TOWER.cooldown;
          } else if (!g.hasChest() && g.chestCd <= 0 && world.rng() < D.chestChance(luck)) {
            if (world.drop(D.COIN_DEFS.chest)) g.chestCd = D.CHEST.cooldown;
          } else {
            world.drop(g.mixDef());
          }
        }
      }

      /* 破产保护：不再有"场上币数 < 14"这种永远不成立的条件。
       * 金币见底持续 BAILOUT_DELAY 秒就自动发放，玩家也能手动领。 */
      if (g.bailoutCd > 0) g.bailoutCd -= dt;
      if (g.needBailout()) {
        g.brokeT += dt;
        if (g.brokeT >= BAILOUT_DELAY && g.bailoutCd <= 0) g.bailout();
      } else {
        g.brokeT = 0;
      }

      g.checkAch();
      return g.pending;
    };

    g.push = function (type, data) {
      g.pending.push(Object.assign({ type: type, t: world.time }, data || {}));
    };
    g.drainPending = function () {
      if (!g.pending.length) return [];
      const p = g.pending;
      g.pending = [];
      return p;
    };

    /* ---------------- 存档 ---------------- */
    g.toJSON = function () {
      return {
        v: SAVE_VERSION,
        st: st,
        coins: world.serialize(world.maxCoins),   // 上限跟随扩容槽，不再截断（B4）
        auto: st.auto
      };
    };
    g.save = function (storage) {
      const s = storage || (typeof localStorage !== "undefined" ? localStorage : null);
      if (!s) return false;
      try {
        s.setItem(SAVE_KEY, JSON.stringify(g.toJSON()));
        return true;
      } catch (e) { return false; }
    };
    g.load = function (storage) {
      const s = storage || (typeof localStorage !== "undefined" ? localStorage : null);
      if (!s) return false;
      let raw = null;
      try { raw = s.getItem(SAVE_KEY); } catch (e) { return false; }
      if (!raw) return false;
      try { return g.fromJSON(JSON.parse(raw)); } catch (e) { return false; }
    };

    /* 存档全字段校验：类型不对 / 超范围一律回落到默认值或夹紧。
     * localStorage 是玩家可以随手改的，这既是健壮性也是反作弊 ——
     * 不会再出现 credits = "abc" → NaN → 投币永不失败的无限白嫖（B6）。 */
    g.fromJSON = function (obj) {
      if (!obj || typeof obj !== "object" || !obj.st || typeof obj.st !== "object") return false;
      const src = obj.st;
      const s = newState();
      const t = s.totals;

      s.credits = clampInt(src.credits, 0, MAX_SAFE, s.credits);
      s.gems = clampInt(src.gems, 0, MAX_SAFE, s.gems);
      s.tickets = clampInt(src.tickets, 0, MAX_SAFE, s.tickets);
      s.auto = src.auto === true;
      s.prestige = clampInt(src.prestige, 0, 999, 0);
      s.modifier = (typeof src.modifier === "string" && D.modById(src.modifier).id === src.modifier)
        ? src.modifier : "plain";

      const ups = (src.upgrades && typeof src.upgrades === "object") ? src.upgrades : {};
      for (let i = 0; i < D.UPGRADES.length; i++) {
        const u = D.UPGRADES[i];
        s.upgrades[u.id] = clampInt(ups[u.id], 0, u.max, 0);
      }
      const gups = (src.gemUpgrades && typeof src.gemUpgrades === "object") ? src.gemUpgrades : {};
      for (let i = 0; i < D.GEM_UPGRADES.length; i++) {
        const u = D.GEM_UPGRADES[i];
        s.gemUpgrades[u.id] = clampInt(gups[u.id], 0, u.max, 0);
      }

      const tsrc = (src.totals && typeof src.totals === "object") ? src.totals : {};
      for (const k in t) {
        if (k === "kinds") continue;
        if (typeof t[k] === "number") t[k] = clampNum(tsrc[k], 0, MAX_SAFE, 0);
      }
      const ks = (tsrc.kinds && typeof tsrc.kinds === "object") ? tsrc.kinds : {};
      for (let i = 0; i < D.COIN_ORDER.length; i++) {
        const id = D.COIN_ORDER[i];
        t.kinds[id] = clampInt(ks[id], 0, MAX_SAFE, 0);
      }
      if (t.bestCredits < s.credits) t.bestCredits = s.credits;

      const achSrc = (src.ach && typeof src.ach === "object") ? src.ach : {};
      for (let i = 0; i < D.ACHIEVEMENTS.length; i++) {
        const a = D.ACHIEVEMENTS[i];
        if (achSrc[a.id]) s.ach[a.id] = clampNum(achSrc[a.id], 0, MAX_SAFE, Date.now());
      }

      for (const k in st) delete st[k];
      Object.assign(st, s);

      // 先应用升级（决定 maxCoins），再还原台面，否则容量升级会被存档机制自己抵消
      g.applyUpgrades();
      world.restore(obj.coins, D.COIN_DEFS);
      // Lv0 的自动投币机不可能工作，读档时直接把开关关掉，避免"空开关屏蔽救济金"
      if (g.autoLvl() <= 0) st.auto = false;
      g.comboTimes.length = 0;
      g.combo = 0; g.comboMul = 1;
      g.batchValue = 0; g.batchCount = 0;
      g.brokeT = 0; g.bailoutCd = 0; g.chestCd = 0; g.towerCd = 0;
      g.hotCd = 0; g.hotT = 0; g.overheatT = 0;
      g.gutterTimes.length = 0; g.streakT = 0; g.overflow = 0; g.congest = 0;
      g.order = null; g.orderNext = D.ORDER.first;
      g.rate.pays = 0; g.rate.gems = 0; g.rate.value = 0; g.rate.combo = 0; g.rate.clean = 0;
      world.streakMul = 1; world.hotMul = 1;
      g.updateCongestion();
      return true;
    };

    /* 重置：状态、台面、统计、事件全部清干净，撒币路径与 boot 完全一致 */
    g.reset = function (storage) {
      const s = storage || (typeof localStorage !== "undefined" ? localStorage : null);
      if (s) { try { s.removeItem(SAVE_KEY); } catch (e) { /* ignore */ } }
      const fresh = newState();
      for (const k in st) delete st[k];
      Object.assign(st, fresh);
      world.clear();
      g.pending.length = 0;
      g.applyUpgrades();
      g.comboTimes.length = 0;
      g.combo = 0; g.comboMul = 1;
      g.batchValue = 0; g.batchCount = 0;
      g.autoAcc = 0; g.refillAcc = 0;
      g.brokeT = 0; g.bailoutCd = 0; g.chestCd = 0; g.towerCd = 0;
      g.hotCd = 0; g.hotT = 0; g.overheatT = 0;
      g.gutterTimes.length = 0; g.streakT = 0; g.overflow = 0; g.congest = 0;
      g.order = null; g.orderNext = D.ORDER.first;
      g.rate.pays = 0; g.rate.gems = 0; g.rate.value = 0; g.rate.combo = 0; g.rate.clean = 0;
      world.streakMul = 1; world.hotMul = 1;
      g.paused = false;
      g.seedField(170, 2);
    };

    /* ---------------- 启动 ----------------
     * 注意：这里**不撒币**。撒币由调用方决定（无存档才撒），
     * 有存档时先 load 再决定，避免白造 170 个对象 + 空跑 120 步物理（B2）。 */
    g.applyUpgrades();
    return g;
  }

  return {
    createGame, newState,
    SAVE_KEY: SAVE_KEY, SAVE_VERSION: SAVE_VERSION,
    BAILOUT_GRANT: BAILOUT_GRANT
  };
});
