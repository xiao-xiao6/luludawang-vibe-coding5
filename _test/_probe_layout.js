/* 探针19：双端适配全档位体检。
 * 扫一批真实机型视口，检查：机柜溢出 / 台面宽高比 / 订单条错位 /
 * 元素重叠 / 触控尺寸 / 横向滚动 / 安全区。
 * 运行：node _test/_probe_layout.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "_shots");
const PORT = 8952;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png"
};
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split("?")[0]);
      if (p === "/") p = "/index.html";
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        res.writeHead(404); res.end("nope"); return;
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
      res.end(fs.readFileSync(f));
    });
    srv.listen(PORT, "127.0.0.1", () => resolve(srv));
  });
}
function findBrowser() {
  const cands = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
  ];
  for (const c of cands) if (fs.existsSync(c)) return c;
  return null;
}
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiters = new Map(); this.events = []; }
  static connect(url) {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const key = Buffer.from(Math.random().toString(36)).toString("base64");
      const req = http.request({
        hostname: u.hostname, port: u.port, path: u.pathname + u.search,
        headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": key }
      });
      req.on("upgrade", (res, socket) => {
        socket.setNoDelay(true);
        const cdp = new CDP(socket); cdp.socket = socket; cdp.attach(); resolve(cdp);
      });
      req.on("error", reject);
      req.end();
    });
  }
  attach() {
    let buf = Buffer.alloc(0);
    this.socket.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 2) {
        const op = buf[0] & 0x0f;
        const len0 = buf[1] & 0x7f;
        let off = 2, len = len0;
        if (len0 === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len0 === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + len) return;
        const payload = buf.slice(off, off + len);
        buf = buf.slice(off + len);
        if (op === 1) this.onText(payload.toString("utf8"));
        if (op === 8) { try { this.socket.end(); } catch (e) { } }
      }
    });
  }
  onText(txt) {
    let msg; try { msg = JSON.parse(txt); } catch (e) { return; }
    if (msg.id != null && this.waiters.has(msg.id)) {
      const w = this.waiters.get(msg.id); this.waiters.delete(msg.id);
      w(msg.result || msg.error || {});
    } else if (msg.method) this.events.push(msg);
  }
  send(method, params) {
    const id = ++this.id;
    const data = JSON.stringify({ id: id, method: method, params: params || {} });
    const payload = Buffer.from(data, "utf8");
    const mask = Buffer.from([1, 2, 3, 4]);
    let header;
    if (payload.length < 126) {
      header = Buffer.alloc(6); header[0] = 0x81; header[1] = 0x80 | payload.length; mask.copy(header, 2);
    } else if (payload.length < 65536) {
      header = Buffer.alloc(8); header[0] = 0x81; header[1] = 0x80 | 126;
      header.writeUInt16BE(payload.length, 2); mask.copy(header, 4);
    } else {
      header = Buffer.alloc(14); header[0] = 0x81; header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2); mask.copy(header, 10);
    }
    const masked = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4];
    this.socket.write(Buffer.concat([header, masked]));
    return new Promise((resolve) => {
      this.waiters.set(id, resolve);
      setTimeout(() => { if (this.waiters.has(id)) { this.waiters.delete(id); resolve({ __timeout: true }); } }, 30000);
    });
  }
}
function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let s = ""; res.on("data", (d) => (s += d));
      res.on("end", () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } });
    }).on("error", reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 真实机型视口
const VIEWPORTS = [
  { w: 1920, h: 1080, tag: "桌面 1080p" },
  { w: 1440, h: 900, tag: "桌面 1440" },
  { w: 1366, h: 768, tag: "笔记本 1366" },
  { w: 1280, h: 800, tag: "笔记本 1280" },
  { w: 1024, h: 768, tag: "iPad 横屏" },
  { w: 900, h: 700, tag: "小窗" },
  { w: 861, h: 700, tag: "wide 边界 861" },
  { w: 860, h: 700, tag: "stack 边界 860" },
  { w: 820, h: 1180, tag: "iPad 竖屏" },
  { w: 768, h: 1024, tag: "iPad 竖屏 768" },
  { w: 600, h: 900, tag: "平板小" },
  { w: 480, h: 800, tag: "narrow 边界 480" },
  { w: 414, h: 896, tag: "iPhone XR" },
  { w: 390, h: 844, tag: "iPhone 14" },
  { w: 375, h: 667, tag: "iPhone SE" },
  { w: 360, h: 800, tag: "安卓常见" },
  { w: 320, h: 568, tag: "iPhone 5" },
  { w: 844, h: 390, tag: "iPhone 横屏" },
  { w: 740, h: 360, tag: "安卓横屏" },
  { w: 568, h: 320, tag: "矮横屏" },
  { w: 640, h: 360, tag: "小横屏" }
];

(async function main() {
  const browser = findBrowser();
  if (!browser) { console.log("没有可用浏览器，跳过"); process.exit(0); }
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const userDir = path.join(OUT, "_profile_layout");
  const args = [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=9352", "--user-data-dir=" + userDir,
    "--window-size=1440,900", "--hide-scrollbars", "about:blank"
  ];
  const proc = spawn(browser, args, { stdio: "ignore" });
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(400);
    try {
      const list = await getJSON("http://127.0.0.1:9352/json/list");
      target = list.find((t) => t.type === "page");
    } catch (e) { }
  }
  if (!target) { console.log("调试端口没起来"); proc.kill(); srv.close(); process.exit(1); }
  const cdp = await CDP.connect(target.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/index.html" });
  await sleep(3000);

  async function evalJS(expr) {
    const r = await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return { __err: r.exceptionDetails.text + " " + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || "") };
    return r && r.result ? r.result.value : undefined;
  }

  console.log("=== 双端适配全档位体检 ===\n");
  const problems = [];

  for (const vp of VIEWPORTS) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.w < 700
    });
    await sleep(450);
    // 强制显示订单条，检查它在各档位的摆放
    await evalJS("document.getElementById('questRow').hidden = false; if (window.__CP.game) window.__CP.game.offerOrder && window.__CP.game.offerOrder();");
    await sleep(350);

    const r = await evalJS(`(function(){
      var cab = document.querySelector('.cab');
      var stage = document.querySelector('.stage');
      var cv = document.getElementById('cv');
      var pad = document.querySelector('.pad');
      var quest = document.getElementById('questRow');
      var hud = document.querySelector('.hud');
      var log = document.getElementById('log');
      var ticker = document.getElementById('ticker');
      function R(el){ if(!el) return null; var b = el.getBoundingClientRect();
        return { x:Math.round(b.left), y:Math.round(b.top), w:Math.round(b.width), h:Math.round(b.height),
                 right:Math.round(b.right), bottom:Math.round(b.bottom) }; }
      function visible(el){ if(!el) return false; var cs=getComputedStyle(el);
        return cs.display!=='none' && cs.visibility!=='hidden' && el.getBoundingClientRect().width>0; }
      var c = R(cab), s = R(stage), p = R(pad), q = R(quest), h = R(hud), t = R(ticker);
      var cvr = R(cv);
      // 重叠检测：quest 与 stage/pad 是否重叠
      function overlap(a,b){ if(!a||!b) return 0;
        var ox = Math.max(0, Math.min(a.right,b.right) - Math.max(a.x,b.x));
        var oy = Math.max(0, Math.min(a.bottom,b.bottom) - Math.max(a.y,b.y));
        return ox*oy; }
      // 触控尺寸
      var smallBtns = [];
      document.querySelectorAll('button').forEach(function(b){
        if (!visible(b)) return;
        var br = b.getBoundingClientRect();
        if (br.height < 24) smallBtns.push(b.id || b.textContent.trim().slice(0,8) + ':' + Math.round(br.height));
      });
      return {
        mode: document.body.dataset.mode, logMode: document.body.dataset.log,
        vw: window.innerWidth, vh: window.innerHeight,
        docScrollW: document.documentElement.scrollWidth,
        docScrollH: document.documentElement.scrollHeight,
        cab: c, stage: s, pad: p, quest: q, hud: h, ticker: t, cv: cvr,
        questVisible: visible(quest),
        overlapStageQuest: overlap(s,q),
        overlapPadQuest: overlap(p,q),
        overlapHudQuest: overlap(h,q),
        stageAR: s ? +(s.w/s.h).toFixed(3) : 0,
        smallBtns: smallBtns,
        logVisible: visible(log)
      };
    })()`);

    if (r && r.__err) { console.log(`✗ ${vp.tag} (${vp.w}×${vp.h}) — 求值失败: ${r.__err}`); problems.push(vp.tag); continue; }

    const issues = [];
    const wantAR = 480 / 580;
    if (Math.abs(r.stageAR - wantAR) > 0.02) issues.push(`台面宽高比 ${r.stageAR} ≠ ${wantAR.toFixed(3)}`);
    if (r.cab.bottom > r.vh + 1) issues.push(`机柜底部溢出 ${r.cab.bottom} > ${r.vh}`);
    if (r.cab.right > r.vw + 1) issues.push(`机柜右侧溢出 ${r.cab.right} > ${r.vw}`);
    if (r.docScrollW > r.vw + 1) issues.push(`横向滚动 ${r.docScrollW} > ${r.vw}`);
    if (r.overlapStageQuest > 50) issues.push(`订单条压住台面 ${r.overlapStageQuest}px²`);
    if (r.overlapPadQuest > 50) issues.push(`订单条压住操作区 ${r.overlapPadQuest}px²`);
    if (r.overlapHudQuest > 50) issues.push(`订单条压住HUD ${r.overlapHudQuest}px²`);
    if (r.smallBtns.length) issues.push(`按钮过小: ${r.smallBtns.slice(0,4).join(",")}`);

    const mark = issues.length ? "✗" : "✓";
    console.log(`${mark} ${vp.tag.padEnd(16)} ${String(vp.w).padStart(4)}×${String(vp.h).padEnd(4)} mode=${r.mode.padEnd(7)} log=${String(r.logMode).padEnd(5)} 台面=${r.stage.w}×${r.stage.h}`);
    if (issues.length) {
      issues.forEach(x => console.log(`     · ${x}`));
      problems.push(vp.tag + ": " + issues.join("; "));
    }
  }

  await cdp.send("Emulation.clearDeviceMetricsOverride");
  console.log("\n" + "=".repeat(60));
  if (!problems.length) console.log("适配体检通过：全部 " + VIEWPORTS.length + " 个视口无问题");
  else {
    console.log("发现 " + problems.length + " 个视口有问题：");
    problems.forEach(p => console.log("  · " + p));
  }
  console.log("=".repeat(60));

  try { proc.kill(); } catch (e) { }
  srv.close();
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error("探针自身出错：", e); process.exit(2); });