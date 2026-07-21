import { WHEEL_SEGMENTS } from "/shared/games.js";
import { shell, renderRecent, pushRecent, stakeField, wireStake } from "./common.js";

const ACCENT = "#33d17f";
const TAU = Math.PI * 2;
const segColor = (m) => (m === 0 ? "#20313f" : m >= 3 ? "#ff5d6c" : m >= 2 ? "#ff8a3d" : "#33d17f");

export function renderWheel(root, ctx) {
  shell(root, {
    title: "Wheel", icon: "🎯", accent: ACCENT,
    stage: `
      <div style="position:relative"><canvas id="wcanvas" style="width:100%;max-width:360px;aspect-ratio:1;display:block;margin:0 auto"></canvas></div>
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
  const step = TAU / N;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let rot = -Math.PI / 2, anim = 0, landed = -1, spinning = false;

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
    const r = canvas.getBoundingClientRect(), W = r.width, cx = W / 2, cy = W / 2, R = W / 2 - 6;
    g.clearRect(0, 0, W, W);
    // outer rim
    g.beginPath(); g.arc(cx, cy, R + 3, 0, TAU); g.fillStyle = "#0d1117"; g.fill();
    for (let i = 0; i < N; i++) {
      const a0 = rot + i * step, a1 = a0 + step;
      const isWin = i === landed;
      g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, a0, a1); g.closePath();
      g.fillStyle = segColor(WHEEL_SEGMENTS[i]);
      if (isWin) { g.shadowColor = segColor(WHEEL_SEGMENTS[i]); g.shadowBlur = 22; }
      g.fill(); g.shadowBlur = 0;
      g.strokeStyle = "rgba(0,0,0,0.45)"; g.lineWidth = 1.5; g.stroke();
      if (isWin) { g.strokeStyle = "#fff"; g.lineWidth = 2; g.stroke(); }
      if (WHEEL_SEGMENTS[i] > 0) {
        g.save(); g.translate(cx, cy); g.rotate(a0 + step / 2);
        g.fillStyle = "#08130c"; g.font = "800 12px ui-monospace, monospace"; g.textAlign = "right"; g.textBaseline = "middle";
        g.fillText(WHEEL_SEGMENTS[i] + "×", R - 9, 0); g.restore();
      }
    }
    // hub
    g.beginPath(); g.arc(cx, cy, R * 0.46, 0, TAU); g.fillStyle = "#0d1117"; g.fill();
    g.strokeStyle = "#2a323f"; g.lineWidth = 2; g.stroke();
    g.fillStyle = landed >= 0 ? segColor(WHEEL_SEGMENTS[landed]) : "#5a6675";
    g.font = "800 26px ui-monospace, monospace"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(landed >= 0 ? WHEEL_SEGMENTS[landed] + "×" : "SPIN", cx, cy);
    // pointer (top)
    g.fillStyle = ACCENT; g.shadowColor = ACCENT; g.shadowBlur = 10;
    g.beginPath(); g.moveTo(cx, 6); g.lineTo(cx - 11, -14); g.lineTo(cx + 11, -14); g.closePath(); g.fill();
    g.shadowBlur = 0;
  }
  draw();

  function spinTo(seg, done) {
    landed = -1;
    if (!reduce) ctx.sound.spin(4.6);
    const jitter = (Math.random() - 0.5) * step * 0.55;
    const targetAt = -Math.PI / 2 - (seg * step + step / 2) + jitter; // brings seg centre under the top pointer
    const from = rot;
    const deltaMod = ((targetAt - from) % TAU + TAU) % TAU;
    const final = from + TAU * 9 + deltaMod; // nine full turns, then settle
    if (reduce) { rot = final; landed = seg; draw(); done(); return; }
    const dur = 4600, start = performance.now();
    cancelAnimationFrame(anim);
    (function frame(now) {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 5); // fast whir → long slow settle
      rot = from + (final - from) * eased;
      draw();
      if (p < 1) anim = requestAnimationFrame(frame);
      else { rot = ((final % TAU) + TAU) % TAU; landed = seg; draw(); done(); }
    })(performance.now());
  }

  $("wspin").addEventListener("click", async () => {
    if (spinning) return;
    spinning = true; $("wspin").disabled = true;
    try {
      const res = await ctx.api("/api/wheel/bet", { stake: Number($("wstake").value) });
      $("wmsg").textContent = "Spinning…"; $("wmsg").className = "msg";
      spinTo(res.segment, () => {
        $("wmsg").textContent = res.multiplier > 0
          ? `Landed ${res.multiplier}× — ${res.payoutCents > res.betCents ? "won +" + ctx.money(res.payoutCents - res.betCents) : "returned " + ctx.money(res.payoutCents)}`
          : `Landed 0× — lost ${ctx.money(res.betCents)}`;
        $("wmsg").className = "msg " + (res.win ? "win" : "lose");
        ctx.applyResult(res);
        pushRecent(ctx, "wheel", `segment ${res.segment} → ${res.multiplier}×`, res.betCents, res.payoutCents, res.win, res.nonce, res.serverSeedHash, res.clientSeed);
        spinning = false; $("wspin").disabled = false;
      });
    } catch (e) {
      $("wmsg").textContent = e.message; $("wmsg").className = "msg lose";
      spinning = false; $("wspin").disabled = false;
    }
  });
}
