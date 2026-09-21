/* ============================================================
 * 投币导轨 / 入口通道（Phase 2）
 *
 * 投币不再是"点一下 → 币直接出现在台面"，而是：
 *   投币口 → 入口通道 → 短导轨 → 旋转下落 → 落台
 *
 * 实现方式刻意保持**非侵入**：
 *   物理层照旧立刻生成币（轨迹与平衡完全不变），
 *   这里只接管这枚币落地前 0.24 秒的**画面**——
 *   把币沿着一条加速下落的曲线从投币口送到它真实的落点，
 *   期间压住正常绘制。所以"投币过程看得见"，但经济测试一个数字都不动。
 * ============================================================ */
(function (root) {
  "use strict";

  const P = root.CPProject, M = root.CPMachine;
  const W = P.W;

  const DUR = 0.24;
  const list = [];

  function note(c) {
    if (!c) return null;
    const m = M.chuteMouth();
    const e = {
      c: c, t: DUR, dur: DUR,
      x0: m.x, y0: m.y,
      sway: (Math.random() - 0.5) * 30
    };
    c._chuteT = DUR;
    list.push(e);
    if (list.length > 24) list.splice(0, list.length - 24);
    return e;
  }

  function update(dt) {
    if (!(dt > 0)) return;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      e.t -= dt;
      e.c._chuteT = e.t > 0 ? e.t : 0;
      if (e.t <= 0) list.splice(i, 1);
    }
  }

  function clear() {
    for (const e of list) e.c._chuteT = 0;
    list.length = 0;
  }

  /** 该币此刻在导轨上的屏幕位置 */
  function at(e) {
    const p = 1 - e.t / e.dur;                 // 0 → 1
    const c = e.c;
    const tx = P.projectX(c.x, c.y);
    const ty = P.projectY(c.y, c.z);
    const ease = p * p * 0.72 + p * 0.28;      // 越往下越快，像真的被重力抓走
    const q = 1 - p;
    const x = q * q * e.x0 + 2 * q * p * (e.x0 + e.sway) + p * p * tx;
    const y = e.y0 + (ty - e.y0) * ease;
    return { x: x, y: y, p: p, target: { x: tx, y: ty } };
  }

  /** 导轨本体：投币口 + 入口通道（画在硬币之前） */
  function drawRail(ctx, nowT) {
    const m = M.chuteMouth();
    const y0 = m.y - 6, y1 = m.y + 74;

    // 通道
    ctx.save();
    const grd = ctx.createLinearGradient(0, y0, 0, y1);
    grd.addColorStop(0, "rgba(20,16,44,.92)");
    grd.addColorStop(1, "rgba(8,6,20,.35)");
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.moveTo(m.x - 30, y0);
    ctx.lineTo(m.x + 30, y0);
    ctx.lineTo(m.x + 16, y1);
    ctx.lineTo(m.x - 16, y1);
    ctx.closePath();
    ctx.fill();

    // 两条导轨（收剑）
    ctx.strokeStyle = "rgba(120,150,255,.30)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(m.x - 30, y0); ctx.lineTo(m.x - 16, y1);
    ctx.moveTo(m.x + 30, y0); ctx.lineTo(m.x + 16, y1);
    ctx.stroke();
    ctx.restore();

    // 投币口
    const pulse = 0.5 + 0.5 * Math.sin(nowT * 2.6);
    ctx.save();
    ctx.fillStyle = "#05040e";
    ctx.beginPath();
    ctx.ellipse(m.x, y0 - 3, 22, 6.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(78,226,255," + (0.35 + 0.3 * pulse).toFixed(3) + ")";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(m.x, y0 - 3, 22, 6.5, 0, 0, Math.PI * 2);
    ctx.stroke();
    // 口内的光
    ctx.globalAlpha = 0.25 + 0.35 * pulse;
    ctx.fillStyle = "#4ee2ff";
    ctx.beginPath();
    ctx.ellipse(m.x, y0 - 3, 15, 3.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** 导轨中的币（画在硬币层之上，因为它们还在机器上方） */
  function draw(ctx, nowT) {
    if (!list.length) return;
    const C = root.CPCoin;
    const D = root.CPData;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const def = D.COIN_DEFS[e.c.kind];
      if (!def) continue;
      const pos = at(e);
      const k = P.kAt(e.c.y) * P.viewScale() * 0.92;
      // 拖尾：一条越来越淡的残影
      ctx.save();
      ctx.globalAlpha = 0.28 * (1 - pos.p);
      ctx.fillStyle = def.glow;
      ctx.beginPath();
      ctx.ellipse(pos.x, pos.y - 8 * (1 - pos.p), 6 * k, 9 * k, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      C.drawCoin(ctx, def, pos.x, pos.y, k,
        { flip: e.c.rot + pos.p * 9, tilt: 0, seed: e.c.id },
        0.55 + 0.45 * pos.p, nowT);
    }
  }

  root.CPChute = {
    note: note, update: update, clear: clear,
    drawRail: drawRail, draw: draw,
    count: function () { return list.length; }
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
