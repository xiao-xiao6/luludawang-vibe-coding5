/* 探针26：compact 档右列"内容是否被折叠/滚动藏起来"的严格检查。
 * 机柜不溢出 ≠ 内容看得见：cab-side 可滚动时，底部按钮会被推到折叠线下。
 * 这里检查每个交互元素是否真的落在【可视且可点】的区域内。
 * 运行：node _test/_probe_visible.js
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
const PORT = 8957;
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

const VIEWPORTS = [
  { w: 844, h: 390, tag: "iPhone 横屏" },
  { w: 740, h: 360, tag: "安卓横屏" },
  { w: 640, h: 360, tag: "小横屏" },
  { w: 568, h: 320, tag: "矮横屏" },
  { w: 390, h: 844, tag: "iPhone 14" },
  { w: 320, h: 568, tag: "iPhone 5" },
  { w: 1440, h: 900, tag: "桌面" }
];

(async function main() {
  const browser = findBrowser();
  if (!browser) { console.log("没有可用浏览器，跳过"); process.exit(0); }
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-probe-visible-"));
  const userDir = profileDir;   // 每次全新，用完即删（N5）
  const args = [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=9357", "--user-data-dir=" + userDir,
    "--window-size=1440,900", "--hide-scrollbars", "about:blank"
  ];
  const proc = spawn(browser, args, { stdio: "ignore" });
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(400);
    try {
      const list = await getJSON("http://127.0.0.1:9357/json/list");
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

  console.log("=== 交互元素「真的看得见」检查 ===\n");
  const problems = [];

  for (const vp of VIEWPORTS) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.w < 700
    });
    await sleep(450);
    // 让订单条出现（最容易挤爆的状态）
    await evalJS("document.getElementById('questRow').hidden = false;");
    await sleep(300);

    const r = await evalJS(`(function(){
      var vw = window.innerWidth, vh = window.innerHeight;
      var hidden = [];
      var outOfView = [];
      var els = document.querySelectorAll('button, .cap, .quest, .ticker, .purse');
      els.forEach(function(el){
        var cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return;
        var b = el.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) return;
        var name = el.id || el.className || el.tagName;
        // 完全在视口外
        if (b.bottom <= 0 || b.top >= vh || b.right <= 0 || b.left >= vw) {
          outOfView.push(name);
          return;
        }
        // 部分被视口切掉（>2px）
        var cutBottom = b.bottom - vh;
        var cutTop = -b.top;
        var cutRight = b.right - vw;
        if (cutBottom > 2 || cutTop > 2 || cutRight > 2) {
          hidden.push(name + '(下切' + Math.round(Math.max(0,cutBottom)) + 'px)');
        }
      });

      // cab-side 的滚动情况
      var side = document.querySelector('.cab-side');
      var scrollInfo = null;
      if (side && getComputedStyle(side).display !== 'contents') {
        scrollInfo = {
          clientH: side.clientHeight, scrollH: side.scrollHeight,
          overflowing: side.scrollHeight > side.clientHeight + 2
        };
      }
      return { mode: document.body.dataset.mode, vw:vw, vh:vh,
               hidden: hidden, outOfView: outOfView, scrollInfo: scrollInfo };
    })()`);

    if (r && r.__err) { console.log(`✗ ${vp.tag}: ${r.__err}`); continue; }
    const issues = [];
    if (r.hidden.length) issues.push("被切: " + r.hidden.join(", "));
    if (r.outOfView.length) issues.push("视口外: " + r.outOfView.join(", "));
    if (r.scrollInfo && r.scrollInfo.overflowing) {
      issues.push(`右列需滚动 (${r.scrollInfo.scrollH} > ${r.scrollInfo.clientH})`);
    }
    const mark = issues.length ? "✗" : "✓";
    console.log(`${mark} ${vp.tag.padEnd(12)} ${String(vp.w).padStart(4)}×${String(vp.h).padEnd(4)} mode=${String(r.mode).padEnd(8)}`);
    if (issues.length) { issues.forEach(x => console.log(`     · ${x}`)); problems.push(vp.tag + ": " + issues.join("; ")); }
  }

  await cdp.send("Emulation.clearDeviceMetricsOverride");
  console.log("\n" + "=".repeat(60));
  console.log(problems.length ? `发现 ${problems.length} 个视口有问题` : "全部视口：交互元素都完整可见可点");
  problems.forEach(p => console.log("  · " + p));
  console.log("=".repeat(60));

  try { proc.kill(); } catch (e) { }
  dropProfile();
  srv.close();
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error("探针自身出错：", e); process.exit(2); });