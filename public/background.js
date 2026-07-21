// Ambient animated background: slow drifting aurora glows in the brand palette,
// faint floating card suits for casino character, and a vignette to keep focus.
// One fixed canvas behind all content; respects prefers-reduced-motion.
export function initBackground() {
  const canvas = document.createElement("canvas");
  canvas.id = "bg";
  document.body.prepend(canvas);
  const g = canvas.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const ORB_COLORS = ["#f5c451", "#8b7bff", "#38d0e0", "#33d17f"]; // gold, violet, teal, green
  const SUITS = ["♠", "♥", "♦", "♣"];
  const rand = (a, b) => a + Math.random() * (b - a);
  const hexA = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };

  let W = 0, H = 0, orbs = [], suits = [], raf = 0, last = performance.now();

  function build() {
    orbs = ORB_COLORS.map((color) => ({
      color, x: rand(0.1, 0.9) * W, y: rand(0.1, 0.9) * H,
      vx: rand(-11, 11), vy: rand(-11, 11), r: rand(0.34, 0.52) * Math.min(W, H),
    }));
    const n = Math.max(7, Math.round(W / 150));
    suits = Array.from({ length: n }, () => ({
      glyph: SUITS[Math.floor(Math.random() * 4)],
      x: rand(0, W), y: rand(0, H), size: rand(18, 54),
      vy: rand(7, 18), sway: rand(0.3, 1), phase: rand(0, Math.PI * 2), rot: rand(-0.25, 0.25),
    }));
  }
  function size() {
    const dpr = window.devicePixelRatio || 1;
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    build();
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    g.globalCompositeOperation = "source-over";
    g.fillStyle = "#090d12"; g.fillRect(0, 0, W, H);

    g.globalCompositeOperation = "lighter"; // additive glow
    for (const o of orbs) {
      o.x += o.vx * dt; o.y += o.vy * dt;
      if (o.x < -o.r) o.x = W + o.r; else if (o.x > W + o.r) o.x = -o.r;
      if (o.y < -o.r) o.y = H + o.r; else if (o.y > H + o.r) o.y = -o.r;
      const grad = g.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r);
      grad.addColorStop(0, hexA(o.color, 0.13));
      grad.addColorStop(1, hexA(o.color, 0));
      g.fillStyle = grad; g.beginPath(); g.arc(o.x, o.y, o.r, 0, Math.PI * 2); g.fill();
    }

    g.globalCompositeOperation = "source-over";
    for (const s of suits) {
      s.y -= s.vy * dt; s.phase += dt * 0.6;
      if (s.y < -60) { s.y = H + 40; s.x = rand(0, W); }
      const x = s.x + Math.sin(s.phase) * s.sway * 22;
      g.save(); g.translate(x, s.y); g.rotate(Math.sin(s.phase) * s.rot);
      g.fillStyle = hexA("#f5c451", 0.05);
      g.font = `${s.size}px serif`; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(s.glyph, 0, 0); g.restore();
    }

    // vignette
    const vg = g.createRadialGradient(W / 2, H * 0.38, Math.min(W, H) * 0.28, W / 2, H / 2, Math.max(W, H) * 0.78);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.5)");
    g.fillStyle = vg; g.fillRect(0, 0, W, H);

    if (!reduce) raf = requestAnimationFrame(frame);
  }

  window.addEventListener("resize", size);
  size();
  raf = requestAnimationFrame(frame);
}
