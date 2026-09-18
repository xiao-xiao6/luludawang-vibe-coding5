/* ============================================================
 * 游戏逻辑层：经济 / 连击 / 升级 / 抽奖 / 存档 / 成就
 * 不碰 DOM，可在 node 里 headless 跑完整局
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
  const COIN_WINDOW = D.COMBO_WINDOW;

  function newState() {
    return {
      credits: 120,
      gems: 0,
      tickets: 0,
      upgrades: {},
      gemUpgrades: {},
      ach: {},
      auto: false,
      totals: {
        dropped: 0, paid: 0, lost: 0, spent: 0, earned: 0,
        bestCombo: 0, jackpots: 0, playTime: 0, drops: 0,
        bestPayout: 0, kinds: {}, bailouts: 0
      },
      version: 1
    };
  }

  function createGame(opts) {
    const world = new P.World(opts || {});
    const st = newState();
    const g = {
      world: world,
      st: st,
      combo: 0,
      comboTimer: 0,
      comboMul: 1,
      batchValue: 0,
      batchCount: 0,
      batchTimer: 0,
      seedT: 0,
      autoAcc: 0,
      refillAcc: 0,
      pending: [],       // 给渲染/音效消费的事件
      lotteryResult: null
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

    g.applyUpgrades = function () {
      const L = (id) => g.upLevel(id);
      world.speedMul = 1 + 0.12 * L("speed");
      world.reachMul = 1 + 0.09 * L("reach");
      world.frictionMul = Math.pow(0.92, L("slick"));
      world.railMul = Math.pow(1.12, L("rail"));
      world.maxCoins = 260 + 50 * L("cap");
    };

    g.insertCount = function () { return 1 + g.upLevel("multi"); };
    g.autoLvl = function () { return g.upLevel("auto"); };
    g.refillAt = function () { return 100 + 15 * g.upLevel("cap"); };
    g.critBonus = function () { return 0.5 * g.gemLevel("crit"); };

    /* ---------------- 机台补给 ---------------- */
    g.mixDef = function (luckBoost) {
      const luck = g.upLevel("luck") + (luckBoost || 0);
      const w = {
        copper: Math.max(40, 86 - luck * 5),
        silver: 9 + luck * 1.6,
        gold: 2.6 + luck * 1.2,
        diamond: 0.45 + luck * 0.35,
        lucky: 1.4 + luck * 0.5
      };
      let total = 0;
      for (const k in w) total += w[k];
      let roll = Math.random() * total;
      for (const k in w) { roll -= w[k]; if (roll <= 0) return D.COIN_DEFS[k]; }
      return D.COIN_DEFS.copper;
    };

    g.seedField = function (n, luckBoost) {
      const yTop = world.plateMinY + 22;   // 必须落在推板扫过的区间内，否则推板推不到币
      const yBot = world.payoutY - 44;
      for (let i = 0; i < n; i++) {
        const def = g.mixDef(luckBoost);
        const x = world.W * (0.08 + 0.84 * Math.random());
        const y = yTop + (yBot - yTop) * Math.random();
        world.drop(def, x, { y: y });
      }
      for (let i = 0; i < 120; i++) world.step(1 / 120);
      world.drainEvents();
      world.stats.dropped = 0;
      world.stats.paid = 0;
      world.stats.lost = 0;
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
        const cx = (x != null ? x : world.W / 2) + off + (Math.random() - 0.5) * 8;
        const c = world.drop(D.COIN_DEFS.copper, cx);
        if (!c) break;
        st.credits -= 1;
        st.totals.spent += 1;
        done++;
      }
      if (done) {
        st.totals.dropped += done;
        st.totals.drops += 1;
        g.push("drop", { n: done, x: x });
      } else {
        g.push("deny", { id: "insert" });
      }
      return done;
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
        g.combo++;
        g.comboTimer = COIN_WINDOW;
        const mul = D.mulFor(g.combo, g.critBonus());
        g.comboMul = mul;
        if (g.combo > st.totals.bestCombo) st.totals.bestCombo = g.combo;
        const gain = Math.round(def.value * mul);
        if (gain > 0) { st.credits += gain; st.totals.earned += gain; }
        if (def.gem) st.gems += def.gem;
        if (def.ticket) st.tickets += def.ticket;
        g.batchValue += gain;
        g.batchCount++;
        g.batchTimer = COIN_WINDOW;
        if (g.batchValue > st.totals.bestPayout) st.totals.bestPayout = g.batchValue;
        g.push("pay", { x: e.coin.x, y: e.coin.y, gain: gain, kind: def.id, mul: mul, combo: g.combo });
        if (def.jackpot) g.jackpot();
      }
    };

    g.jackpot = function () {
      st.totals.jackpots++;
      const bonus = 260 + Math.round(Math.random() * 240) + 45 * g.upLevel("luck");
      st.credits += bonus;
      st.totals.earned += bonus;
      const made = world.dropMany(D.COIN_DEFS.gold, 24);
      world.dropMany(D.COIN_DEFS.silver, 14);
      world.dropMany(D.COIN_DEFS.diamond, 3);
      g.push("jackpot", { bonus: bonus, coins: made.length });
      g.checkAch();
      return bonus;
    };

    g.lottery = function () {
      if (st.tickets < 5) { g.push("deny", { id: "lottery" }); return null; }
      st.tickets -= 5;
      const roll = Math.random();
      let res;
      if (roll < 0.32) {
        const c = 120 + Math.round(Math.random() * 300);
        st.credits += c; st.totals.earned += c;
        res = { kind: "credits", amount: c, text: "+" + c + " 金币" };
      } else if (roll < 0.56) {
        const n = 1 + Math.floor(Math.random() * 3);
        st.gems += n;
        res = { kind: "gems", amount: n, text: "+" + n + " 钻石" };
      } else if (roll < 0.76) {
        const made = world.dropMany(D.COIN_DEFS.gold, 10);
        res = { kind: "rain", amount: made.length, text: "金币雨 ×" + made.length };
      } else if (roll < 0.91) {
        const made = world.dropMany(D.COIN_DEFS.diamond, 5);
        res = { kind: "rain", amount: made.length, text: "钻石雨 ×" + made.length };
      } else {
        const b = g.jackpot();
        res = { kind: "jackpot", amount: b, text: "JACKPOT! +" + b };
      }
      g.lotteryResult = res;
      g.push("lottery", res);
      return res;
    };

    g.bailout = function () {
      const grant = 30;
      st.credits += grant;
      st.totals.bailouts++;
      g.push("bailout", { amount: grant });
      return grant;
    };

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

      world.step(dt);
      g.processEvents();

      // 磁力线圈：把贴近角沟的币往中心带一点
      const mag = g.gemLevel("magnet");
      if (mag > 0) {
        const gw = world.gutterWidth;
        const zone = world.payoutY - 190;
        for (const c of world.coins) {
          if (c.y < zone) continue;
          if (c.x < gw + c.r * 2.2) c.vx += mag * 46 * dt;
          else if (c.x > world.W - gw - c.r * 2.2) c.vx -= mag * 46 * dt;
        }
      }

      if (g.comboTimer > 0) {
        g.comboTimer -= dt;
        if (g.comboTimer <= 0) { g.combo = 0; g.comboMul = 1; }
      }
      if (g.batchTimer > 0) {
        g.batchTimer -= dt;
        if (g.batchTimer <= 0) { g.batchValue = 0; g.batchCount = 0; }
      }

      g.refillAcc += dt;
      if (g.refillAcc >= 0.5) {
        g.refillAcc = 0;
        if (world.coins.length < g.refillAt() && !world.full) {
          if (!g.hasChest() && Math.random() < 0.02 + 0.004 * g.upLevel("luck")) {
            world.drop(D.COIN_DEFS.chest);
          } else {
            world.drop(g.mixDef());
          }
        }
      }

      if (st.credits < 1 && !st.auto && world.coins.length < 14) g.bailout();

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
        v: 1,
        st: st,
        coins: world.serialize(220),
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
    g.fromJSON = function (obj) {
      if (!obj || !obj.st) return false;
      const base = newState();
      const src = obj.st;
      for (const k in base) if (k in src) base[k] = src[k];
      base.totals = Object.assign(newState().totals, src.totals || {});
      base.totals.kinds = Object.assign({}, (src.totals && src.totals.kinds) || {});
      base.upgrades = Object.assign({}, src.upgrades || {});
      base.gemUpgrades = Object.assign({}, src.gemUpgrades || {});
      base.ach = Object.assign({}, src.ach || {});
      for (const k in st) delete st[k];
      Object.assign(st, base);
      world.restore(obj.coins, D.COIN_DEFS);
      g.applyUpgrades();
      g.combo = 0; g.comboTimer = 0; g.comboMul = 1;
      g.batchValue = 0; g.batchCount = 0;
      return true;
    };
    g.reset = function (storage) {
      const s = storage || (typeof localStorage !== "undefined" ? localStorage : null);
      if (s) { try { s.removeItem(SAVE_KEY); } catch (e) { /* ignore */ } }
      const fresh = newState();
      for (const k in st) delete st[k];
      Object.assign(st, fresh);
      world.clear();
      g.applyUpgrades();
      g.combo = 0; g.comboTimer = 0; g.comboMul = 1;
      g.batchValue = 0; g.batchCount = 0;
      g.seedField(170, 2);
    };

    /* ---------------- 启动 ---------------- */
    g.applyUpgrades();
    g.seedField(170, 2);
    return g;
  }

  return { createGame, newState, SAVE_KEY: SAVE_KEY };
});
