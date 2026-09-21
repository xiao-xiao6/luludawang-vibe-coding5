/* ============================================================
 * 渲染层公共小工具：路径 / 插值 / 渐变
 * 纯函数，零状态，渲染模块之间共享。
 * ============================================================ */
(function (root) {
  "use strict";

  function quad(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  }
  function fillQuad(ctx, pts, style) {
    quad(ctx, pts);
    ctx.fillStyle = style;
    ctx.fill();
  }
  function strokeQuad(ctx, pts, style, lw) {
    quad(ctx, pts);
    ctx.strokeStyle = style;
    ctx.lineWidth = lw == null ? 1 : lw;
    ctx.stroke();
  }
  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }
  function vgrad(ctx, y0, y1, stops) {
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    for (const s of stops) g.addColorStop(s[0], s[1]);
    return g;
  }
  function hgrad(ctx, x0, x1, stops) {
    const g = ctx.createLinearGradient(x0, 0, x1, 0);
    for (const s of stops) g.addColorStop(s[0], s[1]);
    return g;
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  /** 与帧率无关的平滑系数：dt 秒内追平 rate 比例 */
  function smooth(dt, rate) { return 1 - Math.exp(-dt * rate); }

  root.CPRUtil = {
    quad: quad, fillQuad: fillQuad, strokeQuad: strokeQuad,
    roundRect: roundRect, vgrad: vgrad, hgrad: hgrad,
    lerp: lerp, clamp: clamp, smooth: smooth
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
