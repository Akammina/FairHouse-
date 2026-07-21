import { KENO_POOL, KENO_MAX_PICKS } from "/shared/games.js";
import { shell, renderRecent, pushRecent, stakeField, wireStake } from "./common.js";

const ACCENT = "#3b8ff0";

export function renderKeno(root, ctx) {
  shell(root, {
    title: "Keno", icon: "🔢", accent: ACCENT,
    stage: `
      <div class="keno-grid" id="kgrid"></div>
      <div class="keno-bar">
        <span id="kcount" class="keno-count">0 / ${KENO_MAX_PICKS} picked</span>
        <div style="display:flex;gap:6px">
          <button class="mini" id="kquick">Quick pick</button>
          <button class="mini" id="kclear">Clear</button>
        </div>
      </div>
      <p class="msg" id="kmsg" style="margin:10px 0 14px">Pick up to ${KENO_MAX_PICKS} numbers, then play</p>
      ${stakeField("kstake")}
      <button id="kplay" class="btn" style="margin-top:14px;--accent:${ACCENT}" disabled>Pick numbers to play</button>`,
  });
  renderRecent(ctx, "keno");
  wireStake("kstake");

  const $ = (id) => document.getElementById(id);
  const grid = $("kgrid");
  const picks = new Set();
  let locked = false;

  for (let n = 1; n <= KENO_POOL; n++) {
    const b = document.createElement("button");
    b.className = "knum"; b.textContent = n; b.dataset.n = n;
    b.addEventListener("click", () => toggle(n));
    grid.appendChild(b);
  }
  const tile = (n) => grid.children[n - 1];

  function clearMarks() {
    [...grid.children].forEach((t) => t.classList.remove("drawn", "hit", "miss"));
  }
  function toggle(n) {
    if (locked) { locked = false; clearMarks(); }
    if (picks.has(n)) picks.delete(n);
    else { if (picks.size >= KENO_MAX_PICKS) return; picks.add(n); }
    tile(n).classList.toggle("sel", picks.has(n));
    sync();
  }
  function sync() {
    $("kcount").textContent = `${picks.size} / ${KENO_MAX_PICKS} picked`;
    $("kplay").disabled = picks.size < 1;
    $("kplay").textContent = picks.size < 1 ? "Pick numbers to play" : `Play ${picks.size} number${picks.size > 1 ? "s" : ""}`;
  }

  $("kclear").addEventListener("click", () => {
    picks.clear(); locked = false; clearMarks();
    [...grid.children].forEach((t) => t.classList.remove("sel"));
    sync();
  });
  $("kquick").addEventListener("click", () => {
    picks.clear(); locked = false; clearMarks();
    [...grid.children].forEach((t) => t.classList.remove("sel"));
    while (picks.size < KENO_MAX_PICKS) picks.add(1 + Math.floor(Math.random() * KENO_POOL));
    picks.forEach((n) => tile(n).classList.add("sel"));
    sync();
  });

  $("kplay").addEventListener("click", async () => {
    $("kplay").disabled = true;
    try {
      const res = await ctx.api("/api/keno/bet", { stake: Number($("kstake").value), picks: [...picks] });
      clearMarks();
      res.draw.forEach((n) => tile(n).classList.add(picks.has(n) ? "hit" : "drawn"));
      picks.forEach((n) => { if (!res.draw.includes(n)) tile(n).classList.add("miss"); });
      locked = true;
      $("kmsg").textContent = res.win
        ? `${res.hits}/${res.picks.length} hits — ${res.multiplier}× — won +${ctx.money(res.payoutCents - res.betCents)}`
        : `${res.hits}/${res.picks.length} hits — ${res.multiplier}× — lost ${ctx.money(res.betCents)}`;
      $("kmsg").className = "msg " + (res.win ? "win" : "lose");
      ctx.applyResult(res);
      pushRecent(ctx, "keno", `${res.hits}/${res.picks.length} → ${res.multiplier}×`, res.betCents, res.payoutCents, res.win);
    } catch (e) {
      $("kmsg").textContent = e.message; $("kmsg").className = "msg lose";
    } finally {
      sync();
    }
  });

  sync();
}
