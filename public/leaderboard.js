import { money } from "./games/common.js";
import { icon, gameIcon } from "./icons.js";

const medal = (i) => (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`);

export async function renderLeaderboard(root) {
  root.innerHTML = `<div class="lb-wrap"><h1 class="lb-title">${icon("trophy", { size: 26, cls: "lb-title-ico" })} Leaderboard</h1>
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
        </li>`).join("")}</ol>` : `<p class="lb-empty">No bets yet, go play!</p>`}
    </section>`;

  document.getElementById("lbGrid").innerHTML =
    board(`${icon("coins", { size: 16 })} Biggest Wins`, data.biggestWins, (r) =>
      `<span class="lb-game">${gameIcon(r.game, { size: 15 })}</span><span class="lb-val win">+${money(r.netCents)}</span>`) +
    board(`${icon("rocket", { size: 16 })} Top Multipliers`, data.topMultipliers, (r) =>
      `<span class="lb-game">${gameIcon(r.game, { size: 15 })}</span><span class="lb-val mult">${r.mult}×</span>`) +
    board(`${icon("wallet", { size: 16 })} Richest Players`, data.richest, (r) =>
      `<span class="lb-val">${money(r.balance)}</span>`);
}
