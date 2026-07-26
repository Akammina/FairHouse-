import { SLOT_PAYS } from "/shared/games.js";
import { shell, renderRecent, pushRecent, stakeField, wireStake, money } from "./common.js";
import { burst } from "../confetti.js";

const ACCENT = "#f5c451";
const SYMBOLS = ["💎", "7️⃣", "⭐", "🔔", "🍋", "🍒"]; // index 0 = best
const rnd = () => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];

export function renderSlots(root, ctx) {
  shell(root, {
    title: "Slots", icon: "🎰", accent: ACCENT,
    stage: `
      <div class="slot-machine">
        <div class="slot-marquee">★ SLEMANI SPINS ★</div>
        <div class="slot-window" id="slotWindow">
          ${[0, 1, 2].map(() => `
            <div class="reel"><div class="strip">
              ${["🍒", "🔔", "🍋"].map((s) => `<div class="cell">${s}</div>`).join("")}
            </div></div>`).join("")}
          <div class="payline" id="payline"></div>
        </div>
      </div>
      <div class="slot-banner" id="slotBanner">Line up three on the middle row to win.</div>
      <div class="slot-pay">${SYMBOLS.map((s, i) => `<span class="${i === 0 ? "top" : ""}">${s}×${SLOT_PAYS[i]}</span>`).join("")}</div>
      ${stakeField("slotStake")}
      <button id="slotSpin" class="btn" style="margin-top:14px;--accent:${ACCENT}">Spin</button>`,
  });
  renderRecent(ctx, "slots");
  wireStake("slotStake");

  const $ = (id) => document.getElementById(id);
  const reels = [...$("slotWindow").querySelectorAll(".reel")];
  const strips = reels.map((r) => r.querySelector(".strip"));
  const payline = $("payline");
  const banner = $("slotBanner");
  const btn = $("slotSpin");
  let spinning = false;

  const N = 44; // decorative symbols before the landing three (more = longer spin)

  btn.addEventListener("click", async () => {
    if (spinning) return;
    spinning = true; btn.disabled = true;
    payline.classList.remove("win");
    banner.className = "slot-banner"; banner.textContent = "";

    let res;
    try {
      res = await ctx.api("/api/slots/bet", { stake: Number($("slotStake").value) });
    } catch (e) {
      banner.textContent = e.message; banner.className = "slot-banner lose";
      spinning = false; btn.disabled = false;
      return;
    }

    // Build each reel: N random cells, then [above, RESULT, below]. Land RESULT on the payline.
    const durations = [2.0, 2.7, 3.4];
    ctx.sound.spin(durations[2]); // mechanical reel rattle for the whole spin
    strips.forEach((strip, i) => {
      const cells = [];
      for (let k = 0; k < N; k++) cells.push(rnd());
      cells.push(rnd(), SYMBOLS[res.reels[i]], rnd()); // indices N, N+1(result), N+2
      strip.innerHTML = cells.map((s) => `<div class="cell">${s}</div>`).join("");
      strip.style.transition = "none";
      strip.style.transform = "translateY(0)";
      void strip.offsetWidth; // reflow so the reset takes before we animate
      const cellH = strip.children[0].getBoundingClientRect().height;
      strip.style.transition = `transform ${durations[i]}s cubic-bezier(.16,.84,.3,1)`;
      strip.style.transform = `translateY(${-N * cellH}px)`; // centers RESULT on the middle row
      setTimeout(() => ctx.sound.reveal(), durations[i] * 1000);
    });

    setTimeout(() => finish(res), durations[2] * 1000 + 250);
  });

  function finish(res) {
    if (res.win) {
      payline.classList.add("win");
      strips.forEach((strip) => strip.children[N + 1]?.classList.add("win-cell")); // glow the winning symbols
      const net = res.payoutCents - res.betCents;
      banner.className = "slot-banner win";
      ctx.sound.win();
      const box = $("slotWindow").getBoundingClientRect();
      burst(box.left + box.width / 2, box.top + box.height / 2, res.multiplier >= 45 ? 1.7 : 1.2);
      countUp(banner, net, res.multiplier);
      setTimeout(() => strips.forEach((s) => s.children[N + 1]?.classList.remove("win-cell")), 2000);
    } else {
      banner.className = "slot-banner lose";
      banner.textContent = "No line — spin again.";
      ctx.sound.lose?.();
    }
    ctx.applyResult(res);
    pushRecent(ctx, "slots", `${res.reels.map((i) => SYMBOLS[i]).join("")} → ${res.multiplier}×`,
      res.betCents, res.payoutCents, res.win, res.nonce, res.serverSeedHash, res.clientSeed);
    spinning = false; btn.disabled = false;
  }

  // Animated win count-up in the banner.
  function countUp(el, net, mult) {
    const start = performance.now(), dur = 650;
    const step = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const val = Math.round(net * (1 - Math.pow(1 - t, 3)));
      el.textContent = `${mult}× — WIN +${money(val)}`;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}
