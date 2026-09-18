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

  /* ---------------- 币精灵缓存 ---------------- */
  const sprites = {};
  function buildSprite(def) {
    const pad = 4;
    const r = def.r;
    const size = Math.ceil((r + pad) * 2);
    const dpr = spriteDpr;
    const c = document.createElement("canvas");
    c.width = c.height = Math.ceil(size * dpr);
    const g = c.getContext("2d");
    g.scale(dpr, dpr);
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
    return { canvas: c, size: size, dpr: dpr };
  }
  function sprite(kind) {
    if (!sprites[kind]) sprites[kind] = buildSprite(D.COIN_DEFS[kind]);
    return sprites[kind];
  }

  /* ---------------- 台面绘制 ---------------- */
  function drawMachine() {
    const w = game.world;
    const face = w.plate.y;
    const gw = w.gutterWidth;

    // 台面底
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#0d0b1e");
    bg.addColorStop(0.5, "#141029");
    bg.addColorStop(1, "#0a0818");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // 台面网格（透视暗示）
    ctx.save();
    ctx.strokeStyle = "rgba(120,150,255,.07)";
    ctx.lineWidth = 1;
    for (let y = face; y < w.payoutY; y += 34) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    for (let x = 0; x <= W; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, face); ctx.lineTo(x, w.payoutY); ctx.stroke();
    }
    ctx.restore();

    // 两侧导轨
    const railGrad = ctx.createLinearGradient(0, 0, 16, 0);
    railGrad.addColorStop(0, "#2b2358");
    railGrad.addColorStop(1, "#151130");
    ctx.fillStyle = railGrad;
    ctx.fillRect(0, face, 10, w.payoutY - face);
    ctx.save();
    ctx.translate(W, 0); ctx.scale(-1, 1);
    ctx.fillStyle = railGrad;
    ctx.fillRect(0, face, 10, w.payoutY - face);
    ctx.restore();
    ctx.strokeStyle = "rgba(78,226,255,.28)";
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(10, face); ctx.lineTo(10, w.payoutY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W - 10, face); ctx.lineTo(W - 10, w.payoutY); ctx.stroke();

    // 角沟（丢币口）
    const gy = w.payoutY - 52;
    ctx.fillStyle = "#04030a";
    ctx.fillRect(0, gy, gw, 52);
    ctx.fillRect(W - gw, gy, gw, 52);
    ctx.strokeStyle = "rgba(255,107,107,.5)";
    ctx.lineWidth = 1.2;
    ctx.strokeRect(0.5, gy + 0.5, gw, 52);
    ctx.strokeRect(W - gw - 0.5, gy + 0.5, gw, 52);
    // 危险斜纹
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, gy, gw, 52);
    ctx.rect(W - gw, gy, gw, 52);
    ctx.clip();
    ctx.strokeStyle = "rgba(255,107,107,.22)";
    ctx.lineWidth = 5;
    for (let i = -60; i < W + 60; i += 14) {
      ctx.beginPath(); ctx.moveTo(i, gy + 60); ctx.lineTo(i + 60, gy - 10); ctx.stroke();
    }
    ctx.restore();

    // 出币口
    const pay = ctx.createLinearGradient(0, w.payoutY, 0, H);
    pay.addColorStop(0, "rgba(78,226,255,.16)");
    pay.addColorStop(1, "rgba(78,226,255,.02)");
    ctx.fillStyle = pay;
    ctx.fillRect(0, w.payoutY, W, H - w.payoutY);
    ctx.strokeStyle = "rgba(78,226,255,.55)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, w.payoutY); ctx.lineTo(W, w.payoutY); ctx.stroke();
    ctx.fillStyle = "rgba(78,226,255,.42)";
    ctx.font = "700 13px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("P A Y O U T   出 币 口", W / 2, w.payoutY + 26);
    ctx.textAlign = "start";

    // 推板
    const plateGrad = ctx.createLinearGradient(0, 0, 0, face);
    plateGrad.addColorStop(0, "#3b3270");
    plateGrad.addColorStop(0.62, "#2a2358");
    plateGrad.addColorStop(1, "#463b8f");
    ctx.fillStyle = plateGrad;
    ctx.fillRect(0, 0, W, face);
    // 推板斜纹
    ctx.save();
    ctx.beginPath(); ctx.rect(0, Math.max(0, face - 34), W, 34); ctx.clip();
    ctx.strokeStyle = "rgba(255,204,77,.16)";
    ctx.lineWidth = 6;
    for (let i = -60; i < W + 60; i += 18) {
      ctx.beginPath(); ctx.moveTo(i, face + 6); ctx.lineTo(i + 40, face - 40); ctx.stroke();
    }
    ctx.restore();
    // 推板前沿
    ctx.fillStyle = "#5b4bc4";
    ctx.fillRect(0, face - 6, W, 6);
    ctx.fillStyle = "rgba(78,226,255,.9)";
    ctx.fillRect(0, face - 2, W, 2);
    ctx.save();
    ctx.shadowColor = "rgba(78,226,255,.9)";
    ctx.shadowBlur = 14;
    ctx.fillStyle = "rgba(160,245,255,.85)";
    ctx.fillRect(0, face - 2, W, 2);
    ctx.restore();
    // 推板顶部标签
    ctx.fillStyle = "rgba(200,190,255,.35)";
    ctx.font = "700 12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("P U S H E R", W / 2, Math.max(16, face - 46));
    ctx.textAlign = "start";
  }

  function drawCoins() {
    const coins = game.world.coins;
    const sorted = coins.slice().sort((a, b) => a.y - b.y);
    for (let i = 0; i < sorted.length; i++) {
      const c = sorted[i];
      const sp = sprite(c.kind);
      const s = 0.35 + 0.65 * c.squash;
      const sc = sp.size;   // 逻辑尺寸；精灵内部已按 dpr 放大，这里不能再除一次
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

  function drawAim() {
    if (!hasHover) return;
    const w = game.world;
    const z = w.dropZone;
    const x = Math.max(14, Math.min(W - 14, hoverX));
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = "rgba(255,204,77,.55)";
    ctx.lineWidth = 1.4;
    ctx.setLineDash([6, 6]);
    ctx.beginPath(); ctx.moveTo(x, z.y1 + 8); ctx.lineTo(x, w.payoutY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = "rgba(255,233,168,.9)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, z.yMid, 11, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  function drawCapacity() {
    const w = game.world;
    const ratio = Math.min(1, w.coins.length / w.maxCoins);
    const bw = 132, bh = 6;
    const bx = W - bw - 12, by = H - 16;
    ctx.fillStyle = "rgba(0,0,0,.5)";
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = ratio > 0.85 ? "#ff6b6b" : ratio > 0.6 ? "#ffcc4d" : "#5ce68a";
    ctx.fillRect(bx, by, bw * ratio, bh);
    ctx.strokeStyle = "rgba(255,255,255,.2)";
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw, bh);
    ctx.fillStyle = "rgba(220,215,255,.7)";
    ctx.font = "600 10px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText("台面 " + w.coins.length + "/" + w.maxCoins, bx - 6, by + 6.5);
    ctx.textAlign = "start";
  }

  function render() {
    const w = game.world;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    if (Fx.shake > 0.2) {
      ctx.translate((Math.random() - 0.5) * Fx.shake, (Math.random() - 0.5) * Fx.shake);
    }
    drawMachine();
    drawAim();
    drawCoins();
    Fx.draw(ctx);
    ctx.restore();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawCapacity();
  }

  /* ---------------- DOM ---------------- */
  const $ = (id) => document.getElementById(id);
  const elCoin = $("vCoin"), elGem = $("vGem"), elTix = $("vTix");
  const elCombo = $("comboBadge"), elJackpot = $("jackpotFx");
  const elTicker = $("ticker"), elLog = $("log"), elToasts = $("toasts");
  const elStageNote = $("stageNote"), elAutoLv = $("autoLv"), elTixLeft = $("tixLeft");
  const btnDrop = $("btnDrop"), btnAuto = $("btnAuto"), btnLottery = $("btnLottery");
  const btnMute = $("btnMute");

  let dpr = 1;
  let spriteDpr = Math.min(2, window.devicePixelRatio || 1);
  let mode = "wide";

  // 安全区（刘海 / 底部指示条）：用一个隐藏探针实测，比读自定义属性可靠
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

    // 高清档位变了就重烘焙币精灵，避免糊边
    if (dpr !== spriteDpr) {
      spriteDpr = dpr;
      for (const k in sprites) delete sprites[k];
    }

    const bw = Math.round(W * dpr), bh = Math.round(H * dpr);
    if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 触屏端没有空格键，提示语要换
    if (elStageNote) {
      elStageNote.textContent = (p.mode === "narrow" || p.mode === "compact")
        ? "点台面投币 · 拖动可瞄准" : "点击台面投币 · 空格也行";
    }
    if (game) render();
  }

  const logs = [];
  function log(text, cls) {
    logs.unshift({ text: text, cls: cls || "" });
    if (logs.length > 60) logs.pop();
    renderLog();
  }
  function renderLog() {
    let html = "<h3>Event Log</h3><ul>";
    for (let i = 0; i < logs.length; i++) {
      html += '<li class="' + logs[i].cls + '">' + esc(logs[i].text) + "</li>";
    }
    html += "</ul>";
    elLog.innerHTML = html;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  let tickerTimer = 0;
  function ticker(text, hot) {
    elTicker.textContent = text;
    elTicker.classList.toggle("hot", !!hot);
    tickerTimer = 2.4;
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

  function refreshHud() {
    const st = game.st;
    elCoin.textContent = D.fmt(st.credits);
    elGem.textContent = D.fmt(st.gems);
    elTix.textContent = D.fmt(st.tickets);
    elAutoLv.textContent = st.auto ? ("Lv" + game.autoLvl()) : "关";
    btnAuto.setAttribute("aria-pressed", st.auto ? "true" : "false");
    elTixLeft.textContent = st.tickets + "/5";
    btnLottery.disabled = st.tickets < 5;
    btnDrop.disabled = st.credits < 1;
  }

  /* ---------------- 事件处理 ---------------- */
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
        Fx.text(e.x, e.y - 20, "+" + e.gain, e.mul > 1 ? "#ffe9a8" : "#d8ffe6", e.mul >= 2 ? 19 : 15);
        if (e.mul >= 2) {
          Fx.ring(e.x, e.y - 12, "rgba(255,233,168,.8)");
          showCombo(e.combo, e.mul);
        }
        if (e.combo >= 4 && e.combo % 2 === 0) Fx.shakeIt(1.4);
        if (def.gem) Fx.burst(e.x, e.y - 12, "#7ce8ff", 16, Math.PI * 2, 200);
        if (def.ticket) log("幸运币掉落 → 抽奖券 +1", "good");
      } else if (e.type === "gutter") {
        Sfx.gutter();
        Fx.burst(e.x, e.y - 10, "#ff6b6b", 6, Math.PI, 110);
      } else if (e.type === "jackpot") {
        Sfx.jackpot();
        Fx.shakeIt(12);
        Fx.burst(W / 2, 300, "#ffcc4d", 60, Math.PI * 2, 340);
        showJackpot();
        log("★ JACKPOT ★ 宝箱开启，额外 +" + D.fmt(e.bonus) + " 金币，并撒下 " + e.coins + " 枚币！", "big");
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
      } else if (e.type === "deny") {
        Sfx.deny();
        if (e.id === "insert") ticker("金币不足，先卖点币或等救济金～", true);
        else if (e.id === "lottery") ticker("抽奖需要 5 张券", true);
        else ticker("条件不满足", true);
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
    if (tickerTimer > 0) { tickerTimer -= dt; if (tickerTimer <= 0) elTicker.classList.remove("hot"); }

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
    if (n) {
      if (elStageNote && !elStageNote.classList.contains("hide")) elStageNote.classList.add("hide");
    }
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
  btnMute.addEventListener("click", () => {
    const on = btnMute.getAttribute("aria-pressed") !== "true";
    btnMute.setAttribute("aria-pressed", on ? "true" : "false");
    btnMute.textContent = on ? "🔊" : "🔇";
    Sfx.toggle(on);
    if (on) Sfx.ensure();
  });

  window.addEventListener("keydown", (e) => {
    const tag = (e.target && e.target.tagName) || "";
    const inField = /INPUT|TEXTAREA|SELECT/.test(tag) || (e.target && e.target.isContentEditable);
    if (e.key === "Escape") { closeModal(); return; }
    if (inField) return;
    if (e.code === "Space" || e.key === " ") {
      e.preventDefault();
      doDrop(hasHover ? hoverX : W / 2);
    } else if (e.key === "a" || e.key === "A") {
      btnAuto.click();
    } else if (e.key === "l" || e.key === "L") {
      if (!btnLottery.disabled) btnLottery.click();
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
    const f = modalBody.querySelector("button");
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
    const items = overlay.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
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

  function shopHTML() {
    let h = '<p class="h">金币升级</p><div class="grid">';
    for (const u of D.UPGRADES) {
      const lv = game.upLevel(u.id), max = lv >= u.max;
      const cost = game.upCost(u.id);
      const can = game.canBuy(u.id);
      h += '<div class="card"><div class="top"><span class="icon">' + u.icon + '</span>' +
        '<span class="name">' + u.name + "</span>" + pips(lv, u.max) +
        '<span class="lv">Lv ' + lv + "/" + u.max + "</span></div>" +
        '<div class="desc">' + u.desc + "</div>" +
        '<div class="row"><button type="button" data-up="' + u.id + '"' + (can ? "" : " disabled") + ">" +
        (max ? "已满级" : "升级 · " + D.fmt(cost) + " ◎") + "</button>" +
        (max ? "" : '<span class="desc">持有 ' + D.fmt(game.st.credits) + "</span>") +
        "</div></div>";
    }
    h += '</div><div class="sep"></div><p class="h">钻石升级</p><div class="grid">';
    for (const u of D.GEM_UPGRADES) {
      const lv = game.gemLevel(u.id), max = lv >= u.max;
      const cost = game.gemCost(u.id);
      const can = game.canBuyGem(u.id);
      h += '<div class="card"><div class="top"><span class="icon">' + u.icon + '</span>' +
        '<span class="name">' + u.name + "</span>" + pips(lv, u.max, true) +
        '<span class="lv">Lv ' + lv + "/" + u.max + "</span></div>" +
        '<div class="desc">' + u.desc + "</div>" +
        '<div class="row"><button type="button" data-gem="' + u.id + '"' + (can ? "" : " disabled") + ">" +
        (max ? "已满级" : "升级 · " + cost + " ◆") + "</button>" +
        '<span class="desc">持有 ' + game.st.gems + " ◆</span>" +
        "</div></div>";
    }
    h += '</div><div class="sep"></div>' +
      '<div class="card"><div class="top"><span class="icon">↺</span><span class="name">重置存档</span></div>' +
      '<div class="desc">清空所有进度，重新开始。此操作不可撤销。</div>' +
      '<div class="row"><button type="button" class="danger" data-act="reset">确认重置</button></div></div>';
    return h;
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
    const rows = [
      ["累计投币次数", D.fmt(t.drops)],
      ["累计投入币数", D.fmt(t.dropped)],
      ["累计推落币数", D.fmt(t.paid)],
      ["掉进角沟", D.fmt(t.lost)],
      ["累计收益", D.fmt(t.earned) + " ◎"],
      ["累计消耗", D.fmt(t.spent) + " ◎"],
      ["净收益", D.fmt(t.earned - t.spent) + " ◎"],
      ["最高连击", D.fmt(t.bestCombo) + " 枚"],
      ["单次最高收益", D.fmt(t.bestPayout) + " ◎"],
      ["宝箱次数", D.fmt(t.jackpots)],
      ["救济金次数", D.fmt(t.bailouts)],
      ["游玩时长", mins + " 分 " + Math.floor(t.playTime % 60) + " 秒"]
    ];
    let h = '<p class="h">总览</p><div class="stat-grid">';
    for (const r of rows) h += '<span class="k">' + r[0] + '</span><span class="v">' + r[1] + "</span>";
    h += '</div><div class="sep"></div><p class="h">各币种推落</p><div class="stat-grid">';
    for (const id of D.COIN_ORDER) {
      const def = D.COIN_DEFS[id];
      h += '<span class="k">' + def.name + "</span><span class=\"v\">" + D.fmt(t.kinds[id] || 0) + "</span>";
    }
    h += "</div><div class=\"sep\"></div>" +
      '<div class="card"><div class="top"><span class="icon">?</span><span class="name">玩法速记</span></div>' +
      '<div class="desc">点击台面任意位置投币，币会落到推板前方。<br>' +
      "推板往复把币往前推，掉进最前方的出币口就是收益，掉进左右两角的黑槽会丢币。<br>" +
      "连续推落会累积连击倍率；宝箱币推落后触发 JACKPOT。<br>" +
      "快捷键：空格投币 / A 自动 / L 抽奖 / Esc 关闭面板。</div></div>";
    return h;
  }

  $("btnShop").addEventListener("click", () => openModal("升级商店", shopHTML()));
  $("btnAch").addEventListener("click", () => openModal("成就", achHTML()));
  $("btnStat").addEventListener("click", () => openModal("统计与玩法", statHTML()));

  modalBody.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.up) {
      game.buy(b.dataset.up);
      handleEvents(); refreshHud();
      modalBody.innerHTML = shopHTML();
    } else if (b.dataset.gem) {
      game.buyGem(b.dataset.gem);
      handleEvents(); refreshHud();
      modalBody.innerHTML = shopHTML();
    } else if (b.dataset.act === "reset") {
      if (b.dataset.confirm === "1") {
        game.reset();
        Fx.clear();
        logs.length = 0;
        log("存档已重置，机台重新装满。", "sys");
        toast("存档已重置", "ach", "↺");
        closeModal();
        refreshHud();
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
    game = E.createGame();

    const loaded = game.load();
    if (!loaded) {
      game.seedField(170, 2);
      log("欢迎来到推币机！点击台面投币开始。", "sys");
      toast("欢迎！点台面投币", "ach", "🪙");
    } else {
      log("读取存档成功，欢迎回来。", "sys");
    }
    game.applyUpgrades();
    refreshHud();
    renderLog();
    ticker("点击台面投币 · 空格也行", false);

    window.addEventListener("resize", fit);
    window.addEventListener("orientationchange", fit);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", fit);
    window.addEventListener("pagehide", () => game.save());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { game.save(); Sfx.toggle(false); }
      else { Sfx.toggle(btnMute.getAttribute("aria-pressed") === "true"); lastT = 0; }
    });

    // 调试钩子
    window.__CP = { game: game, Fx: Fx, Sfx: Sfx, render: render, layout: L, fit: fit, modeOf: () => mode };

    requestAnimationFrame(frame);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
