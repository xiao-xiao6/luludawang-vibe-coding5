/* 探针24：引擎层不变量体检 —— 找经济/存档/状态机的边界 bug。
 * 运行：node _test/_probe_engine.js
 */
"use strict";
const path = require("path");
const ROOT = path.join(__dirname, "..");
const Data = require(path.join(ROOT, "js", "data.js"));
const Engine = require(path.join(ROOT, "js", "engine.js"));

let fails = 0;
function ok(cond, label, detail) {
  console.log((cond ? "  ✓ " : "  ✗ ") + label + (detail != null ? "  (" + detail + ")" : ""));
  if (!cond) fails++;
}

console.log("=== 引擎层不变量体检 ===\n");

// 1) 存档字段级校验
console.log("[A] 引擎构造");
const E = Engine.createGame({ seed: 1 });
console.log("  createGame 成功，game API:", Object.keys(E).slice(0, 26).join(", "));
console.log("  world 存在:", !!E.world, " st 存在:", !!E.st);

// 2) 币种定义完整性
console.log("\n[B] 币种定义");
const defs = Data.COIN_DEFS;
for (const k of Data.COIN_ORDER) {
  const d = defs[k];
  ok(!!d, "币种存在: " + k);
  if (!d) continue;
  ok(typeof d.r === "number" && d.r > 0, `  ${k}.r 合法`, d.r);
  ok(typeof d.mass === "number" && d.mass > 0, `  ${k}.mass 合法`, d.mass);
  ok(typeof d.value === "number" && d.value >= 0, `  ${k}.value 合法`, d.value);
  ok(typeof d.color === "string" && /^#/.test(d.color), `  ${k}.color 是 hex`, d.color);
  if (d.hero) ok(typeof d.halo === "string" && /^rgba?\(/.test(d.halo), `  ${k}.halo 是 rgba（hero 必须）`, d.halo);
  else ok(d.halo == null, `  ${k}.halo 为 null（普通币不该有光晕）`, d.halo);
}

// 3) 抽奖概率总和
console.log("\n[C] 抽奖概率");
if (Data.LOTTERY) {
  const sum = Data.LOTTERY.reduce((s, x) => s + (x.p || 0), 0);
  ok(Math.abs(sum - 1) < 1e-6, "抽奖概率总和 = 1", sum);
} else {
  console.log("  (无 LOTTERY，跳过)");
}

// 4) 连击阶梯单调
console.log("\n[D] 连击阶梯");
const tiers = Data.COMBO_TIERS;
let mono = true;
for (let i = 1; i < tiers.length; i++) if (tiers[i].n <= tiers[i-1].n || tiers[i].mul <= tiers[i-1].mul) mono = false;
ok(mono, "连击阈值与倍率严格递增", tiers.map(t => `${t.n}→×${t.mul}`).join(" "));

// 5) 升级表完整性
console.log("\n[E] 升级表");
if (Data.UPGRADES) {
  let bad = [];
  for (const u of Data.UPGRADES) {
    if (!u.id) bad.push("无 id");
    if (typeof u.max !== "number" || u.max <= 0) bad.push(`${u.id} max 非法`);
    if (typeof u.base !== "number" || u.base <= 0) bad.push(`${u.id} base 非法`);
    if (typeof u.growth !== "number" || u.growth <= 1) bad.push(`${u.id} growth 非法`);
  }
  ok(bad.length === 0, "所有金币升级字段合法", bad.join("; ") || "ok");
  // 成本递增：base * growth^(lv-1) 单调
  let costOk = true, costDetail = "";
  for (const u of Data.UPGRADES) {
    let prev = 0;
    for (let lv = 0; lv < u.max; lv++) {
      const c = Math.round(u.base * Math.pow(u.growth, lv));
      if (c <= prev) { costOk = false; costDetail = `${u.id} lv${lv} 成本 ${c} ≤ 上一级 ${prev}`; }
      prev = c;
    }
  }
  ok(costOk, "升级成本随等级严格递增", costDetail || "ok");
  console.log("  升级项:", Data.UPGRADES.map(u => `${u.id}(max${u.max})`).join(", "));
}
if (Data.GEM_UPGRADES) {
  let bad = [];
  for (const u of Data.GEM_UPGRADES) {
    if (!u.id) bad.push("无 id");
    if (typeof u.max !== "number" || u.max <= 0) bad.push(`${u.id} max 非法`);
    if (!Array.isArray(u.costs) || u.costs.length !== u.max) bad.push(`${u.id} costs 长度 ≠ max`);
    else {
      for (let i = 1; i < u.costs.length; i++) if (u.costs[i] <= u.costs[i-1]) bad.push(`${u.id} costs 非递增`);
    }
  }
  ok(bad.length === 0, "所有钻石升级字段合法", bad.join("; ") || "ok");
  console.log("  钻石升级:", Data.GEM_UPGRADES.map(u => `${u.id}(max${u.max}, ${u.costs.join("/")})`).join(", "));
}

// 6) 订单表：目标范围合法
console.log("\n[F] 限时订单");
if (Data.ORDERS) {
  let bad = [];
  for (const o of Data.ORDERS) {
    if (!(o.min < o.max)) bad.push(`${o.id} min ≥ max`);
    if (!(o.time > 0)) bad.push(`${o.id} time 非法`);
    if (!(o.pay > 0)) bad.push(`${o.id} pay 非法`);
    if (!(o.floor > 0)) bad.push(`${o.id} floor 非法`);
  }
  ok(bad.length === 0, "订单定义合法", bad.join("; ") || "ok");
  console.log("  订单:", Data.ORDERS.map(o => `${o.id}[${o.min}~${o.max}]`).join(", "));
}

// 7) 抽成 / 维护费必须真的扣钱
console.log("\n[G] 成本机制");
const g2 = Engine.createGame({ seed: 7 });
const rakeApi = ["rakeOf", "applyRake", "rake"].find(k => typeof g2[k] === "function");
console.log("  rake API 可用:", rakeApi || "(无)");
if (rakeApi) {
  const rake = g2[rakeApi](1000);
  const net = rake.net != null ? rake.net : rake;
  const cut = rake.rake != null ? rake.rake : (1000 - net);
  ok(net < 1000 && cut > 0, "抽成真的从收益里切走", `1000 → 净 ${net} / 抽 ${cut}`);
  ok(Math.abs((net + cut) - 1000) < 1e-6, "抽成前后总额守恒", net + cut);
}
const upkeepApi = ["upkeepOf", "upkeep", "maintCost"].find(k => typeof g2[k] === "function");
console.log("  upkeep API 可用:", upkeepApi || "(无)");
if (upkeepApi) {
  const u0 = g2[upkeepApi]();
  ok(typeof u0 === "number" && u0 > 0, "初始维护费 > 0", u0);
  const cap = Data.UPKEEP && Data.UPKEEP.cap;
  if (cap) ok(u0 <= cap, "初始维护费不超过单次上限", `${u0} ≤ ${cap}`);
}
console.log("  st.credits 初始:", g2.st.credits);

console.log("\n" + "=".repeat(56));
console.log(fails === 0 ? "引擎体检通过：0 问题" : `引擎体检发现 ${fails} 个问题`);
console.log("=".repeat(56));
process.exit(fails ? 1 : 0);
