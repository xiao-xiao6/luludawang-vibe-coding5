/* ============================================================
 * 数据层：币种 / 连击 / 升级 / 成就 / 奖池 / 机台修饰 —— 纯数据，无副作用
 * ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CPData = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* 币种。r/mass 影响物理手感，value 是掉出前沿的收益，cost 是投币成本。
   *
   * art / halo / hero 是**纯表现层元数据**，物理与经济完全不读它们：
   *   art  = disc（硬币圆片）| gem（棱面钻石）| chest（伪3D 宝箱）| tower（伪3D 金币塔）
   *   halo = 稀有奖励的脉冲光晕色（null = 普通币不发光晕）
   *   hero = 是否走「稀有奖励」的强化表现（光晕 / 星尘 / 拾取横幅） */
  const COIN_DEFS = {
    copper: {
      id: "copper", name: "铜币", glyph: "¢", r: 11, mass: 1, value: 1, cost: 1,
      color: "#c8813a", color2: "#f4c286", ring: "#7a4520", glow: "#ffb066",
      rarity: "普通", art: "disc", halo: null, hero: false
    },
    silver: {
      id: "silver", name: "银币", glyph: "✧", r: 11, mass: 1.35, value: 3, cost: 3,
      color: "#96a3b4", color2: "#eaf2fb", ring: "#5b6676", glow: "#cfe2f7",
      rarity: "常见", art: "disc", halo: null, hero: false
    },
    gold: {
      id: "gold", name: "金币", glyph: "★", r: 12, mass: 1.9, value: 10, cost: 10,
      color: "#d8a51f", color2: "#ffe98a", ring: "#8a6410", glow: "#ffd75e",
      rarity: "稀有", art: "disc", halo: "rgba(255,215,94,.55)", hero: true
    },
    diamond: {
      id: "diamond", name: "钻石币", glyph: "◆", r: 12, mass: 1.6, value: 25, cost: 25, gem: 1,
      color: "#37c2e6", color2: "#cbf5ff", ring: "#1a6b85", glow: "#7ce8ff",
      rarity: "史诗", art: "gem", halo: "rgba(124,232,255,.7)", hero: true
    },
    lucky: {
      id: "lucky", name: "幸运币", glyph: "✚", r: 11, mass: 1.0, value: 2, cost: 2, ticket: 1,
      color: "#46c877", color2: "#d4ffe6", ring: "#1f7a41", glow: "#7dffab",
      rarity: "稀有", art: "disc", halo: "rgba(125,255,171,.5)", hero: true
    },
    chest: {
      id: "chest", name: "宝箱", glyph: "?", r: 17, mass: 3.2, value: 0, cost: 0, jackpot: 1,
      color: "#a94bdd", color2: "#f2d2ff", ring: "#5a1d7a", glow: "#e39bff",
      rarity: "传说", art: "chest", halo: "rgba(227,155,255,.8)", hero: true
    },
    /* 金币塔：比宝箱更稀有的传说奖励。推落后立刻结算一大笔现金 +
     * 撒下一批币 —— 是「看得见的大奖」，也是限时订单之外的长线目标。 */
    tower: {
      id: "tower", name: "金币塔", glyph: "▲", r: 16, mass: 3.0, value: 0, cost: 0, tower: 1,
      color: "#e8940f", color2: "#ffe9a8", ring: "#7a4a06", glow: "#ffd75e",
      rarity: "传说", art: "tower", halo: "rgba(255,215,94,.9)", hero: true
    }
  };
  const COIN_ORDER = ["copper", "silver", "gold", "diamond", "lucky", "chest", "tower"];

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
    { id: "cap", name: "扩容槽", desc: "台面容量 +30，补给线同步抬高", max: 4, base: 130, growth: 1.9, icon: "▤" },
    /* 针对拥堵 / 爆仓这两条惩罚线，给玩家明确的解法 */
    { id: "vent", name: "排风马达", desc: "拥堵带来的减速 -34%/级（满级几乎免疫）", max: 3, base: 240, growth: 1.9, icon: "≋" },
    { id: "guard", name: "防爆护栏", desc: "爆仓时少被挤掉 1 枚币/级", max: 3, base: 280, growth: 1.95, icon: "▣" }
  ];
  /* 8 项基础升级 + 2 项惩罚对策 = 10 项；成就里的「满配机台」按 UPGRADES.length 全量校验 */

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
    { id: "allmax", name: "满配机台", desc: "10 项金币升级全部升满", check: (s) => UPGRADES.every((u) => (s.upgrades[u.id] || 0) >= u.max) },
    { id: "prestige1", name: "换台重生", desc: "完成 1 次换机台", check: (s) => (s.prestige || 0) >= 1 },
    /* ---- 新玩法（惩罚 / 风险 / 大奖）的收集目标 ---- */
    { id: "tower1", name: "金币塔落成", desc: "推落 1 座金币塔", check: (s) => (s.totals.towers || 0) >= 1 },
    { id: "order5", name: "接单达人", desc: "完成 5 个限时订单", check: (s) => (s.totals.ordersDone || 0) >= 5 },
    { id: "orderfail1", name: "愿赌服输", desc: "经历 1 次订单失败（罚金 + 过热）", check: (s) => (s.totals.ordersFailed || 0) >= 1 },
    { id: "overflow1", name: "爆仓教训", desc: "经历 1 次爆仓（台面挤爆）", check: (s) => (s.totals.bursts || 0) >= 1 },
    { id: "streak1", name: "漏了个大洞", desc: "触发 1 次漏币连锁", check: (s) => (s.totals.streaks || 0) >= 1 },
    { id: "hot10", name: "超频狂人", desc: "使用 10 次超频", check: (s) => (s.totals.hotUses || 0) >= 10 }
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

  /* ---------------- 拥堵 / 爆仓（失败机制第一层）
   * 台面越满，推板越推不动：堆着不推 = 效率暴跌；
   * 满到 100% 还会被「挤爆」，前沿的币直接被挤进角沟。
   * 对策是排风马达 + 防爆护栏，以及玩家自己把币推下去。
   *
   * 阈值定在 88%：实测正常游玩（持续投币）稳态会落在 85~92%，
   * 所以拥堵是「推得越猛越明显」的动态压力，而不是一开局就常驻的固定税。 */
  const CONGESTION = {
    warn: 0.88,       // 超过容量 88% 进入拥堵
    speedLoss: 0.24,  // 完全拥堵时推板速度 -24%
    burstAt: 10,      // 满台后硬塞多少次触发爆仓
    burstCoins: 2,    // 每次爆仓挤掉的枚数
    ventRelief: 0.34  // 排风马达每级抵消的拥堵比例
  };

  /* ---------------- 漏币连锁（失败机制第二层）
   * 短时间内连续掉沟，机台会「漏」：角沟临时变宽，越漏越亏。 */
  const STREAK = { n: 3, window: 6, dur: 6, mul: 1.15 };

  /* ---------------- 金币塔
   * 幸运石越高越容易刷出。base 给得很小：初始机台几乎不会刷到，
   * 保证「开荒期投入产出比」不被稀有奖励污染。 */
  const TOWER = {
    base: 0.0012, perLuck: 0.0013, max: 0.012, cooldown: 55,
    bonusBase: 220, bonusSpread: 200, bonusPerLuck: 36,
    gold: 14, silver: 8
  };
  function towerChance(luck) {
    const l = Math.max(0, luck || 0);
    return Math.min(TOWER.max, TOWER.base + TOWER.perLuck * l);
  }

  /* ---------------- 超频（玩家主动，不是自动 buff）
   * 冷却好了按钮亮起，玩家自己点：花金币换 8 秒双倍产出 + 推板加速。
   * 因为必须手动触发，自动化测试永远不会碰到它。 */
  const HOT = { readyEvery: 40, dur: 8, mul: 2, speed: 1.25, cost: 45 };

  /* ---------------- 订单（风险目标 = 失败机制第三层）
   * 机台会不定时给出一个限时订单，玩家自己决定接不接。
   * 接了：达标拿重赏；没达标：罚金 + 机台过热（推板减速 12 秒）。
   *
   * **目标是自适应的**：按玩家最近一段时间的真实产出（指数滑动平均）
   * 反推，所以初始机台不会收到根本做不完的单，满配机台也不会收到
   * 随手就能过的白送单。ask = 要求你拿出近期速度的几成；
   * pay = 赏金相对于「这段时间本来能赚多少」的倍数。
   *
   * 节奏参数独立放这里，UI 直接读同一份，不会出现"公示节奏和实现不一致"。
   * 不接 = 不算失败（提议到期自动收回），只有接了没做到才罚。 */
  const ORDER = { first: 14, every: 48, expire: 9, ema: 22 };
  const OVERHEAT = { dur: 12, mul: 0.72 };
  /* basis 决定目标怎么算：
   *   pays  → 推落枚数；gems → 推落钻石币；combo → 连击；clean → 连续不掉沟枚数
   * ask  → 要求你拿出近期速度的几成（越低越容易）
   * pay  → 赏金相对「这段时间本来能赚多少」的倍数
   * min/max 夹紧目标，floor 是产能过低时的赏金兼底。 */
  const ORDERS = [
    { id: "rush", name: "急速推落", unit: "枚", time: 24, basis: "pays", ask: 0.75, pay: 1.2, min: 6, max: 160, floor: 60 },
    { id: "combo", name: "连击挑战", unit: "连击", time: 20, basis: "combo", ask: 0.9, pay: 1.0, min: 5, max: 45, floor: 130 },
    { id: "gem", name: "钻石订单", unit: "枚钻石币", time: 32, basis: "gems", ask: 0.5, pay: 1.1, min: 1, max: 10, floor: 150 },
    { id: "clean", name: "零失误", unit: "枚连击不掉沟", time: 22, basis: "clean", ask: 0.4, pay: 0.9, min: 5, max: 60, floor: 90 }
  ];
  /** 赏金相对于「这段时间本来能赚多少」的倍数；罚金 = 赏金 × 这个比例 */
  const ORDER_PENALTY_RATIO = 0.45;
  /** 订单可行性下限：预期产出低于这个量就不出这种单（不给玩家做不完的任务）。
   * 宝石订单单独用 ORDER_GEM_FEASIBLE：钻石币的产出在机台之间差了上百倍，
   * 所以要求「这段时间的期望钻石数」达到 1.5 枚才派单 ——
   * 初始机台（几乎不产钻石）永远收不到，满配机台（期望 2~5 枚）才收得到。 */
  const ORDER_FEASIBLE = 1.0;
  const ORDER_GEM_FEASIBLE = 1.5;

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
    CONGESTION, STREAK, TOWER, towerChance, HOT, OVERHEAT, ORDERS, ORDER, ORDER_PENALTY_RATIO, ORDER_FEASIBLE, ORDER_GEM_FEASIBLE,
    mulFor, tierMul, tierLabel, tierRank, CRIT_MULT, critChance,
    upCost, fmt, makeRng
  };
});
