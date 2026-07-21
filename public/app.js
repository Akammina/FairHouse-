import { hmacSha256Hex, sha256Hex, betHmac } from "/shared/provablyFair.js";
import { diceRoll, limboResult, coinResult, rouletteNumber, rouletteColor, wheelSegment, wheelMultiplier, plinkoBucket, plinkoPath, plinkoMultiplier } from "/shared/games.js";
import { money } from "./games/common.js";
import { initBackground } from "./background.js";
import { renderDice } from "./games/dice.js";
import { renderCoinflip } from "./games/coinflip.js";
import { renderLimbo } from "./games/limbo.js";
import { renderMines } from "./games/mines.js";
import { renderPlinko } from "./games/plinko.js";
import { renderRoulette } from "./games/roulette.js";
import { renderWheel } from "./games/wheel.js";
import { renderKeno } from "./games/keno.js";

const $ = (id) => document.getElementById(id);

const state = { playerId: null, balance: 0, serverSeedHash: "", clientSeed: "", nonce: 0, recent: [], activeMines: null };

async function api(path, body) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playerId: state.playerId, ...body }) });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Request failed");
  return data;
}

let lastBalance = null;
function renderBalance() {
  const el = $("balance");
  el.textContent = money(state.balance);
  if (lastBalance !== null && state.balance !== lastBalance) {
    el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump");
    if (state.balance > lastBalance) {
      el.style.color = "var(--win)";
      setTimeout(() => (el.style.color = ""), 550);
    }
  }
  lastBalance = state.balance;
}

let cleanups = [];
const ctx = {
  api,
  money,
  state,
  onCleanup(fn) { cleanups.push(fn); },
  applyResult(res) {
    if (typeof res.balance === "number") { state.balance = res.balance; renderBalance(); }
    if (typeof res.nonce === "number") { state.nonce = res.nonce + 1; renderModal(); }
  },
  addRecent(entry) { state.recent.unshift(entry); },
};

// ---------- Router ----------
const routes = { "": renderLobby, dice: renderDice, coinflip: renderCoinflip, limbo: renderLimbo, mines: renderMines, plinko: renderPlinko, roulette: renderRoulette, wheel: renderWheel, keno: renderKeno };
function route() {
  cleanups.forEach((fn) => { try { fn(); } catch { /* ignore */ } }); // tear down the previous view
  cleanups = [];
  const key = location.hash.replace(/^#\/?/, "");
  document.querySelectorAll(".nav a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === `#/${key}`));
  const view = $("view");
  view.innerHTML = "";
  (routes[key] || renderLobby)(view, ctx);
}
window.addEventListener("hashchange", route);

function renderLobby(root) {
  const games = [
    { key: "dice", icon: "🎲", name: "Dice", tag: "Roll under your target to win.", accent: "var(--dice)" },
    { key: "coinflip", icon: "🪙", name: "Coinflip", tag: "Heads or tails, double or nothing.", accent: "var(--coin)" },
    { key: "limbo", icon: "🚀", name: "Limbo", tag: "Set a multiplier and see if it hits.", accent: "var(--limbo)" },
    { key: "mines", icon: "💣", name: "Mines", tag: "Uncover gems, dodge the mines, cash out.", accent: "var(--mines)" },
    { key: "plinko", icon: "🔻", name: "Plinko", tag: "Drop a ball into a multiplier bucket.", accent: "#e879f9" },
    { key: "roulette", icon: "🎡", name: "Roulette", tag: "Bet a number or color, spin the wheel.", accent: "#ff5d6c" },
    { key: "wheel", icon: "🎯", name: "Wheel", tag: "Spin for a multiplier segment.", accent: "#33d17f" },
    { key: "keno", icon: "🔢", name: "Keno", tag: "Pick numbers and match the draw.", accent: "#3b8ff0" },
  ];
  root.innerHTML = `
    <div class="lobby-hero">
      <h1>FairHouse</h1>
      <p>Eight games, one wallet — every outcome cryptographically provable.</p>
    </div>
    <div class="game-grid">
      ${games.map((g) => `
        <a class="game-card" href="#/${g.key}" style="--card-accent:${g.accent}">
          <div class="icon">${g.icon}</div>
          <h3>${g.name}</h3>
          <p>${g.tag}</p>
          <div class="play">Play ${g.name} →</div>
        </a>`).join("")}
    </div>`;
}

// ---------- Provably-fair modal ----------
const GAME_ICON = { dice: "🎲", coinflip: "🪙", limbo: "🚀", mines: "💣", plinko: "🔻", roulette: "🎡", wheel: "🎯", keno: "🔢" };
// Seeds we've revealed (hash → seed), kept so past bets stay verifiable across reloads.
const revealedSeeds = JSON.parse(localStorage.getItem("fairhouse_revealed") || "{}");
const saveRevealed = () => localStorage.setItem("fairhouse_revealed", JSON.stringify(revealedSeeds));

function renderModal() {
  $("mCommit").textContent = state.serverSeedHash;
  $("mCommit").title = state.serverSeedHash;
  $("mClient").value = state.clientSeed;
  $("mNonce").textContent = state.nonce;
  renderBetList();
}

function renderBetList() {
  const ul = $("betList");
  const bets = state.recent.slice(0, 15);
  if (!bets.length) {
    ul.innerHTML = `<li class="bl-empty">No bets yet — play a game, then come back to verify it.</li>`;
    $("pfHint").textContent = "";
    return;
  }
  const anyLocked = bets.some((b) => !revealedSeeds[b.server_seed_hash]);
  $("pfHint").innerHTML = anyLocked
    ? `Bets under your <b>current</b> seed are locked 🔒 — they can't be verified until the seed is revealed. Hit <b>Reveal &amp; verify</b> to unlock and auto-check them.`
    : `Every bet below is checked automatically. Click any row to see the exact math.`;
  ul.innerHTML = bets.map((b, i) => `
    <li class="bl-row" data-i="${i}">
      <span class="bl-game">${GAME_ICON[b.game] || ""} ${b.game}</span>
      <span class="bl-nonce">#${b.nonce}</span>
      <span class="bl-detail">${b.detail}</span>
      <span class="bl-status" id="bl-status-${i}">…</span>
    </li>`).join("");
  bets.forEach((b, i) => updateRowStatus(b, i));
  ul.querySelectorAll(".bl-row").forEach((row) => row.addEventListener("click", () => showRowMath(bets[Number(row.dataset.i)])));
}

async function recomputeOutcome(entry, seed) {
  const hmac = await betHmac(seed, entry.client_seed, entry.nonce);
  switch (entry.game) {
    case "dice": { const v = diceRoll(hmac).toFixed(2); return { key: v, text: `roll ${v}` }; }
    case "coinflip": { const v = coinResult(hmac); return { key: v, text: v }; }
    case "limbo": { const v = limboResult(hmac).toFixed(2) + "×"; return { key: v, text: v }; }
    case "roulette": { const n = rouletteNumber(hmac); const v = `${n} ${rouletteColor(n)}`; return { key: v, text: v }; }
    case "wheel": { const s = wheelSegment(hmac); const v = `${wheelMultiplier(s)}×`; return { key: v, text: `segment ${s} · ${v}` }; }
    case "plinko": { const bk = plinkoBucket(plinkoPath(hmac)); const v = `${plinkoMultiplier(bk)}×`; return { key: v, text: `bucket ${bk} · ${v}` }; }
    default: return null; // keno & mines also depend on your picks/board; seed authenticity is still proven
  }
}

async function updateRowStatus(entry, i) {
  const cell = $(`bl-status-${i}`);
  if (!cell) return;
  const seed = revealedSeeds[entry.server_seed_hash];
  if (!seed) { cell.innerHTML = `<span class="st-locked">🔒 reveal</span>`; return; }
  const hashOk = (await sha256Hex(seed)) === entry.server_seed_hash;
  const oc = await recomputeOutcome(entry, seed);
  const match = oc ? entry.detail.includes(oc.key) : null;
  cell.innerHTML = hashOk && match !== false ? `<span class="st-ok">✓ verified</span>` : `<span class="st-bad">✗ mismatch</span>`;
}

async function showRowMath(entry) {
  const seed = revealedSeeds[entry.server_seed_hash];
  if (!seed) { $("mRevealed").innerHTML = `<span style="color:var(--muted)">Bet #${entry.nonce}'s seed is still secret — hit “🔓 Reveal &amp; verify” first.</span>`; return; }
  const hmac = await betHmac(seed, entry.client_seed, entry.nonce);
  const oc = await recomputeOutcome(entry, seed);
  $("mRevealed").innerHTML =
    `<b>Bet #${entry.nonce} · ${entry.game}</b><br>` +
    `SHA256(server seed) = ${(await sha256Hex(seed)).slice(0, 20)}… ${((await sha256Hex(seed)) === entry.server_seed_hash) ? "✓ matches its commitment" : "✗"}<br>` +
    `HMAC(seed, "${entry.client_seed}:${entry.nonce}") = ${hmac.slice(0, 20)}…<br>` +
    (oc ? `recomputed → <span style="color:var(--win)">${oc.text}</span> · you saw “${entry.detail}”`
        : `outcome also depends on your picks/board — but the seed above is proven authentic`);
}

$("fairBtn").addEventListener("click", () => { renderModal(); $("vClient").value = state.clientSeed; $("fairModal").hidden = false; });
$("fairClose").addEventListener("click", () => ($("fairModal").hidden = true));
$("fairModal").addEventListener("click", (e) => { if (e.target.id === "fairModal") $("fairModal").hidden = true; });

$("mRotate").addEventListener("click", async () => {
  try {
    const r = await api("/api/rotate", { clientSeed: $("mClient").value.trim() });
    revealedSeeds[r.revealedHash] = r.revealedServerSeed; saveRevealed();
    state.serverSeedHash = r.serverSeedHash; state.clientSeed = r.clientSeed; state.nonce = r.nonce;
    renderModal();
    $("mRevealed").innerHTML = `<b>Revealed your previous server seed</b> — the bets above now show ✓. A fresh seed is committed for your next bets.`;
  } catch (e) { $("mRevealed").innerHTML = `<span style="color:var(--lose)">${e.message}</span>`; }
});

// Advanced manual verifier
$("vRun").addEventListener("click", async () => {
  const s = $("vServer").value.trim(), c = $("vClient").value.trim(), n = Number($("vNonce").value);
  if (!s || !c || Number.isNaN(n)) { $("vOut").innerHTML = `<span style="color:var(--lose)">Fill in all three fields.</span>`; return; }
  const hmac = await hmacSha256Hex(s, `${c}:${n}`);
  const rn = rouletteNumber(hmac);
  $("vOut").innerHTML =
    `hmac = <span class="ok">${hmac.slice(0, 24)}…</span><br>` +
    `→ Dice: <span class="ok">${diceRoll(hmac).toFixed(2)}</span> &nbsp; ` +
    `Limbo: <span class="ok">${limboResult(hmac).toFixed(2)}×</span> &nbsp; ` +
    `Coin: <span class="ok">${coinResult(hmac)}</span><br>` +
    `→ Roulette: <span class="ok">${rn} ${rouletteColor(rn)}</span> &nbsp; ` +
    `Wheel: <span class="ok">${wheelMultiplier(wheelSegment(hmac))}×</span> &nbsp; ` +
    `Plinko: <span class="ok">${plinkoMultiplier(plinkoBucket(plinkoPath(hmac)))}×</span>`;
});

// ---------- Init ----------
initBackground();
(async () => {
  try {
    const s = await api("/api/session", { playerId: localStorage.getItem("fairhouse_pid") });
    state.playerId = s.playerId;
    localStorage.setItem("fairhouse_pid", s.playerId);
    state.balance = s.balance; state.serverSeedHash = s.serverSeedHash; state.clientSeed = s.clientSeed; state.nonce = s.nonce; state.recent = s.recent || []; state.activeMines = s.activeMines || null;
    renderBalance();
    renderModal();
    route();
  } catch (e) {
    $("view").innerHTML = `<p style="color:var(--lose)">Couldn't start a session: ${e.message}</p>`;
  }
})();
