/* ============================================================
 * 视觉随机流（Visual RNG）
 *
 * 与 gameplay RNG 完全隔离：火花 / 抖动 / 旋转相位 / 粒子方向
 * 只能走这条流。所以"画面更花"永远不会改变
 * 掉落结果、奖励结果或 Jackpot 概率。
 * ============================================================ */
(function (root) {
  "use strict";

  let s = 0x1f123bb5 >>> 0;

  function next() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  root.CPVRng = {
    next: next,
    range: function (a, b) { return a + next() * (b - a); },
    sign: function () { return next() < 0.5 ? -1 : 1; },
    chance: function (p) { return next() < p; },
    reseed: function (v) { s = (v >>> 0) || 1; }
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
