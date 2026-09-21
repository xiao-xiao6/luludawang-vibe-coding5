/* ============================================================
 * 出币与结算动画（Phase 7）
 *
 * 奖励掉出前沿之后不能瞬间消失，必须走完整条链：
 *   进入出口 → 在出口短暂停顿（稀有奖励有 Hero Hold）
 *   → 离开机器 → 沿弧线飞向 HUD → 数字滚动结算
 *
 * 这里负责"飞"的那一段；数字滚动由 app.js 的 displayCredits 缓动负责。
 * 普通奖励 0.35~0.5s，稀有奖励 0.5~0.8s。
 * ============================================================ */
(function (root) {
  "use strict";

  const P = root.CPProject, C = root.CPCoin, M = root.CPMachine, VR = root.CPVRng;
  const W = P.W;

  const MAX = 40;
  const items = [];
  let anchor = { x: W - 62, y: 16 };
  let onLand = null;

  function setAnchor(a) { if (a) anchor = a; }
  function setOnLand(fn) { onLand = fn; }

  /**
   * @param {object} def    币种定义
   * @param {number} sx,sy  起点（屏幕坐标，通常在出币口）
   * @param {number} amount 结算金额（给 HUD 飘字用）
   * @param {object} opt    { hero, jackpot, label }
   */
  function spawn(def, sx, sy, amount, opt) {
    opt = opt || {};
    const hero = !!opt.hero;
    const item = {
      def: def, amount: amount || 0,
      x0: sx, y0: sy, x: sx, y: sy,
      hero: hero,
      jackpot: !!opt.jackpot,
      label: opt.label || null,
      hold: hero ? 0.16 + VR.range(0, 0.14) : 0,
      fly: hero ? 0.5 + VR.range(0, 0.3) : 0.35 + VR.range(0, 0.15),
      t: 0,
      arc: hero ? 90 : 54,
      spin: VR.range(-4, 4),
      seed: VR.range(0, Math.PI * 2),
      alpha: 1,
      scale: 1
    };
    items.push(item);
    if (items.length > MAX) items.splice(0, items.length - MAX);
    return item;
  }

  function update(dt) {
    if (!(dt > 0)) return;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      it.t += dt;

      if (it.t < it.hold) {
        // Hero Hold：停在出口，轻微呼吸放大 —— 让玩家"发现 → 确认 → 期待"
        const p = it.t / Math.max(1e-4, it.hold);
        it.x = it.x0;
        it.y = it.y0 + Math.sin(p * Math.PI) * 4;
        it.scale = 1 + 0.08 * Math.sin(p * Math.PI);
        it.alpha = 1;
        continue;
      }

      const p = Math.min(1, (it.t - it.hold) / it.fly);
      const q = 1 - p;
      it.x = q * q * it.x0 + 2 * q * p * ((it.x0 + anchor.x) / 2) + p * p * anchor.x;
      it.y = it.y0 + (anchor.y - it.y0) * p - Math.sin(p * Math.PI) * it.arc;
      it.scale = 1 + 0.25 * Math.sin(p * Math.PI) - 0.45 * Math.max(0, p - 0.75) * 4;
      it.alpha = p > 0.82 ? Math.max(0, (1 - p) / 0.18) : 1;

      if (p >= 1) {
        items.splice(i, 1);
        if (onLand) onLand(it);
      }
    }
  }

  function draw(ctx, nowT) {
    if (!items.length) return;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const def = it.def;
      const sc = 1.05 * it.scale;

      ctx.save();
      ctx.globalAlpha = it.alpha;

      // 光晕（稀有奖励）
      if (it.hero || it.jackpot) {
        const hs = 150 * it.scale;
        ctx.globalAlpha = it.alpha * 0.55;
        ctx.drawImage(C.halo(def.halo || def.glow), it.x - hs / 2, it.y - hs / 2, hs, hs);
        ctx.globalAlpha = it.alpha;
      }

      ctx.translate(it.x, it.y);
      if (it.hero) {
        ctx.rotate(Math.sin(nowT * 3 + it.seed) * 0.12);
      } else {
        ctx.rotate(nowT * it.spin * 0.6 + it.seed);
      }
      const sp = C.face(def);
      const s = sp.size * sc;
      ctx.drawImage(sp.canvas, -s / 2, -s / 2, s, s);

      // 金额飘字：跟着币一起飞，落地那刻交给 HUD
      if (it.label && it.t >= it.hold) {
        ctx.save();
        ctx.font = "900 15px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(0,0,0,.7)";
        ctx.strokeText(it.label, 0, -s * 0.5 - 6);
        ctx.fillStyle = it.hero ? "#ffe9a8" : "#d8ffe6";
        ctx.fillText(it.label, 0, -s * 0.5 - 6);
        ctx.restore();
      }
      ctx.restore();
    }
  }

  function clear() { items.length = 0; }

  root.CPPayout = {
    setAnchor: setAnchor, setOnLand: setOnLand,
    spawn: spawn, update: update, draw: draw, clear: clear,
    count: function () { return items.length; }
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
