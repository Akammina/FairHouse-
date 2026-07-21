import { COIN_MULTIPLIER } from "/shared/games.js";
import { shell, renderRecent, pushRecent, stakeField, wireStake } from "./common.js";

export function renderCoinflip(root, ctx) {
  shell(root, {
    title: "Coinflip", icon: "🪙", accent: "var(--coin)",
    stage: `
      <div id="coin" class="coin">?</div>
      <p class="msg" id="cmsg" style="margin-bottom:14px">Pick a side and flip</p>
      <div class="fld"><span>Your pick</span>
        <div class="pick-row">
          <button class="pick active" data-side="heads">Heads</button>
          <button class="pick" data-side="tails">Tails</button>
        </div>
      </div>
      <div style="margin-top:14px">${stakeField("cstake")}</div>
      <button id="cflip" class="btn" style="margin-top:14px">Flip coin (${COIN_MULTIPLIER}×)</button>`,
  });
  renderRecent(ctx, "coinflip");
  wireStake("cstake");

  const $ = (id) => document.getElementById(id);
  let side = "heads";
  document.querySelectorAll(".pick").forEach((b) =>
    b.addEventListener("click", () => {
      side = b.dataset.side;
      document.querySelectorAll(".pick").forEach((x) => x.classList.toggle("active", x === b));
    }),
  );

  $("cflip").addEventListener("click", async () => {
    $("cflip").disabled = true;
    const coin = $("coin");
    coin.classList.remove("flip"); void coin.offsetWidth; coin.classList.add("flip");
    try {
      const res = await ctx.api("/api/coinflip/bet", { stake: Number($("cstake").value), side });
      setTimeout(() => {
        coin.classList.toggle("tails", res.result === "tails");
        coin.textContent = res.result === "heads" ? "H" : "T";
      }, 300);
      $("cmsg").textContent = res.win
        ? `${res.result.toUpperCase()} — won +${ctx.money(res.payoutCents - res.betCents)}`
        : `${res.result.toUpperCase()} — lost ${ctx.money(res.betCents)}`;
      $("cmsg").className = "msg " + (res.win ? "win" : "lose");
      ctx.applyResult(res);
      pushRecent(ctx, "coinflip", `${res.side} → ${res.result}`, res.betCents, res.payoutCents, res.win, res.nonce, res.serverSeedHash, res.clientSeed);
    } catch (e) {
      $("cmsg").textContent = e.message; $("cmsg").className = "msg lose";
    } finally {
      $("cflip").disabled = false;
    }
  });
}
