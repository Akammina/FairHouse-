// Crash: a live rising multiplier that busts at a provably-fair point. Bet, then
// cash out before it crashes. The server streams the round over SSE and checks
// cash-outs against its own clock, so it can't be gamed. The bust point uses the
// same seed-derived formula as the old Limbo game.
//
// Auto Cash Out: set a target and the server cashes you out the moment it's hit,
// so a win doesn't depend on tapping at the exact millisecond (unreliable on a
// phone or laggy connection). Manual cash-out still works too.
import { CRASH_GROWTH_RATE, crashMultiplierAt } from "/shared/games.js";
import { shell, renderRecent, pushRecent, stakeField, wireStake } from "./common.js";

const ACCENT = "#38d0e0";

export function renderCrash(root, ctx) {
  // ?debug in the URL shows a live diagnostic readout.
  const DEBUG = new URLSearchParams(location.search).has("debug");
  shell(root, {
    title: "Crash", iconKey: "crash", accent: ACCENT,
    stage: `
      <div class="crash-wrap">
        <canvas id="ccanvas"></canvas>
        <div class="crash-mult" id="cmult">1.00×</div>
        <div class="crash-status" id="cstatus">Place a bet and cash out before it crashes.</div>
      </div>
      ${DEBUG ? '<pre id="cdbg" style="margin-top:10px;padding:10px;background:#0a0e17;border:1px solid #2a3a4a;border-radius:8px;font-size:11px;line-height:1.5;color:#8fe;white-space:pre-wrap;word-break:break-word;max-height:220px;overflow:auto">debug ready, place a bet</pre>' : ''}
      <div id="cSetup" style="margin-top:14px">
        ${stakeField("cStake")}
        <label class="auto-cash">Auto cash out at
          <span class="auto-input"><input id="cAuto" type="number" min="1.01" step="0.01" placeholder="off" inputmode="decimal" /><span>×</span></span>
        </label>
        <button id="cBet" class="btn" style="margin-top:14px;--accent:${ACCENT}">Place bet</button>
      </div>
      <button id="cCash" class="btn cashout" style="margin-top:14px;display:none">Cash out <span id="cCashVal" class="cash-val"></span></button>`,
  });
  renderRecent(ctx, "crash");
  wireStake("cStake");

  const $ = (id) => document.getElementById(id);
  const canvas = $("ccanvas");
  const g = canvas.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let round = null, es = null, startPerf = 0, cur = 1, crashed = false, cashed = false, animId = 0, pollTimer = 0, watchdog = 0, lastEventAt = 0;

  function size() {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = r.width * dpr; canvas.height = r.height * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  const onResize = () => { size(); draw(cur, perfElapsed(), crashed); };
  window.addEventListener("resize", onResize);
  ctx.onCleanup(() => { window.removeEventListener("resize", onResize); cancelAnimationFrame(animId); clearInterval(pollTimer); clearInterval(watchdog); if (es) es.close(); });
  size();

  const perfElapsed = () => performance.now() - startPerf;

  // diagnostics (only with ?debug)
  let dbgTicks = 0, dbgLastTickAt = 0, dbgLog = [];
  const now = () => (performance.now() / 1000).toFixed(1);
  function dbg(msg) {
    if (!DEBUG) return;
    dbgLog.unshift(`${now()}s  ${msg}`);
    dbgLog = dbgLog.slice(0, 9);
    renderDbg();
  }
  function renderDbg() {
    if (!DEBUG) return;
    const el = $("cdbg"); if (!el) return;
    const esState = es ? ["CONNECTING", "OPEN", "CLOSED"][es.readyState] : "none";
    const since = dbgLastTickAt ? Math.round(performance.now() - dbgLastTickAt) : "-";
    el.textContent =
      `SSE:${esState}  ticks:${dbgTicks}  sinceTick:${since}ms  poll:${pollTimer ? "ON" : "off"}\n` +
      `cur:${cur.toFixed(2)}×  round:${round ? "yes" : "no"}  crashed:${crashed}  cashed:${cashed}\n` +
      `─────\n` + dbgLog.join("\n");
  }

  function setSetup(on) { $("cSetup").style.display = on ? "" : "none"; $("cCash").style.display = on ? "none" : ""; }

  $("cBet").addEventListener("click", startGame);
  $("cCash").addEventListener("click", cashOut);

  async function startGame() {
    $("cBet").disabled = true;
    const autoRaw = Number($("cAuto").value);
    const autoCashout = Number.isFinite(autoRaw) && autoRaw >= 1.01 ? autoRaw : undefined;
    try {
      const res = await ctx.api("/api/crash/start", { stake: Number($("cStake").value), autoCashout });
      round = { roundId: res.roundId, stakeCents: res.betCents, nonce: res.nonce, serverSeedHash: res.serverSeedHash, clientSeed: res.clientSeed, autoCashout };
      ctx.applyResult(res);
      cur = 1; crashed = false; cashed = false; startPerf = performance.now(); clearInterval(pollTimer); pollTimer = 0;
      dbgTicks = 0; dbgLastTickAt = 0; dbgLog = []; dbg(`bet placed${autoCashout ? " auto@" + autoCashout : ""}`);
      $("cmult").className = "crash-mult"; $("cmult").textContent = "1.00×";
      $("cstatus").textContent = autoCashout ? `Auto cash out set at ${autoCashout.toFixed(2)}×` : "";
      $("cstatus").className = "crash-status";
      setSetup(false);
      ctx.sound.whoosh();
      lastEventAt = performance.now();
      openStream();
      startWatchdog();
      loop();
    } catch (e) {
      $("cstatus").textContent = e.message; $("cstatus").className = "crash-status lose";
    } finally {
      $("cBet").disabled = false;
    }
  }

  function openStream() {
    es = new EventSource(`/api/crash/stream?roundId=${round.roundId}`);
    es.addEventListener("open", () => dbg("SSE open"));
    es.addEventListener("tick", (e) => {
      lastEventAt = performance.now();
      dbgTicks++; dbgLastTickAt = performance.now();
      if (dbgTicks === 1) dbg("1st tick received");
      const m = JSON.parse(e.data).multiplier;
      startPerf = performance.now() - (Math.log(m) / CRASH_GROWTH_RATE) * 1000; // lock local clock to server progress
    });
    es.addEventListener("cashout", (e) => { lastEventAt = performance.now(); dbg("SSE cashout event"); onWin(JSON.parse(e.data)); }); // server auto-cashed us out
    es.addEventListener("crash", (e) => { lastEventAt = performance.now(); dbg("SSE crash event"); onCrash(JSON.parse(e.data).crashPoint); });
    // If the stream drops mid-round, poll the server so we don't get stuck.
    es.onerror = () => { dbg("SSE error → poll"); if (es) { es.close(); es = null; } if (round && !crashed && !cashed) startPolling(); };
  }

  // Some browsers (desktop Safari especially) open the SSE connection but deliver
  // nothing and never fire `error`. If it goes quiet for ~1.2s, fall back to
  // polling so the round always resolves.
  function startWatchdog() {
    clearInterval(watchdog);
    watchdog = setInterval(() => {
      if (!round || crashed || cashed) { clearInterval(watchdog); return; }
      if (!pollTimer && performance.now() - lastEventAt > 1200) { dbg("watchdog: SSE quiet → poll"); if (es) { es.close(); es = null; } startPolling(); }
    }, 400);
  }

  function startPolling() {
    if (pollTimer) return; // already polling
    pollTimer = setInterval(async () => {
      if (crashed || cashed || !round) { clearInterval(pollTimer); pollTimer = 0; return; }
      try {
        const s = await (await fetch(`/api/crash/status?roundId=${round.roundId}`)).json();
        if (s.ended) {
          clearInterval(pollTimer); pollTimer = 0;
          if (s.cashed && typeof s.multiplier === "number") onWin(s); // auto-cash-out landed
          else if (!s.cashed) onCrash(s.crashPoint ?? cur);
        } else if (typeof s.multiplier === "number") {
          startPerf = performance.now() - (Math.log(s.multiplier) / CRASH_GROWTH_RATE) * 1000;
        }
      } catch { /* keep trying */ }
    }, 500);
  }

  function loop() {
    if (crashed || cashed) return;
    // Smooth local animation, kept in sync with the server by the SSE ticks. The
    // cash-out we send locks in this value, and the server honors it (with a grace
    // window) as long as it's below the hidden bust point, so a tap a beat late
    // still wins. No display cap, so it stays smooth everywhere.
    cur = crashMultiplierAt(perfElapsed());
    $("cmult").textContent = cur.toFixed(2) + "×";
    // Only touch the inner value span (it ignores pointer events), never the
    // button text. Rewriting the button text every frame makes desktop Safari
    // drop the click (mousedown/up land on a text node that got replaced).
    if (round) {
      const amt = ctx.money(Math.floor(round.stakeCents * cur));
      const el = $("cCashVal");
      if (el && el.textContent !== amt) el.textContent = amt;
    }
    draw(cur, perfElapsed(), false);
    if (DEBUG) renderDbg();
    animId = requestAnimationFrame(loop);
  }

  async function cashOut() {
    if (!round || crashed || cashed) return;
    $("cCash").disabled = true;
    dbg(`cashout REQ at=${cur.toFixed(2)}`);
    try {
      // Send the multiplier we're showing so the server locks in what you saw.
      const res = await ctx.api("/api/crash/cashout", { roundId: round.roundId, at: cur });
      dbg(`cashout RESP ${res.crashed ? "crashed@" + res.crashPoint : "won@" + res.multiplier}`);
      if (res.crashed) { onCrash(res.crashPoint); return; } // it busted before you tapped
      onWin(res);
    } catch (e) {
      dbg(`cashout ERROR ${e.message}`);
      $("cstatus").textContent = e.message; $("cstatus").className = "crash-status lose";
    } finally {
      $("cCash").disabled = false;
    }
  }

  // Handles both manual cash-out and server auto-cash-out.
  function onWin(res) {
    if (cashed || crashed || !round) return;
    dbg(`WIN @${res.multiplier}`);
    cashed = true; cancelAnimationFrame(animId); clearInterval(pollTimer); pollTimer = 0; clearInterval(watchdog); if (es) { es.close(); es = null; }
    $("cCash").style.display = "none"; // no dead button to tap
    cur = res.multiplier;
    $("cmult").textContent = res.multiplier.toFixed(2) + "×"; $("cmult").className = "crash-mult win";
    $("cstatus").textContent = `Cashed out @ ${res.multiplier.toFixed(2)}×, won +${ctx.money(res.payoutCents - round.stakeCents)}`;
    $("cstatus").className = "crash-status win";
    draw(cur, perfElapsed(), false);
    ctx.sound.win();
    if (typeof res.balance === "number") ctx.applyResult({ balance: res.balance });
    pushRecent(ctx, "crash", `cashed @${res.multiplier.toFixed(2)}×`, round.stakeCents, res.payoutCents, true, round.nonce, round.serverSeedHash, round.clientSeed);
    endRound();
  }

  function onCrash(cp) {
    if (cashed || crashed) return;
    dbg(`CRASH @${cp}`);
    crashed = true; cancelAnimationFrame(animId); clearInterval(pollTimer); pollTimer = 0; clearInterval(watchdog); if (es) { es.close(); es = null; }
    $("cCash").style.display = "none"; // no dead button to tap
    cur = cp;
    $("cmult").textContent = cp.toFixed(2) + "×"; $("cmult").className = "crash-mult lose";
    $("cstatus").textContent = `Crashed @ ${cp.toFixed(2)}×, lost ${ctx.money(round.stakeCents)}`;
    $("cstatus").className = "crash-status lose";
    draw(cp, perfElapsed(), true);
    ctx.sound.lose();
    pushRecent(ctx, "crash", `busted @${cp.toFixed(2)}×`, round.stakeCents, 0, false, round.nonce, round.serverSeedHash, round.clientSeed);
    endRound();
  }

  function endRound() {
    round = null;
    setTimeout(() => { setSetup(true); $("cBet").textContent = "Place bet"; }, 1500);
  }

  function draw(mult, elapsedMs, isCrash) {
    const r = canvas.getBoundingClientRect(), W = r.width, H = r.height, pad = 10;
    g.clearRect(0, 0, W, H);
    const yMax = Math.max(2, mult * 1.15);
    const tMax = Math.max(6000, elapsedMs * 1.05);
    const color = isCrash ? "#ff5d6c" : ACCENT;
    // gridlines at each doubling
    g.strokeStyle = "rgba(255,255,255,0.05)"; g.lineWidth = 1;
    g.font = "10px ui-monospace, monospace"; g.fillStyle = "rgba(255,255,255,0.2)";
    for (let gl = 2; gl <= yMax; gl *= 2) {
      const y = H - pad - ((gl - 1) / (yMax - 1)) * (H - 2 * pad);
      g.beginPath(); g.moveTo(pad, y); g.lineTo(W - pad, y); g.stroke();
      g.fillText(gl + "×", pad + 2, y - 3);
    }
    const pts = [];
    for (let i = 0; i <= 60; i++) {
      const t = (elapsedMs * i) / 60, m = crashMultiplierAt(t);
      pts.push([pad + (t / tMax) * (W - 2 * pad), H - pad - ((m - 1) / (yMax - 1)) * (H - 2 * pad)]);
    }
    const last = pts[pts.length - 1] || [pad, H - pad];
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, isCrash ? "rgba(255,93,108,0.22)" : "rgba(56,208,224,0.22)");
    grad.addColorStop(1, "rgba(56,208,224,0)");
    g.fillStyle = grad;
    g.beginPath(); g.moveTo(pad, H - pad); pts.forEach(([x, y]) => g.lineTo(x, y)); g.lineTo(last[0], H - pad); g.closePath(); g.fill();
    g.strokeStyle = color; g.lineWidth = 3; g.lineJoin = "round"; g.shadowColor = color; g.shadowBlur = 16;
    g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); g.shadowBlur = 0;
    g.fillStyle = color; g.beginPath(); g.arc(last[0], last[1], isCrash ? 6 : 4.5, 0, Math.PI * 2); g.fill();
  }

  draw(1, 0, false);
  if (reduce) { /* animation still works; SSE drives the end */ }
}
