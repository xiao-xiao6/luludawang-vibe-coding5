/* ============================================================
 * 推板 2.5D 渲染（Phase 5）
 *
 * 推板不再是一个矩形：
 *   top face（板面，带斜纹）+ front face（正立面）+ 两侧厚度
 *   + 顶沿高光 + 板下阴影
 *
 * 并且把物理里的压力真正接到画面上：
 *   world.stats.stress / 每枚币的 c.stress → 币堆被压实、局部隆起、前排被挤出。
 * 推板本身也吃一点压力：前进时正立面更高更亮，像真的在顶东西。
 * ============================================================ */
(function (root) {
  "use strict";

  const P = root.CPProject, U = root.CPRUtil;
  const W = P.W, H = P.H;

  const PUSH_H = 30;        // 推板正立面高度（台面坐标 z）
  const PUSH_SIDE = 7;      // 两侧厚度

  let grad = null, hatch = null, bakeKey = "";

  function bake() {
    const key = P.viewScale().toFixed(4) + "|" + P.getViewport().cy.toFixed(2);
    if (key === bakeKey && grad) return;
    bakeKey = key;

    const g0 = document.createElement("canvas").getContext("2d");
    grad = g0.createLinearGradient(0, 0, 0, 240);
    grad.addColorStop(0, "#241d47");
    grad.addColorStop(0.55, "#3b3270");
    grad.addColorStop(1, "#4a3f9c");

    const pc = document.createElement("canvas");
    pc.width = 40; pc.height = 40;
    const pg = pc.getContext("2d");
    pg.strokeStyle = "rgba(255,204,77,.16)";
    pg.lineWidth = 7;
    for (let i = -40; i < 80; i += 18) {
      pg.beginPath(); pg.moveTo(i, 40); pg.lineTo(i + 40, -6); pg.stroke();
    }
    hatch = pg.canvas;
  }

  function draw(ctx, world, nowT) {
    bake();
    const face = world.plate.y;
    const pv = world.plate.vy;
    // 压力：全局挤压峰值 + 推板自身速度
    const press = U.clamp(world.stats.stress / 6, 0, 1);
    const rush = U.clamp(Math.abs(pv) / 260, 0, 1);
    const drive = pv > 0 ? rush : 0;
    const hFace = PUSH_H * (0.9 + 0.22 * press + 0.16 * drive);

    // --- 板下阴影 ---
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = "#000";
    U.fillQuad(ctx, P.quad(0, W, Math.max(0, face - 8), 0, W, face + 14));
    ctx.restore();

    // --- 板面（top face）---
    ctx.save();
    U.quad(ctx, P.quad(0, W, 0, 0, W, face));
    ctx.fillStyle = grad;
    ctx.fill();
    const pat = ctx.createPattern(hatch, "repeat");
    ctx.fillStyle = pat;
    ctx.fill();
    ctx.restore();

    // --- 正立面（front face）---
    const fp = P.projectPanel(0, W, face, 0, hFace);
    U.fillQuad(ctx, fp, U.vgrad(ctx, P.projectY(face, hFace), P.projectY(face, 0), [
      [0, "#4a3f9c"], [0.45, "#2f2760"], [1, "#1b1638"]
    ]));
    // 正立面上的斜纹，让它有"金属板"的材质而不是一块纯色
    ctx.save();
    U.quad(ctx, fp); ctx.clip();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = "rgba(255,204,77,.10)";
    ctx.lineWidth = 5;
    for (let i = -80; i < W + 80; i += 26) {
      ctx.beginPath();
      ctx.moveTo(i, P.projectY(face, hFace));
      ctx.lineTo(i + 60, P.projectY(face, 0));
      ctx.stroke();
    }
    ctx.restore();

    // --- 顶沿高光：推板与币堆的接触线 ---
    const hy = P.projectY(face, hFace);
    const gx0 = P.projectX(0, face), gx1 = P.projectX(W, face);
    ctx.save();
    ctx.fillStyle = "rgba(160,245,255,.9)";
    ctx.fillRect(gx0, hy - 1.5, gx1 - gx0, 2.4);
    ctx.fillStyle = "rgba(91,75,196,.55)";
    ctx.fillRect(gx0, hy + 1, gx1 - gx0, 3);
    // 受压时顶沿泛红：一眼看出"推板在顶东西"
    if (press > 0.05) {
      ctx.globalAlpha = press * 0.5;
      ctx.fillStyle = "rgba(255,140,90,.9)";
      ctx.fillRect(gx0, hy - 1.5, gx1 - gx0, 2.4);
    }
    ctx.restore();

    // --- 两侧厚度 ---
    const y0 = P.projectY(face, hFace), y1 = P.projectY(face, 0);
    ctx.fillStyle = "#0d0a1e";
    ctx.fillRect(gx0 - PUSH_SIDE, y0, PUSH_SIDE, y1 - y0);
    ctx.fillRect(gx1, y0, PUSH_SIDE, y1 - y0);

    // --- 板面标签 ---
    ctx.save();
    ctx.fillStyle = "rgba(200,190,255,.30)";
    ctx.font = "700 12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("P U S H E R", P.projectX(W / 2, face * 0.5), Math.max(16, P.projectY(face * 0.5, 0) - 14));
    ctx.restore();
    void H; void nowT;
  }

  function invalidate() { bakeKey = ""; }

  root.CPPusher = { draw: draw, invalidate: invalidate, PUSH_H: PUSH_H };
})(typeof globalThis !== "undefined" ? globalThis : this);
