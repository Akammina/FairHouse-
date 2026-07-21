// Memory Match — a provably-fair skill bet. Wager, then clear all pairs within
// your move budget to win stake × multiplier. The deck is a seed-derived shuffle
// held by the server, which reveals one card per flip (you can't peek ahead).
import { shell, renderRecent, pushRecent, stakeField, wireStake } from "./common.js";
import { burst } from "../confetti.js";

const ACCENT = "#e879f9";
const FACES = [
  { v: "A", s: "♠", c: "dark" }, { v: "K", s: "♥", c: "red" }, { v: "Q", s: "♦", c: "red" }, { v: "J", s: "♣", c: "dark" },
  { v: "10", s: "♥", c: "red" }, { v: "9", s: "♠", c: "dark" }, { v: "8", s: "♦", c: "red" }, { v: "7", s: "♣", c: "dark" },
  { v: "6", s: "♥", c: "red" }, { v: "5", s: "♠", c: "dark" }, { v: "4", s: "♦", c: "red" }, { v: "3", s: "♣", c: "dark" }, { v: "2", s: "♥", c: "red" },
];
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export function renderMemory(root, ctx) {
  shell(root, {
    title: "Memory Match", icon: "🃏", accent: ACCENT,
    stage: `
      <p class="msg" id="memMsg" style="margin-bottom:14px">Wager, then clear the board within your move budget to win.</p>
      <div class="stat-row" style="margin-bottom:14px">
        <div class="stat"><span class="l">Moves left</span><span class="v" id="memLeft">—</span></div>
        <div class="stat"><span class="l">Pairs</span><span class="v" id="memPairs">—</span></div>
        <div class="stat"><span class="l">Win</span><span class="v" id="memWin">—</span></div>
      </div>
      <div class="mem-board">
        <div class="mem-grid" id="memGrid"></div>
        <div class="mem-over" id="memOver" hidden>
          <div class="mem-over-card">
            <div class="mem-over-emoji" id="memOverEmoji">🎉</div>
            <div class="mem-over-title" id="memOverTitle"></div>
            <div class="mem-over-sub" id="memOverSub"></div>
            <button class="btn" id="memAgain" style="--accent:${ACCENT}">Play again</button>
            <button class="mini" id="memMenu">Change bet</button>
          </div>
        </div>
      </div>
      <div id="memSetup">
        <div class="fld"><span>Difficulty</span>
          <div class="pick-row">
            <button class="pick active" data-diff="easy">Easy · 4×4 · 1.9×</button>
            <button class="pick" data-diff="hard">Hard · 6×4 · 2.8×</button>
          </div>
        </div>
        <div style="margin-top:14px">${stakeField("memStake")}</div>
        <button id="memStart" class="btn" style="margin-top:14px;--accent:${ACCENT}">Deal cards</button>
      </div>`,
  });
  renderRecent(ctx, "memory");
  wireStake("memStake");

  const $ = (id) => document.getElementById(id);
  const grid = $("memGrid");
  let diff = "easy", round = null, cards = [], faceForId = [], lock = false, mismatchTimer = 0, matchedCount = 0;

  ctx.onCleanup(() => clearTimeout(mismatchTimer));

  document.querySelectorAll("[data-diff]").forEach((b) =>
    b.addEventListener("click", () => { diff = b.dataset.diff; document.querySelectorAll("[data-diff]").forEach((x) => x.classList.toggle("active", x === b)); }),
  );

  const setSetup = (on) => { $("memSetup").hidden = !on; };
  const faceHTML = (id) => `<span class="v">${faceForId[id].v}</span><span class="s">${faceForId[id].s}</span>`;

  function setFace(el, id) {
    const front = el.querySelector(".mcard-front");
    front.innerHTML = faceHTML(id);
    front.className = `mcard-face mcard-front ${faceForId[id].c}`;
  }
  function reveal(el, id) { setFace(el, id); el.classList.add("flipped"); ctx.sound.reveal(); }

  function buildBoard(tiles, cols) {
    grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    grid.innerHTML = "";
    cards = Array.from({ length: tiles }, (_, i) => {
      const el = document.createElement("div");
      el.className = "mcard";
      el.innerHTML = `<div class="mcard-inner"><div class="mcard-face mcard-back">♠</div><div class="mcard-face mcard-front"></div></div>`;
      el.addEventListener("click", () => flip(i));
      grid.appendChild(el);
      return el;
    });
  }

  async function startGame() {
    $("memOver").hidden = true;
    $("memStart").disabled = true;
    try {
      const res = await ctx.api("/api/memory/start", { stake: Number($("memStake").value), difficulty: diff });
      round = { roundId: res.roundId, pairs: res.pairs, mult: res.mult, budget: res.budget, stakeCents: res.betCents, nonce: res.nonce, serverSeedHash: res.serverSeedHash, clientSeed: res.clientSeed };
      faceForId = shuffle(FACES.slice()).slice(0, res.pairs);
      matchedCount = 0; lock = false;
      ctx.applyResult(res);
      buildBoard(res.tiles, res.cols);
      $("memLeft").textContent = res.budget;
      $("memPairs").textContent = `0/${res.pairs}`;
      $("memWin").textContent = ctx.money(Math.floor(res.betCents * res.mult));
      $("memMsg").textContent = `Find all ${res.pairs} pairs within ${res.budget} moves.`;
      $("memMsg").className = "msg";
      setSetup(false);
    } catch (e) {
      $("memMsg").textContent = e.message; $("memMsg").className = "msg lose"; setSetup(true);
    } finally {
      $("memStart").disabled = false;
    }
  }
  $("memStart").addEventListener("click", startGame);
  $("memAgain").addEventListener("click", startGame);
  $("memMenu").addEventListener("click", () => { $("memOver").hidden = true; setSetup(true); });

  async function flip(i) {
    if (!round || lock) return;
    const el = cards[i];
    if (el.classList.contains("flipped") || el.classList.contains("matched")) return;
    lock = true;
    try {
      const res = await ctx.api("/api/memory/flip", { roundId: round.roundId, index: i });
      reveal(el, res.id);
      if (res.firstCard) { lock = false; return; } // first card of the turn — free to pick the second

      if (typeof res.movesLeft === "number") $("memLeft").textContent = res.movesLeft;
      else $("memLeft").textContent = Math.max(0, round.budget - res.moves);

      if (res.match) {
        cards[res.matched[0]].classList.add("matched");
        cards[res.matched[1]].classList.add("matched");
        matchedCount++;
        $("memPairs").textContent = `${matchedCount}/${round.pairs}`;
        if (res.cleared) { win(res); }
        else { ctx.sound.cashout(); lock = false; if (res.busted) bust(res); }
      } else {
        ctx.sound.click();
        const a = res.first, b = res.second;
        mismatchTimer = setTimeout(() => {
          cards[a].classList.remove("flipped");
          cards[b].classList.remove("flipped");
          lock = false;
          if (res.busted) bust(res);
        }, 850);
      }
    } catch (e) {
      $("memMsg").textContent = e.message; $("memMsg").className = "msg lose";
      lock = false;
    }
  }

  function showEnd(won, title, sub) {
    $("memOverEmoji").textContent = won ? "🎉" : "💥";
    const t = $("memOverTitle"); t.textContent = title; t.className = "mem-over-title " + (won ? "win" : "lose");
    $("memOverSub").textContent = sub;
    $("memOver").hidden = false;
  }

  function win(res) {
    $("memMsg").textContent = ""; $("memMsg").className = "msg";
    ctx.sound.win();
    ctx.applyResult(res);
    const r = grid.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2, 1.5);
    pushRecent(ctx, "memory", `${round.pairs} pairs in ${res.moves} @${round.mult}×`, round.stakeCents, res.payoutCents, true, round.nonce, round.serverSeedHash, round.clientSeed);
    showEnd(true, "You cleared the board!", `Won +${ctx.money(res.payoutCents - round.stakeCents)} · ${res.moves} moves`);
    round = null;
  }

  function bust(res) {
    // reveal what was left so you can see the board you missed
    if (Array.isArray(res.deck)) res.deck.forEach((id, idx) => {
      if (!cards[idx].classList.contains("matched")) { setFace(cards[idx], id); cards[idx].classList.add("flipped", "missed"); }
    });
    $("memMsg").textContent = ""; $("memMsg").className = "msg";
    ctx.sound.lose();
    ctx.applyResult(res);
    pushRecent(ctx, "memory", `${round.pairs} pairs, busted at ${res.moves} moves`, round.stakeCents, 0, false, round.nonce, round.serverSeedHash, round.clientSeed);
    showEnd(false, "Out of moves", `Lost ${ctx.money(round.stakeCents)} · ${matchedCount}/${round.pairs} pairs found`);
    round = null;
  }

  setSetup(true);
}
