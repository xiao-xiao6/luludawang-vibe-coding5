/* ============================================================
 * 数据层：币种 / 连击 / 升级 / 成就 —— 纯数据，无副作用
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

  /* 连击阶梯：窗口内掉出 N 枚时的倍率（偏高阈值，让高倍率保持稀有） */
  const COMBO_TIERS = [
    { n: 5, mul: 1.4, label: "NICE" },
    { n: 12, mul: 1.8, label: "GREAT" },
    { n: 25, mul: 2.5, label: "AMAZING" },
    { n: 50, mul: 4, label: "UNREAL" }
  ];
  const COMBO_WINDOW = 0.9;

  /* 金币升级 */
  const UPGRADES = [
    { id: "speed", name: "推板马达", desc: "推板往复速度 +12%", max: 6, base: 60, growth: 1.72, icon: "⚙" },
    { id: "reach", name: "行程连杆", desc: "推板行程 +9%", max: 6, base: 80, growth: 1.76, icon: "↔" },
    { id: "slick", name: "滑板涂层", desc: "台面摩擦 -8%", max: 5, base: 110, growth: 1.82, icon: "≈" },
    { id: "rail", name: "侧护栏", desc: "两侧角沟 -12% 宽", max: 5, base: 150, growth: 1.86, icon: "▮" },
    { id: "multi", name: "投币口", desc: "一次投币 +1 枚", max: 4, base: 90, growth: 1.95, icon: "≡" },
    { id: "auto", name: "自动投币机", desc: "每秒自动投币 +1", max: 6, base: 220, growth: 1.88, icon: "⟳" },
    { id: "luck", name: "幸运石", desc: "机台补给好币更多", max: 6, base: 170, growth: 1.8, icon: "✦" },
    { id: "cap", name: "扩容槽", desc: "场上容量 +50", max: 4, base: 130, growth: 1.9, icon: "▤" }
  ];

  /* 钻石升级（稀缺货币，效果更强） */
  const GEM_UPGRADES = [
    { id: "magnet", name: "磁力线圈", desc: "前沿的币被轻轻吸回中心，少掉沟", max: 3, costs: [3, 7, 12], icon: "◉" },
    { id: "crit", name: "暴击芯片", desc: "所有连击倍率 +0.5", max: 3, costs: [4, 9, 15], icon: "✷" }
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
    { id: "maxed", name: "满级推手", desc: "把任一升级升满", check: (s) => UPGRADES.some((u) => (s.upgrades[u.id] || 0) >= u.max) }
  ];

  function mulFor(count, bonus) {
    let base = 1;
    for (let i = 0; i < COMBO_TIERS.length; i++) if (count >= COMBO_TIERS[i].n) base = COMBO_TIERS[i].mul;
    const mul = base + (bonus || 0);
    return Math.round(mul * 100) / 100;
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

  return {
    COIN_DEFS, COIN_ORDER, COMBO_TIERS, COMBO_WINDOW,
    UPGRADES, GEM_UPGRADES, ACHIEVEMENTS,
    mulFor, tierLabel, upCost, fmt
  };
});
