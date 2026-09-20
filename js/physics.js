/* ============================================================
 * 推币机物理内核 —— 纯逻辑，零 DOM 依赖，可 headless 跑测试
 * 俯视视角：y 轴朝"玩家方向"，推板在 y 小的一端往复，币被推向 payoutY 前沿。
 * 掉出前沿 = 奖励；从左右两个角沟掉下去 = 丢币。
 *
 * 随机源可注入（cfg.rng），默认 Math.random：
 * 注入可播种 RNG 后，同一份种子跑出的每一局都完全一致，测试可复现。
 * ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CPPhysics = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rand = (a, b, rng) => a + (rng || Math.random)() * (b - a);

  let UID = 1;

  /* ---------------- 币 ---------------- */
  class Coin {
    constructor(x, y, def, rng) {
      const r = typeof rng === "function" ? rng : Math.random;
      this.id = UID++;
      this.x = x;
      this.y = y;
      this.vx = 0;
      this.vy = 0;
      this.r = def.r;
      this.mass = def.mass || 1;
      this.def = def;
      this.kind = def.id;
      this.rot = rand(0, TAU, r);
      this.spin = rand(-3, 3, r);
      this.age = 0;
      this.squash = 0.35;   // 出生缩放动画
      this.spark = 0;       // 视觉高光计时
      this.stress = 0;      // 被推板挤压的程度（给特效看）
      this.dead = false;
      this.reason = null;   // 'payout' | 'gutter'
    }
    get speed() { return Math.hypot(this.vx, this.vy); }
  }

  /* ---------------- 机台世界 ---------------- */
  class World {
    constructor(cfg) {
      cfg = cfg || {};
      this.W = cfg.width != null ? cfg.width : 480;
      this.H = cfg.height != null ? cfg.height : 580;
      this.payoutY = cfg.payoutY != null ? cfg.payoutY : 470;
      this.gutterW = cfg.gutterW != null ? cfg.gutterW : 44;  // 角沟宽度（可被护栏升级削窄）
      this.plateDepth = cfg.plateDepth != null ? cfg.plateDepth : 92;
      this.plateMinY = cfg.plateMinY != null ? cfg.plateMinY : 118;
      this.plateMaxY = cfg.plateMaxY != null ? cfg.plateMaxY : 250;
      this.maxCoins = cfg.maxCoins != null ? cfg.maxCoins : 200;
      this.iterations = cfg.iterations != null ? cfg.iterations : 10;
      this.omega = cfg.omega != null ? cfg.omega : 1.35;      // 推板角速度（rad/s）
      this.baseFriction = cfg.baseFriction != null ? cfg.baseFriction : 3.6;
      this.relax = cfg.relax != null ? cfg.relax : 0.8;
      this.gravity = cfg.gravity != null ? cfg.gravity : 0;   // 台面近似水平：只有推板能推动币

      // 升级注入的倍率
      this.speedMul = 1;    // 推板速度
      this.reachMul = 1;    // 推板行程
      this.frictionMul = 1; // 摩擦（越小越滑）
      this.railMul = 1;     // 护栏（越大角沟越窄）
      this.magnet = 0;      // 磁力线圈等级：在求解器内部施加真实横向力

      this.plate = { y: this.plateMinY, vy: 0, minY: this.plateMinY, maxY: this.plateMaxY, depth: this.plateDepth };
      this.phase = 0;
      this.time = 0;
      this.coins = [];
      this.events = [];
      this.stats = { dropped: 0, paid: 0, lost: 0, peak: 0, stress: 0, stressPeak: 0 };
      this._bucket = new Map();
      this.rng = typeof cfg.rng === "function" ? cfg.rng : Math.random;
    }

    get plateMaxReach() {
      return this.plateMinY + (this.plateMaxY - this.plateMinY) * this.reachMul;
    }
    get gutterWidth() {
      return Math.max(6, this.gutterW / this.railMul);
    }
    /** 投币落点区间（推板最远端前方一小段） */
    get dropZone() {
      const m = this.plateMaxReach;
      return { y0: m + 16, y1: m + 92, yMid: m + 54 };
    }
    get full() { return this.coins.length >= this.maxCoins; }

    /* 投一枚币。x 会被夹进两侧墙内 */
    drop(def, x, opts) {
      opts = opts || {};
      if (this.full) return null;
      const z = this.dropZone;
      const cx = clamp(x != null ? x : this.W / 2, def.r + 6, this.W - def.r - 6);
      const cy = opts.y != null ? opts.y : z.y0 + this.rng() * (z.y1 - z.y0);
      const c = new Coin(cx, cy, def, this.rng);
      c.vx = opts.vx != null ? opts.vx : (this.rng() - 0.5) * 46;
      c.vy = opts.vy != null ? opts.vy : 52 + this.rng() * 62;
      c.spark = 1;
      this.coins.push(c);
      this.stats.dropped++;
      if (this.coins.length > this.stats.peak) this.stats.peak = this.coins.length;
      return c;
    }

    /* 一次性撒一堆币（Jackpot / 抽奖雨）。
     * 返回真正落地的币；台面满时返回的数组会短于 n，
     * 调用方负责把差额折算成金币返还给玩家（见 engine.dropManyOrRefund）。 */
    dropMany(def, n, xs) {
      const made = [];
      for (let i = 0; i < n; i++) {
        const x = xs ? xs[i % xs.length] : this.W * (0.18 + 0.64 * (i / Math.max(1, n - 1)));
        const c = this.drop(def, x);
        if (c) made.push(c);
      }
      return made;
    }

    resetStats() {
      this.stats = { dropped: 0, paid: 0, lost: 0, peak: 0, stress: 0, stressPeak: 0 };
    }
    clear() {
      this.coins.length = 0;
      this.events.length = 0;
      this.resetStats();
    }

    /* 单个物理步（固定步长调用）
     * opts.freezePlate = true 时推板停在原地（"暂停推板"用），
     * 台面上的币仍然继续求解，不会卡住。 */
    step(dt, opts) {
      if (!(dt > 0)) return;
      const freeze = !!(opts && opts.freezePlate);
      this.time += dt;

      const p = this.plate;
      if (freeze) {
        p.vy = 0;
      } else {
        const prevY = p.y;
        this.phase += dt * this.omega * this.speedMul;
        const s = 0.5 - 0.5 * Math.cos(this.phase);
        p.y = p.minY + (p.maxY - p.minY) * this.reachMul * s;
        p.vy = (p.y - prevY) / dt;
      }

      const damp = Math.exp(-this.baseFriction * this.frictionMul * dt);
      const spinDamp = Math.exp(-3 * dt);
      const grow = Math.min(1, dt * 10);
      const coins = this.coins;
      for (let i = 0; i < coins.length; i++) {
        const c = coins[i];
        c.age += dt;
        c.vy += this.gravity * dt;
        /* 磁力线圈：在积分阶段施加真实力（和碰撞求解同一套体系），
         * 不是事后硬改坐标，所以不会出现"币被推着穿过别的币"的观感。 */
        if (this.magnet > 0 && c.y > this.payoutY - 190) {
          const gw = this.gutterWidth;
          if (c.x < gw + c.r * 2.2) c.vx += this.magnet * 46 * dt;
          else if (c.x > this.W - gw - c.r * 2.2) c.vx -= this.magnet * 46 * dt;
        }
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.vx *= damp;
        c.vy *= damp;
        const sp = Math.sqrt(c.vx * c.vx + c.vy * c.vy);
        if (sp > 700) { const k = 700 / sp; c.vx *= k; c.vy *= k; }
        c.rot += c.spin * dt;
        c.spin *= spinDamp;
        if (c.squash < 1) c.squash += (1 - c.squash) * grow;
        if (c.spark > 0) c.spark = Math.max(0, c.spark - dt * 1.8);
        c.stress *= Math.exp(-8 * dt);
      }

      for (let it = 0; it < this.iterations; it++) {
        this._solvePairs(it === 0);
        this._solvePlate();
        this._solveWalls();
      }

      // 挤压强度会随时间回落，只留峰值做统计
      this.stats.stress *= Math.exp(-2.5 * dt);
      this._cull();
      if (this.coins.length > this.stats.peak) this.stats.peak = this.coins.length;
    }

    /* ---- 币与币 ---- */
    _solvePairs(applyImpulse) {
      const coins = this.coins;
      const n = coins.length;
      if (n < 2) return;
      let maxR = 0;
      for (let i = 0; i < n; i++) if (coins[i].r > maxR) maxR = coins[i].r;
      const cell = maxR * 2 + 6;
      const cols = Math.floor(this.W / cell) + 2;
      const map = this._bucket;
      map.clear();
      for (let i = 0; i < n; i++) {
        const c = coins[i];
        const gx = (c.x / cell) | 0;
        const gy = (c.y / cell) | 0;
        const key = gy * cols + gx;
        let b = map.get(key);
        if (!b) { b = []; map.set(key, b); }
        b.push(c);
      }
      const NB = [[1, 0], [-1, 1], [0, 1], [1, 1]];
      for (const entry of map) {
        const key = entry[0], bucket = entry[1];
        const gy = (key / cols) | 0, gx = key - gy * cols;
        for (let i = 0; i < bucket.length; i++) {
          const a = bucket[i];
          for (let j = i + 1; j < bucket.length; j++) this._resolve(a, bucket[j], applyImpulse);
          for (let d = 0; d < 4; d++) {
            const nb = map.get((gy + NB[d][1]) * cols + (gx + NB[d][0]));
            if (!nb) continue;
            for (let j = 0; j < nb.length; j++) this._resolve(a, nb[j], applyImpulse);
          }
        }
      }
    }

    _resolve(a, b, applyImpulse) {
      const dx = b.x - a.x, dy = b.y - a.y;
      const rr = a.r + b.r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= rr * rr) return;
      let d = Math.sqrt(d2);
      let nx, ny;
      if (d < 1e-6) { nx = 0; ny = -1; d = 0; }        // 完全重合时随便挑个方向
      else { nx = dx / d; ny = dy / d; }
      const overlap = rr - d;
      const ia = 1 / a.mass, ib = 1 / b.mass, im = ia + ib;
      if (im <= 0) return;
      const corr = overlap * this.relax / im;
      a.x -= nx * corr * ia; a.y -= ny * corr * ia;
      b.x += nx * corr * ib; b.y += ny * corr * ib;
      if (applyImpulse) {
        const rvn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rvn < 0) {
          const j = -(1 + 0.12) * rvn / im;
          a.vx -= nx * j * ia; a.vy -= ny * j * ia;
          b.vx += nx * j * ib; b.vy += ny * j * ib;
        }
      }
    }

    /* ---- 推板：硬约束，币不能陷进推板 ---- */
    _solvePlate() {
      const face = this.plate.y, pv = this.plate.vy;
      const coins = this.coins;
      for (let i = 0; i < coins.length; i++) {
        const c = coins[i];
        const lim = face + c.r;
        if (c.y < lim) {
          const pen = lim - c.y;
          if (pen > c.stress) c.stress = pen;
          if (pen > this.stats.stress) this.stats.stress = pen;
          if (pen > this.stats.stressPeak) this.stats.stressPeak = pen;
          c.y = lim;
          if (c.vy < pv) c.vy = pv;
        }
      }
    }

    /* ---- 侧墙 ---- */
    _solveWalls() {
      const W = this.W;
      const coins = this.coins;
      for (let i = 0; i < coins.length; i++) {
        const c = coins[i];
        if (c.x < c.r) { c.x = c.r; if (c.vx < 0) c.vx *= -0.25; }
        else if (c.x > W - c.r) { c.x = W - c.r; if (c.vx > 0) c.vx *= -0.25; }
        if (c.y < c.r) { c.y = c.r; if (c.vy < 0) c.vy *= -0.25; }
      }
    }

    /* ---- 结算：掉出前沿 / 掉进角沟 ---- */
    _cull() {
      const coins = this.coins;
      let removed = null;
      const gw = this.gutterWidth;
      for (let i = 0; i < coins.length; i++) {
        const c = coins[i];
        if (c.y <= this.payoutY) continue;
        const reason = (c.x < gw || c.x > this.W - gw) ? "gutter" : "payout";
        c.dead = true;
        c.reason = reason;
        if (reason === "payout") this.stats.paid++; else this.stats.lost++;
        this.events.push({ type: reason, coin: c, t: this.time });
        (removed || (removed = [])).push(c.id);
      }
      if (removed) {
        const dead = new Set(removed);
        this.coins = coins.filter((c) => !dead.has(c.id));
      }
    }

    drainEvents() {
      if (!this.events.length) return [];
      const e = this.events;
      this.events = [];
      return e;
    }

    /** 给测试用：找出严重重叠的一对 */
    worstOverlap() {
      const coins = this.coins;
      let worst = 0;
      for (let i = 0; i < coins.length; i++) {
        for (let j = i + 1; j < coins.length; j++) {
          const a = coins[i], b = coins[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const rr = a.r + b.r;
          const d2 = dx * dx + dy * dy;
          if (d2 >= rr * rr) continue;
          const pen = rr - Math.sqrt(d2);
          if (pen > worst) worst = pen;
        }
      }
      return worst;
    }

    /** 给测试用：最深陷进推板的深度 */
    worstPlatePenetration() {
      const face = this.plate.y;
      let worst = 0;
      for (const c of this.coins) {
        const pen = face + c.r - c.y;
        if (pen > worst) worst = pen;
      }
      return worst;
    }

    /* 存档：上限跟随 maxCoins（扩容槽升到多少就存多少），
     * 不再有 200 / 220 两个互相打架的魔数。 */
    serialize(limit) {
      const cap = limit == null ? this.maxCoins : limit;
      const out = [];
      const n = Math.min(this.coins.length, Math.max(0, cap));
      for (let i = 0; i < n; i++) {
        const c = this.coins[i];
        out.push([
          c.kind,
          Math.round(c.x * 10) / 10,
          Math.round(c.y * 10) / 10,
          Math.round(c.rot * 100) / 100
        ]);
      }
      return out;
    }

    restore(list, defs) {
      this.coins.length = 0;
      if (!list || !list.length) return;
      const cap = this.maxCoins;
      for (let i = 0; i < list.length; i++) {
        if (this.coins.length >= cap) break;
        const row = list[i];
        if (!row || typeof row[0] !== "string") continue;
        const def = defs[row[0]];
        if (!def) continue;
        const x = Number(row[1]), y = Number(row[2]);
        if (!isFinite(x) || !isFinite(y)) continue;
        const c = new Coin(clamp(x, def.r, this.W - def.r), clamp(y, def.r, this.payoutY - 4), def, this.rng);
        const rot = Number(row[3]);
        if (isFinite(rot)) c.rot = rot;
        c.squash = 1;
        this.coins.push(c);
      }
    }
  }

  return { Coin, World, clamp, rand, TAU };
});
