/* ============================================================
 * 特效层：粒子 / 飘字 / 震屏 / 程序化音效（无外部资源）
 * ============================================================ */
(function (root) {
  "use strict";

  const reduceQuery = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;

  const Fx = {
    parts: [],
    texts: [],
    shake: 0,
    reduce: !!(reduceQuery && reduceQuery.matches),
    quality: 1,

    init() {
      if (reduceQuery && reduceQuery.addEventListener) {
        reduceQuery.addEventListener("change", (e) => { this.reduce = e.matches; });
      }
      const mem = (navigator.deviceMemory || 4);
      this.quality = mem <= 2 ? 0.5 : 1;
    },

    burst(x, y, color, n, spread, speed) {
      if (this.reduce) return;
      n = Math.round((n || 12) * this.quality);
      spread = spread == null ? Math.PI * 2 : spread;
      speed = speed || 170;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * spread - spread / 2 - Math.PI / 2;
        const s = speed * (0.35 + Math.random() * 0.9);
        this.parts.push({
          x: x, y: y,
          vx: Math.cos(a) * s,
          vy: Math.sin(a) * s - 40,
          life: 0.45 + Math.random() * 0.5,
          max: 0.95,
          size: 1.5 + Math.random() * 2.6,
          color: color
        });
      }
      if (this.parts.length > 420) this.parts.splice(0, this.parts.length - 420);
    },

    ring(x, y, color) {
      if (this.reduce) return;
      this.parts.push({ ring: true, x: x, y: y, r: 6, life: 0.5, max: 0.5, color: color });
    },

    text(x, y, str, color, size) {
      this.texts.push({ x: x, y: y, str: str, color: color || "#ffe9a8", life: 1.0, max: 1.0, size: size || 15 });
      if (this.texts.length > 60) this.texts.splice(0, this.texts.length - 60);
    },

    shakeIt(a) {
      if (this.reduce) return;
      this.shake = Math.min(14, this.shake + a);
    },

    update(dt) {
      const damp = Math.exp(-2.4 * dt);
      for (let i = this.parts.length - 1; i >= 0; i--) {
        const p = this.parts[i];
        p.life -= dt;
        if (p.life <= 0) { this.parts.splice(i, 1); continue; }
        if (p.ring) { p.r += 220 * dt; continue; }
        p.vy += 420 * dt;
        p.vx *= damp;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      for (let i = this.texts.length - 1; i >= 0; i--) {
        const t = this.texts[i];
        t.life -= dt;
        if (t.life <= 0) { this.texts.splice(i, 1); continue; }
        t.y -= 34 * dt;
      }
      if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 42);
    },

    draw(ctx) {
      const parts = this.parts;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        const a = Math.max(0, p.life / p.max);
        ctx.globalAlpha = a;
        if (p.ring) {
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.stroke();
          continue;
        }
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * a + 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
      const texts = this.texts;
      ctx.textAlign = "center";
      for (let i = 0; i < texts.length; i++) {
        const t = texts[i];
        const a = Math.max(0, Math.min(1, t.life / t.max * 1.6));
        ctx.globalAlpha = a;
        ctx.font = "900 " + t.size + "px system-ui, sans-serif";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(0,0,0,.65)";
        ctx.strokeText(t.str, t.x, t.y);
        ctx.fillStyle = t.color;
        ctx.fillText(t.str, t.x, t.y);
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = "start";
    },

    clear() { this.parts.length = 0; this.texts.length = 0; this.shake = 0; }
  };

  /* ---------------- 程序化音效 ---------------- */
  const Sfx = {
    ac: null,
    muted: false,
    master: null,

    ensure() {
      if (this.muted) return null;
      if (!this.ac) {
        const AC = root.AudioContext || root.webkitAudioContext;
        if (!AC) return null;
        try {
          this.ac = new AC();
          this.master = this.ac.createGain();
          this.master.gain.value = 0.22;
          this.master.connect(this.ac.destination);
        } catch (e) { this.ac = null; return null; }
      }
      if (this.ac.state === "suspended") { try { this.ac.resume(); } catch (e) { /* ignore */ } }
      return this.ac;
    },

    blip(freq, dur, type, vol, slideTo) {
      const ac = this.ensure();
      if (!ac) return;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type || "triangle";
      o.frequency.setValueAtTime(freq, ac.currentTime);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), ac.currentTime + dur);
      g.gain.setValueAtTime(0.0001, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(vol == null ? 0.6 : vol, ac.currentTime + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
      o.connect(g); g.connect(this.master);
      o.start(); o.stop(ac.currentTime + dur + 0.02);
    },

    noise(dur, vol, freq) {
      const ac = this.ensure();
      if (!ac) return;
      const len = Math.max(1, Math.floor(ac.sampleRate * dur));
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ac.createBufferSource();
      src.buffer = buf;
      const f = ac.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = freq || 1400;
      const g = ac.createGain();
      g.gain.value = vol == null ? 0.35 : vol;
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start();
    },

    insert() { this.noise(0.06, 0.22, 2600); this.blip(660, 0.05, "square", 0.16, 880); },
    pay(combo) {
      const step = Math.min(11, Math.max(0, (combo || 1) - 1));
      const f = 720 * Math.pow(1.0595, step * 2);
      this.blip(f, 0.12, "triangle", 0.34, f * 1.5);
      this.blip(f * 2, 0.07, "sine", 0.14);
    },
    big() { this.blip(300, 0.5, "sawtooth", 0.2, 90); this.noise(0.4, 0.3, 700); },
    jackpot() {
      const notes = [523, 659, 784, 1046, 1318];
      notes.forEach((n, i) => setTimeout(() => this.blip(n, 0.22, "triangle", 0.36), i * 85));
      setTimeout(() => this.noise(0.5, 0.28, 1800), 300);
    },
    gutter() { this.blip(180, 0.16, "sine", 0.22, 90); },
    buy() { this.blip(880, 0.09, "square", 0.22, 1180); setTimeout(() => this.blip(1320, 0.1, "sine", 0.18), 70); },
    deny() { this.blip(200, 0.14, "square", 0.18, 130); },
    toggle(on) { this.muted = !on; if (!on && this.ac) { try { this.ac.suspend(); } catch (e) { /* ignore */ } } }
  };

  root.CPFx = Fx;
  root.CPSfx = Sfx;
})(typeof globalThis !== "undefined" ? globalThis : this);
