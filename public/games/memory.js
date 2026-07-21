// Memory Match — a for-fun card game (no wallet, no betting). Flip two cards to
// find matching pairs; clear the board in as few moves as you can.
import { burst } from "../confetti.js";

const SUITS = [["♠", "dark"], ["♥", "red"], ["♦", "red"], ["♣", "dark"]];
const VALUES = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2"];
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

function makeDeck(pairs) {
  const all = [];
  for (const v of VALUES) for (const [s, c] of SUITS) all.push({ v, s, c });
  const faces = shuffle(all).slice(0, pairs);
  const deck = [];
  faces.forEach((f) => { deck.push({ ...f }); deck.push({ ...f }); });
  return shuffle(deck);
}

export function renderMemory(root, ctx) {
  const DIFF = { easy: { pairs: 8, cols: 4 }, hard: { pairs: 12, cols: 6 } };
  let diff = "easy";

  root.innerHTML = `
    <section class="card stage" style="max-width:600px;margin:0 auto">
      <h2 class="game-title"><span class="dot" style="background:#e879f9"></span>🃏 Memory Match</h2>
      <p class="msg" id="memMsg">Flip two cards to find a matching pair.</p>
      <div class="mem-bar">
        <div class="mem-stats">
          <span>Moves <b id="memMoves">0</b></span>
          <span>Pairs <b id="memPairs">0</b></span>
          <span>Time <b id="memTime">0:00</b></span>
        </div>
        <div class="mem-diff">
          <button class="mini" data-diff="easy">4×4</button>
          <button class="mini" data-diff="hard">6×4</button>
          <button class="mini" id="memNew">New game</button>
        </div>
      </div>
      <div class="mem-grid" id="memGrid"></div>
      <p class="mem-best" id="memBest"></p>
    </section>`;

  const $ = (id) => document.getElementById(id);
  const grid = $("memGrid");
  let deck = [], cards = [], firstIdx = null, lock = false, moves = 0, matches = 0, started = false;
  let timerId = 0, mismatchTimer = 0, startMs = 0;

  ctx.onCleanup(() => { clearInterval(timerId); clearTimeout(mismatchTimer); });

  function bestKey() { return `fairhouse_memory_${diff}`; }
  function showBest() {
    const b = JSON.parse(localStorage.getItem(bestKey()) || "null");
    $("memBest").textContent = b ? `Best (${diff === "easy" ? "4×4" : "6×4"}): ${b.moves} moves · ${fmt(b.ms)}` : "";
  }
  const fmt = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

  function startTimer() {
    startMs = performance.now();
    timerId = setInterval(() => { $("memTime").textContent = fmt(performance.now() - startMs); }, 500);
  }
  function updateStats() {
    $("memMoves").textContent = moves;
    $("memPairs").textContent = `${matches}/${DIFF[diff].pairs}`;
  }

  function newGame() {
    clearInterval(timerId); clearTimeout(mismatchTimer);
    const { pairs, cols } = DIFF[diff];
    deck = makeDeck(pairs);
    firstIdx = null; lock = false; moves = 0; matches = 0; started = false;
    grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    grid.innerHTML = "";
    cards = deck.map((card, i) => {
      const el = document.createElement("div");
      el.className = "mcard";
      el.innerHTML = `<div class="mcard-inner">
        <div class="mcard-face mcard-back">♠</div>
        <div class="mcard-face mcard-front ${card.c}"><span class="v">${card.v}</span><span class="s">${card.s}</span></div>
      </div>`;
      el.addEventListener("click", () => flip(i));
      grid.appendChild(el);
      return el;
    });
    $("memMsg").textContent = "Flip two cards to find a matching pair.";
    $("memMsg").className = "msg";
    $("memTime").textContent = "0:00";
    updateStats(); showBest();
  }

  function flip(i) {
    if (lock) return;
    const el = cards[i];
    if (el.classList.contains("flipped") || el.classList.contains("matched")) return;
    if (!started) { started = true; startTimer(); }
    el.classList.add("flipped");
    ctx.sound.reveal();

    if (firstIdx === null) { firstIdx = i; return; }
    moves++; updateStats();
    const a = deck[firstIdx], b = deck[i];
    const fi = firstIdx, si = i;
    firstIdx = null;

    if (a.v === b.v && a.s === b.s) {
      cards[fi].classList.add("matched"); cards[si].classList.add("matched");
      matches++; updateStats(); ctx.sound.cashout();
      if (matches === DIFF[diff].pairs) win();
    } else {
      lock = true; ctx.sound.click();
      mismatchTimer = setTimeout(() => {
        cards[fi].classList.remove("flipped"); cards[si].classList.remove("flipped");
        lock = false;
      }, 850);
    }
  }

  function win() {
    clearInterval(timerId);
    const ms = performance.now() - startMs;
    $("memMsg").textContent = `You cleared the board in ${moves} moves · ${fmt(ms)}! 🎉`;
    $("memMsg").className = "msg win";
    ctx.sound.win();
    const r = grid.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2, 1.4);

    const prev = JSON.parse(localStorage.getItem(bestKey()) || "null");
    if (!prev || moves < prev.moves || (moves === prev.moves && ms < prev.ms)) {
      localStorage.setItem(bestKey(), JSON.stringify({ moves, ms }));
      $("memMsg").textContent += " New best!";
    }
    showBest();
  }

  document.querySelectorAll("[data-diff]").forEach((b) =>
    b.addEventListener("click", () => {
      diff = b.dataset.diff;
      document.querySelectorAll("[data-diff]").forEach((x) => x.classList.toggle("sel", x === b));
      newGame();
    }),
  );
  document.querySelector('[data-diff="easy"]').classList.add("sel");
  $("memNew").addEventListener("click", newGame);
  newGame();
}
