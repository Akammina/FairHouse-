// Lightweight confetti burst for wins. One shared overlay canvas on top of everything.
let canvas, g, parts = [], raf = 0;
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const COLORS = ["#f5c451", "#33d17f", "#8b7bff", "#38d0e0", "#ff5d6c", "#fff3cf"];
const rand = (a, b) => a + Math.random() * (b - a);

function ensure() {
  if (canvas) return;
  canvas = document.createElement("canvas");
  canvas.id = "confetti";
  Object.assign(canvas.style, { position: "fixed", inset: "0", zIndex: "60", pointerEvents: "none" });
  document.body.appendChild(canvas);
  g = canvas.getContext("2d");
  const size = () => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
    canvas.style.width = innerWidth + "px"; canvas.style.height = innerHeight + "px";
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  window.addEventListener("resize", size); size();
}

/** Fire a burst from (x, y) in viewport pixels. `power` scales the count/spread. */
export function burst(x, y, power = 1) {
  if (reduce) return;
  ensure();
  const count = Math.round(38 * power);
  for (let i = 0; i < count; i++) {
    parts.push({
      x, y,
      vx: rand(-4.5, 4.5) * power,
      vy: rand(-11, -3) * power,
      size: rand(4, 9),
      rot: rand(0, Math.PI * 2),
      vr: rand(-0.3, 0.3),
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      life: 1,
    });
  }
  if (!raf) raf = requestAnimationFrame(loop);
}

function loop() {
  g.clearRect(0, 0, canvas.width, canvas.height);
  for (const p of parts) {
    p.vy += 0.3; // gravity
    p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life -= 0.012;
    g.save();
    g.globalAlpha = Math.max(0, p.life);
    g.translate(p.x, p.y); g.rotate(p.rot);
    g.fillStyle = p.color;
    g.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
    g.restore();
  }
  parts = parts.filter((p) => p.life > 0 && p.y < innerHeight + 40);
  raf = parts.length ? requestAnimationFrame(loop) : 0;
}
