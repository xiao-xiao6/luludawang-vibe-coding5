/* ============================================================
 * 表现层：渲染 / 输入 / 面板 / 存档节奏
 * ============================================================ */
(function () {
  "use strict";

  const D = window.CPData, E = window.CPEngine, Fx = window.CPFx, Sfx = window.CPSfx;
  const L = window.CPLayout;

  const cv = document.getElementById("cv");
  const ctx = cv.getContext("2d");
  const W = 480, H = 580;

  let game = null;
  let hoverX = W / 2;
  let hasHover = false;
  let lastT = 0;
  let acc = 0;
  let saveAcc = 0;
  const FIXED = 1 / 120;

  let dpr = 1;
  let spriteDpr = Math.min(2, window.devicePixelRatio || 1);
  let mode = "wide";

  /* ---------------- 币精灵缓存 ---------------- */
  const sprites = {};
  function buildSprite(def) {
    const pad = 4;
    const r = def.r;
    const size = Math.ceil((r + pad) * 2);
    const c = document.createElement("canvas");
    c.width = c.height = Math.ceil(size * spriteDpr);
    const g = c.getContext("2d");
    g.scale(spriteDpr, spriteDpr);
    const cx = size / 2, cy = size / 2;

    g.save();
    g.translate(cx, cy);

    // 阴影
    g.globalAlpha = 0.35;
    g.fillStyle = "#000";
    g.beginPath(); g.ellipse(1.5, 2.5, r, r * 0.92, 0, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1;

    // 主体
    const grd = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.15, 0, 0, r * 1.05);
    grd.addColorStop(0, def.color2);
    grd.addColorStop(0.55, def.color);
    grd.addColorStop(1, def.ring);
    g.fillStyle = grd;
    g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();

    // 外圈
    g.lineWidth = 1.6;
    g.strokeStyle = def.ring;
    g.beginPath(); g.arc(0, 0, r - 0.8, 0, Math.PI * 2); g.stroke();

    // 内圈压印
    g.lineWidth = 1;
    g.strokeStyle = "rgba(255,255,255,.32)";
    g.beginPath(); g.arc(0, 0, r * 0.68, 0, Math.PI * 2); g.stroke();

    // 字符
    g.fillStyle = "rgba(0,0,0,.5)";
    g.font = "900 " + Math.round(r * 1.02) + "px system-ui, sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(def.glyph, 0, 1);
    g.fillStyle = def.color2;
    g.fillText(def.glyph, 0, 0);

    // 高光
    const hl = g.createLinearGradient(-r, -r, r * 0.3, r * 0.2);
    hl.addColorStop(0, "rgba(255,255,255,.75)");
    hl.addColorStop(0.45, "rgba(255,255,255,.06)");
    hl.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = hl;
    g.beginPath(); g.arc(0, 0, r - 1, 0, Math.PI * 2); g.fill();

    g.restore();
    return { canvas: c, size: size };
  }
  function sprite(kind) {
    if (!sprites[kind]) sprites[kind] = buildSprite(D.COIN_DEFS[kind]);
    return sprites[kind];
  }

  /* ---------------- 静态台面烘焙 ----------------
   * 网格 / 导轨 / 角沟 / 出币口 / PAYOUT 标签 / 推板渐变 / 推板前沿辉光
   * 全部预烘焙成离屏 canvas，主循环只做 drawImage ——
   * 不再每帧重建 3~4 个渐变、也不再每帧跑 shadowBlur。
   */
  let stageBake = null, stageKey = "";
  let plateGradBake = null, plateEdgeBake = null, plateBakeDpr = 0;

  function bakeStage() {
    const w = game.world;
    const face = w.plate.y;
    const gw = w.gutterWidth;
    const c = document.createElement("canvas");
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    const g = c.getContext("2d");
    g.scale(dpr, dpr);

    // 台面底
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#0d0b1e");
    bg.addColorStop(0.5, "#141029");
    bg.addColorStop(1, "#0a0818");
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);

    // 台面网格（透视暗示）
    g.strokeStyle = "rgba(120,150,255,.07)";
    g.lineWidth = 1;
    for (let y = face; y < w.payoutY; y += 34) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    }
    for (let x = 0; x <= W; x += 40) {
      g.beginPath(); g.moveTo(x, face); g.lineTo(x, w.payoutY); g.stroke();
    }

    // 两侧导轨
    const railGrad = g.createLinearGradient(0, 0, 16, 0);
    railGrad.addColorStop(0, "#2b2358");
    railGrad.addColorStop(1, "#151130");
    g.fillStyle = railGrad;
    g.fillRect(0, face, 10, w.payoutY - face);
    g.save();
    g.translate(W, 0); g.scale(-1, 1);
    g.fillStyle = railGrad;
    g.fillRect(0, face, 10, w.payoutY - face);
    g.restore();
    g.strokeStyle = "rgba(78,226,255,.28)";
    g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(10, face); g.lineTo(10, w.payoutY); g.stroke();
    g.beginPath(); g.moveTo(W - 10, face); g.lineTo(W - 10, w.payoutY); g.stroke();

    // 角沟（丢币口）
    const gy = w.payoutY - 52;
    g.fillStyle = "#04030a";
    g.fillRect(0, gy, gw, 52);
    g.fillRect(W - gw, gy, gw, 52);
    g.strokeStyle = "rgba(255,107,107,.5)";
    g.lineWidth = 1.2;
    g.strokeRect(0.5, gy + 0.5, gw, 52);
    g.strokeRect(W - gw - 0.5, gy + 0.5, gw, 52);
    // 危险斜纹
    g.save();
    g.beginPath();
    g.rect(0, gy, gw, 52);
    g.rect(W - gw, gy, gw, 52);
    g.clip();
    g.strokeStyle = "rgba(255,107,107,.22)";
    g.lineWidth = 5;
    for (let i = -60; i < W + 60; i += 14) {
      g.beginPath(); g.moveTo(i, gy + 60); g.lineTo(i + 60, gy - 10); g.stroke();
    }
    g.restore();

    // 出币口
    const pay = g.createLinearGradient(0, w.payoutY, 0, H);
    pay.addColorStop(0, "rgba(78,226,255,.16)");
    pay.addColorStop(1, "rgba(78,226,255,.02)");
    g.fillStyle = pay;
    g.fillRect(0, w.payoutY, W, H - w.payoutY);
    g.strokeStyle = "rgba(78,226,255,.55)";
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, w.payoutY); g.lineTo(W, w.payoutY); g.stroke();

    // PAYOUT 标签：优先用原生的 letterSpacing，跨平台字宽才稳定
    g.fillStyle = "rgba(78,226,255,.42)";
    g.font = "700 13px system-ui, sans-serif";
    g.textAlign = "center";
    const canSpace = "letterSpacing" in g;
    if (canSpace) g.letterSpacing = "2px";
    g.fillText("PAYOUT 出币口", W / 2, w.payoutY + 26);
    if (canSpace) g.letterSpacing = "0px";
    g.textAlign = "start";

    return c;
  }

  function bakePlateGrad() {
    const hh = Math.max(60, Math.round(game.world.plateMaxY));
    const c = document.createElement("canvas");
    c.width = Math.round(W * dpr); c.height = Math.round(hh * dpr);
    const g = c.getContext("2d");
    g.scale(dpr, dpr);
    const grd = g.createLinearGradient(0, 0, 0, hh);
    grd.addColorStop(0, "#3b3270");
    grd.addColorStop(0.62, "#2a2358");
    grd.addColorStop(1, "#463b8f");
    g.fillStyle = grd;
    g.fillRect(0, 0, W, hh);
    return { canvas: c, h: hh };
  }

  function bakePlateEdge() {
    const hh = 52, lineY = 40;
    const c = document.createElement("canvas");
    c.width = Math.round(W * dpr); c.height = Math.round(hh * dpr);
    const g = c.getContext("2d");
    g.scale(dpr, dpr);
    // 推板斜纹
    g.save();
    g.beginPath(); g.rect(0, 0, W, 34); g.clip();
    g.strokeStyle = "rgba(255,204,77,.16)";
    g.lineWidth = 6;
    for (let i = -60; i < W + 60; i += 18) {
      g.beginPath(); g.moveTo(i, 40); g.lineTo(i + 40, -6); g.stroke();
    }
    g.restore();
    // 推板前沿
    g.fillStyle = "#5b4bc4";
    g.fillRect(0, 36, W, 6);
    g.fillStyle = "rgba(78,226,255,.9)";
    g.fillRect(0, lineY, W, 2);
    // 辉光：烘焙一次，主循环里不再有 shadowBlur
    if (Fx.shadows) {
      g.save();
      g.shadowColor = "rgba(78,226,255,.9)";
      g.shadowBlur = 14;
      g.fillStyle = "rgba(160,245,255,.85)";
      g.fillRect(0, lineY, W, 2);
      g.restore();
    }
    return { canvas: c, h: hh, lineY: lineY };
  }

  function ensureBaked() {
    if (!game) return;
    const key = dpr + "|" + game.world.gutterWidth.toFixed(2) + "|" + game.world.payoutY;
    if (key !== stageKey) { stageBake = bakeStage(); stageKey = key; }
    if (plateBakeDpr !== dpr) {
      plateGradBake = bakePlateGrad();
      plateEdgeBake = bakePlateEdge();
      plateBakeDpr = dpr;
    }
  }

  /* ---------------- 台面绘制 ---------------- */
  function drawPlate() {
    const w = game.world;
    const face = w.plate.y;
    ctx.drawImage(plateGradBake.canvas, 0, 0, W, plateGradBake.h, 0, 0, W, face);
    ctx.drawImage(plateEdgeBake.canvas, 0, face - plateEdgeBake.lineY, W, plateEdgeBake.h);
    // 推板顶部标签
    ctx.fillStyle = "rgba(200,190,255,.35)";
    ctx.font = "700 12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("P U S H E R", W / 2, Math.max(16, face - 46));
    ctx.textAlign = "start";
  }

  // 每帧排序用的复用缓冲：不再每帧分配一个新数组
  const orderBuf = [];
  function drawCoins() {
    const coins = game.world.coins;
    orderBuf.length = coins.length;
    for (let i = 0; i < coins.length; i++) orderBuf[i] = coins[i];
    if (orderBuf.length > 1) orderBuf.sort((a, b) => a.y - b.y);
    for (let i = 0; i < orderBuf.length; i++) {
      const c = orderBuf[i];
      const sp = sprite(c.kind);
      const s = 0.35 + 0.65 * c.squash;
      const sc = sp.size;
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.scale(s, s);
      ctx.drawImage(sp.canvas, -sc / 2, -sc / 2, sc, sc);
      ctx.restore();

      if (c.spark > 0.02) {
        ctx.save();
        ctx.globalAlpha = c.spark * 0.75;
        ctx.strokeStyle = D.COIN_DEFS[c.kind].glow;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(c.x, c.y, c.r + 3 + (1 - c.spark) * 8, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
      if (c.stress > 1.5) {
        ctx.save();
        ctx.globalAlpha = Math.min(0.5, c.stress / 10);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
    }
  }

  /* 瞄准提示：横向点哪是哪（磁力/护栏升级的意义所在），
   * 纵向其实是 dropZone 里的随机带 —— 所以画成椭圆散布带，
   * 不再用一个 11px 小圆假装"纵向也能精瞄"。 */
  function drawAim() {
    if (!hasHover) return;
    const w = game.world;
    const z = w.dropZone;
    const x = Math.max(14, Math.min(W - 14, hoverX));
    const ry = Math.max(18, (z.y1 - z.y0) / 2);
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = "rgba(255,204,77,.55)";
    ctx.lineWidth = 1.4;
    ctx.setLineDash([6, 6]);
    ctx.beginPath(); ctx.moveTo(x, z.y0 + 8); ctx.lineTo(x, w.payoutY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = "rgba(255,233,168,.6)";
    ctx.beginPath(); ctx.ellipse(x, z.yMid, 12, ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = "rgba(255,233,168,.9)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(x, z.yMid, 12, ry, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(x, z.yMid, 4, ry * 0.35, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  function render() {
    if (!game) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ensureBaked();
    ctx.save();
    if (Fx.shake > 0.2) {
      ctx.translate((Math.random() - 0.5) * Fx.shake, (Math.random() - 0.5) * Fx.shake);
    }
    ctx.drawImage(stageBake, 0, 0, W, H);
    drawPlate();
    drawAim();
    drawCoins();
    Fx.draw(ctx);
    ctx.restore();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---------------- DOM ---------------- */
  const $ = (id) => document.getElementById(id);
  const elCoin = $("vCoin"), elGem = $("vGem"), elTix = $("vTix");
  const elCombo = $("comboBadge"), elJackpot = $("jackpotFx");
  const elTicker = $("ticker"), elLogList = $("logList"), elToasts = $("toasts");
  const elStageNote = $("stageNote"), elAutoLv = $("autoLv"), elTixLeft = $("tixLeft");
  const btnDrop = $("btnDrop"), btnAuto = $("btnAuto"), btnLottery = $("btnLottery");
  const btnMute = $("btnMute"), btnPause = $("btnPause"), btnBailout = $("btnBailout");
  const elCapText = $("capText"), elCapFill = $("capFill"), elCap = $("cap");

  // 安全区（刘海 / 底部指示条）：用一个隐藏探针实测，比读自定义属性可靠。
  // 这份数值由 JS 统一写进 CSS 变量，CSS 只负责落地 —— 只扣一次，不重复扣。
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

    // 高清档位变了就重烘焙币精灵与静态台面，避免糊边
    if (dpr !== spriteDpr) {
      spriteDpr = dpr;
      for (const k in sprites) delete sprites[k];
      plateBakeDpr = 0;
    }
    stageKey = "";

    const bw = Math.round(W * dpr), bh = Math.round(H * dpr);
    if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

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
    return "机台 · " + m.name + (game.paused ? " · 推板已暂停" : " · 推板运行中");
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

  function refreshHud(force) {
    if (!game) return;
    const st = game.st;
    if (force) for (const k in hudPrev) delete hudPrev[k];

    setText(elCoin, D.fmt(st.credits));
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
    const need = game.needBailout();
    setBool(btnBailout, "hidden", !need);

    // 容量条搬进 HUD：它是全局状态，不该挤在台面底部
    const w = game.world;
    const ratio = Math.min(1, w.coins.length / w.maxCoins);
    const lvl = ratio > 0.9 ? "red" : ratio > 0.7 ? "warn" : "ok";
    setText(elCapText, w.coins.length + "/" + w.maxCoins);
    if (hudPrev.capFill !== ratio) {
      hudPrev.capFill = ratio;
      elCapFill.style.width = (ratio * 100).toFixed(1) + "%";
    }
    if (hudPrev.capLvl !== lvl) {
      hudPrev.capLvl = lvl;
      elCap.className = "cap " + lvl;
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

  function handleEvents() {
    const evts = game.drainPending();
    for (let i = 0; i < evts.length; i++) {
      const e = evts[i];
      if (e.type === "drop") {
        Sfx.insert();
        Fx.ring(e.x == null ? W / 2 : e.x, game.world.dropZone.y1, "rgba(255,204,77,.5)");
      } else if (e.type === "pay") {
        const def = D.COIN_DEFS[e.kind];
        Sfx.pay(e.combo);
        Fx.burst(e.x, e.y - 12, def.glow, 10, Math.PI * 2, 150);
        if (e.gain > 0) {
          Fx.text(e.x, e.y - 20, "+" + e.gain, e.mul > 1 ? "#ffe9a8" : "#d8ffe6", e.mul >= 2 ? 19 : 15);
        } else if (e.kind === "chest") {
          // 宝箱走自己的反馈，不再共用 payout 通道飘出一个 "+0"
          Fx.text(e.x, e.y - 20, "宝箱！", "#e39bff", 17);
        }
        if (e.crit) {
          Fx.text(e.x + 12, e.y - 34, "暴击!", "#ff8ad8", 14);
          Fx.ring(e.x, e.y - 12, "rgba(255,94,196,.85)");
        }
        const lab = D.tierLabel(e.combo);
        if (e.mul >= 2) Fx.ring(e.x, e.y - 12, "rgba(255,233,168,.8)");
        // 徽章只在"跨档"时弹：不再每掉一枚币都弹一次
        if (lab && lab !== lastTierShown) {
          lastTierShown = lab;
          showCombo(e.combo, e.mul);
          Fx.shakeIt(2.2);
        } else if (!lab) {
          lastTierShown = "";
        }
        if (e.gem) {
          Fx.burst(e.x, e.y - 12, "#7ce8ff", 16, Math.PI * 2, 200);
          log("钻石币掉落 → 钻石 +" + e.gem, "good");
        }
        if (e.ticket) log("幸运币掉落 → 抽奖券 +" + e.ticket, "good");
      } else if (e.type === "gutter") {
        Sfx.gutter();
        Fx.burst(e.x, e.y - 10, "#ff6b6b", 6, Math.PI, 110);
      } else if (e.type === "jackpot") {
        Sfx.jackpot();
        Fx.shakeIt(12);
        Fx.burst(W / 2, 300, "#ffcc4d", 60, Math.PI * 2, 340);
        showJackpot();
        log("★ JACKPOT ★ 宝箱开启，额外 +" + D.fmt(e.bonus) + " 金币，并撒下 " + e.coins + "/" + e.total + " 枚币" +
          (e.refund ? "（台面已满，折算补偿 +" + D.fmt(e.refund) + "）" : "") + "！", "big");
        toast("JACKPOT +" + D.fmt(e.bonus), "win", "🎉");
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
      } else if (e.type === "prestige") {
        Sfx.jackpot();
        Fx.shakeIt(10);
        const m = D.modById(e.mod);
        log("换机台成功 → 第 " + e.level + " 台「" + m.name + "」：" + m.desc, "big");
        toast("换机台 · " + m.name, "win", "🎰");
        ticker(idleTicker(), false);
      } else if (e.type === "pause") {
        log(e.paused ? "推板已暂停" : "推板继续运行", "sys");
        ticker(idleTicker(), false);
      } else if (e.type === "deny") {
        throttledDeny();
        if (e.id === "insert") {
          ticker("金币不足 · 领救济金或等机台赠送", true);
        } else if (e.id === "lottery") {
          ticker("抽奖需要 5 张券（当前 " + game.st.tickets + " 张）", true);
        } else if (e.id === "prestige") {
          ticker("换机台需要累计收益 " + D.fmt(game.prestigeNeed()) + " ◎", true);
        } else {
          ticker("条件不满足", true);
        }
      } else if (e.type === "full") {
        ticker("台面满了！先推落一些币吧", true);
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
  function showJackpot() {
    elJackpot.innerHTML = "<span>JACKPOT!</span>";
    elJackpot.classList.add("on");
    jpTimer = 2.0;
  }

  /* ---------------- 主循环 ---------------- */
  function frame(t) {
    requestAnimationFrame(frame);
    if (!lastT) lastT = t;
    let dt = (t - lastT) / 1000;
    lastT = t;
    if (dt > 0.25) dt = 0.25;

    acc += dt;
    let guard = 0;
    while (acc >= FIXED && guard++ < 12) {
      game.step(FIXED);
      acc -= FIXED;
    }
    handleEvents();
    Fx.update(dt);

    if (comboTimer > 0) { comboTimer -= dt; if (comboTimer <= 0) elCombo.classList.remove("on"); }
    if (jpTimer > 0) { jpTimer -= dt; if (jpTimer <= 0) elJackpot.classList.remove("on"); }
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

  /* ---------------- 输入 ---------------- */
  function canvasX(clientX) {
    const r = cv.getBoundingClientRect();
    return (clientX - r.left) / r.width * W;
  }
  function doDrop(x) {
    Sfx.ensure();
    const n = game.insert(x);
    if (n && elStageNote && !elStageNote.classList.contains("hide")) elStageNote.classList.add("hide");
  }

  cv.addEventListener("pointermove", (e) => {
    hoverX = canvasX(e.clientX);
    hasHover = true;
  });
  cv.addEventListener("pointerleave", () => { hasHover = false; });
  cv.addEventListener("pointercancel", () => { hasHover = false; });
  cv.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    hoverX = canvasX(e.clientX);
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
      ["救济金次数", D.fmt(t.bailouts)],
      ["满台折算补偿", D.fmt(t.refunds) + " ◎"],
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
    // 概率公开：抽奖奖池直接读代码里那张表，不会出现"公示概率和实现不一致"
    h += '</div><div class="sep"></div><p class="h">抽奖概率（' + D.LOTTERY_TICKET_COST + ' 张券 / 次）</p><div class="stat-grid">';
    for (const row of D.LOTTERY_TABLE) {
      h += '<span class="k">' + row.label + "</span><span class=\"v\">" + Math.round(row.p * 100) + "%</span>";
    }
    h += '<span class="k">连击判定</span><span class="v">' + D.COMBO_WINDOW + "s 内推落 " + D.COMBO_TIERS.map((t) => t.n).join("/") +
      " 枚 → ×" + D.COMBO_TIERS.map((t) => t.mul).join("/") + "（滑动窗口计数）</span>";
    h += '<span class="k">暴击芯片</span><span class="v">每级 +10% 概率触发 ×' + D.CRIT_MULT + "（满级 30%）</span>";
    h += '<span class="k">宝箱出现率</span><span class="v">' +
      (D.chestChance(game.upLevel("luck") + game.modifierDef().luck) * 100).toFixed(2) +
      "% / 次补给（冷却 " + D.CHEST.cooldown + "s）</span>";
    h += "</div><div class=\"sep\"></div>" +
      '<div class="card"><div class="top"><span class="icon">?</span><span class="name">玩法速记</span></div>' +
      '<div class="desc">点击台面任意位置投币，币会落到推板前方。<br>' +
      "推板往复把币往前推，掉进最前方的出币口就是收益，掉进左右两角的黑槽会丢币。<br>" +
      "连续推落会累积连击倍率（连得越高窗口越短）；宝箱币推落后触发 JACKPOT。<br>" +
      "金币见底时机台会自动赠送救济金，也可以点「领救济金」立刻领取。<br>" +
      "快捷键：空格投币 / A 自动 / L 抽奖 / P 暂停推板 / Esc 关闭面板。</div></div>";
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

    // 先尝试读档，再决定要不要撒开场币 ——
    // 不再出现"建对象时撒 170 枚 + boot 又撒一次 = 237/260 开局爆红"
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
    refreshHud(true);
    syncMuteBtn();

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
    window.__CP = { game: game, Fx: Fx, Sfx: Sfx, render: render, layout: L, fit: fit, modeOf: () => mode };

    requestAnimationFrame(frame);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
