/* 探针21：用真实事件派发验证点击命中修复。
 * 直接对 canvas 派发 pointerdown，读游戏内部记录的落点。
 * 运行：node _test/_probe_aim2.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const os = require("os");

/* N5：不再把 Chrome 用户配置写进 _test/_shots/_profile*（会积出整个浏览器的
 * 缓存 / History / Cookies）。每次跑新建一次性临时 profile，进程退出即删。 */
let profileDir = null;
function dropProfile() {
  if (!profileDir) return;
  try { fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 2 }); } catch (e) { }
  profileDir = null;
}
process.on("exit", dropProfile);

const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "_shots");
const PORT = 8954;
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
  profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-probe-aim2-"));
  const userDir = profileDir;   // 每次全新，用完即删（N5）
  const args = [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=9354", "--user-data-dir=" + userDir,
    "--window-size=1440,900", "--hide-scrollbars", "about:blank"
  ];
  const proc = spawn(browser, args, { stdio: "ignore" });
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(400);
    try {
      const list = await getJSON("http://127.0.0.1:9354/json/list");
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

  console.log("=== 真实事件派发：点击命中验证 ===\n");

  const res = await evalJS(`(function(){
    var P = window.CPProject, g = window.__CP.game, D = window.CPData;
    var cv = document.getElementById('cv');
    var r = cv.getBoundingClientRect();
    var y = g.world.dropZone.yMid;
    var out = [];

    // 记录真实反投影值：拦截 g.insert 的入参（引擎内部再往 cx 上叠加 ±4px 物理抖动，
    // 那个抖动不是点击误差 —— 旧版拦 world.drop 把抖动算进误差，门禁永远随机红）
    var origInsert = g.insert.bind(g);
    var lastX = null;
    g.insert = function(x){ lastX = x; return origInsert(x); };

    [60, 120, 240, 360, 420].forEach(function(bx){
      // 台面 x → 屏幕坐标（走真实投影）
      var screenX = P.projectX(bx, y);
      var clientX = r.left + screenX / 480 * r.width;
      var clientY = r.top + (P.projectY(y, 0) / 580) * r.height;
      lastX = null;
      cv.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: clientX, clientY: clientY, bubbles: true, cancelable: true
      }));
      out.push({ boardX: bx, screenX: +screenX.toFixed(2), landedX: lastX == null ? null : +lastX.toFixed(2),
                 err: lastX == null ? null : +(lastX - bx).toFixed(2) });
    });

    g.insert = origInsert;
    return { viewport: P.getViewport(), tests: out };
  })()`);

  console.log(JSON.stringify(res, null, 2));
  if (res && res.tests) {
    const bad = res.tests.filter(t => t.err == null || Math.abs(t.err) > 1.5);
    console.log("\n结论: " + (bad.length === 0 ? "✓ 点击命中精确（误差 < 1.5 台面像素）" : "✗ 仍有偏差: " + JSON.stringify(bad)));
  }

  try { proc.kill(); } catch (e) { }
  dropProfile();
  srv.close();
  process.exit(0);
})().catch((e) => { console.error("探针自身出错：", e); process.exit(2); });