import { diceMultiplier } from "/shared/games.js";
import { shell, renderRecent, pushRecent, stakeField, wireStake } from "./common.js";

export function renderDice(root, ctx) {
  shell(root, {
    title: "Dice", icon: "🎲", accent: "var(--dice)",
    stage: `
      <p class="msg" id="dmsg" style="margin-bottom:6px">Roll under your target to win</p>
      <div class="dice-track"><div class="dice-win" id="dwin"></div><div class="dice-pointer" id="dptr"><span id="dval">—</span></div></div>
      <div class="dice-ticks"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div>
      <input id="dtarget" class="slider" type="range" min="2" max="98" step="1" value="50" style="margin:28px 0 22px" />
      <div class="stat-row" style="margin-bottom:18px">
        <div class="stat"><span class="l">Multiplier</span><span class="v" id="dmult">1.98×</span></div>
        <div class="stat"><span class="l">Roll under</span><span class="v" id="dtargetv">50</span></div>
        <div class="stat"><span class="l">Win chance</span><span class="v" id="dchance">50.00%</span></div>
      </div>
      ${stakeField("dstake")}
      <button id="droll" class="btn" style="margin-top:14px">Roll dice</button>`,
  });
  renderRecent(ctx, "dice");
  wireStake("dstake");

  const $ = (id) => document.getElementById(id);
  const target = () => Number($("dtarget").value);

  function sync() {
    $("dwin").style.width = target() + "%";
    $("dtargetv").textContent = target();
    $("dmult").textContent = diceMultiplier(target()).toFixed(2) + "×";
    $("dchance").textContent = target().toFixed(2) + "%";
  }
  $("dtarget").addEventListener("input", sync);
  sync();

  $("droll").addEventListener("click", async () => {
    $("droll").disabled = true;
    try {
      const res = await ctx.api("/api/dice/bet", { stake: Number($("dstake").value), target: target() });
      $("dptr").style.left = res.roll + "%";
      $("dptr").className = "dice-pointer " + (res.win ? "win" : "lose");
      $("dval").textContent = res.roll.toFixed(2);
      $("dmsg").textContent = res.win
        ? `Rolled ${res.roll.toFixed(2)} — won +${ctx.money(res.payoutCents - res.betCents)}`
        : `Rolled ${res.roll.toFixed(2)} — lost ${ctx.money(res.betCents)}`;
      $("dmsg").className = "msg " + (res.win ? "win" : "lose");
      ctx.applyResult(res);
      pushRecent(ctx, "dice", `under ${res.target} → ${res.roll.toFixed(2)}`, res.betCents, res.payoutCents, res.win);
    } catch (e) {
      $("dmsg").textContent = e.message; $("dmsg").className = "msg lose";
    } finally {
      $("droll").disabled = false;
    }
  });
}
