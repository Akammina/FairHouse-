// Procedural sound effects via the Web Audio API — no audio files needed.
// Sounds are synthesized from oscillators, so it's tiny and CSP-clean. Audio is
// created lazily on the first user gesture (browsers block it before that).
let audio = null;
let muted = localStorage.getItem("fairhouse_muted") === "1";

function ac() {
  if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
  if (audio.state === "suspended") audio.resume();
  return audio;
}

/** One enveloped oscillator note. */
function tone({ freq, type = "sine", dur = 0.12, gain = 0.14, slideTo = null, delay = 0 }) {
  if (muted) return;
  const a = ac();
  const t = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.03);
}

export const Sound = {
  get muted() { return muted; },
  unlock() { try { ac(); } catch { /* no audio */ } },
  toggle() {
    muted = !muted;
    localStorage.setItem("fairhouse_muted", muted ? "1" : "0");
    if (!muted) tone({ freq: 660, type: "triangle", dur: 0.09, gain: 0.12 });
    return muted;
  },
  click() { tone({ freq: 300, type: "triangle", dur: 0.045, gain: 0.045 }); },
  bet() { tone({ freq: 420, type: "triangle", dur: 0.07, gain: 0.08 }); },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, type: "triangle", dur: 0.15, gain: 0.11, delay: i * 0.07 })); },
  lose() { tone({ freq: 300, type: "sine", dur: 0.3, gain: 0.11, slideTo: 110 }); },
  cashout() { [784, 1047, 1319].forEach((f, i) => tone({ freq: f, type: "triangle", dur: 0.12, gain: 0.1, delay: i * 0.06 })); },
  reveal() { tone({ freq: 760, type: "triangle", dur: 0.06, gain: 0.08, slideTo: 1180 }); },
  mine() { tone({ freq: 200, type: "sawtooth", dur: 0.38, gain: 0.16, slideTo: 55 }); },
  whoosh() { tone({ freq: 180, type: "sine", dur: 0.5, gain: 0.06, slideTo: 620 }); },
};
