/**
 * Fairness & Odds page. Two things, both computed from the same shared math the
 * games use — nothing hard-coded:
 *   1. Each game's true RTP / house edge, computed live in the browser from its
 *      real paytable (the fixed-paytable games), with the instant games' designed
 *      1% edge confirmed by the Python Monte-Carlo lab.
 *   2. A live verifier: paste a server seed + client seed + nonce and recompute
 *      the outcome yourself.
 */
import { hmacSha256Hex } from "/shared/provablyFair.js";
import {
  diceRoll, limboResult, coinResult,
  rouletteNumber, rouletteColor,
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
