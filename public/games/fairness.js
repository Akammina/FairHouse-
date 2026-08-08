/**
 * Fairness & Odds page. Two things, both computed from the same shared math the
 * games use — nothing hard-coded:
 *   1. Each game's true RTP / house edge, computed live in the browser from its
 *      real paytable (the fixed-paytable games), with the instant games' designed
 *      1% edge confirmed by the Python Monte-Carlo lab.
 *   2. A live verifier: paste a server seed + client seed + nonce and recompute
 *      the outcome yourself.
 */
import { hmacSha256Hex, HOUSE_EDGE } from "/shared/provablyFair.js";
import {
  diceRoll, limboResult, coinResult, diceMultiplier, COIN_MULTIPLIER,
  rouletteNumber, rouletteColor, ROULETTE_RED,
  wheelSegment, wheelMultiplier, WHEEL_SEGMENTS,
  plinkoPath, plinkoBucket, plinkoMultiplier, PLINKO_MULTIPLIERS, PLINKO_ROWS,
  slotSpin, slotPayout, SLOT_PAYS, SLOT_COUNT,
  kenoDraw, KENO_PAYTABLE, KENO_POOL, KENO_DRAW,
  minesLayout,
} from "/shared/games.js";

const LAB_URL = "https://github.com/Akammina/FairHouse-/tree/main/math-lab";

// n-choose-k without overflow, for the exact paytable RTPs.
const choose = (n, k) => {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return r;
};

const rtpWheel = () => WHEEL_SEGMENTS.reduce((a, b) => a + b, 0) / WHEEL_SEGMENTS.length;
const rtpSlots = () => SLOT_PAYS.reduce((a, b) => a + b, 0) / SLOT_COUNT ** 3;
const rtpRoulette = () => (18 / 37) * 2; // even-money bet on a European wheel
const rtpPlinko = () =>
  PLINKO_MULTIPLIERS.reduce((s, m, k) => s + (choose(PLINKO_ROWS, k) / 2 ** PLINKO_ROWS) * m, 0);
const rtpKeno = (spots = 8) => {
  const total = choose(KENO_POOL, KENO_DRAW);
  let rtp = 0;
  for (let hits = 0; hits <= spots; hits++) {
    const ways = choose(spots, hits) * choose(KENO_POOL - spots, KENO_DRAW - hits);
    rtp += (ways / total) * (KENO_PAYTABLE[spots]?.[hits] ?? 0);
  }
  return rtp;
};

// rtp: return-to-player as a fraction. `computed` games are derived from their
// paytable here; the rest are edge-adjusted to 99% by design (see games.ts) and
// verified by the lab's simulation.
function oddsRows() {
  const rows = [
    { name: "Dice", bet: "any win chance", rtp: 0.99, computed: false },
    { name: "Coinflip", bet: "heads or tails", rtp: 0.99, computed: false },
    { name: "Limbo", bet: "any target", rtp: 0.99, computed: false },
    { name: "Crash", bet: "any cash-out", rtp: 0.99, computed: false },
    { name: "Mines", bet: "any layout", rtp: 0.99, computed: false },
    { name: "Dragon Tower", bet: "any difficulty", rtp: 0.99, computed: false },
    { name: "Hi-Lo", bet: "higher / lower", rtp: 0.99, computed: false },
    { name: "Wheel", bet: "single spin", rtp: rtpWheel(), computed: true },
    { name: "Roulette", bet: "even-money", rtp: rtpRoulette(), computed: true },
    { name: "Plinko", bet: "12 rows", rtp: rtpPlinko(), computed: true },
    { name: "Slots", bet: "three reels", rtp: rtpSlots(), computed: true },
    { name: "Keno", bet: "8 spots", rtp: rtpKeno(8), computed: true },
  ];
  return rows.sort((a, b) => b.rtp - a.rtp);
}

const edgeClass = (edge) => (edge <= 0.015 ? "edge-good" : edge <= 0.03 ? "edge-mid" : "edge-bad");

// ---- Live Monte-Carlo: one simulated round → payout multiplier per unit staked.
// Uniform sampling is equivalent to the HMAC's uniform entropy, so these match the
// real games (and the Python lab) exactly, just far faster.
const rint = (n) => Math.floor(Math.random() * n);
const SIM = {
  dice: { label: "Dice — roll under 50", theory: 0.99, play: () => (Math.random() * 100 < 50 ? diceMultiplier(50) : 0) },
  coinflip: { label: "Coinflip", theory: 0.99, play: () => (Math.random() < 0.5 ? COIN_MULTIPLIER : 0) },
  limbo: { label: "Limbo / Crash — cash out at 2×", theory: 0.99, play: () => ((1 - HOUSE_EDGE) / (1 - Math.random()) >= 2 ? 2 : 0) },
  wheel: { label: "Wheel", theory: rtpWheel(), play: () => WHEEL_SEGMENTS[rint(WHEEL_SEGMENTS.length)] },
  roulette: { label: "Roulette — bet red", theory: rtpRoulette(), play: () => { const n = rint(37); return n !== 0 && ROULETTE_RED.has(n) ? 2 : 0; } },
  plinko: { label: "Plinko — 12 rows", theory: rtpPlinko(), play: () => { let b = 0; for (let i = 0; i < PLINKO_ROWS; i++) if (Math.random() < 0.5) b++; return PLINKO_MULTIPLIERS[b]; } },
  slots: { label: "Slots — three reels", theory: rtpSlots(), play: () => { const a = rint(SLOT_COUNT), b = rint(SLOT_COUNT), c = rint(SLOT_COUNT); return a === b && b === c ? SLOT_PAYS[a] : 0; } },
  keno: { label: "Keno — 8 spots", theory: rtpKeno(8), play: () => { const drawn = new Set(); while (drawn.size < KENO_DRAW) drawn.add(1 + rint(KENO_POOL)); let hits = 0; for (let s = 1; s <= 8; s++) if (drawn.has(s)) hits++; return KENO_PAYTABLE[8][hits] ?? 0; } },
};

// Draw the running-RTP convergence chart on the canvas.
function drawSimChart(cv, points, theory) {
  if (!cv) return;
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth || 600, H = cv.clientHeight || 240;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const padL = 46, padR = 14, padT = 14, padB = 26;
  const th = theory * 100;
  let lo = th - 8, hi = th + 12;
  for (const [, r] of points) { const v = r * 100; if (v < lo) lo = v - 2; if (v > hi) hi = v + 2; }
  const maxN = points.length ? points[points.length - 1][0] : 1000;
  const lminN = 2; // log10(100)
  const lmaxN = Math.max(lminN + 0.5, Math.log10(maxN));
  const xmap = (n) => padL + (Math.log10(Math.max(100, n)) - lminN) / (lmaxN - lminN) * (W - padL - padR);
  const ymap = (v) => (H - padB) - (v - lo) / (hi - lo) * (H - padB - padT);

  g.font = "10px ui-monospace, monospace";
  // y gridlines + labels
  g.strokeStyle = "rgba(255,255,255,0.07)"; g.fillStyle = "#8a97a8"; g.lineWidth = 1;
  for (let k = 0; k <= 4; k++) {
    const v = lo + (hi - lo) * (k / 4);
    const y = ymap(v);
    g.beginPath(); g.moveTo(padL, y); g.lineTo(W - padR, y); g.stroke();
    g.fillText(v.toFixed(0) + "%", 6, y + 3);
  }
  // theoretical line (gold, dashed)
  g.strokeStyle = "#f5c451"; g.setLineDash([5, 4]); g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(padL, ymap(th)); g.lineTo(W - padR, ymap(th)); g.stroke();
  g.setLineDash([]);
  // running RTP line (accent)
  if (points.length > 1) {
    g.strokeStyle = "#38d0e0"; g.lineWidth = 2; g.lineJoin = "round";
    g.beginPath();
    points.forEach(([n, r], i) => { const x = xmap(n), y = ymap(r * 100); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
    const [ln, lr] = points[points.length - 1];
    g.fillStyle = "#38d0e0"; g.beginPath(); g.arc(xmap(ln), ymap(lr * 100), 3, 0, Math.PI * 2); g.fill();
  }
  // x label
  g.fillStyle = "#5a6675"; g.fillText("rounds (log scale) →", padL, H - 8);
}

export function renderFairness(root) {
  const rows = oddsRows();

  root.innerHTML = `
    <div class="fair-page">
      <header class="fair-hero">
        <div class="hero-badge"><span class="live-dot"></span> PROVABLY FAIR</div>
        <h1>Fairness &amp; Odds</h1>
        <p>Every outcome is committed before you bet and can be recomputed by anyone.
           Here's the exact house edge of each game — and a tool to verify any bet yourself.</p>
      </header>

      <section class="fair-card">
        <div class="fair-card-head">
          <h2>House edge, computed live</h2>
          <a class="fair-link" href="${LAB_URL}" target="_blank" rel="noopener">Full Monte-Carlo analysis →</a>
        </div>
        <p class="fair-sub">RTP = return to player over the long run. The paytable games below are
          computed right now in your browser from each game's real payout table; the rest are
          edge-adjusted to a 1% house edge by design and confirmed by the Python simulation lab.</p>
        <div class="odds-wrap">
          <table class="odds-table">
            <thead><tr><th>Game</th><th>Bet</th><th class="num">RTP</th><th class="num">House edge</th><th></th></tr></thead>
            <tbody>
              ${rows.map((r) => {
                const edge = 1 - r.rtp;
                return `<tr>
                  <td class="g-name">${r.name}</td>
                  <td class="g-bet">${r.bet}</td>
                  <td class="num">${(r.rtp * 100).toFixed(2)}%</td>
                  <td class="num"><span class="edge-pill ${edgeClass(edge)}">${(edge * 100).toFixed(2)}%</span></td>
                  <td class="g-src">${r.computed ? "computed" : "by design"}</td>
                </tr>`;
              }).join("")}
            </tbody>
          </table>
        </div>
        <p class="fair-foot">Notice the fixed-paytable games (Wheel, Roulette, Plinko, Slots) can't hit
          exactly 1% — their discrete payouts land the edge higher. Keno's 8-spot table is the harshest.
          The <a href="${LAB_URL}" target="_blank" rel="noopener">math-lab</a> proves these numbers by
          simulating millions of rounds.</p>
      </section>

      <section class="fair-card">
        <div class="fair-card-head">
          <h2>Run a Monte-Carlo simulation</h2>
          <a class="fair-link" href="${LAB_URL}" target="_blank" rel="noopener">Python lab (millions of rounds) →</a>
        </div>
        <p class="fair-sub">"Monte-Carlo" = play a game a huge number of times and measure what actually
          happens. Pick a game and hit run — it simulates rounds right here in your browser using the same
          math the casino uses, and you'll watch the measured return-to-player (blue) converge to its true
          value (gold dashed line).</p>
        <div class="sim-controls">
          <select id="simGame">
            ${Object.entries(SIM).map(([k, v], i) => `<option value="${k}"${i === 0 ? " selected" : ""}>${v.label}</option>`).join("")}
          </select>
          <button id="simRun" class="btn">Run 500,000 rounds</button>
        </div>
        <canvas id="simChart" class="sim-chart"></canvas>
        <div id="simOut" class="sim-out">Choose a game and press run.</div>
      </section>

      <section class="fair-card">
        <h2>Verify a bet</h2>
        <p class="fair-sub">After you rotate your seed (in the Provably Fair panel), paste the revealed
          server seed, your client seed, and the bet's nonce to reproduce its result.</p>
        <div class="verify-grid">
          <label>Server seed <input id="vfServer" placeholder="revealed server seed" autocomplete="off" /></label>
          <label>Client seed <input id="vfClient" placeholder="your client seed" autocomplete="off" /></label>
          <label>Nonce <input id="vfNonce" type="number" min="0" value="0" /></label>
        </div>
        <button id="vfRun" class="btn" style="margin-top:12px">Recompute outcome</button>
        <div id="vfOut" class="verify-out"></div>
      </section>
    </div>`;

  const $ = (id) => document.getElementById(id);

  // ---- Monte-Carlo runner ----
  let simRunning = false;
  drawSimChart($("simChart"), [], SIM[$("simGame").value].theory); // empty axes on load
  $("simGame").addEventListener("change", () => {
    if (!simRunning) { drawSimChart($("simChart"), [], SIM[$("simGame").value].theory); $("simOut").textContent = "Press run."; }
  });
  $("simRun").addEventListener("click", async () => {
    if (simRunning) return;
    simRunning = true;
    const btn = $("simRun"); btn.disabled = true; btn.textContent = "Running…";
    const cfg = SIM[$("simGame").value];
    const N = 500_000, batch = 4000;
    const points = [];
    let done = 0, total = 0, wins = 0;
    while (done < N) {
      const end = Math.min(done + batch, N);
      for (; done < end; done++) { const p = cfg.play(); total += p; if (p > 0) wins++; }
      points.push([done, total / done]);
      drawSimChart($("simChart"), points, cfg.theory);
      const rtp = total / done;
      $("simOut").innerHTML = `<b>${done.toLocaleString()}</b> rounds &nbsp;·&nbsp; measured RTP <b class="ok">${(rtp * 100).toFixed(2)}%</b> ` +
        `&nbsp;·&nbsp; house edge <b>${((1 - rtp) * 100).toFixed(2)}%</b> &nbsp;·&nbsp; hit rate ${((wins / done) * 100).toFixed(1)}% ` +
        `&nbsp;·&nbsp; theory <b style="color:#f5c451">${(cfg.theory * 100).toFixed(2)}%</b>`;
      await new Promise((r) => requestAnimationFrame(r)); // yield so the chart animates
    }
    btn.disabled = false; btn.textContent = "Run 500,000 rounds"; simRunning = false;
  });

  $("vfRun").addEventListener("click", async () => {
    const s = $("vfServer").value.trim();
    const c = $("vfClient").value.trim();
    const n = Number($("vfNonce").value);
    const out = $("vfOut");
    if (!s || !c || Number.isNaN(n)) {
      out.innerHTML = `<span class="vf-err">Fill in all three fields.</span>`;
      return;
    }
    const hmac = await hmacSha256Hex(s, `${c}:${n}`);
    const rn = rouletteNumber(hmac);
    const mines = (await minesLayout(hmac, 3)).join(", ");
    const keno = (await kenoDraw(hmac)).join(", ");
    const reels = slotSpin(hmac);
    out.innerHTML = `
      <div class="vf-hmac">HMAC-SHA256(seed, "${c}:${n}") = <span class="ok">${hmac.slice(0, 32)}…</span></div>
      <div class="vf-results">
        <span>Dice <b class="ok">${diceRoll(hmac).toFixed(2)}</b></span>
        <span>Limbo/Crash <b class="ok">${limboResult(hmac).toFixed(2)}×</b></span>
        <span>Coinflip <b class="ok">${coinResult(hmac)}</b></span>
        <span>Roulette <b class="ok">${rn} ${rouletteColor(rn)}</b></span>
        <span>Wheel <b class="ok">${wheelMultiplier(wheelSegment(hmac))}×</b></span>
        <span>Plinko <b class="ok">${plinkoMultiplier(plinkoBucket(plinkoPath(hmac)))}×</b></span>
        <span>Slots <b class="ok">[${reels.join(" ")}] ${slotPayout(reels) ? slotPayout(reels) + "×" : "—"}</b></span>
        <span>Mines (3) <b class="ok">${mines}</b></span>
        <span>Keno draw <b class="ok">${keno}</b></span>
      </div>`;
  });
}
