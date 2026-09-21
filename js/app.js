/* ============================================================
 * 表现层：2.5D 渲染 / 输入 / 面板 / 存档节奏
 *
 * 视角：物理内核是干净的俯视 2D，CPProject 只回答「画在哪」。
 * 所以投影怎么调都不会污染经济平衡测试的数字。
 * ============================================================ */
(function () {
  "use strict";

  const D = window.CPData, E = window.CPEngine, Fx = window.CPFx, Sfx = window.CPSfx;
  const L = window.CPLayout, P = window.CPProject;

  const cv = document.getElementById("cv");
  const ctx = cv.getContext("2d");
  const W = 480, H = 580;

  let game = null;
  let hoverX = W / 2;
  let hasHover = false;
  let lastT = 0;
  let acc = 0;
  let saveAcc = 0;
  let nowT = 0;
  const FIXED = 1 / 120;

  let dpr = 1;
  let spriteDpr = Math.min(2, window.devicePixelRatio || 1);
  let mode = "wide";

  const isHero = (kind) => {
    const d = D.COIN_DEFS[kind];
    return !!(d && d.hero);
  };
  /** 稀有奖励在屏幕上额外放大一点：物理半径不变（平衡不受影响），
   * 但视觉上必须比铜币“大一圈”，否则满台币里根本认不出来。 */
  const HERO_ART_BOOST = { gem: 1.35, chest: 1.22, tower: 1.26 };
  function artBoost(kind) {
    const d = D.COIN_DEFS[kind];
    if (!d || !d.hero) return 1;
    return HERO_ART_BOOST[d.art] || 1.12;
  }

  /* ---------------- 几何小工具（2.5D 梯形） ---------------- */
  function quadPath(g, pts) {
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
  }
  /** 台面坐标的一段矩形 → 屏幕上的梯形（近大远小） */
  function band(x0, x1, ya, yb) {
    return [
      [P.projectX(x0, ya), ya], [P.projectX(x1, ya), ya],
      [P.projectX(x1, yb), yb], [P.projectX(x0, yb), yb]
    ];
  }
  /** 沿深度方向的收剑直线：在透视下必须从 (x,ya) 连到 (x,yb)，
   * 不能画成同一条竖线 —— 否则护栏、网格、斜纹会“不跟着透视走”。 */
  function depthLine(g, x, ya, yb) {
    g.beginPath();
    g.moveTo(P.projectX(x, ya), ya);
    g.lineTo(P.projectX(x, yb), yb);
    g.stroke();
  }
  /** 收剑斜纹：同一族斜线的两端各自按深度投影，看上去会随台面一起“退远” */
  function hatch(g, x0, x1, ya, yb, step, lean) {
    for (let i = x0 - (yb - ya); i < x1 + (yb - ya); i += step) {
      g.beginPath();
      g.moveTo(P.projectX(i, yb), yb);
      g.lineTo(P.projectX(i + lean, ya), ya);
      g.stroke();
    }
  }

  /* ---------------- 币精灵缓存 ----------------
   * 按 art 分派：disc 圆片 / gem 棱面钻石 / chest 伪3D 宝箱 / tower 伪3D 金币塔。
   * 稀有奖励走「立起来」的画法，不再和普通币一样只是转圈。 */
  const sprites = {};
  const halos = {};

  function buildDisc(def) {
    const pad = 4, r = def.r, size = Math.ceil((r + pad) * 2);
    const c = document.createElement("canvas");
    c.width = c.height = Math.ceil(size * spriteDpr);
    const g = c.getContext("2d");
    g.scale(spriteDpr, spriteDpr);
    const cx = size / 2, cy = size / 2;
    g.save(); g.translate(cx, cy);

    g.globalAlpha = 0.35; g.fillStyle = "#000";
    g.beginPath(); g.ellipse(1.5, 2.5, r, r * 0.92, 0, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1;

    const grd = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.15, 0, 0, r * 1.05);
    grd.addColorStop(0, def.color2);
    grd.addColorStop(0.55, def.color);
    grd.addColorStop(1, def.ring);
    g.fillStyle = grd;
    g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();

    g.lineWidth = 1.6; g.strokeStyle = def.ring;
    g.beginPath(); g.arc(0, 0, r - 0.8, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 1; g.strokeStyle = "rgba(255,255,255,.32)";
    g.beginPath(); g.arc(0, 0, r * 0.68, 0, Math.PI * 2); g.stroke();

    g.fillStyle = "rgba(0,0,0,.5)";
    g.font = "900 " + Math.round(r * 1.02) + "px system-ui, sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(def.glyph, 0, 1);
    g.fillStyle = def.color2;
    g.fillText(def.glyph, 0, 0);

    const hl = g.createLinearGradient(-r, -r, r * 0.3, r * 0.2);
    hl.addColorStop(0, "rgba(255,255,255,.75)");
    hl.addColorStop(0.45, "rgba(255,255,255,.06)");
    hl.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = hl;
    g.beginPath(); g.arc(0, 0, r - 1, 0, Math.PI * 2); g.fill();

    g.restore();
    return { canvas: c, size: size };
  }

  /** 棱面钻石：上冠 + 下亭，靠面与面的明度差立起来 */
  function buildGem(def) {
    const r = def.r * 1.5, size = Math.ceil(r * 2 + 10);
    const c = document.createElement("canvas");
    c.width = c.height = Math.ceil(size * spriteDpr);
    const g = c.getContext("2d");
    g.scale(spriteDpr, spriteDpr);
    g.translate(size / 2, size / 2 + 1);

    const tw = r * 0.5;    // 桌面半径
    const hw = r * 0.95;   // 腰围半径
    const top = -r * 0.72, waist = -r * 0.08, tip = r * 0.95;

    // 亭部（下半）
    g.fillStyle = def.ring;
    g.beginPath();
    g.moveTo(-hw, waist); g.lineTo(hw, waist); g.lineTo(0, tip); g.closePath();
    g.fill();
    // 亭部左半稍亮 → 单侧受光
    g.fillStyle = def.color;
    g.beginPath();
    g.moveTo(-hw, waist); g.lineTo(0, waist); g.lineTo(0, tip); g.closePath();
    g.fill();

    // 冠部（上半）
    const grd = g.createLinearGradient(-hw, top, hw, waist);
    grd.addColorStop(0, def.color2);
    grd.addColorStop(0.5, def.color);
    grd.addColorStop(1, def.ring);
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(-tw, top); g.lineTo(tw, top);
    g.lineTo(hw, waist); g.lineTo(-hw, waist); g.closePath();
    g.fill();

    // 刻面线
    g.strokeStyle = "rgba(255,255,255,.42)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(-tw, top); g.lineTo(-hw * 0.45, waist);
    g.moveTo(tw, top); g.lineTo(hw * 0.45, waist);
    g.moveTo(0, top); g.lineTo(0, waist);
    g.moveTo(-tw, top); g.lineTo(0, top); g.lineTo(tw, top);
    g.moveTo(-hw, waist); g.lineTo(hw, waist);
    g.stroke();
    g.strokeStyle = "rgba(255,255,255,.2)";
    g.beginPath();
    g.moveTo(-hw * 0.45, waist); g.lineTo(0, tip);
    g.moveTo(hw * 0.45, waist); g.lineTo(0, tip);
    g.stroke();

    // 高光
    g.fillStyle = "rgba(255,255,255,.72)";
    g.beginPath();
    g.moveTo(-tw * 0.75, top + r * 0.1); g.lineTo(-tw * 0.1, top + r * 0.06);
    g.lineTo(-hw * 0.5, waist - r * 0.06); g.lineTo(-hw * 0.72, waist - r * 0.2);
    g.closePath(); g.fill();

    g.restore();
    return { canvas: c, size: size, art: "gem" };
  }

  /** 伪3D 宝箱：正面 + 顶面 + 箱盖，带锁扣 */
  function buildChest(def) {
    const r = def.r * 1.25, size = Math.ceil(r * 2.6 + 12);
    const c = document.createElement("canvas");
    c.width = c.height = Math.ceil(size * spriteDpr);
    const g = c.getContext("2d");
    g.scale(spriteDpr, spriteDpr);
    g.translate(size / 2, size / 2 + 2);

    const hw = r * 1.02;            // 正面半宽
    const bodyTop = -r * 0.18, bodyBot = r * 0.95;
    const d = r * 0.42;             // 伪3D 纵深

    // 地面投影
    g.globalAlpha = 0.4; g.fillStyle = "#000";
    g.beginPath(); g.ellipse(0, bodyBot + r * 0.12, hw * 1.02, r * 0.3, 0, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1;

    // 侧面（右侧厚度）
    g.fillStyle = def.ring;
    g.beginPath();
    g.moveTo(hw, bodyTop); g.lineTo(hw + d, bodyTop - d * 0.5);
    g.lineTo(hw + d, bodyBot - d * 0.5); g.lineTo(hw, bodyBot); g.closePath();
    g.fill();

    // 顶面（箱盖顶）
    g.fillStyle = def.color;
    g.beginPath();
    g.moveTo(-hw, bodyTop); g.lineTo(hw, bodyTop);
    g.lineTo(hw + d, bodyTop - d * 0.5); g.lineTo(-hw + d, bodyTop - d * 0.5);
    g.closePath();
    g.fill();
    g.strokeStyle = "rgba(255,255,255,.3)"; g.lineWidth = 1;
    g.stroke();

    // 正面（箱体）
    const grd = g.createLinearGradient(0, bodyTop, 0, bodyBot);
    grd.addColorStop(0, def.color);
    grd.addColorStop(0.62, def.ring);
    grd.addColorStop(1, "#2b0f3d");
    g.fillStyle = grd;
    g.beginPath(); g.rect(-hw, bodyTop, hw * 2, bodyBot - bodyTop); g.fill();

    // 箱盖分界线 + 铁箍
    g.fillStyle = "rgba(255,255,255,.22)";
    g.fillRect(-hw, bodyTop + (bodyBot - bodyTop) * 0.3, hw * 2, 2);
    g.fillStyle = "rgba(0,0,0,.3)";
    g.fillRect(-hw * 0.22, bodyTop, 3, bodyBot - bodyTop);
    g.fillRect(hw * 0.22 - 3, bodyTop, 3, bodyBot - bodyTop);

    // 锁扣
    g.fillStyle = "#ffd75e";
    g.beginPath();
    g.moveTo(-r * 0.22, bodyTop + (bodyBot - bodyTop) * 0.24);
    g.lineTo(r * 0.22, bodyTop + (bodyBot - bodyTop) * 0.24);
    g.lineTo(r * 0.22, bodyTop + (bodyBot - bodyTop) * 0.62);
    g.lineTo(-r * 0.22, bodyTop + (bodyBot - bodyTop) * 0.62);
    g.closePath(); g.fill();
    g.fillStyle = "#7a4a06";
    g.beginPath(); g.arc(0, bodyTop + (bodyBot - bodyTop) * 0.4, r * 0.1, 0, Math.PI * 2); g.fill();

    // 边缘高光
    g.strokeStyle = "rgba(255,255,255,.45)"; g.lineWidth = 1.4;
    g.beginPath(); g.rect(-hw, bodyTop, hw * 2, bodyBot - bodyTop); g.stroke();

    g.restore();
    return { canvas: c, size: size, art: "chest" };
  }

  /** 伪3D 金币塔：一摞逐渐收窄的金币，顶上一枚立起来 */
  function buildTower(def) {
    const r = def.r * 1.15, size = Math.ceil(r * 2.8 + 14);
    const c = document.createElement("canvas");
    c.width = c.height = Math.ceil(size * spriteDpr);
    const g = c.getContext("2d");
    g.scale(spriteDpr, spriteDpr);
    g.translate(size / 2, size / 2 + 3);

    const n = 5;                       // 摞 5 层
    const stepY = r * 0.32;
    const baseY = r * 0.78;

    g.globalAlpha = 0.42; g.fillStyle = "#000";
    g.beginPath(); g.ellipse(0, baseY + r * 0.22, r * 1.05, r * 0.32, 0, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1;

    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const rr = r * (1 - 0.1 * t);
      const y = baseY - i * stepY;
      // 币身厚度
      g.fillStyle = def.ring;
      g.beginPath();
      g.moveTo(-rr, y - r * 0.14); g.lineTo(rr, y - r * 0.14);
      g.lineTo(rr, y + r * 0.1); g.lineTo(-rr, y + r * 0.1);
      g.closePath(); g.fill();
      // 顶面
      const grd = g.createLinearGradient(-rr, y - r * 0.3, rr, y + r * 0.1);
      grd.addColorStop(0, def.color2);
      grd.addColorStop(0.55, def.color);
      grd.addColorStop(1, def.ring);
      g.fillStyle = grd;
      g.beginPath(); g.ellipse(0, y - r * 0.14, rr, r * 0.3, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = "rgba(255,255,255,.34)"; g.lineWidth = 1;
      g.beginPath(); g.ellipse(0, y - r * 0.14, rr * 0.72, r * 0.2, 0, 0, Math.PI * 2); g.stroke();
    }

    // 顶部立起来的那一枚（金币塔的"尖"）
    const topY = baseY - (n - 1) * stepY - r * 0.62;
    const grd2 = g.createRadialGradient(-r * 0.3, topY - r * 0.2, r * 0.1, 0, topY, r * 0.62);
    grd2.addColorStop(0, "#fff6d0");
    grd2.addColorStop(0.55, def.color);
    grd2.addColorStop(1, def.ring);
    g.fillStyle = grd2;
    g.beginPath(); g.arc(0, topY, r * 0.56, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "rgba(255,255,255,.5)"; g.lineWidth = 1.2;
    g.beginPath(); g.arc(0, topY, r * 0.56, 0, Math.PI * 2); g.stroke();

    g.restore();
    return { canvas: c, size: size, art: "tower" };
  }

  function buildSprite(def) {
    if (def.art === "gem") return buildGem(def);
    if (def.art === "chest") return buildChest(def);
    if (def.art === "tower") return buildTower(def);
    return buildDisc(def);
  }
  function sprite(kind) {
    if (!sprites[kind]) sprites[kind] = buildSprite(D.COIN_DEFS[kind]);
    return sprites[kind];
  }
  /** 稀有奖励的脉冲光晕：烘焙一次，主循环只 drawImage（不每帧建渐变） */
  function halo(color) {
    if (halos[color]) return halos[color];
    const size = 192;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
    const grd = g.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
    grd.addColorStop(0, color);
    grd.addColorStop(0.30, color.replace(/[\d.]+\)$/, "0.5)"));
    grd.addColorStop(0.62, color.replace(/[\d.]+\)$/, "0.14)"));
    grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, size, size);
    halos[color] = c;
    return c;
  }

  /** 稀有奖励的“地面光环”：一圈旋转虚线的椭圆环，让它在满台币里一眼可见 */
  function heroRing(color) {
    const key = "ring:" + color;
    if (halos[key]) return halos[key];
    const s = 160;
    const c = document.createElement("canvas");
    c.width = c.height = s;
    const g = c.getContext("2d");
    g.translate(s / 2, s / 2);
    g.scale(1, 0.52);                      // 压成椭圆：贴合倾斜台面
    g.strokeStyle = color;
    g.lineWidth = 4;
    g.setLineDash([13, 9]);
    g.beginPath(); g.arc(0, 0, 58, 0, Math.PI * 2); g.stroke();
    g.setLineDash([]);
    g.globalAlpha = 0.45;
    g.lineWidth = 1.5;
    g.beginPath(); g.arc(0, 0, 68, 0, Math.PI * 2); g.stroke();
    halos[key] = c;
    return c;
  }

  /* ============================================================
   * 渲染管线（2.5D）—— 显式的分层，遮挡关系是"机器实体感"的来源
   *   Layer 0~3   背景 / 外壳 / 内舱 / 台面     → CPMachine.drawBack
   *   Layer 4~6   币堆 / 币 / 推板              → CPPile / CPCoin / CPPusher
   *   Layer 7~9   前沿 / 出币口 / 前立面        → CPMachine.drawFront
   *   Layer 10    导轨币 / 出币飞行 / FX        → CPChute / CPPayout / CPFx
   * ============================================================ */
  const M = window.CPMachine, Coin = window.CPCoin, Pile = window.CPPile;
  const Pusher = window.CPPusher, Hero = window.CPHero;
  const Payout = window.CPPayout, Chute = window.CPChute, VRng = window.CPVRng;

  let machineShake = 0;      // 机台微震（推板驱动），与 Fx.shake（大事件）分开
  let pruneAcc = 0;

  /* 深度排序缓冲：复用数组，不每帧分配 */
  const orderBuf = [];

  /* ---------------- 金币 / 币堆 ---------------- */
  function drawCoins() {
    const world = game.world;
    const coins = world.coins;
    const drawShadows = Fx.particles !== false;   // 低端机跳过影子，省一半绘制

    orderBuf.length = coins.length;
    for (let i = 0; i < coins.length; i++) orderBuf[i] = coins[i];
    if (orderBuf.length > 1) orderBuf.sort((a, b) => Pile.sortKey(a) - Pile.sortKey(b));

    // 落地那一下：扬尘 + 闷响（每枚币只消费一次）
    for (let i = 0; i < orderBuf.length; i++) {
      const c = orderBuf[i];
      if (c.landFx > 0.85 && !c._landDone) {
        c._landDone = true;
        Fx.dust(P.projectX(c.x, c.y), P.projectY(c.y, 0) + 3, D.COIN_DEFS[c.kind].glow);
        Sfx.land();
      } else if (c.landFx <= 0 && c._landDone) {
        c._landDone = false;
      }
    }

    /* 影子：币堆"有厚度"这件事，一半靠它。
     * 高度用 z + visualZ —— 被挤高的币，影子也跟着变大变淡。 */
    if (drawShadows) {
      ctx.fillStyle = "#000";
      for (let i = 0; i < orderBuf.length; i++) {
        const c = orderBuf[i];
        const st = Pile.get(c);
        const sh = P.shadow(c.x, c.y, c.z + st.vz, c.r);
        ctx.globalAlpha = sh.alpha;
        ctx.beginPath();
        ctx.ellipse(sh.x, sh.y, sh.rx, sh.ry, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    for (let i = 0; i < orderBuf.length; i++) {
      const c = orderBuf[i];
      if (c._chuteT > 0) continue;               // 还在导轨上，交给 CPChute 画
      const def = D.COIN_DEFS[c.kind];
      if (!def) continue;
      const st = Pile.get(c);
      const z = c.z + st.vz;
      // 稀有奖励在屏幕上额外放大一圈（物理半径不变，平衡不受影响）
      const k = P.scaleAt(c.y, z) * artBoost(c.kind);
      const px = P.projectX(c.x, c.y), py = P.projectY(c.y, z);
      const sq = 0.35 + 0.65 * c.squash;

      // 稀有奖励：露出越多，光晕 / 地面光环越强
      if (def.halo) Hero.drawAura(ctx, c, def, px, py, k, nowT);

      Coin.drawCoin(ctx, def, px, py, k, st, sq, nowT);

      // 一次性高光扫过（不是无限爆粒子）
      if (def.halo) Hero.drawSweep(ctx, c, def, px, py, k, nowT);

      if (c.spark > 0.02) {
        ctx.save();
        ctx.globalAlpha = c.spark * 0.7;
        ctx.strokeStyle = def.glow;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, (c.r + 3 + (1 - c.spark) * 8) * k, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      if (c.stress > 1.5) {
        ctx.save();
        ctx.globalAlpha = Math.min(0.45, c.stress / 10);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(px, py, c.r * k, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
    }
  }

  /* ---------------- 瞄准提示 ----------------
   * 2.5D 下同一台面 x 在不同深度对应不同屏幕 x，
   * 所以引导线是**收敛曲线**，落点提示也跟着透视压扁。 */
  function drawAim() {
    if (!hasHover || !game) return;
    const w = game.world;
    const z = w.dropZone;
    const x = Math.max(14, Math.min(W - 14, hoverX));
    const mid = z.yMid;
    const k = P.kAt(mid) * P.viewScale();
    const ry = Math.max(10, (z.y1 - z.y0) / 2 * k * 0.55);

    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = "rgba(255,204,77,.55)";
    ctx.lineWidth = 1.4;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    for (let y = z.y0 + 8; y <= w.payoutY; y += 12) {
      const sx = P.projectX(x, y), sy = P.projectY(y, 0);
      if (y === z.y0 + 8) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    const px = P.projectX(x, mid), py = P.projectY(mid, 0);
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = "rgba(255,233,168,.6)";
    ctx.beginPath(); ctx.ellipse(px, py, 12 * k, ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = "rgba(255,233,168,.9)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(px, py, 12 * k, ry, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(px, py, 4 * k, ry * 0.35, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  function render() {
    if (!game) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    M.bake(game, dpr);

    ctx.save();
    // 机台微震 + 屏幕震动叠加，但来源分开：不是所有东西一起抖
    const sh = Fx.shake + machineShake;
    if (sh > 0.2) ctx.translate((VRng.next() - 0.5) * sh, (VRng.next() - 0.5) * sh);

    M.drawBack(ctx);                       // 外壳 / 内舱 / 台面
    Chute.drawRail(ctx, nowT);             // 投币导轨
    Pusher.draw(ctx, game.world, nowT);    // 推板（压在币下面）
    drawAim();
    drawCoins();                           // 币 / 币堆 / 稀有奖励
    Chute.draw(ctx, nowT);                 // 还在下落的币
    M.drawFront(ctx);                      // 立柱 / 前沿 / 出币口 / 前立面
    Payout.draw(ctx, nowT);                // 飞向 HUD 的奖励
    Fx.draw(ctx);                          // 粒子 / 飘字
    ctx.restore();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---------------- HUD 数字滚动结算 ----------------
   * 不再 12540 → 12660 直接跳，而是 12540 → … → 12660 滚上去，
   * 让「机器里的奖励 → 飞到 HUD → 数字上涨」形成完整因果链。 */
  let shownCredits = null;
  function tickCredits(dt) {
    if (!game) return;
    const target = game.st.credits;
    if (shownCredits == null) { shownCredits = target; return; }
    if (shownCredits === target) return;
    const d = target - shownCredits;
    shownCredits += d * (1 - Math.exp(-dt * 13));
    if (Math.abs(target - shownCredits) < 1) shownCredits = target;
    else shownCredits = Math.round(shownCredits);
  }

  function addDelta(amount) {
    const el = document.getElementById("dCoin");
    if (!el || !(amount > 0)) return;
    el.textContent = "+" + D.fmt(amount);
    el.classList.remove("on");
    void el.offsetWidth;                   // 强制重排，动画能重复触发
    el.classList.add("on");
  }

  /* ---------------- DOM ---------------- */
  const $ = (id) => document.getElementById(id);
  const elCoin = $("vCoin"), elGem = $("vGem"), elTix = $("vTix");
  const elCombo = $("comboBadge"), elJackpot = $("jackpotFx"), elHero = $("heroFx");
  const elTicker = $("ticker"), elLogList = $("logList"), elToasts = $("toasts");
  const elStageNote = $("stageNote"), elAutoLv = $("autoLv"), elTixLeft = $("tixLeft");
  const btnDrop = $("btnDrop"), btnAuto = $("btnAuto"), btnLottery = $("btnLottery");
  const btnMute = $("btnMute"), btnPause = $("btnPause"), btnBailout = $("btnBailout");
  const btnHot = $("btnHot"), elHotLv = $("hotLv");
  const elCapText = $("capText"), elCapFill = $("capFill"), elCap = $("cap");
  const chipCongest = $("congestChip"), chipStreak = $("streakChip"), chipOverheat = $("overheatChip");
  const chipUpkeep = $("upkeepChip");
  const questRow = $("questRow"), questTag = $("questTag"), questName = $("questName");
  const questProg = $("questProg"), questFill = $("questFill"), questTime = $("questTime");
  const btnOrderYes = $("btnOrderYes"), btnOrderNo = $("btnOrderNo");

  // 安全区（刘海 / 底部指示条）：用一个隐藏探针实测，比读自定义属性可靠。
  let safeProbe = null;
  function safeInsets() {
    try {
      if (!safeProbe) {
        safeProbe = document.createElement("div");
        safeProbe.setAttribute("aria-hidden", "true");
        safeProbe.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;" +
          "padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
        document.body.appendChild(safeProbe);
      }
      const cs = getComputedStyle(safeProbe);
      return {
        top: parseFloat(cs.paddingTop) || 0,
        right: parseFloat(cs.paddingRight) || 0,
        bottom: parseFloat(cs.paddingBottom) || 0,
        left: parseFloat(cs.paddingLeft) || 0
      };
    } catch (e) {
      return { top: 0, right: 0, bottom: 0, left: 0 };
    }
  }

  // 双端适配总入口：视口分级 → 台面尺寸 → 高清档位 → 性能档位
  function fit() {
    const vw = window.innerWidth || W;
    const vh = window.innerHeight || H;
    const ins = safeInsets();
    const p = L.plan({
      vw: vw, vh: vh,
      dpr: window.devicePixelRatio || 1,
      safeTop: ins.top, safeBottom: ins.bottom,
      safeLeft: ins.left, safeRight: ins.right,
      deviceMemory: navigator.deviceMemory,
      cores: navigator.hardwareConcurrency
    });

    mode = p.mode;
    dpr = p.dpr;
    document.body.dataset.mode = p.mode;
    document.body.dataset.log = p.logMode;
    const rs = document.documentElement.style;
    rs.setProperty("--stage-w", p.stage.w + "px");
    rs.setProperty("--cab-w", p.cabWidth + "px");
    rs.setProperty("--log-w", p.logWidth + "px");
    rs.setProperty("--safe-top", ins.top + "px");
    rs.setProperty("--safe-right", ins.right + "px");
    rs.setProperty("--safe-bottom", ins.bottom + "px");
    rs.setProperty("--safe-left", ins.left + "px");

    Fx.apply(p.perf);

    // 高清档位变了就重烘焙币精灵与机台，避免糊边
    if (dpr !== spriteDpr) {
      spriteDpr = dpr;
      for (const k in sprites) delete sprites[k];
    }
    Coin.setDpr(dpr);
    M.invalidate();
    Pusher.invalidate();

    const bw = Math.round(W * dpr), bh = Math.round(H * dpr);
    if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 出币动画的终点：HUD 上的金币数字
    if (elCoin) {
      const cvr = cv.getBoundingClientRect(), cr = elCoin.getBoundingClientRect();
      if (cvr.width > 0 && cvr.height > 0) {
        Payout.setAnchor({
          x: (cr.left + cr.width / 2 - cvr.left) / cvr.width * W,
          y: (cr.top + cr.height / 2 - cvr.top) / cvr.height * H
        });
      }
    }

    // 触屏端没有空格键，提示语要换
    if (elStageNote) {
      elStageNote.textContent = (p.mode === "narrow" || p.mode === "compact")
        ? "点台面投币 · 拖动可瞄准" : "点击台面投币 · 空格也行";
    }
    if (game) { refreshHud(true); render(); }
  }

  /* ---------------- 日志（只增量追加，不整块重建） ---------------- */
  const LOG_MAX = 60;
  function log(text, cls) {
    const li = document.createElement("li");
    li.className = cls || "";
    li.textContent = text;
    elLogList.insertBefore(li, elLogList.firstChild);
    while (elLogList.children.length > LOG_MAX) elLogList.removeChild(elLogList.lastChild);
  }
  function clearLog() { elLogList.innerHTML = ""; }

  /* ---------------- Ticker ---------------- */
  let tickerTimer = 0, tickerHot = false;
  function ticker(text, hot) {
    const h = !!hot;
    // 同一句话不重复设置：否则连发事件会把热态计时器一直重置，提示永远高亮
    if (elTicker.textContent === text && tickerHot === h) return;
    elTicker.textContent = text;
    elTicker.classList.toggle("hot", h);
    tickerHot = h;
    tickerTimer = 2.4;
  }
  function idleTicker() {
    const m = game.modifierDef();
    const bits = ["机台 · " + m.name];
    if (game.paused) bits.push("推板已暂停");
    if (game.overheatT > 0) bits.push("过热 " + game.overheatT.toFixed(1) + "s");
    if (game.congest > 0.02) bits.push("拥堵 " + Math.round(game.congest * 100) + "%");
    if (game.streakT > 0) bits.push("漏币中");
    if (game.orderOffering()) bits.push("有订单待接");
    else if (game.orderActive()) bits.push("订单进行中");
    if (bits.length === 1) bits.push("推板运行中");
    return bits.join(" · ");
  }

  function toast(text, cls, emoji) {
    const d = document.createElement("div");
    d.className = "toast " + (cls || "");
    d.innerHTML = (emoji ? '<span class="em">' + emoji + "</span>" : "") + "<span>" + esc(text) + "</span>";
    elToasts.appendChild(d);
    setTimeout(() => {
      d.classList.add("out");
      setTimeout(() => d.remove(), 320);
    }, 2100);
    while (elToasts.children.length > 4) elToasts.firstChild.remove();
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ---------------- HUD（脏检查，值变了才写 DOM） ---------------- */
  const hudPrev = {};
  function setText(el, v) {
    if (!el) return;
    if (hudPrev[el.id] === v) return;
    hudPrev[el.id] = v;
    el.textContent = v;
  }
  function setBool(el, prop, v) {
    if (!el) return;
    const key = el.id + ":" + prop;
    if (hudPrev[key] === v) return;
    hudPrev[key] = v;
    el[prop] = v;
  }
  function setAttr(el, name, v) {
    if (!el) return;
    const key = el.id + "@" + name;
    if (hudPrev[key] === v) return;
    hudPrev[key] = v;
    el.setAttribute(name, v);
  }
  function setClass(el, key, v) {
    if (!el) return;
    if (hudPrev[key] === v) return;
    hudPrev[key] = v;
    el.className = v;
  }

  function refreshHud(force) {
    if (!game) return;
    const st = game.st;
    if (force) for (const k in hudPrev) delete hudPrev[k];

    setText(elCoin, D.fmt(shownCredits == null ? st.credits : shownCredits));
    setText(elGem, D.fmt(st.gems));
    setText(elTix, D.fmt(st.tickets));

    const autoOn = !!st.auto && game.autoLvl() > 0;
    setText(elAutoLv, autoOn ? ("Lv" + game.autoLvl()) : "关");
    setAttr(btnAuto, "aria-pressed", autoOn ? "true" : "false");
    setBool(btnAuto, "disabled", game.autoLvl() <= 0);
    setAttr(btnAuto, "title", game.autoLvl() <= 0 ? "需先在商店购买「自动投币机」" : "开关自动投币（快捷键 A）");

    setText(elTixLeft, st.tickets + "/5");
    setBool(btnLottery, "disabled", st.tickets < 5);
    setBool(btnDrop, "disabled", st.credits < 1);

    setText(btnPause, game.paused ? "▶ 继续" : "⏸ 暂停");
    setAttr(btnPause, "aria-pressed", game.paused ? "true" : "false");
    setAttr(btnPause, "title", "暂停/继续推板（快捷键 P）");

    // 救济金按钮：只在真的走投无路时出现
    setBool(btnBailout, "hidden", !game.needBailout());

    // 超频：就绪 / 超频中 / 冷却，三态一目了然
    const hotReady = game.hotReady() && st.credits >= D.HOT.cost;
    if (game.hotActive()) setText(elHotLv, game.hotLeft().toFixed(1) + "s");
    else if (!game.hotReady()) setText(elHotLv, "冷 " + Math.ceil(game.hotCdLeft()) + "s");
    else setText(elHotLv, st.credits >= D.HOT.cost ? "就绪" : "缺 " + D.HOT.cost);
    setBool(btnHot, "disabled", !hotReady);
    setAttr(btnHot, "aria-pressed", game.hotActive() ? "true" : "false");

    // 容量条
    const w = game.world;
    const ratio = Math.min(1, w.coins.length / w.maxCoins);
    const lvl = ratio > 0.9 ? "red" : ratio > 0.7 ? "warn" : "ok";
    setText(elCapText, w.coins.length + "/" + w.maxCoins);
    if (hudPrev.capFill !== ratio) {
      hudPrev.capFill = ratio;
      elCapFill.style.width = (ratio * 100).toFixed(1) + "%";
    }
    setClass(elCap, "capLvl", "cap " + lvl);

    // 状态 chips：把"正在被惩罚"这件事显式告诉玩家
    setBool(chipCongest, "hidden", game.congest <= 0.02);
    if (game.congest > 0.02) setText(chipCongest, "拥堵 " + Math.round(game.congest * 100) + "%");
    setBool(chipStreak, "hidden", game.streakT <= 0);
    setBool(chipOverheat, "hidden", game.overheatT <= 0);
    if (game.overheatT > 0) setText(chipOverheat, "过热 " + game.overheatT.toFixed(1) + "s");
    /* 机台维护费：**真正的惩罚机制**，必须常驻可见 ——
     * 否则玩家只会觉得「钱一直在涨」，看不到任何成本。 */
    const upkeep = game.maintenanceCost();
    setBool(chipUpkeep, "hidden", upkeep <= 0);
    if (upkeep > 0) {
      setText(chipUpkeep, "维护 −" + D.fmt(upkeep) + "/" + D.MAINTENANCE.every + "s");
      setAttr(chipUpkeep, "title",
        "机台维护费：每 " + D.MAINTENANCE.every + "s 扣 " + D.fmt(upkeep) + " ◎（升级越多 / 换台越高越贵）\n" +
        "抽成：每笔推落收益扣走 " + Math.round(D.MAINTENANCE.rake * 100) + "%");
    }

    refreshQuest();
  }

  /* ---------------- 限时订单 UI ---------------- */
  function refreshQuest() {
    const o = game.order;
    if (!o) { setBool(questRow, "hidden", true); return; }
    setBool(questRow, "hidden", false);
    const def = o.def;
    /* 目标 / 赏 / 罚一律读**订单对象上的值**（offerOrder 时按玩家产能算好并存下来），
     * 不再去读 def —— def 里现在只有 ask / pay 这种规则参数，没有具体数字。 */
    if (o.phase === "offer") {
      setClass(questTag, "questTagCls", "quest-tag offer");
      setText(questTag, "新订单");
      setText(questName, def.name);
      setText(questProg, "目标 " + o.target + def.unit + " · 赏 " + D.fmt(o.reward) + " · 罚 " + D.fmt(o.penalty));
      questFill.style.width = "100%";
      questFill.style.background = "linear-gradient(90deg,#ffd863,#e09a12)";
      setText(questTime, o.t.toFixed(1) + "s");
      setBool(btnOrderYes, "hidden", false);
      setBool(btnOrderNo, "hidden", false);
    } else {
      setClass(questTag, "questTagCls", "quest-tag run");
      setText(questTag, "进行中");
      setText(questName, def.name);
      setText(questProg, Math.min(o.prog, o.target) + "/" + o.target + def.unit + " · 赏 " + D.fmt(o.reward));
      const pr = Math.min(1, o.prog / Math.max(1, o.target));
      questFill.style.width = (pr * 100).toFixed(1) + "%";
      questFill.style.background = pr >= 1
        ? "linear-gradient(90deg,#5ce68a,#2fae5e)"
        : "linear-gradient(90deg,#4ee2ff,#3a8fe0)";
      setText(questTime, o.t.toFixed(1) + "s");
      setBool(btnOrderYes, "hidden", true);
      setBool(btnOrderNo, "hidden", true);
    }
  }

  /* ---------------- 事件处理 ---------------- */
  let lastTierShown = "";
  let denyAt = 0;
  function throttledDeny() {
    const t = (window.performance && performance.now) ? performance.now() : Date.now();
    if (t - denyAt < 900) return;
    denyAt = t;
    Sfx.deny();
  }
  /* 维护费每 6 秒扣一次，全写日志会刷屏 —— 节流到 20 秒一条，
   * 但状态 chip 是常驻的，玩家随时能看到成本在跑。 */
  let upkeepLogAt = 0;
  function throttledUpkeep(amount) {
    const t = (window.performance && performance.now) ? performance.now() : Date.now();
    if (t - upkeepLogAt < 20000) return;
    upkeepLogAt = t;
    log("🏧 机台维护费 −" + D.fmt(amount) + " ◎（每 " + D.MAINTENANCE.every + "s 结算一次）", "bad");
  }

  function handleEvents() {
    const evts = game.drainPending();
    for (let i = 0; i < evts.length; i++) {
      const e = evts[i];
      if (e.type === "drop") {
        Sfx.insert();
        // 投币过程看得见：这几枚先走导轨，再落到真实落点
        if (e.coins) for (let ci = 0; ci < e.coins.length; ci++) Chute.note(e.coins[ci]);
        const z = game.world.dropZone;
        Fx.ring(P.projectX(e.x == null ? W / 2 : e.x, z.y1), z.y1, "rgba(255,204,77,.5)");
      } else if (e.type === "pay") {
        const def = D.COIN_DEFS[e.kind];
        const px = P.projectX(e.x, e.y), py = P.projectY(e.y, 0);
        Sfx.pay(e.combo);
        Fx.burst(px, py - 12, def.glow, 10, Math.PI * 2, 150);
        /* 出币链路：奖励从出币口起飞 → 沿弧线飞向 HUD → 落地时数字滚动结算。
         * 稀有奖励先有 Hero Hold 停顿，普通奖励直接飞走。 */
        const sr = M.slotRect(game.world);
        Payout.spawn(def, sr.x + sr.w / 2, sr.y + sr.h / 2, e.gain, {
          hero: !!def.hero,
          jackpot: !!def.jackpot,
          label: e.gain > 0 ? "+" + D.fmt(e.gain) : def.name + "！"
        });
        if (e.gain > 0) {
          Fx.text(px, py - 20, "+" + e.gain, e.mul > 1 ? "#ffe9a8" : "#d8ffe6", e.mul >= 2 ? 19 : 15);
        } else if (def.jackpot || def.tower) {
          Fx.text(px, py - 20, def.name + "！", def.glow, 17);
        }
        if (e.crit) {
          Fx.text(px + 12, py - 34, "暴击!", "#ff8ad8", 14);
          Fx.ring(px, py - 12, "rgba(255,94,196,.85)");
        }
        if (e.hot) Fx.text(px - 14, py - 34, "×2", "#4ee2ff", 13);
        const lab = D.tierLabel(e.combo);
        if (e.mul >= 2) Fx.ring(px, py - 12, "rgba(255,233,168,.8)");
        // 徽章只在"跨档"时弹：不再每掉一枚币都弹一次
        if (lab && lab !== lastTierShown) {
          lastTierShown = lab;
          showCombo(e.combo, e.mul);
          Fx.shakeIt(2.2);
        } else if (!lab) {
          lastTierShown = "";
        }
        // 稀有奖励：星尘 + 拾取横幅，和普通币彻底区分开
        if (def.hero) {
          Fx.stardust(px, py, def.glow, def.art === "disc" ? 8 : 16);
          if (def.art !== "disc") showHero(def.name, def.glow, "推落！");
        }
        if (e.gem) {
          Fx.burst(px, py - 12, "#7ce8ff", 16, Math.PI * 2, 200);
          log("钻石币掉落 → 钻石 +" + e.gem, "good");
        }
        if (e.ticket) log("幸运币掉落 → 抽奖券 +" + e.ticket, "good");
      } else if (e.type === "gutter") {
        Sfx.gutter();
        Fx.burst(P.projectX(e.x, e.y), P.projectY(e.y, 0) - 10, "#ff6b6b", 6, Math.PI, 110);
      } else if (e.type === "jackpot") {
        Sfx.jackpot();
        Fx.shakeIt(12);
        Fx.burst(W / 2, 300, "#ffcc4d", 60, Math.PI * 2, 340);
        showJackpot("JACKPOT!");
        log("★ JACKPOT ★ 宝箱开启，额外 +" + D.fmt(e.bonus) + " 金币，并撒下 " + e.coins + "/" + e.total + " 枚币" +
          (e.refund ? "（台面已满，折算补偿 +" + D.fmt(e.refund) + "）" : "") + "！", "big");
        toast("JACKPOT +" + D.fmt(e.bonus), "win", "🎉");
      } else if (e.type === "tower") {
        Sfx.tower();
        Fx.shakeIt(14);
        Fx.burst(W / 2, 320, "#ffd75e", 70, Math.PI * 2, 360);
        Fx.stardust(W / 2, 320, "rgba(255,215,94,.9)", 40);
        showJackpot("TOWER!");
        showHero("金币塔", "rgba(255,215,94,.95)", "+" + D.fmt(e.bonus));
        log("▲ 金币塔落成 ▲ 额外 +" + D.fmt(e.bonus) + " 金币，并撒下 " + e.coins + "/" + e.total + " 枚币" +
          (e.refund ? "（台面已满，折算补偿 +" + D.fmt(e.refund) + "）" : "") + "！", "big");
        toast("金币塔 +" + D.fmt(e.bonus), "win", "🏰");
      } else if (e.type === "burst") {
        Sfx.burst();
        Fx.shakeIt(8);
        for (const d of (e.drop || [])) {
          const def = D.COIN_DEFS[d.kind] || D.COIN_DEFS.copper;
          Fx.burst(P.projectX(d.x, d.y), P.projectY(d.y, 0), def.glow, 8, Math.PI, 130);
        }
        log("⚠ 台面挤爆！" + e.n + " 枚币被挤进角沟（防爆护栏可以减少损失）", "bad");
        ticker("台面爆仓 · 先推落一些币，或升级「排风马达 / 防爆护栏」", true);
        toast("爆仓 −" + e.n + " 枚", "bad", "⚠");
      } else if (e.type === "streak") {
        Sfx.streak();
        log("⚠ 连续掉沟，机台开始「漏币」：角沟临时变宽 " + Math.round((D.STREAK.mul - 1) * 100) + "%（" + D.STREAK.dur + "s）", "bad");
        ticker("漏币中 · 角沟变宽，先稳住落点", true);
      } else if (e.type === "hot") {
        Sfx.hot();
        Fx.ring(W / 2, 320, "rgba(78,226,255,.9)");
        log("⚡ 超频启动：8 秒内产出 ×" + D.HOT.mul + "、推板加速 ×" + D.HOT.speed + "（花费 " + e.cost + "）", "sys");
        toast("超频启动 ×" + D.HOT.mul, "win", "⚡");
      } else if (e.type === "orderOffer") {
        Sfx.orderOffer();
        log("📋 新订单「" + e.name + "」：目标 " + e.target + e.unit + " · 赏 " + D.fmt(e.reward) +
          " · 罚 " + D.fmt(e.penalty) + "（" + e.t.toFixed(0) + " 秒内决定，不接不算失败）", "sys");
        ticker("有订单待接 · 接不接由你决定", false);
      } else if (e.type === "orderStart") {
        log("✅ 接下订单「" + e.name + "」：目标 " + e.target + "，" + e.t.toFixed(0) + " 秒内完成", "sys");
      } else if (e.type === "orderDecline") {
        log("订单「" + e.name + "」已放弃（不算失败，无罚金）", "sys");
      } else if (e.type === "orderExpire") {
        ticker("订单提议已收回", false);
      } else if (e.type === "orderDone") {
        Sfx.orderDone();
        Fx.shakeIt(6);
        showHero("订单完成", "rgba(92,230,138,.95)", "+" + D.fmt(e.reward));
        log("🏅 订单达成「" + e.name + "」：" + e.prog + "/" + e.target + " → 赏金 +" + D.fmt(e.reward), "good");
        toast("订单达成 +" + D.fmt(e.reward), "ach", "🏅");
      } else if (e.type === "orderFail") {
        Sfx.orderFail();
        Fx.shakeIt(9);
        log("❌ 订单失败「" + e.name + "」：" + e.prog + "/" + e.target +
          " → 罚金 −" + D.fmt(e.penalty) + "，机台过热 " + e.overheat + " 秒（推板减速）", "bad");
        toast("订单失败 −" + D.fmt(e.penalty), "bad", "❌");
        ticker("订单失败 · 机台过热中", true);
      } else if (e.type === "ach") {
        for (const id of e.list) {
          const a = D.ACHIEVEMENTS.find((x) => x.id === id);
          if (!a) continue;
          Sfx.buy();
          log("成就解锁：🏆 " + a.name + " —— " + a.desc, "good");
          toast("成就解锁：" + a.name, "ach", "🏆");
        }
      } else if (e.type === "buy") {
        Sfx.buy();
        const u = game.upDef(e.id);
        log("升级 " + u.name + " → Lv" + e.level + "（花费 " + D.fmt(e.cost) + "）", "sys");
      } else if (e.type === "buyGem") {
        Sfx.buy();
        const u = game.gemDef(e.id);
        log("钻石升级 " + u.name + " → Lv" + e.level + "（花费 " + e.cost + "◆）", "sys");
      } else if (e.type === "lottery") {
        log("抽奖结果：" + e.text, "big");
        toast("抽奖：" + e.text, "win", "🎁");
      } else if (e.type === "bailout") {
        log("金币见底，机台赠送救济金 +" + e.amount, "sys");
        toast("救济金 +" + e.amount, "ach", "🪙");
        ticker("救济金已到账 +" + e.amount + " · 继续推币吧", false);
      } else if (e.type === "upkeep") {
        /* 维护费：唯一一项「无条件下、从钱包里扣钱」的惩罚。
         * 必须让玩家看见，否则滚雪球就没有任何感知压力。 */
        throttledUpkeep(e.amount);
      } else if (e.type === "prestige") {
        Sfx.jackpot();
        Fx.shakeIt(10);
        // 换台＝整台重来：币全换新，视觉层里的旧状态必须一起清掉
        Pile.clear(); Hero.clear(); Chute.clear(); Payout.clear();
        machineShake = 0;
        const m = D.modById(e.mod);
        log("换机台成功 → 第 " + e.level + " 台「" + m.name + "」：" + m.desc, "big");
        toast("换机台 · " + m.name, "win", "🎰");
        ticker(idleTicker(), false);
      } else if (e.type === "pause") {
        log(e.paused ? "推板已暂停" : "推板继续运行", "sys");
        ticker(idleTicker(), false);
      } else if (e.type === "deny") {
        throttledDeny();
        if (e.id === "insert") ticker("金币不足 · 领救济金或等机台赠送", true);
        else if (e.id === "lottery") ticker("抽奖需要 5 张券（当前 " + game.st.tickets + " 张）", true);
        else if (e.id === "prestige") ticker("换机台需要累计收益 " + D.fmt(game.prestigeNeed()) + " ◎", true);
        else if (e.id === "hot") ticker("超频冷却中，或金币不足 " + D.HOT.cost + " ◎", true);
        else ticker("条件不满足", true);
      } else if (e.type === "full") {
        ticker("台面满了！再塞会爆仓，先推落一些币", true);
      }
    }
  }

  let comboTimer = 0;
  function showCombo(n, mul) {
    const label = D.tierLabel(n);
    elCombo.innerHTML = (label ? label + " " : "") + "×" + mul + "<small>连击 " + n + " 枚</small>";
    elCombo.classList.add("on");
    comboTimer = 0.85;
  }
  let jpTimer = 0;
  function showJackpot(text) {
    elJackpot.innerHTML = "<span>" + esc(text || "JACKPOT!") + "</span>";
    elJackpot.classList.add("on");
    jpTimer = 2.0;
  }
  let heroTimer = 0;
  function showHero(name, color, sub) {
    elHero.innerHTML = '<span class="hn" style="color:' + color + '">' + esc(name) + "</span>" +
      (sub ? '<small style="color:' + color + '">' + esc(sub) + "</small>" : "");
    elHero.classList.add("on");
    heroTimer = 1.6;
  }

  /* ---------------- 主循环 ---------------- */
  function frame(t) {
    requestAnimationFrame(frame);
    if (!lastT) lastT = t;
    let dt = (t - lastT) / 1000;
    lastT = t;
    if (dt > 0.25) dt = 0.25;
    nowT += dt;

    acc += dt;
    let guard = 0;
    while (acc >= FIXED && guard++ < 12) {
      game.step(FIXED);
      acc -= FIXED;
    }
    handleEvents();
    Fx.update(dt);

    /* 视觉层推进：币堆高度 / 稀有奖励露出 / 导轨下落 / 出币飞行。
     * 全是纯视觉量，不参与碰撞与结算，平衡测试的数字一个都不动。 */
    const w = game.world;
    Pile.update(w, dt);
    Hero.update(w, dt);
    Chute.update(dt);
    Payout.update(dt);
    machineShake = Math.min(2.5, Math.abs(w.plate.vy) / 150);
    pruneAcc += dt;
    if (pruneAcc > 2) { pruneAcc = 0; Pile.prune(w); Hero.prune(w); }
    tickCredits(dt);

    if (comboTimer > 0) { comboTimer -= dt; if (comboTimer <= 0) elCombo.classList.remove("on"); }
    if (jpTimer > 0) { jpTimer -= dt; if (jpTimer <= 0) elJackpot.classList.remove("on"); }
    if (heroTimer > 0) { heroTimer -= dt; if (heroTimer <= 0) elHero.classList.remove("on"); }
    if (tickerTimer > 0) {
      tickerTimer -= dt;
      if (tickerTimer <= 0) {
        // 热态到期回落为中性文案，提示不会永久挂在屏幕上
        tickerHot = false;
        elTicker.classList.remove("hot");
        elTicker.textContent = idleTicker();
      }
    }

    render();
    refreshHud();

    saveAcc += dt;
    if (saveAcc > 10) { saveAcc = 0; game.save(); }
  }

  /* ---------------- 输入 ----------------
   * 台面现在有透视：屏幕 x 不能直接当台面 x 用。
   * 反过来解算到「落点那一行」的台面坐标，玩家点哪条通道就落哪条通道。 */
  function boardXFromClient(clientX) {
    const r = cv.getBoundingClientRect();
    const sx = (clientX - r.left) / r.width * W;
    const y = game.world.dropZone.yMid;
    const k = P.kAt(y);
    return W / 2 + (sx - W / 2) / k;
  }
  function doDrop(x) {
    Sfx.ensure();
    const n = game.insert(x);
    if (n && elStageNote && !elStageNote.classList.contains("hide")) elStageNote.classList.add("hide");
  }

  cv.addEventListener("pointermove", (e) => {
    hoverX = boardXFromClient(e.clientX);
    hasHover = true;
  });
  cv.addEventListener("pointerleave", () => { hasHover = false; });
  cv.addEventListener("pointercancel", () => { hasHover = false; });
  cv.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    hoverX = boardXFromClient(e.clientX);
    hasHover = true;
    doDrop(hoverX);
  });

  btnDrop.addEventListener("click", () => doDrop(hasHover ? hoverX : W / 2));
  btnAuto.addEventListener("click", () => {
    if (game.autoLvl() <= 0) return;   // Lv0 时按钮本来就是 disabled，这里再兜一层
    game.st.auto = !game.st.auto;
    log(game.st.auto ? "自动投币机已启动（Lv" + game.autoLvl() + "）" : "自动投币机已关闭", "sys");
    ticker(game.st.auto ? "自动投币中…" : "已停止自动投币");
    refreshHud();
  });
  btnHot.addEventListener("click", () => {
    Sfx.ensure();
    game.useHot();
    handleEvents();
    refreshHud();
  });
  btnLottery.addEventListener("click", () => {
    Sfx.ensure();
    game.lottery();
    handleEvents();
    refreshHud();
  });
  btnPause.addEventListener("click", () => {
    game.togglePause();
    handleEvents();
    refreshHud();
  });
  btnBailout.addEventListener("click", () => {
    Sfx.ensure();
    if (game.needBailout()) game.bailout();
    handleEvents();
    refreshHud();
  });
  btnOrderYes.addEventListener("click", () => {
    Sfx.ensure();
    game.acceptOrder();
    handleEvents();
    refreshHud();
  });
  btnOrderNo.addEventListener("click", () => {
    game.declineOrder();
    handleEvents();
    refreshHud();
  });

  function syncMuteBtn() {
    const on = Sfx.isOn();
    btnMute.setAttribute("aria-pressed", on ? "true" : "false");
    btnMute.textContent = on ? "🔊 音效" : "🔇 静音";
    btnMute.title = on ? "音效已开启，点击静音" : "音效已静音，点击开启";
  }
  btnMute.addEventListener("click", () => {
    // aria-pressed 与真实状态严格同步：点一次就真的切换一次，不用点两下
    Sfx.setOn(!Sfx.isOn());
    syncMuteBtn();
    if (Sfx.isOn()) Sfx.buy();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeModal(); return; }
    const tag = (e.target && e.target.tagName) || "";
    const inField = /INPUT|TEXTAREA|SELECT/.test(tag) || (e.target && e.target.isContentEditable);
    if (inField) return;

    // 弹窗打开时屏蔽全部游戏快捷键：
    // 否则空格会"既触发弹窗按钮、又投一枚币"，一次按键两个动作
    if (!overlay.hidden) return;

    if (e.code === "Space" || e.key === " ") {
      // 焦点在按钮上时交给按钮自己处理，避免一次空格投两枚
      if (tag === "BUTTON") return;
      e.preventDefault();
      doDrop(hasHover ? hoverX : W / 2);
    } else if (e.key === "a" || e.key === "A") {
      if (!btnAuto.disabled) btnAuto.click();
    } else if (e.key === "h" || e.key === "H") {
      if (!btnHot.disabled) btnHot.click();
    } else if (e.key === "l" || e.key === "L") {
      if (!btnLottery.disabled) btnLottery.click();
    } else if (e.key === "p" || e.key === "P") {
      btnPause.click();
    }
  });

  /* ---------------- 弹窗 ---------------- */
  const overlay = $("overlay"), modalBody = $("modalBody"), modalTitle = $("modalTitle");
  let lastFocus = null;

  function openModal(title, html) {
    modalTitle.textContent = title;
    modalBody.innerHTML = html;
    lastFocus = document.activeElement;
    overlay.hidden = false;
    const f = modalBody.querySelector("button:not([disabled])");
    (f || $("btnClose")).focus();
  }
  function closeModal() {
    if (overlay.hidden) return;
    overlay.hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  $("btnClose").addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
  overlay.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const items = overlay.querySelectorAll("button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  function pips(level, max, gem) {
    let s = '<span class="pips">';
    for (let i = 0; i < max; i++) s += '<span class="pip ' + (gem ? "gem " : "") + (i < level ? "on" : "") + '"></span>';
    return s + "</span>";
  }

  function upCardInner(u) {
    const lv = game.upLevel(u.id), max = lv >= u.max;
    const cost = game.upCost(u.id);
    const can = game.canBuy(u.id);
    return '<div class="top"><span class="icon">' + u.icon + '</span>' +
      '<span class="name">' + u.name + "</span>" + pips(lv, u.max) +
      '<span class="lv">Lv ' + lv + "/" + u.max + "</span></div>" +
      '<div class="desc">' + u.desc + "</div>" +
      '<div class="row"><button type="button" data-up="' + u.id + '"' + (can ? "" : " disabled") + ">" +
      (max ? "已满级" : "升级 · " + D.fmt(cost) + " ◎") + "</button></div>";
  }
  function gemCardInner(u) {
    const lv = game.gemLevel(u.id), max = lv >= u.max;
    const cost = game.gemCost(u.id);
    const can = game.canBuyGem(u.id);
    return '<div class="top"><span class="icon">' + u.icon + '</span>' +
      '<span class="name">' + u.name + "</span>" + pips(lv, u.max, true) +
      '<span class="lv">Lv ' + lv + "/" + u.max + "</span></div>" +
      '<div class="desc">' + u.desc + "</div>" +
      '<div class="row"><button type="button" data-gem="' + u.id + '"' + (can ? "" : " disabled") + ">" +
      (max ? "已满级" : "升级 · " + cost + " ◆") + "</button></div>";
  }

  function prestigeInner() {
    const need = game.prestigeNeed();
    const earned = game.st.totals.earned;
    const can = game.canPrestige();
    const m = game.modifierDef();
    return '<div class="top"><span class="icon">🎰</span><span class="name">换机台</span>' +
      '<span class="lv">第 ' + (game.st.prestige || 0) + ' 层</span></div>' +
      '<div class="desc">清空全部升级与钻石升级，随机换一台带修饰的新机台，' +
      "并获得永久收益 +" + Math.round(D.PRESTIGE.bonus * 100) + "%（当前 ×" + game.prestigeMul().toFixed(2) + "）。<br>" +
      "当前机台：<b>" + m.name + "</b> —— " + m.desc + "</div>" +
      '<div class="desc">进度：累计收益 ' + D.fmt(earned) + " / " + D.fmt(need) + " ◎</div>" +
      '<div class="row"><button type="button" data-act="prestige"' + (can ? "" : " disabled") + ">" +
      (can ? "确认换机台" : "收益不足") + "</button></div>";
  }

  function shopHTML() {
    let h = '<p class="wallet" id="shopWallet">持有 ' + D.fmt(game.st.credits) + " ◎ · " + D.fmt(game.st.gems) + " ◆</p>";
    h += '<p class="h">金币升级</p><div class="grid">';
    for (const u of D.UPGRADES) {
      h += '<div class="card" data-card="up:' + u.id + '">' + upCardInner(u) + "</div>";
    }
    h += '</div><div class="sep"></div><p class="h">钻石升级</p><div class="grid">';
    for (const u of D.GEM_UPGRADES) {
      h += '<div class="card" data-card="gem:' + u.id + '">' + gemCardInner(u) + "</div>";
    }
    h += '</div><div class="sep"></div><div class="grid">' +
      '<div class="card" data-card="prestige">' + prestigeInner() + "</div>" +
      '<div class="card" data-card="reset"><div class="top"><span class="icon">↺</span><span class="name">重置存档</span></div>' +
      '<div class="desc">清空所有进度（含换机台层数），重新开始。此操作不可撤销。</div>' +
      '<div class="row"><button type="button" class="danger" data-act="reset">确认重置</button></div></div>' +
      "</div>";
    return h;
  }

  /* 只更新需要变的那一张卡片 —— 滚动位置不跳、键盘焦点不丢 */
  function refreshShopAfterBuy(id, isGem) {
    const sel = '[data-card="' + (isGem ? "gem:" : "up:") + id + '"]';
    const card = modalBody.querySelector(sel);
    const u = isGem ? game.gemDef(id) : game.upDef(id);
    const focused = document.activeElement;
    const hadFocus = !!(focused && focused.dataset && (focused.dataset.up === id || focused.dataset.gem === id));

    if (card && u) card.innerHTML = isGem ? gemCardInner(u) : upCardInner(u);

    // 其它卡片的"买得起/买不起"要跟着余额一起刷新，但不重建 DOM
    const btns = modalBody.querySelectorAll("button[data-up],button[data-gem]");
    for (const b of btns) {
      const bid = b.dataset.up || b.dataset.gem;
      const bgem = !!b.dataset.gem;
      const bu = bgem ? game.gemDef(bid) : game.upDef(bid);
      if (!bu) continue;
      const lv = bgem ? game.gemLevel(bid) : game.upLevel(bid);
      if (lv >= bu.max) { b.disabled = true; b.textContent = "已满级"; continue; }
      b.disabled = bgem ? !game.canBuyGem(bid) : !game.canBuy(bid);
      b.textContent = "升级 · " + (bgem ? (game.gemCost(bid) + " ◆") : (D.fmt(game.upCost(bid)) + " ◎"));
    }

    const wallet = modalBody.querySelector("#shopWallet");
    if (wallet) wallet.textContent = "持有 " + D.fmt(game.st.credits) + " ◎ · " + D.fmt(game.st.gems) + " ◆";
    const pc = modalBody.querySelector('[data-card="prestige"]');
    if (pc) pc.innerHTML = prestigeInner();

    // 焦点还原：按钮变灰了就顺延到下一个可点的按钮
    if (hadFocus) {
      let target = card ? card.querySelector("button:not([disabled])") : null;
      if (!target) target = modalBody.querySelector("button:not([disabled])");
      (target || $("btnClose")).focus();
    }
  }

  function achHTML() {
    let h = '<div class="grid">';
    for (const a of D.ACHIEVEMENTS) {
      const got = !!game.st.ach[a.id];
      h += '<div class="ach-row' + (got ? "" : " locked") + '"><span class="em">' + (got ? "🏆" : "🔒") + "</span>" +
        '<span><span class="t">' + a.name + '</span><br><span class="d">' + a.desc + "</span></span>" +
        (got ? '<span class="ok">已解锁</span>' : "") + "</div>";
    }
    return h + "</div>";
  }

  function statHTML() {
    const t = game.st.totals;
    const mins = Math.floor(t.playTime / 60);
    const perSec = t.playTime > 0 ? t.earned / t.playTime : 0;
    const rows = [
      ["累计投币次数", D.fmt(t.drops)],
      ["累计投入币数", D.fmt(t.dropped)],
      ["累计推落币数", D.fmt(t.paid)],
      ["掉进角沟", D.fmt(t.lost)],
      ["累计收益", D.fmt(t.earned) + " ◎"],
      ["累计消耗", D.fmt(t.spent) + " ◎"],
      ["净收益", D.fmt(t.earned - t.spent) + " ◎"],
      ["历史最高余额", D.fmt(t.bestCredits) + " ◎"],
      ["平均每秒产出", perSec.toFixed(2) + " ◎/s"],
      ["最高连击", D.fmt(t.bestCombo) + " 枚"],
      ["单次最高收益", D.fmt(t.bestPayout) + " ◎"],
      ["宝箱次数", D.fmt(t.jackpots)],
      ["金币塔次数", D.fmt(t.towers || 0)],
      ["订单完成 / 失败", D.fmt(t.ordersDone || 0) + " / " + D.fmt(t.ordersFailed || 0)],
      ["爆仓次数", D.fmt(t.bursts || 0)],
      ["漏币连锁次数", D.fmt(t.streaks || 0)],
      ["超频使用次数", D.fmt(t.hotUses || 0)],
      ["救济金次数", D.fmt(t.bailouts)],
      ["满台折算补偿", D.fmt(t.refunds) + " ◎"],
      ["机台维护费", D.fmt(t.upkeep || 0) + " ◎"],
      ["机台抽成", D.fmt(t.rake || 0) + " ◎"],
      ["累计毛收益（抽成前）", D.fmt(t.gross || 0) + " ◎"],
      ["换机台层数", D.fmt(game.st.prestige || 0)],
      ["当前机台", game.modifierDef().name],
      ["游玩时长", mins + " 分 " + Math.floor(t.playTime % 60) + " 秒"]
    ];
    let h = '<p class="h">总览</p><div class="stat-grid">';
    for (const r of rows) h += '<span class="k">' + r[0] + '</span><span class="v">' + r[1] + "</span>";
    h += '</div><div class="sep"></div><p class="h">各币种推落</p><div class="stat-grid">';
    for (const id of D.COIN_ORDER) {
      const def = D.COIN_DEFS[id];
      h += '<span class="k">' + def.name + "</span><span class=\"v\">" + D.fmt(t.kinds[id] || 0) + "</span>";
    }
    // 概率公开：直接读代码里那张表，不会出现"公示概率和实现不一致"
    h += '</div><div class="sep"></div><p class="h">抽奖概率（' + D.LOTTERY_TICKET_COST + ' 张券 / 次）</p><div class="stat-grid">';
    for (const row of D.LOTTERY_TABLE) {
      h += '<span class="k">' + row.label + "</span><span class=\"v\">" + Math.round(row.p * 100) + "%</span>";
    }
    h += '<span class="k">连击判定</span><span class="v">' + D.COMBO_WINDOW + "s 内推落 " + D.COMBO_TIERS.map((x) => x.n).join("/") +
      " 枚 → ×" + D.COMBO_TIERS.map((x) => x.mul).join("/") + "（滑动窗口计数）</span>";
    h += '<span class="k">暴击芯片</span><span class="v">每级 +10% 概率触发 ×' + D.CRIT_MULT + "（满级 30%）</span>";
    h += '<span class="k">宝箱出现率</span><span class="v">' +
      (D.chestChance(game.upLevel("luck") + game.modifierDef().luck) * 100).toFixed(2) +
      "% / 次补给（冷却 " + D.CHEST.cooldown + "s）</span>";
    h += '<span class="k">金币塔出现率</span><span class="v">' +
      (D.towerChance(game.upLevel("luck") + game.modifierDef().luck) * 100).toFixed(2) +
      "% / 次补给（冷却 " + D.TOWER.cooldown + "s）</span>";
    h += "</div><div class=\"sep\"></div><p class=\"h\">惩罚与风险机制</p><div class=\"stat-grid\">";
    h += '<span class="k">拥堵</span><span class="v">台面超 ' + Math.round(D.CONGESTION.warn * 100) +
      "% 起推板减速，满台最多 −" + Math.round(D.CONGESTION.speedLoss * 100) + "%（当前 −" +
      Math.round(game.congest * D.CONGESTION.speedLoss * 100) + "%）</span>";
    h += '<span class="k">爆仓</span><span class="v">满台后硬塞 ' + D.CONGESTION.burstAt + " 次挤掉 " +
      Math.max(1, D.CONGESTION.burstCoins - game.upLevel("guard")) + " 枚币（防爆护栏 Lv" + game.upLevel("guard") + "）</span>";
    h += '<span class="k">漏币连锁</span><span class="v">' + D.STREAK.window + "s 内掉沟 " + D.STREAK.n +
      " 次 → 角沟 ×" + D.STREAK.mul + " 宽，持续 " + D.STREAK.dur + "s</span>";
    h += '<span class="k">限时订单</span><span class="v">首次 ' + D.ORDER.first + "s，之后每 " + D.ORDER.every +
      "s 提议一次，" + D.ORDER.expire + "s 内决定；不接不算失败</span>";
    h += '<span class="k">订单失败惩罚</span><span class="v">罚金（按订单）+ 机台过热 ' + D.OVERHEAT.dur +
      "s（推板 ×" + D.OVERHEAT.mul + "）</span>";
    h += '<span class="k">机台维护费</span><span class="v">每 ' + D.MAINTENANCE.every + "s 扣 " +
      D.fmt(game.maintenanceCost()) + " ◎（基础 " + D.MAINTENANCE.base + " + 每级 " + D.MAINTENANCE.perLevel +
      " + 每层换台 " + D.MAINTENANCE.perPrestige + "，单次上限 " + D.MAINTENANCE.maxPerTick +
      "）—— 收益必须先覆盖它，累计已扣 " + D.fmt(t.upkeep || 0) + " ◎</span>";
    h += '<span class="k">机台抽成</span><span class="v">每笔推落收益（含宝箱 / 金币塔赏金）按 ' +
      Math.round(D.MAINTENANCE.rake * 100) + "% 抽走 —— 产出越高切得越多，累计已抽 " + D.fmt(t.rake || 0) + " ◎</span>";
    h += '<span class="k">超频</span><span class="v">花 ' + D.HOT.cost + " ◎ 换 " + D.HOT.dur +
      "s 产出 ×" + D.HOT.mul + " + 推板 ×" + D.HOT.speed + "，冷却 " + D.HOT.readyEvery + "s（手动触发）</span>";
    h += "</div><div class=\"sep\"></div>" +
      '<div class="card"><div class="top"><span class="icon">?</span><span class="name">玩法速记</span></div>' +
      '<div class="desc">点击台面任意位置投币，币会落到推板前方。<br>' +
      "推板往复把币往前推，掉进最前方的出币口就是收益，掉进左右两角的黑槽会丢币。<br>" +
      "连续推落会累积连击倍率；宝箱触发 JACKPOT，金币塔是更稀有的大奖。<br>" +
      "<b>惩罚线</b>：台面超过 80% 会拥堵（推板变慢），满台还硬塞会爆仓；连续掉沟会触发漏币连锁。<br>" +
      "<b>成本线</b>：机台每 " + D.MAINTENANCE.every + "s 收维护费，每笔收益还被抽走 " +
      Math.round(D.MAINTENANCE.rake * 100) + "% —— 躺着不推币是会亏钱的。<br>" +
      "<b>风险线</b>：机台会不定时给出限时订单，接下并达标拿重赏，失败要罚金 + 过热。<br>" +
      "金币见底时机台会自动赠送救济金，也可以点「领救济金」立刻领取。<br>" +
      "快捷键：空格投币 / A 自动 / H 超频 / L 抽奖 / P 暂停推板 / Esc 关闭面板。</div></div>";
    return h;
  }

  $("btnShop").addEventListener("click", () => openModal("升级商店", shopHTML()));
  $("btnAch").addEventListener("click", () => openModal("成就", achHTML()));
  $("btnStat").addEventListener("click", () => openModal("统计与玩法", statHTML()));

  modalBody.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.up) {
      if (game.buy(b.dataset.up)) { handleEvents(); refreshHud(); refreshShopAfterBuy(b.dataset.up, false); }
      else { handleEvents(); refreshHud(); }
    } else if (b.dataset.gem) {
      if (game.buyGem(b.dataset.gem)) { handleEvents(); refreshHud(); refreshShopAfterBuy(b.dataset.gem, true); }
      else { handleEvents(); refreshHud(); }
    } else if (b.dataset.act === "prestige") {
      if (game.doPrestige()) {
        Fx.clear();
        clearLog();
        handleEvents();
        refreshHud(true);
        // 换台后所有等级都归零，整块重建才准确（这里重建是合理的）
        modalBody.innerHTML = shopHTML();
      } else { handleEvents(); }
    } else if (b.dataset.act === "reset") {
      if (b.dataset.confirm === "1") {
        game.reset();
        Fx.clear();
        Pile.clear(); Hero.clear(); Chute.clear(); Payout.clear();
        machineShake = 0;
        shownCredits = null;
        clearLog();
        log("存档已重置，机台重新装满。", "sys");
        toast("存档已重置", "ach", "↺");
        closeModal();
        refreshHud(true);
        ticker(idleTicker(), false);
      } else {
        b.dataset.confirm = "1";
        b.textContent = "再点一次确认！";
      }
    }
  });

  /* ---------------- 启动 ---------------- */
  function boot() {
    Fx.init();
    fit();
    // 注入可播种 RNG：引擎里所有随机都走同一条通道，测试才可复现
    game = E.createGame({ rng: D.makeRng(((Math.random() * 0xffffffff) >>> 0)) });

    // 先尝试读档，再决定要不要撒开场币
    const loaded = game.load();
    if (!loaded) {
      game.seedField(170, 2);
      log("欢迎来到推币机！点击台面投币开始。", "sys");
      toast("欢迎！点台面投币", "ach", "🪙");
      ticker("新机台已就位 · 先投几枚找找手感", false);
    } else {
      log("读取存档成功，欢迎回来。", "sys");
      ticker("存档已读取 · 继续推币", false);
    }
    game.applyUpgrades();
    // 视觉层跟着存档走：清掉上一局的残留，再重开数字滚动
    Pile.clear(); Hero.clear(); Chute.clear(); Payout.clear();
    Payout.setOnLand(function (it) { if (it && it.amount > 0) addDelta(it.amount); });
    shownCredits = null;
    refreshHud(true);
    syncMuteBtn();
    render();

    window.addEventListener("resize", fit);
    window.addEventListener("orientationchange", fit);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", fit);
    window.addEventListener("pagehide", () => game.save());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        game.save();
        Sfx.suspend();          // 只挂起音频上下文，绝不动 soundOn
      } else {
        Sfx.resume();           // 切回来音效还在，不会永久静音
        lastT = 0;
      }
    });

    // 调试钩子
    window.__CP = { game: game, Fx: Fx, Sfx: Sfx, render: render, layout: L, project: P, fit: fit, modeOf: () => mode };

    requestAnimationFrame(frame);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
