import { money } from "./common.js";

const GAME_ICON = { dice: "🎲", coinflip: "🪙", limbo: "🚀", mines: "💣", plinko: "🔻", roulette: "🎡", wheel: "🎯", keno: "🔢" };

export async function renderStats(root, ctx) {
  root.innerHTML = `<section class="card stage">
    <h2 class="game-title"><span class="dot" style="background:var(--gold)"></span>📊 Your Stats</h2>
    <div id="statsBody"><p class="msg">Loading…</p></div>
  </section>`;
  const body = document.getElementById("statsBody");

  let data;
  try { data = await ctx.api("/api/stats", {}); }
  catch (e) { body.innerHTML = `<p class="msg lose">${e.message}</p>`; return; }

  const o = data.overall;
  if (!o.rounds) {
    body.innerHTML = `<p class="msg">No bets yet — play a few games and your stats will show up here.</p>`;
    return;
  }

  const net = o.won - o.wagered;
  const rtp = o.wagered ? (o.won / o.wagered) * 100 : 0;
  const winRate = o.rounds ? (o.wins / o.rounds) * 100 : 0;
  const tiles = [
    ["Net profit", (net >= 0 ? "+" : "−") + money(Math.abs(net)), net >= 0 ? "good" : "bad"],
    ["Total wagered", money(o.wagered), ""],
    ["Total returned", money(o.won), ""],
    ["Return to player", rtp.toFixed(1) + "%", ""],
    ["Rounds played", String(o.rounds), ""],
    ["Win rate", winRate.toFixed(1) + "%", ""],
    ["Biggest single win", "+" + money(Math.max(0, o.biggestWin)), "good"],
  ];

  // Diverging net-per-game bars: profit right (green), loss left (red), centered at zero.
  const maxAbs = Math.max(1, ...data.byGame.map((g) => Math.abs(g.won - g.wagered)));
  const bars = data.byGame.map((g) => {
    const n = g.won - g.wagered;
    const w = (50 * Math.abs(n)) / maxAbs;
    const rtpG = g.wagered ? ((g.won / g.wagered) * 100).toFixed(0) : "0";
    const cls = n >= 0 ? "pos" : "neg";
    return `<div class="sbar-row">
      <div class="sbar-name">${GAME_ICON[g.game] || ""} <span>${g.game}</span><span class="sbar-sub">${g.rounds} rounds · RTP ${rtpG}%</span></div>
      <div class="sbar-track"><div class="sbar-fill ${cls}" style="width:${w}%"></div></div>
      <div class="sbar-val ${cls}">${n >= 0 ? "+" : "−"}${money(Math.abs(n))}</div>
    </div>`;
  }).join("");

  body.innerHTML = `
    <div class="stat-grid">
      ${tiles.map(([l, v, c]) => `<div class="stat-card"><span class="l">${l}</span><span class="v ${c}">${v}</span></div>`).join("")}
    </div>
    <div class="stats-headrow">
      <h3 class="stats-h3">Net profit by game</h3>
      <div class="stats-legend"><span class="lg pos">profit</span><span class="lg neg">loss</span></div>
    </div>
    <div class="stats-bars">${bars}</div>
    <p class="stats-note">Play money only. Over enough rounds, return-to-player converges toward 99% — the built-in 1% house edge.</p>`;
}
