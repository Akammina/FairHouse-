import { PLINKO_ROWS, PLINKO_MULTIPLIERS } from "/shared/games.js";
import { shell, renderRecent, pushRecent, stakeField, wireStake } from "./common.js";

const ACCENT = "#e879f9";

export function renderPlinko(root, ctx) {
  shell(root, {
    title: "Plinko", iconKey: "plinko", accent: ACCENT,
    stage: `
      <div style="position:relative"><canvas id="pcanvas" style="width:100%;aspect-ratio:1/0.92;display:block"></canvas></div>
      <p class="msg" id="pmsg" style="margin:8px 0 14px">Drop the ball and watch where it lands</p>
      ${stakeField("pstake")}
      <button id="pdrop" class="btn" style="margin-top:14px;--accent:${ACCENT}">Drop ball</button>`,
  });
  renderRecent(ctx, "plinko");
  wireStake("pstake");

  const $ = (id) => document.getElementById(id);
  const canvas = $("pcanvas");
  const g = canvas.getContext("2d");
  const R = PLINKO_ROWS;
  let anim = 0;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  function size() {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = r.width * dpr; canvas.height = r.height * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  const onResize = () => { size(); draw(null, -1); };
  window.addEventListener("resize", onResize);
  ctx.onCleanup(() => { window.removeEventListener("resize", onResize); cancelAnimationFrame(anim); });
  size();

  const bucketColor = (m) => (m >= 10 ? "#ff5d6c" : m >= 2 ? "#ff8a3d" : m > 1 ? "#f5c451" : m === 1 ? "#8a97a8" : "#3b8ff0");

  function geom() {
    const r = canvas.getBoundingClientRect();
    const W = r.width, H = r.height, padTop = 22, bucketH = 34;
    const gapX = W / (R + 2);
    const gapY = (H - padTop - bucketH - 16) / R;
    const cx = W / 2;
    const anchorX = (rights, k) => cx + (rights - k / 2) * gapX;
    return { W, H, padTop, bucketH, gapX, gapY, cx, anchorX };
  }

  function draw(path, ballT, landed = -1) {
    const { W, H, padTop, bucketH, gapX, gapY, cx, anchorX } = geom();
    g.clearRect(0, 0, W, H);
    // pegs
    g.fillStyle = "rgba(255,255,255,0.22)";
    for (let i = 0; i < R; i++) {
      for (let j = 0; j <= i + 1; j++) {
        const x = cx + (j - (i + 1) / 2) * gapX;
        const y = padTop + (i + 0.5) * gapY;
        g.beginPath(); g.arc(x, y, 2.4, 0, Math.PI * 2); g.fill();
      }
    }
    // buckets
    const by = padTop + R * gapY + 8;
    for (let b = 0; b <= R; b++) {
      const x = anchorX(b, R) - gapX / 2 + 1;
      const col = bucketColor(PLINKO_MULTIPLIERS[b]);
      g.fillStyle = b === landed ? col : col + "33";
      g.strokeStyle = col + (b === landed ? "" : "55");
      roundRect(g, x, by, gapX - 2, bucketH, 6); g.fill();
      g.fillStyle = b === landed ? "#0a0e12" : col;
      g.font = `700 ${Math.min(12, gapX * 0.42)}px ui-monospace, monospace`;
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(PLINKO_MULTIPLIERS[b] + "×", x + gapX / 2 - 1, by + bucketH / 2);
    }
    // ball
    if (path && ballT >= 0) {
      const k = Math.min(Math.floor(ballT), R);
      const frac = ballT - k;
      const rightsK = path.slice(0, k).reduce((a, b) => a + b, 0);
      const rightsK1 = rightsK + (path[k] || 0);
      const x0 = anchorX(rightsK, k), x1 = anchorX(rightsK1, k + 1);
      const y0 = padTop + k * gapY, y1 = padTop + (k + 1) * gapY;
      const x = x0 + (x1 - x0) * frac;
      const y = y0 + (y1 - y0) * frac - Math.sin(frac * Math.PI) * gapY * 0.35;
      g.fillStyle = ACCENT; g.shadowColor = ACCENT; g.shadowBlur = 16;
      g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0;
    }
  }
  draw(null, -1);

  function play(res, done) {
    ctx.sound.whoosh();
    if (reduce) { draw(res.path, R, res.bucket); done(); return; }
    const dur = 1150, start = performance.now();
    cancelAnimationFrame(anim);
    (function frame(now) {
      const p = Math.min(1, (now - start) / dur);
      draw(res.path, p * R, p >= 1 ? res.bucket : -1);
      if (p < 1) anim = requestAnimationFrame(frame); else done();
    })(performance.now());
  }

  $("pdrop").addEventListener("click", async () => {
    $("pdrop").disabled = true;
    try {
      const res = await ctx.api("/api/plinko/bet", { stake: Number($("pstake").value) });
      $("pmsg").textContent = "Dropping..."; $("pmsg").className = "msg";
      play(res, () => {
        $("pmsg").textContent = `Landed on ${res.multiplier}×, ${res.payoutCents > res.betCents ? "won +" + ctx.money(res.payoutCents - res.betCents) : "returned " + ctx.money(res.payoutCents)}`;
        $("pmsg").className = "msg " + (res.win ? "win" : "lose");
        ctx.applyResult(res);
        pushRecent(ctx, "plinko", `bucket ${res.bucket} → ${res.multiplier}×`, res.betCents, res.payoutCents, res.win, res.nonce, res.serverSeedHash, res.clientSeed);
        $("pdrop").disabled = false;
      });
    } catch (e) {
      $("pmsg").textContent = e.message; $("pmsg").className = "msg lose"; $("pdrop").disabled = false;
    }
  });
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
