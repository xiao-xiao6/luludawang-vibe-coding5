/* ============================================================
 * 数据层：币种 / 连击 / 升级 / 成就 / 奖池 / 机台修饰 —— 纯数据，无副作用
 * ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CPData = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* 币种。r/mass 影响物理手感，value 是掉出前沿的收益，cost 是投币成本 */
  const COIN_DEFS = {
    copper: {
      id: "copper", name: "铜币", glyph: "¢", r: 11, mass: 1, value: 1, cost: 1,
      color: "#c8813a", color2: "#f4c286", ring: "#7a4520", glow: "#ffb066",
      rarity: "普通"
    },
    silver: {
      id: "silver", name: "银币", glyph: "✧", r: 11, mass: 1.35, value: 3, cost: 3,
      color: "#96a3b4", color2: "#eaf2fb", ring: "#5b6676", glow: "#cfe2f7",
      rarity: "常见"
    },
    gold: {
      id: "gold", name: "金币", glyph: "★", r: 12, mass: 1.9, value: 10, cost: 10,
      color: "#d8a51f", color2: "#ffe98a", ring: "#8a6410", glow: "#ffd75e",
      rarity: "稀有"
    },
    diamond: {
      id: "diamond", name: "钻石币", glyph: "◆", r: 12, mass: 1.6, value: 25, cost: 25, gem: 1,
      color: "#37c2e6", color2: "#cbf5ff", ring: "#1a6b85", glow: "#7ce8ff",
      rarity: "史诗"
    },
    lucky: {
      id: "lucky", name: "幸运币", glyph: "✚", r: 11, mass: 1.0, value: 2, cost: 2, ticket: 1,
      color: "#46c877", color2: "#d4ffe6", ring: "#1f7a41", glow: "#7dffab",
      rarity: "稀有"
    },
    chest: {
      id: "chest", name: "宝箱", glyph: "?", r: 17, mass: 3.2, value: 0, cost: 0, jackpot: 1,
      color: "#a94bdd", color2: "#f2d2ff", ring: "#5a1d7a", glow: "#e39bff",
      rarity: "传说"
    }
  };
  const COIN_ORDER = ["copper", "silver", "gold", "diamond", "lucky", "chest"];

  /* ---------------- 连击 ----------------
   * 阶梯阈值偏高，让高倍率保持稀有。
   * 窗口是**动态**的：连击越高，窗口越短 —— 掉币越密集越难续上，
   * 这样"×4"是玩家真的打出来的爆发，而不是满配后的常驻状态。
   */
  const COMBO_TIERS = [
    { n: 6, mul: 1.4, label: "NICE" },
    { n: 11, mul: 1.8, label: "GREAT" },
    { n: 18, mul: 2.5, label: "AMAZING" },
    { n: 30, mul: 4, label: "UNREAL" }
  ];
  /* 连击是**滑动窗口计数**：统计最近 COMBO_WINDOW 秒内推落的枚数，
   * 而不是"只要间隔不超时就越滚越大"的单调计数器。
   * 这样 ×4 需要在 0.9 秒内推落 30 枚（约 33 枚/秒）的爆发才拿得到，
   * 稳态推币只能吃到 ×1.4~×1.8 —— 倍率终于回归"爆发奖励"。 */
  const COMBO_WINDOW = 0.9;

  function tierRank(count) {
    let r = 0;
    for (let i = 0; i < COMBO_TIERS.length; i++) if (count >= COMBO_TIERS[i].n) r++;
    return r;
  }

  /* 金币升级（全部映射到真实仿真参数，不是假倍率） */
  const UPGRADES = [
    { id: "speed", name: "推板马达", desc: "推板往复速度 +12%", max: 6, base: 60, growth: 1.72, icon: "⚙" },
    { id: "reach", name: "行程连杆", desc: "推板行程 +9%", max: 6, base: 80, growth: 1.76, icon: "↔" },
    { id: "slick", name: "滑板涂层", desc: "台面摩擦 -8%", max: 5, base: 110, growth: 1.82, icon: "≈" },
    { id: "rail", name: "侧护栏", desc: "两侧角沟 -12% 宽", max: 5, base: 150, growth: 1.86, icon: "▮" },
    { id: "multi", name: "投币口", desc: "一次投币 +1 枚", max: 4, base: 90, growth: 1.95, icon: "≡" },
    { id: "auto", name: "自动投币机", desc: "每秒自动投币 +1", max: 6, base: 220, growth: 1.88, icon: "⟳" },
    { id: "luck", name: "幸运石", desc: "机台补给好币更多", max: 6, base: 170, growth: 1.8, icon: "✦" },
    { id: "cap", name: "扩容槽", desc: "台面容量 +30，补给线同步抬高", max: 4, base: 130, growth: 1.9, icon: "▤" }
  ];

  /* 钻石升级（稀缺货币，效果更强） */
  const GEM_UPGRADES = [
    {
      id: "magnet", name: "磁力线圈",
      desc: "前沿的币被轻轻吸回中心，少掉沟（真实施力，不是瞬移）",
      max: 3, costs: [3, 7, 12], icon: "◉"
    },
    {
      id: "crit", name: "暴击芯片",
      desc: "每枚推落的币有 10%/级 概率触发暴击 ×2（期望收益 +10%/级）",
      max: 3, costs: [4, 9, 15], icon: "✷"
    }
  ];

  const ACHIEVEMENTS = [
    { id: "first", name: "初次投币", desc: "投出第 1 枚币", check: (s) => s.totals.drops >= 1 },
    { id: "hundred", name: "百币入机", desc: "累计投出 100 枚", check: (s) => s.totals.dropped >= 100 },
    { id: "combo10", name: "十连推落", desc: "一次连击达 10 枚", check: (s) => s.totals.bestCombo >= 10 },
    { id: "combo25", name: "推币如雨", desc: "一次连击达 25 枚", check: (s) => s.totals.bestCombo >= 25 },
    { id: "earn1k", name: "小有积蓄", desc: "累计收益 1000 金币", check: (s) => s.totals.earned >= 1000 },
    { id: "earn20k", name: "币海富翁", desc: "累计收益 20000 金币", check: (s) => s.totals.earned >= 20000 },
    { id: "jackpot", name: "中大奖", desc: "推落 1 个宝箱", check: (s) => s.totals.jackpots >= 1 },
    { id: "diamond10", name: "钻石猎人", desc: "推落 10 枚钻石币", check: (s) => (s.totals.kinds.diamond || 0) >= 10 },
    { id: "maxed", name: "满级推手", desc: "把任一升级升满", check: (s) => UPGRADES.some((u) => (s.upgrades[u.id] || 0) >= u.max) },
    /* ---- 长线目标：让"通关"之后还有可追的东西 ---- */
    { id: "combo30", name: "极限爆发", desc: "0.9 秒内推落 30 枚（UNREAL 档）", check: (s) => s.totals.bestCombo >= 30 },
    { id: "drop10k", name: "万台推落", desc: "累计推落 10000 枚币", check: (s) => s.totals.paid >= 10000 },
    { id: "earn100k", name: "推币大亨", desc: "累计收益 100000 金币", check: (s) => s.totals.earned >= 100000 },
    { id: "allmax", name: "满配机台", desc: "8 项金币升级全部升满", check: (s) => UPGRADES.every((u) => (s.upgrades[u.id] || 0) >= u.max) },
    { id: "prestige1", name: "换台重生", desc: "完成 1 次换机台", check: (s) => (s.prestige || 0) >= 1 }
  ];

  /* ---------------- 抽奖奖池（概率对玩家公开） ---------------- */
  const LOTTERY_TICKET_COST = 5;
  const LOTTERY_TABLE = [
    { kind: "credits", p: 0.32, label: "金币 +120 ~ 420" },
    { kind: "gems", p: 0.24, label: "钻石 +1 ~ 3" },
    { kind: "rain", p: 0.20, label: "金币雨 ×最多 10" },
    { kind: "rain", p: 0.15, label: "钻石雨 ×最多 5" },
    { kind: "jackpot", p: 0.09, label: "JACKPOT（现金 + 撒币）" }
  ];

  /* ---------------- 机台修饰（换机台时随机抽一台） ---------------- */
  const MODIFIERS = [
    { id: "plain", name: "标准机台", desc: "没有任何额外修正，最稳的一台。", gut: 1, speed: 1, friction: 1, luck: 0, gain: 1 },
    { id: "greedy", name: "贪心机台", desc: "角沟宽 25%，但所有收益 +20%。", gut: 1.25, speed: 1, friction: 1, luck: 0, gain: 1.2 },
    { id: "kind", name: "温柔机台", desc: "角沟收窄 25%，但所有收益 -10%。", gut: 0.75, speed: 1, friction: 1, luck: 0, gain: 0.9 },
    { id: "rich", name: "富矿机台", desc: "机台补给好币更多（幸运 +2），推板慢 10%。", gut: 1, speed: 0.9, friction: 1, luck: 2, gain: 1 },
    { id: "turbo", name: "涡轮机台", desc: "推板快 18%，但台面摩擦略大。", gut: 1, speed: 1.18, friction: 1.08, luck: 0, gain: 1 }
  ];
  const MOD_BY_ID = {};
  for (const m of MODIFIERS) MOD_BY_ID[m.id] = m;

  function modById(id) { return MOD_BY_ID[id] || MODIFIERS[0]; }
  function rollModifier(rng, current) {
    const r = typeof rng === "function" ? rng : Math.random;
    let pick = MODIFIERS[(r() * MODIFIERS.length) | 0] || MODIFIERS[0];
    if (pick.id === current && MODIFIERS.length > 1) {
      pick = MODIFIERS[(MODIFIERS.indexOf(pick) + 1) % MODIFIERS.length];
    }
    return pick.id;
  }

  /* ---------------- 换机台（Prestige） ---------------- */
  const PRESTIGE = {
    earned: 25000,   // 累计收益门槛
    bonus: 0.2,      // 每层永久收益 +20%
    grant: 400       // 换台后发放的启动金币
  };

  /* ---------------- 机台补给 / 宝箱 ----------------
   * 所有概率集中在这里，UI 也直接读同一份 ——
   * 不会出现“公示概率和实现不一致”。 */
  const REFILL = {
    every: 0.5,    // 每 0.5 秒尝试补一次
    ratio: 0.6,    // 补给线 = 容量的 60%（扩容槽升上去，台面也真的会填上去）
    min: 90        // 补给线下限
  };
  const CHEST = {
    base: 0.01,        // 每次补给的基础出现率
    perLuck: 0.0008,   // 每级幸运石加成
    max: 0.025,        // 出现率上限
    cooldown: 28,      // 两次宝箱之间的最短间隔（秒）：防止满配时宝箱刷成印钞机
    bonusBase: 200,    // JACKPOT 现金基础
    bonusSpread: 170,  // 现金随机浮动
    bonusPerLuck: 28,  // 每级幸运石追加
    gold: 24, silver: 14, diamond: 3   // 撒币构成（合计 41 枚）
  };
  function chestChance(luck) {
    const l = Math.max(0, luck || 0);
    return Math.min(CHEST.max, CHEST.base + CHEST.perLuck * l);
  }

  /* ---------------- 计算 ---------------- */
  function tierMul(count) {
    let base = 1;
    for (let i = 0; i < COMBO_TIERS.length; i++) if (count >= COMBO_TIERS[i].n) base = COMBO_TIERS[i].mul;
    return base;
  }

  /* 连击倍率只看滑动窗口内的枚数；暴击是独立的"概率翻倍"（见 critChance），
   * 不再往基础倍率上叠加，所以 ×4 依然是稀有爆发而不是常驻状态。 */
  function mulFor(count) {
    return tierMul(count);
  }

  /* 暴击芯片：概率触发、倍率翻倍 —— 收益上限可预期（每级 +10% 期望）。 */
  const CRIT_MULT = 2;
  function critChance(level) {
    const lv = Math.max(0, Math.min(3, level || 0));
    return 0.1 * lv;
  }

  function tierLabel(count) {
    let lab = "";
    for (let i = 0; i < COMBO_TIERS.length; i++) if (count >= COMBO_TIERS[i].n) lab = COMBO_TIERS[i].label;
    return lab;
  }

  function upCost(u, level) { return Math.round(u.base * Math.pow(u.growth, level)); }

  function fmt(n) {
    n = Math.round(n || 0);
    if (Math.abs(n) < 10000) return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (n / 10000).toFixed(n >= 1000000 ? 0 : 1) + "万";
  }

  /* 可播种随机源（mulberry32）：让平衡测试变成真正的回归测试，
   * 而不是每次跑都抽一次样的"抽样"。 */
  function makeRng(seed) {
    let a = (seed == null ? 1 : seed) >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  return {
    COIN_DEFS, COIN_ORDER, COMBO_TIERS, COMBO_WINDOW,
    UPGRADES, GEM_UPGRADES, ACHIEVEMENTS,
    LOTTERY_TABLE, LOTTERY_TICKET_COST,
    MODIFIERS, modById, rollModifier, PRESTIGE,
    REFILL, CHEST, chestChance,
    mulFor, tierMul, tierLabel, tierRank, CRIT_MULT, critChance,
    upCost, fmt, makeRng
  };
});
