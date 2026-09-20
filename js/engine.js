/* ============================================================
 * 游戏逻辑层：经济 / 连击 / 升级 / 抽奖 / 存档 / 成就 / 换机台 / 暂停
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
        bestCredits: 120, refunds: 0
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
      brokeT: 0,
      bailoutCd: 0,
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
    };

    g.insertCount = function () { return 1 + g.upLevel("multi"); };
    g.autoLvl = function () { return g.upLevel("auto"); };
    /* 补给线 = 容量的固定比例：扩容槽升到多少，台面就真的填到相应水平，
     * 不会出现"容量 380 但只补到 100"这种升级形同虚设的情况（M9）。 */
    g.refillAt = function () {
      return Math.max(D.REFILL.min, Math.round(world.maxCoins * D.REFILL.ratio));
    };
    g.critChance = function () { return D.critChance(g.gemLevel("crit")); };

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
      g.brokeT = 0; g.bailoutCd = 0; g.chestCd = 0;
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
      for (let i = 0; i < n; i++) {
        if (st.credits < 1) break;
        if (world.full) { g.push("full", {}); break; }
        const off = n > 1 ? (i - (n - 1) / 2) * 26 : 0;
        const cx = (x != null ? x : world.W / 2) + off + (world.rng() - 0.5) * 8;
        const c = world.drop(D.COIN_DEFS.copper, cx);
        if (!c) break;
        st.credits -= 1;
        st.totals.spent += 1;
        done++;
      }
      if (done) {
        st.totals.dropped += done;
        st.totals.drops += 1;
        if (st.credits > st.totals.bestCredits) st.totals.bestCredits = st.credits;
        g.push("drop", { n: done, x: x });
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
        g.push("pay", {
          x: e.coin.x, y: e.coin.y, gain: gain, kind: def.id,
          mul: mul, combo: g.combo, crit: crit,
          gem: def.gem || 0, ticket: def.ticket || 0
        });
        if (def.jackpot) g.jackpot();
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

      g.refillAcc += dt;
      if (g.chestCd > 0) g.chestCd -= dt;
      if (g.refillAcc >= D.REFILL.every) {
        g.refillAcc = 0;
        if (world.coins.length < g.refillAt() && !world.full) {
          const luck = g.upLevel("luck") + g.modifierDef().luck;
          if (!g.hasChest() && g.chestCd <= 0 && world.rng() < D.chestChance(luck)) {
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
      g.brokeT = 0; g.bailoutCd = 0; g.chestCd = 0;
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
      g.brokeT = 0; g.bailoutCd = 0; g.chestCd = 0;
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
