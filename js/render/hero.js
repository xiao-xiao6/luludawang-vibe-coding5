/* ============================================================
 * 稀有奖励的 Hero 状态（Phase 6）
 *
 * 钻石 / 宝箱 / 金币塔 不再只是"加个 glow"，而是有生命周期：
 *   normal → revealed（从币堆里露出来）→ heroHold（停顿 + 高光）
 *          → release（释放）→ payout（飞出机器）
 *
 * 这里负责"在币堆里被挤出来的那一段"：
 *   - emerge 随前沿逼近而升高 → 光晕变强、地面光环加速、星尘出现
 *   - 宝箱：锁扣高光扫过 + 轻微左右晃动
 *   - 金币塔：受撞击时倾斜，然后回正
 *   - 全部稀有物：一次性的 highlight sweep（不是无限爆粒子）
 *
 * 纯视觉，不碰物理半径，也不碰结算。
 * ============================================================ */
(function (root) {
  "use strict";

  const P = root.CPProject, C = root.CPCoin, VR = root.CPVRng;
  const st = new Map();

  const HOLD_BAND = 170;   // 距前沿多远开始"露出来"

  function mk() { return { emerge: 0, wob: 0, sweep: 0, spark: 0, tilt: 0, tiltT: 0 }; }
  function get(c) {
    let s = st.get(c.id);
    if (!s) { s = mk(); st.set(c.id, s); }
    return s;
  }

  function update(world, dt) {
    if (!(dt > 0)) return;
    const coins = world.coins;
    const band = world.payoutY - HOLD_BAND;
    const k = 1 - Math.exp(-5 * dt);

    for (let i = 0; i < coins.length; i++) {
      const c = coins[i];
      const def = root.CPData.COIN_DEFS[c.kind];
      if (!def || !def.hero) continue;
      const s = get(c);

      const e = (c.y - band) / HOLD_BAND;
      s.emerge = e < 0 ? 0 : e > 1 ? 1 : e;

      // 首次"露头"：给一次高光扫过 + 一小撮星尘（克制，不刷屏）
      if (!s.revealed && s.emerge > 0.12) {
        s.revealed = true;
        s.sweep = 1;
        const fx = root.CPFx;
        if (fx) fx.stardust(P.projectX(c.x, c.y), P.projectY(c.y, c.z), def.glow, 10);
      }
      if (s.sweep > 0) s.sweep = Math.max(0, s.sweep - dt * 2.2);

      // 星尘：只在露出前沿附近、且稀疏地冒
      s.spark -= dt;
      if (s.revealed && s.emerge > 0.35 && s.spark <= 0) {
        s.spark = 0.5 + VR.range(0, 0.5);
        const fx = root.CPFx;
        if (fx) fx.stardust(P.projectX(c.x, c.y), P.projectY(c.y, c.z), def.glow, 2);
      }

      // 宝箱晃动 / 金币塔倾斜：被撞得越狠晃得越明显，然后回正
      const kick = Math.min(1, (c.stress || 0) / 4 + Math.abs(c.vx) / 220 + Math.abs(c.vy) / 220);
      s.wob = Math.max(s.wob * Math.exp(-2.5 * dt), kick * 0.6);
      if (def.art === "tower") {
        s.tiltT = (kick * 0.30) * (c.vx >= 0 ? 1 : -1);
        s.tilt += (s.tiltT - s.tilt) * k;
      } else {
        s.tilt = 0;
      }
    }
  }

  /** 光晕 + 地面光环：露出越多越强 */
  function drawAura(ctx, c, def, sx, sy, sc, nowT) {
    const s = st.get(c.id);
    const em = s ? s.emerge : 0;
    const pulse = 0.5 + 0.5 * Math.sin(nowT * 3.4 + c.id);
    const strength = 0.34 + 0.5 * em;

    /* sc 是「缩放倍率」（coin.js 的约定），不是像素尺寸 ——
     * 直接拿它当尺寸会让光晕只有 2~3px，等于没画。
     * 这里按「币在屏幕上的实际像素大小」定光晕 / 光环的尺寸。 */
    const sz = C.face(def).size * sc;
    const hs = sz * 2.6 * (1 + 0.06 * pulse + 0.18 * em);
    ctx.save();
    ctx.globalAlpha = Math.min(1, strength * (0.7 + 0.4 * pulse));
    ctx.drawImage(C.halo(def.halo), sx - hs / 2, sy - hs / 2, hs, hs);
    ctx.restore();

    // 地面光环（贴台面：z = 0，用投影后的屏幕 y，不拿台面 y 当屏幕 y）
    const rs = sz * (1.9 + 0.5 * em);
    ctx.save();
    ctx.globalAlpha = Math.min(1, (0.45 + 0.35 * pulse) * (0.5 + 0.6 * em));
    ctx.translate(P.projectX(c.x, c.y), P.projectY(c.y, 0) + 3);
    ctx.rotate(nowT * (0.9 + em * 1.4) + c.id * 0.7);
    ctx.drawImage(C.heroRing(def.halo), -rs / 2, -rs / 2, rs, rs);
    ctx.restore();
  }

  /** 一次性高光扫过（在币的精灵上斜着刷一道亮带） */
  function drawSweep(ctx, c, def, sx, sy, sc, nowT) {
    const s = st.get(c.id);
    if (!s || s.sweep <= 0) return;
    const r = def.r * sc * 1.3;
    const p = 1 - s.sweep;               // 0 → 1
    const bx = sx - r + p * r * 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalAlpha = Math.min(0.9, s.sweep * 1.1);
    const g = ctx.createLinearGradient(bx - r * 0.35, 0, bx + r * 0.35, 0);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.5, "rgba(255,255,255,.85)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
    ctx.restore();
  }

  function tiltOf(c) {
    const s = st.get(c.id);
    return s ? s.tilt : 0;
  }
  function wobbleOf(c) {
    const s = st.get(c.id);
    return s ? s.wob : 0;
  }

  function prune(world) {
    if (st.size <= world.coins.length + 8) return;
    const live = new Set();
    for (const c of world.coins) live.add(c.id);
    for (const id of st.keys()) if (!live.has(id)) st.delete(id);
  }

  function clear() { st.clear(); }

  root.CPHero = {
    update: update, drawAura: drawAura, drawSweep: drawSweep,
    tiltOf: tiltOf, wobbleOf: wobbleOf,
    prune: prune, clear: clear,
    HOLD_BAND: HOLD_BAND
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
