// Lobby-only ambient: gold coins and poker chips gently raining behind the game
// grid, spinning and glowing. One canvas, torn down when you leave the lobby, so
// game screens stay calm. Respects prefers-reduced-motion.
export function startLobbyFx(ctx) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const canvas = document.createElement("canvas");
  canvas.className = "lobbyfx";
  document.body.appendChild(canvas);
  const g = canvas.getContext("2d");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const rand = (a, b) => a + Math.random() * (b - a);

  // classic poker-chip colours: [base, ring]
  const CHIPS = [
    ["#d64545", "#ffb3b3"], ["#3b82f6", "#bfdbfe"], ["#22c55e", "#bbf7d0"],
    ["#a855f7", "#e9d5ff"], ["#0ea5b7", "#a5f3fc"], ["#334155", "#94a3b8"],
  ];

  let W = 0, H = 0, items = [], raf = 0, last = performance.now(), running = true;

  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function spawn(top) {
    return {
      type: Math.random() < 0.42 ? "coin" : "chip",
      x: rand(0, W), y: top ? rand(-H * 0.6, -20) : rand(-H, H),
      r: rand(11, 21), vy: rand(16, 40), sway: rand(0.4, 1.1), phase: rand(0, 6.28),
      rot: rand(0, 6.28), vr: rand(-1.4, 1.4), chip: CHIPS[Math.floor(Math.random() * CHIPS.length)],
      a: rand(0.28, 0.62),
    };
  }

  resize();
  window.addEventListener("resize", resize);
  items = Array.from({ length: Math.max(14, Math.round(W / 68)) }, () => spawn(false));

  function coin(it) {
    g.save(); g.translate(it.x, it.y); g.rotate(it.rot);
    g.scale(Math.abs(Math.cos(it.rot)) * 0.55 + 0.45, 1); // flip-spin squash
    const grd = g.createLinearGradient(0, -it.r, 0, it.r);
    grd.addColorStop(0, "#fff2c0"); grd.addColorStop(0.5, "#f5c451"); grd.addColorStop(1, "#c78a1e");
    g.globalAlpha = it.a; g.fillStyle = grd;
    g.beginPath(); g.arc(0, 0, it.r, 0, 6.283); g.fill();
    g.lineWidth = 1.5; g.strokeStyle = "rgba(255,255,255,0.5)"; g.stroke();
    g.restore();
  }

  function chip(it) {
    g.save(); g.translate(it.x, it.y); g.rotate(it.rot);
    g.scale(Math.abs(Math.cos(it.rot)) * 0.5 + 0.5, 1);
    g.globalAlpha = it.a;
    g.fillStyle = it.chip[0]; g.beginPath(); g.arc(0, 0, it.r, 0, 6.283); g.fill();
    g.strokeStyle = it.chip[1]; g.lineWidth = it.r * 0.5; g.setLineDash([it.r * 0.5, it.r * 0.55]);
    g.beginPath(); g.arc(0, 0, it.r * 0.78, 0, 6.283); g.stroke(); g.setLineDash([]);
    g.fillStyle = "rgba(255,255,255,0.85)"; g.beginPath(); g.arc(0, 0, it.r * 0.48, 0, 6.283); g.fill();
    g.fillStyle = it.chip[0]; g.beginPath(); g.arc(0, 0, it.r * 0.4, 0, 6.283); g.fill();
    g.restore();
  }

  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    g.clearRect(0, 0, W, H); g.shadowBlur = 12;
    for (const it of items) {
      it.y += it.vy * dt; it.rot += it.vr * dt;
      it.x += Math.sin(it.phase + now / 1000 * it.sway) * 0.35;
      if (it.y - it.r > H + 24) Object.assign(it, spawn(true));
      g.shadowColor = it.type === "coin" ? "rgba(245,196,81,0.5)" : it.chip[0] + "88";
      it.type === "coin" ? coin(it) : chip(it);
    }
    g.shadowBlur = 0;
    raf = requestAnimationFrame(frame);
  }

  if (reduce) {
    for (const it of items) it.type === "coin" ? coin(it) : chip(it); // static single paint
  } else {
    raf = requestAnimationFrame(frame);
  }

  ctx.onCleanup(() => {
    running = false;
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    canvas.remove();
  });
}
