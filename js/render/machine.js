/* ============================================================
 * 机台外壳渲染（Layer 0~3 / Layer 7~9）
 *
 * 把"一块画布"升级成"一台摆在面前的推币机"：
 *   顶部灯箱 → 左右立柱 → 内舱（后墙/左右内壁）→ 台面 → 前沿挡板 → 出币口 → 前立面
 *
 * 实现要点：
 *   - 静态结构全部烘焙成两张离屏画布（back / front），主循环每帧只 drawImage 两次。
 *   - 硬币夹在 back 与 front 之间绘制 → 前排币被前沿挡住、立柱明显遮挡台面两侧，
 *     "币在机器里面"这件事是靠**遮挡关系**成立的，不是靠画个框。
 *   - 所有几何都走 CPProject，视口（setViewport）一改，整机跟着一起缩放。
 * ============================================================ */
(function (root) {
  "use strict";

  const P = root.CPProject, U = root.CPRUtil;
  const W = P.W, H = P.H;

  /* 机台布局：把 480×580 的台面装进"内舱"，四周留给灯箱 / 立柱 / 前沿 / 立面。
   * 这组数字决定了整机比例，改这里就等于换一台不同型号的机器。 */
  const S = 0.76, CX = 240, CY = 268;
  const VP = { cx: CX, cy: CY, s: S };
  const LB_H = 40;      // 灯箱高
  const WALL_Z = 78;    // 内舱壁高（台面坐标系的 z）
  const SLOT_W = 168, SLOT_H = 52, SLOT_DY = 22;   // 出币口

  let back = null, front = null, bakeKey = "";

  function newCv(dpr) {
    const c = document.createElement("canvas");
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    const g = c.getContext("2d");
    g.scale(dpr, dpr);
    return { c: c, g: g };
  }

  /** 当前机台在屏幕上的关键坐标（都随视口变） */
  function geo() {
    return {
      x0: P.toScreenX(0), x1: P.toScreenX(W),
      y0: P.toScreenY(0), y1: P.toScreenY(H)
    };
  }
  /** 出币口的屏幕矩形：出币飞行动画从这里起飞 */
  function slotRect(world) {
    const yTop = P.toScreenY(world.payoutY);
    return { x: W / 2 - SLOT_W / 2, y: yTop + SLOT_DY, w: SLOT_W, h: SLOT_H };
  }
  /** 投币口（导轨入口）的屏幕坐标：投币下降动画从这里开始 */
  function chuteMouth() {
    const g = geo();
    return { x: W / 2, y: (LB_H + g.y0) / 2 + 4 };
  }

  /* ---------------- 顶部灯箱 ---------------- */
  function drawLightbox(g) {
    const pad = 14;
    // 顶面厚度（先画，作为"上面那一层"）
    U.quad(g, [[pad + 7, 11], [W - pad - 7, 11], [W - pad + 1, 3], [pad - 1, 3]]);
    g.fillStyle = U.vgrad(g, 3, 11, [[0, "#4a3f9c"], [1, "#2b2358"]]);
    g.fill();

    // 前面板
    U.roundRect(g, pad, 9, W - pad * 2, LB_H - 12, 9);
    g.fillStyle = U.vgrad(g, 9, LB_H - 3, [[0, "#3f3378"], [0.5, "#231b50"], [1, "#150f36"]]);
    g.fill();

    // 内发光：灯箱是"发光材质"，不是普通涂装
    U.roundRect(g, pad + 5, 13, W - pad * 2 - 10, LB_H - 22, 7);
    g.fillStyle = U.vgrad(g, 13, LB_H - 9, [
      [0, "rgba(255,204,77,.34)"],
      [0.5, "rgba(78,226,255,.12)"],
      [1, "rgba(255,204,77,.06)"]
    ]);
    g.fill();

    // 招牌
    g.textAlign = "center"; g.textBaseline = "middle";
    g.font = "900 17px system-ui, sans-serif";
    g.fillStyle = "rgba(255,120,60,.55)";
    g.fillText("★ COIN PUSHER ★", W / 2, LB_H / 2 + 3);
    g.fillStyle = "rgba(255,236,175,.98)";
    g.fillText("★ COIN PUSHER ★", W / 2, LB_H / 2 + 2);

    // 边缘高光 + 倒角
    g.strokeStyle = "rgba(170,190,255,.4)"; g.lineWidth = 1.2;
    U.roundRect(g, pad, 9, W - pad * 2, LB_H - 12, 9); g.stroke();
    g.strokeStyle = "rgba(255,255,255,.16)"; g.lineWidth = 1;
    U.roundRect(g, pad + 1.5, 10.5, W - pad * 2 - 3, LB_H - 15, 8); g.stroke();

    g.textAlign = "start"; g.textBaseline = "alphabetic";
  }

  /* ---------------- 内舱壁 ---------------- */
  function drawWalls(g, G) {
    const lift = WALL_Z * P.LIFT * S;

    // 后墙
    U.fillQuad(g, P.projectPanel(0, W, 0, 0, WALL_Z),
      U.vgrad(g, G.y0 - lift, G.y0, [[0, "#241d47"], [1, "#100d24"]]));
    // 后墙格栅
    g.save();
    U.quad(g, P.projectPanel(0, W, 0, 0, WALL_Z)); g.clip();
    g.strokeStyle = "rgba(120,150,255,.10)"; g.lineWidth = 1;
    for (let i = 1; i <= 4; i++) {
      const y = G.y0 - lift * (i / 5);
      g.beginPath(); g.moveTo(G.x0, y); g.lineTo(G.x1, y); g.stroke();
    }
    g.restore();

    // 左右内壁
    for (const side of [0, 1]) {
      const x = side ? W : 0;
      const pts = P.projectWall(x, 0, H, 0, WALL_Z);
      const a = side ? "#1d1840" : "#2b2358";
      const b = side ? "#0c0a1c" : "#141130";
      U.fillQuad(g, pts, U.hgrad(g, side ? G.x1 : G.x0, side ? G.x1 + 40 : G.x0 - 40, [[0, a], [1, b]]));
      // 内壁上沿高光
      g.strokeStyle = "rgba(120,150,255,.22)"; g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]); g.lineTo(pts[1][0], pts[1][1]);
      g.stroke();
    }
  }

  /* ---------------- 台面 ---------------- */
  function drawTable(g, w, G) {
    const tbl = P.quad(0, W, 0, 0, W, H);
    U.fillQuad(g, tbl, U.vgrad(g, G.y0, G.y1, [
      [0, "#0b0919"], [0.35, "#131030"], [1, "#1c1742"]
    ]));

    // 网格：横向直线 + 沿深度收敛的纵向线（跟着透视走，不画成竖直）
    g.save();
    U.quad(g, tbl); g.clip();
    g.strokeStyle = "rgba(120,150,255,.07)"; g.lineWidth = 1;
    for (let y = 0; y < w.payoutY; y += 34) {
      g.beginPath();
      g.moveTo(P.projectX(0, y), P.projectY(y, 0));
      g.lineTo(P.projectX(W, y), P.projectY(y, 0));
      g.stroke();
    }
    for (let x = 0; x <= W; x += 40) {
      g.beginPath();
      g.moveTo(P.projectX(x, 0), P.projectY(0, 0));
      g.lineTo(P.projectX(x, H), P.projectY(H, 0));
      g.stroke();
    }
    // 台面靠近前沿的一圈反光，强化"向机器内部延伸"的深度
    g.strokeStyle = "rgba(78,226,255,.10)"; g.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      const y = w.payoutY - i * 30;
      if (y < 0) break;
      g.beginPath();
      g.moveTo(P.projectX(0, y), P.projectY(y, 0));
      g.lineTo(P.projectX(W, y), P.projectY(y, 0));
      g.stroke();
    }
    g.restore();

    // 角沟（丢币口）
    const gy = w.payoutY - 52, gw = w.gutterWidth;
    for (const side of [0, 1]) {
      const a = side ? W - gw : 0, b = side ? W : gw;
      U.fillQuad(g, P.quad(a, b, gy, a, b, w.payoutY), "#030209");
      U.strokeQuad(g, P.quad(a, b, gy, a, b, w.payoutY), "rgba(255,107,107,.5)", 1.2);
    }
    // 危险斜纹
    g.save();
    U.quad(g, [[P.projectX(0, gy), P.projectY(gy, 0)], [P.projectX(W, gy), P.projectY(gy, 0)],
      [P.projectX(W, w.payoutY), P.projectY(w.payoutY, 0)], [P.projectX(0, w.payoutY), P.projectY(w.payoutY, 0)]]);
    g.clip();
    g.strokeStyle = "rgba(255,107,107,.22)"; g.lineWidth = 5;
    for (let i = -H; i < W + H; i += 14) {
      g.beginPath();
      g.moveTo(P.projectX(i, w.payoutY), P.projectY(w.payoutY, 0));
      g.lineTo(P.projectX(i + 46, gy), P.projectY(gy, 0));
      g.stroke();
    }
    g.restore();

    // 出币区（前沿之后）：被 front 层的前沿挡板压住大半，只留一点底光
    U.fillQuad(g, P.quad(0, W, w.payoutY, 0, W, H), U.vgrad(g, G.y1 - 60, G.y1, [
      [0, "rgba(78,226,255,.10)"], [1, "rgba(78,226,255,.02)"]
    ]));
  }

  /* ---------------- 前层：玻璃 / 立柱 / 前沿 / 立面 ---------------- */
  function drawGlass(g, G) {
    // 只做一道很轻的斜向高光。大面积白玻璃会把硬币和稀有奖励洗掉。
    g.save();
    U.quad(g, [[G.x0, LB_H], [G.x1, LB_H], [G.x1, G.y1], [G.x0, G.y1]]);
    g.clip();
    const gl = g.createLinearGradient(G.x0, LB_H, G.x1, G.y1);
    gl.addColorStop(0, "rgba(255,255,255,0)");
    gl.addColorStop(0.34, "rgba(255,255,255,.055)");
    gl.addColorStop(0.40, "rgba(255,255,255,.10)");
    gl.addColorStop(0.46, "rgba(255,255,255,.02)");
    gl.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gl;
    g.fillRect(G.x0, LB_H, G.x1 - G.x0, G.y1 - LB_H);
    g.restore();
  }

  function drawColumn(g, side, ex, G) {
    const top = LB_H - 6, bot = H - 3;
    const outer = side ? W - 3 : 3;
    const x0 = Math.min(outer, ex), x1 = Math.max(outer, ex);
    const w = x1 - x0;

    // 正立面
    U.roundRect(g, x0, top, w, bot - top, 9);
    g.fillStyle = U.hgrad(g, x0, x1, side
      ? [[0, "#352c6e"], [0.55, "#241d4d"], [1, "#141130"]]
      : [[0, "#141130"], [0.45, "#241d4d"], [1, "#352c6e"]]);
    g.fill();

    // 侧面厚度（外侧一条更暗的带）
    const tw = Math.max(5, w * 0.22);
    U.quad(g, side
      ? [[x1 - tw, top], [x1, top], [x1, bot], [x1 - tw, bot]]
      : [[x0, top], [x0 + tw, top], [x0 + tw, bot], [x0, bot]]);
    g.fillStyle = "#0d0a1e"; g.fill();

    // 内沿高光（立柱与内舱的分界，也是"遮挡"最直观的线索）
    g.strokeStyle = "rgba(170,190,255,.42)"; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(ex, top + 7); g.lineTo(ex, bot - 7); g.stroke();
    // 内沿阴影：让硬币明显"沉"在立柱之间
    g.strokeStyle = "rgba(0,0,0,.5)"; g.lineWidth = 4;
    g.beginPath();
    g.moveTo(ex + (side ? 3 : -3), top + 7); g.lineTo(ex + (side ? 3 : -3), bot - 7);
    g.stroke();

    // 立柱上的小装饰灯带
    const bx = side ? x1 - w * 0.62 : x0 + w * 0.62;
    g.fillStyle = "rgba(78,226,255,.30)";
    U.roundRect(g, bx - 2, top + 18, 4, (bot - top) * 0.5, 2); g.fill();

    g.strokeStyle = "rgba(255,255,255,.10)"; g.lineWidth = 1;
    U.roundRect(g, x0 + 1, top + 1, w - 2, bot - top - 2, 8); g.stroke();
    void G;
  }

  function drawLip(g, w, G) {
    const yTop = P.toScreenY(w.payoutY), yBot = G.y1;
    const x0 = G.x0 - 10, x1 = G.x1 + 10;

    // 前沿挡板主体（金属）
    U.quad(g, [[x0, yTop], [x1, yTop], [x1, yBot], [x0, yBot]]);
    g.fillStyle = U.vgrad(g, yTop, yBot, [
      [0, "#5b4bb8"], [0.14, "#332a63"], [0.55, "#211a45"], [1, "#140f30"]
    ]);
    g.fill();
    // 顶沿高光：硬币从这后面被挡住
    g.fillStyle = "rgba(190,245,255,.9)";
    g.fillRect(x0, yTop - 1, x1 - x0, 2.5);
    g.fillStyle = "rgba(120,90,220,.55)";
    g.fillRect(x0, yTop + 1.5, x1 - x0, 3);

    // 出币口
    const s = slotRect(w);
    U.roundRect(g, s.x - 7, s.y - 7, s.w + 14, s.h + 14, 11);
    g.fillStyle = "#0a0820"; g.fill();
    U.roundRect(g, s.x, s.y, s.w, s.h, 7);
    g.fillStyle = U.vgrad(g, s.y, s.y + s.h, [[0, "#010004"], [0.6, "#050410"], [1, "#0c0a1e"]]);
    g.fill();
    // 内凹：上沿阴影 + 下沿高光
    g.strokeStyle = "rgba(0,0,0,.85)"; g.lineWidth = 3;
    g.beginPath(); g.moveTo(s.x + 6, s.y + 2); g.lineTo(s.x + s.w - 6, s.y + 2); g.stroke();
    g.strokeStyle = "rgba(78,226,255,.6)"; g.lineWidth = 2;
    g.beginPath(); g.moveTo(s.x + 6, s.y + s.h - 1.5); g.lineTo(s.x + s.w - 6, s.y + s.h - 1.5); g.stroke();
    // 外框高光
    g.strokeStyle = "rgba(170,190,255,.38)"; g.lineWidth = 1.2;
    U.roundRect(g, s.x - 7, s.y - 7, s.w + 14, s.h + 14, 11); g.stroke();

    // 出币口里的向下箭头 + 标签
    g.save();
    g.globalAlpha = 0.55;
    g.strokeStyle = "#4ee2ff"; g.lineWidth = 2.4; g.lineCap = "round";
    const ax = s.x + s.w / 2, ay = s.y + s.h * 0.42;
    g.beginPath(); g.moveTo(ax, ay - 9); g.lineTo(ax, ay + 9); g.stroke();
    g.beginPath(); g.moveTo(ax - 7, ay + 2); g.lineTo(ax, ay + 10); g.lineTo(ax + 7, ay + 2); g.stroke();
    g.restore();
    g.textAlign = "center"; g.textBaseline = "middle";
    g.font = "800 10px system-ui, sans-serif";
    g.fillStyle = "rgba(78,226,255,.6)";
    g.fillText("OUT", ax, s.y + s.h - 9);
    g.textAlign = "start"; g.textBaseline = "alphabetic";
  }

  function drawFascia(g, G) {
    const y0 = G.y1, y1 = H;
    U.quad(g, [[G.x0 - 10, y0], [G.x1 + 10, y0], [G.x1 + 10, y1], [G.x0 - 10, y1]]);
    g.fillStyle = U.vgrad(g, y0, y1, [[0, "#1a1440"], [0.5, "#120e2c"], [1, "#0a0818"]]);
    g.fill();

    // 取币托盘
    const tw = 220, tx = W / 2 - tw / 2, ty = y0 + 14;
    U.roundRect(g, tx, ty, tw, 26, 8);
    g.fillStyle = U.vgrad(g, ty, ty + 26, [[0, "#020106"], [1, "#0a0818"]]);
    g.fill();
    g.strokeStyle = "rgba(78,226,255,.22)"; g.lineWidth = 1.2;
    U.roundRect(g, tx, ty, tw, 26, 8); g.stroke();
    g.textAlign = "center"; g.textBaseline = "middle";
    g.font = "800 10px system-ui, sans-serif";
    g.fillStyle = "rgba(160,180,255,.45)";
    g.fillText("PAYOUT TRAY", W / 2, ty + 13);
    g.textAlign = "start"; g.textBaseline = "alphabetic";

    // 底部散热格栅
    g.fillStyle = "rgba(0,0,0,.35)";
    for (let i = 0; i < 5; i++) g.fillRect(W / 2 - 46 + i * 20, y0 + 50, 12, 3);
  }

  /* ---------------- 烘焙 ---------------- */
  function bake(game, dpr) {
    P.setViewport(VP);
    const w = game.world;
    const key = dpr + "|" + w.gutterWidth.toFixed(2) + "|" + w.payoutY + "|" + S;
    if (key === bakeKey && back && front) return;
    bakeKey = key;

    const G = geo();
    const B = newCv(dpr), F = newCv(dpr);
    const bg = B.g, fg = F.g;

    // ---- back：背景 / 外壳 / 灯箱 / 内壁 / 台面 ----
    bg.fillStyle = "#04030a"; bg.fillRect(0, 0, W, H);
    U.roundRect(bg, 2, 2, W - 4, H - 4, 16);
    bg.fillStyle = U.vgrad(bg, 0, H, [[0, "#161232"], [0.42, "#0d0b20"], [1, "#070614"]]);
    bg.fill();
    bg.strokeStyle = "rgba(120,150,255,.16)"; bg.lineWidth = 1.4;
    U.roundRect(bg, 2, 2, W - 4, H - 4, 16); bg.stroke();

    drawLightbox(bg);
    // 内舱暗腔
    U.quad(bg, [[G.x0, LB_H], [G.x1, LB_H], [G.x1, G.y1], [G.x0, G.y1]]);
    bg.fillStyle = U.vgrad(bg, LB_H, G.y1, [[0, "#0a0820"], [1, "#04030c"]]);
    bg.fill();
    drawWalls(bg, G);
    drawTable(bg, w, G);

    // ---- front：玻璃 / 立柱 / 前沿 / 立面 ----
    drawGlass(fg, G);
    drawColumn(fg, 0, G.x0, G);
    drawColumn(fg, 1, G.x1, G);
    drawLip(fg, w, G);
    drawFascia(fg, G);

    back = B.c; front = F.c;
  }

  function invalidate() { bakeKey = ""; }

  root.CPMachine = {
    VP: VP, W: W, H: H, LB_H: LB_H, WALL_Z: WALL_Z,
    S: S, CX: CX, CY: CY,
    geo: geo, slotRect: slotRect, chuteMouth: chuteMouth,
    bake: bake, invalidate: invalidate,
    drawBack: function (ctx) { if (back) ctx.drawImage(back, 0, 0, W, H); },
    drawFront: function (ctx) { if (front) ctx.drawImage(front, 0, 0, W, H); },
    ready: function () { return !!(back && front); }
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
