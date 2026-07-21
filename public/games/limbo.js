import { HOUSE_EDGE } from "/shared/provablyFair.js";
import { shell, renderRecent, pushRecent, stakeField, wireStake } from "./common.js";

export function renderLimbo(root, ctx) {
  shell(root, {
    title: "Limbo", icon: "🚀", accent: "var(--limbo)",
    stage: `
      <div id="ldisp" class="limbo-display">1.00×</div>
      <p class="msg" id="lmsg" style="margin-bottom:16px">Set a target — win if the roll reaches it</p>
      <div class="stat-row" style="margin-bottom:18px">
        <div class="stat"><span class="l">Target ×</span><span class="v" id="ltargetv">2.00×</span></div>
        <div class="stat"><span class="l">Win chance</span><span class="v" id="lchance">49.50%</span></div>
      </div>
      <div class="fld"><span>Target multiplier</span>
        <input id="ltarget" class="input" type="number" min="1.01" max="1000" step="0.01" value="2.00" /></div>
      <div style="margin-top:14px">${stakeField("lstake")}</div>
      <button id="lbet" class="btn" style="margin-top:14px">Bet</button>`,
  });
  renderRecent(ctx, "limbo");
  wireStake("lstake");

  const $ = (id) => document.getElementById(id);
  const target = () => Number($("ltarget").value);

  function sync() {
    const t = target();
    $("ltargetv").textContent = t.toFixed(2) + "×";
    $("lchance").textContent = t >= 1.01 ? ((100 * (1 - HOUSE_EDGE)) / t).toFixed(2) + "%" : "—";
  }
  $("ltarget").addEventListener("input", sync);
  sync();

  $("lbet").addEventListener("click", async () => {
    $("lbet").disabled = true;
    try {
      const res = await ctx.api("/api/limbo/bet", { stake: Number($("lstake").value), target: target() });
      const disp = $("ldisp");
      disp.className = "limbo-display " + (res.win ? "win" : "lose");
      disp.textContent = res.result.toFixed(2) + "×";
      $("lmsg").textContent = res.win
        ? `Rolled ${res.result.toFixed(2)}× — won +${ctx.money(res.payoutCents - res.betCents)}`
        : `Rolled ${res.result.toFixed(2)}× — needed ${res.target.toFixed(2)}× — lost ${ctx.money(res.betCents)}`;
      $("lmsg").className = "msg " + (res.win ? "win" : "lose");
      ctx.applyResult(res);
      pushRecent(ctx, "limbo", `@${res.target}× → ${res.result.toFixed(2)}×`, res.betCents, res.payoutCents, res.win);
    } catch (e) {
      $("lmsg").textContent = e.message; $("lmsg").className = "msg lose";
    } finally {
      $("lbet").disabled = false;
    }
  });
}
