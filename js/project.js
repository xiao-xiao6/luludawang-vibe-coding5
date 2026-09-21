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

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  /** y 归一化到 [0,1] 的"深度"（0 = 最远，1 = 最近） */
  function depth(y) { return clamp(y / H, 0, 1); }

  /** 该深度处的横向比例 */
  function kAt(y) { return lerp(FAR, NEAR, depth(y)); }

  /** 该深度 + 离台高度处的整体缩放（币的绘制尺寸） */
  function scaleAt(y, z) { return kAt(y) * (1 + (z || 0) * ZOOM); }

  /** 台面 x → 屏幕 x */
  function projectX(x, y) { return W / 2 + (x - W / 2) * kAt(y); }

  /** 台面 y + 离台高度 → 屏幕 y（越高越往上抬） */
  function projectY(y, z) { return y - (z || 0) * LIFT; }

  /** 币的落地影子：位置、椭圆半径、透明度（越高越淡越小）
   * 影子是 2.5D 的**主要深度线索**：没有它，币看起来就是贴在平面上的贴纸。
   * 所以给得比“物理正确”更重一点（偏下方 + 更暗），让“币浮在台面上”成立。 */
  function shadow(x, y, z, r) {
    const k = kAt(y);
    const t = clamp((z || 0) / Z_REF, 0, 1);
    const shrink = 1 - 0.34 * t;
    return {
      x: projectX(x, y),
      y: y + r * 0.62 * k,
      rx: Math.max(0.5, r * k * shrink),
      ry: Math.max(0.3, r * k * 0.5 * shrink),
      alpha: 0.62 * (1 - 0.55 * t)
    };
  }

  /** 台面在该深度处的左右边缘屏幕坐标（烘焙护栏 / 底板的梯形用） */
  function edgeX(side, y) {
    const half = (W / 2) * kAt(y);
    return side < 0 ? W / 2 - half : W / 2 + half;
  }

  /** 一条沿深度方向收敛的梯形（底板 / 板体 / 角沟都用它） */
  function quad(x0a, x1a, ya, x0b, x1b, yb) {
    return [
      [projectX(x0a, ya), ya], [projectX(x1a, ya), ya],
      [projectX(x1b, yb), yb], [projectX(x0b, yb), yb]
    ];
  }

  return {
    W: W, H: H,
    FAR: FAR, NEAR: NEAR, LIFT: LIFT, ZOOM: ZOOM, Z_REF: Z_REF,
    clamp: clamp, lerp: lerp,
    depth: depth, kAt: kAt, scaleAt: scaleAt,
    projectX: projectX, projectY: projectY,
    shadow: shadow, edgeX: edgeX, quad: quad
  };
});
