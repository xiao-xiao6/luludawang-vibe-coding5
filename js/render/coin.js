/* ============================================================
 * 金币材质渲染（Layer 4 / 6）
 *
 * 普通币不再是"一个 radial gradient 的圆图标"，而是：
 *   顶面 face + 侧面 side + 外缘 rim + 高光 highlight + 落地影子
 * 并支持绕竖直轴的伪 3D 翻转（顶面椭圆变窄 → 侧面厚度露出来）。
 *
 * 所有静态部分都烘焙进离屏 canvas 并按 dpr 缓存，
 * 主循环里只有 drawImage —— 满台 260 枚也不会每帧建渐变。
 * ============================================================ */
(function (root) {
  "use strict";

  const P = root.CPProject;

  let dpr = 1;
  const faces = {}, halos = {}, rings = {}, strips = {};

  function setDpr(d) {
    if (d === dpr) return;
    dpr = d;
    clear();
  }
  function clear() {
    for (const k in faces) delete faces[k];
    for (const k in halos) delete halos[k];
    for (const k in rings) delete rings[k];
    for (const k in strips) delete strips[k];
  }

  function newCv(w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil(w * dpr));
    c.height = Math.max(1, Math.ceil(h * dpr));
    const g = c.getContext("2d");
    g.scale(dpr, dpr);
    return { c: c, g: g };
  }

  /* ---------------- 普通币：金属圆片 ---------------- */
  function buildDisc(def) {
    const pad = 4, r = def.r, size = Math.ceil((r + pad) * 2);
    const o = newCv(size, size), g = o.g;
    g.translate(size / 2, size / 2);

    // 外缘暗环：厚度的第一层
    g.fillStyle = def.ring;
    g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();

    // 顶面
    const grd = g.createRadialGradient(-r * 0.35, -r * 0.42, r * 0.12, 0, 0, r * 1.02);
    grd.addColorStop(0, def.color2);
    grd.addColorStop(0.55, def.color);
    grd.addColorStop(1, def.ring);
    g.fillStyle = grd;
    g.beginPath(); g.arc(0, 0, r * 0.9, 0, Math.PI * 2); g.fill();

    // 压印内环（浮雕感）
    g.lineWidth = 1.4; g.strokeStyle = "rgba(255,255,255,.30)";
    g.beginPath(); g.arc(0, 0, r * 0.66, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 1; g.strokeStyle = "rgba(0,0,0,.32)";
    g.beginPath(); g.arc(0, 0, r * 0.75, 0, Math.PI * 2); g.stroke();

    // 币面图案
    g.textAlign = "center"; g.textBaseline = "middle";
    g.font = "900 " + Math.round(r * 0.95) + "px system-ui, sans-serif";
    g.fillStyle = "rgba(0,0,0,.45)";
    g.fillText(def.glyph, 0, 1.4);
    g.fillStyle = def.color2;
    g.fillText(def.glyph, 0, 0);

    // 斜向镜面高光
    const hl = g.createLinearGradient(-r, -r, r * 0.35, r * 0.25);
    hl.addColorStop(0, "rgba(255,255,255,.8)");
    hl.addColorStop(0.4, "rgba(255,255,255,.05)");
    hl.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = hl;
    g.beginPath(); g.arc(0, 0, r * 0.9, 0, Math.PI * 2); g.fill();

    return { canvas: o.c, size: size, art: "disc" };
  }

  /* ---------------- 棱面钻石 ---------------- */
  function buildGem(def) {
    const r = def.r * 1.5, size = Math.ceil(r * 2 + 10);
    const o = newCv(size, size), g = o.g;
    g.translate(size / 2, size / 2 + 1);

    const tw = r * 0.5, hw = r * 0.95;
    const top = -r * 0.72, waist = -r * 0.08, tip = r * 0.95;

    g.fillStyle = def.ring;
    g.beginPath(); g.moveTo(-hw, waist); g.lineTo(hw, waist); g.lineTo(0, tip); g.closePath(); g.fill();
    g.fillStyle = def.color;
    g.beginPath(); g.moveTo(-hw, waist); g.lineTo(0, waist); g.lineTo(0, tip); g.closePath(); g.fill();

    const grd = g.createLinearGradient(-hw, top, hw, waist);
    grd.addColorStop(0, def.color2);
    grd.addColorStop(0.5, def.color);
    grd.addColorStop(1, def.ring);
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(-tw, top); g.lineTo(tw, top); g.lineTo(hw, waist); g.lineTo(-hw, waist); g.closePath();
    g.fill();

    g.strokeStyle = "rgba(255,255,255,.42)"; g.lineWidth = 1;
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

    g.fillStyle = "rgba(255,255,255,.72)";
    g.beginPath();
    g.moveTo(-tw * 0.75, top + r * 0.1); g.lineTo(-tw * 0.1, top + r * 0.06);
    g.lineTo(-hw * 0.5, waist - r * 0.06); g.lineTo(-hw * 0.72, waist - r * 0.2);
    g.closePath(); g.fill();

    return { canvas: o.c, size: size, art: "gem" };
  }

  /* ---------------- 伪 3D 宝箱 ---------------- */
  function buildChest(def) {
    const r = def.r * 1.25, size = Math.ceil(r * 2.6 + 12);
    const o = newCv(size, size), g = o.g;
    g.translate(size / 2, size / 2 + 2);

    const hw = r * 1.02;
    const bodyTop = -r * 0.18, bodyBot = r * 0.95;
    const d = r * 0.42;

    g.globalAlpha = 0.4; g.fillStyle = "#000";
    g.beginPath(); g.ellipse(0, bodyBot + r * 0.12, hw * 1.02, r * 0.3, 0, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1;

    // 右侧厚度
    g.fillStyle = def.ring;
    g.beginPath();
    g.moveTo(hw, bodyTop); g.lineTo(hw + d, bodyTop - d * 0.5);
    g.lineTo(hw + d, bodyBot - d * 0.5); g.lineTo(hw, bodyBot); g.closePath();
    g.fill();

    // 箱盖顶面
    g.fillStyle = def.color;
    g.beginPath();
    g.moveTo(-hw, bodyTop); g.lineTo(hw, bodyTop);
    g.lineTo(hw + d, bodyTop - d * 0.5); g.lineTo(-hw + d, bodyTop - d * 0.5);
    g.closePath(); g.fill();
    g.strokeStyle = "rgba(255,255,255,.3)"; g.lineWidth = 1; g.stroke();

    // 箱体正面
    const grd = g.createLinearGradient(0, bodyTop, 0, bodyBot);
    grd.addColorStop(0, def.color);
    grd.addColorStop(0.62, def.ring);
    grd.addColorStop(1, "#2b0f3d");
    g.fillStyle = grd;
    g.beginPath(); g.rect(-hw, bodyTop, hw * 2, bodyBot - bodyTop); g.fill();

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

    g.strokeStyle = "rgba(255,255,255,.45)"; g.lineWidth = 1.4;
    g.beginPath(); g.rect(-hw, bodyTop, hw * 2, bodyBot - bodyTop); g.stroke();

    return { canvas: o.c, size: size, art: "chest" };
  }

  /* ---------------- 伪 3D 金币塔 ---------------- */
  function buildTower(def) {
    const r = def.r * 1.15, size = Math.ceil(r * 2.8 + 14);
    const o = newCv(size, size), g = o.g;
    g.translate(size / 2, size / 2 + 3);

    const n = 5, stepY = r * 0.32, baseY = r * 0.78;

    g.globalAlpha = 0.42; g.fillStyle = "#000";
    g.beginPath(); g.ellipse(0, baseY + r * 0.22, r * 1.05, r * 0.32, 0, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1;

    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const rr = r * (1 - 0.1 * t);
      const y = baseY - i * stepY;
      g.fillStyle = def.ring;
      g.beginPath();
      g.moveTo(-rr, y - r * 0.14); g.lineTo(rr, y - r * 0.14);
      g.lineTo(rr, y + r * 0.1); g.lineTo(-rr, y + r * 0.1);
      g.closePath(); g.fill();
      const grd = g.createLinearGradient(-rr, y - r * 0.3, rr, y + r * 0.1);
      grd.addColorStop(0, def.color2);
      grd.addColorStop(0.55, def.color);
      grd.addColorStop(1, def.ring);
      g.fillStyle = grd;
      g.beginPath(); g.ellipse(0, y - r * 0.14, rr, r * 0.3, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = "rgba(255,255,255,.34)"; g.lineWidth = 1;
      g.beginPath(); g.ellipse(0, y - r * 0.14, rr * 0.72, r * 0.2, 0, 0, Math.PI * 2); g.stroke();
    }

    const topY = baseY - (n - 1) * stepY - r * 0.62;
    const grd2 = g.createRadialGradient(-r * 0.3, topY - r * 0.2, r * 0.1, 0, topY, r * 0.62);
    grd2.addColorStop(0, "#fff6d0");
    grd2.addColorStop(0.55, def.color);
    grd2.addColorStop(1, def.ring);
    g.fillStyle = grd2;
    g.beginPath(); g.arc(0, topY, r * 0.56, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "rgba(255,255,255,.5)"; g.lineWidth = 1.2;
    g.beginPath(); g.arc(0, topY, r * 0.56, 0, Math.PI * 2); g.stroke();

    return { canvas: o.c, size: size, art: "tower" };
  }

  function face(def) {
    if (faces[def.id]) return faces[def.id];
    let sp;
    if (def.art === "gem") sp = buildGem(def);
    else if (def.art === "chest") sp = buildChest(def);
    else if (def.art === "tower") sp = buildTower(def);
    else sp = buildDisc(def);
    faces[def.id] = sp;
    return sp;
  }

  /** 币的侧面厚度带：一张烘焙好的窄渐变图，翻转时按需拉伸 */
  function sideStrip(def) {
    if (strips[def.id]) return strips[def.id];
    const w = (def.r + 2) * 2, h = P.THICK + 3;
    const o = newCv(w, h), g = o.g;
    g.fillStyle = def.ring; g.fillRect(0, 0, w, h);
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, "rgba(255,255,255,.40)");
    grd.addColorStop(0.35, "rgba(255,255,255,.06)");
    grd.addColorStop(1, "rgba(0,0,0,.72)");
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    strips[def.id] = { canvas: o.c, w: w, h: h };
    return strips[def.id];
  }

  /** 稀有奖励的脉冲光晕（烘焙一次，主循环只 drawImage） */
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

  /** 稀有奖励的地面光环：一圈旋转虚线椭圆，满台币里一眼可见 */
  function heroRing(color) {
    const key = "ring:" + color;
    if (rings[key]) return rings[key];
    const s = 160;
    const c = document.createElement("canvas");
    c.width = c.height = s;
    const g = c.getContext("2d");
    g.translate(s / 2, s / 2);
    g.scale(1, 0.52);
    g.strokeStyle = color;
    g.lineWidth = 4;
    g.setLineDash([13, 9]);
    g.beginPath(); g.arc(0, 0, 58, 0, Math.PI * 2); g.stroke();
    g.setLineDash([]);
    g.globalAlpha = 0.45;
    g.lineWidth = 1.5;
    g.beginPath(); g.arc(0, 0, 68, 0, Math.PI * 2); g.stroke();
    rings[key] = c;
    return c;
  }

  /** 普通币：顶面 + 侧面 + 外缘 + 高光 */
  function drawDisc(ctx, def, sp, sc, st, sq) {
    const fl = P.coinFlip(st.flip);
    const rx = Math.max(0.6, def.r * sc * fl.flip);
    const ry = Math.max(0.6, def.r * sc * sq);
    const th = Math.max(1, P.THICK * sc * (0.34 + 0.66 * fl.edge));

    // 底部外缘：厚度的轮廓
    ctx.fillStyle = def.ring;
    ctx.beginPath(); ctx.ellipse(0, th, rx, ry, 0, 0, Math.PI * 2); ctx.fill();

    // 侧面
    const strip = sideStrip(def);
    ctx.drawImage(strip.canvas, -rx, 0, rx * 2, th);

    // 顶面
    ctx.drawImage(sp.canvas, -rx, -ry, rx * 2, ry * 2);

    // 下沿亮弧：把"金属"钉死
    ctx.strokeStyle = "rgba(255,255,255,.34)";
    ctx.lineWidth = Math.max(0.6, sc * 0.7);
    ctx.beginPath(); ctx.ellipse(0, 0, rx * 0.97, ry * 0.97, 0, Math.PI * 0.12, Math.PI * 0.88); ctx.stroke();
  }

  /** 立着的稀有奖励：轻微摇摆，不跟着自转（转起来像纸片） */
  function drawUpright(ctx, def, sp, sc, st, sq, nowT) {
    const seed = st.seed || 0;
    ctx.rotate(Math.sin(nowT * 2 + seed) * 0.05 + (st.tilt || 0) * 0.5);
    const s = sp.size;
    ctx.drawImage(sp.canvas, -s * sc / 2, -s * sc * sq / 2, s * sc, s * sc * sq);
  }

  /**
   * 画一枚币。
   * @param {object} st  视觉状态（CPPile 提供）：flip / tilt / seed
   * @param {number} sq  落地压扁（0~1）
   */
  function drawCoin(ctx, def, sx, sy, sc, st, sq, nowT) {
    const sp = face(def);
    ctx.save();
    ctx.translate(sx, sy);
    if (def.art === "disc") {
      if (st.tilt) ctx.rotate(st.tilt * 0.35);
      drawDisc(ctx, def, sp, sc, st, sq);
    } else {
      drawUpright(ctx, def, sp, sc, st, sq, nowT);
    }
    ctx.restore();
  }

  root.CPCoin = {
    setDpr: setDpr, clear: clear,
    face: face, halo: halo, heroRing: heroRing, sideStrip: sideStrip,
    drawCoin: drawCoin
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
