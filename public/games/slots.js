import { SLOT_PAYS } from "/shared/games.js";
import { shell, renderRecent, pushRecent, stakeField, wireStake } from "./common.js";
import { burst } from "../confetti.js";

const ACCENT = "#f5c451";
const SYMBOLS = ["💎", "7️⃣", "⭐", "🔔", "🍋", "🍒"];

export function renderSlots(root, ctx) {
  shell(root, {
    title: "Slots", icon: "🎰", accent: ACCENT,
    stage: `
      <div class="slot-reels" id="slotReels">
        ${[0, 1, 2].map(() => `<div class="slot-reel">🍒</div>`).join("")}
      </div>
      <p class="msg" id="slotMsg" style="margin:14px 0">Match three symbols to win.</p>
      <div class="slot-pay">${SYMBOLS.map((s, i) => `<span>${s} ${SLOT_PAYS[i]}×</span>`).join("")}</div>
      ${stakeField("slotStake")}
      <button id="slotSpin" class="btn" style="margin-top:14px;--accent:${ACCENT}">Spin</button>`,
  });
  renderRecent(ctx, "slots");
  wireStake("slotStake");

  const $ = (id) => document.getElementById(id);
  const reels = [...$("slotReels").children];
  let spinning = false;

  $("slotSpin").addEventListener("click", async () => {
    if (spinning) return;
    spinning = true; $("slotSpin").disabled = true;
    $("slotMsg").textContent = ""; $("slotMsg").className = "msg";
    reels.forEach((r) => r.classList.remove("win"));
    try {
      const res = await ctx.api("/api/slots/bet", { stake: Number($("slotStake").value) });
      reels.forEach((el, i) => {
        el.classList.add("spinning");
        const iv = setInterval(() => { el.textContent = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]; }, 60);
        setTimeout(() => {
          clearInterval(iv);
          el.textContent = SYMBOLS[res.reels[i]];
          el.classList.remove("spinning"); el.classList.add("landed");
          setTimeout(() => el.classList.remove("landed"), 280);
          ctx.sound.reveal();
          if (i === 2) finish(res);
        }, 700 + i * 350);
      });
    } catch (e) {
      $("slotMsg").textContent = e.message; $("slotMsg").className = "msg lose";
      spinning = false; $("slotSpin").disabled = false;
    }
  });

  function finish(res) {
    if (res.win) {
      reels.forEach((r) => r.classList.add("win"));
      $("slotMsg").textContent = `Three ${SYMBOLS[res.reels[0]]} — ${res.multiplier}× — won +${ctx.money(res.payoutCents - res.betCents)}!`;
      $("slotMsg").className = "msg win";
      ctx.sound.win();
      const r = $("slotReels").getBoundingClientRect();
      burst(r.left + r.width / 2, r.top + r.height / 2, 1.3);
    } else {
      $("slotMsg").textContent = "No match — try again."; $("slotMsg").className = "msg lose";
    }
    ctx.applyResult(res);
    pushRecent(ctx, "slots", `${res.reels.map((i) => SYMBOLS[i]).join("")} → ${res.multiplier}×`, res.betCents, res.payoutCents, res.win, res.nonce, res.serverSeedHash, res.clientSeed);
    spinning = false; $("slotSpin").disabled = false;
  }
}
