// Full-screen "BIG WIN" celebration — a casino money-moment. Any game can fire it
// (wired centrally in app.js on large net wins). Rays, gold burst, count-up.
import { burst } from "./confetti.js";
import { Sound } from "./sound.js";

let active = false;
const fmt = (c) => (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function bigWin({ netCents, label = "BIG WIN!" }) {
  if (active) return;
  active = true;

  const el = document.createElement("div");
  el.className = "bigwin";
  el.innerHTML = `
    <div class="bw-rays"></div>
    <div class="bw-coins"></div>
    <div class="bw-content">
      <div class="bw-label">${label}</div>
      <div class="bw-amount" id="bwAmt">+0.00</div>
      <div class="bw-tap">tap to continue</div>
    </div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));

  // Raining gold coins.
  const rain = el.querySelector(".bw-coins");
  for (let i = 0; i < 42; i++) {
    const c = document.createElement("span");
    c.className = "bw-coin";
    c.textContent = "🪙";
    c.style.left = Math.random() * 100 + "%";
    c.style.fontSize = 16 + Math.random() * 22 + "px";
    c.style.animationDelay = Math.random() * 1.4 + "s";
    c.style.animationDuration = 1.6 + Math.random() * 1.8 + "s";
    rain.appendChild(c);
  }

  // count the amount up
  const amt = el.querySelector("#bwAmt");
  const start = performance.now(), dur = 1100;
  const step = (now) => {
    const t = Math.min(1, (now - start) / dur);
    amt.textContent = "+" + fmt(Math.round(netCents * (1 - Math.pow(1 - t, 3))));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);

  // gold bursts + fanfare
  const cx = innerWidth / 2, cy = innerHeight * 0.42;
  Sound.cashout?.();
  try { navigator.vibrate?.([40, 60, 40, 60, 90]); } catch { /* unsupported */ }
  burst(cx, cy, 2.3);
  setTimeout(() => burst(cx - 140, cy + 20, 1.5), 220);
  setTimeout(() => burst(cx + 140, cy + 20, 1.5), 420);

  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    el.classList.remove("show");
    setTimeout(() => { el.remove(); active = false; }, 380);
  };
  el.addEventListener("click", close);
  setTimeout(close, 2800);
}
