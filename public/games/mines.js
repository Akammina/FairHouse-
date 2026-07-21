import { shell, renderRecent, pushRecent, stakeField, wireStake } from "./common.js";

export function renderMines(root, ctx) {
  shell(root, {
    title: "Mines", icon: "💣", accent: "var(--mines)",
    stage: `
      <div class="stat-row" style="margin-bottom:16px">
        <div class="stat"><span class="l">Multiplier</span><span class="v" id="mmult">1.00×</span></div>
        <div class="stat"><span class="l">Gems</span><span class="v" id="mgems">0</span></div>
        <div class="stat"><span class="l">Profit</span><span class="v" id="mprofit">0.00</span></div>
      </div>
      <div class="mines-grid" id="mgrid"></div>
      <div id="msetup">
        <div class="fld"><span>Number of mines</span>
          <input id="mcount" class="input" type="number" min="1" max="24" value="3" /></div>
        <div style="margin-top:14px">${stakeField("mstake")}</div>
        <button id="mstart" class="btn" style="margin-top:14px">Start game</button>
      </div>
      <div id="mlive" hidden><button id="mcash" class="btn cashout">Cash out</button></div>
      <p class="msg" id="mmsg" style="margin-top:12px"></p>`,
  });
  renderRecent(ctx, "mines");
  wireStake("mstake");

  const $ = (id) => document.getElementById(id);
  const grid = $("mgrid");
  let round = null; // { roundId, mines, stakeCents }
  const revealed = new Set();

  // Build the 5×5 grid once.
  for (let i = 0; i < 25; i++) {
    const t = document.createElement("button");
    t.className = "tile"; t.dataset.tile = i; t.disabled = true;
    t.addEventListener("click", () => reveal(i));
    grid.appendChild(t);
  }
  const tileEl = (i) => grid.children[i];

  function setSetup(on) {
    $("msetup").hidden = !on;
    $("mlive").hidden = on;
    [...grid.children].forEach((t) => (t.disabled = on));
  }
  function resetBoard() {
    revealed.clear();
    [...grid.children].forEach((t) => { t.className = "tile"; t.textContent = ""; t.disabled = true; });
    $("mmult").textContent = "1.00×"; $("mgems").textContent = "0"; $("mprofit").textContent = "0.00";
  }
  function revealAllMines(layout) {
    layout.forEach((i) => { if (!revealed.has(i)) { tileEl(i).classList.add("mine"); tileEl(i).textContent = "💣"; } });
    [...grid.children].forEach((t, i) => { if (!revealed.has(i) && !layout.includes(i)) t.classList.add("dim"); t.disabled = true; });
  }
  function updateStats(mult, gems) {
    $("mmult").textContent = mult.toFixed(2) + "×";
    $("mgems").textContent = gems;
    const profit = Math.floor(round.stakeCents * mult) - round.stakeCents;
    $("mprofit").textContent = ctx.money(profit);
  }
  let resetTimer = 0;
  function endRound() {
    round = null;
    ctx.state.activeMines = null;
    resetTimer = setTimeout(() => { resetBoard(); setSetup(true); $("mmsg").textContent = ""; $("mmsg").className = "msg"; }, 1700);
  }
  ctx.onCleanup(() => clearTimeout(resetTimer));

  // Resume an in-progress round after a reload or navigating away and back.
  function resume(am) {
    round = { roundId: am.roundId, mines: am.mines, stakeCents: am.stakeCents };
    setSetup(false);
    (am.revealed || []).forEach((i) => { revealed.add(i); tileEl(i).classList.add("safe"); tileEl(i).textContent = "💎"; });
    [...grid.children].forEach((t, i) => (t.disabled = revealed.has(i)));
    updateStats(am.multiplier || 1, revealed.size);
    $("mmsg").textContent = `Resumed — ${am.mines} mines, ${revealed.size} safe. Cash out or keep going.`;
    $("mmsg").className = "msg";
  }

  $("mstart").addEventListener("click", async () => {
    $("mstart").disabled = true;
    try {
      const res = await ctx.api("/api/mines/start", { stake: Number($("mstake").value), mines: Number($("mcount").value) });
      round = { roundId: res.roundId, mines: res.mines, stakeCents: res.betCents };
      ctx.state.activeMines = { roundId: res.roundId, mines: res.mines, revealed: [], multiplier: 1, stakeCents: res.betCents };
      ctx.applyResult(res);
      resetBoard(); setSetup(false);
      [...grid.children].forEach((t) => (t.disabled = false));
      $("mmsg").textContent = `${res.mines} mines hidden — pick a tile`; $("mmsg").className = "msg";
    } catch (e) {
      $("mmsg").textContent = e.message; $("mmsg").className = "msg lose";
    } finally {
      $("mstart").disabled = false;
    }
  });

  async function reveal(i) {
    if (!round || revealed.has(i)) return;
    try {
      const res = await ctx.api("/api/mines/reveal", { roundId: round.roundId, tile: i });
      if (res.mine) {
        tileEl(i).classList.add("mine"); tileEl(i).textContent = "💣";
        revealAllMines(res.layout);
        $("mmsg").textContent = `Boom — lost ${ctx.money(round.stakeCents)}`; $("mmsg").className = "msg lose";
        ctx.applyResult(res);
        pushRecent(ctx, "mines", `${round.mines} mines, hit after ${revealed.size} safe`, round.stakeCents, 0, false);
        endRound();
        return;
      }
      revealed.add(i);
      tileEl(i).classList.add("safe"); tileEl(i).textContent = "💎"; tileEl(i).disabled = true;
      updateStats(res.multiplier, res.revealedCount);
      if (ctx.state.activeMines) { ctx.state.activeMines.revealed = [...revealed]; ctx.state.activeMines.multiplier = res.multiplier; }
      if (res.cashedOut) {
        revealAllMines(res.layout);
        $("mmsg").textContent = `Cleared the board! Won +${ctx.money(res.payoutCents - round.stakeCents)}`; $("mmsg").className = "msg win";
        ctx.applyResult(res);
        pushRecent(ctx, "mines", `${round.mines} mines, cleared all @${res.multiplier}×`, round.stakeCents, res.payoutCents, true);
        endRound();
      }
    } catch (e) {
      $("mmsg").textContent = e.message; $("mmsg").className = "msg lose";
    }
  }

  $("mcash").addEventListener("click", async () => {
    if (!round) return;
    $("mcash").disabled = true;
    try {
      const res = await ctx.api("/api/mines/cashout", { roundId: round.roundId });
      revealAllMines(res.layout);
      $("mmsg").textContent = `Cashed out @ ${res.multiplier.toFixed(2)}× — won +${ctx.money(res.payoutCents - round.stakeCents)}`;
      $("mmsg").className = "msg win";
      ctx.applyResult(res);
      pushRecent(ctx, "mines", `${round.mines} mines, cashed ${revealed.size} safe @${res.multiplier}×`, round.stakeCents, res.payoutCents, true);
      endRound();
    } catch (e) {
      $("mmsg").textContent = e.message; $("mmsg").className = "msg lose";
    } finally {
      $("mcash").disabled = false;
    }
  });

  if (ctx.state.activeMines && ctx.state.activeMines.roundId) resume(ctx.state.activeMines);
  else setSetup(true);
}
