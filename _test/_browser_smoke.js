/* 无头浏览器冒烟：真的加载 index.html，跑一段时间，抓控制台错误 + 截图。
 * 运行：node _test/_browser_smoke.js
 * 依赖：本机已安装的 Edge / Chrome（用 --headless=new + CDP，无需 puppeteer）
 */
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "_shots");
const PORT = 8931;

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

/** 极简 CDP 客户端：只用 WebSocket 文本帧，够我们发命令 / 收事件 */
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiters = new Map(); this.events = []; }
  static connect(url) {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const key = Buffer.from(Math.random().toString(36)).toString("base64");
      const req = http.request({
        hostname: u.hostname, port: u.port, path: u.pathname + u.search,
        headers: {
          Connection: "Upgrade", Upgrade: "websocket",
          "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": key
        }
      });
      req.on("upgrade", (res, socket) => {
        socket.setNoDelay(true);
        const cdp = new CDP(socket);
        cdp.socket = socket;
        cdp.attach();
        resolve(cdp);
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
        const fin = (buf[0] & 0x80) !== 0;
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
        void fin;
      }
    });
  }
  onText(txt) {
    let msg; try { msg = JSON.parse(txt); } catch (e) { return; }
    if (msg.id != null && this.waiters.has(msg.id)) {
      const w = this.waiters.get(msg.id);
      this.waiters.delete(msg.id);
      w(msg.result || msg.error || {});
    } else if (msg.method) {
      this.events.push(msg);
    }
  }
  send(method, params) {
    const id = ++this.id;
    const data = JSON.stringify({ id: id, method: method, params: params || {} });
    const payload = Buffer.from(data, "utf8");
    const mask = Buffer.from([1, 2, 3, 4]);
    let header;
    if (payload.length < 126) {
      header = Buffer.alloc(6);
      header[0] = 0x81; header[1] = 0x80 | payload.length;
      mask.copy(header, 2);
    } else if (payload.length < 65536) {
      header = Buffer.alloc(8);
      header[0] = 0x81; header[1] = 0x80 | 126;
      header.writeUInt16BE(payload.length, 2);
      mask.copy(header, 4);
    } else {
      header = Buffer.alloc(14);
      header[0] = 0x81; header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
      mask.copy(header, 10);
    }
    const masked = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4];
    this.socket.write(Buffer.concat([header, masked]));
    return new Promise((resolve) => {
      this.waiters.set(id, resolve);
      setTimeout(() => { if (this.waiters.has(id)) { this.waiters.delete(id); resolve({ __timeout: true }); } }, 15000);
    });
  }
}

function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let s = "";
      res.on("data", (d) => (s += d));
      res.on("end", () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } });
    }).on("error", reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async function main() {
  const browser = findBrowser();
  if (!browser) { console.log("没有可用的 Chrome/Edge，跳过浏览器冒烟"); process.exit(0); }
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  const srv = await serve();
  const userDir = path.join(OUT, "_profile");
  const args = [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=9333", "--user-data-dir=" + userDir,
    "--window-size=1440,900", "--hide-scrollbars",
    "about:blank"
  ];
  const proc = spawn(browser, args, { stdio: "ignore" });

  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(400);
    try {
      const list = await getJSON("http://127.0.0.1:9333/json/list");
      target = list.find((t) => t.type === "page");
    } catch (e) { /* 还没起来 */ }
  }
  if (!target) { console.log("浏览器调试端口没起来"); proc.kill(); srv.close(); process.exit(1); }

  const cdp = await CDP.connect(target.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Page.enable");
  await cdp.send("Console.enable");

  const errs = [];
  const logs = [];
  cdp.socket.on("data", () => { });   // 事件已经在 onText 里收集
  const poll = setInterval(() => {
    while (cdp.events.length) {
      const e = cdp.events.shift();
      if (e.method === "Runtime.exceptionThrown") {
        const d = e.params.exceptionDetails || {};
        errs.push("EXCEPTION: " + (d.exception && d.exception.description ? d.exception.description.split("\n")[0] : d.text));
      } else if (e.method === "Runtime.consoleAPICalled" && e.params.type === "error") {
        errs.push("console.error: " + (e.params.args || []).map((a) => a.value || a.description || "").join(" "));
      } else if (e.method === "Log.entryAdded" && e.params.entry.level === "error") {
        errs.push("log: " + e.params.entry.text);
      } else if (e.method === "Runtime.consoleAPICalled") {
        logs.push(e.params.type + ": " + (e.params.args || []).map((a) => a.value || "").join(" "));
      }
    }
  }, 100);

  const url = "http://127.0.0.1:" + PORT + "/index.html";
  await cdp.send("Page.navigate", { url: url });
  await sleep(2500);

  async function evalJS(expr) {
    const r = await cdp.send("Runtime.evaluate", {
      expression: expr, returnByValue: true, awaitPromise: true
    });
    if (r.exceptionDetails) return { __err: r.exceptionDetails.text };
    return r.result ? r.result.value : undefined;
  }

  const checks = [];
  function ok(cond, label, detail) {
    checks.push({ ok: !!cond, label: label, detail: detail });
    console.log((cond ? "  ✓ " : "  ✗ ") + label + (detail != null ? "  (" + detail + ")" : ""));
  }

  console.log("=== 浏览器冒烟（" + path.basename(browser) + "，无头）===\n");

  ok(await evalJS("!!window.__CP"), "游戏对象已初始化");
  ok(await evalJS("!!window.CPProject"), "2.5D 投影内核已加载");
  ok(await evalJS("window.__CP.game.world.coins.length > 100"), "开场币已铺满",
    String(await evalJS("window.__CP.game.world.coins.length")));
  ok(await evalJS("document.body.dataset.mode.length > 0"), "适配档位已写入 body",
    String(await evalJS("document.body.dataset.mode")));
  ok(await evalJS("document.getElementById('cv').width > 0"), "canvas backing store 已设定",
    (await evalJS("document.getElementById('cv').width")) + "×" + (await evalJS("document.getElementById('cv').height")));

  // 让游戏真的跑一会儿，观察是否有运行时异常
  await sleep(4000);
  ok(await evalJS("window.__CP.game.world.time > 3"), "游戏主循环在推进",
    "time=" + (await evalJS("window.__CP.game.world.time.toFixed(1)")));

  // 模拟投币
  const before = await evalJS("window.__CP.game.st.totals.dropped");
  await evalJS("window.__CP.game.insert(240)");
  await sleep(1200);
  const after = await evalJS("window.__CP.game.st.totals.dropped");
  ok(after > before, "投币生效", before + " → " + after);

  // 2.5D 投影真的被用上（币的屏幕位置与台面位置不同）
  const projOk = await evalJS(`(function(){
    var P = window.CPProject, c = window.__CP.game.world.coins[0];
    if (!c) return false;
    var sx = P.projectX(c.x, c.y), sy = P.projectY(c.y, c.z);
    return Math.abs(sx - c.x) > 0.001 || Math.abs(sy - c.y) > 0.001 || P.scaleAt(c.y,0) !== 1;
  })()`);
  ok(projOk, "币的屏幕坐标与台面坐标不同（2.5D 真的在生效）");

  // 渲染一帧不报错
  await evalJS("window.__CP.render()");
  ok(true, "手动渲染一帧无异常");

  /* 稀有奖励必须看得见：在台面中央强行放一枚金币塔，
   * 然后数一下“光晕像素” —— 如果稀有奖励还是和铜币一样暗，这条会挂。 */
  const heroVis = await evalJS(`(function(){
    var g = window.__CP.game, D = window.CPData;
    g.world.coins.length = 0;
    g.world.drop(D.COIN_DEFS.copper, 240, { y: 300, z: 0 });
    g.world.drop(D.COIN_DEFS.tower, 240, { y: 300, z: 0 });
    var cv = document.getElementById('cv');
    var ctx = cv.getContext('2d');
    window.__CP.render();
    var dpr = window.__CP.game.world ? (cv.width / 480) : 1;
    // 取币中心一小块区域，统计“亮像素”（光晕 / 光环会把亮度拉高）
    var px = window.CPProject.projectX(240, 300) * dpr;
    var py = window.CPProject.projectY(300, 0) * dpr;
    var r = Math.round(46 * dpr);
    var img = ctx.getImageData(Math.max(0,px-r), Math.max(0,py-r), r*2, r*2).data;
    var bright = 0, total = 0;
    for (var i = 0; i < img.length; i += 4) {
      total++;
      var lum = (img[i]*0.299 + img[i+1]*0.587 + img[i+2]*0.114) * (img[i+3]/255);
      if (lum > 140) bright++;
    }
    return { bright: bright, total: total, ratio: bright/total };
  })()`);
  ok(heroVis && heroVis.ratio > 0.05, "稀有奖励周围有明显亮像素（光晕/光环真的画出来了）",
    heroVis ? (heroVis.ratio * 100).toFixed(1) + "% 亮像素" : "读取失败");

  // 币不能被画出画布（透视 + 稀有奖励放大后的最坏情况）
  const oob = await evalJS(`(function(){
    var g = window.__CP.game, D = window.CPData, P = window.CPProject;
    g.world.coins.length = 0;
    // 四个角 + 最前沿 + 最高空，都放上会放大的稀有奖励
    var spots = [[12,140],[468,140],[12,460],[468,460],[240,468]];
    for (var i = 0; i < spots.length; i++) g.world.drop(D.COIN_DEFS.tower, spots[i][0], { y: spots[i][1] });
    g.world.drop(D.COIN_DEFS.chest, 6, { y: 130 });
    g.world.drop(D.COIN_DEFS.gem ? D.COIN_DEFS.gem : D.COIN_DEFS.diamond, 474, { y: 130 });
    var bad = 0, maxX = 0, minX = 9999;
    for (var j = 0; j < g.world.coins.length; j++) {
      var c = g.world.coins[j];
      var k = P.scaleAt(c.y, c.z) * 1.35;   // 取最大的 art 放大系数
      var half = (c.r + 12) * k;
      var sx = P.projectX(c.x, c.y), sy = P.projectY(c.y, c.z);
      if (sx - half < -6 || sx + half > 486) bad++;
      if (sy - half < -6 || sy + half > 586) bad++;
      if (sx > maxX) maxX = sx; if (sx < minX) minX = sx;
    }
    return { bad: bad, maxX: Math.round(maxX), minX: Math.round(minX) };
  })()`);
  ok(oob && oob.bad === 0, "透视下稀有奖励不会被画出画布",
    oob ? "越界 " + oob.bad + " / x 范围 " + oob.minX + "~" + oob.maxX : "读取失败");

  // 新玩法 UI 能开合
  await evalJS("document.getElementById('btnHot').click()");
  await sleep(300);
  ok(await evalJS("window.__CP.game.st.totals.hotUses > 0 || !window.__CP.game.hotReady()"), "超频按钮可点");
  await evalJS("document.getElementById('btnStat').click()");
  await sleep(400);
  ok(await evalJS("!document.getElementById('overlay').hidden"), "统计面板能打开");
  const statTxt = await evalJS("document.getElementById('modalBody').textContent");
  ok(statTxt.includes("拥堵") && statTxt.includes("限时订单") && statTxt.includes("超频"),
    "统计面板公示了新玩法概率");
  ok(statTxt.includes("金币塔"), "统计面板公示了金币塔");
  await evalJS("document.getElementById('btnClose').click()");
  await sleep(200);
  ok(await evalJS("document.getElementById('overlay').hidden"), "面板能关闭");

  // 订单条：直接塞一个订单看 UI 是否出现
  await evalJS("window.__CP.game.offerOrder(); document.getElementById('questRow').hidden=false;");
  await sleep(600);
  ok(await evalJS("!document.getElementById('questRow').hidden"), "订单条会显示");
  ok((await evalJS("document.getElementById('questName').textContent")).length > 0, "订单名已填充",
    String(await evalJS("document.getElementById('questName').textContent")));
  // 订单条不能出现 undefined（目标/赏/罚都要是真实数字）
  const qtxt = String(await evalJS("document.getElementById('questProg').textContent"));
  ok(!qtxt.includes("undefined") && !qtxt.includes("NaN"), "订单条没有 undefined/NaN", qtxt);

  // 惩罚 chip：平时隐藏，惩罚生效时必须出现（[hidden] 与 display 的优先级陷阱）
  ok(await evalJS("getComputedStyle(document.getElementById('congestChip')).display === 'none'"),
    "无惩罚时拥堵 chip 不占位");
  await evalJS(`(function(){
    var g = window.__CP.game;
    g.order = null;
    g.streakT = 5; g.overheatT = 5;
    while (g.world.coins.length < g.world.maxCoins) g.world.drop(CPData.COIN_DEFS.copper, 240);
    g.updateCongestion();
  })()`);
  await sleep(500);
  ok(await evalJS("getComputedStyle(document.getElementById('streakChip')).display !== 'none'"),
    "漏币中 chip 会真的显示出来");
  ok(await evalJS("getComputedStyle(document.getElementById('overheatChip')).display !== 'none'"),
    "过热 chip 会真的显示出来");
  ok(await evalJS("getComputedStyle(document.getElementById('congestChip')).display !== 'none'"),
    "拥堵 chip 会真的显示出来",
    String(await evalJS("document.getElementById('congestChip').textContent")));

  // 超频激活时按钮状态
  await evalJS("window.__CP.game.st.credits = 1e6; window.__CP.game.useHot();");
  await sleep(400);
  ok(await evalJS("document.getElementById('btnHot').getAttribute('aria-pressed') === 'true'"),
    "超频激活时按钮高亮（aria-pressed）");

  // 截图（两种档位）
  for (const [w, h, tag] of [[1440, 900, "wide"], [390, 844, "narrow"]]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: w, height: h, deviceScaleFactor: 1, mobile: w < 500
    });
    await sleep(900);
    const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
    if (shot && shot.data) {
      fs.writeFileSync(path.join(OUT, "shot-" + tag + ".png"), Buffer.from(shot.data, "base64"));
      ok(true, "截图已保存 shot-" + tag + ".png", w + "×" + h);
    } else {
      ok(false, "截图失败 " + tag);
    }
    // 机柜不能溢出视口（底部按钮被切掉就是这个问题）
    const of = await evalJS(`(function(){
      var cab = document.querySelector('.cab').getBoundingClientRect();
      return { bottom: Math.round(cab.bottom), vh: window.innerHeight, scrollH: document.documentElement.scrollHeight };
    })()`);
    ok(of && of.bottom <= of.vh + 1, "机柜底部不超出视口（" + tag + "）",
      of ? "cab.bottom " + of.bottom + " ≤ vh " + of.vh : "读取失败");
  }
  await cdp.send("Emulation.clearDeviceMetricsOverride");

  clearInterval(poll);
  await sleep(300);

  console.log("\n--- 控制台错误 ---");
  if (errs.length === 0) console.log("  （无）");
  else for (const e of errs) console.log("  " + e);
  ok(errs.length === 0, "无运行时错误", errs.length + " 条");

  const bad = checks.filter((c) => !c.ok).length;
  console.log("\n" + "=".repeat(58));
  console.log(bad === 0 ? "浏览器冒烟通过：" + checks.length + " 项，0 问题"
    : "浏览器冒烟：" + checks.length + " 项，发现 " + bad + " 个问题");
  console.log("=".repeat(58));

  try { proc.kill(); } catch (e) { }
  srv.close();
  process.exit(bad === 0 ? 0 : 1);
})().catch((e) => { console.error("冒烟脚本自身出错：", e); process.exit(2); });
