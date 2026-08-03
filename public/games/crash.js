// Crash — a live rising multiplier that busts at a provably-fair point. Bet, then
// cash out before it crashes. The server streams the round over SSE and validates
// cash-outs against its own clock, so it's cheat-proof; the bust point is the same
// seed-derived formula as the old Limbo game.
import { CRASH_GROWTH_RATE, crashMultiplierAt } from "/shared/games.js";
import { shell, renderRecent, pushRecent, stakeField, wireStake } from "./common.js";

const ACCENT = "#38d0e0";

export function renderCrash(root, ctx) {
  shell(root, {
    title: "Crash", iconKey: "crash", accent: ACCENT,
    stage: `
      <div class="crash-wrap">
        <canvas id="ccanvas"></canvas>
        <div class="crash-mult" id="cmult">1.00×</div>
        <div class="crash-status" id="cstatus">Place a bet and cash out before it crashes.</div>
      </div>
      <div id="cSetup" style="margin-top:14px">
        ${stakeField("cStake")}
        <button id="cBet" class="btn" style="margin-top:14px;--accent:${ACCENT}">Place bet</button>
      </div>
      <button id="cCash" class="btn cashout" style="margin-top:14px;display:none">Cash out</button>`,
  });
  renderRecent(ctx, "crash");
  wireStake("cStake");

  const $ = (id) => document.getElementById(id);
  const canvas = $("ccanvas");
  const g = canvas.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let round = null, es = null, startPerf = 0, cur = 1, crashed = false, cashed = false, animId = 0, pollTimer = 0;

  function size() {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = r.width * dpr; canvas.height = r.height * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  const onResize = () => { size(); draw(cur, perfElapsed(), crashed); };
  window.addEventListener("resize", onResize);
  ctx.onCleanup(() => { window.removeEventListener("resize", onResize); cancelAnimationFrame(animId); clearInterval(pollTimer); if (es) es.close(); });
  size();

  const perfElapsed = () => performance.now() - startPerf;

  function setSetup(on) { $("cSetup").style.display = on ? "" : "none"; $("cCash").style.display = on ? "none" : ""; }

  $("cBet").addEventListener("click", startGame);
  $("cCash").addEventListener("click", cashOut);

  async function startGame() {
    $("cBet").disabled = true;
    try {
      const res = await ctx.api("/api/crash/start", { stake: Number($("cStake").value) });
      round = { roundId: res.roundId, stakeCents: res.betCents, nonce: res.nonce, serverSeedHash: res.serverSeedHash, clientSeed: res.clientSeed };
      ctx.applyResult(res);
      cur = 1; crashed = false; cashed = false; startPerf = performance.now();
      $("cmult").className = "crash-mult"; $("cmult").textContent = "1.00×";
      $("cstatus").textContent = "";
      setSetup(false);
      ctx.sound.whoosh();
      openStream();
      loop();
    } catch (e) {
      $("cstatus").textContent = e.message; $("cstatus").className = "crash-status lose";
    } finally {
      $("cBet").disabled = false;
    }
  }

  function openStream() {
    es = new EventSource(`/api/crash/stream?roundId=${round.roundId}`);
    es.addEventListener("tick", (e) => {
      const m = JSON.parse(e.data).multiplier;
      startPerf = performance.now() - (Math.log(m) / CRASH_GROWTH_RATE) * 1000; // lock local clock to server progress
    });
    es.addEventListener("crash", (e) => onCrash(JSON.parse(e.data).crashPoint));
    // If the stream drops mid-round, don't get stuck — poll the server for the outcome.
    es.onerror = () => { if (es) { es.close(); es = null; } if (round && !crashed && !cashed) startPolling(); };
  }

  function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      if (crashed || cashed || !round) { clearInterval(pollTimer); return; }
      try {
        const s = await (await fetch(`/api/crash/status?roundId=${round.roundId}`)).json();
        if (s.ended) { clearInterval(pollTimer); if (!s.cashed) onCrash(s.crashPoint ?? cur); }
        else if (typeof s.multiplier === "number") startPerf = performance.now() - (Math.log(s.multiplier) / CRASH_GROWTH_RATE) * 1000;
      } catch { /* keep trying */ }
    }, 500);
  }

  function loop() {
    if (crashed || cashed) return;
    cur = crashMultiplierAt(perfElapsed());
    $("cmult").textContent = cur.toFixed(2) + "×";
    if (round) $("cCash").textContent = `Cash out  ${ctx.money(Math.floor(round.stakeCents * cur))}`;
    draw(cur, perfElapsed(), false);
    animId = requestAnimationFrame(loop);
  }

  async function cashOut() {
    if (!round || crashed || cashed) return;
    $("cCash").disabled = true;
    try {
      const res = await ctx.api("/api/crash/cashout", { roundId: round.roundId });
      if (res.crashed) { onCrash(res.crashPoint); return; } // it busted before the click landed
      cashed = true; cancelAnimationFrame(animId); clearInterval(pollTimer); if (es) { es.close(); es = null; }
      cur = res.multiplier;
      $("cmult").textContent = res.multiplier.toFixed(2) + "×"; $("cmult").className = "crash-mult win";
      $("cstatus").textContent = `Cashed out @ ${res.multiplier.toFixed(2)}× — won +${ctx.money(res.payoutCents - round.stakeCents)}`;
      $("cstatus").className = "crash-status win";
      draw(cur, perfElapsed(), false);
      ctx.sound.win(); ctx.applyResult(res);
      pushRecent(ctx, "crash", `cashed @${res.multiplier.toFixed(2)}×`, round.stakeCents, res.payoutCents, true, round.nonce, round.serverSeedHash, round.clientSeed);
      endRound();
    } catch (e) {
      $("cstatus").textContent = e.message; $("cstatus").className = "crash-status lose";
    } finally {
      $("cCash").disabled = false;
    }
  }

  function onCrash(cp) {
    if (cashed || crashed) return;
    crashed = true; cancelAnimationFrame(animId); clearInterval(pollTimer); if (es) { es.close(); es = null; }
    cur = cp;
    $("cmult").textContent = cp.toFixed(2) + "×"; $("cmult").className = "crash-mult lose";
    $("cstatus").textContent = `Crashed @ ${cp.toFixed(2)}× — lost ${ctx.money(round.stakeCents)}`;
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
    // gridlines at doubling multipliers
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
