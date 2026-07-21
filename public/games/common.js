// Shared helpers for the game views.
export const money = (c) => (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Standard two-column game layout: main stage + recent-bets sidebar. */
export function shell(root, { title, icon, accent, stage }) {
  root.innerHTML = `
    <div class="game" style="--accent:${accent}">
      <section class="card stage">
        <h2 class="game-title"><span class="dot" style="background:${accent}"></span>${icon} ${title}</h2>
        ${stage}
      </section>
      <section class="card recent"><h3>Recent bets</h3><ul id="recentList"></ul></section>
    </div>`;
}

export function renderRecent(ctx, gameKey) {
  const ul = document.getElementById("recentList");
  if (!ul) return;
  ul.innerHTML = "";
  ctx.state.recent.filter((b) => b.game === gameKey).slice(0, 20).forEach((b) => item(ul, b, true));
}

export function pushRecent(ctx, gameKey, detail, betCents, payoutCents, win, nonce, serverSeedHash, clientSeed) {
  const entry = {
    game: gameKey, detail, bet_cents: betCents, payout_cents: payoutCents, win: win ? 1 : 0,
    nonce, server_seed_hash: serverSeedHash, client_seed: clientSeed,
  };
  ctx.state.recent.unshift(entry);
  const ul = document.getElementById("recentList");
  if (ul) item(ul, entry, false);
}

function item(ul, b, append) {
  const win = b.win === 1 || b.win === true;
  const net = win ? `+${money(b.payout_cents - b.bet_cents)}` : `−${money(b.bet_cents)}`;
  const li = document.createElement("li");
  li.innerHTML = `<span class="badge ${win ? "win" : "lose"}">${win ? "WIN" : "LOSE"}</span>
    <span style="color:var(--faint);flex:1;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${b.detail}</span>
    <span class="amt ${win ? "win" : "lose"}">${net}</span>`;
  if (append) {
    ul.appendChild(li);
  } else {
    li.style.animation = "slideIn 0.3s ease"; // new bet slides in
    ul.prepend(li);
  }
  while (ul.children.length > 20) ul.lastChild.remove();
}

/** HTML for the standard bet-amount field (id-prefixed so multiple can't collide). */
export function stakeField(id) {
  return `<div class="fld"><span>Bet amount</span>
    <div class="stake-row">
      <input id="${id}" class="input" type="number" min="0.01" step="1" value="10" />
      <button class="mini" data-stake="half">½</button>
      <button class="mini" data-stake="double">2×</button>
    </div></div>`;
}
export function wireStake(id) {
  const input = document.getElementById(id);
  document.querySelectorAll("[data-stake]").forEach((b) =>
    b.addEventListener("click", () => {
      const v = Number(input.value) || 0;
      input.value = Math.max(0.01, b.dataset.stake === "half" ? v / 2 : v * 2).toFixed(2);
      input.dispatchEvent(new Event("input"));
    }),
  );
}
