import { money } from "./games/common.js";

const ICON = {
  dice: "🎲", coinflip: "🪙", crash: "📈", mines: "💣", plinko: "🔻", roulette: "🎡",
  wheel: "🎯", keno: "🔢", memory: "🃏", slots: "🎰", hilo: "🔼", vpoker: "🂡", blackjack: "♠️",
};
const medal = (i) => (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`);

export async function renderLeaderboard(root) {
  root.innerHTML = `<div class="lb-wrap"><h1 class="lb-title">🏆 Leaderboard</h1>
    <p class="lb-sub">The biggest winners across FairHouse.</p>
    <div class="lb-grid" id="lbGrid"><p class="lb-loading">Loading…</p></div></div>`;

  let data;
  try {
    data = await (await fetch("/api/leaderboard")).json();
  } catch {
    document.getElementById("lbGrid").innerHTML = `<p class="lb-loading">Couldn't load the leaderboard.</p>`;
    return;
  }

  const board = (title, rows, render) => `
    <section class="lb-card">
      <h2>${title}</h2>
      ${rows.length ? `<ol class="lb-list">${rows.map((r, i) => `
        <li class="${i < 3 ? "top" : ""}">
          <span class="lb-rank">${medal(i)}</span>
          <span class="lb-name">${r.alias}</span>
          ${render(r)}
        </li>`).join("")}</ol>` : `<p class="lb-empty">No bets yet — go play!</p>`}
    </section>`;

  document.getElementById("lbGrid").innerHTML =
    board("💰 Biggest Wins", data.biggestWins, (r) =>
      `<span class="lb-game">${ICON[r.game] || ""}</span><span class="lb-val win">+${money(r.netCents)}</span>`) +
    board("🚀 Top Multipliers", data.topMultipliers, (r) =>
      `<span class="lb-game">${ICON[r.game] || ""}</span><span class="lb-val mult">${r.mult}×</span>`) +
    board("👑 Richest Players", data.richest, (r) =>
      `<span class="lb-val">${money(r.balance)}</span>`);
}
