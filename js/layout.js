/* ============================================================
 * 双端适配内核：视口分级 / 台面尺寸 / 高清与性能档位
 * 纯函数、零 DOM 依赖，可在 node 里 headless 跑自检。
 * 桌面 / 笔记本 / 平板 / 手机横竖屏共用同一套判定，
 * 避免「电脑正常、手机炸布局」这种两套代码打架的情况。
 * ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.CPLayout = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const AR = 480 / 580;        // 台面逻辑宽高比（与 index.html 的 canvas 一致）
  const MIN_TOUCH = 44;        // 最小可点区域（iOS HIG / Material 的公共下限）
  const MIN_STAGE = 120;       // 台面最小显示宽度，再小就没法玩了
  const MAX_DPR = 2;           // 画布高清档位上限（再高只是白烧 GPU）

  const GAP = 18;              // .app 列间距（宽松）
  const GAP_TIGHT = 8;         // .app 列间距（紧凑）
  const LOG_COL = 300;         // 宽屏右侧日志列宽
  const LOG_COL_COMPACT = 200; // 横屏矮窗口的日志列宽
  const LOG_MIN_VW = 760;      // 横屏窄于此就收起日志，把宽度让给台面
  const PAD_COL = 168;         // 横屏紧凑布局里操作按钮列宽
  const CAB_PAD = 12;          // .cab 内边距
  const PAGE_PAD = { wide: 18, stack: 10, narrow: 10, compact: 8 };
  const MAX_CAB = { wide: 520, stack: 600, narrow: 600, compact: 9999 };
  // 机柜内「除台面外」占掉的纵向高度（页边距 + HUD + 操作区 + 状态条）的保守估计
  // compact 档的 HUD / 操作区都在右侧列里，几乎不占台面的纵向空间
  const CHROME = { wide: 250, stack: 250, narrow: 300, compact: 64 };

  const MODES = ["wide", "stack", "narrow", "compact"];

  /* ---------------- 视口分级 ---------------- */
  // wide    桌面 / 平板横屏：机柜 + 日志双列
  // stack   平板竖屏 / 大屏手机：单列，日志折到机柜下方
  // narrow  小屏手机：单列 + 操作区两行 + 大触控按钮
  // compact 手机横屏 / 矮窗口：台面在左、HUD 与操作在右，日志视宽度取舍
  function pickMode(vw, vh) {
    if (vw > vh && vh > 0 && vh <= 560) return "compact";
    if (vw >= 861) return "wide";
    if (vw <= 480) return "narrow";
    return "stack";
  }

  /* ---------------- 日志列位置 ---------------- */
  // col   右侧独立列（宽屏 / 够宽的横屏）
  // below 折到机柜下方（平板竖屏 / 手机竖屏）
  // off   完全收起，宽度让给台面（窄横屏）
  function logMode(mode, vw) {
    if (mode === "wide") return "col";
    if (mode === "compact") return vw >= LOG_MIN_VW ? "col" : "off";
    return "below";
  }

  // 日志占用的横向宽度：只有 col 模式才吃宽度
  function logWidth(mode, vw) {
    const m = logMode(mode, vw);
    if (m === "col") return mode === "compact" ? LOG_COL_COMPACT : LOG_COL;
    return 0;
  }

  /* ---------------- 机柜可用宽度上限 ---------------- */
  function cabWidth(mode, vw) {
    const pad = PAGE_PAD[mode] == null ? 18 : PAGE_PAD[mode];
    let w;
    if (mode === "wide") {
      const shell = Math.min(960, vw) - pad * 2;   // .app 的 max-width:960
      w = shell - GAP - LOG_COL;
    } else if (mode === "compact") {
      const logW = logWidth(mode, vw);
      w = vw - pad * 2 - (logW ? logW + GAP_TIGHT : 0);
    } else {
      w = Math.min(620, vw) - pad * 2;
    }
    const cap = MAX_CAB[mode] == null ? 520 : MAX_CAB[mode];
    return Math.max(240, Math.min(cap, w));
  }

  /* ---------------- 机柜里非台面部分的纵向占用 ----------------
   * 注意：**不包含安全区**。上下安全区由 plan() 从可用高度里扣一次，
   * CSS 只负责把内容摆进安全区内 —— 同一份刘海空间只扣一次，
   * 不会出现“刘海屏上台面比实际可用空间还小”的重复扣除（M7）。 */
  function chromeFor(mode, o) {
    o = o || {};
    const base = CHROME[mode] == null ? 212 : CHROME[mode];
    return base + (o.extra || 0);
  }

  /* ---------------- 台面显示尺寸 ---------------- */
  // 先按宽度铺满，再按可用高度回收；宽高比永远不变（宁可小，不可变形）
  function fitStage(o) {
    const vw = Math.max(1, o.vw || 1);
    const vh = Math.max(1, o.vh || 0);
    const chrome = o.chrome || 0;
    const gutter = o.gutter || 0;
    const maxW = o.maxW == null ? Infinity : o.maxW;

    const availH = Math.max(MIN_STAGE / AR, vh - chrome);
    let w = Math.min(maxW, vw - gutter);
    let h = w / AR;
    if (h > availH) { h = availH; w = h * AR; }
    if (w < MIN_STAGE) { w = MIN_STAGE; h = w / AR; }
    return { w: Math.round(w), h: Math.round(h), availH: Math.round(availH) };
  }

  /* ---------------- 性能档位 ---------------- */
  // 低端机自动降特效，桌面保留全特效；DPR 上限统一由这里说了算
  function perfTier(h) {
    h = h || {};
    const mem = h.deviceMemory == null ? 4 : h.deviceMemory;
    const cores = h.cores == null ? 4 : h.cores;
    const dpr = h.dpr == null ? 1 : h.dpr;
    const area = (h.vw || 0) * (h.vh || 0);

    let tier = "high";
    if (mem <= 2 || cores <= 3) tier = "low";
    else if (mem <= 4 || cores <= 6) tier = "mid";

    const conf = {
      low: { quality: 0.45, dprCap: 1.5, maxParts: 90, particles: false, shadows: false },
      mid: { quality: 0.72, dprCap: 2, maxParts: 220, particles: true, shadows: true },
      high: { quality: 1, dprCap: 2, maxParts: 420, particles: true, shadows: true }
    }[tier];

    // 高分屏 + 大屏面积的组合再压一档：画布 backing store 别失控
    if (dpr >= 3 && area >= 1920 * 1080) conf.dprCap = 1.5;

    return {
      tier: tier,
      quality: conf.quality,
      dprCap: conf.dprCap,
      maxParts: conf.maxParts,
      particles: conf.particles,
      shadows: conf.shadows
    };
  }

  /* ---------------- 一次性出方案 ---------------- */
  function plan(o) {
    o = o || {};
    const rawW = Math.max(1, o.vw || 1);
    const rawH = Math.max(1, o.vh || 1);
    const vw = Math.max(1, rawW - (o.safeLeft || 0) - (o.safeRight || 0));  // 左右安全区：只在这里扣一次
    const vh = Math.max(1, rawH - (o.safeTop || 0) - (o.safeBottom || 0));  // 上下安全区：同样只扣一次
    const mode = o.mode || pickMode(rawW, rawH);   // 横竖屏看物理视口，不看被安全区压缩后的宽度
    const pad = PAGE_PAD[mode] == null ? 18 : PAGE_PAD[mode];
    const chrome = o.chrome == null ? chromeFor(mode, o) : o.chrome;
    const logW = logWidth(mode, vw);

    let cabW, stage;
    if (mode === "compact") {
      // 紧凑档：台面受高度约束，机柜宽度由「实际台面 + 操作列」反推，避免留一大块空白
      const stageMaxW = vw - pad * 2 - (logW ? logW + GAP_TIGHT : 0) - CAB_PAD * 2 - GAP_TIGHT - PAD_COL;
      stage = fitStage({ vw: stageMaxW, vh: vh, chrome: chrome });
      cabW = stage.w + CAB_PAD * 2 + GAP_TIGHT + PAD_COL;
    } else {
      cabW = cabWidth(mode, vw);
      const stageMaxW = cabW - CAB_PAD * 2;
      stage = fitStage({ vw: stageMaxW, vh: vh, chrome: chrome, maxW: stageMaxW });
    }

    const perf = perfTier({ vw: vw, vh: vh, dpr: o.dpr, deviceMemory: o.deviceMemory, cores: o.cores });
    const dpr = Math.max(1, Math.min(perf.dprCap, o.dpr || 1));

    return {
      mode: mode,
      logMode: logMode(mode, vw),
      chrome: Math.round(chrome),
      cabWidth: Math.round(cabW),
      logWidth: Math.round(logW),
      stage: stage,
      perf: perf,
      dpr: dpr
    };
  }

  return {
    AR: AR,
    MIN_TOUCH: MIN_TOUCH,
    MIN_STAGE: MIN_STAGE,
    MAX_DPR: MAX_DPR,
    MODES: MODES,
    CHROME: CHROME,
    pickMode: pickMode,
    logMode: logMode,
    logWidth: logWidth,
    cabWidth: cabWidth,
    chromeFor: chromeFor,
    fitStage: fitStage,
    perfTier: perfTier,
    plan: plan
  };
});
