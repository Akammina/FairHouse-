import { ROULETTE_RED, rouletteColor } from "/shared/games.js";
import { shell, renderRecent, pushRecent, stakeField, wireStake } from "./common.js";

const ACCENT = "#ff5d6c";
const ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const OUTCOMES = [
  { type: "red", label: "Red" }, { type: "black", label: "Black" },
  { type: "odd", label: "Odd" }, { type: "even", label: "Even" },
  { type: "low", label: "1–18" }, { type: "high", label: "19–36" },
  { type: "dozen1", label: "1st 12" }, { type: "dozen2", label: "2nd 12" }, { type: "dozen3", label: "3rd 12" },
];

export function renderRoulette(root, ctx) {
  shell(root, {
    title: "Roulette", icon: "🎡", accent: ACCENT,
    stage: `
      <div style="position:relative"><canvas id="rcanvas" style="width:100%;max-width:340px;aspect-ratio:1;display:block;margin:0 auto"></canvas></div>
      <p class="msg" id="rmsg" style="margin:10px 0 14px">Pick a bet and spin</p>
      <div class="chips" id="chips">${OUTCOMES.map((o) => `<button class="chip-bet" data-type="${o.type}">${o.label}</button>`).join("")}</div>
      <div class="fld" style="margin-top:12px"><span>Or bet a single number (pays 35:1)</span>
        <input id="rnum" class="input" type="number" min="0" max="36" placeholder="0–36" /></div>
      <div style="margin-top:12px">${stakeField("rstake")}</div>
      <button id="rspin" class="btn" style="margin-top:14px;--accent:${ACCENT}">Spin</button>`,
  });
  renderRecent(ctx, "roulette");
  wireStake("rstake");

  const $ = (id) => document.getElementById(id);
  const canvas = $("rcanvas");
  const g = canvas.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let bet = { type: "red" };
  let rot = 0, anim = 0;

  function size() {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = r.width * dpr; canvas.height = r.height * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", () => { size(); draw(); });
  size();

  function draw() {
    const r = canvas.getBoundingClientRect(), W = r.width, cx = W / 2, cy = W / 2, R = W / 2 - 4;
    const step = (Math.PI * 2) / 37;
    g.clearRect(0, 0, W, W);
    for (let i = 0; i < 37; i++) {
      const n = ORDER[i], a0 = rot + i * step, a1 = a0 + step;
      g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, a0, a1); g.closePath();
      g.fillStyle = n === 0 ? "#2fa956" : ROULETTE_RED.has(n) ? "#d83a48" : "#1c2530"; g.fill();
      g.save();
      g.translate(cx, cy); g.rotate(a0 + step / 2);
      g.fillStyle = "#fff"; g.font = "700 10px ui-monospace, monospace"; g.textAlign = "right"; g.textBaseline = "middle";
      g.fillText(String(n), R - 6, 0); g.restore();
    }
    g.beginPath(); g.arc(cx, cy, R * 0.55, 0, Math.PI * 2); g.fillStyle = "#0d1117"; g.fill();
    g.strokeStyle = "#2a323f"; g.lineWidth = 2; g.stroke();
    // pointer at top
    g.fillStyle = ACCENT; g.beginPath(); g.moveTo(cx, 2); g.lineTo(cx - 9, -12); g.lineTo(cx + 9, -12); g.closePath();
    g.fill();
  }
  draw();

  function spinTo(n, done) {
    const idx = ORDER.indexOf(n), step = (Math.PI * 2) / 37;
    const target = -Math.PI / 2 - (idx * step + step / 2);
    const final = target + Math.PI * 2 * 6; // 6 turns
    if (reduce) { rot = ((final % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2); draw(); done(); return; }
    const from = rot, dur = 2600, start = performance.now();
    cancelAnimationFrame(anim);
    (function frame(now) {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      rot = from + (final - from) * eased; draw();
      if (p < 1) anim = requestAnimationFrame(frame); else done();
    })(performance.now());
  }

  function selectChip(el) {
    document.querySelectorAll(".chip-bet").forEach((c) => c.classList.toggle("sel", c === el));
    $("rnum").value = "";
  }
  document.querySelectorAll(".chip-bet").forEach((c) =>
    c.addEventListener("click", () => { bet = { type: c.dataset.type }; selectChip(c); }),
  );
  document.querySelector('.chip-bet[data-type="red"]').classList.add("sel");
  $("rnum").addEventListener("input", () => {
    const v = Number($("rnum").value);
    if (Number.isInteger(v) && v >= 0 && v <= 36) { bet = { type: "straight", number: v }; document.querySelectorAll(".chip-bet").forEach((c) => c.classList.remove("sel")); }
  });

  $("rspin").addEventListener("click", async () => {
    $("rspin").disabled = true;
    try {
      const res = await ctx.api("/api/roulette/bet", { stake: Number($("rstake").value), bet });
      $("rmsg").textContent = "Spinning…"; $("rmsg").className = "msg";
      spinTo(res.number, () => {
        $("rmsg").textContent = res.win
          ? `${res.number} ${res.color} — won +${ctx.money(res.payoutCents - res.betCents)}`
          : `${res.number} ${res.color} — lost ${ctx.money(res.betCents)}`;
        $("rmsg").className = "msg " + (res.win ? "win" : "lose");
        ctx.applyResult(res);
        const label = res.bet.type === "straight" ? `#${res.bet.number}` : res.bet.type;
        pushRecent(ctx, "roulette", `${label} → ${res.number} ${res.color}`, res.betCents, res.payoutCents, res.win);
        $("rspin").disabled = false;
      });
    } catch (e) {
      $("rmsg").textContent = e.message; $("rmsg").className = "msg lose"; $("rspin").disabled = false;
    }
  });
}
