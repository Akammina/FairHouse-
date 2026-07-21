import { ROULETTE_RED, rouletteColor } from "/shared/games.js";
import { shell, renderRecent, pushRecent, stakeField, wireStake } from "./common.js";

const ACCENT = "#ff5d6c";
const TAU = Math.PI * 2;
const ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const OUTCOMES = [
  { type: "red", label: "Red" }, { type: "black", label: "Black" },
  { type: "odd", label: "Odd" }, { type: "even", label: "Even" },
  { type: "low", label: "1–18" }, { type: "high", label: "19–36" },
  { type: "dozen1", label: "1st 12" }, { type: "dozen2", label: "2nd 12" }, { type: "dozen3", label: "3rd 12" },
];
const BLACK = "#2c333f";
const pocketFill = (n) => (n === 0 ? "#2fa956" : ROULETTE_RED.has(n) ? "#d83a48" : BLACK);

export function renderRoulette(root, ctx) {
  shell(root, {
    title: "Roulette", icon: "🎡", accent: ACCENT,
    stage: `
      <div style="position:relative"><canvas id="rcanvas" style="width:100%;max-width:360px;aspect-ratio:1;display:block;margin:0 auto"></canvas></div>
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
  const step = TAU / 37;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let bet = { type: "red" };
  let rot = -Math.PI / 2, ballAngle = -Math.PI / 2, ballR = 0, landed = -1, spinning = false, anim = 0;

  function size() {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = r.width * dpr; canvas.height = r.height * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  const onResize = () => { size(); draw(); };
  window.addEventListener("resize", onResize);
  ctx.onCleanup(() => { window.removeEventListener("resize", onResize); cancelAnimationFrame(anim); });
  size();

  function draw() {
    const r = canvas.getBoundingClientRect(), W = r.width, cx = W / 2, cy = W / 2, R = W / 2 - 13;
    g.clearRect(0, 0, W, W);
    // gold rim frame
    g.beginPath(); g.arc(cx, cy, R + 9, 0, TAU); g.fillStyle = "#caa24c"; g.fill();
    g.beginPath(); g.arc(cx, cy, R + 9, 0, TAU); g.strokeStyle = "#7c5f27"; g.lineWidth = 2; g.stroke();
    for (let i = 0; i < 37; i++) {
      const n = ORDER[i], a0 = rot + i * step, a1 = a0 + step, isWin = landed >= 0 && n === landed;
      g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, a0, a1); g.closePath();
      g.fillStyle = pocketFill(n);
      if (isWin) { g.shadowColor = "#fff"; g.shadowBlur = 22; }
      g.fill(); g.shadowBlur = 0;
      g.strokeStyle = "#0a0e12"; g.lineWidth = 1.5; g.stroke(); // fret line between pockets
      if (isWin) { g.strokeStyle = "#fff"; g.lineWidth = 2; g.stroke(); }
      g.save(); g.translate(cx, cy); g.rotate(a0 + step / 2);
      g.fillStyle = "#fff"; g.font = `${isWin ? 800 : 700} 11px ui-monospace, monospace`; g.textAlign = "right"; g.textBaseline = "middle";
      g.fillText(String(n), R - 6, 0); g.restore();
    }
    // ball
    if (ballR > 0) {
      const bx = cx + Math.cos(ballAngle) * ballR, by = cy + Math.sin(ballAngle) * ballR;
      g.fillStyle = "#f4f6fb"; g.shadowColor = "#fff"; g.shadowBlur = 9;
      g.beginPath(); g.arc(bx, by, 5.5, 0, TAU); g.fill(); g.shadowBlur = 0;
    }
    // hub with result
    g.beginPath(); g.arc(cx, cy, R * 0.5, 0, TAU); g.fillStyle = "#0d1117"; g.fill();
    g.strokeStyle = "#caa24c"; g.lineWidth = 2; g.stroke();
    if (landed >= 0) {
      const c = rouletteColor(landed);
      g.fillStyle = c === "red" ? "#ff5d6c" : c === "green" ? "#33d17f" : "#c7d0dc";
      g.font = "800 36px ui-monospace, monospace"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(String(landed), cx, cy - 6);
      g.fillStyle = "#8a97a8"; g.font = "700 11px sans-serif";
      g.fillText(c.toUpperCase(), cx, cy + 18);
    }
    // pointer sits on the rim, pointing inward at the top pocket
    g.fillStyle = ACCENT; g.shadowColor = ACCENT; g.shadowBlur = 8;
    g.beginPath(); g.moveTo(cx, cy - R + 2); g.lineTo(cx - 9, cy - R - 12); g.lineTo(cx + 9, cy - R - 12); g.closePath(); g.fill();
    g.shadowBlur = 0;
  }
  draw();

  function spinTo(n, done) {
    landed = -1;
    const idx = ORDER.indexOf(n);
    const R = canvas.getBoundingClientRect().width / 2 - 13;
    const wheelFrom = rot;
    const targetAt = -Math.PI / 2 - (idx * step + step / 2);
    const wheelFinal = wheelFrom + TAU * 8 + (((targetAt - wheelFrom) % TAU + TAU) % TAU);
    const ballFrom = ballAngle;
    const ballFinal = -Math.PI / 2 - TAU * 16; // orbits the opposite way, lands at the top pointer
    if (reduce) { rot = ((wheelFinal % TAU) + TAU) % TAU; ballAngle = -Math.PI / 2; ballR = R * 0.66; landed = n; draw(); done(); return; }
    const dur = 4800, start = performance.now();
    cancelAnimationFrame(anim);
    (function frame(now) {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 5);
      rot = wheelFrom + (wheelFinal - wheelFrom) * eased;
      ballAngle = ballFrom + (ballFinal - ballFrom) * eased;
      // ball rides the outer rim, then drops into the pocket ring in the last 35%
      const drop = p < 0.65 ? 0 : (p - 0.65) / 0.35;
      ballR = R * (0.9 - 0.24 * (1 - Math.pow(1 - drop, 2)));
      draw();
      if (p < 1) anim = requestAnimationFrame(frame);
      else { rot = ((wheelFinal % TAU) + TAU) % TAU; ballAngle = -Math.PI / 2; ballR = R * 0.66; landed = n; draw(); done(); }
    })(performance.now());
  }

  document.querySelectorAll(".chip-bet").forEach((c) =>
    c.addEventListener("click", () => {
      bet = { type: c.dataset.type };
      document.querySelectorAll(".chip-bet").forEach((x) => x.classList.toggle("sel", x === c));
      $("rnum").value = "";
    }),
  );
  document.querySelector('.chip-bet[data-type="red"]').classList.add("sel");
  $("rnum").addEventListener("input", () => {
    const v = Number($("rnum").value);
    if (Number.isInteger(v) && v >= 0 && v <= 36) { bet = { type: "straight", number: v }; document.querySelectorAll(".chip-bet").forEach((c) => c.classList.remove("sel")); }
  });

  $("rspin").addEventListener("click", async () => {
    if (spinning) return;
    spinning = true; $("rspin").disabled = true;
    try {
      const res = await ctx.api("/api/roulette/bet", { stake: Number($("rstake").value), bet });
      $("rmsg").textContent = "No more bets — spinning…"; $("rmsg").className = "msg";
      spinTo(res.number, () => {
        $("rmsg").textContent = res.win
          ? `${res.number} ${res.color} — won +${ctx.money(res.payoutCents - res.betCents)}`
          : `${res.number} ${res.color} — lost ${ctx.money(res.betCents)}`;
        $("rmsg").className = "msg " + (res.win ? "win" : "lose");
        ctx.applyResult(res);
        const label = res.bet.type === "straight" ? `#${res.bet.number}` : res.bet.type;
        pushRecent(ctx, "roulette", `${label} → ${res.number} ${res.color}`, res.betCents, res.payoutCents, res.win);
        spinning = false; $("rspin").disabled = false;
      });
    } catch (e) {
      $("rmsg").textContent = e.message; $("rmsg").className = "msg lose";
      spinning = false; $("rspin").disabled = false;
    }
  });
}
