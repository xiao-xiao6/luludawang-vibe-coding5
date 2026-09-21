/* 探针25：修复后的最终验收 —— 普通币观感 + 各档位截图。 */
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "_shots");
const PORT = 8956;
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

(async function main() {
  const browser = findBrowser();
  if (!browser) { console.log("没有可用浏览器，跳过"); process.exit(0); }
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const userDir = path.join(OUT, "_profile_final");
  const args = [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=9356", "--user-data-dir=" + userDir,
    "--window-size=1440,900", "--hide-scrollbars", "about:blank"
  ];
  const proc = spawn(browser, args, { stdio: "ignore" });
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(400);
    try {
      const list = await getJSON("http://127.0.0.1:9356/json/list");
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

  console.log("=== 最终验收：普通币观感 ===\n");

  // 铺真实币堆并跑物理，然后量"币内最暗点"
  const res = await evalJS(`(function(){
    var g = window.__CP.game, D = window.CPData, P = window.CPProject, C = window.CPCoin, Pile = window.CPPile;
    g.st.credits = 1e6;

    // 径向扫描：真实代码路径
    function scan(kind){
      var def = D.COIN_DEFS[kind];
      var N = 200;
      var cv = document.createElement('canvas');
      cv.width = N; cv.height = N;
      var ctx = cv.getContext('2d');
      ctx.fillStyle = "#191536"; ctx.fillRect(0,0,N,N);
      ctx.save(); ctx.translate(N/2, N/2);
      C.drawCoin(ctx, def, 0, 0, 1, { flip:0, tilt:0, seed:0 }, 1, 0);
      ctx.restore();
      var img = ctx.getImageData(0,0,N,N).data;
      var innerMin = 999, atR = 0, prof = [];
      for (var r=0; r<=def.r+3; r++){
        var i = ((N/2)*N + Math.round(N/2 + r))*4;
        var L = img[i]*0.299+img[i+1]*0.587+img[i+2]*0.114;
        prof.push(Math.round(L));
        if (r < def.r && L < innerMin) { innerMin = L; atR = r; }
      }
      return { kind:kind, innerMin:Math.round(innerMin), atR:atR, profile:prof };
    }

    var out = { copper: scan('copper'), silver: scan('silver'), gold: scan('gold') };

    // 真实币堆渲染
    g.world.coins.length = 0;
    for (var i=0;i<180;i++){
      var x = 50 + Math.random()*380, y = 170 + Math.random()*200;
      g.world.drop(D.COIN_DEFS.copper, x, { y: y, z: 0 });
    }
    for (var j=0;j<g.world.coins.length;j++){ var c=g.world.coins[j]; c.air=false; c._chuteT=0; c.z=0; }
    window.__CP.render();

    var cv2 = document.getElementById('cv');
    var ctx2 = cv2.getContext('2d');
    var img2 = ctx2.getImageData(0,0,cv2.width,cv2.height).data;
    var dark=0, opaque=0;
    for (var k=0;k<img2.length;k+=4){
      if (img2[k+3]<8) continue;
      opaque++;
      var L2 = img2[k]*0.299+img2[k+1]*0.587+img2[k+2]*0.114;
      if (L2 < 30) dark++;
    }
    out.boardDarkRatio = +(dark/opaque).toFixed(4);
    out.coins = g.world.coins.length;
    return out;
  })()`);

  if (res && res.copper) {
    ['copper','silver','gold'].forEach(k => {
      const c = res[k];
      const flag = c.innerMin < 60 ? "  ← 仍有暗心" : "  ✓ 币面均匀";
      console.log(`${k.padEnd(7)} 币内最暗亮度 = ${String(c.innerMin).padStart(3)} (r=${c.atR})${flag}`);
      console.log(`        径向: ${c.profile.join(" → ")}`);
    });
    console.log(`\n真实币堆（${res.coins} 枚）整幅暗像素占比: ${res.boardDarkRatio}`);
  } else {
    console.log("失败:", JSON.stringify(res));
  }

  // 各档位截图
  console.log("\n--- 各档位截图 ---");
  for (const vp of [{w:1440,h:900,tag:"wide"},{w:390,h:844,tag:"narrow"},{w:740,h:360,tag:"compact"}]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: vp.w, height: vp.h, deviceScaleFactor: 2, mobile: vp.w < 700 });
    await sleep(500);
    await evalJS("document.getElementById('questRow').hidden = false;");
    await sleep(300);
    const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
    if (shot && shot.data) {
      const f = path.join(OUT, "final-" + vp.tag + ".png");
      fs.writeFileSync(f, Buffer.from(shot.data, "base64"));
      console.log("  已保存 final-" + vp.tag + ".png (" + vp.w + "×" + vp.h + ")");
    }
  }
  await cdp.send("Emulation.clearDeviceMetricsOverride");

  try { proc.kill(); } catch (e) { }
  srv.close();
  process.exit(0);
})().catch((e) => { console.error("探针自身出错：", e); process.exit(2); });