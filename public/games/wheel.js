import { WHEEL_SEGMENTS } from "/shared/games.js";
import { shell, renderRecent, pushRecent, stakeField, wireStake } from "./common.js";

const ACCENT = "#33d17f";
const segColor = (m) => (m === 0 ? "#1c2530" : m >= 3 ? "#ff5d6c" : m >= 2 ? "#ff8a3d" : "#33d17f");

export function renderWheel(root, ctx) {
  shell(root, {
    title: "Wheel", icon: "🎯", accent: ACCENT,
    stage: `
      <div style="position:relative"><canvas id="wcanvas" style="width:100%;max-width:340px;aspect-ratio:1;display:block;margin:0 auto"></canvas></div>
      <p class="msg" id="wmsg" style="margin:10px 0 14px">Spin the wheel — segments pay their multiplier</p>
      ${stakeField("wstake")}
      <button id="wspin" class="btn" style="margin-top:14px;--accent:${ACCENT}">Spin wheel</button>`,
  });
  renderRecent(ctx, "wheel");
  wireStake("wstake");

  const $ = (id) => document.getElementById(id);
  const canvas = $("wcanvas");
  const g = canvas.getContext("2d");
  const N = WHEEL_SEGMENTS.length;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
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
    const step = (Math.PI * 2) / N;
    g.clearRect(0, 0, W, W);
    for (let i = 0; i < N; i++) {
      const a0 = rot + i * step, a1 = a0 + step;
      g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, a0, a1); g.closePath();
      g.fillStyle = segColor(WHEEL_SEGMENTS[i]); g.fill();
      g.strokeStyle = "#0d1117"; g.lineWidth = 1; g.stroke();
      if (WHEEL_SEGMENTS[i] > 0) {
        g.save(); g.translate(cx, cy); g.rotate(a0 + step / 2);
        g.fillStyle = "#08130c"; g.font = "700 11px ui-monospace, monospace"; g.textAlign = "right"; g.textBaseline = "middle";
        g.fillText(WHEEL_SEGMENTS[i] + "×", R - 8, 0); g.restore();
      }
    }
    g.beginPath(); g.arc(cx, cy, R * 0.5, 0, Math.PI * 2); g.fillStyle = "#0d1117"; g.fill();
    g.strokeStyle = "#2a323f"; g.lineWidth = 2; g.stroke();
    g.fillStyle = ACCENT; g.beginPath(); g.moveTo(cx, 2); g.lineTo(cx - 9, -12); g.lineTo(cx + 9, -12); g.closePath(); g.fill();
  }
  draw();

  function spinTo(seg, done) {
    const step = (Math.PI * 2) / N;
    const final = -Math.PI / 2 - (seg * step + step / 2) + Math.PI * 2 * 6;
    if (reduce) { rot = ((final % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2); draw(); done(); return; }
    const from = rot, dur = 2500, start = performance.now();
    cancelAnimationFrame(anim);
    (function frame(now) {
      const p = Math.min(1, (now - start) / dur);
      rot = from + (final - from) * (1 - Math.pow(1 - p, 3)); draw();
      if (p < 1) anim = requestAnimationFrame(frame); else done();
    })(performance.now());
  }

  $("wspin").addEventListener("click", async () => {
    $("wspin").disabled = true;
    try {
      const res = await ctx.api("/api/wheel/bet", { stake: Number($("wstake").value) });
      $("wmsg").textContent = "Spinning…"; $("wmsg").className = "msg";
      spinTo(res.segment, () => {
        $("wmsg").textContent = res.multiplier > 0
          ? `Landed ${res.multiplier}× — ${res.payoutCents > res.betCents ? "won +" + ctx.money(res.payoutCents - res.betCents) : "returned " + ctx.money(res.payoutCents)}`
          : `Landed 0× — lost ${ctx.money(res.betCents)}`;
        $("wmsg").className = "msg " + (res.win ? "win" : "lose");
        ctx.applyResult(res);
        pushRecent(ctx, "wheel", `→ ${res.multiplier}×`, res.betCents, res.payoutCents, res.win);
        $("wspin").disabled = false;
      });
    } catch (e) {
      $("wmsg").textContent = e.message; $("wmsg").className = "msg lose"; $("wspin").disabled = false;
    }
  });
}
