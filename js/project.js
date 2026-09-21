/* ============================================================
 * 2.5D 投影内核 —— 把俯视的台面坐标投影成带透视的屏幕坐标
 *
 * 设计原则（很重要）：
 *   物理内核仍然是**干净的俯视 2D**，投影只回答"画在哪"，
 *   绝不回答"落在哪"。所以经济平衡测试里的每一个数字
 *   都不会被"视角"污染，回归门禁依然有效。
 *
 * 纯函数、零 DOM 依赖，可在 node 里 headless 自检。
 *
 * 透视模型：远端（台面顶部，推板那一侧）横向收窄到 FAR，
 * 近端（出币口）铺满 1.0。所以左右护栏会向远处汇聚，
 * 推板往前推时会"变大" —— 这就是 2.5D 的立体感来源。
 *
 * V2 增补（同样零副作用，默认恒等，headless 断言不受影响）：
 *   - 视口 viewport：把整块台面装进机台内舱，默认 { cx:W/2, cy:H/2, s:1 }
 *   - projectDepth / projectHeight / projectPanel / projectWall / projectBox
 *   - coinFlip：金币绕竖直轴的伪 3D 翻转（顶面椭圆宽度 + 侧面厚度）
 *   - unprojectX：屏幕 x 反解回台面 x（输入映射用）
 * ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.CPProject = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const W = 480, H = 580;   // 台面逻辑尺寸（与 index.html 的 canvas 一致）

  const FAR = 0.68;    // y = 0（最远处）的横向比例
  const NEAR = 1.00;   // y = H（最近处）的横向比例
  const LIFT = 0.62;   // 离台高度 z → 屏幕抬升的像素比例
  const ZOOM = 0.0020; // 离台高度 z → 额外放大比例（越高离镜头越近）
  const Z_REF = 140;   // 影子淡出/收缩的参考高度
  const THICK = 3.4;   // 金币视觉厚度（针对 r≈11~12 的币调过）

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const fin = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);

  /* ---------------- 视口 ----------------
   * 机台升级后，台面不再铺满整块 canvas，而是被装进"机台内舱"里。
   * 视口就是把投影结果整体缩放/平移进内舱的那一层。
   * **默认恒等** —— 任何没显式 setViewport 的调用方（含全部 headless 测试）
   * 拿到的投影和 V1 逐位一致。
   */
  const VP = { cx: W / 2, cy: H / 2, s: 1 };

  function setViewport(vp) {
    if (!vp) { VP.cx = W / 2; VP.cy = H / 2; VP.s = 1; return VP; }
    const s = fin(vp.s, 1);
    VP.cx = fin(vp.cx, W / 2);
    VP.cy = fin(vp.cy, H / 2);
    VP.s = s > 0 ? s : 1;
    return VP;
  }
  function resetViewport() { return setViewport(null); }
  function getViewport() { return { cx: VP.cx, cy: VP.cy, s: VP.s }; }
  function viewScale() { return VP.s; }

  /** y 归一化到 [0,1] 的"深度"（0 = 最远，1 = 最近） */
  function depth(y) { return clamp(y / H, 0, 1); }

  /** 该深度处的横向比例 */
  function kAt(y) { return lerp(FAR, NEAR, depth(y)); }

  /** 该深度 + 离台高度处的整体缩放（币的绘制尺寸） */
  function scaleAt(y, z) { return kAt(y) * (1 + (z || 0) * ZOOM) * VP.s; }

  /** 投影空间（未过视口）→ 屏幕 */
  function toScreenX(px) { return VP.cx + (px - W / 2) * VP.s; }
  function toScreenY(py) { return VP.cy + (py - H / 2) * VP.s; }

  /** 台面 x → 屏幕 x */
  function projectX(x, y) { return toScreenX(W / 2 + (x - W / 2) * kAt(y)); }

  /** 台面 y + 离台高度 → 屏幕 y（越高越往上抬） */
  function projectY(y, z) { return toScreenY(y - (z || 0) * LIFT); }

  /** 币的落地影子：位置、椭圆半径、透明度（越高越淡越小）
   * 影子是 2.5D 的**主要深度线索**：没有它，币看起来就是贴在平面上的贴纸。
   * 所以给得比“物理正确”更重一点（偏下方 + 更暗），让“币浮在台面上”成立。 */
  function shadow(x, y, z, r) {
    const k = kAt(y) * VP.s;
    const t = clamp((z || 0) / Z_REF, 0, 1);
    const shrink = 1 - 0.34 * t;
    return {
      x: projectX(x, y),
      y: toScreenY(y + r * 0.62 * kAt(y)),
      rx: Math.max(0.5, r * k * shrink),
      ry: Math.max(0.3, r * k * 0.5 * shrink),
      alpha: 0.62 * (1 - 0.55 * t)
    };
  }

  /** 台面在该深度处的左右边缘屏幕坐标（烘焙护栏 / 底板的梯形用）
   *  注意：half 已经含了 kAt，所以这里只能过一次 toScreenX，不能再走 projectX（会二次收敛）。 */
  function edgeX(side, y) {
    const half = (W / 2) * kAt(y);
    return toScreenX(side < 0 ? W / 2 - half : W / 2 + half);
  }

  /** 一条沿深度方向收敛的梯形（底板 / 板体 / 角沟都用它） */
  function quad(x0a, x1a, ya, x0b, x1b, yb) {
    return [
      [projectX(x0a, ya), projectY(ya, 0)], [projectX(x1a, ya), projectY(ya, 0)],
      [projectX(x1b, yb), projectY(yb, 0)], [projectX(x0b, yb), projectY(yb, 0)]
    ];
  }

  /* ---------------- V2：机台结构投影 ---------------- */

  /** 台面深度（0 远 / 1 近），给机台分层与雾化用 */
  function projectDepth(y) { return depth(y); }

  /** 离台高度 → 屏幕抬升量（负数 = 往上） */
  function projectHeight(z) { return -(z || 0) * LIFT * VP.s; }

  /** 立在某个深度上的一块竖直面板（立柱正立面 / 前沿 / 立面）
   *  返回 [左上, 右上, 右下, 左下]（屏幕坐标） */
  function projectPanel(x0, x1, y, z0, z1) {
    const h0 = z0 || 0, h1 = z1 == null ? h0 : z1;
    return [
      [projectX(x0, y), projectY(y, h1)],
      [projectX(x1, y), projectY(y, h1)],
      [projectX(x1, y), projectY(y, h0)],
      [projectX(x0, y), projectY(y, h0)]
    ];
  }

  /** 沿深度方向延伸的侧墙（内舱左右壁）：y0 → y1，高度 z0 → z1 */
  function projectWall(x, y0, y1, z0, z1) {
    const h0 = z0 || 0, h1 = z1 == null ? h0 : z1;
    return [
      [projectX(x, y0), projectY(y0, h1)],
      [projectX(x, y1), projectY(y1, h1)],
      [projectX(x, y1), projectY(y1, h0)],
      [projectX(x, y0), projectY(y0, h0)]
    ];
  }

  /** 伪 3D 盒体：中心 (x,y)，宽 w / 深 d / 高 h。
   *  返回 { top, front, left, right } 四个面，顺序即绘制顺序。 */
  function projectBox(x, y, w, d, h) {
    const x0 = x - w / 2, x1 = x + w / 2;
    const y0 = y - d / 2, y1 = y + d / 2;
    const hh = h || 0;
    return {
      top: [
        [projectX(x0, y0), projectY(y0, hh)], [projectX(x1, y0), projectY(y0, hh)],
        [projectX(x1, y1), projectY(y1, hh)], [projectX(x0, y1), projectY(y1, hh)]
      ],
      front: [
        [projectX(x0, y1), projectY(y1, hh)], [projectX(x1, y1), projectY(y1, hh)],
        [projectX(x1, y1), projectY(y1, 0)], [projectX(x0, y1), projectY(y1, 0)]
      ],
      left: [
        [projectX(x0, y0), projectY(y0, hh)], [projectX(x0, y1), projectY(y1, hh)],
        [projectX(x0, y1), projectY(y1, 0)], [projectX(x0, y0), projectY(y0, 0)]
      ],
      right: [
        [projectX(x1, y0), projectY(y0, hh)], [projectX(x1, y1), projectY(y1, hh)],
        [projectX(x1, y1), projectY(y1, 0)], [projectX(x1, y0), projectY(y0, 0)]
      ]
    };
  }

  /** 金币绕竖直轴的伪 3D 翻转。
   *  flip = 顶面水平半轴系数（1 正面朝上 / 0.14 侧面朝前）
   *  edge = 侧面可见度（0 看不到厚度 / 1 完全侧立）
   *  face = 看到的是正面还是反面（决定厚度带出现在左边还是右边） */
  function coinFlip(rot) {
    const a = fin(rot, 0);
    const c = Math.cos(a), s = Math.sin(a);
    return { flip: Math.max(0.14, Math.abs(c)), edge: Math.abs(s), face: c >= 0 ? 1 : -1 };
  }

  /** 屏幕 x 反解回台面 x（输入映射用：同一屏幕点在不同深度对应不同台面 x） */
  function unprojectX(sx, y) {
    const px = (fin(sx, W / 2) - VP.cx) / VP.s + W / 2;
    const k = kAt(y);
    return W / 2 + (px - W / 2) / (k > 1e-6 ? k : 1e-6);
  }

  return {
    W: W, H: H,
    FAR: FAR, NEAR: NEAR, LIFT: LIFT, ZOOM: ZOOM, Z_REF: Z_REF, THICK: THICK,
    clamp: clamp, lerp: lerp,
    depth: depth, kAt: kAt, scaleAt: scaleAt,
    projectX: projectX, projectY: projectY,
    shadow: shadow, edgeX: edgeX, quad: quad,

    /* V2 */
    setViewport: setViewport, resetViewport: resetViewport,
    getViewport: getViewport, viewScale: viewScale,
    toScreenX: toScreenX, toScreenY: toScreenY,
    projectDepth: projectDepth, projectHeight: projectHeight,
    projectPanel: projectPanel, projectWall: projectWall, projectBox: projectBox,
    coinFlip: coinFlip, unprojectX: unprojectX
  };
});
