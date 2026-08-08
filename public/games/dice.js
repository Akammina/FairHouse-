import { diceMultiplier, DICE_TARGET_MIN, DICE_TARGET_MAX } from "/shared/games.js";
import { shell, renderRecent, pushRecent, stakeField, wireStake } from "./common.js";

export function renderDice(root, ctx) {
  shell(root, {
    title: "Dice", iconKey: "dice", accent: "var(--dice)",
    stage: `
      <p class="msg" id="dmsg" style="margin-bottom:6px">Set your win chance, then roll under your target</p>
      <div class="dice-track"><div class="dice-win" id="dwin"></div><div class="dice-pointer" id="dptr"><span id="dval">-</span></div></div>
      <div class="dice-ticks"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div>
      <input id="dtarget" class="slider" type="range" min="${DICE_TARGET_MIN}" max="${DICE_TARGET_MAX}" step="1" value="50" style="margin:28px 0 22px" />
      <div class="stat-row" style="margin-bottom:18px">
        <div class="stat prob-stat">
          <span class="l">Win chance</span>
          <span class="v prob-field"><input id="dchance" class="prob-input" type="number" min="${DICE_TARGET_MIN}" max="${DICE_TARGET_MAX}" step="0.01" value="50" inputmode="decimal" aria-label="Win chance percentage" /><span class="prob-pct">%</span></span>
        </div>
        <div class="stat"><span class="l">Multiplier</span><span class="v" id="dmult">1.98×</span></div>
        <div class="stat"><span class="l">Roll under</span><span class="v" id="dtargetv">50</span></div>
      </div>
      ${stakeField("dstake")}
      <button id="droll" class="btn" style="margin-top:14px">Roll dice</button>`,
  });
  renderRecent(ctx, "dice");
  wireStake("dstake");

  const $ = (id) => document.getElementById(id);
  const slider = $("dtarget");
  const chance = $("dchance");
  const clamp = (v) => Math.min(DICE_TARGET_MAX, Math.max(DICE_TARGET_MIN, v));
  const fmt = (v) => (Math.round(v * 100) / 100).toString(); // trim trailing zeros

  // `target` (the roll-under threshold) equals the win-chance %: a roll is uniform
  // over [0, 100), so P(roll < target) = target%. One number drives everything.
  let target = 50;

  function sync(source) {
    if (source !== "slider") slider.value = String(Math.round(target));
    if (source !== "input") chance.value = fmt(target);
    $("dwin").style.width = target + "%";
    $("dtargetv").textContent = fmt(target);
    $("dmult").textContent = diceMultiplier(target).toFixed(2) + "×";
  }

  slider.addEventListener("input", () => { target = clamp(Number(slider.value)); sync("slider"); });
  chance.addEventListener("input", () => {
    const v = Number(chance.value);
    if (!Number.isNaN(v) && chance.value !== "") { target = clamp(v); sync("input"); }
  });
  // On blur, normalise whatever was typed (empty / out of range) back to the real target.
  chance.addEventListener("blur", () => { chance.value = fmt(target); sync("input"); });
  sync("init");

  $("droll").addEventListener("click", async () => {
    $("droll").disabled = true;
    try {
      const res = await ctx.api("/api/dice/bet", { stake: Number($("dstake").value), target });
      $("dptr").style.left = res.roll + "%";
      $("dptr").className = "dice-pointer " + (res.win ? "win" : "lose");
      $("dval").textContent = res.roll.toFixed(2);
      $("dmsg").textContent = res.win
        ? `Rolled ${res.roll.toFixed(2)}, won +${ctx.money(res.payoutCents - res.betCents)}`
        : `Rolled ${res.roll.toFixed(2)}, lost ${ctx.money(res.betCents)}`;
      $("dmsg").className = "msg " + (res.win ? "win" : "lose");
      ctx.applyResult(res);
      pushRecent(ctx, "dice", `under ${res.target} → ${res.roll.toFixed(2)}`, res.betCents, res.payoutCents, res.win, res.nonce, res.serverSeedHash, res.clientSeed);
    } catch (e) {
      $("dmsg").textContent = e.message; $("dmsg").className = "msg lose";
    } finally {
      $("droll").disabled = false;
    }
  });
}
