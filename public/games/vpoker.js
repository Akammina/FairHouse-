import { shell, renderRecent, pushRecent, stakeField, wireStake, cardHTML } from "./common.js";
import { burst } from "../confetti.js";

const ACCENT = "#4caf82";
const PAYTABLE = [
  ["Royal Flush", 800], ["Straight Flush", 50], ["Four of a Kind", 25], ["Full House", 9],
  ["Flush", 6], ["Straight", 4], ["Three of a Kind", 3], ["Two Pair", 2], ["Jacks or Better", 1],
];

export function renderVpoker(root, ctx) {
  shell(root, {
    title: "Video Poker", iconKey: "vpoker", accent: ACCENT,
    stage: `
      <div class="vp-pay">${PAYTABLE.map(([n, m]) => `<span><b>${m}×</b> ${n}</span>`).join("")}</div>
      <div class="vp-hand" id="vpHand">${[0, 1, 2, 3, 4].map(() => `<div class="vp-slot">${cardHTML(37, "back")}</div>`).join("")}</div>
      <p class="msg" id="vpMsg" style="margin:14px 0">Deal, tap cards to hold, then draw.</p>
      <div id="vpDrawWrap" hidden><button id="vpDraw" class="btn" style="--accent:${ACCENT}">Draw</button></div>
      <div id="vpSetup">
        ${stakeField("vpStake")}
        <button id="vpDeal" class="btn" style="margin-top:14px;--accent:${ACCENT}">Deal</button>
      </div>`,
  });
  renderRecent(ctx, "vpoker");
  wireStake("vpStake");

  const $ = (id) => document.getElementById(id);
  const handEl = $("vpHand");
  let round = null, held = [false, false, false, false, false];

  const setDealing = (on) => { $("vpDrawWrap").hidden = !on; $("vpSetup").hidden = on; };

  function renderHand(cards, holdable) {
    handEl.innerHTML = cards.map((c, i) =>
      `<div class="vp-slot ${held[i] ? "held" : ""}" data-i="${i}">${cardHTML(c, "dealing")}<span class="vp-hold">HELD</span></div>`).join("");
    if (holdable) handEl.querySelectorAll(".vp-slot").forEach((s) =>
      s.addEventListener("click", () => { const i = Number(s.dataset.i); held[i] = !held[i]; s.classList.toggle("held", held[i]); ctx.sound.click(); }));
  }

  $("vpDeal").addEventListener("click", async () => {
    $("vpDeal").disabled = true;
    try {
      const res = await ctx.api("/api/vpoker/deal", { stake: Number($("vpStake").value) });
      round = { roundId: res.roundId, stakeCents: res.betCents, nonce: res.nonce, serverSeedHash: res.serverSeedHash, clientSeed: res.clientSeed };
      held = [false, false, false, false, false];
      ctx.applyResult(res);
      renderHand(res.hand, true);
      ctx.sound.reveal();
      $("vpMsg").textContent = "Tap cards to hold, then Draw."; $("vpMsg").className = "msg";
      setDealing(true);
    } catch (e) { $("vpMsg").textContent = e.message; $("vpMsg").className = "msg lose"; }
    finally { $("vpDeal").disabled = false; }
  });

  $("vpDraw").addEventListener("click", async () => {
    if (!round) return;
    $("vpDraw").disabled = true;
    try {
      const res = await ctx.api("/api/vpoker/draw", { roundId: round.roundId, holds: held });
      renderHand(res.hand, false);
      ctx.sound.reveal();
      $("vpMsg").textContent = res.win ? `${res.name}, ${res.multiplier}×, won +${ctx.money(res.payoutCents - res.betCents)}!` : `${res.name}`;
      $("vpMsg").className = "msg " + (res.win ? "win" : "lose");
      if (res.win) { ctx.sound.win(); const r = handEl.getBoundingClientRect(); burst(r.left + r.width / 2, r.top + r.height / 2, 1.3); }
      else ctx.sound.lose();
      ctx.applyResult(res);
      pushRecent(ctx, "vpoker", `${res.name} → ${res.multiplier}×`, res.betCents, res.payoutCents, res.win, round.nonce, round.serverSeedHash, round.clientSeed);
      round = null;
      setTimeout(() => setDealing(false), 200);
    } catch (e) { $("vpMsg").textContent = e.message; $("vpMsg").className = "msg lose"; }
    finally { $("vpDraw").disabled = false; }
  });

  setDealing(false);
}
