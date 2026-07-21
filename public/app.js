import { hmacSha256Hex } from "/shared/provablyFair.js";
import { diceRoll, limboResult, coinResult } from "/shared/games.js";
import { money } from "./games/common.js";
import { renderDice } from "./games/dice.js";
import { renderCoinflip } from "./games/coinflip.js";
import { renderLimbo } from "./games/limbo.js";
import { renderMines } from "./games/mines.js";

const $ = (id) => document.getElementById(id);

const state = { playerId: null, balance: 0, serverSeedHash: "", clientSeed: "", nonce: 0, recent: [] };

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

const ctx = {
  api,
  money,
  state,
  applyResult(res) {
    if (typeof res.balance === "number") { state.balance = res.balance; renderBalance(); }
    if (typeof res.nonce === "number") { state.nonce = res.nonce + 1; renderModal(); }
  },
  addRecent(entry) { state.recent.unshift(entry); },
};

// ---------- Router ----------
const routes = { "": renderLobby, dice: renderDice, coinflip: renderCoinflip, limbo: renderLimbo, mines: renderMines };
function route() {
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
  ];
  root.innerHTML = `
    <div class="lobby-hero">
      <h1>FairHouse</h1>
      <p>Four games, one wallet — every outcome cryptographically provable.</p>
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
function renderModal() {
  $("mCommit").textContent = state.serverSeedHash;
  $("mCommit").title = state.serverSeedHash;
  $("mClient").value = state.clientSeed;
  $("mNonce").textContent = state.nonce;
}
$("fairBtn").addEventListener("click", () => { renderModal(); $("fairModal").hidden = false; });
$("fairClose").addEventListener("click", () => ($("fairModal").hidden = true));
$("fairModal").addEventListener("click", (e) => { if (e.target.id === "fairModal") $("fairModal").hidden = true; });

$("mRotate").addEventListener("click", async () => {
  try {
    const r = await api("/api/rotate", { clientSeed: $("mClient").value.trim() });
    state.serverSeedHash = r.serverSeedHash; state.clientSeed = r.clientSeed; state.nonce = r.nonce;
    renderModal();
    $("mRevealed").innerHTML = `<b>Revealed server seed</b> — replay any past bet with it:<br>${r.revealedServerSeed}<br><span style="color:var(--muted)">its committed hash was ${r.revealedHash.slice(0, 28)}…</span>`;
  } catch (e) { $("mRevealed").innerHTML = `<span style="color:var(--lose)">${e.message}</span>`; }
});

$("vRun").addEventListener("click", async () => {
  const s = $("vServer").value.trim(), c = $("vClient").value.trim(), n = Number($("vNonce").value);
  if (!s || !c || Number.isNaN(n)) { $("vOut").innerHTML = `<span style="color:var(--lose)">Fill in all three fields.</span>`; return; }
  const hmac = await hmacSha256Hex(s, `${c}:${n}`);
  $("vOut").innerHTML =
    `hmac = <span class="ok">${hmac.slice(0, 24)}…</span><br>` +
    `→ Dice roll: <span class="ok">${diceRoll(hmac).toFixed(2)}</span><br>` +
    `→ Limbo: <span class="ok">${limboResult(hmac).toFixed(2)}×</span><br>` +
    `→ Coinflip: <span class="ok">${coinResult(hmac)}</span>`;
});

// prefill verifier when opening, so it's one click to check the last bet
$("fairBtn").addEventListener("click", () => {
  $("vServer").placeholder = "paste a revealed server seed";
  $("vClient").value = state.clientSeed;
});

// ---------- Init ----------
(async () => {
  try {
    const s = await api("/api/session", { playerId: localStorage.getItem("fairhouse_pid") });
    state.playerId = s.playerId;
    localStorage.setItem("fairhouse_pid", s.playerId);
    state.balance = s.balance; state.serverSeedHash = s.serverSeedHash; state.clientSeed = s.clientSeed; state.nonce = s.nonce; state.recent = s.recent || [];
    renderBalance();
    renderModal();
    route();
  } catch (e) {
    $("view").innerHTML = `<p style="color:var(--lose)">Couldn't start a session: ${e.message}</p>`;
  }
})();
