/* ============================================================
 * 币堆视觉层（Layer 4 / 6 的"高度"部分）
 *
 * 物理仍然是干净的 2D（x / y / vx / vy），这里只维护**纯视觉量**：
 *   vz      离台视觉高度（由附近币的密度 + 推板压力驱动）
 *   layer   堆叠层级（0 底层 / 1 中层 / 2 顶层）
 *   tilt    倾斜
 *   flip    绕竖直轴的翻转角（投币 / 空中时翻，落地后回正）
 *   spin    平面内旋转（来自物理的 rot）
 *
 * 关键点：vz **绝不参与任何碰撞与结算**，所以
 * 「币堆看起来有厚度」这件事不会污染经济平衡测试的数字。
 * ============================================================ */
(function (root) {
  "use strict";

  const VR = root.CPVRng;

  const states = new Map();
  const grid = new Map();
  const CELL = 36;
  const NEIGH = [[1, 0], [-1, 1], [0, 1], [1, 1]];

  function mk(c) {
    return {
      vz: 0, vzT: 0,
      layer: 0,
      tilt: 0, tiltT: 0,
      flip: c ? c.rot : 0, flipV: 0,
      spin: 0, spinV: 0,
      dens: 0,
      seed: VR.range(0, Math.PI * 2)
    };
  }

  function get(c) {
    let s = states.get(c.id);
    if (!s) { s = mk(c); states.set(c.id, s); }
    return s;
  }

  /** 把整张网格重建一次（每帧只做一次，不是每枚币做一次） */
  function buildGrid(world) {
    grid.clear();
    const coins = world.coins;
    const cols = Math.floor(world.W / CELL) + 2;
    for (let i = 0; i < coins.length; i++) {
      const o = coins[i];
      const key = ((o.y / CELL) | 0) * cols + ((o.x / CELL) | 0);
      let b = grid.get(key);
      if (!b) { b = []; grid.set(key, b); }
      b.push(o);
    }
    return cols;
  }

  /** 附近币的密度（只数 3r 以内的邻居，用已建好的均匀网格查询）
   *  注意：网格由 update() 每帧建一次；这里**不能**再 clear() ——
   *  那会变成每枚币重建整张网格（260 枚币 = 260 次重建），帧率直接崩掉。 */
  function densityOf(cols, c) {
    const gx = (c.x / CELL) | 0, gy = (c.y / CELL) | 0;
    const lim = c.r * 3;
    let n = 0;
    const own = grid.get(gy * cols + gx) || [];
    for (let i = 0; i < own.length; i++) if (own[i] !== c) n++;
    for (let d = 0; d < NEIGH.length; d++) {
      const b = grid.get((gy + NEIGH[d][1]) * cols + (gx + NEIGH[d][0]));
      if (!b) continue;
      for (let i = 0; i < b.length; i++) {
        const o = b[i];
        if (o === c) continue;
        const dx = o.x - c.x, dy = o.y - c.y;
        if (dx * dx + dy * dy <= lim * lim) n++;
      }
    }
    return n;
  }

  /** 每帧推进所有币的视觉状态 */
  function update(world, dt) {
    if (!(dt > 0)) return;
    const coins = world.coins;
    const k = 1 - Math.exp(-6.5 * dt);      // vz 的平滑（被挤高 → 慢慢回落）
    const kt = 1 - Math.exp(-5 * dt);
    const kf = 1 - Math.exp(-9 * dt);
    const cols = buildGrid(world);

    for (let i = 0; i < coins.length; i++) {
      const c = coins[i];
      const s = get(c);

      /* --- 堆叠高度：局部隆起，不是整片抬高 --- */
      const dens = densityOf(cols, c);
      s.dens = dens;
      let zt = (dens - 2.2) * 0.95;
      if (zt < 0) zt = 0;
      else if (zt > 8) zt = 8;
      // 推板压力：被挤压的币会"鼓"起来一点
      const stress = c.stress > 0 ? Math.min(c.stress, 6) : 0;
      zt += stress * 0.55;
      // 空中 / 导轨中的币不叠在币堆上
      if (c.air || c._chuteT > 0) zt = 0;
      s.vzT = zt;
      s.vz += (s.vzT - s.vz) * k;
      if (s.vz < 0.02) s.vz = 0;
      s.layer = s.vz > 5 ? 2 : s.vz > 2.2 ? 1 : 0;

      /* --- 倾斜：受挤压 / 被推着走的币会歪一点，但必须克制 --- */
      const push = Math.min(Math.abs(c.vy) / 90, 1);
      s.tiltT = (stress * 0.045 + push * 0.05) * (c.vx >= 0 ? 1 : -1);
      s.tilt += (s.tiltT - s.tilt) * kt;
      if (Math.abs(s.tilt) < 0.002) s.tilt = 0;

      /* --- 翻转：投币 / 空中时翻滚，落地后回正 --- */
      if (c.air || c._chuteT > 0) {
        s.flipV += (7 + Math.abs(c.vx) * 0.06) * dt;
      } else {
        s.flipV *= Math.exp(-6 * dt);
        // 回正到最近的"正面朝上"（π 的整数倍）
        const target = Math.round(s.flip / Math.PI) * Math.PI;
        s.flip += (target - s.flip) * kf;
      }
      s.flip += s.flipV * dt;

      /* --- 平面内旋转：跟随物理，撞击后按摩擦衰减 --- */
      s.spin = c.rot;
      s.spinV *= Math.exp(-3 * dt);
    }
  }

  /** 深度排序键：y 为主，视觉高度为辅（高的、靠前的画在后面） */
  function sortKey(c) {
    const s = states.get(c.id);
    return c.y - (s ? s.vz : 0) * 0.6;
  }

  /** 清理已经离场的币，避免 Map 无限增长 */
  function prune(world) {
    if (states.size <= world.coins.length + 8) return;
    const live = new Set();
    for (const c of world.coins) live.add(c.id);
    for (const id of states.keys()) if (!live.has(id)) states.delete(id);
  }

  function clear() { states.clear(); grid.clear(); }

  root.CPPile = {
    update: update, get: get, sortKey: sortKey, prune: prune, clear: clear,
    size: function () { return states.size; }
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
